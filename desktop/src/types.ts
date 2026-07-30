export type FpsStats = {
  fps: number
  min: number
  avg: number
  max: number
  low1: number
  low01?: number
  frametime: number
  frametimeAvg?: number
  stutterPct?: number
  history: number[]
  available: boolean
  watching?: string | null
  presentMon?: boolean
  error?: string | null
  elevated?: boolean
}

export type DiskLive = {
  mount: string
  percent: number
  usedGb: number
  totalGb: number
  freeGb: number
}

export type LiveStats = {
  cpu: { name: string; load: number; cores: number[]; speed: number; temp?: number | null }
  ram: { usedMb: number; totalMb: number; percent: number }
  battery?: {
    hasBattery: boolean
    percent: number | null
    isCharging: boolean | null
    acConnected: boolean | null
    timeRemaining: number | null
    voltage?: number | null
    designWh?: number | null
    fullWh?: number | null
    currentWh?: number | null
    healthPercent?: number | null
    powerW?: number | null
    cycleCount?: number | null
    model?: string | null
    manufacturer?: string | null
    capacityUnit?: string | null
  }
  disk?: DiskLive
  gpu: {
    name: string
    load: number
    temp: number | null
    power: number | null
    fan?: number | null
    vramUsed: number
    vramTotal: number
    coreClock: number | null
    memClock: number | null
  }
  fps: FpsStats
  game: {
    active: boolean
    processName?: string
    title?: string
    pid?: number
    cover?: string | null
    coverUrl?: string | null
  }
  overlayEnabled: boolean
  closeToTray?: boolean
  ts: number
}

export type OverlayWidgets = {
  game: boolean
  gpu: boolean
  vram: boolean
  cpu: boolean
  ram: boolean
  fps: boolean
  fpsStats: boolean
  frametime: boolean
  temps: boolean
  power: boolean
}

/** Escala visual del OSD (0.75–1.75) */
export type OverlayScale = number
/** panel = bloque vertical; bar = barra tipo taskbar horizontal */
export type OverlayLayout = 'panel' | 'bar'
export type OverlayCorner = 'tl' | 'tr' | 'bl' | 'br'

export type AppSettings = {
  overlayEnabled: boolean
  gameActive: boolean
  closeToTray: boolean
  startMinimized: boolean
  competitiveMode?: boolean
  performanceMode?: string
  gameAutoOptimize?: boolean
  alertCpuTemp?: number
  alertGpuTemp?: number
  alertRam?: number
  /** 0.15–0.95: opacidad del fondo del OSD */
  overlayOpacity?: number
  overlayWidgets?: OverlayWidgets
  /** 0.75–1.75 tamaño del overlay */
  overlayScale?: OverlayScale
  /** panel vertical o barra horizontal */
  overlayLayout?: OverlayLayout
  /** esquina anclada al juego */
  overlayCorner?: OverlayCorner
  /** Discord Rich Presence (on/off). Application ID fijo interno. */
  discordPresence?: boolean
  /** Qué mostrar en Discord Presence: 'performance' | 'specs' | 'game' | 'minimal' */
  discordPresenceMode?: 'performance' | 'specs' | 'game' | 'minimal'
}

export type DiscordPresenceStatus = {
  state: 'off' | 'connecting' | 'connected' | 'error' | 'no-discord' | string
  message: string
  enabled?: boolean
}

export type HistorySample = {
  t: number
  cpu: number
  gpu: number
  ram: number
  cpuTemp: number | null
  gpuTemp: number | null
  fps: number | null
  frametime: number | null
  disk: number | null
  game: boolean
}

export type TimelineSegment = {
  bucket: 'idle' | 'browsing' | 'gaming' | 'throttle' | string
  start: number
  end: number
}

export type BadMoment = {
  id: string
  t: number
  note: string
  game?: string | null
  clip: HistorySample[]
}

export type SpeedHistoryEntry = {
  t: number
  downloadMbps: number
  uploadMbps: number
  ping: number | null
  jitter: number | null
}

export type HistoryBundle = {
  samples: HistorySample[]
  speedTests: SpeedHistoryEntry[]
  moments: BadMoment[]
  timeline: TimelineSegment[]
  sessions?: Array<{
    id: string
    processName: string
    title: string
    start: number
    end: number
    avgFps: number | null
    avgGpuTemp?: number | null
    durationMs: number
  }>
}

export type DiagnoseFinding = {
  id: string
  severity: 'ok' | 'med' | 'high' | string
  score: number
  title: string
  detail: string
}

export type DiagnoseResult = {
  ok: boolean
  primary: DiagnoseFinding
  secondary: DiagnoseFinding[]
  ts: number
}

