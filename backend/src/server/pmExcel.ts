import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

export const PM_TRACKER_SHEET = 'Machine Pm Tracker';
export const PM_HISTORY_SHEET = 'PMHistory';
export const PM_EXCEL_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export type WorkbookPmInterval = 'hourly' | 'cycles' | 'days' | 'annual';
export type WorkbookPmStatus = 'Current' | 'Due Soon' | 'Due Now' | 'Overdue';

export type ParsedTrackerRow = {
  rowNumber:number;
  assetNumber:string;
  assetName:string;
  taskTitle:string;
  intervalType:WorkbookPmInterval;
  intervalValue:number;
  lastCompletedDate:string|null;
  lastCompletedMeter:number|null;
  currentDate:string|null;
  currentMeter:number|null;
  remaining:number;
  status:WorkbookPmStatus;
};

export type ParsedHistoryRow = {
  rowNumber:number;
  assetNumber:string;
  workOrderNumber:string;
  taskStatus:string;
  startDate:string;
  completionDate:string;
  workOrderType:string;
  performedBy:string;
  intervalType:WorkbookPmInterval;
  taskType:string;
  taskNote:string;
  sourceRef:string;
};

export type RejectedWorkbookRow = { sheet:string; rowNumber:number; reason:string };
export type ParsedPmWorkbook = {
  trackerRows:ParsedTrackerRow[];
  historyRows:ParsedHistoryRow[];
  warnings:Array<{sheet:string;rowNumber:number;message:string}>;
  rejectedRows:RejectedWorkbookRow[];
  trackerHeaderRow:number;
  historyHeaderRow:number;
  sheetNames:string[];
};

export type TrackerWorkbookUpdate = {
  assetNumber:string;
  taskTitle:string;
  intervalType:WorkbookPmInterval;
  matchTaskTitle?:string;
  matchIntervalType?:WorkbookPmInterval;
  intervalValue:number;
  lastCompletedDate:string|null;
  lastCompletedMeter:number|null;
  currentDate:string|null;
  currentMeter:number|null;
  remaining:number;
  status:WorkbookPmStatus;
};

export type HistoryWorkbookAppend = {
  assetNumber:string;
  workOrderNumber:string;
  taskStatus:string;
  startDate:string;
  completionDate:string;
  workOrderType:string;
  performedBy:string;
  intervalType:WorkbookPmInterval;
  taskType:string;
  taskNote:string;
};

type TrackerField = 'assetNumber'|'assetName'|'taskTitle'|'intervalType'|'intervalValue'|'lastCompleted'|'current'|'remaining'|'status';
type HistoryField = 'assetNumber'|'workOrderNumber'|'taskStatus'|'startDate'|'completionDate'|'workOrderType'|'performedBy'|'intervalType'|'taskType'|'taskNote';
type HeaderMap<Field extends string> = { rowNumber:number; columns:Record<Field,number> };

const trackerAliases:Record<TrackerField,string[]> = {
  assetNumber:['Asset Number','Asset #','Asset No','Machine Number','Machine #','Machine No','Press Number','Press #','Press'],
  assetName:['Asset Name','Machine Name','Equipment Name','Name'],
  taskTitle:['PM Task','Task','Task Type','PM Task Type','PM Description','Task Description'],
  intervalType:['Interval Type','PM Interval Type','Frequency Type','Interval Unit','Frequency Unit'],
  intervalValue:['Interval Value','Interval Amount','PM Interval','PM Frequency','Frequency','Interval'],
  lastCompleted:['Last Completed','Last Completed Value','Last Completed Date or Meter','Last Completed Date / Meter','Last PM','Last PM Date / Meter','Last PM Date/Hour','Last Completed Date','Last Completed Meter'],
  current:['Current','Current Value','Current Date or Meter','Current Date / Meter','Current Reading','Current Meter','Current Date','Current Date/Hour'],
  remaining:['Remaining','Remaining Value','Hours Remaining','Cycles Remaining','Days Remaining','Hours left/Days left','Hours Left / Days Left'],
  status:['Status','PM Status','Task Status'],
};

