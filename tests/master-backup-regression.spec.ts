import { test } from '@playwright/test';
import { spawn } from 'node:child_process';
import path from 'node:path';

// These existing Node regressions inherit the managed runner's storage and
// process registry, so ZIP/database/import/restore writes never use live data.
for(const script of ['release-backup-readiness.mjs','portable-master-backup.mjs']) test(script,async({},testInfo)=>{
  test.setTimeout(180_000);
  if(!process.env.MCC_PLAYWRIGHT_RUN_ID)throw new Error('Managed runner required');
  const child=spawn(process.execPath,[path.resolve('tests',script)],{env:process.env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
  const exited=new Promise<number|null>((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);});
  const timeout=setTimeout(()=>child.kill(),170_000);
  try { const code=await exited;if(code!==0)throw new Error(`${script} failed (${code})\n${output}`); }
  finally {clearTimeout(timeout);if(child.exitCode===null){child.kill();await exited;}await testInfo.attach(`${script}-log`,{body:output,contentType:'text/plain'});}
});
