import type { DatabaseSync } from 'node:sqlite';

export type WorkLogEntry = {
  id:number; update_id:number; work_date:string; body:string; labor_hours:number; is_initial:number;
  created_at:string; updated_at:string|null; created_by_user_id:number|null; updated_by_user_id:number|null;
};
export function localWorkDate(timestamp:string):string {
  const date=new Date(timestamp);
  if(!Number.isFinite(date.getTime()))throw new Error('Work log creation date is invalid.');
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
export function validWorkDate(value:unknown):value is string {
  return typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;
}
export function workLogInput(input:Record<string,unknown>,fallback?:WorkLogEntry) {
  const workDate=input.workDate??fallback?.work_date??localWorkDate(new Date().toISOString());
  if(!validWorkDate(workDate))throw new Error('Enter a valid Work Date.');
  const body=String(input.body??input.update??'').trim();
  if(!body||body.length>20000)throw new Error('Work Performed / Progress is required and must be 20,000 characters or fewer.');
  const laborHours=Number(input.laborHours??fallback?.labor_hours??0);
  if(!Number.isFinite(laborHours)||laborHours<0||laborHours>24||Math.abs(Math.round(laborHours*100)-laborHours*100)>1e-8)throw new Error('Labor Added must be between 0 and 24 hours, with at most two decimal places.');
  return {workDate,body,laborHours};
}
export function workLogEntries(database:DatabaseSync,updateId:number):WorkLogEntry[] {
  return database.prepare('SELECT * FROM asset_note_update_entries WHERE update_id=? ORDER BY work_date,created_at,id').all(updateId) as WorkLogEntry[];
}
export function publicWorkLogEntry(row:WorkLogEntry) {
  return {id:row.id,updateId:row.update_id,workDate:row.work_date,body:row.body,laborHours:Number(row.labor_hours),createdAt:row.created_at,updatedAt:row.updated_at,createdByUserId:row.created_by_user_id,updatedByUserId:row.updated_by_user_id};
}
export function insertWorkLogEntry(database:DatabaseSync,updateId:number,input:{workDate:string;body:string;laborHours:number},actorId:number|null,timestamp:string,initial=false):number {
  return Number(database.prepare('INSERT INTO asset_note_update_entries (update_id,work_date,body,labor_hours,is_initial,created_by_user_id,created_at) VALUES (?,?,?,?,?,?,?)').run(updateId,input.workDate,input.body,input.laborHours,initial?1:0,actorId,timestamp).lastInsertRowid);
}
// Existing manual labor remains a baseline. Backfilled daily entries contribute zero.
export function migrateAssetNoteWorkLogs(database:DatabaseSync) {
  database.exec(`CREATE TABLE IF NOT EXISTS asset_note_update_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT, update_id INTEGER NOT NULL, work_date TEXT NOT NULL,
    body TEXT NOT NULL, labor_hours REAL NOT NULL DEFAULT 0 CHECK(labor_hours>=0 AND labor_hours<=24),
    is_initial INTEGER NOT NULL DEFAULT 0 CHECK(is_initial IN (0,1)),
    created_by_user_id INTEGER, updated_by_user_id INTEGER, created_at TEXT NOT NULL, updated_at TEXT,
    FOREIGN KEY(update_id) REFERENCES asset_note_updates(id) ON DELETE RESTRICT,
    FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
    FOREIGN KEY(updated_by_user_id) REFERENCES users(id) ON DELETE RESTRICT);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_work_log_initial ON asset_note_update_entries(update_id) WHERE is_initial=1;
    CREATE INDEX IF NOT EXISTS idx_work_log_date ON asset_note_update_entries(update_id,work_date,created_at,id);`);
  const columns=new Set((database.prepare('PRAGMA table_info(asset_note_updates)').all() as Array<{name:string}>).map(row=>row.name));
  if(!columns.has('daily_entries_version'))database.exec('ALTER TABLE asset_note_updates ADD COLUMN daily_entries_version INTEGER NOT NULL DEFAULT 0');
  const attachmentColumns=new Set((database.prepare('PRAGMA table_info(asset_note_update_attachments)').all() as Array<{name:string}>).map(row=>row.name));
  if(!attachmentColumns.has('entry_id'))database.exec('ALTER TABLE asset_note_update_attachments ADD COLUMN entry_id INTEGER REFERENCES asset_note_update_entries(id) ON DELETE RESTRICT');
  database.exec('BEGIN IMMEDIATE');
  try {
    const legacy=database.prepare('SELECT * FROM asset_note_updates WHERE daily_entries_version=0').all() as Array<{id:number;body:string;created_at:string;created_by_user_id:number|null;updated_at:string|null;updated_by_user_id:number|null}>;
    for(const row of legacy){
      if(!database.prepare('SELECT id FROM asset_note_update_entries WHERE update_id=? AND is_initial=1').get(row.id)){
        const id=insertWorkLogEntry(database,row.id,{workDate:localWorkDate(row.created_at),body:row.body,laborHours:0},row.created_by_user_id,row.created_at,true);
        database.prepare('UPDATE asset_note_update_entries SET updated_at=?,updated_by_user_id=? WHERE id=?').run(row.updated_at??null,row.updated_by_user_id??null,id);
      }
      database.prepare('UPDATE asset_note_updates SET daily_entries_version=1 WHERE id=?').run(row.id);
    }
    database.exec('COMMIT');
  }catch(error){database.exec('ROLLBACK');throw error;}
}

// One endpoint for the current resolution, selected by work date, then creation time/id.
// Corrections do not change creation time; post-resolution additions cannot move the endpoint.
export function workLogCompletionEntry(database:DatabaseSync,library:string,note:{id:number;issue_status:string;resolved_at:string|null;reopened_at:string|null}):number|null {
  if(note.issue_status!=='resolved'||!note.resolved_at||!Number.isFinite(Date.parse(note.resolved_at)))return null;
  const rows=database.prepare(`SELECT e.* FROM asset_note_update_entries e JOIN asset_note_updates u ON u.id=e.update_id
    WHERE u.asset_library=? AND u.note_id=? ORDER BY e.work_date DESC,e.created_at DESC,e.id DESC`).all(library,note.id) as WorkLogEntry[];
  return rows.find(entry=>entry.work_date<=localWorkDate(note.resolved_at!)&&Date.parse(entry.created_at)<=Date.parse(note.resolved_at!)
    &&(!note.reopened_at||Date.parse(entry.created_at)>=Date.parse(note.reopened_at)))?.id??null;
}
