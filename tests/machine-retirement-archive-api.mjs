import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import ExcelJS from '../backend/node_modules/exceljs/excel.js';
import {backendFixture,owner,password,request,healthy} from './helpers/security-process.mjs';
import {digest,insert,seedMachineHistory,timestamp} from './helpers/machine-archive-data.mjs';
import {migrateMachineLifecycle,changeMachineLifecycle} from '../backend/dist/server/machineLifecycle.js';

const legacy=new DatabaseSync(':memory:');
legacy.exec("CREATE TABLE machine_assets(id INTEGER PRIMARY KEY,asset_number TEXT,asset_name TEXT,deleted INTEGER DEFAULT 0,updated_at TEXT,updated_by_user_id INTEGER);INSERT INTO machine_assets(id,asset_number) VALUES(1,'OLD'),(2,'REPLACEMENT');");
migrateMachineLifecycle(legacy);migrateMachineLifecycle(legacy);
assert.equal(legacy.prepare('SELECT lifecycle_status FROM machine_assets WHERE id=1').get().lifecycle_status,'active');
assert.equal(legacy.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
assert.throws(()=>changeMachineLifecycle(legacy,1,{id:1,role:'Manager',full_name:'Manager'},{lifecycleStatus:'archived',expectedRevision:0,retirementReason:'retired'},()=>{throw Error('Audit failed');}),/Audit failed/);
assert.equal(legacy.prepare('SELECT lifecycle_revision FROM machine_assets WHERE id=1').get().lifecycle_revision,0,'Audit failure rolls back lifecycle.');legacy.close();

const runtime=await backendFixture('machine-archive-api');
const {base}=runtime;
let db=new DatabaseSync(path.join(runtime.fixture,'data/mcc.sqlite'));
let checks=0;
async function checked(url,options,status){const result=await request(base,url,options);assert.equal(result.response.status,status,`${url}: ${JSON.stringify(result.data)}`);checks++;return result;}
try{
  const cookie=await owner(base);
  const assets=[];
  for(const assetNumber of ['ARCHIVE-1','REPLACE-2'])assets.push((await checked('/api/machine-library/assets',{method:'POST',cookie,body:{assetNumber,assetName:'Synthetic Press',brand:'MCC',model:'Local',serialNumber:`SYN-${assetNumber}`,status:'active'}},201)).data.asset);
  const [asset,replacement]=assets;
  const data=seedMachineHistory(db,runtime,asset.id,replacement.id);
  const beforeTables=Object.fromEntries(['machine_inspection_records','machine_asset_notes','machine_asset_note_attachments','asset_note_updates','asset_note_update_entries','asset_note_update_attachments','asset_note_labor','asset_note_lifecycle_events','pm_tasks','pm_history','pm_asset_meters','pm_meter_history','pm_work_order_attachments','machine_documents','machine_document_folders','machine_component_images'].map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()]));
  const beforeFiles=data.payloads.map(file=>[file.destination,digest(fs.readFileSync(file.destination))]);
  const accounts=[];
  for(const [i,role] of ['Maintenance Tech 1','Maintenance Tech 2','Maintenance Tech 3','Manager','Admin'].entries()){
    const email=`archive-${i}@example.test`;
    const created=await checked('/api/users',{method:'POST',cookie,body:{fullName:`Archive ${role}`,email,role,temporaryPassword:password}},201);
    db.prepare('UPDATE users SET force_password_change=0 WHERE id=?').run(created.data.user.id);
    const login=await checked('/api/auth/login',{method:'POST',body:{email,password}},200);
    accounts.push({role,id:created.data.user.id,cookie:login.cookie});
  }
  const pathFor=id=>`/api/machine-library/assets/${id}/lifecycle`;
  const retire={lifecycleStatus:'archived',expectedRevision:0,retirementReason:'replaced',retirementNotes:'Replaced in synthetic QA',replacementMachineId:replacement.id};
  for(const account of accounts.filter(item=>item.role.startsWith('Maintenance Tech'))){
    await checked(pathFor(asset.id),{method:'POST',cookie:account.cookie,body:retire},403);

  }
  for(const invalidCookie of ['','mcc_session=invalid']){
    await checked(pathFor(asset.id),{method:'POST',cookie:invalidCookie,body:retire},401);

  }
  const invalidBodies=[{...retire,retirementReason:''},{...retire,retirementReason:['replaced']},{...retire,lifecycleStatus:['archived']},{...retire,retirementReason:'other',retirementNotes:' ',replacementMachineId:null},{...retire,replacementMachineId:asset.id},{...retire,replacementMachineId:999999},{...retire,replacementMachineId:String(replacement.id)},{...retire,retirementNotes:22}];
  for(const body of invalidBodies)await checked(pathFor(asset.id),{method:'POST',cookie,body},400);
  await checked(pathFor(0),{method:'POST',cookie,body:retire},404);
  await checked(pathFor(999999),{method:'POST',cookie,body:retire},404);
  await checked(pathFor(asset.id),{method:'POST',cookie,body:{...retire,expectedRevision:5}},409);
  const manager=accounts.find(item=>item.role==='Manager');
  const archived=(await checked(pathFor(asset.id),{method:'POST',cookie:manager.cookie,body:retire},200)).data.asset;
  assert.equal(archived.id,asset.id);assert.equal(archived.lifecycleRevision,1);assert.equal(archived.replacementMachine.id,replacement.id);assert.equal(archived.status,'active','Operational condition remains independent.');
  await checked(pathFor(asset.id),{method:'POST',cookie,body:retire},409);
  await checked(pathFor(replacement.id),{method:'POST',cookie,body:{...retire,replacementMachineId:asset.id}},400,'Cycles rejected.');
  let result=await checked('/api/machine-library/assets',{cookie},200);assert.ok(!result.data.assets.some(row=>row.id===asset.id));
  result=await checked('/api/machine-library/assets?lifecycle=archived&q=synthetic',{cookie},200);assert.deepEqual(result.data.assets.map(row=>row.id),[asset.id]);
  await checked('/api/machine-library/assets?lifecycle=bad',{cookie},400);
  await checked(`/api/machine-library/assets/${asset.id}`,{cookie:accounts[0].cookie},200);
  await checked(`/api/machine-library/assets/${asset.id}/inspection-records`,{cookie:accounts[0].cookie},200);
  await checked(`/api/machine-library/preventive-maintenance/${data.taskId}/history`,{cookie:accounts[0].cookie},200);
  result=await checked('/api/dashboard/preventive-maintenance-due',{cookie},200);assert.ok(!JSON.stringify(result.data).includes('ARCHIVE-1'));
  await checked(`/api/machine-library/assets/${asset.id}/preventive-maintenance`,{method:'POST',cookie,body:{}},409);
  await checked(`/api/machine-library/preventive-maintenance/${data.taskId}/complete`,{method:'POST',cookie,body:{}},409);
  await checked(`/api/machine-library/assets/${asset.id}/preventive-maintenance/meters/hours`,{method:'PUT',cookie,body:{reading:501}},400);
  await checked(`/api/machine-library/assets/${asset.id}`,{method:'DELETE',cookie,body:{reason:'Old remove action'}},409);
  await checked(`/api/machine-library/assets/${asset.id}`,{method:'PUT',cookie:accounts[2].cookie,body:{...asset,assetNumber:'REACTIVATED'}},409);
  const workbookMachine=(await checked('/api/machine-library/assets',{method:'POST',cookie,body:{assetNumber:'Press 88000',assetName:'Workbook lifecycle QA',brand:'MCC'}},201)).data.asset;
  const workbook=new ExcelJS.Workbook();const tracker=workbook.addWorksheet('Machine Pm Tracker');
  tracker.getRow(4).values=['Press:','88000'];tracker.getRow(5).values=['Interval Type','Interval Cycles','Last Completed Date / Last hourly','Today Date / Hourly','Due Date','Status','Task Description'];tracker.getRow(6).values=['Hourly',500,100,200,null,null,'Synthetic archived PM import'];
  workbook.addWorksheet('PMHistory').getRow(1).values=['AssetNo','Work order #','Task Status','Start Date','End Date','Work Order Type','Perform By:','Interval Type','Task Type','Task Note'];
  const workbookBytes=await workbook.xlsx.writeBuffer();
  async function preview(){const form=new FormData();form.append('file',new Blob([workbookBytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),'lifecycle.xlsx');return checked('/api/pm-excel/preview',{method:'POST',cookie,body:form},200);}
  const activePreview=await preview();assert.equal(activePreview.data.preview.confirmEligibility.canConfirm,true);
  await checked(pathFor(workbookMachine.id),{method:'POST',cookie,body:{lifecycleStatus:'archived',expectedRevision:0,retirementReason:'retired'}},200);
  await checked('/api/pm-excel/confirm',{method:'POST',cookie,headers:{'Idempotency-Key':'lifecycle-stale-preview'},body:{previewToken:activePreview.data.preview.token}},409);
  const archivedPreview=await preview();assert.equal(archivedPreview.data.preview.summary.additions,0);assert.equal(archivedPreview.data.preview.ignoredRows[0].code,'MACHINE_NOT_ACTIVE');assert.match(archivedPreview.data.preview.ignoredRows[0].reason,/Archived/);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM pm_tasks WHERE asset_library='machine' AND asset_id=?").get(workbookMachine.id).count,0,'Stale PM preview cannot schedule an archived machine.');
  const csv=new FormData();csv.append('file',new Blob(['Asset Number,Shot Size (oz),Tonnage,Power Type,Brand,Barrel/Screw Diameter,Machine Year,Model,Serial Number\nARCHIVE-1,12,300,Electric,MCC,40 mm,2020,Local,SYN-ARCHIVE-1\n'],{type:'text/csv'}),'archive.csv');csv.append('importMode','upsert');
  result=await checked('/api/machine-library/import',{method:'POST',cookie,body:csv},200);assert.equal(result.data.updatedCount,0);assert.match(JSON.stringify(result.data),/restore|lifecycle|archived/i);
  const admin=accounts.find(item=>item.role==='Admin');
  result=await checked(pathFor(asset.id),{method:'POST',cookie:admin.cookie,body:{lifecycleStatus:'active',expectedRevision:1,restoreReason:'Recommissioned'}},200);assert.equal(result.data.asset.id,asset.id);assert.equal(result.data.asset.lifecycleRevision,2);assert.ok(result.data.asset.restoredAt);
  await checked(pathFor(asset.id),{method:'POST',cookie,body:{lifecycleStatus:'active',expectedRevision:2,restoreReason:'Repeat'}},409);
  const concurrent=await Promise.all([request(base,pathFor(asset.id),{method:'POST',cookie,body:{...retire,expectedRevision:2,lifecycleStatus:'out_of_service'}}),request(base,pathFor(asset.id),{method:'POST',cookie,body:{...retire,expectedRevision:2}})]);assert.deepEqual(concurrent.map(row=>row.response.status).sort(),[200,409]);
  assert.equal(db.prepare('SELECT lifecycle_revision FROM machine_assets WHERE id=?').get(asset.id).lifecycle_revision,3);
  result=await checked(pathFor(asset.id),{method:'POST',cookie,body:{lifecycleStatus:'out_of_service',expectedRevision:3,retirementReason:'retired',retirementNotes:'Synthetic outage'}},200);
  assert.equal(result.data.asset.lifecycleStatus,'out_of_service');
  result=await checked('/api/machine-library/assets',{cookie},200);assert.ok(result.data.assets.some(row=>row.id===asset.id&&row.pmSummary===null));
  result=await checked('/api/machine-library/assets?lifecycle=archived',{cookie},200);assert.ok(!result.data.assets.some(row=>row.id===asset.id));
  for(const [table,rows] of Object.entries(beforeTables))assert.deepEqual(db.prepare(`SELECT * FROM ${table} ORDER BY id`).all(),rows,`${table} preserved`);
  assert.deepEqual(data.payloads.map(file=>[file.destination,digest(fs.readFileSync(file.destination))]),beforeFiles);
  assert.ok(db.prepare("SELECT * FROM history_logs WHERE action='machine_replacement_changed' AND asset_id=?").get(String(asset.id)));
  db.prepare('UPDATE users SET disabled=1 WHERE id=?').run(manager.id);
  await checked(pathFor(asset.id),{method:'POST',cookie:manager.cookie,body:retire},403);
  db.prepare('UPDATE sessions SET expires_at=? WHERE user_id=?').run('2000-01-01T00:00:00Z',admin.id);
  await checked(pathFor(asset.id),{method:'POST',cookie:admin.cookie,body:retire},401);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  const lifecycleBefore=db.prepare('SELECT * FROM machine_assets WHERE id=?').get(asset.id);
  const backup=await checked('/api/backup/create',{method:'POST',cookie,body:{category:'master'}},201);
  await checked(pathFor(asset.id),{method:'POST',cookie,body:{lifecycleStatus:'active',expectedRevision:4,restoreReason:'Disposable backup check'}},200);
  db.close();
  await checked('/api/backup/restore',{method:'POST',cookie,body:{category:'master',backupId:backup.data.backup.id,confirmation:'RESTORE MCC'}},200);
  db=new DatabaseSync(path.join(runtime.fixture,'data/mcc.sqlite'));
  assert.deepEqual(db.prepare('SELECT * FROM machine_assets WHERE id=?').get(asset.id),lifecycleBefore,'Master restore preserves lifecycle and original identity.');
  for(const file of data.payloads)assert.equal(digest(fs.readFileSync(file.destination)),file.sha256,'Master restore retains original file bytes.');
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  await healthy(runtime);console.log(`PASS machine archive: ${checks} lifecycle API checks, repeat migration, transaction rollback, preserved graph/file hashes, roles, concurrent requests and backup/restore.`);
}finally{try{db.close();}catch{}await runtime.close();}
