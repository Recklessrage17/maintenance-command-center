import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = path.join(root, 'tmp', `system-version-${Date.now()}-${process.pid}`);
const dataDir = path.join(fixture, 'data');
const passwords = {
  owner: 'Owner-Version!7',
  admin: 'Admin-Version!7',
  manager: 'Manager-Version!7',
  tech1: 'Tech1-Version!7',
  tech2: 'Tech2-Version!7',
  tech3: 'Tech3-Version!7',
};
let server;
let serverOutput = '';

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}

async function start(port, environment = {}) {
  const child = spawn(process.execPath, ['backend/dist/server/index.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
      SESSION_SECRET: 'system-version-test',
      MCC_DATA_DIR: dataDir,
      MCC_UPLOADS_DIR: path.join(fixture, 'uploads'),
      MCC_BACKUPS_DIR: path.join(fixture, 'backups'),
      ...environment,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => serverOutput += chunk);
  child.stderr.on('data', chunk => serverOutput += chunk);
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Backend exited.\n${serverOutput}`);
    try {
      if ((await fetch(`${base}/api/health`)).ok) return { child, base };
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Backend did not start.\n${serverOutput}`);
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  server.kill();
  await Promise.race([
    new Promise(resolve => server.once('exit', resolve)),
    new Promise(resolve => setTimeout(resolve, 10_000)),
  ]);
}

async function request(base, pathname, { method = 'GET', cookie = '', body } = {}) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { response, data, cookie: response.headers.get('set-cookie')?.split(';')[0] || '' };
}

async function login(base, email, password) {
  const result = await request(base, '/api/auth/login', { method: 'POST', body: { email, password } });
  assert.equal(result.response.status, 200, `Login failed for ${email}: ${JSON.stringify(result.data)}`);
  return { cookie: result.cookie, user: result.data.user };
}

async function createUser(base, ownerCookie, key, role) {
  const result = await request(base, '/api/users', {
    method: 'POST',
    cookie: ownerCookie,
    body: {
      fullName: `${key} Version User`,
      email: `${key}@example.com`,
      role,
      temporaryPassword: passwords[key],
    },
  });
  assert.equal(result.response.status, 201, JSON.stringify(result.data));
}

async function run() {
  fs.mkdirSync(fixture, { recursive: true });
  const runtime = await start(await freePort());
  server = runtime.child;
  const { base } = runtime;
  const rootManifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const git = spawnSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true });
  const expectedCommit = git.status === 0 && /^[0-9a-f]{7,12}$/i.test(git.stdout.trim()) ? git.stdout.trim() : null;

  let result = await request(base, '/api/version');
  assert.equal(result.response.status, 401);
  assert.equal(result.data.error, 'Login required.');

  result = await request(base, '/api/auth/setup-first-admin', {
    method: 'POST',
    body: {
      fullName: 'Owner Admin',
      email: 'owner@example.com',
      password: passwords.owner,
      confirmPassword: passwords.owner,
    },
  });
  assert.equal(result.response.status, 200);
  const owner = await login(base, 'owner@example.com', passwords.owner);
  assert.equal(owner.user.role, 'Admin');
  assert.equal(owner.user.isOwnerAdmin, true);
  assert.equal(owner.user.canViewSystemVersion, true);

  for (const [key, role] of [
    ['admin', 'Admin'],
    ['manager', 'Manager'],
    ['tech1', 'Maintenance Tech 1'],
    ['tech2', 'Maintenance Tech 2'],
    ['tech3', 'Maintenance Tech 3'],
  ]) await createUser(base, owner.cookie, key, role);

  const sessions = { owner };
  for (const key of ['admin', 'manager', 'tech1', 'tech2', 'tech3']) {
    sessions[key] = await login(base, `${key}@example.com`, passwords[key]);
  }

  for (const key of ['owner', 'admin']) {
    result = await request(base, '/api/version', { cookie: sessions[key].cookie });
    assert.equal(result.response.status, 200, `${key} should see version metadata.`);
    assert.deepEqual(result.data, {
      version: rootManifest.version,
      displayVersion: `v${rootManifest.version}`,
      commit: expectedCommit,
      buildDate: null,
    });
    assert.equal(sessions[key].user.canViewSystemVersion, true);
  }

  for (const key of ['manager', 'tech1', 'tech2', 'tech3']) {
    result = await request(base, '/api/version', { cookie: sessions[key].cookie });
    assert.equal(result.response.status, 403, `${key} must not see version metadata.`);
    assert.deepEqual(result.data, { ok: false, error: 'Admin access required.' });
    assert.equal(sessions[key].user.canViewSystemVersion, false);
  }

  await stopServer();
  const noGitPath = path.join(fixture, 'no-git-path');
  fs.mkdirSync(noGitPath, { recursive: true });
  const fallbackRuntime = await start(await freePort(), { PATH: noGitPath });
  server = fallbackRuntime.child;
  const fallbackOwner = await login(fallbackRuntime.base, 'owner@example.com', passwords.owner);
  result = await request(fallbackRuntime.base, '/api/version', { cookie: fallbackOwner.cookie });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.version, rootManifest.version);
  assert.equal(result.data.displayVersion, `v${rootManifest.version}`);
  assert.equal(result.data.commit, null);
  assert.equal(result.data.buildDate, null);

  assert.equal(serverOutput.includes(passwords.owner), false);
  console.log('System version API tests passed for all roles, authoritative metadata, and startup without Git metadata.');
}

try {
  await run();
} finally {
  await stopServer();
  const resolved = path.resolve(fixture);
  const allowed = path.resolve(root, 'tmp');
  if (resolved.startsWith(`${allowed}${path.sep}`) && fs.existsSync(resolved)) {
    try {
      fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
    } catch {}
  }
}
