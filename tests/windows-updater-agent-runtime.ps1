param(
    [Parameter(Mandatory = $true)][string]$ModulePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$normalizedModulePath = [System.IO.Path]::GetFullPath($ModulePath)
Import-Module $normalizedModulePath -Force
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) "MCC Windows Agent Tests $([Guid]::NewGuid().ToString('N'))"
$originalPath = $env:PATH
$originalGitPrompt = $env:GIT_TERMINAL_PROMPT
$unrelatedProcess = $null
$timedProcessIds = @()

function Assert-MccTest {
    param(
        [Parameter(Mandatory = $true)][bool]$Condition,
        [Parameter(Mandatory = $true)][string]$Message
    )
    if (-not $Condition) { throw $Message }
}

function Get-MccComparableDirectory {
    param([Parameter(Mandatory = $true)][string]$LiteralPath)
    return [System.IO.Path]::GetFullPath($LiteralPath.Trim().Trim('"')).TrimEnd('\', '/')
}

function Get-MccDirectoryCountInPath {
    param([Parameter(Mandatory = $true)][string]$LiteralPath)
    $expected = Get-MccComparableDirectory -LiteralPath $LiteralPath
    return @(([string]$env:PATH).Split([System.IO.Path]::PathSeparator) | Where-Object {
        if ([string]::IsNullOrWhiteSpace($_)) { return $false }
        try {
            return (Get-MccComparableDirectory -LiteralPath $_).Equals($expected, [StringComparison]::OrdinalIgnoreCase)
        } catch {
            return $false
        }
    }).Count
}

function ConvertTo-MccEncodedCommand {
    param([Parameter(Mandatory = $true)][string]$Command)
    return [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($Command))
}

try {
    [System.IO.Directory]::CreateDirectory($testRoot) | Out-Null
    $gitDirectory = Join-Path $testRoot 'Git Bin'
    $nodeDirectory = Join-Path $testRoot 'Node Bin'
    [System.IO.Directory]::CreateDirectory($gitDirectory) | Out-Null
    [System.IO.Directory]::CreateDirectory($nodeDirectory) | Out-Null
    $gitPath = Join-Path $gitDirectory 'git.exe'
    $nodePath = Join-Path $nodeDirectory 'node.exe'
    [System.IO.File]::WriteAllText($gitPath, 'test executable placeholder')
    [System.IO.File]::WriteAllText($nodePath, 'test executable placeholder')

    $unrelatedPathSegment = Join-Path $testRoot 'Unrelated Tools'
    [System.IO.Directory]::CreateDirectory($unrelatedPathSegment) | Out-Null
    $env:PATH = "$unrelatedPathSegment;;$($gitDirectory.ToUpperInvariant());$nodeDirectory;$gitDirectory;"
    Set-MccExecutablePathBootstrap -GitPath $gitPath -NodePath $nodePath
    $stablePath = $env:PATH
    $stableLength = $env:PATH.Length
    for ($iteration = 0; $iteration -lt 1000; $iteration++) {
        [void](New-MccWindowsAgentHealth `
            -HeartbeatCompleted $true `
            -ExecutableBootstrapSucceeded $true `
            -ConfigurationValid $true `
            -DeploymentMode 'WindowsTest' `
            -ApplicationPathMatches $true `
            -RepositoryValid $true `
            -BranchValid $true `
            -RequestDirectoryAccessible $true `
            -StatusDirectoryAccessible $true `
            -MccTaskInstalled $true `
            -MccTaskRunning $true `
            -UpdaterTaskInstalled $true)
    }
    Assert-MccTest -Condition ($env:PATH -ceq $stablePath) -Message 'PATH contents changed during 1,000 heartbeat state iterations.'
    Assert-MccTest -Condition ($env:PATH.Length -eq $stableLength) -Message 'PATH length changed during 1,000 heartbeat state iterations.'
    Write-Output 'PASS 1,000 heartbeat state iterations leave PATH length and contents unchanged'

    for ($iteration = 0; $iteration -lt 1000; $iteration++) {
        Set-MccExecutablePathBootstrap -GitPath $gitPath -NodePath $nodePath
    }
    Assert-MccTest -Condition ($env:PATH -ceq $stablePath) -Message 'PATH contents changed during 1,000 repeated idempotence checks.'
    Assert-MccTest -Condition ($env:PATH.Length -eq $stableLength) -Message 'PATH length changed during 1,000 repeated idempotence checks.'
    Assert-MccTest -Condition ((Get-MccDirectoryCountInPath -LiteralPath $gitDirectory) -eq 1) -Message 'The Git directory did not appear exactly once in PATH.'
    Assert-MccTest -Condition ((Get-MccDirectoryCountInPath -LiteralPath $nodeDirectory) -eq 1) -Message 'The Node.js directory did not appear exactly once in PATH.'
    Assert-MccTest -Condition ($env:PATH.Contains($unrelatedPathSegment)) -Message 'An unrelated PATH segment was not preserved.'
    Assert-MccTest -Condition ($env:GIT_TERMINAL_PROMPT -ceq '0') -Message 'Noninteractive Git was not enabled.'
    Write-Output 'PASS idempotent PATH bootstrap keeps exactly one Git and Node directory'

    $env:PATH = "$env:SystemRoot\System32;;;"
    Set-MccExecutablePathBootstrap -GitPath $gitPath -NodePath $nodePath
    Assert-MccTest -Condition ($env:PATH -match [regex]::Escape("$env:SystemRoot\System32")) -Message 'The restricted SYSTEM-like PATH segment was not preserved.'
    Assert-MccTest -Condition ((Get-MccDirectoryCountInPath -LiteralPath $gitDirectory) -eq 1) -Message 'Restricted PATH bootstrap did not add Git exactly once.'
    Assert-MccTest -Condition ((Get-MccDirectoryCountInPath -LiteralPath $nodeDirectory) -eq 1) -Message 'Restricted PATH bootstrap did not add Node.js exactly once.'
    Write-Output 'PASS restricted SYSTEM-like PATH bootstrap'

    $pathBeforeInvalidBootstrap = $env:PATH
    foreach ($invalidPair in @(
        @((Join-Path $testRoot 'missing-git.exe'), $nodePath),
        @($gitPath, (Join-Path $testRoot 'missing-node.exe')),
        @('relative-git.exe', $nodePath)
    )) {
        $failedSafely = $false
        try {
            Set-MccExecutablePathBootstrap -GitPath $invalidPair[0] -NodePath $invalidPair[1]
        } catch {
            $failedSafely = $true
        }
        Assert-MccTest -Condition $failedSafely -Message 'A missing or invalid executable path was accepted.'
        Assert-MccTest -Condition ($env:PATH -ceq $pathBeforeInvalidBootstrap) -Message 'A failed executable bootstrap mutated PATH.'
    }
    Write-Output 'PASS missing and invalid executable bootstrap fails without PATH mutation'

    $failedBootstrapHealth = New-MccWindowsAgentHealth `
        -HeartbeatCompleted $true `
        -ExecutableBootstrapSucceeded $false `
        -ConfigurationValid $true `
        -DeploymentMode 'WindowsTest' `
        -ApplicationPathMatches $false `
        -RepositoryValid $false `
        -BranchValid $false `
        -RequestDirectoryAccessible $true `
        -StatusDirectoryAccessible $true `
        -MccTaskInstalled $true `
        -MccTaskRunning $true `
        -UpdaterTaskInstalled $true
    Assert-MccTest -Condition ($failedBootstrapHealth.agentHealthy -eq $false) -Message 'Bootstrap failure incorrectly published agentHealthy true.'
    Assert-MccTest -Condition ($failedBootstrapHealth.configurationValid -eq $true) -Message 'Successful protected configuration validation was not retained.'
    Assert-MccTest -Condition ($failedBootstrapHealth.deploymentMode -ceq 'WindowsTest') -Message 'Deployment mode was not retained after bootstrap failure.'
    Assert-MccTest -Condition (-not $failedBootstrapHealth.Contains('exception')) -Message 'The browser health payload exposed an exception field.'

    $failedHeartbeatHealth = New-MccWindowsAgentHealth `
        -HeartbeatCompleted $false `
        -ExecutableBootstrapSucceeded $true `
        -ConfigurationValid $true `
        -DeploymentMode 'WindowsProduction' `
        -ApplicationPathMatches $true `
        -RepositoryValid $true `
        -BranchValid $true `
        -RequestDirectoryAccessible $true `
        -StatusDirectoryAccessible $true `
        -MccTaskInstalled $true `
        -MccTaskRunning $true `
        -UpdaterTaskInstalled $true
    Assert-MccTest -Condition ($failedHeartbeatHealth.agentHealthy -eq $false) -Message 'Top-level heartbeat failure incorrectly published agentHealthy true.'
    Assert-MccTest -Condition ($failedHeartbeatHealth.deploymentMode -ceq 'WindowsProduction') -Message 'Deployment mode was not retained after heartbeat failure.'
    Write-Output 'PASS truthful sanitized health after bootstrap and top-level heartbeat failures'

    $powerShellPath = Join-Path $PSHOME 'powershell.exe'
    $unrelatedCommand = ConvertTo-MccEncodedCommand -Command 'Start-Sleep -Seconds 60'
    $unrelatedProcess = Start-Process -FilePath $powerShellPath -ArgumentList @('-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', $unrelatedCommand) -WindowStyle Hidden -PassThru
    $pidPath = Join-Path $testRoot 'timed-process-ids.txt'
    $childCommand = ConvertTo-MccEncodedCommand -Command 'Start-Sleep -Seconds 60'
    $timedCommand = @"
`$child = Start-Process -FilePath '$($powerShellPath.Replace("'", "''"))' -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand','$childCommand') -WindowStyle Hidden -PassThru
[System.IO.File]::WriteAllLines('$($pidPath.Replace("'", "''"))', @([string]`$PID, [string]`$child.Id))
Start-Sleep -Seconds 60
"@
    $timedEncodedCommand = ConvertTo-MccEncodedCommand -Command $timedCommand
    $timeoutLog = Join-Path $testRoot 'timeout.log'
    $timedOut = $false
    try {
        Invoke-MccProcess `
            -FilePath $powerShellPath `
            -ArgumentList @('-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', $timedEncodedCommand) `
            -WorkingDirectory $testRoot `
            -TimeoutSeconds 2 `
            -DetailedLogPath $timeoutLog | Out-Null
    } catch {
        $timedOut = $_.Exception.Message -match 'controlled process timed out'
    }
    Assert-MccTest -Condition $timedOut -Message 'The controlled timeout scenario did not report a timeout.'
    Assert-MccTest -Condition (Test-Path -LiteralPath $pidPath -PathType Leaf) -Message 'The timed process did not publish its exact parent and child PIDs.'
    $timedProcessIds = @([System.IO.File]::ReadAllLines($pidPath) | ForEach-Object { [int]$_ })
    Assert-MccTest -Condition ($timedProcessIds.Count -eq 2) -Message 'The timeout scenario did not record both process-tree PIDs.'
    foreach ($timedProcessId in $timedProcessIds) {
        Assert-MccTest -Condition ($null -eq (Get-Process -Id $timedProcessId -ErrorAction SilentlyContinue)) -Message "Timed process-tree PID $timedProcessId was left running."
    }
    Assert-MccTest -Condition (-not $unrelatedProcess.HasExited) -Message 'Timeout cleanup terminated an unrelated process.'
    $timeoutLogText = Get-Content -LiteralPath $timeoutLog -Raw
    Assert-MccTest -Condition ($timeoutLogText -match 'powershell\.exe timed out during execution') -Message 'Timeout logging omitted the sanitized executable name and stage.'
    Assert-MccTest -Condition ($timeoutLogText -match 'exact_process_tree_terminated') -Message 'Timeout cleanup did not confirm exact process-tree termination.'
    Write-Output 'PASS exact timed-out process tree cleanup preserves unrelated processes'
} finally {
    if ($null -ne $unrelatedProcess -and -not $unrelatedProcess.HasExited) {
        Stop-Process -Id $unrelatedProcess.Id -Force -ErrorAction SilentlyContinue
    }
    foreach ($timedProcessId in $timedProcessIds) {
        Stop-Process -Id $timedProcessId -Force -ErrorAction SilentlyContinue
    }
    $env:PATH = $originalPath
    $env:GIT_TERMINAL_PROMPT = $originalGitPrompt
    if (Test-Path -LiteralPath $testRoot) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Output 'Windows updater agent runtime regression tests passed.'
