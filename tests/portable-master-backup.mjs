import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url);
const ExcelJS=require('../backend/node_modules/exceljs');
const JSZip=require('../backend/node_modules/jszip');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixture=path.join(root,'tmp',`portable-master-backup-${Date.now()}-${process.pid}`);
const externalFixture=path.join(os.tmpdir(),`mcc-portable-external-${Date.now()}-${process.pid}`);
const password='Portable-Backup-Test!9a';
const source={root:path.join(fixture,'source')};
const target={root:path.join(fixture,'target')};
for(const runtime of [source,target]){
  runtime.data=path.join(runtime.root,'data');
  runtime.uploads=path.join(runtime.root,'uploads');
  runtime.backups=path.join(runtime.root,'backups');
  runtime.recovery=path.join(runtime.root,'recovery');
  runtime.pmExcel=path.join(runtime.root,'pm-excel');
  runtime.workOrders=path.join(runtime.root,'pm-work-orders');
}
let server;

function digest(value){return crypto.createHash('sha256').update(value).digest('hex');}
function fileDigest(filename){return digest(fs.readFileSync(filename));}
async function freePort(){return new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(0,'127.0.0.1',()=>{const address=probe.address();probe.close(error=>error?reject(error):resolve(address.port));});});}
async function start(runtime){
  const port=await freePort();
  const child=spawn(process.execPath,['backend/dist/server/index.js'],{cwd:root,env:{...process.env,PORT:String(port),NODE_ENV:'test',SESSION_SECRET:`portable-${path.basename(runtime.root)}`,MCC_DATA_DIR:runtime.data,MCC_UPLOADS_DIR:runtime.uploads,MCC_BACKUPS_DIR:runtime.backups,MCC_RECOVERY_DIR:runtime.recovery,MCC_PM_EXCEL_DIR:runtime.pmExcel,MCC_PM_WORK_ORDER_DIR:runtime.workOrders,MCC_PORTABLE_BACKUP_MAX_MB:'128'},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
  const base=`http://127.0.0.1:${port}`;
  for(let attempt=0;attempt<180;attempt+=1){if(child.exitCode!==null)throw new Error(`Backend exited.\n${output}`);try{if((await fetch(`${base}/api/health`)).ok)return{child,base,output:()=>output};}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
  child.kill();throw new Error(`Backend did not start.\n${output}`);
}
async function stop(child){if(!child||child.exitCode!==null)return;child.kill();await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,4000))]);}
async function request(base,url,{method='GET',cookie='',body,headers={}}={}){
  const multipart=body instanceof FormData;
  const response=await fetch(`${base}${url}`,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body!==undefined&&!multipart?{'Content-Type':'application/json'}:{}),...headers},body:body===undefined?undefined:multipart?body:JSON.stringify(body)});
  const data=await response.json().catch(()=>({}));
  return{response,data,cookie:response.headers.get('set-cookie')?.split(';')[0]??''};
}
async function setupOwner(base,label){const result=await request(base,'/api/auth/setup-first-admin',{method:'POST',body:{fullName:`${label} Owner`,email:`${label.toLowerCase()}-owner@example.com`,password,confirmPassword:password}});assert.equal(result.response.status,200);return login(base,`${label.toLowerCase()}-owner@example.com`);}
async function login(base,email){const result=await request(base,'/api/auth/login',{method:'POST',body:{email,password}});assert.equal(result.response.status,200);return result.cookie;}
async function addUser(base,cookie,{name,email,role}){const result=await request(base,'/api/users',{method:'POST',cookie,body:{fullName:name,email,role,temporaryPassword:password}});assert.equal(result.response.status,201);return result.data.user;}
function sqliteCount(dbPath,table){const database=new DatabaseSync(dbPath,{readOnly:true});try{return Number(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);}finally{database.close();}}
function sqliteQuickCheck(dbPath){const database=new DatabaseSync(dbPath,{readOnly:true});try{return String(database.prepare('PRAGMA quick_check').get().quick_check);}finally{database.close();}}
async function uploadArchive(base,cookie,buffer,name='MCC_Master_Backup_test.zip'){
  const form=new FormData();form.append('file',new Blob([buffer],{type:'application/zip'}),name);
  return request(base,'/api/backup/recovery/import',{method:'POST',cookie,body:form});
}
async function mutateArchive(original,mutator){const zip=await JSZip.loadAsync(original);const rootName=Object.keys(zip.files).find(name=>name.includes('/'))?.split('/')[0];assert.ok(rootName);await mutator(zip,rootName);return Buffer.from(await zip.generateAsync({type:'nodebuffer',platform:'UNIX',compression:'DEFLATE'}));}
function duplicateCentralPath(buffer,from,to){assert.equal(Buffer.byteLength(from),Buffer.byteLength(to));const output=Buffer.from(buffer);for(let offset=0;offset+46<output.length;offset+=1){if(output.readUInt32LE(offset)!==0x02014b50)continue;const length=output.readUInt16LE(offset+28);const name=output.subarray(offset+46,offset+46+length).toString('utf8');if(name===from){output.write(to,offset+46,length,'utf8');return output;}}throw new Error('Central directory source path not found.');}

