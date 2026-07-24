import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { MccContactPill, MccLinkPill, MccMetricPill, MccPillCard, MccStatusPill, type MccSemanticVariant } from '../../components/MccPills';
import { hasPermission } from '../../permissions';
import {
  canonicalCountryValue,
  canonicalUsStateValue,
  ContactAccordion,
  CountrySelect,
  formatPhoneForCountry,
  isUnitedStatesCountry,
  PhoneInput,
  phoneValidationMessage,
  StateProvinceSelect,
} from './VendorFormControls';

export type PhoneType = '' | 'Mobile' | 'Work' | 'Cell' | 'Office' | 'Main' | 'Other';
export type VendorContactPhoneType = '' | 'Cell' | 'Mobile' | 'Work' | 'Office' | 'Other';

export type VendorContactRecord = {
  id?: number;
  vendorId?: number;
  contactName: string;
  contactTitle: string;
  email: string;
  phoneType: VendorContactPhoneType;
  phoneNumber: string;
  phoneNormalized?: string;
  phoneExt: string;
  notes: string;
  isPrimary: boolean;
  deleted?: boolean;
};

export type VendorRecord = {
  id: number;
  companyName: string;
  phoneType: PhoneType;
  phoneNumber: string;
  phoneNormalized?: string;
  phoneExt: string;
  websiteUrl: string;
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
  contactCount: number;
  primaryContactName?: string;
  primaryContactEmail?: string;
  contacts?: VendorContactRecord[];
};

export type VendorForm = Omit<VendorRecord, 'id' | 'deleted' | 'status' | 'source' | 'createdAt' | 'updatedAt' | 'contactCount' | 'primaryContactName' | 'primaryContactEmail' | 'contacts'> & { reasonNote: string; contacts: VendorContactRecord[] };

type VendorsResponse = { ok: boolean; vendors: VendorRecord[] };
type VendorResponse = { ok: boolean; vendor: VendorRecord };
type VendorContactsResponse = { ok: boolean; vendor: VendorRecord; contacts: VendorContactRecord[] };
type Notice = { kind: 'success' | 'error' | 'info'; text: string };

const phoneTypes: PhoneType[] = ['', 'Mobile', 'Work', 'Cell', 'Office', 'Main', 'Other'];
const contactPhoneTypes: VendorContactPhoneType[] = ['', 'Cell', 'Mobile', 'Work', 'Office', 'Other'];

const blankVendorContact: VendorContactRecord = {
  contactName: '',
  contactTitle: '',
  email: '',
  phoneType: '',
  phoneNumber: '',
  phoneExt: '',
  notes: '',
  isPrimary: false,
};

export const blankVendorForm: VendorForm = {
  companyName: '',
  phoneType: '',
  phoneNumber: '',
  phoneExt: '',
  websiteUrl: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  postalCode: '',
  country: 'United States',
  contactName: '',
  contactTitle: '',
  contactPhoneType: '',
  contactPhoneNumber: '',
  contactPhoneExt: '',
  contactEmail: '',
  notes: '',
  isActive: true,
  reasonNote: '',
  contacts: [],
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

function safeWebsiteUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function websiteOrigin(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
}

function contactCountText(count: number) {
  return `${count} ${count === 1 ? 'contact' : 'contacts'}`;
}

function cleanContact(contact: VendorContactRecord): VendorContactRecord {
  return {
    id: contact.id,
    vendorId: contact.vendorId,
    contactName: contact.contactName.trim(),
    contactTitle: contact.contactTitle.trim(),
    email: contact.email.trim(),
    phoneType: contact.phoneType,
    phoneNumber: contact.phoneNumber.trim(),
    phoneExt: contact.phoneExt.trim(),
    notes: contact.notes.trim(),
    isPrimary: contact.isPrimary,
  };
}

type ContactField = 'contactName' | 'email' | 'phoneNumber' | 'phoneExt';
type ContactFieldErrors = Partial<Record<ContactField,string>>;

function contactValidationErrors(contact: VendorContactRecord, country: string): ContactFieldErrors {
  const errors: ContactFieldErrors = {};
  if (!contact.contactName.trim()) errors.contactName = 'Contact Name is required.';
  else if (contact.contactName.trim().length > 160) errors.contactName = 'Contact Name must be 160 characters or less.';
  if (contact.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email.trim())) errors.email = 'Contact Email must be a valid email address.';
  const phoneError = phoneValidationMessage(contact.phoneNumber,country,'Contact Phone Number');
  if (phoneError) errors.phoneNumber = phoneError;
  if (contact.phoneExt.trim().length > 20) errors.phoneExt = 'Contact EXT # must be 20 characters or less.';
  return errors;
}

