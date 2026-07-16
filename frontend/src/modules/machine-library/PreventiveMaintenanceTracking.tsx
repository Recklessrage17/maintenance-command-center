import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { MccDateInput, localIsoDate } from '../../components/MccDateInput';

type AssetIdentity={id:number;assetNumber:string;assetName:string};
type PmIntervalType='hourly'|'days'|'bi_weekly'|'weekly'|'monthly'|'quarterly'|'bi_annual'|'annual'|'cycles';
type PmStatus='Current'|'Due Soon'|'Overdue'|'Inactive'|'Setup incomplete';
type PmTask={id:number;assetId:number;title:string;instructions:string;intervalType:PmIntervalType;intervalLabel:string;intervalValue:number;lastCompletedDate:string|null;lastCompletedMeter:number|null;currentMeter:number|null;nextDueDate:string|null;nextDueMeter:number|null;assignedTo:string;active:boolean;notes:string;status:PmStatus;countdown:string;historyCount:number;createdAt:string;updatedAt:string};
type PmHistory={id:number;completionDate:string;completedMeter:number|null;performedBy:string;completionNotes:string;previousDueDate:string|null;previousDueMeter:number|null;nextDueDate:string|null;nextDueMeter:number|null;createdAt:string};
type PmSummary={total:number;dueSoon:number;overdue:number;nextDueDate:string|null;nextDueMeter:number|null};
type PmDraft={title:string;instructions:string;intervalType:PmIntervalType;intervalValue:string;lastCompletedDate:string;lastCompletedMeter:string;currentMeter:string;assignedTo:string;active:boolean;notes:string};

const intervalOptions:Array<{key:PmIntervalType;label:string}>=[
  {key:'hourly',label:'Hourly'},{key:'days',label:'Days'},{key:'bi_weekly',label:'Bi-weekly'},{key:'weekly',label:'Weekly'},{key:'monthly',label:'Monthly'},{key:'quarterly',label:'Quarterly'},{key:'bi_annual',label:'Bi-Annual'},{key:'annual',label:'Annual'},{key:'cycles',label:'Cycles'},
];
const meterIntervals=new Set<PmIntervalType>(['hourly','cycles']);
const fixedIntervals=new Set<PmIntervalType>(['bi_weekly','weekly','monthly','quarterly','bi_annual','annual']);
const blankDraft:PmDraft={title:'',instructions:'',intervalType:'monthly',intervalValue:'1',lastCompletedDate:'',lastCompletedMeter:'',currentMeter:'',assignedTo:'',active:true,notes:''};

