import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import crypto from 'node:crypto';
const {PDFDocument,StandardFonts}=createRequire(import.meta.url)('../../backend/node_modules/pdf-lib');

function insert(db,table,values){const keys=Object.keys(values);return Number(db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...Object.values(values)).lastInsertRowid);}
export async function seedPmReportHistory(db,runtime,assets){
 const stamp='2026-10-15T12:00:00.000Z',groups={};
 const pdf=await PDFDocument.create(),page=pdf.addPage();page.drawText('Synthetic original work order - not merged into the history report.',{font:await pdf.embedFont(StandardFonts.Helvetica),x:30,y:700,size:10});const original=Buffer.from(await pdf.save());
 const root=runtime.env?.MCC_PM_WORK_ORDER_DIR??path.join(runtime.fixture,'pm-work-orders');fs.mkdirSync(path.join(root,'Report QA'),{recursive:true});
 for(const library of ['machine','equipment']){
  const id=assets[library].id, tasks=[];
  for(const [index,title]of ['Lubrication QA','Safety QA'].entries())tasks.push(insert(db,'pm_tasks',{asset_id:id,asset_library:library,title,interval_type:index?'cycles':'hourly',interval_value:100,last_completed_meter:300,current_meter:500,next_due_meter:600,created_at:stamp,updated_at:stamp}));
  const records=[];
  for(const [index,date]of ['2025-10-15','2026-09-20','2026-10-15','2026-10-15','2026-10-31','2026-11-01'].entries()){
   const secondary=index===4,marker=`${library.toUpperCase()}_RECORD_${index+1}`;
   const notes=index===3?`${marker} LONG_NOTE_BEGIN\n${Array.from({length:90},(_,i)=>`Maintenance line ${i+1}: lubrication verified; measurements retained; follow-up review logged.`).join('\n')}\nLONG_NOTE_END ${library} alpha α`:marker+' Full original completion notes preserved.';
   const recordId=insert(db,'pm_history',{pm_task_id:tasks[secondary?1:0],asset_id:id,asset_library:library,task_type:secondary?'Safety QA':'Lubrication QA',interval_type:secondary?'cycles':'hourly',completion_date:date,completed_meter:500+index,performed_by_user_id:1,performed_by_name:'Recorded Primary Technician',work_order_number:index===1?'':`QA-${library}-${index+1}`,machine_not_scheduled_or_running:index===1?1:0,previous_due_date:'2026-09-15',previous_due_meter:400,next_due_date:'2026-11-15',next_due_meter:600,follow_up_required:index===2?1:0,follow_up_reason:index===2?'Check seals before next run.':'',completion_notes:notes,created_at:stamp});
   for(const [order,name]of ['Recorded Primary Technician','Recorded Second Technician'].entries())insert(db,'pm_history_participants',{pm_history_id:recordId,user_id:order?null:1,display_name:name,is_primary:order?0:1,participant_order:order,created_at:stamp});
   let attachment=null;
   if(index===2||index===3){const missing=index===3,filename=`${library}-${missing?'missing':'original'}.pdf`,relative=`Report QA/${filename}`;if(!missing)fs.writeFileSync(path.join(root,relative),original);attachment=insert(db,'pm_work_order_attachments',{pm_history_id:recordId,asset_id:id,asset_library:library,asset_display_name:assets[library].assetNumber,work_order_number:`QA-${library}-${index+1}`,original_filename:filename,stored_relative_path:`PDF - Work orders/${relative}`,size_bytes:original.length,sha256:crypto.createHash('sha256').update(original).digest('hex'),mime_type:'application/pdf',uploaded_at:stamp});}
   records.push({id:recordId,pmTaskId:tasks[secondary?1:0],completionDate:date,marker,attachment});
  }
  const other=insert(db,'pm_tasks',{asset_id:assets[`${library}Other`].id,asset_library:library,title:'Other asset private PM',interval_type:'days',interval_value:10,created_at:stamp,updated_at:stamp});
  const foreign=insert(db,'pm_history',{pm_task_id:other,asset_id:assets[`${library}Other`].id,asset_library:library,completion_date:'2026-10-15',completion_notes:'OTHER_ASSET_PRIVATE',created_at:stamp});
  const meterId=insert(db,'pm_asset_meters',{asset_id:id,asset_library:library,meter_type:'hours',current_reading:500,created_at:stamp,updated_at:stamp});
  insert(db,'pm_meter_history',{meter_id:meterId,asset_id:id,asset_library:library,meter_type:'hours',new_reading:500,created_at:stamp});
  groups[library]={asset:assets[library],tasks,records,foreign,foreignTask:other,originalPath:path.join(root,`Report QA/${library}-original.pdf`)};
 }
 return groups;
}
