/**
 * Build EyedOptimizer Setup (UI custom + payload zip + portable).
 * Portable: no instala helper en Programs (no carpeta permanente al abrir).
 * userData del Setup va a TEMP y se limpia al cerrar.
 */
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const SETUP = path.join(ROOT, 'setup-ui')
const RELEASE = path.join(ROOT, 'release')
const UNPACKED = path.join(RELEASE, 'win-unpacked')
const PAYLOAD_DIR = path.join(SETUP, 'payload')
const PAYLOAD_ZIP = path.join(PAYLOAD_DIR, 'app-payload.zip')
const DESKTOP_OUT = process.env.SETUP_OUT || path.join(process.env.USERPROFILE || '', 'Desktop', 'App')

function run(cmd, args, cwd) {
  console.log(`\n> ${cmd} ${args.join(' ')}`)
  const r = spawnSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    shell: true,
    env: process.env,
  })
  if (r.status !== 0) {
    throw new Error(`Command failed (${r.status}): ${cmd} ${args.join(' ')}`)
  }
}

function rmrf(p) {
  if (!fs.existsSync(p)) return
  try {
    fs.rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  } catch (err) {
    const code = err?.code || ''
    if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') throw err
    // Carpeta en uso: renombrar y seguir (electron-builder crea una nueva)
    const junk = `${p}.old-${Date.now()}`
    try {
      fs.renameSync(p, junk)
    } catch {
      throw err
    }
  }
}

function copyRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name)
    const d = path.join(dest, name)
    const st = fs.statSync(s)
    if (st.isDirectory()) copyRecursive(s, d)
    else fs.copyFileSync(s, d)
  }
}

function readVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  return pkg.version || '0.0.0'
}

function syncSetupVersion(version) {
  const pkgPath = path.join(SETUP, 'package.json')
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  pkg.version = version
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
}

function ensureIcons() {
  const srcPng = path.join(ROOT, 'build', 'icon.png')
  const srcIco = path.join(ROOT, 'build', 'icon.ico')
  if (!fs.existsSync(srcPng) || !fs.existsSync(srcIco)) {
    throw new Error('Faltan build/icon.png o build/icon.ico')
  }
  fs.copyFileSync(srcPng, path.join(SETUP, 'icon.png'))
  fs.copyFileSync(srcIco, path.join(SETUP, 'icon.ico'))
}

function ensureLicense() {
  const src = path.join(ROOT, 'build', 'license.txt')
  const dest = path.join(SETUP, 'license.txt')
  if (fs.existsSync(src)) fs.copyFileSync(src, dest)
  else {
    fs.writeFileSync(
      dest,
      'EyedOptimizer — uso personal.\nComunidad: https://discord.gg/eN6eQdGn87\n',
      'utf8',
    )
  }
}

function zipPayload() {
  fs.mkdirSync(PAYLOAD_DIR, { recursive: true })
  rmrf(PAYLOAD_ZIP)
  console.log(`\nZipping payload → ${PAYLOAD_ZIP}`)

  // Prefer tar (Windows 10+); zip contents are files at root of archive
  const tar = spawnSync(
    'tar',
    ['-a', '-cf', PAYLOAD_ZIP, '-C', UNPACKED, '.'],
    { stdio: 'inherit', windowsHide: true },
  )
  if (tar.status === 0 && fs.existsSync(PAYLOAD_ZIP)) {
    console.log(`ZIP ok (${(fs.statSync(PAYLOAD_ZIP).size / 1024 / 1024).toFixed(1)} MB)`)
    return
  }

  // Fallback PowerShell
  const ps = `Compress-Archive -Path '${UNPACKED.replace(/'/g, "''")}\\*' -DestinationPath '${PAYLOAD_ZIP.replace(/'/g, "''")}' -Force`
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], {
    stdio: 'inherit',
    windowsHide: true,
  })
  if (r.status !== 0 || !fs.existsSync(PAYLOAD_ZIP)) {
    throw new Error('No se pudo crear app-payload.zip')
  }
  console.log(`ZIP ok (${(fs.statSync(PAYLOAD_ZIP).size / 1024 / 1024).toFixed(1)} MB)`)
}

