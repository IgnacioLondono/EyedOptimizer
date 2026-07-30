const { execFile } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { runElevatedPs, cleanPsError } = require('./elevate.cjs')
const { isWindows, unsupported, runCmd, isMac, isLinux } = require('./platform.cjs')

function runPs(script, timeout = 45000) {
  if (!isWindows) {
    return Promise.reject(new Error('PowerShell solo disponible en Windows'))
  }
  return new Promise((resolve, reject) => {
    execFile(
      'powershell',
      ['-NoProfile', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout, maxBuffer: 1024 * 1024 * 16, encoding: 'utf8' },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(cleanPsError(stderr || err.message || '') || 'Error PowerShell'))
        resolve(String(stdout || '').trim())
      },
    )
  })
}

function safeJson(raw, fallback = []) {
  try {
    const d = JSON.parse(raw || 'null')
    if (d == null) return fallback
    return Array.isArray(fallback) ? (Array.isArray(d) ? d : [d]) : d
  } catch {
    return fallback
  }
}

/** PowerShell ConvertTo-Json convierte 1 elemento en objeto; normaliza a array. */
function asArray(v) {
  if (v == null) return []
  return Array.isArray(v) ? v : [v]
}

/* —— Performance modes —— */
const MODE_PLANS = {
  work: {
    label: 'Modo Trabajo',
    plan: /equilibrado|balanced/i,
    rgb: '9EB6D4',
    notes: ['Plan equilibrado', 'RGB suave'],
  },
  silent: {
    label: 'Modo Silencio',
    plan: /ahorro|power saver|economy|ahorro de energ/i,
    rgb: '1B2433',
    notes: ['Plan ahorro', 'RGB tenue'],
  },
  max: {
    label: 'Máximo rendimiento',
    plan: /ultimate|alto rendimiento|high performance/i,
    rgb: 'FF4D6D',
    notes: ['Plan máximo', 'RGB intenso'],
  },
}

// Compat: "game" antiguo → máximo rendimiento
function normalizeMode(mode) {
  if (mode === 'game') return 'max'
  return MODE_PLANS[mode] ? mode : 'work'
}

function findOpenRgbPath() {
  const candidates = [
    path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'OpenRGB', 'OpenRGB.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'OpenRGB', 'OpenRGB.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'OpenRGB', 'OpenRGB.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'OpenRGB', 'OpenRGB.exe'),
  ]
  return candidates.find((p) => p && fs.existsSync(p)) || null
}

function runOpenRgb(args, timeout = 14000) {
  const bin = findOpenRgbPath()
  if (!bin) return Promise.resolve({ ok: false, message: 'OpenRGB no instalado' })
  return new Promise((resolve) => {
    execFile(bin, args, { windowsHide: true, timeout }, (err, stdout, stderr) => {
      // OpenRGB a veces sale !=0 aunque pintó; si no hay stderr duro, aceptar
      const out = String(stdout || '').trim()
      const errMsg = String(stderr || err?.message || '').trim()
      if (err && /not found|unable to|failed|error/i.test(errMsg) && !out) {
        resolve({ ok: false, message: errMsg.slice(0, 160) })
        return
      }
      if (err && !out && errMsg) {
        resolve({ ok: false, message: errMsg.slice(0, 160) })
        return
      }
      resolve({ ok: true, message: out || 'RGB aplicado' })
    })
  })
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function wakeOpenRgbServer(bin) {
  try {
    const { spawn } = require('node:child_process')
    const child = spawn(bin, ['--server', '--server-port', '6742', '--startminimized'], {
      windowsHide: true,
      detached: true,
      stdio: 'ignore',
    })
    child.unref()
    await sleep(1800)
    return true
  } catch {
    return false
  }
}

async function applyRgbForMode(mode) {
  const cfg = MODE_PLANS[normalizeMode(mode)] || MODE_PLANS.work
  const bin = findOpenRgbPath()
  if (!bin) {
    return {
      ok: false,
      message:
        'RGB: instala OpenRGB (openrgb.org), cierra Aura/iCUE/Armoury y vuelve a aplicar el modo.',
    }
  }

  await wakeOpenRgbServer(bin)

  // Flags oficiales OpenRGB CLI — color hex sin #
  const attempts = [
    ['-c', cfg.rgb, '-m', 'static'],
    ['--color', cfg.rgb, '--mode', 'static'],
    ['--client', '--server-host', '127.0.0.1', '--server-port', '6742', '-c', cfg.rgb, '-m', 'static'],
    ['-c', cfg.rgb],
  ]
  for (const args of attempts) {
    const res = await runOpenRgb(args)
    if (res.ok) return { ok: true, message: `RGB → #${cfg.rgb} (${cfg.label})`, color: cfg.rgb }
  }

  let painted = 0
  for (let d = 0; d < 12; d++) {
    const res = await runOpenRgb(['-d', String(d), '-m', 'static', '-c', cfg.rgb], 8000)
    if (res.ok) painted += 1
  }
  if (painted > 0) {
    return { ok: true, message: `RGB ${painted} dispositivo(s) → #${cfg.rgb}`, color: cfg.rgb }
  }

  return {
    ok: false,
    message:
      'OpenRGB no pudo pintar LEDs (cierra Armoury/Aura/iCUE, abre OpenRGB → Settings → Enable SDK Server).',
  }
}

async function listPowerPlans() {
  const out = await runPs('powercfg /L', 12000)
  const plans = []
  for (const line of String(out).split(/\r?\n/)) {
    const g = line.match(/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/)
    if (!g) continue
    const name = (line.match(/\(([^)]+)\)/) || [])[1] || g[1]
    const active = /\*/.test(line)
    plans.push({ guid: g[1], name, active })
  }
  return plans
}

async function ensureUltimatePlan() {
  try {
    await runPs('powercfg -duplicatescheme e9a42b02-d5df-448d-aa00-03f14749eb61', 15000)
  } catch {
    /* may already exist or need admin */
  }
}

async function tunePowerScheme(mode) {
  const key = normalizeMode(mode)
  // Ajustes sobre el esquema activo (best-effort, sin admin a veces falla)
  const scripts = {
    max: `
      powercfg /change standby-timeout-ac 0
      powercfg /change monitor-timeout-ac 0
      powercfg /SETACVALUEINDEX SCHEME_CURRENT SUB_PROCESSOR PROCTHROTTLEMIN 100
      powercfg /SETACVALUEINDEX SCHEME_CURRENT SUB_PROCESSOR PROCTHROTTLEMAX 100
      powercfg /SETACTIVE SCHEME_CURRENT
    `,
    work: `
      powercfg /change standby-timeout-ac 30
      powercfg /change monitor-timeout-ac 10
      powercfg /SETACVALUEINDEX SCHEME_CURRENT SUB_PROCESSOR PROCTHROTTLEMIN 5
      powercfg /SETACVALUEINDEX SCHEME_CURRENT SUB_PROCESSOR PROCTHROTTLEMAX 100
      powercfg /SETACTIVE SCHEME_CURRENT
    `,
    silent: `
      powercfg /change standby-timeout-ac 15
      powercfg /change monitor-timeout-ac 5
      powercfg /SETACVALUEINDEX SCHEME_CURRENT SUB_PROCESSOR PROCTHROTTLEMIN 5
      powercfg /SETACVALUEINDEX SCHEME_CURRENT SUB_PROCESSOR PROCTHROTTLEMAX 70
      powercfg /SETACTIVE SCHEME_CURRENT
    `,
  }
  const body = scripts[key] || scripts.work
  try {
    await runPs(body, 15000)
    return true
  } catch {
    return false
  }
}

