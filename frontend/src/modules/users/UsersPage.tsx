import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MccPermissionBadgeGroup, type SpecialPermissionGrant } from '../../components/MccPermissionBadges';
import { RoleBadge } from '../../components/RoleBadge';
import { generateTemporaryPassword, temporaryPasswordRequirements, validateTemporaryPassword } from './passwordValidation';

const roles=['Admin','Manager','Maintenance Tech 3','Maintenance Tech 2','Maintenance Tech 1'];
const roleHelp:Record<string,string>={
  Admin:'Admin - full user management',
  Manager:'Manager - manager and tier users',
  'Maintenance Tech 3':'Tier 3 - tier 3 and below',
  'Maintenance Tech 2':'Tier 2 - tier 2 and below',
  'Maintenance Tech 1':'Tier 1 - no user management',
};

type UserForm={fullName:string;email:string;role:string;temporaryPassword:string};
type FieldErrors=Partial<Record<keyof UserForm,string>>;
type ApiErrorPayload={error?:string;code?:string;field?:keyof UserForm|'confirmTemporaryPassword';requirements?:Record<string,unknown>};
class ApiError extends Error{
  code?:string;
  field?:ApiErrorPayload['field'];
  constructor(payload:ApiErrorPayload){super(payload.error||'Request failed.');this.name='ApiError';this.code=payload.code;this.field=payload.field;}
}
async function api<T=Record<string,unknown>>(path:string,options:RequestInit={}):Promise<T>{
  const res=await fetch(path,{credentials:'include',headers:{'Content-Type':'application/json'},...options});
  const data=await res.json().catch(()=>({})) as ApiErrorPayload&Record<string,unknown>;
  if(!res.ok)throw new ApiError(data);
  return data as T;
}

type User={
  id:number;
  fullName:string;
  email:string;
  role:string;
  isOwnerAdmin:boolean;
  forcePasswordChange:boolean;
  disabled:boolean;
  lastLoginAt?:string|null;
  canDisable:boolean;
  canDelete:boolean;
  canResetPassword?:boolean;
  canManagePermissions?:boolean;
  specialPermissionGrants?:SpecialPermissionGrant[];
};
type PermissionItem={
  key:string;
  label:string;
  state:'inherited'|'granted'|'not_allowed';
  inherited:boolean;
  speciallyGranted:boolean;
  grant:SpecialPermissionGrant|null;
};
type PermissionModule={key:string;label:string;shortLabel:string;permissions:PermissionItem[]};
type PermissionDetails={user:User;catalog:PermissionModule[];inheritedPermissions:string[];specialPermissionGrants:SpecialPermissionGrant[];effectivePermissions:string[];canManage:boolean};

const initialForm:UserForm={fullName:'',email:'',role:'Maintenance Tech 1',temporaryPassword:''};
const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function formatMccDateTime(value?:string|null){
  if(!value)return 'Never';
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return value||'Unknown';
  return date.toLocaleString();
}

function Modal({label,onClose,children,className=''}:{label:string;onClose:()=>void;children:ReactNode;className?:string}){
  useEffect(()=>{
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose();};
    document.addEventListener('keydown',escape);
    return()=>document.removeEventListener('keydown',escape);
  },[onClose]);
  return createPortal(<div className="mcc-modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}>
    <section className={`mcc-card mcc-modal user-security-modal ${className}`} role="dialog" aria-modal="true" aria-label={label}>{children}</section>
  </div>,document.body);
}

function PasswordChecklist({password,label='Temporary password requirements'}:{password:string;label?:string}){
  const validation=validateTemporaryPassword(password);
  return <ul className="user-password-requirements" aria-label={label}>
    {temporaryPasswordRequirements.map(requirement=>{
      const met=validation[requirement.key];
      return <li key={requirement.key} className={met?'is-met':'is-unmet'}><span aria-hidden="true">{met?'✓':'○'}</span><span>{requirement.label}</span><strong>{met?'Met':'Not met'}</strong></li>;
    })}
  </ul>;
}