function main() {
  const version = readVersion()
  console.log(`EyedOptimizer Setup build v${version}`)

  ensureIcons()
  ensureLicense()
  syncSetupVersion(version)

  run('npm', ['run', 'build'], ROOT)

  // Si win-unpacked está bloqueado (app abierta), empaquetar en carpeta nueva
  let releaseOut = path.join(ROOT, 'release')
  let unpacked = path.join(releaseOut, 'win-unpacked')
  try {
    rmrf(unpacked)
  } catch {
    releaseOut = path.join(ROOT, `release-build-${Date.now()}`)
    unpacked = path.join(releaseOut, 'win-unpacked')
    console.log(`win-unpacked bloqueado → usando ${releaseOut}`)
  }

  run('npx', ['electron-builder', '--win', 'dir', `--config.directories.output=${releaseOut}`], ROOT)

  if (!fs.existsSync(path.join(unpacked, 'EyedOptimizer.exe'))) {
    throw new Error(`No se generó ${unpacked}`)
  }

  rmrf(PAYLOAD_DIR)
  // zip desde la carpeta unpacked efectiva
  fs.mkdirSync(PAYLOAD_DIR, { recursive: true })
  rmrf(PAYLOAD_ZIP)
  console.log(`\nZipping payload → ${PAYLOAD_ZIP}`)
  const tar = spawnSync('tar', ['-a', '-cf', PAYLOAD_ZIP, '-C', unpacked, '.'], {
    stdio: 'inherit',
    windowsHide: true,
  })
  if (tar.status !== 0 || !fs.existsSync(PAYLOAD_ZIP)) {
    const ps = `Compress-Archive -Path '${unpacked.replace(/'/g, "''")}\\*' -DestinationPath '${PAYLOAD_ZIP.replace(/'/g, "''")}' -Force`
    const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], {
      stdio: 'inherit',
      windowsHide: true,
    })
    if (r.status !== 0 || !fs.existsSync(PAYLOAD_ZIP)) {
      throw new Error('No se pudo crear app-payload.zip')
    }
  }
  console.log(`ZIP ok (${(fs.statSync(PAYLOAD_ZIP).size / 1024 / 1024).toFixed(1)} MB)`)

  if (!fs.existsSync(path.join(SETUP, 'node_modules', 'electron'))) {
    run('npm', ['install', '--no-save', 'electron@^43.2.0', 'electron-builder@^26.15.3'], SETUP)
  }

  const setupOut = path.join(SETUP, 'dist-setup')
  try {
    rmrf(setupOut)
  } catch {
    /* continue; electron-builder sobrescribe artefacto */
  }
  run(
    'npx',
    ['electron-builder', '--win', 'portable', `--config.directories.output=${setupOut}`],
    SETUP,
  )

  const artifact = path.join(setupOut, `EyedOptimizer-Setup-${version}.exe`)
  if (!fs.existsSync(artifact)) {
    const found = fs.existsSync(setupOut)
      ? fs.readdirSync(setupOut).filter((f) => f.endsWith('.exe'))
      : []
    throw new Error(`Setup.exe no generado. Encontrados: ${found.join(', ') || '(ninguno)'}`)
  }

  fs.mkdirSync(DESKTOP_OUT, { recursive: true })
  const dest = path.join(DESKTOP_OUT, `EyedOptimizer-Setup-${version}.exe`)
  fs.copyFileSync(artifact, dest)

  const unpackedDest = path.join(DESKTOP_OUT, 'win-unpacked')
  try {
    rmrf(unpackedDest)
  } catch {
    /* ignore */
  }
  try {
    copyRecursive(unpacked, unpackedDest)
  } catch (err) {
    console.warn('No se pudo copiar win-unpacked al Desktop:', err?.message || err)
  }

  console.log(`\nOK → ${dest}`)
  console.log(`Size: ${(fs.statSync(dest).size / 1024 / 1024).toFixed(1)} MB`)
}

main()
