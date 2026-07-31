import crypto from 'node:crypto';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
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
export type SystemUpdateMode = 'disabled' | 'raspberry_pi' | 'windows_test' | 'windows_production';
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
  | 'updater_agent_offline'
  | 'configuration_invalid'
  | 'mcc_service_not_running'
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
  requestedAt: string | null;
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
  requestedAt: string | null;
  lastUpdatedAt: string;
  completedAt: string | null;
  requester: UpdateIdentity | null;
  outcome: SystemUpdateStatus['outcome'];
  checkToken: string | null;
  checkExpiresAt: string | null;
  active: boolean;
  available: boolean;
};

export type SystemUpdateConfiguration = {
  enabled: boolean;
  configured: boolean;
  disabledReason: string;
  disabledCode: SystemUpdateCode;
  mode: SystemUpdateMode;
  environmentLabel: string;
  applicationDir: string;
  statusPath: string | null;
  statusWritePath: string | null;
  requestPath: string | null;
  windowsRunnerPath: string | null;
  windowsConfigPath: string | null;
  windowsAgentHealthPath: string | null;
  windowsShutdownPath: string | null;
  gitExecutable: string;
  approvedRepository: typeof APPROVED_UPDATE_REPOSITORY;
  remote: typeof APPROVED_UPDATE_REMOTE;
  branch: string;
  port: typeof APPROVED_MCC_PORT;
};

type GitResult = Pick<SpawnSyncReturns<string>, 'status' | 'stdout' | 'stderr' | 'error'>;
export type SystemUpdateGitRunner = (args: string[], cwd: string, timeoutMs?: number) => GitResult;
export type SystemUpdateTrigger = (configuration: SystemUpdateConfiguration) => void;
export type SystemUpdateInternalDiagnostic = 'git_executable_unavailable';

export interface SystemUpdateStatusStore {
  read(): SystemUpdateStatus | null;
  write(status: SystemUpdateStatus): void;
}

export class SystemUpdateError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly code: SystemUpdateCode,
    message: string,
    public readonly internalDiagnostic: SystemUpdateInternalDiagnostic | null = null,
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

export function isSafeUpdateBranch(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 200
    || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value)
    || value.endsWith('/') || value.endsWith('.')
    || value.includes('..') || value.includes('//') || value.includes('@{')) {
    return false;
  }
  return value.split('/').every(segment => segment.length > 0
    && !segment.startsWith('.')
    && !segment.toLowerCase().endsWith('.lock'));
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

export function isProtectedWindowsDevelopmentPath(value: string) {
  const normalized = path.win32.resolve(value);
  return path.win32.parse(normalized).root.toUpperCase() === 'F:\\';
}

function disabledConfiguration(
  applicationDir: string,
  reason: string,
  code: SystemUpdateCode = 'deployment_not_configured',
  configured = false,
  mode: SystemUpdateMode = 'disabled',
  environmentLabel = code === 'deployment_not_configured' ? 'UPDATER NOT CONFIGURED' : 'CONFIGURATION INVALID',
): SystemUpdateConfiguration {
  return {
    enabled: false,
    configured,
    disabledReason: reason,
    disabledCode: code,
    mode,
    environmentLabel,
    applicationDir,
    statusPath: null,
    statusWritePath: null,
    requestPath: null,
    windowsRunnerPath: null,
    windowsConfigPath: null,
    windowsAgentHealthPath: null,
    windowsShutdownPath: null,
    gitExecutable: 'git',
    approvedRepository: APPROVED_UPDATE_REPOSITORY,
    remote: APPROVED_UPDATE_REMOTE,
    branch: APPROVED_UPDATE_BRANCH,
    port: APPROVED_MCC_PORT,
  };
}

type WindowsUpdaterConfigurationFile = {
  schemaVersion?: unknown;
  deploymentMode?: unknown;
  applicationPath?: unknown;
  repository?: unknown;
  remote?: unknown;
  branch?: unknown;
  port?: unknown;
  mccTaskName?: unknown;
  updaterTaskName?: unknown;
  gitPath?: unknown;
};

