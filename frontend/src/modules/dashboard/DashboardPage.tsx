import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MccPillCard, MccStatusPill } from '../../components/MccPills';
import { MccSummaryToken, MccSummaryTokenGroup } from '../../components/MccSummaryToken';
import { PmCompleteWorkflowModal } from '../preventive-maintenance/PmWorkflowModals';
import { PmFormModal, PmHistoryModal, type AssetIdentity, type AssetLibraryScope, type PmTask } from '../machine-library/PreventiveMaintenanceTracking';
import { PM_UPDATED_EVENT } from '../machine-library/pmEvents';

type RequisitionSummary = { requestedCount:number;orderedCount:number;receivedCount:number;canceledCount:number;activeCount:number };
export type DashboardRequisitionView = 'active'|'requested'|'ordered';
type DashboardMetric = { view:DashboardRequisitionView;label:string;value:number;note:string;accentColor:string;variant:'info'|'warning'|'brand' };
type PmStatus = 'Due Soon'|'Due Now'|'Past Due';
type PmAlert = {
  id:number;assetId:number;assetNumber:string;assetName:string;brand:string;model:string;serialNumber:string;
  assetLibrary?:'machine'|'equipment';
  title:string;instructions:string;notes:string;intervalType:string;intervalLabel:string;intervalValue:number;
  status:PmStatus;relativeMessage:string;countdown:string;scheduleStatus:'active'|'hold'|'inactive';
  lastCompletedDate:string|null;lastCompletedMeter:number|null;currentMeter:number|null;nextDueDate:string|null;nextDueMeter:number|null;
  historyCount:number;createdAt:string;updatedAt:string;
};

const emptyRequisitionSummary:RequisitionSummary={requestedCount:0,orderedCount:0,receivedCount:0,canceledCount:0,activeCount:0};
const attentionStatuses=new Set<PmStatus>(['Due Soon','Due Now','Past Due']);
const meterIntervals=new Set(['hourly','cycles']);

