import { FormEvent, useEffect, useMemo, useState } from 'react';

type Mit3Status = {
  ok: boolean;
  mit3Url: string;
  healthUrl: string;
  message: string;
};

type InventoryPart = {
  id: string;
  itemId: string;
  partNumber: string;
  description: string;
  location: string;
  vendor: string;
  quantity: number;
  minQuantity: number;
  status: string;
  requisition: string;
  orderPlaced: boolean;
  hasActiveRequisitionRecord: boolean;
  partInfoUrl: string;
  updatedAt: string;
};

type LookupOption = {
  id: string;
  name: string;
};

type PartsResponse = {
  ok: boolean;
  mit3Url: string;
  writeAvailable?: boolean;
  parts: InventoryPart[];
  locations?: LookupOption[];
  vendors?: LookupOption[];
};

type FilterMode = 'all' | 'low' | 'requisition' | 'hasLink' | 'noLink';
type ModalMode = 'add' | 'edit';
type Notice = { kind: 'success' | 'error'; text: string };
type SortKey = 'partNumber' | 'description' | 'location' | 'vendor' | 'quantity' | 'minQuantity' | 'status';
type SortDirection = 'asc' | 'desc';
type PageSize = 50 | 100 | 250 | 'all';

type PartForm = {
  partNumber: string;
  description: string;
  location: string;
  vendor: string;
  quantity: string;
  minQuantity: string;
  partInfoUrl: string;
};

const blankForm: PartForm = {
  partNumber: '',
  description: '',
  location: '',
  vendor: '',
  quantity: '0',
  minQuantity: '0',
  partInfoUrl: '',
};

const writeRoles = new Set(['Admin','Manager','Maintenance Tech 3','Maintenance Tech 2']);
const pageSizeOptions: PageSize[] = [50,100,250,'all'];

async function api<T>(path:string, options:RequestInit={}): Promise<T> {
  const res=await fetch(path,{credentials:'include',headers:{'Content-Type':'application/json',...(options.headers??{})},...options});
  const data=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error || 'Request failed.');
  return data as T;
}

function isLowStock(part: InventoryPart) {
  return part.status === 'Low Stock' || part.status === 'Out of Stock';
}

