import { type CSSProperties, type Dispatch, type FormEvent, type ReactNode, type SetStateAction, useEffect, useMemo, useRef, useState } from 'react';

type MachineAsset = {
  id: number; assetNumber: string; assetName: string; brand: string; model: string; serialNumber: string; machineYear: string; machineType: string; powerType: string; shotSizeOz: number; tonnage: number; barrelDiameter: string; location: string; department: string; status: string; voltageValue: string; voltageType: string; fullLoadAmp: string; machineLength: string; machineWidth: string; machineHeight: string; fullDieHeightLength: string; screwType: string; screwTipType: string; screwTipInstalledDate: string; screwInstalledDate: string; barrelInstalledDate: string; barrelEndCapInstalledDate: string; barrelLength: string; screwLength: string; notes: string; criticalNotes: string; brandColorHex: string; createdAt: string; updatedAt: string;
};
type BrandSetting = { brandName: string; colorHex: string };
type HistoryRecord = { id: number; action: string; entityLabel: string; userName: string; reasonNote: string; createdAt: string };
type AssetForm = Omit<MachineAsset, 'id' | 'brandColorHex' | 'createdAt' | 'updatedAt'>;
type ReplacementField = 'screw' | 'screw_tip' | 'barrel' | 'barrel_end_cap';
const blankAssetForm: AssetForm = {
  assetNumber: '', assetName: '', brand: '', model: '', serialNumber: '', machineYear: '', machineType: 'Injection Molding Machine', powerType: '', shotSizeOz: 0, tonnage: 0, barrelDiameter: '', location: '', department: '', status: 'active', voltageValue: '', voltageType: '', fullLoadAmp: '', machineLength: '', machineWidth: '', machineHeight: '', fullDieHeightLength: '', screwType: '', screwTipType: '', screwTipInstalledDate: '', screwInstalledDate: '', barrelInstalledDate: '', barrelEndCapInstalledDate: '', barrelLength: '', screwLength: '', notes: '', criticalNotes: '',
};
const replacementLabels: Record<ReplacementField, string> = { screw: 'Screw', screw_tip: 'Screw Tip', barrel: 'Barrel', barrel_end_cap: 'Barrel End Cap' };
const editableRoles = new Set(['Maintenance Tech 3','Manager','Admin']);
const deleteRoles = new Set(['Manager','Admin']);

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { credentials: 'include', headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) }, ...options });
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(data.error || 'Request failed.');
  return data as T;
}
function assetToForm(asset: MachineAsset): AssetForm {
  const { id: _id, brandColorHex: _color, createdAt: _created, updatedAt: _updated, ...form } = asset;
  return form;
}
function formatDateTime(value?: string) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined,{dateStyle:'short',timeStyle:'short'}).format(date);
}
function actionLabel(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, letter=>letter.toUpperCase());
}
function ageYears(value: string) {
  if (!value.trim()) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  const years = (Date.now() - date.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  return years < 0 ? 'Unknown' : `${years.toFixed(1)} years`;
}
function safeCssHex(value: string) {
  return /^#[0-9A-Fa-f]{6}$/.test(value) ? value : '#44D7FF';
}
function downloadTemplate() {
  window.location.href = '/api/machine-library/export/template';
}

export function MachineLibraryPage({ userRole = '' }: { userRole?: string }) {
  const [assets,setAssets]=useState<MachineAsset[]>([]);
  const [brandSettings,setBrandSettings]=useState<BrandSetting[]>([]);
  const [permissions,setPermissions]=useState({canEdit:editableRoles.has(userRole),canDelete:deleteRoles.has(userRole)});
  const [search,setSearch]=useState('');
  const [brandFilter,setBrandFilter]=useState('');
  const [statusFilter,setStatusFilter]=useState('');
  const [message,setMessage]=useState<{kind:'success'|'error';text:string}|null>(null);
  const [editing,setEditing]=useState<MachineAsset|null>(null);
  const [form,setForm]=useState<AssetForm>(blankAssetForm);
  const [showEditor,setShowEditor]=useState(false);
  const [showColors,setShowColors]=useState(false);
  const [colorDrafts,setColorDrafts]=useState<Record<string,string>>({});
  const [logs,setLogs]=useState<{asset:MachineAsset;records:HistoryRecord[]}|null>(null);
  const [replacement,setReplacement]=useState<{asset:MachineAsset;field:ReplacementField;installDate:string;reasonNote:string}|null>(null);
  const fileRef = useRef<HTMLInputElement|null>(null);
  const brands = useMemo(()=>[...new Set(assets.map(asset=>asset.brand).filter(Boolean))].sort((a,b)=>a.localeCompare(b)),[assets]);
  const canEdit = permissions.canEdit || editableRoles.has(userRole);
  const canDelete = permissions.canDelete || deleteRoles.has(userRole);

  function loadAssets() {
    const params = new URLSearchParams();
    if (search.trim()) params.set('q', search.trim());
    if (brandFilter) params.set('brand', brandFilter);
    if (statusFilter) params.set('status', statusFilter);
    api<{ok:boolean;assets:MachineAsset[];brandSettings:BrandSetting[];permissions:{canEdit:boolean;canDelete:boolean}}>(`/api/machine-library/assets?${params}`)
      .then(data=>{ setAssets(data.assets ?? []); setBrandSettings(data.brandSettings ?? []); setPermissions(data.permissions ?? permissions); setColorDrafts(Object.fromEntries((data.brandSettings ?? []).map(setting=>[setting.brandName,setting.colorHex]))); })
      .catch(error=>setMessage({kind:'error',text:(error as Error).message}));
  }
  useEffect(()=>{ loadAssets(); },[search,brandFilter,statusFilter]);

  function openAdd() { setEditing(null); setForm(blankAssetForm); setShowEditor(true); }
  function openEdit(asset: MachineAsset) { setEditing(asset); setForm(assetToForm(asset)); setShowEditor(true); }
  function setField<K extends keyof AssetForm>(key: K, value: AssetForm[K]) { setForm(current=>({...current,[key]:value})); }
  async function saveAsset(event: FormEvent) {
    event.preventDefault();
    if (!canEdit) return;
    try {
      const path = editing ? `/api/machine-library/assets/${editing.id}` : '/api/machine-library/assets';
      const method = editing ? 'PUT' : 'POST';
      await api(path,{method,body:JSON.stringify(form)});
      setShowEditor(false);
      setMessage({kind:'success',text:editing ? 'Machine asset updated.' : 'Machine asset created.'});
      loadAssets();
    } catch (error) {
      setMessage({kind:'error',text:(error as Error).message});
    }
  }
  async function updateReplacement(event: FormEvent) {
    event.preventDefault();
    if (!replacement) return;
    try {
      await api(`/api/machine-library/assets/${replacement.asset.id}/replacements/${replacement.field}`,{method:'POST',body:JSON.stringify({installDate:replacement.installDate,reasonNote:replacement.reasonNote})});
      setReplacement(null);
      setMessage({kind:'success',text:`${replacementLabels[replacement.field]} install date updated.`});
      loadAssets();
    } catch (error) {
      setMessage({kind:'error',text:(error as Error).message});
    }
  }
  async function disableAsset(asset: MachineAsset) {
    if (!canDelete) return;
    const reasonNote = window.prompt(`Reason for disabling ${asset.assetNumber}?`)?.trim();
    if (!reasonNote) return;
    await api(`/api/machine-library/assets/${asset.id}/disable`,{method:'POST',body:JSON.stringify({reasonNote})});
    setMessage({kind:'success',text:`${asset.assetNumber} disabled.`});
    loadAssets();
  }
  async function loadLogs(asset: MachineAsset) {
    try {
      const data = await api<{ok:boolean;asset:MachineAsset;records:HistoryRecord[]}>(`/api/machine-library/assets/${asset.id}/history`);
      setLogs({asset:data.asset,records:data.records ?? []});
    } catch (error) {
      setMessage({kind:'error',text:(error as Error).message});
    }
  }
  async function saveColor(brandName: string) {
    const colorHex = colorDrafts[brandName] ?? '';
    if (!window.confirm(`Are you sure? This will change the color for all ${brandName} machine assets.`)) return;
    try {
      await api(`/api/machine-library/brand-settings/${encodeURIComponent(brandName)}`,{method:'PUT',body:JSON.stringify({colorHex})});
      setMessage({kind:'success',text:`${brandName} color updated.`});
      loadAssets();
    } catch (error) {
      setMessage({kind:'error',text:(error as Error).message});
    }
  }
  async function importMachineList() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    const body = new FormData();
    body.append('file', file);
    const res = await fetch('/api/machine-library/import',{method:'POST',credentials:'include',body});
    const data = await res.json().catch(()=>({}));
    if (!res.ok) { setMessage({kind:'error',text:data.error || 'Machine import failed.'}); return; }
    setMessage({kind:'success',text:`Machine import complete: ${data.addedCount ?? 0} added, ${data.updatedCount ?? 0} updated, ${data.skippedCount ?? 0} skipped.`});
    if (fileRef.current) fileRef.current.value = '';
    loadAssets();
  }

  return (
    <div className="page-stack machine-library-page">
      <div className="page-heading machine-heading">
        <p className="eyebrow">Machine Library</p>
        <h2>Machine Assets</h2>
        <p>Injection molding machine records, technical specs, replacement tracking, brand colors, and machine-specific history.</p>
      </div>
      {message&&<p className={message.kind==='error'?'form-message inventory-toast error':'form-message inventory-toast'}>{message.text}<button className="toast-close-button" type="button" onClick={()=>setMessage(null)}>Close</button></p>}
      <section className="mcc-card machine-toolbar-card">
        <label className="form-field machine-search"><span>Search assets</span><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Press 14, Toyo, model, serial number..." /></label>
        <label className="form-field"><span>Brand</span><select value={brandFilter} onChange={event=>setBrandFilter(event.target.value)}><option value="">All brands</option>{brands.map(brand=><option key={brand} value={brand}>{brand}</option>)}</select></label>
        <label className="form-field"><span>Status</span><select value={statusFilter} onChange={event=>setStatusFilter(event.target.value)}><option value="">All status</option><option value="active">Active</option><option value="down">Down</option><option value="disabled">Disabled</option><option value="removed">Removed</option></select></label>
        <div className="machine-toolbar-actions">
          <button className="primary-button compact-button" type="button" onClick={openAdd} disabled={!canEdit}>Add Machine Asset</button>
          <button className="secondary-button compact-button" type="button" onClick={()=>fileRef.current?.click()} disabled={!canEdit}>Import Machine List</button>
          <button className="secondary-button compact-button" type="button" onClick={downloadTemplate} disabled={!canEdit}>Export Machine Template</button>
          <button className="secondary-button compact-button" type="button" onClick={()=>setShowColors(true)}>Brand Color Settings</button>
          <input ref={fileRef} type="file" accept=".csv,.xlsx" className="hidden-file-input" onChange={()=>void importMachineList()} />
        </div>
        {!canEdit&&<p className="form-help machine-toolbar-note">Tier 3, Manager, Admin, or Owner Admin access is required to add or edit machine assets.</p>}
      </section>
      <div className="machine-card-grid">
        {assets.map(asset=>(
            <article className="machine-asset-card" style={{'--brand-color':safeCssHex(asset.brandColorHex)} as CSSProperties} key={asset.id}>
            <div className="machine-card-head">
              <button className="machine-asset-number" type="button" onClick={()=>void loadLogs(asset)}>{asset.assetNumber}</button>
              <span className={`machine-status-badge status-${asset.status}`}>{asset.status}</span>
            </div>
            <div className="machine-card-title"><strong>{asset.brand || 'Unknown'}</strong><span>{asset.model || 'Model not set'} / S/N: {asset.serialNumber || '-'}</span></div>
            <dl className="machine-spec-grid">
              <div><dt>Tonnage</dt><dd>{asset.tonnage || '-'}</dd></div><div><dt>Shot Size</dt><dd>{asset.shotSizeOz || '-'} oz</dd></div><div><dt>Barrel</dt><dd>{asset.barrelDiameter || '-'}</dd></div><div><dt>Power</dt><dd>{asset.powerType || '-'}</dd></div>
            </dl>
            <div className="machine-card-actions">
              <button className="primary-button compact-button" type="button" onClick={()=>openEdit(asset)}>{canEdit?'View/Edit':'View'}</button>
              <button className="secondary-button compact-button" type="button" onClick={()=>void loadLogs(asset)}>Logs</button>
              {canDelete&&asset.status!=='disabled'&&<button className="secondary-button compact-button" type="button" onClick={()=>void disableAsset(asset)}>Disable</button>}
            </div>
          </article>
        ))}
        {!assets.length&&<section className="mcc-card machine-empty-card"><strong>No machine assets found.</strong><p>Add a machine asset or import the press list template.</p></section>}
      </div>
      {showEditor&&<MachineEditorModal form={form} setField={setField} onClose={()=>setShowEditor(false)} onSubmit={saveAsset} canEdit={canEdit} asset={editing} onReplacement={(asset,field)=>setReplacement({asset,field,installDate:'',reasonNote:''})} />}
      {showColors&&<BrandColorModal brandSettings={brandSettings} colorDrafts={colorDrafts} setColorDrafts={setColorDrafts} canEdit={canEdit} onSave={saveColor} onClose={()=>setShowColors(false)} />}
      {replacement&&<ReplacementModal replacement={replacement} setReplacement={setReplacement} onSubmit={updateReplacement} />}
      {logs&&<LogsModal logs={logs} onClose={()=>setLogs(null)} onBackToAsset={()=>{ setForm(assetToForm(logs.asset)); setEditing(logs.asset); setLogs(null); setShowEditor(true); }} />}
    </div>
  );
}

