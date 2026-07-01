import { type FormEvent, useEffect, useMemo, useState } from 'react';

export type PhoneType = '' | 'Mobile' | 'Work' | 'Cell' | 'Office' | 'Main' | 'Other';

export type VendorRecord = {
  id: number;
  companyName: string;
  websiteUrl: string;
  website_url?: string;
  phoneType: PhoneType;
  phoneNumber: string;
  phoneExt: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  contactName: string;
  contactTitle: string;
  contactPhoneType: PhoneType;
  contactPhoneNumber: string;
  contactPhoneExt: string;
  contactEmail: string;
  notes: string;
  isActive: boolean;
  deleted: boolean;
  status: 'Enabled' | 'Disabled' | 'Deleted';
  source?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type VendorForm = Omit<VendorRecord, 'id' | 'deleted' | 'status' | 'source' | 'createdAt' | 'updatedAt'> & { reasonNote: string };

type VendorsResponse = { ok: boolean; vendors: VendorRecord[] };
type VendorResponse = { ok: boolean; vendor: VendorRecord };
type Notice = { kind: 'success' | 'error' | 'info' | 'warning'; text: string };
type VendorImportMode = 'add-only' | 'upsert';
type VendorImportSummary = { ok?: boolean; mode?: VendorImportMode; addedCount: number; updatedCount: number; skippedCount: number; rejectedDuplicateCount: number; errorCount: number; errors: string[]; rejectedDuplicates: string[] };

const phoneTypes: PhoneType[] = ['', 'Mobile', 'Work', 'Cell', 'Office', 'Main', 'Other'];
const vendorImportRoles = new Set(['Maintenance Tech 3','Manager','Admin']);

export const blankVendorForm: VendorForm = {
  companyName: '',
  websiteUrl: '',
  website_url: '',
  phoneType: '',
  phoneNumber: '',
  phoneExt: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  postalCode: '',
  country: 'USA',
  contactName: '',
  contactTitle: '',
  contactPhoneType: '',
  contactPhoneNumber: '',
  contactPhoneExt: '',
  contactEmail: '',
  notes: '',
  isActive: true,
  reasonNote: '',
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

function compareText(left: string, right: string) {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
}

function formatPhone(type: string, number: string, ext: string) {
  const pieces = [type, number].filter(Boolean).join(' ');
  return [pieces, ext ? `ext ${ext}` : ''].filter(Boolean).join(' ');
}

function cityState(vendor: Pick<VendorRecord, 'city' | 'state'>) {
  return [vendor.city, vendor.state].filter(Boolean).join(', ');
}
function validWebsiteUrl(value: string) {
  const raw = value.trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    const localHost = host === 'localhost' || host === '[::1]' || host === '::1' || host === '0.0.0.0' || host.startsWith('127.') || host.endsWith('.local');
    return (url.protocol === 'http:' || url.protocol === 'https:') && !localHost ? url.toString() : '';
  } catch {
    return '';
  }
}
function vendorWebsite(vendor: Pick<VendorRecord, 'websiteUrl' | 'website_url'>) {
  return validWebsiteUrl(vendor.websiteUrl || vendor.website_url || '');
}
function vendorWebsiteHost(url: string) {
  try { return new URL(url).hostname.replace(/^www\./i,''); } catch { return ''; }
}
function vendorFaviconUrl(url: string) {
  try { return `${new URL(url).origin}/favicon.ico`; } catch { return ''; }
}

export function vendorFormFromVendor(vendor: VendorRecord): VendorForm {
  return {
    companyName: vendor.companyName ?? '',
    websiteUrl: vendor.websiteUrl ?? vendor.website_url ?? '',
    website_url: vendor.websiteUrl ?? vendor.website_url ?? '',
    phoneType: vendor.phoneType ?? '',
    phoneNumber: vendor.phoneNumber ?? '',
    phoneExt: vendor.phoneExt ?? '',
    addressLine1: vendor.addressLine1 ?? '',
    addressLine2: vendor.addressLine2 ?? '',
    city: vendor.city ?? '',
    state: vendor.state ?? '',
    postalCode: vendor.postalCode ?? '',
    country: vendor.country || 'USA',
    contactName: vendor.contactName ?? '',
    contactTitle: vendor.contactTitle ?? '',
    contactPhoneType: vendor.contactPhoneType ?? '',
    contactPhoneNumber: vendor.contactPhoneNumber ?? '',
    contactPhoneExt: vendor.contactPhoneExt ?? '',
    contactEmail: vendor.contactEmail ?? '',
    notes: vendor.notes ?? '',
    isActive: vendor.isActive ?? true,
    reasonNote: '',
  };
}

export function vendorPayloadFromForm(form: VendorForm) {
  return {
    companyName: form.companyName.trim(),
    websiteUrl: form.websiteUrl.trim(),
    phoneType: form.phoneType,
    phoneNumber: form.phoneNumber.trim(),
    phoneExt: form.phoneExt.trim(),
    addressLine1: form.addressLine1.trim(),
    addressLine2: form.addressLine2.trim(),
    city: form.city.trim(),
    state: form.state.trim(),
    postalCode: form.postalCode.trim(),
    country: form.country.trim() || 'USA',
    contactName: form.contactName.trim(),
    contactTitle: form.contactTitle.trim(),
    contactPhoneType: form.contactPhoneType,
    contactPhoneNumber: form.contactPhoneNumber.trim(),
    contactPhoneExt: form.contactPhoneExt.trim(),
    contactEmail: form.contactEmail.trim(),
    notes: form.notes.trim(),
    isActive: form.isActive,
    reasonNote: form.reasonNote.trim(),
  };
}

export function validateVendorForm(form: VendorForm, requireDisableReason = !form.isActive) {
  if (!form.companyName.trim()) return 'Company Name is required.';
  if (form.companyName.trim().length > 120) return 'Company Name must be 120 characters or less.';
  if (form.websiteUrl.trim() && !validWebsiteUrl(form.websiteUrl.trim())) return 'Website URL must be blank or a valid http/https URL.';
  if (form.phoneExt.trim().length > 20 || form.contactPhoneExt.trim().length > 20) return 'EXT # must be 20 characters or less.';
  if (form.contactEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contactEmail.trim())) return 'Contact Email must be a valid email address.';
  if (requireDisableReason && !form.reasonNote.trim()) return 'Reason for disabling vendor is required.';
  return '';
}

