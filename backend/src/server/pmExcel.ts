import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { SaxesParser } from 'saxes';
import { normalizedPmKey, strictPressNumberAlias } from './pmAssetResolver.js';

export { normalizedPmKey } from './pmAssetResolver.js';

export const PM_TRACKER_SHEET = 'Machine Pm Tracker';
export const PM_HISTORY_SHEET = 'PMHistory';
export const PM_EXCEL_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export type WorkbookPmInterval = 'hourly' | 'cycles' | 'days' | 'annual';
export type WorkbookPmStatus = 'Current' | 'Due Soon' | 'Due Now' | 'Overdue';

export type ParsedTrackerRow = {
  rowNumber:number;
  assetNumber:string;
  assetNumberInherited:boolean;
  machineSectionRow:number|null;
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
  assetName?:string;
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
  workOrderHyperlink?:string|null;
};

type TrackerField = 'assetNumber'|'assetName'|'taskTitle'|'intervalType'|'intervalValue'|'lastCompleted'|'current'|'due'|'remaining'|'status';
type HistoryField = 'assetNumber'|'workOrderNumber'|'taskStatus'|'startDate'|'completionDate'|'workOrderType'|'performedBy'|'intervalType'|'taskType'|'taskNote';
type HeaderMap<Field extends string> = { rowNumber:number; columns:Record<Field,number> };

const trackerAliases:Record<TrackerField,string[]> = {
  assetNumber:['Asset Number','Asset #','Asset No','Machine Number','Machine #','Machine No','Press Number','Press #','Press'],
  assetName:['Asset Name','Machine Name','Equipment Name','Name'],
  taskTitle:['PM Task','Task','Task Type','PM Task Type','PM Description','Task Description','Maintenance Task','Maintenance Description'],
  intervalType:['Interval Type','PM Interval Type','Frequency Type','Interval Unit','Frequency Unit'],
  intervalValue:['Interval Value','Interval Amount','PM Interval','PM Frequency','Frequency','Interval','Interval Cycle','Interval Cycles'],
  lastCompleted:['Last Completed','Last Completed Value','Last Completed Date or Meter','Last Completed Date / Meter','Last PM','Last PM Date / Meter','Last PM Date/Hour','Last Completed Date','Last Completed Meter','Last Completed Date / Last hourly','Last Completed Date / Last Hourly'],
  current:['Current','Current Value','Current Date or Meter','Current Date / Meter','Current Reading','Current Meter','Current Date','Current Date/Hour','Today Date / Hourly','Today Date/Hourly'],
  due:['Due Date','Due Meter','Next Due','Next Due Date','Next Due Meter','Due Date / Meter'],
  remaining:['Remaining','Remaining Value','Hours Remaining','Cycles Remaining','Days Remaining','Hours left/Days left','Hours Left / Days Left'],
  status:['Status','PM Status','Task Status'],
};

const historyAliases:Record<HistoryField,string[]> = {
  assetNumber:['Asset Number','Asset #','Asset No','AssetNo','Machine Number','Machine #','Press Number','Press #','Press'],
  workOrderNumber:['Work-order Number','Work Order Number','Work-order #','Work Order #','Work order #','WO Number','WO #'],
  taskStatus:['Task Status','Status','Work Order Status'],
  startDate:['Start Date','Started Date','Work Order Start Date'],
  completionDate:['End Date','Completion Date','Completed Date','Work Order End Date'],
  workOrderType:['Work-order Type','Work Order Type','WO Type'],
  performedBy:['Performed By','Perform By','Perform By:','Completed By','Technician'],
  intervalType:['Interval Type','PM Interval Type','Frequency Type'],
  taskType:['Task Type','PM Task','Task','PM Task Type'],
  taskNote:['Task Note','Task Notes','Completion Note','Completion Notes','Notes'],
};

const trackerRequired:TrackerField[]=['taskTitle','intervalType','intervalValue','lastCompleted','current','status'];
const historyRequired:HistoryField[]=['assetNumber','workOrderNumber','taskStatus','startDate','completionDate','workOrderType','performedBy','intervalType','taskType','taskNote'];

function cleanText(value:unknown) { return String(value ?? '').replace(/\r/g,'').trim(); }
function normalizedHeader(value:unknown) { return normalizedPmKey(value).replace(/[^a-z0-9]+/g,'').replace(/cycles/g,'cycle'); }

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