function readWindowsUpdaterConfiguration(
  resolvedApplicationDir: string,
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
) {
  if (platform !== 'win32') {
    return disabledConfiguration(resolvedApplicationDir, 'The Windows updater requires Windows.', 'configuration_invalid', true);
  }
  const programData = environment.ProgramData || 'C:\\ProgramData';
  const configPath = path.win32.resolve(environment.MCC_UPDATE_WINDOWS_CONFIG || path.win32.join(programData, 'MCC', 'Updater', 'config.json'));
  const updaterRoot = path.win32.dirname(configPath);
  const expectedRoot = path.win32.resolve(programData, 'MCC', 'Updater');
  const testOverride = environment.NODE_ENV === 'test';
  if (path.win32.basename(configPath).toLowerCase() !== 'config.json'
    || (!testOverride && !sameWindowsPath(updaterRoot, expectedRoot))) {
    return disabledConfiguration(resolvedApplicationDir, 'The protected Windows updater configuration location is invalid.', 'configuration_invalid', true);
  }
  if (!fs.existsSync(configPath)) {
    return disabledConfiguration(resolvedApplicationDir, 'The updater is not configured in this environment.');
  }

  let item: WindowsUpdaterConfigurationFile;
  try {
    item = JSON.parse(fs.readFileSync(configPath, 'utf8')) as WindowsUpdaterConfigurationFile;
  } catch {
    return disabledConfiguration(resolvedApplicationDir, 'The protected Windows updater configuration is invalid.', 'configuration_invalid', true);
  }
  const deploymentMode = cleanText(item.deploymentMode, 40);
  const mode: SystemUpdateMode = deploymentMode === 'WindowsTest'
    ? 'windows_test'
    : deploymentMode === 'WindowsProduction'
      ? 'windows_production'
      : 'disabled';
  const environmentLabel = mode === 'windows_test'
    ? 'WINDOWS TEST MODE'
    : mode === 'windows_production'
      ? 'WINDOWS 11 PRODUCTION'
      : 'CONFIGURATION INVALID';
  const applicationPath = typeof item.applicationPath === 'string' ? path.win32.resolve(item.applicationPath) : '';
  const configuredGitPath = typeof item.gitPath === 'string'
    ? path.win32.isAbsolute(item.gitPath)
      ? path.win32.resolve(item.gitPath)
      : testOverride && path.isAbsolute(item.gitPath)
        ? path.resolve(item.gitPath)
        : ''
    : '';
  let configuredGitIsFile = false;
  try {
    configuredGitIsFile = Boolean(configuredGitPath) && fs.statSync(configuredGitPath).isFile();
  } catch {
    configuredGitIsFile = false;
  }
  const configuredBranch = typeof item.branch === 'string' ? item.branch : '';
  const validBranchPolicy = isSafeUpdateBranch(configuredBranch)
    && (mode !== 'windows_production' || configuredBranch === APPROVED_UPDATE_BRANCH);
  const validFixedConfiguration = item.schemaVersion === 1
    && mode !== 'disabled'
    && canonicalRepositoryUrl(String(item.repository ?? '')) === canonicalRepositoryUrl(APPROVED_UPDATE_REPOSITORY)
    && item.remote === APPROVED_UPDATE_REMOTE
    && validBranchPolicy
    && item.port === APPROVED_MCC_PORT
    && item.mccTaskName === 'MaintenanceCommandCenter'
    && item.updaterTaskName === 'MaintenanceCommandCenterUpdater'
    && configuredGitIsFile;
  if (!validFixedConfiguration || !applicationPath || isProtectedWindowsDevelopmentPath(applicationPath)) {
    return disabledConfiguration(
      resolvedApplicationDir,
      'The protected Windows updater configuration is invalid.',
      'configuration_invalid',
      true,
      mode,
      environmentLabel,
    );
  }
  if (!sameWindowsPath(applicationPath, resolvedApplicationDir)) {
    return disabledConfiguration(
      resolvedApplicationDir,
      'The configured MCC application does not match the running managed installation.',
      'configuration_invalid',
      true,
      mode,
      environmentLabel,
    );
  }
  return {
    enabled: true,
    configured: true,
    disabledReason: '',
    disabledCode: 'not_checked' as const,
    mode,
    environmentLabel,
    applicationDir: applicationPath,
    statusPath: path.win32.join(updaterRoot, 'status', 'status.json'),
    statusWritePath: path.win32.join(updaterRoot, 'request', 'api-status.json'),
    requestPath: path.win32.join(updaterRoot, 'request', 'request.json'),
    windowsRunnerPath: null,
    windowsConfigPath: configPath,
    windowsAgentHealthPath: path.win32.join(updaterRoot, 'status', 'agent-health.json'),
    windowsShutdownPath: path.win32.join(updaterRoot, 'request', 'shutdown-request.json'),
    gitExecutable: configuredGitPath,
    approvedRepository: APPROVED_UPDATE_REPOSITORY,
    remote: APPROVED_UPDATE_REMOTE,
    branch: configuredBranch,
    port: APPROVED_MCC_PORT,
  } satisfies SystemUpdateConfiguration;
}

