@echo off
title MailPulse - 控制台服务
cls
echo ============================================================
echo           MailPulse - 现代化多邮局极速管理控制台
echo ============================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Node.js 环境，请先安装 Node.js！
    pause
    exit /b 1
)

if not exist node_modules (
    echo [提示] 检测到首次运行，正在自动安装依赖...
    call npm install
)

echo [启动] 正在启动 MailPulse 服务...
echo [地址] 请在浏览器中访问: http://localhost:5555
echo.
node server.js
pause
