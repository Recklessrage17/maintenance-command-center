import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { withJsonRequestDefaults } from '../../apiRequest';
import { MccStatusPill } from '../../components/MccPills';

type StockStatus = 'Out of Stock' | 'Low Stock';
type AttentionPart = {
  id:string; partNumber:string; description:string; quantity:number; minQuantity:number;
  vendor:string; location:string; status:StockStatus;
  workflow:'Needs Action'|'Added to Stage'|'Requisition Added'|'Ordered';
  activeRequisitionNumber:string; requisitionStagingStatus:string; requisitionStagingBatchId:number|null;
};
type AttentionResponse = {items:AttentionPart[];outOfStockCount:number;lowStockCount:number};
type Batch = {id:number;name:string;isGeneral:boolean};

async function api<T>(url:string,init?:RequestInit):Promise<T> {
  const response=await fetch(url,withJsonRequestDefaults({...init,credentials:'include'}));
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||'Inventory Attention is unavailable.');
  return data;
}

export function DashboardInventoryAttention({effectivePermissions}:{effectivePermissions:string[]}) {
  const [data,setData]=useState<AttentionResponse>({items:[],outOfStockCount:0,lowStockCount:0});
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [status,setStatus]=useState<StockStatus|null>(null);
  const [requestPart,setRequestPart]=useState<AttentionPart|null>(null);
  const [quantity,setQuantity]=useState('');
  const [batches,setBatches]=useState<Batch[]>([]);
  const [batchId,setBatchId]=useState('');
  const [saving,setSaving]=useState(false);
  const [notice,setNotice]=useState('');
  const [actionError,setActionError]=useState('');
  const inFlight=useRef<Promise<void>|null>(null);
  const mounted=useRef(true);
  const dialogRef=useRef<HTMLDialogElement>(null);
  const quantityRef=useRef<HTMLInputElement>(null);
  const canStage=effectivePermissions.includes('inventory.requisition_stage');
  const canViewRequisitions=effectivePermissions.includes('requisitions.view');
  const load=useCallback(()=>{
    if(inFlight.current)return inFlight.current;
    const request=api<AttentionResponse>('/api/dashboard/inventory-attention').then(next=>{
      if(mounted.current){setData(next);setError('');}
    }).catch((err:Error)=>{if(mounted.current)setError(err.message);}).finally(()=>{
      inFlight.current=null;if(mounted.current)setLoading(false);
    });
    inFlight.current=request;return request;
  },[]);
  useEffect(()=>{
    mounted.current=true;void load();
    const refresh=()=>{if(document.visibilityState==='visible')void load();};
    window.addEventListener('focus',refresh);
    document.addEventListener('visibilitychange',refresh);
    // Match Inventory's existing refresh cadence, using only the filtered response.
    const timer=window.setInterval(refresh,10_000);
    return()=>{mounted.current=false;window.clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
  },[load]);
  useEffect(()=>{
    if(!status)return;
    const returnFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const dialog=dialogRef.current;dialog?.showModal();
    return()=>{dialog?.close();returnFocus?.focus();};
  },[status]);
  useEffect(()=>{if(requestPart)quantityRef.current?.focus();},[requestPart]);

  function closePrompt(){const partId=requestPart?.id;setRequestPart(null);setActionError('');window.requestAnimationFrame(()=>{const button=dialogRef.current?.querySelector<HTMLElement>(`[data-stage-part="${partId}"]`)??dialogRef.current?.querySelector<HTMLElement>('button');button?.focus();});}
  async function requestQuantity(part:AttentionPart) {
    setRequestPart(part);setQuantity(String(Math.max(part.minQuantity-part.quantity,1)));
    setActionError('');setNotice('');setBatches([]);setBatchId('');
    if(canViewRequisitions){
      try{const result=await api<{batches:Batch[]}>('/api/requisition-batches?view=active');setBatches(result.batches);setBatchId(String((result.batches.find(batch=>batch.isGeneral)??result.batches[0])?.id??''));}
      catch(err){setActionError((err as Error).message);}
    }
  }
  async function submit(event:FormEvent) {
    event.preventDefault();if(!requestPart||saving)return;
    const value=Number(quantity);
    if(!quantity.trim()||!Number.isFinite(value)||value<=0){setActionError('Requested quantity must be a positive number.');return;}
    setSaving(true);setActionError('');
    try{
      await api('/api/requisition-staging/bulk',{method:'POST',body:JSON.stringify({...(batchId?{batchId:Number(batchId)}:{}),dashboardAttention:true,items:[{inventoryPartId:Number(requestPart.id),quantityRequested:value}]})});
      setNotice(`${requestPart.partNumber} added to Requisition Staging.`);closePrompt();
      // Wait out a pre-mutation refresh before requesting the committed state.
      await inFlight.current;await load();
    }catch(err){setActionError((err as Error).message);await inFlight.current;await load();}
    finally{setSaving(false);}
  }
  return <section className="mcc-card dashboard-inventory-attention" aria-labelledby="dashboard-inventory-title">
    <h2 id="dashboard-inventory-title">Inventory Attention</h2>
    <p>Opt-in stock alerts · refreshes while this dashboard is visible</p>
    {loading?<p role="status">Loading inventory attention…</p>:<div className="dashboard-stock-counters">{(['Out of Stock','Low Stock'] as StockStatus[]).map(label=><button type="button" key={label} className={`dashboard-stock-counter ${label==='Out of Stock'?'is-danger':'is-warning'}`} onClick={()=>{setStatus(label);setNotice('');setActionError('');setRequestPart(null);}} aria-label={`${label}: ${label==='Out of Stock'?data.outOfStockCount:data.lowStockCount}. Open inventory attention`}><span>{label}</span><strong>{label==='Out of Stock'?data.outOfStockCount:data.lowStockCount}</strong></button>)}</div>}
    {!loading&&!error&&data.items.length===0&&<p>No enabled parts need stock attention.</p>}
    {error&&<p role="alert">{error} <button type="button" className="secondary-button" onClick={()=>void load()}>Retry</button></p>}
    {status&&createPortal(<dialog ref={dialogRef} className="mcc-card glass-modal-shell dashboard-stock-dialog" aria-labelledby="dashboard-stock-title" onKeyDown={event=>{
        if(event.key!=='Tab')return;
        const controls=[...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled])')].filter(el=>el.getClientRects().length>0);
        const first=controls[0];const last=controls[controls.length-1];
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
      }} onCancel={event=>{event.preventDefault();if(saving)return;if(requestPart)closePrompt();else setStatus(null);}}>
      <div className="modal-heading"><h2 id="dashboard-stock-title">{status} Inventory</h2><button type="button" className="secondary-button" disabled={saving} onClick={()=>setStatus(null)}>Close</button></div>
      {notice&&<p role="status">{notice}</p>}
      {error&&<p role="alert">{error} Displayed information may be out of date.</p>}
      {requestPart?<form className="dashboard-stock-request" onSubmit={submit} aria-label="Stage inventory part">
        <h3>{requestPart.partNumber}</h3><p>{requestPart.description}</p>
        <label className="form-field"><span>How many do you want to request?</span><input ref={quantityRef} type="number" step="any" min="0" required value={quantity} onChange={event=>setQuantity(event.target.value)} disabled={saving}/></label>
        {canViewRequisitions?<label className="form-field"><span>Requisition Batch</span><select value={batchId} required disabled={saving} onChange={event=>setBatchId(event.target.value)}><option value="">Choose a batch</option>{batches.map(batch=><option key={batch.id} value={batch.id}>{batch.name}</option>)}</select></label>:<p>Destination: General Requisition Batch</p>}
        {actionError&&<p role="alert">{actionError}</p>}
        <div className="modal-actions"><button className="secondary-button" type="button" disabled={saving} onClick={closePrompt}>Cancel</button><button className="primary-button" type="submit" disabled={saving||(canViewRequisitions&&!batchId)}>{saving?'Adding…':'Confirm Add to Stage'}</button></div>
      </form>:<div className="dashboard-stock-list">{data.items.filter(part=>part.status===status).map(part=><article className="dashboard-stock-item" key={part.id}>
        <div><a href={`/inventory?part=${part.id}&search=${encodeURIComponent(part.partNumber)}`}>{part.partNumber}</a><p>{part.description}</p><strong>{part.quantity} on hand / Minimum {part.minQuantity}</strong><p>{part.vendor||'No vendor'} · {part.location||'No location'}</p></div>
        <div className="dashboard-stock-actions"><MccStatusPill variant={part.status==='Out of Stock'?'danger':'warning'}>{part.status}</MccStatusPill><MccStatusPill variant={part.workflow==='Needs Action'?'neutral':'info'}>{part.workflow}</MccStatusPill>
          {part.activeRequisitionNumber&&<span>{part.activeRequisitionNumber}</span>}
          {part.workflow==='Added to Stage'&&<span>{part.requisitionStagingStatus}</span>}
          {part.workflow==='Needs Action'&&canStage&&<button type="button" className="primary-button" data-stage-part={part.id} onClick={()=>void requestQuantity(part)}>Add to Stage</button>}
          {part.workflow==='Added to Stage'&&canViewRequisitions&&<a className="secondary-button" href={`/requisitions?batch=${part.requisitionStagingBatchId}&search=${encodeURIComponent(part.partNumber)}`}>{canStage?'View/Edit Staged Qty':'View staged request'}</a>}
          {part.activeRequisitionNumber&&canViewRequisitions&&<a className="secondary-button" href={`/requisitions?view=active&search=${encodeURIComponent(part.activeRequisitionNumber)}`}>Open requisition</a>}
        </div>
      </article>)}{data.items.every(part=>part.status!==status)&&<p>No enabled {status.toLowerCase()} parts need attention.</p>}</div>}
    </dialog>,document.body)}
  </section>;
}
