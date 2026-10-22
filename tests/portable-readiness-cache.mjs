import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createPortableArchive} from '../backend/dist/server/portableBackup.js';
import {verifyPortableReadiness} from '../backend/dist/server/portableReadiness.js';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'mcc-readiness-'));
const originalStream=fs.createReadStream;
try {
 const payload=path.join(root,'payload');fs.mkdirSync(payload);
 for(const folder of ['files/uploads','database','recovery'])fs.mkdirSync(path.join(payload,folder),{recursive:true});
 fs.writeFileSync(path.join(payload,'files/uploads/original.bin'),crypto.randomBytes(8*1024**2));
 // Structural ZIP fixture only; full schema/restore acceptance is separate.
 for(const file of ['manifest.json','RECOVERY_README.txt','database/mcc.sqlite','recovery/restore-manifest.json'])fs.writeFileSync(path.join(payload,file),'fixture');
 const archive=path.join(root,'portable.zip');
 const created=await createPortableArchive(payload,archive,'MCC_Master_Backup_2026-10-16_00-00-00');
 fs.writeFileSync(`${archive}.sha256`,created.sha256+'  portable.zip\n');
 let streams=0,ticks=0;
 fs.createReadStream=function(filename,options){if(filename===archive)streams++;return originalStream.call(fs,filename,{...options,highWaterMark:4096});};
 const timer=setInterval(()=>ticks++,0);
 await Promise.all([verifyPortableReadiness(archive,32*1024**2),verifyPortableReadiness(archive,32*1024**2)]);
 clearInterval(timer);
 assert.equal(streams,1,'Concurrent readers share one streamed hash');
 assert.ok(ticks>0,'Hashing yields the event loop for other requests');
 await verifyPortableReadiness(archive,32*1024**2);
 assert.equal(streams,1,'Unchanged listings do not reread ZIP payloads');
 const offset=Math.floor(fs.statSync(archive).size/2),fd=fs.openSync(archive,'r+'),byte=Buffer.alloc(1);
 fs.readSync(fd,byte,0,1,offset);fs.writeSync(fd,Buffer.from([byte[0]^1]),0,1,offset);fs.closeSync(fd);
 await assert.rejects(verifyPortableReadiness(archive,32*1024**2),/checksum mismatch/);
 assert.equal(streams,2,'Changed payload is rehashed and refused');
 const repair=fs.openSync(archive,'r+');fs.writeSync(repair,byte,0,1,offset);fs.closeSync(repair);
 await verifyPortableReadiness(archive,32*1024**2);
 fs.writeFileSync(`${archive}.sha256`,'0'.repeat(64)+'  portable.zip\n');
 await assert.rejects(verifyPortableReadiness(archive,32*1024**2),/checksum mismatch/);
 fs.writeFileSync(`${archive}.sha256`,created.sha256+'  portable.zip\n');
 await verifyPortableReadiness(archive,32*1024**2);
 await assert.rejects(verifyPortableReadiness(archive,1024),/compressed-size limit/);
 console.log(JSON.stringify({status:'pass',checks:7,coverage:['shared cold stream','event loop yields','warm cache','payload tamper refusal','repair invalidates failed cache','sidecar invalidation','limits form part of cache key']}));
} finally {fs.createReadStream=originalStream;fs.rmSync(root,{recursive:true,force:true});}
