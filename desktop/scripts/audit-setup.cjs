/**
 * Auditoría rápida Setup + UI app (sin quitar features).
 * Exit 0 = OK, 1 = fallos.
 */
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const SETUP = path.join(ROOT, 'setup-ui')
const fail = []
const ok = []

function check( Cond, msg) {
  if (Cond) ok.push(msg)
  else fail.push(msg)
}

function read(p) {
  try {
    return fs.readFileSync(p, 'utf8')
  } catch {
    return ''
  }
}

const main = read(path.join(SETUP, 'main.cjs'))
const uiCss = read(path.join(SETUP, 'ui.css'))
const uiJs = read(path.join(SETUP, 'ui.js'))
const preload = read(path.join(SETUP, 'preload.cjs'))
const html = read(path.join(SETUP, 'index.html'))
const pkg = read(path.join(SETUP, 'package.json'))
const nsh = read(path.join(SETUP, 'nsis-setup.nsh'))
const globalCss = read(path.join(ROOT, 'src', 'styles', 'global.css'))
const appTsx = read(path.join(ROOT, 'src', 'App.tsx'))
const appsCjs = read(path.join(ROOT, 'electron', 'apps.cjs'))

check(main.includes('process.noAsar = true'), 'main: noAsar')
check(main.includes("require('original-fs')"), 'main: original-fs')
check(main.includes('setup:uninstall'), 'main: IPC uninstall')
check(main.includes('killAppProcesses'), 'main: kill PresentMon/app')
check(main.includes('setup:getLicense'), 'main: licencia diferida')
check(main.includes("show: true"), 'main: ventana inmediata')
check(preload.includes('getLicense'), 'preload: getLicense')
check(preload.includes('uninstall'), 'preload: uninstall')
check(uiJs.includes('startUninstall'), 'ui: flujo uninstall')
check(uiJs.includes('getLicense'), 'ui: carga licencia lazy')
check(uiCss.includes('grid-template-rows'), 'css: stage centrado grid')
check(uiCss.includes('--stage-pad-bottom'), 'css: padding footer')
check(!html.includes('fonts.googleapis.com'), 'html: sin CDN fonts')
check(html.includes('viewUnWelcome'), 'html: vista uninstall')
check(pkg.includes('"portable"'), 'pkg: target portable (sin carpeta Programs)')
check(!/"target"\s*:\s*\[\s*"nsis"\s*\]/.test(pkg), 'pkg: no nsis oneClick')
check(main.includes('SETUP_TEMP_ROOT') || main.includes('eyed-setup-run'), 'main: userData en TEMP')
check(main.includes('cleanupSetupTemp'), 'main: limpia TEMP al cerrar')
check(globalCss.includes('.app-head'), 'app css: columnas apps')
check(globalCss.includes('.driver-head'), 'app css: columnas drivers')
check(globalCss.includes('.disk-health-meta'), 'app css: SMART meta')
check(globalCss.includes('.speed-latency'), 'app css: speed latency')
check(appTsx.includes('SpeedGauge'), 'App: SpeedGauge')
check(appTsx.includes('disk-health-meta'), 'App: disk health')
check(appsCjs.includes('decodePsOutput'), 'apps: encoding UTF')

const payload = path.join(SETUP, 'payload', 'app-payload.zip')
check(fs.existsSync(payload), 'payload zip presente')

console.log('\n=== Auditoría EyedOptimizer Setup/UI ===')
for (const m of ok) console.log(`  OK  ${m}`)
for (const m of fail) console.log(`  FAIL ${m}`)
console.log(`\nResultado: ${fail.length ? `${fail.length} fallos` : 'todo OK'} (${ok.length} checks)\n`)
process.exit(fail.length ? 1 : 0)
