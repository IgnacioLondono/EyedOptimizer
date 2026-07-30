# EyedOptimizer

Monitor de rendimiento, overlay FPS en juegos, Discord Rich Presence y utilidades para Windows.

## Descargar

1. Ve a: https://github.com/IgnacioLondono/EyedOptimizer
2. Pulsa el botón verde **Code** → **Download ZIP**, o clona:

```bash
git clone https://github.com/IgnacioLondono/EyedOptimizer.git
```

## App Electron (recomendada)

Código en `desktop/`:

```powershell
cd desktop
npm install
npm run dev
```

Compilar paquete Windows (carpeta sin instalador):

```powershell
cd desktop
npm run build
npx electron-builder --win dir
```

La salida queda en `desktop/release/win-unpacked/`.

Instalador NSIS:

```powershell
cd desktop
npm run dist:win
```

## Requisitos

- Windows 10 / 11 (64-bit)
- Node.js 20+ (desarrollo)
- Python 3.12+ (solo si usas la app clásica en la raíz)

## App Python (legacy)

```powershell
python -m pip install -r requirements.txt
python main.py
```

## Licencia

MIT
