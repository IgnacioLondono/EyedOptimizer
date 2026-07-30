const $ = (id) => document.getElementById(id)

const views = {
  welcome: $('viewWelcome'),
  location: $('viewLocation'),
  license: $('viewLicense'),
  unWelcome: $('viewUnWelcome'),
  progress: $('viewProgress'),
  done: $('viewDone'),
  error: $('viewError'),
}

const STEP_ORDER = ['welcome', 'location', 'license', 'progress']
const STEP_ORDER_UN = ['unWelcome', 'progress']

let info = {
  installDir: '',
  freeGb: null,
  version: '',
  payloadOk: false,
  license: '',
  mode: 'install',
  installed: false,
}
let exePath = ''
let offProgress = null

function isUninstall() {
  return info.mode === 'uninstall'
}

function show(name) {
  Object.entries(views).forEach(([key, el]) => {
    if (!el) return
    el.classList.toggle('hidden', key !== name)
  })

  const dotsInstall = $('stepDots')
  const dotsUn = $('stepDotsUn')
  if (dotsInstall && dotsUn) {
    dotsInstall.classList.toggle('hidden', isUninstall())
    dotsUn.classList.toggle('hidden', !isUninstall())
  }

  const order = isUninstall() ? STEP_ORDER_UN : STEP_ORDER
  const dotsRoot = isUninstall() ? dotsUn : dotsInstall
  const mapped =
    name === 'done' || name === 'error' ? 'progress' : name === 'unWelcome' ? 'unWelcome' : name

  dotsRoot?.querySelectorAll('span').forEach((dot) => {
    const step = dot.getAttribute('data-step')
    const idx = order.indexOf(step)
    const cur = order.indexOf(mapped)
    dot.classList.toggle('on', step === mapped || (name === 'done' && step === 'progress'))
    dot.classList.toggle('done', idx >= 0 && cur >= 0 && idx < cur)
  })

  if (name === 'license') {
    void (async () => {
      if (!info.license) {
        try {
          const res = await window.setup.getLicense()
          info.license = res?.license || ''
        } catch {
          /* ignore */
        }
      }
      $('licenseBox').textContent = info.license || 'Licencia no disponible.'
    })()
  }
}

function setPath(dir) {
  info.installDir = dir || info.installDir
  if ($('inputDir')) $('inputDir').value = info.installDir || ''
  if ($('footPath')) $('footPath').textContent = info.installDir || '—'
  if ($('unPathPreview')) $('unPathPreview').textContent = info.installDir || '—'
}

async function refreshDisk() {
  try {
    const res = await window.setup.diskSpace(info.installDir)
    info.freeGb = res?.freeGb ?? null
  } catch {
    info.freeGb = null
  }
  $('freeSpace').textContent =
    info.freeGb != null
      ? `${info.freeGb} GB disponibles en la unidad`
      : 'Espacio en disco no disponible'
}

function setProgress(p) {
  const pct = Math.max(0, Math.min(100, Number(p.percent) || 0))
  $('progressFill').style.width = `${pct}%`
  $('progressPct').textContent = `${pct}%`
  $('progressMsg').textContent =
    p.message || (isUninstall() ? 'Desinstalando…' : 'Instalando…')
}

function showDoneUninstall() {
  $('doneTitle').textContent = 'Desinstalación lista.'
  $('doneOpts')?.classList.add('hidden')
  $('doneUnMsg')?.classList.remove('hidden')
  $('btnDoneLaunch')?.classList.add('hidden')
  $('btnDoneClose').textContent = 'CERRAR'
  $('viewDone')?.classList.add('centered')
  show('done')
}

function showDoneInstall() {
  $('doneTitle').textContent = 'Instalación ya hecha.'
  $('doneOpts')?.classList.remove('hidden')
  $('doneUnMsg')?.classList.add('hidden')
  $('btnDoneLaunch')?.classList.remove('hidden')
  $('btnDoneClose').textContent = 'CERRAR'
  $('viewDone')?.classList.remove('centered')
  show('done')
}