async function setPerformanceMode(mode) {
  const key = normalizeMode(mode)
  const cfg = MODE_PLANS[key]
  const notes = []

  if (key === 'max') await ensureUltimatePlan()

  const plans = await listPowerPlans()
  let match = plans.find((p) => cfg.plan.test(p.name))
  if (key === 'max') {
    match =
      plans.find((p) => /ultimate/i.test(p.name)) ||
      plans.find((p) => /alto rendimiento|high performance/i.test(p.name)) ||
      match
  }
  if (!match) match = plans.find((p) => p.active)

  if (match) {
    try {
      await runPs(`powercfg /S ${match.guid}`, 12000)
      notes.push(`Plan de energía: ${match.name}`)
    } catch (e) {
      notes.push(`Plan: no se pudo cambiar (${e.message || 'error'})`)
    }
  } else {
    notes.push('No se encontró plan de energía compatible')
  }

  const tuned = await tunePowerScheme(key)
  notes.push(tuned ? 'Límites CPU/standby aplicados' : 'Ajustes finos de energía omitidos')

  if (key === 'max') {
    try {
      process.setPriority?.('high')
      notes.push('Prioridad Eyed: alta')
    } catch {
      /* ignore */
    }
  } else {
    try {
      process.setPriority?.('normal')
    } catch {
      /* ignore */
    }
  }

  try {
    const toastVal = key === 'max' ? 0 : 1
    await runPs(`
      New-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings' -Name 'NOC_GLOBAL_SETTING_TOASTS_ENABLED' -Value ${toastVal} -PropertyType DWord -Force -EA SilentlyContinue | Out-Null
    `)
    notes.push(toastVal === 0 ? 'Notificaciones silenciadas' : 'Notificaciones restauradas')
  } catch {
    /* ignore */
  }

  const rgb = await applyRgbForMode(key)
  notes.push(rgb.message)

  return {
    ok: true,
    mode: key,
    label: cfg.label,
    notes,
    plans,
    rgb: rgb.ok ? rgb.color : null,
    rgbOk: !!rgb.ok,
  }
}

/* —— Startup —— */
async function listStartupApps() {
  const script = `
$ErrorActionPreference='SilentlyContinue'
$items = New-Object System.Collections.Generic.List[object]
$seen = @{}

function Add-Item($name, $command, $location, $source, $kind) {
  $key = ("{0}|{1}|{2}" -f $source, $location, $name).ToLowerInvariant()
  if ($seen.ContainsKey($key)) { return }
  $seen[$key] = $true
  $items.Add([pscustomobject]@{
    name=[string]$name
    command=[string]$command
    location=[string]$location
    user=''
    enabled=$true
    source=$source
    kind=$kind
  })
}

$runKeys = @(
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
  'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run',
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce',
  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce'
)
foreach ($k in $runKeys) {
  if (-not (Test-Path $k)) { continue }
  Get-ItemProperty $k -EA SilentlyContinue | ForEach-Object {
    $_.PSObject.Properties | Where-Object { $_.Name -notin @('PSPath','PSParentPath','PSChildName','PSDrive','PSProvider') } | ForEach-Object {
      Add-Item $_.Name ([string]$_.Value) $k 'run' 'registry'
    }
  }
}

$startupDirs = @(
  [Environment]::GetFolderPath('Startup'),
  [Environment]::GetFolderPath('CommonStartup')
) | Where-Object { $_ -and (Test-Path $_) }
foreach ($dir in $startupDirs) {
  Get-ChildItem -LiteralPath $dir -Force -EA SilentlyContinue |
    Where-Object { $_.Extension -match '\\.(lnk|url|exe|bat|cmd)$' } |
    ForEach-Object {
      Add-Item $_.BaseName $_.FullName $dir 'folder' 'shortcut'
    }
}

# WMI solo si aporta algo que no esté ya (nombre o comando)
Get-CimInstance Win32_StartupCommand -EA SilentlyContinue | ForEach-Object {
  $n = [string]$_.Name
  $c = [string]$_.Command
  $dup = $false
  foreach ($it in $items) {
    if ($it.name -eq $n) { $dup = $true; break }
    if ($c -and $it.command -and ($it.command -like ("*{0}*" -f [IO.Path]::GetFileNameWithoutExtension(($c -split '\\s+')[0].Trim('"')))) ) { $dup = $true; break }
  }
  if (-not $dup) {
    Add-Item $n $c ([string]$_.Location) 'wmi' 'other'
  }
}

$items | ConvertTo-Json -Compress -Depth 4
`
  const list = safeJson(await runPs(script, 30000), [])
  return Array.isArray(list) ? list : []
}

