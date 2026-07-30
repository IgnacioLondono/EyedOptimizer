const { execFile } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { isWindows } = require('./platform.cjs')

function decodePsOutput(buf) {
  if (!buf) return ''
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf))
  // PowerShell a veces emite UTF-16 LE por el pipe
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) {
    return b.slice(2).toString('utf16le')
  }
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) {
    return b.slice(2).swap16().toString('utf16le')
  }
  // Heurística: muchos NULs → UTF-16 LE sin BOM
  let nul = 0
  const sample = Math.min(b.length, 200)
  for (let i = 1; i < sample; i += 2) if (b[i] === 0) nul += 1
  if (sample > 20 && nul > sample / 5) return b.toString('utf16le')
  return b.toString('utf8')
}

function runPs(script, timeout = 90000) {
  const wrapped = `
$ErrorActionPreference='SilentlyContinue'
$ProgressPreference='SilentlyContinue'
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $OutputEncoding
${script}
`
  return new Promise((resolve, reject) => {
    execFile(
      'powershell',
      ['-NoProfile', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-Command', wrapped],
      { windowsHide: true, timeout, maxBuffer: 1024 * 1024 * 24, encoding: 'buffer' },
      (err, stdout, stderr) => {
        const out = decodePsOutput(stdout).trim()
        const errText = decodePsOutput(stderr).trim()
        if (err) return reject(new Error(errText || err.message || 'Error PowerShell'))
        resolve(out)
      },
    )
  })
}

function cleanName(name) {
  return String(name || '')
    .replace(/\uFFFD/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function safeJson(raw) {
  if (!raw) return []
  try {
    const data = JSON.parse(raw)
    return Array.isArray(data) ? data : data ? [data] : []
  } catch {
    return []
  }
}

function appKey(a) {
  return `${String(a.source || 'registry').toLowerCase()}::${cleanName(a.name).toLowerCase()}`
}

async function listInstalledApps() {
  if (!isWindows) {
    // macOS/Linux: listado básico desde Applications / usr
    try {
      const si = require('systeminformation')
      const apps = await si.apps?.()
      if (Array.isArray(apps) && apps.length) {
        return apps.slice(0, 200).map((a, i) => ({
          id: `si-${i}-${a.name}`,
          name: a.name || 'App',
          publisher: a.publisher || '',
          version: a.version || '',
          installLocation: a.path || '',
          source: 'system',
          sizeMb: null,
        }))
      }
    } catch {
      /* */
    }
    return []
  }
  // Nota: en template strings JS, \${...} evita interpolación y deja sintaxis PowerShell válida.
  const script = `
$ErrorActionPreference='SilentlyContinue'
$ProgressPreference='SilentlyContinue'
$all = New-Object System.Collections.Generic.List[object]

function Add-App($obj) {
  if (-not $obj.name -or $obj.name.Trim().Length -lt 2) { return }
  $all.Add([pscustomobject]$obj)
}

try {
  $regPaths = @(
    'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
  )
  foreach ($root in $regPaths) {
    if (-not (Test-Path $root)) { continue }
    Get-ChildItem $root -EA SilentlyContinue | ForEach-Object {
      try {
        $props = Get-ItemProperty $_.PSPath -EA SilentlyContinue
        if (-not $props -or -not $props.DisplayName) { return }
        if ($props.SystemComponent -eq 1) { return }
        if ($props.DisplayName.Trim().Length -lt 2) { return }
        $loc = $props.InstallLocation
        if (-not $loc -and $props.DisplayIcon) {
          $icon = ($props.DisplayIcon -split ',')[0].Trim('"')
          if ($icon -and (Test-Path -LiteralPath $icon)) { $loc = [IO.Path]::GetDirectoryName($icon) }
        }
        $size = 0
        try { if ($props.EstimatedSize) { $size = [int64]$props.EstimatedSize } } catch {}
        Add-App ([ordered]@{
          id = $_.PSChildName
          name = $props.DisplayName
          version = $props.DisplayVersion
          publisher = $props.Publisher
          installDate = $props.InstallDate
          installLocation = $loc
          uninstallString = $props.UninstallString
          quietUninstall = $props.QuietUninstallString
          sizeKb = $size
          source = 'registry'
          packageName = ''
          iconPath = if ($props.DisplayIcon) { ($props.DisplayIcon -split ',')[0].Trim('"') } else { '' }
        })
      } catch {}
    }
  }
} catch {}

try {
  Get-AppxPackage -EA SilentlyContinue | Where-Object {
    $_.Name -and -not $_.IsFramework -and $_.SignatureKind -ne 'System'
  } | ForEach-Object {
    $disp = $_.Name
    if ($disp -match '\\.') { $disp = ($disp -split '\\.' | Select-Object -Last 1) }
    Add-App ([ordered]@{
      id = $_.PackageFullName
      name = $disp
      version = [string]$_.Version
      publisher = $_.Publisher
      installDate = ''
      installLocation = $_.InstallLocation
      uninstallString = ''
      quietUninstall = ''
      sizeKb = 0
      source = 'appx'
      packageName = $_.PackageFullName
      iconPath = ''
    })
  }
} catch {}

try {
  $appPathRoots = @(
    'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths',
    'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths'
  )
  foreach ($root in $appPathRoots) {
    if (-not (Test-Path $root)) { continue }
    Get-ChildItem $root -EA SilentlyContinue | ForEach-Object {
      try {
        $exe = (Get-ItemProperty $_.PSPath -EA SilentlyContinue).'(default)'
        if (-not $exe) { return }
        $exe = $exe.Trim('"')
        if (-not (Test-Path -LiteralPath $exe)) { return }
        $base = [IO.Path]::GetFileNameWithoutExtension($_.PSChildName)
        Add-App ([ordered]@{
          id = 'apppath-' + $_.PSChildName
          name = $base
          version = ''
          publisher = ''
          installDate = ''
          installLocation = [IO.Path]::GetDirectoryName($exe)
          uninstallString = ''
          quietUninstall = ''
          sizeKb = 0
          source = 'apppath'
          packageName = $exe
          iconPath = $exe
        })
      } catch {}
    }
  }
} catch {}

try {
  $shell = New-Object -ComObject WScript.Shell
  $startMenus = @(
    (Join-Path $env:ProgramData 'Microsoft\\Windows\\Start Menu\\Programs'),
    (Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs')
  )
  foreach ($menu in $startMenus) {
    if (-not (Test-Path $menu)) { continue }
    Get-ChildItem -Path $menu -Recurse -Filter '*.lnk' -EA SilentlyContinue | ForEach-Object {
      try {
        $sc = $shell.CreateShortcut($_.FullName)
        $target = $sc.TargetPath
        if (-not $target -or -not (Test-Path -LiteralPath $target)) { return }
        if ($target -notmatch '\\.(exe|bat|cmd)$') { return }
        $name = [IO.Path]::GetFileNameWithoutExtension($_.BaseName)
        if ($name -match '^(Desinstalar|Uninstall|Documentation|Manual|Help|Readme)') { return }
        Add-App ([ordered]@{
          id = 'lnk-' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($_.FullName)).Substring(0,12)
          name = $name
          version = ''
          publisher = ''
          installDate = ''
          installLocation = [IO.Path]::GetDirectoryName($target)
          uninstallString = ''
          quietUninstall = ''
          sizeKb = 0
          source = 'shortcut'
          packageName = $target
          iconPath = $target
        })
      } catch {}
    }
  }
} catch {}

try {
  $pf86 = \${env:ProgramFiles(x86)}
  $pfRoots = @(
    $env:ProgramFiles,
    $pf86,
    (Join-Path $env:LOCALAPPDATA 'Programs')
  ) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique

  foreach ($root in $pfRoots) {
    Get-ChildItem -LiteralPath $root -Directory -EA SilentlyContinue | ForEach-Object {
      try {
        $exes = Get-ChildItem -LiteralPath $_.FullName -Filter '*.exe' -Recurse -Depth 2 -EA SilentlyContinue |
          Where-Object { $_.Name -notmatch '^(unins|setup|install|update|crash|helper|uninstall)' } |
          Select-Object -First 1
        if (-not $exes) { return }
        Add-App ([ordered]@{
          id = 'folder-' + $_.Name
          name = $_.Name
          version = ''
          publisher = ''
          installDate = ''
          installLocation = $_.FullName
          uninstallString = ''
          quietUninstall = ''
          sizeKb = 0
          source = 'folder'
          packageName = $exes.FullName
          iconPath = $exes.FullName
        })
      } catch {}
    }
  }
} catch {}

$all | ConvertTo-Json -Compress -Depth 5
`
  const out = await runPs(script, 180000).catch((e) => {
    console.error('[apps] PowerShell falló:', e.message)
    return ''
  })
  const list = safeJson(out)
  const seen = new Set()
  const merged = []

  for (const a of list) {
    if (!a || !a.name) continue
    const name = cleanName(a.name)
    if (name.length < 2) continue
    const key = appKey({ ...a, name })
    if (seen.has(key)) continue
    seen.add(key)

    // Prefer registry entry over folder/shortcut when same name
    const dupIdx = merged.findIndex(
      (m) => cleanName(m.name).toLowerCase() === name.toLowerCase() && m.source !== a.source,
    )
    if (dupIdx >= 0) {
      const existing = merged[dupIdx]
      const priority = { registry: 4, appx: 3, apppath: 2, shortcut: 1, folder: 0 }
      if ((priority[a.source] || 0) > (priority[existing.source] || 0)) {
        merged[dupIdx] = a
      }
      continue
    }

    merged.push(a)
  }

  return merged
    .map((a) => ({
      id: a.id || a.name,
      name: cleanName(a.name),
      version: a.version || '',
      publisher: a.publisher || '',
      installDate: a.installDate || '',
      installLocation: a.installLocation || '',
      uninstallString: a.uninstallString || '',
      quietUninstall: a.quietUninstall || '',
      sizeMb: a.sizeKb ? Math.round((Number(a.sizeKb) / 1024) * 10) / 10 : null,
      source: a.source || 'registry',
      packageName: a.packageName || '',
      iconPath: a.iconPath || a.packageName || '',
    }))
    .sort((a, b) => {
      const au = (a.uninstallString || a.quietUninstall || a.source === 'appx') ? 1 : 0
      const bu = (b.uninstallString || b.quietUninstall || b.source === 'appx') ? 1 : 0
      if (au !== bu) return bu - au
      const priority = { registry: 4, appx: 3, apppath: 2, shortcut: 1, folder: 0 }
      const ap = priority[a.source] || 0
      const bp = priority[b.source] || 0
      if (ap !== bp) return bp - ap
      return a.name.localeCompare(b.name, 'es')
    })
}

function dirSize(dir, maxFiles = 8000) {
  let total = 0
  let files = 0
  const stack = [dir]
  while (stack.length && files < maxFiles) {
    const cur = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const full = path.join(cur, e.name)
      try {
        if (e.isDirectory()) stack.push(full)
        else if (e.isFile()) {
          total += fs.statSync(full).size
          files += 1
        }
      } catch {
        /* skip */
      }
    }
  }
  return total
}

function collectRelatedPaths(app) {
  const paths = new Set()
  const loc = (app.installLocation || '').trim()
  if (loc && fs.existsSync(loc)) paths.add(path.normalize(loc))

  const name = String(app.name || '')
    .replace(/[<>:"/\\|?*]/g, '')
    .trim()
  const publisher = String(app.publisher || '')
    .replace(/[<>:"/\\|?*]/g, '')
    .trim()
  const candidates = []
  if (name) {
    const pf = process.env['ProgramFiles'] || 'C:\\Program Files'
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
    const local = process.env.LOCALAPPDATA || ''
    const roaming = process.env.APPDATA || ''
    const progData = process.env.ProgramData || 'C:\\ProgramData'
    candidates.push(
      path.join(pf, name),
      path.join(pf86, name),
      path.join(local, name),
      path.join(roaming, name),
      path.join(progData, name),
      path.join(local, 'Programs', name),
    )
    if (publisher) {
      candidates.push(
        path.join(pf, publisher, name),
        path.join(pf86, publisher, name),
        path.join(local, publisher, name),
        path.join(roaming, publisher, name),
      )
    }
  }
  for (const c of candidates) {
    if (c && fs.existsSync(c)) paths.add(path.normalize(c))
  }
  return [...paths]
}

async function getAppDetails(app) {
  const locations = collectRelatedPaths(app)
  const details = locations.map((p) => {
    let size = 0
    try {
      size = dirSize(p)
    } catch {
      size = 0
    }
    return {
      path: p,
      exists: fs.existsSync(p),
      size,
      sizeLabel: size > 0 ? `${(size / 1024 / 1024).toFixed(1)} MB` : '—',
    }
  })
  return {
    ...app,
    locations: details,
    canUninstall: !!(app.uninstallString || app.quietUninstall || app.source === 'appx'),
  }
}

async function uninstallAppx(packageName) {
  const pkg = String(packageName || '').replace(/'/g, "''")
  if (!pkg) return { success: false, message: 'Paquete AppX no valido.' }
  const script = `
$ErrorActionPreference='SilentlyContinue'
Remove-AppxPackage -Package '${pkg}' -ErrorAction Stop
Write-Output 'OK'
`
  try {
    const out = await runPs(script, 60000)
    if (out.startsWith('ERR:')) return { success: false, message: out.slice(4) }
    return { success: true, message: 'Aplicacion Store desinstalada.' }
  } catch (e) {
    return { success: false, message: e.message || 'No se pudo desinstalar AppX' }
  }
}

async function uninstallApp(app, { removeFiles = false } = {}) {
  if (!app) return { success: false, message: 'Aplicacion no valida.' }

  if (app.source === 'appx' && app.packageName) {
    const res = await uninstallAppx(app.packageName)
    if (!res.success) return res
    if (removeFiles && app.installLocation && fs.existsSync(app.installLocation)) {
      try {
        fs.rmSync(app.installLocation, { recursive: true, force: true, maxRetries: 2 })
      } catch {
        /* ignore */
      }
    }
    return res
  }

  if (!app.uninstallString && !app.quietUninstall) {
    if (app.source === 'folder' || app.source === 'shortcut' || app.source === 'apppath') {
      if (removeFiles && app.installLocation) {
        const removed = []
        for (const loc of collectRelatedPaths(app)) {
          try {
            if (fs.existsSync(loc)) {
              fs.rmSync(loc, { recursive: true, force: true, maxRetries: 2 })
              if (!fs.existsSync(loc)) removed.push(loc)
            }
          } catch {
            /* ignore */
          }
        }
        return {
          success: removed.length > 0,
          message:
            removed.length > 0
              ? `Carpetas eliminadas: ${removed.length}.`
              : 'No hay desinstalador. Usa "Desinstalar + borrar" para eliminar carpetas.',
          removed,
        }
      }
      return {
        success: false,
        message: 'Sin desinstalador registrado. Usa "Desinstalar + borrar" para eliminar archivos.',
      }
    }
    return { success: false, message: 'Esta app no tiene desinstalador registrado.' }
  }

  const cmd = app.quietUninstall || app.uninstallString
  const script = `
$ErrorActionPreference='Stop'
$cmd = @'
${String(cmd).replace(/'/g, "''")}
'@
try {
  if ($cmd -match '(?i)msiexec') {
    $args = ($cmd -replace '(?i)^.*?msiexec(\\.exe)?\\s*', '').Trim()
    if ($args -notmatch '(?i)/quiet|/qn|/passive') { $args = "$args /qn" }
    Start-Process -FilePath 'msiexec.exe' -ArgumentList $args -Wait -WindowStyle Hidden
  } else {
    if ($cmd -match '^"([^"]+)"\\s*(.*)$') {
      $exe = $Matches[1]; $a = $Matches[2]
    } elseif ($cmd -match '^(\\S+)\\s*(.*)$') {
      $exe = $Matches[1]; $a = $Matches[2]
    } else { $exe = $cmd; $a = '' }
    if (-not (Test-Path $exe)) { throw "No se encontro el desinstalador: $exe" }
    Start-Process -FilePath $exe -ArgumentList $a -Wait -WindowStyle Hidden
  }
  Write-Output 'OK'
} catch {
  Write-Output ('ERR:' + $_.Exception.Message)
}
`
  let out = ''
  try {
    out = await runPs(script, 180000)
  } catch (e) {
    return { success: false, message: e.message || 'Fallo al desinstalar' }
  }
  if (out.startsWith('ERR:')) {
    return { success: false, message: out.slice(4) || 'Error al desinstalar' }
  }

  const removed = []
  if (removeFiles) {
    for (const loc of collectRelatedPaths(app)) {
      try {
        if (fs.existsSync(loc)) {
          fs.rmSync(loc, { recursive: true, force: true, maxRetries: 2 })
          if (!fs.existsSync(loc)) removed.push(loc)
        }
      } catch {
        /* leave leftover */
      }
    }
  }

  return {
    success: true,
    message: removeFiles
      ? `Desinstalacion lanzada. Carpetas residuales eliminadas: ${removed.length}.`
      : 'Desinstalacion completada (o asistente cerrado).',
    removed,
    locations: collectRelatedPaths(app),
  }
}

module.exports = { listInstalledApps, getAppDetails, uninstallApp, collectRelatedPaths }
