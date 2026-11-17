#!/usr/bin/env python3
from __future__ import annotations

import argparse
import html
import http.client
import json
import logging
from math import asin, cos, isfinite, radians, sin, sqrt
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
from urllib.parse import SplitResult, parse_qs, urlsplit, urlunsplit


LOGGER = logging.getLogger("local_reverse_proxy")
MAX_REQUEST_BODY_BYTES: Final = 10 * 1024 * 1024
MAX_RESPONSE_BODY_BYTES: Final = 50 * 1024 * 1024
MAX_COOKIE_HEADER_BYTES: Final = 64 * 1024
DEFAULT_TIMEOUT_SECONDS: Final = 30
HOP_BY_HOP_HEADERS: Final = frozenset({"connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"})
RESPONSE_HEADERS_TO_SKIP: Final = HOP_BY_HOP_HEADERS | frozenset({"content-length"})
HTML_CONTENT_TYPES: Final = ("text/html", "application/xhtml+xml")
COOKIE_ENDPOINT: Final = "/__local_proxy/cookie"
STORAGE_ENDPOINT: Final = "/__local_proxy/storage"
SALEYEE_STOCK_ENDPOINT: Final = "/__local_proxy/saleyee/stock"
SKU_MAPPING_ENDPOINT: Final = "/__local_proxy/sku-mapping"
SALEYEE_SELF_PICKUP_LOGISTICS_PRODUCT_NAME: Final = "Self-Pick up"
SALEYEE_STANDARD_LOGISTICS_PRODUCT_NAMES: Final = frozenset({"Standard Shipping", "Standard Logistics", "标准物流"})
EARTH_RADIUS_KM: Final = 6371.0088
US_STATE_COORDINATES: Final = {
    "AL": (32.739579, -86.843447), "AK": (63.347356, -152.839733), "AZ": (34.203936, -111.606345), "AR": (34.895526, -92.444626), "CA": (37.155177, -119.543418), "CO": (38.993767, -105.508712), "CT": (41.579864, -72.746657), "DE": (38.998566, -75.441644), "DC": (38.904247, -77.016517), "FL": (28.398978, -82.514300), "GA": (32.629579, -83.423511), "HI": (19.828167, -155.495042), "ID": (44.348422, -114.558854), "IL": (40.102875, -89.152611), "IN": (39.901314, -86.291913), "IA": (42.070024, -93.493347), "KS": (38.498546, -98.383430), "KY": (37.533684, -85.292980), "LA": (30.708319, -91.604621), "ME": (45.409284, -68.666616), "MD": (38.946658, -76.674494), "MA": (42.156520, -71.489592), "MI": (44.844177, -85.660491), "MN": (46.315957, -94.199604), "MS": (32.686471, -89.656138), "MO": (38.350750, -92.456783), "MT": (47.051177, -109.634817), "NE": (41.543305, -99.811865), "NV": (39.331093, -116.615147), "NH": (43.672794, -71.584189), "NJ": (40.107274, -74.665201), "NM": (34.434684, -106.131618), "NY": (42.913397, -75.596272), "NC": (35.539710, -79.130864), "ND": (47.442174, -100.460826), "OH": (40.414930, -82.711997), "OK": (35.590081, -97.486779), "OR": (43.971712, -120.622958), "PA": (40.904604, -77.827523), "RI": (41.596485, -71.526490), "SC": (33.874178, -80.854264), "SD": (44.446796, -100.238176), "TN": (35.858460, -86.349634), "TX": (31.434703, -99.281824), "UT": (39.334993, -111.656333), "VT": (44.058954, -72.671017), "VA": (37.522251, -78.668194), "WA": (47.407324, -120.575800), "WV": (38.647285, -80.618327), "WI": (44.630907, -89.709392), "WY": (42.989659, -107.544392),
}
COOKIE_HEADER_PATTERN: Final = re.compile(r"^\s*[^=;\s]+\s*=\s*[^;]*\s*(?:;\s*[^=;\s]+\s*=\s*[^;]*\s*)*$")
SALEYEE_PRODUCT_DATA_PATTERN: Final = re.compile(r"<div\b[^>]*\bclass=[\"'][^\"']*\bhideDefaultSkuData\b[^\"']*[\"'][^>]*>(?P<payload>.*?)</div>", re.IGNORECASE | re.DOTALL)
NUMERIC_IDENTIFIER_PATTERN: Final = re.compile(r"^\d{1,20}$")
COOKIE_CACHE_DIR: Final = Path(__file__).with_name(".runtime") / "cookies"
STORAGE_CACHE_DIR: Final = Path(__file__).with_name(".runtime") / "storage"
SKU_MAPPING_CACHE_DIR: Final = Path(__file__).with_name(".runtime") / "sku-mappings"
MAX_SHARED_STORAGE_BYTES: Final = 5 * 1024 * 1024
SKU_MAPPING_STORAGE_KEY: Final = "sku_mapping_v1"
MAX_SKU_MAPPING_FIELD_LENGTH: Final = 512
CORS_ALLOWED_ORIGINS: Final = frozenset({"https://www.saleyee.com", "https://seller.kuajingmaihuo.com", "https://agentseller.temu.com", "https://agentseller-us.temu.com"})
CORS_ALLOWED_METHODS: Final = frozenset({"GET", "HEAD"})
CORS_RESPONSE_HEADERS: Final = frozenset({"access-control-allow-origin", "access-control-allow-methods", "access-control-allow-headers", "access-control-allow-private-network"})
FRAME_RESTRICTION_HEADERS: Final = frozenset({"x-frame-options"})
CLIENT_DISCONNECT_ERRORS: Final = (BrokenPipeError, ConnectionResetError)


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


