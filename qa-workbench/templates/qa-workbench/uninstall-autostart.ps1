# Remove the QDesk logon auto-start task. The running service is not stopped.
$ErrorActionPreference = 'Stop'

$taskName = 'QDeskWorkbench'
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if (-not $task) {
  Write-Host "Auto-start task not found: $taskName"
  exit 0
}

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
Write-Host "Removed auto-start task: $taskName"
Write-Host 'The currently running service is not stopped.'
