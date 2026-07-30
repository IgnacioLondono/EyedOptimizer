/**
 * Resuelve URL pública de carátula (Steam CDN) para Discord Rich Presence.
 * Discord acepta HTTPS externos en largeImageKey.
 */
const fs = require('node:fs')
const path = require('node:path')

const cache = new Map()

/** Mapa rápido processName → Steam AppID (juegos comunes / fallback). */
const KNOWN = {
  robloxplayerbeta: '0', // no steam
  valorant: '0',
  'league of legends': '0',
  cs2: '730',
  csgo: '730',
  'fortniteclient-win64-shipping': '0',
  gta5: '271590',
  gtav: '271590',
  rdr2: '1174180',
  rocketleague: '252950',
  apex_legends: '1172470',
  r5apex: '1172470',
  overwatch: '0',
  minecraft: '0',
  javaw: '0',
  hl2: '220',
  dota2: '570',
  tf2: '440',
  pubg: '578080',
  tslgame: '578080',
  destiny2: '1085660',
  warframe: '230410',
  rust: '252490',
  'among us': '945360',
  fallguys_client: '1097150',
  eldenring: '1245620',
  cyberpunk2077: '1091500',
  witcher3: '292030',
  re4: '2050650',
  repo: '3241660',
  'r.e.p.o': '3241660',
  'deadbydaylight-win64-shipping': '381210',
  deadbydaylight: '381210',
}

function steamLibraries() {
  const roots = []
  const pf = process.env['ProgramFiles(x86)'] || process.env.ProgramFiles || 'C:\\Program Files (x86)'
  const defaultSteam = path.join(pf, 'Steam')
  if (fs.existsSync(defaultSteam)) roots.push(defaultSteam)
  // libraryfolders.vdf
  const vdf = path.join(defaultSteam, 'steamapps', 'libraryfolders.vdf')
  try {
    if (fs.existsSync(vdf)) {
      const txt = fs.readFileSync(vdf, 'utf8')
      const re = /"path"\s+"([^"]+)"/gi
      let m
      while ((m = re.exec(txt))) {
        const p = m[1].replace(/\\\\/g, '\\')
        if (p && fs.existsSync(p)) roots.push(p)
      }
    }
  } catch {
    /* ignore */
  }
  return [...new Set(roots)]
}

function findAppIdByExe(exePath) {
  if (!exePath) return null
  const norm = String(exePath).replace(/\//g, '\\')
  const idx = norm.toLowerCase().indexOf('\\steamapps\\common\\')
  if (idx < 0) return null
  const after = norm.slice(idx + '\\steamapps\\common\\'.length)
  const folder = after.split('\\')[0]
  if (!folder) return null

  for (const root of steamLibraries()) {
    const apps = path.join(root, 'steamapps')
    let files = []
    try {
      files = fs.readdirSync(apps).filter((f) => /^appmanifest_\d+\.acf$/i.test(f))
    } catch {
      continue
    }
    for (const f of files) {
      try {
        const acf = fs.readFileSync(path.join(apps, f), 'utf8')
        const install = acf.match(/"installdir"\s+"([^"]+)"/i)
        if (!install || install[1].toLowerCase() !== folder.toLowerCase()) continue
        const id = acf.match(/"appid"\s+"(\d+)"/i)
        if (id) return id[1]
      } catch {
        /* ignore */
      }
    }
  }
  return null
}

function coverUrlForAppId(appId) {
  if (!appId || appId === '0') return null
  // library_600x900 funciona bien como large image cuadrada/alta
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`
}

/**
 * @param {{ processName?: string, title?: string, exePath?: string }} game
 * @returns {string|null} URL https o null
 */
function resolveGameCoverUrl(game) {
  const proc = String(game?.processName || '')
    .replace(/\.exe$/i, '')
    .toLowerCase()
  const cacheKey = `${proc}|${game?.exePath || ''}`
  if (cache.has(cacheKey)) return cache.get(cacheKey)

  let url = null
  try {
    const fromPath = findAppIdByExe(game?.exePath)
    if (fromPath) url = coverUrlForAppId(fromPath)
    if (!url && KNOWN[proc] && KNOWN[proc] !== '0') url = coverUrlForAppId(KNOWN[proc])
  } catch {
    url = null
  }

  cache.set(cacheKey, url)
  if (cache.size > 80) {
    const first = cache.keys().next().value
    cache.delete(first)
  }
  return url
}

module.exports = { resolveGameCoverUrl, coverUrlForAppId }
