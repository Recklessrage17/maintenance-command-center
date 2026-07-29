Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:MccApprovedRepository = 'https://github.com/Recklessrage17/maintenance-command-center.git'
$script:MccApprovedRemote = 'origin'
$script:MccApprovedBranch = 'main'
$script:MccApprovedPort = 4273
$script:MccTaskName = 'MaintenanceCommandCenter'
$script:MccUpdaterTaskName = 'MaintenanceCommandCenterUpdater'
$script:MccUpdaterRoot = 'C:\ProgramData\MCC\Updater'

function Get-MccUpdaterConstants {
    [ordered]@{
        Repository = $script:MccApprovedRepository
        Remote = $script:MccApprovedRemote
        Branch = $script:MccApprovedBranch
        Port = $script:MccApprovedPort
        MccTaskName = $script:MccTaskName
        UpdaterTaskName = $script:MccUpdaterTaskName
        UpdaterRoot = $script:MccUpdaterRoot
    }
}

function Assert-MccAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Run this script from an elevated Administrator PowerShell session.'
    }
}

function Get-MccNormalizedPath {
    param([Parameter(Mandatory = $true)][string]$LiteralPath)
    [System.IO.Path]::GetFullPath($LiteralPath).TrimEnd('\')
}

function Test-MccProtectedDevelopmentPath {
    param([Parameter(Mandatory = $true)][string]$LiteralPath)
    $normalized = Get-MccNormalizedPath -LiteralPath $LiteralPath
    return [System.IO.Path]::GetPathRoot($normalized).Equals('F:\', [StringComparison]::OrdinalIgnoreCase)
}

function Assert-MccApprovedApplicationPath {
    param([Parameter(Mandatory = $true)][string]$LiteralPath)
    $normalized = Get-MccNormalizedPath -LiteralPath $LiteralPath
    if (Test-MccProtectedDevelopmentPath -LiteralPath $normalized) {
        throw 'The protected F: development/master copy cannot be configured as a Windows updater target.'
    }
    if ([System.IO.Path]::GetPathRoot($normalized) -eq $normalized) {
        throw 'The MCC installation path cannot be a drive root.'
    }
    return $normalized
}

function Get-MccCleanText {
    param(
        [AllowNull()][object]$Value,
        [ValidateRange(1, 2048)][int]$Maximum = 240
    )
    $text = ([string]$Value -replace '[\x00-\x1f\x7f]+', ' ' -replace '\s+', ' ').Trim()
    return $text.Substring(0, [Math]::Min($text.Length, $Maximum))
}

function Test-MccSemver {
    param([AllowNull()][object]$Value)
    return [string]$Value -match '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$'
}

function Test-MccCommit {
    param([AllowNull()][object]$Value)
    return [string]$Value -match '^[0-9a-fA-F]{40}$'
}

function Test-MccUpdateBranch {
    param([AllowNull()][object]$Value)
    $branch = [string]$Value
    if ([string]::IsNullOrWhiteSpace($branch) -or
        $branch.Length -gt 200 -or
        $branch -notmatch '^[A-Za-z0-9][A-Za-z0-9._/-]*$' -or
        $branch.EndsWith('/', [StringComparison]::Ordinal) -or
        $branch.EndsWith('.', [StringComparison]::Ordinal) -or
        $branch.Contains('..') -or
        $branch.Contains('//') -or
        $branch.Contains('@{')) {
        return $false
    }
    foreach ($segment in $branch.Split('/')) {
        if ([string]::IsNullOrWhiteSpace($segment) -or
            $segment.StartsWith('.', [StringComparison]::Ordinal) -or
            $segment.EndsWith('.lock', [StringComparison]::OrdinalIgnoreCase)) {
            return $false
        }
    }
    return $true
}

function Write-MccAtomicJson {
    param(
        [Parameter(Mandatory = $true)][string]$LiteralPath,
        [Parameter(Mandatory = $true)][object]$Value,
        [ValidateRange(2, 20)][int]$Depth = 10
    )
    $directory = Split-Path -Parent $LiteralPath
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
        [System.IO.Directory]::CreateDirectory($directory) | Out-Null
    }
    $temporaryPath = Join-Path $directory ".$([System.IO.Path]::GetFileName($LiteralPath)).$PID.$([Guid]::NewGuid().ToString('N')).tmp"
    try {
        $json = $Value | ConvertTo-Json -Depth $Depth
        [System.IO.File]::WriteAllText($temporaryPath, "$json`r`n", [Text.UTF8Encoding]::new($false))
        Move-Item -LiteralPath $temporaryPath -Destination $LiteralPath -Force
    } finally {
        if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) {
            Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
        }
    }
}

function Read-MccJson {
    param([Parameter(Mandatory = $true)][string]$LiteralPath)
    if (-not (Test-Path -LiteralPath $LiteralPath -PathType Leaf)) {
        throw "Required JSON file is missing: $([System.IO.Path]::GetFileName($LiteralPath))."
    }
    try {
        return Get-Content -LiteralPath $LiteralPath -Raw -Encoding utf8 | ConvertFrom-Json
    } catch {
        throw "Required JSON file is invalid: $([System.IO.Path]::GetFileName($LiteralPath))."
    }
}

