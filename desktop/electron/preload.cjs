const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('eyed', {
  getStats: () => ipcRenderer.invoke('stats:get'),
  onStats: (cb) => {
    const listener = (_e, data) => cb(data)
    ipcRenderer.on('stats:update', listener)
    return () => ipcRenderer.removeListener('stats:update', listener)
  },
  onSettings: (cb) => {
    const listener = (_e, data) => cb(data)
    ipcRenderer.on('settings:update', listener)
    return () => ipcRenderer.removeListener('settings:update', listener)
  },
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (partial) => ipcRenderer.invoke('settings:set', partial),
  getDiscordPresenceStatus: () => ipcRenderer.invoke('discord:presenceStatus'),
  refreshDiscordPresence: () => ipcRenderer.invoke('discord:presenceRefresh'),
  setOverlayEnabled: (v) => ipcRenderer.invoke('overlay:setEnabled', v),
  setGameMode: (v) => ipcRenderer.invoke('overlay:setGameMode', v),
  getOverlayState: () => ipcRenderer.invoke('overlay:getState'),
  setOverlayInteractive: (v) => ipcRenderer.invoke('overlay:setInteractive', v),
  setOverlayClickThrough: (v) => ipcRenderer.invoke('overlay:setClickThrough', v),
  openOverlayConfig: () => ipcRenderer.invoke('overlay:openConfig'),
  reportOverlaySize: (w, h) => ipcRenderer.invoke('overlay:reportSize', w, h),
  onOverlayOpenConfig: (cb) => {
    const listener = () => cb()
    ipcRenderer.on('overlay:openConfig', listener)
    return () => ipcRenderer.removeListener('overlay:openConfig', listener)
  },
  getNetworkInfo: () => ipcRenderer.invoke('net:info'),
  runSpeedTest: () => ipcRenderer.invoke('net:speedTest'),
  cancelSpeedTest: () => ipcRenderer.invoke('net:cancelSpeedTest'),
  measureBufferbloat: () => ipcRenderer.invoke('net:bufferbloat'),
  onSpeedProgress: (cb) => {
    const listener = (_e, data) => cb(data)
    ipcRenderer.on('net:speedProgress', listener)
    return () => ipcRenderer.removeListener('net:speedProgress', listener)
  },
  onBufferbloatProgress: (cb) => {
    const listener = (_e, data) => cb(data)
    ipcRenderer.on('net:bufferbloatProgress', listener)
    return () => ipcRenderer.removeListener('net:bufferbloatProgress', listener)
  },
  getHistory: () => ipcRenderer.invoke('history:get'),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  addSpeedTestHistory: (result) => ipcRenderer.invoke('history:addSpeedTest', result),
  onBadMoment: (cb) => {
    const listener = (_e, data) => cb(data)
    ipcRenderer.on('history:moment', listener)
    return () => ipcRenderer.removeListener('history:moment', listener)
  },
  diagnoseNow: () => ipcRenderer.invoke('diagnose:now'),
  getCompetitive: () => ipcRenderer.invoke('competitive:get'),
  setCompetitive: (v) => ipcRenderer.invoke('competitive:set', v),
  setPerformanceMode: (mode) => ipcRenderer.invoke('mode:set', mode),
  getPerformanceMode: () => ipcRenderer.invoke('mode:get'),
  elevateFps: () => ipcRenderer.invoke('fps:elevate'),
  getFpsStatus: () => ipcRenderer.invoke('fps:status'),
  getPlatform: () => ipcRenderer.invoke('platform:caps'),
  listStartup: () => ipcRenderer.invoke('startup:list'),
  setStartup: (payload) => ipcRenderer.invoke('startup:set', payload),
  cleanTemps: () => ipcRenderer.invoke('clean:temps'),
  optimizeVolume: (letter, kind) => ipcRenderer.invoke('disk:optimize', { letter, kind }),
  getNetConnections: () => ipcRenderer.invoke('net:connections'),
  getLanDevices: () => ipcRenderer.invoke('net:devices'),
  getNetThroughput: () => ipcRenderer.invoke('net:throughput'),
  getFirewall: () => ipcRenderer.invoke('firewall:get'),
  setFirewall: (name, enabled) => ipcRenderer.invoke('firewall:set', { name, enabled }),
  listDrivers: () => ipcRenderer.invoke('drivers:list'),
  listEvents: (max) => ipcRenderer.invoke('events:list', max),
  listBsod: () => ipcRenderer.invoke('bsod:list'),
  checkInstability: () => ipcRenderer.invoke('instability:check'),
  benchCpu: () => ipcRenderer.invoke('bench:cpu'),
  benchRam: () => ipcRenderer.invoke('bench:ram'),
  benchSsd: () => ipcRenderer.invoke('bench:ssd'),
  benchGpu: () => ipcRenderer.invoke('bench:gpu'),
  getHardwareControl: () => ipcRenderer.invoke('hw:get'),
  startLaptopFans: () => ipcRenderer.invoke('hw:startFans'),
  setGpuPowerLimit: (w) => ipcRenderer.invoke('hw:powerLimit', w),
  launchOpenRgb: () => ipcRenderer.invoke('hw:openRgb'),
  backupSettings: () => ipcRenderer.invoke('backup:settings'),
  exportReport: () => ipcRenderer.invoke('report:html'),
  optimizeRam: () => ipcRenderer.invoke('ram:optimize'),
  clearRamCache: () => ipcRenderer.invoke('ram:clearCache'),
  getDiskInfo: () => ipcRenderer.invoke('disk:get'),
  getAdvancedSpecs: () => ipcRenderer.invoke('specs:get'),
  listApps: () => ipcRenderer.invoke('apps:list'),
  getAppDetails: (appInfo) => ipcRenderer.invoke('apps:details', appInfo),
  uninstallApp: (appInfo, opts) => ipcRenderer.invoke('apps:uninstall', appInfo, opts),
  openAppPath: (folder) => ipcRenderer.invoke('apps:openPath', folder),
  listProcesses: () => ipcRenderer.invoke('proc:list'),
  killProcess: (pid) => ipcRenderer.invoke('proc:kill', pid),
  hideToTray: () => ipcRenderer.invoke('app:hideToTray'),
  quitApp: () => ipcRenderer.invoke('app:quit'),
  showApp: () => ipcRenderer.invoke('app:show'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  openDiscord: () => ipcRenderer.invoke('app:openDiscord'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  getUpdateStatus: () => ipcRenderer.invoke('update:status'),
  openUpdatePage: () => ipcRenderer.invoke('update:open'),
  onUpdateStatus: (cb) => {
    const listener = (_e, data) => cb(data)
    ipcRenderer.on('update:status', listener)
    return () => ipcRenderer.removeListener('update:status', listener)
  },
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  onWindowState: (cb) => {
    const listener = (_e, data) => cb(data)
    ipcRenderer.on('window:state', listener)
    return () => ipcRenderer.removeListener('window:state', listener)
  },
})
