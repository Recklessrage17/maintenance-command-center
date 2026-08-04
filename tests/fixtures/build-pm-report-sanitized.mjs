import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require=createRequire(import.meta.url);
const ExcelJS=require('../../backend/node_modules/exceljs');
const fixtureDir=path.dirname(fileURLToPath(import.meta.url));
const outputPath=path.join(fixtureDir,'pm-report-sanitized.xlsx');
const workbook=new ExcelJS.Workbook();
workbook.creator='MCC automated sanitized fixture';
workbook.created=new Date('2026-01-01T00:00:00Z');

const tracker=workbook.addWorksheet('Machine Pm Tracker',{properties:{defaultRowHeight:19}});
tracker.mergeCells('A1:G1');
tracker.getCell('A1').value='SANITIZED MACHINE TRACKER LISTS';
tracker.getCell('A1').font={name:'Aptos Display',size:16,bold:true,color:{argb:'FFFFFFFF'}};
tracker.getCell('A1').fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF17445C'}};
tracker.getCell('A1').alignment={horizontal:'center'};
tracker.getRow(1).height=28;
tracker.getCell('A2').value='STRUCTURAL TEST DATA ONLY';
tracker.columns=[{width:16},{width:18},{width:30},{width:24},{width:18},{width:18},{width:38},{width:12},{width:12},{width:12},{width:12}];

const trackerHeaders=['Interval Type','Interval Cycles','Last Completed Date /\nLast hourly','Today Date / Hourly','Due Date','Status','Task Description'];
const styleSection=row=>{
  tracker.getRow(row).height=24;
  tracker.getRow(row).font={bold:true,color:{argb:'FF17445C'}};
  tracker.getRow(row).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFDDECF2'}};
};
const styleBlock=(headerRow,lastRow,calendarRows)=>{
  tracker.getRow(headerRow).values=trackerHeaders;
  tracker.getRow(headerRow).font={bold:true,color:{argb:'FFFFFFFF'}};
  tracker.getRow(headerRow).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF087E91'}};
  for(let row=headerRow+1;row<=lastRow;row+=1){
    const calendar=calendarRows.includes(row);
    tracker.getRow(row).height=22;
    tracker.getCell(`C${row}`).numFmt=calendar?'yyyy-mm-dd':'#,##0.0';
    tracker.getCell(`D${row}`).numFmt=calendar?'yyyy-mm-dd':'#,##0.0';
    tracker.getCell(`E${row}`).numFmt=calendar?'yyyy-mm-dd':'#,##0.0';
    tracker.getCell(`F${row}`).dataValidation={type:'list',allowBlank:false,formulae:['"Current,Due Soon,Due Now,Overdue"']};
    for(let column=1;column<=7;column+=1)tracker.getCell(row,column).border={bottom:{style:'thin',color:{argb:'FFB7CED8'}}};
  }
};

tracker.getRow(4).values=['Press:','M-100','','Sanitized Press A','','Sanitized Area'];styleSection(4);
styleBlock(5,9,[8,9]);
tracker.getRow(6).values=['Hourly',3000,3456,3560,{formula:'C6+B6',result:6456},{formula:'IF(E6-D6<0,"Overdue","Current")',result:'Current'},'Hydraulic service'];
tracker.getRow(7).values=['Cycle',10000,120000,125000,{formula:'C7+B7',result:130000},{formula:'IF(E7-D7<0,"Overdue","Current")',result:'Current'},'Inspect clamp cycles'];
tracker.getRow(8).values=['Days',30,new Date('2026-07-01T12:00:00Z'),{formula:'DATE(2026,7,20)',result:new Date('2026-07-20T12:00:00Z')},{formula:'C8+B8',result:new Date('2026-07-31T12:00:00Z')},{formula:'IF(E8-D8<=14,"Due Soon","Current")',result:'Due Soon'},'Inspect guards'];
tracker.getRow(9).values=['Annual',365,new Date('2025-08-01T12:00:00Z'),{formula:'DATE(2026,7,20)',result:new Date('2026-07-20T12:00:00Z')},{formula:'C9+B9',result:new Date('2026-08-01T12:00:00Z')},{formula:'IF(E9-D9<=14,"Due Soon","Current")',result:'Due Soon'},'Annual safety review'];
tracker.addTable({name:'SanitizedPress100',ref:'A5',headerRow:true,totalsRow:false,style:{theme:'TableStyleMedium2',showRowStripes:true},columns:trackerHeaders.map(name=>({name})),rows:[6,7,8,9].map(row=>tracker.getRow(row).values.slice(1,8))});

tracker.getRow(14).values=['Press:','M-200','','Sanitized Press B','','Sanitized Area'];styleSection(14);
styleBlock(15,17,[16]);
tracker.getRow(16).values=['Days',45,new Date('2026-06-15T12:00:00Z'),{formula:'DATE(2026,7,20)',result:new Date('2026-07-20T12:00:00Z')},{formula:'C16+B16',result:new Date('2026-07-30T12:00:00Z')},{formula:'IF(E16-D16<=14,"Due Soon","Current")',result:'Due Soon'},'Inspect guards'];
tracker.getRow(17).values=['Hourly',1500,8000,8250,{formula:'C17+B17',result:9500},{formula:'IF(E17-D17<0,"Overdue","Current")',result:'Current'},'Lubrication service'];
tracker.addTable({name:'SanitizedPress200',ref:'A15',headerRow:true,totalsRow:false,style:{theme:'TableStyleMedium2',showRowStripes:true},columns:trackerHeaders.map(name=>({name})),rows:[16,17].map(row=>tracker.getRow(row).values.slice(1,8))});

