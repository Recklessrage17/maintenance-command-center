import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export const root = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
export const runsRoot = path.join(root, 'tmp', 'playwright-runs');
export const diagnosticsRoot = path.join(root, 'diagnostics', 'playwright');
const owner = 'mcc-playwright-v1';
const idPattern = /^run-\d+-[0-9a-f-]{36}$/;

// Check every existing ancestor, including the managed roots. Do not follow links.
export function safePath(base, target) {
  const resolved = path.resolve(target);
  const relative = path.relative(base, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Outside designated directory: ${resolved}`);
  let current = root;
  const fromRoot = path.relative(root, resolved);
  if (fromRoot.startsWith('..') || path.isAbsolute(fromRoot)) throw new Error('Outside repository');
  for (const part of fromRoot.split(path.sep)) {
    current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Refusing link/junction: ${current}`);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return resolved;
}

export function inspectTree(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const item = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Refusing link/junction: ${item}`);
    if (entry.isDirectory()) inspectTree(item);
    else if (!entry.isFile()) throw new Error(`Refusing special file: ${item}`);
  }
}

export function readRun(id) {
  if (!idPattern.test(id)) throw new Error('Invalid run ID');
  const directory = safePath(runsRoot, path.join(runsRoot, id));
  const markerPath = safePath(runsRoot, path.join(directory, 'owner.json'));
  const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  if (marker.owner !== owner || marker.id !== id || marker.repository !== root ||
      !Number.isSafeInteger(marker.runnerPid) || marker.runnerPid <= 0 ||
      !Number.isFinite(Date.parse(marker.createdAt))) throw new Error('Invalid ownership marker');
  return { ...marker, directory, diagnostics: safePath(diagnosticsRoot, path.join(diagnosticsRoot, id)) };
}

export function createRun() {
  const id = `run-${Date.now()}-${randomUUID()}`;
  const directory = safePath(runsRoot, path.join(runsRoot, id));
  const diagnostics = safePath(diagnosticsRoot, path.join(diagnosticsRoot, id));
  fs.mkdirSync(directory, { recursive: true });
  fs.mkdirSync(diagnostics, { recursive: true });
  const marker = { owner, id, repository: root, runnerPid: process.pid, createdAt: new Date().toISOString() };
  fs.writeFileSync(path.join(directory, 'owner.json'), JSON.stringify(marker, null, 2), { flag: 'wx' });
  fs.writeFileSync(path.join(diagnostics, 'owner.json'), JSON.stringify(marker, null, 2), { flag: 'wx' });
  fs.mkdirSync(path.join(directory, 'processes'));
  for (const name of ['data', 'uploads', 'backups', 'recovery', 'pm-excel', 'pm-work-orders', 'runtime', 'updater-disabled']) fs.mkdirSync(path.join(directory, name));
  const run = readRun(id);
  registerProcess(run);
  return run;
}

export function registerProcess(run) {
  const target = safePath(runsRoot, path.join(run.directory, 'processes', `${process.pid}.json`));
  fs.writeFileSync(target, JSON.stringify({ pid: process.pid, runId: run.id }), { flag: 'w' });
}

export function isAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; return true; }
}

export function processSnapshot() {
  if (process.platform === 'win32') {
    const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress'], { encoding: 'utf8', windowsHide: true });
    return JSON.parse(output).map(p => ({ pid: p.ProcessId, command: p.CommandLine || '' }));
  }
  return execFileSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' }).trim().split('\n').map(line => {
    const match = line.trim().match(/^(\d+)\s+(.*)$/);
    if (!match) throw new Error('Cannot inspect process table');
    return { pid: Number(match[1]), command: match[2] };
  });
}

export function activeProcesses(run, allowedPid) {
  const pids = new Set([run.runnerPid]);
  for (const name of fs.readdirSync(path.join(run.directory, 'processes'))) {
    if (!/^\d+\.json$/.test(name)) throw new Error('Invalid process registration');
    const entry = JSON.parse(fs.readFileSync(safePath(runsRoot, path.join(run.directory, 'processes', name)), 'utf8'));
    if (entry.runId !== run.id || !Number.isSafeInteger(entry.pid) || entry.pid <= 0 || name !== `${entry.pid}.json`) throw new Error('Invalid process registration');
    pids.add(entry.pid);
  }
  // Also catch orphan browsers (their profile paths contain this run's ID).
  for (const entry of processSnapshot()) if (entry.pid !== process.pid && entry.command.includes(run.id)) pids.add(entry.pid);
  return [...pids].filter(pid => pid !== allowedPid && isAlive(pid));
}

export function cleanupRun(id, { currentRunner = false, apply = false, minimumAgeMs = 60_000 } = {}) {
  const run = readRun(id);
  if (currentRunner && run.runnerPid !== process.pid) throw new Error('Only the owning runner may finalize a run');
  if (!currentRunner && Date.now() - Date.parse(run.createdAt) < minimumAgeMs) throw new Error('Run is too recent for stale cleanup (minimum 60 seconds)');
  inspectTree(run.directory);
  const active = activeProcesses(run, currentRunner ? process.pid : undefined);
  if (active.length) throw new Error(`Associated processes still active: ${active.join(', ')}`);
  if (!apply) return run;
  // Preserve any recovery snapshots and unexpected diagnostic files before deletion.
  fs.mkdirSync(run.diagnostics, { recursive: true });
  const recovery = path.join(run.directory, 'recovery');
  if (fs.existsSync(recovery) && fs.readdirSync(recovery).length) {
    const destination = safePath(diagnosticsRoot, path.join(run.diagnostics, 'recovery'));
    if (fs.existsSync(destination)) throw new Error('Recovery diagnostics already exist; manual review required');
    fs.renameSync(recovery, destination);
  }
  const preserve = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const item = path.join(directory, entry.name);
      if (entry.isDirectory() && entry.name === 'recovery' && fs.readdirSync(item).length) {
        const target = safePath(diagnosticsRoot, path.join(run.diagnostics, 'runtime-evidence', path.relative(run.directory, item)));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        if (fs.existsSync(target)) throw new Error('Recovery diagnostics already exist; manual review required');
        fs.renameSync(item, target);
      }
      else if (entry.isDirectory()) preserve(item);
      else if (/\.(log|png|jpe?g|webm|zip)$/i.test(entry.name)) {
        const target = safePath(diagnosticsRoot, path.join(run.diagnostics, 'runtime-evidence', path.relative(run.directory, item)));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(item, target, fs.constants.COPYFILE_EXCL);
      }
    }
  };
  const runtime = path.join(run.directory, 'runtime');
  if (fs.existsSync(runtime)) preserve(runtime);
  // Revalidate the exact absolute target and process state immediately before rm.
  readRun(id);
  if (activeProcesses(run, currentRunner ? process.pid : undefined).length) throw new Error('Process became active during cleanup');
  safePath(runsRoot, run.directory);
  inspectTree(run.directory);
  fs.rmSync(run.directory, { recursive: true, maxRetries: 5, retryDelay: 200 });
  fs.writeFileSync(safePath(diagnosticsRoot, path.join(run.diagnostics, 'cleanup.json')), JSON.stringify({ runId: id, cleanedAt: new Date().toISOString(), runtimeRemoved: true }, null, 2));
  return run;
}
