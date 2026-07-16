import { Component, type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { MccDateInput, isValidMccDateValue, localIsoDate } from '../../components/MccDateInput';

type AssetIdentity={id:number;assetNumber:string;assetName:string};
type PmIntervalType='hourly'|'days'|'bi_weekly'|'weekly'|'monthly'|'quarterly'|'bi_annual'|'annual'|'cycles';
type PmStatus='Current'|'Due Soon'|'Overdue'|'Hold'|'Inactive'|'Setup incomplete';
type PmScheduleStatus='active'|'hold'|'inactive';
type PmTask={id:number;assetId:number;title:string;instructions:string;intervalType:PmIntervalType;intervalLabel:string;intervalValue:number;lastCompletedDate:string|null;lastCompletedMeter:number|null;currentMeter:number|null;nextDueDate:string|null;nextDueMeter:number|null;scheduleStatus:PmScheduleStatus;notes:string;status:PmStatus;countdown:string;historyCount:number;createdAt:string;updatedAt:string};
type PmHistory={id:number;completionDate:string;completedMeter:number|null;performedBy:string;completionNotes:string;previousDueDate:string|null;previousDueMeter:number|null;nextDueDate:string|null;nextDueMeter:number|null;createdAt:string};
type PmSummary={total:number;dueSoon:number;overdue:number;nextDueDate:string|null;nextDueMeter:number|null};
type PmDraft={title:string;instructions:string;intervalType:PmIntervalType;intervalValue:string;lastCompletedDate:string;lastCompletedMeter:string;currentMeter:string;scheduleStatus:PmScheduleStatus;notes:string};
type PmDuePreview={label:string;value:string;legend:string;tone:'current'|'due-soon'|'overdue'|'hold'|'incomplete'};

const intervalOptions:Array<{key:PmIntervalType;label:string}>=[
  {key:'hourly',label:'Hourly'},{key:'days',label:'Days'},{key:'bi_weekly',label:'Bi-weekly'},{key:'weekly',label:'Weekly'},{key:'monthly',label:'Monthly'},{key:'quarterly',label:'Quarterly'},{key:'bi_annual',label:'Bi-Annual'},{key:'annual',label:'Annual'},{key:'cycles',label:'Cycles'},
];
const meterIntervals=new Set<PmIntervalType>(['hourly','cycles']);
const calendarDueSoonDays=14;
const meterDueSoonRatio=0.1;
const fixedCadences:Partial<Record<PmIntervalType,{value:number;label:string;days?:number;months?:number}>>={
  bi_weekly:{value:14,label:'Every 14 days',days:14},quarterly:{value:3,label:'Every 3 months',months:3},bi_annual:{value:6,label:'Every 6 months',months:6},annual:{value:12,label:'Every 12 months',months:12},
};
const fixedIntervals=new Set<PmIntervalType>(Object.keys(fixedCadences) as PmIntervalType[]);
const intervalGuidance:Partial<Record<PmIntervalType,string>>={hourly:'0.0 hrs',cycles:'0 cycles',days:'0 days',weekly:'0 weeks',monthly:'0 months'};
const blankDraft:PmDraft={title:'',instructions:'',intervalType:'monthly',intervalValue:'',lastCompletedDate:'',lastCompletedMeter:'',currentMeter:'',scheduleStatus:'active',notes:''};
const emptySummary:PmSummary={total:0,dueSoon:0,overdue:0,nextDueDate:null,nextDueMeter:null};
const validStatuses=new Set<PmStatus>(['Current','Due Soon','Overdue','Hold','Inactive','Setup incomplete']);

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
  return {id,assetId,title:safeString(value.title,'Untitled PM task'),instructions:safeString(value.instructions),intervalType,intervalLabel:safeString(value.intervalLabel,intervalOptions.find(option=>option.key===intervalType)?.label??'PM interval'),intervalValue:safeNumber(value.intervalValue)??0,lastCompletedDate:safeDateValue(value.lastCompletedDate),lastCompletedMeter:safeNumber(value.lastCompletedMeter),currentMeter:safeNumber(value.currentMeter),nextDueDate:safeDateValue(value.nextDueDate),nextDueMeter:safeNumber(value.nextDueMeter),scheduleStatus,notes:safeString(value.notes),status,countdown:safeString(value.countdown,status==='Setup incomplete'?'PM setup is incomplete':''),historyCount:safeCount(value.historyCount),createdAt:safeString(value.createdAt),updatedAt:safeString(value.updatedAt)};
}
function normalizePmTasks(value:unknown){return Array.isArray(value)?value.map(normalizePmTask).filter((task):task is PmTask=>task!==null):[];}
function normalizePmSummary(value:unknown,tasks:PmTask[]):PmSummary{
  const record=isRecord(value)?value:{};
  return {total:safeCount(record.total,tasks.length),dueSoon:safeCount(record.dueSoon,tasks.filter(task=>task.status==='Due Soon').length),overdue:safeCount(record.overdue,tasks.filter(task=>task.status==='Overdue').length),nextDueDate:safeDateValue(record.nextDueDate),nextDueMeter:safeNumber(record.nextDueMeter)};
}
function normalizePmHistory(value:unknown):PmHistory[]{
  if(!Array.isArray(value))return [];
  return value.map(item=>{
    if(!isRecord(item)||safeNumber(item.id)===null)return null;
    return {id:safeNumber(item.id)!,completionDate:safeDateValue(item.completionDate)??'',completedMeter:safeNumber(item.completedMeter),performedBy:safeString(item.performedBy,'Unknown user'),completionNotes:safeString(item.completionNotes),previousDueDate:safeDateValue(item.previousDueDate),previousDueMeter:safeNumber(item.previousDueMeter),nextDueDate:safeDateValue(item.nextDueDate),nextDueMeter:safeNumber(item.nextDueMeter),createdAt:safeString(item.createdAt)};
  }).filter((item):item is PmHistory=>item!==null);
}

