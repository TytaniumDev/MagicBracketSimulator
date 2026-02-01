@echo off
cd /d "%~dp0"

echo Starting Magic Bracket Simulator...
echo Analysis Service: http://localhost:8000
echo Orchestrator API: http://localhost:3000
echo Frontend (UI):   http://localhost:5173
echo.
echo Browser will open to the frontend UI in a few seconds.
echo Press Ctrl+C to stop all services.
echo.

start /B powershell -WindowStyle Hidden -Command "Start-Sleep -Seconds 10; Start-Process 'http://localhost:5173'"

npm run dev

pause
