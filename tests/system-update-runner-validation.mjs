import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const linuxRunner = fs.readFileSync('deployment/raspberry-pi/update-mcc', 'utf8');
const manualRunner = fs.readFileSync('deployment/raspberry-pi/mcc-update', 'utf8');
const requestUnit = fs.readFileSync('deployment/raspberry-pi/mcc-update-request.service', 'utf8');
const runnerUnit = fs.readFileSync('deployment/raspberry-pi/mcc-update-runner.service', 'utf8');
const sudoers = fs.readFileSync('deployment/raspberry-pi/mcc-update.sudoers', 'utf8');
const windowsRunner = fs.readFileSync('deployment/windows/Invoke-MccTestUpdate.ps1', 'utf8');
const windowsConfig = JSON.parse(fs.readFileSync('deployment/windows/mcc-update.test.example.json', 'utf8'));
const documentation = fs.readFileSync('docs/admin-one-click-updater.md', 'utf8');
const windowsInstaller = fs.readFileSync('deploy/windows/Install-MccWindowsUpdater.ps1', 'utf8');
const windowsCommon = fs.readFileSync('deploy/windows/MccWindowsUpdater.Common.psm1', 'utf8');
const windowsProductionRunner = fs.readFileSync('deploy/windows/Update-MccWindows.ps1', 'utf8');
const windowsAgent = fs.readFileSync('deploy/windows/Start-MccWindowsAgent.ps1', 'utf8');
const windowsWeb = fs.readFileSync('deploy/windows/Start-MccWindowsWeb.ps1', 'utf8');
const windowsUninstaller = fs.readFileSync('deploy/windows/Uninstall-MccWindowsUpdater.ps1', 'utf8');
const windowsTest = fs.readFileSync('deploy/windows/Test-MccWindowsUpdater.ps1', 'utf8');
const windowsReadme = fs.readFileSync('deploy/windows/README-Windows-Updater.md', 'utf8');
const windowsTemplate = JSON.parse(fs.readFileSync('deploy/windows/config.template.json', 'utf8'));
const windowsConfigSchema = JSON.parse(fs.readFileSync('deploy/windows/config.schema.json', 'utf8'));
const windowsAgentHealthStart = windowsAgent.indexOf('function Write-AgentHealth {');
const windowsAgentHealth = windowsAgent.slice(windowsAgentHealthStart, windowsAgent.indexOf('\nif (-not (Test-Path', windowsAgentHealthStart));

for (const source of [linuxRunner, windowsRunner]) {
  assert.match(source, /https:\/\/github\.com\/Recklessrage17\/maintenance-command-center\.git/);
  assert.match(source, /origin/i);
  assert.match(source, /main/i);
  assert.match(source, /4273/);
  assert.doesNotMatch(source, /git\s+reset\s+--hard/i);
  for (const protectedPath of ['backend/data', 'backend/uploads', 'backend/documents', 'backend/files', 'backend/.env', '.env']) {
    const platformPath = source === windowsRunner ? protectedPath.replaceAll('/', '\\') : protectedPath;
    assert.ok(source.includes(platformPath) || source.includes(protectedPath), `Missing protected backup path ${protectedPath}.`);
  }
}

assert.match(linuxRunner, /flock -n/);
assert.match(linuxRunner, /merge-base --is-ancestor/);
assert.match(linuxRunner, /merge --ff-only/);
assert.match(linuxRunner, /rolling_back/);
assert.match(linuxRunner, /rolled_back/);
assert.match(linuxRunner, /npm ci --prefix "\$\{APP_DIR\}\/frontend"/);
assert.match(linuxRunner, /npm ci --prefix "\$\{APP_DIR\}\/backend"/);
assert.match(manualRunner, /update-mcc --manual/);
assert.match(requestUnit, /ExecStart=\/usr\/bin\/systemctl start --no-block mcc-update-runner\.service/);
assert.match(runnerUnit, /ExecStart=\/usr\/local\/sbin\/update-mcc --request/);
assert.equal(sudoers.trim().split(/\r?\n/).filter(line => line.startsWith('mcc ALL=')).length, 1);
assert.match(sudoers, /^mcc ALL=\(root\) NOPASSWD: \/usr\/bin\/systemctl start mcc-update-request\.service$/m);

