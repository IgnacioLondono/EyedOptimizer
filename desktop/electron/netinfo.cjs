const https = require('node:https')
const http = require('node:http')
const { URL } = require('node:url')
const si = require('systeminformation')

let abortCtrl = null

function round2(n) {
  return Math.round(Number(n) * 100) / 100
}

function requestBuffer(urlStr, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr)
    const lib = u.protocol === 'https:' ? https : http
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: opts.method || 'GET',
        headers: opts.headers || {},
        timeout: opts.timeout || 60000,
      },
      (res) => {
        const chunks = []
        let received = 0
        res.on('data', (c) => {
          received += c.length
          if (opts.onData) opts.onData(c, received)
          if (!opts.discard) chunks.push(c)
        })
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            buffer: opts.discard ? Buffer.alloc(0) : Buffer.concat(chunks),
            received,
          })
        })
      },
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy(new Error('Timeout de red'))
    })
    if (opts.signal) {
      const onAbort = () => {
        req.destroy(new Error('Cancelado'))
      }
      if (opts.signal.aborted) return onAbort()
      opts.signal.addEventListener('abort', onAbort, { once: true })
    }

    if (opts.body) {
      const body = Buffer.isBuffer(opts.body) ? opts.body : Buffer.from(opts.body)
      const chunkSize = opts.chunkSize || 256 * 1024
      let sent = 0
      const writeNext = () => {
        try {
          while (sent < body.length) {
            if (opts.signal?.aborted) {
              req.destroy(new Error('Cancelado'))
              return
            }
            const end = Math.min(sent + chunkSize, body.length)
            const slice = body.subarray(sent, end)
            sent = end
            if (opts.onUploadProgress) opts.onUploadProgress(sent, body.length)
            const ok = req.write(slice)
            if (!ok) {
              req.once('drain', writeNext)
              return
            }
          }
          req.end()
        } catch (e) {
          reject(e)
        }
      }
      writeNext()
    } else {
      req.end()
    }
  })
}