class SharedStorageStore:
    def __init__(self, cache_path: Path) -> None:
        self._cache_path = cache_path
        self._lock = threading.Lock()
        self._values = self._load()

    @staticmethod
    def _payload_size(values: dict[str, str]) -> int:
        return len(json.dumps({"values": values}, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))

    def _load(self) -> dict[str, str]:
        if not self._cache_path.exists():
            return {}
        try:
            with self._cache_path.open(encoding="utf-8") as cache_file:
                payload = json.load(cache_file)
            values = payload.get("values") if isinstance(payload, dict) else None
            if not isinstance(values, dict) or any(not isinstance(key, str) or not isinstance(value, str) for key, value in values.items()) or self._payload_size(values) > MAX_SHARED_STORAGE_BYTES:
                raise ValueError("缓存内容无效")
            return values
        except (OSError, json.JSONDecodeError, ValueError) as error:
            LOGGER.warning("无法恢复共享存储缓存 file=%s error=%s", self._cache_path.name, error)
            return {}

    def _persist(self, values: dict[str, str]) -> None:
        self._cache_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(self._cache_path.parent, 0o700)
        file_descriptor, temporary_path = tempfile.mkstemp(prefix=f".{self._cache_path.name}.", suffix=".tmp", dir=self._cache_path.parent)
        try:
            os.fchmod(file_descriptor, 0o600)
            with os.fdopen(file_descriptor, "w", encoding="utf-8") as cache_file:
                json.dump({"values": values}, cache_file, ensure_ascii=False, separators=(",", ":"))
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

    def get(self, key: str) -> str | None:
        with self._lock:
            return self._values.get(key)

    def set(self, key: str, value: str) -> None:
        with self._lock:
            values = self._values.copy()
            values[key] = value
            if self._payload_size(values) > MAX_SHARED_STORAGE_BYTES:
                raise ValueError("共享存储超过 5 MiB 限制")
            self._persist(values)
            self._values = values


