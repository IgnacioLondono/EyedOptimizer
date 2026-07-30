#Requires -Version 5.1
<#
.SYNOPSIS
  Crea EyedOptimizer_Setup.exe (instalador autoextraíble profesional sin Inno Setup).
#>
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
if ((Split-Path -Leaf $Root) -eq "scripts") { $Root = Split-Path -Parent $Root }
Set-Location $Root

$AppDir = Join-Path $Root "dist\EyedOptimizer"
$OutDir = Join-Path $Root "dist\installer"
$Stage = Join-Path $Root "dist\_installer_stage"
$ZipPath = Join-Path $OutDir "EyedOptimizer_payload.zip"
$SetupPs1 = Join-Path $Stage "Install-EyedOptimizer.ps1"
$Launcher = Join-Path $OutDir "EyedOptimizer_Setup_1.0.0.cmd"

if (-not (Test-Path (Join-Path $AppDir "EyedOptimizer.exe"))) {
    throw "Falta dist\EyedOptimizer\EyedOptimizer.exe. Ejecuta primero build.ps1"
}

New-Item -ItemType Directory -Force -Path $OutDir, $Stage | Out-Null
if (Test-Path $Stage) { Remove-Item $Stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Stage | Out-Null

Copy-Item -Path (Join-Path $AppDir "*") -Destination $Stage -Recurse -Force
$assetsSrc = Join-Path $Root "assets"
if (Test-Path $assetsSrc) {
    New-Item -ItemType Directory -Force -Path (Join-Path $Stage "assets") | Out-Null
    Copy-Item -Path (Join-Path $assetsSrc "*") -Destination (Join-Path $Stage "assets") -Recurse -Force
}

@'
# EyedOptimizer Installer 1.0.0
$ErrorActionPreference = "Stop"
$Host.UI.RawUI.WindowTitle = "EyedOptimizer Setup"

function Write-Step($msg) { Write-Host "  > $msg" -ForegroundColor Cyan }

Write-Host ""
Write-Host "  =============================================" -ForegroundColor Blue
Write-Host "       EyedOptimizer 1.0.0 - Instalador" -ForegroundColor White
Write-Host "  =============================================" -ForegroundColor Blue
Write-Host ""
Write-Host "  Monitorizacion y optimizacion profesional." -ForegroundColor Gray
Write-Host ""

$default = Join-Path ${env:ProgramFiles} "EyedOptimizer"
$dest = Read-Host "  Carpeta de instalacion [$default]"
if ([string]::IsNullOrWhiteSpace($dest)) { $dest = $default }

Write-Step "Creando carpeta..."
New-Item -ItemType Directory -Force -Path $dest | Out-Null

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Step "Copiando archivos..."
Copy-Item -Path (Join-Path $here "*") -Destination $dest -Recurse -Force -Exclude "Install-EyedOptimizer.ps1"

$exe = Join-Path $dest "EyedOptimizer.exe"
if (-not (Test-Path $exe)) { throw "No se encontro EyedOptimizer.exe" }

Write-Step "Creando accesos directos..."
$WshShell = New-Object -ComObject WScript.Shell
$startDir = Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs\EyedOptimizer"
New-Item -ItemType Directory -Force -Path $startDir | Out-Null
$lnk = $WshShell.CreateShortcut((Join-Path $startDir "EyedOptimizer.lnk"))
$lnk.TargetPath = $exe
$lnk.IconLocation = (Join-Path $dest "assets\icon.ico")
$lnk.WorkingDirectory = $dest
$lnk.Save()

$desk = Read-Host "  Crear icono en el escritorio? (S/N) [S]"
if ([string]::IsNullOrWhiteSpace($desk) -or $desk -match '^[sSyY]') {
    $dlnk = $WshShell.CreateShortcut((Join-Path ([Environment]::GetFolderPath("Desktop")) "EyedOptimizer.lnk"))
    $dlnk.TargetPath = $exe
    $dlnk.IconLocation = (Join-Path $dest "assets\icon.ico")
    $dlnk.WorkingDirectory = $dest
    $dlnk.Save()
}

# Desinstalador simple
$uninst = @"
`$ErrorActionPreference = 'Stop'
Write-Host 'Desinstalando EyedOptimizer...'
Remove-Item -LiteralPath '$startDir' -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path ([Environment]::GetFolderPath('Desktop')) 'EyedOptimizer.lnk') -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
Remove-Item -LiteralPath '$dest' -Recurse -Force
Write-Host 'EyedOptimizer desinstalado.'
pause
"@
Set-Content -Path (Join-Path $dest "Uninstall.ps1") -Value $uninst -Encoding UTF8
$ulnk = $WshShell.CreateShortcut((Join-Path $startDir "Desinstalar EyedOptimizer.lnk"))
$ulnk.TargetPath = "powershell.exe"
$ulnk.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$dest\Uninstall.ps1`""
$ulnk.Save()

Write-Host ""
Write-Host "  Instalacion completada en:" -ForegroundColor Green
Write-Host "  $dest"
Write-Host ""
$run = Read-Host "  Iniciar EyedOptimizer ahora? (S/N) [S]"
if ([string]::IsNullOrWhiteSpace($run) -or $run -match '^[sSyY]') {
    Start-Process $exe
}
'@ | Set-Content -Path $SetupPs1 -Encoding UTF8

if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
Compress-Archive -Path (Join-Path $Stage "*") -DestinationPath $ZipPath -Force

# Launcher CMD autoextraíble
$launcherContent = @"
@echo off
title EyedOptimizer Setup
setlocal
set "TMPDIR=%TEMP%\EyedOptimizer_Setup_%RANDOM%"
mkdir "%TMPDIR%" >nul 2>&1
echo.
echo   Extrayendo EyedOptimizer...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath '%~dp0EyedOptimizer_payload.zip' -DestinationPath '%TMPDIR%' -Force"
if errorlevel 1 (
  echo Error al extraer el paquete.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%TMPDIR%\Install-EyedOptimizer.ps1"
endlocal
"@
Set-Content -Path $Launcher -Value $launcherContent -Encoding ASCII

# Copiar zip junto al launcher
Copy-Item $ZipPath -Destination (Join-Path $OutDir "EyedOptimizer_payload.zip") -Force

Write-Host "Instalador creado:" -ForegroundColor Green
Write-Host "  $Launcher"
Write-Host "  (junto a EyedOptimizer_payload.zip)"
Write-Host "Ejecuta EyedOptimizer_Setup_1.0.0.cmd para instalar."
