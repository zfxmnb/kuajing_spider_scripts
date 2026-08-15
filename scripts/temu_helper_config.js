// ==UserScript==
// @name         temu_helper_config
// @namespace    http://tampermonkey.net/
// @version      2024-06-15
// @description  try to take over the world!
// @author       You
// @match        https://seller.kuajingmaihuo.com/*
// @match        https://agentseller.temu.com/*
// @match        https://agentseller-us.temu.com/*
// @exclude      *iframe*
// @run-at       document-start
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @grant        none
// ==/UserScript==

(function() {
    /**
     * 配置读取规则：优先使用当前店铺 mallId 对应的配置，找不到时使用 default。
     * mallId 配置不会与 default 自动合并，因此单独配置店铺时请填写该店铺需要的全部参数。
     *
     * 示例：
     * "123456789": {
     *     Name: "美国店",
     *     Host: "127.0.0.1",
     *     Port: 5431,
     *     LocalServiceDisabled: false,
     *     WeComRobotWebhook: ""
     * }
     */
    window.top._temu_helper_config_map_ = {
        "default": {
            // 店铺显示名称：用于企业微信通知标题和本地缓存键；空字符串表示不添加店铺名称。
            Name: "",

            // 本地服务地址，最终请求地址为 http://Host:Port。
            Host: "127.0.0.1",
            Port: 5431,

            // 是否彻底禁止请求上述本地服务。
            // true：商品/订单本地同步、成本利润补充、下载及强制抓取等依赖本地服务的功能不可用。
            //      Temu 平台接口和企业微信 Webhook 不受影响。
            // false：保持原有行为，允许访问本地服务。
            LocalServiceDisabled: false,

            // 企业微信群机器人完整 Webhook 地址，例如：
            // https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
            // 非空：notice 直接发送到企业微信，不经过本地 /api/temu/notice 代理。
            // 为空：notice 继续使用本地代理；若 LocalServiceDisabled 同时为 true，则通知不会发送。
            // Webhook 包含密钥，请勿将真实地址提交到公开仓库。
            WeComRobotWebhook: "",

            // 是否开启调价和限流通知。该功能仅在 AutoDisabled 为 false 时运行；默认 false。
            // PriceAdjustNotice: false,

            // 是否关闭自动商品/订单同步及调价监控；默认 true。
            // true 不会关闭订单、售后、聊天和登录异常等通知轮询。
            // AutoDisabled: true
        }
    }
})()
