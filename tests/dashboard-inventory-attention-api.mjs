import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixture=path.join(root,'tmp',`inventory-attention-api-${Date.now()}-${process.pid}`);
const dataDir=path.join(fixture,'data');
const uploadsDir=path.join(fixture,'uploads');
const backupsDir=path.join(fixture,'backups');
const password='Inventory-Obsolete!9';
let server;
let assertions=0;

function check(actual,expected,message){assertions+=1;assert.equal(actual,expected,message);}
function ok(value,message){assertions+=1;assert.ok(value,message);}
async function freePort(){return new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(0,'127.0.0.1',()=>{const address=probe.address();probe.close(error=>error?reject(error):resolve(address.port));});});}
async function start(){const port=await freePort();const child=spawn(process.execPath,['backend/dist/server/index.js'],{cwd:root,env:{...process.env,PORT:String(port),NODE_ENV:'test',MCC_BIND_HOST:'127.0.0.1',MCC_RECOVERY_DIR:path.join(fixture,'recovery'),SESSION_SECRET:'inventory-obsolete-test',MCC_DATA_DIR:dataDir,MCC_UPLOADS_DIR:uploadsDir,MCC_BACKUPS_DIR:backupsDir},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);const base=`http://127.0.0.1:${port}`;for(let attempt=0;attempt<300;attempt+=1){if(child.exitCode!==null)throw new Error(`Backend exited.\n${output}`);try{if((await fetch(`${base}/api/health`)).ok)return {child,base};}catch{}await new Promise(resolve=>setTimeout(resolve,100));}throw new Error(`Backend did not start.\n${output}`);}
async function stop(child){if(!child||child.exitCode!==null)return;child.kill();await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,3000))]);}
async function request(base,pathname,{method='GET',cookie='',body}={}){const response=await fetch(`${base}${pathname}`,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json().catch(()=>({}));return {response,data,cookie:response.headers.get('set-cookie')?.split(';')[0]||''};}
async function uploadCsv(base,cookie,content,filename){const body=new FormData();body.append('file',new Blob([content],{type:'text/csv'}),filename);const response=await fetch(`${base}/api/inventory/native/import`,{method:'POST',headers:{Cookie:cookie},body});const data=await response.json().catch(()=>({}));return{response,data};}
async function login(base){const result=await request(base,'/api/auth/login',{method:'POST',body:{email:'inventory-owner@example.com',password}});check(result.response.status,200,result.data.error);return result.cookie;}

function createLegacyInventoryFixture(){
  fs.mkdirSync(dataDir,{recursive:true});
  const database=new DatabaseSync(path.join(dataDir,'mcc.sqlite'));
  database.exec(`CREATE TABLE inventory_parts (id INTEGER PRIMARY KEY AUTOINCREMENT, mit3_item_id TEXT, part_number TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', location_id INTEGER, vendor_id INTEGER, quantity REAL NOT NULL DEFAULT 0, min_quantity REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT '', requisition TEXT NOT NULL DEFAULT '', part_info_url TEXT NOT NULL DEFAULT '', manufacturer_brand TEXT NOT NULL DEFAULT '', unit_cost REAL NOT NULL DEFAULT 0, supplier_part_number TEXT NOT NULL DEFAULT '', lead_time TEXT NOT NULL DEFAULT '', important_note TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'mcc', imported_from_mit3_at TEXT, created_by_user_id INTEGER, updated_by_user_id INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, deleted_at TEXT, deleted_by_user_id INTEGER);
  INSERT INTO inventory_parts (id,part_number,description,quantity,min_quantity,status,created_at,updated_at) VALUES (1,'LEGACY-106','Legacy inventory record',3,1,'In Stock','2026-08-01T12:00:00.000Z','2026-08-01T12:00:00.000Z');`);
  database.close();
}

function partPayload(part,obsoleteMarker=true){
  const payload={partNumber:part.partNumber,description:part.description,location:part.location||'Stores',vendor:part.vendor||'Issue 106 Vendor',quantity:part.quantity,minQuantity:part.minQuantity,partInfoUrl:part.partInfoUrl,manufacturerBrand:part.manufacturerBrand,unitCost:part.unitCost,supplierPartNumber:part.supplierPartNumber,leadTime:part.leadTime,importantNote:part.importantNote};
  if(obsoleteMarker)payload.obsolete=part.obsolete;
  return payload;
}

async function run(){
  createLegacyInventoryFixture();
  const runtime=await start();server=runtime.child;const {base}=runtime;
  let result=await request(base,'/api/auth/setup-first-admin',{method:'POST',body:{fullName:'Inventory Owner',email:'inventory-owner@example.com',password,confirmPassword:password}});check(result.response.status,200,result.data.error);
  let cookie=await login(base);
  const getParts=async()=>{const r=await request(base,'/api/inventory/native/parts',{cookie});check(r.response.status,200,r.data.error);return r.data.parts;};
  const attention=async()=>{const r=await request(base,'/api/dashboard/inventory-attention',{cookie});check(r.response.status,200,r.data.error);return r.data;};
  const create=async(partNumber,extra={})=>{const r=await request(base,'/api/inventory/native/parts',{method:'POST',cookie,body:{partNumber,description:`Fixture ${partNumber}`,location:'Stores',vendor:'Attention Vendor',quantity:0,minQuantity:4,unitCost:2,...extra}});check(r.response.status,201,r.data.error);return r.data.part;};
  const edit=async(part,extra)=>{const r=await request(base,`/api/inventory/native/parts/${part.id}`,{method:'PATCH',cookie,body:{...partPayload(part),...extra}});check(r.response.status,200,r.data.error);return r.data.part;};
  const legacy=(await getParts())[0];check(legacy.dashboardStockAlertEnabled,false,'Migrated legacy rows default OFF');
  const defaultPart=await create('DEFAULT-OFF');check(defaultPart.dashboardStockAlertEnabled,false,'Create defaults OFF');
  let out=await create('OUT',{dashboardStockAlertEnabled:true});
  const low=await create('LOW',{dashboardStockAlertEnabled:true,quantity:4});
  await create('HEALTHY',{dashboardStockAlertEnabled:true,quantity:5});
  await create('OBSOLETE',{dashboardStockAlertEnabled:true,obsolete:true});
  let dashboard=await attention();check(dashboard.outOfStockCount,1);check(dashboard.lowStockCount,1,'Existing <=minimum stock rule is preserved');check(dashboard.items.length,2);check(dashboard.items[0].workflow,'Needs Action');
  out=await edit(out,{dashboardStockAlertEnabled:false});check((await attention()).outOfStockCount,0);
  out=await edit(out,{dashboardStockAlertEnabled:true});check((await attention()).outOfStockCount,1);
  out=await edit(out,{description:'Older API client edit'});check(out.dashboardStockAlertEnabled,true,'Omitted PATCH field preserves opt-in');
  out=await edit(out,{quantity:5});check((await attention()).outOfStockCount,0,'Replenished parts disappear');out=await edit(out,{quantity:0});
  result=await request(base,'/api/inventory/native/backups/create',{method:'POST',cookie});check(result.response.status,201,result.data.error);
  const jsonFile=result.data.backups.find(file=>file.type==='JSON');const csvFile=result.data.backups.find(file=>file.type==='CSV');
  const json=JSON.parse(fs.readFileSync(path.join(backupsDir,jsonFile.fileName),'utf8'));check(json.parts.find(part=>part['Part Number']==='OUT')['Dashboard Stock Alert'],'Yes');
  const csv=fs.readFileSync(path.join(backupsDir,csvFile.fileName),'utf8');ok(csv.includes('Dashboard Stock Alert'));
  await edit(out,{dashboardStockAlertEnabled:false});let imported=await uploadCsv(base,cookie,csv,'attention-backup.csv');check(imported.response.status,200,imported.data.error);check((await attention()).outOfStockCount,1,'Focused backup CSV restores alert flag');
  imported=await uploadCsv(base,cookie,'Part Number,Description,Quantity,Minimum Quantity\nLEGACY-IMPORT,Legacy,0,1\n','legacy.csv');check(imported.response.status,200,imported.data.error);check((await getParts()).find(part=>part.partNumber==='LEGACY-IMPORT').dashboardStockAlertEnabled,false);
  imported=await uploadCsv(base,cookie,'Part Number,Description,Quantity,Minimum Quantity,Dashboard Stock Alert\nINVALID,Invalid,0,1,maybe\n','invalid.csv');ok(imported.data.errorCount>0||imported.response.status===400,'Invalid imported boolean must be rejected');
  const excelResponse=await fetch(`${base}/api/inventory/native/export/excel-update-template`,{headers:{Cookie:cookie}});check(excelResponse.status,200);
  const excelBytes=await excelResponse.arrayBuffer();await edit(out,{dashboardStockAlertEnabled:false});
  const excelForm=new FormData();excelForm.append('file',new Blob([excelBytes]),'attention-roundtrip.xlsx');
  const excelImport=await fetch(`${base}/api/inventory/native/import`,{method:'POST',headers:{Cookie:cookie},body:excelForm});check(excelImport.status,200);check((await attention()).outOfStockCount,1,'Excel update template preserves the opt-in flag');
  result=await request(base,'/api/requisition-batches',{cookie});check(result.response.status,200,result.data.error);const batchId=result.data.batches.find(batch=>batch.isGeneral).id;
  const stageBody={batchId,dashboardAttention:true,items:[{inventoryPartId:Number(out.id),quantityRequested:3}]};
  result=await request(base,'/api/requisition-staging/bulk',{method:'POST',cookie,body:{...stageBody,items:[{inventoryPartId:Number(out.id),quantityRequested:0}]}});check(result.response.status,400,'Zero request quantity rejected');
  result=await request(base,'/api/requisition-staging/bulk',{method:'POST',cookie,body:stageBody});check(result.response.status,201,result.data.error);check((await attention()).items.find(part=>part.id===out.id).workflow,'Added to Stage');
  result=await request(base,'/api/requisition-staging/bulk',{method:'POST',cookie,body:stageBody});check(result.response.status,409,'Repeated dashboard submission cannot duplicate staging');
  result=await request(base,'/api/requisition-batches',{method:'POST',cookie,body:{name:'Other Batch',status:'Open'}});check(result.response.status,201,result.data.error);
  result=await request(base,'/api/requisition-staging/bulk',{method:'POST',cookie,body:{...stageBody,batchId:result.data.batch.id}});check(result.response.status,409,'Duplicate protection spans batches');
  result=await request(base,'/api/requisitions',{method:'POST',cookie,body:{items:[{inventoryPartId:Number(low.id),quantityRequested:2}],header:{poInitiator:'QA',requisitionedByName:'QA',taxExempt:'No'}}});check(result.response.status,201,result.data.error);const requisition=result.data.requisition;
  let linked=(await attention()).items.find(part=>part.id===low.id);check(linked.workflow,'Requisition Added','Requested must not be mislabeled Ordered');check(linked.activeRequisitionNumber,requisition.requisitionNumber);
  result=await request(base,'/api/requisition-staging/bulk',{method:'POST',cookie,body:{...stageBody,items:[{inventoryPartId:Number(low.id),quantityRequested:2}]}});check(result.response.status,409,'Active requests cannot be restaged');
  result=await request(base,`/api/requisitions/${requisition.id}/status`,{method:'PATCH',cookie,body:{status:'Ordered'}});check(result.response.status,200,result.data.error);check((await attention()).items.find(part=>part.id===low.id).workflow,'Ordered');
  result=await request(base,'/api/users',{method:'POST',cookie,body:{fullName:'View Only QA',email:'viewer@example.com',role:'Maintenance Tech 1',temporaryPassword:'Viewer-Stock!9'}});check(result.response.status,201,result.data.error);
  const viewer=await request(base,'/api/auth/login',{method:'POST',body:{email:'viewer@example.com',password:'Viewer-Stock!9'}});check(viewer.response.status,200);
  result=await request(base,'/api/dashboard/inventory-attention',{cookie:viewer.cookie});check(result.response.status,200,'Inventory viewer may read attention');
  result=await request(base,'/api/requisition-staging/bulk',{method:'POST',cookie:viewer.cookie,body:stageBody});check(result.response.status,403,'Viewer cannot stage');
  result=await request(base,`/api/inventory/native/parts/${out.id}`,{method:'PATCH',cookie:viewer.cookie,body:{...partPayload(out),dashboardStockAlertEnabled:false}});check(result.response.status,403,'Viewer cannot change opt-in');
  result=await request(base,'/api/dashboard/inventory-attention');check(result.response.status,401);
  result=await request(base,'/api/backup/create',{method:'POST',cookie,body:{category:'master'}});check(result.response.status,201,result.data.error);const backupId=result.data.backup.id;
  await edit(out,{dashboardStockAlertEnabled:false});
  result=await request(base,'/api/backup/restore',{method:'POST',cookie,body:{category:'master',backupId,confirmation:'RESTORE MCC'}});check(result.response.status,200,result.data.error);
  cookie=await login(base);check((await getParts()).find(part=>part.id===out.id).dashboardStockAlertEnabled,true,'Database backup/restore preserves opt-in');
  const database=new DatabaseSync(path.join(dataDir,'mcc.sqlite'),{readOnly:true});const column=database.prepare('PRAGMA table_info(inventory_parts)').all().find(row=>row.name==='dashboard_stock_alert_enabled');check(column.notnull,1);check(String(column.dflt_value),'0');database.close();
  console.log(`Inventory Attention API passed: ${assertions} assertions. Retained test data and backups: ${fixture}`);
}
try{await run();}finally{await stop(server);console.log(`Preserved fixture: ${fixture}`);}
