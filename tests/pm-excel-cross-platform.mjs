import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url);
const ExcelJS=require('../backend/node_modules/exceljs');
const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const testRoot=path.join(repoRoot,'tmp',`pm-excel-cross-platform-${Date.now()}-${process.pid}`);
const sourceFixture=path.join(repoRoot,'tests','fixtures','pm-report-sanitized.xlsx');
const workbookPath=path.join(testRoot,'pm-cross-platform.xlsx');
const password='Mcc-Cross-Platform-Test!9a';

async function freePort(){return new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(0,'127.0.0.1',()=>{const address=probe.address();const port=typeof address==='object'&&address?address.port:0;probe.close(error=>error?reject(error):resolve(port));});});}
async function startServer(name,environment){
  const scenarioRoot=path.join(testRoot,name);const dataDir=path.join(scenarioRoot,'data');const port=await freePort();
  const child=spawn(process.execPath,['backend/dist/server/index.js'],{cwd:repoRoot,env:{...process.env,...environment,PORT:String(port),NODE_ENV:'test',SESSION_SECRET:`pm-cross-platform-${name}`,MCC_DATA_DIR:dataDir,MCC_UPLOADS_DIR:path.join(scenarioRoot,'uploads'),MCC_BACKUPS_DIR:path.join(scenarioRoot,'backups'),MCC_PM_EXCEL_DIR:path.join(scenarioRoot,'pm-excel')},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{output+=chunk;});const base=`http://127.0.0.1:${port}`;
  for(let attempt=0;attempt<100;attempt+=1){if(child.exitCode!==null)throw new Error(`Backend exited early for ${name}.\n${output}`);try{const response=await fetch(`${base}/api/health`);if(response.ok)return{child,base,dataDir};}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
  child.kill();throw new Error(`Backend did not become healthy for ${name}.\n${output}`);
}
async function stopServer(child){if(!child||child.exitCode!==null)return;child.kill();await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,3000))]);}
async function jsonRequest(base,pathname,{method='GET',cookie='',body,headers={}}={}){const response=await fetch(`${base}${pathname}`,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body)});assert.match(response.headers.get('content-type')??'',/application\/json/);return{response,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]??''};}
async function previewWorkbook(base,cookie){const form=new FormData();form.append('file',new Blob([fs.readFileSync(workbookPath)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),path.basename(workbookPath));const response=await fetch(`${base}/api/pm-excel/preview`,{method:'POST',headers:{Cookie:cookie},body:form});assert.equal(response.status,200);return(await response.json()).preview;}
function stableItems(items){const fields=['sheet','rowNumber','rowNumbers','assetNumber','taskTitle','taskType','workOrderNumber','code','message','reason','intervalType','intervalValue','completionDate'];return items.map(item=>Object.fromEntries(fields.filter(field=>item[field]!==undefined).map(field=>[field,item[field]]))).sort((left,right)=>JSON.stringify(left).localeCompare(JSON.stringify(right),'en'));}
function stablePreview(preview){return{additions:stableItems(preview.additions),updates:stableItems(preview.updates),history:stableItems(preview.historyAdditions),conflicts:stableItems(preview.conflicts),rejected:stableItems(preview.rejectedRows),noChanges:stableItems(preview.warnings),confirmEligibility:preview.confirmEligibility,summary:preview.summary};}
function databaseSnapshot(dataDir){const database=new DatabaseSync(path.join(dataDir,'mcc.sqlite'),{readOnly:true});try{return{tasks:database.prepare("SELECT a.asset_number AS assetNumber,t.title,t.interval_type AS intervalType,t.interval_value AS intervalValue,t.last_completed_date AS lastCompletedDate,t.last_completed_meter AS lastCompletedMeter,t.current_meter AS currentMeter FROM pm_tasks t JOIN machine_assets a ON a.id=t.asset_id WHERE t.deleted=0 ORDER BY a.asset_number,t.title").all(),history:database.prepare("SELECT a.asset_number AS assetNumber,h.work_order_number AS workOrderNumber,h.task_type AS taskType,h.completion_date AS completionDate FROM pm_history h JOIN machine_assets a ON a.id=h.asset_id ORDER BY a.asset_number,h.work_order_number,h.task_type").all()};}finally{database.close();}}
async function createAsset(base,cookie,assetNumber,assetName){const result=await jsonRequest(base,'/api/machine-library/assets',{method:'POST',cookie,body:{assetNumber,assetName,brand:'MCC',powerType:'Hydraulic',status:'active'}});assert.equal(result.response.status,201);return result.data.asset.id;}
async function createTask(base,cookie,assetId,key,body){const result=await jsonRequest(base,`/api/machine-library/assets/${assetId}/preventive-maintenance`,{method:'POST',cookie,headers:{'Idempotency-Key':key},body:{instructions:'Cross-platform deterministic test.',scheduleStatus:'active',notes:'',...body}});assert.equal(result.response.status,201);return result.data.task;}

async function runScenario(name,environment){
  const runtime=await startServer(name,environment);
  try{
    let result=await jsonRequest(runtime.base,'/api/auth/setup-first-admin',{method:'POST',body:{fullName:'Cross Platform Owner',email:'cross-platform@example.com',password,confirmPassword:password}});assert.equal(result.response.status,200);
    result=await jsonRequest(runtime.base,'/api/auth/login',{method:'POST',body:{email:'cross-platform@example.com',password}});assert.equal(result.response.status,200);const cookie=result.cookie;
    await createAsset(runtime.base,cookie,'Press 100','Sanitized Press A');const press200=await createAsset(runtime.base,cookie,'Press 200','Sanitized Press B');await createAsset(runtime.base,cookie,'Press #100','Ambiguous alias test asset');
    await createTask(runtime.base,cookie,press200,`${name}-no-change`,{title:'Inspect guards',intervalType:'days',intervalValue:45,lastCompletedDate:'2026-06-15'});
    await createTask(runtime.base,cookie,press200,`${name}-update`,{title:'Lubrication service',intervalType:'hourly',intervalValue:1500,lastCompletedMeter:7900,currentMeter:8200});
    const beforePreview=databaseSnapshot(runtime.dataDir);const first=await previewWorkbook(runtime.base,cookie);const afterFirstPreview=databaseSnapshot(runtime.dataDir);const second=await previewWorkbook(runtime.base,cookie);const afterSecondPreview=databaseSnapshot(runtime.dataDir);
    assert.deepEqual(afterFirstPreview,beforePreview,'preview must not mutate MCC data');assert.deepEqual(afterSecondPreview,beforePreview,'repeated preview must not mutate MCC data');assert.deepEqual(stablePreview(second),stablePreview(first),'the same workbook and MCC data must classify identically on repeated preview');
    assert.ok(first.additions.some(item=>item.rowNumber===18));assert.ok(first.updates.some(item=>item.rowNumber===17));assert.ok(first.historyAdditions.some(item=>item.rowNumber===8));assert.ok(first.conflicts.some(item=>item.code==='AMBIGUOUS_ASSET_MATCH'));assert.ok(first.rejectedRows.some(item=>item.rowNumber===31));assert.ok(first.warnings.some(item=>item.rowNumber===16&&/No MCC changes/i.test(item.message)));assert.deepEqual(first.confirmEligibility,{importableRows:3,resolutionRequiredRows:[],canConfirm:true});
    await createTask(runtime.base,cookie,press200,`${name}-revalidation`,{title:'New cross-platform inspection',intervalType:'days',intervalValue:60,lastCompletedDate:'2026-07-01'});
    const confirmPayload={previewToken:second.token,meterOverrides:[]};assert.deepEqual(Object.keys(confirmPayload).sort(),['meterOverrides','previewToken']);
    result=await jsonRequest(runtime.base,'/api/pm-excel/confirm',{method:'POST',cookie,headers:{'Idempotency-Key':`${name}-confirm`},body:confirmPayload});assert.equal(result.response.status,200);assert.deepEqual({added:result.data.import.added,updated:result.data.import.updated,historyAdded:result.data.import.historyAdded},{added:0,updated:1,historyAdded:1},'confirm must revalidate against database changes made after preview');
    const finalDatabase=databaseSnapshot(runtime.dataDir);assert.equal(finalDatabase.tasks.filter(item=>item.assetNumber==='Press 200'&&item.title==='New cross-platform inspection').length,1,'revalidation must prevent a duplicate addition');assert.equal(finalDatabase.tasks.filter(item=>item.assetNumber==='Press 100').length,0,'conflicting rows must be excluded');assert.equal(finalDatabase.history.some(item=>item.workOrderNumber==='WO-CROSS-REJECTED'),false,'rejected rows must be excluded');
    return{preview:stablePreview(first),confirmPayload:{keys:Object.keys(confirmPayload).sort(),meterOverrides:confirmPayload.meterOverrides},confirmation:{added:result.data.import.added,updated:result.data.import.updated,historyAdded:result.data.import.historyAdded},database:finalDatabase};
  }finally{await stopServer(runtime.child);}
}

try{
  fs.mkdirSync(testRoot,{recursive:true});const workbook=new ExcelJS.Workbook();await workbook.xlsx.readFile(sourceFixture);const tracker=workbook.getWorksheet('Machine Pm Tracker');const addition=tracker.getRow(18);addition.getCell(1).value='Days';addition.getCell(2).value=60;addition.getCell(3).value=new Date('2026-07-01T12:00:00Z');addition.getCell(4).value=new Date('2026-07-20T12:00:00Z');addition.getCell(5).value=new Date('2026-08-30T12:00:00Z');addition.getCell(6).value='Current';addition.getCell(7).value='New cross-platform inspection';
  const history=workbook.getWorksheet('PMHistory');const rejected=history.getRow(31);rejected.getCell(1).value='200';rejected.getCell(2).value='WO-CROSS-REJECTED';rejected.getCell(3).value='Completed';rejected.getCell(4).value=new Date('2026-06-04T12:00:00Z');rejected.getCell(5).value=null;rejected.getCell(6).value='Preventive Maintenance';rejected.getCell(7).value='Sanitized Technician';rejected.getCell(8).value='Days';rejected.getCell(9).value='Inspect guards';rejected.getCell(10).value='This rejected row must never be imported.';await workbook.xlsx.writeFile(workbookPath);
  const central=await runScenario('central-en',{TZ:'America/Chicago',LANG:'en_US.UTF-8',LC_ALL:'en_US.UTF-8'});const utcGerman=await runScenario('utc-de',{TZ:'UTC',LANG:'de_DE.UTF-8',LC_ALL:'de_DE.UTF-8'});assert.deepEqual(utcGerman,central,'PM import classification, eligibility, payload shape, confirmation, and writes must be locale/timezone neutral');
  console.log('PM Excel cross-platform tests passed: identical classifications, confirm eligibility/payload, backend revalidation, exclusions, and database writes across timezone/locale variants.');
}finally{const resolved=path.resolve(testRoot);const allowed=path.resolve(repoRoot,'tmp');if(resolved.startsWith(`${allowed}${path.sep}`)&&fs.existsSync(resolved))fs.rmSync(resolved,{recursive:true,force:true});}
