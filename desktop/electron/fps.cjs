/**
 * Captura FPS con PresentMon (Intel) — solo Windows.
 * En macOS/Linux la captura de FPS por proceso no está disponible (sin PresentMon).
 */
const { spawn, execFile } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { app } = require('electron')
const { isWindows, killProcessTree, unsupported } = require('./platform.cjs')

let child = null
let elevatedPid = 0
let watching = null
const samples = []
let currentFps = 0
let frametimeMs = 0
let headers = null
let lastError = ''
let pollTimer = null
let csvPath = null
let csvOffset = 0
let startLock = null
const failCooldown = new Map()
let elevatedMode = false
let rightsPrepared = false

/** Referencia MangoHud: fps_sampling_period por defecto = 500 ms (overlay_params.cpp). */
const FPS_SAMPLING_MS = 500
/** Buffer de frametimes (MangoHud fps_metrics max_size ≈ 10000; 15 s a 240 fps ≈ 3600). */
const SAMPLE_RETENTION_MS = 15000
/** Ventana de AVG / 1% / 0.1% Low (sesión reciente). */
const METRICS_WINDOW_MS = 10000
/** Historial para gráfica (MangoHud frametime_data size = 200). */
const HISTORY_LEN = 200
/** Poll CSV PresentMon — no saturar disco/CPU mientras juegas. */
const CSV_POLL_MS = 300
/** Techo razonable de FPS mostrado (evita picos basura tipo 28000). */
const MAX_DISPLAY_FPS = 480

/** Reloj sintético: PresentMon CSV llega en ráfagas con el mismo Date.now(). */
let sampleClockMs = 0

function presentMonPath() {
  if (!isWindows) return null
  const candidates = [
    path.join(process.resourcesPath || '', 'tools', 'PresentMon.exe'),
    path.join(__dirname, '..', 'tools', 'PresentMon.exe'),
    path.join(__dirname, '..', 'release', 'win-unpacked', 'resources', 'tools', 'PresentMon.exe'),
  ]
  try {
    candidates.push(path.join(app.getAppPath(), 'tools', 'PresentMon.exe'))
  } catch {
    /* */
  }
  return candidates.find((p) => {
    try {
      return p && fs.existsSync(p)
    } catch {
      return false
    }
  }) || null
}

function rightsFlagPath() {
  try {
    return path.join(app.getPath('userData'), 'fps-rights.json')
  } catch {
    return path.join(os.tmpdir(), 'eyed-fps-rights.json')
  }
}

function readRightsFlag() {
  try {
    return !!JSON.parse(fs.readFileSync(rightsFlagPath(), 'utf8'))?.ok
  } catch {
    return false
  }
}

function writeRightsFlag(ok) {
  try {
    fs.mkdirSync(path.dirname(rightsFlagPath()), { recursive: true })
    fs.writeFileSync(rightsFlagPath(), JSON.stringify({ ok: !!ok, at: new Date().toISOString() }), 'utf8')
  } catch {
    /* */
  }
}

function clearSamples() {
  samples.length = 0
  currentFps = 0
  frametimeMs = 0
  headers = null
  sampleClockMs = 0
}

function clampDisplayFps(n) {
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(MAX_DISPLAY_FPS, n)
}

function pushSample(fps, ft) {
  const frameTime = Number.isFinite(ft) && ft > 0 ? ft : Number.isFinite(fps) && fps > 0 ? 1000 / fps : 0
  // Frametimes imposibles (CSV basura / ráfagas) → descartar
  if (!(frameTime >= 0.8 && frameTime <= 250)) return
  const derivedFps = 1000 / frameTime
  if (!(derivedFps > 0 && derivedFps <= 1000)) return

  const now = Date.now()
  // Avanzar reloj por frametime real: si llegan 50 líneas en 1 ms de poll, no colapsan el periodo
  if (!sampleClockMs || now - sampleClockMs > 2000) {
    sampleClockMs = now - frameTime
  }
  sampleClockMs += frameTime
  const t = Math.min(sampleClockMs, now)

  samples.push({ t, fps: derivedFps, ft: frameTime })
  while (samples.length && now - samples[0].t > SAMPLE_RETENTION_MS) samples.shift()
  // Limitar buffer absoluto (juegos a 300+ fps)
  if (samples.length > 4500) samples.splice(0, samples.length - 4500)
  currentFps = derivedFps
  frametimeMs = frameTime
  lastError = ''
}

