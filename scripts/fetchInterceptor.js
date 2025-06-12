// ==UserScript==
// @name         fetchInterceptor
// @namespace    http://tampermonkey.net/
// @version      2025-06-12
// @description  try to take over the world!
// @author       You
// @match        https://seller.kuajingmaihuo.com/*
// @match        https://agentseller.temu.com/*
// @match        https://agentseller-us.temu.com/*
// @exclude      *iframe*
// @run-at       document-start
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @grant        GM_getResourceURL
// @grant        unsafeWindow
// @require      https://ghfast.top/https://raw.githubusercontent.com/zfxmnb/kuajing_spider_scripts/refs/heads/main/scripts/core/fetchInterceptor.core.js
// ==/UserScript==

// 代理
// https://gh-proxy.com/$GITHUB_URL
// https://ghfast.top/$GITHUB_URL
(async function() {
    try {
        fetchInterceptorInit(unsafeWindow);
    } catch (err) {}
})();
