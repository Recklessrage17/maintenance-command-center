import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixtureRoot = path.join(repoRoot,'tmp',`machine-setup-type-${Date.now()}-${process.pid}`);
const dataDir = path.join(fixtureRoot,'data');
const uploadsDir = path.join(fixtureRoot,'uploads');
const backupsDir = path.join(fixtureRoot,'backups');
const dbPath = path.join(dataDir,'mcc.sqlite');
const password = 'Mcc-Setup-Type-Test!9a';
let server;

async function freePort() {
  return new Promise((resolve,reject) => {
    const probe = net.createServer();
    probe.once('error',reject);
    probe.listen(0,'127.0.0.1',() => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(error => error ? reject(error) : resolve(port));
    });
  });
}
async function startServer(port) {
  const child = spawn(process.execPath,['backend/dist/server/index.js'],{
    cwd: repoRoot,
    env: {...process.env,PORT:String(port),NODE_ENV:'test',SESSION_SECRET:'machine-setup-type-api-test',MCC_DATA_DIR:dataDir,MCC_UPLOADS_DIR:uploadsDir,MCC_BACKUPS_DIR:backupsDir},
    stdio: ['ignore','pipe','pipe'],
  });
  let output = '';
  child.stdout.on('data',chunk => { output += chunk; });
  child.stderr.on('data',chunk => { output += chunk; });
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Backend exited early.\n${output}`);
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return {child,base};
    } catch {}
    await new Promise(resolve => setTimeout(resolve,100));
  }
  child.kill();
  throw new Error(`Backend did not become healthy.\n${output}`);
}
async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await Promise.race([new Promise(resolve => child.once('exit',resolve)),new Promise(resolve => setTimeout(resolve,3000))]);
}
async function jsonRequest(base,pathname,{method='GET',cookie='',body}={}) {
  const response = await fetch(`${base}${pathname}`,{
    method,
    headers: {...(cookie ? {Cookie:cookie} : {}),...(body !== undefined && !(body instanceof FormData) ? {'Content-Type':'application/json'} : {})},
    body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
  });
  assert.match(response.headers.get('content-type') || '',/application\/json/);
  const data = await response.json();
  return {response,data,cookie:response.headers.get('set-cookie')?.split(';')[0] || ''};
}
async function login(base) {
  const result = await jsonRequest(base,'/api/auth/login',{method:'POST',body:{email:'setup-owner@example.com',password}});
  assert.equal(result.response.status,200);
  return result.cookie;
}
function assetBody(assetNumber,extra={}) {
  return {assetNumber,assetName:`${assetNumber} machine`,brand:'MCC',powerType:'Hydraulic',status:'active',...extra};
}

async function run() {
  fs.mkdirSync(fixtureRoot,{recursive:true});
  const port = await freePort();
  let runtime = await startServer(port);
  server = runtime.child;
  let base = runtime.base;
  let result = await jsonRequest(base,'/api/auth/setup-first-admin',{method:'POST',body:{fullName:'Setup Owner',email:'setup-owner@example.com',password,confirmPassword:password}});
  assert.equal(result.response.status,200);
  let cookie = await login(base);

  result = await jsonRequest(base,'/api/machine-library/assets',{method:'POST',cookie,body:assetBody('SETUP-STANDARD',{powerType:'Servo Hydraulic'})});
  assert.equal(result.response.status,201);
  assert.equal(result.data.asset.setupType,'Standard Injection');
  assert.equal(result.data.asset.powerType,'Servo Hydraulic');
  const standardId = result.data.asset.id;

  result = await jsonRequest(base,'/api/machine-library/assets',{method:'POST',cookie,body:assetBody('SETUP-2K',{hasDoubleShotInjection:true})});
  assert.equal(result.response.status,201);
  assert.equal(result.data.asset.setupType,'Two-Shot / 2K Injection');
  const twoShotId = result.data.asset.id;

  result = await jsonRequest(base,'/api/machine-library/assets',{method:'POST',cookie,body:assetBody('SETUP-PLUNGER',{hasPlungerInjection:true})});
  assert.equal(result.response.status,201);
  assert.equal(result.data.asset.setupType,'Plunger Injection');
  const plungerId = result.data.asset.id;

  result = await jsonRequest(base,'/api/machine-library/assets',{method:'POST',cookie,body:assetBody('SETUP-CUSTOM',{setupType:'Robotic Co-Injection Cell'})});
  assert.equal(result.response.status,201);
  assert.equal(result.data.asset.setupType,'Robotic Co-Injection Cell');
  const customId = result.data.asset.id;

  result = await jsonRequest(base,'/api/machine-library/assets',{method:'POST',cookie,body:assetBody('SETUP-INVALID',{setupType:'Other / Custom'})});
  assert.equal(result.response.status,400);
  assert.match(result.data.error,/Custom Setup Type is required/i);

  result = await jsonRequest(base,`/api/machine-library/assets/${customId}`,{method:'PUT',cookie,body:assetBody('SETUP-CUSTOM',{setupType:'Liquid Silicone Rubber (LSR)'})});
  assert.equal(result.response.status,200);
  assert.equal(result.data.asset.setupType,'Liquid Silicone Rubber (LSR)');
  result = await jsonRequest(base,`/api/machine-library/assets/${customId}/history`,{cookie});
  assert.equal(result.response.status,200);
  assert.ok(result.data.records.some(record => record.action === 'machine_asset_updated'));
  const historyDatabase = new DatabaseSync(dbPath,{readOnly:true});
  const historyRow = historyDatabase.prepare("SELECT old_value_json,new_value_json FROM history_logs WHERE action='machine_asset_updated' AND entity_id=? ORDER BY id DESC LIMIT 1").get(String(customId));
  historyDatabase.close();
  assert.equal(JSON.parse(historyRow.old_value_json).setupType,'Robotic Co-Injection Cell');
  assert.equal(JSON.parse(historyRow.new_value_json).setupType,'Liquid Silicone Rubber (LSR)');

  let response = await fetch(`${base}/api/machine-library/export/template`,{headers:{Cookie:cookie}});
  assert.equal(response.status,200);
  assert.match(await response.text(),/(^|,)Setup Type(,|\r?\n)/);

  const csv = [
    'Asset Number,Shot Size (oz),Tonnage,Power Type,Brand,Barrel/Screw Diameter,Machine Year,Model,Serial Number,Setup Type',
    '91,12,300,Electric,MCC,42 mm,2024,T-91,SN-91,Vertical Insert Molding',
  ].join('\r\n');
  const form = new FormData();
  form.append('file',new Blob([csv],{type:'text/csv'}),'setup-types.csv');
  form.append('importMode','add_new_only');
  response = await fetch(`${base}/api/machine-library/import`,{method:'POST',headers:{Cookie:cookie},body:form});
  assert.equal(response.status,200);
  assert.equal((await response.json()).addedCount,1);
  result = await jsonRequest(base,'/api/machine-library/assets',{cookie});
  assert.equal(result.data.assets.find(asset => asset.assetNumber === 'Press 91')?.setupType,'Vertical Insert Molding');

  result = await jsonRequest(base,'/api/backup/create',{method:'POST',cookie,body:{category:'master'}});
  assert.equal(result.response.status,201);
  const backupId = result.data.backup.id;
  result = await jsonRequest(base,`/api/machine-library/assets/${customId}`,{method:'PUT',cookie,body:assetBody('SETUP-CUSTOM',{setupType:'Micro Injection Molding'})});
  assert.equal(result.data.asset.setupType,'Micro Injection Molding');
  result = await jsonRequest(base,'/api/backup/restore',{method:'POST',cookie,body:{category:'master',backupId,confirmation:'RESTORE MCC'}});
  assert.equal(result.response.status,200);
  result = await jsonRequest(base,'/api/machine-library/assets',{cookie});
  assert.equal(result.data.assets.find(asset => asset.id === customId)?.setupType,'Liquid Silicone Rubber (LSR)');

  await stopServer(server);
  server = undefined;
  const database = new DatabaseSync(dbPath);
  database.prepare("UPDATE machine_assets SET setup_type='' WHERE id IN (?,?,?)").run(standardId,twoShotId,plungerId);
  database.close();
  runtime = await startServer(port);
  server = runtime.child;
  base = runtime.base;
  cookie = await login(base);
  result = await jsonRequest(base,'/api/machine-library/assets',{cookie});
  assert.equal(result.data.assets.find(asset => asset.id === standardId)?.setupType,'Standard Injection');
  assert.equal(result.data.assets.find(asset => asset.id === twoShotId)?.setupType,'Two-Shot / 2K Injection');
  assert.equal(result.data.assets.find(asset => asset.id === plungerId)?.setupType,'Plunger Injection');
  assert.equal(result.data.assets.find(asset => asset.id === customId)?.setupType,'Liquid Silicone Rubber (LSR)');

  console.log('Machine Setup Type API/migration tests passed with isolated data, import/template, history, backup/restore, and legacy defaults.');
}

try {
  await run();
} finally {
  await stopServer(server);
  const resolved = path.resolve(fixtureRoot);
  const allowedRoot = path.resolve(repoRoot,'tmp');
  if (resolved.startsWith(`${allowedRoot}${path.sep}`) && fs.existsSync(resolved)) fs.rmSync(resolved,{recursive:true,force:true});
}
