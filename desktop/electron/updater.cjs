/**
 * Auto-update vía https://optzr.eyedcomun.me (generic provider).
 * Comprueba latest.yml; descarga Setup.exe e inicia el instalador.
 */
const { app, shell } = require('electron')
const { execFile } = require('node:child_process')
const fs = require('node:fs')
const https = require('node:https')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { URL } = require('node:url')

const UPDATE_FEED = String(process.env.EYED_UPDATE_URL || 'https://optzr.eyedcomun.me').replace(/\/$/, '')

let lastStatus = {
  checking: false,
  available: false,
  downloading: false,
  downloaded: false,
  currentVersion: '',
  remoteVersion: null,
  releaseNotes: null,
  downloadUrl: null,
  progress: 0,
  error: null,
  checkedAt: 0,
}

let listeners = []
let checkTimer = null

function emit() {
  const snap = { ...lastStatus }
  for (const cb of listeners) {
    try {
      cb(snap)
    } catch {
      /* */
    }
  }
}

function onStatus(cb) {
  listeners.push(cb)
  return () => {
    listeners = listeners.filter((x) => x !== cb)
  }
}

function getStatus() {
  return { ...lastStatus, feed: UPDATE_FEED }
}

function fetchText(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Demasiados redirects'))
    const u = new URL(url)
    const lib = u.protocol === 'http:' ? http : https
    const req = lib.get(
      url,
      {
        headers: { 'User-Agent': `EyedOptimizer/${app.getVersion()}`, Accept: '*/*' },
        timeout: 15000,
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const next = new URL(res.headers.location, url).toString()
          res.resume()
          return resolve(fetchText(next, redirects + 1))
        }
        if (res.statusCode !== 200) {
          res.resume()
          return reject(new Error(`HTTP ${res.statusCode}`))
        }
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      },
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Timeout'))
    })
  })
}

function fetchToFile(url, dest, onProgress, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Demasiados redirects'))
    const u = new URL(url)
    const lib = u.protocol === 'http:' ? http : https
    const req = lib.get(
      url,
      {
        headers: { 'User-Agent': `EyedOptimizer/${app.getVersion()}`, Accept: '*/*' },
        timeout: 120000,
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const next = new URL(res.headers.location, url).toString()
          res.resume()
          return resolve(fetchToFile(next, dest, onProgress, redirects + 1))
        }
        if (res.statusCode !== 200) {
          res.resume()
          return reject(new Error(`HTTP ${res.statusCode}`))
        }
        const total = Number(res.headers['content-length']) || 0
        let got = 0
        const out = fs.createWriteStream(dest)
        res.on('data', (c) => {
          got += c.length
          if (total > 0 && onProgress) onProgress(Math.min(99, Math.round((got / total) * 100)))
        })
        res.pipe(out)
        out.on('finish', () => {
          out.close(() => resolve(dest))
        })
        out.on('error', reject)
      },
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Timeout descarga'))
    })
  })
}

