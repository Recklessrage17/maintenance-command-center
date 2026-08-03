[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ModulePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Resolve-Path -LiteralPath $ModulePath) -Force

function Assert-MccTest {
    param([Parameter(Mandatory = $true)][bool]$Condition, [Parameter(Mandatory = $true)][string]$Message)
    if (-not $Condition) { throw $Message }
}

function Assert-MccSucceeds {
    param([Parameter(Mandatory = $true)][scriptblock]$Action, [Parameter(Mandatory = $true)][string]$Message)
    try { & $Action } catch { throw "$Message $($_.Exception.Message)" }
}

function Assert-MccFails {
    param([Parameter(Mandatory = $true)][scriptblock]$Action, [Parameter(Mandatory = $true)][string]$Message)
    $failed = $false
    try { & $Action } catch { $failed = $true }
    if (-not $failed) { throw $Message }
}

function New-MccValidLegacyEvidence {
    param([ValidateSet('InstallerBootstrap', 'Rollback')][string]$Context = 'InstallerBootstrap')
    return [ordered]@{
        verificationContext = $Context
        readinessStatusCode = 404
        installedVersion = '1.3.0'
        restoredCommitMatchesBackup = $true
        configurationValid = $true
        applicationPathMatches = $true
        originMatches = $true
        branchMatches = $true
        packageVersionMatches = $true
        commitMatches = $true
        repositoryClean = $true
        mccTaskInstalled = $true
        mccTaskRunning = $true
        mccTaskIdentityMatches = $true
        updaterTaskInstalled = $true
        updaterTaskRunning = $true
        updaterTaskIdentityMatches = $true
        agentHealthy = $true
        agentConfigurationValid = $true
        agentRepositoryValid = $true
        agentBranchValid = $true
        agentApplicationPathMatches = $true
        requestDirectoryAccessible = $true
        statusDirectoryAccessible = $true
        processRecordExists = $true
        launchIdValid = $true
        launchIdDistinct = $true
        processApplicationMatchesConfiguration = $true
        processUpdateModeMatches = $true
        processNodeEnvironmentMatches = $true
        pidRunning = $true
        nodeExecutableMatches = $true
        backendCommandLineMatches = $true
        exclusivePortOwner = $true
        healthOk = $true
        healthApplicationMatches = $true
        healthPortMatches = $true
        updateStatusUnauthorized = $true
    }
}

$validInstallerEvidence = New-MccValidLegacyEvidence
Assert-MccSucceeds -Action {
    Assert-MccLegacyManagedRuntimeEvidence -Evidence $validInstallerEvidence
} -Message 'A fully verified simulated v1.3.0 installer bootstrap did not pass.'
Write-Output 'PASS installer bootstrap accepts exact legacy 404 with complete protected evidence'

foreach ($unsupportedVersion in @('1.4.4', '1.4.5', '2.0.0')) {
    $evidence = New-MccValidLegacyEvidence
    $evidence.installedVersion = $unsupportedVersion
    Assert-MccFails -Action { Assert-MccLegacyManagedRuntimeEvidence -Evidence $evidence } `
        -Message "Legacy compatibility accepted installed version $unsupportedVersion."
}
Write-Output 'PASS legacy 404 is rejected for v1.4.4 and newer'

$failureScenarios = [ordered]@{
    'wrong PID' = 'pidRunning'
    'wrong Node executable' = 'nodeExecutableMatches'
    'wrong backend command line' = 'backendCommandLineMatches'
    'unknown port owner' = 'exclusivePortOwner'
    'unhealthy agent' = 'agentHealthy'
    'wrong origin' = 'originMatches'
    'wrong branch' = 'branchMatches'
    'dirty repository' = 'repositoryClean'
    'update status other than 401' = 'updateStatusUnauthorized'
    'invalid protected configuration' = 'configurationValid'
    'stale launcher identity' = 'launchIdDistinct'
}
foreach ($scenario in $failureScenarios.GetEnumerator()) {
    $evidence = New-MccValidLegacyEvidence
    $evidence[$scenario.Value] = $false
    Assert-MccFails -Action { Assert-MccLegacyManagedRuntimeEvidence -Evidence $evidence } `
        -Message "Legacy compatibility accepted $($scenario.Key)."
    Write-Output "PASS legacy 404 rejects $($scenario.Key)"
}

$rollbackEvidence = New-MccValidLegacyEvidence -Context Rollback
Assert-MccSucceeds -Action {
    Assert-MccLegacyManagedRuntimeEvidence -Evidence $rollbackEvidence
} -Message 'Rollback to an exact legitimate older build did not pass.'
$rollbackEvidence.restoredCommitMatchesBackup = $false
Assert-MccFails -Action {
    Assert-MccLegacyManagedRuntimeEvidence -Evidence $rollbackEvidence
} -Message 'Rollback compatibility accepted a commit that did not match the recorded backup commit.'
Write-Output 'PASS rollback legacy verification requires the exact recorded backup commit'

