param(
    [Parameter(Mandatory = $true)][string]$ModulePath,
    [Parameter(Mandatory = $true)][string]$CrossVolumeSourcePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$normalizedModulePath = [System.IO.Path]::GetFullPath($ModulePath)
$normalizedCrossVolumeSourcePath = [System.IO.Path]::GetFullPath($CrossVolumeSourcePath)
Import-Module $normalizedModulePath -Force

$testId = [Guid]::NewGuid().ToString('N')
$temporaryTestRoot = [System.IO.Path]::GetFullPath(
    (Join-Path ([System.IO.Path]::GetTempPath()) "MCC Atomic Replacement Tests $testId")
)
$programDataTestRoot = [System.IO.Path]::GetFullPath(
    (Join-Path $env:ProgramData "MCC\AtomicReplacementTests\$testId")
)
$cleanupRoots = @($temporaryTestRoot, $programDataTestRoot)

function Assert-MccTest {
    param(
        [Parameter(Mandatory = $true)][bool]$Condition,
        [Parameter(Mandatory = $true)][string]$Message
    )
    if (-not $Condition) {
        throw $Message
    }
}

function New-MccTestDirectory {
    param(
        [Parameter(Mandatory = $true)][string]$Parent,
        [Parameter(Mandatory = $true)][string]$Name
    )
    $path = [System.IO.Path]::GetFullPath((Join-Path $Parent $Name))
    [System.IO.Directory]::CreateDirectory($path) | Out-Null
    return $path
}

function Write-MccTestFile {
    param(
        [Parameter(Mandatory = $true)][string]$LiteralPath,
        [Parameter(Mandatory = $true)][string]$Value
    )
    [System.IO.File]::WriteAllText(
        [System.IO.Path]::GetFullPath($LiteralPath),
        $Value,
        [Text.UTF8Encoding]::new($false)
    )
}

function Assert-MccNoAtomicArtifacts {
    param([Parameter(Mandatory = $true)][string]$LiteralPath)
    $artifacts = @(Get-ChildItem -LiteralPath $LiteralPath -Force -File -ErrorAction Stop | Where-Object {
        $_.Name -match '\.(replace-backup|rollback-discard)\.' -or $_.Extension -eq '.tmp'
    })
    Assert-MccTest -Condition ($artifacts.Count -eq 0) -Message "Atomic artifacts were not cleaned in $LiteralPath."
}

function Invoke-MccScenario {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][scriptblock]$Action
    )
    & $Action
    Write-Output "PASS $Name"
}