function DetailRow({label,children}:{label:string;children:React.ReactNode}) {
  return (
    <div className="vendor-detail-row">
      <span>{label}</span>
      <strong>{children || '-'}</strong>
    </div>
  );
}
function VendorWebsiteLink({vendor}:{vendor:VendorRecord}) {
  const url = vendorWebsite(vendor);
  if (!url) return <span className="vendor-no-website">No website</span>;
  const host = vendorWebsiteHost(url);
  const favicon = vendorFaviconUrl(url);
  return (
    <a className="vendor-website-link" href={url} target="_blank" rel="noopener noreferrer" title={url}>
      {favicon&&<img src={favicon} alt="" onError={event=>{ event.currentTarget.style.display='none'; event.currentTarget.nextElementSibling?.classList.add('visible'); }} />}
      <span className={favicon ? 'vendor-favicon-fallback' : 'vendor-favicon-fallback visible'}>URL</span>
      <span>{host || url}</span>
    </a>
  );
}

export function VendorDetailModal({vendor,onClose,onEdit}:{vendor:VendorRecord;onClose:()=>void;onEdit?:()=>void}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={event=>{ if(event.target===event.currentTarget) onClose(); }}>
      <section className="mcc-card vendor-modal vendor-detail-modal" role="dialog" aria-modal="true" aria-label={`${vendor.companyName} vendor details`}>
        <div className="modal-heading">
          <div>
            <p className="eyebrow">Vendor details</p>
            <h3>{vendor.companyName}</h3>
          </div>
          <button className="link-button compact-button" type="button" onClick={onClose}>Close</button>
        </div>
        <div className="vendor-detail-grid">
          <DetailRow label="Website"><VendorWebsiteLink vendor={vendor} /></DetailRow>
          <DetailRow label="Company phone">{formatPhone(vendor.phoneType, vendor.phoneNumber, vendor.phoneExt)}</DetailRow>
          <DetailRow label="Address">{[vendor.addressLine1, vendor.addressLine2, cityState(vendor), vendor.postalCode, vendor.country].filter(Boolean).join(', ')}</DetailRow>
          <DetailRow label="Contact name">{vendor.contactName}</DetailRow>
          <DetailRow label="Contact title">{vendor.contactTitle}</DetailRow>
          <DetailRow label="Contact phone">{formatPhone(vendor.contactPhoneType, vendor.contactPhoneNumber, vendor.contactPhoneExt)}</DetailRow>
          <DetailRow label="Contact email">{vendor.contactEmail ? <a href={`mailto:${vendor.contactEmail}`}>{vendor.contactEmail}</a> : '-'}</DetailRow>
          <DetailRow label="Status">{vendor.status}</DetailRow>
          <DetailRow label="Notes">{vendor.notes}</DetailRow>
        </div>
        {onEdit&&(
          <div className="modal-actions">
            <button className="primary-button" type="button" onClick={onEdit}>Edit Vendor</button>
          </div>
        )}
      </section>
    </div>
  );
}