const historyAliases:Record<HistoryField,string[]> = {
  assetNumber:['Asset Number','Asset #','Asset No','Machine Number','Machine #','Press Number','Press #','Press'],
  workOrderNumber:['Work-order Number','Work Order Number','Work-order #','Work Order #','WO Number','WO #'],
  taskStatus:['Task Status','Status','Work Order Status'],
  startDate:['Start Date','Started Date','Work Order Start Date'],
  completionDate:['End Date','Completion Date','Completed Date','Work Order End Date'],
  workOrderType:['Work-order Type','Work Order Type','WO Type'],
  performedBy:['Performed By','Completed By','Technician'],
  intervalType:['Interval Type','PM Interval Type','Frequency Type'],
  taskType:['Task Type','PM Task','Task','PM Task Type'],
  taskNote:['Task Note','Task Notes','Completion Note','Completion Notes','Notes'],
};

const trackerRequired:TrackerField[]=['assetNumber','taskTitle','intervalType','intervalValue','lastCompleted','current','remaining','status'];
const historyRequired:HistoryField[]=['assetNumber','workOrderNumber','taskStatus','startDate','completionDate','workOrderType','performedBy','intervalType','taskType','taskNote'];

function cleanText(value:unknown) { return String(value ?? '').replace(/\r/g,'').trim(); }
export function normalizedPmKey(value:unknown) { return cleanText(value).replace(/[\u2010-\u2015]/g,'-').replace(/\s+/g,' ').toLowerCase(); }
function normalizedHeader(value:unknown) { return normalizedPmKey(value).replace(/[^a-z0-9]+/g,''); }
function safeClone<T>(value:T):T { return value===undefined?value:structuredClone(value); }

function cellRawValue(cell:ExcelJS.Cell):unknown {
  const value=cell.value;
  if (value && typeof value==='object') {
    if ('result' in value && (value as {result?:unknown}).result!==undefined) return (value as {result?:unknown}).result;
    if ('richText' in value) return (value as {richText:Array<{text:string}>}).richText.map(part=>part.text).join('');
    if ('text' in value) return (value as {text:unknown}).text;
  }
  return value;
}

function findHeader<Field extends string>(sheet:ExcelJS.Worksheet, aliases:Record<Field,string[]>, required:Field[]):HeaderMap<Field> {
  const aliasMap=new Map<string,Field>();
  for (const [field,values] of Object.entries(aliases) as Array<[Field,string[]]>) for (const alias of values) aliasMap.set(normalizedHeader(alias),field);
  let best:{rowNumber:number;columns:Partial<Record<Field,number>>;score:number}|null=null;
  const maxRow=Math.min(Math.max(sheet.rowCount,1),30);
  const maxColumn=Math.min(Math.max(sheet.columnCount,1),100);
  for (let rowNumber=1;rowNumber<=maxRow;rowNumber+=1) {
    const columns:Partial<Record<Field,number>>={};
    for (let column=1;column<=maxColumn;column+=1) {
      const match=aliasMap.get(normalizedHeader(cellRawValue(sheet.getCell(rowNumber,column))));
      if (match && columns[match]===undefined) columns[match]=column;
    }
    const score=required.filter(field=>columns[field]!==undefined).length;
    if (!best || score>best.score) best={rowNumber,columns,score};
  }
  const missing=required.filter(field=>best?.columns[field]===undefined);
  if (missing.length) throw new Error(`${sheet.name} is missing required columns: ${missing.map(field=>aliases[field][0]).join(', ')}.`);
  return {rowNumber:best!.rowNumber,columns:best!.columns as Record<Field,number>};
}

function isoDate(value:unknown,label:string) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0,10);
  if (typeof value==='number' && Number.isFinite(value)) {
    const date=new Date(Date.UTC(1899,11,30)+Math.round(value*86400000));
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0,10);
  }
  const clean=cleanText(value);
  if (!clean) throw new Error(`${label} is required.`);
  let candidate=clean;
  const american=/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(clean);
  if (american) candidate=`${american[3]}-${american[1].padStart(2,'0')}-${american[2].padStart(2,'0')}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) throw new Error(`${label} must be a valid date.`);
  const parsed=new Date(`${candidate}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0,10)!==candidate) throw new Error(`${label} must be a valid date.`);
  return candidate;
}

function optionalIsoDate(value:unknown,label:string) { return cleanText(value)===''?null:isoDate(value,label); }
function requiredNumber(value:unknown,label:string,integer=false) {
  const parsed=typeof value==='number'?value:Number(cleanText(value).replace(/,/g,''));
  if (!Number.isFinite(parsed) || parsed<0 || (integer&&!Number.isInteger(parsed))) throw new Error(`${label} must be a valid non-negative ${integer?'whole ':''}number.`);
  return parsed;
}
function positiveNumber(value:unknown,label:string,integer=false) {
  const parsed=requiredNumber(value,label,integer);
  if (parsed<=0) throw new Error(`${label} must be greater than zero.`);
  return parsed;
}

