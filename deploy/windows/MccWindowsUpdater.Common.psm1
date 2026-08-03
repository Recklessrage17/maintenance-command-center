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

function Set-MccExecutablePathBootstrap {
    param(
        [Parameter(Mandatory = $true)][string]$GitPath,
        [Parameter(Mandatory = $true)][string]$NodePath
    )
    if (-not [System.IO.Path]::IsPathRooted($GitPath) -or
        -not (Test-Path -LiteralPath $GitPath -PathType Leaf)) {
        throw 'The configured Git executable is missing or invalid.'
    }
    if (-not [System.IO.Path]::IsPathRooted($NodePath) -or
        -not (Test-Path -LiteralPath $NodePath -PathType Leaf)) {
        throw 'The configured Node.js executable is missing or invalid.'
    }
    $pathComparer = [StringComparer]::OrdinalIgnoreCase
    $executableDirectories = [Collections.Generic.List[string]]::new()
    $executableDirectoryKeys = [Collections.Generic.HashSet[string]]::new($pathComparer)
    foreach ($executablePath in @($GitPath, $NodePath)) {
        $directory = [System.IO.Path]::GetDirectoryName([System.IO.Path]::GetFullPath($executablePath)).TrimEnd('\', '/')
        if ($executableDirectoryKeys.Add($directory)) {
            $executableDirectories.Add($directory)
        }
    }

    $preservedPathSegments = [Collections.Generic.List[string]]::new()
    foreach ($pathSegment in @(([string]$env:PATH).Split([System.IO.Path]::PathSeparator))) {
        if ([string]::IsNullOrWhiteSpace($pathSegment)) {
            continue
        }
        $comparisonSegment = $pathSegment.Trim().Trim('"')
        try {
            if ([System.IO.Path]::IsPathRooted($comparisonSegment)) {
                $comparisonSegment = [System.IO.Path]::GetFullPath($comparisonSegment).TrimEnd('\', '/')
            }
        } catch {}
        if (-not $executableDirectoryKeys.Contains($comparisonSegment)) {
            $preservedPathSegments.Add($pathSegment)
        }
    }
    $env:PATH = (@($executableDirectories) + @($preservedPathSegments)) -join [System.IO.Path]::PathSeparator
    $env:GIT_TERMINAL_PROMPT = '0'
}

function Set-MccGitRepositoryTrustBootstrap {
    param(
        [Parameter(Mandatory = $true)][string]$ApplicationPath,
        [Parameter(Mandatory = $true)][string]$ConfiguredApplicationPath
    )
    if ([string]::IsNullOrWhiteSpace($ApplicationPath) -or
        -not [System.IO.Path]::IsPathRooted($ApplicationPath) -or
        [WildcardPattern]::ContainsWildcardCharacters($ApplicationPath)) {
        throw 'The protected Git repository trust path must be one absolute path without wildcards.'
    }
    if ([string]::IsNullOrWhiteSpace($ConfiguredApplicationPath) -or
        -not [System.IO.Path]::IsPathRooted($ConfiguredApplicationPath) -or
        [WildcardPattern]::ContainsWildcardCharacters($ConfiguredApplicationPath)) {
        throw 'The Administrator-configured Git repository trust path is invalid.'
    }
    $normalizedApplicationPath = Assert-MccApprovedApplicationPath -LiteralPath $ApplicationPath
    $normalizedConfiguredPath = Assert-MccApprovedApplicationPath -LiteralPath $ConfiguredApplicationPath
    if (-not $normalizedApplicationPath.Equals($normalizedConfiguredPath, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Git repository trust must match the exact Administrator-configured MCC clone.'
    }
    if (-not (Test-Path -LiteralPath $normalizedApplicationPath -PathType Container) -or
        -not (Test-Path -LiteralPath (Join-Path $normalizedApplicationPath '.git') -PathType Container) -or
        -not (Test-Path -LiteralPath (Join-Path $normalizedApplicationPath 'package.json') -PathType Leaf)) {
        throw 'The protected Git repository trust target is not the configured MCC clone.'
    }
    $manifest = Read-MccJson -LiteralPath (Join-Path $normalizedApplicationPath 'package.json')
    if ([string]$manifest.name -cne 'maintenance-command-center') {
        throw 'The protected Git repository trust target is not the configured MCC clone.'
    }

    foreach ($environmentName in @(Get-ChildItem Env: | Where-Object {
        $_.Name -ieq 'GIT_CONFIG_PARAMETERS' -or
        $_.Name -ieq 'GIT_CONFIG_COUNT' -or
        $_.Name -match '^GIT_CONFIG_(?:KEY|VALUE)_\d+$'
    } | ForEach-Object { $_.Name })) {
        [Environment]::SetEnvironmentVariable($environmentName, $null, [EnvironmentVariableTarget]::Process)
    }

    $gitTrustedPath = $normalizedApplicationPath.Replace('\', '/')
    if ([string]::IsNullOrWhiteSpace($gitTrustedPath) -or
        $gitTrustedPath -eq '*' -or
        [WildcardPattern]::ContainsWildcardCharacters($gitTrustedPath)) {
        throw 'Wildcard Git repository trust is forbidden.'
    }
    $env:GIT_CONFIG_COUNT = '1'
    $env:GIT_CONFIG_KEY_0 = 'safe.directory'
    $env:GIT_CONFIG_VALUE_0 = $gitTrustedPath
}

function New-MccWindowsAgentHealth {
    param(
        [Parameter(Mandatory = $true)][bool]$HeartbeatCompleted,
        [Parameter(Mandatory = $true)][bool]$ExecutableBootstrapSucceeded,
        [Parameter(Mandatory = $true)][bool]$ConfigurationValid,
        [AllowEmptyString()][string]$DeploymentMode = '',
        [Parameter(Mandatory = $true)][bool]$ApplicationPathMatches,
        [Parameter(Mandatory = $true)][bool]$RepositoryValid,
        [Parameter(Mandatory = $true)][bool]$BranchValid,
        [Parameter(Mandatory = $true)][bool]$RequestDirectoryAccessible,
        [Parameter(Mandatory = $true)][bool]$StatusDirectoryAccessible,
        [Parameter(Mandatory = $true)][bool]$MccTaskInstalled,
        [Parameter(Mandatory = $true)][bool]$MccTaskRunning,
        [Parameter(Mandatory = $true)][bool]$UpdaterTaskInstalled,
        [Parameter(Mandatory = $true)][bool]$UpdaterTaskRunning
    )
    $safeDeploymentMode = if (@('WindowsTest', 'WindowsProduction') -ccontains $DeploymentMode) {
        $DeploymentMode
    } else {
        ''
    }
    $agentHealthy = $HeartbeatCompleted -and
        $ExecutableBootstrapSucceeded -and
        $ConfigurationValid -and
        $ApplicationPathMatches -and
        $RepositoryValid -and
        $BranchValid -and
        $RequestDirectoryAccessible -and
        $StatusDirectoryAccessible -and
        $MccTaskInstalled -and
        $MccTaskRunning -and
        $UpdaterTaskInstalled -and
        $UpdaterTaskRunning
    return [ordered]@{
        schemaVersion = 1
        checkedAt = [DateTime]::UtcNow.ToString('o')
        agentHealthy = [bool]$agentHealthy
        configurationValid = $ConfigurationValid
        deploymentMode = $safeDeploymentMode
        applicationPathMatches = $ApplicationPathMatches
        repositoryValid = $RepositoryValid
        branchValid = $BranchValid
        requestDirectoryAccessible = $RequestDirectoryAccessible
        statusDirectoryAccessible = $StatusDirectoryAccessible
        mccTaskInstalled = $MccTaskInstalled
        mccTaskRunning = $MccTaskRunning
        updaterTaskInstalled = $UpdaterTaskInstalled
        updaterTaskRunning = $UpdaterTaskRunning
    }
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

function ConvertTo-MccAtomicFullFilePath {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$LiteralPath,
        [Parameter(Mandatory = $true)][string]$Description
    )
    if ([string]::IsNullOrWhiteSpace($LiteralPath)) {
        throw "Atomic replacement $Description path cannot be empty."
    }
    try {
        $normalizedPath = [System.IO.Path]::GetFullPath($LiteralPath)
    } catch {
        throw "Atomic replacement $Description path is not legal: $($_.Exception.Message)"
    }
    $fileName = [System.IO.Path]::GetFileName($normalizedPath)
    if ([string]::IsNullOrWhiteSpace($fileName) -or
        $normalizedPath.EndsWith([System.IO.Path]::DirectorySeparatorChar) -or
        $normalizedPath.EndsWith([System.IO.Path]::AltDirectorySeparatorChar) -or
        $normalizedPath.IndexOfAny([System.IO.Path]::GetInvalidPathChars()) -ge 0 -or
        $fileName.IndexOfAny([System.IO.Path]::GetInvalidFileNameChars()) -ge 0) {
        throw "Atomic replacement $Description path must be a legal full file path with a nonempty filename."
    }
    return $normalizedPath
}

function Get-MccAtomicFileHash {
    param([Parameter(Mandatory = $true)][string]$LiteralPath)
    return (Get-FileHash -LiteralPath $LiteralPath -Algorithm SHA256 -ErrorAction Stop).Hash.ToUpperInvariant()
}

function Remove-MccAtomicArtifact {
    param(
        [AllowNull()][AllowEmptyString()][string]$LiteralPath,
        [Parameter(Mandatory = $true)][string]$Description
    )
    if ([string]::IsNullOrWhiteSpace($LiteralPath)) {
        return
    }
    if ([System.IO.Directory]::Exists($LiteralPath)) {
        throw "Atomic replacement $Description unexpectedly became a directory: $LiteralPath"
    }
    if ([System.IO.File]::Exists($LiteralPath)) {
        [System.IO.File]::Delete($LiteralPath)
    }
    if ([System.IO.File]::Exists($LiteralPath) -or [System.IO.Directory]::Exists($LiteralPath)) {
        throw "Atomic replacement could not clean the $Description path: $LiteralPath"
    }
}

function New-MccAtomicSiblingPath {
    param(
        [Parameter(Mandatory = $true)][string]$DestinationPath,
        [Parameter(Mandatory = $true)][string]$Label
    )
    $directory = [System.IO.Path]::GetDirectoryName($DestinationPath)
    $fileName = [System.IO.Path]::GetFileName($DestinationPath)
    $candidate = Join-Path $directory ".$fileName.$Label.$PID.$([Guid]::NewGuid().ToString('N')).tmp"
    return ConvertTo-MccAtomicFullFilePath -LiteralPath $candidate -Description $Label
}

function Invoke-MccAtomicFileReplacement {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$TemporaryPath,
        [Parameter(Mandatory = $true)][string]$DestinationPath,
        [ValidatePattern('^[0-9A-Fa-f]{64}$')][string]$ExpectedSha256 = '',
        [AllowNull()][AllowEmptyString()][string]$DestinationBackupPath,
        [AllowNull()][scriptblock]$DestinationVerification
    )
    $normalizedTemporaryPath = ConvertTo-MccAtomicFullFilePath -LiteralPath $TemporaryPath -Description 'temporary source'
    $normalizedDestinationPath = ConvertTo-MccAtomicFullFilePath -LiteralPath $DestinationPath -Description 'destination'
    if ($normalizedTemporaryPath.Equals($normalizedDestinationPath, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Atomic replacement temporary source and destination must be different paths.'
    }

    $normalizedBackupPath = $null
    $rollbackDiscardPath = $null
    $destinationExisted = $false
    $originalHash = $null
    $mutationAttempted = $false
    $commitApplied = $false
    $operationCompleted = $false
    $originalRestored = $false
    [Exception]$operationFailure = $null

    try {
        $requestedBackupPath = $null
        if ($PSBoundParameters.ContainsKey('DestinationBackupPath')) {
            $requestedBackupPath = ConvertTo-MccAtomicFullFilePath `
                -LiteralPath $DestinationBackupPath `
                -Description 'destination backup'
        }
        if (-not [System.IO.File]::Exists($normalizedTemporaryPath)) {
            throw "Atomic replacement temporary source file is missing: $normalizedTemporaryPath"
        }
        if ((Get-Item -LiteralPath $normalizedTemporaryPath -Force -ErrorAction Stop).Length -le 0) {
            throw "Atomic replacement temporary source file is empty: $normalizedTemporaryPath"
        }

        $destinationDirectory = [System.IO.Path]::GetDirectoryName($normalizedDestinationPath)
        if ([string]::IsNullOrWhiteSpace($destinationDirectory) -or
            -not [System.IO.Directory]::Exists($destinationDirectory)) {
            throw "Atomic replacement destination directory does not exist: $destinationDirectory"
        }
        if ([System.IO.Directory]::Exists($normalizedDestinationPath)) {
            throw "Atomic replacement destination cannot be a directory: $normalizedDestinationPath"
        }

        $temporaryRoot = [System.IO.Path]::GetPathRoot($normalizedTemporaryPath)
        $destinationRoot = [System.IO.Path]::GetPathRoot($normalizedDestinationPath)
        if ([string]::IsNullOrWhiteSpace($temporaryRoot) -or
            [string]::IsNullOrWhiteSpace($destinationRoot) -or
            -not $temporaryRoot.Equals($destinationRoot, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Atomic replacement temporary source and destination must be on the same filesystem volume.'
        }

        $temporaryHash = Get-MccAtomicFileHash -LiteralPath $normalizedTemporaryPath
        if ($ExpectedSha256 -and $temporaryHash -cne $ExpectedSha256.ToUpperInvariant()) {
            throw 'Atomic replacement temporary source hash does not match the expected content.'
        }
        $verifiedHash = if ($ExpectedSha256) { $ExpectedSha256.ToUpperInvariant() } else { $temporaryHash }

        $destinationExisted = [System.IO.File]::Exists($normalizedDestinationPath)
        if ($destinationExisted) {
            $originalHash = Get-MccAtomicFileHash -LiteralPath $normalizedDestinationPath
            if ($PSBoundParameters.ContainsKey('DestinationBackupPath')) {
                $normalizedBackupPath = $requestedBackupPath
            } else {
                $normalizedBackupPath = New-MccAtomicSiblingPath -DestinationPath $normalizedDestinationPath -Label 'replace-backup'
            }
            $backupDirectory = [System.IO.Path]::GetDirectoryName($normalizedBackupPath)
            if (-not $backupDirectory.Equals($destinationDirectory, [StringComparison]::OrdinalIgnoreCase)) {
                throw 'Atomic replacement backup must be a sibling of the destination file.'
            }
            if ($normalizedBackupPath.Equals($normalizedTemporaryPath, [StringComparison]::OrdinalIgnoreCase) -or
                $normalizedBackupPath.Equals($normalizedDestinationPath, [StringComparison]::OrdinalIgnoreCase)) {
                throw 'Atomic replacement backup must differ from the temporary source and destination paths.'
            }
            if ([System.IO.File]::Exists($normalizedBackupPath) -or [System.IO.Directory]::Exists($normalizedBackupPath)) {
                throw "Atomic replacement backup path already exists: $normalizedBackupPath"
            }
            $backupRoot = [System.IO.Path]::GetPathRoot($normalizedBackupPath)
            if (-not $backupRoot.Equals($destinationRoot, [StringComparison]::OrdinalIgnoreCase)) {
                throw 'Atomic replacement backup must be on the destination filesystem volume.'
            }

            $mutationAttempted = $true
            [System.IO.File]::Replace(
                $normalizedTemporaryPath,
                $normalizedDestinationPath,
                $normalizedBackupPath,
                $true
            )
            $commitApplied = $true
        } else {
            if ($PSBoundParameters.ContainsKey('DestinationBackupPath')) {
                throw 'Atomic replacement does not accept a backup path when the destination does not exist.'
            }
            $mutationAttempted = $true
            [System.IO.File]::Move($normalizedTemporaryPath, $normalizedDestinationPath)
            $commitApplied = $true
        }

        if (-not [System.IO.File]::Exists($normalizedDestinationPath) -or
            (Get-Item -LiteralPath $normalizedDestinationPath -Force -ErrorAction Stop).Length -le 0) {
            throw 'Atomic replacement did not create a nonempty destination file.'
        }
        $destinationHash = Get-MccAtomicFileHash -LiteralPath $normalizedDestinationPath
        if ($destinationHash -cne $verifiedHash) {
            throw 'Atomic replacement destination hash verification failed.'
        }
        if ($null -ne $DestinationVerification) {
            [void](& $DestinationVerification $normalizedDestinationPath $normalizedBackupPath)
        }
        $destinationHash = Get-MccAtomicFileHash -LiteralPath $normalizedDestinationPath
        if ($destinationHash -cne $verifiedHash) {
            throw 'Atomic replacement destination hash changed during verification.'
        }

        Remove-MccAtomicArtifact -LiteralPath $normalizedTemporaryPath -Description 'verified temporary source'
        Remove-MccAtomicArtifact -LiteralPath $normalizedBackupPath -Description 'verified destination backup'
        $operationCompleted = $true
    } catch {
        $operationFailure = $_.Exception
        try {
            if (-not $mutationAttempted) {
                $originalRestored = $true
            } elseif ($destinationExisted) {
                $currentDestinationIsOriginal = (
                    [System.IO.File]::Exists($normalizedDestinationPath) -and
                    (Get-MccAtomicFileHash -LiteralPath $normalizedDestinationPath) -ceq $originalHash
                )
                if (-not $currentDestinationIsOriginal) {
                    if ([string]::IsNullOrWhiteSpace($normalizedBackupPath) -or
                        -not [System.IO.File]::Exists($normalizedBackupPath)) {
                        throw 'The original destination backup is unavailable for rollback.'
                    }
                    if ([System.IO.File]::Exists($normalizedDestinationPath)) {
                        $rollbackDiscardPath = New-MccAtomicSiblingPath -DestinationPath $normalizedDestinationPath -Label 'rollback-discard'
                        [System.IO.File]::Replace(
                            $normalizedBackupPath,
                            $normalizedDestinationPath,
                            $rollbackDiscardPath,
                            $true
                        )
                    } else {
                        [System.IO.File]::Move($normalizedBackupPath, $normalizedDestinationPath)
                    }
                    if (-not [System.IO.File]::Exists($normalizedDestinationPath) -or
                        (Get-MccAtomicFileHash -LiteralPath $normalizedDestinationPath) -cne $originalHash) {
                        throw 'Atomic replacement rollback could not verify the original destination content.'
                    }
                }
                $originalRestored = $true
            } else {
                if ($commitApplied) {
                    if ([System.IO.Directory]::Exists($normalizedDestinationPath)) {
                        throw 'Atomic replacement rollback found a directory at the destination path.'
                    }
                    if ([System.IO.File]::Exists($normalizedDestinationPath)) {
                        [System.IO.File]::Delete($normalizedDestinationPath)
                    }
                    if ([System.IO.File]::Exists($normalizedDestinationPath)) {
                        throw 'Atomic replacement rollback could not restore the original absent destination.'
                    }
                }
                $originalRestored = $true
            }
        } catch {
            $operationFailure = [InvalidOperationException]::new(
                "Atomic replacement failed and rollback also failed. Original failure: $($operationFailure.Message) Rollback failure: $($_.Exception.Message)",
                $_.Exception
            )
        }
    } finally {
        foreach ($artifact in @(
            @{ Path = $normalizedTemporaryPath; Description = 'temporary source' },
            @{ Path = $rollbackDiscardPath; Description = 'rollback discard' }
        )) {
            try {
                Remove-MccAtomicArtifact -LiteralPath $artifact.Path -Description $artifact.Description
            } catch {
                if ($null -eq $operationFailure) {
                    $operationFailure = $_.Exception
                } else {
                    $operationFailure = [InvalidOperationException]::new(
                        "$($operationFailure.Message) Cleanup failure: $($_.Exception.Message)",
                        $_.Exception
                    )
                }
            }
        }
        if ($operationCompleted -or $originalRestored) {
            try {
                Remove-MccAtomicArtifact -LiteralPath $normalizedBackupPath -Description 'destination backup'
            } catch {
                if ($null -eq $operationFailure) {
                    $operationFailure = $_.Exception
                } else {
                    $operationFailure = [InvalidOperationException]::new(
                        "$($operationFailure.Message) Cleanup failure: $($_.Exception.Message)",
                        $_.Exception
                    )
                }
            }
        }
    }

    if ($null -ne $operationFailure) {
        throw $operationFailure
    }
    return $normalizedDestinationPath
}

function Write-MccAtomicJson {
    param(
        [Parameter(Mandatory = $true)][string]$LiteralPath,
        [Parameter(Mandatory = $true)][object]$Value,
        [ValidateRange(2, 20)][int]$Depth = 10,
        [AllowNull()][scriptblock]$DestinationVerification
    )
    $normalizedLiteralPath = ConvertTo-MccAtomicFullFilePath -LiteralPath $LiteralPath -Description 'JSON destination'
    $directory = [System.IO.Path]::GetDirectoryName($normalizedLiteralPath)
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
        [System.IO.Directory]::CreateDirectory($directory) | Out-Null
    }
    $temporaryPath = ConvertTo-MccAtomicFullFilePath `
        -LiteralPath (Join-Path $directory ".$([System.IO.Path]::GetFileName($normalizedLiteralPath)).$PID.$([Guid]::NewGuid().ToString('N')).tmp") `
        -Description 'JSON temporary source'
    try {
        $json = $Value | ConvertTo-Json -Depth $Depth
        [System.IO.File]::WriteAllText($temporaryPath, "$json`r`n", [Text.UTF8Encoding]::new($false))
        if ((Get-Item -LiteralPath $temporaryPath -ErrorAction Stop).Length -le 0) {
            throw 'Atomic JSON validation produced an empty temporary file.'
        }
        [void]([System.IO.File]::ReadAllText($temporaryPath, [Text.Encoding]::UTF8) | ConvertFrom-Json -ErrorAction Stop)
        if ($null -ne $DestinationVerification) {
            [void](Invoke-MccAtomicFileReplacement `
                -TemporaryPath $temporaryPath `
                -DestinationPath $normalizedLiteralPath `
                -DestinationVerification $DestinationVerification)
        } else {
            [void](Invoke-MccAtomicFileReplacement `
                -TemporaryPath $temporaryPath `
                -DestinationPath $normalizedLiteralPath)
        }
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

function Stop-MccExactProcessTreeFallback {
    param([Parameter(Mandatory = $true)][Diagnostics.Process]$Process)
    $pendingIds = [Collections.Generic.Queue[int]]::new()
    $treeIds = [Collections.Generic.List[int]]::new()
    $pendingIds.Enqueue($Process.Id)
    while ($pendingIds.Count -gt 0) {
        $parentId = $pendingIds.Dequeue()
        foreach ($child in @(Get-CimInstance -ClassName Win32_Process -Filter "ParentProcessId = $parentId" -ErrorAction Stop)) {
            $childId = [int]$child.ProcessId
            if (-not $treeIds.Contains($childId)) {
                $treeIds.Add($childId)
                $pendingIds.Enqueue($childId)
            }
        }
    }
    $treeIds.Reverse()
    foreach ($processId in @($treeIds) + @($Process.Id)) {
        try {
            $treeProcess = [Diagnostics.Process]::GetProcessById($processId)
            try {
                if (-not $treeProcess.HasExited) {
                    $treeProcess.Kill()
                    if (-not $treeProcess.WaitForExit(10000)) {
                        return $false
                    }
                }
            } finally {
                $treeProcess.Dispose()
            }
        } catch [ArgumentException] {}
    }
    try {
        $Process.Refresh()
        return $Process.HasExited
    } catch {
        return $true
    }
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
    $executableName = Get-MccCleanText -Value ([System.IO.Path]::GetFileName($resolvedExecutable)) -Maximum 120
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    try {
        if (-not $process.Start()) {
            throw "The controlled process could not start: $executableName."
        }
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
            $cleanupOutcome = 'termination_unconfirmed'
            try {
                $taskkillPath = Join-Path ([Environment]::GetFolderPath('System')) 'taskkill.exe'
                if (-not (Test-Path -LiteralPath $taskkillPath -PathType Leaf)) {
                    throw 'The Windows process-tree termination utility is unavailable.'
                }
                $taskkillStartInfo = [Diagnostics.ProcessStartInfo]::new()
                $taskkillStartInfo.FileName = $taskkillPath
                $taskkillStartInfo.Arguments = "/PID $($process.Id) /T /F"
                $taskkillStartInfo.UseShellExecute = $false
                $taskkillStartInfo.CreateNoWindow = $true
                $taskkillStartInfo.RedirectStandardOutput = $true
                $taskkillStartInfo.RedirectStandardError = $true
                $taskkill = [Diagnostics.Process]::new()
                $taskkill.StartInfo = $taskkillStartInfo
                try {
                    if (-not $taskkill.Start()) {
                        throw 'The exact process-tree termination command could not start.'
                    }
                    if (-not $taskkill.WaitForExit(30000)) {
                        try { $taskkill.Kill() } catch {}
                        throw 'The exact process-tree termination command timed out.'
                    }
                    if ($taskkill.ExitCode -ne 0) {
                        throw 'The exact process-tree termination command failed.'
                    }
                } finally {
                    $taskkill.Dispose()
                }
                if (-not $process.WaitForExit(15000)) {
                    throw 'The timed-out process did not confirm termination.'
                }
                $cleanupOutcome = 'exact_process_tree_terminated'
            } catch {
                try {
                    if (Stop-MccExactProcessTreeFallback -Process $process) {
                        $cleanupOutcome = 'exact_process_tree_terminated_by_fallback'
                    }
                } catch {}
            }
            if ($DetailedLogPath) {
                Add-Content -LiteralPath $DetailedLogPath -Value "[$([DateTime]::UtcNow.ToString('o'))] $executableName timed out during execution; sanitized cleanup outcome: $cleanupOutcome." -Encoding utf8
            }
            if (-not $process.HasExited) {
                throw "The controlled process timed out and termination was not confirmed: $executableName."
            }
            throw "The controlled process timed out: $executableName."
        }
        $process.WaitForExit()
        $stdout = $stdoutTask.GetAwaiter().GetResult()
        $stderr = $stderrTask.GetAwaiter().GetResult()
        $exitCode = $process.ExitCode
        if ($DetailedLogPath) {
            $safeLog = @(
                "[$([DateTime]::UtcNow.ToString('o'))] $executableName completed with exit code $exitCode."
                "Captured output was withheld from the updater log (stdout characters: $($stdout.Length); stderr characters: $($stderr.Length))."
            ) -join [Environment]::NewLine
            Add-Content -LiteralPath $DetailedLogPath -Value $safeLog -Encoding utf8
        }
        if ($exitCode -ne 0) {
            throw "The controlled process failed: $executableName (exit code $exitCode)."
        }
        return [ordered]@{
            ExitCode = $exitCode
            StandardOutput = $stdout.Trim()
            StandardError = $stderr.Trim()
        }
    } finally {
        $process.Dispose()
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
        [string]$configuration.updaterTaskName -ne $constants.UpdaterTaskName -or
        [string]$configuration.serviceIdentity -cne 'NT AUTHORITY\LOCAL SERVICE' -or
        [string]$configuration.agentIdentity -cne 'NT AUTHORITY\SYSTEM') {
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

function Test-MccVersionBeforeManagedReadiness {
    param([AllowNull()][object]$Value)
    if (-not (Test-MccSemver -Value $Value)) { return $false }
    return ([version][string]$Value) -lt ([version]'1.4.4')
}

function Test-MccScheduledTaskIdentity {
    param(
        [AllowNull()][object]$Task,
        [Parameter(Mandatory = $true)][ValidateSet('S-1-5-18', 'S-1-5-19')][string]$ExpectedSid
    )
    if ($null -eq $Task -or $null -eq $Task.Principal) { return $false }
    $userId = [string]$Task.Principal.UserId
    if ($userId -ceq $ExpectedSid) { return $true }
    try {
        $account = [Security.Principal.NTAccount]::new($userId)
        $sid = $account.Translate([Security.Principal.SecurityIdentifier])
        return [string]$sid.Value -ceq $ExpectedSid
    } catch {
        return $false
    }
}

function Get-MccHttpStatusCodeFromErrorRecord {
    param([Parameter(Mandatory = $true)][object]$ErrorRecord)
    if ($null -ne $ErrorRecord.Exception -and
        $null -ne $ErrorRecord.Exception.Data -and
        $ErrorRecord.Exception.Data.Contains('MccHttpStatusCode')) {
        return [int]$ErrorRecord.Exception.Data['MccHttpStatusCode']
    }
    if ($null -ne $ErrorRecord.Exception -and $null -ne $ErrorRecord.Exception.Response) {
        try { return [int]$ErrorRecord.Exception.Response.StatusCode } catch {}
    }
    return 0
}

function Invoke-MccHttpJsonProbe {
    param(
        [Parameter(Mandatory = $true)][string]$Uri,
        [ValidateRange(1, 120)][int]$TimeoutSeconds = 10,
        [int[]]$AllowedFailureStatusCodes = @(),
        [switch]$RequireFailureJson,
        [scriptblock]$RequestInvoker
    )
    if ($null -ne $RequestInvoker) {
        try {
            $response = & $RequestInvoker $Uri $TimeoutSeconds
        } catch {
            $statusCode = Get-MccHttpStatusCodeFromErrorRecord -ErrorRecord $_
            if ($AllowedFailureStatusCodes -contains $statusCode -and -not $RequireFailureJson) {
                return [pscustomobject]@{ statusCode = $statusCode; payload = $null }
            }
            throw
        }
    } else {
        $request = [Net.HttpWebRequest]::Create($Uri)
        $request.Method = 'GET'
        $request.AllowAutoRedirect = $false
        $request.Proxy = $null
        $request.Timeout = $TimeoutSeconds * 1000
        $request.ReadWriteTimeout = $TimeoutSeconds * 1000
        $webResponse = $null
        try {
            try {
                $webResponse = $request.GetResponse()
            } catch [Net.WebException] {
                if ($null -eq $_.Exception.Response) { throw }
                $webResponse = $_.Exception.Response
            }
            $reader = [IO.StreamReader]::new($webResponse.GetResponseStream())
            try {
                $content = $reader.ReadToEnd()
            } finally {
                $reader.Dispose()
            }
            $response = [pscustomobject]@{ StatusCode = [int]$webResponse.StatusCode; Content = $content }
        } finally {
            if ($null -ne $webResponse) { $webResponse.Dispose() }
        }
    }
    $statusCode = [int]$response.StatusCode
    if ($statusCode -ne 200) {
        if ($AllowedFailureStatusCodes -contains $statusCode) {
            if ($RequireFailureJson) {
                try {
                    $failurePayload = [string]$response.Content | ConvertFrom-Json -ErrorAction Stop
                } catch {
                    throw 'The protected HTTP failure response returned invalid JSON.'
                }
                return [pscustomobject]@{ statusCode = $statusCode; payload = $failurePayload }
            }
            return [pscustomobject]@{ statusCode = $statusCode; payload = $null }
        }
        throw "The protected HTTP probe returned unexpected status $statusCode."
    }
    try {
        $payload = [string]$response.Content | ConvertFrom-Json -ErrorAction Stop
    } catch {
        throw 'The protected HTTP probe returned invalid JSON.'
    }
    return [pscustomobject]@{ statusCode = 200; payload = $payload }
}

function Assert-MccManagedReadinessPayload {
    param(
        [Parameter(Mandatory = $true)][object]$Payload,
        [Parameter(Mandatory = $true)][string]$ExpectedMode,
        [Parameter(Mandatory = $true)][string]$ExpectedEnvironmentLabel,
        [Parameter(Mandatory = $true)][string]$ExpectedBranch,
        [Parameter(Mandatory = $true)][string]$ExpectedVersion,
        [Parameter(Mandatory = $true)][string]$ExpectedCommit,
        [ValidateRange(1, 65535)][int]$ExpectedPort = 4273
    )
    $expectedShortCommit = $ExpectedCommit.Substring(0, 7).ToLowerInvariant()
    if ($Payload.ok -ne $true -or
        [int]$Payload.port -ne $ExpectedPort -or
        $Payload.systemUpdate.configured -ne $true -or
        $Payload.systemUpdate.enabled -ne $true -or
        $Payload.systemUpdate.applicationMatchesConfiguration -ne $true -or
        $Payload.systemUpdate.repositoryApproved -ne $true -or
        [string]$Payload.systemUpdate.mode -cne $ExpectedMode -or
        [string]$Payload.systemUpdate.environmentLabel -cne $ExpectedEnvironmentLabel -or
        [string]$Payload.systemUpdate.branch -cne $ExpectedBranch -or
        [string]$Payload.systemUpdate.installedVersion -cne $ExpectedVersion -or
        ([string]$Payload.systemUpdate.installedCommit).ToLowerInvariant() -cne $expectedShortCommit) {
        throw 'The protected updater readiness payload does not match the managed target.'
    }
}

function Assert-MccLegacyManagedRuntimeEvidence {
    param([Parameter(Mandatory = $true)][Collections.IDictionary]$Evidence)
    if (-not $Evidence.Contains('verificationContext') -or
        @('InstallerBootstrap', 'Rollback') -cnotcontains [string]$Evidence.verificationContext) {
        throw 'Legacy managed-readiness compatibility is not permitted in this verification context.'
    }
    if (-not $Evidence.Contains('readinessStatusCode') -or [int]$Evidence.readinessStatusCode -ne 404) {
        throw 'Legacy managed-readiness compatibility requires an exact HTTP 404 response.'
    }
    if (-not $Evidence.Contains('installedVersion') -or
        -not (Test-MccVersionBeforeManagedReadiness -Value $Evidence.installedVersion)) {
        throw 'Legacy managed-readiness compatibility is limited to installed MCC versions older than 1.4.4.'
    }
    if ([string]$Evidence.verificationContext -ceq 'Rollback' -and
        (-not $Evidence.Contains('restoredCommitMatchesBackup') -or $Evidence.restoredCommitMatchesBackup -ne $true)) {
        throw 'Legacy rollback verification requires the exact recorded backup commit.'
    }
    $requiredEvidence = @(
        'configurationValid',
        'applicationPathMatches',
        'originMatches',
        'branchMatches',
        'packageVersionMatches',
        'commitMatches',
        'repositoryClean',
        'mccTaskInstalled',
        'mccTaskRunning',
        'mccTaskIdentityMatches',
        'updaterTaskInstalled',
        'updaterTaskRunning',
        'updaterTaskIdentityMatches',
        'agentHealthy',
        'agentConfigurationValid',
        'agentRepositoryValid',
        'agentBranchValid',
        'agentApplicationPathMatches',
        'requestDirectoryAccessible',
        'statusDirectoryAccessible',
        'processRecordExists',
        'launchIdValid',
        'launchIdDistinct',
        'processApplicationMatchesConfiguration',
        'processUpdateModeMatches',
        'processNodeEnvironmentMatches',
        'pidRunning',
        'nodeExecutableMatches',
        'backendCommandLineMatches',
        'exclusivePortOwner',
        'healthOk',
        'healthApplicationMatches',
        'healthPortMatches',
        'updateStatusUnauthorized'
    )
    foreach ($name in $requiredEvidence) {
        if (-not $Evidence.Contains($name) -or $Evidence[$name] -ne $true) {
            throw "Legacy managed-readiness compatibility evidence failed: $name."
        }
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
    'Set-MccExecutablePathBootstrap',
    'Set-MccGitRepositoryTrustBootstrap',
    'New-MccWindowsAgentHealth',
    'Test-MccSemver',
    'Test-MccCommit',
    'Test-MccUpdateBranch',
    'Invoke-MccAtomicFileReplacement',
    'Write-MccAtomicJson',
    'Read-MccJson',
    'Invoke-MccProcess',
    'Stop-MccExactProcessTreeFallback',
    'Invoke-MccGit',
    'Get-MccPackageVersion',
    'Read-MccWindowsConfiguration',
    'Assert-MccRepository',
    'Assert-MccOriginBranch',
    'Test-MccVersionBeforeManagedReadiness',
    'Test-MccScheduledTaskIdentity',
    'Invoke-MccHttpJsonProbe',
    'Assert-MccManagedReadinessPayload',
    'Assert-MccLegacyManagedRuntimeEvidence',
    'Test-MccHttpHealth'
)
