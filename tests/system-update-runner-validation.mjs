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

const parser = spawnSync('powershell.exe', [
  '-NoLogo',
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  "$errors=$null;[System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path 'deployment\\windows\\Invoke-MccTestUpdate.ps1'),[ref]$null,[ref]$errors)|Out-Null;if($errors){$errors|ForEach-Object{$_.Message};exit 1}",
], { encoding: 'utf8', windowsHide: true });
assert.equal(parser.status, 0, parser.stderr || parser.stdout);

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

console.log('System update runner validation passed: fixed source, service/sudo boundary, backup paths, health/rollback logic, Windows Z: guard, manual command, PowerShell syntax, and deployment documentation.');
