@echo off
setlocal
cd /d "%~dp0"
set PORT=4273
start "Maintenance Command Center" cmd /k "npm start --prefix backend"
timeout /t 2 /nobreak >nul
start "" "http://localhost:4273"
endlocal
