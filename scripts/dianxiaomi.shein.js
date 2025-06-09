// ==UserScript==
// @name         dianxiaomi_v2
// @namespace    http://tampermonkey.net/
// @version      2025-05-15
// @description  try to take over the world!
// @author       You
// @match        https://www.dianxiaomi.com/sheinProduct/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=google.com
// @grant        none
// @require      https://ghfast.top/https://raw.githubusercontent.com/zfxmnb/kuajing_spider_scripts/refs/heads/main/scripts/core/dianxiaomi.core.shein.js
// @require      https://cdn.bootcdn.net/ajax/libs/jszip/3.10.1/jszip.min.js
// ==/UserScript==

// 代理
// https://gh-proxy.com/$GITHUB_URL
// https://ghfast.top/$GITHUB_URL
(async function() {
    dianxiaomi_shein_core();
})();