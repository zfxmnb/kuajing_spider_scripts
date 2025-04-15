window.temu_faker_core = async () => {
    if (window.location.pathname === '/mmsos/print.html') return
    // -----------------------------------------------------------------------------
    // 模糊匹配内容元素
    // 倒入样式
    function styles(content){
        const style = document.createElement('style');
        style.innerText = content
        document.body.appendChild(style)
        return style
    }
    // ------------------------------------------------------------------------------------
    // 执行
    styles(`
        .temu_plugin_image_con {
            position: relative;
            width: 72px;
            height: 72px;
            border-radius: 6px;
            overflow: hidden;
            background: rgb(230, 230, 230);
            display: inline-block;
            margin-top: 8px;
            margin-right: 8px;
            vertical-align: text-top;
        }
        .temu_plugin_image_upload {
            position: absolute;
            width: 100%;
            height: 100%;
            opacity: 0;
            left: 0;
            top: 0;
        }
        .temu_plugin_image {
            width: 100%;
            height: 100%;
            object-fit: contain;
        }
        `)

    function init () {
        const keyMap = {};
        let recordDrawer = null
        let recordDrawerStyle = null
        document.addEventListener('keydown', function(event) {
            keyMap[event.key] = true;
            if (keyMap['Control'] && keyMap['F1']) {
                const ele = document.activeElement
                if (ele && ele !== document.body && ele.getAttribute('contenteditable') === 'true') {
                    const div = document.createElement('div')
                    div.className = "temu_plugin_image_con"
                    div.setAttribute('contenteditable', false)
                    div.innerHTML = `<input class="temu_plugin_image_upload" type="file" accept="image/*" onchange="document.temu_plugin_Image_upload(this)">`
                    ele.appendChild(div)
                }
            }
            if (keyMap['Control'] && keyMap['Shift'] && keyMap['V']) {
                if (recordDrawer) {
                    recordDrawer.remove()
                    recordDrawerStyle.remove()
                    recordDrawer = null
                    recordDrawerStyle = null
                    document.querySelectorAll('.Drawer_outerWrapper_123').forEach((ele) => {
                        ele.remove()
                    })
                } else  {
                    const drawer = document.querySelector('.Drawer_outerWrapper_123.Drawer_visible_123')
                    if (drawer) {
                        recordDrawer = drawer.cloneNode(true)
                        recordDrawer.querySelectorAll('.Drawer_visible_123').forEach((ele) => {
                            ele.classList.remove('Drawer_visible_123')
                            ele.classList.add('Drawer_visible_custom')
                        })
                        recordDrawer.classList.remove('Drawer_visible_123')
                        recordDrawer.classList.add('Drawer_visible_force')
                        recordDrawerStyle = styles(`
                        .Drawer_outerWrapper_123 {
                            display: none !important;
                        }
                        .temu_plugin, .temu_plugin_order_extra_gooditem, .temu_plugin_sku_extra {
                            display: none !important;
                        }
                        .Drawer_visible_force {
                            display: block !important;
                        }
                        `)
                        document.body.appendChild(recordDrawer)
                    }
                }
                   
            }
        });
        document.addEventListener('keyup', function(event) {
            delete keyMap[event.key];
        });
        document.body.addEventListener('click', async (e) => {
            const ele = e.target
            if (keyMap['Control'] && keyMap['Shift']) {
                if (ele.getAttribute('contenteditable') === 'true') {
                    ele.setAttribute('contenteditable', false)
                } else {
                    ele.setAttribute('contenteditable', true)
                }
            }
        })
        document.temu_plugin_Image_upload = function(imageInput) {
            if (imageInput.files.length > 0) {
              const file = imageInput.files[0];
              // 创建 URL 预览图片
              const imageUrl = URL.createObjectURL(file);
              const img = document.createElement('img')
              img.className = "temu_plugin_image"
              img.src=imageUrl
              imageInput.parentElement.prepend(img)
            }
        }
        document.body.addEventListener('click', async (e) => {
            const ele = e.target
            if (recordDrawer && ele.classList?.contains?.('Drawer_mask_123')) {
                recordDrawer.querySelectorAll('.Drawer_visible_custom').forEach((ele) => {
                    ele.classList.remove('Drawer_visible_123')
                })
                setTimeout(() => {
                    recordDrawer.classList.remove('Drawer_visible_123')
                }, 300)
            } else if (ele.innerHTML === "查看售后详情" && recordDrawer) {
                setTimeout(() => {
                    recordDrawer.classList.add('Drawer_visible_123')
                    setTimeout(() => {
                        recordDrawer.querySelectorAll('.Drawer_visible_custom').forEach((ele) => {
                            ele.classList.add('Drawer_visible_123')
                        })
                    })
                }, 200)
            }
        })
    }
    if (location.pathname === "/mmsos/return-refund-list.html") {
        init()
    }
}