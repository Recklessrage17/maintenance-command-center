import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url);const ExcelJS=require('../backend/node_modules/exceljs');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');const fixture=path.join(root,'tmp',`issue-178-${Date.now()}-${process.pid}`);const dataDir=path.join(fixture,'data');const uploadsDir=path.join(fixture,'uploads');const backupsDir=path.join(fixture,'backups');const pmExcelDir=path.join(fixture,'pm-excel');const workOrderDir=path.join(fixture,'PDF - Work orders');const dbPath=path.join(dataDir,'mcc.sqlite');const workbookFixture=path.join(root,'tests','fixtures','pm-report-sanitized.xlsx');const pdf=fs.readFileSync(path.join(root,'tests','fixtures','pm-work-order-sanitized.pdf'));const password='Mcc-Work-Order-Test!9a';let server;

async function freePort(){return new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(0,'127.0.0.1',()=>{const address=probe.address();const port=typeof address==='object'&&address?address.port:0;probe.close(error=>error?reject(error):resolve(port));});});}
async function start(){const port=await freePort();const child=spawn(process.execPath,['backend/dist/server/index.js'],{cwd:root,env:{...process.env,PORT:String(port),NODE_ENV:'test',SESSION_SECRET:'pm-work-order-test',MCC_DATA_DIR:dataDir,MCC_UPLOADS_DIR:uploadsDir,MCC_BACKUPS_DIR:backupsDir,MCC_PM_EXCEL_DIR:pmExcelDir,MCC_PM_WORK_ORDER_DIR:workOrderDir,MCC_PM_WORK_ORDER_MAX_MB:'1'},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);const base=`http://127.0.0.1:${port}`;for(let attempt=0;attempt<100;attempt+=1){if(child.exitCode!==null)throw new Error(`Backend exited early.\n${output}`);try{if((await fetch(`${base}/api/health`)).ok)return{child,base};}catch{}await new Promise(resolve=>setTimeout(resolve,100));}child.kill();throw new Error(`Backend did not become healthy.\n${output}`);}
async function stop(child){if(!child||child.exitCode!==null)return;child.kill();await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,3000))]);}
async function json(base,url,{method='GET',cookie='',body,headers={}}={}){const response=await fetch(`${base}${url}`,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json();return{response,data,cookie:response.headers.get('set-cookie')?.split(';')[0]??''};}
function completionForm({workOrderNumber='',followUpRequired='no',followUpReason='',file=pdf,filename='sanitized-report.pdf',mime='application/pdf',completedMeter='3600',machineNotScheduledOrRunning}={}){const form=new FormData();if(machineNotScheduledOrRunning!==undefined)form.append('machineNotScheduledOrRunning',String(machineNotScheduledOrRunning));form.append('completionDate','2026-08-05');form.append('completedMeter',completedMeter);form.append('workOrderNumber',workOrderNumber);form.append('followUpRequired',followUpRequired);form.append('followUpReason',followUpReason);form.append('noIssuesFound','true');form.append('taskNote','');if(file!==null)form.append('workOrderPdf',new Blob([file],{type:mime}),filename);return form;}
async function complete(base,cookie,taskId,key,options={},headers={}){const response=await fetch(`${base}/api/machine-library/preventive-maintenance/${taskId}/complete`,{method:'POST',headers:{Cookie:cookie,'Idempotency-Key':key,...headers},body:completionForm(options)});const data=await response.json();return{response,data};}
function dbRows(sql){const db=new DatabaseSync(dbPath,{readOnly:true});try{return db.prepare(sql).all().map(row=>({...row}));}finally{db.close();}}

try {
  fs.mkdirSync(pmExcelDir,{recursive:true});fs.copyFileSync(workbookFixture,path.join(pmExcelDir,'PM_report_latest.xlsx'));
  let runtime=await start();server=runtime.child;let base=runtime.base;
  let result=await json(base,'/api/auth/setup-first-admin',{method:'POST',body:{fullName:'PM Owner',email:'pm-owner@example.com',password,confirmPassword:password}});assert.equal(result.response.status,200);
  result=await json(base,'/api/auth/login',{method:'POST',body:{email:'pm-owner@example.com',password}});let cookie=result.cookie;
  result=await json(base,'/api/machine-library/assets',{method:'POST',cookie,body:{assetNumber:'Press 100',assetName:'Sanitized Press A',brand:'MCC',powerType:'Hydraulic',status:'active'}});assert.equal(result.response.status,201);const assetId=result.data.asset.id;
  result=await json(base,`/api/machine-library/assets/${assetId}/preventive-maintenance`,{method:'POST',cookie,body:{title:'Hydraulic service',intervalType:'hourly',intervalValue:3000,lastCompletedMeter:3456,currentMeter:3560,scheduleStatus:'active'}});assert.equal(result.response.status,201);const taskId=result.data.task.id;

  for(const [index,exception] of [undefined,false,'false','yes','1','TRUE','[true]','{}',''].entries()) {
    const completion=await complete(base,cookie,taskId,`issue178-forged-${index}`,{file:null,machineNotScheduledOrRunning:exception});assert.equal(completion.response.status,400,`must reject forged exception ${exception}`);
  }
  // JSON booleans are accepted explicitly; non-boolean JSON values cannot bypass validation.
  for(const exception of [null,1,{},['true'],false]) {
    result=await json(base,`/api/machine-library/preventive-maintenance/${taskId}/complete`,{method:'POST',cookie,body:{completionDate:'2026-08-05',completedMeter:3600,machineNotScheduledOrRunning:exception}});assert.equal(result.response.status,400);
  }
  let completion=await complete(base,cookie,taskId,'issue178-missing-pdf',{workOrderNumber:'WO-178',file:null,machineNotScheduledOrRunning:false});assert.equal(completion.response.status,400);assert.match(completion.data.error,/PDF is required/);
  assert.equal(dbRows('SELECT * FROM pm_history').length,0);
  completion=await complete(base,cookie,taskId,'issue178-normal',{workOrderNumber:'WO-178'});assert.equal(completion.response.status,200);assert.equal(completion.data.history.machineNotScheduledOrRunning,false);assert.equal(completion.data.history.attachment.status,'available');const normalId=completion.data.history.id;

  completion=await complete(base,cookie,taskId,'issue178-exception',{file:null,machineNotScheduledOrRunning:true,followUpRequired:'yes',followUpReason:'Inspect machine before the next scheduled run.'});assert.equal(completion.response.status,200,JSON.stringify(completion.data));const exceptionId=completion.data.history.id;
  assert.equal(completion.data.history.workOrderNumber,'');assert.equal(completion.data.history.machineNotScheduledOrRunning,true);assert.equal(completion.data.history.attachment,null);assert.equal(completion.data.history.completedMeter,3600);assert.equal(completion.data.history.performedBy,'PM Owner');assert.equal(completion.data.history.completionDate,'2026-08-05');assert.equal(completion.data.history.followUpRequired,true);assert.match(completion.data.history.completionNotes,/No issues found/);assert.ok(completion.data.history.createdAt);
  const row=dbRows(`SELECT * FROM pm_history WHERE id=${exceptionId}`)[0];assert.equal(row.machine_not_scheduled_or_running,1);assert.equal(row.work_order_number,'');assert.equal(dbRows(`SELECT * FROM pm_history_participants WHERE pm_history_id=${exceptionId}`).length,1);
  completion=await complete(base,cookie,taskId,'issue178-exception',{file:null,machineNotScheduledOrRunning:true});assert.equal(completion.response.status,200);assert.equal(completion.data.duplicatePrevented,true);assert.equal(completion.data.history.machineNotScheduledOrRunning,true);assert.equal(dbRows('SELECT * FROM pm_history').length,2);

  const workbook=new ExcelJS.Workbook();await workbook.xlsx.readFile(path.join(pmExcelDir,'PM_report_latest.xlsx'));assert.equal(workbook.getWorksheet('PMHistory').getCell('B11').text,'Not required — machine not scheduled / not running');
  completion=await complete(base,cookie,taskId,'issue178-exception-with-wo',{workOrderNumber:'WO-OPTIONAL',file:null,machineNotScheduledOrRunning:true});assert.equal(completion.response.status,200);assert.equal(completion.data.history.workOrderNumber,'WO-OPTIONAL');assert.equal(completion.data.history.attachment,null);
  completion=await complete(base,cookie,taskId,'issue178-optional-invalid-pdf',{machineNotScheduledOrRunning:true,file:Buffer.from('invalid')});assert.equal(completion.response.status,400,'optional attachments still receive normal validation');
  completion=await complete(base,cookie,taskId,'issue178-exception-with-pdf',{machineNotScheduledOrRunning:true});assert.equal(completion.response.status,200);assert.equal(completion.data.history.attachment.status,'available');
  completion=await complete(base,cookie,taskId,'issue178-exception-followup',{file:null,machineNotScheduledOrRunning:true,followUpRequired:'yes'});assert.equal(completion.response.status,400);assert.match(completion.data.error,/Follow-up Reason/);

  result=await json(base,`/api/machine-library/preventive-maintenance/${taskId}/history`,{cookie});assert.equal(result.data.history.find(item=>item.id===exceptionId).machineNotScheduledOrRunning,true);assert.equal(result.data.history.find(item=>item.id===normalId).machineNotScheduledOrRunning,false);
  result=await json(base,`/api/machine-library/assets/${assetId}/preventive-maintenance/history`,{cookie});assert.equal(result.data.history.find(item=>item.id===exceptionId).machineNotScheduledOrRunning,true);
  const audits=dbRows("SELECT * FROM history_logs WHERE action='pm_completed'");assert.ok(audits.some(item=>JSON.parse(item.new_value_json).machineNotScheduledOrRunning===true));
  result=await json(base,'/api/history?section=preventive_maintenance',{cookie});assert.equal(result.response.status,200);assert.ok(result.data.records.some(item=>item.machineNotScheduledOrRunning===true));
  const auditExport=await fetch(`${base}/api/history/export/pdf`,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({section:'preventive_maintenance'})});assert.equal(auditExport.status,200);assert.equal(auditExport.headers.get('content-type'),'application/pdf');assert.ok((await auditExport.arrayBuffer()).byteLength>0);
  // Completion records remain inaccessible to update/delete requests.
  for(const method of ['PATCH','DELETE']) {const response=await fetch(`${base}/api/machine-library/pm-history/${exceptionId}`,{method,headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({machineNotScheduledOrRunning:false})});assert.ok([404,405].includes(response.status));}
  assert.deepEqual(dbRows(`SELECT * FROM pm_history WHERE id=${exceptionId}`)[0],row);

  result=await json(base,'/api/equipment-library/assets',{method:'POST',cookie,body:{assetNumber:'EQ-178',equipmentName:'Exception Dryer',category:'Dryer',manufacturer:'MCC',status:'active'}});assert.equal(result.response.status,201);const equipmentId=result.data.asset.id;
  result=await json(base,`/api/equipment-library/assets/${equipmentId}/preventive-maintenance`,{method:'POST',cookie,body:{title:'Cycle inspection',intervalType:'cycles',intervalValue:100,lastCompletedMeter:0,currentMeter:10,scheduleStatus:'active'}});assert.equal(result.response.status,201);const equipmentTaskId=result.data.task.id;
  const equipmentComplete=body=>json(base,`/api/equipment-library/preventive-maintenance/${equipmentTaskId}/complete`,{method:'POST',cookie,body});
  result=await equipmentComplete({completedMeter:10,workOrderNumber:''});assert.equal(result.response.status,400);
  result=await equipmentComplete({completedMeter:10,workOrderNumber:'WO-EQ-178'});assert.equal(result.response.status,400);
  result=await equipmentComplete({machineNotScheduledOrRunning:true});assert.equal(result.response.status,400,'cycle reading is still required');
  result=await equipmentComplete({completedMeter:10.5,machineNotScheduledOrRunning:true});assert.equal(result.response.status,400,'whole cycle validation remains required');
  result=await equipmentComplete({completedMeter:10,machineNotScheduledOrRunning:true,noIssuesFound:false,taskNote:''});assert.equal(result.response.status,400,'meaningful task note validation remains required');
  result=await equipmentComplete({completedMeter:10,machineNotScheduledOrRunning:true});assert.equal(result.response.status,200);assert.equal(result.data.history.machineNotScheduledOrRunning,true);assert.equal(result.data.history.attachment,null);
  result=await json(base,`/api/equipment-library/preventive-maintenance/${equipmentTaskId}/complete`,{method:'POST',body:{completedMeter:10,machineNotScheduledOrRunning:true}});assert.equal(result.response.status,401);

  await stop(server);runtime=await start();server=runtime.child;base=runtime.base;
  result=await json(base,'/api/auth/login',{method:'POST',body:{email:'pm-owner@example.com',password}});cookie=result.cookie;
  result=await json(base,`/api/machine-library/preventive-maintenance/${taskId}/history`,{cookie});assert.equal(result.data.history.find(item=>item.id===exceptionId).machineNotScheduledOrRunning,true);assert.deepEqual(dbRows(`SELECT * FROM pm_history WHERE id=${exceptionId}`)[0],row,'restart must preserve the immutable record');
  console.log('Issue 178 API tests passed: strict explicit exception, normal WO/PDF requirements, optional attachment validation, immutable persistence, idempotency, actor/meter/follow-up preservation, history/audit/workbook display, equipment cycles, authentication, and restart compatibility.');
} finally {
  await stop(server);const resolved=path.resolve(fixture);const allowed=path.resolve(root,'tmp');if(resolved.startsWith(`${allowed}${path.sep}`)&&fs.existsSync(resolved))fs.rmSync(resolved,{recursive:true,force:true});
}
