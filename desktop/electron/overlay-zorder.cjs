/**
 * Fuerza el HWND del overlay por encima del juego (Win32 TOPMOST).
 * Tras borderless, DWM puede componer el OSD encima de pantalla completa.
 */
const { execFile } = require('node:child_process')
const { isWindows } = require('./platform.cjs')

let lastAssert = 0

function hwndFromNativeHandle(buf) {
  if (!buf || !Buffer.isBuffer(buf)) return 0n
  try {
    if (buf.length >= 8) return buf.readBigUInt64LE(0)
    return BigInt(buf.readUInt32LE(0))
  } catch {
    return 0n
  }
}

function runPs(script, timeout = 2200) {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout, encoding: 'utf8', maxBuffer: 64 * 1024 },
      () => resolve(),
    )
  })
}

/**
 * @param {import('electron').BrowserWindow} win
 * @param {{ force?: boolean, minIntervalMs?: number, gameHwnd?: string|number }} [opts]
 */
async function assertNativeTopmost(win, opts = {}) {
  if (!isWindows || !win || win.isDestroyed()) return false
  const now = Date.now()
  const min = opts.minIntervalMs ?? 350
  if (!opts.force && now - lastAssert < min) return false
  lastAssert = now

  let hwnd = 0n
  try {
    hwnd = hwndFromNativeHandle(win.getNativeWindowHandle())
  } catch {
    return false
  }
  if (!hwnd || hwnd === 0n) return false

  try {
    win.setAlwaysOnTop(true, 'screen-saver', 1)
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    // NO moveTop(): roba el foco al juego y empeora exclusive fullscreen
    if (!win.isVisible()) win.showInactive()
  } catch {
    /* */
  }

  const gameHwnd = opts.gameHwnd ? String(opts.gameHwnd).replace(/[^\d]/g, '') : ''
  const gameBlock = gameHwnd
    ? `
$g = [IntPtr]${gameHwnd}
if ([EyedZ.Native]::IsWindow($g)) {
  [void][EyedZ.Native]::SetWindowPos($h, [EyedZ.Native]::HWND_TOPMOST, 0, 0, 0, 0, $flags)
}
`
    : ''

  const script = `
$ErrorActionPreference='SilentlyContinue'
if (-not ('EyedZ.Native' -as [type])) {
  Add-Type -Namespace EyedZ -Name Native -MemberDefinition @"
using System;
using System.Runtime.InteropServices;
public static class Native {
  public static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
  public const uint SWP_NOSIZE = 0x0001;
  public const uint SWP_NOMOVE = 0x0002;
  public const uint SWP_NOACTIVATE = 0x0010;
  public const uint SWP_SHOWWINDOW = 0x0040;
  public const int GWL_EXSTYLE = -20;
  public const long WS_EX_TOPMOST = 0x00000008;
  public const long WS_EX_TOOLWINDOW = 0x00000080;
  public const long WS_EX_NOACTIVATE = 0x08000000;
  public const long WS_EX_TRANSPARENT = 0x00000020;
  public const long WS_EX_LAYERED = 0x00080000;
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr i, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr h, int n, int v);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
}
"@
}
$h = [IntPtr]${hwnd.ToString()}
if (-not [EyedZ.Native]::IsWindow($h)) { return }
$ex = [EyedZ.Native]::GetWindowLong($h, [EyedZ.Native]::GWL_EXSTYLE)
# Sin WS_EX_TRANSPARENT: rompe el hit-test del engranaje (Electron ya usa setIgnoreMouseEvents)
$ex = $ex -bor [EyedZ.Native]::WS_EX_TOPMOST -bor [EyedZ.Native]::WS_EX_TOOLWINDOW -bor [EyedZ.Native]::WS_EX_NOACTIVATE -bor [EyedZ.Native]::WS_EX_LAYERED
$ex = $ex -band (-bnot [EyedZ.Native]::WS_EX_TRANSPARENT)
[void][EyedZ.Native]::SetWindowLong($h, [EyedZ.Native]::GWL_EXSTYLE, $ex)
$flags = [EyedZ.Native]::SWP_NOMOVE -bor [EyedZ.Native]::SWP_NOSIZE -bor [EyedZ.Native]::SWP_NOACTIVATE -bor [EyedZ.Native]::SWP_SHOWWINDOW
[void][EyedZ.Native]::SetWindowPos($h, [EyedZ.Native]::HWND_TOPMOST, 0, 0, 0, 0, $flags)
${gameBlock}
`
  await runPs(script)
  return true
}

module.exports = { assertNativeTopmost, hwndFromNativeHandle }
