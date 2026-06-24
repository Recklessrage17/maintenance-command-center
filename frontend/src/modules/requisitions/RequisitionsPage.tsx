import { FormEvent, useEffect, useMemo, useState } from 'react';

type RequisitionStatus = 'Requested' | 'Ordered' | 'Received' | 'Canceled';
type StatusFilter = 'All' | RequisitionStatus;
type Notice = { kind: 'success' | 'error'; text: string };

type RequisitionLine = {
  id: number;
  inventoryPartId: number;
  partNumber: string;
  description: string;
  vendorName: string;
  locationName: string;
  quantityRequested: number;
  unitCost: number;
  totalCost: number;
  unitOfMeasure: string;
  itemNumber: string;
  notes: string;
};

type Requisition = {
  id: number;
  requisitionNumber: string;
  inventoryPartId: number;
  partNumber: string;
  description: string;
  vendorName: string;
  locationName: string;
  quantityRequested: number;
  lineCount?: number;
  firstPartNumber?: string;
  firstDescription?: string;
  totalQuantity?: number;
  totalCost?: number;
  vendorSummary?: string;
  locationSummary?: string;
  partNumbers?: string[];
  descriptions?: string[];
  lines?: RequisitionLine[];
  status: RequisitionStatus;
  requestedByName: string;
  requestedAt: string;
  workOrderNumber: string;
  notes: string;
  cancelReason: string;
  deleted: boolean;
  deletedAt: string | null;
};

type Summary = {
  requestedCount: number;
  orderedCount: number;
  receivedCount: number;
  canceledCount: number;
  activeCount: number;
};

type ListResponse = {
  ok: boolean;
  requisitions: Requisition[];
  summary: Summary;
};

type EditForm = {
  quantityRequested: string;
  workOrderNumber: string;
  notes: string;
};
type ReasonAction = {
  kind: 'cancel' | 'delete';
  requisitions: Requisition[];
};

const writeRoles = new Set(['Admin','Manager','Maintenance Tech 3','Maintenance Tech 2']);
const deleteRoles = new Set(['Admin','Manager']);
const filters: StatusFilter[] = ['All','Requested','Ordered','Received','Canceled'];
const emptySummary: Summary = { requestedCount: 0, orderedCount: 0, receivedCount: 0, canceledCount: 0, activeCount: 0 };

async function api<T>(path:string, options:RequestInit={}): Promise<T> {
  const res=await fetch(path,{credentials:'include',headers:{'Content-Type':'application/json',...(options.headers??{})},...options});
  const data=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error || 'Request failed.');
  return data as T;
}

function fileNameFromDisposition(disposition: string | null, fallback: string) {
  const match = disposition?.match(/filename="?([^";]+)"?/i);
  return match?.[1] ?? fallback;
}

