import { useEffect, useMemo, useRef, useState } from 'react';
import { MccDateInput, formatDateDisplay, isValidMccDateValue, localIsoDate } from '../../components/MccDateInput';

type MachineImportMode = 'add_new_only' | 'upsert';
type MachineToolCategory = 'measurement' | 'brand' | 'doc';
export type MachineRecordLogAsset = { id?: number | string; assetNumber: string; assetName?: string; brand?: string; model?: string; serialNumber?: string };
export type MeasurementLogEntry = { id: string; serverId?: number; name: string; size: number; type: string; uploadedAt: string; recordDate: string; year: string; assetId: string; assetNumber: string; assetName?: string; brand?: string; model?: string; serialNumber?: string; hasStoredFile?: boolean; storage?: 'server' | 'browser'; contentUrl?: string; downloadUrl?: string };
type StoredMeasurementFile = { id: string; name: string; type: string; uploadedAt: string; recordDate?: string; blob: Blob };
type TemplateFile = { id: string; name: string; type: string; updatedAt: string; blob: Blob };

const LOG_STORAGE_KEY = 'mcc:screw-barrel-inspection-records:v3';
const LEGACY_LOG_STORAGE_KEYS = ['mcc:measurement-inspection-logs:v2', 'mcc:measurement-inspection-logs:v1'];
const LOG_DB_NAME = 'mcc-measurement-inspection-logs';
const LOG_DB_VERSION = 1;
const LOG_FILE_STORE = 'files';
const TEMPLATE_DB_NAME = 'mcc-measurement-inspection-template';
const TEMPLATE_DB_VERSION = 1;
const TEMPLATE_STORE = 'templates';
const DEFAULT_TEMPLATE_ID = 'screw-barrel-default-template';
const DEFAULT_TEMPLATE_NAME = 'JBT Screw & Barrel Measurement Sheet OLD/NEW Rev. 9';
export const RECORD_LOGS_UPDATED_EVENT = 'mcc:measurement-record-logs-updated';
const unassignedAsset: MachineRecordLogAsset = { id: 'unassigned', assetNumber: 'Unassigned' };
const toolCategoryLabels: Record<MachineToolCategory, string> = {
  measurement: 'Measurement',
  brand: 'Brand',
  doc: 'Doc / Log',
};

function machineToolClass(category: MachineToolCategory, active = false) {
  return `machine-tools-item machine-tools-${category}${active ? ' active' : ''}`;
}

function MachineToolBadge({ category }: { category: MachineToolCategory }) {
  return <em className="machine-tools-pill">{toolCategoryLabels[category]}</em>;
}

function formatBytes(size: number) {
  if (!Number.isFinite(size) || size <= 0) return '-';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function recordYear(value: string) {
  return isValidMccDateValue(value, true) ? value.slice(0, 4) : String(new Date().getFullYear());
}

function normalizedAssetId(asset: MachineRecordLogAsset | MeasurementLogEntry | undefined) {
  return String(asset?.id ?? asset?.assetNumber ?? unassignedAsset.id);
}

function assetLabel(asset: Pick<MachineRecordLogAsset, 'assetNumber'> | undefined) {
  return asset?.assetNumber?.trim() || unassignedAsset.assetNumber;
}

function assetSlug(asset: MachineRecordLogAsset | undefined) {
  return assetLabel(asset).replace(/\W+/g, '_') || 'All_Assets';
}

function cleanFileToken(value: string, fallback = 'Record') {
  return value.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 90) || fallback;
}

function assetFileToken(value: string) {
  return value.replace(/[^A-Za-z0-9]+/g, '') || 'Asset';
}

function recordDateStamp(logs: MeasurementLogEntry[]) {
  const stamps = logs.map(log => {
    if (isValidMccDateValue(log.recordDate, true)) return log.recordDate;
    const uploadDate = log.uploadedAt.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
    return uploadDate || '';
  }).filter(Boolean).sort((a,b)=>b.localeCompare(a));
  return stamps[0] || localIsoDate(new Date());
}

function combinedPdfFileName(logs: MeasurementLogEntry[], mode: 'selected' | 'folder', year: string, assetScope: boolean) {
  const assets = Array.from(new Set(logs.map(log => assetLabel(log)).filter(Boolean)));
  const date = recordDateStamp(logs);
  if (mode === 'folder') {
    if (!assetScope) return cleanFileToken(`Measurement_Inspection_Logs_${year || date}.pdf`);
    if (assets.length === 1) return cleanFileToken(`${assetFileToken(assets[0])}_Screw_and_Barrel_Inspection_${year || date}.pdf`);
    return cleanFileToken(`Measurement_Inspection_Logs_${year || date}.pdf`);
  }
  if (logs.length === 1 && assets.length === 1) return cleanFileToken(`${assetFileToken(assets[0])}_Screw_and_Barrel_Inspection_${date}.pdf`);
  if (assets.length === 1) return cleanFileToken(`${assetFileToken(assets[0])}_Screw_and_Barrel_Inspection_Selected_${date}.pdf`);
  return cleanFileToken(`Measurement_Inspection_Selected_${date}.pdf`);
}