async function setStartupEnabled(name, command, location, enabled) {
  const n = String(name || '')
  const c = String(command || '')
  const loc = String(location || '')
  const nEsc = n.replace(/'/g, "''")
  const cEsc = c.replace(/'/g, "''")
  const locEsc = loc.replace(/'/g, "''")

  if (enabled) {
    // Re-habilitar solo tiene sentido en claves Run
    if (!/^HK(CU|LM):/i.test(loc)) {
      return { ok: false, message: 'Solo se pueden reactivar entradas de registro Run' }
    }
    const script = `
$ErrorActionPreference='Stop'
$k='${locEsc}'; $n='${nEsc}'; $c='${cEsc}'
if (-not (Test-Path $k)) { New-Item -Path $k -Force | Out-Null }
New-ItemProperty -Path $k -Name $n -Value $c -PropertyType String -Force | Out-Null
'ok'
`
    try {
      await runPs(script, 15000)
      return { ok: true, message: `«${n}» reactivado en el inicio` }
    } catch (e) {
      const elev = await runElevatedPs(script, 30000)
      if (elev.ok) return { ok: true, message: `«${n}» reactivado (admin)`, elevated: true }
      return { ok: false, message: elev.message || cleanPsError(e.message) || 'Requiere admin' }
    }
  }

  // Desactivar: Run key, carpeta Startup, o buscar por nombre
  const script = `
$ErrorActionPreference='SilentlyContinue'
$n='${nEsc}'
$c='${cEsc}'
$loc='${locEsc}'
$removed = New-Object System.Collections.Generic.List[string]

function Remove-RunName([string]$key, [string]$name) {
  if (-not (Test-Path $key)) { return $false }
  $p = Get-ItemProperty -Path $key -Name $name -EA SilentlyContinue
  if ($null -eq $p) { return $false }
  Remove-ItemProperty -Path $key -Name $name -Force -EA SilentlyContinue
  return $true
}

# 1) Clave indicada si es Run
if ($loc -match '^HK(CU|LM):') {
  if (Remove-RunName $loc $n) { [void]$removed.Add('run:' + $loc) }
}

# 2) Buscar el nombre en todas las Run
$runKeys = @(
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
  'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run',
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce',
  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce'
)
foreach ($k in $runKeys) {
  if (Remove-RunName $k $n) { [void]$removed.Add('run:' + $k) }
}

# 3) Carpeta Inicio (atajo)
$dirs = @(
  [Environment]::GetFolderPath('Startup'),
  [Environment]::GetFolderPath('CommonStartup')
) | Where-Object { $_ }
foreach ($dir in $dirs) {
  if ($loc -and (Test-Path -LiteralPath $loc) -and ($loc -eq $dir -or $c -like ($dir + '*'))) {
    if (Test-Path -LiteralPath $c) {
      Remove-Item -LiteralPath $c -Force -EA SilentlyContinue
      if (-not (Test-Path -LiteralPath $c)) { [void]$removed.Add('folder:' + $c) }
    }
  }
  Get-ChildItem -LiteralPath $dir -Force -EA SilentlyContinue | Where-Object {
    $_.BaseName -eq $n -or $_.Name -eq $n -or ($c -and $_.FullName -eq $c)
  } | ForEach-Object {
    $p = $_.FullName
    Remove-Item -LiteralPath $p -Force -EA SilentlyContinue
    if (-not (Test-Path -LiteralPath $p)) { [void]$removed.Add('folder:' + $p) }
  }
}

# 4) StartupApproved (marcar deshabilitado) si existe
$approved = @(
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run',
  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run',
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\StartupFolder'
)
$disabled = [byte[]](0x03,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00)
foreach ($k in $approved) {
  if (-not (Test-Path $k)) { continue }
  $prop = Get-ItemProperty -Path $k -Name $n -EA SilentlyContinue
  if ($null -ne $prop) {
    Set-ItemProperty -Path $k -Name $n -Value $disabled -Type Binary -Force -EA SilentlyContinue
    [void]$removed.Add('approved:' + $k)
  }
}

if ($removed.Count -gt 0) {
  Write-Output ('OK|' + ($removed -join ','))
} else {
  Write-Output 'FAIL|not-found'
}
`
  try {
    let out = await runPs(script, 20000)
    if (!/^OK\|/i.test(String(out || '')) && /HKLM/i.test(loc + c)) {
      const elev = await runElevatedPs(script, 45000)
      if (elev.ok) out = elev.output
      if (elev.ok && /^OK\|/i.test(String(out || ''))) {
        return { ok: true, message: `«${n}» quitado del inicio (admin)`, elevated: true }
      }
    }
    if (/^OK\|/i.test(String(out || ''))) {
      return { ok: true, message: `«${n}» quitado del inicio` }
    }
    // Último intento elevado genérico
    const elev = await runElevatedPs(script, 45000)
    if (elev.ok && /^OK\|/i.test(String(elev.output || ''))) {
      return { ok: true, message: `«${n}» quitado del inicio (admin)`, elevated: true }
    }
    return {
      ok: false,
      message: 'No se pudo quitar. Puede ser una tarea programada o política de Windows.',
    }
  } catch (e) {
    const elev = await runElevatedPs(script, 45000)
    if (elev.ok && /^OK\|/i.test(String(elev.output || ''))) {
      return { ok: true, message: `«${n}» quitado del inicio (admin)`, elevated: true }
    }
    return { ok: false, message: elev.message || cleanPsError(e.message) || 'No se pudo desactivar' }
  }
}

/* —— Cleanup —— */
async function cleanTempsDeep() {
  const script = `
$ErrorActionPreference='SilentlyContinue'
$removed=0; $bytes=0
$dirs = @(
  $env:TEMP, $env:TMP,
  (Join-Path $env:WINDIR 'Temp'),
  (Join-Path $env:LOCALAPPDATA 'Temp'),
  (Join-Path $env:LOCALAPPDATA 'Microsoft\\Windows\\INetCache'),
  (Join-Path $env:LOCALAPPDATA 'Microsoft\\Windows\\Explorer')
)
foreach ($dir in $dirs) {
  if (-not $dir -or -not (Test-Path -LiteralPath $dir)) { continue }
  Get-ChildItem -LiteralPath $dir -Force -Recurse -EA SilentlyContinue |
    Where-Object { -not $_.PSIsContainer } |
    Select-Object -First 800 | ForEach-Object {
      try {
        $len = $_.Length
        Remove-Item -LiteralPath $_.FullName -Force -EA Stop
        $removed++; $bytes += $len
      } catch {}
    }
}
[pscustomobject]@{ removed=$removed; freedMb=[Math]::Round($bytes/1MB,1) } | ConvertTo-Json -Compress
`
  const data = safeJson(await runPs(script, 90000), {})
  return {
    ok: true,
    removed: data.removed || 0,
    freedMb: data.freedMb || 0,
    message: `Limpieza: ${data.removed || 0} archivos (~${data.freedMb || 0} MB)`,
  }
}

/* —— Disk TRIM / Defrag —— */
async function optimizeVolume(letter, kind) {
  if (!isWindows) {
    return { ok: false, message: 'TRIM/Defrag solo disponible en Windows' }
  }
  const L = String(letter || 'C').replace(':', '').slice(0, 1).toUpperCase()
  let want = kind === 'defrag' ? 'defrag' : 'trim'

  // Defrag solo en HDD; SSD/NVMe → ReTrim automático
  if (want === 'defrag') {
    try {
      const media = await runPs(
        `
$ErrorActionPreference='SilentlyContinue'
$part = Get-Partition -DriveLetter ${L} -EA SilentlyContinue | Select-Object -First 1
$pd = if ($part) { Get-PhysicalDisk -DeviceNumber $part.DiskNumber -EA SilentlyContinue }
Write-Output ("{0}|{1}" -f [string]$pd.MediaType, [string]$pd.BusType)
`,
        12000,
      )
      const [mediaType, bus] = String(media || '').split('|')
      const mt = String(mediaType || '').trim()
      const bn = String(bus || '').trim()
      const isHdd = /^HDD$/i.test(mt)
      if (!isHdd) {
        const elev = await runElevatedOrPlainTrim(L)
        return {
          ...elev,
          letter: L,
          kind: 'ReTrim',
          message:
            elev.message ||
            `${L}: ${mt || bn || 'SSD/NVMe'} — se aplicó TRIM (defrag solo en HDD).`,
        }
      }
    } catch {
      /* si no se puede detectar, seguir con defrag pedido */
    }
  }

  const op = want === 'defrag' ? 'Defrag' : 'ReTrim'
  const switchArg = want === 'defrag' ? '-Defrag' : '-ReTrim'
  const script = `
$ErrorActionPreference='Stop'
$r = Optimize-Volume -DriveLetter ${L} ${switchArg} -Verbose 4>&1 | Out-String
Write-Output $r
`
  try {
    const out = await runPs(script, 180000)
    return {
      ok: true,
      letter: L,
      kind: op,
      message: cleanPsError(out).slice(0, 280) || `${op} completado en ${L}:`,
      elevated: false,
    }
  } catch (e) {
    const msg = e.message || ''
    if (!/admin|access|denied|permission|40001/i.test(msg)) {
      return { ok: false, letter: L, kind: op, message: cleanPsError(msg) }
    }
    const elev = await runElevatedPs(script, 240000)
    if (elev.ok) {
      return {
        ok: true,
        letter: L,
        kind: op,
        elevated: true,
        message: `${op} en ${L}: (admin) ${cleanPsError(elev.output).slice(0, 200) || 'OK'}`,
      }
    }
    return {
      ok: false,
      letter: L,
      kind: op,
      message: elev.message || 'TRIM/Defrag requiere administrador',
    }
  }
}

async function runElevatedOrPlainTrim(L) {
  const script = `
$ErrorActionPreference='Stop'
$r = Optimize-Volume -DriveLetter ${L} -ReTrim -Verbose 4>&1 | Out-String
Write-Output $r
`
  try {
    const out = await runPs(script, 180000)
    return {
      ok: true,
      elevated: false,
      message: `TRIM en ${L}: (SSD) ${cleanPsError(out).slice(0, 200) || 'OK'}`,
    }
  } catch {
    const elev = await runElevatedPs(script, 240000)
    return {
      ok: !!elev.ok,
      elevated: true,
      message: elev.ok
        ? `TRIM en ${L}: (admin/SSD) ${cleanPsError(elev.output).slice(0, 200) || 'OK'}`
        : elev.message || 'TRIM requiere administrador',
    }
  }
}

/* —— Network extras —— */
async function getNetConnections() {
  const script = `
$ErrorActionPreference='SilentlyContinue'
Get-NetTCPConnection -State Established -EA SilentlyContinue |
  Select-Object -First 80 LocalAddress,LocalPort,RemoteAddress,RemotePort,OwningProcess,State |
  ForEach-Object {
    $p = Get-Process -Id $_.OwningProcess -EA SilentlyContinue
    [pscustomobject]@{
      local="$($_.LocalAddress):$($_.LocalPort)"
      remote="$($_.RemoteAddress):$($_.RemotePort)"
      pid=$_.OwningProcess
      process=$p.ProcessName
      state=[string]$_.State
    }
  } | ConvertTo-Json -Compress
`
  return safeJson(await runPs(script, 25000), [])
}

async function getLanDevices() {
  if (!isWindows) {
    // macOS / Linux: sin arp -a parseado; vacío elegante
    try {
      if (isMac) {
        const raw = await runCmd('arp', ['-a'], 8000)
        const rows = []
        for (const line of String(raw).split('\n')) {
          const m = line.match(/\((\d+\.\d+\.\d+\.\d+)\)\s+at\s+([0-9a-f:]+)/i)
          if (m) rows.push({ ip: m[1], mac: m[2], type: 'dinamico' })
        }
        return rows.slice(0, 60)
      }
      if (isLinux) {
        const raw = await runCmd('ip', ['neigh'], 8000).catch(() => runCmd('arp', ['-n'], 8000))
        const rows = []
        for (const line of String(raw).split('\n')) {
          const m = line.match(/(\d+\.\d+\.\d+\.\d+)\s+.*?((?:[0-9a-f]{2}[:\-]){5}[0-9a-f]{2})/i)
          if (m) rows.push({ ip: m[1], mac: m[2], type: 'dinamico' })
        }
        return rows.slice(0, 60)
      }
    } catch {
      return []
    }
    return []
  }
  const script = `
$ErrorActionPreference='SilentlyContinue'
$arp = arp -a 2>$null
$rows = @()
foreach ($line in ($arp -split "\`n")) {
  if ($line -match '(\\d+\\.\\d+\\.\\d+\\.\\d+)\\s+([0-9a-fA-F\\-]{11,17})\\s+(\\S+)') {
    $raw = $Matches[3]
    $type = if ($raw -match 'stat|est') { 'estatico' } else { 'dinamico' }
    $rows += [pscustomobject]@{ ip=$Matches[1]; mac=$Matches[2]; type=$type }
  }
}
$rows | Select-Object -First 60 | ConvertTo-Json -Compress
`
  return safeJson(await runPs(script, 15000), [])
}

async function getNetThroughput() {
  if (!isWindows) {
    try {
      const si = require('systeminformation')
      const n = await si.networkStats()
      const rows = Array.isArray(n) ? n : n ? [n] : []
      let rx = 0
      let tx = 0
      for (const r of rows) {
        rx += Number(r.rx_sec) || 0
        tx += Number(r.tx_sec) || 0
      }
      return {
        downMbps: Math.round(((rx * 8) / 1e6) * 100) / 100,
        upMbps: Math.round(((tx * 8) / 1e6) * 100) / 100,
        ts: Date.now(),
      }
    } catch {
      return { downMbps: 0, upMbps: 0, ts: Date.now() }
    }
  }
  // CIM evita nombres de contadores en inglés/español que fallan según el idioma de Windows
  const script = `
$ErrorActionPreference='SilentlyContinue'
$rx = 0.0; $tx = 0.0
$nics = Get-CimInstance Win32_PerfFormattedData_Tcpip_NetworkInterface -EA SilentlyContinue |
  Where-Object { $_.Name -and $_.Name -notmatch 'isatap|Teredo|Loopback|Pseudo' }
if ($nics) {
  foreach ($n in $nics) {
    $rx += [double]$n.BytesReceivedPersec
    $tx += [double]$n.BytesSentPersec
  }
}
if ($rx -eq 0 -and $tx -eq 0) {
  $a = Get-Counter -Counter @(
    '\\Network Interface(*)\\Bytes Received/sec',
    '\\Network Interface(*)\\Bytes Sent/sec',
    '\\Interfaz de red(*)\\Bytes recibidos/s',
    '\\Interfaz de red(*)\\Bytes enviados/s'
  ) -EA SilentlyContinue
  if ($a) {
    foreach ($s in $a.CounterSamples) {
      if ($s.InstanceName -match 'isatap|Teredo|Loopback|Pseudo') { continue }
      if ($s.Path -match 'Received|recibidos') { $rx += [double]$s.CookedValue }
      if ($s.Path -match 'Sent|enviados') { $tx += [double]$s.CookedValue }
    }
  }
}
[pscustomobject]@{
  downMbps=[Math]::Round(($rx*8)/1MB,2)
  upMbps=[Math]::Round(($tx*8)/1MB,2)
  ts=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
} | ConvertTo-Json -Compress
`
  try {
    return safeJson(await runPs(script, 12000), { downMbps: 0, upMbps: 0 })
  } catch {
    return { downMbps: 0, upMbps: 0, ts: Date.now() }
  }
}

/* —— Firewall básico —— */
async function getFirewallStatus() {
  if (!isWindows) {
    return { ok: false, profiles: [], message: unsupported('winFirewall').message, unsupported: true }
  }
  const script = `
$ErrorActionPreference='SilentlyContinue'
$p = Get-NetFirewallProfile -EA SilentlyContinue | Select-Object Name,Enabled
$p | ConvertTo-Json -Compress
`
  try {
    return { ok: true, profiles: safeJson(await runPs(script, 20000), []) }
  } catch (e) {
    return { ok: false, profiles: [], message: e.message }
  }
}

async function setFirewallProfile(name, enabled) {
  const n = String(name || 'Private').replace(/[^a-zA-Z]/g, '')
  const en = enabled ? 'True' : 'False'
  const script = `Set-NetFirewallProfile -Profile ${n} -Enabled ${en}; Write-Output "OK ${n}=${en}"`
  try {
    await runPs(script, 20000)
    return { ok: true, message: `Perfil ${n}: ${enabled ? 'ON' : 'OFF'}`, elevated: false }
  } catch (e) {
    const elev = await runElevatedPs(script, 60000)
    if (elev.ok) {
      return { ok: true, message: `Perfil ${n}: ${enabled ? 'ON' : 'OFF'} (admin)`, elevated: true }
    }
    return { ok: false, message: elev.message || cleanPsError(e.message) || 'Requiere admin' }
  }
}

/* —— Drivers —— */
const DRIVER_PURPOSE = [
  { re: /display|nvidia|amd|radeon|intel.*(graphics|uhd|iris)|geforce|video/i, purpose: 'Tarjeta gráfica / pantalla', kind: 'gpu' },
  { re: /audio|realtek|sound|nvidia high definition|hdmi audio|speakers/i, purpose: 'Audio / sonido', kind: 'audio' },
  { re: /network|ethernet|wifi|wireless|wlan|bluetooth|intel.*wi-?fi|realtek.*pcIe/i, purpose: 'Red / WiFi / Bluetooth', kind: 'net' },
  { re: /storage|nvme|ahci|sata|scsi|raid|disk|ssd|hdd/i, purpose: 'Almacenamiento / discos', kind: 'storage' },
  { re: /usb|xhci|ehci|hub/i, purpose: 'Puertos USB', kind: 'usb' },
  { re: /hid|keyboard|mouse|touchpad|i2c hid|synaptics|elan/i, purpose: 'Teclado / ratón / touchpad', kind: 'input' },
  { re: /acpi|chipset|smbus|lpc|motherboard|system board|firmware/i, purpose: 'Chipset / placa base', kind: 'board' },
  { re: /battery|acpi.?bat|power|charger/i, purpose: 'Batería / energía (laptop)', kind: 'power' },
  { re: /camera|imaging|webcam|usb.?video/i, purpose: 'Cámara', kind: 'camera' },
  { re: /print|scanner/i, purpose: 'Impresora / escáner', kind: 'print' },
  { re: /monitor|generic pnp|edid/i, purpose: 'Monitor / pantalla', kind: 'display' },
  { re: /security|tpm|fingerprint|biometric|face/i, purpose: 'Seguridad / biometría', kind: 'security' },
  { re: /game|xbox|hid-compliant game/i, purpose: 'Mando / gamepad', kind: 'game' },
  { re: /bluetooth/i, purpose: 'Bluetooth', kind: 'bt' },
]

function describeDriver(name, deviceClass, manufacturer) {
  const hay = `${name || ''} ${deviceClass || ''} ${manufacturer || ''}`
  for (const row of DRIVER_PURPOSE) {
    if (row.re.test(hay)) return { purpose: row.purpose, kind: row.kind }
  }
  if (deviceClass) {
    const map = {
      DISPLAY: 'Tarjeta gráfica / pantalla',
      MEDIA: 'Audio / multimedia',
      NET: 'Adaptador de red',
      USB: 'Controlador USB',
      HIDClass: 'Dispositivo de entrada',
      SCSIAdapter: 'Almacenamiento',
      System: 'Sistema / chipset',
      Battery: 'Batería',
      Bluetooth: 'Bluetooth',
      Camera: 'Cámara',
      SoftwareDevice: 'Dispositivo virtual / software',
      Computer: 'Equipo',
      Processor: 'Procesador',
      Volume: 'Volumen de disco',
      DiskDrive: 'Disco',
    }
    if (map[deviceClass]) return { purpose: map[deviceClass], kind: deviceClass.toLowerCase() }
  }
  return { purpose: 'Controlador del sistema', kind: 'other' }
}

async function listDrivers() {
  if (!isWindows) return []
  const script = `
$ErrorActionPreference='SilentlyContinue'
Get-CimInstance Win32_PnPSignedDriver -EA SilentlyContinue |
  Where-Object { $_.DeviceName -and $_.DriverVersion } |
  Select-Object -First 200 DeviceName, DriverVersion, Manufacturer, DriverDate, IsSigned, DeviceClass, DeviceID, InfName, DriverProviderName |
  ConvertTo-Json -Compress -Depth 3
`
  try {
    const rows = asArray(safeJson(await runPs(script, 90000), []))
    return rows.map((d, i) => {
      const meta = describeDriver(d.DeviceName, d.DeviceClass, d.Manufacturer || d.DriverProviderName)
      return {
        id: `${d.DeviceID || d.DeviceName}-${i}`,
        name: d.DeviceName,
        version: d.DriverVersion,
        manufacturer: d.Manufacturer || d.DriverProviderName || '—',
        date: d.DriverDate || '',
        signed: d.IsSigned !== false && d.IsSigned !== 'False',
        deviceClass: d.DeviceClass || '',
        inf: d.InfName || '',
        purpose: meta.purpose,
        kind: meta.kind,
        DeviceName: d.DeviceName,
        DriverVersion: d.DriverVersion,
        Manufacturer: d.Manufacturer || d.DriverProviderName || '—',
      }
    })
  } catch {
    return []
  }
}

/* —— Events / BSOD —— */
async function listSystemEvents(max = 40) {
  const script = `
$ErrorActionPreference='SilentlyContinue'
Get-WinEvent -LogName System -MaxEvents ${Number(max) || 40} -EA SilentlyContinue |
  Where-Object { $_.Level -le 3 } |
  Select-Object TimeCreated, Id, LevelDisplayName, ProviderName, Message |
  ForEach-Object {
    [pscustomobject]@{
      time=$_.TimeCreated.ToString('s')
      id=$_.Id
      level=$_.LevelDisplayName
      provider=$_.ProviderName
      message=([string]$_.Message).Substring(0, [Math]::Min(220, ([string]$_.Message).Length))
    }
  } | ConvertTo-Json -Compress
`
  return safeJson(await runPs(script, 45000), [])
}

async function listBsodDumps() {
  const script = `
$ErrorActionPreference='SilentlyContinue'
$paths = @()
$dir = Join-Path $env:SystemRoot 'Minidump'
if (Test-Path $dir) {
  Get-ChildItem $dir -Filter *.dmp -EA SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 20 | ForEach-Object {
    $paths += [pscustomobject]@{ name=$_.Name; path=$_.FullName; sizeMb=[Math]::Round($_.Length/1MB,2); time=$_.LastWriteTime.ToString('s') }
  }
}
$mem = Join-Path $env:SystemRoot 'MEMORY.DMP'
if (Test-Path $mem) {
  $i = Get-Item $mem
  $paths += [pscustomobject]@{ name=$i.Name; path=$i.FullName; sizeMb=[Math]::Round($i.Length/1MB,2); time=$i.LastWriteTime.ToString('s') }
}
$paths | ConvertTo-Json -Compress
`
  const dumps = safeJson(await runPs(script, 20000), [])
  return dumps.map((d) => ({
    ...d,
    explain:
      'Un minidump guarda el estado al fallar Windows (pantallazo azul). Suele apuntar a driver, RAM inestable o overclock. Ábrelo con WinDbg para el bugcheck exacto.',
  }))
}

async function detectInstability() {
  const script = `
$ErrorActionPreference='SilentlyContinue'
$whea = @(Get-WinEvent -FilterHashtable @{LogName='System'; ProviderName='Microsoft-Windows-WHEA-Logger'; StartTime=(Get-Date).AddDays(-7)} -MaxEvents 20 -EA SilentlyContinue)
$bug = @(Get-WinEvent -FilterHashtable @{LogName='System'; Id=1001; StartTime=(Get-Date).AddDays(-30)} -MaxEvents 10 -EA SilentlyContinue)
[pscustomobject]@{
  whea=$whea.Count
  bugcheck=$bug.Count
  recent=($whea + $bug | Select-Object -First 8 | ForEach-Object {
    [pscustomobject]@{ time=$_.TimeCreated.ToString('s'); id=$_.Id; message=([string]$_.Message).Substring(0,[Math]::Min(160,([string]$_.Message).Length)) }
  })
} | ConvertTo-Json -Compress -Depth 4
`
  try {
    const d = safeJson(await runPs(script, 40000), {})
    const score = (d.whea || 0) * 2 + (d.bugcheck || 0) * 5
    return {
      ok: true,
      whea: d.whea || 0,
      bugcheck: d.bugcheck || 0,
      recent: asArray(d.recent),
      status: score === 0 ? 'stable' : score < 6 ? 'warn' : 'unstable',
      message:
        score === 0
          ? 'Sin señales claras de inestabilidad en logs recientes'
          : `WHEA ${d.whea || 0} · Bugchecks ${d.bugcheck || 0} (últimos días)`,
    }
  } catch (e) {
    return { ok: false, status: 'unknown', message: e.message, whea: 0, bugcheck: 0, recent: [] }
  }
}

/* —— Benchmarks (seguros, sin OC) —— */
function cpuBench(ms = 2500) {
  const end = Date.now() + ms
  let ops = 0
  let x = 1.0001
  while (Date.now() < end) {
    for (let i = 0; i < 5000; i++) {
      x = Math.sin(x) * Math.cos(x) + Math.sqrt(Math.abs(x)) + 1.0000001
      ops++
    }
  }
  const score = Math.round(ops / (ms / 1000) / 1000)
  return { ok: true, kind: 'cpu', score, unit: 'kops/s', durationMs: ms, detail: `Score CPU relativo: ${score}` }
}

function ramBench() {
  const size = 64 * 1024 * 1024
  const buf = Buffer.allocUnsafe(size)
  const t0 = Date.now()
  for (let i = 0; i < size; i += 4096) buf[i] = i & 255
  let checksum = 0
  for (let i = 0; i < size; i += 4096) checksum = (checksum + buf[i]) & 0xffff
  const ms = Math.max(1, Date.now() - t0)
  const mbps = Math.round((size / (1024 * 1024) / (ms / 1000)) * 10) / 10
  return { ok: true, kind: 'ram', score: mbps, unit: 'MB/s fill', durationMs: ms, detail: `Escritura buffer ${mbps} MB/s (checksum ${checksum})` }
}

async function ssdBench() {
  const file = path.join(os.tmpdir(), `eyed-bench-${Date.now()}.bin`)
  const chunk = Buffer.alloc(1024 * 1024, 7)
  const passes = 128
  const t0 = Date.now()
  const fd = fs.openSync(file, 'w')
  try {
    for (let i = 0; i < passes; i++) fs.writeSync(fd, chunk)
  } finally {
    fs.closeSync(fd)
  }
  const writeMs = Math.max(1, Date.now() - t0)
  const t1 = Date.now()
  const data = fs.readFileSync(file)
  const readMs = Math.max(1, Date.now() - t1)
  try {
    fs.unlinkSync(file)
  } catch {
    /* ignore */
  }
  const mb = passes
  return {
    ok: true,
    kind: 'ssd',
    score: Math.round((mb / (writeMs / 1000)) * 10) / 10,
    readMbps: Math.round((data.length / (1024 * 1024) / (readMs / 1000)) * 10) / 10,
    unit: 'MB/s write',
    durationMs: writeMs + readMs,
    detail: `Write ~${Math.round(mb / (writeMs / 1000))} MB/s · Read ~${Math.round(data.length / (1024 * 1024) / (readMs / 1000))} MB/s (temp file)`,
  }
}

async function gpuBenchHint() {
  // Snapshot real de sensores GPU (nvidia-smi o contadores Windows) durante ~3s
  try {
    const samples = []
    for (let i = 0; i < 4; i++) {
      const out = await new Promise((resolve) => {
        execFile(
          'nvidia-smi',
          [
            '--query-gpu=utilization.gpu,temperature.gpu,power.draw,clocks.current.graphics,name',
            '--format=csv,noheader,nounits',
          ],
          { windowsHide: true, timeout: 6000 },
          (err, stdout) => resolve(err ? '' : String(stdout || '').trim()),
        )
      })
      if (out) {
        const p = out.split(',').map((s) => s.trim())
        samples.push({
          util: Number(p[0]) || 0,
          temp: Number(p[1]) || null,
          power: Number(p[2]) || null,
          clock: Number(p[3]) || null,
          name: p[4] || 'NVIDIA',
        })
      }
      await sleep(700)
    }
    if (samples.length) {
      const maxUtil = Math.max(...samples.map((s) => s.util))
      const avgUtil = Math.round(samples.reduce((a, s) => a + s.util, 0) / samples.length)
      const last = samples[samples.length - 1]
      const score = Math.round(maxUtil * 0.55 + (last.clock ? Math.min(100, last.clock / 25) : 0) * 0.45)
      return {
        ok: true,
        kind: 'gpu',
        score,
        unit: 'índice sensores',
        durationMs: samples.length * 700,
        detail: `${last.name}: uso max ${maxUtil}% · media ${avgUtil}% · ${last.temp ?? '—'}°C · ${last.clock ?? '—'} MHz · ${last.power ?? '—'} W`,
      }
    }
  } catch {
    /* fallback abajo */
  }

  try {
    const script = `
$ErrorActionPreference='SilentlyContinue'
$vals = @()
1..3 | ForEach-Object {
  $c = Get-Counter '\\GPU Engine(*)\\Utilization Percentage' -EA SilentlyContinue
  if ($c) {
    $m = ($c.CounterSamples | Measure-Object CookedValue -Maximum).Maximum
    if ($null -ne $m) { $vals += [double]$m }
  }
  Start-Sleep -Milliseconds 600
}
if ($vals.Count) {
  [pscustomobject]@{ max=[Math]::Round(($vals | Measure-Object -Maximum).Maximum,1); avg=[Math]::Round(($vals | Measure-Object -Average).Average,1) } | ConvertTo-Json -Compress
}
`
    const raw = await runPs(script, 20000)
    const d = safeJson(raw, null)
    if (d && d.max != null) {
      return {
        ok: true,
        kind: 'gpu',
        score: Math.round(Number(d.max) || 0),
        unit: '% GPU Engine',
        detail: `Contadores Windows: pico ${d.max}% · media ${d.avg}% (sin carga sintética)`,
      }
    }
  } catch {
    /* ignore */
  }

  return {
    ok: false,
    kind: 'gpu',
    score: null,
    unit: '',
    detail: 'No se pudo leer GPU (instala drivers NVIDIA o usa Contadores de rendimiento).',
  }
}

/* —— Hardware control (lectura + potencia NVIDIA; fans solo lectura) —— */
const FAN_CACHE_FILE = path.join(os.tmpdir(), 'eyed-laptop-fans.json')
let fanWatchPid = null

function readFanCache() {
  try {
    if (!fs.existsSync(FAN_CACHE_FILE)) return null
    const raw = fs.readFileSync(FAN_CACHE_FILE, 'utf8').replace(/^\uFEFF/, '')
    const d = JSON.parse(raw)
    // 90s: el watcher escribe cada 2s; margen si el proceso se retrasa
    if (!d || !d.t || Date.now() - d.t > 90000) return null
    return d
  } catch {
    return null
  }
}

/** Cache OEM aunque esté un poco vieja (para temp CPU en dashboard). */
function readOemSensorCache(maxAgeMs = 120000) {
  try {
    if (!fs.existsSync(FAN_CACHE_FILE)) return null
    const d = JSON.parse(fs.readFileSync(FAN_CACHE_FILE, 'utf8').replace(/^\uFEFF/, ''))
    if (!d || !d.t || Date.now() - d.t > maxAgeMs) return null
    return d
  } catch {
    return null
  }
}

let oemEnsurePromise = null
let oemEnsureDenied = false
let oemEnsureSkipped = false

/**
 * En Lenovo LOQ/Legion, GetCPUTemp exige admin.
 * Un solo UAC inicia un watcher que escribe temp+fans a disco.
 */
async function ensureOemCpuTempMonitor() {
  const fresh = readOemSensorCache(90000)
  if (fresh?.cpuTemp != null && Number(fresh.cpuTemp) > 1) {
    return { ok: true, already: true, temp: Number(fresh.cpuTemp) }
  }
  // Si hay temp reciente (hasta 5 min), usarla aunque el watcher haya parado
  const soft = readOemSensorCache(300000)
  if (oemEnsureDenied && soft?.cpuTemp != null && Number(soft.cpuTemp) > 1) {
    return { ok: true, already: true, temp: Number(soft.cpuTemp), stale: true }
  }
  if (oemEnsureDenied || oemEnsureSkipped) {
    return { ok: false, denied: oemEnsureDenied, skipped: oemEnsureSkipped }
  }
  if (oemEnsurePromise) return oemEnsurePromise
  oemEnsurePromise = (async () => {
    try {
      const device = await detectIsLaptop()
      if (!device?.lenovoGamezone) {
        oemEnsureSkipped = true
        return { ok: false, skipped: true }
      }
      const r = await startLaptopFanMonitor()
      if (!r?.ok) {
        oemEnsureDenied = true
        return { ok: false, denied: true, message: r?.message }
      }
      const c = readOemSensorCache(90000) || soft
      return {
        ok: true,
        temp: c?.cpuTemp != null ? Number(c.cpuTemp) : null,
        message: r.message,
        already: !!r.already,
      }
    } catch (e) {
      oemEnsureDenied = true
      return { ok: false, denied: true, message: e.message }
    } finally {
      oemEnsurePromise = null
    }
  })()
  return oemEnsurePromise
}

function isFanWatchAlive() {
  if (!fanWatchPid) return false
  try {
    process.kill(fanWatchPid, 0)
    return true
  } catch {
    fanWatchPid = null
    return false
  }
}

function stopLaptopFanMonitor() {
  if (fanWatchPid) {
    try {
      process.kill(fanWatchPid)
    } catch {
      /* */
    }
    fanWatchPid = null
  }
  // No borrar la caché: al reiniciar sirve para mostrar temp hasta rearmar el watcher
  return { ok: true }
}

async function detectIsLaptop() {
  try {
    const raw = await runPs(
      `
$ErrorActionPreference='SilentlyContinue'
$types = @((Get-CimInstance Win32_SystemEnclosure).ChassisTypes)
$bat = @(Get-CimInstance Win32_Battery).Count
$laptopTypes = @(8,9,10,11,12,14,18,21,30,31,32)
$desktopTypes = @(3,4,5,6,7,15,16)
$isLaptop = ($types | Where-Object { $laptopTypes -contains $_ }).Count -gt 0 -or $bat -gt 0
$isDesktop = (-not $isLaptop) -and (($types | Where-Object { $desktopTypes -contains $_ }).Count -gt 0 -or $types.Count -eq 0)
$cs = Get-CimInstance Win32_ComputerSystem
$base = Get-CimInstance Win32_BaseBoard
$bios = Get-CimInstance Win32_BIOS
$prod = Get-CimInstance Win32_ComputerSystemProduct
$lenovoGz = [bool](Get-CimClass -Namespace root/wmi -ClassName LENOVO_GAMEZONE_DATA -EA SilentlyContinue)
$asus = [bool](Get-CimClass -Namespace root/wmi -ClassName ASUSATK_WMI_EVENT -EA SilentlyContinue)
$msi = [bool](Get-CimClass -Namespace root/wmi -ClassName MSI_Monitor -EA SilentlyContinue)
$formFactor = if ($isLaptop) { 'laptop' } elseif ($isDesktop) { 'desktop' } else { 'unknown' }
[pscustomobject]@{
  isLaptop=$isLaptop
  isDesktop=$isDesktop
  formFactor=$formFactor
  vendor=[string]$cs.Manufacturer
  model=[string]$cs.Model
  family=[string]$cs.SystemFamily
  productName=[string]$prod.Name
  boardManufacturer=[string]$base.Manufacturer
  boardProduct=[string]$base.Product
  boardVersion=[string]$base.Version
  boardSerial=[string]$base.SerialNumber
  biosVersion=[string]$bios.SMBIOSBIOSVersion
  biosVendor=[string]$bios.Manufacturer
  biosDate= if ($bios.ReleaseDate) { $bios.ReleaseDate.ToString('yyyy-MM-dd') } else { '' }
  lenovoGamezone=$lenovoGz
  asusWmi=$asus
  msiWmi=$msi
  chassis=($types -join ',')
} | ConvertTo-Json -Compress
`,
      15000,
    )
    return safeJson(raw, { isLaptop: false, isDesktop: false, formFactor: 'unknown', vendor: '', model: '', lenovoGamezone: false })
  } catch {
    return { isLaptop: false, isDesktop: false, formFactor: 'unknown', vendor: '', model: '', lenovoGamezone: false }
  }
}

async function startLaptopFanMonitor() {
  // Si ya hay caché fresca (agente / watcher), no pedir nada
  if (readFanCache()) {
    return { ok: true, message: 'Sensores laptop ya activos', already: true }
  }
  if (isFanWatchAlive()) {
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 400))
      if (readFanCache()) {
        return { ok: true, message: 'Monitor de ventiladores ya activo', already: true }
      }
    }
  }
  // Un solo agente privilegiado: sin UAC si ya está instalado
  try {
    const agent = require('./priv-agent.cjs')
    const r = await agent.ensurePrivAgent({ allowInstall: true })
    for (let i = 0; i < 12; i++) {
      await new Promise((s) => setTimeout(s, 400))
      if (readFanCache()) break
    }
    if (readFanCache()) {
      return {
        ok: true,
        message: 'Ventiladores laptop activos. Lectura continua sin más UAC.',
        already: !!r?.already,
      }
    }
    if (r?.denied) {
      return { ok: false, message: r.message || 'UAC cancelado' }
    }
    return {
      ok: !!r?.ok,
      message:
        r?.message ||
        'Agente iniciado. Si no hay RPM, revisa Lenovo Vantage / BIOS Gamezone.',
    }
  } catch (e) {
    return { ok: false, message: e.message || 'No se pudo iniciar el monitor de fans' }
  }
}

