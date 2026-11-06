import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MasterRetention } from '../backend/dist/server/masterRetention.js';
import { createPortableArchive, packageFileChecksums, portablePackageRoot, sha256FileSync, inspectPortableArchive } from '../backend/dist/server/portableBackup.js';
import { pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

test.setTimeout(120_000);

function fixture() {
  if (!process.env.MCC_PLAYWRIGHT_RUN_ID) throw new Error('Managed runner required');
  const root=fs.mkdtempSync(path.join(process.env.TEMP!,'master-retention-'));
  const masterRoot=path.join(root,'master'),portableRoot=path.join(root,'portable');
  fs.mkdirSync(masterRoot,{recursive:true});fs.mkdirSync(portableRoot);
  const options={masterRoot,portableRoot,appVersion:'2.0.0',secret:'synthetic-retention-secret'};
  return {...options,root,engine:new MasterRetention(options)};
}
async function seed(f:ReturnType<typeof fixture>,createdAt:string,type='master_manual',suffix='',managed=false,payloadBytes=0) {
  const id=`MCC_Master_Backup_${createdAt.replace(/[:.]/g,'-')}_${type}`;
  const folder=path.join(f.masterRoot,id),packageRoot=portablePackageRoot(createdAt)+suffix;
  fs.mkdirSync(path.join(folder,'database'),{recursive:true});
  const db=new DatabaseSync(path.join(folder,'database/mcc.sqlite'));
  db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY); CREATE TABLE app_settings(key TEXT); INSERT INTO users VALUES(1);');db.close();
  for(const file of ['RECOVERY_README.txt','recovery/restore-manifest.json','excel/MCC_Inventory.xlsx','excel/MCC_Vendors.xlsx','excel/MCC_Machine_List.xlsx','excel/MCC_Equipment_List.xlsx','excel/MCC_History.xlsx','files/uploads/preserve.pdf']) {
    fs.mkdirSync(path.dirname(path.join(folder,file)),{recursive:true});
    fs.writeFileSync(path.join(folder,file),file.endsWith('restore-manifest.json')?JSON.stringify({packageVersion:1,sourcePathsAreRelative:true}):`synthetic ${file}`);
  }
  if (payloadBytes) fs.writeFileSync(path.join(folder,'files/uploads/representative.bin'),crypto.randomBytes(payloadBytes));
  const archive=`${packageRoot}.zip`;
  const manifest={...(managed?{masterRetentionVersion:1}:{}),backupId:id,packageVersion:1,schemaVersion:1,appName:'MCC',appVersion:'2.0.0',backupCategory:'master',backupType:type,createdAt,databaseFile:'database/mcc.sqlite',checksumSha256:sha256FileSync(path.join(folder,'database/mcc.sqlite')),fileChecksums:packageFileChecksums(folder),portableArchive:{packageRoot,filename:archive}};
  fs.writeFileSync(path.join(folder,'manifest.json'),JSON.stringify(manifest));
  const zip=await createPortableArchive(folder,path.join(f.portableRoot,archive),packageRoot);
  fs.writeFileSync(`${zip.archivePath}.sha256`,`${zip.sha256}  ${archive}\n`);
  return {id,folder,archive:zip.archivePath,manifest};
}
async function four(f:ReturnType<typeof fixture>) {
  const sets=[];
  for(let n=1;n<=4;n++) sets.push(await seed(f,`2026-10-0${n}T12:00:00.000Z`,n%2?'master_manual':'master_scheduled'));
  return sets;
}

test('zero through five: shared cap, month boundary, complete cleanup and deterministic ties',async()=>{
  const f=fixture();expect((await f.engine.preview()).verifiedCount).toBe(0);
  const created=[];
  for(const [i,date] of ['2026-10-30','2026-10-31','2026-11-01','2026-11-02','2026-11-03'].entries()) {
    const set=await seed(f,`${date}T12:00:00.000Z`,i%2?'master_scheduled':'master_manual');created.push(set);
    const result=await f.engine.cleanup({preview:await f.engine.preview(),automaticNewId:set.id});
    expect(result.failed).toEqual([]);expect(result.retained).toBe(Math.min(i+1,3));expect(result.removed).toHaveLength(i>=3?1:0);
    for(const prior of created.slice(-3)) expect((await f.engine.verify(prior.id)).verified).toBe(true);
  }
  for(const set of created.slice(0,2)) for(const item of [set.folder,set.archive,`${set.archive}.sha256`]) expect(fs.existsSync(item)).toBe(false);
  const same=await seed(f,'2026-11-03T12:00:00.000Z','master_scheduled','_2');
  const preview=await f.engine.preview();expect(preview.keep[0].id).toBe(same.id);
});