function round1(n) {
  return Math.round(n * 10) / 10
}

/**
 * Percentil Low estilo MangoHud (fps_metrics.h):
 * ordena frametimes de peor a mejor; índice ≈ p * n - 1; FPS = 1000 / ft.
 * p=0.01 → 1% Low, p=0.001 → 0.1% Low.
 */
function mangohudLowFps(ftDescWorstFirst, p) {
  if (!ftDescWorstFirst.length || !(p > 0) || !(p < 1)) return 0
  let idx = Math.floor(p * ftDescWorstFirst.length) - 1
  if (idx < 0) idx = 0
  if (idx >= ftDescWorstFirst.length) idx = ftDescWorstFirst.length - 1
  const ft = ftDescWorstFirst[idx]
  return ft > 0 ? 1000 / ft : 0
}

/**
 * FPS del periodo = frames / suma(frametimes) — equivalente a MH frames/elapsed
 * pero estable cuando el CSV llega en ráfaga con el mismo wall-clock.
 */
function samplingPeriodFps(now) {
  const period = samples.filter((s) => now - s.t <= FPS_SAMPLING_MS && s.ft > 0)
  if (period.length >= 1) {
    const sumFt = period.reduce((a, s) => a + s.ft, 0)
    if (sumFt >= 1) return clampDisplayFps((period.length * 1000) / sumFt)
  }
  if (frametimeMs >= 0.8 && frametimeMs <= 250) return clampDisplayFps(1000 / frametimeMs)
  return clampDisplayFps(currentFps)
}

function getFpsStats() {
  const now = Date.now()
  if (!samples.length) {
    return {
      fps: 0,
      min: 0,
      avg: 0,
      max: 0,
      low1: 0,
      low01: 0,
      frametime: 0,
      frametimeAvg: 0,
      stutterPct: 0,
      history: [],
      available: false,
      watching: watching || null,
      presentMon: !!presentMonPath(),
      error: lastError || null,
      elevated: elevatedMode,
    }
  }

  const windowSamples = samples.filter((s) => now - s.t <= METRICS_WINDOW_MS && s.ft > 0)
  const metricPool = windowSamples.length >= 8 ? windowSamples : samples.filter((s) => s.ft > 0)
  const ftPool = metricPool.map((s) => s.ft)
  const ftAvg = ftPool.reduce((a, v) => a + v, 0) / Math.max(1, ftPool.length)
  // MangoHud AVG: 1000 / mean(frametime)  — no media aritmética de FPS
  const avg = ftAvg > 0 ? 1000 / ftAvg : 0
  const ftDesc = [...ftPool].sort((a, b) => b - a)
  const low1 = mangohudLowFps(ftDesc, 0.01)
  const low01 = mangohudLowFps(ftDesc, 0.001)
  // min/max FPS desde extremos de frametime (coherente con MH min/max frametime)
  const ftMin = ftDesc.length ? ftDesc[ftDesc.length - 1] : 0
  const ftMax = ftDesc.length ? ftDesc[0] : 0
  const fpsMin = ftMax > 0 ? 1000 / ftMax : 0
  const fpsMax = ftMin > 0 ? 1000 / ftMin : 0
  // Stutter: frametime > 2.5 × promedio (útil junto a métricas MH)
  const stutterCut = ftAvg * 2.5
  const stutterPct = ftPool.length
    ? Math.round((ftPool.filter((ft) => ft > stutterCut).length / ftPool.length) * 1000) / 10
    : 0
  const instant = samplingPeriodFps(now)

  return {
    fps: round1(clampDisplayFps(instant)),
    min: round1(clampDisplayFps(fpsMin)),
    avg: round1(clampDisplayFps(avg)),
    max: round1(clampDisplayFps(fpsMax)),
    low1: round1(clampDisplayFps(low1)),
    low01: round1(clampDisplayFps(low01)),
    frametime: round1(frametimeMs),
    frametimeAvg: round1(ftAvg),
    stutterPct,
    history: samples.slice(-HISTORY_LEN).map((s) => s.ft),
    available: true,
    watching: watching || null,
    presentMon: true,
    error: null,
    elevated: elevatedMode,
  }
}

