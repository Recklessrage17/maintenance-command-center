import { type FormEvent, useEffect, useMemo, useState } from 'react';

export type PhoneType = '' | 'Mobile' | 'Work' | 'Cell' | 'Office' | 'Main' | 'Other';

export type VendorRecord = {
  id: number;
  companyName: string;
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
type Notice = { kind: 'success' | 'error' | 'info'; text: string };

const phoneTypes: PhoneType[] = ['', 'Mobile', 'Work', 'Cell', 'Office', 'Main', 'Other'];

export const blankVendorForm: VendorForm = {
  companyName: '',
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

export function vendorFormFromVendor(vendor: VendorRecord): VendorForm {
  return {
    companyName: vendor.companyName ?? '',
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

export function VendorsPage() {
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
          <button className="primary-button" type="button" onClick={()=>{ setAdding(true); setEditingVendor(null); setFormError(''); }}>Add Vendor</button>
        </div>
      </section>

      <section className="mcc-card vendors-table-card">
        <div className="table-card vendors-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Company Name</th>
                <th>Main Phone</th>
                <th>Contact Name</th>
                <th>Contact Title</th>
                <th>Contact Phone</th>
                <th>Email</th>
                <th>City/State</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedVendors.map(vendor=>(
                <tr key={vendor.id}>
                  <td><button className="vendor-list-name-button" type="button" onClick={()=>setDetailVendor(vendor)}>{vendor.companyName}</button></td>
                  <td>{formatPhone(vendor.phoneType, vendor.phoneNumber, vendor.phoneExt) || '-'}</td>
                  <td>{vendor.contactName || '-'}</td>
                  <td>{vendor.contactTitle || '-'}</td>
                  <td>{formatPhone(vendor.contactPhoneType, vendor.contactPhoneNumber, vendor.contactPhoneExt) || '-'}</td>
                  <td>{vendor.contactEmail ? <a href={`mailto:${vendor.contactEmail}`}>{vendor.contactEmail}</a> : '-'}</td>
                  <td>{cityState(vendor) || '-'}</td>
                  <td><span className={vendor.deleted ? 'status-pill disabled vendor-status-deleted' : vendor.isActive ? 'status-pill vendor-status-enabled' : 'status-pill disabled vendor-status-disabled'}>{vendor.status}</span></td>
                  <td>
                    <div className="inventory-row-actions vendors-row-actions">
                      <button className="secondary-button compact-button" type="button" onClick={()=>setDetailVendor(vendor)}>View</button>
                      <button className="secondary-button compact-button" type="button" onClick={()=>{ setEditingVendor(vendor); setAdding(false); setFormError(''); }}>Edit</button>
                      <button className="danger-button compact-button" type="button" onClick={()=>deleteVendor(vendor)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading&&!sortedVendors.length&&<tr><td colSpan={9} className="empty-table-cell">No vendors found.</td></tr>}
              {loading&&<tr><td colSpan={9} className="empty-table-cell">Loading vendors...</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {detailVendor&&<VendorDetailModal vendor={detailVendor} onClose={()=>setDetailVendor(null)} onEdit={()=>{ setEditingVendor(detailVendor); setDetailVendor(null); setFormError(''); }} />}
      {(adding||editingVendor)&&<VendorEditorModal mode={editingVendor ? 'edit' : 'add'} initial={editorInitial} onClose={()=>{ if(!saving){ setAdding(false); setEditingVendor(null); setFormError(''); } }} onSave={saveVendor} saving={saving} error={formError} />}
    </div>
  );
}
