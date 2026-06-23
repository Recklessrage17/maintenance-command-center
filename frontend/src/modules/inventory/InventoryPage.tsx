import { type FormEvent, type UIEvent, useEffect, useMemo, useRef, useState } from 'react';

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
  activeRequisitionNumber?: string;
  partInfoUrl: string;
  manufacturerBrand: string;
  unitCost: number | null;
  supplierPartNumber: string;
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
type SortKey = 'partNumber' | 'description' | 'location' | 'vendor' | 'quantity' | 'unitCost' | 'status';
type SortDirection = 'asc' | 'desc';
type PageSize = 50 | 100 | 250 | 'all';
type RequisitionReviewItem = { part: InventoryPart; quantityRequested: string; dueDate: string; notes: string };
type RequisitionType = 'under-100' | 'over-100';
type VendorRequisitionForm = {
  requisitionType: RequisitionType; poNo: string; poInitiator: string; shipVia: string; poClass: string; requestDate: string; vendorName: string; vendorAddress: string; confirmedWith: string; assetNo: string; moldNo: string; equipmentNo: string; partNo: string; jobNo: string; initials: string; tsNo: string; codeNo: string; workOrderNo: string; comments: string; departmentManager: string; requisitionedBy: string; authorizedBy: string; taxExempt: 'No' | 'Yes'; materialCert: 'No' | 'Yes'; fob: 'Origin' | 'Destination'; priority: string;
};
type VendorRequisitionGroup = { key: string; vendorName: string; items: InventoryPart[]; requiresReview: boolean };

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

type CreatedRequisition = {
  id: number;
  requisitionNumber: string;
  vendorName: string;
  lineCount: number;
  pdfUrl: string;
};

type NativeRequisitionResponse = {
  ok: boolean;
  requisition?: CreatedRequisition;
  requisitions?: CreatedRequisition[];
};

type RequisitionLineForm = {
  part: InventoryPart;
  quantityRequested: string;
  notes: string;
};

type YesNoChoice = 'No' | 'Yes';
type RequiredYesNoChoice = '' | YesNoChoice;
type FobChoice = 'Origin' | 'Destination';

type RequisitionHeaderForm = {
  poInitiator: string;
  requisitionedByName: string;
  taxExempt: RequiredYesNoChoice;
  workOrderNumber: string;
  confirmedWith: string;
  materialCert: YesNoChoice;
  shipVia: string;
  fob: FobChoice;
  notes: string;
};

type PartForm = {
  partNumber: string;
  description: string;
  location: string;
  vendor: string;
  quantity: string;
  minQuantity: string;
  partInfoUrl: string;
  manufacturerBrand: string;
  unitCost: string;
  supplierPartNumber: string;
};

const blankForm: PartForm = {
  partNumber: '',
  description: '',
  location: '',
  vendor: '',
  quantity: '0',
  minQuantity: '0',
  partInfoUrl: '',
  manufacturerBrand: '',
  unitCost: '',
  supplierPartNumber: '',
};

function blankRequisitionForm(userFullName = ''): RequisitionHeaderForm {
  return {
    poInitiator: '',
    requisitionedByName: userFullName,
    taxExempt: '',
    workOrderNumber: '',
    confirmedWith: '',
    materialCert: 'No',
    shipVia: '',
    fob: 'Destination',
    notes: '',
  };
}

function todayInputDate() { return new Date().toISOString().slice(0,10); }

function blankVendorRequisitionForm(vendorName = '', estimatedTotal = 0): VendorRequisitionForm {
  return {
    requisitionType: estimatedTotal < 100 ? 'under-100' : 'over-100', poNo: '', poInitiator: '', shipVia: '', poClass: '', requestDate: todayInputDate(), vendorName, vendorAddress: '', confirmedWith: '', assetNo: '', moldNo: '', equipmentNo: '', partNo: '', jobNo: '', initials: '', tsNo: '', codeNo: '', workOrderNo: '', comments: '', departmentManager: '', requisitionedBy: '', authorizedBy: '', taxExempt: 'No', materialCert: 'No', fob: 'Destination', priority: '',
  };
}

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

async function pdfObjectUrl(path:string) {
  const res = await fetch(path,{credentials:'include'});
  if (!res.ok) {
    const data = await res.json().catch(()=>({}));
    throw new Error(data.error || 'PDF preview failed.');
  }
  return URL.createObjectURL(await res.blob());
}

function previewPdfPath(requisition: CreatedRequisition) {
  const separator = requisition.pdfUrl.includes('?') ? '&' : '?';
  return `${requisition.pdfUrl}${separator}preview=true`;
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

const currencyFormatter = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' });

function formatCurrency(value: number | null | undefined) {
  const parsed = Number(value ?? 0);
  return currencyFormatter.format(Number.isFinite(parsed) && parsed >= 0 ? parsed : 0);
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
  const result = sortKey === 'quantity' || sortKey === 'unitCost'
    ? Number(left[sortKey] ?? 0) - Number(right[sortKey] ?? 0)
    : compareText(String(left[sortKey] ?? ''), String(right[sortKey] ?? ''));
  return result * multiplier;
}

function validateForm(form: PartForm) {
  if (!form.partNumber.trim()) return 'Part Number is required.';
  if (!form.description.trim()) return 'Description is required.';
  if (!form.vendor.trim()) return 'Vendor is required.';
  if (!form.unitCost.trim()) return 'Unit Cost is required.';
  if (!Number.isFinite(Number(form.unitCost))) return 'Unit Cost must be numeric.';
  if (Number(form.unitCost) < 0) return 'Unit Cost cannot be negative.';
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
    manufacturerBrand: part.manufacturerBrand ?? '',
    unitCost: part.unitCost === null || part.unitCost === undefined ? '' : String(part.unitCost),
    supplierPartNumber: part.supplierPartNumber ?? '',
  };
}

