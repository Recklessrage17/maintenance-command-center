import { type CSSProperties, type Dispatch, type FormEvent, type ReactNode, type SetStateAction, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MccDateInput, isoDateValue, isValidMccDateValue, localIsoDate } from '../../components/MccDateInput';
import { AssetMeasurementRecordLogsModal, MachineLibraryToolsDropdown, RECORD_LOGS_UPDATED_EVENT, loadMeasurementRecordLogs, measurementRecordIsImage, measurementRecordIsPdf, readMeasurementRecordFile, type MeasurementLogEntry, uploadMeasurementRecordFiles } from './MeasurementInspectionLogsTools';
import { MachineComponentImageCard } from './MachineComponentImageCard';
import { MaintenancePhotoReview, prepareMaintenancePhoto } from './MaintenancePhotoReview';
import { AssetNotesAttachments } from './AssetNotesAttachments';
import { PreventiveMaintenanceTracking } from './PreventiveMaintenanceTracking';

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
type MachineDetailEditableSectionKey = 'basic' | 'electrical' | 'screw' | 'screwTip' | 'barrel' | 'barrelEndCap' | 'screw2' | 'screw2Tip' | 'barrel2' | 'barrel2EndCap' | 'plunger' | 'plungerBarrel' | 'plungerBarrelEndCap';
type MachineDetailSectionKey = MachineDetailEditableSectionKey | 'inspection';

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
const measurementFolderDeleteRoles = new Set(['Maintenance Tech 3','Tier 3','Manager','Admin','Administrator']);
const recordLogFileAccept = '.pdf,.png,.jpg,.jpeg,.webp,.csv,.txt,.xlsx,.xls,.doc,.docx';
const unitFields: Array<{ key: UnitFieldKey; label: string }> = [
  { key: 'machineLength', label: 'Machine Length' },
  { key: 'machineWidth', label: 'Machine Width' },
  { key: 'machineHeight', label: 'Machine Height' },
  { key: 'fullDieHeightLength', label: 'Full Die Height Length / Range' },
];
const conditionLabels: Record<ConditionStatus, string> = { new: 'New', used: 'Used', worn: 'Worn', rebuilt_repaired: 'Rebuilt / Repaired' };
const machineDetailSectionFields: Record<MachineDetailEditableSectionKey, readonly (keyof AssetForm)[]> = {
  basic: ['assetName','brand','model','serialNumber','machineYear','machineType','powerType','tonnage','shotSizeOz','barrelDiameter','location','status'],
  electrical: ['voltageValue','voltageType','fullLoadAmp','machineLength','machineWidth','machineHeight','fullDieHeightLength'],
  screw: ['screwType','screwInstalledDate','screwLength','screwRebuildRepaired','screwConditionStatus'],
  screwTip: ['screwTipType','screwTipInstalledDate'],
  barrel: ['barrelDiameter','barrelInstalledDate','barrelLength','barrelRebuildRepaired','barrelConditionStatus'],
  barrelEndCap: ['barrelEndCapInstalledDate'],
  screw2: ['screw2Type','screw2InstalledDate','screw2Length','screw2RebuildRepaired','screw2ConditionStatus'],
  screw2Tip: ['screw2TipType','screw2TipInstalledDate'],
  barrel2: ['barrel2Diameter','barrel2InstalledDate','barrel2Length','barrel2RebuildRepaired','barrel2ConditionStatus'],
  barrel2EndCap: ['barrel2EndCapInstalledDate'],
  plunger: ['plungerType','plungerInstalledDate','plungerLength','plungerDiameter','plungerRebuildRepaired','plungerConditionStatus'],
  plungerBarrel: ['plungerBarrelType','plungerBarrelInstalledDate','plungerBarrelLength','plungerBarrelDiameter','plungerBarrelRebuildRepaired','plungerBarrelConditionStatus'],
  plungerBarrelEndCap: ['plungerBarrelEndCapInstalledDate'],
};
const machineDateFieldLabels: Partial<Record<keyof AssetForm, string>> = {
  screwInstalledDate: 'Screw Installed Date',
  screwTipInstalledDate: 'Screw Tip Installed Date',
  barrelInstalledDate: 'Barrel Installed Date',
  barrelEndCapInstalledDate: 'Barrel End Cap Installed Date',
  screw2InstalledDate: 'Screw 2 Installed Date',
  screw2TipInstalledDate: 'Screw 2 Tip Installed Date',
  barrel2InstalledDate: 'Barrel 2 Installed Date',
  barrel2EndCapInstalledDate: 'Barrel 2 End Cap Installed Date',
  plungerInstalledDate: 'Plunger Installed Date',
  plungerBarrelInstalledDate: 'Plunger Barrel Installed Date',
  plungerBarrelEndCapInstalledDate: 'Plunger Barrel End Cap Installed Date',
};

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
function machineSummaryStatusClass(status: string) {
  if (status === 'active') return 'status-active';
  if (status === 'down') return 'status-down';
  if (status === 'disabled') return 'status-disabled';
  if (status === 'removed') return 'status-removed';
  return 'status-unknown';
}
function machineSummarySetupClass(asset: Pick<MachineAsset, 'hasDoubleShotInjection' | 'hasPlungerInjection'>) {
  if (asset.hasDoubleShotInjection && asset.hasPlungerInjection) return 'setup-combo';
  if (asset.hasDoubleShotInjection) return 'setup-double';
  if (asset.hasPlungerInjection) return 'setup-plunger';
  return 'setup-standard';
}
function machineSummaryKnownClass(value: string, base: string) {
  return value.trim() ? base : `${base} is-unknown`;
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
function detailValue(value: string | number | boolean | null | undefined, fallback = '-') {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text ? text : fallback;
}
function detailSummary(...parts: Array<string | false | null | undefined>) {
  return parts.filter((part): part is string => Boolean(part && part.trim())).join(' / ') || 'Not set';
}
function assetDimensionSummary(asset: Pick<MachineAsset, 'machineLength' | 'machineWidth' | 'machineHeight'>) {
  return asset.machineLength || asset.machineWidth || asset.machineHeight ? 'Dimensions set' : 'Dimensions not set';
}
function mergeAssetSectionDraft(asset: MachineAsset, draft: AssetForm, fields: readonly (keyof AssetForm)[]): AssetForm {
  const payload = assetToForm(asset);
  for (const key of fields) (payload as Record<string, unknown>)[key] = draft[key];
  return payload;
}
function invalidAssetDateMessage(form: AssetForm, fields: readonly (keyof AssetForm)[]) {
  for (const key of fields) {
    const label = machineDateFieldLabels[key];
    if (label && !isValidMccDateValue(String(form[key] ?? ''))) return `${label} must be a valid date.`;
  }
  return '';
}
function formatUnitNumber(value: number, decimals: number) {
  return Number(value.toFixed(decimals)).toLocaleString(undefined, { maximumFractionDigits: decimals });
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

export function MachineLibraryPage({ userRole = '', userFullName = '' }: { userRole?: string; userFullName?: string }) {
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
  const [detailAsset,setDetailAsset]=useState<MachineAsset|null>(null);
  const [recordLogsAsset,setRecordLogsAsset]=useState<MachineAsset|null>(null);
  const [logs,setLogs]=useState<{asset:MachineAsset;records:HistoryRecord[]}|null>(null);
  const [replacement,setReplacement]=useState<{asset:MachineAsset;field:ReplacementField;installDate:string;reasonNote:string}|null>(null);
  const fileRef = useRef<HTMLInputElement|null>(null);
  const brands = useMemo(()=>[...new Set(assets.map(asset=>asset.brand).filter(Boolean))].sort((a,b)=>a.localeCompare(b)),[assets]);
  const canEdit = permissions.canEdit || editableRoles.has(userRole);
  const canDelete = permissions.canDelete || deleteRoles.has(userRole);
  const canManageMeasurementYearFolders = measurementFolderDeleteRoles.has(userRole);

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
    const dateError = invalidAssetDateMessage(form, Object.keys(machineDateFieldLabels) as (keyof AssetForm)[]);
    if (dateError) { setMessage({kind:'error',text:dateError}); return; }
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
    if (!isValidMccDateValue(replacement.installDate, true)) {
      setMessage({kind:'error',text:'Install Date must be a valid date.'});
      return;
    }
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
    <div className="page-stack machine-library-page mcc-glass-page">
      {message&&<p className={message.kind==='error'?'form-message inventory-toast error':'form-message inventory-toast'}>{message.text}<button className="toast-close-button" type="button" onClick={()=>setMessage(null)}>Close</button></p>}
      <section className="mcc-card machine-toolbar-card glass-panel glass-panel--highlight">
        <label className="form-field machine-search"><span>Search assets</span><input className="glass-input" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Press 14, Toyo, model, serial number..." /></label>
        <label className="form-field"><span>Brand</span><select className="glass-input" value={brandFilter} onChange={event=>setBrandFilter(event.target.value)}><option value="">All brands</option>{brands.map(brand=><option key={brand} value={brand}>{brand}</option>)}</select></label>
        <label className="form-field"><span>Status</span><select className="glass-input" value={statusFilter} onChange={event=>setStatusFilter(event.target.value)}><option value="">All status</option><option value="active">Active</option><option value="down">Down</option><option value="disabled">Disabled</option><option value="removed">Removed</option></select></label>
        <div className="machine-toolbar-actions">
          <button className="primary-button compact-button glass-button glass-button--primary" type="button" onClick={openAdd} disabled={!canEdit}>Add Machine Asset</button>
          <MachineLibraryToolsDropdown canEdit={canEdit} canManageYearFolders={canManageMeasurementYearFolders} importMode={importMode} setImportMode={setImportMode} isImporting={isImporting} onImportMachineList={()=>fileRef.current?.click()} onExportTemplate={downloadTemplate} onOpenBrandColors={()=>setShowColors(true)} />
          <input ref={fileRef} type="file" accept=".csv,.xlsx" className="hidden-file-input" onChange={()=>void importMachineList()} />
        </div>
        <p className="form-help machine-toolbar-note">Add New Only rejects existing Asset Numbers. Upsert updates existing assets and creates new ones. Duplicate Asset Numbers inside one file are always rejected after the first valid row.</p>
        {!canEdit&&<p className="form-help machine-toolbar-note">Tier 3, Manager, Admin, or Owner Admin access is required to add or edit machine assets.</p>}
      </section>
      <div className={`machine-card-grid ${assets.length === 1 ? 'single-result' : 'multi-results'}`}>
        {assets.map(asset=>(
          <article className={`machine-asset-card ${highlightedAssets.has(asset.assetNumber) ? 'machine-import-highlight' : ''} ${isEngelBrand(asset.brand) ? 'machine-brand-engel' : ''}`} style={{'--brand-color':safeCssHex(asset.brandColorHex)} as CSSProperties} key={asset.id} role="button" tabIndex={0} aria-label={`View details for ${asset.assetNumber}`} onClick={()=>setDetailAsset(asset)} onKeyDown={event=>{ if (event.target !== event.currentTarget) return; if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setDetailAsset(asset); } }}>
            <div className="machine-card-head">
              <button className="machine-asset-number" type="button" onClick={event=>{ event.stopPropagation(); void loadLogs(asset); }}>{asset.assetNumber}</button>
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
            <div className="machine-card-actions">
              <button className="primary-button compact-button" type="button" onClick={event=>{ event.stopPropagation(); openEdit(asset); }}>{canEdit?'View/Edit':'View'}</button>
              <button className="secondary-button compact-button" type="button" onClick={event=>{ event.stopPropagation(); setRecordLogsAsset(asset); }}>Record Logs</button>
              <button className="secondary-button compact-button" type="button" onClick={event=>{ event.stopPropagation(); void loadLogs(asset); }}>History</button>
              {canDelete&&asset.status!=='disabled'&&<button className="secondary-button compact-button" type="button" onClick={event=>{ event.stopPropagation(); void disableAsset(asset); }}>Disable</button>}
            </div>
          </article>
        ))}
        {!assets.length&&<section className="mcc-card machine-empty-card"><strong>No machine assets found.</strong><p>Add a machine asset or import the press list template.</p></section>}
      </div>
      {showSetup&&<InjectionSetupModal setup={setupDraft} setSetup={setSetupDraft} onContinue={continueAddFromSetup} onCancel={()=>setShowSetup(false)} />}
      {detailAsset&&<MachineDetailModal asset={detailAsset} canEdit={canEdit} onClose={()=>setDetailAsset(null)} onEdit={()=>{ const asset = detailAsset; setDetailAsset(null); openEdit(asset); }} onLogs={()=>{ const asset = detailAsset; setDetailAsset(null); void loadLogs(asset); }} onRecordLogs={asset=>setRecordLogsAsset(asset)} onAssetUpdated={updated=>{ setDetailAsset(updated); setAssets(current=>current.map(asset=>asset.id===updated.id ? updated : asset)); setMessage({kind:'success',text:'Machine asset section updated.'}); loadAssets(); }} />}
      {showEditor&&<MachineEditorModal form={form} setField={setField} onClose={()=>setShowEditor(false)} onSubmit={saveAsset} canEdit={canEdit} asset={editing} onReplacement={(asset,field)=>setReplacement({asset,field,installDate:'',reasonNote:''})} onRecordLogs={asset=>setRecordLogsAsset(asset)} />}
      {recordLogsAsset&&<AssetMeasurementRecordLogsModal asset={recordLogsAsset} canManageYearFolders={canManageMeasurementYearFolders} onClose={()=>setRecordLogsAsset(null)} />}
      {importSummary&&<ImportResultModal summary={importSummary} onClose={closeImportSummary} />}
      {showColors&&<BrandColorModal brandSettings={brandSettings} colorDrafts={colorDrafts} setColorDrafts={setColorDrafts} canEdit={canEdit} onSave={saveColor} onClose={()=>setShowColors(false)} />}
      {replacement&&<ReplacementModal replacement={replacement} setReplacement={setReplacement} onSubmit={updateReplacement} />}
      {logs&&<LogsModal logs={logs} onClose={()=>setLogs(null)} onBackToAsset={()=>{ setForm(assetToForm(logs.asset)); setEditing(logs.asset); setLogs(null); setShowEditor(true); }} />}
    </div>
  );
}

