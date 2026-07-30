import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  AppSettings,
  LiveStats,
  OverlayCorner,
  OverlayLayout,
  OverlayWidgets,
} from '../types'
import '../styles/overlay.css'

const DEFAULT_WIDGETS: OverlayWidgets = {
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
}

const WIDGET_LABELS: { key: keyof OverlayWidgets; label: string }[] = [
  { key: 'game', label: 'Nombre del juego' },
  { key: 'gpu', label: 'GPU' },
  { key: 'temps', label: 'Temperaturas' },
  { key: 'power', label: 'Potencia GPU' },
  { key: 'vram', label: 'VRAM' },
  { key: 'cpu', label: 'CPU' },
  { key: 'ram', label: 'RAM' },
  { key: 'fps', label: 'FPS' },
  { key: 'fpsStats', label: 'AVG / 1% / 0.1% Low' },
  { key: 'frametime', label: 'Frametime + gráfica' },
]

function fmt(n: number | null | undefined, d = 0) {
  if (n == null || !Number.isFinite(n)) return '—'
  return d ? n.toFixed(d) : String(Math.round(n))
}

function shortGpu(name?: string) {
  if (!name) return 'GPU'
  const m = name.match(/(RTX|GTX|RX|Arc)\s*[\w\s-]+/i)
  if (m) return m[0].replace(/\s+/g, ' ').trim()
  return name.length > 18 ? `${name.slice(0, 16)}…` : name
}

function shortCpu(name?: string) {
  if (!name) return 'CPU'
  return name
    .replace(/\(R\)|\(TM\)|CPU|Processor|Gen Intel®?/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 22)
}

function clampScale(n: number | undefined) {
  const v = Number(n)
  if (!Number.isFinite(v)) return 1
  return Math.min(1.75, Math.max(0.75, v))
}

function FrameGraph({ history }: { history: number[] }) {
  const { line, area } = useMemo(() => {
    const data = history.slice(-64)
    if (data.length < 2) return { line: '', area: '' }
    const max = Math.max(...data, 1)
    const min = Math.min(...data, 0)
    const span = Math.max(max - min, 1)
    const w = 200
    const h = 36
    const pts = data.map((v, i) => {
      const x = (i / (data.length - 1)) * w
      const y = h - ((v - min) / span) * (h - 4) - 2
      return [x, y] as const
    })
    const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
    const area = `0,${h} ${line} ${w},${h}`
    return { line, area }
  }, [history])

  return (
    <svg className="osd-graph" viewBox="0 0 200 36" preserveAspectRatio="none" aria-hidden>
      <polygon fill="rgba(255,255,255,0.08)" points={area} />
      <polyline fill="none" stroke="#fff" strokeWidth="1.25" strokeLinejoin="round" points={line} />
    </svg>
  )
}

function Meter({ value }: { value: number }) {
  const pct = Math.min(100, Math.max(0, value))
  return (
    <div className="osd-meter" aria-hidden>
      <i style={{ width: `${pct}%` }} />
    </div>
  )
}