function ResetPasswordModal({target,onClose,onReset}:{target:User;onClose:()=>void;onReset:()=>Promise<void>}){
  const [password,setPassword]=useState('');
  const [confirmation,setConfirmation]=useState('');
  const [show,setShow]=useState(false);
  const [error,setError]=useState('');
  const [copyMessage,setCopyMessage]=useState('');
  const [submitting,setSubmitting]=useState(false);
  const [oneTimePassword,setOneTimePassword]=useState('');
  const [expiresAt,setExpiresAt]=useState('');
  const passwordRef=useRef<HTMLInputElement>(null);
  const confirmationRef=useRef<HTMLInputElement>(null);
  const submittingRef=useRef(false);

  function generate(){
    const generated=generateTemporaryPassword();
    setPassword(generated);setConfirmation(generated);setShow(true);setError('');setCopyMessage('');
    passwordRef.current?.focus();
  }
  async function copy(value:string){
    if(!navigator.clipboard?.writeText)return;
    try{await navigator.clipboard.writeText(value);setCopyMessage('Password copied.');}
    catch{setCopyMessage('Could not copy password. Select it and copy manually.');}
  }
  async function submit(event:FormEvent){
    event.preventDefault();
    if(submittingRef.current)return;
    setError('');
    if(!validateTemporaryPassword(password).valid){setError('Temporary password must meet every requirement.');passwordRef.current?.focus();return;}
    if(password!==confirmation){setError('Temporary password confirmation does not match.');confirmationRef.current?.focus();return;}
    submittingRef.current=true;setSubmitting(true);
    try{
      const result=await api<{temporaryPassword:string;tempPasswordExpiresAt:string}>(`/api/users/${target.id}/reset-password`,{method:'POST',body:JSON.stringify({temporaryPassword:password,confirmTemporaryPassword:confirmation})});
      setOneTimePassword(result.temporaryPassword);setExpiresAt(result.tempPasswordExpiresAt);setPassword('');setConfirmation('');
      await onReset();
    }catch(requestError){
      setError((requestError as Error).message);
      if(requestError instanceof ApiError&&requestError.field==='confirmTemporaryPassword')confirmationRef.current?.focus();else passwordRef.current?.focus();
    }finally{submittingRef.current=false;setSubmitting(false);}
  }
  return <Modal label={`Reset password for ${target.fullName}`} onClose={onClose}>
    <div className="mcc-modal-heading"><div><p className="eyebrow">Admin / Users · Security</p><h3>Reset Password</h3><p>{target.fullName} · {target.email}</p></div><button type="button" className="secondary-button compact-button" onClick={onClose}>Close</button></div>
    {oneTimePassword?<div className="one-time-password">
      <p className="form-message" role="status">Temporary password created successfully</p>
      <strong>This password is shown one time only. Copy it now; it will not be available after this modal closes.</strong>
      <div className="user-password-input-row"><input readOnly type={show?'text':'password'} value={oneTimePassword} aria-label="One-time temporary password" /><button type="button" className="secondary-button compact-button" onClick={()=>setShow(current=>!current)}>{show?'Hide':'Show'}</button></div>
      <div className="user-password-actions"><button type="button" className="secondary-button compact-button" onClick={()=>copy(oneTimePassword)}>Copy Password</button><span role="status">{copyMessage}</span></div>
      <p>Expires {formatMccDateTime(expiresAt)}. The user must update it at next login.</p>
      <button type="button" className="primary-button compact-button" onClick={onClose}>Done</button>
    </div>:<form className="security-password-form" onSubmit={submit} noValidate>
      <p>The temporary password expires in 30 minutes and forces a password update at the next successful login. Existing sessions will be invalidated.</p>
      <button type="button" className="secondary-button compact-button" onClick={generate}>Generate Password</button>
      <label className="form-field"><span>Temporary Password</span><input ref={passwordRef} type={show?'text':'password'} value={password} onChange={event=>setPassword(event.target.value)} autoComplete="new-password" /></label>
      <label className="form-field"><span>Confirm Temporary Password</span><input ref={confirmationRef} type={show?'text':'password'} value={confirmation} onChange={event=>setConfirmation(event.target.value)} autoComplete="new-password" /></label>
      <button type="button" className="secondary-button compact-button" onClick={()=>setShow(current=>!current)} aria-label={show?'Hide temporary passwords':'Show temporary passwords'}>{show?'Hide':'Show'}</button>
      <PasswordChecklist password={password} />
      {error&&<p className="form-message error" role="alert">{error}</p>}
      <div className="mcc-modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={submitting}>{submitting?'Resetting…':'Reset Password'}</button></div>
    </form>}
  </Modal>;
}

