import http.client
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from stat import S_IMODE
from tempfile import TemporaryDirectory
from unittest.mock import patch
from urllib.parse import urlsplit

from proxy_server import COOKIE_ENDPOINT, MAX_SHARED_STORAGE_BYTES, SALEYEE_STOCK_ENDPOINT, SKU_MAPPING_ENDPOINT, STORAGE_ENDPOINT, SharedCookieStore, SharedStorageStore, SiteConfig, SkuMappingStore, create_server, get_saleyee_logistics_product_items, get_saleyee_preferred_logistics_prices, get_saleyee_return_warehouse_items, get_saleyee_stock_items, get_saleyee_stock_quantity, load_sites, localize_url, parse_saleyee_product_data, remove_frame_ancestors, rewrite_html_urls


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
            cache_dir = Path(directory)
            server = create_server(site, cache_dir / "cookies", cache_dir / "storage", cache_dir / "sku-mappings")
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

    def test_shared_storage_endpoint_accepts_any_key(self) -> None:
        with TemporaryDirectory() as directory:
            site = SiteConfig("test", 0, urlsplit("https://example.com"), 30)
            cache_dir = Path(directory)
            server = create_server(site, cache_dir / "cookies", cache_dir / "storage", cache_dir / "sku-mappings")
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=5)
                request_body = json.dumps({"key": "__prev_ck__", "value": "2"}).encode("utf-8")
                connection.request("PUT", STORAGE_ENDPOINT, request_body, {"Content-Type": "application/json"})
                response = connection.getresponse()
                self.assertEqual(response.status, 204)
                response.read()
                connection.request("GET", f"{STORAGE_ENDPOINT}?key=__prev_ck__")
                response = connection.getresponse()
                self.assertEqual(response.status, 200)
                self.assertEqual(json.loads(response.read()), {"value": "2"})
                connection.request("GET", f"{STORAGE_ENDPOINT}?key=__other_key__")
                response = connection.getresponse()
                self.assertEqual(response.status, 200)
                self.assertEqual(json.loads(response.read()), {"value": None})
                connection.close()
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def test_shared_storage_store_limits_total_size(self) -> None:
        with TemporaryDirectory() as directory:
            storage_store = SharedStorageStore(Path(directory) / "storage.json")
            with self.assertRaisesRegex(ValueError, "5 MiB"):
                storage_store.set("large", "x" * MAX_SHARED_STORAGE_BYTES)

    def test_shared_storage_store_keeps_memory_unchanged_when_persist_fails(self) -> None:
        with TemporaryDirectory() as directory:
            storage_store = SharedStorageStore(Path(directory) / "storage.json")
            with patch.object(storage_store, "_persist", side_effect=OSError("disk failure")):
                with self.assertRaisesRegex(OSError, "disk failure"):
                    storage_store.set("key", "value")
            self.assertIsNone(storage_store.get("key"))

    def test_sku_mapping_store_restores_persisted_mappings(self) -> None:
        with TemporaryDirectory() as directory:
            cache_path = Path(directory) / "sku-mappings" / "saleyee.json"
            mapping_store = SkuMappingStore(cache_path)
            mapping_store.set("TEMU-SKU-1", "SALE-YEE-1")
            mapping_store.set("TEMU-SKU-2", "SALE-YEE-2")
            restored_store = SkuMappingStore(cache_path)
            self.assertEqual(restored_store.get_all(), {"TEMU-SKU-1": "SALE-YEE-1", "TEMU-SKU-2": "SALE-YEE-2"})
            self.assertEqual(restored_store.get("TEMU-SKU-1"), "SALE-YEE-1")

    def test_parse_saleyee_product_data(self) -> None:
        body = b'<div class="hideDefaultSkuData">{"WarehouseSendAddressList":[{"WarehouseId":123,"StockItemList":[{"Qty":5}]}]}</div>'
        actual = parse_saleyee_product_data(body, "text/html; charset=utf-8")
        self.assertEqual(actual["WarehouseSendAddressList"][0]["StockItemList"][0]["Qty"], 5)

    def test_get_saleyee_stock_items_returns_only_expected_fields(self) -> None:
        product_data = {
            "WarehouseSendAddressList": [
                {
                    "WarehouseId": 123,
                    "StockItemList": [
                        {"PlatformStockAbbr": "USW-1", "Qty": 5, "ShipAddressDetail": "CA Example", "StockProvince": "CA", "StockCity": "Los Angeles", "StockPostCode": "90001", "Tel": "123456"},
                        {"PlatformStockAbbr": "USE-1", "Qty": 3, "ShipAddressDetail": "NJ Example"},
                        {"PlatformStockAbbr": "USC-1", "Qty": 0, "ShipAddressDetail": "TX Example"},
                    ],
                }
            ],
            "WarehouseReturnAddressList": [{"AddressList": ["use-1"]}],
        }
        self.assertEqual(
            get_saleyee_stock_items(product_data, "123"),
            [
                {"PlatformStockAbbr": "USE-1", "Qty": 3, "ShipAddressDetail": "NJ Example", "StockProvince": None, "StockCity": None, "StockPostCode": None, "Tel": None},
                {"PlatformStockAbbr": "USW-1", "Qty": 5, "ShipAddressDetail": "CA Example", "StockProvince": "CA", "StockCity": "Los Angeles", "StockPostCode": "90001", "Tel": "123456"},
            ],
        )

    def test_saleyee_stock_items_are_sorted_by_province_distance(self) -> None:
        product_data = {
            "WarehouseSendAddressList": [
                {
                    "WarehouseId": 123,
                    "StockItemList": [
                        {"PlatformStockAbbr": "USW-1", "Qty": 1, "StockProvince": "CA"},
                        {"PlatformStockAbbr": "USP-1", "Qty": 1, "StockProvince": "PA"},
                        {"PlatformStockAbbr": "USE-1", "Qty": 1, "StockProvince": "NJ"},
                        {"PlatformStockAbbr": "UNKNOWN", "Qty": 1, "StockProvince": "XX"},
                    ],
                }
            ],
            "WarehouseReturnAddressList": [{"AddressList": ["USW-1"]}],
        }
        stock_items = get_saleyee_stock_items(product_data, "123", "NJ")
        self.assertEqual([item["PlatformStockAbbr"] for item in stock_items], ["USE-1", "USP-1", "USW-1", "UNKNOWN"])

    def test_saleyee_self_pickup_prices_and_quantity(self) -> None:
        product_data = {
            "WarehouseSendAddressList": [
                {
                    "WarehouseId": 123,
                    "StockItemList": [
                        {"LogisticsProductName": "Express", "Price": 8, "DiscountPrice": 6, "Qty": 5},
                        {"LogisticsProductName": "Self-Pick up", "Price": 10, "DiscountPrice": 7, "Qty": "3"},
                    ],
                }
            ]
        }
        stock_items = get_saleyee_stock_items(product_data, "123")
        self.assertEqual(
            get_saleyee_preferred_logistics_prices(product_data, "123"),
            {"DiscountPrice": 7, "Price": 10, "LogisticsProductName": "Self-Pick up"},
        )
        self.assertEqual(get_saleyee_stock_quantity(stock_items), 8)

    def test_saleyee_prices_fall_back_to_standard_logistics(self) -> None:
        product_data = {
            "WarehouseSendAddressList": [
                {
                    "WarehouseId": 123,
                    "StockItemList": [
                        {"LogisticsProductName": "Express", "Price": 8, "DiscountPrice": 6},
                        {"LogisticsProductName": "Standard Shipping", "Price": 10, "DiscountPrice": 7},
                    ],
                }
            ]
        }
        self.assertEqual(
            get_saleyee_preferred_logistics_prices(product_data, "123"),
            {"DiscountPrice": 7, "Price": 10, "LogisticsProductName": "Standard Shipping"},
        )

    def test_saleyee_prices_prefer_product_detail_logistics(self) -> None:
        product_data = {
            "ProductDetailRegionLogisticsProductList": [
                {
                    "ProductDetailLogisticsProductList": [
                        {"LogisticsProductName": "Self-Pick up", "Price": 12, "DiscountPrice": 9}
                    ]
                }
            ],
            "WarehouseSendAddressList": [
                {
                    "WarehouseId": 123,
                    "StockItemList": [
                        {"LogisticsProductName": "Self-Pick up", "Price": 10, "DiscountPrice": 7}
                    ],
                }
            ],
        }
        self.assertEqual(
            get_saleyee_logistics_product_items(product_data),
            [{"LogisticsProductName": "Self-Pick up", "Price": 12, "DiscountPrice": 9}],
        )
        self.assertEqual(
            get_saleyee_preferred_logistics_prices(product_data, "123"),
            {"DiscountPrice": 9, "Price": 12, "LogisticsProductName": "Self-Pick up"},
        )

    def test_saleyee_return_warehouse_items_returns_only_expected_fields(self) -> None:
        product_data = {
            "WarehouseReturnAddressList": [
                {
                    "WarehouseName": "USE-1",
                    "AddressList": ["NJ Example"],
                    "Telephone": "secret",
                }
            ]
        }
        self.assertEqual(
            get_saleyee_return_warehouse_items(product_data),
            [{"WarehouseName": "USE-1", "AddressList": ["NJ Example"]}],
        )

    def test_saleyee_stock_endpoint_returns_parsed_product_data(self) -> None:
        class UpstreamHandler(BaseHTTPRequestHandler):
            received_path = ""
            received_accept_encoding = ""

            def do_GET(self) -> None:
                type(self).received_path = self.path
                type(self).received_accept_encoding = self.headers.get("Accept-Encoding", "")
                response_body = b'<div class="hideDefaultSkuData">{"ProductName":"Product title","Sku":"SKU-001","SPU":"SPU-001","Spec":"Red / M","IsAllowUsePlatformWarehouseDesc":"Allowed","IsAllowUsePlatformWarehouse":true,"ProductDetailRegionLogisticsProductList":[{"ProductDetailLogisticsProductList":[{"LogisticsProductName":"Self-Pick up","Price":12,"DiscountPrice":9}]}],"WarehouseSendAddressList":[{"WarehouseId":123,"StockItemList":[{"LogisticsProductName":"Self-Pick up","Price":10,"DiscountPrice":7,"Qty":5},{"Qty":3}]}],"WarehouseReturnAddressList":[{"WarehouseName":"USE-1","AddressList":["NJ Example"]}]}</div>'
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(response_body)))
                self.end_headers()
                self.wfile.write(response_body)

            def log_message(self, _: str, *__: object) -> None:
                return

        upstream_server = ThreadingHTTPServer(("127.0.0.1", 0), UpstreamHandler)
        upstream_thread = threading.Thread(target=upstream_server.serve_forever, daemon=True)
        upstream_thread.start()
        target = urlsplit(f"http://127.0.0.1:{upstream_server.server_port}")
        with TemporaryDirectory() as directory:
            cache_dir = Path(directory)
            proxy_server = create_server(SiteConfig("saleyee", 0, target, 30), cache_dir / "cookies", cache_dir / "storage", cache_dir / "sku-mappings")
            proxy_thread = threading.Thread(target=proxy_server.serve_forever, daemon=True)
            proxy_thread.start()
            try:
                connection = http.client.HTTPConnection("127.0.0.1", proxy_server.server_port, timeout=5)
                connection.request("GET", f"{SALEYEE_STOCK_ENDPOINT}?skuId=66267279&warehouseId=123")
                response = connection.getresponse()
                self.assertEqual(response.status, 200)
                self.assertEqual(
                    json.loads(response.read()),
                    {
                        "ProductName": "Product title",
                        "Sku": "SKU-001",
                        "SPU": "SPU-001",
                        "Spec": "Red / M",
                        "IsAllowUsePlatformWarehouseDesc": "Allowed",
                        "IsAllowUsePlatformWarehouse": True,
                        "DiscountPrice": 9,
                        "Price": 12,
                        "LogisticsProductName": "Self-Pick up",
                        "Qty": 8,
                        "StockItemList": [
                            {"PlatformStockAbbr": None, "Qty": 5, "ShipAddressDetail": None, "StockProvince": None, "StockCity": None, "StockPostCode": None, "Tel": None},
                            {"PlatformStockAbbr": None, "Qty": 3, "ShipAddressDetail": None, "StockProvince": None, "StockCity": None, "StockPostCode": None, "Tel": None},
                        ],
                        "WarehouseReturnAddressList": [
                            {"WarehouseName": "USE-1", "AddressList": ["NJ Example"]}
                        ],
                    },
                )
                self.assertEqual(UpstreamHandler.received_path, "/item/66267279.html?warehouseId=123")
                self.assertEqual(UpstreamHandler.received_accept_encoding, "identity")
                connection.close()
            finally:
                proxy_server.shutdown()
                proxy_server.server_close()
                proxy_thread.join(timeout=5)
                upstream_server.shutdown()
                upstream_server.server_close()
                upstream_thread.join(timeout=5)

    def test_sku_mapping_endpoint_merges_and_filters_mappings(self) -> None:
        with TemporaryDirectory() as directory:
            cache_dir = Path(directory)
            server = create_server(
                SiteConfig("site2002", 0, urlsplit("https://example.com"), 30),
                cache_dir / "cookies",
                cache_dir / "storage",
                cache_dir / "sku-mappings",
            )
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=5)
                headers = {"Content-Type": "application/json", "Origin": "https://agentseller.temu.com"}
                connection.request("PUT", SKU_MAPPING_ENDPOINT, json.dumps({"TEMU-SKU-1": "SALE-YEE-1"}).encode("utf-8"), headers)
                response = connection.getresponse()
                self.assertEqual(response.status, 200)
                self.assertEqual(response.getheader("Access-Control-Allow-Origin"), "https://agentseller.temu.com")
                self.assertEqual(json.loads(response.read()), {"TEMU-SKU-1": "SALE-YEE-1"})
                connection.request("GET", SKU_MAPPING_ENDPOINT, headers={"Origin": "https://www.saleyee.com"})
                response = connection.getresponse()
                self.assertEqual(response.status, 200)
                self.assertEqual(response.getheader("Access-Control-Allow-Origin"), "https://www.saleyee.com")
                response.read()
                connection.request("PUT", SKU_MAPPING_ENDPOINT, json.dumps({"TEMU-SKU-2": "SALE-YEE-2"}).encode("utf-8"), headers)
                response = connection.getresponse()
                self.assertEqual(response.status, 200)
                response.read()
                connection.request("PUT", SKU_MAPPING_ENDPOINT, json.dumps({"TEMU-SKU-3": "SALE-YEE-3", "TEMU-SKU-4": "SALE-YEE-4"}).encode("utf-8"), headers)
                response = connection.getresponse()
                self.assertEqual(response.status, 200)
                self.assertEqual(json.loads(response.read()), {"TEMU-SKU-3": "SALE-YEE-3", "TEMU-SKU-4": "SALE-YEE-4"})
                connection.request("GET", SKU_MAPPING_ENDPOINT)
                response = connection.getresponse()
                self.assertEqual(response.status, 200)
                self.assertEqual(json.loads(response.read()), {"TEMU-SKU-1": "SALE-YEE-1", "TEMU-SKU-2": "SALE-YEE-2", "TEMU-SKU-3": "SALE-YEE-3", "TEMU-SKU-4": "SALE-YEE-4"})
                connection.request("GET", f"{SKU_MAPPING_ENDPOINT}?sku=TEMU-SKU-1,TEMU-SKU-2")
                response = connection.getresponse()
                self.assertEqual(response.status, 200)
                self.assertEqual(json.loads(response.read()), {"TEMU-SKU-1": "SALE-YEE-1", "TEMU-SKU-2": "SALE-YEE-2"})
                connection.request(
                    "OPTIONS",
                    SKU_MAPPING_ENDPOINT,
                    headers={
                        "Origin": "https://agentseller.temu.com",
                        "Access-Control-Request-Method": "PUT",
                    },
                )
                response = connection.getresponse()
                self.assertEqual(response.status, 204)
                self.assertIn("PUT", response.getheader("Access-Control-Allow-Methods", ""))
                response.read()
                connection.close()
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def test_cors_preflight_only_allows_temu_management_origin(self) -> None:
        with TemporaryDirectory() as directory:
            cache_dir = Path(directory)
            server = create_server(SiteConfig("test", 0, urlsplit("https://example.com"), 30), cache_dir / "cookies", cache_dir / "storage", cache_dir / "sku-mappings")
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

    def test_upstream_connection_failure_returns_standard_502_response(self) -> None:
        with TemporaryDirectory() as directory:
            cache_dir = Path(directory)
            server = create_server(SiteConfig("test", 0, urlsplit("http://127.0.0.1:1"), 30), cache_dir / "cookies", cache_dir / "storage", cache_dir / "sku-mappings")
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=5)
                connection.request("GET", "/")
                response = connection.getresponse()
                self.assertEqual(response.status, 502)
                self.assertEqual(response.reason, "Bad Gateway")
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
            cache_dir = Path(directory)
            proxy_server = create_server(SiteConfig("test", 0, target, 30), cache_dir / "cookies", cache_dir / "storage", cache_dir / "sku-mappings")
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

    def test_rewrite_html_urls_keeps_same_origin_links_on_proxy(self) -> None:
        body = b'<a href="https://www.baidu.com/search">search</a><a href="//www.baidu.com/login">login</a><img src="https://example.com/image.png">'
        actual = rewrite_html_urls(body, "text/html; charset=utf-8", self.target)
        self.assertEqual(actual, b'<a href="/search">search</a><a href="/login">login</a><img src="https://example.com/image.png">')

    def test_site_config_keeps_target_host(self) -> None:
        site = SiteConfig("baidu", 1001, self.target, 30)
        self.assertEqual(site.target_host, "www.baidu.com")
        self.assertEqual(site.target_origin, "https://www.baidu.com")


if __name__ == "__main__":
    unittest.main()
