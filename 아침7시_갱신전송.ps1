$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  $node = Get-ChildItem "$env:USERPROFILE\.cache\codex-runtimes\*\dependencies\node\bin\node.exe" -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName
}
if (-not $node) { throw 'Node.js를 찾을 수 없습니다.' }
Set-Location $here
& $node update-data.mjs
if ($LASTEXITCODE -ne 0) { throw '주식 데이터 갱신에 실패했습니다.' }
& $node send-telegram.mjs
if ($LASTEXITCODE -ne 0) { throw '텔레그램 전송에 실패했습니다.' }