test('status reads no payload bytes, invalidates metadata changes, and never authorizes deletion',async()=>{
  const f=fixture();const sets=await four(f);await f.engine.preview();
  const read=fs.readFileSync,stream=fs.createReadStream,readSync=fs.readSync;
  try {
    fs.readFileSync=(()=>{throw new Error('Status read content');}) as typeof read;
    fs.createReadStream=(()=>{throw new Error('Status streamed content');}) as typeof stream;
    fs.readSync=(()=>{throw new Error('Status read payload bytes');}) as typeof readSync;
    for(let n=0;n<20;n++)expect(f.engine.status().verifiedCount).toBe(4);
  } finally {fs.readFileSync=read;fs.createReadStream=stream;fs.readSync=readSync;}
  fs.appendFileSync(path.join(sets[0].folder,'RECOVERY_README.txt'),'corrupt');
  expect(f.engine.status().verifiedCount).toBe(3);expect(f.engine.status().unknownCount).toBe(1);
  const preview=await f.engine.preview();
  fs.appendFileSync(path.join(sets[1].folder,'RECOVERY_README.txt'),'corrupt after preview');
  await expect(f.engine.cleanup({preview})).rejects.toThrow(/inventory changed/);
  for(const set of sets)expect(fs.existsSync(set.folder)).toBe(true);
});

test('stable signing survives worker restarts; changed and missing secrets protect all sets',async()=>{
  const {MasterRetentionService}=await new Function('url','return import(url)')(pathToFileURL(path.resolve('backend/dist/server/masterRetentionService.js')).href);
  const f=fixture();const sets=[];
  for(let n=1;n<=4;n++)sets.push(await seed(f,`2026-10-0${n}T12:00:00.000Z`,'master_manual','',true));
  const first=new MasterRetentionService(f);
  try {for(const set of sets)await first.publish(set.id);} finally {await first.close();}
  for(const secret of ['changed-test-secret','']) {
    const next=new MasterRetentionService({...f,secret});
    try {
      expect((await next.status()).verifiedCount).toBe(0);
      const preview=await next.preview();expect(preview.verifiedCount).toBe(0);
      const result=await next.cleanup({preview}).catch((error:Error)=>error);
      expect(result instanceof Error || result.removed.length===0).toBe(true);
      for(const set of sets)expect(fs.existsSync(set.folder)).toBe(true);
    } finally {await next.close();}
  }
  const restarted=new MasterRetentionService(f);
  try {
    expect((await restarted.status()).unknownCount).toBe(4);
    const preview=await restarted.preview();expect(preview.verifiedCount).toBe(4);
    expect((await restarted.cleanup({preview})).removed).toEqual([sets[0].id]);
  } finally {await restarted.close();}
});

test('single worker keeps status responsive during verification and rejects overlapping deep scans',async()=>{
  const {MasterRetentionService}=await new Function('url','return import(url)')(pathToFileURL(path.resolve('backend/dist/server/masterRetentionService.js')).href);
  const f=fixture();await four(f);const service=new MasterRetentionService(f);
  try {
    await service.preview();const pending=service.preview();
    await expect(service.preview()).rejects.toThrow(/already running/);
    const statuses=await Promise.all(Array.from({length:20},()=>service.status()));
    expect(statuses.every(item=>item.verificationInProgress&&item.verifiedCount===4)).toBe(true);
    await pending;expect((await service.status()).verifiedCount).toBe(4);
  } finally {await service.close();}
});

