@echo off
title EyedOptimizer - Setup dependencias
cd /d "%~dp0"

echo ========================================
echo   EyedOptimizer - Instalando todo
echo ========================================
echo.

where node >nul 2>&1 || (
  echo [!] Node.js no encontrado. Instala LTS desde https://nodejs.org
  pause
  exit /b 1
)

where python >nul 2>&1 || (
  echo [!] Python no encontrado.
  pause
  exit /b 1
)

echo [1/3] Dependencias Python...
python -m pip install -r requirements.txt --upgrade

echo [2/3] Dependencias Electron/React...
cd desktop
call npm install
cd ..

echo [3/3] Build de la interfaz...
cd desktop
call npm run build
cd ..

echo.
echo Listo.
echo  - Clasica:  run.bat
echo  - React:    run-desktop.bat
echo  - Instalador Electron: cd desktop ^&^& npm run dist
echo.
pause
