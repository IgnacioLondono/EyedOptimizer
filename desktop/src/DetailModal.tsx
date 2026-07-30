import type { ReactNode } from 'react'
import type { AdvancedSpecs, DiskInfo, LiveStats } from './types'
import { AppLogo } from './AppLogo'
import { IconCpu, IconDisk, IconGpu, IconRam } from './icons'

export type DetailKind = 'cpu' | 'ram' | 'disk' | 'gpu'

type Props = {
  kind: DetailKind
  stats: LiveStats | null
  specs: AdvancedSpecs | null
  diskInfo: DiskInfo | null
  onClose: () => void
  onGoTo?: (page: string) => void
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="modal-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

const titles: Record<DetailKind, string> = {
  cpu: 'Procesador (CPU)',
  ram: 'Memoria RAM',
  disk: 'Almacenamiento',
  gpu: 'Tarjeta grafica (GPU)',
}

const icons: Record<DetailKind, ReactNode> = {
  cpu: <IconCpu size={20} />,
  ram: <IconRam size={20} />,
  disk: <IconDisk size={20} />,
  gpu: <IconGpu size={20} />,
}

export function DetailModal({ kind, stats, specs, diskInfo, onClose, onGoTo }: Props) {
  const cpu = stats?.cpu
  const ram = stats?.ram
  const disk = stats?.disk
  const gpu = stats?.gpu

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div className="modal-title">
            <span className="modal-icon">{icons[kind]}</span>
            <div>
              <h3>{titles[kind]}</h3>
              <p>Detalles avanzados en tiempo real</p>
            </div>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>

        <div className="modal-body">
          {kind === 'cpu' && (
            <>
              <Row label="Modelo" value={specs?.cpu.name || cpu?.name || '—'} />
              <Row label="Uso actual" value={`${cpu?.load?.toFixed(1) ?? '--'}%`} />
              <Row label="Temperatura" value={cpu?.temp != null ? `${cpu.temp} °C` : 'N/D'} />
              <Row label="Velocidad" value={cpu?.speed ? `${cpu.speed} GHz` : specs?.cpu.maxMhz ? `${specs.cpu.maxMhz} MHz (max)` : 'N/D'} />
              <Row label="Nucleos / hilos" value={`${specs?.cpu.cores ?? '—'} / ${specs?.cpu.threads ?? '—'}`} />
              <Row label="Socket" value={specs?.cpu.socket || '—'} />
              {cpu?.cores?.length ? (
                <div className="modal-cores">
                  <div className="modal-cores-title">Uso por nucleo</div>
                  <div className="cores cores-modal">
                    {cpu.cores.map((v, i) => (
                      <div className="core-row" key={`mc-${i}`}>
                        <span>C{i}</span>
                        <div className="bar">
                          <span style={{ width: `${v}%`, background: 'var(--cpu)' }} />
                        </div>
                        <strong>{v}%</strong>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          )}

          {kind === 'ram' && (
            <>
              <Row label="En uso" value={`${ram?.usedMb ?? '--'} MB (${ram?.percent?.toFixed(1) ?? '--'}%)`} />
              <Row label="Total" value={specs?.ram.totalLabel || `${ram?.totalMb ?? '--'} MB`} />
              <Row label="Disponible" value={specs?.ram.availableLabel || '—'} />
              <Row label="Modulos" value={specs?.ram.modules?.length ?? 0} />
              {(specs?.ram.modules || []).map((m, i) => (
                <Row
                  key={`mod-${i}`}
                  label={m.bank || `DIMM ${i + 1}`}
                  value={`${m.capacityLabel} · ${m.speed || '—'} MHz`}
                />
              ))}
            </>
          )}

          {kind === 'disk' && (
            <>
              <div className="modal-disk-block">
                <div className="modal-disk-label">Volumen</div>
                <Row label={`Volumen ${disk?.mount || 'C:'}`} value={`${disk?.percent ?? '--'}% usado`} />
                <Row label="Espacio" value={disk ? `${disk.usedGb} / ${disk.totalGb} GB` : '—'} />
                <Row label="Libre" value={disk ? `${disk.freeGb} GB` : '—'} />
              </div>
              {(diskInfo?.disks || []).map((d, i) => (
                <div className="modal-disk-block" key={`md-${i}`}>
                  <div className="modal-disk-label">Disco fisico {i + 1}</div>
                  <Row label="Modelo" value={d.name} />
                  <Row label="Salud" value={`${d.healthPercentLabel} · ${d.statusLabel}`} />
                  <Row label="Vida util" value={d.lifePercent != null ? `${d.lifePercent}%` : 'N/D'} />
                  <Row label="Temperatura" value={d.temperature != null ? `${d.temperature} °C` : 'N/D'} />
                </div>
              ))}
            </>
          )}

          {kind === 'gpu' && (
            <>
              <Row label="Modelo" value={gpu?.name || specs?.gpus?.[0]?.name || '—'} />
              <Row label="Uso" value={`${gpu?.load?.toFixed(1) ?? '--'}%`} />
              <Row label="Temperatura" value={gpu?.temp != null ? `${gpu.temp} °C` : 'N/D'} />
              <Row label="Potencia" value={gpu?.power != null ? `${gpu.power} W` : 'N/D'} />
              <Row label="Ventilador" value={gpu?.fan != null ? `${gpu.fan}%` : 'N/D (solo lectura)'} />
              <Row label="VRAM" value={`${gpu?.vramUsed ?? '--'} / ${gpu?.vramTotal ?? '--'} MB`} />
              <Row label="Driver" value={specs?.gpus?.[0]?.driver || '—'} />
              <Row label="Resolucion" value={specs?.gpus?.[0]?.res || '—'} />
            </>
          )}
        </div>

        <div className="modal-foot">
          {onGoTo ? (
            <button type="button" className="btn ghost" onClick={() => onGoTo(kind === 'cpu' || kind === 'ram' || kind === 'gpu' ? 'specs' : 'disk')}>
              Ver mas en {kind === 'disk' ? 'Disco' : 'Hardware'}
            </button>
          ) : null}
          <button type="button" className="btn primary" onClick={onClose}>
            Cerrar
          </button>
        </div>

        <div className="modal-brand">
          <AppLogo size={18} />
        </div>
      </div>
    </div>
  )
}
