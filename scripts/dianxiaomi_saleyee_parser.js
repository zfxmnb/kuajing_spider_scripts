// ==UserScript==
// @name         dianxiaomi_saleyee_parser
// @namespace    http://tampermonkey.net/
// @version      2024-06-15
// @description  try to take over the world!
// @author       You
// @match        https://www.saleyee.cn/item/*
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @grant        GM_xmlhttpRequest
// @require      https://ghfast.top/https://raw.githubusercontent.com/zfxmnb/kuajing_spider_scripts/refs/heads/main/scripts/core/dianxiaomi_saleyee_parser.core.js
// ==/UserScript==

// 代理
// https://gh-proxy.com/$GITHUB_URL
// https://ghfast.top/$GITHUB_URL
(async function() {
    dianxiaomi_saleyee_parser_core();
})();