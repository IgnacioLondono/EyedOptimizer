/**
 * Discord Rich Presence para EyedOptimizer.
 * Sale en el perfil del usuario (actividad Playing), no es un bot.
 */
const DiscordRPC = require('discord-rpc')

const COMMUNITY = 'https://discord.gg/eN6eQdGn87'
const UPDATE_MS = 15000
const RETRY_MS = 20000
/** Application ID EyedOptimizer (Discord Developer Portal). */
const DEFAULT_CLIENT_ID = '1531906316770218024'

let client = null
let enabled = false
let clientId = ''
let status = { state: 'off', message: 'Desactivado' }
let startedAt = null
let lastUpdateAt = 0
let retryTimer = null
let connecting = false
let lastActivityKey = ''

function setStatus(state, message) {
  status = { state, message }
}

function getStatus() {
  return { ...status, enabled }
}

function clearRetry() {
  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
}

function scheduleRetry() {
  clearRetry()
  if (!enabled || !clientId) return
  retryTimer = setTimeout(() => {
    void connect()
  }, RETRY_MS)
}

function destroyClient() {
  clearRetry()
  const c = client
  client = null
  connecting = false
  lastActivityKey = ''
  if (!c) return
  try {
    c.removeAllListeners?.()
  } catch {
    /* ignore */
  }
  try {
    c.clearActivity?.().catch(() => {})
  } catch {
    /* ignore */
  }
  try {
    c.destroy?.()
  } catch {
    /* ignore */
  }
}

function normalizeClientId(_raw) {
  // Application ID fijo de EyedOptimizer — el usuario no puede cambiarlo
  return DEFAULT_CLIENT_ID
}

let presenceMode = 'performance'
let specsCache = null

function setPresenceMode(mode) {
  presenceMode = mode || 'performance'
}

function setSpecsCache(specs) {
  specsCache = specs
  // Forzar refresco del Presence cuando llegan specs reales (GPU/DDR)
  lastActivityKey = ''
  lastUpdateAt = 0
}

function cleanCpuName(raw) {
  return String(raw || 'CPU')
    .replace(/\(R\)|\(TM\)|CPU|Processor|Gen\s+/gi, '')
    .replace(/Intel®?/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48)
}

function cleanGpuName(raw) {
  return String(raw || 'GPU')
    .replace(/^NVIDIA\s+GeForce\s+/i, '')
    .replace(/^AMD\s+Radeon\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40)
}

function isVirtualGpu(name) {
  return /virtual|microsoft basic|remote|parsec|vnc|citrix|qemu|vmware|hyper-v|displaylink|desktop monitor/i.test(
    String(name || ''),
  )
}

