$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
try { if ((Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:4173/' -TimeoutSec 2).StatusCode -eq 200) { exit 0 } } catch {}
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  $node = Get-ChildItem "$env:USERPROFILE\.cache\codex-runtimes\*\dependencies\node\bin\node.exe" -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName
}
if (-not $node) { throw 'Node.js를 찾을 수 없습니다.' }
Set-Location $here
& $node server.mjs
