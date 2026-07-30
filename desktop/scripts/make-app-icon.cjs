/**
 * Genera icono moderno minimalista EyedOptimizer (PNG 1024 + ICO multi-size).
 */
const fs = require('node:fs')
const path = require('node:path')
const sharp = require('sharp')
const pngToIcoModule = require('png-to-ico')
const pngToIco = pngToIcoModule.default || pngToIcoModule

const ROOT = path.join(__dirname, '..')
const BUILD = path.join(ROOT, 'build')
const PUBLIC = path.join(ROOT, 'public')
const SETUP = path.join(ROOT, 'setup-ui')
const ASSETS = path.join(ROOT, '..', 'assets')

/** Ojo geométrico blanco sobre negro — marca B/N */
const SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" fill="none">
  <!-- App tile -->
  <rect x="64" y="64" width="896" height="896" rx="208" fill="#000000"/>

  <!-- Soft inner rim -->
  <rect x="96" y="96" width="832" height="832" rx="184" stroke="rgba(255,255,255,0.16)" stroke-width="6" fill="none"/>

  <!-- Eye outline (almond) -->
  <path
    d="M512 288C360 288 232 420 168 512C232 604 360 736 512 736C664 736 792 604 856 512C792 420 664 288 512 288Z"
    fill="none"
    stroke="#FFFFFF"
    stroke-width="56"
    stroke-linejoin="round"
  />

  <!-- Iris -->
  <circle cx="512" cy="512" r="148" fill="#FFFFFF"/>

  <!-- Pupil -->
  <circle cx="512" cy="512" r="72" fill="#000000"/>

  <!-- Specular -->
  <circle cx="470" cy="470" r="26" fill="#FFFFFF"/>
</svg>`

async function writePng(svg, size, outPath) {
  const buf = await sharp(Buffer.from(svg))
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
  fs.writeFileSync(outPath, buf)
  return buf
}

async function main() {
  fs.mkdirSync(BUILD, { recursive: true })
  fs.mkdirSync(PUBLIC, { recursive: true })

  const svgPath = path.join(BUILD, 'icon.svg')
  fs.writeFileSync(svgPath, SVG, 'utf8')

  const master = path.join(BUILD, 'icon.png')
  await writePng(SVG, 1024, master)

  // Multi-size PNGs for ICO
  const sizes = [16, 24, 32, 48, 64, 128, 256]
  const tmpDir = path.join(BUILD, '.icon-tmp')
  fs.mkdirSync(tmpDir, { recursive: true })
  const pngs = []
  for (const s of sizes) {
    const p = path.join(tmpDir, `icon-${s}.png`)
    await writePng(SVG, s, p)
    pngs.push(p)
  }

  const icoBuf = await pngToIco(pngs)
  const icoPath = path.join(BUILD, 'icon.ico')
  fs.writeFileSync(icoPath, icoBuf)

  // Propagate
  const copies = [
    [master, path.join(PUBLIC, 'logo.png')],
    [master, path.join(PUBLIC, 'icon.png')],
    [icoPath, path.join(PUBLIC, 'icon.ico')],
    [icoPath, path.join(PUBLIC, 'logo.ico')],
    [master, path.join(SETUP, 'icon.png')],
    [icoPath, path.join(SETUP, 'icon.ico')],
  ]
  if (fs.existsSync(ASSETS)) {
    copies.push([icoPath, path.join(ASSETS, 'icon.ico')])
  }
  for (const [src, dest] of copies) {
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(src, dest)
  }

  // Cleanup tmp
  fs.rmSync(tmpDir, { recursive: true, force: true })

  const faviconSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
  <rect width="64" height="64" rx="14" fill="#000"/>
  <path d="M32 14C22 14 14.5 22.5 10 32C14.5 41.5 22 50 32 50C42 50 49.5 41.5 54 32C49.5 22.5 42 14 32 14Z" stroke="#fff" stroke-width="3.5" fill="none" stroke-linejoin="round"/>
  <circle cx="32" cy="32" r="9" fill="#fff"/>
  <circle cx="32" cy="32" r="4.5" fill="#000"/>
  <circle cx="29.5" cy="29.5" r="1.6" fill="#fff"/>
</svg>`
  fs.writeFileSync(path.join(PUBLIC, 'favicon.svg'), faviconSvg, 'utf8')

  console.log('OK icon blanco generado y propagado')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
