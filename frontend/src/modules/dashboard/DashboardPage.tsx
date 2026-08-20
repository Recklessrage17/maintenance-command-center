import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PmCompleteWorkflowModal } from '../preventive-maintenance/PmWorkflowModals';
import { PmFormModal, PmHistoryModal, type AssetIdentity, type AssetLibraryScope, type PmTask } from '../machine-library/PreventiveMaintenanceTracking';
import { PM_UPDATED_EVENT } from '../machine-library/pmEvents';
import { DashboardRequisitionSummary, type DashboardRequisitionView } from './DashboardRequisitionSummary';
import { dueInformation, intervalSummary, PmAttentionSection } from './DashboardPmAttention';
import { relativeNoteAge, sortedAttentionAlerts, type PmAlert, type PmAssetGroup, type WarningNote } from './dashboardPm';

type RequisitionSummary = { requestedCount:number;orderedCount:number;receivedCount:number;canceledCount:number;activeCount:number };
export type { DashboardRequisitionView } from './DashboardRequisitionSummary';

const emptyRequisitionSummary:RequisitionSummary={requestedCount:0,orderedCount:0,receivedCount:0,canceledCount:0,activeCount:0};

function formatDate(value:string|null) {
  if(!value)return 'Not set';
  const date=new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())?value:date.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
}
function formatNumber(value:number|null){return value===null?'Not set':value.toLocaleString();}
function lastCompletedInformation(alert:PmAlert) {
  const values=[];
  if(alert.lastCompletedDate)values.push(formatDate(alert.lastCompletedDate));
  if(alert.lastCompletedMeter!==null)values.push(`${formatNumber(alert.lastCompletedMeter)} ${alert.intervalType==='hourly'?'hours':'cycles'}`);
  return values.join(' · ')||'No completion recorded';
}
function workOrderFilename(alert:PmAlert) {
  const token=(value:string)=>value.replace(/[^A-Za-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
  return `${token(alert.assetNumber)}_${token(alert.title)}_PM_Work_Order_${new Date().toISOString().slice(0,10)}`;
}

export function DashboardPage({onOpenRequisitions,userFullName='',effectivePermissions=[]}:{onOpenRequisitions:(view:DashboardRequisitionView)=>void;userFullName?:string;effectivePermissions?:string[]}) {
  const [requisitionSummary,setRequisitionSummary]=useState<RequisitionSummary>(emptyRequisitionSummary);
  const [pmAlerts,setPmAlerts]=useState<PmAlert[]>([]);
  const [warningNotes,setWarningNotes]=useState<WarningNote[]>([]);
  const [pmLoading,setPmLoading]=useState(true);
  const [pmError,setPmError]=useState('');
  const [selectedPm,setSelectedPm]=useState<PmAlert|null>(null);
  const [selectedWarningGroup,setSelectedWarningGroup]=useState<PmAssetGroup|null>(null);
  const requestSequence=useRef(0);
  const requisitionNavigationPending=useRef(false);

  const loadRequisitionSummary=useCallback(async()=>{
    try{
      const response=await fetch('/api/requisitions/summary',{credentials:'include'});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error('Summary unavailable');
      setRequisitionSummary({requestedCount:Number(data.requestedCount??0),orderedCount:Number(data.orderedCount??0),receivedCount:Number(data.receivedCount??0),canceledCount:Number(data.canceledCount??0),activeCount:Number(data.activeCount??0)});
    }catch{setRequisitionSummary(emptyRequisitionSummary);}
  },[]);

  const loadPmAlerts=useCallback(async()=>{
    const sequence=++requestSequence.current;
    setPmLoading(true);setPmError('');
    try{
      const response=await fetch('/api/dashboard/preventive-maintenance-due',{credentials:'include'});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.error||'Preventive maintenance alerts are unavailable.');
      if(sequence===requestSequence.current){setPmAlerts(sortedAttentionAlerts(Array.isArray(data.alerts)?data.alerts:[]));setWarningNotes(Array.isArray(data.warningNotes)?data.warningNotes:[]);}
    }catch(error){if(sequence===requestSequence.current){setPmAlerts([]);setWarningNotes([]);setPmError((error as Error).message);}}
    finally{if(sequence===requestSequence.current)setPmLoading(false);}
  },[]);

  useEffect(()=>{
    void loadRequisitionSummary();
    const refresh=()=>void loadRequisitionSummary();
    const refreshWhenVisible=()=>{if(document.visibilityState==='visible')refresh();};
    window.addEventListener('focus',refresh);
    document.addEventListener('visibilitychange',refreshWhenVisible);
    return()=>{window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refreshWhenVisible);};
  },[loadRequisitionSummary]);
  useEffect(()=>{
    void loadPmAlerts();
    const refresh=()=>void loadPmAlerts();
    const refreshWhenVisible=()=>{if(document.visibilityState==='visible')refresh();};
    window.addEventListener(PM_UPDATED_EVENT,refresh);
    window.addEventListener('focus',refresh);
    document.addEventListener('visibilitychange',refreshWhenVisible);
    return()=>{window.removeEventListener(PM_UPDATED_EVENT,refresh);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refreshWhenVisible);};
  },[loadPmAlerts]);

  function openRequisitions(view:DashboardRequisitionView) {
    if(requisitionNavigationPending.current)return;
    requisitionNavigationPending.current=true;
    onOpenRequisitions(view);
  }
  return <div className="page-stack dashboard-page">
    <DashboardRequisitionSummary activeCount={requisitionSummary.activeCount} requestedCount={requisitionSummary.requestedCount} orderedCount={requisitionSummary.orderedCount} onOpen={openRequisitions}/>
    <section className="mcc-card dashboard-pm-panel glass-panel glass-panel--highlight" aria-labelledby="dashboard-pm-title">
      <div className="dashboard-pm-heading"><div><p className="eyebrow">Preventive maintenance</p><h2 id="dashboard-pm-title">Maintenance Attention</h2><p>Urgent schedules grouped by asset and library.</p></div></div>
      {pmLoading&&<p className="dashboard-pm-state">Loading preventive maintenance…</p>}
      {!pmLoading&&pmError&&<div className="dashboard-pm-state error"><span>{pmError}</span><button className="secondary-button compact-button" type="button" onClick={()=>void loadPmAlerts()}>Retry</button></div>}
      {!pmLoading&&!pmError&&<div className="dashboard-pm-sections"><PmAttentionSection library="machine" title="Machine PM Attention" description="Machine Library preventive maintenance requiring action." alerts={pmAlerts} warningNotes={warningNotes} onOpenTask={setSelectedPm} onOpenWarnings={setSelectedWarningGroup}/><PmAttentionSection library="equipment" title="Equipment PM Attention" description="Equipment Library preventive maintenance requiring action." alerts={pmAlerts} warningNotes={warningNotes} onOpenTask={setSelectedPm} onOpenWarnings={setSelectedWarningGroup}/></div>}
    </section>
    {selectedPm&&<PmDetailModal alert={selectedPm} performedBy={userFullName} canEdit={effectivePermissions.includes(`${selectedPm.assetLibrary==='equipment'?'equipment':'machine'}.pm_manage`)} onClose={()=>setSelectedPm(null)} onChanged={async()=>{setSelectedPm(null);await loadPmAlerts();}}/>}
    {selectedWarningGroup&&<WarningNoteViewer group={selectedWarningGroup} onClose={()=>setSelectedWarningGroup(null)}/>}
  </div>;
}

