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

function New-RandomBytes {
  param([int]$Length)
  $bytes = New-Object byte[] $Length
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }
  return $bytes
}

$node = Find-Node
$localPasswordFile = Join-Path $here 'local-password.txt'

if (Test-Path $localPasswordFile) {
  $localPassword = (Get-Content -Raw -LiteralPath $localPasswordFile).Trim()
  if ($localPassword) {
    $env:APP_PASSWORD = $localPassword
  }
}

if (-not $env:APP_PASSWORD) {
  $bytes = New-RandomBytes -Length 9
  $env:APP_PASSWORD = 'scanner-' + [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', 'A').Replace('/', 'B')
}
if (-not $env:SESSION_SECRET) {
  $bytes = New-RandomBytes -Length 32
  $env:SESSION_SECRET = [Convert]::ToBase64String($bytes)
}

try {
  $serverReady = (Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:4173/health' -TimeoutSec 2).StatusCode -eq 200
} catch {
  $serverReady = $false
}

$scannerProcesses = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object {
    $_.CommandLine -and
    $_.CommandLine -match 'server\.mjs' -and
    $_.CommandLine -match [regex]::Escape($here)
  }

$portProcesses = @()
try {
  $portProcesses = Get-NetTCPConnection -LocalPort 4173 -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object {
      try { Get-Process -Id $_.OwningProcess -ErrorAction Stop } catch { $null }
    } |
    Where-Object { $_ -and $_.ProcessName -match 'node' }
} catch {}

$serverProcessesToRestart = @($scannerProcesses)
foreach ($process in $portProcesses) {
  if ($serverProcessesToRestart.ProcessId -notcontains $process.Id) {
    $serverProcessesToRestart += [pscustomobject]@{ ProcessId = $process.Id }
  }
}

if ($serverReady -and $serverProcessesToRestart) {
  Write-Host '[1/3] Restarting scanner server with the login password shown below ...' -ForegroundColor Cyan
  foreach ($process in $serverProcessesToRestart) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Seconds 1
  $serverReady = $false
}

if ($serverReady) {
  Write-Host '[1/3] A scanner server is already running on port 4173.' -ForegroundColor Yellow
  Write-Host '      If the password is still rejected, close old node.exe server processes or reboot the watch PC, then run this again.' -ForegroundColor Yellow
} else {
  Write-Host '[1/3] Starting high-price scanner server on http://127.0.0.1:4173 ...' -ForegroundColor Cyan
  Start-Process -FilePath $node -ArgumentList (Join-Path $here 'server.mjs') -WorkingDirectory $here -WindowStyle Hidden
  if (-not (Wait-Health -Seconds 25)) {
    throw 'The scanner server did not start. Check update.log or run: node server.mjs'
  }
}

Write-Host "LOGIN PASSWORD: $env:APP_PASSWORD" -ForegroundColor Green

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

$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
  & $cloudflared tunnel --url http://127.0.0.1:4173 --no-autoupdate 2>&1 |
    ForEach-Object {
      $line = $_.ToString()
      Add-Content -LiteralPath $log -Value $line
      if ($line -match 'https://[a-zA-Z0-9-]+\.trycloudflare\.com') {
        Write-Host ''
        Write-Host "FREE TUNNEL ADDRESS: $($Matches[0])" -ForegroundColor Green
        Write-Host ''
      }
      Write-Host $line
    }
} finally {
  $ErrorActionPreference = $previousErrorActionPreference
}
