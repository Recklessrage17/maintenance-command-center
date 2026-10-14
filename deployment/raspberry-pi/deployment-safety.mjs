#!/usr/bin/env node
// Root-installed deployment helper. Uses only Node 22 built-ins; never starts MCC.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';

const roles = ['data','uploads','documents','files','pmWorkOrders','pmExcel','recovery','backups'];
const excludedNames = new Set(['node_modules','.npm','.cache']);
const inside = (parent, child) => { const r=path.relative(parent,child); return !r || (r!=='..'&&!r.startsWith(`..${path.sep}`)&&!path.isAbsolute(r)); };
const fail = message => { throw new Error(message); };
export function fileHash(filename) {
  if(fs.lstatSync(filename).isSymbolicLink()||!fs.statSync(filename).isFile())fail('Snapshot checksums require regular files without links.');
  const fd=fs.openSync(filename,'r'),hash=crypto.createHash('sha256'),buffer=Buffer.allocUnsafe(1024*1024);
  try { let bytes; while((bytes=fs.readSync(fd,buffer,0,buffer.length,null)))hash.update(buffer.subarray(0,bytes)); return hash.digest('hex'); }
  finally { fs.closeSync(fd); }
}
function existing(filename, directory=true) {
  if(typeof filename!=='string'||!path.isAbsolute(filename)||/[\x00-\x1f]/.test(filename))fail('An absolute explicit storage path is required.');
  const resolved=path.resolve(filename); if(resolved===path.parse(resolved).root)fail('A filesystem root cannot be a storage or application directory.');
  let next=resolved;
  while(next!==path.dirname(next)){if(fs.lstatSync(next).isSymbolicLink())fail(`Linked storage/configuration paths are not allowed: ${filename}`);next=path.dirname(next);}
  const stat=fs.statSync(resolved);
  if(directory?!stat.isDirectory():!stat.isFile())fail(`Unexpected storage/configuration type: ${filename}`);
  return resolved;
}
export function linuxMountInfo(filename) {
  if(process.platform!=='linux')fail('Real Linux mount discovery is required for the deployment CLI.');
  const result=JSON.parse(execFileSync('findmnt',['--json','--target',filename,'--output','TARGET,UUID,FSTYPE'],{encoding:'utf8'}));
  const mount=result.filesystems?.[0]; if(!mount?.target||!mount.uuid||!mount.fstype)fail(`Cannot prove mount identity: ${filename}`);
  return mount;
}
export function validateMounts(storage, mountInfo=linuxMountInfo) {
  for(const filename of [storage.appDir,storage.snapshotDir,...Object.values(storage.roots),...storage.configurationFiles]) {
    const actual=mountInfo(filename);
    if(!storage.mounts.some(m=>m.target===actual.target&&m.uuid.toLowerCase()===String(actual.uuid).toLowerCase()&&m.fstype===actual.fstype))fail(`Storage mount mismatch or missing persistent mount: ${filename}`);
  }
}
export function loadStorageManifest(filename,{mountInfo=linuxMountInfo}={}) {
  filename=existing(filename,false);
  const stat=fs.statSync(filename);
  if(process.platform==='linux'&&(stat.uid!==0||(stat.mode&0o022)))fail('Storage manifest must be root-owned and not group/world writable.');
  const input=JSON.parse(fs.readFileSync(filename,'utf8'));
  if(input.schemaVersion!==1||!input.roots||!Array.isArray(input.mounts)||!input.mounts.length||!Array.isArray(input.configurationFiles))fail('Invalid complete storage manifest.');
  const storage={schemaVersion:1,filename,appDir:existing(input.appDir),snapshotDir:existing(input.snapshotDir),roots:{},configurationFiles:[filename,...input.configurationFiles.map(f=>existing(f,false))],mounts:input.mounts};
  for(const envFile of ['.env','backend/.env']){const filename=path.join(storage.appDir,envFile);if(fs.existsSync(filename))storage.configurationFiles.push(existing(filename,false));}
  const snapshotStat=fs.statSync(storage.snapshotDir);
  if(process.platform==='linux'&&(snapshotStat.uid!==0||(snapshotStat.mode&0o022)))fail('Snapshot storage must be root-owned and not group/world writable.');
  for(const role of roles)storage.roots[role]=existing(input.roots[role]);
  if(new Set(Object.values(storage.roots)).size!==roles.length)fail('Storage roles must use distinct directories.');
  for(const root of Object.values(storage.roots))if(inside(root,storage.appDir))fail('Runtime storage cannot contain application source.');
  if(storage.roots.documents!==path.join(storage.appDir,'backend','documents')||storage.roots.files!==path.join(storage.appDir,'backend','files'))fail('documents/files must match the actual backend-relative runtime directories.');
  for(const root of [storage.appDir,...Object.values(storage.roots)])if(inside(root,storage.snapshotDir)||inside(storage.snapshotDir,root))fail('Snapshot storage must be separate from application and all runtime roots.');
  for(const mount of storage.mounts)if(!mount||typeof mount.target!=='string'||typeof mount.uuid!=='string'||!mount.uuid||typeof mount.fstype!=='string')fail('Explicit mount target, filesystem UUID and type are required.');
  validateMounts(storage,mountInfo);return storage;
}
export function assertLiveStorage(storage,pid) {
  if(!Number.isSafeInteger(pid)||pid<1)fail('A running MCC PID is required to verify effective storage settings.');
  const env=Object.fromEntries(fs.readFileSync(`/proc/${pid}/environ`,'utf8').split('\0').filter(Boolean).map(line=>{const p=line.indexOf('=');return[line.slice(0,p),line.slice(p+1)];}));
  if(fs.realpathSync(`/proc/${pid}/cwd`)!==storage.appDir)fail('Running MCC working directory does not match the manifest.');
  const data=path.resolve(storage.appDir,env.MCC_DATA_DIR||'backend/data');
  const recovery=env.MCC_RECOVERY_DIR||(inside(storage.appDir,data)?env.HOME&&path.join(env.HOME,'.mcc','recovery'):path.join(data,'recovery'));
  if(!recovery)fail('Cannot resolve service recovery storage; configure MCC_RECOVERY_DIR explicitly.');
  const effective={data,uploads:env.MCC_UPLOADS_DIR||'backend/uploads',backups:env.MCC_BACKUPS_DIR||'backend/backups',documents:'backend/documents',files:'backend/files',pmExcel:env.MCC_PM_EXCEL_DIR||path.join(data,'pm-excel'),pmWorkOrders:env.MCC_PM_WORK_ORDER_DIR||path.join(data,'PDF - Work orders'),recovery};
  for(const role of roles)if(existing(path.resolve(storage.appDir,effective[role]))!==storage.roots[role])fail(`Running MCC ${role} differs from the reviewed storage manifest.`);
}
export function databaseState(dataDir,scratchDir=os.tmpdir()) {
  existing(path.join(dataDir,'mcc.sqlite'),false);
  const files=['mcc.sqlite','mcc.sqlite-wal','mcc.sqlite-shm'].filter(name=>fs.existsSync(path.join(dataDir,name)));
  const bytes=files.reduce((sum,name)=>sum+fs.statSync(existing(path.join(dataDir,name),false)).size,0),space=fs.statfsSync(scratchDir);
  if(space.bavail*space.bsize<bytes+64*1024**2)fail('Insufficient temporary SSD space for independent database validation.');
  // Even SQLite read-only opens can update/create shared-memory sidecars. Validate
  // a separate quiescent copy so inspection never changes live/snapshot bytes.
  const temporary=fs.mkdtempSync(path.join(scratchDir,'.mcc-db-check-'));let db;
  try {
    for(const name of files)fs.copyFileSync(path.join(dataDir,name),path.join(temporary,name),fs.constants.COPYFILE_EXCL);
    db=new DatabaseSync(path.join(temporary,'mcc.sqlite'),{readOnly:true});
    const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));
    if(!['users','machine_assets','pm_tasks','pm_history'].every(name=>tables.has(name)))fail('The configured database is not an MCC operational database.');
    if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')fail('SQLite integrity check failed.');
    if(db.prepare('PRAGMA foreign_key_check').all().length)fail('SQLite foreign-key check failed.');
    const lifecycle=db.prepare('PRAGMA table_info(machine_assets)').all().some(c=>c.name==='lifecycle_status');
    return {lifecycle,states:lifecycle?db.prepare('SELECT lifecycle_status,COUNT(*) AS count FROM machine_assets GROUP BY lifecycle_status').all():[]};
  } finally {
    db?.close();
    if(inside(path.resolve(scratchDir),path.resolve(temporary))&&path.basename(temporary).startsWith('.mcc-db-check-'))fs.rmSync(temporary,{recursive:true});
  }
}
export function assertCompatible(targetApp,dataDir,{scratchDir}={}) {
  const state=databaseState(dataDir,scratchDir);let capability;
  try {capability=JSON.parse(fs.readFileSync(path.join(targetApp,'deployment/compatibility.json'),'utf8'));}catch{}
  if(state.lifecycle&&(capability?.schemaVersion!==1||capability.machineLifecycle!==1||!['active','out_of_service','archived'].every(s=>capability.states?.includes(s))))fail('Unsafe downgrade blocked: the target has no reviewed lifecycle compatibility declaration. Preserve current state and recover with lifecycle-aware code.');
  if(state.states.some(s=>!['active','out_of_service','archived'].includes(s.lifecycle_status)))fail('Unknown lifecycle state; operator recovery required.');
  return state;
}
function inventory(root, exclusions=[], code=false) {
  const entries=[];
  function visit(current) {
    if(exclusions.some(e=>inside(e,current))||(code&&excludedNames.has(path.basename(current))))return;
    const stat=fs.lstatSync(current),relative=path.relative(root,current).split(path.sep).join('/');
    if(stat.isSymbolicLink()||(!stat.isDirectory()&&!stat.isFile()))fail(`Unsupported linked/special snapshot entry: ${current}`);
    if(relative)entries.push({path:relative,directory:stat.isDirectory(),mode:stat.mode&0o777,uid:stat.uid,gid:stat.gid,...(stat.isFile()?{bytes:stat.size,sha256:fileHash(current)}:{})});
    if(entries.length>200000)fail('Snapshot inventory exceeds 200,000 entries; arrange supervised recovery.');
    if(stat.isDirectory())for(const name of fs.readdirSync(current).sort())visit(path.join(current,name));
  }
  visit(root);return entries;
}
function copyInventory(source,destination,entries) {
  fs.mkdirSync(destination,{recursive:true,mode:0o700});
  for(const entry of entries){const target=path.join(destination,...entry.path.split('/'));if(entry.directory)fs.mkdirSync(target,{recursive:true,mode:0o700});else{fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});fs.copyFileSync(path.join(source,...entry.path.split('/')),target,fs.constants.COPYFILE_EXCL);fs.chmodSync(target,entry.mode);}}
  for(const entry of [...entries].reverse())if(entry.directory)fs.chmodSync(path.join(destination,...entry.path.split('/')),entry.mode);
}
function rootExclusions(storage,role) {const root=storage.roots[role];return Object.values(storage.roots).filter(p=>p!==root&&inside(root,p));}
function comparable(entries){return entries.map(({uid:_uid,gid:_gid,...entry})=>entry);}
export function createSnapshot(storage,{phase='manual',mountInfo=linuxMountInfo}={}) {
  validateMounts(storage,mountInfo);
  const units={source:{original:storage.appDir,entries:inventory(storage.appDir,Object.values(storage.roots),true)}};
  for(const role of roles)units[role]={original:storage.roots[role],entries:inventory(storage.roots[role],rootExclusions(storage,role))};
  const configurations=[...new Set(storage.configurationFiles)].map((file,index)=>({original:file,path:`configuration/${index}-${path.basename(file)}`,bytes:fs.statSync(file).size,sha256:fileHash(file),mode:fs.statSync(file).mode&0o777}));
  const requiredBytes=Object.values(units).flatMap(u=>u.entries).reduce((n,e)=>n+(e.bytes||0),0)+configurations.reduce((n,e)=>n+e.bytes,0);
  const free=fs.statfsSync(storage.snapshotDir);if(free.bavail*free.bsize<requiredBytes+64*1024**2)fail('Insufficient space for full deployment snapshot plus 64 MiB headroom.');
  const id=`mcc-deployment-${new Date().toISOString().replaceAll(':','-')}-${crypto.randomUUID()}`,directory=path.join(storage.snapshotDir,id),partial=path.join(storage.snapshotDir,`.${id}.partial`);
  fs.mkdirSync(partial,{mode:0o700});
  // Failed snapshots are retained as private .partial evidence, never replace valid ones.
  for(const[name,unit]of Object.entries(units))copyInventory(unit.original,path.join(partial,'units',name),unit.entries);
  for(const entry of configurations){const dest=path.join(partial,entry.path);fs.mkdirSync(path.dirname(dest),{recursive:true,mode:0o700});fs.copyFileSync(entry.original,dest,fs.constants.COPYFILE_EXCL);fs.chmodSync(dest,0o600);}
  const state=databaseState(path.join(partial,'units/data'),storage.snapshotDir);
  const manifest={schemaVersion:1,id,phase,createdAt:new Date().toISOString(),units,configurations,state,requiredBytes,mounts:storage.mounts,policy:'Operator recovery into new storage only; never silently overwrite post-snapshot work.'};
  fs.writeFileSync(path.join(partial,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx',mode:0o600});
  fs.writeFileSync(path.join(partial,'manifest.sha256'),fileHash(path.join(partial,'manifest.json')),{flag:'wx',mode:0o600});
  verifySnapshot(partial);assertUnchanged(partial,storage);validateMounts(storage,mountInfo);fs.renameSync(partial,directory);
  return {directory,id,requiredBytes,state};
}
export function verifySnapshot(directory) {
  directory=existing(directory);const manifestPath=path.join(directory,'manifest.json');
  if(fileHash(manifestPath)!==fs.readFileSync(existing(path.join(directory,'manifest.sha256'),false),'utf8'))fail('Deployment manifest checksum mismatch.');
  const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
  if(manifest.schemaVersion!==1||!manifest.units||!manifest.id||!Array.isArray(manifest.configurations)||!['source',...roles].every(r=>manifest.units[r]))fail('Incomplete deployment snapshot.');
  for(const[name,unit]of Object.entries(manifest.units)){
    if(!['source',...roles].includes(name)||!Array.isArray(unit.entries))fail('Unexpected snapshot unit.');
    if(JSON.stringify(comparable(inventory(path.join(directory,'units',name))))!==JSON.stringify(comparable(unit.entries)))fail(`Snapshot checksum/tree mismatch: ${name}`);
  }
  for(const entry of manifest.configurations){if(!/^configuration\/[0-9]+-[^/\\]+$/.test(entry.path)||fileHash(path.join(directory,entry.path))!==entry.sha256)fail('Configuration checksum mismatch.');}
  const configurationEntries=inventory(path.join(directory,'configuration'));
  if(configurationEntries.length!==manifest.configurations.length||configurationEntries.some(entry=>entry.directory||!manifest.configurations.some(expected=>expected.path===`configuration/${entry.path}`&&expected.sha256===entry.sha256&&expected.bytes===entry.bytes)))fail('Unlisted or inconsistent deployment configuration file.');
  databaseState(path.join(directory,'units/data'),path.dirname(directory));return manifest;
}
export function assertUnchanged(snapshot,storage) {
  const manifest=verifySnapshot(snapshot);
  for(const role of roles)if(storage.roots[role]!==manifest.units[role].original||JSON.stringify(comparable(inventory(storage.roots[role],rootExclusions(storage,role))))!==JSON.stringify(comparable(manifest.units[role].entries)))fail(`Post-snapshot ${role} changed; preserve current state and require an operator recovery decision.`);
  for(const entry of manifest.configurations)if(fileHash(entry.original)!==entry.sha256)fail('Deployment configuration changed after snapshot.');
}
export function recoverToNewStorage(snapshot,destination,targetApp,decision,{mountInfo=linuxMountInfo,storage}={}) {
  const manifest=verifySnapshot(snapshot);
  const required=`RECOVER ${manifest.id} INTO NEW STORAGE; REVIEW AND ACCEPT THE SNAPSHOT RECOVERY POINT`;
  if(decision!==required)fail(`Operator decision required: ${required}. Any writes after ${manifest.createdAt} are absent from this recovery point; preserve them separately.`);
  assertCompatible(targetApp,path.join(snapshot,'units/data'),{scratchDir:path.dirname(snapshot)});
  if(!storage)fail('Reviewed mount/storage inventory is required for recovery.');validateMounts(storage,mountInfo);
  if(!path.isAbsolute(destination)||fs.existsSync(destination)||!inside(storage.snapshotDir,path.dirname(destination)))fail('Recovery requires a new empty destination under reviewed snapshot storage.');
  const parent=existing(path.dirname(destination)),observed=mountInfo(parent);
  if(!storage.mounts.some(m=>m.target===observed.target&&m.uuid.toLowerCase()===String(observed.uuid).toLowerCase()&&m.fstype===observed.fstype))fail('Recovery destination mount mismatch.');
  const free=fs.statfsSync(parent),databaseBytes=fs.statSync(path.join(snapshot,'units/data/mcc.sqlite')).size;
  if(free.bavail*free.bsize<manifest.requiredBytes+databaseBytes+64*1024**2)fail('Insufficient clean-recovery space plus independent database validation headroom.');
  fs.mkdirSync(destination,{mode:0o700});const app=path.join(destination,'application');
  // Never place the old deployment's absolute-path .env into runnable recovery code.
  copyInventory(targetApp,app,inventory(targetApp,[...Object.values(storage.roots),path.join(targetApp,'.env'),path.join(targetApp,'backend/.env')],true));
  const restored={};for(const role of roles){const target=['documents','files'].includes(role)?path.join(app,'backend',role):path.join(destination,'runtime',role);copyInventory(path.join(snapshot,'units',role),target,manifest.units[role].entries);restored[role]=target;}
  for(const role of roles)if(JSON.stringify(comparable(inventory(restored[role])))!==JSON.stringify(comparable(manifest.units[role].entries)))fail(`Recovery byte verification failed: ${role}`);
  fs.cpSync(path.join(snapshot,'configuration'),path.join(destination,'preserved-configuration'),{recursive:true,errorOnExist:true});
  assertCompatible(app,restored.data,{scratchDir:storage.snapshotDir});validateMounts(storage,mountInfo);
  fs.writeFileSync(path.join(destination,'recovery.json'),JSON.stringify({snapshot:manifest.id,recoveryPoint:manifest.createdAt,decision,app,roots:restored,notStarted:true,notice:'Review configuration, ownership and all paths before starting. Old absolute destinations were not overwritten.'},null,2),{flag:'wx',mode:0o600});
  return {app,roots:restored};
}
function stopped(service) {
  if(!/^[a-zA-Z0-9@_.-]+\.service$/.test(service||''))fail('Explicit service identity required.');
  const state=execFileSync('systemctl',['show',service,'-p','ActiveState','--value'],{encoding:'utf8'}).trim();
  const pid=execFileSync('systemctl',['show',service,'-p','MainPID','--value'],{encoding:'utf8'}).trim();
  if(!['inactive','failed'].includes(state)||pid!=='0')fail('MCC must be stopped before snapshot or recovery; no automatic stop is performed.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const [command,...args]=process.argv.slice(2),options={};
    for(let i=0;i<args.length;i+=2){if(!args[i]?.startsWith('--')||!args[i+1])fail('Expected named arguments.');options[args[i].slice(2)]=args[i+1];}
    if(process.platform!=='linux'||process.getuid?.()!==0)fail('Deployment CLI requires Linux root; use isolated functional tests on Windows.');
    let result;
    if(command==='verify')result=verifySnapshot(options.snapshot);
    else {
      const storage=loadStorageManifest(options.manifest);
      if(command==='validate-live'){assertLiveStorage(storage,Number(options.pid));result={ok:true};}
      else if(command==='compatible'){stopped(options.service);result=assertCompatible(options['target-app'],storage.roots.data,{scratchDir:storage.snapshotDir});}
      else if(command==='unchanged'){stopped(options.service);assertUnchanged(options.snapshot,storage);result={ok:true};}
      else if(command==='snapshot'){stopped(options.service);result=createSnapshot(storage,{phase:options.phase||'manual'});}
      else if(command==='recover'){stopped(options.service);result=recoverToNewStorage(options.snapshot,options.destination,options['target-app'],options.decision,{storage});}
      else fail('Use validate-live, compatible, unchanged, snapshot, verify, or recover.');
    }
    console.log(JSON.stringify(result));
  } catch(error) {console.error(`Deployment safety check failed: ${error.message}`);process.exitCode=1;}
}
