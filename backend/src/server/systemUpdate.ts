import crypto from 'node:crypto';
import { spawn, spawnSync, type SpawnSyncReturns } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const APPROVED_UPDATE_REPOSITORY = 'https://github.com/Recklessrage17/maintenance-command-center.git';
export const APPROVED_UPDATE_REMOTE = 'origin';
export const APPROVED_UPDATE_BRANCH = 'main';
export const APPROVED_MCC_PORT = 4273;

export const systemUpdateStates = [
  'idle',
  'checking',
  'update_available',
  'queued',
  'backing_up',
  'stopping',
  'pulling',
  'installing_dependencies',
  'building',
  'starting',
  'health_check',
  'succeeded',
  'rolling_back',
  'rolled_back',
  'failed',
] as const;

export type SystemUpdateState = typeof systemUpdateStates[number];
export type SystemUpdateMode = 'disabled' | 'raspberry_pi' | 'windows_test';
export type SystemUpdateCode =
  | 'not_checked'
  | 'checking'
  | 'update_available'
  | 'up_to_date'
  | 'network_unavailable'
  | 'update_check_failed'
  | 'local_changes_block_update'
  | 'remote_not_fast_forward'
  | 'invalid_remote_version'
  | 'same_version_different_commit'
  | 'remote_version_behind'
  | 'update_already_running'
  | 'deployment_not_configured'
  | 'queued'
  | 'succeeded'
  | 'rolled_back'
  | 'failed';

export type UpdateIdentity = {
  id: number;
  name: string;
};

export type UpdateVersionRef = {
  version: string | null;
  commit: string | null;
};

export type SystemUpdateEvent = {
  id: string;
  state: SystemUpdateState;
  at: string;
  message: string;
};

export type SystemUpdateStatus = {
  schemaVersion: 1;
  jobId: string | null;
  state: SystemUpdateState;
  code: SystemUpdateCode;
  message: string;
  mode: SystemUpdateMode;
  environmentLabel: string;
  installed: UpdateVersionRef;
  target: UpdateVersionRef;
  startedAt: string | null;
  lastUpdatedAt: string;
  completedAt: string | null;
  requester: UpdateIdentity | null;
  outcome: 'none' | 'succeeded' | 'rolled_back' | 'failed';
  checkToken: string | null;
  checkExpiresAt: string | null;
  events: SystemUpdateEvent[];
};

export type PublicSystemUpdateStatus = {
  ok: true;
  configured: boolean;
  state: SystemUpdateState;
  code: SystemUpdateCode;
  message: string;
  mode: SystemUpdateMode;
  environmentLabel: string;
  installedVersion: string | null;
  installedCommit: string | null;
  targetVersion: string | null;
  targetCommit: string | null;
  startedAt: string | null;
  lastUpdatedAt: string;
  completedAt: string | null;
  requester: UpdateIdentity | null;
  outcome: SystemUpdateStatus['outcome'];
  checkToken: string | null;
  checkExpiresAt: string | null;
  active: boolean;
};

export type SystemUpdateConfiguration = {
  enabled: boolean;
  disabledReason: string;
  mode: SystemUpdateMode;
  environmentLabel: string;
  applicationDir: string;
  statusPath: string | null;
  requestPath: string | null;
  windowsRunnerPath: string | null;
  windowsConfigPath: string | null;
  approvedRepository: typeof APPROVED_UPDATE_REPOSITORY;
  remote: typeof APPROVED_UPDATE_REMOTE;
  branch: typeof APPROVED_UPDATE_BRANCH;
  port: typeof APPROVED_MCC_PORT;
};

type GitResult = Pick<SpawnSyncReturns<string>, 'status' | 'stdout' | 'stderr' | 'error'>;
export type SystemUpdateGitRunner = (args: string[], cwd: string, timeoutMs?: number) => GitResult;
export type SystemUpdateTrigger = (configuration: SystemUpdateConfiguration) => void;

export interface SystemUpdateStatusStore {
  read(): SystemUpdateStatus | null;
  write(status: SystemUpdateStatus): void;
}

export class SystemUpdateError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly code: SystemUpdateCode,
    message: string,
  ) {
    super(message);
  }
}

const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const commitPattern = /^[0-9a-f]{40}$/i;
const activeInstallStates = new Set<SystemUpdateState>([
  'queued',
  'backing_up',
  'stopping',
  'pulling',
  'installing_dependencies',
  'building',
  'starting',
  'health_check',
  'rolling_back',
]);