function normalizeVendorKey(vendor: string) {
  const clean = vendor.trim();
  if (!clean) return 'unknown-vendor';
  const compact = clean.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (compact === 'mcmaster' || compact === 'mcmastercarr') return 'mcmaster-carr';
  if (compact === 'wwgrainger' || compact === 'grainger') return 'grainger';
  return clean.toLowerCase().replace(/\s+/g, ' ');
}

function displayVendorName(vendor: string) {
  const key = normalizeVendorKey(vendor);
  if (key === 'unknown-vendor') return 'Unknown Vendor';
  if (key === 'mcmaster-carr') return 'McMaster-Carr';
  if (key === 'grainger') return 'Grainger';
  return vendor.trim();
}

function groupPartsByVendor(selectedParts: InventoryPart[]): VendorRequisitionGroup[] {
  const groups = new Map<string, VendorRequisitionGroup>();
  for (const part of selectedParts) {
    const key = normalizeVendorKey(part.vendor);
    const existing = groups.get(key);
    if (existing) existing.items.push(part);
    else groups.set(key, { key, vendorName: displayVendorName(part.vendor), items: [part], requiresReview: key === 'unknown-vendor' });
  }
  return [...groups.values()].sort((left,right)=>compareText(left.vendorName,right.vendorName));
}

