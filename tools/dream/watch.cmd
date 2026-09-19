@echo off
rem Double-click this to watch the newest Dream run. Drop a run directory on it
rem to watch that one instead. It runs from the checkout root because watch.sh
rem reads agent-runs/ by relative path, and it calls Git's bash by path because
rem the WSL bash in System32 also answers to "bash" and has no node.
setlocal
cd /d "%~dp0..\.."
title Dream watch

set "BASH=%ProgramFiles%\Git\bin\bash.exe"
if not exist "%BASH%" set "BASH=%ProgramFiles%\Git\usr\bin\bash.exe"
if not exist "%BASH%" set "BASH=%LocalAppData%\Programs\Git\bin\bash.exe"
if not exist "%BASH%" set "BASH=%ProgramFiles(x86)%\Git\bin\bash.exe"
if not exist "%BASH%" set "BASH="

if not defined BASH (
  echo Git Bash was not found. Install Git for Windows: https://git-scm.com/download/win
  echo Or run the watcher from Git Bash: bash tools/dream/watch.sh
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo node was not found on PATH. Install Node.js or add it to PATH.
  pause
  exit /b 1
)

"%BASH%" tools/dream/watch.sh %*
if errorlevel 1 (
  echo.
  echo watch.sh exited with code %errorlevel%.
  pause
)