function cleanText(value: unknown, maximum = 240) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function shortCommit(value: string | null) {
  return value && commitPattern.test(value) ? value.slice(0, 7) : null;
}

export function isStrictSemver(value: unknown): value is string {
  return typeof value === 'string' && semverPattern.test(value);
}

export function compareSemver(left: string, right: string) {
  if (!isStrictSemver(left) || !isStrictSemver(right)) throw new Error('Semantic version is invalid.');
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] > rightParts[index] ? 1 : -1;
  }
  return 0;
}

function canonicalRepositoryUrl(value: string) {
  return value.trim().replace(/\/+$/, '').toLowerCase();
}

function sameWindowsPath(left: string, right: string) {
  return path.win32.resolve(left).replace(/[\\/]+$/, '').toLowerCase()
    === path.win32.resolve(right).replace(/[\\/]+$/, '').toLowerCase();
}

function disabledConfiguration(applicationDir: string, reason: string): SystemUpdateConfiguration {
  return {
    enabled: false,
    disabledReason: reason,
    mode: 'disabled',
    environmentLabel: 'UPDATE CONTROL DISABLED',
    applicationDir,
    statusPath: null,
    requestPath: null,
    windowsRunnerPath: null,
    windowsConfigPath: null,
    approvedRepository: APPROVED_UPDATE_REPOSITORY,
    remote: APPROVED_UPDATE_REMOTE,
    branch: APPROVED_UPDATE_BRANCH,
    port: APPROVED_MCC_PORT,
  };
}

export function loadSystemUpdateConfiguration(
  applicationDir: string,
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): SystemUpdateConfiguration {
  const resolvedApplicationDir = path.resolve(applicationDir);
  const requestedMode = cleanText(environment.MCC_UPDATE_MODE, 40).toLowerCase();
  if (!requestedMode) return disabledConfiguration(resolvedApplicationDir, 'The updater is not configured in this environment.');

  if (requestedMode === 'raspberry_pi') {
    if (platform !== 'linux') return disabledConfiguration(resolvedApplicationDir, 'Raspberry Pi production mode requires Linux.');
    const configuredApplicationDir = path.resolve(environment.MCC_UPDATE_APP_DIR || resolvedApplicationDir);
    if (configuredApplicationDir !== resolvedApplicationDir) {
      return disabledConfiguration(resolvedApplicationDir, 'The configured production application directory does not match the running MCC build.');
    }
    const stateDir = path.resolve(environment.MCC_UPDATE_STATE_DIR || '/var/lib/mcc-update');
    return {
      enabled: true,
      disabledReason: '',
      mode: 'raspberry_pi',
      environmentLabel: 'RASPBERRY PI PRODUCTION',
      applicationDir: resolvedApplicationDir,
      statusPath: path.join(stateDir, 'status.json'),
      requestPath: path.join(stateDir, 'request.json'),
      windowsRunnerPath: null,
      windowsConfigPath: null,
      approvedRepository: APPROVED_UPDATE_REPOSITORY,
      remote: APPROVED_UPDATE_REMOTE,
      branch: APPROVED_UPDATE_BRANCH,
      port: APPROVED_MCC_PORT,
    };
  }

  if (requestedMode === 'windows_test') {
    if (platform !== 'win32') return disabledConfiguration(resolvedApplicationDir, 'Windows test mode requires Windows.');
    const requiredApplicationDir = 'Z:\\MCC_V1_FINAL';
    const configuredApplicationDir = environment.MCC_UPDATE_APP_DIR || '';
    if (!configuredApplicationDir || !sameWindowsPath(configuredApplicationDir, requiredApplicationDir) || !sameWindowsPath(resolvedApplicationDir, requiredApplicationDir)) {
      return disabledConfiguration(resolvedApplicationDir, 'Windows test mode is restricted to Z:\\MCC_V1_FINAL.');
    }
    const stateDir = path.win32.resolve(environment.MCC_UPDATE_STATE_DIR || 'Z:\\MCC_UPDATE\\state');
    const runnerPath = path.win32.resolve(environment.MCC_UPDATE_WINDOWS_RUNNER || 'Z:\\MCC_UPDATE\\Invoke-MccTestUpdate.ps1');
    const configPath = path.win32.resolve(environment.MCC_UPDATE_WINDOWS_CONFIG || 'Z:\\MCC_UPDATE\\config.json');
    if (path.win32.parse(stateDir).root.toUpperCase() !== 'Z:\\'
      || path.win32.parse(runnerPath).root.toUpperCase() !== 'Z:\\'
      || path.win32.parse(configPath).root.toUpperCase() !== 'Z:\\'
      || path.win32.basename(runnerPath).toLowerCase() !== 'invoke-mcctestupdate.ps1') {
      return disabledConfiguration(resolvedApplicationDir, 'Windows test updater files must remain on the isolated Z: test drive.');
    }
    return {
      enabled: true,
      disabledReason: '',
      mode: 'windows_test',
      environmentLabel: 'WINDOWS TEST MODE',
      applicationDir: path.win32.resolve(requiredApplicationDir),
      statusPath: path.win32.join(stateDir, 'status.json'),
      requestPath: path.win32.join(stateDir, 'request.json'),
      windowsRunnerPath: runnerPath,
      windowsConfigPath: configPath,
      approvedRepository: APPROVED_UPDATE_REPOSITORY,
      remote: APPROVED_UPDATE_REMOTE,
      branch: APPROVED_UPDATE_BRANCH,
      port: APPROVED_MCC_PORT,
    };
  }

  return disabledConfiguration(resolvedApplicationDir, 'MCC_UPDATE_MODE must be raspberry_pi or windows_test.');
}

