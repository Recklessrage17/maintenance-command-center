import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APPROVED_MCC_PORT,
  APPROVED_UPDATE_BRANCH,
  APPROVED_UPDATE_REMOTE,
  APPROVED_UPDATE_REPOSITORY,
  JsonSystemUpdateStatusStore,
  MemorySystemUpdateStatusStore,
  SystemUpdateError,
  SystemUpdateService,
  compareSemver,
  createSystemUpdateGitRunner,
  isSafeUpdateBranch,
  loadSystemUpdateConfiguration,
} from '../backend/dist/server/systemUpdate.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = path.join(root, 'tmp', `system-update-service-${Date.now()}-${process.pid}`);
const gitLocator = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [process.platform === 'win32' ? 'git.exe' : 'git'], {
  encoding: 'utf8',
  windowsHide: true,
});
assert.equal(gitLocator.status, 0, gitLocator.stderr || 'Git executable discovery failed.');
const approvedGitPath = gitLocator.stdout.split(/\r?\n/).map(value => value.trim()).find(Boolean);
assert.ok(approvedGitPath && path.isAbsolute(approvedGitPath));

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function git(cwd, ...args) {
  return run('git', args, cwd);
}

function writeManifest(directory, version) {
  fs.writeFileSync(path.join(directory, 'package.json'), `${JSON.stringify({ name: 'mcc-update-fixture', version }, null, 2)}\n`);
}

function commit(directory, message) {
  git(directory, 'add', 'package.json');
  git(directory, 'commit', '-m', message);
  return git(directory, 'rev-parse', 'HEAD');
}

function makeFixture(name, version = '1.2.1', branch = 'main') {
  const directory = path.join(fixtureRoot, name);
  const remote = path.join(directory, 'remote.git');
  const seed = path.join(directory, 'seed');
  const installed = path.join(directory, 'installed');
  fs.mkdirSync(directory, { recursive: true });
  git(directory, 'init', '--bare', remote);
  fs.mkdirSync(seed);
  git(seed, 'init', '-b', branch);
  git(seed, 'config', 'user.name', 'MCC Update Test');
  git(seed, 'config', 'user.email', 'update-test@example.com');
  writeManifest(seed, version);
  const initialCommit = commit(seed, 'initial version');
  git(seed, 'remote', 'add', 'origin', remote);
  git(seed, 'push', '-u', 'origin', branch);
  git(directory, 'clone', '--branch', branch, remote, installed);
  git(installed, 'config', 'user.name', 'MCC Installed Test');
  git(installed, 'config', 'user.email', 'installed@example.com');
  return { directory, remote, seed, installed, initialCommit, branch };
}

function advance(fixture, version, message = `release ${version}`) {
  writeManifest(fixture.seed, version);
  const targetCommit = commit(fixture.seed, message);
  git(fixture.seed, 'push', 'origin', fixture.branch);
  return targetCommit;
}

function configuration(fixture) {
  return {
    enabled: true,
    configured: true,
    disabledReason: '',
    disabledCode: 'not_checked',
    mode: 'windows_test',
    environmentLabel: 'WINDOWS TEST MODE',
    applicationDir: fixture.installed,
    statusPath: path.join(fixture.directory, 'state', 'status.json'),
    requestPath: path.join(fixture.directory, 'state', 'request.json'),
    windowsRunnerPath: path.join(fixture.directory, 'Invoke-MccTestUpdate.ps1'),
    windowsConfigPath: path.join(fixture.directory, 'config.json'),
    windowsAgentHealthPath: null,
    windowsShutdownPath: null,
    gitExecutable: approvedGitPath,
    approvedRepository: fixture.remote,
    remote: APPROVED_UPDATE_REMOTE,
    branch: fixture.branch,
    port: APPROVED_MCC_PORT,
  };
}

function gitRunner(args, cwd, timeoutMs = 12_000) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', timeout: timeoutMs, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
}

function serviceFor(fixture, options = {}) {
  const store = options.store ?? new MemorySystemUpdateStatusStore();
  const service = new SystemUpdateService(
    configuration(fixture),
    store,
    options.gitRunner ?? gitRunner,
    options.trigger ?? (() => undefined),
    options.clock ?? (() => new Date('2026-07-29T12:00:00.000Z')),
  );
  return { service, store };
}

