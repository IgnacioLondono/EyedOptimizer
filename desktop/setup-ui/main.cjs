const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron')
// Crítico: sin esto Electron monta *.asar como carpetas virtuales y el copiado
// del payload termina creando resources/app.asar como directorio real (ENOTDIR).
process.noAsar = true

// Arranque más rápido: menos trabajo de Chromium al abrir
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,AutofillServerCommunication')
app.commandLine.appendSwitch('disable-component-update')
app.commandLine.appendSwitch('no-proxy-server')
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')
app.commandLine.appendSwitch('disk-cache-size', '1')

const fs = require('original-fs')
const path = require('node:path')
const os = require('node:os')
const { spawn, execFile } = require('node:child_process')
const { promisify } = require('node:util')
const execFileAsync = promisify(execFile)

const PRODUCT = 'EyedOptimizer'
const APP_EXE = 'EyedOptimizer.exe'

// No dejar carpetas en AppData al abrir el Setup: todo ephemeral en TEMP
const SETUP_TEMP_ROOT = path.join(os.tmpdir(), `eyed-setup-run-${process.pid}`)
try {
  fs.mkdirSync(SETUP_TEMP_ROOT, { recursive: true })
  app.setPath('userData', path.join(SETUP_TEMP_ROOT, 'userData'))
  app.setPath('sessionData', path.join(SETUP_TEMP_ROOT, 'sessionData'))
  app.setPath('cache', path.join(SETUP_TEMP_ROOT, 'cache'))
  app.setPath('logs', path.join(SETUP_TEMP_ROOT, 'logs'))
} catch {
  /* ignore */
}

function cleanupSetupTemp() {
  try {
    fs.rmSync(SETUP_TEMP_ROOT, { recursive: true, force: true })
  } catch {
    // Borrado diferido si algo sigue abierto
    try {
      const cmd = `timeout /t 2 /nobreak >nul & rmdir /s /q "${SETUP_TEMP_ROOT}"`
      spawn('cmd.exe', ['/c', cmd], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
    } catch {
      /* ignore */
    }
  }
}

const LICENSE_FALLBACK = `EyedOptimizer
==============

Licencia de uso — EyedOptimizer

Software de monitorización y utilidades para Windows
(monitor, overlay FPS, red, discos, insights).

Uso libre para uso personal. No se garantiza
compatibilidad con todos los hardware/drivers.

Al instalar aceptas usar el software bajo tu responsabilidad.
No se ofrece garantía expresa ni implícita.

Comunidad: https://discord.gg/eN6eQdGn87
`

let mainWindow = null
let installing = false
let uninstalling = false

function isDev() {
  return !app.isPackaged
}

/** Rutas de Windows sin depender de app.getPath('localAppData') (falla en algunos builds). */
function winLocalAppData() {
  if (process.env.LOCALAPPDATA) return process.env.LOCALAPPDATA
  if (process.env.USERPROFILE) return path.join(process.env.USERPROFILE, 'AppData', 'Local')
  try {
    return app.getPath('userData')
  } catch {
    return process.cwd()
  }
}

function winAppData() {
  if (process.env.APPDATA) return process.env.APPDATA
  if (process.env.USERPROFILE) return path.join(process.env.USERPROFILE, 'AppData', 'Roaming')
  return winLocalAppData()
}

function winDesktop() {
  if (process.env.USERPROFILE) return path.join(process.env.USERPROFILE, 'Desktop')
  try {
    return app.getPath('desktop')
  } catch {
    return winLocalAppData()
  }
}

function winTemp() {
  if (process.env.TEMP) return process.env.TEMP
  if (process.env.TMP) return process.env.TMP
  try {
    return app.getPath('temp')
  } catch {
    return winLocalAppData()
  }
}

function candidatesPayloadZip() {
  const list = []
  if (process.resourcesPath) {
    list.push(path.join(process.resourcesPath, 'app-payload.zip'))
    list.push(path.join(process.resourcesPath, 'payload', 'app-payload.zip'))
  }
  list.push(path.join(path.dirname(process.execPath), 'resources', 'app-payload.zip'))
  list.push(path.join(__dirname, 'payload', 'app-payload.zip'))
  list.push(path.join(__dirname, '..', 'payload', 'app-payload.zip'))
  return list
}

function candidatesPayloadDir() {
  const list = []
  if (process.resourcesPath) {
    list.push(path.join(process.resourcesPath, 'app-payload'))
  }
  list.push(path.join(path.dirname(process.execPath), 'resources', 'app-payload'))
  list.push(path.join(__dirname, 'payload', 'app-payload'))
  return list
}

function resolvePayload() {
  for (const zip of candidatesPayloadZip()) {
    if (zip && fs.existsSync(zip)) return { kind: 'zip', path: zip }
  }
  for (const dir of candidatesPayloadDir()) {
    if (dir && fs.existsSync(path.join(dir, APP_EXE))) return { kind: 'dir', path: dir }
  }
  return null
}

function defaultInstallDir() {
  return path.join(winLocalAppData(), 'Programs', PRODUCT)
}

function iconPath() {
  const candidates = [
    path.join(__dirname, 'icon.ico'),
    path.join(__dirname, 'icon.png'),
    path.join(process.resourcesPath || '', 'icon.ico'),
  ]
  return candidates.find((p) => fs.existsSync(p)) || undefined
}

function licenseText() {
  const candidates = [
    path.join(__dirname, 'license.txt'),
    path.join(process.resourcesPath || '', 'license.txt'),
    path.join(path.dirname(process.execPath), 'license.txt'),
  ]
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) {
        const t = fs.readFileSync(p, 'utf8').trim()
        if (t) return t
      }
    } catch {
      /* ignore */
    }
  }
  return LICENSE_FALLBACK
}