export function VendorEditorModal({mode,initial,onClose,onSave,saving=false,error=''}:{mode:'add'|'edit';initial:VendorForm;onClose:()=>void;onSave:(form:VendorForm)=>void|Promise<void>;saving?:boolean;error?:string}) {
  const [form,setForm]=useState<VendorForm>(initial);
  const [localError,setLocalError]=useState('');

  useEffect(()=>{ setForm(initial); setLocalError(''); },[initial]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const validation = validateVendorForm(form, initial.isActive && !form.isActive);
    setLocalError(validation);
    if (validation) return;
    await onSave(form);
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={event=>{ if(event.target===event.currentTarget&&!saving) onClose(); }}>
      <form className="mcc-card vendor-modal" onSubmit={submit}>
        <div className="modal-heading">
          <div>
            <p className="eyebrow">{mode === 'edit' ? 'Edit Vendor' : 'Add Vendor'}</p>
            <h3>{mode === 'edit' ? 'Edit vendor record' : 'Add vendor record'}</h3>
          </div>
          <button className="link-button compact-button" type="button" onClick={onClose} disabled={saving}>Close</button>
        </div>
        <div className="vendor-form-grid">
          <label className="form-field vendor-form-wide"><span>Company Name <b className="required-marker" aria-label="required">*</b></span><input value={form.companyName} onChange={event=>setForm({...form,companyName:event.target.value})} /></label>
          <label className="form-field vendor-form-wide"><span>Website URL</span><input value={form.websiteUrl} onChange={event=>setForm({...form,websiteUrl:event.target.value,website_url:event.target.value})} placeholder="https://www.mcmaster.com/" /></label>
          <label className="form-field"><span>Company Phone Type</span><select value={form.phoneType} onChange={event=>setForm({...form,phoneType:event.target.value as PhoneType})}>{phoneTypes.map(type=><option key={type || 'blank'} value={type}>{type || 'Select type'}</option>)}</select></label>
          <label className="form-field"><span>Company Phone #</span><input value={form.phoneNumber} onChange={event=>setForm({...form,phoneNumber:event.target.value})} /></label>
          <label className="form-field"><span>Company EXT #</span><input value={form.phoneExt} onChange={event=>setForm({...form,phoneExt:event.target.value})} /></label>
          <label className="form-field vendor-form-wide"><span>Address Line 1</span><input value={form.addressLine1} onChange={event=>setForm({...form,addressLine1:event.target.value})} /></label>
          <label className="form-field vendor-form-wide"><span>Address Line 2</span><input value={form.addressLine2} onChange={event=>setForm({...form,addressLine2:event.target.value})} /></label>
          <label className="form-field"><span>City</span><input value={form.city} onChange={event=>setForm({...form,city:event.target.value})} /></label>
          <label className="form-field"><span>State</span><input value={form.state} onChange={event=>setForm({...form,state:event.target.value})} /></label>
          <label className="form-field"><span>Postal Code</span><input value={form.postalCode} onChange={event=>setForm({...form,postalCode:event.target.value})} /></label>
          <label className="form-field"><span>Country</span><input value={form.country} onChange={event=>setForm({...form,country:event.target.value})} /></label>
          <label className="form-field"><span>Contact Name</span><input value={form.contactName} onChange={event=>setForm({...form,contactName:event.target.value})} /></label>
          <label className="form-field"><span>Contact Title</span><input value={form.contactTitle} onChange={event=>setForm({...form,contactTitle:event.target.value})} /></label>
          <label className="form-field"><span>Contact Phone Type</span><select value={form.contactPhoneType} onChange={event=>setForm({...form,contactPhoneType:event.target.value as PhoneType})}>{phoneTypes.map(type=><option key={type || 'blank'} value={type}>{type || 'Select type'}</option>)}</select></label>
          <label className="form-field"><span>Contact Phone #</span><input value={form.contactPhoneNumber} onChange={event=>setForm({...form,contactPhoneNumber:event.target.value})} /></label>
          <label className="form-field"><span>Contact EXT #</span><input value={form.contactPhoneExt} onChange={event=>setForm({...form,contactPhoneExt:event.target.value})} /></label>
          <label className="form-field"><span>Contact Email</span><input value={form.contactEmail} onChange={event=>setForm({...form,contactEmail:event.target.value})} /></label>
          <label className="form-field"><span>Vendor Status</span><select value={form.isActive ? 'enabled' : 'disabled'} onChange={event=>setForm({...form,isActive:event.target.value === 'enabled',reasonNote:event.target.value === 'enabled' ? '' : form.reasonNote})}><option value="enabled">Enabled</option><option value="disabled">Disabled</option></select></label>
          {!form.isActive&&<label className="form-field vendor-form-wide"><span>Reason for disabling vendor <b className="required-marker" aria-label="required">*</b></span><textarea value={form.reasonNote} onChange={event=>setForm({...form,reasonNote:event.target.value})} /></label>}
          <label className="form-field vendor-form-wide"><span>Notes</span><textarea value={form.notes} onChange={event=>setForm({...form,notes:event.target.value})} /></label>
        </div>
        {(localError||error)&&<p className="form-message error">{localError||error}</p>}
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="primary-button" type="submit" disabled={saving}>{saving?'Saving...':mode === 'edit' ? 'Save Vendor' : 'Add Vendor'}</button>
        </div>
      </form>
    </div>
  );
}