function validateContact(contact: VendorContactRecord, country: string) {
  return Object.values(contactValidationErrors(contact,country))[0] ?? '';
}

function normalizeContactPrimary(contacts: VendorContactRecord[]) {
  let primarySeen = false;
  return contacts.map((contact,index)=>{
    const isPrimary = contact.isPrimary && !primarySeen;
    if (isPrimary) primarySeen = true;
    return {...contact,isPrimary: isPrimary || (!primarySeen && contacts.length === 1 && index === 0)};
  });
}

async function copyText(value: string) {
  const text = value.trim();
  if (!text) return false;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(textarea);
  return ok;
}

export function vendorFormFromVendor(vendor: VendorRecord): VendorForm {
  return {
    companyName: vendor.companyName ?? '',
    phoneType: vendor.phoneType ?? '',
    phoneNumber: vendor.phoneNumber ?? '',
    phoneExt: vendor.phoneExt ?? '',
    websiteUrl: vendor.websiteUrl ?? '',
    addressLine1: vendor.addressLine1 ?? '',
    addressLine2: vendor.addressLine2 ?? '',
    city: vendor.city ?? '',
    state: vendor.state ?? '',
    postalCode: vendor.postalCode ?? '',
    country: canonicalCountryValue(vendor.country || 'USA'),
    contactName: vendor.contactName ?? '',
    contactTitle: vendor.contactTitle ?? '',
    contactPhoneType: vendor.contactPhoneType ?? '',
    contactPhoneNumber: vendor.contactPhoneNumber ?? '',
    contactPhoneExt: vendor.contactPhoneExt ?? '',
    contactEmail: vendor.contactEmail ?? '',
    notes: vendor.notes ?? '',
    isActive: vendor.isActive ?? true,
    reasonNote: '',
    contacts: (vendor.contacts ?? []).filter(contact=>!contact.deleted).map(contact=>({...blankVendorContact,...contact})),
  };
}

export function vendorPayloadFromForm(form: VendorForm) {
  const contacts = normalizeContactPrimary(form.contacts.map(cleanContact).filter(contact=>contact.contactName || contact.email || contact.phoneNumber || contact.contactTitle || contact.phoneExt || contact.notes));
  return {
    companyName: form.companyName.trim(),
    phoneType: form.phoneType,
    phoneNumber: form.phoneNumber.trim(),
    phoneExt: form.phoneExt.trim(),
    websiteUrl: form.websiteUrl.trim(),
    addressLine1: form.addressLine1.trim(),
    addressLine2: form.addressLine2.trim(),
    city: form.city.trim(),
    state: isUnitedStatesCountry(form.country) ? canonicalUsStateValue(form.state) : form.state.trim(),
    postalCode: form.postalCode.trim(),
    country: canonicalCountryValue(form.country) || 'United States',
    contactName: form.contactName.trim(),
    contactTitle: form.contactTitle.trim(),
    contactPhoneType: form.contactPhoneType,
    contactPhoneNumber: form.contactPhoneNumber.trim(),
    contactPhoneExt: form.contactPhoneExt.trim(),
    contactEmail: form.contactEmail.trim(),
    notes: form.notes.trim(),
    isActive: form.isActive,
    reasonNote: form.reasonNote.trim(),
    contacts,
  };
}

export function validateVendorForm(form: VendorForm, requireDisableReason = !form.isActive) {
  return validateVendorFormDetails(form,requireDisableReason).message;
}

type VendorValidationResult = {message:string;field?:string;contactIndex?:number;contactField?:ContactField;contactErrors?:ContactFieldErrors};

function validateVendorFormDetails(form: VendorForm, requireDisableReason = !form.isActive): VendorValidationResult {
  if (!form.companyName.trim()) return {message:'Company Name is required.',field:'companyName'};
  if (form.companyName.trim().length > 120) return {message:'Company Name must be 120 characters or less.',field:'companyName'};
  const companyPhoneError = phoneValidationMessage(form.phoneNumber,form.country,'Company Phone #');
  if (companyPhoneError) return {message:companyPhoneError,field:'phoneNumber'};
  if (form.phoneExt.trim().length > 20 || form.contactPhoneExt.trim().length > 20) return {message:'EXT # must be 20 characters or less.',field:'phoneExt'};
  if (form.websiteUrl.trim() && !safeWebsiteUrl(form.websiteUrl)) return {message:'Website URL must start with http:// or https://.',field:'websiteUrl'};
  if (form.contactEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contactEmail.trim())) return {message:'General Email must be a valid email address.',field:'contactEmail'};
  for (let index=0; index<form.contacts.length; index+=1) {
    const contact = form.contacts[index];
    const hasAnyValue = Boolean(contact.contactName.trim() || contact.email.trim() || contact.phoneNumber.trim() || contact.contactTitle.trim() || contact.phoneExt.trim() || contact.notes.trim());
    if (!hasAnyValue) continue;
    const errors = contactValidationErrors(contact,form.country);
    const first = Object.entries(errors)[0] as [ContactField,string] | undefined;
    if (first) return {message:first[1],contactIndex:index,contactField:first[0],contactErrors:errors};
  }
  if (requireDisableReason && !form.reasonNote.trim()) return {message:'Reason for disabling vendor is required.',field:'reasonNote'};
  return {message:''};
}

