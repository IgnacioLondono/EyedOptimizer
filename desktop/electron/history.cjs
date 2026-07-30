const fs = require('node:fs')
const path = require('node:path')

const MAX_SAMPLES = 720 // ~2h a 10s
const MAX_SPEED = 40
const MAX_MOMENTS = 24
const SAMPLE_MS = 8000
const RECENT_BUF = 40 // para bad-moment clips

let filePath = null
let lastSampleAt = 0
let lastPersistAt = 0
let recent = []
let lastFpsOk = null
let cooldownMoment = 0

function empty() {
  return {
    samples: [],
    speedTests: [],
    moments: [],
    timeline: [],
    sessions: [],
  }
}

function init(userDataPath) {
  filePath = path.join(userDataPath, 'history.json')
  return load()
}

function load() {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    return {
      samples: Array.isArray(parsed.samples) ? parsed.samples : [],
      speedTests: Array.isArray(parsed.speedTests) ? parsed.speedTests : [],
      moments: Array.isArray(parsed.moments) ? parsed.moments : [],
      timeline: Array.isArray(parsed.timeline) ? parsed.timeline : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
    }
  } catch {
    return empty()
  }
}

function save(data) {
  if (!filePath) return
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify(data), 'utf8')
  } catch {
    /* ignore */
  }
}

function classifyBucket(stats) {
  const cpu = Number(stats?.cpu?.load) || 0
  const gpu = Number(stats?.gpu?.load) || 0
  const gpuTemp = Number(stats?.gpu?.temp)
  const cpuTemp = Number(stats?.cpu?.temp)
  const fps = stats?.fps?.available ? Number(stats.fps.fps) : null
  const game = !!stats?.game?.active

  if (
    (Number.isFinite(gpuTemp) && gpuTemp >= 87) ||
    (Number.isFinite(cpuTemp) && cpuTemp >= 90)
  ) {
    return 'throttle'
  }
  if (game || (fps != null && fps > 15)) return 'gaming'
  if (cpu > 35 || gpu > 25) return 'browsing'
  return 'idle'
}

function pushTimeline(data, ts, bucket) {
  const last = data.timeline[data.timeline.length - 1]
  if (last && last.bucket === bucket && ts - last.start < 6 * 60 * 60 * 1000) {
    last.end = ts
    return
  }
  data.timeline.push({ bucket, start: ts, end: ts })
  // keep ~24h of segments
  const cutoff = ts - 24 * 60 * 60 * 1000
  data.timeline = data.timeline.filter((s) => s.end >= cutoff).slice(-80)
}

/**
 * Llamar desde tick() con stats ya armados.
 */
function ingest(stats, opts = {}) {
  if (!stats) return null
  const now = Date.now()
  const sample = {
    t: now,
    cpu: Math.round(Number(stats.cpu?.load) || 0),
    gpu: Math.round(Number(stats.gpu?.load) || 0),
    ram: Math.round(Number(stats.ram?.percent) || 0),
    cpuTemp: stats.cpu?.temp ?? null,
    gpuTemp: stats.gpu?.temp ?? null,
    fps: stats.fps?.available ? Math.round(Number(stats.fps.fps) || 0) : null,
    frametime: stats.fps?.available ? Number(stats.fps.frametime) || null : null,
    disk: stats.disk?.percent ?? null,
    game: !!stats.game?.active,
  }

  recent.push(sample)
  if (recent.length > RECENT_BUF) recent = recent.slice(-RECENT_BUF)

  // bad moment: FPS cae fuerte o frametime dispara
  let moment = null
  if (sample.fps != null && sample.fps > 0) {
    if (lastFpsOk != null && lastFpsOk >= 40) {
      const drop = lastFpsOk - sample.fps
      const ft = sample.frametime
      const badFt = ft != null && ft > 40
      if ((drop >= 25 || badFt) && now - cooldownMoment > 45000) {
        cooldownMoment = now
        moment = {
          id: `m-${now}`,
          t: now,
          note:
            drop >= 25
              ? `FPS cayó de ${lastFpsOk} a ${sample.fps}`
              : `Frametime alto (${ft?.toFixed?.(1) ?? ft} ms)`,
          game: stats.game?.title || stats.game?.processName || null,
          clip: recent.slice(-20),
        }
      }
    }
    if (sample.fps >= 30) lastFpsOk = sample.fps
  }

  if (now - lastSampleAt < SAMPLE_MS && !moment) {
    return moment ? { moment } : null
  }
  lastSampleAt = now

  const data = load()
  data.samples.push(sample)
  if (data.samples.length > MAX_SAMPLES) data.samples = data.samples.slice(-MAX_SAMPLES)

  pushTimeline(data, now, classifyBucket(stats))

  if (moment) {
    data.moments.unshift(moment)
    data.moments = data.moments.slice(0, MAX_MOMENTS)
  }

  if (now - lastPersistAt > 20000 || moment || opts.force) {
    lastPersistAt = now
    save(data)
  }

  return moment ? { moment } : null
}

function addSpeedTest(result) {
  if (!result || !result.ok) return load()
  const data = load()
  data.speedTests.unshift({
    t: result.ts || Date.now(),
    downloadMbps: result.downloadMbps,
    uploadMbps: result.uploadMbps,
    ping: result.ping ?? null,
    jitter: result.jitter ?? null,
  })
  data.speedTests = data.speedTests.slice(0, MAX_SPEED)
  save(data)
  return data
}

function addGameSession(session) {
  if (!session) return load()
  const data = load()
  if (!Array.isArray(data.sessions)) data.sessions = []
  data.sessions.unshift({
    id: session.id || `s-${Date.now()}`,
    processName: session.processName || '',
    title: session.title || session.processName || 'Juego',
    start: session.start || Date.now(),
    end: session.end || Date.now(),
    avgFps: session.avgFps ?? null,
    avgGpuTemp: session.avgGpuTemp ?? null,
    durationMs: Math.max(0, (session.end || Date.now()) - (session.start || Date.now())),
  })
  data.sessions = data.sessions.slice(0, 40)
  save(data)
  return data
}

function getHistory() {
  return load()
}

function clearHistory() {
  const data = empty()
  save(data)
  recent = []
  return data
}

function getRecentSamples(n = 30) {
  return recent.slice(-n)
}

module.exports = {
  init,
  ingest,
  addSpeedTest,
  addGameSession,
  getHistory,
  clearHistory,
  getRecentSamples,
}
