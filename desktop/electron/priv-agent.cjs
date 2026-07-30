/**
 * Agente privilegiado único (EyedOptimizer).
 * - 1 UAC al instalar la tarea programada
 * - Luego: LibreHardwareMonitor (CPU package real) + Lenovo fans + jobs admin SIN más UAC
 */
const { execFile } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { isWindows } = require('./platform.cjs')

const TASK_NAME = 'EyedOptimizerPrivAgent'
const AGENT_VERSION = '3-lhm-direct'
const BASE_DIR = path.join(os.tmpdir(), 'eyed-priv-agent')
const JOBS_DIR = path.join(BASE_DIR, 'jobs')
const AGENT_PS1 = path.join(BASE_DIR, 'agent.ps1')
const AGENT_VER_FILE = path.join(BASE_DIR, 'version.txt')
const ALIVE_FILE = path.join(BASE_DIR, 'alive.json')
const CPU_CACHE_FILE = path.join(os.tmpdir(), 'eyed-cpu-sensors.json')
const FAN_CACHE_FILE = path.join(os.tmpdir(), 'eyed-laptop-fans.json')

function run(cmd, args, timeout = 15000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout, encoding: 'utf8' }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: String(stdout || ''), err: String(stderr || err?.message || '') })
    })
  })
}

function ensureDirs() {
  fs.mkdirSync(JOBS_DIR, { recursive: true })
}

/** Carpeta con LibreHardwareMonitorLib.dll (dev o empaquetado). */
function getLhmDir() {
  const candidates = []
  try {
    const { app } = require('electron')
    if (app?.isPackaged && process.resourcesPath) {
      candidates.push(path.join(process.resourcesPath, 'tools', 'LibreHardwareMonitor'))
    }
  } catch {
    /* fuera de Electron */
  }
  candidates.push(path.join(__dirname, '..', 'tools', 'LibreHardwareMonitor'))
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'LibreHardwareMonitorLib.dll'))) return c
  }
  return candidates[0]
}

