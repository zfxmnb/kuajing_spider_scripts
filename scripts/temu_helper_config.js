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
    window.top._temu_helper_config_map_ = {
        "default": {
            Name: "",
            Port: 5431
        }
    }
})()