async function downloadFile(path:string, fallbackFileName:string) {
  const res = await fetch(path,{credentials:'include'});
  if (!res.ok) {
    const data = await res.json().catch(()=>({}));
    throw new Error(data.error || 'Download failed.');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileNameFromDisposition(res.headers.get('content-disposition'), fallbackFileName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function pdfObjectUrl(path:string) {
  const res = await fetch(path,{credentials:'include'});
  if (!res.ok) {
    const data = await res.json().catch(()=>({}));
    throw new Error(data.error || 'PDF preview failed.');
  }
  return URL.createObjectURL(await res.blob());
}

function requisitionPdfPath(requisition: Requisition, preview = false) {
  return `/api/requisitions/${requisition.id}/pdf${preview ? '?preview=true' : ''}`;
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined,{dateStyle:'short',timeStyle:'short'}).format(date);
}

function formatQuantity(value: number) {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

function requisitionLineCount(requisition: Requisition) {
  return Number(requisition.lineCount ?? requisition.lines?.length ?? 1) || 1;
}

function partNumberSummary(requisition: Requisition) {
  const count = requisitionLineCount(requisition);
  if (count > 1) return `Multiple items (${count})`;
  return requisition.firstPartNumber || requisition.partNumber || '-';
}

function descriptionSummary(requisition: Requisition) {
  const count = requisitionLineCount(requisition);
  const first = requisition.firstDescription || requisition.description || '-';
  return count > 1 ? `${first} + ${count - 1} more` : first;
}

function statusClass(status: RequisitionStatus) {
  return `requisition-status status-${status.toLowerCase()}`;
}

function editFormFromRequisition(requisition: Requisition): EditForm {
  return {
    quantityRequested: String(requisition.quantityRequested),
    workOrderNumber: requisition.workOrderNumber,
    notes: requisition.notes,
  };
}

export function RequisitionsPage({ userRole }: { userRole: string }) {
  const [requisitions,setRequisitions]=useState<Requisition[]>([]);
  const [summary,setSummary]=useState<Summary>(emptySummary);
  const [filter,setFilter]=useState<StatusFilter>('All');
  const [search,setSearch]=useState('');
  const [loading,setLoading]=useState(true);
  const [notice,setNotice]=useState<Notice|null>(null);
  const [busyId,setBusyId]=useState<number|null>(null);
  const [editing,setEditing]=useState<Requisition|null>(null);
  const [editForm,setEditForm]=useState<EditForm>({quantityRequested:'1',workOrderNumber:'',notes:''});
  const [editError,setEditError]=useState('');
  const [saving,setSaving]=useState(false);
  const [showDeleted,setShowDeleted]=useState(false);
  const [previewing,setPreviewing]=useState<Requisition|null>(null);
  const [previewUrl,setPreviewUrl]=useState('');
  const [previewLoading,setPreviewLoading]=useState(false);
  const [previewError,setPreviewError]=useState('');
  const [selectedIds,setSelectedIds]=useState<Set<number>>(()=>new Set());
  const [reasonAction,setReasonAction]=useState<ReasonAction|null>(null);
  const [reasonNote,setReasonNote]=useState('');
  const [reasonError,setReasonError]=useState('');
  const [reasonSaving,setReasonSaving]=useState(false);

  const canWrite = writeRoles.has(userRole);
  const canDelete = deleteRoles.has(userRole);

  async function loadRequisitions(nextFilter = filter, nextShowDeleted = showDeleted) {
    setLoading(true);
    setNotice(null);
    try {
      const params = new URLSearchParams();
      params.set('status', nextFilter === 'All' ? 'all' : nextFilter);
      if (nextShowDeleted) params.set('includeDeleted', 'true');
      const query = `?${params.toString()}`;
      const result = await api<ListResponse>(`/api/requisitions${query}`);
      setRequisitions(result.requisitions ?? []);
      setSummary(result.summary ?? emptySummary);
    } catch (err) {
      setNotice({kind:'error',text:(err as Error).message});
      setRequisitions([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(()=>{ void loadRequisitions(); },[]);
  useEffect(()=>{
    if (!previewing) {
      setPreviewUrl('');
      setPreviewError('');
      setPreviewLoading(false);
      return;
    }
    let disposed = false;
    let objectUrl = '';
    setPreviewUrl('');
    setPreviewError('');
    setPreviewLoading(true);
    pdfObjectUrl(requisitionPdfPath(previewing, true))
      .then(url=>{
        if (disposed) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setPreviewUrl(url);
      })
      .catch(error=>{
        if (!disposed) setPreviewError((error as Error).message);
      })
      .finally(()=>{
        if (!disposed) setPreviewLoading(false);
      });
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  },[previewing]);

  const filteredRequisitions = useMemo(()=>{
    const needle = search.trim().toLowerCase();
    if (!needle) return requisitions;
    return requisitions.filter(requisition=>[
      requisition.requisitionNumber,
      requisition.partNumber,
      requisition.description,
      requisition.vendorName,
      requisition.locationName,
      requisition.workOrderNumber,
      requisition.vendorSummary ?? '',
      requisition.locationSummary ?? '',
      ...(requisition.partNumbers ?? []),
      ...(requisition.descriptions ?? []),
      ...(requisition.lines ?? []).flatMap(line=>[line.partNumber,line.description,line.vendorName,line.locationName,line.itemNumber,line.notes]),
    ].some(value=>value.toLowerCase().includes(needle)));
  },[requisitions,search]);
  const selectedRequisitions = useMemo(()=>requisitions.filter(requisition=>selectedIds.has(requisition.id)&&!requisition.deleted),[requisitions,selectedIds]);
  const selectedCancelable = selectedRequisitions.filter(requisition=>requisition.status==='Requested'||requisition.status==='Ordered');
  const allVisibleSelected = filteredRequisitions.length > 0 && filteredRequisitions.every(requisition=>selectedIds.has(requisition.id));

  function setNextFilter(nextFilter: StatusFilter) {
    setFilter(nextFilter);
    void loadRequisitions(nextFilter, showDeleted);
  }

  function toggleShowDeleted() {
    const next = !showDeleted;
    setShowDeleted(next);
    void loadRequisitions(filter, next);
  }

  function toggleRequisitionSelection(id: number) {
    setSelectedIds(current=>{
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleVisibleSelection() {
    setSelectedIds(current=>{
      const next = new Set(current);
      if (allVisibleSelected) {
        filteredRequisitions.forEach(requisition=>next.delete(requisition.id));
      } else {
        filteredRequisitions.filter(requisition=>!requisition.deleted).forEach(requisition=>next.add(requisition.id));
      }
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function openReasonAction(kind: ReasonAction['kind'], requisitionsForAction: Requisition[]) {
    const actionable = requisitionsForAction.filter(requisition=>!requisition.deleted);
    if (!actionable.length) return;
    setReasonAction({kind,requisitions:actionable});
    setReasonNote('');
    setReasonError('');
    setNotice(null);
  }

  function closeReasonAction(force = false) {
    if (reasonSaving && !force) return;
    setReasonAction(null);
    setReasonNote('');
    setReasonError('');
  }

  async function submitReasonAction(event: FormEvent) {
    event.preventDefault();
    if (!reasonAction) return;
    const reason = reasonNote.trim();
    if (!reason) {
      setReasonError('Reason is required.');
      return;
    }
    const ids = reasonAction.requisitions.map(requisition=>requisition.id);
    setReasonSaving(true);
    setReasonError('');
    try {
      if (reasonAction.kind === 'cancel') {
        if (ids.length === 1) {
          await api(`/api/requisitions/${ids[0]}/status`, {method:'PATCH',body:JSON.stringify({status:'Canceled',cancelReason:reason,reasonNote:reason})});
        } else {
          await api('/api/requisitions/bulk-cancel', {method:'POST',body:JSON.stringify({ids,reasonNote:reason})});
        }
      } else if (ids.length === 1) {
        await api(`/api/requisitions/${ids[0]}`, {method:'DELETE',body:JSON.stringify({reasonNote:reason})});
      } else {
        await api('/api/requisitions/bulk-delete', {method:'POST',body:JSON.stringify({ids,reasonNote:reason})});
      }
      const label = reasonAction.kind === 'cancel' ? 'canceled' : 'deleted';
      setNotice({kind:'success',text:`${ids.length} requisition${ids.length === 1 ? '' : 's'} ${label}.`});
      closeReasonAction(true);
      clearSelection();
      await loadRequisitions(filter, showDeleted);
    } catch (err) {
      setReasonError((err as Error).message);
    } finally {
      setReasonSaving(false);
    }
  }

  async function downloadPdf(requisition: Requisition) {
    if (busyId) return;
    setBusyId(requisition.id);
    setNotice(null);
    try {
      await downloadFile(requisitionPdfPath(requisition), `MCC_Requisition_${requisition.requisitionNumber}.pdf`);
      setNotice({kind:'success',text:`${requisition.requisitionNumber} PDF downloaded.`});
    } catch (err) {
      setNotice({kind:'error',text:(err as Error).message});
    } finally {
      setBusyId(null);
    }
  }

  function openPreview(requisition: Requisition) {
    setPreviewing(requisition);
    setPreviewError('');
    setNotice(null);
  }

  function closePreview() {
    setPreviewing(null);
    setPreviewError('');
  }

  function printPreview() {
    const frame = document.getElementById('requisition-page-preview-frame') as HTMLIFrameElement | null;
    frame?.contentWindow?.focus();
    frame?.contentWindow?.print();
  }

  async function updateStatus(requisition: Requisition, status: Exclude<RequisitionStatus,'Requested'>) {
    if (!canWrite || requisition.deleted || busyId) return;
    if (status === 'Canceled') {
      openReasonAction('cancel',[requisition]);
      return;
    }
    setBusyId(requisition.id);
    setNotice(null);
    try {
      await api(`/api/requisitions/${requisition.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({status}),
      });
      setNotice({kind:'success',text:`${requisition.requisitionNumber} marked ${status}.`});
      await loadRequisitions(filter, showDeleted);
    } catch (err) {
      setNotice({kind:'error',text:(err as Error).message});
    } finally {
      setBusyId(null);
    }
  }

  function openEdit(requisition: Requisition) {
    if (!canWrite || requisition.deleted || requisition.status !== 'Requested') return;
    setEditing(requisition);
    setEditForm(editFormFromRequisition(requisition));
    setEditError('');
    setNotice(null);
  }

  function closeEdit(force = false) {
    if (saving && !force) return;
    setEditing(null);
    setEditError('');
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    const isMultiLine = requisitionLineCount(editing) > 1;
    const quantity = Number(editForm.quantityRequested);
    if (!isMultiLine) {
      if (!Number.isFinite(quantity) || quantity <= 0) {
        setEditError('Qty requested must be a positive number.');
        return;
      }
    }
    setSaving(true);
    setEditError('');
    try {
      await api(`/api/requisitions/${editing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...(isMultiLine ? {} : {quantityRequested: quantity}),
          workOrderNumber: editForm.workOrderNumber,
          notes: editForm.notes,
        }),
      });
      closeEdit(true);
      setNotice({kind:'success',text:`${editing.requisitionNumber} updated.`});
      await loadRequisitions(filter, showDeleted);
    } catch (err) {
      setEditError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function deleteRequisition(requisition: Requisition) {
    if (!canDelete || requisition.deleted || busyId) return;
    openReasonAction('delete',[requisition]);
  }

  return (
    <div className="page-stack requisitions-page">
      <div className="page-heading requisitions-heading">
        <div>
          <p className="eyebrow">MCC requisitions</p>
          <h2>Requisitions</h2>
          <p>Requisitions are managed inside Maintenance Command Center.</p>
        </div>
        {!canWrite&&<span className="view-only-badge">View-only access.</span>}
      </div>

      <div className="card-grid requisition-summary-grid">
        <article className="mcc-card"><span>Requested</span><strong>{summary.requestedCount}</strong><p>Waiting for order action.</p></article>
        <article className="mcc-card"><span>Ordered</span><strong>{summary.orderedCount}</strong><p>Order placed, not received.</p></article>
        <article className="mcc-card"><span>Received</span><strong>{summary.receivedCount}</strong><p>Closed as received.</p></article>
        <article className="mcc-card"><span>Canceled</span><strong>{summary.canceledCount}</strong><p>Closed without order.</p></article>
        <article className="mcc-card"><span>Active</span><strong>{summary.activeCount}</strong><p>Requested plus ordered.</p></article>
      </div>

      {notice&&<p className={notice.kind==='error'?'form-message inventory-toast error':'form-message inventory-toast'} role="status">{notice.text}</p>}

      <section className="mcc-card requisitions-table-card">
        <div className="requisition-toolbar">
          <label className="form-field requisition-search">
            <span>Search requisitions</span>
            <input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Req #, part number, description, vendor, location, WO#..." />
          </label>
          <div className="segmented-control" aria-label="Requisition filters">
            {filters.map(option=><button className={filter===option?'active':''} key={option} type="button" onClick={()=>setNextFilter(option)}>{option}</button>)}
          </div>
          {canDelete&&(
            <label className="show-deleted-toggle">
              <input type="checkbox" checked={showDeleted} onChange={toggleShowDeleted} />
              <span>Show Deleted</span>
            </label>
          )}
        </div>
        <div className="requisition-selection-toolbar">
          <span>Selected: {selectedRequisitions.length}</span>
          <button className="secondary-button compact-button" type="button" onClick={toggleVisibleSelection} disabled={!filteredRequisitions.length}>{allVisibleSelected?'Unselect Visible':'Select Visible'}</button>
          <button className="secondary-button compact-button" type="button" onClick={clearSelection} disabled={!selectedRequisitions.length}>Clear Selection</button>
          {canWrite&&<button className="danger-button compact-button" type="button" onClick={()=>openReasonAction('cancel',selectedCancelable)} disabled={!selectedCancelable.length}>Cancel Selected</button>}
          {canDelete&&<button className="danger-button compact-button" type="button" onClick={()=>openReasonAction('delete',selectedRequisitions)} disabled={!selectedRequisitions.length}>Delete Selected</button>}
        </div>

        <div className="table-card requisitions-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Select</th>
                <th>Req #</th>
                <th>Status</th>
                <th>Part Number</th>
                <th>Description</th>
                <th>Qty</th>
                <th>Vendor</th>
                <th>Location</th>
                <th>WO#</th>
                <th>Requested By</th>
                <th>Requested Date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRequisitions.map(requisition=>(
                <tr className={requisition.deleted?'deleted-row':''} key={requisition.id}>
                  <td>
                    <input className="table-checkbox" type="checkbox" checked={selectedIds.has(requisition.id)} onChange={()=>toggleRequisitionSelection(requisition.id)} disabled={requisition.deleted} aria-label={`Select ${requisition.requisitionNumber}`} />
                  </td>
                  <td><strong className="req-number">{requisition.requisitionNumber}</strong></td>
                  <td><span className={statusClass(requisition.status)}>{requisition.status}</span>{requisition.deleted&&<span className="deleted-chip">Deleted</span>}</td>
                  <td>{partNumberSummary(requisition)}</td>
                  <td className="inventory-description-cell"><span className="inventory-description-text" title={(requisition.descriptions ?? [requisition.description]).filter(Boolean).join(' / ') || undefined}>{descriptionSummary(requisition)}</span></td>
                  <td>{formatQuantity(Number(requisition.totalQuantity ?? requisition.quantityRequested ?? 0))}</td>
                  <td>{requisition.vendorSummary || requisition.vendorName || '-'}</td>
                  <td>{requisition.locationSummary || requisition.locationName || '-'}</td>
                  <td>{requisition.workOrderNumber || '-'}</td>
                  <td>{requisition.requestedByName || '-'}</td>
                  <td>{formatDateTime(requisition.requestedAt)}</td>
                  <td>
                    <div className="requisition-row-actions">
                      <button className="secondary-button compact-button" type="button" onClick={()=>openPreview(requisition)} disabled={busyId===requisition.id}>Preview</button>
                      <button className="secondary-button compact-button" type="button" onClick={()=>void downloadPdf(requisition)} disabled={busyId===requisition.id}>PDF</button>
                      {canWrite&&!requisition.deleted&&requisition.status==='Requested'&&<button className="secondary-button compact-button" type="button" onClick={()=>void updateStatus(requisition,'Ordered')} disabled={busyId===requisition.id}>Mark Ordered</button>}
                      {canWrite&&!requisition.deleted&&(requisition.status==='Requested'||requisition.status==='Ordered')&&<button className="secondary-button compact-button" type="button" onClick={()=>void updateStatus(requisition,'Received')} disabled={busyId===requisition.id}>Mark Received</button>}
                      {canWrite&&!requisition.deleted&&(requisition.status==='Requested'||requisition.status==='Ordered')&&<button className="danger-button compact-button" type="button" onClick={()=>openReasonAction('cancel',[requisition])} disabled={busyId===requisition.id}>Cancel</button>}
                      {canWrite&&!requisition.deleted&&requisition.status==='Requested'&&<button className="link-button compact-button" type="button" onClick={()=>openEdit(requisition)} disabled={busyId===requisition.id}>Edit</button>}
                      {canDelete&&!requisition.deleted&&<button className="danger-button compact-button" type="button" onClick={()=>deleteRequisition(requisition)} disabled={busyId===requisition.id}>Delete</button>}
                    </div>
                  </td>
                </tr>
              ))}
              {!loading&&filteredRequisitions.length===0&&<tr><td colSpan={12} className="empty-table-cell">No requisitions match this view.</td></tr>}
              {loading&&<tr><td colSpan={12} className="empty-table-cell">Loading requisitions...</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {reasonAction&&(
        <div className="modal-backdrop" role="presentation" onMouseDown={event=>{ if(event.target===event.currentTarget) closeReasonAction(); }}>
          <form className="mcc-card requisition-modal reason-modal" onSubmit={submitReasonAction}>
            <div className="modal-heading">
              <div>
                <p className="eyebrow">{reasonAction.kind === 'cancel' ? 'Cancel requisition' : 'Delete requisition'}</p>
                <h3>{reasonAction.requisitions.length === 1 ? reasonAction.requisitions[0].requisitionNumber : `${reasonAction.requisitions.length} selected requisitions`}</h3>
              </div>
              <button className="link-button compact-button" type="button" onClick={()=>closeReasonAction()}>Close</button>
            </div>
            <label className="form-field">
              <span>{reasonAction.kind === 'cancel' ? 'Reason for canceling requisition' : 'Reason for deleting requisition'} <b className="required-marker" aria-label="required">*</b></span>
              <textarea value={reasonNote} onChange={event=>setReasonNote(event.target.value)} required autoFocus placeholder="Enter the business reason for this action..." />
            </label>
            <p className="form-help">This note will be written to History Logs for every affected requisition.</p>
            {reasonError&&<p className="form-message error">{reasonError}</p>}
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={()=>closeReasonAction()}>Cancel</button>
              <button className={reasonAction.kind === 'delete' ? 'danger-button' : 'primary-button'} type="submit" disabled={reasonSaving}>{reasonSaving?'Saving...':reasonAction.kind === 'delete'?'Delete / Log Reason':'Cancel / Log Reason'}</button>
            </div>
          </form>
        </div>
      )}

      {editing&&(
        <div className="modal-backdrop" role="presentation" onMouseDown={event=>{ if(event.target===event.currentTarget) closeEdit(); }}>
          <form className="mcc-card requisition-modal" onSubmit={saveEdit}>
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Edit requisition</p>
                <h3>{editing.requisitionNumber}</h3>
              </div>
              <button className="link-button compact-button" type="button" onClick={()=>closeEdit()}>Close</button>
            </div>
            <div className="inventory-form-grid">
              <label className="form-field">
                <span>Qty Requested</span>
                <input inputMode="decimal" value={editForm.quantityRequested} onChange={event=>setEditForm({...editForm,quantityRequested:event.target.value})} disabled={requisitionLineCount(editing) > 1} />
              </label>
              <label className="form-field">
                <span>WO#</span>
                <input value={editForm.workOrderNumber} onChange={event=>setEditForm({...editForm,workOrderNumber:event.target.value})} />
              </label>
              <label className="form-field inventory-form-wide">
                <span>Notes</span>
                <textarea value={editForm.notes} onChange={event=>setEditForm({...editForm,notes:event.target.value})} />
              </label>
            </div>
            {editError&&<p className="form-message error">{editError}</p>}
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={()=>closeEdit()}>Cancel</button>
              <button className="primary-button" type="submit" disabled={saving}>{saving?'Saving...':'Save Changes'}</button>
            </div>
          </form>
        </div>
      )}

      {previewing&&(
        <div className="modal-backdrop" role="presentation" onMouseDown={event=>{ if(event.target===event.currentTarget) closePreview(); }}>
          <div className="mcc-card requisition-preview-modal" role="dialog" aria-modal="true" aria-labelledby="requisition-page-preview-title">
            <div className="modal-heading">
              <div>
                <p className="eyebrow">PDF preview</p>
                <h3 id="requisition-page-preview-title">{previewing.requisitionNumber}</h3>
              </div>
              <button className="link-button compact-button" type="button" onClick={closePreview}>Close</button>
            </div>
            <div className="requisition-preview-summary">
              <strong>{previewing.vendorSummary || previewing.vendorName || 'Unknown Vendor'}</strong>
              <span>{requisitionLineCount(previewing)} line{requisitionLineCount(previewing) === 1 ? '' : 's'} / {previewing.workOrderNumber || 'No WO#'}</span>
            </div>
            {previewLoading&&<div className="requisition-preview-placeholder">Loading PDF preview...</div>}
            {previewError&&<p className="form-message error">{previewError}</p>}
            {previewUrl&&<iframe id="requisition-page-preview-frame" className="requisition-preview-frame" title={`Preview ${previewing.requisitionNumber}`} src={previewUrl} />}
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={printPreview} disabled={!previewUrl}>Print</button>
              <button className="primary-button" type="button" onClick={()=>void downloadPdf(previewing)} disabled={busyId===previewing.id}>Download PDF</button>
              <button className="link-button" type="button" onClick={closePreview}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
