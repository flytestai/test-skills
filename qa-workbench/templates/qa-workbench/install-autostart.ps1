# Register QDesk to start silently after the current Windows user logs on.
$ErrorActionPreference = 'Stop'

$taskName = 'QDeskWorkbench'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$launcher = Join-Path $root 'start-hidden.vbs'

if (-not (Test-Path -LiteralPath $launcher)) {
  throw "Launcher not found: $launcher"
}

$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction `
  -Execute (Join-Path $env:SystemRoot 'System32\wscript.exe') `
  -Argument ('"' + $launcher + '"')
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Description 'QDesk test workbench local service. Starts after user logon.' `
  -Force | Out-Null

Write-Host "Registered auto-start task: $taskName"
Write-Host 'Trigger: current user logon'
Write-Host "Start now: Start-ScheduledTask -TaskName $taskName"
Write-Host "Remove: Unregister-ScheduledTask -TaskName $taskName -Confirm:`$false"
