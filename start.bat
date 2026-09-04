@echo off
cd /d "%~dp0"
echo ============================================================
echo   InboxHarbor - Starting Server on http://localhost:5555
echo ============================================================
echo.
node server.js
pause
