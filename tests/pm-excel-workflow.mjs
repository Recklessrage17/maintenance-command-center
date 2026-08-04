import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  calculateWorkbookPm,
  defaultPmCompletionNote,
  inspectPmWorkbook,
  meaningfulPmNote,
  synchronizePmWorkbook,
} from '../backend/dist/server/pmExcel.js';

const require=createRequire(import.meta.url);
const ExcelJS=require('../backend/node_modules/exceljs');
const JSZip=require('../backend/node_modules/jszip');
const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixturePath=path.join(repoRoot,'tests','fixtures','pm-report-sanitized.xlsx');
const temporaryRoot=fs.mkdtempSync(path.join(os.tmpdir(),'mcc-pm-excel-'));
const destination=path.join(temporaryRoot,'PM_report_latest.xlsx');
const backups=path.join(temporaryRoot,'backups');
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

try {
  assert.deepEqual(calculateWorkbookPm({intervalType:'hourly',intervalValue:3000,lastCompletedMeter:3456,currentMeter:3560}),{nextDueDate:null,nextDueMeter:6456,remaining:2896,status:'Current'});
  assert.deepEqual(calculateWorkbookPm({intervalType:'cycles',intervalValue:10000,lastCompletedMeter:120000,currentMeter:125000}),{nextDueDate:null,nextDueMeter:130000,remaining:5000,status:'Current'});
  assert.deepEqual(calculateWorkbookPm({intervalType:'days',intervalValue:30,lastCompletedDate:'2026-07-01',currentDate:'2026-07-20'}),{nextDueDate:'2026-07-31',nextDueMeter:null,remaining:11,status:'Due Soon'});
  assert.deepEqual(calculateWorkbookPm({intervalType:'annual',intervalValue:12,lastCompletedDate:'2025-08-01',currentDate:'2026-07-20'}),{nextDueDate:'2026-08-01',nextDueMeter:null,remaining:12,status:'Due Soon'});
  assert.equal(defaultPmCompletionNote('hourly',3560),'PM completed at 3,560 machine hours. No issues found.');
  assert.equal(defaultPmCompletionNote('cycles',125000),'PM completed at 125,000 cycles. No issues found.');
  assert.equal(defaultPmCompletionNote('days',null),'PM completed. No issues found.');
  assert.equal(meaningfulPmNote('bad bearing vibration'),true);
  assert.equal(meaningfulPmNote('---'),false);

  const parsed=await inspectPmWorkbook(fs.readFileSync(fixturePath));
  assert.equal(parsed.trackerRows.length,4);
  assert.equal(parsed.historyRows.length,1);
  assert.equal(parsed.rejectedRows.length,0);
  assert.deepEqual(parsed.sheetNames,['Machine Pm Tracker','PMHistory','Reference Only']);

  const original=new ExcelJS.Workbook();await original.xlsx.readFile(fixturePath);
  const originalReference=original.getWorksheet('Reference Only');
  const originalReferenceSnapshot={title:originalReference.getCell('A1').value,titleStyle:originalReference.getCell('A1').style,formula:originalReference.getCell('B3').formula,validation:originalReference.getCell('C3').dataValidation,merges:originalReference.model.merges,width:originalReference.getColumn(1).width,height:originalReference.getRow(1).height,orientation:originalReference.pageSetup.orientation,fitToPage:originalReference.pageSetup.fitToPage};
  const originalWidths=original.worksheets.map(sheet=>sheet.columns.map(column=>column.width));
  const originalFormula=original.getWorksheet('Machine Pm Tracker').getCell('H4').formula;
  const originalValidation=JSON.stringify(original.getWorksheet('Machine Pm Tracker').getCell('I4').dataValidation);
  const historyRow={assetNumber:'M-100',workOrderNumber:'MCC-PM-UNIT00000001',taskStatus:'Completed',startDate:'2026-08-04',completionDate:'2026-08-04',workOrderType:'Preventive Maintenance',performedBy:'Sanitized Technician',intervalType:'hourly',taskType:'Hydraulic service',taskNote:'PM completed at 3,600 machine hours. No issues found.'};
  const update={assetNumber:'M-100',taskTitle:'Hydraulic service verified',matchTaskTitle:'Hydraulic service',intervalType:'hourly',intervalValue:3200,lastCompletedDate:null,lastCompletedMeter:3560,currentDate:null,currentMeter:3600,remaining:3160,status:'Current'};
  let result=await synchronizePmWorkbook({sourcePath:fixturePath,destinationPath:destination,backupDir:backups,trackerUpdates:[update],historyRows:[historyRow]});
  assert.equal(result.appendedHistory,1);
  const changed=new ExcelJS.Workbook();await changed.xlsx.readFile(destination);
  assert.equal(changed.getWorksheet('Machine Pm Tracker').getCell('C4').value,'Hydraulic service verified');
  assert.equal(changed.getWorksheet('Machine Pm Tracker').getCell('E4').value,3200);
  assert.equal(changed.getWorksheet('Machine Pm Tracker').getCell('F4').value,3560);
  assert.equal(changed.getWorksheet('Machine Pm Tracker').getCell('G4').value,3600);
  assert.equal(changed.getWorksheet('Machine Pm Tracker').getCell('H4').formula,originalFormula,'tracker formula must remain intact');
  assert.equal(JSON.stringify(changed.getWorksheet('Machine Pm Tracker').getCell('I4').dataValidation),originalValidation,'tracker dropdown must remain intact');
  assert.equal(changed.getWorksheet('PMHistory').getCell('B4').value,historyRow.workOrderNumber);
  assert.ok(changed.getWorksheet('PMHistory').getCell('K4').formula,'helper formula must extend to appended history');
  assert.equal(changed.getWorksheet('PMHistory').getTable('PMHistoryTable').table.tableRef,'A2:K4','existing PMHistory table must extend to the appended row');
  assert.deepEqual(changed.worksheets.map(sheet=>sheet.columns.map(column=>column.width)),originalWidths,'column widths must remain unchanged');
  const changedReference=changed.getWorksheet('Reference Only');
  assert.deepEqual({title:changedReference.getCell('A1').value,titleStyle:changedReference.getCell('A1').style,formula:changedReference.getCell('B3').formula,validation:changedReference.getCell('C3').dataValidation,merges:changedReference.model.merges,width:changedReference.getColumn(1).width,height:changedReference.getRow(1).height,orientation:changedReference.pageSetup.orientation,fitToPage:changedReference.pageSetup.fitToPage},originalReferenceSnapshot,'unrelated worksheet content, layout, formulas, validation, and print orientation must remain unchanged');
  const [sourceZip,changedZip]=await Promise.all([JSZip.loadAsync(fs.readFileSync(fixturePath)),JSZip.loadAsync(fs.readFileSync(destination))]);const [sourceUnrelatedXml,changedUnrelatedXml]=await Promise.all([sourceZip.file('xl/worksheets/sheet3.xml').async('nodebuffer'),changedZip.file('xl/worksheets/sheet3.xml').async('nodebuffer')]);assert.equal(crypto.createHash('sha256').update(changedUnrelatedXml).digest('hex'),crypto.createHash('sha256').update(sourceUnrelatedXml).digest('hex'),'unrelated worksheet XML must be preserved byte-for-byte');

  const repeatedUpdate={...update,matchTaskTitle:undefined};
  result=await synchronizePmWorkbook({sourcePath:destination,destinationPath:destination,backupDir:backups,trackerUpdates:[repeatedUpdate],historyRows:[historyRow]});
  assert.equal(result.appendedHistory,0,'repeated synchronization must not duplicate PMHistory');
  assert.ok(result.backupPath&&fs.existsSync(result.backupPath),'known-good workbook backup must be preserved');
  const beforeFailure=sha(destination);
  await assert.rejects(()=>synchronizePmWorkbook({sourcePath:destination,destinationPath:destination,backupDir:backups,trackerUpdates:[{...repeatedUpdate,currentMeter:3610,remaining:3150}],historyRows:[],beforeReplace(){throw new Error('simulated validation boundary failure');}}),/simulated/);
  assert.equal(sha(destination),beforeFailure,'failed write must leave the known-good workbook untouched');

  console.log(`PM Excel workflow tests passed on ${process.platform}: calculations, notes, two-sheet parsing, targeted preservation, idempotent history, backups, and atomic failure handling.`);
} finally {
  if(fs.existsSync(temporaryRoot))fs.rmSync(temporaryRoot,{recursive:true,force:true});
}
