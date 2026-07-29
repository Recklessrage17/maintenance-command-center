import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const installerPath = 'deploy/windows/Install-MccWindowsUpdater.ps1';
const commonPath = 'deploy/windows/MccWindowsUpdater.Common.psm1';
const installedTestPath = 'deploy/windows/Test-MccWindowsUpdater.ps1';
const readmePath = 'deploy/windows/README-Windows-Updater.md';
const atomicReplacementTestPath = 'tests/windows-updater-atomic-replacement.ps1';

const installer = fs.readFileSync(installerPath, 'utf8');
const common = fs.readFileSync(commonPath, 'utf8');
const installedTest = fs.readFileSync(installedTestPath, 'utf8');
const readme = fs.readFileSync(readmePath, 'utf8');

function functionSource(source, name, nextName) {
  const start = source.indexOf(`function ${name} {`);
  assert.notEqual(start, -1, `Missing PowerShell function ${name}.`);
  const end = nextName ? source.indexOf(`function ${nextName} {`, start) : source.length;
  assert.notEqual(end, -1, `Could not bound PowerShell function ${name}.`);
  return source.slice(start, end);
}

const repairFunction = functionSource(installer, 'Repair-MccUpdaterAcl', 'Enable-MccBootstrapItemAcl');
const atomicFileFunction = functionSource(installer, 'Install-MccAtomicFile', 'Write-MccInstallerAtomicText');
const finalAclFunction = functionSource(installer, 'Set-MccFinalAclItem', 'Set-MccFinalAclProfile');
const bootstrapVerification = functionSource(installer, 'Invoke-MccBootstrapVerification', 'New-MccAccessRule');
const installFlow = installer.slice(installer.indexOf('$tasksChanged = $false'));

