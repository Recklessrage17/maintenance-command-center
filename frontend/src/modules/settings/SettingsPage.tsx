import { useEffect, useState } from 'react';

type NetworkLinks = {
  localPort: number;
  localhostUrl: string;
  detectedLanUrls: string[];
};

async function api(path:string) {
  const res=await fetch(path,{credentials:'include'});
  const data=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

function CopyUrl({url,onCopied}:{url:string;onCopied:(value:string)=>void}) {
  return (
    <div className="share-url-row">
      <code>{url}</code>
      <button className="secondary-button compact-button" onClick={()=>{void navigator.clipboard.writeText(url).then(()=>onCopied(url));}}>Copy</button>
    </div>
  );
}

export function SettingsPage() {
  const [links,setLinks]=useState<NetworkLinks|null>(null);
  const [msg,setMsg]=useState('');

  useEffect(()=>{
    api('/api/settings/network-links').then(setLinks).catch(e=>setMsg(e.message));
  },[]);

  return (
    <div className="page-stack">
      <div className="page-heading">
        <p className="eyebrow">Settings</p>
        <h2>MCC Settings</h2>
        <p>Share local access details without exposing SMTP, session, database, or private system settings.</p>
      </div>

      <article className="mcc-card wide-card share-card">
        <span>Network access</span>
        <strong>Share MCC to another device</strong>
        <p>MCC runs on port {links?.localPort ?? 4273}. Other PCs, tablets, and phones on the same network can open MCC using the host PC IP.</p>

        <div className="share-url-list">
          {links&&<CopyUrl url={links.localhostUrl} onCopied={value=>setMsg(`Copied ${value}`)} />}
          {links?.detectedLanUrls.map(url=><CopyUrl key={url} url={url} onCopied={value=>setMsg(`Copied ${value}`)} />)}
          {links&&links.detectedLanUrls.length===0&&<p className="form-help">No LAN address was detected yet.</p>}
        </div>

        <p className="share-note">The MCC computer must stay on and MCC Website must be running.</p>
        {msg&&<p className="form-message">{msg}</p>}
      </article>
    </div>
  );
}
