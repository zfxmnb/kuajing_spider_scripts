#!/usr/bin/env python3
from __future__ import annotations

import argparse
import http.client
import json
import logging
import os
import re
import signal
import sys
import tempfile
import threading
from dataclasses import dataclass
from http import HTTPStatus
from http.cookies import CookieError, SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import FrameType
from typing import Final
from urllib.parse import SplitResult, urlsplit, urlunsplit


LOGGER = logging.getLogger("local_reverse_proxy")
MAX_REQUEST_BODY_BYTES: Final = 10 * 1024 * 1024
MAX_RESPONSE_BODY_BYTES: Final = 50 * 1024 * 1024
MAX_COOKIE_HEADER_BYTES: Final = 64 * 1024
DEFAULT_TIMEOUT_SECONDS: Final = 30
HOP_BY_HOP_HEADERS: Final = frozenset({"connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"})
RESPONSE_HEADERS_TO_SKIP: Final = HOP_BY_HOP_HEADERS | frozenset({"content-length"})
HTML_CONTENT_TYPES: Final = ("text/html", "application/xhtml+xml")
COOKIE_ENDPOINT: Final = "/__local_proxy/cookie"
COOKIE_HEADER_PATTERN: Final = re.compile(r"^\s*[^=;\s]+\s*=\s*[^;]*\s*(?:;\s*[^=;\s]+\s*=\s*[^;]*\s*)*$")
COOKIE_CACHE_DIR: Final = Path(__file__).with_name(".runtime") / "cookies"
CORS_ALLOWED_ORIGINS: Final = frozenset({"https://seller.kuajingmaihuo.com", "https://agentseller.temu.com", "https://agentseller-us.temu.com"})
CORS_ALLOWED_METHODS: Final = frozenset({"GET", "HEAD"})
CORS_RESPONSE_HEADERS: Final = frozenset({"access-control-allow-origin", "access-control-allow-methods", "access-control-allow-headers", "access-control-allow-private-network"})
FRAME_RESTRICTION_HEADERS: Final = frozenset({"x-frame-options"})


@dataclass(frozen=True)
class SiteConfig:
    name: str
    listen_port: int
    target: SplitResult
    timeout_seconds: int

    @property
    def target_host(self) -> str:
        return self.target.netloc

    @property
    def target_origin(self) -> str:
        return urlunsplit((self.target.scheme, self.target.netloc, "", "", ""))


def load_sites(config_path: Path) -> list[SiteConfig]:
    with config_path.open(encoding="utf-8") as config_file:
        raw_config = json.load(config_file)

    if raw_config.get("listen_host", "127.0.0.1") != "127.0.0.1":
        raise ValueError("listen_host 必须为 127.0.0.1")
    raw_sites = raw_config.get("sites")
    if not isinstance(raw_sites, list) or not raw_sites:
        raise ValueError("sites 必须是非空数组")

    sites: list[SiteConfig] = []
    seen_names: set[str] = set()
    seen_ports: set[int] = set()
    for raw_site in raw_sites:
        if not isinstance(raw_site, dict):
            raise ValueError("sites 中的每一项必须是对象")
        name = raw_site.get("name")
        port = raw_site.get("listen_port")
        target_origin = raw_site.get("target_origin")
        timeout_seconds = raw_site.get("timeout_seconds", DEFAULT_TIMEOUT_SECONDS)
        if not isinstance(name, str) or not re.fullmatch(r"[a-z0-9_-]+", name):
            raise ValueError("site.name 必须为小写字母、数字、连字符或下划线")
        if not isinstance(port, int) or not 1 <= port <= 65535:
            raise ValueError(f"{name}.listen_port 必须在 1 到 65535 之间")
        if not isinstance(target_origin, str):
            raise ValueError(f"{name}.target_origin 必须是字符串")
        target = urlsplit(target_origin)
        if target.scheme not in {"http", "https"} or not target.netloc or target.path not in {"", "/"}:
            raise ValueError(f"{name}.target_origin 必须是无路径的 http 或 https 源站")
        if target.username is not None or target.password is not None:
            raise ValueError(f"{name}.target_origin 不能包含凭据")
        if "cookie_env" in raw_site:
            raise ValueError(f"{name} 不支持 cookie_env；请调用 {COOKIE_ENDPOINT} 写入 Cookie 缓存")
        if not isinstance(timeout_seconds, int) or not 1 <= timeout_seconds <= 300:
            raise ValueError(f"{name}.timeout_seconds 必须在 1 到 300 之间")
        if name in seen_names or port in seen_ports:
            raise ValueError("site.name 和 site.listen_port 不能重复")
        seen_names.add(name)
        seen_ports.add(port)
        sites.append(SiteConfig(name, port, target, timeout_seconds))
    return sites


