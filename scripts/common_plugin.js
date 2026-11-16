// ==UserScript==
// @name         common_plugin
// @namespace    http://tampermonkey.net/
// @version      2024-06-15
// @description  try to take over the world!
// @author       You
// @match        https://www.saleyee.com/*
// @match        https://www.gigab2b.com/*
// @match        https://xhl.topwms.com/*
// @match        https://us.goodcang.com/*
// @match        https://oms.goodcang.com/*
// @match        https://cnuser.returnhelper.com.hk/*
// @match        https://cnuser.returnhelper.com/*
// @match        https://oms.xlwms.com/*
// @match        http://www.youyi4pl.com/*
// @match        https://www.youyi4pl.com/*
// @match        http://127.0.0.1:2001/*
// @match        http://127.0.0.1:2002/*
// @match        http://127.0.0.1:2003/*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @require      https://gh-proxy.com/https://raw.githubusercontent.com/zfxmnb/kuajing_spider_scripts/refs/heads/main/scripts/core/common_plugin.core.js
// ==/UserScript==

// 代理
// https://gh-proxy.com/$GITHUB_URL
// https://ghfast.top/$GITHUB_URL
// HTTP 页面读取剪贴板：chrome://flags/#unsafely-treat-insecure-origin-as-secure
// 添加 Origin：http://www.youyi4pl.com
(async function () {
  common_plugin_core();
})();
