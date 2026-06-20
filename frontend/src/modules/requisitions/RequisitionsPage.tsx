import { FormEvent, useEffect, useMemo, useState } from 'react';

type RequisitionStatus = 'Requested' | 'Ordered' | 'Received' | 'Canceled';
type StatusFilter = 'All' | RequisitionStatus;
type Notice = { kind: 'success' | 'error'; text: string };

type Requisition = {
  id: number;
  requisitionNumber: string;
  inventoryPartId: number;
  partNumber: string;
  description: string;
  vendorName: string;
  locationName: string;
  quantityRequested: number;
  status: RequisitionStatus;
  requestedByName: string;
  requestedAt: string;
  workOrderNumber: string;
  notes: string;
  cancelReason: string;
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

const writeRoles = new Set(['Admin','Manager','Maintenance Tech 3','Maintenance Tech 2']);
const filters: StatusFilter[] = ['All','Requested','Ordered','Received','Canceled'];
const emptySummary: Summary = { requestedCount: 0, orderedCount: 0, receivedCount: 0, canceledCount: 0, activeCount: 0 };

async function api<T>(path:string, options:RequestInit={}): Promise<T> {
  const res=await fetch(path,{credentials:'include',headers:{'Content-Type':'application/json',...(options.headers??{})},...options});
  const data=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error || 'Request failed.');
  return data as T;
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined,{dateStyle:'short',timeStyle:'short'}).format(date);
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

  const canWrite = writeRoles.has(userRole);

  async function loadRequisitions(nextFilter = filter) {
    setLoading(true);
    setNotice(null);
    try {
      const query = nextFilter === 'All' ? '?status=all' : `?status=${encodeURIComponent(nextFilter)}`;
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
    ].some(value=>value.toLowerCase().includes(needle)));
  },[requisitions,search]);

  function setNextFilter(nextFilter: StatusFilter) {
    setFilter(nextFilter);
    void loadRequisitions(nextFilter);
  }

  async function updateStatus(requisition: Requisition, status: Exclude<RequisitionStatus,'Requested'>) {
    if (!canWrite || busyId) return;
    const cancelReason = status === 'Canceled' ? window.prompt('Cancel reason is required.')?.trim() ?? '' : '';
    if (status === 'Canceled' && !cancelReason) return;
    setBusyId(requisition.id);
    setNotice(null);
    try {
      await api(`/api/requisitions/${requisition.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({status,cancelReason}),
      });
      setNotice({kind:'success',text:`${requisition.requisitionNumber} marked ${status}.`});
      await loadRequisitions();
    } catch (err) {
      setNotice({kind:'error',text:(err as Error).message});
    } finally {
      setBusyId(null);
    }
  }

  function openEdit(requisition: Requisition) {
    if (!canWrite || requisition.status !== 'Requested') return;
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
    const quantity = Number(editForm.quantityRequested);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setEditError('Qty requested must be a positive number.');
      return;
    }
    setSaving(true);
    setEditError('');
    try {
      await api(`/api/requisitions/${editing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          quantityRequested: quantity,
          workOrderNumber: editForm.workOrderNumber,
          notes: editForm.notes,
        }),
      });
      closeEdit(true);
      setNotice({kind:'success',text:`${editing.requisitionNumber} updated.`});
      await loadRequisitions();
    } catch (err) {
      setEditError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-stack requisitions-page">
      <div className="page-heading requisitions-heading">
        <div>
          <p className="eyebrow">Native MCC requisitions</p>
          <h2>Requisitions</h2>
          <p>MCC native requisitions live in the MCC database. MIT3 remains backup/reference only.</p>
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
        </div>

        <div className="table-card requisitions-table-wrap">
          <table>
            <thead>
              <tr>
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
                {canWrite&&<th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filteredRequisitions.map(requisition=>(
                <tr key={requisition.id}>
                  <td><strong className="req-number">{requisition.requisitionNumber}</strong></td>
                  <td><span className={statusClass(requisition.status)}>{requisition.status}</span></td>
                  <td>{requisition.partNumber || '-'}</td>
                  <td className="inventory-description-cell"><span className="inventory-description-text" title={requisition.description || undefined}>{requisition.description || '-'}</span></td>
                  <td>{requisition.quantityRequested}</td>
                  <td>{requisition.vendorName || '-'}</td>
                  <td>{requisition.locationName || '-'}</td>
                  <td>{requisition.workOrderNumber || '-'}</td>
                  <td>{requisition.requestedByName || '-'}</td>
                  <td>{formatDateTime(requisition.requestedAt)}</td>
                  {canWrite&&(
                    <td>
                      <div className="requisition-row-actions">
                        {requisition.status==='Requested'&&<button className="secondary-button compact-button" type="button" onClick={()=>void updateStatus(requisition,'Ordered')} disabled={busyId===requisition.id}>Mark Ordered</button>}
                        {(requisition.status==='Requested'||requisition.status==='Ordered')&&<button className="secondary-button compact-button" type="button" onClick={()=>void updateStatus(requisition,'Received')} disabled={busyId===requisition.id}>Mark Received</button>}
                        {(requisition.status==='Requested'||requisition.status==='Ordered')&&<button className="danger-button compact-button" type="button" onClick={()=>void updateStatus(requisition,'Canceled')} disabled={busyId===requisition.id}>Cancel</button>}
                        {requisition.status==='Requested'&&<button className="link-button compact-button" type="button" onClick={()=>openEdit(requisition)} disabled={busyId===requisition.id}>Edit</button>}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {!loading&&filteredRequisitions.length===0&&<tr><td colSpan={canWrite?11:10} className="empty-table-cell">No requisitions match this view.</td></tr>}
              {loading&&<tr><td colSpan={canWrite?11:10} className="empty-table-cell">Loading requisitions...</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

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
                <input inputMode="decimal" value={editForm.quantityRequested} onChange={event=>setEditForm({...editForm,quantityRequested:event.target.value})} />
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
    </div>
  );
}
