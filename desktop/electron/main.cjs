const { app, BrowserWindow, ipcMain, screen, shell, Tray, Menu, nativeImage, globalShortcut, dialog } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { execFile } = require('node:child_process')

// Evita que Chromium oculte/throttlee el OSD cuando un juego a pantalla completa lo tapa
try {
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
  app.commandLine.appendSwitch('disable-renderer-backgrounding')
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
} catch {
  /* */
}

const { collectSafe, detectForegroundGame } = require('./monitor.cjs')
const discordPresence = require('./discord-presence.cjs')
const { startFpsMonitor, stopFpsMonitor, getFpsStats, startElevatedFpsMonitor, prepareFpsForOverlay, resetFpsCooldown } = require('./fps.cjs')
const { optimizeRam, clearRamCache, listProcesses, killProcess } = require('./optimizer.cjs')
const { getGameClientRect, forceBorderlessFullscreen, clearGameWindowCache, clearBorderlessCache, ensureOverlayCanCoverFullscreen, getForegroundWindowInfo, isLastExclusive } = require('./gamewindow.cjs')
const { resolveGameCoverUrl } = require('./gamecover.cjs')
const { assertNativeTopmost } = require('./overlay-zorder.cjs')
const { getDiskInfo, getAdvancedSpecs } = require('./systeminfo.cjs')
const { listInstalledApps, getAppDetails, uninstallApp } = require('./apps.cjs')
const { enrichProcess } = require('./processinfo.cjs')
const { getNetworkInfo, runSpeedTest, cancelSpeedTest, measureBufferbloat } = require('./netinfo.cjs')
const history = require('./history.cjs')
const { diagnoseNow } = require('./diagnose.cjs')
const { setCompetitive, getCompetitive } = require('./competitive.cjs')
const toolbox = require('./toolbox.cjs')
const updater = require('./updater.cjs')

const coverCache = new Map()
let gameSession = null

async function resolveProcessPath(pid) {
  if (!pid) return ''
  try {
    const out = await new Promise((resolve) => {
      execFile(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `try { (Get-Process -Id ${Number(pid)} -EA Stop).Path } catch { '' }`,
        ],
        { windowsHide: true, timeout: 4000 },
        (_e, stdout) => resolve(String(stdout || '').trim()),
      )
    })
    return out && fs.existsSync(out) ? out : ''
  } catch {
    return ''
  }
}

async function getCoverForGame(game) {
  const key = `${game?.pid || ''}:${game?.processName || ''}:${game?.title || ''}`
  if (!game?.active) return null
  if (coverCache.has(key)) return coverCache.get(key)
  const exe =
    (game?.exePath && fs.existsSync(game.exePath) ? game.exePath : '') || (await resolveProcessPath(game.pid))
  let fileIcon = null
  if (exe) {
    try {
      const img = await app.getFileIcon(exe, { size: 'large' })
      fileIcon = img && !img.isEmpty() ? img.toDataURL() : null
    } catch {
      fileIcon = null
    }
  }
  let coverUrl = resolveGameCoverUrl({
    processName: game?.processName,
    title: game?.title,
    exePath: exe,
  })
  const payload = { icon: coverUrl || fileIcon, coverUrl, fileIcon }
  coverCache.set(key, payload)
  if (coverCache.size > 40) {
    const first = coverCache.keys().next().value
    coverCache.delete(first)
  }
  return payload
}

// Una sola instancia en el PC
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
  process.exit(0)
}

app.on('second-instance', () => {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  } catch {
    /* ignore */
  }
})

const isDev = !!process.env.VITE_DEV_SERVER_URL
let mainWindow = null
let overlayWindow = null
let tray = null
let statsTimer = null
let fpsOverlayTimer = null
let pinTimer = null
let lastStats = null
let isQuitting = false
let tickCount = 0
let ticking = false
let anchoredPid = 0
const iconCache = new Map()
const DISCORD_URL = 'https://discord.gg/eN6eQdGn87'

const OSD_PAD = 14

const defaults = {
  overlayEnabled: true,
  gameActive: false,
  closeToTray: true,
  startMinimized: false,
  competitiveMode: false,
  performanceMode: 'work',
  gameAutoOptimize: false,
  alertCpuTemp: 90,
  alertGpuTemp: 85,
  alertRam: 90,
  overlayOpacity: 0.48,
  overlayScale: 1,
  overlayLayout: 'panel',
  overlayCorner: 'tl',
  /** Si true, ancla OSD al juego y muestra nombre. Discord Presence detecta juego por su cuenta. */
  detectGame: false,
  /** Si true, intenta pasar exclusive DXGI a borderless para dibujar el OSD encima. Off por defecto (anti-cheat). */
  allowBorderlessTakeover: false,
  /** Helper temp CPU v2: una instalación (UAC) y listo para siempre. */
  cpuSensorHelperV2: false,
  cpuSensorInstallDenied: false,
  discordPresence: false,
  discordPresenceMode: 'performance',
  discordClientId: '1531906316770218024',
  overlayWidgets: {
    game: true,
    gpu: true,
    vram: true,
    cpu: true,
    ram: true,
    fps: true,
    fpsStats: true,
    frametime: true,
    temps: true,
    power: true,
  },
}

function clampScale(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return 1
  return Math.max(0.75, Math.min(1.75, Math.round(v * 100) / 100))
}

function normalizeCorner(c) {
  return ['tl', 'tr', 'bl', 'br'].includes(c) ? c : 'tl'
}

function normalizeLayout(l) {
  return l === 'bar' ? 'bar' : 'panel'
}

function getOsdSize(s = settings) {
  const scale = clampScale(s?.overlayScale ?? 1)
  const layout = normalizeLayout(s?.overlayLayout)
  const widgets = s?.overlayWidgets || defaults.overlayWidgets
  if (layout === 'bar') {
    return {
      w: Math.round(720 * scale),
      h: Math.round(40 * scale),
      scale,
      layout,
      corner: normalizeCorner(s?.overlayCorner),
    }
  }
  // Layout panel: estimar alto generoso del OSD nuevo (hero FPS + HW)
  let h = 28
  if (widgets.game !== false) h += 26
  if (widgets.fps !== false) {
    h += 100
    if (widgets.fpsStats !== false) h += 52
    if (widgets.frametime !== false) h += 58
  }
  if (widgets.gpu !== false) h += 58
  if (widgets.cpu !== false) h += 52
  if (widgets.ram !== false) h += 56
  h = Math.min(560, Math.max(220, h))
  return {
    w: Math.round(250 * scale),
    h: Math.round(h * scale),
    scale,
    layout,
    corner: normalizeCorner(s?.overlayCorner),
  }
}

function cornerXY(rect, w, h, corner, pad = OSD_PAD) {
  const c = normalizeCorner(corner)
  const maxX = rect.x + Math.max(pad, rect.width - w - pad)
  const maxY = rect.y + Math.max(pad, rect.height - h - pad)
  const minX = rect.x + pad
  const minY = rect.y + pad
  if (c === 'tr') return { x: maxX, y: minY }
  if (c === 'bl') return { x: minX, y: maxY }
  if (c === 'br') return { x: maxX, y: maxY }
  return { x: minX, y: minY }
}

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json')
}

