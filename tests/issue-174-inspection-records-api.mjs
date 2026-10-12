import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { PDFDocument } from '../backend/node_modules/pdf-lib/cjs/index.js';
import { filesUnder, owner, password, request } from './helpers/security-process.mjs';
import { inspectionFixture } from './helpers/inspection-records-fixture.mjs';

const runtime = await inspectionFixture('issue-174-api');
const { base } = runtime;
let checks = 0;
async function checked(url, options, status) {
  const result = await request(base, url, options);
  assert.equal(result.response.status, status, `${url}: ${JSON.stringify(result.data)}`);
  checks++;
  return result;
}
const db = new DatabaseSync(path.join(runtime.fixture, 'data/mcc.sqlite'));
function snapshot() {
  return {
    records: db.prepare('SELECT * FROM machine_inspection_records ORDER BY id').all(),
    audit: db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count,
    history: db.prepare('SELECT COUNT(*) AS count FROM history_logs').get().count,
    files: filesUnder(path.join(runtime.uploadsDir, 'machine-inspection-records'))
      .map(file => [path.basename(file), fs.readFileSync(file).toString('base64')]),
  };
}
try {
  const ownerCookie = await owner(base);
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]).drawText('Disposable Issue 174 inspection');
  const bytes = Buffer.from(await pdf.save());
  const assets = [];
  for (const assetNumber of ['PROTECT-174', 'OTHER-174']) {
    const result = await checked('/api/machine-library/assets', { method: 'POST', cookie: ownerCookie,
      body: { assetNumber, assetName: 'Disposable Inspection Press', brand: 'MCC', status: 'active' } }, 201);
    assets.push(result.data.asset.id);
  }
  async function upload(assetId, name, recordDate = '2025-06-01', cookie = ownerCookie) {
    const body = new FormData();
    body.append('recordDate', recordDate);
    body.append('file', new Blob([bytes], { type: 'application/pdf' }), name);
    return (await checked(`/api/machine-library/assets/${assetId}/inspection-records`,
      { method: 'POST', cookie, body }, 201)).data.record;
  }
  const kept = await upload(assets[0], 'Keep.pdf');
  const other = await upload(assets[1], 'Other-machine.pdf', '2024-06-01');
  const accounts = [];
  for (const [index, role] of ['Maintenance Tech 1', 'Maintenance Tech 2', 'Maintenance Tech 3', 'Manager', 'Admin'].entries()) {
    const email = `role-${index}@example.test`;
    const created = await checked('/api/users', { method: 'POST', cookie: ownerCookie,
      body: { fullName: `Inspection ${role}`, email, role, temporaryPassword: password } }, 201);
    const login = await checked('/api/auth/login', { method: 'POST', body: { email, password } }, 200);
    accounts.push({ role, id: created.data.user.id, cookie: login.cookie });
  }
  accounts.push({ role: 'Owner Admin', cookie: ownerCookie });
  for (const account of accounts) {
    const result = await checked('/api/auth/status', { cookie: account.cookie }, 200);
    const allowed = !['Maintenance Tech 1', 'Maintenance Tech 2'].includes(account.role);
    assert.equal(result.data.user.effectivePermissions.includes('machine.documents_manage'), allowed);
    const before = snapshot();
    const list = await checked(`/api/machine-library/assets/${assets[0]}/inspection-records`, { cookie: account.cookie }, 200);
    assert.ok(list.data.records.some(record => record.serverId === kept.serverId));
    const file = await fetch(`${base}${kept.contentUrl}`, { headers: { Cookie: account.cookie } });
    assert.equal(file.status, 200);
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes);
    assert.deepEqual(snapshot(), before, 'Reading a year must preserve rows, file bytes, and history.');
    if (!allowed) {
      const denied = await checked(`/api/machine-library/inspection-records/${kept.serverId}`,
        { method: 'DELETE', cookie: account.cookie }, 403);
      assert.equal(denied.data.code, 'PERMISSION_REQUIRED');
      assert.deepEqual(snapshot(), before, `${account.role} cannot delete or create a success event.`);
    } else {
      const target = await upload(assets[0], `${account.role.replaceAll(' ', '-')}.pdf`, '2025-07-01', account.cookie);
      await checked(`/api/machine-library/inspection-records/${target.serverId}`, { method: 'DELETE', cookie: account.cookie }, 200);
      const after = snapshot();
      assert.deepEqual(after.records, before.records, 'Individual deletion removes only its explicit record.');
      assert.deepEqual(after.files, before.files, 'All other files survive individual deletion.');
      await checked(`/api/machine-library/inspection-records/${target.serverId}`, { method: 'DELETE', cookie: account.cookie }, 404);
      assert.deepEqual(snapshot(), after, 'Repeated deletion has no additional effect.');
    }
  }
  for (const cookie of ['', 'mcc_session=invalid']) {
    const before = snapshot();
    await checked(`/api/machine-library/inspection-records/${kept.serverId}`, { method: 'DELETE', cookie }, 401);
    assert.deepEqual(snapshot(), before);
  }
  const expired = accounts.find(account => account.role === 'Maintenance Tech 3');
  db.prepare('UPDATE sessions SET expires_at=? WHERE user_id=?').run('2000-01-01T00:00:00.000Z', expired.id);
  let before = snapshot();
  await checked(`/api/machine-library/inspection-records/${kept.serverId}`, { method: 'DELETE', cookie: expired.cookie }, 401);
  assert.deepEqual(snapshot(), before);
  const disabled = accounts.find(account => account.role === 'Manager');
  db.prepare('UPDATE users SET disabled=1 WHERE id=?').run(disabled.id);
  before = snapshot();
  await checked(`/api/machine-library/inspection-records/${kept.serverId}`, { method: 'DELETE', cookie: disabled.cookie }, 403);
  assert.deepEqual(snapshot(), before);
  const global = await checked('/api/machine-library/inspection-records', { cookie: ownerCookie }, 200);
  assert.deepEqual(global.data.records.map(record => record.serverId).sort((a, b) => a - b),
    [kept.serverId, other.serverId].sort((a, b) => a - b));
  const changed = await checked(`/api/machine-library/inspection-records/${kept.serverId}`,
    { method: 'PATCH', cookie: ownerCookie, body: { recordDate: '2023-06-01' } }, 200);
  assert.equal(changed.data.record.year, '2023');
  const download = await fetch(`${base}${changed.data.record.downloadUrl}`, { headers: { Cookie: ownerCookie } });
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-disposition'), /attachment;.*Keep\.pdf/);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
  const combined = await fetch(`${base}/api/machine-library/measurement-records/combined-pdf`, {
    method: 'POST', headers: { Cookie: ownerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Inspection protection regression', fileName: 'Protected-inspections.pdf',
      records: [{ ...changed.data.record, dataUrl: `data:application/pdf;base64,${bytes.toString('base64')}` }] }),
  });
  assert.equal(combined.status, 200);
  assert.equal((await PDFDocument.load(await combined.arrayBuffer())).getPageCount(), 1);
  assert.equal(snapshot().records.length, 2, 'Printing preserves both machines\' records.');
  console.log(`Issue #174 API passed: ${checks} HTTP status checks, six account variants, unchanged deletion authorization, denied-request invariance, isolated uploads/downloads/date grouping/PDF generation.`);
} finally {
  db.close();
  await runtime.close();
}