function VendorDuplicateWarningModal({summary,onClose}:{summary:VendorImportSummary;onClose:()=>void}) {
  const visible = summary.rejectedDuplicates.slice(0,10);
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <section className="mcc-card vendor-modal vendor-duplicate-modal">
        <div className="modal-heading">
          <div>
            <p className="eyebrow">Vendor Import</p>
            <h3>Duplicate vendors rejected</h3>
          </div>
        </div>
        <div className="vendor-import-counts">
          <span>Added: {summary.addedCount}</span>
          <span>Updated: {summary.updatedCount}</span>
          <span>Rejected: {summary.rejectedDuplicateCount}</span>
          <span>Skipped: {summary.skippedCount}</span>
        </div>
        <ul className="vendor-duplicate-list">{visible.map((item,index)=><li key={`${item}-${index}`}>{item}</li>)}{summary.rejectedDuplicateCount>10&&<li>Showing first 10 of {summary.rejectedDuplicateCount} rejected duplicates.</li>}</ul>
        <div className="modal-actions"><button className="primary-button" type="button" onClick={onClose}>OK</button></div>
      </section>
    </div>
  );
}

function vendorImportCompleteMessage(summary: VendorImportSummary) {
  return `Vendor import complete: ${summary.addedCount} added, ${summary.updatedCount} updated, ${summary.rejectedDuplicateCount} rejected duplicates, ${summary.skippedCount} skipped.`;
}