function loadSettings() {
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf8')
    const parsed = JSON.parse(raw)
    // No aceptar Application ID del usuario: siempre el de EyedOptimizer
    const { discordClientId: _ignored, ...rest } = parsed
    return {
      ...defaults,
      ...rest,
      discordClientId: discordPresence.DEFAULT_CLIENT_ID,
      overlayWidgets: { ...defaults.overlayWidgets, ...(parsed.overlayWidgets || {}) },
      overlayScale: clampScale(parsed.overlayScale ?? defaults.overlayScale),
      overlayLayout: normalizeLayout(parsed.overlayLayout ?? defaults.overlayLayout),
      overlayCorner: normalizeCorner(parsed.overlayCorner ?? defaults.overlayCorner),
    }
  } catch {
    return {
      ...defaults,
      overlayWidgets: { ...defaults.overlayWidgets },
      overlayScale: defaults.overlayScale,
      overlayLayout: defaults.overlayLayout,
      overlayCorner: defaults.overlayCorner,
      discordClientId: discordPresence.DEFAULT_CLIENT_ID,
    }
  }
}

function saveSettings(partial) {
  const incoming = { ...(partial || {}) }
  // El Application ID no es configurable desde la UI ni IPC
  delete incoming.discordClientId
  const prev = loadSettings()
  const next = {
    ...prev,
    ...incoming,
    discordClientId: discordPresence.DEFAULT_CLIENT_ID,
    overlayWidgets: {
      ...defaults.overlayWidgets,
      ...(prev.overlayWidgets || {}),
      ...((incoming && incoming.overlayWidgets) || {}),
    },
    overlayScale: clampScale(
      incoming && incoming.overlayScale != null ? incoming.overlayScale : prev.overlayScale ?? defaults.overlayScale,
    ),
    overlayLayout: normalizeLayout(
      incoming && incoming.overlayLayout != null ? incoming.overlayLayout : prev.overlayLayout ?? defaults.overlayLayout,
    ),
    overlayCorner: normalizeCorner(
      incoming && incoming.overlayCorner != null ? incoming.overlayCorner : prev.overlayCorner ?? defaults.overlayCorner,
    ),
  }
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true })
  fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf8')
  const overlayJustOn = !!next.overlayEnabled && !prev.overlayEnabled
  const overlayJustOff = !next.overlayEnabled && !!prev.overlayEnabled
  settings = next
  try {
    void discordPresence.applyConfig(next)
  } catch {
    /* ignore */
  }
  if (overlayJustOn) {
    resetFpsCooldown()
    ensureOverlayRunning()
  } else if (overlayJustOff) {
    stopGearHitTest()
    hideOverlay(true)
  }
  // Nunca reposicionar mientras se edita la config (rompía el panel)
  try {
    if (
      !overlayConfigOpen &&
      overlayWindow &&
      !overlayWindow.isDestroyed() &&
      overlayWindow.isVisible()
    ) {
      void pinOverlayToGame(anchoredPid || lastGamePid || 0)
    }
  } catch {
    /* ignore */
  }
  return next
}

/** Settings visibles al renderer (sin Application ID). */
function settingsForUi(s = settings) {
  const { discordClientId: _id, ...publicSettings } = s || {}
  return publicSettings
}

let settings = loadSettings()

function resolveHtml(name) {
  if (isDev) {
    const base = process.env.VITE_DEV_SERVER_URL
    return name === 'overlay' ? `${base}/overlay.html` : base
  }
  return path.join(__dirname, '..', 'dist', name === 'overlay' ? 'overlay.html' : 'index.html')
}

function iconPath() {
  const candidates = [
    path.join(__dirname, '..', 'build', 'icon.ico'),
    path.join(__dirname, '..', 'public', 'logo.ico'),
    path.join(process.resourcesPath || '', 'icon.ico'),
    path.join(__dirname, '..', 'public', 'icon.ico'),
    path.join(__dirname, '..', '..', 'assets', 'icon.ico'),
  ]
  return candidates.find((p) => fs.existsSync(p))
}

function createTray() {
  const ico = iconPath()
  const image = ico ? nativeImage.createFromPath(ico) : nativeImage.createEmpty()
  tray = new Tray(image.isEmpty() ? nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA4AAAAOCAYAAAAfSC3RAAAALElEQVQoka3MsQkAIBADwZPsv1e0gBQh+5nAwcHBwQ8Q+ZkZgQ8Q+ZkZgQ8Q+ZkZgQ8Q+ZkZgQ8Q+ZkZgQ8Q+ZkZgf8A8gYHqk7m2nQAAAAASUVORK5CYII=',
  ) : image)

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Abrir EyedOptimizer',
      click: () => showMain(),
    },
    {
      label: 'Overlay en juegos',
      type: 'checkbox',
      checked: settings.overlayEnabled,
      click: (item) => {
        settings = saveSettings({ overlayEnabled: item.checked })
        broadcast('settings:update', settingsForUi(settings))
      },
    },
    {
      label: 'Configurar OSD…',
      click: () => {
        openOverlayConfigPanel()
      },
    },
    { type: 'separator' },
    {
      label: 'Salir',
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ])
  tray.setToolTip('EyedOptimizer')
  tray.setContextMenu(contextMenu)
  tray.on('double-click', () => showMain())
}

function showMain() {
  if (!mainWindow) createMainWindow()
  mainWindow.show()
  mainWindow.focus()
}

function createMainWindow() {
  const ico = iconPath()
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#070b12',
    title: 'EyedOptimizer',
    show: false,
    frame: false,
    autoHideMenuBar: true,
    icon: ico,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  try {
    mainWindow.setMenuBarVisibility(false)
    mainWindow.removeMenu()
  } catch {
    /* ignore */
  }

  if (isDev) mainWindow.loadURL(resolveHtml('main'))
  else mainWindow.loadFile(resolveHtml('main'))

  mainWindow.once('ready-to-show', () => {
    if (settings.startMinimized && settings.closeToTray) {
      // stay hidden in tray
    } else {
      mainWindow.show()
    }
  })

  // Al enfocar la app: ocultar OSD visualmente, pero NO cortar FPS/monitor
  mainWindow.on('focus', () => {
    if (!overlayConfigOpen) hideOverlayVisualOnly()
  })
  mainWindow.on('show', () => {
    if (!overlayConfigOpen) hideOverlayVisualOnly()
  })
  mainWindow.on('restore', () => {
    if (!overlayConfigOpen) hideOverlayVisualOnly()
  })
  mainWindow.on('blur', () => {
    // Al salir de la app, volver a mostrar OSD si está activo
    if (settings.overlayEnabled && !overlayConfigOpen) {
      scheduleShowOverlay()
    }
  })
  mainWindow.on('hide', () => {
    if (settings.overlayEnabled && !overlayConfigOpen) {
      scheduleShowOverlay()
    }
  })
  mainWindow.on('minimize', () => {
    if (settings.overlayEnabled && !overlayConfigOpen) {
      scheduleShowOverlay()
    }
  })
  mainWindow.on('maximize', () => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('window:state', { maximized: true })
  })
  mainWindow.on('unmaximize', () => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('window:state', { maximized: false })
  })

  mainWindow.on('close', (e) => {
    if (!isQuitting && settings.closeToTray) {
      e.preventDefault()
      mainWindow.hide()
      return
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Pantalla azul vacía: el renderer a veces muere; recargar en lugar de dejar el fondo
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('render-process-gone', details?.reason, details?.exitCode)
    if (mainWindow && !mainWindow.isDestroyed()) {
      setTimeout(() => {
        try {
          if (isDev) mainWindow.loadURL(resolveHtml('main'))
          else mainWindow.loadFile(resolveHtml('main'))
        } catch (err) {
          console.error('reload after crash failed', err)
        }
      }, 400)
    }
  })
  mainWindow.webContents.on('unresponsive', () => {
    console.warn('main window unresponsive')
  })
}