async function fetchJson(url, timeout = 12000) {
  const res = await requestBuffer(url, { timeout, discard: false })
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`)
  return JSON.parse(res.buffer.toString('utf8'))
}

async function getNetworkInfo() {
  const ifaces = await si.networkInterfaces()
  const active = (ifaces || []).filter((n) => n.operstate === 'up' && !n.internal && n.ip4)
  const primary = active[0] || null

  let publicIp = null
  let isp = null
  let city = null
  let country = null
  let org = null
  let asn = null

  try {
    const meta = await fetchJson('https://speed.cloudflare.com/meta', 10000)
    publicIp = meta.clientIp || meta.ip || null
    city = meta.city || null
    country = meta.country || null
    asn = meta.asn || null
    org = meta.asOrganization || meta.org || null
  } catch {
    /* ignore */
  }

  if (!publicIp || !org) {
    try {
      const who = await fetchJson('https://ipwho.is/', 10000)
      if (who?.success !== false) {
        publicIp = publicIp || who.ip || null
        isp = who.connection?.isp || who.isp || null
        org = org || who.connection?.org || who.org || null
        city = city || who.city || null
        country = country || who.country || null
        asn = asn || who.connection?.asn || who.asn || null
      }
    } catch {
      /* ignore */
    }
  }

  return {
    publicIp,
    isp: isp || org || null,
    org,
    city,
    country,
    asn: asn != null ? String(asn) : null,
    interface: primary
      ? {
          name: primary.ifaceName || primary.iface || primary.ifaceName || 'Red',
          type: primary.type || primary.iface || '',
          ipv4: primary.ip4 || '',
          ipv6: primary.ip6 || '',
          mac: primary.mac || '',
          speed: primary.speed || null,
          dhcp: primary.dhcp != null ? !!primary.dhcp : null,
        }
      : null,
    interfaces: active.map((n) => ({
      name: n.ifaceName || n.iface,
      ipv4: n.ip4,
      type: n.type,
      speed: n.speed,
    })),
  }
}

async function measurePing(samples = 12, opts = {}) {
  const url = 'https://www.cloudflare.com/cdn-cgi/trace'
  const times = []
  const signal = opts.signal
  const onTick = typeof opts.onTick === 'function' ? opts.onTick : null
  const durationMs = Number(opts.durationMs) || 0

  if (durationMs > 0) {
    const endAt = Date.now() + durationMs
    let n = 0
    while (Date.now() < endAt) {
      if (signal?.aborted) throw new Error('Cancelado')
      const t0 = Date.now()
      try {
        await requestBuffer(url, { timeout: 8000, discard: true, signal })
        times.push(Date.now() - t0)
      } catch (e) {
        if (signal?.aborted || /cancel/i.test(e?.message || '')) throw e
      }
      n += 1
      const sorted = [...times].sort((a, b) => a - b)
      const ping = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null
      let jitter = 0
      for (let i = 1; i < sorted.length; i++) jitter += Math.abs(sorted[i] - sorted[i - 1])
      jitter = sorted.length > 1 ? Math.round(jitter / (sorted.length - 1)) : 0
      onTick?.({
        ping,
        jitter,
        samples: times.length,
        pass: n,
        remainingMs: Math.max(0, endAt - Date.now()),
      })
      const left = endAt - Date.now()
      if (left <= 0) break
      await sleep(Math.min(120, left), signal)
    }
  } else {
    for (let i = 0; i < samples; i++) {
      if (signal?.aborted) throw new Error('Cancelado')
      const t0 = Date.now()
      try {
        await requestBuffer(url, { timeout: 8000, discard: true, signal })
        times.push(Date.now() - t0)
      } catch {
        /* skip */
      }
      await sleep(120, signal)
    }
  }

  if (!times.length) return { ping: null, jitter: null, samples: 0 }
  times.sort((a, b) => a - b)
  const ping = times[Math.floor(times.length / 2)]
  let jitter = 0
  for (let i = 1; i < times.length; i++) jitter += Math.abs(times[i] - times[i - 1])
  jitter = times.length > 1 ? Math.round(jitter / (times.length - 1)) : 0
  return { ping, jitter, samples: times.length }
}

function makePayload(size) {
  const buf = Buffer.allocUnsafe(size)
  for (let i = 0; i < size; i += 1024) {
    buf[i] = (i * 31 + (i >> 8)) & 255
    if (i + 1 < size) buf[i + 1] = (i * 17) & 255
  }
  return buf
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Cancelado'))
    const t = setTimeout(resolve, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(new Error('Cancelado'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

const STEP_MS = 15_000

/**
 * Descarga continua durante durationMs (varios GET hasta completar la ventana).
 */
async function measureDownloadWindow(durationMs, signal, onProgress) {
  const endAt = Date.now() + durationMs
  const t0 = Date.now()
  let totalBytes = 0
  let lastDown = 0
  let pass = 0

  while (Date.now() < endAt) {
    if (signal.aborted) throw new Error('Cancelado')
    const remaining = endAt - Date.now()
    if (remaining < 250) break
    pass += 1
    // ~25 MB/s teórico → tamaño acotado a lo que cabe en el tiempo restante
    const size = Math.min(90 * 1024 * 1024, Math.max(10 * 1024 * 1024, Math.floor((remaining / 1000) * 28 * 1024 * 1024)))
    const local = new AbortController()
    const onAbort = () => local.abort()
    signal.addEventListener('abort', onAbort)
    const killer = setTimeout(() => local.abort(), remaining)

    let windowBytes = 0
    let windowStart = Date.now()
    let lastEmit = 0
    try {
      await requestBuffer(`https://speed.cloudflare.com/__down?bytes=${size}&measId=${Date.now()}-d${pass}`, {
        timeout: remaining + 5000,
        discard: true,
        signal: local.signal,
        onData: (chunk, total) => {
          totalBytes += chunk.length
          windowBytes += chunk.length
          const now = Date.now()
          if (now - windowStart >= 160) {
            const elapsedW = Math.max(0.15, (now - windowStart) / 1000)
            const instant = (windowBytes * 8) / elapsedW / 1e6
            const overall = (totalBytes * 8) / Math.max(0.2, (now - t0) / 1000) / 1e6
            lastDown = lastDown > 0 ? lastDown * 0.28 + overall * 0.72 : overall
            windowBytes = 0
            windowStart = now
            if (now - lastEmit >= 140) {
              lastEmit = now
              onProgress({
                mbps: round2(lastDown),
                loaded: total,
                total: size,
                pass,
                remainingMs: Math.max(0, endAt - now),
                instant: round2(instant),
              })
            }
          }
        },
      })
    } catch {
      /* timeout de ventana o cancel — seguir si queda tiempo */
    } finally {
      clearTimeout(killer)
      signal.removeEventListener('abort', onAbort)
    }
  }

  const elapsed = Math.max(0.5, (Date.now() - t0) / 1000)
  const mbps = round2((totalBytes * 8) / elapsed / 1e6)
  return { mbps: mbps || round2(lastDown), bytes: totalBytes, elapsedMs: Math.round(elapsed * 1000), passes: pass }
}