export function loadSystemUpdateConfiguration(
  applicationDir: string,
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): SystemUpdateConfiguration {
  const resolvedApplicationDir = path.resolve(applicationDir);
  const requestedMode = cleanText(environment.MCC_UPDATE_MODE, 40).toLowerCase();
  if (!requestedMode) return disabledConfiguration(resolvedApplicationDir, 'The updater is not configured in this environment.');

  if (requestedMode === 'windows_agent') {
    return readWindowsUpdaterConfiguration(resolvedApplicationDir, environment, platform);
  }

  if (requestedMode === 'raspberry_pi') {
    if (platform !== 'linux') return disabledConfiguration(resolvedApplicationDir, 'Raspberry Pi production mode requires Linux.');
    const configuredApplicationDir = path.resolve(environment.MCC_UPDATE_APP_DIR || resolvedApplicationDir);
    if (configuredApplicationDir !== resolvedApplicationDir) {
      return disabledConfiguration(resolvedApplicationDir, 'The configured production application directory does not match the running MCC build.');
    }
    const stateDir = path.resolve(environment.MCC_UPDATE_STATE_DIR || '/var/lib/mcc-update');
    return {
      enabled: true,
      configured: true,
      disabledReason: '',
      disabledCode: 'not_checked',
      mode: 'raspberry_pi',
      environmentLabel: 'RASPBERRY PI PRODUCTION',
      applicationDir: resolvedApplicationDir,
      statusPath: path.join(stateDir, 'status.json'),
      statusWritePath: path.join(stateDir, 'status.json'),
      requestPath: path.join(stateDir, 'request.json'),
      windowsRunnerPath: null,
      windowsConfigPath: null,
      windowsAgentHealthPath: null,
      windowsShutdownPath: null,
      gitExecutable: 'git',
      approvedRepository: APPROVED_UPDATE_REPOSITORY,
      remote: APPROVED_UPDATE_REMOTE,
      branch: APPROVED_UPDATE_BRANCH,
      port: APPROVED_MCC_PORT,
    };
  }

  if (requestedMode === 'windows_test') {
    return disabledConfiguration(
      resolvedApplicationDir,
      'Install the managed Windows updater agent before enabling the Settings update control. The legacy Z: script remains available as a manual test harness.',
    );
  }

  return disabledConfiguration(resolvedApplicationDir, 'MCC_UPDATE_MODE must be raspberry_pi, windows_test, or windows_agent.', 'configuration_invalid', true);
}

export class JsonSystemUpdateStatusStore implements SystemUpdateStatusStore {
  constructor(
    private readonly statusPath: string,
    private readonly writePath = statusPath,
  ) {}

  read() {
    const candidates = [...new Set([this.statusPath, this.writePath])].flatMap(statusPath => {
      try {
        if (!fs.existsSync(statusPath)) return [];
        const status = normalizeStatus(JSON.parse(fs.readFileSync(statusPath, 'utf8')));
        return status ? [status] : [];
      } catch {
        return [];
      }
    });
    return candidates.sort((left, right) => {
      const leftTime = Date.parse(left.lastUpdatedAt);
      const rightTime = Date.parse(right.lastUpdatedAt);
      return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
    })[0] ?? null;
  }

