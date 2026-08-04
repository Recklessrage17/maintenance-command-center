<#
.SYNOPSIS
Installs the managed Maintenance Command Center Windows updater.

.DESCRIPTION
Validates one explicit clean MCC Git clone on its Administrator-configured branch,
Node.js 22+, npm, Git,
locked dependency manifests, and port 4273. It installs two fixed scheduled tasks:
MaintenanceCommandCenter runs as LOCAL SERVICE and
MaintenanceCommandCenterUpdater runs as SYSTEM. Protected configuration, scripts,
requests, status, logs, locks, and backups are stored under ProgramData.

.PARAMETER MccPath
The dedicated Windows MCC installation clone. F: is always rejected.

.PARAMETER Mode
WindowsTest or WindowsProduction. The browser cannot select or change this value.

.PARAMETER TestBranch
One explicit origin branch for WindowsTest. Defaults to main. Supplying this
parameter for WindowsProduction is always rejected.

.PARAMETER Port
The fixed MCC port. Only 4273 is accepted.

.PARAMETER RepairUpdaterAcl
Repairs a known partial C:\ProgramData\MCC\Updater installation by restoring
elevated bootstrap access and child inheritance before installation continues.
#>
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [Parameter(Mandatory = $true)]
    [string]$MccPath,

    [Parameter(Mandatory = $true)]
    [ValidateSet('WindowsTest', 'WindowsProduction')]
    [string]$Mode,

    [ValidateLength(1, 200)]
    [string]$TestBranch = 'main',

    [ValidateRange(1, 65535)]
    [int]$Port = 4273,

    [switch]$RepairUpdaterAcl
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

Import-Module (Join-Path $PSScriptRoot 'MccWindowsUpdater.Common.psm1') -Force
Assert-MccAdministrator
$constants = Get-MccUpdaterConstants
$Mode = if ($Mode -ieq 'WindowsTest') { 'WindowsTest' } else { 'WindowsProduction' }
$testBranchWasSupplied = $PSBoundParameters.ContainsKey('TestBranch')
if ($Mode -eq 'WindowsProduction' -and $testBranchWasSupplied) {
    throw 'TestBranch is a WindowsTest-only installation setting and is never allowed in WindowsProduction.'
}
$configuredBranch = if ($Mode -eq 'WindowsTest') { $TestBranch } else { $constants.Branch }
if (-not (Test-MccUpdateBranch -Value $configuredBranch)) {
    throw 'The configured WindowsTest branch name is invalid.'
}
$environmentLabel = if ($Mode -eq 'WindowsTest') { 'WINDOWS TEST MODE' } else { 'WINDOWS 11 PRODUCTION' }
if ($Port -ne $constants.Port) {
    throw 'Maintenance Command Center Windows deployments use the fixed port 4273.'
}
$applicationPath = Assert-MccApprovedApplicationPath -LiteralPath $MccPath
if (-not (Test-Path -LiteralPath $applicationPath -PathType Container)) {
    throw 'The explicit MCC installation path does not exist.'
}

$gitPath = (Get-Command 'git.exe' -ErrorAction Stop).Source
$nodePath = (Get-Command 'node.exe' -ErrorAction Stop).Source
$npmPath = (Get-Command 'npm.cmd' -ErrorAction Stop).Source
$npmCliPath = Join-Path (Split-Path -Parent $nodePath) 'node_modules\npm\bin\npm-cli.js'
if (-not (Test-Path -LiteralPath $npmCliPath -PathType Leaf)) {
    throw 'The npm CLI installed with Node.js could not be located.'
}
$nodeVersionText = (& $nodePath --version).Trim()
if ($LASTEXITCODE -ne 0 -or $nodeVersionText -notmatch '^v(?<major>\d+)\.') {
    throw 'Node.js could not be validated.'
}
if ([int]$Matches.major -lt 22) {
    throw "Node.js 22 or newer is required. Detected $nodeVersionText."
}
& $npmPath --version | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'npm is installed but could not run.' }
& $gitPath --version | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Git is installed but could not run.' }
Invoke-MccProcess -FilePath $gitPath -ArgumentList @('check-ref-format', '--branch', $configuredBranch) -WorkingDirectory $applicationPath -TimeoutSeconds 15 | Out-Null

Assert-MccRepository -ApplicationPath $applicationPath -ExpectedBranch $configuredBranch -RequireClean
Assert-MccOriginBranch -ApplicationPath $applicationPath -Branch $configuredBranch
foreach ($requiredFile in @(
    'package.json',
    'package-lock.json',
    'frontend\package.json',
    'frontend\package-lock.json',
    'backend\package.json',
    'backend\package-lock.json'
)) {
    if (-not (Test-Path -LiteralPath (Join-Path $applicationPath $requiredFile) -PathType Leaf)) {
        throw "Required deployment file is missing: $requiredFile"
    }
}
$applicationVersion = Get-MccPackageVersion -ApplicationPath $applicationPath
$applicationCommit = (Invoke-MccGit -ApplicationPath $applicationPath -ArgumentList @('rev-parse', 'HEAD')).StandardOutput.ToLowerInvariant()
if (-not (Test-MccCommit -Value $applicationCommit)) {
    throw 'The installed MCC commit could not be validated.'
}

if (-not $PSCmdlet.ShouldProcess($applicationPath, "Install $Mode managed Windows updater on origin/$configuredBranch and startup tasks")) {
    return
}

$updaterRoot = $constants.UpdaterRoot
$knownUpdaterRoot = 'C:\ProgramData\MCC\Updater'
$installLog = Join-Path $updaterRoot 'logs\install.log'
$script:InstallerLogPath = ''
$script:InstallerBootstrapStage = 'bootstrap initialization'