function createWindow() {
  const ico = iconPath()
  mainWindow = new BrowserWindow({
    width: 980,
    height: 680,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    backgroundColor: '#000000',
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: true,
    paintWhenInitiallyHidden: false,
    icon: ico,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  })

  mainWindow.setMenuBarVisibility(false)
  mainWindow.loadFile(path.join(__dirname, 'index.html'))
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

async function getFreeSpaceGb(targetDir) {
  try {
    const drive = path.parse(targetDir).root.replace(/[:\\]/g, '')
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-Command', `(Get-PSDrive -Name '${drive}').Free`],
      { windowsHide: true, timeout: 8000 },
    )
    const bytes = Number(String(stdout).trim())
    if (!Number.isFinite(bytes) || bytes < 0) return null
    return Math.round((bytes / 1024 / 1024 / 1024) * 10) / 10
  } catch {
    return null
  }
}

function walkFiles(dir, base = dir, list = []) {
  if (!fs.existsSync(dir)) return list
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    let st
    try {
      st = fs.lstatSync(full)
    } catch {
      continue
    }
    // Nunca entrar en .asar (archivo de archivo); ni en symlinks
    if (st.isSymbolicLink()) continue
    if (st.isDirectory()) {
      if (name.endsWith('.asar')) continue
      walkFiles(full, base, list)
    } else list.push({ full, rel: path.relative(base, full), size: st.size })
  }
  return list
}

function ensureDir(p) {
  const target = path.resolve(p)
  // Quitar archivos que bloquean componentes de la ruta (causa típica de ENOTDIR)
  const parts = []
  let cur = target
  while (true) {
    parts.unshift(cur)
    const parent = path.dirname(cur)
    if (!parent || parent === cur) break
    cur = parent
  }
  for (const part of parts) {
    if (!fs.existsSync(part)) continue
    let st
    try {
      st = fs.lstatSync(part)
    } catch {
      continue
    }
    if (st.isSymbolicLink() || st.isFile()) {
      if (!forceRemove(part)) {
        throw new Error(
          `No se pudo liberar la ruta (archivo bloqueado):\n${part}\nCierra EyedOptimizer/PresentMon e inténtalo de nuevo.`,
        )
      }
    }
  }
  fs.mkdirSync(target, { recursive: true })
}