function stopPoll() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

function cleanupCsv() {
  if (csvPath) {
    try {
      fs.unlinkSync(csvPath)
    } catch {
      /* */
    }
    csvPath = null
  }
  csvOffset = 0
}

function killPid(pid) {
  killProcessTree(pid)
}

function stopFpsMonitor() {
  watching = null
  elevatedMode = false
  stopPoll()
  if (child) {
    try {
      child.kill()
    } catch {
      /* */
    }
    child = null
  }
  if (elevatedPid) {
    killPid(elevatedPid)
    elevatedPid = 0
  }
  cleanupCsv()
}

function resetFpsCooldown() {
  failCooldown.clear()
}

function parseLine(line) {
  if (!line) return
  const trimmed = String(line).trim()
  if (!trimmed || trimmed.startsWith('#')) return
  const parts = trimmed.split(',').map((s) => s.trim())
  if (!headers) {
    const joined = trimmed.toLowerCase()
    if (
      joined.includes('msbetweenpresents') ||
      joined.includes('msbetweendisplaychange') ||
      joined.includes('application') ||
      joined.includes('frametime') ||
      joined.includes('process')
    ) {
      headers = parts.map((h) => h.toLowerCase())
    }
    return
  }
  const find = (...names) => headers.findIndex((h) => names.some((n) => h === n || h.includes(n)))
  const idxFt = find('msbetweenpresents', 'msbetweendisplaychange', 'cpuframetime', 'frametime')
  const idxFps = find('displayed_avg_fps', 'displayedavgfps', 'fps')
  if (idxFt >= 0 && parts[idxFt] !== undefined) {
    const ft = Number(parts[idxFt])
    if (ft > 0.2 && ft < 250) {
      pushSample(1000 / ft, ft)
      return
    }
  }
  if (idxFps >= 0 && parts[idxFps] !== undefined) {
    const fps = Number(parts[idxFps])
    if (fps > 1 && fps < 1000) pushSample(fps, 1000 / fps)
  }
}

function feedChunk(text, state) {
  state.buf += text
  const lines = state.buf.split(/\r?\n/)
  state.buf = lines.pop() || ''
  for (const line of lines) parseLine(line)
}

function pollCsvFile() {
  if (!csvPath) return
  try {
    if (!fs.existsSync(csvPath)) return
    const st = fs.statSync(csvPath)
    if (st.size <= csvOffset) return
    const fd = fs.openSync(csvPath, 'r')
    const len = st.size - csvOffset
    const buf = Buffer.alloc(len)
    fs.readSync(fd, buf, 0, len, csvOffset)
    fs.closeSync(fd)
    csvOffset = st.size
    for (const line of buf.toString('utf8').split(/\r?\n/)) {
      if (line.trim()) parseLine(line)
    }
  } catch {
    /* */
  }
}

function startCsvPoll() {
  stopPoll()
  pollTimer = setInterval(pollCsvFile, CSV_POLL_MS)
}

