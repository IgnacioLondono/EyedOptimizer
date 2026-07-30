import type {
  HistorySample,
  TimelineSegment,
  BadMoment,
  DiagnoseResult,
  SpeedHistoryEntry,
} from '../types'

export function CircularGauge({
  value,
  label,
  size = 132,
}: {
  value: number
  label: string
  size?: number
}) {
  const p = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))
  const r = 42
  const c = 2 * Math.PI * r
  const dash = (p / 100) * c
  return (
    <div className="c-gauge" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" aria-hidden>
        <circle className="c-gauge-track" cx="50" cy="50" r={r} />
        <circle
          className="c-gauge-value"
          cx="50"
          cy="50"
          r={r}
          strokeDasharray={`${dash} ${c}`}
          transform="rotate(-90 50 50)"
        />
      </svg>
      <div className="c-gauge-label">
        <strong>{Math.round(p)}%</strong>
        <span>{label}</span>
      </div>
    </div>
  )
}

export function SegmentedBar({ value, segments = 32 }: { value: number; segments?: number }) {
  const p = Math.max(0, Math.min(100, value))
  const on = Math.round((p / 100) * segments)
  return (
    <div className="seg-bar" aria-hidden>
      {Array.from({ length: segments }, (_, i) => (
        <i key={i} className={i < on ? 'on' : ''} />
      ))}
    </div>
  )
}