class SkuMappingStore:
    def __init__(self, cache_path: Path) -> None:
        self._cache_path = cache_path
        self._storage_store = SharedStorageStore(cache_path)
        self._lock = threading.Lock()
        self._mappings = self._load()

    def _load(self) -> dict[str, str]:
        raw_mappings = self._storage_store.get(SKU_MAPPING_STORAGE_KEY)
        if raw_mappings is None:
            return {}
        try:
            mappings = json.loads(raw_mappings)
            if not isinstance(mappings, dict) or any(not isinstance(temu_sku, str) or not isinstance(saleyee_sku, str) for temu_sku, saleyee_sku in mappings.items()):
                raise ValueError("SKU 映射缓存内容无效")
            return mappings
        except (ValueError, json.JSONDecodeError) as error:
            LOGGER.warning("无法恢复 SKU 映射缓存 file=%s error=%s", self._cache_path.name, error)
            return {}

    def get_all(self) -> dict[str, str]:
        with self._lock:
            return self._mappings.copy()

    def get(self, temu_sku: str) -> str | None:
        with self._lock:
            return self._mappings.get(temu_sku)

    def set(self, temu_sku: str, saleyee_sku: str) -> None:
        self.set_many({temu_sku: saleyee_sku})

    def set_many(self, mappings_to_update: dict[str, str]) -> None:
        with self._lock:
            mappings = self._mappings.copy()
            mappings.update(mappings_to_update)
            serialized_mappings = json.dumps(mappings, ensure_ascii=False, separators=(",", ":"))
            self._storage_store.set(SKU_MAPPING_STORAGE_KEY, serialized_mappings)
            self._mappings = mappings


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
    # 同源链接可能使用 http、https 或协议相对地址；全部转为相对路径以保持在本地代理域名。
    target_pattern = rf"(?:https?:)?//{re.escape(target.netloc)}(?=[/?#]|$)"
    return re.sub(target_pattern, "", html, flags=re.IGNORECASE).encode(encoding)


def remove_frame_ancestors(content_security_policy: str) -> str:
    return "; ".join(directive.strip() for directive in content_security_policy.split(";") if directive.strip() and directive.strip().split(None, 1)[0].lower() != "frame-ancestors")


def parse_saleyee_product_data(response_body: bytes, content_type: str) -> dict[str, object]:
    charset_match = re.search(r"charset=([^;\s]+)", content_type, re.IGNORECASE)
    encoding = charset_match.group(1).strip('\"\'') if charset_match else "utf-8"
    try:
        page_html = response_body.decode(encoding)
    except (LookupError, UnicodeDecodeError) as error:
        raise ValueError("商品详情页编码无效") from error
    payload_match = SALEYEE_PRODUCT_DATA_PATTERN.search(page_html)
    if payload_match is None:
        raise ValueError("商品详情页未包含库存数据")
    try:
        payload = json.loads(html.unescape(payload_match.group("payload").strip()))
    except json.JSONDecodeError as error:
        raise ValueError("商品详情页库存数据格式无效") from error
    if not isinstance(payload, dict):
        raise ValueError("商品详情页库存数据格式无效")
    return payload


def get_saleyee_warehouse_stock_items(product_data: dict[str, object], warehouse_id: str) -> list[dict[str, object]]:
    warehouse_list = product_data.get("WarehouseSendAddressList")
    if not isinstance(warehouse_list, list):
        return []
    stock_items: list[dict[str, object]] = []
    for warehouse in warehouse_list:
        if not isinstance(warehouse, dict) or str(warehouse.get("WarehouseId")) != warehouse_id:
            continue
        items = warehouse.get("StockItemList")
        if not isinstance(items, list):
            continue
        for item in items:
            if isinstance(item, dict):
                stock_items.append(item)
    return stock_items


