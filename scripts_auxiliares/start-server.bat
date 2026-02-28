@echo off
cd /d "%~dp0"
call powershell -Command "Stop-Process -Name node -Force -ErrorAction SilentlyContinue"
timeout /t 2 >nul
node server.js
pause