function normalizeRecord(log: Partial<MeasurementLogEntry>, assetOverride?: MachineRecordLogAsset): MeasurementLogEntry {
  const uploadedAt = String(log.uploadedAt ?? new Date().toISOString());
  const fallbackDate = uploadedAt.slice(0, 10);
  const recordDate = isValidMccDateValue(String(log.recordDate ?? ''), true) ? String(log.recordDate) : fallbackDate;
  const asset = assetOverride ?? {
    id: log.assetId || log.assetNumber || unassignedAsset.id,
    assetNumber: log.assetNumber || unassignedAsset.assetNumber,
    assetName: log.assetName,
    brand: log.brand,
    model: log.model,
    serialNumber: log.serialNumber,
  };
  return {
    id: String(log.id ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`),
    name: String(log.name ?? 'Screw & barrel inspection record'),
    size: Number(log.size ?? 0),
    type: String(log.type ?? 'File'),
    uploadedAt,
    recordDate,
    year: recordYear(recordDate),
    assetId: normalizedAssetId(asset),
    assetNumber: assetLabel(asset),
    assetName: log.assetName || asset.assetName || '',
    brand: asset.brand || '',
    model: asset.model || '',
    serialNumber: asset.serialNumber || '',
    hasStoredFile: Boolean(log.hasStoredFile),
    serverId: Number.isInteger(Number(log.serverId)) ? Number(log.serverId) : undefined,
    storage: log.storage === 'server' ? 'server' : 'browser',
    contentUrl: log.contentUrl,
    downloadUrl: log.downloadUrl,
  };
}

function newestRecordSort(a: MeasurementLogEntry, b: MeasurementLogEntry) {
  const byDate = b.recordDate.localeCompare(a.recordDate);
  return byDate || b.uploadedAt.localeCompare(a.uploadedAt) || b.id.localeCompare(a.id);
}

function readLogs(): MeasurementLogEntry[] {
  try {
    const raw = window.localStorage.getItem(LOG_STORAGE_KEY) ?? LEGACY_LOG_STORAGE_KEYS.map(key=>window.localStorage.getItem(key)).find(Boolean);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    const logs = parsed.map((log: Partial<MeasurementLogEntry>) => normalizeRecord(log));
    if (!window.localStorage.getItem(LOG_STORAGE_KEY) && logs.length) writeLogs(logs);
    return logs.sort(newestRecordSort);
  } catch {
    return [];
  }
}

function writeLogs(logs: MeasurementLogEntry[]) {
  window.localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(logs.slice(0, 1000)));
}

function notifyRecordLogsUpdated() {
  window.dispatchEvent(new Event(RECORD_LOGS_UPDATED_EVENT));
}

export async function loadMeasurementRecordLogs(asset?: MachineRecordLogAsset) {
  const numericAssetId = Number(asset?.id);
  const url = Number.isInteger(numericAssetId) && numericAssetId > 0
    ? `/api/machine-library/assets/${numericAssetId}/inspection-records`
    : '/api/machine-library/inspection-records';
  let serverLogs: MeasurementLogEntry[] = [];
  try {
    const response = await fetch(url, { credentials: 'include' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Inspection records could not be loaded.');
    serverLogs = Array.isArray(data.records) ? data.records.map((log: Partial<MeasurementLogEntry>) => normalizeRecord(log)) : [];
  } catch (error) {
    console.error('Persisted inspection records could not be loaded', error);
  }
  const legacy = scopeLogs(readLogs(), asset).filter(log => log.storage !== 'server');
  return [...serverLogs, ...legacy].sort(newestRecordSort);
}

function availableYears(logs: MeasurementLogEntry[]) {
  const currentYear = new Date().getFullYear();
  const years = new Set(logs.map(log => log.year || recordYear(log.recordDate)));
  years.add(String(currentYear));
  return Array.from(years).sort((a, b) => Number(b) - Number(a));
}

function openDb(name: string, store: string, version = 1): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(name, version);
    request.onerror = () => reject(request.error ?? new Error(`Unable to open ${name}.`));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function saveStoredBlob(blob: Blob, id: string, name: string, type: string, uploadedAt: string, recordDate: string) {
  const db = await openDb(LOG_DB_NAME, LOG_FILE_STORE, LOG_DB_VERSION);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(LOG_FILE_STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Unable to save record file.'));
    tx.objectStore(LOG_FILE_STORE).put({ id, name, type, uploadedAt, recordDate, blob } satisfies StoredMeasurementFile);
  });
  db.close();
}

async function saveStoredFile(file: File, id: string, uploadedAt: string, recordDate: string) {
  await saveStoredBlob(file, id, file.name, file.type || file.name.split('.').pop()?.toUpperCase() || 'File', uploadedAt, recordDate);
}

export async function uploadMeasurementRecordFiles(asset: MachineRecordLogAsset, files: File[]) {
  const recordDate = localIsoDate(new Date());
  if (!files.length) return { count: 0, recordDate };
  const numericAssetId = Number(asset.id);
  if (Number.isInteger(numericAssetId) && numericAssetId > 0) {
    const uploaded: MeasurementLogEntry[] = [];
    for (const file of files) {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('recordDate', recordDate);
      const response = await fetch(`/api/machine-library/assets/${numericAssetId}/inspection-records`, { method: 'POST', credentials: 'include', body: formData });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Upload failed for ${file.name}.`);
      uploaded.push(normalizeRecord(data.record as Partial<MeasurementLogEntry>));
    }
    notifyRecordLogsUpdated();
    return { count: uploaded.length, recordDate, records: uploaded };
  }
  const uploadedAt = new Date().toISOString();
  const newLogs: MeasurementLogEntry[] = [];
  for (const file of files) {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await saveStoredFile(file, id, uploadedAt, recordDate);
    newLogs.push(normalizeRecord({ id, name: file.name, size: file.size, type: file.type || file.name.split('.').pop()?.toUpperCase() || 'File', uploadedAt, recordDate, hasStoredFile: true }, asset));
  }
  writeLogs([...newLogs, ...readLogs()]);
  notifyRecordLogsUpdated();
  return { count: newLogs.length, recordDate, records: newLogs };
}

