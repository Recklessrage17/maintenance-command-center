import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
export const timestamp='2025-04-10T12:00:00.000Z';
export const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
export function insert(db,table,values){
  const keys=Object.keys(values);
  return Number(db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...Object.values(values)).lastInsertRowid);
}
// Deliberately covers the actual relationship graph, including preserved deleted
// notes and equipment rows with the same numeric asset ID.
export function seedMachineHistory(db,runtime,assetId,otherId){
  const uploads=runtime.env?.MCC_UPLOADS_DIR??runtime.uploadsDir;
  const pmRoot=runtime.env?.MCC_PM_WORK_ORDER_DIR??path.join(runtime.fixture,'pm-work-orders');
  const payloads=[];
  function file(root,relative,name,bytes=Buffer.from(`Synthetic maintenance attachment ${name}\n`)){
    const destination=path.join(root,relative);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,bytes);
    payloads.push({destination,name,bytes,sha256:digest(bytes)});return{bytes,sha256:digest(bytes)};
  }
  const inspection=file(uploads,'machine-inspection-records/kept.txt','Inspection-original.txt');
  const inspectionId=insert(db,'machine_inspection_records',{asset_id:assetId,original_filename:'Inspection-original.txt',mime_type:'text/plain',file_size:inspection.bytes.length,record_date:'2024-06-01',uploaded_at:timestamp,stored_file_reference:'uploads/machine-inspection-records/kept.txt'});
  fs.writeFileSync(path.join(uploads,'machine-inspection-records/other.txt'),'');
  insert(db,'machine_inspection_records',{asset_id:otherId,original_filename:'Other-machine.txt',mime_type:'text/plain',file_size:0,record_date:'2024-06-01',uploaded_at:timestamp,stored_file_reference:'uploads/machine-inspection-records/other.txt'});
  const photo=file(uploads,'machine-component-images/screw.png','Screw-photo.png');
  insert(db,'machine_component_images',{asset_id:assetId,component_type:'screw',original_filename:'Screw-photo.png',mime_type:'image/png',file_size:photo.bytes.length,stored_file_reference:'uploads/machine-component-images/screw.png',uploaded_at:timestamp});
  const notePdf=file(uploads,'machine-asset-notes/note.pdf','Note-preserved.pdf');
  const noteId=insert(db,'machine_asset_notes',{asset_id:assetId,title:'Preserved warning work order',note_date:'2025-04-10',body:'Resolved maintenance history',is_warning:1,deleted:1,deleted_at:timestamp,deleted_by_user_id:1,deleted_by_name:'Synthetic Manager',delete_reason:'Preserve deleted history in QA',issue_status:'resolved',resolved_at:timestamp,resolved_by_user_id:1,resolved_by_name:'Synthetic Manager',resolution_summary:'Repair verified',work_order_reference:'WO-ARCHIVE-1',pdf_filename:'Note-preserved.pdf',pdf_stored_reference:'uploads/machine-asset-notes/note.pdf',created_at:timestamp,updated_at:timestamp});
  const original=file(uploads,'machine-asset-notes/original.jpg','Note-original.jpg');
  insert(db,'machine_asset_note_attachments',{note_id:noteId,original_filename:'Note-original.jpg',mime_type:'image/jpeg',file_size:original.bytes.length,sha256:original.sha256,source_type:'upload',stored_file_reference:'uploads/machine-asset-notes/original.jpg',created_at:timestamp});
  const updateId=insert(db,'asset_note_updates',{asset_library:'machine',note_id:noteId,body:'Daily update preserved',created_by_user_id:1,created_by_name:'Synthetic Manager',created_at:timestamp,daily_entries_version:1});
  const entryId=insert(db,'asset_note_update_entries',{update_id:updateId,work_date:'2025-04-10',body:'Daily update preserved',labor_hours:2,is_initial:1,created_by_user_id:1,created_at:timestamp});
  const updateFile=file(uploads,'machine-asset-notes/update.jpg','Update-photo.jpg');
  insert(db,'asset_note_update_attachments',{update_id:updateId,entry_id:entryId,original_filename:'Update-photo.jpg',mime_type:'image/jpeg',file_size:updateFile.bytes.length,stored_file_reference:'uploads/machine-asset-notes/update.jpg',uploaded_by_user_id:1,uploaded_by_name:'Synthetic Manager',created_at:timestamp});
  insert(db,'asset_note_labor',{asset_library:'machine',note_id:noteId,display_name:'Synthetic Manager',labor_hours:2,created_at:timestamp,updated_at:timestamp});
  insert(db,'asset_note_lifecycle_events',{asset_library:'machine',note_id:noteId,event_type:'issue_resolved',actor_user_id:1,actor_name:'Synthetic Manager',reason:'Repair verified',old_value_json:'{}',new_value_json:'{}',created_at:timestamp});
  insert(db,'equipment_assets',{id:assetId,asset_number:'EQUIPMENT-DECOY',equipment_name:'Decoy',created_at:timestamp,updated_at:timestamp});
  insert(db,'equipment_asset_notes',{id:noteId,asset_id:assetId,title:'Equipment decoy',is_warning:1,note_date:'2025-04-10',body:'Equipment record',created_at:timestamp,updated_at:timestamp});
  insert(db,'asset_note_updates',{asset_library:'equipment',note_id:noteId,body:'Equipment decoy',created_by_user_id:1,created_by_name:'Decoy',created_at:timestamp});
  const folderId=insert(db,'machine_document_folders',{asset_id:assetId,name:'Manuals',created_at:timestamp,updated_at:timestamp});
  const storedManual=`${crypto.randomUUID()}.txt`;
  const manual=file(uploads,`machine-library/asset-${assetId}/documents/${storedManual}`,'Machine-manual.txt');
  insert(db,'machine_documents',{asset_id:assetId,folder_id:folderId,original_filename:'Machine-manual.txt',display_filename:'Machine-manual.txt',stored_filename:storedManual,extension:'.txt',mime_type:'text/plain',size_bytes:manual.bytes.length,uploaded_at:timestamp,updated_at:timestamp});
  const taskId=insert(db,'pm_tasks',{asset_id:assetId,asset_library:'machine',title:'Lubricate',interval_type:'monthly',interval_value:1,next_due_date:'2024-01-01',created_at:timestamp,updated_at:timestamp});
  const historyId=insert(db,'pm_history',{pm_task_id:taskId,asset_id:assetId,asset_library:'machine',work_order_number:'WO-ARCHIVE-2',completion_date:'2025-04-10',created_at:timestamp});
  insert(db,'pm_history_participants',{pm_history_id:historyId,display_name:'Synthetic Technician',participant_order:0,created_at:timestamp});
  const workOrder=file(pmRoot,'Synthetic Press/kept.pdf','PM-work-order.pdf');
  insert(db,'pm_work_order_attachments',{pm_history_id:historyId,asset_id:assetId,asset_library:'machine',asset_display_name:'Synthetic Press',work_order_number:'WO-ARCHIVE-2',original_filename:'PM-work-order.pdf',stored_relative_path:'PDF - Work orders/Synthetic Press/kept.pdf',size_bytes:workOrder.bytes.length,sha256:workOrder.sha256,mime_type:'application/pdf',uploaded_at:timestamp});
  const meterId=insert(db,'pm_asset_meters',{asset_id:assetId,asset_library:'machine',meter_type:'hours',current_reading:500,created_at:timestamp,updated_at:timestamp});
  insert(db,'pm_meter_history',{meter_id:meterId,asset_id:assetId,asset_library:'machine',meter_type:'hours',new_reading:500,created_at:timestamp});
  const equipmentTaskId=insert(db,'pm_tasks',{asset_id:assetId,asset_library:'equipment',title:'Equipment PM decoy',interval_type:'monthly',interval_value:1,created_at:timestamp,updated_at:timestamp});
  insert(db,'pm_history',{pm_task_id:equipmentTaskId,asset_id:assetId,asset_library:'equipment',completion_date:'2025-04-10',created_at:timestamp});
  insert(db,'history_logs',{section:'preventive_maintenance',entity_type:'pm_task',entity_id:String(taskId),asset_id:String(assetId),action:'pm_completed',entity_label:'Lubricate',created_at:timestamp});
  insert(db,'history_logs',{section:'machine_library',entity_type:'machine_asset_note',entity_id:String(noteId),asset_id:String(assetId),action:'issue_resolved',entity_label:'Repair',created_at:timestamp});
  insert(db,'history_logs',{section:'requisitions',entity_type:'requisition',entity_id:'1',asset_id:String(assetId),action:'text_mentions_press',entity_label:'Synthetic Press',created_at:timestamp});
  insert(db,'audit_log',{action:'measurement inspection pdf generated',target_type:'machine_asset',target_id:String(assetId),created_at:timestamp});
  return{payloads,inspectionId,noteId,taskId,historyId,meterId};
}
