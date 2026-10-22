import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createRun, cleanupRun, readRun, safePath, runsRoot, root, registerProcess } from '../scripts/playwright-storage.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const runner = path.join(root, 'scripts/playwright-run.mjs');
function launch(mode) {
  const child = spawn(process.execPath, [runner, 'tests/playwright-cleanup-probe.spec.ts', '--project=desktop-chromium', '--workers=1', '--timeout=60000'], {
    cwd: root, env: { ...process.env, MCC_CLEANUP_PROBE: mode }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => output += chunk);
  child.stderr.on('data', chunk => output += chunk);
  return { child, output: () => output, done: once(child, 'close') };
}
function findFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? findFiles(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
}

test('CLI refuses isolation bypasses before creating a run', () => {
  const before = fs.existsSync(runsRoot) ? fs.readdirSync(runsRoot) : [];
  for (const args of [['-cother.ts'], ['-c', 'other.ts'], ['--config=other.ts'], ['--output=../outside'], ['--reporter=line'], ['--ui']]) {
    const result = spawnSync(process.execPath, [runner, ...args], { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Managed runs own config/);
  }
  assert.deepEqual(fs.existsSync(runsRoot) ? fs.readdirSync(runsRoot) : [], before);
});

test('ownership, traversal, junction and live-process protections', () => {
  const run = createRun();
  const unrelated = createRun();
  const guard = path.join(unrelated.directory, 'do-not-delete.txt');
  fs.writeFileSync(guard, 'untouched');
  try {
    assert.notEqual(run.id, unrelated.id);
    assert.throws(() => cleanupRun('../backend/data', { apply: true }), /Invalid run ID/);
    assert.throws(() => safePath(runsRoot, path.join(root, 'backend/data')), /Outside designated/);
    assert.throws(() => safePath(runsRoot, runsRoot), /Outside designated/);
    assert.throws(() => cleanupRun(run.id, { apply: true, minimumAgeMs: 0 }), /still active/);
    assert.throws(() => cleanupRun(run.id, { apply: true }), /too recent/);
    const marker = path.join(run.directory, 'owner.json');
    const original = fs.readFileSync(marker);
    fs.writeFileSync(marker, JSON.stringify({ ...JSON.parse(original), repository: 'another-checkout' }));
    assert.throws(() => cleanupRun(run.id, { currentRunner: true, apply: true }), /ownership marker/);
    fs.writeFileSync(marker, original);
    const link = path.join(run.directory, 'runtime', 'escape');
    fs.symlinkSync(unrelated.directory, link, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => cleanupRun(run.id, { currentRunner: true, apply: true }), /link\/junction/);
    fs.unlinkSync(link);
    assert.equal(fs.readFileSync(guard, 'utf8'), 'untouched');
    cleanupRun(run.id, { currentRunner: true, apply: true });
    assert.equal(fs.existsSync(run.directory), false);
    assert.equal(fs.readFileSync(guard, 'utf8'), 'untouched');
  } finally {
    if (fs.existsSync(run.directory)) cleanupRun(run.id, { currentRunner: true, apply: true });
    cleanupRun(unrelated.id, { currentRunner: true, apply: true });
  }
});

test('a hard-killed owner cannot authorize stale cleanup while a participant remains alive', async () => {
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import {createRun} from './scripts/playwright-storage.mjs';
    const run=createRun(); console.log(run.id); setInterval(()=>{},1000);
  `], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'inherit'] });
  const closed = once(child, 'close');
  const [chunk] = await once(child.stdout, 'data');
  const id = String(chunk).trim();
  const run = readRun(id);
  registerProcess(run); // This test process stands in for an orphan server.
  const participants = [];
  async function participant(argument) {
    const participantProcess = spawn(process.execPath, ['-e', "console.log('ready');setInterval(()=>{},1000)", argument], {
      cwd: root, env: { ...process.env, NODE_OPTIONS: '' }, windowsHide: true, stdio: ['ignore', 'pipe', 'inherit'],
    });
    const done = once(participantProcess, 'close');
    const result = { process: participantProcess, done };
    participants.push(result);
    await once(participantProcess.stdout, 'data');
    return result;
  }
  try {
    child.kill('SIGKILL'); await closed;
    assert.throws(() => cleanupRun(id, { apply: true, minimumAgeMs: 0 }), /still active/);
    assert.equal(fs.existsSync(run.directory), true);
    fs.unlinkSync(path.join(run.directory, 'processes', `${process.pid}.json`));
    const profile = await participant(path.join(run.directory, 'runtime', 'browser-profile'));
    const controller = await participant(id);
    assert.throws(() => cleanupRun(id, { apply: true, minimumAgeMs: 0 }), /still active/, 'unregistered browser profile still blocks cleanup');
    profile.process.kill('SIGTERM'); await profile.done;
    cleanupRun(id, { apply: false, minimumAgeMs: 0 });
    assert.equal(controller.process.exitCode, null, 'a bare-ID controller is not an orphan browser');
  } finally {
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await closed; }
    for (const participant of participants) {
      if (participant.process.exitCode === null && participant.process.signalCode === null) participant.process.kill('SIGTERM');
      await participant.done;
    }
    const registration = path.join(run.directory, 'processes', `${process.pid}.json`);
    if (fs.existsSync(registration)) fs.unlinkSync(registration);
    cleanupRun(id, { apply: false, minimumAgeMs: 0 });
    assert.equal(fs.existsSync(run.directory), true, 'dry run must not remove anything');
    cleanupRun(id, { apply: true, minimumAgeMs: 0 });
  }
});

for (const mode of ['pass', 'fail']) {
  test(`real browser ${mode}: runtime removed and diagnostics retained`, { timeout: 120_000 }, async () => {
    const run = launch(mode);
    const [code] = await run.done;
    assert.equal(code, mode === 'pass' ? 0 : 1, run.output());
    const id = run.output().match(/MCC Playwright run: (run-[\da-f-]+)/)?.[1];
    assert.ok(id, run.output());
    assert.equal(fs.existsSync(path.join(runsRoot, id)), false, run.output());
    const diagnostics = path.join(root, 'diagnostics/playwright', id);
    const files = findFiles(diagnostics);
    assert.ok(files.some(file => file.endsWith('runner.log')));
    assert.ok(files.some(file => file.endsWith('report.json')));
    assert.equal(fs.readFileSync(path.join(diagnostics, 'recovery/probe-snapshot.txt'), 'utf8'), 'preserve recovery evidence');
    assert.equal(fs.readFileSync(path.join(diagnostics, 'runtime-evidence/runtime/fixture/recovery/snapshot.txt'), 'utf8'), 'preserve nested fixture recovery');
    if (mode === 'fail') {
      assert.ok(files.some(file => file.endsWith('.png')), 'failure screenshot retained');
      assert.ok(files.some(file => file.endsWith('trace.zip')), 'failure trace retained');
    }
    console.log(`Verified ${mode} diagnostics: ${diagnostics}`);
  });
}

test('interrupted browser run safely cleans or defers active runtime', { timeout: 120_000 }, async () => {
  const run = launch('interrupt');
  try {
    for (let i = 0; i < 600 && !run.output().includes('CLEANUP_PROBE_READY'); i++) {
      if (run.child.exitCode !== null) throw new Error(run.output());
      await pause(100);
    }
    assert.match(run.output(), /CLEANUP_PROBE_READY/);
    run.child.kill('SIGINT');
    const [code] = await run.done;
    const id = run.output().match(/MCC Playwright run: (run-[\da-f-]+)/)[1];
    assert.notEqual(code, 0);
    // On Windows kill(SIGINT) is a hard termination: the orphaned PW process
    // finishes at its test timeout. Never delete while it is still working.
    if (fs.existsSync(path.join(runsRoot, id))) {
      assert.throws(() => cleanupRun(id, { apply: true, minimumAgeMs: 0 }), /still active/);
      // Explicitly stop only the processes registered by this synthetic test.
      for (const file of fs.readdirSync(path.join(runsRoot, id, 'processes'))) {
        const { pid } = JSON.parse(fs.readFileSync(path.join(runsRoot, id, 'processes', file), 'utf8'));
        try {
          if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
          else process.kill(pid, 'SIGTERM');
        } catch {}
      }
      let cleaned = false;
      for (let i = 0; i < 150 && !cleaned; i++) {
        try { cleanupRun(id, { apply: true, minimumAgeMs: 0 }); cleaned = true; }
        catch (error) { if (!/still active/.test(error.message)) throw error; await pause(500); }
      }
      assert.equal(cleaned, true);
    }
    assert.equal(fs.existsSync(path.join(runsRoot, id)), false);
    assert.ok(fs.existsSync(path.join(root, 'diagnostics/playwright', id, 'runner.log')));
    console.log(`Verified interrupted diagnostics: ${id}`);
  } finally { if (run.child.exitCode === null && run.child.signalCode === null) run.child.kill('SIGTERM'); }
});

test('startup failure removes runtime and retains startup log', { timeout: 60_000 }, async () => {
  const server = http.createServer((_request, response) => response.end('occupied test port'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const previousPort = process.env.MCC_PLAYWRIGHT_PORT;
  try {
    process.env.MCC_PLAYWRIGHT_PORT = String(server.address().port);
    const run = launch('pass');
    const [code] = await run.done;
    assert.notEqual(code, 0, run.output());
    assert.match(run.output(), /already used/);
    const id = run.output().match(/MCC Playwright run: (run-[\da-f-]+)/)[1];
    assert.equal(fs.existsSync(path.join(runsRoot, id)), false);
    assert.match(fs.readFileSync(path.join(root, 'diagnostics/playwright', id, 'runner.log'), 'utf8'), /already used/);
  } finally {
    if (previousPort === undefined) delete process.env.MCC_PLAYWRIGHT_PORT; else process.env.MCC_PLAYWRIGHT_PORT = previousPort;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('concurrent browser runs use different runtimes, ports and diagnostics', { timeout: 120_000 }, async () => {
  const first = launch('pass');
  const second = launch('pass');
  const codes = await Promise.all([first.done, second.done]);
  assert.equal(codes[0][0], 0, first.output());
  assert.equal(codes[1][0], 0, second.output());
  const ids = [first, second].map(run => run.output().match(/MCC Playwright run: (run-[\da-f-]+)/)[1]);
  assert.notEqual(ids[0], ids[1]);
  for (const id of ids) assert.equal(fs.existsSync(path.join(runsRoot, id)), false);
});