/**
 * Subida continua durante durationMs.
 */
async function measureUploadWindow(durationMs, signal, onProgress) {
  const endAt = Date.now() + durationMs
  const t0 = Date.now()
  let totalBytes = 0
  let lastUp = 0
  let pass = 0

  while (Date.now() < endAt) {
    if (signal.aborted) throw new Error('Cancelado')
    const remaining = endAt - Date.now()
    if (remaining < 250) break
    pass += 1
    const size = Math.min(48 * 1024 * 1024, Math.max(6 * 1024 * 1024, Math.floor((remaining / 1000) * 14 * 1024 * 1024)))
    const body = makePayload(size)
    const local = new AbortController()
    const onAbort = () => local.abort()
    signal.addEventListener('abort', onAbort)
    const killer = setTimeout(() => local.abort(), remaining)

    let sessionSent = 0
    let lastEmit = 0
    try {
      await requestBuffer(`https://speed.cloudflare.com/__up?measId=${Date.now()}-u${pass}`, {
        method: 'POST',
        timeout: remaining + 5000,
        discard: true,
        signal: local.signal,
        body,
        chunkSize: 256 * 1024,
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(size),
        },
        onUploadProgress: (sent) => {
          const delta = Math.max(0, sent - sessionSent)
          if (delta > 0) {
            totalBytes += delta
            sessionSent = sent
          }
          const now = Date.now()
          const overall = (totalBytes * 8) / Math.max(0.2, (now - t0) / 1000) / 1e6
          lastUp = lastUp > 0 ? lastUp * 0.32 + overall * 0.68 : overall
          if (now - lastEmit >= 140) {
            lastEmit = now
            onProgress({
              mbps: round2(lastUp),
              loaded: sent,
              total: size,
              pass,
              remainingMs: Math.max(0, endAt - now),
            })
          }
        },
      })
    } catch {
      /* ventana cortada */
    } finally {
      clearTimeout(killer)
      signal.removeEventListener('abort', onAbort)
    }
  }

  const elapsed = Math.max(0.5, (Date.now() - t0) / 1000)
  const mbps = round2((totalBytes * 8) / elapsed / 1e6)
  return { mbps: mbps || round2(lastUp), bytes: totalBytes, elapsedMs: Math.round(elapsed * 1000), passes: pass }
}

/**
 * Flujo: descarga → subida → ping rápido al final (sin fase de ping de 15 s).
 */
