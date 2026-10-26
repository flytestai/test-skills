@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 18 or newer and try again.
  pause
  exit /b 1
)

if not defined QDESK_PORT set QDESK_PORT=4173

echo Starting QDesk local service at http://127.0.0.1:%QDESK_PORT% ...
echo ZenTao CLI credentials are reused from the existing local CLI profile.
echo Press Ctrl+C to stop the service.
start "" /b cmd /c "timeout /t 2 >nul & start http://127.0.0.1:%QDESK_PORT%"
node server.js