async function getHardwareControl() {
  const notes = []
  const device = await detectIsLaptop()
  const isLaptop = !!device.isLaptop
  let nvidia = null
  try {
    const out = await new Promise((resolve, reject) => {
      execFile(
        'nvidia-smi',
        [
          '--query-gpu=name,power.limit,power.draw,clocks.gr,clocks.mem,temperature.gpu,fan.speed',
          '--format=csv,noheader,nounits',
        ],
        { windowsHide: true, timeout: 8000 },
        (err, stdout) => (err ? reject(err) : resolve(String(stdout || '').trim())),
      )
    })
    const parts = out.split(',').map((s) => s.trim())
    if (parts.length >= 6) {
      const fanRaw = parts[6]
      const fanNum = fanRaw && !/\[?N\/A\]?/i.test(fanRaw) ? Number(fanRaw) : null
      nvidia = {
        name: parts[0],
        powerLimit: Number(parts[1]) || null,
        powerDraw: Number(parts[2]) || null,
        coreClock: Number(parts[3]) || null,
        memClock: Number(parts[4]) || null,
        temp: Number(parts[5]) || null,
        fan: fanNum != null && !Number.isNaN(fanNum) ? fanNum : null,
      }
      notes.push('NVIDIA-SMI: potencia, relojes y ventilador GPU (solo lectura de fan)')
      if (nvidia.fan == null && /laptop/i.test(nvidia.name || '')) {
        notes.push('GPU laptop: nvidia-smi no expone % de fan (usa sensores OEM / admin)')
      }
    }
  } catch {
    notes.push('nvidia-smi no disponible')
  }

  let chassisFans = []
  try {
    const raw = await runPs(
      `
$ErrorActionPreference='SilentlyContinue'
$rows = @()
Get-CimInstance Win32_Fan -EA SilentlyContinue | ForEach-Object {
  $rows += [pscustomobject]@{
    name = $_.Name
    status = [string]$_.Status
    desired = $_.DesiredSpeed
    active = [bool]$_.ActiveCooling
  }
}
$rows | ConvertTo-Json -Compress
`,
      12000,
    )
    chassisFans = asArray(safeJson(raw, []))
  } catch {
    chassisFans = []
  }

  const cache = readFanCache()
  const fans = []

  const pushFan = (f) => {
    fans.push({
      controllable: false,
      ...f,
    })
  }

  // Preferencia: sensores OEM Lenovo (2 fans típicos de laptop)
  if (cache && (cache.fan1Rpm != null || cache.fan2Rpm != null)) {
    const max = Number(cache.maxRpm) || 0
    const pct = (rpm) => (rpm != null && max > 0 ? Math.min(100, Math.round((Number(rpm) / max) * 100)) : null)
    pushFan({
      id: 'laptop-cpu',
      label: 'CPU',
      name: 'Ventilador CPU (laptop)',
      speedPercent: pct(cache.fan1Rpm),
      rpm: cache.fan1Rpm != null ? Number(cache.fan1Rpm) : null,
      temp: cache.cpuTemp != null ? Number(cache.cpuTemp) : null,
      status: cache.fan1Rpm > 0 ? 'spinning' : cache.fan1Rpm === 0 ? 'idle' : 'unknown',
      source: 'lenovo-gamezone',
    })
    pushFan({
      id: 'laptop-gpu',
      label: 'GPU',
      name: nvidia?.name || 'Ventilador GPU (laptop)',
      speedPercent: pct(cache.fan2Rpm),
      rpm: cache.fan2Rpm != null ? Number(cache.fan2Rpm) : null,
      temp: cache.gpuTemp != null ? Number(cache.gpuTemp) : nvidia?.temp ?? null,
      status: cache.fan2Rpm > 0 ? 'spinning' : cache.fan2Rpm === 0 ? 'idle' : 'unknown',
      source: 'lenovo-gamezone',
    })
    notes.push('Lenovo Gamezone: ventiladores CPU + GPU (lectura admin)')
  } else if (isLaptop) {
    // Slots fijos CPU/GPU para laptops aunque falte RPM
    const sys = chassisFans[0]
    const sysActive = !!(sys && (sys.active || /ok|enabled|running/i.test(String(sys.status || ''))))
    pushFan({
      id: 'laptop-cpu',
      label: 'CPU',
      name: sys?.name || 'Ventilador CPU / chasis',
      speedPercent: sys?.desired != null ? Number(sys.desired) : null,
      rpm: null,
      temp: null,
      status: sysActive ? 'spinning' : sys ? 'unknown' : 'unknown',
      source: sys ? 'wmi' : 'placeholder',
    })
    pushFan({
      id: 'laptop-gpu',
      label: 'GPU',
      name: nvidia?.name || 'Ventilador GPU',
      speedPercent: nvidia?.fan ?? null,
      rpm: null,
      temp: nvidia?.temp ?? null,
      status: nvidia?.fan != null ? (nvidia.fan > 5 ? 'spinning' : 'idle') : 'unknown',
      source: nvidia?.fan != null ? 'nvidia-smi' : 'placeholder',
    })
    if (device.lenovoGamezone) {
      notes.push('Lenovo LOQ/Legion: pulsa “Leer fans laptop (admin)” para RPM de los 2 ventiladores')
    } else {
      notes.push('Laptop detectada: mostrando CPU + GPU. RPM OEM puede requerir software del fabricante.')
    }
  } else {
    if (nvidia) {
      pushFan({
        id: 'gpu',
        label: 'GPU',
        name: nvidia.name,
        speedPercent: nvidia.fan,
        rpm: null,
        temp: nvidia.temp,
        status: nvidia.fan != null ? (nvidia.fan > 5 ? 'spinning' : 'idle') : 'unknown',
        source: 'nvidia-smi',
      })
    }
    for (const f of chassisFans) {
      const active = !!(f.active || /ok|enabled|running/i.test(String(f.status || '')))
      pushFan({
        id: `sys-${f.name || fans.length}`,
        label: 'Sistema',
        name: f.name || 'Ventilador',
        speedPercent: f.desired != null ? Number(f.desired) : null,
        rpm: null,
        temp: null,
        status: active ? 'spinning' : f.status ? 'unknown' : 'unknown',
        source: 'wmi',
      })
    }
  }

  if (!fans.length) {
    notes.push('Sin datos de ventiladores (GPU sin fan sensor o WMI vacío)')
  }

  let openRgb = findOpenRgbPath()
  if (openRgb) notes.push('OpenRGB encontrado (puedes abrirlo desde aquí)')
  else notes.push('RGB: instala OpenRGB para controlar luces')

  notes.push('Ventiladores: solo monitoreo. Eyed no aplica curvas (usa Afterburner / fabricante).')
  notes.push('Undervolt / bombas AIO / OC: software del fabricante.')
  if (device.boardManufacturer || device.boardProduct) {
    notes.push(
      `Placa: ${(device.boardManufacturer || '').trim()} ${(device.boardProduct || '').trim()}`.trim(),
    )
  }
  if (device.formFactor === 'desktop') {
    notes.push('PC torre / escritorio: sensores vía WMI placa + nvidia-smi (si hay GPU NVIDIA)')
  } else if (device.formFactor === 'laptop') {
    notes.push('Laptop: APIs OEM (Lenovo Gamezone / WMI) + batería + fans CPU/GPU')
  }

  const board = {
    manufacturer: device.boardManufacturer || device.vendor || '',
    product: device.boardProduct || device.model || '',
    version: device.boardVersion || '',
    serial: device.boardSerial || '',
    bios: device.biosVersion || '',
    biosVendor: device.biosVendor || '',
    biosDate: device.biosDate || '',
    formFactor: device.formFactor || (isLaptop ? 'laptop' : 'unknown'),
    family: device.family || '',
    apis: {
      nvidiaSmi: !!nvidia,
      win32Fan: chassisFans.length > 0,
      lenovoGamezone: !!device.lenovoGamezone,
      asusWmi: !!device.asusWmi,
      msiWmi: !!device.msiWmi,
      battery: isLaptop,
    },
  }

  return {
    ok: true,
    nvidia,
    fans,
    isLaptop,
    isDesktop: !!device.isDesktop,
    device,
    board,
    fanMonitorActive: isFanWatchAlive() || !!readFanCache(),
    openRgbPath: openRgb || null,
    canFanCurve: false,
    canOc: false,
    canRgb: !!openRgb,
    canAio: false,
    notes,
  }
}