async function requestJson<T>(url:string,init?:RequestInit) {
  const response=await fetch(url,{credentials:'include',headers:{...(init?.body?{'Content-Type':'application/json'}:{}),...(init?.headers??{})},...init});
  const contentType=response.headers.get('content-type')??'';
  const raw=await response.text();
  let data:(T&{error?:string})|null=null;
  if(contentType.toLowerCase().includes('application/json')&&raw){try{data=JSON.parse(raw) as T&{error?:string};}catch{data=null;}}
  if(!response.ok){const plain=raw.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();const detail=(data&&safeString(data.error))||plain||response.statusText||'Request failed';throw new Error(`${detail} (${response.status})`);}
  if(data===null)throw new Error(`The PM endpoint returned an unexpected ${contentType||'empty'} response (${response.status}).`);
  return data;
}
function formatDate(value:unknown) {
  if(typeof value!=='string'||!value)return 'Not set';
  const parsed=new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime())?value:parsed.toLocaleDateString();
}
function formatMeter(value:unknown) { return typeof value==='number'&&Number.isFinite(value)?value.toLocaleString():'Not set'; }
function formatNumber(value:unknown){return typeof value==='number'&&Number.isFinite(value)?value.toLocaleString():'0';}
function taskToDraft(task:PmTask):PmDraft { return {title:safeString(task.title),instructions:safeString(task.instructions),intervalType:task.intervalType,intervalValue:fixedIntervals.has(task.intervalType)?'':String(safeNumber(task.intervalValue)??''),lastCompletedDate:safeDateValue(task.lastCompletedDate)??'',lastCompletedMeter:safeNumber(task.lastCompletedMeter)===null?'':String(task.lastCompletedMeter),currentMeter:safeNumber(task.currentMeter)===null?'':String(task.currentMeter),scheduleStatus:task.scheduleStatus,notes:safeString(task.notes)}; }
function addDays(value:string,days:number){const date=new Date(`${value}T12:00:00Z`);if(Number.isNaN(date.getTime())||!Number.isFinite(days))return null;date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);}
function addMonths(value:string,months:number){const date=new Date(`${value}T12:00:00Z`);if(Number.isNaN(date.getTime())||!Number.isFinite(months))return null;const day=date.getUTCDate();date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+months);const last=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0,12)).getUTCDate();date.setUTCDate(Math.min(day,last));return date.toISOString().slice(0,10);}
function cadenceLabel(intervalType:PmIntervalType,intervalValue:number) {
  const fixed=fixedCadences[intervalType];
  if(fixed)return fixed.label;
  const units:Record<'hourly'|'cycles'|'days'|'weekly'|'monthly',string>={hourly:'hours',cycles:'cycles',days:'days',weekly:'weeks',monthly:'months'};
  return `Every ${formatNumber(intervalValue)} ${units[intervalType as keyof typeof units]??'intervals'}`;
}
function calculatedDue(draft:PmDraft){
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
  const due=calculatedDue(draft);
  const hold=draft.scheduleStatus==='hold';
  if(!due)return {label:meterIntervals.has(draft.intervalType)?'Next meter due':'Next PM Due Date',value:'Setup incomplete',legend:meterIntervals.has(draft.intervalType)?'Add the last completed meter and a valid interval.':'Add a valid starting date and interval.',tone:'incomplete'};
  if(due.nextMeter!==null){
    const unit=draft.intervalType==='hourly'?'hours':'cycles';
    if(hold)return {label:'Next meter due',value:`Next due at ${due.nextMeter.toLocaleString()} ${unit}`,legend:'Hold - schedule preserved while overdue tracking is paused.',tone:'hold'};
    if(draft.currentMeter==='')return {label:'Next meter due',value:`Next due at ${due.nextMeter.toLocaleString()} ${unit}`,legend:`Setup incomplete - current ${unit} not entered.`,tone:'incomplete'};
    const current=Number(draft.currentMeter);if(!Number.isFinite(current)||current<0)return {label:'Next meter due',value:`Next due at ${due.nextMeter.toLocaleString()} ${unit}`,legend:`Setup incomplete - enter valid current ${unit}.`,tone:'incomplete'};const remaining=due.nextMeter-current;const threshold=Math.max(1,due.amount*meterDueSoonRatio);
    if(remaining<0)return {label:'Next meter due',value:`Next due at ${due.nextMeter.toLocaleString()} ${unit}`,legend:`Overdue by ${Math.abs(remaining).toLocaleString()} ${unit}.`,tone:'overdue'};
    if(remaining<=threshold)return {label:'Next meter due',value:`Next due at ${due.nextMeter.toLocaleString()} ${unit}`,legend:remaining===0?'Due Soon - due now.':`Due Soon - ${remaining.toLocaleString()} ${unit} remain.`,tone:'due-soon'};
    return {label:'Next meter due',value:`Next due at ${due.nextMeter.toLocaleString()} ${unit}`,legend:`Current - ${remaining.toLocaleString()} ${unit} remain.`,tone:'current'};
  }
  const nextDate=due.nextDate!;const today=localIsoDate(new Date());const days=Math.round((Date.parse(`${nextDate}T12:00:00Z`)-Date.parse(`${today}T12:00:00Z`))/86400000);
  if(hold)return {label:'Next PM Due Date',value:formatDate(nextDate),legend:'Hold - schedule preserved while overdue tracking is paused.',tone:'hold'};
  if(days<0)return {label:'Next PM Due Date',value:formatDate(nextDate),legend:`Overdue by ${Math.abs(days)} day${Math.abs(days)===1?'':'s'}.`,tone:'overdue'};
  if(days<=calendarDueSoonDays)return {label:'Next PM Due Date',value:formatDate(nextDate),legend:days===0?'Due Soon - due today.':`Due Soon - due in ${days} day${days===1?'':'s'}.`,tone:'due-soon'};
  return {label:'Next PM Due Date',value:formatDate(nextDate),legend:`Current - due in ${days} days.`,tone:'current'};
}
function PmUnavailablePanel({message='Preventive maintenance tracking is temporarily unavailable. The rest of this asset record is still available.'}:{message?:string}){
  return <article className="machine-detail-accordion-card pm-tracking-card glass-panel glass-panel--nested is-open"><div className="machine-detail-accordion-header"><div className="machine-detail-accordion-toggle pm-unavailable-heading"><span className="machine-detail-section-title">Preventive Maintenance Tracking</span><span className="machine-detail-section-summary">Setup incomplete</span></div></div><div className="machine-detail-accordion-panel" aria-hidden="false"><div className="glass-empty-state"><strong>PM tracking unavailable</strong><span>{message}</span></div></div></article>;
}
class PmPanelErrorBoundary extends Component<{children:ReactNode},{failed:boolean}>{
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){return this.state.failed?<PmUnavailablePanel />:this.props.children;}
}

