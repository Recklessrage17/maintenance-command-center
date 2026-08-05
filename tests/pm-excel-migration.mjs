import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixtureRoot=path.join(repoRoot,'tmp',`pm-excel-migration-${Date.now()}-${process.pid}`);
const dataDir=path.join(fixtureRoot,'data');const uploadsDir=path.join(fixtureRoot,'uploads');const backupsDir=path.join(fixtureRoot,'backups');const pmExcelDir=path.join(fixtureRoot,'pm-excel');const dbPath=path.join(dataDir,'mcc.sqlite');
let server;let database;

async function freePort(){return new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(0,'127.0.0.1',()=>{const address=probe.address();const port=typeof address==='object'&&address?address.port:0;probe.close(error=>error?reject(error):resolve(port));});});}
async function startServer(){const port=await freePort();const child=spawn(process.execPath,['backend/dist/server/index.js'],{cwd:repoRoot,env:{...process.env,PORT:String(port),NODE_ENV:'test',SESSION_SECRET:'pm-excel-migration-test',MCC_DATA_DIR:dataDir,MCC_UPLOADS_DIR:uploadsDir,MCC_BACKUPS_DIR:backupsDir,MCC_PM_EXCEL_DIR:pmExcelDir},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{output+=chunk;});const base=`http://127.0.0.1:${port}`;for(let attempt=0;attempt<100;attempt+=1){if(child.exitCode!==null)throw new Error(`Backend exited during migration.\n${output}`);try{const response=await fetch(`${base}/api/health`);if(response.ok)return child;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}child.kill();throw new Error(`Backend migration did not become healthy.\n${output}`);}
async function stopServer(child){if(!child||child.exitCode!==null)return;child.kill();await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,3000))]);}
async function migrateOnce(){server=await startServer();await stopServer(server);server=undefined;}

try{
  fs.mkdirSync(dataDir,{recursive:true});
  const legacy=new DatabaseSync(dbPath);
  legacy.exec(`CREATE TABLE pm_tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, asset_id INTEGER NOT NULL, client_request_id TEXT, title TEXT NOT NULL, instructions TEXT NOT NULL DEFAULT '', interval_type TEXT NOT NULL, interval_value REAL NOT NULL, last_completed_date TEXT, last_completed_meter REAL, current_meter REAL, next_due_date TEXT, next_due_meter REAL, assigned_to TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, hold INTEGER NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '', created_by_user_id INTEGER, updated_by_user_id INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE pm_history (id INTEGER PRIMARY KEY AUTOINCREMENT, pm_task_id INTEGER NOT NULL, asset_id INTEGER NOT NULL, completion_date TEXT NOT NULL, completed_meter REAL, performed_by_user_id INTEGER, performed_by_name TEXT NOT NULL DEFAULT '', completion_notes TEXT NOT NULL DEFAULT '', previous_due_date TEXT, previous_due_meter REAL, next_due_date TEXT, next_due_meter REAL, created_at TEXT NOT NULL);`);
  legacy.prepare("INSERT INTO pm_tasks (id,asset_id,title,interval_type,interval_value,active,hold,created_at,updated_at) VALUES (1,101,'Legacy task A','days',30,1,0,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),(2,202,'Legacy task B','days',45,1,0,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')").run();
  legacy.prepare("INSERT INTO pm_history (id,pm_task_id,asset_id,completion_date,performed_by_name,completion_notes,created_at) VALUES (1,1,101,'2026-01-10','Legacy Technician','Legacy row A','2026-01-10T12:00:00Z'),(2,2,202,'2026-01-11','Legacy Technician','Legacy row B','2026-01-11T12:00:00Z')").run();
  legacy.close();

  await migrateOnce();
  database=new DatabaseSync(dbPath);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM pm_history').get().count,2,'v1.4.6 PM history rows must survive migration');
  assert.deepEqual(database.prepare('SELECT id,completion_date,completion_notes FROM pm_history ORDER BY id').all().map(row=>({...row})),[
    {id:1,completion_date:'2026-01-10',completion_notes:'Legacy row A'},
    {id:2,completion_date:'2026-01-11',completion_notes:'Legacy row B'},
  ]);
  assert.ok(database.prepare("PRAGMA table_info(pm_history)").all().some(column=>column.name==='import_source_ref'));
  assert.ok(database.prepare("PRAGMA table_info(pm_tasks)").all().some(column=>column.name==='asset_library'));
  database.exec("DROP INDEX IF EXISTS idx_pm_history_work_order_lookup; CREATE UNIQUE INDEX idx_pm_history_work_order ON pm_history (work_order_number COLLATE NOCASE) WHERE work_order_number<>'';");
  database.close();database=undefined;

  await migrateOnce();
  database=new DatabaseSync(dbPath);
  let indexes=database.prepare("PRAGMA index_list(pm_history)").all();
  assert.equal(indexes.some(index=>index.name==='idx_pm_history_work_order'),false,'legacy global work-order uniqueness index must be removed');
  assert.equal(indexes.find(index=>index.name==='idx_pm_history_work_order_lookup')?.unique,0,'work-order lookup index must be non-unique');
  assert.equal(indexes.find(index=>index.name==='idx_pm_history_completion_request')?.unique,1);
  assert.equal(indexes.find(index=>index.name==='idx_pm_history_import_source')?.unique,1);
  database.prepare("UPDATE pm_history SET work_order_number='WO-MIGRATION-SHARED',task_type='Legacy task A',interval_type='days',import_source_ref='migration-ref-a' WHERE id=1").run();
  database.prepare("UPDATE pm_history SET work_order_number='WO-MIGRATION-SHARED',task_type='Legacy task B',interval_type='days',import_source_ref='migration-ref-b' WHERE id=2").run();
  database.close();database=undefined;

  await migrateOnce();
  database=new DatabaseSync(dbPath,{readOnly:true});
  const repeated=database.prepare("SELECT id,asset_id,task_type,work_order_number,import_source_ref FROM pm_history WHERE work_order_number='WO-MIGRATION-SHARED' ORDER BY id").all();
  indexes=database.prepare("PRAGMA index_list(pm_history)").all();
  database.close();database=undefined;
  assert.equal(repeated.length,2,'repeated work-order rows must survive restart migration');
  assert.equal(new Set(repeated.map(row=>row.asset_id)).size,2);
  assert.equal(new Set(repeated.map(row=>row.task_type)).size,2);
  assert.equal(new Set(repeated.map(row=>row.import_source_ref)).size,2);
  assert.equal(indexes.find(index=>index.name==='idx_pm_history_work_order_lookup')?.unique,0);
  console.log('PM Excel migration tests passed: v1.4.6 history preservation, safe column/index ordering, removal of global work-order uniqueness, and repeated work-order retention across restarts.');
}finally{
  if(database){database.close();database=undefined;}
  await stopServer(server);
  const resolved=path.resolve(fixtureRoot);const allowed=path.resolve(repoRoot,'tmp');
  if(resolved.startsWith(`${allowed}${path.sep}`)&&fs.existsSync(resolved))fs.rmSync(resolved,{recursive:true,force:true});
}
