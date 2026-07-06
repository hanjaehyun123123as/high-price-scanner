$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  $node = Get-ChildItem "$env:USERPROFILE\.cache\codex-runtimes\*\dependencies\node\bin\node.exe" -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName
}
if (-not $node) {
  Write-Host "Node.js를 찾을 수 없습니다. https://nodejs.org 에서 설치 후 다시 실행하세요." -ForegroundColor Red
  Read-Host "Enter를 누르면 닫힙니다"
  exit 1
}
$server = Start-Process -FilePath $node -ArgumentList "server.mjs" -WorkingDirectory $here -NoNewWindow -PassThru
Start-Sleep -Milliseconds 700
Start-Process "http://127.0.0.1:4173"
Write-Host "신고가 레이더가 실행 중입니다. 이 창을 닫으면 종료됩니다." -ForegroundColor Green
Wait-Process -Id $server.Id
