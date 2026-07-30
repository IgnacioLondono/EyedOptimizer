/**
 * Ventana del juego + romper exclusive fullscreen.
 * DXGI exclusive tapa CUALQUIER overlay hasta Alt-Tab / tecla Windows.
 * Solución: detectar QUNS_RUNNING_D3D_FULL_SCREEN y pasar el juego a borderless.
 */
const { execFile } = require('node:child_process')
const { isWindows } = require('./platform.cjs')

let lastRect = null
let lastRectAt = 0
let lastPid = 0
const borderlessDone = new Map()
let lastBorderlessAt = 0
let lastFgInfo = null
let lastFgInfoAt = 0
let lastBreakAt = 0
let lastExclusive = false

function runPs(script, timeout = 2800) {
  if (!isWindows) return Promise.resolve('')
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout, encoding: 'utf8', maxBuffer: 64 * 1024 },
      (err, stdout) => {
        if (err) return resolve('')
        resolve(String(stdout || '').trim())
      },
    )
  })
}

/**
 * Rectángulo del área cliente de la ventana principal del juego (coords pantalla).
 */
async function getGameClientRect(pid, force = false) {
  if (!isWindows) return null
  const id = Number(pid) || 0
  if (!id) return null
  const now = Date.now()
  if (!force && lastPid === id && lastRect && now - lastRectAt < 2500) return lastRect

  const script = `
$ErrorActionPreference='SilentlyContinue'
if (-not ('EyedWin.Native' -as [type])) {
  Add-Type -Namespace EyedWin -Name Native -MemberDefinition @"
using System;
using System.Runtime.InteropServices;
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
public struct POINT { public int X; public int Y; }
[DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
[DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
[DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
[DllImport("user32.dll")] public static extern int GetSystemMetrics(int n);
"@
}
$p = Get-Process -Id ${id} -EA SilentlyContinue
if (-not $p) { return }
$h = $p.MainWindowHandle
if ($h -eq [IntPtr]::Zero -or -not [EyedWin.Native]::IsWindow($h)) { return }
if (-not [EyedWin.Native]::IsWindowVisible($h) -or [EyedWin.Native]::IsIconic($h)) {
  Write-Output 'hidden'
  return
}
$r = New-Object EyedWin.Native+RECT
[void][EyedWin.Native]::GetClientRect($h, [ref]$r)
$pt = New-Object EyedWin.Native+POINT
$pt.X = 0; $pt.Y = 0
[void][EyedWin.Native]::ClientToScreen($h, [ref]$pt)
$w = $r.Right - $r.Left
$hgt = $r.Bottom - $r.Top
if ($w -lt 80 -or $hgt -lt 80) {
  $wr = New-Object EyedWin.Native+RECT
  [void][EyedWin.Native]::GetWindowRect($h, [ref]$wr)
  $w = $wr.Right - $wr.Left
  $hgt = $wr.Bottom - $wr.Top
  $pt.X = $wr.Left
  $pt.Y = $wr.Top
}
if ($w -lt 80 -or $hgt -lt 80) { return }
$sw = [EyedWin.Native]::GetSystemMetrics(0)
$sh = [EyedWin.Native]::GetSystemMetrics(1)
$full = if ($sw -gt 0 -and $sh -gt 0 -and $w -ge ($sw - 16) -and $hgt -ge ($sh - 16)) { 1 } else { 0 }
Write-Output ("{0}|{1}|{2}|{3}|{4}|{5}" -f $pt.X, $pt.Y, $w, $hgt, $h, $full)
`
  const raw = await runPs(script)
  if (!raw || raw === 'hidden') {
    lastRect = null
    lastPid = id
    lastRectAt = now
    return null
  }
  const parts = raw.split('|')
  const x = Number(parts[0])
  const y = Number(parts[1])
  const width = Number(parts[2])
  const height = Number(parts[3])
  const hwnd = parts[4]
  const fullscreen = parts[5] === '1'
  if (![x, y, width, height].every((n) => Number.isFinite(n))) return null
  lastRect = { x, y, width, height, hwnd: String(hwnd), fullscreen }
  lastPid = id
  lastRectAt = now
  return lastRect
}

/**
 * Convierte la ventana del juego a borderless fullscreen (DWM puede componer el OSD encima).
 */
