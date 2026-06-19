@echo off
setlocal
set MCC_PORT=4273
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R /C:":%MCC_PORT% .*LISTENING"') do (
  echo Stopping process %%a using port %MCC_PORT%...
  taskkill /PID %%a /F
)
echo Maintenance Command Center stop command completed for port %MCC_PORT% only.
endlocal
