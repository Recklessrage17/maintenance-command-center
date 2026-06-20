import { FormEvent, useEffect, useMemo, useState } from 'react';

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
  orderPlaced: boolean;
  hasActiveRequisitionRecord: boolean;
  partInfoUrl: string;
  updatedAt: string;
};

type PartsResponse = {
  ok: boolean;
  mit3Url?: string;
  source?: string;
  writeAvailable?: boolean;
  parts: InventoryPart[];
  summary?: NativeSummary;
};

type FilterMode = 'all' | 'low' | 'requisition' | 'hasLink' | 'noLink';
type ModalMode = 'add' | 'edit';
type Notice = { kind: 'success' | 'error'; text: string };
type SortKey = 'partNumber' | 'description' | 'location' | 'vendor' | 'quantity' | 'minQuantity' | 'status';
type SortDirection = 'asc' | 'desc';
type PageSize = 50 | 100 | 250 | 'all';

type NativeSummary = {
  totalParts: number;
  lowStockCount: number;
  requisitionCount: number;
  vendorCount: number;
  locationCount: number;
  lastImportedFromMit3At: string | null;
};

type NativeSummaryResponse = NativeSummary & { ok: boolean };

type ImportSummary = {
  importedCount: number;
  updatedCount: number;
  skippedCount: number;
  vendorCount: number;
  locationCount: number;
  skippedUrlCount?: number;
  errors: string[];
  importedFromMit3At?: string;
  nativeSummary?: NativeSummary;
};

type BackupFile = {
  fileName: string;
  createdTime: string;
  type: 'JSON' | 'CSV';
  size: number;
};

type BackupListResponse = {
  ok: boolean;
  backups: BackupFile[];
};

type NativeFileImportSummary = {
  addedCount: number;
  updatedCount: number;
  skippedCount: number;
  vendorCreatedCount: number;
  locationCreatedCount: number;
  invalidUrlCount: number;
  errors: string[];
  backupFiles?: BackupFile[];
  nativeSummary?: NativeSummary;
};

type PartForm = {
  partNumber: string;
  description: string;
  location: string;
  vendor: string;
  quantity: string;
  minQuantity: string;
  partInfoUrl: string;
};

const blankForm: PartForm = {
  partNumber: '',
  description: '',
  location: '',
  vendor: '',
  quantity: '0',
  minQuantity: '0',
  partInfoUrl: '',
};

const writeRoles = new Set(['Admin','Manager','Maintenance Tech 3','Maintenance Tech 2']);
const importRoles = new Set(['Admin','Manager','Maintenance Tech 3']);
const pageSizeOptions: PageSize[] = [50,100,250,'all'];
const emptyNativeSummary: NativeSummary = {
  totalParts: 0,
  lowStockCount: 0,
  requisitionCount: 0,
  vendorCount: 0,
  locationCount: 0,
  lastImportedFromMit3At: null,
};

async function api<T>(path:string, options:RequestInit={}): Promise<T> {
  const res=await fetch(path,{credentials:'include',headers:{'Content-Type':'application/json',...(options.headers??{})},...options});
  const data=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error || 'Request failed.');
  return data as T;
}

async function apiForm<T>(path:string, formData:FormData): Promise<T> {
  const res=await fetch(path,{method:'POST',credentials:'include',body:formData});
  const data=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error || 'Request failed.');
  return data as T;
}

function fileNameFromDisposition(disposition: string | null, fallback: string) {
  const match = disposition?.match(/filename="?([^";]+)"?/i);
  return match?.[1] ?? fallback;
}

