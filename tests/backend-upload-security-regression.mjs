import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { backendFixture, owner, request, healthy, filesUnder, password, pause, root, assertFixturePath } from './helpers/security-process.mjs';

// Unsafe values live only in a disposable runtime .env and point at a guarded
// sibling inside this checkout's ignored test area, never a real configuration.
const guard = path.join(root, 'tmp', `isolation-guard-${Date.now()}-${process.pid}`);
fs.mkdirSync(guard, { recursive: true });
fs.writeFileSync(path.join(guard, 'sentinel.txt'), 'must remain untouched');
const unsafe = ['MCC_DATA_DIR', 'MCC_UPLOADS_DIR', 'MCC_BACKUPS_DIR', 'MCC_RECOVERY_DIR', 'MCC_PM_EXCEL_DIR', 'MCC_PM_WORK_ORDER_DIR', 'MCC_UPDATE_STATE_DIR']
  .map(key => `${key}=${path.join(guard, key).replaceAll('\\', '/')}`).join('\n');
const isolation = await backendFixture('isolation-security', {}, { rootEnvText: `${unsafe}\nMCC_UPDATE_MODE=windows_agent\nMCC_UPDATE_WINDOWS_CONFIG=${path.join(guard, 'updater.json').replaceAll('\\', '/')}\nSMTP_HOST=unsafe.invalid\n` });
try {
  await owner(isolation.base);
  for (const key of ['MCC_DATA_DIR', 'MCC_UPLOADS_DIR', 'MCC_BACKUPS_DIR', 'MCC_RECOVERY_DIR', 'MCC_PM_EXCEL_DIR', 'MCC_PM_WORK_ORDER_DIR', 'TEMP', 'TMP', 'TMPDIR']) assertFixturePath(isolation.fixture, isolation.env[key]);
  assert.ok(fs.existsSync(path.join(isolation.env.MCC_PM_EXCEL_DIR, 'sources')));
  assert.ok(fs.existsSync(path.join(isolation.env.MCC_PM_WORK_ORDER_DIR, '.staging')));
  assert.equal(isolation.env.MCC_UPDATE_MODE, '');
  assert.deepEqual(fs.readdirSync(guard), ['sentinel.txt']);
  assert.equal(fs.readFileSync(path.join(guard, 'sentinel.txt'), 'utf8'), 'must remain untouched');
  await assert.rejects(backendFixture('unsafe-path', { MCC_PM_EXCEL_DIR: guard }), /Cannot override isolated/);
  await assert.rejects(backendFixture('unsafe-updater', { MCC_UPDATE_MODE: 'windows_agent' }), /Cannot override isolated/);
  await assert.rejects(backendFixture('unsafe-smtp', { SMTP_HOST: 'unsafe.invalid' }), /loopback/);
  assert.throws(() => assertFixturePath(isolation.fixture, guard), /sandbox/);
  const linked = path.join(isolation.fixture, 'unsafe-link'); fs.symlinkSync(guard, linked, 'junction');
  assert.throws(() => assertFixturePath(isolation.fixture, path.join(linked, 'sentinel.txt')), /links/);
} finally { await isolation.close(); }

const runtime = await backendFixture('upload-security', {
  MCC_LIBRARY_DOCUMENT_MAX_MB: '1', MCC_LIBRARY_PICTURE_MAX_MB: '1', MCC_LIBRARY_VIDEO_MAX_MB: '1',
  MCC_FACILITY_DOCUMENT_MAX_MB: '1', MCC_FACILITY_PICTURE_MAX_MB: '1', MCC_FACILITY_VIDEO_MAX_MB: '1',
}, { observeUploads: true });
const pdf = Buffer.from('%PDF-1.4\nsecurity fixture\n%%EOF\n');
let assertions = 0;
function form(fields, files = []) {
  const value = new FormData();
  for (const [name, content] of fields) value.append(name, content);
  for (const file of files) value.append(file.field, new Blob([file.bytes], { type: file.type || 'application/pdf' }), file.name);
  return value;
}
async function checked(pathname, options, expected) {
  const result = await request(runtime.base, pathname, options);
  assert.equal(result.response.status, expected, `${pathname}: ${result.text}`);
  assertions++;
  return result;
}
const incoming = () => [
  ...filesUnder(path.join(runtime.fixture, 'uploads')).filter(file => file.endsWith('.upload')),
  ...filesUnder(path.join(runtime.fixture, 'recovery', 'incoming')),
];