export function PreventiveMaintenanceTracking({asset,canEdit}:{asset:AssetIdentity|null|undefined;canEdit:boolean|undefined}) {
  if(!asset||!Number.isFinite(asset.id))return <PmUnavailablePanel message="This asset is missing the information needed to load PM tracking." />;
  return <PmPanelErrorBoundary key={asset.id}><PreventiveMaintenanceTrackingContent asset={asset} canEdit={Boolean(canEdit)} /></PmPanelErrorBoundary>;
}

function PreventiveMaintenanceTrackingContent({asset,canEdit}:{asset:AssetIdentity;canEdit:boolean}) {
  const [expanded,setExpanded]=useState(false);
  const [tasks,setTasks]=useState<PmTask[]>([]);
  const [summary,setSummary]=useState<PmSummary>(emptySummary);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [formTask,setFormTask]=useState<PmTask|null|undefined>(undefined);
  const [viewTask,setViewTask]=useState<PmTask|null>(null);
  const [completeTask,setCompleteTask]=useState<PmTask|null>(null);
  const [historyTask,setHistoryTask]=useState<PmTask|null>(null);

  async function load() {
    setLoading(true);setError('');
    try{const data=await requestJson<Record<string,unknown>>(`/api/machine-library/assets/${asset.id}/preventive-maintenance`);if(!isRecord(data))throw new Error('Preventive maintenance data is temporarily unavailable.');const safeTasks=normalizePmTasks(data.tasks);setTasks(safeTasks);setSummary(normalizePmSummary(data.summary,safeTasks));}
    catch(value){setTasks([]);setSummary(emptySummary);setError((value as Error).message||'Preventive maintenance tracking could not be loaded.');}
    finally{setLoading(false);}
  }
  useEffect(()=>{setExpanded(false);setFormTask(undefined);setViewTask(null);setCompleteTask(null);setHistoryTask(null);void load();},[asset.id]);
  const summaryText=useMemo(()=>{
    if(loading)return 'Loading tracking...';
    const safeSummary=summary??emptySummary;
    if(!safeSummary.total)return error?'PM tracking unavailable':'No PM tracking configured';
    const next=safeSummary.nextDueDate?`Next ${formatDate(safeSummary.nextDueDate)}`:safeSummary.nextDueMeter!==null?`Next meter ${formatMeter(safeSummary.nextDueMeter)}`:'Next due not set';
    return `${safeSummary.total} total · ${safeSummary.dueSoon} due soon · ${safeSummary.overdue} overdue · ${next}`;
  },[error,loading,summary]);
  const safeTasks=Array.isArray(tasks)?tasks:[];
  async function deactivate(task:PmTask) {
    if(!window.confirm(`Deactivate “${task.title}”? Its completion history will be preserved.`))return;
    try{await requestJson(`/api/machine-library/preventive-maintenance/${task.id}/deactivate`,{method:'POST',body:'{}'});await load();}
    catch(value){setError((value as Error).message||'PM tracking could not be deactivated.');}
  }
  return <>
    <article className={`machine-detail-accordion-card pm-tracking-card glass-panel glass-panel--nested${expanded?' is-open':''}`}>
      <div className="machine-detail-accordion-header">
        <button className="machine-detail-accordion-toggle" type="button" aria-expanded={expanded} aria-controls={`pm-tracking-panel-${asset.id}`} onClick={()=>setExpanded(current=>!current)}>
          <span className="machine-detail-section-title">Preventive Maintenance Tracking</span><span className="machine-detail-section-summary">{summaryText}</span><span className="machine-accordion-chevron" aria-hidden="true">v</span>
        </button>
      </div>
      <div className="machine-detail-accordion-panel" id={`pm-tracking-panel-${asset.id}`} aria-hidden={!expanded}>
        <div className="pm-panel-toolbar glass-toolbar"><div><strong>PM schedules</strong><small>Track calendar, hour-meter, and cycle-based maintenance.</small></div>{canEdit&&<button className="primary-button glass-button glass-button--primary" type="button" onClick={()=>setFormTask(null)}>Add Preventive Maintenance Tracking</button>}</div>
        <div className="pm-due-legend" aria-label="Preventive maintenance due status legend"><span className="pm-due-legend--current">Current</span><span className="pm-due-legend--due-soon">Due Soon</span><span className="pm-due-legend--overdue">Overdue</span></div>
        {error&&<p className="form-message error">{error}</p>}
        {loading&&<div className="glass-empty-state">Loading preventive maintenance tracking...</div>}
        {!loading&&!error&&!safeTasks.length&&<div className="glass-empty-state"><strong>No preventive maintenance tracking yet.</strong><span>Add the first schedule to calculate due dates or meter targets for this asset.</span></div>}
        {!loading&&error&&<div className="glass-empty-state"><strong>PM tracking unavailable</strong><span>The asset detail remains available. Try loading PM tracking again later.</span></div>}
        {!loading&&safeTasks.length>0&&<div className="pm-task-grid">{safeTasks.map(task=><PmTaskCard key={task.id} task={task} canEdit={canEdit} onView={()=>setViewTask(task)} onEdit={()=>setFormTask(task)} onComplete={()=>setCompleteTask(task)} onDeactivate={()=>void deactivate(task)} onHistory={()=>setHistoryTask(task)} />)}</div>}
      </div>
    </article>
    {formTask!==undefined&&<PmFormModal asset={asset} task={formTask} onClose={()=>setFormTask(undefined)} onSaved={async()=>{setFormTask(undefined);await load();}} />}
    {viewTask&&<PmViewModal task={viewTask} onClose={()=>setViewTask(null)} />}
    {completeTask&&<PmCompleteModal task={completeTask} onClose={()=>setCompleteTask(null)} onSaved={async()=>{setCompleteTask(null);await load();}} />}
    {historyTask&&<PmHistoryModal task={historyTask} onClose={()=>setHistoryTask(null)} />}
  </>;
}

