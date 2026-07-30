const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('setup', {
  getInfo: () => ipcRenderer.invoke('setup:getInfo'),
  getLicense: () => ipcRenderer.invoke('setup:getLicense'),
  diskSpace: (dir) => ipcRenderer.invoke('setup:diskSpace', dir),
  pickDir: (current) => ipcRenderer.invoke('setup:pickDir', current),
  install: (options) => ipcRenderer.invoke('setup:install', options),
  uninstall: (options) => ipcRenderer.invoke('setup:uninstall', options),
  launch: (exePath) => ipcRenderer.invoke('setup:launch', exePath),
  close: () => ipcRenderer.invoke('setup:close'),
  minimize: () => ipcRenderer.invoke('setup:minimize'),
  onProgress: (cb) => {
    const listener = (_e, data) => cb(data)
    ipcRenderer.on('setup:progress', listener)
    return () => ipcRenderer.removeListener('setup:progress', listener)
  },
})