async function downloadRequisitionPdf(payload: unknown, fallbackFileName: string) {
  const res = await fetch('/api/requisitions/vendor-pdf',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  if (!res.ok) {
    const data = await res.json().catch(()=>({}));
    throw new Error(data.error || 'PDF creation failed.');
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

function payloadFromForm(form: PartForm) {
  return {
    partNumber: form.partNumber.trim(),
    description: form.description.trim(),
    location: form.location.trim(),
    vendor: form.vendor.trim(),
    quantity: Number(form.quantity),
    minQuantity: Number(form.minQuantity),
    partInfoUrl: form.partInfoUrl.trim(),
    manufacturerBrand: form.manufacturerBrand.trim(),
    unitCost: form.unitCost.trim() ? Number(form.unitCost) : 0,
    supplierPartNumber: form.supplierPartNumber.trim(),
  };
}

export function InventoryPage({ userRole, userFullName, onBackToDashboard, onOpenRequisitions }: { userRole: string; userFullName: string; onBackToDashboard: () => void; onOpenRequisitions: () => void }) {
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
  const [importing,setImporting]=useState(false);
  const [toolsBusy,setToolsBusy]=useState('');
  const [toolsOpen,setToolsOpen]=useState(false);
  const [inventoryImportFile,setInventoryImportFile]=useState<File|null>(null);
  const [fileImportSummary,setFileImportSummary]=useState<NativeFileImportSummary|null>(null);
  const [backupFiles,setBackupFiles]=useState<BackupFile[]>([]);
  const [requisitionLines,setRequisitionLines]=useState<RequisitionLineForm[]>([]);
  const [requisitionForm,setRequisitionForm]=useState<RequisitionHeaderForm>(()=>blankRequisitionForm(userFullName));
  const [selectedPartIds,setSelectedPartIds]=useState<Set<string>>(()=>new Set());
  const [previewRequisitions,setPreviewRequisitions]=useState<CreatedRequisition[]>([]);
  const [activePreviewId,setActivePreviewId]=useState<number|null>(null);
  const [previewUrl,setPreviewUrl]=useState('');
  const [previewLoading,setPreviewLoading]=useState(false);
  const [previewError,setPreviewError]=useState('');
  const [reviewGroups,setReviewGroups]=useState<VendorRequisitionGroup[]>([]);
  const [reviewIndex,setReviewIndex]=useState(0);
  const [reviewItems,setReviewItems]=useState<RequisitionReviewItem[]>([]);
  const [reviewForm,setReviewForm]=useState<VendorRequisitionForm>(blankVendorRequisitionForm());
  const [requisitionError,setRequisitionError]=useState('');
  const [requisitionSaving,setRequisitionSaving]=useState(false);
  const [passSaving,setPassSaving]=useState(false);
  const tableScrollRef = useRef<HTMLDivElement|null>(null);
  const lastAutoPageAtRef = useRef(0);
  const pendingScrollTargetRef = useRef<'top'|'bottom'|null>(null);

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
      if (options.notify) setNotice({kind:'success',text:`MCC Inventory refreshed at ${formatRefreshTime(refreshedAt)}.`});
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

  const showWriteActions = canWrite;
  const writeEnabled = canWrite;

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
  const filtersActive = filter !== 'all' || search.trim().length > 0;
  const selectedParts = useMemo(()=>parts.filter(part=>selectedPartIds.has(part.id)),[parts,selectedPartIds]);
  const visibleSelectableIds = useMemo(()=>visibleParts.map(part=>part.id),[visibleParts]);
  const allVisibleSelected = visibleSelectableIds.length > 0 && visibleSelectableIds.every(id=>selectedPartIds.has(id));
  const activePreviewRequisition = useMemo(()=>previewRequisitions.find(requisition=>requisition.id===activePreviewId) ?? previewRequisitions[0] ?? null,[activePreviewId,previewRequisitions]);

  useEffect(()=>{
    pendingScrollTargetRef.current = null;
    tableScrollRef.current?.scrollTo({top:0});
    setPage(1);
  },[filter,pageSize,search,sortDirection,sortKey]);
  useEffect(()=>{ setPage(current=>Math.min(current,totalPages)); },[totalPages]);
  useEffect(()=>{
    const container = tableScrollRef.current;
    const target = pendingScrollTargetRef.current;
    if (!container || !target) return;
    pendingScrollTargetRef.current = null;
    window.requestAnimationFrame(()=>{
      if (target === 'bottom') {
        container.scrollTop = Math.max(0, container.scrollHeight - container.clientHeight - 36);
      } else {
        container.scrollTop = 0;
      }
    });
  },[page,visibleParts.length]);
  useEffect(()=>{
    if (!activePreviewRequisition) {
      setPreviewUrl('');
      setPreviewError('');
      setPreviewLoading(false);
      return;
    }
    let disposed = false;
    let objectUrl = '';
    setPreviewUrl('');
    setPreviewError('');
    setPreviewLoading(true);
    pdfObjectUrl(previewPdfPath(activePreviewRequisition))
      .then(url=>{
        if (disposed) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setPreviewUrl(url);
      })
      .catch(error=>{
        if (!disposed) setPreviewError((error as Error).message);
      })
      .finally(()=>{
        if (!disposed) setPreviewLoading(false);
      });
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  },[activePreviewRequisition]);

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

  function togglePartSelection(partId: string) {
    setSelectedPartIds(current=>{ const next = new Set(current); next.has(partId) ? next.delete(partId) : next.add(partId); return next; });
  }

  function toggleVisibleSelection() {
    setSelectedPartIds(current=>{ const next = new Set(current); const shouldSelect = !visibleSelectableIds.every(id=>next.has(id)); visibleSelectableIds.forEach(id=>shouldSelect ? next.add(id) : next.delete(id)); return next; });
  }

  function moveInventoryPage(direction: 'next'|'previous', scrollTarget: 'top'|'bottom') {
    if (pageSize === 'all') return;
    pendingScrollTargetRef.current = scrollTarget;
    setPage(current=>direction === 'next' ? Math.min(totalPages,current + 1) : Math.max(1,current - 1));
  }

  function handleInventoryTableScroll(event: UIEvent<HTMLDivElement>) {
    if (pageSize === 'all' || totalPages <= 1) return;
    const container = event.currentTarget;
    if (container.scrollHeight <= container.clientHeight + 8) return;
    const now = Date.now();
    if (now - lastAutoPageAtRef.current < 850) return;

    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceFromBottom <= 96 && page < totalPages) {
      lastAutoPageAtRef.current = now;
      moveInventoryPage('next','top');
      return;
    }
    if (container.scrollTop <= 32 && page > 1) {
      lastAutoPageAtRef.current = now;
      moveInventoryPage('previous','bottom');
    }
  }

  function clearSelection() {
    setSelectedPartIds(new Set());
    setReviewGroups([]);
    setReviewIndex(0);
    setReviewItems([]);
    setReviewForm(blankVendorRequisitionForm());
  }

  function startSelectedRequisition() {
    if (!selectedParts.length) return;
    openRequisition(selectedParts);
  }

  function closeReview() {
    if (requisitionSaving) return;
    setReviewGroups([]);
    setReviewIndex(0);
    setReviewItems([]);
    setReviewForm(blankVendorRequisitionForm());
  }

  async function passVendorRequisition() {
    const group = reviewGroups[reviewIndex];
    if (!group) return;
    for (const item of reviewItems) {
      const qty = Number(item.quantityRequested);
      if (!Number.isFinite(qty) || qty <= 0) { setRequisitionError('Qty requested must be a positive number for every item.'); return; }
    }
    if (group.requiresReview && !window.confirm('This group has Unknown Vendor. Continue only if you reviewed the parts.')) return;
    setRequisitionSaving(true);
    setRequisitionError('');
    try {
      await downloadRequisitionPdf({header: reviewForm, requisitionType: reviewForm.requisitionType, vendorName: reviewForm.vendorName || group.vendorName, notes: reviewForm.comments.trim(), items: reviewItems.map(item=>({inventoryPartId:Number(item.part.id), quantityRequested:Number(item.quantityRequested), dueDate:item.dueDate, notes:item.notes, unitCost:item.part.unitCost, supplierPartNumber:item.part.supplierPartNumber}))}, `MCC_Requisition_${group.vendorName}.pdf`);
      const nextIndex = reviewIndex + 1;
      if (nextIndex < reviewGroups.length) {
        const nextGroup = reviewGroups[nextIndex];
        setReviewIndex(nextIndex);
        const nextItems = nextGroup.items.map(part=>({part,quantityRequested:String(part.minQuantity > 0 ? part.minQuantity : 1),dueDate:'',notes:''}));
        const nextTotal = nextItems.reduce((sum,item)=>sum + Number(item.quantityRequested) * Number(item.part.unitCost ?? 0), 0);
        setReviewItems(nextItems);
        setReviewForm(blankVendorRequisitionForm(nextGroup.vendorName, nextTotal));
        setNotice({kind:'success',text:`${group.vendorName} PDF created. Review ${nextGroup.vendorName} next.`});
      } else {
        clearSelection();
        setNotice({kind:'success',text:'All selected vendor requisition PDFs were created.'});
        await refresh();
      }
    } catch (err) {
      setRequisitionError((err as Error).message);
    } finally {
      setRequisitionSaving(false);
    }
  }

  async function importFromMit3(){
    if (!canImport || importing) return;
    if (!window.confirm('This will copy legacy inventory data into MCC. The legacy system will not be modified.')) return;
    setImporting(true);
    setNotice(null);
    setError('');
    try {
      const result = await api<ImportSummary>('/api/inventory/native/import-from-mit3',{method:'POST'});
      setImportSummary(result);
      if (result.nativeSummary) setNativeSummary(normalizeNativeSummary(result.nativeSummary));
      await refresh();
      const skipped = result.skippedCount + Number(result.skippedUrlCount ?? 0);
      setNotice({kind:'success',text:`Legacy import complete: ${result.importedCount} imported, ${result.updatedCount} updated${skipped ? `, ${skipped} skipped` : ''}.`});
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
      setNotice({kind:'success',text:'MCC Inventory backup created.'});
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
      setFormError('Part Number already exists in MCC Inventory. Choose a unique Part Number before saving.');
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
      setNotice({kind:'success',text:isEdit ? 'Inventory part updated in MCC Inventory.' : 'Inventory part added to MCC Inventory.'});
      await refresh();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function openRequisition(partOrParts: InventoryPart | InventoryPart[]){
    if (!writeEnabled) return;
    const nextParts = Array.isArray(partOrParts) ? partOrParts : [partOrParts];
    const uniqueParts = [...new Map(nextParts.map(part=>[part.id,part])).values()];
    if (!uniqueParts.length) return;
    setRequisitionLines(uniqueParts.map(part=>({part,quantityRequested:'1',notes:''})));
    setRequisitionForm(blankRequisitionForm(userFullName));
    setRequisitionError('');
    setNotice(null);
  }

  function closeRequisition(force = false){
    if (requisitionSaving && !force) return;
    setRequisitionLines([]);
    setRequisitionForm(blankRequisitionForm(userFullName));
    setRequisitionError('');
  }

  function updateRequisitionLine(partId: string, changes: Partial<Omit<RequisitionLineForm,'part'>>){
    setRequisitionLines(current=>current.map(line=>line.part.id===partId ? {...line,...changes} : line));
  }

  function openPreview(requisitions: CreatedRequisition[]) {
    setPreviewRequisitions(requisitions);
    setActivePreviewId(requisitions[0]?.id ?? null);
    setPreviewError('');
  }

  function closePreview(force = false) {
    if (passSaving && !force) return;
    setPreviewRequisitions([]);
    setActivePreviewId(null);
    setPreviewError('');
  }

  async function downloadPreviewPdf(requisition = activePreviewRequisition) {
    if (!requisition) return;
    try {
      await downloadFile(requisition.pdfUrl, `MCC_Requisition_${requisition.requisitionNumber}.pdf`);
      setNotice({kind:'success',text:`${requisition.requisitionNumber} PDF downloaded.`});
    } catch (err) {
      setPreviewError((err as Error).message);
    }
  }

  function printPreviewPdf() {
    const frame = document.getElementById('inventory-requisition-preview-frame') as HTMLIFrameElement | null;
    frame?.contentWindow?.focus();
    frame?.contentWindow?.print();
  }

  async function passPreviewRequisitions() {
    if (!writeEnabled || !previewRequisitions.length || passSaving) return;
    setPassSaving(true);
    setPreviewError('');
    try {
      const passed: CreatedRequisition[] = [];
      for (const requisition of previewRequisitions) {
        const result = await api<NativeRequisitionResponse>(`/api/requisitions/${requisition.id}/pass`, {method: 'POST'});
        if (result.requisition) passed.push(result.requisition);
      }
      if (!passed.length) throw new Error('No requisitions were passed.');
      closePreview(true);
      setSelectedPartIds(new Set());
      setNotice({kind:'success',text:passed.length === 1 ? `Active requisition ${passed[0].requisitionNumber} created.` : `Created ${passed.length} active requisitions.`});
      await refresh();
    } catch (err) {
      setPreviewError((err as Error).message);
    } finally {
      setPassSaving(false);
    }
  }

  async function generateRequisitionPreview(forceDuplicate = false){
    if (!writeEnabled || !requisitionLines.length) return;
    for (const line of requisitionLines) {
      const quantity = Number(line.quantityRequested);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        setRequisitionError('Qty requested must be a positive number for every selected part.');
        return;
      }
    }
    if (!requisitionForm.poInitiator.trim()) {
      setRequisitionError('P.O. Initiator is required.');
      return;
    }
    if (!requisitionForm.requisitionedByName.trim()) {
      setRequisitionError('Requisitioned By is required.');
      return;
    }
    if (!requisitionForm.taxExempt) {
      setRequisitionError('Tax Exempt is required.');
      return;
    }
    const hasActiveRequisition = requisitionLines.some(line=>line.part.hasActiveRequisitionRecord);
    if (hasActiveRequisition && !forceDuplicate && !window.confirm('Active requisition already exists for one or more selected parts. Generate another preview?')) return;
    setRequisitionSaving(true);
    setRequisitionError('');
    try {
      const result = await api<NativeRequisitionResponse>('/api/requisitions/preview', {
        method: 'POST',
        body: JSON.stringify({
          poInitiator: requisitionForm.poInitiator.trim(),
          requisitionedByName: requisitionForm.requisitionedByName.trim(),
          taxExempt: requisitionForm.taxExempt,
          workOrderNumber: requisitionForm.workOrderNumber.trim(),
          confirmedWith: requisitionForm.confirmedWith.trim(),
          materialCert: requisitionForm.materialCert,
          shipVia: requisitionForm.shipVia.trim(),
          fob: requisitionForm.fob,
          notes: requisitionForm.notes.trim(),
          items: requisitionLines.map(line=>({
            inventoryPartId: Number(line.part.id),
            quantityRequested: Number(line.quantityRequested),
            notes: line.notes.trim(),
            unitOfMeasure: 'EA',
            itemNumber: line.part.supplierPartNumber || line.part.partNumber,
          })),
          allowDuplicate: forceDuplicate || hasActiveRequisition,
        }),
      });
      const created = result.requisitions?.length ? result.requisitions : result.requisition ? [result.requisition] : [];
      if (!created.length) throw new Error('No requisition previews were created.');
      setRequisitionLines([]);
      setRequisitionForm(blankRequisitionForm(userFullName));
      openPreview(created);
      setNotice({kind:'success',text:created.length === 1 ? `Preview ready for ${created[0].requisitionNumber}.` : `Preview ready for ${created.length} requisitions.`});
    } catch (err) {
      const message = (err as Error).message;
      if (/Active requisition already exists/i.test(message) && window.confirm('Active requisition already exists for one or more selected parts. Generate another preview?')) {
        setRequisitionSaving(false);
        await generateRequisitionPreview(true);
        return;
      }
      setRequisitionError(message);
    } finally {
      setRequisitionSaving(false);
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
            <span>Last refreshed: {formatRefreshTime(lastRefreshed)}</span>
            {selectedParts.length>0&&<span>Selected: {selectedParts.length}</span>}
          </div>
        </div>
        <div className="inventory-focus-actions">
          {showWriteActions&&<button className="primary-button" type="button" onClick={openAdd} disabled={!writeEnabled}>Add Part</button>}
          {canUseInventoryTools&&<button className={toolsOpen?'secondary-button inventory-tools-toggle active':'secondary-button inventory-tools-toggle'} type="button" onClick={()=>setToolsOpen(current=>!current)} aria-expanded={toolsOpen} aria-controls="inventory-tools-panel"><span aria-hidden="true">&#9881;</span><span>Tools</span></button>}
          <button className="secondary-button" type="button" onClick={()=>void refresh({notify:true})} disabled={loading}>Refresh Inventory</button>
        </div>
      </div>

      {error&&<p className="form-message inventory-toast error">{error}</p>}
      {!canWrite&&<p className="form-message inventory-toast error">View-only access.</p>}

      {nativeSummary.totalParts===0&&!loading&&(
        <section className="mcc-card inventory-setup-card">
          <div>
            <span>Phase 2E setup</span>
            <strong>MCC Inventory is empty. Import legacy inventory to begin daily use.</strong>
            <p>This copies inventory into Maintenance Command Center without modifying the legacy system.</p>
          </div>
          <div className="inventory-setup-actions">
            <button className="primary-button" type="button" onClick={()=>setToolsOpen(true)} disabled={!canUseInventoryTools}>Open Inventory Tools</button>
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

      {canUseInventoryTools&&toolsOpen&&(
        <section className="mcc-card inventory-tools-card" id="inventory-tools-panel">
          <div className="inventory-tools-heading">
            <div>
              <span>Inventory Tools</span>
              <strong>Inventory import / export / backup</strong>
            </div>
            <button className="link-button compact-button" type="button" onClick={()=>setToolsOpen(false)}>Close</button>
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
                <button className="secondary-button compact-button" type="button" onClick={()=>void loadBackups()} disabled={Boolean(toolsBusy)}>Refresh Backups</button>
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
          <div className="inventory-tools-panel inventory-tools-legacy">
            <span>Legacy Import / Migration</span>
            <div className="inventory-tool-actions">
              {canImport&&<button className="primary-button compact-button" type="button" onClick={()=>void importFromMit3()} disabled={importing||Boolean(toolsBusy)}>{importing?'Importing...':'Import Legacy Inventory'}</button>}
              <a className="secondary-button compact-button action-link" href={status?.mit3Url ?? 'http://localhost:4173'} target="_blank" rel="noreferrer">Open Legacy Inventory</a>
            </div>
            <p className="form-message">MCC Inventory remains the daily-use system.</p>
          </div>
        </section>
      )}

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

        <div className="inventory-selection-panel">
          <div>
            <strong>Selected: {selectedParts.length}</strong>
            <span>{selectedParts.length ? selectedParts.map(part=>part.partNumber || part.itemId || 'Part').slice(0,3).join(', ') : 'Select one or more rows to create a requisition.'}</span>
          </div>
          <div className="inventory-selection-actions">
            <button className="secondary-button compact-button" type="button" onClick={toggleVisibleSelection} disabled={!visibleParts.length}>{allVisibleSelected?'Unselect Current Page':'Select Current Page'}</button>
            <button className="secondary-button compact-button" type="button" onClick={clearSelection} disabled={!selectedParts.length}>Clear Selection</button>
            <button className="primary-button compact-button" type="button" onClick={startSelectedRequisition} disabled={!writeEnabled||!selectedParts.length}>Preview Requisition</button>
          </div>
        </div>

        <div className="inventory-table-meta">
          <div className="inventory-pager">
            <label className="page-size-field">
              <span>Rows</span>
              <select value={String(pageSize)} onChange={event=>setPageSize(event.target.value==='all'?'all':Number(event.target.value) as PageSize)}>
                {pageSizeOptions.map(option=><option key={String(option)} value={String(option)}>{option === 'all' ? 'All' : option}</option>)}
              </select>
            </label>
            <button className="secondary-button compact-button" type="button" onClick={()=>moveInventoryPage('previous','top')} disabled={page<=1||pageSize==='all'}>Prev</button>
            <span className="page-count">Page {page} of {totalPages}</span>
            <button className="secondary-button compact-button" type="button" onClick={()=>moveInventoryPage('next','top')} disabled={page>=totalPages||pageSize==='all'}>Next</button>
          </div>
        </div>

        <div className="table-card inventory-table-wrap" ref={tableScrollRef} onScroll={handleInventoryTableScroll}>
          <table>
            <thead>
              <tr>
                <th aria-sort={sortAria('partNumber')}>{renderSortHeader('partNumber','Part Number')}</th>
                <th aria-sort={sortAria('description')}>{renderSortHeader('description','Description')}</th>
                <th aria-sort={sortAria('location')}>{renderSortHeader('location','Location')}</th>
                <th aria-sort={sortAria('vendor')}>{renderSortHeader('vendor','Vendor')}</th>
                <th aria-sort={sortAria('quantity')}>{renderSortHeader('quantity','Qty')}</th>
                <th aria-sort={sortAria('unitCost')}>{renderSortHeader('unitCost','Cost')}</th>
                <th aria-sort={sortAria('status')}>{renderSortHeader('status','Status')}</th>
                {showWriteActions&&<th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {visibleParts.map(part=>(
                  <tr key={part.id} className={selectedPartIds.has(part.id) ? 'inventory-row-selected' : undefined}>
                    <td>
                      <span className="plain-part-number">{part.partNumber || part.itemId || '-'}</span>
                    </td>
                    <td className="inventory-description-cell"><span className="inventory-description-text" title={part.description || undefined}>{part.description || '-'}</span></td>
                    <td>{part.location || '-'}</td>
                    <td>{part.vendor || '-'}</td>
                    <td>{part.quantity}</td>
                    <td className="inventory-cost-cell">{formatCurrency(part.unitCost)}</td>
                    <td><div className="inventory-status-stack"><span className={isLowStock(part)?'status-pill disabled':'status-pill'}>{part.status}</span></div></td>
                    {showWriteActions&&(
                      <td>
                        <div className="inventory-row-actions">
                          <button className={selectedPartIds.has(part.id) ? 'secondary-button compact-button selected' : 'secondary-button compact-button'} type="button" onClick={()=>togglePartSelection(part.id)} disabled={!writeEnabled}>{selectedPartIds.has(part.id) ? 'Selected' : 'Select'}</button>
                          <button className="secondary-button compact-button" type="button" onClick={()=>openEdit(part)} disabled={!writeEnabled}>Edit</button>
                          {part.hasActiveRequisitionRecord&&<span className="row-requisition-note" title={part.activeRequisitionNumber || undefined}>Active req</span>}
                        </div>
                      </td>
                    )}
                  </tr>
              ))}
              {!loading&&sortedParts.length===0&&<tr><td colSpan={showWriteActions?8:7} className="empty-table-cell">No inventory rows match this view.</td></tr>}
              {loading&&<tr><td colSpan={showWriteActions?8:7} className="empty-table-cell">Loading MCC Inventory...</td></tr>}
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
                <span>Part Number <b className="required-marker" aria-label="required">*</b></span>
                <input value={form.partNumber} onChange={event=>setForm({...form,partNumber:event.target.value})} />
              </label>
              <label className="form-field">
                <span>Description <b className="required-marker" aria-label="required">*</b></span>
                <input value={form.description} onChange={event=>setForm({...form,description:event.target.value})} />
              </label>
              <label className="form-field">
                <span>Location</span>
                <input list="native-location-options" value={form.location} onChange={event=>setForm({...form,location:event.target.value})} />
              </label>
              <label className="form-field">
                <span>Vendor <b className="required-marker" aria-label="required">*</b></span>
                <input list="native-vendor-options" value={form.vendor} onChange={event=>setForm({...form,vendor:event.target.value})} />
              </label>
              <label className="form-field">
                <span>Manufacturer / Brand</span>
                <input value={form.manufacturerBrand} onChange={event=>setForm({...form,manufacturerBrand:event.target.value})} />
              </label>
              <label className="form-field">
                <span>Supplier Part #</span>
                <input value={form.supplierPartNumber} onChange={event=>setForm({...form,supplierPartNumber:event.target.value})} />
              </label>
              <label className="form-field">
                <span>Unit Cost <b className="required-marker" aria-label="required">*</b></span>
                <input inputMode="decimal" value={form.unitCost} onChange={event=>setForm({...form,unitCost:event.target.value})} placeholder="0.00" />
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

      {reviewGroups[reviewIndex]&&(
        <div className="modal-backdrop" role="presentation" onMouseDown={event=>{ if(event.target===event.currentTarget) closeReview(); }}>
          <form className="mcc-card inventory-modal" onSubmit={event=>{ event.preventDefault(); void passVendorRequisition(); }}>
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Vendor requisition {reviewIndex + 1} of {reviewGroups.length}</p>
                <h3>{reviewGroups[reviewIndex].vendorName}</h3>
              </div>
              <button className="link-button compact-button" type="button" onClick={closeReview}>Close</button>
            </div>
            {reviewGroups[reviewIndex].requiresReview&&<p className="form-message error">Unknown Vendor group requires review before PDF creation.</p>}
            <div className="inventory-form-grid">
              <label className="form-field"><span>Requisition Type</span><select value={reviewForm.requisitionType} onChange={event=>setReviewForm({...reviewForm,requisitionType:event.target.value as RequisitionType})}><option value="under-100">Under $100</option><option value="over-100">Over $100</option></select></label>
              <label className="form-field"><span>Request Date</span><input type="date" value={reviewForm.requestDate} onChange={event=>setReviewForm({...reviewForm,requestDate:event.target.value})} /></label>
              <label className="form-field"><span>PO No</span><input value={reviewForm.poNo} onChange={event=>setReviewForm({...reviewForm,poNo:event.target.value})} /></label>
              <label className="form-field"><span>PO Initiator</span><input value={reviewForm.poInitiator} onChange={event=>setReviewForm({...reviewForm,poInitiator:event.target.value})} /></label>
              <label className="form-field"><span>Ship Via</span><input value={reviewForm.shipVia} onChange={event=>setReviewForm({...reviewForm,shipVia:event.target.value})} /></label>
              <label className="form-field"><span>PO Class</span><input value={reviewForm.poClass} onChange={event=>setReviewForm({...reviewForm,poClass:event.target.value})} /></label>
              <label className="form-field"><span>Vendor Name</span><input value={reviewForm.vendorName} onChange={event=>setReviewForm({...reviewForm,vendorName:event.target.value})} /></label>
              <label className="form-field"><span>Confirmed With</span><input value={reviewForm.confirmedWith} onChange={event=>setReviewForm({...reviewForm,confirmedWith:event.target.value})} /></label>
              <label className="form-field inventory-form-wide"><span>Vendor Address</span><textarea value={reviewForm.vendorAddress} onChange={event=>setReviewForm({...reviewForm,vendorAddress:event.target.value})} /></label>
              {(['assetNo','moldNo','equipmentNo','partNo','jobNo','initials','tsNo','codeNo','workOrderNo','priority'] as const).map(key=><label className="form-field" key={key}><span>{key.replace(/([A-Z])/g,' $1').replace(/^./,c=>c.toUpperCase())}</span><input value={reviewForm[key]} onChange={event=>setReviewForm({...reviewForm,[key]:event.target.value})} /></label>)}
              <label className="form-field"><span>Tax Exempt</span><select value={reviewForm.taxExempt} onChange={event=>setReviewForm({...reviewForm,taxExempt:event.target.value as 'No'|'Yes'})}><option>No</option><option>Yes</option></select></label>
              <label className="form-field"><span>Material Cert</span><select value={reviewForm.materialCert} onChange={event=>setReviewForm({...reviewForm,materialCert:event.target.value as 'No'|'Yes'})}><option>No</option><option>Yes</option></select></label>
              <label className="form-field"><span>FOB</span><select value={reviewForm.fob} onChange={event=>setReviewForm({...reviewForm,fob:event.target.value as 'Origin'|'Destination'})}><option>Origin</option><option>Destination</option></select></label>
              <label className="form-field"><span>Department Manager</span><input value={reviewForm.departmentManager} onChange={event=>setReviewForm({...reviewForm,departmentManager:event.target.value})} /></label>
              <label className="form-field"><span>Requisitioned By</span><input value={reviewForm.requisitionedBy} onChange={event=>setReviewForm({...reviewForm,requisitionedBy:event.target.value})} /></label>
              <label className="form-field"><span>Authorized By</span><input value={reviewForm.authorizedBy} onChange={event=>setReviewForm({...reviewForm,authorizedBy:event.target.value})} /></label>
              <label className="form-field inventory-form-wide"><span>Comments</span><textarea value={reviewForm.comments} onChange={event=>setReviewForm({...reviewForm,comments:event.target.value})} /></label>
            </div>
            <div className="requisition-review-list">
              {reviewItems.map((item,index)=>(
                <div className="requisition-review-row" key={item.part.id}>
                  <strong>{item.part.partNumber || '-'}</strong>
                  <span>{item.part.description || '-'} / {item.part.location || 'No location'}</span>
                  <label className="form-field"><span>Qty</span><input inputMode="decimal" value={item.quantityRequested} onChange={event=>setReviewItems(current=>current.map((row,rowIndex)=>rowIndex===index?{...row,quantityRequested:event.target.value}:row))} /></label>
                  <label className="form-field"><span>Due Date</span><input type="date" value={item.dueDate} onChange={event=>setReviewItems(current=>current.map((row,rowIndex)=>rowIndex===index?{...row,dueDate:event.target.value}:row))} /></label>
                  <label className="form-field"><span>Line Notes</span><input value={item.notes} onChange={event=>setReviewItems(current=>current.map((row,rowIndex)=>rowIndex===index?{...row,notes:event.target.value}:row))} /></label>
                </div>
              ))}
            </div>

            {requisitionError&&<p className="form-message error">{requisitionError}</p>}
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={closeReview}>Cancel</button>
              <button className="primary-button" type="submit" disabled={requisitionSaving}>{requisitionSaving?'Creating...':'Create'}</button>
            </div>
          </form>
        </div>
      )}

      {requisitionLines.length>0&&(
        <div className="modal-backdrop" role="presentation" onMouseDown={event=>{ if(event.target===event.currentTarget) closeRequisition(); }}>
          <form className="mcc-card inventory-modal" onSubmit={event=>{ event.preventDefault(); void generateRequisitionPreview(); }}>
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Preview Requisition</p>
                <h3>{requisitionLines.length === 1 ? (requisitionLines[0].part.partNumber || 'Native inventory part') : `${requisitionLines.length} selected parts`}</h3>
              </div>
              <button className="link-button compact-button" type="button" onClick={()=>closeRequisition()}>Close</button>
            </div>

            {requisitionLines.some(line=>line.part.hasActiveRequisitionRecord)&&<p className="form-message error">Active requisition already exists for one or more selected parts.</p>}
            <div className="requisition-line-list">
              {requisitionLines.map(line=>(
                <div className="requisition-line-row" key={line.part.id}>
                  <div className="requisition-line-main">
                    <strong>{line.part.partNumber || line.part.itemId || '-'}</strong>
                    <span>{line.part.description || '-'}</span>
                    <span>{line.part.vendor || 'No vendor'} / {line.part.location || 'No location'} / {formatCurrency(line.part.unitCost)}</span>
                  </div>
                  <label className="form-field">
                    <span>Qty</span>
                    <input inputMode="decimal" value={line.quantityRequested} onChange={event=>updateRequisitionLine(line.part.id,{quantityRequested:event.target.value})} />
                  </label>
                  <label className="form-field requisition-line-notes">
                    <span>Line Notes</span>
                    <input value={line.notes} onChange={event=>updateRequisitionLine(line.part.id,{notes:event.target.value})} />
                  </label>
                </div>
              ))}
            </div>
            <div className="inventory-form-grid">
              <label className="form-field">
                <span>P.O. Initiator *</span>
                <input value={requisitionForm.poInitiator} onChange={event=>setRequisitionForm({...requisitionForm,poInitiator:event.target.value})} />
              </label>
              <label className="form-field">
                <span>Requisitioned By *</span>
                <input value={requisitionForm.requisitionedByName} onChange={event=>setRequisitionForm({...requisitionForm,requisitionedByName:event.target.value})} />
              </label>
              <label className="form-field">
                <span>Tax Exempt *</span>
                <select value={requisitionForm.taxExempt} onChange={event=>setRequisitionForm({...requisitionForm,taxExempt:event.target.value as RequiredYesNoChoice})}>
                  <option value="">Select</option>
                  <option value="No">No</option>
                  <option value="Yes">Yes</option>
                </select>
              </label>
              <label className="form-field">
                <span>WO#</span>
                <input value={requisitionForm.workOrderNumber} onChange={event=>setRequisitionForm({...requisitionForm,workOrderNumber:event.target.value})} />
              </label>
              <label className="form-field">
                <span>Confirmed With</span>
                <input value={requisitionForm.confirmedWith} onChange={event=>setRequisitionForm({...requisitionForm,confirmedWith:event.target.value})} />
              </label>
              <label className="form-field">
                <span>Ship Via</span>
                <input value={requisitionForm.shipVia} onChange={event=>setRequisitionForm({...requisitionForm,shipVia:event.target.value})} />
              </label>
              <label className="form-field">
                <span>Material Cert</span>
                <select value={requisitionForm.materialCert} onChange={event=>setRequisitionForm({...requisitionForm,materialCert:event.target.value as YesNoChoice})}>
                  <option value="No">No</option>
                  <option value="Yes">Yes</option>
                </select>
              </label>
              <label className="form-field">
                <span>FOB</span>
                <select value={requisitionForm.fob} onChange={event=>setRequisitionForm({...requisitionForm,fob:event.target.value as FobChoice})}>
                  <option value="Destination">Destination</option>
                  <option value="Origin">Origin</option>
                </select>
              </label>
              <label className="form-field inventory-form-wide">
                <span>Notes</span>
                <textarea value={requisitionForm.notes} onChange={event=>setRequisitionForm({...requisitionForm,notes:event.target.value})} />
              </label>
            </div>

            {requisitionError&&<p className="form-message error">{requisitionError}</p>}
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={()=>closeRequisition()}>Cancel</button>
              <button className="primary-button" type="submit" disabled={requisitionSaving}>{requisitionSaving?'Generating...':'Generate Preview'}</button>
            </div>
          </form>
        </div>
      )}

      {previewRequisitions.length>0&&(
        <div className="modal-backdrop" role="presentation" onMouseDown={event=>{ if(event.target===event.currentTarget) closePreview(); }}>
          <div className="mcc-card requisition-preview-modal" role="dialog" aria-modal="true" aria-labelledby="inventory-requisition-preview-title">
            <div className="modal-heading">
              <div>
                <p className="eyebrow">{previewRequisitions.length === 1 ? 'Requisition preview' : `${previewRequisitions.length} requisition previews`}</p>
                <h3 id="inventory-requisition-preview-title">{activePreviewRequisition?.requisitionNumber ?? 'Requisition PDF'}</h3>
              </div>
              <button className="link-button compact-button" type="button" onClick={()=>closePreview()}>Close</button>
            </div>
            {previewRequisitions.length>1&&(
              <div className="requisition-preview-tabs" role="tablist" aria-label="Created requisitions">
                {previewRequisitions.map(requisition=>(
                  <button className={requisition.id===activePreviewRequisition?.id?'active':''} key={requisition.id} type="button" onClick={()=>setActivePreviewId(requisition.id)}>
                    <strong>{requisition.requisitionNumber}</strong>
                    <span>{requisition.vendorName || 'Unknown Vendor'} / {requisition.lineCount} line{requisition.lineCount === 1 ? '' : 's'}</span>
                  </button>
                ))}
              </div>
            )}
            {previewLoading&&<div className="requisition-preview-placeholder">Loading PDF preview...</div>}
            {previewError&&<p className="form-message error">{previewError}</p>}
            {previewUrl&&<iframe id="inventory-requisition-preview-frame" className="requisition-preview-frame" title={`Preview ${activePreviewRequisition?.requisitionNumber ?? 'requisition'}`} src={previewUrl} />}
            <div className="modal-actions">
              <button className="primary-button" type="button" onClick={()=>void passPreviewRequisitions()} disabled={passSaving||!previewRequisitions.length}>{passSaving?'Passing...':'Pass / Create Active Req'}</button>
              <button className="secondary-button" type="button" onClick={printPreviewPdf} disabled={!previewUrl}>Print</button>
              <button className="secondary-button" type="button" onClick={()=>void downloadPreviewPdf()} disabled={!activePreviewRequisition}>Download PDF</button>
              <button className="secondary-button" type="button" onClick={onOpenRequisitions}>View Requisitions</button>
              <button className="link-button" type="button" onClick={()=>closePreview()}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
