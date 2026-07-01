import { type FormEvent, useEffect, useMemo, useState } from 'react';

export type PhoneType = '' | 'Mobile' | 'Work' | 'Cell' | 'Office' | 'Main' | 'Other';
export type ContactPhoneType = '' | 'Cell' | 'Mobile' | 'Work' | 'Office' | 'Other';

export type VendorContactRecord = {
  id?: number;
  vendorId?: number;
  contactName: string;
  contactTitle: string;
  email: string;
  phoneType: ContactPhoneType;
  phoneNumber: string;
  phoneExt: string;
  notes: string;
  isPrimary: boolean;
  deleted?: boolean;
};

type VendorContactForm = VendorContactRecord & { localId: string };

export type VendorRecord = {
  id: number;
  companyName: string;
  websiteUrl: string;
  website_url?: string;
  generalEmail: string;
  general_email?: string;
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
  contactCount?: number;
  contact_count?: number;
  primaryContact?: VendorContactRecord | null;
  contacts?: VendorContactRecord[];
  source?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type VendorForm = Omit<VendorRecord, 'id' | 'deleted' | 'status' | 'source' | 'createdAt' | 'updatedAt' | 'contactCount' | 'contact_count' | 'primaryContact' | 'contacts'> & { contacts: VendorContactForm[]; reasonNote: string };

type VendorsResponse = { ok: boolean; vendors: VendorRecord[] };
type VendorResponse = { ok: boolean; vendor: VendorRecord };
type Notice = { kind: 'success' | 'error' | 'info' | 'warning'; text: string };
type VendorImportMode = 'add-only' | 'upsert';
type VendorImportSummary = { ok?: boolean; mode?: VendorImportMode; addedCount: number; updatedCount: number; skippedCount: number; rejectedDuplicateCount: number; errorCount: number; errors: string[]; rejectedDuplicates: string[] };

const phoneTypes: PhoneType[] = ['', 'Mobile', 'Work', 'Cell', 'Office', 'Main', 'Other'];
const contactPhoneTypes: ContactPhoneType[] = ['', 'Cell', 'Mobile', 'Work', 'Office', 'Other'];
const vendorImportRoles = new Set(['Maintenance Tech 3','Manager','Admin']);
const vendorEditRoles = new Set(['Maintenance Tech 2','Maintenance Tech 3','Manager','Admin']);

export const blankVendorForm: VendorForm = {
  companyName: '',
  websiteUrl: '',
  website_url: '',
  generalEmail: '',
  general_email: '',
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
  contacts: [],
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
function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
function newContactLocalId() {
  return `contact-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function contactFormFromRecord(contact: VendorContactRecord): VendorContactForm {
  return {
    localId: contact.id ? `contact-${contact.id}` : newContactLocalId(),
    id: contact.id,
    vendorId: contact.vendorId,
    contactName: contact.contactName ?? '',
    contactTitle: contact.contactTitle ?? '',
    email: contact.email ?? '',
    phoneType: (contact.phoneType ?? '') as ContactPhoneType,
    phoneNumber: contact.phoneNumber ?? '',
    phoneExt: contact.phoneExt ?? '',
    notes: contact.notes ?? '',
    isPrimary: Boolean(contact.isPrimary),
    deleted: Boolean(contact.deleted),
  };
}
function legacyContactFromVendor(vendor: VendorRecord): VendorContactForm[] {
  const hasLegacyContact = Boolean(vendor.contactName || vendor.contactTitle || vendor.contactEmail || vendor.contactPhoneNumber || vendor.contactPhoneExt);
  if (!hasLegacyContact) return [];
  return [contactFormFromRecord({
    contactName: vendor.contactName ?? '',
    contactTitle: vendor.contactTitle ?? '',
    email: vendor.contactEmail ?? '',
    phoneType: vendor.contactPhoneType === 'Main' ? '' : (vendor.contactPhoneType as ContactPhoneType),
    phoneNumber: vendor.contactPhoneNumber ?? '',
    phoneExt: vendor.contactPhoneExt ?? '',
    notes: '',
    isPrimary: true,
  })];
}
function vendorContactsForDisplay(vendor: VendorRecord) {
  return (vendor.contacts ?? []).filter(contact=>!contact.deleted);
}
function vendorPrimaryContact(vendor: VendorRecord) {
  return vendor.primaryContact ?? vendorContactsForDisplay(vendor).find(contact=>contact.isPrimary) ?? vendorContactsForDisplay(vendor)[0] ?? null;
}
function vendorContactCount(vendor: VendorRecord) {
  return vendor.contactCount ?? vendor.contact_count ?? vendorContactsForDisplay(vendor).length;
}
function contactCountLabel(count: number) {
  return `${count} ${count === 1 ? 'contact' : 'contacts'}`;
}

export function vendorFormFromVendor(vendor: VendorRecord): VendorForm {
  const contacts = (vendor.contacts?.length ? vendor.contacts.map(contactFormFromRecord) : legacyContactFromVendor(vendor));
  return {
    companyName: vendor.companyName ?? '',
    websiteUrl: vendor.websiteUrl ?? vendor.website_url ?? '',
    website_url: vendor.websiteUrl ?? vendor.website_url ?? '',
    generalEmail: vendor.generalEmail ?? vendor.general_email ?? '',
    general_email: vendor.generalEmail ?? vendor.general_email ?? '',
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
    contacts,
    notes: vendor.notes ?? '',
    isActive: vendor.isActive ?? true,
    reasonNote: '',
  };
}

export function vendorPayloadFromForm(form: VendorForm) {
  return {
    companyName: form.companyName.trim(),
    websiteUrl: form.websiteUrl.trim(),
    generalEmail: form.generalEmail.trim(),
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
    contacts: form.contacts
      .filter(contact=>contact.deleted || contact.contactName.trim() || contact.contactTitle.trim() || contact.email.trim() || contact.phoneType || contact.phoneNumber.trim() || contact.phoneExt.trim() || contact.notes.trim())
      .map(contact=>({
        id: contact.id,
        contactName: contact.contactName.trim(),
        contactTitle: contact.contactTitle.trim(),
        email: contact.email.trim(),
        phoneType: contact.phoneType,
        phoneNumber: contact.phoneNumber.trim(),
        phoneExt: contact.phoneExt.trim(),
        notes: contact.notes.trim(),
        isPrimary: contact.isPrimary,
        deleted: Boolean(contact.deleted),
      })),
    notes: form.notes.trim(),
    isActive: form.isActive,
    reasonNote: form.reasonNote.trim(),
  };
}

export function validateVendorForm(form: VendorForm, requireDisableReason = !form.isActive) {
  if (!form.companyName.trim()) return 'Company Name is required.';
  if (form.companyName.trim().length > 120) return 'Company Name must be 120 characters or less.';
  if (form.websiteUrl.trim() && !validWebsiteUrl(form.websiteUrl.trim())) return 'Website URL must be blank or a valid http/https URL.';
  if (form.generalEmail.trim() && !validEmail(form.generalEmail.trim())) return 'General Email must be a valid email address.';
  if (form.phoneExt.trim().length > 20 || form.contactPhoneExt.trim().length > 20 || form.contacts.some(contact=>contact.phoneExt.trim().length > 20)) return 'EXT # must be 20 characters or less.';
  if (form.contactEmail.trim() && !validEmail(form.contactEmail.trim())) return 'Contact Email must be a valid email address.';
  for (const contact of form.contacts.filter(item=>!item.deleted)) {
    const hasData = contact.contactName.trim() || contact.contactTitle.trim() || contact.email.trim() || contact.phoneType || contact.phoneNumber.trim() || contact.phoneExt.trim() || contact.notes.trim();
    if (!hasData) continue;
    if (!contact.contactName.trim()) return 'Contact Name is required for each contact.';
    if (contact.email.trim() && !validEmail(contact.email.trim())) return 'Contact Email must be a valid email address.';
  }
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
  const contacts = vendorContactsForDisplay(vendor);
  const generalEmail = vendor.generalEmail ?? vendor.general_email ?? '';
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
          <DetailRow label="General email">{generalEmail ? <a href={`mailto:${generalEmail}`}>{generalEmail}</a> : '-'}</DetailRow>
          <DetailRow label="Company phone">{formatPhone(vendor.phoneType, vendor.phoneNumber, vendor.phoneExt)}</DetailRow>
          <DetailRow label="Address">{[vendor.addressLine1, vendor.addressLine2, cityState(vendor), vendor.postalCode, vendor.country].filter(Boolean).join(', ')}</DetailRow>
          <DetailRow label="Status">{vendor.status}</DetailRow>
          <DetailRow label="Notes">{vendor.notes}</DetailRow>
        </div>
        <div className="vendor-contact-detail-list">
          <div className="vendor-contact-editor-head">
            <strong>Contacts</strong>
            <span>{contactCountLabel(contacts.length)}</span>
          </div>
          {contacts.length ? contacts.map(contact=>(
            <div className="vendor-contact-detail-card" key={contact.id ?? `${contact.contactName}-${contact.email}`}>
              <strong>{contact.contactName}{contact.isPrimary ? <span>Primary</span> : null}</strong>
              <p>{[contact.contactTitle, formatPhone(contact.phoneType, contact.phoneNumber, contact.phoneExt)].filter(Boolean).join(' | ') || '-'}</p>
              <p>{contact.email ? <a href={`mailto:${contact.email}`}>{contact.email}</a> : '-'}</p>
              {contact.notes&&<small>{contact.notes}</small>}
            </div>
          )) : <p className="vendor-contact-empty">No contacts saved.</p>}
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

function VendorContactsModal({vendor,onClose,onCopyEmail,onEdit}:{vendor:VendorRecord;onClose:()=>void;onCopyEmail:(email:string)=>void;onEdit?:()=>void}) {
  const contacts = vendorContactsForDisplay(vendor);
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={event=>{ if(event.target===event.currentTarget) onClose(); }}>
      <section className="mcc-card vendor-modal vendor-contacts-modal" role="dialog" aria-modal="true" aria-label={`${vendor.companyName} vendor contacts`}>
        <div className="modal-heading">
          <div>
            <p className="eyebrow">Vendor contacts</p>
            <h3>{vendor.companyName}</h3>
          </div>
          <button className="link-button compact-button" type="button" onClick={onClose}>Close</button>
        </div>
        {contacts.length ? (
          <div className="vendor-contact-list">
            {contacts.map(contact=>(
              <article className="vendor-contact-detail-card" key={contact.id ?? `${contact.contactName}-${contact.email}`}>
                <div className="vendor-contact-row-head">
                  <strong>{contact.contactName}</strong>
                  {contact.isPrimary&&<span className="status-pill vendor-contact-primary">Primary</span>}
                </div>
                <p>{[contact.contactTitle, formatPhone(contact.phoneType, contact.phoneNumber, contact.phoneExt)].filter(Boolean).join(' | ') || '-'}</p>
                {contact.email ? <button className="vendor-copy-email-button" type="button" onClick={()=>onCopyEmail(contact.email)}>{contact.email}</button> : <p>-</p>}
                {contact.notes&&<small>{contact.notes}</small>}
              </article>
            ))}
          </div>
        ) : <p className="vendor-contact-empty">No contacts saved.</p>}
        {onEdit&&(
          <div className="modal-actions">
            <button className="primary-button" type="button" onClick={onEdit}>Edit Contacts</button>
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

  function updateContact(localId: string, patch: Partial<VendorContactForm>) {
    setForm(current=>({
      ...current,
      contacts: current.contacts.map(contact=>{
        if (contact.localId !== localId) return contact;
        const next = { ...contact, ...patch };
        if (patch.isPrimary) {
          return next;
        }
        return next;
      }).map(contact=>patch.isPrimary && contact.localId !== localId ? { ...contact, isPrimary: false } : contact),
    }));
  }

  function addContact() {
    setForm(current=>({
      ...current,
      contacts: [
        ...current.contacts,
        { localId: newContactLocalId(), contactName: '', contactTitle: '', email: '', phoneType: '', phoneNumber: '', phoneExt: '', notes: '', isPrimary: current.contacts.filter(contact=>!contact.deleted).length === 0, deleted: false },
      ],
    }));
  }

  function removeContact(localId: string) {
    setForm(current=>({
      ...current,
      contacts: current.contacts.flatMap(contact=>{
        if (contact.localId !== localId) return [contact];
        return contact.id ? [{ ...contact, deleted: true, isPrimary: false }] : [];
      }),
    }));
  }

  const activeContacts = form.contacts.filter(contact=>!contact.deleted);

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
          <label className="form-field"><span>General Email</span><input value={form.generalEmail} onChange={event=>setForm({...form,generalEmail:event.target.value,general_email:event.target.value})} /></label>
          <section className="vendor-contact-editor vendor-form-wide">
            <div className="vendor-contact-editor-head">
              <strong>Contacts</strong>
              <button className="secondary-button compact-button" type="button" onClick={addContact}>Add Contact</button>
            </div>
            {activeContacts.length ? activeContacts.map((contact,index)=>(
              <div className="vendor-contact-form-card" key={contact.localId}>
                <div className="vendor-contact-form-head">
                  <strong>{contact.contactName || `Contact ${index + 1}`}</strong>
                  <div>
                    <label className="vendor-primary-toggle"><input type="checkbox" checked={contact.isPrimary} onChange={event=>updateContact(contact.localId,{isPrimary:event.target.checked})} /> Primary</label>
                    <button className="danger-button compact-button" type="button" onClick={()=>removeContact(contact.localId)}>Remove</button>
                  </div>
                </div>
                <div className="vendor-contact-form-grid">
                  <label className="form-field"><span>Contact Name <b className="required-marker" aria-label="required">*</b></span><input value={contact.contactName} onChange={event=>updateContact(contact.localId,{contactName:event.target.value})} /></label>
                  <label className="form-field"><span>Title</span><input value={contact.contactTitle} onChange={event=>updateContact(contact.localId,{contactTitle:event.target.value})} /></label>
                  <label className="form-field"><span>Contact Email</span><input value={contact.email} onChange={event=>updateContact(contact.localId,{email:event.target.value})} /></label>
                  <label className="form-field"><span>Phone Type</span><select value={contact.phoneType} onChange={event=>updateContact(contact.localId,{phoneType:event.target.value as ContactPhoneType,phoneExt:event.target.value === 'Office' ? contact.phoneExt : ''})}>{contactPhoneTypes.map(type=><option key={type || 'blank'} value={type}>{type || 'Select type'}</option>)}</select></label>
                  <label className="form-field"><span>Phone #</span><input value={contact.phoneNumber} onChange={event=>updateContact(contact.localId,{phoneNumber:event.target.value})} /></label>
                  {(contact.phoneType === 'Office' || contact.phoneExt)&&<label className="form-field"><span>EXT #</span><input value={contact.phoneExt} onChange={event=>updateContact(contact.localId,{phoneExt:event.target.value})} /></label>}
                  <label className="form-field vendor-form-wide"><span>Contact Notes</span><textarea value={contact.notes} onChange={event=>updateContact(contact.localId,{notes:event.target.value})} /></label>
                </div>
              </div>
            )) : <p className="vendor-contact-empty">No contacts saved.</p>}
          </section>
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
  const [contactsVendor,setContactsVendor]=useState<VendorRecord|null>(null);
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
  const canEditVendors = vendorEditRoles.has(userRole);

  async function fetchVendor(vendor: VendorRecord) {
    const data = await api<VendorResponse>(`/api/vendors/${vendor.id}`);
    return data.vendor ?? vendor;
  }

  async function openVendorDetail(vendor: VendorRecord) {
    try {
      setDetailVendor(await fetchVendor(vendor));
    } catch (err) {
      setNotice({kind:'error',text:(err as Error).message});
    }
  }

  async function openVendorEditor(vendor: VendorRecord) {
    try {
      setEditingVendor(await fetchVendor(vendor));
      setAdding(false);
      setFormError('');
    } catch (err) {
      setNotice({kind:'error',text:(err as Error).message});
    }
  }

  async function openVendorContacts(vendor: VendorRecord) {
    try {
      setContactsVendor(await fetchVendor(vendor));
    } catch (err) {
      setNotice({kind:'error',text:(err as Error).message});
    }
  }

  async function copyEmail(email: string) {
    if (!email.trim()) return;
    try {
      await navigator.clipboard.writeText(email);
      setNotice({kind:'success',text:`Copied email: ${email}`});
    } catch {
      setNotice({kind:'warning',text:`Copy failed. Email: ${email}`});
    }
  }

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
      if (contactsVendor?.id === vendor.id) setContactsVendor(null);
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
        {sortedVendors.map(vendor=>{
          const count = vendorContactCount(vendor);
          const primary = vendorPrimaryContact(vendor);
          const generalEmail = vendor.generalEmail ?? vendor.general_email ?? '';
          const inactive = vendor.deleted || !vendor.isActive;
          return (
            <article className={inactive ? 'mcc-card vendor-card vendor-card-disabled' : 'mcc-card vendor-card'} key={vendor.id}>
              <div className="vendor-card-head">
                <button className="vendor-list-name-button vendor-name-glass-pill" type="button" onClick={()=>void openVendorDetail(vendor)}>{vendor.companyName}</button>
                {inactive&&<span className={vendor.deleted ? 'status-pill disabled vendor-status-deleted' : 'status-pill disabled vendor-status-disabled'}>{vendor.status}</span>}
              </div>
              {inactive&&<p className="vendor-disabled-note">Company no longer uses this vendor.</p>}
              <VendorWebsiteLink vendor={vendor} />
              <div className="vendor-card-gridlet">
                <div><span>Main Phone</span><strong>{formatPhone(vendor.phoneType, vendor.phoneNumber, vendor.phoneExt) || '-'}</strong></div>
                <button className="vendor-card-clickbox" type="button" onClick={()=>void openVendorContacts(vendor)}>
                  <span>Contacts</span>
                  <strong>{contactCountLabel(count)}</strong>
                  {primary&&<small>{primary.contactName}</small>}
                </button>
                <button className="vendor-card-clickbox" type="button" disabled={!generalEmail} onClick={()=>void copyEmail(generalEmail)}>
                  <span>General Email</span>
                  <strong>{generalEmail || '-'}</strong>
                </button>
                <div><span>City / State</span><strong>{cityState(vendor) || '-'}</strong></div>
              </div>
              <div className="vendor-card-actions">
                <button className="secondary-button compact-button" type="button" onClick={()=>void openVendorDetail(vendor)}>View</button>
                <button className="secondary-button compact-button" type="button" onClick={()=>void openVendorEditor(vendor)}>Edit</button>
                <button className="danger-button compact-button" type="button" onClick={()=>deleteVendor(vendor)}>Delete</button>
              </div>
            </article>
          );
        })}
        {!loading&&!sortedVendors.length&&<section className="mcc-card vendor-empty-card"><strong>No vendors found.</strong><p>Add a vendor or import the vendor template.</p></section>}
        {loading&&<section className="mcc-card vendor-empty-card"><strong>Loading vendors...</strong></section>}
      </section>

      {detailVendor&&<VendorDetailModal vendor={detailVendor} onClose={()=>setDetailVendor(null)} onEdit={()=>{ setEditingVendor(detailVendor); setDetailVendor(null); setFormError(''); }} />}
      {contactsVendor&&<VendorContactsModal vendor={contactsVendor} onClose={()=>setContactsVendor(null)} onCopyEmail={email=>void copyEmail(email)} onEdit={canEditVendors ? ()=>{ setEditingVendor(contactsVendor); setContactsVendor(null); setFormError(''); } : undefined} />}
      {(adding||editingVendor)&&<VendorEditorModal mode={editingVendor ? 'edit' : 'add'} initial={editorInitial} onClose={()=>{ if(!saving){ setAdding(false); setEditingVendor(null); setFormError(''); } }} onSave={saveVendor} saving={saving} error={formError} />}
      {duplicateWarning&&<VendorDuplicateWarningModal summary={duplicateWarning} onClose={acknowledgeDuplicateWarning} />}
    </div>
  );
}