export function VendorsPage({userRole=''}:{userRole?:string}) {
  const [vendors,setVendors]=useState<VendorRecord[]>([]);
  const [search,setSearch]=useState('');
  const [loading,setLoading]=useState(true);
  const [notice,setNotice]=useState<Notice|null>(null);
  const [detailVendor,setDetailVendor]=useState<VendorRecord|null>(null);
  const [editingVendor,setEditingVendor]=useState<VendorRecord|null>(null);
  const [adding,setAdding]=useState(false);
  const [showDeleted,setShowDeleted]=useState(false);
  const [saving,setSaving]=useState(false);
  const [formError,setFormError]=useState('');
  const [toolsOpen,setToolsOpen]=useState(false);
  const [toolsBusy,setToolsBusy]=useState('');
  const [vendorImportFile,setVendorImportFile]=useState<File|null>(null);
  const [vendorImportMode,setVendorImportMode]=useState<VendorImportMode>('upsert');
  const [vendorImportSummary,setVendorImportSummary]=useState<VendorImportSummary|null>(null);
  const [duplicateWarning,setDuplicateWarning]=useState<VendorImportSummary|null>(null);

  async function loadVendors(nextSearch = search) {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (nextSearch.trim()) params.set('q', nextSearch.trim());
      if (showDeleted) params.set('includeDeleted', '1');
      const data = await api<VendorsResponse>(`/api/vendors${params.toString() ? `?${params}` : ''}`);
      setVendors(data.vendors ?? []);
    } catch (err) {
      setNotice({kind:'error',text:(err as Error).message});
    } finally {
      setLoading(false);
    }
  }

  useEffect(()=>{ void loadVendors(''); },[showDeleted]);

  const sortedVendors = useMemo(()=>[...vendors].sort((left,right)=>compareText(left.companyName,right.companyName)),[vendors]);
  const editorInitial = editingVendor ? vendorFormFromVendor(editingVendor) : blankVendorForm;
  const canImport = vendorImportRoles.has(userRole);

  async function saveVendor(form: VendorForm) {
    setSaving(true);
    setFormError('');
    try {
      const payload = JSON.stringify(vendorPayloadFromForm(form));
      const data = await api<VendorResponse>(editingVendor ? `/api/vendors/${editingVendor.id}` : '/api/vendors', {
        method: editingVendor ? 'PUT' : 'POST',
        body: payload,
      });
      setAdding(false);
      setEditingVendor(null);
      setDetailVendor(data.vendor ?? null);
      setNotice({kind:'success',text:`Vendor saved: ${data.vendor?.companyName ?? form.companyName}`});
      await loadVendors(search);
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteVendor(vendor: VendorRecord) {
    const reasonNote = window.prompt(`Delete ${vendor.companyName}? Enter a reason note.`);
    if (!reasonNote?.trim()) return;
    try {
      await api(`/api/vendors/${vendor.id}`, {method:'DELETE',body:JSON.stringify({reasonNote})});
      if (detailVendor?.id === vendor.id) setDetailVendor(null);
      setNotice({kind:'success',text:`Vendor deleted: ${vendor.companyName}`});
      await loadVendors(search);
    } catch (err) {
      setNotice({kind:'error',text:(err as Error).message});
    }
  }

  async function downloadFile(path:string, fallbackFileName:string) {
    const res = await fetch(path,{credentials:'include'});
    if(!res.ok) {
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

  async function runVendorDownload(endpoint:string, fallbackFileName:string, successText:string) {
    if (toolsBusy) return;
    setToolsBusy(endpoint);
    try {
      await downloadFile(endpoint,fallbackFileName);
      setNotice({kind:'success',text:successText});
    } catch (err) {
      setNotice({kind:'error',text:(err as Error).message});
    } finally {
      setToolsBusy('');
    }
  }

  function showImportCompletion(summary: VendorImportSummary) {
    setNotice({kind: summary.addedCount + summary.updatedCount > 0 ? 'success' : 'warning', text: vendorImportCompleteMessage(summary)});
  }

  async function importVendorFile() {
    if (!canImport || toolsBusy || !vendorImportFile) return;
    setToolsBusy('vendor-import');
    setVendorImportSummary(null);
    setDuplicateWarning(null);
    try {
      const formData = new FormData();
      formData.append('file', vendorImportFile);
      formData.append('mode', vendorImportMode);
      const result = await apiForm<VendorImportSummary>('/api/vendors/import',formData);
      setVendorImportSummary(result);
      setVendorImportFile(null);
      await loadVendors(search);
      if (result.rejectedDuplicateCount > 0) setDuplicateWarning(result);
      else showImportCompletion(result);
    } catch (err) {
      setNotice({kind:'error',text:(err as Error).message});
    } finally {
      setToolsBusy('');
    }
  }

  function acknowledgeDuplicateWarning() {
    if (duplicateWarning) showImportCompletion(duplicateWarning);
    setDuplicateWarning(null);
  }

  return (
    <div className="page-stack vendors-page">
      <div className="page-heading">
        <p className="eyebrow">Vendors</p>
        <h2>Vendors</h2>
        <p>Manage vendor companies, contacts, phone numbers, and addresses used by MCC inventory and requisitions.</p>
      </div>

      {notice&&<div className={`inventory-toast ${notice.kind === 'error' ? 'error' : ''}`}><span>{notice.text}</span><button className="link-button compact-button" type="button" onClick={()=>setNotice(null)}>Dismiss</button></div>}

      <section className="mcc-card vendors-toolbar-card">
        <label className="form-field vendors-search"><span>Search vendors</span><input value={search} onChange={event=>setSearch(event.target.value)} onKeyDown={event=>{ if(event.key === 'Enter') void loadVendors(search); }} placeholder="Company, contact, phone, email, address..." /></label>
        <div className="vendors-toolbar-actions">
          <button className="secondary-button" type="button" onClick={()=>loadVendors(search)} disabled={loading}>{loading?'Searching...':'Search'}</button>
          <button className="link-button" type="button" onClick={()=>{ setSearch(''); void loadVendors(''); }}>Clear</button>
          <label className="show-deleted-toggle vendor-deleted-toggle"><input type="checkbox" checked={showDeleted} onChange={event=>setShowDeleted(event.target.checked)} /> Show Deleted</label>
          <button className={toolsOpen?'secondary-button active':'secondary-button'} type="button" onClick={()=>setToolsOpen(current=>!current)} aria-expanded={toolsOpen} aria-controls="vendor-tools-panel">Tools</button>
          <button className="primary-button" type="button" onClick={()=>{ setAdding(true); setEditingVendor(null); setFormError(''); }}>Add Vendor</button>
        </div>
      </section>

      {toolsOpen&&(
        <section className="mcc-card vendor-tools-panel" id="vendor-tools-panel">
          <div className="vendor-tool-group">
            <strong>Vendor import / export</strong>
            <div className="vendor-tool-actions">
              <button className="secondary-button compact-button" type="button" onClick={()=>void runVendorDownload('/api/vendors/export/csv',`MCC_Vendors_Export_${new Date().toISOString().slice(0,10)}.csv`,'Vendor CSV export downloaded.')} disabled={Boolean(toolsBusy)}>Export CSV</button>
              <button className="secondary-button compact-button" type="button" onClick={()=>void runVendorDownload('/api/vendors/export/excel-update-template',`MCC_Vendors_Update_Template_${new Date().toISOString().slice(0,10)}.xlsx`,'Vendor Excel update template downloaded.')} disabled={Boolean(toolsBusy)}>Export Excel Update Template</button>
              <button className="secondary-button compact-button" type="button" onClick={()=>void runVendorDownload('/api/vendors/export/blank-import-template','MCC_Vendors_Blank_Import_Template.xlsx','Vendor blank import template downloaded.')} disabled={Boolean(toolsBusy)}>Export Blank Import Template</button>
            </div>
          </div>
          <div className="vendor-import-controls">
            <label className="form-field"><span>Import mode</span><select value={vendorImportMode} disabled={!canImport || Boolean(toolsBusy)} onChange={event=>setVendorImportMode(event.target.value as VendorImportMode)}><option value="upsert">Update existing / upsert</option><option value="add-only">Add new only</option></select></label>
            <label className="form-field vendor-import-file"><span>Import CSV / Excel</span><input type="file" accept=".csv,.xlsx" disabled={!canImport || Boolean(toolsBusy)} onChange={event=>setVendorImportFile(event.target.files?.[0] ?? null)} /></label>
            <button className="primary-button compact-button" type="button" onClick={()=>void importVendorFile()} disabled={!canImport || Boolean(toolsBusy) || !vendorImportFile}>{toolsBusy==='vendor-import'?'Importing...':'Import File'}</button>
            {!canImport&&<p className="form-message vendor-tool-note">Vendor import requires Tier 3 or higher.</p>}
          </div>
          {vendorImportSummary&&<div className={vendorImportSummary.addedCount + vendorImportSummary.updatedCount > 0 ? 'inventory-tool-summary' : 'inventory-tool-summary warning'}><strong>{vendorImportSummary.addedCount} added / {vendorImportSummary.updatedCount} updated / {vendorImportSummary.rejectedDuplicateCount} rejected duplicates / {vendorImportSummary.skippedCount} skipped</strong><span>Mode: {vendorImportSummary.mode === 'add-only' ? 'Add new only' : 'Update existing / upsert'}</span>{vendorImportSummary.errors.length>0&&<ul>{vendorImportSummary.errors.slice(0,5).map((item,index)=><li key={`${item}-${index}`}>{item}</li>)}</ul>}</div>}
        </section>
      )}

      <section className="vendor-card-grid" aria-busy={loading}>
        {sortedVendors.map(vendor=>(
          <article className="mcc-card vendor-card" key={vendor.id}>
            <div className="vendor-card-head">
              <button className="vendor-list-name-button" type="button" onClick={()=>setDetailVendor(vendor)}>{vendor.companyName}</button>
              <span className={vendor.deleted ? 'status-pill disabled vendor-status-deleted' : vendor.isActive ? 'status-pill vendor-status-enabled' : 'status-pill disabled vendor-status-disabled'}>{vendor.status}</span>
            </div>
            <VendorWebsiteLink vendor={vendor} />
            <div className="vendor-card-gridlet">
              <div><span>Main Phone</span><strong>{formatPhone(vendor.phoneType, vendor.phoneNumber, vendor.phoneExt) || '-'}</strong></div>
              <div><span>Contact</span><strong>{vendor.contactName || '-'}</strong></div>
              <div><span>Email</span><strong>{vendor.contactEmail ? <a href={`mailto:${vendor.contactEmail}`}>{vendor.contactEmail}</a> : '-'}</strong></div>
              <div><span>City / State</span><strong>{cityState(vendor) || '-'}</strong></div>
            </div>
            <div className="vendor-card-actions">
              <button className="secondary-button compact-button" type="button" onClick={()=>setDetailVendor(vendor)}>View</button>
              <button className="secondary-button compact-button" type="button" onClick={()=>{ setEditingVendor(vendor); setAdding(false); setFormError(''); }}>Edit</button>
              <button className="danger-button compact-button" type="button" onClick={()=>deleteVendor(vendor)}>Delete</button>
            </div>
          </article>
        ))}
        {!loading&&!sortedVendors.length&&<section className="mcc-card vendor-empty-card"><strong>No vendors found.</strong><p>Add a vendor or import the vendor template.</p></section>}
        {loading&&<section className="mcc-card vendor-empty-card"><strong>Loading vendors...</strong></section>}
      </section>

      {detailVendor&&<VendorDetailModal vendor={detailVendor} onClose={()=>setDetailVendor(null)} onEdit={()=>{ setEditingVendor(detailVendor); setDetailVendor(null); setFormError(''); }} />}
      {(adding||editingVendor)&&<VendorEditorModal mode={editingVendor ? 'edit' : 'add'} initial={editorInitial} onClose={()=>{ if(!saving){ setAdding(false); setEditingVendor(null); setFormError(''); } }} onSave={saveVendor} saving={saving} error={formError} />}
      {duplicateWarning&&<VendorDuplicateWarningModal summary={duplicateWarning} onClose={acknowledgeDuplicateWarning} />}
    </div>
  );
}