async function readStoredFile(id: string) {
  const db = await openDb(LOG_DB_NAME, LOG_FILE_STORE, LOG_DB_VERSION);
  const file = await new Promise<StoredMeasurementFile | undefined>((resolve, reject) => {
    const request = db.transaction(LOG_FILE_STORE, 'readonly').objectStore(LOG_FILE_STORE).get(id);
    request.onerror = () => reject(request.error ?? new Error('Unable to read record file.'));
    request.onsuccess = () => resolve(request.result as StoredMeasurementFile | undefined);
  });
  db.close();
  return file;
}

export async function readMeasurementRecordFile(log: MeasurementLogEntry) {
  if (log.storage === 'server' && log.contentUrl) {
    const response = await fetch(log.contentUrl, { credentials: 'include' });
    if (!response.ok) throw new Error('Stored inspection record could not be opened.');
    return { id: log.id, name: log.name, type: log.type || response.headers.get('content-type') || 'application/octet-stream', uploadedAt: log.uploadedAt, recordDate: log.recordDate, blob: await response.blob() } satisfies StoredMeasurementFile;
  }
  return readStoredFile(log.id);
}

export function measurementRecordIsImage(log: MeasurementLogEntry) {
  return log.type.toLowerCase().startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(log.name);
}

export function measurementRecordIsPdf(log: MeasurementLogEntry) {
  return log.type.toLowerCase().includes('pdf') || /\.pdf$/i.test(log.name);
}

async function deleteStoredFile(id: string) {
  const db = await openDb(LOG_DB_NAME, LOG_FILE_STORE, LOG_DB_VERSION);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(LOG_FILE_STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Unable to delete record file.'));
    tx.objectStore(LOG_FILE_STORE).delete(id);
  });
  db.close();
}

async function saveTemplateFile(file: File) {
  const db = await openDb(TEMPLATE_DB_NAME, TEMPLATE_STORE, TEMPLATE_DB_VERSION);
  const template: TemplateFile = { id: DEFAULT_TEMPLATE_ID, name: file.name, type: file.type || 'application/pdf', updatedAt: new Date().toISOString(), blob: file };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(TEMPLATE_STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Unable to save template.'));
    tx.objectStore(TEMPLATE_STORE).put(template);
  });
  db.close();
}

async function readTemplateFile() {
  const db = await openDb(TEMPLATE_DB_NAME, TEMPLATE_STORE, TEMPLATE_DB_VERSION);
  const template = await new Promise<TemplateFile | undefined>((resolve, reject) => {
    const request = db.transaction(TEMPLATE_STORE, 'readonly').objectStore(TEMPLATE_STORE).get(DEFAULT_TEMPLATE_ID);
    request.onerror = () => reject(request.error ?? new Error('Unable to read template.'));
    request.onsuccess = () => resolve(request.result as TemplateFile | undefined);
  });
  db.close();
  return template;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read file for backup.'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(dataUrl: string) {
  const res = await fetch(dataUrl);
  return res.blob();
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'application/json' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 30000);
}

function printDefaultBlankForm() {
  const win = window.open('', '_blank', 'width=1100,height=850');
  if (!win) {
    window.alert('Popup blocked. Allow popups for MCC to print the blank form.');
    return;
  }
  const stations = Array.from({ length: 14 }, (_, index) => `<div class="line">Station ${index + 1}</div>`).join('');
  const screwLines = Array.from({ length: 12 }, (_, index) => `<div class="line">Root / Flight ${index + 1}</div>`).join('');
  win.document.write(`<!doctype html><html><head><title>${DEFAULT_TEMPLATE_NAME}</title><style>body{font-family:Arial,sans-serif;margin:18px;color:#111}h1{font-size:18px;margin:0;text-align:center}p{margin:4px 0 10px;text-align:center}.grid{display:grid;grid-template-columns:repeat(5,1fr);gap:6px}.field,.check{border:1px solid #111;min-height:28px;padding:4px;font-size:10px}.checks{display:grid;grid-template-columns:repeat(8,1fr);gap:4px}.section{border:2px solid #111;margin:9px 0;padding:8px}.line{height:30px;border-bottom:1px solid #111;font-size:10px}.big{min-height:74px}@media print{.no-print{display:none}body{margin:9mm}}</style></head><body><button class="no-print" onclick="window.print()">Print</button><h1>SCREW & BARREL MEASUREMENT SHEET OLD/NEW Rev. 9</h1><p>Blank inspection record</p><div class="grid"><div class="field">Press #</div><div class="field">Press S/N</div><div class="field">Plant</div><div class="field">Injection Size oz</div><div class="field">OEM Barrel Bore</div></div><h3>Reason For Pull</h3><div class="checks"><div class="check">Contamination</div><div class="check">Splay</div><div class="check">Cushion</div><div class="check">Streaks</div><div class="check">Metal</div><div class="check">Recovery</div><div class="check">History</div><div class="check">Other</div></div><div class="section"><h3>Barrel Inside Diameter Measurements</h3>${stations}</div><div class="section"><h3>Screw Root / Flight Measurements</h3>${screwLines}</div><div class="grid"><div class="field">Check Ring Dia</div><div class="field">Tip Mfg.</div><div class="field">Tip Part #</div><div class="field">Tip Type</div><div class="field">Seat Condition</div><div class="field">Screw Serial #</div><div class="field">Screw Part #</div><div class="field">L/D</div><div class="field">Compression Ratio</div><div class="field">Lead Gap Measurement</div><div class="field">Name</div><div class="field">Date Measured</div><div class="field">Date Installed</div><div class="field big" style="grid-column:span 2">Comments</div></div><script>setTimeout(()=>window.print(),400)</script></body></html>`);
  win.document.close();
}

function isPdf(file: StoredMeasurementFile) {
  return file.type.toLowerCase().includes('pdf') || file.name.toLowerCase().endsWith('.pdf');
}

