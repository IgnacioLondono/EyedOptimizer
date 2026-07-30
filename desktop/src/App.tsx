import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  AdvancedSpecs,
  AppSettings,
  BufferbloatResult,
  DiagnoseResult,
  DiskInfo,
  HistoryBundle,
  InstalledApp,
  LiveStats,
  NetworkInfo,
  ProcessRow,
  SpeedProgress,
} from './types'
import { TitleBar } from './TitleBar'
import { AppLogo } from './AppLogo'
import { DetailModal, type DetailKind } from './DetailModal'
import { ConfirmModal } from './ConfirmModal'
import {
  ChecklistPanel,
  CircularGauge,
  DiagnoseCard,
  MomentsList,
  MultiSpark,
  SegmentedBar,
  Sparkline,
  SpeedHistoryList,
  TimelineBar,
} from './components/widgets'
import { DiskTools, FeatureHub } from './components/FeatureHub'
import {
  IconActivity,
  IconApps,
  IconBolt,
  IconCpu,
  IconDisk,
  BatteryBig,
  IconBattery,
  IconChart,
  IconDiscord,
  IconDownload,
  IconEye,
  IconFolder,
  IconGamepad,
  IconGpu,
  IconHome,
  IconInfo,
  IconLayers,
  IconPower,
  IconRam,
  IconRefresh,
  IconSettings,
  IconTemp,
  IconTrash,
  IconTray,
  IconUpload,
  IconWifi,
  IconFan,
} from './icons'

type Page =
  | 'home'
  | 'insights'
  | 'games'
  | 'optimize'
  | 'disk'
  | 'specs'
  | 'battery'
  | 'network'
  | 'netlab'
  | 'processes'
  | 'apps'
  | 'startup'
  | 'cleanup'
  | 'hardware'
  | 'labs'
  | 'drivers'
  | 'events'
  | 'settings'

type NavItem = { id: Page; label: string; sub: string; icon: ReactNode }
type NavGroup = { title: string; items: NavItem[] }

function Ring({
  value,
  color,
  label,
  icon,
  onClick,
}: {
  value: number
  color: string
  label: string
  icon?: ReactNode
  onClick?: () => void
}) {
  const p = Math.max(0, Math.min(100, value))
  return (
    <div
      className={`ring-wrap ${onClick ? 'clickable-card' : ''}`}
      onClick={onClick}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className="ring" style={{ ['--p' as string]: p, ['--ring-color' as string]: color }}>
        <strong>{Math.round(p)}%</strong>
      </div>
      <div className="ring-meta">
        {icon}
        <span>{label}</span>
      </div>
    </div>
  )
}

function MetricCard({
  icon,
  label,
  value,
  sub,
  color,
  pct,
  onClick,
}: {
  icon: ReactNode
  label: string
  value: string
  sub: string
  color: string
  pct: number
  onClick?: () => void
}) {
  return (
    <div
      className={`card metric-card ${onClick ? 'clickable-card' : ''}`}
      onClick={onClick}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className="metric-head">
        <span className="metric-icon" style={{ color, background: `${color}22` }}>
          {icon}
        </span>
        <span className="card-label">{label}</span>
      </div>
      <div className="card-value" style={{ color }}>
        {value}
      </div>
      <div className="card-sub">{sub}</div>
      <div className="bar">
        <span style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
      </div>
    </div>
  )
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      className={`toggle ${on ? 'on' : ''}`}
      onClick={onClick}
      aria-pressed={on}
      aria-label={label}
    >
      <span className="toggle-knob" />
    </button>
  )
}

function PageHeader({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string
  title: string
  subtitle: string
  children?: ReactNode
}) {
  return (
    <div className="topbar">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      {children ? <div className="actions">{children}</div> : null}
    </div>
  )
}

