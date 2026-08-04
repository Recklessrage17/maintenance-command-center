[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ConfigurationPath,
    [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest

$ApprovedApplicationPath = 'Z:\MCC_V1_FINAL'
$ApprovedRepository = 'https://github.com/Recklessrage17/maintenance-command-center.git'
$ApprovedRemote = 'origin'
$ApprovedBranch = 'main'
$ApprovedPort = 4273
$TerminalStates = @('succeeded', 'rolled_back', 'failed')
$UpdateStates = @(
    'idle', 'checking', 'update_available', 'queued', 'backing_up', 'stopping', 'pulling',
    'installing_dependencies', 'building', 'starting', 'health_check', 'succeeded',
    'rolling_back', 'rolled_back', 'failed'
)

function Get-NormalizedPath([string]$Value) {
    return [System.IO.Path]::GetFullPath($Value).TrimEnd('\')
}

function Assert-ZDrivePath([string]$Value, [string]$Label) {
    $normalized = Get-NormalizedPath $Value
    if (-not $normalized.StartsWith('Z:\', [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "$Label must remain on the isolated Z: test drive."
    }
    return $normalized
}

function Get-CleanText([object]$Value, [int]$Maximum = 240) {
    $text = ([string]$Value -replace '[\x00-\x1f\x7f]+', ' ' -replace '\s+', ' ').Trim()
    return $text.Substring(0, [Math]::Min($text.Length, $Maximum))
}

function Test-Semver([string]$Value) {
    return $Value -match '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$'
}

function Test-Commit([string]$Value) {
    return $Value -match '^[0-9a-f]{40}$'
}

if (-not (Test-Path -LiteralPath $ConfigurationPath -PathType Leaf)) {
    throw 'The Windows MCC test configuration file is missing.'
}
$Configuration = Get-Content -LiteralPath $ConfigurationPath -Raw | ConvertFrom-Json
$ApplicationPath = Assert-ZDrivePath ([string]$Configuration.applicationPath) 'applicationPath'
$StateDirectory = Assert-ZDrivePath ([string]$Configuration.stateDirectory) 'stateDirectory'
$BackupDirectory = Assert-ZDrivePath ([string]$Configuration.backupDirectory) 'backupDirectory'
if (-not $ApplicationPath.Equals((Get-NormalizedPath $ApprovedApplicationPath), [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Windows test updates are restricted to Z:\MCC_V1_FINAL. F: is never allowed.'
}
if ([string]$Configuration.repository -ne $ApprovedRepository -or
    [string]$Configuration.remote -ne $ApprovedRemote -or
    [string]$Configuration.branch -ne $ApprovedBranch -or
    [int]$Configuration.port -ne $ApprovedPort) {
    throw 'The Windows test update source must be the approved origin/main repository on port 4273.'
}
if ((Get-NormalizedPath (Get-Location).Path).StartsWith('F:\', [System.StringComparison]::OrdinalIgnoreCase) -and
    $ApplicationPath.StartsWith('F:\', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'The MCC development/master copy on F: cannot be an update target.'
}
if (-not (Test-Path -LiteralPath (Join-Path $ApplicationPath '.git') -PathType Container) -or
    -not (Test-Path -LiteralPath (Join-Path $ApplicationPath 'package.json') -PathType Leaf)) {
    throw 'Z:\MCC_V1_FINAL is not a valid MCC Git application directory.'
}

New-Item -ItemType Directory -Path $StateDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $BackupDirectory -Force | Out-Null
$StatusPath = Join-Path $StateDirectory 'status.json'
$RequestPath = Join-Path $StateDirectory 'request.json'
$LockPath = Join-Path $StateDirectory 'update.lock'
$PidPath = Join-Path $StateDirectory 'mcc-test.pid'
$LogPath = Join-Path $StateDirectory 'runner.log'

function Invoke-Git([string[]]$Arguments) {
    $output = & git.exe -C $ApplicationPath @Arguments 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) {
        throw "A controlled Git operation failed."
    }
    return $output.Trim()
}

function Get-PackageVersion([string]$PackagePath) {
    $value = Get-Content -LiteralPath $PackagePath -Raw | ConvertFrom-Json
    $version = [string]$value.version
    if (-not (Test-Semver $version)) {
        throw 'MCC version metadata is invalid.'
    }
    return $version
}

function Write-UpdateStatus(
    [string]$State,
    [string]$Message,
    [string]$Outcome = 'none'
) {
    if ($UpdateStates -notcontains $State) {
        throw 'Attempted to write an invalid MCC update state.'
    }
    $timestamp = [DateTime]::UtcNow.ToString('o')
    $existing = $null
    if (Test-Path -LiteralPath $StatusPath) {
        try { $existing = Get-Content -LiteralPath $StatusPath -Raw | ConvertFrom-Json } catch { $existing = $null }
    }
    $events = [System.Collections.Generic.List[object]]::new()
    if ($null -ne $existing -and $null -ne $existing.events) {
        @($existing.events) | Select-Object -Last 79 | ForEach-Object { $events.Add($_) }
    }
    $events.Add([ordered]@{
        id = "$(Get-CleanText $script:JobId 120):${State}:${timestamp}"
        state = $State
        at = $timestamp
        message = Get-CleanText $Message
    })
    $startedAt = if ($null -ne $existing -and [string]$existing.jobId -eq $script:JobId) { [string]$existing.startedAt } else { $timestamp }
    $status = [ordered]@{
        schemaVersion = 1
        jobId = Get-CleanText $script:JobId 120
        state = $State
        code = if ($TerminalStates -contains $State) { $State } elseif ($State -eq 'queued') { 'queued' } else { 'checking' }
        message = Get-CleanText $Message
        mode = 'windows_test'
        environmentLabel = 'WINDOWS TEST MODE'
        installed = [ordered]@{ version = $script:InstalledVersion; commit = $script:InstalledCommit }
        target = [ordered]@{ version = $script:TargetVersion; commit = $script:TargetCommit }
        startedAt = $startedAt
        lastUpdatedAt = $timestamp
        completedAt = if ($TerminalStates -contains $State) { $timestamp } else { $null }
        requester = [ordered]@{ id = $script:RequesterId; name = Get-CleanText $script:RequesterName 120 }
        outcome = $Outcome
        checkToken = $null
        checkExpiresAt = $null
        events = $events
    }
    $temporaryPath = Join-Path $StateDirectory ".status.$PID.$([Guid]::NewGuid().ToString('N')).tmp"
    $status | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $temporaryPath -Encoding utf8NoBOM
    Move-Item -LiteralPath $temporaryPath -Destination $StatusPath -Force
}

function Stop-MccTestProcess {
    $processIds = [System.Collections.Generic.HashSet[int]]::new()
    if (Test-Path -LiteralPath $PidPath) {
        $storedPid = 0
        if ([int]::TryParse((Get-Content -LiteralPath $PidPath -Raw).Trim(), [ref]$storedPid) -and $storedPid -gt 0) {
            [void]$processIds.Add($storedPid)
        }
    }
    try {
        Get-NetTCPConnection -LocalPort $ApprovedPort -State Listen -ErrorAction Stop |
            ForEach-Object { [void]$processIds.Add([int]$_.OwningProcess) }
    } catch {}
    foreach ($processId in $processIds) {
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
    Remove-Item -LiteralPath $PidPath -Force -ErrorAction SilentlyContinue
}

function Start-MccTestProcess {
    $process = Start-Process -FilePath 'npm.cmd' `
        -ArgumentList @('start', '--prefix', 'backend') `
        -WorkingDirectory $ApplicationPath `
        -WindowStyle Hidden `
        -RedirectStandardOutput $LogPath `
        -RedirectStandardError (Join-Path $StateDirectory 'runner-error.log') `
        -PassThru
    Set-Content -LiteralPath $PidPath -Value ([string]$process.Id) -Encoding ascii
}

function Test-MccHealth([switch]$IgnoreSimulation) {
    if (-not $IgnoreSimulation -and $Configuration.simulation.failHealth -eq $true) {
        return $false
    }
    foreach ($attempt in 1..45) {
        try {
            $response = Invoke-RestMethod -Uri "http://127.0.0.1:$ApprovedPort/api/health" -TimeoutSec 3
            if ($response.ok -eq $true) { return $true }
        } catch {}
        Start-Sleep -Seconds 2
    }
    return $false
}

function New-RuntimeBackup([string]$Destination) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $runtimePaths = @('backend\data', 'backend\uploads', 'backend\documents', 'backend\files', 'backend\.env', '.env')
    $archive = [System.IO.Compression.ZipFile]::Open($Destination, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($relativePath in $runtimePaths) {
            $source = Join-Path $ApplicationPath $relativePath
            if (-not (Test-Path -LiteralPath $source)) { continue }
            if (Test-Path -LiteralPath $source -PathType Leaf) {
                [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $source, ($relativePath -replace '\\', '/'), [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
                continue
            }
            Get-ChildItem -LiteralPath $source -File -Recurse -Force | ForEach-Object {
                $entryName = [System.IO.Path]::GetRelativePath($ApplicationPath, $_.FullName) -replace '\\', '/'
                [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $_.FullName, $entryName, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
            }
        }
    } finally {
        $archive.Dispose()
    }
    $verification = [System.IO.Compression.ZipFile]::OpenRead($Destination)
    try { $null = $verification.Entries.Count } finally { $verification.Dispose() }
    if ((Get-Item -LiteralPath $Destination).Length -le 0) { throw 'The safety backup could not be verified.' }
}

function Restore-RuntimeBackup([string]$Source) {
    if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) { return }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($Source)
    try {
        foreach ($entry in $archive.Entries) {
            if (-not $entry.Name) { continue }
            $destination = Get-NormalizedPath (Join-Path $ApplicationPath ($entry.FullName -replace '/', '\'))
            if (-not ($destination + '\').StartsWith($ApplicationPath + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
                throw 'The backup contains an invalid path.'
            }
            New-Item -ItemType Directory -Path ([System.IO.Path]::GetDirectoryName($destination)) -Force | Out-Null
            [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destination, $true)
        }
    } finally {
        $archive.Dispose()
    }
}

function Invoke-Dependencies([switch]$Rollback) {
    if (-not $Rollback -and $Configuration.simulation.failInstall -eq $true) {
        throw 'Simulated dependency installation failure.'
    }
    foreach ($project in @('frontend', 'backend')) {
        $process = Start-Process -FilePath 'npm.cmd' -ArgumentList @('ci', '--prefix', $project) -WorkingDirectory $ApplicationPath -WindowStyle Hidden -Wait -PassThru
        if ($process.ExitCode -ne 0) { throw 'Locked dependency installation failed.' }
    }
}

function Invoke-Build([switch]$Rollback) {
    if (-not $Rollback -and $Configuration.simulation.failBuild -eq $true) {
        throw 'Simulated build failure.'
    }
    $process = Start-Process -FilePath 'npm.cmd' -ArgumentList @('run', 'build') -WorkingDirectory $ApplicationPath -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw 'MCC production build failed.' }
}

if ($ValidateOnly) {
    Write-Output 'Windows MCC test updater configuration is valid and restricted to Z:\MCC_V1_FINAL.'
    exit 0
}

$lockStream = $null
$script:JobId = ''
$script:RequesterId = 0
$script:RequesterName = ''
$script:InstalledVersion = $null
$script:InstalledCommit = $null
$script:TargetVersion = $null
$script:TargetCommit = $null
$backupPath = $null
$codeChanged = $false
$processStopped = $false

try {
    $lockStream = [System.IO.File]::Open($LockPath, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    if (-not (Test-Path -LiteralPath $RequestPath -PathType Leaf)) {
        throw 'No queued Windows MCC test update request exists.'
    }
    $request = Get-Content -LiteralPath $RequestPath -Raw | ConvertFrom-Json
    if ([int]$request.schemaVersion -ne 1 -or
        [string]$request.source.repository -ne $ApprovedRepository -or
        [string]$request.source.remote -ne $ApprovedRemote -or
        [string]$request.source.branch -ne $ApprovedBranch -or
        [int]$request.source.port -ne $ApprovedPort -or
        -not (Test-Commit ([string]$request.installed.commit)) -or
        -not (Test-Commit ([string]$request.target.commit)) -or
        -not (Test-Semver ([string]$request.target.version))) {
        throw 'The queued Windows MCC test update request is invalid.'
    }
    $script:JobId = Get-CleanText $request.jobId 120
    $script:RequesterId = [Math]::Max(0, [int]$request.requester.id)
    $script:RequesterName = Get-CleanText $request.requester.name 120
    $script:InstalledCommit = ([string]$request.installed.commit).ToLowerInvariant()
    $script:TargetCommit = ([string]$request.target.commit).ToLowerInvariant()
    $script:TargetVersion = [string]$request.target.version

    if ((Invoke-Git @('remote', 'get-url', $ApprovedRemote)) -ne $ApprovedRepository) { throw 'The approved repository does not match.' }
    if ((Invoke-Git @('branch', '--show-current')) -ne $ApprovedBranch) { throw 'The Windows test checkout must be on main.' }
    if (Invoke-Git @('status', '--porcelain=v1', '--untracked-files=normal')) { throw 'Update blocked: the Windows test installation contains local code changes.' }
    Invoke-Git @('fetch', '--no-tags', $ApprovedRemote, "+refs/heads/${ApprovedBranch}:refs/remotes/${ApprovedRemote}/${ApprovedBranch}") | Out-Null
    $actualInstalledCommit = (Invoke-Git @('rev-parse', 'HEAD')).ToLowerInvariant()
    $actualTargetCommit = (Invoke-Git @('rev-parse', "refs/remotes/${ApprovedRemote}/${ApprovedBranch}")).ToLowerInvariant()
    if ($actualInstalledCommit -ne $script:InstalledCommit -or $actualTargetCommit -ne $script:TargetCommit) {
        throw 'The verified update target is stale.'
    }
    Invoke-Git @('merge-base', '--is-ancestor', $actualInstalledCommit, $actualTargetCommit) | Out-Null
    $script:InstalledVersion = Get-PackageVersion (Join-Path $ApplicationPath 'package.json')
    $remoteManifest = Invoke-Git @('show', "$actualTargetCommit`:package.json") | ConvertFrom-Json
    if (-not (Test-Semver ([string]$remoteManifest.version)) -or [string]$remoteManifest.version -ne $script:TargetVersion) {
        throw 'The approved remote version is invalid or stale.'
    }
    if ($actualInstalledCommit -eq $actualTargetCommit) {
        throw 'The queued target is already installed. Run a new update check.'
    }

    Write-UpdateStatus 'stopping' 'Stopping the Windows MCC test process before the safety snapshot.'
    Stop-MccTestProcess
    $processStopped = $true

    Write-UpdateStatus 'backing_up' 'Creating and verifying the Windows test runtime-data backup.'
    $backupPath = Join-Path $BackupDirectory "mcc-pre-update-$([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ'))-$($script:InstalledCommit.Substring(0,7)).zip"
    New-RuntimeBackup $backupPath

    Write-UpdateStatus 'pulling' 'Fast-forwarding the Windows test copy to the approved commit.'
    Invoke-Git @('merge', '--ff-only', $script:TargetCommit) | Out-Null
    $codeChanged = $true

    Write-UpdateStatus 'installing_dependencies' 'Installing locked frontend and backend dependencies.'
    Invoke-Dependencies

    Write-UpdateStatus 'building' 'Building the Windows MCC test frontend and backend.'
    Invoke-Build

    Write-UpdateStatus 'starting' 'Starting the updated Windows MCC test process.'
    Start-MccTestProcess

    Write-UpdateStatus 'health_check' 'Health-checking the Windows MCC test build on port 4273.'
    if (-not (Test-MccHealth)) { throw 'The updated MCC health check failed.' }
    if ((Invoke-Git @('rev-parse', 'HEAD')).ToLowerInvariant() -ne $script:TargetCommit -or
        (Get-PackageVersion (Join-Path $ApplicationPath 'package.json')) -ne $script:TargetVersion) {
        throw 'The running Windows MCC test build does not match the verified target.'
    }
    $script:InstalledCommit = $script:TargetCommit
    $script:InstalledVersion = $script:TargetVersion
    Write-UpdateStatus 'succeeded' 'The Windows MCC test update completed and passed its health check.' 'succeeded'
    Remove-Item -LiteralPath $RequestPath -Force
} catch {
    $safeFailure = Get-CleanText $_.Exception.Message
    if ($script:JobId -and ($codeChanged -or $processStopped)) {
        try {
            Write-UpdateStatus 'rolling_back' 'The Windows test update failed. Restoring the previous healthy MCC version.'
            Stop-MccTestProcess
            if ($codeChanged) {
                Invoke-Git @('update-ref', "refs/heads/$ApprovedBranch", $script:InstalledCommit, $script:TargetCommit) | Out-Null
                Invoke-Git @('read-tree', '--reset', '-u', $script:InstalledCommit) | Out-Null
            }
            if ($backupPath) { Restore-RuntimeBackup $backupPath }
            Invoke-Dependencies -Rollback
            Invoke-Build -Rollback
            Start-MccTestProcess
            if (-not (Test-MccHealth -IgnoreSimulation)) { throw 'Rollback health check failed.' }
            if ((Invoke-Git @('rev-parse', 'HEAD')).ToLowerInvariant() -ne $script:InstalledCommit) { throw 'Rollback commit verification failed.' }
            Write-UpdateStatus 'rolled_back' 'The update failed. MCC was restored to the previous healthy version.' 'rolled_back'
        } catch {
            Write-UpdateStatus 'failed' 'Critical rollback failure: the Windows MCC test copy could not restore the previous healthy build.' 'failed'
        }
    } elseif ($script:JobId) {
        Write-UpdateStatus 'failed' "The Windows MCC test update was blocked before code changed. $safeFailure" 'failed'
    }
    throw
} finally {
    if ($script:JobId -and (Test-Path -LiteralPath $RequestPath -PathType Leaf)) {
        Remove-Item -LiteralPath $RequestPath -Force -ErrorAction SilentlyContinue
    }
    if ($null -ne $lockStream) { $lockStream.Dispose() }
}
