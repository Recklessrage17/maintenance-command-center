import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require=createRequire(import.meta.url);
const ExcelJS=require('../../backend/node_modules/exceljs');
const fixtureDir=path.dirname(fileURLToPath(import.meta.url));
const outputPath=path.join(fixtureDir,'pm-report-sanitized.xlsx');
const workbook=new ExcelJS.Workbook();
workbook.creator='MCC automated test fixture';
workbook.created=new Date('2026-01-01T00:00:00Z');

const tracker=workbook.addWorksheet('Machine Pm Tracker',{views:[{state:'frozen',ySplit:3}],properties:{defaultRowHeight:19}});
tracker.mergeCells('A1:I1');tracker.getCell('A1').value='SANITIZED PM REPORT FIXTURE';tracker.getCell('A1').font={name:'Aptos Display',size:16,bold:true,color:{argb:'FFFFFFFF'}};tracker.getCell('A1').fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF17445C'}};tracker.getCell('A1').alignment={horizontal:'center'};tracker.getRow(1).height=28;
tracker.getRow(3).values=['Asset Number','Asset Name','PM Task','Interval Type','Interval Value','Last Completed','Current','Remaining','Status'];
tracker.getRow(3).font={bold:true,color:{argb:'FFFFFFFF'}};tracker.getRow(3).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF087E91'}};tracker.autoFilter='A3:I7';
tracker.columns=[{width:16},{width:24},{width:34},{width:16},{width:16},{width:18},{width:18},{width:18},{width:16}];
tracker.addRow(['M-100','Sanitized Press','Hydraulic service','Hourly',3000,3456,3560,{formula:'F4+E4-G4',result:2896},'Current']);
tracker.addRow(['M-100','Sanitized Press','Inspect clamp cycles','Cycles',10000,120000,125000,{formula:'F5+E5-G5',result:5000},'Current']);
tracker.addRow(['M-100','Sanitized Press','Inspect guards','Days',30,new Date('2026-07-01T12:00:00Z'),new Date('2026-07-20T12:00:00Z'),{formula:'F6+E6-G6',result:11},'Due Soon']);
tracker.addRow(['M-100','Sanitized Press','Annual safety review','Annual',1,new Date('2025-08-01T12:00:00Z'),new Date('2026-07-20T12:00:00Z'),{formula:'EDATE(F7,12)-G7',result:12},'Due Soon']);
for(let row=4;row<=7;row+=1){tracker.getRow(row).height=22;tracker.getCell(`F${row}`).numFmt=row>=6?'yyyy-mm-dd':'#,##0.0';tracker.getCell(`G${row}`).numFmt=row>=6?'yyyy-mm-dd':'#,##0.0';tracker.getCell(`H${row}`).numFmt='#,##0.0';tracker.getCell(`I${row}`).dataValidation={type:'list',allowBlank:false,formulae:['"Current,Due Soon,Due Now,Overdue"']};for(let column=1;column<=9;column+=1){tracker.getCell(row,column).border={bottom:{style:'thin',color:{argb:'FFB7CED8'}}};}}

const history=workbook.addWorksheet('PMHistory',{views:[{state:'frozen',ySplit:2}]});
history.mergeCells('A1:K1');history.getCell('A1').value='SANITIZED PM COMPLETION HISTORY';history.getCell('A1').font={size:15,bold:true,color:{argb:'FFFFFFFF'}};history.getCell('A1').fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF17445C'}};history.getCell('A1').alignment={horizontal:'center'};
const historyHeaders=['Asset Number','Work Order Number','Task Status','Start Date','End Date','Work Order Type','Performed By','Interval Type','Task Type','Task Note','Audit Helper'];
history.columns=[{width:16},{width:20},{width:16},{width:14},{width:14},{width:24},{width:20},{width:16},{width:32},{width:52},{width:28}];
history.addTable({name:'PMHistoryTable',ref:'A2',headerRow:true,totalsRow:false,style:{theme:'TableStyleMedium2',showRowStripes:true},columns:historyHeaders.map(name=>({name})),rows:[['M-100','WO-SAN-001','Completed',new Date('2026-06-01T12:00:00Z'),new Date('2026-06-01T12:00:00Z'),'Preventive Maintenance','Sanitized Technician','Days','Inspect guards','PM completed. No issues found.',{formula:'A3&"-"&B3',result:'M-100-WO-SAN-001'}]]});
history.getRow(2).font={bold:true,color:{argb:'FFFFFFFF'}};history.getRow(2).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF087E91'}};
history.getCell('C3').dataValidation={type:'list',allowBlank:false,formulae:['"Completed,Open,Hold"']};history.getCell('D3').numFmt='yyyy-mm-dd';history.getCell('E3').numFmt='yyyy-mm-dd';history.getRow(3).height=30;for(let column=1;column<=11;column+=1){history.getCell(3,column).border={bottom:{style:'thin',color:{argb:'FFB7CED8'}}};history.getCell(3,column).alignment={vertical:'middle',wrapText:column===10};}

const reference=workbook.addWorksheet('Reference Only');reference.mergeCells('A1:D1');reference.getCell('A1').value='UNRELATED SHEET — MUST REMAIN UNCHANGED';reference.getCell('A1').font={bold:true,color:{argb:'FFFFFFFF'}};reference.getCell('A1').fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF6A3C78'}};reference.getCell('A3').value='Helper formula';reference.getCell('B3').value={formula:'1+1',result:2};reference.getCell('C3').dataValidation={type:'list',formulae:['"Alpha,Beta,Gamma"']};reference.getColumn(1).width=32;reference.getRow(1).height=27;reference.pageSetup={orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:1};

fs.mkdirSync(fixtureDir,{recursive:true});
await workbook.xlsx.writeFile(outputPath);
console.log(outputPath);
