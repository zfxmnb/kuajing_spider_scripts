// ==UserScript==
// @name         temu_helper_v2
// @namespace    http://tampermonkey.net/
// @version      2024-06-15
// @description  try to take over the world!
// @author       You
// @match        https://seller.kuajingmaihuo.com/*
// @match        https://agentseller.temu.com/*
// @match        https://agentseller-us.temu.com/*
// @exclude      *iframe*
// @run-at       document-end
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @grant        GM_xmlhttpRequest
// @grant        GM_getResourceURL
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @require      https://cdn.bootcdn.net/ajax/libs/xlsx/0.17.0/xlsx.full.min.js
// @require      https://ghfast.top/https://raw.githubusercontent.com/zfxmnb/kuajing_spider_scripts/refs/heads/main/scripts/core/temu_helper_v2.core.js
// @require      https://ghfast.top/https://raw.githubusercontent.com/zfxmnb/kuajing_spider_scripts/refs/heads/main/scripts/core/fetchInterceptor.core.js
// ==/UserScript==

// 代理
// https://gh-proxy.com/$GITHUB_URL
// https://ghfast.top/$GITHUB_URL
(async function() {
    let fetchInterceptor
    try {
        fetchInterceptor = fetchInterceptorInit();
    } catch (err) {}
    setTimeout(() => {
        temu_helper_v2_core(fetchInterceptor);
    }, 100)
})();