function expectCode(callback, code) {
  assert.throws(callback, error => error instanceof SystemUpdateError && error.code === code);
}

fs.mkdirSync(fixtureRoot, { recursive: true });
try {
  assert.equal(compareSemver('1.3.0', '1.2.9'), 1);
  assert.equal(compareSemver('1.2.1', '1.2.1'), 0);
  assert.equal(compareSemver('1.2.0', '1.2.1'), -1);
  assert.equal(isSafeUpdateBranch('feature/windows-11-updater-agent'), true);
  for (const branch of ['', '-unsafe', '.hidden', 'feature//unsafe', 'feature/../unsafe', 'feature/test.lock', 'feature/@{unsafe']) {
    assert.equal(isSafeUpdateBranch(branch), false, `Expected unsafe update branch to be rejected: ${branch}`);
  }

  const disabled = loadSystemUpdateConfiguration(root, {}, 'win32');
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.environmentLabel, 'UPDATER NOT CONFIGURED');
  const rejectedDevelopment = loadSystemUpdateConfiguration('F:\\MCC_V1_FINAL', {
    MCC_UPDATE_MODE: 'windows_test',
    MCC_UPDATE_APP_DIR: 'F:\\MCC_V1_FINAL',
  }, 'win32');
  assert.equal(rejectedDevelopment.enabled, false);
  assert.match(rejectedDevelopment.disabledReason, /managed Windows updater agent/);
  const allowedWindows = loadSystemUpdateConfiguration('Z:\\MCC_V1_FINAL', {
    MCC_UPDATE_MODE: 'windows_test',
    MCC_UPDATE_APP_DIR: 'Z:\\MCC_V1_FINAL',
    MCC_UPDATE_STATE_DIR: 'Z:\\MCC_UPDATE\\state',
  }, 'win32');
  assert.equal(allowedWindows.enabled, false);
  assert.equal(allowedWindows.environmentLabel, 'UPDATER NOT CONFIGURED');
  assert.equal(allowedWindows.approvedRepository, APPROVED_UPDATE_REPOSITORY);

  const managedConfigurationDirectory = path.join(fixtureRoot, 'managed-configuration');
  fs.mkdirSync(managedConfigurationDirectory, { recursive: true });
  const managedConfigurationPath = path.join(managedConfigurationDirectory, 'config.json');
  const managedApplicationPath = 'C:\\MCC\\MCC_V1_FINAL';
  fs.writeFileSync(managedConfigurationPath, `${JSON.stringify({
    schemaVersion: 1,
    deploymentMode: 'WindowsProduction',
    applicationPath: managedApplicationPath,
    repository: APPROVED_UPDATE_REPOSITORY,
    remote: APPROVED_UPDATE_REMOTE,
    branch: APPROVED_UPDATE_BRANCH,
    port: APPROVED_MCC_PORT,
    mccTaskName: 'MaintenanceCommandCenter',
    updaterTaskName: 'MaintenanceCommandCenterUpdater',
    gitPath: approvedGitPath,
  }, null, 2)}\n`);
  const managedWindows = loadSystemUpdateConfiguration(managedApplicationPath, {
    NODE_ENV: 'test',
    MCC_UPDATE_MODE: 'windows_agent',
    MCC_UPDATE_WINDOWS_CONFIG: managedConfigurationPath,
  }, 'win32');
  assert.equal(managedWindows.enabled, true);
  assert.equal(managedWindows.configured, true);
  assert.equal(managedWindows.mode, 'windows_production');
  assert.equal(managedWindows.environmentLabel, 'WINDOWS 11 PRODUCTION');
  assert.equal(managedWindows.windowsRunnerPath, null);
  assert.match(managedWindows.windowsAgentHealthPath, /agent-health\.json$/);
  assert.match(managedWindows.statusWritePath, /request[\\/]api-status\.json$/);
  assert.match(managedWindows.windowsShutdownPath, /request[\\/]shutdown-request\.json$/);
  assert.equal(managedWindows.gitExecutable, approvedGitPath);

  const validManagedDocument = JSON.parse(fs.readFileSync(managedConfigurationPath, 'utf8'));
  delete validManagedDocument.gitPath;
  fs.writeFileSync(managedConfigurationPath, `${JSON.stringify(validManagedDocument, null, 2)}\n`);
  const missingManagedGit = loadSystemUpdateConfiguration(managedApplicationPath, {
    NODE_ENV: 'test',
    MCC_UPDATE_MODE: 'windows_agent',
    MCC_UPDATE_WINDOWS_CONFIG: managedConfigurationPath,
  }, 'win32');
  assert.equal(missingManagedGit.enabled, false);
  assert.equal(missingManagedGit.disabledCode, 'configuration_invalid');
  assert.equal(JSON.stringify(missingManagedGit).includes(approvedGitPath), false);

  validManagedDocument.gitPath = path.join(managedConfigurationDirectory, 'missing-git.exe');
  fs.writeFileSync(managedConfigurationPath, `${JSON.stringify(validManagedDocument, null, 2)}\n`);
  const invalidManagedGit = loadSystemUpdateConfiguration(managedApplicationPath, {
    NODE_ENV: 'test',
    MCC_UPDATE_MODE: 'windows_agent',
    MCC_UPDATE_WINDOWS_CONFIG: managedConfigurationPath,
  }, 'win32');
  assert.equal(invalidManagedGit.enabled, false);
  assert.equal(invalidManagedGit.disabledCode, 'configuration_invalid');
  assert.equal(JSON.stringify(invalidManagedGit).includes('missing-git.exe'), false);

  fs.writeFileSync(managedConfigurationPath, `${JSON.stringify({
    schemaVersion: 1,
    deploymentMode: 'WindowsTest',
    applicationPath: 'Z:\\MCC_V1_FINAL',
    repository: APPROVED_UPDATE_REPOSITORY,
    remote: APPROVED_UPDATE_REMOTE,
    branch: 'feature/windows-11-updater-agent',
    port: APPROVED_MCC_PORT,
    mccTaskName: 'MaintenanceCommandCenter',
    updaterTaskName: 'MaintenanceCommandCenterUpdater',
    gitPath: approvedGitPath,
  }, null, 2)}\n`);
  const managedWindowsTest = loadSystemUpdateConfiguration('Z:\\MCC_V1_FINAL', {
    NODE_ENV: 'test',
    MCC_UPDATE_MODE: 'windows_agent',
    MCC_UPDATE_WINDOWS_CONFIG: managedConfigurationPath,
  }, 'win32');
  assert.equal(managedWindowsTest.enabled, true);
  assert.equal(managedWindowsTest.mode, 'windows_test');
  assert.equal(managedWindowsTest.environmentLabel, 'WINDOWS TEST MODE');
  assert.equal(managedWindowsTest.branch, 'feature/windows-11-updater-agent');

  fs.writeFileSync(managedConfigurationPath, `${JSON.stringify({
    schemaVersion: 1,
    deploymentMode: 'WindowsProduction',
    applicationPath: managedApplicationPath,
    repository: APPROVED_UPDATE_REPOSITORY,
    remote: APPROVED_UPDATE_REMOTE,
    branch: 'feature/windows-11-updater-agent',
    port: APPROVED_MCC_PORT,
    mccTaskName: 'MaintenanceCommandCenter',
    updaterTaskName: 'MaintenanceCommandCenterUpdater',
    gitPath: approvedGitPath,
  }, null, 2)}\n`);
  const productionBranchOverride = loadSystemUpdateConfiguration(managedApplicationPath, {
    NODE_ENV: 'test',
    MCC_UPDATE_MODE: 'windows_agent',
    MCC_UPDATE_WINDOWS_CONFIG: managedConfigurationPath,
  }, 'win32');
  assert.equal(productionBranchOverride.enabled, false);
  assert.equal(productionBranchOverride.disabledCode, 'configuration_invalid');

  fs.writeFileSync(managedConfigurationPath, `${JSON.stringify({
    schemaVersion: 1,
    deploymentMode: 'WindowsTest',
    applicationPath: 'Z:\\MCC_V1_FINAL',
    repository: APPROVED_UPDATE_REPOSITORY,
    remote: APPROVED_UPDATE_REMOTE,
    branch: 'feature/../unsafe',
    port: APPROVED_MCC_PORT,
    mccTaskName: 'MaintenanceCommandCenter',
    updaterTaskName: 'MaintenanceCommandCenterUpdater',
    gitPath: approvedGitPath,
  }, null, 2)}\n`);
  const unsafeTestBranch = loadSystemUpdateConfiguration('Z:\\MCC_V1_FINAL', {
    NODE_ENV: 'test',
    MCC_UPDATE_MODE: 'windows_agent',
    MCC_UPDATE_WINDOWS_CONFIG: managedConfigurationPath,
  }, 'win32');
  assert.equal(unsafeTestBranch.enabled, false);
  assert.equal(unsafeTestBranch.disabledCode, 'configuration_invalid');

  fs.writeFileSync(managedConfigurationPath, `${JSON.stringify({
    schemaVersion: 1,
    deploymentMode: 'WindowsProduction',
    applicationPath: 'F:\\MCC_V1_FINAL',
    repository: APPROVED_UPDATE_REPOSITORY,
    remote: APPROVED_UPDATE_REMOTE,
    branch: APPROVED_UPDATE_BRANCH,
    port: APPROVED_MCC_PORT,
    mccTaskName: 'MaintenanceCommandCenter',
    updaterTaskName: 'MaintenanceCommandCenterUpdater',
    gitPath: approvedGitPath,
  }, null, 2)}\n`);
  const protectedManagedWindows = loadSystemUpdateConfiguration('F:\\MCC_V1_FINAL', {
    NODE_ENV: 'test',
    MCC_UPDATE_MODE: 'windows_agent',
    MCC_UPDATE_WINDOWS_CONFIG: managedConfigurationPath,
  }, 'win32');
  assert.equal(protectedManagedWindows.enabled, false);
  assert.equal(protectedManagedWindows.disabledCode, 'configuration_invalid');

  const configuredTestBranch = makeFixture('configured-test-branch', '1.2.1', 'feature/windows-11-updater-agent');
  const configuredTestTarget = advance(configuredTestBranch, '1.3.0');
  const configuredTestService = serviceFor(configuredTestBranch).service;
  const configuredTestStatus = configuredTestService.checkForUpdate({ id: 1, name: 'Owner Admin' });
  assert.equal(configuredTestStatus.target.commit, configuredTestTarget);
  const configuredTestQueued = configuredTestService.queueInstall(
    { id: 1, name: 'Owner Admin' },
    configuredTestStatus.checkToken,
  );
  assert.equal(configuredTestQueued.state, 'queued');
  const configuredTestRequest = JSON.parse(fs.readFileSync(configuration(configuredTestBranch).requestPath, 'utf8'));
  assert.equal(configuredTestRequest.source.branch, 'feature/windows-11-updater-agent');

  const current = makeFixture('current');
  const currentService = serviceFor(current).service;
  const currentStatus = currentService.checkForUpdate({ id: 1, name: 'Owner Admin' });
  assert.equal(currentStatus.code, 'up_to_date');
  assert.equal(currentStatus.state, 'idle');
  assert.equal(currentService.publicStatus(currentStatus).installedCommit, current.initialCommit.slice(0, 7));

  const restrictedPathFixture = makeFixture('restricted-path');
  const restrictedPathDirectory = path.join(restrictedPathFixture.directory, 'local-service-path');
  fs.mkdirSync(restrictedPathDirectory);
  const originalPath = process.env.PATH;
  process.env.PATH = restrictedPathDirectory;
  try {
    const protectedRunnerService = new SystemUpdateService(
      configuration(restrictedPathFixture),
      new MemorySystemUpdateStatusStore(),
      undefined,
      () => undefined,
      () => new Date('2026-07-29T12:00:00.000Z'),
    );
    assert.equal(protectedRunnerService.checkForUpdate({ id: 1, name: 'Owner Admin' }).code, 'up_to_date');
    const buildMetadata = createSystemUpdateGitRunner(configuration(restrictedPathFixture))(
      ['rev-parse', '--short=7', 'HEAD'],
      restrictedPathFixture.installed,
      2_000,
    );
    assert.equal(buildMetadata.status, 0);
    assert.match(buildMetadata.stdout.trim(), /^[0-9a-f]{7}$/i);
  } finally {
    process.env.PATH = originalPath;
  }

  const unavailableGitFixture = makeFixture('git-unavailable');
  const unavailableGitService = serviceFor(unavailableGitFixture, {
    gitRunner: () => ({ status: null, stdout: '', stderr: '', error: Object.assign(new Error('sensitive executable path'), { code: 'ENOENT' }) }),
  }).service;
  assert.throws(
    () => unavailableGitService.checkForUpdate({ id: 1, name: 'Owner Admin' }),
    error => error instanceof SystemUpdateError
      && error.code === 'update_check_failed'
      && error.internalDiagnostic === 'git_executable_unavailable'
      && !error.message.includes('sensitive executable path'),
  );
  assert.equal(unavailableGitService.readStatus().code, 'update_check_failed');
  assert.equal(unavailableGitService.readStatus().message.includes(approvedGitPath), false);

  const raspberryGit = createSystemUpdateGitRunner({ mode: 'raspberry_pi', gitExecutable: path.join(fixtureRoot, 'must-not-run') });
  const raspberryGitResult = raspberryGit(['--version'], root, 2_000);
  assert.equal(raspberryGitResult.status, 0, raspberryGitResult.stderr);

  const managedHealthFixture = makeFixture('managed-health');
  const managedHealthConfiguration = {
    ...configuration(managedHealthFixture),
    mode: 'windows_production',
    environmentLabel: 'WINDOWS 11 PRODUCTION',
    windowsRunnerPath: null,
    windowsAgentHealthPath: path.join(managedHealthFixture.directory, 'state', 'agent-health.json'),
  };
  fs.mkdirSync(path.dirname(managedHealthConfiguration.requestPath), { recursive: true });
  const managedHealthService = new SystemUpdateService(
    managedHealthConfiguration,
    new MemorySystemUpdateStatusStore(),
    gitRunner,
    () => undefined,
    () => new Date('2026-07-29T12:00:00.000Z'),
  );
  assert.equal(managedHealthService.publicStatus().code, 'updater_agent_offline');
  fs.writeFileSync(managedHealthConfiguration.windowsAgentHealthPath, `${JSON.stringify({
    schemaVersion: 1,
    checkedAt: '2026-07-29T11:59:50.000Z',
    agentHealthy: true,
    configurationValid: true,
    deploymentMode: 'WindowsProduction',
    applicationPathMatches: true,
    repositoryValid: true,
    branchValid: true,
    requestDirectoryAccessible: true,
    statusDirectoryAccessible: true,
    mccTaskInstalled: true,
    mccTaskRunning: false,
    updaterTaskInstalled: true,
  })}\n`);
  assert.equal(managedHealthService.publicStatus().code, 'mcc_service_not_running');
  fs.writeFileSync(managedHealthConfiguration.windowsAgentHealthPath, `${JSON.stringify({
    schemaVersion: 1,
    checkedAt: '2026-07-29T11:59:50.000Z',
    agentHealthy: true,
    configurationValid: true,
    deploymentMode: 'WindowsProduction',
    applicationPathMatches: true,
    repositoryValid: true,
    branchValid: true,
    requestDirectoryAccessible: true,
    statusDirectoryAccessible: true,
    mccTaskInstalled: true,
    mccTaskRunning: true,
    updaterTaskInstalled: true,
  })}\n`);
  assert.equal(managedHealthService.publicStatus().available, true);
  assert.equal(managedHealthService.publicStatus().environmentLabel, 'WINDOWS 11 PRODUCTION');

  const available = makeFixture('available');
  const availableTarget = advance(available, '1.3.0');
  let triggerCount = 0;
  const availableService = serviceFor(available, { trigger: () => { triggerCount += 1; } }).service;
  const availableStatus = availableService.checkForUpdate({ id: 2, name: 'Admin User' });
  assert.equal(availableStatus.code, 'update_available');
  assert.equal(availableStatus.target.commit, availableTarget);
  assert.ok(availableStatus.checkToken);
  const publicAvailable = availableService.publicStatus(availableStatus);
  assert.equal(publicAvailable.targetCommit, availableTarget.slice(0, 7));
  assert.equal(publicAvailable.targetCommit.length, 7);
  assert.equal(Object.hasOwn(publicAvailable, 'branch'), false);
  const queued = availableService.queueInstall({ id: 2, name: 'Admin User' }, availableStatus.checkToken);
  assert.equal(queued.state, 'queued');
  assert.equal(triggerCount, 1);
  const request = JSON.parse(fs.readFileSync(configuration(available).requestPath, 'utf8'));
  assert.deepEqual(request.source, {
    repository: available.remote,
    remote: 'origin',
    branch: 'main',
    port: 4273,
  });
  assert.equal(request.target.commit, availableTarget);
  expectCode(() => availableService.queueInstall({ id: 2, name: 'Admin User' }, availableStatus.checkToken), 'update_already_running');

  const existingRequest = makeFixture('existing-request');
  advance(existingRequest, '1.3.0');
  const existingRequestService = serviceFor(existingRequest).service;
  const existingRequestStatus = existingRequestService.checkForUpdate({ id: 2, name: 'Admin User' });
  fs.mkdirSync(path.dirname(configuration(existingRequest).requestPath), { recursive: true });
  fs.writeFileSync(configuration(existingRequest).requestPath, '{"existing":true}\n');
  expectCode(
    () => existingRequestService.queueInstall({ id: 2, name: 'Admin User' }, existingRequestStatus.checkToken),
    'update_already_running',
  );
  assert.equal(fs.readFileSync(configuration(existingRequest).requestPath, 'utf8'), '{"existing":true}\n');

  const sameVersion = makeFixture('same-version');
  git(sameVersion.seed, 'commit', '--allow-empty', '-m', 'new build same version');
  const sameTarget = git(sameVersion.seed, 'rev-parse', 'HEAD');
  git(sameVersion.seed, 'push', 'origin', 'main');
  const sameStatus = serviceFor(sameVersion).service.checkForUpdate({ id: 1, name: 'Owner Admin' });
  assert.equal(sameStatus.code, 'same_version_different_commit');
  assert.equal(sameStatus.target.commit, sameTarget);

  const staleTarget = makeFixture('stale-target');
  advance(staleTarget, '1.3.0');
  const staleService = serviceFor(staleTarget).service;
  const staleStatus = staleService.checkForUpdate({ id: 1, name: 'Owner Admin' });
  advance(staleTarget, '1.3.1');
  git(staleTarget.installed, 'fetch', '--no-tags', 'origin', '+refs/heads/main:refs/remotes/origin/main');
  expectCode(() => staleService.queueInstall({ id: 1, name: 'Owner Admin' }, staleStatus.checkToken), 'update_check_failed');

  const invalidVersion = makeFixture('invalid-version');
  writeManifest(invalidVersion.seed, 'not-semver');
  commit(invalidVersion.seed, 'invalid version');
  git(invalidVersion.seed, 'push', 'origin', 'main');
  expectCode(() => serviceFor(invalidVersion).service.checkForUpdate({ id: 1, name: 'Owner Admin' }), 'invalid_remote_version');

  const dirty = makeFixture('dirty');
  fs.writeFileSync(path.join(dirty.installed, 'private-secret-name.txt'), 'local work');
  const dirtyService = serviceFor(dirty).service;
  expectCode(() => dirtyService.checkForUpdate({ id: 1, name: 'Owner Admin' }), 'local_changes_block_update');
  const dirtyStatus = dirtyService.readStatus();
  assert.doesNotMatch(dirtyStatus.message, /private-secret-name/);
  assert.match(dirtyStatus.message, /1 item/);

  const unavailable = makeFixture('network');
  const offlineRemote = `${unavailable.remote}.offline`;
  fs.renameSync(unavailable.remote, offlineRemote);
  try {
    expectCode(() => serviceFor(unavailable).service.checkForUpdate({ id: 1, name: 'Owner Admin' }), 'network_unavailable');
  } finally {
    fs.renameSync(offlineRemote, unavailable.remote);
  }

  const rewritten = makeFixture('non-fast-forward');
  const unrelated = path.join(rewritten.directory, 'unrelated');
  fs.mkdirSync(unrelated);
  git(unrelated, 'init', '-b', 'main');
  git(unrelated, 'config', 'user.name', 'MCC Rewrite Test');
  git(unrelated, 'config', 'user.email', 'rewrite@example.com');
  writeManifest(unrelated, '2.0.0');
  commit(unrelated, 'unrelated history');
  git(unrelated, 'remote', 'add', 'origin', rewritten.remote);
  git(unrelated, 'push', '--force', 'origin', 'main');
  expectCode(() => serviceFor(rewritten).service.checkForUpdate({ id: 1, name: 'Owner Admin' }), 'remote_not_fast_forward');

  const overlap = makeFixture('overlap');
  advance(overlap, '1.3.0');
  let overlapService;
  let nestedChecked = false;
  const overlappingRunner = (args, cwd, timeoutMs) => {
    if (args[0] === 'fetch' && !nestedChecked) {
      nestedChecked = true;
      expectCode(() => overlapService.checkForUpdate({ id: 3, name: 'Second Admin' }), 'update_already_running');
    }
    return gitRunner(args, cwd, timeoutMs);
  };
  overlapService = serviceFor(overlap, { gitRunner: overlappingRunner }).service;
  assert.equal(overlapService.checkForUpdate({ id: 1, name: 'Owner Admin' }).code, 'update_available');
  assert.equal(nestedChecked, true);

  const rollbackStore = new MemorySystemUpdateStatusStore();
  const rollbackFixture = makeFixture('rollback-state');
  const rollbackService = serviceFor(rollbackFixture, { store: rollbackStore }).service;
  const timestamp = '2026-07-29T12:30:00.000Z';
  rollbackStore.write({
    schemaVersion: 1,
    jobId: 'rollback-job',
    state: 'rolled_back',
    code: 'rolled_back',
    message: 'The update failed. MCC was restored to the previous healthy version.',
    mode: 'windows_test',
    environmentLabel: 'WINDOWS TEST MODE',
    installed: { version: '1.2.1', commit: rollbackFixture.initialCommit },
    target: { version: '1.3.0', commit: 'a'.repeat(40) },
    requestedAt: timestamp,
    startedAt: timestamp,
    lastUpdatedAt: timestamp,
    completedAt: timestamp,
    requester: { id: 1, name: 'Owner Admin' },
    outcome: 'rolled_back',
    checkToken: null,
    checkExpiresAt: null,
    events: [{ id: 'rollback-job:rolled_back', state: 'rolled_back', at: timestamp, message: 'Previous version is healthy.' }],
  });
  const publicRollback = rollbackService.publicStatus();
  assert.equal(publicRollback.state, 'rolled_back');
  assert.equal(publicRollback.outcome, 'rolled_back');
  assert.equal(publicRollback.installedVersion, '1.2.1');

  const canonicalStatusPath = path.join(rollbackFixture.directory, 'agent-status', 'status.json');
  const apiStatusPath = path.join(rollbackFixture.directory, 'request', 'api-status.json');
  fs.mkdirSync(path.dirname(canonicalStatusPath), { recursive: true });
  fs.mkdirSync(path.dirname(apiStatusPath), { recursive: true });
  const canonicalStatus = rollbackStore.read();
  fs.writeFileSync(canonicalStatusPath, `${JSON.stringify(canonicalStatus, null, 2)}\n`);
  const mergedStore = new JsonSystemUpdateStatusStore(canonicalStatusPath, apiStatusPath);
  const apiStatus = {
    ...canonicalStatus,
    state: 'idle',
    code: 'up_to_date',
    message: 'API check state.',
    lastUpdatedAt: '2026-07-29T12:31:00.000Z',
    completedAt: '2026-07-29T12:31:00.000Z',
    outcome: 'none',
  };
  mergedStore.write(apiStatus);
  assert.equal(mergedStore.read().code, 'up_to_date');
  assert.equal(JSON.parse(fs.readFileSync(canonicalStatusPath, 'utf8')).state, 'rolled_back');
  assert.equal(JSON.parse(fs.readFileSync(apiStatusPath, 'utf8')).code, 'up_to_date');

  console.log('System update service tests passed: comparison, dirty/network/history rejection, lock/duplicate handling, fixed configuration, sanitization, queueing, and rollback state.');
} finally {
  const resolvedFixture = path.resolve(fixtureRoot);
  const allowedRoot = path.resolve(root, 'tmp');
  if (resolvedFixture.startsWith(`${allowedRoot}${path.sep}`) && fs.existsSync(resolvedFixture)) {
    fs.rmSync(resolvedFixture, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
