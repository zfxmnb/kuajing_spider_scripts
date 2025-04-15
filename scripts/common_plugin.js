// ==UserScript==
// @name         common_plugin
// @namespace    http://tampermonkey.net/
// @version      2024-06-15
// @description  try to take over the world!
// @author       You
// @match        https://www.saleyee.cn/*
// @match        https://www.gigab2b.com/*
// @match        https://xhl.topwms.com/*
// @match        https://us.goodcang.com/*
// @match        https://cnuser.returnhelper.com.hk/*
// @match        https://cnuser.returnhelper.com/*
// @grant        GM_xmlhttpRequest
// @require      https://ghfast.top/https://raw.githubusercontent.com/zfxmnb/kuajing_spider_scripts/refs/heads/main/scripts/core/common_plugin.core.js
// ==/UserScript==

// 代理
// https://gh-proxy.com/$GITHUB_URL
// https://ghfast.top/$GITHUB_URL
(async function() {
    common_plugin_core();
})();