export class JsonSystemUpdateStatusStore implements SystemUpdateStatusStore {
  constructor(private readonly statusPath: string) {}

  read() {
    try {
      if (!fs.existsSync(this.statusPath)) return null;
      return normalizeStatus(JSON.parse(fs.readFileSync(this.statusPath, 'utf8')));
    } catch {
      return null;
    }
  }

  write(status: SystemUpdateStatus) {
    const directory = path.dirname(this.statusPath);
    fs.mkdirSync(directory, { recursive: true });
    const temporaryPath = path.join(directory, `.${path.basename(this.statusPath)}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`);
    fs.writeFileSync(temporaryPath, `${JSON.stringify(status, null, 2)}\n`, { encoding: 'utf8', mode: 0o640, flag: 'wx' });
    fs.renameSync(temporaryPath, this.statusPath);
    try {
      fs.chmodSync(this.statusPath, 0o640);
    } catch {
      // Windows ACLs are configured by the deployment helper rather than POSIX mode bits.
    }
  }
}

export class MemorySystemUpdateStatusStore implements SystemUpdateStatusStore {
  private value: SystemUpdateStatus | null = null;
  read() { return this.value ? structuredClone(this.value) : null; }
  write(status: SystemUpdateStatus) { this.value = structuredClone(status); }
}

function normalizeVersionRef(value: unknown): UpdateVersionRef {
  const item = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    version: isStrictSemver(item.version) ? item.version : null,
    commit: typeof item.commit === 'string' && commitPattern.test(item.commit) ? item.commit.toLowerCase() : null,
  };
}

function normalizeStatus(value: unknown): SystemUpdateStatus | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (item.schemaVersion !== 1 || !systemUpdateStates.includes(item.state as SystemUpdateState)) return null;
  const mode: SystemUpdateMode = ['disabled','raspberry_pi','windows_test'].includes(String(item.mode)) ? item.mode as SystemUpdateMode : 'disabled';
  const events = Array.isArray(item.events) ? item.events.flatMap(raw => {
    if (!raw || typeof raw !== 'object') return [];
    const event = raw as Record<string, unknown>;
    if (!systemUpdateStates.includes(event.state as SystemUpdateState)) return [];
    const id = cleanText(event.id, 120);
    const at = cleanText(event.at, 40);
    return id && at ? [{ id, state: event.state as SystemUpdateState, at, message: cleanText(event.message) }] : [];
  }).slice(-80) : [];
  return {
    schemaVersion: 1,
    jobId: item.jobId ? cleanText(item.jobId, 120) : null,
    state: item.state as SystemUpdateState,
    code: cleanText(item.code, 80) as SystemUpdateCode,
    message: cleanText(item.message),
    mode,
    environmentLabel: cleanText(item.environmentLabel, 80),
    installed: normalizeVersionRef(item.installed),
    target: normalizeVersionRef(item.target),
    startedAt: item.startedAt ? cleanText(item.startedAt, 40) : null,
    lastUpdatedAt: cleanText(item.lastUpdatedAt, 40),
    completedAt: item.completedAt ? cleanText(item.completedAt, 40) : null,
    requester: item.requester && typeof item.requester === 'object' ? {
      id: Math.max(0, Number((item.requester as Record<string, unknown>).id) || 0),
      name: cleanText((item.requester as Record<string, unknown>).name, 120),
    } : null,
    outcome: ['none','succeeded','rolled_back','failed'].includes(String(item.outcome)) ? item.outcome as SystemUpdateStatus['outcome'] : 'none',
    checkToken: item.checkToken ? cleanText(item.checkToken, 160) : null,
    checkExpiresAt: item.checkExpiresAt ? cleanText(item.checkExpiresAt, 40) : null,
    events,
  };
}