function ConvertTo-MccProcessArgument {
    param([AllowEmptyString()][string]$Value)
    if ($Value -notmatch '[\s"]' -and $Value.Length -gt 0) {
        return $Value
    }
    $builder = [Text.StringBuilder]::new()
    [void]$builder.Append('"')
    $backslashes = 0
    foreach ($character in $Value.ToCharArray()) {
        if ($character -eq '\') {
            $backslashes += 1
            continue
        }
        if ($character -eq '"') {
            [void]$builder.Append(('\' * (($backslashes * 2) + 1)))
            [void]$builder.Append('"')
            $backslashes = 0
            continue
        }
        if ($backslashes -gt 0) {
            [void]$builder.Append(('\' * $backslashes))
            $backslashes = 0
        }
        [void]$builder.Append($character)
    }
    if ($backslashes -gt 0) {
        [void]$builder.Append(('\' * ($backslashes * 2)))
    }
    [void]$builder.Append('"')
    return $builder.ToString()
}

function Invoke-MccProcess {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$ArgumentList = @(),
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [ValidateRange(1, 7200)][int]$TimeoutSeconds = 120,
        [string]$DetailedLogPath = ''
    )
    $resolvedExecutable = if ([System.IO.Path]::IsPathRooted($FilePath)) {
        $FilePath
    } else {
        (Get-Command $FilePath -ErrorAction Stop).Source
    }
    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $resolvedExecutable
    $startInfo.WorkingDirectory = $WorkingDirectory
    $startInfo.Arguments = ($ArgumentList | ForEach-Object { ConvertTo-MccProcessArgument -Value ([string]$_) }) -join ' '
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    if (-not $process.Start()) {
        throw "The controlled process could not start: $([System.IO.Path]::GetFileName($resolvedExecutable))."
    }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
        try { $process.Kill() } catch {}
        throw "The controlled process timed out: $([System.IO.Path]::GetFileName($resolvedExecutable))."
    }
    $stdout = $stdoutTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()
    if ($DetailedLogPath) {
        $safeLog = @(
            "[$([DateTime]::UtcNow.ToString('o'))] $([System.IO.Path]::GetFileName($resolvedExecutable)) completed with exit code $($process.ExitCode)."
            "Captured output was withheld from the updater log (stdout characters: $($stdout.Length); stderr characters: $($stderr.Length))."
        ) -join [Environment]::NewLine
        Add-Content -LiteralPath $DetailedLogPath -Value $safeLog -Encoding utf8
    }
    if ($process.ExitCode -ne 0) {
        throw "The controlled process failed: $([System.IO.Path]::GetFileName($resolvedExecutable)) (exit code $($process.ExitCode))."
    }
    return [ordered]@{
        ExitCode = $process.ExitCode
        StandardOutput = $stdout.Trim()
        StandardError = $stderr.Trim()
    }
}

function Invoke-MccGit {
    param(
        [Parameter(Mandatory = $true)][string]$ApplicationPath,
        [Parameter(Mandatory = $true)][string[]]$ArgumentList,
        [ValidateRange(1, 600)][int]$TimeoutSeconds = 60,
        [string]$DetailedLogPath = ''
    )
    Invoke-MccProcess -FilePath 'git.exe' -ArgumentList (@('-C', $ApplicationPath) + $ArgumentList) -WorkingDirectory $ApplicationPath -TimeoutSeconds $TimeoutSeconds -DetailedLogPath $DetailedLogPath
}

function Get-MccPackageVersion {
    param([Parameter(Mandatory = $true)][string]$ApplicationPath)
    $manifest = Read-MccJson -LiteralPath (Join-Path $ApplicationPath 'package.json')
    if (-not (Test-MccSemver -Value $manifest.version)) {
        throw 'The MCC root package version is not valid semantic version metadata.'
    }
    return [string]$manifest.version
}

function Read-MccWindowsConfiguration {
    param([Parameter(Mandatory = $true)][string]$ConfigurationPath)
    $constants = Get-MccUpdaterConstants
    $normalizedConfigurationPath = Get-MccNormalizedPath -LiteralPath $ConfigurationPath
    $expectedConfigurationPath = Join-Path $constants.UpdaterRoot 'config.json'
    if (-not $normalizedConfigurationPath.Equals($expectedConfigurationPath, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'The Windows updater configuration must remain at C:\ProgramData\MCC\Updater\config.json.'
    }
    $configuration = Read-MccJson -LiteralPath $normalizedConfigurationPath
    $applicationPath = Assert-MccApprovedApplicationPath -LiteralPath ([string]$configuration.applicationPath)
    $configuredBranch = [string]$configuration.branch
    if ([int]$configuration.schemaVersion -ne 1 -or
        @('WindowsTest', 'WindowsProduction') -cnotcontains [string]$configuration.deploymentMode -or
        [string]$configuration.repository -ne $constants.Repository -or
        [string]$configuration.remote -ne $constants.Remote -or
        -not (Test-MccUpdateBranch -Value $configuredBranch) -or
        ([string]$configuration.deploymentMode -eq 'WindowsProduction' -and $configuredBranch -cne $constants.Branch) -or
        [int]$configuration.port -ne $constants.Port -or
        [string]$configuration.mccTaskName -ne $constants.MccTaskName -or
        [string]$configuration.updaterTaskName -ne $constants.UpdaterTaskName) {
        throw 'The protected Windows updater configuration contains unsupported deployment values.'
    }
    if (-not (Test-Path -LiteralPath $applicationPath -PathType Container)) {
        throw 'The configured MCC application directory is missing.'
    }
    foreach ($executableProperty in @('nodePath', 'npmPath', 'npmCliPath', 'gitPath')) {
        $configuredExecutable = [string]$configuration.$executableProperty
        if (-not [System.IO.Path]::IsPathRooted($configuredExecutable) -or
            -not (Test-Path -LiteralPath $configuredExecutable -PathType Leaf)) {
            throw "The protected Windows updater configuration has an invalid $executableProperty."
        }
    }
    $configuration.applicationPath = $applicationPath
    return $configuration
}

function Assert-MccRepository {
    param(
        [Parameter(Mandatory = $true)][string]$ApplicationPath,
        [string]$ExpectedBranch = $script:MccApprovedBranch,
        [string]$DetailedLogPath = '',
        [switch]$RequireClean
    )
    $constants = Get-MccUpdaterConstants
    if (-not (Test-MccUpdateBranch -Value $ExpectedBranch)) {
        throw 'The configured MCC update branch is invalid.'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $ApplicationPath '.git') -PathType Container)) {
        throw 'The MCC installation path is not a Git clone.'
    }
    $origin = (Invoke-MccGit -ApplicationPath $ApplicationPath -ArgumentList @('remote', 'get-url', $constants.Remote) -DetailedLogPath $DetailedLogPath).StandardOutput.Trim().TrimEnd('/')
    if (-not $origin.Equals($constants.Repository.TrimEnd('/'), [StringComparison]::OrdinalIgnoreCase)) {
        throw 'The MCC Git origin does not match the approved repository.'
    }
    $branch = (Invoke-MccGit -ApplicationPath $ApplicationPath -ArgumentList @('branch', '--show-current') -DetailedLogPath $DetailedLogPath).StandardOutput.Trim()
    if ($branch -cne $ExpectedBranch) {
        throw 'The MCC Windows installation must be on the exact Administrator-configured branch.'
    }
    if ($RequireClean) {
        $changes = (Invoke-MccGit -ApplicationPath $ApplicationPath -ArgumentList @('status', '--porcelain=v1', '--untracked-files=normal') -DetailedLogPath $DetailedLogPath).StandardOutput
        if ($changes) {
            throw 'Update blocked: this MCC installation contains local code changes. Review and protect those changes before updating.'
        }
    }
}

function Assert-MccOriginBranch {
    param(
        [Parameter(Mandatory = $true)][string]$ApplicationPath,
        [Parameter(Mandatory = $true)][string]$Branch,
        [string]$DetailedLogPath = ''
    )
    if (-not (Test-MccUpdateBranch -Value $Branch)) {
        throw 'The configured MCC update branch is invalid.'
    }
    $constants = Get-MccUpdaterConstants
    try {
        $result = Invoke-MccGit -ApplicationPath $ApplicationPath -ArgumentList @(
            'ls-remote',
            '--exit-code',
            '--heads',
            $constants.Remote,
            "refs/heads/$Branch"
        ) -TimeoutSeconds 120 -DetailedLogPath $DetailedLogPath
    } catch {
        throw 'The configured update branch could not be verified on origin.'
    }
    $escapedBranch = [Regex]::Escape($Branch)
    if ($result.StandardOutput -notmatch "(?m)^[0-9a-fA-F]{40}\s+refs/heads/$escapedBranch\s*$") {
        throw 'The configured update branch does not exist on origin.'
    }
}

function Test-MccHttpHealth {
    param(
        [ValidateRange(1, 65535)][int]$Port = 4273,
        [ValidateRange(1, 300)][int]$TimeoutSeconds = 90
    )
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        try {
            $response = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 3
            if ($response.ok -eq $true) { return $true }
        } catch {}
        Start-Sleep -Seconds 2
    } while ([DateTime]::UtcNow -lt $deadline)
    return $false
}

Export-ModuleMember -Function @(
    'Get-MccUpdaterConstants',
    'Assert-MccAdministrator',
    'Get-MccNormalizedPath',
    'Test-MccProtectedDevelopmentPath',
    'Assert-MccApprovedApplicationPath',
    'Get-MccCleanText',
    'Test-MccSemver',
    'Test-MccCommit',
    'Test-MccUpdateBranch',
    'Write-MccAtomicJson',
    'Read-MccJson',
    'Invoke-MccProcess',
    'Invoke-MccGit',
    'Get-MccPackageVersion',
    'Read-MccWindowsConfiguration',
    'Assert-MccRepository',
    'Assert-MccOriginBranch',
    'Test-MccHttpHealth'
)
