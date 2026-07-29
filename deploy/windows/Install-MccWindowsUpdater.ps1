<#
.SYNOPSIS
Installs the managed Maintenance Command Center Windows updater.

.DESCRIPTION
Validates one explicit clean main-branch MCC Git clone, Node.js 22+, npm, Git,
locked dependency manifests, and port 4273. It installs two fixed scheduled tasks:
MaintenanceCommandCenter runs as LOCAL SERVICE and
MaintenanceCommandCenterUpdater runs as SYSTEM. Protected configuration, scripts,
requests, status, logs, locks, and backups are stored under ProgramData.

.PARAMETER MccPath
The dedicated Windows MCC installation clone. F: is always rejected.

.PARAMETER Mode
WindowsTest or WindowsProduction. The browser cannot select or change this value.

.PARAMETER Port
The fixed MCC port. Only 4273 is accepted.
#>
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [Parameter(Mandatory = $true)]
    [string]$MccPath,

    [Parameter(Mandatory = $true)]
    [ValidateSet('WindowsTest', 'WindowsProduction')]
    [string]$Mode,

    [ValidateRange(1, 65535)]
    [int]$Port = 4273
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

Import-Module (Join-Path $PSScriptRoot 'MccWindowsUpdater.Common.psm1') -Force
Assert-MccAdministrator
$constants = Get-MccUpdaterConstants
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

Assert-MccRepository -ApplicationPath $applicationPath -RequireClean
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

if (-not $PSCmdlet.ShouldProcess($applicationPath, "Install $Mode managed Windows updater and startup tasks")) {
    return
}

$updaterRoot = $constants.UpdaterRoot
$directories = @(
    $updaterRoot,
    (Join-Path $updaterRoot 'scripts'),
    (Join-Path $updaterRoot 'request'),
    (Join-Path $updaterRoot 'status'),
    (Join-Path $updaterRoot 'logs'),
    (Join-Path $updaterRoot 'web-logs'),
    (Join-Path $updaterRoot 'backups')
)
foreach ($directory in $directories) {
    [System.IO.Directory]::CreateDirectory($directory) | Out-Null
}
$installLog = Join-Path $updaterRoot 'logs\install.log'
Add-Content -LiteralPath $installLog -Value "[$([DateTime]::UtcNow.ToString('o'))] Starting $Mode installation for the validated MCC clone." -Encoding utf8

$scriptNames = @(
    'MccWindowsUpdater.Common.psm1',
    'Start-MccWindowsWeb.ps1',
    'Start-MccWindowsAgent.ps1',
    'Update-MccWindows.ps1',
    'Test-MccWindowsUpdater.ps1',
    'Uninstall-MccWindowsUpdater.ps1'
)
foreach ($scriptName in $scriptNames) {
    $source = Join-Path $PSScriptRoot $scriptName
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "The checked-in Windows deployment package is incomplete: $scriptName"
    }
    Copy-Item -LiteralPath $source -Destination (Join-Path $updaterRoot "scripts\$scriptName") -Force
    Unblock-File -LiteralPath (Join-Path $updaterRoot "scripts\$scriptName") -ErrorAction SilentlyContinue
}