function WarningNoteViewer({group,onClose}:{group:PmAssetGroup;onClose:()=>void}) {
  const [expandedId,setExpandedId]=useState<number|null>(null);
  const dialogRef=useRef<HTMLElement>(null);
  useEffect(()=>{
    const returnFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const dialog=dialogRef.current;dialog?.querySelector<HTMLElement>('button')?.focus();
    const handleKeyDown=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();onClose();return;}
      if(event.key!=='Tab'||!dialog)return;
      const focusable=[...dialog.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(item=>item.offsetParent!==null);
      if(!focusable.length)return;const first=focusable[0];const last=focusable[focusable.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    };
    document.addEventListener('keydown',handleKeyDown);
    return()=>{document.removeEventListener('keydown',handleKeyDown);returnFocus?.focus();};
  },[onClose]);
  const assetLabel=`${group.assetNumber}${group.assetName?` · ${group.assetName}`:''}`;
  return createPortal(<div className="modal-backdrop glass-modal-backdrop dashboard-tech-note-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}><section ref={dialogRef} className="mcc-card glass-modal-shell dashboard-tech-note-viewer" role="dialog" aria-modal="true" aria-labelledby={`dashboard-tech-note-title-${group.library}-${group.assetId}`}>
    <div className="modal-heading"><div><p className="eyebrow">Warning / Needs Attention</p><h2 id={`dashboard-tech-note-title-${group.library}-${group.assetId}`}>Tech Notes for {group.assetNumber}</h2><p>{assetLabel} · {group.brand||'Brand / manufacturer not set'}</p></div><button className="link-button compact-button" type="button" onClick={onClose}>Close</button></div>
    <div className="dashboard-tech-note-list">{group.warningNotes.map(note=>{const expanded=expandedId===note.id;const panelId=`dashboard-tech-note-body-${note.assetLibrary}-${note.id}`;return <article className={`dashboard-tech-note-row${expanded?' is-expanded':''}`} key={`${note.assetLibrary}:${note.id}`}>
      <button className="dashboard-tech-note-toggle" type="button" aria-expanded={expanded} aria-controls={panelId} onClick={()=>setExpandedId(current=>current===note.id?null:note.id)}><span className="dashboard-tech-note-warning-icon" aria-hidden="true">!</span><span className="dashboard-tech-note-copy"><strong>{note.title}</strong><span className="dashboard-tech-note-metadata"><span className="dashboard-tech-note-meta-line"><span className="dashboard-tech-note-meta-label">Date</span><time dateTime={note.noteDate}>{formatDate(note.noteDate)}</time></span><span className="dashboard-tech-note-meta-line dashboard-tech-note-meta-age"><span className="dashboard-tech-note-meta-label">Date age</span><span>{relativeNoteAge(note.noteDate,note.createdAt)}</span></span><span className="dashboard-tech-note-meta-line"><span className="dashboard-tech-note-meta-label">Technician</span><span>{note.createdBy}</span></span></span></span><span className="dashboard-tech-note-expand" aria-hidden="true">{expanded?'−':'+'}</span></button>
      <div id={panelId} className="dashboard-tech-note-body" hidden={!expanded}><p>{note.body}</p><div className="dashboard-tech-note-actions"><button className="secondary-button compact-button" type="button" onClick={()=>window.open(note.pdfUrl,'_blank','noopener,noreferrer')}>Print / PDF</button><a className="link-button compact-button" href={`/${note.assetLibrary}-library?asset=${note.assetId}`}>Open full asset detail</a></div></div>
    </article>;})}</div>
    <div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Close</button></div>
  </section></div>,document.body);
}

