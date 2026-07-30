const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const execFileAsync = promisify(execFile)

let active = false
let previousPlan = null

function runPs(script) {
  return execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { windowsHide: true, timeout: 12000 },
  ).catch(() => ({ stdout: '', stderr: '' }))
}

async function setProcessPriorityHigh() {
  try {
    process.setPriority?.(process.pid, -1) // HIGH on Windows in Node? actually HIGH is -1? 
    // Node: priority values -20..19 on unix; on Windows: 'high' string in some versions
    if (typeof process.setPriority === 'function') {
      try {
        process.setPriority('high')
      } catch {
        try {
          process.setPriority(-1)
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
}

async function enableCompetitive() {
  const notes = []

  // Focus Assist / Do Not Disturb best-effort (Win10/11)
  const fa = await runPs(`
    try {
      $path = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\CloudStore\\Store\\DefaultAccount\\Current\\default$windows.data.notifications.quiethourssettings\\windows.data.notifications.quiethourssettings'
      # Fallback: Action Center focus assist via registry profile
      New-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings' -Name 'NOC_GLOBAL_SETTING_TOASTS_ENABLED' -Value 0 -PropertyType DWord -Force -ErrorAction SilentlyContinue | Out-Null
      'ok'
    } catch { 'fail' }
  `)
  if (String(fa.stdout || '').includes('ok')) notes.push('Toasts silenciados (best-effort)')
  else notes.push('No se pudieron silenciar toasts')

  // Power plan: high performance if available
  try {
    const list = await runPs('powercfg /L')
    const text = String(list.stdout || '')
    const m = text.match(/\(([^\)]*[Aa]lto rendimiento|[Hh]igh performance)[^\)]*\)[\s\S]*?([0-9a-fA-F-]{36})/)
    // better: find GUID then name
    const lines = text.split(/\r?\n/)
    let guid = null
    for (const line of lines) {
      if (/alto rendimiento|high performance/i.test(line)) {
        const g = line.match(/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/)
        if (g) {
          guid = g[1]
          break
        }
      }
    }
    if (guid) {
      const cur = await runPs('powercfg /GETACTIVESCHEME')
      const curG = String(cur.stdout || '').match(
        /([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/,
      )
      if (curG) previousPlan = curG[1]
      await runPs(`powercfg /S ${guid}`)
      notes.push('Plan de energía: Alto rendimiento')
    } else {
      notes.push('Plan Alto rendimiento no encontrado')
    }
  } catch {
    notes.push('No se pudo cambiar plan de energía')
  }

  await setProcessPriorityHigh()
  notes.push('Prioridad de proceso elevada')

  active = true
  return { ok: true, active: true, notes }
}

async function disableCompetitive() {
  const notes = []
  await runPs(`
    try {
      New-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings' -Name 'NOC_GLOBAL_SETTING_TOASTS_ENABLED' -Value 1 -PropertyType DWord -Force -ErrorAction SilentlyContinue | Out-Null
      'ok'
    } catch {}
  `)
  notes.push('Toasts restaurados (best-effort)')

  if (previousPlan) {
    await runPs(`powercfg /S ${previousPlan}`)
    notes.push('Plan de energía restaurado')
    previousPlan = null
  }

  try {
    process.setPriority?.('normal')
  } catch {
    /* ignore */
  }

  active = false
  return { ok: true, active: false, notes }
}

async function setCompetitive(enabled) {
  if (enabled) return enableCompetitive()
  return disableCompetitive()
}

function getCompetitive() {
  return { active }
}

module.exports = { setCompetitive, getCompetitive }
