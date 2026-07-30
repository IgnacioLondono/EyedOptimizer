@echo off
cd /d "%~dp0desktop"
echo EyedOptimizer (React + Overlay)
echo.
if not exist node_modules (
  call npm install
)
call npm run dev