def parse_cookie_header(cookie_header: str, allow_empty: bool = False) -> SimpleCookie:
    if not isinstance(cookie_header, str) or len(cookie_header.encode("utf-8")) > MAX_COOKIE_HEADER_BYTES:
        raise ValueError("Cookie 格式无效或超过大小限制")
    if cookie_header and not COOKIE_HEADER_PATTERN.fullmatch(cookie_header):
        raise ValueError("Cookie 格式无效")
    cookies = SimpleCookie()
    try:
        cookies.load(cookie_header)
    except (CookieError, ValueError) as error:
        raise ValueError("Cookie 格式无效") from error
    if not allow_empty and not cookies:
        raise ValueError("Cookie 不能为空或格式无效")
    return cookies


def parse_set_cookie_header(set_cookie_header: str) -> SimpleCookie:
    if not isinstance(set_cookie_header, str) or len(set_cookie_header.encode("utf-8")) > MAX_COOKIE_HEADER_BYTES:
        raise ValueError("Set-Cookie 格式无效或超过大小限制")
    cookies = SimpleCookie()
    try:
        cookies.load(set_cookie_header)
    except (CookieError, ValueError) as error:
        raise ValueError("Set-Cookie 格式无效") from error
    if not cookies:
        raise ValueError("Set-Cookie 格式无效")
    return cookies


class SharedCookieStore:
    def __init__(self, cache_path: Path) -> None:
        self._cache_path = cache_path
        self._lock = threading.Lock()
        self._cookies = self._load()

    def _load(self) -> SimpleCookie:
        if not self._cache_path.exists():
            return SimpleCookie()
        try:
            with self._cache_path.open(encoding="utf-8") as cache_file:
                payload = json.load(cache_file)
            if not isinstance(payload, dict) or set(payload) != {"cookie"} or not isinstance(payload["cookie"], str):
                raise ValueError("缓存内容无效")
            return parse_cookie_header(payload["cookie"], allow_empty=True)
        except (OSError, json.JSONDecodeError, ValueError) as error:
            LOGGER.warning("无法恢复 Cookie 缓存 file=%s error=%s", self._cache_path.name, error)
            return SimpleCookie()

    def _persist(self, cookies: SimpleCookie) -> None:
        self._cache_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(self._cache_path.parent, 0o700)
        payload = {"cookie": self._to_header(cookies)}
        file_descriptor, temporary_path = tempfile.mkstemp(prefix=f".{self._cache_path.name}.", suffix=".tmp", dir=self._cache_path.parent)
        try:
            os.fchmod(file_descriptor, 0o600)
            with os.fdopen(file_descriptor, "w", encoding="utf-8") as cache_file:
                json.dump(payload, cache_file, ensure_ascii=False, separators=(",", ":"))
                cache_file.flush()
                os.fsync(cache_file.fileno())
            os.replace(temporary_path, self._cache_path)
            os.chmod(self._cache_path, 0o600)
        except OSError:
            try:
                os.close(file_descriptor)
            except OSError:
                pass
            try:
                os.unlink(temporary_path)
            except FileNotFoundError:
                pass
            raise

    @staticmethod
    def _to_header(cookies: SimpleCookie) -> str:
        return "; ".join(f"{name}={morsel.coded_value}" for name, morsel in cookies.items())

    def replace(self, cookie_header: str) -> None:
        cookies = parse_cookie_header(cookie_header, allow_empty=True)
        with self._lock:
            self._persist(cookies)
            self._cookies = cookies

    def update_from_set_cookie(self, set_cookie_headers: list[str]) -> None:
        with self._lock:
            cookies = SimpleCookie()
            cookies.load(self._to_header(self._cookies))
            for set_cookie_header in set_cookie_headers:
                try:
                    response_cookies = parse_set_cookie_header(set_cookie_header)
                except ValueError:
                    LOGGER.warning("忽略上游格式不正确的 Set-Cookie")
                    continue
                for name, morsel in response_cookies.items():
                    if morsel["max-age"] == "0":
                        cookies.pop(name, None)
                    else:
                        cookies[name] = morsel.value
            if set_cookie_headers:
                self._persist(cookies)
                self._cookies = cookies

    def to_header(self) -> str:
        with self._lock:
            return self._to_header(self._cookies)


def localize_url(value: str, target: SplitResult) -> str:
    parsed = urlsplit(value)
    if parsed.scheme in {"http", "https"} and parsed.netloc == target.netloc:
        return urlunsplit(("", "", parsed.path or "/", parsed.query, parsed.fragment))
    if not parsed.scheme and parsed.netloc == target.netloc:
        return urlunsplit(("", "", parsed.path or "/", parsed.query, parsed.fragment))
    return value


