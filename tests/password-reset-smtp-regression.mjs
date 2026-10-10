import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { backendFixture, owner, request, password, root, freePort, healthy } from './helpers/security-process.mjs';
import { smtpFixture, credentials } from './helpers/smtp-fixture.mjs';

const nodemailer = createRequire(path.join(root, 'backend/package.json'))('nodemailer');
const expectedResponse = { ok: true, message: 'If the email matches an account, password reset instructions will be sent.' };
const deadline = setTimeout(() => { console.error('SMTP security regression exceeded its hard execution limit.'); process.exit(1); }, 90_000);
let checks = 0;
async function reset(runtime, email) {
  const result = await request(runtime.base, '/api/auth/forgot-password', { method: 'POST', body: { email } });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.data, expectedResponse);
  assert.equal(result.text.includes(credentials.pass), false);
  checks++;
  return result;
}
function transport(smtp, extras = {}) {
  return nodemailer.createTransport({ host: '127.0.0.1', port: smtp.port, secure: false,
    auth: credentials, tls: { ca: smtp.cert, rejectUnauthorized: true }, connectionTimeout: 1_000,
    greetingTimeout: 1_000, socketTimeout: 2_000, ...extras });
}

async function withBackend(smtp, initialize, run) {
  let runtime;
  try { runtime = await initialize(); return await run(runtime); }
  finally { try { await runtime?.close(); } finally { await smtp?.close(); } }
}
async function assertPortReleased(port) {
  const server = net.createServer();
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  } finally { await new Promise(resolve => server.close(resolve)); }
}
async function initializationFailures() {
  const originalListen = net.Server.prototype.listen;
  for (const scenario of ['ipv4-error', 'ipv4-throw', 'ipv6-error']) {
    const servers = [];
    const injected = Object.assign(new Error('Controlled local SMTP initialization failure'), { code: 'EADDRNOTAVAIL' });
    let raw, rawClosed, port;
    try {
      net.Server.prototype.listen = function (...args) {
        servers.push(this);
        const [requestedPort, host] = args;
        if (host === (scenario === 'ipv6-error' ? '::1' : '127.0.0.1')) {
          if (scenario === 'ipv4-throw') throw injected;
          if (scenario === 'ipv6-error') {
            port = requestedPort;
            raw = net.createConnection({ host: '127.0.0.1', port });
            raw.on('error', () => {});
            rawClosed = new Promise(resolve => raw.once('close', resolve));
            // Leave an incomplete TLS handshake open during the second listener's failure.
            raw.once('connect', () => this.emit('error', injected));
          } else queueMicrotask(() => this.emit('error', injected));
          return this;
        }
        return originalListen.apply(this, args);
      };
      await assert.rejects(smtpFixture({ implicitTLS: scenario === 'ipv6-error' }), error => error === injected);
      if (rawClosed) await rawClosed;
      assert.ok(servers.every(server => !server.listening), 'All partially acquired listeners must close.');
      assert.ok(servers.every(server => server.listenerCount('error') === 0 && server.listenerCount('listening') === 0), 'Startup listeners must be removed after failure.');
      checks++;
    } finally {
      net.Server.prototype.listen = originalListen;
      raw?.destroy();
      await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
    }
    if (port) await assertPortReleased(port);
  }
  const smtp = await smtpFixture();
  await assert.rejects(withBackend(smtp,
    () => backendFixture('smtp-initialization-failure', { ...smtp.env, NODE_OPTIONS: '--invalid-fixture-option' }),
    () => assert.fail('Rejected backend initialization cannot run a test.')), /Unsafe fixture override NODE_OPTIONS/);
  await assertPortReleased(smtp.port);
  await Promise.all([smtp.close(), smtp.close()]);
  checks++;
  const implicit = await smtpFixture({ implicitTLS: true });
  const raw = net.createConnection({ host: '127.0.0.1', port: implicit.port });
  raw.on('error', () => {});
  const closed = new Promise(resolve => raw.once('close', resolve));
  try {
    await once(raw, 'connect');
    await Promise.all([implicit.close(), implicit.close()]);
    await closed;
    await implicit.close();
    await assertPortReleased(implicit.port);
    checks++;
  } finally { raw.destroy(); await implicit.close(); }
}

