import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {DatabaseSync} from 'node:sqlite';
import {execFileSync} from 'node:child_process';
import {candidate,candidateSha,evidence,native,local,write} from './config.mjs';
assert.equal(process.versions.node.split('.')[0],'22');
if(!local)assert.ok(native,'Native Linux ARM64 is required; emulation/Windows/x64 is not native evidence.');
const actual=execFileSync('git',['-C',candidate,'rev-parse','HEAD'],{encoding:'utf8'}).trim();assert.equal(actual,candidateSha);
for(const file of['package.json','package-lock.json','frontend/package.json','frontend/package-lock.json','backend/package.json','backend/package-lock.json']){const value=JSON.parse(fs.readFileSync(path.join(candidate,file)));assert.equal(value.version,'2.0.0');for(const key of['','..'])if(value.packages?.[key]?.version)assert.equal(value.packages[key].version,'2.0.0');}
const payload=crypto.randomBytes(65536),compressed=zlib.deflateSync(payload);assert.deepEqual(zlib.inflateSync(compressed),payload);
fs.mkdirSync(evidence,{recursive:true});const filename=path.join(evidence,`runtime-${process.pid}.sqlite`),db=new DatabaseSync(filename);
db.exec('PRAGMA journal_mode=WAL; CREATE TABLE verification(id INTEGER PRIMARY KEY, value BLOB);');db.prepare('INSERT INTO verification VALUES (?,?)').run(7,payload);assert.deepEqual(Buffer.from(db.prepare('SELECT value FROM verification WHERE id=7').get().value),payload);assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);const sqlite=db.prepare('SELECT sqlite_version() AS version').get().version;db.close();
function command(binary,args){try{return execFileSync(binary,args,{encoding:'utf8',timeout:5000}).trim();}catch(error){return `NOT VERIFIED: ${error.message.split('\n')[0]}`;}}
write('runtime.json',{status:'pass',nativeCompatibility:native?'VERIFIED FOR THIS RUNTIME ONLY':'NOT VERIFIED',localPreparationOnly:local,candidate:actual,platform:process.platform,architecture:process.arch,node:process.version,versions:process.versions,sqlite,zlibRoundTrip:true,cpu:os.cpus().map(c=>({model:c.model,speedMHz:c.speed})),logicalCpuCount:os.availableParallelism(),memoryBytes:os.totalmem(),disk:fs.statfsSync(evidence),linux:native?{uname:command('uname',['-a']),lscpu:command('lscpu',['--json']),osRelease:fs.readFileSync('/etc/os-release','utf8'),memory:command('free',['-b']),disk:command('df',['-B1',evidence]),cgroup:fs.readFileSync('/proc/self/cgroup','utf8')}:null});
console.log(`Runtime/SQLite/zlib checks passed; native Linux ARM64: ${native?'yes':'NOT VERIFIED'}`);
