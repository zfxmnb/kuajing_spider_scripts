// ==UserScript==
// @name         temu_faker
// @namespace    http://tampermonkey.net/
// @version      2024-06-15
// @description  try to take over the world!
// @author       You
// @match        https://agentseller.temu.com/*
// @exclude      *iframe*
// @run-at       document-end
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @require      https://gh-proxy.com/https://raw.githubusercontent.com/zfxmnb/kuajing_spider_scripts/refs/heads/main/scripts/core/temu_faker.core.js
// ==/UserScript==

// 代理
// https://gh-proxy.com/$GITHUB_URL
// https://ghfast.top/$GITHUB_URL
(async function() {
    temu_faker_core();
})();