function scheduleDeferredRm(target) {
  try {
    const cmd = `timeout /t 3 /nobreak >nul & rmdir /s /q "${target}"`
    spawn('cmd.exe', ['/c', cmd], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  } catch {
    /* ignore */
  }
}

function clearReadonlyTree(target) {
  try {
    const esc = String(target).replace(/'/g, "''")
    const { execFileSync } = require('node:child_process')
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `if (Test-Path -LiteralPath '${esc}') { Get-ChildItem -LiteralPath '${esc}' -Recurse -Force -ErrorAction SilentlyContinue | ForEach-Object { try { $_.Attributes = 'Normal' } catch {} } }`,
      ],
      { windowsHide: true, timeout: 60000 },
    )
  } catch {
    /* ignore */
  }
}

function forceRemove(p) {
  if (!p || !fs.existsSync(p)) return true
  const target = path.resolve(p)
  const tryRm = () => fs.rmSync(target, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 })
  try {
    tryRm()
    return true
  } catch {
    /* retry after clearing readonly */
  }
  clearReadonlyTree(target)
  try {
    const esc = String(target).replace(/'/g, "''")
    const { execFileSync } = require('node:child_process')
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Remove-Item -LiteralPath '${esc}' -Recurse -Force -ErrorAction SilentlyContinue`,
      ],
      { windowsHide: true, timeout: 60000 },
    )
  } catch {
    /* ignore */
  }
  try {
    tryRm()
    return true
  } catch {
    return false
  }
}

/** Vacía contenido lo que se pueda (PresentMon u otros locks). */
function clearDirBestEffort(dir) {
  if (!fs.existsSync(dir)) return
  let entries = []
  try {
    entries = fs.readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    const full = path.join(dir, name)
    try {
      const st = fs.lstatSync(full)
      if (st.isDirectory() && !st.isSymbolicLink()) {
        clearDirBestEffort(full)
        try {
          fs.rmdirSync(full)
        } catch {
          /* locked */
        }
      } else {
        try {
          fs.chmodSync(full, 0o666)
        } catch {
          /* ignore */
        }
        try {
          fs.unlinkSync(full)
        } catch {
          try {
            const junk = `${full}.old-${Date.now()}`
            fs.renameSync(full, junk)
            scheduleDeferredRm(junk)
          } catch {
            /* leave locked file; copyFile will overwrite later */
          }
        }
      }
    } catch {
      /* ignore */
    }
  }
}

/**
 * Prepara destino sin fallar por EPERM (carpeta bloqueada por PresentMon / antivirus).
 * Si no se puede borrar: renombra a .old-* o limpia contenido best-effort.
 */
function prepareInstallDir(dest) {
  const target = path.resolve(dest)
  if (fs.existsSync(target)) {
    let st
    try {
      st = fs.lstatSync(target)
    } catch (err) {
      throw new Error(`No se pudo acceder a la carpeta de instalación: ${err?.message || err}`)
    }
    if (st.isFile() || st.isSymbolicLink()) {
      if (!forceRemove(target)) {
        throw new Error(
          `Hay un archivo bloqueando la ruta de instalación:\n${target}\nCierra EyedOptimizer/PresentMon e inténtalo de nuevo.`,
        )
      }
    } else if (st.isDirectory()) {
      if (!forceRemove(target)) {
        // Carpeta bloqueada (típico: PresentMon.exe): moverla y crear limpia
        const junk = `${target}.old-${Date.now()}`
        try {
          clearReadonlyTree(target)
          fs.renameSync(target, junk)
          scheduleDeferredRm(junk)
        } catch {
          clearDirBestEffort(target)
        }
      }
    }
  }
  try {
    ensureDir(target)
  } catch (err) {
    const code = err?.code || ''
    if (code === 'EPERM' || code === 'EACCES' || code === 'EBUSY') {
      throw new Error(
        `Permiso denegado en:\n${target}\nCierra EyedOptimizer, PresentMon y otros Setup abiertos, luego vuelve a instalar.`,
      )
    }
    throw err
  }
  return target
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function copyFile(src, dest) {
  const target = path.resolve(dest)
  ensureDir(path.dirname(target))

  const tryCopy = () => {
    if (fs.existsSync(target)) forceRemove(target)
    fs.copyFileSync(src, target)
  }

  try {
    tryCopy()
    return { ok: true }
  } catch (err) {
    const code = err?.code
    if (code !== 'EBUSY' && code !== 'EPERM' && code !== 'EACCES') throw err
  }

  // Archivo bloqueado: renombrar el viejo y copiar encima
  try {
    if (fs.existsSync(target)) {
      const junk = `${target}.old-${Date.now()}`
      try {
        fs.renameSync(target, junk)
        scheduleDeferredRm(junk)
      } catch {
        forceRemove(target)
      }
    }
    fs.copyFileSync(src, target)
    return { ok: true }
  } catch (err) {
    const code = err?.code || ''
    const base = path.basename(target).toLowerCase()
    // PresentMon suele quedar elevado y bloquear; no tumbar toda la instalación
    if (
      (code === 'EPERM' || code === 'EACCES' || code === 'EBUSY') &&
      (base.includes('presentmon') || base.endsWith('.pdb'))
    ) {
      return { ok: false, skipped: true, reason: err?.message || String(err) }
    }
    throw err
  }
}

async function killImage(imageName) {
  try {
    await execFileAsync('taskkill', ['/F', '/IM', imageName, '/T'], {
      windowsHide: true,
      timeout: 10000,
    })
  } catch {
    /* no estaba en ejecución */
  }
}

async function killAppProcesses() {
  // PresentMon / servicio suelen bloquear resources\tools\PresentMon.exe (EBUSY/EPERM)
  try {
    await execFileAsync('sc.exe', ['stop', 'PresentMonService'], {
      windowsHide: true,
      timeout: 10000,
    })
  } catch {
    /* ignore */
  }
  const images = [APP_EXE, 'PresentMon.exe', 'PresentMonService.exe']
  for (const img of images) {
    await killImage(img)
  }
  // Por si el servicio no responde a taskkill /IM
  try {
    await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Get-Service -Name '*PresentMon*' -ErrorAction SilentlyContinue | Stop-Service -Force -ErrorAction SilentlyContinue; Get-Process -Name 'PresentMon','PresentMonService','EyedOptimizer' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue`,
      ],
      { windowsHide: true, timeout: 15000 },
    )
  } catch {
    /* ignore */
  }
  await sleep(1200)
}

