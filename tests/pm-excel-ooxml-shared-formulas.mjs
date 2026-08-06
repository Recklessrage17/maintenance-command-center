import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { synchronizePmWorkbook,validatePmWorkbookOoxml } from '../backend/dist/server/pmExcel.js';

const require=createRequire(import.meta.url);
const ExcelJS=require('../backend/node_modules/exceljs');
const JSZip=require('../backend/node_modules/jszip');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixture=path.join(root,'tests','fixtures','pm-report-shared-formulas-sanitized.xlsx');
const temporaryRoot=fs.mkdtempSync(path.join(os.tmpdir(),'mcc-pm-shared-formula-'));
const output=path.join(temporaryRoot,'PM_report_latest.xlsx');
const backups=path.join(temporaryRoot,'backups');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const dueFormula='IF(OR(B113="",C113="",D113=""),"",B113-(D113-C113))';
const statusFormula='IF(E113="","Needs Date",IF(E113<0,"Past Due",IF(E113=0,"Due Today",IF(E113<=7,"Due Soon","OK"))))';
const cellXml=(xml,address)=>new RegExp(`<c\\b(?=[^>]*\\br="${address}")[^>]*>[\\s\\S]*?<\\/c>`).exec(xml)?.[0]??'';
const formulaXml=cell=>/<f\b[^>]*>[\s\S]*?<\/f>/.exec(cell)?.[0]??/<f\b[^>]*\/>/.exec(cell)?.[0]??'';
const sheetXml=async buffer=>(await JSZip.loadAsync(buffer)).file('xl/worksheets/sheet1.xml').async('string');
const update={assetNumber:'Press 23',assetName:'Sanitized Press 23',taskTitle:'New sanitized staging task',intervalType:'hourly',intervalValue:200,lastCompletedDate:null,lastCompletedMeter:0,currentDate:null,currentMeter:12,remaining:188,status:'Current'};