def get_saleyee_return_warehouse_addresses(product_data: dict[str, object]) -> set[str]:
    warehouse_list = product_data.get("WarehouseReturnAddressList")
    if not isinstance(warehouse_list, list):
        return set()
    return_addresses: set[str] = set()
    for warehouse in warehouse_list:
        if not isinstance(warehouse, dict):
            continue
        address_list = warehouse.get("AddressList")
        if not isinstance(address_list, list):
            continue
        return_addresses.update(value.strip().casefold() for value in address_list if isinstance(value, str) and value.strip())
    return return_addresses


def get_saleyee_stock_quantity_value(quantity: object) -> int | float | None:
    if isinstance(quantity, bool):
        return None
    if isinstance(quantity, (int, float)):
        return quantity if isfinite(quantity) else None
    if isinstance(quantity, str):
        normalized_quantity = quantity.strip()
        if re.fullmatch(r"[+-]?\d+", normalized_quantity):
            return int(normalized_quantity)
        try:
            value = float(normalized_quantity)
        except ValueError:
            return None
        return value if isfinite(value) else None
    return None


def has_saleyee_available_stock(item: dict[str, object]) -> bool:
    quantity = get_saleyee_stock_quantity_value(item.get("Qty"))
    return quantity is not None and quantity > 0


def is_saleyee_return_warehouse_stock_item(item: dict[str, object], return_addresses: set[str]) -> bool:
    return any(
        isinstance(value, str) and value.strip().casefold() in return_addresses
        for value in (item.get("PlatformStockAbbr"), item.get("ShipAddressDetail"))
    )


def get_us_state_distance_km(origin_state: str, destination_state: object) -> float | None:
    if not isinstance(destination_state, str):
        return None
    origin_coordinate = US_STATE_COORDINATES.get(origin_state)
    destination_coordinate = US_STATE_COORDINATES.get(destination_state.strip().upper())
    if origin_coordinate is None or destination_coordinate is None:
        return None
    origin_latitude, origin_longitude = (radians(value) for value in origin_coordinate)
    destination_latitude, destination_longitude = (radians(value) for value in destination_coordinate)
    latitude_delta = destination_latitude - origin_latitude
    longitude_delta = destination_longitude - origin_longitude
    haversine = sin(latitude_delta / 2) ** 2 + cos(origin_latitude) * cos(destination_latitude) * sin(longitude_delta / 2) ** 2
    return 2 * EARTH_RADIUS_KM * asin(sqrt(haversine))


def get_saleyee_stock_items(product_data: dict[str, object], warehouse_id: str, province: str | None = None) -> list[dict[str, object]]:
    return_addresses = get_saleyee_return_warehouse_addresses(product_data)
    available_stock_items = [
        item for item in get_saleyee_warehouse_stock_items(product_data, warehouse_id) if has_saleyee_available_stock(item)
    ]
    if province is None:
        available_stock_items.sort(key=lambda item: not is_saleyee_return_warehouse_stock_item(item, return_addresses))
    else:
        available_stock_items.sort(
            key=lambda item: (
                (distance := get_us_state_distance_km(province, item.get("StockProvince"))) is None,
                distance if distance is not None else float("inf"),
                not is_saleyee_return_warehouse_stock_item(item, return_addresses),
            )
        )
    return [
        {
            "PlatformStockAbbr": item.get("PlatformStockAbbr"),
            "Qty": item.get("Qty"),
            "ShipAddressDetail": item.get("ShipAddressDetail"),
            "StockProvince": item.get("StockProvince"),
            "StockCity": item.get("StockCity"),
            "StockPostCode": item.get("StockPostCode"),
            "Tel": item.get("Tel"),
        }
        for item in available_stock_items
    ]


def get_saleyee_logistics_product_items(product_data: dict[str, object]) -> list[dict[str, object]]:
    region_list = product_data.get("ProductDetailRegionLogisticsProductList")
    if not isinstance(region_list, list):
        return []
    logistics_product_items: list[dict[str, object]] = []
    for region in region_list:
        if not isinstance(region, dict):
            continue
        product_list = region.get("ProductDetailLogisticsProductList")
        if not isinstance(product_list, list):
            continue
        logistics_product_items.extend(item for item in product_list if isinstance(item, dict))
    return logistics_product_items