function readManifestVersion(manifestText: string) {
  try {
    const manifest = JSON.parse(manifestText) as { version?: unknown };
    return isStrictSemver(manifest.version) ? manifest.version : null;
  } catch {
    return null;
  }
}

function defaultGitRunner(args: string[], cwd: string, timeoutMs = 12_000): GitResult {
  return spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  });
}

function requireGitOutput(result: GitResult, message: string) {
  if (result.status !== 0) throw new SystemUpdateError(503, 'update_check_failed', message);
  return result.stdout.trim();
}

function baseStatus(configuration: SystemUpdateConfiguration, nowValue: string, installed: UpdateVersionRef): SystemUpdateStatus {
  return {
    schemaVersion: 1,
    jobId: null,
    state: 'idle',
    code: configuration.enabled ? 'not_checked' : 'deployment_not_configured',
    message: configuration.enabled ? 'Check the approved origin/main branch for MCC updates.' : configuration.disabledReason,
    mode: configuration.mode,
    environmentLabel: configuration.environmentLabel,
    installed,
    target: { version: null, commit: null },
    startedAt: null,
    lastUpdatedAt: nowValue,
    completedAt: null,
    requester: null,
    outcome: 'none',
    checkToken: null,
    checkExpiresAt: null,
    events: [],
  };
}

export class SystemUpdateService {
  private checkLocked = false;

