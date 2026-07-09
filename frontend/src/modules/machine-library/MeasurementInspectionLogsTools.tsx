import { useEffect, useMemo, useRef, useState } from 'react';

type MachineImportMode = 'add_new_only' | 'upsert';
type MeasurementLogEntry = { id: string; name: string; size: number; type: string; uploadedAt: string; year: string; hasStoredFile?: boolean };
type StoredMeasurementFile = { id: string; name: string; type: string; uploadedAt: string; blob: Blob };
type TemplateFile = { id: string; name: string; type: string; updatedAt: string; blob: Blob };

const LOG_STORAGE_KEY = 'mcc:measurement-inspection-logs:v2';
const LEGACY_LOG_STORAGE_KEY = 'mcc:measurement-inspection-logs:v1';
const LOG_DB_NAME = 'mcc-measurement-inspection-logs';
const LOG_DB_VERSION = 1;
const LOG_FILE_STORE = 'files';
const TEMPLATE_DB_NAME = 'mcc-measurement-inspection-template';
const TEMPLATE_DB_VERSION = 1;
const TEMPLATE_STORE = 'templates';
const DEFAULT_TEMPLATE_ID = 'screw-barrel-default-template';
const DEFAULT_TEMPLATE_NAME = 'JBT Screw & Barrel Measurement Sheet OLD/NEW Rev. 9';

