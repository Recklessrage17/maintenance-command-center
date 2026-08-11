import { Component, type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MccAccordionHeader, MccCategoryAccordion } from '../../components/MccCategoryAccordion';
import { MccDateInput, isValidMccDateValue, localIsoDate } from '../../components/MccDateInput';
import { MccSummaryToken, MccSummaryTokenGroup } from '../../components/MccSummaryToken';
import { createRequestId } from '../../utils/requestId';
import { PmActionButtonLabel, PmActionProgress, pollPmWorkflowStatus, usePmActionProgress } from '../preventive-maintenance/PmActionProgress';
import { PmAssetHistoryModal, PmMachineMeterPanel } from '../preventive-maintenance/PmAssetControls';
import { PmCompleteWorkflowModal, PmDeleteScheduleModal } from '../preventive-maintenance/PmWorkflowModals';
import { notifyPmUpdated } from './pmEvents';

export type AssetIdentity={id:number;assetNumber:string;assetName:string;brand?:string};
export type AssetLibraryScope='machine'|'equipment';
export type PmIntervalType='hourly'|'days'|'bi_weekly'|'weekly'|'monthly'|'quarterly'|'bi_annual'|'annual'|'cycles';
export type PmStatus='Current'|'Due Soon'|'Due Now'|'Overdue'|'Past Due'|'Hold'|'Inactive'|'Setup incomplete';
type PmScheduleStatus='active'|'hold'|'inactive';
export type PmTask={id:number;assetId:number;title:string;instructions:string;intervalType:PmIntervalType;intervalLabel:string;intervalValue:number;lastCompletedDate:string|null;lastCompletedMeter:number|null;currentMeter:number|null;nextDueDate:string|null;nextDueMeter:number|null;scheduleStatus:PmScheduleStatus;notes:string;status:PmStatus;countdown:string;historyCount:number;deleted?:boolean;createdAt:string;updatedAt:string};
type PmWorkOrderAttachment={id:number;filename:string;sizeBytes:number;mimeType:string;sha256:string;uploadedBy:string;uploadedAt:string;status:'available'|'missing';openUrl:string};
export type PmParticipant={userId:number|null;displayName:string;isPrimary:boolean;order:number};
export type PmHistory={id:number;workOrderNumber:string;followUpRequired:boolean;followUpReason:string;attachment:PmWorkOrderAttachment|null;completionDate:string;completedMeter:number|null;performedBy:string;participants:PmParticipant[];completionNotes:string;previousDueDate:string|null;previousDueMeter:number|null;nextDueDate:string|null;nextDueMeter:number|null;createdAt:string};
type PmSummary={total:number;dueSoon:number;overdue:number;nextDueDate:string|null;nextDueMeter:number|null};
type PmDraft={title:string;instructions:string;intervalType:PmIntervalType|'';intervalValue:string;lastCompletedDate:string;lastCompletedMeter:string;currentMeter:string;scheduleStatus:PmScheduleStatus;notes:string};
type PmDraftErrorKey='title'|'intervalType'|'interval'|'date'|'lastMeter'|'currentMeter';
type PmDuePreview={label:string;value:string;legend:string;tone:'current'|'due-soon'|'due-now'|'overdue'|'hold'|'inactive'|'incomplete'};

const intervalOptions:Array<{key:PmIntervalType;label:string}>=[
  {key:'hourly',label:'Hourly'},{key:'cycles',label:'Cycles'},{key:'days',label:'Days'},{key:'annual',label:'Annual'},
];
const meterIntervals=new Set<string>(['hourly','cycles']);
const calendarDueSoonDays=14;
const meterDueSoonRatio=0.1;
const fixedCadences:Partial<Record<PmIntervalType,{value:number;label:string;days?:number;months?:number}>>={
  bi_weekly:{value:14,label:'Every 14 days',days:14},quarterly:{value:3,label:'Every 3 months',months:3},bi_annual:{value:6,label:'Every 6 months',months:6},annual:{value:12,label:'Every 12 months',months:12},
};
const fixedIntervals=new Set<string>(Object.keys(fixedCadences));
const intervalGuidance:Partial<Record<PmIntervalType,string>>={hourly:'0.0 hrs',cycles:'0 cycles',days:'0 days',weekly:'0 weeks',monthly:'0 months'};
const blankDraft:PmDraft={title:'',instructions:'',intervalType:'',intervalValue:'',lastCompletedDate:'',lastCompletedMeter:'',currentMeter:'',scheduleStatus:'active',notes:''};
const emptySummary:PmSummary={total:0,dueSoon:0,overdue:0,nextDueDate:null,nextDueMeter:null};
const validStatuses=new Set<PmStatus>(['Current','Due Soon','Due Now','Overdue','Past Due','Hold','Inactive','Setup incomplete']);

function useRequestId(){const requestId=useRef('');if(!requestId.current)requestId.current=createRequestId();return requestId;}

function isRecord(value:unknown):value is Record<string,unknown>{return Boolean(value)&&typeof value==='object'&&!Array.isArray(value);}
function safeString(value:unknown,fallback=''){return typeof value==='string'?value:fallback;}
function safeNumber(value:unknown):number|null{return typeof value==='number'&&Number.isFinite(value)?value:null;}
function safeCount(value:unknown,fallback=0){const number=safeNumber(value);return number===null?fallback:Math.max(0,Math.trunc(number));}
function safeDateValue(value:unknown){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)?value:null;}
function normalizePmTask(value:unknown):PmTask|null{
  if(!isRecord(value))return null;
  const id=safeNumber(value.id);const assetId=safeNumber(value.assetId);
  if(id===null||assetId===null)return null;
  const rawInterval=safeString(value.intervalType) as PmIntervalType;
  const intervalType=intervalOptions.some(option=>option.key===rawInterval)?rawInterval:'days';
  const rawStatus=safeString(value.status) as PmStatus;
  const status=validStatuses.has(rawStatus)?rawStatus:'Setup incomplete';
  const rawSchedule=safeString(value.scheduleStatus).toLowerCase();
  const scheduleStatus:PmScheduleStatus=rawSchedule==='active'||rawSchedule==='hold'||rawSchedule==='inactive'?rawSchedule:status==='Hold'?'hold':value.active===true?'active':'inactive';
  return {id,assetId,title:safeString(value.title,'Untitled PM task'),instructions:safeString(value.instructions),intervalType,intervalLabel:safeString(value.intervalLabel,intervalOptions.find(option=>option.key===intervalType)?.label??'PM interval'),intervalValue:safeNumber(value.intervalValue)??0,lastCompletedDate:safeDateValue(value.lastCompletedDate),lastCompletedMeter:safeNumber(value.lastCompletedMeter),currentMeter:safeNumber(value.currentMeter),nextDueDate:safeDateValue(value.nextDueDate),nextDueMeter:safeNumber(value.nextDueMeter),scheduleStatus,notes:safeString(value.notes),status,countdown:safeString(value.countdown,status==='Setup incomplete'?'PM setup is incomplete':''),historyCount:safeCount(value.historyCount),deleted:value.deleted===true,createdAt:safeString(value.createdAt),updatedAt:safeString(value.updatedAt)};
}
function normalizePmTasks(value:unknown){return Array.isArray(value)?value.map(normalizePmTask).filter((task):task is PmTask=>task!==null):[];}
function normalizePmSummary(value:unknown,tasks:PmTask[]):PmSummary{
  const record=isRecord(value)?value:{};
  const activeTasks=tasks.filter(task=>task.scheduleStatus==='active');
  const calculatedDate=activeTasks.map(task=>task.nextDueDate).filter((date):date is string=>Boolean(date)).sort()[0]??null;
  const calculatedMeter=activeTasks.map(task=>task.nextDueMeter).filter((meter):meter is number=>meter!==null).sort((a,b)=>a-b)[0]??null;
  return {total:safeCount(record.total,tasks.length),dueSoon:safeCount(record.dueSoon,tasks.filter(task=>task.status==='Due Soon').length),overdue:safeCount(record.overdue,tasks.filter(task=>task.status==='Overdue').length),nextDueDate:safeDateValue(record.nextDueDate)??calculatedDate,nextDueMeter:safeNumber(record.nextDueMeter)??calculatedMeter};
}
function normalizePmHistory(value:unknown):PmHistory[]{
  if(!Array.isArray(value))return [];
  return value.map(item=>{
    if(!isRecord(item)||safeNumber(item.id)===null)return null;
    const rawAttachment=isRecord(item.attachment)?item.attachment:null;const attachmentId=rawAttachment?safeNumber(rawAttachment.id):null;const attachment=rawAttachment&&attachmentId!==null?{id:attachmentId,filename:safeString(rawAttachment.filename,'Work-order PDF'),sizeBytes:safeNumber(rawAttachment.sizeBytes)??0,mimeType:safeString(rawAttachment.mimeType,'application/pdf'),sha256:safeString(rawAttachment.sha256),uploadedBy:safeString(rawAttachment.uploadedBy,'Unknown user'),uploadedAt:safeString(rawAttachment.uploadedAt),status:rawAttachment.status==='available'?'available' as const:'missing' as const,openUrl:safeString(rawAttachment.openUrl)}:null;
    const participants=Array.isArray(item.participants)?item.participants.map((participant,index)=>isRecord(participant)?{userId:safeNumber(participant.userId),displayName:safeString(participant.displayName,'Unknown user'),isPrimary:participant.isPrimary===true,order:safeNumber(participant.order)??index}:null).filter((participant):participant is PmParticipant=>participant!==null):[];const performedBy=safeString(item.performedBy,'Unknown user');
    return {id:safeNumber(item.id)!,workOrderNumber:safeString(item.workOrderNumber,'N/A'),followUpRequired:item.followUpRequired===true,followUpReason:safeString(item.followUpReason),attachment,completionDate:safeDateValue(item.completionDate)??'',completedMeter:safeNumber(item.completedMeter),performedBy,participants:participants.length?participants:[{userId:null,displayName:performedBy,isPrimary:true,order:0}],completionNotes:safeString(item.completionNotes),previousDueDate:safeDateValue(item.previousDueDate),previousDueMeter:safeNumber(item.previousDueMeter),nextDueDate:safeDateValue(item.nextDueDate),nextDueMeter:safeNumber(item.nextDueMeter),createdAt:safeString(item.createdAt)};
  }).filter((item):item is PmHistory=>item!==null);
}

