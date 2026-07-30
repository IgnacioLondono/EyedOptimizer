import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { error: Error | null }

/** Evita pantalla vacía (fondo azul Electron) si React revienta. */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('EyedOptimizer UI crash', error, info?.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div
        style={{
          height: '100%',
          display: 'grid',
          placeItems: 'center',
          padding: 32,
          background: '#06080f',
          color: '#eef3fb',
          fontFamily: 'Segoe UI, system-ui, sans-serif',
          textAlign: 'center',
        }}
      >
        <div style={{ maxWidth: 420 }}>
          <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>EyedOptimizer se detuvo un momento</h1>
          <p style={{ color: '#8b9bb3', fontSize: 13, lineHeight: 1.45 }}>
            La interfaz falló, pero la app sigue abierta. Puedes recargar sin reiniciar Windows.
          </p>
          <p
            style={{
              marginTop: 12,
              fontSize: 11,
              color: '#5f708a',
              wordBreak: 'break-word',
              fontFamily: 'Consolas, monospace',
            }}
          >
            {this.state.error.message}
          </p>
          <button
            type="button"
            onClick={() => {
              this.setState({ error: null })
              window.location.reload()
            }}
            style={{
              marginTop: 18,
              border: 0,
              borderRadius: 10,
              padding: '10px 18px',
              background: '#3ec4ff',
              color: '#041018',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Recargar interfaz
          </button>
        </div>
      </div>
    )
  }
}
