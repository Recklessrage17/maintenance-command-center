import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const posix = value => {
  if (process.platform !== 'win32' || !path.isAbsolute(value)) return value;
  const conversion = spawnSync(bash, ['-c', 'cygpath -u "$1"', '_', value], { encoding: 'utf8' });
  assert.equal(conversion.status, 0, conversion.stderr);
  return conversion.stdout.trim();
};
const script = posix(path.resolve('deployment/raspberry-pi/create-deployment-rollback'));
const run = (args, env = process.env) => spawnSync(bash, [script, ...args.map(posix)], { encoding: 'utf8', env });
const put = (file, value = 'test') => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcc-rollback-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, 'app');
  const backups = path.join(root, 'deployment-backups');
  fs.mkdirSync(backups);
  put(path.join(app, 'package.json'), '{"version":"1.5.16"}');
  put(path.join(app, 'frontend', 'package-lock.json'));
  put(path.join(app, 'backend', 'package-lock.json'));
  put(path.join(app, 'backend', 'data', 'mcc.sqlite'), 'db');
  put(path.join(app, 'backend', 'uploads', 'photo.jpg'));
  put(path.join(app, 'backend', 'documents', 'record.pdf'));
  put(path.join(app, 'backend', 'backups', 'history.zip'));
  for (const dir of ['node_modules', 'frontend/node_modules', 'backend/node_modules', 'shared/node_modules']) {
    put(path.join(app, dir, 'package', 'index.js'));
  }
  put(path.join(app, '.npm', 'cache-file'));
  return { root, app, backups, args: ['--app-dir', app, '--backup-dir', backups] };
}

function snapshot(t) {
  const f = fixture(t);
  const result = run(f.args);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const archive = path.join(f.backups, fs.readdirSync(f.backups).find(name => name.endsWith('.tar.gz')));
  return { ...f, archive, result };
}

test('includes DB, uploads, source and other runtime files; excludes backup history, dependencies and npm cache', t => {
  const { archive, result } = snapshot(t);
  const list = spawnSync(bash, ['-c', 'tar -tzf "$1"', '_', posix(archive)], { encoding: 'utf8' });
  assert.equal(list.status, 0, list.stderr);
  for (const required of ['./backend/data/mcc.sqlite', './backend/uploads/photo.jpg', './backend/documents/record.pdf', './frontend/package-lock.json']) {
    assert.ok(list.stdout.includes(required), required);
  }
  for (const excluded of ['backend/backups', 'node_modules', '.npm/cache-file']) {
    assert.ok(!list.stdout.includes(excluded), excluded);
  }
  assert.match(result.stdout, /SHA256: [0-9a-f]{64}/);
  assert.match(result.stdout, /Available disk space/);
  assert.match(result.stdout, /DB included: yes/);
  assert.match(result.stdout, /Uploads included: yes/);
});

test('corrupt archive fails verification', t => {
  const { archive } = snapshot(t);
  fs.appendFileSync(archive, 'corruption');
  const result = run(['--verify-only', archive]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /integrity check failed/);
});

test('missing DB fails and retains old deployment archive', t => {
  const f = fixture(t);
  const old = path.join(f.backups, 'old-full.tar.gz');
  put(old, 'previous archive');
  fs.rmSync(path.join(f.app, 'backend', 'data', 'mcc.sqlite'));
  const result = run([...f.args, '--replace-old', old]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing regular backend\/data\/mcc.sqlite/);
  assert.equal(fs.readFileSync(old, 'utf8'), 'previous archive');
});

test('failed replacement verification retains old archive', t => {
  const f = fixture(t);
  const old = path.join(f.backups, 'old-full.tar.gz');
  put(old, 'previous archive');
  const bashEnv = path.join(f.root, 'test-bash-env');
  put(bashEnv, 'tar() { /usr/bin/tar "$@"; status=$?; if [[ "$1" == "-czf" && $status -eq 0 ]]; then printf corruption >> "$2"; fi; return "$status"; }\n');
  const result = run([...f.args, '--replace-old', old], { ...process.env, BASH_ENV: posix(bashEnv) });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /integrity check failed/);
  assert.equal(fs.readFileSync(old, 'utf8'), 'previous archive');
});

test('old archive is removed only after verified replacement', t => {
  const f = fixture(t);
  const old = path.join(f.backups, 'old-full.tar.gz');
  put(old, 'previous archive');
  const result = run([...f.args, '--replace-old', old]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.existsSync(old), false);
  assert.match(result.stdout, /Rollback snapshot verified/);
  assert.match(result.stdout, /Removed old deployment archive/);
  assert.equal(fs.readdirSync(f.backups).filter(name => name.endsWith('.tar.gz')).length, 1);
});

test('refuses deletion outside the deployment backup directory', t => {
  const f = fixture(t);
  const outside = path.join(f.root, 'outside.tar.gz');
  put(outside, 'must stay');
  const result = run([...f.args, '--replace-old', outside]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /direct .tar.gz file/);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'must stay');
});

test('refuses archive destination inside MCC source', t => {
  const f = fixture(t);
  const result = run(['--app-dir', f.app, '--backup-dir', path.join(f.app, 'archive')]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /outside the application directory/);
});
