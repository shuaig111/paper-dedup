# 论文降重助手 一键启动（PowerShell 版本）
# 优先 Node，其次 Python；都没有则直接打开 index.html
$ErrorActionPreference = 'SilentlyContinue'
Set-Location $PSScriptRoot

if (Get-Command node -ErrorAction SilentlyContinue) {
    Write-Host "[启动] 使用 Node.js 启动本地服务..."
    Start-Process "http://127.0.0.1:8642"
    node server.js
    exit
}

if (Get-Command python -ErrorAction SilentlyContinue) {
    Write-Host "[启动] 使用 Python 启动本地服务..."
    Start-Process python -ArgumentList "server.py"
    exit
}

Write-Host "[提示] 未检测到 Node.js 或 Python，直接打开页面（AI 改写不可用，其余功能正常）。"
Start-Process "index.html"