export function Sparkline({
  values,
  color = 'var(--text)',
  height = 48,
  fill = true,
}: {
  values: Array<number | null | undefined>
  color?: string
  height?: number
  fill?: boolean
}) {
  const w = 320
  const h = height
  const clean = values.map((v) => (v == null || Number.isNaN(Number(v)) ? null : Math.max(0, Number(v))))
  const known = clean.filter((v): v is number => v != null)
  if (!known.length) {
    return <div className="spark-empty">Sin datos</div>
  }
  const max = Math.max(...known, 1)
  const min = 0
  const span = Math.max(1, max - min)
  const padTop = 4
  const padBot = 3
  const usable = h - padTop - padBot
  const pts = clean.map((v, i) => {
    const x = (i / Math.max(1, clean.length - 1)) * w
    if (v == null) return null
    const y = padTop + usable - ((v - min) / span) * usable
    return { x, y }
  })
  const drawn = pts.filter((p): p is { x: number; y: number } => !!p)
  const line = drawn.map((p, i) => `${i === 0 ? '' : ' '}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('')
  const area =
    drawn.length > 1
      ? `${drawn[0].x.toFixed(1)},${h} ${line} ${drawn[drawn.length - 1].x.toFixed(1)},${h}`
      : ''
  const gid = `sg-mono-${height}-${drawn.length}`

  return (
    <svg className="sparkline" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && area ? <polygon points={area} fill={`url(#${gid})`} /> : null}
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

export function MultiSpark({ samples }: { samples: HistorySample[] }) {
  const last = samples.slice(-60)
  const rows: Array<{ key: string; label: string; values: Array<number | null> }> = [
    { key: 'cpu', label: 'CPU', values: last.map((s) => s.cpu) },
    { key: 'gpu', label: 'GPU', values: last.map((s) => s.gpu) },
    { key: 'ram', label: 'RAM', values: last.map((s) => s.ram) },
    {
      key: 'fps',
      label: 'FPS',
      values: last.map((s) => (s.fps != null && s.fps > 0 ? s.fps : null)),
    },
  ]
  return (
    <div className="multi-spark">
      {rows.map((r) => {
        const known = r.values.filter((v): v is number => v != null)
        const lastVal = known.length ? known[known.length - 1] : null
        return (
          <div className="multi-spark-row" key={r.key}>
            <div className="multi-spark-meta">
              <span>{r.label}</span>
              <em>{lastVal != null ? (r.key === 'fps' ? `${lastVal}` : `${lastVal}%`) : '—'}</em>
            </div>
            <div className="multi-spark-track">
              <Sparkline values={r.values} color="var(--text)" height={40} fill={known.length > 0} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

const BUCKET_LABEL: Record<string, string> = {
  idle: 'Idle',
  browsing: 'Uso',
  gaming: 'Game',
  throttle: 'Throttle',
}

export function TimelineBar({ segments }: { segments: TimelineSegment[] }) {
  if (!segments?.length) return <div className="spark-empty">Sin timeline</div>
  const withDur = segments.map((s) => ({
    ...s,
    minutes: Math.max(1, Math.round((Math.max(s.end, s.start) - s.start) / 60000)),
  }))
  const total = withDur.reduce((a, s) => a + s.minutes, 0)
  return (
    <div className="timeline-wrap">
      <div className="timeline-bar" role="img" aria-label="Timeline del dia">
        {withDur.map((s, i) => (
          <div
            key={`${s.bucket}-${i}`}
            className={`timeline-seg ${s.bucket}`}
            style={{ flexGrow: s.minutes, flexBasis: 0 }}
            title={`${BUCKET_LABEL[s.bucket] || s.bucket}: ${s.minutes}m`}
          />
        ))}
      </div>
      <div className="timeline-legend">
        {Object.entries(BUCKET_LABEL).map(([k, label]) => (
          <span key={k}>
            <i className={k} /> {label}
          </span>
        ))}
        <em>{total}m hoy</em>
      </div>
    </div>
  )
}

export function DiagnoseCard({ data }: { data: DiagnoseResult | null }) {
  if (!data) return <p className="hint">Ejecuta un diagnóstico para ver causas.</p>
  const sev = data.primary?.severity || 'ok'
  return (
    <div className="diagnose-card">
      <div className={`diagnose-sev ${sev}`}>{String(sev).toUpperCase()}</div>
      <h4>{data.primary?.title || 'Sin hallazgos críticos'}</h4>
      <p>{data.primary?.detail || 'El equipo se ve estable.'}</p>
      {data.secondary?.length ? (
        <ul className="diagnose-list">
          {data.secondary.slice(0, 4).map((s) => (
            <li key={s.id}>
              <strong>{s.title}</strong>
              <span>{s.detail}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export function ChecklistPanel({
  items,
}: {
  items: Array<{ id?: string; label: string; status: 'ok' | 'warn' | 'bad'; detail?: string }>
}) {
  return (
    <div className="checklist">
      {items.map((it, i) => (
        <div className={`check-row ${it.status}`} key={it.id || `${it.label}-${i}`}>
          <span className="check-dot" />
          <div>
            <strong>{it.label}</strong>
            {it.detail ? <small>{it.detail}</small> : null}
          </div>
        </div>
      ))}
    </div>
  )
}

export function SpeedHistoryList({ entries }: { entries: SpeedHistoryEntry[] }) {
  if (!entries?.length) return <div className="spark-empty">Sin tests aún</div>
  const vals = entries.slice(0, 12).map((e) => e.downloadMbps)
  return (
    <div className="speed-hist">
      <Sparkline values={vals} color="var(--text)" height={44} />
      <ul>
        {entries.slice(0, 6).map((e, i) => (
          <li key={`${e.t}-${i}`}>
            <span>{new Date(e.t).toLocaleString()}</span>
            <strong>{e.downloadMbps?.toFixed?.(1) ?? e.downloadMbps} ↓</strong>
            <em>{e.uploadMbps?.toFixed?.(1) ?? e.uploadMbps} ↑</em>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function MomentsList({ moments }: { moments: BadMoment[] }) {
  if (!moments?.length) return <div className="spark-empty">Sin momentos registrados</div>
  return (
    <ul className="moments-list">
      {moments.slice(0, 8).map((m) => (
        <li key={m.id}>
          <strong>{m.note || 'Evento'}</strong>
          <span>{new Date(m.t).toLocaleString()}</span>
        </li>
      ))}
    </ul>
  )
}
