import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixture=path.join(root,'tmp',`inventory-obsolete-api-${Date.now()}-${process.pid}`);
const dataDir=path.join(fixture,'data');
const uploadsDir=path.join(fixture,'uploads');
const backupsDir=path.join(fixture,'backups');
const password='Inventory-Obsolete!9';
let server;
let assertions=0;

function check(actual,expected,message){assertions+=1;assert.equal(actual,expected,message);}
function ok(value,message){assertions+=1;assert.ok(value,message);}
async function freePort(){return new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(0,'127.0.0.1',()=>{const address=probe.address();probe.close(error=>error?reject(error):resolve(address.port));});});}
async function start(){const port=await freePort();const child=spawn(process.execPath,['backend/dist/server/index.js'],{cwd:root,env:{...process.env,PORT:String(port),NODE_ENV:'test',SESSION_SECRET:'inventory-obsolete-test',MCC_DATA_DIR:dataDir,MCC_UPLOADS_DIR:uploadsDir,MCC_BACKUPS_DIR:backupsDir},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);const base=`http://127.0.0.1:${port}`;for(let attempt=0;attempt<300;attempt+=1){if(child.exitCode!==null)throw new Error(`Backend exited.\n${output}`);try{if((await fetch(`${base}/api/health`)).ok)return {child,base};}catch{}await new Promise(resolve=>setTimeout(resolve,100));}throw new Error(`Backend did not start.\n${output}`);}
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
  let runtime=await start();server=runtime.child;let {base}=runtime;
  let result=await request(base,'/api/auth/setup-first-admin',{method:'POST',body:{fullName:'Inventory Owner',email:'inventory-owner@example.com',password,confirmPassword:password}});check(result.response.status,200,result.data.error);
  let cookie=await login(base);

  result=await request(base,'/api/inventory/native/parts',{cookie});check(result.response.status,200,result.data.error);
  const legacy=result.data.parts.find(part=>part.partNumber==='LEGACY-106');ok(legacy,'Legacy inventory row must remain available after migration.');check(legacy.obsolete,false,'Legacy rows must migrate to non-obsolete.');

  result=await request(base,'/api/inventory/native/parts',{method:'POST',cookie,body:{partNumber:'NEW-106',description:'New default inventory record',location:'Stores',vendor:'Issue 106 Vendor',quantity:8,minQuantity:2,partInfoUrl:'',manufacturerBrand:'MCC',unitCost:4.5,supplierPartNumber:'SUP-106',leadTime:'2 days',importantNote:''}});check(result.response.status,201,result.data.error);check(result.data.part.obsolete,false,'New rows must default to non-obsolete when the field is omitted.');

  result=await request(base,'/api/inventory/native/parts/1',{method:'PATCH',cookie,body:{...partPayload(legacy),obsolete:true}});check(result.response.status,200,result.data.error);check(result.data.part.obsolete,true,'PATCH must mark the inventory row obsolete.');
  result=await request(base,'/api/inventory/native/parts?search=legacy-106',{cookie});check(result.response.status,200,result.data.error);check(result.data.parts.length,1,'Search must continue returning an obsolete row.');check(result.data.parts[0].obsolete,true);

  result=await request(base,'/api/inventory/native/backups/create',{method:'POST',cookie});check(result.response.status,201,result.data.error);check(result.data.backups.length,2,'Focused inventory backup must produce JSON and CSV files.');
  const jsonBackup=result.data.backups.find(file=>file.type==='JSON');const csvBackup=result.data.backups.find(file=>file.type==='CSV');ok(jsonBackup&&csvBackup,'Both focused backup formats must be reported.');
  const json=JSON.parse(fs.readFileSync(path.join(backupsDir,jsonBackup.fileName),'utf8'));check(json.parts.find(part=>part['Part Number']==='LEGACY-106').Obsolete,'Yes','JSON backup must preserve obsolete state.');
  const csv=fs.readFileSync(path.join(backupsDir,csvBackup.fileName),'utf8');ok(csv.split(/\r?\n/,1)[0].split(',').includes('Obsolete'),'CSV backup must include the Obsolete column.');ok(csv.includes('LEGACY-106'), 'CSV backup must retain the obsolete record.');ok(/LEGACY-106[^\r\n]*,Yes,/.test(csv),'CSV backup must serialize the obsolete state.');

  result=await request(base,'/api/inventory/native/parts/1',{method:'PATCH',cookie,body:{...partPayload(legacy),obsolete:false}});check(result.response.status,200,result.data.error);check(result.data.part.obsolete,false,'Backup round-trip setup must clear the live flag without deleting the part.');
  let imported=await uploadCsv(base,cookie,csv,'inventory-backup.csv');check(imported.response.status,200,imported.data.error);result=await request(base,'/api/inventory/native/parts?search=LEGACY-106',{cookie});check(result.data.parts[0].obsolete,true,'Re-importing the focused backup must restore obsolete state.');
  const legacyCsv='Part Number,Description,Location,Vendor,Quantity,Minimum Quantity,Unit Cost\nLEGACY-106,Legacy inventory record,Stores,Issue 106 Vendor,3,1,0\n';
  imported=await uploadCsv(base,cookie,legacyCsv,'legacy-inventory.csv');check(imported.response.status,200,imported.data.error);result=await request(base,'/api/inventory/native/parts?search=LEGACY-106',{cookie});check(result.data.parts[0].obsolete,true,'A legacy import without Obsolete must preserve the stored state.');

  await stop(server);server=null;runtime=await start();server=runtime.child;base=runtime.base;cookie=await login(base);
  result=await request(base,'/api/inventory/native/parts?search=LEGACY-106',{cookie});check(result.response.status,200,result.data.error);check(result.data.parts[0].obsolete,true,'Obsolete state must survive a backend restart and reload.');

  const persisted=result.data.parts[0];result=await request(base,'/api/inventory/native/parts/1',{method:'PATCH',cookie,body:{...partPayload(persisted,false),description:'Legacy inventory record, still obsolete'}});check(result.response.status,200,result.data.error);check(result.data.part.obsolete,true,'An older PATCH client that omits Obsolete must preserve the stored state.');
  result=await request(base,'/api/inventory/native/parts/1',{method:'PATCH',cookie,body:{...partPayload(result.data.part),obsolete:false}});check(result.response.status,200,result.data.error);check(result.data.part.obsolete,false,'PATCH must clear obsolete state without deleting the row.');
  result=await request(base,'/api/inventory/native/parts?search=LEGACY-106',{cookie});check(result.data.parts.length,1);check(result.data.parts[0].obsolete,false,'Cleared state must survive a subsequent API reload.');

  const database=new DatabaseSync(path.join(dataDir,'mcc.sqlite'),{readOnly:true});
  const columns=database.prepare('PRAGMA table_info(inventory_parts)').all();const obsoleteColumn=columns.find(column=>column.name==='obsolete');ok(obsoleteColumn,'Migration must add the obsolete column.');check(obsoleteColumn.notnull,1);check(String(obsoleteColumn.dflt_value),'0');
  const stored=database.prepare('SELECT obsolete,deleted FROM inventory_parts WHERE id=1').get();check(stored.obsolete,0);check(stored.deleted,0,'Clearing obsolete must not delete/archive the inventory row.');
  const actions=database.prepare("SELECT action FROM history_logs WHERE section='inventory' AND entity_id='1' ORDER BY id").all().map(row=>row.action);ok(actions.includes('marked_obsolete'),'History must record marking obsolete.');ok(actions.includes('obsolete_cleared'),'History must record clearing obsolete.');database.close();

  console.log(`Inventory obsolete API tests passed: ${assertions} assertions covering migration/defaults, mark/unmark, search, restart persistence, backward-compatible PATCH/import, focused backup round-trip, and history preservation.`);
}

try{await run();}finally{await stop(server);const resolved=path.resolve(fixture);const allowed=path.resolve(root,'tmp');if(resolved.startsWith(`${allowed}${path.sep}`)&&fs.existsSync(resolved))fs.rmSync(resolved,{recursive:true,force:true});}
