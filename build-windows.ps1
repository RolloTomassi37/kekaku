$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $projectRoot

Write-Host 'Building React frontend...' -ForegroundColor Cyan
npm run build

Write-Host 'Running Go tests...' -ForegroundColor Cyan
go -C backend test ./...

Write-Host 'Building Kekaku.exe...' -ForegroundColor Cyan
go -C backend build -trimpath -ldflags '-s -w' -o ..\Kekaku.exe ./cmd/desktop

Write-Host ''
Write-Host 'Build complete: ' -NoNewline
Write-Host (Join-Path $projectRoot 'Kekaku.exe') -ForegroundColor Green
Write-Host 'Double-click Kekaku.exe to start the app and open the browser.'
