$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  $node = Get-ChildItem "$env:USERPROFILE\.cache\codex-runtimes\*\dependencies\node\bin\node.exe" -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName
}
if (-not $node) { throw 'Node.js를 찾을 수 없습니다.' }
Set-Location $here

try { $serverReady = (Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:4173/health' -TimeoutSec 2).StatusCode -eq 200 } catch { $serverReady = $false }
if (-not $serverReady) {
  Start-Process -FilePath $node -ArgumentList 'server.mjs' -WorkingDirectory $here -WindowStyle Hidden
  Start-Sleep -Seconds 2
}

$tools = Join-Path $here '.tools'
$cloudflared = Join-Path $tools 'cloudflared.exe'
if (-not (Test-Path $cloudflared)) {
  New-Item -ItemType Directory -Path $tools -Force | Out-Null
  Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile $cloudflared
}

$running = Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*127.0.0.1:4173*' }
if (-not $running) {
  $log = Join-Path $here '외부링크.log'
  Start-Process -FilePath $cloudflared -ArgumentList @('tunnel','--url','http://127.0.0.1:4173','--no-autoupdate','--logfile',$log) -WorkingDirectory $here -WindowStyle Hidden
}
