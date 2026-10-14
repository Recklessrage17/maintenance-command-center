import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {backendFixture,owner,password,request,healthy,filesUnder} from './helpers/security-process.mjs';
import {seedPmReportHistory} from './helpers/pm-history-report-data.mjs';
import {createPmHistoryReportBuilder} from '../backend/dist/server/pmHistoryReport.js';
const {PDFDocument,PDFArray,PDFName}=createRequire(import.meta.url)('../backend/node_modules/pdf-lib');
const runtime=await backendFixture('pm-history-report-api');const {base}=runtime;const db=new DatabaseSync(path.join(runtime.fixture,'data/mcc.sqlite'));
let checks=0;
async function check(url,options,status){const result=await request(base,url,options);assert.equal(result.response.status,status,`${url}: ${result.text}`);checks++;return result;}
async function parsed(bytes){const pdf=await PDFDocument.load(bytes);let text='';for(const page of pdf.getPages()){const contents=page.node.Contents();const streams=contents instanceof PDFArray?contents.asArray():[contents];for(const reference of streams){const stream=pdf.context.lookup(reference);const data=stream.dict.get(PDFName.of('Filter'))?.toString()==='/FlateDecode'?zlib.inflateSync(stream.contents):stream.contents;for(const match of Buffer.from(data).toString().matchAll(/<([0-9A-F]+)> Tj/gi))text+=Buffer.from(match[1],'hex').toString('latin1')+'\n';}}return{pdf,text};}
try{
 const cookie=await owner(base),assets={};
 for(const library of ['machine','equipment'])for(const other of [false,true]){const key=`${library}${other?'Other':''}`;assets[key]=(await check(`/api/${library}-library/assets`,{method:'POST',cookie,body:{assetNumber:`${library==='machine'?'Press':'Dryer'}-${other?'Other':'7001'}`,assetName:'Synthetic Report Press',equipmentName:'Synthetic Report Dryer',brand:'MCC QA',manufacturer:'MCC QA',model:'Report-300',serialNumber:'QA-ONLY',status:'active',category:'Dryer'}},201)).data.asset;}
 const groups=await seedPmReportHistory(db,runtime,assets);
 const accounts=[];for(const [index,role]of ['Maintenance Tech 1','Maintenance Tech 2','Maintenance Tech 3','Manager','Admin'].entries()){const email=`pm-report-${index}@example.test`;const user=(await check('/api/users',{method:'POST',cookie,body:{email,fullName:`Synthetic ${role}`,role,temporaryPassword:password}},201)).data.user;db.prepare('UPDATE users SET force_password_change=0 WHERE id=?').run(user.id);accounts.push({id:user.id,role,cookie:(await check('/api/auth/login',{method:'POST',body:{email,password}},200)).cookie});}
 const tables=['machine_assets','equipment_assets','pm_tasks','pm_history','pm_history_participants','pm_work_order_attachments','pm_asset_meters','pm_meter_history','history_logs','audit_log'];
 const before=Object.fromEntries(tables.map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()]));const files=filesUnder(runtime.env.MCC_PM_WORK_ORDER_DIR).map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]);
 const endpoint=library=>`/api/${library}-library/assets/${assets[library].id}/preventive-maintenance/history/report.pdf`;
 async function report(library,ids,{taskId,cookie:actor=cookie,status=200}={}){const response=await fetch(base+endpoint(library),{method:'POST',headers:{Cookie:actor,'Content-Type':'application/json'},body:JSON.stringify({completionIds:ids,...taskId===undefined?{}:{pmTaskId:taskId}}),signal:AbortSignal.timeout(15000)});assert.equal(response.status,status,response.headers.get('Content-Type')?.startsWith('application/pdf')?'Unexpected PDF response status':await response.clone().text());checks++;if(status!==200)return;assert.equal(response.headers.get('Content-Type'),'application/pdf');assert.equal(response.headers.get('X-MCC-PM-Report-Count'),String(ids.length));const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.length,Number(response.headers.get('Content-Length')));return{...await parsed(bytes),bytes,response};}
 for(const library of ['machine','equipment']){
  const group=groups[library],records=group.records;
  const month=await report(library,[records[3].id,records[2].id],{taskId:group.tasks[0]});assert.ok(month.pdf.getPageCount()>1,'Long notes span multiple pages.');assert.match(month.response.headers.get('Content-Disposition'),/October-2026\.pdf/);
  assert.match(month.text,/PM Completion History/);assert.match(month.text,new RegExp(`${library==='machine'?'Machine':'Equipment'} Library`));for(const value of ['Report-300','QA-ONLY','Lubrication QA','Recorded Second Technician','400 hours','600 hours','Check seals before next run.','LONG_NOTE_BEGIN','LONG_NOTE_END','[U+3B1]'])assert.ok(month.text.includes(value),value);
  const rendered=month.text.replace(/\s+/g,' ');for(let line=1;line<=90;line++)assert.ok(rendered.includes(`Maintenance line ${line}: lubrication verified; measurements retained; follow-up review logged.`),`Full note line ${line} is retained.`);
  assert.ok(month.text.indexOf(`Completion #${records[2].id} |`) < month.text.indexOf(`Completion #${records[3].id} |`),'Same-date records ordered by immutable ID.');assert.match(month.text,new RegExp(`${library}-original.pdf \\(available\\)`));assert.match(month.text,new RegExp(`${library}-missing.pdf \\(missing\\)`));assert.ok(!month.text.includes(records[0].marker));
  const dates=await report(library,[records[1].id,records[0].id]);assert.match(dates.response.headers.get('Content-Disposition'),/Selected-Dates\.pdf/);assert.match(dates.text,/Not required - machine not scheduled \/ not running/);assert.match(dates.text,/No PDF attached/);assert.ok(dates.text.includes(records[0].marker));assert.ok(!dates.text.includes(records[2].marker));
  const all=await report(library,[records[4].id,records[2].id]);assert.ok(all.text.includes('Safety QA'));assert.ok(all.text.includes('Lubrication QA'));assert.ok(all.text.includes('504 cycles'));assert.ok(all.text.includes(`Completion #${records[4].id} |`));
  for(const account of accounts)await report(library,[records[0].id],{cookie:account.cookie});
  for(const body of [{completionIds:[]},{completionIds:['1']},{completionIds:[null]},{completionIds:[0]},{completionIds:[1.5]},{completionIds:[records[0].id,records[0].id]},{completionIds:records[0].id},{completionIds:[records[0].id],pmTaskId:'1'}])await check(endpoint(library),{method:'POST',cookie,body},400);
  await report(library,Array.from({length:201},(_,i)=>i+1),{status:413});
  await report(library,[group.foreign],{status:404});await report(library,[groups[library==='machine'?'equipment':'machine'].records[0].id],{status:404});await report(library,[records[0].id,group.foreign],{status:404});await report(library,[999999],{status:404});
  await report(library,[records[4].id],{taskId:group.tasks[0],status:404});await report(library,[records[0].id],{taskId:group.foreignTask,status:404});
  for(const actor of ['', 'mcc_session=invalid'])await report(library,[records[0].id],{cookie:actor,status:401});
  await check(endpoint(library).replace(`/assets/${assets[library].id}/`,'/assets/99999/'),{method:'POST',cookie,body:{completionIds:[records[0].id]}},404);
 }
 const oversized=await fetch(base+endpoint('machine'),{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({completionIds:[groups.machine.records[0].id],padding:'x'.repeat(9000)})});assert.equal(oversized.status,413);checks++;
 const badJson=await fetch(base+endpoint('machine'),{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:'{'});assert.equal(badJson.status,400);checks++;
 const account=accounts[0],record=groups.machine.records[0];db.prepare("UPDATE sessions SET expires_at='2000-01-01T00:00:00.000Z' WHERE user_id=?").run(account.id);await report('machine',[record.id],{cookie:account.cookie,status:401});
 db.prepare("UPDATE users SET role='Unknown role' WHERE id=?").run(accounts[2].id);await report('machine',[record.id],{cookie:accounts[2].cookie,status:403});db.prepare("UPDATE users SET role='Maintenance Tech 3' WHERE id=?").run(accounts[2].id);
 db.prepare('UPDATE users SET disabled=1 WHERE id=?').run(accounts[1].id);await report('equipment',[groups.equipment.records[0].id],{cookie:accounts[1].cookie,status:403});
 for(const table of tables)assert.deepEqual(db.prepare(`SELECT * FROM ${table} ORDER BY id`).all(),before[table],`${table} remains unchanged by reporting.`);
 for(const [file,hash]of files)assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),hash);
 // Exercise both bounds without retaining fixture changes.
 const row=groups.machine.records[0],notes=db.prepare('SELECT completion_notes FROM pm_history WHERE id=?').get(row.id).completion_notes;
 try{db.prepare('UPDATE pm_history SET completion_notes=? WHERE id=?').run('x'.repeat(1024*1024+1),row.id);await report('machine',[row.id],{status:413});db.prepare('UPDATE pm_history SET completion_notes=? WHERE id=?').run('x'.repeat(800000),row.id);await report('machine',[row.id],{status:413});}finally{db.prepare('UPDATE pm_history SET completion_notes=? WHERE id=?').run(notes,row.id);}
 db.prepare('UPDATE pm_tasks SET deleted=1 WHERE id=?').run(groups.machine.tasks[1]);const preserved=await report('machine',[groups.machine.records[4].id]);assert.match(preserved.text,/Safety QA/);db.prepare('UPDATE pm_tasks SET deleted=0 WHERE id=?').run(groups.machine.tasks[1]);
 const example=await report('machine',[groups.machine.records[2].id,groups.machine.records[3].id]);const output=path.resolve('output/pdf');fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'MCC_PM_History_Press-7001_October-2026.pdf'),example.bytes);
 const view=(await check(`/api/machine-library/assets/${assets.machine.id}/preventive-maintenance/history`,{cookie},200)).data.history[0];const builder=createPmHistoryReportBuilder();const input={library:'machine',asset:{number:'Synthetic',name:'Concurrency',model:'',serial:''},generatedAt:'2026-10-15T00:00:00Z',records:[{...view,intervalType:'hourly'}]};const concurrent=await Promise.allSettled([builder(input),builder(input),builder(input)]);assert.equal(concurrent.filter(result=>result.status==='fulfilled').length,2);assert.equal(concurrent[2].reason.status,429,'Third simultaneous generation is rejected.');await builder(input);
 await healthy(runtime);assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');console.log(`PASS PM history report: ${checks} HTTP/PDF checks; Machine/Equipment/task scope, five viewing roles, sessions, exact IDs, mixed years/dates, duplicate dates, long/multipage notes, missing originals, deterministic ordering, body/text/page bounds and preserved rows/files.`);
}finally{db.close();await runtime.close();}