function DetailRow({label,children}:{label:string;children:React.ReactNode}) {
  return (
    <div className="vendor-detail-row">
      <span>{label}</span>
      <strong>{children || '-'}</strong>
    </div>
  );
}

function VendorWebsiteLink({websiteUrl,compact=false}:{websiteUrl:string;compact?:boolean}) {
  const safeUrl = safeWebsiteUrl(websiteUrl);
  const [faviconFailed,setFaviconFailed]=useState(false);
  if (!safeUrl) return null;
  const origin = websiteOrigin(safeUrl);
  const label = origin.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  return (
    <MccLinkPill className={`vendor-website-pill${compact ? ' compact' : ''}`} href={safeUrl} title={`Open ${label}`} ariaLabel={`Open ${label}`} leadingIcon={!faviconFailed&&origin ? (
        <img className="vendor-favicon" src={`${origin}/favicon.ico`} alt="" onError={()=>setFaviconFailed(true)} />
      ) : (
        <span className="vendor-favicon-fallback" aria-hidden="true">{label.slice(0,1).toUpperCase()}</span>
      )}>
      <span>{label || 'Website'}</span>
    </MccLinkPill>
  );
}

function EmailCopyButton({email,onCopied,compact=false}:{email:string;onCopied:(email:string)=>void;compact?:boolean}) {
  if (!email.trim()) return <span>-</span>;
  return (
    <button
      className={`email-copy-button${compact ? ' compact' : ''}`}
      type="button"
      title="Click to copy email"
      onClick={async event=>{
        event.preventDefault();
        event.stopPropagation();
        const ok = await copyText(email);
        if (ok) onCopied(email.trim());
      }}
    >
      {email}
    </button>
  );
}

function ContactEditCard({contact,index,country,expanded,onToggle,onChange,onRemove,errors={}}:{contact:VendorContactRecord;index:number;country:string;expanded:boolean;onToggle:()=>void;onChange:(contact:VendorContactRecord)=>void;onRemove:()=>void;errors?:ContactFieldErrors}) {
  return (
    <ContactAccordion expanded={expanded} onToggle={onToggle} name={contact.contactName || `Contact ${index + 1}`} title={contact.contactTitle} isPrimary={contact.isPrimary} className={Object.keys(errors).length ? 'has-errors' : ''}>
      <div className="vendor-contact-edit-grid" data-contact-index={index}>
        <label className={`form-field${errors.contactName ? ' has-error' : ''}`}><span>Contact Name <b className="required-marker" aria-label="required">*</b></span><input data-field="contactName" value={contact.contactName} onChange={event=>onChange({...contact,contactName:event.target.value})} aria-invalid={Boolean(errors.contactName)} />{errors.contactName&&<small className="field-validation-error" role="alert">{errors.contactName}</small>}</label>
        <label className="form-field"><span>Contact Title</span><input value={contact.contactTitle} onChange={event=>onChange({...contact,contactTitle:event.target.value})} /></label>
        <label className={`form-field${errors.email ? ' has-error' : ''}`}><span>Email</span><input data-field="email" type="email" value={contact.email} onChange={event=>onChange({...contact,email:event.target.value})} aria-invalid={Boolean(errors.email)} />{errors.email&&<small className="field-validation-error" role="alert">{errors.email}</small>}</label>
        <label className="form-field"><span>Phone Type</span><select value={contact.phoneType} onChange={event=>onChange({...contact,phoneType:event.target.value as VendorContactPhoneType})}>{contactPhoneTypes.map(type=><option key={type || 'blank'} value={type}>{type || 'Select type'}</option>)}</select></label>
        <PhoneInput label="Phone Number" value={contact.phoneNumber} country={country} onChange={phoneNumber=>onChange({...contact,phoneNumber})} error={errors.phoneNumber} inputProps={{'data-field':'phoneNumber'}} />
        <label className={`form-field office-ext-field${errors.phoneExt ? ' has-error' : ''}`}><span>EXT #</span><input data-field="phoneExt" value={contact.phoneExt} onChange={event=>onChange({...contact,phoneExt:event.target.value})} aria-invalid={Boolean(errors.phoneExt)} />{errors.phoneExt&&<small className="field-validation-error" role="alert">{errors.phoneExt}</small>}</label>
        <label className="form-field vendor-form-wide"><span>Notes</span><textarea value={contact.notes} onChange={event=>onChange({...contact,notes:event.target.value})} /></label>
        <div className="vendor-contact-expanded-actions vendor-form-wide">
          <label className="vendor-primary-toggle"><input type="checkbox" checked={contact.isPrimary} onChange={event=>onChange({...contact,isPrimary:event.target.checked})} /> Primary</label>
          <button className="link-button compact-button" type="button" onClick={onRemove}>Remove</button>
        </div>
      </div>
    </ContactAccordion>
  );
}

