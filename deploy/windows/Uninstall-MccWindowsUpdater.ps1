<#
.SYNOPSIS
Removes the managed MCC Windows updater agent without deleting MCC data.

.DESCRIPTION
Always removes the fixed updater-agent task. The MCC web task is preserved unless
-RemoveMccTask is explicitly supplied. MCC source, database, uploads, documents,
files, environment files, and updater backups are preserved by default.

.PARAMETER RemoveMccTask
Stops and removes the controlled MaintenanceCommandCenter task. It does not delete
the MCC installation or runtime data.

.PARAMETER RemoveUpdaterData
Removes protected updater configuration, requests, status, scripts, and logs.
Backups remain unless -RemoveBackups is also supplied.

.PARAMETER RemoveBackups
Removes updater safety backups. Requires -RemoveUpdaterData.
#>
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [switch]$RemoveMccTask,
    [switch]$RemoveUpdaterData,
    [switch]$RemoveBackups
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

Import-Module (Join-Path $PSScriptRoot 'MccWindowsUpdater.Common.psm1') -Force
Assert-MccAdministrator
$constants = Get-MccUpdaterConstants
$updaterRoot = Get-MccNormalizedPath -LiteralPath $constants.UpdaterRoot
if (-not $updaterRoot.Equals('C:\ProgramData\MCC\Updater', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The uninstaller refused an unexpected updater root.'
}
if ($RemoveBackups -and -not $RemoveUpdaterData) {
    throw '-RemoveBackups requires the explicit -RemoveUpdaterData option.'
}
if ($RemoveUpdaterData -and -not $RemoveMccTask) {
    throw '-RemoveUpdaterData requires -RemoveMccTask because the managed MCC task depends on the protected configuration and launcher scripts.'
}

$configuration = $null
$configurationPath = Join-Path $updaterRoot 'config.json'
if (Test-Path -LiteralPath $configurationPath -PathType Leaf) {
    try { $configuration = Read-MccWindowsConfiguration -ConfigurationPath $configurationPath } catch { $configuration = $null }
}

if ($PSCmdlet.ShouldProcess($constants.UpdaterTaskName, 'Stop and unregister the MCC updater-agent task')) {
    Stop-ScheduledTask -TaskName $constants.UpdaterTaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $constants.UpdaterTaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Output "Removed updater task: $($constants.UpdaterTaskName)"
}

if ($RemoveMccTask -and $PSCmdlet.ShouldProcess($constants.MccTaskName, 'Stop and unregister the managed MCC web task')) {
    Stop-ScheduledTask -TaskName $constants.MccTaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $constants.MccTaskName -Confirm:$false -ErrorAction SilentlyContinue
    if ($null -ne $configuration -and (Test-Path -LiteralPath ([string]$configuration.applicationPath) -PathType Container)) {
        Invoke-MccProcess -FilePath 'icacls.exe' `
            -ArgumentList @([string]$configuration.applicationPath, '/remove:g', '*S-1-5-19', '/T', '/C') `
            -WorkingDirectory ([string]$configuration.applicationPath) `
            -TimeoutSeconds 600 | Out-Null
    }
    Write-Output "Removed MCC task: $($constants.MccTaskName)"
} else {
    Write-Output "Preserved MCC task: $($constants.MccTaskName)"
}

if ($RemoveUpdaterData -and $PSCmdlet.ShouldProcess($updaterRoot, 'Remove protected updater configuration, request, status, scripts, and logs')) {
    $targets = @(
        (Join-Path $updaterRoot 'config.json'),
        (Join-Path $updaterRoot 'request'),
        (Join-Path $updaterRoot 'status'),
        (Join-Path $updaterRoot 'scripts'),
        (Join-Path $updaterRoot 'logs'),
        (Join-Path $updaterRoot 'web-logs'),
        (Join-Path $updaterRoot 'updater.lock')
    )
    if ($RemoveBackups) {
        $targets += Join-Path $updaterRoot 'backups'
    }
    foreach ($target in $targets) {
        $resolvedTarget = Get-MccNormalizedPath -LiteralPath $target
        if (-not ($resolvedTarget + '\').StartsWith($updaterRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
            throw 'The uninstaller refused a path outside the protected updater root.'
        }
        if (Test-Path -LiteralPath $target) {
            Remove-Item -LiteralPath $target -Recurse -Force
        }
    }
    Write-Output 'Removed the explicitly selected updater configuration/status/log files.'
} else {
    Write-Output "Preserved updater configuration/status/log files: $updaterRoot"
}

if ($RemoveBackups) {
    Write-Output 'Removed updater safety backups by explicit request.'
} else {
    Write-Output "Preserved updater safety backups: $(Join-Path $updaterRoot 'backups')"
}
Write-Output 'Preserved the MCC installation, database, uploads, documents, files, and environment files.'