$expectedCommit = '0123456789abcdef0123456789abcdef01234567'
$validReadiness = [pscustomobject]@{
    ok = $true
    port = 4273
    systemUpdate = [pscustomobject]@{
        configured = $true
        enabled = $true
        applicationMatchesConfiguration = $true
        repositoryApproved = $true
        mode = 'windows_test'
        environmentLabel = 'WINDOWS TEST MODE'
        branch = 'feature/windows-11-updater-agent'
        installedVersion = '1.4.5'
        installedCommit = $expectedCommit.Substring(0, 7)
    }
}
$strictArguments = @{
    ExpectedMode = 'windows_test'
    ExpectedEnvironmentLabel = 'WINDOWS TEST MODE'
    ExpectedBranch = 'feature/windows-11-updater-agent'
    ExpectedVersion = '1.4.5'
    ExpectedCommit = $expectedCommit
    ExpectedPort = 4273
}
Assert-MccSucceeds -Action {
    Assert-MccManagedReadinessPayload -Payload $validReadiness @strictArguments
} -Message 'A complete strict managed-readiness payload did not pass.'
Assert-MccFails -Action {
    Assert-MccManagedReadinessPayload -Payload ([pscustomobject]@{ ok = $true }) @strictArguments
} -Message 'A malformed strict managed-readiness payload passed.'
$validReadiness.systemUpdate.branch = 'main'
Assert-MccFails -Action {
    Assert-MccManagedReadinessPayload -Payload $validReadiness @strictArguments
} -Message 'A mismatched strict managed-readiness payload passed.'
Write-Output 'PASS strict HTTP 200 readiness requires the complete matching payload'

function New-MccHttpFailureInvoker {
    param([int]$StatusCode)
    return {
        param($Uri, $TimeoutSeconds)
        $exception = [Net.WebException]::new('Simulated protected HTTP failure.')
        $exception.Data['MccHttpStatusCode'] = $StatusCode
        throw $exception
    }.GetNewClosure()
}

$legacyProbe = Invoke-MccHttpJsonProbe -Uri 'http://127.0.0.1:4273/api/system/update/managed-readiness' `
    -AllowedFailureStatusCodes @(404) -RequireFailureJson `
    -RequestInvoker { param($Uri, $TimeoutSeconds) [pscustomobject]@{ StatusCode = 404; Content = '{"ok":false,"error":"API route not found."}' } }
Assert-MccTest -Condition ([int]$legacyProbe.statusCode -eq 404) -Message 'The exact simulated readiness 404 was not classified.'
foreach ($statusCode in @(401, 403, 409, 429, 500, 503)) {
    Assert-MccFails -Action {
        Invoke-MccHttpJsonProbe -Uri 'http://127.0.0.1:4273/api/system/update/managed-readiness' `
            -AllowedFailureStatusCodes @(404) -RequestInvoker (New-MccHttpFailureInvoker -StatusCode $statusCode) | Out-Null
    } -Message "HTTP $statusCode incorrectly entered legacy compatibility."
}
Assert-MccFails -Action {
    Invoke-MccHttpJsonProbe -Uri 'http://127.0.0.1:4273/api/system/update/managed-readiness' `
        -AllowedFailureStatusCodes @(404) -RequestInvoker { param($Uri, $TimeoutSeconds) throw [TimeoutException]::new('Simulated timeout.') } | Out-Null
} -Message 'A timeout incorrectly entered legacy compatibility.'
Assert-MccFails -Action {
    Invoke-MccHttpJsonProbe -Uri 'http://127.0.0.1:4273/api/system/update/managed-readiness' `
        -AllowedFailureStatusCodes @(404) -RequestInvoker { param($Uri, $TimeoutSeconds) [pscustomobject]@{ StatusCode = 200; Content = '{invalid' } } | Out-Null
} -Message 'Invalid JSON incorrectly entered legacy compatibility.'
Assert-MccFails -Action {
    Invoke-MccHttpJsonProbe -Uri 'http://127.0.0.1:4273/api/system/update/managed-readiness' `
        -AllowedFailureStatusCodes @(404) -RequireFailureJson `
        -RequestInvoker { param($Uri, $TimeoutSeconds) [pscustomobject]@{ StatusCode = 404; Content = 'not-json' } } | Out-Null
} -Message 'A legacy 404 with invalid JSON incorrectly entered compatibility.'
Write-Output 'PASS timeout, 401, 403, 409, 429, 500+, and invalid JSON never enter compatibility mode'

Write-Output 'Windows updater legacy managed-readiness regression tests passed.'