function dashboardTask(alert:PmAlert):PmTask{return {...alert,intervalType:alert.intervalType as PmTask['intervalType'],status:alert.status,scheduleStatus:alert.scheduleStatus};}
function dashboardAsset(alert:PmAlert):AssetIdentity{return {id:alert.assetId,assetNumber:alert.assetNumber,assetName:alert.assetName,brand:alert.brand};}

function PmDetailModal({alert,performedBy,canEdit,onClose,onChanged}:{alert:PmAlert;performedBy:string;canEdit:boolean;onClose:()=>void;onChanged:()=>void|Promise<void>}) {
  const [workflow,setWorkflow]=useState<'edit'|'complete'|'history'|null>(null);const library:AssetLibraryScope=alert.assetLibrary==='equipment'?'equipment':'machine';const task=dashboardTask(alert);const asset=dashboardAsset(alert);const apiBase=`/api/${library}-library`;
  useEffect(()=>{const close=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose();};document.addEventListener('keydown',close);return()=>document.removeEventListener('keydown',close);},[onClose]);
  function printWorkOrder(){const previous=document.title;const next=workOrderFilename(alert);const restore=()=>{document.title=previous;};document.title=next;window.addEventListener('afterprint',restore,{once:true});window.print();window.setTimeout(restore,1000);}
  return <>{createPortal(<div className="modal-backdrop glass-modal-backdrop dashboard-pm-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}>
    <section className="mcc-card dashboard-pm-detail glass-modal-shell" role="dialog" aria-modal="true" aria-labelledby={`dashboard-pm-detail-${alert.id}`}>
      <div className="modal-heading"><div><p className="eyebrow">Preventive Maintenance</p><h2 id={`dashboard-pm-detail-${alert.id}`}>{alert.title}</h2><p>{alert.assetNumber} · {alert.brand||'Brand unknown'}</p></div><button className="link-button compact-button" type="button" onClick={onClose}>Close</button></div>
      <div className="dashboard-pm-detail-grid">
        <Detail label="Asset" value={`${alert.assetNumber}${alert.assetName?` · ${alert.assetName}`:''}`}/><Detail label="Brand" value={alert.brand||'Not set'}/><Detail label="Interval" value={intervalSummary(alert)} className={alert.intervalType==='hourly'?'dashboard-pm-detail-item--hourly':''}/><Detail label="Status" value={`${alert.status} · ${alert.relativeMessage||alert.countdown}`}/><Detail label="Last Completed" value={lastCompletedInformation(alert)}/><Detail label="Current Meter / Cycles" value={alert.currentMeter===null?'Not set':formatNumber(alert.currentMeter)}/><Detail label="Next Due" value={dueInformation(alert)}/>
      </div>
      <section className="dashboard-pm-copy"><h3>Instructions</h3><p>{alert.instructions||'No instructions provided.'}</p></section>
      <section className="dashboard-pm-copy"><h3>Notes</h3><p>{alert.notes||'No notes provided.'}</p></section>
      <div className="modal-actions dashboard-pm-actions"><button className="secondary-button" type="button" onClick={onClose}>Close</button><button className="secondary-button" type="button" onClick={()=>setWorkflow('history')}>View History</button>{canEdit&&<button className="secondary-button glass-button glass-button--warning" type="button" onClick={()=>setWorkflow('edit')}>Edit PM</button>}{canEdit&&<button className="primary-button glass-button glass-button--success" type="button" onClick={()=>setWorkflow('complete')}>Complete PM</button>}<button className="secondary-button dashboard-pm-print-button" type="button" onClick={printWorkOrder}>Print / Save PDF</button></div>
      <PmWorkOrder alert={alert}/>
    </section>
  </div>,document.body)}{workflow==='edit'?<PmFormModal asset={asset} task={task} apiBase={apiBase} onClose={()=>setWorkflow(null)} onSaved={onChanged}/>:workflow==='complete'?<PmCompleteWorkflowModal asset={asset} task={task} library={library} performedBy={performedBy} onClose={()=>setWorkflow(null)} onSaved={onChanged}/>:workflow==='history'?<PmHistoryModal task={task} apiBase={apiBase} onClose={()=>setWorkflow(null)}/>:null}</>;
}