def rewrite_html_urls(body: bytes, content_type: str, target: SplitResult) -> bytes:
    if not any(content_type.lower().startswith(value) for value in HTML_CONTENT_TYPES):
        return body
    charset_match = re.search(r"charset=([^;\s]+)", content_type, re.IGNORECASE)
    encoding = charset_match.group(1).strip('\"\'') if charset_match else "utf-8"
    try:
        html = body.decode(encoding)
    except (LookupError, UnicodeDecodeError):
        return body
    target_pattern = re.escape(f"{target.scheme}://{target.netloc}")
    return re.sub(target_pattern, "", html, flags=re.IGNORECASE).encode(encoding)


def remove_frame_ancestors(content_security_policy: str) -> str:
    return "; ".join(directive.strip() for directive in content_security_policy.split(";") if directive.strip() and directive.strip().split(None, 1)[0].lower() != "frame-ancestors")


class ProxyRequestHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    site: SiteConfig
    cookie_store: SharedCookieStore

    def do_GET(self) -> None:
        self._proxy()

    def do_POST(self) -> None:
        self._proxy()

    def do_PUT(self) -> None:
        if self._is_cookie_endpoint():
            self._replace_cookie()
            return
        self._proxy()

    def do_PATCH(self) -> None:
        self._proxy()

    def do_DELETE(self) -> None:
        self._proxy()

    def do_HEAD(self) -> None:
        self._proxy()

    def do_OPTIONS(self) -> None:
        if self._is_cors_preflight():
            self.send_response(HTTPStatus.NO_CONTENT)
            self._send_cors_headers()
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        self._proxy()

    def _is_cookie_endpoint(self) -> bool:
        return urlsplit(self.path).path == COOKIE_ENDPOINT

    def _is_allowed_cors_origin(self) -> bool:
        return self.headers.get("Origin") in CORS_ALLOWED_ORIGINS

    def _is_cors_preflight(self) -> bool:
        return self._is_allowed_cors_origin() and self.headers.get("Access-Control-Request-Method", "").upper() in CORS_ALLOWED_METHODS

    def _send_cors_headers(self) -> None:
        origin = self.headers.get("Origin")
        if not origin or origin not in CORS_ALLOWED_ORIGINS:
            return
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Methods", ", ".join(sorted(CORS_ALLOWED_METHODS)))
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Vary", "Origin")
        if self.headers.get("Access-Control-Request-Private-Network", "").lower() == "true":
            self.send_header("Access-Control-Allow-Private-Network", "true")

    def _replace_cookie(self) -> None:
        try:
            request_body = self._read_request_body()
            if request_body is None:
                raise ValueError("缺少请求体")
            payload = json.loads(request_body)
            if not isinstance(payload, dict) or set(payload) != {"cookie"} or not isinstance(payload["cookie"], str):
                raise ValueError('请求体必须为 {"cookie":"..."}')
            self.cookie_store.replace(payload["cookie"])
            self.send_response(HTTPStatus.NO_CONTENT)
            self.send_header("Content-Length", "0")
            self.end_headers()
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
            self.send_error(HTTPStatus.BAD_REQUEST, str(error))
        except OSError:
            LOGGER.error("Cookie 缓存写入失败 site=%s", self.site.name)
            self.send_error(HTTPStatus.INTERNAL_SERVER_ERROR, "Cookie 缓存写入失败")

    def _proxy(self) -> None:
        try:
            request_body = self._read_request_body()
            upstream = self._create_connection()
            try:
                upstream.request(self.command, self.path, request_body, self._upstream_headers())
                response = upstream.getresponse()
                response_body = response.read(MAX_RESPONSE_BODY_BYTES + 1)
                if len(response_body) > MAX_RESPONSE_BODY_BYTES:
                    raise OSError(f"上游响应超过 {MAX_RESPONSE_BODY_BYTES} 字节")
                self._send_response(response, response_body)
            finally:
                upstream.close()
        except ValueError as error:
            self.send_error(HTTPStatus.BAD_REQUEST, str(error))
        except (OSError, http.client.HTTPException) as error:
            LOGGER.warning("上游请求失败 site=%s path=%s error=%s", self.site.name, self.path, error)
            self.send_error(HTTPStatus.BAD_GATEWAY, "上游站点不可用")

    def _read_request_body(self) -> bytes | None:
        if self.headers.get("Transfer-Encoding"):
            raise ValueError("不支持 Transfer-Encoding 请求体")
        raw_length = self.headers.get("Content-Length")
        if raw_length is None:
            return None
        try:
            content_length = int(raw_length)
        except ValueError as error:
            raise ValueError("Content-Length 无效") from error
        if content_length < 0 or content_length > MAX_REQUEST_BODY_BYTES:
            raise ValueError(f"请求体不能超过 {MAX_REQUEST_BODY_BYTES} 字节")
        return self.rfile.read(content_length)

    def _create_connection(self) -> http.client.HTTPConnection:
        connection_class = http.client.HTTPSConnection if self.site.target.scheme == "https" else http.client.HTTPConnection
        return connection_class(self.site.target.hostname, self.site.target.port, timeout=self.site.timeout_seconds)

    def _upstream_headers(self) -> dict[str, str]:
        headers = {name: value for name, value in self.headers.items() if name.lower() not in HOP_BY_HOP_HEADERS | {"host", "cookie", "content-length"}}
        headers["Host"] = self.site.target_host
        origin = headers.get("Origin")
        if origin and (urlsplit(origin).hostname in {"127.0.0.1", "localhost"} or self._is_allowed_cors_origin()):
            headers["Origin"] = self.site.target_origin
        referer = headers.get("Referer")
        if referer:
            parsed_referer = urlsplit(referer)
            if parsed_referer.hostname in {"127.0.0.1", "localhost"} or self._is_allowed_cors_origin():
                headers["Referer"] = urlunsplit((self.site.target.scheme, self.site.target.netloc, parsed_referer.path, parsed_referer.query, ""))
        cookie = self.cookie_store.to_header()
        if cookie:
            headers["Cookie"] = cookie
        content_length = self.headers.get("Content-Length")
        if content_length is not None:
            headers["Content-Length"] = content_length
        return headers

    def _send_response(self, response: http.client.HTTPResponse, response_body: bytes) -> None:
        content_type = response.getheader("Content-Type", "")
        rewritten_body = rewrite_html_urls(response_body, content_type, self.site.target)
        set_cookie_headers = [value for name, value in response.getheaders() if name.lower() == "set-cookie"]
        self.cookie_store.update_from_set_cookie(set_cookie_headers)
        self.send_response(response.status, response.reason)
        for name, value in response.getheaders():
            lower_name = name.lower()
            if lower_name in RESPONSE_HEADERS_TO_SKIP | CORS_RESPONSE_HEADERS | FRAME_RESTRICTION_HEADERS | {"set-cookie"}:
                continue
            if lower_name == "location":
                value = localize_url(value, self.site.target)
            elif lower_name == "content-security-policy":
                value = remove_frame_ancestors(value)
                if not value:
                    continue
            self.send_header(name, value)
        self._send_cors_headers()
        self.send_header("Content-Length", str(len(rewritten_body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(rewritten_body)

    def log_message(self, message: str, *args: object) -> None:
        LOGGER.info("site=%s client=%s %s", self.site.name, self.client_address[0], message % args)


def create_server(site: SiteConfig, cookie_cache_dir: Path = COOKIE_CACHE_DIR) -> ThreadingHTTPServer:
    cache_path = cookie_cache_dir / f"{site.name}.json"
    handler = type(f"{site.name.title()}ProxyHandler", (ProxyRequestHandler,), {"site": site, "cookie_store": SharedCookieStore(cache_path)})
    server = ThreadingHTTPServer(("127.0.0.1", site.listen_port), handler)
    server.daemon_threads = True
    return server


def run_servers(sites: list[SiteConfig]) -> None:
    servers: list[ThreadingHTTPServer] = []
    try:
        for site in sites:
            servers.append(create_server(site))
    except OSError:
        for server in servers:
            server.server_close()
        raise
    threads = [threading.Thread(target=server.serve_forever, name=f"proxy-{site.name}", daemon=True) for server, site in zip(servers, sites)]
    for server, site, thread in zip(servers, sites, threads):
        thread.start()
        LOGGER.info("site=%s listening=http://127.0.0.1:%s target=%s", site.name, site.listen_port, site.target.geturl())
    stop_event = threading.Event()

    def stop_servers(_: int, __: FrameType | None) -> None:
        stop_event.set()

    signal.signal(signal.SIGINT, stop_servers)
    signal.signal(signal.SIGTERM, stop_servers)
    stop_event.wait()
    for server in servers:
        server.shutdown()
        server.server_close()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="本地多站点反向代理")
    parser.add_argument("--config", type=Path, default=Path(__file__).with_name("proxy-sites.json"), help="站点配置 JSON 路径")
    parser.add_argument("--log-level", choices=("DEBUG", "INFO", "WARNING", "ERROR"), default="INFO")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    logging.basicConfig(level=args.log_level, format="%(asctime)s %(levelname)s %(message)s")
    try:
        run_servers(load_sites(args.config))
    except (OSError, ValueError, json.JSONDecodeError) as error:
        LOGGER.error("启动失败: %s", error)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
