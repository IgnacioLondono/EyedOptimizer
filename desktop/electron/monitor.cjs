const { execFile } = require('node:child_process')
const si = require('systeminformation')
const { isWindows, isMac, isLinux, runCmd } = require('./platform.cjs')

const EXCLUDE = new Set([
  'eyedoptimizer',
  'electron',
  'code',
  'cursor',
  'explorer',
  'finder',
  'dock',
  'windowserver',
  'systemuiserver',
  'controlcenter',
  'spotlight',
  'gnome-shell',
  'plasmashell',
  'kwin',
  'xorg',
  'wayland',
  'systemd',
  'searchhost',
  'shellexperiencehost',
  'applicationframehost',
  'textinputhost',
  'systemsettings',
  'taskmgr',
  'dwm',
  'winlogon',
  'csrss',
  'services',
  'lsass',
  'fontdrvhost',
  'runtimebroker',
  'sihost',
  'startmenuexperiencehost',
  'widgets',
  'lockapp',
  'msedge',
  'chrome',
  'firefox',
  'brave',
  'opera',
  'discord',
  'discordptb',
  'discordcanary',
  'spotify',
  'slack',
  'teams',
  'ms-teams',
  'outlook',
  'winword',
  'excel',
  'powerpnt',
  'notion',
  'obs64',
  'obs32',
  'obs',
  'streamlabs obs',
  'vlc',
  'notepad',
  'notepad++',
  'cmd',
  'powershell',
  'windowsterminal',
  'robloxcrashhandler',
  'robloxplayerinstaller',
  'robloxstudiobeta',
  'steam',
  'steamwebhelper',
  'steamservice',
  'gameoverlayui',
  'epicgameslauncher',
  'epicwebhelper',
  'origin',
  'eadesktop',
  'battle.net',
  'agent',
  'nvidia share',
  'nvcontainer',
  'nvidia app',
  'geforcenow',
  'radeonsoftware',
  'amdow',
  'msedgewebview2',
  'widgetservice',
  'phoneexperiencehost',
  'yourphone',
  'copilot',
  'searchapp',
])

const KNOWN_GAMES = [
  'robloxplayerbeta',
  'robloxplayer',
  'roblox',
  'minecraft',
  'javaw',
  'valorant',
  'valorant-win64-shipping',
  'fortniteclient-win64-shipping',
  'cs2',
  'csgo',
  'gta5',
  'gtav',
  'rdr2',
  'eldenring',
  'cyberpunk2077',
  'overwatch',
  'r5apex',
  'rocketleague',
  'dota2',
  'osu!',
  'osu',
  'fivem',
  'left4dead2',
  'left4dead',
  'hl2',
  'portal2',
  'tf2',
  'terraria',
  'rust',
  'warframe',
  'destiny2',
  'cod',
  'modernwarfare',
  'mw',
  'league of legends',
  'leagueclientux',
  'league of legends.exe',
  'paladins',
  'smite',
  'genshinimpact',
  'starrail',
  'zenlesszonezero',
  'witcher3',
  'sekiro',
  'darksouls',
  'baldursgate3',
  'bg3',
  'hades',
  'stardewvalley',
  'phasmophobia',
  'among us',
  'fallguys',
  'deadbydaylight',
  'rainbowsix',
  'rainbowsix_vulkan',
  'battlefield',
  'fifa',
  'fc24',
  'fc25',
  'nba2k',
  'warthunder',
  'escapefromtarkov',
  'hunt',
  'ark',
  'dayz',
  'pubg',
  'tslgame',
]

const GAME_HINT =
  /roblox|minecraft|valorant|fortnite|unreal|unity|riot|gta|cyberpunk|warzone|dota|cs2|csgo|overwatch|league|elden|witcher|destiny|apex|rocket|osu|fivem|shipping|win64-shipping|left4dead|l4d|hl2|portal|tf2|terraria|rustclient|warframe|genshin|starrail|zenless|sekiro|souls|baldur|hades|stardew|phasmophobia|deadbydaylight|rainbowsix|battlefield|escapefromtarkov|pubg|tslgame|ue4|ue5|chameleon|penguin|gamepass|xbox|steam/i

/** Carpetas típicas de juegos instalados */
const GAME_PATH_HINT =
  /\\steamapps\\common\\|\\epic games\\|\\xboxgames\\|\\riot games\\|\\ubisoft\\|\\ea games\\|\\electronic arts\\|\\battle\.net\\|\\gog galaxy\\|\\gog games\\|\\rockstar games\\|\\osu!\\|\\roblox\\|\\program files\\games\\/i

/** Launchers / no-juego aunque coincidan hints */
const LAUNCHER_HINT =
  /launcher|bootstrapper|crashhandler|installer|setup|update|unins|helper|overlay|webhelper|cefsharp|electron|steamwebhelper|epicwebhelper|originwebhelperservice/i