test('application process restarts preserve stable signatures and authentication; missing or changed keys cannot prune',async({},testInfo)=>{
  test.setTimeout(180_000);
  const {backendFixture,owner,request}=await new Function('url','return import(url)')(pathToFileURL(path.resolve('tests/helpers/security-process.mjs')).href);
  const runtime=await backendFixture('k',{SESSION_SECRET:'stable-disposable-restart-key'},{lifetimeMs:180_000});
  try {
    const originalCookie=await owner(runtime.base);
    const baseline=await request(runtime.base,'/api/backup/master/cleanup/preview',{method:'POST',cookie:originalCookie,body:{},timeoutMs:60_000});
    expect(baseline.data.preview.verifiedCount).toBeGreaterThan(0);
    const masterRoot=path.join(runtime.env.MCC_BACKUPS_DIR,'MCC Master back up');
    const names=fs.readdirSync(masterRoot).sort();
    const receipts=Object.fromEntries(names.filter(name=>name.startsWith('.master-published-')).map(name=>[name,sha256FileSync(path.join(masterRoot,name))]));
    await runtime.close();
    for (const [label,secret] of [['stable','stable-disposable-restart-key'],['changed','changed-disposable-key'],['missing','']]) {
      const child=spawn(process.execPath,[path.join(runtime.appRoot,'backend/dist/server/index.js')],{cwd:runtime.appRoot,env:{...runtime.env,SESSION_SECRET:secret},windowsHide:true,stdio:['ignore','pipe','pipe']});
      let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
      const exited=new Promise<void>(resolve=>child.once('exit',()=>resolve()));
      const deadline=setTimeout(()=>child.kill('SIGKILL'),60_000);
      try {
        await expect.poll(async()=>{try{return (await fetch(runtime.base+'/api/health')).status;}catch{return 0;}},{timeout:30_000}).toBe(200);
        const oldSession=await request(runtime.base,'/api/backup/status',{cookie:originalCookie});
        expect(oldSession.response.status).toBe(label==='stable'?200:401);
        const login=await request(runtime.base,'/api/auth/login',{method:'POST',body:{email:'owner@example.test',password:'Local-Security-Test!9a'}});
        expect(login.response.status).toBe(200);expect(login.cookie).toBeTruthy();
        const preview=await request(runtime.base,'/api/backup/master/cleanup/preview',{method:'POST',cookie:login.cookie,body:{},timeoutMs:60_000});
        expect(preview.data.preview.verifiedCount).toBe(label==='stable'?baseline.data.preview.verifiedCount:0);
        if(label==='missing') {
          const cleanup=await request(runtime.base,'/api/backup/master/cleanup',{method:'POST',cookie:login.cookie,body:{token:preview.data.token,ids:[],confirmation:'DELETE 0 MASTER BACKUPS'}});
          expect(cleanup.response.status).toBe(409);
        }
        expect(fs.readdirSync(masterRoot).sort()).toEqual(names);
        for(const [name,hash] of Object.entries(receipts))expect(sha256FileSync(path.join(masterRoot,name))).toBe(hash);
      } finally {
        clearTimeout(deadline);
        if(child.exitCode===null&&child.signalCode===null) child.kill('SIGKILL');
        await exited;
        await testInfo.attach(`restart-${label}.log`,{body:output,contentType:'text/plain'});
      }
    }
  } finally {await runtime.close();}
});