try{
  const sourceBuffer=fs.readFileSync(fixture);const sourceXml=await sheetXml(sourceBuffer);
  assert.match(formulaXml(cellXml(sourceXml,'E110')),/^<f t="shared" ref="E110:E112" si="0">/,'fixture must contain a shared due-formula master');
  assert.equal(formulaXml(cellXml(sourceXml,'E112')),'<f t="shared" si="0"/>','fixture must reproduce a shared due-formula follower in the final task row');
  assert.equal(formulaXml(cellXml(sourceXml,'F112')),'<f t="shared" si="1"/>','fixture must reproduce a shared status-formula follower in the final task row');
  assert.deepEqual(await validatePmWorkbookOoxml(sourceBuffer),{worksheets:3,formulaCells:12});
  const malformedZip=await JSZip.loadAsync(sourceBuffer);malformedZip.file('xl/worksheets/sheet1.xml',sourceXml.replace('E110&lt;0','E110<0'));const malformedBuffer=Buffer.from(await malformedZip.generateAsync({type:'nodebuffer'}));await assert.rejects(()=>validatePmWorkbookOoxml(malformedBuffer),/not well-formed XML/i);

  const sourceZip=await JSZip.loadAsync(sourceBuffer);const unrelatedBefore=sha(await sourceZip.file('xl/worksheets/sheet3.xml').async('nodebuffer'));
  const result=await synchronizePmWorkbook({sourcePath:fixture,destinationPath:output,backupDir:backups,trackerUpdates:[update],historyRows:[]});
  assert.ok(result.changedCells>=5);
  const outputBuffer=fs.readFileSync(output);const validated=await validatePmWorkbookOoxml(outputBuffer,[{sheetName:'Machine Pm Tracker',address:'E113',formula:dueFormula},{sheetName:'Machine Pm Tracker',address:'F113',formula:statusFormula}]);assert.equal(validated.worksheets,3);
  const outputZip=await JSZip.loadAsync(outputBuffer);const outputXml=await outputZip.file('xl/worksheets/sheet1.xml').async('string');const dueCell=cellXml(outputXml,'E113');const statusCell=cellXml(outputXml,'F113');
  assert.equal(formulaXml(dueCell),`<f>${dueFormula}</f>`,'inserted Due Date must be a complete standalone formula');
  assert.equal(formulaXml(statusCell),'<f>IF(E113="","Needs Date",IF(E113&lt;0,"Past Due",IF(E113=0,"Due Today",IF(E113&lt;=7,"Due Soon","OK"))))</f>','inserted Status must be a complete standalone formula with escaped comparisons');
  assert.doesNotMatch(dueCell,/\bt="(?:shared|e|str)"|<v>#N\/A<\/v>/);assert.doesNotMatch(statusCell,/\bt="(?:shared|e|str)"|<v>#N\/A<\/v>/);assert.doesNotMatch(outputXml,/#REF!|<v>#N\/A<\/v>/);
  assert.equal(formulaXml(cellXml(outputXml,'E112')),'<f t="shared" si="0"/>','existing preceding due formula must remain in its valid shared group');assert.equal(formulaXml(cellXml(outputXml,'F112')),'<f t="shared" si="1"/>','existing preceding status formula must remain in its valid shared group');assert.match(formulaXml(cellXml(outputXml,'E110')),/ref="E110:E112"/);

  const changed=new ExcelJS.Workbook();await changed.xlsx.load(outputBuffer);const tracker=changed.getWorksheet('Machine Pm Tracker');
  assert.equal(tracker.getCell('E113').formula,dueFormula);assert.equal(tracker.getCell('F113').formula,statusFormula);assert.equal(tracker.getCell('E112').formula,'IF(OR(B112="",C112="",D112=""),"",B112-(D112-C112))');assert.equal(tracker.getCell('F112').formula,'IF(E112="","Needs Date",IF(E112<0,"Past Due",IF(E112=0,"Due Today",IF(E112<=7,"Due Soon","OK"))))');
  assert.equal(tracker.getCell('H113').formula,'B113+$C$6+$D113+E$6','relative rows must translate while absolute rows remain fixed');
  assert.equal(tracker.getTable('SanitizedPress23').table.tableRef,'A109:G113');assert.deepEqual(tracker.getCell('F113').dataValidation,tracker.getCell('F112').dataValidation);assert.ok(tracker.conditionalFormattings.some(item=>String(item.ref).split(/\s+/).includes('F110:F113')));assert.equal(tracker.pageSetup.printArea,'A1:G113');
  assert.equal(changed.getWorksheet('PMHistory').getCell('B3').hyperlink,'PDF - Work orders/Press 23/WO-SAN-023.pdf');assert.equal(sha(await outputZip.file('xl/worksheets/sheet3.xml').async('nodebuffer')),unrelatedBefore,'unrelated sheet XML must remain byte-for-byte intact');

  const masterZip=await JSZip.loadAsync(sourceBuffer);let masterXml=sourceXml.replace('ref="E110:E112"','ref="E110:E111"').replace('ref="F110:F112"','ref="F110:F111"');const masterE112=cellXml(masterXml,'E112');const masterF112=cellXml(masterXml,'F112');masterXml=masterXml.replace(masterE112,masterE112.replace('<f t="shared" si="0"/>',`<f t="shared" ref="E112:E112" si="2">${dueFormula.replaceAll('113','112')}</f>`)).replace(masterF112,masterF112.replace('<f t="shared" si="1"/>',`<f t="shared" ref="F112:F112" si="3">${statusFormula.replaceAll('113','112').replaceAll('<','&lt;')}</f>`));masterZip.file('xl/worksheets/sheet1.xml',masterXml);const masterSource=path.join(temporaryRoot,'shared-master-source.xlsx');const masterOutput=path.join(temporaryRoot,'shared-master-output.xlsx');fs.writeFileSync(masterSource,await masterZip.generateAsync({type:'nodebuffer'}));await validatePmWorkbookOoxml(fs.readFileSync(masterSource));await synchronizePmWorkbook({sourcePath:masterSource,destinationPath:masterOutput,backupDir:backups,trackerUpdates:[{...update,taskTitle:'Shared master insertion'}],historyRows:[]});const masterOutputXml=await sheetXml(fs.readFileSync(masterOutput));assert.equal(formulaXml(cellXml(masterOutputXml,'E113')),`<f>${dueFormula}</f>`);assert.equal(formulaXml(cellXml(masterOutputXml,'F113')),'<f>IF(E113="","Needs Date",IF(E113&lt;0,"Past Due",IF(E113=0,"Due Today",IF(E113&lt;=7,"Due Soon","OK"))))</f>');

  await synchronizePmWorkbook({sourcePath:output,destinationPath:output,backupDir:backups,trackerUpdates:[update],historyRows:[]});const retried=fs.readFileSync(output);const retryBook=new ExcelJS.Workbook();await retryBook.xlsx.load(retried);const matches=[];retryBook.getWorksheet('Machine Pm Tracker').eachRow(row=>{if(row.getCell(7).text===update.taskTitle)matches.push(row.number);});assert.deepEqual(matches,[113]);await validatePmWorkbookOoxml(retried,[{sheetName:'Machine Pm Tracker',address:'E113',formula:dueFormula},{sheetName:'Machine Pm Tracker',address:'F113',formula:statusFormula}]);

  const corruptedZip=await JSZip.loadAsync(sourceBuffer);const corruptedXml=sourceXml.replace('<f t="shared" si="0"/><v>188</v>','<f t="shared" si="99"/><v>188</v>');assert.notEqual(corruptedXml,sourceXml);corruptedZip.file('xl/worksheets/sheet1.xml',corruptedXml);const corruptedPath=path.join(temporaryRoot,'corrupted-source.xlsx');fs.writeFileSync(corruptedPath,await corruptedZip.generateAsync({type:'nodebuffer'}));const beforeFailure=sha(fs.readFileSync(output));await assert.rejects(()=>synchronizePmWorkbook({sourcePath:corruptedPath,destinationPath:output,backupDir:backups,trackerUpdates:[{...update,taskTitle:'Final sanitized task'}],historyRows:[]}),/orphaned shared formula follower/i);assert.equal(sha(fs.readFileSync(output)),beforeFailure,'OOXML formula validation failure must prevent workbook replacement');

  console.log(`Direct OOXML/shared-formula regression passed. Inserted Due Date XML: ${formulaXml(dueCell)}`);
  console.log(`Inserted Status XML: ${formulaXml(statusCell)}`);
}finally{if(fs.existsSync(temporaryRoot))fs.rmSync(temporaryRoot,{recursive:true,force:true});}