function PmTaskCard({task,canEdit,onView,onEdit,onComplete,onDeactivate,onHistory}:{task:PmTask;canEdit:boolean;onView:()=>void;onEdit:()=>void;onComplete:()=>void;onDeactivate:()=>void;onHistory:()=>void}) {
  const meter=meterIntervals.has(task.intervalType);
  const status=validStatuses.has(task.status)?task.status:'Setup incomplete';
  const statusClass=status.toLowerCase().replace(/\s+/g,'-');
  return <article className="pm-task-card glass-card">
    <div className="pm-task-card-heading"><div><span className="eyebrow">{cadenceLabel(task.intervalType,task.intervalValue)}</span><h4>{safeString(task.title,'Untitled PM task')}</h4></div><span className={`glass-pill pm-status pm-status--${statusClass}`}>{status==='Hold'?'HOLD':status}</span></div>
    <div className="pm-task-values"><div><span>{meter?`Last completed ${task.intervalType==='hourly'?'hours':'cycles'}`:'Last completed date'}</span><strong>{meter?formatMeter(task.lastCompletedMeter):formatDate(task.lastCompletedDate)}</strong></div><div><span>{meter?'Next meter due':'Next PM Due Date'}</span><strong>{meter?formatMeter(task.nextDueMeter):formatDate(task.nextDueDate)}</strong></div></div>
    <p className={`pm-countdown pm-countdown--${statusClass}`}>{safeString(task.countdown,status==='Setup incomplete'?'PM setup is incomplete':'')}</p>
    <div className="pm-card-actions glass-button-group"><button className="secondary-button compact-button glass-button glass-button--secondary" type="button" onClick={onView}>View</button><button className="secondary-button compact-button glass-button glass-button--secondary" type="button" onClick={onHistory}>View History ({safeCount(task.historyCount)})</button>{canEdit&&<button className="secondary-button compact-button glass-button glass-button--secondary" type="button" onClick={onEdit}>Edit</button>}{canEdit&&task.scheduleStatus==='active'&&<button className="primary-button compact-button glass-button glass-button--success" type="button" onClick={onComplete}>Mark Complete</button>}{canEdit&&task.scheduleStatus!=='inactive'&&<button className="secondary-button compact-button glass-button glass-button--warning" type="button" onClick={onDeactivate}>Deactivate</button>}</div>
  </article>;
}

