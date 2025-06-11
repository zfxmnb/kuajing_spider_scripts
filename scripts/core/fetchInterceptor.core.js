function fetchInterceptorInit (w = window) {
    const fetchInterceptorMap = {}
    try {
        // 自定义 fetch 拦截器
        const originalFetch = w.fetch;
        w.fetch = async function (...args) {
            // 调用原始 fetch
            const response = await originalFetch(...args);
            // 你可以在这里处理响应数据
            const key = response.url?.split?.('?')?.[0]
            if (fetchInterceptorMap[key] && typeof fetchInterceptorMap[key] === 'function') {
                const responseClone = response.clone(); // 克隆响应以便后续处理
                try {
                    const resp = await fetchInterceptorMap[key](responseClone)
                    if (resp instanceof Response) return resp
                } catch (err) {}
            }
            return response; // 返回原始响应
        };
    } catch(err) {}
    return (key, fn) => {
        fetchInterceptorMap[key] = fn
    }
}