  write(status: SystemUpdateStatus) {
    const directory = path.dirname(this.writePath);
    fs.mkdirSync(directory, { recursive: true });
    const temporaryPath = path.join(directory, `.${path.basename(this.writePath)}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`);
    fs.writeFileSync(temporaryPath, `${JSON.stringify(status, null, 2)}\n`, { encoding: 'utf8', mode: 0o640, flag: 'wx' });
    fs.renameSync(temporaryPath, this.writePath);
    try {
      fs.chmodSync(this.writePath, 0o640);
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
  const mode: SystemUpdateMode = ['disabled','raspberry_pi','windows_test','windows_production'].includes(String(item.mode)) ? item.mode as SystemUpdateMode : 'disabled';
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
    requestedAt: item.requestedAt ? cleanText(item.requestedAt, 40) : null,
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

export function createSystemUpdateGitRunner(configuration: Pick<SystemUpdateConfiguration, 'mode' | 'gitExecutable'>): SystemUpdateGitRunner {
  const executable = configuration.mode === 'windows_test' || configuration.mode === 'windows_production'
    ? configuration.gitExecutable
    : 'git';
  return (args: string[], cwd: string, timeoutMs = 12_000): GitResult => spawnSync(executable, args, {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
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
    code: configuration.enabled ? 'not_checked' : configuration.disabledCode,
    message: configuration.enabled ? 'Check the approved update branch for MCC updates.' : configuration.disabledReason,
    mode: configuration.mode,
    environmentLabel: configuration.environmentLabel,
    installed,
    target: { version: null, commit: null },
    startedAt: null,
    requestedAt: null,
    lastUpdatedAt: nowValue,
    completedAt: null,
    requester: null,
    outcome: 'none',
    checkToken: null,
    checkExpiresAt: null,
    events: [],
  };
}

type DeploymentAvailability = {
  available: boolean;
  code: SystemUpdateCode;
  message: string;
};

function windowsAgentAvailability(configuration: SystemUpdateConfiguration, nowMs: number): DeploymentAvailability {
  if (!configuration.enabled) {
    return { available: false, code: configuration.disabledCode, message: configuration.disabledReason };
  }
  if (!configuration.windowsAgentHealthPath) {
    return { available: true, code: 'not_checked', message: '' };
  }
  try {
    const requestDirectory = path.dirname(configuration.requestPath!);
    const statusDirectory = path.dirname(configuration.statusPath!);
    fs.accessSync(requestDirectory, fs.constants.R_OK | fs.constants.W_OK);
    fs.accessSync(statusDirectory, fs.constants.R_OK);
    const health = JSON.parse(fs.readFileSync(configuration.windowsAgentHealthPath, 'utf8')) as Record<string, unknown>;
    const checkedAt = Date.parse(cleanText(health.checkedAt, 40));
    if (health.schemaVersion !== 1 || !Number.isFinite(checkedAt) || nowMs - checkedAt > 90_000 || checkedAt - nowMs > 30_000) {
      return { available: false, code: 'updater_agent_offline', message: 'The Windows updater agent is offline.' };
    }
    if (health.configurationValid !== true
      || health.applicationPathMatches !== true
      || health.repositoryValid !== true
      || health.branchValid !== true
      || health.requestDirectoryAccessible !== true
      || health.statusDirectoryAccessible !== true
      || cleanText(health.deploymentMode, 40) !== (configuration.mode === 'windows_test' ? 'WindowsTest' : 'WindowsProduction')) {
      return { available: false, code: 'configuration_invalid', message: 'The protected Windows updater configuration is invalid.' };
    }
    if (health.updaterTaskInstalled !== true || health.agentHealthy !== true) {
      return { available: false, code: 'updater_agent_offline', message: 'The Windows updater agent is offline.' };
    }
    if (health.mccTaskInstalled !== true || health.mccTaskRunning !== true) {
      return { available: false, code: 'mcc_service_not_running', message: 'The managed MCC background task is not running.' };
    }
    return { available: true, code: 'not_checked', message: '' };
  } catch {
    return { available: false, code: 'updater_agent_offline', message: 'The Windows updater agent is offline.' };
  }
}

export class SystemUpdateService {
  private checkLocked = false;

  constructor(
    public readonly configuration: SystemUpdateConfiguration,
    private readonly store: SystemUpdateStatusStore,
    private readonly git: SystemUpdateGitRunner = createSystemUpdateGitRunner(configuration),
    private readonly trigger: SystemUpdateTrigger = triggerConfiguredSystemUpdate,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private now() { return this.clock().toISOString(); }

  private runGit(args: string[], cwd: string, timeoutMs?: number) {
    let result: GitResult;
    try {
      result = this.git(args, cwd, timeoutMs);
    } catch {
      throw new SystemUpdateError(
        503,
        'update_check_failed',
        'Update check failed because the approved Git client could not be started.',
        'git_executable_unavailable',
      );
    }
    if (result.error || result.status === null) {
      throw new SystemUpdateError(
        503,
        'update_check_failed',
        'Update check failed because the approved Git client could not be started.',
        'git_executable_unavailable',
      );
    }
    return result;
  }

  private localInstalledRef(): UpdateVersionRef {
    let version: string | null = null;
    try {
      version = readManifestVersion(fs.readFileSync(path.join(this.configuration.applicationDir, 'package.json'), 'utf8'));
    } catch {
      version = null;
    }
    let commit: string | null = null;
    try {
      const result = this.runGit(['rev-parse', 'HEAD'], this.configuration.applicationDir, 2_000);
      commit = result.status === 0 && commitPattern.test(result.stdout.trim()) ? result.stdout.trim().toLowerCase() : null;
    } catch {
      commit = null;
    }
    return { version, commit };
  }

  readStatus() {
    return this.store.read() ?? baseStatus(this.configuration, this.now(), this.localInstalledRef());
  }

  publicStatus(status = this.readStatus()): PublicSystemUpdateStatus {
    const availability = windowsAgentAvailability(this.configuration, this.clock().getTime());
    const preserveJobState = activeInstallStates.has(status.state)
      || ['succeeded','rolled_back','failed'].includes(status.state);
    const visibleStatus = !availability.available && !preserveJobState
      ? {
          ...status,
          state: 'idle' as const,
          code: availability.code,
          message: availability.message,
          checkToken: null,
          checkExpiresAt: null,
        }
      : status;
    return {
      ok: true,
      configured: this.configuration.configured ?? this.configuration.enabled,
      available: availability.available,
      state: visibleStatus.state,
      code: visibleStatus.code,
      message: cleanText(visibleStatus.message),
      mode: visibleStatus.mode,
      environmentLabel: visibleStatus.environmentLabel,
      installedVersion: visibleStatus.installed.version,
      installedCommit: shortCommit(visibleStatus.installed.commit),
      targetVersion: visibleStatus.target.version,
      targetCommit: shortCommit(visibleStatus.target.commit),
      startedAt: visibleStatus.startedAt,
      requestedAt: visibleStatus.requestedAt,
      lastUpdatedAt: visibleStatus.lastUpdatedAt,
      completedAt: visibleStatus.completedAt,
      requester: visibleStatus.requester ? { id: visibleStatus.requester.id, name: cleanText(visibleStatus.requester.name, 120) } : null,
      outcome: visibleStatus.outcome,
      checkToken: visibleStatus.code === 'update_available' || visibleStatus.code === 'same_version_different_commit' ? visibleStatus.checkToken : null,
      checkExpiresAt: visibleStatus.code === 'update_available' || visibleStatus.code === 'same_version_different_commit' ? visibleStatus.checkExpiresAt : null,
      active: activeInstallStates.has(visibleStatus.state) || visibleStatus.state === 'checking',
    };
  }

  private requireDeploymentAvailable() {
    const availability = windowsAgentAvailability(this.configuration, this.clock().getTime());
    if (!availability.available) {
      throw new SystemUpdateError(503, availability.code, availability.message);
    }
  }

  private write(status: SystemUpdateStatus) {
    this.store.write(status);
    return status;
  }

  private repositoryIdentity() {
    const remoteResult = this.runGit(['remote', 'get-url', this.configuration.remote], this.configuration.applicationDir);
    const remoteUrl = requireGitOutput(remoteResult, 'Update check failed while validating the approved repository.');
    if (canonicalRepositoryUrl(remoteUrl) !== canonicalRepositoryUrl(this.configuration.approvedRepository)) {
      throw new SystemUpdateError(409, 'update_check_failed', 'Update blocked: this MCC installation is not connected to the approved repository.');
    }
    const branchResult = this.runGit(['branch', '--show-current'], this.configuration.applicationDir);
    const branch = requireGitOutput(branchResult, 'Update check failed while validating the installed branch.');
    if (branch !== this.configuration.branch) {
      throw new SystemUpdateError(409, 'update_check_failed', 'Update blocked: the managed Windows checkout is not on its Administrator-configured branch.');
    }
  }

  private cleanWorkingTree() {
    const result = this.runGit(['status', '--porcelain=v1', '--untracked-files=normal'], this.configuration.applicationDir);
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
      throw new SystemUpdateError(503, this.configuration.disabledCode, this.configuration.disabledReason);
    }
    this.requireDeploymentAvailable();
    this.repositoryIdentity();
    this.cleanWorkingTree();
    const installed = this.localInstalledRef();
    if (!installed.version || !installed.commit) {
      throw new SystemUpdateError(503, 'update_check_failed', 'Update check failed because the installed version or build metadata is unavailable.');
    }
    if (fetchRemote) {
      const fetchResult = this.runGit([
        'fetch',
        '--no-tags',
        this.configuration.remote,
        `+refs/heads/${this.configuration.branch}:refs/remotes/${this.configuration.remote}/${this.configuration.branch}`,
      ], this.configuration.applicationDir, 20_000);
      if (fetchResult.status !== 0) {
        throw new SystemUpdateError(503, 'network_unavailable', 'The approved GitHub update source is unavailable. Try again later.');
      }
    }
    const targetResult = this.runGit(['rev-parse', `refs/remotes/${this.configuration.remote}/${this.configuration.branch}`], this.configuration.applicationDir);
    const targetCommit = requireGitOutput(targetResult, 'Update check failed while reading the approved remote commit.').toLowerCase();
    if (!commitPattern.test(targetCommit)) {
      throw new SystemUpdateError(503, 'update_check_failed', 'Update check failed because the approved remote commit is invalid.');
    }
    const manifestResult = this.runGit(['show', `${targetCommit}:package.json`], this.configuration.applicationDir);
    const remoteManifest = requireGitOutput(manifestResult, 'Update check failed while reading remote version metadata.');
    const targetVersion = readManifestVersion(remoteManifest);
    if (!targetVersion) {
      throw new SystemUpdateError(409, 'invalid_remote_version', 'Update blocked: the approved remote version metadata is invalid.');
    }
    if (targetCommit !== installed.commit) {
      const ancestry = this.runGit(['merge-base', '--is-ancestor', installed.commit, targetCommit], this.configuration.applicationDir);
      if (ancestry.status === 1) {
        throw new SystemUpdateError(409, 'remote_not_fast_forward', 'Update blocked: the approved update branch is not a fast-forward from the installed build.');
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
      message: 'Checking the approved Administrator-configured branch for updates.',
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
          message: 'MCC is up to date with the approved update branch.',
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
          message: 'Update blocked: the approved update branch reports a version older than the installed MCC version.',
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
          : `MCC v${comparison.target.version} is available from the approved update branch.`,
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
      throw new SystemUpdateError(503, this.configuration.disabledCode, this.configuration.disabledReason);
    }
    this.requireDeploymentAvailable();
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
    const refreshResult = this.runGit([
      'fetch',
      '--no-tags',
      this.configuration.remote,
      `+refs/heads/${this.configuration.branch}:refs/remotes/${this.configuration.remote}/${this.configuration.branch}`,
    ], this.configuration.applicationDir, 20_000);
    if (refreshResult.status !== 0) {
      throw new SystemUpdateError(503, 'network_unavailable', 'The approved GitHub update source is unavailable. Check for updates again later.');
    }
    const installedResult = this.runGit(['rev-parse', 'HEAD'], this.configuration.applicationDir);
    const targetResult = this.runGit(['rev-parse', `refs/remotes/${this.configuration.remote}/${this.configuration.branch}`], this.configuration.applicationDir);
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
      requestedAt: queuedAt,
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
    let requestCreated = false;
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
      requestCreated = true;
      this.write(queuedStatus);
      this.trigger(this.configuration);
    } catch (error) {
      if (!requestCreated && error instanceof SystemUpdateError) throw error;
      const failedAt = this.now();
      try {
        if (requestCreated && this.configuration.requestPath && fs.existsSync(this.configuration.requestPath)) fs.rmSync(this.configuration.requestPath, { force: true });
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
    if (fs.existsSync(requestPath)) {
      throw new SystemUpdateError(409, 'update_already_running', 'An MCC update request is already queued.');
    }
    const temporaryPath = path.join(directory, `.${path.basename(requestPath)}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`);
    try {
      fs.writeFileSync(temporaryPath, `${JSON.stringify(request, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      try {
        fs.linkSync(temporaryPath, requestPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new SystemUpdateError(409, 'update_already_running', 'An MCC update request is already queued.');
        }
        throw error;
      }
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
  if ((configuration.mode === 'windows_test' || configuration.mode === 'windows_production')
    && configuration.windowsAgentHealthPath) {
    // The Administrator-installed SYSTEM agent polls the fixed request location.
    // The MCC backend never starts an elevated process or supplies command arguments.
    return;
  }
  throw new Error('The external MCC update runner is not configured.');
}