  constructor(
    public readonly configuration: SystemUpdateConfiguration,
    private readonly store: SystemUpdateStatusStore,
    private readonly git: SystemUpdateGitRunner = defaultGitRunner,
    private readonly trigger: SystemUpdateTrigger = triggerConfiguredSystemUpdate,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private now() { return this.clock().toISOString(); }

  private localInstalledRef(): UpdateVersionRef {
    let version: string | null = null;
    try {
      version = readManifestVersion(fs.readFileSync(path.join(this.configuration.applicationDir, 'package.json'), 'utf8'));
    } catch {
      version = null;
    }
    const result = this.git(['rev-parse', 'HEAD'], this.configuration.applicationDir, 2_000);
    const commit = result.status === 0 && commitPattern.test(result.stdout.trim()) ? result.stdout.trim().toLowerCase() : null;
    return { version, commit };
  }

  readStatus() {
    return this.store.read() ?? baseStatus(this.configuration, this.now(), this.localInstalledRef());
  }

  publicStatus(status = this.readStatus()): PublicSystemUpdateStatus {
    return {
      ok: true,
      configured: this.configuration.enabled,
      state: status.state,
      code: status.code,
      message: cleanText(status.message),
      mode: status.mode,
      environmentLabel: status.environmentLabel,
      installedVersion: status.installed.version,
      installedCommit: shortCommit(status.installed.commit),
      targetVersion: status.target.version,
      targetCommit: shortCommit(status.target.commit),
      startedAt: status.startedAt,
      lastUpdatedAt: status.lastUpdatedAt,
      completedAt: status.completedAt,
      requester: status.requester ? { id: status.requester.id, name: cleanText(status.requester.name, 120) } : null,
      outcome: status.outcome,
      checkToken: status.code === 'update_available' || status.code === 'same_version_different_commit' ? status.checkToken : null,
      checkExpiresAt: status.code === 'update_available' || status.code === 'same_version_different_commit' ? status.checkExpiresAt : null,
      active: activeInstallStates.has(status.state) || status.state === 'checking',
    };
  }

  private write(status: SystemUpdateStatus) {
    this.store.write(status);
    return status;
  }

  private repositoryIdentity() {
    const remoteResult = this.git(['remote', 'get-url', this.configuration.remote], this.configuration.applicationDir);
    const remoteUrl = requireGitOutput(remoteResult, 'Update check failed while validating the approved repository.');
    if (canonicalRepositoryUrl(remoteUrl) !== canonicalRepositoryUrl(this.configuration.approvedRepository)) {
      throw new SystemUpdateError(409, 'update_check_failed', 'Update blocked: this MCC installation is not connected to the approved repository.');
    }
    const branchResult = this.git(['branch', '--show-current'], this.configuration.applicationDir);
    const branch = requireGitOutput(branchResult, 'Update check failed while validating the installed branch.');
    if (branch !== this.configuration.branch) {
      throw new SystemUpdateError(409, 'update_check_failed', `Update blocked: the production checkout must be on ${this.configuration.branch}.`);
    }
  }

  private cleanWorkingTree() {
    const result = this.git(['status', '--porcelain=v1', '--untracked-files=normal'], this.configuration.applicationDir);
    const output = requireGitOutput(result, 'Update check failed while inspecting local changes.');
    if (output) {
      const changedItems = output.split(/\r?\n/).filter(Boolean).length;
      throw new SystemUpdateError(
        409,
        'local_changes_block_update',
        `Update blocked: this MCC installation contains local code changes (${changedItems} item${changedItems === 1 ? '' : 's'}). Protect or review those changes before updating.`,
      );
    }
  }

  private inspectedRepository(fetchRemote: boolean) {
    if (!this.configuration.enabled) {
      throw new SystemUpdateError(503, 'deployment_not_configured', this.configuration.disabledReason);
    }
    this.repositoryIdentity();
    this.cleanWorkingTree();
    const installed = this.localInstalledRef();
    if (!installed.version || !installed.commit) {
      throw new SystemUpdateError(503, 'update_check_failed', 'Update check failed because the installed version or build metadata is unavailable.');
    }
    if (fetchRemote) {
      const fetchResult = this.git([
        'fetch',
        '--no-tags',
        this.configuration.remote,
        `+refs/heads/${this.configuration.branch}:refs/remotes/${this.configuration.remote}/${this.configuration.branch}`,
      ], this.configuration.applicationDir, 20_000);
      if (fetchResult.status !== 0) {
        throw new SystemUpdateError(503, 'network_unavailable', 'The approved GitHub update source is unavailable. Try again later.');
      }
    }
    const targetResult = this.git(['rev-parse', `refs/remotes/${this.configuration.remote}/${this.configuration.branch}`], this.configuration.applicationDir);
    const targetCommit = requireGitOutput(targetResult, 'Update check failed while reading the approved remote commit.').toLowerCase();
    if (!commitPattern.test(targetCommit)) {
      throw new SystemUpdateError(503, 'update_check_failed', 'Update check failed because the approved remote commit is invalid.');
    }
    const manifestResult = this.git(['show', `${targetCommit}:package.json`], this.configuration.applicationDir);
    const remoteManifest = requireGitOutput(manifestResult, 'Update check failed while reading remote version metadata.');
    const targetVersion = readManifestVersion(remoteManifest);
    if (!targetVersion) {
      throw new SystemUpdateError(409, 'invalid_remote_version', 'Update blocked: the approved remote version metadata is invalid.');
    }
    if (targetCommit !== installed.commit) {
      const ancestry = this.git(['merge-base', '--is-ancestor', installed.commit, targetCommit], this.configuration.applicationDir);
      if (ancestry.status === 1) {
        throw new SystemUpdateError(409, 'remote_not_fast_forward', 'Update blocked: origin/main is not a fast-forward from the installed build.');
      }
      if (ancestry.status !== 0) {
        throw new SystemUpdateError(503, 'update_check_failed', 'Update check failed while verifying remote history.');
      }
    }
    return { installed, target: { version: targetVersion, commit: targetCommit } };
  }

  checkForUpdate(requester: UpdateIdentity) {
    const current = this.readStatus();
    if (activeInstallStates.has(current.state)) {
      throw new SystemUpdateError(409, 'update_already_running', 'An MCC update is already running.');
    }
    const persistedCheckIsFresh = current.state === 'checking'
      && this.clock().getTime() - Date.parse(current.lastUpdatedAt) < 2 * 60 * 1000;
    if (this.checkLocked || persistedCheckIsFresh) {
      throw new SystemUpdateError(409, 'update_already_running', 'An MCC update check is already running.');
    }
    this.checkLocked = true;
    const startedAt = this.now();
    this.write({
      ...current,
      state: 'checking',
      code: 'checking',
      message: 'Checking the approved origin/main branch for updates.',
      requester,
      lastUpdatedAt: startedAt,
      checkToken: null,
      checkExpiresAt: null,
    });
    try {
      const comparison = this.inspectedRepository(true);
      const checkedAt = this.now();
      if (comparison.installed.commit === comparison.target.commit) {
        return this.write({
          ...this.readStatus(),
          state: 'idle',
          code: 'up_to_date',
          message: 'MCC is up to date with the approved origin/main branch.',
          installed: comparison.installed,
          target: comparison.target,
          requester,
          lastUpdatedAt: checkedAt,
          completedAt: checkedAt,
          outcome: 'none',
          checkToken: null,
          checkExpiresAt: null,
        });
      }
      const versionComparison = compareSemver(comparison.target.version!, comparison.installed.version!);
      if (versionComparison < 0) {
        return this.write({
          ...this.readStatus(),
          state: 'idle',
          code: 'remote_version_behind',
          message: 'Update blocked: origin/main reports a version older than the installed MCC version.',
          installed: comparison.installed,
          target: comparison.target,
          requester,
          lastUpdatedAt: checkedAt,
          completedAt: checkedAt,
          outcome: 'none',
          checkToken: null,
          checkExpiresAt: null,
        });
      }
      const sameVersion = versionComparison === 0;
      return this.write({
        ...this.readStatus(),
        state: 'update_available',
        code: sameVersion ? 'same_version_different_commit' : 'update_available',
        message: sameVersion
          ? 'A newer approved build is available with the same MCC version number.'
          : `MCC v${comparison.target.version} is available from the approved origin/main branch.`,
        installed: comparison.installed,
        target: comparison.target,
        requester,
        lastUpdatedAt: checkedAt,
        completedAt: checkedAt,
        outcome: 'none',
        checkToken: crypto.randomBytes(32).toString('base64url'),
        checkExpiresAt: new Date(this.clock().getTime() + 10 * 60 * 1000).toISOString(),
      });
    } catch (error) {
      const failure = error instanceof SystemUpdateError
        ? error
        : new SystemUpdateError(503, 'update_check_failed', 'The MCC update check failed. Try again or review the deployment service logs.');
      const failedAt = this.now();
      this.write({
        ...this.readStatus(),
        state: 'idle',
        code: failure.code,
        message: failure.message,
        requester,
        lastUpdatedAt: failedAt,
        completedAt: failedAt,
        outcome: 'none',
        checkToken: null,
        checkExpiresAt: null,
      });
      throw failure;
    } finally {
      this.checkLocked = false;
    }
  }

  queueInstall(requester: UpdateIdentity, checkToken: string) {
    const current = this.readStatus();
    if (activeInstallStates.has(current.state)) {
      throw new SystemUpdateError(409, 'update_already_running', 'An MCC update is already running.');
    }
    if (!this.configuration.enabled || !this.configuration.requestPath) {
      throw new SystemUpdateError(503, 'deployment_not_configured', this.configuration.disabledReason);
    }
    if (!current.checkToken || !current.checkExpiresAt || !current.target.commit || !current.target.version
      || !['update_available','same_version_different_commit'].includes(current.code)
      || current.state !== 'update_available') {
      throw new SystemUpdateError(409, 'update_check_failed', 'Run a successful update check before installing.');
    }
    const supplied = Buffer.from(cleanText(checkToken, 160));
    const expected = Buffer.from(current.checkToken);
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected) || Date.parse(current.checkExpiresAt) <= this.clock().getTime()) {
      throw new SystemUpdateError(409, 'update_check_failed', 'The verified update check is stale. Check for updates again.');
    }
    this.repositoryIdentity();
    this.cleanWorkingTree();
    const refreshResult = this.git([
      'fetch',
      '--no-tags',
      this.configuration.remote,
      `+refs/heads/${this.configuration.branch}:refs/remotes/${this.configuration.remote}/${this.configuration.branch}`,
    ], this.configuration.applicationDir, 20_000);
    if (refreshResult.status !== 0) {
      throw new SystemUpdateError(503, 'network_unavailable', 'The approved GitHub update source is unavailable. Check for updates again later.');
    }
    const installedResult = this.git(['rev-parse', 'HEAD'], this.configuration.applicationDir);
    const targetResult = this.git(['rev-parse', `refs/remotes/${this.configuration.remote}/${this.configuration.branch}`], this.configuration.applicationDir);
    if (installedResult.status !== 0 || targetResult.status !== 0
      || installedResult.stdout.trim().toLowerCase() !== current.installed.commit
      || targetResult.stdout.trim().toLowerCase() !== current.target.commit) {
      throw new SystemUpdateError(409, 'update_check_failed', 'The verified update target is stale. Check for updates again.');
    }

