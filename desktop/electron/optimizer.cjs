const { execFile } = require('node:child_process')
const { runElevatedPs, cleanPsError } = require('./elevate.cjs')
const { isWindows, unsupported, killProcessTree } = require('./platform.cjs')
const si = require('systeminformation')

function runPs(script, timeout = 20000) {
  if (!isWindows) {
    return Promise.reject(new Error('PowerShell solo disponible en Windows'))
  }
  return new Promise((resolve, reject) => {
    execFile(
      'powershell',
      ['-NoProfile', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout, maxBuffer: 1024 * 1024 * 8, encoding: 'utf8' },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(cleanPsError(stderr || err.message)))
        resolve(String(stdout || '').trim())
      },
    )
  })
}

const SKIP = `@('Idle','System','Registry','smss','csrss','wininit','services','lsass','svchost','dwm','fontdrvhost','Memory Compression','Secure System','EyedOptimizer','electron','PresentMon')`

// Solo top procesos — evita colgar el PC abriendo handles a todo
const EMPTY_WS = `
Add-Type -TypeDefinition @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
public static class EyedMem {
  [DllImport("psapi.dll")] public static extern bool EmptyWorkingSet(IntPtr hProcess);
  public static int TrimTop(string[] skip, int max) {
    int n = 0;
    var list = new System.Collections.Generic.List<Process>();
    foreach (var p in Process.GetProcesses()) {
      try {
        if (p.Id <= 4) { p.Dispose(); continue; }
        bool skipIt = false;
        foreach (var s in skip) {
          if (string.Equals(s, p.ProcessName, StringComparison.OrdinalIgnoreCase)) { skipIt = true; break; }
        }
        if (skipIt) { p.Dispose(); continue; }
        list.Add(p);
      } catch { try { p.Dispose(); } catch {} }
    }
    list.Sort((a, b) => {
      try { return b.WorkingSet64.CompareTo(a.WorkingSet64); } catch { return 0; }
    });
    int take = Math.Min(max, list.Count);
    for (int i = 0; i < list.Count; i++) {
      var p = list[i];
      try {
        if (i < take && EmptyWorkingSet(p.Handle)) n++;
      } catch {}
      finally { try { p.Dispose(); } catch {} }
    }
    return n;
  }
}
"@
`

function parseMemResult(out, messagePrefix) {
  const [trimmed, freedKB, freeKB, tempRemoved, tempFreedKB] = out
    .split('|')
    .map((x) => Number(x) || 0)
  const freedMb = Math.round((freedKB / 1024) * 10) / 10
  const tempFreedMb = Math.round((tempFreedKB / 1024) * 10) / 10
  let message = ''
  if (tempRemoved > 0) {
    message =
      freedKB > 0
        ? `${messagePrefix} RAM ~${freedMb} MB · Temporales ${tempRemoved} archivos (~${tempFreedMb} MB).`
        : `${messagePrefix} Temporales: ${tempRemoved} archivos (~${tempFreedMb} MB).`
  } else if (freedKB > 0) {
    message = `${messagePrefix} Liberados ~${freedMb} MB de RAM (working set).`
  } else {
    message = `${messagePrefix} Poco margen: el sistema ya tenía RAM libre.`
  }
  return {
    success: true,
    processesTrimmed: trimmed,
    freedMb,
    freeMb: Math.round((freeKB / 1024) * 10) / 10,
    tempFilesRemoved: tempRemoved,
    tempFreedMb,
    standbyPurged: false,
    message,
  }
}