let overlayConfigOpen = false
let lastPinnedBounds = null
/** Tamaño real del panel reportado por el renderer (no machacar con getOsdSize en el pin). */
let overlayContentSize = null

function boundsNearlyEqual(a, b, tol = 24) {
  if (!a || !b) return false
  return (
    Math.abs(a.x - b.x) <= tol &&
    Math.abs(a.y - b.y) <= tol &&
    Math.abs(a.width - b.width) <= tol &&
    Math.abs(a.height - b.height) <= tol
  )
}

function applyOverlayBounds(pos) {
  if (!overlayWindow || overlayWindow.isDestroyed() || !pos) return false
  if (boundsNearlyEqual(lastPinnedBounds, pos)) return true
  try {
    const next = {
      x: Math.round(pos.x),
      y: Math.round(pos.y),
      width: Math.max(80, Math.round(pos.width)),
      height: Math.max(40, Math.round(pos.height)),
    }
    // Si solo se movió, setPosition (menos parpadeo que setBounds)
    if (
      lastPinnedBounds &&
      Math.abs(lastPinnedBounds.width - next.width) <= 2 &&
      Math.abs(lastPinnedBounds.height - next.height) <= 2
    ) {
      overlayWindow.setPosition(next.x, next.y, false)
    } else {
      overlayWindow.setBounds(next, false)
    }
    lastPinnedBounds = { ...next }
    return true
  } catch {
    return false
  }
}

function placeConfigOverlay() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  const cfgW = 420
  const cfgH = 720
  let x
  let y
  try {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && !mainWindow.isMinimized()) {
      const mb = mainWindow.getBounds()
      x = Math.round(mb.x + Math.max(20, (mb.width - cfgW) / 2))
      y = Math.round(mb.y + Math.max(48, (mb.height - cfgH) / 2))
    } else {
      const d = screen.getPrimaryDisplay().workArea
      x = d.x + Math.round((d.width - cfgW) / 2)
      y = d.y + Math.round((d.height - cfgH) / 2)
    }
  } catch {
    const d = screen.getPrimaryDisplay().bounds
    x = d.x + 48
    y = d.y + 48
  }
  lastPinnedBounds = null
  applyOverlayBounds({ x, y, width: cfgW, height: cfgH })
}

/** Click-through real del OSD. Sin forward:true (ese modo laguea el mouse en juegos). */
function setOverlayClickThrough(passThrough) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  try {
    if (overlayConfigOpen) {
      overlayWindow.setIgnoreMouseEvents(false)
      return
    }
    // Sin { forward: true }: Chromium no recibe mouse-move → sin tirones en el juego
    overlayWindow.setIgnoreMouseEvents(!!passThrough)
  } catch {
    /* ignore */
  }
}

function resumeOverlayAfterConfig() {
  overlayConfigOpen = false
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  try {
    overlayWindow.setFocusable(false)
    setOverlayClickThrough(true)
  } catch {
    /* ignore */
  }
  lastPinnedBounds = null
  gearMouseOver = false
  if (settings.overlayEnabled) {
    ensureOverlayRunning()
  } else {
    hideOverlay(true)
  }
}

function setOverlayInteractive(enabled) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  try {
    if (enabled) {
      overlayConfigOpen = true
      stopPinLoop()
      stopGearHitTest()
      overlayWindow.setIgnoreMouseEvents(false)
      overlayWindow.setFocusable(true)
      placeConfigOverlay()
      if (!overlayWindow.isVisible()) overlayWindow.showInactive()
      try {
        overlayWindow.moveTop()
      } catch {
        /* ignore */
      }
      const mainUp =
        mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && !mainWindow.isMinimized()
      if (!mainUp) {
        try {
          overlayWindow.focus()
        } catch {
          /* ignore */
        }
      }
    } else {
      resumeOverlayAfterConfig()
    }
  } catch {
    /* ignore */
  }
}

function openOverlayConfigPanel() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return false
  try {
    overlayConfigOpen = true
    stopPinLoop()
    setOverlayInteractive(true)
    overlayWindow.webContents.send('overlay:openConfig')
    if (lastStats) {
      try {
        overlayWindow.webContents.send('stats:update', lastStats)
      } catch {
        /* ignore */
      }
    }
    return true
  } catch {
    overlayConfigOpen = false
    return false
  }
}

function createOverlayWindow() {
  const display = screen.getPrimaryDisplay()
  const { w, h } = getOsdSize()
  // Icono vacío: evita que el .ico de EyedOptimizer parpadee en ventanas transparentes (DWM)
  const emptyIcon = nativeImage.createEmpty()

  overlayWindow = new BrowserWindow({
    width: w + 16,
    height: h + 16,
    x: display.bounds.x + 20,
    y: display.bounds.y + 20,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    icon: emptyIcon,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    hasShadow: false,
    show: false,
    fullscreenable: false,
    thickFrame: false,
    autoHideMenuBar: true,
    // toolbar: mejor comportamiento encima de juegos en Windows
    type: process.platform === 'win32' ? 'toolbar' : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  })

  try {
    overlayWindow.setIcon(emptyIcon)
  } catch {
    /* ignore */
  }
  overlayWindow.setIgnoreMouseEvents(true)
  overlayWindow.setAlwaysOnTop(true, 'screen-saver', 1)
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  try {
    overlayWindow.setFullScreenable(false)
  } catch {
    /* ignore */
  }
  // Reafirmar topmost nativo al crear (una sola vez)
  setTimeout(() => assertOverlayTop('native'), 300)

  if (isDev) overlayWindow.loadURL(resolveHtml('overlay'))
  else overlayWindow.loadFile(resolveHtml('overlay'))

  overlayWindow.webContents.on('did-finish-load', () => {
    try {
      if (overlayConfigOpen) overlayWindow.setIgnoreMouseEvents(false)
      else overlayWindow.setIgnoreMouseEvents(true)
    } catch {
      /* ignore */
    }
  })

  overlayWindow.on('closed', () => {
    overlayWindow = null
  })
}

let lastTopAssertAt = 0
let lastNativeTopAt = 0
let lastGameHwnd = null
/** PowerShell TOPMOST: más seguido si hay exclusive FS. */
const NATIVE_TOP_INTERVAL_MS = 3500

/**
 * @param {boolean|'native'} [force] true = Electron topmost; 'native' = también PowerShell ya
 */
function assertOverlayTop(force = false, gameHwnd = null) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  if (overlayConfigOpen && force !== 'native') return
  const now = Date.now()
  const softMin = force === 'native' ? 0 : 1200
  if (!force && now - lastTopAssertAt < softMin) return
  lastTopAssertAt = now
  if (gameHwnd) lastGameHwnd = gameHwnd
  try {
    overlayWindow.setAlwaysOnTop(true, 'screen-saver', 1)
    overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    // Nunca moveTop aquí: quita el foco al juego (parece que “solo aparece con Win”)
  } catch {
    /* ignore */
  }
  const wantNative = force === 'native' || now - lastNativeTopAt >= NATIVE_TOP_INTERVAL_MS
  if (!wantNative) return
  lastNativeTopAt = now
  void assertNativeTopmost(overlayWindow, {
    force: force === 'native',
    minIntervalMs: force === 'native' ? 600 : NATIVE_TOP_INTERVAL_MS,
    gameHwnd: gameHwnd || lastGameHwnd,
  })
}

