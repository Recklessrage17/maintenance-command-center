import {test,expect} from '@playwright/test';
import {execFile} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {root} from './helpers/security-process.mjs';

for(const script of ['requisition-status-api.mjs','inventory-obsolete-api.mjs','dashboard-inventory-attention-api.mjs']) {
  test(`Patch 1 existing API regression: ${script}`,async({},info)=>{
    test.setTimeout(180000);
    const log=info.outputPath('api.log');
    const result=await new Promise<{code:number;output:string}>(resolve=>{
      execFile(process.execPath,[path.join(root,'tests',script)],{cwd:root,windowsHide:true,timeout:150000,maxBuffer:16*1024*1024,
        env:{...process.env,MCC_PDF_QA_DIR:info.outputPath('pdf')}},(error,stdout,stderr)=>resolve({code:error?Number(error.code)||1:0,output:stdout+stderr}));
    });
    fs.writeFileSync(log,result.output);await info.attach('API regression output',{path:log,contentType:'text/plain'});
    console.log(result.output);
    expect(result.code,result.output).toBe(0);
  });
}
