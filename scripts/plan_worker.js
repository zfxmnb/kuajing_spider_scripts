const run = () => {
    self.postMessage(Date.now())
}
self.addEventListener('message', (event) => {
    event.data && setInterval(() => {
        run()
    }, event.data);
})