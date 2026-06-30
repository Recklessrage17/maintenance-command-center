import { type MouseEvent, useEffect, useMemo, useState } from 'react';

export type HistorySection = 'inventory' | 'requisitions' | 'machine_library' | 'equipment_library' | 'facility_info' | 'preventive_maintenance' | 'settings';

type HistorySummary = {
  section: HistorySection;
  sectionLabel: string;
  count: number;
  latestCreatedAt: string | null;
};

type HistoryRecord = {
  id: number;
  section: HistorySection;
  sectionLabel: string;
  action: string;
  entityType: string;
  entityId: string;
  entityLabel: string;
  workOrderNumber: string;
  partNumber: string;
  requisitionNumber: string;
  assetId: string;
  machineName: string;
  equipmentName: string;
  quantityBefore: number | null;
  quantityAfter: number | null;
  quantityDelta: number | null;
  reasonNote: string;
  userName: string;
  userEmail: string;
  createdAt: string;
};

type HistoryFilters = {
  q: string;
  action: string;
  user: string;
  startDate: string;
  endDate: string;
  workOrderNumber: string;
  partNumber: string;
  requisitionNumber: string;
  assetId: string;
};

type HistoryResponse = {
  ok: boolean;
  records: HistoryRecord[];
  total: number;
  page: number;
  pageSize: number;
};

const sectionCards: Array<{ section: HistorySection; label: string; description: string }> = [
  { section: 'inventory', label: 'Inventory', description: 'Parts, quantities, stock changes, and inventory edits.' },
  { section: 'requisitions', label: 'Requisitions', description: 'Drafts, pass/create, status changes, cancel/delete notes, and PDFs.' },
  { section: 'machine_library', label: 'Machine Library', description: 'Machine records, assets, PM activity, and future removals.' },
  { section: 'equipment_library', label: 'Equipment Library', description: 'Equipment records, assets, PM activity, and future removals.' },
  { section: 'facility_info', label: 'Facility Info', description: 'Facility documents, utility references, and future facility PM activity.' },
  { section: 'preventive_maintenance', label: 'Preventive Maintenance', description: 'Prepared for PM completion and deletion records.' },
  { section: 'settings', label: 'Settings / System', description: 'Branding, Owner Admin reset records, and system settings activity.' },
];

const emptyFilters: HistoryFilters = { q: '', action: '', user: '', startDate: '', endDate: '', workOrderNumber: '', partNumber: '', requisitionNumber: '', assetId: '' };
const exportRoles = new Set(['Admin','Manager','Maintenance Tech 3']);

export function historySectionSlug(section: HistorySection) {
  return section.replace(/_/g, '-');
}

export function historySectionFromPath(value: string): HistorySection | null {
  const normalized = value.replace(/^\/+|\/+$/g, '').split('/').pop()?.replace(/-/g, '_') ?? '';
  return sectionCards.some(card=>card.section===normalized) ? normalized as HistorySection : null;
}

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

