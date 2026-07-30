/**
 * Assets del instalador/desinstalador NSIS — UI oscura profesional Eyed.
 * Sidebar 164×314 · Header 150×57 · BMP 24-bit (requisito NSIS).
 */
const fs = require('node:fs')
const path = require('node:path')
const sharp = require('sharp')

const ROOT = path.join(__dirname, '..')
const BUILD = path.join(ROOT, 'build')
const LOGO = path.join(BUILD, 'icon.png')

function encodeBmp24(width, height, rgba) {
  const rowSize = Math.floor((width * 3 + 3) / 4) * 4
  const pixelSize = rowSize * height
  const fileSize = 54 + pixelSize
  const buf = Buffer.alloc(fileSize)
  buf.write('BM', 0)
  buf.writeUInt32LE(fileSize, 2)
  buf.writeUInt32LE(0, 6)
  buf.writeUInt32LE(54, 10)
  buf.writeUInt32LE(40, 14)
  buf.writeInt32LE(width, 18)
  buf.writeInt32LE(height, 22)
  buf.writeUInt16LE(1, 26)
  buf.writeUInt16LE(24, 28)
  buf.writeUInt32LE(0, 30)
  buf.writeUInt32LE(pixelSize, 34)
  buf.writeInt32LE(2835, 38)
  buf.writeInt32LE(2835, 42)
  buf.writeUInt32LE(0, 46)
  buf.writeUInt32LE(0, 50)

  // Fondo de composición si hay alpha (tono panel Eyed)
  const br = 8
  const bg = 14
  const bb = 26

  for (let y = 0; y < height; y++) {
    const srcY = height - 1 - y
    const rowOff = 54 + y * rowSize
    for (let x = 0; x < width; x++) {
      const i = (srcY * width + x) * 4
      const a = rgba[i + 3] / 255
      const o = rowOff + x * 3
      buf[o] = Math.round(rgba[i + 2] * a + bb * (1 - a))
      buf[o + 1] = Math.round(rgba[i + 1] * a + bg * (1 - a))
      buf[o + 2] = Math.round(rgba[i] * a + br * (1 - a))
    }
  }
  return buf
}

function sidebarSvg(kind) {
  const isUn = kind === 'uninstall'
  const accent = isUn ? '#ff7a8a' : '#3ec4ff'
  const accent2 = isUn ? '#ffb86b' : '#5dffc2'
  const title = isUn ? 'Desinstalar' : 'EyedOptimizer'
  const sub = isUn ? 'Limpieza segura' : 'Monitor · FPS · Red'
  const badge = isUn ? 'UNINSTALL' : 'SETUP'
  return Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="164" height="314" viewBox="0 0 164 314">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.35" y2="1">
      <stop offset="0%" stop-color="#050a12"/>
      <stop offset="40%" stop-color="#0a1528"/>
      <stop offset="100%" stop-color="#061820"/>
    </linearGradient>
    <linearGradient id="shine" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0.28"/>
      <stop offset="40%" stop-color="${accent}" stop-opacity="0.06"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="orb" cx="50%" cy="28%" r="48%">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0.55"/>
      <stop offset="55%" stop-color="${accent2}" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="bar" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0"/>
      <stop offset="50%" stop-color="${accent}"/>
      <stop offset="100%" stop-color="${accent2}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="164" height="314" fill="url(#bg)"/>
  <rect width="164" height="314" fill="url(#orb)"/>
  <rect width="164" height="160" fill="url(#shine)"/>
  <rect x="0" y="0" width="3" height="314" fill="${accent}"/>
  <!-- mesh / grid sutil -->
  <g stroke="${accent}" stroke-width="0.6" opacity="0.12">
    <path d="M0 40 H164 M0 80 H164 M0 120 H164 M0 200 H164 M0 240 H164"/>
    <path d="M40 0 V314 M80 0 V314 M120 0 V314"/>
  </g>
  <!-- circuit accents -->
  <g stroke="${accent}" stroke-width="1.1" fill="none" opacity="0.45">
    <path d="M10 28 H42 V54 H22"/>
    <path d="M154 36 H122 V68 H142"/>
    <path d="M14 268 H52 V296"/>
    <path d="M150 252 H108 V290 H136"/>
  </g>
  <g fill="${accent}" opacity="0.85">
    <circle cx="42" cy="28" r="2.4"/>
    <circle cx="122" cy="36" r="2.4"/>
    <circle cx="52" cy="268" r="2.4"/>
    <circle cx="108" cy="252" r="2.4"/>
  </g>
  <!-- badge -->
  <rect x="46" y="18" width="72" height="18" rx="9" fill="${accent}" fill-opacity="0.15" stroke="${accent}" stroke-opacity="0.55"/>
  <text x="82" y="31" text-anchor="middle" font-family="Segoe UI, Arial" font-size="9" font-weight="700" letter-spacing="1.2" fill="${accent}">${badge}</text>
  <!-- title block -->
  <text x="82" y="198" text-anchor="middle" font-family="Segoe UI, Arial" font-size="14" font-weight="800" fill="#f4f8ff">${title}</text>
  <text x="82" y="216" text-anchor="middle" font-family="Segoe UI, Arial" font-size="10" fill="${accent2}">${sub}</text>
  <rect x="42" y="228" width="80" height="2" rx="1" fill="url(#bar)"/>
  <text x="82" y="252" text-anchor="middle" font-family="Segoe UI, Arial" font-size="9" fill="#8fa3bc">Instalador profesional</text>
  <text x="82" y="298" text-anchor="middle" font-family="Segoe UI, Arial" font-size="8" fill="#5a6d86">eyedoptimizer</text>
</svg>`)
}

function headerSvg() {
  return Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="150" height="57" viewBox="0 0 150 57">
  <defs>
    <linearGradient id="h" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#070f1c"/>
      <stop offset="55%" stop-color="#0e2438"/>
      <stop offset="100%" stop-color="#0a3a4e"/>
    </linearGradient>
  </defs>
  <rect width="150" height="57" fill="url(#h)"/>
  <rect x="0" y="0" width="150" height="57" fill="#3ec4ff" opacity="0.06"/>
  <rect x="0" y="55" width="150" height="2" fill="#3ec4ff"/>
  <text x="52" y="28" font-family="Segoe UI, Arial" font-size="13" font-weight="800" fill="#eef5ff">EyedOptimizer</text>
  <text x="52" y="43" font-family="Segoe UI, Arial" font-size="8" fill="#5dffc2">Setup · Windows</text>
</svg>`)
}

async function makeHeader() {
  const w = 150
  const h = 57
  const logo = await sharp(LOGO)
    .resize(34, 34, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
  const composed = await sharp(headerSvg())
    .composite([{ input: logo, left: 10, top: 11 }])
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  fs.writeFileSync(path.join(BUILD, 'installerHeader.bmp'), encodeBmp24(w, h, composed.data))
}

async function makeSidebar(kind) {
  const w = 164
  const h = 314
  const logo = await sharp(LOGO)
    .resize(92, 92, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
  const composed = await sharp(sidebarSvg(kind))
    .composite([{ input: logo, left: Math.round((w - 92) / 2), top: 72 }])
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const name = kind === 'uninstall' ? 'uninstallerSidebar.bmp' : 'installerSidebar.bmp'
  fs.writeFileSync(path.join(BUILD, name), encodeBmp24(w, h, composed.data))
}

async function main() {
  if (!fs.existsSync(LOGO)) throw new Error('Falta build/icon.png')
  await makeSidebar('install')
  await makeSidebar('uninstall')
  await makeHeader()
  console.log('Assets instalador OK (UI oscura):', BUILD)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