const sockets = new Set();
let uploadId = 0;
const events = () => fs.existsSync(runtime.eventsPath) ? fs.readFileSync(runtime.eventsPath, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
const observed = (id, event) => events().filter(row => row.id === id && row.event === event);
async function waitFor(check, message, milliseconds = 3_000) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) { if (check()) return; await pause(10); }
  assert.fail(message);
}
function recordCounts() {
  const db = new DatabaseSync(path.join(runtime.fixture, 'data/mcc.sqlite'), { readOnly: true });
  try {
    return Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
      .filter(row => /note|attachment|document|inspection|component|facility_item|recovery_package/.test(row.name))
      .map(row => { assert.match(row.name, /^[a-z_0-9]+$/); return [row.name, db.prepare(`SELECT COUNT(*) AS count FROM ${row.name}`).get().count]; }));
  } finally { db.close(); }
}
async function partial(pathname, cookie, field = 'documents', finish = false, completedFirst = false) {
  const id = `upload-${++uploadId}`, boundary = `mcc-${id}`;
  const prefix = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${id}.pdf"\r\nContent-Type: application/pdf\r\n\r\n`);
  const secondPrefix = Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${id}-partial.pdf"\r\nContent-Type: application/pdf\r\n\r\n`);
  const body = finish ? Buffer.concat([prefix, pdf, Buffer.from(`\r\n--${boundary}--\r\n`)]) : Buffer.concat([prefix,
    ...(completedFirst ? [pdf, secondPrefix] : []), Buffer.from('%PDF-1.4\n'), Buffer.alloc(4096, 65)]);
  const socket = net.createConnection({ host: '127.0.0.1', port: Number(new URL(runtime.base).port) });
  sockets.add(socket);
  let response = '';
  socket.on('data', chunk => response += chunk);
  socket.on('error', () => {});
  socket.once('close', () => sockets.delete(socket));
  socket.setTimeout(10_000, () => socket.destroy());
  await new Promise(resolve => socket.once('connect', resolve));
  socket.write(`POST ${pathname} HTTP/1.1\r\nHost: localhost\r\nCookie: ${cookie}\r\nX-Security-Upload-Id: ${id}\r\nContent-Type: multipart/form-data; boundary=${boundary}\r\nContent-Length: ${finish ? body.length : 1048576}\r\nConnection: close\r\n\r\n`);
  socket.write(body);
  await waitFor(() => observed(id, 'request').length === 1, 'Actual backend must receive the request.');
  return { id, socket, response: () => response };
}
async function entered(upload, kind, count = 1) {
  await waitFor(() => observed(upload.id, 'storage-data').filter(row => row.kind === kind).length === count, 'Upload must reach real storage and consume file bytes before cancellation.');
  if (kind === 'disk') await waitFor(() => observed(upload.id, 'storage-path').filter(row => fs.existsSync(row.path) && fs.statSync(row.path).size > 0).length === count, 'Disk upload must create nonempty staging files.');
}
async function cancel(upload, kind, count = 1) {
  upload.socket.destroy();
  await waitFor(() => observed(upload.id, 'response-close').length === 1, 'Backend must observe the disconnected response.');
  if (kind) await waitFor(() => observed(upload.id, 'storage-close').length === count, 'Parser file streams must close.');
  if (kind === 'disk') {
    await waitFor(() => observed(upload.id, 'disk-handle-close').length === count, 'Disk write handles must close.');
    await waitFor(() => observed(upload.id, 'storage-path').every(row => !fs.existsSync(row.path)), 'Aborted staging files must be removed.');
  }
}