async function setNvidiaPowerLimit(watts) {
  const w = Math.max(50, Math.min(600, Number(watts) || 0))
  if (!w) return { ok: false, message: 'Watts inválidos' }
  try {
    await new Promise((resolve, reject) => {
      execFile('nvidia-smi', ['-pl', String(w)], { windowsHide: true, timeout: 10000 }, (err, stdout, stderr) =>
        err ? reject(new Error(stderr || err.message)) : resolve(stdout),
      )
    })
    return { ok: true, message: `Límite de potencia GPU: ${w} W`, elevated: false }
  } catch (e) {
    const elev = await runElevatedPs(
      `
$p = Get-Command nvidia-smi -EA SilentlyContinue
if (-not $p) { throw 'nvidia-smi no encontrado' }
& nvidia-smi -pl ${w} | Out-String
`,
      30000,
    )
    if (elev.ok) return { ok: true, message: `Límite GPU: ${w} W (admin)`, elevated: true }
    return { ok: false, message: elev.message || cleanPsError(e.message) || 'Falló (requiere admin)' }
  }
}

async function launchOpenRgb() {
  const openRgbPath = findOpenRgbPath()
  if (!openRgbPath) return { ok: false, message: 'OpenRGB no instalado' }
  execFile(openRgbPath, [], { windowsHide: false, detached: true })
  return { ok: true, message: 'OpenRGB lanzado' }
}