function buildArgs({ pid, exeWithExt, outFile, captureAll }) {
  const args = [
    '--no_console_stats',
    '--exclude_dropped',
    '--v1_metrics',
    '--session_name',
    'EyedOptimizer',
    '--stop_existing_session',
  ]
  if (outFile) args.push('--output_file', outFile)
  else args.push('--output_stdout')
  if (captureAll) {
    for (const ex of [
      'EyedOptimizer.exe',
      'electron.exe',
      'Discord.exe',
      'chrome.exe',
      'msedge.exe',
      'firefox.exe',
      'explorer.exe',
      'dwm.exe',
    ]) {
      args.push('--exclude', ex)
    }
  } else if (pid && Number(pid) > 0) {
    args.push('--process_id', String(pid))
  } else if (exeWithExt) {
    args.push('--process_name', exeWithExt)
  }
  return args
}

/** Eleva un .ps1 con UAC (sin EncodedCommand anidado, que fallaba). */
function elevateScriptFile(scriptPath, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const ps = scriptPath.replace(/'/g, "''")
    const cmd = `Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File','${ps}') -Verb RunAs -Wait -WindowStyle Hidden`
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-Command', cmd],
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const msg = String(stderr || err.message || 'UAC cancelado')
          // No filtrar el comando entero al usuario
          if (/UAC|cancel|denied|rejected|elevat/i.test(msg)) {
            reject(new Error('UAC cancelado o denegado'))
          } else {
            reject(new Error('No se pudo elevar PresentMon'))
          }
          return
        }
        resolve(String(stdout || '').trim())
      },
    )
  })
}

function spawnDirect(bin, args) {
  return new Promise((resolve) => {
    let settled = false
    let sawDenied = false
    const proc = spawn(bin, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    })

    const finish = (ok, error) => {
      if (settled) return
      settled = true
      if (ok) {
        child = proc
        resolve({ ok: true })
      } else {
        try {
          proc.kill()
        } catch {
          /* */
        }
        resolve({ ok: false, error: error || lastError || 'PresentMon falló' })
      }
    }

    const state = { buf: '' }
    proc.stdout?.on('data', (chunk) => {
      feedChunk(chunk.toString(), state)
      if (headers || samples.length) finish(true)
    })
    proc.stderr?.on('data', (c) => {
      const t = c.toString()
      if (/access denied|elevated|administrative|administrator|privilege|performance log|registro de rendimiento/i.test(t)) {
        sawDenied = true
        lastError = 'access denied'
      }
    })
    proc.on('exit', (code) => {
      if (child === proc) child = null
      if (!settled) finish(false, sawDenied ? 'access denied' : lastError || `PresentMon salió (${code ?? '?'})`)
    })
    proc.on('error', (err) => finish(false, err.message))

    setTimeout(() => {
      if (settled) return
      if (proc.exitCode == null && !proc.killed && !sawDenied) finish(true)
      else finish(false, sawDenied ? 'access denied' : lastError || 'sin respuesta')
    }, 2500)
  })
}

/**
 * Una UAC: añade al grupo de rendimiento + lanza PresentMon elevado escribiendo CSV.
 */