async function requestJson<T>(url:string,init?:RequestInit) {
  const jsonBody=Boolean(init?.body)&&!(init?.body instanceof FormData);
  const response=await fetch(url,{...init,credentials:'include',headers:{...(jsonBody?{'Content-Type':'application/json'}:{}),...(init?.headers??{})}});
  const contentType=response.headers.get('content-type')??'';
  const isJson=contentType.toLowerCase().includes('application/json');
  if(!response.ok){
    let detail=response.statusText||'Request failed';
    if(isJson){try{const data=await response.json() as {error?:unknown};detail=safeString(data?.error,detail);}catch{/* The development log below retains the response metadata. */}}
    else {try{await response.text();}catch{/* Ignore an unreadable error body. */}}
    if(import.meta.env.DEV)console.error('PM API request failed',{endpoint:url,status:response.status,contentType});
    throw new Error(`${detail} (${response.status})`);
  }
  if(!isJson){
    if(import.meta.env.DEV)console.error('PM API returned a non-JSON success response',{endpoint:url,status:response.status,contentType});
    throw new Error('Preventive maintenance service returned an invalid response. Please try again.');
  }
  try{
    const data=await response.json() as T;
    if(init?.method&&init.method.toUpperCase()!=='GET')notifyPmUpdated();
    return data;
  }
  catch(error){
    if(import.meta.env.DEV)console.error('PM API returned invalid JSON',{endpoint:url,status:response.status,contentType,error});
    throw new Error('Preventive maintenance service returned an invalid response. Please try again.');
  }
}
function formatDate(value:unknown) {
  if(typeof value!=='string'||!value)return 'Not set';
  const parsed=new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime())?value:parsed.toLocaleDateString();
}
function formatMeter(value:unknown) { return typeof value==='number'&&Number.isFinite(value)?value.toLocaleString():'Not set'; }
function formatNumber(value:unknown){return typeof value==='number'&&Number.isFinite(value)?value.toLocaleString():'0';}
function escapePrintHtml(value:unknown){return String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]??character));}
function printFileToken(value:string){return value.trim().replace(/[^A-Za-z0-9._-]+/g,'_').replace(/^_+|_+$/g,'').slice(0,80)||'PM';}
function pluralizedUnit(value:number,singular:string,plural=`${singular}s`){return Math.abs(value)===1?singular:plural;}
function formatMeterMetric(value:number|null,intervalType:PmIntervalType){if(value===null)return 'Not set';return `${formatNumber(value)} ${intervalType==='hourly'?pluralizedUnit(value,'hr'):pluralizedUnit(value,'cycle')}`;}
function taskToDraft(task:PmTask):PmDraft { return {title:safeString(task.title),instructions:safeString(task.instructions),intervalType:task.intervalType,intervalValue:fixedIntervals.has(task.intervalType)?'':String(safeNumber(task.intervalValue)??''),lastCompletedDate:safeDateValue(task.lastCompletedDate)??'',lastCompletedMeter:safeNumber(task.lastCompletedMeter)===null?'':String(task.lastCompletedMeter),currentMeter:safeNumber(task.currentMeter)===null?'':String(task.currentMeter),scheduleStatus:task.scheduleStatus,notes:safeString(task.notes)}; }
function addDays(value:string,days:number){const date=new Date(`${value}T12:00:00Z`);if(Number.isNaN(date.getTime())||!Number.isFinite(days))return null;date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);}
function addMonths(value:string,months:number){const date=new Date(`${value}T12:00:00Z`);if(Number.isNaN(date.getTime())||!Number.isFinite(months))return null;const day=date.getUTCDate();date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+months);const last=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0,12)).getUTCDate();date.setUTCDate(Math.min(day,last));return date.toISOString().slice(0,10);}
function cadenceLabel(intervalType:PmIntervalType,intervalValue:number) {
  const fixedLabels:Partial<Record<PmIntervalType,string>>={bi_weekly:'Bi-weekly',quarterly:'Quarterly',bi_annual:'Bi-annual',annual:'Annual'};
  if(fixedLabels[intervalType])return fixedLabels[intervalType]!;
  const units:Record<'hourly'|'cycles'|'days'|'weekly'|'monthly',{singular:string;plural:string}>={hourly:{singular:'hour',plural:'hours'},cycles:{singular:'cycle',plural:'cycles'},days:{singular:'day',plural:'days'},weekly:{singular:'week',plural:'weeks'},monthly:{singular:'month',plural:'months'}};
  const unit=units[intervalType as keyof typeof units];
  return `Every ${formatNumber(intervalValue)} ${unit?pluralizedUnit(intervalValue,unit.singular,unit.plural):'intervals'}`;
}
function intervalTone(intervalType:PmIntervalType,intervalValue:number){
  if(intervalType==='hourly')return 'hours';
  if(intervalType==='cycles')return 'cycles';
  if(intervalType==='annual')return 'annual';
  const approximateDays=intervalType==='days'?intervalValue:intervalType==='weekly'?intervalValue*7:intervalType==='monthly'?intervalValue*30:intervalType==='bi_weekly'?14:intervalType==='quarterly'?90:intervalType==='bi_annual'?180:null;
  if(approximateDays===30)return '30-days';
  if(approximateDays===60)return '60-days';
  if(approximateDays===90)return '90-days';
  if(approximateDays===180)return '180-days';
  if(approximateDays===365)return '365-days';
  return 'calendar';
}
function countdownParts(countdown:string,status:PmStatus){
  const match=countdown.match(/^(.*?)(-?[\d][\d,.]*)(\s*)([A-Za-z]+)?(.*)$/);
  if(!match)return null;
  return {lead:status==='Overdue'?'Overdue: ':match[1],value:status==='Overdue'?`-${match[2].replace(/^-/, '')}`:match[2],unitSpacing:match[3],unit:match[4]??'',tail:match[5]};
}
function calendarPastDueText(intervalType:PmIntervalType,nextDate:string,today:string,daysPastDue:number){
  if(['monthly','quarterly','bi_annual','annual'].includes(intervalType)){
    const due=new Date(`${nextDate}T12:00:00Z`);const current=new Date(`${today}T12:00:00Z`);let months=(current.getUTCFullYear()-due.getUTCFullYear())*12+current.getUTCMonth()-due.getUTCMonth();if(current.getUTCDate()<due.getUTCDate())months-=1;
    if(months>=1)return `Past due by ${months.toLocaleString()} ${pluralizedUnit(months,'month')}`;
  }
  return `Past due by ${daysPastDue.toLocaleString()} ${pluralizedUnit(daysPastDue,'day')}`;
}
function calculatedDue(draft:PmDraft){
  if(!draft.intervalType)return null;
  const fixed=fixedCadences[draft.intervalType];
  const amount=fixed?.value??Number(draft.intervalValue);
  if(!Number.isFinite(amount)||amount<=0)return null;
  if(meterIntervals.has(draft.intervalType)){
    const completed=Number(draft.lastCompletedMeter);
    return draft.lastCompletedMeter!==''&&Number.isFinite(completed)&&completed>=0?{amount,nextDate:null,nextMeter:completed+amount}:null;
  }
  if(!isValidMccDateValue(draft.lastCompletedDate,true))return null;
  if(draft.intervalType==='days')return {amount,nextDate:addDays(draft.lastCompletedDate,amount),nextMeter:null};
  if(draft.intervalType==='weekly')return {amount,nextDate:addDays(draft.lastCompletedDate,amount*7),nextMeter:null};
  if(draft.intervalType==='monthly')return {amount,nextDate:addMonths(draft.lastCompletedDate,amount),nextMeter:null};
  if(fixed?.days)return {amount,nextDate:addDays(draft.lastCompletedDate,fixed.days),nextMeter:null};
  if(fixed?.months)return {amount,nextDate:addMonths(draft.lastCompletedDate,fixed.months),nextMeter:null};
  return null;
}
function pmDuePreview(draft:PmDraft):PmDuePreview {
  if(!draft.intervalType)return {label:'Next PM Due Date',value:'Not calculated',legend:'Select an interval type to calculate the next due value.',tone:'incomplete'};
  const due=calculatedDue(draft);
  const hold=draft.scheduleStatus==='hold';
  const inactive=draft.scheduleStatus==='inactive';
  if(inactive){
    const reference=due?.nextMeter!==null&&due?.nextMeter!==undefined?`Reference due at ${due.nextMeter.toLocaleString()} ${draft.intervalType==='hourly'?'hours':'cycles'}`:due?.nextDate?formatDate(due.nextDate):'Reference due not calculated';
    return {label:meterIntervals.has(draft.intervalType)?'Stored meter reference':'Stored due date reference',value:reference,legend:'Inactive — PM tracking paused',tone:'inactive'};
  }
  if(!due)return {label:meterIntervals.has(draft.intervalType)?'Next meter due':'Next PM Due Date',value:'Setup incomplete',legend:meterIntervals.has(draft.intervalType)?'Add the last completed meter and a valid interval.':'Add a valid starting date and interval.',tone:'incomplete'};
  if(due.nextMeter!==null){
    const unit=draft.intervalType==='hourly'?'hours':'cycles';
    if(hold)return {label:'Next meter due',value:`Next due at ${due.nextMeter.toLocaleString()} ${unit}`,legend:'Hold - schedule preserved while overdue tracking is paused.',tone:'hold'};
    if(draft.currentMeter==='')return {label:'Next meter due',value:`Next due at ${due.nextMeter.toLocaleString()} ${unit}`,legend:`Setup incomplete - current ${unit} not entered.`,tone:'incomplete'};
    const current=Number(draft.currentMeter);if(!Number.isFinite(current)||current<0)return {label:'Next meter due',value:`Next due at ${due.nextMeter.toLocaleString()} ${unit}`,legend:`Setup incomplete - enter valid current ${unit}.`,tone:'incomplete'};const remaining=due.nextMeter-current;const threshold=Math.max(1,due.amount*meterDueSoonRatio);
    if(remaining<0){const overdue=Math.abs(remaining);return {label:'Overdue',value:`Past due by ${overdue.toLocaleString()} ${pluralizedUnit(overdue,draft.intervalType==='hourly'?'hour':'cycle')}`,legend:'',tone:'overdue'};}
    if(remaining===0)return {label:'Next meter due',value:`Next due at ${due.nextMeter.toLocaleString()} ${unit}`,legend:'Due Now — perform maintenance now',tone:'due-now'};
    if(remaining<=threshold)return {label:'Next meter due',value:`Next due at ${due.nextMeter.toLocaleString()} ${unit}`,legend:`Due Soon - ${remaining.toLocaleString()} ${unit} remain.`,tone:'due-soon'};
    return {label:'Next meter due',value:`Next due at ${due.nextMeter.toLocaleString()} ${unit}`,legend:`Current - ${remaining.toLocaleString()} ${unit} remain.`,tone:'current'};
  }
  const nextDate=due.nextDate!;const today=localIsoDate(new Date());const days=Math.round((Date.parse(`${nextDate}T12:00:00Z`)-Date.parse(`${today}T12:00:00Z`))/86400000);
  if(hold)return {label:'Next PM Due Date',value:formatDate(nextDate),legend:'Hold - schedule preserved while overdue tracking is paused.',tone:'hold'};
  if(days<0)return {label:'Overdue',value:calendarPastDueText(draft.intervalType,nextDate,today,Math.abs(days)),legend:'',tone:'overdue'};
  if(days===0)return {label:'Next PM Due Date',value:formatDate(nextDate),legend:'Due Now — perform maintenance today',tone:'due-now'};
  if(days<=calendarDueSoonDays)return {label:'Next PM Due Date',value:formatDate(nextDate),legend:`Due Soon - due in ${days} day${days===1?'':'s'}.`,tone:'due-soon'};
  return {label:'Next PM Due Date',value:formatDate(nextDate),legend:`Current - due in ${days} days.`,tone:'current'};
}
function PmUnavailablePanel({message='Preventive maintenance tracking is temporarily unavailable. The rest of this asset record is still available.'}:{message?:string}){
  return <MccCategoryAccordion accent="pm" expanded className="pm-tracking-card glass-panel glass-panel--nested"><MccAccordionHeader title="Preventive Maintenance Tracking" summary="Setup incomplete" expanded className="pm-unavailable-heading" /><div className="machine-detail-accordion-panel" aria-hidden="false"><div className="glass-empty-state"><strong>PM tracking unavailable</strong><span>{message}</span></div></div></MccCategoryAccordion>;
}
class PmPanelErrorBoundary extends Component<{children:ReactNode},{failed:boolean}>{
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){return this.state.failed?<PmUnavailablePanel />:this.props.children;}
}

