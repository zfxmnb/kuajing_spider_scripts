// ==UserScript==
// @name         dianxiaomi_saleyee_parser
// @namespace    http://tampermonkey.net/
// @version      2024-06-15
// @description  try to take over the world!
// @author       You
// @match        https://www.saleyee.cn/item/*
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(async function() {
    'use strict';
    // const ServiceCharge = 0.15
    const ServiceCharge = 0
    function styles(content){
        const style = document.createElement('style');
        style.innerText = content
        document.body.appendChild(style)
        return style
    }
    function html(content){
        const div = document.createElement('div');
        div.innerHTML = content
        document.body.appendChild(div)
        return div
    }
    const colorKeywords = ['White', 'Yellow', 'Orange', 'Pink', 'Red', 'Brown', 'Green', 'Blue', 'Purple', 'Gray', 'Grey', 'Black', 'Silver', 'Gold', 'Light brown', 'Light green', 'Light blue', 'Dark brown', 'Dark green', 'Dark blue', 'Bright red', 'Bright green', 'Bright blue'];
    const colorCNKeywords = ['白色', '黄色', '橙色', '粉\w色', '红色', '咖啡色|棕色', '绿色', '蓝色', '紫色', '灰色', '黑色', '银色', '金色', '淡棕|亮棕', '淡绿|亮绿', '淡蓝|亮蓝', '深棕', '深绿', '深蓝', '鲜红|亮红', '鲜绿', '鲜蓝']
    const queryAll = (...args) => document.querySelectorAll(...args)
    const query = (...args) => document.querySelector(...args)
    function numberFixed (num, b = 2) {
        return Number(Number(num).toFixed(b)) || 0
    }
    // request
    function request(options) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                timeout: 15000,
                method: options.method || 'GET',
                url: options.url,
                headers: options.headers || {},
                data: options.data,
                onload: function(response) {
                    if (response.status >= 200 && response.status < 300) {
                        resolve(response);
                    } else {
                        reject(response);
                    }
                },
                onerror: function(error) {
                    reject(error);
                }
            });
        });
    }
    async function getRate(fromcoin = 'USD', tocoin = 'CNY') {
        const key = `fxrate_${fromcoin}_${tocoin}`
        const fxrateStr = window.localStorage.getItem(key)
        let fxrate
        if (fxrateStr) {
            try{
                fxrate = JSON.parse(fxrateStr)
            }catch(err){}
        }
        const now = new Date(Date.now() - 5 * 60 * 1000)
        const current_date = `${now.toLocaleDateString()}_${now.getHours()}`
        if (fxrate && fxrate.rate && current_date === fxrate.date) {
            try {
                return numberFixed(Number(fxrate.rate) * (ServiceCharge + 1), 6)
            } catch (err) { console.log(err) }
        }
        let rate = 7.25 * (ServiceCharge + 1)
        try {
            rate = await request({url: `http://47.121.133.75:5430/exchange?fromcoin=${fromcoin}&tocoin=${tocoin}&money=1`})
                .then((response) => JSON.parse(response.responseText))
                .then((data) => numberFixed(Number(data?.result?.money || 7.25) * (ServiceCharge + 1), 6))
        } catch (err) { console.log(err) }
        window.localStorage.setItem(key, JSON.stringify({rate: rate, date: current_date}))
        return rate
    }
    function fetchWithTimeout(url, options, timeout = 5000) {
        return Promise.race([
            fetch(url, options),
            new Promise((_, reject) => setTimeout(() => {reject(new Error('Request timed out'))}, timeout))
        ]);
    }

    async function copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            console.log('Text copied to clipboard');
        } catch (err) {
            console.error('Failed to copy text: ', err);
        }
    }
    // mymemory 翻译
    const translateText_mymemory = async (text, target, source = 'en', timeout) => {
        const response = await fetchWithTimeout(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${source}|${target}`, {}, timeout);
        const data = await response.json();
        if (!data?.responseData?.translatedText) { return Promise.reject() }
        return data?.responseData?.translatedText ?? text;
    }
    // google 翻译
    const translateText_google = async (text, target, source = 'en', timeout) => {
        const response = await fetchWithTimeout(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=${source}&tl=${target}&dt=t&q=${encodeURIComponent(text)}`, {}, timeout);
        const data = await response.json();
        if (!data?.[0]) { return Promise.reject() }
        return data?.[0]?.map(([text] = []) => text)?.join?.('') ?? text;
    }
    let canUseGoogle = false
    try {
        const demoText = 'I love you'
        translateText_google(demoText, 'zh-CN', 'en', 3000).then((text) => canUseGoogle = !!text && demoText !== text).catch(() => console.log('google 翻译不可用'))
    } catch(err) {}
    const translateCache = {}
    const translateText = async (text, target, source = 'en', timeout = 5000) => {
        const cacheKey = `${source}_${target}`
        if (translateCache[cacheKey]?.[text]) return translateCache[cacheKey][text]
        let newText = text
        try {
            newText = canUseGoogle ? (await translateText_google(text, target, source, timeout)) : (await translateText_mymemory(text, target, source, timeout))
            translateCache[cacheKey] = translateCache[cacheKey] || {}
            translateCache[cacheKey][text] = newText
        } catch(err) {
            console.error(err)
        }
        return newText
    };

    const payload = { rate: await getRate('USD') }
    let priceSymbol = 'USD'

    const payload_configs = {
        source: 'saleyee',
        productId: () => query('.choose_sku')?.nextElementSibling?.innerText?.replace(/spu[:：]\s*/ig, '') || null,
        skuId: () => query('.choose_sku')?.innerText?.replace(/sku[:：]\s*/ig, '') || null,
        currency: 'USD',
        title: () => {
            return query('.goods-tit .choose_h3').innerText || null
        },
        title_CN: () => {
            return query('.goods-tit .chooseTitle').innerText || null
        },
        price: async () => {
            const [_, symbol, num] = query('.products_information .currPrice')?.innerText?.trim()?.match(/([a-z]+)\s*([0-9.]+)/i) ?? []
            if (priceSymbol !== symbol) {
                priceSymbol = symbol
                payload.currency = symbol
                payload.rate = await getRate(symbol)
            }
            return Number(num) || 0
        },
        price_original: async () => {
            const [_, __, num] = query('.products_information .oprice')?.innerText?.trim()?.match(/([a-z]+)\s*([0-9.]+)/i) ?? []
            return Number(num) || undefined
        },
        price_CNY: () => {
            return numberFixed(payload.price * payload.rate)
        },
        price_original_CNY: async () => {
            return payload.price_original ? numberFixed(payload.price_original * payload.rate): undefined
        },
        sourceUrl: () => {
            return window.location.href
        },
        images: () => {
            const imgs = [];
            queryAll('.proimg-container .small-img img').forEach((img) => {
                imgs.push(img.src)
            })
            return imgs
        },
        stock: () => {
            return Number(query('#ktotal')?.innerText) || 0
        },
        description: () => {
            const ps = [];
            const handle = (p) => {
                if (p.innerText.trim()) {
                    let t = p.innerText.trim()
                    while (t.length >= 500) {
                        const ft =t.substr(0, 500)
                        let index = 500
                        let m = ft.match(/\n(?!.*\n)/)
                        if (!m) {
                            m = ft.match(/\.\s(?!.*\.\s)/)
                        }
                        if (!m) {
                            m = ft.match(/\s(?!.*\s)/)
                        }
                        if (m) {
                            index = m.index + 1
                        }
                        ps.push(t.substr(0, index).replace(/^\s*/, ''))
                        t = t.substr(index).replace(/^\s*/, '')
                    }
                    ps.push(t)
                }
            }
            queryAll('.choose_description p, .choose_description li, .choose_description h3, .choose_description blockquote').forEach(handle)
            if (!ps.length) {
                handle(query('.choose_description'))
            }
            const p = []
            ps.forEach((t) => {
                let l = p[p.length - 1]
                if (!l || t?.length >= 500) {
                    p.push(t)
                } else if (l.length + t.length < 500) {
                    p[p.length - 1] = l + '\n' + t
                } else {
                    p.push(t)
                }
            })
            return p

        },
        material: async () => {
            let material = []
            if (payload.description?.length) {
                for (let i = 0; i < payload.description.length; i++ ) {
                    if (payload.description[i]){
                        const m = payload.description[i].match(/(?<=materials?\s*[:：]\s*)([^\n]{1,50})/ig)
                        if (m) {
                            for (let j = 0; j < payload.description.length; j++ ) {
                                const text = m?.[j]?.trim();
                                text && material.push(await translateText(text, 'zh-CN'))
                            }
                        }
                    }
                }
            }
            return material
        },
        style: async () => {
            let styles = []
            if (payload.description?.length) {
                for (let i = 0; i < payload.description.length; i++ ) {
                    if (payload.description[i]) {
                        const m = payload.description[i].match(/(?<=style\s*[:：]\s*)([^\n]{1,25})/ig)
                        const text = m?.[0]?.trim();
                        text && styles.push(text)
                    }
                }
            }
            return styles
        },
        package_size: () => {
            const package_size = []
            queryAll('.chooseSpec li em').forEach((em, index) => {
                if (index < 3) {
                    Number(em.innerText) && package_size.push(Number(em.innerText))
                } else if (index === 3) {
                     payload.weight = Number(em.innerText) || 0
                }
            })
            return [...package_size.sort((a, b) => b - a), payload.weight]
        },
        size: () => {
            let size = []
            let getted = false
            if (payload.description?.length) {
                for (let i = 0; i < payload.description.length; i++ ) {
                    if (payload.description[i]){
                        const m = payload.description[i].match(/\(([\d.]+)\s*[*x]\s*([\d.]+)\s*[*x]\s*([\d.]+)\)\s*cm\s*\(L\s*[*x]\s*W\s*[*x]\s*H\)/i)
                        if (m && m.length === 4) {
                            const l = Number(m[1])
                            const w = Number(m[2])
                            const h = Number(m[3])
                            if (l && w && h) {
                                getted = true
                                size = [l, w, h]
                            }
                            break
                        }
                    }
                }
            }
            queryAll('.chooseSpec li em').forEach((em, index) => {
                if (index < 3) {
                    !getted && Number(em.innerText) && size.push(Number(em.innerText))
                } else if (index === 3){
                    payload.weight = Number(em.innerText) || 0
                }
            })
            return [...size.sort((a, b) => b - a), payload.weight]
        },
        colors: () => {
            const cs = []
            queryAll('.li_attr').forEach((li_attr) => {
                if (/颜色/.test(li_attr.querySelector('span').innerText)) {
                    li_attr.querySelectorAll('.em_attr.curr').forEach((attr) => {
                        cs.push(attr.dataset.attrval)
                    })
                }
            })

            if (!cs.length) {
                payload.description.forEach((text) => {
                    const m = text.match(/color:\s*([^\n]+)/i)
                    if (m && !cs.includes(m[1])) {
                        cs.push(m[1])
                    }
                })
            }
            if (!cs.length) {
                colorKeywords.forEach((kw) => {
                    const m = payload.title.match(new RegExp(`(?<=^|[^\\w])${kw}(?=[^\\w]|$)`, 'i'))
                    if (m) {
                        cs.push(m[0])
                    }
                })
                !cs?.length && colorCNKeywords.forEach((kw, index) => {
                    const m = payload.title_CN.match(new RegExp(kw, 'i'))
                    if (m) {
                        cs.push(colorKeywords[index])
                    }
                })
            }
            return cs
        },
        material_CN: async () => {
            let material_CN = []
            try {
                material_CN = await Promise.all(payload.material.map((text) => translateText(text, 'zh-CN')))
            } catch(err){}
            return material_CN.length ? material_CN : payload.material || []
        },
        colors_CN: async () => {
            let colors_CN = []
            try {
                colors_CN = await Promise.all(payload.colors.map((text) => translateText(text, 'zh-CN')))
            } catch(err){}
            return colors_CN.length ? colors_CN : payload.colors || []
        },
        style_CN: async () => {
            let style_CN = []
            try {
                style_CN = await Promise.all(payload.style.map((text) => translateText(text, 'zh-CN')))
            } catch(err){}
            return style_CN.length ? style_CN : payload.style || []
        },
        detail_images: () => {
            const imgs = [];
            queryAll('.choose_description img, .choose_detail_img img').forEach((img) => {
                imgs.push(img.src)
            })
            return imgs
        },
        description_CN: async () => {
            let description = []
            try {
                description = await Promise.all(payload.description.map((text) => translateText(text, 'zh-CN')))
            } catch(err){}
            return description.length ? description : payload.description || []
        },
    }
    const fn = async () => {
        for (const [ key, value ] of Object.entries(payload_configs)) {
            if (typeof value === 'function') {
                const result = await value()
                result !== undefined && result !== null && (payload[key] = result)
            } else if (value !== null) {
                payload[key] = value
            }
        }
    }

    styles(`
    .dianxiaomi_plugin {
        display: flex;
        gap: 6px;
        position: fixed;
        left: 0px;
        bottom: 0px;
        z-index: 0;
        border: 1px solid #999;
        border-radius: 3px;
        background: #fff;
        padding: 6px;
        opacity: 0.7;
    }
    .dianxiaomi_plugin a {
        cursor: pointer;
        color: #000;
        font-size: 14px;
    }
    .page_foalt_btn {
        right: 0;
    }
    .togger_right_navi_common {
        right: 0;
    }
    hide {
        display: none;
    }
    `)
    const root = html(`<div class="dianxiaomi_plugin"><a id="dianxiaomi_collect">收集数据</a><a id="dianxiaomi_collect_jump">收集数据并跳转</a><span id="dianxiaomi_collect_loading" class="hide">处理中</span></div>`)
    const collect = root.querySelector('#dianxiaomi_collect')
    const collect_jump = root.querySelector('#dianxiaomi_collect_jump')
    const loading = root.querySelector('#dianxiaomi_collect_loading')
    const collectCb = async () => {
        collect.classList.add('hide')
        collect_jump.classList.add('hide')
        loading.classList.remove('hide')
        await fn()
        await copyToClipboard(JSON.stringify(payload))
        collect.classList.remove('hide')
        collect_jump.classList.remove('hide')
        loading.classList.add('hide')
        // console.log(payload)
    }
    collect.addEventListener('click', async () => {
        await collectCb()
    })
    collect_jump.addEventListener('click', async () => {
        await collectCb()
        window.open('https://www.dianxiaomi.com/popTemuProduct/add.htm?collection=1')
    })
})();