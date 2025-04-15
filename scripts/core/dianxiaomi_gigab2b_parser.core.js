window.dianxiaomi_gigab2b_parser_core = async () => {
    console.log('dianxiaomi_gigab2b_parser_core running')
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
    async function getCurrency() {
        const { code, symbol } = (await fetch("https://www.gigab2b.com/index.php?route=/common/header/getHeaderInfo").then((res) => res.json()))?.data?.country_list?.[0] ?? []
        if (symbol == "€") {
            return "EUR"
        }
        if (symbol == "₣") {
            return "FRF"
        }
        const CurrencyMap = {
            "USA": "USD",
            "US": "USD",
            "GBR": "GBR",
            "GB": "GBR",
            "UK": "GBR",
            "UK": "GBR",
            "JPN": "JPY",
            "JP": "JPY"
        }
        return CurrencyMap[code] || "USD"
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

    const payload = { rate: await getRate(await getCurrency()) }
    const payload_configs = {
        dataSource: async () => {
            const baseUrl = window.location.href.replace(/route=product\/product(?=$|&)/, 'route=/product/info/info/baseInfos')
            const priceUrl = window.location.href.replace(/route=product\/product(?=$|&)/, 'route=/product/info/price/list')
            const { data: baseInfo } = await fetch(baseUrl).then((res) => res.json())
            const { data: price_info } = await fetch(priceUrl).then((res) => res.json())
            // console.log({ ...baseInfo, price_info })
            return { ...baseInfo, price_info }
        },
        source: 'gigab2b',
        productId: () => payload.dataSource?.product_info?.sku,
        skuId: () => payload.dataSource?.product_info?.sku,
        currency: 'USD',
        title: () => {
            return payload.dataSource?.product_info?.product_name || null
        },
        title_CN: async () => {
            return await translateText(payload.dataSource?.product_info?.product_name, 'zh-CN') || null
        },
        shipFee: () => {
            return payload.dataSource?.price_info?.fulfillment_options?.drop_ship.total_amount || 0
        },
        shipFee_CNY: () => {
            return numberFixed(payload.shipFee * payload.rate)
        },
        price: () => {
            const price = payload.dataSource?.price_info?.base_price_info?.discount_price || payload.dataSource?.price_info?.base_price_info?.price || null
            return price ? price + payload.shipFee : price
        },
        price_original: async () => {
            const price = payload.dataSource?.price_info?.base_price_info?.discount_price ? payload.dataSource?.price_info?.base_price_info?.price : null
            return price ? price + payload.shipFee: price
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
            return payload.dataSource?.product_info?.image_list?.map(({ popup }) => {
                return popup.replace(/w_[\d]+/, 'w_1600').replace(/h_[\d]+/, 'h_1600')
            }) || []
        },
        stock: () => {
            return payload.dataSource?.price_info?.quantity?.quantity || 0
        },
        description: () => {
            const ps = [];
            const div = document.createElement('div')
            if (payload.dataSource?.product_info?.characteristic) {
                div.innerHTML = payload.dataSource?.product_info?.characteristic
                div.querySelectorAll('li').forEach((p) => {
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
                })
            }
            if (payload.dataSource?.product_info?.description) {
                div.innerHTML = payload.dataSource?.product_info?.description
                if (div.innerText.trim()) {
                    let t = div.innerText.trim()
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
            const imgs = [];
            div.querySelectorAll('img').forEach((img) => {
                const url = img.src
                url && imgs.push(url.replace(/w_[\d]+/, 'w_1600').replace(/h_[\d]+/, 'h_1600'))
            })
            payload.detail_images = imgs?.length ? imgs : payload.images
            return ps
        },
        material: async () => {
            let material = []
            let colors = []
            if (payload.dataSource?.product_info?.specification?.property_infos?.length) {
                for(let i = 0; i < payload.dataSource?.product_info?.specification?.property_infos?.length; i++) {
                    const { property_name, property_value_name } = payload.dataSource?.product_info?.specification?.property_infos[i]
                     if (property_name.includes('Color')) {
                         colors.push(property_value_name)
                     }
                    if (property_name.includes('Material')) {
                        material.push(property_value_name)
                    }
                }
            }
            payload.colors = colors
            return material
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
        package_size: () => {
            const { unit_length, unit_weight, general, combo } = payload.dataSource?.product_info?.specification?.package_size || {}
            const pz = general?.length ? general: general?.[0] || combo?.[0] || combo
            let rate = 1
            let weightRate = 1
            if (unit_length === 'in.') {
                rate = 2.54
            }
            if (unit_length === 'm.') {
                rate = 100
            }
            if (unit_length === 'ft.') {
                rate = 30.4
            }
            if (unit_length === 'yd.') {
                rate = 91.44
            }
            if (unit_weight === 'oz.') {
                weightRate = 28.349523
            }
            if (unit_weight === 'lbs.') {
                weightRate = 453.59237
            }
            if (unit_weight === 'kg.') {
                weightRate = 1000
            }
            if (pz.length) {
                const weight = numberFixed(Number(pz.weight || 0) * weightRate)
                weight && (payload.weight = weight)
                return [numberFixed(Number(pz.length || 0) * rate), numberFixed(Number(pz.width || 0) * rate), numberFixed(Number(pz.height || 0) * rate), weight]
            }
        },
        size: () => {
            const { unit_length, unit_weight, assemble_info, dimensions_custom_field } = payload.dataSource?.product_info?.specification?.product_dimensions || {}
            const z = assemble_info?.length ? assemble_info: assemble_info?.[0] || dimensions_custom_field?.[0] || dimensions_custom_field
            let rate = 1
            let weightRate = 1
            if (unit_length === 'in.') {
                rate = 2.54
            }
            if (unit_length === 'm.') {
                rate = 100
            }
            if (unit_length === 'ft.') {
                rate = 30.4
            }
            if (unit_length === 'yd.') {
                rate = 91.44
            }
            if (unit_weight === 'oz.') {
                weightRate = 28.349523
            }
            if (unit_weight === 'lbs.') {
                weightRate = 453.59237
            }
            if (unit_weight === 'kg.') {
                weightRate = 1000
            }
            if (z.length) {
                const weight = numberFixed(Number(z.weight_show || 0) * weightRate)
                payload.weight = weight
                const size = [numberFixed(Number(z.length_show || 0) * rate), numberFixed(Number(z.width_show || 0) * rate), numberFixed(Number(z.height_show || 0) * rate), weight]
                if (!payload.package_size) {
                    payload.package_size = size
                }
                return size
            } else if (payload.package_size) {
                return payload.package_size
            }
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
        delete payload.dataSource
        await copyToClipboard(JSON.stringify(payload))
        collect.classList.remove('hide')
        collect_jump.classList.remove('hide')
        loading.classList.add('hide')
        //console.log(payload)
    }
    collect.addEventListener('click', async () => {
        await collectCb()
    })
    collect_jump.addEventListener('click', async () => {
        await collectCb()
        window.open('https://www.dianxiaomi.com/popTemuProduct/add.htm?collection=1')
    })
}