/**
 * Diagnóstico simple: causa principal + secundarias a partir del snapshot y samples recientes.
 */
function diagnoseNow(stats, recent = []) {
  const findings = []

  const cpu = Number(stats?.cpu?.load) || 0
  const gpu = Number(stats?.gpu?.load) || 0
  const ram = Number(stats?.ram?.percent) || 0
  const disk = Number(stats?.disk?.percent) || 0
  const gpuTemp = stats?.gpu?.temp != null ? Number(stats.gpu.temp) : null
  const cpuTemp = stats?.cpu?.temp != null ? Number(stats.cpu.temp) : null
  const vramUsed = Number(stats?.gpu?.vramUsed) || 0
  const vramTotal = Number(stats?.gpu?.vramTotal) || 0
  const vramPct = vramTotal > 0 ? (vramUsed / vramTotal) * 100 : 0
  const fps = stats?.fps?.available ? Number(stats.fps.fps) : null
  const ft = stats?.fps?.available ? Number(stats.fps.frametime) : null

  const avg = (key) => {
    const vals = recent.map((s) => s[key]).filter((n) => n != null && Number.isFinite(n))
    if (!vals.length) return null
    return vals.reduce((a, b) => a + b, 0) / vals.length
  }
  const avgRam = avg('ram')
  const avgGpuTemp = avg('gpuTemp')
  const avgDisk = avg('disk')

  if (gpuTemp != null && gpuTemp >= 85) {
    findings.push({
      id: 'thermal-gpu',
      severity: gpuTemp >= 90 ? 'high' : 'med',
      score: 90 + Math.min(10, gpuTemp - 85),
      title: 'GPU caliente',
      detail: `${gpuTemp} °C. El thermal throttle baja FPS y sube frametime.`,
    })
  } else if (avgGpuTemp != null && avgGpuTemp >= 84) {
    findings.push({
      id: 'thermal-gpu-avg',
      severity: 'med',
      score: 82,
      title: 'GPU sostenida en zona alta',
      detail: `Media reciente ~${Math.round(avgGpuTemp)} °C.`,
    })
  }

  if (cpuTemp != null && cpuTemp >= 88) {
    findings.push({
      id: 'thermal-cpu',
      severity: cpuTemp >= 95 ? 'high' : 'med',
      score: 88,
      title: 'CPU caliente',
      detail: `${cpuTemp} °C. Revisa ventilación y polvo.`,
    })
  }

  if (ram >= 90 || (avgRam != null && avgRam >= 88)) {
    findings.push({
      id: 'ram',
      severity: ram >= 95 ? 'high' : 'med',
      score: 86,
      title: 'Presión de RAM',
      detail: `${Math.round(ram)}% en uso. Windows puede usar disco como memoria (stutter).`,
    })
  }

  if (disk >= 92 || (avgDisk != null && avgDisk >= 90)) {
    findings.push({
      id: 'disk',
      severity: 'med',
      score: 78,
      title: 'Disco casi lleno',
      detail: `${Math.round(disk || avgDisk || 0)}% ocupado. Los SSD llenos rinden peor.`,
    })
  }

  if (vramPct >= 92) {
    findings.push({
      id: 'vram',
      severity: 'high',
      score: 84,
      title: 'VRAM al límite',
      detail: `${Math.round(vramPct)}% VRAM. Baja texturas o resolución.`,
    })
  }

  if (gpu >= 97 && fps != null && fps < 50) {
    findings.push({
      id: 'gpu-sat',
      severity: 'med',
      score: 72,
      title: 'GPU saturada',
      detail: `Carga ${Math.round(gpu)}% con ${fps} FPS. El juego pide más de lo que da la GPU.`,
    })
  }

  if (cpu >= 95 && gpu < 60) {
    findings.push({
      id: 'cpu-bound',
      severity: 'med',
      score: 70,
      title: 'Cuello de botella en CPU',
      detail: `CPU ${Math.round(cpu)}% con GPU baja. Cierra apps en segundo plano.`,
    })
  }

  if (ft != null && ft > 28 && (fps == null || fps < 80)) {
    findings.push({
      id: 'frametime',
      severity: 'med',
      score: 68,
      title: 'Frametime inestable',
      detail: `${ft.toFixed(1)} ms por frame. Posible stutter (CPU/disco/shaders).`,
    })
  }

  findings.sort((a, b) => b.score - a.score)

  if (!findings.length) {
    return {
      ok: true,
      primary: {
        id: 'ok',
        severity: 'ok',
        score: 0,
        title: 'Todo en orden',
        detail: 'No hay señales claras de cuello de botella ahora mismo.',
      },
      secondary: [],
      ts: Date.now(),
    }
  }

  return {
    ok: findings[0].severity !== 'high',
    primary: findings[0],
    secondary: findings.slice(1, 3),
    ts: Date.now(),
  }
}

module.exports = { diagnoseNow }
