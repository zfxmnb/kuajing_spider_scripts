function fetchInterceptorInit (w = window) {
    if (w.__fetchInterceptor__) {
        return w.__fetchInterceptor__
    }
    w.__fetchInterceptorMap__ = {}
    try {
        // 自定义 fetch 拦截器
        const originalFetch = w.fetch;
        w.fetch = async function (...args) {
            // 调用原始 fetch
            const response = await originalFetch(...args);
            // 你可以在这里处理响应数据
            const key = response.url?.split?.('?')?.[0]
            if (w.__fetchInterceptorMap__[key] && typeof w.__fetchInterceptorMap__[key] === 'function') {
                const responseClone = response.clone(); // 克隆响应以便后续处理
                try {
                    const resp = await w.__fetchInterceptorMap__[key](responseClone, ...args)
                    if (resp instanceof Response) return resp
                } catch (err) {}
            }
            return response; // 返回原始响应
        };
    } catch(err) {}
    w.__fetchInterceptor__ = (key, fn) => {
        w.__fetchInterceptorMap__[key] = fn
    }
    return w.__fetchInterceptor__
}