function scopeLogs(logs: MeasurementLogEntry[], asset?: MachineRecordLogAsset) {
  if (!asset) return logs;
  const key = normalizedAssetId(asset);
  return logs.filter(log => log.assetId === key || log.assetNumber === asset.assetNumber);
}

async function backupLogs(logs: MeasurementLogEntry[], asset?: MachineRecordLogAsset) {
  const files = await Promise.all(logs.map(async log => {
    const stored = await readMeasurementRecordFile(log).catch(() => undefined);
    return stored ? { id: log.id, name: stored.name, type: stored.type, uploadedAt: stored.uploadedAt, recordDate: log.recordDate, dataUrl: await blobToDataUrl(stored.blob) } : null;
  }));
  const template = await readTemplateFile().catch(() => undefined);
  const backup = {
    backupType: 'MCC Screw & Barrel Inspection Records',
    version: 3,
    exportedAt: new Date().toISOString(),
    scope: asset ? { assetId: normalizedAssetId(asset), assetNumber: assetLabel(asset) } : { assetNumber: 'All Assets' },
    logs,
    files: files.filter(Boolean),
    template: template ? { id: template.id, name: template.name, type: template.type, updatedAt: template.updatedAt, dataUrl: await blobToDataUrl(template.blob) } : null,
  };
  downloadTextFile(`MCC_Screw_Barrel_Record_Backup_${assetSlug(asset)}_${new Date().toISOString().slice(0,10)}.json`, JSON.stringify(backup, null, 2));
}

async function printBlankForm() {
  const template = await readTemplateFile().catch(() => undefined);
  if (!template) {
    printDefaultBlankForm();
    return;
  }
  const url = window.URL.createObjectURL(template.blob);
  const win = window.open(url, '_blank', 'width=1100,height=850');
  if (!win) window.alert('Popup blocked. Allow popups for MCC to open the blank form.');
  window.setTimeout(() => window.URL.revokeObjectURL(url), 30000);
}

export function MachineLibraryToolsDropdown({
  canEdit,
  canManageYearFolders,
  importMode,
  setImportMode,
  isImporting,
  onImportMachineList,
  onExportTemplate,
  onOpenBrandColors,
}: {
  canEdit: boolean;
  canManageYearFolders: boolean;
  importMode: MachineImportMode;
  setImportMode: (value: MachineImportMode) => void;
  isImporting: boolean;
  onImportMachineList: () => void;
  onExportTemplate: () => void;
  onOpenBrandColors: () => void;
}) {
  const [open,setOpen]=useState(false);
  const [showLogs,setShowLogs]=useState(false);
  const wrapRef = useRef<HTMLDivElement|null>(null);

  useEffect(()=>{
    if (!open) return undefined;
    function onPointerDown(event: PointerEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown',onPointerDown);
    document.addEventListener('keydown',onKeyDown);
    return ()=>{
      document.removeEventListener('pointerdown',onPointerDown);
      document.removeEventListener('keydown',onKeyDown);
    };
  },[open]);

  function runTool(action: () => void) {
    action();
    if (!showLogs) setOpen(false);
  }

  return <div className="machine-tools-wrap" ref={wrapRef}>
    <button className={open ? 'secondary-button compact-button machine-tools-toggle active' : 'secondary-button compact-button machine-tools-toggle'} type="button" aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(current=>!current)}>
      <span className="machine-tools-icon" aria-hidden="true">Tools</span>
    </button>
    {open&&<div className="machine-tools-menu" role="menu" aria-label="Machine Library tools">
      <div className="machine-tools-primary-row">
        <label className="form-field machine-tools-import-mode"><span>Import Mode</span><select value={importMode} onChange={event=>setImportMode(event.target.value as MachineImportMode)} disabled={!canEdit||isImporting}><option value="add_new_only">Add New Only</option><option value="upsert">Update Existing / Upsert</option></select></label>
        <button className={machineToolClass('doc')} type="button" role="menuitem" onClick={()=>runTool(onImportMachineList)} disabled={!canEdit||isImporting}><MachineToolBadge category="doc" /><span>Import Machine List</span><small>{isImporting ? 'Importing...' : 'CSV or Excel press list'}</small></button>
      </div>
      <div className="machine-tools-grid">
        <button className={machineToolClass('doc')} type="button" role="menuitem" onClick={()=>runTool(onExportTemplate)} disabled={!canEdit}><MachineToolBadge category="doc" /><span>Export Machine Template</span><small>Download workbook template</small></button>
        <button className={machineToolClass('brand')} type="button" role="menuitem" onClick={()=>runTool(onOpenBrandColors)}><MachineToolBadge category="brand" /><span>Brand Color Settings</span><small>Machine card color rules</small></button>
        <button className={machineToolClass('measurement', showLogs)} type="button" role="menuitem" onClick={()=>setShowLogs(current=>!current)}><MachineToolBadge category="measurement" /><span>Measurement Inspection Logs</span><small>All asset record folders</small></button>
        <MeasurementQuickActions />
      </div>
      {showLogs&&<MeasurementRecordLogsPanel canManageYearFolders={canManageYearFolders} />}
    </div>}
  </div>;
}