function pmDraftErrors(draft:PmDraft){
  const errors:Partial<Record<'title'|'interval'|'date'|'lastMeter'|'currentMeter',string>>={};
  if(!draft.title.trim())errors.title='PM title is required.';
  const fixed=fixedCadences[draft.intervalType];const amount=Number(draft.intervalValue);
  if(!fixed&&(!Number.isFinite(amount)||amount<=0))errors.interval='Enter an interval greater than zero.';
  if(!fixed&&['cycles','days','weekly','monthly'].includes(draft.intervalType)&&Number.isFinite(amount)&&!Number.isInteger(amount))errors.interval='Use a whole number for this interval type.';
  if(meterIntervals.has(draft.intervalType)){
    const completed=Number(draft.lastCompletedMeter);
    if(draft.lastCompletedMeter===''||!Number.isFinite(completed)||completed<0)errors.lastMeter=`Last completed ${draft.intervalType==='hourly'?'hours':'cycles'} must be zero or greater.`;
    if(draft.intervalType==='cycles'&&draft.lastCompletedMeter!==''&&Number.isFinite(completed)&&!Number.isInteger(completed))errors.lastMeter='Last completed cycles must use a whole number.';
    if(draft.currentMeter!==''){const current=Number(draft.currentMeter);if(!Number.isFinite(current)||current<0)errors.currentMeter=`Current ${draft.intervalType==='hourly'?'hours':'cycles'} must be zero or greater.`;else if(draft.intervalType==='cycles'&&!Number.isInteger(current))errors.currentMeter='Current cycles must use a whole number.';}
  }else if((fixed&&!draft.lastCompletedDate)||(draft.lastCompletedDate!==''&&!isValidMccDateValue(draft.lastCompletedDate,true)))errors.date='Enter a valid Last Completed Date / Starting Date.';
  return errors;
}