async function forceBorderlessFullscreen(pid, monitor, opts = {}) {
  if (!isWindows) return { ok: false, skipped: true }
  const id = Number(pid) || 0
  if (!id) return { ok: false }
  const now = Date.now()
  const prev = borderlessDone.get(id) || 0
  if (!opts.force && now - prev < 5000 && now - lastBorderlessAt < 1500) {
    return { ok: true, cached: true }
  }

  const mx = Number(monitor?.x) || 0
  const my = Number(monitor?.y) || 0
  const mw = Number(monitor?.width) || 0
  const mh = Number(monitor?.height) || 0
  const hwndHint = opts.hwnd ? String(opts.hwnd).replace(/[^\d]/g, '') : ''

  const script = `
$ErrorActionPreference='SilentlyContinue'
if (-not ('EyedFS.Native' -as [type])) {
  Add-Type -Namespace EyedFS -Name Native -MemberDefinition @"
using System;
using System.Runtime.InteropServices;
public static class Native {
  public const int GWL_STYLE = -16;
  public const int GWL_EXSTYLE = -20;
  public const int WS_CAPTION = 0x00C00000;
  public const int WS_THICKFRAME = 0x00040000;
  public const int WS_MINIMIZE = 0x20000000;
  public const int WS_MAXIMIZE = 0x01000000;
  public const int WS_SYSMENU = 0x00080000;
  public const int WS_BORDER = 0x00800000;
  public const int WS_DLGFRAME = 0x00400000;
  public const int WS_POPUP = unchecked((int)0x80000000);
  public const int WS_VISIBLE = 0x10000000;
  public const int WS_EX_DLGMODALFRAME = 0x00000001;
  public const int WS_EX_CLIENTEDGE = 0x00000200;
  public const int WS_EX_STATICEDGE = 0x00020000;
  public const int WS_EX_WINDOWEDGE = 0x00000100;
  public const int WS_EX_TOPMOST = 0x00000008;
  public const uint SWP_FRAMECHANGED = 0x0020;
  public const uint SWP_SHOWWINDOW = 0x0040;
  public const uint SWP_NOACTIVATE = 0x0010;
  public const uint SWP_ASYNCWINDOWPOS = 0x4000;
  public static readonly IntPtr HWND_NOTOPMOST = new IntPtr(-2);
  public static readonly IntPtr HWND_TOP = new IntPtr(0);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr h, int n, int v);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr i, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lp, IntPtr l);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@
}
function Fix-Window([IntPtr]$h, [int]$x, [int]$y, [int]$w, [int]$ht) {
  if ($h -eq [IntPtr]::Zero -or -not [EyedFS.Native]::IsWindow($h)) { return $false }
  if ([EyedFS.Native]::IsIconic($h)) { [void][EyedFS.Native]::ShowWindow($h, 9) }
  $style = [EyedFS.Native]::GetWindowLong($h, [EyedFS.Native]::GWL_STYLE)
  $ex = [EyedFS.Native]::GetWindowLong($h, [EyedFS.Native]::GWL_EXSTYLE)
  $style = $style -band (-bnot ([EyedFS.Native]::WS_CAPTION -bor [EyedFS.Native]::WS_THICKFRAME -bor [EyedFS.Native]::WS_MINIMIZE -bor [EyedFS.Native]::WS_MAXIMIZE -bor [EyedFS.Native]::WS_SYSMENU -bor [EyedFS.Native]::WS_BORDER -bor [EyedFS.Native]::WS_DLGFRAME))
  $style = $style -bor [EyedFS.Native]::WS_POPUP -bor [EyedFS.Native]::WS_VISIBLE
  $ex = $ex -band (-bnot ([EyedFS.Native]::WS_EX_DLGMODALFRAME -bor [EyedFS.Native]::WS_EX_CLIENTEDGE -bor [EyedFS.Native]::WS_EX_STATICEDGE -bor [EyedFS.Native]::WS_EX_WINDOWEDGE -bor [EyedFS.Native]::WS_EX_TOPMOST))
  [void][EyedFS.Native]::SetWindowLong($h, [EyedFS.Native]::GWL_STYLE, $style)
  [void][EyedFS.Native]::SetWindowLong($h, [EyedFS.Native]::GWL_EXSTYLE, $ex)
  $flags = [EyedFS.Native]::SWP_FRAMECHANGED -bor [EyedFS.Native]::SWP_SHOWWINDOW -bor [EyedFS.Native]::SWP_NOACTIVATE -bor [EyedFS.Native]::SWP_ASYNCWINDOWPOS
  # 1px menos y luego tamaño completo: fuerza a DXGI a salir de exclusive (como Alt-Tab/Win)
  $w1 = [Math]::Max(200, $w - 1)
  $h1 = [Math]::Max(200, $ht - 1)
  [void][EyedFS.Native]::SetWindowPos($h, [EyedFS.Native]::HWND_NOTOPMOST, $x, $y, $w1, $h1, $flags)
  [void][EyedFS.Native]::SetWindowPos($h, [EyedFS.Native]::HWND_NOTOPMOST, $x, $y, $w, $ht, $flags)
  [void][EyedFS.Native]::ShowWindow($h, 5)
  return $true
}

$x = ${mx}; $y = ${my}; $w = ${mw}; $ht = ${mh}
if ($w -lt 200 -or $ht -lt 200) {
  $x = 0; $y = 0
  $w = [EyedFS.Native]::GetSystemMetrics(0)
  $ht = [EyedFS.Native]::GetSystemMetrics(1)
}
if ($w -lt 200 -or $ht -lt 200) { Write-Output 'badmon'; return }

$target = [IntPtr]::Zero
$hint = '${hwndHint}'
if ($hint -ne '') {
  try { $target = [IntPtr]([int64]$hint) } catch { $target = [IntPtr]::Zero }
}
if ($target -eq [IntPtr]::Zero -or -not [EyedFS.Native]::IsWindow($target)) {
  $p = Get-Process -Id ${id} -EA SilentlyContinue
  if (-not $p) { Write-Output 'gone'; return }
  $target = $p.MainWindowHandle
}
# Si MainWindowHandle falla (Unity/Unreal), buscar la ventana más grande del PID
if ($target -eq [IntPtr]::Zero -or -not [EyedFS.Native]::IsWindow($target)) {
  $best = [IntPtr]::Zero
  $bestArea = 0
  $pidWant = [uint32]${id}
  $cb = [EyedFS.Native+EnumWindowsProc]{
    param([IntPtr]$hwnd, [IntPtr]$l)
    $wp = [uint32]0
    [void][EyedFS.Native]::GetWindowThreadProcessId($hwnd, [ref]$wp)
    if ($wp -ne $pidWant) { return $true }
    if (-not [EyedFS.Native]::IsWindowVisible($hwnd)) { return $true }
    $rr = New-Object EyedFS.Native+RECT
    [void][EyedFS.Native]::GetWindowRect($hwnd, [ref]$rr)
    $area = ($rr.Right - $rr.Left) * ($rr.Bottom - $rr.Top)
    if ($area -gt $bestArea) { $script:bestArea = $area; $script:best = $hwnd }
    return $true
  }
  [void][EyedFS.Native]::EnumWindows($cb, [IntPtr]::Zero)
  if ($best -ne [IntPtr]::Zero) { $target = $best }
}
if ($target -eq [IntPtr]::Zero) { Write-Output 'nohwnd'; return }
$ok = Fix-Window $target $x $y $w $ht
if ($ok) { Write-Output ("ok|{0}|{1}|{2}|{3}|{4}" -f $x, $y, $w, $ht, $target) } else { Write-Output 'fail' }
`
  const raw = await runPs(script, 4500)
  lastBorderlessAt = now
  borderlessDone.set(id, now)
  if (String(raw).startsWith('ok|')) {
    clearGameWindowCache()
    lastFgInfoAt = 0
    return { ok: true, applied: true, raw, hwnd: String(raw).split('|')[5] || opts.hwnd || '' }
  }
  return { ok: false, raw: String(raw || '') }
}