/** Coloca el OSD; si hay DXGI exclusive, fuerza borderless para poder dibujar encima. */
async function pinOverlayToGame(pid, opts = {}) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return false
  const id = Number(pid) || 0
  const display = screen.getPrimaryDisplay()
  const base = getOsdSize()
  const w = Math.max(base.w, overlayContentSize?.w || 0, lastPinnedBounds?.width || 0)
  const h = Math.max(base.h, overlayContentSize?.h || 0, lastPinnedBounds?.height || 0)
  const layout = base.layout
  const corner = base.corner
  const screenRect = {
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
  }
  let rect = screenRect
  let pinned = false
  let gameHwnd = null

  try {
    const fg = settings.allowBorderlessTakeover
      ? await ensureOverlayCanCoverFullscreen(display.bounds)
      : await getForegroundWindowInfo(false)
    if (fg?.hwnd) {
      gameHwnd = fg.hwnd
      lastGameHwnd = gameHwnd
      if (fg.pid) lastGamePid = fg.pid
    }
    // Borderless solo con opt-in (anti-cheat / evita forzar FS en juegos)
    const canBreak =
      !!settings.allowBorderlessTakeover &&
      !!(fg?.exclusive || fg?.fullscreen || fg?.broke)
    const breakPid = canBreak ? fg?.pid || (settings.detectGame ? id : 0) || 0 : 0
    if (breakPid) {
      try {
        await forceBorderlessFullscreen(breakPid, display.bounds, {
          force: true,
          hwnd: fg?.hwnd,
        })
      } catch {
        /* ignore */
      }
    }
    const pinPid = settings.detectGame ? id || fg?.pid || 0 : 0
    if (settings.detectGame && pinPid) {
      const gameRect = await getGameClientRect(pinPid, !!opts.forceRect)
      if (gameRect) {
        anchoredPid = pinPid
        rect = gameRect
        pinned = true
        gameHwnd = gameRect.hwnd || gameHwnd
        lastGameHwnd = gameHwnd
      }
    }
  } catch {
    /* ignore */
  }

  let pos
  if (layout === 'bar') {
    const barW = Math.max(280, Math.min(Math.max(w, 420), Math.max(200, rect.width - OSD_PAD * 2)))
    const barH = Math.max(base.h, overlayContentSize?.h || 0, 44)
    const atBottom = corner === 'bl' || corner === 'br'
    const x = Math.round(rect.x + Math.max(0, (rect.width - barW) / 2))
    const y = atBottom
      ? Math.round(rect.y + rect.height - barH - OSD_PAD)
      : Math.round(rect.y + OSD_PAD)
    pos = { x, y, width: barW, height: barH }
  } else {
    const xy = cornerXY(rect, w, h, corner)
    pos = { x: Math.round(xy.x), y: Math.round(xy.y), width: w, height: h }
  }

  try {
    return applyOverlayBounds(pos)
  } catch {
    return pinned
  } finally {
    assertOverlayTop(opts.nativeTop || (isLastExclusive() ? 'native' : false), gameHwnd)
  }
}

let pinTarget = -1
let pinTick = 0
let exclusiveWatchTimer = null

function startExclusiveWatch() {
  if (exclusiveWatchTimer) return
  // Solo vigilar exclusive si el usuario optó por borderless takeover
  exclusiveWatchTimer = setInterval(() => {
    if (isQuitting || !settings.overlayEnabled || overlayConfigOpen) return
    if (!settings.allowBorderlessTakeover) return
    if (!overlayWindow || overlayWindow.isDestroyed()) return
    const display = screen.getPrimaryDisplay()
    void ensureOverlayCanCoverFullscreen(display.bounds).then((fg) => {
      if (fg?.hwnd) lastGameHwnd = fg.hwnd
      if (fg?.pid) lastGamePid = fg.pid
      if (fg?.exclusive || fg?.broke || fg?.fullscreen) {
        if (!overlayWindow.isVisible()) overlayWindow.showInactive()
        assertOverlayTop('native', fg?.hwnd || lastGameHwnd)
      }
    })
  }, 2000)
}

function stopExclusiveWatch() {
  if (exclusiveWatchTimer) {
    clearInterval(exclusiveWatchTimer)
    exclusiveWatchTimer = null
  }
}

function startPinLoop(pid) {
  const id = Number(pid) || 0
  if (pinTimer && pinTarget === id) {
    startExclusiveWatch()
    return
  }
  stopPinLoop()
  pinTarget = id
  pinTick = 0
  startExclusiveWatch()
  const run = () => {
    pinTick += 1
    const first = pinTick === 1
    const nativePulse = first || pinTick % 2 === 0 || isLastExclusive()
    void pinOverlayToGame(id, {
      forceRect: first || pinTick % 3 === 0,
      nativeTop: nativePulse ? 'native' : false,
    }).then(() => {
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        if (!overlayWindow.isVisible()) overlayWindow.showInactive()
      }
    })
  }
  run()
  pinTimer = setInterval(run, 2500)
}

function stopPinLoop() {
  if (pinTimer) {
    clearInterval(pinTimer)
    pinTimer = null
  }
  pinTarget = -1
  anchoredPid = 0
  lastGameHwnd = null
  stopExclusiveWatch()
  clearGameWindowCache()
  try {
    clearBorderlessCache()
  } catch {
    /* */
  }
}

function broadcast(channel, payload) {
  const mainVisible = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()
  const overlayVisible = overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()
  if (mainVisible) mainWindow.webContents.send(channel, payload)
  if (overlayVisible || channel === 'settings:update') {
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.webContents.send(channel, payload)
  }
}

function isSelfProcess(name = '') {
  const n = String(name).toLowerCase()
  return n.includes('eyedoptimizer') || n === 'electron'
}

let hideTimer = null
let showTimer = null
let lastGameSeenAt = 0
let lastGamePid = 0
let gearHitTimer = null
let gearMouseOver = false

/** OSD activo si el toggle está on — no depende de detectar juego. */
function shouldShowOverlay(_game) {
  if (!settings.overlayEnabled) return false
  if (overlayConfigOpen) return true
  // Mientras usas la ventana principal, no tapar la UI (FPS sigue en background)
  const mainUp =
    mainWindow &&
    !mainWindow.isDestroyed() &&
    mainWindow.isVisible() &&
    !mainWindow.isMinimized() &&
    BrowserWindow.getFocusedWindow() === mainWindow
  if (mainUp) return false
  return true
}

function needsGameDetection() {
  // Discord Presence muestra juego; o el usuario activó anclar OSD al juego
  return !!settings.detectGame || !!settings.discordPresence
}

/** Solo oculta el panel; mantiene PresentMon + push FPS. */
function hideOverlayVisualOnly() {
  if (overlayConfigOpen) return
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
  stopPinLoop()
  stopGearHitTest()
  if (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()) {
    overlayWindow.hide()
  }
}

function scheduleShowOverlay() {
  if (showTimer) clearTimeout(showTimer)
  showTimer = setTimeout(() => {
    showTimer = null
    if (!settings.overlayEnabled || overlayConfigOpen || isQuitting) return
    ensureOverlayRunning()
  }, 250)
}

function ensureOverlayRunning() {
  if (!settings.overlayEnabled || isQuitting) return
  if (overlayConfigOpen) return
  if (!shouldShowOverlay()) return
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  if (!overlayWindow.isVisible()) overlayWindow.showInactive()
  const pid = settings.detectGame ? lastGamePid || anchoredPid || 0 : 0
  startPinLoop(pid)
  startFpsOverlayLoop()
  startGearHitTest()
  assertOverlayTop(false)
  // FPS amplio siempre con overlay on (no cortar al salir de fullscreen / cambiar ventana)
  startFpsMonitor('', 0, {
    captureAll: true,
    allowAutoElevate: tickCount < 12,
  }).catch(() => {})
}