function UpdatePasswordModal({onClose,onChanged}:{onClose:()=>void;onChanged:()=>void}){
  const [currentPassword,setCurrentPassword]=useState('');
  const [newPassword,setNewPassword]=useState('');
  const [confirmPassword,setConfirmPassword]=useState('');
  const [show,setShow]=useState(false);
  const [error,setError]=useState('');
  const [submitting,setSubmitting]=useState(false);
  const currentRef=useRef<HTMLInputElement>(null);
  async function submit(event:FormEvent){
    event.preventDefault();setError('');
    if(!currentPassword){setError('Current password is required.');currentRef.current?.focus();return;}
    if(!validateTemporaryPassword(newPassword).valid){setError('New password must meet every requirement.');return;}
    if(newPassword!==confirmPassword){setError('New password confirmation does not match.');return;}
    setSubmitting(true);
    try{await api('/api/auth/change-password',{method:'POST',body:JSON.stringify({currentPassword,newPassword,confirmPassword})});onChanged();onClose();}
    catch(requestError){setError((requestError as Error).message);}
    finally{setSubmitting(false);}
  }
  return <Modal label="Update my password" onClose={onClose}>
    <div className="mcc-modal-heading"><div><p className="eyebrow">Self-service security</p><h3>Update My Password</h3></div><button type="button" className="secondary-button compact-button" onClick={onClose}>Close</button></div>
    <form className="security-password-form" onSubmit={submit} noValidate>
      <label className="form-field"><span>Current Password</span><input ref={currentRef} type={show?'text':'password'} value={currentPassword} onChange={event=>setCurrentPassword(event.target.value)} autoComplete="current-password" /></label>
      <label className="form-field"><span>New Password</span><input type={show?'text':'password'} value={newPassword} onChange={event=>setNewPassword(event.target.value)} autoComplete="new-password" /></label>
      <label className="form-field"><span>Confirm New Password</span><input type={show?'text':'password'} value={confirmPassword} onChange={event=>setConfirmPassword(event.target.value)} autoComplete="new-password" /></label>
      <button type="button" className="secondary-button compact-button" onClick={()=>setShow(current=>!current)}>{show?'Hide':'Show'}</button>
      <PasswordChecklist password={newPassword} label="New password requirements" />
      {error&&<p className="form-message error" role="alert">{error}</p>}
      <div className="mcc-modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={submitting}>{submitting?'Updating…':'Update Password'}</button></div>
    </form>
  </Modal>;
}