def get_saleyee_preferred_logistics_prices(product_data: dict[str, object], warehouse_id: str) -> dict[str, object]:
    fallback_price: dict[str, object] | None = None
    logistics_product_items = get_saleyee_logistics_product_items(product_data)
    for item in logistics_product_items or get_saleyee_warehouse_stock_items(product_data, warehouse_id):
        logistics_product_name = item.get("LogisticsProductName")
        price = {
            "DiscountPrice": item.get("DiscountPrice"),
            "Price": item.get("Price"),
            "LogisticsProductName": logistics_product_name,
        }
        has_available_price = price["DiscountPrice"] is not None or price["Price"] is not None
        if logistics_product_name == SALEYEE_SELF_PICKUP_LOGISTICS_PRODUCT_NAME and has_available_price:
            return price
        if fallback_price is None and isinstance(logistics_product_name, str) and logistics_product_name in SALEYEE_STANDARD_LOGISTICS_PRODUCT_NAMES and has_available_price:
            fallback_price = price
    return fallback_price or {"DiscountPrice": None, "Price": None, "LogisticsProductName": None}


def get_saleyee_stock_quantity(stock_items: list[dict[str, object]]) -> int | float:
    quantity: int | float = 0
    for stock_item in stock_items:
        value = get_saleyee_stock_quantity_value(stock_item.get("Qty"))
        if value is not None:
            quantity += value
    return quantity


def get_saleyee_return_warehouse_items(product_data: dict[str, object]) -> list[dict[str, object]]:
    warehouse_list = product_data.get("WarehouseReturnAddressList")
    if not isinstance(warehouse_list, list):
        return []
    return [
        {
            "WarehouseName": warehouse.get("WarehouseName"),
            "AddressList": warehouse.get("AddressList"),
        }
        for warehouse in warehouse_list
        if isinstance(warehouse, dict)
    ]


class ProxyRequestHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    site: SiteConfig
    cookie_store: SharedCookieStore
    storage_store: SharedStorageStore
    sku_mapping_store: SkuMappingStore

    def handle(self) -> None:
        try:
            super().handle()
        except CLIENT_DISCONNECT_ERRORS:
            self._log_client_disconnect()

    def do_GET(self) -> None:
        if self._is_storage_endpoint():
            self._get_shared_storage()
            return
        if self._is_saleyee_stock_endpoint():
            self._get_saleyee_stock()
            return
        if self._is_sku_mapping_endpoint():
            self._get_sku_mapping()
            return
        self._proxy()

    def do_POST(self) -> None:
        self._proxy()

    def do_PUT(self) -> None:
        if self._is_cookie_endpoint():
            self._replace_cookie()
            return
        if self._is_storage_endpoint():
            self._set_shared_storage()
            return
        if self._is_sku_mapping_endpoint():
            self._set_sku_mapping()
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

    def _is_storage_endpoint(self) -> bool:
        return urlsplit(self.path).path == STORAGE_ENDPOINT

    def _is_saleyee_stock_endpoint(self) -> bool:
        return self.site.name == "saleyee" and urlsplit(self.path).path == SALEYEE_STOCK_ENDPOINT

    def _is_sku_mapping_endpoint(self) -> bool:
        return urlsplit(self.path).path == SKU_MAPPING_ENDPOINT

    def _is_allowed_cors_origin(self) -> bool:
        return self.headers.get("Origin") in CORS_ALLOWED_ORIGINS

    def _is_cors_preflight(self) -> bool:
        return self._is_allowed_cors_origin() and self.headers.get("Access-Control-Request-Method", "").upper() in self._cors_allowed_methods()

    def _cors_allowed_methods(self) -> frozenset[str]:
        if self._is_sku_mapping_endpoint():
            return CORS_ALLOWED_METHODS | frozenset({"PUT"})
        return CORS_ALLOWED_METHODS

    def _send_cors_headers(self) -> None:
        origin = self.headers.get("Origin")
        if not origin or origin not in CORS_ALLOWED_ORIGINS:
            return
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Methods", ", ".join(sorted(self._cors_allowed_methods())))
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
            LOGGER.warning("Cookie 写入请求无效 site=%s error=%s", self.site.name, error)
            self._send_proxy_error(HTTPStatus.BAD_REQUEST)
        except CLIENT_DISCONNECT_ERRORS:
            self._log_client_disconnect()
        except OSError:
            LOGGER.error("Cookie 缓存写入失败 site=%s", self.site.name)
            self._send_proxy_error(HTTPStatus.INTERNAL_SERVER_ERROR)

    def _get_shared_storage(self) -> None:
        try:
            query = parse_qs(urlsplit(self.path).query, keep_blank_values=True)
            if set(query) != {"key"} or len(query["key"]) != 1:
                raise ValueError("请求参数必须为 key")
            value = self.storage_store.get(query["key"][0])
            response_body = json.dumps({"value": value}, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(response_body)))
            self.end_headers()
            self.wfile.write(response_body)
        except ValueError as error:
            LOGGER.warning("共享存储读取请求无效 site=%s error=%s", self.site.name, error)
            self._send_proxy_error(HTTPStatus.NOT_FOUND)
        except CLIENT_DISCONNECT_ERRORS:
            self._log_client_disconnect()

    def _set_shared_storage(self) -> None:
        try:
            request_body = self._read_request_body()
            if request_body is None:
                raise ValueError("缺少请求体")
            payload = json.loads(request_body)
            if not isinstance(payload, dict) or set(payload) != {"key", "value"} or not isinstance(payload["key"], str) or not isinstance(payload["value"], str):
                raise ValueError('请求体必须为 {"key":"...","value":"..."}')
            self.storage_store.set(payload["key"], payload["value"])
            self.send_response(HTTPStatus.NO_CONTENT)
            self.send_header("Content-Length", "0")
            self.end_headers()
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
            LOGGER.warning("共享存储写入请求无效 site=%s error=%s", self.site.name, error)
            self._send_proxy_error(HTTPStatus.BAD_REQUEST)
        except CLIENT_DISCONNECT_ERRORS:
            self._log_client_disconnect()
        except OSError:
            LOGGER.error("共享存储写入失败 site=%s", self.site.name)
            self._send_proxy_error(HTTPStatus.INTERNAL_SERVER_ERROR)

    @staticmethod
    def _normalize_sku_mapping_value(value: object, field_name: str) -> str:
        if not isinstance(value, str):
            raise ValueError(f"{field_name} 必须是字符串")
        normalized_value = value.strip()
        if not normalized_value or len(normalized_value) > MAX_SKU_MAPPING_FIELD_LENGTH:
            raise ValueError(f"{field_name} 长度无效")
        return normalized_value

    @staticmethod
    def _get_sku_mapping_values(value: str) -> list[str]:
        if not isinstance(value, str):
            raise ValueError("sku 必须是字符串")
        raw_skus = value.split(",")
        if not raw_skus:
            raise ValueError("sku 不能为空")
        skus: list[str] = []
        seen_skus: set[str] = set()
        for raw_sku in raw_skus:
            sku = raw_sku.strip()
            if not sku or len(sku) > MAX_SKU_MAPPING_FIELD_LENGTH:
                raise ValueError("sku 长度无效")
            if sku not in seen_skus:
                skus.append(sku)
                seen_skus.add(sku)
        return skus

    def _get_sku_mapping(self) -> None:
        try:
            query = parse_qs(urlsplit(self.path).query, keep_blank_values=True)
            if not set(query).issubset({"sku"}) or any(len(values) != 1 for values in query.values()):
                raise ValueError("请求参数只能为 sku")
            if "sku" not in query:
                mappings = self.sku_mapping_store.get_all()
            else:
                skus = self._get_sku_mapping_values(query["sku"][0])
                mappings = {sku: saleyee_sku for sku in skus if (saleyee_sku := self.sku_mapping_store.get(sku)) is not None}
            self._send_json_response(HTTPStatus.OK, mappings)
        except ValueError as error:
            LOGGER.warning("SKU 映射读取请求无效 error=%s", error)
            self._send_json_response(HTTPStatus.BAD_REQUEST, {"error": "invalid_request"})
        except CLIENT_DISCONNECT_ERRORS:
            self._log_client_disconnect()

    def _set_sku_mapping(self) -> None:
        try:
            request_body = self._read_request_body()
            if request_body is None:
                raise ValueError("缺少请求体")
            payload = json.loads(request_body)
            if not isinstance(payload, dict) or not payload:
                raise ValueError('请求体必须为 {"sku":"targetSku"}')
            mappings_to_update: dict[str, str] = {}
            for raw_sku, raw_target_sku in payload.items():
                sku = self._normalize_sku_mapping_value(raw_sku, "sku")
                if sku in mappings_to_update:
                    raise ValueError("sku 不能重复")
                mappings_to_update[sku] = self._normalize_sku_mapping_value(raw_target_sku, "targetSku")
            self.sku_mapping_store.set_many(mappings_to_update)
            self._send_json_response(HTTPStatus.OK, mappings_to_update)
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
            LOGGER.warning("SKU 映射写入请求无效 error=%s", error)
            self._send_json_response(HTTPStatus.BAD_REQUEST, {"error": "invalid_request"})
        except CLIENT_DISCONNECT_ERRORS:
            self._log_client_disconnect()
        except OSError:
            LOGGER.error("SKU 映射写入失败")
            self._send_json_response(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "storage_error"})

    def _send_json_response(self, status: HTTPStatus, payload: dict[str, object]) -> None:
        response_body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self._send_cors_headers()
        self.send_header("Content-Length", str(len(response_body)))
        self.end_headers()
        self.wfile.write(response_body)

    def _get_saleyee_stock(self) -> None:
        try:
            query = parse_qs(urlsplit(self.path).query, keep_blank_values=True)
            if not {"skuId", "warehouseId"}.issubset(query) or not set(query).issubset({"skuId", "warehouseId", "province"}) or any(len(query[key]) != 1 or not NUMERIC_IDENTIFIER_PATTERN.fullmatch(query[key][0]) for key in ("skuId", "warehouseId")):
                raise ValueError("请求参数必须包含数字 skuId 和 warehouseId")
            sku_id = query["skuId"][0]
            warehouse_id = query["warehouseId"][0]
            province = None
            if "province" in query:
                province = query["province"][0].strip().upper()
                if len(query["province"]) != 1 or province not in US_STATE_COORDINATES:
                    raise ValueError("province 必须为美国州或 DC 的两位代码")
        except ValueError as error:
            LOGGER.warning("赛盈库存请求无效 error=%s", error)
            self._send_proxy_error(HTTPStatus.BAD_REQUEST)
            return

        product_path = f"/item/{sku_id}.html?warehouseId={warehouse_id}"
        try:
            upstream = self._create_connection()
            try:
                headers = self._upstream_headers()
                # 解析器需要原始 HTML；浏览器透传的 gzip/br 压缩响应无法直接按页面编码解析。
                headers["Accept-Encoding"] = "identity"
                upstream.request("GET", product_path, headers=headers)
                response = upstream.getresponse()
                response_body = response.read(MAX_RESPONSE_BODY_BYTES + 1)
                if response.status != HTTPStatus.OK or len(response_body) > MAX_RESPONSE_BODY_BYTES:
                    raise OSError("赛盈商品详情页请求失败")
                product_data = parse_saleyee_product_data(response_body, response.getheader("Content-Type", ""))
            finally:
                upstream.close()
        except CLIENT_DISCONNECT_ERRORS:
            self._log_client_disconnect()
            return
        except (OSError, ValueError, http.client.HTTPException) as error:
            LOGGER.warning("赛盈库存解析失败 sku_id=%s warehouse_id=%s error=%s", sku_id, warehouse_id, error)
            self._send_proxy_error(HTTPStatus.BAD_GATEWAY)
            return

        stock_items = get_saleyee_stock_items(product_data, warehouse_id, province)
        response_body = json.dumps(
            {
                "ProductName": product_data.get("ProductName"),
                "Sku": product_data.get("Sku"),
                "SPU": product_data.get("SPU"),
                "Spec": product_data.get("Spec"),
                "IsAllowUsePlatformWarehouseDesc": product_data.get("IsAllowUsePlatformWarehouseDesc"),
                "IsAllowUsePlatformWarehouse": product_data.get("IsAllowUsePlatformWarehouse"),
                **get_saleyee_preferred_logistics_prices(product_data, warehouse_id),
                "Qty": get_saleyee_stock_quantity(stock_items),
                "StockItemList": stock_items,
                "WarehouseReturnAddressList": get_saleyee_return_warehouse_items(product_data),
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
        try:
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(response_body)))
            self.end_headers()
            self.wfile.write(response_body)
        except CLIENT_DISCONNECT_ERRORS:
            self._log_client_disconnect()

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
            finally:
                upstream.close()
        except ValueError as error:
            LOGGER.warning("代理请求无效 site=%s path=%s error=%s", self.site.name, self.path, error)
            self._send_proxy_error(HTTPStatus.BAD_REQUEST)
            return
        except CLIENT_DISCONNECT_ERRORS:
            self._log_client_disconnect()
            return
        except (OSError, http.client.HTTPException) as error:
            LOGGER.warning("上游请求失败 site=%s path=%s error=%s", self.site.name, self.path, error)
            self._send_proxy_error(HTTPStatus.BAD_GATEWAY)
            return

        try:
            self._send_response(response, response_body)
        except CLIENT_DISCONNECT_ERRORS:
            self._log_client_disconnect()
        except OSError as error:
            LOGGER.error("响应处理失败 site=%s path=%s error=%s", self.site.name, self.path, error)
            self._send_proxy_error(HTTPStatus.INTERNAL_SERVER_ERROR)

    def _send_proxy_error(self, status: HTTPStatus) -> None:
        try:
            self.send_error(status)
        except CLIENT_DISCONNECT_ERRORS:
            self._log_client_disconnect()

    def _log_client_disconnect(self) -> None:
        LOGGER.debug("客户端已断开 site=%s client=%s path=%s", self.site.name, self.client_address[0], getattr(self, "path", "-"))

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


def create_server(site: SiteConfig, cookie_cache_dir: Path = COOKIE_CACHE_DIR, storage_cache_dir: Path = STORAGE_CACHE_DIR, sku_mapping_cache_dir: Path = SKU_MAPPING_CACHE_DIR) -> ThreadingHTTPServer:
    cookie_cache_path = cookie_cache_dir / f"{site.name}.json"
    storage_cache_path = storage_cache_dir / f"{site.name}.json"
    handler_attributes: dict[str, object] = {
        "site": site,
        "cookie_store": SharedCookieStore(cookie_cache_path),
        "storage_store": SharedStorageStore(storage_cache_path),
    }
    handler_attributes["sku_mapping_store"] = SkuMappingStore(sku_mapping_cache_dir / f"{site.name}.json")
    handler = type(f"{site.name.title()}ProxyHandler", (ProxyRequestHandler,), handler_attributes)
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