export function PreventiveMaintenanceTracking({asset,canEdit,library='machine',performedBy='Signed-in maintenance user'}:{asset:AssetIdentity|null|undefined;canEdit:boolean|undefined;library?:AssetLibraryScope;performedBy?:string}) {
  if(!asset||!Number.isFinite(asset.id))return <PmUnavailablePanel message="This asset is missing the information needed to load PM tracking." />;
  return <PmPanelErrorBoundary key={`${library}-${asset.id}`}><PreventiveMaintenanceTrackingContent asset={asset} canEdit={Boolean(canEdit)} library={library} performedBy={performedBy} /></PmPanelErrorBoundary>;
}

function PreventiveMaintenanceTrackingContent({asset,canEdit,library,performedBy}:{asset:AssetIdentity;canEdit:boolean;library:AssetLibraryScope;performedBy:string}) {
  const apiBase=`/api/${library}-library`;
  const [expanded,setExpanded]=useState(false);
  const [tasks,setTasks]=useState<PmTask[]>([]);
  const [summary,setSummary]=useState<PmSummary>(emptySummary);
  const [loading,setLoading]=useState(true);
  const [refreshing,setRefreshing]=useState(false);
  const [error,setError]=useState('');
  const [formTask,setFormTask]=useState<PmTask|null|undefined>(undefined);
  const [viewTask,setViewTask]=useState<PmTask|null>(null);
  const [completeTask,setCompleteTask]=useState<PmTask|null>(null);
  const [historyTask,setHistoryTask]=useState<PmTask|null>(null);
  const [deleteTask,setDeleteTask]=useState<PmTask|null>(null);
  const [assetHistoryOpen,setAssetHistoryOpen]=useState(false);
  const scheduleAction=usePmActionProgress({label:'Updating PM schedule',pollStatus:()=>pollPmWorkflowStatus(library,asset.id)});

  async function load(background=false) {
    if(background)setRefreshing(true);else setLoading(true);setError('');
    try{const data=await requestJson<unknown>(`${apiBase}/assets/${asset.id}/preventive-maintenance`);const safeTasks=Array.isArray(data)?normalizePmTasks(data):isRecord(data)?normalizePmTasks(data.tasks):null;if(safeTasks===null)throw new Error('Preventive maintenance data is temporarily unavailable.');setTasks(safeTasks);setSummary(normalizePmSummary(isRecord(data)?data.summary:null,safeTasks));}
    catch(value){if(!background){setTasks([]);setSummary(emptySummary);}setError((value as Error).message||'Preventive maintenance tracking could not be loaded.');}
    finally{setLoading(false);setRefreshing(false);}
  }
  useEffect(()=>{setExpanded(false);setFormTask(undefined);setViewTask(null);setCompleteTask(null);setHistoryTask(null);setDeleteTask(null);setAssetHistoryOpen(false);void load();},[asset.id]);
  const summaryContent=useMemo(()=>{
    if(loading)return 'Loading tracking...';
    const safeSummary=summary??emptySummary;
    if(error)return 'PM tracking unavailable';
    const next=safeSummary.nextDueDate?`Next ${formatDate(safeSummary.nextDueDate)}`:safeSummary.nextDueMeter!==null?`Next meter ${formatMeter(safeSummary.nextDueMeter)}`:'Next due not set';
    return <MccSummaryTokenGroup><MccSummaryToken tone="success">{safeSummary.total} schedule{safeSummary.total===1?'':'s'}</MccSummaryToken><MccSummaryToken tone="warning">{safeSummary.dueSoon} due soon</MccSummaryToken><MccSummaryToken tone="danger">{safeSummary.overdue} overdue</MccSummaryToken><MccSummaryToken>{next}</MccSummaryToken></MccSummaryTokenGroup>;
  },[error,loading,summary]);
  const safeTasks=Array.isArray(tasks)?tasks:[];
  async function deactivate(task:PmTask) {
    if(!window.confirm(`Deactivate “${task.title}”? Its completion history will be preserved.`))return;
    try{await scheduleAction.run(async()=>{await requestJson(`${apiBase}/preventive-maintenance/${task.id}/deactivate`,{method:'POST',body:'{}'});await load(true);});}
    catch(value){setError((value as Error).message||'PM tracking could not be deactivated.');}
  }
  return <>
    <MccCategoryAccordion accent="pm" expanded={expanded} className="pm-tracking-card glass-panel glass-panel--nested">
      <MccAccordionHeader title="Preventive Maintenance Tracking" summary={summaryContent} expanded={expanded} controls={`pm-tracking-panel-${asset.id}`} onToggle={()=>setExpanded(current=>!current)} />
      <div className="machine-detail-accordion-panel" id={`pm-tracking-panel-${asset.id}`} aria-hidden={!expanded}>
        <div className="pm-panel-toolbar glass-toolbar"><div><strong>PM schedules</strong><small>Track calendar, hour-meter, and cycle-based maintenance.</small></div><div className="glass-button-group"><button className="secondary-button glass-button glass-button--secondary" type="button" onClick={()=>setAssetHistoryOpen(true)}>All PM History</button>{canEdit&&<button className="primary-button glass-button glass-button--primary" type="button" onClick={()=>setFormTask(null)}>Add Preventive Maintenance Tracking</button>}</div></div>
        <PmActionProgress pending={scheduleAction.pending||refreshing} checkCount={scheduleAction.checkCount} label={scheduleAction.pending?scheduleAction.label:'Refreshing PM schedules'} />
        <PmMachineMeterPanel asset={asset} library={library} canEdit={canEdit} onUpdated={()=>load(true)}/>
        {library==='machine'&&<PmExcelSyncControls canEdit={canEdit} onImported={()=>load(true)} />}
        {error&&<p className="form-message error">{error}</p>}
        {loading&&<div className="glass-empty-state">Loading preventive maintenance tracking...</div>}
        {!loading&&!error&&!safeTasks.length&&<div className="glass-empty-state"><strong>No preventive maintenance tracking yet.</strong><span>Add the first schedule to calculate due dates or meter targets for this asset.</span></div>}
        {!loading&&error&&!safeTasks.length&&<div className="glass-empty-state"><strong>PM tracking unavailable</strong><span>The asset detail remains available. Try loading PM tracking again later.</span></div>}
        {!loading&&safeTasks.length>0&&<div className={`pm-task-grid${refreshing?' pm-task-grid--refreshing':''}`}>{safeTasks.map(task=><PmTaskCard key={task.id} asset={asset} task={task} canEdit={canEdit} busy={scheduleAction.pending} onView={()=>setViewTask(task)} onEdit={()=>setFormTask(task)} onComplete={()=>setCompleteTask(task)} onDeactivate={()=>void deactivate(task)} onDelete={()=>setDeleteTask(task)} onHistory={()=>setHistoryTask(task)} />)}</div>}
      </div>
    </MccCategoryAccordion>
    {formTask!==undefined&&<PmFormModal asset={asset} task={formTask} apiBase={apiBase} onClose={()=>setFormTask(undefined)} onSaved={async()=>{setFormTask(undefined);await load(true);}} />}
    {viewTask&&<PmViewModal asset={asset} task={viewTask} onClose={()=>setViewTask(null)} />}
    {completeTask&&<PmCompleteWorkflowModal asset={asset} task={completeTask} library={library} performedBy={performedBy} onClose={()=>setCompleteTask(null)} onSaved={async()=>{setCompleteTask(null);await load(true);}} />}
    {historyTask&&<PmHistoryModal task={historyTask} apiBase={apiBase} onClose={()=>setHistoryTask(null)} />}
    {deleteTask&&<PmDeleteScheduleModal task={deleteTask} library={library} onClose={()=>setDeleteTask(null)} onDeleted={async()=>{setDeleteTask(null);await load(true);}}/>}
    {assetHistoryOpen&&<PmAssetHistoryModal asset={asset} library={library} onClose={()=>setAssetHistoryOpen(false)}/>}
  </>;
}

