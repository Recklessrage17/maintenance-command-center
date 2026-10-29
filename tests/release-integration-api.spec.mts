import {test, expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn,execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fixtureDirectory, root} from './helpers/security-process.mjs';

// Run legacy native harnesses in copied, run-owned applications. Their original
// assertions are unchanged; dependency paths point to the installed candidate.
// Final runtime deletion belongs to the managed runner after process checks.
const scripts = [
  'authentication-password-change-regression.mjs', 'password-permissions-api.mjs',
  'equipment-library-api.mjs', 'machine-asset-specification-api.mjs',
  'machine-asset-document-library-api.mjs', 'pm-excel-workflow.mjs',
  'pm-excel-ooxml-shared-formulas.mjs', 'pm-excel-api.mjs',
  'pm-excel-cross-platform.mjs', 'pm-excel-migration.mjs',
  'pm-excel-asset-resolver.mjs', 'pm-work-order-attachments.mjs',
  'pm-workflow-upgrade.mjs', 'work-order-records-export.mjs',
  'issue-128-work-order-records-api.mjs',
];

for (const script of scripts) test(`integrated native regression: ${script}`, async ({}, info) => {
  test.setTimeout(180_000);
  expect(process.env.MCC_PLAYWRIGHT_RUN_ID).toBeTruthy();
  const sandbox = fixtureDirectory('release-api');
  const app = path.join(sandbox, 'app');
  fs.mkdirSync(path.join(app, 'tests'), {recursive:true});
  for (const folder of ['backend/dist', 'backend/templates', 'shared', 'tests/fixtures']) {
    fs.cpSync(path.join(root,folder), path.join(app,folder), {recursive:true});
  }
  for (const file of ['package.json', 'backend/package.json']) fs.copyFileSync(path.join(root,file), path.join(app,file));
  const base='c69f8cb6c63922c4f415eacf8ee28e7c056a0a1e';
  if(process.env.MCC_RELEASE_BASELINE===base){
    const ts=createRequire(import.meta.url)('../backend/node_modules/typescript');
    const source=execFileSync('git',['show',`${base}:backend/src/server/index.ts`],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024,windowsHide:true});
    const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,esModuleInterop:true}}).outputText;
    fs.writeFileSync(path.join(app,'backend/dist/server/index.js'),compiled);
    await info.attach('reviewed-base-server-source',{body:source,contentType:'text/typescript'});
  }
  const deps = path.join(root,'backend/node_modules').replaceAll('\\','/');
  const dependencyUrl = pathToFileURL(path.join(root,'backend/node_modules')).href;
  function adapt(source:string) {
    return source
      .replace(/from (['"])(?:\.\.\/)+backend\/node_modules\//g, (_,q)=>`from ${q}${dependencyUrl}/`)
      .replace(/require\((['"])(?:\.\.\/)+backend\/node_modules\//g, (_,q)=>`require(${q}${deps}/`)
      .replace(/fs\.rmSync\((resolved|fixture|fixtureRoot|testRoot|temporaryRoot),\s*\{\s*recursive:\s*true,\s*force:\s*true\s*\}\)/g,
        'void 0 /* managed runner retains runtime until all participants stop */');
  }
  const target = path.join(app,'tests',script);
  const source = fs.readFileSync(path.join(root,'tests',script),'utf8');
  let executedSource=adapt(source);
  if(process.platform==='win32'&&script==='pm-work-order-attachments.mjs'){
    // The legacy copy's long ID exceeds SQLite's Windows path limit inside
    // managed nested storage. An arbitrary short ID preserves the same payload
    // and every legacy restore/integrity assertion.
    expect(executedSource).toContain('const legacyId=`${backupId}_legacy-no-attachment-folder`;');
    executedSource=executedSource.replace('const legacyId=`${backupId}_legacy-no-attachment-folder`;',
      'const legacyId="MCC_Master_Backup_legacy";');
    executedSource=executedSource.replace("'a legacy manifest without the attachment folder must remain restorable'",
      "'a legacy manifest without the attachment folder must remain restorable: '+JSON.stringify(result.data)");
  }
  fs.writeFileSync(target,executedSource);
  const stagingHelper = path.join(app,'tests/fixtures/pm-staging-noop.mjs');
  fs.writeFileSync(stagingHelper,adapt(fs.readFileSync(stagingHelper,'utf8')));
  await info.attach('executed-harness', {path:target,contentType:'text/javascript'});
  const observer=path.join(sandbox,'observe-processes.mjs');
  const processLog=path.join(sandbox,'backend-processes.log');
  fs.writeFileSync(observer,`import cp from 'node:child_process';import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const original=cp.spawn;cp.spawn=function(...args){const c=original(...args);for(const stream of [c.stdout,c.stderr])stream?.on('data',data=>fs.appendFileSync(${JSON.stringify(processLog)},data));return c;};syncBuiltinESMExports();`);
  const child = spawn(process.execPath,['--import',pathToFileURL(observer).href,target], {cwd:app,windowsHide:true,
    // Legacy harnesses that do not specify PM storage expect the normal
    // data-relative default. Their data directories are inside this sandbox.
    env:{...process.env,MCC_BIND_HOST:'127.0.0.1',MCC_PM_WORK_ORDER_DIR:'',MCC_PM_EXCEL_DIR:'',MCC_PDF_QA_DIR:info.outputPath('pdf')},
    stdio:['ignore','pipe','pipe']});
  let output='';
  child.stdout.on('data', data=>output+=data);
  child.stderr.on('data', data=>output+=data);
  const exited=new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  const deadline=setTimeout(()=>child.kill('SIGKILL'),150_000);
  try {
    const code=await exited;
    expect(code,output).toBe(0);
  } finally {
    clearTimeout(deadline);
    if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}
    fs.writeFileSync(info.outputPath('native-regression.log'),output);
    await info.attach('native-regression-log',{path:info.outputPath('native-regression.log'),contentType:'text/plain'});
    if(fs.existsSync(processLog))await info.attach('backend-process-log',{path:processLog,contentType:'text/plain'});
  }
});
