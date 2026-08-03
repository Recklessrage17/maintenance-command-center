param(
    [Parameter(Mandatory = $true)][string]$ModulePath,
    [string]$ManagedRepositoryPath = '',
    [string]$ExpectedManagedCommit = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$normalizedModulePath = [System.IO.Path]::GetFullPath($ModulePath)
Import-Module $normalizedModulePath -Force
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) "MCC Windows Agent Tests $([Guid]::NewGuid().ToString('N'))"
$originalPath = $env:PATH
$originalGitPrompt = $env:GIT_TERMINAL_PROMPT
$originalGitConfigurationEnvironment = @{}
foreach ($environmentItem in @(Get-ChildItem Env: | Where-Object {
    $_.Name -ieq 'GIT_CONFIG_PARAMETERS' -or
    $_.Name -ieq 'GIT_CONFIG_COUNT' -or
    $_.Name -match '^GIT_CONFIG_(?:KEY|VALUE)_\d+$'
})) {
    $originalGitConfigurationEnvironment[$environmentItem.Name] = $environmentItem.Value
}
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

function Get-MccGitConfigurationFileSnapshot {
    param([Parameter(Mandatory = $true)][string]$GitPath)
    $configurationPaths = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($scope in @('--system', '--global')) {
        foreach ($line in @(& $GitPath config $scope --show-origin --list 2>$null)) {
            if ([string]$line -match '^file:(?<path>[^\t]+)\t') {
                [void]$configurationPaths.Add([System.IO.Path]::GetFullPath($Matches.path))
            }
        }
    }
    $gitInstallationRoot = Split-Path -Parent (Split-Path -Parent $GitPath)
    foreach ($candidate in @(
        (Join-Path $gitInstallationRoot 'etc\gitconfig'),
        (Join-Path $env:USERPROFILE '.gitconfig'),
        (Join-Path $env:USERPROFILE '.config\git\config'),
        (Join-Path $env:ProgramData 'Git\config')
    )) {
        [void]$configurationPaths.Add([System.IO.Path]::GetFullPath($candidate))
    }
    $snapshot = [ordered]@{}
    foreach ($configurationPath in @($configurationPaths | Sort-Object)) {
        if (Test-Path -LiteralPath $configurationPath -PathType Leaf) {
            $item = Get-Item -LiteralPath $configurationPath -Force
            $snapshot[$configurationPath] = [ordered]@{
                exists = $true
                length = $item.Length
                lastWriteUtc = $item.LastWriteTimeUtc.ToString('o')
                sha256 = (Get-FileHash -LiteralPath $configurationPath -Algorithm SHA256).Hash
            }
        } else {
            $snapshot[$configurationPath] = [ordered]@{ exists = $false }
        }
    }
    return ($snapshot | ConvertTo-Json -Depth 5 -Compress)
}

function Get-MccGitTrustEnvironmentSnapshot {
    $snapshot = [ordered]@{}
    foreach ($environmentItem in @(Get-ChildItem Env: | Where-Object {
        $_.Name -ieq 'GIT_CONFIG_PARAMETERS' -or
        $_.Name -ieq 'GIT_CONFIG_COUNT' -or
        $_.Name -match '^GIT_CONFIG_(?:KEY|VALUE)_\d+$'
    } | Sort-Object Name)) {
        $snapshot[$environmentItem.Name.ToUpperInvariant()] = [string]$environmentItem.Value
    }
    return ($snapshot | ConvertTo-Json -Compress)
}