export type BufferbloatResult = {
  ok: boolean
  idlePing?: number
  loadPing?: number
  delta?: number
  score: string | null
  label?: string
  message?: string
  ts?: number
}

export type CompetitiveState = {
  active?: boolean
  enabled?: boolean
  ok?: boolean
  notes?: string[]
  settings?: AppSettings
}

export type ProcessRow = {
  pid: number
  name: string
  cpu: number
  memMb: number
  icon?: string
  path?: string
  description?: string
}

export type DiskVolume = {
  mount: string
  label?: string
  fs?: string
  total: number
  free: number
  used: number
  percent: number
  totalLabel: string
  usedLabel: string
  freeLabel: string
}

export type DiskDrive = {
  name: string
  media: string
  bus: string
  size: number
  sizeLabel: string
  health: string
  operational: string
  lifePercent: number | null
  lifeLabel: string
  healthPercent: number | null
  healthPercentLabel: string
  temperature: number | null
  powerOnHours: number | null
  status: 'ok' | 'warning' | 'critical' | string
  statusLabel: string
  serial: string
}

export type DiskInfo = {
  volumes: DiskVolume[]
  disks: DiskDrive[]
  primary: DiskVolume | null
}

export type AdvancedSpecs = {
  device: {
    manufacturer: string
    model: string
    family: string
    hostname: string
    username: string
    board: string
    bios: string
    biosDate: string
    serial: string
  }
  os: {
    name: string
    version: string
    build: string
    arch: string
    installDate: string
    lastBoot: string
  }
  cpu: {
    name: string
    cores: number
    threads: number
    maxMhz: number
    l2: number
    l3: number
    manufacturer: string
    socket: string
  }
  ram: {
    total: number
    totalLabel: string
    used: number
    usedLabel: string
    available: number
    availableLabel: string
    percent: number
    modules: Array<{
      bank?: string
      capacity: number
      capacityLabel: string
      speed: number
      manufacturer?: string
      part?: string
    }>
  }
  gpus: Array<{ name: string; driver?: string; vram?: number; vramLabel: string; res?: string }>
  adapters: Array<{ name: string; mac?: string; speed?: number }>
  battery: { name?: string; charge?: number; status?: string } | null
}

export type InstalledApp = {
  id: string
  name: string
  version: string
  publisher: string
  installDate: string
  installLocation: string
  uninstallString: string
  quietUninstall: string
  sizeMb: number | null
  hive?: string
  source?: 'registry' | 'appx' | 'apppath' | 'shortcut' | 'folder' | string
  packageName?: string
  iconPath?: string
  icon?: string
}

export type OptimizeResult = {
  success: boolean
  processesTrimmed: number
  freedMb: number
  freeMb: number
  tempFilesRemoved?: number
  tempFreedMb?: number
  standbyPurged?: boolean
  message: string
  mode?: 'cache' | 'full'
}

export type AppDetails = InstalledApp & {
  locations: Array<{ path: string; exists: boolean; size: number; sizeLabel: string }>
  canUninstall: boolean
}

export type NetworkInfo = {
  publicIp: string | null
  isp: string | null
  org?: string | null
  city: string | null
  country: string | null
  asn: string | null
  interface: {
    name: string
    type: string
    ipv4: string
    ipv6: string
    mac: string
    speed: number | null
    dhcp: boolean | null
  } | null
  interfaces: Array<{ name: string; ipv4: string; type: string; speed: number | null }>
}

export type SpeedProgress = {
  phase: 'info' | 'ping' | 'download' | 'hold' | 'reset' | 'upload' | 'done'
  mbps?: number
  downloadMbps?: number
  uploadMbps?: number
  ping?: number | null
  jitter?: number | null
  loaded?: number
  total?: number
  pass?: number
  passes?: number
  samples?: number
  stepMs?: number
  remainingMs?: number
  info?: NetworkInfo
  done?: boolean
  ok?: boolean
  ts?: number
  message?: string
}

export type SpeedTestResult = {
  ok: boolean
  downloadMbps: number
  uploadMbps: number
  ping: number | null
  jitter: number | null
  info?: NetworkInfo
  message?: string
  ts?: number
}

