import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require=createRequire(import.meta.url);
const ExcelJS=require('../../backend/node_modules/exceljs');
const JSZip=require('../../backend/node_modules/jszip');
const fixtureDir=path.dirname(fileURLToPath(import.meta.url));
const outputPath=path.join(fixtureDir,'pm-report-shared-formulas-sanitized.xlsx');
const workbook=new ExcelJS.Workbook();
workbook.creator='MCC automated sanitized shared-formula fixture';
workbook.created=new Date('2026-01-01T00:00:00Z');
workbook.modified=new Date('2026-01-01T00:00:00Z');

const tracker=workbook.addWorksheet('Machine Pm Tracker',{properties:{defaultRowHeight:19}});
tracker.columns=[{width:16},{width:18},{width:24},{width:24},{width:18},{width:18},{width:38},{width:14,hidden:true}];
tracker.mergeCells('A1:G1');
tracker.getCell('A1').value='SANITIZED SHARED-FORMULA PM TRACKER';
tracker.getCell('A1').font={name:'Aptos Display',size:16,bold:true,color:{argb:'FFFFFFFF'}};
tracker.getCell('A1').fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF17445C'}};
tracker.getCell('A1').alignment={horizontal:'center'};
const headers=['Interval Type','Interval Cycles','Last Completed Date / Last hourly','Today Date / Hourly','Due Date','Status','Task Description'];
const styleHeader=row=>{tracker.getRow(row).values=headers;tracker.getRow(row).font={bold:true,color:{argb:'FFFFFFFF'}};tracker.getRow(row).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF087E91'}};};
const styleTask=row=>{tracker.getRow(row).height=22;tracker.getCell(`E${row}`).numFmt='#,##0';tracker.getCell(`F${row}`).dataValidation={type:'list',allowBlank:false,formulae:['"Needs Date,Past Due,Due Today,Due Soon,OK"']};for(let column=1;column<=7;column+=1)tracker.getCell(row,column).border={bottom:{style:'thin',color:{argb:'FFB7CED8'}}};};
tracker.getRow(4).values=['Press:','1','','Sanitized Header Anchor'];
styleHeader(5);
tracker.getRow(6).values=['Hourly',100,0,5,{formula:'IF(OR(B6="",C6="",D6=""),"",B6-(D6-C6))',result:95},{formula:'IF(E6="","Needs Date",IF(E6<0,"Past Due",IF(E6=0,"Due Today",IF(E6<=7,"Due Soon","OK"))))',result:'OK'},'Header discovery task'];
styleTask(6);

tracker.getRow(105).values=['Press:','23','','Sanitized Press 23'];
tracker.getRow(105).font={bold:true,color:{argb:'FF17445C'}};
tracker.getRow(105).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFDDECF2'}};
styleHeader(106);
tracker.getCell('H106').value='Absolute helper';
for(const [row,interval,last,current,title] of [[107,75,0,5,'Sanitized filters'],[108,90,0,6,'Sanitized guards'],[109,100,0,10,'Sanitized lubrication'],[110,125,0,15,'Sanitized electrical'],[111,150,0,20,'Sanitized inspection'],[112,200,0,12,'Final sanitized task']]){
  const remaining=interval-(current-last);const status=remaining<0?'Past Due':remaining===0?'Due Today':remaining<=7?'Due Soon':'OK';
  tracker.getRow(row).values=['Hourly',interval,last,current,{formula:`IF(OR(B${row}="",C${row}="",D${row}=""),"",B${row}-(D${row}-C${row}))`,result:remaining},{formula:`IF(E${row}="","Needs Date",IF(E${row}<0,"Past Due",IF(E${row}=0,"Due Today",IF(E${row}<=7,"Due Soon","OK"))))`,result:status},title];
  tracker.getCell(`H${row}`).value={formula:`IF("B${row}"="B${row}",SUM(B${row-5}:B${row})+'Reference Only'!$B$3,0)+$D${row}+E$6`,result:interval};
  styleTask(row);
}
tracker.addTable({name:'SanitizedPress23',ref:'A106',headerRow:true,totalsRow:false,style:{theme:'TableStyleMedium2',showRowStripes:true},columns:headers.map(name=>({name})),rows:[107,108,109,110,111,112].map(row=>tracker.getRow(row).values.slice(1,8))});
tracker.addConditionalFormatting({ref:'F107:F112',rules:[{type:'expression',formulae:['F107="Past Due"'],style:{fill:{type:'pattern',pattern:'solid',bgColor:{argb:'FFFFC7CE'}}}}]});
tracker.pageSetup.printArea='A1:G112';

const history=workbook.addWorksheet('PMHistory');
const historyHeaders=['AssetNo','Work order #','Task Status','Start Date','End Date','Work Order Type','Perform By:','Interval Type','Task Type','Task Note'];
history.addTable({name:'SharedFormulaHistory',ref:'A2',headerRow:true,totalsRow:false,style:{theme:'TableStyleMedium2',showRowStripes:true},columns:historyHeaders.map(name=>({name})),rows:[['Press 23',{text:'WO-SAN-023',hyperlink:'PDF - Work orders/Press 23/WO-SAN-023.pdf'},'Completed',new Date('2026-07-01T12:00:00Z'),new Date('2026-07-01T12:00:00Z'),'Preventive Maintenance','Sanitized Technician','Hourly','Final sanitized task','No production data.']]});
history.getRow(2).font={bold:true,color:{argb:'FFFFFFFF'}};
history.getRow(2).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF087E91'}};
history.getCell('D3').numFmt='yyyy-mm-dd';history.getCell('E3').numFmt='yyyy-mm-dd';

const reference=workbook.addWorksheet('Reference Only',{views:[{state:'frozen',ySplit:1}]});
reference.getCell('A1').value='UNRELATED SANITIZED CONTENT';
reference.getCell('A1').font={bold:true,color:{argb:'FFFFFFFF'}};
reference.getCell('A1').fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF6A3C78'}};
reference.getCell('A3').value='Preserved formula';reference.getCell('B3').value={formula:'1+1',result:2};reference.getCell('C3').dataValidation={type:'list',formulae:['"Alpha,Beta"']};

const initial=Buffer.from(await workbook.xlsx.writeBuffer());
const zip=await JSZip.loadAsync(initial);let sheetXml=await zip.file('xl/worksheets/sheet1.xml').async('string');
const escapeFormula=value=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const formulas={
  E:row=>`IF(OR(B${row}="",C${row}="",D${row}=""),"",B${row}-(D${row}-C${row}))`,
  F:row=>`IF(E${row}="","Needs Date",IF(E${row}<0,"Past Due",IF(E${row}=0,"Due Today",IF(E${row}<=7,"Due Soon","OK"))))`,
};
for(const [column,index] of [['E',0],['F',1]])for(const row of [107,108,109,110,111,112]){
  const address=`${column}${row}`;const pattern=new RegExp(`<c\\b(?=[^>]*\\br="${address}")[^>]*>[\\s\\S]*?<\\/c>`);const cell=pattern.exec(sheetXml)?.[0];if(!cell)throw new Error(`Fixture cell ${address} is unavailable.`);const tag=row===107?`<f t="shared" ref="${column}107:${column}112" si="${index}">${escapeFormula(formulas[column](row))}</f>`:`<f t="shared" si="${index}"/>`;sheetXml=sheetXml.replace(cell,cell.replace(/<f\b[^>]*>[\s\S]*?<\/f>/,tag));
}
zip.file('xl/worksheets/sheet1.xml',sheetXml);
for(const entry of Object.values(zip.files))entry.date=new Date('2026-01-01T00:00:00Z');
fs.mkdirSync(fixtureDir,{recursive:true});
fs.writeFileSync(outputPath,await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:6}}));
console.log(outputPath);