export default function Overlay() {
  const [stats, setStats] = useState<LiveStats | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [configOpen, setConfigOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const lastSize = useRef({ w: 0, h: 0 })

  useEffect(() => {
    const api = window.eyed
    if (!api) return
    let alive = true
    api.getStats().then((s) => {
      if (alive && s) setStats(s)
    })
    api.getSettings().then((s) => {
      if (alive) setSettings(s)
    })
    const offS = api.onStats((s) => setStats(s))
    const offSet = api.onSettings((s) => setSettings(s))
    const offCfg = api.onOverlayOpenConfig(() => setConfigOpen(true))
    return () => {
      alive = false
      offS()
      offSet()
      offCfg()
    }
  }, [])

  const widgets = { ...DEFAULT_WIDGETS, ...(settings?.overlayWidgets || {}) }
  const opacity = Math.min(0.95, Math.max(0.15, settings?.overlayOpacity ?? 0.82))
  const scale = clampScale(settings?.overlayScale)
  const layout: OverlayLayout = settings?.overlayLayout === 'bar' ? 'bar' : 'panel'
  const corner: OverlayCorner = (settings?.overlayCorner as OverlayCorner) || 'tl'
  const isBar = layout === 'bar'
  const fps = stats?.fps
  const gameName = (stats?.game?.title || stats?.game?.processName || '').replace(/\.exe$/i, '')

  useEffect(() => {
    const el = rootRef.current
    if (!el || !window.eyed?.reportOverlaySize || configOpen) return
    let timer = 0
    const report = () => {
      const baseW = el.offsetWidth
      const baseH = el.offsetHeight
      const w = Math.ceil(baseW * scale + 4)
      const h = Math.ceil(baseH * scale + 4)
      if (w < 40 || h < 40) return
      if (Math.abs(w - lastSize.current.w) < 6 && Math.abs(h - lastSize.current.h) < 6) return
      lastSize.current = { w, h }
      window.eyed?.reportOverlaySize?.(w, h)
    }
    const schedule = () => {
      if (timer) clearTimeout(timer)
      timer = window.setTimeout(report, 160)
    }
    schedule()
    // Re-report cuando llega contenido (stats) para no quedar cortado
    const again = window.setTimeout(schedule, 500)
    const ro = new ResizeObserver(schedule)
    ro.observe(el)
    return () => {
      ro.disconnect()
      if (timer) clearTimeout(timer)
      clearTimeout(again)
    }
  }, [
    settings?.overlayScale,
    settings?.overlayLayout,
    settings?.overlayCorner,
    settings?.overlayWidgets,
    configOpen,
    isBar,
    scale,
    stats?.fps?.available,
    widgets.gpu,
    widgets.cpu,
    widgets.ram,
    widgets.fps,
    widgets.frametime,
  ])

  const armGearClick = () => {
    // Sin esto Windows se traga el click (click-through del OSD)
    void window.eyed?.setOverlayClickThrough?.(false)
  }
  const disarmGearClick = () => {
    if (configOpen) return
    void window.eyed?.setOverlayClickThrough?.(true)
  }

  const patch = (partial: Partial<AppSettings>) => {
    void window.eyed?.setSettings(partial)
  }

  const closeConfig = () => {
    setConfigOpen(false)
    void window.eyed?.setOverlayInteractive(false)
  }

  const origin =
    isBar
      ? corner === 'bl' || corner === 'br'
        ? 'bottom center'
        : 'top center'
      : corner === 'tr'
        ? 'top right'
        : corner === 'bl'
          ? 'bottom left'
          : corner === 'br'
            ? 'bottom right'
            : 'top left'

  if (configOpen) {
    return (
      <div className="osd-cfg-root">
        <div className="osd-cfg">
          <header>
            <div>
              <p className="osd-cfg-kicker">EyedOptimizer</p>
              <strong>Overlay</strong>
            </div>
            <button type="button" onClick={closeConfig}>
              Cerrar
            </button>
          </header>

          <label className="osd-cfg-row">
            <span>Opacidad</span>
            <input
              type="range"
              min={0.15}
              max={0.95}
              step={0.01}
              value={opacity}
              onChange={(e) => patch({ overlayOpacity: Number(e.target.value) })}
            />
            <em>{Math.round(opacity * 100)}%</em>
          </label>

          <label className="osd-cfg-row">
            <span>Tamaño</span>
            <input
              type="range"
              min={0.75}
              max={1.75}
              step={0.05}
              value={scale}
              onChange={(e) => patch({ overlayScale: Number(e.target.value) })}
            />
            <em>{Math.round(scale * 100)}%</em>
          </label>

          <div className="osd-cfg-block">
            <span>Forma</span>
            <div className="osd-chips">
              {(
                [
                  ['panel', 'Panel'],
                  ['bar', 'Barra'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={layout === id ? 'on' : ''}
                  onClick={() => patch({ overlayLayout: id })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="osd-cfg-block">
            <span>Esquina</span>
            <div className="osd-chips">
              {(
                [
                  ['tl', 'TL'],
                  ['tr', 'TR'],
                  ['bl', 'BL'],
                  ['br', 'BR'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={corner === id ? 'on' : ''}
                  onClick={() => patch({ overlayCorner: id })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="osd-cfg-block">
            <span>Métricas</span>
            {WIDGET_LABELS.map(({ key, label }) => (
              <label key={key} className="osd-cfg-check">
                <input
                  type="checkbox"
                  checked={widgets[key] !== false}
                  onChange={(e) =>
                    patch({
                      overlayWidgets: { ...widgets, [key]: e.target.checked },
                    })
                  }
                />
                {label}
              </label>
            ))}
          </div>
        </div>
      </div>
    )
  }

  const bg = `rgba(0, 0, 0, ${opacity})`

  return (
    <div className="osd-root" data-corner={corner} data-layout={layout}>
      <div
        ref={rootRef}
        className={isBar ? 'osd-shell osd-shell-bar' : 'osd-shell'}
        style={{
          background: bg,
          transform: `scale(${scale})`,
          transformOrigin: origin,
        }}
      >
        <button
          type="button"
          className="osd-gear"
          title="Configurar overlay"
          onMouseEnter={armGearClick}
          onMouseLeave={disarmGearClick}
          onFocus={armGearClick}
          onBlur={disarmGearClick}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            armGearClick()
            void window.eyed?.openOverlayConfig()
            setConfigOpen(true)
          }}
        >
          ⚙
        </button>

        {isBar ? (
          <div className="osd-strip">
            {widgets.game !== false && gameName ? <span className="osd-strip-game">{gameName}</span> : null}
            {widgets.fps !== false ? (
              <span className="osd-strip-fps">
                {fps?.available ? fmt(fps.fps) : '—'}
                <small>FPS</small>
              </span>
            ) : null}
            {widgets.fpsStats !== false && fps?.available ? (
              <>
                <span>
                  <small>AVG</small> {fmt(fps.avg)}
                </span>
                <span>
                  <small>1%</small> {fmt(fps.low1)}
                </span>
              </>
            ) : null}
            {widgets.gpu !== false ? (
              <span>
                <small>GPU</small> {fmt(stats?.gpu?.load)}%
                {widgets.temps !== false && stats?.gpu?.temp != null ? ` · ${fmt(stats.gpu.temp)}°` : ''}
              </span>
            ) : null}
            {widgets.cpu !== false ? (
              <span>
                <small>CPU</small> {fmt(stats?.cpu?.load)}%
              </span>
            ) : null}
            {widgets.ram !== false ? (
              <span>
                <small>RAM</small> {fmt(stats?.ram?.percent)}%
              </span>
            ) : null}
            {widgets.frametime !== false && fps?.available ? (
              <span>
                <small>FT</small> {fmt(fps.frametime, 1)}ms
              </span>
            ) : null}
          </div>
        ) : (
          <>
            {widgets.game !== false && gameName ? (
              <header className="osd-head">
                <span className="osd-head-name">{gameName}</span>
                <span className="osd-live">LIVE</span>
              </header>
            ) : null}

            {widgets.fps !== false ? (
              <section className="osd-hero">
                <div className="osd-hero-main">
                  <span className="osd-hero-num">{fps?.available ? fmt(fps.fps) : '—'}</span>
                  <span className="osd-hero-unit">FPS</span>
                </div>
                {widgets.fpsStats !== false ? (
                  <div className="osd-statgrid">
                    <div>
                      <span>AVG</span>
                      <b>{fps?.available ? fmt(fps.avg) : '—'}</b>
                    </div>
                    <div>
                      <span>1% LOW</span>
                      <b>{fps?.available ? fmt(fps.low1) : '—'}</b>
                    </div>
                    <div>
                      <span>0.1%</span>
                      <b>{fps?.available ? fmt(fps.low01 ?? 0) : '—'}</b>
                    </div>
                    <div>
                      <span>MIN</span>
                      <b>{fps?.available ? fmt(fps.min) : '—'}</b>
                    </div>
                    <div>
                      <span>MAX</span>
                      <b>{fps?.available ? fmt(fps.max) : '—'}</b>
                    </div>
                    <div>
                      <span>STUTTER</span>
                      <b>{fps?.available && fps.stutterPct != null ? `${fmt(fps.stutterPct, 1)}%` : '—'}</b>
                    </div>
                  </div>
                ) : null}
                {widgets.frametime !== false ? (
                  <div className="osd-ft">
                    <div className="osd-ft-row">
                      <span>FRAMETIME</span>
                      <b>{fps?.available ? `${fmt(fps.frametime, 1)} ms` : '—'}</b>
                    </div>
                    {fps?.history && fps.history.length > 2 ? <FrameGraph history={fps.history} /> : null}
                  </div>
                ) : null}
                {!fps?.available && fps?.error === 'access_denied' ? (
                  <p className="osd-warn">PresentMon: elevá EyedOptimizer (UAC)</p>
                ) : null}
              </section>
            ) : null}

            {(widgets.gpu !== false || widgets.cpu !== false || widgets.ram !== false) && (
              <section className="osd-hw">
                {widgets.gpu !== false ? (
                  <div className="osd-hw-row">
                    <div className="osd-hw-top">
                      <span className="osd-hw-label">{shortGpu(stats?.gpu?.name)}</span>
                      <b>{fmt(stats?.gpu?.load)}%</b>
                    </div>
                    <div className="osd-hw-meta">
                      {widgets.temps !== false && stats?.gpu?.temp != null ? (
                        <span>{fmt(stats.gpu.temp)}°C</span>
                      ) : null}
                      {widgets.power !== false && stats?.gpu?.power != null ? (
                        <span>{fmt(stats.gpu.power, 1)}W</span>
                      ) : null}
                      {widgets.vram !== false && (stats?.gpu?.vramTotal || 0) > 0 ? (
                        <span>{fmt(stats?.gpu?.vramUsed)} MB</span>
                      ) : null}
                    </div>
                    <Meter value={stats?.gpu?.load || 0} />
                  </div>
                ) : null}

                {widgets.cpu !== false ? (
                  <div className="osd-hw-row">
                    <div className="osd-hw-top">
                      <span className="osd-hw-label">{shortCpu(stats?.cpu?.name)}</span>
                      <b>{fmt(stats?.cpu?.load)}%</b>
                    </div>
                    <div className="osd-hw-meta">
                      {widgets.temps !== false && stats?.cpu?.temp != null ? (
                        <span>{fmt(stats.cpu.temp)}°C</span>
                      ) : null}
                    </div>
                    <Meter value={stats?.cpu?.load || 0} />
                  </div>
                ) : null}

                {widgets.ram !== false ? (
                  <div className="osd-hw-row">
                    <div className="osd-hw-top">
                      <span className="osd-hw-label">RAM</span>
                      <b>{fmt(stats?.ram?.percent)}%</b>
                    </div>
                    <div className="osd-hw-meta">
                      <span>
                        {fmt((stats?.ram?.usedMb || 0) / 1024, 1)} / {fmt((stats?.ram?.totalMb || 0) / 1024, 1)} GB
                      </span>
                    </div>
                    <Meter value={stats?.ram?.percent || 0} />
                  </div>
                ) : null}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}