try {
    [System.IO.Directory]::CreateDirectory($testRoot) | Out-Null
    $actualGitPath = (Get-Command 'git.exe' -ErrorAction Stop).Source
    $actualNodePath = (Get-Command 'node.exe' -ErrorAction Stop).Source
    $usingFallbackRepository = [string]::IsNullOrWhiteSpace($ManagedRepositoryPath)
    if ([string]::IsNullOrWhiteSpace($ManagedRepositoryPath)) {
        $sourceRepositoryPath = [System.IO.Path]::GetFullPath((Join-Path (Split-Path -Parent $normalizedModulePath) '..\..'))
        $ManagedRepositoryPath = Join-Path $testRoot 'Managed Repository Clone'
        $clone = Invoke-MccProcess `
            -FilePath $actualGitPath `
            -ArgumentList @('clone', '--no-local', $sourceRepositoryPath, $ManagedRepositoryPath) `
            -WorkingDirectory $testRoot `
            -TimeoutSeconds 120
        Assert-MccTest -Condition ($clone.ExitCode -eq 0) -Message 'The fallback managed Git trust fixture could not be cloned.'
    }
    $ManagedRepositoryPath = [System.IO.Path]::GetFullPath($ManagedRepositoryPath)
    $gitConfigurationBefore = Get-MccGitConfigurationFileSnapshot -GitPath $actualGitPath

    foreach ($environmentName in @(Get-ChildItem Env: | Where-Object {
        $_.Name -ieq 'GIT_CONFIG_PARAMETERS' -or
        $_.Name -ieq 'GIT_CONFIG_COUNT' -or
        $_.Name -match '^GIT_CONFIG_(?:KEY|VALUE)_\d+$'
    } | ForEach-Object { $_.Name })) {
        [Environment]::SetEnvironmentVariable($environmentName, $null, [EnvironmentVariableTarget]::Process)
    }
    $directGitOutput = & $actualGitPath -C $ManagedRepositoryPath rev-parse --short=7 HEAD 2>&1
    $directGitExitCode = $LASTEXITCODE
    $currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    if ($currentIdentity.Equals('NT AUTHORITY\LOCAL SERVICE', [StringComparison]::OrdinalIgnoreCase)) {
        Assert-MccTest -Condition ($directGitExitCode -eq 128 -and ([string]$directGitOutput -match 'dubious ownership')) -Message 'LOCAL SERVICE direct Git did not reproduce the Administrators-owned dubious-ownership boundary.'
        Write-Output 'PASS LOCAL SERVICE direct Git fails with dubious ownership before process-scoped bootstrap'
    } else {
        Write-Output "INFO direct Git pre-bootstrap exit code $directGitExitCode under $currentIdentity; LOCAL SERVICE ownership boundary is verified by the live managed probe."
    }

    $env:GIT_CONFIG_PARAMETERS = 'inherited-command-scope-must-be-removed'
    $env:GIT_CONFIG_COUNT = '3'
    $env:GIT_CONFIG_KEY_0 = 'safe.directory'
    $env:GIT_CONFIG_VALUE_0 = '*'
    $env:GIT_CONFIG_KEY_1 = 'core.askPass'
    $env:GIT_CONFIG_VALUE_1 = 'unsafe-inherited-value'
    $env:GIT_CONFIG_KEY_27 = 'safe.directory'
    $env:GIT_CONFIG_VALUE_27 = '*'
    Set-MccExecutablePathBootstrap -GitPath $actualGitPath -NodePath $actualNodePath
    Set-MccGitRepositoryTrustBootstrap `
        -ApplicationPath $ManagedRepositoryPath `
        -ConfiguredApplicationPath $ManagedRepositoryPath
    $trustedPath = $ManagedRepositoryPath.Replace('\', '/')
    Assert-MccTest -Condition ($env:GIT_CONFIG_COUNT -ceq '1') -Message 'Process-scoped Git configuration count was not exactly one.'
    Assert-MccTest -Condition ($env:GIT_CONFIG_KEY_0 -ceq 'safe.directory') -Message 'The single process-scoped Git key was not safe.directory.'
    Assert-MccTest -Condition ($env:GIT_CONFIG_VALUE_0 -ceq $trustedPath) -Message 'The exact normalized managed repository was not trusted.'
    Assert-MccTest -Condition ($env:GIT_CONFIG_VALUE_0 -cne '*') -Message 'Wildcard Git trust was configured.'
    Assert-MccTest -Condition ($null -eq [Environment]::GetEnvironmentVariable('GIT_CONFIG_PARAMETERS', 'Process')) -Message 'Inherited GIT_CONFIG_PARAMETERS was not removed.'
    Assert-MccTest -Condition ($null -eq [Environment]::GetEnvironmentVariable('GIT_CONFIG_KEY_1', 'Process')) -Message 'An inherited numbered Git configuration key remained.'
    Assert-MccTest -Condition ($null -eq [Environment]::GetEnvironmentVariable('GIT_CONFIG_VALUE_27', 'Process')) -Message 'An inherited numbered Git configuration value remained.'

    $resolvedCommit = (& $actualGitPath -C $ManagedRepositoryPath rev-parse --short=7 HEAD).Trim()
    Assert-MccTest -Condition ($LASTEXITCODE -eq 0 -and $resolvedCommit -match '^[0-9a-f]{7}$') -Message 'Process-scoped trust did not allow rev-parse HEAD.'
    if ($ExpectedManagedCommit) {
        Assert-MccTest -Condition ($resolvedCommit -ceq $ExpectedManagedCommit) -Message "The installed build resolved $resolvedCommit instead of $ExpectedManagedCommit."
    }
    $origin = (& $actualGitPath -C $ManagedRepositoryPath remote get-url origin).Trim()
    $originMatchesFixture = if ($usingFallbackRepository) { -not [string]::IsNullOrWhiteSpace($origin) } else { $origin -match 'maintenance-command-center' }
    Assert-MccTest -Condition ($LASTEXITCODE -eq 0 -and $originMatchesFixture) -Message 'Process-scoped trust did not allow remote get-url origin.'
    $branch = (& $actualGitPath -C $ManagedRepositoryPath branch --show-current).Trim()
    Assert-MccTest -Condition ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($branch)) -Message 'Process-scoped trust did not allow branch --show-current.'
    $statusOutput = & $actualGitPath -C $ManagedRepositoryPath status --porcelain=v1
    Assert-MccTest -Condition ($LASTEXITCODE -eq 0) -Message 'Process-scoped trust did not allow status --porcelain=v1.'
    Write-Output "PASS trusted Git commands: commit=$resolvedCommit branch=$branch origin=approved statusExit=0"

    $nodeProbe = @'
const { spawnSync } = require('node:child_process');
const repository = process.argv[1];
const expectedCommit = process.argv[2];
const commands = [
  ['rev-parse', '--short=7', 'HEAD'],
  ['remote', 'get-url', 'origin'],
  ['branch', '--show-current'],
  ['status', '--porcelain=v1'],
];
const results = commands.map(args => {
  const result = spawnSync('git', ['-C', repository, ...args], { encoding: 'utf8', windowsHide: true });
  return { args: args.join(' '), status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
});
const passed = results.every(result => result.status === 0)
  && (!expectedCommit || results[0].stdout === expectedCommit);
process.stdout.write(JSON.stringify({ passed, commit: results[0].stdout, results }));
process.exit(passed ? 0 : 1);
'@
    $nodeProbeOutput = & $actualNodePath -e $nodeProbe $ManagedRepositoryPath $ExpectedManagedCommit
    Assert-MccTest -Condition ($LASTEXITCODE -eq 0) -Message "A spawned Node process did not inherit exact Git repository trust: $nodeProbeOutput"
    $nodeProbeResult = $nodeProbeOutput | ConvertFrom-Json
    Assert-MccTest -Condition ($nodeProbeResult.passed -eq $true) -Message 'The Node child Git result was not successful.'
    Write-Output "PASS Node spawnSync Git inheritance: commit=$($nodeProbeResult.commit) commands=4"

    $stableTrustEnvironment = Get-MccGitTrustEnvironmentSnapshot
    for ($iteration = 0; $iteration -lt 1000; $iteration++) {
        Set-MccGitRepositoryTrustBootstrap `
            -ApplicationPath $ManagedRepositoryPath `
            -ConfiguredApplicationPath $ManagedRepositoryPath
    }
    Assert-MccTest -Condition ((Get-MccGitTrustEnvironmentSnapshot) -ceq $stableTrustEnvironment) -Message 'Process-scoped Git repository trust changed across 1,000 repeated bootstraps.'
    Assert-MccTest -Condition (@(Get-ChildItem Env: | Where-Object { $_.Name -match '^GIT_CONFIG_KEY_\d+$' }).Count -eq 1) -Message 'The exact trusted repository did not appear exactly once.'
    Assert-MccTest -Condition (@(Get-ChildItem Env: | Where-Object { $_.Name -match '^GIT_CONFIG_VALUE_\d+$' -and $_.Value -ceq $trustedPath }).Count -eq 1) -Message 'The exact trusted repository value did not appear exactly once.'
    Write-Output 'PASS 1,000 process-scoped Git trust bootstraps are byte-for-byte idempotent with one exact trust entry'

    $mismatchPath = Join-Path $testRoot 'Mismatched Repository'
    [System.IO.Directory]::CreateDirectory((Join-Path $mismatchPath '.git')) | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $mismatchPath 'package.json'), '{"name":"not-mcc"}')
    foreach ($invalidTrust in @(
        [ordered]@{ ApplicationPath = 'relative\repository'; ConfiguredApplicationPath = $ManagedRepositoryPath },
        [ordered]@{ ApplicationPath = ([System.IO.Path]::GetPathRoot($ManagedRepositoryPath)); ConfiguredApplicationPath = ([System.IO.Path]::GetPathRoot($ManagedRepositoryPath)) },
        [ordered]@{ ApplicationPath = $mismatchPath; ConfiguredApplicationPath = $ManagedRepositoryPath },
        [ordered]@{ ApplicationPath = 'F:\MCC_V1_FINAL'; ConfiguredApplicationPath = 'F:\MCC_V1_FINAL' },
        [ordered]@{ ApplicationPath = "$ManagedRepositoryPath\*"; ConfiguredApplicationPath = $ManagedRepositoryPath }
    )) {
        $trustBeforeFailure = Get-MccGitTrustEnvironmentSnapshot
        $failedSafely = $false
        try {
            Set-MccGitRepositoryTrustBootstrap @invalidTrust
        } catch {
            $failedSafely = $true
        }
        Assert-MccTest -Condition $failedSafely -Message 'An invalid, relative, drive-root, mismatched, protected F:, or wildcard trust path was accepted.'
        Assert-MccTest -Condition ((Get-MccGitTrustEnvironmentSnapshot) -ceq $trustBeforeFailure) -Message 'A rejected Git trust bootstrap changed the process environment.'
    }
    Write-Output 'PASS invalid, relative, drive-root, mismatched, protected F:, and wildcard trust paths fail safely'

    $gitConfigurationAfter = Get-MccGitConfigurationFileSnapshot -GitPath $actualGitPath
    Assert-MccTest -Condition ($gitConfigurationAfter -ceq $gitConfigurationBefore) -Message 'A global or system Git configuration file changed during process-scoped trust bootstrap.'
    Write-Output 'PASS global and system Git configuration file hashes, lengths, timestamps, and existence are unchanged'

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
            -UpdaterTaskInstalled $true `
            -UpdaterTaskRunning $true)
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
        -UpdaterTaskInstalled $true `
        -UpdaterTaskRunning $true
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
        -UpdaterTaskInstalled $true `
        -UpdaterTaskRunning $true
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
    foreach ($environmentName in @(Get-ChildItem Env: | Where-Object {
        $_.Name -ieq 'GIT_CONFIG_PARAMETERS' -or
        $_.Name -ieq 'GIT_CONFIG_COUNT' -or
        $_.Name -match '^GIT_CONFIG_(?:KEY|VALUE)_\d+$'
    } | ForEach-Object { $_.Name })) {
        [Environment]::SetEnvironmentVariable($environmentName, $null, [EnvironmentVariableTarget]::Process)
    }
    foreach ($environmentName in $originalGitConfigurationEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable(
            [string]$environmentName,
            [string]$originalGitConfigurationEnvironment[$environmentName],
            [EnvironmentVariableTarget]::Process
        )
    }
    if (Test-Path -LiteralPath $testRoot) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Output 'Windows updater agent runtime regression tests passed.'