export function normalizeWorkbookInterval(value:unknown):WorkbookPmInterval {
  const normalized=normalizedPmKey(value).replace(/\.$/,'');
  if (normalized==='hourly'||normalized==='hour'||normalized==='hours') return 'hourly';
  if (normalized==='cycle'||normalized==='cycles') return 'cycles';
  if (normalized==='day'||normalized==='days') return 'days';
  if (normalized==='annual'||normalized==='annually'||normalized==='year'||normalized==='yearly') return 'annual';
  throw new Error('Interval Type must be Hourly, Cycle/Cycles, Days, or Annual.');
}

function addDays(date:string,days:number) { const value=new Date(`${date}T12:00:00Z`);value.setUTCDate(value.getUTCDate()+days);return value.toISOString().slice(0,10); }
function addMonths(date:string,months:number) { const value=new Date(`${date}T12:00:00Z`);const day=value.getUTCDate();value.setUTCDate(1);value.setUTCMonth(value.getUTCMonth()+months);const last=new Date(Date.UTC(value.getUTCFullYear(),value.getUTCMonth()+1,0,12)).getUTCDate();value.setUTCDate(Math.min(day,last));return value.toISOString().slice(0,10); }
function dayDifference(later:string,earlier:string) { return Math.round((Date.parse(`${later}T12:00:00Z`)-Date.parse(`${earlier}T12:00:00Z`))/86400000); }

export function calculateWorkbookPm(input:{intervalType:WorkbookPmInterval;intervalValue:number;lastCompletedDate?:string|null;lastCompletedMeter?:number|null;currentDate?:string|null;currentMeter?:number|null}) {
  const {intervalType}=input;
  if (intervalType==='hourly'||intervalType==='cycles') {
    const last=input.lastCompletedMeter;
    const current=input.currentMeter;
    if (last===null||last===undefined||current===null||current===undefined) throw new Error('Last completed and current meter values are required.');
    const nextDue=last+input.intervalValue;
    const remaining=nextDue-current;
    const threshold=Math.max(1,input.intervalValue*0.1);
    const status:WorkbookPmStatus=remaining<0?'Overdue':remaining===0?'Due Now':remaining<=threshold?'Due Soon':'Current';
    return {nextDueDate:null,nextDueMeter:nextDue,remaining,status};
  }
  if (!input.lastCompletedDate||!input.currentDate) throw new Error('Last completed and current dates are required.');
  const nextDueDate=intervalType==='annual'?addMonths(input.lastCompletedDate,12):addDays(input.lastCompletedDate,input.intervalValue);
  const remaining=dayDifference(nextDueDate,input.currentDate);
  const status:WorkbookPmStatus=remaining<0?'Overdue':remaining===0?'Due Now':remaining<=14?'Due Soon':'Current';
  return {nextDueDate,nextDueMeter:null,remaining,status};
}

export function defaultPmCompletionNote(intervalType:WorkbookPmInterval,reading:number|null) {
  if (intervalType==='hourly') return `PM completed at ${Number(reading).toLocaleString('en-US',{maximumFractionDigits:6})} machine hours. No issues found.`;
  if (intervalType==='cycles') return `PM completed at ${Number(reading).toLocaleString('en-US',{maximumFractionDigits:0})} cycles. No issues found.`;
  return 'PM completed. No issues found.';
}

export function meaningfulPmNote(value:unknown) { const clean=cleanText(value);return clean.length>=5&&/[A-Za-z0-9]/.test(clean); }

function parseTrackerRow(sheet:ExcelJS.Worksheet,rowNumber:number,header:HeaderMap<TrackerField>):ParsedTrackerRow|null {
  const value=(field:TrackerField)=>cellRawValue(sheet.getCell(rowNumber,header.columns[field]));
  const assetNumber=cleanText(value('assetNumber'));
  const taskTitle=cleanText(value('taskTitle'));
  const intervalText=cleanText(value('intervalType'));
  if (!assetNumber&&!taskTitle&&!intervalText) return null;
  if (!assetNumber) throw new Error('Asset Number is required.');
  if (!taskTitle) throw new Error('PM Task is required.');
  const intervalType=normalizeWorkbookInterval(intervalText);
  const meter=intervalType==='hourly'||intervalType==='cycles';
  const intervalValue=intervalType==='annual'?12:positiveNumber(value('intervalValue'),'Interval Value',intervalType!=='hourly');
  const lastCompletedDate=meter?null:isoDate(value('lastCompleted'),'Last Completed');
  const lastCompletedMeter=meter?requiredNumber(value('lastCompleted'),'Last Completed',intervalType==='cycles'):null;
  const currentDate=meter?null:isoDate(value('current'),'Current Date');
  const currentMeter=meter?requiredNumber(value('current'),'Current Meter',intervalType==='cycles'):null;
  const calculated=calculateWorkbookPm({intervalType,intervalValue,lastCompletedDate,lastCompletedMeter,currentDate,currentMeter});
  return {rowNumber,assetNumber,assetName:header.columns.assetName?cleanText(value('assetName')):'',taskTitle,intervalType,intervalValue,lastCompletedDate,lastCompletedMeter,currentDate,currentMeter,remaining:calculated.remaining,status:calculated.status};
}