function MeasurementQuickActions() {
  const templateInputRef = useRef<HTMLInputElement|null>(null);
  const [busy,setBusy]=useState('');

  async function exportMeasurementBackup() {
    setBusy('backup');
    try {
      await backupLogs(readLogs());
    } catch (error) {
      console.error('Record backup export failed', error);
      window.alert('Backup export failed. Check console for details.');
    } finally {
      setBusy('');
    }
  }

  async function updateTemplate(file: File) {
    setBusy('template');
    try {
      await saveTemplateFile(file);
      window.alert('Blank form template updated. Print Blank Form will use the updated file.');
    } catch (error) {
      console.error('Template update failed', error);
      window.alert('Template update failed.');
    } finally {
      setBusy('');
    }
  }

  return <>
    <button className={machineToolClass('measurement')} type="button" role="menuitem" onClick={()=>void exportMeasurementBackup()} disabled={busy==='backup'}><MachineToolBadge category="measurement" /><span>Backup Measurement Logs</span><small>JSON with files and template</small></button>
    <button className={machineToolClass('doc')} type="button" role="menuitem" onClick={()=>void printBlankForm()}><MachineToolBadge category="doc" /><span>Print Blank Screw & Barrel Form</span><small>Custom or default blank form</small></button>
    <button className={machineToolClass('doc')} type="button" role="menuitem" onClick={()=>templateInputRef.current?.click()} disabled={busy==='template'}><MachineToolBadge category="doc" /><span>Update Blank Form</span><small>Store a custom template</small></button>
    <input ref={templateInputRef} type="file" hidden accept=".pdf,.png,.jpg,.jpeg" onChange={event=>{ const file = event.target.files?.[0]; if (file) void updateTemplate(file); event.currentTarget.value = ''; }} />
  </>;
}

export function AssetMeasurementRecordLogsModal({ asset, canManageYearFolders, onClose }: { asset: MachineRecordLogAsset; canManageYearFolders: boolean; onClose: () => void }) {
  return <div className="modal-backdrop measurement-modal-backdrop" role="dialog" aria-modal="true">
    <section className="mcc-card measurement-record-modal">
      <div className="modal-heading measurement-modal-heading"><div><p className="eyebrow">Screw & Barrel Inspection Records</p><h3>{assetLabel(asset)} Record Logs</h3><p>{[asset.brand, asset.model, asset.serialNumber ? `S/N ${asset.serialNumber}` : ''].filter(Boolean).join(' / ')}</p></div><button className="link-button compact-button" type="button" onClick={onClose}>Close</button></div>
      <MeasurementRecordLogsPanel asset={asset} canManageYearFolders={canManageYearFolders} />
    </section>
  </div>;
}