assert.equal(windowsConfig.applicationPath, 'Z:\\MCC_V1_FINAL');
assert.equal(windowsConfig.repository, 'https://github.com/Recklessrage17/maintenance-command-center.git');
assert.equal(windowsConfig.remote, 'origin');
assert.equal(windowsConfig.branch, 'main');
assert.equal(windowsConfig.port, 4273);
assert.match(windowsRunner, /F: is never allowed/);
assert.match(windowsRunner, /WINDOWS TEST MODE/);
assert.match(windowsRunner, /Invoke-Dependencies -Rollback/);
assert.match(windowsRunner, /Test-MccHealth -IgnoreSimulation/);

for (const source of [windowsInstaller, windowsProductionRunner, windowsAgent, windowsWeb, windowsUninstaller, windowsTest]) {
  assert.match(source, /Set-StrictMode -Version Latest/);
  assert.match(source, /\$ErrorActionPreference = 'Stop'/);
  assert.match(source, /^<#/);
  assert.doesNotMatch(source, /Invoke-Expression/i);
  assert.doesNotMatch(source, /taskkill\s+\/IM\s+node\.exe/i);
  assert.doesNotMatch(source, /git\s+reset\s+--hard/i);
  assert.doesNotMatch(source, /git\s+clean\s+-fd/i);
}
for (const source of [windowsInstaller, windowsProductionRunner]) {
  assert.match(source, /https:\/\/github\.com\/Recklessrage17\/maintenance-command-center\.git|Get-MccUpdaterConstants/);
  assert.match(source, /4273/);
  assert.match(source, /main|Get-MccUpdaterConstants/);
  for (const protectedPath of ['backend\\data', 'backend\\uploads', 'backend\\documents', 'backend\\files', 'backend\\.env', '.env']) {
    assert.ok(source.includes(protectedPath), `Production Windows script is missing runtime path ${protectedPath}.`);
  }
}
assert.match(windowsInstaller, /Assert-MccAdministrator/);
assert.match(windowsInstaller, /\[string\]\$TestBranch = 'main'/);
assert.match(windowsInstaller, /TestBranch is a WindowsTest-only installation setting and is never allowed in WindowsProduction/);
assert.match(windowsInstaller, /Assert-MccOriginBranch -ApplicationPath \$applicationPath -Branch \$configuredBranch/);
assert.match(windowsInstaller, /branch = \$configuredBranch/);
assert.match(windowsInstaller, /Node\.js 22 or newer/);
assert.match(windowsInstaller, /MaintenanceCommandCenterUpdater/);
assert.match(windowsInstaller, /NT AUTHORITY\\LOCAL SERVICE/);
assert.match(windowsInstaller, /NT AUTHORITY\\SYSTEM/);
assert.match(windowsInstaller, /package-lock\.json/);
assert.match(windowsInstaller, /icacls\.exe/);
assert.match(windowsInstaller, /\*S-1-5-18/);
assert.match(windowsInstaller, /\*S-1-5-32-544/);
assert.match(windowsInstaller, /\*S-1-5-19/);
assert.match(windowsProductionRunner, /FileShare\]::None/);
assert.match(windowsCommon, /--porcelain=v1/);
assert.match(windowsProductionRunner, /merge-base/);
assert.match(windowsProductionRunner, /--ff-only/);
assert.match(windowsProductionRunner, /npmCliPath/);
assert.match(windowsProductionRunner, /rolling_back/);
assert.match(windowsProductionRunner, /rolled_back/);
assert.match(windowsProductionRunner, /Get-FileHash/);
assert.match(windowsProductionRunner, /\/api\/system\/update\/managed-readiness/);
assert.match(windowsProductionRunner, /Invoke-MccHttpJsonProbe[\s\S]*managed-readiness/);
assert.match(windowsProductionRunner, /AllowLegacyReadiness404[\s\S]*\/api\/health/);
assert.match(windowsProductionRunner, /managed-readiness endpoint is mandatory for the newly updated MCC target/);
assert.match(windowsProductionRunner, /Get-NetTCPConnection[\s\S]*OwningProcess/);
assert.match(windowsProductionRunner, /PreviousManagedProcessId/);
assert.match(windowsProductionRunner, /RequireLauncherAttestation/);
assert.match(windowsCommon, /systemUpdate\.configured[\s\S]*systemUpdate\.enabled[\s\S]*applicationMatchesConfiguration/);
assert.match(windowsProductionRunner, /updaterTaskRunning/);
assert.match(windowsProductionRunner, /Set-MccGitRepositoryTrustBootstrap/);
assert.doesNotMatch(windowsProductionRunner, /Get-Process[^\r\n]*-Name|Stop-Process[^\r\n]*-Name|taskkill[^\r\n]*\/IM/i);
assert.match(windowsProductionRunner, /shutdown-request\.json/);
assert.match(windowsProductionRunner, /graceful shutdown/i);
assert.match(windowsProductionRunner, /Find-MccJobBackup/);
assert.match(windowsProductionRunner, /interrupted Windows update/i);
assert.match(windowsProductionRunner, /ExpectedBranch \$configuredBranch/);
assert.match(windowsProductionRunner, /\+refs\/heads\/\$\{configuredBranch\}:refs\/remotes/);
assert.match(windowsProductionRunner, /request\.source\.branch -cne \$configuredBranch/);
assert.match(windowsProductionRunner, /WINDOWS TEST MODE/);
assert.match(windowsProductionRunner, /Configured update branch: origin\/\$configuredBranch/);
assert.match(windowsAgent, /request\\request\.json/);
assert.match(windowsAgent, /agent-health\.json/);
assert.match(windowsAgent, /Update-MccWindows\.ps1/);
assert.doesNotMatch(windowsAgent, /\$(repositoryUrl|branchName|command)\b/i);
assert.match(windowsAgent, /ExpectedBranch \(\[string\]\$script:StartupConfiguration\.branch\)/);
assert.match(windowsAgent, /Configured update branch: origin/);
assert.equal((windowsAgent.match(/Set-MccExecutablePathBootstrap/g) ?? []).length, 1);
assert.ok(windowsAgent.indexOf('Set-MccExecutablePathBootstrap') < windowsAgent.indexOf('while ($true)'));
assert.doesNotMatch(windowsAgentHealth, /Set-MccExecutablePathBootstrap|\$env:PATH/);
assert.match(windowsWeb, /\$gitPath = \[string\]\$configuration\.gitPath/);
assert.match(windowsWeb, /Test-Path -LiteralPath \$gitPath -PathType Leaf/);
assert.match(windowsWeb, /Test-Path -LiteralPath \$nodePath -PathType Leaf/);
assert.match(windowsWeb, /Set-MccExecutablePathBootstrap -GitPath \$gitPath -NodePath \$nodePath/);
assert.match(windowsWeb, /Set-MccGitRepositoryTrustBootstrap[\s\S]*ConfiguredApplicationPath \(\[string\]\$configuration\.applicationPath\)/);
assert.match(windowsWeb, /Assert-MccRepository -ApplicationPath \$applicationPath -ExpectedBranch/);
assert.match(windowsWeb, /Startup validation passed:/);
assert.match(windowsWeb, /launchId = \$launchId/);
assert.match(windowsWeb, /launcherProcessId = \$PID/);
assert.match(windowsWeb, /applicationMatchesConfiguration = \$true/);
assert.match(windowsWeb, /managedEnvironment[\s\S]*updateMode = \$env:MCC_UPDATE_MODE[\s\S]*nodeEnvironment = \$env:NODE_ENV/);
assert.doesNotMatch(windowsWeb, /Write-WebStartupLog -Message .*\$gitPath/);
assert.match(windowsCommon, /\$env:GIT_TERMINAL_PROMPT = '0'/);
assert.match(windowsCommon, /function Set-MccGitRepositoryTrustBootstrap/);
assert.match(windowsCommon, /\$env:GIT_CONFIG_COUNT = '1'/);
assert.match(windowsCommon, /\$env:GIT_CONFIG_KEY_0 = 'safe\.directory'/);
assert.doesNotMatch(windowsCommon, /git\s+config\s+--global|safe\.directory\s*[=:]\s*\*/i);
assert.match(windowsUninstaller, /Preserved the MCC installation, database, uploads, documents, files, and environment files/);
assert.match(windowsTest, /Protected F path/);
assert.match(windowsTest, /Request ACL/);
assert.match(windowsTest, /Configuration ACL/);
assert.match(windowsTest, /Origin branch/);
assert.match(windowsTest, /configured update branch origin/);
assert.match(windowsTest, /Managed launcher process/);
assert.match(windowsTest, /Managed port owner/);
assert.match(windowsTest, /No detached MCC process/);
assert.match(windowsTest, /Managed updater readiness/);
assert.match(windowsCommon, /function Test-MccUpdateBranch/);
assert.match(windowsCommon, /deploymentMode -eq 'WindowsProduction'.*configuredBranch -cne \$constants\.Branch/);
assert.equal(windowsTemplate.repository, 'https://github.com/Recklessrage17/maintenance-command-center.git');
assert.equal(windowsTemplate.branch, 'main');
assert.equal(windowsTemplate.port, 4273);
assert.equal(windowsTemplate.mccTaskName, 'MaintenanceCommandCenter');
assert.equal(windowsTemplate.updaterTaskName, 'MaintenanceCommandCenterUpdater');
assert.equal(windowsConfigSchema.properties.branch.default, 'main');
assert.equal(windowsConfigSchema.properties.repository.const, 'https://github.com/Recklessrage17/maintenance-command-center.git');
assert.equal(windowsConfigSchema.properties.remote.const, 'origin');
assert.equal(windowsConfigSchema.allOf[0].then.properties.branch.const, 'main');
const schemaBranchPattern = new RegExp(windowsConfigSchema.properties.branch.pattern);
assert.equal(schemaBranchPattern.test('feature/windows-11-updater-agent'), true);
assert.equal(schemaBranchPattern.test('feature/../unsafe'), false);

