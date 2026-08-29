@ECHO off
REM dsh-agent - one-shot DeepSeek Harness agent (subagent interface for orchestrators).
REM See dsh-agent.mjs for usage. Calls node directly so it works even when
REM PowerShell's .ps1 execution policy blocks the npm ps1 shims.
SETLOCAL
SET "_prog=node"
IF EXIST "%~dp0node.exe" SET "_prog=%~dp0node.exe"
"%_prog%" "%~dp0dsh-agent.mjs" %*
EXIT /b %ERRORLEVEL%