test('representative backup benchmark records status, publication, rotation and event-loop latency',async({},testInfo)=>{
  test.setTimeout(600_000);
  const {MasterRetentionService}=await new Function('url','return import(url)')(pathToFileURL(path.resolve('backend/dist/server/masterRetentionService.js')).href);
  const f=fixture();const service=new MasterRetentionService(f);
  const bytes=testInfo.project.name==='desktop-chromium'?180*1024*1024:4*1024*1024;
  const sets=[];const creationMs=[];const publicationMs=[];const latencies:number[]=[];
  try {
    for(let n=1;n<=3;n++) {
      let start=performance.now();const set=await seed(f,`2026-10-0${n}T12:00:00.000Z`,'master_manual','',true,bytes);creationMs.push(performance.now()-start);sets.push(set);
      start=performance.now();await service.publish(set.id);publicationMs.push(performance.now()-start);
    }
    for(let n=0;n<30;n++) {const start=performance.now();expect((await service.status()).verifiedCount).toBe(3);latencies.push(performance.now()-start);}
    let maxTimerDelay=0,lastTick=performance.now();const timer=setInterval(()=>{const now=performance.now();maxTimerDelay=Math.max(maxTimerDelay,now-lastTick);lastTick=now;},10);
    let previewMs=0;
    try {
      const start=performance.now();const scan=service.preview();
      for(let n=0;n<30;n++) {const start=performance.now();expect((await service.status()).verificationInProgress).toBe(true);expect(performance.now()-start).toBeLessThan(250);}
      await scan;previewMs=performance.now()-start;
    } finally {clearInterval(timer);}
    const start=performance.now();const fourth=await seed(f,'2026-10-04T12:00:00.000Z','master_scheduled','',true,bytes);await service.publish(fourth.id);
    const rotation=await service.cleanup({preview:await service.preview(),automaticNewId:fourth.id});
    const createRotateMs=performance.now()-start;
    expect(rotation.removed).toEqual([sets[0].id]);expect(rotation.retained).toBe(3);
    expect(maxTimerDelay).toBeLessThan(1000);
    const evidence={platform:process.platform,arch:process.arch,node:process.version,payloadBytes:bytes,zipBytes:fs.statSync(fourth.archive).size,creationMs,publicationMs,statusSamples:latencies.length,statusMedianMs:[...latencies].sort((a,b)=>a-b)[15],statusMaxMs:Math.max(...latencies),previewMs,createRotateMs,maxTimerDelayMs:maxTimerDelay,physicalARM64Tested:false};
    console.log('Master benchmark',JSON.stringify(evidence));
    await testInfo.attach('master-retention-benchmark.json',{body:JSON.stringify(evidence,null,2),contentType:'application/json'});
  } finally {await service.close();}
});

test('preview protects safety, legacy, unknown, imported, external and changed sets',async()=>{
  const f=fixture();const sets=await four(f);
  for(const name of ['MCC_Master_Backup_legacy','Daily','Weekly','pre_restore','startup','deployment-recovery']) { fs.mkdirSync(path.join(f.masterRoot,name));fs.writeFileSync(path.join(f.masterRoot,name,'keep.txt'),'protected'); }
  for(const name of ['imported','external']) {fs.mkdirSync(path.join(f.root,name));fs.writeFileSync(path.join(f.root,name,'keep.zip'),'protected');}
  fs.writeFileSync(path.join(sets[0].folder,'unknown.txt'),'unverified');
  const preview=await f.engine.preview();expect(preview.verifiedCount).toBe(3);expect(preview.candidates).toHaveLength(0);
  expect((await f.engine.cleanup({preview})).removed).toEqual([]);
  for(const name of ['MCC_Master_Backup_legacy','Daily','Weekly','pre_restore','startup','deployment-recovery']) expect(fs.readFileSync(path.join(f.masterRoot,name,'keep.txt'),'utf8')).toBe('protected');
  for(const name of ['imported','external']) expect(fs.readFileSync(path.join(f.root,name,'keep.zip'),'utf8')).toBe('protected');
  await expect(f.engine.verify('../external')).rejects.toThrow();
});