async function extractZip(zipPath, destDir) {
  ensureDir(destDir)
  // Preferir tar: trata app.asar como archivo; Expand-Archive como fallback
  try {
    await execFileAsync('tar', ['-xf', zipPath, '-C', destDir], {
      windowsHide: true,
      timeout: 600000,
    })
    return
  } catch {
    /* fallback powershell */
  }
  const ps = `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`
  await execFileAsync('powershell.exe', ['-NoProfile', '-Command', ps], {
    windowsHide: true,
    timeout: 600000,
  })
}

function parseArgs(argv) {
  const out = { uninstall: false, dir: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--uninstall' || a === '/uninstall') out.uninstall = true
    if ((a === '--dir' || a === '/dir') && argv[i + 1]) out.dir = argv[++i]
  }
  return out
}

const cliArgs = parseArgs(process.argv.slice(1))

function resolveInstallDirForUninstall() {
  if (cliArgs.dir) {
    try {
      return path.resolve(cliArgs.dir)
    } catch {
      /* ignore */
    }
  }
  const candidates = [defaultInstallDir()]
  try {
    const meta = path.join(defaultInstallDir(), 'install.json')
    if (fs.existsSync(meta)) {
      const j = JSON.parse(fs.readFileSync(meta, 'utf8'))
      if (j?.installDir) candidates.unshift(path.resolve(j.installDir))
    }
  } catch {
    /* ignore */
  }
  for (const d of candidates) {
    if (fs.existsSync(path.join(d, APP_EXE)) || fs.existsSync(d)) return d
  }
  return defaultInstallDir()
}

function setupHostPath() {
  // Portable de electron-builder: ruta estable al .exe que abrió el usuario
  const portable = process.env.PORTABLE_EXECUTABLE_FILE
  if (portable && fs.existsSync(portable)) return portable
  return process.execPath
}