function hideOverlay(stopFps = true) {
  if (overlayConfigOpen && !stopFps) return
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
  stopPinLoop()
  stopGearHitTest()
  if (stopFps) stopFpsOverlayLoop()
  if (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()) {
    overlayWindow.hide()
  }
  try {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.setIgnoreMouseEvents(true)
    }
  } catch {
    /* ignore */
  }
  if (stopFps) stopFpsMonitor()
}

/** Click en el engranaje sin forward:true (evita lag): habilita mouse solo encima del gear. */
function startGearHitTest() {
  if (gearHitTimer) return
  gearHitTimer = setInterval(() => {
    if (!overlayWindow || overlayWindow.isDestroyed() || overlayConfigOpen) return
    if (!overlayWindow.isVisible()) return
    try {
      const point = screen.getCursorScreenPoint()
      const b = overlayWindow.getBounds()
      const pad = 4
      const gw = 32
      const gh = 32
      const gx = b.x + b.width - gw - pad
      const gy = b.y + pad
      const over =
        point.x >= gx && point.x <= gx + gw && point.y >= gy && point.y <= gy + gh
      if (over !== gearMouseOver) {
        gearMouseOver = over
        if (over) overlayWindow.setIgnoreMouseEvents(false)
        else overlayWindow.setIgnoreMouseEvents(true)
      }
    } catch {
      /* ignore */
    }
  }, 100)
}

function stopGearHitTest() {
  if (gearHitTimer) {
    clearInterval(gearHitTimer)
    gearHitTimer = null
  }
  gearMouseOver = false
}

function nextInterval() {
  const mainVisible = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && !mainWindow.isMinimized()
  const overlayVisible = overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()
  const mainFocused =
    mainWindow && !mainWindow.isDestroyed() && BrowserWindow.getFocusedWindow() === mainWindow
  // Intervalos largos: WMI/si/PowerShell cada <1s laguea el ratón en todo el sistema
  if (overlayVisible && !mainVisible) return 2000
  if (overlayVisible) return 1800
  if (!mainVisible) return 3000
  if (!mainFocused) return 2200
  return 1600
}

function pushOverlayRealtime() {
  if (isQuitting) return
  if (!overlayWindow || overlayWindow.isDestroyed() || !overlayWindow.isVisible()) return
  if (!lastStats) return
  const fps = getFpsStats()
  const payload = {
    ...lastStats,
    fps,
    ts: Date.now(),
  }
  lastStats = payload
  try {
    overlayWindow.webContents.send('stats:update', payload)
  } catch {
    /* ignore */
  }
}

function startFpsOverlayLoop() {
  if (fpsOverlayTimer) return
  fpsOverlayTimer = setInterval(pushOverlayRealtime, 750)
}

function stopFpsOverlayLoop() {
  if (fpsOverlayTimer) {
    clearInterval(fpsOverlayTimer)
    fpsOverlayTimer = null
  }
}

async function tick() {
  if (ticking || isQuitting) return
  ticking = true
  tickCount += 1
  try {
    const mainVisible =
      mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && !mainWindow.isMinimized()
    const mainFocused =
      mainWindow && !mainWindow.isDestroyed() && BrowserWindow.getFocusedWindow() === mainWindow
    const overlayOn = overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()
    // light = sin nvidia-smi / disco / temps pesados (WMI laguea el ratón)
    let light = true
    if (mainVisible && mainFocused) light = false
    else if (mainVisible) light = tickCount % 2 !== 0
    else if (overlayOn) light = tickCount % 4 !== 0
    const stats = await collectSafe({ light })
    if (!stats) return

    // Conservar nucleos/GPU previos si un tick vino incompleto
    if (lastStats?.cpu?.cores?.length && !stats.cpu?.cores?.length) {
      stats.cpu.cores = lastStats.cpu.cores
    }
    if (lastStats?.gpu && (!stats.gpu || stats.gpu.load === 0 && !stats.gpu.name)) {
      stats.gpu = lastStats.gpu
    }

    let game = lastStats?.game || { active: false }
    if (needsGameDetection()) {
      game = await detectForegroundGame(stats, false)
      if (isSelfProcess(game.processName)) {
        game = { ...game, active: false }
      }
      if (game?.active && game?.pid) {
        lastGameSeenAt = Date.now()
        lastGamePid = Number(game.pid) || lastGamePid
      }
    } else {
      // Overlay no depende del juego; limpiar etiqueta si no se detecta
      game = { active: false, processName: '', pid: 0, title: '' }
    }

    const fps = getFpsStats()
    let coverIcon = null
    let coverUrl = null
    if (game?.active && (settings.detectGame || settings.discordPresence)) {
      try {
        const cov = await getCoverForGame(game)
        coverIcon = cov?.icon || null
        coverUrl = cov?.coverUrl || null
      } catch {
        coverIcon = null
        coverUrl = null
      }
    }

    // Sesiones de partida para comparación
    if (game?.active && game?.processName) {
      if (!gameSession || gameSession.processName !== game.processName) {
        if (gameSession) {
          try {
            history.addGameSession({
              ...gameSession,
              end: Date.now(),
              avgFps: gameSession.fpsSamples.length
                ? Math.round(
                    gameSession.fpsSamples.reduce((a, b) => a + b, 0) / gameSession.fpsSamples.length,
                  )
                : null,
            })
          } catch {
            /* ignore */
          }
        }
        gameSession = {
          id: `s-${Date.now()}`,
          processName: game.processName,
          title: game.title || game.processName,
          start: Date.now(),
          end: null,
          fpsSamples: [],
          gpuTemps: [],
        }
      } else {
        if (fps?.available && fps.fps > 0) gameSession.fpsSamples.push(fps.fps)
        if (stats.gpu?.temp != null) gameSession.gpuTemps.push(stats.gpu.temp)
      }
    } else if (gameSession) {
      try {
        history.addGameSession({
          ...gameSession,
          end: Date.now(),
          avgFps: gameSession.fpsSamples.length
            ? Math.round(
                gameSession.fpsSamples.reduce((a, b) => a + b, 0) / gameSession.fpsSamples.length,
              )
            : null,
          avgGpuTemp: gameSession.gpuTemps.length
            ? Math.round(
                gameSession.gpuTemps.reduce((a, b) => a + b, 0) / gameSession.gpuTemps.length,
              )
            : null,
        })
      } catch {
        /* ignore */
      }
      gameSession = null
    }

    const payload = {
      ...stats,
      fps,
      game: { ...game, cover: coverIcon, coverUrl },
      overlayEnabled: settings.overlayEnabled,
      closeToTray: settings.closeToTray,
      ts: Date.now(),
    }
    lastStats = payload
    broadcast('stats:update', payload)

    try {
      void discordPresence.pushStats(payload)
    } catch {
      /* ignore */
    }

    try {
      const hit = history.ingest(payload)
      if (hit?.moment) broadcast('history:moment', hit.moment)
    } catch {
      /* ignore */
    }

    // Overlay siempre que esté activado (no se corta al salir de fullscreen / cambiar ventana)
    const show = shouldShowOverlay(game) || overlayConfigOpen
    const targetPid = settings.detectGame ? Number(game?.pid) || lastGamePid : 0
    if (show) {
      if (hideTimer) {
        clearTimeout(hideTimer)
        hideTimer = null
      }

      const wasHidden = overlayWindow && !overlayWindow.isDestroyed() && !overlayWindow.isVisible()
      if (wasHidden) overlayWindow.showInactive()
      if (!overlayConfigOpen) startPinLoop(targetPid || 0)
      else stopPinLoop()
      if (wasHidden) assertOverlayTop('native')
      startFpsOverlayLoop()
      startGearHitTest()
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send('stats:update', {
          ...payload,
          game: settings.detectGame
            ? { ...game, pid: targetPid || game?.pid, anchored: true }
            : { active: false, processName: '', title: '', pid: 0 },
        })
      }
      // PresentMon amplio: no atar al proceso del juego (sobrevive alt-tab / borderless)
      if (!overlayConfigOpen && settings.overlayEnabled) {
        const fpsLive = fps?.available && fps.fps > 0
        startFpsMonitor(settings.detectGame ? game.processName || '' : '', targetPid, {
          force: !fpsLive && !fps?.elevated && tickCount % 24 === 0,
          captureAll: true,
          allowAutoElevate: tickCount < 12,
        }).catch(() => {})
      }
    } else if (settings.overlayEnabled) {
      // App en foco: OSD oculto, FPS sigue
      hideOverlayVisualOnly()
      startFpsOverlayLoop()
      if (!overlayConfigOpen) {
        startFpsMonitor('', 0, {
          captureAll: true,
          allowAutoElevate: false,
        }).catch(() => {})
      }
    } else {
      hideOverlay(true)
    }
  } catch (err) {
    console.error('tick error', err)
  } finally {
    ticking = false
    if (statsTimer) clearTimeout(statsTimer)
    statsTimer = setTimeout(tick, nextInterval())
  }
}

