import { useEffect, useState } from 'react';

type NetworkLinks = {
  localPort: number;
  localhostUrl: string;
  detectedLanUrls: string[];
  primaryLanUrl: string | null;
};

async function api(path:string) {
  const res=await fetch(path,{credentials:'include'});
  const data=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

function CopyUrl({url,onCopied}:{url:string;onCopied:(value:string)=>void}) {
  async function copy() {
    await navigator.clipboard.writeText(url);
    onCopied(url);
  }
  return (
    <div className="share-url-row">
      <code>{url}</code>
      <button className="secondary-button compact-button" onClick={()=>{void copy();}}>Copy</button>
    </div>
  );
}

export function SettingsPage() {
  const [links,setLinks]=useState<NetworkLinks|null>(null);
  const [msg,setMsg]=useState('');
  const [loading,setLoading]=useState(false);
  const primaryLanUrl = links?.primaryLanUrl ?? links?.detectedLanUrls[0] ?? '';

  function loadLinks() {
    setLoading(true);
    api('/api/settings/network-links')
      .then(data=>{ setLinks(data); setMsg(''); })
      .catch(e=>setMsg(e.message))
      .finally(()=>setLoading(false));
  }

  useEffect(()=>{
    loadLinks();
  },[]);

  return (
    <div className="page-stack">
      <div className="page-heading">
        <p className="eyebrow">Settings</p>
        <h2>MCC Settings</h2>
        <p>Share local access details without exposing SMTP, session, database, or private system settings.</p>
      </div>

      <article className="mcc-card wide-card share-card">
        <div className="share-card-heading">
          <div>
            <span>Network access</span>
            <strong>Share MCC to another device</strong>
            <p>MCC runs on port {links?.localPort ?? 4273}. Use these links only on devices connected to the same plant network.</p>
          </div>
          <button className="secondary-button compact-button" type="button" onClick={loadLinks} disabled={loading}>{loading ? 'Checking...' : 'Refresh network links'}</button>
        </div>

        <div className="network-link-grid">
          <section className="network-link-panel">
            <span>This MCC computer</span>
            <strong>Host PC URL</strong>
            <p>Use this only on the MCC host computer.</p>
            {links&&<CopyUrl url={links.localhostUrl} onCopied={value=>setMsg(`Copied ${value}`)} />}
          </section>

          <section className="network-link-panel">
            <span>Other PC on same network</span>
            <strong>Other PC URL</strong>
            <p>Use this from another Windows PC on the same network.</p>
            {primaryLanUrl ? <CopyUrl url={primaryLanUrl} onCopied={value=>setMsg(`Copied ${value}`)} /> : <p className="form-help">No network IP detected. Open Command Prompt and run ipconfig, then use IPv4 Address with port 4273.</p>}
          </section>

          <section className="network-link-panel">
            <span>Mobile / Tablet</span>
            <strong>Phone or tablet URL</strong>
            <p>Use this on phone/tablet when connected to the same Wi-Fi/network. Do not use cellular data.</p>
            {primaryLanUrl ? <CopyUrl url={primaryLanUrl} onCopied={value=>setMsg(`Copied ${value}`)} /> : <p className="form-help">No network IP detected. Open Command Prompt and run ipconfig, then use IPv4 Address with port 4273.</p>}
          </section>
        </div>

        {links&&links.detectedLanUrls.length>1&&(
          <section className="network-link-panel">
            <span>Detected network URLs</span>
            <strong>All detected LAN links</strong>
            <div className="share-url-list">
              {links.detectedLanUrls.map(url=><CopyUrl key={url} url={url} onCopied={value=>setMsg(`Copied ${value}`)} />)}
            </div>
          </section>
        )}

        <section className="network-notes">
          <strong>Important notes</strong>
          <ul>
            <li>MCC computer must stay on.</li>
            <li>MCC Website must be running.</li>
            <li>Other devices must be on same network/Wi-Fi.</li>
            <li>If it does not open, Windows Firewall may need port 4273 allowed.</li>
          </ul>
        </section>

        {msg&&<p className="form-message">{msg}</p>}
      </article>
    </div>
  );
}