function SpecialPermissionsModal({target,onClose,onSaved}:{target:User;onClose:()=>void;onSaved:()=>Promise<void>}){
  const [details,setDetails]=useState<PermissionDetails|null>(null);
  const [desired,setDesired]=useState<Set<string>>(new Set());
  const [initial,setInitial]=useState<Set<string>>(new Set());
  const [search,setSearch]=useState('');
  const [error,setError]=useState('');
  const [saving,setSaving]=useState(false);
  const saveRef=useRef(false);
  useEffect(()=>{api<PermissionDetails>(`/api/users/${target.id}/permissions`).then(result=>{setDetails(result);const keys=new Set(result.specialPermissionGrants.map(grant=>grant.permissionKey));setDesired(keys);setInitial(new Set(keys));}).catch(requestError=>setError((requestError as Error).message));},[target.id]);
  const pending=useMemo(()=>{
    const added=[...desired].filter(key=>!initial.has(key));
    const removed=[...initial].filter(key=>!desired.has(key));
    return {added,removed};
  },[desired,initial]);
  async function save(){
    if(saveRef.current)return;
    saveRef.current=true;setSaving(true);setError('');
    try{await api(`/api/users/${target.id}/permissions`,{method:'PUT',body:JSON.stringify({permissionKeys:[...desired]})});await onSaved();onClose();}
    catch(requestError){setError((requestError as Error).message);}
    finally{saveRef.current=false;setSaving(false);}
  }
  const query=search.trim().toLowerCase();
  return <Modal label={`Special permissions for ${target.fullName}`} onClose={onClose} className="special-permissions-modal">
    <div className="mcc-modal-heading"><div><p className="eyebrow">Delegated access</p><h3>Special Permissions</h3><p>{target.fullName} · {target.email} · {target.role}</p></div><button type="button" className="secondary-button compact-button" onClick={onClose}>Close</button></div>
    <label className="form-field"><span>Search permissions</span><input type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Inventory, upload, received…" /></label>
    {!details&&!error&&<p>Loading permissions…</p>}
    {details&&<div className="permission-module-list">
      {details.catalog.map(module=>{
        const permissions=module.permissions.filter(permission=>!query||`${module.label} ${permission.label} ${permission.key}`.toLowerCase().includes(query));
        if(!permissions.length)return null;
        return <details key={module.key} open>
          <summary>{module.label}</summary>
          <div className="permission-choice-list">{permissions.map(permission=>{
            const checked=permission.inherited||desired.has(permission.key);
            return <label className={`permission-choice${permission.inherited?' is-inherited':desired.has(permission.key)?' is-granted':''}`} key={permission.key}>
              <input type="checkbox" checked={checked} disabled={permission.inherited||!details.canManage} onChange={event=>setDesired(current=>{const next=new Set(current);if(event.target.checked)next.add(permission.key);else next.delete(permission.key);return next;})} />
              <span><strong>{permission.label}</strong><small>{permission.inherited?'Inherited from rank':desired.has(permission.key)?'Specially granted':'Not allowed'}</small></span>
            </label>;
          })}</div>
        </details>;
      })}
    </div>}
    <p className="permission-pending-summary" role="status">{pending.added.length} pending grant{pending.added.length===1?'':'s'} · {pending.removed.length} pending revoke{pending.removed.length===1?'':'s'}</p>
    {error&&<p className="form-message error" role="alert">{error}</p>}
    <div className="mcc-modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="button" className="primary-button" disabled={!details||saving||(!pending.added.length&&!pending.removed.length)} onClick={save}>{saving?'Saving…':'Save Changes'}</button></div>
  </Modal>;
}