export type EyedApi = {
  getStats: () => Promise<LiveStats | null>
  onStats: (cb: (data: LiveStats) => void) => () => void
  onSettings: (cb: (data: AppSettings) => void) => () => void
  getSettings: () => Promise<AppSettings>
  setSettings: (partial: Partial<AppSettings>) => Promise<AppSettings>
  getDiscordPresenceStatus: () => Promise<DiscordPresenceStatus>
  refreshDiscordPresence: () => Promise<DiscordPresenceStatus>
  setOverlayEnabled: (v: boolean) => Promise<boolean>
  setGameMode: (v: boolean) => Promise<boolean>
  getOverlayState: () => Promise<{ overlayEnabled: boolean; gameActive: boolean; closeToTray?: boolean }>
  setOverlayInteractive: (enabled: boolean) => Promise<boolean>
  setOverlayClickThrough: (passThrough: boolean) => Promise<boolean>
  openOverlayConfig: () => Promise<boolean>
  reportOverlaySize?: (w: number, h: number) => Promise<boolean>
  onOverlayOpenConfig: (cb: () => void) => () => void
  getNetworkInfo: () => Promise<NetworkInfo>
  runSpeedTest: () => Promise<SpeedTestResult>
  cancelSpeedTest: () => Promise<boolean>
  measureBufferbloat: () => Promise<BufferbloatResult>
  onSpeedProgress: (cb: (data: SpeedProgress) => void) => () => void
  onBufferbloatProgress: (cb: (data: { phase?: string; idlePing?: number; loadPing?: number }) => void) => () => void
  getHistory: () => Promise<HistoryBundle>
  clearHistory: () => Promise<HistoryBundle>
  addSpeedTestHistory: (result: SpeedTestResult) => Promise<HistoryBundle>
  onBadMoment: (cb: (data: BadMoment) => void) => () => void
  diagnoseNow: () => Promise<DiagnoseResult>
  getCompetitive: () => Promise<CompetitiveState>
  setCompetitive: (v: boolean) => Promise<CompetitiveState>
  setPerformanceMode: (mode: string) => Promise<any>
  getPerformanceMode: () => Promise<{ mode: string }>
  elevateFps: () => Promise<{ ok: boolean; message?: string }>
  getFpsStatus: () => Promise<FpsStats>
  getPlatform: () => Promise<{
    platform: string
    isWindows: boolean
    isMac: boolean
    isLinux: boolean
    arch?: string
    features?: Record<string, boolean>
  }>
  listStartup: () => Promise<any[]>
  setStartup: (payload: { name: string; command: string; location: string; enabled: boolean }) => Promise<any>
  cleanTemps: () => Promise<any>
  optimizeVolume: (letter: string, kind: string) => Promise<any>
  getNetConnections: () => Promise<any[]>
  getLanDevices: () => Promise<any[]>
  getNetThroughput: () => Promise<{ downMbps: number; upMbps: number; ts?: number }>
  getFirewall: () => Promise<{ ok?: boolean; profiles: any[] }>
  setFirewall: (name: string, enabled: boolean) => Promise<any>
  listDrivers: () => Promise<any[]>
  listEvents: (max?: number) => Promise<any[]>
  listBsod: () => Promise<any[]>
  checkInstability: () => Promise<any>
  benchCpu: () => Promise<any>
  benchRam: () => Promise<any>
  benchSsd: () => Promise<any>
  benchGpu: () => Promise<any>
  getHardwareControl: () => Promise<any>
  startLaptopFans: () => Promise<{ ok: boolean; message?: string; already?: boolean }>
  setGpuPowerLimit: (w: number) => Promise<any>
  launchOpenRgb: () => Promise<any>
  backupSettings: () => Promise<any>
  exportReport: () => Promise<any>
  optimizeRam: () => Promise<OptimizeResult>
  clearRamCache: () => Promise<OptimizeResult>
  getDiskInfo: () => Promise<DiskInfo>
  getAdvancedSpecs: () => Promise<AdvancedSpecs>
  listApps: () => Promise<InstalledApp[]>
  getAppDetails: (app: InstalledApp) => Promise<AppDetails>
  uninstallApp: (
    app: InstalledApp,
    opts?: { removeFiles?: boolean },
  ) => Promise<{ success: boolean; message: string; removed?: string[]; locations?: string[] }>
  openAppPath: (folder: string) => Promise<{ success: boolean; message?: string }>
  listProcesses: () => Promise<ProcessRow[]>
  killProcess: (pid: number) => Promise<{ success: boolean; message: string }>
  hideToTray: () => Promise<boolean>
  quitApp: () => Promise<void>
  showApp: () => Promise<void>
  openExternal: (url: string) => Promise<boolean>
  openDiscord: () => Promise<boolean>
  minimizeWindow: () => Promise<boolean>
  maximizeWindow: () => Promise<boolean>
  closeWindow: () => Promise<boolean>
  isMaximized: () => Promise<boolean>
  onWindowState: (cb: (data: { maximized: boolean }) => void) => () => void
}

declare global {
  interface Window {
    eyed?: EyedApi
  }
}

export {}
