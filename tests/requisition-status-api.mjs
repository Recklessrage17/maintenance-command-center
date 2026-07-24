import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixture=path.join(root,'tmp',`requisition-status-api-${Date.now()}-${process.pid}`);
const dataDir=path.join(fixture,'data');
const uploadsDir=path.join(fixture,'uploads');
const backupsDir=path.join(fixture,'backups');
const password='Requisition-Status!9';
let server;
let assertions=0;
function check(actual,expected,message){assertions+=1;assert.equal(actual,expected,message);}
function ok(value,message){assertions+=1;assert.ok(value,message);}
async function freePort(){return new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(0,'127.0.0.1',()=>{const address=probe.address();probe.close(error=>error?reject(error):resolve(address.port));});});}
async function start(port){const child=spawn(process.execPath,['backend/dist/server/index.js'],{cwd:root,env:{...process.env,PORT:String(port),NODE_ENV:'test',SESSION_SECRET:'requisition-status-test',MCC_DATA_DIR:dataDir,MCC_UPLOADS_DIR:uploadsDir,MCC_BACKUPS_DIR:backupsDir},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);const base=`http://127.0.0.1:${port}`;for(let attempt=0;attempt<100;attempt+=1){if(child.exitCode!==null)throw new Error(`Backend exited.\n${output}`);try{if((await fetch(`${base}/api/health`)).ok)return {child,base};}catch{}await new Promise(resolve=>setTimeout(resolve,100));}throw new Error(`Backend did not start.\n${output}`);}
async function request(base,pathname,{method='GET',cookie='',body}={}){const response=await fetch(`${base}${pathname}`,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json().catch(()=>({}));return {response,data,cookie:response.headers.get('set-cookie')?.split(';')[0]||''};}

function createLegacyFixture(){
  fs.mkdirSync(dataDir,{recursive:true});
  const database=new DatabaseSync(path.join(dataDir,'mcc.sqlite'));
  database.exec(`CREATE TABLE inventory_requisitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,requisition_number TEXT NOT NULL UNIQUE,inventory_part_id INTEGER NOT NULL,part_number TEXT NOT NULL DEFAULT '',description TEXT NOT NULL DEFAULT '',vendor_name TEXT NOT NULL DEFAULT '',location_name TEXT NOT NULL DEFAULT '',quantity_requested REAL NOT NULL DEFAULT 1,unit_cost REAL NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'Requested',requested_by_user_id INTEGER,requested_by_name TEXT NOT NULL DEFAULT '',po_initiator TEXT NOT NULL DEFAULT '',requisitioned_by_name TEXT NOT NULL DEFAULT '',tax_exempt TEXT NOT NULL DEFAULT 'No',confirmed_with TEXT NOT NULL DEFAULT '',material_cert TEXT NOT NULL DEFAULT 'No',ship_via TEXT NOT NULL DEFAULT '',fob TEXT NOT NULL DEFAULT 'Destination',ordered_by_user_id INTEGER,received_by_user_id INTEGER,canceled_by_user_id INTEGER,cancel_reason TEXT NOT NULL DEFAULT '',work_order_number TEXT NOT NULL DEFAULT '',notes TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,deleted_at TEXT,deleted_by_user_id INTEGER
  );
  CREATE TABLE history_logs (id INTEGER PRIMARY KEY AUTOINCREMENT,section TEXT NOT NULL,action TEXT NOT NULL,entity_type TEXT,entity_id TEXT,entity_label TEXT,work_order_number TEXT,part_number TEXT,requisition_number TEXT,asset_id TEXT,machine_name TEXT,equipment_name TEXT,location_name TEXT,vendor_name TEXT,old_value_json TEXT,new_value_json TEXT,quantity_before REAL,quantity_after REAL,quantity_delta REAL,reason_note TEXT,user_id INTEGER,user_name TEXT,user_email TEXT,created_at TEXT NOT NULL);`);
  const created=new Date(Date.now()-30*86_400_000).toISOString();
  const orderedHistory=new Date(Date.now()-5*86_400_000).toISOString();
  const insert=database.prepare(`INSERT INTO inventory_requisitions (id,requisition_number,inventory_part_id,part_number,description,vendor_name,location_name,quantity_requested,status,requested_by_name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  insert.run(1,'REQ-LEGACY-REQUESTED',1,'LEGACY-1','Legacy requested fixture','Vendor','Stores',2,'Requested','Legacy User',created,created);
  insert.run(2,'REQ-LEGACY-ORDERED',2,'LEGACY-2','Legacy ordered fixture','Vendor','Stores',1,'Ordered','Legacy User',created,orderedHistory);
  insert.run(3,'REQ-LEGACY-CANCEL',3,'LEGACY-3','Legacy cancel fixture','Vendor','Stores',1,'Requested','Legacy User',created,created);
  database.prepare(`INSERT INTO history_logs (section,action,entity_type,entity_id,requisition_number,new_value_json,created_at) VALUES ('requisitions','ordered','requisition','2','REQ-LEGACY-ORDERED','{"status":"Ordered"}',?)`).run(orderedHistory);
  database.close();
  return {created,orderedHistory};
}

async function run(){
  const legacy=createLegacyFixture();
  const runtime=await start(await freePort());server=runtime.child;const {base}=runtime;
  let result=await request(base,'/api/auth/setup-first-admin',{method:'POST',body:{fullName:'Requisition Owner',email:'owner@example.com',password,confirmPassword:password}});check(result.response.status,200);
  result=await request(base,'/api/auth/login',{method:'POST',body:{email:'owner@example.com',password}});check(result.response.status,200);const cookie=result.cookie;

  result=await request(base,'/api/requisitions?status=all',{cookie});check(result.response.status,200);
  const requested=result.data.requisitions.find(row=>row.id===1);
  const ordered=result.data.requisitions.find(row=>row.id===2);
  check(requested.requestedAt,legacy.created,'Requested fallback must use the conservative creation timestamp.');
  check(requested.orderedAt,null);check(requested.receivedAt,null);check(requested.canceledAt,null);
  check(ordered.requestedAt,legacy.created,'Legacy Ordered requested time must not be fabricated newer.');
  check(ordered.orderedAt,legacy.orderedHistory,'Reliable Ordered history must win over the creation fallback.');
  check(ordered.receivedAt,null);check(ordered.canceledAt,null);

  result=await request(base,'/api/requisitions/1',{method:'PATCH',cookie,body:{quantityRequested:4,workOrderNumber:'WO-EDITED',notes:'Unrelated edit'}});check(result.response.status,200);
  check(result.data.requisition.requestedAt,legacy.created,'Unrelated edits must preserve requestedAt.');
  result=await request(base,'/api/requisitions/1/status',{method:'PATCH',cookie,body:{status:'Ordered'}});check(result.response.status,200);
  check(result.data.requisition.requestedAt,legacy.created);
  ok(result.data.requisition.orderedAt,'Ordered transition must set orderedAt.');
  const orderedAt=result.data.requisition.orderedAt;
  result=await request(base,'/api/requisitions/1/status',{method:'PATCH',cookie,body:{status:'Received'}});check(result.response.status,200);
  check(result.data.requisition.requestedAt,legacy.created);check(result.data.requisition.orderedAt,orderedAt);ok(result.data.requisition.receivedAt,'Received transition must set receivedAt.');
  const receivedAt=result.data.requisition.receivedAt;
  result=await request(base,'/api/requisitions/1/status',{method:'PATCH',cookie,body:{status:'Received'}});check(result.response.status,400);
  result=await request(base,'/api/requisitions/1',{cookie});check(result.data.requisition.receivedAt,receivedAt,'A rejected repeat transition must not reset receivedAt.');

  result=await request(base,'/api/requisitions/3/status',{method:'PATCH',cookie,body:{status:'Canceled',cancelReason:'No longer required'}});check(result.response.status,200);
  ok(result.data.requisition.canceledAt,'Canceled transition must set canceledAt.');check(result.data.requisition.requestedAt,legacy.created);
  result=await request(base,'/api/requisitions',{cookie});check(result.data.requisitions.some(row=>row.id===1||row.id===3),false,'Received and Canceled rows must leave Active.');
  result=await request(base,'/api/requisitions?status=Received',{cookie});check(result.data.requisitions.some(row=>row.id===1),true);

  const database=new DatabaseSync(path.join(dataDir,'mcc.sqlite'),{readOnly:true});
  const columns=database.prepare('PRAGMA table_info(inventory_requisitions)').all().map(column=>column.name);
  for(const column of ['requested_at','ordered_at','received_at','canceled_at'])ok(columns.includes(column),`${column} must be migrated.`);
  const persisted=database.prepare('SELECT requested_at,ordered_at,received_at FROM inventory_requisitions WHERE id=1').get();
  check(persisted.requested_at,legacy.created);check(persisted.ordered_at,orderedAt);check(persisted.received_at,receivedAt);
  database.close();
  console.log(`Requisition API/status-transition tests passed: ${assertions} assertions with isolated legacy migration, conservative fallbacks, edit preservation, and Requested → Ordered → Received/Canceled lifecycle.`);
}

try{await run();}finally{if(server&&server.exitCode===null){server.kill();await Promise.race([new Promise(resolve=>server.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,3000))]);}const resolved=path.resolve(fixture);const allowed=path.resolve(root,'tmp');if(resolved.startsWith(`${allowed}${path.sep}`)&&fs.existsSync(resolved))fs.rmSync(resolved,{recursive:true,force:true});}