function writeSilentUninstallPs1(installDir) {
  const psPath = path.join(installDir, 'uninstall-silent.ps1')
  const ps = `# EyedOptimizer silent uninstall
$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Get-Process EyedOptimizer -ErrorAction SilentlyContinue | Stop-Process -Force
$desktop = [Environment]::GetFolderPath('Desktop')
$programs = Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs'
Remove-Item (Join-Path $desktop 'EyedOptimizer.lnk') -Force
Remove-Item (Join-Path $programs 'EyedOptimizer.lnk') -Force
Remove-Item (Join-Path $programs 'Desinstalar EyedOptimizer.lnk') -Force
Remove-Item 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\EyedOptimizer' -Recurse -Force
$cmd = 'timeout /t 1 /nobreak >nul & rmdir /s /q "' + $root + '"'
Start-Process cmd.exe -ArgumentList '/c', $cmd -WindowStyle Hidden
`
  fs.writeFileSync(psPath, ps, 'utf8')
  return psPath
}

function writeLocalUninstaller(installDir) {
  const setupExe = setupHostPath()
  const cmdPath = path.join(installDir, 'Uninstall EyedOptimizer.cmd')
  const silentPs = writeSilentUninstallPs1(installDir)
  // Preferir UI del Setup; si el Setup ya no está, fallback silencioso
  const cmd = `@echo off\r\nif exist "${setupExe}" (\r\n  start "" "${setupExe}" --uninstall --dir "${installDir}"\r\n  exit /b 0\r\n)\r\npowershell -NoProfile -ExecutionPolicy Bypass -File "${silentPs}"\r\n`
  fs.writeFileSync(cmdPath, cmd, 'utf8')

  try {
    const programs = path.join(winAppData(), 'Microsoft', 'Windows', 'Start Menu', 'Programs')
    ensureDir(programs)
    const ico = path.join(installDir, 'resources', 'icon.ico')
    const icon = fs.existsSync(ico) ? ico : path.join(installDir, APP_EXE)
    if (fs.existsSync(setupExe)) {
      shell.writeShortcutLink(path.join(programs, `Desinstalar ${PRODUCT}.lnk`), {
        target: setupExe,
        args: `--uninstall --dir "${installDir}"`,
        cwd: path.dirname(setupExe),
        icon,
        iconIndex: 0,
        description: `Desinstalar ${PRODUCT}`,
      })
    } else {
      shell.writeShortcutLink(path.join(programs, `Desinstalar ${PRODUCT}.lnk`), {
        target: cmdPath,
        cwd: installDir,
        icon,
        iconIndex: 0,
        description: `Desinstalar ${PRODUCT}`,
      })
    }
  } catch {
    /* ignore */
  }
  return cmdPath
}

