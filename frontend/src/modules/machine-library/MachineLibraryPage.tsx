import { type CSSProperties, type Dispatch, type FormEvent, type ReactNode, type SetStateAction, useEffect, useMemo, useRef, useState } from 'react';

type ConditionStatus = 'new' | 'used' | 'worn' | 'rebuilt_repaired';
type MachineAsset = {
  id: number; assetNumber: string; assetName: string; brand: string; model: string; serialNumber: string; machineYear: string; machineType: string; powerType: string; shotSizeOz: number; tonnage: number; barrelDiameter: string; location: string; department: string; status: string; voltageValue: string; voltageType: string; fullLoadAmp: string; machineLength: string; machineWidth: string; machineHeight: string; fullDieHeightLength: string; screwType: string; screwTipType: string; screwTipInstalledDate: string; screwInstalledDate: string; barrelInstalledDate: string; barrelEndCapInstalledDate: string; barrelLength: string; screwLength: string; screwRebuildRepaired: boolean; barrelRebuildRepaired: boolean; screwConditionStatus: ConditionStatus; barrelConditionStatus: ConditionStatus; hasDoubleShotInjection: boolean; hasPlungerInjection: boolean; screw2Type: string; screw2TipType: string; screw2RebuildRepaired: boolean; screw2ConditionStatus: ConditionStatus; screw2InstalledDate: string; screw2TipInstalledDate: string; screw2Length: string; barrel2Diameter: string; barrel2RebuildRepaired: boolean; barrel2ConditionStatus: ConditionStatus; barrel2InstalledDate: string; barrel2EndCapInstalledDate: string; barrel2Length: string; plungerType: string; plungerRebuildRepaired: boolean; plungerConditionStatus: ConditionStatus; plungerInstalledDate: string; plungerLength: string; plungerDiameter: string; plungerBarrelType: string; plungerBarrelRebuildRepaired: boolean; plungerBarrelConditionStatus: ConditionStatus; plungerBarrelInstalledDate: string; plungerBarrelEndCapInstalledDate: string; plungerBarrelLength: string; plungerBarrelDiameter: string; notes: string; criticalNotes: string; brandColorHex: string; createdAt: string; updatedAt: string;
};
type BrandSetting = { brandName: string; colorHex: string };
type HistoryRecord = { id: number; action: string; entityLabel: string; userName: string; reasonNote: string; createdAt: string };
type ImportMode = 'add_new_only' | 'upsert';
type ImportRejectedDuplicate = { rowNumber: number; assetNumber: string; reason: string };
type MachineImportSummary = { addedCount: number; updatedCount: number; skippedCount: number; rejectedDuplicateCount: number; errors?: string[]; rejectedDuplicates?: ImportRejectedDuplicate[]; changedAssetNumbers?: string[] };
type AssetForm = Omit<MachineAsset, 'id' | 'brandColorHex' | 'createdAt' | 'updatedAt' | 'shotSizeOz'> & { shotSizeOz: string };
type ReplacementField = 'screw' | 'screw_tip' | 'barrel' | 'barrel_end_cap' | 'screw2' | 'screw2_tip' | 'barrel2' | 'barrel2_end_cap' | 'plunger' | 'plunger_barrel' | 'plunger_barrel_end_cap';
type UnitFieldKey = 'machineLength' | 'machineWidth' | 'machineHeight' | 'fullDieHeightLength' | 'barrelLength' | 'screwLength' | 'screw2Length' | 'barrel2Length' | 'plungerLength' | 'plungerDiameter' | 'plungerBarrelLength' | 'plungerBarrelDiameter';
type StringFormKey = { [K in keyof AssetForm]: AssetForm[K] extends string ? K : never }[keyof AssetForm];
type BooleanFormKey = { [K in keyof AssetForm]: AssetForm[K] extends boolean ? K : never }[keyof AssetForm];
type ConditionFormKey = { [K in keyof AssetForm]: AssetForm[K] extends ConditionStatus ? K : never }[keyof AssetForm];