function roleRank(role: string) {
  return ['Maintenance Tech 1','Maintenance Tech 2','Maintenance Tech 3','Manager','Admin'].indexOf(role);
}

function VendorContactsModal({vendor,onClose,onVendorUpdated,onEmailCopied,canEdit,canDelete}:{vendor:VendorRecord;onClose:()=>void;onVendorUpdated:(vendor:VendorRecord)=>void;onEmailCopied:(email:string)=>void;canEdit:boolean;canDelete:boolean}) {
  const [contacts,setContacts]=useState<VendorContactRecord[]>(vendor.contacts ?? []);
  const [loading,setLoading]=useState(true);
  const [editing,setEditing]=useState<VendorContactRecord|null>(null);
  const [editingExpanded,setEditingExpanded]=useState(true);
  const [expandedContacts,setExpandedContacts]=useState<Set<number>>(()=>new Set((vendor.contacts ?? []).filter(contact=>contact.isPrimary&&contact.id!==undefined).map(contact=>contact.id!)));
  const [contactErrors,setContactErrors]=useState<ContactFieldErrors>({});
  const [error,setError]=useState('');
  const [saving,setSaving]=useState(false);

  async function loadContacts() {
    setLoading(true);
    setError('');
    try {
      const data = await api<VendorContactsResponse>(`/api/vendors/${vendor.id}/contacts`);
      setContacts(data.contacts ?? []);
      onVendorUpdated(data.vendor);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(()=>{ void loadContacts(); },[vendor.id]);

  async function saveContact(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    const validation = validateContact(editing,vendor.country);
    setContactErrors(contactValidationErrors(editing,vendor.country));
    setError(validation);
    if (validation) { setEditingExpanded(true); return; }
    setSaving(true);
    try {
      const payload = JSON.stringify(cleanContact(editing));
      const data = await api<{ok:boolean;contact:VendorContactRecord;vendor:VendorRecord}>(editing.id ? `/api/vendors/${vendor.id}/contacts/${editing.id}` : `/api/vendors/${vendor.id}/contacts`, {
        method: editing.id ? 'PUT' : 'POST',
        body: payload,
      });
      onVendorUpdated(data.vendor);
      setEditing(null);
      setContactErrors({});
      await loadContacts();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteContact(contact: VendorContactRecord) {
    if (!contact.id) return;
    const reasonNote = window.prompt(`Delete contact ${contact.contactName}? Enter a reason note.`);
    if (!reasonNote?.trim()) return;
    try {
      const data = await api<{ok:boolean;vendor:VendorRecord}>(`/api/vendors/${vendor.id}/contacts/${contact.id}`, {method:'DELETE',body:JSON.stringify({reasonNote})});
      onVendorUpdated(data.vendor);
      await loadContacts();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={event=>{ if(event.target===event.currentTarget&&!saving) onClose(); }}>
      <section className="mcc-card vendor-modal vendor-contacts-modal mcc-wide-modal" role="dialog" aria-modal="true" aria-label={`${vendor.companyName} contacts`}>
        <div className="modal-heading">
          <div>
            <p className="eyebrow">Vendor Contacts</p>
            <h3>{vendor.companyName}</h3>
          </div>
          <button className="link-button compact-button" type="button" onClick={onClose} disabled={saving}>Close</button>
        </div>
        <div className="vendor-contact-modal-header">
          <VendorWebsiteLink websiteUrl={vendor.websiteUrl} compact />
          <strong>{contactCountText(contacts.filter(contact=>!contact.deleted).length)}</strong>
        </div>
        {error&&<p className="form-message error">{error}</p>}
        {loading&&<p className="vendor-inline-empty">Loading contacts...</p>}
        {!loading&&contacts.length===0&&<p className="vendor-inline-empty">No contacts saved for this vendor.</p>}
        {!loading&&contacts.length>0&&(
          <div className="vendor-contact-list">
            {contacts.map((contact,index)=>{
              const contactKey = contact.id ?? index;
              const expanded = expandedContacts.has(contactKey);
              return <ContactAccordion key={contactKey} expanded={expanded} onToggle={()=>setExpandedContacts(current=>{const next=new Set(current);if(next.has(contactKey))next.delete(contactKey);else next.add(contactKey);return next;})} name={contact.contactName} title={contact.contactTitle} isPrimary={contact.isPrimary}>
                <div className="vendor-contact-info-grid">
                  <div><span>Email</span><strong><EmailCopyButton email={contact.email} compact onCopied={onEmailCopied} /></strong></div>
                  <div><span>Phone</span><strong>{formatPhone(contact.phoneType, contact.phoneNumber, contact.phoneExt) || '-'}</strong></div>
                  <div className="vendor-contact-notes"><span>Notes</span><strong>{contact.notes || '-'}</strong></div>
                </div>
                {(canEdit||canDelete)&&(
                  <div className="vendor-contact-actions">
                    {canEdit&&<button className="secondary-button compact-button" type="button" onClick={()=>{setEditing({...blankVendorContact,...contact});setEditingExpanded(true);setContactErrors({});}}>Edit Contact</button>}
                    {canDelete&&<button className="danger-button compact-button" type="button" onClick={()=>deleteContact(contact)}>Delete Contact</button>}
                  </div>
                )}
              </ContactAccordion>;
            })}
          </div>
        )}
        {canEdit&&(
          <div className="vendor-contact-form-shell">
            {!editing&&<button className="primary-button compact-button" type="button" onClick={()=>{setEditing({...blankVendorContact,isPrimary:contacts.length === 0});setEditingExpanded(true);setContactErrors({});}}>Add Contact</button>}
            {editing&&(
              <form className="vendor-contact-inline-form" onSubmit={saveContact}>
                <ContactEditCard contact={editing} index={Math.max(contacts.findIndex(contact=>contact.id === editing.id), 0)} country={vendor.country} expanded={editingExpanded} onToggle={()=>setEditingExpanded(value=>!value)} onChange={setEditing} onRemove={()=>{setEditing(null);setContactErrors({});}} errors={contactErrors} />
                <div className="modal-actions">
                  <button className="secondary-button" type="button" onClick={()=>{setEditing(null);setContactErrors({});}} disabled={saving}>Cancel</button>
                  <button className="primary-button" type="submit" disabled={saving}>{saving?'Saving...':'Save Contact'}</button>
                </div>
              </form>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

export function VendorDetailModal({vendor,onClose,onEdit,onEmailCopied}:{vendor:VendorRecord;onClose:()=>void;onEdit?:()=>void;onEmailCopied?:(email:string)=>void}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={event=>{ if(event.target===event.currentTarget) onClose(); }}>
      <section className="mcc-card vendor-modal vendor-detail-modal mcc-wide-modal" role="dialog" aria-modal="true" aria-label={`${vendor.companyName} vendor details`}>
        <div className="modal-heading">
          <div>
            <p className="eyebrow">Vendor details</p>
            <h3>{vendor.companyName}</h3>
          </div>
          <button className="link-button compact-button" type="button" onClick={onClose}>Close</button>
        </div>
        <div className="vendor-detail-grid">
          <DetailRow label="Company phone">{formatPhone(vendor.phoneType, vendor.phoneNumber, vendor.phoneExt)}</DetailRow>
          <DetailRow label="Website">{vendor.websiteUrl ? <VendorWebsiteLink websiteUrl={vendor.websiteUrl} compact /> : '-'}</DetailRow>
          <DetailRow label="General email">{vendor.contactEmail ? <EmailCopyButton email={vendor.contactEmail} compact onCopied={onEmailCopied ?? (()=>{})} /> : '-'}</DetailRow>
          <DetailRow label="Address">{[vendor.addressLine1, vendor.addressLine2, cityState(vendor), vendor.postalCode, vendor.country].filter(Boolean).join(', ')}</DetailRow>
          <DetailRow label="Contacts">{vendor.primaryContactName ? `${contactCountText(vendor.contactCount)} - Primary: ${vendor.primaryContactName}` : contactCountText(vendor.contactCount)}</DetailRow>
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
  const [fieldError,setFieldError]=useState<{field?:string;message?:string}>({});
  const [contactErrors,setContactErrors]=useState<Record<number,ContactFieldErrors>>({});
  const [expandedContacts,setExpandedContacts]=useState<Set<number>>(new Set());
  const formRef=useRef<HTMLFormElement>(null);

  useEffect(()=>{ setForm(initial); setLocalError(''); setFieldError({}); setContactErrors({}); setExpandedContacts(new Set()); },[initial]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const validation = validateVendorFormDetails(form, initial.isActive && !form.isActive);
    setLocalError(validation.message);
    setFieldError(validation.field ? {field:validation.field,message:validation.message} : {});
    setContactErrors(validation.contactIndex === undefined ? {} : {[validation.contactIndex]:validation.contactErrors ?? {}});
    if (validation.message) {
      if (validation.contactIndex !== undefined) setExpandedContacts(current=>new Set(current).add(validation.contactIndex!));
      queueMicrotask(()=>{
        const selector = validation.contactIndex === undefined
          ? `[data-field="${validation.field}"]`
          : `[data-contact-index="${validation.contactIndex}"] [data-field="${validation.contactField}"]`;
        const target=formRef.current?.querySelector<HTMLElement>(selector);
        target?.scrollIntoView({block:'center',behavior:'smooth'});
        target?.focus();
      });
      return;
    }
    await onSave(form);
  }

  function updateContact(index: number, contact: VendorContactRecord) {
    setForm(current=>({
      ...current,
      contacts: current.contacts.map((item,itemIndex)=>itemIndex === index ? contact : contact.isPrimary ? {...item,isPrimary:false} : item),
    }));
    setContactErrors(current=>{const next={...current};delete next[index];return next;});
  }

  function addContact() {
    setForm(current=>{
      const index=current.contacts.length;
      setExpandedContacts(expanded=>new Set(expanded).add(index));
      return {...current,contacts:[...current.contacts,{...blankVendorContact,isPrimary: current.contacts.length === 0}]};
    });
  }

  function removeContact(index: number) {
    setForm(current=>({...current,contacts:current.contacts.filter((_,itemIndex)=>itemIndex !== index)}));
    setExpandedContacts(current=>new Set([...current].filter(item=>item!==index).map(item=>item>index?item-1:item)));
    setContactErrors({});
  }

  function updateCountry(country: string) {
    const canonical=canonicalCountryValue(country) || country;
    setForm(current=>({
      ...current,
      country:canonical,
      phoneNumber:formatPhoneForCountry(current.phoneNumber,canonical),
      contacts:current.contacts.map(contact=>({...contact,phoneNumber:formatPhoneForCountry(contact.phoneNumber,canonical)})),
    }));
    setFieldError({});
    setContactErrors({});
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={event=>{ if(event.target===event.currentTarget&&!saving) onClose(); }}>
      <form ref={formRef} className="mcc-card vendor-modal mcc-wide-modal" onSubmit={submit} noValidate>
        <div className="modal-heading">
          <div>
            <p className="eyebrow">{mode === 'edit' ? 'Edit Vendor' : 'Add Vendor'}</p>
            <h3>{mode === 'edit' ? 'Edit vendor record' : 'Add vendor record'}</h3>
          </div>
          <button className="link-button compact-button" type="button" onClick={onClose} disabled={saving}>Close</button>
        </div>
        <div className="vendor-form-grid">
          <label className={`form-field vendor-form-wide${fieldError.field==='companyName'?' has-error':''}`}><span>Company Name <b className="required-marker" aria-label="required">*</b></span><input data-field="companyName" value={form.companyName} onChange={event=>setForm({...form,companyName:event.target.value})} />{fieldError.field==='companyName'&&<small className="field-validation-error" role="alert">{fieldError.message}</small>}</label>
          <label className="form-field"><span>Company Phone Type</span><select value={form.phoneType} onChange={event=>setForm({...form,phoneType:event.target.value as PhoneType})}>{phoneTypes.map(type=><option key={type || 'blank'} value={type}>{type || 'Select type'}</option>)}</select></label>
          <PhoneInput label="Company Phone #" value={form.phoneNumber} country={form.country} onChange={phoneNumber=>setForm({...form,phoneNumber})} error={fieldError.field==='phoneNumber'?fieldError.message:''} inputProps={{'data-field':'phoneNumber'}} />
          <label className={`form-field${fieldError.field==='phoneExt'?' has-error':''}`}><span>Company EXT #</span><input data-field="phoneExt" value={form.phoneExt} onChange={event=>setForm({...form,phoneExt:event.target.value})} />{fieldError.field==='phoneExt'&&<small className="field-validation-error" role="alert">{fieldError.message}</small>}</label>
          <label className={`form-field vendor-form-wide${fieldError.field==='websiteUrl'?' has-error':''}`}><span>Website URL</span><input data-field="websiteUrl" value={form.websiteUrl} onChange={event=>setForm({...form,websiteUrl:event.target.value})} placeholder="https://www.mcmaster.com/" />{fieldError.field==='websiteUrl'&&<small className="field-validation-error" role="alert">{fieldError.message}</small>}</label>
          <label className="form-field vendor-form-wide"><span>Address Line 1</span><input value={form.addressLine1} onChange={event=>setForm({...form,addressLine1:event.target.value})} /></label>
          <label className="form-field vendor-form-wide"><span>Address Line 2</span><input value={form.addressLine2} onChange={event=>setForm({...form,addressLine2:event.target.value})} /></label>
          <label className="form-field"><span>City</span><input value={form.city} onChange={event=>setForm({...form,city:event.target.value})} /></label>
          <StateProvinceSelect country={form.country} value={form.state} onChange={state=>setForm({...form,state})} />
          <label className="form-field"><span>Postal Code</span><input value={form.postalCode} onChange={event=>setForm({...form,postalCode:event.target.value})} /></label>
          <CountrySelect value={form.country} onChange={updateCountry} />
          <label className={`form-field vendor-form-wide${fieldError.field==='contactEmail'?' has-error':''}`}><span>General Email</span><input data-field="contactEmail" type="email" value={form.contactEmail} onChange={event=>setForm({...form,contactEmail:event.target.value})} placeholder="sales@example.com" />{fieldError.field==='contactEmail'&&<small className="field-validation-error" role="alert">{fieldError.message}</small>}</label>
          <div className="vendor-contacts-editor vendor-form-wide">
            <div className="vendor-section-heading">
              <div>
                <span>Contacts</span>
                <strong>{contactCountText(form.contacts.length)}</strong>
              </div>
              <button className="secondary-button compact-button" type="button" onClick={addContact}>Add Contact</button>
            </div>
            {form.contacts.length === 0&&<p className="vendor-inline-empty">No contacts saved for this vendor.</p>}
            {form.contacts.map((contact,index)=>(
              <ContactEditCard key={contact.id ?? `new-${index}`} contact={contact} index={index} country={form.country} expanded={expandedContacts.has(index)} onToggle={()=>setExpandedContacts(current=>{const next=new Set(current);if(next.has(index))next.delete(index);else next.add(index);return next;})} onChange={next=>updateContact(index,next)} onRemove={()=>removeContact(index)} errors={contactErrors[index]} />
            ))}
          </div>
          <label className="form-field"><span>Vendor Status</span><select value={form.isActive ? 'enabled' : 'disabled'} onChange={event=>setForm({...form,isActive:event.target.value === 'enabled',reasonNote:event.target.value === 'enabled' ? '' : form.reasonNote})}><option value="enabled">Enabled</option><option value="disabled">Disabled</option></select></label>
          {!form.isActive&&<label className={`form-field vendor-form-wide${fieldError.field==='reasonNote'?' has-error':''}`}><span>Reason for disabling vendor <b className="required-marker" aria-label="required">*</b></span><textarea data-field="reasonNote" value={form.reasonNote} onChange={event=>setForm({...form,reasonNote:event.target.value})} />{fieldError.field==='reasonNote'&&<small className="field-validation-error" role="alert">{fieldError.message}</small>}</label>}
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

function VendorCard({vendor,onView,onEdit,onDelete,onContacts,onEmailCopied}:{vendor:VendorRecord;onView:()=>void;onEdit:()=>void;onDelete:()=>void;onContacts:()=>void;onEmailCopied:(email:string)=>void}) {
  const statusClass = vendor.deleted ? 'vendor-status-deleted' : vendor.isActive ? 'vendor-status-enabled' : 'vendor-status-disabled';
  const mainPhone = formatPhone(vendor.phoneType, vendor.phoneNumber, vendor.phoneExt);
  const primaryContact = vendor.contacts?.find(contact=>contact.isPrimary) ?? vendor.contacts?.[0];
  const statusVariant: MccSemanticVariant = vendor.deleted ? 'danger' : vendor.isActive ? 'success' : 'warning';
  return (
    <MccPillCard className={`vendor-card${vendor.deleted ? ' deleted' : !vendor.isActive ? ' disabled' : ''}`} onActivate={onView} ariaLabel={`View ${vendor.companyName}`} accentColor={vendor.deleted?'#ff758a':!vendor.isActive?'#f6be3f':'#44d7ff'}>
      <div className="vendor-card-heading">
        <span className="vendor-pill-card-name">{vendor.companyName}</span>
        {(vendor.deleted||!vendor.isActive)&&<MccStatusPill variant={statusVariant} className={statusClass}>{vendor.status}</MccStatusPill>}
      </div>
      {vendor.deleted&&<p className="vendor-disabled-warning deleted">Vendor record deleted.</p>}
      {!vendor.deleted&&!vendor.isActive&&<p className="vendor-disabled-warning">Company no longer uses this vendor.</p>}
      {vendor.websiteUrl&&<div className="vendor-card-website-row"><VendorWebsiteLink websiteUrl={vendor.websiteUrl} /></div>}
      <div className="vendor-pill-card-metrics">
        <MccMetricPill label="Main Phone" value={mainPhone || '-'} />
        <MccMetricPill label="General Email" value={<EmailCopyButton email={vendor.contactEmail} compact onCopied={onEmailCopied} />} />
        <MccMetricPill label="City / State" value={cityState(vendor) || '-'} />
        <MccMetricPill label="Country" value={vendor.country || '-'} />
      </div>
      <button className="vendor-contact-summary-button" type="button" onClick={onContacts} title="Open vendor contacts">
        <span className="vendor-primary-contact-line">
          <MccContactPill className="vendor-primary-contact-name">{vendor.primaryContactName || 'No primary contact'}</MccContactPill>
          <span className="vendor-primary-contact-label">Primary Contact</span>
          <MccStatusPill variant="neutral" className="vendor-contact-count-badge">{contactCountText(vendor.contactCount)}</MccStatusPill>
        </span>
        {primaryContact?.contactTitle&&<small className="vendor-primary-contact-title">{primaryContact.contactTitle}</small>}
      </button>
      <div className="vendor-card-actions">
        <button className="secondary-button compact-button" type="button" onClick={onView}>View</button>
        <button className="secondary-button compact-button" type="button" onClick={onEdit}>Edit</button>
        <button className="danger-button compact-button" type="button" onClick={onDelete} disabled={vendor.deleted}>Delete</button>
      </div>
    </MccPillCard>
  );
}

export function VendorsPage({userRole='',effectivePermissions}:{userRole?:string;effectivePermissions?:string[]}) {
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
  const canEditContacts = hasPermission(effectivePermissions,'vendors.edit',roleRank(userRole)>=roleRank('Maintenance Tech 2'));
  const canDeleteContacts = hasPermission(effectivePermissions,'vendors.delete',roleRank(userRole)>=roleRank('Manager'));

  function updateVendorInState(vendor: VendorRecord) {
    setVendors(current=>current.map(item=>item.id === vendor.id ? vendor : item));
    setDetailVendor(current=>current?.id === vendor.id ? vendor : current);
    setContactsVendor(current=>current?.id === vendor.id ? vendor : current);
  }

  function copiedEmail(email: string) {
    setNotice({kind:'success',text:`Copied email: ${email}`});
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
      setNotice({kind:'success',text:`Vendor deleted: ${vendor.companyName}`});
      await loadVendors(search);
    } catch (err) {
      setNotice({kind:'error',text:(err as Error).message});
    }
  }

  return (
    <div className="page-stack vendors-page">
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

      <section className="vendors-card-section">
        {loading&&<div className="mcc-card vendors-empty-card">Loading vendors...</div>}
        {!loading&&!sortedVendors.length&&<div className="mcc-card vendors-empty-card">No vendors found.</div>}
        {!loading&&sortedVendors.length>0&&(
          <div className="vendor-card-grid">
            {sortedVendors.map(vendor=>(
              <VendorCard
                key={vendor.id}
                vendor={vendor}
                onView={()=>setDetailVendor(vendor)}
                onEdit={()=>{ setEditingVendor(vendor); setAdding(false); setFormError(''); }}
                onDelete={()=>deleteVendor(vendor)}
                onContacts={()=>setContactsVendor(vendor)}
                onEmailCopied={copiedEmail}
              />
            ))}
          </div>
        )}
      </section>

      {detailVendor&&<VendorDetailModal vendor={detailVendor} onClose={()=>setDetailVendor(null)} onEmailCopied={copiedEmail} onEdit={()=>{ setEditingVendor(detailVendor); setDetailVendor(null); setFormError(''); }} />}
      {contactsVendor&&<VendorContactsModal vendor={contactsVendor} onClose={()=>setContactsVendor(null)} onVendorUpdated={updateVendorInState} onEmailCopied={copiedEmail} canEdit={canEditContacts} canDelete={canDeleteContacts} />}
      {(adding||editingVendor)&&<VendorEditorModal mode={editingVendor ? 'edit' : 'add'} initial={editorInitial} onClose={()=>{ if(!saving){ setAdding(false); setEditingVendor(null); setFormError(''); } }} onSave={saveVendor} saving={saving} error={formError} />}
    </div>
  );
}
