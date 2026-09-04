@echo off
cd /d "%~dp0"
echo ============================================================
echo   InboxHarbor - Installing Node.js Dependencies...
echo ============================================================
echo.
npm install
echo.
echo Dependencies installed successfully! You can run start.bat now.
echo.
pause
