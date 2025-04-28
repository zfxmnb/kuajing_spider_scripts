window.temu_helper_v2_core = async () => {
    console.log('temu_helper_v2_core running')
    if (window.self !== window.top || window.location.pathname === '/mmsos/print.html') return
    let mallId = window.rawData?.store?.mallid || window.localStorage.getItem('mall-info-id') || window.localStorage.getItem('agentseller-mall-info-id') || window.localStorage.getItem('dxmManualCrawlMallId')
    try {
        mallId = await getMallId()
    } catch(err) {console.error(err)}
    // -----------------------------------------------------------------------------
    // 配置
    const ConfigMap = unsafeWindow.top._temu_helper_config_map_ || window.top._temu_helper_config_map_ || { // 端口map
        "default": {
            Name: "",
            Port: 5431,
        }, // 默认端口
        // ...可以补充其他店铺端口
    }
    const Name = ConfigMap[mallId]?.Name || ConfigMap['default']?.Name || ""  // 本地服务端口
    const Port = ConfigMap[mallId]?.Port || ConfigMap['default']?.Port || 5431  // 本地服务端口
    const User = ConfigMap[mallId]?.User || ConfigMap['default']?.User // 账号
    const Password = ConfigMap[mallId]?.Password || ConfigMap['default']?.Password // 密码
    const Host = '127.0.0.1' // host
    const Origin = `http://${Host}:${Port}`
    const pollingInterval = 15 * 60 * 1000 + Math.round(Math.random() * 15 * 1000) // 轮询代发货订单及平台处理中订单
    const oneDay = 24 * 60 * 60 * 1000
    const checkoutDays = 30
    // const CacheKey = '__temu_products__'
    const seller = window.location.host.includes('seller.kuajingmaihuo.com')
    const agentSeller = window.location.host.includes('agentseller.temu.com') || window.location.host.includes('agentseller-us.temu.com')
    const orderStatusMap = {
        1: '平台处理中',
        2: '未发货',
        4: '已发货',
        5: '已完成',
        3: '已取消',
    }
    const ReductionInterval = 0 // 30 * 60 * 1000 // 批量改价检查间隔，0则不检查
    // 授权
    if (window.location.pathname === '/main/authentication') {
        setTimeout(() => {
           document.documentElement.focus();
           document.querySelector('[data-testid="beast-core-icon-right"]')?.parentElement?.click?.()
        }, 2000)
        return
    }
    // 登录
    if (window.location.pathname === '/settle/seller-login') {
        setTimeout(() => {
            const checkbox = document.querySelector('[data-testid="beast-core-icon-check"]')?.parentElement?.previousElementSibling
            if (!checkbox?.checked) {
                document.querySelector('[data-testid="beast-core-icon-check"]')?.parentElement?.previousElementSibling?.click?.()
            }
            document.documentElement.focus();
            document.querySelector('#usernameId')?.click?.()
            document.querySelector('#usernameId')?.focus?.()
            setTimeout(() => {
                document.querySelector('[data-testid="beast-core-button"]')?.click?.()
            }, 200)
        }, 2000)
        return
    }
    async function excelLoad(excelUrl) {
        try {
            const response = await fetch(excelUrl);
            if (!response.ok) throw new Error('网络错误');
            const data = await response.arrayBuffer();
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 0 });
            return jsonData
        } catch (error) {
            alert('加载失败: ' + error.message);
        }
    }
    function setExactInterval(fn, interval = 0) {
        // 计时器脚本
        const workerScript = `const t = setInterval(function() { postMessage("") }, ${interval});onmessage = function(){ clearInterval(t); close() };`;
        // 创建 Blob 对象
        const blob = new Blob([workerScript], { type: 'application/javascript' });
        const worker = new Worker(URL.createObjectURL(blob));
        // 处理 Worker 消息
        worker.onmessage = fn;
        return function () {
            worker.postMessage('');
        };
    }
    // -----------------------------------------------------------------------------
    // 检测本地存储
    function isLocalStorageFull() {
        const test = '_1234567890_1234567890_1234567890_1234567890_1234567890_1234567890_1234567890_1234567890_1234567890_1234567890_1234567890_';
        try {
            localStorage.setItem(test, test);
            localStorage.removeItem(test);
            return false;
        } catch (e) {
            return true;
        }
    }
    // 超出先清空本地缓存
    if (isLocalStorageFull()) localStorage.clear()

    // 基础方法
    function getCache(key) {
        try {
            const str = window.localStorage.getItem(key)
            if (str) {
                return JSON.parse(str)
            }
        } catch(err){}
        return {}
    }
    function setCache(key, value) {
        try {
            window.localStorage.setItem(key, JSON.stringify(value))
        } catch(err) {}
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
    // clone
    function deepClone(obj) {
        if (obj === null || typeof obj !== 'object') {
            return obj;
        }
        if (Array.isArray(obj)) {
            const arrCopy = [];
            for (let i = 0; i < obj.length; i++) {
                arrCopy[i] = deepClone(obj[i]);
            }
            return arrCopy;
        }
        const objCopy = {};
        for (let key in obj) {
            if (obj.hasOwnProperty(key)) {
                objCopy[key] = deepClone(obj[key]);
            }
        }
        return objCopy;
    }
    // copy
    async function copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            console.log('Text copied to clipboard');
        } catch (err) {
            console.error('Failed to copy text: ', err);
        }
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
    // 倒入样式
    function styles(content){
        const style = document.createElement('style');
        style.innerText = content
        document.body.appendChild(style)
        return style
    }
    // 插入元素
    function html(content){
        const div = document.createElement('div');
        div.innerHTML = content
        document.body.appendChild(div)
        return div
    }
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
    // 浮点格式化
    function numberFixed (num, d = 2) {
        return Number(Number(num).toFixed(d)) || 0
    }
    // --------------------------------------------------------------------------------------------
    // 公共代码
    let currentData = []
    let currentDataMap = {}
    let currentDataTime = null
    let currentOrderData = []
    let currentOrderDataMap = {}
    let currentTodayOrderData = []
    let currentOrderDataTime = null
    // 获取商城ID
    async function getMallId () {
        if (mallId) return mallId
        return await fetch("/bg/quiet/api/mms/userInfo", {
            "headers": {
                "content-type": "application/json",
            },
            "body": "{}",
            "method": "POST",
        }).then(response => response.json()).then((data) => {
            if (!data?.result) {
                console.error('/bg/quiet/api/mms/userInfo 接口请求失败', data)
                if (!mallId) {
                    return Promise.reject(data)
                }
            }
            if (data?.result?.companyList?.[0]?.malInfoList?.[0]?.mallId) {
                mallId = data?.result?.companyList?.[0]?.malInfoList?.[0]?.mallId
            }
            return mallId
        })
    }
    function arr2Map (list, keyIndex = 0, onlyone) {
        const listMap = {}
        const repeatKey = []
        list.forEach((item, index) => {
            const key = item[keyIndex]
            if (key) {
                if (listMap[key]) {
                    repeatKey.push(key)
                }
                listMap[key] = { index, ...item }
            }
        })
        if (onlyone) {
            repeatKey.forEach((key) => {
                delete listMap[key]
            })
        }
        return listMap
    }
    function setCurrentData(data, excelFile) {
        currentData = data
        currentDataMap = arr2Map(currentData, 'sku')
        const temu_download = root.querySelector('#temu_download')
        if (excelFile) {
            temu_download.href = `${Origin}/api/temu/download/${excelFile}`
            temu_download.classList.remove('hide')
        } else {
            temu_download.href = ''
            temu_download.classList.add('hide')
        }
        setTimeout(() => {
            productUpdate()
        }, 1000)
    }
    function setCurrentOrderData(data, excelFile) {
        currentOrderData = data
        currentOrderDataMap = arr2Map(currentOrderData, 'id')
        const d = new Date()
        d.setHours(0, 0, 0, 0)
        const todayFirst = d.getTime()
        const validStatusMap = {2: 1, 4: 1, 5: 1, '未发货': 1, '已发货': 1, '已完成': 1}
        currentTodayOrderData = []
        currentOrderData.forEach((order) => {
            const ts = order.createTs ?? new Date(order.createTime).getTime();
            if (validStatusMap[order.orderStatus] && ts > todayFirst) {
                currentTodayOrderData.push(order)
            }
        })
        const temu_order_download = root.querySelector('#temu_order_download')
        if (excelFile) {
            temu_order_download.href = `${Origin}/api/temu/download/${excelFile}`
            temu_order_download.classList.remove('hide')
        } else {
            temu_order_download.href = ''
            temu_order_download.classList.add('hide')
        }
        setTimeout(() => {
            orderUpdate()
        }, 1000)
    }
    // 通知
    function notice(title, content = '') {
        return request({
            url: `${Origin}/api/temu/notice`,
            method: 'POST',
            data: JSON.stringify({title, content}),
            headers: { 'Content-Type': 'application/json' }
        })
        .then(response => JSON.parse(response.responseText))
        .catch(error => {
            console.error("Error fetching data:", error);
        });
    }
    let logoutRequestCount = 0
    function logoutNotice () {
        const record = getCache(`${Name}__logoutNoticeRecord__`) || {}
        const now = Date.now()
        logoutRequestCount += 1
        if (logoutRequestCount > 2 && (!record?.expire || record.expire < now)) {
            notice((Name ? `【${Name}】` : '') + '[登录异常]', `登录异常，可能影响订单推送，请检查(${logoutRequestCount})`)
            record.expire = now + 6 * 60 * 60 * 1000
            setCache(`${Name}__logoutNoticeRecord__`, record)
            window.location.reload?.()
        }
    }
    // 获取商品数据
    const getTemuProductSkuList = async (page = 0) => {
        let pageItems = []
        let total = 1
        while (pageItems.length < total) {
            page += 1
            const result = await fetch('/bg-visage-mms/product/skc/pageQuery', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    "mallid": await getMallId(),
                },
                body: JSON.stringify({
                    page,
                    pageSize: 100,
                    skcTopStatus: 100
                })
            })
            .then(response => response.json())
            .then((data) => {
                if (!data?.result) {
                    console.error('/bg-visage-mms/product/skc/pageQuery 接口请求失败', data)
                    return Promise.reject(data)
                }
                return data?.result
            })
            if (result) {
                total = result.total
                pageItems = pageItems.concat(result.pageItems)
            } else {
                total = pageItems.length
            }
        }
        const skus = []
        pageItems.forEach(({ productSkuSummaries, productId, productSkcId, productName }) => {
            productSkuSummaries?.forEach(({ productSkuId, supplierPrice, siteSupplierPrices, virtualStock, productSkuSpecList }) => {
                const specList = productSkuSpecList?.map(({specName }) => specName)
                skus.push({ spu: productId, skc: productSkcId, sku: productSkuId, title: productName, price: numberFixed((siteSupplierPrices?.[0]?.supplierPrice ?? supplierPrice) / 100), stock: virtualStock, specList, skuNum: productSkuSummaries?.length || 1 })
            })
        })
        return skus
    }
    async function getTemuRefundList(groupSearchType = 2106, page = 1, scopeType = 0) {
        let timeSearchType = 5000 + (Number(scopeType) || 0)
        const result = await fetch('/garen/mms/afterSales/queryReturnAndRefundPaList', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                "mallid": await getMallId(),
            },
            body: JSON.stringify({
                "pageNumber": page,
                "pageSize": 10,
                "reverseSignedTimeSearchType": 7000,
                "groupSearchType": groupSearchType,
                "timeSearchType": timeSearchType,
                "selectOnlyRefund": true,
                "selectReturnRefund": true
            })
        })
        .then(response => response.json())
        .then((data) => {
            if (data.error_code == 40001 || !data?.result) {
                console.error('/garen/mms/afterSales/queryReturnAndRefundPaList 接口请求失败', data)
                // 登录异常通知
                if (data.error_code == 40001) {
                    logoutNotice()
                }
                return Promise.reject(data)
            }
            return data?.result?.mmsPageVO
        })
        return result
    }
    async function getTemuRefunds(groupSearchType = 2106, scopeType = 0) {
        let pageItems = []
        let total = 19
        let page = 0
        while (pageItems.length < total) {
            page += 1
            const result = await getTemuRefundList(groupSearchType, page, scopeType)
            if (result) {
                // total = result.totalCount
                pageItems = pageItems.concat(result.data || [])
            } else {
                total = pageItems.length
            }
        }
        const afterSales = []
        pageItems?.forEach?.(({ parentAfterSalesSn, parentOrderSn, afterSalesItemVOList, createdAt } = {}) => {
            afterSales.push({
                id: parentAfterSalesSn,
                orders: afterSalesItemVOList?.map(({ orderSn, orderStatus, productSkuId: sku, goodsName } = {}) => {
                    const id = `${orderSn}_${sku}`
                    const quantity = currentOrderDataMap[id]?.quantity || 1
                    const p = currentDataMap[sku]?.price === '#' ? 0 : (currentDataMap[sku]?.price ? numberFixed(currentDataMap[sku]?.price * quantity) : currentOrderDataMap[id]?.price || 0)
                    const price = currentOrderDataMap[id]?.price || p
                    const cp = currentDataMap[sku]?.costPrice ? numberFixed(currentDataMap[sku]?.costPrice * quantity) : price
                    const oldCostPrice = currentOrderDataMap[id]?.costPrice
                    const costPrice = price > 0 && !oldCostPrice ? cp : oldCostPrice || 0
                    let profit = currentOrderDataMap[id]?.profit
                    let profitMargin = currentOrderDataMap[id]?.profitMargin
                    return {
                        id,
                        orderStatus: orderStatus ?? '异常',
                        orderStatusText: orderStatusMap[orderStatus] || '异常',
                        parentOrderId: parentOrderSn,
                        orderId: orderSn,
                        sku,
                        title: currentOrderDataMap[id]?.title || goodsName,
                        quantity: currentOrderDataMap[id]?.quantity || 1,
                        price,
                        costPrice,
                        profit,
                        profitMargin,
                        link: currentOrderDataMap[id]?.link || currentDataMap[sku]?.link || null,
                        createTime: createdAt,
                        createTs: new Date(createdAt).getTime(),
                        tag: currentOrderDataMap[id]?.tag || '',
                    }
                })
            })
        })
        return afterSales
    }
    // 强制更新爬虫
    function forceUpdate () {
        request({
            url: `${Origin}/api/temu/force_update`,
            method: 'POST',
            data: JSON.stringify({}),
            headers: { 'Content-Type': 'application/json' }
        })
        .then(response => JSON.parse(response.responseText))
        .then(({ code }) => {
            if (code === 3) {
                setTimeout(() => {
                    alert('有正在执行任务，请稍后再试')
                })
            } else if (code === 0) {
                setTimeout(() => {
                    alert('成功执行')
                })
            }
        })
        .catch(error => {
            console.error("Error fetching data:", error);
        });
    }
    // 获取商品数据
    function getProductsData() {
        return request({
            url: `${Origin}/api/temu/products/get`,
        })
            .then(response => JSON.parse(response.responseText))
            .then(({ data, readFile, lmt, excelFile }) => {
                if (data?.length) {
                    setCurrentData(data, excelFile)
                    if (lmt) currentDataTime = lmt
                    root.querySelector('#temu_spider')?.classList?.remove('hide')
                }
                if (seller) root.querySelector('#temu_products_sync')?.classList?.remove('hide')
                return
            })
            .catch(error => {
                console.error("Error fetching data:", error);
                // if (seller) root.querySelector('#temu_products_sync')?.classList?.remove('hide')
            });
    }
    function setStatistics(data) {
        const statistics = root.querySelector('#temu_orders_statistics')
        statistics?.classList?.remove('hide')
        let totalAmount = 0
        let totalCostAmount = 0
        let totalQuantity = 0
        let todayTotalAmount = 0
        let todayTotalCostAmount = 0
        let todayTotalQuantity = 0
        let unsettledAmount = 0
        let unsettledCostAmount = 0

        data.forEach((item) => {
            if (item.settled === false) {
                unsettledAmount += item?.price ?? 0
                unsettledCostAmount += item?.costPrice ?? 0
            }
            totalQuantity += item['quantity'] ?? 0
            totalAmount += item['price'] ?? 0
            totalCostAmount += item['costPrice'] ?? 0
        })
        currentTodayOrderData.forEach((item) => {
            todayTotalQuantity += item['quantity'] ?? 0
            todayTotalAmount += item['price'] ?? 0
            todayTotalCostAmount += item['costPrice'] ?? 0
        })
        const format  = (num, noZero) => {
            const result = `${numberFixed(num, 0)}`.replace(/^(\d+)(?=\d{4})/, '$1')
            return result === '0' && noZero ? '': result
        }
        const totalProfitMargin = totalCostAmount ? numberFixed(((totalAmount - totalCostAmount) / totalCostAmount) * 100, 0) : '-'
        const totalProfit = format(totalAmount - totalCostAmount, 0)
        const todayTotalProfit = format(todayTotalAmount - todayTotalCostAmount, 0)
        totalAmount = format(totalAmount)
        unsettledAmount = format(unsettledAmount, true)
        totalCostAmount = format(totalCostAmount)
        unsettledCostAmount = format(unsettledCostAmount, true)
        todayTotalAmount = format(todayTotalAmount)
        todayTotalCostAmount = format(todayTotalCostAmount)
        
        statistics.innerHTML=`订单统计:(<span title="今日销售金额: ¥${todayTotalAmount} | 待结算: ¥${unsettledAmount}">¥${totalAmount}</span> - <span title="今日销售成本: ￥${todayTotalCostAmount} | 待结算成本: ¥${unsettledCostAmount}">¥${totalCostAmount}</span>)=<span title="今日利润: ¥${todayTotalProfit}">¥${totalProfit}(${totalProfitMargin}%)</span> | <b title="今日销售件数: ${todayTotalQuantity} | 销售商品件数: ${totalQuantity}">${data?.length ?? 0}</b>单`
    }
    // 获取订单数据
    function getOrdersData(init) {
        return request({
            url: `${Origin}/api/temu/orders/get`,
        })
            .then(response => JSON.parse(response.responseText))
            .then(({ data, lmt, excelFile }) => {
                if (data?.length) {
                    setCurrentOrderData(data, excelFile)
                    if (lmt) {
                        currentOrderDataTime = lmt
                    }
                    setStatistics(data)
                    if (agentSeller) {
                        root.querySelector('#temu_orders_sync_checkout')?.classList?.remove('hide')
                    }
                }
                if (init && agentSeller) {
                    root.querySelector('#temu_orders_sync_cover')?.classList?.remove('hide')
                }
            })
            .catch(error => {
                console.error("Error fetching data:", error);
            });
    }
    const mergeList = (items = [], dataItems = [], uniqueKey, keys = []) => {
        const dataMap = {}
        if (uniqueKey && keys?.length) {
            dataItems.forEach((item) => {
                const key = item[uniqueKey]
                dataMap[key] = item
            })
            items.forEach((item) => {
                const key = item[uniqueKey]
                if (dataMap[key]) {
                    keys.forEach((k) => {
                        item[k] = dataMap[key][k] ?? null
                    })
                    delete dataMap[key]
                } else {
                    keys.forEach((k) => {
                        item[k] = item[k] ?? null
                    })
                }
            })
        }
        return [items, Object.values(dataMap)]
    }
    // 推送商品
    const productsDataPush = (data, extra) => {
        request({
            url: extra?.update ? `${Origin}/api/temu/products/update` : `${Origin}/api/temu/products/post`,
            method: 'POST',
            data: JSON.stringify({
                data,
                lmt: currentDataTime,
                ...extra?.params
            }),
            headers: { 'Content-Type': 'application/json' }
        })
        .then(response => JSON.parse(response.responseText))
        .then(({ code, data, lmt, excelFile }) => {
            if (code) {
                if (code === 3) {
                    setTimeout(() => {
                        alert('爬虫执行中，请稍后再试')
                    })
                } else {
                    setTimeout(() => {
                        alert('同步异常，请稍后再试')
                    })
                }
                return Promise.reject(`服务异常, code: ${code}`)
            } else {
                setCurrentData(data, excelFile)
                if (lmt) {
                    currentDataTime = lmt
                }
            }
        })
        .catch(error => {
            console.error("Error fetching data:", error);
        });
    }
    // 同步商品
    async function productsDataSync (cover) {
        if (seller) {
            const productSkuList = await getTemuProductSkuList()
            const list = [];
            const skuMap = {}
            productSkuList.forEach(({ spu, sku, title, price, stock, specList, skuNum }) => {
                const item = {}
                item['productId'] = spu
                item['sku'] = sku
                item['title'] = `${skuNum > 1 ? `【${specList.join(' & ')}】` : ''}${title}`
                item['price'] = price
                item['sellingStock'] = stock || 0
                skuMap[sku] = item
                list.push(item)
            })
            function calcData(data) {
                return data?.map((item) => {
                    if (Number(item.price) && Number(item.costPrice)) {
                        const profit = numberFixed(Number(item.price) - Number(item.costPrice))
                        // 利润率 利润 / 成本
                        const profitMargin = numberFixed((profit / item.costPrice) * 100, 1)
                        return { ...item, profit, profitMargin }
                    }
                    return item
                }) || []
            }
            if (cover) {
                const [baseData] = mergeList(list, currentData, 'sku', ['stock', 'costPrice', 'profit', 'profitMargin', 'costOriginalPrice', 'link'])
                productsDataPush(calcData([...baseData]))
            } else {
                const [baseData, newData] = mergeList(currentData, list, 'sku', ['title', 'price', 'sellingStock'])
                productsDataPush(calcData([...baseData.map((item) => {
                    if (!skuMap[item.sku] && item['link'] && /^http/.test(item['link'])) {
                        item['link'] = `#${item['link']}`
                    }
                    return item
                }), ...newData]))
            }
        }
    }

    async function getAddress (parent_order_sn) {
        return await fetch('/mms/orchid/address/snapshot/order_shipping_address_query', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                "mallid": await getMallId(),
            },
            body: JSON.stringify({
                parent_order_sn
            })
        })
        .then(response => response.json())
        .then((data) => {
            if (!data?.result) {
                data?.error_msg && alert(data?.error_msg)
                console.error('/mms/orchid/address/snapshot/order_shipping_address_query 接口请求失败', data)
                return Promise.reject(data)
            }
            return data?.result
        })
    }
    function getTimeScope (type = 1) {
        const stamp1 = new Date(new Date().setHours(0, 0, 0, 0)).getTime(); //获取当天零点的时间
        const stamp2 = new Date(new Date().setHours(0, 0, 0, 0) + oneDay - 1).getTime(); //获取当天23:59:59的时间
        if (type == 1) {
            // 今天
            return { startTime: stamp1, endTime: stamp2 }
        }
        if (type == 2) {
            // 昨天
            return { startTime: stamp1 - oneDay, endTime: stamp2 - oneDay }
        } 
        if (type == 3) {
            // 三天
            return { startTime: stamp1 - 2 * oneDay, endTime: stamp2 }
        }
        if (type == 4) {
            // 7天
            return { startTime: stamp1 - 6 * oneDay, endTime: stamp2 }
        } 
        if (type == 5) {
            // 15天
            return { startTime: stamp1 - 14 * oneDay, endTime: stamp2 }
        } 
        if (type == 6) {
            // 28天
            return { startTime: stamp1 - 27 * oneDay, endTime: stamp2 }
        } 
    }
    async function requestTemuOrders(queryType = 0, page = 1, scopeType = 0, all = true) {
        let times = {}
        if (scopeType) {
            const {startTime, endTime} =  getTimeScope(scopeType)
            times = { parentOrderTimeStart: parseInt(startTime / 1000), parentOrderTimeEnd: parseInt(endTime / 1000) }
        }
        return fetch('/kirogi/bg/mms/recentOrderList', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                "mallid": mallId,
            },
            body: JSON.stringify({
                "fulfillmentMode": 0,
                "pageNumber": page,
                "pageSize": all ? 200 : 100,
                "queryType": queryType,
                "sortType": 1,
                "timeZone": "UTC+8",
                ...times
            })
        })
        .then(response => response.json())
        .then((data) => {
            if (data.error_code == 40001 || !data?.result) {
                console.error('/kirogi/bg/mms/recentOrderList 接口请求失败', data)
                if (data.error_code == 40001) {
                    logoutNotice()
                }
                return Promise.reject(data)
            }
            return data?.result
        })
    }
    function formatTemuOrders(pageItems, statusList = [2, 4, 5]) {
        const orders = []
        const today = new Date();
        today.setHours(23, 59, 59, 999);
        pageItems.forEach(({ parentOrderMap, orderList }) => {
            const { parentOrderSn, parentOrderTimeStr } = parentOrderMap
            orderList.forEach(({ productSkuIdList, orderSn, goodsName, quantity = 1, orderStatus }) => {
                if (!statusList.includes(orderStatus)) return
                productSkuIdList?.forEach((sku) => {
                    const id = `${orderSn}_${sku}`
                    const singlePrice = currentDataMap[sku]?.price === '#' ? 0 : currentDataMap[sku]?.price ?? 0
                    const price = currentOrderDataMap[id]?.price ?? (singlePrice ? numberFixed(singlePrice * quantity) : 0)
                    const oldCostPrice = currentOrderDataMap[id]?.costPrice
                    const costPrice = price > 0 && !oldCostPrice ? (currentDataMap[sku]?.costPrice ? numberFixed(currentDataMap[sku]?.costPrice * quantity) : price) : oldCostPrice || 0
                    let profit = null
                    let profitMargin = null
                    if (price && costPrice) {
                        profit = numberFixed(Number(price) - Number(costPrice))
                        // 利润率 利润 / 成本
                        profitMargin = numberFixed((profit / costPrice) * 100, 1)
                    }
                    
                    orders.push({
                        id,
                        orderStatus: orderStatus ?? '异常',
                        orderStatusText: orderStatusMap[orderStatus] || '异常',
                        parentOrderId: parentOrderSn,
                        orderId: orderSn,
                        sku,
                        title: currentDataMap[sku]?.title || goodsName,
                        quantity,
                        price,
                        costPrice,
                        profit,
                        profitMargin,
                        link: currentDataMap[sku]?.link || null,
                        createTime: parentOrderTimeStr,
                        tag: currentOrderDataMap[id]?.tag || '',
                        settled: currentOrderDataMap[id]?.settled ?? (parentOrderTimeStr && (today.getTime() - new Date(parentOrderTimeStr).getTime()) > checkoutDays * 86400000 ? true : false),
                    })
                })
            })
        })
        return orders
    }
    async function getTemuOrders(pageType = 0, statusList = [2, 4, 5], scopeType = 0, all = true) {
        let pageItems = []
        let total = 1
        let page = 0
        const now = Date.now();
        const maxScope = checkoutDays * 86400000
        while (pageItems.length < total) {
            page += 1
            const result = await requestTemuOrders(pageType, page, scopeType, all)
            if (result) {
                total = result.totalItemNum
                pageItems = pageItems.concat(result.pageItems)
                if (!all) {
                    const last = pageItems[pageItems.length - 1]
                    const order = last ? formatTemuOrders([last], statusList)?.[0] ?? {} : {}
                    const ts = order.createTs ?? new Date(order.createTime).getTime()
                    if (order.createTime && (now - ts) > maxScope && currentOrderDataMap[order.id]) {
                        break;
                    }
                }
            } else {
                total = pageItems.length
            }
        }
        return formatTemuOrders(pageItems, statusList)
    }
    // 推送订单
    const ordersDataPush = (data, extra) => {
        return request({
            url: `${Origin}/api/temu/orders/post`,
            method: 'POST',
            data: JSON.stringify({
                data,
                lmt: currentOrderDataTime,
                ...extra
            }),
            headers: { 'Content-Type': 'application/json' }
        })
        .then(response => JSON.parse(response.responseText))
        .then(({ code, data, lmt, excelFile }) => {
            if (code) {
                setTimeout(() => {
                    alert('同步异常，请稍后再试')
                })
                return Promise.reject(`服务异常, code: ${code}`)
            } else {
                setCurrentOrderData(data, excelFile)
                if (lmt) {
                    currentOrderDataTime = lmt
                }
                setStatistics(data)
            }
        })
        .catch(error => {
            console.error("Error fetching data:", error);
        });
    }
    // 跟新订单
    const ordersDataUpdate = (data, extra) => {
        return request({
            url: `${Origin}/api/temu/orders/update`,
            method: 'POST',
            data: JSON.stringify({
                data,
                lmt: currentOrderDataTime,
                ...extra
            }),
            headers: { 'Content-Type': 'application/json' }
        })
        .then(response => JSON.parse(response.responseText))
        .then(({ code, data, lmt, excelFile }) => {
            if (code) {
                setTimeout(() => {
                    alert('同步异常，请稍后再试')
                })
                return Promise.reject(`服务异常, code: ${code}`)
            } else {
                setCurrentOrderData(data, excelFile)
                if (lmt) {
                    currentOrderDataTime = lmt
                }
                setStatistics(data)
            }
        })
        .catch(error => {
            console.error("Error fetching data:", error);
        });
    }
    // 查询改价商品
    const getAdjustmentProductsList = async (cb, pageNum = 0) => {
        let pageItems = []
        let total = 1
        while (pageItems.length < total) {
            pageNum += 1
            const result = await fetch('/marvel-supplier/api/xmen/select/search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    "mallid": await getMallId(),
                },
                body: JSON.stringify({
                    pageNum,
                    pageSize: 50,
                    secondarySelectStatusList: [12],
                    supplierTodoTypeLis: []
                })
            })
            .then(response => response.json())
            .then(async (data) => {
                if (!data?.result) {
                    console.error('/marvel-supplier/api/xmen/select/search 接口请求失败', data)
                    return Promise.reject(data)
                }
                if (data?.result?.dataList?.length) {
                    await cb?.(data?.result?.dataList)
                }
                return data?.result
            })
            if (result) {
                total = result.total
                pageItems = pageItems.concat(result.dataList)
            } else {
                total = pageItems.length
            }
        }
        const list = []
        pageItems.forEach((item) => {
            list.push(item)
        })
        return list
    }
    // 批量改价
    const productsReduction = async (val = 0.01) => {
        await getAdjustmentProductsList(async (products) => {
            const adjustItems = []
            products.forEach(({ productName, productId, supplierId, skcList  }) => {
                skcList.forEach(({ skuList, skcId: productSkcId, supplierPriceCurrencyType }) => {
                    const skuAdjustList = []
                    skuList.forEach(({ skuId, supplierPriceValue }) => {
                        skuAdjustList.push(
                            {
                                "targetPriceCurrency": supplierPriceCurrencyType,
                                "oldPriceCurrency": supplierPriceCurrencyType,
                                "syncPurchasePrice": 1,
                                skuId,
                                "oldSupplyPrice": supplierPriceValue,
                                "targetSupplyPrice": supplierPriceValue - val * 100,
                                
                            }
                        )
                    })
                    adjustItems.push({
                        productName,
                        productId,
                        productSkcId,
                        supplierId,
                        skuAdjustList
                    })
                })
            })
            const data = {
                adjustReason: 3, // 2: 降价清仓 3: 提高竞争力 4: 促销
                adjustItems
            }
            if (data?.adjustItems?.length) {
                await fetch('/marvel-mms/cn/api/kiana/gmp/bg/magneto/api/price/priceAdjust/gmpProductBatchAdjustPrice', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        "mallid": await getMallId(),
                    },
                    body: JSON.stringify(data)
                })
            }
        })
    }
    // ------------------------------------------------------------------------------------
    // 执行
    styles(`
        .temu_plugin {
            display: flex;
            align-items: center;
            gap: 8px;
            position: fixed;
            right: 0px;
            bottom: 0px;
            z-index: 999;
            border: 1px solid #999;
            border-radius: 3px;
            background: #fff;
            padding: 3px 6px;
            opacity: 0.8;
            font-size: 12px;
            flex-wrap: wrap;
            justify-content: flex-end;
        }
        #temu_input_file {
            width: 200px;
        }
        .temu_plugin a, .temu_plugin_sku_extra_link, .temu_plugin_sku_extra_remove {
            cursor: pointer;
            color: #000;
        }
        .hide {
            display: none;
        }
        .temu_plugin_sku_extra, .temu_plugin_order_extra {
            display: block;
            text-align: left;
        }
        .temu_plugin_order_extra_gooditem {
            position: relative;
            font-size: 10px;
        }
        .temu_plugin_order_extra_gooditem_close {
            position: absolute;
            top: -2px;
            right: -6px;
            z-index: 1;
            display: flex;
            justify-content: center;
            align-items: center;
            background: #eee;
            cursor: pointer;
            border-radius: 50%;
            width: 12px;
            height: 12px;
            overflow: hidden;
        }
        .temu_plugin_order_extra_gooditem input {
            font-size: 10px;
            width: 42px;
            border: 1px solid #999;
            outline: none;
        }
        .temu_plugin_order_extra_gooditem input::-webkit-outer-spin-button,
        .temu_plugin_order_extra_gooditem input::-webkit-inner-spin-button {
            -webkit-appearance: none;
            margin: 0;
        }
        .temu_plugin_order_extra_gooditem a {
            display: inline-block;
        }
        .temu_plugin_order_extra_goodname {
            display: block;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            max-width: 100%;
            white-space: nowrap;
            text-overflow: ellipsis;
            overflow: hidden;
        }
        .temu_plugin_order_tag {
            display: inline-block;
            line-height: 10px;
            height: 13px;
            min-width: 13px;
            border-radius: 9999999px;
            background: #2196f3;
            color: #fff;
            padding: 1px 4px;
            margin: 3px 0;
            cursor: pointer;
            white-space: nowrap;
            text-overflow: ellipsis;
            overflow: hidden;
            vertical-align: middle;
            max-width: 100%;
        }
        .temu_plugin_order_tag:empty {
            background: gray;
        }
        .temu_plugin_order_settled, .temu_plugin_order_unsettled {
            display: inline-flex;
            line-height: 10px;
            height: 16px;
            min-width: 16px;
            border-radius: 9999999px;
            background: #d6fae7;
            color: #35c08e;
            padding: 2px 6px;
            margin: 3px 0;
        }
        .temu_plugin_order_unsettled {
            background: #ffedc9;
            color: #fe9e0f;
        }
        `)
        const root = html(`<div class="temu_plugin">
            <a id="temu_products_time" class="hide"></a>
            <a id="temu_products_reduction" class="hide">批量改价</a>
            <a id="temu_products_pull" class="hide">刷新库存</a>
            <a id="temu_products_sync" class="hide" title="双击全量同步商品">在售同步(双击全量)</a>
            <a id="temu_spider" class="hide">执行爬虫</a>
            <a id="temu_download" download class="hide">商品xlsx</a>
            &nbsp;
            <a id="temu_orders_time" class="hide"></a>
            <a id="temu_orders_sync_cover" class="hide" title="双击全量同步订单">订单同步(双击全量)</a>
            <a id="temu_orders_sync_checkout" class="hide" title="1小时内只爬取一次结算数据">结算同步</a>
            <a id="temu_order_download" download class="hide">订单xlsx</a>
            <a id="temu_orders_statistics" class="hide"></a>
        </div>`)
    function productUpdate() {
        // console.log('商品视图更新')
        document.querySelectorAll('.temu_plugin_sku_extra').forEach((ele) => {
            ele.remove()
        })
        currentData.forEach((items) => {
            const sku = items['sku']
            findElementsByText(sku)?.forEach((ele) => {
                const stock = items['stock']
                const costPrice = items['costPrice']
                const profit = items['profit']
                const profitMargin = items['profitMargin']
                const link = items['link']
                const offShelves = items['offShelves']
                const span = document.createElement('span')
                span.className = 'temu_plugin_sku_extra'
                let html = ''
                if (link) {
                    const isHttp = /^#*http/.test(link)
                    html += `${offShelves ? '<b style="color:red;">商品疑似下架</b><br/>' : ``}
                            <a href="javascript:;" class="temu_plugin_sku_stock_edit" data-sku="${sku}" data-value="${stock}">库存：${stock ?? '-'}</a><br/>
                            <a href="javascript:;" class="temu_plugin_sku_cost_edit" data-sku="${sku}" data-value="${costPrice}">成本：${costPrice ?? '-'}</a><br/>
                            利润：${profit ?? '-'} (${profitMargin ? `${profitMargin}%` : '-'})<br/>
                            ${isHttp ? `<a class="temu_plugin_href" href="${link.replace(/^#+/, '')}" target="__blank">跳转</a>&nbsp;` : ''}`
                }
                html += `<a href="javascript:;" class="temu_plugin_sku_extra_link" data-sku="${sku}">修改链接</a>`
                if(seller) {
                    html += `<br/><a href="javascript:;" class="temu_plugin_sku_extra_remove" data-sku="${sku}">移除商品</a></br>`
                }
                span.innerHTML = html
                ele.appendChild(span)
            })
        })
        const temu_time = root.querySelector('#temu_products_time')
        if (temu_time) {
            if (currentDataTime) {
                const date = new Date(currentDataTime)
                let dateStr = ''
                if (new Date().getFullYear() === date.getFullYear()) {
                    dateStr = date.toLocaleString().replace(/(^\d{4}\/)|(:\d{1,2}$)/g, '')
                } else {
                    dateStr = date.toLocaleString().replace(/:\d{1,2}$/, '')
                }
                temu_time.innerHTML = `<b>商品</b> 更新自: ${dateStr}`
                temu_time.classList.remove('hide')
            } else {
                temu_time.classList.add('hide')
            }
        }
    }
    function orderUpdate() {
        console.log('订单视图更新')
        document.querySelectorAll('.temu_plugin_order_extra').forEach((ele) => {
            ele.remove()
        })
        const orderEles = findElementsByText('PO-')
        orderEles.filter((ele) => ele?.childNodes?.[0]?.nodeValue?.match?.(/^PO\-[\d]+\-[\d]+/)).forEach((ele) => {
            const parentOrderId = ele?.childNodes?.[0]?.nodeValue
            currentOrderData.filter((item) => item.parentOrderId === parentOrderId)?.forEach(({ id, title, price, costPrice, profit, profitMargin, quantity, tag, settled }) => {
                const span = document.createElement('span')
                span.className = 'temu_plugin_order_extra'
                let html = ''
                if(agentSeller) {
                    html += `<div class="temu_plugin_order_extra_gooditem" data-id="${id}" data-order${parentOrderId}">
                    <i class="temu_plugin_order_extra_gooditem_close" data-id="${id}">
                        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M4.00005 4.78487L7.10767 7.89249L7.85013 7.15002L4.74251 4.04241L7.89243 0.892487L7.14997 0.150024L4.00005 3.29995L0.850128 0.150024L0.107666 0.892487L3.25759 4.04241L0.14997 7.15002L0.892432 7.89249L4.00005 4.78487Z" fill="#474F5E"/>
                        </svg>
                    </i>
                    <span class="temu_plugin_order_extra_goodname" title="${title}">${title}</span>
                    ${!price || price <= costPrice || !costPrice ? '<b style="color:red;font-size:16px;">!!&nbsp;</b>' : ''}<input title="子单售卖金额" type="number" data-price="${price}" value="${price}" onchange="this.style.color='red'"></input>-<input type="number" title="子单成本金额"  data-costprice="${costPrice}" value="${costPrice}" onchange="this.style.color='red'"></input>(${quantity})=${profit}(${profitMargin}%)
                    &nbsp;<a data-id="${id}" class="temu_plugin_order_extra_confirm" href="javascript:;">确认</a>&nbsp;<a data-id="${id}" class="temu_plugin_order_extra_cancel" href="javascript:;">取消</a>&nbsp;<a data-id="${id}" class="temu_plugin_order_extra_reset_price" href="javascript:;">重置售价</a>&nbsp;<a data-id="${id}" class="temu_plugin_order_extra_reset_cost" href="javascript:;">重置原价</a>
                    ${settled || settled === false ? `<br/>${settled ? '<span class="temu_plugin_order_settled">已结算</span>': '<span class="temu_plugin_order_unsettled">待结算</span>'}`: '<br/>'}
                    标签:&nbsp;<span data-id="${id}" title="${tag || '编辑订单标签'}" class="temu_plugin_order_tag">${tag || ''}</span>
                    </div>`
                }
                span.innerHTML = html
                ele.appendChild(span)
            })
        })
        const temu_time = root.querySelector('#temu_orders_time')
        if (temu_time) {
            if (currentOrderDataTime) {
                const date = new Date(currentOrderDataTime)
                let dateStr = ''
                if (new Date().getFullYear() === date.getFullYear()) {
                    dateStr = date.toLocaleString().replace(/(^\d{4}\/)|(:\d{1,2}$)/g, '')
                } else {
                    dateStr = date.toLocaleString().replace(/:\d{1,2}$/, '')
                }
                temu_time.innerHTML = `<b>订单</b> 更新自: ${dateStr}`
                temu_time.classList.remove('hide')
            } else {
                temu_time.classList.add('hide')
            }
        }
    }
    function update() {
        productUpdate()
        if (window.location.pathname === '/mmsos/orders.html') {
            orderUpdate()
        }
    }
    // 商品
    function productPlaneInit () {
        const temu_products_pull = root.querySelector('#temu_products_pull')
        const upload = root.querySelector('#temu_products_sync')
        const temu_spider = root.querySelector('#temu_spider')
        const products_reduction = root.querySelector('#temu_products_reduction')
        temu_products_pull.addEventListener('click', async () => {
            temu_products_pull.classList.add('hide')
            await getProductsData()
            temu_products_pull.classList.remove('hide')
            alert('更新完成')
        })
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') getProductsData()
        })
        let clickTimer = null;
        upload.addEventListener('click', async () => {
            if (clickTimer) return
            clickTimer = setTimeout(async () => {
                clickTimer = null
                if (confirm('增量同步不会移除掉下架商品数据，但爬虫不在执行下架商品，是否继续？')) {
                    upload.classList.add('hide')
                    await getProductsData()
                    await productsDataSync()
                    upload.classList.remove('hide')
                    alert('同步完成')
                }
            }, 500)
        })
        upload.addEventListener('dblclick', async () => {
            clickTimer && clearTimeout(clickTimer)
            clickTimer = null
            setTimeout(async () => {
                if (confirm('覆盖同步会移除掉下架商品数据，是否继续？')) {
                    upload.classList.add('hide')
                    await getProductsData()
                    await productsDataSync({ cover: true })
                    upload.classList.remove('hide')
                    alert('同步完成')
                }
            })
        })
        temu_spider.addEventListener('click', () => {
            if (confirm('爬取数据执行需要时间，稍等后执行更新获取最新数据，确定要现在执行爬取吗')) {
                forceUpdate()
            }
        })
        document.body.addEventListener('click', async (e) => {
            const ele = e.target
            const sku = ele.dataset?.sku
            if (sku && ele.closest('.temu_plugin_sku_stock_edit')) {
                const dataSource = deepClone(currentData)
                const data = currentDataMap[sku]
                const input = prompt("库存", data?.stock);
                if (input) {
                    const stock = Number(input);
                    if (!isNaN(stock)) {
                        dataSource[data.index]['stock'] = stock
                        productsDataPush(dataSource, { params: { force: true, extendKeys: ['stock'] }, update: true })
                    }
                }
            }
            if (sku && ele.closest('.temu_plugin_sku_cost_edit')) {
                const dataSource = deepClone(currentData)
                const data = currentDataMap[sku]
                const input = prompt("成本", data?.costPrice);
                if (input) {
                    const costPrice = Number(input);
                    if (!isNaN(costPrice)) {
                        dataSource[data.index]['costPrice'] = costPrice
                        productsDataPush(dataSource, { params: { force: true, extendKeys: ['costPrice'] }, update: true })
                    }
                }
            }
            if (sku && ele.closest('.temu_plugin_sku_extra_link')) {
                const dataSource = deepClone(currentData)
                const data = currentDataMap[sku]
                const url = prompt("仓库URL", data?.link || '');
                if ((url === '' || url && url !== data?.link && url.match(/^#*(https?:\/\/)?/)) && data.index >= 0 && dataSource[data.index]) {
                    dataSource[data.index]['link'] = url || null
                    productsDataPush(dataSource, { params: { force: true }, update: true })
                }
            }
            if (sku && ele.closest('.temu_plugin_sku_extra_remove') && confirm('是否移除该商品')) {
                const dataSource = deepClone(currentData)
                const data = currentDataMap[sku]
                if (data.index >= 0 && dataSource[data.index]) {
                    dataSource.splice(data.index, 1)
                    productsDataPush(dataSource, { params: { force: true } })
                }
            }
            if (ele.closest('.temu_plugin_order_tag')) {
                const id = ele.dataset.id
                if (currentOrderDataMap[id]) {
                    const { index, tag, ...rest } = currentOrderDataMap[id] ?? {}
                    const newTag = prompt('设置订单标签', currentOrderDataMap[id]?.tag || '')
                    if (newTag || newTag === '') {
                        ordersDataUpdate([{ tag: newTag, ...rest }]).then(() => {
                            alert('设置订单标签成功')
                        })
                    }
                }
            }
        })
        // 批量改价逻辑
        const reduction_date_key = `${Name}__reduction_date__`
        seller && currentData?.length && products_reduction.classList.remove('hide')
        products_reduction.addEventListener('click', async () => {
            const result = Number(prompt('输入降价幅度（只能输入数字）', 0.01)) || 0.01
            if (result) {
                await productsReduction(result)
                setCache(reduction_date_key, new Date().toLocaleDateString())
            }
        })
    }
    function init () {
        const tableObserver = new MutationObserver(debounce((list) => {
            if (list.some((item) => [...item.removedNodes, ...item.addedNodes].some((ele) => !ele.classList?.contains?.('temu_plugin_sku_extra') && !ele?.classList?.contains?.('temu_plugin_order_extra')))) {
                update()
            }
        }, 1000));
        let tables = []
        const observer = new MutationObserver(debounce(() => {
            const list = [...document.querySelectorAll('table')]
            if (list.some((item) => !tables.includes(item))) {
                tableObserver.disconnect()
                list.forEach((item) => {
                    tableObserver.observe(item, {
                        childList: true,
                        subtree: true
                    })
                })
                tables = list
                update()
            }
        }, 1000));
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
        let lastVisibilityState = document.visibilityState;
        function handleVisibilityChange() {
            if (document.visibilityState === 'visible' && lastVisibilityState !== 'visible') {
                getProductsData()
            }
            lastVisibilityState = document.visibilityState
        }
        document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    // 订单
    function orderInit () {
        const addressMap = {}
        document.body.addEventListener('dblclick', async (e) => {
            const firstNode = e.target.childNodes?.[0]
            const text = firstNode?.nodeType === 3 ? firstNode?.nodeValue : null
            if (text && text.match(/^\w+\-\d+\-\d+$/)) {
                const href = e.target.closest('tr')?.querySelector('.temu_plugin_sku_extra .temu_plugin_href')?.href
                const launch = () => {
                    const isHttp = /^#*http/.test(href)
                    if (confirm(`地址复制完成！${isHttp ? '是否跳转去下单': ''}`) && isHttp) {
                        let url = window.open(href.replace(/^#+/, ''))
                        if (url.includes("https://xhl.topwms.com/warehouse/stock_list")) {
                            url = url.replace("https://xhl.topwms.com/warehouse/stock_list", "https://xhl.topwms.com/manual_order/index")
                        }
                        window.open(url)
                    }
                }
                if (addressMap[text]) {
                    copyToClipboard(JSON.stringify(addressMap[text]))
                    launch()
                    return
                }
                getAddress(text).then((res) => {
                    if (res) {
                        copyToClipboard(JSON.stringify(res))
                        launch()
                        addressMap[text] = res
                    }
                })
            }
        })
        const temu_orders_sync_cover = root.querySelector('#temu_orders_sync_cover')
        let clickTimer = null;
        const orderSync = async (cd = 0) => {
            temu_orders_sync_cover.classList.add('hide')
            await getOrdersData()
            const list = await getTemuOrders(0, [2, 4, 5], cd, false)
            const cancelList = await getTemuOrders(3, [3], 6, false)
            const listMap = arr2Map(list, 'id')
            const cancelListMap = arr2Map(cancelList, 'id')
            const oldList = []
            currentOrderData.forEach((item) => {
                if (item && !listMap[item.id] && !cancelListMap[item.id]) {
                    oldList.push(item)
                }
            })
            const orders = [...list, ...oldList]
            await ordersDataPush(orders, { cover: true })
            temu_orders_sync_cover.classList.remove('hide')
        }
        temu_orders_sync_cover.addEventListener('click', async () => {
            if (clickTimer) return
            clickTimer = setTimeout(async () => {
                clickTimer = null
                if (confirm(`同步${checkoutDays}天订单数据，是否继续？`)) {
                    await orderSync()
                    alert('同步完成')
                }
            }, 500)
        })
        temu_orders_sync_cover.addEventListener('dblclick', async () => {
            clickTimer && clearTimeout(clickTimer)
            clickTimer = null
            setTimeout(async () => {
                if (confirm('同步全量订单数据，是否继续？')) {
                    temu_orders_sync_cover.classList.add('hide')
                    await getOrdersData()
                    const data = await getTemuOrders()
                    await ordersDataPush(data, { cover: true })
                    temu_orders_sync_cover.classList.remove('hide')
                    alert('同步完成')
                }
            })
        })
        const getCheckList = async () => {
            return await fetch('/api/merchant/file/export/history/page', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    "mallid": await getMallId(),
                },
                body: JSON.stringify({"taskType":11,"pageSize":20,"pageNum":1})
            }).then(response => response.json()).catch(error => {
                console.error("Error fetching data:", error);
            })
        }
        const exportCheckList = async (beginTime, endTime) => {
            return await fetch('/api/merchant/file/export', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    "mallid": await getMallId(),
                },
                body: JSON.stringify({ "settleDataType":3, "beginTime":beginTime, "endTime":endTime, "taskType":11 })
            }).then(response => response.json()).catch(error => {
                console.error("Error fetching data:", error);
            })
        }

        const getExcelUrl = async (id) => {
            return await fetch('/api/merchant/file/export/download', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    "mallid": await getMallId(),
                },
                body: JSON.stringify({"id":id,"taskType":11})
            }).then(response => response.json()).catch(error => {
                console.error("Error fetching data:", error);
            })
        }
        const temu_orders_sync_checkout = root.querySelector('#temu_orders_sync_checkout')
        const syncCheckout = async (silence, callback) => {
            if (silence || confirm(`同步近${checkoutDays > 1 ? checkoutDays: '今'}天已结算订单金额，是否继续？\n【注意】: 订单原价为 0 时将被设置为订单售价一致`)) {
                temu_orders_sync_checkout.classList.add('hide')
                const data = await getCheckList()
                const lastTime = new Date();
                lastTime.setMinutes(59)
                lastTime.setSeconds(59)
                lastTime.setMilliseconds(999)
                const endTime = lastTime.getTime();
                const beginTime = endTime - checkoutDays * 86400000 + 1
                const getExportHistory = (merchantMerchantFileExportHistoryList) => merchantMerchantFileExportHistoryList?.find((item) => item.searchExportTimeBegin <= beginTime && item.searchExportTimeEnd >= endTime)
                let exportHistory = getExportHistory(data?.result?.merchantMerchantFileExportHistoryList)
                let url
                if (!exportHistory) {
                    await exportCheckList(beginTime, endTime)
                    const data = await getCheckList()
                    await new Promise((r) => setTimeout(r, 1000))
                    exportHistory = getExportHistory(data?.result?.merchantMerchantFileExportHistoryList)
                }
                if (exportHistory?.id) {
                    url = (await getExcelUrl(exportHistory.id))?.result?.fileUrl
                    if (url) {
                        const excelData =  await excelLoad(url)
                        if (excelData?.length) {
                            const orderList = []
                            await getOrdersData()
                            const currentOrderDataMap = arr2Map(currentOrderData, 'orderId', true)
                            excelData.forEach((item) => {
                                const id = item['子订单号']?.trim()
                                const amountStr = item['交易收入']?.trim()
                                const price = amountStr ? Number(amountStr): -1
                                if (currentOrderDataMap[id] && !isNaN(price) && price >= 0) {
                                    const oldCostPrice = currentOrderDataMap[id]?.costPrice
                                    const sku = currentOrderDataMap[id]?.sku
                                    const quantity = currentOrderDataMap[id]?.quantity || 1
                                    const cp = currentDataMap[sku]?.costPrice ? numberFixed(currentDataMap[sku]?.costPrice * quantity) : price
                                    const costPrice = price > 0 && !oldCostPrice ? cp : oldCostPrice || 0
                                    const profit = numberFixed(price - costPrice)
                                    const profitMargin = numberFixed((profit / costPrice) * 100, 1)
                                    const { index, ...rest } = currentOrderDataMap[id] ?? {}
                                    orderList.push({...rest, price, profit, profitMargin, settled: true})
                                }
                            })
                            if (orderList?.length) {
                                await ordersDataUpdate(orderList).then(() => {
                                    callback?.()
                                    !silence && alert('已结算订单金额同步完成')
                                })
                            }
                            temu_orders_sync_checkout.classList.remove('hide')
                            return
                        }
                    }
                }
                !silence && alert('已结算订单金额同步失败，稍后再试！！')
                currentOrderData?.length && temu_orders_sync_checkout.classList.remove('hide')
            }
        }
        if (agentSeller) {
            temu_orders_sync_checkout.addEventListener('click', () => syncCheckout())
            const autoSyncCheckout = () => {
                const key = `${Name}__temu_orders_sync_checkout_date__`
                const temu_orders_sync_checkout_date = localStorage.getItem(key)
                const date = new Date()
                if (!temu_orders_sync_checkout_date || new Date(Number(temu_orders_sync_checkout_date) || null).toLocaleDateString() !== date.toLocaleDateString()) {
                    try {
                        syncCheckout(true, () => {
                            localStorage.setItem(key, date.getTime())
                        })
                    } catch(err) {}
                }
            }
            autoSyncCheckout();
            setExactInterval(async () => {
                autoSyncCheckout();
            }, 24 * 60 * 60 * 1000)
        }

        document.body.addEventListener('click', async (e) => {
            const ele = e.target
            if (ele.closest('.temu_plugin_order_extra_gooditem_close') && confirm('是否要移除订单')) {
                const id = ele.closest('.temu_plugin_order_extra_gooditem_close').dataset.id
                if (id) {
                    await getOrdersData();
                    if (currentOrderData?.length) {
                        const orders = []
                        currentOrderData.forEach((order) => {
                            if (order.id !== id) orders.push(order)
                        })
                        await ordersDataPush(orders, { cover: true })
                    }
                }
            }
            if (ele.closest('.temu_plugin_order_extra_confirm') && confirm('是否更新商品金额')) {
                const id = ele.dataset.id
                const parentNode = ele.closest('.temu_plugin_order_extra_gooditem')
                const priceEle = parentNode.querySelector('[data-price]')
                const costpriceEle = parentNode.querySelector('[data-costprice]')
                const price = Number(priceEle.value) || 0
                const costPrice = Number(costpriceEle.value) || 0
                const profit = numberFixed(price - costPrice)
                const profitMargin = numberFixed((profit / costPrice) * 100, 1)
                const { index, ...rest } = currentOrderDataMap[id] ?? {}
                const data = {...rest, price, costPrice, profit, profitMargin }
                await ordersDataUpdate([data])
            }
            if (ele.closest('.temu_plugin_order_extra_cancel')) {
                const parentNode = ele.closest('.temu_plugin_order_extra_gooditem')
                const priceEle = parentNode.querySelector('[data-price]')
                const costpriceEle = parentNode.querySelector('[data-costprice]')
                priceEle.value = Number(priceEle.dataset.price)
                priceEle.style.color = ""
                costpriceEle.value = Number(costpriceEle.dataset.costprice)
                costpriceEle.style.color = ""
            }
            if (ele.closest('.temu_plugin_order_extra_reset_price')) {
                const id = ele.dataset.id
                const order = currentOrderDataMap[id]
                const sku = order.sku
                const info = currentDataMap[sku]
                if (!info?.price || info?.price === '#') {
                    alert('无[商品售价], 商品可能不在售')
                    return
                }
                if(order && confirm(`是否重置订单售价为 [商品售价]`)) {
                    const { index, ...rest } = order
                    await ordersDataUpdate([{ ...rest, price: numberFixed((info?.price || 0) * (order?.quantity || 1)) }])
                }
            }
            if (ele.closest('.temu_plugin_order_extra_reset_cost')) {
                const id = ele.dataset.id
                const order = currentOrderDataMap[id]
                const sku = order.sku
                const info = currentDataMap[sku]
                if (!info?.costPrice && !info?.price) {
                    alert('请先设置[商品成本]')
                    return 
                }
                if(order && confirm(`是否重置订单原价为 ${info?.costPrice ? '[商品成本]' : '[商品售价]'}`)) {
                    const { index, ...rest } = order
                    costPrice = numberFixed((info?.costPrice || info?.price || 0) * (order?.quantity || 1))
                    await ordersDataUpdate([{ ...rest, costPrice: costPrice || order.price }])
                }
            }
        })
        function f(items){
            let content="|  SKU  | 件 | 库存 | 利润 | 品名 |\n|---------|---|------|------|------|"
            items.forEach((item) => {
                const sku = item.sku
                let title = item.title?.substr?.(0, 16)
                if (item.title !== title) {
                    title += '..'
                }
                const quantity = item.quantity
                content += `\n| [${`${sku}`.replace(/(?<=\d{4})\d+/, '..')}](https://agentseller.temu.com/mmsos/orders.html?sku=${sku}) | ${quantity} | ${currentDataMap[sku]?.stock ?? '-'} | ${item.profit ?? currentOrderDataMap[item.id]?.profit ?? '-'} | [${title}](${item?.link || currentDataMap[sku]?.link || 'https://agentseller.temu.com/mmsos/orders.html'}) |`
            })
            return content
        }
        const pollingHandle = async () => {
            const now = Date.now()
            const order1Sended = getCache(`${Name}__order1Sended__`) || {}
            let order1 = await getTemuOrders(1, [1], 3) || []
            Object.entries(order1Sended).forEach(([key, value]) => {
                if (!value || isNaN(value) || value < now) {
                    delete order1Sended[key]
                }
            })
            order1 = order1.filter((item) => {
                const t = order1Sended[item?.id]
                if (!t) {
                    order1Sended[item?.id] = now + 3 * oneDay
                }
                return !t || now > t
            })
            const order2Sended = getCache(`${Name}__order2Sended__`) || {}
            let order2 = await getTemuOrders(2, [2], 3) || []
            Object.entries(order2Sended).forEach(([key, value]) => {
                if (!value || isNaN(value) || value < now) {
                    delete order2Sended[key]
                }
            })
            order2 = order2.filter((item) => {
                const t = order2Sended[item?.id]
                if (!t) {
                    order2Sended[item?.id] = now + 3 * oneDay
                }
                return !t || now > t
            })
            const order3Sended = getCache(`${Name}__order3Sended__`) || {}
            let order3 = await getTemuOrders(3, [3], 3) || []
            Object.entries(order3Sended).forEach(([key, value]) => {
                if (!value || isNaN(value) || value < now) {
                    delete order3Sended[key]
                }
            })
            order3 = order3.filter((item) => {
                const t = order3Sended[item?.id]
                if (!t) {
                    order3Sended[item?.id] = now + 3 * oneDay
                }
                return !t || now > t
            })
            if (order1?.length || order2?.length || order3?.length) {
                await getProductsData()
            }
            if (order1?.length) {
                order1?.length && notice((Name ? `【${Name}】` : '') + '[平台处理中订单]', f(order1))
                setCache(`${Name}__order1Sended__`, order1Sended)
                console.log('[平台处理中订单]通知：', new Date().toLocaleString())
            }
            if (order2?.length) {
                order2?.length && notice((Name ? `【${Name}】` : '') + '[待发货订单]', f(order2))
                setCache(`${Name}__order2Sended__`, order2Sended)
                console.log('[待发货订单]通知：', new Date().toLocaleString())
            }
            if (order3?.length) {
                order3?.length && notice((Name ? `【${Name}】` : '') + '[订单取消]', f(order3))
                setCache(`${Name}__order3Sended__`, order3Sended)
                console.log('[订单取消]通知：', new Date().toLocaleString())
            }
        }
        const pollingTemuRefund = async () => {
            const now = Date.now()
            const refund1Sended = getCache(`${Name}__refund1Sended__`) || {}
            const refund1s = await getTemuRefunds(2106, 3)
            Object.entries(refund1Sended).forEach(([key, value]) => {
                if (!value || isNaN(value) || value < now) {
                    delete refund1Sended[key]
                }
            })
            const refund1List = refund1s?.filter?.(({ id }) => {
                const t = refund1Sended[id]
                if (!t) {
                    refund1Sended[id] = now + 3 * oneDay
                }
                return !t || now > t
            }) || []
            const refund2Sended = getCache(`${Name}__refund2Sended__`) || {}
            const refund2s = await getTemuRefunds(2107, 3)
            Object.entries(refund2Sended).forEach(([key, value]) => {
                if (!value || isNaN(value) || value < now) {
                    delete refund2Sended[key]
                }
            })
            const refund2List = refund2s?.filter?.(({ id }) => {
                const t = refund2Sended[id]
                if (!t) {
                    refund2Sended[id] = now + 3 * oneDay
                }
                return !t || now > t
            }) || []
            if (refund1List?.length || refund2List?.length) {
                await getProductsData()
            }
            if (refund1List?.length) {
                let order1s = []
                refund1List.forEach((item) => {
                    order1s = order1s.concat(item?.orders || [])
                })
                notice((Name ? `【${Name}】` : '') + '[售后待处理]', f(order1s))
                setCache(`${Name}__refund1Sended__`, refund1Sended)
                console.log('[售后待处理]通知：', new Date().toLocaleString())
            }
            if (refund2List?.length) {
                let order2s = []
                refund2List.forEach((item) => {
                    order2s = order2s.concat(item?.orders || [])
                })
                notice((Name ? `【${Name}】` : '') + '[售后已申请]', f(order2s))
                setCache(`${Name}__refund2Sended__`, refund2Sended)
                console.log('[售后已申请]通知：', new Date().toLocaleString())
            }
        }
        const chatCheckInterval = 15 // 聊天检测间隔（分钟）
        const chatPollingInterval = chatCheckInterval * 60 * 1000 + Math.round(Math.random() * 15 * 1000)
        const pollingChat = async () => {
            const key = `${Name}__temu_chat_last_time__`
            const prevLastTime = Number(localStorage.getItem(key)) || 0
            const now = Date.now()
            if ((now - prevLastTime - 3000) < chatPollingInterval) return
            localStorage.setItem(key, now)
            const res = await fetch('/agora/conv/getBizConvList', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    "mallid": await getMallId(),
                },
                body: JSON.stringify({"chatTypeId":1, "size":20, "group":"unReply", "language":"zh-Hans"})
            }).then(response => response.json()).catch(error => {
                console.error("Error fetching data:", error);
            })
            const chats = res?.result?.data?.filter(({ message } = {}) => {
                const mul = message?.ts?.length === 10 ? 1000 : 1
                let ts = Number(message?.ts)
                ts = ts ? ts * mul: now
                return ts > prevLastTime
            }) ?? []
            if (chats?.length) {
                const min = Math.round((now - prevLastTime) / (60 * 1000))
                notice((Name ? `【${Name}】` : '') + '[新客户消息]', `${min > 60 ? '': `最近${min}分钟内`}有${chats?.length}个待回复消息`)
            }
        }
        const statisticsNoticeKey = `${Name}__temu_statistics_notice_last_time__`
        const pollingStatistics = async () => {
            const now = new Date()
            const todayDate = now.toLocaleDateString()
            const prevLastDate = localStorage.getItem(statisticsNoticeKey)
            if (now.getHours() === 23 && todayDate !== prevLastDate) {
                localStorage.setItem(statisticsNoticeKey, todayDate)
                await orderSync(3);
                let todayTotalQuantity = 0
                let todayTotalAmount = 0
                currentTodayOrderData?.forEach?.((item) => {
                    todayTotalQuantity += item['quantity'] ?? 0
                    todayTotalAmount += item['price'] ?? 0
                })
                if (todayTotalQuantity) {
                    notice((Name ? `【${Name}】` : '') + '[今日统计]', `销售额: ¥${numberFixed(todayTotalAmount)}\n商品件数: ${todayTotalQuantity}`)
                }
            }
        }
        setExactInterval(async () => {
            console.log('检查订单：', new Date().toLocaleString())
            pollingHandle()
            pollingTemuRefund()
        }, pollingInterval)
        pollingChat();
        setExactInterval(async () => {
            console.log('聊天检测：', new Date().toLocaleString())
            pollingChat()
        }, chatPollingInterval)
        setExactInterval(async () => {
            console.log('每日统计：', new Date().toLocaleString())
            pollingStatistics()
        }, 60 * 60 * 1000)
        const orderAutoSyncKey = `${Name}__temu_order_auto_sync_last_time__`
        setExactInterval(async () => {
            const now = new Date()
            console.log('定时同步订单数据', now.toLocaleString())
            const nowHourStr = now.toLocaleDateString() + '_' + now.getHours();
            const prevLasthour = localStorage.getItem(orderAutoSyncKey)
            if (nowHourStr !== prevLasthour) {
                await orderSync(3);
                localStorage.setItem(orderAutoSyncKey, nowHourStr)
            }
        }, 2 * 60 * 60 * 1000)
        setExactInterval(() => {
            console.log('心跳检查：', new Date().toLocaleString())
        }, 60 * 1000)
        // 自动调价
        if (ReductionInterval) {
            setExactInterval(async () => {
                const reduction_date_key = `${Name}__reduction_date__`
                const reductionDate = getCache(reduction_date_key)
                const todayDate = new Date().toLocaleDateString()
                const nextDate = new Date(Date.now() + ReductionInterval).toLocaleDateString()
                if (reductionDate != todayDate && nextDate != todayDate) {
                    await productsReduction(0.01)
                    setCache(reduction_date_key, todayDate)
                }
            }, ReductionInterval)
        }
    }
    const sellerInit = async () => {
        const productAutoSyncKey = `${Name}__temu_product_auto_sync_last_time__`
        setExactInterval(async () => {
            const now = new Date()
            console.log('定时同步商品数据', now.toLocaleString())
            const nowHourStr = now.toLocaleDateString()
            const prevLasthour = localStorage.getItem(productAutoSyncKey)
            if (nowHourStr !== prevLasthour) {
                await getProductsData()
                await productsDataSync()
                localStorage.setItem(productAutoSyncKey, todayDate)
            }
        }, 24 * 60 * 60 * 1000)
    }
    (async () => {
        // 执行
        await getProductsData()
        await getOrdersData(true)
        init()
        console.log('init::')
        productPlaneInit()
        if (agentSeller) {
            console.log('orderInit::')
            orderInit()
        }
        if (seller) {
            sellerInit()
        }
    })()
}