let runed = false
window.dianxiaomi_core = async () => {
    if (runed) true
    console.log('dianxiaomi_core_v2 running', '202505261317')
    runed = true
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
        let shop = document.querySelector?.('#rc_select_0');
        if (!shop) {
            await polling(() => {
                shop = document.querySelector?.('#rc_select_0');
                return !!shop
            }, 300, 30000)
        }
        // 店铺选择
        const shopSelector = shop?.closest?.('.ant-select-selector')
        const shopPlaceholder = shopSelector.querySelector('.ant-select-selection-placeholder')
        if (shopPlaceholder) {shopSelector?.dispatchEvent?.(new Event('mousedown'))}
        shop.addEventListener('blur', () => {
            setTimeout(() => {
                const name = shopSelector.querySelector('.ant-select-selection-item').getAttribute('title')
                name && window.localStorage?.setItem('__previous_shop_name__', name)
            })
        })
        setTimeout(() => {
            if (shopPlaceholder) {
                const name = window.localStorage?.getItem('__previous_shop_name__')
                const prevShop = document.querySelector?.(`#rc_select_0_list + div .rc-virtual-list-holder-inner > div[title="${name}"]`);
                if (prevShop) {
                    prevShop?.click()
                } else {
                    document.querySelector?.(`#rc_select_0_list + div .rc-virtual-list-holder-inner > div`)?.click?.()
                }
            }
        })
        await sleep(3000)
        // 分类选择
        const category = document.querySelector?.('#rc_select_2');
        const categorySelector = category?.closest?.('.ant-select-selector')
        const categoryPlaceholder = categorySelector.querySelector('.ant-select-selection-placeholder')
        if (categoryPlaceholder) {
            categorySelector?.dispatchEvent?.(new Event('mousedown'))
        }
        setTimeout(async () => {
            if (categoryPlaceholder) {
                const firstCategory = document.querySelector?.(`#rc_select_2_list + div .rc-virtual-list-holder-inner > div[id]`);
                if (firstCategory) {
                    firstCategory?.click()
                } else {
                    category?.closest?.('.ant-select')?.nextElementSibling?.click?.()
                    await sleep(200);
                    const searchCategory = document.querySelector('[name="searchCategory"]')
                    if (searchCategory) {
                        searchCategory.value = '室外水箱'
                        searchCategory?.dispatchEvent?.(new Event('change'))
                        await sleep(200);
                        searchCategory?.nextElementSibling?.querySelector('button')?.click?.()
                        await sleep(2500)
                        searchCategory.closest('.modal-body')?.querySelector('.search-result-item')?.click()
                    }
                }
            }
        }, 100)
        // 数据读取
        payloadBtn?.click?.()
    })()

    importBtn?.addEventListener?.('click', async () => {
        // 来源URL
        setInput('#form_item_sourceList_0_path', payload.sourceUrl)
        // 中文标题
        setInput(document.querySelector('#productProductInfo .ant-form-item label[title="产品标题"]')?.closest('.ant-form-item').querySelector('.ant-input'), payload.title_CN)
        // 英文标题
        setInput(document.querySelector('#productProductInfo .ant-form-item label[title="英文标题"]')?.closest('.ant-form-item').querySelector('.ant-input'), payload.title)
        // 商品id
        setInput('.productNumber', payload.skuId)
        // 产地
        const productOrigin = document.querySelector?.('[title="请选择省份"]');
        const productOriginSelector = productOrigin?.closest?.('.ant-select-selector')
        productOriginSelector?.dispatchEvent?.(new Event('mousedown'))
        setTimeout(() => getGlobalEle('.ant-select-item[title="广东省"]')?.click?.(), 100)
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
        // 颜色属性
        const colorCon = document.querySelector('.ant-select-selection-item[title="颜色"]')?.closest('.ant-select')?.nextElementSibling
        if (colorCon) {
            const colorCheckbox = colorCon.querySelector('.checkbox-input')
            if (!colorCheckbox) {
                const colorInput = colorCon.querySelector('.ant-input')
                setInput(colorInput, payload.colors?.[0] ?? 'unknown')
                await sleep(200);
                colorInput?.nextElementSibling?.click?.()
                await sleep(1000)
            }
        }
        // 变种信息
        setInput('#skuDataInfo .skuDataTable [name="variationSku"]', payload.skuId)
        setInput('#skuDataInfo .skuDataTable [name="price"]', numberFixed(payload.price_CNY * priceRate))
        setInput('#skuDataInfo .skuDataTable [name="skuLength"]', payload.size?.[0])
        setInput('#skuDataInfo .skuDataTable [name="skuWidth"]', payload.size?.[1])
        setInput('#skuDataInfo .skuDataTable [name="skuHeight"]', payload.size?.[2])
        setInput('#skuDataInfo .skuDataTable [name="weight"]', payload.weight)
        const skuWarehouse = document.querySelector('#skuDataInfo .skuWarehouse')
        if (skuWarehouse && !skuWarehouse.querySelector('.ant-select-selection-item')) {
            const skuWarehouseSelector = skuWarehouse.querySelector('.ant-select-selector')
            await sleep(200);
            skuWarehouseSelector?.dispatchEvent?.(new Event('mousedown'))
            await sleep(1500)
            const dropdown = getGlobalEle('.ant-select-dropdown')
            dropdown.querySelector?.('.rc-virtual-list .ant-select-item')?.click?.()
            skuWarehouseSelector.querySelector('input')?.dispatchEvent?.(new Event('blur'))
            await sleep(200);
            setInput('#skuDataInfo .skuWarehouse [name="stock"]', numberFixed(payload.stock * stockRate, 0))
        }
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
        // 包装信息
        const innerPackageSelector = document.querySelector('#packageInfo [title="外包装形状"]')?.closest('.ant-form-item')?.querySelector('.ant-select-selector')
        if (innerPackageSelector) {
            innerPackageSelector?.dispatchEvent?.(new Event('mousedown'))
            setTimeout(() => getGlobalEle('.rc-virtual-list [title="长方体"]')?.click?.(), 100)
        }
        const outerPackageSelector = document.querySelector('#packageInfo [title="外包装类型"]')?.closest('.ant-form-item')?.querySelector('.ant-select-selector')
        if (outerPackageSelector) {
            outerPackageSelector?.dispatchEvent?.(new Event('mousedown'))
            setTimeout(() => getGlobalEle('.rc-virtual-list [title="硬包装"]')?.click?.(), 100)
        }
        const packageImgItem = document.querySelector('#packageInfo .img-list .img-item')
        if (!packageImgItem) {
            const packageImageCon = document.querySelector('#packageInfo .ant-form-item label[title="外包装图片"]')?.closest('.ant-form-item')
            const packageImageButton = packageImageCon.querySelector('button')
            if (packageImageButton) {
                packageImageButton?.dispatchEvent?.(new Event('mouseenter'))
                await sleep(200);
                getGlobalEle('[data-menu-id="net"]')?.click?.()
                packageImageButton?.dispatchEvent?.(new Event('mouseleave'))
                await sleep(200);
                const netImgUrl = getGlobalEle('[placeholder="请填写图片URL地址，多个地址用回车换行"]')
                setInput(netImgUrl, 'https://img.myshopline.com/image/official/477168e554ab409cad55a46005699cf1.jpeg')
                netImgUrl?.closest?.('.ant-modal-content')?.querySelector('.ant-btn-primary')?.click?.()
            }
        }
        // 运输配置
        const ship2dayRadio = document.querySelector('#shipmentInfo input[value="172800"]')
        if (ship2dayRadio) ship2dayRadio.click()
        const shipmentInfoSelector = document.querySelector('#shipmentInfo [title="运费模板"]')?.closest('.ant-form-item')?.querySelector('.ant-select-selector')
        shipmentInfoSelector?.dispatchEvent?.(new Event('mousedown'))
        await sleep(1500)
        getGlobalEle('.rc-virtual-list .ant-select-item[id]')?.click?.()
        // 产品详情
        interceptor?.((data) => {
            interceptor(void 0)
            if (data?.description) return {}
            const list = []
            let priority = 0
            payload.description?.forEach?.((text) => {
                list.push({
                    "lang":"zh", "type":"text", "priority":`${priority++}`,
                    "contentList": {
                        "text": text,
                        "textModuleDetails": {
                            "fontFamily": null,
                            "fontSize": "12",
                            "fontColor": "#000000",
                            "align": "left",
                            "backgroundColor": "#ffffff"
                        }
                    }
                })
            })
            payload.detail_images?.forEach?.((imgUrl) => {
                list.push( {
                    "lang":"zh", "type":"image", "priority":`${priority++}`,
                    "contentList": {
                        "imgUrl": imgUrl,
                        "width": 800,
                        "height": 800
                    }
                })
            })
            return {
                description: JSON.stringify(list)
            }
        })
        setTimeout(() => {findElementsByText('保存', document.body, (ele) => ele.closest('.btn-orange'))[0]?.click?.()}, 1000)
        polling(() => {
            const ele = document.querySelector('.ant-modal-wrap .ant-btn-primary')
            const display = judgmentDisplay(ele)
            if (display) {ele?.click?.()}
            return display
        }, 500)
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
//     dianxiaomi_core();
// })();