for (const requiredText of [
  'WINDOWS TEST MODE',
  'WINDOWS 11 PRODUCTION',
  'UPDATER NOT CONFIGURED',
  'F:\\MCC_V1_FINAL',
  'MaintenanceCommandCenterUpdater',
  'MaintenanceCommandCenter',
  'RemoteSigned',
  'manual update fallback',
  'Windows reboot validation',
  'Raspberry Pi',
]) assert.ok(windowsReadme.toLowerCase().includes(requiredText.toLowerCase()), `Windows updater README is missing: ${requiredText}`);

const powershellFiles = [
  'deployment/windows/Invoke-MccTestUpdate.ps1',
  ...fs.readdirSync('deploy/windows')
    .filter(name => /\.(ps1|psm1)$/i.test(name))
    .map(name => `deploy/windows/${name}`),
];
for (const powershellFile of powershellFiles) {
  const parser = spawnSync('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `$errors=$null;[System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path '${powershellFile.replaceAll('/', '\\')}'),[ref]$null,[ref]$errors)|Out-Null;if($errors){$errors|ForEach-Object{$_.Message};exit 1}`,
  ], { encoding: 'utf8', windowsHide: true });
  assert.equal(parser.status, 0, `${powershellFile}\n${parser.stderr || parser.stdout}`);
}