function PmTaskCard({asset,task,canEdit,busy,onView,onEdit,onComplete,onDeactivate,onDelete,onHistory}:{asset:AssetIdentity;task:PmTask;canEdit:boolean;busy:boolean;onView:()=>void;onEdit:()=>void;onComplete:()=>void;onDeactivate:()=>void;onDelete:()=>void;onHistory:()=>void}) {
  const meter=meterIntervals.has(task.intervalType);
  const status=validStatuses.has(task.status)?task.status:'Setup incomplete';
  const statusClass=status.toLowerCase().replace(/\s+/g,'-');
  const countdown=safeString(task.countdown,status==='Setup incomplete'?'PM setup is incomplete':'');
  const countdownDisplay=countdownParts(countdown,status);
  const moreRef=useRef<HTMLDetailsElement>(null);const moreAction=(action:()=>void)=>{if(moreRef.current)moreRef.current.open=false;action();};
  return <article className="pm-task-card glass-card">
    <div className="pm-card-identity"><span className="glass-pill pm-card-asset">{asset.assetNumber.toUpperCase()}</span><span className="glass-pill pm-card-brand">{(asset.brand||'Brand not set').toUpperCase()}</span></div>
    <div className="pm-task-card-heading"><div><h4>{safeString(task.title,'Untitled PM task')}</h4><span className={`pm-interval-label${task.intervalType==='hourly'?' pm-interval-label--hourly':''}`}><span>Interval:</span> <strong className={`pm-interval-value pm-interval-value--${intervalTone(task.intervalType,task.intervalValue)}`}>{cadenceLabel(task.intervalType,task.intervalValue)}</strong></span></div><span className={`glass-pill pm-status pm-status--${statusClass}`}>{status==='Hold'?'HOLD':status}</span></div>
    <div className={`pm-task-metrics${meter?' pm-task-metrics--meter':''}`}><div className="pm-metric-pill pm-metric-pill--last"><span>Last completed</span><strong>{meter?formatMeterMetric(task.lastCompletedMeter,task.intervalType):formatDate(task.lastCompletedDate)}</strong></div>{meter&&<div className="pm-metric-pill pm-metric-pill--current"><span>Current meter</span><strong>{formatMeterMetric(task.currentMeter,task.intervalType)}</strong></div>}<div className={`pm-metric-pill pm-metric-pill--${statusClass}`}><span>Next due</span><strong>{meter?formatMeterMetric(task.nextDueMeter,task.intervalType):formatDate(task.nextDueDate)}</strong></div></div>
    <p className={`pm-countdown pm-countdown--${statusClass}${status==='Due Now'?' pm-due-now-text':''}`}>{countdownDisplay?<><span className="pm-countdown-label">{countdownDisplay.lead}</span><strong className={`pm-countdown-value pm-countdown-value--${statusClass}`}>{countdownDisplay.value}</strong>{countdownDisplay.unit&&<span className={`pm-countdown-unit pm-countdown-unit--${statusClass}`}>{countdownDisplay.unitSpacing}{countdownDisplay.unit}</span>}<span className="pm-countdown-tail">{countdownDisplay.tail}</span></>:countdown}</p>
    <div className="pm-card-actions">{canEdit&&task.scheduleStatus==='active'&&<button className="primary-button compact-button glass-button glass-button--success pm-card-action pm-card-action--complete" type="button" disabled={busy} onClick={onComplete}>Complete PM</button>}{canEdit&&<button className="secondary-button compact-button glass-button glass-button--warning pm-card-action pm-card-action--edit" type="button" disabled={busy} onClick={onEdit}>Edit</button>}<details ref={moreRef} className="pm-more-menu"><summary className="secondary-button compact-button glass-button glass-button--secondary" aria-label={`More actions for ${task.title}`} aria-haspopup="menu">More</summary><div className="pm-more-menu-popover" role="menu" aria-label={`More actions for ${task.title}`}><button role="menuitem" type="button" onClick={()=>moreAction(onView)}>View</button><button role="menuitem" type="button" onClick={()=>moreAction(onHistory)}>History ({safeCount(task.historyCount)})</button>{canEdit&&task.scheduleStatus!=='inactive'&&<button role="menuitem" type="button" disabled={busy} onClick={()=>moreAction(onDeactivate)}>Deactivate</button>}{canEdit&&<button className="pm-more-delete" role="menuitem" type="button" disabled={busy} onClick={()=>moreAction(onDelete)}>Delete Schedule</button>}</div></details></div>
  </article>;
}

function pmDraftErrors(draft:PmDraft){
  const errors:Partial<Record<PmDraftErrorKey,string>>={};
  if(!draft.title.trim())errors.title='PM title is required.';
  if(!draft.intervalType){errors.intervalType='Select an interval type.';return errors;}
  const fixed=fixedCadences[draft.intervalType];const amount=Number(draft.intervalValue);
  if(!fixed&&(!Number.isFinite(amount)||amount<=0))errors.interval='Enter an interval greater than zero.';
  if(!fixed&&['cycles','days','weekly','monthly'].includes(draft.intervalType)&&Number.isFinite(amount)&&!Number.isInteger(amount))errors.interval='Use a whole number for this interval type.';
  if(meterIntervals.has(draft.intervalType)){
    const completed=Number(draft.lastCompletedMeter);
    if(draft.lastCompletedMeter===''||!Number.isFinite(completed)||completed<0)errors.lastMeter=`Last completed ${draft.intervalType==='hourly'?'hours':'cycles'} must be zero or greater.`;
    if(draft.intervalType==='cycles'&&draft.lastCompletedMeter!==''&&Number.isFinite(completed)&&!Number.isInteger(completed))errors.lastMeter='Last completed cycles must use a whole number.';
    if(draft.currentMeter!==''){const current=Number(draft.currentMeter);if(!Number.isFinite(current)||current<0)errors.currentMeter=`Current ${draft.intervalType==='hourly'?'hours':'cycles'} must be zero or greater.`;else if(draft.intervalType==='cycles'&&!Number.isInteger(current))errors.currentMeter='Current cycles must use a whole number.';}
  }else if(!draft.lastCompletedDate||!isValidMccDateValue(draft.lastCompletedDate,true))errors.date='Enter a valid Last Completed Date / Starting Date.';
  return errors;
}

