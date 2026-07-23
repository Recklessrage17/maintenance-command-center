import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import pdfLib from '../backend/node_modules/pdf-lib/cjs/index.js';

const { PDFDocument } = pdfLib;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixtureRoot = path.join(repoRoot,'tmp',`machine-asset-spec-api-${Date.now()}-${process.pid}`);
const dataDir = path.join(fixtureRoot,'data');
const uploadsDir = path.join(fixtureRoot,'uploads');
const backupsDir = path.join(fixtureRoot,'backups');
const databasePath = path.join(dataDir,'mcc.sqlite');
const password = 'Mcc-Asset-Spec-Test!9a';
let server;

async function freePort() {
  return new Promise((resolve,reject)=>{
    const probe = net.createServer();
    probe.once('error',reject);
    probe.listen(0,'127.0.0.1',()=>{
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(error=>error ? reject(error) : resolve(port));
    });
  });
}

async function startServer(port) {
  const child = spawn(process.execPath,['backend/dist/server/index.js'],{
    cwd:repoRoot,
    env:{...process.env,PORT:String(port),NODE_ENV:'test',SESSION_SECRET:'machine-asset-specification-api-test',MCC_DATA_DIR:dataDir,MCC_UPLOADS_DIR:uploadsDir,MCC_BACKUPS_DIR:backupsDir},
    stdio:['ignore','pipe','pipe'],
  });
  let output = '';
  child.stdout.on('data',chunk=>{output += chunk;});
  child.stderr.on('data',chunk=>{output += chunk;});
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Backend exited early.\n${output}`);
    try { if ((await fetch(`${base}/api/health`)).ok) return {child,base}; } catch {}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  child.kill();
  throw new Error(`Backend did not become healthy.\n${output}`);
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,3000))]);
}

async function jsonRequest(base,pathname,{method='GET',cookie='',body,headers={}}={}) {
  const response = await fetch(`${base}${pathname}`,{
    method,
    headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},
    body:body===undefined?undefined:JSON.stringify(body),
  });
  const data = await response.json();
  return {response,data,cookie:response.headers.get('set-cookie')?.split(';')[0] || ''};
}

function assetBody(assetNumber,expanded=false) {
  return {
    assetNumber,
    assetName:expanded?'Expanded Two-Shot Plunger Press':'Primary Production Press',
    brand:'Toyo',
    model:'TM-450',
    serialNumber:`SN-${assetNumber}`,
    machineYear:'2018',
    machineType:'Injection Molding Machine',
    powerType:'Electric',
    setupType:expanded?'Multi-Component / Multi-Material':'Standard Injection',
    shotSizeOz:18.5,
    tonnage:450,
    barrelDiameter:'55 mm',
    location:'Molding Cell 4',
    status:'active',
    voltageValue:'480',
    voltageType:'AC',
    fullLoadAmp:'320',
    machineLength:'24 ft',
    machineWidth:'9 ft',
    machineHeight:'10 ft',
    fullDieHeightLength:'52 in',
    screwType:'General Purpose',
    screwTipType:'Sliding Ring',
    screwInstalledDate:'2024-02-29',
    screwTipInstalledDate:'2025-01-15',
    screwLength:'108 in',
    screwConditionStatus:'used',
    barrelInstalledDate:'2023-06-10',
    barrelEndCapInstalledDate:'2025-02-20',
    barrelLength:'112 in',
    barrelConditionStatus:'used',
    hasDoubleShotInjection:expanded,
    screw2Type:'Barrier',
    screw2TipType:'Three Piece',
    screw2InstalledDate:'2024-03-01',
    screw2TipInstalledDate:'2025-03-01',
    screw2Length:'76 in',
    screw2ConditionStatus:'used',
    barrel2Diameter:'32 mm',
    barrel2InstalledDate:'2024-03-01',
    barrel2EndCapInstalledDate:'2025-03-01',
    barrel2Length:'80 in',
    barrel2ConditionStatus:'used',
    hasPlungerInjection:expanded,
    plungerType:'Direct Acting',
    plungerInstalledDate:'2024-04-01',
    plungerLength:'34 in',
    plungerDiameter:'22 mm',
    plungerConditionStatus:'used',
    plungerBarrelType:'Cylinder',
    plungerBarrelInstalledDate:'2024-04-01',
    plungerBarrelEndCapInstalledDate:'2025-04-01',
    plungerBarrelLength:'38 in',
    plungerBarrelDiameter:'25 mm',
    plungerBarrelConditionStatus:'used',
  };
}

async function addPm(base,cookie,assetId,index) {
  const result = await jsonRequest(base,`/api/machine-library/assets/${assetId}/preventive-maintenance`,{
    method:'POST',
    cookie,
    headers:{'Idempotency-Key':`asset-spec-pm-${assetId}-${index}`},
    body:{title:`Preventive maintenance schedule ${index + 1}`,intervalType:index % 2 ? 'monthly' : 'annual',intervalValue:index % 2 ? 3 : 1,lastCompletedDate:'2026-01-15',scheduleStatus:'active',notes:''},
  });
  assert.equal(result.response.status,201);
}

function databaseSnapshot() {
  const database = new DatabaseSync(databasePath,{readOnly:true});
  const assets = database.prepare('SELECT * FROM machine_assets ORDER BY id').all();
  const auditCount = database.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count;
  const historyCount = database.prepare('SELECT COUNT(*) AS count FROM history_logs').get().count;
  database.close();
  return {assets:JSON.stringify(assets),auditCount,historyCount};
}

async function pdfRequest(base,cookie,assetId,download=false) {
  const response = await fetch(`${base}/api/machine-library/assets/${assetId}/specification.pdf${download?'?download=true':''}`,{headers:{Cookie:cookie}});
  assert.equal(response.status,200);
  assert.match(response.headers.get('content-type') || '',/^application\/pdf/);
  assert.match(response.headers.get('cache-control') || '',/no-store/);
  const bytes = Buffer.from(await response.arrayBuffer());
  const document = await PDFDocument.load(bytes);
  return {response,bytes,pageCount:document.getPageCount()};
}

async function run() {
  fs.mkdirSync(fixtureRoot,{recursive:true});
  const port = await freePort();
  const runtime = await startServer(port);
  server = runtime.child;
  const {base} = runtime;
  let result = await jsonRequest(base,'/api/auth/setup-first-admin',{method:'POST',body:{fullName:'Asset Spec Owner',email:'asset-spec@example.com',password,confirmPassword:password}});
  assert.equal(result.response.status,200);
  result = await jsonRequest(base,'/api/auth/login',{method:'POST',body:{email:'asset-spec@example.com',password}});
  assert.equal(result.response.status,200);
  const cookie = result.cookie;

  result = await jsonRequest(base,'/api/machine-library/assets',{method:'POST',cookie,body:assetBody('45')});
  assert.equal(result.response.status,201);
  const standardId = result.data.asset.id;
  await addPm(base,cookie,standardId,0);
  await addPm(base,cookie,standardId,1);

  result = await jsonRequest(base,'/api/machine-library/assets',{method:'POST',cookie,body:assetBody('EXP-2K',true)});
  assert.equal(result.response.status,201);
  const expandedId = result.data.asset.id;
  for (let index = 0; index < 6; index += 1) await addPm(base,cookie,expandedId,index);

  const before = databaseSnapshot();
  let pdf = await pdfRequest(base,cookie,standardId);
  assert.equal(pdf.pageCount,1,'Standard machine specification must be exactly one Letter page.');
  assert.match(pdf.response.headers.get('content-disposition') || '',/^inline; filename="Press45_Machine_Asset_Specification_\d{4}-\d{2}-\d{2}\.pdf"$/);
  assert.ok(pdf.bytes.length > 2000);
  if (process.env.MCC_KEEP_ASSET_SPEC_ARTIFACTS === '1') {
    const output = path.join(repoRoot,'output','pdf');
    fs.mkdirSync(output,{recursive:true});
    fs.writeFileSync(path.join(output,'Press45_Machine_Asset_Specification_2026-07-23_server.pdf'),pdf.bytes);
  }

  pdf = await pdfRequest(base,cookie,standardId,true);
  assert.equal(pdf.pageCount,1,'Downloaded standard machine specification must remain exactly one page.');
  assert.match(pdf.response.headers.get('content-disposition') || '',/^attachment; filename="Press45_Machine_Asset_Specification_\d{4}-\d{2}-\d{2}\.pdf"$/);

  pdf = await pdfRequest(base,cookie,expandedId);
  assert.equal(pdf.pageCount,2,'Configured secondary/plunger specification with six active PM schedules must be exactly two pages.');

  const after = databaseSnapshot();
  assert.deepEqual(after,before,'Printing and downloading the specification must not mutate assets, audit, or history.');
  console.log('Machine Asset Specification API tests passed with isolated data: standard inline=1 page, standard download=1 page, expanded configured asset=2 pages, and zero audit/history/data mutations.');
}

try {
  await run();
} finally {
  await stopServer(server);
  const resolved = path.resolve(fixtureRoot);
  const allowedRoot = path.resolve(repoRoot,'tmp');
  if (resolved.startsWith(`${allowedRoot}${path.sep}`) && fs.existsSync(resolved)) fs.rmSync(resolved,{recursive:true,force:true});
}
