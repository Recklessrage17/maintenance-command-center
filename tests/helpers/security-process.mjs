import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const password = 'Local-Security-Test!9a';
export const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const ownedProcesses = new Set();
process.once('exit', () => {
  for (const child of ownedProcesses) if (child.exitCode === null) child.kill('SIGKILL');
});

export async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  assert.notEqual(port, 4273, 'Never use the production application port.');
  return port;
}

export function assertFixturePath(fixture, target) {
  const relative = path.relative(fs.realpathSync(fixture), path.resolve(target));
  assert.ok(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), 'Fixture path must stay inside its sandbox.');
  let parent = path.resolve(target);
  while (parent !== path.resolve(fixture)) {
    if (fs.existsSync(parent)) assert.equal(fs.lstatSync(parent).isSymbolicLink(), false, 'Writable fixture paths cannot traverse links.');
    parent = path.dirname(parent);
  }
  return target;
}

export async function backendFixture(label, extraEnv = {}, { rootEnvText, observeUploads = false, serveFrontend = false } = {}) {
  assert.match(label, /^[a-z0-9-]+$/, 'Fixture label must be a safe directory name.');
  const fixture = path.join(root, 'tmp', `${label}-${Date.now()}-${process.pid}`);
  fs.mkdirSync(fixture, { recursive: true });
  const appRoot = assertFixturePath(fixture, path.join(fixture, 'app'));
  fs.mkdirSync(path.join(appRoot, 'backend'), { recursive: true });
  // Startup resolves .env relative to this disposable runtime, never the checkout.
  fs.cpSync(path.join(root, 'backend/dist'), path.join(appRoot, 'backend/dist'), { recursive: true });
  fs.copyFileSync(path.join(root, 'package.json'), path.join(appRoot, 'package.json'));
  fs.copyFileSync(path.join(root, 'backend/package.json'), path.join(appRoot, 'backend/package.json'));
  fs.cpSync(path.join(root, 'shared'), path.join(appRoot, 'shared'), { recursive: true });
  if (serveFrontend) fs.cpSync(path.join(root, 'frontend/dist'), path.join(appRoot, 'frontend/dist'), { recursive: true });
  fs.symlinkSync(path.join(root, 'backend/node_modules'), path.join(appRoot, 'backend/node_modules'), 'junction');
  if (rootEnvText !== undefined) fs.writeFileSync(path.join(appRoot, '.env'), rootEnvText);
  const port = await freePort();
  const fixed = {
    NODE_ENV: 'test', PORT: String(port), MCC_BIND_HOST: '127.0.0.1',
    MCC_DATA_DIR: path.join(fixture, 'data'), MCC_UPLOADS_DIR: path.join(fixture, 'uploads'),
    MCC_BACKUPS_DIR: path.join(fixture, 'backups'), MCC_RECOVERY_DIR: path.join(fixture, 'recovery'),
    MCC_PM_EXCEL_DIR: path.join(fixture, 'pm-excel'), MCC_PM_WORK_ORDER_DIR: path.join(fixture, 'pm-work-orders'),
    TEMP: path.join(fixture, 'temporary'), TMP: path.join(fixture, 'temporary'), TMPDIR: path.join(fixture, 'temporary'),
    MCC_UPDATE_MODE: '', MCC_UPDATE_APP_DIR: appRoot, MCC_UPDATE_STATE_DIR: path.join(fixture, 'updater-disabled'),
    MCC_UPDATE_WINDOWS_CONFIG: '', MCC_HTTPS_MODE: '', MCC_HTTPS_HOSTNAME: '',
  };
  for (const [key, value] of Object.entries(extraEnv)) {
    assert.equal(key, key.toUpperCase(), 'Fixture environment keys must use canonical casing.');
    if (key in fixed) assert.equal(value, fixed[key], `Cannot override isolated ${key}.`);
    if (/^MCC_.*(?:DIR|PATH|CONFIG)$/.test(key)) assert.ok(key in fixed, `Unknown writable configuration ${key}.`);
    assert.ok(!['NODE_OPTIONS', 'NODE_PATH', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA'].includes(key), `Unsafe fixture override ${key}.`);
  }
  for (const [key, value] of Object.entries(fixed)) if (key.endsWith('_DIR') || ['TEMP', 'TMP', 'TMPDIR'].includes(key)) assertFixturePath(fixture, value);
  fs.mkdirSync(fixed.TEMP, { recursive: true });
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(MCC_|SMTP_|SESSION_SECRET$|NODE_OPTIONS$|NODE_PATH$|NODE_EXTRA_CA_CERTS$|.*_PROXY$)/i.test(key))),
    ...fixed,
    SESSION_SECRET: 'isolated-security-fixture',
    SMTP_HOST: '', SMTP_PORT: '', SMTP_USER: '', SMTP_PASS: '', SMTP_FROM: '',
    ...extraEnv,
  };
  assert.ok(['', 'localhost', '127.0.0.1', '::1'].includes(env.SMTP_HOST), 'SMTP fixtures must use loopback.');
  const eventsPath = assertFixturePath(fixture, path.join(fixture, 'upload-events.jsonl'));
  if (observeUploads) env.MCC_TEST_UPLOAD_EVENTS = eventsPath;
  const args = ['--max-old-space-size=256'];
  if (observeUploads) args.push('--import', pathToFileURL(path.join(root, 'tests/helpers/upload-observer.mjs')).href);
  args.push(path.join(appRoot, 'backend/dist/server/index.js'));
  const child = spawn(process.execPath, args, {
    cwd: appRoot, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  ownedProcesses.add(child);
  child.once('exit', () => ownedProcesses.delete(child));
  let output = '';
  child.stdout.on('data', chunk => output += chunk);
  child.stderr.on('data', chunk => output += chunk);
  const deadline = setTimeout(() => child.kill('SIGKILL'), 90_000);
  const base = `http://127.0.0.1:${port}`;
  async function close() {
    clearTimeout(deadline);
    if (child.exitCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill();
      await Promise.race([exited, pause(2_000)]);
      if (child.exitCode === null) { child.kill('SIGKILL'); await exited; }
    }
    fs.writeFileSync(assertFixturePath(fixture, path.join(fixture, 'backend.log')), output);
    // Retain isolated fixtures and logs for failed or later-reviewed runs.
  }
  try {
    const started = Date.now();
    while (Date.now() - started < 10_000) {
      assert.equal(child.exitCode, null, `Backend exited during startup: ${output}`);
      try { if ((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(500) })).ok) break; } catch {}
      await pause(100);
    }
    assert.equal((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1_000) })).status, 200);
  } catch (error) { await close(); throw error; }
  return { fixture, appRoot, env, eventsPath, base, child, close, output: () => output };
}