try {
  await initializationFailures();
  const smtp = await smtpFixture();
  await withBackend(smtp, () => backendFixture('smtp-security', smtp.env), async runtime => {
    const cookie = await owner(runtime.base);
    await reset(runtime, 'unknown@example.test');
    assert.equal(smtp.messages.length, 0);
    await reset(runtime, 'owner@example.test');
    assert.equal(smtp.messages.length, 1);
    const message = smtp.messages[0];
    assert.deepEqual(message.to, ['owner@example.test']);
    assert.equal(message.from, 'mcc@example.test');
    assert.equal(message.encrypted, true, 'Actual MCC reset uses STARTTLS when advertised.');
    assert.match(message.text, /Subject: MCC password reset/);
    const temporaryPassword = message.text.match(/Temporary password: ([^\r\n]+)/)?.[1];
    assert.ok(temporaryPassword);
    assert.match(message.text, /Expires:/);
    let result = await request(runtime.base, '/api/users', { cookie });
    assert.equal(result.response.status, 401, 'Reset invalidates the previous session.');
    result = await request(runtime.base, '/api/auth/login', { method: 'POST', body: { email: 'owner@example.test', password } });
    assert.equal(result.response.status, 401, 'Old password no longer authenticates.');
    result = await request(runtime.base, '/api/auth/login', { method: 'POST', body: { email: 'owner@example.test', password: temporaryPassword } });
    assert.equal(result.response.status, 200);
    assert.equal(result.data.user.forcePasswordChange, true);
    assert.equal(runtime.output().includes(temporaryPassword), false);
    assert.equal(runtime.output().includes(credentials.pass), false);
    const db = new DatabaseSync(path.join(runtime.fixture, 'data/mcc.sqlite'));
    try {
      db.prepare('UPDATE users SET email=? WHERE email=?').run('not-an-address', 'owner@example.test');
      await reset(runtime, 'not-an-address');
      assert.equal(smtp.messages.length, 1, 'Malformed stored mailbox must not deliver a reset message.');
      db.prepare('UPDATE users SET email=?,disabled=1 WHERE email=?').run('disabled@example.test', 'not-an-address');
      await reset(runtime, 'disabled@example.test');
      assert.equal(smtp.messages.length, 1);
    } finally { db.close(); }
    assert.ok(smtp.authentications.some(item => item.accepted && item.encrypted));
    await healthy(runtime);
  });

  const implicit = await smtpFixture({ implicitTLS: true });
  let mailer, wrongHost;
  try {
    mailer = transport(implicit, { secure: true, host: 'localhost', tls: { ca: implicit.cert, servername: 'localhost', rejectUnauthorized: true } });
    const sent = await mailer.sendMail({ from: 'mcc@example.test', to: 'exact@example.test', subject: 'Local SMTPS fixture', text: 'Dummy fixture only.' });
    assert.deepEqual(sent.accepted, ['exact@example.test']);
    assert.deepEqual(implicit.messages[0].to, ['exact@example.test']);
    assert.equal(implicit.messages[0].encrypted, true);
    mailer.close(); checks++;
    wrongHost = transport(implicit, { secure: true, host: 'localhost', tls: { ca: implicit.cert, servername: 'wrong-host.invalid', rejectUnauthorized: true } });
    const before = implicit.authentications.length;
    await assert.rejects(wrongHost.verify(), /certificate|hostname|altnames/i);
    assert.equal(implicit.authentications.length, before, 'TLS identity failure precedes AUTH.');
    wrongHost.close(); checks++;
  } finally { mailer?.close(); wrongHost?.close(); await implicit.close(); }

  for (const scenario of ['authentication', 'certificate', 'connection']) {
    const smtp = scenario === 'connection' ? undefined : await smtpFixture({ rejectAuth: scenario === 'authentication' });
    await withBackend(smtp, async () => {
      const env = smtp ? { ...smtp.env } : { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(await freePort()), SMTP_USER: credentials.user, SMTP_PASS: credentials.pass, SMTP_FROM: 'mcc@example.test' };
      if (scenario === 'certificate') env.NODE_EXTRA_CA_CERTS = '';
      return backendFixture(`smtp-${scenario}-failure`, env);
    }, async runtime => {
      const cookie = await owner(runtime.base);
      await reset(runtime, 'owner@example.test');
      assert.equal(smtp?.messages.length || 0, 0);
      const denied = await request(runtime.base, '/api/users', { cookie });
      assert.equal(denied.response.status, 401, 'Delivery failure preserves existing reset/session contract.');
      assert.match(runtime.output(), /reset email failed/i);
      assert.equal(runtime.output().includes(credentials.pass), false);
      if (scenario === 'certificate') assert.equal(smtp.authentications.length, 0);
      await healthy(runtime);
    });
  }

  const plaintext = await smtpFixture({ startTLS: false });
  let plaintextMailer;
  try {
    plaintextMailer = transport(plaintext, { requireTLS: true });
    await assert.rejects(plaintextMailer.verify(), /STARTTLS|TLS|command|unexpected/i);
    assert.equal(plaintext.authentications.length, 0, 'Required TLS refuses credentials before an unsupported upgrade.');
    checks++;
  } finally { plaintextMailer?.close(); await plaintext.close(); }
  const malformed = await smtpFixture();
  let malformedMailer;
  try {
    malformedMailer = transport(malformed);
    const corrected = await malformedMailer.sendMail({ from: 'mcc@example.test', to: '"user"@example.test(x)evil.test', subject: 'Comment parsing fixture', text: 'No real mail.' });
    assert.deepEqual(corrected.accepted, ['user@example.test']);
    assert.deepEqual(malformed.messages[0].to, ['user@example.test'], 'Trailing comment text must not alter the delivery domain.');
    await assert.rejects(malformedMailer.sendMail({ from: 'mcc@example.test', to: 'not-an-address', subject: 'Invalid local fixture', text: 'No real mail.' }));
    assert.equal(malformed.messages.length, 1);
    checks++;
  } finally { malformedMailer?.close(); await malformed.close(); }
  console.log(`SMTP security passed: ${checks} scenarios; exception-safe listener/backend initialization and idempotent cleanup, actual local reset delivery, exact envelope, credentials/session rotation, authentication/connection/certificate failures, STARTTLS, implicit TLS, and malformed mailbox rejection.`);
} finally { clearTimeout(deadline); }