/** Gauge suave: la aguja interpola hacia el valor objetivo (DOM directo, sin re-render 60fps) */
const SpeedGauge = memo(function SpeedGauge({
  value,
  phase,
}: {
  value: number
  phase: 'idle' | 'ping' | 'download' | 'hold' | 'reset' | 'upload' | 'done'
}) {
  const ticks = [0, 5, 10, 50, 100, 250, 500, 750, 1000]
  const targetRef = useRef(0)
  const displayRef = useRef(0)
  const phaseRef = useRef(phase)
  const needleRef = useRef<SVGLineElement>(null)
  const arcRef = useRef<SVGPathElement>(null)
  const hubRef = useRef<SVGCircleElement>(null)
  const valueRef = useRef<HTMLElement>(null)
  const lastTextAt = useRef(0)
  const lastTextVal = useRef(-1)

  const r = 110
  const cx = 140
  const cy = 138
  // Tip corta: queda antes de los numeros (labels fuera del arco)
  const needleLen = 62
  const rad = (deg: number) => ((180 - deg) * Math.PI) / 180
  const arcPath = (from: number, to: number) => {
    const x1 = cx + r * Math.cos(rad(from))
    const y1 = cy - r * Math.sin(rad(from))
    const x2 = cx + r * Math.cos(rad(to))
    const y2 = cy - r * Math.sin(rad(to))
    const large = to - from > 180 ? 1 : 0
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`
  }
  const toAngle = (mbps: number) => {
    const v = Math.max(0, Math.min(1000, mbps || 0))
    const idx = ticks.findIndex((t) => v <= t)
    if (idx <= 0) return 0
    const a = ticks[idx - 1]
    const b = ticks[idx]
    const local = (v - a) / Math.max(1e-9, b - a)
    return ((idx - 1 + local) / (ticks.length - 1)) * 180
  }
  const colorFor = (p: typeof phase) =>
    p === 'upload' ? '#c084fc' : p === 'reset' ? '#94a3b8' : p === 'ping' ? '#7ec8ff' : p === 'done' ? '#ffffff' : '#22d3ee'

  const label =
    phase === 'upload'
      ? 'Subida'
      : phase === 'download'
        ? 'Descarga'
        : phase === 'hold'
          ? 'Espera…'
          : phase === 'reset'
            ? 'Volviendo a 0…'
            : phase === 'ping'
              ? 'Ping'
              : phase === 'done'
                ? 'Listo'
                : 'Listo'

  useEffect(() => {
    targetRef.current = phase === 'done' ? 0 : Math.max(0, Number(value) || 0)
  }, [value, phase])

  useEffect(() => {
    phaseRef.current = phase
    const c = colorFor(phase)
    arcRef.current?.setAttribute('stroke', c)
    hubRef.current?.setAttribute('fill', c)
    if (valueRef.current) valueRef.current.style.color = c
  }, [phase])

  // Animacion por DOM directo: evita re-renders de React a 60fps
  useEffect(() => {
    let raf = 0
    let running = true
    const paint = (mbps: number) => {
      const angle = toAngle(mbps)
      const nx = cx + needleLen * Math.cos(rad(angle))
      const ny = cy - needleLen * Math.sin(rad(angle))
      needleRef.current?.setAttribute('x2', String(nx))
      needleRef.current?.setAttribute('y2', String(ny))
      arcRef.current?.setAttribute('d', arcPath(0, Math.max(0.5, angle)))

      const now = performance.now()
      const rounded = mbps < 0.05 ? -1 : Math.round(mbps * 100) / 100
      if (rounded !== lastTextVal.current && (now - lastTextAt.current > 80 || rounded < 0 || Math.abs(rounded - targetRef.current) < 0.2)) {
        lastTextAt.current = now
        lastTextVal.current = rounded
        if (valueRef.current) valueRef.current.textContent = rounded < 0 ? '--' : rounded.toFixed(2)
      }
    }

    const tick = () => {
      if (!running) return
      const cur = displayRef.current
      const tgt = targetRef.current
      const p = phaseRef.current
      const ease = p === 'reset' || p === 'done' ? 0.2 : p === 'hold' ? 0.12 : 0.16
      const next = Math.abs(tgt - cur) < 0.05 ? tgt : cur + (tgt - cur) * ease
      displayRef.current = next
      paint(next)
      raf = requestAnimationFrame(tick)
    }
    paint(displayRef.current)
    raf = requestAnimationFrame(tick)
    return () => {
      running = false
      cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <div className="speed-gauge">
      <svg viewBox="0 0 280 178" className="speed-gauge-svg">
        <path
          d={arcPath(0, 180)}
          fill="none"
          stroke="rgba(255,255,255,0.1)"
          strokeWidth="14"
          strokeLinecap="butt"
        />
        <path
          ref={arcRef}
          d={arcPath(0, 0.5)}
          fill="none"
          stroke={colorFor(phase)}
          strokeWidth="14"
          strokeLinecap="butt"
        />
        {ticks.map((t, i) => {
          const a = (i / (ticks.length - 1)) * 180
          // Etiquetas fuera del arco para que no se solapen con el trazo
          const lr = r + 18
          const x = cx + lr * Math.cos(rad(a))
          const y = cy - lr * Math.sin(rad(a))
          return (
            <text key={t} x={x} y={y} textAnchor="middle" dominantBaseline="middle" className="speed-tick">
              {t}
            </text>
          )
        })}
        <line
          ref={needleRef}
          x1={cx}
          y1={cy}
          x2={cx - needleLen}
          y2={cy}
          stroke="rgba(255,255,255,0.9)"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <circle ref={hubRef} cx={cx} cy={cy} r="5.5" fill={colorFor(phase)} />
      </svg>
      <div className="speed-gauge-readout">
        <strong ref={valueRef} style={{ color: colorFor(phase) }}>
          --
        </strong>
        <span>Mbps · {label}</span>
      </div>
    </div>
  )
})

export default function App() {
  const [page, setPage] = useState<Page>('home')
  const [stats, setStats] = useState<LiveStats | null>(null)
  const [settings, setSettings] = useState<AppSettings>({
    overlayEnabled: true,
    gameActive: false,
    closeToTray: true,
    startMinimized: false,
    competitiveMode: false,
    performanceMode: 'work',
    gameAutoOptimize: false,
    alertCpuTemp: 90,
    alertGpuTemp: 85,
    alertRam: 90,
    overlayOpacity: 0.48,
    discordPresence: false,
    discordPresenceMode: 'performance' as const,
    overlayWidgets: {
      game: true,
      gpu: true,
      vram: true,
      cpu: true,
      ram: true,
      fps: true,
      fpsStats: true,
      frametime: true,
      temps: true,
      power: true,
    },
  })
  const [busyCache, setBusyCache] = useState(false)
  const [platformCaps, setPlatformCaps] = useState<{
    isWindows: boolean
    isMac: boolean
    isLinux: boolean
    platform: string
    features?: Record<string, boolean>
  } | null>(null)
  const [busyOptimize, setBusyOptimize] = useState(false)
  const [cacheLog, setCacheLog] = useState('Listo para limpiar la cache de RAM.')
  const [optLog, setOptLog] = useState('Listo para optimizar el sistema.')
  const [procs, setProcs] = useState<ProcessRow[]>([])
  const [procBusy, setProcBusy] = useState(false)
  const [procQuery, setProcQuery] = useState('')
  const [procSortCol, setProcSortCol] = useState<'name' | 'pid' | 'cpu' | 'mem' | 'description'>('mem')
  const [procSortRev, setProcSortRev] = useState(true)
  const [selectedProc, setSelectedProc] = useState<ProcessRow | null>(null)
  const [diskInfo, setDiskInfo] = useState<DiskInfo | null>(null)
  const [diskBusy, setDiskBusy] = useState(false)
  const [specs, setSpecs] = useState<AdvancedSpecs | null>(null)
  const [specsBusy, setSpecsBusy] = useState(false)
  const [apps, setApps] = useState<InstalledApp[]>([])
  const [appsBusy, setAppsBusy] = useState(false)
  const [appQuery, setAppQuery] = useState('')
  const [selectedApp, setSelectedApp] = useState<InstalledApp | null>(null)
  const [appDetails, setAppDetails] = useState<Awaited<
    ReturnType<NonNullable<typeof window.eyed>['getAppDetails']>
  > | null>(null)
  const [appActionLog, setAppActionLog] = useState('')
  const [detailModal, setDetailModal] = useState<DetailKind | null>(null)
  const [confirmDlg, setConfirmDlg] = useState<{
    title?: string
    message: string
    confirmLabel?: string
    danger?: boolean
    alertOnly?: boolean
    action: () => void | Promise<void>
  } | null>(null)

  const askConfirm = (opts: {
    title?: string
    message: string
    confirmLabel?: string
    danger?: boolean
    alertOnly?: boolean
    action: () => void | Promise<void>
  }) => {
    setConfirmDlg(opts)
  }

  const showAlert = (message: string, title = 'Aviso') => {
    askConfirm({
      title,
      message,
      confirmLabel: 'Entendido',
      alertOnly: true,
      action: () => {},
    })
  }
  const [netInfo, setNetInfo] = useState<NetworkInfo | null>(null)
  const [netBusy, setNetBusy] = useState(false)
  const [speedBusy, setSpeedBusy] = useState(false)
  const [speedPhase, setSpeedPhase] = useState<
    'idle' | 'ping' | 'download' | 'hold' | 'reset' | 'upload' | 'done'
  >('idle')
  const [liveMbps, setLiveMbps] = useState(0)
  const [downMbps, setDownMbps] = useState<number | null>(null)
  const [upMbps, setUpMbps] = useState<number | null>(null)
  const [pingMs, setPingMs] = useState<number | null>(null)
  const [jitterMs, setJitterMs] = useState<number | null>(null)
  const [speedLog, setSpeedLog] = useState('Listo para medir tu conexion.')
  const [history, setHistory] = useState<HistoryBundle | null>(null)
  const [diagnose, setDiagnose] = useState<DiagnoseResult | null>(null)
  const [diagnoseBusy, setDiagnoseBusy] = useState(false)
  const [bbloat, setBbloat] = useState<BufferbloatResult | null>(null)
  const [bbloatBusy, setBbloatBusy] = useState(false)
  const [alertDismissed, setAlertDismissed] = useState<string | null>(null)
  const [hubLog, setHubLog] = useState('')
  const [previewOsd, setPreviewOsd] = useState(false)

  useEffect(() => {
    window.eyed?.getSettings().then(setSettings)
    window.eyed?.getPlatform?.().then((p) => {
      if (p) setPlatformCaps(p)
    })
    window.eyed?.getOverlayState().then((s) =>
      setSettings((prev) => ({
        ...prev,
        overlayEnabled: s.overlayEnabled,
        gameActive: s.gameActive,
        closeToTray: s.closeToTray ?? prev.closeToTray,
      })),
    )
    window.eyed?.getStats().then((s) => {
      if (s) setStats(s)
    })
    window.eyed?.getHistory().then((h) => {
      if (h) setHistory(h)
    })
    let lastUi = 0
    const offStats = window.eyed?.onStats((data) => {
      const now = Date.now()
      if (now - lastUi < 500) return
      lastUi = now
      setStats((prev) => {
        if (!prev) return data
        const game =
          data.game?.active || !prev.game?.active
            ? data.game
            : { ...prev.game, ...data.game, active: true, title: data.game?.title || prev.game.title }
        return {
          ...data,
          game,
          cpu: {
            ...data.cpu,
            cores: data.cpu?.cores?.length ? data.cpu.cores : prev.cpu?.cores || [],
          },
          gpu: data.gpu?.name ? data.gpu : prev.gpu,
          fps: data.fps?.available ? data.fps : prev.fps?.available ? prev.fps : data.fps,
        }
      })
    })
    const offSettings = window.eyed?.onSettings(setSettings)
    const offMoment = window.eyed?.onBadMoment(() => {
      void window.eyed?.getHistory().then((h) => {
        if (h) setHistory(h)
      })
    })
    return () => {
      offStats?.()
      offSettings?.()
      offMoment?.()
    }
  }, [])

  const patch = async (partial: Partial<AppSettings>) => {
    setSettings((prev) => ({ ...prev, ...partial }))
    try {
      if (!window.eyed?.setSettings) throw new Error('API no disponible. Reinicia la app.')
      const next = await window.eyed.setSettings(partial)
      if (next) setSettings(next)
      if ('discordPresence' in partial || 'discordPresenceMode' in partial) {
        void window.eyed.refreshDiscordPresence?.()
      }
    } catch (e) {
      showAlert(e instanceof Error ? e.message : 'No se pudo guardar el ajuste', 'Error')
    }
  }

  const goPlay = async () => {
    await patch({ overlayEnabled: true })
    try {
      await window.eyed?.hideToTray()
    } catch (e) {
      showAlert(e instanceof Error ? e.message : 'No se pudo minimizar', 'Error')
    }
  }

  const runClearCache = async () => {
    if (busyCache) return
    setBusyCache(true)
    setCacheLog('Limpiando cache de memoria RAM…')
    try {
      const res = await window.eyed?.clearRamCache()
      setCacheLog(
        res
          ? `${res.message} Procesos: ${res.processesTrimmed}. RAM libre ~${res.freeMb} MB.`
          : 'No se pudo limpiar la cache.',
      )
      const s = await window.eyed?.getStats()
      if (s) setStats(s)
    } catch (e) {
      setCacheLog(e instanceof Error ? e.message : 'Error al limpiar cache')
    } finally {
      setBusyCache(false)
    }
  }

  const runFullOptimize = async () => {
    if (busyOptimize) return
    setBusyOptimize(true)
    setOptLog('Optimizando sistema (RAM + temporales)…')
    try {
      const res = await window.eyed?.optimizeRam()
      setOptLog(
        res
          ? `${res.message} Procesos: ${res.processesTrimmed}. Temporales: ${res.tempFilesRemoved ?? 0}. RAM libre ~${res.freeMb} MB.`
          : 'No se pudo optimizar.',
      )
      const s = await window.eyed?.getStats()
      if (s) setStats(s)
    } catch (e) {
      setOptLog(e instanceof Error ? e.message : 'Error al optimizar')
    } finally {
      setBusyOptimize(false)
    }
  }

  const refreshProcs = async () => {
    if (procBusy) return
    setProcBusy(true)
    try {
      const list = (await window.eyed?.listProcesses()) || []
      setProcs(list)
    } catch {
      setProcs([])
    } finally {
      setProcBusy(false)
    }
  }

  const refreshDisk = async () => {
    if (diskBusy) return
    setDiskBusy(true)
    try {
      const info = await window.eyed?.getDiskInfo()
      if (info) setDiskInfo(info)
    } catch {
      setDiskInfo(null)
    } finally {
      setDiskBusy(false)
    }
  }

  const refreshSpecs = async () => {
    if (specsBusy) return
    setSpecsBusy(true)
    try {
      const info = await window.eyed?.getAdvancedSpecs()
      if (info) setSpecs(info)
    } catch {
      setSpecs(null)
    } finally {
      setSpecsBusy(false)
    }
  }

  const refreshApps = async () => {
    if (appsBusy) return
    setAppsBusy(true)
    setAppActionLog('Escaneando aplicaciones instaladas…')
    try {
      const list = (await window.eyed?.listApps()) || []
      setApps(list)
      setAppActionLog(`${list.length} aplicaciones detectadas.`)
    } catch (e) {
      setApps([])
      setAppActionLog(e instanceof Error ? e.message : 'No se pudieron listar las apps')
    } finally {
      setAppsBusy(false)
    }
  }

  const refreshNetwork = async () => {
    if (netBusy) return
    setNetBusy(true)
    try {
      const info = await window.eyed?.getNetworkInfo()
      if (info) setNetInfo(info)
    } catch {
      setNetInfo(null)
    } finally {
      setNetBusy(false)
    }
  }

  const runSpeedTest = async () => {
    if (speedBusy) return
    setSpeedBusy(true)
    setSpeedPhase('ping')
    setLiveMbps(0)
    setDownMbps(null)
    setUpMbps(null)
    setPingMs(null)
    setJitterMs(null)
    setSpeedLog('Midiendo ping…')
    let lastLiveAt = 0
    let lastLogAt = 0
    let lastPhase = ''
    const off = window.eyed?.onSpeedProgress((p: SpeedProgress) => {
      if (p.info) setNetInfo(p.info)
      const now = Date.now()
      const phaseChanged = p.phase !== lastPhase
      if (phaseChanged) lastPhase = p.phase || ''

      if (p.phase === 'ping') {
        if (phaseChanged) setSpeedPhase('ping')
        setLiveMbps(0)
        if (p.ping != null) setPingMs(p.ping)
        if (p.jitter != null) setJitterMs(p.jitter)
        if (phaseChanged || now - lastLogAt > 200) {
          lastLogAt = now
          setSpeedLog(
            p.ping != null
              ? `Ping ${p.ping} ms · jitter ${p.jitter ?? '--'}`
              : 'Analizando ping…',
          )
        }
      }
      if (p.phase === 'download') {
        if (phaseChanged) setSpeedPhase('download')
        if (p.mbps != null && (phaseChanged || now - lastLiveAt >= 120)) {
          lastLiveAt = now
          setLiveMbps(p.mbps)
        }
        if (phaseChanged || now - lastLogAt > 250) {
          lastLogAt = now
          if (p.mbps != null) setDownMbps(p.mbps)
          setSpeedLog(`Descarga… ${p.mbps?.toFixed?.(2) ?? '--'} Mbps`)
        }
      }
      if (p.phase === 'hold') {
        setSpeedPhase('hold')
        if (p.mbps != null) setLiveMbps(p.mbps)
        if (p.downloadMbps != null) setDownMbps(p.downloadMbps)
        if (p.uploadMbps != null) setUpMbps(p.uploadMbps)
        setSpeedLog(
          p.uploadMbps != null
            ? `Subida lista: ${p.uploadMbps.toFixed(2)} Mbps`
            : `Descarga lista: ${(p.downloadMbps ?? p.mbps ?? 0).toFixed(2)} Mbps`,
        )
      }
      if (p.phase === 'reset') {
        setSpeedPhase('reset')
        setLiveMbps(0)
        if (p.downloadMbps != null) setDownMbps(p.downloadMbps)
        setSpeedLog('Preparando subida…')
      }
      if (p.phase === 'upload') {
        if (phaseChanged) setSpeedPhase('upload')
        if (p.mbps != null && (phaseChanged || now - lastLiveAt >= 120)) {
          lastLiveAt = now
          setLiveMbps(p.mbps)
        }
        if (phaseChanged || now - lastLogAt > 250) {
          lastLogAt = now
          if (p.mbps != null) setUpMbps(p.mbps)
          setSpeedLog(`Subida… ${p.mbps?.toFixed?.(2) ?? '--'} Mbps`)
        }
      }
      if (p.phase === 'done') {
        setSpeedPhase('done')
        if (p.downloadMbps != null) setDownMbps(p.downloadMbps)
        if (p.uploadMbps != null) setUpMbps(p.uploadMbps)
        if (p.ping != null) setPingMs(p.ping)
        if (p.jitter != null) setJitterMs(p.jitter)
        // Aguja vuelve a 0; el resultado queda en las métricas ↓/↑
        setLiveMbps(0)
        setSpeedLog('Prueba completada.')
      }
    })
    try {
      const res = await window.eyed?.runSpeedTest()
      if (res?.ok) {
        setDownMbps(res.downloadMbps)
        setUpMbps(res.uploadMbps)
        setPingMs(res.ping)
        setJitterMs(res.jitter)
        if (res.info) setNetInfo(res.info)
        setLiveMbps(0)
        setSpeedPhase('done')
        setSpeedLog(
          `Listo · ↓ ${res.downloadMbps} Mbps · ↑ ${res.uploadMbps} Mbps · Ping ${res.ping ?? '--'} ms`,
        )
        void window.eyed?.addSpeedTestHistory(res).then((h) => {
          if (h) setHistory(h)
        })
      } else {
        setSpeedLog(res?.message || 'No se pudo completar el test.')
        setSpeedPhase('idle')
      }
    } catch (e) {
      setSpeedLog(e instanceof Error ? e.message : 'Error en speed test')
      setSpeedPhase('idle')
    } finally {
      off?.()
      setSpeedBusy(false)
    }
  }

  const openAppDetails = async (app: InstalledApp) => {
    setSelectedApp(app)
    setAppDetails(null)
    try {
      const details = await window.eyed?.getAppDetails(app)
      if (details) setAppDetails(details)
    } catch (e) {
      setAppActionLog(e instanceof Error ? e.message : 'No se pudieron obtener detalles')
    }
  }

  const doUninstall = async (removeFiles: boolean) => {
    if (!selectedApp) return
    const msg = removeFiles
      ? `Desinstalar "${selectedApp.name}" y borrar carpetas residuales detectadas?\nEsta accion no se puede deshacer.`
      : `Desinstalar "${selectedApp.name}"?`
    askConfirm({
      title: 'Desinstalar',
      message: msg,
      confirmLabel: 'Desinstalar',
      danger: true,
      action: async () => {
        setAppActionLog(removeFiles ? 'Desinstalando y limpiando archivos…' : 'Desinstalando…')
        try {
          const res = await window.eyed?.uninstallApp(selectedApp, { removeFiles })
          setAppActionLog(res?.message || 'Operacion finalizada.')
          await refreshApps()
          if (selectedApp) await openAppDetails(selectedApp)
        } catch (e) {
          setAppActionLog(e instanceof Error ? e.message : 'Error al desinstalar')
        }
      },
    })
  }

  const killSelected = async () => {
    if (!selectedProc) return
    askConfirm({
      title: 'Finalizar proceso',
      message: `Finalizar ${selectedProc.name} (${selectedProc.pid})?`,
      confirmLabel: 'Finalizar',
      danger: true,
      action: async () => {
        try {
          await window.eyed?.killProcess(selectedProc.pid)
          setSelectedProc(null)
          refreshProcs()
        } catch (err) {
          showAlert(err instanceof Error ? err.message : 'No se pudo finalizar', 'Error')
        }
      },
    })
  }

  useEffect(() => {
    if (page === 'processes') refreshProcs()
    if (page === 'disk') refreshDisk()
    if (page === 'specs') refreshSpecs()
    if (page === 'apps') refreshApps()
    if (page === 'network') refreshNetwork()
    if (page === 'home' && !specs) refreshSpecs()
    if (page === 'home' && !diskInfo) refreshDisk()
    if (page === 'insights' || page === 'home') {
      void window.eyed?.getHistory().then((h) => {
        if (h) setHistory(h)
      })
    }
    if (page === 'insights' && !diagnose) {
      void (async () => {
        setDiagnoseBusy(true)
        try {
          const d = await window.eyed?.diagnoseNow()
          if (d) setDiagnose(d)
        } finally {
          setDiagnoseBusy(false)
        }
      })()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  const runDiagnose = async () => {
    setDiagnoseBusy(true)
    try {
      const d = await window.eyed?.diagnoseNow()
      if (d) setDiagnose(d)
    } finally {
      setDiagnoseBusy(false)
    }
  }

  const runBufferbloat = async () => {
    if (bbloatBusy) return
    setBbloatBusy(true)
    setBbloat(null)
    try {
      const res = await window.eyed?.measureBufferbloat()
      if (res) setBbloat(res)
    } catch (e) {
      setBbloat({ ok: false, score: null, message: e instanceof Error ? e.message : 'Error' })
    } finally {
      setBbloatBusy(false)
    }
  }

  const alertMsg = useMemo(() => {
    if (!stats) return null
    const cpuT = stats.cpu?.temp
    const gpuT = stats.gpu?.temp
    const ramP = stats.ram?.percent
    const aCpu = settings.alertCpuTemp ?? 90
    const aGpu = settings.alertGpuTemp ?? 85
    const aRam = settings.alertRam ?? 90
    if (gpuT != null && gpuT >= aGpu) return { key: `gpu-${gpuT}`, text: `GPU a ${gpuT} °C (umbral ${aGpu} °C)` }
    if (cpuT != null && cpuT >= aCpu) return { key: `cpu-${cpuT}`, text: `CPU a ${cpuT} °C (umbral ${aCpu} °C)` }
    if (ramP != null && ramP >= aRam) return { key: `ram-${Math.round(ramP)}`, text: `RAM al ${ramP.toFixed(0)}% (umbral ${aRam}%)` }
    return null
  }, [stats, settings.alertCpuTemp, settings.alertGpuTemp, settings.alertRam])

  const healthScore = useMemo(() => {
    if (!stats) return 100
    let score = 100
    if ((stats.gpu?.temp ?? 0) >= 85) score -= 18
    else if ((stats.gpu?.temp ?? 0) >= 78) score -= 8
    if ((stats.cpu?.temp ?? 0) >= 90) score -= 14
    if ((stats.ram?.percent ?? 0) >= 90) score -= 16
    else if ((stats.ram?.percent ?? 0) >= 80) score -= 6
    if ((stats.disk?.percent ?? 0) >= 92) score -= 12
    if (diagnose?.primary?.severity === 'high') score -= 10
    return Math.max(12, Math.min(100, score))
  }, [stats, diagnose])

  const checklistItems = useMemo(() => {
    const items: Array<{ label: string; status: 'ok' | 'warn' | 'bad'; detail?: string }> = []
    const ping = pingMs
    items.push({
      label: 'Latencia',
      status: ping == null ? 'warn' : ping <= 40 ? 'ok' : ping <= 70 ? 'warn' : 'bad',
      detail: ping != null ? `${ping} ms` : 'Haz un speed test',
    })
    const gt = stats?.gpu?.temp
    items.push({
      label: 'Temp GPU',
      status: gt == null ? 'warn' : gt < 80 ? 'ok' : gt < 88 ? 'warn' : 'bad',
      detail: gt != null ? `${gt} °C` : 'Sin sensor',
    })
    const rp = stats?.ram?.percent
    items.push({
      label: 'RAM libre',
      status: rp == null ? 'warn' : rp < 80 ? 'ok' : rp < 90 ? 'warn' : 'bad',
      detail: rp != null ? `${(100 - rp).toFixed(0)}% libre` : '—',
    })
    const vt = stats?.gpu?.vramTotal || 0
    const vu = stats?.gpu?.vramUsed || 0
    const vp = vt > 0 ? (vu / vt) * 100 : null
    items.push({
      label: 'VRAM',
      status: vp == null ? 'warn' : vp < 85 ? 'ok' : vp < 95 ? 'warn' : 'bad',
      detail: vp != null ? `${vp.toFixed(0)}%` : '—',
    })
    items.push({
      label: 'Overlay',
      status: settings.overlayEnabled ? 'ok' : 'warn',
      detail: settings.overlayEnabled ? 'Activo' : 'Apagado',
    })
    return items
  }, [pingMs, stats, settings.overlayEnabled])

  const openDetail = (kind: DetailKind) => {
    setDetailModal(kind)
    if (!specs) void refreshSpecs()
    if (kind === 'disk' && !diskInfo) void refreshDisk()
  }

  const closeDetail = () => setDetailModal(null)

  const toggleProcSort = (col: typeof procSortCol) => {
    if (procSortCol === col) setProcSortRev((v) => !v)
    else {
      setProcSortCol(col)
      setProcSortRev(col === 'name' || col === 'description' ? false : true)
    }
  }

  const sortMark = (col: typeof procSortCol) => {
    if (procSortCol !== col) return ''
    return procSortRev ? ' ↓' : ' ↑'
  }

  const filteredProcs = useMemo(() => {
    const q = procQuery.trim().toLowerCase()
    let items = q
      ? procs.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            String(p.pid).includes(q) ||
            (p.description || '').toLowerCase().includes(q),
        )
      : [...procs]

    const key = (p: ProcessRow) => {
      if (procSortCol === 'name') return p.name.toLowerCase()
      if (procSortCol === 'pid') return p.pid
      if (procSortCol === 'cpu') return p.cpu
      if (procSortCol === 'mem') return p.memMb
      return (p.description || '').toLowerCase()
    }

    items.sort((a, b) => {
      const av = key(a)
      const bv = key(b)
      if (typeof av === 'string' && typeof bv === 'string') {
        const cmp = av.localeCompare(bv, 'es')
        return procSortRev ? -cmp : cmp
      }
      const cmp = Number(av) - Number(bv)
      return procSortRev ? -cmp : cmp
    })
    return items
  }, [procs, procQuery, procSortCol, procSortRev])

  const filteredApps = useMemo(() => {
    const q = appQuery.trim().toLowerCase()
    if (!q) return apps
    return apps.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        (a.publisher || '').toLowerCase().includes(q) ||
        (a.installLocation || '').toLowerCase().includes(q),
    )
  }, [apps, appQuery])

  const game = stats?.game
  const gpu = stats?.gpu
  const cpu = stats?.cpu
  const ram = stats?.ram
  const battery = stats?.battery
  const disk = stats?.disk
  const fps = stats?.fps
  const hasBattery = !!stats?.battery?.hasBattery

  const coreBars = useMemo(() => {
    const cores = cpu?.cores?.length ? cpu.cores : []
    return cores.slice(0, 16)
  }, [cpu])

  const cpuName = useMemo(() => {
    const n = cpu?.name || specs?.cpu?.name || 'CPU'
    return n.replace(/^\s*Intel\(R\)\s*/i, 'Intel ').replace(/\s*CPU\s*@.*$/i, '').replace(/\s+/g, ' ').trim()
  }, [cpu?.name, specs?.cpu?.name])

  const gpuName = useMemo(() => {
    const n = gpu?.name || specs?.gpus?.[0]?.name || 'GPU'
    return n
      .replace(/^NVIDIA GeForce\s*/i, '')
      .replace(/^NVIDIA\s*/i, '')
      .replace(/^AMD Radeon\s*/i, 'Radeon ')
      .replace(/\s+/g, ' ')
      .trim()
  }, [gpu?.name, specs?.gpus])

  const sourceLabel = (src?: string) => {
    const map: Record<string, string> = {
      registry: 'Clasica',
      appx: 'Store',
      apppath: 'App Path',
      shortcut: 'Acceso',
      folder: 'Carpeta',
    }
    return map[src || 'registry'] || src || 'Otro'
  }

  const navGroups: NavGroup[] = [
    {
      title: 'Principal',
      items: [
        { id: 'home', label: 'Dashboard', sub: 'System Monitor', icon: <IconHome size={16} /> },
        { id: 'games', label: 'Overlay', sub: 'Game OSD', icon: <IconGamepad size={16} /> },
        { id: 'insights', label: 'Insights', sub: 'Diagnostics', icon: <IconChart size={16} /> },
      ],
    },
    {
      title: 'Rendimiento',
      items: [
        { id: 'optimize', label: 'Optimizar', sub: 'System Boost', icon: <IconBolt size={16} /> },
        { id: 'cleanup', label: 'Limpieza', sub: 'Storage Cleaner', icon: <IconTrash size={16} /> },
        { id: 'processes', label: 'Procesos', sub: 'Task Manager', icon: <IconLayers size={16} /> },
        { id: 'labs', label: 'Labs', sub: 'Benchmarks', icon: <IconChart size={16} /> },
      ],
    },
    {
      title: 'Equipo',
      items: [
        { id: 'hardware', label: 'Hardware', sub: 'Hardware Monitor', icon: <IconGpu size={16} /> },
        { id: 'specs', label: 'Especificaciones', sub: 'Device Specs', icon: <IconInfo size={16} /> },
        { id: 'disk', label: 'Discos', sub: 'Storage Health', icon: <IconDisk size={16} /> },
        { id: 'network', label: 'Red', sub: 'Network Stats', icon: <IconWifi size={16} /> },
        ...(hasBattery
          ? [{ id: 'battery' as Page, label: 'Batería', sub: 'Battery Status', icon: <IconBattery size={16} /> }]
          : []),
      ],
    },
    {
      title: 'Sistema',
      items: [
        { id: 'startup', label: 'Arranque', sub: 'Startup Apps', icon: <IconPower size={16} /> },
        ...(platformCaps?.isWindows !== false
          ? [
              { id: 'drivers' as Page, label: 'Drivers', sub: 'Controllers', icon: <IconSettings size={16} /> },
              { id: 'events' as Page, label: 'Eventos', sub: 'BSOD / Logs', icon: <IconInfo size={16} /> },
            ]
          : []),
        { id: 'netlab', label: 'Red avanzada', sub: 'Network Lab', icon: <IconActivity size={16} /> },
        { id: 'apps', label: 'Aplicaciones', sub: 'Installed Apps', icon: <IconApps size={16} /> },
      ],
    },
  ]

  const systemStatus =
    healthScore >= 80 ? 'ÓPTIMO' : healthScore >= 60 ? 'ACEPTABLE' : 'CRÍTICO'

  const cpuHist = (history?.samples || []).slice(-24).map((s) => s.cpu)
  const gpuHist = (history?.samples || []).slice(-24).map((s) => s.gpu)
  const perfHist = (history?.samples || []).slice(-48).map((s) => {
    const parts = [s.cpu, s.gpu, s.ram].filter((v): v is number => v != null)
    if (!parts.length) return null
    return Math.round(parts.reduce((a, b) => a + b, 0) / parts.length)
  })
  const lastSpeed = history?.speedTests?.[0]

  return (
    <div className="shell">
      <header className="chrome">
        <div className="chrome-brand">
          <AppLogo size={22} />
          <strong>EyedOptimizer</strong>
        </div>
        <nav className="chrome-nav">
          <button
            type="button"
            className={page === 'home' || page === 'hardware' ? 'on' : ''}
            onClick={() => setPage('home')}
          >
            Monitoreo
          </button>
          <span className="dot">•</span>
          <button type="button" className={page === 'insights' ? 'on' : ''} onClick={() => setPage('insights')}>
            Datos
          </button>
          <span className="dot">•</span>
          <button
            type="button"
            className={page === 'labs' || page === 'network' ? 'on' : ''}
            onClick={() => setPage('labs')}
          >
            Estadísticas
          </button>
        </nav>
        <div className="chrome-status">
          <span className="shield" aria-hidden>
            ✓
          </span>
          Estado del sistema: <b>{systemStatus}</b>
        </div>
        <TitleBar />
      </header>

      <div className="app">
        <aside className="sidebar">
          <nav className="nav">
            {navGroups.map((group) => (
              <div className="nav-group" key={group.title}>
                <div className="nav-group-title">{group.title}</div>
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    className={page === item.id ? 'active' : ''}
                    onClick={() => setPage(item.id)}
                    type="button"
                  >
                    <span className="nav-ico">{item.icon}</span>
                    <span className="nav-copy">
                      <strong>{item.label}</strong>
                      <small>{item.sub}</small>
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </nav>

          <div className="side-foot">
            <div className="side-status">
              <div className="live-dot" />
              <div>
                <strong>En vivo</strong>
                <small>
                  CPU {cpu?.load?.toFixed(0) ?? '--'}% · RAM {ram?.percent?.toFixed(0) ?? '--'}%
                </small>
              </div>
            </div>

            <div className="side-tools">
              <button
                className={`side-tool ${page === 'settings' ? 'active' : ''}`}
                type="button"
                title="Configuración"
                onClick={() => setPage('settings')}
              >
                <IconSettings size={16} />
              </button>
              <button
                className="side-tool discord"
                type="button"
                title="Discord EyedComun"
                onClick={() => void window.eyed?.openDiscord()}
              >
                <IconDiscord size={18} />
              </button>
              <button className="side-tool" type="button" title="Segundo plano" onClick={() => window.eyed?.hideToTray()}>
                <IconTray size={16} />
              </button>
              <button className="side-tool danger" type="button" title="Salir" onClick={() => window.eyed?.quitApp()}>
                <IconPower size={16} />
              </button>
            </div>
          </div>
        </aside>

        <main className="content">
          {alertMsg && alertDismissed !== alertMsg.key ? (
            <div className="alert-banner">
              <span>{alertMsg.text}</span>
              <button type="button" onClick={() => setAlertDismissed(alertMsg.key)}>
                Ok
              </button>
            </div>
          ) : null}

          {page === 'home' && (
            <>
              <h1 className="dash-title">Dashboard de monitoreo del sistema</h1>
              <div className="dash-grid">
                <button type="button" className="mono-card" onClick={() => openDetail('cpu')}>
                  <div className="mono-card-head">
                    <strong>CPU</strong>
                    <em>{cpuName}</em>
                  </div>
                  <div className="mono-card-body">
                    <CircularGauge value={cpu?.load ?? 0} label="Uso de CPU" />
                    <div className="mono-side">
                      <div className="mono-kv">
                        <span>Temperaturas</span>
                        <b>{cpu?.temp != null && cpu.temp > 0 ? `${cpu.temp}°C` : '—'}</b>
                      </div>
                      <div className="h-bar mono-temp-bar">
                        <i
                          style={{
                            width: `${Math.min(100, Math.max(0, ((cpu?.temp ?? 0) - 30) * (100 / 70)))}%`,
                            background:
                              (cpu?.temp ?? 0) >= 90
                                ? 'var(--danger)'
                                : (cpu?.temp ?? 0) >= 75
                                  ? 'var(--ram)'
                                  : '#fff',
                          }}
                        />
                      </div>
                      <div style={{ height: 36 }}>
                        <Sparkline values={cpuHist} height={36} />
                      </div>
                      <div className="mono-kv">
                        <span>Frecuencia</span>
                        <b>
                          {cpu?.speed
                            ? `${cpu.speed.toFixed(1)} GHz`
                            : specs?.cpu?.maxMhz
                              ? `${(specs.cpu.maxMhz / 1000).toFixed(1)} GHz`
                              : '—'}
                        </b>
                      </div>
                    </div>
                  </div>
                </button>

                <button type="button" className="mono-card" onClick={() => openDetail('gpu')}>
                  <div className="mono-card-head">
                    <strong>GPU</strong>
                    <em>{gpuName}</em>
                  </div>
                  <div className="mono-card-body">
                    <CircularGauge value={gpu?.load ?? 0} label="Uso de GPU" />
                    <div className="mono-side">
                      <div className="mono-kv">
                        <span>Temperatura</span>
                        <b>{gpu?.temp != null ? `${gpu.temp}°C` : '—'}</b>
                      </div>
                      <div className="h-bar">
                        <i style={{ width: `${Math.min(100, gpu?.temp ?? 0)}%` }} />
                      </div>
                      <div className="mono-kv">
                        <span>VRAM</span>
                        <b>{gpu?.vramUsed != null ? `${(gpu.vramUsed / 1024).toFixed(1)} GB` : '—'}</b>
                      </div>
                      <div className="h-bar">
                        <i style={{ width: `${Math.min(100, gpu?.load ?? 0)}%` }} />
                      </div>
                      <div style={{ height: 28 }}>
                        <Sparkline values={gpuHist} height={28} />
                      </div>
                    </div>
                  </div>
                </button>

                <button type="button" className="mono-card" onClick={() => openDetail('ram')}>
                  <div className="mono-card-head">
                    <strong>RAM</strong>
                    <em>{ram?.percent?.toFixed(0) ?? '--'}%</em>
                  </div>
                  <div className="ram-big">
                    {ram?.usedMb != null ? (ram.usedMb / 1024).toFixed(1) : '--'}
                    <span>
                      {' '}
                      / {ram?.totalMb != null ? `${Math.round(ram.totalMb / 1024)} GB` : '—'}
                    </span>
                  </div>
                  <SegmentedBar value={ram?.percent ?? 0} />
                  <div className="mono-kv">
                    <span>Módulos</span>
                    <b>{specs?.ram?.modules?.length ?? '—'}</b>
                  </div>
                </button>

                <button type="button" className="mono-card" onClick={() => openDetail('disk')}>
                  <div className="mono-card-head">
                    <strong>Discos</strong>
                    <em>Storage</em>
                  </div>
                  <table className="disk-mini-table">
                    <thead>
                      <tr>
                        <th>Volumen</th>
                        <th>Uso</th>
                        <th>Libre</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(diskInfo?.volumes || []).slice(0, 3).map((v) => (
                        <tr key={v.mount || v.label}>
                          <td>{v.mount || v.label || '—'}</td>
                          <td>{v.percent != null ? `${Math.round(v.percent)}%` : '—'}</td>
                          <td>{v.freeLabel || (v.free != null ? `${(v.free / 1024 ** 3).toFixed(0)} GB` : '—')}</td>
                        </tr>
                      ))}
                      {!diskInfo?.volumes?.length ? (
                        <tr>
                          <td>{disk?.mount || 'C:'}</td>
                          <td>{disk?.percent != null ? `${disk.percent.toFixed(0)}%` : '—'}</td>
                          <td>{disk?.freeGb != null ? `${disk.freeGb.toFixed(0)} GB` : '—'}</td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </button>

                <button type="button" className="mono-card" onClick={() => setPage('network')}>
                  <div className="mono-card-head">
                    <strong>Red</strong>
                    <em>Network</em>
                  </div>
                  <div className="net-row">
                    <span>Bajada</span>
                    <strong>
                      {lastSpeed?.downloadMbps != null ? `${Number(lastSpeed.downloadMbps).toFixed(0)}` : '—'} Mbps
                    </strong>
                  </div>
                  <div className="net-row">
                    <span>Subida</span>
                    <strong>
                      {lastSpeed?.uploadMbps != null ? `${Number(lastSpeed.uploadMbps).toFixed(0)}` : '—'} Mbps
                    </strong>
                  </div>
                  <div className="net-row">
                    <span>Ping</span>
                    <strong>{pingMs != null ? `${pingMs} ms` : '—'}</strong>
                  </div>
                </button>

                <button type="button" className="mono-card" onClick={() => setPage('hardware')}>
                  <div className="mono-card-head">
                    <strong>Ventiladores</strong>
                    <em>Fans</em>
                  </div>
                  <div className="fan-row-mono">
                    <span>CPU</span>
                    <strong>{cpu?.temp != null && cpu.temp > 0 ? `${cpu.temp}°C` : 'N/D'}</strong>
                  </div>
                  <div className="fan-row-mono">
                    <span>GPU</span>
                    <strong>{gpu?.fan != null ? `${gpu.fan}%` : 'N/D'}</strong>
                  </div>
                  <div className="fan-row-mono">
                    <span>Salud</span>
                    <strong>{healthScore}/100</strong>
                  </div>
                </button>

                <div className="mono-card static dash-wide">
                  <div className="mono-card-head">
                    <strong>Rendimiento general</strong>
                    <em>History</em>
                  </div>
                  <div style={{ height: 72 }}>
                    <Sparkline values={perfHist} height={72} />
                  </div>
                  <div className="quick-bar">
                    <button type="button" className="quick-btn" onClick={() => setPage('games')}>
                      <IconGamepad size={16} /> Overlay
                    </button>
                    <button type="button" className="quick-btn" onClick={() => setPage('optimize')}>
                      <IconBolt size={16} /> Optimizar
                    </button>
                    <button type="button" className="quick-btn" onClick={() => setPage('disk')}>
                      <IconDisk size={16} /> Disco
                    </button>
                    <button type="button" className="quick-btn" onClick={() => setPage('network')}>
                      <IconWifi size={16} /> Internet
                    </button>
                    <button
                      type="button"
                      className="quick-btn"
                      onClick={() => void runClearCache()}
                      disabled={busyCache}
                    >
                      <IconRam size={16} /> {busyCache ? '…' : 'Cache RAM'}
                    </button>
                    <button type="button" className="quick-btn" onClick={() => void goPlay()}>
                      <IconEye size={16} /> Ir a jugar
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}

          {page === 'insights' && (
            <>
              <PageHeader
                eyebrow="Analisis"
                title="Insights"
                subtitle="Historial, timeline, diagnostico y momentos malos"
              >
                <button className="btn ghost" type="button" disabled={diagnoseBusy} onClick={() => void runDiagnose()}>
                  {diagnoseBusy ? '…' : 'Diagnosticar'}
                </button>
                <button
                  className="btn ghost"
                  type="button"
                  onClick={() => {
                    askConfirm({
                      title: 'Borrar historial',
                      message: '¿Borrar historial local?',
                      confirmLabel: 'Borrar',
                      danger: true,
                      action: () => {
                        void window.eyed?.clearHistory().then((h) => setHistory(h))
                      },
                    })
                  }}
                >
                  Limpiar
                </button>
              </PageHeader>

              <div className="grid grid-2">
                <div className="card">
                  <div className="section-title">¿Por que va mal?</div>
                  <DiagnoseCard data={diagnose} />
                </div>
                <div className="card">
                  <div className="section-title">Checklist pre-ranked</div>
                  <ChecklistPanel items={checklistItems} />
                </div>
              </div>

              <div className="card" style={{ marginTop: 14 }}>
                <div className="section-title">Sesion (CPU / GPU / RAM / FPS)</div>
                <MultiSpark samples={history?.samples || []} />
              </div>

              <div className="grid grid-2" style={{ marginTop: 14 }}>
                <div className="card">
                  <div className="section-title">Timeline del dia</div>
                  <TimelineBar segments={history?.timeline || []} />
                </div>
                <div className="card">
                  <div className="section-title">Momentos malos</div>
                  <MomentsList moments={history?.moments || []} />
                </div>
              </div>
            </>
          )}

          {page === 'battery' && (
            <>
              <PageHeader
                eyebrow="Monitor"
                title="Bateria"
                subtitle="Estado de carga (solo si hay bateria en el equipo)"
              >
                <button className="btn ghost" type="button" onClick={() => setPage('specs')}>
                  <IconInfo size={16} /> Ver hardware
                </button>
              </PageHeader>

              <div className="grid grid-2">
                <div className="card battery-hero-card">
                  <div className="section-title">
                    <IconBattery size={16} /> Estado
                  </div>
                  <div className="battery-hero">
                    <BatteryBig
                      percent={battery?.percent ?? 0}
                      charging={!!battery?.isCharging}
                      size={220}
                    />
                  </div>
                  <div className="card-sub" style={{ textAlign: 'center', marginTop: 8 }}>
                    {battery?.isCharging ? 'Cargando' : 'Usando bateria'} ·{' '}
                    {battery?.acConnected ? 'Con AC' : 'Sin AC'}
                  </div>
                  <p className="hint" style={{ marginTop: 12, textAlign: 'center' }}>
                    Tiempo restante:{' '}
                    {battery?.timeRemaining != null
                      ? `${Math.floor(battery.timeRemaining / 3600)}h ${Math.floor((battery.timeRemaining % 3600) / 60)}m`
                      : 'N/D'}
                  </p>
                </div>

                <div className="card">
                  <div className="section-title">
                    <IconInfo size={16} /> Detalles
                  </div>
                  <div className="spec-grid">
                    <div>
                      <small>Estado</small>
                      <strong>{battery?.isCharging ? 'Cargando' : battery?.hasBattery ? 'En uso' : 'N/D'}</strong>
                    </div>
                    <div>
                      <small>Porcentaje</small>
                      <strong>{battery?.percent != null ? battery.percent : 'N/D'}%</strong>
                    </div>
                    <div>
                      <small>Potencia</small>
                      <strong>
                        {battery?.powerW == null
                          ? 'N/D'
                          : `${Math.abs(battery.powerW)} W ${battery.powerW > 0 ? '(carga)' : battery.powerW < 0 ? '(descarga)' : ''}`}
                      </strong>
                    </div>
                    <div>
                      <small>Voltaje</small>
                      <strong>{battery?.voltage != null ? `${battery.voltage} V` : 'N/D'}</strong>
                    </div>
                    <div>
                      <small>Capacidad actual</small>
                      <strong>{battery?.currentWh != null ? `${battery.currentWh} Wh` : 'N/D'}</strong>
                    </div>
                    <div>
                      <small>Capacidad plena</small>
                      <strong>{battery?.fullWh != null ? `${battery.fullWh} Wh` : 'N/D'}</strong>
                    </div>
                    <div>
                      <small>Capacidad de diseno</small>
                      <strong>{battery?.designWh != null ? `${battery.designWh} Wh` : 'N/D'}</strong>
                    </div>
                    <div>
                      <small>Salud</small>
                      <strong>{battery?.healthPercent != null ? `${battery.healthPercent}%` : 'N/D'}</strong>
                    </div>
                    <div>
                      <small>Con AC</small>
                      <strong>{battery?.acConnected == null ? 'N/D' : battery.acConnected ? 'Si' : 'No'}</strong>
                    </div>
                    <div>
                      <small>Ciclos</small>
                      <strong>{battery?.cycleCount != null ? battery.cycleCount : 'N/D'}</strong>
                    </div>
                    <div>
                      <small>Modelo</small>
                      <strong>{battery?.model || 'N/D'}</strong>
                    </div>
                    <div>
                      <small>Tiempo restante</small>
                      <strong>
                        {battery?.timeRemaining == null
                          ? 'N/D'
                          : `${Math.floor(battery.timeRemaining / 60)} min`}
                      </strong>
                    </div>
                  </div>
                  <p className="hint" style={{ marginTop: 14 }}>
                    Wh = capacidad energetica. W = potencia de carga/descarga en tiempo real.
                  </p>
                </div>
              </div>
            </>
          )}

          {page === 'network' && (
            <>
              <PageHeader
                eyebrow="Monitor"
                title="Internet"
                subtitle="Speed test: 15 s ping · 15 s descarga · 15 s subida"
              >
                <button className="btn ghost" type="button" onClick={() => void refreshNetwork()} disabled={netBusy}>
                  <IconRefresh size={16} /> {netBusy ? 'Actualizando…' : 'Actualizar info'}
                </button>
                {speedBusy ? (
                  <button
                    className="btn danger"
                    type="button"
                    onClick={() => void window.eyed?.cancelSpeedTest()}
                  >
                    Cancelar
                  </button>
                ) : (
                  <button className="btn primary" type="button" onClick={() => void runSpeedTest()}>
                    <IconWifi size={16} /> Iniciar test
                  </button>
                )}
              </PageHeader>

              <div className="speed-top">
                <div className="speed-metric">
                  <div className="speed-metric-label">
                    <IconDownload size={14} /> Descarga
                  </div>
                  <strong>{downMbps != null ? downMbps.toFixed(2) : '--'}</strong>
                  <span>Mbps</span>
                </div>
                <div className="speed-metric">
                  <div className="speed-metric-label">
                    <IconUpload size={14} /> Subida
                  </div>
                  <strong>{upMbps != null ? upMbps.toFixed(2) : '--'}</strong>
                  <span>Mbps</span>
                </div>
              </div>

              <div className="card speed-card">
                <div className="speed-latency">
                  <div>
                    <small>Ping</small>
                    <strong>{pingMs != null ? `${pingMs} ms` : '--'}</strong>
                  </div>
                  <div>
                    <small>Jitter</small>
                    <strong>{jitterMs != null ? `${jitterMs} ms` : '--'}</strong>
                  </div>
                  <div>
                    <small>Fase</small>
                    <strong>
                      {speedPhase === 'idle'
                        ? 'En espera'
                        : speedPhase === 'ping'
                          ? 'Latencia'
                          : speedPhase === 'download'
                            ? 'Descarga'
                            : speedPhase === 'hold'
                              ? 'Pausa'
                              : speedPhase === 'reset'
                                ? 'Reinicio'
                                : speedPhase === 'upload'
                                  ? 'Subida'
                                  : 'Hecho'}
                    </strong>
                  </div>
                </div>

                <SpeedGauge value={liveMbps} phase={speedPhase} />
                <p className="hint" style={{ textAlign: 'center', marginTop: 4 }}>
                  {speedLog}
                </p>
              </div>

              <div className="grid grid-2" style={{ marginTop: 14 }}>
                <div className="card">
                  <div className="section-title">
                    <IconWifi size={16} /> Conexion / IP
                  </div>
                  <div className="spec-grid">
                    <div>
                      <small>IP publica</small>
                      <strong>{netInfo?.publicIp || 'N/D'}</strong>
                    </div>
                    <div>
                      <small>Proveedor (ISP)</small>
                      <strong>{netInfo?.isp || 'N/D'}</strong>
                    </div>
                    <div>
                      <small>Ciudad</small>
                      <strong>
                        {[netInfo?.city, netInfo?.country].filter(Boolean).join(', ') || 'N/D'}
                      </strong>
                    </div>
                    <div>
                      <small>ASN</small>
                      <strong>{netInfo?.asn || 'N/D'}</strong>
                    </div>
                    <div>
                      <small>IP local</small>
                      <strong>{netInfo?.interface?.ipv4 || 'N/D'}</strong>
                    </div>
                    <div>
                      <small>Adaptador</small>
                      <strong>{netInfo?.interface?.name || 'N/D'}</strong>
                    </div>
                    <div>
                      <small>Tipo</small>
                      <strong>{netInfo?.interface?.type || 'N/D'}</strong>
                    </div>
                    <div>
                      <small>Vel. enlace</small>
                      <strong>
                        {netInfo?.interface?.speed != null ? `${netInfo.interface.speed} Mbps` : 'N/D'}
                      </strong>
                    </div>
                  </div>
                </div>

                <div className="card">
                  <div className="section-title">
                    <IconInfo size={16} /> Calidad estimada
                  </div>
                  <div className="net-quality">
                    {(
                      [
                        ['Web', downMbps, pingMs, upMbps],
                        ['Juegos', downMbps, pingMs, upMbps],
                        ['Streaming', downMbps, pingMs, upMbps],
                        ['Llamadas', downMbps, pingMs, upMbps],
                      ] as const
                    ).map(([label, down, ping, up]) => {
                      const hasData = down != null || ping != null
                      let score = 0
                      let grade = 'Sin test'
                      if (hasData) {
                        const d = down ?? 0
                        const p = ping ?? 999
                        const u = up ?? 0
                        if (label === 'Web') {
                          score = d >= 20 && p < 60 ? 5 : d >= 10 && p < 100 ? 4 : d >= 5 ? 3 : 2
                        } else if (label === 'Juegos') {
                          score = p <= 35 && d >= 20 ? 5 : p <= 50 && d >= 10 ? 4 : p <= 80 ? 3 : 1
                        } else if (label === 'Streaming') {
                          score = d >= 50 ? 5 : d >= 25 ? 4 : d >= 10 ? 3 : 2
                        } else {
                          score = p <= 50 && u >= 5 ? 5 : p <= 80 && u >= 2 ? 4 : p <= 120 ? 3 : 2
                        }
                        grade =
                          score >= 5 ? 'Excelente' : score >= 4 ? 'Buena' : score >= 3 ? 'Aceptable' : score >= 2 ? 'Baja' : 'Mala'
                      }
                      return (
                        <div key={label} className="net-quality-row">
                          <span className="net-quality-label">{label}</span>
                          <div className="net-dots" title={grade} aria-label={grade}>
                            {Array.from({ length: 5 }).map((_, i) => (
                              <i key={i} className={i < score ? 'on' : ''} />
                            ))}
                          </div>
                          <em className="net-quality-grade">{grade}</em>
                        </div>
                      )
                    })}
                  </div>
                  <p className="hint" style={{ marginTop: 12 }}>
                    Estimacion orientativa segun ping/descarga/subida del ultimo test.
                  </p>
                </div>
              </div>

              <div className="grid grid-2" style={{ marginTop: 14 }}>
                <div className="card">
                  <div className="section-title">Historial de speed tests</div>
                  <SpeedHistoryList entries={history?.speedTests || []} />
                </div>
                <div className="card">
                  <div className="section-title">Bufferbloat</div>
                  <p className="hint">Mide cuanto sube el ping bajo carga (algo que Windows no te muestra).</p>
                  <button
                    className="btn primary"
                    type="button"
                    style={{ marginTop: 12 }}
                    disabled={bbloatBusy}
                    onClick={() => void runBufferbloat()}
                  >
                    {bbloatBusy ? 'Midiendo…' : 'Probar bufferbloat'}
                  </button>
                  {bbloat?.ok && bbloat.score ? (
                    <div style={{ marginTop: 16 }}>
                      <div className={`bbloat-score grade-${bbloat.score}`}>{bbloat.score}</div>
                      <div className="card-sub">
                        Idle {bbloat.idlePing} ms → carga {bbloat.loadPing} ms (Δ {bbloat.delta} ms)
                      </div>
                      <p className="hint" style={{ marginTop: 8 }}>
                        {bbloat.label}
                      </p>
                    </div>
                  ) : null}
                  {bbloat && !bbloat.ok ? (
                    <p className="hint" style={{ marginTop: 10 }}>
                      {bbloat.message || 'No se pudo medir'}
                    </p>
                  ) : null}
                </div>
              </div>
            </>
          )}

          {page === 'games' && (
            <>
              <PageHeader
                eyebrow="Rendimiento"
                title="Overlay / Juegos"
                subtitle="OSD anclado al juego. Aparece automaticamente al detectar un juego."
              >
                <button className="btn primary" type="button" onClick={() => void goPlay()}>
                  <IconTray size={16} /> Minimizar y jugar
                </button>
              </PageHeader>

              <div className="grid grid-2">
                <div className="card">
                  <div className="section-title">
                    <IconGamepad size={16} /> Deteccion / portada
                  </div>
                  <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                    {game?.cover ? (
                      <img
                        src={game.cover}
                        alt=""
                        width={72}
                        height={72}
                        style={{ borderRadius: 14, objectFit: 'cover', border: '1px solid var(--border)' }}
                      />
                    ) : (
                      <div
                        style={{
                          width: 72,
                          height: 72,
                          borderRadius: 14,
                          background: 'rgba(255,255,255,0.04)',
                          border: '1px solid var(--border)',
                          display: 'grid',
                          placeItems: 'center',
                        }}
                      >
                        <IconGamepad size={28} />
                      </div>
                    )}
                    <div>
                      <div className="card-value" style={{ fontSize: 22 }}>
                        {game?.active ? game.title || game.processName || 'Juego detectado' : 'Esperando juego…'}
                      </div>
                      {game?.active && game?.processName ? (
                        <div className="card-sub" style={{ marginTop: 4 }}>
                          {game.processName}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="control-list" style={{ marginTop: 18 }}>
                    <div className="control-row">
                      <div>
                        <strong>Overlay en juegos</strong>
                        <div className="hint">Muestra el OSD al detectar un juego</div>
                      </div>
                      <Toggle
                        on={settings.overlayEnabled}
                        label="Overlay"
                        onClick={() => void patch({ overlayEnabled: !settings.overlayEnabled })}
                      />
                    </div>
                    <div className="control-row">
                      <div>
                        <strong>Vista previa en app</strong>
                        <div className="hint">Muestra el OSD dentro de esta ventana</div>
                      </div>
                      <Toggle
                        on={settings.gameActive}
                        label="Preview"
                        onClick={() => void patch({ gameActive: !settings.gameActive })}
                      />
                    </div>
                    <div className="control-row">
                      <div>
                        <strong>Captura FPS</strong>
                        <div className="hint">
                          Se activa sola con el overlay. Si sigue en --, acepta el UAC (una vez) o pulsa aquí.
                        </div>
                      </div>
                      <button
                        className="btn primary"
                        type="button"
                        onClick={() => {
                          void window.eyed?.elevateFps?.().then((r) => {
                            showAlert(
                              r?.message || (r?.ok ? 'FPS activo' : 'No se pudo activar FPS'),
                              r?.ok ? 'FPS' : 'Error',
                            )
                          })
                        }}
                      >
                        Forzar FPS
                      </button>
                    </div>
                  </div>
                </div>

                <div className="card">
                  <div className="section-title">
                    <IconActivity size={16} /> Vista previa OSD
                  </div>
                  {settings.gameActive ? (
                    <div className="osd-embed">
                      <div className="osd-embed-row">
                        <span className="g">{gpu?.name?.replace('NVIDIA GeForce ', '') || 'GPU'}</span>
                        <b>
                          {gpu?.load ?? 0}% {gpu?.temp ?? '--'}C {gpu?.power ?? '--'}W
                        </b>
                      </div>
                      <div className="osd-embed-row">
                        <span className="g">VRAM</span>
                        <b>{gpu?.vramUsed ?? 0} MB</b>
                      </div>
                      <div className="osd-embed-row">
                        <span className="c">{cpuName}</span>
                        <b>{cpu?.load ?? 0}%</b>
                      </div>
                      <div className="osd-embed-row">
                        <span className="c">RAM</span>
                        <b>{ram?.usedMb ?? 0} MB</b>
                      </div>
                      {fps?.available ? (
                        <div className="osd-embed-row">
                          <span className="f">FPS</span>
                          <b>{fps.fps}</b>
                        </div>
                      ) : (
                        <p className="hint" style={{ marginTop: 10 }}>
                          FPS:{' '}
                          {fps?.presentMon === false
                            ? 'Falta PresentMon'
                            : fps?.error || 'Esperando frames del juego'}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="hint">Activa la vista previa para ver el OSD aqui.</p>
                  )}
                </div>
              </div>
            </>
          )}

          {page === 'optimize' && (
            <>
              <PageHeader
                eyebrow="Rendimiento"
                title="Optimizar"
                subtitle="Dos acciones distintas: limpiar cache RAM (rapido) u optimizar todo el sistema"
              >
                <button className="btn ghost" type="button" onClick={() => setPage('disk')}>
                  <IconDisk size={16} /> Ver disco
                </button>
              </PageHeader>

              <div className="optimize-dual">
                <div className="card optimize-action">
                  <div className="section-title">
                    <IconRam size={16} /> Limpiar cache RAM
                  </div>
                  <p className="hint">
                    Accion rapida: intenta purgar la cache en espera de Windows y reduce working sets
                    de procesos inactivos. No borra archivos.
                  </p>
                  <div className="card-value">{ram?.percent?.toFixed(0) ?? '--'}%</div>
                  <div className="card-sub">
                    {ram?.usedMb ?? '--'} MB / {ram?.totalMb ?? '--'} MB en uso
                  </div>
                  <div className="bar" style={{ marginTop: 12 }}>
                    <span style={{ width: `${ram?.percent ?? 0}%`, background: 'var(--ram)' }} />
                  </div>
                  <div className="opt-result">
                    <IconRam size={16} />
                    <span>{cacheLog}</span>
                  </div>
                  <button
                    className="btn primary"
                    style={{ marginTop: 14, width: '100%' }}
                    type="button"
                    disabled={busyCache}
                    onClick={runClearCache}
                  >
                    <IconRam size={16} /> {busyCache ? 'Limpiando cache…' : 'Limpiar cache RAM'}
                  </button>
                </div>

                <div className="card optimize-action">
                  <div className="section-title">
                    <IconBolt size={16} /> Optimizar sistema
                  </div>
                  <p className="hint">
                    Working set (EmptyWorkingSet) + temporales. Puede pedir admin una vez para purgar
                    la standby list (efecto real en RAM).
                  </p>
                  <div className="metric-list" style={{ marginTop: 10 }}>
                    <div className="metric-row">
                      <div className="metric-row-top">
                        <span>CPU</span>
                        <strong>
                          {cpu?.load?.toFixed(0) ?? '--'}%
                          {cpu?.temp != null && cpu.temp > 0 ? ` · ${cpu.temp}°C` : ''}
                        </strong>
                      </div>
                      <div className="h-bar">
                        <i style={{ width: `${Math.min(100, cpu?.load ?? 0)}%` }} />
                      </div>
                    </div>
                    <div className="metric-row">
                      <div className="metric-row-top">
                        <span>GPU</span>
                        <strong>
                          {gpu?.load?.toFixed(0) ?? '--'}%
                          {gpu?.temp != null && gpu.temp > 0 ? ` · ${gpu.temp}°C` : ''}
                        </strong>
                      </div>
                      <div className="h-bar">
                        <i style={{ width: `${Math.min(100, gpu?.load ?? 0)}%` }} />
                      </div>
                    </div>
                    <div className="metric-row">
                      <div className="metric-row-top">
                        <span>Disco</span>
                        <strong>{disk?.percent?.toFixed(0) ?? '--'}%</strong>
                      </div>
                      <div className="h-bar">
                        <i style={{ width: `${Math.min(100, disk?.percent ?? 0)}%` }} />
                      </div>
                    </div>
                    <div className="metric-row">
                      <div className="metric-row-top">
                        <span>RAM libre</span>
                        <strong>{ram ? `${ram.totalMb - ram.usedMb} MB` : '--'}</strong>
                      </div>
                      <div className="h-bar">
                        <i
                          style={{
                            width: `${ram ? Math.min(100, 100 - (ram.percent ?? 0)) : 0}%`,
                            background: 'var(--ram)',
                          }}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="opt-result">
                    <IconBolt size={16} />
                    <span>{optLog}</span>
                  </div>
                  <button
                    className="btn primary"
                    style={{ marginTop: 14, width: '100%' }}
                    type="button"
                    disabled={busyOptimize}
                    onClick={runFullOptimize}
                  >
                    <IconBolt size={16} /> {busyOptimize ? 'Optimizando…' : 'Optimizar ahora'}
                  </button>
                </div>
              </div>
            </>
          )}

          {page === 'disk' && (
            <>
              <PageHeader
                eyebrow="Monitor"
                title="Disco"
                subtitle="Uso de volumenes y salud / vida util de discos fisicos"
              >
                <button className="btn ghost" type="button" disabled={diskBusy} onClick={refreshDisk}>
                  <IconRefresh size={16} /> {diskBusy ? 'Leyendo…' : 'Actualizar'}
                </button>
              </PageHeader>

              <div className="disk-grid">
                {(diskInfo?.volumes || []).map((v) => (
                  <div className="card" key={v.mount}>
                    <div className="section-title">
                      <IconDisk size={16} /> {v.mount} {v.label ? `· ${v.label}` : ''}
                    </div>
                    <div className="card-value">{v.percent}%</div>
                    <div className="card-sub">
                      {v.usedLabel} / {v.totalLabel} · libre {v.freeLabel}
                    </div>
                    <div className="bar" style={{ marginTop: 14 }}>
                      <span
                        style={{
                          width: `${v.percent}%`,
                          background:
                            v.percent > 90 ? 'var(--danger)' : v.percent > 75 ? 'var(--ram)' : 'var(--disk)',
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="card" style={{ marginTop: 14 }}>
                <div className="section-title">
                  <IconActivity size={16} /> Salud y vida util
                </div>
                {(diskInfo?.disks || []).length ? (
                  <div className="disk-health-list">
                    {(diskInfo?.disks || []).map((d, i) => (
                      <div className="disk-health-card" key={`${d.name}-${i}`}>
                        <div className="disk-health-top">
                          <div>
                            <strong>{d.name}</strong>
                            <div className="hint">
                              {d.media} · {d.bus} · {d.sizeLabel}
                            </div>
                          </div>
                          <div className="disk-health-status">
                            <span className="disk-health-pct">
                              {d.healthPercent != null ? `${d.healthPercent}%` : 'N/D'}
                            </span>
                            <span className={`health-pill ${d.status}`}>{d.statusLabel}</span>
                          </div>
                        </div>
                        <div className="disk-health-bars">
                          <div className="disk-health-bar-row">
                            <small>Salud</small>
                            <div className="bar">
                              <span
                                style={{
                                  width: `${d.healthPercent ?? 0}%`,
                                  background:
                                    d.status === 'critical'
                                      ? 'var(--danger)'
                                      : d.status === 'warning'
                                        ? 'var(--ram)'
                                        : 'var(--ok)',
                                }}
                              />
                            </div>
                            <strong>{d.healthPercentLabel}</strong>
                          </div>
                          <div className="disk-health-bar-row">
                            <small>Vida util</small>
                            <div className="bar">
                              <span
                                style={{
                                  width: `${d.lifePercent ?? 0}%`,
                                  background: 'var(--disk)',
                                }}
                              />
                            </div>
                            <strong>{d.lifePercent != null ? `${d.lifePercent}%` : 'N/D'}</strong>
                          </div>
                        </div>
                        <div className="disk-health-meta">
                          <span>
                            <em>SMART</em>
                            {d.health || 'N/D'}
                          </span>
                          <span>
                            <em>Temp</em>
                            {d.temperature != null ? `${d.temperature} °C` : 'N/D'}
                          </span>
                          <span>
                            <em>Horas</em>
                            {d.powerOnHours != null ? `${d.powerOnHours} h` : 'N/D'}
                          </span>
                          <span>
                            <em>Estado</em>
                            {d.operational || 'N/D'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="hint">
                    {diskBusy ? 'Consultando discos…' : 'SMART/vida util no disponible en este equipo.'}
                  </p>
                )}
              </div>
              <DiskTools letter={(diskInfo?.primary?.mount || disk?.mount || 'C:').replace(':', '')} />
            </>
          )}

          {page === 'specs' && (
            <>
              <PageHeader
                eyebrow="Monitor"
                title="Hardware"
                subtitle="Especificaciones avanzadas y uso actual"
              >
                <button className="btn ghost" type="button" onClick={() => setPage('disk')}>
                  <IconDisk size={16} /> Disco
                </button>
                <button className="btn ghost" type="button" disabled={specsBusy} onClick={refreshSpecs}>
                  <IconRefresh size={16} /> {specsBusy ? 'Cargando…' : 'Actualizar'}
                </button>
              </PageHeader>

              <div className="grid grid-2">
                <div className="card">
                  <div className="section-title">
                    <IconInfo size={16} /> Equipo
                  </div>
                  <div className="spec-grid">
                    <div>
                      <small>Fabricante</small>
                      <strong>{specs?.device.manufacturer || '—'}</strong>
                    </div>
                    <div>
                      <small>Modelo</small>
                      <strong>{specs?.device.model || '—'}</strong>
                    </div>
                    <div>
                      <small>Placa</small>
                      <strong>{specs?.device.board || '—'}</strong>
                    </div>
                    <div>
                      <small>BIOS</small>
                      <strong>{specs?.device.bios || '—'}</strong>
                    </div>
                    <div>
                      <small>Hostname</small>
                      <strong>{specs?.device.hostname || '—'}</strong>
                    </div>
                    <div>
                      <small>Usuario</small>
                      <strong>{specs?.device.username || '—'}</strong>
                    </div>
                  </div>
                </div>
                <div className="card">
                  <div className="section-title">
                    <IconSettings size={16} /> Sistema
                  </div>
                  <div className="spec-grid">
                    <div>
                      <small>SO</small>
                      <strong>{specs?.os.name || '—'}</strong>
                    </div>
                    <div>
                      <small>Build</small>
                      <strong>{specs?.os.build || '—'}</strong>
                    </div>
                    <div>
                      <small>Arquitectura</small>
                      <strong>{specs?.os.arch || '—'}</strong>
                    </div>
                    <div>
                      <small>Instalacion</small>
                      <strong>{specs?.os.installDate || '—'}</strong>
                    </div>
                    <div>
                      <small>Ultimo arranque</small>
                      <strong>{specs?.os.lastBoot || '—'}</strong>
                    </div>
                    <div>
                      <small>Version</small>
                      <strong>{specs?.os.version || '—'}</strong>
                    </div>
                  </div>
                </div>
                <div className="card">
                  <div className="section-title">
                    <IconCpu size={16} /> CPU · {cpu?.load?.toFixed(0) ?? '--'}%
                  </div>
                  <div className="spec-grid">
                    <div>
                      <small>Procesador</small>
                      <strong title={specs?.cpu.name}>{specs?.cpu.name || cpuName}</strong>
                    </div>
                    <div>
                      <small>Nucleos / hilos</small>
                      <strong>
                        {specs?.cpu.cores ?? '—'} / {specs?.cpu.threads ?? '—'}
                      </strong>
                    </div>
                    <div>
                      <small>Max MHz</small>
                      <strong>{specs?.cpu.maxMhz || '—'}</strong>
                    </div>
                    <div>
                      <small>Socket</small>
                      <strong>{specs?.cpu.socket || '—'}</strong>
                    </div>
                  </div>
                </div>
                <div className="card">
                  <div className="section-title">
                    <IconRam size={16} /> RAM · {ram?.percent?.toFixed(0) ?? specs?.ram?.percent ?? '--'}%
                  </div>
                  <div className="spec-grid">
                    <div>
                      <small>Total</small>
                      <strong>{specs?.ram.totalLabel || `${ram?.totalMb ?? '--'} MB`}</strong>
                    </div>
                    <div>
                      <small>En uso</small>
                      <strong>{specs?.ram.usedLabel || `${ram?.usedMb ?? '--'} MB`}</strong>
                    </div>
                    <div>
                      <small>Disponible</small>
                      <strong>{specs?.ram.availableLabel || '—'}</strong>
                    </div>
                    <div>
                      <small>Modulos</small>
                      <strong>{specs?.ram.modules?.length ?? 0}</strong>
                    </div>
                  </div>
                  {(specs?.ram.modules || []).slice(0, 4).map((m, i) => (
                    <p className="hint" key={`ram-${i}`} style={{ marginTop: 8 }}>
                      {m.bank || `DIMM ${i + 1}`}: {m.capacityLabel} · {m.speed || '—'} MHz ·{' '}
                      {m.manufacturer || m.part || ''}
                    </p>
                  ))}
                </div>
                <div className="card">
                  <div className="section-title">
                    <IconGpu size={16} /> GPU · {gpu?.load ?? '--'}%
                  </div>
                  {(specs?.gpus || []).length ? (
                    (specs?.gpus || []).map((g, i) => (
                      <div key={`gpu-${i}`} style={{ marginBottom: 10 }}>
                        <strong>{g.name}</strong>
                        <div className="hint">
                          Driver {g.driver || '—'} · VRAM {g.vramLabel} · {g.res || ''}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="hint">{gpu?.name || 'Detectando GPU…'}</p>
                  )}
                </div>
                <div className="card">
                  <div className="section-title">
                    <IconDisk size={16} /> Disco en vivo
                  </div>
                  <div className="card-value">{disk?.percent?.toFixed(0) ?? '--'}%</div>
                  <div className="card-sub">
                    {disk ? `${disk.usedGb} / ${disk.totalGb} GB en ${disk.mount}` : 'Sin datos'}
                  </div>
                </div>
              </div>
            </>
          )}

          {page === 'processes' && (
            <>
              <PageHeader
                eyebrow="Rendimiento"
                title="Procesos"
                subtitle="Lista en vivo con explicacion de cada proceso"
              >
                <button className="btn ghost" type="button" disabled={procBusy} onClick={refreshProcs}>
                  <IconRefresh size={16} /> {procBusy ? 'Cargando…' : 'Actualizar'}
                </button>
                <button
                  className="btn danger"
                  type="button"
                  disabled={!selectedProc}
                  onClick={() => void killSelected()}
                >
                  Finalizar
                </button>
              </PageHeader>

              <div className="split-panel">
                <div className="card split-main">
                  <div className="proc-toolbar">
                    <input
                      className="proc-search"
                      placeholder="Buscar nombre, PID o descripción…"
                      value={procQuery}
                      spellCheck={false}
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                      onChange={(e) => setProcQuery(e.target.value)}
                    />
                    <span className="count-badge">{filteredProcs.length}</span>
                  </div>
                  <div className="proc-table">
                    <div className="proc-head">
                      <button type="button" className={`sort-col ${procSortCol === 'pid' ? 'active' : ''}`} onClick={() => toggleProcSort('pid')}>
                        PID{sortMark('pid')}
                      </button>
                      <button type="button" className={`sort-col ${procSortCol === 'name' ? 'active' : ''}`} onClick={() => toggleProcSort('name')}>
                        Nombre{sortMark('name')}
                      </button>
                      <button type="button" className={`sort-col ${procSortCol === 'description' ? 'active' : ''}`} onClick={() => toggleProcSort('description')}>
                        Para que sirve{sortMark('description')}
                      </button>
                      <button type="button" className={`sort-col ${procSortCol === 'cpu' ? 'active' : ''}`} onClick={() => toggleProcSort('cpu')}>
                        CPU{sortMark('cpu')}
                      </button>
                      <button type="button" className={`sort-col ${procSortCol === 'mem' ? 'active' : ''}`} onClick={() => toggleProcSort('mem')}>
                        Memoria{sortMark('mem')}
                      </button>
                    </div>
                    {filteredProcs.map((p) => (
                      <div
                        className={`proc-row ${selectedProc?.pid === p.pid ? 'selected' : ''}`}
                        key={p.pid}
                        onClick={() => setSelectedProc(p)}
                      >
                        <span>{p.pid}</span>
                        <span className="proc-name" title={p.path || p.name}>
                          {p.icon ? (
                            <img className="proc-icon" src={p.icon} alt="" width={22} height={22} />
                          ) : (
                            <span className="proc-icon proc-icon-fallback" aria-hidden>
                              {(p.name || '?').slice(0, 1).toUpperCase()}
                            </span>
                          )}
                          <span className="proc-name-text">{p.name}</span>
                        </span>
                        <span className="proc-desc" title={p.description}>
                          {p.description || '—'}
                        </span>
                        <span>{p.cpu}</span>
                        <span>{p.memMb.toFixed(1)} MB</span>
                      </div>
                    ))}
                    {!filteredProcs.length && !procBusy ? (
                      <p className="hint" style={{ padding: 12 }}>
                        Sin procesos. Pulsa Actualizar.
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="card split-side">
                  <div className="section-title">Detalle</div>
                  {selectedProc ? (
                    <>
                      <strong className="detail-title">{selectedProc.name}</strong>
                      <div className="hint">PID {selectedProc.pid}</div>
                      <p className="hint" style={{ marginTop: 12 }}>
                        {selectedProc.description}
                      </p>
                      {selectedProc.path ? <p className="app-path">{selectedProc.path}</p> : null}
                      <div className="spec-grid" style={{ marginTop: 14 }}>
                        <div>
                          <small>CPU</small>
                          <strong>{selectedProc.cpu}%</strong>
                        </div>
                        <div>
                          <small>Memoria</small>
                          <strong>{selectedProc.memMb.toFixed(1)} MB</strong>
                        </div>
                      </div>
                      <button className="btn danger" style={{ marginTop: 16, width: '100%' }} type="button" onClick={() => void killSelected()}>
                        Finalizar proceso
                      </button>
                    </>
                  ) : (
                    <p className="hint">Selecciona un proceso de la lista.</p>
                  )}
                </div>
              </div>
            </>
          )}

          {page === 'apps' && (
            <>
              <PageHeader
                eyebrow="Software"
                title="Aplicaciones"
                subtitle="Ubicacion, desinstalacion y limpieza de residuos"
              >
                <button className="btn ghost" type="button" disabled={appsBusy} onClick={refreshApps}>
                  <IconRefresh size={16} /> {appsBusy ? 'Escaneando…' : 'Actualizar'}
                </button>
              </PageHeader>

              <div className="split-panel">
                <div className="card split-main">
                  <div className="proc-toolbar">
                    <input
                      className="proc-search"
                      placeholder="Buscar aplicación, editor o ruta…"
                      value={appQuery}
                      spellCheck={false}
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                      onChange={(e) => setAppQuery(e.target.value)}
                    />
                    <span className="count-badge">{filteredApps.length}</span>
                  </div>
                  <div className="app-table">
                    <div className="app-head">
                      <span>Nombre</span>
                      <span>Editor</span>
                      <span>Version</span>
                      <span>Tamaño</span>
                      <span>Origen</span>
                    </div>
                    {filteredApps.map((a) => (
                      <div
                        className={`app-row ${selectedApp?.id === a.id && selectedApp?.name === a.name ? 'selected' : ''}`}
                        key={`${a.id}-${a.name}-${a.source}`}
                        onClick={() => void openAppDetails(a)}
                      >
                        <span className="app-name" title={a.installLocation || a.name}>
                          {a.icon ? (
                            <img className="proc-icon" src={a.icon} alt="" width={22} height={22} />
                          ) : (
                            <span className="proc-icon proc-icon-fallback" aria-hidden>
                              {(a.name || '?').slice(0, 1).toUpperCase()}
                            </span>
                          )}
                          <span className="proc-name-text">{a.name}</span>
                        </span>
                        <span className="hint">{a.publisher || '—'}</span>
                        <span className="hint">{a.version || '—'}</span>
                        <span className="hint">{a.sizeMb != null ? `${a.sizeMb} MB` : '—'}</span>
                        <span className={`source-badge ${a.source || 'registry'}`}>{sourceLabel(a.source)}</span>
                      </div>
                    ))}
                    {!filteredApps.length && !appsBusy ? (
                      <p className="hint" style={{ padding: 12 }}>
                        Sin resultados.
                      </p>
                    ) : null}
                  </div>
                  <p className="hint" style={{ marginTop: 10 }}>
                    {appActionLog}
                  </p>
                </div>

                <div className="card split-side">
                  <div className="section-title">
                    <IconApps size={16} /> Detalle
                  </div>
                  {selectedApp ? (
                    <>
                      <strong className="detail-title">{selectedApp.name}</strong>
                      <div className="card-sub">
                        {selectedApp.publisher || 'Editor desconocido'} · {selectedApp.version || 'sin version'}
                        {' · '}
                        <span className={`source-badge ${selectedApp.source || 'registry'}`}>
                          {sourceLabel(selectedApp.source)}
                        </span>
                      </div>
                      {!(appDetails?.locations || []).length && selectedApp.installLocation ? (
                        <p className="app-path">{selectedApp.installLocation}</p>
                      ) : null}
                      {selectedApp.installLocation ? (
                        <button
                          className="btn ghost sm"
                          type="button"
                          style={{ marginTop: 8 }}
                          onClick={() => void window.eyed?.openAppPath(selectedApp.installLocation)}
                        >
                          <IconFolder size={14} /> Abrir carpeta
                        </button>
                      ) : null}
                      <div className="loc-list">
                        {(appDetails?.locations || []).map((loc) => (
                          <div className="loc-item" key={loc.path}>
                            <div>
                              <code>{loc.path}</code>
                              <div className="hint">{loc.exists ? loc.sizeLabel : 'No existe'}</div>
                            </div>
                            <button
                              className="btn ghost sm"
                              type="button"
                              onClick={() => void window.eyed?.openAppPath(loc.path)}
                            >
                              Abrir
                            </button>
                          </div>
                        ))}
                      </div>
                      <div className="btn-stack">
                        <button className="btn danger" type="button" onClick={() => void doUninstall(false)}>
                          <IconTrash size={16} /> Desinstalar
                        </button>
                        <button className="btn danger" type="button" onClick={() => void doUninstall(true)}>
                          <IconTrash size={16} /> Desinstalar + borrar
                        </button>
                      </div>
                      <p className="hint" style={{ marginTop: 12 }}>
                        “Desinstalar + borrar” elimina carpetas residuales detectadas. Usa con cuidado.
                      </p>
                    </>
                  ) : (
                    <p className="hint">Selecciona una aplicacion de la lista.</p>
                  )}
                </div>
              </div>
            </>
          )}

          {(
            [
              'startup',
              'cleanup',
              'hardware',
              'labs',
              'drivers',
              'events',
              'netlab',
            ] as Page[]
          ).includes(page) && (
            <>
              <PageHeader
                eyebrow="Eyed"
                title={
                  page === 'startup'
                    ? 'Inicio de Windows'
                    : page === 'cleanup'
                      ? 'Limpieza e informes'
                      : page === 'hardware'
                        ? 'Control de hardware'
                        : page === 'labs'
                          ? 'Labs / Benchmarks'
                          : page === 'drivers'
                            ? 'Drivers'
                            : page === 'events'
                              ? 'Eventos y BSOD'
                              : 'Red avanzada'
                }
                subtitle={hubLog || 'Herramientas avanzadas de EyedOptimizer'}
              />
              <FeatureHub page={page} onLog={setHubLog} />
            </>
          )}

          {page === 'settings' && (
            <>
              <PageHeader
                eyebrow="Sistema"
                title="Ajustes"
                subtitle="Comportamiento de la app, bandeja y overlay"
              />
              <div className="card settings-card">
                <div className="control-row">
                  <div>
                    <strong>Cerrar a segundo plano</strong>
                    <div className="hint">Al cerrar la ventana, sigue en la bandeja</div>
                  </div>
                  <Toggle
                    on={settings.closeToTray}
                    label="Cerrar a bandeja"
                    onClick={() => void patch({ closeToTray: !settings.closeToTray })}
                  />
                </div>
                <div className="control-row">
                  <div>
                    <strong>Iniciar minimizado</strong>
                    <div className="hint">Arranca solo en bandeja</div>
                  </div>
                  <Toggle
                    on={settings.startMinimized}
                    label="Iniciar minimizado"
                    onClick={() => void patch({ startMinimized: !settings.startMinimized })}
                  />
                </div>
                <div className="control-row">
                  <div>
                    <strong>Overlay en juegos</strong>
                    <div className="hint">OSD automatico al detectar juego</div>
                  </div>
                  <Toggle
                    on={settings.overlayEnabled}
                    label="Overlay"
                    onClick={() => void patch({ overlayEnabled: !settings.overlayEnabled })}
                  />
                </div>
                <div className="control-row">
                  <div>
                    <strong>Discord Rich Presence</strong>
                    <div className="hint">Muestra EyedOptimizer en tu perfil de Discord</div>
                  </div>
                  <Toggle
                    on={!!settings.discordPresence}
                    label="Discord Presence"
                    onClick={() =>
                      void patch({
                        discordPresence: !settings.discordPresence,
                      })
                    }
                  />
                </div>
                {!!settings.discordPresence && (
                  <div className="control-row" style={{ paddingLeft: 12 }}>
                    <div style={{ flex: 1 }}>
                      <strong>Modo de presencia</strong>
                      <div className="hint">Qué información muestra Discord en tu estado</div>
                      <div className="chip-row" style={{ marginTop: 8 }}>
                        {([
                          ['performance', 'Rendimiento'],
                          ['specs', 'Especificaciones'],
                          ['game', 'Juego + FPS'],
                          ['minimal', 'Minimal'],
                        ] as const).map(([id, label]) => (
                          <button
                            key={id}
                            className={`chip-toggle ${(settings.discordPresenceMode || 'performance') === id ? 'on' : ''}`}
                            onClick={() => void patch({ discordPresenceMode: id })}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
                <div className="control-row" style={{ alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <strong>Alertas</strong>
                    <div className="hint">Umbrales para el banner de aviso (temps / RAM)</div>
                    <div className="spec-grid" style={{ marginTop: 10 }}>
                      <div>
                        <small>GPU °C</small>
                        <strong>
                          <input
                            type="number"
                            min={60}
                            max={100}
                            value={settings.alertGpuTemp ?? 85}
                            onChange={(e) =>
                              void patch({ alertGpuTemp: Number(e.target.value) || 85 })
                            }
                            style={{
                              width: 72,
                              background: 'transparent',
                              border: '1px solid var(--border)',
                              color: 'inherit',
                              borderRadius: 8,
                              padding: '4px 8px',
                              font: 'inherit',
                            }}
                          />
                        </strong>
                      </div>
                      <div>
                        <small>CPU °C</small>
                        <strong>
                          <input
                            type="number"
                            min={60}
                            max={105}
                            value={settings.alertCpuTemp ?? 90}
                            onChange={(e) =>
                              void patch({ alertCpuTemp: Number(e.target.value) || 90 })
                            }
                            style={{
                              width: 72,
                              background: 'transparent',
                              border: '1px solid var(--border)',
                              color: 'inherit',
                              borderRadius: 8,
                              padding: '4px 8px',
                              font: 'inherit',
                            }}
                          />
                        </strong>
                      </div>
                      <div>
                        <small>RAM %</small>
                        <strong>
                          <input
                            type="number"
                            min={50}
                            max={99}
                            value={settings.alertRam ?? 90}
                            onChange={(e) => void patch({ alertRam: Number(e.target.value) || 90 })}
                            style={{
                              width: 72,
                              background: 'transparent',
                              border: '1px solid var(--border)',
                              color: 'inherit',
                              borderRadius: 8,
                              padding: '4px 8px',
                              font: 'inherit',
                            }}
                          />
                        </strong>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="control-row" style={{ alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <strong>Transparencia del overlay</strong>
                    <div className="hint">Más bajo = más transparente en juego</div>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10 }}>
                      <input
                        type="range"
                        min={15}
                        max={95}
                        value={Math.round((settings.overlayOpacity ?? 0.48) * 100)}
                        onChange={(e) =>
                          void patch({ overlayOpacity: Math.max(0.15, Math.min(0.95, Number(e.target.value) / 100)) })
                        }
                        style={{ flex: 1, accentColor: 'var(--accent)' }}
                      />
                      <span style={{ fontFamily: 'var(--font-mono)', minWidth: 42 }}>
                        {Math.round((settings.overlayOpacity ?? 0.48) * 100)}%
                      </span>
                    </div>
                  </div>
                </div>
                <div className="control-row" style={{ alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <strong>Tamaño del overlay</strong>
                    <div className="hint">Escala del OSD en juego (75%–175%)</div>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10 }}>
                      <input
                        type="range"
                        min={75}
                        max={175}
                        value={Math.round((settings.overlayScale ?? 1) * 100)}
                        onChange={(e) =>
                          void patch({ overlayScale: Math.max(0.75, Math.min(1.75, Number(e.target.value) / 100)) })
                        }
                        style={{ flex: 1, accentColor: 'var(--accent)' }}
                      />
                      <span style={{ fontFamily: 'var(--font-mono)', minWidth: 42 }}>
                        {Math.round((settings.overlayScale ?? 1) * 100)}%
                      </span>
                    </div>
                  </div>
                </div>
                <div className="control-row" style={{ alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <strong>Forma del OSD</strong>
                    <div className="hint">Panel vertical o barra tipo taskbar</div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                      {(
                        [
                          ['panel', 'Panel'],
                          ['bar', 'Barra (taskbar)'],
                        ] as const
                      ).map(([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          className={`chip-toggle ${(settings.overlayLayout || 'panel') === id ? 'on' : ''}`}
                          onClick={() => void patch({ overlayLayout: id })}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="control-row" style={{ alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <strong>Esquina / anclaje</strong>
                    <div className="hint">
                      {(settings.overlayLayout || 'panel') === 'bar'
                        ? 'Barra: arriba (tl/tr) o abajo (bl/br), centrada'
                        : 'Esquina del juego donde fijar el panel'}
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                      {(
                        [
                          ['tl', 'Arriba izq.'],
                          ['tr', 'Arriba der.'],
                          ['bl', 'Abajo izq.'],
                          ['br', 'Abajo der.'],
                        ] as const
                      ).map(([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          className={`chip-toggle ${(settings.overlayCorner || 'tl') === id ? 'on' : ''}`}
                          onClick={() => void patch({ overlayCorner: id })}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="control-row" style={{ alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <strong>Metricas del OSD</strong>
                    <div className="hint">Que mostrar en el overlay del juego</div>
                    <div className="overlay-widget-grid">
                      {(
                        [
                          ['game', 'Juego'],
                          ['gpu', 'GPU'],
                          ['temps', 'Temps'],
                          ['power', 'Watts GPU'],
                          ['vram', 'VRAM'],
                          ['cpu', 'CPU'],
                          ['ram', 'RAM'],
                          ['fps', 'FPS'],
                          ['fpsStats', 'MIN/AVG/MAX'],
                          ['frametime', 'Frametime'],
                        ] as const
                      ).map(([key, label]) => {
                        const on = settings.overlayWidgets?.[key] !== false
                        return (
                          <button
                            key={key}
                            type="button"
                            className={`chip-toggle ${on ? 'on' : ''}`}
                            onClick={() => {
                              const base = {
                                game: true,
                                gpu: true,
                                vram: true,
                                cpu: true,
                                ram: true,
                                fps: true,
                                fpsStats: true,
                                frametime: true,
                                temps: true,
                                power: true,
                                ...(settings.overlayWidgets || {}),
                              }
                              void patch({
                                overlayWidgets: {
                                  ...base,
                                  [key]: !on,
                                },
                              })
                            }}
                          >
                            {label}
                          </button>
                        )
                      })}
                    </div>
                    <button
                      className="btn ghost"
                      type="button"
                      style={{ marginTop: 10 }}
                      onClick={() => void window.eyed?.openOverlayConfig()}
                    >
                      Abrir panel en overlay
                    </button>
                  </div>
                </div>
                <div className="control-row">
                  <div>
                    <strong>Comunidad Discord</strong>
                    <div className="hint">EyedComun — soporte, novedades y feedback</div>
                  </div>
                  <button className="btn primary" type="button" onClick={() => void window.eyed?.openDiscord()}>
                    Unirse
                  </button>
                </div>
                <div className="control-row">
                  <div>
                    <strong>Instancia unica</strong>
                    <div className="hint">Solo se permite una copia de EyedOptimizer</div>
                  </div>
                  <span className="health-pill ok">Activo</span>
                </div>
                <div className="control-row">
                  <div>
                    <strong>Salir completamente</strong>
                    <div className="hint">Cierra proceso y overlay</div>
                  </div>
                  <button className="btn danger" type="button" onClick={() => window.eyed?.quitApp()}>
                    <IconPower size={16} /> Salir
                  </button>
                </div>
              </div>
            </>
          )}
        </main>
      </div>

      {detailModal ? (
        <DetailModal
          kind={detailModal}
          stats={stats}
          specs={specs}
          diskInfo={diskInfo}
          onClose={closeDetail}
          onGoTo={(p) => {
            closeDetail()
            setPage(p as Page)
          }}
        />
      ) : null}

      <ConfirmModal
        open={!!confirmDlg}
        title={confirmDlg?.title}
        message={confirmDlg?.message || ''}
        confirmLabel={confirmDlg?.confirmLabel}
        danger={confirmDlg?.danger}
        alertOnly={confirmDlg?.alertOnly}
        onCancel={() => setConfirmDlg(null)}
        onConfirm={() => {
          const act = confirmDlg?.action
          setConfirmDlg(null)
          void act?.()
        }}
      />
    </div>
  )
}
