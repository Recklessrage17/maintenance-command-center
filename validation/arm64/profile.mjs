import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {candidate,evidence,native,local,moduleFrom,write} from './config.mjs';
if(!local)assert.ok(native,'Native ARM64 profile required.');
fs.mkdirSync(evidence,{recursive:true});
const {backendFixture,owner,request,password,freePort,pause}=await moduleFrom('tests/helpers/security-process.mjs');
const {seedMachineHistory,digest}=await moduleFrom('tests/helpers/machine-archive-data.mjs');
const {seedPmReportHistory}=await moduleFrom('tests/helpers/pm-history-report-data.mjs');
const runtime=await backendFixture('arm64-bounded-profile',{}, {serveFrontend:true});
await owner(runtime.base);await runtime.close();
const metrics=path.join(evidence,`application-memory-${Date.now()}.jsonl`),port=await freePort(),base=`http://127.0.0.1:${port}`;
const env={...runtime.env,PORT:String(port),MCC_ARM64_PROFILE_ROOT:evidence,MCC_ARM64_PROFILE_FILE:metrics};
const child=spawn(process.execPath,['--max-old-space-size=512','--import',new URL('./resource-preload.mjs',import.meta.url).href,path.join(runtime.appRoot,'backend/dist/server/index.js')],{cwd:runtime.appRoot,env,stdio:['ignore','pipe','pipe'],windowsHide:true});
let log='',db;const responses=[];for(const stream of[child.stdout,child.stderr])stream.on('data',b=>log+=b);
async function timed(label,url,{method='GET',cookie='',body}={}){const at=performance.now(),response=await fetch(base+url,{method,headers:{Cookie:cookie,...body?{'Content-Type':'application/json'}:{}},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(120000)});const bytes=Buffer.from(await response.arrayBuffer());assert.ok(response.ok,`${label}: ${response.status} ${bytes.toString().slice(0,200)}`);responses.push({label,status:response.status,ms:performance.now()-at,bytes:bytes.length,sha256:digest(bytes)});return {bytes,data:response.headers.get('content-type')?.includes('application/json')?JSON.parse(bytes):null};}
try{
 for(let i=0;i<150;i++){assert.equal(child.exitCode,null,log);try{if((await fetch(base+'/api/health',{signal:AbortSignal.timeout(500)})).ok)break;}catch{}await pause(100);}
 const login=await request(base,'/api/auth/login',{method:'POST',body:{email:'owner@example.test',password}});assert.equal(login.response.status,200);const cookie=login.cookie;
 const assets={};async function createAssets(library){for(const other of[false,true]){const key=library+(other?'Other':'');const r=await request(base,`/api/${library}-library/assets`,{method:'POST',cookie,body:{assetNumber:`ARM-${key}`,assetName:'Bounded synthetic profile',equipmentName:'Bounded profile dryer',brand:'MCC QA',manufacturer:'MCC QA',category:'Dryer'}});assert.equal(r.response.status,201);assets[key]=r.data.asset;}}await createAssets('machine');
 db=new DatabaseSync(path.join(runtime.env.MCC_DATA_DIR,'mcc.sqlite'));
 const graph=seedMachineHistory(db,runtime,assets.machineOther.id,assets.machine.id);await createAssets('equipment');const groups=await seedPmReportHistory(db,runtime,assets);
 const originals=graph.payloads.map(f=>({file:f.destination,sha256:f.sha256}));
 for(const[name,bytes]of[['repetitive-16MiB.txt',Buffer.alloc(16*1024**2,65)],['random-16MiB.bin',crypto.randomBytes(16*1024**2)]]){const file=path.join(runtime.env.MCC_UPLOADS_DIR,name);fs.writeFileSync(file,bytes);originals.push({file,sha256:digest(bytes)});}
 const archived=await request(base,`/api/machine-library/assets/${assets.machineOther.id}/lifecycle`,{method:'POST',cookie,body:{lifecycleStatus:'archived',expectedRevision:0,retirementReason:'replaced',replacementMachineId:assets.machine.id}});assert.equal(archived.response.status,200);
 await timed('health-before','/api/health');
 const history=await timed('history-zip',`/api/machine-library/assets/${assets.machineOther.id}/history-export.zip`,{cookie});assert.equal(history.bytes.subarray(0,2).toString(),'PK');
 for(const library of['machine','equipment']){const report=await timed(`${library}-pm-pdf`,`/api/${library}-library/assets/${assets[library].id}/preventive-maintenance/history/report.pdf`,{method:'POST',cookie,body:{completionIds:groups[library].records.slice(0,3).map(r=>r.id)}});assert.equal(report.bytes.subarray(0,5).toString(),'%PDF-');}
 const backup=await timed('master-backup-create','/api/backup/create',{method:'POST',cookie,body:{category:'master'}});assert.equal(backup.data.backup.portableReady,true);
 const downloaded=await timed('portable-download',`/api/backup/portable/${encodeURIComponent(backup.data.backup.id)}/download`,{cookie});const archive=path.join(runtime.env.MCC_BACKUPS_DIR,'portable',backup.data.backup.portableArchiveFilename);assert.equal(digest(downloaded.bytes),digest(fs.readFileSync(archive)));
 await timed('health-after','/api/health');for(const f of originals)assert.equal(digest(fs.readFileSync(f.file)),f.sha256);assert.equal(db.prepare('SELECT lifecycle_status FROM machine_assets WHERE id=?').get(assets.machineOther.id).lifecycle_status,'archived');assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);db.close();db=null;
 await pause(250);
 const samples=fs.readFileSync(metrics,'utf8').trim().split('\n').map(JSON.parse),peak=key=>Math.max(...samples.map(s=>s.memory[key]));
 function bytesUnder(dir){return fs.readdirSync(dir,{withFileTypes:true}).reduce((sum,e)=>{const file=path.join(dir,e.name);return sum+(e.isSymbolicLink()?0:e.isDirectory()?bytesUnder(file):fs.statSync(file).size);},0);}
 write('profile.json',{status:'pass',native,scope:'One isolated application; sequential bounded jobs, not multi-user or Pi performance acceptance',payloadMiB:32,pmReportRowsPerLibrary:3,applicationHeapLimitMiB:512,sampleIntervalMs:200,samples:samples.length,peaks:{rssBytes:peak('rss'),heapUsedBytes:peak('heapUsed'),heapTotalBytes:peak('heapTotal'),externalBytes:peak('external'),arrayBufferBytes:peak('arrayBuffers')},cpuMicroseconds:samples.at(-1).cpu,responses,syntheticRuntimeBytes:bytesUnder(runtime.fixture),originalHashesVerified:originals.length,originalMachineId:assets.machineOther.id,pmHistoryId:graph.historyId,memoryLimitBytes:process.env.MCC_ARM64_MEMORY_LIMIT_BYTES||null,memoryLimitInterpretation:'Only a reported/enforced cgroup limit is a 4 GiB envelope. A heap limit alone is not a total-memory cap. Runner CPU, RAM bandwidth, SSD, kernel and thermal/power behavior differ from Pi.'});
 console.log(`Bounded profile passed: ${responses.length} responses, ${samples.length} RSS/heap samples; native ARM64=${native}`);
}finally{db?.close();if(child.exitCode===null){const stopped=new Promise(r=>child.once('exit',r));child.kill();const timer=setTimeout(()=>child.kill('SIGKILL'),3000);await stopped;clearTimeout(timer);}fs.writeFileSync(path.join(evidence,'profile-application.log'),log);}
