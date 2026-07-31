import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const installerPath = 'deploy/windows/Install-MccWindowsUpdater.ps1';
const commonPath = 'deploy/windows/MccWindowsUpdater.Common.psm1';
const agentPath = 'deploy/windows/Start-MccWindowsAgent.ps1';
const launcherPath = 'deploy/windows/Start-MccWindowsWeb.ps1';
const backendUpdatePath = 'backend/src/server/systemUpdate.ts';
const installedTestPath = 'deploy/windows/Test-MccWindowsUpdater.ps1';
const readmePath = 'deploy/windows/README-Windows-Updater.md';
const atomicReplacementTestPath = 'tests/windows-updater-atomic-replacement.ps1';
const agentRuntimeTestPath = 'tests/windows-updater-agent-runtime.ps1';

const installer = fs.readFileSync(installerPath, 'utf8');
const common = fs.readFileSync(commonPath, 'utf8');
const agent = fs.readFileSync(agentPath, 'utf8');
const launcher = fs.readFileSync(launcherPath, 'utf8');
const backendUpdate = fs.readFileSync(backendUpdatePath, 'utf8');
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
const applicationAclGrant = functionSource(installer, 'Grant-MccLocalServiceApplicationAccess', 'Assert-MccLocalServiceApplicationAccess');
const applicationAclPreparation = functionSource(installer, 'Set-MccApplicationRuntimeAcl', 'Assert-MccApplicationRuntimeAcl');
const applicationAclVerification = functionSource(installer, 'Assert-MccApplicationRuntimeAcl', 'Restore-MccScheduledTasks');
const processTreeFallback = functionSource(common, 'Stop-MccExactProcessTreeFallback', 'Invoke-MccProcess');
const processFunction = functionSource(common, 'Invoke-MccProcess', 'Invoke-MccGit');
const pathBootstrapFunction = functionSource(common, 'Set-MccExecutablePathBootstrap', 'Set-MccGitRepositoryTrustBootstrap');
const gitTrustBootstrapFunction = functionSource(common, 'Set-MccGitRepositoryTrustBootstrap', 'New-MccWindowsAgentHealth');
const healthPayloadFunction = functionSource(common, 'New-MccWindowsAgentHealth', 'Test-MccSemver');
const agentHealthStart = agent.indexOf('function Write-AgentHealth {');
const agentHealthFunction = agent.slice(agentHealthStart, agent.indexOf('\nif (-not (Test-Path', agentHealthStart));
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
  ['bounded application ACL preparation', () => {
    assert.doesNotMatch(applicationAclGrant, /['"]\/T['"]|['"]\/C['"]/);
    assert.doesNotMatch(applicationAclPreparation, /['"]\/T['"]|Get-ChildItem|Remove-Item/);
    assert.doesNotMatch(installFlow, /@\(\$applicationPath,[\s\S]{0,160}['"]\/T['"]/);
    assert.match(applicationAclPreparation, /Grant-MccLocalServiceApplicationAccess -LiteralPath \$applicationPath -Rights RX/);
    assert.match(applicationAclPreparation, /backend\\dist/);
    assert.match(applicationAclPreparation, /frontend\\dist/);
    assert.match(applicationAclPreparation, /\.git\\(?:refs|objects)/);
    assert.match(applicationAclPreparation, /backend\\data[\s\S]*backend\\uploads[\s\S]*backend\\documents[\s\S]*backend\\files/);
    assert.match(applicationAclPreparation, /-Rights M -Inherit/);
    assert.match(applicationAclPreparation, /\.env[\s\S]*backend\\\.env[\s\S]*-Rights R/);
    assert.match(applicationAclVerification, /backend\\dist\\server\\index\.js/);
    assert.match(applicationAclVerification, /frontend\\dist/);
    assert.match(applicationAclVerification, /package-lock\.json/);
    assert.match(applicationAclVerification, /\.git\\HEAD/);
    assert.match(installFlow, /Set-MccApplicationRuntimeAcl[\s\S]*Assert-MccApplicationRuntimeAcl/);
    assert.ok(installFlow.indexOf("@($npmCliPath, 'run', 'build')") < installFlow.indexOf('Assert-MccApplicationRuntimeAcl'));
  }],
  ['application ACL rerun and data preservation', () => {
    assert.match(applicationAclGrant, /\/grant:r/);
    assert.match(applicationAclPreparation, /Directory\]::CreateDirectory/);
    assert.doesNotMatch(applicationAclPreparation, /Remove-Item|Delete\(|Move-Item|Copy-Item/);
    assert.doesNotMatch(applicationAclVerification, /Remove-Item|Delete\(|Move-Item|Copy-Item/);
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
assert.match(pathBootstrapFunction, /StringComparer\]::OrdinalIgnoreCase/);
assert.match(pathBootstrapFunction, /IsNullOrWhiteSpace/);
assert.match(pathBootstrapFunction, /GIT_TERMINAL_PROMPT = '0'/);
assert.match(gitTrustBootstrapFunction, /Assert-MccApprovedApplicationPath/);
assert.match(gitTrustBootstrapFunction, /ConfiguredApplicationPath/);
assert.match(gitTrustBootstrapFunction, /OrdinalIgnoreCase/);
assert.match(gitTrustBootstrapFunction, /GIT_CONFIG_PARAMETERS/);
assert.match(gitTrustBootstrapFunction, /GIT_CONFIG_\(\?:KEY\|VALUE\)_\\d\+/);
assert.match(gitTrustBootstrapFunction, /GIT_CONFIG_COUNT = '1'/);
assert.match(gitTrustBootstrapFunction, /GIT_CONFIG_KEY_0 = 'safe\.directory'/);
assert.match(gitTrustBootstrapFunction, /GIT_CONFIG_VALUE_0 = \$gitTrustedPath/);
assert.match(gitTrustBootstrapFunction, /\.Replace\('\\', '\/'\)/);
assert.doesNotMatch(gitTrustBootstrapFunction, /safe\.directory[^\r\n]*['"]\*['"]|git\s+config|--global|--system/);
assert.doesNotMatch(agentHealthFunction, /\$env:PATH|Set-MccExecutablePathBootstrap/);
assert.equal((agent.match(/Set-MccExecutablePathBootstrap/g) ?? []).length, 1, 'The updater agent must bootstrap executable PATH exactly once.');
assert.ok(agent.indexOf('Set-MccExecutablePathBootstrap') < agent.indexOf('while ($true)'));
assert.match(agent, /ExecutableBootstrapSucceeded = \$false[\s\S]*Set-MccExecutablePathBootstrap[\s\S]*ExecutableBootstrapSucceeded = \$true/);
assert.match(healthPayloadFunction, /HeartbeatCompleted[\s\S]*ExecutableBootstrapSucceeded[\s\S]*agentHealthy = \[bool\]\$agentHealthy/);
assert.doesNotMatch(healthPayloadFunction, /exception|LiteralPath|[A-Z]:\\/i);

assert.match(processFunction, /taskkill\.exe/);
assert.match(processFunction, /\/PID \$\(\$process\.Id\) \/T \/F/);
assert.match(processFunction, /WaitForExit\(15000\)/);
assert.match(processFunction, /exact_process_tree_terminated/);
assert.doesNotMatch(processFunction, /Get-Process|Stop-Process|ProcessName|node\.exe/);
assert.match(processTreeFallback, /ParentProcessId = \$parentId/);
assert.match(processTreeFallback, /GetProcessById\(\$processId\)/);
assert.doesNotMatch(processTreeFallback, /ProcessName|node\.exe|Get-Process|Stop-Process/);

assert.match(launcher, /mcc-launcher-\$stamp\.log/);
assert.match(launcher, /RedirectStandardOutput \$stdoutPath/);
assert.doesNotMatch(launcher, /\$logPath = Join-Path \$webLogDirectory "mcc-\$stamp\.log"/);
assert.match(launcher, /Set-MccExecutablePathBootstrap[\s\S]*Set-MccGitRepositoryTrustBootstrap[\s\S]*Assert-MccRepository[\s\S]*Start-Process/);
assert.match(launcher, /exact process-scoped repository trust/);
assert.doesNotMatch(launcher, /Write-WebStartupLog -Message .*\$applicationPath/);

assert.match(backendUpdate, /function gitProcessEnvironment/);
assert.match(backendUpdate, /GIT_CONFIG_COUNT = '1'/);
assert.match(backendUpdate, /GIT_CONFIG_KEY_0 = 'safe\.directory'/);
assert.match(backendUpdate, /GIT_CONFIG_VALUE_0 = applicationDir\.replaceAll/);
assert.doesNotMatch(backendUpdate, /safe\.directory[^\r\n]*['"]\*['"]|git\s+config\s+--global/);

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

for (const powershellPath of [...updaterPowerShellFiles, atomicReplacementTestPath, agentRuntimeTestPath]) {
  const parser = spawnSync('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `$errors=$null;[System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path '${powershellPath.replaceAll('/', '\\')}'),[ref]$null,[ref]$errors)|Out-Null;if($errors){$errors|ForEach-Object{$_.Message};exit 1}`,
  ], { encoding: 'utf8', windowsHide: true });
  assert.equal(parser.status, 0, `${powershellPath}\n${parser.stderr || parser.stdout}`);
}

const managedRepositoryPath = 'C:\\MCC-Windows-Test\\MCC_V1_FINAL';
const managedRepositoryCommit = fs.existsSync(managedRepositoryPath)
  ? spawnSync('git', [
      '-c',
      `safe.directory=${managedRepositoryPath.replaceAll('\\', '/')}`,
      '-C',
      managedRepositoryPath,
      'rev-parse',
      '--short=7',
      'HEAD',
    ], { encoding: 'utf8', windowsHide: true }).stdout.trim()
  : '';
const agentRuntimeArguments = [
  '-NoLogo',
  '-NoProfile',
  '-NonInteractive',
  '-ExecutionPolicy',
  'RemoteSigned',
  '-File',
  agentRuntimeTestPath,
  '-ModulePath',
  commonPath,
];
if (managedRepositoryCommit) {
  agentRuntimeArguments.push(
    '-ManagedRepositoryPath',
    managedRepositoryPath,
    '-ExpectedManagedCommit',
    managedRepositoryCommit,
  );
}
const agentRuntime = spawnSync('powershell.exe', agentRuntimeArguments, { encoding: 'utf8', windowsHide: true, timeout: 180_000 });
assert.equal(
  agentRuntime.status,
  0,
  `${agentRuntimeTestPath}\n${agentRuntime.error ?? ''}\n${agentRuntime.stderr || agentRuntime.stdout}`,
);
process.stdout.write(agentRuntime.stdout);

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
