const sharp = require('sharp')
const fs = require('node:fs')
const path = require('node:path')

const SRC_PNG =
  'C:\\Users\\ignac\\.cursor\\projects\\c-Users-ignac-Downloads-Software\\assets\\c__Users_ignac_AppData_Roaming_Cursor_User_workspaceStorage_0bc28b1169692a6cdec3847c1a40985a_images_watermarked_img_1627280286502087199-497c978f-47c8-4c48-9035-b67387cd7b78.png'

const OUT_PNG = path.join(__dirname, '..', 'build', 'icon.png')
const PUBLIC_PNG = path.join(__dirname, '..', 'public', 'logo.png')

function quantize(v, step = 24) {
  return Math.round(v / step) * step
}

function distSq(a, b) {
  const dr = a[0] - b[0]
  const dg = a[1] - b[1]
  const db = a[2] - b[2]
  return dr * dr + dg * dg + db * db
}

async function main() {
  if (!fs.existsSync(SRC_PNG)) {
    console.error('No existe la imagen fuente:', SRC_PNG)
    process.exit(1)
  }

  const img = sharp(SRC_PNG).ensureAlpha()
  const meta = await img.metadata()
  const width = meta.width
  const height = meta.height
  if (!width || !height) throw new Error('No se pudo leer dimensiones del icono')

  const { data } = await img.raw().toBuffer({ resolveWithObject: true })
  // Con ensureAlpha() el buffer suele venir como RGBA (4 canales) aunque meta.channels venga como 3.
  const channels = 4

  const corner = []
  const sample = (xStart, yStart) => {
    for (let y = yStart; y < yStart + 18; y++) {
      for (let x = xStart; x < xStart + 18; x++) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue
        const i = (y * width + x) * channels
        const r = data[i]
        const g = data[i + 1]
        const b = data[i + 2]
        corner.push([quantize(r), quantize(g), quantize(b)])
      }
    }
  }

  sample(0, 0)
  sample(width - 18, 0)
  sample(0, height - 18)
  sample(width - 18, height - 18)

  const counts = new Map()
  for (const c of corner) {
    const k = c.join(',')
    counts.set(k, (counts.get(k) || 0) + 1)
  }

  const bgColors = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k]) => k.split(',').map((n) => Number(n)))

  const threshold = 18 * 18 * 3
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const a = data[i + 3]
      if (a === 0) continue

      let isBg = false
      for (const bg of bgColors) {
        if (distSq([r, g, b], bg) < threshold) {
          isBg = true
          break
        }
      }
      if (isBg) data[i + 3] = 0
    }
  }

  await sharp(data, { raw: { width, height, channels: 4 } }).png().toFile(OUT_PNG)
  fs.copyFileSync(OUT_PNG, PUBLIC_PNG)
  console.log('Icono generado:', OUT_PNG)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

