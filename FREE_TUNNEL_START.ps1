$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

function Find-Node {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }

  $bundled = Get-ChildItem "$env:USERPROFILE\.cache\codex-runtimes\*\dependencies\node\bin\node.exe" -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName
  if ($bundled) { return $bundled }

  throw @"
Node.js was not found.
Install Node.js LTS from https://nodejs.org/ on the watch PC, then run this file again.
"@
}

function Wait-Health {
  param([int]$Seconds = 20)
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $status = (Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:4173/health' -TimeoutSec 2).StatusCode
      if ($status -eq 200) { return $true }
    } catch {}
    Start-Sleep -Milliseconds 700
  }
  return $false
}

$node = Find-Node

try {
  $serverReady = (Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:4173/health' -TimeoutSec 2).StatusCode -eq 200
} catch {
  $serverReady = $false
}

if (-not $serverReady) {
  Write-Host '[1/3] Starting high-price scanner server on http://127.0.0.1:4173 ...' -ForegroundColor Cyan
  Start-Process -FilePath $node -ArgumentList 'server.mjs' -WorkingDirectory $here -WindowStyle Hidden
  if (-not (Wait-Health -Seconds 25)) {
    throw 'The scanner server did not start. Check update.log or run: node server.mjs'
  }
} else {
  Write-Host '[1/3] Scanner server is already running.' -ForegroundColor Cyan
}

$tools = Join-Path $here '.tools'
$cloudflared = Join-Path $tools 'cloudflared.exe'
if (-not (Test-Path $cloudflared)) {
  Write-Host '[2/3] Downloading cloudflared for free Cloudflare Quick Tunnel ...' -ForegroundColor Cyan
  New-Item -ItemType Directory -Path $tools -Force | Out-Null
  Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile $cloudflared
} else {
  Write-Host '[2/3] cloudflared is ready.' -ForegroundColor Cyan
}

$log = Join-Path $here 'free-tunnel.log'
Write-Host ''
Write-Host '[3/3] Starting FREE public tunnel.' -ForegroundColor Green
Write-Host 'Copy the https://....trycloudflare.com address shown below and open it from any PC/phone.' -ForegroundColor Yellow
Write-Host 'Keep this PowerShell window open. If you close it or reboot the watch PC, the free address may change.' -ForegroundColor Yellow
Write-Host ''

& $cloudflared tunnel --url http://127.0.0.1:4173 --no-autoupdate 2>&1 | Tee-Object -FilePath $log -Append
