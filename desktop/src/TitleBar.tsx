import { useEffect, useState } from 'react'

export function TitleBar() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    window.eyed?.isMaximized().then((v) => setMaximized(!!v))
    return window.eyed?.onWindowState((s) => setMaximized(!!s.maximized))
  }, [])

  return (
    <div className="chrome-controls titlebar-controls">
      <button
        type="button"
        className="win-btn"
        title="Segundo plano"
        onClick={() => window.eyed?.hideToTray()}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
          <rect x="1" y="7" width="10" height="2" rx="1" fill="currentColor" />
          <path d="M2 5h8M4 3h4" stroke="currentColor" strokeWidth="1.2" fill="none" />
        </svg>
      </button>
      <button
        type="button"
        className="win-btn"
        title="Minimizar"
        onClick={() => window.eyed?.minimizeWindow()}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <rect x="1" y="5" width="8" height="1.5" rx="0.5" fill="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        className="win-btn"
        title={maximized ? 'Restaurar' : 'Maximizar'}
        onClick={async () => {
          const v = await window.eyed?.maximizeWindow()
          setMaximized(!!v)
        }}
      >
        {maximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <path d="M3 2h5v5H3V2zM2 3v5h5" stroke="currentColor" strokeWidth="1.2" fill="none" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <rect x="1.5" y="1.5" width="7" height="7" rx="0.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
          </svg>
        )}
      </button>
      <button
        type="button"
        className="win-btn win-close"
        title="Cerrar"
        onClick={() => window.eyed?.closeWindow()}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}
