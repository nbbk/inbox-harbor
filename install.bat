@echo off
title MailPulse - 依赖安装程序
cls
echo ============================================================
echo           MailPulse - 现代化多邮局极速管理控制台
echo               正在检查并安装 Node.js 运行依赖...
echo ============================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Node.js 环境，请先前往 https://nodejs.org 下载并安装 Node.js！
    pause
    exit /b 1
)

echo [提示] 正在执行 npm install 安装依赖...
call npm install
echo.
echo ============================================================
echo  [成功] 依赖安装完成！现在可以双击运行 start.bat 启动面板！
echo ============================================================
echo.
pause
