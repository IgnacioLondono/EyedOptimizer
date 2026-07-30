import { useEffect, useState } from 'react'

type Props = {
  page: string
  onLog?: (msg: string) => void
}

export function FeatureHub({
  page,
  onLog,
}: Props) {
  const [busy, setBusy] = useState('')
  const [startup, setStartup] = useState<any[]>([])
  const [drivers, setDrivers] = useState<any[]>([])
  const [driversLoading, setDriversLoading] = useState(false)
  const [selectedDrivers, setSelectedDrivers] = useState<Record<string, boolean>>({})
  const [driverFilter, setDriverFilter] = useState('')
  const [driverKind, setDriverKind] = useState('all')
  const [events, setEvents] = useState<any[]>([])
  const [bsod, setBsod] = useState<any[]>([])
  const [conns, setConns] = useState<any[]>([])
  const [devices, setDevices] = useState<any[]>([])
  const [throughput, setThroughput] = useState<{ downMbps: number; upMbps: number } | null>(null)
  const [firewall, setFirewall] = useState<any[]>([])
  const [hw, setHw] = useState<any>(null)
  const [bench, setBench] = useState<any[]>([])
  const [instab, setInstab] = useState<any>(null)
  const [powerWatts, setPowerWatts] = useState(200)

  const log = (m: string) => onLog?.(m)

  useEffect(() => {
    if (page === 'startup') void window.eyed?.listStartup?.().then((d) => setStartup(d || []))
    if (page === 'drivers') {
      setDriversLoading(true)
      void window.eyed
        ?.listDrivers?.()
        .then((d) => setDrivers(d || []))
        .catch(() => setDrivers([]))
        .finally(() => setDriversLoading(false))
    }
    if (page === 'events') {
      void window.eyed?.listEvents?.(50).then((d) => setEvents(d || []))
      void window.eyed?.listBsod?.().then((d) => setBsod(d || []))
      void window.eyed?.checkInstability?.().then((d) => setInstab(d))
    }
    if (page === 'netlab') {
      void window.eyed?.getNetConnections?.().then((d) => setConns(d || []))
      void window.eyed?.getLanDevices?.().then((d) => setDevices(d || []))
      void window.eyed?.getNetThroughput?.().then((d) => setThroughput(d || null))
      void window.eyed?.getFirewall?.().then((d) => setFirewall(d?.profiles || []))
      const t = setInterval(() => {
        void window.eyed?.getNetThroughput?.().then((d) => setThroughput(d || null))
      }, 2000)
      return () => clearInterval(t)
    }
    if (page === 'hardware') {
      void window.eyed?.getHardwareControl?.().then(setHw)
      const t = setInterval(() => {
        void window.eyed?.getHardwareControl?.().then(setHw)
      }, 2500)
      return () => clearInterval(t)
    }
    if (page === 'labs') void window.eyed?.checkInstability?.().then(setInstab)
  }, [page])

  if (page === 'startup') {
    return (
      <div className="card">
        <div className="section-title">Programas al inicio</div>
        <div className="app-table">
          {startup.map((s, i) => (
            <div className="app-row" key={`${s.name}-${i}`}>
              <span className="app-name">{s.name}</span>
              <span className="hint" title={s.command}>
                {(s.command || '').slice(0, 48)}
              </span>
              <span className="hint">{s.source}</span>
              <button
                className="btn ghost"
                type="button"
                onClick={() =>
                  void window.eyed
                    ?.setStartup?.({
                      name: s.name,
                      command: s.command,
                      location: s.location,
                      enabled: false,
                    })
                    .then((r) => {
                      log(r?.message || '')
                      return window.eyed?.listStartup?.()
                    })
                    .then((d) => setStartup(d || []))
                }
              >
                Quitar Run
              </button>
            </div>
          ))}
        </div>
        <p className="hint" style={{ marginTop: 10 }}>
          Solo desactiva entradas de claves Run (HKCU/HKLM). WMI/carpeta Inicio pueden requerir acción manual.
        </p>
      </div>
    )
  }

  if (page === 'cleanup') {
    return (
      <div className="cleanup-dual">
        <div className="card cleanup-panel">
          <div className="section-title">Limpieza profunda de temporales</div>
          <p className="hint">
            Borra archivos temporales de Windows y del usuario. No toca documentos ni programas.
          </p>
          <div className="cleanup-divider" />
          <button
            className="btn primary"
            type="button"
            disabled={busy === 'clean'}
            onClick={() => {
              setBusy('clean')
              void window.eyed
                ?.cleanTemps?.()
                .then((r) => log(r?.message || ''))
                .finally(() => setBusy(''))
            }}
          >
            {busy === 'clean' ? 'Limpiando…' : 'Limpiar temporales'}
          </button>
        </div>
        <div className="card cleanup-panel">
          <div className="section-title">Backup / Informe</div>
          <p className="hint">
            Elige la carpeta destino al exportar. Se generan HTML y PDF (si es posible).
          </p>
          <div className="cleanup-divider" />
          <div className="btn-stack">
            <button
              className="btn ghost"
              type="button"
              onClick={() => void window.eyed?.backupSettings?.().then((r) => log(r?.message || ''))}
            >
              Backup de ajustes
            </button>
            <button
              className="btn primary"
              type="button"
              disabled={busy === 'export'}
              onClick={() => {
                setBusy('export')
                void window.eyed
                  ?.exportReport?.()
                  .then((r) => log(r?.message || (r?.ok === false ? 'Cancelado' : '')))
                  .finally(() => setBusy(''))
              }}
            >
              {busy === 'export' ? 'Exportando…' : 'Exportar informe (elegir carpeta)'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (page === 'hardware') {
    return (
      <div className="grid grid-2">
        <div className="card">
          <div className="section-title">Placa / equipo</div>
          <p className="hint">
            Lectura WMI + APIs OEM (
            {hw?.board?.formFactor === 'laptop'
              ? 'laptop'
              : hw?.board?.formFactor === 'desktop'
                ? 'torre / escritorio'
                : 'sistema'}
            )
          </p>
          <div className="spec-grid" style={{ marginTop: 12 }}>
            <div>
              <small>Formato</small>
              <strong>
                {hw?.board?.formFactor === 'laptop'
                  ? 'Laptop'
                  : hw?.board?.formFactor === 'desktop'
                    ? 'PC torre'
                    : '—'}
              </strong>
            </div>
            <div>
              <small>Equipo</small>
              <strong>
                {(hw?.device?.vendor || hw?.board?.manufacturer || '—') +
                  ' ' +
                  (hw?.device?.model || hw?.board?.product || '')}
              </strong>
            </div>
            <div>
              <small>Placa base</small>
              <strong>
                {[(hw?.board?.manufacturer || '').trim(), (hw?.board?.product || '').trim()]
                  .filter(Boolean)
                  .join(' ') || '—'}
              </strong>
            </div>
            <div>
              <small>BIOS</small>
              <strong>
                {hw?.board?.bios || '—'}
                {hw?.board?.biosDate ? ` · ${hw.board.biosDate}` : ''}
              </strong>
            </div>
          </div>
          <div className="hint" style={{ marginTop: 12 }}>
            APIs detectadas:{' '}
            {[
              hw?.board?.apis?.nvidiaSmi ? 'nvidia-smi' : null,
              hw?.board?.apis?.win32Fan ? 'Win32_Fan' : null,
              hw?.board?.apis?.lenovoGamezone ? 'Lenovo Gamezone' : null,
              hw?.board?.apis?.asusWmi ? 'ASUS WMI' : null,
              hw?.board?.apis?.msiWmi ? 'MSI WMI' : null,
              hw?.board?.apis?.battery ? 'Batería' : null,
            ]
              .filter(Boolean)
              .join(' · ') || 'WMI básico'}
          </div>
        </div>
        <div className="card">
          <div className="section-title">Control de hardware</div>
          {hw?.nvidia ? (
            <div className="spec-grid">
              <div>
                <small>GPU</small>
                <strong>{hw.nvidia.name}</strong>
              </div>
              <div>
                <small>Temp</small>
                <strong>{hw.nvidia.temp ?? '—'} °C</strong>
              </div>
              <div>
                <small>Clocks</small>
                <strong>
                  {hw.nvidia.coreClock ?? '—'} / {hw.nvidia.memClock ?? '—'} MHz
                </strong>
              </div>
              <div>
                <small>Potencia</small>
                <strong>
                  {hw.nvidia.powerDraw ?? '—'} / {hw.nvidia.powerLimit ?? '—'} W
                </strong>
              </div>
            </div>
          ) : (
            <p className="hint">Sin NVIDIA-SMI. AMD/Intel: usa software del fabricante.</p>
          )}
          <div className="control-row" style={{ marginTop: 14 }}>
            <input
              type="number"
              value={powerWatts}
              onChange={(e) => setPowerWatts(Number(e.target.value))}
              style={{
                width: 90,
                background: 'transparent',
                border: '1px solid var(--border)',
                color: 'inherit',
                borderRadius: 8,
                padding: '6px 8px',
              }}
            />
            <button
              className="btn primary"
              type="button"
              onClick={() =>
                void window.eyed?.setGpuPowerLimit?.(powerWatts).then((r) => log(r?.message || ''))
              }
            >
              Límite potencia GPU
            </button>
          </div>
          <button
            className="btn ghost"
            type="button"
            style={{ marginTop: 10 }}
            onClick={() => void window.eyed?.launchOpenRgb?.().then((r) => log(r?.message || ''))}
          >
            Abrir OpenRGB (RGB)
          </button>
        </div>

        <div className="card">
          <div className="section-title">Ventiladores (solo lectura)</div>
          <p className="hint">
            {hw?.isLaptop
              ? 'Laptop detectada: CPU + GPU (los dos ventiladores de enfriamiento). Eyed no aplica curvas ni cambia RPM.'
              : 'Estado y velocidad. Eyed no aplica curvas ni cambia RPM.'}
          </p>
          {hw?.isLaptop && !hw?.fanMonitorActive ? (
            <button
              className="btn primary"
              type="button"
              style={{ marginTop: 10 }}
              onClick={() =>
                void window.eyed?.startLaptopFans?.().then((r) => {
                  log(r?.message || '')
                  void window.eyed?.getHardwareControl?.().then(setHw)
                })
              }
            >
              Leer fans laptop (admin)
            </button>
          ) : null}
          <div className="fan-row" style={{ marginTop: 14 }}>
            {(hw?.fans || []).length ? (
              (hw.fans as any[]).map((f) => (
                <div className="fan-tile" key={f.id}>
                  <span className={`fan-ico ${f.status === 'spinning' ? 'spin' : ''}`}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <circle cx="12" cy="12" r="2.2" />
                      <path d="M12 4c2.2 2.4 2.8 4.6 1.6 6.2C11.4 8.8 9.2 8 7 8c2.8-2.2 4.4-3.4 5-4z" />
                      <path d="M20 12c-2.4 2.2-4.6 2.8-6.2 1.6 1.4-2.2 2.2-4.4 2.2-6.6 2.2 2.8 3.4 4.4 4 5z" />
                      <path d="M12 20c-2.2-2.4-2.8-4.6-1.6-6.2 2.2 1.4 4.4 2.2 6.6 2.2-2.8 2.2-4.4 3.4-5 4z" />
                      <path d="M4 12c2.4-2.2 4.6-2.8 6.2-1.6-1.4 2.2-2.2 4.4-2.2 6.6C5.8 14.8 4.6 13.2 4 12z" />
                    </svg>
                  </span>
                  <div className="fan-tile-body">
                    <strong>{f.label}</strong>
                    <small title={f.name}>{f.name}</small>
                    <b>
                      {f.rpm != null
                        ? `${f.rpm} RPM`
                        : f.speedPercent != null
                          ? `${f.speedPercent}%`
                          : 'N/D'}
                      {f.rpm != null && f.speedPercent != null ? (
                        <span style={{ opacity: 0.7, fontWeight: 600, fontSize: 12 }}> · {f.speedPercent}%</span>
                      ) : null}
                    </b>
                    <em>
                      {f.temp != null ? `${f.temp} °C · ` : ''}
                      {f.status === 'spinning'
                        ? 'Girando'
                        : f.status === 'idle'
                          ? 'Bajo / idle'
                          : f.source === 'placeholder'
                            ? 'Sensor no expuesto'
                            : 'Sin dato'}
                    </em>
                  </div>
                </div>
              ))
            ) : (
              <p className="hint">Sin sensores de ventilador detectados.</p>
            )}
          </div>
          <p className="hint" style={{ marginTop: 12 }}>
            Para curvas: MSI Afterburner / Armoury / software AIO. Aquí no hay botones de aplicar fan.
          </p>
          <ul className="hint" style={{ marginTop: 8 }}>
            {(hw?.notes || []).slice(0, 4).map((n: string) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      </div>
    )
  }

  if (page === 'labs') {
    return (
      <div className="grid grid-2">
        <div className="card">
          <div className="section-title">Benchmarks</div>
          <div className="btn-stack">
            <button
              className="btn ghost"
              type="button"
              onClick={() =>
                void window.eyed?.benchCpu?.().then((r) => setBench((b) => [r, ...b].slice(0, 8)))
              }
            >
              Test CPU
            </button>
            <button
              className="btn ghost"
              type="button"
              onClick={() =>
                void window.eyed?.benchRam?.().then((r) => setBench((b) => [r, ...b].slice(0, 8)))
              }
            >
              Test RAM
            </button>
            <button
              className="btn ghost"
              type="button"
              onClick={() =>
                void window.eyed?.benchSsd?.().then((r) => setBench((b) => [r, ...b].slice(0, 8)))
              }
            >
              Test SSD
            </button>
            <button
              className="btn ghost"
              type="button"
              onClick={() =>
                void window.eyed?.benchGpu?.().then((r) => setBench((b) => [r, ...b].slice(0, 8)))
              }
            >
              Test GPU (guía)
            </button>
          </div>
          <ul className="moments-list" style={{ marginTop: 12 }}>
            {bench.map((b, i) => (
              <li key={`${b.kind}-${i}`}>
                <strong>
                  {String(b.kind).toUpperCase()} {b.score != null ? `· ${b.score} ${b.unit}` : ''}
                </strong>
                <small>{b.detail}</small>
              </li>
            ))}
          </ul>
        </div>
        <div className="card">
          <div className="section-title">Inestabilidad / cuellos de botella</div>
          <button
            className="btn primary"
            type="button"
            onClick={() => void window.eyed?.checkInstability?.().then(setInstab)}
          >
            Escanear logs
          </button>
          {instab ? (
            <>
              <p className="hint" style={{ marginTop: 12 }}>
                {instab.message}
              </p>
              <ul className="moments-list">
                {(Array.isArray(instab.recent) ? instab.recent : instab.recent ? [instab.recent] : []).map(
                  (e: any, i: number) => (
                    <li key={i}>
                      <strong>
                        #{e.id} · {e.time}
                      </strong>
                      <small>{e.message}</small>
                    </li>
                  ),
                )}
              </ul>
            </>
          ) : null}
          <p className="hint" style={{ marginTop: 12 }}>
            Cuellos de botella en vivo: usa Insights → “¿Por qué va mal?”.
          </p>
        </div>
      </div>
    )
  }

  if (page === 'drivers') {
    const kinds = Array.from(new Set(drivers.map((d) => d.kind || 'other'))).sort()
    const filtered = drivers.filter((d) => {
      if (driverKind !== 'all' && d.kind !== driverKind) return false
      if (!driverFilter.trim()) return true
      const q = driverFilter.toLowerCase()
      return (
        String(d.name || d.DeviceName || '')
          .toLowerCase()
          .includes(q) ||
        String(d.purpose || '')
          .toLowerCase()
          .includes(q) ||
        String(d.manufacturer || d.Manufacturer || '')
          .toLowerCase()
          .includes(q)
      )
    })
    const selectedCount = filtered.filter((d) => selectedDrivers[d.id]).length
    const toggleAll = (on: boolean) => {
      const next = { ...selectedDrivers }
      for (const d of filtered) next[d.id] = on
      setSelectedDrivers(next)
    }
    const copySelected = () => {
      const rows = filtered.filter((d) => selectedDrivers[d.id])
      const text = rows
        .map(
          (d) =>
            `${d.name || d.DeviceName}\t${d.purpose}\t${d.version || d.DriverVersion}\t${d.manufacturer || d.Manufacturer}`,
        )
        .join('\n')
      void navigator.clipboard?.writeText(text)
      log(rows.length ? `${rows.length} drivers copiados` : 'Nada seleccionado')
    }
    return (
      <div className="card">
        <div className="section-title">Gestor de drivers</div>
        <p className="hint">Para qué sirve cada controlador · elige los que quieras revisar o copiar</p>
        <div className="control-row" style={{ marginTop: 12, flexWrap: 'wrap', gap: 8 }}>
          <input
            type="search"
            className="proc-search"
            placeholder="Buscar driver"
            value={driverFilter}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            onChange={(e) => setDriverFilter(e.target.value)}
            style={{ flex: '1 1 160px', minWidth: 140 }}
          />
          <select
            value={driverKind}
            onChange={(e) => setDriverKind(e.target.value)}
            style={{
              background: '#0a0a0a',
              border: '1px solid var(--border)',
              color: 'inherit',
              borderRadius: 2,
              padding: '8px 10px',
            }}
          >
            <option value="all">Todas las categorías</option>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <button className="btn ghost" type="button" onClick={() => toggleAll(true)}>
            Seleccionar vista
          </button>
          <button className="btn ghost" type="button" onClick={() => toggleAll(false)}>
            Quitar selección
          </button>
          <button className="btn primary" type="button" onClick={copySelected}>
            Copiar seleccionados ({selectedCount})
          </button>
        </div>
        <div className="app-table driver-table" style={{ maxHeight: 480, overflow: 'auto', marginTop: 12 }}>
          <div className="app-head driver-head">
            <span />
            <span>Nombre</span>
            <span>Para qué sirve</span>
            <span>Versión</span>
            <span>Fabricante</span>
          </div>
          {filtered.map((d) => (
            <label
              className={`app-row driver-row ${selectedDrivers[d.id] ? 'selected' : ''}`}
              key={d.id}
            >
              <input
                type="checkbox"
                checked={!!selectedDrivers[d.id]}
                onChange={(e) =>
                  setSelectedDrivers((prev) => ({ ...prev, [d.id]: e.target.checked }))
                }
              />
              <span className="app-name" title={d.name || d.DeviceName}>
                {d.name || d.DeviceName}
              </span>
              <span className="hint" title={d.purpose}>
                {d.purpose || 'Controlador del sistema'}
              </span>
              <span className="hint">{d.version || d.DriverVersion}</span>
              <span className="hint">{d.manufacturer || d.Manufacturer}</span>
            </label>
          ))}
          {!filtered.length ? (
            <div className="empty-drivers">
              <span className="empty-drivers-ico" aria-hidden>
                ⚙
              </span>
              <p>{driversLoading || !drivers.length ? 'Buscando drivers…' : 'Sin resultados para este filtro'}</p>
            </div>
          ) : null}
        </div>
        <p className="hint" style={{ marginTop: 10 }}>
          {drivers.length} controladores · {selectedCount} seleccionados en la vista
        </p>
      </div>
    )
  }

  if (page === 'events') {
    return (
      <div className="grid grid-2">
        <div className="card">
          <div className="section-title">Registro de eventos</div>
          <ul className="moments-list" style={{ maxHeight: 360, overflow: 'auto' }}>
            {events.map((e, i) => (
              <li key={i}>
                <strong>
                  {e.level} · {e.provider} #{e.id}
                </strong>
                <small>
                  {e.time} — {e.message}
                </small>
              </li>
            ))}
          </ul>
        </div>
        <div className="card">
          <div className="section-title">Pantallazos azules (minidumps)</div>
          {!bsod.length ? <p className="hint">No hay dumps recientes.</p> : null}
          <ul className="moments-list">
            {bsod.map((d) => (
              <li key={d.path}>
                <strong>
                  {d.name} · {d.sizeMb} MB
                </strong>
                <small>
                  {d.time} — {d.explain}
                </small>
              </li>
            ))}
          </ul>
          {instab ? <p className="hint">{instab.message}</p> : null}
        </div>
      </div>
    )
  }

  if (page === 'netlab') {
    return (
      <>
        <div className="netlab-metrics" style={{ marginBottom: 14 }}>
          <div className="netlab-metric">
            <small>↓ Tiempo real</small>
            <strong>{throughput?.downMbps?.toFixed?.(2) ?? '--'} Mbps</strong>
          </div>
          <div className="netlab-metric">
            <small>↑ Tiempo real</small>
            <strong>{throughput?.upMbps?.toFixed?.(2) ?? '--'} Mbps</strong>
          </div>
        </div>
        <div className="grid grid-2">
          <div className="card">
            <div className="section-title">Conexiones activas</div>
            <ul className="moments-list" style={{ maxHeight: 280, overflow: 'auto' }}>
              {conns.map((c, i) => (
                <li key={i}>
                  <strong>
                    {c.process || 'pid'} ({c.pid})
                  </strong>
                  <small>
                    {c.local} → {c.remote}
                  </small>
                </li>
              ))}
            </ul>
          </div>
          <div className="card">
            <div className="section-title">Dispositivos en LAN (ARP)</div>
            <ul className="moments-list" style={{ maxHeight: 200, overflow: 'auto' }}>
              {devices.map((d, i) => (
                <li key={i}>
                  <strong>{d.ip}</strong>
                  <small>
                    {d.mac} · {d.type}
                  </small>
                </li>
              ))}
            </ul>
            <div className="section-title" style={{ marginTop: 12 }}>
              Firewall básico
            </div>
            {(firewall || []).length ? (
              (firewall || []).map((p: any) => (
              <div className="control-row" key={p.Name}>
                <span>{p.Name}</span>
                <button
                  className="btn ghost"
                  type="button"
                  onClick={() =>
                    void window.eyed
                      ?.setFirewall?.(p.Name, !p.Enabled)
                      .then((r) => {
                        log(r?.message || '')
                        return window.eyed?.getFirewall?.()
                      })
                      .then((d) => setFirewall(d?.profiles || []))
                  }
                >
                  {p.Enabled ? 'ON' : 'OFF'}
                </button>
              </div>
              ))
            ) : (
              <p className="hint">Firewall de Windows no disponible en este sistema.</p>
            )}
          </div>
        </div>
      </>
    )
  }

  return null
}

export function DiskTools({ letter = 'C' }: { letter?: string }) {
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState('')
  const run = async (kind: 'trim' | 'defrag') => {
    setBusy(kind)
    setMsg(kind === 'trim' ? 'Aplicando TRIM (puede pedir admin)…' : 'Desfragmentando (puede pedir admin)…')
    try {
      const r = await window.eyed?.optimizeVolume?.(letter, kind)
      setMsg(r?.message || (r?.ok ? 'Listo' : 'Falló'))
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Error')
    } finally {
      setBusy('')
    }
  }
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="section-title">TRIM / Desfragmentación</div>
      <p className="hint">SSD → TRIM. HDD → Desfragmentar. Si Windows bloquea, pedirá UAC una vez.</p>
      <div className="home-cta-row">
        <button className="btn primary" type="button" disabled={!!busy} onClick={() => void run('trim')}>
          {busy === 'trim' ? '…' : 'Optimizar TRIM (SSD)'}
        </button>
        <button className="btn ghost" type="button" disabled={!!busy} onClick={() => void run('defrag')}>
          {busy === 'defrag' ? '…' : 'Desfragmentar (HDD)'}
        </button>
      </div>
      {msg ? (
        <p className="hint" style={{ marginTop: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {msg}
        </p>
      ) : null}
    </div>
  )
}