async function writeUninstallEntry(installDir, exePath) {
  const setupExe = setupHostPath()
  const cmdPath = path.join(installDir, 'Uninstall EyedOptimizer.cmd')
  const uninstallString = fs.existsSync(setupExe)
    ? `"${setupExe}" --uninstall --dir "${installDir}"`
    : `"${cmdPath}"`
  const quietString = `"${cmdPath}"`
  const displayIcon = fs.existsSync(path.join(installDir, 'resources', 'icon.ico'))
    ? path.join(installDir, 'resources', 'icon.ico')
    : exePath

  let estimatedKb = 1
  try {
    const files = walkFiles(installDir)
    estimatedKb = Math.max(1, Math.round(files.reduce((a, f) => a + f.size, 0) / 1024))
  } catch {
    /* ignore */
  }

  const esc = (s) => String(s).replace(/'/g, "''")
  const ps = `
$ErrorActionPreference = 'Stop'
$path = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${PRODUCT}'
New-Item -Path $path -Force | Out-Null
Set-ItemProperty -Path $path -Name 'DisplayName' -Value '${PRODUCT}'
Set-ItemProperty -Path $path -Name 'DisplayVersion' -Value '${app.getVersion()}'
Set-ItemProperty -Path $path -Name 'Publisher' -Value 'EyedOptimizer'
Set-ItemProperty -Path $path -Name 'InstallLocation' -Value '${esc(installDir)}'
Set-ItemProperty -Path $path -Name 'DisplayIcon' -Value '${esc(displayIcon)}'
Set-ItemProperty -Path $path -Name 'UninstallString' -Value '${esc(uninstallString)}'
Set-ItemProperty -Path $path -Name 'QuietUninstallString' -Value '${esc(quietString)}'
Set-ItemProperty -Path $path -Name 'NoModify' -Type DWord -Value 1
Set-ItemProperty -Path $path -Name 'NoRepair' -Type DWord -Value 1
Set-ItemProperty -Path $path -Name 'EstimatedSize' -Type DWord -Value ${estimatedKb}
`
  await execFileAsync('powershell.exe', ['-NoProfile', '-Command', ps], {
    windowsHide: true,
    timeout: 15000,
  })
}

async function uninstallApp(installDir) {
  if (uninstalling) return { ok: false, message: 'Desinstalación en curso' }
  uninstalling = true
  const dir = path.resolve(installDir || resolveInstallDirForUninstall())
  try {
    send('setup:progress', { phase: 'uninstall', percent: 8, message: 'Cerrando EyedOptimizer…' })
    await killAppProcesses()

    send('setup:progress', { phase: 'uninstall', percent: 25, message: 'Quitando accesos directos…' })
    const desk = path.join(winDesktop(), `${PRODUCT}.lnk`)
    const start = path.join(winAppData(), 'Microsoft', 'Windows', 'Start Menu', 'Programs', `${PRODUCT}.lnk`)
    const startUn = path.join(
      winAppData(),
      'Microsoft',
      'Windows',
      'Start Menu',
      'Programs',
      `Desinstalar ${PRODUCT}.lnk`,
    )
    for (const p of [desk, start, startUn]) {
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p)
      } catch {
        /* ignore */
      }
    }

    send('setup:progress', { phase: 'uninstall', percent: 45, message: 'Limpiando registro…' })
    try {
      const ps = `Remove-Item -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${PRODUCT}' -Recurse -Force -ErrorAction SilentlyContinue`
      await execFileAsync('powershell.exe', ['-NoProfile', '-Command', ps], {
        windowsHide: true,
        timeout: 10000,
      })
    } catch {
      /* ignore */
    }

    send('setup:progress', { phase: 'uninstall', percent: 70, message: 'Eliminando archivos…' })
    if (fs.existsSync(dir)) {
      const runningInside = path
        .resolve(process.execPath)
        .toLowerCase()
        .startsWith(dir.toLowerCase() + path.sep)
      if (runningInside) {
        const cmd = `timeout /t 2 /nobreak >nul & rmdir /s /q "${dir}"`
        spawn('cmd.exe', ['/c', cmd], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
      } else {
        fs.rmSync(dir, { recursive: true, force: true })
      }
    }

    send('setup:progress', { phase: 'done', percent: 100, message: 'Desinstalado' })
    uninstalling = false
    return { ok: true, installDir: dir }
  } catch (err) {
    uninstalling = false
    send('setup:progress', { phase: 'error', percent: 0, message: err?.message || String(err) })
    return { ok: false, message: err?.message || String(err) }
  }
}