try {
  const cookie = await owner(runtime.base);
  let result = await checked('/api/machine-library/assets', { method: 'POST', cookie,
    body: { assetNumber: 'SEC-MACHINE', assetName: 'Security Test Press', brand: 'MCC', status: 'active' } }, 201);
  const machine = result.data.asset.id;
  result = await checked(`/api/machine-library/assets/${machine}/document-folders`, { method: 'POST', cookie, body: { name: 'Security files' } }, 201);
  const machineDocuments = `/api/machine-library/assets/${machine}/document-folders/${result.data.folder.id}/documents`;
  result = await checked('/api/equipment-library/assets', { method: 'POST', cookie,
    body: { assetNumber: 'SEC-EQUIPMENT', equipmentName: 'Security Test Dryer', category: 'Dryer', status: 'active' } }, 201);
  const equipment = result.data.asset.id;
  result = await checked(`/api/equipment-library/assets/${equipment}/document-folders`, { method: 'POST', cookie, body: { name: 'Security files' } }, 201);
  const equipmentDocuments = `/api/equipment-library/assets/${equipment}/document-folders/${result.data.folder.id}/documents`;
  result = await checked('/api/facility-info/areas', { method: 'POST', cookie, body: { name: 'Security test area' } }, 201);
  const area = result.data.area.id;
  result = await checked(`/api/facility-info/areas/${area}/folders`, { method: 'POST', cookie, body: { name: 'Security files' } }, 201);
  const facilityFiles = `/api/facility-info/areas/${area}/folders/${result.data.folder.id}/items`;
  const notes = `/api/machine-library/assets/${machine}/notes`;
  const routes = [
    ['CSV import', 'POST', '/api/vendors/import'],
    ['PM workbook', 'POST', '/api/pm-excel/preview'],
    ['PM work order', 'POST', '/api/machine-library/preventive-maintenance/99999/complete'],
    ['Branding logo', 'POST', '/api/settings/branding/logo'],
    ['Component image', 'PUT', `/api/machine-library/assets/${machine}/component-images/barrel`],
    ['Inspection record', 'POST', `/api/machine-library/assets/${machine}/inspection-records`],
    ['Note attachment', 'POST', notes],
    ['Machine documents', 'POST', machineDocuments],
    ['Equipment documents', 'POST', equipmentDocuments],
    ['Portable recovery', 'POST', '/api/backup/recovery/import'],
    ['Facility files', 'POST', facilityFiles],
  ];
  for (const [label, method, pathname] of routes) {
    result = await checked(pathname, { method, cookie, body: form([['body[nested]', 'invalid']]) }, 400);
    if(label === 'Portable recovery') assert.equal(result.data.error, 'Portable backup upload was rejected.');
    else assert.match(result.data.error, /nesting|nested/i, label);
    assert.equal(result.response.headers.get('content-type')?.includes('application/json'), true, label);
    assert.equal(result.text.includes('node_modules'), false, 'Parser errors must not expose server stack paths.');
    await healthy(runtime);
  }
  for (const fields of [
    [['items[4294967294]', 'a'], ['items[key]', 'b']],
    [['items[99999999999999999999999]', 'a']],
    [['items[0]', 'a'], ['items', 'b']],
    [['items[]', 'a']],
    [['body[a][b][c]', 'a']],
  ]) {
    await checked(notes, { method: 'POST', cookie, body: form(fields) }, 400);
    await healthy(runtime);
  }
  const malformed = Buffer.from('--malformed\r\nContent-Disposition: form-data; name="body"\r\n\r\ntruncated');
  for (const [label, method, pathname] of routes) {
    result = await checked(pathname, { method, cookie, body: malformed,
      headers: { 'Content-Type': 'multipart/form-data; boundary=malformed' } }, 400);
    assert.equal(result.response.headers.get('content-type')?.includes('application/json'), true, label);
    assert.equal(result.text.includes('node_modules'), false);
    await healthy(runtime);
  }

  await checked(notes, { method: 'POST', body: form([['items[4294967294]', 'a']]) }, 401);
  result = await checked('/api/users', { method: 'POST', cookie,
    body: { fullName: 'Security viewer', email: 'viewer@example.test', role: 'Maintenance Tech 1', temporaryPassword: password } }, 201);
  const viewer = result.data.user.id;
  const viewerLogin = await checked('/api/auth/login', { method: 'POST', body: { email: 'viewer@example.test', password } }, 200);
  await checked(notes, { method: 'POST', cookie: viewerLogin.cookie, body: form([['items[4294967294]', 'a']]) }, 403);
  // View-only work-log access reaches the protected parser before ownership checks.
  await checked('/api/machine-library/asset-notes/99999/updates', {
    method: 'POST', cookie: viewerLogin.cookie, body: form([['items[4294967294]', 'a']]),
  }, 400);
  const db = new DatabaseSync(path.join(runtime.fixture, 'data/mcc.sqlite'));
  db.prepare('UPDATE sessions SET expires_at=? WHERE user_id=?').run('2000-01-01T00:00:00Z', viewer);
  await checked(notes, { method: 'POST', cookie: viewerLogin.cookie, body: form([['body[nested]', 'a']]) }, 401);
  const activeViewer = await checked('/api/auth/login', { method: 'POST', body: { email: 'viewer@example.test', password } }, 200);
  db.prepare('UPDATE users SET disabled=1 WHERE id=?').run(viewer);
  await checked(notes, { method: 'POST', cookie: activeViewer.cookie, body: form([['body[nested]', 'a']]) }, 403);
  db.close();

  const attachment = { field: 'attachments', name: 'persisted.pdf', bytes: pdf };
  result = await checked(notes, { method: 'POST', cookie,
    body: form([['title', 'Security persistence'], ['noteDate', '2026-10-09'], ['body', 'Valid flat form'], ['warning', 'true']], [attachment]) }, 201);
  const note = result.data.note;
  assert.equal(note.attachments.length, 1);
  let download = await fetch(`${runtime.base}${note.attachments[0].downloadUrl}`, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(3_000) });
  assert.equal(download.status, 200);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), pdf);
  // MCC intentionally deduplicates equal file contents, so use distinct PDFs.
  const allowed = Array.from({ length: 10 }, (_, i) => ({ ...attachment, name: `allowed-${i}.pdf`,
    bytes: Buffer.from(`%PDF-1.4\nsecurity fixture ${i}\n%%EOF\n`) }));
  result = await checked(notes, { method: 'POST', cookie,
    body: form([['title', 'Allowed attachment count'], ['noteDate', '2026-10-09'], ['body', 'All ten files persist'], ['warning', 'true']], allowed) }, 201);
  assert.equal(result.data.note.attachments.length, 10, 'The existing attachment count remains permitted.');
  const many = Array.from({ length: 11 }, (_, i) => ({ ...attachment, name: `too-many-${i}.pdf` }));
  await checked(notes, { method: 'POST', cookie, body: form([], many) }, 400);
  await checked(notes, { method: 'POST', cookie,
    body: form([], [{ ...attachment, field: 'unexpectedFile' }]) }, 400);
  await checked('/api/settings/branding/logo', { method: 'POST', cookie,
    body: form([], [{ field: 'file', name: 'oversized.png', type: 'image/png', bytes: Buffer.alloc(1024 * 1024 + 1) }]) }, 413);
  await checked(machineDocuments, { method: 'POST', cookie,
    body: form([], [{ field: 'documents', name: 'oversized.pdf', bytes: Buffer.alloc(1024 * 1024 + 1) }]) }, 400);
  assert.deepEqual(incoming(), []);
  result = await checked('/api/backup/create', { method: 'POST', cookie, body: { category: 'master' } }, 201);
  const backup = result.data.backup;
  const archiveResponse = await fetch(`${runtime.base}/api/backup/portable/${backup.id}/download`, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(3_000) });
  assert.equal(archiveResponse.status, 200);
  const archive = Buffer.from(await archiveResponse.arrayBuffer());
  let imported = false;
  async function legitimate(pathname, field) {
    const recovery = field === 'file';
    const metadata = pathname === notes ? [['title', `Recovery ${uploadId}`], ['noteDate', '2026-10-09'], ['body', 'Valid upload after abort'], ['warning', 'true']] : [];
    const result = await checked(pathname, { method: 'POST', cookie, body: form(metadata, [{ field,
      name: recovery ? backup.portableArchiveFilename : `recovery-${uploadId}.pdf`, bytes: recovery ? archive : pdf,
      type: recovery ? 'application/zip' : 'application/pdf' }]) }, recovery && imported ? 200 : 201);
    if (recovery) imported = true;
    else if (pathname === notes) assert.equal(result.data.note.attachments.length, 1);
    return result;
  }
  for (const [pathname, field, kind] of [[machineDocuments, 'documents', 'disk'], [equipmentDocuments, 'documents', 'disk'],
    [facilityFiles, 'files', 'disk'], ['/api/backup/recovery/import', 'file', 'disk'], [notes, 'attachments', 'memory']]) {
    for (let i = 0; i < 4; i++) {
      const before = recordCounts();
      const upload = await partial(pathname, cookie, field);
      await entered(upload, kind);
      await cancel(upload, kind);
      await waitFor(() => incoming().length === 0, 'Aborted uploads must not accumulate staging files.');
      assert.deepEqual(recordCounts(), before, 'Partial uploads must not create any application records.');
      await healthy(runtime);
      await legitimate(pathname, field);
    }
  }
  for (const [pathname, field, kind] of [[machineDocuments, 'documents', 'disk'], [equipmentDocuments, 'documents', 'disk'],
    [facilityFiles, 'files', 'disk'], [notes, 'attachments', 'memory']]) {
    const before = recordCounts();
    const upload = await partial(pathname, cookie, field, false, true);
    await entered(upload, kind, 2);
    await waitFor(() => observed(upload.id, 'storage-complete').length >= 1, 'First file must finish storage before the second file is aborted.');
    await cancel(upload, kind, 2);
    await waitFor(() => incoming().length === 0, 'Both completed and partial staging files must be removed.');
    assert.deepEqual(recordCounts(), before, 'Multi-file aborts must not persist partial records.');
    await healthy(runtime); await legitimate(pathname, field);
  }
  result = await checked(machineDocuments, { method: 'POST', cookie,
    body: form([['description', 'Flat metadata']], [{ field: 'documents', name: '50%-{safe}.pdf', bytes: pdf }]) }, 201);
  download = await fetch(`${runtime.base}${result.data.documents[0].downloadUrl}`, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(3_000) });
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), pdf);
  const boundaryPdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(1024 * 1024 - 16, 32), Buffer.from('\n%%EOF\n')]);
  assert.equal(boundaryPdf.length, 1024 * 1024);
  result = await checked(machineDocuments, { method: 'POST', cookie,
    body: form([], [{ field: 'documents', name: 'exact-limit.pdf', bytes: boundaryPdf }]) }, 201);
  download = await fetch(`${runtime.base}${result.data.documents[0].downloadUrl}`, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(3_000) });
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), boundaryPdf, 'Exact permitted byte limit survives storage.');
  await healthy(runtime);
  console.log(`Upload security passed: all 11 configurations, ${assertions} HTTP assertions; isolated unsafe .env; 24 observed active aborts including completed-first/partial-second files with file/handle/record cleanup and valid recovery.`);
} finally { for (const socket of sockets) socket.destroy(); await runtime.close(); }