async function clearRamCache() {
  if (!isWindows) {
    return { ...unsupported('powershellTools', 'Limpieza de cache RAM avanzada solo en Windows.'), success: false, mode: 'cache', freedMb: 0 }
  }
  // 1) Trim working sets (sin admin)
  const script = `
$ErrorActionPreference='SilentlyContinue'
${EMPTY_WS}
$before = (Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory
$skip = ${SKIP}
$trimmed = [EyedMem]::TrimTop([string[]]$skip, 180)
[GC]::Collect()
Start-Sleep -Milliseconds 350
$after = (Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory
$freedKB = [Math]::Max(0, $after - $before)
Write-Output ("{0}|{1}|{2}|0|0|{3}" -f $trimmed, $freedKB, $after, $before)
`
  try {
    const out = await runPs(script, 35000)
    let result = parseMemResult(out, 'Cache RAM.')
    const parts = String(out || '').split('|').map((x) => Number(x) || 0)
    const beforeMb = Math.round((parts[5] || 0) / 1024)
    const afterMb = result.freeMb
    result = {
      ...result,
      beforeFreeMb: beforeMb || null,
      afterFreeMb: afterMb,
      mode: 'cache',
    }

    // 2) Purgar standby list (efecto real visible) vía agente/UAC si hace falta
    const purgeScript = `
$ErrorActionPreference='SilentlyContinue'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class EyedStandby {
  [DllImport("ntdll.dll")] public static extern int NtSetSystemInformation(int c, ref int i, int l);
  public static bool Purge() {
    try {
      int cmd = 4; // MemoryPurgeStandbyList
      return NtSetSystemInformation(80, ref cmd, 4) == 0;
    } catch { return false; }
  }
}
"@
$before = (Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory
$purged = [EyedStandby]::Purge()
Start-Sleep -Milliseconds 400
$after = (Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory
$freedKB = [Math]::Max(0, $after - $before)
Write-Output ("STANDBY|{0}|{1}|{2}" -f $freedKB, $after, ($(if ($purged) {1} else {0})))
`
    let standbyFreed = 0
    let standbyOk = false
    try {
      const elev = await runElevatedPs(purgeScript, 45000)
      if (elev.ok) {
        const m = String(elev.output || '').match(/STANDBY\|(\d+)\|(\d+)/)
        if (m) {
          standbyFreed = Math.round((Number(m[1]) / 1024) * 10) / 10
          result.freeMb = Math.round((Number(m[2]) / 1024) * 10) / 10
          result.afterFreeMb = result.freeMb
          standbyOk = true
        }
      }
    } catch {
      /* sin elevación: se queda el trim */
    }

    const totalFreed = Math.round(((result.freedMb || 0) + standbyFreed) * 10) / 10
    result.freedMb = totalFreed
    result.standbyPurged = standbyOk
    if (standbyOk && standbyFreed > 0) {
      result.message = `Listo. Liberados ~${totalFreed} MB (working set + standby). RAM libre ~${result.freeMb} MB.`
    } else if ((result.freedMb || 0) > 0.5) {
      result.message = `Listo. Liberados ~${result.freedMb} MB de procesos. RAM libre ~${result.freeMb} MB.`
    } else {
      result.message = `Poco margen ahora. RAM libre ~${result.freeMb} MB. Si quieres liberar más, acepta el permiso admin la próxima vez (standby).`
    }
    result.success = true
    return result
  } catch (e) {
    return {
      success: false,
      message: cleanPsError(e.message) || 'No se pudo limpiar cache RAM',
      mode: 'cache',
      standbyPurged: false,
      freedMb: 0,
      processesTrimmed: 0,
    }
  }
}