function startLoop() {
  if (statsTimer) clearTimeout(statsTimer)
  tick()
}

app.whenReady().then(() => {
  settings = loadSettings()
  // Forzar Application ID interno (no editable)
  try {
    settings = saveSettings({})
  } catch {
    /* ignore */
  }
  history.init(app.getPath('userData'))
  createTray()
  createMainWindow()
  createOverlayWindow()
  startLoop()
  // Temp CPU: sin auto-UAC por ahora (solo uso CPU en dashboard). El agente se puede activar luego.
  // Auto-update desde optzr.eyedcomun.me
  try {
    updater.startAutoCheck()
    updater.onStatus((st) => {
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('update:status', st)
        }
      } catch {
        /* */
      }
    })
  } catch {
    /* */
  }
  try {
    void discordPresence.applyConfig(settings)
    // Specs para Discord Presence (GPU discreta real + tipo DDR)
    const si = require('systeminformation')
    Promise.all([si.cpu(), si.graphics(), si.mem(), si.memLayout().catch(() => [])])
      .then(([cpu, gfx, mem, layout]) => {
        const controllers = Array.isArray(gfx?.controllers) ? gfx.controllers : []
        const score = (c) => {
          const n = `${c?.model || ''} ${c?.vendor || ''} ${c?.name || ''}`.toLowerCase()
          if (/virtual|microsoft basic|remote|parsec|vnc|citrix|qemu|vmware|hyper-v|displaylink/i.test(n)) {
            return -100
          }
          let s = 0
          if (/nvidia|geforce|rtx|gtx|quadro/i.test(n)) s += 50
          if (/amd|radeon|rx\s?\d/i.test(n)) s += 45
          if (/intel.*(arc|discrete)/i.test(n)) s += 40
          if (/intel|uhd|iris|hd graphics/i.test(n)) s += 5
          const vram = Number(c?.vram || c?.memoryTotal || 0)
          if (vram > 1024) s += Math.min(20, Math.round(vram / 1024))
          return s
        }
        const best = [...controllers].sort((a, b) => score(b) - score(a))[0]
        const gpuName = String(best?.model || best?.name || '').trim()
        const types = (Array.isArray(layout) ? layout : [])
          .map((m) => String(m?.type || m?.formFactor || '').toUpperCase())
          .filter((t) => /DDR[345]/i.test(t))
        const ddrMatch = types.join(' ').match(/DDR[345]/i)
        const ddr = ddrMatch ? ddrMatch[0].toUpperCase() : ''
        discordPresence.setSpecsCache({
          cpu: { brand: cpu.brand, manufacturer: cpu.manufacturer },
          gpu: { name: gpuName },
          ram: {
            totalGb: Math.round((mem?.total || 0) / 1073741824),
            type: ddr,
          },
        })
      })
      .catch(() => {})
  } catch {
    /* ignore */
  }

  try {
    globalShortcut.register('Control+Shift+O', () => {
      openOverlayConfigPanel()
    })
  } catch {
    /* ignore */
  }

  app.on('activate', () => {
    showMain()
  })
})

app.on('will-quit', () => {
  try {
    updater.stopAutoCheck()
  } catch {
    /* ignore */
  }
  try {
    discordPresence.shutdown()
  } catch {
    /* ignore */
  }
  try {
    toolbox.stopLaptopFanMonitor?.()
  } catch {
    /* ignore */
  }
  try {
    globalShortcut.unregisterAll()
  } catch {
    /* ignore */
  }
})

app.on('before-quit', () => {
  isQuitting = true
  if (statsTimer) clearTimeout(statsTimer)
  stopFpsOverlayLoop()
  stopPinLoop()
  stopFpsMonitor()
  try {
    toolbox.stopLaptopFanMonitor?.()
  } catch {
    /* ignore */
  }
})