const history=workbook.addWorksheet('PMHistory');
history.getCell('A1').value='SANITIZED PM HISTORY';
history.getCell('A1').font={size:15,bold:true,color:{argb:'FFFFFFFF'}};
history.getCell('A1').fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF17445C'}};
const helperHeaders=Array.from({length:10},(_,index)=>`Helper ${index+1}`);
const historyHeaders=['AssetNo','Work order #','Task Status','Start Date','End Date','Work Order Type','Perform By:','Interval Type','Task Type','Task Note',...helperHeaders];
history.columns=[{width:16},{width:20},{width:16},{width:14},{width:14},{width:24},{width:20},{width:16},{width:32},{width:52},...helperHeaders.map(()=>({width:18,hidden:true}))];
const helperValues=row=>Array.from({length:10},(_,index)=>({formula:index===0?`A${row}&"-"&B${row}`:`K${row}&"-H${index+1}"`,result:`SANITIZED-${row}-H${index+1}`}));
const sharedWorkOrder='WO-SAN-SHARED';
const populatedHistory=[
  ['M-100',sharedWorkOrder,'Completed',new Date('2026-06-01T12:00:00Z'),new Date('2026-06-01T12:00:00Z'),'Preventive Maintenance','Sanitized Technician','Days','Inspect guards','PM completed. No issues found.'],
  ['M-100',sharedWorkOrder,'Completed',new Date('2026-06-02T12:00:00Z'),new Date('2026-06-02T12:00:00Z'),'Preventive Maintenance','Sanitized Technician','Annual','Annual safety review','Annual PM completed. No issues found.'],
  ['M-200',sharedWorkOrder,'Completed',new Date('2026-06-03T12:00:00Z'),new Date('2026-06-03T12:00:00Z'),'Preventive Maintenance','Sanitized Technician','Days','Inspect guards','PM completed. No issues found.'],
  ['M-100',sharedWorkOrder,'Completed',new Date('2026-06-01T12:00:00Z'),new Date('2026-06-01T12:00:00Z'),'Preventive Maintenance','Sanitized Technician','Days','Inspect guards','PM completed. No issues found.'],
];
const historyTableRows=[];
for(let row=6;row<=50;row+=1){const data=populatedHistory[row-6]??Array(10).fill(null);historyTableRows.push([...data,...helperValues(row)]);}
history.addTable({name:'PMHistoryTable',ref:'A5',headerRow:true,totalsRow:false,style:{theme:'TableStyleMedium2',showRowStripes:true},columns:historyHeaders.map(name=>({name})),rows:historyTableRows});
history.getRow(5).font={bold:true,color:{argb:'FFFFFFFF'}};
history.getRow(5).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF087E91'}};
for(let row=6;row<=50;row+=1){
  history.getCell(`C${row}`).dataValidation={type:'list',allowBlank:true,formulae:['"Completed,Open,Hold"']};
  history.getCell(`D${row}`).numFmt='yyyy-mm-dd';
  history.getCell(`E${row}`).numFmt='yyyy-mm-dd';
  history.getRow(row).height=30;
  for(let column=1;column<=20;column+=1){history.getCell(row,column).border={bottom:{style:'thin',color:{argb:'FFB7CED8'}}};history.getCell(row,column).alignment={vertical:'middle',wrapText:column===10};}
}

const reference=workbook.addWorksheet('Reference Only',{views:[{state:'frozen',ySplit:2}]});
reference.mergeCells('A1:D1');
reference.getCell('A1').value='UNRELATED SHEET — MUST REMAIN UNCHANGED';
reference.getCell('A1').font={bold:true,color:{argb:'FFFFFFFF'}};
reference.getCell('A1').fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF6A3C78'}};
reference.getCell('A3').value='Helper formula';
reference.getCell('B3').value={formula:'1+1',result:2};
reference.getCell('C3').dataValidation={type:'list',formulae:['"Alpha,Beta,Gamma"']};
reference.getCell('A5').value='Hidden preservation row';
reference.getColumn(1).width=32;
reference.getColumn(4).hidden=true;
reference.getRow(1).height=27;
reference.getRow(5).hidden=true;
reference.autoFilter='A2:C5';
reference.pageSetup={orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:1,paperSize:9};
reference.pageMargins={left:0.25,right:0.25,top:0.5,bottom:0.5,header:0.2,footer:0.2};
reference.headerFooter={oddHeader:'&C SANITIZED REFERENCE',oddFooter:'&R Page &P of &N'};

fs.mkdirSync(fixtureDir,{recursive:true});
await workbook.xlsx.writeFile(outputPath);
console.log(outputPath);