function formatDate(value:string|null) {
  if(!value)return 'Not set';
  const date=new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())?value:date.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
}
function formatNumber(value:number|null){return value===null?'Not set':value.toLocaleString();}
function intervalSummary(alert:PmAlert) {
  const fixed:Record<string,string>={bi_weekly:'Every 2 weeks',quarterly:'Every 3 months',bi_annual:'Every 6 months',annual:'Every 12 months'};
  if(fixed[alert.intervalType])return fixed[alert.intervalType];
  const units:Record<string,[string,string]>={hourly:['hour','hours'],cycles:['cycle','cycles'],days:['day','days'],weekly:['week','weeks'],monthly:['month','months']};
  const unit=units[alert.intervalType]??['interval','intervals'];
  return `Every ${alert.intervalValue.toLocaleString()} ${Math.abs(alert.intervalValue)===1?unit[0]:unit[1]}`;
}
function dueInformation(alert:PmAlert) {
  if(alert.nextDueDate)return `Due ${formatDate(alert.nextDueDate)}`;
  if(alert.nextDueMeter!==null)return `Due at ${formatNumber(alert.nextDueMeter)} ${alert.intervalType==='hourly'?'hours':'cycles'}`;
  return 'Next due information unavailable';
}
function lastCompletedInformation(alert:PmAlert) {
  const values=[];
  if(alert.lastCompletedDate)values.push(formatDate(alert.lastCompletedDate));
  if(alert.lastCompletedMeter!==null)values.push(`${formatNumber(alert.lastCompletedMeter)} ${alert.intervalType==='hourly'?'hours':'cycles'}`);
  return values.join(' · ')||'No completion recorded';
}
function pmSortDistance(alert:PmAlert) {
  if(meterIntervals.has(alert.intervalType)&&alert.nextDueMeter!==null&&alert.currentMeter!==null)return alert.nextDueMeter-alert.currentMeter;
  if(alert.nextDueDate){const today=new Date().toISOString().slice(0,10);return Date.parse(`${alert.nextDueDate}T12:00:00Z`)-Date.parse(`${today}T12:00:00Z`);}
  return Number.MAX_SAFE_INTEGER;
}
function sortedAttentionAlerts(alerts:PmAlert[]) {
  const rank:Record<PmStatus,number>={'Past Due':0,'Due Now':1,'Due Soon':2};
  return alerts.filter(alert=>attentionStatuses.has(alert.status)&&alert.scheduleStatus==='active')
    .sort((left,right)=>rank[left.status]-rank[right.status]||pmSortDistance(left)-pmSortDistance(right)||left.assetNumber.localeCompare(right.assetNumber,undefined,{numeric:true}));
}
function workOrderFilename(alert:PmAlert) {
  const token=(value:string)=>value.replace(/[^A-Za-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
  return `${token(alert.assetNumber)}_${token(alert.title)}_PM_Work_Order_${new Date().toISOString().slice(0,10)}`;
}

export function DashboardPage({onOpenRequisitions,userFullName='',effectivePermissions=[]}:{onOpenRequisitions:(view:DashboardRequisitionView)=>void;userFullName?:string;effectivePermissions?:string[]}) {
  const [requisitionSummary,setRequisitionSummary]=useState<RequisitionSummary>(emptyRequisitionSummary);
  const [pmAlerts,setPmAlerts]=useState<PmAlert[]>([]);
  const [pmLoading,setPmLoading]=useState(true);
  const [pmError,setPmError]=useState('');
  const [selectedPm,setSelectedPm]=useState<PmAlert|null>(null);
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
      if(sequence===requestSequence.current)setPmAlerts(sortedAttentionAlerts(Array.isArray(data.alerts)?data.alerts:[]));
    }catch(error){if(sequence===requestSequence.current){setPmAlerts([]);setPmError((error as Error).message);}}
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

  const dashboardMetrics=useMemo<DashboardMetric[]>(()=>[
    {view:'active',label:'Active Requisitions',value:requisitionSummary.activeCount,note:'Requested + ordered',accentColor:'#36e5d0',variant:'info'},
    {view:'requested',label:'Requested',value:requisitionSummary.requestedCount,note:'Waiting for order action',accentColor:'#f6be3f',variant:'warning'},
    {view:'ordered',label:'Ordered',value:requisitionSummary.orderedCount,note:'Ordered, not yet received',accentColor:'#7d8cff',variant:'brand'},
  ],[requisitionSummary]);
  function openRequisitions(view:DashboardRequisitionView) {
    if(requisitionNavigationPending.current)return;
    requisitionNavigationPending.current=true;
    onOpenRequisitions(view);
  }
  const counts=useMemo(()=>({dueSoon:pmAlerts.filter(alert=>alert.status==='Due Soon').length,dueNow:pmAlerts.filter(alert=>alert.status==='Due Now').length,pastDue:pmAlerts.filter(alert=>alert.status==='Past Due').length}),[pmAlerts]);

  return <div className="page-stack dashboard-page">
    <div className="dashboard-metric-grid" aria-label="Requisition summary">{dashboardMetrics.map(metric=><DashboardMetricPill key={metric.view} metric={metric} onActivate={()=>openRequisitions(metric.view)}/>)}</div>
    <section className="mcc-card dashboard-pm-panel glass-panel glass-panel--highlight" aria-labelledby="dashboard-pm-title">
      <div className="dashboard-pm-heading"><div><p className="eyebrow">Maintenance attention</p><h2 id="dashboard-pm-title">Preventive Maintenance Due</h2></div>{pmAlerts.length>0&&<MccSummaryTokenGroup className="dashboard-pm-counts"><MccSummaryToken tone="warning">{counts.dueSoon} Due Soon</MccSummaryToken><MccSummaryToken tone="urgent">{counts.dueNow} Due Now</MccSummaryToken><MccSummaryToken tone="danger">{counts.pastDue} Past Due</MccSummaryToken></MccSummaryTokenGroup>}</div>
      {pmLoading&&<p className="dashboard-pm-state">Loading preventive maintenance…</p>}
      {!pmLoading&&pmError&&<div className="dashboard-pm-state error"><span>{pmError}</span><button className="secondary-button compact-button" type="button" onClick={()=>void loadPmAlerts()}>Retry</button></div>}
      {!pmLoading&&!pmError&&!pmAlerts.length&&<p className="dashboard-pm-state success">No preventive maintenance is currently due.</p>}
      {!pmLoading&&!pmError&&pmAlerts.length>0&&<div className="dashboard-pm-grid">{pmAlerts.map(alert=><PmAlertCard key={alert.id} alert={alert} onOpen={()=>setSelectedPm(alert)}/>)}</div>}
    </section>
    {selectedPm&&<PmDetailModal alert={selectedPm} performedBy={userFullName} canEdit={effectivePermissions.includes(`${selectedPm.assetLibrary==='equipment'?'equipment':'machine'}.pm_manage`)} onClose={()=>setSelectedPm(null)} onChanged={async()=>{setSelectedPm(null);await loadPmAlerts();}}/>}
  </div>;
}

function DashboardMetricPill({metric,onActivate}:{metric:DashboardMetric;onActivate:()=>void}) {
  return <MccPillCard className={`dashboard-metric-pill dashboard-metric-pill--${metric.view}`} variant={metric.variant} accentColor={metric.accentColor} onActivate={onActivate} ariaLabel={`${metric.label}: ${metric.value}. Open ${metric.label.toLowerCase()} view`}>
    <span className="dashboard-metric-label">{metric.label}</span>
    <span className="dashboard-metric-value-row"><strong>{metric.value.toLocaleString()}</strong><span className="dashboard-metric-arrow" aria-hidden="true">&rarr;</span></span>
    <span className="dashboard-metric-note">{metric.note}</span>
  </MccPillCard>;
}

function PmAlertCard({alert,onOpen}:{alert:PmAlert;onOpen:()=>void}) {
  const tone=alert.status==='Due Soon'?'warning':'danger';
  const accent=alert.status==='Due Soon'?'#F6BE3F':alert.status==='Due Now'?'#FF8A4C':'#FF4968';
  return <MccPillCard className={`dashboard-pm-alert status-${alert.status.toLowerCase().replace(/\s+/g,'-')}`} variant={tone} accentColor={accent} onActivate={onOpen} ariaLabel={`Open ${alert.title} preventive maintenance details for ${alert.assetNumber}`}>
    <div className="dashboard-pm-top"><div className="dashboard-pm-asset"><strong>{alert.assetNumber}</strong><span>{alert.brand||'Brand unknown'}</span></div><MccStatusPill variant={tone} className="dashboard-pm-status">{alert.status}</MccStatusPill></div>
    <div className="dashboard-pm-task"><strong>{alert.title}</strong><span className={`dashboard-pm-interval${alert.intervalType==='hourly'?' dashboard-pm-interval--hourly':''}`}>{intervalSummary(alert)}</span></div>
    <div className="dashboard-pm-due"><span>{dueInformation(alert)}</span><i aria-hidden="true">·</i><strong>{alert.relativeMessage||alert.countdown}</strong><span className="dashboard-pm-open" aria-hidden="true" title="Open details">&rarr;</span></div>
  </MccPillCard>;
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
