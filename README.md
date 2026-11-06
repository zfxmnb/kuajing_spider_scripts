# kuajing_spider_scripts

## 本地站点代理

`service/proxy_server.py` 将固定的上游站点映射为本地回环地址，供本地页面以同源方式加载。它只允许配置文件中的目标站点，不能作为任意 URL 的开放代理。

```bash
cp service/proxy-sites.example.json service/proxy-sites.json
python3 service/proxy_server.py --config service/proxy-sites.json
```

示例配置会启动以下映射：

| 本地地址 | 上游站点 |
| --- | --- |
| `http://127.0.0.1:1001` | `https://www.baidu.com` |
| `http://127.0.0.1:1002` | `https://www.google.com` |

每个代理服务维护独立的 Cookie 缓存，所有访问该端口的浏览器共享同一份 Cookie。缓存存储在 `service/.runtime/cookies/<site>.json`，服务启动时自动恢复；浏览器请求携带的 Cookie 会被忽略，上游返回的 `Set-Cookie` 只更新服务缓存，不会透传到 `127.0.0.1` 页面。运行态目录已 Git 忽略，目录权限为 `0700`、缓存文件权限为 `0600`。

手工写入 Cookie 使用同端口的仅写入接口；该接口没有读取能力，Cookie 也不会写入配置、仓库或日志：

```bash
curl --request PUT http://127.0.0.1:1001/__local_proxy/cookie \
  --header 'Content-Type: application/json' \
  --data '{"cookie":"手工复制的 Cookie"}'
```

该接口会原子覆盖该端口原有的 Cookie 缓存。传入空字符串会清空缓存。HTML 内指向同一上游的绝对 URL 和同源重定向会改写为本地路径，第三方地址保持不变。

运行检查：

```bash
cd service && python3 -m unittest -v
```