function isGameInstallPath(p = '') {
  const s = String(p || '').toLowerCase().replace(/\//g, '\\')
  if (!s) return false
  if (LAUNCHER_HINT.test(s) && !/\\steamapps\\common\\/i.test(s)) return false
  return GAME_PATH_HINT.test(s)
}

/**
 * ¿Parece un juego? Lista + hints + ruta de instalación + patrones Unreal/Unity.
 * No usa “GPU alta” sola (evitar falsos positivos con Chrome/Discord).
 */
function isLikelyGame(name = '', title = '', exePath = '') {
  const key = String(name || '')
    .toLowerCase()
    .replace(/\.exe$/i, '')
  const titleLow = String(title || '').toLowerCase()
  const pathLow = String(exePath || '')
    .toLowerCase()
    .replace(/\//g, '\\')
  if (!key || isExcluded(key)) return false
  if (LAUNCHER_HINT.test(key) || LAUNCHER_HINT.test(titleLow)) return false
  if (LAUNCHER_HINT.test(pathLow) && !/\\steamapps\\common\\/i.test(pathLow)) return false
  if (isKnownGameName(key)) return true
  if (isGameTitle(title)) return true
  if (isGameInstallPath(exePath)) return true
  if (/shipping|win64-shipping|win64_shipping|client-win64|game\.exe|_be\.exe|_eac/i.test(key)) return true
  if (/shipping|win64-shipping|unreal/i.test(titleLow)) return true
  if (/^unityplayer$/i.test(key)) return true
  return false
}

let cachedCpuName = ''
let cachedGpuName = ''
let lastNvidia = null
let lastNvidiaAt = 0
let lastGame = { active: false }
let lastGameAt = 0
let lastFgRaw = ''
let lastFgAt = 0
let lastCores = []
let busy = false

/** Intervalos amplios: WMI/PowerShell frecuentes = tirones de mouse en todo Windows. */
const NVIDIA_CACHE_MS = 2000
const GAME_DETECT_MS = 3000
const FG_CACHE_MS = 2500
const DISK_CACHE_MS = 8000

function run(cmd, args, timeout = 1200) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout, encoding: 'utf8', maxBuffer: 1024 * 256 }, (err, stdout) => {
      if (err) return resolve('')
      resolve(String(stdout || '').trim())
    })
  })
}

async function ensureStaticNames() {
  if (!cachedCpuName) {
    try {
      const cpu = await si.cpu()
      cachedCpuName = [cpu.manufacturer, cpu.brand].filter(Boolean).join(' ') || 'CPU'
    } catch {
      cachedCpuName = 'CPU'
    }
  }
}

async function readNvidia(force = false) {
  const now = Date.now()
  if (!force && lastNvidia && now - lastNvidiaAt < NVIDIA_CACHE_MS) return lastNvidia

  const out = await run(
    'nvidia-smi',
    [
      '--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,fan.speed,clocks.gr,clocks.mem',
      '--format=csv,noheader,nounits',
    ],
    900,
  )
  if (!out) return null

  const p = out.split(/\r?\n/)[0].split(',').map((s) => s.trim())
  const num = (v) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return {
    name: p[0] || cachedGpuName || 'NVIDIA GPU',
    gpu: num(p[1]) ?? 0,
    vramUsed: num(p[2]) ?? 0,
    vramTotal: num(p[3]) ?? 0,
    temp: num(p[4]),
    power: num(p[5]),
    fan: num(p[6]),
    coreClock: num(p[7]),
    memClock: num(p[8]),
    source: 'nvidia-smi',
  }
}