function MachineDetailModal({asset,canEdit,onClose,onEdit,onLogs,onRecordLogs,onAssetUpdated}:{asset:MachineAsset;canEdit:boolean;onClose:()=>void;onEdit:()=>void;onLogs:()=>void;onRecordLogs:(asset:MachineAsset)=>void;onAssetUpdated:(asset:MachineAsset)=>void}) {
  const [currentAsset,setCurrentAsset]=useState(asset);
  const [draft,setDraft]=useState<AssetForm>(()=>assetToForm(asset));
  const [openSection,setOpenSection]=useState<MachineDetailSectionKey|null>(null);
  const [editingSection,setEditingSection]=useState<MachineDetailEditableSectionKey|null>(null);
  const [savingSection,setSavingSection]=useState<MachineDetailEditableSectionKey|null>(null);
  const [sectionErrors,setSectionErrors]=useState<Partial<Record<MachineDetailEditableSectionKey,string>>>({});
  const unitLabel = injectionSetupLabel(currentAsset) || 'Standard Injection';
  const screwCondition = effectiveCondition(currentAsset.screwRebuildRepaired, currentAsset.screwConditionStatus);
  const barrelCondition = effectiveCondition(currentAsset.barrelRebuildRepaired, currentAsset.barrelConditionStatus);
  const screw2Condition = effectiveCondition(currentAsset.screw2RebuildRepaired, currentAsset.screw2ConditionStatus);
  const barrel2Condition = effectiveCondition(currentAsset.barrel2RebuildRepaired, currentAsset.barrel2ConditionStatus);
  const plungerCondition = effectiveCondition(currentAsset.plungerRebuildRepaired, currentAsset.plungerConditionStatus);
  const plungerBarrelCondition = effectiveCondition(currentAsset.plungerBarrelRebuildRepaired, currentAsset.plungerBarrelConditionStatus);

  useEffect(()=>{
    setCurrentAsset(asset);
    setDraft(assetToForm(asset));
    setOpenSection(null);
    setEditingSection(null);
    setSectionErrors({});
  },[asset.id]);
  useEffect(()=>{
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || editingSection) return;
      setOpenSection(null);
    }
    document.addEventListener('keydown',onKeyDown);
    return ()=>document.removeEventListener('keydown',onKeyDown);
  },[editingSection]);

  function setDraftField<K extends keyof AssetForm>(key: K, value: AssetForm[K]) {
    setDraft(current=>({...current,[key]:value}));
  }
  function toggleOpenSection(key: MachineDetailSectionKey) {
    if (editingSection) return;
    setOpenSection(current=>current === key ? null : key);
  }
  function beginSectionEdit(key: MachineDetailEditableSectionKey) {
    if (!canEdit) return;
    setDraft(assetToForm(currentAsset));
    setOpenSection(key);
    setEditingSection(key);
    setSectionErrors(current=>({...current,[key]:undefined}));
  }
  function cancelSectionEdit() {
    setDraft(assetToForm(currentAsset));
    setEditingSection(null);
  }
  async function saveSection(key: MachineDetailEditableSectionKey) {
    if (!canEdit || savingSection) return;
    setSavingSection(key);
    setSectionErrors(current=>({...current,[key]:undefined}));
    try {
      const dateError = invalidAssetDateMessage(draft,machineDetailSectionFields[key]);
      if (dateError) {
        setSectionErrors(current=>({...current,[key]:dateError}));
        return;
      }
      const payload = mergeAssetSectionDraft(currentAsset,draft,machineDetailSectionFields[key]);
      const data = await api<{ok:boolean;asset:MachineAsset}>(`/api/machine-library/assets/${currentAsset.id}`,{method:'PUT',body:JSON.stringify(payload)});
      setCurrentAsset(data.asset);
      setDraft(assetToForm(data.asset));
      setOpenSection(key);
      setEditingSection(null);
      onAssetUpdated(data.asset);
    } catch (error) {
      setSectionErrors(current=>({...current,[key]:(error as Error).message || 'Section save failed.'}));
    } finally {
      setSavingSection(null);
    }
  }

  const sections: Array<{key:MachineDetailSectionKey;editableKey?:MachineDetailEditableSectionKey;title:string;summary:string;status?:ReactNode;actionLabel?:string;onAction?:()=>void;view:ReactNode;edit?:ReactNode;image?:ReactNode}> = [
    {
      key: 'basic',
      editableKey: 'basic',
      title: 'Basic Info',
      summary: detailSummary(currentAsset.assetName || currentAsset.assetNumber, currentAsset.brand || 'Brand unknown', currentAsset.machineYear ? `${currentAsset.machineYear} / ${machineYearAge(currentAsset.machineYear)}` : 'Year unknown'),
      view: <><DetailItem label="Asset Name" value={detailValue(currentAsset.assetName)} /><DetailItem label="Brand" value={detailValue(currentAsset.brand)} /><DetailItem label="Model" value={detailValue(currentAsset.model)} /><DetailItem label="Serial #" value={detailValue(currentAsset.serialNumber)} /><DetailItem label="Machine Year" value={<>{detailValue(currentAsset.machineYear)} <small className="machine-age-pill machine-age-helper-pill">Age: {machineYearAge(currentAsset.machineYear)}</small></>} /><DetailItem label="Machine Type" value={detailValue(currentAsset.machineType)} /><DetailItem label="Power Type" value={detailValue(currentAsset.powerType)} /><DetailItem label="Tonnage" value={detailValue(currentAsset.tonnage)} /><DetailItem label="Shot Size" value={`${displayShotSize(currentAsset.shotSizeOz)} oz`} /><DetailItem label="Barrel / Screw Diameter" value={detailValue(currentAsset.barrelDiameter)} /><DetailItem label="Location" value={detailValue(currentAsset.location)} /><DetailItem label="Status" value={machineStatusLabel(currentAsset.status)} /></>,
      edit: <><Text label="Asset Name" value={draft.assetName} set={v=>setDraftField('assetName',v)} disabled={!canEdit}/><Text label="Brand *" value={draft.brand} set={v=>setDraftField('brand',v)} disabled={!canEdit}/><Text label="Model" value={draft.model} set={v=>setDraftField('model',v)} disabled={!canEdit}/><Text label="Serial Number" value={draft.serialNumber} set={v=>setDraftField('serialNumber',v)} disabled={!canEdit}/><Text label="Machine Year" value={draft.machineYear} set={v=>setDraftField('machineYear',v)} disabled={!canEdit} helper={<small className="machine-age-pill machine-age-helper-pill">Age: {machineYearAge(draft.machineYear)}</small>}/><Text label="Machine Type" value={draft.machineType} set={v=>setDraftField('machineType',v)} disabled={!canEdit}/><Select label="Power Type" value={draft.powerType} set={v=>setDraftField('powerType',v)} options={['','Hydraulic','Electric','Hybrid','Other']} disabled={!canEdit}/><Text label="Tonnage" value={String(draft.tonnage)} set={v=>setDraftField('tonnage',Number(v)||0)} disabled={!canEdit}/><DecimalInput label="Shot Size (oz)" value={draft.shotSizeOz} set={v=>setDraftField('shotSizeOz',v)} disabled={!canEdit}/><Text label="Barrel/Screw Diameter" value={draft.barrelDiameter} set={v=>setDraftField('barrelDiameter',v)} disabled={!canEdit}/><Text label="Location" value={draft.location} set={v=>setDraftField('location',v)} disabled={!canEdit}/><Select label="Status" value={draft.status} set={v=>setDraftField('status',v)} options={['active','down','disabled','removed']} disabled={!canEdit}/></>,
    },
    {
      key: 'electrical',
      editableKey: 'electrical',
      title: 'Electrical / Dimensions',
      summary: detailSummary(currentAsset.powerType || 'Power unknown', currentAsset.voltageValue ? `${currentAsset.voltageValue} ${currentAsset.voltageType}`.trim() : 'Voltage unknown', assetDimensionSummary(currentAsset)),
      view: <><DetailItem label="Voltage" value={detailValue(currentAsset.voltageValue)} /><DetailItem label="Voltage Type" value={detailValue(currentAsset.voltageType)} /><DetailItem label="Full Load Amp" value={detailValue(currentAsset.fullLoadAmp)} /><DetailItem label="Machine Length" value={detailValue(currentAsset.machineLength)} /><DetailItem label="Machine Width" value={detailValue(currentAsset.machineWidth)} /><DetailItem label="Machine Height" value={detailValue(currentAsset.machineHeight)} /><DetailItem label="Full Die Height Length / Range" value={detailValue(currentAsset.fullDieHeightLength)} /></>,
      edit: <><Text label="Voltage" value={draft.voltageValue} set={v=>setDraftField('voltageValue',v)} disabled={!canEdit}/><Select label="Voltage Type" value={draft.voltageType} set={v=>setDraftField('voltageType',v)} options={['','AC','DC']} disabled={!canEdit}/><Text label="Full Load Amp" value={draft.fullLoadAmp} set={v=>setDraftField('fullLoadAmp',v)} disabled={!canEdit}/><UnitDimensionField label="Machine Length" value={draft.machineLength} set={v=>setDraftField('machineLength',v)} disabled={!canEdit}/><UnitDimensionField label="Machine Width" value={draft.machineWidth} set={v=>setDraftField('machineWidth',v)} disabled={!canEdit}/><UnitDimensionField label="Machine Height" value={draft.machineHeight} set={v=>setDraftField('machineHeight',v)} disabled={!canEdit}/><UnitDimensionField label="Full Die Height Length / Range" value={draft.fullDieHeightLength} set={v=>setDraftField('fullDieHeightLength',v)} disabled={!canEdit}/></>,
    },
    {
      key: 'screw',
      editableKey: 'screw',
      title: 'Screw',
      summary: detailSummary(conditionLabels[screwCondition], currentAsset.screwLength || 'Length unknown', currentAsset.screwInstalledDate || 'Installed date unknown'),
      status: <DetailStatusPill status={screwCondition} />,
      view: <><DetailItem label="Screw Type" value={detailValue(currentAsset.screwType)} /><DetailItem label="Screw Installed Date" value={detailValue(currentAsset.screwInstalledDate)} /><DetailItem label="Screw Length" value={detailValue(currentAsset.screwLength)} /><DetailItem label="Screw Rebuild / Repaired" value={detailValue(currentAsset.screwRebuildRepaired)} /><ConditionBadge label="Screw condition" status={screwCondition} /></>,
      edit: <><Text label="Screw Type" value={draft.screwType} set={v=>setDraftField('screwType',v)} disabled={!canEdit}/><DateWithAge label="Screw Installed Date" value={draft.screwInstalledDate} set={v=>setDraftField('screwInstalledDate',v)} disabled={!canEdit}/><UnitDimensionField label="Screw Length" value={draft.screwLength} set={v=>setDraftField('screwLength',v)} disabled={!canEdit}/><ComponentConditionEditor rebuildLabel="Screw Rebuild / Repaired" conditionLabel="Screw Condition" rebuild={draft.screwRebuildRepaired} condition={draft.screwConditionStatus} setRebuild={v=>setDraftField('screwRebuildRepaired',v)} setCondition={v=>setDraftField('screwConditionStatus',v)} disabled={!canEdit}/></>,
      image: <MachineComponentImageCard assetId={currentAsset.id} assetNumber={currentAsset.assetNumber} assetName={currentAsset.assetName} componentType="screw" componentName="Screw" canEdit={canEdit} />,
    },
    {
      key: 'screwTip',
      editableKey: 'screwTip',
      title: 'Screw Tip',
      summary: detailSummary(currentAsset.screwTipType || 'Type unknown', currentAsset.screwTipInstalledDate || 'Installed date unknown'),
      view: <><DetailItem label="Screw Tip Type" value={detailValue(currentAsset.screwTipType)} /><DetailItem label="Screw Tip Installed Date" value={detailValue(currentAsset.screwTipInstalledDate)} /></>,
      edit: <><Text label="Screw Tip Type" value={draft.screwTipType} set={v=>setDraftField('screwTipType',v)} disabled={!canEdit}/><DateWithAge label="Screw Tip Installed Date" value={draft.screwTipInstalledDate} set={v=>setDraftField('screwTipInstalledDate',v)} disabled={!canEdit}/></>,
      image: <MachineComponentImageCard assetId={currentAsset.id} assetNumber={currentAsset.assetNumber} assetName={currentAsset.assetName} componentType="screw-tip" componentName="Screw Tip" canEdit={canEdit} />,
    },
    {
      key: 'barrel',
      editableKey: 'barrel',
      title: 'Barrel',
      summary: detailSummary(conditionLabels[barrelCondition], currentAsset.barrelDiameter || 'Diameter unknown', currentAsset.barrelInstalledDate || 'Installed date unknown'),
      status: <DetailStatusPill status={barrelCondition} />,
      view: <><DetailItem label="Barrel Diameter" value={detailValue(currentAsset.barrelDiameter)} /><DetailItem label="Barrel Installed Date" value={detailValue(currentAsset.barrelInstalledDate)} /><DetailItem label="Barrel Length" value={detailValue(currentAsset.barrelLength)} /><DetailItem label="Barrel Rebuild / Repaired" value={detailValue(currentAsset.barrelRebuildRepaired)} /><ConditionBadge label="Barrel condition" status={barrelCondition} /></>,
      edit: <><Text label="Barrel Diameter" value={draft.barrelDiameter} set={v=>setDraftField('barrelDiameter',v)} disabled={!canEdit}/><DateWithAge label="Barrel Installed Date" value={draft.barrelInstalledDate} set={v=>setDraftField('barrelInstalledDate',v)} disabled={!canEdit}/><UnitDimensionField label="Barrel Length" value={draft.barrelLength} set={v=>setDraftField('barrelLength',v)} disabled={!canEdit}/><ComponentConditionEditor rebuildLabel="Barrel Rebuild / Repaired" conditionLabel="Barrel Condition" rebuild={draft.barrelRebuildRepaired} condition={draft.barrelConditionStatus} setRebuild={v=>setDraftField('barrelRebuildRepaired',v)} setCondition={v=>setDraftField('barrelConditionStatus',v)} disabled={!canEdit}/></>,
    },
    {
      key: 'barrelEndCap',
      editableKey: 'barrelEndCap',
      title: 'Barrel End Cap',
      summary: currentAsset.barrelEndCapInstalledDate || 'Installed date unknown',
      view: <DetailItem label="Barrel End Cap Installed Date" value={detailValue(currentAsset.barrelEndCapInstalledDate)} />,
      edit: <DateWithAge label="Barrel End Cap Installed Date" value={draft.barrelEndCapInstalledDate} set={v=>setDraftField('barrelEndCapInstalledDate',v)} disabled={!canEdit}/>,
    },
    ...(currentAsset.hasDoubleShotInjection ? [
      {
        key: 'screw2' as const,
        editableKey: 'screw2' as const,
        title: 'Injection Unit 2 Screw',
        summary: detailSummary(conditionLabels[screw2Condition], currentAsset.screw2Length || 'Length unknown', currentAsset.screw2InstalledDate || 'Installed date unknown'),
        status: <DetailStatusPill status={screw2Condition} />,
        view: <><DetailItem label="Screw 2 Type" value={detailValue(currentAsset.screw2Type)} /><DetailItem label="Screw 2 Installed Date" value={detailValue(currentAsset.screw2InstalledDate)} /><DetailItem label="Screw 2 Length" value={detailValue(currentAsset.screw2Length)} /><DetailItem label="Screw 2 Rebuild / Repaired" value={detailValue(currentAsset.screw2RebuildRepaired)} /><ConditionBadge label="Screw 2 condition" status={screw2Condition} /></>,
        edit: <><Text label="Screw 2 Type" value={draft.screw2Type} set={v=>setDraftField('screw2Type',v)} disabled={!canEdit}/><DateWithAge label="Screw 2 Installed Date" value={draft.screw2InstalledDate} set={v=>setDraftField('screw2InstalledDate',v)} disabled={!canEdit}/><UnitDimensionField label="Screw 2 Length" value={draft.screw2Length} set={v=>setDraftField('screw2Length',v)} disabled={!canEdit}/><ComponentConditionEditor rebuildLabel="Screw 2 Rebuild / Repaired" conditionLabel="Screw 2 Condition" rebuild={draft.screw2RebuildRepaired} condition={draft.screw2ConditionStatus} setRebuild={v=>setDraftField('screw2RebuildRepaired',v)} setCondition={v=>setDraftField('screw2ConditionStatus',v)} disabled={!canEdit}/></>,
      },
      {
        key: 'screw2Tip' as const,
        editableKey: 'screw2Tip' as const,
        title: 'Injection Unit 2 Screw Tip',
        summary: detailSummary(currentAsset.screw2TipType || 'Type unknown', currentAsset.screw2TipInstalledDate || 'Installed date unknown'),
        view: <><DetailItem label="Screw 2 Tip Type" value={detailValue(currentAsset.screw2TipType)} /><DetailItem label="Screw 2 Tip Installed Date" value={detailValue(currentAsset.screw2TipInstalledDate)} /></>,
        edit: <><Text label="Screw 2 Tip Type" value={draft.screw2TipType} set={v=>setDraftField('screw2TipType',v)} disabled={!canEdit}/><DateWithAge label="Screw 2 Tip Installed Date" value={draft.screw2TipInstalledDate} set={v=>setDraftField('screw2TipInstalledDate',v)} disabled={!canEdit}/></>,
      },
      {
        key: 'barrel2' as const,
        editableKey: 'barrel2' as const,
        title: 'Injection Unit 2 Barrel',
        summary: detailSummary(conditionLabels[barrel2Condition], currentAsset.barrel2Diameter || 'Diameter unknown', currentAsset.barrel2InstalledDate || 'Installed date unknown'),
        status: <DetailStatusPill status={barrel2Condition} />,
        view: <><DetailItem label="Barrel 2 Diameter" value={detailValue(currentAsset.barrel2Diameter)} /><DetailItem label="Barrel 2 Installed Date" value={detailValue(currentAsset.barrel2InstalledDate)} /><DetailItem label="Barrel 2 Length" value={detailValue(currentAsset.barrel2Length)} /><DetailItem label="Barrel 2 Rebuild / Repaired" value={detailValue(currentAsset.barrel2RebuildRepaired)} /><ConditionBadge label="Barrel 2 condition" status={barrel2Condition} /></>,
        edit: <><Text label="Barrel 2 Diameter" value={draft.barrel2Diameter} set={v=>setDraftField('barrel2Diameter',v)} disabled={!canEdit}/><DateWithAge label="Barrel 2 Installed Date" value={draft.barrel2InstalledDate} set={v=>setDraftField('barrel2InstalledDate',v)} disabled={!canEdit}/><UnitDimensionField label="Barrel 2 Length" value={draft.barrel2Length} set={v=>setDraftField('barrel2Length',v)} disabled={!canEdit}/><ComponentConditionEditor rebuildLabel="Barrel 2 Rebuild / Repaired" conditionLabel="Barrel 2 Condition" rebuild={draft.barrel2RebuildRepaired} condition={draft.barrel2ConditionStatus} setRebuild={v=>setDraftField('barrel2RebuildRepaired',v)} setCondition={v=>setDraftField('barrel2ConditionStatus',v)} disabled={!canEdit}/></>,
      },
      {
        key: 'barrel2EndCap' as const,
        editableKey: 'barrel2EndCap' as const,
        title: 'Injection Unit 2 Barrel End Cap',
        summary: currentAsset.barrel2EndCapInstalledDate || 'Installed date unknown',
        view: <DetailItem label="Barrel 2 End Cap Installed Date" value={detailValue(currentAsset.barrel2EndCapInstalledDate)} />,
        edit: <DateWithAge label="Barrel 2 End Cap Installed Date" value={draft.barrel2EndCapInstalledDate} set={v=>setDraftField('barrel2EndCapInstalledDate',v)} disabled={!canEdit}/>,
      },
    ] : []),
    ...(currentAsset.hasPlungerInjection ? [
      {
        key: 'plunger' as const,
        editableKey: 'plunger' as const,
        title: 'Plunger',
        summary: detailSummary(conditionLabels[plungerCondition], currentAsset.plungerDiameter || 'Diameter unknown', currentAsset.plungerInstalledDate || 'Installed date unknown'),
        status: <DetailStatusPill status={plungerCondition} />,
        view: <><DetailItem label="Plunger Type" value={detailValue(currentAsset.plungerType)} /><DetailItem label="Plunger Installed Date" value={detailValue(currentAsset.plungerInstalledDate)} /><DetailItem label="Plunger Length" value={detailValue(currentAsset.plungerLength)} /><DetailItem label="Plunger Diameter" value={detailValue(currentAsset.plungerDiameter)} /><DetailItem label="Plunger Rebuild / Repaired" value={detailValue(currentAsset.plungerRebuildRepaired)} /><ConditionBadge label="Plunger condition" status={plungerCondition} /></>,
        edit: <><Text label="Plunger Type" value={draft.plungerType} set={v=>setDraftField('plungerType',v)} disabled={!canEdit}/><DateWithAge label="Plunger Installed Date" value={draft.plungerInstalledDate} set={v=>setDraftField('plungerInstalledDate',v)} disabled={!canEdit}/><UnitDimensionField label="Plunger Length" value={draft.plungerLength} set={v=>setDraftField('plungerLength',v)} disabled={!canEdit}/><UnitDimensionField label="Plunger Diameter" value={draft.plungerDiameter} set={v=>setDraftField('plungerDiameter',v)} disabled={!canEdit}/><ComponentConditionEditor rebuildLabel="Plunger Rebuild / Repaired" conditionLabel="Plunger Condition" rebuild={draft.plungerRebuildRepaired} condition={draft.plungerConditionStatus} setRebuild={v=>setDraftField('plungerRebuildRepaired',v)} setCondition={v=>setDraftField('plungerConditionStatus',v)} disabled={!canEdit}/></>,
      },
      {
        key: 'plungerBarrel' as const,
        editableKey: 'plungerBarrel' as const,
        title: 'Plunger Barrel / Cylinder Barrel',
        summary: detailSummary(conditionLabels[plungerBarrelCondition], currentAsset.plungerBarrelDiameter || 'Diameter unknown', currentAsset.plungerBarrelInstalledDate || 'Installed date unknown'),
        status: <DetailStatusPill status={plungerBarrelCondition} />,
        view: <><DetailItem label="Plunger Barrel Type" value={detailValue(currentAsset.plungerBarrelType)} /><DetailItem label="Plunger Barrel Installed Date" value={detailValue(currentAsset.plungerBarrelInstalledDate)} /><DetailItem label="Plunger Barrel Length" value={detailValue(currentAsset.plungerBarrelLength)} /><DetailItem label="Plunger Barrel Diameter" value={detailValue(currentAsset.plungerBarrelDiameter)} /><DetailItem label="Plunger Barrel Rebuild / Repaired" value={detailValue(currentAsset.plungerBarrelRebuildRepaired)} /><ConditionBadge label="Plunger Barrel condition" status={plungerBarrelCondition} /></>,
        edit: <><Text label="Plunger Barrel Type" value={draft.plungerBarrelType} set={v=>setDraftField('plungerBarrelType',v)} disabled={!canEdit}/><DateWithAge label="Plunger Barrel Installed Date" value={draft.plungerBarrelInstalledDate} set={v=>setDraftField('plungerBarrelInstalledDate',v)} disabled={!canEdit}/><UnitDimensionField label="Plunger Barrel Length" value={draft.plungerBarrelLength} set={v=>setDraftField('plungerBarrelLength',v)} disabled={!canEdit}/><UnitDimensionField label="Plunger Barrel Diameter" value={draft.plungerBarrelDiameter} set={v=>setDraftField('plungerBarrelDiameter',v)} disabled={!canEdit}/><ComponentConditionEditor rebuildLabel="Plunger Barrel Rebuild / Repaired" conditionLabel="Plunger Barrel Condition" rebuild={draft.plungerBarrelRebuildRepaired} condition={draft.plungerBarrelConditionStatus} setRebuild={v=>setDraftField('plungerBarrelRebuildRepaired',v)} setCondition={v=>setDraftField('plungerBarrelConditionStatus',v)} disabled={!canEdit}/></>,
      },
      {
        key: 'plungerBarrelEndCap' as const,
        editableKey: 'plungerBarrelEndCap' as const,
        title: 'Plunger Barrel End Cap',
        summary: currentAsset.plungerBarrelEndCapInstalledDate || 'Installed date unknown',
        view: <DetailItem label="Plunger Barrel End Cap Installed Date" value={detailValue(currentAsset.plungerBarrelEndCapInstalledDate)} />,
        edit: <DateWithAge label="Plunger Barrel End Cap Installed Date" value={draft.plungerBarrelEndCapInstalledDate} set={v=>setDraftField('plungerBarrelEndCapInstalledDate',v)} disabled={!canEdit}/>,
      },
    ] : []),
  ];

  return <div className="modal-backdrop glass-modal-backdrop" role="dialog" aria-modal="true"><section className="mcc-card machine-modal machine-detail-modal glass-panel glass-panel--highlight glass-modal-shell mcc-detail-shell">
    <div className="modal-heading machine-detail-heading"><div><p className="eyebrow">Machine Asset Detail</p><h3>{currentAsset.assetNumber}</h3><p className="machine-detail-identity-badge glass-pill" style={{'--machine-detail-brand-color':safeCssHex(currentAsset.brandColorHex)} as CSSProperties}><span className="machine-detail-brand-dot" aria-hidden="true" /><span>{currentAsset.brand || 'Brand unknown'}</span><span>Model {currentAsset.model || '-'}</span><span>S/N {currentAsset.serialNumber || '-'}</span></p></div><div className="machine-detail-header-actions glass-button-group"><button className="secondary-button compact-button glass-button glass-button--secondary" type="button" onClick={()=>onRecordLogs(currentAsset)}>Record Logs</button><button className="secondary-button compact-button glass-button glass-button--secondary" type="button" onClick={onLogs}>History</button><button className="primary-button compact-button glass-button glass-button--primary" type="button" onClick={onEdit}>{canEdit ? 'Edit Mode' : 'View Form'}</button><button className="link-button compact-button glass-button glass-button--secondary" type="button" onClick={onClose}>Close</button></div></div>
    <div className="machine-detail-summary-grid">
      <SummaryBadge label="Status" value={machineStatusLabel(currentAsset.status)} tone={machineSummaryStatusClass(currentAsset.status)} />
      <SummaryBadge label="Setup" value={unitLabel} tone={machineSummarySetupClass(currentAsset)} />
      <SummaryBadge label="Year / Age" value={`${currentAsset.machineYear || '-'} / ${machineYearAge(currentAsset.machineYear)}`} tone={machineSummaryKnownClass(currentAsset.machineYear,'year-age')} />
      <SummaryBadge label="Location" value={detailValue(currentAsset.location)} tone={machineSummaryKnownClass(currentAsset.location,'location')} />
    </div>
    <MachineRecordLogsLaunchPanel asset={currentAsset} onOpen={()=>onRecordLogs(currentAsset)} />
    <div className="machine-detail-accordion-list">
      {sections.map(section=>{
        const editableKey = section.editableKey;
        const isEditing = Boolean(editableKey && editingSection === editableKey);
        const isOpen = isEditing || openSection === section.key;
        const actionLabel = section.actionLabel ?? (editableKey && canEdit ? 'Edit' : undefined);
        const onAction = section.onAction ?? (editableKey ? ()=>beginSectionEdit(editableKey) : undefined);
        return <MachineDetailAccordionSection key={section.key} sectionKey={section.key} title={section.title} summary={section.summary} status={section.status} expanded={isOpen} editing={isEditing} actionLabel={actionLabel} onAction={onAction} onToggle={()=>toggleOpenSection(section.key)} onSave={editableKey ? ()=>void saveSection(editableKey) : undefined} onCancel={editableKey ? cancelSectionEdit : undefined} saving={Boolean(editableKey && savingSection === editableKey)} error={editableKey ? sectionErrors[editableKey] : undefined} aside={section.image}>{isEditing ? section.edit : section.view}</MachineDetailAccordionSection>;
      })}
      <PreventiveMaintenanceTracking asset={currentAsset} canEdit={canEdit} />
      <AssetNotesAttachments asset={currentAsset} canEdit={canEdit} />
    </div>
    <div className="modal-actions glass-modal__actions"><button className="secondary-button glass-button glass-button--secondary" type="button" onClick={onClose}>Close</button><button className="primary-button glass-button glass-button--primary" type="button" onClick={onEdit}>{canEdit ? 'Edit Mode' : 'View Form'}</button></div>
  </section></div>;
}
function MachineDetailAccordionSection({sectionKey,title,summary,status,expanded,editing,actionLabel,onAction,onToggle,onSave,onCancel,saving,error,aside,children}:{sectionKey:MachineDetailSectionKey;title:string;summary:string;status?:ReactNode;expanded:boolean;editing:boolean;actionLabel?:string;onAction?:()=>void;onToggle:()=>void;onSave?:()=>void;onCancel?:()=>void;saving:boolean;error?:string;aside?:ReactNode;children:ReactNode}) {
  const panelId = `machine-detail-panel-${sectionKey}`;
  return <article className={`machine-detail-accordion-card ${expanded ? 'is-open' : ''} ${editing ? 'is-editing' : ''}`}>
    <div className="machine-detail-accordion-header">
      <button className="machine-detail-accordion-toggle" type="button" aria-expanded={expanded} aria-controls={panelId} onClick={onToggle}>
        <span className="machine-detail-section-title">{title}</span>
        <span className="machine-detail-section-summary">{summary}</span>
        {status}
        <span className="machine-accordion-chevron" aria-hidden="true">v</span>
      </button>
      <div className="machine-detail-section-actions">
        {editing&&<><button className="primary-button compact-button glass-button glass-button--primary" type="button" onClick={onSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button><button className="secondary-button compact-button glass-button glass-button--secondary" type="button" onClick={onCancel} disabled={saving}>Cancel</button></>}
        {!editing&&actionLabel&&onAction&&<button className="secondary-button compact-button glass-button glass-button--secondary" type="button" onClick={onAction}>{actionLabel}</button>}
      </div>
    </div>
    <div className="machine-detail-accordion-panel" id={panelId} aria-hidden={!expanded}>
      <div className={aside?'machine-detail-section-layout has-component-image':'machine-detail-section-layout'}><div className={editing ? 'machine-detail-grid machine-detail-edit-grid' : 'machine-detail-grid'}>{children}</div>{aside&&<aside className="machine-detail-component-image-area">{aside}</aside>}</div>
      {error&&<p className="form-message error machine-section-error">{error}</p>}
    </div>
  </article>;
}
function DetailStatusPill({status}:{status:ConditionStatus}) { return <span className={`machine-section-status-pill glass-pill condition-${status}`}>{conditionLabels[status]}</span>; }
function SummaryBadge({label,value,tone}:{label:string;value:ReactNode;tone:string}) { return <div className="machine-detail-summary-card glass-card glass-card--nested"><span className="machine-detail-summary-label">{label}</span><strong className={`machine-detail-summary-pill glass-pill ${tone}`}>{value}</strong></div>; }
function DetailItem({label,value,tone}:{label:string;value:ReactNode;tone?:'note'|'critical'}) { return <div className={`machine-detail-pill ${tone === 'critical' ? 'machine-critical-text' : tone === 'note' ? 'machine-note-text' : ''}`}><span className="machine-detail-pill-label">{label}</span><strong className="machine-detail-pill-value">{value}</strong></div>; }
function MachineRecordLogActions({asset,onOpen,onUploaded}:{asset:MachineAsset;onOpen:()=>void;onUploaded?:()=>void}) {
  const fileInputRef = useRef<HTMLInputElement|null>(null);
  const cameraInputRef = useRef<HTMLInputElement|null>(null);
  const [uploading,setUploading]=useState(false);
  const [message,setMessage]=useState('');
  const [pendingPhoto,setPendingPhoto]=useState<File|null>(null);

  async function stagePhoto(file:File) {
    try {
      setMessage('Preparing photo…');
      setPendingPhoto(await prepareMaintenancePhoto(file));
      setMessage('');
    } catch (error) {
      setMessage((error as Error).message || 'Photo could not be prepared.');
    }
  }

  async function uploadFiles(files: File[]) {
    if (!files.length) return;
    setUploading(true);
    setMessage('');
    try {
      const result = await uploadMeasurementRecordFiles(asset, files);
      if (result.count) {
        setMessage(`${result.count} file${result.count === 1 ? '' : 's'} uploaded to ${asset.assetNumber}.`);
        onUploaded?.();
      }
    } catch (error) {
      console.error('Record upload failed', error);
      setMessage((error as Error).message || 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  return <div className="machine-record-launch-action-stack">
    <div className="machine-record-launch-actions">
      <button className="primary-button compact-button glass-button glass-button--primary" type="button" onClick={()=>fileInputRef.current?.click()} disabled={uploading}>{uploading ? 'Uploading...' : 'Upload File'}</button>
      <button className="secondary-button compact-button machine-camera-button glass-button glass-button--secondary" type="button" onClick={()=>cameraInputRef.current?.click()} disabled={uploading}>Take Photo</button>
      <button className="secondary-button compact-button glass-button glass-button--secondary" type="button" onClick={onOpen}>Open Record Logs</button>
    </div>
    {message&&<small className={message === 'Upload failed.' ? 'machine-record-upload-message error' : 'machine-record-upload-message'}>{message}</small>}
    <input ref={fileInputRef} type="file" multiple hidden accept={recordLogFileAccept} onChange={event=>{ const files = Array.from(event.target.files ?? []); if(files.length===1&&files[0].type.startsWith('image/')) void stagePhoto(files[0]); else void uploadFiles(files); event.currentTarget.value = ''; }} />
    <input ref={cameraInputRef} type="file" hidden accept="image/*" capture="environment" onChange={event=>{ const file=event.target.files?.[0]; if(file)void stagePhoto(file); event.currentTarget.value=''; }} />
    {pendingPhoto&&<MaintenancePhotoReview file={pendingPhoto} title={`Save photo to ${asset.assetNumber}?`} detail="Review the maintenance photo before adding it to Inspection Records." saving={uploading} onRetake={()=>{setPendingPhoto(null);cameraInputRef.current?.click();}} onCancel={()=>setPendingPhoto(null)} onSave={()=>void uploadFiles([pendingPhoto]).then(()=>setPendingPhoto(null))} />}
  </div>;
}
function MachineRecordLogsLaunchPanel({asset,onOpen}:{asset:MachineAsset;onOpen:()=>void}) {
  const [expanded,setExpanded]=useState(false);
  const [records,setRecords]=useState<MeasurementLogEntry[]>([]);
  const [loading,setLoading]=useState(false);
  const [viewerRecord,setViewerRecord]=useState<MeasurementLogEntry|null>(null);
  async function refresh() {
    setLoading(true);
    try { setRecords(await loadMeasurementRecordLogs(asset)); }
    finally { setLoading(false); }
  }
  useEffect(()=>{
    if(expanded)void refresh();
  },[expanded,asset.id]);
  useEffect(()=>{
    function onUpdated(){ if(expanded)void refresh(); }
    window.addEventListener(RECORD_LOGS_UPDATED_EVENT,onUpdated);
    return()=>window.removeEventListener(RECORD_LOGS_UPDATED_EVENT,onUpdated);
  },[expanded,asset.id]);
  const newest=records[0] ?? null;
  return <section className={`machine-measurement-panel machine-record-accordion glass-panel glass-panel--nested${expanded?' is-open':''}`}>
    <button className="machine-measurement-panel-heading machine-record-accordion-header" type="button" onClick={()=>setExpanded(current=>!current)} aria-expanded={expanded} aria-controls={`machine-record-panel-${asset.id}`}>
      <div><p className="eyebrow">Inspection Records</p><h4>Screw & Barrel Inspection Records</h4></div><span className="machine-record-accordion-header-meta"><span className="machine-measurement-setup-pill glass-pill glass-pill--success">{asset.assetNumber}</span><span className="machine-accordion-chevron" aria-hidden="true">v</span></span>
    </button>
    {expanded&&<div className="machine-record-accordion-body" id={`machine-record-panel-${asset.id}`}>
      <div className="machine-record-launch-card glass-card glass-card--nested">
        <div className="machine-record-launch-copy"><span className="measurement-asset-pill glass-pill glass-pill--cyan">{asset.assetNumber}</span><strong>Asset-specific record logs</strong><small>Upload completed screw and barrel inspection files, edit record dates, and print combined record PDFs for this asset.</small></div>
        <MachineRecordLogActions asset={asset} onOpen={onOpen} onUploaded={()=>void refresh()} />
      </div>
      {loading&&!newest?<div className="machine-record-newest-empty glass-empty-state">Loading newest record…</div>:newest?<NewestInspectionRecordPreview record={newest} onOpen={()=>setViewerRecord(newest)} />:<div className="machine-record-newest-empty glass-empty-state"><strong>No inspection records yet.</strong><span>Upload a completed record or take a maintenance photo.</span></div>}
    </div>}
    {viewerRecord&&<InspectionRecordViewer asset={asset} record={viewerRecord} onClose={()=>setViewerRecord(null)} />}
  </section>;
}

function measurementAgeLabel(value:string) {
  const match=value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!match) return 'Check record date';
  const measured=new Date(Number(match[1]),Number(match[2])-1,Number(match[3]));
  if(measured.getFullYear()!==Number(match[1])||measured.getMonth()!==Number(match[2])-1||measured.getDate()!==Number(match[3])) return 'Check record date';
  const today=new Date();
  today.setHours(0,0,0,0);
  measured.setHours(0,0,0,0);
  const days=Math.round((today.getTime()-measured.getTime())/(24*60*60*1000));
  if(days<0) return 'Check record date';
  if(days===0) return 'Last measured: Today';
  return `Last measured: ${days} day${days===1?'':'s'} ago`;
}
function NewestInspectionRecordPreview({record,onOpen}:{record:MeasurementLogEntry;onOpen:()=>void}) {
  const isImage=measurementRecordIsImage(record);
  const isPdf=measurementRecordIsPdf(record);
  const [thumbnailUrl,setThumbnailUrl]=useState(isImage&&record.storage==='server'&&record.contentUrl?record.contentUrl:'');
  useEffect(()=>{
    const serverUrl=isImage&&record.storage==='server'&&record.contentUrl?record.contentUrl:'';
    setThumbnailUrl(serverUrl);
    if(!isImage||serverUrl) return;
    let active=true;
    let objectUrl='';
    void readMeasurementRecordFile(record).then(stored=>{if(stored&&active){objectUrl=URL.createObjectURL(stored.blob);setThumbnailUrl(objectUrl);}}).catch(()=>undefined);
    return()=>{active=false;if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[record.id,record.contentUrl,record.storage,isImage]);
  return <button className={`machine-record-newest-preview glass-card glass-card--nested${isImage?' has-image':' is-file'}`} type="button" onClick={onOpen}>
    {isImage&&<span className="machine-record-preview-thumbnail">{thumbnailUrl?<img src={thumbnailUrl} alt="" />:<span aria-hidden="true">IMG</span>}</span>}
    <span className="machine-record-preview-main"><small>Newest record</small><strong className="machine-record-preview-filename">{isPdf&&<span className="machine-record-inline-file-icon pdf glass-file-icon glass-file-icon--pdf" aria-hidden="true">PDF</span>}{record.name}</strong><span className="machine-record-preview-pills"><em className="measurement-asset-pill glass-pill glass-pill--cyan">{record.assetNumber}</em><em className={record.hasStoredFile?'measurement-status-pill status-ready glass-pill glass-pill--success':'measurement-status-pill status-log-only glass-pill glass-pill--warning'}>{record.hasStoredFile?'READY':'LOG ONLY'}</em></span><span className="machine-record-date-row"><span>Record date: {new Date(`${record.recordDate}T12:00:00`).toLocaleDateString()}</span><em className={`machine-last-measured-pill glass-pill ${measurementAgeLabel(record.recordDate)==='Check record date'?'glass-pill--warning warning':'glass-pill--success'}`}>{measurementAgeLabel(record.recordDate)}</em></span><small>Uploaded {new Date(record.uploadedAt).toLocaleString()}</small></span>
    <span className="machine-record-preview-open">Open full view</span>
  </button>;
}

function escapePrintHtml(value:string) { return value.replace(/[&<>'"]/g,character=>({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[character] ?? character); }

function InspectionRecordViewer({asset,record,onClose}:{asset:MachineAsset;record:MeasurementLogEntry;onClose:()=>void}) {
  const [url,setUrl]=useState('');
  const [error,setError]=useState('');
  const [fit,setFit]=useState(true);
  useEffect(()=>{
    let active=true;
    let objectUrl='';
    void readMeasurementRecordFile(record).then(stored=>{if(!stored)throw new Error('Stored record is unavailable.');objectUrl=URL.createObjectURL(stored.blob);if(active)setUrl(objectUrl);}).catch(loadError=>{if(active)setError((loadError as Error).message);});
    return()=>{active=false;if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[record.id]);
  useEffect(()=>{function onKeyDown(event:KeyboardEvent){if(event.key==='Escape')onClose();}document.addEventListener('keydown',onKeyDown);return()=>document.removeEventListener('keydown',onKeyDown);},[onClose]);
  function download(){if(!url)return;const link=document.createElement('a');link.href=url;link.download=record.name;document.body.appendChild(link);link.click();link.remove();}
  function openOriginal(){if(!url)return;const opened=window.open(url,'_blank','noopener,noreferrer');if(!opened)setError('Allow pop-ups to open this record.');}
  function printImage(){
    if(!url)return;
    const printWindow=window.open('','_blank','width=1100,height=850');
    if(!printWindow){setError('Allow pop-ups to open the printable record.');return;}
    const generated=new Intl.DateTimeFormat(undefined,{dateStyle:'long',timeStyle:'short'}).format(new Date());
    printWindow.document.write(`<!doctype html><html><head><title>${escapePrintHtml(record.name)}</title><style>body{margin:0;padding:32px;font-family:Arial,sans-serif;color:#111}header{border-bottom:2px solid #222;padding-bottom:14px;margin-bottom:22px}h1{margin:0 0 6px;font-size:23px}p{margin:4px 0;color:#444}.image{display:flex;justify-content:center;align-items:center;min-height:520px;border:1px solid #bbb;padding:16px}.image img{max-width:100%;max-height:70vh;object-fit:contain}.generated{font-size:12px;color:#666;margin-top:16px}@media print{body{padding:12mm}.image{min-height:0;break-inside:avoid}.image img{max-height:72vh}}</style></head><body><header><h1>${escapePrintHtml(asset.assetNumber)}${asset.assetName?` - ${escapePrintHtml(asset.assetName)}`:''}</h1><p>Inspection record: <strong>${escapePrintHtml(record.name)}</strong></p><p>Record date: ${escapePrintHtml(new Date(`${record.recordDate}T12:00:00`).toLocaleDateString())}</p></header><div class="image"><img id="record-print-image" src="${escapePrintHtml(url)}"></div><p class="generated">Generated / printed: ${escapePrintHtml(generated)}</p></body></html>`);
    printWindow.document.close();
    const image=printWindow.document.getElementById('record-print-image') as HTMLImageElement|null;
    const print=()=>{printWindow.focus();printWindow.print();};
    if(image?.complete)setTimeout(print,100);else image?.addEventListener('load',print,{once:true});
  }
  const isImage=measurementRecordIsImage(record);
  const isPdf=measurementRecordIsPdf(record);
  return createPortal(<div className="modal-backdrop inspection-record-viewer-backdrop glass-modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}><section className="mcc-card inspection-record-viewer glass-modal-shell mcc-full-view-dialog" role="dialog" aria-modal="true" aria-label={`${record.name} viewer`}>
    <div className="modal-heading"><div><p className="eyebrow">{asset.assetNumber}{asset.assetName?` · ${asset.assetName}`:''}</p><h3>{record.name}</h3><p>Record date {new Date(`${record.recordDate}T12:00:00`).toLocaleDateString()} · Uploaded {new Date(record.uploadedAt).toLocaleString()}</p></div><button className="link-button compact-button" type="button" onClick={onClose}>Close</button></div>
    <div className={`inspection-record-viewer-canvas${fit?' is-fit':' is-zoom'}`}>{error?<p className="form-message error">{error}</p>:!url?<p>Loading record…</p>:isImage?<img src={url} alt={record.name} />:isPdf?<object data={url} type="application/pdf" aria-label={record.name}><p>Use Open Original to view this PDF.</p></object>:<div className="inspection-record-unsupported"><strong>Preview is not available for this file type.</strong><span>{record.type || 'Unknown file type'} · {record.name}</span></div>}</div>
    <div className="modal-actions inspection-record-viewer-actions glass-modal__actions">{isImage&&<button className="secondary-button glass-button glass-button--secondary" type="button" onClick={()=>setFit(current=>!current)}>{fit?'Zoom':'Fit Image'}</button>}<button className="secondary-button glass-button glass-button--secondary" type="button" onClick={download} disabled={!url}>{isImage?'Download Image':'Download'}</button>{isImage?<button className="secondary-button glass-button glass-button--secondary" type="button" onClick={printImage} disabled={!url}>Print / Save as PDF</button>:<><button className="secondary-button glass-button glass-button--secondary" type="button" onClick={openOriginal} disabled={!url}>Open Original</button>{isPdf&&<button className="secondary-button glass-button glass-button--secondary" type="button" onClick={openOriginal} disabled={!url}>Print</button>}</>}<button className="link-button glass-button glass-button--secondary" type="button" onClick={onClose}>Close</button></div>
  </section></div>,document.body);
}
function MachineEditorModal({form,setField,onClose,onSubmit,canEdit,asset,onReplacement,onRecordLogs}:{form:AssetForm;setField:<K extends keyof AssetForm>(key:K,value:AssetForm[K])=>void;onClose:()=>void;onSubmit:(event:FormEvent)=>void;canEdit:boolean;asset:MachineAsset|null;onReplacement:(asset:MachineAsset,field:ReplacementField)=>void;onRecordLogs:(asset:MachineAsset)=>void}) {
  const disabled = !canEdit;
  const setupChanged = Boolean(asset && (form.hasDoubleShotInjection !== asset.hasDoubleShotInjection || form.hasPlungerInjection !== asset.hasPlungerInjection));
  return <div className="modal-backdrop glass-modal-backdrop" role="dialog" aria-modal="true"><form className="mcc-card machine-modal machine-editor-modal glass-modal-shell mcc-wide-modal" onSubmit={onSubmit}>
    <div className="modal-heading"><div><p className="eyebrow">Machine Asset Detail</p><h3>{form.assetNumber || 'New Machine Asset'}</h3><p>{form.brand || 'Brand'} / {form.model || 'Model'} / S/N: {form.serialNumber || '-'}</p></div><button className="link-button compact-button glass-button glass-button--secondary" type="button" onClick={onClose}>Close</button></div>
    <MachineSection title="Basic Info"><Text label="Asset Number / Press Number *" value={form.assetNumber} set={v=>setField('assetNumber',v)} disabled={disabled}/><Text label="Asset Name" value={form.assetName} set={v=>setField('assetName',v)} disabled={disabled}/><Text label="Brand *" value={form.brand} set={v=>setField('brand',v)} disabled={disabled}/><Text label="Model" value={form.model} set={v=>setField('model',v)} disabled={disabled}/><Text label="Serial Number" value={form.serialNumber} set={v=>setField('serialNumber',v)} disabled={disabled}/><Text label="Machine Year" value={form.machineYear} set={v=>setField('machineYear',v)} disabled={disabled} helper={<small className="machine-age-pill machine-age-helper-pill">Age: {machineYearAge(form.machineYear)}</small>}/><Text label="Machine Type" value={form.machineType} set={v=>setField('machineType',v)} disabled={disabled}/><Select label="Power Type" value={form.powerType} set={v=>setField('powerType',v)} options={['','Hydraulic','Electric','Hybrid','Other']} disabled={disabled}/><DecimalInput label="Shot Size (oz)" value={form.shotSizeOz} set={v=>setField('shotSizeOz',v)} disabled={disabled}/><Text label="Tonnage" value={String(form.tonnage)} set={v=>setField('tonnage',Number(v)||0)} disabled={disabled}/><Text label="Barrel/Screw Diameter" value={form.barrelDiameter} set={v=>setField('barrelDiameter',v)} disabled={disabled}/><Text label="Location" value={form.location} set={v=>setField('location',v)} disabled={disabled}/><Select label="Status" value={form.status} set={v=>setField('status',v)} options={['active','down','disabled','removed']} disabled={disabled}/></MachineSection>
    <section className="machine-form-section"><span>Injection Setup</span><div className="machine-setup-grid"><YesNoToggle label="Double Shot Injection" value={form.hasDoubleShotInjection} set={value=>setField('hasDoubleShotInjection',value)} disabled={disabled}/><YesNoToggle label="Plunger Injection" value={form.hasPlungerInjection} set={value=>setField('hasPlungerInjection',value)} disabled={disabled}/></div>{setupChanged&&<p className="machine-setup-warning">Changing injection setup can show or hide component fields. Existing saved data will not be deleted.</p>}</section>
    <MachineSection title="Electrical"><Text label="Voltage" value={form.voltageValue} set={v=>setField('voltageValue',v)} disabled={disabled}/><Select label="Voltage Type" value={form.voltageType} set={v=>setField('voltageType',v)} options={['','AC','DC']} disabled={disabled}/><Text label="Full Load Amp" value={form.fullLoadAmp} set={v=>setField('fullLoadAmp',v)} disabled={disabled}/></MachineSection>
    <MachineSection title="Dimensions">{unitFields.map(field=><UnitDimensionField key={field.key} label={field.label} value={form[field.key]} set={v=>setField(field.key,v)} disabled={disabled}/>)}</MachineSection>
    {!form.hasDoubleShotInjection&&<section className="machine-form-section"><span>Screw / Barrel</span><div className="machine-screw-barrel-grid"><ScrewBox title="Screw Box" form={form} setField={setField} disabled={disabled} typeKey="screwType" tipTypeKey="screwTipType" rebuildKey="screwRebuildRepaired" conditionKey="screwConditionStatus" installedDateKey="screwInstalledDate" tipInstalledDateKey="screwTipInstalledDate" lengthKey="screwLength" conditionLabel="Screw condition" /><BarrelBox title="Barrel Box" form={form} setField={setField} disabled={disabled} diameterKey="barrelDiameter" rebuildKey="barrelRebuildRepaired" conditionKey="barrelConditionStatus" installedDateKey="barrelInstalledDate" endCapDateKey="barrelEndCapInstalledDate" lengthKey="barrelLength" conditionLabel="Barrel condition" /></div></section>}
    {form.hasDoubleShotInjection&&<><section className="machine-form-section"><span>Injection Unit 1</span><div className="machine-screw-barrel-grid"><ScrewBox title="Screw 1 Box" form={form} setField={setField} disabled={disabled} typeKey="screwType" tipTypeKey="screwTipType" rebuildKey="screwRebuildRepaired" conditionKey="screwConditionStatus" installedDateKey="screwInstalledDate" tipInstalledDateKey="screwTipInstalledDate" lengthKey="screwLength" conditionLabel="Screw 1 condition" /><BarrelBox title="Barrel 1 Box" form={form} setField={setField} disabled={disabled} diameterKey="barrelDiameter" rebuildKey="barrelRebuildRepaired" conditionKey="barrelConditionStatus" installedDateKey="barrelInstalledDate" endCapDateKey="barrelEndCapInstalledDate" lengthKey="barrelLength" conditionLabel="Barrel 1 condition" /></div></section><section className="machine-form-section"><span>Injection Unit 2</span><div className="machine-screw-barrel-grid"><ScrewBox title="Screw 2 Box" form={form} setField={setField} disabled={disabled} typeKey="screw2Type" tipTypeKey="screw2TipType" rebuildKey="screw2RebuildRepaired" conditionKey="screw2ConditionStatus" installedDateKey="screw2InstalledDate" tipInstalledDateKey="screw2TipInstalledDate" lengthKey="screw2Length" conditionLabel="Screw 2 condition" /><BarrelBox title="Barrel 2 Box" form={form} setField={setField} disabled={disabled} diameterKey="barrel2Diameter" rebuildKey="barrel2RebuildRepaired" conditionKey="barrel2ConditionStatus" installedDateKey="barrel2InstalledDate" endCapDateKey="barrel2EndCapInstalledDate" lengthKey="barrel2Length" conditionLabel="Barrel 2 condition" /></div></section></>}
    {form.hasPlungerInjection&&<section className="machine-form-section"><span>Plunger Injection</span><div className="machine-screw-barrel-grid"><PlungerBox title="Plunger Box" form={form} setField={setField} disabled={disabled}/><PlungerBarrelBox title="Plunger Barrel / Cylinder Barrel Box" form={form} setField={setField} disabled={disabled}/></div></section>}
    {asset&&<RecordLogsRow asset={asset} onOpen={()=>onRecordLogs(asset)} />}
    {asset&&<ReplacementUpdatesPanel asset={asset} form={form} canEdit={canEdit} onReplacement={onReplacement} />}
    <div className="machine-placeholder-grid"><section>Linked Inventory Parts coming next</section><section>Machine PM schedules coming next</section><section>Machine documents coming next</section><section>History preview available from Logs</section></div>
    <div className="modal-actions glass-modal__actions"><button className="secondary-button glass-button glass-button--secondary" type="button" onClick={onClose}>Cancel</button><button className="primary-button glass-button glass-button--primary" type="submit" disabled={!canEdit}>{asset?'Save Machine Asset':'Create Machine Asset'}</button></div>
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
function RecordLogsRow({asset,onOpen}:{asset:MachineAsset;onOpen:()=>void}) {
  return <section className="machine-form-section machine-record-logs-section"><span>Screw & Barrel Inspection Records</span><div className="measurement-inspection-row"><MachineRecordLogActions asset={asset} onOpen={onOpen} /><small>Asset-specific uploaded record files for {asset.assetNumber}.</small></div></section>;
}
function ReplacementUpdatesPanel({asset,form,canEdit,onReplacement}:{asset:MachineAsset;form:AssetForm;canEdit:boolean;onReplacement:(asset:MachineAsset,field:ReplacementField)=>void}) {
  const groups = replacementGroups.filter(group=>group.enabled(form));
  return <section className="machine-replacement-panel"><span>Replacement Updates</span><div className="machine-replacement-groups">{groups.map(group=><div className="machine-replacement-group" key={group.title}><strong>{group.title}</strong><div className="machine-replacement-actions">{group.fields.map(field=><button className="machine-action-badge" type="button" key={field} onClick={()=>onReplacement(asset,field)} disabled={!canEdit}><span aria-hidden="true">+</span>New {replacementLabels[field]}</button>)}</div></div>)}</div></section>;
}
function MachineSection({title,children}:{title:string;children:ReactNode}) { return <section className="machine-form-section"><span>{title}</span><div className="machine-form-grid">{children}</div></section>; }
function Text({label,value,set,disabled,helper}:{label:string;value:string;set:(value:string)=>void;disabled:boolean;helper?:ReactNode}) { return <label className="form-field"><span>{label}</span><input className="glass-input" value={value} disabled={disabled} onChange={event=>set(event.target.value)} />{helper}</label>; }
function DecimalInput({label,value,set,disabled}:{label:string;value:string;set:(value:string)=>void;disabled:boolean}) { return <label className="form-field"><span>{label}</span><input className="glass-input" type="number" step="0.01" inputMode="decimal" value={value} disabled={disabled} onChange={event=>set(event.target.value)} /></label>; }
function Area({label,value,set,disabled,tone}:{label:string;value:string;set:(value:string)=>void;disabled:boolean;tone?:'note'|'critical'}) { return <label className={`form-field machine-form-wide ${tone === 'critical' ? 'machine-critical-field' : tone === 'note' ? 'machine-note-field' : ''}`}><span>{label}</span><textarea className="glass-input" value={value} disabled={disabled} onChange={event=>set(event.target.value)} /></label>; }
function Select({label,value,set,options,disabled}:{label:string;value:string;set:(value:string)=>void;options:string[];disabled:boolean}) { return <label className="form-field"><span>{label}</span><select className="glass-input" value={value} disabled={disabled} onChange={event=>set(event.target.value)}>{options.map(option=><option key={option} value={option}>{option || 'Select'}</option>)}</select></label>; }
function Check({label,checked,set,disabled}:{label:string;checked:boolean;set:(checked:boolean)=>void;disabled:boolean}) { return <label className="machine-check-field"><input type="checkbox" checked={checked} disabled={disabled} onChange={event=>set(event.target.checked)} /><span>{label}</span></label>; }
function ConditionSelect({label,value,set,disabled}:{label:string;value:ConditionStatus;set:(value:ConditionStatus)=>void;disabled:boolean}) {
  return <label className="form-field"><span>{label}</span><select className="glass-input" value={value} disabled={disabled} onChange={event=>set(event.target.value as ConditionStatus)}>{(Object.keys(conditionLabels) as ConditionStatus[]).map(option=><option key={option} value={option}>{conditionLabels[option]}</option>)}</select></label>;
}
function ComponentConditionEditor({rebuildLabel,conditionLabel,rebuild,condition,setRebuild,setCondition,disabled}:{rebuildLabel:string;conditionLabel:string;rebuild:boolean;condition:ConditionStatus;setRebuild:(value:boolean)=>void;setCondition:(value:ConditionStatus)=>void;disabled:boolean}) {
  const effective = rebuild ? 'rebuilt_repaired' : condition;
  return <><Check label={rebuildLabel} checked={rebuild} set={checked=>{ setRebuild(checked); setCondition(checked ? 'rebuilt_repaired' : 'new'); }} disabled={disabled}/><ConditionSelect label={conditionLabel} value={effective} set={value=>{ if (value === 'rebuilt_repaired') { setRebuild(true); setCondition('rebuilt_repaired'); } else { setRebuild(false); setCondition(value); } }} disabled={disabled}/></>;
}
function DateWithAge({label,value,set,disabled}:{label:string;value:string;set:(value:string)=>void;disabled:boolean}) {
  return <MccDateInput label={label} value={value} onChange={set} disabled={disabled} helper={<small className="machine-age-label">Year count: {ageYears(value)}</small>} />;
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
      <input className="glass-input" value={value} disabled={disabled} onChange={event=>set(event.target.value)} onBlur={()=>{ if (parseDimensionValue(value)) setIsEditing(false); }} placeholder="100mm, 72in, 6ft" />
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
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><section className="mcc-card machine-logs-modal mcc-wide-modal"><div className="modal-heading"><div><p className="eyebrow">Machine Asset History</p><h3>{logs.asset.assetNumber}</h3></div><button className="link-button compact-button" type="button" onClick={onClose}>Close</button></div><div className="machine-log-list">{logs.records.map(record=><article className="machine-log-row" key={record.id}><span>{formatDateTime(record.createdAt)}</span><strong>{actionLabel(record.action)}</strong><p>{record.userName || 'Unknown'} / {record.reasonNote || 'No reason note'}</p></article>)}{!logs.records.length&&<p className="form-message">No machine-specific logs yet.</p>}</div><div className="modal-actions"><button className="secondary-button" type="button" onClick={onBackToAsset}>Back to Asset</button><button className="primary-button" type="button" onClick={onClose}>Done</button></div></section></div>;
}