async function downloadHistoryPdf(body: unknown, fallbackFileName: string) {
  const res = await fetch('/api/history/export/pdf', {method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if (!res.ok) {
    const data = await res.json().catch(()=>({}));
    throw new Error(data.error || 'PDF export failed.');
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

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined,{dateStyle:'short',timeStyle:'short'}).format(date);
}

function formatAction(value: string) {
  const clean = value.trim();
  const known: Record<string, string> = {
    pdf_previewed: 'PDF Previewed',
    pdf_generated: 'PDF Generated',
    preview_created: 'Preview Created',
    requisition_requested: 'Requested',
    requested: 'Requested',
    deleted: 'Deleted',
    canceled: 'Canceled',
    updated: 'Updated',
    created: 'Created',
    backup_created: 'Backup Created',
    restore_completed: 'Restore Complete',
    history_pdf_exported: 'History PDF Exported',
    branding_updated: 'Branding Updated',
    branding_reset_to_default: 'Branding Reset',
    branding_logo_uploaded: 'Branding Logo Uploaded',
    quantity_changed: 'Quantity Changed',
    duplicate_soft_deleted: 'Duplicate Removed',
    passed: 'Passed',
    ordered: 'Ordered',
    received: 'Received',
  };
  return known[clean] ?? clean.replace(/_/g, ' ').replace(/\b\w/g, letter=>letter.toUpperCase());
}

function actionTone(action: string) {
  const clean = action.toLowerCase();
  if (/(delete|deleted|cancel|canceled|failed|disable|removed)/.test(clean)) return 'danger';
  if (/(pdf|preview|export)/.test(clean)) return 'pdf';
  if (/(reset|restore|backup|system|branding)/.test(clean)) return 'system';
  if (/(create|created|add|added|request|requested|receive|received|complete|completed|pass|passed)/.test(clean)) return 'success';
  if (/(update|updated|change|changed|order|ordered)/.test(clean)) return 'info';
  return 'neutral';
}

function historyPdfUrl(record: HistoryRecord) {
  if (record.section !== 'requisitions') return '';
  if (!/(pdf|preview)/i.test(record.action)) return '';
  const id = Number(record.entityId);
  if (!Number.isInteger(id) || id <= 0) return '';
  return `/api/requisitions/${id}/pdf?preview=true`;
}

function recordLabel(record: HistoryRecord) {
  return record.entityLabel || record.requisitionNumber || record.partNumber || record.assetId || record.machineName || record.equipmentName || '-';
}

function referenceLabel(record: HistoryRecord) {
  return record.requisitionNumber || record.partNumber || record.assetId || record.machineName || record.equipmentName || '-';
}

function qtyChange(record: HistoryRecord) {
  if (record.quantityDelta === null || record.quantityDelta === undefined) return '-';
  const sign = record.quantityDelta > 0 ? '+' : '';
  return `${record.quantityBefore ?? '-'} -> ${record.quantityAfter ?? '-'} (${sign}${record.quantityDelta})`;
}

function filterParams(section: HistorySection | null, filters: HistoryFilters, page = 1, pageSize = 50) {
  const params = new URLSearchParams();
  if (section) params.set('section', section);
  Object.entries(filters).forEach(([key,value])=>{ if (value.trim()) params.set(key,value.trim()); });
  params.set('page', String(page));
  params.set('pageSize', String(pageSize));
  return params.toString();
}

export function HistoryPage({ userRole, selectedSection, onBackToLanding, onSectionChange }: { userRole: string; selectedSection: HistorySection | null; onBackToLanding: () => void; onSectionChange: (section: HistorySection) => void }) {
  const [summary,setSummary]=useState<HistorySummary[]>([]);
  const [summaryError,setSummaryError]=useState('');
  const [landingSearch,setLandingSearch]=useState('');
  const [landingResults,setLandingResults]=useState<HistoryRecord[]>([]);
  const [landingLoading,setLandingLoading]=useState(false);
  const [filters,setFilters]=useState<HistoryFilters>(emptyFilters);
  const [records,setRecords]=useState<HistoryRecord[]>([]);
  const [total,setTotal]=useState(0);
  const [page,setPage]=useState(1);
  const [loading,setLoading]=useState(false);
  const [message,setMessage]=useState<{kind:'success'|'error';text:string}|null>(null);
  const [selectedIds,setSelectedIds]=useState<Set<number>>(()=>new Set());
  const canExport = exportRoles.has(userRole);
  const sectionConfig = selectedSection ? sectionCards.find(card=>card.section===selectedSection) ?? sectionCards[0] : null;
  const totalPages = Math.max(1, Math.ceil(total / 50));
  const allVisibleSelected = records.length > 0 && records.every(record=>selectedIds.has(record.id));

  useEffect(()=>{
    api<{ok:boolean;summary:HistorySummary[]}>('/api/history/summary')
      .then(result=>setSummary(result.summary ?? []))
      .catch(error=>setSummaryError((error as Error).message));
  },[]);

  useEffect(()=>{
    if (selectedSection) return;
    const search = landingSearch.trim();
    if (!search) {
      setLandingResults([]);
      return;
    }
    let disposed = false;
    setLandingLoading(true);
    api<HistoryResponse>(`/api/history?${filterParams(null,{...emptyFilters,q:search},1,12)}`)
      .then(result=>{ if (!disposed) setLandingResults(result.records ?? []); })
      .catch(error=>{ if (!disposed) setMessage({kind:'error',text:(error as Error).message}); })
      .finally(()=>{ if (!disposed) setLandingLoading(false); });
    return ()=>{ disposed = true; };
  },[landingSearch,selectedSection]);

  useEffect(()=>{
    if (!selectedSection) return;
    let disposed = false;
    setLoading(true);
    setMessage(null);
    api<HistoryResponse>(`/api/history?${filterParams(selectedSection,filters,page,50)}`)
      .then(result=>{
        if (disposed) return;
        setRecords(result.records ?? []);
        setTotal(result.total ?? 0);
      })
      .catch(error=>{ if (!disposed) setMessage({kind:'error',text:(error as Error).message}); })
      .finally(()=>{ if (!disposed) setLoading(false); });
    return ()=>{ disposed = true; };
  },[filters,page,selectedSection]);

  useEffect(()=>{
    setSelectedIds(new Set());
    setPage(1);
    setFilters(emptyFilters);
  },[selectedSection]);

  const summaryBySection = useMemo(()=>new Map(summary.map(row=>[row.section,row])),[summary]);

  function updateFilter(key: keyof HistoryFilters, value: string) {
    setFilters(current=>({...current,[key]:value}));
    setPage(1);
  }

  function toggleRecord(id: number) {
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
      if (allVisibleSelected) records.forEach(record=>next.delete(record.id));
      else records.forEach(record=>next.add(record.id));
      return next;
    });
  }

  async function exportPdf(selectedOnly: boolean) {
    if (!selectedSection || !canExport) return;
    try {
      const selected = [...selectedIds];
      await downloadHistoryPdf({
        section: selectedSection,
        selectedIds: selectedOnly ? selected : [],
        filters: selectedOnly ? {} : filters,
      }, `MCC_${sectionConfig?.label ?? 'History'}_History.pdf`);
      setMessage({kind:'success',text:selectedOnly ? 'Selected history PDF exported.' : 'Filtered history PDF exported.'});
    } catch (error) {
      setMessage({kind:'error',text:(error as Error).message});
    }
  }

  function openHistoryPdf(record: HistoryRecord, event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    const url = historyPdfUrl(record);
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function renderActionBadge(record: HistoryRecord) {
    const label = formatAction(record.action);
    const tone = actionTone(record.action);
    const pdfUrl = historyPdfUrl(record);
    const className = `history-action-chip action-${tone}${pdfUrl ? ' clickable' : ''}`;
    if (pdfUrl) {
      const showPdfMark = !label.toUpperCase().startsWith('PDF ');
      return (
        <button className={className} type="button" onClick={event=>openHistoryPdf(record,event)} title="Open PDF preview">
          {showPdfMark&&<span className="history-action-icon" aria-hidden="true">PDF</span>}
          <span>{label}</span>
        </button>
      );
    }
    return <span className={className}>{label}</span>;
  }

  if (!selectedSection) {
    return (
      <div className="page-stack history-page">
        <div className="page-heading history-heading">
          <p className="eyebrow">MCC audit trail</p>
          <h2>History Logs</h2>
          <p>Audit-ready records for MCC activity.</p>
        </div>
        {summaryError&&<p className="form-message error">{summaryError}</p>}
        {message&&<p className={message.kind==='error'?'form-message inventory-toast error':'form-message inventory-toast'}>{message.text}</p>}
        <section className="mcc-card history-search-card">
          <label className="form-field">
            <span>Search all history</span>
            <input value={landingSearch} onChange={event=>setLandingSearch(event.target.value)} placeholder="Search Press 51, username, work order, part number, requisition number..." />
          </label>
          {landingLoading&&<p className="form-message">Searching history...</p>}
          {landingSearch.trim()&&(
            <div className="history-preview-list">
              {landingResults.map(record=>(
                <button className="history-preview-row" key={record.id} type="button" onClick={()=>onSectionChange(record.section)}>
                  <span>{record.sectionLabel}</span>
                  <strong>{recordLabel(record)}</strong>
                  <small>{formatAction(record.action)} by {record.userName || 'Unknown'} / {formatDateTime(record.createdAt)}</small>
                </button>
              ))}
              {!landingLoading&&!landingResults.length&&<p className="form-message">No matching history records yet.</p>}
            </div>
          )}
        </section>
        <div className="card-grid history-section-grid">
          {sectionCards.map(card=>{
            const item = summaryBySection.get(card.section);
            return (
              <button className="mcc-card history-section-card" key={card.section} type="button" onClick={()=>onSectionChange(card.section)}>
                <span>{card.label}</span>
                <strong>{item?.count ?? 0}</strong>
                <p>{card.description}</p>
                <small>Latest: {formatDateTime(item?.latestCreatedAt)}</small>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="page-stack history-page">
      <div className="page-heading history-heading">
        <button className="secondary-button compact-button history-back-button" type="button" onClick={onBackToLanding}>Back to History Logs</button>
        <div>
          <p className="eyebrow">History section</p>
          <h2>{sectionConfig?.label ?? 'History'} History Log</h2>
          <p>Search and export records for this MCC section only.</p>
        </div>
      </div>
      {message&&<p className={message.kind==='error'?'form-message inventory-toast error':'form-message inventory-toast'}>{message.text}</p>}
      <section className="mcc-card history-filter-card">
        <label className="form-field history-filter-wide">
          <span>Search</span>
          <input value={filters.q} onChange={event=>updateFilter('q',event.target.value)} placeholder="Search username, work order, part, requisition, machine, asset, reason..." />
        </label>
        <label className="form-field">
          <span>Start Date</span>
          <input type="date" value={filters.startDate} onChange={event=>updateFilter('startDate',event.target.value)} />
        </label>
        <label className="form-field">
          <span>End Date</span>
          <input type="date" value={filters.endDate} onChange={event=>updateFilter('endDate',event.target.value)} />
        </label>
      </section>

      <section className="mcc-card history-table-card">
        <div className="history-table-toolbar">
          <span>Selected: {selectedIds.size}</span>
          <span>{total} record{total === 1 ? '' : 's'}</span>
          <button className="secondary-button compact-button" type="button" onClick={toggleVisibleSelection} disabled={!records.length}>{allVisibleSelected?'Unselect Visible':'Select Visible'}</button>
          <button className="secondary-button compact-button" type="button" onClick={()=>setSelectedIds(new Set())} disabled={!selectedIds.size}>Clear Selection</button>
          <button className="primary-button compact-button" type="button" onClick={()=>void exportPdf(true)} disabled={!canExport||!selectedIds.size}>Export Selected PDF</button>
          <button className="primary-button compact-button" type="button" onClick={()=>void exportPdf(false)} disabled={!canExport}>Export Filtered PDF</button>
          <button className="link-button compact-button" type="button" onClick={onBackToLanding}>Back to History Logs</button>
        </div>
        {!canExport&&<p className="form-message">You can view history logs. Admin, Manager, or Maintenance Tech 3 permission is required to export PDFs.</p>}
        <div className="table-card history-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Select</th>
                <th>Date/Time</th>
                <th>Action</th>
                <th>Record</th>
                <th>User</th>
                <th>Work Order</th>
                <th>Qty Change</th>
                <th>Reason/Note</th>
              </tr>
            </thead>
            <tbody>
              {records.map(record=>(
                <tr key={record.id}>
                  <td><input className="table-checkbox" type="checkbox" checked={selectedIds.has(record.id)} onChange={()=>toggleRecord(record.id)} aria-label={`Select history ${record.id}`} /></td>
                  <td>{formatDateTime(record.createdAt)}</td>
                  <td>{renderActionBadge(record)}</td>
                  <td><strong className="history-record-label">{recordLabel(record)}</strong><span>{referenceLabel(record)}</span></td>
                  <td>{record.userName || '-'}</td>
                  <td>{record.workOrderNumber || '-'}</td>
                  <td>{qtyChange(record)}</td>
                  <td className="history-reason-cell">{record.reasonNote || '-'}</td>
                </tr>
              ))}
              {!loading&&!records.length&&<tr><td colSpan={8} className="empty-table-cell">No history records found for this section yet.</td></tr>}
              {loading&&<tr><td colSpan={8} className="empty-table-cell">Loading history records...</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="history-pagination">
          <button className="secondary-button compact-button" type="button" onClick={()=>setPage(current=>Math.max(1,current-1))} disabled={page<=1}>Prev</button>
          <span>Page {page} of {totalPages}</span>
          <button className="secondary-button compact-button" type="button" onClick={()=>setPage(current=>Math.min(totalPages,current+1))} disabled={page>=totalPages}>Next</button>
        </div>
      </section>
    </div>
  );
}
