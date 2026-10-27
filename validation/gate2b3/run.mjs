import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const approved = 'c69f8cb6c63922c4f415eacf8ee28e7c056a0a1e';
export const branch = 'codex/gate2b3-capability-20261027-af16222b';
export const files = ['.github/workflows/gate2b3-capability.yml', 'validation/gate2b3/probe.py',
  'validation/gate2b3/run.mjs', 'validation/gate2b3/tooling-inputs.json'];
const base = 'scripts/playwright-storage.mjs';
export const assurance = Object.fromEntries(['nativeBuildExecuted', 'offlineInstallExecuted',
  'workerIsolationVerified', 'serviceTestsExecuted', 'debianPiCompatibilityVerified',
  'outboundNetworkIsolationEnforced', 'gate2Accepted'].map(key => [key, false]));
const reject = () => { throw new Error('CAPABILITY_VALIDATION_REJECTED'); };
const keysEqual = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

export function validate(value, schema, depth = 0) {
  if (depth > 20) reject();
  const type = value === null ? 'null' : Array.isArray(value) ? 'array'
    : Number.isSafeInteger(value) ? 'integer' : typeof value;
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (!types.includes(type) || (schema.enum && !schema.enum.includes(value))) reject();
  if (type === 'object') {
    if (schema.additionalProperties !== false || !keysEqual(Object.keys(value), Object.keys(schema.properties))) reject();
    for (const [key, child] of Object.entries(value)) validate(child, schema.properties[key], depth + 1);
  } else if (type === 'array') {
    if (value.length > schema.maxItems || new Set(value.map(v => JSON.stringify(v))).size !== value.length) reject();
    for (const child of value) validate(child, schema.items, depth + 1);
  } else if (type === 'string') {
    if (value.length > schema.maxLength) reject();
    if (schema.pattern) {
      const match = new RegExp('^(?:' + schema.pattern + ')$').exec(value);
      if (!match || match[0] !== value) reject();
    }
  } else if (type === 'integer' && (value < schema.minimum || value > schema.maximum)) reject();
}

function safeFile(directory, name) {
  let current = directory;
  for (const part of name.split('/')) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) reject();
  }
  if (!fs.statSync(current).isFile() || path.relative(fs.realpathSync(directory), fs.realpathSync(current)).startsWith('..')) reject();
  return current;
}

export function readInputs(directory = root) {
  const input = JSON.parse(fs.readFileSync(safeFile(directory, files[3]), 'utf8'));
  if (!keysEqual(Object.keys(input), ['schemaVersion', 'mode', 'approvedBaseSha', 'stagingBranch',
    'publicationFiles', 'baseDependencies', 'packageSha256', 'inventorySchema', 'resultSchema'])) reject();
  if (input.schemaVersion !== 2 || input.mode !== 'capability-only' || input.approvedBaseSha !== approved
    || input.stagingBranch !== branch || JSON.stringify(input.publicationFiles) !== JSON.stringify(files)
    || !keysEqual(Object.keys(input.baseDependencies), [base])
    || !keysEqual(Object.keys(input.packageSha256), files.slice(0, 3))) reject();
  for (const [name, hash] of Object.entries({ ...input.baseDependencies, ...input.packageSha256 })) {
    if (!/^[0-9a-f]{64}$/.test(hash) || createHash('sha256').update(fs.readFileSync(safeFile(directory, name))).digest('hex') !== hash) reject();
  }
  return input;
}

export function validateInventory(value, input) {
  validate(value, input.inventorySchema);
  if (value.status === 'INVENTORY_COMPLETE') {
    if (value.observed === null || value.errorCode !== null
      || !value.blockers.includes('reviewed_rootfs_not_supplied')
      || !value.blockers.includes('reviewed_offline_cache_not_supplied')) reject();
  } else if (value.observed !== null || value.errorCode !== 'PROBE_FAILED'
    || JSON.stringify(value.blockers) !== '["probe_failed"]') reject();
  return value;
}

function failure() {
  return { schemaVersion: 1, mode: 'capability-only', approvedBaseSha: approved,
    status: 'INVENTORY_FAILED', observed: null, blockers: ['probe_failed'], errorCode: 'PROBE_FAILED', assurance };
}

export function validateResult(value, input) {
  validate(value, input.resultSchema);
  if (value.cleanupSucceeded && (!value.cleanupAttempted || !value.runtimeRemoved)) reject();
  if (value.status === 'COMPLETE') {
    if (value.errorCode !== null || value.probeStatus !== 'INVENTORY_COMPLETE'
      || !value.cleanupAttempted || !value.cleanupSucceeded || !value.runtimeRemoved) reject();
  } else if (value.errorCode === null) reject();
  return value;
}

export function childEnvironment(directory) {
  const env = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/usr/local/sbin', LANG: 'C.UTF-8',
    HOME: path.join(directory, 'runtime'), TMPDIR: path.join(directory, 'runtime'),
    TEMP: path.join(directory, 'runtime'), TMP: path.join(directory, 'runtime'),
    MCC_GATE2B3_RUNTIME: directory, PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1',
    NPM_CONFIG_CACHE: path.join(directory, 'runtime/npm-cache'),
    NPM_CONFIG_USERCONFIG: path.join(directory, 'runtime/user.npmrc'),
    NPM_CONFIG_GLOBALCONFIG: path.join(directory, 'runtime/global.npmrc'),
    NPM_CONFIG_OFFLINE: 'true', NPM_CONFIG_AUDIT: 'false', NPM_CONFIG_FUND: 'false' };
  if (process.platform === 'win32') {
    for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT']) {
      const found = Object.entries(process.env).find(([name]) => name.toLowerCase() === key.toLowerCase());
      if (found) env[key] = found[1];
    }
  } else if (/^\/opt\/hostedtoolcache\/node\/[0-9]+\.[0-9]+\.[0-9]+\/(?:arm64|x64)\/bin\/node$/.test(process.execPath)) {
    env.PATH = path.dirname(process.execPath) + ':' + env.PATH;
  }
  return env;
}

