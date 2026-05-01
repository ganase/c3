@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required.
  echo Install Node.js, then run this file again.
  pause
  exit /b 1
)

if "%CODEUI_PORT%"=="" set "CODEUI_PORT=5173"
if "%CODEUI_ROOT%"=="" set "CODEUI_ROOT=%CD%\workspace"
if "%CODEUI_CODEX_ARGS%"=="" set "CODEUI_CODEX_ARGS=exec --skip-git-repo-check --sandbox workspace-write"
if "%CODEUI_CLI_TIMEOUT_MS%"=="" set "CODEUI_CLI_TIMEOUT_MS=600000"

echo Starting Code UI...
echo Preferred URL: http://127.0.0.1:%CODEUI_PORT%/
echo If the port is busy, server.js will print the next available URL.
echo Work root: %CODEUI_ROOT%
echo CLI timeout: %CODEUI_CLI_TIMEOUT_MS% ms
echo.
echo CLI defaults:
echo   Codex:  codex %CODEUI_CODEX_ARGS%
echo   Claude: claude -p
echo.
echo CLI path check:
where codex
if errorlevel 1 echo   codex was not found in PATH.
where claude
if errorlevel 1 echo   claude was not found in PATH.
echo.
echo To override commands before running:
echo   set CODEUI_CODEX_COMMAND=codex
echo   set CODEUI_CODEX_ARGS=exec --skip-git-repo-check --sandbox workspace-write
echo   set CODEUI_CLI_TIMEOUT_MS=600000
echo   set CODEUI_CLAUDE_COMMAND=claude
echo   set CODEUI_CLAUDE_ARGS=-p
echo.

node server.js
pause
