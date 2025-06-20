let runed = false
window.dianxiaomi_shein_core = async () => {
    if (runed) true
    console.log('dianxiaomi_core_shein running', '202506141048')
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
    let priceRate = Number(window.localStorage?.getItem?.('__price_rate_shein__') || '1')
    priceRate = isNaN(priceRate) ? 1 : priceRate
    priceRateInput && (priceRateInput.value = priceRate)
    let stockRate = Number(window.localStorage?.getItem?.('__stock_rate_shein__') || '1')
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
            window.localStorage?.setItem?.('__price_rate_shein__', value)
        }
    })
    stockRateInput?.addEventListener('change', (e) => {
        const value = Number(e.target?.value)
        if (!isNaN(value)) {
            stockRate = value
            window.localStorage?.setItem?.('__stock_rate_shein__', value)
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
        await sleep(1000)
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
                await sleep(1000)
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
        document.querySelector(`#spuImageTable .tuiImageEditorBox [onclick="SHEIN_PRODUCT_IMAGE_UP.imageFn.thumbnailImg(this, '3');"]`)?.click()
        await sleep(100);
        document.querySelector('#commProductNetImgUrl').value = payload.images?.[0]
        await sleep(100);
        window.PRODUCT_COMM.networkImgConfirm();
        await sleep(100);
        window.IMGRESIZE.modalBuild('spuImgList .dropDownSelectGoods', SHEIN_PRODUCT_IMAGE_UP.imageFn.resizeCall, '.tuiImageBox')
        await sleep(1000);
        let setlen = document.querySelector('#imgResize [name="setlen"]')
        if (setlen) {
            document.querySelector('#imgResize #ratioSelect').value = 0
            await sleep(100);
            document.querySelector('#imgResize #modifyRatio').value = 0
            if (!setlen.value) { setInput(setlen, '900') }
            const remenberSettings = document.querySelector('#imgResize [name="remenberSettings"]')
            if (!remenberSettings.checked) {
                remenberSettings.click()
            }
            await sleep(100);
            window.IMGRESIZE?.beforeResize?.(document.querySelector('#imageScaleSelect')?.nextElementSibling, true, 'jpeg');
            const resizeModal = document.querySelector('#imgResize');
            if (resizeModal) {
                await polling(() => !judgmentDisplay(resizeModal))
            }
        }
        // 颜色
        const colorInput = document.querySelector('#skuInfoArrBox .masterVariantTr .attrOtherBox input')
        setInput(colorInput, payload.colors?.[0] ?? 'unknown')
        colorInput?.nextElementSibling?.click()
        await sleep(500);
        // 变种信息
        setInput('#skuInfoTable [name="skuName"]', payload.skuId)
        setInput('#skuInfoTable [name="supplyPrice"]', numberFixed(payload.price * priceRate))
        setInput('#skuInfoTable [name="skuStock"]', numberFixed(payload.stock * stockRate, 0))
        setInput('#skuInfoTable [name="skuWeight"]', payload.weight)
        setInput('#skuInfoTable [name="skuLength"]', payload.size?.[0] == 900 ? 899: payload.size?.[0])
        setInput('#skuInfoTable [name="skuWidth"]', payload.size?.[1])
        setInput('#skuInfoTable [name="skuHeight"]', payload.size?.[2])
        const thumbnailImgSrc = document.querySelector(`#spuImageTable .tuiImageEditorBox .imgUrl`).src
        if (thumbnailImgSrc) {
            document.querySelector(`#skuInfoTable [onclick="SHEIN_PRODUCT_IMAGE_UP.imageFn.thumbnailImg(this, 3);"]`)?.click()
            await sleep(100);
            document.querySelector('#commProductNetImgUrl').value = thumbnailImgSrc
            await sleep(100);
            window.PRODUCT_COMM.networkImgConfirm();
            await sleep(100);
        }
        // 变种图片
        document.querySelector(`#skuImgBox .detailImgTd [onclick="SHEIN_PRODUCT_IMAGE_UP.imageFn.uploadImg('3', this)"]`)?.click()
        await sleep(100);
        document.querySelector('#commProductNetImgUrl').value = payload.images?.join('\n')
        await sleep(100);
        window.PRODUCT_COMM.networkImgConfirm();
        await sleep(100);
        window.IMGRESIZE.modalBuild('detailImgTd:not(.notEditAble)', SHEIN_PRODUCT_IMAGE_UP.imageFn.resizeCall, 'shein');
        await sleep(1000);
        setlen = document.querySelector('#imgResize [name="setlen"]')
        if (setlen) {
            if (!setlen.value) { setInput(setlen, '900') }
            const remenberSettings = document.querySelector('#imgResize [name="remenberSettings"]')
            if (!remenberSettings.checked) {
                remenberSettings.click()
            }
            await sleep(100);
            window.IMGRESIZE?.beforeResize?.(document.querySelector('#imageScaleSelect')?.nextElementSibling, true, 'jpeg');
            const resizeModal = document.querySelector('#imgResize');
            if (resizeModal) {
                await polling(() => !judgmentDisplay(resizeModal))
            }
        }
        // 方形图
        document.querySelector(`#skuImgBox .squareImgTd [onclick="SHEIN_PRODUCT_IMAGE_UP.imageFn.thumbnailImg(this, '3');"]`)?.click()
        await sleep(100);
        document.querySelector('#commProductNetImgUrl').value = payload.images?.[0]
        await sleep(100);
        window.PRODUCT_COMM.networkImgConfirm();
        await sleep(100);
        window.IMGRESIZE.modalBuild('squareImgTd:not(.notEditAble)', SHEIN_PRODUCT_IMAGE_UP.imageFn.resizeCall, 'shein');
        await sleep(1000);
        setlen = document.querySelector('#imgResize [name="setlen"]')
        if (setlen) {
            document.querySelector('#imgResize #ratioSelect').value = 1
            await sleep(100);
            document.querySelector('#imgResize #imageWidthHeightSel').value = 'custom'
            if (!setlen.value) { setInput(setlen, '900') }
            setInput('#imgResize [name="setCustomLen"]', '900')
            const remenberSettings = document.querySelector('#imgResize [name="remenberSettings"]')
            if (remenberSettings.checked) {
                remenberSettings.click()
            }
            await sleep(100);
            window.IMGRESIZE?.beforeResize?.(document.querySelector('#imageScaleSelect')?.nextElementSibling, true, 'jpeg');
            const resizeModal = document.querySelector('#imgResize');
            if (resizeModal) {
                await polling(() => !judgmentDisplay(resizeModal))
            }
        }
        // 详情图
        document.querySelector(`#particularImgInfo [onclick="SHEIN_PRODUCT_IMAGE_UP.particularImgFn.uploadParticularImg('3', this)"]`)?.click()
        await sleep(100);
        const detail_images = payload?.detail_images ?? []
        let list = [...(payload?.detail_images ?? [])]
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
        document.querySelector('#commProductNetImgUrl').value = list?.join('\n')
        await sleep(100);
        window.PRODUCT_COMM.networkImgConfirm();
        await sleep(100);
        window.IMGRESIZE.modalBuild('particularImgItem', SHEIN_PRODUCT_IMAGE_UP.imageFn.resizeCall, 'shein');
        await sleep(1000);
        setlen = document.querySelector('#imgResize [name="setlen"]')
        if (setlen) {
            document.querySelector('#imgResize #ratioSelect').value = 0
            await sleep(100);
            document.querySelector('#imgResize #modifyRatio').value = 0
            if (!setlen.value) { setInput(setlen, '900') }
            const remenberSettings = document.querySelector('#imgResize [name="remenberSettings"]')
            if (!remenberSettings.checked) {
                remenberSettings.click()
            }
            await sleep(100);
            window.IMGRESIZE?.beforeResize?.(document.querySelector('#imageScaleSelect')?.nextElementSibling, true, 'jpeg');
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

// (async function() {
//     dianxiaomi_shein_core();
// })();