import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { MccDateInput, isValidMccDateValue } from '../../components/MccDateInput';

type RequisitionStatus = 'Requested' | 'Ordered' | 'Received' | 'Canceled';
type StatusFilter = 'Requisition Staging' | 'All' | RequisitionStatus;
type Notice = { kind: 'success' | 'error'; text: string };

type RequisitionLine = {
  id: number;
  inventoryPartId: number;
  partNumber: string;
  description: string;
  vendorName: string;
  locationName: string;
  quantityRequested: number;
  unitCost: number;
  totalCost: number;
  unitOfMeasure: string;
  itemNumber: string;
  notes: string;
};

type Requisition = {
  id: number;
  requisitionNumber: string;
  inventoryPartId: number;
  partNumber: string;
  description: string;
  vendorName: string;
  locationName: string;
  quantityRequested: number;
  lineCount?: number;
  firstPartNumber?: string;
  firstDescription?: string;
  totalQuantity?: number;
  totalCost?: number;
  vendorSummary?: string;
  locationSummary?: string;
  partNumbers?: string[];
  descriptions?: string[];
  lines?: RequisitionLine[];
  status: RequisitionStatus;
  requestedByName: string;
  requestedAt: string;
  workOrderNumber: string;
  notes: string;
  cancelReason: string;
  deleted: boolean;
  deletedAt: string | null;
};

type Summary = {
  requestedCount: number;
  orderedCount: number;
  receivedCount: number;
  canceledCount: number;
  activeCount: number;
};

type ListResponse = {
  ok: boolean;
  requisitions: Requisition[];
  summary: Summary;
};

type EditForm = {
  quantityRequested: string;
  workOrderNumber: string;
  notes: string;
};
type ReasonAction = {
  kind: 'cancel' | 'delete';
  requisitions: Requisition[];
};

type StagingStatus = 'Need to Order' | 'Ready for Requisition' | 'Requisition Created';
type StagingPriority = 'Critical' | 'High' | 'Normal' | 'Low';
type StagingItem = {
  id: number; batchId: number | null; inventoryPartId: number | null; partNumber: string; description: string; vendor: string; supplierPartNumber: string;
  quantityRequested: number; unitCost: number; location: string; assetMachine: string; workOrderNumber: string; priority: StagingPriority;
  notes: string; requestedBy: string; dateAdded: string; neededByDate: string; status: StagingStatus; createdRequisitionNumber?: string;
};
type InventoryOption = { id: string; partNumber: string; description: string; vendor: string; supplierPartNumber: string; unitCost: number | null; location: string; isInRequisitionStaging?: boolean };
type StagingForm = {
  batchId: number | null; inventoryPartId: number | null; partNumber: string; description: string; vendor: string; supplierPartNumber: string; quantityRequested: string;
  unitCost: string; location: string; assetMachine: string; workOrderNumber: string; priority: StagingPriority; notes: string; requestedBy: string;
  neededByDate: string; status: StagingStatus;
};
type StagingCreateResult = { id: number; requisitionNumber: string; vendorName: string; lineCount: number; pdfUrl: string };
type StagingReviewForm = { poInitiator: string; requisitionedByName: string; taxExempt: ''|'No'|'Yes'; workOrderNumber: string; confirmedWith: string; materialCert: 'No'|'Yes'; shipVia: string; fob: 'Origin'|'Destination'; notes: string };
type RequisitionBatchStatus = 'Open'|'Ready'|'Converted'|'Closed';
type RequisitionBatch = { id:number; name:string; description:string; assetMachine:string; workOrderNumber:string; neededByDate:string; status:RequisitionBatchStatus; isGeneral:boolean; itemCount:number; openItemCount:number; convertedItemCount:number; requisitions:Array<{id:number;requisitionNumber:string}>; createdBy:string; createdAt:string; convertedAt:string };
type RequisitionBatchForm = { name:string; description:string; assetMachine:string; workOrderNumber:string; neededByDate:string; status:'Open'|'Ready' };
type StagingPdfPreview = { id:number; vendorName:string; lineCount:number; total:number; pdfUrl:string };

const writeRoles = new Set(['Admin','Manager','Maintenance Tech 3','Maintenance Tech 2']);
const deleteRoles = new Set(['Admin','Manager']);
const filters: StatusFilter[] = ['Requisition Staging','Requested','Ordered','Received','Canceled','All'];
const emptySummary: Summary = { requestedCount: 0, orderedCount: 0, receivedCount: 0, canceledCount: 0, activeCount: 0 };

async function api<T>(path:string, options:RequestInit={}): Promise<T> {
  const res=await fetch(path,{credentials:'include',headers:{'Content-Type':'application/json',...(options.headers??{})},...options});
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

function requisitionPdfPath(requisition: Requisition, preview = false) {
  return `/api/requisitions/${requisition.id}/pdf${preview ? '?preview=true' : ''}`;
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined,{dateStyle:'short',timeStyle:'short'}).format(date);
}