$configurationPath = Join-Path $updaterRoot 'config.json'
$configuration = [ordered]@{
    schemaVersion = 1
    deploymentMode = $Mode
    applicationPath = $applicationPath
    repository = $constants.Repository
    remote = $constants.Remote
    branch = $constants.Branch
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
Write-MccAtomicJson -LiteralPath $configurationPath -Value $configuration

$environmentLabel = if ($Mode -eq 'WindowsTest') { 'WINDOWS TEST MODE' } else { 'WINDOWS 11 PRODUCTION' }
$modeValue = if ($Mode -eq 'WindowsTest') { 'windows_test' } else { 'windows_production' }
$timestamp = [DateTime]::UtcNow.ToString('o')
Write-MccAtomicJson -LiteralPath (Join-Path $updaterRoot 'status\status.json') -Value ([ordered]@{
    schemaVersion = 1
    jobId = $null
    state = 'idle'
    code = 'not_checked'
    message = 'Check the approved origin/main branch for MCC updates.'
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

foreach ($runtimeDirectory in @('backend\data', 'backend\uploads', 'backend\documents', 'backend\files')) {
    [System.IO.Directory]::CreateDirectory((Join-Path $applicationPath $runtimeDirectory)) | Out-Null
}

function Set-MccAcl {
    param(
        [Parameter(Mandatory = $true)][string]$LiteralPath,
        [Parameter(Mandatory = $true)][string[]]$Grants,
        [switch]$Recurse
    )
    $arguments = @($LiteralPath, '/inheritance:r', '/grant:r') + $Grants
    if ($Recurse) { $arguments += @('/T', '/C') }
    Invoke-MccProcess -FilePath 'icacls.exe' -ArgumentList $arguments -WorkingDirectory $updaterRoot -TimeoutSeconds 300 -DetailedLogPath $installLog | Out-Null
}

$administrativeGrants = @('*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F')
Set-MccAcl -LiteralPath $updaterRoot -Grants ($administrativeGrants + '*S-1-5-19:(OI)(CI)RX') -Recurse
Set-MccAcl -LiteralPath (Join-Path $updaterRoot 'request') -Grants ($administrativeGrants + '*S-1-5-19:(OI)(CI)M') -Recurse
Set-MccAcl -LiteralPath (Join-Path $updaterRoot 'status') -Grants ($administrativeGrants + '*S-1-5-19:(OI)(CI)RX') -Recurse
Set-MccAcl -LiteralPath (Join-Path $updaterRoot 'web-logs') -Grants ($administrativeGrants + '*S-1-5-19:(OI)(CI)M') -Recurse
Set-MccAcl -LiteralPath (Join-Path $updaterRoot 'scripts') -Grants ($administrativeGrants + '*S-1-5-19:(OI)(CI)RX') -Recurse
Set-MccAcl -LiteralPath (Join-Path $updaterRoot 'logs') -Grants $administrativeGrants -Recurse
Set-MccAcl -LiteralPath (Join-Path $updaterRoot 'backups') -Grants $administrativeGrants -Recurse
Set-MccAcl -LiteralPath $configurationPath -Grants @('*S-1-5-18:F', '*S-1-5-32-544:F', '*S-1-5-19:R')

Invoke-MccProcess -FilePath 'icacls.exe' -ArgumentList @($applicationPath, '/grant', '*S-1-5-19:(OI)(CI)RX', '/T', '/C') -WorkingDirectory $applicationPath -TimeoutSeconds 600 -DetailedLogPath $installLog | Out-Null
foreach ($runtimeDirectory in @('backend\data', 'backend\uploads', 'backend\documents', 'backend\files')) {
    Invoke-MccProcess -FilePath 'icacls.exe' -ArgumentList @((Join-Path $applicationPath $runtimeDirectory), '/grant', '*S-1-5-19:(OI)(CI)M', '/T', '/C') -WorkingDirectory $applicationPath -TimeoutSeconds 300 -DetailedLogPath $installLog | Out-Null
}
foreach ($environmentFile in @('.env', 'backend\.env')) {
    $environmentPath = Join-Path $applicationPath $environmentFile
    if (Test-Path -LiteralPath $environmentPath -PathType Leaf) {
        Invoke-MccProcess -FilePath 'icacls.exe' -ArgumentList @($environmentPath, '/grant', '*S-1-5-19:R') -WorkingDirectory $applicationPath -TimeoutSeconds 60 -DetailedLogPath $installLog | Out-Null
    }
}

foreach ($protectedPath in @(
    $updaterRoot,
    (Join-Path $updaterRoot 'request'),
    (Join-Path $updaterRoot 'status'),
    (Join-Path $updaterRoot 'scripts'),
    (Join-Path $updaterRoot 'logs'),
    (Join-Path $updaterRoot 'backups'),
    $configurationPath
)) {
    $broadWriteRule = (Get-Acl -LiteralPath $protectedPath).Access | Where-Object {
        $_.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
        $_.IdentityReference.Value -match '(^|\\)(Everyone|Users)$|S-1-1-0|S-1-5-32-545' -and
        ($_.FileSystemRights -band (
            [Security.AccessControl.FileSystemRights]::WriteData -bor
            [Security.AccessControl.FileSystemRights]::CreateDirectories -bor
            [Security.AccessControl.FileSystemRights]::Modify -bor
            [Security.AccessControl.FileSystemRights]::FullControl
        ))
    }
    if ($broadWriteRule) {
        throw 'Final ACL verification found broad write access on a protected updater path.'
    }
}
$localServiceScriptWrite = (Get-Acl -LiteralPath (Join-Path $updaterRoot 'scripts')).Access | Where-Object {
    $_.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
    $_.IdentityReference.Value -match 'LOCAL SERVICE|S-1-5-19' -and
    ($_.FileSystemRights -band ([Security.AccessControl.FileSystemRights]::Modify -bor [Security.AccessControl.FileSystemRights]::FullControl))
}
if ($localServiceScriptWrite) {
    throw 'Final ACL verification found MCC service write access to protected updater scripts.'
}
$rootAclText = (Get-Acl -LiteralPath $updaterRoot).Access | ForEach-Object {
    "$($_.IdentityReference.Value):$($_.FileSystemRights):$($_.AccessControlType)"
}
if (-not ($rootAclText -match 'SYSTEM|S-1-5-18') -or
    -not ($rootAclText -match 'Administrators|S-1-5-32-544')) {
    throw 'Final ACL verification did not find the required SYSTEM and Administrators grants.'
}

Invoke-MccProcess -FilePath $nodePath -ArgumentList @($npmCliPath, 'ci', '--prefix', 'frontend') -WorkingDirectory $applicationPath -TimeoutSeconds 900 -DetailedLogPath $installLog | Out-Null
Invoke-MccProcess -FilePath $nodePath -ArgumentList @($npmCliPath, 'ci', '--prefix', 'backend') -WorkingDirectory $applicationPath -TimeoutSeconds 900 -DetailedLogPath $installLog | Out-Null
Invoke-MccProcess -FilePath $nodePath -ArgumentList @($npmCliPath, 'run', 'build') -WorkingDirectory $applicationPath -TimeoutSeconds 900 -DetailedLogPath $installLog | Out-Null

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

foreach ($taskName in @($constants.MccTaskName, $constants.UpdaterTaskName)) {
    if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
        Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    }
}
Register-ScheduledTask -TaskName $constants.MccTaskName -Action $mccAction -Trigger $startupTrigger -Settings $taskSettings -Principal $mccPrincipal -Description 'Managed Maintenance Command Center web application on port 4273.' -Force | Out-Null
Register-ScheduledTask -TaskName $constants.UpdaterTaskName -Action $agentAction -Trigger $startupTrigger -Settings $taskSettings -Principal $agentPrincipal -Description 'Privileged fixed-request Maintenance Command Center updater agent.' -Force | Out-Null

Start-ScheduledTask -TaskName $constants.UpdaterTaskName
Start-ScheduledTask -TaskName $constants.MccTaskName
if (-not (Test-MccHttpHealth -Port $constants.Port -TimeoutSeconds 120)) {
    throw 'MCC did not pass the port 4273 health check after managed startup.'
}

$healthPath = Join-Path $updaterRoot 'status\agent-health.json'
$agentDeadline = [DateTime]::UtcNow.AddSeconds(60)
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
            [string]$agentHealth.deploymentMode -eq $Mode) {
            break
        }
    }
    Start-Sleep -Seconds 2
} while ([DateTime]::UtcNow -lt $agentDeadline)
if (-not (Test-Path -LiteralPath $healthPath -PathType Leaf) -or
    $agentHealth.agentHealthy -ne $true -or
    $agentHealth.mccTaskRunning -ne $true) {
    throw 'The Windows updater agent did not publish a fully healthy deployment heartbeat.'
}

$protectedApiRejected = $false
try {
    Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$($constants.Port)/api/system/update/status" -Method Get -TimeoutSec 10 | Out-Null
} catch {
    if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 401) {
        $protectedApiRejected = $true
    }
}
if (-not $protectedApiRejected) {
    throw 'The protected update status API did not reject the unauthenticated installer probe.'
}

Add-Content -LiteralPath $installLog -Value "[$([DateTime]::UtcNow.ToString('o'))] Installation completed and health checks passed." -Encoding utf8
Write-Output ''
Write-Output 'MCC Windows updater installation complete.'
Write-Output "Mode: $environmentLabel"
Write-Output "MCC task: $($constants.MccTaskName) (LOCAL SERVICE)"
Write-Output "Updater task: $($constants.UpdaterTaskName) (SYSTEM)"
Write-Output "Protected updater data: $updaterRoot"
Write-Output "Backups: $(Join-Path $updaterRoot 'backups')"
Write-Output "MCC health: http://127.0.0.1:$($constants.Port)/"
Write-Output 'Settings detection: protected configuration and a healthy updater-agent heartbeat were verified.'