async function requestJson<T>(url:string,init?:RequestInit) {
  const response=await fetch(url,{credentials:'include',headers:{...(init?.body?{'Content-Type':'application/json'}:{}),...(init?.headers??{})},...init});
  const data=await response.json().catch(()=>({})) as T&{error?:string};
  if(!response.ok) throw new Error(data.error||'Request failed.');
  return data;
}
function formatDate(value:string|null) {
  if(!value)return 'Not set';
  const parsed=new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime())?value:parsed.toLocaleDateString();
}
function formatMeter(value:number|null) { return value===null?'Not set':value.toLocaleString(); }
function taskToDraft(task:PmTask):PmDraft { return {title:task.title,instructions:task.instructions,intervalType:task.intervalType,intervalValue:String(task.intervalValue),lastCompletedDate:task.lastCompletedDate??'',lastCompletedMeter:task.lastCompletedMeter===null?'':String(task.lastCompletedMeter),currentMeter:task.currentMeter===null?'':String(task.currentMeter),assignedTo:task.assignedTo,active:task.active,notes:task.notes}; }
function addDays(value:string,days:number){const date=new Date(`${value}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);}
function addMonths(value:string,months:number){const date=new Date(`${value}T12:00:00Z`);const day=date.getUTCDate();date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+months);const last=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0,12)).getUTCDate();date.setUTCDate(Math.min(day,last));return date.toISOString().slice(0,10);}
function duePreview(draft:PmDraft) {
  const amount=Number(draft.intervalValue);
  if(!Number.isFinite(amount)||amount<=0)return 'Enter a valid interval value';
  if(meterIntervals.has(draft.intervalType)){
    const meter=Number(draft.lastCompletedMeter);
    return draft.lastCompletedMeter!==''&&Number.isFinite(meter)?`${(meter+amount).toLocaleString()} ${draft.intervalType==='hourly'?'hours':'cycles'}`:'Setup incomplete — add the last completed meter';
  }
  if(!draft.lastCompletedDate)return 'Setup incomplete — add the last completed date';
  if(draft.intervalType==='days')return formatDate(addDays(draft.lastCompletedDate,amount));
  if(draft.intervalType==='bi_weekly')return formatDate(addDays(draft.lastCompletedDate,14));
  if(draft.intervalType==='weekly')return formatDate(addDays(draft.lastCompletedDate,7));
  const months={monthly:1,quarterly:3,bi_annual:6,annual:12}[draft.intervalType as 'monthly'|'quarterly'|'bi_annual'|'annual'];
  return formatDate(addMonths(draft.lastCompletedDate,months));
}

export function PreventiveMaintenanceTracking({asset,canEdit}:{asset:AssetIdentity;canEdit:boolean}) {
  const [expanded,setExpanded]=useState(false);
  const [tasks,setTasks]=useState<PmTask[]>([]);
  const [summary,setSummary]=useState<PmSummary>({total:0,dueSoon:0,overdue:0,nextDueDate:null,nextDueMeter:null});
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [formTask,setFormTask]=useState<PmTask|null|undefined>(undefined);
  const [viewTask,setViewTask]=useState<PmTask|null>(null);
  const [completeTask,setCompleteTask]=useState<PmTask|null>(null);
  const [historyTask,setHistoryTask]=useState<PmTask|null>(null);

  async function load() {
    setLoading(true);setError('');
    try{const data=await requestJson<{tasks:PmTask[];summary:PmSummary}>(`/api/machine-library/assets/${asset.id}/preventive-maintenance`);setTasks(data.tasks);setSummary(data.summary);}
    catch(value){setError((value as Error).message||'Preventive maintenance tracking could not be loaded.');}
    finally{setLoading(false);}
  }
  useEffect(()=>{setExpanded(false);setFormTask(undefined);setViewTask(null);setCompleteTask(null);setHistoryTask(null);void load();},[asset.id]);
  const summaryText=useMemo(()=>{
    if(loading)return 'Loading tracking...';
    if(!summary.total)return 'No PM tracking configured';
    const next=summary.nextDueDate?`Next ${formatDate(summary.nextDueDate)}`:summary.nextDueMeter!==null?`Next meter ${formatMeter(summary.nextDueMeter)}`:'Next due not set';
    return `${summary.total} total · ${summary.dueSoon} due soon · ${summary.overdue} overdue · ${next}`;
  },[loading,summary]);
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
        {error&&<p className="form-message error">{error}</p>}
        {loading&&<div className="glass-empty-state">Loading preventive maintenance tracking...</div>}
        {!loading&&!tasks.length&&<div className="glass-empty-state"><strong>No preventive maintenance tracking yet.</strong><span>Add the first schedule to calculate due dates or meter targets for this asset.</span></div>}
        {!loading&&tasks.length>0&&<div className="pm-task-grid">{tasks.map(task=><PmTaskCard key={task.id} task={task} canEdit={canEdit} onView={()=>setViewTask(task)} onEdit={()=>setFormTask(task)} onComplete={()=>setCompleteTask(task)} onDeactivate={()=>void deactivate(task)} onHistory={()=>setHistoryTask(task)} />)}</div>}
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
  return <article className="pm-task-card glass-card">
    <div className="pm-task-card-heading"><div><span className="eyebrow">{task.intervalLabel} · every {task.intervalValue.toLocaleString()}</span><h4>{task.title}</h4></div><span className={`glass-pill pm-status pm-status--${task.status.toLowerCase().replace(/\s+/g,'-')}`}>{task.status}</span></div>
    <div className="pm-task-values"><div><span>Last completed</span><strong>{meter?formatMeter(task.lastCompletedMeter):formatDate(task.lastCompletedDate)}</strong></div><div><span>Next due</span><strong>{meter?formatMeter(task.nextDueMeter):formatDate(task.nextDueDate)}</strong></div></div>
    <p className="pm-countdown">{task.countdown}</p>
    {task.assignedTo&&<span className="glass-pill pm-assignee">Assigned: {task.assignedTo}</span>}
    <div className="pm-card-actions glass-button-group"><button className="secondary-button compact-button glass-button glass-button--secondary" type="button" onClick={onView}>View</button><button className="secondary-button compact-button glass-button glass-button--secondary" type="button" onClick={onHistory}>View History ({task.historyCount})</button>{canEdit&&<button className="secondary-button compact-button glass-button glass-button--secondary" type="button" onClick={onEdit}>Edit</button>}{canEdit&&task.active&&<button className="primary-button compact-button glass-button glass-button--success" type="button" onClick={onComplete}>Mark Complete</button>}{canEdit&&task.active&&<button className="secondary-button compact-button glass-button glass-button--warning" type="button" onClick={onDeactivate}>Deactivate</button>}</div>
  </article>;
}

function PmFormModal({asset,task,onClose,onSaved}:{asset:AssetIdentity;task:PmTask|null;onClose:()=>void;onSaved:()=>void}) {
  const [draft,setDraft]=useState<PmDraft>(()=>task?taskToDraft(task):blankDraft);
  const [saving,setSaving]=useState(false);const [error,setError]=useState('');
  const meter=meterIntervals.has(draft.intervalType);const fixed=fixedIntervals.has(draft.intervalType);
  function field<K extends keyof PmDraft>(key:K,value:PmDraft[K]){setDraft(current=>({...current,[key]:value}));}
  async function submit(event:FormEvent){event.preventDefault();setSaving(true);setError('');try{const payload={...draft,intervalValue:Number(draft.intervalValue),lastCompletedMeter:draft.lastCompletedMeter===''?null:Number(draft.lastCompletedMeter),currentMeter:draft.currentMeter===''?null:Number(draft.currentMeter)};await requestJson(task?`/api/machine-library/preventive-maintenance/${task.id}`:`/api/machine-library/assets/${asset.id}/preventive-maintenance`,{method:task?'PUT':'POST',body:JSON.stringify(payload)});onSaved();}catch(value){setError((value as Error).message||'PM tracking could not be saved.');}finally{setSaving(false);}}
  return createPortal(<div className="modal-backdrop glass-modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget&&!saving)onClose();}}><section className="mcc-card glass-modal-shell pm-modal" role="dialog" aria-modal="true" aria-labelledby="pm-form-title"><form onSubmit={submit}>
    <div className="modal-heading"><div><p className="eyebrow">{asset.assetNumber} · {asset.assetName||'Machine asset'}</p><h3 id="pm-form-title">{task?'Edit':'Add'} Preventive Maintenance Tracking</h3></div><button className="link-button compact-button glass-button glass-button--secondary" type="button" onClick={onClose} disabled={saving}>Close</button></div>
    <div className="pm-form-grid"><label className="form-field pm-form-wide"><span>PM Title *</span><input className="glass-input" value={draft.title} maxLength={180} onChange={e=>field('title',e.target.value)} required /></label><label className="form-field pm-form-wide"><span>Instructions</span><textarea className="glass-input" rows={4} maxLength={12000} value={draft.instructions} onChange={e=>field('instructions',e.target.value)} /></label>
      <label className="form-field"><span>Interval Type *</span><select className="glass-input" value={draft.intervalType} onChange={e=>{const value=e.target.value as PmIntervalType;setDraft(current=>({...current,intervalType:value,intervalValue:fixedIntervals.has(value)?'1':current.intervalValue||'1'}));}}>{intervalOptions.map(option=><option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
      <label className="form-field"><span>Interval Value *</span><input className="glass-input" type="number" min="0.01" step={draft.intervalType==='days'?'1':'0.01'} value={draft.intervalValue} onChange={e=>field('intervalValue',e.target.value)} disabled={fixed} required />{fixed&&<small>This interval uses its standard calendar period.</small>}</label>
      <MccDateInput label="Last Completed Date" value={draft.lastCompletedDate} onChange={value=>field('lastCompletedDate',value)} />
      {meter&&<label className="form-field"><span>Last Completed Meter *</span><input className="glass-input" type="number" min="0" step="0.01" value={draft.lastCompletedMeter} onChange={e=>field('lastCompletedMeter',e.target.value)} /></label>}
      {meter&&<label className="form-field"><span>Current Meter</span><input className="glass-input" type="number" min="0" step="0.01" value={draft.currentMeter} onChange={e=>field('currentMeter',e.target.value)} /></label>}
      <label className="form-field"><span>Assigned Role / Technician</span><input className="glass-input" maxLength={180} value={draft.assignedTo} onChange={e=>field('assignedTo',e.target.value)} /></label>
      <label className="form-field"><span>Status</span><select className="glass-input" value={draft.active?'active':'inactive'} onChange={e=>field('active',e.target.value==='active')}><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
      <div className="pm-due-preview glass-card glass-card--nested"><span>Calculated next due</span><strong>{duePreview(draft)}</strong></div>
      <label className="form-field pm-form-wide"><span>Notes</span><textarea className="glass-input" rows={3} maxLength={12000} value={draft.notes} onChange={e=>field('notes',e.target.value)} /></label>
    </div>{error&&<p className="form-message error">{error}</p>}<div className="modal-actions glass-modal__actions"><button className="secondary-button glass-button glass-button--secondary" type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary-button glass-button glass-button--primary" type="submit" disabled={saving}>{saving?'Saving...':'Save PM Tracking'}</button></div>
  </form></section></div>,document.body);
}

function PmViewModal({task,onClose}:{task:PmTask;onClose:()=>void}) {
  const meter=meterIntervals.has(task.intervalType);
  return createPortal(<div className="modal-backdrop glass-modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}><section className="mcc-card glass-modal-shell pm-modal pm-view-modal" role="dialog" aria-modal="true" aria-labelledby="pm-view-title"><div className="modal-heading"><div><p className="eyebrow">Preventive Maintenance Tracking</p><h3 id="pm-view-title">{task.title}</h3></div><button className="link-button compact-button glass-button glass-button--secondary" type="button" onClick={onClose}>Close</button></div><div className="pm-view-grid"><PmValue label="Status" value={task.status}/><PmValue label="Interval" value={`${task.intervalLabel} · every ${task.intervalValue.toLocaleString()}`}/><PmValue label="Last completed" value={meter?formatMeter(task.lastCompletedMeter):formatDate(task.lastCompletedDate)}/><PmValue label="Current meter" value={meter?formatMeter(task.currentMeter):'Not applicable'}/><PmValue label="Next due" value={meter?formatMeter(task.nextDueMeter):formatDate(task.nextDueDate)}/><PmValue label="Assigned to" value={task.assignedTo||'Unassigned'}/></div>{task.instructions&&<div className="pm-prose glass-card glass-card--nested"><span>Instructions</span><p>{task.instructions}</p></div>}{task.notes&&<div className="pm-prose glass-card glass-card--nested"><span>Notes</span><p>{task.notes}</p></div>}<div className="modal-actions glass-modal__actions"><button className="secondary-button glass-button glass-button--secondary" type="button" onClick={onClose}>Close</button></div></section></div>,document.body);
}
function PmValue({label,value}:{label:string;value:string}){return <div className="pm-value glass-card glass-card--nested"><span>{label}</span><strong>{value}</strong></div>;}

function PmCompleteModal({task,onClose,onSaved}:{task:PmTask;onClose:()=>void;onSaved:()=>void}) {
  const meter=meterIntervals.has(task.intervalType);const [date,setDate]=useState(localIsoDate(new Date()));const [completedMeter,setCompletedMeter]=useState(task.currentMeter===null?'':String(task.currentMeter));const [notes,setNotes]=useState('');const [saving,setSaving]=useState(false);const [error,setError]=useState('');
  async function submit(event:FormEvent){event.preventDefault();setSaving(true);setError('');try{await requestJson(`/api/machine-library/preventive-maintenance/${task.id}/complete`,{method:'POST',body:JSON.stringify({completionDate:date,completedMeter:completedMeter===''?null:Number(completedMeter),completionNotes:notes})});onSaved();}catch(value){setError((value as Error).message||'PM completion could not be saved.');}finally{setSaving(false);}}
  return createPortal(<div className="modal-backdrop glass-modal-backdrop" role="presentation"><section className="mcc-card glass-modal-shell pm-modal pm-complete-modal" role="dialog" aria-modal="true" aria-labelledby="pm-complete-title"><form onSubmit={submit}><div className="modal-heading"><div><p className="eyebrow">Immutable completion history</p><h3 id="pm-complete-title">Mark {task.title} Complete</h3></div><button className="link-button compact-button glass-button glass-button--secondary" type="button" onClick={onClose} disabled={saving}>Close</button></div><div className="pm-form-grid"><MccDateInput label="Completion Date *" value={date} onChange={setDate} required />{meter&&<label className="form-field"><span>Completed Meter *</span><input className="glass-input" type="number" min="0" step="0.01" value={completedMeter} onChange={e=>setCompletedMeter(e.target.value)} required /></label>}<label className="form-field pm-form-wide"><span>Completion Notes</span><textarea className="glass-input" rows={4} maxLength={12000} value={notes} onChange={e=>setNotes(e.target.value)} /></label></div><p className="pm-history-notice">Saving creates a permanent completion record and advances the next due value.</p>{error&&<p className="form-message error">{error}</p>}<div className="modal-actions glass-modal__actions"><button className="secondary-button glass-button glass-button--secondary" type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary-button glass-button glass-button--success" type="submit" disabled={saving}>{saving?'Saving completion...':'Mark Complete'}</button></div></form></section></div>,document.body);
}

function PmHistoryModal({task,onClose}:{task:PmTask;onClose:()=>void}) {
  const [history,setHistory]=useState<PmHistory[]>([]);const [loading,setLoading]=useState(true);const [error,setError]=useState('');
  useEffect(()=>{void requestJson<{history:PmHistory[]}>(`/api/machine-library/preventive-maintenance/${task.id}/history`).then(data=>setHistory(data.history)).catch(value=>setError((value as Error).message||'History could not be loaded.')).finally(()=>setLoading(false));},[task.id]);
  return createPortal(<div className="modal-backdrop glass-modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}><section className="mcc-card glass-modal-shell pm-modal pm-history-modal" role="dialog" aria-modal="true" aria-labelledby="pm-history-title"><div className="modal-heading"><div><p className="eyebrow">Immutable completion history</p><h3 id="pm-history-title">{task.title}</h3></div><button className="link-button compact-button glass-button glass-button--secondary" type="button" onClick={onClose}>Close</button></div>{error&&<p className="form-message error">{error}</p>}{loading&&<div className="glass-empty-state">Loading completion history...</div>}{!loading&&!history.length&&<div className="glass-empty-state">No completions have been recorded.</div>}{history.length>0&&<div className="pm-history-list glass-card--dense">{history.map(item=><article className="pm-history-entry" key={item.id}><div><strong>{formatDate(item.completionDate)}</strong><span>Performed by {item.performedBy}</span></div><div className="pm-history-due"><span>Meter: {formatMeter(item.completedMeter)}</span><span>Previous due: {item.previousDueDate?formatDate(item.previousDueDate):formatMeter(item.previousDueMeter)}</span><span>Next due: {item.nextDueDate?formatDate(item.nextDueDate):formatMeter(item.nextDueMeter)}</span></div>{item.completionNotes&&<p>{item.completionNotes}</p>}</article>)}</div>}<div className="modal-actions glass-modal__actions"><button className="secondary-button glass-button glass-button--secondary" type="button" onClick={onClose}>Close</button></div></section></div>,document.body);
}