function writeAgentScript() {
  ensureDirs()
  const jobsEsc = JOBS_DIR.replace(/'/g, "''")
  const aliveEsc = ALIVE_FILE.replace(/'/g, "''")
  const cpuEsc = CPU_CACHE_FILE.replace(/'/g, "''")
  const fanEsc = FAN_CACHE_FILE.replace(/'/g, "''")
  const lhmEsc = getLhmDir().replace(/'/g, "''")
  const body = `
$ErrorActionPreference='SilentlyContinue'
$jobs='${jobsEsc}'
$alive='${aliveEsc}'
$cpuOut='${cpuEsc}'
$fanOut='${fanEsc}'
$lhmDir='${lhmEsc}'
$ns='root\\wmi'
$cls='LENOVO_GAMEZONE_DATA'
New-Item -ItemType Directory -Force -Path $jobs | Out-Null

$script:LhmComputer = $null
$script:LhmReady = $false

function Init-Lhm {
  if ($script:LhmReady) { return $true }
  try {
    $dll = Join-Path $lhmDir 'LibreHardwareMonitorLib.dll'
    if (-not (Test-Path -LiteralPath $dll)) { return $false }
    [void][Reflection.Assembly]::LoadFrom($dll)
    $c = New-Object LibreHardwareMonitor.Hardware.Computer
    $c.IsCpuEnabled = $true
    $c.Open()
    $script:LhmComputer = $c
    $script:LhmReady = $true
    return $true
  } catch {
    $script:LhmReady = $false
    return $false
  }
}

function Write-Alive {
  try {
    (@{ t = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() } | ConvertTo-Json -Compress) |
      Set-Content -LiteralPath $alive -Encoding UTF8
  } catch {}
}

function Write-LhmCpuTemp {
  if (-not (Init-Lhm)) { return $false }
  try {
    $best = $null
    $coreMax = $null
    $any = New-Object System.Collections.Generic.List[double]
    foreach ($hw in $script:LhmComputer.Hardware) {
      if ($hw.HardwareType.ToString() -ne 'Cpu') { continue }
      $hw.Update()
      foreach ($sh in $hw.SubHardware) { $sh.Update() }
      foreach ($s in $hw.Sensors) {
        if ($s.SensorType.ToString() -ne 'Temperature') { continue }
        if ($null -eq $s.Value) { continue }
        $v = [double]$s.Value
        if ($v -le 1 -or $v -gt 125) { continue }
        $name = [string]$s.Name
        if ($name -match 'Package|Tctl|Tdie|CPU Package') { $best = $v }
        elseif ($name -match 'Core Max|CPU Max|Average') {
          if ($null -eq $coreMax -or $v -gt $coreMax) { $coreMax = $v }
        }
        elseif ($name -notmatch 'TjMax|Distance') { [void]$any.Add($v) }
      }
    }
    $temp = $best
    if ($null -eq $temp) { $temp = $coreMax }
    if ($null -eq $temp -and $any.Count -gt 0) { $temp = ($any | Measure-Object -Maximum).Maximum }
    if ($null -eq $temp) { return $false }
    $ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    (@{ t=$ts; source='lhm'; cpuTemp=[Math]::Round($temp,0) } | ConvertTo-Json -Compress) |
      Set-Content -LiteralPath $cpuOut -Encoding UTF8
    return $true
  } catch {
    return $false
  }
}

function Write-LenovoSensors {
  try {
    $mc = New-Object System.Management.ManagementClass($ns, $cls, $null)
    $inst = $null
    foreach ($o in $mc.GetInstances()) { $inst = $o; break }
    if (-not $inst) { return }
    function Invoke-Gz([string]$m) {
      try {
        $r = $inst.InvokeMethod($m, $null, $null)
        return [int]$r['Data']
      } catch { return $null }
    }
    $cpuT = Invoke-Gz 'GetCPUTemp'
    $gpuT = Invoke-Gz 'GetGPUTemp'
    $fan1 = Invoke-Gz 'GetFan1Speed'
    $fan2 = Invoke-Gz 'GetFan2Speed'
    $count = Invoke-Gz 'GetFanCount'
    $max = Invoke-Gz 'GetFanMaxSpeed'
    $ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    # Solo escribir temp Lenovo si LHM no aportó valor fresco
    $needCpu = $true
    try {
      if (Test-Path -LiteralPath $cpuOut) {
        $j = Get-Content -LiteralPath $cpuOut -Raw | ConvertFrom-Json
        if ($j.source -eq 'lhm' -and $j.t -and (([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()) - [int64]$j.t) -lt 3000) {
          $needCpu = $false
        }
      }
    } catch {}
    if ($needCpu -and $null -ne $cpuT -and $cpuT -gt 1 -and $cpuT -lt 125) {
      (@{ t=$ts; source='lenovo-gamezone'; cpuTemp=$cpuT } | ConvertTo-Json -Compress) |
        Set-Content -LiteralPath $cpuOut -Encoding UTF8
    }
    (@{
      t=$ts; source='lenovo-gamezone'; fanCount=$count; fan1Rpm=$fan1; fan2Rpm=$fan2;
      maxRpm=$max; cpuTemp=$cpuT; gpuTemp=$gpuT
    } | ConvertTo-Json -Compress) | Set-Content -LiteralPath $fanOut -Encoding UTF8
  } catch {}
}

function Process-Jobs {
  Get-ChildItem -LiteralPath $jobs -Filter '*.req.ps1' -EA SilentlyContinue | ForEach-Object {
    $id = $_.BaseName
    $st = Join-Path $jobs ($id + '.status')
    $out = Join-Path $jobs ($id + '.out')
    try {
      $result = & { . $_.FullName } 2>&1 | Out-String
      Set-Content -LiteralPath $out -Value $result -Encoding UTF8
      Set-Content -LiteralPath $st -Value 'OK' -Encoding UTF8
    } catch {
      Set-Content -LiteralPath $out -Value ($_ | Out-String) -Encoding UTF8
      Set-Content -LiteralPath $st -Value 'FAIL' -Encoding UTF8
    }
    Remove-Item -LiteralPath $_.FullName -Force -EA SilentlyContinue
  }
}

[void](Init-Lhm)

while ($true) {
  Write-Alive
  [void](Write-LhmCpuTemp)
  Write-LenovoSensors
  Process-Jobs
  Start-Sleep -Milliseconds 800
}
`
  fs.writeFileSync(AGENT_PS1, body, 'utf8')
  try {
    fs.writeFileSync(AGENT_VER_FILE, AGENT_VERSION, 'utf8')
  } catch {
    /* */
  }
  return AGENT_PS1
}

function needsAgentRestart() {
  try {
    if (!fs.existsSync(AGENT_VER_FILE)) return true
    return fs.readFileSync(AGENT_VER_FILE, 'utf8').trim() !== AGENT_VERSION
  } catch {
    return true
  }
}

async function restartAgentTask() {
  await run('schtasks', ['/End', '/TN', TASK_NAME])
  await new Promise((r) => setTimeout(r, 400))
  return runTask()
}

function isAgentAlive(maxAgeMs = 8000) {
  try {
    if (!fs.existsSync(ALIVE_FILE)) return false
    const d = JSON.parse(fs.readFileSync(ALIVE_FILE, 'utf8').replace(/^\uFEFF/, ''))
    return !!(d?.t && Date.now() - Number(d.t) < maxAgeMs)
  } catch {
    return false
  }
}

async function isTaskInstalled() {
  if (!isWindows) return false
  const r = await run('schtasks', ['/Query', '/TN', TASK_NAME])
  return r.ok || /PrivAgent|EyedOptimizer/i.test(r.out)
}

async function runTask() {
  return run('schtasks', ['/Run', '/TN', TASK_NAME])
}

function readCpuSensorCache(maxAgeMs = 15000) {
  try {
    if (!fs.existsSync(CPU_CACHE_FILE)) return null
    const d = JSON.parse(fs.readFileSync(CPU_CACHE_FILE, 'utf8').replace(/^\uFEFF/, ''))
    if (!d || !d.t || Date.now() - d.t > maxAgeMs) return null
    const temp = Number(d.cpuTemp)
    if (!Number.isFinite(temp) || temp <= 1 || temp > 125) return null
    return { temp: Math.round(temp), source: d.source || 'lhm', t: d.t }
  } catch {
    return null
  }
}

/**
 * Ejecuta un script PS vía el agente (sin UAC). null si el agente no está listo.
 */
async function runJob(scriptBody, timeoutMs = 120000) {
  if (!isWindows) return null
  if (!(await isTaskInstalled()) && !isAgentAlive()) return null
  if (!isAgentAlive()) {
    await runTask()
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 300))
      if (isAgentAlive()) break
    }
    if (!isAgentAlive()) return null
  }

  ensureDirs()
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const req = path.join(JOBS_DIR, `${id}.req.ps1`)
  const statusFile = path.join(JOBS_DIR, `${id}.status`)
  const outFile = path.join(JOBS_DIR, `${id}.out`)
  fs.writeFileSync(req, String(scriptBody || ''), 'utf8')

  const deadline = Date.now() + Math.max(5000, timeoutMs)
  while (Date.now() < deadline) {
    if (fs.existsSync(statusFile)) {
      const status = fs.readFileSync(statusFile, 'utf8').trim()
      const output = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8').trim() : ''
      try {
        fs.unlinkSync(statusFile)
      } catch {
        /* */
      }
      try {
        fs.unlinkSync(outFile)
      } catch {
        /* */
      }
      if (status !== 'OK') {
        return { ok: false, output, message: output.slice(0, 220) || 'Comando elevado falló', via: 'agent' }
      }
      return { ok: true, output, message: output.slice(0, 300) || 'OK', via: 'agent' }
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  try {
    fs.unlinkSync(req)
  } catch {
    /* */
  }
  return { ok: false, output: '', message: 'Timeout del agente privilegiado', via: 'agent' }
}

async function installPrivAgent() {
  if (!isWindows) return { ok: false, message: 'Solo Windows' }
  writeAgentScript()
  const ps1Esc = AGENT_PS1.replace(/'/g, "''")
  const aliveEsc = ALIVE_FILE.replace(/'/g, "''")
  const tr = `powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${AGENT_PS1}"`
  const trEsc = tr.replace(/'/g, "''")

  const { runElevatedPs } = require('./elevate.cjs')
  const elev = await runElevatedPs(
    `
$ErrorActionPreference = 'Continue'
$ps1 = '${ps1Esc}'
$alive = '${aliveEsc}'
$tn = '${TASK_NAME.replace(/'/g, "''")}'
$tr = '${trEsc}'

# 1) Arrancar el agente YA (proceso elevado, sin depender de schtasks)
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -EA SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine -like "*eyed-priv-agent*agent.ps1*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue }

Start-Process -FilePath powershell.exe -WindowStyle Hidden -ArgumentList @(
  '-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File', $ps1
) | Out-Null

# 2) Tarea al iniciar sesión (persistencia)
schtasks /Delete /TN $tn /F 2>$null | Out-Null
schtasks /Create /TN $tn /TR $tr /SC ONLOGON /RL HIGHEST /F 2>&1 | Out-Null

# 3) Esperar heartbeat
$ok = $false
for ($i = 0; $i -lt 25; $i++) {
  Start-Sleep -Milliseconds 400
  if (Test-Path -LiteralPath $alive) {
    try {
      $j = Get-Content -LiteralPath $alive -Raw | ConvertFrom-Json
      if ($j.t -and ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - [int64]$j.t) -lt 10000) {
        $ok = $true
        break
      }
    } catch {}
  }
}
if ($ok) { Write-Output 'OK|ALIVE' } else { Write-Output 'FAIL|NOALIVE' }
`,
    120000,
    { forceUac: true },
  )

  if (!elev.ok) {
    return {
      ok: false,
      message: elev.message || 'UAC cancelado',
      denied: elev.reason === 'no-admin-account' || /UAC|cancel/i.test(elev.message || ''),
    }
  }

  const out = String(elev.output || '')
  if (!/OK\|ALIVE/i.test(out)) {
    // Aún puede estar arrancando LHM
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 400))
      if (isAgentAlive() || readCpuSensorCache(20000)) {
        return {
          ok: true,
          message: 'Temp CPU en tiempo real (LibreHardwareMonitor)',
          temp: readCpuSensorCache(20000)?.temp ?? null,
        }
      }
    }
    return {
      ok: false,
      message: 'El agente no arrancó. Acepta el UAC y vuelve a abrir la app.',
      denied: false,
    }
  }

  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 400))
    if (readCpuSensorCache(20000)) break
  }
  return {
    ok: true,
    message: readCpuSensorCache(20000)
      ? 'Temp CPU en tiempo real (LibreHardwareMonitor)'
      : 'Agente activo; calibrando sensor…',
    temp: readCpuSensorCache(20000)?.temp ?? null,
  }
}

let ensurePromise = null

/**
 * @param {{ allowInstall?: boolean }} opts
 */
async function ensurePrivAgent(opts = {}) {
  if (!isWindows) return { ok: false }
  writeAgentScript()
  // Si ya hay lecturas LHM/Lenovo frescas, listo
  const fresh = readCpuSensorCache(8000)
  if (isAgentAlive() && fresh) {
    return { ok: true, already: true, temp: fresh.temp }
  }
  if (await isTaskInstalled()) {
    if (!isAgentAlive()) await restartAgentTask()
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 400))
      const c = readCpuSensorCache(12000)
      if (isAgentAlive() && c) return { ok: true, temp: c.temp, already: true }
      if (isAgentAlive()) return { ok: true, pending: true }
    }
  }
  // Sin agente vivo: instalar/arrancar (1 UAC). Ignorar denied previo si force.
  if (!opts.allowInstall) return { ok: false, needInstall: true }
  if (ensurePromise) return ensurePromise
  ensurePromise = installPrivAgent().finally(() => {
    ensurePromise = null
  })
  return ensurePromise
}

async function ensureCpuSensorFeed(opts = {}) {
  return ensurePrivAgent(opts)
}

module.exports = {
  TASK_NAME,
  CPU_CACHE_FILE,
  FAN_CACHE_FILE,
  getLhmDir,
  readCpuSensorCache,
  isAgentAlive,
  isTaskInstalled,
  runTask,
  runJob,
  ensurePrivAgent,
  ensureCpuSensorFeed,
  installPrivAgent,
  installSensorHelper: installPrivAgent,
}
