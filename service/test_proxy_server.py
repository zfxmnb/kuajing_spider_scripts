import http.client
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from stat import S_IMODE
from tempfile import TemporaryDirectory
from urllib.parse import urlsplit

from proxy_server import COOKIE_ENDPOINT, SharedCookieStore, SiteConfig, create_server, load_sites, localize_url, remove_frame_ancestors, rewrite_html_urls


class ProxyServerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.target = urlsplit("https://www.baidu.com")

    def test_load_sites_rejects_non_loopback_listener(self) -> None:
        with TemporaryDirectory() as directory:
            config_path = Path(directory) / "sites.json"
            config_path.write_text('{"listen_host":"0.0.0.0","sites":[]}', encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "127.0.0.1"):
                load_sites(config_path)

    def test_load_sites_rejects_cookie_environment_variable(self) -> None:
        with TemporaryDirectory() as directory:
            config_path = Path(directory) / "sites.json"
            config_path.write_text('{"sites":[{"name":"test","listen_port":1001,"target_origin":"https://example.com","cookie_env":"COOKIE"}]}', encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "cookie_env"):
                load_sites(config_path)

    def test_localize_url_only_rewrites_same_origin(self) -> None:
        self.assertEqual(localize_url("https://www.baidu.com/search?q=test", self.target), "/search?q=test")
        self.assertEqual(localize_url("https://example.com/search", self.target), "https://example.com/search")

    def test_remove_frame_ancestors_preserves_other_csp_directives(self) -> None:
        actual = remove_frame_ancestors("default-src 'self'; frame-ancestors 'self' https://example.com; img-src https:")
        self.assertEqual(actual, "default-src 'self'; img-src https:")

    def test_cookie_store_replaces_and_updates_cookie(self) -> None:
        with TemporaryDirectory() as directory:
            cookie_store = SharedCookieStore(Path(directory) / "cache.json")
            cookie_store.replace("session=manual; region=cn")
            cookie_store.update_from_set_cookie(["session=upstream; Path=/", "csrf=token; HttpOnly"])
            self.assertEqual(cookie_store.to_header(), "session=upstream; region=cn; csrf=token")

    def test_cookie_store_removes_expired_cookie(self) -> None:
        with TemporaryDirectory() as directory:
            cookie_store = SharedCookieStore(Path(directory) / "cache.json")
            cookie_store.replace("session=manual; region=cn")
            cookie_store.update_from_set_cookie(["session=; Max-Age=0"])
            self.assertEqual(cookie_store.to_header(), "region=cn")

    def test_cookie_store_rejects_invalid_manual_cookie(self) -> None:
        with self.assertRaisesRegex(ValueError, "Cookie"):
            SharedCookieStore(Path("cache.json")).replace("not a cookie")

    def test_cookie_store_restores_persisted_cookie_with_owner_only_permission(self) -> None:
        with TemporaryDirectory() as directory:
            cache_path = Path(directory) / "cookies" / "test.json"
            SharedCookieStore(cache_path).replace("session=manual")
            self.assertEqual(SharedCookieStore(cache_path).to_header(), "session=manual")
            self.assertEqual(S_IMODE(cache_path.stat().st_mode), 0o600)
            self.assertEqual(S_IMODE(cache_path.parent.stat().st_mode), 0o700)

    def test_cookie_endpoint_replaces_shared_cache_without_response_cookie(self) -> None:
        with TemporaryDirectory() as directory:
            site = SiteConfig("test", 0, urlsplit("https://example.com"), 30)
            server = create_server(site, Path(directory))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=5)
                request_body = json.dumps({"cookie": "session=manual; region=cn"}).encode("utf-8")
                connection.request("PUT", COOKIE_ENDPOINT, request_body, {"Content-Type": "application/json"})
                response = connection.getresponse()
                self.assertEqual(response.status, 204)
                self.assertIsNone(response.getheader("Set-Cookie"))
                self.assertEqual(server.RequestHandlerClass.cookie_store.to_header(), "session=manual; region=cn")
                connection.close()
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def test_cors_preflight_only_allows_temu_management_origin(self) -> None:
        with TemporaryDirectory() as directory:
            server = create_server(SiteConfig("test", 0, urlsplit("https://example.com"), 30), Path(directory))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=5)
                connection.request(
                    "OPTIONS",
                    "/",
                    headers={
                        "Origin": "https://agentseller.temu.com",
                        "Access-Control-Request-Method": "GET",
                        "Access-Control-Request-Private-Network": "true"
                    }
                )
                response = connection.getresponse()
                self.assertEqual(response.status, 204)
                self.assertEqual(response.getheader("Access-Control-Allow-Origin"), "https://agentseller.temu.com")
                self.assertEqual(response.getheader("Access-Control-Allow-Private-Network"), "true")
                connection.close()
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def test_upstream_set_cookie_updates_service_cache_without_browser_exposure(self) -> None:
        class UpstreamHandler(BaseHTTPRequestHandler):
            received_cookie = ""

            def do_GET(self) -> None:
                type(self).received_cookie = self.headers.get("Cookie", "")
                self.send_response(200)
                self.send_header("Content-Type", "text/plain")
                self.send_header("Set-Cookie", "session=upstream; Path=/; HttpOnly")
                self.send_header("X-Frame-Options", "SAMEORIGIN")
                self.send_header("Content-Security-Policy", "default-src 'self'; frame-ancestors 'self'")
                self.send_header("Content-Length", "2")
                self.end_headers()
                self.wfile.write(b"ok")

            def log_message(self, _: str, *__: object) -> None:
                return

        upstream_server = ThreadingHTTPServer(("127.0.0.1", 0), UpstreamHandler)
        upstream_thread = threading.Thread(target=upstream_server.serve_forever, daemon=True)
        upstream_thread.start()
        target = urlsplit(f"http://127.0.0.1:{upstream_server.server_port}")
        with TemporaryDirectory() as directory:
            proxy_server = create_server(SiteConfig("test", 0, target, 30), Path(directory))
            proxy_server.RequestHandlerClass.cookie_store.replace("session=manual")
            proxy_thread = threading.Thread(target=proxy_server.serve_forever, daemon=True)
            proxy_thread.start()
            try:
                connection = http.client.HTTPConnection("127.0.0.1", proxy_server.server_port, timeout=5)
                connection.request("GET", "/", headers={"Cookie": "session=browser", "Origin": "https://agentseller.temu.com"})
                response = connection.getresponse()
                self.assertEqual(response.read(), b"ok")
                self.assertIsNone(response.getheader("Set-Cookie"))
                self.assertIsNone(response.getheader("X-Frame-Options"))
                self.assertEqual(response.getheader("Content-Security-Policy"), "default-src 'self'")
                self.assertEqual(response.getheader("Access-Control-Allow-Origin"), "https://agentseller.temu.com")
                self.assertEqual(UpstreamHandler.received_cookie, "session=manual")
                self.assertEqual(proxy_server.RequestHandlerClass.cookie_store.to_header(), "session=upstream")
                connection.close()
            finally:
                proxy_server.shutdown()
                proxy_server.server_close()
                proxy_thread.join(timeout=5)
                upstream_server.shutdown()
                upstream_server.server_close()
                upstream_thread.join(timeout=5)

    def test_rewrite_html_urls_preserves_external_urls(self) -> None:
        body = b'<a href="https://www.baidu.com/search">search</a><img src="https://example.com/image.png">'
        actual = rewrite_html_urls(body, "text/html; charset=utf-8", self.target)
        self.assertEqual(actual, b'<a href="/search">search</a><img src="https://example.com/image.png">')

    def test_site_config_keeps_target_host(self) -> None:
        site = SiteConfig("baidu", 1001, self.target, 30)
        self.assertEqual(site.target_host, "www.baidu.com")
        self.assertEqual(site.target_origin, "https://www.baidu.com")


if __name__ == "__main__":
    unittest.main()