function historySourceRef(input:Omit<ParsedHistoryRow,'rowNumber'|'sourceRef'>) {
  const values=[input.assetNumber,input.workOrderNumber,input.taskStatus,input.startDate,input.completionDate,input.workOrderType,input.performedBy,input.intervalType,input.taskType,input.taskNote].map(normalizedPmKey);
  return crypto.createHash('sha256').update(values.join('\u001f')).digest('hex');
}

function parseHistoryRow(sheet:ExcelJS.Worksheet,rowNumber:number,header:HeaderMap<HistoryField>):ParsedHistoryRow|null {
  const value=(field:HistoryField)=>cellRawValue(sheet.getCell(rowNumber,header.columns[field]));
  const assetNumber=cleanText(value('assetNumber'));
  const taskType=cleanText(value('taskType'));
  const workOrderNumber=cleanText(value('workOrderNumber'));
  if (!assetNumber&&!taskType&&!workOrderNumber) return null;
  if (!assetNumber) throw new Error('Asset Number is required.');
  if (!taskType) throw new Error('Task Type is required.');
  if (!workOrderNumber) throw new Error('Work-order Number is required.');
  const taskStatus=cleanText(value('taskStatus'));
  const startDate=isoDate(value('startDate'),'Start Date');
  const completionDate=isoDate(value('completionDate'),'End/Completion Date');
  const workOrderType=cleanText(value('workOrderType'));
  const performedBy=cleanText(value('performedBy'));
  const intervalType=normalizeWorkbookInterval(value('intervalType'));
  const taskNote=cleanText(value('taskNote'));
  if (!taskStatus||!workOrderType||!performedBy) throw new Error('Task Status, Work-order Type, and Performed By are required.');
  const base={assetNumber,workOrderNumber,taskStatus,startDate,completionDate,workOrderType,performedBy,intervalType,taskType,taskNote};
  return {rowNumber,...base,sourceRef:historySourceRef(base)};
}

export async function inspectPmWorkbook(buffer:Buffer):Promise<ParsedPmWorkbook> {
  if (buffer.length<4||buffer[0]!==0x50||buffer[1]!==0x4b) throw new Error('Upload a valid .xlsx workbook.');
  const workbook=new ExcelJS.Workbook();
  const arrayBuffer=buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength) as ArrayBuffer;
  await workbook.xlsx.load(arrayBuffer);
  const tracker=workbook.getWorksheet(PM_TRACKER_SHEET);
  const history=workbook.getWorksheet(PM_HISTORY_SHEET);
  if (!tracker||!history) throw new Error(`Workbook must contain ${PM_TRACKER_SHEET} and ${PM_HISTORY_SHEET}.`);
  const trackerHeader=findHeader(tracker,trackerAliases,trackerRequired);
  const historyHeader=findHeader(history,historyAliases,historyRequired);
  const trackerRows:ParsedTrackerRow[]=[];const historyRows:ParsedHistoryRow[]=[];const rejectedRows:RejectedWorkbookRow[]=[];const warnings:ParsedPmWorkbook['warnings']=[];
  for (let rowNumber=trackerHeader.rowNumber+1;rowNumber<=tracker.rowCount;rowNumber+=1) {
    try {
      const row=parseTrackerRow(tracker,rowNumber,trackerHeader);if (!row) continue;trackerRows.push(row);
      const supplied=cellRawValue(tracker.getCell(rowNumber,trackerHeader.columns.remaining));
      if (cleanText(supplied)!=='') { const numeric=Number(cleanText(supplied).replace(/,/g,''));if (Number.isFinite(numeric)&&Math.abs(numeric-row.remaining)>0.000001) warnings.push({sheet:PM_TRACKER_SHEET,rowNumber,message:`Remaining value will be recalculated from the MCC baseline (${row.remaining}).`}); }
      const status=cleanText(cellRawValue(tracker.getCell(rowNumber,trackerHeader.columns.status)));
      if (status&&normalizedPmKey(status)!==normalizedPmKey(row.status)) warnings.push({sheet:PM_TRACKER_SHEET,rowNumber,message:`Status will be recalculated as ${row.status}.`});
    } catch (error) { rejectedRows.push({sheet:PM_TRACKER_SHEET,rowNumber,reason:error instanceof Error?error.message:'Invalid PM tracker row.'}); }
  }
  for (let rowNumber=historyHeader.rowNumber+1;rowNumber<=history.rowCount;rowNumber+=1) {
    try { const row=parseHistoryRow(history,rowNumber,historyHeader);if (row) historyRows.push(row); }
    catch (error) { rejectedRows.push({sheet:PM_HISTORY_SHEET,rowNumber,reason:error instanceof Error?error.message:'Invalid PM history row.'}); }
  }
  return {trackerRows,historyRows,warnings,rejectedRows,trackerHeaderRow:trackerHeader.rowNumber,historyHeaderRow:historyHeader.rowNumber,sheetNames:workbook.worksheets.map(sheet=>sheet.name)};
}