function Assert-MccKnownUpdaterRoot {
    param([Parameter(Mandatory = $true)][string]$LiteralPath)
    $actual = [System.IO.Path]::GetFullPath($LiteralPath).TrimEnd('\')
    $expected = [System.IO.Path]::GetFullPath($knownUpdaterRoot).TrimEnd('\')
    if (-not $actual.Equals($expected, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Updater ACL operations are restricted to $knownUpdaterRoot."
    }
}

function Write-MccInstallerLog {
    param([Parameter(Mandatory = $true)][string]$Message)
    if (-not $script:InstallerLogPath) {
        [Console]::Error.WriteLine("MCC installer log unavailable: $Message")
        return
    }
    try {
        Add-Content -LiteralPath $script:InstallerLogPath -Value "[$([DateTime]::UtcNow.ToString('o'))] $Message" -Encoding utf8
    } catch {
        [Console]::Error.WriteLine("MCC installer log unavailable at $script:InstallerLogPath`: $($_.Exception.Message)")
        [Console]::Error.WriteLine($Message)
    }
}

function Get-MccUpdaterTreeItems {
    param([Parameter(Mandatory = $true)][string]$LiteralPath)
    $knownRootPath = [System.IO.Path]::GetFullPath($knownUpdaterRoot).TrimEnd('\')
    $requestedRootPath = [System.IO.Path]::GetFullPath($LiteralPath).TrimEnd('\')
    if (-not $requestedRootPath.Equals($knownRootPath, [StringComparison]::OrdinalIgnoreCase) -and
        -not $requestedRootPath.StartsWith("$knownRootPath\", [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Updater ACL traversal attempted to start outside the known updater directory.'
    }
    $rootItem = Get-Item -LiteralPath $LiteralPath -Force -ErrorAction Stop
    $items = [Collections.Generic.List[System.IO.FileSystemInfo]]::new()
    $items.Add($rootItem)
    $pending = [Collections.Generic.Queue[System.IO.DirectoryInfo]]::new()
    $pending.Enqueue([System.IO.DirectoryInfo]$rootItem)
    $rootPrefix = "$([System.IO.Path]::GetFullPath($LiteralPath).TrimEnd('\'))\"
    while ($pending.Count -gt 0) {
        $directory = $pending.Dequeue()
        foreach ($child in @(Get-ChildItem -LiteralPath $directory.FullName -Force -ErrorAction Stop)) {
            $childPath = [System.IO.Path]::GetFullPath($child.FullName)
            if (-not $childPath.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
                throw 'Updater ACL traversal attempted to leave the known updater directory.'
            }
            if ($child.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
                throw "Updater ACL traversal refuses reparse points: $childPath"
            }
            $items.Add($child)
            if ($child.PSIsContainer) {
                $pending.Enqueue([System.IO.DirectoryInfo]$child)
            }
        }
    }
    return $items.ToArray()
}

function Test-MccFullControlAce {
    param(
        [Parameter(Mandatory = $true)][Security.AccessControl.FileSystemSecurity]$Acl,
        [Parameter(Mandatory = $true)][string]$Sid
    )
    $rules = @($Acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
    return @($rules | Where-Object {
        $_.IdentityReference.Value -eq $Sid -and
        $_.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
        ($_.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq
            [Security.AccessControl.FileSystemRights]::FullControl
    }).Count -gt 0
}

function Assert-MccBootstrapAcl {
    Assert-MccKnownUpdaterRoot -LiteralPath $updaterRoot
    foreach ($item in @(Get-MccUpdaterTreeItems -LiteralPath $updaterRoot)) {
        $acl = Get-Acl -LiteralPath $item.FullName -ErrorAction Stop
        if ($acl.AreAccessRulesProtected) {
            throw "Bootstrap ACL validation found inheritance disabled: $($item.FullName)"
        }
        if (-not (Test-MccFullControlAce -Acl $acl -Sid 'S-1-5-32-544') -or
            -not (Test-MccFullControlAce -Acl $acl -Sid 'S-1-5-18')) {
            throw "Bootstrap ACL validation did not find Administrators and SYSTEM Full Control: $($item.FullName)"
        }
    }
}

function Repair-MccUpdaterAcl {
    Assert-MccAdministrator
    Assert-MccKnownUpdaterRoot -LiteralPath $updaterRoot
    [System.IO.Directory]::CreateDirectory($updaterRoot) | Out-Null
    $aclWorkingDirectory = Split-Path -Parent $updaterRoot
    $grantArguments = @(
        $updaterRoot,
        '/grant:r',
        '*S-1-5-32-544:(OI)(CI)F',
        '*S-1-5-18:(OI)(CI)F',
        '/L'
    )
    $recursiveGrantArguments = @(
        $updaterRoot,
        '/grant:r',
        '*S-1-5-32-544:(OI)(CI)F',
        '*S-1-5-18:(OI)(CI)F',
        '/T',
        '/L'
    )
    $inheritanceArguments = @($updaterRoot, '/inheritance:e', '/T', '/L')
    try {
        Invoke-MccProcess -FilePath 'icacls.exe' -ArgumentList $grantArguments -WorkingDirectory $aclWorkingDirectory -TimeoutSeconds 300 | Out-Null
        Invoke-MccProcess -FilePath 'icacls.exe' -ArgumentList $recursiveGrantArguments -WorkingDirectory $aclWorkingDirectory -TimeoutSeconds 300 | Out-Null
        Invoke-MccProcess -FilePath 'icacls.exe' -ArgumentList $inheritanceArguments -WorkingDirectory $aclWorkingDirectory -TimeoutSeconds 300 | Out-Null
    } catch {
        [Console]::Error.WriteLine("Initial updater ACL repair required scoped ownership recovery: $($_.Exception.Message)")
        Invoke-MccProcess -FilePath 'takeown.exe' -ArgumentList @('/F', $updaterRoot, '/A', '/R', '/D', 'Y') -WorkingDirectory $aclWorkingDirectory -TimeoutSeconds 300 | Out-Null
        Invoke-MccProcess -FilePath 'icacls.exe' -ArgumentList $grantArguments -WorkingDirectory $aclWorkingDirectory -TimeoutSeconds 300 | Out-Null
        Invoke-MccProcess -FilePath 'icacls.exe' -ArgumentList $recursiveGrantArguments -WorkingDirectory $aclWorkingDirectory -TimeoutSeconds 300 | Out-Null
        Invoke-MccProcess -FilePath 'icacls.exe' -ArgumentList $inheritanceArguments -WorkingDirectory $aclWorkingDirectory -TimeoutSeconds 300 | Out-Null
    }
    Invoke-MccProcess -FilePath 'icacls.exe' -ArgumentList $grantArguments -WorkingDirectory $aclWorkingDirectory -TimeoutSeconds 300 | Out-Null
    foreach ($item in @(Get-MccUpdaterTreeItems -LiteralPath $updaterRoot)) {
        Enable-MccBootstrapItemAcl -LiteralPath $item.FullName
    }
    Assert-MccBootstrapAcl
}

function Enable-MccBootstrapItemAcl {
    param([Parameter(Mandatory = $true)][string]$LiteralPath)
    $normalized = [System.IO.Path]::GetFullPath($LiteralPath)
    $normalizedRoot = [System.IO.Path]::GetFullPath($updaterRoot).TrimEnd('\')
    $rootPrefix = "$normalizedRoot\"
    if (-not $normalized.TrimEnd('\').Equals($normalizedRoot, [StringComparison]::OrdinalIgnoreCase) -and
        -not $normalized.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Bootstrap item ACL repair attempted to leave the known updater directory.'
    }
    $item = Get-Item -LiteralPath $LiteralPath -Force -ErrorAction Stop
    $acl = Get-Acl -LiteralPath $LiteralPath -ErrorAction Stop
    $acl.SetAccessRuleProtection($false, $true)
    $inheritance = [Security.AccessControl.InheritanceFlags]::None
    if ($item.PSIsContainer) {
        $inheritance = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
            [Security.AccessControl.InheritanceFlags]::ObjectInherit
    }
    foreach ($sidText in @('S-1-5-32-544', 'S-1-5-18')) {
        $rule = [Security.AccessControl.FileSystemAccessRule]::new(
            [Security.Principal.SecurityIdentifier]::new($sidText),
            [Security.AccessControl.FileSystemRights]::FullControl,
            $inheritance,
            [Security.AccessControl.PropagationFlags]::None,
            [Security.AccessControl.AccessControlType]::Allow
        )
        $acl.SetAccessRule($rule)
    }
    if (-not (Test-MccFullControlAce -Acl $acl -Sid 'S-1-5-32-544') -or
        -not (Test-MccFullControlAce -Acl $acl -Sid 'S-1-5-18')) {
        throw "Bootstrap replacement grants were not confirmed before restrictive ACE repair: $LiteralPath"
    }
    foreach ($rule in @($acl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]) | Where-Object {
        $_.AccessControlType -eq [Security.AccessControl.AccessControlType]::Deny
    })) {
        [void]$acl.RemoveAccessRuleSpecific($rule)
    }
    Set-Acl -LiteralPath $LiteralPath -AclObject $acl -ErrorAction Stop
    $validatedAcl = Get-Acl -LiteralPath $LiteralPath -ErrorAction Stop
    if ($validatedAcl.AreAccessRulesProtected -or
        -not (Test-MccFullControlAce -Acl $validatedAcl -Sid 'S-1-5-32-544') -or
        -not (Test-MccFullControlAce -Acl $validatedAcl -Sid 'S-1-5-18')) {
        throw "Bootstrap item ACL validation failed: $LiteralPath"
    }
}

function Install-MccAtomicFile {
    param(
        [Parameter(Mandatory = $true)][string]$SourcePath,
        [Parameter(Mandatory = $true)][string]$DestinationPath
    )
    if ([string]::IsNullOrWhiteSpace($SourcePath) -or [string]::IsNullOrWhiteSpace($DestinationPath)) {
        throw 'Atomic installer source and destination paths must not be empty.'
    }
    $normalizedSource = [System.IO.Path]::GetFullPath($SourcePath)
    $normalizedDestination = [System.IO.Path]::GetFullPath($DestinationPath)
    if ([string]::IsNullOrWhiteSpace([System.IO.Path]::GetFileName($normalizedSource)) -or
        [string]::IsNullOrWhiteSpace([System.IO.Path]::GetFileName($normalizedDestination))) {
        throw 'Atomic installer source and destination paths must contain nonempty filenames.'
    }
    if (-not (Test-Path -LiteralPath $normalizedSource -PathType Leaf)) {
        throw "Atomic installer source file is missing: $normalizedSource"
    }
    if ((Get-Item -LiteralPath $normalizedSource -Force -ErrorAction Stop).Length -le 0) {
        throw "Atomic installer source file is empty: $normalizedSource"
    }
    if ($normalizedSource.Equals($normalizedDestination, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Atomic installer source and destination must be different paths.'
    }
    $destinationDirectory = [System.IO.Path]::GetDirectoryName($normalizedDestination)
    if (-not [System.IO.Directory]::Exists($destinationDirectory)) {
        throw "Atomic installer destination directory does not exist: $destinationDirectory"
    }
    if ([System.IO.Directory]::Exists($normalizedDestination)) {
        throw "Atomic installer destination cannot be a directory: $normalizedDestination"
    }
    $destinationRootPrefix = "$([System.IO.Path]::GetFullPath($updaterRoot).TrimEnd('\'))\"
    if (-not $normalizedDestination.StartsWith($destinationRootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Atomic installer destination attempted to leave the known updater directory.'
    }
    $temporaryPath = [System.IO.Path]::GetFullPath(
        (Join-Path $destinationDirectory ".$([System.IO.Path]::GetFileName($normalizedDestination)).install.$PID.$([Guid]::NewGuid().ToString('N')).tmp")
    )
    try {
        Copy-Item -LiteralPath $normalizedSource -Destination $temporaryPath -ErrorAction Stop
        Unblock-File -LiteralPath $temporaryPath -ErrorAction SilentlyContinue
        if ((Get-Item -LiteralPath $temporaryPath -ErrorAction Stop).Length -le 0) {
            throw "Atomic installer validation found an empty temporary file for $normalizedDestination."
        }
        $sourceHash = (Get-FileHash -LiteralPath $normalizedSource -Algorithm SHA256 -ErrorAction Stop).Hash
        $temporaryHash = (Get-FileHash -LiteralPath $temporaryPath -Algorithm SHA256 -ErrorAction Stop).Hash
        if ($sourceHash -cne $temporaryHash) {
            throw "Atomic installer hash validation failed for $normalizedDestination."
        }
        if ([System.IO.Path]::GetExtension($normalizedDestination) -match '^\.ps(m)?1$') {
            $parseErrors = $null
            [void][System.Management.Automation.Language.Parser]::ParseFile($temporaryPath, [ref]$null, [ref]$parseErrors)
            if ($parseErrors.Count -gt 0) {
                throw "Atomic installer PowerShell validation failed for $normalizedDestination."
            }
        }
        Enable-MccBootstrapItemAcl -LiteralPath $temporaryPath
        $destinationVerifier = {
            param([string]$InstalledPath, [AllowNull()][string]$BackupPath)
            Enable-MccBootstrapItemAcl -LiteralPath $InstalledPath
            Unblock-File -LiteralPath $InstalledPath -ErrorAction SilentlyContinue
        }
        [void](Invoke-MccAtomicFileReplacement `
            -TemporaryPath $temporaryPath `
            -DestinationPath $normalizedDestination `
            -ExpectedSha256 $sourceHash `
            -DestinationVerification $destinationVerifier)
    } finally {
        if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) {
            Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
        }
    }
}

function Write-MccInstallerAtomicText {
    param(
        [Parameter(Mandatory = $true)][string]$LiteralPath,
        [Parameter(Mandatory = $true)][string]$Value
    )
    if ([string]::IsNullOrWhiteSpace($LiteralPath)) {
        throw 'Atomic bootstrap destination path must not be empty.'
    }
    $normalizedLiteralPath = [System.IO.Path]::GetFullPath($LiteralPath)
    if ([string]::IsNullOrWhiteSpace([System.IO.Path]::GetFileName($normalizedLiteralPath))) {
        throw 'Atomic bootstrap destination path must contain a nonempty filename.'
    }
    $directory = [System.IO.Path]::GetDirectoryName($normalizedLiteralPath)
    if (-not [System.IO.Directory]::Exists($directory)) {
        throw "Atomic bootstrap destination directory does not exist: $directory"
    }
    if ([System.IO.Directory]::Exists($normalizedLiteralPath)) {
        throw "Atomic bootstrap destination cannot be a directory: $normalizedLiteralPath"
    }
    $temporaryPath = [System.IO.Path]::GetFullPath(
        (Join-Path $directory ".$([System.IO.Path]::GetFileName($normalizedLiteralPath)).write.$PID.$([Guid]::NewGuid().ToString('N')).tmp")
    )
    try {
        [System.IO.File]::WriteAllText($temporaryPath, $Value, [Text.UTF8Encoding]::new($false))
        if ((Get-Item -LiteralPath $temporaryPath -ErrorAction Stop).Length -le 0) {
            throw 'Atomic bootstrap verification produced an empty temporary file.'
        }
        Enable-MccBootstrapItemAcl -LiteralPath $temporaryPath
        $expectedValue = $Value
        $destinationVerifier = {
            param([string]$InstalledPath, [AllowNull()][string]$BackupPath)
            Enable-MccBootstrapItemAcl -LiteralPath $InstalledPath
            if ([System.IO.File]::ReadAllText($InstalledPath, [Text.Encoding]::UTF8) -cne $expectedValue) {
                throw "Atomic bootstrap verification could not read back $InstalledPath."
            }
        }
        [void](Invoke-MccAtomicFileReplacement `
            -TemporaryPath $temporaryPath `
            -DestinationPath $normalizedLiteralPath `
            -DestinationVerification $destinationVerifier)
    } finally {
        if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) {
            Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
        }
    }
}

function Write-MccInstallerJson {
    param(
        [Parameter(Mandatory = $true)][string]$LiteralPath,
        [Parameter(Mandatory = $true)][object]$Value
    )
    $destinationVerifier = {
        param([string]$InstalledPath, [AllowNull()][string]$BackupPath)
        Enable-MccBootstrapItemAcl -LiteralPath $InstalledPath
        [void](Read-MccJson -LiteralPath $InstalledPath)
    }
    Write-MccAtomicJson `
        -LiteralPath ([System.IO.Path]::GetFullPath($LiteralPath)) `
        -Value $Value `
        -DestinationVerification $destinationVerifier
}

function Invoke-MccBootstrapVerification {
    param(
        [Parameter(Mandatory = $true)][string[]]$InstalledScriptNames,
        [Parameter(Mandatory = $true)][string]$SourceDirectory
    )
    $verificationId = [Guid]::NewGuid().ToString('N')
    $scriptVerificationPath = Join-Path $updaterRoot "scripts\.mcc-bootstrap-$verificationId.tmp"
    $configVerificationPath = Join-Path $updaterRoot ".mcc-bootstrap-config-$verificationId.json"
    $statusVerificationPath = Join-Path $updaterRoot "status\.mcc-bootstrap-status-$verificationId.json"
    $verificationPaths = @($scriptVerificationPath, $configVerificationPath, $statusVerificationPath)
    try {
        $logMarker = "BOOTSTRAP WRITE TEST $verificationId"
        Add-Content -LiteralPath $installLog -Value "[$([DateTime]::UtcNow.ToString('o'))] $logMarker" -Encoding utf8
        if ((Get-Content -LiteralPath $installLog -Raw -Encoding utf8) -notmatch [Regex]::Escape($logMarker)) {
            throw 'Bootstrap verification could not append and read back logs\install.log.'
        }

        Write-MccInstallerAtomicText -LiteralPath $scriptVerificationPath -Value "create-$verificationId"
        Write-MccInstallerAtomicText -LiteralPath $scriptVerificationPath -Value "replace-$verificationId"
        Write-MccInstallerJson -LiteralPath $configVerificationPath -Value ([ordered]@{ marker = 'create'; id = $verificationId })
        Write-MccInstallerJson -LiteralPath $configVerificationPath -Value ([ordered]@{ marker = 'replace'; id = $verificationId })
        Write-MccInstallerJson -LiteralPath $statusVerificationPath -Value ([ordered]@{ marker = 'create'; id = $verificationId })
        Write-MccInstallerJson -LiteralPath $statusVerificationPath -Value ([ordered]@{ marker = 'replace'; id = $verificationId })

        foreach ($scriptName in $InstalledScriptNames) {
            $sourcePath = Join-Path $SourceDirectory $scriptName
            $installedPath = Join-Path $updaterRoot "scripts\$scriptName"
            $sourceHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256 -ErrorAction Stop).Hash
            $installedHash = (Get-FileHash -LiteralPath $installedPath -Algorithm SHA256 -ErrorAction Stop).Hash
            if ($sourceHash -cne $installedHash -or
                [string]::IsNullOrWhiteSpace((Get-Content -LiteralPath $installedPath -Raw -Encoding utf8))) {
                throw "Bootstrap verification could not read back the installed updater script: $scriptName"
            }
        }
    } finally {
        foreach ($verificationPath in $verificationPaths) {
            if (Test-Path -LiteralPath $verificationPath -PathType Leaf) {
                Remove-Item -LiteralPath $verificationPath -Force -ErrorAction SilentlyContinue
            }
        }
    }
}

function New-MccAccessRule {
    param(
        [Parameter(Mandatory = $true)][string]$Sid,
        [Parameter(Mandatory = $true)][Security.AccessControl.FileSystemRights]$Rights,
        [Parameter(Mandatory = $true)][bool]$IsDirectory
    )
    $inheritance = [Security.AccessControl.InheritanceFlags]::None
    if ($IsDirectory) {
        $inheritance = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
            [Security.AccessControl.InheritanceFlags]::ObjectInherit
    }
    return [Security.AccessControl.FileSystemAccessRule]::new(
        [Security.Principal.SecurityIdentifier]::new($Sid),
        $Rights,
        $inheritance,
        [Security.AccessControl.PropagationFlags]::None,
        [Security.AccessControl.AccessControlType]::Allow
    )
}

function Set-MccFinalAclItem {
    param(
        [Parameter(Mandatory = $true)][string]$LiteralPath,
        [AllowNull()][object]$LocalServiceRights = $null
    )
    $item = Get-Item -LiteralPath $LiteralPath -Force -ErrorAction Stop
    $acl = Get-Acl -LiteralPath $LiteralPath -ErrorAction Stop
    $administratorRule = New-MccAccessRule -Sid 'S-1-5-32-544' -Rights ([Security.AccessControl.FileSystemRights]::FullControl) -IsDirectory $item.PSIsContainer
    $systemRule = New-MccAccessRule -Sid 'S-1-5-18' -Rights ([Security.AccessControl.FileSystemRights]::FullControl) -IsDirectory $item.PSIsContainer
    $acl.SetAccessRule($administratorRule)
    $acl.SetAccessRule($systemRule)
    if ($null -ne $LocalServiceRights) {
        $localServiceRule = New-MccAccessRule -Sid 'S-1-5-19' -Rights ([Security.AccessControl.FileSystemRights]$LocalServiceRights) -IsDirectory $item.PSIsContainer
        $acl.SetAccessRule($localServiceRule)
    }
    if (-not (Test-MccFullControlAce -Acl $acl -Sid 'S-1-5-32-544') -or
        -not (Test-MccFullControlAce -Acl $acl -Sid 'S-1-5-18')) {
        throw "Final ACL replacement grants were not confirmed before inheritance removal: $LiteralPath"
    }

    $acl.SetAccessRuleProtection($true, $false)
    foreach ($rule in @($acl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]))) {
        [void]$acl.RemoveAccessRuleSpecific($rule)
    }
    $acl.AddAccessRule($administratorRule)
    $acl.AddAccessRule($systemRule)
    if ($null -ne $LocalServiceRights) {
        $acl.AddAccessRule($localServiceRule)
    }
    if (-not (Test-MccFullControlAce -Acl $acl -Sid 'S-1-5-32-544') -or
        -not (Test-MccFullControlAce -Acl $acl -Sid 'S-1-5-18')) {
        throw "Final ACL construction would leave an unsafe DACL: $LiteralPath"
    }
    Set-Acl -LiteralPath $LiteralPath -AclObject $acl -ErrorAction Stop
}

function Set-MccFinalAclProfile {
    param(
        [Parameter(Mandatory = $true)][string]$LiteralPath,
        [AllowNull()][object]$LocalServiceRights = $null,
        [switch]$Recurse
    )
    $profileItems = if ($Recurse) {
        @(Get-MccUpdaterTreeItems -LiteralPath $LiteralPath)
    } else {
        @(Get-Item -LiteralPath $LiteralPath -Force -ErrorAction Stop)
    }
    foreach ($item in $profileItems) {
        Set-MccFinalAclItem -LiteralPath $item.FullName -LocalServiceRights $LocalServiceRights
    }
}

function Assert-MccFinalAclItem {
    param(
        [Parameter(Mandatory = $true)][string]$LiteralPath,
        [AllowNull()][object]$LocalServiceRights = $null
    )
    $acl = Get-Acl -LiteralPath $LiteralPath -ErrorAction Stop
    if (-not $acl.AreAccessRulesProtected) {
        throw "Final ACL validation found bootstrap inheritance still enabled: $LiteralPath"
    }
    if (-not (Test-MccFullControlAce -Acl $acl -Sid 'S-1-5-32-544') -or
        -not (Test-MccFullControlAce -Acl $acl -Sid 'S-1-5-18')) {
        throw "Final ACL validation did not find Administrators and SYSTEM Full Control: $LiteralPath"
    }
    $rules = @($acl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]))
    $broadWriteMask = [Security.AccessControl.FileSystemRights]::WriteData -bor
        [Security.AccessControl.FileSystemRights]::AppendData -bor
        [Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor
        [Security.AccessControl.FileSystemRights]::WriteAttributes -bor
        [Security.AccessControl.FileSystemRights]::Delete -bor
        [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
        [Security.AccessControl.FileSystemRights]::ChangePermissions -bor
        [Security.AccessControl.FileSystemRights]::TakeOwnership
    $broadWrite = @($rules | Where-Object {
        $_.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
        @('S-1-1-0', 'S-1-5-32-545') -contains $_.IdentityReference.Value -and
        ($_.FileSystemRights -band $broadWriteMask)
    })
    if ($broadWrite.Count -gt 0) {
        throw "Final ACL validation found Everyone or Users write access: $LiteralPath"
    }
    $localServiceRules = @($rules | Where-Object {
        $_.IdentityReference.Value -eq 'S-1-5-19' -and
        $_.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow
    })
    if ($null -eq $LocalServiceRights) {
        if ($localServiceRules.Count -gt 0) {
            throw "Final ACL validation found unexpected LOCAL SERVICE access: $LiteralPath"
        }
    } else {
        [long]$actualRights = 0
        foreach ($localServiceRule in $localServiceRules) {
            $actualRights = $actualRights -bor [long]$localServiceRule.FileSystemRights
        }
        $expectedRights = [long]([Security.AccessControl.FileSystemRights]$LocalServiceRights -bor
            [Security.AccessControl.FileSystemRights]::Synchronize)
        $fullControlMask = [long][Security.AccessControl.FileSystemRights]::FullControl
        $unexpectedRights = $actualRights -band $fullControlMask -band (-bnot $expectedRights)
        if ($localServiceRules.Count -ne 1 -or
            ($actualRights -band $expectedRights) -ne $expectedRights -or
            $unexpectedRights -ne 0) {
            throw "Final ACL validation found incorrect LOCAL SERVICE permissions: $LiteralPath"
        }
    }
}

function Assert-MccFinalAclProfile {
    param(
        [Parameter(Mandatory = $true)][string]$LiteralPath,
        [AllowNull()][object]$LocalServiceRights = $null,
        [switch]$Recurse
    )
    $profileItems = if ($Recurse) {
        @(Get-MccUpdaterTreeItems -LiteralPath $LiteralPath)
    } else {
        @(Get-Item -LiteralPath $LiteralPath -Force -ErrorAction Stop)
    }
    foreach ($item in $profileItems) {
        Assert-MccFinalAclItem -LiteralPath $item.FullName -LocalServiceRights $LocalServiceRights
    }
}

function Assert-MccFinalUpdaterTree {
    $rootPath = [System.IO.Path]::GetFullPath($updaterRoot).TrimEnd('\')
    foreach ($item in @(Get-MccUpdaterTreeItems -LiteralPath $updaterRoot)) {
        $relativePath = $item.FullName.Substring($rootPath.Length).TrimStart('\')
        $rights = $readExecute
        if ($relativePath.Equals('config.json', [StringComparison]::OrdinalIgnoreCase)) {
            $rights = $readOnly
        } elseif ($relativePath -match '^(logs|backups)(\\|$)') {
            $rights = $null
        } elseif ($relativePath -match '^(request|web-logs)(\\|$)') {
            $rights = $modify
        } elseif ($relativePath -match '^(scripts|status)(\\|$)') {
            $rights = $readExecute
        }
        Assert-MccFinalAclItem -LiteralPath $item.FullName -LocalServiceRights $rights
    }
}

function Assert-MccApplicationAclTarget {
    param([Parameter(Mandatory = $true)][string]$LiteralPath)
    $applicationRoot = [System.IO.Path]::GetFullPath($applicationPath).TrimEnd('\')
    $target = [System.IO.Path]::GetFullPath($LiteralPath).TrimEnd('\')
    if (-not $target.Equals($applicationRoot, [StringComparison]::OrdinalIgnoreCase) -and
        -not $target.StartsWith("$applicationRoot\", [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Application ACL preparation attempted to leave the validated MCC clone.'
    }
    return $target
}

function Grant-MccLocalServiceApplicationAccess {
    param(
        [Parameter(Mandatory = $true)][string]$LiteralPath,
        [Parameter(Mandatory = $true)][ValidateSet('R', 'RX', 'M')][string]$Rights,
        [switch]$Inherit
    )
    $target = Assert-MccApplicationAclTarget -LiteralPath $LiteralPath
    if (-not (Test-Path -LiteralPath $target)) {
        throw "A required application ACL target is missing: $([System.IO.Path]::GetFileName($target))"
    }
    $grant = if ($Inherit) { "*S-1-5-19:(OI)(CI)$Rights" } else { "*S-1-5-19:$Rights" }
    Invoke-MccProcess `
        -FilePath 'icacls.exe' `
        -ArgumentList @($target, '/grant:r', $grant) `
        -WorkingDirectory $applicationPath `
        -TimeoutSeconds 60 `
        -DetailedLogPath $installLog | Out-Null
}

function Assert-MccLocalServiceApplicationAccess {
    param(
        [Parameter(Mandatory = $true)][string]$LiteralPath,
        [Parameter(Mandatory = $true)][Security.AccessControl.FileSystemRights]$RequiredRights
    )
    $target = Assert-MccApplicationAclTarget -LiteralPath $LiteralPath
    $acl = Get-Acl -LiteralPath $target -ErrorAction Stop
    [long]$allowedRights = 0
    [long]$deniedRights = 0
    foreach ($rule in @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | Where-Object {
        $_.IdentityReference.Value -eq 'S-1-5-19'
    })) {
        if ($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Deny) {
            $deniedRights = $deniedRights -bor [long]$rule.FileSystemRights
        } else {
            $allowedRights = $allowedRights -bor [long]$rule.FileSystemRights
        }
    }
    $requiredMask = [long]$RequiredRights
    if (($allowedRights -band $requiredMask) -ne $requiredMask -or
        ($deniedRights -band $requiredMask) -ne 0) {
        throw "LOCAL SERVICE effective ACL verification failed for required application item: $([System.IO.Path]::GetFileName($target))"
    }
}

function Set-MccApplicationRuntimeAcl {
    Grant-MccLocalServiceApplicationAccess -LiteralPath $applicationPath -Rights RX
    $readExecuteRoots = @(
        (Join-Path $applicationPath 'backend'),
        (Join-Path $applicationPath 'backend\dist'),
        (Join-Path $applicationPath 'backend\dist\server'),
        (Join-Path $applicationPath 'frontend\dist'),
        (Join-Path $applicationPath '.git'),
        (Join-Path $applicationPath '.git\refs'),
        (Join-Path $applicationPath '.git\objects')
    )
    foreach ($readExecuteRoot in $readExecuteRoots) {
        if (Test-Path -LiteralPath $readExecuteRoot -PathType Container) {
            Grant-MccLocalServiceApplicationAccess -LiteralPath $readExecuteRoot -Rights RX -Inherit
        }
    }

    $readExecuteFiles = @(
        'backend\dist\server\index.js',
        '.git\HEAD',
        '.git\config',
        '.git\index',
        '.git\packed-refs'
    )
    foreach ($readExecuteFile in $readExecuteFiles) {
        $readExecutePath = Join-Path $applicationPath $readExecuteFile
        if (Test-Path -LiteralPath $readExecutePath -PathType Leaf) {
            Grant-MccLocalServiceApplicationAccess -LiteralPath $readExecutePath -Rights RX
        }
    }

    foreach ($manifest in @(
        'package.json',
        'package-lock.json',
        'frontend\package.json',
        'frontend\package-lock.json',
        'backend\package.json',
        'backend\package-lock.json'
    )) {
        Grant-MccLocalServiceApplicationAccess -LiteralPath (Join-Path $applicationPath $manifest) -Rights R
    }

    foreach ($runtimeDirectory in @('backend\data', 'backend\uploads', 'backend\documents', 'backend\files')) {
        $runtimePath = Join-Path $applicationPath $runtimeDirectory
        [System.IO.Directory]::CreateDirectory($runtimePath) | Out-Null
        Grant-MccLocalServiceApplicationAccess -LiteralPath $runtimePath -Rights M -Inherit
    }

    foreach ($environmentFile in @('.env', 'backend\.env')) {
        $environmentPath = Join-Path $applicationPath $environmentFile
        if (Test-Path -LiteralPath $environmentPath -PathType Leaf) {
            Grant-MccLocalServiceApplicationAccess -LiteralPath $environmentPath -Rights R
        }
    }
}

function Assert-MccApplicationRuntimeAcl {
    $readExecute = [Security.AccessControl.FileSystemRights]::ReadAndExecute
    $read = [Security.AccessControl.FileSystemRights]::Read
    $modify = [Security.AccessControl.FileSystemRights]::Modify
    Assert-MccLocalServiceApplicationAccess -LiteralPath (Join-Path $applicationPath 'backend\dist\server\index.js') -RequiredRights $readExecute
    Assert-MccLocalServiceApplicationAccess -LiteralPath (Join-Path $applicationPath 'frontend\dist') -RequiredRights $readExecute
    foreach ($manifest in @(
        'package.json',
        'package-lock.json',
        'frontend\package.json',
        'frontend\package-lock.json',
        'backend\package.json',
        'backend\package-lock.json'
    )) {
        Assert-MccLocalServiceApplicationAccess -LiteralPath (Join-Path $applicationPath $manifest) -RequiredRights $read
    }
    foreach ($gitMetadata in @('.git', '.git\HEAD', '.git\config', '.git\index', '.git\refs', '.git\objects')) {
        $gitMetadataPath = Join-Path $applicationPath $gitMetadata
        if (Test-Path -LiteralPath $gitMetadataPath) {
            Assert-MccLocalServiceApplicationAccess -LiteralPath $gitMetadataPath -RequiredRights $readExecute
        }
    }
    foreach ($runtimeDirectory in @('backend\data', 'backend\uploads', 'backend\documents', 'backend\files')) {
        Assert-MccLocalServiceApplicationAccess -LiteralPath (Join-Path $applicationPath $runtimeDirectory) -RequiredRights $modify
    }
}

function Restore-MccScheduledTasks {
    param(
        [Parameter(Mandatory = $true)][hashtable]$Snapshots,
        [Parameter(Mandatory = $true)][string[]]$TaskNames,
        [Parameter(Mandatory = $true)][string]$ApplicationPath,
        [Parameter(Mandatory = $true)][string]$NodePath,
        [Parameter(Mandatory = $true)][string]$UpdaterRoot
    )
    Stop-MccInstallerManagedRuntime -ApplicationPath $ApplicationPath -NodePath $NodePath -UpdaterRoot $UpdaterRoot -TaskName $constants.MccTaskName -Port $constants.Port
    foreach ($taskName in $TaskNames) {
        if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
            Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
            Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Stop
        }
    }
    foreach ($taskName in $TaskNames) {
        if ($Snapshots.ContainsKey($taskName)) {
            Register-ScheduledTask -TaskName $taskName -Xml ([string]$Snapshots[$taskName].Xml) -Force | Out-Null
            if ($Snapshots[$taskName].WasRunning) {
                Start-ScheduledTask -TaskName $taskName
            }
        }
    }
}

function Stop-MccInstallerManagedRuntime {
    param(
        [Parameter(Mandatory = $true)][string]$ApplicationPath,
        [Parameter(Mandatory = $true)][string]$NodePath,
        [Parameter(Mandatory = $true)][string]$UpdaterRoot,
        [Parameter(Mandatory = $true)][string]$TaskName,
        [ValidateRange(1, 65535)][int]$Port = 4273
    )
    $processStatePath = Join-Path $UpdaterRoot 'web-logs\mcc-process.json'
    $record = $null
    $managedProcessId = 0
    if (Test-Path -LiteralPath $processStatePath -PathType Leaf) {
        try {
            $record = Read-MccJson -LiteralPath $processStatePath
            [void][int]::TryParse([string]$record.processId, [ref]$managedProcessId)
        } catch {
            $record = $null
            $managedProcessId = 0
        }
    }
    $expectedNode = Get-MccNormalizedPath -LiteralPath $NodePath
    $expectedEntryPoint = Get-MccNormalizedPath -LiteralPath (Join-Path $ApplicationPath 'backend\dist\server\index.js')
    if ($managedProcessId -gt 0) {
        $processDetails = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $managedProcessId" -ErrorAction SilentlyContinue
        if ($null -ne $processDetails) {
            $actualNode = Get-MccNormalizedPath -LiteralPath ([string]$processDetails.ExecutablePath)
            $commandLine = ([string]$processDetails.CommandLine).Replace('"', '')
            if (-not $actualNode.Equals($expectedNode, [StringComparison]::OrdinalIgnoreCase) -or
                $commandLine.IndexOf($expectedEntryPoint, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
                throw 'Installer refused to stop a recorded PID that is not the configured MCC backend.'
            }
        }
    }
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($null -ne $task -and [string]$task.State -eq 'Running') {
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    }
    $taskDeadline = [DateTime]::UtcNow.AddSeconds(30)
    while ([DateTime]::UtcNow -lt $taskDeadline) {
        $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        if ($null -eq $task -or [string]$task.State -ne 'Running') { break }
        Start-Sleep -Milliseconds 500
    }
    if ($null -ne $task -and [string]$task.State -eq 'Running') {
        throw 'The existing managed MCC scheduled task did not stop before reinstall.'
    }
    if (Test-Path -LiteralPath $processStatePath -PathType Leaf) {
        try {
            $finalRecord = Read-MccJson -LiteralPath $processStatePath
            $finalRecordedProcessId = 0
            if ([int]::TryParse([string]$finalRecord.processId, [ref]$finalRecordedProcessId) -and
                $finalRecordedProcessId -gt 0 -and
                $finalRecordedProcessId -ne $managedProcessId) {
                $finalProcessDetails = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $finalRecordedProcessId" -ErrorAction SilentlyContinue
                if ($null -ne $finalProcessDetails) {
                    $finalNode = Get-MccNormalizedPath -LiteralPath ([string]$finalProcessDetails.ExecutablePath)
                    $finalCommandLine = ([string]$finalProcessDetails.CommandLine).Replace('"', '')
                    if (-not $finalNode.Equals($expectedNode, [StringComparison]::OrdinalIgnoreCase) -or
                        $finalCommandLine.IndexOf($expectedEntryPoint, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
                        throw 'Installer refused to stop a final recorded PID that is not the configured MCC backend.'
                    }
                    $record = $finalRecord
                    $managedProcessId = $finalRecordedProcessId
                }
            }
        } catch {
            if ($_.Exception.Message -match 'refused to stop') { throw }
        }
    }
    if ($managedProcessId -gt 0 -and $null -ne (Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $managedProcessId" -ErrorAction SilentlyContinue)) {
        Write-MccAtomicJson -LiteralPath (Join-Path $UpdaterRoot 'request\shutdown-request.json') -Value ([ordered]@{
            schemaVersion = 1
            processId = $managedProcessId
            requestedAt = [DateTime]::UtcNow.ToString('o')
        })
        $processDeadline = [DateTime]::UtcNow.AddSeconds(20)
        while ([DateTime]::UtcNow -lt $processDeadline -and
            $null -ne (Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $managedProcessId" -ErrorAction SilentlyContinue)) {
            Start-Sleep -Milliseconds 500
        }
        if ($null -ne (Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $managedProcessId" -ErrorAction SilentlyContinue)) {
            $exactProcess = [Diagnostics.Process]::GetProcessById($managedProcessId)
            try {
                if (-not (Stop-MccExactProcessTreeFallback -Process $exactProcess)) {
                    throw 'The exact recorded MCC process tree did not confirm termination during reinstall.'
                }
            } finally {
                $exactProcess.Dispose()
            }
        }
    }
    $portDeadline = [DateTime]::UtcNow.AddSeconds(30)
    do {
        $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
        if ($listeners.Count -eq 0) { break }
        Start-Sleep -Milliseconds 500
    } while ([DateTime]::UtcNow -lt $portDeadline)
    if ($listeners.Count -ne 0) {
        throw 'Installer found an unverified process still owning port 4273 and did not terminate it.'
    }
    if (Test-Path -LiteralPath $processStatePath -PathType Leaf) {
        Remove-Item -LiteralPath $processStatePath -Force
    }
}

$directories = @(
    $updaterRoot,
    (Join-Path $updaterRoot 'scripts'),
    (Join-Path $updaterRoot 'request'),
    (Join-Path $updaterRoot 'status'),
    (Join-Path $updaterRoot 'logs'),
    (Join-Path $updaterRoot 'web-logs'),
    (Join-Path $updaterRoot 'backups')
)
$taskNames = @($constants.MccTaskName, $constants.UpdaterTaskName)
$taskSnapshots = @{}
$tasksChanged = $false

try {
    $script:InstallerBootstrapStage = 'BOOTSTRAP ACL PHASE - recursive repair'
    if ($RepairUpdaterAcl) {
        [Console]::Error.WriteLine("RepairUpdaterAcl requested for the scoped updater tree: $knownUpdaterRoot")
    }
    Repair-MccUpdaterAcl

    $script:InstallerBootstrapStage = 'BOOTSTRAP ACL PHASE - directory creation'
    foreach ($directory in $directories) {
        [System.IO.Directory]::CreateDirectory($directory) | Out-Null
    }
    Repair-MccUpdaterAcl
    $script:InstallerLogPath = $installLog
    Write-MccInstallerLog -Message $environmentLabel
    Write-MccInstallerLog -Message "Starting $Mode installation for the validated MCC clone."
    Write-MccInstallerLog -Message "Configured update branch: origin/$configuredBranch."
    if ($RepairUpdaterAcl) {
        Write-MccInstallerLog -Message 'Completed requested recursive updater ACL repair before file installation.'
    }

    $scriptNames = @(
        'MccWindowsUpdater.Common.psm1',
        'Start-MccWindowsWeb.ps1',
        'Start-MccWindowsAgent.ps1',
        'Update-MccWindows.ps1',
        'Test-MccWindowsUpdater.ps1',
        'Uninstall-MccWindowsUpdater.ps1'
    )
    $script:InstallerBootstrapStage = 'BOOTSTRAP ACL PHASE - atomic script installation'
    foreach ($scriptName in $scriptNames) {
        $source = Join-Path $PSScriptRoot $scriptName
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
            throw "The checked-in Windows deployment package is incomplete: $scriptName"
        }
        Install-MccAtomicFile -SourcePath $source -DestinationPath (Join-Path $updaterRoot "scripts\$scriptName")
    }

    $script:InstallerBootstrapStage = 'BOOTSTRAP ACL PHASE - atomic configuration installation'
    $configurationPath = Join-Path $updaterRoot 'config.json'
    $configuration = [ordered]@{
        schemaVersion = 1
        deploymentMode = $Mode
        applicationPath = $applicationPath
        repository = $constants.Repository
        remote = $constants.Remote
        branch = $configuredBranch
        port = $constants.Port
        mccTaskName = $constants.MccTaskName
        updaterTaskName = $constants.UpdaterTaskName
        serviceIdentity = 'NT AUTHORITY\LOCAL SERVICE'
        agentIdentity = 'NT AUTHORITY\SYSTEM'
        nodePath = $nodePath
        npmPath = $npmPath
        npmCliPath = $npmCliPath
        gitPath = $gitPath
        installedAt = [DateTime]::UtcNow.ToString('o')
    }
    Write-MccInstallerJson -LiteralPath $configurationPath -Value $configuration

    $script:InstallerBootstrapStage = 'BOOTSTRAP ACL PHASE - atomic status installation'
    $modeValue = if ($Mode -eq 'WindowsTest') { 'windows_test' } else { 'windows_production' }
    $timestamp = [DateTime]::UtcNow.ToString('o')
    Write-MccInstallerJson -LiteralPath (Join-Path $updaterRoot 'status\status.json') -Value ([ordered]@{
        schemaVersion = 1
        jobId = $null
        state = 'idle'
        code = 'not_checked'
        message = 'Check the approved Administrator-configured branch for MCC updates.'
        mode = $modeValue
        environmentLabel = $environmentLabel
        installed = [ordered]@{ version = $applicationVersion; commit = $applicationCommit }
        target = [ordered]@{ version = $null; commit = $null }
        requestedAt = $null
        startedAt = $null
        lastUpdatedAt = $timestamp
        completedAt = $null
        requester = $null
        outcome = 'none'
        finalResult = 'none'
        checkToken = $null
        checkExpiresAt = $null
        events = @()
    })

    $script:InstallerBootstrapStage = 'BOOTSTRAP ACL PHASE - elevated write and read verification'
    Invoke-MccBootstrapVerification -InstalledScriptNames $scriptNames -SourceDirectory $PSScriptRoot
    Write-MccInstallerLog -Message 'Bootstrap ACL write/read verification passed before scheduled-task creation.'

    $script:InstallerBootstrapStage = 'FINAL ACL PHASE - updater tree'
    $readExecute = [Security.AccessControl.FileSystemRights]::ReadAndExecute
    $readOnly = [Security.AccessControl.FileSystemRights]::Read
    $modify = [Security.AccessControl.FileSystemRights]::Modify
    Set-MccFinalAclProfile -LiteralPath $updaterRoot -LocalServiceRights $readExecute -Recurse
    Set-MccFinalAclProfile -LiteralPath (Join-Path $updaterRoot 'scripts') -LocalServiceRights $readExecute -Recurse
    Set-MccFinalAclProfile -LiteralPath (Join-Path $updaterRoot 'request') -LocalServiceRights $modify -Recurse
    Set-MccFinalAclProfile -LiteralPath (Join-Path $updaterRoot 'status') -LocalServiceRights $readExecute -Recurse
    Set-MccFinalAclProfile -LiteralPath (Join-Path $updaterRoot 'web-logs') -LocalServiceRights $modify -Recurse
    Set-MccFinalAclProfile -LiteralPath (Join-Path $updaterRoot 'logs') -Recurse
    Set-MccFinalAclProfile -LiteralPath (Join-Path $updaterRoot 'backups') -Recurse
    Set-MccFinalAclProfile -LiteralPath $configurationPath -LocalServiceRights $readOnly

    $script:InstallerBootstrapStage = 'FINAL ACL PHASE - verification'
    Assert-MccFinalAclProfile -LiteralPath $updaterRoot -LocalServiceRights $readExecute
    Assert-MccFinalAclProfile -LiteralPath (Join-Path $updaterRoot 'scripts') -LocalServiceRights $readExecute -Recurse
    Assert-MccFinalAclProfile -LiteralPath (Join-Path $updaterRoot 'request') -LocalServiceRights $modify -Recurse
    Assert-MccFinalAclProfile -LiteralPath (Join-Path $updaterRoot 'status') -LocalServiceRights $readExecute -Recurse
    Assert-MccFinalAclProfile -LiteralPath (Join-Path $updaterRoot 'web-logs') -LocalServiceRights $modify -Recurse
    Assert-MccFinalAclProfile -LiteralPath (Join-Path $updaterRoot 'logs') -Recurse
    Assert-MccFinalAclProfile -LiteralPath (Join-Path $updaterRoot 'backups') -Recurse
    Assert-MccFinalAclProfile -LiteralPath $configurationPath -LocalServiceRights $readOnly
    Assert-MccFinalUpdaterTree
    Write-MccInstallerLog -Message 'Final exact ACL verification passed for Administrators, SYSTEM, LOCAL SERVICE, Users, and Everyone.'

    $script:InstallerBootstrapStage = 'application runtime directory preparation'
    Set-MccApplicationRuntimeAcl
    Write-MccInstallerLog -Message 'Bounded application ACL preparation completed without recursive repository traversal.'

    $script:InstallerBootstrapStage = 'dependency installation and application build'
    Invoke-MccProcess -FilePath $nodePath -ArgumentList @($npmCliPath, 'ci', '--prefix', 'frontend') -WorkingDirectory $applicationPath -TimeoutSeconds 900 -DetailedLogPath $installLog | Out-Null
    Invoke-MccProcess -FilePath $nodePath -ArgumentList @($npmCliPath, 'ci', '--prefix', 'backend') -WorkingDirectory $applicationPath -TimeoutSeconds 900 -DetailedLogPath $installLog | Out-Null
    Invoke-MccProcess -FilePath $nodePath -ArgumentList @($npmCliPath, 'run', 'build') -WorkingDirectory $applicationPath -TimeoutSeconds 900 -DetailedLogPath $installLog | Out-Null

    $script:InstallerBootstrapStage = 'application ACL finalization and verification'
    Set-MccApplicationRuntimeAcl
    Assert-MccApplicationRuntimeAcl
    Write-MccInstallerLog -Message 'Effective LOCAL SERVICE access was verified for built assets, package manifests, Git metadata, and runtime directories.'

    $script:InstallerBootstrapStage = 'scheduled-task snapshot'
    foreach ($taskName in $taskNames) {
        $existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        if ($null -ne $existingTask) {
            $taskSnapshots[$taskName] = [ordered]@{
                Xml = Export-ScheduledTask -TaskName $taskName
                WasRunning = [string]$existingTask.State -eq 'Running'
            }
        }
    }

    $powerShellPath = Join-Path $PSHOME 'powershell.exe'
    $managedConfigPath = Join-Path $updaterRoot 'config.json'
    $mccScriptPath = Join-Path $updaterRoot 'scripts\Start-MccWindowsWeb.ps1'
    $agentScriptPath = Join-Path $updaterRoot 'scripts\Start-MccWindowsAgent.ps1'
    $mccAction = New-ScheduledTaskAction -Execute $powerShellPath -Argument "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File `"$mccScriptPath`" -ConfigurationPath `"$managedConfigPath`""
    $agentAction = New-ScheduledTaskAction -Execute $powerShellPath -Argument "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File `"$agentScriptPath`" -ConfigurationPath `"$managedConfigPath`""
    $startupTrigger = New-ScheduledTaskTrigger -AtStartup
    $taskSettings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -ExecutionTimeLimit ([TimeSpan]::Zero) `
        -MultipleInstances IgnoreNew `
        -RestartCount 999 `
        -RestartInterval (New-TimeSpan -Minutes 1) `
        -StartWhenAvailable
    $mccPrincipal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\LOCAL SERVICE' -LogonType ServiceAccount -RunLevel Limited
    $agentPrincipal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\SYSTEM' -LogonType ServiceAccount -RunLevel Highest

    $script:InstallerBootstrapStage = 'scheduled-task registration after bootstrap verification'
    $tasksChanged = $true
    $previousManagedLaunchId = ''
    $existingProcessRecordPath = Join-Path $updaterRoot 'web-logs\mcc-process.json'
    if (Test-Path -LiteralPath $existingProcessRecordPath -PathType Leaf) {
        try {
            $existingProcessRecord = Read-MccJson -LiteralPath $existingProcessRecordPath
            $existingLaunchGuid = [Guid]::Empty
            if ([Guid]::TryParse([string]$existingProcessRecord.launchId, [ref]$existingLaunchGuid)) {
                $previousManagedLaunchId = $existingLaunchGuid.ToString()
            }
        } catch {}
    }
    Stop-MccInstallerManagedRuntime `
        -ApplicationPath $applicationPath `
        -NodePath $nodePath `
        -UpdaterRoot $updaterRoot `
        -TaskName $constants.MccTaskName `
        -Port $constants.Port
    if (Get-ScheduledTask -TaskName $constants.UpdaterTaskName -ErrorAction SilentlyContinue) {
        Stop-ScheduledTask -TaskName $constants.UpdaterTaskName -ErrorAction Stop
        $updaterStopDeadline = [DateTime]::UtcNow.AddSeconds(30)
        do {
            $existingUpdaterTask = Get-ScheduledTask -TaskName $constants.UpdaterTaskName -ErrorAction SilentlyContinue
            if ($null -eq $existingUpdaterTask -or [string]$existingUpdaterTask.State -ne 'Running') { break }
            Start-Sleep -Milliseconds 500
        } while ([DateTime]::UtcNow -lt $updaterStopDeadline)
        if ($null -ne $existingUpdaterTask -and [string]$existingUpdaterTask.State -eq 'Running') {
            throw 'The existing MCC updater scheduled task did not stop before reinstall.'
        }
    }
    Register-ScheduledTask -TaskName $constants.MccTaskName -Action $mccAction -Trigger $startupTrigger -Settings $taskSettings -Principal $mccPrincipal -Description 'Managed Maintenance Command Center web application on port 4273.' -Force | Out-Null
    Register-ScheduledTask -TaskName $constants.UpdaterTaskName -Action $agentAction -Trigger $startupTrigger -Settings $taskSettings -Principal $agentPrincipal -Description 'Privileged fixed-request Maintenance Command Center updater agent.' -Force | Out-Null

    $script:InstallerBootstrapStage = 'managed-task startup and health verification'
    $managedStartupRequestedAt = [DateTime]::UtcNow
    Start-ScheduledTask -TaskName $constants.UpdaterTaskName
    Start-ScheduledTask -TaskName $constants.MccTaskName
    if (-not (Test-MccHttpHealth -Port $constants.Port -TimeoutSeconds 120)) {
        throw 'MCC did not pass the port 4273 health check after managed startup.'
    }

    $healthPath = Join-Path $updaterRoot 'status\agent-health.json'
    $agentDeadline = [DateTime]::UtcNow.AddSeconds(60)
    $agentHealth = $null
    do {
        if (Test-Path -LiteralPath $healthPath -PathType Leaf) {
            $agentHealth = Read-MccJson -LiteralPath $healthPath
            if ($agentHealth.agentHealthy -eq $true -and
                $agentHealth.configurationValid -eq $true -and
                $agentHealth.repositoryValid -eq $true -and
                $agentHealth.branchValid -eq $true -and
                $agentHealth.requestDirectoryAccessible -eq $true -and
                $agentHealth.statusDirectoryAccessible -eq $true -and
                $agentHealth.mccTaskInstalled -eq $true -and
                $agentHealth.mccTaskRunning -eq $true -and
                $agentHealth.updaterTaskInstalled -eq $true -and
                $agentHealth.updaterTaskRunning -eq $true -and
                [string]$agentHealth.deploymentMode -eq $Mode) {
                break
            }
        }
        Start-Sleep -Seconds 2
    } while ([DateTime]::UtcNow -lt $agentDeadline)
    if ($null -eq $agentHealth -or
        $agentHealth.agentHealthy -ne $true -or
        $agentHealth.configurationValid -ne $true -or
        $agentHealth.applicationPathMatches -ne $true -or
        $agentHealth.repositoryValid -ne $true -or
        $agentHealth.branchValid -ne $true -or
        $agentHealth.requestDirectoryAccessible -ne $true -or
        $agentHealth.statusDirectoryAccessible -ne $true -or
        $agentHealth.mccTaskInstalled -ne $true -or
        $agentHealth.mccTaskRunning -ne $true -or
        $agentHealth.updaterTaskInstalled -ne $true -or
        $agentHealth.updaterTaskRunning -ne $true -or
        [string]$agentHealth.deploymentMode -cne $Mode) {
        throw 'The Windows updater agent did not publish a fully healthy deployment heartbeat.'
    }

    $script:InstallerBootstrapStage = 'protected API verification'
    $statusProbe = Invoke-MccHttpJsonProbe `
        -Uri "http://127.0.0.1:$($constants.Port)/api/system/update/status" `
        -TimeoutSeconds 10 `
        -AllowedFailureStatusCodes @(401)
    if ([int]$statusProbe.statusCode -ne 401) {
        throw 'The protected update status API did not reject the unauthenticated installer probe.'
    }

    $script:InstallerBootstrapStage = 'managed launcher identity and updater readiness verification'
    $installedConfiguration = Read-MccWindowsConfiguration -ConfigurationPath $managedConfigPath
    $configurationValid =
        (Get-MccNormalizedPath -LiteralPath ([string]$installedConfiguration.applicationPath)).Equals($applicationPath, [StringComparison]::OrdinalIgnoreCase) -and
        [string]$installedConfiguration.repository -ceq $constants.Repository -and
        [string]$installedConfiguration.remote -ceq $constants.Remote -and
        [string]$installedConfiguration.branch -ceq $configuredBranch -and
        [string]$installedConfiguration.deploymentMode -ceq $Mode -and
        [int]$installedConfiguration.port -eq $constants.Port -and
        [string]$installedConfiguration.mccTaskName -ceq $constants.MccTaskName -and
        [string]$installedConfiguration.updaterTaskName -ceq $constants.UpdaterTaskName -and
        [string]$installedConfiguration.serviceIdentity -ceq 'NT AUTHORITY\LOCAL SERVICE' -and
        [string]$installedConfiguration.agentIdentity -ceq 'NT AUTHORITY\SYSTEM' -and
        (Get-MccNormalizedPath -LiteralPath ([string]$installedConfiguration.nodePath)).Equals((Get-MccNormalizedPath -LiteralPath $nodePath), [StringComparison]::OrdinalIgnoreCase)
    if (-not $configurationValid) {
        throw 'The installed protected updater configuration does not exactly match the requested deployment.'
    }
    Assert-MccRepository -ApplicationPath $applicationPath -ExpectedBranch $configuredBranch -RequireClean
    Assert-MccOriginBranch -ApplicationPath $applicationPath -Branch $configuredBranch
    $expectedVersion = Get-MccPackageVersion -ApplicationPath $applicationPath
    $expectedFullCommit = (Invoke-MccGit -ApplicationPath $applicationPath -ArgumentList @('rev-parse', 'HEAD')).StandardOutput.ToLowerInvariant()
    if ($expectedVersion -cne $applicationVersion -or $expectedFullCommit -cne $applicationCommit) {
        throw 'The installed MCC package version or commit changed during updater installation.'
    }
    $mccTask = Get-ScheduledTask -TaskName $constants.MccTaskName -ErrorAction Stop
    $updaterTask = Get-ScheduledTask -TaskName $constants.UpdaterTaskName -ErrorAction Stop
    $mccTaskIdentityMatches = Test-MccScheduledTaskIdentity -Task $mccTask -ExpectedSid 'S-1-5-19'
    $updaterTaskIdentityMatches = Test-MccScheduledTaskIdentity -Task $updaterTask -ExpectedSid 'S-1-5-18'
    if ([string]$mccTask.State -ne 'Running' -or [string]$updaterTask.State -ne 'Running' -or
        -not $mccTaskIdentityMatches -or -not $updaterTaskIdentityMatches) {
        throw 'The protected MCC scheduled tasks are not running under their required service identities.'
    }
    $processRecord = Read-MccJson -LiteralPath (Join-Path $updaterRoot 'web-logs\mcc-process.json')
    $managedProcessId = 0
    $currentLaunchGuid = [Guid]::Empty
    $processStartedAt = [DateTime]::MinValue
    if (-not [int]::TryParse([string]$processRecord.processId, [ref]$managedProcessId) -or $managedProcessId -le 0 -or
        -not [Guid]::TryParse([string]$processRecord.launchId, [ref]$currentLaunchGuid) -or
        ($previousManagedLaunchId -and $currentLaunchGuid.ToString() -ceq $previousManagedLaunchId) -or
        -not [DateTime]::TryParse([string]$processRecord.startedAt, [ref]$processStartedAt) -or
        $processStartedAt.ToUniversalTime() -lt $managedStartupRequestedAt.AddSeconds(-2) -or
        $processRecord.applicationMatchesConfiguration -ne $true -or
        -not (Get-MccNormalizedPath -LiteralPath ([string]$processRecord.applicationPath)).Equals($applicationPath, [StringComparison]::OrdinalIgnoreCase) -or
        -not (Get-MccNormalizedPath -LiteralPath ([string]$processRecord.entryPoint)).Equals((Get-MccNormalizedPath -LiteralPath (Join-Path $applicationPath 'backend\dist\server\index.js')), [StringComparison]::OrdinalIgnoreCase) -or
        -not (Get-MccNormalizedPath -LiteralPath ([string]$processRecord.nodePath)).Equals((Get-MccNormalizedPath -LiteralPath $nodePath), [StringComparison]::OrdinalIgnoreCase) -or
        -not (Get-MccNormalizedPath -LiteralPath ([string]$processRecord.configurationPath)).Equals((Get-MccNormalizedPath -LiteralPath $managedConfigPath), [StringComparison]::OrdinalIgnoreCase) -or
        [string]$processRecord.managedEnvironment.updateMode -cne 'windows_agent' -or
        [string]$processRecord.managedEnvironment.nodeEnvironment -cne 'production') {
        throw 'The managed launcher did not publish a valid protected process record after installation.'
    }
    $processDetails = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $managedProcessId" -ErrorAction SilentlyContinue
    $expectedNodePath = Get-MccNormalizedPath -LiteralPath $nodePath
    $expectedEntryPoint = Get-MccNormalizedPath -LiteralPath (Join-Path $applicationPath 'backend\dist\server\index.js')
    $actualNodePath = if ($null -ne $processDetails) { Get-MccNormalizedPath -LiteralPath ([string]$processDetails.ExecutablePath) } else { '' }
    $actualCommandLine = if ($null -ne $processDetails) { ([string]$processDetails.CommandLine).Replace('"', '') } else { '' }
    $nodeExecutableMatches = $null -ne $processDetails -and $actualNodePath.Equals($expectedNodePath, [StringComparison]::OrdinalIgnoreCase)
    $backendCommandLineMatches = $null -ne $processDetails -and $actualCommandLine.IndexOf($expectedEntryPoint, [StringComparison]::OrdinalIgnoreCase) -ge 0
    if (-not $nodeExecutableMatches -or -not $backendCommandLineMatches) {
        throw 'The recorded managed MCC PID does not identify the configured Node.js backend process.'
    }
    $listeners = @(Get-NetTCPConnection -LocalPort $constants.Port -State Listen -ErrorAction SilentlyContinue)
    if ($listeners.Count -ne 1 -or [int]$listeners[0].OwningProcess -ne $managedProcessId) {
        throw 'The recorded managed MCC process does not exclusively own port 4273 after installation.'
    }
    $healthProbe = Invoke-MccHttpJsonProbe -Uri "http://127.0.0.1:$($constants.Port)/api/health" -TimeoutSeconds 10
    $health = $healthProbe.payload
    if ([int]$healthProbe.statusCode -ne 200 -or $health.ok -ne $true -or
        [string]$health.app -cne 'Maintenance Command Center' -or [int]$health.port -ne $constants.Port) {
        throw 'The managed MCC health payload does not match the protected installation.'
    }
    $readinessProbe = Invoke-MccHttpJsonProbe `
        -Uri "http://127.0.0.1:$($constants.Port)/api/system/update/managed-readiness" `
        -TimeoutSeconds 10 `
        -AllowedFailureStatusCodes @(404) `
        -RequireFailureJson
    $expectedMode = if ($Mode -eq 'WindowsTest') { 'windows_test' } else { 'windows_production' }
    if ([int]$readinessProbe.statusCode -eq 200) {
        Assert-MccManagedReadinessPayload `
            -Payload $readinessProbe.payload `
            -ExpectedMode $expectedMode `
            -ExpectedEnvironmentLabel $environmentLabel `
            -ExpectedBranch $configuredBranch `
            -ExpectedVersion $expectedVersion `
            -ExpectedCommit $expectedFullCommit `
            -ExpectedPort $constants.Port
    } elseif ([int]$readinessProbe.statusCode -eq 404) {
        Assert-MccLegacyManagedRuntimeEvidence -Evidence ([ordered]@{
            verificationContext = 'InstallerBootstrap'
            readinessStatusCode = [int]$readinessProbe.statusCode
            installedVersion = $expectedVersion
            configurationValid = $configurationValid
            applicationPathMatches = $true
            originMatches = $true
            branchMatches = $true
            packageVersionMatches = $expectedVersion -ceq $applicationVersion
            commitMatches = $expectedFullCommit -ceq $applicationCommit
            repositoryClean = $true
            mccTaskInstalled = $null -ne $mccTask
            mccTaskRunning = [string]$mccTask.State -eq 'Running'
            mccTaskIdentityMatches = $mccTaskIdentityMatches
            updaterTaskInstalled = $null -ne $updaterTask
            updaterTaskRunning = [string]$updaterTask.State -eq 'Running'
            updaterTaskIdentityMatches = $updaterTaskIdentityMatches
            agentHealthy = $agentHealth.agentHealthy -eq $true
            agentConfigurationValid = $agentHealth.configurationValid -eq $true
            agentRepositoryValid = $agentHealth.repositoryValid -eq $true
            agentBranchValid = $agentHealth.branchValid -eq $true
            agentApplicationPathMatches = $agentHealth.applicationPathMatches -eq $true
            requestDirectoryAccessible = $agentHealth.requestDirectoryAccessible -eq $true
            statusDirectoryAccessible = $agentHealth.statusDirectoryAccessible -eq $true
            processRecordExists = $null -ne $processRecord
            launchIdValid = $currentLaunchGuid -ne [Guid]::Empty
            launchIdDistinct = -not $previousManagedLaunchId -or $currentLaunchGuid.ToString() -cne $previousManagedLaunchId
            processApplicationMatchesConfiguration = $processRecord.applicationMatchesConfiguration -eq $true
            processUpdateModeMatches = [string]$processRecord.managedEnvironment.updateMode -ceq 'windows_agent'
            processNodeEnvironmentMatches = [string]$processRecord.managedEnvironment.nodeEnvironment -ceq 'production'
            pidRunning = $null -ne $processDetails
            nodeExecutableMatches = $nodeExecutableMatches
            backendCommandLineMatches = $backendCommandLineMatches
            exclusivePortOwner = $listeners.Count -eq 1 -and [int]$listeners[0].OwningProcess -eq $managedProcessId
            healthOk = $health.ok -eq $true
            healthApplicationMatches = [string]$health.app -ceq 'Maintenance Command Center'
            healthPortMatches = [int]$health.port -eq $constants.Port
            updateStatusUnauthorized = [int]$statusProbe.statusCode -eq 401
        })
        Write-MccInstallerLog -Message 'Legacy managed-readiness compatibility verification passed for an installed MCC version predating the managed-readiness endpoint.'
    } else {
        throw 'The managed MCC readiness endpoint returned an unsupported response.'
    }

    $tasksChanged = $false
    Write-MccInstallerLog -Message "$environmentLabel installation on origin/$configuredBranch completed and health checks passed."
    Write-Output ''
    Write-Output 'MCC Windows updater installation complete.'
    Write-Output "Mode: $environmentLabel"
    Write-Output "Configured update branch: origin/$configuredBranch"
    Write-Output "MCC task: $($constants.MccTaskName) (LOCAL SERVICE)"
    Write-Output "Updater task: $($constants.UpdaterTaskName) (SYSTEM)"
    Write-Output "Protected updater data: $updaterRoot"
    Write-Output "Backups: $(Join-Path $updaterRoot 'backups')"
    Write-Output "MCC health: http://127.0.0.1:$($constants.Port)/"
    Write-Output 'Settings detection: protected configuration and a healthy updater-agent heartbeat were verified.'
} catch {
    $originalMessage = $_.Exception.Message
    [Console]::Error.WriteLine("MCC Windows updater failed at exact bootstrap stage '$script:InstallerBootstrapStage'.")
    [Console]::Error.WriteLine("Original exception: $originalMessage")
    Write-MccInstallerLog -Message "INSTALLATION FAILED at exact bootstrap stage '$script:InstallerBootstrapStage': $originalMessage"
    if ($tasksChanged) {
        try {
            Restore-MccScheduledTasks -Snapshots $taskSnapshots -TaskNames $taskNames -ApplicationPath $applicationPath -NodePath $nodePath -UpdaterRoot $updaterRoot
            [Console]::Error.WriteLine('Scheduled-task state was rolled back; no partial task installation was retained.')
        } catch {
            [Console]::Error.WriteLine("Scheduled-task rollback failed and requires manual inspection: $($_.Exception.Message)")
        }
    }
    throw
}