for(const corruption of ['manifest','payload','sqlite','zip','zipPayload','sidecar','linkage','date','identity','missing']) test(`rejects ${corruption}; a bad new set never prunes prior valid sets`,async()=>{
  const f=fixture();const sets=await four(f);const newest=sets[3];
  if(corruption==='manifest')fs.writeFileSync(path.join(newest.folder,'manifest.json'),'{');
  if(corruption==='payload')fs.appendFileSync(path.join(newest.folder,'RECOVERY_README.txt'),'changed');
  if(corruption==='sqlite')fs.writeFileSync(path.join(newest.folder,'database/mcc.sqlite'),'corrupt');
  if(corruption==='zip')fs.writeFileSync(newest.archive,'bad zip');
  if(corruption==='zipPayload') {
    const entry=inspectPortableArchive(newest.archive).entries.find(entry=>!entry.directory&&entry.compressedSize>4)!;
    const bytes=fs.readFileSync(newest.archive);const offset=entry.localHeaderOffset+30+bytes.readUInt16LE(entry.localHeaderOffset+26)+bytes.readUInt16LE(entry.localHeaderOffset+28);
    bytes[offset+2]^=1;fs.writeFileSync(newest.archive,bytes);fs.writeFileSync(`${newest.archive}.sha256`,`${sha256FileSync(newest.archive)}  ${path.basename(newest.archive)}\n`);
  }
  if(corruption==='sidecar')fs.writeFileSync(`${newest.archive}.sha256`,'incorrect');
  if(corruption==='missing')fs.unlinkSync(`${newest.archive}.sha256`);
  if(['linkage','date','identity'].includes(corruption)) {
    const manifest={...newest.manifest};
    if(corruption==='linkage')manifest.portableArchive={...manifest.portableArchive,filename:'../external.zip'};
    if(corruption==='date')manifest.createdAt='2030-01-01T00:00:00.000Z';
    if(corruption==='identity')manifest.backupId=sets[0].id;
    fs.writeFileSync(path.join(newest.folder,'manifest.json'),JSON.stringify(manifest));
  }
  await expect(f.engine.cleanup({preview:await f.engine.preview(),automaticNewId:newest.id})).rejects.toThrow();
  for(const set of sets.slice(0,3))expect((await f.engine.verify(set.id)).verified).toBe(true);
});

test('changed confirmation and shared archive ownership cannot delete a set',async()=>{
  const f=fixture();const sets=await four(f);const preview=await f.engine.preview();
  fs.appendFileSync(`${sets[0].archive}.sha256`,'changed');
  await expect(f.engine.cleanup({preview})).rejects.toThrow(/inventory changed/);
  expect(fs.existsSync(sets[0].folder)).toBe(true);
  const duplicate=path.join(f.masterRoot,'legacy-duplicate');fs.mkdirSync(duplicate);
  fs.writeFileSync(path.join(duplicate,'manifest.json'),JSON.stringify(sets[1].manifest));
  await expect(f.engine.verify(sets[1].id)).rejects.toThrow(/shared/);
});

test('publication receipt excludes failed attempts until complete verified publication',async()=>{
  const f=fixture();for(let n=1;n<=3;n++)await seed(f,`2026-10-0${n}T12:00:00.000Z`);
  const next=await seed(f,'2026-10-04T12:00:00.000Z','master_manual','',true);
  expect((await f.engine.preview()).verifiedCount).toBe(3);
  await expect(f.engine.verify(next.id)).rejects.toThrow();
  await f.engine.publish(next.id);expect((await f.engine.preview()).verifiedCount).toBe(4);
  const result=await f.engine.cleanup({preview:await f.engine.preview(),automaticNewId:next.id});expect(result.removed).toHaveLength(1);expect(result.retained).toBe(3);
});

test('partial unlink failure is observable and resumes safely after restart',async()=>{
  const f=fixture();const sets=await four(f);const unlink=fs.unlinkSync;let calls=0;
  fs.unlinkSync=function(filename){if(++calls===2)throw new Error('Injected permission failure');return unlink(filename);};
  try {
    const result=await f.engine.cleanup({preview:await f.engine.preview()});
    expect(result.failed).toHaveLength(1);expect(result.removed).toHaveLength(0);expect(result.pending).toBe(1);expect(result.retained).toBe(3);
  } finally {fs.unlinkSync=unlink;}
  for(const secret of ['changed-journal-key','']) {
    const untrusted=new MasterRetention({...f,secret});
    await expect(untrusted.cleanup({preview:await untrusted.preview()})).rejects.toThrow(/Untrusted|SESSION_SECRET/);
    expect(fs.existsSync(sets[0].folder)).toBe(true);
  }
  const restarted=new MasterRetention(f);const preview=await restarted.preview();expect(preview.pending).toHaveLength(1);
  const result=await restarted.cleanup({preview});expect(result.removed).toEqual([sets[0].id]);expect(result.pending).toBe(0);
  for(const set of sets.slice(1))expect((await restarted.verify(set.id)).verified).toBe(true);
});

