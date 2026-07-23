import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import pdfLib from '../backend/node_modules/pdf-lib/cjs/index.js';
import ExcelJS from '../backend/node_modules/exceljs/excel.js';

const {PDFDocument}=pdfLib;
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixture=path.join(root,'tmp',`equipment-library-api-${Date.now()}-${process.pid}`);
const dataDir=path.join(fixture,'data');
const uploadsDir=path.join(fixture,'uploads');
const backupsDir=path.join(fixture,'backups');
const password='Equipment-Library-Test!9';
let server;
async function freePort(){return new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(0,'127.0.0.1',()=>{const address=probe.address();probe.close(error=>error?reject(error):resolve(address.port));});});}
async function start(port){const child=spawn(process.execPath,['backend/dist/server/index.js'],{cwd:root,env:{...process.env,PORT:String(port),NODE_ENV:'test',SESSION_SECRET:'equipment-library-api-test',MCC_DATA_DIR:dataDir,MCC_UPLOADS_DIR:uploadsDir,MCC_BACKUPS_DIR:backupsDir},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);const base=`http://127.0.0.1:${port}`;for(let attempt=0;attempt<100;attempt+=1){if(child.exitCode!==null)throw new Error(`Backend exited.\n${output}`);try{if((await fetch(`${base}/api/health`)).ok)return {child,base};}catch{}await new Promise(resolve=>setTimeout(resolve,100));}throw new Error(`Backend did not start.\n${output}`);}
async function request(base,pathname,{method='GET',cookie='',body,headers={}}={}){const response=await fetch(`${base}${pathname}`,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined||body instanceof FormData?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});const data=await response.json().catch(()=>({}));return {response,data,cookie:response.headers.get('set-cookie')?.split(';')[0]||''};}
async function login(base,email){const result=await request(base,'/api/auth/login',{method:'POST',body:{email,password}});assert.equal(result.response.status,200);return result.cookie;}
const equipment=(assetNumber='EQ-100',extra={})=>({assetNumber,equipmentName:'Central Resin Dryer',category:'Dryer',equipmentType:'Desiccant Dryer',manufacturer:'Matsui',model:'MJ5-i',serialNumber:`SN-${assetNumber}`,equipmentYear:'2020',location:'Molding Bay 2',department:'Molding',status:'active',criticality:'high',powerType:'Electric',voltage:'480 VAC',phase:'3 phase',amperage:'42 A',airRequirement:'90 PSI',waterRequirement:'Not required',capacityRating:'500 lb hopper',dimensions:'48 x 36 x 84 in',weight:'825 lb',specificationNotes:'Keep desiccant filters clean.',...extra});

