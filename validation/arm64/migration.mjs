import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {pipeline} from 'node:stream/promises';
import {Readable} from 'node:stream';
import {candidate,legacy,candidateSha,legacySha,evidence,native,local,moduleFrom} from './config.mjs';
if(!local)assert.ok(native,'Native Linux ARM64 required.');
const {freePort,password,request,owner,pause}=await moduleFrom('tests/helpers/security-process.mjs');
const {seedMachineHistory,digest}=await moduleFrom('tests/helpers/machine-archive-data.mjs');
const {validatePortablePackage,inspectPortableArchive,sha256File}=await moduleFrom('backend/dist/server/portableBackup.js');
const {compareSemver}=await moduleFrom('backend/dist/server/systemUpdate.js');
import {pathToFileURL} from 'node:url';
const {migrateAssetNoteWorkLogs}=await import(pathToFileURL(path.join(legacy,'backend/dist/server/assetNoteWorkLogs.js')).href);
fs.mkdirSync(evidence,{recursive:true});
const codeRoots={'source':candidate,'legacy-source':legacy};
const migrationTemporary=process.platform==='win32'?path.resolve(candidate,'../m'):evidence;
fs.mkdirSync(migrationTemporary,{recursive:true});
const root=fs.mkdtempSync(path.join(migrationTemporary,'migration-'));
const results={source:candidateSha,legacy:legacySha,native,platform:process.platform,node:process.version,checks:[],metrics:{}};
const output=path.join(evidence,'final-migration-results.json');
function save(){fs.writeFileSync(output,JSON.stringify(results,null,2));}
function check(name,fn){try{const detail=fn();results.checks.push({name,status:'pass',detail});console.log(`PASS ${name}`);save();return detail;}catch(e){results.checks.push({name,status:'fail',error:String(e)});save();throw e;}}
const alive=new Set();
async function start(code,label,storage){
 const app=path.join(root,label,'app');fs.mkdirSync(path.join(app,'backend'),{recursive:true});
 for(const file of ['package.json','backend/package.json'])fs.copyFileSync(path.join(codeRoots[code],file),path.join(app,file));
 fs.cpSync(path.join(codeRoots[code],'backend/dist'),path.join(app,'backend/dist'),{recursive:true});fs.cpSync(path.join(codeRoots[code],'shared'),path.join(app,'shared'),{recursive:true});
 fs.symlinkSync(path.join(codeRoots[code],'backend/node_modules'),path.join(app,'backend/node_modules'),'junction');
 const port=await freePort();const env={...Object.fromEntries(Object.entries(process.env).filter(([k])=> !/^(MCC_|SMTP_|SESSION_SECRET$|NODE_OPTIONS$|NODE_PATH$)/i.test(k))),NODE_ENV:'test',PORT:String(port),MCC_BIND_HOST:'127.0.0.1',MCC_UPDATE_MODE:'',MCC_HTTPS_MODE:'',SESSION_SECRET:'migration-synthetic-only',SMTP_HOST:'',SMTP_PORT:'',SMTP_USER:'',SMTP_PASS:'',SMTP_FROM:''};
 for(const [key,dir]of Object.entries({MCC_DATA_DIR:'data',MCC_UPLOADS_DIR:'uploads',MCC_BACKUPS_DIR:'backups',MCC_RECOVERY_DIR:'recovery',MCC_PM_EXCEL_DIR:'pm-excel',MCC_PM_WORK_ORDER_DIR:'pm-work-orders',TEMP:'temporary',TMP:'temporary',TMPDIR:'temporary'})){env[key]=path.join(storage,dir);fs.mkdirSync(env[key],{recursive:true});}
 const started=Date.now();const child=spawn(process.execPath,[path.join(app,'backend/dist/server/index.js')],{cwd:app,env,windowsHide:true,stdio:['ignore','pipe','pipe']});alive.add(child);let log='';for(const stream of[child.stdout,child.stderr])stream.on('data',b=>log+=b.toString());
 const base=`http://127.0.0.1:${port}`;for(let n=0;n<200;n++){assert.equal(child.exitCode,null,log);try{if((await fetch(`${base}/api/health`,{signal:AbortSignal.timeout(500)})).ok)break;}catch{}await pause(100);}
 assert.equal((await fetch(`${base}/api/health`)).status,200);results.metrics[`${label}StartupMs`]=Date.now()-started;
 return {child,base,fixture:storage,env,app,async close(){if(child.exitCode===null){const p=new Promise(r=>child.once('exit',r));child.kill();const timer=setTimeout(()=>child.kill('SIGKILL'),3000);await p;clearTimeout(timer);}alive.delete(child);fs.writeFileSync(path.join(evidence,`migration-${label}.log`),log);}};
}
const sourceStorage=path.join(root,'external-state');let runtime,db;
const tables=['machine_assets','equipment_assets','machine_inspection_records','machine_asset_notes','machine_asset_note_attachments','equipment_asset_notes','equipment_asset_note_attachments','equipment_documents','equipment_document_folders','asset_note_updates','asset_note_update_entries','asset_note_update_attachments','asset_note_labor','asset_note_lifecycle_events','pm_tasks','pm_history','pm_history_participants','pm_asset_meters','pm_meter_history','pm_work_order_attachments','machine_documents','machine_document_folders','machine_component_images'];
function snapshot(db){return Object.fromEntries(tables.map(t=>[t,db.prepare(`SELECT * FROM ${t} ORDER BY id`).all()]));}
function preserved(db,before){for(const[t,rows]of Object.entries(before)){const columns=rows.length?Object.keys(rows[0]):null;const after=db.prepare(`SELECT ${columns?columns.map(c=>'"'+c.replaceAll('"','""')+'"').join(','):'*'} FROM ${t} ORDER BY id`).all();assert.deepEqual(after,rows,t);}}
async function login(base){const r=await request(base,'/api/auth/login',{method:'POST',body:{email:'owner@example.test',password}});assert.equal(r.response.status,200);return r.cookie;}
try{
 check('Updater recognizes 1.5.18 -> 2.0.0',()=>assert.equal(compareSemver('2.0.0','1.5.18'),1));
 runtime=await start('legacy-source','legacy-first',sourceStorage);let cookie=await owner(runtime.base);const assets=[];
 for(const assetNumber of['MIGRATION-OLD','MIGRATION-REPLACEMENT']){const r=await request(runtime.base,'/api/machine-library/assets',{method:'POST',cookie,body:{assetNumber,assetName:'Synthetic legacy machine',brand:'MCC',status:'active'}});assert.equal(r.response.status,201,JSON.stringify(r.data));assets.push(r.data.asset);}
 db=new DatabaseSync(path.join(sourceStorage,'data/mcc.sqlite'));const seeded=seedMachineHistory(db,runtime,assets[0].id,assets[1].id);migrateAssetNoteWorkLogs(db);
 db.prepare('UPDATE pm_history SET completion_notes=? WHERE id=?').run('Original production-schema PM correction',seeded.historyId);
 check('Legacy database really predates lifecycle schema',()=>assert.equal(db.prepare('PRAGMA table_info(machine_assets)').all().some(c=>c.name==='lifecycle_status'),false));
 const workbook=path.join(runtime.env.MCC_PM_EXCEL_DIR,'PM_report_latest.xlsx');fs.copyFileSync(path.join(candidate,'tests/fixtures/pm-report-sanitized.xlsx'),workbook);
 const originals=[...seeded.payloads.map(f=>({path:f.destination,sha256:f.sha256})),{path:workbook,sha256:digest(fs.readFileSync(workbook))}];db.close();db=null;await runtime.close();runtime=null;
 runtime=await start('legacy-source','legacy-normalized',sourceStorage);cookie=await login(runtime.base);
 const oldBackup=await request(runtime.base,'/api/backup/create',{method:'POST',cookie,body:{category:'master'}});assert.equal(oldBackup.response.status,201,JSON.stringify(oldBackup.data));
 const oldArchive=path.join(runtime.env.MCC_BACKUPS_DIR,'portable',oldBackup.data.backup.portableArchiveFilename),oldArchiveHash=await sha256File(oldArchive);
 const oldPackage=path.join(runtime.env.MCC_BACKUPS_DIR,'MCC Master back up',oldBackup.data.backup.id);
 check('Original 1.5.18 Master package is valid for 2.0.0 recovery',()=>assert.equal(validatePortablePackage(oldPackage,'2.0.0').ok,true));
 db=new DatabaseSync(path.join(sourceStorage,'data/mcc.sqlite'));const before=snapshot(db);db.close();db=null;await runtime.close();runtime=null;
 db=new DatabaseSync(path.join(sourceStorage,'data/mcc.sqlite'));db.exec('PRAGMA wal_checkpoint(TRUNCATE)');db.close();db=null;
 fs.cpSync(sourceStorage,path.join(root,'pre-upgrade-preserved'),{recursive:true});fs.writeFileSync(path.join(evidence,'legacy-row-baseline.json'),JSON.stringify(before,null,2));
 results.metrics.legacyDatabaseBytes=fs.statSync(path.join(sourceStorage,'data/mcc.sqlite')).size;
 runtime=await start('source','integrated-migration',sourceStorage);cookie=await login(runtime.base);db=new DatabaseSync(path.join(sourceStorage,'data/mcc.sqlite'));
 check('Automatic full-schema migration preserves historical rows and IDs',()=>preserved(db,before));
 check('All existing machines default to active with revision zero',()=>{assert.deepEqual(db.prepare('SELECT id,lifecycle_status,lifecycle_revision FROM machine_assets ORDER BY id').all().map(r=>({...r})),assets.map(a=>({id:a.id,lifecycle_status:'active',lifecycle_revision:0})));});
 check('Migration preserves original attachment and PM workbook SHA256',()=>{for(const f of originals)assert.equal(digest(fs.readFileSync(f.path)),f.sha256);return {fileCount:originals.length};});
 check('Migrated database integrity and foreign keys',()=>{assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);});
 const afterFirst=snapshot(db);const schema=db.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();db.close();db=null;await runtime.close();runtime=null;
 runtime=await start('source','integrated-repeat',sourceStorage);cookie=await login(runtime.base);db=new DatabaseSync(path.join(sourceStorage,'data/mcc.sqlite'));
 check('Second startup is idempotent for migrated rows and schema',()=>{preserved(db,afterFirst);assert.deepEqual(db.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all(),schema);});
 const retired=await request(runtime.base,`/api/machine-library/assets/${assets[0].id}/lifecycle`,{method:'POST',cookie,body:{lifecycleStatus:'archived',expectedRevision:0,retirementReason:'replaced',retirementNotes:'Synthetic release rehearsal',replacementMachineId:assets[1].id}});
 check('Archive retains identity and replacement relationship',()=>{assert.equal(retired.response.status,200,JSON.stringify(retired.data));assert.equal(retired.data.asset.id,assets[0].id);assert.equal(retired.data.asset.replacementMachine.id,assets[1].id);});
 const stateBeforeBackup=snapshot(db);const lifecycleBefore=db.prepare('SELECT * FROM machine_assets WHERE id=?').get(assets[0].id);
 check('Archive preserves all historical relations and file bytes',()=>{for(const[t,rows]of Object.entries(before).filter(([t])=>t!=='machine_assets'))preserved(db,{[t]:rows});for(const f of originals)assert.equal(digest(fs.readFileSync(f.path)),f.sha256);});
 db.close();db=null;
 const backupStarted=Date.now();const backup=await request(runtime.base,'/api/backup/create',{method:'POST',cookie,body:{category:'master'}});results.metrics.masterBackupMs=Date.now()-backupStarted;
 check('Master Backup creates a portable recovery-ready package',()=>{assert.equal(backup.response.status,201,JSON.stringify(backup.data));assert.equal(backup.data.backup.portableReady,true);});
 const backupId=backup.data.backup.id;const packagePath=path.join(runtime.env.MCC_BACKUPS_DIR,'MCC Master back up',backupId);const archive=path.join(runtime.env.MCC_BACKUPS_DIR,'portable',backup.data.backup.portableArchiveFilename);
 const validation=validatePortablePackage(packagePath,'2.0.0');const inspected=inspectPortableArchive(archive);
 results.metrics.backup={packageBytes:validation.expandedSizeBytes,archiveBytes:fs.statSync(archive).size,entries:inspected.entries.length,sha256:await sha256File(archive),checkedFileCount:validation.checkedFileCount};
 check('Backup full manifest checksums, database and library payload integrity',()=>assert.equal(validation.ok,true));
 const response=await fetch(`${runtime.base}/api/backup/portable/${encodeURIComponent(backupId)}/download`,{headers:{Cookie:cookie}});assert.equal(response.status,200);const downloaded=path.join(root,'downloaded.zip');await pipeline(Readable.fromWeb(response.body),fs.createWriteStream(downloaded));
 check('Portable download matches on-disk ZIP checksum',()=>assert.equal(digest(fs.readFileSync(downloaded)),results.metrics.backup.sha256));
 await request(runtime.base,`/api/machine-library/assets/${assets[0].id}/lifecycle`,{method:'POST',cookie,body:{lifecycleStatus:'active',expectedRevision:1,restoreReason:'Disposable mutation before restore'}});
 const restore=await request(runtime.base,'/api/backup/restore',{method:'POST',cookie,body:{category:'master',backupId,confirmation:'RESTORE MCC'}});
 check('Full Master Restore succeeds on external synthetic storage',()=>assert.equal(restore.response.status,200,JSON.stringify(restore.data)));
 db=new DatabaseSync(path.join(sourceStorage,'data/mcc.sqlite'));
 check('Master Restore preserves archived state and replacement identity',()=>{assert.deepEqual(db.prepare('SELECT * FROM machine_assets WHERE id=?').get(assets[0].id),lifecycleBefore);preserved(db,stateBeforeBackup);});
 check('Master Restore retains historical files and database integrity',()=>{for(const f of originals)assert.equal(digest(fs.readFileSync(f.path)),f.sha256);assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);});
 check('Earlier 1.5.18 backup ZIP remains byte-identical after migration and restore',()=>assert.equal(digest(fs.readFileSync(oldArchive)),oldArchiveHash));
 db.close();db=null;await runtime.close();runtime=null;
 results.rollback={status:'NOT VERIFIED',reason:'Historical code is never booted against migrated work here; native deployment helper rejection is tested separately.'};
 results.status='pass';save();console.log(JSON.stringify({passed:results.checks.filter(c=>c.status==='pass').length,failed:0,rollback:results.rollback}));
}catch(e){results.status='fail';results.error=e.stack;save();console.error(e);process.exitCode=1;}finally{if(db)db.close();if(runtime)await runtime.close();for(const child of alive)child.kill();}
