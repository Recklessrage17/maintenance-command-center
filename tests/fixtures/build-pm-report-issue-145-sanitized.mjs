import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require=createRequire(import.meta.url);
const ExcelJS=require('../../backend/node_modules/exceljs');
const JSZip=require('../../backend/node_modules/jszip');
const fixtureDir=path.dirname(fileURLToPath(import.meta.url));
const outputPath=path.join(fixtureDir,'pm-report-issue-145-sanitized.xlsx');
const workbook=new ExcelJS.Workbook();
workbook.creator='MCC Issue 145 sanitized regression fixture';
workbook.created=new Date('2026-09-01T00:00:00Z');
workbook.modified=new Date('2026-09-01T00:00:00Z');

const tracker=workbook.addWorksheet('Machine Pm Tracker',{properties:{defaultRowHeight:19},views:[{state:'frozen',ySplit:1}]});
tracker.columns=[{width:16},{width:18},{width:24},{width:24},{width:18},{width:18},{width:42},{width:16,hidden:true}];
tracker.mergeCells('A1:G1');tracker.getCell('A1').value='SANITIZED ISSUE 145 PM TRACKER';tracker.getCell('A1').font={name:'Aptos Display',size:16,bold:true,color:{argb:'FFFFFFFF'}};tracker.getCell('A1').fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF17445C'}};tracker.getCell('A1').alignment={horizontal:'center'};tracker.getCell('A2').value='Structural regression data only';
const headers=['Interval Type','Interval Cycles','Last Completed Date / Last hourly','Today Date / Hourly','Due Date','Status','Task Description'];
const styleHeading=row=>{tracker.getRow(row).font={bold:true,color:{argb:'FF17445C'}};tracker.getRow(row).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFDDECF2'}};};
const styleHeader=row=>{tracker.getRow(row).values=headers;tracker.getRow(row).font={bold:true,color:{argb:'FFFFFFFF'}};tracker.getRow(row).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF087E91'}};};
const styleTask=row=>{tracker.getRow(row).height=22;tracker.getCell(`F${row}`).dataValidation={type:'list',allowBlank:false,formulae:['"Needs Date,Past Due,Due Today,Due Soon,OK"']};for(let column=1;column<=7;column+=1)tracker.getCell(row,column).border={bottom:{style:'thin',color:{argb:'FFB7CED8'}}};};
const addSection=({headingRow,asset,name,tableName,tasks})=>{
  tracker.getRow(headingRow).values=['Press:',asset,'',name];styleHeading(headingRow);const headerRow=headingRow+1;styleHeader(headerRow);
  for(const task of tasks){const row=task.row;const calendar=task.type==='Days';const remaining=task.interval-(task.current-task.last);const due=task.last+task.interval;const status=remaining<0?'Overdue':remaining===0?'Due Now':remaining<=14?'Due Soon':'Current';const dueCell=calendar?{formula:`C${row}+B${row}`,result:due}:{formula:`IF(OR(B${row}="",C${row}="",D${row}=""),"",B${row}-(D${row}-C${row}))`,result:remaining};const statusCell=calendar?{formula:`IF(E${row}-D${row}<0,"Overdue",IF(E${row}-D${row}=0,"Due Now",IF(E${row}-D${row}<=14,"Due Soon","Current")))`,result:status}:{formula:`IF(E${row}="","Needs Date",IF(E${row}<0,"Past Due",IF(E${row}=0,"Due Today",IF(E${row}<=7,"Due Soon","OK"))))`,result:remaining<0?'Past Due':remaining===0?'Due Today':remaining<=7?'Due Soon':'OK'};tracker.getRow(row).values=[task.type,task.interval,task.last,task.current,dueCell,statusCell,task.title];tracker.getCell(`H${row}`).value={formula:`B${row}&"-"&G${row}`,result:`SANITIZED-${row}`};styleTask(row);}
  tracker.addTable({name:tableName,ref:`A${headerRow}`,headerRow:true,totalsRow:false,style:{theme:'TableStyleMedium2',showRowStripes:true},columns:headers.map(columnName=>({name:columnName})),rows:tasks.map(task=>tracker.getRow(task.row).values.slice(1,8))});
};
addSection({headingRow:4,asset:'40',name:'Sanitized Press 40',tableName:'Issue145Press40',tasks:[{row:6,type:'Days',interval:30,last:45536,current:45550,title:'Inspect guarded connections'},{row:7,type:'Hourly',interval:500,last:1000,current:1100,title:'Lubricate sanitized press'}]});
addSection({headingRow:96,asset:'45',name:'Sanitized Press 45',tableName:'Issue145Press45',tasks:[{row:98,type:'Days',interval:30,last:45536,current:45550,title:'Check and Tighten Electrical Connections'},{row:99,type:'Hourly',interval:1000,last:5000,current:5100,title:'Inspect sanitized hydraulic system'}]});
addSection({headingRow:106,asset:'46',name:'Sanitized Press 46',tableName:'Issue145Press46',tasks:[{row:108,type:'Days',interval:60,last:45520,current:45550,title:'Inspect sanitized safety devices'}]});
for(const row of [6,7,98,99,108])for(const column of ['C','D','E'])tracker.getCell(`${column}${row}`).numFmt=tracker.getCell(`A${row}`).text==='Days'?'yyyy-mm-dd':'#,##0';
tracker.addConditionalFormatting({ref:'F6:F7 F98:F99 F108',rules:[{type:'expression',formulae:['F6="Past Due"'],style:{fill:{type:'pattern',pattern:'solid',bgColor:{argb:'FFFFC7CE'}}}}]});
tracker.pageSetup.printArea='A1:H108';tracker.pageSetup.orientation='landscape';tracker.pageSetup.fitToPage=true;tracker.pageSetup.fitToWidth=1;tracker.pageSetup.fitToHeight=0;

const history=workbook.addWorksheet('PMHistory');const historyHeaders=['AssetNo','Work order #','Task Status','Start Date','End Date','Work Order Type','Perform By:','Interval Type','Task Type','Task Note'];history.addTable({name:'Issue145History',ref:'A2',headerRow:true,totalsRow:false,style:{theme:'TableStyleMedium2',showRowStripes:true},columns:historyHeaders.map(name=>({name})),rows:[['Press 45',{text:'WO-SAN-145',hyperlink:'PDF - Work orders/Press 45/WO-SAN-145.pdf'},'Completed',new Date('2026-09-01T12:00:00Z'),new Date('2026-09-01T12:00:00Z'),'Preventive Maintenance','Sanitized Technician','Days','Check and Tighten Electrical Connections','Sanitized history row.']]});history.getCell('D3').numFmt='yyyy-mm-dd';history.getCell('E3').numFmt='yyyy-mm-dd';
const reference=workbook.addWorksheet('Reference Only',{views:[{state:'frozen',ySplit:1}]});reference.getCell('A1').value='UNRELATED SANITIZED CONTENT';reference.getCell('A1').font={bold:true,color:{argb:'FFFFFFFF'}};reference.getCell('A1').fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF6A3C78'}};reference.getCell('B3').value={formula:'1+1',result:2};reference.getCell('C3').dataValidation={type:'list',formulae:['"Alpha,Beta"']};reference.pageSetup.printArea='A1:C5';

fs.mkdirSync(fixtureDir,{recursive:true});
const zip=await JSZip.loadAsync(Buffer.from(await workbook.xlsx.writeBuffer()));for(const entry of Object.values(zip.files))entry.date=new Date('2026-09-01T00:00:00Z');fs.writeFileSync(outputPath,await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:6}}));
console.log(outputPath);
