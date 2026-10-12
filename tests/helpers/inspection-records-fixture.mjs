import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { assertFixturePath, freePort, pause, root } from './security-process.mjs';

// Inspection references currently resolve against backend/uploads. Reproduce that
// supported layout inside a disposable app, without changing the application.
export async function inspectionFixture(label, { serveFrontend = false } = {}) {
  assert.match(label, /^[a-z0-9-]+$/);
  const fixture = path.join(root, 'tmp', `${label}-${Date.now()}-${process.pid}`);
  fs.mkdirSync(fixture, { recursive: true });
  const appRoot = assertFixturePath(fixture, path.join(fixture, 'app'));
  fs.mkdirSync(path.join(appRoot, 'backend'), { recursive: true });
  fs.cpSync(path.join(root, 'backend/dist'), path.join(appRoot, 'backend/dist'), { recursive: true });
  for (const file of ['package.json', 'backend/package.json']) fs.copyFileSync(path.join(root, file), path.join(appRoot, file));
  fs.cpSync(path.join(root, 'shared'), path.join(appRoot, 'shared'), { recursive: true });
  if (serveFrontend) fs.cpSync(path.join(root, 'frontend/dist'), path.join(appRoot, 'frontend/dist'), { recursive: true });
  fs.symlinkSync(path.join(root, 'backend/node_modules'), path.join(appRoot, 'backend/node_modules'), 'junction');
  const port = await freePort();
  const uploadsDir = path.join(appRoot, 'backend/uploads');
  const fixed = {
    NODE_ENV: 'test', PORT: String(port), MCC_BIND_HOST: '127.0.0.1',
    MCC_DATA_DIR: path.join(fixture, 'data'), MCC_UPLOADS_DIR: uploadsDir,
    MCC_BACKUPS_DIR: path.join(fixture, 'backups'), MCC_RECOVERY_DIR: path.join(fixture, 'recovery'),
    MCC_PM_EXCEL_DIR: path.join(fixture, 'pm-excel'), MCC_PM_WORK_ORDER_DIR: path.join(fixture, 'pm-work-orders'),
    MCC_UPDATE_MODE: '', MCC_UPDATE_APP_DIR: appRoot, MCC_UPDATE_STATE_DIR: path.join(fixture, 'updater-disabled'),
    MCC_UPDATE_WINDOWS_CONFIG: '', MCC_HTTPS_MODE: '', MCC_HTTPS_HOSTNAME: '',
    TEMP: path.join(fixture, 'temporary'), TMP: path.join(fixture, 'temporary'), TMPDIR: path.join(fixture, 'temporary'),
    SESSION_SECRET: 'issue-174-disposable-session', SMTP_HOST: '', SMTP_PORT: '', SMTP_USER: '', SMTP_PASS: '', SMTP_FROM: '',
  };
  for (const [key, value] of Object.entries(fixed)) if ((key.endsWith('_DIR') && value) || ['TEMP', 'TMP', 'TMPDIR'].includes(key)) assertFixturePath(fixture, value);
  fs.mkdirSync(fixed.TEMP, { recursive: true });
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^(MCC_|SMTP_|SESSION_SECRET$|NODE_OPTIONS$|NODE_PATH$|NODE_EXTRA_CA_CERTS$|.*_PROXY$)/i.test(key))), ...fixed };
  const child = spawn(process.execPath, [path.join(appRoot, 'backend/dist/server/index.js')], {
    cwd: appRoot, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => output += chunk);
  child.stderr.on('data', chunk => output += chunk);
  const killOnExit = () => { if (child.exitCode === null) child.kill(); };
  process.once('exit', killOnExit);
  const deadline = setTimeout(killOnExit, 90_000);
  const base = `http://127.0.0.1:${port}`;
  async function close() {
    clearTimeout(deadline);
    if (child.exitCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill();
      await Promise.race([exited, pause(2_000)]);
      if (child.exitCode === null) { child.kill('SIGKILL'); await exited; }
    }
    process.removeListener('exit', killOnExit);
    fs.writeFileSync(path.join(fixture, 'backend.log'), output);
  }
  try {
    const started = Date.now();
    let ready = false;
    while (Date.now() - started < 10_000) {
      assert.equal(child.exitCode, null, output);
      try { ready = (await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(500) })).ok; } catch {}
      if (ready) break;
      await pause(100);
    }
    assert.ok(ready, `Inspection backend did not become ready: ${output}`);
  } catch (error) { await close(); throw error; }
  return { fixture, appRoot, uploadsDir, base, child, close };
}