function clearGameWindowCache() {
  lastRect = null
  lastRectAt = 0
  lastPid = 0
}

function clearBorderlessCache(pid) {
  if (pid) borderlessDone.delete(Number(pid))
  else borderlessDone.clear()
}

/**
 * Estado de notificación Windows: 3 = QUNS_RUNNING_D3D_FULL_SCREEN (exclusive).
 * Eso es exactamente cuando el OSD queda debajo hasta pulsar Win.
 */
async function queryD3dExclusiveState() {
  if (!isWindows) return { exclusive: false, quns: 0 }
  const script = `
$ErrorActionPreference='SilentlyContinue'
if (-not ('EyedQuns.Native' -as [type])) {
  Add-Type -Namespace EyedQuns -Name Native -MemberDefinition @"
using System;
using System.Runtime.InteropServices;
public static class Native {
  [DllImport("shell32.dll")] public static extern int SHQueryUserNotificationState(out int state);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int n);
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@
}
$st = 0
[void][EyedQuns.Native]::SHQueryUserNotificationState([ref]$st)
$h = [EyedQuns.Native]::GetForegroundWindow()
$id = 0; $name = ''; $hwnd = 0; $full = 0
if ($h -ne [IntPtr]::Zero -and [EyedQuns.Native]::IsWindow($h) -and -not [EyedQuns.Native]::IsIconic($h)) {
  [void][EyedQuns.Native]::GetWindowThreadProcessId($h, [ref]$id)
  $hwnd = $h.ToInt64()
  $p = Get-Process -Id $id -EA SilentlyContinue
  if ($p) { $name = $p.ProcessName }
  $r = New-Object EyedQuns.Native+RECT
  [void][EyedQuns.Native]::GetWindowRect($h, [ref]$r)
  $sw = [EyedQuns.Native]::GetSystemMetrics(0)
  $sh = [EyedQuns.Native]::GetSystemMetrics(1)
  $ww = $r.Right - $r.Left
  $hh = $r.Bottom - $r.Top
  if ($sw -gt 0 -and $sh -gt 0 -and $ww -ge ($sw - 24) -and $hh -ge ($sh - 24)) { $full = 1 }
}
Write-Output ("{0}|{1}|{2}|{3}|{4}" -f $st, $id, $hwnd, $full, $name)
`
  const raw = await runPs(script, 2000)
  if (!raw) return { exclusive: false, quns: 0 }
  const parts = raw.split('|')
  const quns = Number(parts[0]) || 0
  const pid = Number(parts[1]) || 0
  const hwnd = String(parts[2] || '')
  const fullscreen = parts[3] === '1'
  const processName = parts[4] || ''
  // 3 = D3D exclusive fullscreen; 2 = busy (presentation)
  const exclusive = quns === 3 || (quns === 2 && fullscreen)
  const skip = /^(EyedOptimizer|electron|explorer|SearchHost|ShellExperienceHost|ApplicationFrameHost|TextInputHost|SystemSettings|dwm)$/i.test(
    processName,
  )
  return {
    exclusive: exclusive && !skip,
    quns,
    pid: skip ? 0 : pid,
    hwnd: skip ? '' : hwnd,
    fullscreen,
    processName,
  }
}

