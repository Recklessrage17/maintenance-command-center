<#
.SYNOPSIS
Runs the dedicated Windows MCC updater agent.

.DESCRIPTION
Polls one fixed request location, writes a sanitized health heartbeat, and invokes
only the fixed protected update script with the fixed protected configuration.

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
$constants = Get-MccUpdaterConstants
$healthPath = 'C:\ProgramData\MCC\Updater\status\agent-health.json'
$requestPath = 'C:\ProgramData\MCC\Updater\request\request.json'
$updateScript = Join-Path $PSScriptRoot 'Update-MccWindows.ps1'
$agentLog = 'C:\ProgramData\MCC\Updater\logs\agent.log'

function Write-AgentLog {
    param([Parameter(Mandatory = $true)][string]$Message)
    $safeMessage = Get-MccCleanText -Value $Message -Maximum 500
    Add-Content -LiteralPath $agentLog -Value "[$([DateTime]::UtcNow.ToString('o'))] $safeMessage" -Encoding utf8
}

function Write-AgentHealth {
    $configurationValid = $false
    $applicationPathMatches = $false
    $repositoryValid = $false
    $branchValid = $false
    $requestAccessible = $false
    $statusAccessible = $false
    $deploymentMode = ''
    $mccTask = $null
    $updaterTask = $null
    try {
        $configuration = Read-MccWindowsConfiguration -ConfigurationPath $ConfigurationPath
        $configurationValid = $true
        $deploymentMode = [string]$configuration.deploymentMode
        $env:PATH = "$(Split-Path -Parent ([string]$configuration.gitPath));$(Split-Path -Parent ([string]$configuration.nodePath));$env:PATH"
        $applicationPathMatches = -not (Test-MccProtectedDevelopmentPath -LiteralPath ([string]$configuration.applicationPath))
        try {
            Assert-MccRepository -ApplicationPath ([string]$configuration.applicationPath) -ExpectedBranch ([string]$configuration.branch)
            $repositoryValid = $true
            $branchValid = $true
        } catch {
            $repositoryValid = $false
            $branchValid = $false
        }
        try {
            $probe = Join-Path (Split-Path -Parent $requestPath) ".agent-probe-$PID.tmp"
            [System.IO.File]::WriteAllText($probe, '')
            Remove-Item -LiteralPath $probe -Force
            $requestAccessible = $true
        } catch {}
        try {
            $null = Get-ChildItem -LiteralPath (Split-Path -Parent $healthPath) -Force -ErrorAction Stop
            $statusAccessible = $true
        } catch {}
        $mccTask = Get-ScheduledTask -TaskName $constants.MccTaskName -ErrorAction SilentlyContinue
        $updaterTask = Get-ScheduledTask -TaskName $constants.UpdaterTaskName -ErrorAction SilentlyContinue
    } catch {
        Write-AgentLog -Message $_.Exception.Message
    }
    Write-MccAtomicJson -LiteralPath $healthPath -Value ([ordered]@{
        schemaVersion = 1
        checkedAt = [DateTime]::UtcNow.ToString('o')
        agentHealthy = $true
        configurationValid = $configurationValid
        deploymentMode = $deploymentMode
        applicationPathMatches = $applicationPathMatches
        repositoryValid = $repositoryValid
        branchValid = $branchValid
        requestDirectoryAccessible = $requestAccessible
        statusDirectoryAccessible = $statusAccessible
        mccTaskInstalled = $null -ne $mccTask
        mccTaskRunning = $null -ne $mccTask -and [string]$mccTask.State -eq 'Running'
        updaterTaskInstalled = $null -ne $updaterTask
    })
}

if (-not (Test-Path -LiteralPath $updateScript -PathType Leaf)) {
    throw 'The fixed Windows MCC update script is missing.'
}

Write-AgentLog -Message 'MaintenanceCommandCenterUpdater started.'
try {
    $startupConfiguration = Read-MccWindowsConfiguration -ConfigurationPath $ConfigurationPath
    $startupLabel = if ([string]$startupConfiguration.deploymentMode -eq 'WindowsTest') { 'WINDOWS TEST MODE' } else { 'WINDOWS 11 PRODUCTION' }
    Write-AgentLog -Message "$startupLabel. Configured update branch: origin/$([string]$startupConfiguration.branch)."
} catch {
    Write-AgentLog -Message $_.Exception.Message
}
while ($true) {
    try {
        Write-AgentHealth
        if (Test-Path -LiteralPath $requestPath -PathType Leaf) {
            Write-AgentLog -Message 'A fixed MCC update request was detected.'
            & $updateScript -ConfigurationPath $ConfigurationPath -RequestPath $requestPath
        }
    } catch {
        Write-AgentLog -Message $_.Exception.Message
    }
    Start-Sleep -Seconds 10
}
