@echo off
setlocal
if defined ENGINE_NODE (
  set ELECTRON_RUN_AS_NODE=1
  "%ENGINE_NODE%" "%~dp0engine.mjs" %*
) else (
  node "%~dp0engine.mjs" %*
)