function safeHttpUrl(value: string) {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

function validUrl(value: string) {
  return Boolean(safeHttpUrl(value));
}

function formatRefreshTime(value: Date | null) {
  if (!value) return 'Not refreshed yet';
  return new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit',second:'2-digit'}).format(value);
}

function compareText(left: string, right: string) {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
}

function compareParts(left: InventoryPart, right: InventoryPart, sortKey: SortKey, sortDirection: SortDirection) {
  const multiplier = sortDirection === 'asc' ? 1 : -1;
  const result = sortKey === 'quantity' || sortKey === 'minQuantity'
    ? Number(left[sortKey] ?? 0) - Number(right[sortKey] ?? 0)
    : compareText(String(left[sortKey] ?? ''), String(right[sortKey] ?? ''));
  return result * multiplier;
}

function validateForm(form: PartForm) {
  if (!form.partNumber.trim()) return 'Part Number is required.';
  if (!Number.isFinite(Number(form.quantity))) return 'Quantity must be numeric.';
  if (!Number.isFinite(Number(form.minQuantity))) return 'Minimum Quantity must be numeric.';
  if (form.partInfoUrl.trim() && !validUrl(form.partInfoUrl.trim())) return 'Part Info URL must be blank or a valid http/https URL.';
  return '';
}

function formFromPart(part: InventoryPart): PartForm {
  return {
    partNumber: part.partNumber,
    description: part.description,
    location: part.location,
    vendor: part.vendor,
    quantity: String(part.quantity),
    minQuantity: String(part.minQuantity),
    partInfoUrl: part.partInfoUrl,
  };
}

function payloadFromForm(form: PartForm) {
  return {
    partNumber: form.partNumber.trim(),
    description: form.description.trim(),
    location: form.location.trim(),
    vendor: form.vendor.trim(),
    quantity: Number(form.quantity),
    minQuantity: Number(form.minQuantity),
    partInfoUrl: form.partInfoUrl.trim(),
  };
}

export function InventoryPage({ userRole, onBackToDashboard }: { userRole: string; onBackToDashboard: () => void }) {
  const [status,setStatus]=useState<Mit3Status|null>(null);
  const [parts,setParts]=useState<InventoryPart[]>([]);
  const [locations,setLocations]=useState<LookupOption[]>([]);
  const [vendors,setVendors]=useState<LookupOption[]>([]);
  const [writeAvailable,setWriteAvailable]=useState(false);
  const [search,setSearch]=useState('');
  const [filter,setFilter]=useState<FilterMode>('all');
  const [sortKey,setSortKey]=useState<SortKey>('partNumber');
  const [sortDirection,setSortDirection]=useState<SortDirection>('asc');
  const [pageSize,setPageSize]=useState<PageSize>(100);
  const [page,setPage]=useState(1);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState<Notice|null>(null);
  const [loading,setLoading]=useState(true);
  const [lastRefreshed,setLastRefreshed]=useState<Date|null>(null);
  const [modal,setModal]=useState<ModalMode|null>(null);
  const [editingPart,setEditingPart]=useState<InventoryPart|null>(null);
  const [form,setForm]=useState<PartForm>(blankForm);
  const [formError,setFormError]=useState('');
  const [saving,setSaving]=useState(false);
  const [mutatingId,setMutatingId]=useState('');

  const canWrite = writeRoles.has(userRole);

  async function refresh(options: { notify?: boolean } = {}){
    setLoading(true);
    setError('');
    try {
      const nextStatus = await api<Mit3Status>('/api/inventory/mit3-status');
      setStatus(nextStatus);
      const partsResponse = await api<PartsResponse>('/api/inventory/mit3-parts');
      setParts(partsResponse.parts ?? []);
      setLocations(partsResponse.locations ?? []);
      setVendors(partsResponse.vendors ?? []);
      setWriteAvailable(partsResponse.writeAvailable === true);
      const refreshedAt = new Date();
      setLastRefreshed(refreshedAt);
      if (options.notify) setNotice({kind:'success',text:`Inventory refreshed at ${formatRefreshTime(refreshedAt)}.`});
    } catch (err) {
      setParts([]);
      setLocations([]);
      setVendors([]);
      setWriteAvailable(false);
      const message = (err as Error).message;
      setError(message);
      if (options.notify) setNotice({kind:'error',text:message});
    } finally {
      setLoading(false);
    }
  }

  useEffect(()=>{ void refresh(); },[]);

  const isOnline = status?.ok === true && !error;
  const writeEnabled = canWrite && isOnline && writeAvailable;
  const writeDisabledReason = !canWrite
    ? 'View-only access.'
    : !isOnline
      ? 'MIT3 is offline or not reachable. Start MIT3 Website first.'
      : !writeAvailable
        ? 'MIT3 write endpoint not available yet.'
        : '';

  const summary = useMemo(()=>{
    const locationNames = new Set(parts.map(part=>part.location).filter(Boolean));
    const vendorNames = new Set(parts.map(part=>part.vendor).filter(Boolean));
    return {
      total: parts.length,
      low: parts.filter(isLowStock).length,
      requisition: parts.filter(part=>Boolean(part.requisition || part.orderPlaced)).length,
      places: `${locationNames.size} / ${vendorNames.size}`,
    };
  },[parts]);

  const filteredParts = useMemo(()=>{
    const needle = search.trim().toLowerCase();
    return parts.filter(part=>{
      if(filter==='low'&&!isLowStock(part)) return false;
      if(filter==='requisition'&&!part.requisition&&!part.orderPlaced) return false;
      if(filter==='hasLink'&&!safeHttpUrl(part.partInfoUrl)) return false;
      if(filter==='noLink'&&safeHttpUrl(part.partInfoUrl)) return false;
      if(!needle) return true;
      return [part.partNumber,part.description,part.location,part.vendor]
        .some(value=>value.toLowerCase().includes(needle));
    });
  },[filter,parts,search]);

  const sortedParts = useMemo(()=>[...filteredParts].sort((left,right)=>compareParts(left,right,sortKey,sortDirection)),[filteredParts,sortDirection,sortKey]);
  const totalPages = pageSize === 'all' ? 1 : Math.max(1, Math.ceil(sortedParts.length / pageSize));
  const visibleParts = useMemo(()=>{
    if (pageSize === 'all') return sortedParts;
    const start = (page - 1) * pageSize;
    return sortedParts.slice(start, start + pageSize);
  },[page,pageSize,sortedParts]);
  const pageStart = sortedParts.length === 0 ? 0 : pageSize === 'all' ? 1 : (page - 1) * pageSize + 1;
  const pageEnd = pageSize === 'all' ? sortedParts.length : Math.min(page * pageSize, sortedParts.length);
  const filtersActive = filter !== 'all' || search.trim().length > 0;

  useEffect(()=>{ setPage(1); },[filter,pageSize,search,sortDirection,sortKey]);
  useEffect(()=>{ setPage(current=>Math.min(current,totalPages)); },[totalPages]);

  function toggleSort(nextKey: SortKey){
    if (sortKey === nextKey) {
      setSortDirection(current=>current === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(nextKey);
      setSortDirection('asc');
    }
  }

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return '';
    return sortDirection === 'asc' ? 'asc' : 'desc';
  }

  function sortAria(key: SortKey): 'none' | 'ascending' | 'descending' {
    if (sortKey !== key) return 'none';
    return sortDirection === 'asc' ? 'ascending' : 'descending';
  }

  function renderSortHeader(key: SortKey, label: string) {
    const state = sortIndicator(key);
    return (
      <button className={state ? 'sort-header active' : 'sort-header'} type="button" onClick={()=>toggleSort(key)}>
        <span>{label}</span>
        <span className="sort-marker">{state}</span>
      </button>
    );
  }

  function clearFilters(){
    setSearch('');
    setFilter('all');
  }

  function openAdd(){
    if (!writeEnabled) return;
    setModal('add');
    setEditingPart(null);
    setForm(blankForm);
    setFormError('');
    setNotice(null);
  }

  function openEdit(part: InventoryPart){
    if (!writeEnabled) return;
    setModal('edit');
    setEditingPart(part);
    setForm(formFromPart(part));
    setFormError('');
    setNotice(null);
  }

  function closeModal(force = false){
    if (saving && !force) return;
    setModal(null);
    setEditingPart(null);
    setForm(blankForm);
    setFormError('');
  }

  async function submitForm(event: FormEvent){
    event.preventDefault();
    const validation = validateForm(form);
    setFormError(validation);
    if (validation || !modal) return;
    setSaving(true);
    setNotice(null);
    const payload = JSON.stringify(payloadFromForm(form));
    const isEdit = modal === 'edit' && editingPart;
    try {
      await api(isEdit ? `/api/inventory/mit3-parts/${encodeURIComponent(editingPart.id)}` : '/api/inventory/mit3-parts', {
        method: isEdit ? 'PATCH' : 'POST',
        body: payload,
      });
      closeModal(true);
      setNotice({kind:'success',text:isEdit ? 'Inventory part updated through MIT3 API.' : 'Inventory part added through MIT3 API.'});
      await refresh();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function updateRequisition(part: InventoryPart, requisition: boolean){
    if (!writeEnabled || part.hasActiveRequisitionRecord) return;
    const action = requisition ? 'mark this part for requisition' : 'clear the requisition marker for this part';
    if (!window.confirm(`Confirm that you want to ${action} through the MIT3 API.`)) return;
    setMutatingId(part.id);
    setNotice(null);
    try {
      await api(`/api/inventory/mit3-parts/${encodeURIComponent(part.id)}/requisition`, {
        method: 'PATCH',
        body: JSON.stringify({requisition}),
      });
      setNotice({kind:'success',text:'Requisition status updated through MIT3 API.'});
      await refresh();
    } catch (err) {
      setNotice({kind:'error',text:(err as Error).message});
    } finally {
      setMutatingId('');
    }
  }

  return (
    <div className="page-stack inventory-page">
      <div className="inventory-focus-toolbar">
        <button className="secondary-button compact-button inventory-back-button" type="button" onClick={onBackToDashboard}>Back to Command Center</button>
        <div className="inventory-focus-title">
          <p className="eyebrow">Inventory workspace</p>
          <h2>Inventory</h2>
          <div className="inventory-focus-meta">
            <span>Last refreshed: {formatRefreshTime(lastRefreshed)}</span>
            <span>Showing {visibleParts.length} of {sortedParts.length} parts{filtersActive ? ` (${parts.length} loaded)` : ''}</span>
          </div>
        </div>
        <div className="inventory-toolbar-badges">
          <span className={isOnline?'mit3-status-badge online':'mit3-status-badge offline'} aria-live="polite">{isOnline?'MIT3 Online':'MIT3 Offline'}</span>
          {!canWrite&&<span className="view-only-badge">View-only access.</span>}
        </div>
        <div className="inventory-focus-actions">
          {canWrite&&<button className="primary-button" type="button" onClick={openAdd} disabled={!writeEnabled}>Add Part</button>}
          <button className="secondary-button" type="button" onClick={()=>void refresh({notify:true})} disabled={loading}>Refresh Inventory</button>
          <a className="secondary-button action-link" href={status?.mit3Url ?? 'http://localhost:4173'} target="_blank" rel="noreferrer">Open MIT3 Inventory</a>
        </div>
      </div>

      <div className="inventory-bridge-strip">
        <div>
          <span>MIT3 status</span>
          <strong>{status?.message ?? (loading ? 'Checking MIT3...' : 'MIT3 offline or not reachable')}</strong>
        </div>
        <div>
          <span>Safety</span>
          <strong>MIT3 is source of truth. MCC writes through MIT3 API.</strong>
        </div>
        <code className="inventory-url">{status?.mit3Url ?? 'http://localhost:4173'}</code>
        <div className="inventory-bridge-messages">
          {error&&<p className="form-message error">{error}</p>}
          {!isOnline&&<p className="form-message error">Start MIT3 Website first, then refresh this page.</p>}
          {writeDisabledReason&&<p className="form-message error">{writeDisabledReason}</p>}
        </div>
      </div>

      <div className="card-grid inventory-summary-grid">
        <article className="mcc-card"><span>Total Parts</span><strong>{summary.total}</strong><p>Loaded from MIT3 app-data.</p></article>
        <article className="mcc-card"><span>Low Stock / Watch Items</span><strong>{summary.low}</strong><p>Low or out of stock.</p></article>
        <article className="mcc-card"><span>Requisition Items</span><strong>{summary.requisition}</strong><p>Active or marked requisition.</p></article>
        <article className="mcc-card"><span>Locations / Vendors</span><strong>{summary.places}</strong><p>Unique names available.</p></article>
      </div>

      {notice&&<p className={notice.kind==='error'?'form-message inventory-toast error':'form-message inventory-toast'} role="status">{notice.text}</p>}

      <section className="mcc-card inventory-table-card">
        <div className="inventory-toolbar">
          <label className="form-field inventory-search">
            <span>Search inventory</span>
            <input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Part number, description, location, vendor..." />
          </label>
          <div className="inventory-toolbar-actions">
            <div className="segmented-control" aria-label="Inventory filters">
              <button className={filter==='all'?'active':''} onClick={()=>setFilter('all')} type="button">All</button>
              <button className={filter==='low'?'active':''} onClick={()=>setFilter('low')} type="button">Low Stock</button>
              <button className={filter==='requisition'?'active':''} onClick={()=>setFilter('requisition')} type="button">Requisition</button>
              <button className={filter==='hasLink'?'active':''} onClick={()=>setFilter('hasLink')} type="button">Has Link</button>
              <button className={filter==='noLink'?'active':''} onClick={()=>setFilter('noLink')} type="button">No Link</button>
            </div>
            <button className="secondary-button compact-button" type="button" onClick={clearFilters} disabled={!filtersActive}>Clear Filters</button>
          </div>
        </div>

        <div className="inventory-table-meta">
          <div>
            <strong>Showing {visibleParts.length} of {sortedParts.length} parts</strong>
            <span>{sortedParts.length ? `Rows ${pageStart}-${pageEnd}` : 'No rows'}{filtersActive ? `; ${parts.length} loaded from MIT3` : ''}</span>
          </div>
          <div className="inventory-pager">
            <label className="page-size-field">
              <span>Rows</span>
              <select value={String(pageSize)} onChange={event=>setPageSize(event.target.value==='all'?'all':Number(event.target.value) as PageSize)}>
                {pageSizeOptions.map(option=><option key={String(option)} value={String(option)}>{option === 'all' ? 'All' : option}</option>)}
              </select>
            </label>
            <button className="secondary-button compact-button" type="button" onClick={()=>setPage(current=>Math.max(1,current-1))} disabled={page<=1||pageSize==='all'}>Prev</button>
            <span className="page-count">Page {page} of {totalPages}</span>
            <button className="secondary-button compact-button" type="button" onClick={()=>setPage(current=>Math.min(totalPages,current+1))} disabled={page>=totalPages||pageSize==='all'}>Next</button>
          </div>
        </div>

        <div className="table-card inventory-table-wrap">
          <table>
            <thead>
              <tr>
                <th aria-sort={sortAria('partNumber')}>{renderSortHeader('partNumber','Part Number')}</th>
                <th aria-sort={sortAria('description')}>{renderSortHeader('description','Description')}</th>
                <th aria-sort={sortAria('location')}>{renderSortHeader('location','Location')}</th>
                <th aria-sort={sortAria('vendor')}>{renderSortHeader('vendor','Vendor')}</th>
                <th aria-sort={sortAria('quantity')}>{renderSortHeader('quantity','Qty')}</th>
                <th aria-sort={sortAria('minQuantity')}>{renderSortHeader('minQuantity','Min')}</th>
                <th aria-sort={sortAria('status')}>{renderSortHeader('status','Status')}</th>
                <th>Link</th>
                {canWrite&&<th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {visibleParts.map(part=>{
                const partLink = safeHttpUrl(part.partInfoUrl);
                return (
                  <tr key={part.id}>
                    <td>
                      {partLink
                        ? <a className="part-number-link" href={partLink} target="_blank" rel="noreferrer">{part.partNumber || part.itemId || 'Open'}<span aria-hidden="true">-&gt;</span></a>
                      : <span className="plain-part-number">{part.partNumber || part.itemId || '-'}</span>}
                    </td>
                    <td className="inventory-description-cell"><span className="inventory-description-text" title={part.description || undefined}>{part.description || '-'}</span></td>
                    <td>{part.location || '-'}</td>
                    <td>{part.vendor || '-'}</td>
                    <td>{part.quantity}</td>
                    <td>{part.minQuantity}</td>
                    <td><div className="inventory-status-stack"><span className={isLowStock(part)?'status-pill disabled':'status-pill'}>{part.status}</span>{part.requisition&&<span className="requisition-chip">{part.requisition}</span>}</div></td>
                    <td>{partLink?<a className="link-badge" href={partLink} target="_blank" rel="noreferrer">Open</a>:<span className="muted-cell">None</span>}</td>
                    {canWrite&&(
                      <td>
                        <div className="inventory-row-actions">
                          <button className="secondary-button compact-button" type="button" onClick={()=>openEdit(part)} disabled={!writeEnabled}>Edit</button>
                          <label className={part.hasActiveRequisitionRecord?'requisition-toggle disabled':'requisition-toggle'}>
                            <input
                              type="checkbox"
                              checked={Boolean(part.orderPlaced || part.requisition)}
                              disabled={!writeEnabled || part.hasActiveRequisitionRecord || mutatingId===part.id}
                              onChange={event=>void updateRequisition(part,event.target.checked)}
                            />
                            <span>Req</span>
                          </label>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
              {!loading&&sortedParts.length===0&&<tr><td colSpan={canWrite?9:8} className="empty-table-cell">No inventory rows match this view.</td></tr>}
              {loading&&<tr><td colSpan={canWrite?9:8} className="empty-table-cell">Loading MIT3 inventory...</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {modal&&(
        <div className="modal-backdrop" role="presentation" onMouseDown={event=>{ if(event.target===event.currentTarget) closeModal(); }}>
          <form className="mcc-card inventory-modal" onSubmit={submitForm}>
            <div className="modal-heading">
              <div>
                <p className="eyebrow">{modal==='edit'?'Edit Part':'Add Part'}</p>
                <h3>{modal==='edit'?'Edit inventory part':'Add inventory part'}</h3>
              </div>
              <button className="link-button compact-button" type="button" onClick={()=>closeModal()}>Close</button>
            </div>

            <div className="inventory-form-grid">
              <label className="form-field">
                <span>Part Number</span>
                <input value={form.partNumber} onChange={event=>setForm({...form,partNumber:event.target.value})} />
              </label>
              <label className="form-field">
                <span>Description</span>
                <input value={form.description} onChange={event=>setForm({...form,description:event.target.value})} />
              </label>
              <label className="form-field">
                <span>Location</span>
                <input list="mit3-location-options" value={form.location} onChange={event=>setForm({...form,location:event.target.value})} />
              </label>
              <label className="form-field">
                <span>Vendor</span>
                <input list="mit3-vendor-options" value={form.vendor} onChange={event=>setForm({...form,vendor:event.target.value})} />
              </label>
              <label className="form-field">
                <span>Quantity</span>
                <input inputMode="decimal" value={form.quantity} onChange={event=>setForm({...form,quantity:event.target.value})} />
              </label>
              <label className="form-field">
                <span>Minimum Quantity</span>
                <input inputMode="decimal" value={form.minQuantity} onChange={event=>setForm({...form,minQuantity:event.target.value})} />
              </label>
              <label className="form-field inventory-form-wide">
                <span>Part Info URL</span>
                <input value={form.partInfoUrl} onChange={event=>setForm({...form,partInfoUrl:event.target.value})} placeholder="https://..." />
              </label>
            </div>

            <datalist id="mit3-location-options">
              {locations.map(option=><option key={option.id} value={option.name} />)}
            </datalist>
            <datalist id="mit3-vendor-options">
              {vendors.map(option=><option key={option.id} value={option.name} />)}
            </datalist>

            {formError&&<p className="form-message error">{formError}</p>}
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={()=>closeModal()}>Cancel</button>
              <button className="primary-button" type="submit" disabled={saving}>{saving?'Saving...':modal==='edit'?'Save Changes':'Add Part'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
