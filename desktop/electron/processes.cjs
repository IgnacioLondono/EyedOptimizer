const si = require('systeminformation')
const { killProcessTree, isWindows } = require('./platform.cjs')

function formatBytes(n) {
  const u = ['B', 'KB', 'MB', 'GB']
  let v = Math.max(0, Number(n) || 0)
  let i = 0
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024
    i += 1
  }
  return `${v.toFixed(1)} ${u[i]}`
}

async function listProcesses() {
  const data = await si.processes()
  const list = (data.list || [])
    .map((p) => ({
      pid: p.pid,
      name: p.name || '?',
      cpu: Math.round((p.cpu || 0) * 10) / 10,
      mem: p.memRss || p.mem || 0,
      memMb: Math.round(((p.memRss || 0) / (1024 * 1024)) * 10) / 10,
      memPercent: Math.round((p.mem || 0) * 10) / 10,
      priority: p.priority ?? 0,
      started: p.started || '',
      command: p.command || p.path || '',
      path: p.path || p.command || '',
    }))
    .sort((a, b) => b.cpu - a.cpu || b.mem - a.mem)
  return list
}

function killProcess(pid) {
  const id = Number(pid)
  if (!id || id <= 0) {
    return Promise.resolve({ ok: false, message: 'PID invalido' })
  }
  const ok = killProcessTree(id)
  return Promise.resolve({
    ok,
    message: ok ? `Proceso ${id} finalizado.` : 'No se pudo finalizar',
    platformHint: isWindows ? null : 'Se usó señal POSIX (SIGTERM/SIGKILL)',
  })
}

module.exports = { listProcesses, killProcess, formatBytes }
