@echo off
cd /d "%~dp0"
echo ============================================================
echo Pushing InboxHarbor to GitHub...
echo ============================================================
echo.
git push -u origin main
echo.
pause