export async function request(base, pathname, { method = 'GET', cookie = '', body, headers = {} } = {}) {
  const form = body instanceof FormData || Buffer.isBuffer(body);
  const response = await fetch(`${base}${pathname}`, {
    method, headers: { ...(cookie ? { Cookie: cookie } : {}),
      ...(body !== undefined && !form ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : form ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(3_000),
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text }; }
  return { response, data, text, cookie: response.headers.get('set-cookie')?.split(';')[0] || '' };
}

export async function owner(base) {
  let result = await request(base, '/api/auth/setup-first-admin', {
    method: 'POST', body: { fullName: 'Local Security Owner', email: 'owner@example.test', password, confirmPassword: password },
  });
  assert.equal(result.response.status, 200);
  result = await request(base, '/api/auth/login', { method: 'POST', body: { email: 'owner@example.test', password } });
  assert.equal(result.response.status, 200);
  assert.ok(result.cookie);
  return result.cookie;
}

export async function healthy(runtime) {
  assert.equal(runtime.child.exitCode, null, runtime.output());
  const response = await fetch(`${runtime.base}/api/health`, { signal: AbortSignal.timeout(1_000) });
  assert.equal(response.status, 200, 'Backend remains responsive after disruptive input.');
}

export function filesUnder(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(file) : [file];
  });
}