function isTrackerHeaderRow(sheet:ExcelJS.Worksheet,rowNumber:number,header:HeaderMap<TrackerField>) {
  const fields:TrackerField[]=['taskTitle','intervalType','intervalValue','lastCompleted','current','status'];
  const matches=fields.filter(field=>{const column=header.columns[field];if(!column)return false;const value=normalizedHeader(cellRawValue(sheet.getCell(rowNumber,column)));return trackerAliases[field].some(alias=>normalizedHeader(alias)===value);});
  return matches.length>=5;
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
  const nextDueDate=intervalType==='annual'?(input.intervalValue===365?addDays(input.lastCompletedDate,365):addMonths(input.lastCompletedDate,input.intervalValue)):addDays(input.lastCompletedDate,input.intervalValue);
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

type TrackerSectionContext = {assetNumber:string;rowNumber:number}|null;
type TrackerSectionHeading = {matched:false}|{matched:true;assetNumber:string|null;reason?:string};
type TrackerMachineSection = {assetNumber:string;headingRow:number;endRow:number;taskRows:ParsedTrackerRow[];malformedReason:string|null};

function trackerSectionHeading(sheet:ExcelJS.Worksheet,rowNumber:number,header:HeaderMap<TrackerField>):TrackerSectionHeading {
  const values:Array<{column:number;text:string}>=[];
  for(let column=1;column<=Math.min(Math.max(sheet.columnCount,1),100);column+=1){const text=cleanText(cellRawValue(sheet.getCell(rowNumber,column)));if(text)values.push({column,text});}
  const taskColumn=header.columns.taskTitle;const intervalColumn=header.columns.intervalType;const explicitAssetColumn=header.columns.assetNumber;
  const task=taskColumn?cleanText(cellRawValue(sheet.getCell(rowNumber,taskColumn))):'';
  const interval=intervalColumn?cleanText(cellRawValue(sheet.getCell(rowNumber,intervalColumn))):'';
  const explicitAsset=explicitAssetColumn?cleanText(cellRawValue(sheet.getCell(rowNumber,explicitAssetColumn))):'';
  const labels=new Set(['press','pressnumber','pressno','machine','machinenumber','machineno','asset','assetnumber','assetno']);
  if(explicitAsset&&!task&&!interval&&!labels.has(normalizedHeader(explicitAsset)))return {matched:true,assetNumber:explicitAsset};
  const candidates:string[]=[];let foundLabel=false;
  for(let index=0;index<values.length;index+=1){
    const item=values[index];const normalized=normalizedHeader(item.text);
    const combined=/^(?:press|machine|asset)(?:\s*(?:number|no|#))?\s*:\s*(.+)$/i.exec(item.text);
    if(combined){foundLabel=true;const candidate=cleanText(combined[1]);if(candidate)candidates.push(candidate);continue;}
    if(!labels.has(normalized))continue;foundLabel=true;
    const next=values.find(candidate=>candidate.column===item.column+1&&!labels.has(normalizedHeader(candidate.text)));
    if(next)candidates.push(next.text);
  }
  if(!foundLabel)return {matched:false};
  const unique=[...new Map(candidates.map(value=>[normalizedPmKey(value),value])).values()];
  if(unique.length!==1)return {matched:true,assetNumber:null,reason:'Machine/press section heading is ambiguous or missing its identifier.'};
  return {matched:true,assetNumber:unique[0]};
}

function trackerSectionBeforeHeader(sheet:ExcelJS.Worksheet,header:HeaderMap<TrackerField>):TrackerSectionContext {
  let section:TrackerSectionContext=null;
  for(let rowNumber=1;rowNumber<header.rowNumber;rowNumber+=1){const heading=trackerSectionHeading(sheet,rowNumber,header);if(heading.matched)section=heading.assetNumber?{assetNumber:heading.assetNumber,rowNumber}:null;}
  return section;
}

function parseTrackerRow(sheet:ExcelJS.Worksheet,rowNumber:number,header:HeaderMap<TrackerField>,section:TrackerSectionContext):ParsedTrackerRow|null {
  const value=(field:TrackerField)=>cellRawValue(sheet.getCell(rowNumber,header.columns[field]));
  const explicitAssetNumber=header.columns.assetNumber?cleanText(value('assetNumber')):'';
  const assetNumber=explicitAssetNumber||section?.assetNumber||'';
  const taskTitle=cleanText(value('taskTitle'));
  const intervalText=cleanText(value('intervalType'));
  if (!taskTitle&&!intervalText) return null;
  if (!assetNumber) throw new Error('Machine/press section ownership could not be determined unambiguously.');
  if (!taskTitle) throw new Error('PM Task is required.');
  const intervalType=normalizeWorkbookInterval(intervalText);
  const meter=intervalType==='hourly'||intervalType==='cycles';
  const intervalValue=positiveNumber(value('intervalValue'),'Interval Value',intervalType!=='hourly');
  const lastCompletedDate=meter?null:isoDate(value('lastCompleted'),'Last Completed');
  const lastCompletedMeter=meter?requiredNumber(value('lastCompleted'),'Last Completed',intervalType==='cycles'):null;
  const currentDate=meter?null:isoDate(value('current'),'Current Date');
  const currentMeter=meter?requiredNumber(value('current'),'Current Meter',intervalType==='cycles'):null;
  const calculated=calculateWorkbookPm({intervalType,intervalValue,lastCompletedDate,lastCompletedMeter,currentDate,currentMeter});
  return {rowNumber,assetNumber,assetNumberInherited:!explicitAssetNumber,machineSectionRow:explicitAssetNumber?null:section?.rowNumber??null,assetName:header.columns.assetName?cleanText(value('assetName')):'',taskTitle,intervalType,intervalValue,lastCompletedDate,lastCompletedMeter,currentDate,currentMeter,remaining:calculated.remaining,status:calculated.status};
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
  let trackerSection=trackerSectionBeforeHeader(tracker,trackerHeader);
  for (let rowNumber=trackerHeader.rowNumber+1;rowNumber<=tracker.rowCount;rowNumber+=1) {
    try {
      if(isTrackerHeaderRow(tracker,rowNumber,trackerHeader))continue;
      const heading=trackerSectionHeading(tracker,rowNumber,trackerHeader);if(heading.matched){trackerSection=heading.assetNumber?{assetNumber:heading.assetNumber,rowNumber}:null;if(heading.reason)rejectedRows.push({sheet:PM_TRACKER_SHEET,rowNumber,reason:heading.reason});continue;}
      const row=parseTrackerRow(tracker,rowNumber,trackerHeader,trackerSection);if (!row) continue;trackerRows.push(row);
      const remainingColumn=trackerHeader.columns.remaining;
      if(remainingColumn){const supplied=cellRawValue(tracker.getCell(rowNumber,remainingColumn));if (cleanText(supplied)!=='') { const numeric=Number(cleanText(supplied).replace(/,/g,''));if (Number.isFinite(numeric)&&Math.abs(numeric-row.remaining)>0.000001) warnings.push({sheet:PM_TRACKER_SHEET,rowNumber,message:`Remaining value will be recalculated from the MCC baseline (${row.remaining}).`}); }}
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
function xmlAttribute(tag:string,name:string){const match=new RegExp(`(?:^|\\s)${name.replace(':','\\:')}="([^"]*)"`).exec(tag);return match?.[1]??'';}
function decodeXml(value:string){return value.replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');}
function relationshipPart(part:string){return path.posix.join(path.posix.dirname(part),'_rels',`${path.posix.basename(part)}.rels`);}
function relationshipTarget(ownerPart:string,target:string){if(target.startsWith('/'))return target.slice(1);return path.posix.normalize(path.posix.join(path.posix.dirname(ownerPart),target));}

async function workbookSheetParts(zip:JSZip){
  const workbookXml=await zip.file('xl/workbook.xml')?.async('string');const relationshipsXml=await zip.file('xl/_rels/workbook.xml.rels')?.async('string');if(!workbookXml||!relationshipsXml)throw new Error('Workbook package relationships are unreadable.');
  const targets=new Map<string,string>();for(const match of relationshipsXml.matchAll(/<Relationship\b[^>]*\/?\s*>/g)){const tag=match[0];const id=xmlAttribute(tag,'Id');const target=xmlAttribute(tag,'Target');if(id&&target)targets.set(id,relationshipTarget('xl/workbook.xml',decodeXml(target)));}
  const parts=new Map<string,string>();for(const match of workbookXml.matchAll(/<sheet\b[^>]*\/?\s*>/g)){const tag=match[0];const name=decodeXml(xmlAttribute(tag,'name'));const target=targets.get(xmlAttribute(tag,'r:id'));if(name&&target)parts.set(name,target);}
  return parts;
}

function xmlEscape(value:string){return value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');}
function formulaXmlEscape(value:string){return value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function regexEscape(value:string){return value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
function cellColumnNumber(address:string){const letters=/^[A-Z]+/i.exec(address)?.[0].toUpperCase()??'';let result=0;for(const letter of letters)result=result*26+letter.charCodeAt(0)-64;return result;}
function cellColumnLetters(column:number){let result='';for(let value=column;value>0;value=Math.floor((value-1)/26))result=String.fromCharCode(65+(value-1)%26)+result;return result;}
function excelSerial(value:Date,date1904:boolean){const epoch=date1904?Date.UTC(1904,0,1):Date.UTC(1899,11,30);return (value.getTime()-epoch)/86400000;}
function xmlCellValue(value:unknown,date1904:boolean){
  if(value===null||value===undefined)return {type:'',body:''};
  if(value instanceof Date)return {type:'',body:`<v>${excelSerial(value,date1904)}</v>`};
  if(typeof value==='number')return {type:'',body:`<v>${Number.isFinite(value)?String(value):'0'}</v>`};
  if(typeof value==='boolean')return {type:'b',body:`<v>${value?1:0}</v>`};
  const text=String(value);return {type:'inlineStr',body:`<is><t xml:space="preserve">${xmlEscape(text)}</t></is>`};
}
function rowXmlPattern(rowNumber:number){return new RegExp(`<row\\b(?=[^>]*\\br="${rowNumber}")[^>]*?(?:\\/>|>[\\s\\S]*?<\\/row>)`);}
function cellXmlPattern(address:string){return new RegExp(`<c\\b(?=[^>]*\\br="${regexEscape(address)}")[^>]*?(?:\\/>|>[\\s\\S]*?<\\/c>)`);}
function transformFormulaRows(formula:string,transform:(row:number,absolute:boolean)=>number){
  let result='';let quoted=false;
  for(let index=0;index<formula.length;){
    if(formula[index]==='"'){
      result+='"';index+=1;
      if(quoted&&formula[index]==='"'){result+='"';index+=1;continue;}
      quoted=!quoted;continue;
    }
    if(quoted){result+=formula[index];index+=1;continue;}
    const match=/^(\$?[A-Z]{1,3})(\$?)(\d+)/i.exec(formula.slice(index));
    if(match){
      const before=index?formula[index-1]:'';const after=formula[index+match[0].length]??'';const column=cellColumnNumber(match[1]);
      if(column>0&&column<=16384&&!/[A-Z0-9_.\]]/i.test(before)&&!/[A-Z0-9_![(]/i.test(after)){
        result+=`${match[1]}${match[2]}${transform(Number(match[3]),Boolean(match[2]))}`;index+=match[0].length;continue;
      }
    }
    result+=formula[index];index+=1;
  }
  return result;
}
function shiftFormulaRows(formula:string,delta:number){return transformFormulaRows(formula,(row,absolute)=>absolute?row:row+delta);}
function translateFormulaBetweenCells(formula:string,sourceAddress:string,targetAddress:string){
  const source=/^([A-Z]{1,3})(\d+)$/i.exec(sourceAddress);const target=/^([A-Z]{1,3})(\d+)$/i.exec(targetAddress);if(!source||!target)throw new Error(`Formula translation addresses are invalid: ${sourceAddress} to ${targetAddress}.`);const columnDelta=cellColumnNumber(target[1])-cellColumnNumber(source[1]);const rowDelta=Number(target[2])-Number(source[2]);
  let result='';let quoted=false;
  for(let index=0;index<formula.length;){
    if(formula[index]==='"'){result+='"';index+=1;if(quoted&&formula[index]==='"'){result+='"';index+=1;continue;}quoted=!quoted;continue;}
    if(quoted){result+=formula[index];index+=1;continue;}
    const match=/^(\$?)([A-Z]{1,3})(\$?)(\d+)/i.exec(formula.slice(index));
    if(match){const before=index?formula[index-1]:'';const after=formula[index+match[0].length]??'';const column=cellColumnNumber(match[2]);if(column>0&&column<=16384&&!/[A-Z0-9_.\]]/i.test(before)&&!/[A-Z0-9_![(]/i.test(after)){const translatedColumn=match[1]?column:column+columnDelta;const translatedRow=match[3]?Number(match[4]):Number(match[4])+rowDelta;if(translatedColumn<1||translatedColumn>16384||translatedRow<1)throw new Error(`Formula reference ${match[0]} cannot be translated from ${sourceAddress} to ${targetAddress}.`);result+=`${match[1]}${cellColumnLetters(translatedColumn)}${match[3]}${translatedRow}`;index+=match[0].length;continue;}}
    result+=formula[index];index+=1;
  }
  return result;
}
function shiftedTemplateRow(rowXml:string,sourceRow:number,targetRow:number){
  const delta=targetRow-sourceRow;let shifted=rowXml.replace(new RegExp(`(<row\\b[^>]*\\br=")${sourceRow}("[^>]*>)`),`$1${targetRow}$2`).replace(new RegExp(`(<c\\b[^>]*\\br="[A-Z]+)${sourceRow}("[^>]*>)`,'g'),`$1${targetRow}$2`);
  shifted=shifted.replace(/<f(\b[^>]*)>([\s\S]*?)<\/f>/g,(_match,attributes,formula)=>`<f${attributes}>${shiftFormulaRows(formula,delta)}</f>`);return shifted;
}
function ensureWorksheetRow(xml:string,rowNumber:number,templateRowNumber:number|null){
  if(rowXmlPattern(rowNumber).test(xml))return xml;
  let rowXml=`<row r="${rowNumber}"></row>`;if(templateRowNumber!==null){const template=rowXmlPattern(templateRowNumber).exec(xml)?.[0];if(template)rowXml=shiftedTemplateRow(template,templateRowNumber,rowNumber);}
  const sheetDataEnd=xml.indexOf('</sheetData>');if(sheetDataEnd<0)throw new Error('Worksheet data is unreadable.');
  let insertAt=sheetDataEnd;for(const match of xml.slice(0,sheetDataEnd).matchAll(/<row\b[^>]*\br="(\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g)){if(Number(match[1])>rowNumber){insertAt=match.index??insertAt;break;}}
  return `${xml.slice(0,insertAt)}${rowXml}${xml.slice(insertAt)}`;
}
function setWorksheetCell(xml:string,address:string,value:unknown,date1904:boolean,templateAddress?:string){
  const rowNumber=Number(/\d+$/.exec(address)?.[0]??0);const rowMatch=rowXmlPattern(rowNumber).exec(xml);if(!rowMatch)throw new Error(`Worksheet row ${rowNumber} is unavailable.`);let rowXml=rowMatch[0];const existing=cellXmlPattern(address).exec(rowXml)?.[0];if(existing&&/<f\b/i.test(existing))return {xml,changed:false};
  let opening=existing?.match(/^<c\b[^>]*\/?\s*>/)?.[0]??'';
  if(!opening&&templateAddress){const template=cellXmlPattern(templateAddress).exec(xml)?.[0];opening=template?.match(/^<c\b[^>]*\/?\s*>/)?.[0]??'';}
  let attributes=opening.replace(/^<c\b|\/?>$/g,'').trim().replace(/(?:^|\s)r="[^"]*"/g,'').replace(/(?:^|\s)t="[^"]*"/g,'').trim();
  const encoded=xmlCellValue(value,date1904);const replacement=`<c r="${address}"${attributes?` ${attributes}`:''}${encoded.type?` t="${encoded.type}"`:''}>${encoded.body}</c>`;
  if(existing)rowXml=rowXml.replace(existing,replacement);
  else{
    if(/<row\b[^>]*\/>$/.test(rowXml))rowXml=rowXml.replace(/\/>$/,'></row>');
    const targetColumn=cellColumnNumber(address);const cells=[...rowXml.matchAll(/<c\b(?=[^>]*\br="([A-Z]+\d+)")[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)];const after=cells.find(match=>cellColumnNumber(match[1])>targetColumn);const insertAt=after?.index??rowXml.lastIndexOf('</row>');rowXml=`${rowXml.slice(0,insertAt)}${replacement}${rowXml.slice(insertAt)}`;
  }
  return {xml:`${xml.slice(0,rowMatch.index)}${rowXml}${xml.slice((rowMatch.index??0)+rowMatch[0].length)}`,changed:true};
}
function worksheetCellHasFormula(xml:string,address:string){const rowNumber=Number(/\d+$/.exec(address)?.[0]??0);const row=rowXmlPattern(rowNumber).exec(xml)?.[0]??'';const cell=cellXmlPattern(address).exec(row)?.[0]??'';return /<f\b/i.test(cell);}
function setWorksheetFormulaResult(xml:string,address:string,value:unknown,date1904:boolean){
  const rowNumber=Number(/\d+$/.exec(address)?.[0]??0);const rowMatch=rowXmlPattern(rowNumber).exec(xml);if(!rowMatch)return {xml,changed:false};let rowXml=rowMatch[0];const existing=cellXmlPattern(address).exec(rowXml)?.[0];if(!existing||!/<f\b/i.test(existing))return {xml,changed:false};
  let opening=existing.match(/^<c\b[^>]*>/)?.[0]??'';const formula=/<f\b[^>]*>[\s\S]*?<\/f>/.exec(existing)?.[0]??/<f\b[^>]*\/>/.exec(existing)?.[0];if(!opening||!formula)return {xml,changed:false};
  opening=opening.replace(/\s+t="[^"]*"/g,'');let encoded='';if(value instanceof Date)encoded=String(excelSerial(value,date1904));else if(typeof value==='number')encoded=String(value);else{opening=opening.replace(/>$/, ' t="str">');encoded=xmlEscape(cleanText(value));}
  const replacement=`${opening}${formula}<v>${encoded}</v></c>`;if(existing===replacement)return {xml,changed:false};rowXml=rowXml.replace(existing,replacement);
  return {xml:`${xml.slice(0,rowMatch.index)}${rowXml}${xml.slice((rowMatch.index??0)+rowMatch[0].length)}`,changed:true};
}
type RangeInsertMode='structural'|'coverage';
function shiftA1RangeForInsertion(value:string,insertionRow:number,templateRow:number,mode:RangeInsertMode) {
  const match=/^(\$?[A-Z]{1,3})(\$?)(\d+)(?::(\$?[A-Z]{1,3})(\$?)(\d+))?$/i.exec(value);if(!match)return value;
  const start=Number(match[3]);const end=Number(match[6]??match[3]);let nextStart=start;let nextEnd=end;
  if(start>=insertionRow){nextStart+=1;nextEnd+=1;}else if(end>=insertionRow)nextEnd+=1;else if(mode==='coverage'&&start<=templateRow&&end>=templateRow)nextEnd+=1;
  const first=`${match[1]}${match[2]}${nextStart}`;if(!match[4])return first;return `${first}:${match[4]}${match[5]}${nextEnd}`;
}
function shiftSqrefForInsertion(value:string,insertionRow:number,templateRow:number,mode:RangeInsertMode){return value.split(/\s+/).filter(Boolean).map(item=>shiftA1RangeForInsertion(item,insertionRow,templateRow,mode)).join(' ');}
function shiftFormulaForInsertion(formula:string,insertionRow:number){return transformFormulaRows(decodeXml(formula),(row)=>row>=insertionRow?row+1:row);}
function blankTemplateRowValues(rowXml:string){return rowXml.replace(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g,cell=>{const opening=cell.match(/^<c\b[^>]*\/?>/)?.[0]??'';return opening.endsWith('/>')?opening:`${opening}</c>`;});}
function setWorksheetStandaloneFormula(xml:string,address:string,formula:string,templateAddress?:string){
  const rowNumber=Number(/\d+$/.exec(address)?.[0]??0);const rowMatch=rowXmlPattern(rowNumber).exec(xml);if(!rowMatch)throw new Error(`Worksheet row ${rowNumber} is unavailable.`);let rowXml=rowMatch[0];const existing=cellXmlPattern(address).exec(rowXml)?.[0];
  let opening=existing?.match(/^<c\b[^>]*\/?\s*>/)?.[0]??'';if(!opening&&templateAddress){const template=cellXmlPattern(templateAddress).exec(xml)?.[0];opening=template?.match(/^<c\b[^>]*\/?\s*>/)?.[0]??'';}
  const attributes=opening.replace(/^<c\b|\/?>$/g,'').trim().replace(/(?:^|\s)r="[^"]*"/g,'').replace(/(?:^|\s)t="[^"]*"/g,'').trim();const normalized=formula.startsWith('=')?formula.slice(1):formula;
  const replacement=`<c r="${address}"${attributes?` ${attributes}`:''}><f>${formulaXmlEscape(normalized)}</f></c>`;
  if(existing)rowXml=rowXml.replace(existing,replacement);else{if(/<row\b[^>]*\/>$/.test(rowXml))rowXml=rowXml.replace(/\/>$/,'></row>');const targetColumn=cellColumnNumber(address);const cells=[...rowXml.matchAll(/<c\b(?=[^>]*\br="([A-Z]+\d+)")[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)];const after=cells.find(match=>cellColumnNumber(match[1])>targetColumn);const insertAt=after?.index??rowXml.lastIndexOf('</row>');rowXml=`${rowXml.slice(0,insertAt)}${replacement}${rowXml.slice(insertAt)}`;}
  return `${xml.slice(0,rowMatch.index)}${rowXml}${xml.slice((rowMatch.index??0)+rowMatch[0].length)}`;
}
function shiftWorksheetFormulasForInsertion(xml:string,insertionRow:number,templateRow:number){
  return xml.replace(/<f\b([^>]*?)(?:\/>|>([\s\S]*?)<\/f>)/g,(_entry,rawAttributes,rawFormula)=>{
    let attributes=rawAttributes;const ref=xmlAttribute(`<f${attributes}>`,'ref');if(ref)attributes=attributes.replace(/\bref="[^"]*"/,`ref="${shiftA1RangeForInsertion(ref,insertionRow,templateRow,'structural')}"`);
    if(rawFormula===undefined)return `<f${attributes}/>`;const formula=transformFormulaRows(decodeXml(rawFormula),(row)=>row>=insertionRow?row+1:row);return `<f${attributes}>${formulaXmlEscape(formula)}</f>`;
  });
}
function sharedFormulaGroupsCrossingInsertion(xml:string,insertionRow:number){const indexes=new Set<string>();for(const cell of xml.matchAll(/<c\b(?=[^>]*\br="([A-Z]+\d+)")[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)){const formula=/<f\b([^>]*?)>([\s\S]*?)<\/f>/.exec(cell[0]);if(!formula||xmlAttribute(`<f${formula[1]}>`,'t')!=='shared')continue;const ref=xmlAttribute(`<f${formula[1]}>`,'ref');const si=xmlAttribute(`<f${formula[1]}>`,'si');const range=/^\$?[A-Z]{1,3}\$?(\d+):\$?[A-Z]{1,3}\$?(\d+)$/i.exec(ref);if(si&&range&&Number(range[1])<insertionRow&&Number(range[2])>=insertionRow)indexes.add(si);}return indexes;}
function deshareFormulaGroupsForInsertion(xml:string,worksheet:ExcelJS.Worksheet,insertionRow:number){const indexes=sharedFormulaGroupsCrossingInsertion(xml,insertionRow);if(!indexes.size)return xml;for(const cell of [...xml.matchAll(/<c\b(?=[^>]*\br="([A-Z]+\d+)")[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)]){const formula=/<f\b([^>]*?)(?:\/>|>([\s\S]*?)<\/f>)/.exec(cell[0]);if(!formula||!indexes.has(xmlAttribute(`<f${formula[1]}>`,'si')))continue;const resolved=worksheet.getCell(cell[1]).formula;if(typeof resolved!=='string'||!resolved)throw new Error(`Shared formula ${cell[1]} cannot be resolved before row insertion.`);xml=setWorksheetStandaloneFormula(xml,cell[1],resolved);}return xml;}
function insertWorksheetRow(xml:string,insertionRow:number,templateRow:number,formulaTemplates:Map<number,string>){
  const template=rowXmlPattern(templateRow).exec(xml)?.[0];if(!template)throw new Error(`Machine Pm Tracker formatting row ${templateRow} is unavailable.`);
  for(const match of xml.matchAll(/<mergeCell\b[^>]*\bref="([^"]+)"[^>]*\/>/g)){const range=/^(?:\$?[A-Z]{1,3})\$?(\d+):(?:\$?[A-Z]{1,3})\$?(\d+)$/i.exec(match[1]);if(range&&Number(range[1])!==Number(range[2])&&Number(range[1])<=templateRow&&Number(range[2])>=templateRow)throw new Error('Machine Pm Tracker formatting template uses a vertical merged range that cannot be copied safely.');}
  xml=shiftWorksheetFormulasForInsertion(xml,insertionRow,templateRow);
  xml=xml.replace(/<row\b(?=[^>]*\br="(\d+)")[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g,(rowXml,_row)=>{const row=Number(_row);if(row<insertionRow)return rowXml;const shifted=row+1;return rowXml.replace(new RegExp(`(<row\\b[^>]*\\br=")${row}("[^>]*>)`),`$1${shifted}$2`).replace(new RegExp(`(<c\\b[^>]*\\br="[A-Z]+)${row}("[^>]*>)`,'g'),`$1${shifted}$2`);});
  xml=xml.replace(/(<dimension\b[^>]*\bref=")([^"]+)(")/g,(_match,before,ref,after)=>`${before}${shiftA1RangeForInsertion(ref,insertionRow,templateRow,'coverage')}${after}`);
  xml=xml.replace(/(<(?:conditionalFormatting|dataValidation|ignoredError|selection)\b[^>]*\bsqref=")([^"]+)(")/g,(_match,before,ref,after)=>`${before}${shiftSqrefForInsertion(ref,insertionRow,templateRow,'coverage')}${after}`);
  xml=xml.replace(/(<(?:autoFilter)\b[^>]*\bref=")([^"]+)(")/g,(_match,before,ref,after)=>`${before}${shiftA1RangeForInsertion(ref,insertionRow,templateRow,'coverage')}${after}`);
  xml=xml.replace(/(<hyperlink\b[^>]*\bref=")([^"]+)(")/g,(_match,before,ref,after)=>`${before}${shiftA1RangeForInsertion(ref,insertionRow,templateRow,'structural')}${after}`);
  const clonedMerges:string[]=[];xml=xml.replace(/(<mergeCell\b[^>]*\bref=")([^"]+)("[^>]*\/>)/g,(_match,before,ref,after)=>{const rows=/^(?:\$?[A-Z]{1,3})\$?(\d+):(?:\$?[A-Z]{1,3})\$?(\d+)$/i.exec(ref);if(rows&&Number(rows[1])===templateRow&&Number(rows[2])===templateRow)clonedMerges.push(shiftA1RangeForInsertion(ref,insertionRow,templateRow,'structural').replace(/(\d+)/g,String(insertionRow)));return `${before}${shiftA1RangeForInsertion(ref,insertionRow,templateRow,'structural')}${after}`;});
  if(clonedMerges.length)xml=xml.replace(/<mergeCells\b([^>]*)\bcount="(\d+)"([^>]*)>/,(_match,before,count,after)=>`<mergeCells${before}count="${Number(count)+clonedMerges.length}"${after}>`).replace('</mergeCells>',`${clonedMerges.map(ref=>`<mergeCell ref="${ref}"/>`).join('')}</mergeCells>`);
  xml=xml.replace(/(<brk\b[^>]*\bid=")(\d+)(")/g,(_match,before,row,after)=>`${before}${Number(row)>=insertionRow?Number(row)+1:row}${after}`);
  let cloned=blankTemplateRowValues(shiftedTemplateRow(template,templateRow,insertionRow));const sheetDataEnd=xml.indexOf('</sheetData>');if(sheetDataEnd<0)throw new Error('Machine Pm Tracker worksheet data is unreadable.');let insertAt=sheetDataEnd;for(const match of xml.slice(0,sheetDataEnd).matchAll(/<row\b[^>]*\br="(\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g)){if(Number(match[1])>insertionRow){insertAt=match.index??insertAt;break;}}xml=`${xml.slice(0,insertAt)}${cloned}${xml.slice(insertAt)}`;
  for(const [column,formula] of formulaTemplates)xml=setWorksheetStandaloneFormula(xml,`${cellColumnLetters(column)}${insertionRow}`,shiftFormulaRows(formula,insertionRow-templateRow),`${cellColumnLetters(column)}${templateRow}`);
  const insertedRecords=worksheetFormulaRecords(rowXmlPattern(insertionRow).exec(xml)?.[0]??'');const insertedByColumn=new Map(insertedRecords.map(record=>[cellColumnNumber(record.address),record]));for(const [column,formula] of formulaTemplates){const record=insertedByColumn.get(column);const expected=shiftFormulaRows(formula,insertionRow-templateRow);if(!record||record.formulaType==='shared'||record.sharedIndex||record.sharedRef||record.formula!==expected)throw new Error(`Machine Pm Tracker ${cellColumnLetters(column)}${insertionRow} was not written as a complete standalone formula.`);}for(const record of insertedRecords)if(record.formulaType==='shared'||record.sharedIndex||record.sharedRef)throw new Error(`Machine Pm Tracker ${record.address} retained shared-formula metadata after insertion.`);
  return xml;
}
function extendWorksheetDimension(xml:string,rowNumber:number){return xml.replace(/<dimension\b([^>]*)\bref="([A-Z]+\d+):([A-Z]+)(\d+)"([^>]*)\/>/i,(tag,before,start,endColumn,endRow,after)=>rowNumber>Number(endRow)?`<dimension${before}ref="${start}:${endColumn}${rowNumber}"${after}/>`:tag);}
async function extendHistoryTable(zip:JSZip,sheetPart:string,headerRow:number,rowNumber:number){
  const relationships=await zip.file(relationshipPart(sheetPart))?.async('string');if(!relationships)return;const tableParts:string[]=[];for(const match of relationships.matchAll(/<Relationship\b[^>]*\/?\s*>/g)){const tag=match[0];if(!/\/table"?$/i.test(xmlAttribute(tag,'Type')))continue;const target=xmlAttribute(tag,'Target');if(target)tableParts.push(relationshipTarget(sheetPart,decodeXml(target)));}
  for(const name of tableParts){const file=zip.file(name);if(!file)continue;const xml=await file.async('string');const tableTag=/<table\b[^>]*>/.exec(xml)?.[0];if(!tableTag)continue;const ref=xmlAttribute(tableTag,'ref');const match=/^\$?[A-Z]+\$?(\d+):\$?[A-Z]+\$?(\d+)$/i.exec(ref);if(!match||Number(match[1])!==headerRow||rowNumber<=Number(match[2]))continue;const nextRef=ref.replace(/(\$?[A-Z]+\$?)\d+$/i,`$1${rowNumber}`);zip.file(name,xml.replace(new RegExp(`ref="${regexEscape(ref)}"`,'g'),`ref="${nextRef}"`));return;
  }
}

async function shiftTrackerTables(zip:JSZip,sheetPart:string,insertionRow:number,templateRow:number){
  const relationships=await zip.file(relationshipPart(sheetPart))?.async('string');if(!relationships)return;
  for(const match of relationships.matchAll(/<Relationship\b[^>]*\/?\s*>/g)){const tag=match[0];if(!/\/table"?$/i.test(xmlAttribute(tag,'Type')))continue;const target=xmlAttribute(tag,'Target');if(!target)continue;const name=relationshipTarget(sheetPart,decodeXml(target));const file=zip.file(name);if(!file)continue;let xml=await file.async('string');xml=xml.replace(/(\bref=")([^"]+)(")/g,(_entry,before,ref,after)=>`${before}${shiftA1RangeForInsertion(ref,insertionRow,templateRow,'coverage')}${after}`);xml=xml.replace(/<calculatedColumnFormula>([\s\S]*?)<\/calculatedColumnFormula>/g,(_entry,formula)=>`<calculatedColumnFormula>${formulaXmlEscape(shiftFormulaForInsertion(formula,insertionRow))}</calculatedColumnFormula>`);zip.file(name,xml);}
}

async function worksheetFormulaTemplates(zip:JSZip,sheetPart:string,worksheet:ExcelJS.Worksheet,templateRow:number){
  const formulas=new Map<number,string>();const worksheetXml=await zip.file(sheetPart)?.async('string');if(!worksheetXml)throw new Error('Machine Pm Tracker worksheet formula data is unavailable.');const records=worksheetFormulaRecords(worksheetXml);const sharedMasters=new Map(records.filter(record=>record.formulaType==='shared'&&record.formula).map(record=>[record.sharedIndex,record]));const templateRecords=records.filter(record=>Number(/\d+$/.exec(record.address)?.[0]??0)===templateRow);
  for(const record of templateRecords){const column=cellColumnNumber(record.address);const modelFormula=worksheet.getCell(record.address).formula;if(typeof modelFormula==='string'&&modelFormula){formulas.set(column,modelFormula);continue;}if(record.formula){formulas.set(column,record.formula);continue;}if(record.formulaType==='shared'){const master=sharedMasters.get(record.sharedIndex);if(!master)throw new Error(`Machine Pm Tracker ${record.address} shared formula cannot be resolved because its master is missing.`);formulas.set(column,translateFormulaBetweenCells(master.formula,master.address,record.address));continue;}throw new Error(`Machine Pm Tracker ${record.address} formula cannot be resolved before row insertion.`);}
  const relationships=await zip.file(relationshipPart(sheetPart))?.async('string');if(!relationships)return formulas;
  for(const match of relationships.matchAll(/<Relationship\b[^>]*\/?\s*>/g)){
    const tag=match[0];if(!/\/table"?$/i.test(xmlAttribute(tag,'Type')))continue;const target=xmlAttribute(tag,'Target');if(!target)continue;const tableXml=await zip.file(relationshipTarget(sheetPart,decodeXml(target)))?.async('string');if(!tableXml)continue;
    const tableTag=/<table\b[^>]*>/.exec(tableXml)?.[0];const range=/^(\$?[A-Z]{1,3})\$?(\d+):(\$?[A-Z]{1,3})\$?(\d+)$/i.exec(tableTag?xmlAttribute(tableTag,'ref'):'');if(!range||templateRow<Number(range[2])||templateRow>Number(range[4]))continue;const firstColumn=cellColumnNumber(range[1]);let offset=0;
    for(const columnMatch of tableXml.matchAll(/<tableColumn\b[^>]*?(?:\/>|>[\s\S]*?<\/tableColumn>)/g)){const formula=/<calculatedColumnFormula\b[^>]*>([\s\S]*?)<\/calculatedColumnFormula>/.exec(columnMatch[0])?.[1];if(formula!==undefined&&!formulas.has(firstColumn+offset))formulas.set(firstColumn+offset,decodeXml(formula));offset+=1;}
  }
  for(const record of templateRecords)if(!formulas.has(cellColumnNumber(record.address)))throw new Error(`Machine Pm Tracker ${record.address} formula was not captured before row insertion.`);
  return formulas;
}

function trackerFormulaCachedResult(field:TrackerField,formula:string|undefined,update:TrackerWorkbookUpdate){
  if(!formula)return {known:false as const,value:undefined};const normalized=formula.replace(/\s+/g,'').replace(/\$/g,'').toUpperCase();
  if((field==='due'||field==='remaining')&&/^IF\(OR\(B(\d+)="",C\1="",D\1=""\),"",B\1-\(D\1-C\1\)\)$/.test(normalized))return {known:true as const,value:update.remaining};
  if(field==='status'&&/^IF\(E(\d+)="","NEEDSDATE",IF\(E\1<0,"PASTDUE",IF\(E\1=0,"DUETODAY",IF\(E\1<=7,"DUESOON","OK"\)\)\)\)$/.test(normalized)){const value=update.remaining<0?'Past Due':update.remaining===0?'Due Today':update.remaining<=7?'Due Soon':'OK';return {known:true as const,value};}
  return {known:false as const,value:undefined};
}

type FormulaExpectation={sheetName:string;address:string;formula:string};
type WorksheetFormulaRecord={address:string;cellType:string;formulaType:string;sharedIndex:string;sharedRef:string;formula:string;cachedValue:string|undefined};
function worksheetFormulaRecords(xml:string){const records:WorksheetFormulaRecord[]=[];for(const cell of xml.matchAll(/<c\b(?=[^>]*\br="([A-Z]+\d+)")[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)){const formula=/<f\b([^>]*?)(?:\/>|>([\s\S]*?)<\/f>)/.exec(cell[0]);if(!formula)continue;const opening=cell[0].match(/^<c\b[^>]*>/)?.[0]??'';const attributes=`<f${formula[1]}>`;records.push({address:cell[1],cellType:xmlAttribute(opening,'t'),formulaType:xmlAttribute(attributes,'t'),sharedIndex:xmlAttribute(attributes,'si'),sharedRef:xmlAttribute(attributes,'ref'),formula:decodeXml(formula[2]??''),cachedValue:/(?:^|>)<v>([\s\S]*?)<\/v>/.exec(cell[0])?.[1]});}return records;}
function addressInRange(address:string,range:string){const addressMatch=/^([A-Z]{1,3})(\d+)$/i.exec(address);const rangeMatch=/^\$?([A-Z]{1,3})\$?(\d+):\$?([A-Z]{1,3})\$?(\d+)$/i.exec(range);if(!addressMatch||!rangeMatch)return false;const column=cellColumnNumber(addressMatch[1]);return column>=cellColumnNumber(rangeMatch[1])&&column<=cellColumnNumber(rangeMatch[3])&&Number(addressMatch[2])>=Number(rangeMatch[2])&&Number(addressMatch[2])<=Number(rangeMatch[4]);}
function assertWellFormedXml(xml:string,part:string){try{const parser=new SaxesParser({xmlns:true});parser.write(xml).close();}catch(error){throw new Error(`${part} is not well-formed XML: ${error instanceof Error?error.message:String(error)}`);}}
function validateWorksheetFormulaRecords(xml:string,part:string,expectations:FormulaExpectation[]){
  assertWellFormedXml(xml,part);const records=worksheetFormulaRecords(xml);const masters=new Map<string,WorksheetFormulaRecord>();const followers:WorksheetFormulaRecord[]=[];
  for(const record of records){
    if(record.formula.includes('#REF!'))throw new Error(`${part} ${record.address} contains #REF!.`);
    if(['inlineStr','s'].includes(record.cellType))throw new Error(`${part} ${record.address} has formula-incompatible cell type ${record.cellType}.`);
    if(record.cellType==='b'&&record.cachedValue!==undefined&&!/^[01]$/.test(record.cachedValue))throw new Error(`${part} ${record.address} has an invalid Boolean cached formula result.`);
    if(record.cellType==='e'&&record.cachedValue!==undefined&&!/^#(?:NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|GETTING_DATA)$/.test(decodeXml(record.cachedValue)))throw new Error(`${part} ${record.address} has invalid error result metadata.`);
    if(!record.cellType&&record.cachedValue!==undefined&&record.cachedValue!==''&&!Number.isFinite(Number(decodeXml(record.cachedValue))))throw new Error(`${part} ${record.address} has a nonnumeric cached result without a cell type.`);
    if(record.formulaType==='shared'){
      if(!/^\d+$/.test(record.sharedIndex))throw new Error(`${part} ${record.address} has an invalid shared formula index.`);
      if(record.formula){if(!record.sharedRef)throw new Error(`${part} ${record.address} is a shared formula master without a ref range.`);if(masters.has(record.sharedIndex))throw new Error(`${part} has duplicate shared formula masters for index ${record.sharedIndex}.`);masters.set(record.sharedIndex,record);}else followers.push(record);
    }else if(!record.formula)throw new Error(`${part} ${record.address} has an empty standalone formula.`);
  }
  for(const master of masters.values())if(!addressInRange(master.address,master.sharedRef))throw new Error(`${part} shared formula master ${master.address} is outside ${master.sharedRef}.`);
  for(const follower of followers){const master=masters.get(follower.sharedIndex);if(!master)throw new Error(`${part} ${follower.address} is an orphaned shared formula follower (si=${follower.sharedIndex}).`);if(!addressInRange(follower.address,master.sharedRef))throw new Error(`${part} ${follower.address} is outside shared formula range ${master.sharedRef}.`);}
  const byAddress=new Map(records.map(record=>[record.address,record]));for(const expected of expectations){const record=byAddress.get(expected.address);if(!record)throw new Error(`${part} ${expected.address} is missing its expected formula.`);if(record.formulaType==='shared'||record.sharedIndex||record.sharedRef)throw new Error(`${part} ${expected.address} must contain a complete standalone formula without shared metadata.`);if(record.formula!==(expected.formula.startsWith('=')?expected.formula.slice(1):expected.formula))throw new Error(`${part} ${expected.address} formula mismatch: ${record.formula}`);if(record.cellType==='e')throw new Error(`${part} ${expected.address} has invalid error result metadata.`);}
  return records;
}
export async function validatePmWorkbookOoxml(buffer:Buffer,expectations:FormulaExpectation[]=[]){
  const zip=await JSZip.loadAsync(buffer);const sheetParts=await workbookSheetParts(zip);let formulaCells=0;for(const [sheetName,part] of sheetParts){const xml=await zip.file(part)?.async('string');if(!xml)throw new Error(`${part} is unavailable.`);formulaCells+=validateWorksheetFormulaRecords(xml,part,expectations.filter(item=>item.sheetName===sheetName)).length;}return {worksheets:sheetParts.size,formulaCells};
}
async function requestFullWorkbookCalculation(zip:JSZip){const file=zip.file('xl/workbook.xml');if(!file)return;let xml=await file.async('string');if(/<calcPr\b/.test(xml))xml=xml.replace(/<calcPr\b([^>]*?)\/?\s*>/,(_entry,attributes)=>{const clean=attributes.replace(/\s+(?:calcMode|fullCalcOnLoad|forceFullCalc)="[^"]*"/g,'');return `<calcPr${clean} calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/>`;});else xml=xml.replace('</workbook>','<calcPr calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>');zip.file('xl/workbook.xml',xml);}

async function shiftWorkbookDefinedNames(zip:JSZip,sheetName:string,sheetIndex:number,insertionRow:number,templateRow:number){
  const file=zip.file('xl/workbook.xml');if(!file)return;let xml=await file.async('string');const escapedName=sheetName.replace(/'/g,"''");
  xml=xml.replace(/<definedName\b([^>]*)>([\s\S]*?)<\/definedName>/g,(entry,attributes,formula)=>{const local=/\blocalSheetId="(\d+)"/.exec(attributes);const qualified=new RegExp(`(?:'${regexEscape(escapedName)}'|${regexEscape(sheetName)})!`,'i').test(decodeXml(formula));if((local&&Number(local[1])===sheetIndex)||qualified){const shifted=formula.replace(/\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?/gi,(ref:string)=>shiftA1RangeForInsertion(ref,insertionRow,templateRow,'coverage'));return `<definedName${attributes}>${shifted}</definedName>`;}return entry;});zip.file('xl/workbook.xml',xml);
}

function portableWorkOrderHyperlink(value:string) {
  const normalized=value.trim();
  if(!normalized.startsWith('PDF - Work orders/')||normalized.includes('\\')||normalized.startsWith('/')||normalized.split('/').some(part=>!part||part==='.'||part==='..'))throw new Error('PM work-order hyperlink must be a safe relative package path.');
  return normalized;
}

async function addWorksheetExternalHyperlink(zip:JSZip,sheetPart:string,worksheetXml:string,address:string,targetValue:string) {
  const target=portableWorkOrderHyperlink(targetValue);const relPart=relationshipPart(sheetPart);
  let relationships=await zip.file(relPart)?.async('string');
  if(!relationships)relationships='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  const ids=new Set([...relationships.matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\/?\s*>/g)].map(match=>match[1]));let next=1;while(ids.has(`rId${next}`))next+=1;const relationshipId=`rId${next}`;
  const relationship=`<Relationship Id="${relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xmlEscape(target)}" TargetMode="External"/>`;
  relationships=relationships.replace('</Relationships>',`${relationship}</Relationships>`);zip.file(relPart,relationships);
  if(!/\bxmlns:r="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships"/.test(worksheetXml))worksheetXml=worksheetXml.replace(/<worksheet\b/,`<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`);
  const hyperlink=`<hyperlink ref="${xmlEscape(address)}" r:id="${relationshipId}"/>`;
  if(/<hyperlinks\b[^>]*>/.test(worksheetXml))return worksheetXml.replace('</hyperlinks>',`${hyperlink}</hyperlinks>`);
  const insertion=worksheetXml.search(/<(?:printOptions|pageMargins|pageSetup|headerFooter|drawing|legacyDrawing|tableParts|extLst)\b|<\/worksheet>/);
  if(insertion<0)throw new Error('PMHistory worksheet hyperlink location is unavailable.');
  return `${worksheetXml.slice(0,insertion)}<hyperlinks>${hyperlink}</hyperlinks>${worksheetXml.slice(insertion)}`;
}

function trackerRowsByKey(sheet:ExcelJS.Worksheet,header:HeaderMap<TrackerField>) {
  const exact=new Map<string,number[]>();const aliases=new Map<string,number[]>();
  let section=trackerSectionBeforeHeader(sheet,header);
  for (let rowNumber=header.rowNumber+1;rowNumber<=sheet.rowCount;rowNumber+=1) {
    if(isTrackerHeaderRow(sheet,rowNumber,header))continue;
    const heading=trackerSectionHeading(sheet,rowNumber,header);if(heading.matched){section=heading.assetNumber?{assetNumber:heading.assetNumber,rowNumber}:null;continue;}
    const asset=(header.columns.assetNumber?cleanText(cellRawValue(sheet.getCell(rowNumber,header.columns.assetNumber))):'')||section?.assetNumber||'';
    const task=cleanText(cellRawValue(sheet.getCell(rowNumber,header.columns.taskTitle)));
    const rawInterval=cleanText(cellRawValue(sheet.getCell(rowNumber,header.columns.intervalType)));
    if (!asset&&!task&&!rawInterval) continue;
    let interval:WorkbookPmInterval;try{interval=normalizeWorkbookInterval(rawInterval);}catch{continue;}
    const taskKey=[normalizedPmKey(task),interval].join('\u001f');
    const exactKey=[normalizedPmKey(asset),taskKey].join('\u001f');
    exact.set(exactKey,[...(exact.get(exactKey)??[]),rowNumber]);
    const alias=strictPressNumberAlias(asset);if(alias){const aliasKey=[alias,taskKey].join('\u001f');aliases.set(aliasKey,[...(aliases.get(aliasKey)??[]),rowNumber]);}
  }
  return {exact,aliases};
}

function rowHasWorkbookContent(sheet:ExcelJS.Worksheet,rowNumber:number) {
  for(let column=1;column<=Math.min(Math.max(sheet.columnCount,1),100);column+=1)if(cleanText(cellRawValue(sheet.getCell(rowNumber,column))))return true;
  return false;
}

function trackerMachineSections(sheet:ExcelJS.Worksheet,header:HeaderMap<TrackerField>) {
  const headings:Array<{rowNumber:number;assetNumber:string|null;reason?:string}>=[];
  for(let rowNumber=1;rowNumber<=sheet.rowCount;rowNumber+=1){const heading=trackerSectionHeading(sheet,rowNumber,header);if(heading.matched)headings.push({rowNumber,assetNumber:heading.assetNumber,...(heading.reason?{reason:heading.reason}:{})});}
  const sections:TrackerMachineSection[]=[];
  for(let index=0;index<headings.length;index+=1){
    const heading=headings[index];if(!heading.assetNumber)continue;
    const endRow=(headings[index+1]?.rowNumber??(sheet.rowCount+1))-1;
    const repeatedHeaders:number[]=[];for(let rowNumber=heading.rowNumber+1;rowNumber<=endRow;rowNumber+=1)if(isTrackerHeaderRow(sheet,rowNumber,header))repeatedHeaders.push(rowNumber);
    let malformedReason:string|null=repeatedHeaders.length>1?'Machine/press section contains multiple tracker headers.':null;
    const dataStart=(repeatedHeaders[0]??heading.rowNumber)+1;const taskRows:ParsedTrackerRow[]=[];let unrelatedRow:number|null=null;
    for(let rowNumber=dataStart;rowNumber<=endRow;rowNumber+=1){
      if(isTrackerHeaderRow(sheet,rowNumber,header))continue;
      const task=cleanText(cellRawValue(sheet.getCell(rowNumber,header.columns.taskTitle)));const interval=cleanText(cellRawValue(sheet.getCell(rowNumber,header.columns.intervalType)));
      if(!task&&!interval){if(rowHasWorkbookContent(sheet,rowNumber)&&taskRows.length)unrelatedRow??=rowNumber;continue;}
      try{
        const parsed=parseTrackerRow(sheet,rowNumber,header,{assetNumber:heading.assetNumber,rowNumber:heading.rowNumber});
        if(parsed){if(unrelatedRow!==null)malformedReason=`Machine/press section has PM rows after unrelated content at row ${unrelatedRow}.`;taskRows.push(parsed);}
      }catch(error){if(taskRows.length)unrelatedRow??=rowNumber;else malformedReason=error instanceof Error?error.message:'Machine/press section is malformed.';}
    }
    if(!taskRows.length&&!malformedReason)malformedReason='Machine/press section does not contain a PM row that can be used as a formatting template.';
    sections.push({assetNumber:heading.assetNumber,headingRow:heading.rowNumber,endRow,taskRows,malformedReason});
  }
  return sections;
}

function resolveTrackerMachineSection(sheet:ExcelJS.Worksheet,header:HeaderMap<TrackerField>,assetNumber:string) {
  const sections=trackerMachineSections(sheet,header);const exact=sections.filter(section=>normalizedPmKey(section.assetNumber)===normalizedPmKey(assetNumber));let matches=exact;
  if(!matches.length){const alias=strictPressNumberAlias(assetNumber);if(alias)matches=sections.filter(section=>strictPressNumberAlias(section.assetNumber)===alias);}
  if(matches.length!==1)throw new Error(matches.length?`Machine/press section is ambiguous for ${assetNumber}; the workbook was not changed.`:`Machine/press section could not be resolved for ${assetNumber}; the workbook was not changed.`);
  const section=matches[0];if(section.malformedReason)throw new Error(`Machine/press section for ${assetNumber} is malformed: ${section.malformedReason} The workbook was not changed.`);
  return section;
}

function historyExistingKeys(sheet:ExcelJS.Worksheet,header:HeaderMap<HistoryField>) {
  const keys=new Set<string>();
  for (let rowNumber=header.rowNumber+1;rowNumber<=sheet.rowCount;rowNumber+=1) {
    try { const row=parseHistoryRow(sheet,rowNumber,header);if (row) keys.add(`ref:${row.sourceRef}`); } catch {/* Existing legacy rows remain untouched. */}
  }
  return keys;
}

function lastHistoryDataRow(sheet:ExcelJS.Worksheet,header:HeaderMap<HistoryField>) {
  const columns=Object.values(header.columns);
  for (let rowNumber=sheet.rowCount;rowNumber>header.rowNumber;rowNumber-=1) if (columns.some(column=>cleanText(cellRawValue(sheet.getCell(rowNumber,column)))!=='')) return rowNumber;
  return header.rowNumber;
}

export async function synchronizePmWorkbook(input:{sourcePath:string;destinationPath:string;backupDir:string;trackerUpdates:TrackerWorkbookUpdate[];historyRows:HistoryWorkbookAppend[];beforeReplace?:()=>void|Promise<void>}) {
  const sourcePath=path.resolve(input.sourcePath);const destinationPath=path.resolve(input.destinationPath);const backupDir=path.resolve(input.backupDir);
  if (!fs.existsSync(sourcePath)||!fs.statSync(sourcePath).isFile()) throw new Error('The synchronized PM workbook source is unavailable.');
  fs.mkdirSync(path.dirname(destinationPath),{recursive:true});fs.mkdirSync(backupDir,{recursive:true});
  const temporaryPath=path.join(path.dirname(destinationPath),`.pm-sync-${crypto.randomUUID()}.xlsx`);
  let backupPath:string|null=null;let destinationMoved=false;
  try {
    const sourceBuffer=fs.readFileSync(sourcePath);const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(sourceBuffer.buffer.slice(sourceBuffer.byteOffset,sourceBuffer.byteOffset+sourceBuffer.byteLength) as ArrayBuffer);const zip=await JSZip.loadAsync(sourceBuffer);const sheetParts=await workbookSheetParts(zip);
    const tracker=workbook.getWorksheet(PM_TRACKER_SHEET);const history=workbook.getWorksheet(PM_HISTORY_SHEET);
    if (!tracker||!history) throw new Error(`Workbook must contain ${PM_TRACKER_SHEET} and ${PM_HISTORY_SHEET}.`);
    const trackerPart=sheetParts.get(PM_TRACKER_SHEET);const historyPart=sheetParts.get(PM_HISTORY_SHEET);if(!trackerPart||!historyPart)throw new Error('Workbook worksheet package parts are unavailable.');
    let trackerXml=await zip.file(trackerPart)?.async('string');let historyXml=await zip.file(historyPart)?.async('string');if(!trackerXml||!historyXml)throw new Error('Workbook worksheet data is unreadable.');const date1904=Boolean(workbook.properties.date1904);
    const historyHeader=findHeader(history,historyAliases,historyRequired);
    let changedCells=0;const formulaExpectations:FormulaExpectation[]=[];
    for (const update of input.trackerUpdates) {
      zip.file(trackerPart,trackerXml);const trackerViewBuffer=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:1}});const trackerViewWorkbook=new ExcelJS.Workbook();await trackerViewWorkbook.xlsx.load(trackerViewBuffer.buffer.slice(trackerViewBuffer.byteOffset,trackerViewBuffer.byteOffset+trackerViewBuffer.byteLength) as ArrayBuffer);const trackerView=trackerViewWorkbook.getWorksheet(PM_TRACKER_SHEET)!;const trackerHeader=findHeader(trackerView,trackerAliases,trackerRequired);const rowsByKey=trackerRowsByKey(trackerView,trackerHeader);
      const taskKey=[normalizedPmKey(update.matchTaskTitle??update.taskTitle),update.matchIntervalType??update.intervalType].join('\u001f');const exactKey=[normalizedPmKey(update.assetNumber),taskKey].join('\u001f');let matches=rowsByKey.exact.get(exactKey)??[];
      if(!matches.length){const alias=strictPressNumberAlias(update.assetNumber);if(alias)matches=rowsByKey.aliases.get([alias,taskKey].join('\u001f'))??[];}
      if(matches.length>1)throw new Error(`Ambiguous Machine Pm Tracker match for ${update.assetNumber} / ${update.taskTitle}.`);
      let row=matches[0]??0;let inserted=false;let templateRow=0;let sectionAssetNumber='';let inheritedAssetNumber=true;
      if(!row){const section=resolveTrackerMachineSection(trackerView,trackerHeader,update.assetNumber);const lastTask=section.taskRows.reduce((latest,item)=>item.rowNumber>latest.rowNumber?item:latest);const meterUpdate=update.intervalType==='hourly'||update.intervalType==='cycles';const exactTemplates=section.taskRows.filter(item=>item.intervalType===update.intervalType);const categoryTemplates=section.taskRows.filter(item=>(item.intervalType==='hourly'||item.intervalType==='cycles')===meterUpdate);const template=(exactTemplates.length?exactTemplates:categoryTemplates.length?categoryTemplates:section.taskRows).reduce((latest,item)=>item.rowNumber>latest.rowNumber?item:latest);row=lastTask.rowNumber+1;templateRow=template.rowNumber;sectionAssetNumber=section.assetNumber;inheritedAssetNumber=template.assetNumberInherited;const formulaTemplates=await worksheetFormulaTemplates(zip,trackerPart,trackerView,templateRow);for(const expectation of formulaExpectations){const expectationRow=Number(/\d+$/.exec(expectation.address)?.[0]??0);if(expectationRow>=row){expectation.address=`${expectation.address.replace(/\d+$/,'')}${expectationRow+1}`;expectation.formula=shiftFormulaForInsertion(expectation.formula,row);}}trackerXml=deshareFormulaGroupsForInsertion(trackerXml,trackerView,row);trackerXml=insertWorksheetRow(trackerXml,row,templateRow,formulaTemplates);for(const [column,formula] of formulaTemplates)formulaExpectations.push({sheetName:PM_TRACKER_SHEET,address:`${cellColumnLetters(column)}${row}`,formula:shiftFormulaRows(formula,row-templateRow)});await shiftTrackerTables(zip,trackerPart,row,templateRow);await shiftWorkbookDefinedNames(zip,PM_TRACKER_SHEET,workbook.worksheets.findIndex(sheet=>sheet.name===PM_TRACKER_SHEET),row,templateRow);inserted=true;}
      const meter=update.intervalType==='hourly'||update.intervalType==='cycles';
      const targets:Array<[TrackerField,unknown]>=[
        ...((inserted&&trackerHeader.columns.assetNumber&&!inheritedAssetNumber)?[['assetNumber',sectionAssetNumber] as [TrackerField,unknown]]:[]),
        ...((inserted&&trackerHeader.columns.assetName&&update.assetName!==undefined)?[['assetName',update.assetName] as [TrackerField,unknown]]:[]),
        ['taskTitle',update.taskTitle],
        ['intervalType',update.intervalType==='cycles'?'Cycles':update.intervalType[0].toUpperCase()+update.intervalType.slice(1)],
        ['intervalValue',update.intervalValue],
        ['lastCompleted',meter?update.lastCompletedMeter:workbookValue(update.lastCompletedDate,true)],
        ['current',meter?update.currentMeter:workbookValue(update.currentDate,true)],
        ['due',meter?update.lastCompletedMeter===null?null:update.lastCompletedMeter+update.intervalValue:workbookValue(calculateWorkbookPm({intervalType:update.intervalType,intervalValue:update.intervalValue,lastCompletedDate:update.lastCompletedDate,currentDate:update.currentDate}).nextDueDate,true)],
        ['remaining',update.remaining],['status',update.status],
      ];
      for (const [field,value] of targets) {const column=trackerHeader.columns[field];if(!column)continue;const address=trackerView.getCell(row,column).address;const formula=worksheetCellHasFormula(trackerXml,address);if(formula){if(!['current','due','remaining','status'].includes(field)){if(inserted)throw new Error(`Machine Pm Tracker ${address} cannot be populated because the formatting template contains a protected formula.`);continue;}const expectedFormula=formulaExpectations.find(item=>item.sheetName===PM_TRACKER_SHEET&&item.address===address)?.formula;const modelFormula=trackerView.getCell(row,column).formula;const cached=trackerFormulaCachedResult(field,expectedFormula??(typeof modelFormula==='string'?modelFormula:undefined),update);if(inserted&&['due','remaining','status'].includes(field)&&!cached.known)continue;const patched=setWorksheetFormulaResult(trackerXml,address,cached.known?cached.value:value,date1904);trackerXml=patched.xml;if(patched.changed)changedCells+=1;continue;}const cell=inserted?null:trackerView.getCell(row,column);if(cell&&sameCellValue(cell,value))continue;const patched=setWorksheetCell(trackerXml,address,value,date1904,inserted?trackerView.getCell(templateRow,column).address:undefined);trackerXml=patched.xml;if(patched.changed)changedCells+=1;}
    }
    const existing=historyExistingKeys(history,historyHeader);let appendedHistory=0;let previousHistoryRow=lastHistoryDataRow(history,historyHeader);let lastAppendedHistoryRow=previousHistoryRow;
    for (const row of input.historyRows) {
      const base={...row,rowNumber:0,sourceRef:''};
      const sourceRef=historySourceRef({assetNumber:base.assetNumber,workOrderNumber:base.workOrderNumber,taskStatus:base.taskStatus,startDate:base.startDate,completionDate:base.completionDate,workOrderType:base.workOrderType,performedBy:base.performedBy,intervalType:base.intervalType,taskType:base.taskType,taskNote:base.taskNote});
      if (existing.has(`ref:${sourceRef}`)) continue;
      const rowNumber=previousHistoryRow+1;historyXml=ensureWorksheetRow(historyXml,rowNumber,previousHistoryRow>historyHeader.rowNumber?previousHistoryRow:null);
      const values:Record<HistoryField,unknown>={assetNumber:row.assetNumber,workOrderNumber:row.workOrderNumber,taskStatus:row.taskStatus,startDate:workbookValue(row.startDate,true),completionDate:workbookValue(row.completionDate,true),workOrderType:row.workOrderType,performedBy:row.performedBy,intervalType:row.intervalType==='cycles'?'Cycles':row.intervalType[0].toUpperCase()+row.intervalType.slice(1),taskType:row.taskType,taskNote:row.taskNote};
      for(const [field,column] of Object.entries(historyHeader.columns) as Array<[HistoryField,number]>){const address=history.getCell(rowNumber,column).address;const templateAddress=history.getCell(previousHistoryRow,column).address;const patched=setWorksheetCell(historyXml,address,values[field],date1904,templateAddress);if(!patched.changed)throw new Error(`PMHistory ${address} cannot be updated because it contains a protected formula.`);historyXml=patched.xml;}
      if(row.workOrderHyperlink)historyXml=await addWorksheetExternalHyperlink(zip,historyPart,historyXml,history.getCell(rowNumber,historyHeader.columns.workOrderNumber).address,row.workOrderHyperlink);
      previousHistoryRow=rowNumber;lastAppendedHistoryRow=rowNumber;appendedHistory+=1;existing.add(`ref:${sourceRef}`);
    }
    historyXml=extendWorksheetDimension(historyXml,lastAppendedHistoryRow);zip.file(trackerPart,trackerXml);zip.file(historyPart,historyXml);if(appendedHistory)await extendHistoryTable(zip,historyPart,historyHeader.rowNumber,lastAppendedHistoryRow);await requestFullWorkbookCalculation(zip);
    const generated=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:6}});await validatePmWorkbookOoxml(generated,formulaExpectations);const parsedValidation=await inspectPmWorkbook(generated);for(const update of input.trackerUpdates){const matching=parsedValidation.trackerRows.filter(row=>row.intervalType===update.intervalType&&normalizedPmKey(row.taskTitle)===normalizedPmKey(update.taskTitle));const exact=matching.filter(row=>normalizedPmKey(row.assetNumber)===normalizedPmKey(update.assetNumber));const alias=strictPressNumberAlias(update.assetNumber);const resolved=exact.length?exact:alias?matching.filter(row=>strictPressNumberAlias(row.assetNumber)===alias):[];if(resolved.length!==1)throw new Error(`Workbook validation failed for ${update.assetNumber} / ${update.taskTitle}: expected exactly one synchronized tracker row.`);}fs.writeFileSync(temporaryPath,generated,{flag:'wx'});
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