function workbookValue(value:string|number|null,date=false) { if (value===null) return null;if (date&&typeof value==='string') return new Date(`${value}T12:00:00Z`);return value; }
function sameCellValue(cell:ExcelJS.Cell,value:unknown) {
  const current=cellRawValue(cell);
  if (current instanceof Date&&value instanceof Date) return current.toISOString().slice(0,10)===value.toISOString().slice(0,10);
  if (typeof current==='number'&&typeof value==='number') return Math.abs(current-value)<0.000001;
  return cleanText(current)===cleanText(value);
}
function setTargetCell(cell:ExcelJS.Cell,value:unknown) {
  if (cell.type===ExcelJS.ValueType.Formula) return false;
  if (sameCellValue(cell,value)) return false;
  cell.value=value as ExcelJS.CellValue;
  return true;
}

function xmlAttribute(tag:string,name:string){const match=new RegExp(`(?:^|\\s)${name.replace(':','\\:')}="([^"]*)"`).exec(tag);return match?.[1]??'';}
function decodeXml(value:string){return value.replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');}
function relationshipPart(part:string){return path.posix.join(path.posix.dirname(part),'_rels',`${path.posix.basename(part)}.rels`);}
function relationshipTarget(ownerPart:string,target:string){if(target.startsWith('/'))return target.slice(1);return path.posix.normalize(path.posix.join(path.posix.dirname(ownerPart),target));}

async function restoreUnrelatedWorksheetParts(sourcePath:string,generatedPath:string){
  const [sourceZip,generatedZip]=await Promise.all([JSZip.loadAsync(fs.readFileSync(sourcePath)),JSZip.loadAsync(fs.readFileSync(generatedPath))]);
  async function sheetParts(zip:JSZip){const workbookXml=await zip.file('xl/workbook.xml')?.async('string');const relationshipsXml=await zip.file('xl/_rels/workbook.xml.rels')?.async('string');if(!workbookXml||!relationshipsXml)throw new Error('Workbook package relationships are unreadable.');const targets=new Map<string,string>();for(const match of relationshipsXml.matchAll(/<Relationship\b[^>]*\/?\s*>/g)){const tag=match[0];const id=xmlAttribute(tag,'Id');const target=xmlAttribute(tag,'Target');if(id&&target)targets.set(id,relationshipTarget('xl/workbook.xml',decodeXml(target)));}const parts=new Map<string,string>();for(const match of workbookXml.matchAll(/<sheet\b[^>]*\/?\s*>/g)){const tag=match[0];const name=decodeXml(xmlAttribute(tag,'name'));const target=targets.get(xmlAttribute(tag,'r:id'));if(name&&target)parts.set(name,target);}return parts;}
  const [sourceParts,generatedParts]=await Promise.all([sheetParts(sourceZip),sheetParts(generatedZip)]);
  const sourceShared=await sourceZip.file('xl/sharedStrings.xml')?.async('string');const generatedShared=await generatedZip.file('xl/sharedStrings.xml')?.async('string');
  if(sourceShared&&generatedShared){const sourceEntries=[...sourceShared.matchAll(/<si\b[^>]*>[\s\S]*?<\/si>/g)].map(match=>match[0]);const generatedEntries=[...generatedShared.matchAll(/<si\b[^>]*>[\s\S]*?<\/si>/g)].map(match=>match[0]);const combined=[...sourceEntries];const indexes=new Map(combined.map((entry,index)=>[entry,index]));const remap=generatedEntries.map(entry=>{const existing=indexes.get(entry);if(existing!==undefined)return existing;const index=combined.length;combined.push(entry);indexes.set(entry,index);return index;});const first=sourceShared.search(/<si\b/);const last=sourceShared.lastIndexOf('</si>');if(first>=0&&last>=first){let merged=`${sourceShared.slice(0,first)}${combined.join('')}${sourceShared.slice(last+5)}`;merged=merged.replace(/\bcount="\d+"/,`count="${combined.length}"`).replace(/\buniqueCount="\d+"/,`uniqueCount="${combined.length}"`);generatedZip.file('xl/sharedStrings.xml',merged);for(const name of [PM_TRACKER_SHEET,PM_HISTORY_SHEET]){const part=generatedParts.get(name);if(!part)continue;const file=generatedZip.file(part);if(!file)continue;const xml=await file.async('string');const remapped=xml.replace(/<c\b([^>]*\bt="s"[^>]*)>([\s\S]*?)<\/c>/g,(cell,attributes,body)=>`<c${attributes}>${String(body).replace(/<v>(\d+)<\/v>/,(_value,index)=>`<v>${remap[Number(index)]??Number(index)}</v>`)}</c>`);generatedZip.file(part,remapped);}}}
  const copied=new Set<string>();
  async function copyPart(part:string):Promise<void>{
    if(copied.has(part))return;copied.add(part);const sourceFile=sourceZip.file(part);if(!sourceFile)return;generatedZip.file(part,await sourceFile.async('nodebuffer'));
    const relPart=relationshipPart(part);const relFile=sourceZip.file(relPart);if(!relFile)return;const relXml=await relFile.async('string');generatedZip.file(relPart,Buffer.from(relXml));
    for(const match of relXml.matchAll(/<Relationship\b[^>]*\/?\s*>/g)){const tag=match[0];if(/TargetMode="External"/i.test(tag))continue;const target=xmlAttribute(tag,'Target');if(target)await copyPart(relationshipTarget(part,decodeXml(target)));}
  }
  for(const [name,part] of sourceParts){if(name!==PM_TRACKER_SHEET&&name!==PM_HISTORY_SHEET)await copyPart(part);}
  const output=await generatedZip.generateAsync({type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:6}});fs.writeFileSync(generatedPath,output);
}