async function getForegroundWindowInfo(force = false) {
  if (!isWindows) return null
  const now = Date.now()
  if (!force && lastFgInfo && now - lastFgInfoAt < 1200) return lastFgInfo
  const st = await queryD3dExclusiveState()
  lastFgInfoAt = now
  if (!st.pid) {
    lastFgInfo = lastFgInfo && now - lastFgInfoAt < 8000 ? lastFgInfo : null
    return lastFgInfo
  }
  lastFgInfo = {
    pid: st.pid,
    hwnd: st.hwnd,
    fullscreen: !!st.fullscreen || !!st.exclusive,
    exclusive: !!st.exclusive,
    processName: st.processName,
    quns: st.quns,
  }
  lastExclusive = !!st.exclusive
  return lastFgInfo
}

/**
 * Si Windows reporta D3D exclusive (o ventana a pantalla completa),
 * fuerza borderless para que el OSD pueda componerse encima.
 */
async function ensureOverlayCanCoverFullscreen(monitor) {
  const info = await getForegroundWindowInfo(true)
  if (!info?.pid) return { ...(info || {}), broke: false, exclusive: lastExclusive }
  const needBreak = info.exclusive || info.fullscreen
  if (!needBreak) {
    lastExclusive = false
    return { ...info, broke: false, exclusive: false }
  }
  const now = Date.now()
  // En exclusive: reintentar muy seguido (el juego puede volver a exclusive)
  if (info.exclusive && now - lastBreakAt < 700) {
    return { ...info, broke: false, exclusive: true }
  }
  lastBreakAt = now
  const r = await forceBorderlessFullscreen(info.pid, monitor, {
    force: true,
    hwnd: info.hwnd,
  })
  lastExclusive = true
  return {
    ...info,
    hwnd: r.hwnd || info.hwnd,
    broke: !!r.applied,
    exclusive: true,
  }
}

function isLastExclusive() {
  return lastExclusive
}

module.exports = {
  getGameClientRect,
  forceBorderlessFullscreen,
  clearGameWindowCache,
  clearBorderlessCache,
  getForegroundWindowInfo,
  ensureOverlayCanCoverFullscreen,
  queryD3dExclusiveState,
  isLastExclusive,
}