function formatQuantity(value: number) {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

function requisitionLineCount(requisition: Requisition) {
  return Number(requisition.lineCount ?? requisition.lines?.length ?? 1) || 1;
}

function partNumberSummary(requisition: Requisition) {
  const count = requisitionLineCount(requisition);
  if (count > 1) return `Multiple items (${count})`;
  return requisition.firstPartNumber || requisition.partNumber || '-';
}

function descriptionSummary(requisition: Requisition) {
  const count = requisitionLineCount(requisition);
  const first = requisition.firstDescription || requisition.description || '-';
  return count > 1 ? `${first} + ${count - 1} more` : first;
}

function statusClass(status: RequisitionStatus) {
  return `requisition-status status-${status.toLowerCase()}`;
}

function editFormFromRequisition(requisition: Requisition): EditForm {
  return {
    quantityRequested: String(requisition.quantityRequested),
    workOrderNumber: requisition.workOrderNumber,
    notes: requisition.notes,
  };
}

function blankStagingForm(requestedBy = '', batchId: number|null = null): StagingForm {
  return {batchId,inventoryPartId:null,partNumber:'',description:'',vendor:'',supplierPartNumber:'',quantityRequested:'',unitCost:'',location:'',assetMachine:'',workOrderNumber:'',priority:'Normal',notes:'',requestedBy,neededByDate:'',status:'Need to Order'};
}

function stagingFormFromItem(item: StagingItem): StagingForm {
  return {batchId:item.batchId,inventoryPartId:item.inventoryPartId,partNumber:item.partNumber,description:item.description,vendor:item.vendor,supplierPartNumber:item.supplierPartNumber,quantityRequested:String(item.quantityRequested),unitCost:String(item.unitCost),location:item.location,assetMachine:item.assetMachine,workOrderNumber:item.workOrderNumber,priority:item.priority,notes:item.notes,requestedBy:item.requestedBy,neededByDate:item.neededByDate,status:item.status};
}

function blankStagingReviewForm(userFullName = ''): StagingReviewForm {
  return {poInitiator:'',requisitionedByName:userFullName,taxExempt:'',workOrderNumber:'',confirmedWith:'',materialCert:'No',shipVia:'',fob:'Destination',notes:''};
}

export function RequisitionsPage({ userRole, userFullName = '' }: { userRole: string; userFullName?: string }) {
  const [requisitions,setRequisitions]=useState<Requisition[]>([]);
  const [summary,setSummary]=useState<Summary>(emptySummary);
  const [filter,setFilter]=useState<StatusFilter>('Requisition Staging');
  const [search,setSearch]=useState('');
  const [loading,setLoading]=useState(true);
  const [notice,setNotice]=useState<Notice|null>(null);
  const [busyId,setBusyId]=useState<number|null>(null);
  const [editing,setEditing]=useState<Requisition|null>(null);
  const [editForm,setEditForm]=useState<EditForm>({quantityRequested:'1',workOrderNumber:'',notes:''});
  const [editError,setEditError]=useState('');
  const [saving,setSaving]=useState(false);
  const [showDeleted,setShowDeleted]=useState(false);
  const [previewing,setPreviewing]=useState<Requisition|null>(null);
  const [previewUrl,setPreviewUrl]=useState('');
  const [previewLoading,setPreviewLoading]=useState(false);
  const [previewError,setPreviewError]=useState('');
  const [selectedIds,setSelectedIds]=useState<Set<number>>(()=>new Set());
  const [reasonAction,setReasonAction]=useState<ReasonAction|null>(null);
  const [reasonNote,setReasonNote]=useState('');
  const [reasonError,setReasonError]=useState('');
  const [reasonSaving,setReasonSaving]=useState(false);
  const [stagingItems,setStagingItems]=useState<StagingItem[]>([]);
  const [requisitionBatches,setRequisitionBatches]=useState<RequisitionBatch[]>([]);
  const [batchView,setBatchView]=useState<'active'|'completed'>('active');
  const [activeBatchId,setActiveBatchId]=useState<number|null>(null);
  const [batchEditing,setBatchEditing]=useState(false);
  const [batchForm,setBatchForm]=useState<RequisitionBatchForm>({name:'',description:'',assetMachine:'',workOrderNumber:'',neededByDate:'',status:'Open'});
  const [batchFormError,setBatchFormError]=useState('');
  const [draggedStagingItemId,setDraggedStagingItemId]=useState<number|null>(null);
  const [dragOverBatchId,setDragOverBatchId]=useState<number|null>(null);
  const [movingStagingItems,setMovingStagingItems]=useState(false);
  const [moveDestinationBatchId,setMoveDestinationBatchId]=useState<number|null>(null);
  const [moveSaving,setMoveSaving]=useState(false);
  const [moveError,setMoveError]=useState('');
  const dragFromInteractiveControl=useRef(false);
  const [stagingSearch,setStagingSearch]=useState('');
  const [stagingSelectedIds,setStagingSelectedIds]=useState<Set<number>>(()=>new Set());
  const [stagingEditing,setStagingEditing]=useState<StagingItem|'new'|null>(null);
  const [stagingForm,setStagingForm]=useState<StagingForm>(()=>blankStagingForm(userFullName));
  const [stagingFormError,setStagingFormError]=useState('');
  const [stagingSaving,setStagingSaving]=useState(false);
  const [inventoryOptions,setInventoryOptions]=useState<InventoryOption[]>([]);
  const [inventorySearch,setInventorySearch]=useState('');
  const [reviewingStaging,setReviewingStaging]=useState(false);
  const [stagingReviewForm,setStagingReviewForm]=useState<StagingReviewForm>(()=>blankStagingReviewForm(userFullName));
  const [stagingPreviewToken,setStagingPreviewToken]=useState('');
  const [stagingPdfPreviews,setStagingPdfPreviews]=useState<StagingPdfPreview[]>([]);
  const [activeStagingPreviewId,setActiveStagingPreviewId]=useState(0);
  const [stagingPreviewUrl,setStagingPreviewUrl]=useState('');
  const [stagingPreviewLoading,setStagingPreviewLoading]=useState(false);
  const [createdFromStaging,setCreatedFromStaging]=useState<StagingCreateResult[]>([]);

  const canWrite = writeRoles.has(userRole);
  const canDelete = deleteRoles.has(userRole);

  async function loadStaging(nextView: 'active'|'completed' = batchView, preferredBatchId: number|null = activeBatchId) {
    setLoading(true);
    setNotice(null);
    try {
      const [batchResult,summaryResult] = await Promise.all([
        api<{batches:RequisitionBatch[]}>(`/api/requisition-batches?view=${nextView}`),
        api<Summary & {ok:boolean}>('/api/requisitions/summary'),
      ]);
      const nextBatches = batchResult.batches ?? [];
      const selectedBatchId = nextBatches.some(batch=>batch.id===preferredBatchId) ? preferredBatchId : nextBatches[0]?.id ?? null;
      const result = selectedBatchId ? await api<{items:StagingItem[]}>(`/api/requisition-staging?batchId=${selectedBatchId}&includeCompleted=${nextView==='completed'}`) : {items:[]};
      setRequisitionBatches(nextBatches);
      setActiveBatchId(selectedBatchId);
      setStagingItems(result.items ?? []);
      setStagingSelectedIds(new Set());
      setSummary(summaryResult ?? emptySummary);
    } catch (err) {
      setNotice({kind:'error',text:(err as Error).message});
      setRequisitionBatches([]);
      setStagingItems([]);
    } finally {
      setLoading(false);
    }
  }

  async function loadInventoryOptions() {
    try {
      const result = await api<{parts:InventoryOption[]}>('/api/inventory/native/parts');
      setInventoryOptions(result.parts ?? []);
    } catch {
      setInventoryOptions([]);
    }
  }

  async function loadRequisitions(nextFilter = filter, nextShowDeleted = showDeleted) {
    if (nextFilter === 'Requisition Staging') {
      await loadStaging();
      return;
    }
    setLoading(true);
    setNotice(null);
    try {
      const params = new URLSearchParams();
      params.set('status', nextFilter === 'All' ? 'all' : nextFilter);
      if (nextShowDeleted) params.set('includeDeleted', 'true');
      const query = `?${params.toString()}`;
      const result = await api<ListResponse>(`/api/requisitions${query}`);
      setRequisitions(result.requisitions ?? []);
      setSummary(result.summary ?? emptySummary);
    } catch (err) {
      setNotice({kind:'error',text:(err as Error).message});
      setRequisitions([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(()=>{ void loadRequisitions(); void loadInventoryOptions(); },[]);
  useEffect(()=>{
    if (!previewing) {
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
    pdfObjectUrl(requisitionPdfPath(previewing, true))
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
  },[previewing]);
  const activeRequisitionBatch = useMemo(()=>requisitionBatches.find(batch=>batch.id===activeBatchId) ?? null,[requisitionBatches,activeBatchId]);
  const activeStagingPdfPreview = useMemo(()=>stagingPdfPreviews.find(preview=>preview.id===activeStagingPreviewId) ?? stagingPdfPreviews[0] ?? null,[stagingPdfPreviews,activeStagingPreviewId]);
  useEffect(()=>{
    if (!activeStagingPdfPreview) {
      setStagingPreviewUrl('');
      setStagingPreviewLoading(false);
      return;
    }
    let disposed = false;
    let objectUrl = '';
    setStagingPreviewUrl('');
    setStagingPreviewLoading(true);
    pdfObjectUrl(activeStagingPdfPreview.pdfUrl)
      .then(url=>{
        if (disposed) return URL.revokeObjectURL(url);
        objectUrl=url;
        setStagingPreviewUrl(url);
      })
      .catch(error=>{if(!disposed)setStagingFormError((error as Error).message);})
      .finally(()=>{if(!disposed)setStagingPreviewLoading(false);});
    return ()=>{disposed=true;if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[activeStagingPdfPreview]);

  const filteredRequisitions = useMemo(()=>{
    const needle = search.trim().toLowerCase();
    if (!needle) return requisitions;
    return requisitions.filter(requisition=>[
      requisition.requisitionNumber,
      requisition.partNumber,
      requisition.description,
      requisition.vendorName,
      requisition.locationName,
      requisition.workOrderNumber,
      requisition.vendorSummary ?? '',
      requisition.locationSummary ?? '',
      ...(requisition.partNumbers ?? []),
      ...(requisition.descriptions ?? []),
      ...(requisition.lines ?? []).flatMap(line=>[line.partNumber,line.description,line.vendorName,line.locationName,line.itemNumber,line.notes]),
    ].some(value=>value.toLowerCase().includes(needle)));
  },[requisitions,search]);
  const filteredStagingItems = useMemo(()=>{
    const needle = stagingSearch.trim().toLowerCase();
    if (!needle) return stagingItems;
    return stagingItems.filter(item=>[item.partNumber,item.description,item.vendor,item.supplierPartNumber,item.location,item.assetMachine,item.workOrderNumber,item.priority,item.status,item.notes,item.requestedBy].some(value=>String(value ?? '').toLowerCase().includes(needle)));
  },[stagingItems,stagingSearch]);
  const selectedStagingItems = useMemo(()=>stagingItems.filter(item=>stagingSelectedIds.has(item.id)&&['Need to Order','Ready for Requisition'].includes(item.status)),[stagingItems,stagingSelectedIds]);
  const inventoryMatches = useMemo(()=>{
    const needle = inventorySearch.trim().toLowerCase();
    if (!needle) return [];
    return inventoryOptions.filter(part=>[part.partNumber,part.description,part.vendor,part.supplierPartNumber,part.location].some(value=>String(value ?? '').toLowerCase().includes(needle))).slice(0,12);
  },[inventoryOptions,inventorySearch]);
  const visibleSelectableStagingItems = filteredStagingItems.filter(item=>['Need to Order','Ready for Requisition'].includes(item.status));
  const allVisibleStagingSelected = visibleSelectableStagingItems.length > 0 && visibleSelectableStagingItems.every(item=>stagingSelectedIds.has(item.id));
  const selectedRequisitions = useMemo(()=>requisitions.filter(requisition=>selectedIds.has(requisition.id)&&!requisition.deleted),[requisitions,selectedIds]);
  const selectedCancelable = selectedRequisitions.filter(requisition=>requisition.status==='Requested'||requisition.status==='Ordered');
  const allVisibleSelected = filteredRequisitions.length > 0 && filteredRequisitions.every(requisition=>selectedIds.has(requisition.id));

  function setNextFilter(nextFilter: StatusFilter) {
    setFilter(nextFilter);
    void loadRequisitions(nextFilter, showDeleted);
  }

  function toggleShowDeleted() {
    const next = !showDeleted;
    setShowDeleted(next);
    void loadRequisitions(filter, next);
  }

  function toggleRequisitionSelection(id: number) {
    setSelectedIds(current=>{
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleVisibleSelection() {
    setSelectedIds(current=>{
      const next = new Set(current);
      if (allVisibleSelected) {
        filteredRequisitions.forEach(requisition=>next.delete(requisition.id));
      } else {
        filteredRequisitions.filter(requisition=>!requisition.deleted).forEach(requisition=>next.add(requisition.id));
      }
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function openNewStaging(inventory?: InventoryOption) {
    if (!canWrite || !activeBatchId || batchView !== 'active') return;
    setStagingEditing('new');
    setStagingForm(inventory ? {
      ...blankStagingForm(userFullName,activeBatchId),inventoryPartId:Number(inventory.id),partNumber:inventory.partNumber,description:inventory.description,vendor:inventory.vendor,supplierPartNumber:inventory.supplierPartNumber,unitCost:inventory.unitCost === null ? '' : String(inventory.unitCost),location:inventory.location,assetMachine:activeRequisitionBatch?.assetMachine ?? '',workOrderNumber:activeRequisitionBatch?.workOrderNumber ?? '',neededByDate:activeRequisitionBatch?.neededByDate ?? '',
    } : {...blankStagingForm(userFullName,activeBatchId),assetMachine:activeRequisitionBatch?.assetMachine ?? '',workOrderNumber:activeRequisitionBatch?.workOrderNumber ?? '',neededByDate:activeRequisitionBatch?.neededByDate ?? ''});
    setStagingFormError('');
    setCreatedFromStaging([]);
  }

  function openEditStaging(item: StagingItem) {
    if (!canWrite) return;
    setStagingEditing(item);
    setStagingForm(stagingFormFromItem(item));
    setStagingFormError('');
  }

  function stageInventoryOption(part: InventoryOption) {
    const existing = stagingItems.find(item=>item.batchId===activeBatchId&&item.inventoryPartId === Number(part.id) && ['Need to Order','Ready for Requisition'].includes(item.status));
    if (existing) {
      setNotice({kind:'error',text:`${part.partNumber} is already staged. Update its existing quantity instead.`});
      openEditStaging(existing);
      return;
    }
    openNewStaging(part);
  }

  function closeStagingEditor(force = false) {
    if (stagingSaving && !force) return;
    setStagingEditing(null);
    setStagingFormError('');
  }

  async function saveStagingItem(event: FormEvent) {
    event.preventDefault();
    if (!stagingEditing) return;
    const quantity = Number(stagingForm.quantityRequested);
    const unitCost = stagingForm.unitCost.trim() ? Number(stagingForm.unitCost) : 0;
    if (!stagingForm.partNumber.trim() || !stagingForm.description.trim() || !stagingForm.vendor.trim()) {
      setStagingFormError('Part Number, Description, and Vendor are required.');
      return;
    }
    if (!stagingForm.quantityRequested.trim() || !Number.isFinite(quantity) || quantity <= 0) {
      setStagingFormError('Quantity Requested must be a positive number.');
      return;
    }
    if (!Number.isFinite(unitCost) || unitCost < 0) {
      setStagingFormError('Unit Cost must be zero or a positive number.');
      return;
    }
    if (!isValidMccDateValue(stagingForm.neededByDate)) {
      setStagingFormError('Needed-by Date must be valid when entered.');
      return;
    }
    setStagingSaving(true);
    setStagingFormError('');
    try {
      const isEdit = stagingEditing !== 'new';
      await api(isEdit ? `/api/requisition-staging/${stagingEditing.id}` : '/api/requisition-staging', {method:isEdit?'PATCH':'POST',body:JSON.stringify({...stagingForm,quantityRequested:quantity,unitCost})});
      closeStagingEditor(true);
      setInventorySearch('');
      await Promise.all([loadStaging(batchView,activeBatchId),loadInventoryOptions()]);
      setNotice({kind:'success',text:isEdit?'Staged item updated.':'Item added to Requisition Staging List.'});
    } catch (err) {
      setStagingFormError((err as Error).message);
    } finally {
      setStagingSaving(false);
    }
  }

  async function removeStagingItem(item: StagingItem) {
    if (!canWrite || !window.confirm('Remove this item from the staging list?')) return;
    setBusyId(item.id);
    try {
      await api(`/api/requisition-staging/${item.id}`, {method:'DELETE'});
      setStagingSelectedIds(current=>{const next=new Set(current);next.delete(item.id);return next;});
      await Promise.all([loadStaging(batchView,activeBatchId),loadInventoryOptions()]);
      setNotice({kind:'success',text:`${item.partNumber} removed from the staging list.`});
    } catch (err) {
      setNotice({kind:'error',text:(err as Error).message});
    } finally {
      setBusyId(null);
    }
  }

  async function selectRequisitionBatch(batch: RequisitionBatch) {
    setActiveBatchId(batch.id);
    setStagingSelectedIds(new Set());
    setLoading(true);
    try {
      const result = await api<{items:StagingItem[]}>(`/api/requisition-staging?batchId=${batch.id}&includeCompleted=${batchView==='completed'}`);
      setStagingItems(result.items ?? []);
    } catch (err) {
      setNotice({kind:'error',text:(err as Error).message});
    } finally {
      setLoading(false);
    }
  }

  async function clearSelectedStagingItems() {
    const ids = selectedStagingItems.map(item=>item.id);
    if (!canWrite || !ids.length || !window.confirm(`Remove ${ids.length} selected item${ids.length===1?'':'s'} from the staging list?`)) return;
    setStagingSaving(true);
    setNotice(null);
    try {
      const result = await api<{removedCount:number}>('/api/requisition-staging/clear-selected',{method:'POST',body:JSON.stringify({ids})});
      setStagingSelectedIds(new Set());
      await Promise.all([loadStaging(batchView,activeBatchId),loadInventoryOptions()]);
      setNotice({kind:'success',text:`Removed ${result.removedCount} item${result.removedCount===1?'':'s'} from the staging list.`});
    } catch (err) {
      setNotice({kind:'error',text:(err as Error).message});
    } finally {
      setStagingSaving(false);
    }
  }

  function toggleStagingSelection(id: number) {
    setStagingSelectedIds(current=>{const next=new Set(current);if(next.has(id))next.delete(id);else next.add(id);return next;});
  }

  function toggleVisibleStagingSelection() {
    setStagingSelectedIds(current=>{
      const next=new Set(current);
      const selectable=filteredStagingItems.filter(item=>['Need to Order','Ready for Requisition'].includes(item.status));
      if (allVisibleStagingSelected) selectable.forEach(item=>next.delete(item.id)); else selectable.forEach(item=>next.add(item.id));
      return next;
    });
  }

  function openStagingReview() {
    if (!selectedStagingItems.length) return;
    setStagingReviewForm(blankStagingReviewForm(userFullName));
    setReviewingStaging(true);
    setStagingFormError('');
    setStagingPreviewToken('');
    setStagingPdfPreviews([]);
    setCreatedFromStaging([]);
  }

  async function generateStagingPreview(event: FormEvent) {
    event.preventDefault();
    if (!selectedStagingItems.length) return;
    if (!stagingReviewForm.poInitiator.trim() || !stagingReviewForm.requisitionedByName.trim() || !stagingReviewForm.taxExempt) {
      setStagingFormError('P.O. Initiator, Requisitioned By, and Tax Exempt are required.');
      return;
    }
    setStagingSaving(true);
    setStagingFormError('');
    try {
      const result = await api<{token:string;previews:StagingPdfPreview[]}>('/api/requisition-staging/preview',{method:'POST',body:JSON.stringify({...stagingReviewForm,stagingItemIds:selectedStagingItems.map(item=>item.id)})});
      setStagingPreviewToken(result.token);
      setStagingPdfPreviews(result.previews ?? []);
      setActiveStagingPreviewId(result.previews?.[0]?.id ?? 0);
    } catch (err) {
      setStagingFormError((err as Error).message);
    } finally {
      setStagingSaving(false);
    }
  }

  async function createFromStaging() {
    if (!stagingPreviewToken) return;
    setStagingSaving(true);
    setStagingFormError('');
    try {
      const result = await api<{requisitions:StagingCreateResult[]}>('/api/requisition-staging/create-requisitions',{method:'POST',body:JSON.stringify({previewToken:stagingPreviewToken})});
      setCreatedFromStaging(result.requisitions ?? []);
      setStagingSelectedIds(new Set());
      setStagingPreviewToken('');
      setStagingPdfPreviews([]);
      await Promise.all([loadStaging(batchView,null),loadInventoryOptions()]);
      setNotice({kind:'success',text:`Created ${result.requisitions?.length ?? 0} official vendor requisition${result.requisitions?.length === 1 ? '' : 's'} from staged items.`});
    } catch (err) {
      setStagingFormError((err as Error).message);
    } finally {
      setStagingSaving(false);
    }
  }

  function backToStagingReview() {
    setStagingPreviewToken('');
    setStagingPdfPreviews([]);
    setStagingPreviewUrl('');
    setStagingFormError('');
  }

  function printStagingPreview() {
    const frame = document.getElementById('staging-requisition-preview-frame') as HTMLIFrameElement|null;
    frame?.contentWindow?.focus();
    frame?.contentWindow?.print();
  }

  async function downloadStagingPreview() {
    if (!activeStagingPdfPreview) return;
    await downloadFile(`${activeStagingPdfPreview.pdfUrl}?download=true`,`MCC_Requisition_Preview_${activeStagingPdfPreview.vendorName}.pdf`);
  }

  function openBatchCreator() {
    setBatchForm({name:'',description:'',assetMachine:'',workOrderNumber:'',neededByDate:'',status:'Open'});
    setBatchFormError('');
    setBatchEditing(true);
  }

  async function saveRequisitionBatch(event: FormEvent) {
    event.preventDefault();
    if (!batchForm.name.trim()) return setBatchFormError('Batch name is required.');
    if (!isValidMccDateValue(batchForm.neededByDate)) return setBatchFormError('Needed-by Date must be valid when entered.');
    setStagingSaving(true);
    setBatchFormError('');
    try {
      const result = await api<{batch:RequisitionBatch}>('/api/requisition-batches',{method:'POST',body:JSON.stringify(batchForm)});
      setBatchEditing(false);
      setBatchView('active');
      await loadStaging('active',result.batch.id);
      setNotice({kind:'success',text:`Requisition Batch “${result.batch.name}” created.`});
    } catch (err) {
      setBatchFormError((err as Error).message);
    } finally {
      setStagingSaving(false);
    }
  }

  async function moveItemsToBatch(itemIds: number[], destinationBatch: RequisitionBatch, mergeDuplicates = false) {
    if (!itemIds.length || destinationBatch.id===activeBatchId || !['Open','Ready'].includes(destinationBatch.status)) return;
    setMoveSaving(true);
    setMoveError('');
    try {
      const response = await fetch('/api/requisition-staging/move',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({itemIds,destinationBatchId:destinationBatch.id,mergeDuplicates})});
      const result = await response.json().catch(()=>({}));
      if (!response.ok) {
        if (response.status===409&&!mergeDuplicates&&window.confirm(`${result.error}\n\nMerge quantities and complete the move?`)) {
          setMoveSaving(false);
          await moveItemsToBatch(itemIds,destinationBatch,true);
          return;
        }
        throw new Error(result.error||'Unable to move staged items.');
      }
      setMovingStagingItems(false);
      setMoveDestinationBatchId(null);
      setStagingSelectedIds(new Set());
      await Promise.all([loadStaging('active',activeBatchId),loadInventoryOptions()]);
      setNotice({kind:'success',text:`${result.movedCount} item${result.movedCount===1?'':'s'} moved to ${destinationBatch.name}.${result.mergedCount?` ${result.mergedCount} duplicate${result.mergedCount===1?' was':'s were'} merged.`:''}`});
    } catch (err) {
      setMoveError((err as Error).message);
      setNotice({kind:'error',text:(err as Error).message});
    } finally {
      setMoveSaving(false);
      setDraggedStagingItemId(null);
      setDragOverBatchId(null);
    }
  }

  function openMoveSelectedItems() {
    if (!selectedStagingItems.length) return;
    setMoveDestinationBatchId(null);
    setMoveError('');
    setMovingStagingItems(true);
  }

  function openCreatedRequisition(requisitionNumber: string) {
    setReviewingStaging(false);
    setFilter('All');
    setSearch(requisitionNumber);
    void loadRequisitions('All',false);
  }

  function openReasonAction(kind: ReasonAction['kind'], requisitionsForAction: Requisition[]) {
    const actionable = requisitionsForAction.filter(requisition=>!requisition.deleted);
    if (!actionable.length) return;
    setReasonAction({kind,requisitions:actionable});
    setReasonNote('');
    setReasonError('');
    setNotice(null);
  }

  function closeReasonAction(force = false) {
    if (reasonSaving && !force) return;
    setReasonAction(null);
    setReasonNote('');
    setReasonError('');
  }

  async function submitReasonAction(event: FormEvent) {
    event.preventDefault();
    if (!reasonAction) return;
    const reason = reasonNote.trim();
    if (!reason) {
      setReasonError('Reason is required.');
      return;
    }
    const ids = reasonAction.requisitions.map(requisition=>requisition.id);
    setReasonSaving(true);
    setReasonError('');
    try {
      if (reasonAction.kind === 'cancel') {
        if (ids.length === 1) {
          await api(`/api/requisitions/${ids[0]}/status`, {method:'PATCH',body:JSON.stringify({status:'Canceled',cancelReason:reason,reasonNote:reason})});
        } else {
          await api('/api/requisitions/bulk-cancel', {method:'POST',body:JSON.stringify({ids,reasonNote:reason})});
        }
      } else if (ids.length === 1) {
        await api(`/api/requisitions/${ids[0]}`, {method:'DELETE',body:JSON.stringify({reasonNote:reason})});
      } else {
        await api('/api/requisitions/bulk-delete', {method:'POST',body:JSON.stringify({ids,reasonNote:reason})});
      }
      const label = reasonAction.kind === 'cancel' ? 'canceled' : 'deleted';
      setNotice({kind:'success',text:`${ids.length} requisition${ids.length === 1 ? '' : 's'} ${label}.`});
      closeReasonAction(true);
      clearSelection();
      await loadRequisitions(filter, showDeleted);
    } catch (err) {
      setReasonError((err as Error).message);
    } finally {
      setReasonSaving(false);
    }
  }

  async function downloadPdf(requisition: Requisition) {
    if (busyId) return;
    setBusyId(requisition.id);
    setNotice(null);
    try {
      await downloadFile(requisitionPdfPath(requisition), `MCC_Requisition_${requisition.requisitionNumber}.pdf`);
      setNotice({kind:'success',text:`${requisition.requisitionNumber} PDF downloaded.`});
    } catch (err) {
      setNotice({kind:'error',text:(err as Error).message});
    } finally {
      setBusyId(null);
    }
  }

  function openPreview(requisition: Requisition) {
    setPreviewing(requisition);
    setPreviewError('');
    setNotice(null);
  }

  function closePreview() {
    setPreviewing(null);
    setPreviewError('');
  }

  function printPreview() {
    const frame = document.getElementById('requisition-page-preview-frame') as HTMLIFrameElement | null;
    frame?.contentWindow?.focus();
    frame?.contentWindow?.print();
  }

  async function updateStatus(requisition: Requisition, status: Exclude<RequisitionStatus,'Requested'>) {
    if (!canWrite || requisition.deleted || busyId) return;
    if (status === 'Canceled') {
      openReasonAction('cancel',[requisition]);
      return;
    }
    setBusyId(requisition.id);
    setNotice(null);
    try {
      await api(`/api/requisitions/${requisition.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({status}),
      });
      await loadRequisitions(filter, showDeleted);
      setNotice({kind:'success',text:`${requisition.requisitionNumber} marked ${status}.`});
    } catch (err) {
      setNotice({kind:'error',text:(err as Error).message});
    } finally {
      setBusyId(null);
    }
  }

  function openEdit(requisition: Requisition) {
    if (!canWrite || requisition.deleted || requisition.status !== 'Requested') return;
    setEditing(requisition);
    setEditForm(editFormFromRequisition(requisition));
    setEditError('');
    setNotice(null);
  }

  function closeEdit(force = false) {
    if (saving && !force) return;
    setEditing(null);
    setEditError('');
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    const isMultiLine = requisitionLineCount(editing) > 1;
    const quantity = Number(editForm.quantityRequested);
    if (!isMultiLine) {
      if (!Number.isFinite(quantity) || quantity <= 0) {
        setEditError('Qty requested must be a positive number.');
        return;
      }
    }
    setSaving(true);
    setEditError('');
    try {
      await api(`/api/requisitions/${editing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...(isMultiLine ? {} : {quantityRequested: quantity}),
          workOrderNumber: editForm.workOrderNumber,
          notes: editForm.notes,
        }),
      });
      closeEdit(true);
      setNotice({kind:'success',text:`${editing.requisitionNumber} updated.`});
      await loadRequisitions(filter, showDeleted);
    } catch (err) {
      setEditError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function deleteRequisition(requisition: Requisition) {
    if (!canDelete || requisition.deleted || busyId) return;
    openReasonAction('delete',[requisition]);
  }

  return (
    <div className="page-stack requisitions-page">
      {!canWrite&&<span className="view-only-badge requisitions-access-badge">View-only access.</span>}

      <div className="card-grid requisition-summary-grid">
        <article className="mcc-card"><span>Requested</span><strong>{summary.requestedCount}</strong><p>Waiting for order action.</p></article>
        <article className="mcc-card"><span>Ordered</span><strong>{summary.orderedCount}</strong><p>Order placed, not received.</p></article>
        <article className="mcc-card"><span>Received</span><strong>{summary.receivedCount}</strong><p>Closed as received.</p></article>
        <article className="mcc-card"><span>Canceled</span><strong>{summary.canceledCount}</strong><p>Closed without order.</p></article>
        <article className="mcc-card"><span>Active</span><strong>{summary.activeCount}</strong><p>Requested plus ordered.</p></article>
      </div>

      <nav className="requisition-view-pills" aria-label="Requisition status views">
        {filters.map(option=><button className={filter===option?'active':''} key={option} type="button" onClick={()=>setNextFilter(option)}>{option}</button>)}
      </nav>

      {notice&&<p className={notice.kind==='error'?'form-message inventory-toast error':'form-message inventory-toast'} role="status">{notice.text}</p>}

      {filter==='Requisition Staging'&&(
        <section className="mcc-card requisitions-table-card staging-list-card">
          <div className="staging-list-heading">
            <div><p className="eyebrow">Purchase preparation</p><h3>Requisition Staging List</h3><p>A working list of items to order later. Select items when you are ready to build a requisition.</p></div>
            {canWrite&&<button className="primary-button" type="button" onClick={openBatchCreator}>Create Requisition Batch</button>}
          </div>
          <div className="requisition-batch-view-pills" role="tablist" aria-label="Requisition Batch views">
            <button className={batchView==='active'?'active':''} type="button" onClick={()=>{setBatchView('active');void loadStaging('active',null);}}>Open Batches</button>
            <button className={batchView==='completed'?'active':''} type="button" onClick={()=>{setBatchView('completed');void loadStaging('completed',null);}}>Converted / Closed</button>
          </div>
          <div className="requisition-batch-grid">
            {requisitionBatches.map(batch=>{
              const canDrop=batchView==='active'&&batch.id!==activeBatchId&&['Open','Ready'].includes(batch.status);
              const className=['requisition-batch-card',batch.id===activeBatchId?'active':'',dragOverBatchId===batch.id?'drop-target':'',draggedStagingItemId&&canDrop?'drop-available':''].filter(Boolean).join(' ');
              return <button className={className} key={batch.id} type="button" onClick={()=>void selectRequisitionBatch(batch)} onDragOver={event=>{if(!draggedStagingItemId||!canDrop)return;event.preventDefault();event.dataTransfer.dropEffect='move';setDragOverBatchId(batch.id);}} onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setDragOverBatchId(current=>current===batch.id?null:current);}} onDrop={event=>{event.preventDefault();event.stopPropagation();const itemId=Number(event.dataTransfer.getData('text/plain'))||draggedStagingItemId;if(itemId&&canDrop)void moveItemsToBatch([itemId],batch);}}>
                <span className={`requisition-batch-status status-${batch.status.toLowerCase()}`}>{batch.status}</span>
                <strong>{batch.name}</strong>
                <span>{batchView==='active'?batch.openItemCount:batch.convertedItemCount} item{(batchView==='active'?batch.openItemCount:batch.convertedItemCount)===1?'':'s'}</span>
                {(batch.assetMachine||batch.workOrderNumber)&&<small>{batch.assetMachine||'No asset'}{batch.workOrderNumber?` / WO# ${batch.workOrderNumber}`:''}</small>}
              </button>;
            })}
            {!loading&&!requisitionBatches.length&&<p className="empty-batch-message">No {batchView==='active'?'open':'converted or closed'} Requisition Batches.</p>}
          </div>
          {activeRequisitionBatch&&<div className="active-requisition-batch-heading"><div><span>Requisition Batch</span><strong>{activeRequisitionBatch.name}</strong><small>{activeRequisitionBatch.description||'No batch notes.'}</small></div>{batchView==='active'&&canWrite&&<button className="secondary-button compact-button" type="button" onClick={()=>openNewStaging()}>Manually Add Item</button>}<div className="batch-requisition-links">{activeRequisitionBatch.requisitions.map(requisition=><button className="secondary-button compact-button" key={requisition.id} type="button" onClick={()=>openCreatedRequisition(requisition.requisitionNumber)}>Open {requisition.requisitionNumber}</button>)}</div></div>}
          {activeRequisitionBatch&&batchView==='active'&&<>
            <div className="staging-toolbar">
              <label className="form-field"><span>Search staged items</span><input value={stagingSearch} onChange={event=>setStagingSearch(event.target.value)} placeholder="Part, vendor, machine, WO#, status..." /></label>
              {canWrite&&<label className="form-field"><span>Search Inventory to add</span><input value={inventorySearch} onChange={event=>setInventorySearch(event.target.value)} placeholder="Part number, description, vendor..." /></label>}
            </div>
            {canWrite&&inventoryMatches.length>0&&<div className="staging-inventory-results">{inventoryMatches.map(part=><button key={part.id} type="button" onClick={()=>stageInventoryOption(part)}><strong>{part.partNumber}</strong><span>{part.description}</span><small>{part.vendor||'No vendor'}</small></button>)}</div>}
            <div className="requisition-selection-toolbar">
              <span>Selected: {selectedStagingItems.length}</span>
              <button className="secondary-button compact-button" type="button" onClick={toggleVisibleStagingSelection} disabled={!visibleSelectableStagingItems.length}>{allVisibleStagingSelected?'Unselect Visible':'Select Visible'}</button>
              <button className="secondary-button compact-button" type="button" onClick={()=>setStagingSelectedIds(new Set())} disabled={!stagingSelectedIds.size}>Unselect All</button>
              {canWrite&&<button className="danger-button compact-button" type="button" onClick={()=>void clearSelectedStagingItems()} disabled={!selectedStagingItems.length||stagingSaving}>Clear Selected Items</button>}
              {canWrite&&<button className="secondary-button compact-button" type="button" onClick={openMoveSelectedItems} disabled={!selectedStagingItems.length||moveSaving}>Move to Batch</button>}
              {canWrite&&<button className="primary-button compact-button" type="button" onClick={openStagingReview} disabled={!selectedStagingItems.length}>Preview Requisition</button>}
            </div>
          </>}
          <div className="table-card requisitions-table-wrap staging-table-wrap">
            <table className="requisition-staging-table">
              <thead><tr><th>Select</th><th>Priority</th><th>Status</th><th>Part Number</th><th>Description</th><th>Qty</th><th>Vendor</th><th>Location</th><th>Asset / Machine</th><th>WO#</th><th>Needed By</th><th>Requested By</th><th>Actions</th></tr></thead>
              <tbody>
                {filteredStagingItems.map(item=>{
                  const selectable=['Need to Order','Ready for Requisition'].includes(item.status);
                  const draggable=batchView==='active'&&selectable;
                  return <tr className={draggable?`staging-draggable-row${draggedStagingItemId===item.id?' dragging':''}`:''} key={item.id} draggable={draggable} onPointerDownCapture={event=>{dragFromInteractiveControl.current=Boolean((event.target as Element).closest('button,input,select,textarea,a,label,[contenteditable="true"]'));}} onDragStart={event=>{if(dragFromInteractiveControl.current){event.preventDefault();dragFromInteractiveControl.current=false;return;}event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',String(item.id));setDraggedStagingItemId(item.id);setDragOverBatchId(null);}} onDragEnd={()=>{dragFromInteractiveControl.current=false;setDraggedStagingItemId(null);setDragOverBatchId(null);}}>
                    <td>{batchView==='active'?<input className="table-checkbox" type="checkbox" checked={stagingSelectedIds.has(item.id)} onChange={()=>toggleStagingSelection(item.id)} disabled={!selectable} aria-label={`Select staged ${item.partNumber}`} />:'-'}</td>
                    <td><span className={`staging-priority-pill priority-${item.priority.toLowerCase()}`}>{item.priority}</span></td>
                    <td><span className={`staging-status-pill status-${item.status.toLowerCase().replace(/[^a-z]+/g,'-')}`}>{item.status}</span></td>
                    <td><strong className="staging-part-number">{item.partNumber}</strong>{item.supplierPartNumber&&<small className="staging-supplier-number">Supplier: {item.supplierPartNumber}</small>}</td>
                    <td className="inventory-description-cell">{item.description}</td><td>{formatQuantity(item.quantityRequested)}</td><td>{item.vendor}</td><td>{item.location||'-'}</td><td>{item.assetMachine||'-'}</td><td>{item.workOrderNumber||'-'}</td><td>{item.neededByDate||'-'}</td><td>{item.requestedBy||'-'}</td>
                    <td><div className="requisition-row-actions">{batchView==='active'&&canWrite&&selectable&&<button className="secondary-button compact-button" type="button" onClick={()=>openEditStaging(item)}>Edit</button>}{batchView==='active'&&canWrite&&selectable&&<button className="danger-button compact-button" type="button" onClick={()=>void removeStagingItem(item)} disabled={busyId===item.id}>Remove</button>}{batchView==='completed'&&item.createdRequisitionNumber&&<button className="secondary-button compact-button" type="button" onClick={()=>openCreatedRequisition(item.createdRequisitionNumber!)}>Open Requisition</button>}</div></td>
                  </tr>;
                })}
                {!loading&&!filteredStagingItems.length&&<tr><td colSpan={13} className="empty-table-cell">No staged items match this view.</td></tr>}
                {loading&&<tr><td colSpan={13} className="empty-table-cell">Loading Requisition Staging List...</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {filter!=='Requisition Staging'&&<section className="mcc-card requisitions-table-card">
        <div className="requisition-toolbar">
          <label className="form-field requisition-search">
            <span>Search requisitions</span>
            <input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Req #, part number, description, vendor, location, WO#..." />
          </label>
          {canDelete&&(
            <label className="show-deleted-toggle">
              <input type="checkbox" checked={showDeleted} onChange={toggleShowDeleted} />
              <span>Show Deleted</span>
            </label>
          )}
        </div>
        <div className="requisition-selection-toolbar">
          <span>Selected: {selectedRequisitions.length}</span>
          <button className="secondary-button compact-button" type="button" onClick={toggleVisibleSelection} disabled={!filteredRequisitions.length}>{allVisibleSelected?'Unselect Visible':'Select Visible'}</button>
          <button className="secondary-button compact-button" type="button" onClick={clearSelection} disabled={!selectedRequisitions.length}>Clear Selection</button>
          {canWrite&&<button className="danger-button compact-button" type="button" onClick={()=>openReasonAction('cancel',selectedCancelable)} disabled={!selectedCancelable.length}>Cancel Selected</button>}
          {canDelete&&<button className="danger-button compact-button" type="button" onClick={()=>openReasonAction('delete',selectedRequisitions)} disabled={!selectedRequisitions.length}>Delete Selected</button>}
        </div>

        <div className="table-card requisitions-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Select</th>
                <th>Req #</th>
                <th>Status</th>
                <th>Part Number</th>
                <th>Description</th>
                <th>Qty</th>
                <th>Vendor</th>
                <th>Location</th>
                <th>WO#</th>
                <th>Requested By</th>
                <th>Requested Date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRequisitions.map(requisition=>(
                <tr className={requisition.deleted?'deleted-row':''} key={requisition.id}>
                  <td>
                    <input className="table-checkbox" type="checkbox" checked={selectedIds.has(requisition.id)} onChange={()=>toggleRequisitionSelection(requisition.id)} disabled={requisition.deleted} aria-label={`Select ${requisition.requisitionNumber}`} />
                  </td>
                  <td><strong className="req-number">{requisition.requisitionNumber}</strong></td>
                  <td><span className={statusClass(requisition.status)}>{requisition.status}</span>{requisition.deleted&&<span className="deleted-chip">Deleted</span>}</td>
                  <td>{partNumberSummary(requisition)}</td>
                  <td className="inventory-description-cell"><span className="inventory-description-text" title={(requisition.descriptions ?? [requisition.description]).filter(Boolean).join(' / ') || undefined}>{descriptionSummary(requisition)}</span></td>
                  <td>{formatQuantity(Number(requisition.totalQuantity ?? requisition.quantityRequested ?? 0))}</td>
                  <td>{requisition.vendorSummary || requisition.vendorName || '-'}</td>
                  <td>{requisition.locationSummary || requisition.locationName || '-'}</td>
                  <td>{requisition.workOrderNumber || '-'}</td>
                  <td>{requisition.requestedByName || '-'}</td>
                  <td>{formatDateTime(requisition.requestedAt)}</td>
                  <td>
                    <div className="requisition-row-actions">
                      <button className="secondary-button compact-button" type="button" onClick={()=>openPreview(requisition)} disabled={busyId===requisition.id}>Preview</button>
                      <button className="secondary-button compact-button" type="button" onClick={()=>void downloadPdf(requisition)} disabled={busyId===requisition.id}>PDF</button>
                      {canWrite&&!requisition.deleted&&requisition.status==='Requested'&&<button className="secondary-button compact-button" type="button" onClick={()=>void updateStatus(requisition,'Ordered')} disabled={busyId===requisition.id}>Mark Ordered</button>}
                      {canWrite&&!requisition.deleted&&(requisition.status==='Requested'||requisition.status==='Ordered')&&<button className="secondary-button compact-button" type="button" onClick={()=>void updateStatus(requisition,'Received')} disabled={busyId===requisition.id}>Mark Received</button>}
                      {canWrite&&!requisition.deleted&&(requisition.status==='Requested'||requisition.status==='Ordered')&&<button className="danger-button compact-button" type="button" onClick={()=>openReasonAction('cancel',[requisition])} disabled={busyId===requisition.id}>Cancel</button>}
                      {canWrite&&!requisition.deleted&&requisition.status==='Requested'&&<button className="link-button compact-button" type="button" onClick={()=>openEdit(requisition)} disabled={busyId===requisition.id}>Edit</button>}
                      {canDelete&&!requisition.deleted&&<button className="danger-button compact-button" type="button" onClick={()=>deleteRequisition(requisition)} disabled={busyId===requisition.id}>Delete</button>}
                    </div>
                  </td>
                </tr>
              ))}
              {!loading&&filteredRequisitions.length===0&&<tr><td colSpan={12} className="empty-table-cell">No requisitions match this view.</td></tr>}
              {loading&&<tr><td colSpan={12} className="empty-table-cell">Loading requisitions...</td></tr>}
            </tbody>
          </table>
        </div>
      </section>}

      {movingStagingItems&&(
        <div className="modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget&&!moveSaving)setMovingStagingItems(false);}}>
          <div className="mcc-card requisition-modal staging-move-modal" role="dialog" aria-modal="true" aria-labelledby="move-staged-items-title">
            <div className="modal-heading"><div><p className="eyebrow">Requisition Staging List</p><h3 id="move-staged-items-title">Move to Batch</h3></div><button className="link-button compact-button" type="button" onClick={()=>setMovingStagingItems(false)} disabled={moveSaving}>Close</button></div>
            <p>Choose an open destination for {selectedStagingItems.length} selected item{selectedStagingItems.length===1?'':'s'}.</p>
            <div className="staging-batch-choice-grid">{requisitionBatches.filter(batch=>batch.id!==activeBatchId&&['Open','Ready'].includes(batch.status)).map(batch=><button className={batch.id===moveDestinationBatchId?'staging-batch-choice active':'staging-batch-choice'} type="button" key={batch.id} onClick={()=>setMoveDestinationBatchId(batch.id)}><strong>{batch.name}</strong><span>{batch.openItemCount} item{batch.openItemCount===1?'':'s'}</span>{(batch.assetMachine||batch.workOrderNumber)&&<small>{batch.assetMachine||'No asset'}{batch.workOrderNumber?` / WO# ${batch.workOrderNumber}`:''}</small>}</button>)}</div>
            {!requisitionBatches.some(batch=>batch.id!==activeBatchId&&['Open','Ready'].includes(batch.status))&&<p className="form-message error">Create another open Requisition Batch before moving these items.</p>}
            {moveError&&<p className="form-message error">{moveError}</p>}
            <div className="modal-actions"><button className="secondary-button" type="button" onClick={()=>setMovingStagingItems(false)} disabled={moveSaving}>Cancel</button><button className="primary-button" type="button" disabled={!moveDestinationBatchId||moveSaving} onClick={()=>{const destination=requisitionBatches.find(batch=>batch.id===moveDestinationBatchId);if(destination)void moveItemsToBatch(selectedStagingItems.map(item=>item.id),destination);}}>{moveSaving?'Moving...':'Move Selected Items'}</button></div>
          </div>
        </div>
      )}

      {batchEditing&&(
        <div className="modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget&&!stagingSaving)setBatchEditing(false);}}>
          <form className="mcc-card requisition-modal staging-editor-modal" onSubmit={saveRequisitionBatch}>
            <div className="modal-heading"><div><p className="eyebrow">Requisition Batch</p><h3>Create Requisition Batch</h3></div><button className="link-button compact-button" type="button" onClick={()=>setBatchEditing(false)}>Close</button></div>
            <div className="staging-editor-grid">
              <label className="form-field"><span>Batch Name <b className="required-marker">*</b></span><input value={batchForm.name} onChange={event=>setBatchForm({...batchForm,name:event.target.value})} autoFocus placeholder="Press 51 Repair" /></label>
              <label className="form-field"><span>Status</span><select value={batchForm.status} onChange={event=>setBatchForm({...batchForm,status:event.target.value as 'Open'|'Ready'})}><option>Open</option><option>Ready</option></select></label>
              <label className="form-field"><span>Asset / Machine</span><input value={batchForm.assetMachine} onChange={event=>setBatchForm({...batchForm,assetMachine:event.target.value})} /></label>
              <label className="form-field"><span>Work Order</span><input value={batchForm.workOrderNumber} onChange={event=>setBatchForm({...batchForm,workOrderNumber:event.target.value})} /></label>
              <MccDateInput label="Needed-by Date" value={batchForm.neededByDate} onChange={neededByDate=>setBatchForm({...batchForm,neededByDate})} />
              <label className="form-field staging-editor-wide"><span>Description / Notes</span><textarea value={batchForm.description} onChange={event=>setBatchForm({...batchForm,description:event.target.value})} /></label>
            </div>
            {batchFormError&&<p className="form-message error">{batchFormError}</p>}
            <div className="modal-actions"><button className="secondary-button" type="button" onClick={()=>setBatchEditing(false)}>Cancel</button><button className="primary-button" type="submit" disabled={stagingSaving}>{stagingSaving?'Creating...':'Create Requisition Batch'}</button></div>
          </form>
        </div>
      )}

      {stagingEditing&&(
        <div className="modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)closeStagingEditor();}}>
          <form className="mcc-card requisition-modal staging-editor-modal" onSubmit={saveStagingItem}>
            <div className="modal-heading"><div><p className="eyebrow">Requisition Staging List</p><h3>{stagingEditing==='new'?'Add staged item':`Edit ${stagingEditing.partNumber}`}</h3></div><button className="link-button compact-button" type="button" onClick={()=>closeStagingEditor()}>Close</button></div>
            <div className="staging-editor-grid">
              <label className="form-field"><span>Part Number <b className="required-marker">*</b></span><input value={stagingForm.partNumber} onChange={event=>setStagingForm({...stagingForm,partNumber:event.target.value})} /></label>
              <label className="form-field"><span>Description <b className="required-marker">*</b></span><input value={stagingForm.description} onChange={event=>setStagingForm({...stagingForm,description:event.target.value})} /></label>
              <label className="form-field"><span>Vendor <b className="required-marker">*</b></span><input value={stagingForm.vendor} onChange={event=>setStagingForm({...stagingForm,vendor:event.target.value})} /></label>
              <label className="form-field"><span>Supplier Part Number</span><input value={stagingForm.supplierPartNumber} onChange={event=>setStagingForm({...stagingForm,supplierPartNumber:event.target.value})} /></label>
              <label className="form-field"><span>Quantity Requested <b className="required-marker">*</b></span><input inputMode="decimal" value={stagingForm.quantityRequested} onFocus={event=>event.currentTarget.select()} onChange={event=>setStagingForm({...stagingForm,quantityRequested:event.target.value})} placeholder="Enter quantity" /></label>
              <label className="form-field"><span>Unit Cost</span><input inputMode="decimal" value={stagingForm.unitCost} onFocus={event=>event.currentTarget.select()} onChange={event=>setStagingForm({...stagingForm,unitCost:event.target.value})} placeholder="0.00" /></label>
              <label className="form-field"><span>Location</span><input value={stagingForm.location} onChange={event=>setStagingForm({...stagingForm,location:event.target.value})} /></label>
              <label className="form-field"><span>Asset / Machine</span><input value={stagingForm.assetMachine} onChange={event=>setStagingForm({...stagingForm,assetMachine:event.target.value})} /></label>
              <label className="form-field"><span>Work Order Number</span><input value={stagingForm.workOrderNumber} onChange={event=>setStagingForm({...stagingForm,workOrderNumber:event.target.value})} /></label>
              <label className="form-field"><span>Priority</span><select value={stagingForm.priority} onChange={event=>setStagingForm({...stagingForm,priority:event.target.value as StagingPriority})}><option>Critical</option><option>High</option><option>Normal</option><option>Low</option></select></label>
              <label className="form-field"><span>Requested By</span><input value={stagingForm.requestedBy} onChange={event=>setStagingForm({...stagingForm,requestedBy:event.target.value})} /></label>
              <MccDateInput label="Needed-by Date" value={stagingForm.neededByDate} onChange={value=>setStagingForm({...stagingForm,neededByDate:value})} />
              <label className="form-field"><span>Status</span><select value={stagingForm.status} onChange={event=>setStagingForm({...stagingForm,status:event.target.value as StagingStatus})}><option>Need to Order</option><option>Ready for Requisition</option></select></label>
              <label className="form-field staging-editor-wide"><span>Notes</span><textarea value={stagingForm.notes} onChange={event=>setStagingForm({...stagingForm,notes:event.target.value})} /></label>
            </div>
            {stagingFormError&&<p className="form-message error">{stagingFormError}</p>}
            <div className="modal-actions"><button className="secondary-button" type="button" onClick={()=>closeStagingEditor()}>Cancel</button><button className="primary-button" type="submit" disabled={stagingSaving}>{stagingSaving?'Saving...':'Save Staged Item'}</button></div>
          </form>
        </div>
      )}

      {reviewingStaging&&(
        <div className="modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget&&!stagingSaving)setReviewingStaging(false);}}>
          <form className="mcc-card requisition-modal staging-review-modal" onSubmit={generateStagingPreview}>
            <div className="modal-heading"><div><p className="eyebrow">Review before official creation</p><h3>{stagingPreviewToken?'Requisition PDF Preview':'Preview Requisition'}</h3></div><button className="link-button compact-button" type="button" onClick={()=>setReviewingStaging(false)} disabled={stagingSaving}>Close</button></div>
            {!createdFromStaging.length&&!stagingPreviewToken&&<>
              <div className="staging-review-summary"><strong>{selectedStagingItems.length} staged item{selectedStagingItems.length===1?'':'s'}</strong><span>{new Set(selectedStagingItems.map(item=>item.vendor.trim().toLowerCase())).size} vendor requisition{new Set(selectedStagingItems.map(item=>item.vendor.trim().toLowerCase())).size===1?'':'s'} will be created using the existing vendor grouping.</span></div>
              <div className="staging-review-items">{selectedStagingItems.map(item=><div key={item.id}><strong className="staging-review-part-number">{item.partNumber}</strong><span>{item.vendor}</span><span>Qty {formatQuantity(item.quantityRequested)}</span><small>{item.description}</small></div>)}</div>
              <div className="staging-editor-grid">
                <label className="form-field"><span>P.O. Initiator <b className="required-marker">*</b></span><input value={stagingReviewForm.poInitiator} onChange={event=>setStagingReviewForm({...stagingReviewForm,poInitiator:event.target.value})} /></label>
                <label className="form-field"><span>Requisitioned By <b className="required-marker">*</b></span><input value={stagingReviewForm.requisitionedByName} onChange={event=>setStagingReviewForm({...stagingReviewForm,requisitionedByName:event.target.value})} /></label>
                <label className="form-field"><span>Tax Exempt <b className="required-marker">*</b></span><select value={stagingReviewForm.taxExempt} onChange={event=>setStagingReviewForm({...stagingReviewForm,taxExempt:event.target.value as ''|'No'|'Yes'})}><option value="">Select...</option><option>No</option><option>Yes</option></select></label>
                <label className="form-field"><span>Work Order Number</span><input value={stagingReviewForm.workOrderNumber} onChange={event=>setStagingReviewForm({...stagingReviewForm,workOrderNumber:event.target.value})} /></label>
                <label className="form-field"><span>Confirmed With</span><input value={stagingReviewForm.confirmedWith} onChange={event=>setStagingReviewForm({...stagingReviewForm,confirmedWith:event.target.value})} /></label>
                <label className="form-field"><span>Material Cert</span><select value={stagingReviewForm.materialCert} onChange={event=>setStagingReviewForm({...stagingReviewForm,materialCert:event.target.value as 'No'|'Yes'})}><option>No</option><option>Yes</option></select></label>
                <label className="form-field"><span>Ship Via</span><input value={stagingReviewForm.shipVia} onChange={event=>setStagingReviewForm({...stagingReviewForm,shipVia:event.target.value})} /></label>
                <label className="form-field"><span>FOB</span><select value={stagingReviewForm.fob} onChange={event=>setStagingReviewForm({...stagingReviewForm,fob:event.target.value as 'Origin'|'Destination'})}><option>Destination</option><option>Origin</option></select></label>
                <label className="form-field staging-editor-wide"><span>Requisition Notes</span><textarea value={stagingReviewForm.notes} onChange={event=>setStagingReviewForm({...stagingReviewForm,notes:event.target.value})} /></label>
              </div>
            </>}
            {!createdFromStaging.length&&stagingPreviewToken&&<div className="staging-pdf-preview-stage">
              {stagingPdfPreviews.length>1&&<div className="requisition-preview-tabs" role="tablist" aria-label="Vendor requisition previews">{stagingPdfPreviews.map(preview=><button className={preview.id===activeStagingPdfPreview?.id?'active':''} key={preview.id} type="button" onClick={()=>setActiveStagingPreviewId(preview.id)}><strong>{preview.vendorName}</strong><span>{preview.lineCount} line{preview.lineCount===1?'':'s'} / {preview.total.toLocaleString(undefined,{style:'currency',currency:'USD'})}</span></button>)}</div>}
              {activeStagingPdfPreview&&<div className="staging-review-summary"><strong>{activeStagingPdfPreview.vendorName}</strong><span>{activeStagingPdfPreview.lineCount} line{activeStagingPdfPreview.lineCount===1?'':'s'} / Total {activeStagingPdfPreview.total.toLocaleString(undefined,{style:'currency',currency:'USD'})}</span></div>}
              {stagingPreviewLoading&&<div className="requisition-preview-placeholder">Generating PDF preview...</div>}
              {stagingPreviewUrl&&<iframe id="staging-requisition-preview-frame" className="requisition-preview-frame" title={`Preview ${activeStagingPdfPreview?.vendorName??'requisition'}`} src={stagingPreviewUrl} />}
            </div>}
            {createdFromStaging.length>0&&<div className="staging-created-list"><h4>Official requisitions created</h4>{createdFromStaging.map(created=><div key={created.id}><strong>{created.requisitionNumber}</strong><span>{created.vendorName} / {created.lineCount} line{created.lineCount===1?'':'s'}</span><div><button className="secondary-button compact-button" type="button" onClick={()=>openCreatedRequisition(created.requisitionNumber)}>Open Requisition</button><button className="secondary-button compact-button" type="button" onClick={()=>void downloadFile(`/api/requisitions/${created.id}/pdf`,`MCC_Requisition_${created.requisitionNumber}.pdf`)}>PDF</button></div></div>)}</div>}
            {stagingFormError&&<p className="form-message error">{stagingFormError}</p>}
            <div className="modal-actions">{createdFromStaging.length?<button className="primary-button" type="button" onClick={()=>setReviewingStaging(false)}>Done</button>:stagingPreviewToken?<><button className="secondary-button" type="button" onClick={backToStagingReview}>Back / Edit</button><button className="secondary-button" type="button" onClick={printStagingPreview} disabled={!stagingPreviewUrl}>Print Preview</button><button className="secondary-button" type="button" onClick={()=>void downloadStagingPreview()} disabled={!activeStagingPdfPreview}>Download Preview</button><button className="primary-button" type="button" onClick={()=>void createFromStaging()} disabled={stagingSaving}>{stagingSaving?'Creating...':'Confirm & Create Requisition'}</button></>:<><button className="secondary-button" type="button" onClick={()=>setReviewingStaging(false)}>Back</button><button className="primary-button" type="submit" disabled={stagingSaving}>{stagingSaving?'Generating...':'Generate PDF Preview'}</button></>}</div>
          </form>
        </div>
      )}

      {reasonAction&&(
        <div className="modal-backdrop" role="presentation" onMouseDown={event=>{ if(event.target===event.currentTarget) closeReasonAction(); }}>
          <form className="mcc-card requisition-modal reason-modal" onSubmit={submitReasonAction}>
            <div className="modal-heading">
              <div>
                <p className="eyebrow">{reasonAction.kind === 'cancel' ? 'Cancel requisition' : 'Delete requisition'}</p>
                <h3>{reasonAction.requisitions.length === 1 ? reasonAction.requisitions[0].requisitionNumber : `${reasonAction.requisitions.length} selected requisitions`}</h3>
              </div>
              <button className="link-button compact-button" type="button" onClick={()=>closeReasonAction()}>Close</button>
            </div>
            <label className="form-field">
              <span>{reasonAction.kind === 'cancel' ? 'Reason for canceling requisition' : 'Reason for deleting requisition'} <b className="required-marker" aria-label="required">*</b></span>
              <textarea value={reasonNote} onChange={event=>setReasonNote(event.target.value)} required autoFocus placeholder="Enter the business reason for this action..." />
            </label>
            <p className="form-help">This note will be written to History Logs for every affected requisition.</p>
            {reasonError&&<p className="form-message error">{reasonError}</p>}
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={()=>closeReasonAction()}>Cancel</button>
              <button className={reasonAction.kind === 'delete' ? 'danger-button' : 'primary-button'} type="submit" disabled={reasonSaving}>{reasonSaving?'Saving...':reasonAction.kind === 'delete'?'Delete / Log Reason':'Cancel / Log Reason'}</button>
            </div>
          </form>
        </div>
      )}

      {editing&&(
        <div className="modal-backdrop" role="presentation" onMouseDown={event=>{ if(event.target===event.currentTarget) closeEdit(); }}>
          <form className="mcc-card requisition-modal" onSubmit={saveEdit}>
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Edit requisition</p>
                <h3>{editing.requisitionNumber}</h3>
              </div>
              <button className="link-button compact-button" type="button" onClick={()=>closeEdit()}>Close</button>
            </div>
            <div className="inventory-form-grid">
              <label className="form-field">
                <span>Qty Requested</span>
                <input inputMode="decimal" value={editForm.quantityRequested} onChange={event=>setEditForm({...editForm,quantityRequested:event.target.value})} disabled={requisitionLineCount(editing) > 1} />
              </label>
              <label className="form-field">
                <span>WO#</span>
                <input value={editForm.workOrderNumber} onChange={event=>setEditForm({...editForm,workOrderNumber:event.target.value})} />
              </label>
              <label className="form-field inventory-form-wide">
                <span>Notes</span>
                <textarea value={editForm.notes} onChange={event=>setEditForm({...editForm,notes:event.target.value})} />
              </label>
            </div>
            {editError&&<p className="form-message error">{editError}</p>}
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={()=>closeEdit()}>Cancel</button>
              <button className="primary-button" type="submit" disabled={saving}>{saving?'Saving...':'Save Changes'}</button>
            </div>
          </form>
        </div>
      )}

      {previewing&&(
        <div className="modal-backdrop" role="presentation" onMouseDown={event=>{ if(event.target===event.currentTarget) closePreview(); }}>
          <div className="mcc-card requisition-preview-modal" role="dialog" aria-modal="true" aria-labelledby="requisition-page-preview-title">
            <div className="modal-heading">
              <div>
                <p className="eyebrow">PDF preview</p>
                <h3 id="requisition-page-preview-title">{previewing.requisitionNumber}</h3>
              </div>
              <button className="link-button compact-button" type="button" onClick={closePreview}>Close</button>
            </div>
            <div className="requisition-preview-summary">
              <strong>{previewing.vendorSummary || previewing.vendorName || 'Unknown Vendor'}</strong>
              <span>{requisitionLineCount(previewing)} line{requisitionLineCount(previewing) === 1 ? '' : 's'} / {previewing.workOrderNumber || 'No WO#'}</span>
            </div>
            {previewLoading&&<div className="requisition-preview-placeholder">Loading PDF preview...</div>}
            {previewError&&<p className="form-message error">{previewError}</p>}
            {previewUrl&&<iframe id="requisition-page-preview-frame" className="requisition-preview-frame" title={`Preview ${previewing.requisitionNumber}`} src={previewUrl} />}
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={printPreview} disabled={!previewUrl}>Print</button>
              <button className="primary-button" type="button" onClick={()=>void downloadPdf(previewing)} disabled={busyId===previewing.id}>Download PDF</button>
              <button className="link-button" type="button" onClick={closePreview}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