// Dependency injection is an import-only test seam. CLI exposes no fault switch,
// alternative executable, directory, command or publication path.
export function perform(run, input, { cleanup, spawn = spawnSync, directory = root } = {}) {
  let inventory = failure(), errorCode = null, attempted = false, cleaned = false, canCleanup = true;
  try {
    const env = childEnvironment(run.directory);
    for (const name of ['user.npmrc', 'global.npmrc']) fs.writeFileSync(path.join(run.directory, 'runtime', name), '', { flag: 'wx' });
    canCleanup = false;
    const result = spawn(process.platform === 'win32' ? 'python' : 'python3',
      ['-I', '-S', '-B', 'validation/gate2b3/probe.py', '--inventory'],
      { cwd: directory, env, encoding: 'utf8', windowsHide: true, timeout: 60_000, maxBuffer: 32768 });
    if (!result.error && !result.signal && Number.isInteger(result.status)) canCleanup = true;
    if (result.error || result.signal || ![0, 1].includes(result.status)) {
      errorCode = 'PROCESS_FAILED';
    } else {
      try {
        if (typeof result.stdout !== 'string' || Buffer.byteLength(result.stdout) > 16384) reject();
        inventory = validateInventory(JSON.parse(result.stdout), input);
        if ((result.status === 0) !== (inventory.status === 'INVENTORY_COMPLETE')) reject();
        if (result.status !== 0) errorCode = 'PROBE_FAILED';
      } catch { inventory = failure(); errorCode = 'INVALID_RESULT'; }
    }
  } catch { errorCode = 'PROCESS_FAILED'; }
  finally {
    if (canCleanup) {
      attempted = true;
      try { cleanup(run.id, { currentRunner: true, apply: true }); cleaned = true; }
      catch { errorCode = 'CLEANUP_FAILED'; }
    } else {
      // A killed/timed-out parent does not prove its descendants stopped.
      // Retain this owned runtime for the explicit interrupted-run procedure.
      run.processUncertain = true;
      errorCode = 'PROCESS_UNCERTAIN';
    }
  }
  const removed = !fs.existsSync(run.directory);
  if (canCleanup && (!removed || !cleaned)) errorCode = 'CLEANUP_FAILED';
  const result = { schemaVersion: 1, mode: 'capability-only', status: errorCode ? 'FAILED' : 'COMPLETE',
    probeStatus: inventory.status, errorCode, cleanupAttempted: attempted, cleanupSucceeded: cleaned,
    runtimeRemoved: removed, assurance };
  validateInventory(inventory, input);
  validateResult(result, input);
  return { inventory, result, exitCode: errorCode ? 1 : 0 };
}

export function publishPublic(run, outcome, input) {
  validateInventory(outcome.inventory, input);
  validateResult(outcome.result, input);
  if (outcome.exitCode !== (outcome.result.status === 'COMPLETE' ? 0 : 1)) reject();
  const directory = path.join(run.diagnostics, 'public');
  if (fs.lstatSync(run.diagnostics).isSymbolicLink()) reject();
  fs.mkdirSync(directory); // A previous/foreign public directory is never reused.
  for (const [name, value] of [['capabilities.json', outcome.inventory], ['result.json', outcome.result]]) {
    fs.writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  }
  if (!keysEqual(fs.readdirSync(directory), ['capabilities.json', 'result.json'])) reject();
  for (const name of fs.readdirSync(directory)) {
    if (fs.lstatSync(path.join(directory, name)).isSymbolicLink()) reject();
    const value = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
    if (name === 'capabilities.json') validateInventory(value, input); else validateResult(value, input);
  }
  return directory;
}

export async function main() {
  if (JSON.stringify(process.argv.slice(2)) !== '["--inventory"]') return 1;
  let run, managed;
  try {
    const input = readInputs();
    managed = await import(pathToFileURL(safeFile(root, base)).href);
    if (fs.realpathSync(root) !== managed.root) reject();
    run = managed.createRun();
    const outcome = perform(run, input, { cleanup: managed.cleanupRun });
    const publicDirectory = publishPublic(run, outcome, input);
    // Only the validated, two-file public subdirectory is exposed to Actions.
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, 'public_directory=' + publicDirectory + '\n');
    console.log(outcome.exitCode ? 'Capability inventory failed; see sanitized result.' : 'Capability inventory recorded; Gate 2 remains NOT ACCEPTED.');
    return outcome.exitCode;
  } catch {
    if (run && !run.processUncertain && fs.existsSync(run.directory)) {
      try { managed.cleanupRun(run.id, { currentRunner: true, apply: true }); } catch { /* Retain uncertain owned runtime. */ }
    }
    console.log('Capability inventory failed; no unrestricted diagnostics are published.');
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }).catch(() => { process.exitCode = 1; });
}
