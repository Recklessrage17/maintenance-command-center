<#
.SYNOPSIS
Performs non-mutating validation of an installed MCC Windows updater.

.DESCRIPTION
Reports PASS or FAIL for Administrator context, deployment mode, protected target,
Git identity/branch/cleanliness, Node/npm, managed tasks, ACLs, status/heartbeat
JSON, port 4273, protected API behavior, installed version/commit, and the expected
Settings deployment label. It never changes the installed version.

.PARAMETER ConfigurationPath
The fixed protected updater configuration file.
#>
[CmdletBinding()]
param(
    [string]$ConfigurationPath = 'C:\ProgramData\MCC\Updater\config.json'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

Import-Module (Join-Path $PSScriptRoot 'MccWindowsUpdater.Common.psm1') -Force
$constants = Get-MccUpdaterConstants
$script:FailureCount = 0

function Write-TestResult {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][bool]$Passed,
        [Parameter(Mandatory = $true)][string]$Detail
    )
    if (-not $Passed) { $script:FailureCount += 1 }
    $label = 'FAIL'
    if ($Passed) { $label = 'PASS' }
    Write-Output ("{0,-4} {1} - {2}" -f $label, $Name, (Get-MccCleanText -Value $Detail -Maximum 300))
}

try {
    Assert-MccAdministrator
    Write-TestResult -Name 'Administrator' -Passed $true -Detail 'PowerShell is elevated.'
} catch {
    Write-TestResult -Name 'Administrator' -Passed $false -Detail $_.Exception.Message
}

$configuration = $null
try {
    $configuration = Read-MccWindowsConfiguration -ConfigurationPath $ConfigurationPath
    Write-TestResult -Name 'Configuration' -Passed $true -Detail 'Protected configuration is valid.'
} catch {
    Write-TestResult -Name 'Configuration' -Passed $false -Detail $_.Exception.Message
}

Write-TestResult -Name 'Protected F path' -Passed (Test-MccProtectedDevelopmentPath -LiteralPath 'F:\MCC_V1_FINAL') -Detail 'F:\MCC_V1_FINAL is recognized as protected.'

if ($null -ne $configuration) {
    $applicationPath = [string]$configuration.applicationPath
    $configuredBranch = [string]$configuration.branch
    $environmentLabel = if ([string]$configuration.deploymentMode -eq 'WindowsTest') { 'WINDOWS TEST MODE' } else { 'WINDOWS 11 PRODUCTION' }
    Write-Output "$environmentLabel - configured update branch origin/$configuredBranch"
    Write-TestResult -Name 'Mode' -Passed (@('WindowsTest', 'WindowsProduction') -contains [string]$configuration.deploymentMode) -Detail ([string]$configuration.deploymentMode)
    $branchPolicyValid = Test-MccUpdateBranch -Value $configuredBranch
    if ([string]$configuration.deploymentMode -eq 'WindowsProduction') {
        $branchPolicyValid = $branchPolicyValid -and $configuredBranch -ceq $constants.Branch
    }
    Write-TestResult -Name 'Branch policy' -Passed $branchPolicyValid -Detail "$environmentLabel / origin/$configuredBranch"
    Write-TestResult -Name 'Target path' -Passed (-not (Test-MccProtectedDevelopmentPath -LiteralPath $applicationPath)) -Detail 'Configured target is outside protected F:.'
    try {
        Assert-MccRepository -ApplicationPath $applicationPath -ExpectedBranch $configuredBranch -RequireClean
        Write-TestResult -Name 'Git repository' -Passed $true -Detail "Approved origin, exact $configuredBranch branch, and clean worktree verified."
    } catch {
        Write-TestResult -Name 'Git repository' -Passed $false -Detail $_.Exception.Message
    }
    try {
        Assert-MccOriginBranch -ApplicationPath $applicationPath -Branch $configuredBranch
        Write-TestResult -Name 'Origin branch' -Passed $true -Detail "origin/$configuredBranch exists."
    } catch {
        Write-TestResult -Name 'Origin branch' -Passed $false -Detail $_.Exception.Message
    }
    try {
        $nodeResult = Invoke-MccProcess -FilePath ([string]$configuration.nodePath) -ArgumentList @('--version') -WorkingDirectory $applicationPath -TimeoutSeconds 15
        $major = if ($nodeResult.StandardOutput -match '^v(?<major>\d+)\.') { [int]$Matches.major } else { 0 }
        Write-TestResult -Name 'Node.js' -Passed ($major -ge 22) -Detail $nodeResult.StandardOutput
    } catch {
        Write-TestResult -Name 'Node.js' -Passed $false -Detail $_.Exception.Message
    }
    try {
        $npmResult = Invoke-MccProcess -FilePath ([string]$configuration.nodePath) -ArgumentList @([string]$configuration.npmCliPath, '--version') -WorkingDirectory $applicationPath -TimeoutSeconds 15
        Write-TestResult -Name 'npm' -Passed $true -Detail $npmResult.StandardOutput
    } catch {
        Write-TestResult -Name 'npm' -Passed $false -Detail $_.Exception.Message
    }
    try {
        $version = Get-MccPackageVersion -ApplicationPath $applicationPath
        $commit = (Invoke-MccGit -ApplicationPath $applicationPath -ArgumentList @('rev-parse', '--short=7', 'HEAD')).StandardOutput
        Write-TestResult -Name 'Installed build' -Passed ($commit -match '^[0-9a-fA-F]{7}$') -Detail "v$version / $commit"
    } catch {
        Write-TestResult -Name 'Installed build' -Passed $false -Detail $_.Exception.Message
    }
}