async function downloadFile(path:string, fallbackFileName:string) {
  const res = await fetch(path,{credentials:'include'});
  if (!res.ok) {
    const data = await res.json().catch(()=>({}));
    throw new Error(data.error || 'Download failed.');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileNameFromDisposition(res.headers.get('content-disposition'), fallbackFileName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function isLowStock(part: InventoryPart) {
  return part.status === 'Low Stock' || part.status === 'Out of Stock';
}

function safeHttpUrl(value: string) {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase();
    const localHost = host === 'localhost' || host === '[::1]' || host === '::1' || host === '0.0.0.0' || host.startsWith('127.') || host.endsWith('.local');
    return (url.protocol === 'http:' || url.protocol === 'https:') && !localHost ? url.href : '';
  } catch {
    return '';
  }
}

function validUrl(value: string) {
  return Boolean(safeHttpUrl(value));
}

function formatRefreshTime(value: Date | null) {
  if (!value) return 'Not refreshed yet';
  return new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit',second:'2-digit'}).format(value);
}

function formatDateTime(value?: string | null) {
  if (!value) return 'Never imported';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined,{dateStyle:'short',timeStyle:'short'}).format(date);
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / 1024 / 102.4) / 10} MB`;
}

function normalizeNativeSummary(summary?: Partial<NativeSummary> | null): NativeSummary {
  return {
    totalParts: Number(summary?.totalParts ?? 0),
    lowStockCount: Number(summary?.lowStockCount ?? 0),
    requisitionCount: Number(summary?.requisitionCount ?? 0),
    vendorCount: Number(summary?.vendorCount ?? 0),
    locationCount: Number(summary?.locationCount ?? 0),
    lastImportedFromMit3At: summary?.lastImportedFromMit3At ?? null,
  };
}

function compareText(left: string, right: string) {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
}

function compareParts(left: InventoryPart, right: InventoryPart, sortKey: SortKey, sortDirection: SortDirection) {
  const multiplier = sortDirection === 'asc' ? 1 : -1;
  const result = sortKey === 'quantity' || sortKey === 'minQuantity'
    ? Number(left[sortKey] ?? 0) - Number(right[sortKey] ?? 0)
    : compareText(String(left[sortKey] ?? ''), String(right[sortKey] ?? ''));
  return result * multiplier;
}

function validateForm(form: PartForm) {
  if (!form.partNumber.trim()) return 'Part Number is required.';
  if (!Number.isFinite(Number(form.quantity))) return 'Quantity must be numeric.';
  if (!Number.isFinite(Number(form.minQuantity))) return 'Minimum Quantity must be numeric.';
  if (form.partInfoUrl.trim() && !validUrl(form.partInfoUrl.trim())) return 'Part Info URL must be blank or a valid http/https URL.';
  return '';
}

function formFromPart(part: InventoryPart): PartForm {
  return {
    partNumber: part.partNumber,
    description: part.description,
    location: part.location,
    vendor: part.vendor,
    quantity: String(part.quantity),
    minQuantity: String(part.minQuantity),
    partInfoUrl: part.partInfoUrl,
  };
}

function payloadFromForm(form: PartForm) {
  return {
    partNumber: form.partNumber.trim(),
    description: form.description.trim(),
    location: form.location.trim(),
    vendor: form.vendor.trim(),
    quantity: Number(form.quantity),
    minQuantity: Number(form.minQuantity),
    partInfoUrl: form.partInfoUrl.trim(),
  };
}

export function InventoryPage({ userRole, onBackToDashboard }: { userRole: string; onBackToDashboard: () => void }) {
  const [status,setStatus]=useState<Mit3Status|null>(null);
  const [nativeSummary,setNativeSummary]=useState<NativeSummary>(emptyNativeSummary);
  const [importSummary,setImportSummary]=useState<ImportSummary|null>(null);
  const [parts,setParts]=useState<InventoryPart[]>([]);
  const [search,setSearch]=useState('');
  const [filter,setFilter]=useState<FilterMode>('all');
  const [sortKey,setSortKey]=useState<SortKey>('partNumber');
  const [sortDirection,setSortDirection]=useState<SortDirection>('asc');
  const [pageSize,setPageSize]=useState<PageSize>(100);
  const [page,setPage]=useState(1);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState<Notice|null>(null);
  const [loading,setLoading]=useState(true);
  const [lastRefreshed,setLastRefreshed]=useState<Date|null>(null);
  const [modal,setModal]=useState<ModalMode|null>(null);
  const [editingPart,setEditingPart]=useState<InventoryPart|null>(null);
  const [form,setForm]=useState<PartForm>(blankForm);
  const [formError,setFormError]=useState('');
  const [saving,setSaving]=useState(false);
  const [mutatingId,setMutatingId]=useState('');
  const [importing,setImporting]=useState(false);
  const [toolsBusy,setToolsBusy]=useState('');
  const [inventoryImportFile,setInventoryImportFile]=useState<File|null>(null);
  const [fileImportSummary,setFileImportSummary]=useState<NativeFileImportSummary|null>(null);
  const [backupFiles,setBackupFiles]=useState<BackupFile[]>([]);

  const canWrite = writeRoles.has(userRole);
  const canImport = importRoles.has(userRole);
  const canUseInventoryTools = canWrite;

  async function refresh(options: { notify?: boolean } = {}){
    setLoading(true);
    setError('');
    try {
      const [nextStatus,nextNativeSummary] = await Promise.all([
        api<Mit3Status>('/api/inventory/mit3-status').catch(()=>null),
        api<NativeSummaryResponse>('/api/inventory/native/summary'),
      ]);
      if (nextStatus) setStatus(nextStatus);
      setNativeSummary(normalizeNativeSummary(nextNativeSummary));
      const partsResponse = await api<PartsResponse>('/api/inventory/native/parts');
      if (partsResponse.summary) setNativeSummary(normalizeNativeSummary(partsResponse.summary));
      setParts(partsResponse.parts ?? []);
      const refreshedAt = new Date();
      setLastRefreshed(refreshedAt);
      if (options.notify) setNotice({kind:'success',text:`MCC Native Inventory refreshed at ${formatRefreshTime(refreshedAt)}.`});
    } catch (err) {
      setParts([]);
      const message = (err as Error).message;
      setError(message);
      if (options.notify) setNotice({kind:'error',text:message});
    } finally {
      setLoading(false);
    }
  }

  async function loadBackups(){
    if (!canUseInventoryTools) return;
    try {
      const result = await api<BackupListResponse>('/api/inventory/native/backups');
      setBackupFiles(result.backups ?? []);
    } catch {
      setBackupFiles([]);
    }
  }

  useEffect(()=>{ void refresh(); if (canUseInventoryTools) void loadBackups(); },[canUseInventoryTools]);

  const isOnline = status?.ok === true;
  const showWriteActions = canWrite;
  const writeEnabled = canWrite;
  const writeDisabledReason = canWrite ? '' : 'View-only access.';

  const summary = useMemo(()=>{
    return {
      total: parts.length,
      low: parts.filter(isLowStock).length,
      requisition: parts.filter(part=>Boolean(part.requisition || part.orderPlaced)).length,
      places: `${nativeSummary.locationCount} / ${nativeSummary.vendorCount}`,
    };
  },[nativeSummary.locationCount,nativeSummary.vendorCount,parts]);

  const locationOptions = useMemo(()=>[...new Set(parts.map(part=>part.location.trim()).filter(Boolean))].sort(compareText),[parts]);
  const vendorOptions = useMemo(()=>[...new Set(parts.map(part=>part.vendor.trim()).filter(Boolean))].sort(compareText),[parts]);

  const filteredParts = useMemo(()=>{
    const needle = search.trim().toLowerCase();
    return parts.filter(part=>{
      if(filter==='low'&&!isLowStock(part)) return false;
      if(filter==='requisition'&&!part.requisition&&!part.orderPlaced) return false;
      if(filter==='hasLink'&&!safeHttpUrl(part.partInfoUrl)) return false;
      if(filter==='noLink'&&safeHttpUrl(part.partInfoUrl)) return false;
      if(!needle) return true;
      return [part.partNumber,part.description,part.location,part.vendor]
        .some(value=>value.toLowerCase().includes(needle));
    });
  },[filter,parts,search]);

  const sortedParts = useMemo(()=>[...filteredParts].sort((left,right)=>compareParts(left,right,sortKey,sortDirection)),[filteredParts,sortDirection,sortKey]);
  const totalPages = pageSize === 'all' ? 1 : Math.max(1, Math.ceil(sortedParts.length / pageSize));
  const visibleParts = useMemo(()=>{
    if (pageSize === 'all') return sortedParts;
    const start = (page - 1) * pageSize;
    return sortedParts.slice(start, start + pageSize);
  },[page,pageSize,sortedParts]);
  const pageStart = sortedParts.length === 0 ? 0 : pageSize === 'all' ? 1 : (page - 1) * pageSize + 1;
  const pageEnd = pageSize === 'all' ? sortedParts.length : Math.min(page * pageSize, sortedParts.length);
  const filtersActive = filter !== 'all' || search.trim().length > 0;

  useEffect(()=>{ setPage(1); },[filter,pageSize,search,sortDirection,sortKey]);
  useEffect(()=>{ setPage(current=>Math.min(current,totalPages)); },[totalPages]);

  function toggleSort(nextKey: SortKey){
    if (sortKey === nextKey) {
      setSortDirection(current=>current === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(nextKey);
      setSortDirection('asc');
    }
  }

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return '';
    return sortDirection === 'asc' ? 'asc' : 'desc';
  }

  function sortAria(key: SortKey): 'none' | 'ascending' | 'descending' {
    if (sortKey !== key) return 'none';
    return sortDirection === 'asc' ? 'ascending' : 'descending';
  }

  function renderSortHeader(key: SortKey, label: string) {
    const state = sortIndicator(key);
    return (
      <button className={state ? 'sort-header active' : 'sort-header'} type="button" onClick={()=>toggleSort(key)}>
        <span>{label}</span>
        <span className="sort-marker">{state}</span>
      </button>
    );
  }

  function clearFilters(){
    setSearch('');
    setFilter('all');
  }

  async function importFromMit3(){
    if (!canImport || importing) return;
    if (!window.confirm('This will copy inventory data from MIT3 into MCC. MIT3 will not be modified.')) return;
    setImporting(true);
    setNotice(null);
    setError('');
    try {
      const result = await api<ImportSummary>('/api/inventory/native/import-from-mit3',{method:'POST'});
      setImportSummary(result);
      if (result.nativeSummary) setNativeSummary(normalizeNativeSummary(result.nativeSummary));
      await refresh();
      const skipped = result.skippedCount + Number(result.skippedUrlCount ?? 0);
      setNotice({kind:'success',text:`MIT3 import complete: ${result.importedCount} imported, ${result.updatedCount} updated${skipped ? `, ${skipped} skipped` : ''}.`});
    } catch (err) {
      setNotice({kind:'error',text:(err as Error).message});
    } finally {
      setImporting(false);
    }
  }

  async function runDownload(endpoint: string, fallbackFileName: string, successText: string){
    if (!canUseInventoryTools || toolsBusy) return;
    setToolsBusy(endpoint);
    setNotice(null);
    try {
      await downloadFile(endpoint, fallbackFileName);
      setNotice({kind:'success',text:successText});
    } catch (err) {
      setNotice({kind:'error',text:(err as Error).message});
    } finally {
      setToolsBusy('');
    }
  }

  async function createBackup(){
    if (!canUseInventoryTools || toolsBusy) return;
    setToolsBusy('backup');
    setNotice(null);
    try {
      const result = await api<BackupListResponse>('/api/inventory/native/backups/create',{method:'POST'});
      setBackupFiles(result.backups ?? []);
      await loadBackups();
      setNotice({kind:'success',text:'MCC Native Inventory backup created.'});
    } catch (err) {
      setNotice({kind:'error',text:(err as Error).message});
    } finally {
      setToolsBusy('');
    }
  }

  async function importNativeFile(){
    if (!canUseInventoryTools || toolsBusy || !inventoryImportFile) return;
    if (!window.confirm('MCC will create an automatic backup before importing.')) return;
    setToolsBusy('native-import');
    setNotice(null);
    setFileImportSummary(null);
    try {
      const formData = new FormData();
      formData.append('file', inventoryImportFile);
      const result = await apiForm<NativeFileImportSummary>('/api/inventory/native/import', formData);
      setFileImportSummary(result);
      if (result.nativeSummary) setNativeSummary(normalizeNativeSummary(result.nativeSummary));
      await refresh();
      await loadBackups();
      setInventoryImportFile(null);
      setNotice({kind:'success',text:`Native import complete: ${result.addedCount} added, ${result.updatedCount} updated, ${result.skippedCount} skipped.`});
    } catch (err) {
      setNotice({kind:'error',text:(err as Error).message});
    } finally {
      setToolsBusy('');
    }
  }

  function openAdd(){
    if (!writeEnabled) return;
    setModal('add');
    setEditingPart(null);
    setForm(blankForm);
    setFormError('');
    setNotice(null);
  }

  function openEdit(part: InventoryPart){
    if (!writeEnabled) return;
    setModal('edit');
    setEditingPart(part);
    setForm(formFromPart(part));
    setFormError('');
    setNotice(null);
  }

  function closeModal(force = false){
    if (saving && !force) return;
    setModal(null);
    setEditingPart(null);
    setForm(blankForm);
    setFormError('');
  }

  async function submitForm(event: FormEvent){
    event.preventDefault();
    const validation = validateForm(form);
    setFormError(validation);
    if (validation || !modal) return;
    const partNumber = form.partNumber.trim().toLowerCase();
    const duplicate = parts.find(part=>part.partNumber.trim().toLowerCase() === partNumber && part.id !== editingPart?.id);
    if (duplicate) {
      setFormError('Part Number already exists in MCC native inventory. Choose a unique Part Number before saving.');
      return;
    }
    setSaving(true);
    setNotice(null);
    const payload = JSON.stringify(payloadFromForm(form));
    const isEdit = modal === 'edit' && editingPart;
    try {
      await api(isEdit ? `/api/inventory/native/parts/${encodeURIComponent(editingPart.id)}` : '/api/inventory/native/parts', {
        method: isEdit ? 'PATCH' : 'POST',
        body: payload,
      });
      closeModal(true);
      setNotice({kind:'success',text:isEdit ? 'Inventory part updated in MCC Native Inventory.' : 'Inventory part added to MCC Native Inventory.'});
      await refresh();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function updateRequisition(part: InventoryPart, requisition: boolean){
    if (!writeEnabled) return;
    const action = requisition ? 'mark this part for requisition' : 'clear the requisition marker for this part';
    if (!window.confirm(`Confirm that you want to ${action} in MCC Native Inventory.`)) return;
    setMutatingId(part.id);
    setNotice(null);
    try {
      await api(`/api/inventory/native/parts/${encodeURIComponent(part.id)}/requisition`, {
        method: 'PATCH',
        body: JSON.stringify({requisition}),
      });
      setNotice({kind:'success',text:'Requisition status updated in MCC Native Inventory.'});
      await refresh();
    } catch (err) {
      setNotice({kind:'error',text:(err as Error).message});
    } finally {
      setMutatingId('');
    }
  }

  return (
    <div className="page-stack inventory-page">
      <div className="inventory-focus-toolbar">
        <button className="secondary-button compact-button inventory-back-button" type="button" onClick={onBackToDashboard}>Back to Command Center</button>
        <div className="inventory-focus-title">
          <p className="eyebrow">Inventory workspace</p>
          <h2>Inventory</h2>
          <div className="inventory-focus-meta">
            <span>Source: MCC Native Inventory</span>
            <span>Last refreshed: {formatRefreshTime(lastRefreshed)}</span>
            <span>Showing {visibleParts.length} of {sortedParts.length} parts{filtersActive ? ` (${parts.length} loaded)` : ''}</span>
          </div>
        </div>
        <div className="inventory-toolbar-badges">
          <span className="native-status-badge active">MCC Native Inventory</span>
          <span className={isOnline?'mit3-status-badge online':'mit3-status-badge offline'} aria-live="polite">{isOnline?'MIT3 Reference Online':'MIT3 Reference Offline'}</span>
          {canWrite&&<span className="view-only-badge">Native writes active</span>}
          {!canWrite&&<span className="view-only-badge">View-only access.</span>}
        </div>
        <div className="inventory-focus-actions">
          {showWriteActions&&<button className="primary-button" type="button" onClick={openAdd} disabled={!writeEnabled}>Add Part</button>}
          {canImport&&<button className="primary-button import-button" type="button" onClick={()=>void importFromMit3()} disabled={importing}>{importing?'Importing...':'Import from MIT3'}</button>}
          <button className="secondary-button" type="button" onClick={()=>void refresh({notify:true})} disabled={loading}>Refresh Inventory</button>
          <a className="secondary-button action-link" href={status?.mit3Url ?? 'http://localhost:4173'} target="_blank" rel="noreferrer">Open MIT3 Inventory</a>
        </div>
      </div>

      <div className="inventory-active-banner">MCC Native Inventory is active. MIT3 is kept as backup/reference.</div>

      <div className="inventory-bridge-strip inventory-migration-strip">
        <div>
          <span>MIT3 reference status</span>
          <strong>{status?.message ?? (loading ? 'Checking MIT3...' : 'MIT3 offline or not reachable')}</strong>
        </div>
        <div>
          <span>Native inventory count</span>
          <strong>{nativeSummary.totalParts} parts</strong>
        </div>
        <div>
          <span>Last MIT3 import</span>
          <strong>{formatDateTime(nativeSummary.lastImportedFromMit3At)}</strong>
        </div>
        <div>
          <span>Daily source</span>
          <strong>MCC Native Inventory</strong>
        </div>
        <div className="inventory-bridge-messages">
          {error&&<p className="form-message error">{error}</p>}
          {!isOnline&&<p className="form-message">MIT3 is offline or not reachable. MCC Native Inventory still works after import.</p>}
          {writeDisabledReason&&<p className="form-message error">{writeDisabledReason}</p>}
        </div>
      </div>

      {nativeSummary.totalParts===0&&!loading&&(
        <section className="mcc-card inventory-setup-card">
          <div>
            <span>Phase 2E setup</span>
            <strong>MCC Native Inventory is empty. Import from MIT3 to begin daily native use.</strong>
            <p>This copies inventory through the MIT3 HTTP API. MIT3 data is not modified.</p>
          </div>
          <div className="inventory-setup-actions">
            <button className="primary-button" type="button" onClick={()=>void importFromMit3()} disabled={!canImport||importing}>{importing?'Importing...':'Import from MIT3'}</button>
            <a className="secondary-button action-link" href={status?.mit3Url ?? 'http://localhost:4173'} target="_blank" rel="noreferrer">Open MIT3 Inventory</a>
          </div>
          {!canImport&&<p className="form-message">Admin, Manager, or Maintenance Tech 3 permission is required to run the migration import.</p>}
        </section>
      )}

      {importSummary&&(
        <section className="mcc-card inventory-import-summary" aria-live="polite">
          <div>
            <span>Last import summary</span>
            <strong>{importSummary.importedCount} imported / {importSummary.updatedCount} updated</strong>
            <p>{importSummary.skippedCount} rows skipped. {Number(importSummary.skippedUrlCount ?? 0)} unsafe links skipped. {importSummary.vendorCount} vendors and {importSummary.locationCount} locations in MCC.</p>
          </div>
          {importSummary.errors.length>0&&(
            <ul>
              {importSummary.errors.slice(0,4).map((message,index)=><li key={`${message}-${index}`}>{message}</li>)}
            </ul>
          )}
        </section>
      )}

      {canUseInventoryTools&&(
        <section className="mcc-card inventory-tools-card">
          <div className="inventory-tools-heading">
            <div>
              <span>Inventory Tools</span>
              <strong>Native import / export / backup</strong>
            </div>
            <button className="secondary-button compact-button" type="button" onClick={()=>void loadBackups()} disabled={Boolean(toolsBusy)}>Refresh Backups</button>
          </div>
          <div className="inventory-tools-grid">
            <div className="inventory-tools-panel">
              <span>Exports</span>
              <div className="inventory-tool-actions">
                <button className="secondary-button compact-button" type="button" onClick={()=>void runDownload('/api/inventory/native/export/csv',`MCC_Inventory_Export_${new Date().toISOString().slice(0,10)}.csv`,'CSV export downloaded.')} disabled={Boolean(toolsBusy)}>Export CSV</button>
                <button className="secondary-button compact-button" type="button" onClick={()=>void runDownload('/api/inventory/native/export/excel-update-template',`MCC_Inventory_Update_Template_${new Date().toISOString().slice(0,10)}.xlsx`,'Excel update template downloaded.')} disabled={Boolean(toolsBusy)}>Export Excel Update Template</button>
                <button className="secondary-button compact-button" type="button" onClick={()=>void runDownload('/api/inventory/native/export/blank-import-template','MCC_Inventory_Blank_Import_Template.xlsx','Blank import template downloaded.')} disabled={Boolean(toolsBusy)}>Export Blank Import Template</button>
              </div>
            </div>
            <div className="inventory-tools-panel">
              <span>Import CSV / Excel</span>
              <div className="inventory-import-row">
                <input type="file" accept=".csv,.xlsx" onChange={event=>setInventoryImportFile(event.target.files?.[0] ?? null)} />
                <button className="primary-button compact-button" type="button" onClick={()=>void importNativeFile()} disabled={Boolean(toolsBusy)||!inventoryImportFile}>Import File</button>
              </div>
              <p className="form-message">MCC will create an automatic backup before importing.</p>
            </div>
            <div className="inventory-tools-panel">
              <span>Backups</span>
              <div className="inventory-tool-actions">
                <button className="secondary-button compact-button" type="button" onClick={()=>void createBackup()} disabled={Boolean(toolsBusy)}>Create Backup</button>
              </div>
              <div className="backup-list">
                {backupFiles.length>0
                  ? backupFiles.slice(0,6).map(file=>(
                    <div className="backup-row" key={`${file.fileName}-${file.size}`}>
                      <strong>{file.fileName}</strong>
                      <span>{file.type} / {formatFileSize(file.size)} / {formatDateTime(file.createdTime)}</span>
                    </div>
                  ))
                  : <p className="form-message">No backups listed yet.</p>}
              </div>
            </div>
          </div>
          {fileImportSummary&&(
            <div className="inventory-tool-summary" aria-live="polite">
              <strong>{fileImportSummary.addedCount} added / {fileImportSummary.updatedCount} updated / {fileImportSummary.skippedCount} skipped</strong>
              <span>{fileImportSummary.vendorCreatedCount} vendors created, {fileImportSummary.locationCreatedCount} locations created, {fileImportSummary.invalidUrlCount} unsafe links skipped.</span>
              {fileImportSummary.errors.length>0&&(
                <ul>
                  {fileImportSummary.errors.slice(0,5).map((message,index)=><li key={`${message}-${index}`}>{message}</li>)}
                </ul>
              )}
            </div>
          )}
        </section>
      )}

      <div className="card-grid inventory-summary-grid">
        <article className="mcc-card"><span>Total Parts</span><strong>{summary.total}</strong><p>Loaded from MCC Native Inventory.</p></article>
        <article className="mcc-card"><span>Low Stock / Watch Items</span><strong>{summary.low}</strong><p>Low or out of stock.</p></article>
        <article className="mcc-card"><span>Requisition Items</span><strong>{summary.requisition}</strong><p>Active or marked requisition.</p></article>
        <article className="mcc-card"><span>Locations / Vendors</span><strong>{summary.places}</strong><p>Unique names available.</p></article>
      </div>

      {notice&&<p className={notice.kind==='error'?'form-message inventory-toast error':'form-message inventory-toast'} role="status">{notice.text}</p>}

      <section className="mcc-card inventory-table-card">
        <div className="inventory-toolbar">
          <label className="form-field inventory-search">
            <span>Search inventory</span>
            <input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Part number, description, location, vendor..." />
          </label>
          <div className="inventory-toolbar-actions">
            <div className="segmented-control" aria-label="Inventory filters">
              <button className={filter==='all'?'active':''} onClick={()=>setFilter('all')} type="button">All</button>
              <button className={filter==='low'?'active':''} onClick={()=>setFilter('low')} type="button">Low Stock</button>
              <button className={filter==='requisition'?'active':''} onClick={()=>setFilter('requisition')} type="button">Requisition</button>
              <button className={filter==='hasLink'?'active':''} onClick={()=>setFilter('hasLink')} type="button">Has Link</button>
              <button className={filter==='noLink'?'active':''} onClick={()=>setFilter('noLink')} type="button">No Link</button>
            </div>
            <button className="secondary-button compact-button" type="button" onClick={clearFilters} disabled={!filtersActive}>Clear Filters</button>
          </div>
        </div>

        <div className="inventory-table-meta">
          <div>
            <strong>Showing {visibleParts.length} of {sortedParts.length} parts</strong>
            <span>{sortedParts.length ? `Rows ${pageStart}-${pageEnd}` : 'No rows'}{filtersActive ? `; ${parts.length} loaded from MCC Native Inventory` : ''}</span>
          </div>
          <div className="inventory-pager">
            <label className="page-size-field">
              <span>Rows</span>
              <select value={String(pageSize)} onChange={event=>setPageSize(event.target.value==='all'?'all':Number(event.target.value) as PageSize)}>
                {pageSizeOptions.map(option=><option key={String(option)} value={String(option)}>{option === 'all' ? 'All' : option}</option>)}
              </select>
            </label>
            <button className="secondary-button compact-button" type="button" onClick={()=>setPage(current=>Math.max(1,current-1))} disabled={page<=1||pageSize==='all'}>Prev</button>
            <span className="page-count">Page {page} of {totalPages}</span>
            <button className="secondary-button compact-button" type="button" onClick={()=>setPage(current=>Math.min(totalPages,current+1))} disabled={page>=totalPages||pageSize==='all'}>Next</button>
          </div>
        </div>

        <div className="table-card inventory-table-wrap">
          <table>
            <thead>
              <tr>
                <th aria-sort={sortAria('partNumber')}>{renderSortHeader('partNumber','Part Number')}</th>
                <th aria-sort={sortAria('description')}>{renderSortHeader('description','Description')}</th>
                <th aria-sort={sortAria('location')}>{renderSortHeader('location','Location')}</th>
                <th aria-sort={sortAria('vendor')}>{renderSortHeader('vendor','Vendor')}</th>
                <th aria-sort={sortAria('quantity')}>{renderSortHeader('quantity','Qty')}</th>
                <th aria-sort={sortAria('minQuantity')}>{renderSortHeader('minQuantity','Min')}</th>
                <th aria-sort={sortAria('status')}>{renderSortHeader('status','Status')}</th>
                <th>Link</th>
                {showWriteActions&&<th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {visibleParts.map(part=>{
                const partLink = safeHttpUrl(part.partInfoUrl);
                return (
                  <tr key={part.id}>
                    <td>
                      {partLink
                        ? <a className="part-number-link" href={partLink} target="_blank" rel="noreferrer">{part.partNumber || part.itemId || 'Open'}<span aria-hidden="true">-&gt;</span></a>
                      : <span className="plain-part-number">{part.partNumber || part.itemId || '-'}</span>}
                    </td>
                    <td className="inventory-description-cell"><span className="inventory-description-text" title={part.description || undefined}>{part.description || '-'}</span></td>
                    <td>{part.location || '-'}</td>
                    <td>{part.vendor || '-'}</td>
                    <td>{part.quantity}</td>
                    <td>{part.minQuantity}</td>
                    <td><div className="inventory-status-stack"><span className={isLowStock(part)?'status-pill disabled':'status-pill'}>{part.status}</span>{part.requisition&&<span className="requisition-chip">{part.requisition}</span>}</div></td>
                    <td>{partLink?<a className="link-badge" href={partLink} target="_blank" rel="noreferrer">Open</a>:<span className="muted-cell">None</span>}</td>
                    {showWriteActions&&(
                      <td>
                        <div className="inventory-row-actions">
                          <button className="secondary-button compact-button" type="button" onClick={()=>openEdit(part)} disabled={!writeEnabled}>Edit</button>
                          <label className="requisition-toggle">
                            <input
                              type="checkbox"
                              checked={Boolean(part.orderPlaced || part.requisition)}
                              disabled={!writeEnabled || mutatingId===part.id}
                              onChange={event=>void updateRequisition(part,event.target.checked)}
                            />
                            <span>Req</span>
                          </label>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
              {!loading&&sortedParts.length===0&&<tr><td colSpan={showWriteActions?9:8} className="empty-table-cell">No inventory rows match this view.</td></tr>}
              {loading&&<tr><td colSpan={showWriteActions?9:8} className="empty-table-cell">Loading MCC Native Inventory...</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {modal&&(
        <div className="modal-backdrop" role="presentation" onMouseDown={event=>{ if(event.target===event.currentTarget) closeModal(); }}>
          <form className="mcc-card inventory-modal" onSubmit={submitForm}>
            <div className="modal-heading">
              <div>
                <p className="eyebrow">{modal==='edit'?'Edit Part':'Add Part'}</p>
                <h3>{modal==='edit'?'Edit inventory part':'Add inventory part'}</h3>
              </div>
              <button className="link-button compact-button" type="button" onClick={()=>closeModal()}>Close</button>
            </div>

            <div className="inventory-form-grid">
              <label className="form-field">
                <span>Part Number</span>
                <input value={form.partNumber} onChange={event=>setForm({...form,partNumber:event.target.value})} />
              </label>
              <label className="form-field">
                <span>Description</span>
                <input value={form.description} onChange={event=>setForm({...form,description:event.target.value})} />
              </label>
              <label className="form-field">
                <span>Location</span>
                <input list="native-location-options" value={form.location} onChange={event=>setForm({...form,location:event.target.value})} />
              </label>
              <label className="form-field">
                <span>Vendor</span>
                <input list="native-vendor-options" value={form.vendor} onChange={event=>setForm({...form,vendor:event.target.value})} />
              </label>
              <label className="form-field">
                <span>Quantity</span>
                <input inputMode="decimal" value={form.quantity} onChange={event=>setForm({...form,quantity:event.target.value})} />
              </label>
              <label className="form-field">
                <span>Minimum Quantity</span>
                <input inputMode="decimal" value={form.minQuantity} onChange={event=>setForm({...form,minQuantity:event.target.value})} />
              </label>
              <label className="form-field inventory-form-wide">
                <span>Part Info URL</span>
                <input value={form.partInfoUrl} onChange={event=>setForm({...form,partInfoUrl:event.target.value})} placeholder="https://..." />
              </label>
            </div>

            <datalist id="native-location-options">
              {locationOptions.map(name=><option key={name} value={name} />)}
            </datalist>
            <datalist id="native-vendor-options">
              {vendorOptions.map(name=><option key={name} value={name} />)}
            </datalist>

            {formError&&<p className="form-message error">{formError}</p>}
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={()=>closeModal()}>Cancel</button>
              <button className="primary-button" type="submit" disabled={saving}>{saving?'Saving...':modal==='edit'?'Save Changes':'Add Part'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