async function installApp(options) {
  if (installing) return { ok: false, message: 'Instalación en curso' }
  installing = true

  const dest = options?.installDir || defaultInstallDir()
  const desktopShortcut = options?.desktopShortcut !== false
  const startMenuShortcut = options?.startMenuShortcut !== false
  const payload = resolvePayload()

  try {
    if (!payload) {
      throw new Error(
        'No se encontró el paquete de la aplicación (app-payload). Vuelve a generar el Setup con npm run dist.',
      )
    }

    await killAppProcesses()
    send('setup:progress', { phase: 'extract', percent: 3, message: 'Preparando carpeta…' })
    prepareInstallDir(dest)

    send('setup:progress', { phase: 'extract', percent: 5, message: 'Extrayendo archivos…' })

    let sourceDir = payload.path
    let tempExtract = null

    if (payload.kind === 'zip') {
      tempExtract = path.join(winTemp(), `eyed-setup-${Date.now()}`)
      forceRemove(tempExtract)
      ensureDir(tempExtract)
      send('setup:progress', { phase: 'extract', percent: 12, message: 'Descomprimiendo paquete…' })
      await extractZip(payload.path, tempExtract)

      // zip puede contener win-unpacked root o archivos sueltos
      if (fs.existsSync(path.join(tempExtract, APP_EXE))) {
        sourceDir = tempExtract
      } else {
        const kids = fs.readdirSync(tempExtract)
        const nested = kids
          .map((k) => path.join(tempExtract, k))
          .find((p) => fs.existsSync(path.join(p, APP_EXE)))
        if (!nested) throw new Error('El paquete ZIP no contiene EyedOptimizer.exe')
        sourceDir = nested
      }
      send('setup:progress', { phase: 'extract', percent: 40, message: 'Paquete listo…' })
    }

    if (!fs.existsSync(path.join(sourceDir, APP_EXE))) {
      throw new Error('EyedOptimizer.exe no está en el paquete')
    }

    // Con original-fs / noAsar, app.asar debe ser un archivo real
    const asarPath = path.join(sourceDir, 'resources', 'app.asar')
    if (fs.existsSync(asarPath)) {
      const st = fs.lstatSync(asarPath)
      if (st.isDirectory()) {
        throw new Error(
          'El paquete está corrupto (resources/app.asar es una carpeta real). Vuelve a generar el Setup.',
        )
      }
    }

    const files = walkFiles(sourceDir).filter((f) => {
      // Evitar rutas que escapen del destino
      const rel = f.rel.replace(/\\/g, '/')
      return rel && !rel.startsWith('../') && !path.isAbsolute(f.rel)
    })
    const totalBytes = files.reduce((a, f) => a + (f.size || 0), 0) || 1
    let doneBytes = 0

    send('setup:progress', { phase: 'copy', percent: 45, message: 'Copiando archivos…' })
    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      const out = path.join(dest, f.rel)
      try {
        const copied = copyFile(f.full, out)
        if (copied?.skipped) {
          // PresentMon bloqueado: continuar; FPS puede necesitar reinicio
        }
      } catch (err) {
        const code = err?.code || ''
        const msg = err?.message || String(err)
        if (code === 'EPERM' || code === 'EACCES' || /EPERM|Permission denied/i.test(msg)) {
          throw new Error(
            `Permiso denegado al copiar ${f.rel}.\nCierra EyedOptimizer, PresentMon y otros instaladores abiertos, luego reintenta.\n\n${msg}`,
          )
        }
        throw new Error(
          `No se pudo copiar ${f.rel}${code ? ` (${code})` : ''}: ${msg}`,
        )
      }
      doneBytes += f.size || 0
      if (i % 10 === 0 || i === files.length - 1) {
        const percent = 45 + Math.round((doneBytes / totalBytes) * 50)
        send('setup:progress', {
          phase: 'copy',
          percent: Math.min(95, percent),
          message: `Copiando… ${i + 1}/${files.length}`,
        })
      }
    }

    if (tempExtract) {
      try {
        fs.rmSync(tempExtract, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }

    send('setup:progress', { phase: 'shortcuts', percent: 96, message: 'Accesos directos…' })
    const exePath = path.join(dest, APP_EXE)
    const ico = path.join(dest, 'resources', 'icon.ico')
    const icon = fs.existsSync(ico) ? ico : exePath

    if (desktopShortcut) {
      try {
        shell.writeShortcutLink(path.join(winDesktop(), `${PRODUCT}.lnk`), {
          target: exePath,
          cwd: dest,
          icon,
          iconIndex: 0,
          description: PRODUCT,
        })
      } catch {
        /* ignore */
      }
    }
    if (startMenuShortcut) {
      try {
        const programs = path.join(winAppData(), 'Microsoft', 'Windows', 'Start Menu', 'Programs')
        ensureDir(programs)
        shell.writeShortcutLink(path.join(programs, `${PRODUCT}.lnk`), {
          target: exePath,
          cwd: dest,
          icon,
          iconIndex: 0,
          description: PRODUCT,
        })
      } catch {
        /* ignore */
      }
    }

    send('setup:progress', { phase: 'registry', percent: 99, message: 'Registrando…' })
    writeLocalUninstaller(dest)
    await writeUninstallEntry(dest, exePath)

    try {
      fs.writeFileSync(
        path.join(dest, 'install.json'),
        JSON.stringify(
          {
            product: PRODUCT,
            version: app.getVersion(),
            installedAt: new Date().toISOString(),
            installDir: dest,
            setupExe: setupHostPath(),
          },
          null,
          2,
        ),
        'utf8',
      )
    } catch {
      /* ignore */
    }

    send('setup:progress', { phase: 'done', percent: 100, message: 'Listo' })
    installing = false
    return { ok: true, installDir: dest, exePath }
  } catch (err) {
    installing = false
    send('setup:progress', { phase: 'error', percent: 0, message: err?.message || String(err) })
    return { ok: false, message: err?.message || String(err) }
  }
}

app.whenReady().then(() => {
  createWindow()
})

app.on('window-all-closed', () => {
  cleanupSetupTemp()
  app.quit()
})

app.on('will-quit', () => {
  cleanupSetupTemp()
})

app.on('quit', () => {
  cleanupSetupTemp()
})

ipcMain.handle('setup:getInfo', async () => {
  const mode = cliArgs.uninstall ? 'uninstall' : 'install'
  // Rápido: sin PowerShell de disco ni lectura pesada de licencia al boot
  try {
    const installDir = mode === 'uninstall' ? resolveInstallDirForUninstall() : defaultInstallDir()
    const payload = mode === 'uninstall' ? null : resolvePayload()
    return {
      product: PRODUCT,
      version: app.getVersion(),
      mode,
      installDir,
      freeGb: null,
      payloadOk: mode === 'uninstall' ? true : !!payload,
      payloadKind: payload?.kind || null,
      license: '',
      installed: fs.existsSync(path.join(installDir, APP_EXE)),
    }
  } catch (err) {
    return {
      product: PRODUCT,
      version: app.getVersion(),
      mode,
      installDir: mode === 'uninstall' ? resolveInstallDirForUninstall() : defaultInstallDir(),
      freeGb: null,
      payloadOk: mode === 'uninstall' ? true : !!resolvePayload(),
      payloadKind: null,
      license: '',
      installed: false,
      warning: err?.message || String(err),
    }
  }
})

ipcMain.handle('setup:getLicense', async () => ({ license: licenseText() }))

ipcMain.handle('setup:diskSpace', async (_e, dir) => {
  const target = dir || defaultInstallDir()
  return { freeGb: await getFreeSpaceGb(target) }
})

ipcMain.handle('setup:pickDir', async (_e, current) => {
  try {
    const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
    if (parent) {
      try {
        parent.setAlwaysOnTop(false)
        parent.focus()
      } catch {
        /* ignore */
      }
    }
    const opts = {
      title: 'Carpeta de instalación',
      defaultPath: current || defaultInstallDir() || winLocalAppData(),
      properties: ['openDirectory', 'createDirectory'],
    }
    const res = parent
      ? await dialog.showOpenDialog(parent, opts)
      : await dialog.showOpenDialog(opts)
    if (res.canceled || !res.filePaths?.[0]) return null
    const chosen = res.filePaths[0]
    const base = path.basename(chosen).toLowerCase()
    if (base === PRODUCT.toLowerCase()) return chosen
    return path.join(chosen, PRODUCT)
  } catch (err) {
    return { error: err?.message || String(err) }
  }
})

ipcMain.handle('setup:install', async (_e, options) => installApp(options || {}))

ipcMain.handle('setup:uninstall', async (_e, options) =>
  uninstallApp(options?.installDir || resolveInstallDirForUninstall()),
)

ipcMain.handle('setup:launch', async (_e, exePath) => {
  const target = exePath || path.join(defaultInstallDir(), APP_EXE)
  if (!fs.existsSync(target)) return { ok: false, message: 'No se encontró EyedOptimizer.exe' }
  try {
    spawn(target, [], { detached: true, cwd: path.dirname(target), stdio: 'ignore' }).unref()
    return { ok: true }
  } catch (err) {
    return { ok: false, message: err?.message || String(err) }
  }
})

ipcMain.handle('setup:close', () => {
  app.quit()
  return true
})

ipcMain.handle('setup:minimize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize()
  return true
})
