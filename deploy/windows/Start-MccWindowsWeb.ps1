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
$webLogDirectory = 'C:\ProgramData\MCC\Updater\web-logs'
$processStatePath = Join-Path $webLogDirectory 'mcc-process.json'

if (-not (Test-Path -LiteralPath $webLogDirectory -PathType Container)) {
    [System.IO.Directory]::CreateDirectory($webLogDirectory) | Out-Null
}

function Write-WebStartupLog {
    param([Parameter(Mandatory = $true)][string]$Message)
    $stamp = [DateTime]::UtcNow.ToString('yyyyMMdd')
    $logPath = Join-Path $webLogDirectory "mcc-launcher-$stamp.log"
    $safeMessage = Get-MccCleanText -Value $Message -Maximum 500
    Add-Content -LiteralPath $logPath -Value "[$([DateTime]::UtcNow.ToString('o'))] $safeMessage" -Encoding utf8
}

try {
    $configuration = Read-MccWindowsConfiguration -ConfigurationPath $ConfigurationPath
    $applicationPath = [string]$configuration.applicationPath
    $gitPath = [string]$configuration.gitPath
    $nodePath = [string]$configuration.nodePath
    $entryPoint = Join-Path $applicationPath 'backend\dist\server\index.js'
    if (-not (Test-Path -LiteralPath $gitPath -PathType Leaf)) {
        throw 'The configured Git executable is missing.'
    }
    if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) {
        throw 'The configured Node.js executable is missing.'
    }
    if (-not (Test-Path -LiteralPath $entryPoint -PathType Leaf)) {
        throw 'The built MCC backend entry point is missing.'
    }
    Set-MccExecutablePathBootstrap -GitPath $gitPath -NodePath $nodePath
    Set-MccGitRepositoryTrustBootstrap `
        -ApplicationPath $applicationPath `
        -ConfiguredApplicationPath ([string]$configuration.applicationPath)
    Assert-MccRepository -ApplicationPath $applicationPath -ExpectedBranch ([string]$configuration.branch)
    Write-WebStartupLog -Message 'Startup validation passed: protected configuration, exact Git and Node.js executables, executable PATH bootstrap, exact process-scoped repository trust, approved repository and branch, backend entry point, and noninteractive Git are ready.'
} catch {
    Write-WebStartupLog -Message "Startup validation failed: $(Get-MccCleanText -Value $_.Exception.Message -Maximum 240)"
    throw
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
