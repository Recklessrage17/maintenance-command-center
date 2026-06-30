import { type CSSProperties, type Dispatch, type FormEvent, type MouseEvent, type ReactNode, type SetStateAction, useEffect, useMemo, useRef, useState } from 'react';

type MachineConditionStatus = 'new' | 'used' | 'worn' | 'rebuilt_repaired';
type MachineAsset = {
  id: number; assetNumber: string; assetName: string; brand: string; model: string; serialNumber: string; machineYear: string; machineType: string; powerType: string; shotSizeOz: number; tonnage: number; barrelDiameter: string; location: string; department: string; status: string; voltageValue: string; voltageType: string; fullLoadAmp: string; machineLength: string; machineWidth: string; machineHeight: string; fullDieHeightLength: string; screwType: string; screwTipType: string; screwTipInstalledDate: string; screwInstalledDate: string; barrelInstalledDate: string; barrelEndCapInstalledDate: string; barrelLength: string; screwLength: string; notes: string; criticalNotes: string; screwRebuildRepaired: boolean; barrelRebuildRepaired: boolean; screwConditionStatus: MachineConditionStatus; barrelConditionStatus: MachineConditionStatus; brandColorHex: string; createdAt: string; updatedAt: string;
};
type BrandSetting = { brandName: string; colorHex: string };
type HistoryRecord = { id: number; action: string; entityLabel: string; userName: string; reasonNote: string; createdAt: string };
type AssetForm = Omit<MachineAsset, 'id' | 'brandColorHex' | 'createdAt' | 'updatedAt' | 'shotSizeOz' | 'tonnage'> & { shotSizeOz: string; tonnage: string };
type ReplacementField = 'screw' | 'screw_tip' | 'barrel' | 'barrel_end_cap';
type EditorStatus = { kind: 'saving' | 'success' | 'error'; text: string; field?: keyof AssetForm } | null;
type ValidationResult = { message: string; field: keyof AssetForm } | null;
type MachineImportMode = 'add-only' | 'upsert';
type MachineImportSummary = { ok?: boolean; mode?: MachineImportMode; addedCount: number; updatedCount: number; skippedCount: number; rejectedDuplicateCount: number; errorCount: number; errors: string[]; rejectedDuplicates: string[] };
type PageMessage = { kind: 'success' | 'error' | 'warning'; text: string };

const blankAssetForm: AssetForm = {
  assetNumber: '', assetName: '', brand: '', model: '', serialNumber: '', machineYear: '', machineType: 'Injection Molding Machine', powerType: '', shotSizeOz: '', tonnage: '', barrelDiameter: '', location: '', department: '', status: 'active', voltageValue: '', voltageType: '', fullLoadAmp: '', machineLength: '', machineWidth: '', machineHeight: '', fullDieHeightLength: '', screwType: '', screwTipType: '', screwTipInstalledDate: '', screwInstalledDate: '', barrelInstalledDate: '', barrelEndCapInstalledDate: '', barrelLength: '', screwLength: '', notes: '', criticalNotes: '', screwRebuildRepaired: false, barrelRebuildRepaired: false, screwConditionStatus: 'new', barrelConditionStatus: 'new',
};
const replacementLabels: Record<ReplacementField, string> = { screw: 'Screw', screw_tip: 'Screw Tip', barrel: 'Barrel', barrel_end_cap: 'Barrel End Cap' };
const editableRoles = new Set(['Maintenance Tech 3','Manager','Admin']);
const deleteRoles = new Set(['Manager','Admin']);
const conditionLabels: Record<MachineConditionStatus, { label: string; tone: string }> = {
  new: { label: 'New', tone: 'new' },
  used: { label: 'Used', tone: 'used' },
  worn: { label: 'Worn', tone: 'worn' },
  rebuilt_repaired: { label: 'Rebuilt / Repaired', tone: 'rebuilt' },
};

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { credentials: 'include', headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) }, ...options });
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(data.error || 'Request failed.');
  return data as T;
}
async function apiForm<T>(path: string, formData: FormData): Promise<T> {
  const res = await fetch(path, { method: 'POST', credentials: 'include', body: formData });
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(data.error || 'Request failed.');
  return data as T;
}
async function downloadFile(path: string, fallbackFileName: string) {
  const res = await fetch(path, { credentials: 'include' });
  if (!res.ok) {
    const data = await res.json().catch(()=>({}));
    throw new Error(data.error || 'Download failed.');
  }
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') ?? '';
  const match = disposition.match(/filename="?([^"]+)"?/i);
  const fileName = match?.[1] || fallbackFileName;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
