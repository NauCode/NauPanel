@echo off
setlocal

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1"
if errorlevel 1 (
  echo.
  echo Failed to start NauPanel.
  exit /b 1
)

echo.
 echo NauPanel is starting...
endlocal
