# kuajing_spider_scripts

## 本地站点代理

`service/proxy_server.py` 将固定的上游站点映射为本地回环地址，供本地页面以同源方式加载。它只允许配置文件中的目标站点，不能作为任意 URL 的开放代理。

```bash
cp service/proxy-sites.example.json service/proxy-sites.json
python3 service/proxy_server.py --config service/proxy-sites.json
```

```bash
cat << EOF > ~/Desktop/start_proxy.command
#!/bin/zsh

# 自动填入当前项目的绝对路径
cd "$(pwd)" || exit 1

# 自动激活虚拟环境（如果存在）
if [ -f ".venv/bin/activate" ]; then
  source .venv/bin/activate
elif [ -f "venv/bin/activate" ]; then
  source venv/bin/activate
fi

echo "正在启动代理服务..."
python3 service/proxy_server.py --config service/proxy-sites.json
EOF

chmod +x ~/Desktop/start_proxy.command
```

示例配置会启动以下映射：

| 本地地址 | 上游站点 |
| --- | --- |
| `http://127.0.0.1:2001` | `https://www.baidu.com` |
| `http://127.0.0.1:2002` | `https://www.google.com` |

每个代理服务维护独立的 Cookie 缓存，所有访问该端口的浏览器共享同一份 Cookie。缓存存储在 `service/.runtime/cookies/<site>.json`，服务启动时自动恢复；浏览器请求携带的 Cookie 会被忽略，上游返回的 `Set-Cookie` 只更新服务缓存，不会透传到 `127.0.0.1` 页面。运行态目录已 Git 忽略，目录权限为 `0700`、缓存文件权限为 `0600`。

手工写入 Cookie 使用同端口的仅写入接口；该接口没有读取能力，Cookie 也不会写入配置、仓库或日志：

```bash
curl --request PUT http://127.0.0.1:2001/__local_proxy/cookie \
  --header 'Content-Type: application/json' \
  --data '{"cookie":"手工复制的 Cookie"}'
```

该接口会原子覆盖该端口原有的 Cookie 缓存。传入空字符串会清空缓存。HTML 内指向同一上游的绝对 URL 和同源重定向会改写为本地路径，第三方地址保持不变。

### 跨浏览器共享本地存储

每个代理端口都提供独立的共享键值缓存，无需配置白名单。接口为 `GET /__local_proxy/storage?key=<key>` 与 `PUT /__local_proxy/storage`（请求体为 `{"key":"...","value":"..."}`），每个端口总容量限制为 `5 MiB`，接近常见浏览器 `localStorage` 配额。缓存与 Cookie 缓存一样使用站点隔离、原子写入和 `0700`/`0600` 权限。

`common_plugin` 会在优一的本地代理页自动同步 `__prev_ck__` 与 `__youyi_sku_fnsku_map_v1__`。

### 赛盈库存查询

赛盈代理端口提供只读库存解析接口：

```text
GET /__local_proxy/saleyee/stock?skuId=66267279&warehouseId=123&province=NJ
```

服务会请求 `/item/<skuId>.html?warehouseId=<warehouseId>`，解析页面 `.hideDefaultSkuData` 中与请求仓库匹配的 `WarehouseSendAddressList[].StockItemList`，并返回页面原始商品字段 `ProductName`、`Sku`、`SPU`、`Spec`、`IsAllowUsePlatformWarehouseDesc`、`IsAllowUsePlatformWarehouse` 及 `StockItemList`。`StockItemList` 会过滤非正数量项。可选入参 `province` 接受美国州或 DC 的两位代码，服务以州级内部代表点通过 Haversine 公式估算距离，按距离升序排序；同距离时再将 `PlatformStockAbbr` 或 `ShipAddressDetail` 与退货仓库 `AddressList` 匹配的库存项稳定排在前面。未传 `province` 时保持退货仓库优先排序。外层 `DiscountPrice`、`Price`、`LogisticsProductName` 优先取 `ProductDetailRegionLogisticsProductList[].ProductDetailLogisticsProductList` 中的 `Self-Pick up`，无可用价格时兜底 `Standard Shipping`、`Standard Logistics` 或 `标准物流`；该物流结构不存在时兼容回退库存项。外层 `Qty` 为全部 `StockItemList[].Qty` 的数值累加。每个 `StockItemList` 项仅含 `PlatformStockAbbr`、`Qty`、`ShipAddressDetail`、`StockProvince`、`StockCity`、`StockPostCode`、`Tel`。`WarehouseReturnAddressList` 每项仅返回 `WarehouseName`、`AddressList`。

### SKU 映射

每个代理端口均提供映射接口。映射在服务启动时从对应站点的 `sku-mappings/<site>.json` 读入内存，后续 GET 仅读取内存；PUT 接收单条映射并由服务端原子合并后持久化。不同端口的映射独立存储。

```text
PUT /__local_proxy/sku-mapping
Content-Type: application/json

{"TEMU-SKU-1":"SALE-YEE-1","TEMU-SKU-2":"SALE-YEE-2"}

GET /__local_proxy/sku-mapping
GET /__local_proxy/sku-mapping?sku=TEMU-SKU-1,TEMU-SKU-2
```

PUT 和 GET 均直接返回 JSON Map，例如 `{"TEMU-SKU-1":"SALE-YEE-1"}`。GET 的 `sku` 参数支持逗号分隔多个值。

运行检查：

```bash
cd service && python3 -m unittest -v
```