function PmFormModal({asset,task,onClose,onSaved}:{asset:AssetIdentity;task:PmTask|null;onClose:()=>void;onSaved:()=>void|Promise<void>}) {
  const [draft,setDraft]=useState<PmDraft>(()=>task?taskToDraft(task):blankDraft);
  const [saving,setSaving]=useState(false);const [error,setError]=useState('');
  const meter=meterIntervals.has(draft.intervalType);const fixed=fixedIntervals.has(draft.intervalType);
  const fixedCadence=fixedCadences[draft.intervalType];const validation=pmDraftErrors(draft);const preview=pmDuePreview(draft);
  const intervalPlaceholder=intervalGuidance[draft.intervalType]??'0';const meterUnit=draft.intervalType==='hourly'?'Hours':'Cycles';
  function field<K extends keyof PmDraft>(key:K,value:PmDraft[K]){setDraft(current=>({...current,[key]:value}));}
  async function submit(event:FormEvent){event.preventDefault();const firstError=Object.values(validation)[0];if(firstError){setError(firstError);return;}setSaving(true);setError('');try{const payload={title:draft.title,instructions:draft.instructions,intervalType:draft.intervalType,intervalValue:fixedCadence?.value??Number(draft.intervalValue),lastCompletedDate:meter?null:(draft.lastCompletedDate||null),lastCompletedMeter:meter?Number(draft.lastCompletedMeter):null,currentMeter:meter&&draft.currentMeter!==''?Number(draft.currentMeter):null,scheduleStatus:draft.scheduleStatus,notes:draft.notes};await requestJson(task?`/api/machine-library/preventive-maintenance/${task.id}`:`/api/machine-library/assets/${asset.id}/preventive-maintenance`,{method:task?'PUT':'POST',body:JSON.stringify(payload)});await onSaved();}catch(value){setError((value as Error).message||'PM tracking could not be saved.');}finally{setSaving(false);}}
  return createPortal(<div className="modal-backdrop glass-modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget&&!saving)onClose();}}><section className="mcc-card glass-modal-shell pm-modal mcc-wide-modal" role="dialog" aria-modal="true" aria-labelledby="pm-form-title"><form onSubmit={submit}>
    <div className="modal-heading"><div><p className="eyebrow">{safeString(asset.assetNumber,'Machine asset')} · {safeString(asset.assetName,'Machine asset')}</p><h3 id="pm-form-title">{task?'Edit':'Add'} Preventive Maintenance Tracking</h3></div><button className="link-button compact-button glass-button glass-button--secondary" type="button" onClick={onClose} disabled={saving}>Close</button></div>
    <div className="pm-form-grid"><label className="form-field pm-form-wide"><span>PM Title *</span><input className="glass-input" value={draft.title} maxLength={180} onChange={e=>field('title',e.target.value)} required />{validation.title&&<small className="pm-inline-error">{validation.title}</small>}</label><label className="form-field pm-form-wide"><span>Instructions</span><textarea className="glass-input" rows={4} maxLength={12000} value={draft.instructions} onChange={e=>field('instructions',e.target.value)} /></label>
      <label className="form-field"><span>Interval Type *</span><select className="glass-input" value={draft.intervalType} onChange={e=>{const value=e.target.value as PmIntervalType;setDraft(current=>({...current,intervalType:value,intervalValue:fixedIntervals.has(value)?'':current.intervalValue,lastCompletedDate:meterIntervals.has(value)?'':current.lastCompletedDate,lastCompletedMeter:meterIntervals.has(value)?current.lastCompletedMeter:'',currentMeter:meterIntervals.has(value)?current.currentMeter:''}));}}>{intervalOptions.map(option=><option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
      {fixed&&fixedCadence?<div className="pm-fixed-cadence glass-input" aria-readonly="true"><span>Fixed cadence</span><strong>{fixedCadence.label}</strong></div>:<label className="form-field"><span>How long is the interval? *</span><input className="glass-input" type="number" min={draft.intervalType==='hourly'?'0.1':'1'} step={draft.intervalType==='hourly'?'0.1':'1'} placeholder={intervalPlaceholder} value={draft.intervalValue} onChange={e=>field('intervalValue',e.target.value)} required /><small className="pm-input-guidance">{intervalPlaceholder}</small>{validation.interval&&<small className="pm-inline-error">{validation.interval}</small>}</label>}
      {!meter&&<div className="pm-date-field"><MccDateInput label="Last Completed Date / Starting Date" value={draft.lastCompletedDate} onChange={value=>field('lastCompletedDate',value)} required={fixed} />{validation.date&&<small className="pm-inline-error">{validation.date}</small>}</div>}
      {meter&&<label className="form-field"><span>Last Completed {meterUnit} *</span><input className="glass-input" type="number" min="0" step={draft.intervalType==='hourly'?'0.1':'1'} placeholder={draft.intervalType==='hourly'?'0.0 hrs':'0 cycles'} value={draft.lastCompletedMeter} onChange={e=>field('lastCompletedMeter',e.target.value)} required />{validation.lastMeter&&<small className="pm-inline-error">{validation.lastMeter}</small>}</label>}
      {meter&&<label className="form-field"><span>Current {meterUnit} <small>(optional)</small></span><input className="glass-input" type="number" min="0" step={draft.intervalType==='hourly'?'0.1':'1'} placeholder={draft.intervalType==='hourly'?'0.0 hrs':'0 cycles'} value={draft.currentMeter} onChange={e=>field('currentMeter',e.target.value)} />{validation.currentMeter&&<small className="pm-inline-error">{validation.currentMeter}</small>}</label>}
      <label className="form-field"><span>Status</span><select className="glass-input" value={draft.scheduleStatus} onChange={e=>field('scheduleStatus',e.target.value as PmScheduleStatus)}><option value="active">Active</option><option value="hold">Hold</option><option value="inactive">Inactive</option></select></label>
      <div className={`pm-due-preview pm-due-preview--${preview.tone} glass-card glass-card--nested`}><span>{preview.label}</span><strong>{preview.value}</strong><small className="pm-due-status-line">{preview.legend}</small></div>
      <label className="form-field pm-form-wide"><span>Notes</span><textarea className="glass-input" rows={3} maxLength={12000} value={draft.notes} onChange={e=>field('notes',e.target.value)} /></label>
    </div>{error&&<p className="form-message error">{error}</p>}<div className="modal-actions glass-modal__actions"><button className="secondary-button glass-button glass-button--secondary" type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary-button glass-button glass-button--primary" type="submit" disabled={saving||Object.keys(validation).length>0}>{saving?'Saving...':'Save PM Tracking'}</button></div>
  </form></section></div>,document.body);
}

function PmViewModal({task,onClose}:{task:PmTask;onClose:()=>void}) {
  const meter=meterIntervals.has(task.intervalType);
  return createPortal(<div className="modal-backdrop glass-modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}><section className="mcc-card glass-modal-shell pm-modal pm-view-modal mcc-wide-modal" role="dialog" aria-modal="true" aria-labelledby="pm-view-title"><div className="modal-heading"><div><p className="eyebrow">Preventive Maintenance Tracking</p><h3 id="pm-view-title">{safeString(task.title,'Untitled PM task')}</h3></div><button className="link-button compact-button glass-button glass-button--secondary" type="button" onClick={onClose}>Close</button></div><div className="pm-view-grid"><PmValue label="Status" value={validStatuses.has(task.status)?task.status:'Setup incomplete'}/><PmValue label="Interval" value={cadenceLabel(task.intervalType,task.intervalValue)}/><PmValue label={meter?`Last completed ${task.intervalType==='hourly'?'hours':'cycles'}`:'Last completed date'} value={meter?formatMeter(task.lastCompletedMeter):formatDate(task.lastCompletedDate)}/><PmValue label={meter?`Current ${task.intervalType==='hourly'?'hours':'cycles'}`:'Current meter'} value={meter?formatMeter(task.currentMeter):'Not applicable'}/><PmValue label={meter?'Next meter due':'Next PM Due Date'} value={meter?formatMeter(task.nextDueMeter):formatDate(task.nextDueDate)}/></div>{task.instructions&&<div className="pm-prose glass-card glass-card--nested"><span>Instructions</span><p>{task.instructions}</p></div>}{task.notes&&<div className="pm-prose glass-card glass-card--nested"><span>Notes</span><p>{task.notes}</p></div>}<div className="modal-actions glass-modal__actions"><button className="secondary-button glass-button glass-button--secondary" type="button" onClick={onClose}>Close</button></div></section></div>,document.body);
}
function PmValue({label,value}:{label:string;value:string}){return <div className="pm-value glass-card glass-card--nested"><span>{label}</span><strong>{value}</strong></div>;}

function PmCompleteModal({task,onClose,onSaved}:{task:PmTask;onClose:()=>void;onSaved:()=>void}) {
  const meter=meterIntervals.has(task.intervalType);const [date,setDate]=useState(localIsoDate(new Date()));const [completedMeter,setCompletedMeter]=useState(task.currentMeter===null?'':String(task.currentMeter));const [notes,setNotes]=useState('');const [saving,setSaving]=useState(false);const [error,setError]=useState('');
  async function submit(event:FormEvent){event.preventDefault();setSaving(true);setError('');try{await requestJson(`/api/machine-library/preventive-maintenance/${task.id}/complete`,{method:'POST',body:JSON.stringify({completionDate:date,completedMeter:completedMeter===''?null:Number(completedMeter),completionNotes:notes})});onSaved();}catch(value){setError((value as Error).message||'PM completion could not be saved.');}finally{setSaving(false);}}
  return createPortal(<div className="modal-backdrop glass-modal-backdrop" role="presentation"><section className="mcc-card glass-modal-shell pm-modal pm-complete-modal mcc-wide-modal" role="dialog" aria-modal="true" aria-labelledby="pm-complete-title"><form onSubmit={submit}><div className="modal-heading"><div><p className="eyebrow">Immutable completion history</p><h3 id="pm-complete-title">Mark {task.title} Complete</h3></div><button className="link-button compact-button glass-button glass-button--secondary" type="button" onClick={onClose} disabled={saving}>Close</button></div><div className="pm-form-grid"><MccDateInput label="Completion Date *" value={date} onChange={setDate} required />{meter&&<label className="form-field"><span>Completed Meter *</span><input className="glass-input" type="number" min="0" step="0.01" value={completedMeter} onChange={e=>setCompletedMeter(e.target.value)} required /></label>}<label className="form-field pm-form-wide"><span>Completion Notes</span><textarea className="glass-input" rows={4} maxLength={12000} value={notes} onChange={e=>setNotes(e.target.value)} /></label></div><p className="pm-history-notice">Saving creates a permanent completion record and advances the next due value.</p>{error&&<p className="form-message error">{error}</p>}<div className="modal-actions glass-modal__actions"><button className="secondary-button glass-button glass-button--secondary" type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary-button glass-button glass-button--success" type="submit" disabled={saving}>{saving?'Saving completion...':'Mark Complete'}</button></div></form></section></div>,document.body);
}

function PmHistoryModal({task,onClose}:{task:PmTask;onClose:()=>void}) {
  const [history,setHistory]=useState<PmHistory[]>([]);const [loading,setLoading]=useState(true);const [error,setError]=useState('');
  useEffect(()=>{void requestJson<Record<string,unknown>>(`/api/machine-library/preventive-maintenance/${task.id}/history`).then(data=>{if(!isRecord(data))throw new Error('PM history data is temporarily unavailable.');setHistory(normalizePmHistory(data.history));}).catch(value=>{setHistory([]);setError((value as Error).message||'History could not be loaded.');}).finally(()=>setLoading(false));},[task.id]);
  const safeHistory=Array.isArray(history)?history:[];
  return createPortal(<div className="modal-backdrop glass-modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}><section className="mcc-card glass-modal-shell pm-modal pm-history-modal mcc-wide-modal" role="dialog" aria-modal="true" aria-labelledby="pm-history-title"><div className="modal-heading"><div><p className="eyebrow">Immutable completion history</p><h3 id="pm-history-title">{safeString(task.title,'Untitled PM task')}</h3></div><button className="link-button compact-button glass-button glass-button--secondary" type="button" onClick={onClose}>Close</button></div>{error&&<p className="form-message error">{error}</p>}{loading&&<div className="glass-empty-state">Loading completion history...</div>}{!loading&&!safeHistory.length&&<div className="glass-empty-state">No completions have been recorded.</div>}{safeHistory.length>0&&<div className="pm-history-list glass-card--dense">{safeHistory.map(item=><article className="pm-history-entry" key={item.id}><div><strong>{formatDate(item.completionDate)}</strong><span>Performed by {safeString(item.performedBy,'Unknown user')}</span></div><div className="pm-history-due"><span>Meter: {formatMeter(item.completedMeter)}</span><span>Previous due: {item.previousDueDate?formatDate(item.previousDueDate):formatMeter(item.previousDueMeter)}</span><span>Next due: {item.nextDueDate?formatDate(item.nextDueDate):formatMeter(item.nextDueMeter)}</span></div>{item.completionNotes&&<p>{item.completionNotes}</p>}</article>)}</div>}<div className="modal-actions glass-modal__actions"><button className="secondary-button glass-button glass-button--secondary" type="button" onClick={onClose}>Close</button></div></section></div>,document.body);
}