/** LibreHardwareMonitor / OpenHardwareMonitor: temp + load GPU si el servicio está activo. */
async function readGpuFromLhm() {
  if (!isWindows) return null
  const script = `
$ErrorActionPreference='SilentlyContinue'
foreach ($ns in @('root/LibreHardwareMonitor','root/OpenHardwareMonitor')) {
  $sensors = @(Get-CimInstance -Namespace $ns -ClassName Sensor -EA SilentlyContinue)
  if (-not $sensors.Count) { continue }
  $gpuTemps = @($sensors | Where-Object {
    $_.SensorType -eq 'Temperature' -and ($_.Name -match 'GPU|Core' -or $_.Identifier -match 'gpu') -and
    $_.Name -notmatch 'Hot Spot|Memory|Hotspot|CPU|Core #|Package|Tctl'
  } | ForEach-Object { [double]$_.Value } | Where-Object { $_ -gt 20 -and $_ -lt 120 })
  if (-not $gpuTemps.Count) {
    $gpuTemps = @($sensors | Where-Object {
      $_.SensorType -eq 'Temperature' -and $_.Name -match 'GPU'
    } | ForEach-Object { [double]$_.Value } | Where-Object { $_ -gt 20 -and $_ -lt 120 })
  }
  $gpuLoad = @($sensors | Where-Object {
    $_.SensorType -eq 'Load' -and ($_.Name -match 'GPU Core|GPU Memory|D3D|3D' -or ($_.Name -eq 'GPU' ))
  } | ForEach-Object { [double]$_.Value } | Where-Object { $_ -ge 0 -and $_ -le 100 })
  $vramUsed = @($sensors | Where-Object {
    $_.SensorType -eq 'SmallData' -and $_.Name -match 'GPU Memory'
  } | ForEach-Object { [double]$_.Value } | Select-Object -First 1)
  $temp = if ($gpuTemps.Count) { [Math]::Round(($gpuTemps | Measure-Object -Maximum).Maximum, 0) } else { '' }
  $load = if ($gpuLoad.Count) { [Math]::Round(($gpuLoad | Measure-Object -Maximum).Maximum, 0) } else { '' }
  $vram = if ($vramUsed) { [Math]::Round([double]$vramUsed, 0) } else { '' }
  if ($temp -ne '' -or $load -ne '') {
    Write-Output ("lhm|$load|$temp|$vram")
    exit
  }
}
`
  const raw = await run('powershell', ['-NoProfile', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-Command', script], 2800)
  const line = String(raw || '').trim().split(/\r?\n/).filter(Boolean).pop() || ''
  if (!line.startsWith('lhm|')) return null
  const parts = line.split('|')
  const load = parts[1] !== '' ? Number(parts[1]) : null
  const temp = parts[2] !== '' ? Number(parts[2]) : null
  const vram = parts[3] !== '' ? Number(parts[3]) : null
  return {
    load: Number.isFinite(load) ? load : null,
    temp: Number.isFinite(temp) ? temp : null,
    vramUsed: Number.isFinite(vram) ? vram : null,
    source: 'lhm',
  }
}

/** Contadores Windows: utilización GPU Engine (AMD/Intel/NVIDIA sin smi). */
async function readGpuFromCounters() {
  if (!isWindows) return null
  const script = `
$ErrorActionPreference='SilentlyContinue'
$vals = @()
try {
  $c = Get-Counter '\\GPU Engine(*)\\Utilization Percentage' -SampleInterval 1 -MaxSamples 1 -EA SilentlyContinue
  foreach ($s in @($c.CounterSamples)) {
    if ($s.CookedValue -gt 0) { $vals += [double]$s.CookedValue }
  }
} catch {}
$load = if ($vals.Count) { [Math]::Min(100, [Math]::Round(($vals | Measure-Object -Maximum).Maximum, 0)) } else { '' }
$mem = ''
try {
  $m = Get-Counter '\\GPU Adapter Memory(*)\\Dedicated Usage' -SampleInterval 1 -MaxSamples 1 -EA SilentlyContinue
  $best = 0
  foreach ($s in @($m.CounterSamples)) {
    if ($s.CookedValue -gt $best) { $best = [double]$s.CookedValue }
  }
  if ($best -gt 0) { $mem = [Math]::Round($best / 1MB, 0) }
} catch {}
Write-Output ("ctr|$load|$mem")
`
  const raw = await run('powershell', ['-NoProfile', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-Command', script], 3500)
  const line = String(raw || '').trim().split(/\r?\n/).filter(Boolean).pop() || ''
  if (!line.startsWith('ctr|')) return null
  const parts = line.split('|')
  const load = parts[1] !== '' ? Number(parts[1]) : null
  const vram = parts[2] !== '' ? Number(parts[2]) : null
  if (!Number.isFinite(load) && !Number.isFinite(vram)) return null
  return {
    load: Number.isFinite(load) ? load : 0,
    vramUsed: Number.isFinite(vram) ? vram : null,
    source: 'perf-counter',
  }
}

async function pickGpuNameFromSi() {
  try {
    const gfx = await si.graphics()
    const controllers = Array.isArray(gfx?.controllers) ? gfx.controllers : []
    const score = (c) => {
      const n = `${c?.model || ''} ${c?.vendor || ''} ${c?.name || ''}`.toLowerCase()
      if (/virtual|microsoft basic|remote|parsec|vnc|citrix|qemu|vmware|hyper-v|displaylink/i.test(n)) return -100
      let s = 0
      if (/nvidia|geforce|rtx|gtx|quadro/i.test(n)) s += 50
      if (/amd|radeon|rx\s?\d/i.test(n)) s += 45
      if (/intel.*(arc|discrete)/i.test(n)) s += 40
      if (/intel|uhd|iris|hd graphics/i.test(n)) s += 5
      const vram = Number(c?.vram || c?.memoryTotal || 0)
      if (vram > 128) s += Math.min(20, Math.round(vram / 1024))
      return s
    }
    const best = [...controllers].sort((a, b) => score(b) - score(a))[0]
    if (!best) return { name: cachedGpuName || 'GPU', vramTotal: 0 }
    const name = best.model || best.name || cachedGpuName || 'GPU'
    const vramMb = Number(best.vram || best.memoryTotal || 0)
    // systeminformation a veces reporta VRAM en MB, a veces ya en MB incorrecto; si > 128000 asumir KB
    let vramTotal = vramMb
    if (vramTotal > 128000) vramTotal = Math.round(vramTotal / 1024)
    return { name, vramTotal: vramTotal > 0 ? vramTotal : 0, vendor: best.vendor || '' }
  } catch {
    return { name: cachedGpuName || 'GPU', vramTotal: 0 }
  }
}

/**
 * GPU multi-vendor: NVIDIA-SMI → LHM → contadores Windows → systeminformation.
 * Cache 2s (igual que antes).
 */
async function readGpu(force = false) {
  const now = Date.now()
  if (!force && lastNvidia && now - lastNvidiaAt < NVIDIA_CACHE_MS) return lastNvidia

  // 1) NVIDIA
  try {
    const nv = await readNvidia(true)
    if (nv) {
      lastNvidia = nv
      cachedGpuName = nv.name
      lastNvidiaAt = now
      return lastNvidia
    }
  } catch {
    /* fall through */
  }

  const siInfo = await pickGpuNameFromSi()
  let load = 0
  let temp = null
  let vramUsed = 0
  let source = 'si'

  // 2) LibreHardwareMonitor
  try {
    const lhm = await readGpuFromLhm()
    if (lhm) {
      if (lhm.load != null) load = lhm.load
      if (lhm.temp != null) temp = lhm.temp
      if (lhm.vramUsed != null) vramUsed = lhm.vramUsed
      source = 'lhm'
    }
  } catch {
    /* */
  }

  // 3) Contadores (utilización) si aún no hay load
  if (load <= 0 || source === 'si') {
    try {
      const ctr = await readGpuFromCounters()
      if (ctr) {
        if (ctr.load != null && ctr.load > 0) load = ctr.load
        if (ctr.vramUsed != null && vramUsed <= 0) vramUsed = ctr.vramUsed
        if (source === 'si') source = 'perf-counter'
        else if (load > 0) source = `${source}+ctr`
      }
    } catch {
      /* */
    }
  }

  lastNvidia = {
    name: siInfo.name || cachedGpuName || 'GPU',
    gpu: load,
    vramUsed,
    vramTotal: siInfo.vramTotal || 0,
    temp,
    power: null,
    fan: null,
    coreClock: null,
    memClock: null,
    source,
  }
  cachedGpuName = lastNvidia.name
  lastNvidiaAt = now
  return lastNvidia
}

let lastDiskSummary = null
let lastDiskAt = 0

async function readDiskSummary(force = false) {
  const now = Date.now()
  if (!force && lastDiskSummary && now - lastDiskAt < DISK_CACHE_MS) return lastDiskSummary
  try {
    const fsList = await si.fsSize()
    const primary =
      (fsList || []).find((v) => /^C:/i.test(v.mount) || v.mount === 'C:\\') || (fsList || [])[0]
    lastDiskSummary = primary
      ? {
          mount: primary.mount,
          percent: Math.round((primary.use || 0) * 10) / 10,
          usedGb: Math.round((primary.used / 1024 / 1024 / 1024) * 10) / 10,
          totalGb: Math.round((primary.size / 1024 / 1024 / 1024) * 10) / 10,
          freeGb: Math.round((primary.available / 1024 / 1024 / 1024) * 10) / 10,
        }
      : { mount: 'C:', percent: 0, usedGb: 0, totalGb: 0, freeGb: 0 }
    lastDiskAt = now
  } catch {
    lastDiskSummary = lastDiskSummary || { mount: 'C:', percent: 0, usedGb: 0, totalGb: 0, freeGb: 0 }
  }
  return lastDiskSummary
}

let lastCpuTemp = null
let lastCpuSpeed = 0
let lastCpuExtrasAt = 0
let lastCpuTempSource = ''
let lastCpuFallbackAt = 0
let lastSensorKickAt = 0

/** Descarta 0/-1 y lecturas imposibles (systeminformation suele devolver 0 sin sensor). */
function sanitizeCpuTemp(t) {
  const n = Number(t)
  if (!Number.isFinite(n)) return null
  if (n <= 1 || n > 125) return null
  return Math.round(n)
}

function isLiveCpuSource(source) {
  return /lenovo|gamezone|lhm|ohm|si-/i.test(String(source || ''))
}

/** Reactiva la tarea Lenovo (sin UAC) si el feed se quedó frío. */
function kickCpuSensorFeed() {
  const now = Date.now()
  if (now - lastSensorKickAt < 8000) return
  lastSensorKickAt = now
  try {
    const sensors = require('./sensor-helper.cjs')
    void sensors.ensureCpuSensorFeed?.({ allowInstall: false })
  } catch {
    /* */
  }
}

/**
 * Temp CPU en vivo: Lenovo GameZone (helper) > SI > LHM > Thermal Zone.
 * Thermal Zone en muchos Lenovo queda fija (~28°C) y no es package real.
 */
async function readCpuExtras(force = false, ctx = {}) {
  const now = Date.now()
  if (sanitizeCpuTemp(lastCpuTemp) == null) lastCpuTemp = null
  if (!force && now - lastCpuExtrasAt < 1000) {
    return { temp: lastCpuTemp, speed: lastCpuSpeed, source: lastCpuTempSource }
  }

  // 1) Feed Lenovo en tiempo real (tarea elevada, sin UAC en cada lectura)
  try {
    const sensors = require('./sensor-helper.cjs')
    const hit = sensors.readCpuSensorCache?.(5000)
    if (hit?.temp != null) {
      lastCpuTemp = hit.temp
      lastCpuTempSource = hit.source || 'lenovo-gamezone'
      lastCpuExtrasAt = now
      return { temp: lastCpuTemp, speed: lastCpuSpeed, source: lastCpuTempSource }
    }
    kickCpuSensorFeed()
  } catch {
    /* */
  }
  try {
    const toolbox = require('./toolbox.cjs')
    const oem = toolbox.readOemSensorCache?.(20000) || toolbox.readFanCache?.()
    if (oem?.cpuTemp != null) {
      const n = sanitizeCpuTemp(oem.cpuTemp)
      if (n != null) {
        lastCpuTemp = n
        lastCpuTempSource = oem.source || 'lenovo'
        lastCpuExtrasAt = now
        return { temp: lastCpuTemp, speed: lastCpuSpeed, source: lastCpuTempSource }
      }
    }
  } catch {
    /* */
  }

  try {
    const [temp, speed] = await Promise.all([si.cpuTemperature(), si.cpuCurrentSpeed()])
    let t =
      sanitizeCpuTemp(temp?.main) ??
      sanitizeCpuTemp(temp?.max) ??
      null
    let source = t != null ? (temp?.main != null ? 'si-main' : 'si-max') : ''
    if (t == null && Array.isArray(temp?.cores) && temp.cores.length) {
      const nums = temp.cores.map(sanitizeCpuTemp).filter((n) => n != null)
      if (nums.length) {
        t = Math.round(nums.reduce((a, b) => a + b, 0) / nums.length)
        source = 'si-cores'
      }
    }
    if (t == null && Array.isArray(temp?.socket) && temp.socket.length) {
      const nums = temp.socket.map(sanitizeCpuTemp).filter((n) => n != null)
      if (nums.length) {
        t = Math.max(...nums)
        source = 'si-socket'
      }
    }
    // Thermal Zone solo si no hay sensor vivo; en Lenovo suele ser chasis fijo.
    if (t == null) {
      const fb = await readCpuTempFallback()
      if (fb != null) {
        t = typeof fb === 'object' ? fb.temp : fb
        source = typeof fb === 'object' ? fb.source || 'thermal' : 'thermal'
      }
    }
    if (t != null) {
      lastCpuTemp = t
      lastCpuTempSource = source
      if (!isLiveCpuSource(source)) kickCpuSensorFeed()
    }
    lastCpuSpeed = speed?.avg ? Math.round(speed.avg * 10) / 10 : lastCpuSpeed
    lastCpuExtrasAt = now
  } catch {
    try {
      const fb = await readCpuTempFallback()
      if (fb != null) {
        lastCpuTemp = typeof fb === 'object' ? fb.temp : fb
        lastCpuTempSource = typeof fb === 'object' ? fb.source || 'thermal' : 'thermal'
      }
    } catch {
      /* keep cache */
    }
    kickCpuSensorFeed()
    lastCpuExtrasAt = now
  }
  return { temp: lastCpuTemp, speed: lastCpuSpeed, source: lastCpuTempSource }
}

/**
 * Fuentes Windows sin admin: LHM/OHM si están corriendo, MSAcpi.
 * NO usar Thermal Zone ACPI sola: en Lenovo suele quedar fija (~28°C) y no es el package.
 */
async function readCpuTempFallback() {
  if (!isWindows) return null
  if (Date.now() - lastCpuFallbackAt < 3000) {
    if (lastCpuTemp != null && isLiveCpuSource(lastCpuTempSource)) {
      return { temp: lastCpuTemp, source: lastCpuTempSource }
    }
    return null
  }
  lastCpuFallbackAt = Date.now()
  const script = `
$ErrorActionPreference='SilentlyContinue'
$vals = New-Object System.Collections.Generic.List[double]
$src = 'acpi'

# 1) LibreHardwareMonitor / OpenHardwareMonitor (si el proceso está abierto)
foreach ($ns in @('root/LibreHardwareMonitor','root/OpenHardwareMonitor')) {
  Get-CimInstance -Namespace $ns -ClassName Sensor -EA SilentlyContinue |
    Where-Object { $_.SensorType -eq 'Temperature' -and ($_.Name -match 'CPU Package|Package|Tctl|Core Max|CPU') } |
    ForEach-Object {
      $c = [double]$_.Value
      if ($c -gt 15 -and $c -lt 115) { [void]$vals.Add($c); $src = 'lhm' }
    }
}

# 2) MSAcpi (a veces da package; a veces denegado)
if ($vals.Count -eq 0) {
  Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -EA SilentlyContinue | ForEach-Object {
    $c = ([double]$_.CurrentTemperature / 10.0) - 273.15
    if ($c -gt 30 -and $c -lt 115) { [void]$vals.Add($c); $src = 'msacpi' }
  }
}

if ($vals.Count -gt 0) {
  $max = [Math]::Round(($vals | Measure-Object -Maximum).Maximum, 0)
  Write-Output ("$src|$max")
}
`
  try {
    const raw = String(await run('powershell', ['-NoProfile', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-Command', script], 4500) || '').trim()
    const m = raw.match(/^(lhm|msacpi|ohm)\|(\d+)/i)
    if (!m) return null
    const temp = sanitizeCpuTemp(m[2])
    if (temp == null) return null
    return { temp, source: m[1].toLowerCase() }
  } catch {
    return null
  }
}

let lastBattery = null
let lastBatteryAt = 0

async function readBattery(force = false) {
  const now = Date.now()
  if (!force && lastBattery && now - lastBatteryAt < 5000) return lastBattery

  try {
    const b = await si.battery()
    if (!b || !b.hasBattery) {
      lastBattery = {
        hasBattery: false,
        percent: null,
        isCharging: null,
        acConnected: null,
        timeRemaining: null,
        voltage: null,
        designWh: null,
        fullWh: null,
        currentWh: null,
        healthPercent: null,
        powerW: null,
        cycleCount: null,
        model: null,
        capacityUnit: null,
      }
      lastBatteryAt = now
      return lastBattery
    }

    const unit = String(b.capacityUnit || 'mWh').toLowerCase()
    const toWh = (v) => {
      if (v == null || !Number.isFinite(Number(v))) return null
      const n = Number(v)
      if (unit === 'wh') return Math.round(n * 10) / 10
      if (unit === 'mah' || unit === 'ah') {
        // convertir con voltaje si existe
        const volts = Number(b.voltage) || 0
        if (volts > 0) {
          const wh = unit === 'ah' ? n * volts : (n * volts) / 1000
          return Math.round(wh * 10) / 10
        }
        return null
      }
      // mWh por defecto
      return Math.round((n / 1000) * 10) / 10
    }

    const designWh = toWh(b.designedCapacity)
    const fullWh = toWh(b.maxCapacity)
    const currentWh = toWh(b.currentCapacity)
    let healthPercent = null
    if (designWh && fullWh && designWh > 0) {
      healthPercent = Math.round(Math.min(100, (fullWh / designWh) * 1000) / 10)
    } else if (b.designedCapacity && b.maxCapacity && Number(b.designedCapacity) > 0) {
      healthPercent = Math.round(Math.min(100, (Number(b.maxCapacity) / Number(b.designedCapacity)) * 1000) / 10)
    }

    // Potencia instantanea (W) via WMI BatteryStatus (mW)
    let powerW = null
    try {
      const raw = await run(
        'powershell',
        [
          '-NoProfile',
          '-NoLogo',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          "$ErrorActionPreference='SilentlyContinue'; $s=Get-CimInstance -Namespace root\\wmi -ClassName BatteryStatus -EA SilentlyContinue | Select-Object -First 1; if($s){ [pscustomobject]@{ charge=[int64]$s.ChargeRate; discharge=[int64]$s.DischargeRate; voltage=[double]$s.Voltage } | ConvertTo-Json -Compress }",
        ],
        3500,
      )
      if (raw) {
        const j = JSON.parse(String(raw).trim())
        const charge = Number(j.charge) || 0
        const discharge = Number(j.discharge) || 0
        if (charge > 0) powerW = Math.round((charge / 1000) * 10) / 10
        else if (discharge > 0) powerW = -Math.round((discharge / 1000) * 10) / 10
      }
    } catch {
      /* ignore */
    }

    lastBattery = {
      hasBattery: true,
      percent: b.percent ?? null,
      isCharging: b.isCharging ?? null,
      acConnected: b.acConnected ?? null,
      timeRemaining: b.timeRemaining ?? null,
      voltage: b.voltage != null ? Math.round(Number(b.voltage) * 1000) / 1000 : null,
      designWh,
      fullWh,
      currentWh,
      healthPercent,
      powerW,
      cycleCount: b.cycleCount ?? null,
      model: b.model || null,
      manufacturer: b.manufacturer || null,
      capacityUnit: b.capacityUnit || 'mWh',
    }
    lastBatteryAt = now
    return lastBattery
  } catch {
    lastBattery =
      lastBattery || {
        hasBattery: false,
        percent: null,
        isCharging: null,
        acConnected: null,
        timeRemaining: null,
        voltage: null,
        designWh: null,
        fullWh: null,
        currentWh: null,
        healthPercent: null,
        powerW: null,
        cycleCount: null,
        model: null,
        capacityUnit: null,
      }
    lastBatteryAt = now
    return lastBattery
  }
}

async function collectStats(opts = {}) {
  const light = !!opts.light
  await ensureStaticNames()

  // En light: CPU load + RAM + temp CPU (barato). GPU/disco solo en full.
  if (light) {
    const [cpuLoad, mem] = await Promise.all([si.currentLoad(), si.mem()])
    if (Array.isArray(cpuLoad.cpus) && cpuLoad.cpus.length && !lastCores.length) {
      lastCores = cpuLoad.cpus.map((c) => Math.round(c.load))
    }
    const cpuExtras = await readCpuExtras(false, {
      gpuTemp: lastNvidia?.temp ?? null,
      cpuLoad: Number(cpuLoad?.currentLoad) || 0,
    })
    return {
      cpu: {
        name: cachedCpuName,
        load: Math.round(cpuLoad.currentLoad * 10) / 10,
        cores: lastCores,
        speed: cpuExtras.speed || lastCpuSpeed || 0,
        temp: cpuExtras.temp,
      },
      ram: {
        usedMb: Math.round(mem.active / 1024 / 1024),
        totalMb: Math.round(mem.total / 1024 / 1024),
        percent: Math.round((mem.active / mem.total) * 1000) / 10,
      },
      battery: lastBattery || { hasBattery: false, percent: null, isCharging: null, acConnected: null, timeRemaining: null },
      disk: lastDiskSummary || { mount: 'C:', percent: 0, usedGb: 0, totalGb: 0, freeGb: 0 },
      gpu: lastNvidia
        ? {
            name: lastNvidia.name,
            load: lastNvidia.gpu,
            temp: lastNvidia.temp,
            power: lastNvidia.power,
            fan: lastNvidia.fan ?? null,
            vramUsed: lastNvidia.vramUsed,
            vramTotal: lastNvidia.vramTotal,
            coreClock: lastNvidia.coreClock ?? null,
            memClock: lastNvidia.memClock ?? null,
          }
        : {
            name: cachedGpuName || 'GPU',
            load: 0,
            temp: null,
            power: null,
            fan: null,
            vramUsed: 0,
            vramTotal: 0,
            coreClock: null,
            memClock: null,
          },
    }
  }

  const tasks = [si.currentLoad(), si.mem(), readBattery(false), readGpu(false), readDiskSummary(false)]
  const results = await Promise.all(tasks)
  const cpuLoad = results[0]
  const mem = results[1]
  const battery = results[2]
  const nvidia = results[3]
  const disk = results[4]
  const cpuExtras = await readCpuExtras(false, {
    gpuTemp: nvidia?.temp ?? null,
    cpuLoad: Number(cpuLoad?.currentLoad) || 0,
  })

  if (Array.isArray(cpuLoad.cpus) && cpuLoad.cpus.length) {
    lastCores = cpuLoad.cpus.map((c) => Math.round(c.load))
  }

  return {
    cpu: {
      name: cachedCpuName,
      load: Math.round(cpuLoad.currentLoad * 10) / 10,
      cores: lastCores,
      speed: cpuExtras.speed || 0,
      temp: cpuExtras.temp,
    },
    ram: {
      usedMb: Math.round(mem.active / 1024 / 1024),
      totalMb: Math.round(mem.total / 1024 / 1024),
      percent: Math.round((mem.active / mem.total) * 1000) / 10,
    },
    battery: battery || { hasBattery: false, percent: null, isCharging: null, acConnected: null, timeRemaining: null },
    disk: disk || { mount: 'C:', percent: 0, usedGb: 0, totalGb: 0, freeGb: 0 },
    gpu: nvidia
      ? {
          name: nvidia.name,
          load: nvidia.gpu,
          temp: nvidia.temp,
          power: nvidia.power,
          fan: nvidia.fan ?? null,
          vramUsed: nvidia.vramUsed,
          vramTotal: nvidia.vramTotal,
          coreClock: nvidia.coreClock ?? null,
          memClock: nvidia.memClock ?? null,
        }
      : {
          name: cachedGpuName || 'GPU',
          load: 0,
          temp: null,
          power: null,
          fan: null,
          vramUsed: 0,
          vramTotal: 0,
          coreClock: null,
          memClock: null,
        },
  }
}

function isExcluded(name = '') {
  const key = String(name).toLowerCase()
  return !key || EXCLUDE.has(key) || key.includes('eyedoptimizer') || key === 'electron'
}

function isKnownGameName(name = '') {
  const key = String(name).toLowerCase().replace(/\.exe$/i, '')
  if (!key || isExcluded(key)) return false
  if (LAUNCHER_HINT.test(key)) return false
  if (KNOWN_GAMES.includes(key)) return true
  if (KNOWN_GAMES.some((g) => key.includes(g) || g.includes(key))) return true
  if (/shipping|win64-shipping|client-win64/i.test(key)) return true
  return GAME_HINT.test(key)
}

function isGameTitle(title = '') {
  const t = String(title || '').toLowerCase()
  if (!t || t.length < 2) return false
  if (LAUNCHER_HINT.test(t)) return false
  return GAME_HINT.test(t)
}

async function foregroundProcess() {
  if (isWindows) {
    const now = Date.now()
    if (now - lastFgAt < FG_CACHE_MS && lastFgRaw !== undefined) return lastFgRaw
    const script = `
$ErrorActionPreference='SilentlyContinue'
if (-not ('EyedFG.Native' -as [type])) {
  Add-Type -Namespace EyedFG -Name Native -MemberDefinition @"
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
"@
}
$id = 0
[void][EyedFG.Native]::GetWindowThreadProcessId([EyedFG.Native]::GetForegroundWindow(), [ref]$id)
if ($id -gt 0) {
  $p = Get-Process -Id $id -EA SilentlyContinue
  if ($p) {
    $t = ($p.MainWindowTitle -replace '[\\|\\r\\n]',' ')
    $path = ''
    try { $path = $p.Path } catch {}
    Write-Output ($p.ProcessName + '|' + $p.Id + '|' + $t + '|' + $path)
  }
}
`
    const raw = await run('powershell', ['-NoProfile', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-Command', script], 2000)
    lastFgAt = now
    lastFgRaw = raw || ''
    return lastFgRaw
  }

  if (isMac) {
    try {
      const name = await runCmd(
        'osascript',
        [
          '-e',
          'tell application "System Events" to get name of first application process whose frontmost is true',
        ],
        3000,
      )
      const pidRaw = await runCmd(
        'osascript',
        [
          '-e',
          'tell application "System Events" to get unix id of first application process whose frontmost is true',
        ],
        3000,
      )
      const title = await runCmd(
        'osascript',
        ['-e', 'tell application "System Events" to get value of attribute "AXTitle" of window 1 of (first application process whose frontmost is true)'],
        3000,
      ).catch(() => name)
      if (name) return `${name}|${Number(pidRaw) || 0}|${(title || name).replace(/[|\r\n]/g, ' ')}`
    } catch {
      /* */
    }
    return ''
  }

  if (isLinux) {
    try {
      const pid = await runCmd('xdotool', ['getwindowfocus', 'getwindowpid'], 2500).catch(() => '')
      if (pid) {
        const name = await runCmd('ps', ['-p', pid, '-o', 'comm='], 2000).catch(() => 'unknown')
        const title = await runCmd('xdotool', ['getwindowfocus', 'getwindowname'], 2000).catch(() => name)
        return `${name.trim()}|${pid.trim()}|${(title || name).replace(/[|\r\n]/g, ' ')}`
      }
    } catch {
      /* */
    }
    return ''
  }

  return ''
}

async function processStillAlive(pid) {
  const id = Number(pid) || 0
  if (!id) return null
  try {
    process.kill(id, 0)
  } catch {
    return null
  }
  // Sin PowerShell: basta con que el PID siga vivo (evita tirones)
  if (lastGame?.pid === id && lastGame?.processName) {
    return {
      active: true,
      processName: lastGame.processName,
      pid: id,
      title: lastGame.title || lastGame.processName,
      exePath: lastGame.exePath || '',
      source: 'sticky',
    }
  }
  return { active: true, processName: lastGame?.processName || '', pid: id, title: lastGame?.title || '', source: 'sticky' }
}

/**
 * Detecta el juego en primer plano (solo foreground + sticky).
 * Sin escaneo de biblioteca ni Get-Process masivo.
 * `force` solo acorta un poco el cache — nunca salta el throttle (evita lag de mouse).
 */
async function detectForegroundGame(stats, force = false) {
  const now = Date.now()
  const minGap = force ? 1800 : GAME_DETECT_MS
  if (now - lastGameAt < minGap) return lastGame
  lastGameAt = now

  const gpuLoad = stats?.gpu?.load || 0

  // 1) Primer plano (cacheado)
  const raw = await foregroundProcess()
  if (raw) {
    const [name, pid, title, exePath] = raw.split('|')
    const key = (name || '').toLowerCase()
    if (name && !isExcluded(key) && isLikelyGame(name, title, exePath)) {
      lastGame = {
        active: true,
        processName: name,
        pid: Number(pid) || 0,
        title: title || name,
        exePath: exePath || '',
        gpuLoad,
        source: 'foreground',
      }
      return lastGame
    }
  }

  // 2) Sticky: mismo PID de juego sigue vivo (sin PowerShell)
  if (lastGame?.pid && lastGame?.active) {
    const sticky = await processStillAlive(lastGame.pid)
    if (sticky) {
      lastGame = { ...lastGame, ...sticky, active: true, gpuLoad, title: sticky.title || lastGame.title }
      return lastGame
    }
  }

  lastGame = { active: false, gpuLoad }
  return lastGame
}

async function collectSafe(opts) {
  if (busy) return null
  busy = true
  try {
    return await collectStats(opts)
  } finally {
    busy = false
  }
}

module.exports = { collectStats, collectSafe, detectForegroundGame, isKnownGameName, isLikelyGame }
