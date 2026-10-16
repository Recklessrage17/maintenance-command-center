import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {candidate,packageRoot,evidence,native,local,write,isolatedEnvironment} from './config.mjs';
if(!local)assert.ok(native,'Refusing to label a non-native run as ARM64 evidence.');
const suites=['machine-retirement-archive-api.mjs','pm-history-report-api.mjs','portable-recovery-readiness.mjs','portable-master-backup.mjs','external-uploads-api.mjs','backend-upload-security-regression.mjs','pm-workflow-upgrade.mjs','pm-work-order-attachments.mjs','password-permissions-api.mjs','authentication-password-change-regression.mjs','issue-174-inspection-records-api.mjs','system-update-api.mjs'];
suites.push('release-backup-readiness.mjs');
const requested=process.argv.slice(2).filter(a=>a!=='--local');for(const suite of requested)assert.ok(suites.includes(suite),'Only reviewed suite filenames are allowed.');
fs.mkdirSync(evidence,{recursive:true});const tempBase=process.platform==='win32'?path.resolve(packageRoot,'../t'):evidence;fs.mkdirSync(tempBase,{recursive:true});const root=fs.mkdtempSync(path.join(tempBase,'r-')),results=[];
for(const suite of requested.length?requested:suites){
 const env=isolatedEnvironment(path.join(root,String(results.length)));
 // Older suites deliberately use PM paths derived from their own data fixture.
 // Do not shadow those with a parent's PM roots. Newer fixtures set all roots.
 delete env.MCC_PM_EXCEL_DIR;delete env.MCC_PM_WORK_ORDER_DIR;
 const started=Date.now(),file=path.join(candidate,'tests',suite),log=fs.openSync(path.join(evidence,`${suite}.log`),'wx');
 const time=process.platform==='linux'&&fs.existsSync('/usr/bin/time');
 const command=time?'/usr/bin/time':process.execPath,args=time?['-v','-o',path.join(evidence,`${suite}.time.txt`),process.execPath,file]:[file];
 const child=spawn(command,args,{cwd:candidate,env,stdio:['ignore',log,log],windowsHide:true,detached:process.platform==='linux'});
 const timer=setTimeout(()=>{if(process.platform==='linux')process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');},240000);
 const outcome=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});clearTimeout(timer);fs.closeSync(log);
 results.push({suite,...outcome,elapsedMs:Date.now()-started,native});write('suites.json',{status:outcome.code===0?'running':'fail',native,results});
 assert.equal(outcome.code,0,`${suite} failed; see retained isolated log. No failed suite is converted to a skip.`);console.log(`PASS ${suite} (${Date.now()-started} ms)`);
}
write('suites.json',{status:'pass',native,results});