export function PmFormModal({asset,task,apiBase,onClose,onSaved}:{asset:AssetIdentity;task:PmTask|null;apiBase:string;onClose:()=>void;onSaved:()=>void|Promise<void>}) {
  const [draft,setDraft]=useState<PmDraft>(()=>task?taskToDraft(task):blankDraft);
  const [error,setError]=useState('');const [submitted,setSubmitted]=useState(false);const [overrideType,setOverrideType]=useState<'replacement'|'correction'|'override'>('correction');const [overrideReason,setOverrideReason]=useState('');const formRef=useRef<HTMLFormElement>(null);const createRequestIdRef=useRequestId();const library:AssetLibraryScope=apiBase.includes('/equipment-library')?'equipment':'machine';const saveAction=usePmActionProgress({label:task?'Updating PM schedule':'Creating PM schedule',pollStatus:()=>pollPmWorkflowStatus(library,asset.id)});const saving=saveAction.pending;
  const meter=meterIntervals.has(draft.intervalType);const fixed=fixedIntervals.has(draft.intervalType);
  const fixedCadence=draft.intervalType?fixedCadences[draft.intervalType]:undefined;const validation=pmDraftErrors(draft);const preview=pmDuePreview(draft);
  const intervalPlaceholder=draft.intervalType?intervalGuidance[draft.intervalType]??'': '';const meterUnit=draft.intervalType==='hourly'?'Hours':'Cycles';
  const editedCurrent=draft.currentMeter===''?null:Number(draft.currentMeter);const decreasing=Boolean(task&&meter&&editedCurrent!==null&&Number.isFinite(editedCurrent)&&task.currentMeter!==null&&editedCurrent<task.currentMeter);
  function field<K extends keyof PmDraft>(key:K,value:PmDraft[K]){setDraft(current=>({...current,[key]:value}));if(key==='title')setError('');}
  async function submit(event:FormEvent){event.preventDefault();setSubmitted(true);const firstInvalid=(['title','intervalType','interval','date','lastMeter','currentMeter'] as PmDraftErrorKey[]).find(key=>validation[key]);if(firstInvalid){setError('');requestAnimationFrame(()=>{const container=formRef.current?.querySelector<HTMLElement>(`[data-pm-field="${firstInvalid}"]`);const target=container?.matches('input,select,textarea,button,[tabindex]')?container:container?.querySelector<HTMLElement>('input,select,textarea,button,[tabindex]');container?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});target?.focus({preventScroll:true});});return;}if(decreasing&&(overrideReason.trim().length<5||!/[A-Za-z0-9]/.test(overrideReason))){setError('Enter a meaningful reason for the decreasing meter correction.');return;}setError('');try{await saveAction.run(async()=>{const payload={title:draft.title.replace(/\s+/g,' ').trim(),instructions:draft.instructions,intervalType:draft.intervalType,intervalValue:fixedCadence?.value??Number(draft.intervalValue),lastCompletedDate:meter?null:(draft.lastCompletedDate||null),lastCompletedMeter:meter?Number(draft.lastCompletedMeter):null,currentMeter:meter&&draft.currentMeter!==''?Number(draft.currentMeter):null,scheduleStatus:draft.scheduleStatus,notes:draft.notes,meterOverride:decreasing?{type:overrideType,reason:overrideReason}:null};await requestJson(task?`${apiBase}/preventive-maintenance/${task.id}`:`${apiBase}/assets/${asset.id}/preventive-maintenance`,{method:task?'PUT':'POST',body:JSON.stringify(payload),headers:task?undefined:{'Idempotency-Key':createRequestIdRef.current}});await onSaved();});}catch(value){setError((value as Error).message||'PM tracking could not be saved.');}}
  return createPortal(<div className="modal-backdrop glass-modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget&&!saving)onClose();}}><section className="mcc-card glass-modal-shell pm-modal mcc-wide-modal" role="dialog" aria-modal="true" aria-labelledby="pm-form-title"><form ref={formRef} onSubmit={submit} noValidate>
    <div className="modal-heading"><div><p className="eyebrow">{safeString(asset.assetNumber,'Machine asset')} · {safeString(asset.assetName,'Machine asset')}</p><h3 id="pm-form-title">{task?'Edit':'Add'} Preventive Maintenance Tracking</h3></div><button className="link-button compact-button glass-button glass-button--secondary" type="button" onClick={onClose} disabled={saving}>Close</button></div>
    <div className="pm-form-grid"><label className="form-field pm-form-wide"><span>PM Title *</span><input className="glass-input" data-pm-field="title" value={draft.title} maxLength={180} onChange={e=>field('title',e.target.value)} aria-invalid={submitted&&Boolean(validation.title)} required />{submitted&&validation.title&&<small className="pm-inline-error">{validation.title}</small>}</label><label className="form-field pm-form-wide"><span>Instructions</span><textarea className="glass-input" rows={4} maxLength={12000} value={draft.instructions} onChange={e=>field('instructions',e.target.value)} /></label>
      <label className="form-field"><span>Interval Type *</span><select className="glass-input" data-pm-field="intervalType" value={draft.intervalType} onChange={e=>{const value=e.target.value as PmDraft['intervalType'];setDraft(current=>({...current,intervalType:value,intervalValue:'',lastCompletedDate:meterIntervals.has(value)?'':current.lastCompletedDate,lastCompletedMeter:meterIntervals.has(value)?current.lastCompletedMeter:'',currentMeter:meterIntervals.has(value)?current.currentMeter:''}));}} aria-invalid={submitted&&Boolean(validation.intervalType)} required><option value="">Select interval type</option>{intervalOptions.map(option=><option key={option.key} value={option.key}>{option.label}</option>)}</select>{submitted&&validation.intervalType&&<small className="pm-inline-error">{validation.intervalType}</small>}</label>
      {fixed&&fixedCadence?<div className="pm-fixed-cadence glass-input" aria-readonly="true"><span>Fixed cadence</span><strong>{fixedCadence.label}</strong></div>:draft.intervalType?<label className="form-field"><span>How long is the interval? *</span><input className="glass-input" data-pm-field="interval" type="number" min={draft.intervalType==='hourly'?'0.1':'1'} step={draft.intervalType==='hourly'?'0.1':'1'} value={draft.intervalValue} onChange={e=>field('intervalValue',e.target.value)} aria-invalid={submitted&&Boolean(validation.interval)} required />{draft.intervalValue===''&&intervalPlaceholder&&<small className="pm-input-guidance">{intervalPlaceholder}</small>}{submitted&&validation.interval&&<small className="pm-inline-error">{validation.interval}</small>}</label>:null}
      {draft.intervalType&&!meter&&<div className="pm-date-field" data-pm-field="date"><MccDateInput label="Last Completed Date / Starting Date" value={draft.lastCompletedDate} onChange={value=>field('lastCompletedDate',value)} required />{submitted&&validation.date&&<small className="pm-inline-error">{validation.date}</small>}</div>}
      {meter&&<label className="form-field"><span>Last Completed {meterUnit} *</span><input className="glass-input" data-pm-field="lastMeter" type="number" min="0" step={draft.intervalType==='hourly'?'0.1':'1'} placeholder={draft.intervalType==='hourly'?'0.0 hrs':'0 cycles'} value={draft.lastCompletedMeter} onChange={e=>field('lastCompletedMeter',e.target.value)} aria-invalid={submitted&&Boolean(validation.lastMeter)} required />{submitted&&validation.lastMeter&&<small className="pm-inline-error">{validation.lastMeter}</small>}</label>}
      {meter&&<label className="form-field"><span>Current {meterUnit} <small>(optional)</small></span><input className="glass-input" data-pm-field="currentMeter" type="number" min="0" step={draft.intervalType==='hourly'?'0.1':'1'} placeholder={draft.intervalType==='hourly'?'0.0 hrs':'0 cycles'} value={draft.currentMeter} onChange={e=>field('currentMeter',e.target.value)} aria-invalid={submitted&&Boolean(validation.currentMeter)} />{submitted&&validation.currentMeter&&<small className="pm-inline-error">{validation.currentMeter}</small>}</label>}
      {decreasing&&<div className="pm-meter-override pm-form-wide glass-card glass-card--nested"><strong>Decreasing meter reading requires authorization</strong><p>The stored reading is {formatMeter(task?.currentMeter)}. Update the last-completed baseline when appropriate and record why the meter decreased.</p><label className="form-field"><span>Override type *</span><select className="glass-input" value={overrideType} onChange={event=>setOverrideType(event.target.value as typeof overrideType)}><option value="replacement">Meter replacement</option><option value="correction">Meter correction</option><option value="override">Authorized override</option></select></label><label className="form-field"><span>Override reason *</span><textarea className="glass-input" rows={3} maxLength={1000} value={overrideReason} onChange={event=>setOverrideReason(event.target.value)} required /></label></div>}
      <label className="form-field"><span>Status</span><select className="glass-input" value={draft.scheduleStatus} onChange={e=>field('scheduleStatus',e.target.value as PmScheduleStatus)}><option value="active">Active</option><option value="hold">Hold</option><option value="inactive">Inactive</option></select></label>
      <div className="pm-due-legend pm-form-legend" aria-label="Preventive maintenance due status legend"><span className="pm-due-legend--current">Current</span><span className="pm-due-legend--due-soon">Due Soon</span><span className="pm-due-legend--due-now">Due Now</span><span className="pm-due-legend--overdue">Overdue</span></div>
      <div className={`pm-due-preview pm-due-preview--${preview.tone} glass-card glass-card--nested`}><span>{preview.label}</span><strong>{preview.value}</strong>{preview.legend&&<small className={`pm-due-status-line${preview.tone==='due-now'?' pm-due-now-text':''}`}>{preview.legend}</small>}</div>
      <label className="form-field pm-form-wide"><span>Notes</span><textarea className="glass-input" rows={3} maxLength={12000} value={draft.notes} onChange={e=>field('notes',e.target.value)} /></label>
    </div><PmActionProgress pending={saveAction.pending} checkCount={saveAction.checkCount} label={saveAction.label}/>{error&&<p className="form-message error">{error}</p>}<div className="modal-actions glass-modal__actions"><button className="secondary-button glass-button glass-button--secondary" type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary-button glass-button glass-button--primary pm-action-button" type="submit" disabled={saving} aria-busy={saving}><PmActionButtonLabel pending={saving} idle="Save PM Tracking" pendingLabel={task?'Updating...':'Creating...'}/></button></div>
  </form></section></div>,document.body);
}

function printPmSchedule(asset:AssetIdentity,task:PmTask) {
  const printWindow=window.open('','_blank','width=960,height=760');
  if(!printWindow){window.alert('Allow pop-ups to print or save this PM schedule as a PDF.');return;}
  printWindow.opener=null;
  const meter=meterIntervals.has(task.intervalType);
  const generated=new Date();
  const dateStamp=localIsoDate(generated);
  const fileName=`${printFileToken(asset.assetNumber)}_${printFileToken(task.title)}_PM_Schedule_${dateStamp}`;
  const fields=[
    ['Asset',`${safeString(asset.assetNumber,'Machine asset')}${asset.assetName?` - ${asset.assetName}`:''}`],
    ['PM Title',safeString(task.title,'Untitled PM task')],
    ['Status',validStatuses.has(task.status)?task.status:'Setup incomplete'],
    ['Due Condition',safeString(task.countdown,task.status)],
    ['Interval',cadenceLabel(task.intervalType,task.intervalValue)],
    [meter?`Last completed ${task.intervalType==='hourly'?'hours':'cycles'}`:'Last completed date',meter?formatMeter(task.lastCompletedMeter):formatDate(task.lastCompletedDate)],
    ...(meter?[[`Current ${task.intervalType==='hourly'?'hours':'cycles'}`,formatMeter(task.currentMeter)]]:[]),
    [meter?'Next meter due':'Next PM Due Date',meter?formatMeter(task.nextDueMeter):formatDate(task.nextDueDate)],
  ];
  const detailHtml=fields.map(([label,value])=>`<div class="detail"><span>${escapePrintHtml(label)}</span><strong>${escapePrintHtml(value)}</strong></div>`).join('');
  const proseHtml=[task.instructions?`<section><h2>Instructions</h2><p>${escapePrintHtml(task.instructions)}</p></section>`:'',task.notes?`<section><h2>Notes</h2><p>${escapePrintHtml(task.notes)}</p></section>`:''].join('');
  printWindow.document.write(`<!doctype html><html><head><title>${escapePrintHtml(fileName)}</title><meta charset="utf-8"><style>@page{size:Letter;margin:14mm}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;color:#10283a;background:#fff}.title{padding:22px 24px;color:#fff;background:linear-gradient(135deg,#075c8f,#087e91)}.title p{margin:0 0 5px;font-size:12px;letter-spacing:.08em;text-transform:uppercase}.title h1{margin:0;font-size:25px}.summary{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:16px 20px;border:1px solid #9fcddd;border-top:0;background:#eff9fc}.summary strong{font-size:18px}.status{display:inline-flex;padding:6px 11px;border:2px solid #087e91;border-radius:999px;color:#075c78;background:#dff7f4;font-size:12px;font-weight:800}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:18px 0}.detail{display:grid;gap:4px;padding:11px 13px;border:1px solid #bdd9e4;border-radius:10px;background:#f7fbfd;break-inside:avoid}.detail span{color:#35728c;font-size:10px;font-weight:800;text-transform:uppercase}.detail strong{font-size:14px}section{margin-top:14px;padding:14px 16px;border:1px solid #bdd9e4;border-radius:10px;break-inside:avoid}section h2{margin:0 0 8px;color:#075c8f;font-size:14px}section p{margin:0;white-space:pre-wrap;line-height:1.45}.generated{margin-top:18px;color:#557584;font-size:10px}.actions{margin-bottom:12px}.actions button{padding:8px 12px;border:0;border-radius:8px;color:#fff;background:#075c8f;font-weight:700;cursor:pointer}@media print{.actions{display:none}.title,.summary,.detail,section{-webkit-print-color-adjust:exact;print-color-adjust:exact}}@media(max-width:620px){.grid{grid-template-columns:1fr}}</style></head><body><div class="actions"><button onclick="window.print()">Print / Save PDF</button></div><header class="title"><p>Maintenance Schedule</p><h1>Preventive Maintenance Schedule</h1></header><div class="summary"><strong>${escapePrintHtml(asset.assetNumber)}${asset.assetName?` - ${escapePrintHtml(asset.assetName)}`:''}</strong><span class="status">${escapePrintHtml(task.status)}</span></div><main><div class="grid">${detailHtml}</div>${proseHtml}<p class="generated">Generated ${escapePrintHtml(generated.toLocaleString())}</p></main><script>setTimeout(()=>window.print(),350)<\/script></body></html>`);
  printWindow.document.close();
}