/* —— Backup settings / report —— */
function backupSettings(userData, settings) {
  const dir = path.join(userData, 'backups')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `settings-${Date.now()}.json`)
  fs.writeFileSync(file, JSON.stringify(settings, null, 2), 'utf8')
  return { ok: true, path: file, message: `Backup guardado: ${file}` }
}

function buildReportHtml(payload) {
  const { stats, specs, disk, diagnose, history, net } = payload || {}
  return `<!doctype html><html><head><meta charset="utf-8"/><title>EyedOptimizer Report</title>
  <style>body{font-family:Segoe UI,Arial;background:#0b1018;color:#eef3fb;padding:24px}h1{color:#3ec4ff}table{border-collapse:collapse;width:100%;margin:12px 0}td,th{border:1px solid #233;padding:8px;text-align:left}.muted{color:#8b9bb3}</style></head><body>
  <h1>EyedOptimizer — Informe</h1>
  <p class="muted">${new Date().toLocaleString()}</p>
  <h2>Sistema</h2>
  <table>
    <tr><th>CPU</th><td>${stats?.cpu?.name || specs?.cpu?.name || '—'}</td></tr>
    <tr><th>GPU</th><td>${stats?.gpu?.name || '—'}</td></tr>
    <tr><th>RAM</th><td>${stats?.ram?.percent ?? '—'}% · ${stats?.ram?.usedMb ?? '—'}/${stats?.ram?.totalMb ?? '—'} MB</td></tr>
    <tr><th>Disco</th><td>${stats?.disk?.percent ?? '—'}%</td></tr>
  </table>
  <h2>Diagnóstico</h2>
  <p><b>${diagnose?.primary?.title || 'N/D'}</b> — ${diagnose?.primary?.detail || ''}</p>
  <h2>Red</h2>
  <p>IP ${net?.publicIp || '—'} · ISP ${net?.isp || '—'} · Últimos tests: ${(history?.speedTests || []).length}</p>
  <h2>Discos</h2>
  <pre>${JSON.stringify(disk?.disks || [], null, 2)}</pre>
  </body></html>`
}

module.exports = {
  setPerformanceMode,
  listPowerPlans,
  listStartupApps,
  setStartupEnabled,
  cleanTempsDeep,
  optimizeVolume,
  getNetConnections,
  getLanDevices,
  getNetThroughput,
  getFirewallStatus,
  setFirewallProfile,
  listDrivers,
  listSystemEvents,
  listBsodDumps,
  detectInstability,
  cpuBench,
  ramBench,
  ssdBench,
  gpuBenchHint,
  getHardwareControl,
  startLaptopFanMonitor,
  stopLaptopFanMonitor,
  readFanCache,
  readOemSensorCache,
  ensureOemCpuTempMonitor,
  setNvidiaPowerLimit,
  launchOpenRgb,
  backupSettings,
  buildReportHtml,
  MODE_PLANS,
  applyRgbForMode,
  findOpenRgbPath,
}
