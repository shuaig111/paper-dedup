@echo off
rem ============================================
rem 论文降重助手 · 局域网版一键启动
rem 启动后，同一 WiFi/局域网内的手机、平板、其他电脑
rem 可用 http://本机IP:8642 访问（本机 IP 会打印出来）
rem 注意：首次运行 Windows 防火墙会弹窗，请点“允许访问”
rem ============================================
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel%==0 (
    echo [启动] 局域网模式启动中...
    echo [提示] 首次运行如弹出 Windows 防火墙提示，请选择“允许访问”
    node server.js --lan
    exit /b
)

where python >nul 2>nul
if %errorlevel%==0 (
    echo [启动] Python 局域网模式启动中...
    echo [提示] 首次运行如弹出 Windows 防火墙提示，请选择“允许访问”
    python server.py --lan
    exit /b
)

echo [提示] 未检测到 Node.js 或 Python，将直接打开页面（仅本机可用）。
start "" index.html