function formatBytes(size: number) {
  if (!Number.isFinite(size) || size <= 0) return '-';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function logYear(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(new Date().getFullYear()) : String(date.getFullYear());
}

function readLogs(): MeasurementLogEntry[] {
  try {
    const raw = window.localStorage.getItem(LOG_STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_LOG_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    const logs = parsed.map((log: Partial<MeasurementLogEntry>) => ({
      id: String(log.id ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`),
      name: String(log.name ?? 'Measurement inspection record'),
      size: Number(log.size ?? 0),
      type: String(log.type ?? 'File'),
      uploadedAt: String(log.uploadedAt ?? new Date().toISOString()),
      year: String(log.year ?? logYear(String(log.uploadedAt ?? new Date().toISOString()))),
      hasStoredFile: Boolean(log.hasStoredFile),
    }));
    if (!window.localStorage.getItem(LOG_STORAGE_KEY) && logs.length) writeLogs(logs);
    return logs;
  } catch {
    return [];
  }
}

function writeLogs(logs: MeasurementLogEntry[]) {
  window.localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(logs.slice(0, 300)));
}

function availableYears(logs: MeasurementLogEntry[]) {
  const currentYear = new Date().getFullYear();
  const years = new Set(logs.map(log => log.year || logYear(log.uploadedAt)));
  years.add(String(currentYear));
  years.add(String(currentYear + 1));
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

async function saveStoredFile(file: File, id: string, uploadedAt: string) {
  const db = await openDb(LOG_DB_NAME, LOG_FILE_STORE, LOG_DB_VERSION);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(LOG_FILE_STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Unable to save measurement file.'));
    tx.objectStore(LOG_FILE_STORE).put({ id, name: file.name, type: file.type || file.name.split('.').pop()?.toUpperCase() || 'File', uploadedAt, blob: file } satisfies StoredMeasurementFile);
  });
  db.close();
}

async function readStoredFile(id: string) {
  const db = await openDb(LOG_DB_NAME, LOG_FILE_STORE, LOG_DB_VERSION);
  const file = await new Promise<StoredMeasurementFile | undefined>((resolve, reject) => {
    const request = db.transaction(LOG_FILE_STORE, 'readonly').objectStore(LOG_FILE_STORE).get(id);
    request.onerror = () => reject(request.error ?? new Error('Unable to read measurement file.'));
    request.onsuccess = () => resolve(request.result as StoredMeasurementFile | undefined);
  });
  db.close();
  return file;
}

async function deleteStoredFile(id: string) {
  const db = await openDb(LOG_DB_NAME, LOG_FILE_STORE, LOG_DB_VERSION);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(LOG_FILE_STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Unable to delete measurement file.'));
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

function isImage(file: StoredMeasurementFile) {
  return file.type.toLowerCase().startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(file.name);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character] ?? character));
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
        <button className="machine-tools-item" type="button" role="menuitem" onClick={()=>runTool(onImportMachineList)} disabled={!canEdit||isImporting}><span>Import Machine List</span><small>{isImporting ? 'Importing...' : 'CSV or Excel press list'}</small></button>
      </div>
      <div className="machine-tools-grid">
        <button className="machine-tools-item" type="button" role="menuitem" onClick={()=>runTool(onExportTemplate)} disabled={!canEdit}><span>Export Machine Template</span><small>Download workbook template</small></button>
        <button className="machine-tools-item" type="button" role="menuitem" onClick={()=>runTool(onOpenBrandColors)}><span>Brand Color Settings</span><small>Machine card color rules</small></button>
        <button className={showLogs ? 'machine-tools-item active' : 'machine-tools-item'} type="button" role="menuitem" onClick={()=>setShowLogs(current=>!current)}><span>Measurement Inspection Logs</span><small>Year folders and records</small></button>
        <MeasurementQuickActions />
      </div>
      {showLogs&&<MeasurementInspectionLogsPanel canManageYearFolders={canManageYearFolders} />}
    </div>}
  </div>;
}

function MeasurementQuickActions() {
  const templateInputRef = useRef<HTMLInputElement|null>(null);
  const [busy,setBusy]=useState('');

  async function exportMeasurementBackup() {
    setBusy('backup');
    try {
      const logs = readLogs();
      const files = await Promise.all(logs.map(async log => {
        const stored = await readStoredFile(log.id).catch(() => undefined);
        return stored ? { id: stored.id, name: stored.name, type: stored.type, uploadedAt: stored.uploadedAt, dataUrl: await blobToDataUrl(stored.blob) } : null;
      }));
      const template = await readTemplateFile().catch(() => undefined);
      const backup = {
        backupType: 'MCC Measurement Inspection Logs',
        version: 1,
        exportedAt: new Date().toISOString(),
        note: 'Backup of local browser measurement inspection logs, uploaded files, and custom blank form template.',
        logs,
        files: files.filter(Boolean),
        template: template ? { id: template.id, name: template.name, type: template.type, updatedAt: template.updatedAt, dataUrl: await blobToDataUrl(template.blob) } : null,
      };
      downloadTextFile(`MCC_Measurement_Inspection_Backup_${new Date().toISOString().slice(0,10)}.json`, JSON.stringify(backup, null, 2));
    } catch (error) {
      console.error('Measurement backup export failed', error);
      window.alert('Backup export failed. Check console for details.');
    } finally {
      setBusy('');
    }
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
    <button className="machine-tools-item" type="button" role="menuitem" onClick={()=>void exportMeasurementBackup()} disabled={busy==='backup'}><span>Backup Measurement Logs</span><small>JSON with files and template</small></button>
    <button className="machine-tools-item" type="button" role="menuitem" onClick={()=>void printBlankForm()}><span>Print Blank Screw & Barrel Form</span><small>Custom or default blank form</small></button>
    <button className="machine-tools-item" type="button" role="menuitem" onClick={()=>templateInputRef.current?.click()} disabled={busy==='template'}><span>Update Blank Form</span><small>Store a custom template</small></button>
    <input ref={templateInputRef} type="file" hidden accept=".pdf,.png,.jpg,.jpeg" onChange={event=>{ const file = event.target.files?.[0]; if (file) void updateTemplate(file); event.currentTarget.value = ''; }} />
  </>;
}

function MeasurementInspectionLogsPanel({ canManageYearFolders }: { canManageYearFolders: boolean }) {
  const fileInputRef = useRef<HTMLInputElement|null>(null);
  const [logs,setLogs]=useState<MeasurementLogEntry[]>([]);
  const years = useMemo(()=>availableYears(logs),[logs]);
  const [selectedYear,setSelectedYear]=useState(String(new Date().getFullYear()));
  const [selectedIds,setSelectedIds]=useState<Set<string>>(new Set());
  const yearLogs = logs.filter(log => (log.year || logYear(log.uploadedAt)) === selectedYear);
  const selectedReadyCount = yearLogs.filter(log => selectedIds.has(log.id) && log.hasStoredFile).length;

  useEffect(()=>{
    const nextLogs = readLogs();
    setLogs(nextLogs);
    const nextYears = availableYears(nextLogs);
    setSelectedYear(current=>nextYears.includes(current) ? current : nextYears[0]);
  },[]);
  useEffect(()=>{
    if (!years.includes(selectedYear)) setSelectedYear(years[0]);
  },[selectedYear,years]);

  function replaceLogs(nextLogs: MeasurementLogEntry[]) {
    writeLogs(nextLogs);
    setLogs(nextLogs);
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
    if (!files.length) return;
    const uploadedAt = new Date().toISOString();
    const newLogs: MeasurementLogEntry[] = [];
    for (const file of files) {
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      await saveStoredFile(file, id, uploadedAt);
      newLogs.push({ id, name: file.name, size: file.size, type: file.type || file.name.split('.').pop()?.toUpperCase() || 'File', uploadedAt, year: logYear(uploadedAt), hasStoredFile: true });
    }
    replaceLogs([...newLogs, ...readLogs()]);
    setSelectedYear(logYear(uploadedAt));
    setSelectedIds(new Set());
  }

  async function openLogFile(id: string) {
    const stored = await readStoredFile(id);
    if (!stored) {
      window.alert('Upload again to print.');
      return;
    }
    const url = window.URL.createObjectURL(stored.blob);
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (!opened) window.alert('Popup blocked. Allow popups for MCC to open this record.');
    window.setTimeout(() => window.URL.revokeObjectURL(url), 30000);
  }

  async function printSelected() {
    const selectedLogs = yearLogs.filter(log => selectedIds.has(log.id) && log.hasStoredFile);
    if (!selectedLogs.length) {
      window.alert('Select one or more READY measurement logs to print. LOG ONLY records need to be uploaded again first.');
      return;
    }
    const files = (await Promise.all(selectedLogs.map(log => readStoredFile(log.id).catch(() => undefined)))).filter((file): file is StoredMeasurementFile => Boolean(file));
    const pdfs = files.filter(isPdf);
    const otherFiles = files.filter(file => !isPdf(file));
    const objectUrls: string[] = [];
    for (const file of pdfs) {
      const url = window.URL.createObjectURL(file.blob);
      objectUrls.push(url);
      const opened = window.open(url, '_blank', 'noopener,noreferrer');
      if (!opened) {
        window.alert('Popup blocked. Allow popups for MCC so the PDF can open in the browser viewer for printing.');
        break;
      }
    }
    if (otherFiles.length) {
      const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=1100,height=850');
      if (printWindow) {
        const sections = await Promise.all(otherFiles.map(async file => {
          const url = window.URL.createObjectURL(file.blob);
          objectUrls.push(url);
          const safeName = escapeHtml(file.name);
          if (isImage(file)) return `<section class="print-page"><h2>${safeName}</h2><img src="${url}" alt="${safeName}" /></section>`;
          if (file.type.toLowerCase().includes('text') || /\.(csv|txt)$/i.test(file.name)) return `<section class="print-page"><h2>${safeName}</h2><pre>${escapeHtml(await file.blob.text())}</pre></section>`;
          return `<section class="print-page"><h2>${safeName}</h2><p>Open this file and print it from its native app.</p><a href="${url}" download="${safeName}">Open / Download file</a></section>`;
        }));
        printWindow.document.write(`<!doctype html><html><head><title>Measurement Inspection Logs</title><style>body{margin:0;font-family:Arial,sans-serif;color:#111}.print-cover{padding:24px;border-bottom:2px solid #111}.print-page{break-after:page;page-break-after:always;padding:18px}h2{font-size:16px;margin:0 0 12px}img{display:block;max-width:100%;max-height:92vh;margin:0 auto}pre{white-space:pre-wrap;font-size:11px;border:1px solid #ccc;padding:12px}</style></head><body><section class="print-cover"><h1>Measurement Inspection Logs</h1><p>${new Date().toLocaleString()} / ${sections.length} selected non-PDF record(s)</p></section>${sections.join('')}</body></html>`);
        printWindow.document.close();
        window.setTimeout(() => { printWindow.focus(); printWindow.print(); }, 900);
      }
    }
    if (pdfs.length) window.setTimeout(()=>window.alert(`${pdfs.length} PDF record(s) opened in the browser PDF viewer. Use the PDF viewer print button or Ctrl+P to print.`),350);
    window.setTimeout(() => objectUrls.forEach(url => window.URL.revokeObjectURL(url)), 60000);
  }

  async function deleteSelected() {
    const ids = Array.from(selectedIds);
    if (!ids.length) {
      window.alert('Select one or more measurement logs to delete.');
      return;
    }
    if (!window.confirm(`Delete ${ids.length} selected measurement log(s)?`)) return;
    await Promise.all(ids.map(id=>deleteStoredFile(id).catch(()=>undefined)));
    replaceLogs(readLogs().filter(log => !ids.includes(log.id)));
    setSelectedIds(new Set());
  }

  async function deleteYearFolder(year: string) {
    if (!canManageYearFolders) {
      window.alert('Folder delete is locked for this account.');
      return;
    }
    const deleteIds = logs.filter(log => (log.year || logYear(log.uploadedAt)) === year).map(log => log.id);
    if (!deleteIds.length) {
      window.alert(`The ${year} folder is already empty.`);
      return;
    }
    if (!window.confirm(`WARNING: Delete the entire ${year} Measurement Inspection folder and all ${deleteIds.length} log(s)? This cannot be undone.`)) return;
    if (window.prompt(`Type DELETE ${year} to confirm folder deletion.`) !== `DELETE ${year}`) {
      window.alert('Folder delete cancelled.');
      return;
    }
    await Promise.all(deleteIds.map(id=>deleteStoredFile(id).catch(()=>undefined)));
    replaceLogs(readLogs().filter(log => !deleteIds.includes(log.id)));
    setSelectedIds(new Set());
  }

  return <section className="measurement-tools-panel">
    <div className="measurement-tools-heading">
      <div><strong>Measurement Inspection Logs</strong><span>{selectedYear} folder / {yearLogs.length} record(s)</span></div>
      <button className="secondary-button compact-button" type="button" onClick={()=>fileInputRef.current?.click()}>Upload File</button>
      <input ref={fileInputRef} type="file" multiple hidden accept=".pdf,.png,.jpg,.jpeg,.csv,.txt,.xlsx,.xls,.doc,.docx" onChange={event=>{ const files = Array.from(event.target.files ?? []); void uploadFiles(files).catch(error=>{ console.error('Measurement log upload failed', error); window.alert('Measurement log upload failed. Check console for details.'); }); event.currentTarget.value = ''; }} />
    </div>
    <div className="measurement-folder-row" aria-label="Measurement inspection log year folders">
      {years.map(year=>{
        const count = logs.filter(log => (log.year || logYear(log.uploadedAt)) === year).length;
        return <span className={year === selectedYear ? 'measurement-folder-pill-wrap active' : 'measurement-folder-pill-wrap'} key={year}>
          <button className="measurement-year-folder" type="button" onClick={()=>{ setSelectedYear(year); setSelectedIds(new Set()); }} aria-pressed={year === selectedYear}><span className="measurement-folder-glyph" aria-hidden="true" />{year}<em>{count}</em></button>
          {year === selectedYear&&<button className="measurement-folder-delete-x" type="button" aria-label={`Delete ${year} folder`} onClick={()=>void deleteYearFolder(year)}>x</button>}
        </span>;
      })}
    </div>
    <div className="measurement-folder-records">
      <div className="measurement-folder-actions">
        <span>{selectedReadyCount} selected</span>
        <button className="secondary-button compact-button" type="button" onClick={()=>void printSelected()}>Print Selected</button>
        <button className="secondary-button compact-button danger-button" type="button" onClick={()=>void deleteSelected()}>Delete Selected</button>
      </div>
      <div className="measurement-log-list">
        {yearLogs.map(log=>{
          const ready = Boolean(log.hasStoredFile);
          const checked = selectedIds.has(log.id) && ready;
          return <article className={ready ? 'measurement-log-row' : 'measurement-log-row log-only'} key={log.id}>
            <label className="measurement-log-select" title={ready ? 'Select record' : 'Upload this record again before printing.'}><input type="checkbox" checked={checked} disabled={!ready} onChange={event=>toggleSelected(log.id,event.target.checked)} /><span /></label>
            <div className="measurement-log-main"><strong>{log.name}</strong><span>{log.type || 'File'} / {formatBytes(log.size)} / Uploaded {new Date(log.uploadedAt).toLocaleString()}</span><small>Saved: Measurement Inspection Logs / {log.year || logYear(log.uploadedAt)} / {log.name}</small>{!ready&&<small className="measurement-log-upload-note">Upload again to print.</small>}</div>
            <div className="measurement-log-row-actions"><em>{ready ? 'READY' : 'LOG ONLY'}</em><button className="secondary-button compact-button" type="button" onClick={()=>void openLogFile(log.id)}>Open</button></div>
          </article>;
        })}
        {!yearLogs.length&&<div className="measurement-log-empty"><strong>No measurement inspection logs in this folder yet.</strong><span>Upload completed records and MCC will file them by year.</span></div>}
      </div>
    </div>
  </section>;
}