function MachineEditorModal({form,setField,onClose,onSubmit,canEdit,asset,onReplacement}:{form:AssetForm;setField:<K extends keyof AssetForm>(key:K,value:AssetForm[K])=>void;onClose:()=>void;onSubmit:(event:FormEvent)=>void;canEdit:boolean;asset:MachineAsset|null;onReplacement:(asset:MachineAsset,field:ReplacementField)=>void}) {
  const disabled = !canEdit;
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><form className="mcc-card machine-modal" onSubmit={onSubmit}>
    <div className="modal-heading"><div><p className="eyebrow">Machine Asset Detail</p><h3>{form.assetNumber || 'New Machine Asset'}</h3><p>{form.brand || 'Brand'} / {form.model || 'Model'} / S/N: {form.serialNumber || '-'}</p></div><button className="link-button compact-button" type="button" onClick={onClose}>Close</button></div>
    <MachineSection title="Basic Info"><Text label="Asset Number / Press Number *" value={form.assetNumber} set={v=>setField('assetNumber',v)} disabled={disabled}/><Text label="Asset Name" value={form.assetName} set={v=>setField('assetName',v)} disabled={disabled}/><Text label="Brand *" value={form.brand} set={v=>setField('brand',v)} disabled={disabled}/><Text label="Model" value={form.model} set={v=>setField('model',v)} disabled={disabled}/><Text label="Serial Number" value={form.serialNumber} set={v=>setField('serialNumber',v)} disabled={disabled}/><Text label="Machine Year" value={form.machineYear} set={v=>setField('machineYear',v)} disabled={disabled}/><Text label="Machine Type" value={form.machineType} set={v=>setField('machineType',v)} disabled={disabled}/><Select label="Power Type" value={form.powerType} set={v=>setField('powerType',v)} options={['','Hydraulic','Electric','Hybrid','Other']} disabled={disabled}/><Text label="Shot Size (oz)" value={String(form.shotSizeOz)} set={v=>setField('shotSizeOz',Number(v)||0)} disabled={disabled}/><Text label="Tonnage" value={String(form.tonnage)} set={v=>setField('tonnage',Number(v)||0)} disabled={disabled}/><Text label="Barrel/Screw Diameter" value={form.barrelDiameter} set={v=>setField('barrelDiameter',v)} disabled={disabled}/><Text label="Location" value={form.location} set={v=>setField('location',v)} disabled={disabled}/><Text label="Department" value={form.department} set={v=>setField('department',v)} disabled={disabled}/><Select label="Status" value={form.status} set={v=>setField('status',v)} options={['active','down','disabled','removed']} disabled={disabled}/></MachineSection>
    <MachineSection title="Electrical"><Text label="Voltage" value={form.voltageValue} set={v=>setField('voltageValue',v)} disabled={disabled}/><Select label="Voltage Type" value={form.voltageType} set={v=>setField('voltageType',v)} options={['','AC','DC']} disabled={disabled}/><Text label="Full Load Amp" value={form.fullLoadAmp} set={v=>setField('fullLoadAmp',v)} disabled={disabled}/></MachineSection>
    <MachineSection title="Dimensions"><Text label="Machine Length" value={form.machineLength} set={v=>setField('machineLength',v)} disabled={disabled}/><Text label="Machine Width" value={form.machineWidth} set={v=>setField('machineWidth',v)} disabled={disabled}/><Text label="Machine Height" value={form.machineHeight} set={v=>setField('machineHeight',v)} disabled={disabled}/><Text label="Full Die Height Length / Range" value={form.fullDieHeightLength} set={v=>setField('fullDieHeightLength',v)} disabled={disabled}/></MachineSection>
    <MachineSection title="Screw / Barrel"><Text label="Screw Type" value={form.screwType} set={v=>setField('screwType',v)} disabled={disabled}/><Text label="Screw Tip Type" value={form.screwTipType} set={v=>setField('screwTipType',v)} disabled={disabled}/><DateWithAge label="Screw Installed Date" value={form.screwInstalledDate} set={v=>setField('screwInstalledDate',v)} disabled={disabled}/><DateWithAge label="Screw Tip Installed Date" value={form.screwTipInstalledDate} set={v=>setField('screwTipInstalledDate',v)} disabled={disabled}/><DateWithAge label="Barrel Installed Date" value={form.barrelInstalledDate} set={v=>setField('barrelInstalledDate',v)} disabled={disabled}/><DateWithAge label="Barrel End Cap Installed Date" value={form.barrelEndCapInstalledDate} set={v=>setField('barrelEndCapInstalledDate',v)} disabled={disabled}/><Text label="Barrel Length" value={form.barrelLength} set={v=>setField('barrelLength',v)} disabled={disabled}/><Text label="Screw Length" value={form.screwLength} set={v=>setField('screwLength',v)} disabled={disabled}/></MachineSection>
    {asset&&<section className="machine-replacement-panel"><span>Replacement Updates</span>{(['screw','screw_tip','barrel','barrel_end_cap'] as ReplacementField[]).map(field=><button className="machine-action-badge" type="button" key={field} onClick={()=>onReplacement(asset,field)} disabled={!canEdit}>New {replacementLabels[field]}</button>)}</section>}
    <MachineSection title="Notes / Critical Notes"><Area label="Notes" value={form.notes} set={v=>setField('notes',v)} disabled={disabled}/><Area label="Critical Notes" value={form.criticalNotes} set={v=>setField('criticalNotes',v)} disabled={disabled}/></MachineSection>
    <div className="machine-placeholder-grid"><section>Linked Inventory Parts coming next</section><section>Machine PM schedules coming next</section><section>Machine documents coming next</section><section>History preview available from Logs</section></div>
    <div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit" disabled={!canEdit}>{asset?'Save Machine Asset':'Create Machine Asset'}</button></div>
  </form></div>;
}
function MachineSection({title,children}:{title:string;children:ReactNode}) { return <section className="machine-form-section"><span>{title}</span><div className="machine-form-grid">{children}</div></section>; }
function Text({label,value,set,disabled}:{label:string;value:string;set:(value:string)=>void;disabled:boolean}) { return <label className="form-field"><span>{label}</span><input value={value} disabled={disabled} onChange={event=>set(event.target.value)} /></label>; }
function Area({label,value,set,disabled}:{label:string;value:string;set:(value:string)=>void;disabled:boolean}) { return <label className="form-field machine-form-wide"><span>{label}</span><textarea value={value} disabled={disabled} onChange={event=>set(event.target.value)} /></label>; }
function Select({label,value,set,options,disabled}:{label:string;value:string;set:(value:string)=>void;options:string[];disabled:boolean}) { return <label className="form-field"><span>{label}</span><select value={value} disabled={disabled} onChange={event=>set(event.target.value)}>{options.map(option=><option key={option} value={option}>{option || 'Select'}</option>)}</select></label>; }
function DateWithAge({label,value,set,disabled}:{label:string;value:string;set:(value:string)=>void;disabled:boolean}) { return <label className="form-field"><span>{label}</span><input value={value} disabled={disabled} onChange={event=>set(event.target.value)} placeholder="YYYY-MM-DD or known text" /><small className="machine-age-label">Year count: {ageYears(value)}</small></label>; }
function BrandColorModal({brandSettings,colorDrafts,setColorDrafts,canEdit,onSave,onClose}:{brandSettings:BrandSetting[];colorDrafts:Record<string,string>;setColorDrafts:Dispatch<SetStateAction<Record<string,string>>>;canEdit:boolean;onSave:(brandName:string)=>void;onClose:()=>void}) {
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><section className="mcc-card machine-color-modal"><div className="modal-heading"><div><p className="eyebrow">Brand Color Settings</p><h3>Machine Brand Colors</h3></div><button className="link-button compact-button" type="button" onClick={onClose}>Close</button></div>{brandSettings.map(setting=><div className="machine-color-row" key={setting.brandName}><span className="machine-color-swatch" style={{background:safeCssHex(colorDrafts[setting.brandName] ?? setting.colorHex)}} /><strong>{setting.brandName}</strong><input value={colorDrafts[setting.brandName] ?? setting.colorHex} disabled={!canEdit} onChange={event=>setColorDrafts(current=>({...current,[setting.brandName]:event.target.value}))} /><button className="secondary-button compact-button" type="button" onClick={()=>onSave(setting.brandName)} disabled={!canEdit}>Save</button></div>)}</section></div>;
}
function ReplacementModal({replacement,setReplacement,onSubmit}:{replacement:{asset:MachineAsset;field:ReplacementField;installDate:string;reasonNote:string};setReplacement:Dispatch<SetStateAction<{asset:MachineAsset;field:ReplacementField;installDate:string;reasonNote:string}|null>>;onSubmit:(event:FormEvent)=>void}) {
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><form className="mcc-card machine-small-modal" onSubmit={onSubmit}><p className="eyebrow">Replacement Update</p><h3>Update New {replacementLabels[replacement.field]} Install Date</h3><Text label="Install Date *" value={replacement.installDate} set={installDate=>setReplacement(current=>current&&({...current,installDate}))} disabled={false}/><Area label="Reason / Note" value={replacement.reasonNote} set={reasonNote=>setReplacement(current=>current&&({...current,reasonNote}))} disabled={false}/><div className="modal-actions"><button className="secondary-button" type="button" onClick={()=>setReplacement(null)}>Cancel</button><button className="primary-button" type="submit">Update {replacementLabels[replacement.field]} Date</button></div></form></div>;
}
function LogsModal({logs,onClose,onBackToAsset}:{logs:{asset:MachineAsset;records:HistoryRecord[]};onClose:()=>void;onBackToAsset:()=>void}) {
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><section className="mcc-card machine-logs-modal"><div className="modal-heading"><div><p className="eyebrow">Machine Asset History</p><h3>{logs.asset.assetNumber}</h3></div><button className="link-button compact-button" type="button" onClick={onClose}>Close</button></div><div className="machine-log-list">{logs.records.map(record=><article className="machine-log-row" key={record.id}><span>{formatDateTime(record.createdAt)}</span><strong>{actionLabel(record.action)}</strong><p>{record.userName || 'Unknown'} / {record.reasonNote || 'No reason note'}</p></article>)}{!logs.records.length&&<p className="form-message">No machine-specific logs yet.</p>}</div><div className="modal-actions"><button className="secondary-button" type="button" onClick={onBackToAsset}>Back to Asset</button><button className="primary-button" type="button" onClick={onClose}>Done</button></div></section></div>;
}