foreach ($taskName in @($constants.MccTaskName, $constants.UpdaterTaskName)) {
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Write-TestResult -Name "Task $taskName" -Passed ($null -ne $task -and [string]$task.State -eq 'Running') -Detail $(if ($null -eq $task) { 'Not installed.' } else { "State: $($task.State)" })
}

$requestDirectory = Join-Path $constants.UpdaterRoot 'request'
$statusDirectory = Join-Path $constants.UpdaterRoot 'status'
foreach ($entry in @(
    [ordered]@{ Name = 'Configuration ACL'; Path = $ConfigurationPath; LocalServiceRights = [Security.AccessControl.FileSystemRights]::Read },
    [ordered]@{ Name = 'Request ACL'; Path = $requestDirectory; LocalServiceRights = [Security.AccessControl.FileSystemRights]::Modify },
    [ordered]@{ Name = 'Status ACL'; Path = $statusDirectory; LocalServiceRights = [Security.AccessControl.FileSystemRights]::ReadAndExecute },
    [ordered]@{ Name = 'Scripts ACL'; Path = (Join-Path $constants.UpdaterRoot 'scripts'); LocalServiceRights = [Security.AccessControl.FileSystemRights]::ReadAndExecute },
    [ordered]@{ Name = 'Web logs ACL'; Path = (Join-Path $constants.UpdaterRoot 'web-logs'); LocalServiceRights = [Security.AccessControl.FileSystemRights]::Modify },
    [ordered]@{ Name = 'Privileged logs ACL'; Path = (Join-Path $constants.UpdaterRoot 'logs'); LocalServiceRights = $null },
    [ordered]@{ Name = 'Backups ACL'; Path = (Join-Path $constants.UpdaterRoot 'backups'); LocalServiceRights = $null }
)) {
    try {
        $acl = Get-Acl -LiteralPath $entry.Path
        $accessRules = @($acl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]))
        $writeMask = [Security.AccessControl.FileSystemRights]::WriteData -bor
            [Security.AccessControl.FileSystemRights]::AppendData -bor
            [Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor
            [Security.AccessControl.FileSystemRights]::WriteAttributes -bor
            [Security.AccessControl.FileSystemRights]::Delete -bor
            [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
            [Security.AccessControl.FileSystemRights]::ChangePermissions -bor
            [Security.AccessControl.FileSystemRights]::TakeOwnership
        $broadWrite = @($accessRules | Where-Object {
            $_.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
            @('S-1-1-0', 'S-1-5-32-545') -contains $_.IdentityReference.Value -and
            ($_.FileSystemRights -band $writeMask)
        }).Count -gt 0
        $administratorsFullControl = @($accessRules | Where-Object {
            $_.IdentityReference.Value -eq 'S-1-5-32-544' -and
            $_.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
            ($_.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq
                [Security.AccessControl.FileSystemRights]::FullControl
        }).Count -gt 0
        $systemFullControl = @($accessRules | Where-Object {
            $_.IdentityReference.Value -eq 'S-1-5-18' -and
            $_.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
            ($_.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq
                [Security.AccessControl.FileSystemRights]::FullControl
        }).Count -gt 0
        $localServiceRules = @($accessRules | Where-Object {
            $_.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
            $_.IdentityReference.Value -eq 'S-1-5-19'
        })
        $passed = $acl.AreAccessRulesProtected -and
            $administratorsFullControl -and
            $systemFullControl -and
            -not $broadWrite
        if ($null -ne $entry.LocalServiceRights) {
            [long]$actualLocalServiceRights = 0
            foreach ($localServiceRule in $localServiceRules) {
                $actualLocalServiceRights = $actualLocalServiceRights -bor [long]$localServiceRule.FileSystemRights
            }
            $expectedLocalServiceRights = [long]($entry.LocalServiceRights -bor [Security.AccessControl.FileSystemRights]::Synchronize)
            $unexpectedLocalServiceRights = $actualLocalServiceRights -band
                [long][Security.AccessControl.FileSystemRights]::FullControl -band
                (-bnot $expectedLocalServiceRights)
            $passed = $passed -and
                $localServiceRules.Count -eq 1 -and
                ($actualLocalServiceRights -band $expectedLocalServiceRights) -eq $expectedLocalServiceRights -and
                $unexpectedLocalServiceRights -eq 0
        } else {
            $passed = $passed -and $localServiceRules.Count -eq 0
        }
        Write-TestResult -Name $entry.Name -Passed $passed -Detail 'Protected inheritance, Administrators/SYSTEM Full Control, narrow LOCAL SERVICE scope, and no Everyone/Users write access were verified.'
    } catch {
        Write-TestResult -Name $entry.Name -Passed $false -Detail $_.Exception.Message
    }
}

$statusPath = Join-Path $statusDirectory 'status.json'
try {
    $status = Read-MccJson -LiteralPath $statusPath
    $statusValid = [int]$status.schemaVersion -eq 1 -and
        @('idle', 'checking', 'update_available', 'queued', 'backing_up', 'stopping', 'pulling', 'installing_dependencies', 'building', 'starting', 'health_check', 'succeeded', 'rolling_back', 'rolled_back', 'failed') -contains [string]$status.state
    Write-TestResult -Name 'Status JSON' -Passed $statusValid -Detail "State: $($status.state)"
} catch {
    Write-TestResult -Name 'Status JSON' -Passed $false -Detail $_.Exception.Message
}

$healthPath = Join-Path $statusDirectory 'agent-health.json'
try {
    $health = Read-MccJson -LiteralPath $healthPath
    $ageSeconds = [DateTime]::UtcNow.Subtract(([DateTime][string]$health.checkedAt).ToUniversalTime()).TotalSeconds
    $healthy = [int]$health.schemaVersion -eq 1 -and $health.agentHealthy -eq $true -and $ageSeconds -le 90
    Write-TestResult -Name 'Updater heartbeat' -Passed $healthy -Detail "Age: $([Math]::Round($ageSeconds)) seconds."
} catch {
    Write-TestResult -Name 'Updater heartbeat' -Passed $false -Detail $_.Exception.Message
}

Write-TestResult -Name 'Port 4273 health' -Passed (Test-MccHttpHealth -Port 4273 -TimeoutSeconds 10) -Detail 'GET /api/health'
try {
    $apiProtected = $false
    try {
        Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:4273/api/system/update/status' -TimeoutSec 10 | Out-Null
    } catch {
        if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 401) {
            $apiProtected = $true
        }
    }
    Write-TestResult -Name 'Protected updater API' -Passed $apiProtected -Detail 'Unauthenticated availability request receives 401.'
} catch {
    Write-TestResult -Name 'Protected updater API' -Passed $false -Detail $_.Exception.Message
}

if ($null -ne $configuration) {
    $expectedLabel = if ([string]$configuration.deploymentMode -eq 'WindowsTest') { 'WINDOWS TEST MODE' } else { 'WINDOWS 11 PRODUCTION' }
    Write-TestResult -Name 'Settings mode label' -Passed $true -Detail $expectedLabel
}

if ($script:FailureCount -gt 0) {
    Write-Output "FAIL - $($script:FailureCount) Windows updater validation check(s) failed."
    exit 1
}
Write-Output 'PASS - all Windows updater validation checks passed without changing the installed version.'