/** Optimizacion segura: EmptyWorkingSet (top) + temporales. Sin ntdll/standby (evita cuelgues/BSOD). */
async function optimizeRam() {
  if (!isWindows) {
    return { ...unsupported('powershellTools', 'Optimizacion RAM avanzada solo en Windows.'), success: false, mode: 'full', freedMb: 0 }
  }
  const script = `
$ErrorActionPreference='SilentlyContinue'
${EMPTY_WS}
$before = (Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory
$skip = ${SKIP}
$trimmed = [EyedMem]::TrimTop([string[]]$skip, 80)

$tempRemoved = 0
$tempFreed = 0
$temps = @($env:TEMP, $env:TMP, (Join-Path $env:WINDIR 'Temp'), (Join-Path $env:LOCALAPPDATA 'Microsoft\\Windows\\INetCache'))
foreach ($dir in $temps) {
  if (-not $dir -or -not (Test-Path -LiteralPath $dir)) { continue }
  Get-ChildItem -LiteralPath $dir -Force -EA SilentlyContinue |
    Where-Object { -not $_.PSIsContainer } |
    Select-Object -First 500 | ForEach-Object {
      try {
        $len = $_.Length
        Remove-Item -LiteralPath $_.FullName -Force -EA Stop
        $tempRemoved++
        $tempFreed += [int64]$len
      } catch {}
    }
}

[GC]::Collect()
Start-Sleep -Milliseconds 200
$after = (Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory
$freedKB = [Math]::Max(0, $after - $before)
$tempFreedKB = [Math]::Round($tempFreed / 1024)
Write-Output ("{0}|{1}|{2}|{3}|{4}" -f $trimmed, $freedKB, $after, $tempRemoved, $tempFreedKB)
`
  try {
    const out = await runPs(script, 45000)
    return { ...parseMemResult(out, 'Optimización lista.'), mode: 'full' }
  } catch (e) {
    return {
      success: false,
      message: cleanPsError(e.message) || 'Optimización falló',
      mode: 'full',
      standbyPurged: false,
      freedMb: 0,
    }
  }
}

async function listProcesses() {
  if (!isWindows) {
    try {
      const data = await si.processes()
      return (data.list || [])
        .map((p) => ({
          pid: p.pid,
          name: String(p.name || '').replace(/\.exe$/i, ''),
          cpu: Math.round((p.cpu || 0) * 10) / 10,
          memMb: Math.round(((p.memRss || 0) / (1024 * 1024)) * 10) / 10,
          path: p.path || p.command || '',
        }))
        .sort((a, b) => b.memMb - a.memMb)
        .slice(0, 100)
    } catch {
      return []
    }
  }
  const script = `
$ErrorActionPreference='SilentlyContinue'
$byPid = @{}
Get-CimInstance Win32_Process -EA SilentlyContinue | ForEach-Object {
  if ($_.ProcessId) { $byPid[[int]$_.ProcessId] = [string]$_.ExecutablePath }
}
Get-Process | Where-Object { $_.Id -gt 4 } | Sort-Object WorkingSet64 -Descending | Select-Object -First 100 |
  ForEach-Object {
    $exe = ''
    if ($byPid.ContainsKey([int]$_.Id) -and $byPid[[int]$_.Id]) { $exe = $byPid[[int]$_.Id] }
    if (-not $exe) {
      try {
        if ($_.Path) { $exe = [string]$_.Path }
        elseif ($_.MainModule -and $_.MainModule.FileName) { $exe = [string]$_.MainModule.FileName }
      } catch {}
    }
    [pscustomobject]@{
      pid=$_.Id
      name=$_.ProcessName
      cpu=[Math]::Round(($_.CPU|%{ if ($_ -ne $null) { $_ } else { 0 } }),1)
      memMb=[Math]::Round($_.WorkingSet64/1MB,1)
      path=$exe
    }
  } | ConvertTo-Json -Compress -Depth 3
`
  try {
    const raw = await runPs(script, 30000)
    const parsed = JSON.parse(raw || '[]')
    return Array.isArray(parsed) ? parsed : parsed ? [parsed] : []
  } catch {
    return []
  }
}

async function killProcess(pid) {
  const id = Number(pid) || 0
  if (!id) return { ok: false, message: 'PID inválido' }
  if (!isWindows) {
    const ok = killProcessTree(id)
    return { ok, message: ok ? `Proceso ${id} terminado` : 'No se pudo finalizar' }
  }
  try {
    await runPs(`Stop-Process -Id ${id} -Force -EA Stop; Write-Output 'OK'`, 10000)
    return { ok: true, message: `Proceso ${id} terminado` }
  } catch (e) {
    const elev = await runElevatedPs(`Stop-Process -Id ${id} -Force -EA Stop; Write-Output 'OK'`, 20000)
    if (elev.ok) return { ok: true, message: `Proceso ${id} terminado (admin)`, elevated: true }
    return { ok: false, message: elev.message || cleanPsError(e.message) }
  }
}

module.exports = { clearRamCache, optimizeRam, listProcesses, killProcess }
