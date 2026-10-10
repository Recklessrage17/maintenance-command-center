import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const filename = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(filename), '..');
const require = createRequire(path.join(root, 'backend/package.json'));
const copies = [
  ['node_modules/brace-expansion', '1.1.21'],
  ['node_modules/exceljs/node_modules/brace-expansion', '2.1.7'],
  ['node_modules/readdir-glob/node_modules/brace-expansion', '5.0.12'],
];
const patterns = [
  '{1..1000000000}',
  '{a,b}'.repeat(35),
  '{}'.repeat(5000),
  '{'.repeat(1500) + 'a,b' + '}'.repeat(1500),
  '{' + '{a},'.repeat(2000) + 'z}',
  '{a}' + '}'.repeat(5000) + ',z}',
];

if (process.argv[2] === '--worker') {
  const index = Number(process.argv[3]);
  if (process.argv[4] === 'brace') {
    const folder = path.join(root, 'backend', copies[index][0]);
    const loaded = require(folder);
    const expand = typeof loaded === 'function' ? loaded : loaded.expand;
    assert.deepEqual(expand('x{a,b}'), ['xa', 'xb']);
    const output = expand(patterns[Number(process.argv[5])]);
    assert.ok(Array.isArray(output));
    assert.ok(output.length <= 100_000, 'Expansion result count remains bounded.');
    assert.ok(output.reduce((total, value) => total + value.length, 0) <= 4_000_000,
      'Expansion output memory remains bounded.');
  } else {
    const parser = require('nodemailer/lib/addressparser');
    const address = parser(' >' + '>[x][x]'.repeat(10_000));
    assert.ok(Array.isArray(address));
    const transport = require('nodemailer').createTransport({ jsonTransport: true });
    let to = 'owner@example.test';
    for (let depth = 0; depth < 5000; depth++) to = [to];
    const result = await transport.sendMail({ from: 'mcc@example.test', to, text: 'Dummy security fixture' });
    assert.deepEqual(result.envelope.to, ['owner@example.test']);
  }
  console.log('bounded worker passed');
} else {
  const versions = { express: '4.22.3', multer: '2.4.0', nodemailer: '10.0.16',
    'proxy-addr': '2.0.8', 'body-parser': '1.20.8', qs: '6.16.0' };
  for (const [name, version] of Object.entries(versions)) {
    assert.equal(JSON.parse(fs.readFileSync(require.resolve(name + '/package.json'), 'utf8')).version, version);
  }
  for (const [folder, version] of copies) {
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'backend', folder, 'package.json'), 'utf8')).version, version);
  }
  const proxy = require('proxy-addr');
  const loopback = proxy.compile('loopback');
  assert.equal(loopback('127.0.0.1'), true);
  assert.equal(loopback('::1'), true);
  assert.equal(loopback('203.0.113.9'), false);
  assert.equal(proxy({ socket: { remoteAddress: '203.0.113.9' }, headers: { 'x-forwarded-for': '127.0.0.1' } }, loopback), '203.0.113.9');
  assert.equal(proxy({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': '203.0.113.9' } }, loopback), '203.0.113.9');
  assert.equal(proxy.compile('10.0.0.0/8')('10.1.2.3'), true);
  // A prefix shorter than the mapped IPv4 portion must not trust every IPv4 client.
  assert.equal(proxy.compile('::ffff:10.0.0.0/8')('203.0.113.9'), false);
  const qs = require('qs');
  assert.deepEqual(qs.parse('search=press&tags=a&tags=b&nested[value]=safe'),
    { search: 'press', tags: ['a', 'b'], nested: { value: 'safe' } });
  assert.deepEqual(qs.parse('tags=a,b'), { tags: 'a,b' });
  assert.equal({}.polluted, undefined);
  qs.parse('__proto__[polluted]=yes&constructor[prototype][polluted]=yes');
  assert.equal({}.polluted, undefined);
  assert.doesNotThrow(() => qs.stringify(qs.parse('constructor[isBuffer]=x', { allowPrototypes: true })));
  assert.throws(() => qs.parse('a[]=x,y,z', { comma: true, arrayLimit: 2, throwOnLimitExceeded: true }), RangeError);
  assert.throws(() => require('body-parser').json({ limit: 'invalid-security-fixture' }), /limit/i);

  const express = require('express');
  const app = express();
  app.use(express.json({ limit: '1kb' }));
  app.get('/query', (req, res) => res.json(req.query));
  app.post('/json', (req, res) => res.json(req.body));
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.type }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  assert.notEqual(server.address().port, 4273);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(base + '/query?search=press&tags=a&tags=b&nested[value]=safe', { signal: AbortSignal.timeout(1000) });
    assert.deepEqual(await response.json(), { search: 'press', tags: ['a', 'b'], nested: { value: 'safe' } });
    const json = await fetch(base + '/json', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { array: ['safe', 'flat form fields'] } }), signal: AbortSignal.timeout(1000) });
    assert.equal(json.status, 200);
    assert.deepEqual(await json.json(), { settings: { array: ['safe', 'flat form fields'] } });
    const tooLarge = await fetch(base + '/json', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'x'.repeat(1024) }), signal: AbortSignal.timeout(1000) });
    assert.equal(tooLarge.status, 413);
    assert.deepEqual(await tooLarge.json(), { error: 'entity.too.large' });
  } finally { await new Promise(resolve => server.close(resolve)); }

  async function bounded(args) {
    const child = spawn(process.execPath, ['--max-old-space-size=96', filename, '--worker', ...args],
      { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', data => output += data);
    child.stderr.on('data', data => output += data);
    let timedOut = false;
    const deadline = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 5000);
    try {
      const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
      assert.equal(timedOut, false, `Worker exceeded hard deadline: ${args}`);
      assert.equal(code, 0, `Worker failed ${args}: ${output}`);
    } finally { clearTimeout(deadline); if (child.exitCode === null) child.kill('SIGKILL'); }
  }
  for (let copy = 0; copy < copies.length; copy++) {
    for (let pattern = 0; pattern < patterns.length; pattern++) await bounded([String(copy), 'brace', String(pattern)]);
  }
  await bounded(['0', 'mail']);
  console.log('Dependency security passed: exact installed versions; Express/qs/body-parser; loopback and mapped proxy trust; 18 brace workers across all 3 installed copies; bounded Nodemailer address parsing.');
}
