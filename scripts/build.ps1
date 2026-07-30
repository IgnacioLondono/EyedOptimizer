#Requires -Version 5.1
<#
.SYNOPSIS
  Compila EyedOptimizer.exe y genera el instalador profesional.
#>
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $Root "main.py"))) {
    $Root = $PSScriptRoot
    if (-not (Test-Path (Join-Path $Root "main.py"))) {
        $Root = Split-Path -Parent $PSScriptRoot
    }
}
# scripts/build.ps1 -> root is parent
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
if ((Split-Path -Leaf $Root) -eq "scripts") {
    $Root = Split-Path -Parent $Root
}

Set-Location $Root
Write-Host "==> EyedOptimizer build" -ForegroundColor Cyan
Write-Host "Root: $Root"

$python = (Get-Command python -ErrorAction Stop).Source
Write-Host "Python: $python"

Write-Host "==> Dependencias"
& $python -m pip install -r requirements.txt --upgrade

Write-Host "==> Icono y wizard"
& $python scripts\generate_icon.py
& $python scripts\generate_wizard_images.py

Write-Host "==> PyInstaller"
& $python -m PyInstaller EyedOptimizer.spec --noconfirm --clean

$exe = Join-Path $Root "dist\EyedOptimizer\EyedOptimizer.exe"
if (-not (Test-Path $exe)) {
    throw "No se generó EyedOptimizer.exe"
}
Write-Host "EXE OK: $exe" -ForegroundColor Green

# Buscar Inno Setup Compiler
$isccCandidates = @(
    "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles}\Inno Setup 6\ISCC.exe"
)
$iscc = $isccCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($iscc) {
    Write-Host "==> Compilando instalador con Inno Setup"
    New-Item -ItemType Directory -Force -Path (Join-Path $Root "dist\installer") | Out-Null
    & $iscc (Join-Path $Root "installer\EyedOptimizer.iss")
    Write-Host "Instalador generado en dist\installer\" -ForegroundColor Green
} else {
    Write-Host "Inno Setup no encontrado. Generando instalador PowerShell de respaldo..." -ForegroundColor Yellow
    & (Join-Path $Root "scripts\build_portable_installer.ps1")
}

Write-Host "`nBuild completado." -ForegroundColor Green