const pathPolicy = spawnSync('powershell.exe', [
  '-NoLogo',
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  [
    "Import-Module (Resolve-Path 'deploy\\windows\\MccWindowsUpdater.Common.psm1') -Force",
    "if(-not (Test-MccProtectedDevelopmentPath -LiteralPath 'F:\\MCC_V1_FINAL')){exit 1}",
    "try{Assert-MccApprovedApplicationPath -LiteralPath 'F:\\MCC_V1_FINAL'|Out-Null;exit 2}catch{}",
    "if((Assert-MccApprovedApplicationPath -LiteralPath 'Z:\\MCC_V1_FINAL') -ne 'Z:\\MCC_V1_FINAL'){exit 3}",
    "if((Assert-MccApprovedApplicationPath -LiteralPath 'C:\\MCC\\MCC_V1_FINAL') -ne 'C:\\MCC\\MCC_V1_FINAL'){exit 4}",
    "if((Assert-MccApprovedApplicationPath -LiteralPath 'D:\\MCC\\MCC_V1_FINAL') -ne 'D:\\MCC\\MCC_V1_FINAL'){exit 5}",
    "if(-not (Test-MccUpdateBranch -Value 'feature/windows-11-updater-agent')){exit 6}",
    "if(Test-MccUpdateBranch -Value 'feature/../unsafe'){exit 7}",
    "if(Test-MccUpdateBranch -Value 'feature/test.lock'){exit 8}",
  ].join(';'),
], { encoding: 'utf8', windowsHide: true });
assert.equal(pathPolicy.status, 0, pathPolicy.stderr || pathPolicy.stdout);

