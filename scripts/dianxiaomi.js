// ==UserScript==
// @name         dianxiaomi product auto import
// @namespace    http://tampermonkey.net/
// @version      2024-06-15
// @description  try to take over the world!
// @author       You
// @match        https://www.dianxiaomi.com/popTemuProduct/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=google.com
// @grant        none
// ==/UserScript==

(async function() {
    'use strict';
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
    async function getClipboardContent() {
        //return Promise.resolve(mockData)
        try {
            return await navigator.clipboard.readText();
        } catch (err) {
            console.error('Failed to read clipboard contents:', err);
        }
    }
    async function copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            console.log('Text copied to clipboard');
        } catch (err) {
            console.error('Failed to copy text: ', err);
        }
    }
    const queryAll = (...args) => document.querySelectorAll(...args)
    const query = (...args) => document.querySelector(...args) ?? {}
    let payload
    styles(`
    .dianxiaomi_plugin {
        display: flex;
        gap: 6px;
        position: fixed;
        left: 0px;
        bottom: 0px;
        z-index: 0;
        background: #fff;
        border: 1px solid #999;
        border-radius: 3px;
        padding: 6px;
        opacity: 0.7;
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
    <div class="dianxiaomi_plugin"><a id="dianxiaomi_payload">读取剪切板</a><a class="hide" id="dianxiaomi_open">打开面板</a><a class="hide" id="dianxiaomi_import">一键导入</a></div>
    <div id="dianxiaomi_plugin_drawer" class="hide">
    <a id="dianxiaomi_plugin_drawer_close">X</a>
    <div id="dianxiaomi_plugin_drawer_content"></div>
    </div>
    `)
    const drawer = query('#dianxiaomi_plugin_drawer')
    const drawerClose = query('#dianxiaomi_plugin_drawer_close')
    const drawerContent = root.querySelector('#dianxiaomi_plugin_drawer_content')
    const openBtn = root.querySelector('#dianxiaomi_open')
    const importBtn = root.querySelector('#dianxiaomi_import')
    const payloadBtn = root.querySelector('#dianxiaomi_payload')
    let copyMap = []
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
        { key: 'price_CNY', title: `<span style="color:red;">【成本】</span>${data.shipFee_CNY ? `[包含运费:${data.shipFee_CNY}]`: '' }${data?.price_original ? ' -- <span style="color:red;">限时折扣</span>': ''}` },
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
    payloadBtn.addEventListener('click', async () => {
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
        openBtn.classList.remove('hide')
        importBtn.classList.remove('hide')
        drawerContent.innerHTML = parse()
    })
    if (window.location.search === '?collection=1') {
        payloadBtn.click()
    }
    openBtn.addEventListener('click', async () => {
        drawer.classList.remove('hide')
        document.body.classList.add('marginLeft75')
    })
    drawerClose.addEventListener('click', async () => {
        drawer.classList.add('hide')
        document.body.classList.remove('marginLeft275')
    })
    importBtn.addEventListener('click', async () => {
        const shop = query('#shopId')
        if (!shop.value) {
            shop.selectedIndex = 1
            shop.onchange()
        }
        await sleep(1000)
        const categoryHistory = query('#categoryHistoryId')
        if (categoryHistory) {
            categoryHistory.selectedIndex = 1
            categoryHistory.onchange()
        }
        query('#sourceUrl0').value = payload.sourceUrl
        query('#productTitle').value = payload.title_CN
        query('#productI18n').value = payload.title
        query('#productNumber').value = payload.skuId
        query('#outerGoodsUrl').value = payload.sourceUrl
        await sleep(1000)
        const colorInput = query('[name="otherColor"]')
        if (colorInput) {
            colorInput.value = payload.colors?.[0] ?? 'unknown'
            colorInput.nextElementSibling.click()
            sleep(200)
            query('.skuInfoTable [name="price"]').value = payload.price_CNY
            query('.skuInfoTable [name="skuLength"]').value = payload.size?.[0]
            query('.skuInfoTable [name="skuWidth"]').value = payload.size?.[1]
            query('.skuInfoTable [name="skuHeight"]').value = payload.size?.[2]
            query('.skuInfoTable [name="weight"]').value = payload.weight
            const skuWarehouseSel = query('.siteWarehouseBox .custom-sel-dropdown-menu .scroll-bar li input')
            skuWarehouseSel.click()
            await sleep(1000)
            query('.skuOtherInfoList [name="stock"]').value = payload.stock
        }
        query('#packageShape').selectedIndex = 2
        query('#packageType').selectedIndex = 1
        query('.product-info-module-content [name="deliveryTime"][value="172800"]')?.click()
        query('#freightTemplateBox .menuListLi:last-child')?.click()
        const wirelessDescBox = query('#wirelessDescContentBox')
        if (wirelessDescBox) {
            const list = []
            payload.description?.forEach?.((text) => {
                list.push({
                    "type": "text",
                    "cont": {
                        "text": text,
                        "style": {
                            "font-size": "12",
                            "color": "#000000",
                            "text-align": "left",
                            "background-color": "#ffffff"
                        }
                    }
                })
            })
            payload.detail_images?.forEach?.((imgUrl) => {
                list.push( {
                    "type": "image",
                    "cont": {
                        "imgUrl": imgUrl,
                        "width": "800",
                        "height": "800"
                    }
                })
            })
            wirelessDescBox.dataset.list = JSON.stringify(list)
            window.POP_TEMU_PRODUCT_FN?.descriptionFn?.modalShow?.();
            window.DESCRIPTION_EDITOR?.modalSave?.();
        }
        window.POP_TEMU_PRODUCT_IMAGE_UP?.imageFn?.proNetworkImgShow?.();
        let netImgUrl = query('#netImgUrl')
        // https://img.myshopline.com/image/official/477168e554ab409cad55a46005699cf1.jpeg
        if (netImgUrl) {
            netImgUrl.value = (payload?.images?.slice(0, 10) ?? []).join('\n');
            window.POP_TEMU_PRODUCT_IMAGE_UP?.imageFn?.proNetworkImgConfirm?.();
        }

        window.POP_TEMU_PRODUCT_IMAGE_UP?.imageFn?.proNetworkImgShow?.('productPackageImg');
        netImgUrl = query('#netImgUrl')
        // https://img.myshopline.com/image/official/477168e554ab409cad55a46005699cf1.jpeg
        if (netImgUrl) {
            netImgUrl.value = 'https://img.myshopline.com/image/official/477168e554ab409cad55a46005699cf1.jpeg'
            window.POP_TEMU_PRODUCT_IMAGE_UP?.imageFn?.proNetworkImgConfirm?.();
        }
    })
    drawerContent.addEventListener('click', async (e) => {
        if(e.target.classList.contains('drawer_content_copy')) {
            const index = e.target.dataset.index
            if(Number(index) > -1){
                const value = copyMap[Number(index)]
                copyToClipboard(value instanceof Array ? value.join('\n'): value)
            }
        }
        if(e.target.classList.contains('drawer_content_image')) {
            const value = e.target.src
            value && copyToClipboard(value instanceof Array ? value.join('\n'): value)
        }
    })
    drawerContent.addEventListener('dblclick', async (e) => {
        if(e.target.classList.contains('drawer_content_image')) {
            const value = e.target.src
            value && window.open(value)
        }
    })
})();