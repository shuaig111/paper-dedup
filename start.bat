@echo off
rem ============================================
rem 论文降重助手 一键启动
rem 优先使用 Node，其次 Python；都没有则直接打开 index.html（离线功能可用）
rem ============================================
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel%==0 (
    echo [启动] 使用 Node.js 启动本地服务...
    start "" http://127.0.0.1:8642
    node server.js
    exit /b
)

where python >nul 2>nul
if %errorlevel%==0 (
    echo [启动] 使用 Python 启动本地服务...
    start python server.py
    exit /b
)

echo [提示] 未检测到 Node.js 或 Python，将直接打开页面（AI 改写功能不可用，其余功能正常）。
start "" index.html
