$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$daily = Join-Path $here '아침7시_갱신전송.ps1'
$server = Join-Path $here '서버자동실행.ps1'

$dailyAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$daily`""
$dailyTrigger = New-ScheduledTaskTrigger -Daily -At '07:00'
$dailySettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName '신고가레이더_오전7시전송' -Action $dailyAction -Trigger $dailyTrigger -Settings $dailySettings -Description '매일 오전 7시 전 종목 갱신 후 텔레그램 발송' -Force | Out-Null

$serverAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$server`""
$serverTrigger = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName '신고가레이더_서버' -Action $serverAction -Trigger $serverTrigger -Description '로그온 시 신고가 대시보드 실행' -Force | Out-Null

Write-Host '감시 PC 작업 등록 완료: 매일 07:00 전송 / 로그온 시 서버 실행' -ForegroundColor Green