function Detail({label,value,className=''}:{label:string;value:string;className?:string}){return <div className={`dashboard-pm-detail-item${className?` ${className}`:''}`}><span>{label}</span><strong>{value}</strong></div>;}

function PmWorkOrder({alert}:{alert:PmAlert}) {
  return <article className="pm-work-order-print" aria-label="Preventive Maintenance Work Order">
    <header><p>MAINTENANCE WORK ORDER</p><h1>Preventive Maintenance Work Order</h1></header>
    <div className="pm-work-order-number">WO #: ______________________________</div>
    <section><h2>Asset Information</h2><div className="pm-work-order-grid"><p><span>Asset # / Name</span><strong>{alert.assetNumber}{alert.assetName?` / ${alert.assetName}`:''}</strong></p><p><span>Brand</span><strong>{alert.brand||'Not set'}</strong></p><p><span>Model</span><strong>{alert.model||'Not set'}</strong></p><p><span>Serial #</span><strong>{alert.serialNumber||'Not set'}</strong></p></div></section>
    <section><h2>Preventive Maintenance</h2><div className="pm-work-order-grid"><p><span>PM Title</span><strong>{alert.title}</strong></p><p><span>Interval</span><strong>{intervalSummary(alert)}</strong></p><p><span>Status</span><strong>{alert.status} · {alert.relativeMessage||alert.countdown}</strong></p><p><span>Generated</span><strong>{new Date().toLocaleDateString()}</strong></p><p><span>Last Completed</span><strong>{lastCompletedInformation(alert)}</strong></p><p><span>Next Due</span><strong>{dueInformation(alert)}</strong></p></div></section>
    <section><h2>Instructions</h2><p className="pm-work-order-copy">{alert.instructions||'No instructions provided.'}</p></section>
    <section><h2>Notes</h2><p className="pm-work-order-copy">{alert.notes||'No notes provided.'}</p></section>
    <section className="pm-work-order-completion"><h2>Completion Record</h2><p>Performed By: ______________________________</p><p>Date Completed: ____________________________</p><p>Hours / Meter / Cycles at Completion:</p><p>___________________________________________</p><p>Technician Notes:</p><p>___________________________________________</p><p>___________________________________________</p><p>___________________________________________</p><p>Signature: _________________________________</p></section>
  </article>;
}