function MeasurementRecordLogsPanel({ asset, canManageYearFolders }: { asset?: MachineRecordLogAsset; canManageYearFolders: boolean }) {
  const fileInputRef = useRef<HTMLInputElement|null>(null);
  const importInputRef = useRef<HTMLInputElement|null>(null);
  const templateInputRef = useRef<HTMLInputElement|null>(null);
  const [logs,setLogs]=useState<MeasurementLogEntry[]>([]);
  const [selectedYear,setSelectedYear]=useState(String(new Date().getFullYear()));
  const [openYear,setOpenYear]=useState<string|null>(asset ? String(new Date().getFullYear()) : null);
  const [selectedIds,setSelectedIds]=useState<Set<string>>(new Set());
  const [busy,setBusy]=useState('');
  const scopedLogs = useMemo(()=>scopeLogs(logs, asset),[logs,asset]);
  const years = useMemo(()=>availableYears(scopedLogs),[scopedLogs]);
  const isAssetPanel = Boolean(asset);
  const isGlobalFolderView = !isAssetPanel && Boolean(openYear);
  const activeYear = isAssetPanel ? selectedYear : openYear ?? selectedYear;
  const yearLogs = scopedLogs.filter(log => (log.year || recordYear(log.recordDate)) === activeYear);
  const selectedLogs = yearLogs.filter(log => selectedIds.has(log.id) && log.hasStoredFile);
  const readyYearLogs = yearLogs.filter(log => log.hasStoredFile);

  useEffect(()=>{
    let cancelled = false;
    async function refreshLogs() {
      const nextLogs = await loadMeasurementRecordLogs(asset);
      if (cancelled) return;
      setLogs(nextLogs);
      const nextYears = availableYears(scopeLogs(nextLogs, asset));
      setSelectedYear(current=>nextYears.includes(current) ? current : nextYears[0]);
    }
    void refreshLogs();
    window.addEventListener(RECORD_LOGS_UPDATED_EVENT, refreshLogs);
    return ()=>{ cancelled = true; window.removeEventListener(RECORD_LOGS_UPDATED_EVENT, refreshLogs); };
  },[asset]);
  useEffect(()=>{
    if (!years.includes(selectedYear)) setSelectedYear(years[0]);
    if (asset && (!openYear || !years.includes(openYear))) setOpenYear(years[0]);
    if (!asset && openYear && !years.includes(openYear)) setOpenYear(null);
  },[asset,openYear,selectedYear,years]);

  function replaceLogs(nextLogs: MeasurementLogEntry[]) {
    writeLogs(nextLogs);
    setLogs(nextLogs);
    notifyRecordLogsUpdated();
  }

  function toggleSelected(id: string, checked: boolean) {
    setSelectedIds(current=>{
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function uploadFiles(files: File[]) {
    if (!asset) {
      window.alert('Open an asset Record Logs panel before uploading records.');
      return;
    }
    if (!files.length) return;
    const result = await uploadMeasurementRecordFiles(asset, files);
    setLogs(await loadMeasurementRecordLogs(asset));
    setSelectedYear(recordYear(result.recordDate));
    setSelectedIds(new Set());
  }

  async function importBackup(file: File) {
    setBusy('import');
    try {
      const parsed = JSON.parse(await file.text()) as { logs?: Partial<MeasurementLogEntry>[]; files?: Array<{ id?: string; name: string; type: string; uploadedAt?: string; recordDate?: string; dataUrl: string }>; template?: { name: string; type: string; updatedAt?: string; dataUrl: string } | null };
      const fileMap = new Map((parsed.files ?? []).map(item=>[String(item.id ?? item.name), item]));
      const imported: MeasurementLogEntry[] = [];
      for (const rawLog of parsed.logs ?? []) {
        const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const importedLog = normalizeRecord({ ...rawLog, id, serverId: undefined, storage: 'browser', contentUrl: undefined, downloadUrl: undefined }, asset);
        const fileEntry = fileMap.get(String(rawLog.id ?? rawLog.name)) ?? fileMap.get(importedLog.name);
        if (fileEntry?.dataUrl) {
          const blob = await dataUrlToBlob(fileEntry.dataUrl);
          await saveStoredBlob(blob, id, fileEntry.name || importedLog.name, fileEntry.type || importedLog.type, fileEntry.uploadedAt || importedLog.uploadedAt, importedLog.recordDate);
          importedLog.hasStoredFile = true;
        }
        imported.push(importedLog);
      }
      if (parsed.template?.dataUrl) {
        const blob = await dataUrlToBlob(parsed.template.dataUrl);
        await saveTemplateFile(new File([blob], parsed.template.name || DEFAULT_TEMPLATE_NAME, { type: parsed.template.type || blob.type || 'application/pdf' }));
      }
      replaceLogs([...imported, ...readLogs()]);
      setSelectedYear(imported[0]?.year ?? selectedYear);
      setSelectedIds(new Set());
      window.alert(`Imported ${imported.length} record log(s).`);
    } catch (error) {
      console.error('Record import failed', error);
      window.alert('Import failed. Choose a valid MCC record backup JSON file.');
    } finally {
      setBusy('');
    }
  }

  async function openLogFile(log: MeasurementLogEntry) {
    const stored = await readMeasurementRecordFile(log);
    if (!stored) {
      window.alert('Upload again to print.');
      return;
    }
    const url = window.URL.createObjectURL(stored.blob);
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (!opened) window.alert('Popup blocked. Allow popups for MCC to open this record.');
    window.setTimeout(() => window.URL.revokeObjectURL(url), 30000);
  }

  async function updateRecordDate(log: MeasurementLogEntry, recordDate: string) {
    if (!isValidMccDateValue(recordDate, true)) return;
    const nextYear = recordYear(recordDate);
    if (log.storage === 'server' && log.serverId) {
      const response = await fetch(`/api/machine-library/inspection-records/${log.serverId}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recordDate }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { window.alert(data.error || 'Record date could not be updated.'); return; }
      setLogs(await loadMeasurementRecordLogs(asset));
      notifyRecordLogsUpdated();
    } else {
      replaceLogs(readLogs().map(item=>item.id === log.id ? { ...item, recordDate, year: recordYear(recordDate) } : item));
    }
    setSelectedYear(nextYear);
    if (!asset) setOpenYear(nextYear);
  }

  async function generateCombinedPdf(records: MeasurementLogEntry[], label: 'selected' | 'folder') {
    const ready = records.filter(log=>log.hasStoredFile);
    if (!ready.length) {
      window.alert('Select one or more READY record logs to generate a combined PDF.');
      return;
    }
    setBusy(label);
    const objectUrls: string[] = [];
    try {
      const fileName = combinedPdfFileName(ready, label, activeYear, Boolean(asset));
      const payloadRecords = (await Promise.all(ready.map(async log => {
        const stored = await readMeasurementRecordFile(log).catch(() => undefined);
        if (!stored) return null;
        return { ...log, dataUrl: await blobToDataUrl(stored.blob), type: stored.type || log.type, name: stored.name || log.name };
      }))).filter(Boolean);
      const res = await fetch('/api/machine-library/measurement-records/combined-pdf',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({ title: asset ? `${assetLabel(asset)} Screw & Barrel Inspection Records` : 'Screw & Barrel Inspection Records', fileName, records: payloadRecords })});
      if (!res.ok) {
        const data = await res.json().catch(()=>({}));
        throw new Error(data.error || 'Combined PDF generation failed.');
      }
      const blob = await res.blob();
      const pdfFile = new File([blob], fileName, { type: 'application/pdf' });
      const url = window.URL.createObjectURL(pdfFile);
      objectUrls.push(url);
      const opened = window.open(url, '_blank', 'noopener,noreferrer');
      if (!opened) window.alert('Popup blocked. Allow popups for MCC to open the combined PDF.');
    } catch (error) {
      console.error('Combined record PDF failed', error);
      window.alert('Combined PDF generation failed. Check console for details.');
    } finally {
      setBusy('');
      window.setTimeout(() => objectUrls.forEach(url => window.URL.revokeObjectURL(url)), 60000);
    }
  }

  async function openSelectedRecords() {
    if (!selectedLogs.length) {
      window.alert('Select one or more READY record logs to open.');
      return;
    }
    setBusy('open');
    const objectUrls: string[] = [];
    try {
      for (const log of selectedLogs) {
        const stored = await readMeasurementRecordFile(log).catch(() => undefined);
        if (!stored) continue;
        const url = window.URL.createObjectURL(stored.blob);
        objectUrls.push(url);
        const opened = window.open(url, '_blank', 'noopener,noreferrer');
        if (!opened) {
          window.alert('Popup blocked. Allow popups for MCC to open selected records.');
          break;
        }
      }
    } finally {
      setBusy('');
      window.setTimeout(() => objectUrls.forEach(url => window.URL.revokeObjectURL(url)), 30000);
    }
  }

  async function deleteSelected() {
    const ids = Array.from(selectedIds);
    if (!ids.length) {
      window.alert('Select one or more record logs to delete.');
      return;
    }
    if (!window.confirm(`Delete ${ids.length} selected record log(s)?`)) return;
    const targets = logs.filter(log => ids.includes(log.id));
    await Promise.all(targets.map(log => log.storage === 'server' && log.serverId
      ? fetch(`/api/machine-library/inspection-records/${log.serverId}`, { method: 'DELETE', credentials: 'include' }).then(response => { if (!response.ok) throw new Error('Delete failed.'); })
      : deleteStoredFile(log.id)).map(promise => promise.catch(() => undefined)));
    writeLogs(readLogs().filter(log => !ids.includes(log.id)));
    setLogs(await loadMeasurementRecordLogs(asset));
    notifyRecordLogsUpdated();
    setSelectedIds(new Set());
  }

  async function deleteYearFolder(year: string) {
    if (!canManageYearFolders) {
      window.alert('Folder delete is locked for this account.');
      return;
    }
    const deleteIds = scopedLogs.filter(log => (log.year || recordYear(log.recordDate)) === year).map(log => log.id);
    if (!deleteIds.length) {
      window.alert(`The ${year} folder is already empty.`);
      return;
    }
    if (!window.confirm(`WARNING: Delete the entire ${year} record folder and all ${deleteIds.length} log(s)? This cannot be undone.`)) return;
    if (window.prompt(`Type DELETE ${year} to confirm folder deletion.`) !== `DELETE ${year}`) {
      window.alert('Folder delete cancelled.');
      return;
    }
    const targets = scopedLogs.filter(log => deleteIds.includes(log.id));
    await Promise.all(targets.map(log => log.storage === 'server' && log.serverId
      ? fetch(`/api/machine-library/inspection-records/${log.serverId}`, { method: 'DELETE', credentials: 'include' }).then(response => { if (!response.ok) throw new Error('Delete failed.'); })
      : deleteStoredFile(log.id)).map(promise => promise.catch(() => undefined)));
    writeLogs(readLogs().filter(log => !deleteIds.includes(log.id)));
    setLogs(await loadMeasurementRecordLogs(asset));
    notifyRecordLogsUpdated();
    setSelectedIds(new Set());
  }

  async function updateTemplate(file: File) {
    setBusy('template');
    try {
      await saveTemplateFile(file);
      window.alert('Blank form template updated. Print Blank Form will use the updated file.');
    } catch (error) {
      console.error('Template update failed', error);
      window.alert('Template update failed.');
    } finally {
      setBusy('');
    }
  }

  function openFolder(year: string) {
    setSelectedYear(year);
    setOpenYear(year);
    setSelectedIds(new Set());
  }

  const folderSummary = isAssetPanel || isGlobalFolderView
    ? `${activeYear} folder / ${yearLogs.length} record(s)`
    : `${years.length} year folder(s) / ${scopedLogs.length} record(s)`;

  return <section className="measurement-tools-panel measurement-records-panel">
    <div className="measurement-tools-heading">
      <div><strong>{isAssetPanel ? 'Screw & Barrel Inspection Records' : isGlobalFolderView ? `${activeYear} Screw & Barrel Records` : 'Global Screw & Barrel Inspection Records'}</strong><span>{folderSummary}</span></div>
      {isGlobalFolderView&&<button className="secondary-button compact-button measurement-folder-back-button" type="button" onClick={()=>{ setOpenYear(null); setSelectedIds(new Set()); }}>Back to Folders</button>}
      <RecordPanelToolsDropdown
        canUpload={Boolean(asset)}
        busy={Boolean(busy)}
        canPrintSelected={selectedLogs.length > 0}
        canPrintFolder={(isAssetPanel || isGlobalFolderView) && readyYearLogs.length > 0}
        canDeleteSelected={selectedIds.size > 0}
        onUpload={()=>fileInputRef.current?.click()}
        onImport={()=>importInputRef.current?.click()}
        onPrintSelected={()=>void generateCombinedPdf(selectedLogs,'selected')}
        onPrintFolder={()=>void generateCombinedPdf(readyYearLogs,'folder')}
        onDeleteSelected={()=>void deleteSelected()}
        onBackup={()=>void backupLogs(scopedLogs, asset)}
        onPrintBlank={()=>void printBlankForm()}
        onUpdateForm={()=>templateInputRef.current?.click()}
      />
      <input ref={fileInputRef} type="file" multiple hidden accept=".pdf,.png,.jpg,.jpeg,.csv,.txt,.xlsx,.xls,.doc,.docx" onChange={event=>{ const files = Array.from(event.target.files ?? []); void uploadFiles(files).catch(error=>{ console.error('Record upload failed', error); window.alert('Record upload failed. Check console for details.'); }); event.currentTarget.value = ''; }} />
      <input ref={importInputRef} type="file" hidden accept=".json" onChange={event=>{ const file = event.target.files?.[0]; if (file) void importBackup(file); event.currentTarget.value = ''; }} />
      <input ref={templateInputRef} type="file" hidden accept=".pdf,.png,.jpg,.jpeg" onChange={event=>{ const file = event.target.files?.[0]; if (file) void updateTemplate(file); event.currentTarget.value = ''; }} />
    </div>
    <div className="measurement-folder-row" aria-label="Screw and barrel record year folders">
      {years.map(year=>{
        const count = scopedLogs.filter(log => (log.year || recordYear(log.recordDate)) === year).length;
        const active = year === activeYear && (isAssetPanel || isGlobalFolderView);
        return <span className={active ? 'measurement-folder-pill-wrap active' : 'measurement-folder-pill-wrap'} key={year}>
          <button className="measurement-year-folder" type="button" onClick={()=>{ isAssetPanel ? (setSelectedYear(year), setSelectedIds(new Set())) : openFolder(year); }} aria-pressed={active}><span className="measurement-folder-glyph" aria-hidden="true" />{year}<em>{count}</em></button>
          {active&&<button className="measurement-folder-delete-x" type="button" aria-label={`Delete ${year} folder`} onClick={()=>void deleteYearFolder(year)}>x</button>}
        </span>;
      })}
    </div>
    {(isAssetPanel||isGlobalFolderView)&&<div className="measurement-folder-records">
      <div className="measurement-folder-actions">
        <span>{selectedLogs.length} selected</span>
        <button className="secondary-button compact-button" type="button" onClick={()=>void openSelectedRecords()} disabled={Boolean(busy)||!selectedLogs.length}>Open Selected</button>
        <button className="secondary-button compact-button" type="button" onClick={()=>void generateCombinedPdf(selectedLogs,'selected')} disabled={Boolean(busy)||!selectedLogs.length}>Print Selected</button>
        <button className="secondary-button compact-button" type="button" onClick={()=>void generateCombinedPdf(readyYearLogs,'folder')} disabled={Boolean(busy)||!readyYearLogs.length}>Print Folder PDF</button>
        <button className="secondary-button compact-button danger-button" type="button" onClick={()=>void deleteSelected()} disabled={Boolean(busy)||!selectedIds.size}>Delete Selected</button>
      </div>
      <div className="measurement-log-list">
        {yearLogs.map(log=>{
          const ready = Boolean(log.hasStoredFile);
          const checked = selectedIds.has(log.id) && ready;
          return <article className={ready ? 'measurement-log-row measurement-record-row' : 'measurement-log-row measurement-record-row log-only'} key={log.id}>
            <label className="measurement-log-select" title={ready ? 'Select record' : 'Upload this record again before printing.'}><input type="checkbox" checked={checked} disabled={!ready} onChange={event=>toggleSelected(log.id,event.target.checked)} /><span /></label>
            <div className="measurement-log-main"><div className="measurement-record-title-line"><span className="measurement-asset-pill">{log.assetNumber}</span><span className="measurement-record-date-pill">{formatDateDisplay(log.recordDate)}</span><strong>{log.name}</strong></div><span>{log.type || 'File'} / {formatBytes(log.size)} / Uploaded {new Date(log.uploadedAt).toLocaleString()}</span><small>Saved: Screw & Barrel Inspection Records / {log.year || recordYear(log.recordDate)} / {log.name}</small>{!ready&&<small className="measurement-log-upload-note">Upload again to print.</small>}</div>
            <div className="measurement-record-date-cell"><MccDateInput label="Record Date" value={log.recordDate} onChange={recordDate=>void updateRecordDate(log, recordDate)} /></div>
            <div className="measurement-log-row-actions"><em className={ready ? 'measurement-status-pill status-ready' : 'measurement-status-pill status-log-only'}>{ready ? 'READY' : 'LOG ONLY'}</em><button className="secondary-button compact-button" type="button" onClick={()=>void openLogFile(log)}>Open</button></div>
          </article>;
        })}
        {!yearLogs.length&&<div className="measurement-log-empty"><strong>No screw & barrel inspection records in this folder yet.</strong><span>{asset ? `Upload completed records for ${assetLabel(asset)}.` : 'Open an asset Record Logs panel to upload completed records.'}</span></div>}
      </div>
    </div>}
  </section>;
}

function RecordPanelToolsDropdown({
  canUpload,
  busy,
  canPrintSelected,
  canPrintFolder,
  canDeleteSelected,
  onUpload,
  onImport,
  onPrintSelected,
  onPrintFolder,
  onDeleteSelected,
  onBackup,
  onPrintBlank,
  onUpdateForm,
}: {
  canUpload: boolean;
  busy: boolean;
  canPrintSelected: boolean;
  canPrintFolder: boolean;
  canDeleteSelected: boolean;
  onUpload: () => void;
  onImport: () => void;
  onPrintSelected: () => void;
  onPrintFolder: () => void;
  onDeleteSelected: () => void;
  onBackup: () => void;
  onPrintBlank: () => void;
  onUpdateForm: () => void;
}) {
  const [open,setOpen]=useState(false);
  const wrapRef = useRef<HTMLDivElement|null>(null);
  useEffect(()=>{
    if (!open) return undefined;
    function onPointerDown(event: PointerEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown',onPointerDown);
    document.addEventListener('keydown',onKeyDown);
    return ()=>{
      document.removeEventListener('pointerdown',onPointerDown);
      document.removeEventListener('keydown',onKeyDown);
    };
  },[open]);
  function run(action: () => void) {
    action();
    setOpen(false);
  }
  return <div className="record-panel-tools-wrap" ref={wrapRef}>
    <button className={open ? 'secondary-button compact-button machine-tools-toggle active' : 'secondary-button compact-button machine-tools-toggle'} type="button" aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(current=>!current)}>Tools</button>
    {open&&<div className="record-panel-tools-menu" role="menu" aria-label="Record log tools">
      <button type="button" role="menuitem" onClick={()=>run(onUpload)} disabled={!canUpload || busy}>Upload File</button>
      <button type="button" role="menuitem" onClick={()=>run(onImport)} disabled={busy}>Import File</button>
      <button type="button" role="menuitem" onClick={()=>run(onPrintSelected)} disabled={busy || !canPrintSelected}>Print Selected</button>
      <button type="button" role="menuitem" onClick={()=>run(onPrintFolder)} disabled={busy || !canPrintFolder}>Print Folder PDF</button>
      <button type="button" role="menuitem" onClick={()=>run(onDeleteSelected)} disabled={busy || !canDeleteSelected}>Delete Selected</button>
      <button type="button" role="menuitem" onClick={()=>run(onBackup)} disabled={busy}>Backup Data</button>
      <button type="button" role="menuitem" onClick={()=>run(onPrintBlank)} disabled={busy}>Print Blank Form</button>
      <button type="button" role="menuitem" onClick={()=>run(onUpdateForm)} disabled={busy}>Update Form</button>
    </div>}
  </div>;
}
