/**
 * Capa multiplataforma EyedOptimizer.
 * Windows: PowerShell / PresentMon / WMI.
 * macOS / Linux: systeminformation + APIs nativas; funciones exclusivas de Windows degradan con mensaje claro.
 */
const { execFile, spawn } = require('node:child_process')
const os = require('node:os')

const platform = process.platform
const isWindows = platform === 'win32'
const isMac = platform === 'darwin'
const isLinux = platform === 'linux'

const FEATURES = {
  presentMonFps: isWindows,
  uacElevation: isWindows,
  winDrivers: isWindows,
  winFirewall: isWindows,
  winStartupRegistry: isWindows,
  winEventsBsod: isWindows,
  gameWindowPin: isWindows,
  powershellTools: isWindows,
}

function caps() {
  return {
    platform,
    isWindows,
    isMac,
    isLinux,
    arch: process.arch,
    release: os.release(),
    features: { ...FEATURES },
  }
}

function unsupported(feature, detail = '') {
  const name =
    {
      presentMonFps: 'Captura FPS (PresentMon)',
      uacElevation: 'Elevación UAC',
      winDrivers: 'Gestor de drivers',
      winFirewall: 'Firewall de Windows',
      winStartupRegistry: 'Programas al inicio (registro)',
      winEventsBsod: 'Eventos / BSOD',
      gameWindowPin: 'Anclar overlay a ventana de juego',
      powershellTools: 'Herramientas PowerShell',
    }[feature] || feature
  const osLabel = isMac ? 'macOS' : isLinux ? 'Linux' : platform
  return {
    ok: false,
    unsupported: true,
    platform,
    feature,
    message: detail || `${name} no está disponible en ${osLabel}.`,
  }
}

function runCmd(file, args = [], timeout = 20000) {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        timeout,
        maxBuffer: 1024 * 1024 * 8,
        encoding: 'utf8',
        windowsHide: true,
        env: process.env,
      },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(String(stderr || err.message || 'comando falló').trim().slice(0, 220)))
          return
        }
        resolve(String(stdout || '').trim())
      },
    )
  })
}

/** PowerShell solo en Windows. */
function runPowerShell(script, timeout = 45000) {
  if (!isWindows) {
    return Promise.reject(new Error('PowerShell solo disponible en Windows'))
  }
  return runCmd(
    'powershell.exe',
    ['-NoProfile', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-Command', script],
    timeout,
  )
}

function killProcessTree(pid) {
  const id = Number(pid) || 0
  if (!id) return false
  try {
    if (isWindows) {
      spawn('taskkill', ['/F', '/PID', String(id), '/T'], { windowsHide: true, stdio: 'ignore' })
    } else {
      try {
        process.kill(id, 'SIGTERM')
      } catch {
        try {
          process.kill(id, 'SIGKILL')
        } catch {
          /* */
        }
      }
    }
    return true
  } catch {
    return false
  }
}

/**
 * Elevación de privilegios según SO.
 * Windows: UAC via elevate.cjs
 * macOS: osascript administrator
 * Linux: pkexec / sudo (mejor esfuerzo)
 */
async function runElevated(scriptBody, timeoutMs = 120000) {
  if (isWindows) {
    const { runElevatedPs } = require('./elevate.cjs')
    return runElevatedPs(scriptBody, timeoutMs)
  }
  if (isMac) {
    const fs = require('node:fs')
    const path = require('node:path')
    const tmp = path.join(os.tmpdir(), `eyed-elev-${Date.now()}.sh`)
    fs.writeFileSync(tmp, `#!/bin/bash\n${scriptBody}\n`, { mode: 0o755 })
    try {
      const escaped = tmp.replace(/'/g, "'\\''")
      await runCmd(
        'osascript',
        ['-e', `do shell script "'${escaped}'" with administrator privileges`],
        timeoutMs,
      )
      return { ok: true, output: '', message: 'OK' }
    } catch (e) {
      return { ok: false, output: '', message: e.message || 'Se canceló la elevación' }
    } finally {
      try {
        fs.unlinkSync(tmp)
      } catch {
        /* */
      }
    }
  }
  // Linux
  try {
    const fs = require('node:fs')
    const path = require('node:path')
    const tmp = path.join(os.tmpdir(), `eyed-elev-${Date.now()}.sh`)
    fs.writeFileSync(tmp, `#!/bin/bash\n${scriptBody}\n`, { mode: 0o755 })
    try {
      await runCmd('pkexec', [tmp], timeoutMs)
      return { ok: true, output: '', message: 'OK' }
    } catch {
      await runCmd('sudo', ['-n', tmp], timeoutMs)
      return { ok: true, output: '', message: 'OK' }
    } finally {
      try {
        fs.unlinkSync(tmp)
      } catch {
        /* */
      }
    }
  } catch (e) {
    return { ok: false, output: '', message: e.message || 'Se necesitan privilegios de administrador' }
  }
}

module.exports = {
  platform,
  isWindows,
  isMac,
  isLinux,
  FEATURES,
  caps,
  unsupported,
  runCmd,
  runPowerShell,
  killProcessTree,
  runElevated,
}