async function run(){
  fs.mkdirSync(fixture,{recursive:true});const runtime=await start(await freePort());server=runtime.child;const {base}=runtime;
  let result=await request(base,'/api/auth/setup-first-admin',{method:'POST',body:{fullName:'Equipment Owner',email:'owner@example.com',password,confirmPassword:password}});assert.equal(result.response.status,200);
  const ownerCookie=await login(base,'owner@example.com');
  result=await request(base,'/api/users',{method:'POST',cookie:ownerCookie,body:{fullName:'Tier Two Viewer',email:'viewer@example.com',role:'Maintenance Tech 2',temporaryPassword:password}});assert.equal(result.response.status,201);
  const viewerCookie=await login(base,'viewer@example.com');

  result=await request(base,'/api/equipment-library/assets',{method:'POST',cookie:viewerCookie,body:equipment('DENIED')});assert.equal(result.response.status,403,'Tier 2 create must return 403.');
  result=await request(base,'/api/equipment-library/assets',{method:'POST',cookie:ownerCookie,body:equipment()});assert.equal(result.response.status,201);const assetId=result.data.asset.id;
  assert.equal(result.data.asset.category,'Dryer');
  result=await request(base,'/api/equipment-library/assets',{method:'POST',cookie:ownerCookie,body:equipment('EQ-CUSTOM',{category:'Other / Custom',customCategory:''})});assert.equal(result.response.status,400);
  result=await request(base,'/api/equipment-library/assets',{method:'POST',cookie:ownerCookie,body:equipment('EQ-CUSTOM',{category:'Other / Custom',customCategory:'Laser Marker'})});assert.equal(result.response.status,201);assert.equal(result.data.asset.category,'Laser Marker');

  result=await request(base,`/api/equipment-library/assets/${assetId}`,{method:'PUT',cookie:ownerCookie,body:equipment('EQ-100',{capacityRating:'650 lb hopper'})});assert.equal(result.response.status,200);assert.equal(result.data.asset.capacityRating,'650 lb hopper');
  result=await request(base,`/api/equipment-library/assets/${assetId}/disable`,{method:'POST',cookie:ownerCookie,body:{reasonNote:'Seasonal shutdown'}});assert.equal(result.response.status,200);assert.equal(result.data.asset.status,'disabled');
  result=await request(base,`/api/equipment-library/assets/${assetId}/enable`,{method:'POST',cookie:ownerCookie,body:{reasonNote:'Production restart'}});assert.equal(result.response.status,200);

  result=await request(base,`/api/equipment-library/assets/${assetId}/preventive-maintenance`,{method:'POST',cookie:ownerCookie,headers:{'Idempotency-Key':'equipment-pm-create-100'},body:{title:'Clean dryer filters',instructions:'Lock out and clean both filters.',intervalType:'monthly',intervalValue:1,lastCompletedDate:'2026-07-01',scheduleStatus:'active',notes:'Use approved air nozzle.'}});assert.equal(result.response.status,201);const pmId=result.data.task.id;
  result=await request(base,'/api/dashboard/preventive-maintenance-due',{cookie:ownerCookie});assert.equal(result.response.status,200);const equipmentAlert=result.data.alerts.find(alert=>alert.id===pmId);assert.equal(equipmentAlert.assetLibrary,'equipment');assert.equal(equipmentAlert.assetNumber,'EQ-100');
  result=await request(base,`/api/equipment-library/preventive-maintenance/${pmId}/complete`,{method:'POST',cookie:ownerCookie,body:{completionDate:'2026-07-23',completionNotes:'Filters cleaned.'}});assert.equal(result.response.status,200);
  result=await request(base,`/api/equipment-library/preventive-maintenance/${pmId}/history`,{cookie:ownerCookie});assert.equal(result.response.status,200);assert.equal(result.data.history.length,1);
  result=await request(base,`/api/machine-library/preventive-maintenance/${pmId}/history`,{cookie:ownerCookie});assert.equal(result.response.status,404,'Equipment PM IDs must not resolve through Machine Library.');

  result=await request(base,`/api/equipment-library/assets/${assetId}/document-folders`,{method:'POST',cookie:ownerCookie,body:{name:'Manuals',description:'OEM manuals'}});assert.equal(result.response.status,201);const folderId=result.data.folder.id;
  const documentBody=new FormData();documentBody.append('documents',new Blob([Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF')],{type:'application/pdf'}),'Dryer Manual.pdf');documentBody.append('description','OEM manual');
  result=await request(base,`/api/equipment-library/assets/${assetId}/document-folders/${folderId}/documents`,{method:'POST',cookie:ownerCookie,body:documentBody});assert.equal(result.response.status,201);const documentId=result.data.documents[0].id;
  const duplicateBody=new FormData();duplicateBody.append('documents',new Blob([Buffer.from('%PDF-1.4\n%%EOF')],{type:'application/pdf'}),'Dryer Manual.pdf');
  result=await request(base,`/api/equipment-library/assets/${assetId}/document-folders/${folderId}/documents`,{method:'POST',cookie:ownerCookie,body:duplicateBody});assert.equal(result.response.status,409);assert.equal(result.data.code,'DOCUMENT_DUPLICATE');
  const opened=await fetch(`${base}/api/equipment-library/assets/${assetId}/documents/${documentId}/open`,{headers:{Cookie:ownerCookie}});assert.equal(opened.status,200);assert.match(opened.headers.get('content-type')||'',/application\/pdf/);
  result=await request(base,`/api/equipment-library/assets/${assetId}/documents/${documentId}`,{method:'PATCH',cookie:viewerCookie,body:{displayFilename:'Denied.pdf'}});assert.equal(result.response.status,403,'Tier 2 document writes must return 403.');
  const archive=await fetch(`${base}/api/equipment-library/assets/${assetId}/documents/export`,{headers:{Cookie:ownerCookie}});assert.equal(archive.status,200);assert.match(archive.headers.get('content-type')||'',/zip/);

  const noteBody=new FormData();noteBody.append('title','Dryer observation');noteBody.append('noteDate','2026-07-23');noteBody.append('body','Inspected airflow and confirmed normal operation.');
  result=await request(base,`/api/equipment-library/assets/${assetId}/notes`,{method:'POST',cookie:ownerCookie,body:noteBody});assert.equal(result.response.status,201);const note=result.data.note;assert.match(note.pdfFilename,/Maintenance_Note/);
  const notePdf=await fetch(`${base}${note.pdfUrl}`,{headers:{Cookie:ownerCookie}});assert.equal(notePdf.status,200);assert.match(notePdf.headers.get('content-type')||'',/application\/pdf/);

  const specification=await fetch(`${base}/api/equipment-library/assets/${assetId}/specification.pdf`,{headers:{Cookie:ownerCookie}});assert.equal(specification.status,200);const specificationBytes=Buffer.from(await specification.arrayBuffer());const pdf=await PDFDocument.load(specificationBytes);assert.equal(pdf.getPageCount(),1,'Normal Equipment specification must be exactly one page.');assert.match(specification.headers.get('content-disposition')||'',/Equipment_Specification_\d{4}-\d{2}-\d{2}\.pdf/);

  const csv='Equipment Asset Number,Equipment Name,Category\r\nEQ-CSV,Portable Chiller,Chiller\r\n';
  const importBody=new FormData();importBody.append('file',new Blob([csv],{type:'text/csv'}),'equipment.csv');importBody.append('importMode','add_new_only');
  result=await request(base,'/api/equipment-library/import',{method:'POST',cookie:ownerCookie,body:importBody});assert.equal(result.response.status,200);assert.equal(result.data.addedCount,1);
  const workbook=new ExcelJS.Workbook();const worksheet=workbook.addWorksheet('Equipment');worksheet.addRow(['Equipment Asset Number','Equipment Name','Category']);worksheet.addRow(['EQ-XLSX','Cooling Tower Pump','Cooling Tower']);const xlsxBuffer=Buffer.from(await workbook.xlsx.writeBuffer());const xlsxBody=new FormData();xlsxBody.append('file',new Blob([xlsxBuffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),'equipment.xlsx');xlsxBody.append('importMode','add_new_only');
  result=await request(base,'/api/equipment-library/import',{method:'POST',cookie:ownerCookie,body:xlsxBody});assert.equal(result.response.status,200);assert.equal(result.data.addedCount,1);
  const exported=await fetch(`${base}/api/equipment-library/export`,{headers:{Cookie:ownerCookie}});assert.equal(exported.status,200);assert.match(await exported.text(),/EQ-CSV/);
  const template=await fetch(`${base}/api/equipment-library/export/template`,{headers:{Cookie:ownerCookie}});assert.equal(template.status,200);assert.match(await template.text(),/Equipment Asset Number,Equipment Name,Category/);

  result=await request(base,`/api/equipment-library/assets/${assetId}/history`,{cookie:ownerCookie});assert.equal(result.response.status,200);assert.ok(result.data.records.some(record=>record.action==='equipment_created'));assert.ok(result.data.records.some(record=>record.action==='document_uploaded'));assert.ok(result.data.records.some(record=>record.action==='note_created'));
  let backupResult;
  for(let attempt=0;attempt<30;attempt+=1){backupResult=await request(base,'/api/backup/create',{method:'POST',cookie:ownerCookie,body:{category:'master'}});if(backupResult.response.status===201)break;await new Promise(resolve=>setTimeout(resolve,200));}
  assert.equal(backupResult.response.status,201,'An isolated master backup must be created.');const backupId=backupResult.data.backup.id;
  result=await request(base,`/api/equipment-library/assets/${assetId}`,{method:'DELETE',cookie:ownerCookie,body:{reasonNote:'Backup restore verification'}});assert.equal(result.response.status,200);
  result=await request(base,'/api/backup/restore',{method:'POST',cookie:ownerCookie,body:{category:'master',backupId,confirmation:'RESTORE MCC'}});assert.equal(result.response.status,200,'Equipment backup restore must succeed.');
  result=await request(base,'/api/equipment-library/assets',{cookie:ownerCookie});assert.equal(result.response.status,200);assert.ok(result.data.assets.some(item=>item.id===assetId&&item.assetNumber==='EQ-100'),'Restore must recreate Equipment metadata.');
  result=await request(base,`/api/equipment-library/assets/${assetId}/preventive-maintenance`,{cookie:ownerCookie});assert.equal(result.data.length,1,'Restore must recreate Equipment PM schedules.');
  result=await request(base,`/api/equipment-library/assets/${assetId}/documents`,{cookie:ownerCookie});assert.equal(result.data.documents.length,1,'Restore must recreate Equipment documents.');
  result=await request(base,`/api/equipment-library/assets/${assetId}/notes`,{cookie:ownerCookie});assert.equal(result.data.notes.length,1,'Restore must recreate Equipment notes.');
  const database=new DatabaseSync(path.join(dataDir,'mcc.sqlite'),{readOnly:true});assert.equal(database.prepare("SELECT asset_library FROM pm_tasks WHERE id=?").get(pmId).asset_library,'equipment');assert.equal(database.prepare('SELECT COUNT(*) AS count FROM equipment_documents').get().count,1);database.close();
  console.log('Equipment Library API tests passed: 60 assertion sites across metadata/custom category, Tier 2 write 403s, shared PM/dashboard/history, documents/ZIP, notes/PDF, CSV/XLSX import/export, audit, full backup/restore, and normal specification=1 page.');
}
try{await run();}finally{if(server&&server.exitCode===null){server.kill();await Promise.race([new Promise(resolve=>server.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,3000))]);}const resolved=path.resolve(fixture);const allowed=path.resolve(root,'tmp');if(resolved.startsWith(`${allowed}${path.sep}`)&&fs.existsSync(resolved))fs.rmSync(resolved,{recursive:true,force:true});}