async function runSpeedTest(onProgress = () => {}) {
  if (abortCtrl) {
    try {
      abortCtrl.abort()
    } catch {
      /* ignore */
    }
  }
  abortCtrl = new AbortController()
  const signal = abortCtrl.signal

  const info = await getNetworkInfo()
  onProgress({ phase: 'info', info })

  // Warmup breve
  try {
    await requestBuffer('https://speed.cloudflare.com/__down?bytes=800000', {
      timeout: 12000,
      discard: true,
      signal,
    })
  } catch {
    /* ignore */
  }

  onProgress({
    phase: 'download',
    mbps: 0,
    pass: 1,
    passes: 1,
    stepMs: STEP_MS,
    remainingMs: STEP_MS,
  })
  const down = await measureDownloadWindow(STEP_MS, signal, (p) => {
    onProgress({
      phase: 'download',
      mbps: p.mbps,
      loaded: p.loaded,
      total: p.total,
      pass: p.pass,
      passes: p.pass,
      stepMs: STEP_MS,
      remainingMs: p.remainingMs,
    })
  })
  const finalDown = down.mbps

  onProgress({
    phase: 'hold',
    mbps: finalDown,
    downloadMbps: finalDown,
  })
  await sleep(700, signal)

  onProgress({
    phase: 'reset',
    mbps: 0,
    downloadMbps: finalDown,
  })
  await sleep(900, signal)

  onProgress({
    phase: 'upload',
    mbps: 0,
    pass: 1,
    passes: 1,
    stepMs: STEP_MS,
    remainingMs: STEP_MS,
    downloadMbps: finalDown,
  })
  const up = await measureUploadWindow(STEP_MS, signal, (p) => {
    onProgress({
      phase: 'upload',
      mbps: p.mbps,
      loaded: p.loaded,
      total: p.total,
      pass: p.pass,
      passes: p.pass,
      stepMs: STEP_MS,
      remainingMs: p.remainingMs,
      downloadMbps: finalDown,
    })
  })
  const finalUp = up.mbps

  onProgress({
    phase: 'hold',
    mbps: finalUp,
    downloadMbps: finalDown,
    uploadMbps: finalUp,
  })
  await sleep(500, signal)

  // Ping solo al final (pocas muestras, sin ventana de 15 s)
  const latency = await measurePing(8, { signal })

  const result = {
    ok: true,
    downloadMbps: finalDown,
    uploadMbps: finalUp,
    ping: latency.ping,
    jitter: latency.jitter,
    info,
    stepMs: STEP_MS,
    ts: Date.now(),
  }
  onProgress({ phase: 'done', mbps: finalDown, ...result })
  abortCtrl = null
  return result
}

function cancelSpeedTest() {
  if (abortCtrl) {
    try {
      abortCtrl.abort()
    } catch {
      /* ignore */
    }
    abortCtrl = null
  }
  return true
}

/**
 * Bufferbloat simple: ping idle vs ping bajo carga de descarga corta.
 * Score A–F según delta.
 */
async function measureBufferbloat(onProgress = () => {}) {
  onProgress({ phase: 'idle' })
  const idle = await measurePing(8)
  if (idle.ping == null) {
    return { ok: false, message: 'No se pudo medir ping base', score: null }
  }

  onProgress({ phase: 'load', idlePing: idle.ping })
  const loaded = []
  const url = `https://speed.cloudflare.com/__down?bytes=${12 * 1024 * 1024}&measId=${Date.now()}-bb`
  const download = requestBuffer(url, { timeout: 45000, discard: true }).catch(() => null)

  const endAt = Date.now() + 6500
  while (Date.now() < endAt) {
    const t0 = Date.now()
    try {
      await requestBuffer('https://www.cloudflare.com/cdn-cgi/trace', { timeout: 5000, discard: true })
      loaded.push(Date.now() - t0)
      onProgress({ phase: 'load', idlePing: idle.ping, loadPing: loaded[loaded.length - 1] })
    } catch {
      /* skip */
    }
    await sleep(150)
  }
  await download

  if (!loaded.length) {
    return {
      ok: false,
      message: 'No se pudo medir ping bajo carga',
      idlePing: idle.ping,
      score: null,
    }
  }
  loaded.sort((a, b) => a - b)
  const loadPing = loaded[Math.floor(loaded.length / 2)]
  const delta = Math.max(0, loadPing - idle.ping)
  let score = 'A'
  if (delta > 200) score = 'F'
  else if (delta > 120) score = 'E'
  else if (delta > 70) score = 'D'
  else if (delta > 40) score = 'C'
  else if (delta > 20) score = 'B'

  return {
    ok: true,
    idlePing: idle.ping,
    loadPing,
    delta,
    jitterIdle: idle.jitter,
    score,
    label:
      score === 'A' || score === 'B'
        ? 'Buena estabilidad bajo carga'
        : score === 'C'
          ? 'Aceptable; puede notarse en competitive'
          : 'Bufferbloat alto: el ping sube mucho al usar la red',
    ts: Date.now(),
  }
}

module.exports = {
  getNetworkInfo,
  measurePing,
  runSpeedTest,
  cancelSpeedTest,
  measureBufferbloat,
}