function trackerRowsByKey(sheet:ExcelJS.Worksheet,header:HeaderMap<TrackerField>) {
  const map=new Map<string,number[]>();
  for (let rowNumber=header.rowNumber+1;rowNumber<=sheet.rowCount;rowNumber+=1) {
    const asset=cleanText(cellRawValue(sheet.getCell(rowNumber,header.columns.assetNumber)));
    const task=cleanText(cellRawValue(sheet.getCell(rowNumber,header.columns.taskTitle)));
    const rawInterval=cleanText(cellRawValue(sheet.getCell(rowNumber,header.columns.intervalType)));
    if (!asset&&!task&&!rawInterval) continue;
    let interval:WorkbookPmInterval;try{interval=normalizeWorkbookInterval(rawInterval);}catch{continue;}
    const key=[normalizedPmKey(asset),normalizedPmKey(task),interval].join('\u001f');
    map.set(key,[...(map.get(key)??[]),rowNumber]);
  }
  return map;
}

function historyExistingKeys(sheet:ExcelJS.Worksheet,header:HeaderMap<HistoryField>) {
  const keys=new Set<string>();
  for (let rowNumber=header.rowNumber+1;rowNumber<=sheet.rowCount;rowNumber+=1) {
    const workOrder=normalizedPmKey(cellRawValue(sheet.getCell(rowNumber,header.columns.workOrderNumber)));
    if (workOrder) keys.add(`wo:${workOrder}`);
    try { const row=parseHistoryRow(sheet,rowNumber,header);if (row) keys.add(`ref:${row.sourceRef}`); } catch {/* Existing legacy rows remain untouched. */}
  }
  return keys;
}