try {
    [System.IO.Directory]::CreateDirectory($temporaryTestRoot) | Out-Null
    [System.IO.Directory]::CreateDirectory($programDataTestRoot) | Out-Null

    Invoke-MccScenario -Name 'first clean install where destination does not exist' -Action {
        $directory = New-MccTestDirectory -Parent $temporaryTestRoot -Name 'clean-install'
        $temporary = Join-Path $directory '.script.install.tmp'
        $destination = Join-Path $directory 'script.ps1'
        Write-MccTestFile -LiteralPath $temporary -Value 'new clean install'
        [void](Invoke-MccAtomicFileReplacement -TemporaryPath $temporary -DestinationPath $destination)
        Assert-MccTest -Condition ([System.IO.File]::Exists($destination)) -Message 'Clean install did not create its destination.'
        Assert-MccTest -Condition ([System.IO.File]::ReadAllText($destination) -ceq 'new clean install') -Message 'Clean install content did not verify.'
        Assert-MccTest -Condition (-not [System.IO.File]::Exists($temporary)) -Message 'Clean install temporary source was not removed.'
        Assert-MccNoAtomicArtifacts -LiteralPath $directory
    }

    Invoke-MccScenario -Name 'partial rerun where destination already exists' -Action {
        $directory = New-MccTestDirectory -Parent $temporaryTestRoot -Name 'partial-rerun'
        $temporary = Join-Path $directory '.script.install.tmp'
        $destination = Join-Path $directory 'script.ps1'
        Write-MccTestFile -LiteralPath $temporary -Value 'new rerun content'
        Write-MccTestFile -LiteralPath $destination -Value 'old rerun content'
        [void](Invoke-MccAtomicFileReplacement -TemporaryPath $temporary -DestinationPath $destination)
        Assert-MccTest -Condition ([System.IO.File]::ReadAllText($destination) -ceq 'new rerun content') -Message 'Partial rerun did not replace its destination.'
        Assert-MccNoAtomicArtifacts -LiteralPath $directory
    }

    Invoke-MccScenario -Name 'empty backup-path regression' -Action {
        $directory = New-MccTestDirectory -Parent $temporaryTestRoot -Name 'empty-backup'
        $temporary = Join-Path $directory '.config.install.tmp'
        $destination = Join-Path $directory 'config.json'
        Write-MccTestFile -LiteralPath $temporary -Value 'new config'
        Write-MccTestFile -LiteralPath $destination -Value 'original config'
        $failedAsExpected = $false
        try {
            [void](Invoke-MccAtomicFileReplacement `
                -TemporaryPath $temporary `
                -DestinationPath $destination `
                -DestinationBackupPath '')
        } catch {
            $failedAsExpected = $_.Exception.Message -match 'destination backup path cannot be empty'
        }
        Assert-MccTest -Condition $failedAsExpected -Message 'An empty destination backup path was not rejected before File.Replace.'
        Assert-MccTest -Condition ([System.IO.File]::ReadAllText($destination) -ceq 'original config') -Message 'Empty-backup validation changed the original destination.'
        Assert-MccNoAtomicArtifacts -LiteralPath $directory
    }

    Invoke-MccScenario -Name 'legal sibling backup path' -Action {
        $directory = New-MccTestDirectory -Parent $temporaryTestRoot -Name 'legal-backup'
        $temporary = Join-Path $directory '.status.install.tmp'
        $destination = Join-Path $directory 'status.json'
        $legalBackup = [System.IO.Path]::GetFullPath((Join-Path $directory '.status.json.legal-backup.tmp'))
        Write-MccTestFile -LiteralPath $temporary -Value 'new status'
        Write-MccTestFile -LiteralPath $destination -Value 'old status'
        $expectedBackup = $legalBackup
        $verification = {
            param([string]$InstalledPath, [string]$BackupPath)
            if (-not [System.IO.Path]::IsPathRooted($BackupPath) -or
                -not [System.IO.Path]::GetDirectoryName($BackupPath).Equals(
                    [System.IO.Path]::GetDirectoryName($InstalledPath),
                    [StringComparison]::OrdinalIgnoreCase
                ) -or
                -not $BackupPath.Equals($expectedBackup, [StringComparison]::OrdinalIgnoreCase) -or
                -not [System.IO.File]::Exists($BackupPath) -or
                [System.IO.File]::ReadAllText($BackupPath) -cne 'old status') {
                throw 'The legal sibling backup was not available during destination verification.'
            }
        }.GetNewClosure()
        [void](Invoke-MccAtomicFileReplacement `
            -TemporaryPath $temporary `
            -DestinationPath $destination `
            -DestinationBackupPath $legalBackup `
            -DestinationVerification $verification)
        Assert-MccTest -Condition (-not [System.IO.File]::Exists($legalBackup)) -Message 'Verified legal backup was not cleaned.'
        Assert-MccNoAtomicArtifacts -LiteralPath $directory
    }

    Invoke-MccScenario -Name 'paths containing spaces' -Action {
        $directory = New-MccTestDirectory -Parent $temporaryTestRoot -Name 'directory with spaces'
        $temporary = Join-Path $directory '.temporary source with spaces.tmp'
        $destination = Join-Path $directory 'destination with spaces.psm1'
        Write-MccTestFile -LiteralPath $temporary -Value 'new spaced content'
        Write-MccTestFile -LiteralPath $destination -Value 'old spaced content'
        [void](Invoke-MccAtomicFileReplacement -TemporaryPath $temporary -DestinationPath $destination)
        Assert-MccTest -Condition ([System.IO.File]::ReadAllText($destination) -ceq 'new spaced content') -Message 'Paths containing spaces were not replaced.'
        Assert-MccNoAtomicArtifacts -LiteralPath $directory
    }

    Invoke-MccScenario -Name 'ProgramData destination' -Action {
        $directory = New-MccTestDirectory -Parent $programDataTestRoot -Name 'program data destination'
        $temporary = Join-Path $directory '.programdata.install.tmp'
        $destination = Join-Path $directory 'config.json'
        Write-MccTestFile -LiteralPath $temporary -Value 'programdata content'
        [void](Invoke-MccAtomicFileReplacement -TemporaryPath $temporary -DestinationPath $destination)
        Assert-MccTest -Condition ([System.IO.File]::ReadAllText($destination) -ceq 'programdata content') -Message 'ProgramData destination did not verify.'
        Assert-MccNoAtomicArtifacts -LiteralPath $directory
    }

    Invoke-MccScenario -Name 'F source and C destination through a same-volume sibling temporary file' -Action {
        Assert-MccTest `
            -Condition ([System.IO.Path]::GetPathRoot($normalizedCrossVolumeSourcePath).Equals('F:\', [StringComparison]::OrdinalIgnoreCase)) `
            -Message 'The cross-volume source test must originate on protected F:.'
        Assert-MccTest `
            -Condition ([System.IO.Path]::GetPathRoot($programDataTestRoot).Equals('C:\', [StringComparison]::OrdinalIgnoreCase)) `
            -Message 'The cross-volume destination test must use C:.'
        $directory = New-MccTestDirectory -Parent $programDataTestRoot -Name 'cross-volume-copy'
        $temporary = [System.IO.Path]::GetFullPath((Join-Path $directory '.module.install.tmp'))
        $destination = [System.IO.Path]::GetFullPath((Join-Path $directory 'MccWindowsUpdater.Common.psm1'))
        [System.IO.File]::Copy($normalizedCrossVolumeSourcePath, $temporary)
        $expectedHash = (Get-FileHash -LiteralPath $normalizedCrossVolumeSourcePath -Algorithm SHA256).Hash
        [void](Invoke-MccAtomicFileReplacement `
            -TemporaryPath $temporary `
            -DestinationPath $destination `
            -ExpectedSha256 $expectedHash)
        $destinationHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
        Assert-MccTest -Condition ($destinationHash -ceq $expectedHash) -Message 'F:-to-C: copied content did not pass destination hash verification.'
        Assert-MccNoAtomicArtifacts -LiteralPath $directory
    }

    Invoke-MccScenario -Name 'destination hash verification and rollback' -Action {
        $directory = New-MccTestDirectory -Parent $temporaryTestRoot -Name 'hash-verification'
        $temporary = Join-Path $directory '.hash.install.tmp'
        $destination = Join-Path $directory 'hash-target.txt'
        Write-MccTestFile -LiteralPath $temporary -Value 'expected replacement'
        Write-MccTestFile -LiteralPath $destination -Value 'original before corrupt verification'
        $corruptDestination = {
            param([string]$InstalledPath, [string]$BackupPath)
            [System.IO.File]::WriteAllText($InstalledPath, 'corrupted after initial hash check')
        }
        $failedAsExpected = $false
        try {
            [void](Invoke-MccAtomicFileReplacement `
                -TemporaryPath $temporary `
                -DestinationPath $destination `
                -DestinationVerification $corruptDestination)
        } catch {
            $failedAsExpected = $_.Exception.Message -match 'destination hash changed during verification'
        }
        Assert-MccTest -Condition $failedAsExpected -Message 'Post-install destination hash corruption was not detected.'
        Assert-MccTest `
            -Condition ([System.IO.File]::ReadAllText($destination) -ceq 'original before corrupt verification') `
            -Message 'Hash verification failure did not restore the original destination.'
        Assert-MccNoAtomicArtifacts -LiteralPath $directory
    }

    Invoke-MccScenario -Name 'replacement failure preserves original file' -Action {
        $directory = New-MccTestDirectory -Parent $temporaryTestRoot -Name 'replace-failure'
        $temporary = Join-Path $directory '.locked.install.tmp'
        $destination = Join-Path $directory 'locked-target.txt'
        Write-MccTestFile -LiteralPath $temporary -Value 'replacement blocked by lock'
        Write-MccTestFile -LiteralPath $destination -Value 'locked original'
        $stream = [System.IO.File]::Open(
            $destination,
            [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::Read,
            [System.IO.FileShare]::Read
        )
        $failedAsExpected = $false
        try {
            try {
                [void](Invoke-MccAtomicFileReplacement -TemporaryPath $temporary -DestinationPath $destination)
            } catch {
                $failedAsExpected = $true
            }
        } finally {
            $stream.Dispose()
        }
        Assert-MccTest -Condition $failedAsExpected -Message 'The locked replacement unexpectedly succeeded.'
        Assert-MccTest -Condition ([System.IO.File]::ReadAllText($destination) -ceq 'locked original') -Message 'Replacement failure did not preserve the original file.'
        Assert-MccNoAtomicArtifacts -LiteralPath $directory
    }

    Invoke-MccScenario -Name 'temporary and backup cleanup' -Action {
        foreach ($scenarioDirectory in @(Get-ChildItem -LiteralPath $temporaryTestRoot, $programDataTestRoot -Directory -Recurse -Force)) {
            Assert-MccNoAtomicArtifacts -LiteralPath $scenarioDirectory.FullName
        }
    }

    Invoke-MccScenario -Name 'ACL retention after replacement' -Action {
        $directory = New-MccTestDirectory -Parent $temporaryTestRoot -Name 'acl-retention'
        $temporary = Join-Path $directory '.acl.install.tmp'
        $destination = Join-Path $directory 'acl-target.ps1'
        Write-MccTestFile -LiteralPath $temporary -Value 'new acl content'
        Write-MccTestFile -LiteralPath $destination -Value 'old acl content'
        $aclVerification = {
            param([string]$InstalledPath, [string]$BackupPath)
            $acl = Get-Acl -LiteralPath $InstalledPath -ErrorAction Stop
            foreach ($sidText in @('S-1-5-32-544', 'S-1-5-18')) {
                $rule = [Security.AccessControl.FileSystemAccessRule]::new(
                    [Security.Principal.SecurityIdentifier]::new($sidText),
                    [Security.AccessControl.FileSystemRights]::FullControl,
                    [Security.AccessControl.AccessControlType]::Allow
                )
                $acl.SetAccessRule($rule)
            }
            Set-Acl -LiteralPath $InstalledPath -AclObject $acl -ErrorAction Stop
            $validatedAcl = Get-Acl -LiteralPath $InstalledPath -ErrorAction Stop
            $rules = @($validatedAcl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
            foreach ($sidText in @('S-1-5-32-544', 'S-1-5-18')) {
                $matchingRules = @($rules | Where-Object {
                    $_.IdentityReference.Value -eq $sidText -and
                    $_.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
                    ($_.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq
                        [Security.AccessControl.FileSystemRights]::FullControl
                })
                if ($matchingRules.Count -eq 0) {
                    throw "Bootstrap ACL was not retained for $sidText."
                }
            }
        }
        [void](Invoke-MccAtomicFileReplacement `
            -TemporaryPath $temporary `
            -DestinationPath $destination `
            -DestinationVerification $aclVerification)
        [void](& $aclVerification $destination $null)
        Assert-MccNoAtomicArtifacts -LiteralPath $directory
    }
} finally {
    foreach ($root in $cleanupRoots) {
        if (-not [string]::IsNullOrWhiteSpace($root) -and
            [System.IO.Path]::IsPathRooted($root) -and
            [System.IO.Directory]::Exists($root)) {
            Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

Write-Output 'Windows updater atomic replacement tests passed.'