const scenarios = [
  ['clean first installation', () => {
    assert.match(installFlow, /Repair-MccUpdaterAcl[\s\S]*Directory\]::CreateDirectory[\s\S]*Repair-MccUpdaterAcl/);
    assert.match(repairFunction, /Directory\]::CreateDirectory\(\$updaterRoot\)/);
  }],
  ['existing root folder', () => {
    assert.match(repairFunction, /\/grant:r/);
    assert.match(repairFunction, /\/inheritance:e/);
    assert.ok(installFlow.indexOf('Repair-MccUpdaterAcl') < installFlow.indexOf('$script:InstallerLogPath = $installLog'));
  }],
  ['broken install.log ACL', () => {
    assert.ok(installFlow.indexOf('Repair-MccUpdaterAcl') < installFlow.indexOf('Write-MccInstallerLog -Message $environmentLabel'));
    assert.match(bootstrapVerification, /Add-Content -LiteralPath \$installLog/);
    assert.match(bootstrapVerification, /Get-Content -LiteralPath \$installLog -Raw/);
  }],
  ['broken scripts module ACL', () => {
    assert.match(atomicFileFunction, /Invoke-MccAtomicFileReplacement/);
    assert.match(atomicFileFunction, /DestinationVerification \$destinationVerifier/);
    assert.match(atomicFileFunction, /Enable-MccBootstrapItemAcl -LiteralPath \$InstalledPath/);
    assert.ok(installFlow.indexOf('Repair-MccUpdaterAcl') < installFlow.indexOf('Install-MccAtomicFile'));
  }],
  ['inheritance disabled on child files', () => {
    assert.match(repairFunction, /@\(.*\/inheritance:e.*\/T.*\/L.*\)/s);
    assert.match(installer, /Bootstrap ACL validation found inheritance disabled/);
    assert.doesNotMatch(installer, /['"]\/inheritance:r['"]/);
  }],
  ['SYSTEM-owned files', () => {
    assert.match(repairFunction, /catch\s*\{[\s\S]*takeown\.exe[\s\S]*\/A[\s\S]*\/R/);
    assert.match(repairFunction, /\*S-1-5-18:\(OI\)\(CI\)F/);
  }],
  ['rerun after partial failure', () => {
    assert.match(installFlow, /Export-ScheduledTask/);
    assert.match(installFlow, /Restore-MccScheduledTasks -Snapshots \$taskSnapshots/);
    assert.doesNotMatch(repairFunction, /Remove-Item|Remove-Mcc|applicationPath|Z:\\/i);
  }],
  ['bootstrap recursive repair', () => {
    assert.match(installer, /\[switch\]\$RepairUpdaterAcl/);
    assert.match(installer, /\$knownUpdaterRoot = 'C:\\ProgramData\\MCC\\Updater'/);
    assert.match(repairFunction, /Assert-MccAdministrator/);
    assert.match(repairFunction, /Assert-MccKnownUpdaterRoot -LiteralPath \$updaterRoot/);
    assert.match(readme, /-RepairUpdaterAcl/);
  }],
  ['final ACL verification', () => {
    assert.match(installFlow, /FINAL ACL PHASE - updater tree[\s\S]*FINAL ACL PHASE - verification/);
    assert.match(installFlow, /Assert-MccFinalUpdaterTree/);
    assert.match(installedTest, /AreAccessRulesProtected/);
  }],
  ['Administrators Full Control', () => {
    assert.match(installer, /S-1-5-32-544/);
    assert.match(installedTest, /S-1-5-32-544[\s\S]*FullControl/);
  }],
  ['SYSTEM Full Control', () => {
    assert.match(installer, /S-1-5-18/);
    assert.match(installedTest, /S-1-5-18[\s\S]*FullControl/);
  }],
  ['narrow LOCAL SERVICE permissions', () => {
    assert.match(installFlow, /request.*-LocalServiceRights \$modify/);
    assert.match(installFlow, /status.*-LocalServiceRights \$readExecute/);
    assert.match(installFlow, /scripts.*-LocalServiceRights \$readExecute/);
    assert.match(installFlow, /logs'\) -Recurse/);
    assert.match(installedTest, /Privileged logs ACL.*LocalServiceRights = \$null/);
    assert.match(installedTest, /unexpectedLocalServiceRights/);
  }],
  ['no Users or Everyone write access', () => {
    assert.match(installer, /S-1-1-0/);
    assert.match(installer, /S-1-5-32-545/);
    assert.match(installer, /Final ACL validation found Everyone or Users write access/);
  }],
  ['tasks wait for bootstrap verification', () => {
    const verificationIndex = installFlow.indexOf('Invoke-MccBootstrapVerification');
    const finalVerificationIndex = installFlow.indexOf('Assert-MccFinalUpdaterTree');
    const registrationIndex = installFlow.indexOf('Register-ScheduledTask -TaskName $constants.MccTaskName');
    assert.ok(verificationIndex >= 0 && verificationIndex < registrationIndex);
    assert.ok(finalVerificationIndex >= 0 && finalVerificationIndex < registrationIndex);
  }],
];

for (const [name, validate] of scenarios) {
  validate();
  console.log(`PASS ${name}`);
}

assert.match(atomicFileFunction, /Get-FileHash[\s\S]*SHA256/);
assert.match(atomicFileFunction, /Parser\]::ParseFile/);
assert.match(atomicFileFunction, /\.install\.\$PID\./);
assert.match(common, /ConvertFrom-Json -ErrorAction Stop/);
assert.match(common, /File\]::Replace\([\s\S]*\$normalizedTemporaryPath,[\s\S]*\$normalizedDestinationPath,[\s\S]*\$normalizedBackupPath,[\s\S]*\$true/);
assert.match(common, /GetFullPath/);
assert.match(common, /temporary source and destination must be on the same filesystem volume/);
assert.match(common, /destination hash (verification failed|changed during verification)/);
assert.match(common, /original destination backup is unavailable for rollback/);
assert.doesNotMatch(common, /File\]::Replace\([^\r\n]*,\s*(?:\$null|['"]{2})\s*,/);
assert.match(bootstrapVerification, /scripts\\\.mcc-bootstrap/);
assert.match(bootstrapVerification, /config-[^\r\n]*\.json/);
assert.match(bootstrapVerification, /status\\\.mcc-bootstrap-status/);
assert.match(bootstrapVerification, /Get-FileHash[\s\S]*\$installedPath/);
assert.match(installer, /MCC Windows updater failed at exact bootstrap stage/);
assert.match(installer, /MCC installer log unavailable/);
assert.match(installer, /Original exception:/);
assert.match(installer, /throw\s*\r?\n\}/);

const inheritanceProtection = finalAclFunction.indexOf('$acl.SetAccessRuleProtection($true, $false)');
const replacementGrantCheck = finalAclFunction.indexOf('Final ACL replacement grants were not confirmed');
assert.ok(replacementGrantCheck >= 0 && replacementGrantCheck < inheritanceProtection);

for (const preservedPolicy of [
  /WindowsProduction.*TestBranch.*never allowed|TestBranch is a WindowsTest-only/s,
  /configuredBranch = if \(\$Mode -eq 'WindowsTest'\).*else \{ \$constants\.Branch \}/,
  /Assert-MccApprovedApplicationPath/,
  /Assert-MccRepository.*-RequireClean/,
]) {
  assert.match(installer, preservedPolicy);
}

function windowsPowerShellFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return windowsPowerShellFiles(path);
    return /\.(?:ps1|psm1)$/i.test(entry.name) ? [path] : [];
  });
}

const updaterPowerShellFiles = [
  ...windowsPowerShellFiles('deploy/windows'),
  ...windowsPowerShellFiles('deployment/windows'),
];
for (const powershellPath of updaterPowerShellFiles) {
  const source = fs.readFileSync(powershellPath, 'utf8');
  const replaceCalls = source.match(/\[System\.IO\.File\]::Replace\([\s\S]*?\n\s*\)/g) ?? [];
  for (const replaceCall of replaceCalls) {
    assert.doesNotMatch(replaceCall, /,\s*(?:\$null|['"]{2})\s*,\s*\$true/, `${powershellPath} passes an empty/null backup to File.Replace.`);
    assert.match(replaceCall, /normalized(?:BackupPath|RollbackDiscardPath)|rollbackDiscardPath/i, `${powershellPath} does not use a normalized legal backup path.`);
  }
}
assert.equal(
  updaterPowerShellFiles.reduce((count, powershellPath) => (
    count + (fs.readFileSync(powershellPath, 'utf8').match(/\[System\.IO\.File\]::Replace\(/g) ?? []).length
  ), 0),
  2,
  'Every Windows updater File.Replace call must remain centralized in the validated helper and rollback path.',
);

for (const powershellPath of [...updaterPowerShellFiles, atomicReplacementTestPath]) {
  const parser = spawnSync('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `$errors=$null;[System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path '${powershellPath.replaceAll('/', '\\')}'),[ref]$null,[ref]$errors)|Out-Null;if($errors){$errors|ForEach-Object{$_.Message};exit 1}`,
  ], { encoding: 'utf8', windowsHide: true });
  assert.equal(parser.status, 0, `${powershellPath}\n${parser.stderr || parser.stdout}`);
}

const atomicReplacement = spawnSync('powershell.exe', [
  '-NoLogo',
  '-NoProfile',
  '-NonInteractive',
  '-ExecutionPolicy',
  'RemoteSigned',
  '-File',
  atomicReplacementTestPath,
  '-ModulePath',
  commonPath,
  '-CrossVolumeSourcePath',
  commonPath,
], { encoding: 'utf8', windowsHide: true });
assert.equal(
  atomicReplacement.status,
  0,
  `${atomicReplacementTestPath}\n${atomicReplacement.stderr || atomicReplacement.stdout}`,
);
process.stdout.write(atomicReplacement.stdout);

console.log('Windows updater installer validation passed all bootstrap ACL, partial-rerun, atomic replacement, final ACL, and task-ordering scenarios.');
