@echo off
setlocal
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo Run npm install first.
  pause
  exit /b 1
)
if not exist "dist\index.html" call npm.cmd run desktop:build
if errorlevel 1 exit /b 1
call npm.cmd run electron
if errorlevel 1 pause
