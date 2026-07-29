<#
.SYNOPSIS
Runs Maintenance Command Center as the controlled Windows background task.

.DESCRIPTION
Reads only the Administrator-installed configuration, starts the fixed MCC backend
entry point, records the exact child PID, and restarts that child after unexpected
failure. This script never accepts a command, repository, branch, or target from a
browser request.

.PARAMETER ConfigurationPath
The fixed protected MCC updater configuration file.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ConfigurationPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

Import-Module (Join-Path $PSScriptRoot 'MccWindowsUpdater.Common.psm1') -Force
$configuration = Read-MccWindowsConfiguration -ConfigurationPath $ConfigurationPath
$applicationPath = [string]$configuration.applicationPath
$nodePath = [string]$configuration.nodePath
$entryPoint = Join-Path $applicationPath 'backend\dist\server\index.js'
$webLogDirectory = 'C:\ProgramData\MCC\Updater\web-logs'
$processStatePath = Join-Path $webLogDirectory 'mcc-process.json'

if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) {
    throw 'The configured Node.js executable is missing.'
}
if (-not (Test-Path -LiteralPath $entryPoint -PathType Leaf)) {
    throw 'The built MCC backend entry point is missing.'
}
if (-not (Test-Path -LiteralPath $webLogDirectory -PathType Container)) {
    [System.IO.Directory]::CreateDirectory($webLogDirectory) | Out-Null
}

$env:PORT = '4273'
$env:MCC_UPDATE_MODE = 'windows_agent'
$env:MCC_UPDATE_WINDOWS_CONFIG = $ConfigurationPath
$env:NODE_ENV = 'production'

while ($true) {
    $stamp = [DateTime]::UtcNow.ToString('yyyyMMdd')
    $stdoutPath = Join-Path $webLogDirectory "mcc-$stamp.log"
    $stderrPath = Join-Path $webLogDirectory "mcc-$stamp-error.log"
    $process = Start-Process -FilePath $nodePath `
        -ArgumentList @($entryPoint) `
        -WorkingDirectory $applicationPath `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath `
        -PassThru
    Write-MccAtomicJson -LiteralPath $processStatePath -Value ([ordered]@{
        schemaVersion = 1
        processId = $process.Id
        startedAt = [DateTime]::UtcNow.ToString('o')
        applicationMatchesConfiguration = $true
    })
    $process.WaitForExit()
    Write-MccAtomicJson -LiteralPath $processStatePath -Value ([ordered]@{
        schemaVersion = 1
        processId = $null
        startedAt = $null
        stoppedAt = [DateTime]::UtcNow.ToString('o')
        lastExitCode = $process.ExitCode
        applicationMatchesConfiguration = $true
    })
    Start-Sleep -Seconds 5
}
