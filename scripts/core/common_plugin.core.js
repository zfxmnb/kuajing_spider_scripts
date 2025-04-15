window.common_plugin_core = async () => {
    const matchDomains = ['www.gigab2b.com', 'www.saleyee.cn', 'www.temu.com', 'xhl.topwms.com', 'us.goodcang.com', 'returnhelper.com']
    const saleCheckout = 'https://www.saleyee.cn/user/order/confirm.html'
    const gigab2bCheckout = 'https://www.gigab2b.com/index.php?route=account/sales_order/sales_order_management'
    const topwmsCheckout = 'https://xhl.topwms.com/manual_order/index'
    const goodcangCheckout = 'https://us.goodcang.com/order/add'
    const checkoutUrls = [saleCheckout, gigab2bCheckout, topwmsCheckout, goodcangCheckout]
    const addressConfigs = {
        'United States': {
            value: '1',
            children: {
                "AL": "3",
                "AK": "4",
                "AS": "5",
                "AZ": "7",
                "AR": "8",
                "AE": "2",
                "AP": "6",
                "CA": "9",
                "CO": "10",
                "CT": "11",
                "DE": "12",
                "DC": "13",
                "FL": "15",
                "FM": "14",
                "GA": "16",
                "GU": "17",
                "HI": "18",
                "ID": "19",
                "IL": "20",
                "IN": "21",
                "IA": "22",
                "KS": "23",
                "KY": "24",
                "LA": "25",
                "ME": "26",
                "MH": "27",
                "MD": "28",
                "MA": "29",
                "MI": "30",
                "MN": "31",
                "MS": "32",
                "MO": "33",
                "MT": "34",
                "NE": "35",
                "NV": "36",
                "NH": "37",
                "NJ": "38",
                "NM": "39",
                "NY": "40",
                "NC": "41",
                "ND": "42",
                "MP": "43",
                "OH": "44",
                "OK": "45",
                "OR": "46",
                "PW": "47",
                "PA": "48",
                "PR": "49",
                "RI": "50",
                "SC": "51",
                "SD": "52",
                "TN": "53",
                "TX": "54",
                "UT": "55",
                "VT": "56",
                "VI": "57",
                "VA": "58",
                "WA": "59",
                "WV": "60",
                "WI": "61",
                "WY": "62"
            }
        }
    }
    // 
    // 一下内容在指定域名下生效
    if (!matchDomains.includes(window.location.host)) {
        return
    }
    // const ServiceCharge = 0.15
    const ServiceCharge = 0
    let rate
    function numberFixed (num, b = 2) {
        return Number(Number(num).toFixed(b)) || 0
    }
    const inputEvent = new Event('input', {
        'bubbles': true,
        'cancelable': true
    });
    const clickEvent = new Event('click', {
        'bubbles': true,
        'cancelable': true
    });

    // 防抖
    function debounce(func, wait = 1000) {
        let timeout;
        return function(...args) {
          const context = this;
          clearTimeout(timeout);
          timeout = setTimeout(() => {
            func.apply(context, args);
          }, wait);
        };
    }
     // 模糊匹配内容元素
     const findElementsByText = (text, parent = document) => {
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
            matchedNodes.push(node.parentElement);
        }
        return matchedNodes
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
    async function getRate(fromcoin = 'USD', tocoin = 'CNY', key = `fxrate_${fromcoin}_${tocoin}`) {
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
            return numberFixed(Number(fxrate.rate) * (ServiceCharge + 1), 6)
        }
        return request({url: `http://47.121.133.75:5430/exchange?fromcoin=${fromcoin}&tocoin=${tocoin}&money=1`})
        .then((response) => JSON.parse(response.responseText))
        .then((data) => {
            const value = JSON.stringify({rate: Number(data?.result?.money) || 7.25, date: current_date})
            window.localStorage.setItem(key, value)
            return numberFixed(Number(data?.result?.money) * (ServiceCharge + 1), 6)
        })
    }
    const currencyRegex = /(\$|USD)\s*(\d+(,\d{3})*(\.\d{1,2})?)/g
    document.body.addEventListener('dblclick', (e) => {
        const ele = e.target
        const text = e.target
        ele.childNodes.forEach(async (node) => {
            if (node.__back_text__) {
                node.nodeValue = node.__back_text__
                delete node.__back_text__
            } else if (node.nodeType === 3 && node.nodeValue) {
                if (!rate) {
                    rate = await getRate()
                }
                const text = node.nodeValue.replace(currencyRegex, (_, symbol, num) => {
                    return (symbol === '$' ? '¥' : 'CNY ') + numberFixed(Number(num) * rate)
                })
                if (node.nodeValue !== text) {
                    node.__back_text__ = node.nodeValue
                    node.nodeValue = text
                }
            }
        })
    })
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
    styles(`
    .common_plugin {
        display: flex;
        position: fixed;
        left: 0px;
        bottom: 0px;
        z-index: 9999;
        background: #fff;
        border: 1px solid #999;
        border-radius: 3px;
        padding: 0 6px;
        opacity: 0.8;
    }
    .common_plugin div {
        color: #000;
        font-size: 12px;
        gap:10px 20px;
        padding: 2px 5px;
        border-right: 1px solid;
    }
    .common_plugin div:last-child {
        border-right: none;
    }
    .common_plugin .addr_item_value, .common_plugin .sale_checkout_import, .common_plugin .topwms_checkout_import {
        cursor: pointer;
        font-size: 12px;
    }
    .hide {
        display: none;
    }
    `)
    const root = html(`<div class="common_plugin hide"></div>`)
    const app = root.querySelector('.common_plugin')
    if ( window.location.href.includes('xhl.topwms.com')) {
        let init = 0
        const observer = new MutationObserver(debounce(() => {
            const skuEleList = findElementsByText('SKU20')
            skuEleList.forEach((ele) => {
                if (ele && !ele.dataset.sku) {
                    const sku = ele.innerText
                    ele.dataset.sku = sku
                    const span = document.createElement('span')
                    span.dataset.sku = sku
                    span.innerHTML = `&nbsp;<a class="common_plugin_copy_link" style="font-size: 12px;" data-sku="${sku}" href="javascript:;">复制链接</a>`
                    ele.appendChild(span)
                    span.onclick = () => {
                        copyToClipboard(`https://xhl.topwms.com/warehouse/stock_list?sku=${sku}`)
                    }
                }
            })
            if (skuEleList?.length && init === 0) {
                init = 1
            }
            if (init === 1) {
                init = 2
                if (location.pathname.includes('/goods/management') || location.pathname.includes('/warehouse/stock_list')) {
                    const url = new URL(window.location.href);
                    const sku = url.searchParams.get('sku');
                    url.searchParams.delete('sku');
                    window.history.replaceState({}, '', url);
                    const input = document.querySelector('[placeholder="多个用逗号分隔"]')
                    input.value = sku
                    input.dispatchEvent(inputEvent)
                    document.querySelector('[type="submit"]').click()
                }
            }
        }, 1000));
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    const getData = async () => {
        const content = await getClipboardContent()
        let data = content
        if (typeof content === 'string' && /^\{/.test(content) && /\}$/.test(content)) {
            try {
                data = JSON.parse(content)
            }catch(err){}
        }
        if (!data?.parent_order_sn || !data?.post_code || !data?.receipt_name || !data?.mobile || !data?.address_line1) {
            return
        }
        return data
    }
    let readed = false
     const handle = async () => {
        const data = await getData()
        if (!data) {
            return
        }
        readed = true
        app.classList.remove('hide')
        app.dataSource = data
        let html = ''
        html+=`<div>ID：<span class="addr_item_value">${data?.parent_order_sn}</span></div>`
        html+=`<div>姓名：<span class="addr_item_value">${data?.receipt_name}</span></div>`
        html+=`<div>电话：<span class="addr_item_value">${data?.mobile}</span></div>`
        html+=`<div>街道1：<span class="addr_item_value">${data?.address_line1}</span></div>`
        if (data?.address_line2) {
            html+=`<div>街道2：<span class="addr_item_value">${data?.address_line2}</span></div>`
        }
        html+=`<div>国家：<span class="addr_item_value">${data?.region_name1}</span></div>`
        html+=`<div>省份：<span class="addr_item_value">${data?.region_name2}</span></div>`
        html+=`<div>城市：<span class="addr_item_value">${data?.region_name3}</span></div>`
        html+=`<div>邮编：<span class="addr_item_value">${data?.post_code}</span></div>`
        if (window.location.href.includes(saleCheckout)) {
            html+=`<div><a class="sale_checkout_import">一键导入</a></div>`
        }
        if (window.location.href.includes(topwmsCheckout)) {
            html+=`<div><a class="topwms_checkout_import">一键导入</a></div>`
        }
        if (window.location.href.includes(goodcangCheckout)) {
            html+=`<div><a class="goodcang_checkout_import">一键导入</a></div>`
        }
        app.innerHTML = html
        setTimeout(() => {
            if (window.location.href.includes(saleCheckout)) {
                const sale_platform = new URLSearchParams(location.search).get('sale_platform') || 'Temu'
                document.querySelector('#salePlatforms').nextElementSibling.querySelector(`dd[lay-value="${sale_platform}"]`).click()
                document.querySelector('.other_order_information .order-referno').value = data?.parent_order_sn
                document.querySelector('#tr_platformServices [value="BX0001"]').nextElementSibling.click()
                document.querySelector('#tr_platformServices [value="BX0002"]').nextElementSibling.click()
            }
        }, 1500)
    }
    if (checkoutUrls.some((url) => window.location.href.includes(url))) {
        setTimeout(() => {
            if(document.hasFocus()) {
                handle()
            }
        }, 1500)
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                document.hasFocus() && handle()
            } 
        })
        app.addEventListener('click', async (e) => {
            if(e.target.classList.contains('addr_item_value')) {
                copyToClipboard(e.target.innerText)
            }
        })
        app.addEventListener('click', async (e) => {
            if(e.target.closest('.sale_checkout_import')) {
                const ca = document.body.querySelector('.choose_address_container')
                const data = app.dataSource
                if (ca && data) {
                    ca.querySelector('#OrderConfirmFullName').value = data?.receipt_name || ''
                    ca.querySelector('#OrderConfirmPhoneNumber').value = data?.mobile || ''
                    ca.querySelector('#OrderConfirmEmail').value = data?.email || ''
                    ca.querySelector('#OrderConfirmAddress1').value = data?.address_line1 || ''
                    ca.querySelector('#OrderConfirmAddress2').value = data?.address_line2 || ''
                    const countryId = addressConfigs[data?.region_name1]?.value || '1'
                    ca.querySelector('#OrderConfirmCountryId').nextElementSibling.querySelector(`dd[lay-value="${countryId}"]`).click()
                    const sateProvinceId = addressConfigs[data?.region_name1]?.children?.[data?.region_name2]
                    await new Promise((r) => setTimeout(r, 1500))
                    ca.querySelector('#OrderConfirmStateProvinceId').nextElementSibling.querySelector(`dd[lay-value="${sateProvinceId}"]`).click()
                    ca.querySelector('#OrderConfirmCity').value = data?.region_name3
                    ca.querySelector('#OrderConfirmZipPostalCode').value = data?.post_code
                    ca.querySelector('.save_address_container button').click()
                }
            }
            if(e.target.closest('.topwms_checkout_import')) {
                const data = app.dataSource
                if (data) {
                    const orderSnEle = document.querySelector('[placeholder="若不填写，将自动生成订单号"]')
                    orderSnEle.value = data?.parent_order_sn || ''
                    orderSnEle.dispatchEvent(inputEvent)

                    const receiptNameEle = document.querySelector('[placeholder="请输入收件人姓名"]')
                    receiptNameEle.value = data?.receipt_name || ''
                    receiptNameEle.dispatchEvent(inputEvent)

                    const mobileEle = document.querySelector('[placeholder="请输入联系电话"]')
                    mobileEle.value = data?.mobile || ''
                    mobileEle.dispatchEvent(inputEvent)

                    document.querySelector('[placeholder="请选择国家/地区"]').click()
                    await new Promise((r) => setTimeout(r, 1000))
                    document.querySelector('[role="dialog"][aria-label="已选择国家/地区"] [type="radio"][value="15"]').click()
                    await new Promise((r) => setTimeout(r, 1000))
                    document.querySelector('[role="dialog"][aria-label="已选择国家/地区"] .jx-dialog__footer button.jx-button--primary').click()

                    const regionName2Ele = document.querySelector('[placeholder="请输入省/州"]')
                    regionName2Ele.value = data?.region_name2 || ''
                    regionName2Ele.dispatchEvent(inputEvent)

                    const regionName3Ele = document.querySelector('[placeholder="请输入城市"]')
                    regionName3Ele.value = data?.region_name3 || ''
                    regionName3Ele.dispatchEvent(inputEvent)

                    const postCodeEle = document.querySelector('[placeholder="请输入邮编"]')
                    postCodeEle.value = data?.post_code || ''
                    postCodeEle.dispatchEvent(inputEvent)

                    const addressEle = document.querySelector('[placeholder="请输入详细地址"]')
                    addressEle.value = (data?.address_line1 || '') + (data?.address_line2 ? `,${data?.address_line2}` : '')
                    addressEle.dispatchEvent(inputEvent)
                }
            }
            if(e.target.closest('.goodcang_checkout_import')) {
                const data = app.dataSource
                if (data) {
                    await new Promise((r) => setTimeout(r, 1))
                    const ca = document.querySelector('[data-sign="outbound_order_fba_address"]')
                    const receiptNameEle = ca.querySelector('[data-sign="address.consignee_name"]')?.querySelector('input')
                    receiptNameEle.value = data?.receipt_name || ''
                    receiptNameEle.dispatchEvent(inputEvent)

                    findElementsByText('US[美国]', document.querySelector('[title="常用国家/地区"]')?.nextElementSibling)?.[0]?.click?.()
                    
                    const regionName2Ele = ca.querySelector('[data-sign="address.state"]')?.querySelector('input')
                    regionName2Ele.value = data?.region_name2 || ''
                    regionName2Ele.dispatchEvent(inputEvent)
                    
                    const regionName3Ele = ca.querySelector('[data-sign="address.city"]')?.querySelector('input')
                    regionName3Ele.value = data?.region_name3 || ''
                    regionName3Ele.dispatchEvent(inputEvent)
                    
                    const postCodeEle = ca.querySelector('[data-sign="address.post_code"]')?.querySelector('input')
                    postCodeEle.value = data?.post_code || ''
                    postCodeEle.dispatchEvent(inputEvent)

                    const address1Ele = ca.querySelector('[data-sign="address.street1"]')?.querySelector('input')
                    address1Ele.value = data?.address_line1 || ''
                    address1Ele.dispatchEvent(inputEvent)

                    const address2Ele = ca.querySelector('[data-sign="address.street2"]')?.querySelector('input')
                    address2Ele.value = data?.address_line2 || ''
                    address2Ele.dispatchEvent(inputEvent)

                    const mobilePrefix = ca.querySelector('[data-sign="address.phone"]')?.querySelector('.ant-select-selection__rendered input')
                    mobilePrefix.dispatchEvent(clickEvent)
                    await new Promise((r) => setTimeout(r, 1000))
                    findElementsByText('1-US')?.[0]?.click?.()

                    const mobileEle = ca.querySelector('[data-sign="address.phone"]')?.querySelector('.show-char-num-text input')
                    mobileEle.value = data?.mobile || ''
                    mobileEle.dispatchEvent(inputEvent)

                }
            }
        })
        document.body.addEventListener('click', (e) => {
            if(!readed) {
                handle()
            }
        })
    }
}