async function run(){
  fs.mkdirSync(source.uploads,{recursive:true});fs.writeFileSync(path.join(source.uploads,'portable-marker.txt'),'source upload payload');
  fs.mkdirSync(source.workOrders,{recursive:true});fs.writeFileSync(path.join(source.workOrders,'WO-PORTABLE-1.pdf'),'%PDF-1.4\nportable work order\n%%EOF');
  fs.mkdirSync(source.pmExcel,{recursive:true});const pmWorkbook=new ExcelJS.Workbook();pmWorkbook.addWorksheet('PMHistory').addRow(['Date','Work Order']);await pmWorkbook.xlsx.writeFile(path.join(source.pmExcel,'PM_report_latest.xlsx'));
  let runtime=await start(source);server=runtime.child;const sourceBase=runtime.base;const ownerCookie=await setupOwner(sourceBase,'Source');
  await addUser(sourceBase,ownerCookie,{name:'Portable Manager',email:'manager@example.com',role:'Manager'});
  await addUser(sourceBase,ownerCookie,{name:'Portable Tech',email:'tech@example.com',role:'Maintenance Tech 3'});
  const managerCookie=await login(sourceBase,'manager@example.com');const techCookie=await login(sourceBase,'tech@example.com');

  let result=await request(sourceBase,'/api/backup/status',{cookie:managerCookie});assert.equal(result.response.status,200);assert.equal(result.data.permissions.canUsePortableRecovery,true);assert.equal(result.data.permissions.canViewMaster,false);assert.equal(result.data.permissions.canRestoreMaster,false);
  result=await request(sourceBase,'/api/backup/status',{cookie:techCookie});assert.equal(result.data.permissions.canUsePortableRecovery,false);
  result=await request(sourceBase,'/api/backup/create',{method:'POST',cookie:ownerCookie,body:{category:'daily'}});assert.equal(result.response.status,201);assert.equal(result.data.backup.type,'daily_manual');
  result=await request(sourceBase,'/api/backup/create',{method:'POST',cookie:ownerCookie,body:{category:'weekly'}});assert.equal(result.response.status,201);assert.equal(result.data.backup.type,'weekly_manual');

  const externalSuccess=path.join(externalFixture,'removable-success');
  result=await request(sourceBase,'/api/backup/external/test',{method:'POST',cookie:ownerCookie,body:{destination:source.data}});assert.equal(result.response.status,400);assert.match(result.data.error,/cannot overlap/i);
  result=await request(sourceBase,'/api/backup/external',{method:'PUT',cookie:ownerCookie,body:{destination:externalSuccess,enabled:true}});assert.equal(result.response.status,200,result.data.error);assert.equal(result.data.settings.enabled,true);
  result=await request(sourceBase,'/api/backup/create',{method:'POST',cookie:ownerCookie,body:{category:'master'}});assert.equal(result.response.status,201,result.data.error);const backup=result.data.backup;assert.equal(backup.type,'master_manual');assert.equal(backup.portableReady,true);
  const packageDir=path.join(source.backups,'MCC Master back up',backup.id);const manifest=JSON.parse(fs.readFileSync(path.join(packageDir,'manifest.json'),'utf8'));const localDatabase=path.join(packageDir,'database','mcc.sqlite');
  assert.equal(sqliteQuickCheck(localDatabase),'ok');assert.equal(manifest.checksumSha256,fileDigest(localDatabase));assert.equal(manifest.packageVersion,1);assert.equal(manifest.schemaVersion,1);assert.equal(manifest.recordCounts.users,3);
  for(const relative of ['RECOVERY_README.txt','recovery/restore-manifest.json','excel/MCC_Inventory.xlsx','excel/MCC_Vendors.xlsx','excel/MCC_Machine_List.xlsx','excel/MCC_Equipment_List.xlsx','excel/MCC_History.xlsx','excel/PM/PM_report_latest.xlsx','files/uploads/portable-marker.txt','files/pm-work-orders/WO-PORTABLE-1.pdf'])assert.ok(fs.existsSync(path.join(packageDir,...relative.split('/'))),`missing ${relative}`);
  assert.match(fs.readFileSync(path.join(packageDir,'RECOVERY_README.txt'),'utf8'),/Git\/GitHub supplies MCC application code/);assert.ok(Object.keys(manifest.fileChecksums).every(name=>fileDigest(path.join(packageDir,...name.split('/')))===manifest.fileChecksums[name]));
  const inventoryWorkbook=new ExcelJS.Workbook();await inventoryWorkbook.xlsx.readFile(path.join(packageDir,'excel','MCC_Inventory.xlsx'));assert.ok(inventoryWorkbook.worksheets.length>=2);
  const externalArchive=path.join(externalSuccess,backup.portableArchiveFilename);assert.ok(fs.existsSync(externalArchive));const sourceArchiveHash=fileDigest(externalArchive);const archiveBuffer=fs.readFileSync(externalArchive);const archive=await JSZip.loadAsync(archiveBuffer);const archiveRoot=manifest.portableArchive.packageRoot;
  for(const relative of ['manifest.json','RECOVERY_README.txt','database/mcc.sqlite','excel/MCC_History.xlsx','recovery/restore-manifest.json'])assert.ok(archive.file(`${archiveRoot}/${relative}`),`archive missing ${relative}`);
  assert.deepEqual(await archive.file(`${archiveRoot}/database/mcc.sqlite`).async('nodebuffer'),fs.readFileSync(localDatabase));

  let download=await fetch(`${sourceBase}/api/backup/portable/${encodeURIComponent(backup.id)}/download`,{headers:{Cookie:managerCookie}});assert.equal(download.status,200);assert.equal(download.headers.get('content-type'),'application/zip');assert.match(download.headers.get('content-disposition')??'',/MCC_Master_Backup_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(?:_\d+)?\.zip/);assert.deepEqual(Buffer.from(await download.arrayBuffer()),fs.readFileSync(path.join(source.backups,'portable',backup.portableArchiveFilename)));
  download=await fetch(`${sourceBase}/api/backup/portable/${encodeURIComponent(backup.id)}/download`,{headers:{Cookie:techCookie}});assert.equal(download.status,403);
  download=await fetch(`${sourceBase}/api/backup/portable/${encodeURIComponent(backup.id)}/download`,{headers:{Cookie:managerCookie}});assert.equal(download.status,200);const reader=download.body.getReader();await reader.read();await reader.cancel();assert.equal(fileDigest(externalArchive),sourceArchiveHash,'cancelled download must not modify the source backup');
  result=await request(sourceBase,'/api/backup/verify',{method:'POST',cookie:ownerCookie,body:{category:'master',backupId:backup.id}});assert.equal(result.response.status,200);assert.equal(result.data.ok,true);

  const externalFailure=path.join(externalFixture,'removable-failure');result=await request(sourceBase,'/api/backup/external',{method:'PUT',cookie:ownerCookie,body:{destination:externalFailure,enabled:true}});assert.equal(result.response.status,200);fs.rmSync(externalFailure,{recursive:true});fs.writeFileSync(externalFailure,'device unavailable');
  result=await request(sourceBase,'/api/backup/create',{method:'POST',cookie:ownerCookie,body:{category:'master'}});assert.equal(result.response.status,201,'external failure must not invalidate local backup');assert.equal(result.data.status.externalBackup.lastCopyOk,false);assert.equal(result.data.backup.portableReady,true);assert.ok(fs.existsSync(path.join(source.backups,'portable',result.data.backup.portableArchiveFilename)));
  const {validateExternalDestination,copyArchiveToExternal}=await import('../backend/dist/server/portableBackup.js');const spaceProbe=path.join(externalFixture,'space-probe');assert.throws(()=>validateExternalDestination({destination:spaceProbe,forbiddenRoots:[],requiredBytes:Number.MAX_SAFE_INTEGER}),/insufficient free space/i);const vanishedDestination=path.join(externalFixture,'vanished-source');fs.mkdirSync(vanishedDestination,{recursive:true});await assert.rejects(copyArchiveToExternal({archivePath:path.join(externalFixture,'MCC_Master_Backup_2026-08-17_00-00-00.zip'),destination:vanishedDestination}),/ENOENT|no such file/i);assert.equal(fs.readdirSync(vanishedDestination).some(name=>name.endsWith('.partial')),false);
  await stop(server);server=null;

  runtime=await start(target);server=runtime.child;const targetBase=runtime.base;const targetOwner=await setupOwner(targetBase,'Target');
  await addUser(targetBase,targetOwner,{name:'Target Manager',email:'target-manager@example.com',role:'Manager'});await addUser(targetBase,targetOwner,{name:'Target Tech',email:'target-tech@example.com',role:'Maintenance Tech 3'});
  const targetManager=await login(targetBase,'target-manager@example.com');const targetTech=await login(targetBase,'target-tech@example.com');
  result=await uploadArchive(targetBase,targetTech,archiveBuffer,backup.portableArchiveFilename);assert.equal(result.response.status,403,'users below Manager must be rejected before import');

  const traversal=await mutateArchive(archiveBuffer,(zip,rootName)=>zip.file(`${rootName}/../escape.txt`,'escape'));result=await uploadArchive(targetBase,targetManager,traversal,'traversal.zip');assert.equal(result.response.status,400);assert.match(result.data.error,/traversal|unsafe path/i);assert.equal(fs.existsSync(path.join(target.root,'escape.txt')),false);
  const absolute=await mutateArchive(archiveBuffer,zip=>zip.file('C:/escape.txt','escape'));result=await uploadArchive(targetBase,targetManager,absolute,'absolute.zip');assert.equal(result.response.status,400);assert.match(result.data.error,/absolute path|unsupported package root/i);
  const symlink=await mutateArchive(archiveBuffer,(zip,rootName)=>zip.file(`${rootName}/files/uploads/link`,'../../escape',{unixPermissions:0o120777}));result=await uploadArchive(targetBase,targetManager,symlink,'symlink.zip');assert.equal(result.response.status,400);assert.match(result.data.error,/symbolic link|unsupported link/i);
  const duplicateSeed=await mutateArchive(archiveBuffer,(zip,rootName)=>{zip.file(`${rootName}/files/uploads/duplicate-a.txt`,'a');zip.file(`${rootName}/files/uploads/duplicate-b.txt`,'b');});const duplicate=duplicateCentralPath(duplicateSeed,`${manifest.portableArchive.packageRoot}/files/uploads/duplicate-b.txt`,`${manifest.portableArchive.packageRoot}/files/uploads/duplicate-a.txt`);result=await uploadArchive(targetBase,targetManager,duplicate,'duplicate.zip');assert.equal(result.response.status,400);assert.match(result.data.error,/duplicate conflicting path/i);
  result=await uploadArchive(targetBase,targetManager,Buffer.from('not a zip'),'corrupt.zip');assert.equal(result.response.status,400);assert.match(result.data.error,/corrupt|central directory/i);
  const badChecksum=await mutateArchive(archiveBuffer,(zip,rootName)=>zip.file(`${rootName}/RECOVERY_README.txt`,'tampered'));result=await uploadArchive(targetBase,targetManager,badChecksum,'bad-checksum.zip');assert.equal(result.response.status,400);assert.match(result.data.error,/checksum mismatch/i);
  const badSchema=await mutateArchive(archiveBuffer,async(zip,rootName)=>{const entry=zip.file(`${rootName}/manifest.json`);const data=JSON.parse(await entry.async('string'));data.schemaVersion=999;zip.file(`${rootName}/manifest.json`,JSON.stringify(data));});result=await uploadArchive(targetBase,targetManager,badSchema,'bad-schema.zip');assert.equal(result.response.status,400);assert.match(result.data.error,/schema version is incompatible/i);
  const missingPayload=await mutateArchive(archiveBuffer,(zip,rootName)=>zip.remove(`${rootName}/excel/MCC_Vendors.xlsx`));result=await uploadArchive(targetBase,targetManager,missingPayload,'missing-payload.zip');assert.equal(result.response.status,400);assert.match(result.data.error,/incomplete|missing/i);
  const corruptSqlite=await mutateArchive(archiveBuffer,async(zip,rootName)=>{const dbName=`${rootName}/database/mcc.sqlite`;const broken=Buffer.from(await zip.file(dbName).async('nodebuffer'));broken.fill(0,0,16);zip.file(dbName,broken);const manifestName=`${rootName}/manifest.json`;const data=JSON.parse(await zip.file(manifestName).async('string'));data.checksumSha256=digest(broken);data.fileChecksums['database/mcc.sqlite']=digest(broken);zip.file(manifestName,JSON.stringify(data));});result=await uploadArchive(targetBase,targetManager,corruptSqlite,'corrupt-sqlite.zip');assert.equal(result.response.status,400);assert.match(result.data.error,/SQLite|database/i);
  assert.deepEqual(fs.readdirSync(path.join(target.recovery,'incoming')),[],'failed imports must clean incoming files');

  result=await uploadArchive(targetBase,targetManager,archiveBuffer,backup.portableArchiveFilename);assert.equal(result.response.status,201,result.data.error);assert.equal(result.data.backup.safeToDisconnect,true);assert.match(result.data.message,/may now be disconnected/i);assert.equal(fileDigest(externalArchive),sourceArchiveHash,'import must never modify the source archive');
  result=await request(targetBase,'/api/backup/recovery',{cookie:targetManager});assert.equal(result.response.status,200);assert.equal(result.data.backups.length,1);const importedId=result.data.backups[0].id;
  await addUser(targetBase,targetOwner,{name:'Target Only',email:'target-only@example.com',role:'Maintenance Tech 1'});fs.writeFileSync(path.join(target.uploads,'target-only.txt'),'must disappear after valid restore');const beforeRestoreUsers=sqliteCount(path.join(target.data,'mcc.sqlite'),'users');assert.equal(beforeRestoreUsers,4);
  result=await request(targetBase,'/api/backup/recovery/restore',{method:'POST',cookie:targetOwner,body:{backupId:importedId,confirmation:'NO'}});assert.equal(result.response.status,400);assert.equal(sqliteCount(path.join(target.data,'mcc.sqlite'),'users'),beforeRestoreUsers);assert.equal(fs.readFileSync(path.join(target.uploads,'target-only.txt'),'utf8'),'must disappear after valid restore');
  const disconnected=path.join(externalFixture,'removable-disconnected');fs.renameSync(externalSuccess,disconnected);
  result=await request(targetBase,'/api/backup/recovery/restore',{method:'POST',cookie:targetOwner,body:{backupId:importedId,confirmation:'RESTORE MCC'}});assert.equal(result.response.status,200,result.data.error);assert.equal(result.data.preRestoreBackup.type,'pre_restore');
  const recoveredOwner=await login(targetBase,'source-owner@example.com');const restoredUserCount=sqliteCount(path.join(target.data,'mcc.sqlite'),'users');fs.writeFileSync(path.join(target.uploads,'failed-restore-sentinel.txt'),'preserve me');fs.appendFileSync(path.join(target.recovery,'imported',importedId,'RECOVERY_README.txt'),'tampered after successful restore');result=await request(targetBase,'/api/backup/recovery/restore',{method:'POST',cookie:recoveredOwner,body:{backupId:importedId,confirmation:'RESTORE MCC'}});assert.equal(result.response.status,400);assert.match(result.data.error,/checksum mismatch/i);assert.equal(sqliteCount(path.join(target.data,'mcc.sqlite'),'users'),restoredUserCount);assert.equal(fs.readFileSync(path.join(target.uploads,'failed-restore-sentinel.txt'),'utf8'),'preserve me');
  await stop(server);server=null;
  assert.equal(sqliteQuickCheck(path.join(target.data,'mcc.sqlite')),'ok');assert.equal(sqliteCount(path.join(target.data,'mcc.sqlite'),'users'),manifest.recordCounts.users);assert.equal(fs.readFileSync(path.join(target.uploads,'portable-marker.txt'),'utf8'),'source upload payload');assert.equal(fs.existsSync(path.join(target.uploads,'target-only.txt')),false);assert.equal(fs.readFileSync(path.join(target.workOrders,'WO-PORTABLE-1.pdf'),'utf8'),'%PDF-1.4\nportable work order\n%%EOF');assert.deepEqual(fs.readFileSync(path.join(target.pmExcel,'PM_report_latest.xlsx')),fs.readFileSync(path.join(source.pmExcel,'PM_report_latest.xlsx')));
  const preRestoreManifests=fs.readdirSync(path.join(target.backups,'MCC Master back up'),{withFileTypes:true}).filter(entry=>entry.isDirectory()).map(entry=>JSON.parse(fs.readFileSync(path.join(target.backups,'MCC Master back up',entry.name,'manifest.json'),'utf8')));assert.ok(preRestoreManifests.some(item=>item.backupType==='pre_restore'));
  assert.ok(fs.existsSync(path.join(target.recovery,'imported',importedId)));assert.ok(fs.existsSync(path.join(target.recovery,'archives',`${importedId}.zip`)));
  console.log('Portable Master Backup tests passed: coherent SQLite/Excel/files package, ZIP streaming and permissions, verified external copy/failure isolation, hostile archive rejection, MCC-owned import, pre_restore protection, and clean-runtime restore after source removal.');
}

try{await run();}finally{await stop(server);const resolved=path.resolve(fixture);const allowed=path.resolve(root,'tmp');if(resolved.startsWith(`${allowed}${path.sep}`)&&fs.existsSync(resolved))fs.rmSync(resolved,{recursive:true,force:true});const externalResolved=path.resolve(externalFixture);const externalAllowed=path.resolve(os.tmpdir());if(externalResolved.startsWith(`${externalAllowed}${path.sep}`)&&fs.existsSync(externalResolved))fs.rmSync(externalResolved,{recursive:true,force:true});}