function parseLatestYml(text) {
  const version = (String(text).match(/^version:\s*['"]?([^\s'"]+)/m) || [])[1] || null
  const pathMatch =
    String(text).match(/^path:\s*['"]?([^\s'"]+)/m) ||
    String(text).match(/^\s*-\s*url:\s*['"]?([^\s'"]+)/m)
  const file = pathMatch ? pathMatch[1] : null
  const notes = (String(text).match(/^releaseNotes:\s*\|?\s*([\s\S]*?)(?=^\w|\Z)/m) || [])[1]
  return {
    version: version ? String(version).trim() : null,
    file: file ? String(file).trim() : null,
    notes: notes ? String(notes).trim().slice(0, 800) : null,
  }
}

function cmpSemver(a, b) {
  const pa = String(a || '0')
    .replace(/^v/i, '')
    .split(/[.+-]/)
    .map((x) => parseInt(x, 10) || 0)
  const pb = String(b || '0')
    .replace(/^v/i, '')
    .split(/[.+-]/)
    .map((x) => parseInt(x, 10) || 0)
  const n = Math.max(pa.length, pb.length)
  for (let i = 0; i < n; i++) {
    const da = pa[i] || 0
    const db = pb[i] || 0
    if (da > db) return 1
    if (da < db) return -1
  }
  return 0
}

async function checkForUpdates(opts = {}) {
  lastStatus.checking = true
  lastStatus.error = null
  lastStatus.currentVersion = app.getVersion()
  emit()
  try {
    const yml = await fetchText(`${UPDATE_FEED}/latest.yml`)
    const meta = parseLatestYml(yml)
    if (!meta.version) throw new Error('latest.yml sin version')
    lastStatus.remoteVersion = meta.version
    lastStatus.releaseNotes = meta.notes
    const file = meta.file || `EyedOptimizer-Setup-${meta.version}.exe`
    lastStatus.downloadUrl = file.startsWith('http') ? file : `${UPDATE_FEED}/${file.replace(/^\//, '')}`
    lastStatus.available = cmpSemver(meta.version, app.getVersion()) > 0
    lastStatus.checkedAt = Date.now()
    lastStatus.checking = false
    emit()
    if (lastStatus.available && opts.autoDownload) {
      void downloadAndInstall()
    }
    return getStatus()
  } catch (e) {
    lastStatus.checking = false
    lastStatus.error = e.message || 'No se pudo comprobar actualizaciones'
    lastStatus.checkedAt = Date.now()
    emit()
    return getStatus()
  }
}

async function downloadAndInstall() {
  if (!lastStatus.downloadUrl) {
    await checkForUpdates()
  }
  if (!lastStatus.available || !lastStatus.downloadUrl) {
    return { ok: false, message: lastStatus.error || 'No hay actualización disponible' }
  }
  if (lastStatus.downloading) return { ok: false, message: 'Descarga en curso' }

  lastStatus.downloading = true
  lastStatus.progress = 0
  lastStatus.error = null
  emit()

  const dest = path.join(os.tmpdir(), `EyedOptimizer-Setup-${lastStatus.remoteVersion || 'update'}.exe`)
  try {
    await fetchToFile(lastStatus.downloadUrl, dest, (p) => {
      lastStatus.progress = p
      emit()
    })
    lastStatus.progress = 100
    lastStatus.downloading = false
    lastStatus.downloaded = true
    emit()

    // Lanzar instalador NSIS (usuario confirma / silent si el setup lo permite)
    await new Promise((resolve, reject) => {
      execFile(dest, [], { windowsHide: false, detached: true }, (err) => {
        if (err) reject(err)
        else resolve()
      })
    }).catch(() => shell.openPath(dest))

    return { ok: true, message: 'Instalador iniciado. Cierra EyedOptimizer para terminar la actualización.' }
  } catch (e) {
    lastStatus.downloading = false
    lastStatus.error = e.message || 'Error al descargar'
    emit()
    return { ok: false, message: lastStatus.error }
  }
}

function openDownloadPage() {
  const url = lastStatus.downloadUrl || UPDATE_FEED
  return shell.openExternal(url)
}

function startAutoCheck(intervalMs = 6 * 60 * 60 * 1000) {
  // Primera comprobación a los ~8s (no bloquear arranque)
  setTimeout(() => {
    void checkForUpdates()
  }, 8000)
  if (checkTimer) clearInterval(checkTimer)
  checkTimer = setInterval(() => {
    void checkForUpdates()
  }, intervalMs)
}

function stopAutoCheck() {
  if (checkTimer) {
    clearInterval(checkTimer)
    checkTimer = null
  }
}

module.exports = {
  UPDATE_FEED,
  checkForUpdates,
  downloadAndInstall,
  openDownloadPage,
  getStatus,
  onStatus,
  startAutoCheck,
  stopAutoCheck,
}