function buildActivity(stats) {
  const game = stats?.game
  const title = String(game?.title || game?.name || game?.processName || '').trim()
  const inGame = !!(game?.active || game?.running || game?.isGame) && !!title
    && !/eyedoptimizer|explorer|searchhost|shell experience/i.test(title)
  const cpu = Math.round(Number(stats?.cpu?.load) || 0)
  const gpu = Math.round(Number(stats?.gpu?.load) || 0)
  const ram = Math.round(Number(stats?.ram?.percent) || 0)
  const fpsRaw = stats?.fps?.current ?? stats?.fps?.fps ?? stats?.fps
  const fps = fpsRaw != null && Number.isFinite(Number(fpsRaw)) ? Math.round(Number(fpsRaw)) : null

  let details = ''
  let state = ''

  switch (presenceMode) {
    case 'specs': {
      const cpuName = cleanCpuName(specsCache?.cpu?.brand || stats?.cpu?.name || 'CPU')
      let gpuName = cleanGpuName(specsCache?.gpu?.name || '')
      const liveGpu = cleanGpuName(stats?.gpu?.name || '')
      if ((!gpuName || isVirtualGpu(gpuName) || gpuName === 'GPU') && liveGpu && !isVirtualGpu(liveGpu)) {
        gpuName = liveGpu
        if (specsCache) specsCache.gpu = { ...(specsCache.gpu || {}), name: liveGpu }
      }
      if (!gpuName || isVirtualGpu(gpuName)) gpuName = liveGpu && !isVirtualGpu(liveGpu) ? liveGpu : 'GPU'
      const ramGb =
        specsCache?.ram?.totalGb ||
        (stats?.ram?.totalMb ? Math.round(stats.ram.totalMb / 1024) : null) ||
        '?'
      const ddr = String(specsCache?.ram?.type || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
      const ramLabel = ddr ? `${ramGb} GB ${ddr}` : `${ramGb} GB`
      details = `${cpuName} · ${gpuName}`
      state = `${ramLabel} · ${inGame ? title || 'En juego' : 'Escritorio'}`
      break
    }
    case 'game': {
      details = inGame ? `Jugando ${title || 'juego'}` : 'En el escritorio'
      if (inGame && fps != null && fps > 0) {
        state = `${fps} FPS · ${gpu}% GPU`
      } else {
        state = inGame ? `GPU ${gpu}%` : 'Sin juego activo'
      }
      break
    }
    case 'minimal': {
      details = inGame ? `Jugando ${title || 'juego'}` : 'EyedOptimizer'
      state = inGame ? 'En partida' : 'Monitorizando'
      break
    }
    case 'performance':
    default: {
      details = inGame ? `Jugando ${title || 'juego'}` : 'Monitorizando el PC'
      state = `CPU ${cpu}% · GPU ${gpu}% · RAM ${ram}%`
      if (inGame && fps != null && fps > 0) {
        state = `${fps} FPS · CPU ${cpu}% · GPU ${gpu}%`
      }
      break
    }
  }

  return {
    details: details.slice(0, 128),
    state: state.slice(0, 128),
    // En juego: carátula del juego (Steam CDN) o asset "gaming"; EyedOptimizer en el círculo
    // En escritorio: logo EyedOptimizer grande
    largeImageKey: inGame
      ? String(stats?.game?.coverUrl || '').startsWith('http')
        ? stats.game.coverUrl
        : 'gaming'
      : 'eyedoptimizer',
    largeImageText: inGame ? title || 'En juego' : 'EyedOptimizer',
    smallImageKey: inGame ? 'eyedoptimizer' : 'idle',
    smallImageText: inGame ? 'EyedOptimizer' : 'Escritorio',
    startTimestamp: startedAt || Date.now(),
    instance: false,
  }
}

async function setActivitySafe(stats) {
  if (!client || !enabled) return
  const activity = buildActivity(stats)
  const key = `${activity.details}|${activity.state}`
  const now = Date.now()
  if (key === lastActivityKey && now - lastUpdateAt < UPDATE_MS) return
  try {
    await client.setActivity(activity)
    lastActivityKey = key
    lastUpdateAt = now
    setStatus('connected', 'Conectado — visible en tu perfil de Discord')
  } catch (err) {
    const msg = String(err?.message || err || '')
    if (/connection closed|EPIPE|ECONNRESET/i.test(msg)) {
      setStatus('no-discord', 'Conexión cerrada. ¿Discord está abierto? Reconectando…')
    } else {
      setStatus('error', msg.slice(0, 120) || 'No se pudo actualizar el estado')
    }
    destroyClient()
    scheduleRetry()
  }
}

async function connect() {
  if (!enabled) {
    setStatus('off', 'Desactivado')
    return false
  }
  clientId = normalizeClientId(clientId)
  if (!clientId) {
    setStatus('error', 'Client ID inválido')
    return false
  }
  if (client || connecting) return !!client
  connecting = true
  setStatus('connecting', 'Conectando con Discord…')

  try {
    try {
      DiscordRPC.register(String(clientId))
    } catch {
      /* register es opcional en algunos entornos */
    }
    const rpc = new DiscordRPC.Client({ transport: 'ipc' })
    client = rpc

    rpc.on('disconnected', () => {
      if (!enabled) return
      setStatus('no-discord', 'Discord se desconectó. Reintentando…')
      destroyClient()
      scheduleRetry()
    })

    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Discord no responde (¿está abierto?)')), 12000)
      rpc.once('ready', () => {
        clearTimeout(t)
        resolve()
      })
      rpc.login({ clientId: String(clientId) }).catch((err) => {
        clearTimeout(t)
        reject(err)
      })
    })

    connecting = false
    if (!startedAt) startedAt = Date.now()
    setStatus('connected', 'Conectado — visible en tu perfil de Discord')
    clearRetry()
    return true
  } catch (err) {
    connecting = false
    destroyClient()
    const msg = String(err?.message || err || '')
    if (/ENOENT|ECONNREFUSED|could not connect|Discord no responde|RPC_CONNECTION|connection closed/i.test(msg)) {
      setStatus('no-discord', 'Abre Discord de escritorio y pulsa Reconectar')
    } else {
      setStatus('error', msg.slice(0, 120) || 'Error de conexión')
    }
    scheduleRetry()
    return false
  }
}

async function applyConfig({ discordPresence, discordPresenceMode } = {}) {
  const nextEnabled = !!discordPresence
  const nextId = DEFAULT_CLIENT_ID
  const changed = nextEnabled !== enabled || nextId !== clientId

  if (discordPresenceMode) setPresenceMode(discordPresenceMode)
  enabled = nextEnabled
  clientId = nextId

  if (!enabled) {
    destroyClient()
    startedAt = null
    setStatus('off', 'Desactivado')
    return getStatus()
  }

  if (changed) {
    destroyClient()
    startedAt = Date.now()
    await connect()
  } else if (!client) {
    await connect()
  }
  return getStatus()
}

async function pushStats(stats) {
  if (!enabled) return
  if (!client) {
    await connect()
    if (!client) return
  }
  await setActivitySafe(stats)
}

function shutdown() {
  enabled = false
  destroyClient()
  startedAt = null
  setStatus('off', 'Desactivado')
}

module.exports = {
  applyConfig,
  pushStats,
  getStatus,
  shutdown,
  DEFAULT_CLIENT_ID,
  normalizeClientId,
  setPresenceMode,
  setSpecsCache,
}
