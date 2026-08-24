# 论文降重助手 · 局域网版一键启动（PowerShell）
# 同一 WiFi 内的设备可用 http://本机IP:8642 访问
$ErrorActionPreference = 'SilentlyContinue'
Set-Location $PSScriptRoot

if (Get-Command node -ErrorAction SilentlyContinue) {
    Write-Host "[启动] 局域网模式启动中...（防火墙弹窗请选“允许访问”）"
    node server.js --lan
    exit
}
if (Get-Command python -ErrorAction SilentlyContinue) {
    Write-Host "[启动] Python 局域网模式启动中...（防火墙弹窗请选“允许访问”）"
    python server.py --lan
    exit
}
Write-Host "[提示] 未检测到 Node.js 或 Python，直接打开页面（仅本机可用）。"
Start-Process "index.html"