function copyHistoryTemplate(sheet:ExcelJS.Worksheet,templateRowNumber:number,newRowNumber:number,mappedColumns:Set<number>) {
  const template=sheet.getRow(templateRowNumber);const target=sheet.getRow(newRowNumber);target.height=template.height;
  const maxColumn=Math.max(sheet.columnCount,template.cellCount);
  for (let column=1;column<=maxColumn;column+=1) {
    const source=template.getCell(column);const destination=target.getCell(column);
    destination.style=safeClone(source.style);
    if (source.dataValidation) destination.dataValidation=safeClone(source.dataValidation);
    if (source.note) destination.note=safeClone(source.note);
    if (!mappedColumns.has(column)&&source.type===ExcelJS.ValueType.Formula&&source.value&&typeof source.value==='object') destination.value=safeClone(source.value);
  }
}

function lastHistoryDataRow(sheet:ExcelJS.Worksheet,header:HeaderMap<HistoryField>) {
  const columns=Object.values(header.columns);
  for (let rowNumber=sheet.rowCount;rowNumber>header.rowNumber;rowNumber-=1) if (columns.some(column=>cleanText(cellRawValue(sheet.getCell(rowNumber,column)))!=='')) return rowNumber;
  return header.rowNumber;
}

function historyFieldForHeader(value:unknown):HistoryField|null {
  const normalized=normalizedHeader(value);
  for(const [field,aliases] of Object.entries(historyAliases) as Array<[HistoryField,string[]]>)if(aliases.some(alias=>normalizedHeader(alias)===normalized))return field;
  return null;
}

function appendHistoryRow(sheet:ExcelJS.Worksheet,header:HeaderMap<HistoryField>,value:HistoryWorkbookAppend) {
  const previous=lastHistoryDataRow(sheet,header);const rowNumber=previous+1;const mapped=new Set(Object.values(header.columns));
  const values:Record<HistoryField,unknown>={
    assetNumber:value.assetNumber,workOrderNumber:value.workOrderNumber,taskStatus:value.taskStatus,startDate:workbookValue(value.startDate,true),completionDate:workbookValue(value.completionDate,true),workOrderType:value.workOrderType,performedBy:value.performedBy,intervalType:value.intervalType==='cycles'?'Cycles':value.intervalType[0].toUpperCase()+value.intervalType.slice(1),taskType:value.taskType,taskNote:value.taskNote,
  };
  const tables=sheet.getTables().map(entry=>Array.isArray(entry)?entry[0]:entry).filter(Boolean);
  const table=tables.find(item=>{const runtime=item as ExcelJS.Table&{table?:{tableRef?:string;columns?:Array<{name:string}>}};const ref=runtime.ref??runtime.table?.tableRef;const columns=runtime.columns??runtime.table?.columns??[];return Number(String(ref).match(/\d+/)?.[0])===header.rowNumber&&columns.some(column=>historyFieldForHeader(column.name)==='workOrderNumber');});
  if(table){const runtime=table as ExcelJS.Table&{table?:{tableRef?:string;autoFilterRef?:string}};const model=runtime.table;if(model?.tableRef){model.tableRef=model.tableRef.replace(/(\$?[A-Z]+\$?)\d+$/i,`$1${rowNumber}`);model.autoFilterRef=model.tableRef;}}
  if (previous>header.rowNumber) copyHistoryTemplate(sheet,previous,rowNumber,mapped);
  for (const [field,column] of Object.entries(header.columns) as Array<[HistoryField,number]>) sheet.getCell(rowNumber,column).value=values[field] as ExcelJS.CellValue;
  sheet.getCell(rowNumber,header.columns.startDate).numFmt=sheet.getCell(previous,header.columns.startDate).numFmt||'yyyy-mm-dd';
  sheet.getCell(rowNumber,header.columns.completionDate).numFmt=sheet.getCell(previous,header.columns.completionDate).numFmt||'yyyy-mm-dd';
  return rowNumber;
}

