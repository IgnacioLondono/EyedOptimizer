import { useEffect } from 'react'

type Props = {
  open: boolean
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  /** Solo un botón (reemplaza alert) */
  alertOnly?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** Modal de confirmación con el diseño dark de EyedOptimizer (reemplaza window.confirm / alert). */
export function ConfirmModal({
  open,
  title = 'Confirmar',
  message,
  confirmLabel = 'Aceptar',
  cancelLabel = 'Cancelar',
  danger = false,
  alertOnly = false,
  onConfirm,
  onCancel,
}: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
      if (e.key === 'Enter') onConfirm()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel, onConfirm])

  if (!open) return null

  return (
    <div className="modal-backdrop" onClick={onCancel} role="presentation">
      <div
        className="modal-card modal-card-confirm"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
      >
        <div className="modal-head">
          <div className="modal-title">
            <div>
              <h3 id="confirm-title">{title}</h3>
              <p>EyedOptimizer</p>
            </div>
          </div>
          <button type="button" className="modal-close" onClick={onCancel} aria-label="Cerrar">
            ×
          </button>
        </div>
        <div className="modal-body">
          <p className="confirm-message">{message}</p>
        </div>
        <div className="modal-actions">
          {!alertOnly ? (
            <button type="button" className="btn ghost" onClick={onCancel}>
              {cancelLabel}
            </button>
          ) : null}
          <button
            type="button"
            className={danger ? 'btn danger' : 'btn primary'}
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