test('interrupted cleanup refuses changed leftovers and tampered journals',async()=>{
  const f=fixture();const sets=await four(f);const unlink=fs.unlinkSync;
  fs.unlinkSync=function(){throw new Error('Injected access denied');};
  try {expect((await f.engine.cleanup({preview:await f.engine.preview()})).failed).toHaveLength(1);} finally {fs.unlinkSync=unlink;}
  fs.writeFileSync(path.join(sets[0].folder,'keep-new.txt'),'unrelated');
  const stopped=await new MasterRetention(f).cleanup({preview:await f.engine.preview()});expect(stopped.failed).toHaveLength(1);
  expect(fs.readFileSync(path.join(sets[0].folder,'keep-new.txt'),'utf8')).toBe('unrelated');
  const journal=(await f.engine.preview()).pending[0].journal;fs.appendFileSync(path.join(f.masterRoot,journal),'bad');
  await expect(f.engine.cleanup({preview:await f.engine.preview()})).rejects.toThrow(/Untrusted/);
});

test('directory junction and hard-link escape are refused without touching targets',async()=>{
  const f=fixture();const sets=await four(f);const outside=path.join(f.root,'outside');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'keep.txt'),'safe');
  const junction=path.join(sets[0].folder,'files','escape');
  fs.symlinkSync(outside,junction,'junction');
  try {await expect(f.engine.verify(sets[0].id)).rejects.toThrow(/link/i);} finally {fs.unlinkSync(junction);}
  const hardlink=path.join(sets[0].folder,'files','hard-link');fs.linkSync(path.join(outside,'keep.txt'),hardlink);
  try {await expect(f.engine.verify(sets[0].id)).rejects.toThrow(/hard-linked/);} finally {fs.unlinkSync(hardlink);}
  expect(fs.readFileSync(path.join(outside,'keep.txt'),'utf8')).toBe('safe');
});

