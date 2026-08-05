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
  assert.deepEqual(calculateWorkbookPm({intervalType:'annual',intervalValue:365,lastCompletedDate:'2027-03-01',currentDate:'2027-03-01'}),{nextDueDate:'2028-02-29',nextDueMeter:null,remaining:365,status:'Current'});
  assert.deepEqual(calculateWorkbookPm({intervalType:'annual',intervalValue:12,lastCompletedDate:'2027-03-01',currentDate:'2027-03-01'}),{nextDueDate:'2028-03-01',nextDueMeter:null,remaining:366,status:'Current'});
  assert.equal(defaultPmCompletionNote('hourly',3560),'PM completed at 3,560 machine hours. No issues found.');
  assert.equal(defaultPmCompletionNote('cycles',125000),'PM completed at 125,000 cycles. No issues found.');
  assert.equal(defaultPmCompletionNote('days',null),'PM completed. No issues found.');
  assert.equal(meaningfulPmNote('bad bearing vibration'),true);
  assert.equal(meaningfulPmNote('---'),false);

  const parsed=await inspectPmWorkbook(fs.readFileSync(fixturePath));
  assert.equal(parsed.trackerRows.length,6);
  assert.equal(parsed.historyRows.length,4);
  assert.equal(parsed.rejectedRows.length,0);
  assert.equal(parsed.trackerHeaderRow,5);
  assert.equal(parsed.historyHeaderRow,5);
  assert.deepEqual(parsed.sheetNames,['Machine Pm Tracker','PMHistory','Reference Only']);
  assert.ok(parsed.trackerRows.every(row=>row.assetNumberInherited),'grouped task rows must inherit rather than repeat the machine identifier');
  assert.deepEqual([...new Set(parsed.trackerRows.map(row=>row.machineSectionRow))],[4,14]);
  const annual=parsed.trackerRows.find(row=>row.intervalType==='annual');
  assert.equal(annual.intervalValue,365);
  assert.equal(calculateWorkbookPm({intervalType:annual.intervalType,intervalValue:annual.intervalValue,lastCompletedDate:annual.lastCompletedDate,currentDate:annual.currentDate}).nextDueDate,'2026-08-01');

  const malformedHistoryWorkbook=new ExcelJS.Workbook();await malformedHistoryWorkbook.xlsx.readFile(fixturePath);const malformedHistory=malformedHistoryWorkbook.getWorksheet('PMHistory');
  malformedHistory.getRow(11).values=['100','','Completed',new Date('2026-06-04T12:00:00Z'),new Date('2026-06-04T12:00:00Z'),'Preventive Maintenance','Sanitized Technician','Days','Inspect guards','Missing work order fixture row.'];
  malformedHistory.getRow(12).values=['100','WO-MALFORMED-END-1','Completed',new Date('2026-06-05T12:00:00Z'),null,'Preventive Maintenance','Sanitized Technician','Days','Inspect guards','Missing completion fixture row.'];
  malformedHistory.getRow(13).values=['200','WO-MALFORMED-END-2','Completed',new Date('2026-06-06T12:00:00Z'),null,'Preventive Maintenance','Sanitized Technician','Days','Inspect guards','Missing completion fixture row.'];
  const malformedParsed=await inspectPmWorkbook(Buffer.from(await malformedHistoryWorkbook.xlsx.writeBuffer()));
  assert.equal(malformedParsed.historyRows.length,4,'malformed history rows must not enter the valid history collection');
  assert.equal(malformedParsed.rejectedRows.filter(row=>row.sheet==='PMHistory').length,3);
  assert.ok(malformedParsed.rejectedRows.some(row=>row.rowNumber===11&&/Work-order Number is required/i.test(row.reason)));
  assert.equal(malformedParsed.rejectedRows.filter(row=>[12,13].includes(row.rowNumber)&&/End\/Completion Date is required/i.test(row.reason)).length,2);

  const ambiguousWorkbook=new ExcelJS.Workbook();await ambiguousWorkbook.xlsx.readFile(fixturePath);ambiguousWorkbook.getWorksheet('Machine Pm Tracker').getCell('B14').value=null;
  const ambiguousBuffer=Buffer.from(await ambiguousWorkbook.xlsx.writeBuffer());const ambiguous=await inspectPmWorkbook(ambiguousBuffer);
  assert.ok(ambiguous.rejectedRows.some(row=>row.rowNumber===14&&/section heading is ambiguous/i.test(row.reason)));
  assert.ok(ambiguous.rejectedRows.some(row=>row.rowNumber===16&&/section ownership/i.test(row.reason)));

  const original=new ExcelJS.Workbook();await original.xlsx.readFile(fixturePath);
  const originalTracker=original.getWorksheet('Machine Pm Tracker');
  const originalHistory=original.getWorksheet('PMHistory');
  const originalReference=original.getWorksheet('Reference Only');
  const originalReferenceSnapshot={title:originalReference.getCell('A1').value,titleStyle:originalReference.getCell('A1').style,formula:originalReference.getCell('B3').formula,validation:originalReference.getCell('C3').dataValidation,merges:originalReference.model.merges,width:originalReference.getColumn(1).width,height:originalReference.getRow(1).height,hiddenRow:originalReference.getRow(5).hidden,hiddenColumn:originalReference.getColumn(4).hidden,views:originalReference.views,autoFilter:originalReference.autoFilter,pageSetup:originalReference.pageSetup,pageMargins:originalReference.pageMargins,headerFooter:originalReference.headerFooter};
  const originalWidths=original.worksheets.map(sheet=>sheet.columns.map(column=>column.width));
  const originalDueFormula=originalTracker.getCell('E6').formula;
  const originalStatusFormula=originalTracker.getCell('F6').formula;
  const originalValidation=JSON.stringify(originalTracker.getCell('F6').dataValidation);
  const preparedHelperFormulas=new Map();for(let row=10;row<=12;row+=1)for(let column=11;column<=20;column+=1)preparedHelperFormulas.set(`${row}:${column}`,originalHistory.getCell(row,column).formula);
  const workOrderNumber='MCC-PM-UNIT00000001';
  const historyRows=[
    {assetNumber:'Press 100',workOrderNumber,workOrderHyperlink:'PDF - Work orders/Press 100/WO-UNIT_report.pdf',taskStatus:'Completed',startDate:'2026-08-04',completionDate:'2026-08-04',workOrderType:'Preventive Maintenance',performedBy:'Sanitized Technician',intervalType:'hourly',taskType:'Hydraulic service verified',taskNote:'PM completed at 3,600 machine hours. No issues found.'},
    {assetNumber:'Press 100',workOrderNumber,taskStatus:'Completed',startDate:'2026-08-04',completionDate:'2026-08-04',workOrderType:'Preventive Maintenance',performedBy:'Sanitized Technician',intervalType:'annual',taskType:'Annual safety review',taskNote:'Annual PM completed. No issues found.'},
    {assetNumber:'Press 200',workOrderNumber:'N/A',taskStatus:'Completed',startDate:'2026-08-04',completionDate:'2026-08-04',workOrderType:'Preventive Maintenance',performedBy:'Sanitized Technician',intervalType:'days',taskType:'Inspect guards',taskNote:'PM completed. No issues found.'},
  ];
  const update={assetNumber:'Press 100',taskTitle:'Hydraulic service verified',matchTaskTitle:'Hydraulic service',intervalType:'hourly',intervalValue:3200,lastCompletedDate:null,lastCompletedMeter:3560,currentDate:null,currentMeter:3600,remaining:3160,status:'Current'};
  const annualUpdate={assetNumber:'Press 100',taskTitle:'Annual safety review',intervalType:'annual',intervalValue:365,lastCompletedDate:'2025-08-01',lastCompletedMeter:null,currentDate:'2026-07-20',currentMeter:null,remaining:12,status:'Due Soon'};
  let result=await synchronizePmWorkbook({sourcePath:fixturePath,destinationPath:destination,backupDir:backups,trackerUpdates:[update,annualUpdate],historyRows});
  assert.equal(result.appendedHistory,3,'same work order with different tasks/assets must append as distinct history rows');
  const changed=new ExcelJS.Workbook();await changed.xlsx.readFile(destination);
  const changedTracker=changed.getWorksheet('Machine Pm Tracker');const changedHistory=changed.getWorksheet('PMHistory');
  assert.equal(changedTracker.getCell('G6').value,'Hydraulic service verified');
  assert.equal(changedTracker.getCell('B6').value,3200);
  assert.equal(changedTracker.getCell('C6').value,3560);
  assert.equal(changedTracker.getCell('D6').value,3600);
  assert.equal(changedTracker.getCell('E6').formula,originalDueFormula,'tracker due-date formula must remain intact');
  assert.equal(changedTracker.getCell('F6').formula,originalStatusFormula,'tracker status formula must remain intact');
  assert.equal(JSON.stringify(changedTracker.getCell('F6').dataValidation),originalValidation,'tracker dropdown must remain intact');
  assert.equal(changedTracker.getCell('B9').value,365,'Annual interval must remain 365');
  assert.equal(changedTracker.getCell('A4').value,'Press:');assert.equal(changedTracker.getCell('B4').value,'100','Press section identifiers must not be rewritten during alias matching');
  assert.equal(changedTracker.getCell('A14').value,'Press:');assert.equal(changedTracker.getCell('B14').value,'200','Press section identifiers must not be rewritten during alias matching');
  for(const row of [6,7,8,9])assert.ok(!changedTracker.getRow(row).values.includes('100'),'carried machine identifiers must not be written into task rows');
  for(const row of [16,17])assert.ok(!changedTracker.getRow(row).values.includes('200'),'carried machine identifiers must not be written into task rows');
  assert.deepEqual([changedHistory.getCell('B10').text,changedHistory.getCell('B11').text,changedHistory.getCell('B12').text],[workOrderNumber,workOrderNumber,'N/A']);
  assert.equal(changedHistory.getCell('B10').hyperlink,'PDF - Work orders/Press 100/WO-UNIT_report.pdf','real work orders must receive a relative package hyperlink');
  assert.equal(changedHistory.getCell('B11').hyperlink,undefined,'rows without an attachment must remain plain text');
  assert.equal(changedHistory.getCell('B12').hyperlink,undefined,'N/A work orders must remain plain text');
  assert.deepEqual([changedHistory.getCell('A10').value,changedHistory.getCell('A11').value,changedHistory.getCell('A12').value],['Press 100','Press 100','Press 200']);
  assert.deepEqual([changedHistory.getCell('I10').value,changedHistory.getCell('I11').value,changedHistory.getCell('I12').value],['Hydraulic service verified','Annual safety review','Inspect guards']);
  for(const [key,formula] of preparedHelperFormulas){const [row,column]=key.split(':').map(Number);assert.equal(changedHistory.getCell(row,column).formula,formula,`pre-existing Helper formula ${changedHistory.getCell(row,column).address} must not be modified`);}
  assert.equal(changedHistory.getTable('PMHistoryTable').table.tableRef,'A5:T50','preformatted PMHistory table must not be shrunk while appending');
  assert.deepEqual(changed.worksheets.map(sheet=>sheet.columns.map(column=>column.width)),originalWidths,'column widths must remain unchanged');
  const changedReference=changed.getWorksheet('Reference Only');
  assert.deepEqual({title:changedReference.getCell('A1').value,titleStyle:changedReference.getCell('A1').style,formula:changedReference.getCell('B3').formula,validation:changedReference.getCell('C3').dataValidation,merges:changedReference.model.merges,width:changedReference.getColumn(1).width,height:changedReference.getRow(1).height,hiddenRow:changedReference.getRow(5).hidden,hiddenColumn:changedReference.getColumn(4).hidden,views:changedReference.views,autoFilter:changedReference.autoFilter,pageSetup:changedReference.pageSetup,pageMargins:changedReference.pageMargins,headerFooter:changedReference.headerFooter},originalReferenceSnapshot,'unrelated worksheet content, layout, formulas, validation, visibility, freeze panes, filters, and print settings must remain unchanged');
  const [sourceZip,changedZip]=await Promise.all([JSZip.loadAsync(fs.readFileSync(fixturePath)),JSZip.loadAsync(fs.readFileSync(destination))]);const [sourceUnrelatedXml,changedUnrelatedXml]=await Promise.all([sourceZip.file('xl/worksheets/sheet3.xml').async('nodebuffer'),changedZip.file('xl/worksheets/sheet3.xml').async('nodebuffer')]);assert.equal(crypto.createHash('sha256').update(changedUnrelatedXml).digest('hex'),crypto.createHash('sha256').update(sourceUnrelatedXml).digest('hex'),'unrelated worksheet XML must be preserved byte-for-byte');

  const repeatedUpdate={...update,matchTaskTitle:undefined};
  result=await synchronizePmWorkbook({sourcePath:destination,destinationPath:destination,backupDir:backups,trackerUpdates:[repeatedUpdate,annualUpdate],historyRows});
  assert.equal(result.appendedHistory,0,'exact repeated synchronization must not duplicate PMHistory');
  assert.ok(result.backupPath&&fs.existsSync(result.backupPath),'known-good workbook backup must be preserved');
  const beforeFailure=sha(destination);
  await assert.rejects(()=>synchronizePmWorkbook({sourcePath:destination,destinationPath:destination,backupDir:backups,trackerUpdates:[{...repeatedUpdate,currentMeter:3610,remaining:3150}],historyRows:[],beforeReplace(){throw new Error('simulated validation boundary failure');}}),/simulated/);
  assert.equal(sha(destination),beforeFailure,'failed write must leave the known-good workbook untouched');

  const compactSource=path.join(temporaryRoot,'compact-source.xlsx');const compactDestination=path.join(temporaryRoot,'compact-destination.xlsx');const compact=new ExcelJS.Workbook();const compactTracker=compact.addWorksheet('Machine Pm Tracker');compactTracker.getRow(1).values=['Press:','M-300'];compactTracker.getRow(2).values=['Interval Type','Interval Cycles','Last Completed Date / Last hourly','Today Date / Hourly','Due Date','Status','Task Description'];compactTracker.getRow(3).values=['Hourly',100,10,20,{formula:'C3+B3',result:110},'Current','Compact task'];const compactHistory=compact.addWorksheet('PMHistory');const compactHeaders=['AssetNo','Work order #','Task Status','Start Date','End Date','Work Order Type','Perform By:','Interval Type','Task Type','Task Note',...Array.from({length:10},(_,index)=>`Helper ${index+1}`)];const compactHelpers=Array.from({length:10},(_,index)=>({formula:index===0?'A3&"-"&B3':`K3&"-H${index+1}"`,result:`COMPACT-H${index+1}`}));compactHistory.addTable({name:'CompactHistory',ref:'A2',headerRow:true,totalsRow:false,columns:compactHeaders.map(name=>({name})),rows:[['M-300','WO-COMPACT-SHARED','Completed',new Date('2026-01-01T12:00:00Z'),new Date('2026-01-01T12:00:00Z'),'Preventive Maintenance','Sanitized Technician','Hourly','Compact task','Completed.',...compactHelpers]]});await compact.xlsx.writeFile(compactSource);const compactAppend={assetNumber:'M-300',workOrderNumber:'WO-COMPACT-SHARED',taskStatus:'Completed',startDate:'2026-01-02',completionDate:'2026-01-02',workOrderType:'Preventive Maintenance',performedBy:'Sanitized Technician',intervalType:'hourly',taskType:'Compact second task',taskNote:'Completed second task.'};result=await synchronizePmWorkbook({sourcePath:compactSource,destinationPath:compactDestination,backupDir:backups,trackerUpdates:[],historyRows:[compactAppend]});assert.equal(result.appendedHistory,1);const compactChanged=new ExcelJS.Workbook();await compactChanged.xlsx.readFile(compactDestination);const compactChangedHistory=compactChanged.getWorksheet('PMHistory');const compactTable=compactChangedHistory.getTable('CompactHistory');assert.equal(compactTable.ref??compactTable.table?.tableRef,'A2:T4','a compact PMHistory table must extend for the appended row');assert.equal(compactChangedHistory.getCell('B4').value,'WO-COMPACT-SHARED','same work order with a different task must remain exportable');assert.match(compactChangedHistory.getCell('K4').formula,/A4.*B4/,'Helper formulas must translate to the appended row');assert.deepEqual(compactChangedHistory.getCell('K4').style,compactChangedHistory.getCell('K3').style,'Helper styles must extend to the appended row');

  console.log(`PM Excel workflow tests passed on ${process.platform}: grouped sections, repeated headers, real aliases, Annual 365, repeated work orders, exact duplicate prevention, prepared and extended helpers/tables, targeted preservation, backups, and atomic failure handling.`);
} finally {
  if(fs.existsSync(temporaryRoot))fs.rmSync(temporaryRoot,{recursive:true,force:true});
}
