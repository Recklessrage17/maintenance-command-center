import { useEffect, useMemo, useState } from 'react';

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
  partInfoUrl: string;
  updatedAt: string;
};

type PartsResponse = {
  ok: boolean;
  mit3Url: string;
  parts: InventoryPart[];
};

type FilterMode = 'all' | 'low' | 'requisition';

async function api<T>(path:string): Promise<T> {
  const res=await fetch(path,{credentials:'include'});
  const data=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error || 'Request failed.');
  return data as T;
}

function isLowStock(part: InventoryPart) {
  return part.status === 'Low Stock' || part.status === 'Out of Stock';
}

function validUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function InventoryPage() {
  const [status,setStatus]=useState<Mit3Status|null>(null);
  const [parts,setParts]=useState<InventoryPart[]>([]);
  const [search,setSearch]=useState('');
  const [filter,setFilter]=useState<FilterMode>('all');
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);

  async function refresh(){
    setLoading(true);
    setError('');
    try {
      const nextStatus = await api<Mit3Status>('/api/inventory/mit3-status');
      setStatus(nextStatus);
      const partsResponse = await api<PartsResponse>('/api/inventory/mit3-parts');
      setParts(partsResponse.parts);
    } catch (err) {
      setParts([]);
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(()=>{ void refresh(); },[]);

  const isOnline = status?.ok === true && !error;
  const summary = useMemo(()=>{
    const locations = new Set(parts.map(part=>part.location).filter(Boolean));
    const vendors = new Set(parts.map(part=>part.vendor).filter(Boolean));
    return {
      total: parts.length,
      low: parts.filter(isLowStock).length,
      requisition: parts.filter(part=>Boolean(part.requisition)).length,
      places: `${locations.size} / ${vendors.size}`,
    };
  },[parts]);

  const filteredParts = useMemo(()=>{
    const needle = search.trim().toLowerCase();
    return parts.filter(part=>{
      if(filter==='low'&&!isLowStock(part)) return false;
      if(filter==='requisition'&&!part.requisition) return false;
      if(!needle) return true;
      return [part.partNumber,part.description,part.location,part.vendor,part.status,part.requisition]
        .some(value=>value.toLowerCase().includes(needle));
    });
  },[filter,parts,search]);

  return (
    <div className="page-stack inventory-page">
      <div className="page-heading">
        <p className="eyebrow">Inventory</p>
        <h2>Inventory</h2>
        <p>MIT3 inventory read-only view</p>
      </div>

      <div className="inventory-bridge-grid">
        <article className="mcc-card inventory-status-card">
          <span>MIT3 status</span>
          <strong>{status?.message ?? (loading ? 'Checking MIT3...' : 'MIT3 offline or not reachable')}</strong>
          <p><span className={isOnline?'status-pill':'status-pill disabled'}>{isOnline?'Online':'Offline'}</span></p>
          <code className="inventory-url">{status?.mit3Url ?? 'http://localhost:4173'}</code>
          {error&&<p className="form-message error">{error}</p>}
          {!isOnline&&<p className="form-message error">Start MIT3 Website first, then refresh this page.</p>}
          <div className="inventory-actions">
            <a className="primary-button action-link" href={status?.mit3Url ?? 'http://localhost:4173'} target="_blank" rel="noreferrer">Open MIT3 Inventory</a>
            <button className="secondary-button" type="button" onClick={()=>void refresh()}>Refresh</button>
          </div>
        </article>

        <article className="mcc-card inventory-note-card">
          <span>Phase 2A</span>
          <strong>Read-only bridge</strong>
          <p>Read-only view. Add/edit/import/export still happen in MIT3 until native migration is complete.</p>
          <p className="bridge-detail">MIT3 remains protected and separate until native inventory migration is complete.</p>
        </article>
      </div>

      <div className="card-grid inventory-summary-grid">
        <article className="mcc-card"><span>Total Parts</span><strong>{summary.total}</strong><p>Loaded from MIT3 app-data.</p></article>
        <article className="mcc-card"><span>Low Stock / Watch Items</span><strong>{summary.low}</strong><p>Low or out of stock.</p></article>
        <article className="mcc-card"><span>Requisition Items</span><strong>{summary.requisition}</strong><p>Active or marked requisition.</p></article>
        <article className="mcc-card"><span>Locations / Vendors</span><strong>{summary.places}</strong><p>Unique names available.</p></article>
      </div>

      <section className="mcc-card inventory-table-card">
        <div className="inventory-toolbar">
          <label className="form-field inventory-search">
            <span>Search inventory</span>
            <input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Part number, description, location, vendor..." />
          </label>
          <div className="segmented-control" aria-label="Inventory filters">
            <button className={filter==='all'?'active':''} onClick={()=>setFilter('all')} type="button">All</button>
            <button className={filter==='low'?'active':''} onClick={()=>setFilter('low')} type="button">Low Stock</button>
            <button className={filter==='requisition'?'active':''} onClick={()=>setFilter('requisition')} type="button">Requisition</button>
          </div>
        </div>

        <div className="table-card inventory-table-wrap">
          <table>
            <thead>
              <tr><th>Part Number</th><th>Description</th><th>Location</th><th>Vendor</th><th>Qty</th><th>Min</th><th>Status</th><th>Link</th></tr>
            </thead>
            <tbody>
              {filteredParts.map(part=>
                <tr key={part.id}>
                  <td>
                    {part.partInfoUrl&&validUrl(part.partInfoUrl)
                      ? <a className="part-number-link" href={part.partInfoUrl} target="_blank" rel="noreferrer">{part.partNumber || part.itemId || 'Open'}<span aria-hidden="true">-&gt;</span></a>
                      : <span className="plain-part-number">{part.partNumber || part.itemId || '-'}</span>}
                  </td>
                  <td>{part.description || '-'}</td>
                  <td>{part.location || '-'}</td>
                  <td>{part.vendor || '-'}</td>
                  <td>{part.quantity}</td>
                  <td>{part.minQuantity}</td>
                  <td><span className={isLowStock(part)?'status-pill disabled':'status-pill'}>{part.status}</span>{part.requisition&&<span className="requisition-chip">{part.requisition}</span>}</td>
                  <td>{part.partInfoUrl&&validUrl(part.partInfoUrl)?<a className="link-badge" href={part.partInfoUrl} target="_blank" rel="noreferrer">Open</a>:<span className="muted-cell">None</span>}</td>
                </tr>
              )}
              {!loading&&filteredParts.length===0&&<tr><td colSpan={8} className="empty-table-cell">No inventory rows match this view.</td></tr>}
              {loading&&<tr><td colSpan={8} className="empty-table-cell">Loading MIT3 inventory...</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
