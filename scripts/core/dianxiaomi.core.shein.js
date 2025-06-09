// ==UserScript==
// @name         dianxiaomi_shein
// @namespace    http://tampermonkey.net/
// @version      2025-05-15
// @description  try to take over the world!
// @author       You
// @match        https://www.dianxiaomi.com/sheinProduct/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=google.com
// @grant        none
// @require      https://cdn.bootcdn.net/ajax/libs/jszip/3.10.1/jszip.min.js
// ==/UserScript==

// 代理
// https://gh-proxy.com/$GITHUB_URL
// https://ghfast.top/$GITHUB_URL

let runed = false
window.dianxiaomi_shein_core = async () => {
    if (runed) true
    console.log('dianxiaomi_core_shein running', '202506081422')
    runed = true
    let imported = false
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
    async function sleep (t = 0) {
        return new Promise((resolve) => {
            setTimeout(resolve, t)
        })
    }
    async function polling (fn, t = 100, max = 10000) {
        return new Promise((resolve) => {
            let finished = false
            const timer = setInterval(() => {
                if (fn?.()) {
                    finished = true
                    clearInterval(timer)
                    resolve()
                }
            }, t)
            setTimeout(() => {
                if (!finished) {
                    clearInterval(timer)
                    resolve()
                }
            }, max)
        })
    }
    async function getClipboardContent() {
        try {
            return await navigator.clipboard.readText();
        } catch (err) {
            console.error('Failed to read clipboard contents:', err);
        }
    }
    // 浮点格式化
    function numberFixed (num, d = 2) {
        return Number(Number(num).toFixed(d)) || 0
    }
    async function copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            console.log('Text copied to clipboard');
        } catch (err) {
            console.error('Failed to copy text: ', err);
        }
    }
    const setInput = (selector, value) => {
        const ele = selector instanceof Element ? selector : document.querySelector(selector)
        if (imported && ele?.value) return
        if (ele) {
            ele.value = value
            ele.dispatchEvent?.(new Event('input'))
        }
    }
    const judgmentDisplay = (ele) => {
        if (!ele?.getBoundingClientRect || !ele?.isConnected) return false
        const rect = ele?.getBoundingClientRect?.()
        return !!(rect?.width || rect?.height)
    }
    const getGlobalEle = (selector) => {
       return [...document.querySelectorAll(selector)].reverse().find((ele) => judgmentDisplay(ele))
    }
    // 模糊匹配内容元素
    const findElementsByText = (text, parent = document, filter = () => true) => {
        // 查找包含特定文本的文本节点
        const matchingTextNodes = document.evaluate(
            `//text()[contains(., "${text}") and not(ancestor::script)]`,
            parent,
            null,
            XPathResult.UNORDERED_NODE_ITERATOR_TYPE,
            null
        );
        const matchedNodes = [];
        let node
        while ((node = matchingTextNodes.iterateNext())) {
            if (!filter(node.parentElement)) continue
            matchedNodes.push(node.parentElement);
        }
        return matchedNodes
    }
    let interceptorFormat = () => {}
    let hasIntercepted = false
    const interceptor = (fn) => {
        if (!JSZip) return
        interceptorFormat = fn
        if (hasIntercepted || !interceptorFormat) return
        hasIntercepted = true
        const originalOpen = XMLHttpRequest.prototype.open;
        const originalSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function(method, url) {
            if (url.includes('/api/popTemuProduct/add.json')) this._is = true;
            return originalOpen.apply(this, arguments);
        };
        XMLHttpRequest.prototype.send = function (body, ...rest) {
            if (this._is && body) {
                const file = body.get('file')
                if (file) {
                    return JSZip.loadAsync(file).then((zip) => {
                        return zip.file("choiceSave.txt").async("text").then((fileData) => {
                            let newFileData = null
                            try {
                                newFileData = {...JSON.parse(fileData)}
                                // console.log('oldFileData::: ', newFileData)
                                const data = interceptorFormat?.(newFileData) ?? {}
                                newFileData = {...newFileData, ...data}
                                // console.log('newFileData::: ', newFileData)
                            } catch (err) { console.error(err) }
                            var newZip = new JSZip();
                            newZip.file("choiceSave.txt", newFileData ? JSON.stringify(newFileData) : fileData );
                            return newZip.generateAsync({
                                type: "blob",
                                compression: "DEFLATE",
                                compressionOptions: { level: 9 }
                            }).then((newFile) => {
                                body.set("file", newFile)
                                return originalSend.apply(this, [body, ...rest]);
                            })
                        });
                    })
                }
            }
            return originalSend.apply(this, arguments);
        };
    }

    let payload
    styles(`
    .dianxiaomi_plugin {
        display: flex;
        gap: 6px;
        position: fixed;
        left: 0px;
        bottom: 0px;
        z-index: 999;
        background: #fff;
        border: 1px solid #999;
        border-radius: 3px;
        padding: 6px;
        opacity: 0.7;
    }
    .dianxiaomi_plugin input {
        font-size: 12px;
        width: 40px;
    }
    .dianxiaomi_plugin a, #dianxiaomi_plugin_drawer a {
        cursor: pointer;
        color: #000;
        font-size: 14px;
    }
    #dianxiaomi_plugin_drawer {
        position: fixed;
        left: 0px;
        bottom: 0px;
        width: 275px;
        height: 100%;
        background: #fff;
        border-right: 1px solid #999;
        opacity: 0.8;
        overflow-y: auto;
        font-size: 12px;
        z-index: 9999;
    }
    #dianxiaomi_plugin_drawer_close{
        position: absolute;
        right : 5px;
        top: 5px;
    }
    hide {
        display: none;
    }
    #dianxiaomi_plugin_drawer_content {
        padding: 20px 0;
    }
    .drawer_content_item {
        border-bottom: 2px solid #000;
        padding: 8px 4px;
    }
    .drawer_content_sub .drawer_content_item {
        margin-left: 16;
        padding: 0;
        border-bottom: none;
    }
    .drawer_content_header {
        display: flex;
        justify-content: space-between;
    }
    .drawer_content_item textarea {
        width: 100%;
    }
    .drawer_content_image {
        width: 40px;
        height: 40px;
        cursor: pointer;
        border: 1px solid #fff;
    }
    .drawer_content_image:hover{
        border: 1px solid #000;
    }
    .marginLeft275{
        margin-left: 275px;
    }
    `)
    const root = html(`
    <div class="dianxiaomi_plugin"><span>报价倍率:<input type="number" min="1" max="10" step="1" id="dianxiaomi_price_rate_input" value="1"/></span><span>库存倍率:<input type="number" min="0" max="1" step="0.1" id="dianxiaomi_stock_rate_input" value="1"/></span><a id="dianxiaomi_payload">读取剪切板</a><a class="hide" id="dianxiaomi_open">打开面板</a><a class="hide" id="dianxiaomi_import">一键导入</a></div>
    <div id="dianxiaomi_plugin_drawer" class="hide">
    <a id="dianxiaomi_plugin_drawer_close">X</a>
    <div id="dianxiaomi_plugin_drawer_content"></div>
    </div>
    `)
    const drawer = root.querySelector('#dianxiaomi_plugin_drawer')
    const drawerClose = root.querySelector('#dianxiaomi_plugin_drawer_close')
    const drawerContent = root.querySelector('#dianxiaomi_plugin_drawer_content')
    const priceRateInput = root.querySelector('#dianxiaomi_price_rate_input')
    const stockRateInput = root.querySelector('#dianxiaomi_stock_rate_input')
    const openBtn = root.querySelector('#dianxiaomi_open')
    const importBtn = root.querySelector('#dianxiaomi_import')
    const payloadBtn = root.querySelector('#dianxiaomi_payload')
    let copyMap = []
    let priceRate = Number(window.localStorage?.getItem?.('__price_rate__') || '1')
    priceRate = isNaN(priceRate) ? 1 : priceRate
    priceRateInput && (priceRateInput.value = priceRate)
    let stockRate = Number(window.localStorage?.getItem?.('__stock_rate__') || '1')
    stockRate = isNaN(stockRate) ? 1 : stockRate
    stockRateInput && (stockRateInput.value = stockRate)
    const parseItem = (title, content, value, nocopy) => {
        const index=copyMap.length
        copyMap.push(value)
        return `<div class="drawer_content_item"><div class="drawer_content_header"><span class="drawer_content_title">${title}</span><a class="drawer_content_copy ${nocopy ? 'hide' : ''}" data-index="${index}">复制</a></div><div class="drawer_content_sub">${content}</div></div>`
    }
    const getProps = (data) => [
        { key: 'source', title: '来源' },
        { key: 'sourceUrl', title: '源链接' },
        { key: 'title_CN', title: '标题(中文)' },
        { key: 'title', title: '英文标题' },
        { key: 'skuId', title: 'SKU' },
        { key: 'images', title: '轮播图片' },
        { key: 'material_CN', title: '材质(中文)' },
        { key: 'style_CN', title: '风格(中文)' },
        { key: 'colors', title: '颜色' },
        { key: 'colors_CN', title: '颜色(中文)' },
        { key: 'price_CNY', title: `<span style="color:red;">【成本】</span>${data.shipFee_CNY ? `[包含运费:${data.shipFee_CNY}]`: '' }${data?.price_original_CNY ? ' -- <span style="color:red;">限时折扣</span>': ''}` },
        { key: 'price_original_CNY', title: `原成本${data.shipFee_CNY ? `[包含运费:${data.shipFee_CNY}]`: '' }` },
        { key: 'price', title: `<span style="color:red;">【成本】</span>${data.shipFee ? `[包含运费:${data.shipFee}]`: '' }(${data.currency})${data?.price_original ? ' -- <span style="color:red;">限时折扣</span>': ''}` },
        { key: 'price_original', title: `原成本${data.shipFee ? `[包含运费:${data.shipFee}]`: '' }(${data.currency})` },
        { key: 'rate', title: `汇率(${data.currency})` },
        { key: 'size', title: '尺寸(cm)' },
        { key: 'package_size', title: '包装尺寸(cm)' },
        { key: 'weight', title: '重量(g)' },
        { key: 'stock', title: '<span style="color:red;">【库存】</span>' },
        { key: 'description', title: '描述' },
        { key: 'description_CN', title: '描述(中文）' },
        { key: 'detail_images', title: '详情图片' }
    ]
    function parse () {
        let html = ''
        copyMap=[]
        getProps(payload).forEach(({ key, title}) => {
            const value = payload[key]
            if (value === undefined || value === null || value instanceof Array && !value.length ) return
            let c = ''
            if (value instanceof Array) {
                let m = {}
                if (key === 'size' || key === 'package_size') {
                    m = {0: '长', 1: '宽', 2: '高', 3: '重(g)'}
                }
                value.forEach((item, i) => {
                    const rows = /\n/.test(item) ? 3 : 1
                    c += key === 'images' || key === 'detail_images' ? `<img class="drawer_content_image" src="${item}"/>`: parseItem(m[i] || i + 1, `<textarea readonly rows="${rows}" value="${item}">${item}</textarea>`, item)
                })
            } else {
                const rows = /\n/.test(value) ? 3 : 1
                c = `<textarea readonly rows="${rows}" value="${value}">${value}</textarea>`
            }
            html += parseItem(`<span>${title ?? key}</span>`, c, value, ['size', 'colors'].includes(key))
        })
        return html
    }
    payloadBtn?.addEventListener?.('click', async () => {
        const content = await getClipboardContent()
        let data = content
        if (typeof content === 'string' && /^\{/.test(content) && /\}$/.test(content)) {
            try {
                data = JSON.parse(content)
            }catch(err){}
        }
        if (!data?.title || !data?.title_CN || !data?.images || !data?.description || !data?.detail_images || !data?.size) {
            return
        }
        payload = data
        openBtn?.classList?.remove?.('hide')
        importBtn?.classList?.remove?.('hide')
        drawerContent.innerHTML = parse()
    })
    openBtn?.addEventListener?.('click', async () => {
        drawer?.classList?.remove?.('hide')
        document.body.classList.add('marginLeft75')
    })
    drawerClose?.addEventListener?.('click', async () => {
        drawer?.classList?.add?.('hide')
        document.body.classList.remove('marginLeft275')
    })
    priceRateInput?.addEventListener('change', (e) => {
        const value = Number(e.target?.value)
        if (!isNaN(value)) {
            priceRate = value
            window.localStorage?.setItem?.('__price_rate__', value)
        }
    })
    stockRateInput?.addEventListener('change', (e) => {
        const value = Number(e.target?.value)
        if (!isNaN(value)) {
            stockRate = value
            window.localStorage?.setItem?.('__stock_rate__', value)
        }
    })

    await (async () => {
        await sleep(1000)
        // 店铺选择
        let shop = document.querySelector?.('#shopId');
        if (shop && !shop.value) {
            const id = window.localStorage?.getItem('__previous_shop__')
            if (shop.querySelector(`[value="${id}"]`)) {
                shop.value = id
            } else {
                shop.selectedIndex = 1
            }
            shop.onchange()
        }
        shop?.addEventListener?.('change',  (e) => {
            if(e.target.value) {
                window.localStorage?.setItem('__previous_shop__', e.target.value)
            }
        })
        await sleep(3000)
        // 分类选择
        const categoryHistory = document.querySelector?.('#categoryHistoryId')
        if (categoryHistory && !categoryHistory.value) {
            if (categoryHistory.querySelectorAll('option').length > 1) {
                categoryHistory.selectedIndex = 1
                categoryHistory.onchange()
                await sleep(500)
            } else {
                document.querySelector('.categoryModalShow')?.click?.()
                await sleep(300)
                const searchCategory = document.querySelector('#searchCategory')
                searchCategory.value = '修剪工具'
                searchCategory.nextElementSibling?.click?.()
                await sleep(2000)
                document.querySelector('.classifie-search [node-id]')?.click?.()
            }
        }
        // 数据读取
        payloadBtn?.click?.()
    })()

    importBtn?.addEventListener?.('click', async () => {
        // 来源URL
        setInput('#sourceUrl0', payload.sourceUrl)
        // 标题
        setInput('#productTitleBuyer', payload.title)
        // 新版图片
        document.querySelector('.sheinNewImageRadio')?.click?.()
        // 商品id
        setInput('#productItemNumber', payload.skuId)
        // 详情
        setInput('#productDesc', payload.description?.join('\n'))
        // 图片
        window.SHEIN_PRODUCT_IMAGE_UP?.imageFn?.thumbnailImg?.(3, document.querySelector('#spuImageTable .tuiImageEditorBox'));
        await sleep(200);
        document.querySelector('#commProductNetImgUrl').value = payload.images?.[0]
        await sleep(200);
        window.PRODUCT_COMM.networkImgConfirm();
        // 颜色
        const colorInput = document.querySelector('#skuInfoArrBox .masterVariantTr .attrOtherBox input')
        setInput(colorInput, payload.colors?.[0] ?? 'unknown')
        colorInput?.nextElementSibling?.click()
        // 变种信息
        setInput('#skuDataTable [name="skuName"]', payload.skuId)
        setInput('#skuDataTable [name="supplyPrice"]', numberFixed(payload.price_CNY * priceRate))
        setInput('#skuDataTable [name="skuStock"]', numberFixed(payload.stock * stockRate, 0))
        setInput('#skuDataTable [name="skuWeight"]', payload.weight)
        setInput('#skuDataTable [name="skuLength"]', payload.size?.[0] == 900 ? 899: payload.size?.[0])
        setInput('#skuDataTable [name="skuWidth"]', payload.size?.[1])
        setInput('#skuDataTable [name="skuHeight"]', payload.size?.[2])
        // 变种图片
        const imgCloseIcon = document.querySelector('#skuDataInfo .skuDataTable .img-close-icon')
        if (!imgCloseIcon) {
            const skuImage = document.querySelector('#skuDataInfo .skuDataTable .sku-image .img-box')
            skuImage?.dispatchEvent?.(new Event('mouseenter'))
            await sleep(200);
            getGlobalEle('.ant-dropdown [data-menu-id="product"]')?.click?.();
            skuImage?.dispatchEvent?.(new Event('mouseleave'))
            await sleep(500)
            const selectProductImageCheckbox = getGlobalEle('.ant-modal-wrap .ant-checkbox-group .ant-checkbox-input')
            if (selectProductImageCheckbox) {
                selectProductImageCheckbox?.click?.()
                await sleep(200);
                selectProductImageCheckbox?.closest?.('.ant-modal-content')?.querySelector('.ant-btn-primary')?.click?.()
                await sleep(500)
            }
        }
        
        // 站外产品链接
        setInput(document.querySelector('#productProductInfo .ant-form-item label[title="站外产品链接"]')?.closest('.ant-form-item').querySelector('.ant-input'), payload.sourceUrl)
        // 设置图片
        const imageCon = document.querySelector('#productProductInfo .ant-form-item label[title="产品轮播图"]')?.closest('.ant-form-item')
        const imgeButton = imageCon.querySelector('button')
        if (imgeButton) {
            imgeButton?.dispatchEvent?.(new Event('mouseenter'))
            await sleep(200);
            getGlobalEle('[data-menu-id="net"]')?.click?.()
            imgeButton?.dispatchEvent?.(new Event('mouseleave'))
            await sleep(200);
            const netImgUrl = getGlobalEle('[placeholder="请填写图片URL地址，多个地址用回车换行"]')
            const detail_images = payload?.detail_images ?? []
            let list = [...(payload?.images ?? [])]
            if (list.length > 10) {list = [...list.slice(0, 7)].concat(list.length > 3 ? list.slice(-3) : [])}
            if (list.length < 10 && detail_images.length) {
                const m = {}
                list.forEach((img) => {m[img] = true})
                for (let i = 0; i < detail_images.length; i++) {
                    const img = detail_images[i]
                    if (!img || m[img]) continue
                    list.push(img)
                    m[img] = true
                    if (list.length >= 10) break
                }
            }
            setInput(netImgUrl, list.join('\n'))
            netImgUrl.dispatchEvent?.(new Event('change'))
            await sleep(200);
            netImgUrl?.closest?.('.ant-modal-wrap')?.querySelector('.ant-btn-primary')?.click?.()
            await sleep(2500);
            const imageEditButton = imageCon.querySelector('.img-options .action-item:nth-child(2) a')
            imageEditButton?.dispatchEvent?.(new Event('mouseenter'))
            await sleep(200);
            const dropdown = getGlobalEle('.ant-dropdown')
            if (dropdown) {
                dropdown.querySelector('.ant-dropdown-menu-item')?.click()
                imageEditButton?.dispatchEvent?.(new Event('mouseleave'))
                await sleep(2500)
                const resizeModal = document.querySelector('.resize-info').closest('.ant-modal-wrap')
                const valueW = resizeModal?.querySelector('[name="valueW"]')
                if (valueW && !valueW.value) setInput(valueW, '800')
                const checkbox = resizeModal?.querySelector('.resize-info .right .ant-checkbox-input')
                if (!checkbox?.checked) checkbox?.click?.()
                resizeModal?.querySelector('.resize-info .ant-btn-primary')?.click?.()
                if (resizeModal) {
                    await polling(() => !judgmentDisplay(resizeModal))
                }
            }
        }
        imported = true
    })

    drawerContent?.addEventListener?.('click', async (e) => {
        if (e.target.classList.contains('drawer_content_copy')) {
            const index = e.target.dataset.index
            if (Number(index) > -1) {
                const value = copyMap[Number(index)]
                copyToClipboard(value instanceof Array ? value.join('\n'): value)
            }
        }
        if (e.target.classList.contains('drawer_content_image')) {
            const value = e.target.src
            value && copyToClipboard(value instanceof Array ? value.join('\n'): value)
        }
    })
    drawerContent?.addEventListener?.('dblclick', async (e) => {
        if (e.target.classList.contains('drawer_content_image')) {
            const value = e.target.src
            value && window.open(value)
        }
    })
}

(async function() {
    dianxiaomi_shein_core();
})();