function formatMachineNumber(value: number | string) {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return '';
  return Number.isInteger(numeric) ? String(numeric) : String(numeric);
}
function machineDisplayNumber(value: number) {
  return value ? formatMachineNumber(value) : '-';
}
function assetToForm(asset: MachineAsset): AssetForm {
  const { id: _id, brandColorHex: _color, createdAt: _created, updatedAt: _updated, shotSizeOz, tonnage, ...form } = asset;
  return { ...form, shotSizeOz: shotSizeOz ? formatMachineNumber(shotSizeOz) : '', tonnage: tonnage ? formatMachineNumber(tonnage) : '' };
}
function payloadFromForm(form: AssetForm) {
  return {
    ...form,
    shotSizeOz: form.shotSizeOz.trim(),
    tonnage: form.tonnage.trim(),
  };
}
function formsEqual(left: AssetForm, right: AssetForm) {
  return JSON.stringify(payloadFromForm(left)) === JSON.stringify(payloadFromForm(right));
}
function validateAssetForm(form: AssetForm): ValidationResult {
  if (!form.assetNumber.trim()) return { message: 'Asset Number is required.', field: 'assetNumber' };
  if (!form.brand.trim()) return { message: 'Brand is required.', field: 'brand' };
  const shotSize = form.shotSizeOz.trim();
  if (shotSize) {
    const parsed = Number(shotSize.replace(/,/g, ''));
    if (!Number.isFinite(parsed)) return { message: 'Shot Size must be numeric.', field: 'shotSizeOz' };
    if (parsed < 0) return { message: 'Shot Size must be zero or greater.', field: 'shotSizeOz' };
  }
  return null;
}
function formatDateTime(value?: string) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined,{dateStyle:'short',timeStyle:'short'}).format(date);
}
function actionLabel(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, letter=>letter.toUpperCase());
}
function isExactDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
function ageYears(value: string) {
  if (!value.trim() || !isExactDate(value.trim())) return 'Unknown';
  const date = new Date(`${value.trim()}T00:00:00`);
  const years = (Date.now() - date.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  return years < 0 ? 'Unknown' : `${years.toFixed(1)} years`;
}
function safeCssHex(value: string) {
  return /^#[0-9A-Fa-f]{6}$/.test(value) ? value : '#44D7FF';
}
function conditionInfo(status: MachineConditionStatus, rebuilt: boolean) {
  return conditionLabels[rebuilt ? 'rebuilt_repaired' : status] ?? conditionLabels.new;
}
function formatMm(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
function formatInches(value: number) {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}
function dimensionConversion(value: string): { mm: string; inches: string } | null | 'invalid' {
  const clean = value.trim();
  if (!clean || /^\d+(?:\.\d+)?$/.test(clean)) return null;
  const match = clean.match(/^(\d+(?:\.\d+)?)\s*(mm|millimeters?|in|inch(?:es)?|")$/i);
  if (!match) return 'invalid';
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return 'invalid';
  const unit = match[2].toLowerCase();
  const mm = unit.startsWith('mm') || unit.startsWith('millimeter') ? amount : amount * 25.4;
  const inches = unit.startsWith('in') || unit === '"' ? amount : amount / 25.4;
  return { mm: formatMm(mm), inches: formatInches(inches) };
}
export function MachineLibraryPage({ userRole = '' }: { userRole?: string }) {
  const [assets,setAssets]=useState<MachineAsset[]>([]);
  const [brandSettings,setBrandSettings]=useState<BrandSetting[]>([]);
  const [permissions,setPermissions]=useState({canEdit:editableRoles.has(userRole),canDelete:deleteRoles.has(userRole)});
  const [search,setSearch]=useState('');
  const [brandFilter,setBrandFilter]=useState('');
  const [statusFilter,setStatusFilter]=useState('');
  const [message,setMessage]=useState<PageMessage|null>(null);
  const [toolsOpen,setToolsOpen]=useState(false);
  const [toolsBusy,setToolsBusy]=useState('');
  const [machineImportFile,setMachineImportFile]=useState<File|null>(null);
  const [machineImportMode,setMachineImportMode]=useState<MachineImportMode>('add-only');
  const [machineImportSummary,setMachineImportSummary]=useState<MachineImportSummary|null>(null);
  const [duplicateWarning,setDuplicateWarning]=useState<MachineImportSummary|null>(null);
  const [editing,setEditing]=useState<MachineAsset|null>(null);
  const [form,setForm]=useState<AssetForm>(blankAssetForm);
  const [showEditor,setShowEditor]=useState(false);
  const [editorSaving,setEditorSaving]=useState(false);
  const [editorStatus,setEditorStatus]=useState<EditorStatus>(null);
  const [showInspectionNotice,setShowInspectionNotice]=useState(false);
  const [showColors,setShowColors]=useState(false);
  const [colorDrafts,setColorDrafts]=useState<Record<string,string>>({});
  const [logs,setLogs]=useState<{asset:MachineAsset;records:HistoryRecord[]}|null>(null);
  const [replacement,setReplacement]=useState<{asset:MachineAsset;field:ReplacementField;installDate:string;reasonNote:string}|null>(null);
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

  function editorBaseline() {
    return editing ? assetToForm(editing) : blankAssetForm;
  }
  function editorHasChanges() {
    return !formsEqual(form, editorBaseline());
  }
  function closeEditor() {
    if (editorSaving) return;
    setShowEditor(false);
    setEditing(null);
    setEditorStatus(null);
  }
  function requestCloseEditor() {
    if (editorSaving) return;
    if (canEdit && editorHasChanges() && !window.confirm('Discard unsaved machine asset changes?')) return;
    closeEditor();
  }
  function openAdd() {
    setEditing(null);
    setForm(blankAssetForm);
    setEditorStatus(null);
    setShowEditor(true);
  }
  function openEdit(asset: MachineAsset) {
    setEditing(asset);
    setForm(assetToForm(asset));
    setEditorStatus(null);
    setShowEditor(true);
  }
  function setField<K extends keyof AssetForm>(key: K, value: AssetForm[K]) {
    setForm(current=>({...current,[key]:value}));
  }
  async function persistAsset(source: 'manual' | 'outside'): Promise<boolean> {
    if (!canEdit || editorSaving) return false;
    const validation = validateAssetForm(form);
    if (validation) {
      setEditorStatus({kind:'error',text:validation.message,field:validation.field});
      return false;
    }
    try {
      setEditorSaving(true);
      setEditorStatus({kind:'saving',text:'Saving...'});
      const path = editing ? `/api/machine-library/assets/${editing.id}` : '/api/machine-library/assets';
      const method = editing ? 'PUT' : 'POST';
      await api<{ok:boolean;asset:MachineAsset}>(path,{method,body:JSON.stringify(payloadFromForm(form))});
      setEditorStatus({kind:'success',text:'Saved'});
      setMessage({kind:'success',text:editing ? 'Machine asset updated.' : 'Machine asset created.'});
      loadAssets();
      window.setTimeout(()=>{ setShowEditor(false); setEditing(null); setEditorStatus(null); }, source === 'outside' ? 320 : 120);
      return true;
    } catch (error) {
      const text = (error as Error).message;
      setEditorStatus({kind:'error',text});
      setMessage({kind:'error',text});
      return false;
    } finally {
      setEditorSaving(false);
    }
  }
  async function saveAsset(event: FormEvent) {
    event.preventDefault();
    await persistAsset('manual');
  }
  async function autosaveFromOutsideClick() {
    if (editorSaving) return false;
    if (!canEdit || !editorHasChanges()) {
      closeEditor();
      return true;
    }
    return persistAsset('outside');
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
  function importCompleteMessage(summary: MachineImportSummary) {
    return `Machine import complete: ${summary.addedCount} added, ${summary.updatedCount} updated, ${summary.rejectedDuplicateCount} rejected.`;
  }
  function showImportCompletion(summary: MachineImportSummary) {
    setMessage({kind: summary.addedCount + summary.updatedCount > 0 ? 'success' : 'warning', text: importCompleteMessage(summary)});
  }
  async function runMachineDownload(endpoint: string, fallbackFileName: string, successText: string) {
    if (!canEdit || toolsBusy) return;
    setToolsBusy(endpoint);
    setMessage(null);
    try {
      await downloadFile(endpoint, fallbackFileName);
      setMessage({kind:'success',text:successText});
    } catch (error) {
      setMessage({kind:'error',text:(error as Error).message});
    } finally {
      setToolsBusy('');
    }
  }
  async function importMachineFile() {
    if (!canEdit || toolsBusy || !machineImportFile) return;
    setToolsBusy('machine-import');
    setMessage(null);
    setMachineImportSummary(null);
    setDuplicateWarning(null);
    try {
      const formData = new FormData();
      formData.append('file', machineImportFile);
      formData.append('mode', machineImportMode);
      const result = await apiForm<MachineImportSummary>('/api/machine-library/import', formData);
      setMachineImportSummary(result);
      setMachineImportFile(null);
      loadAssets();
      if (result.rejectedDuplicateCount > 0) {
        setDuplicateWarning(result);
      } else {
        showImportCompletion(result);
      }
    } catch (error) {
      setMessage({kind:'error',text:(error as Error).message});
    } finally {
      setToolsBusy('');
    }
  }
  function acknowledgeDuplicateWarning() {
    if (duplicateWarning) showImportCompletion(duplicateWarning);
    setDuplicateWarning(null);
  }

  return (
    <div className="page-stack machine-library-page">
      <div className="page-heading machine-heading">
        <p className="eyebrow">Machine Library</p>
        <h2>Machine Assets</h2>
        <p>Injection molding machine records, technical specs, replacement tracking, brand colors, and machine-specific history.</p>
      </div>
      {message&&<p className={message.kind==='error'?'form-message inventory-toast error':message.kind==='warning'?'form-message inventory-toast warning':'form-message inventory-toast'}>{message.text}<button className="toast-close-button" type="button" onClick={()=>setMessage(null)}>Close</button></p>}
      <section className="mcc-card machine-toolbar-card">
        <label className="form-field machine-search"><span>Search assets</span><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Press 14, Toyo, model, serial number..." /></label>
        <label className="form-field"><span>Brand</span><select value={brandFilter} onChange={event=>setBrandFilter(event.target.value)}><option value="">All brands</option>{brands.map(brand=><option key={brand} value={brand}>{brand}</option>)}</select></label>
        <label className="form-field"><span>Status</span><select value={statusFilter} onChange={event=>setStatusFilter(event.target.value)}><option value="">All status</option><option value="active">Active</option><option value="down">Down</option><option value="disabled">Disabled</option><option value="removed">Removed</option></select></label>
        <div className="machine-toolbar-actions">
          <button className="primary-button compact-button" type="button" onClick={openAdd} disabled={!canEdit}>Add Machine Asset</button>
          <button className={toolsOpen?'secondary-button compact-button active':'secondary-button compact-button'} type="button" onClick={()=>setToolsOpen(current=>!current)} disabled={!canEdit} aria-expanded={toolsOpen} aria-controls="machine-tools-panel">Tools</button>
          <button className="secondary-button compact-button" type="button" onClick={()=>setShowColors(true)}>Brand Color Settings</button>
        </div>
        {!canEdit&&<p className="form-help machine-toolbar-note">Tier 3, Manager, Admin, or Owner Admin access is required to add or edit machine assets.</p>}
      </section>
      {canEdit&&toolsOpen&&(
        <section className="mcc-card inventory-tools-card machine-tools-card" id="machine-tools-panel">
          <div className="inventory-tools-heading">
            <div>
              <span>Machine Library Tools</span>
              <strong>Machine import / export templates</strong>
            </div>
            <button className="link-button compact-button" type="button" onClick={()=>setToolsOpen(false)}>Close</button>
          </div>
          <div className="inventory-tools-grid machine-tools-grid">
            <div className="inventory-tools-panel">
              <span>Exports</span>
              <div className="inventory-tool-actions">
                <button className="secondary-button compact-button" type="button" onClick={()=>void runMachineDownload('/api/machine-library/export/csv',`MCC_Machine_Assets_Export_${new Date().toISOString().slice(0,10)}.csv`,'Machine CSV export downloaded.')} disabled={Boolean(toolsBusy)}>Export CSV</button>
                <button className="secondary-button compact-button" type="button" onClick={()=>void runMachineDownload('/api/machine-library/export/excel-update-template',`MCC_Machine_Update_Template_${new Date().toISOString().slice(0,10)}.xlsx`,'Machine Excel update template downloaded.')} disabled={Boolean(toolsBusy)}>Export Excel Update Template</button>
                <button className="secondary-button compact-button" type="button" onClick={()=>void runMachineDownload('/api/machine-library/export/blank-import-template','MCC_Machine_Blank_Import_Template.xlsx','Machine blank import template downloaded.')} disabled={Boolean(toolsBusy)}>Export Blank Import Template</button>
              </div>
            </div>
            <div className="inventory-tools-panel">
              <span>Import CSV / Excel</span>
              <label className="form-field machine-import-mode"><span>Import mode</span><select value={machineImportMode} onChange={event=>setMachineImportMode(event.target.value as MachineImportMode)} disabled={Boolean(toolsBusy)}><option value="add-only">Add new only</option><option value="upsert">Update existing / upsert</option></select></label>
              <div className="inventory-import-row">
                <input type="file" accept=".csv,.xlsx" onChange={event=>setMachineImportFile(event.target.files?.[0] ?? null)} />
                <button className="primary-button compact-button" type="button" onClick={()=>void importMachineFile()} disabled={Boolean(toolsBusy)||!machineImportFile}>Import File</button>
              </div>
              <p className="form-message">Asset Number is the key. Add new only rejects existing Asset Numbers.</p>
            </div>
          </div>
          {machineImportSummary&&(
            <div className={machineImportSummary.addedCount + machineImportSummary.updatedCount > 0 ? 'inventory-tool-summary' : 'inventory-tool-summary warning'}>
              <strong>{machineImportSummary.addedCount} added / {machineImportSummary.updatedCount} updated / {machineImportSummary.rejectedDuplicateCount} rejected duplicates / {machineImportSummary.skippedCount} skipped</strong>
              <span>Mode: {machineImportSummary.mode === 'upsert' ? 'Update existing / upsert' : 'Add new only'}</span>
              {machineImportSummary.errors.length>0&&(
                <ul>
                  {machineImportSummary.errors.slice(0,5).map((item,index)=><li key={`${item}-${index}`}>{item}</li>)}
                  {machineImportSummary.errorCount>5&&<li>Showing first 5 of {machineImportSummary.errorCount} import messages.</li>}
                </ul>
              )}
            </div>
          )}
        </section>
      )}
      <div className="machine-card-grid">
        {assets.map(asset=>{
          const screwCondition = conditionInfo(asset.screwConditionStatus, asset.screwRebuildRepaired);
          const barrelCondition = conditionInfo(asset.barrelConditionStatus, asset.barrelRebuildRepaired);
          return (
            <article className="machine-asset-card" style={{'--brand-color':safeCssHex(asset.brandColorHex)} as CSSProperties} key={asset.id}>
              <div className="machine-card-head">
                <button className="machine-asset-number" type="button" onClick={()=>void loadLogs(asset)}>{asset.assetNumber}</button>
                <span className={`machine-status-badge status-${asset.status}`}>{asset.status}</span>
              </div>
              <div className="machine-card-title"><strong>{asset.brand || 'Unknown'}</strong><span>{asset.model || 'Model not set'} / S/N: {asset.serialNumber || '-'}</span></div>
              <dl className="machine-spec-grid">
                <div><dt>Tonnage</dt><dd>{machineDisplayNumber(asset.tonnage)}</dd></div><div><dt>Shot Size</dt><dd>{machineDisplayNumber(asset.shotSizeOz)} oz</dd></div><div><dt>Barrel</dt><dd>{asset.barrelDiameter || '-'}</dd></div><div><dt>Power</dt><dd>{asset.powerType || '-'}</dd></div>
              </dl>
              <div className="machine-condition-strip">
                <span className={`machine-condition-label condition-${screwCondition.tone}`}>Screw: {screwCondition.label}</span>
                <span className={`machine-condition-label condition-${barrelCondition.tone}`}>Barrel: {barrelCondition.label}</span>
              </div>
              {(asset.notes || asset.criticalNotes)&&<div className="machine-notes-preview">
                {asset.notes&&<p className="machine-notes-text">Notes: {asset.notes}</p>}
                {asset.criticalNotes&&<p className="machine-critical-text">Critical: {asset.criticalNotes}</p>}
              </div>}
              <div className="machine-card-actions">
                <button className="primary-button compact-button" type="button" onClick={()=>openEdit(asset)}>{canEdit?'View/Edit':'View'}</button>
                <button className="secondary-button compact-button" type="button" onClick={()=>void loadLogs(asset)}>Logs</button>
                {canDelete&&asset.status!=='disabled'&&<button className="secondary-button compact-button" type="button" onClick={()=>void disableAsset(asset)}>Disable</button>}
              </div>
            </article>
          );
        })}
        {!assets.length&&<section className="mcc-card machine-empty-card"><strong>No machine assets found.</strong><p>Add a machine asset or import the press list template.</p></section>}
      </div>
      {showEditor&&<MachineEditorModal form={form} setField={setField} onClose={requestCloseEditor} onSubmit={saveAsset} onOutsideAutosave={autosaveFromOutsideClick} canEdit={canEdit} saving={editorSaving} editorStatus={editorStatus} asset={editing} onReplacement={(asset,field)=>setReplacement({asset,field,installDate:'',reasonNote:''})} onInspectionClick={()=>setShowInspectionNotice(true)} />}
      {showColors&&<BrandColorModal brandSettings={brandSettings} colorDrafts={colorDrafts} setColorDrafts={setColorDrafts} canEdit={canEdit} onSave={saveColor} onClose={()=>setShowColors(false)} />}
      {showInspectionNotice&&<InspectionNoticeModal onClose={()=>setShowInspectionNotice(false)} />}
      {duplicateWarning&&<DuplicateWarningModal summary={duplicateWarning} onClose={acknowledgeDuplicateWarning} />}
      {replacement&&<ReplacementModal replacement={replacement} setReplacement={setReplacement} onSubmit={updateReplacement} />}
      {logs&&<LogsModal logs={logs} onClose={()=>setLogs(null)} onBackToAsset={()=>{ setForm(assetToForm(logs.asset)); setEditing(logs.asset); setLogs(null); setShowEditor(true); }} />}
    </div>
  );
}

function MachineEditorModal({form,setField,onClose,onSubmit,onOutsideAutosave,canEdit,saving,editorStatus,asset,onReplacement,onInspectionClick}:{form:AssetForm;setField:<K extends keyof AssetForm>(key:K,value:AssetForm[K])=>void;onClose:()=>void;onSubmit:(event:FormEvent)=>void;onOutsideAutosave:()=>Promise<boolean>;canEdit:boolean;saving:boolean;editorStatus:EditorStatus;asset:MachineAsset|null;onReplacement:(asset:MachineAsset,field:ReplacementField)=>void;onInspectionClick:()=>void}) {
  const disabled = !canEdit || saving;
  const formRef = useRef<HTMLFormElement|null>(null);
  useEffect(()=>{
    if (editorStatus?.kind !== 'error' || !editorStatus.field) return;
    formRef.current?.querySelector<HTMLElement>(`[data-machine-field="${editorStatus.field}"]`)?.focus();
  },[editorStatus]);
  useEffect(()=>{
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  },[onClose]);
  function setScrewRebuildRepaired(checked: boolean) {
    setField('screwRebuildRepaired', checked);
    setField('screwConditionStatus', checked ? 'rebuilt_repaired' : 'new');
  }
  function setBarrelRebuildRepaired(checked: boolean) {
    setField('barrelRebuildRepaired', checked);
    setField('barrelConditionStatus', checked ? 'rebuilt_repaired' : 'new');
  }
  function handleBackdropMouseDown(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) void onOutsideAutosave();
  }
  return <div className="modal-backdrop" role="dialog" aria-modal="true" onMouseDown={handleBackdropMouseDown}><form ref={formRef} className="mcc-card machine-modal" onSubmit={onSubmit}>
    <div className="modal-heading"><div><p className="eyebrow">Machine Asset Detail</p><h3>{form.assetNumber || 'New Machine Asset'}</h3><p>{form.brand || 'Brand'} / {form.model || 'Model'} / S/N: {form.serialNumber || '-'}</p></div><button className="link-button compact-button" type="button" onClick={onClose} disabled={saving}>Close</button></div>
    {editorStatus&&<p className={`form-message machine-save-status ${editorStatus.kind === 'error' ? 'error' : editorStatus.kind}`}>{editorStatus.text}</p>}
    <MachineSection title="Basic Info"><Text field="assetNumber" label="Asset Number / Press Number *" value={form.assetNumber} set={v=>setField('assetNumber',v)} disabled={disabled}/><Text field="assetName" label="Asset Name" value={form.assetName} set={v=>setField('assetName',v)} disabled={disabled}/><Text field="brand" label="Brand *" value={form.brand} set={v=>setField('brand',v)} disabled={disabled}/><Text field="model" label="Model" value={form.model} set={v=>setField('model',v)} disabled={disabled}/><Text field="serialNumber" label="Serial Number" value={form.serialNumber} set={v=>setField('serialNumber',v)} disabled={disabled}/><Text field="machineYear" label="Machine Year" value={form.machineYear} set={v=>setField('machineYear',v)} disabled={disabled}/><Text field="machineType" label="Machine Type" value={form.machineType} set={v=>setField('machineType',v)} disabled={disabled}/><Select field="powerType" label="Power Type" value={form.powerType} set={v=>setField('powerType',v)} options={['','Hydraulic','Electric','Hybrid','Other']} disabled={disabled}/><Text field="shotSizeOz" label="Shot Size (oz)" value={form.shotSizeOz} set={v=>setField('shotSizeOz',v)} disabled={disabled} type="number" step="0.01" min="0"/><Text field="tonnage" label="Tonnage" value={form.tonnage} set={v=>setField('tonnage',v)} disabled={disabled} type="number" step="0.01"/><Text field="barrelDiameter" label="Barrel/Screw Diameter" value={form.barrelDiameter} set={v=>setField('barrelDiameter',v)} disabled={disabled}/><Text field="location" label="Location" value={form.location} set={v=>setField('location',v)} disabled={disabled}/><Select field="status" label="Status" value={form.status} set={v=>setField('status',v)} options={['active','down','disabled','removed']} disabled={disabled}/></MachineSection>
    <MachineSection title="Electrical"><Text field="voltageValue" label="Voltage" value={form.voltageValue} set={v=>setField('voltageValue',v)} disabled={disabled}/><Select field="voltageType" label="Voltage Type" value={form.voltageType} set={v=>setField('voltageType',v)} options={['','AC','DC']} disabled={disabled}/><Text field="fullLoadAmp" label="Full Load Amp" value={form.fullLoadAmp} set={v=>setField('fullLoadAmp',v)} disabled={disabled}/></MachineSection>
    <MachineSection title="Dimensions"><DimensionText field="machineLength" label="Machine Length" value={form.machineLength} set={v=>setField('machineLength',v)} disabled={disabled}/><DimensionText field="machineWidth" label="Machine Width" value={form.machineWidth} set={v=>setField('machineWidth',v)} disabled={disabled}/><DimensionText field="machineHeight" label="Machine Height" value={form.machineHeight} set={v=>setField('machineHeight',v)} disabled={disabled}/><DimensionText field="fullDieHeightLength" label="Full Die Height Length / Range" value={form.fullDieHeightLength} set={v=>setField('fullDieHeightLength',v)} disabled={disabled}/></MachineSection>
    <MachineSection title="Screw / Barrel">
      <ConditionText field="screwType" label="Screw Type" value={form.screwType} set={v=>setField('screwType',v)} disabled={disabled} checked={form.screwRebuildRepaired} setChecked={setScrewRebuildRepaired} condition={conditionInfo(form.screwConditionStatus, form.screwRebuildRepaired)} checkboxLabel="Screw Rebuild / Repaired"/>
      <Text field="screwTipType" label="Screw Tip Type" value={form.screwTipType} set={v=>setField('screwTipType',v)} disabled={disabled}/>
      <DateWithAge field="screwInstalledDate" label="Screw Installed Date" value={form.screwInstalledDate} set={v=>setField('screwInstalledDate',v)} disabled={disabled}/>
      <DateWithAge field="screwTipInstalledDate" label="Screw Tip Installed Date" value={form.screwTipInstalledDate} set={v=>setField('screwTipInstalledDate',v)} disabled={disabled}/>
      <DateWithAge field="barrelInstalledDate" label="Barrel Installed Date" value={form.barrelInstalledDate} set={v=>setField('barrelInstalledDate',v)} disabled={disabled}/>
      <DateWithAge field="barrelEndCapInstalledDate" label="Barrel End Cap Installed Date" value={form.barrelEndCapInstalledDate} set={v=>setField('barrelEndCapInstalledDate',v)} disabled={disabled}/>
      <ConditionDimensionText field="barrelLength" label="Barrel Length" value={form.barrelLength} set={v=>setField('barrelLength',v)} disabled={disabled} checked={form.barrelRebuildRepaired} setChecked={setBarrelRebuildRepaired} condition={conditionInfo(form.barrelConditionStatus, form.barrelRebuildRepaired)} checkboxLabel="Barrel Rebuild / Repaired"/>
      <DimensionText field="screwLength" label="Screw Length" value={form.screwLength} set={v=>setField('screwLength',v)} disabled={disabled}/>
      {canEdit&&<div className="machine-inspection-row machine-form-wide"><button className="machine-action-badge machine-inspection-badge" type="button" onClick={onInspectionClick} disabled={saving}>Measurement Inspection</button></div>}
    </MachineSection>
    {asset&&<section className="machine-replacement-panel"><span>Replacement Updates</span>{(['screw','screw_tip','barrel','barrel_end_cap'] as ReplacementField[]).map(field=><button className="machine-action-badge" type="button" key={field} onClick={()=>onReplacement(asset,field)} disabled={!canEdit || saving}>New {replacementLabels[field]}</button>)}</section>}
    <MachineSection title="Notes / Critical Notes"><Area field="notes" label="Notes" value={form.notes} set={v=>setField('notes',v)} disabled={disabled} tone="notes"/><Area field="criticalNotes" label="Critical Notes" value={form.criticalNotes} set={v=>setField('criticalNotes',v)} disabled={disabled} tone="critical"/></MachineSection>
    <div className="machine-placeholder-grid"><section>Linked Inventory Parts coming next</section><section>Machine PM schedules coming next</section><section>Machine documents coming next</section><section>History preview available from Logs</section></div>
    <div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary-button" type="submit" disabled={!canEdit || saving}>{saving ? 'Saving...' : asset?'Save Machine Asset':'Create Machine Asset'}</button></div>
  </form></div>;
}
function MachineSection({title,children}:{title:string;children:ReactNode}) { return <section className="machine-form-section"><span>{title}</span><div className="machine-form-grid">{children}</div></section>; }
function Text({label,value,set,disabled,field,type='text',step,min}:{label:string;value:string;set:(value:string)=>void;disabled:boolean;field?:string;type?:string;step?:string;min?:string}) { return <label className="form-field"><span>{label}</span><input data-machine-field={field} type={type} step={step} min={min} value={value} disabled={disabled} onChange={event=>set(event.target.value)} /></label>; }
function Area({label,value,set,disabled,field,tone}:{label:string;value:string;set:(value:string)=>void;disabled:boolean;field?:string;tone?:'notes'|'critical'}) { return <label className="form-field machine-form-wide"><span>{label}</span><textarea data-machine-field={field} className={tone === 'critical' ? 'machine-critical-input' : tone === 'notes' ? 'machine-notes-input' : undefined} value={value} disabled={disabled} onChange={event=>set(event.target.value)} /></label>; }
function Select({label,value,set,options,disabled,field}:{label:string;value:string;set:(value:string)=>void;options:string[];disabled:boolean;field?:string}) { return <label className="form-field"><span>{label}</span><select data-machine-field={field} value={value} disabled={disabled} onChange={event=>set(event.target.value)}>{options.map(option=><option key={option} value={option}>{option || 'Select'}</option>)}</select></label>; }
function DateWithAge({label,value,set,disabled,field}:{label:string;value:string;set:(value:string)=>void;disabled:boolean;field?:string}) {
  const pickerRef = useRef<HTMLInputElement|null>(null);
  const pickerValue = isExactDate(value.trim()) ? value.trim() : '';
  function openPicker() {
    const picker = pickerRef.current as (HTMLInputElement & { showPicker?: () => void }) | null;
    picker?.showPicker?.();
    picker?.focus();
  }
  return <div className="form-field"><span>{label}</span><div className="machine-date-row"><input data-machine-field={field} value={value} disabled={disabled} onChange={event=>set(event.target.value)} placeholder="YYYY-MM-DD or known text" /><button className="machine-calendar-button" type="button" onClick={openPicker} disabled={disabled} aria-label={`Pick ${label}`}>Cal</button><input ref={pickerRef} className="machine-date-picker" type="date" value={pickerValue} disabled={disabled} onChange={event=>set(event.target.value)} aria-label={`${label} calendar`} /></div><small className="machine-age-label">Year count: {ageYears(value)}</small></div>;
}
function DimensionPreview({value}:{value:string}) {
  const conversion = dimensionConversion(value);
  if (!conversion) return null;
  if (conversion === 'invalid') return <small className="machine-dimension-preview muted">Unable to convert</small>;
  return <small className="machine-dimension-preview"><span className="dimension-mm">{conversion.mm}mm</span><span className="dimension-separator">/</span><span className="dimension-in">{conversion.inches}in</span></small>;
}
function DimensionText({label,value,set,disabled,field}:{label:string;value:string;set:(value:string)=>void;disabled:boolean;field?:string}) {
  return <label className="form-field"><span>{label}</span><input data-machine-field={field} value={value} disabled={disabled} onChange={event=>set(event.target.value)} placeholder="100mm, 72in, 72&quot;" /><DimensionPreview value={value} /></label>;
}
function ConditionText({label,value,set,disabled,field,checked,setChecked,condition,checkboxLabel}:{label:string;value:string;set:(value:string)=>void;disabled:boolean;field?:string;checked:boolean;setChecked:(checked:boolean)=>void;condition:{label:string;tone:string};checkboxLabel:string}) {
  return <div className="form-field machine-condition-field"><div className="machine-field-title-row"><span>{label}</span><label className="machine-inline-checkbox"><input type="checkbox" checked={checked} disabled={disabled} onChange={event=>setChecked(event.target.checked)} />{checkboxLabel}</label></div><input data-machine-field={field} value={value} disabled={disabled} onChange={event=>set(event.target.value)} /><small className={`machine-condition-label condition-${condition.tone}`}>{condition.label}</small></div>;
}
function ConditionDimensionText({label,value,set,disabled,field,checked,setChecked,condition,checkboxLabel}:{label:string;value:string;set:(value:string)=>void;disabled:boolean;field?:string;checked:boolean;setChecked:(checked:boolean)=>void;condition:{label:string;tone:string};checkboxLabel:string}) {
  return <div className="form-field machine-condition-field"><div className="machine-field-title-row"><span>{label}</span><label className="machine-inline-checkbox"><input type="checkbox" checked={checked} disabled={disabled} onChange={event=>setChecked(event.target.checked)} />{checkboxLabel}</label></div><input data-machine-field={field} value={value} disabled={disabled} onChange={event=>set(event.target.value)} placeholder="100mm, 72in, 72&quot;" /><DimensionPreview value={value} /><small className={`machine-condition-label condition-${condition.tone}`}>{condition.label}</small></div>;
}
function BrandColorModal({brandSettings,colorDrafts,setColorDrafts,canEdit,onSave,onClose}:{brandSettings:BrandSetting[];colorDrafts:Record<string,string>;setColorDrafts:Dispatch<SetStateAction<Record<string,string>>>;canEdit:boolean;onSave:(brandName:string)=>void;onClose:()=>void}) {
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><section className="mcc-card machine-color-modal"><div className="modal-heading"><div><p className="eyebrow">Brand Color Settings</p><h3>Machine Brand Colors</h3></div><button className="link-button compact-button" type="button" onClick={onClose}>Close</button></div>{brandSettings.map(setting=><div className="machine-color-row" key={setting.brandName}><span className="machine-color-swatch" style={{background:safeCssHex(colorDrafts[setting.brandName] ?? setting.colorHex)}} /><strong>{setting.brandName}</strong><input value={colorDrafts[setting.brandName] ?? setting.colorHex} disabled={!canEdit} onChange={event=>setColorDrafts(current=>({...current,[setting.brandName]:event.target.value}))} /><button className="secondary-button compact-button" type="button" onClick={()=>onSave(setting.brandName)} disabled={!canEdit}>Save</button></div>)}</section></div>;
}
function InspectionNoticeModal({onClose}:{onClose:()=>void}) {
  return <div className="modal-backdrop machine-notice-backdrop" role="dialog" aria-modal="true"><section className="mcc-card machine-small-modal"><div className="modal-heading"><div><p className="eyebrow">Measurement Inspection</p><h3>Coming next</h3></div><button className="link-button compact-button" type="button" onClick={onClose}>Close</button></div><p className="form-message">Measurement Inspection form is coming next.</p><p className="form-help">Future inspections will move condition from New to Used to Worn.</p><div className="modal-actions"><button className="primary-button" type="button" onClick={onClose}>Done</button></div></section></div>;
}
function DuplicateWarningModal({summary,onClose}:{summary:MachineImportSummary;onClose:()=>void}) {
  const visible = summary.rejectedDuplicates.slice(0,10);
  return <div className="modal-backdrop machine-notice-backdrop" role="dialog" aria-modal="true"><section className="mcc-card machine-small-modal machine-duplicate-modal"><div className="modal-heading"><div><p className="eyebrow">Machine Import</p><h3>Machine import rejected duplicates</h3></div></div><div className="machine-import-counts"><span>Added: {summary.addedCount}</span><span>Updated: {summary.updatedCount}</span><span>Rejected duplicates: {summary.rejectedDuplicateCount}</span><span>Skipped: {summary.skippedCount}</span></div><ul className="machine-duplicate-list">{visible.map((item,index)=><li key={`${item}-${index}`}>{item}</li>)}{summary.rejectedDuplicateCount>10&&<li>Showing first 10 of {summary.rejectedDuplicateCount} rejected duplicates.</li>}</ul><div className="modal-actions"><button className="primary-button" type="button" onClick={onClose}>OK</button></div></section></div>;
}
function ReplacementModal({replacement,setReplacement,onSubmit}:{replacement:{asset:MachineAsset;field:ReplacementField;installDate:string;reasonNote:string};setReplacement:Dispatch<SetStateAction<{asset:MachineAsset;field:ReplacementField;installDate:string;reasonNote:string}|null>>;onSubmit:(event:FormEvent)=>void}) {
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><form className="mcc-card machine-small-modal" onSubmit={onSubmit}><p className="eyebrow">Replacement Update</p><h3>Update New {replacementLabels[replacement.field]} Install Date</h3><DateWithAge label="Install Date *" value={replacement.installDate} set={installDate=>setReplacement(current=>current&&({...current,installDate}))} disabled={false}/><Area label="Reason / Note" value={replacement.reasonNote} set={reasonNote=>setReplacement(current=>current&&({...current,reasonNote}))} disabled={false}/><div className="modal-actions"><button className="secondary-button" type="button" onClick={()=>setReplacement(null)}>Cancel</button><button className="primary-button" type="submit">Update {replacementLabels[replacement.field]} Date</button></div></form></div>;
}
function LogsModal({logs,onClose,onBackToAsset}:{logs:{asset:MachineAsset;records:HistoryRecord[]};onClose:()=>void;onBackToAsset:()=>void}) {
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><section className="mcc-card machine-logs-modal"><div className="modal-heading"><div><p className="eyebrow">Machine Asset History</p><h3>{logs.asset.assetNumber}</h3></div><button className="link-button compact-button" type="button" onClick={onClose}>Close</button></div><div className="machine-log-list">{logs.records.map(record=><article className="machine-log-row" key={record.id}><span>{formatDateTime(record.createdAt)}</span><strong>{actionLabel(record.action)}</strong><p>{record.userName || 'Unknown'} / {record.reasonNote || 'No reason note'}</p></article>)}{!logs.records.length&&<p className="form-message">No machine-specific logs yet.</p>}</div><div className="modal-actions"><button className="secondary-button" type="button" onClick={onBackToAsset}>Back to Asset</button><button className="primary-button" type="button" onClick={onClose}>Done</button></div></section></div>;
}