app.on('window-all-closed', (e) => {
  if (settings.closeToTray && !isQuitting) {
    e.preventDefault()
    return
  }
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('stats:get', () => lastStats)
ipcMain.handle('settings:get', () => settingsForUi(loadSettings()))
ipcMain.handle('settings:set', (_e, partial) => {
  settings = saveSettings(partial || {})
  const publicSettings = settingsForUi(settings)
  broadcast('settings:update', publicSettings)
  return publicSettings
})
ipcMain.handle('discord:presenceStatus', () => discordPresence.getStatus())
ipcMain.handle('discord:presenceRefresh', async () => {
  try {
    await discordPresence.applyConfig(settings)
    if (lastStats) await discordPresence.pushStats(lastStats)
  } catch {
    /* ignore */
  }
  return discordPresence.getStatus()
})
ipcMain.handle('overlay:setEnabled', (_e, enabled) => {
  settings = saveSettings({ overlayEnabled: !!enabled })
  broadcast('settings:update', settingsForUi(settings))
  if (settings.overlayEnabled) {
    resetFpsCooldown()
    ensureOverlayRunning()
  } else {
    hideOverlay(true)
  }
  return settings.overlayEnabled
})
ipcMain.handle('overlay:setGameMode', (_e, enabled) => {
  // Vista previa SOLO dentro de la app (no fuerza ventana OSD)
  settings = saveSettings({ gameActive: !!enabled })
  return settings.gameActive
})
ipcMain.handle('overlay:getState', () => ({
  overlayEnabled: settings.overlayEnabled,
  gameActive: settings.gameActive,
  closeToTray: settings.closeToTray,
  overlayWidgets: settings.overlayWidgets,
}))
ipcMain.handle('overlay:setInteractive', (_e, enabled) => {
  setOverlayInteractive(!!enabled)
  return !!enabled
})
ipcMain.handle('overlay:setClickThrough', (_e, passThrough) => {
  setOverlayClickThrough(passThrough !== false)
  return true
})
ipcMain.handle('overlay:openConfig', () => openOverlayConfigPanel())

/** Ajusta el BrowserWindow al tamaño real del panel sin “estirones”. */
ipcMain.handle('overlay:reportSize', (_e, width, height) => {
  if (!overlayWindow || overlayWindow.isDestroyed() || overlayConfigOpen) return false
  const w = Math.max(80, Math.round(Number(width) || 0))
  const h = Math.max(40, Math.round(Number(height) || 0))
  if (w < 80 || h < 40) return false
  try {
    overlayContentSize = { w, h }
    const b = overlayWindow.getBounds()
    // Umbral amplio: evita micro-resizes que se ven como tirón
    if (Math.abs(b.width - w) < 8 && Math.abs(b.height - h) < 8) {
      if (lastPinnedBounds) lastPinnedBounds = { ...lastPinnedBounds, width: w, height: h }
      return true
    }
    const corner = normalizeCorner(settings?.overlayCorner)
    let x = b.x
    let y = b.y
    if (corner === 'tr' || corner === 'br') x = b.x + b.width - w
    if (corner === 'bl' || corner === 'br') y = b.y + b.height - h
    const next = { x: Math.round(x), y: Math.round(y), width: w, height: h }
    lastPinnedBounds = { ...next }
    overlayWindow.setBounds(next, false)
    return true
  } catch {
    return false
  }
})
ipcMain.handle('fps:elevate', async () => {
  resetFpsCooldown()
  const g = lastStats?.game
  const pid = Number(g?.pid) || lastGamePid || 0
  const name = g?.processName || ''
  if (!name && !pid) {
    const prep = await prepareFpsForOverlay()
    if (!prep.ok) return { ok: false, message: prep.message || 'Abre un juego primero' }
    return { ok: false, message: 'Derechos OK. Abre un juego con el overlay y los FPS saldrán solos.' }
  }
  return startElevatedFpsMonitor(name, pid)
})
ipcMain.handle('fps:status', () => getFpsStats())
ipcMain.handle('platform:caps', () => {
  try {
    return require('./platform.cjs').caps()
  } catch {
    return { platform: process.platform, isWindows: process.platform === 'win32', features: {} }
  }
})
ipcMain.handle('ram:optimize', async () => optimizeRam())
ipcMain.handle('ram:clearCache', async () => clearRamCache())
ipcMain.handle('disk:get', async () => getDiskInfo())
ipcMain.handle('specs:get', async () => getAdvancedSpecs())
ipcMain.handle('apps:list', async () => {
  const list = await listInstalledApps()
  const withIcons = []
  for (let i = 0; i < list.length; i += 16) {
    const chunk = list.slice(i, i + 16)
    const part = await Promise.all(
      chunk.map(async (a) => {
        let icon = ''
        const candidates = []
        const pushCand = (p) => {
          const s = String(p || '')
            .replace(/^"|"$/g, '')
            .trim()
          if (s && !candidates.includes(s)) candidates.push(s)
        }
        pushCand(a.iconPath)
        pushCand(a.packageName)
        // Buscar exe principal en carpeta de instalación si el icono del registro falla
        const loc = String(a.installLocation || '').trim()
        if (loc && fs.existsSync(loc)) {
          try {
            const nameHint = String(a.name || '')
              .replace(/[^a-z0-9]/gi, '')
              .toLowerCase()
            const files = fs.readdirSync(loc).filter((f) => /\.exe$/i.test(f))
            const scored = files
              .map((f) => {
                const base = f.replace(/\.exe$/i, '').replace(/[^a-z0-9]/gi, '').toLowerCase()
                let score = 0
                if (nameHint && base.includes(nameHint.slice(0, Math.min(6, nameHint.length)))) score += 3
                if (/uninstall|setup|update|crash|helper|cef/i.test(f)) score -= 5
                return { f, score }
              })
              .sort((x, y) => y.score - x.score)
            if (scored[0] && scored[0].score >= 0) pushCand(path.join(loc, scored[0].f))
            else if (files[0]) pushCand(path.join(loc, files[0]))
          } catch {
            /* ignore */
          }
        }
        for (const exe of candidates) {
          if (!exe || !fs.existsSync(exe) || !/\.(exe|dll|ico)$/i.test(exe)) continue
          try {
            if (iconCache.has(exe)) {
              icon = iconCache.get(exe)
              if (icon) break
              continue
            }
            const img = await Promise.race([
              app.getFileIcon(exe, { size: 'normal' }),
              new Promise((_, rej) => setTimeout(() => rej(new Error('icon-timeout')), 450)),
            ])
            icon = img && !img.isEmpty() ? img.toDataURL() : ''
            iconCache.set(exe, icon)
            if (icon) break
          } catch {
            /* ignore */
          }
        }
        return { ...a, icon }
      }),
    )
    withIcons.push(...part)
  }
  return withIcons
})
ipcMain.handle('apps:details', async (_e, appInfo) => getAppDetails(appInfo || {}))
ipcMain.handle('apps:uninstall', async (_e, appInfo, opts) =>
  uninstallApp(appInfo || {}, { removeFiles: !!(opts && opts.removeFiles) }),
)
ipcMain.handle('apps:openPath', async (_e, folder) => {
  const target = String(folder || '')
  if (!target || !fs.existsSync(target)) return { success: false, message: 'Ruta no encontrada' }
  await shell.openPath(target)
  return { success: true }
})
ipcMain.handle('net:info', async () => getNetworkInfo())
ipcMain.handle('net:speedTest', async (e) => {
  const wc = e.sender
  try {
    return await runSpeedTest((progress) => {
      try {
        if (!wc.isDestroyed()) wc.send('net:speedProgress', progress)
      } catch {
        /* ignore */
      }
    })
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'Error en speed test',
      downloadMbps: 0,
      uploadMbps: 0,
      ping: null,
      jitter: null,
    }
  }
})
ipcMain.handle('net:cancelSpeedTest', () => cancelSpeedTest())
ipcMain.handle('net:bufferbloat', async (e) => {
  const wc = e.sender
  try {
    return await measureBufferbloat((progress) => {
      try {
        if (!wc.isDestroyed()) wc.send('net:bufferbloatProgress', progress)
      } catch {
        /* ignore */
      }
    })
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Error bufferbloat', score: null }
  }
})
ipcMain.handle('history:get', () => history.getHistory())
ipcMain.handle('history:clear', () => history.clearHistory())
ipcMain.handle('history:addSpeedTest', (_e, result) => history.addSpeedTest(result || {}))
ipcMain.handle('diagnose:now', () => diagnoseNow(lastStats, history.getRecentSamples(24)))
ipcMain.handle('competitive:get', () => ({
  ...getCompetitive(),
  enabled: !!settings.competitiveMode,
}))
ipcMain.handle('competitive:set', async (_e, enabled) => {
  const res = await setCompetitive(!!enabled)
  settings = saveSettings({ competitiveMode: !!enabled })
  broadcast('settings:update', settingsForUi(settings))
  return { ...res, settings: settingsForUi(settings) }
})

ipcMain.handle('mode:set', async (_e, mode) => {
  const res = await toolbox.setPerformanceMode(mode || 'work')
  settings = saveSettings({ performanceMode: res?.mode || mode || 'work' })
  broadcast('settings:update', settingsForUi(settings))
  return { ...res, settings: settingsForUi(settings) }
})
ipcMain.handle('mode:get', () => ({ mode: settings.performanceMode || 'work' }))
ipcMain.handle('startup:list', () => toolbox.listStartupApps())
ipcMain.handle('startup:set', (_e, payload) =>
  toolbox.setStartupEnabled(payload?.name, payload?.command, payload?.location, !!payload?.enabled),
)
ipcMain.handle('clean:temps', () => toolbox.cleanTempsDeep())
ipcMain.handle('disk:optimize', (_e, payload) =>
  toolbox.optimizeVolume(payload?.letter || 'C', payload?.kind || 'trim'),
)
ipcMain.handle('net:connections', () => toolbox.getNetConnections())
ipcMain.handle('net:devices', () => toolbox.getLanDevices())
ipcMain.handle('net:throughput', () => toolbox.getNetThroughput())
ipcMain.handle('firewall:get', () => toolbox.getFirewallStatus())
ipcMain.handle('firewall:set', (_e, payload) =>
  toolbox.setFirewallProfile(payload?.name, !!payload?.enabled),
)
ipcMain.handle('drivers:list', () => toolbox.listDrivers())
ipcMain.handle('events:list', (_e, max) => toolbox.listSystemEvents(max || 40))
ipcMain.handle('bsod:list', () => toolbox.listBsodDumps())
ipcMain.handle('instability:check', () => toolbox.detectInstability())
ipcMain.handle('bench:cpu', () => toolbox.cpuBench(2500))
ipcMain.handle('bench:ram', () => toolbox.ramBench())
ipcMain.handle('bench:ssd', () => toolbox.ssdBench())
ipcMain.handle('bench:gpu', () => toolbox.gpuBenchHint())
ipcMain.handle('hw:get', () => toolbox.getHardwareControl())
ipcMain.handle('hw:startFans', () => toolbox.startLaptopFanMonitor())
ipcMain.handle('hw:powerLimit', (_e, watts) => toolbox.setNvidiaPowerLimit(watts))
ipcMain.handle('hw:openRgb', () => toolbox.launchOpenRgb())
ipcMain.handle('backup:settings', () => toolbox.backupSettings(app.getPath('userData'), loadSettings()))
ipcMain.handle('report:html', async () => {
  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
  const pick = await dialog.showOpenDialog(parent || undefined, {
    title: 'Elegir carpeta para el informe',
    defaultPath: app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory'],
  })
  if (pick.canceled || !pick.filePaths?.[0]) {
    return { ok: false, message: 'Exportación cancelada' }
  }
  const dir = pick.filePaths[0]
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch (err) {
    return { ok: false, message: `No se pudo usar la carpeta: ${err?.message || err}` }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const base = `EyedOptimizer-Report-${stamp}`
  const htmlPath = path.join(dir, `${base}.html`)

  const html = toolbox.buildReportHtml({
    stats: lastStats,
    specs: await getAdvancedSpecs().catch(() => null),
    disk: await getDiskInfo().catch(() => null),
    diagnose: diagnoseNow(lastStats, history.getRecentSamples(24)),
    history: history.getHistory(),
    net: await getNetworkInfo().catch(() => null),
  })
  fs.writeFileSync(htmlPath, html, 'utf8')

  try {
    const win = new BrowserWindow({
      show: false,
      width: 900,
      height: 1200,
      webPreferences: { sandbox: true },
    })
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    const pdf = await win.webContents.printToPDF({ printBackground: true })
    const pdfPath = path.join(dir, `${base}.pdf`)
    fs.writeFileSync(pdfPath, pdf)
    win.destroy()
    try {
      shell.showItemInFolder(pdfPath)
    } catch {
      /* ignore */
    }
    return {
      ok: true,
      htmlPath,
      pdfPath,
      dir,
      message: `Informe guardado en:\n${dir}\n\nPDF: ${path.basename(pdfPath)}\nHTML: ${path.basename(htmlPath)}`,
    }
  } catch {
    try {
      shell.showItemInFolder(htmlPath)
    } catch {
      /* ignore */
    }
    return {
      ok: true,
      htmlPath,
      pdfPath: null,
      dir,
      message: `Informe HTML guardado en:\n${htmlPath}`,
    }
  }
})

ipcMain.handle('proc:list', async () => {
  const list = await listProcesses()
  const rows = Array.isArray(list) ? list : list ? [list] : []
  const withIcons = []
  for (let i = 0; i < rows.length; i += 12) {
    const chunk = rows.slice(i, i + 12)
    const part = await Promise.all(
      chunk.map(async (p) => {
        let icon = ''
        const candidates = []
        const exe = String(p.path || '').trim()
        if (exe) candidates.push(exe)
        const name = String(p.name || '').replace(/\.exe$/i, '')
        if (name) {
          candidates.push(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', `${name}.exe`))
          candidates.push(path.join(process.env.SystemRoot || 'C:\\Windows', 'SysWOW64', `${name}.exe`))
        }
        for (const cand of candidates) {
          try {
            if (!cand || !fs.existsSync(cand)) continue
            if (iconCache.has(cand)) {
              icon = iconCache.get(cand)
              if (icon) break
              continue
            }
            const img = await Promise.race([
              app.getFileIcon(cand, { size: 'normal' }),
              new Promise((_, rej) => setTimeout(() => rej(new Error('icon-timeout')), 800)),
            ])
            icon = img && !img.isEmpty() ? img.toDataURL() : ''
            iconCache.set(cand, icon)
            if (icon) break
          } catch {
            try {
              iconCache.set(cand, '')
            } catch {
              /* */
            }
          }
        }
        return enrichProcess({
          pid: p.pid,
          name: p.name,
          cpu: p.cpu,
          memMb: p.memMb,
          path: exe,
          description: p.description,
          icon,
        })
      }),
    )
    withIcons.push(...part)
  }
  return withIcons
})
ipcMain.handle('proc:kill', async (_e, pid) => killProcess(pid))
ipcMain.handle('app:show', () => showMain())
ipcMain.handle('app:hideToTray', () => {
  hideOverlay(true)
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide()
  }
  return true
})
ipcMain.handle('app:quit', () => {
  isQuitting = true
  app.quit()
})
ipcMain.handle('update:check', () => updater.checkForUpdates())
ipcMain.handle('update:download', () => updater.downloadAndInstall())
ipcMain.handle('update:status', () => updater.getStatus())
ipcMain.handle('update:open', () => updater.openDownloadPage())
ipcMain.handle('app:openExternal', (_e, url) => {
  const allowed = [
    DISCORD_URL,
    'https://discord.gg/eN6eQdGn87',
    'https://optzr.eyedcomun.me',
  ]
  const target = String(url || DISCORD_URL)
  if (
    !allowed.includes(target) &&
    !/^https:\/\/(discord\.gg|discord\.com)\//i.test(target) &&
    !/^https:\/\/optzr\.eyedcomun\.me(\/|$)/i.test(target)
  ) {
    return false
  }
  return shell.openExternal(target)
})
ipcMain.handle('app:openDiscord', () => shell.openExternal(DISCORD_URL))
ipcMain.handle('window:minimize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize()
  return true
})
ipcMain.handle('window:maximize', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return false
  if (mainWindow.isMaximized()) mainWindow.unmaximize()
  else mainWindow.maximize()
  return mainWindow.isMaximized()
})
ipcMain.handle('window:close', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return false
  if (settings.closeToTray) mainWindow.hide()
  else {
    isQuitting = true
    app.quit()
  }
  return true
})
ipcMain.handle('window:isMaximized', () => !!(mainWindow && !mainWindow.isDestroyed() && mainWindow.isMaximized()))