const blankAssetForm: AssetForm = {
  assetNumber: '', assetName: '', brand: '', model: '', serialNumber: '', machineYear: '', machineType: 'Injection Molding Machine', powerType: '', shotSizeOz: '', tonnage: 0, barrelDiameter: '', location: '', department: '', status: 'active', voltageValue: '', voltageType: '', fullLoadAmp: '', machineLength: '', machineWidth: '', machineHeight: '', fullDieHeightLength: '', screwType: '', screwTipType: '', screwTipInstalledDate: '', screwInstalledDate: '', barrelInstalledDate: '', barrelEndCapInstalledDate: '', barrelLength: '', screwLength: '', screwRebuildRepaired: false, barrelRebuildRepaired: false, screwConditionStatus: 'new', barrelConditionStatus: 'new', hasDoubleShotInjection: false, hasPlungerInjection: false, screw2Type: '', screw2TipType: '', screw2RebuildRepaired: false, screw2ConditionStatus: 'new', screw2InstalledDate: '', screw2TipInstalledDate: '', screw2Length: '', barrel2Diameter: '', barrel2RebuildRepaired: false, barrel2ConditionStatus: 'new', barrel2InstalledDate: '', barrel2EndCapInstalledDate: '', barrel2Length: '', plungerType: '', plungerRebuildRepaired: false, plungerConditionStatus: 'new', plungerInstalledDate: '', plungerLength: '', plungerDiameter: '', plungerBarrelType: '', plungerBarrelRebuildRepaired: false, plungerBarrelConditionStatus: 'new', plungerBarrelInstalledDate: '', plungerBarrelEndCapInstalledDate: '', plungerBarrelLength: '', plungerBarrelDiameter: '', notes: '', criticalNotes: '',
};
const replacementLabels: Record<ReplacementField, string> = { screw: 'Screw', screw_tip: 'Screw Tip', barrel: 'Barrel', barrel_end_cap: 'Barrel End Cap', screw2: 'Screw 2', screw2_tip: 'Screw 2 Tip', barrel2: 'Barrel 2', barrel2_end_cap: 'Barrel 2 End Cap', plunger: 'Plunger', plunger_barrel: 'Plunger Barrel', plunger_barrel_end_cap: 'Plunger Barrel End Cap' };
const replacementGroups: Array<{ title: string; enabled: (form: AssetForm) => boolean; fields: ReplacementField[] }> = [
  { title: 'Unit 1', enabled: () => true, fields: ['screw','screw_tip','barrel','barrel_end_cap'] },
  { title: 'Unit 2 / Secondary Injection', enabled: form => form.hasDoubleShotInjection, fields: ['screw2','screw2_tip','barrel2','barrel2_end_cap'] },
  { title: 'Plunger Injection', enabled: form => form.hasPlungerInjection, fields: ['plunger','plunger_barrel','plunger_barrel_end_cap'] },
];
const editableRoles = new Set(['Maintenance Tech 3','Manager','Admin']);
const deleteRoles = new Set(['Manager','Admin']);
const unitFields: Array<{ key: UnitFieldKey; label: string }> = [
  { key: 'machineLength', label: 'Machine Length' },
  { key: 'machineWidth', label: 'Machine Width' },
  { key: 'machineHeight', label: 'Machine Height' },
  { key: 'fullDieHeightLength', label: 'Full Die Height Length / Range' },
];
const conditionLabels: Record<ConditionStatus, string> = { new: 'New', used: 'Used', worn: 'Worn', rebuilt_repaired: 'Rebuilt / Repaired' };

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { credentials: 'include', headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) }, ...options });
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(data.error || 'Request failed.');
  return data as T;
}
function assetToForm(asset: MachineAsset): AssetForm {
  const { id: _id, brandColorHex: _color, createdAt: _created, updatedAt: _updated, shotSizeOz, ...form } = asset;
  return { ...form, shotSizeOz: shotSizeOz ? String(shotSizeOz) : '' };
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
function machineYearAge(value: string) {
  const yearText = value.trim();
  if (!/^\d{4}$/.test(yearText)) return 'Unknown';
  const year = Number(yearText);
  const currentYear = new Date().getFullYear();
  if (!Number.isFinite(year) || year < 1900 || year > currentYear) return 'Unknown';
  const age = currentYear - year;
  return `${age} ${age === 1 ? 'yr' : 'yrs'}`;
}
function safeCssHex(value: string) {
  return /^#[0-9A-Fa-f]{6}$/.test(value) ? value : '#44D7FF';
}
function isEngelBrand(value: string) {
  return value.trim().toLowerCase() === 'engel';
}
function machineStatusLabel(status: string) {
  const normalized = status || 'active';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}
function downloadTemplate() {
  window.location.href = '/api/machine-library/export/template';
}
function displayShotSize(value: number | string) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '-';
}
function injectionSetupLabel(asset: Pick<MachineAsset, 'hasDoubleShotInjection' | 'hasPlungerInjection'>) {
  if (asset.hasDoubleShotInjection && asset.hasPlungerInjection) return 'Double Shot + Plunger';
  if (asset.hasDoubleShotInjection) return 'Double Shot';
  if (asset.hasPlungerInjection) return 'Plunger';
  return '';
}
function componentSummary(type: string, date: string) {
  return `${type || '-'} / ${ageYears(date)}`;
}
function effectiveCondition(rebuildRepaired: boolean, status: ConditionStatus | string): ConditionStatus {
  if (rebuildRepaired) return 'rebuilt_repaired';
  return status === 'used' || status === 'worn' ? status : 'new';
}
function isoDateValue(value: string) {
  const clean = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
  const parsed = new Date(clean);
  if (!clean || Number.isNaN(parsed.getTime())) return clean ? null : '';
  return parsed.toISOString().slice(0, 10);
}
function formatUnitNumber(value: number, decimals: number) {
  return Number(value.toFixed(decimals)).toLocaleString(undefined, { maximumFractionDigits: decimals });
}
function localIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
function parseIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}
function parseDimensionValue(value: string) {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(mm|millimeter|millimeters|in|inch|inches|"|ft|foot|feet|')$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (!Number.isFinite(amount)) return null;
  const mm = unit.startsWith('mm') || unit.startsWith('millimeter') ? amount : unit === 'in' || unit === 'inch' || unit === 'inches' || unit === '"' ? amount * 25.4 : amount * 304.8;
  return { mm, inches: mm / 25.4, feet: mm / 304.8 };
}
function importToast(summary: MachineImportSummary) {
  const added = summary.addedCount ?? 0;
  const updated = summary.updatedCount ?? 0;
  const skipped = summary.skippedCount ?? 0;
  const rejected = summary.rejectedDuplicateCount ?? 0;
  if (added + updated > 0) return { kind: 'success' as const, text: `Machine import complete: ${added} added, ${updated} updated, ${rejected} rejected.` };
  return { kind: 'error' as const, text: `Machine import finished with no changes: ${rejected} rejected, ${skipped} skipped.` };
}

export function MachineLibraryPage({ userRole = '' }: { userRole?: string }) {
  const [assets,setAssets]=useState<MachineAsset[]>([]);
  const [brandSettings,setBrandSettings]=useState<BrandSetting[]>([]);
  const [permissions,setPermissions]=useState({canEdit:editableRoles.has(userRole),canDelete:deleteRoles.has(userRole)});
  const [search,setSearch]=useState('');
  const [brandFilter,setBrandFilter]=useState('');
  const [statusFilter,setStatusFilter]=useState('');
  const [message,setMessage]=useState<{kind:'success'|'error';text:string}|null>(null);
  const [importMode,setImportMode]=useState<ImportMode>('add_new_only');
  const [isImporting,setIsImporting]=useState(false);
  const [importSummary,setImportSummary]=useState<MachineImportSummary|null>(null);
  const [highlightedAssets,setHighlightedAssets]=useState<Set<string>>(new Set());
  const [editing,setEditing]=useState<MachineAsset|null>(null);
  const [form,setForm]=useState<AssetForm>(blankAssetForm);
  const [setupDraft,setSetupDraft]=useState({hasDoubleShotInjection:false,hasPlungerInjection:false});
  const [showSetup,setShowSetup]=useState(false);
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

  function openAdd() { setSetupDraft({hasDoubleShotInjection:false,hasPlungerInjection:false}); setShowSetup(true); }
  function continueAddFromSetup() { setEditing(null); setForm({...blankAssetForm,...setupDraft}); setShowSetup(false); setShowEditor(true); }
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
    if (!file || isImporting) return;
    const body = new FormData();
    body.append('file', file);
    body.append('importMode', importMode);
    setIsImporting(true);
    try {
      const res = await fetch('/api/machine-library/import',{method:'POST',credentials:'include',body});
      const data = await res.json().catch(()=>({}));
      if (!res.ok) { setMessage({kind:'error',text:data.error || 'Machine import failed.'}); return; }
      const summary = data as MachineImportSummary;
      const changed = new Set((summary.changedAssetNumbers ?? []).map(String));
      if (changed.size) {
        setHighlightedAssets(changed);
        window.setTimeout(()=>setHighlightedAssets(new Set()), 5 * 60 * 1000);
      }
      if ((summary.rejectedDuplicateCount ?? 0) > 0) setImportSummary(summary);
      else setMessage(importToast(summary));
      loadAssets();
    } catch (error) {
      setMessage({kind:'error',text:(error as Error).message || 'Machine import failed.'});
    } finally {
      setIsImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }
  function closeImportSummary() {
    if (importSummary) setMessage(importToast(importSummary));
    setImportSummary(null);
  }

  return (
    <div className="page-stack machine-library-page">
      {message&&<p className={message.kind==='error'?'form-message inventory-toast error':'form-message inventory-toast'}>{message.text}<button className="toast-close-button" type="button" onClick={()=>setMessage(null)}>Close</button></p>}
      <section className="mcc-card machine-toolbar-card">
        <label className="form-field machine-search"><span>Search assets</span><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Press 14, Toyo, model, serial number..." /></label>
        <label className="form-field"><span>Brand</span><select value={brandFilter} onChange={event=>setBrandFilter(event.target.value)}><option value="">All brands</option>{brands.map(brand=><option key={brand} value={brand}>{brand}</option>)}</select></label>
        <label className="form-field"><span>Status</span><select value={statusFilter} onChange={event=>setStatusFilter(event.target.value)}><option value="">All status</option><option value="active">Active</option><option value="down">Down</option><option value="disabled">Disabled</option><option value="removed">Removed</option></select></label>
        <div className="machine-toolbar-actions">
          <button className="primary-button compact-button" type="button" onClick={openAdd} disabled={!canEdit}>Add Machine Asset</button>
          <label className="form-field machine-import-mode"><span>Import Mode</span><select value={importMode} onChange={event=>setImportMode(event.target.value as ImportMode)} disabled={!canEdit||isImporting}><option value="add_new_only">Add New Only</option><option value="upsert">Update Existing / Upsert</option></select></label>
          <button className="secondary-button compact-button" type="button" onClick={()=>fileRef.current?.click()} disabled={!canEdit||isImporting}>{isImporting?'Importing...':'Import Machine List'}</button>
          <button className="secondary-button compact-button" type="button" onClick={downloadTemplate} disabled={!canEdit}>Export Machine Template</button>
          <button className="secondary-button compact-button" type="button" onClick={()=>setShowColors(true)}>Brand Color Settings</button>
          <input ref={fileRef} type="file" accept=".csv,.xlsx" className="hidden-file-input" onChange={()=>void importMachineList()} />
        </div>
        <p className="form-help machine-toolbar-note">Add New Only rejects existing Asset Numbers. Upsert updates existing assets and creates new ones. Duplicate Asset Numbers inside one file are always rejected after the first valid row.</p>
        {!canEdit&&<p className="form-help machine-toolbar-note">Tier 3, Manager, Admin, or Owner Admin access is required to add or edit machine assets.</p>}
      </section>
      <div className="machine-card-grid">
        {assets.map(asset=>(
          <article className={`machine-asset-card ${highlightedAssets.has(asset.assetNumber) ? 'machine-import-highlight' : ''} ${isEngelBrand(asset.brand) ? 'machine-brand-engel' : ''}`} style={{'--brand-color':safeCssHex(asset.brandColorHex)} as CSSProperties} key={asset.id}>
            <div className="machine-card-head">
              <button className="machine-asset-number" type="button" onClick={()=>void loadLogs(asset)}>{asset.assetNumber}</button>
              {asset.status === 'active'
                ? <span className="machine-status-badge status-active" title="Active" aria-label="Active"><span className="status-pulse-dot" /></span>
                : <span className={`machine-status-badge status-${asset.status}`}>{machineStatusLabel(asset.status)}</span>}
            </div>
            <div className="machine-card-title">
              <div className="machine-card-brand-row">
                <strong className="machine-card-brand-name">{asset.brand || 'Unknown'}</strong>
                <span className="machine-age-pill">Year {asset.machineYear || 'Unknown'} &bull; Age {machineYearAge(asset.machineYear)}</span>
              </div>
              <div className="machine-card-identity">
                <div><span>Model:</span><strong>{asset.model || '-'}</strong></div>
                <div><span>Serial #:</span><strong>{asset.serialNumber || '-'}</strong></div>
              </div>
            </div>
            <dl className="machine-spec-grid">
              <div><dt>Tonnage</dt><dd>{asset.tonnage || '-'}</dd></div><div><dt>Shot Size</dt><dd>{displayShotSize(asset.shotSizeOz)} oz</dd></div><div><dt>Barrel</dt><dd>{asset.barrelDiameter || '-'}</dd></div><div><dt>Power</dt><dd>{asset.powerType || '-'}</dd></div>
            </dl>
            <div className="machine-wear-grid">
              {injectionSetupLabel(asset)&&<span className="machine-setup-badge">{injectionSetupLabel(asset)}</span>}
              {!asset.hasDoubleShotInjection&&!asset.hasPlungerInjection&&<>
                <ConditionBadge label="Screw" status={effectiveCondition(asset.screwRebuildRepaired, asset.screwConditionStatus)} />
                <ConditionBadge label="Barrel" status={effectiveCondition(asset.barrelRebuildRepaired, asset.barrelConditionStatus)} />
                <div><span>Screw</span><strong>{asset.screwInstalledDate || '-'}</strong></div>
                <div><span>Barrel</span><strong>{asset.barrelInstalledDate || '-'}</strong></div>
                <div><span>Tip</span><strong>{asset.screwTipInstalledDate || '-'}</strong></div>
                <div><span>End Cap</span><strong>{asset.barrelEndCapInstalledDate || '-'}</strong></div>
              </>}
              {asset.hasDoubleShotInjection&&<>
                <div><span>U1 Screw</span><strong>{componentSummary(asset.screwType, asset.screwInstalledDate)}</strong></div>
                <div><span>U1 Barrel</span><strong>{componentSummary(asset.barrelDiameter, asset.barrelInstalledDate)}</strong></div>
                <div><span>U2 Screw</span><strong>{componentSummary(asset.screw2Type, asset.screw2InstalledDate)}</strong></div>
                <div><span>U2 Barrel</span><strong>{componentSummary(asset.barrel2Diameter, asset.barrel2InstalledDate)}</strong></div>
              </>}
              {asset.hasPlungerInjection&&<>
                <div><span>Plunger</span><strong>{componentSummary(asset.plungerType || asset.plungerDiameter, asset.plungerInstalledDate)}</strong></div>
                <div><span>Plunger Barrel</span><strong>{componentSummary(asset.plungerBarrelType || asset.plungerBarrelDiameter, asset.plungerBarrelInstalledDate)}</strong></div>
              </>}
            </div>
            {(asset.notes || asset.criticalNotes)&&<div className="machine-card-notes">{asset.notes&&<p className="machine-note-text">{asset.notes}</p>}{asset.criticalNotes&&<p className="machine-critical-text">{asset.criticalNotes}</p>}</div>}
            <div className="machine-card-actions">
              <button className="primary-button compact-button" type="button" onClick={()=>openEdit(asset)}>{canEdit?'View/Edit':'View'}</button>
              <button className="secondary-button compact-button" type="button" onClick={()=>void loadLogs(asset)}>Logs</button>
              {canDelete&&asset.status!=='disabled'&&<button className="secondary-button compact-button" type="button" onClick={()=>void disableAsset(asset)}>Disable</button>}
            </div>
          </article>
        ))}
        {!assets.length&&<section className="mcc-card machine-empty-card"><strong>No machine assets found.</strong><p>Add a machine asset or import the press list template.</p></section>}
      </div>
      {showSetup&&<InjectionSetupModal setup={setupDraft} setSetup={setSetupDraft} onContinue={continueAddFromSetup} onCancel={()=>setShowSetup(false)} />}
      {showEditor&&<MachineEditorModal form={form} setField={setField} onClose={()=>setShowEditor(false)} onSubmit={saveAsset} canEdit={canEdit} asset={editing} onReplacement={(asset,field)=>setReplacement({asset,field,installDate:'',reasonNote:''})} onInspection={()=>setMessage({kind:'success',text:'Measurement Inspection form is coming next.'})} />}
      {importSummary&&<ImportResultModal summary={importSummary} onClose={closeImportSummary} />}
      {showColors&&<BrandColorModal brandSettings={brandSettings} colorDrafts={colorDrafts} setColorDrafts={setColorDrafts} canEdit={canEdit} onSave={saveColor} onClose={()=>setShowColors(false)} />}
      {replacement&&<ReplacementModal replacement={replacement} setReplacement={setReplacement} onSubmit={updateReplacement} />}
      {logs&&<LogsModal logs={logs} onClose={()=>setLogs(null)} onBackToAsset={()=>{ setForm(assetToForm(logs.asset)); setEditing(logs.asset); setLogs(null); setShowEditor(true); }} />}
    </div>
  );
}

function MachineEditorModal({form,setField,onClose,onSubmit,canEdit,asset,onReplacement,onInspection}:{form:AssetForm;setField:<K extends keyof AssetForm>(key:K,value:AssetForm[K])=>void;onClose:()=>void;onSubmit:(event:FormEvent)=>void;canEdit:boolean;asset:MachineAsset|null;onReplacement:(asset:MachineAsset,field:ReplacementField)=>void;onInspection:()=>void}) {
  const disabled = !canEdit;
  const setupChanged = Boolean(asset && (form.hasDoubleShotInjection !== asset.hasDoubleShotInjection || form.hasPlungerInjection !== asset.hasPlungerInjection));
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><form className="mcc-card machine-modal" onSubmit={onSubmit}>
    <div className="modal-heading"><div><p className="eyebrow">Machine Asset Detail</p><h3>{form.assetNumber || 'New Machine Asset'}</h3><p>{form.brand || 'Brand'} / {form.model || 'Model'} / S/N: {form.serialNumber || '-'}</p></div><button className="link-button compact-button" type="button" onClick={onClose}>Close</button></div>
    <MachineSection title="Basic Info"><Text label="Asset Number / Press Number *" value={form.assetNumber} set={v=>setField('assetNumber',v)} disabled={disabled}/><Text label="Asset Name" value={form.assetName} set={v=>setField('assetName',v)} disabled={disabled}/><Text label="Brand *" value={form.brand} set={v=>setField('brand',v)} disabled={disabled}/><Text label="Model" value={form.model} set={v=>setField('model',v)} disabled={disabled}/><Text label="Serial Number" value={form.serialNumber} set={v=>setField('serialNumber',v)} disabled={disabled}/><Text label="Machine Year" value={form.machineYear} set={v=>setField('machineYear',v)} disabled={disabled} helper={<small className="machine-age-pill machine-age-helper-pill">Age: {machineYearAge(form.machineYear)}</small>}/><Text label="Machine Type" value={form.machineType} set={v=>setField('machineType',v)} disabled={disabled}/><Select label="Power Type" value={form.powerType} set={v=>setField('powerType',v)} options={['','Hydraulic','Electric','Hybrid','Other']} disabled={disabled}/><DecimalInput label="Shot Size (oz)" value={form.shotSizeOz} set={v=>setField('shotSizeOz',v)} disabled={disabled}/><Text label="Tonnage" value={String(form.tonnage)} set={v=>setField('tonnage',Number(v)||0)} disabled={disabled}/><Text label="Barrel/Screw Diameter" value={form.barrelDiameter} set={v=>setField('barrelDiameter',v)} disabled={disabled}/><Text label="Location" value={form.location} set={v=>setField('location',v)} disabled={disabled}/><Select label="Status" value={form.status} set={v=>setField('status',v)} options={['active','down','disabled','removed']} disabled={disabled}/></MachineSection>
    <section className="machine-form-section"><span>Injection Setup</span><div className="machine-setup-grid"><YesNoToggle label="Double Shot Injection" value={form.hasDoubleShotInjection} set={value=>setField('hasDoubleShotInjection',value)} disabled={disabled}/><YesNoToggle label="Plunger Injection" value={form.hasPlungerInjection} set={value=>setField('hasPlungerInjection',value)} disabled={disabled}/></div>{setupChanged&&<p className="machine-setup-warning">Changing injection setup can show or hide component fields. Existing saved data will not be deleted.</p>}</section>
    <MachineSection title="Electrical"><Text label="Voltage" value={form.voltageValue} set={v=>setField('voltageValue',v)} disabled={disabled}/><Select label="Voltage Type" value={form.voltageType} set={v=>setField('voltageType',v)} options={['','AC','DC']} disabled={disabled}/><Text label="Full Load Amp" value={form.fullLoadAmp} set={v=>setField('fullLoadAmp',v)} disabled={disabled}/></MachineSection>
    <MachineSection title="Dimensions">{unitFields.map(field=><UnitDimensionField key={field.key} label={field.label} value={form[field.key]} set={v=>setField(field.key,v)} disabled={disabled}/>)}</MachineSection>
    {!form.hasDoubleShotInjection&&<section className="machine-form-section"><span>Screw / Barrel</span><div className="machine-screw-barrel-grid"><ScrewBox title="Screw Box" form={form} setField={setField} disabled={disabled} typeKey="screwType" tipTypeKey="screwTipType" rebuildKey="screwRebuildRepaired" conditionKey="screwConditionStatus" installedDateKey="screwInstalledDate" tipInstalledDateKey="screwTipInstalledDate" lengthKey="screwLength" conditionLabel="Screw condition" /><BarrelBox title="Barrel Box" form={form} setField={setField} disabled={disabled} diameterKey="barrelDiameter" rebuildKey="barrelRebuildRepaired" conditionKey="barrelConditionStatus" installedDateKey="barrelInstalledDate" endCapDateKey="barrelEndCapInstalledDate" lengthKey="barrelLength" conditionLabel="Barrel condition" /></div><MeasurementRow canEdit={canEdit} label="Measurement Inspection" onInspection={onInspection}/></section>}
    {form.hasDoubleShotInjection&&<><section className="machine-form-section"><span>Injection Unit 1</span><div className="machine-screw-barrel-grid"><ScrewBox title="Screw 1 Box" form={form} setField={setField} disabled={disabled} typeKey="screwType" tipTypeKey="screwTipType" rebuildKey="screwRebuildRepaired" conditionKey="screwConditionStatus" installedDateKey="screwInstalledDate" tipInstalledDateKey="screwTipInstalledDate" lengthKey="screwLength" conditionLabel="Screw 1 condition" /><BarrelBox title="Barrel 1 Box" form={form} setField={setField} disabled={disabled} diameterKey="barrelDiameter" rebuildKey="barrelRebuildRepaired" conditionKey="barrelConditionStatus" installedDateKey="barrelInstalledDate" endCapDateKey="barrelEndCapInstalledDate" lengthKey="barrelLength" conditionLabel="Barrel 1 condition" /></div><MeasurementRow canEdit={canEdit} label="Unit 1 Measurement Inspection" onInspection={onInspection}/></section><section className="machine-form-section"><span>Injection Unit 2</span><div className="machine-screw-barrel-grid"><ScrewBox title="Screw 2 Box" form={form} setField={setField} disabled={disabled} typeKey="screw2Type" tipTypeKey="screw2TipType" rebuildKey="screw2RebuildRepaired" conditionKey="screw2ConditionStatus" installedDateKey="screw2InstalledDate" tipInstalledDateKey="screw2TipInstalledDate" lengthKey="screw2Length" conditionLabel="Screw 2 condition" /><BarrelBox title="Barrel 2 Box" form={form} setField={setField} disabled={disabled} diameterKey="barrel2Diameter" rebuildKey="barrel2RebuildRepaired" conditionKey="barrel2ConditionStatus" installedDateKey="barrel2InstalledDate" endCapDateKey="barrel2EndCapInstalledDate" lengthKey="barrel2Length" conditionLabel="Barrel 2 condition" /></div><MeasurementRow canEdit={canEdit} label="Unit 2 Measurement Inspection" onInspection={onInspection}/></section></>}
    {form.hasPlungerInjection&&<section className="machine-form-section"><span>Plunger Injection</span><div className="machine-screw-barrel-grid"><PlungerBox title="Plunger Box" form={form} setField={setField} disabled={disabled}/><PlungerBarrelBox title="Plunger Barrel / Cylinder Barrel Box" form={form} setField={setField} disabled={disabled}/></div><MeasurementRow canEdit={canEdit} label="Plunger Measurement Inspection" onInspection={onInspection}/></section>}
    {asset&&<ReplacementUpdatesPanel asset={asset} form={form} canEdit={canEdit} onReplacement={onReplacement} />}
    <MachineSection title="Notes / Critical Notes"><Area tone="note" label="Notes" value={form.notes} set={v=>setField('notes',v)} disabled={disabled}/><Area tone="critical" label="Critical Notes" value={form.criticalNotes} set={v=>setField('criticalNotes',v)} disabled={disabled}/></MachineSection>
    <div className="machine-placeholder-grid"><section>Linked Inventory Parts coming next</section><section>Machine PM schedules coming next</section><section>Machine documents coming next</section><section>History preview available from Logs</section></div>
    <div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit" disabled={!canEdit}>{asset?'Save Machine Asset':'Create Machine Asset'}</button></div>
  </form></div>;
}
function InjectionSetupModal({setup,setSetup,onContinue,onCancel}:{setup:{hasDoubleShotInjection:boolean;hasPlungerInjection:boolean};setSetup:Dispatch<SetStateAction<{hasDoubleShotInjection:boolean;hasPlungerInjection:boolean}>>;onContinue:()=>void;onCancel:()=>void}) {
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><section className="mcc-card machine-setup-modal"><div className="modal-heading"><div><p className="eyebrow">Machine Asset Setup</p><h3>Machine Injection Setup</h3></div><button className="link-button compact-button" type="button" onClick={onCancel}>Close</button></div><div className="machine-setup-grid"><YesNoToggle label="Does this machine have double shot injection?" value={setup.hasDoubleShotInjection} set={value=>setSetup(current=>({...current,hasDoubleShotInjection:value}))} disabled={false}/><YesNoToggle label="Does this machine have plunger injection?" value={setup.hasPlungerInjection} set={value=>setSetup(current=>({...current,hasPlungerInjection:value}))} disabled={false}/></div><div className="modal-actions"><button className="secondary-button" type="button" onClick={onCancel}>Cancel</button><button className="primary-button" type="button" onClick={onContinue}>Continue</button></div></section></div>;
}
function ImportResultModal({summary,onClose}:{summary:MachineImportSummary;onClose:()=>void}) {
  const rejected = summary.rejectedDuplicates ?? [];
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><section className="mcc-card machine-import-result-modal"><div className="modal-heading"><div><p className="eyebrow">Machine Import</p><h3>Machine import rejected duplicates</h3></div><button className="link-button compact-button" type="button" onClick={onClose}>Close</button></div><div className="machine-import-summary-grid"><div><span>Added</span><strong>{summary.addedCount ?? 0}</strong></div><div><span>Updated</span><strong>{summary.updatedCount ?? 0}</strong></div><div><span>Skipped</span><strong>{summary.skippedCount ?? 0}</strong></div><div><span>Rejected duplicates</span><strong>{summary.rejectedDuplicateCount ?? 0}</strong></div></div><div className="machine-import-rejection-list">{rejected.slice(0,10).map(item=><p key={`${item.rowNumber}-${item.assetNumber}-${item.reason}`}>Row {item.rowNumber}: {item.assetNumber || 'Asset Number'} {item.reason.charAt(0).toLowerCase() + item.reason.slice(1)}</p>)}{rejected.length > 10&&<small>Showing first 10 of {rejected.length} rejected duplicates.</small>}</div><div className="modal-actions"><button className="primary-button" type="button" onClick={onClose}>OK</button></div></section></div>;
}
function YesNoToggle({label,value,set,disabled}:{label:string;value:boolean;set:(value:boolean)=>void;disabled:boolean}) {
  return <div className="form-field machine-yes-no"><span>{label}</span><div><button className={value ? 'primary-button compact-button' : 'secondary-button compact-button'} type="button" onClick={()=>set(true)} disabled={disabled}>Yes</button><button className={!value ? 'primary-button compact-button' : 'secondary-button compact-button'} type="button" onClick={()=>set(false)} disabled={disabled}>No</button></div></div>;
}
function setComponentRebuild<K extends BooleanFormKey, C extends ConditionFormKey>(setField:<T extends keyof AssetForm>(key:T,value:AssetForm[T])=>void,rebuildKey:K,conditionKey:C,checked:boolean) {
  setField(rebuildKey, checked as AssetForm[K]);
  setField(conditionKey, (checked ? 'rebuilt_repaired' : 'new') as AssetForm[C]);
}
function machineComponentClass(tone: 'screw' | 'barrel' | 'screw-secondary' | 'barrel-secondary' | 'plunger' | 'plunger-barrel') {
  return `machine-component-box component-${tone}`;
}
function ScrewBox({title,form,setField,disabled,typeKey,tipTypeKey,rebuildKey,conditionKey,installedDateKey,tipInstalledDateKey,lengthKey,conditionLabel}:{title:string;form:AssetForm;setField:<K extends keyof AssetForm>(key:K,value:AssetForm[K])=>void;disabled:boolean;typeKey:StringFormKey;tipTypeKey:StringFormKey;rebuildKey:BooleanFormKey;conditionKey:ConditionFormKey;installedDateKey:StringFormKey;tipInstalledDateKey:StringFormKey;lengthKey:UnitFieldKey;conditionLabel:string}) {
  return <div className={machineComponentClass(title.includes('2') ? 'screw-secondary' : 'screw')}><h4>{title}</h4><Text label="Screw Type" value={String(form[typeKey] ?? '')} set={v=>setField(typeKey,v as AssetForm[typeof typeKey])} disabled={disabled}/><Text label="Screw Tip Type" value={String(form[tipTypeKey] ?? '')} set={v=>setField(tipTypeKey,v as AssetForm[typeof tipTypeKey])} disabled={disabled}/><Check label={`${title.replace(' Box','')} Rebuild / Repaired`} checked={Boolean(form[rebuildKey])} set={checked=>setComponentRebuild(setField,rebuildKey,conditionKey,checked)} disabled={disabled}/><DateWithAge label={`${title.replace(' Box','')} Installed Date`} value={String(form[installedDateKey] ?? '')} set={v=>setField(installedDateKey,v as AssetForm[typeof installedDateKey])} disabled={disabled}/><DateWithAge label={`${title.replace(' Box','')} Tip Installed Date`} value={String(form[tipInstalledDateKey] ?? '')} set={v=>setField(tipInstalledDateKey,v as AssetForm[typeof tipInstalledDateKey])} disabled={disabled}/><UnitDimensionField label={`${title.replace(' Box','')} Length`} value={String(form[lengthKey] ?? '')} set={v=>setField(lengthKey,v as AssetForm[typeof lengthKey])} disabled={disabled}/><ConditionBadge label={conditionLabel} status={effectiveCondition(Boolean(form[rebuildKey]), String(form[conditionKey]))} /></div>;
}
function BarrelBox({title,form,setField,disabled,diameterKey,rebuildKey,conditionKey,installedDateKey,endCapDateKey,lengthKey,conditionLabel}:{title:string;form:AssetForm;setField:<K extends keyof AssetForm>(key:K,value:AssetForm[K])=>void;disabled:boolean;diameterKey:StringFormKey;rebuildKey:BooleanFormKey;conditionKey:ConditionFormKey;installedDateKey:StringFormKey;endCapDateKey:StringFormKey;lengthKey:UnitFieldKey;conditionLabel:string}) {
  return <div className={machineComponentClass(title.includes('2') ? 'barrel-secondary' : 'barrel')}><h4>{title}</h4><Text label={`${title.replace(' Box','')} Diameter`} value={String(form[diameterKey] ?? '')} set={v=>setField(diameterKey,v as AssetForm[typeof diameterKey])} disabled={disabled}/><Check label={`${title.replace(' Box','')} Rebuild / Repaired`} checked={Boolean(form[rebuildKey])} set={checked=>setComponentRebuild(setField,rebuildKey,conditionKey,checked)} disabled={disabled}/><DateWithAge label={`${title.replace(' Box','')} Installed Date`} value={String(form[installedDateKey] ?? '')} set={v=>setField(installedDateKey,v as AssetForm[typeof installedDateKey])} disabled={disabled}/><DateWithAge label={`${title.replace(' Box','')} End Cap Installed Date`} value={String(form[endCapDateKey] ?? '')} set={v=>setField(endCapDateKey,v as AssetForm[typeof endCapDateKey])} disabled={disabled}/><UnitDimensionField label={`${title.replace(' Box','')} Length`} value={String(form[lengthKey] ?? '')} set={v=>setField(lengthKey,v as AssetForm[typeof lengthKey])} disabled={disabled}/><ConditionBadge label={conditionLabel} status={effectiveCondition(Boolean(form[rebuildKey]), String(form[conditionKey]))} /></div>;
}
function PlungerBox({title,form,setField,disabled}:{title:string;form:AssetForm;setField:<K extends keyof AssetForm>(key:K,value:AssetForm[K])=>void;disabled:boolean}) {
  return <div className={machineComponentClass('plunger')}><h4>{title}</h4><Text label="Plunger Type" value={form.plungerType} set={v=>setField('plungerType',v)} disabled={disabled}/><Check label="Plunger Rebuild / Repaired" checked={form.plungerRebuildRepaired} set={checked=>setComponentRebuild(setField,'plungerRebuildRepaired','plungerConditionStatus',checked)} disabled={disabled}/><DateWithAge label="Plunger Installed Date" value={form.plungerInstalledDate} set={v=>setField('plungerInstalledDate',v)} disabled={disabled}/><UnitDimensionField label="Plunger Length" value={form.plungerLength} set={v=>setField('plungerLength',v)} disabled={disabled}/><UnitDimensionField label="Plunger Diameter" value={form.plungerDiameter} set={v=>setField('plungerDiameter',v)} disabled={disabled}/><ConditionBadge label="Plunger condition" status={effectiveCondition(form.plungerRebuildRepaired, form.plungerConditionStatus)} /></div>;
}
function PlungerBarrelBox({title,form,setField,disabled}:{title:string;form:AssetForm;setField:<K extends keyof AssetForm>(key:K,value:AssetForm[K])=>void;disabled:boolean}) {
  return <div className={machineComponentClass('plunger-barrel')}><h4>{title}</h4><Text label="Plunger Barrel Type" value={form.plungerBarrelType} set={v=>setField('plungerBarrelType',v)} disabled={disabled}/><Check label="Plunger Barrel Rebuild / Repaired" checked={form.plungerBarrelRebuildRepaired} set={checked=>setComponentRebuild(setField,'plungerBarrelRebuildRepaired','plungerBarrelConditionStatus',checked)} disabled={disabled}/><DateWithAge label="Plunger Barrel Installed Date" value={form.plungerBarrelInstalledDate} set={v=>setField('plungerBarrelInstalledDate',v)} disabled={disabled}/><DateWithAge label="Plunger Barrel End Cap Installed Date" value={form.plungerBarrelEndCapInstalledDate} set={v=>setField('plungerBarrelEndCapInstalledDate',v)} disabled={disabled}/><UnitDimensionField label="Plunger Barrel Length" value={form.plungerBarrelLength} set={v=>setField('plungerBarrelLength',v)} disabled={disabled}/><UnitDimensionField label="Plunger Barrel Diameter" value={form.plungerBarrelDiameter} set={v=>setField('plungerBarrelDiameter',v)} disabled={disabled}/><ConditionBadge label="Plunger Barrel condition" status={effectiveCondition(form.plungerBarrelRebuildRepaired, form.plungerBarrelConditionStatus)} /></div>;
}
function MeasurementRow({canEdit,label,onInspection}:{canEdit:boolean;label:string;onInspection:()=>void}) {
  return <div className="measurement-inspection-row">{canEdit&&<button className="machine-action-badge measurement-inspection-button" type="button" onClick={onInspection}>{label}</button>}<small>Measurement Inspection later will update New to Used to Worn for screw, barrel, and plunger components.</small></div>;
}
function ReplacementUpdatesPanel({asset,form,canEdit,onReplacement}:{asset:MachineAsset;form:AssetForm;canEdit:boolean;onReplacement:(asset:MachineAsset,field:ReplacementField)=>void}) {
  const groups = replacementGroups.filter(group=>group.enabled(form));
  return <section className="machine-replacement-panel"><span>Replacement Updates</span><div className="machine-replacement-groups">{groups.map(group=><div className="machine-replacement-group" key={group.title}><strong>{group.title}</strong><div className="machine-replacement-actions">{group.fields.map(field=><button className="machine-action-badge" type="button" key={field} onClick={()=>onReplacement(asset,field)} disabled={!canEdit}><span aria-hidden="true">+</span>New {replacementLabels[field]}</button>)}</div></div>)}</div></section>;
}
function MachineSection({title,children}:{title:string;children:ReactNode}) { return <section className="machine-form-section"><span>{title}</span><div className="machine-form-grid">{children}</div></section>; }
function Text({label,value,set,disabled,helper}:{label:string;value:string;set:(value:string)=>void;disabled:boolean;helper?:ReactNode}) { return <label className="form-field"><span>{label}</span><input value={value} disabled={disabled} onChange={event=>set(event.target.value)} />{helper}</label>; }
function DecimalInput({label,value,set,disabled}:{label:string;value:string;set:(value:string)=>void;disabled:boolean}) { return <label className="form-field"><span>{label}</span><input type="number" step="0.01" inputMode="decimal" value={value} disabled={disabled} onChange={event=>set(event.target.value)} /></label>; }
function Area({label,value,set,disabled,tone}:{label:string;value:string;set:(value:string)=>void;disabled:boolean;tone?:'note'|'critical'}) { return <label className={`form-field machine-form-wide ${tone === 'critical' ? 'machine-critical-field' : tone === 'note' ? 'machine-note-field' : ''}`}><span>{label}</span><textarea value={value} disabled={disabled} onChange={event=>set(event.target.value)} /></label>; }
function Select({label,value,set,options,disabled}:{label:string;value:string;set:(value:string)=>void;options:string[];disabled:boolean}) { return <label className="form-field"><span>{label}</span><select value={value} disabled={disabled} onChange={event=>set(event.target.value)}>{options.map(option=><option key={option} value={option}>{option || 'Select'}</option>)}</select></label>; }
function Check({label,checked,set,disabled}:{label:string;checked:boolean;set:(checked:boolean)=>void;disabled:boolean}) { return <label className="machine-check-field"><input type="checkbox" checked={checked} disabled={disabled} onChange={event=>set(event.target.checked)} /><span>{label}</span></label>; }
function DateWithAge({label,value,set,disabled}:{label:string;value:string;set:(value:string)=>void;disabled:boolean}) {
  const isoValue = isoDateValue(value);
  const useDatePicker = isoValue !== null;
  if (!useDatePicker) return <label className="form-field machine-date-field"><span>{label}</span><input value={value} disabled={disabled} onChange={event=>set(event.target.value)} placeholder="YYYY-MM-DD or known text" /><small className="machine-age-label">Year count: {ageYears(value)}</small></label>;
  return <MccDateField label={label} value={isoValue} set={set} disabled={disabled} ageText={ageYears(value)} />;
}
function MccDateField({label,value,set,disabled,ageText}:{label:string;value:string;set:(value:string)=>void;disabled:boolean;ageText:string}) {
  const today = useMemo(()=>new Date(),[]);
  const selectedDate = parseIsoDate(value);
  const [open,setOpen]=useState(false);
  const [viewDate,setViewDate]=useState<Date>(selectedDate ?? today);
  const wrapRef=useRef<HTMLLabelElement>(null);
  const viewYear = viewDate.getFullYear();
  const viewMonth = viewDate.getMonth();
  const monthStart = new Date(viewYear, viewMonth, 1);
  const gridStart = new Date(viewYear, viewMonth, 1 - monthStart.getDay());
  const days = Array.from({length:42},(_,index)=>new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index));
  const selectedIso = selectedDate ? localIsoDate(selectedDate) : '';
  const todayIso = localIsoDate(today);
  useEffect(()=>{
    if(!open) return;
    setViewDate(selectedDate ?? today);
  },[open,selectedIso,today]);
  useEffect(()=>{
    if(!open) return;
    function onPointerDown(event: PointerEvent) {
      if(wrapRef.current&&!wrapRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if(event.key==='Escape') setOpen(false);
    }
    document.addEventListener('pointerdown',onPointerDown);
    document.addEventListener('keydown',onKeyDown);
    return ()=>{
      document.removeEventListener('pointerdown',onPointerDown);
      document.removeEventListener('keydown',onKeyDown);
    };
  },[open]);
  function chooseDate(date: Date) {
    set(localIsoDate(date));
    setOpen(false);
  }
  function moveMonth(offset: number) {
    setViewDate(current=>new Date(current.getFullYear(), current.getMonth() + offset, 1));
  }
  return <label className={open?'form-field machine-date-field mcc-date-open':'form-field machine-date-field'} ref={wrapRef}><span>{label}</span><div className="mcc-date-control"><input className="mcc-date-input" type="text" inputMode="numeric" value={value} disabled={disabled} onFocus={()=>setOpen(true)} onChange={event=>set(event.target.value)} placeholder="YYYY-MM-DD" /><button className="mcc-date-trigger" type="button" aria-label={`Open ${label} calendar`} disabled={disabled} onClick={()=>setOpen(current=>!current)}><span className="mcc-date-icon" aria-hidden="true" /></button>{open&&<div className="mcc-date-popover" role="dialog" aria-label={`${label} calendar`}><div className="mcc-date-header"><button type="button" onClick={()=>moveMonth(-1)} aria-label="Previous month">&lt;</button><strong>{viewDate.toLocaleString(undefined,{month:'long',year:'numeric'})}</strong><button type="button" onClick={()=>moveMonth(1)} aria-label="Next month">&gt;</button></div><div className="mcc-date-weekdays" aria-hidden="true">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(day=><span key={day}>{day}</span>)}</div><div className="mcc-date-grid">{days.map(day=>{ const iso=localIsoDate(day); const outside=day.getMonth()!==viewMonth; return <button className={`${outside?'outside ':''}${iso===todayIso?'today ':''}${iso===selectedIso?'selected ':''}`.trim()} type="button" key={iso} onClick={()=>chooseDate(day)} aria-label={day.toLocaleDateString(undefined,{dateStyle:'full'})} aria-pressed={iso===selectedIso}>{day.getDate()}</button>; })}</div><div className="mcc-date-footer"><button type="button" onClick={()=>{ set(''); setOpen(false); }}>Clear</button><button type="button" onClick={()=>chooseDate(today)}>Today</button></div></div>}</div><small className="machine-age-label">Year count: {ageText}</small></label>;
}
function ConditionBadge({label,status}:{label:string;status:ConditionStatus}) {
  return <div className={`machine-condition-badge condition-${status}`}><span>{label}</span><strong>{conditionLabels[status]}</strong></div>;
}
function UnitDimensionField({label,value,set,disabled}:{label:string;value:string;set:(value:string)=>void;disabled:boolean}) {
  const [isEditing,setIsEditing]=useState(!parseDimensionValue(value));
  const parsed = parseDimensionValue(value);
  const hasValue = Boolean(value.trim());
  const showInput = isEditing || !hasValue || !parsed;
  return <div className="form-field machine-unit-field">
    <span>{label}</span>
    {showInput ? <>
      <input value={value} disabled={disabled} onChange={event=>set(event.target.value)} onBlur={()=>{ if (parseDimensionValue(value)) setIsEditing(false); }} placeholder="100mm, 72in, 6ft" />
      {hasValue&&!parsed&&<small className="machine-unit-warning">Enter a value like 100mm, 72in, or 6ft.</small>}
    </> : <div className="machine-unit-display"><div><span className="unit-mm">{formatUnitNumber(parsed.mm, 1)}mm</span><span className="unit-in">{formatUnitNumber(parsed.inches, 2)}in</span><span className="unit-ft">{formatUnitNumber(parsed.feet, 2)}ft</span></div>{!disabled&&<button className="machine-unit-edit" type="button" onClick={()=>setIsEditing(true)} aria-label={`Edit ${label}`}>Edit</button>}</div>}
  </div>;
}
function BrandColorModal({brandSettings,colorDrafts,setColorDrafts,canEdit,onSave,onClose}:{brandSettings:BrandSetting[];colorDrafts:Record<string,string>;setColorDrafts:Dispatch<SetStateAction<Record<string,string>>>;canEdit:boolean;onSave:(brandName:string)=>void;onClose:()=>void}) {
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><section className="mcc-card machine-color-modal"><div className="modal-heading"><div><p className="eyebrow">Brand Color Settings</p><h3>Machine Brand Colors</h3></div><button className="link-button compact-button" type="button" onClick={onClose}>Close</button></div>{brandSettings.map(setting=><div className="machine-color-row" key={setting.brandName}><span className={`machine-color-swatch ${isEngelBrand(setting.brandName) ? 'machine-color-swatch-engel' : ''}`} style={{background:safeCssHex(colorDrafts[setting.brandName] ?? setting.colorHex)}} /><strong>{setting.brandName}</strong><input value={colorDrafts[setting.brandName] ?? setting.colorHex} disabled={!canEdit} onChange={event=>setColorDrafts(current=>({...current,[setting.brandName]:event.target.value}))} /><button className="secondary-button compact-button" type="button" onClick={()=>onSave(setting.brandName)} disabled={!canEdit}>Save</button></div>)}</section></div>;
}
function ReplacementModal({replacement,setReplacement,onSubmit}:{replacement:{asset:MachineAsset;field:ReplacementField;installDate:string;reasonNote:string};setReplacement:Dispatch<SetStateAction<{asset:MachineAsset;field:ReplacementField;installDate:string;reasonNote:string}|null>>;onSubmit:(event:FormEvent)=>void}) {
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><form className="mcc-card machine-small-modal" onSubmit={onSubmit}><p className="eyebrow">Replacement Update</p><h3>Update New {replacementLabels[replacement.field]} Install Date</h3><DateWithAge label="Install Date *" value={replacement.installDate} set={installDate=>setReplacement(current=>current&&({...current,installDate}))} disabled={false}/><Area label="Reason / Note" value={replacement.reasonNote} set={reasonNote=>setReplacement(current=>current&&({...current,reasonNote}))} disabled={false}/><div className="modal-actions"><button className="secondary-button" type="button" onClick={()=>setReplacement(null)}>Cancel</button><button className="primary-button" type="submit">Update {replacementLabels[replacement.field]} Date</button></div></form></div>;
}
function LogsModal({logs,onClose,onBackToAsset}:{logs:{asset:MachineAsset;records:HistoryRecord[]};onClose:()=>void;onBackToAsset:()=>void}) {
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><section className="mcc-card machine-logs-modal"><div className="modal-heading"><div><p className="eyebrow">Machine Asset History</p><h3>{logs.asset.assetNumber}</h3></div><button className="link-button compact-button" type="button" onClick={onClose}>Close</button></div><div className="machine-log-list">{logs.records.map(record=><article className="machine-log-row" key={record.id}><span>{formatDateTime(record.createdAt)}</span><strong>{actionLabel(record.action)}</strong><p>{record.userName || 'Unknown'} / {record.reasonNote || 'No reason note'}</p></article>)}{!logs.records.length&&<p className="form-message">No machine-specific logs yet.</p>}</div><div className="modal-actions"><button className="secondary-button" type="button" onClick={onBackToAsset}>Back to Asset</button><button className="primary-button" type="button" onClick={onClose}>Done</button></div></section></div>;
}
