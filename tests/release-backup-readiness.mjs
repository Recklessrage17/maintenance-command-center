import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {backendFixture,owner,request,pause} from './helpers/security-process.mjs';
const runtime=await backendFixture('release-backup-retention',{MCC_PORTABLE_BACKUP_MAX_MB:'1'});
try {
 const cookie=await owner(runtime.base);
 const first=await request(runtime.base,'/api/backup/create',{method:'POST',cookie,body:{category:'master'}});
 assert.equal(first.response.status,201);assert.equal(first.data.backup.portableReady,true);
 const backup=first.data.backup,archive=path.join(runtime.env.MCC_BACKUPS_DIR,'portable',backup.portableArchiveFilename);
 const fd=fs.openSync(archive,'r+'),original=Buffer.alloc(1);fs.readSync(fd,original,0,1,40);fs.writeSync(fd,Buffer.from([original[0]^1]),0,1,40);fs.closeSync(fd);
 const list=await request(runtime.base,'/api/backup/list?category=master',{cookie});
 assert.equal(list.data.backups.find(b=>b.id===backup.id).portableReady,false,'Readable central directory must not hide changed archive bytes');
 const restore=fs.openSync(archive,'r+');fs.writeSync(restore,original,0,1,40);fs.closeSync(restore);
 // Seed old local-only packages to exercise the real retention path in one
 // backup transaction, without making thirty redundant application backups.
 const directory=path.join(runtime.env.MCC_BACKUPS_DIR,'MCC Master back up'),source=path.join(directory,backup.id);
 for(let n=0;n<33;n++){
  const id=`${backup.id}-local-${n}`,target=path.join(directory,id);fs.cpSync(source,target,{recursive:true});
  const filename=path.join(target,'manifest.json'),manifest=JSON.parse(fs.readFileSync(filename));
  manifest.createdAt=new Date(Date.now()+1000+n).toISOString();delete manifest.portableArchive;
  fs.writeFileSync(filename,JSON.stringify(manifest));
 }
 fs.writeFileSync(path.join(runtime.env.MCC_UPLOADS_DIR,'too-large.bin'),crypto.randomBytes(2*1024**2));
 for(let n=0;n<2;n++){
  await pause(1100); // Production backup folder names have one-second precision.
  const next=await request(runtime.base,'/api/backup/create',{method:'POST',cookie,body:{category:'master'}});
  assert.equal(next.response.status,201,JSON.stringify(next.data));assert.equal(next.data.backup.portableReady,false);
  assert.ok(fs.existsSync(archive),'Prior verified recovery unit retained');
  const remaining=(await request(runtime.base,'/api/backup/list?category=master',{cookie})).data.backups.filter(b=>b.type==='master_manual');
  assert.ok(remaining.length<=31,'Thirty local packages plus at most one protected verified unit');
  assert.ok(remaining.some(b=>b.id===backup.id&&b.portableReady));
 }
 console.log(JSON.stringify({status:'pass',checks:8,coverage:['corrupted readiness','bounded repeated failed retention','prior verified archive retained']}));
} finally {await runtime.close();}