test('real manual creation rotates a scheduled/manual mix; retained downloads and restores succeed',async({},testInfo)=>{
  test.setTimeout(180_000);
  const {backendFixture,owner}=await new Function('url','return import(url)')(pathToFileURL(path.resolve('tests/helpers/security-process.mjs')).href);
  const runtime=await backendFixture('m',{}, {observeBackupFaults:true,lifetimeMs:180_000});
  const call=async(url:string,body?:unknown,cookie='')=>{
    const response=await fetch(runtime.base+url,{method:body===undefined?'GET':'POST',headers:{cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(60_000)});
    return {status:response.status,data:await response.json()};
  };
  try {
    let cookie=await owner(runtime.base);
    const masterRoot=path.join(runtime.env.MCC_BACKUPS_DIR,'MCC Master back up');
    // Startup's real scheduled path runs on the managed calendar date.
    const initial=await call('/api/backup/list?category=master',undefined,cookie);
    expect(initial.status).toBe(200);
    expect(initial.data.backups.some((backup:any)=>backup.type==='master_scheduled')).toBe(true);
    const simultaneous=await Promise.all([call('/api/backup/create',{category:'master'},cookie),call('/api/backup/create',{category:'master'},cookie)]);
    expect(simultaneous.map(result=>result.status).sort()).toEqual([201,409]);
    const created=[];
    for(let n=0;n<5;n++) {
      const result=await call('/api/backup/create',{category:'master'},cookie);expect(result.status,JSON.stringify(result.data)).toBe(201);
      created.push(result.data.backup);expect(result.data.status.master.retention.verifiedCount).toBeLessThanOrEqual(3);
    }
    const retained=created.slice(-3);
    for(const backup of created.slice(0,2))expect(fs.existsSync(path.join(masterRoot,backup.id))).toBe(false);
    const baseline=await call('/api/backup/master/cleanup/preview',{},cookie);expect(baseline.data.preview.verifiedCount).toBe(3);
    fs.writeFileSync(runtime.env.MCC_TEST_BACKUP_FAULTS,JSON.stringify({fault:'status_io'}));
    try {
      for(let n=0;n<5;n++) {
        const status=await call('/api/backup/status',undefined,cookie);
        expect(status.status,JSON.stringify(status.data)).toBe(200);
        expect(status.data.master.retention.verifiedCount).toBe(3);
      }
    } finally {fs.writeFileSync(runtime.env.MCC_TEST_BACKUP_FAULTS,'{}');}
    fs.writeFileSync(runtime.env.MCC_TEST_BACKUP_FAULTS,JSON.stringify({fault:'slow_verification'}));
    const scanning=call('/api/backup/master/cleanup/preview',{},cookie);
    try {
      await expect.poll(()=>fs.existsSync(`${runtime.env.MCC_TEST_BACKUP_FAULTS}.started`)).toBe(true);
      const start=performance.now();
      const [health,status,overlap]=await Promise.all([
        call('/api/health',undefined,cookie),call('/api/backup/status',undefined,cookie),call('/api/backup/master/cleanup/preview',{},cookie),
      ]);
      expect(performance.now()-start).toBeLessThan(2000);
      expect(health.status).toBe(200);expect(status.status).toBe(200);
      expect(status.data.master.retention.verificationInProgress).toBe(true);expect(overlap.status).toBe(409);
    } finally {await scanning;fs.writeFileSync(runtime.env.MCC_TEST_BACKUP_FAULTS,'{}');}
    // API enforcement applies to ordinary Admin as well as Owner Admin, and
    // never grants cleanup rights to Manager or technician accounts.
    for(const [name,role] of [['manager','Manager'],['tech','Maintenance Tech 3'],['admin','Admin']]) {
      const added=await call('/api/users',{fullName:name,email:`${name}@example.test`,role,temporaryPassword:'Local-Security-Test!9a'},cookie);expect(added.status).toBe(201);
      const login=await fetch(runtime.base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:`${name}@example.test`,password:'Local-Security-Test!9a'})});const userCookie=login.headers.get('set-cookie')!.split(';')[0];
      expect((await call('/api/backup/master/cleanup/preview',{},userCookie)).status).toBe(name==='admin'?200:403);
      if(name!=='admin')expect((await call('/api/backup/master/cleanup',{},userCookie)).status).toBe(403);
    }
    const seeded=await seed({masterRoot,portableRoot:path.join(runtime.env.MCC_BACKUPS_DIR,'portable')} as ReturnType<typeof fixture>,'2026-01-01T12:00:00.000Z');
    const beforeCleanup=await call('/api/backup/master/cleanup/preview',{},cookie);
    const confirmation={token:beforeCleanup.data.token,ids:[seeded.id],confirmation:'DELETE 1 MASTER BACKUPS'};
    expect((await call('/api/backup/master/cleanup',{...confirmation,ids:['../external']},cookie)).status).toBe(409);
    fs.mkdirSync(path.join(masterRoot,'protected-new-entry'));
    expect((await call('/api/backup/master/cleanup',confirmation,cookie)).status).toBe(409);
    const fresh=await call('/api/backup/master/cleanup/preview',{},cookie);
    const cleaned=await call('/api/backup/master/cleanup',{...confirmation,token:fresh.data.token},cookie);expect(cleaned.status).toBe(200);expect(cleaned.data.removed).toEqual([seeded.id]);
    expect((await call('/api/backup/master/cleanup',{...confirmation,token:fresh.data.token},cookie)).status).toBe(409);
    const hashes=Object.fromEntries(retained.map(backup=>[backup.id,sha256FileSync(path.join(masterRoot,backup.id,'manifest.json'))]));
    for(const fault of ['snapshot','sqlite','manifest','zip','publication','zip_verify']) {
      fs.writeFileSync(runtime.env.MCC_TEST_BACKUP_FAULTS,JSON.stringify({fault}));
      const failed=await call('/api/backup/create',{category:'master'},cookie);expect(failed.status,fault).toBe(500);
      fs.writeFileSync(runtime.env.MCC_TEST_BACKUP_FAULTS,'{}');
      for(const backup of retained)expect(sha256FileSync(path.join(masterRoot,backup.id,'manifest.json'))).toBe(hashes[backup.id]);
    }
    // Enabled external-copy failure preserves every prior verified set and the
    // incomplete new attempt cannot enter the retention count.
    const external=path.join(runtime.fixture,'external');
    const configured=await fetch(runtime.base+'/api/backup/external',{method:'PUT',headers:{cookie,'Content-Type':'application/json'},body:JSON.stringify({enabled:true,destination:external})});expect(configured.status).toBe(200);
    fs.writeFileSync(runtime.env.MCC_TEST_BACKUP_FAULTS,JSON.stringify({fault:'external'}));
    const externalFailure=await call('/api/backup/create',{category:'master'},cookie);
    expect(externalFailure.status).toBe(201);expect(externalFailure.data.status.lastBackupResult.ok).toBe(false);
    fs.writeFileSync(runtime.env.MCC_TEST_BACKUP_FAULTS,'{}');
    for(const backup of retained)expect(sha256FileSync(path.join(masterRoot,backup.id,'manifest.json'))).toBe(hashes[backup.id]);
    await fetch(runtime.base+'/api/backup/external',{method:'PUT',headers:{cookie,'Content-Type':'application/json'},body:JSON.stringify({enabled:false,destination:external})});
    expect((await call('/api/backup/master/cleanup/preview',{},cookie)).data.preview.verifiedCount).toBe(3);
    for(const backup of retained) {
      expect((await call('/api/backup/verify',{category:'master',backupId:backup.id},cookie)).data.ok).toBe(true);
      const download=await fetch(`${runtime.base}/api/backup/portable/${backup.id}/download`,{headers:{cookie}});expect(download.status).toBe(200);expect((await download.arrayBuffer()).byteLength).toBeGreaterThan(0);
      const restored=await call('/api/backup/restore',{category:'master',backupId:backup.id,confirmation:'RESTORE MCC'},cookie);expect(restored.status,JSON.stringify(restored.data)).toBe(200);
      const login=await fetch(runtime.base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'owner@example.test',password:'Local-Security-Test!9a'})});cookie=login.headers.get('set-cookie')!.split(';')[0];
    }
    const db=new DatabaseSync(path.join(runtime.env.MCC_DATA_DIR,'mcc.sqlite'),{readOnly:true});
    try {expect(db.prepare('PRAGMA integrity_check').get()!.integrity_check).toBe('ok');expect(db.prepare("SELECT COUNT(*) AS n FROM users").get()!.n).toBeGreaterThan(0);} finally {db.close();}
    const manifests=fs.readdirSync(masterRoot).filter(name=>fs.existsSync(path.join(masterRoot,name,'manifest.json'))).map(name=>JSON.parse(fs.readFileSync(path.join(masterRoot,name,'manifest.json'),'utf8')));
    expect(manifests.filter(manifest=>manifest.backupType==='pre_restore').length).toBeGreaterThanOrEqual(3);
    fs.writeFileSync(runtime.env.MCC_TEST_BACKUP_FAULTS,JSON.stringify({fault:'monthly'}));
    await expect.poll(()=>runtime.output(),{timeout:30_000}).not.toContain('MCC monthly master backup failed:');
    // Completion receipts are published after the real scheduled create path.
    await expect.poll(()=>fs.readdirSync(masterRoot).filter(name=>name.startsWith('.master-published-')&&name.endsWith('_master_scheduled.json')).length,{timeout:30_000}).toBe(1);
    fs.writeFileSync(runtime.env.MCC_TEST_BACKUP_FAULTS,'{}');
    const relogin=await fetch(runtime.base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'owner@example.test',password:'Local-Security-Test!9a'})});cookie=relogin.headers.get('set-cookie')!.split(';')[0];
    await expect.poll(async()=>{const result=await call('/api/backup/master/cleanup/preview',{},cookie);return result.status===200?result.data.preview.verifiedCount:0;},{timeout:30_000}).toBe(3);
    expect(fs.existsSync(path.join(masterRoot,retained[0].id))).toBe(false);
    for(const backup of retained.slice(1))expect(fs.existsSync(path.join(masterRoot,backup.id))).toBe(true);
    await testInfo.attach('retention-api-evidence',{body:JSON.stringify({retained:retained.map(item=>item.id),failureStages:['snapshot','sqlite','manifest','zip','publication','zip_verify'],restored:3},null,2),contentType:'application/json'});
  } finally {await runtime.close();}
});