async function boot() {
  try {
    info = await window.setup.getInfo()
  } catch (err) {
    $('errorMsg').textContent = err?.message || 'No se pudo iniciar el asistente'
    show('error')
    return
  }

  setPath(info.installDir)
  const modeLabel = isUninstall() ? 'Uninstall' : 'Setup'
  $('footVer').textContent = info.version
    ? `EyedOptimizer ${modeLabel} v${info.version}`
    : ''
  document.title = isUninstall() ? 'EyedOptimizer Uninstall' : 'EyedOptimizer Setup'
  if ($('footLabel')) $('footLabel').textContent = isUninstall() ? 'Carpeta:' : 'Destino:'

  if (isUninstall()) {
    show('unWelcome')
    return
  }

  if (!info.payloadOk) {
    $('errorMsg').textContent =
      'No se encontró el paquete de la aplicación dentro del Setup. Vuelve a generar el instalador con npm run dist.'
    show('error')
    return
  }
  show('welcome')
}

async function startInstall() {
  if (!$('chkAccept').checked) return
  if (!info.installDir) {
    $('errorMsg').textContent = 'Elige una carpeta de instalación primero.'
    show('error')
    return
  }

  $('progressTitle').textContent = 'Instalando…'
  show('progress')
  setProgress({ percent: 0, message: 'Preparando…' })

  if (offProgress) offProgress()
  offProgress = window.setup.onProgress((p) => setProgress(p))

  const result = await window.setup.install({
    installDir: info.installDir,
    desktopShortcut: !!$('chkDesktop')?.checked,
    startMenuShortcut: !!$('chkStart')?.checked,
  })

  if (offProgress) {
    offProgress()
    offProgress = null
  }

  if (!result?.ok) {
    $('errorMsg').textContent = result?.message || 'La instalación falló'
    show('error')
    return
  }

  exePath = result.exePath || ''
  setPath(result.installDir || info.installDir)
  showDoneInstall()
}

async function startUninstall() {
  $('progressTitle').textContent = 'Desinstalando…'
  show('progress')
  setProgress({ percent: 0, message: 'Preparando…' })

  if (offProgress) offProgress()
  offProgress = window.setup.onProgress((p) => setProgress(p))

  const result = await window.setup.uninstall({ installDir: info.installDir })

  if (offProgress) {
    offProgress()
    offProgress = null
  }

  if (!result?.ok) {
    $('errorMsg').textContent = result?.message || 'La desinstalación falló'
    show('error')
    return
  }

  showDoneUninstall()
}

$('btnClose').addEventListener('click', () => void window.setup.close())
$('btnMin').addEventListener('click', () => void window.setup.minimize())

$('btnWelcomeNext').addEventListener('click', async () => {
  show('location')
  await refreshDisk()
})
$('btnLocBack').addEventListener('click', () => show('welcome'))
$('btnLocNext').addEventListener('click', () => {
  if (!info.installDir) {
    $('freeSpace').textContent = 'Elige o confirma una carpeta antes de continuar.'
    return
  }
  show('license')
})
$('btnLicBack').addEventListener('click', () => show('location'))

$('btnBrowse').addEventListener('click', async () => {
  try {
    const dir = await window.setup.pickDir(info.installDir)
    if (dir && typeof dir === 'object' && dir.error) {
      $('freeSpace').textContent = `No se pudo abrir el explorador: ${dir.error}`
      return
    }
    if (dir) {
      setPath(dir)
      await refreshDisk()
    }
  } catch (err) {
    $('freeSpace').textContent = err?.message || 'No se pudo abrir Examinar'
  }
})

$('chkAccept').addEventListener('change', () => {
  $('btnInstall').disabled = !$('chkAccept').checked
})

$('btnInstall').addEventListener('click', () => void startInstall())
$('btnRetry').addEventListener('click', () => show(isUninstall() ? 'unWelcome' : 'welcome'))

$('btnUnCancel')?.addEventListener('click', () => void window.setup.close())
$('btnUnStart')?.addEventListener('click', () => void startUninstall())

$('btnDoneClose').addEventListener('click', () => void window.setup.close())
$('btnDoneLaunch').addEventListener('click', async () => {
  await window.setup.launch(exePath)
  await window.setup.close()
})

boot()