export async function synchronizePmWorkbook(input:{sourcePath:string;destinationPath:string;backupDir:string;trackerUpdates:TrackerWorkbookUpdate[];historyRows:HistoryWorkbookAppend[];beforeReplace?:()=>void|Promise<void>}) {
  const sourcePath=path.resolve(input.sourcePath);const destinationPath=path.resolve(input.destinationPath);const backupDir=path.resolve(input.backupDir);
  if (!fs.existsSync(sourcePath)||!fs.statSync(sourcePath).isFile()) throw new Error('The synchronized PM workbook source is unavailable.');
  fs.mkdirSync(path.dirname(destinationPath),{recursive:true});fs.mkdirSync(backupDir,{recursive:true});
  const temporaryPath=path.join(path.dirname(destinationPath),`.pm-sync-${crypto.randomUUID()}.xlsx`);
  let backupPath:string|null=null;let destinationMoved=false;
  try {
    fs.copyFileSync(sourcePath,temporaryPath,fs.constants.COPYFILE_EXCL);
    const workbook=new ExcelJS.Workbook();await workbook.xlsx.readFile(temporaryPath);
    const tracker=workbook.getWorksheet(PM_TRACKER_SHEET);const history=workbook.getWorksheet(PM_HISTORY_SHEET);
    if (!tracker||!history) throw new Error(`Workbook must contain ${PM_TRACKER_SHEET} and ${PM_HISTORY_SHEET}.`);
    const trackerHeader=findHeader(tracker,trackerAliases,trackerRequired);const historyHeader=findHeader(history,historyAliases,historyRequired);const rowsByKey=trackerRowsByKey(tracker,trackerHeader);
    let changedCells=0;
    for (const update of input.trackerUpdates) {
      const key=[normalizedPmKey(update.assetNumber),normalizedPmKey(update.matchTaskTitle??update.taskTitle),update.matchIntervalType??update.intervalType].join('\u001f');const matches=rowsByKey.get(key)??[];
      if (matches.length!==1) throw new Error(matches.length?`Ambiguous Machine Pm Tracker match for ${update.assetNumber} / ${update.taskTitle}.`:`Machine Pm Tracker row not found for ${update.assetNumber} / ${update.taskTitle}.`);
      const row=matches[0];const meter=update.intervalType==='hourly'||update.intervalType==='cycles';
      const targets:Array<[TrackerField,unknown]>=[
        ['taskTitle',update.taskTitle],
        ['intervalType',update.intervalType==='cycles'?'Cycles':update.intervalType[0].toUpperCase()+update.intervalType.slice(1)],
        ['intervalValue',update.intervalValue],
        ['lastCompleted',meter?update.lastCompletedMeter:workbookValue(update.lastCompletedDate,true)],
        ['current',meter?update.currentMeter:workbookValue(update.currentDate,true)],
        ['remaining',update.remaining],['status',update.status],
      ];
      for (const [field,value] of targets) if (setTargetCell(tracker.getCell(row,trackerHeader.columns[field]),value)) changedCells+=1;
    }
    const existing=historyExistingKeys(history,historyHeader);let appendedHistory=0;
    for (const row of input.historyRows) {
      const workOrderKey=normalizedPmKey(row.workOrderNumber);const base={...row,rowNumber:0,sourceRef:''};
      const sourceRef=historySourceRef({assetNumber:base.assetNumber,workOrderNumber:base.workOrderNumber,taskStatus:base.taskStatus,startDate:base.startDate,completionDate:base.completionDate,workOrderType:base.workOrderType,performedBy:base.performedBy,intervalType:base.intervalType,taskType:base.taskType,taskNote:base.taskNote});
      if ((workOrderKey&&existing.has(`wo:${workOrderKey}`))||existing.has(`ref:${sourceRef}`)) continue;
      appendHistoryRow(history,historyHeader,row);appendedHistory+=1;if(workOrderKey)existing.add(`wo:${workOrderKey}`);existing.add(`ref:${sourceRef}`);
    }
    await workbook.xlsx.writeFile(temporaryPath);
    await restoreUnrelatedWorksheetParts(sourcePath,temporaryPath);
    const validation=new ExcelJS.Workbook();await validation.xlsx.readFile(temporaryPath);
    if (!validation.getWorksheet(PM_TRACKER_SHEET)||!validation.getWorksheet(PM_HISTORY_SHEET)) throw new Error('Workbook validation failed after synchronization.');
    if (input.beforeReplace) await input.beforeReplace();
    if (fs.existsSync(destinationPath)) {
      const stamp=new Date().toISOString().replace(/[:.]/g,'-');backupPath=path.join(backupDir,`PM_report_${stamp}_${crypto.randomUUID().slice(0,8)}.xlsx`);
      fs.renameSync(destinationPath,backupPath);destinationMoved=true;
    }
    try { fs.renameSync(temporaryPath,destinationPath); }
    catch (error) { if (destinationMoved&&backupPath&&fs.existsSync(backupPath)&&!fs.existsSync(destinationPath)) fs.renameSync(backupPath,destinationPath);throw error; }
    return {changedCells,appendedHistory,backupPath};
  } finally { if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath,{force:true}); }
}

export function workbookSha256(buffer:Buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