function PmViewModal({asset,task,onClose}:{asset:AssetIdentity;task:PmTask;onClose:()=>void}) {
  const meter=meterIntervals.has(task.intervalType);
  return createPortal(<div className="modal-backdrop glass-modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}><section className="mcc-card glass-modal-shell pm-modal pm-view-modal mcc-wide-modal" role="dialog" aria-modal="true" aria-labelledby="pm-view-title"><div className="modal-heading"><div><p className="eyebrow">Preventive Maintenance Tracking</p><h3 id="pm-view-title">{safeString(task.title,'Untitled PM task')}</h3></div><button className="link-button compact-button glass-button glass-button--secondary" type="button" onClick={onClose}>Close</button></div><div className="pm-view-grid"><PmValue label="Status" value={validStatuses.has(task.status)?task.status:'Setup incomplete'}/><PmValue label="Interval" value={cadenceLabel(task.intervalType,task.intervalValue)}/><PmValue label={meter?`Last completed ${task.intervalType==='hourly'?'hours':'cycles'}`:'Last completed date'} value={meter?formatMeter(task.lastCompletedMeter):formatDate(task.lastCompletedDate)}/><PmValue label={meter?`Current ${task.intervalType==='hourly'?'hours':'cycles'}`:'Current meter'} value={meter?formatMeter(task.currentMeter):'Not applicable'}/><PmValue label={meter?'Next meter due':'Next PM Due Date'} value={meter?formatMeter(task.nextDueMeter):formatDate(task.nextDueDate)}/></div>{task.instructions&&<div className="pm-prose glass-card glass-card--nested"><span>Instructions</span><p>{task.instructions}</p></div>}{task.notes&&<div className="pm-prose glass-card glass-card--nested"><span>Notes</span><p>{task.notes}</p></div>}<div className="modal-actions glass-modal__actions"><button className="primary-button glass-button glass-button--primary" type="button" onClick={()=>printPmSchedule(asset,task)}>Print / Save PDF</button><button className="secondary-button glass-button glass-button--secondary" type="button" onClick={onClose}>Close</button></div></section></div>,document.body);
}
function PmValue({label,value}:{label:string;value:string}){return <div className="pm-value glass-card glass-card--nested"><span>{label}</span><strong>{value}</strong></div>;}

type PmExcelSyncStatus={status:string;attemptedAt:string|null;synchronizedAt:string|null;originalFilename:string;errorMessage:string;downloadAvailable:boolean};
type PmExcelOperationStage='preparing'|'uploading'|'validating'|'analyzing'|'preview_ready'|'importing'|'database_update'|'workbook_sync'|'backing_up'|'replacing_active_workbook'|'verifying'|'succeeded'|'failed';
type PmExcelOperation={id:string;type:string;stage:PmExcelOperationStage;status:'active'|'succeeded'|'failed';message:string;originalFilename:string;createdAt:string;updatedAt:string;completedAt:string|null;errorMessage:string;active:boolean};
const pmExcelProcessingStages=new Set<PmExcelOperationStage>(['uploading','validating','analyzing','importing','database_update','workbook_sync','backing_up','replacing_active_workbook','verifying']);
type PmImportItem={sheet?:string;rowNumber?:number;rowNumbers?:number[];assetNumber?:string;assetName?:string;taskTitle?:string;taskType?:string;workOrderNumber?:string;message?:string;reason?:string;code?:string;overrideRequired?:boolean;originalValue?:number;newValue?:number};
type PmImportPreview={token:string;filename:string;expiresAt:string;additions:PmImportItem[];updates:PmImportItem[];historyAdditions:PmImportItem[];conflicts:PmImportItem[];warnings:PmImportItem[];rejectedRows:PmImportItem[];confirmEligibility:{importableRows:number;resolutionRequiredRows:number[];replacementEligible?:boolean;canConfirm:boolean};summary:{additions:number;updates:number;historyAdditions:number;conflicts:number;warnings:number;rejectedRows:number}};
type PmImportOverride={type:'replacement'|'correction'|'override';reason:string};

function hasMeaningfulPmImportReason(value:PmImportOverride|undefined){const reason=value?.reason.trim()??'';return reason.length>=5&&/[A-Za-z0-9]/.test(reason);}
function pmImportableRowCount(preview:PmImportPreview,overrides:Record<number,PmImportOverride>){const resolvedRows=preview.confirmEligibility.resolutionRequiredRows.filter(rowNumber=>hasMeaningfulPmImportReason(overrides[rowNumber])).length;return preview.confirmEligibility.importableRows+resolvedRows;}
function canConfirmPmReplacement(preview:PmImportPreview,overrides:Record<number,PmImportOverride>){return pmImportableRowCount(preview,overrides)>0||Boolean(preview.confirmEligibility.replacementEligible);}

function syncStatusText(sync:PmExcelSyncStatus|null){if(!sync||sync.status==='never')return 'Last Excel Sync: Not synchronized';const when=sync.synchronizedAt??sync.attemptedAt;const formatted=when?new Date(when).toLocaleString():'time unavailable';return `Last Excel Sync: ${sync.status==='success'?'Successful':sync.status==='failed'?'Failed':'In progress'} · ${formatted}`;}
function previewRowLabel(item:PmImportItem){if(item.rowNumber)return `Row ${item.rowNumber}`;if(item.rowNumbers?.length)return `Rows ${item.rowNumbers.join(', ')}`;return 'Workbook row';}
function previewRowSubject(item:PmImportItem){return [item.assetNumber,item.assetName].filter(Boolean).join(' · ')||item.sheet||'PM workbook';}
function previewRowDescription(item:PmImportItem){return [item.taskTitle??item.taskType,item.workOrderNumber].filter(Boolean).join(' · ')||'No additional row description';}

function PmImportPreviewSection({id,title,items,tone,description,emptyText,expanded,showAll,onToggle,onShowAll,renderItem}:{id:string;title:string;items:PmImportItem[];tone:'ready'|'history'|'warning'|'danger'|'neutral';description:string;emptyText:string;expanded:boolean;showAll:boolean;onToggle:()=>void;onShowAll:()=>void;renderItem:(item:PmImportItem,index:number)=>ReactNode}) {
  const visibleItems=showAll?items:items.slice(0,5);const contentId=`pm-import-${id}-content`;
  return <section className={`pm-import-preview-section pm-import-preview-section--${tone}`} aria-labelledby={`pm-import-${id}-heading`}>
    <button className="pm-import-section-toggle" type="button" aria-expanded={expanded} aria-controls={contentId} onClick={onToggle}><span><strong id={`pm-import-${id}-heading`}>{title}</strong><small>{description}</small></span><span className="pm-import-section-count">{items.length}</span><span className="pm-import-section-chevron" aria-hidden="true">{expanded?'−':'+'}</span></button>
    {expanded&&<div className="pm-import-section-content" id={contentId}>{items.length?<>{visibleItems.map(renderItem)}{items.length>5&&<button className="pm-import-show-all link-button compact-button glass-button glass-button--secondary" type="button" aria-expanded={showAll} onClick={onShowAll}>{showAll?'Show first 5':`Show all ${items.length}`}</button>}</>:<p className="pm-import-section-empty">{emptyText}</p>}</div>}
  </section>;
}

function PmImportPreviewRow({item,status,tone='neutral',overrides,setOverrides}:{item:PmImportItem;status:string;tone?:'ready'|'history'|'warning'|'danger'|'neutral';overrides:Record<number,PmImportOverride>;setOverrides:(update:(current:Record<number,PmImportOverride>)=>Record<number,PmImportOverride>)=>void}) {
  const reason=item.reason??item.message;const decreasing=item.code==='DECREASING_METER'&&Boolean(item.rowNumber);
  return <article className={`pm-import-preview-row pm-import-preview-row--${tone}`}><div className="pm-import-row-heading"><strong>{previewRowLabel(item)}</strong><span>{status}</span></div><div className="pm-import-row-copy"><strong>{previewRowSubject(item)}</strong><span>{previewRowDescription(item)}</span>{reason&&<p>{reason}</p>}</div>{decreasing&&item.rowNumber&&<div className="pm-import-override-grid"><label className="form-field"><span>Override type</span><select className="glass-input" value={overrides[item.rowNumber]?.type??'replacement'} onChange={event=>setOverrides(current=>({...current,[item.rowNumber!]:{type:event.target.value as PmImportOverride['type'],reason:current[item.rowNumber!]?.reason??''}}))}><option value="replacement">Meter replacement</option><option value="correction">Meter correction</option><option value="override">Authorized override</option></select></label><label className="form-field"><span>Audit reason *</span><input className="glass-input" value={overrides[item.rowNumber]?.reason??''} onChange={event=>setOverrides(current=>({...current,[item.rowNumber!]:{type:current[item.rowNumber!]?.type??'replacement',reason:event.target.value}}))}/></label></div>}</article>;
}

function PmImportPreviewModal({preview,busy,error,overrides,setOverrides,onClose,onConfirm}:{preview:PmImportPreview;busy:boolean;error:string;overrides:Record<number,PmImportOverride>;setOverrides:(update:(current:Record<number,PmImportOverride>)=>Record<number,PmImportOverride>)=>void;onClose:()=>void;onConfirm:()=>void}) {
  const [expanded,setExpanded]=useState<Record<string,boolean>>({ready:true,history:true,conflicts:true,rejected:true,noChanges:true});const [showAll,setShowAll]=useState<Record<string,boolean>>({});const dialogRef=useRef<HTMLElement>(null);const closeRef=useRef<HTMLButtonElement>(null);const onCloseRef=useRef(onClose);const busyRef=useRef(busy);onCloseRef.current=onClose;busyRef.current=busy;
  const importableCount=pmImportableRowCount(preview,overrides);const canConfirm=canConfirmPmReplacement(preview,overrides);const readyItems=[...preview.additions,...preview.updates];
  useEffect(()=>{const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;closeRef.current?.focus();function onKeyDown(event:KeyboardEvent){if(event.key==='Escape'&&!busyRef.current){event.preventDefault();onCloseRef.current();return;}if(event.key!=='Tab'||!dialogRef.current)return;const focusable=[...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')].filter(element=>!element.hidden);if(!focusable.length){event.preventDefault();dialogRef.current.focus();return;}const first=focusable[0];const last=focusable[focusable.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}document.addEventListener('keydown',onKeyDown);return()=>{document.removeEventListener('keydown',onKeyDown);previous?.focus();};},[]);
  const sectionProps=(id:string)=>({expanded:expanded[id]!==false,showAll:Boolean(showAll[id]),onToggle:()=>setExpanded(current=>({...current,[id]:current[id]===false})),onShowAll:()=>setShowAll(current=>({...current,[id]:!current[id]}))});
  const row=(item:PmImportItem,status:string,tone:'ready'|'history'|'warning'|'danger'|'neutral',index:number)=><PmImportPreviewRow item={item} status={status} tone={tone} overrides={overrides} setOverrides={setOverrides} key={`${item.sheet}-${item.rowNumber??item.rowNumbers?.join('-')??'group'}-${index}`} />;
  return createPortal(<div className="modal-backdrop glass-modal-backdrop pm-import-preview-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)onClose();}}><section ref={dialogRef} className="mcc-card glass-modal-shell pm-import-preview-modal" role="dialog" aria-modal="true" aria-labelledby="pm-import-preview-title" aria-describedby="pm-import-preview-help" tabIndex={-1}>
    <header className="pm-import-preview-header"><div><p className="eyebrow">WORKBOOK VALUES APPLY AFTER CONFIRMATION · PREVIEW ONLY</p><h3 id="pm-import-preview-title">PM Excel Import Preview</h3><p className="pm-import-filename">{preview.filename}</p></div><button ref={closeRef} className="link-button compact-button glass-button glass-button--secondary" type="button" disabled={busy} onClick={onClose}>Close</button></header>
    <div className="pm-import-preview-body"><div className="pm-import-summary-grid" aria-label="Import preview summary">{([['Additions',preview.summary.additions,'success'],['Updates',preview.summary.updates,'neutral'],['History rows',preview.summary.historyAdditions,'history'],['Conflicts',preview.summary.conflicts,'warning'],['Rejected',preview.summary.rejectedRows,'danger']] as Array<[string,number,string]>).map(([label,count,tone])=><div className={`pm-import-summary-card pm-import-summary-card--${tone}`} key={label}><span>{label}</span><strong>{count}</strong></div>)}</div>
      <div className="pm-import-sections"><PmImportPreviewSection id="ready" title="Ready to Import" items={readyItems} tone="ready" description="Valid additions and updates" emptyText="No task additions or updates are ready." {...sectionProps('ready')} renderItem={(item,index)=>row(item,preview.additions.includes(item)?'Addition · Ready':'Update · Ready','ready',index)} /><PmImportPreviewSection id="history" title="History" items={preview.historyAdditions} tone="history" description="Valid PM history rows" emptyText="No history rows are ready." {...sectionProps('history')} renderItem={(item,index)=>row(item,'History · Ready','history',index)} /><PmImportPreviewSection id="conflicts" title="Conflicts" items={preview.conflicts} tone="warning" description="Unresolved rows will be skipped" emptyText="No conflicts detected." {...sectionProps('conflicts')} renderItem={(item,index)=>row(item,item.code==='DECREASING_METER'&&item.rowNumber&&hasMeaningfulPmImportReason(overrides[item.rowNumber])?'Resolved · Will import':'Conflict · Will be skipped','warning',index)} /><PmImportPreviewSection id="rejected" title="Rejected" items={preview.rejectedRows} tone="danger" description="Invalid rows will be skipped" emptyText="No rejected rows." {...sectionProps('rejected')} renderItem={(item,index)=>row(item,'Rejected · Will be skipped','danger',index)} /><PmImportPreviewSection id="noChanges" title="No Changes" items={preview.warnings} tone="neutral" description="Rows that require no database write" emptyText="No unchanged rows or workbook notices." {...sectionProps('noChanges')} renderItem={(item,index)=>row(item,'No database change','neutral',index)} /></div>{error&&<p className="form-message error" role="alert">{error}</p>}</div>
    <footer className="pm-import-preview-footer"><p id="pm-import-preview-help">Valid workbook values will update MCC after confirmation. Conflicting and rejected rows will be skipped.</p>{!canConfirm&&<p className="pm-import-disabled-reason" role="status">No valid rows are currently available to import. Correct the workbook conflicts or invalid rows and preview it again.</p>}<div className="modal-actions glass-modal__actions"><button className="secondary-button glass-button glass-button--secondary" type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="primary-button glass-button glass-button--success" type="button" disabled={busy||!canConfirm} onClick={onConfirm}>{busy?'Importing...':importableCount?`Import Valid Rows (${importableCount})`:canConfirm?'Replace Workbook':'Import Valid Rows'}</button></div></footer>
  </section></div>,document.body);
}

function PmExcelSyncControls({canEdit,onImported}:{canEdit:boolean;onImported:()=>void|Promise<void>}){
  const [sync,setSync]=useState<PmExcelSyncStatus|null>(null);const [operation,setOperation]=useState<PmExcelOperation|null>(null);const [file,setFile]=useState<File|null>(null);const [preview,setPreview]=useState<PmImportPreview|null>(null);const [busyLabel,setBusyLabel]=useState('Processing PM workbook');const [resetting,setResetting]=useState(false);const [error,setError]=useState('');const [notice,setNotice]=useState('');const [overrides,setOverrides]=useState<Record<number,PmImportOverride>>({});const fileRef=useRef<HTMLInputElement>(null);const importButtonRef=useRef<HTMLButtonElement>(null);const previewButtonRef=useRef<HTMLButtonElement>(null);const previewWasOpenRef=useRef(false);const dismissedOperationIdsRef=useRef(new Set<string>());const confirmRequestId=useRequestId();const completedOperationRef=useRef('');const workbookAction=usePmActionProgress({label:busyLabel});const requestBusy=workbookAction.pending;const operationActive=Boolean(operation?.active);const operationProcessing=Boolean(operation?.active&&pmExcelProcessingStages.has(operation.stage));const operationAwaitingUser=Boolean(operation?.active&&(operation.stage==='preparing'||operation.stage==='preview_ready'));const controlsLocked=requestBusy||resetting||operationProcessing;
  async function loadStatus(operationId=operation?.id){try{const query=operationId?`?operationId=${encodeURIComponent(operationId)}`:'';const data=await requestJson<{sync:PmExcelSyncStatus;operation:PmExcelOperation|null}>(`/api/pm-excel/status${query}`);setSync(data.sync);if(data.operation&&!dismissedOperationIdsRef.current.has(data.operation.id))setOperation(data.operation);return data;}catch{return null;/* PM task data remains usable when workbook status is unavailable. */}}
  useEffect(()=>{void loadStatus(undefined);},[]);
  useEffect(()=>{if(!operation?.active)return;let stopped=false;let polling=false;const check=async()=>{if(stopped||polling)return;polling=true;try{await loadStatus(operation.id);}finally{polling=false;}};const interval=window.setInterval(()=>void check(),2500);return()=>{stopped=true;window.clearInterval(interval);};},[operation?.id,operation?.active]);
  useEffect(()=>{if(preview){previewWasOpenRef.current=true;return;}if(!previewWasOpenRef.current)return;previewWasOpenRef.current=false;const timer=window.setTimeout(()=>previewButtonRef.current?.focus(),0);return()=>window.clearTimeout(timer);},[Boolean(preview)]);
  useEffect(()=>{if(!operation||operation.active||completedOperationRef.current===operation.id)return;completedOperationRef.current=operation.id;if(operation.status==='succeeded'){setPreview(null);setFile(null);setError('');setNotice(current=>current||'PM workbook replacement succeeded. The latest PM data has been refreshed.');void onImported();}},[operation?.id,operation?.status,operation?.active]);
  async function selectFile(selected:File|null){setFile(selected);setPreview(null);setOverrides({});setError('');setNotice('');if(!selected){setOperation(null);return;}const operationId=createRequestId();const preparing:PmExcelOperation={id:operationId,type:'replacement',stage:'preparing',status:'active',message:'Preparing workbook replacement...',originalFilename:selected.name,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),completedAt:null,errorMessage:'',active:true};setOperation(preparing);try{const data=await requestJson<{operation:PmExcelOperation}>('/api/pm-excel/selection',{method:'POST',body:JSON.stringify({operationId,filename:selected.name})});setOperation(data.operation);}catch(value){setOperation({...preparing,stage:'failed',status:'failed',message:'PM workbook replacement could not be prepared.',errorMessage:(value as Error).message,active:false});setError((value as Error).message||'The PM workbook replacement could not be prepared.');}}
  async function previewFile(){if(!file||!operation)return;const operationId=operation.id;setBusyLabel('Uploading PM workbook');setError('');setNotice('');setOperation(current=>current&&current.id===operationId?{...current,stage:'uploading',message:'Uploading workbook...',active:true,status:'active'}:current);try{await workbookAction.run(async()=>{const body=new FormData();body.append('file',file,file.name);const data=await requestJson<{preview:PmImportPreview;operation?:PmExcelOperation}>('/api/pm-excel/preview',{method:'POST',headers:{'X-PM-Operation-Id':operationId},body});setOperation(data.operation??{id:operationId,type:'replacement',stage:'preview_ready',status:'active',message:'Workbook preview is ready.',originalFilename:file.name,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),completedAt:null,errorMessage:'',active:true});setPreview(data.preview);setOverrides(Object.fromEntries(data.preview.conflicts.filter(item=>item.code==='DECREASING_METER'&&item.rowNumber).map(item=>[item.rowNumber!,{type:'replacement' as const,reason:''}])));confirmRequestId.current=createRequestId();});}catch(value){setError((value as Error).message||'The PM workbook could not be previewed.');await loadStatus(operationId);}}
  async function confirmImport(){if(!preview||!canConfirmPmReplacement(preview,overrides)||!operation)return;const operationId=operation.id;setBusyLabel('Importing and synchronizing PM workbook');setError('');try{await workbookAction.run(async()=>{const resolutionRequiredRows=new Set(preview.confirmEligibility.resolutionRequiredRows);const meterOverrides=Object.entries(overrides).filter(([rowNumber,value])=>resolutionRequiredRows.has(Number(rowNumber))&&hasMeaningfulPmImportReason(value)).map(([rowNumber,value])=>({rowNumber:Number(rowNumber),...value,reason:value.reason.trim()}));const data=await requestJson<{import:{added:number;updated:number;historyAdded:number};sync:PmExcelSyncStatus;syncError?:string|null}>('/api/pm-excel/confirm',{method:'POST',headers:{'Idempotency-Key':confirmRequestId.current},body:JSON.stringify({previewToken:preview.token,meterOverrides})});setSync(data.sync);setPreview(null);setFile(null);setNotice(`PM import confirmed: ${data.import.added} added, ${data.import.updated} updated, ${data.import.historyAdded} history rows added.${data.syncError?` Workbook sync needs retry: ${data.syncError}`:' Workbook synchronized.'}`);const status=await loadStatus(operationId);if(!status?.operation)setOperation(current=>current&&current.id===operationId?{...current,stage:data.syncError?'failed':'succeeded',status:data.syncError?'failed':'succeeded',message:data.syncError??'PM workbook replacement succeeded.',errorMessage:data.syncError??'',active:false,completedAt:new Date().toISOString()}:current);});}catch(value){setError((value as Error).message||'The PM import could not be confirmed.');await loadStatus(operationId);}}
  async function cancelPreview(){if(operationAwaitingUser){await resetPreparedOperation();return;}setPreview(null);setFile(null);setOperation(null);window.setTimeout(()=>importButtonRef.current?.focus(),0);}
  async function resetPreparedOperation(){const current=operation;if(!current||!operationAwaitingUser)return;dismissedOperationIdsRef.current.add(current.id);setResetting(true);setOperation(null);setFile(null);setPreview(null);setOverrides({});setError('');setNotice('');try{await requestJson(`/api/pm-excel/operations/${encodeURIComponent(current.id)}/cancel`,{method:'POST',body:'{}'});setNotice('Prepared workbook cleared. Choose a workbook to begin again.');}catch(value){setError(`${(value as Error).message||'The prepared operation could not be canceled.'} You can still choose a new workbook to replace it.`);}finally{setResetting(false);window.setTimeout(()=>importButtonRef.current?.focus(),0);}}
  async function retry(){setBusyLabel('Retrying PM workbook synchronization');setError('');try{await workbookAction.run(async()=>{const data=await requestJson<{sync:PmExcelSyncStatus}>('/api/pm-excel/sync/retry',{method:'POST',body:'{}'});setSync(data.sync);setNotice('PM workbook synchronization completed.');});}catch(value){setError((value as Error).message||'Workbook synchronization could not be retried.');await loadStatus();}}
  const operationMessage=operation?.message||(requestBusy?busyLabel:'');const visibleError=operation?.errorMessage||(!file&&!operation?sync?.errorMessage:'');const preparedLocally=Boolean(file&&operation?.active&&operation.stage==='preparing');
  return <><section className="pm-excel-sync glass-card glass-card--nested" aria-label="PM Excel synchronization">
    <div className="pm-excel-sync-heading"><div><strong>PM Excel synchronization</strong><small>{operation?operationMessage:syncStatusText(sync)}</small>{visibleError&&<small className="pm-sync-error">{visibleError}</small>}</div><div className="glass-button-group">{sync?.downloadAvailable&&<><a className="primary-button compact-button glass-button glass-button--primary" href="/api/pm-excel/package/download" download>Download PM Package (.zip)</a><a className="secondary-button compact-button glass-button glass-button--secondary" href="/api/pm-excel/download" download>Download Excel Only (.xlsx)</a></>}{canEdit&&sync?.status==='failed'&&!operation&&<button className="secondary-button compact-button glass-button glass-button--warning" type="button" disabled={requestBusy} onClick={()=>void retry()}>Retry Sync</button>}</div></div>
    {sync?.downloadAvailable&&<p className="pm-package-warning">PDF hyperlinks require the matching PDF - Work orders directory from the full PM package.</p>}
    {(operationActive||requestBusy)&&<div className="pm-excel-operation-progress" role="status" aria-live="polite" data-stage={operation?.stage??'preparing'}><span className="pm-action-spinner" aria-hidden="true"/><span><strong>{operationMessage}</strong><small>{controlsLocked?'PM Excel controls remain locked until this processing step finishes.':file?'Choose Preview Changes to upload and validate this workbook.':'Choose another workbook or reset this prepared operation.'}</small></span></div>}
    {canEdit&&<div className="pm-excel-import-controls"><button ref={importButtonRef} className="secondary-button compact-button glass-button glass-button--secondary" type="button" disabled={controlsLocked||preparedLocally||Boolean(preview)} onClick={()=>fileRef.current?.click()}>Import PM Excel</button><input ref={fileRef} hidden type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={event=>{const selected=event.target.files?.[0]??null;event.currentTarget.value='';void selectFile(selected);}}/><span>{file?.name??operation?.originalFilename??'No workbook selected'}</span><button ref={previewButtonRef} className="primary-button compact-button glass-button glass-button--primary" type="button" disabled={!file||controlsLocked||!operation?.active||operation.stage!=='preparing'} onClick={()=>void previewFile()}>{requestBusy?'Validating...':'Preview Changes'}</button>{operationAwaitingUser&&<button className="secondary-button compact-button glass-button glass-button--warning" type="button" disabled={resetting} onClick={()=>void resetPreparedOperation()}>{resetting?'Resetting...':'Reset Prepared Workbook'}</button>}</div>}
    {error&&<p className="form-message error" role="alert">{error}</p>}{notice&&<p className="form-message" role="status">{notice}</p>}
  </section>{preview&&<PmImportPreviewModal preview={preview} busy={requestBusy} error={error} overrides={overrides} setOverrides={setOverrides} onClose={()=>void cancelPreview()} onConfirm={()=>void confirmImport()} />}</>;
}

export function PmHistoryModal({task,apiBase,onClose}:{task:PmTask;apiBase:string;onClose:()=>void}) {
  const [history,setHistory]=useState<PmHistory[]>([]);const [loading,setLoading]=useState(true);const [error,setError]=useState('');
  useEffect(()=>{void requestJson<Record<string,unknown>>(`${apiBase}/preventive-maintenance/${task.id}/history`).then(data=>{if(!isRecord(data))throw new Error('PM history data is temporarily unavailable.');setHistory(normalizePmHistory(data.history));}).catch(value=>{setHistory([]);setError((value as Error).message||'History could not be loaded.');}).finally(()=>setLoading(false));},[apiBase,task.id]);
  const safeHistory=Array.isArray(history)?history:[];
  return createPortal(<div className="modal-backdrop glass-modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}><section className="mcc-card glass-modal-shell pm-modal pm-history-modal mcc-wide-modal" role="dialog" aria-modal="true" aria-labelledby="pm-history-title"><div className="modal-heading"><div><p className="eyebrow">Immutable completion history</p><h3 id="pm-history-title">{safeString(task.title,'Untitled PM task')}</h3></div><button className="link-button compact-button glass-button glass-button--secondary" type="button" onClick={onClose}>Close</button></div>{error&&<p className="form-message error">{error}</p>}{loading&&<div className="glass-empty-state">Loading completion history...</div>}{!loading&&!safeHistory.length&&<div className="glass-empty-state">No completions have been recorded.</div>}{safeHistory.length>0&&<div className="pm-history-list glass-card--dense">{safeHistory.map(item=><article className="pm-history-entry" key={item.id}><div><strong>{formatDate(item.completionDate)}</strong><span>Performed by {safeString(item.performedBy,'Unknown user')}</span></div><div className="pm-history-due"><span>Work order: {item.workOrderNumber}</span><span>Meter: {formatMeter(item.completedMeter)}</span><span>Previous due: {item.previousDueDate?formatDate(item.previousDueDate):formatMeter(item.previousDueMeter)}</span><span>Next due: {item.nextDueDate?formatDate(item.nextDueDate):formatMeter(item.nextDueMeter)}</span></div><div className="pm-history-work-order"><span>Follow-up: {item.followUpRequired?'Yes':'No'}</span>{item.followUpRequired&&item.followUpReason&&<span>{item.followUpReason}</span>}{item.attachment?.status==='available'&&item.attachment.openUrl?<a className="secondary-button compact-button glass-button glass-button--secondary" href={item.attachment.openUrl} target="_blank" rel="noopener noreferrer">Open {item.attachment.filename}</a>:item.attachment?<span className="pm-attachment-missing">PDF unavailable: {item.attachment.filename}</span>:<span>No PDF attached</span>}</div>{item.completionNotes&&<p>{item.completionNotes}</p>}</article>)}</div>}<div className="modal-actions glass-modal__actions"><button className="secondary-button glass-button glass-button--secondary" type="button" onClick={onClose}>Close</button></div></section></div>,document.body);
}