export function UsersPage(){
  const [users,setUsers]=useState<User[]>([]);
  const [currentUser,setCurrentUser]=useState<User|null>(null);
  const [msg,setMsg]=useState('');
  const [error,setError]=useState(false);
  const [form,setForm]=useState<UserForm>(initialForm);
  const [fieldErrors,setFieldErrors]=useState<FieldErrors>({});
  const [showPassword,setShowPassword]=useState(false);
  const [copyMessage,setCopyMessage]=useState('');
  const [isSubmitting,setIsSubmitting]=useState(false);
  const [resetTarget,setResetTarget]=useState<User|null>(null);
  const [permissionTarget,setPermissionTarget]=useState<User|null>(null);
  const [updateMyPassword,setUpdateMyPassword]=useState(false);
  const submittingRef=useRef(false);
  const fullNameRef=useRef<HTMLInputElement>(null);
  const emailRef=useRef<HTMLInputElement>(null);
  const roleRef=useRef<HTMLSelectElement>(null);
  const passwordRef=useRef<HTMLInputElement>(null);
  const passwordValidation=validateTemporaryPassword(form.temporaryPassword);

  const load=async()=>{
    try{
      const [usersResult,authResult]=await Promise.all([api<{users:User[]}>('/api/users'),api<{user:User|null}>('/api/auth/status')]);
      setUsers(usersResult.users);setCurrentUser(authResult.user);
    }catch(requestError){setError(true);setMsg((requestError as Error).message);}
  };
  useEffect(()=>{void load();},[]);

  function updateField<K extends keyof UserForm>(field:K,value:UserForm[K]){setForm(current=>({...current,[field]:value}));setFieldErrors(current=>({...current,[field]:undefined}));if(field==='temporaryPassword')setCopyMessage('');}
  function validateForm(){const next:FieldErrors={};if(!form.fullName.trim())next.fullName='Full name is required.';if(!form.email.trim())next.email='Email is required.';else if(!emailPattern.test(form.email.trim()))next.email='Enter a valid email address.';if(!form.role||!roles.includes(form.role))next.role='Role is required.';if(!passwordValidation.valid)next.temporaryPassword='Temporary password must meet every requirement.';return next;}
  function focusFirstInvalid(errors:FieldErrors){const field=(['fullName','email','role','temporaryPassword'] as const).find(name=>errors[name]);if(field)({fullName:fullNameRef,email:emailRef,role:roleRef,temporaryPassword:passwordRef}[field]).current?.focus();}
  function generatePassword(){try{const password=generateTemporaryPassword();updateField('temporaryPassword',password);setShowPassword(true);setMsg('');setError(false);passwordRef.current?.focus();}catch(generateError){setError(true);setMsg((generateError as Error).message);}}
  async function copyPassword(){if(!form.temporaryPassword||!navigator.clipboard?.writeText)return;try{await navigator.clipboard.writeText(form.temporaryPassword);setCopyMessage('Password copied.');}catch{setCopyMessage('Could not copy password. Select it and copy manually.');}}
  async function create(event:FormEvent){
    event.preventDefault();if(submittingRef.current)return;setMsg('');setError(false);
    const nextErrors=validateForm();setFieldErrors(nextErrors);if(Object.keys(nextErrors).length){focusFirstInvalid(nextErrors);return;}
    submittingRef.current=true;setIsSubmitting(true);
    try{await api('/api/users',{method:'POST',body:JSON.stringify({...form,fullName:form.fullName.trim(),email:form.email.trim()})});setForm(initialForm);setFieldErrors({});setShowPassword(false);setCopyMessage('');setMsg('User created successfully');await load();}
    catch(requestError){setError(true);setMsg((requestError as Error).message);if(requestError instanceof ApiError&&requestError.field&&requestError.field!=='confirmTemporaryPassword'){const next={[requestError.field]:requestError.message};setFieldErrors(current=>({...current,...next}));focusFirstInvalid(next);}}
    finally{submittingRef.current=false;setIsSubmitting(false);}
  }
  async function toggle(user:User){setMsg('');setError(false);try{await api(`/api/users/${user.id}/${user.disabled?'enable':'disable'}`,{method:'POST'});await load();}catch(requestError){setError(true);setMsg((requestError as Error).message);}}
  async function deleteUser(user:User){if(!window.confirm(`Delete ${user.fullName}? This hides the user and signs out active sessions.`))return;setMsg('');setError(false);try{await api(`/api/users/${user.id}`,{method:'DELETE'});setMsg('User deleted.');await load();}catch(requestError){setError(true);setMsg((requestError as Error).message);}}

  return <div className="page-stack">
    <form className="mcc-card user-form user-create-form" onSubmit={create} noValidate aria-busy={isSubmitting}>
      <label className="form-field"><span>Full name</span><input ref={fullNameRef} value={form.fullName} onChange={event=>updateField('fullName',event.target.value)} aria-invalid={Boolean(fieldErrors.fullName)} aria-describedby={fieldErrors.fullName?'user-full-name-error':undefined} autoComplete="name" />{fieldErrors.fullName&&<span className="user-field-error" id="user-full-name-error" role="alert">{fieldErrors.fullName}</span>}</label>
      <label className="form-field"><span>Email</span><input ref={emailRef} type="email" value={form.email} onChange={event=>updateField('email',event.target.value)} aria-invalid={Boolean(fieldErrors.email)} aria-describedby={fieldErrors.email?'user-email-error':undefined} autoComplete="email" />{fieldErrors.email&&<span className="user-field-error" id="user-email-error" role="alert">{fieldErrors.email}</span>}</label>
      <label className="form-field"><span>Role / rank</span><select ref={roleRef} value={form.role} onChange={event=>updateField('role',event.target.value)}>{roles.map(role=><option key={role} value={role}>{roleHelp[role]}</option>)}</select>{fieldErrors.role&&<span className="user-field-error" role="alert">{fieldErrors.role}</span>}</label>
      <div className="form-field user-password-field">
        <label htmlFor="temporary-password">Temporary password</label>
        <div className="user-password-input-row"><input id="temporary-password" ref={passwordRef} type={showPassword?'text':'password'} value={form.temporaryPassword} onChange={event=>updateField('temporaryPassword',event.target.value)} aria-invalid={Boolean(fieldErrors.temporaryPassword)} aria-describedby={`temporary-password-requirements${fieldErrors.temporaryPassword?' temporary-password-error':''}`} autoComplete="new-password" /><button type="button" className="secondary-button user-password-visibility" onClick={()=>setShowPassword(current=>!current)} aria-label={showPassword?'Hide temporary password':'Show temporary password'}>{showPassword?'Hide':'Show'}</button></div>
        <div id="temporary-password-requirements"><PasswordChecklist password={form.temporaryPassword} /></div>
        {fieldErrors.temporaryPassword&&<span className="user-field-error" id="temporary-password-error" role="alert">{fieldErrors.temporaryPassword}</span>}
        <div className="user-password-actions"><button type="button" className="secondary-button compact-button" onClick={generatePassword}>Generate Password</button><button type="button" className="secondary-button compact-button" onClick={copyPassword} disabled={!form.temporaryPassword||!navigator.clipboard?.writeText}>Copy Password</button><span className="user-copy-message" role="status" aria-live="polite">{copyMessage}</span></div>
      </div>
      <button className="primary-button user-create-button" type="submit" disabled={isSubmitting}>{isSubmitting?'Creating User…':'Create User'}</button>
    </form>
    {msg&&<p className={error?'form-message error':'form-message'} role={error?'alert':'status'}>{msg}</p>}
    <div className="mcc-card table-card user-table-card"><table><thead><tr><th>Name</th><th>Email</th><th>Rank</th><th>Last login</th><th>Status</th><th>Special permissions</th><th>Actions</th></tr></thead><tbody>
      {users.map(user=><tr key={user.id}>
        <td data-label="Name"><strong className="user-name">{user.fullName}</strong></td>
        <td data-label="Email">{user.email}</td>
        <td data-label="Rank"><RoleBadge role={user.role} isOwnerAdmin={user.isOwnerAdmin} /></td>
        <td data-label="Last login" className="user-last-login">{formatMccDateTime(user.lastLoginAt)}</td>
        <td data-label="Status"><span className={user.disabled?'status-pill disabled':'status-pill'}>{user.disabled?'Disabled':'Active'}</span></td>
        <td data-label="Special permissions"><MccPermissionBadgeGroup grants={user.specialPermissionGrants??[]} disabledAccount={user.disabled} /></td>
        <td data-label="Actions"><div className="user-actions">
          {user.canManagePermissions&&<button type="button" className="secondary-button compact-button" onClick={()=>setPermissionTarget(user)}>Special Permissions</button>}
          {user.canResetPassword&&<button type="button" className="secondary-button compact-button" onClick={()=>setResetTarget(user)}>Reset Password</button>}
          {currentUser?.id===user.id&&<button type="button" className="secondary-button compact-button" onClick={()=>setUpdateMyPassword(true)}>Update My Password</button>}
          {user.canDisable&&<button type="button" className="secondary-button compact-button" onClick={()=>toggle(user)}>{user.disabled?'Enable':'Disable'}</button>}
          {user.canDelete&&<button type="button" className="danger-button compact-button" onClick={()=>deleteUser(user)}>Delete</button>}
          {!user.canDisable&&!user.canDelete&&<span className="locked-action">Protected</span>}
        </div></td>
      </tr>)}
    </tbody></table></div>
    {resetTarget&&<ResetPasswordModal target={resetTarget} onClose={()=>setResetTarget(null)} onReset={load} />}
    {updateMyPassword&&<UpdatePasswordModal onClose={()=>setUpdateMyPassword(false)} onChanged={()=>{setError(false);setMsg('Password updated successfully.');}} />}
    {permissionTarget&&<SpecialPermissionsModal target={permissionTarget} onClose={()=>setPermissionTarget(null)} onSaved={load} />}
  </div>;
}
