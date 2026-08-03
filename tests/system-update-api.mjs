import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = path.join(root, 'tmp', `system-update-api-${Date.now()}-${process.pid}`);
const dataDir = path.join(fixture, 'data');
const ownerPassword = 'Owner-Update!7';
const managerPassword = 'Manager-Update!7';
const technicianPassword = 'Technician-Update!7';
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

async function start(port) {
  const child = spawn(process.execPath, ['backend/dist/server/index.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
      SESSION_SECRET: 'system-update-api-test',
      MCC_DATA_DIR: dataDir,
      MCC_UPLOADS_DIR: path.join(fixture, 'uploads'),
      MCC_BACKUPS_DIR: path.join(fixture, 'backups'),
      MCC_UPDATE_MODE: '',
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

async function request(base, pathname, { method = 'GET', cookie = '', body, headers = {} } = {}) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      ...headers,
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
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  return result.cookie;
}

fs.mkdirSync(fixture, { recursive: true });
try {
  const runtime = await start(await freePort());
  server = runtime.child;
  const { base } = runtime;

  let result = await request(base, '/api/health');
  assert.equal(result.response.status, 200);
  assert.equal('systemUpdate' in result.data, false);
  result = await request(base, '/api/system/update/managed-readiness');
  assert.equal(result.response.status, 200);
  assert.equal(result.data.systemUpdate.configured, false);
  assert.equal(result.data.systemUpdate.enabled, false);
  assert.equal(result.data.systemUpdate.applicationMatchesConfiguration, false);

  for (const [method, pathname] of [
    ['GET', '/api/system/update/status'],
    ['POST', '/api/system/update/check'],
    ['POST', '/api/system/update/install'],
  ]) {
    const result = await request(base, pathname, { method, body: method === 'POST' ? {} : undefined });
    assert.equal(result.response.status, 401, `${method} ${pathname} must require authentication.`);
    assert.equal(result.data.error, 'Login required.');
  }

  result = await request(base, '/api/auth/setup-first-admin', {
    method: 'POST',
    body: {
      fullName: 'Owner Admin',
      email: 'owner@example.com',
      password: ownerPassword,
      confirmPassword: ownerPassword,
    },
  });
  assert.equal(result.response.status, 200);
  const ownerCookie = await login(base, 'owner@example.com', ownerPassword);

  result = await request(base, '/api/users', {
    method: 'POST',
    cookie: ownerCookie,
    body: {
      fullName: 'Manager User',
      email: 'manager@example.com',
      role: 'Manager',
      temporaryPassword: managerPassword,
    },
  });
  assert.equal(result.response.status, 201, JSON.stringify(result.data));
  const managerCookie = await login(base, 'manager@example.com', managerPassword);

  result = await request(base, '/api/users', {
    method: 'POST',
    cookie: ownerCookie,
    body: {
      fullName: 'Maintenance Technician',
      email: 'technician@example.com',
      role: 'Maintenance Tech 1',
      temporaryPassword: technicianPassword,
    },
  });
  assert.equal(result.response.status, 201, JSON.stringify(result.data));
  const technicianCookie = await login(base, 'technician@example.com', technicianPassword);

  for (const [roleLabel, cookie] of [['Manager', managerCookie], ['Maintenance Tech', technicianCookie]]) {
    for (const [method, pathname] of [
      ['GET', '/api/system/update/status'],
      ['POST', '/api/system/update/check'],
      ['POST', '/api/system/update/install'],
    ]) {
      result = await request(base, pathname, { method, cookie, body: method === 'POST' ? {} : undefined });
      assert.equal(result.response.status, 403, `${roleLabel} must be denied ${method} ${pathname}.`);
      assert.deepEqual(result.data, { ok: false, error: 'Admin access required.' });
    }
  }

  result = await request(base, '/api/system/update/status', { cookie: ownerCookie });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.configured, false);
  assert.equal(result.data.environmentLabel, 'UPDATER NOT CONFIGURED');
  assert.ok(result.data.csrfToken);
  assert.equal(JSON.stringify(result.data).includes(root), false);
  const csrfToken = result.data.csrfToken;

  result = await request(base, '/api/system/update/check', {
    method: 'POST',
    cookie: ownerCookie,
    body: { branch: 'client-selected', gitPath: 'C:\\browser-controlled\\git.exe' },
  });
  assert.equal(result.response.status, 400);
  assert.equal(result.data.code, 'invalid_request');
  assert.equal(JSON.stringify(result.data).includes('browser-controlled'), false);

  result = await request(base, '/api/system/update/check', { method: 'POST', cookie: ownerCookie, body: {} });
  assert.equal(result.response.status, 503);
  assert.equal(result.data.code, 'deployment_not_configured');
  assert.equal(result.data.error, 'The updater is not configured in this environment.');

  result = await request(base, '/api/system/update/install', {
    method: 'POST',
    cookie: ownerCookie,
    headers: {
      'X-MCC-CSRF-Token': csrfToken,
      Origin: 'https://evil.example',
    },
    body: { confirm: true, checkToken: 'opaque' },
  });
  assert.equal(result.response.status, 403);
  assert.equal(result.data.code, 'csrf_rejected');

  result = await request(base, '/api/system/update/install', {
    method: 'POST',
    cookie: ownerCookie,
    headers: { 'X-MCC-CSRF-Token': 'wrong-token' },
    body: { confirm: true, checkToken: 'opaque' },
  });
  assert.equal(result.response.status, 403);
  assert.equal(result.data.code, 'csrf_rejected');

  result = await request(base, '/api/system/update/install', {
    method: 'POST',
    cookie: ownerCookie,
    headers: { 'X-MCC-CSRF-Token': csrfToken },
    body: { checkToken: 'opaque' },
  });
  assert.equal(result.response.status, 400);
  assert.equal(result.data.code, 'confirmation_required');

  result = await request(base, '/api/system/update/install', {
    method: 'POST',
    cookie: ownerCookie,
    headers: { 'X-MCC-CSRF-Token': csrfToken },
    body: { confirm: true, checkToken: 'opaque', branch: 'client-selected' },
  });
  assert.equal(result.response.status, 400);
  assert.equal(result.data.code, 'invalid_request');

  result = await request(base, '/api/system/update/install', {
    method: 'POST',
    cookie: ownerCookie,
    headers: { 'X-MCC-CSRF-Token': csrfToken },
    body: { confirm: true, checkToken: 'opaque' },
  });
  assert.equal(result.response.status, 503);
  assert.equal(result.data.code, 'deployment_not_configured');

  result = await request(base, '/api/system/update/install', {
    method: 'POST',
    cookie: ownerCookie,
    headers: { 'X-MCC-CSRF-Token': csrfToken },
    body: { confirm: true, checkToken: 'opaque' },
  });
  assert.equal(result.response.status, 429);
  assert.equal(result.data.code, 'rate_limited');
  assert.ok(Number(result.data.retryAfterSeconds) > 0);
  assert.equal(result.response.headers.get('retry-after'), String(result.data.retryAfterSeconds));

  for (let attempt = 0; attempt < 4; attempt += 1) {
    result = await request(base, '/api/system/update/check', { method: 'POST', cookie: ownerCookie, body: {} });
    assert.equal(result.response.status, 503);
  }
  result = await request(base, '/api/system/update/check', { method: 'POST', cookie: ownerCookie, body: {} });
  assert.equal(result.response.status, 429);
  assert.equal(result.data.code, 'rate_limited');
  assert.ok(Number(result.data.retryAfterSeconds) > 0);
  assert.equal(result.response.headers.get('retry-after'), String(result.data.retryAfterSeconds));

  assert.equal(serverOutput.includes(ownerPassword), false);
  assert.equal(serverOutput.includes(managerPassword), false);
  assert.equal(serverOutput.includes(technicianPassword), false);
  console.log('System update API tests passed: 401/403 Admin/Manager/Maintenance Tech gating, sanitized status, disabled-mode safety, CSRF, explicit confirmation, and client configuration rejection.');
} finally {
  await stopServer();
  const resolved = path.resolve(fixture);
  const allowed = path.resolve(root, 'tmp');
  if (resolved.startsWith(`${allowed}${path.sep}`) && fs.existsSync(resolved)) {
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
