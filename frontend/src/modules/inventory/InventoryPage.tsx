import { useEffect, useState } from 'react';

type Mit3Status = {
  ok: boolean;
  mit3Url: string;
  healthUrl: string;
  message: string;
};

async function api(path:string) {
  const res=await fetch(path,{credentials:'include'});
  const data=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

export function InventoryPage() {
  const [status,setStatus]=useState<Mit3Status|null>(null);
  const [error,setError]=useState('');

  const refresh=()=>api('/api/inventory/mit3-status').then(data=>{setStatus(data);setError('');}).catch(err=>setError((err as Error).message));
  useEffect(()=>{ void refresh(); },[]);

  const isOnline = status?.ok === true;

  return (
    <div className="page-stack">
      <div className="page-heading">
        <p className="eyebrow">Inventory</p>
        <h2>MIT3 Inventory Bridge</h2>
        <p>Open the existing MIT3 inventory system safely while MCC native inventory migration is planned.</p>
      </div>

      <div className="inventory-bridge-grid">
        <article className="mcc-card inventory-status-card">
          <span>MIT3 status</span>
          <strong>{status?.message ?? 'Checking MIT3...'}</strong>
          <p>
            <span className={isOnline?'status-pill':'status-pill disabled'}>{isOnline?'Online':'Offline'}</span>
          </p>
          {status&&<code className="inventory-url">{status.mit3Url}</code>}
          {!isOnline&&<p className="form-message error">Start MIT3 Website first, then refresh this page.</p>}
          {error&&<p className="form-message error">{error}</p>}
          <div className="inventory-actions">
            <a className="primary-button action-link" href={status?.mit3Url ?? 'http://localhost:4173'} target="_blank" rel="noreferrer">Open MIT3 Inventory</a>
            <button className="secondary-button" type="button" onClick={()=>refresh()}>Refresh Status</button>
          </div>
        </article>

        <article className="mcc-card inventory-note-card">
          <span>Safe bridge v1</span>
          <strong>Protected and separate</strong>
          <p>MIT3 remains protected and separate until native inventory migration is complete.</p>
          {status&&<p className="bridge-detail">Health check: {status.healthUrl}</p>}
        </article>
      </div>
    </div>
  );
}