async function startElevatedFpsMonitor(processName, pid, opts = {}) {
  if (!isWindows) {
    lastError = unsupported('presentMonFps').message
    return { ok: false, message: lastError }
  }
  const bin = presentMonPath()
  if (!bin) return { ok: false, message: 'PresentMon no encontrado' }

  const raw = (processName || '').trim()
  const exeNoExt = raw.replace(/\.exe$/i, '')
  const exeWithExt = exeNoExt ? `${exeNoExt}.exe` : ''
  const captureAll = opts.captureAll !== false
  const key = pid ? `pid:${pid}` : `name:${exeNoExt.toLowerCase() || 'elev'}`

  stopFpsMonitor()
  clearSamples()
  watching = key
  lastError = 'Acepta el UAC una sola vez…'
  elevatedMode = true
  failCooldown.delete(key)

  csvPath = path.join(os.tmpdir(), `eyed-pm-${Date.now()}.csv`)
  const args = buildArgs({ pid, exeWithExt, outFile: csvPath, captureAll })
  const marker = path.join(os.tmpdir(), `eyed-pm-pid-${Date.now()}.txt`)
  const scriptPath = path.join(os.tmpdir(), `eyed-pm-start-${Date.now()}.ps1`)

  // Escapar para PowerShell single-quoted strings
  const q = (s) => String(s).replace(/'/g, "''")
  const argList = args.map((a) => `'${q(a)}'`).join(',')

  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
net localgroup "Performance Log Users" $user /add 2>$null | Out-Null
net localgroup "Usuarios del registro de rendimiento" $user /add 2>$null | Out-Null
$pm = '${q(bin)}'
if (Test-Path -LiteralPath $pm) {
  & $pm --terminate_existing_session --session_name EyedOptimizer 2>$null | Out-Null
}
Get-Process -Name 'PresentMon' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 400
$arg = @(${argList})
$p = Start-Process -FilePath $pm -ArgumentList $arg -WindowStyle Hidden -PassThru
if ($p -and $p.Id) {
  Set-Content -LiteralPath '${q(marker)}' -Value ([string]$p.Id) -Encoding ascii
  exit 0
}
exit 1
`
  try {
    fs.writeFileSync(scriptPath, script, 'utf8')
  } catch (e) {
    elevatedMode = false
    lastError = 'No se pudo preparar captura FPS'
    return { ok: false, message: lastError }
  }

  try {
    await elevateScriptFile(scriptPath)
  } catch (e) {
    elevatedMode = false
    lastError = e.message || 'UAC cancelado'
    try {
      fs.unlinkSync(scriptPath)
    } catch {
      /* */
    }
    return { ok: false, message: lastError }
  }

  try {
    fs.unlinkSync(scriptPath)
  } catch {
    /* */
  }

  let pidOut = 0
  // Esperar a que el script elevado escriba el marker
  for (let i = 0; i < 20; i++) {
    try {
      if (fs.existsSync(marker)) {
        pidOut = Number(String(fs.readFileSync(marker, 'utf8')).trim()) || 0
        fs.unlinkSync(marker)
        break
      }
    } catch {
      /* */
    }
    await new Promise((r) => setTimeout(r, 200))
  }

  if (!pidOut) {
    elevatedMode = false
    lastError = 'Acepta el UAC para activar FPS'
    return { ok: false, message: lastError }
  }

  elevatedPid = pidOut
  writeRightsFlag(true)
  rightsPrepared = true
  startCsvPoll()
  lastError = 'Capturando frames…'
  setTimeout(() => {
    if (!samples.length && elevatedMode) {
      lastError = 'Pon el juego en primer plano (Minecraft OpenGL puede tardar)'
    }
  }, 12000)
  return { ok: true, message: 'FPS activo' }
}

async function prepareCaptureRights({ force = false } = {}) {
  if (rightsPrepared && !force) return { ok: true, skipped: true }
  if (readRightsFlag() && !force) {
    rightsPrepared = true
    return { ok: true, cached: true }
  }
  // Los derechos se preparan junto con startElevatedFpsMonitor
  return { ok: true }
}

async function prepareFpsForOverlay() {
  resetFpsCooldown()
  lastError = 'Preparando captura FPS…'
  return prepareCaptureRights({ force: false })
}

async function startFpsMonitor(processName, pid, opts = {}) {
  if (!isWindows) {
    lastError = unsupported('presentMonFps').message
    watching = pid ? `pid:${pid}` : `name:${String(processName || '').replace(/\.exe$/i, '').toLowerCase()}`
    return
  }
  const raw = (processName || '').trim()
  if (!raw && !pid) return

  const exeNoExt = raw.replace(/\.exe$/i, '')
  const exeWithExt = exeNoExt ? `${exeNoExt}.exe` : ''
  const key = pid ? `pid:${pid}` : `name:${exeNoExt.toLowerCase()}`
  let force = !!opts.force
  let captureAll = !!opts.captureAll
  // Primera vez en el PC: una sola elevación automática (luego queda en fps-rights.json)
  const allowAutoElevate = !!opts.allowAutoElevate || (!readRightsFlag() && !rightsPrepared)

  if (!force && watching === key && (child || (elevatedMode && elevatedPid) || pollTimer || startLock)) {
    if (elevatedMode && elevatedPid) {
      try {
        process.kill(elevatedPid, 0)
      } catch {
        elevatedPid = 0
        elevatedMode = false
      }
    }
    if (child || (elevatedMode && elevatedPid) || pollTimer || startLock) return
  }

  // Si ya hay captura elevada viva, no reiniciar
  if (elevatedMode && elevatedPid && watching === key && !force) {
    try {
      process.kill(elevatedPid, 0)
      return
    } catch {
      elevatedPid = 0
      elevatedMode = false
    }
  }

  const failedAt = failCooldown.get(key) || 0
  const cd = failCooldown.get(`${key}:ms`) || 8_000
  if (!force && Date.now() - failedAt < cd) return
  if (startLock) return startLock

  startLock = (async () => {
    if (watching && watching !== key) stopFpsMonitor()
    else if (force) {
      if (child) {
        try {
          child.kill()
        } catch {
          /* */
        }
        child = null
      }
      if (elevatedPid && !elevatedMode) {
        killPid(elevatedPid)
        elevatedPid = 0
      }
    }
    clearSamples()
    watching = key
    lastError = captureAll ? 'Captura amplia FPS…' : 'Conectando PresentMon…'
    if (!elevatedMode) elevatedMode = false

    const bin = presentMonPath()
    if (!bin) {
      lastError = 'PresentMon no encontrado'
      failCooldown.set(key, Date.now())
      failCooldown.set(`${key}:ms`, 30_000)
      return
    }

    // 1) Sin admin: PID → si falla, captura amplia
    const tryDirect = async (wide) => {
      const direct = await spawnDirect(bin, buildArgs({ pid, exeWithExt, captureAll: wide }))
      if (!direct.ok || lastError === 'access denied') return false
      await new Promise((r) => setTimeout(r, 1400))
      if (samples.length) return true
      await new Promise((r) => setTimeout(r, 2200))
      return samples.length > 0
    }

    if (await tryDirect(captureAll)) {
      lastError = ''
      failCooldown.delete(key)
      return
    }
    if (!captureAll) {
      try {
        child?.kill()
      } catch {
        /* */
      }
      child = null
      headers = null
      clearSamples()
      if (await tryDirect(true)) {
        lastError = ''
        failCooldown.delete(key)
        return
      }
    }

    try {
      child?.kill()
    } catch {
      /* */
    }
    child = null

    // 2) Solo elevar: Forzar FPS, o la PRIMERA vez en el equipo (1 UAC)
    if (opts.forceElevate || (allowAutoElevate && !readRightsFlag())) {
      const elev = await startElevatedFpsMonitor(processName, pid, { captureAll: true })
      if (elev.ok) {
        failCooldown.delete(key)
        return
      }
      lastError = elev.message || 'Pulsa «Forzar FPS» y acepta el UAC una vez'
      failCooldown.set(key, Date.now())
      failCooldown.set(`${key}:ms`, 30_000)
      watching = key
      return
    }

    if (lastError === 'access denied') {
      lastError = 'Pulsa «Forzar FPS» una sola vez (UAC)'
      failCooldown.set(key, Date.now())
      failCooldown.set(`${key}:ms`, 45_000)
    } else {
      lastError = lastError || 'Sin frames — deja el juego en primer plano o pulsa Forzar FPS'
      failCooldown.set(key, Date.now())
      failCooldown.set(`${key}:ms`, 15_000)
    }
    watching = key
  })()

  try {
    await startLock
  } finally {
    startLock = null
  }
}

module.exports = {
  startFpsMonitor,
  stopFpsMonitor,
  getFpsStats,
  presentMonPath,
  startElevatedFpsMonitor,
  prepareFpsForOverlay,
  prepareCaptureRights,
  resetFpsCooldown,
}