const webBootstrap = spawnSync('powershell.exe', [
  '-NoLogo',
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  [
    "Import-Module (Resolve-Path 'deploy\\windows\\MccWindowsUpdater.Common.psm1') -Force",
    "$gitPath=(Get-Command 'git.exe' -ErrorAction Stop).Source",
    "$nodePath=(Get-Command 'node.exe' -ErrorAction Stop).Source",
    '$restrictedPath=[System.IO.Path]::GetTempPath().TrimEnd([System.IO.Path]::DirectorySeparatorChar)',
    '$env:PATH=$restrictedPath',
    'Set-MccExecutablePathBootstrap -GitPath $gitPath -NodePath $nodePath',
    '$expectedPath=@((Split-Path -Parent $gitPath),(Split-Path -Parent $nodePath),$restrictedPath) -join [System.IO.Path]::PathSeparator',
    'if(-not $env:PATH.Equals($expectedPath,[StringComparison]::OrdinalIgnoreCase)){exit 1}',
    "if($env:GIT_TERMINAL_PROMPT -ne '0'){exit 4}",
    '& git.exe --version | Out-Null',
    'if($LASTEXITCODE -ne 0){exit 5}',
    "& $nodePath -e \"const {spawnSync}=require('node:child_process');const result=spawnSync('git',['--version']);process.exit(result.status===0?0:1)\"",
    'if($LASTEXITCODE -ne 0){exit 8}',
    "try{Set-MccExecutablePathBootstrap -GitPath (Join-Path $restrictedPath 'missing-git.exe') -NodePath $nodePath;exit 6}catch{}",
    'try{Set-MccExecutablePathBootstrap -GitPath $restrictedPath -NodePath $nodePath;exit 7}catch{}',
    'exit 0',
  ].join(';'),
], { encoding: 'utf8', windowsHide: true });
assert.equal(webBootstrap.status, 0, webBootstrap.stderr || webBootstrap.stdout);

const pythonSyntax = spawnSync('python', [
  '-c',
  "compile(open(r'deployment/raspberry-pi/write-status.py', encoding='utf-8').read(), r'deployment/raspberry-pi/write-status.py', 'exec')",
], { encoding: 'utf8', windowsHide: true });
assert.equal(pythonSyntax.status, 0, pythonSyntax.stderr || pythonSyntax.stdout);

const bashExecutable = process.platform === 'win32'
  ? path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'bash.exe')
  : 'bash';
const bashSyntax = spawnSync(bashExecutable, ['-n', 'deployment/raspberry-pi/update-mcc'], { encoding: 'utf8', windowsHide: true });
assert.equal(bashSyntax.status, 0, bashSyntax.stderr || bashSyntax.stdout);

for (const requiredText of [
  'mcc:mcc 0640',
  'mcc:mcc 0600',
  'sudo mcc-update',
  'systemd-analyze verify',
  'WINDOWS TEST MODE',
  'RASPBERRY PI PRODUCTION',
  'Critical rollback failure',
]) assert.ok(documentation.includes(requiredText), `Deployment documentation is missing: ${requiredText}`);

console.log('System update runner validation passed: fixed source, service/sudo/task boundary, backup paths, health/rollback logic, Windows protected-path guards, managed agent package, manual commands, PowerShell syntax, and deployment documentation.');