    const queuedAt = this.now();
    const jobId = crypto.randomUUID();
    const queuedStatus: SystemUpdateStatus = {
      ...current,
      jobId,
      state: 'queued',
      code: 'queued',
      message: 'The MCC update is queued for the external update runner.',
      requester,
      startedAt: queuedAt,
      lastUpdatedAt: queuedAt,
      completedAt: null,
      outcome: 'none',
      checkToken: null,
      checkExpiresAt: null,
      events: [{
        id: `${jobId}:queued`,
        state: 'queued',
        at: queuedAt,
        message: 'Update request accepted by MCC.',
      }],
    };
    try {
      this.writeRequest({
        schemaVersion: 1,
        jobId,
        requestedAt: queuedAt,
        requester,
        installed: current.installed,
        target: current.target,
        source: {
          repository: this.configuration.approvedRepository,
          remote: this.configuration.remote,
          branch: this.configuration.branch,
          port: this.configuration.port,
        },
      });
      this.write(queuedStatus);
      this.trigger(this.configuration);
    } catch {
      const failedAt = this.now();
      try {
        if (this.configuration.requestPath && fs.existsSync(this.configuration.requestPath)) fs.rmSync(this.configuration.requestPath, { force: true });
      } catch {
        // The failed request remains inert unless the fixed external service is explicitly started.
      }
      const failedStatus: SystemUpdateStatus = {
        ...queuedStatus,
        state: 'failed',
        code: 'failed',
        message: 'The fixed external MCC update runner could not be started.',
        lastUpdatedAt: failedAt,
        completedAt: failedAt,
        outcome: 'failed',
        events: [...queuedStatus.events, {
          id: `${jobId}:failed_to_start`,
          state: 'failed',
          at: failedAt,
          message: 'External update runner failed to start.',
        }],
      };
      try {
        this.write(failedStatus);
      } catch {
        // The API still returns a sanitized failure when persistent storage itself is unavailable.
      }
      throw new SystemUpdateError(503, 'failed', failedStatus.message);
    }
    return queuedStatus;
  }

  private writeRequest(request: Record<string, unknown>) {
    const requestPath = this.configuration.requestPath!;
    const directory = path.dirname(requestPath);
    fs.mkdirSync(directory, { recursive: true });
    const temporaryPath = path.join(directory, `.${path.basename(requestPath)}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`);
    try {
      fs.writeFileSync(temporaryPath, `${JSON.stringify(request, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      fs.renameSync(temporaryPath, requestPath);
      try {
        fs.chmodSync(requestPath, 0o600);
      } catch {
        // Windows ACLs are configured during deployment.
      }
    } finally {
      try {
        if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
      } catch {
        // A uniquely named inert temporary request may be removed by the deployment operator.
      }
    }
  }
}

export function triggerConfiguredSystemUpdate(configuration: SystemUpdateConfiguration) {
  if (configuration.mode === 'raspberry_pi') {
    const result = spawnSync('/usr/bin/sudo', ['-n', '/usr/bin/systemctl', 'start', 'mcc-update-request.service'], {
      encoding: 'utf8',
      timeout: 5_000,
      windowsHide: true,
      stdio: 'ignore',
    });
    if (result.status !== 0) throw new Error('The fixed Raspberry Pi update request service could not be started.');
    return;
  }
  if (configuration.mode === 'windows_test' && configuration.windowsRunnerPath && configuration.windowsConfigPath) {
    if (!fs.existsSync(configuration.windowsRunnerPath) || !fs.existsSync(configuration.windowsConfigPath)) {
      throw new Error('The fixed Windows MCC update runner or configuration is missing.');
    }
    const child = spawn('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'RemoteSigned',
      '-File',
      configuration.windowsRunnerPath,
      '-ConfigurationPath',
      configuration.windowsConfigPath,
    ], {
      cwd: 'Z:\\MCC_UPDATE',
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
    });
    child.once('error', () => undefined);
    child.unref();
    return;
  }
  throw new Error('The external MCC update runner is not configured.');
}
