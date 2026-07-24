import { FormEvent, useEffect, useRef, useState } from 'react';
import { RoleBadge } from '../../components/RoleBadge';
import { generateTemporaryPassword, temporaryPasswordRequirements, validateTemporaryPassword } from './passwordValidation';

const roles = ['Admin','Manager','Maintenance Tech 3','Maintenance Tech 2','Maintenance Tech 1'];
const roleHelp: Record<string, string> = {
  Admin: 'Admin - full user management',
  Manager: 'Manager - manager and tier users',
  'Maintenance Tech 3': 'Tier 3 - tier 3 and below',
  'Maintenance Tech 2': 'Tier 2 - tier 2 and below',
  'Maintenance Tech 1': 'Tier 1 - no user management',
};

type ApiErrorPayload={error?:string;code?:string;field?:keyof UserForm;requirements?:Record<string,unknown>};
class ApiError extends Error {
  code?:string;
  field?:keyof UserForm;
  constructor(payload:ApiErrorPayload) {
    super(payload.error || 'Request failed.');
    this.name='ApiError';
    this.code=payload.code;
    this.field=payload.field;
  }
}

async function api<T=Record<string,unknown>>(path:string, options:RequestInit={}):Promise<T> {
  const res=await fetch(path,{credentials:'include',headers:{'Content-Type':'application/json'},...options});
  const data=await res.json().catch(()=>({})) as ApiErrorPayload&Record<string,unknown>;
  if(!res.ok) throw new ApiError(data);
  return data as T;
}

type UserForm={fullName:string;email:string;role:string;temporaryPassword:string};
type FieldErrors=Partial<Record<keyof UserForm,string>>;
const initialForm:UserForm={fullName:'',email:'',role:'Maintenance Tech 1',temporaryPassword:''};
const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type User={
  id:number;
  fullName:string;
  email:string;
  role:string;
  isOwnerAdmin:boolean;
  disabled:boolean;
  lastLoginAt?:string|null;
  canDisable:boolean;
  canDelete:boolean;
};

function formatMccDateTime(value?: string | null) {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || 'Unknown';
  const month = new Intl.DateTimeFormat(undefined,{month:'long'}).format(date);
  const day = String(date.getDate()).padStart(2, '0');
  const year = date.getFullYear();
  const time = new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit',hour12:true}).format(date);
  return `Date: ${month}-${day}-${year} → Time: ${time}`;
}

export function UsersPage(){
  const [users,setUsers]=useState<User[]>([]);
  const [msg,setMsg]=useState('');
  const [error,setError]=useState(false);
  const [form,setForm]=useState<UserForm>(initialForm);
  const [fieldErrors,setFieldErrors]=useState<FieldErrors>({});
  const [showPassword,setShowPassword]=useState(false);
  const [copyMessage,setCopyMessage]=useState('');
  const [isSubmitting,setIsSubmitting]=useState(false);
  const submittingRef=useRef(false);
  const fullNameRef=useRef<HTMLInputElement>(null);
  const emailRef=useRef<HTMLInputElement>(null);
  const roleRef=useRef<HTMLSelectElement>(null);
  const passwordRef=useRef<HTMLInputElement>(null);
  const passwordValidation=validateTemporaryPassword(form.temporaryPassword);

  const load=()=>api<{users:User[]}>('/api/users').then(d=>setUsers(d.users)).catch(e=>{setError(true);setMsg(e.message);});
  useEffect(()=>{ void load(); },[]);

  function updateField<K extends keyof UserForm>(field:K,value:UserForm[K]){
    setForm(current=>({...current,[field]:value}));
    setFieldErrors(current=>({...current,[field]:undefined}));
    if(field==='temporaryPassword') setCopyMessage('');
  }

  function validateForm(){
    const nextErrors:FieldErrors={};
    if(!form.fullName.trim()) nextErrors.fullName='Full name is required.';
    if(!form.email.trim()) nextErrors.email='Email is required.';
    else if(!emailPattern.test(form.email.trim())) nextErrors.email='Enter a valid email address.';
    if(!form.role||!roles.includes(form.role)) nextErrors.role='Role is required.';
    if(!passwordValidation.valid) nextErrors.temporaryPassword='Temporary password must meet every requirement.';
    return nextErrors;
  }

  function focusFirstInvalid(errors:FieldErrors){
    const field=(['fullName','email','role','temporaryPassword'] as const).find(name=>errors[name]);
    ({fullName:fullNameRef,email:emailRef,role:roleRef,temporaryPassword:passwordRef}[field!])?.current?.focus();
  }

  function generatePassword(){
    try{
      const password=generateTemporaryPassword();
      updateField('temporaryPassword',password);
      setShowPassword(true);
      setMsg('');
      setError(false);
      passwordRef.current?.focus();
    }catch(err){
      setError(true);
      setMsg((err as Error).message);
    }
  }

  async function copyPassword(){
    if(!form.temporaryPassword||!navigator.clipboard?.writeText) return;
    try{
      await navigator.clipboard.writeText(form.temporaryPassword);
      setCopyMessage('Password copied.');
    }catch{
      setCopyMessage('Could not copy password. Select it and copy manually.');
    }
  }

  async function create(e:FormEvent){
    e.preventDefault();
    if(submittingRef.current) return;
    setMsg('');
    setError(false);
    const nextErrors=validateForm();
    setFieldErrors(nextErrors);
    if(Object.keys(nextErrors).length){
      focusFirstInvalid(nextErrors);
      return;
    }
    submittingRef.current=true;
    setIsSubmitting(true);
    try{
      await api('/api/users',{method:'POST',body:JSON.stringify({...form,fullName:form.fullName.trim(),email:form.email.trim()})});
      setForm(initialForm);
      setFieldErrors({});
      setShowPassword(false);
      setCopyMessage('');
      setMsg('User created successfully');
      await load();
    }catch(err){
      setError(true);
      setMsg((err as Error).message);
      if(err instanceof ApiError&&err.field){
        const next={[err.field]:err.message};
        setFieldErrors(current=>({...current,...next}));
        focusFirstInvalid(next);
      }
    }finally{
      submittingRef.current=false;
      setIsSubmitting(false);
    }
  }

  async function toggle(u:User){
    setMsg('');
    setError(false);
    try{
      await api(`/api/users/${u.id}/${u.disabled?'enable':'disable'}`,{method:'POST'});
      await load();
    }catch(err){
      setError(true);
      setMsg((err as Error).message);
    }
  }

  async function deleteUser(u:User){
    if(!window.confirm(`Delete ${u.fullName}? This hides the user and signs out active sessions.`)) return;
    setMsg('');
    setError(false);
    try{
      await api(`/api/users/${u.id}`,{method:'DELETE'});
      setMsg('User deleted.');
      await load();
    }catch(err){
      setError(true);
      setMsg((err as Error).message);
    }
  }

  return (
    <div className="page-stack">
      <form className="mcc-card user-form user-create-form" onSubmit={create} noValidate aria-busy={isSubmitting}>
        <label className="form-field">
          <span>Full name</span>
          <input ref={fullNameRef} value={form.fullName} onChange={e=>updateField('fullName',e.target.value)} aria-invalid={Boolean(fieldErrors.fullName)} aria-describedby={fieldErrors.fullName?'user-full-name-error':undefined} autoComplete="name" />
          {fieldErrors.fullName&&<span className="user-field-error" id="user-full-name-error" role="alert">{fieldErrors.fullName}</span>}
        </label>
        <label className="form-field">
          <span>Email</span>
          <input ref={emailRef} type="email" value={form.email} onChange={e=>updateField('email',e.target.value)} aria-invalid={Boolean(fieldErrors.email)} aria-describedby={fieldErrors.email?'user-email-error':undefined} autoComplete="email" />
          {fieldErrors.email&&<span className="user-field-error" id="user-email-error" role="alert">{fieldErrors.email}</span>}
        </label>
        <label className="form-field">
          <span>Role / rank</span>
          <select ref={roleRef} value={form.role} onChange={e=>updateField('role',e.target.value)} aria-invalid={Boolean(fieldErrors.role)} aria-describedby={fieldErrors.role?'user-role-error':undefined}>
            {roles.map(r=><option key={r} value={r}>{roleHelp[r]}</option>)}
          </select>
          {fieldErrors.role&&<span className="user-field-error" id="user-role-error" role="alert">{fieldErrors.role}</span>}
        </label>
        <div className="form-field user-password-field">
          <label htmlFor="temporary-password">Temporary password</label>
          <div className="user-password-input-row">
            <input id="temporary-password" ref={passwordRef} type={showPassword?'text':'password'} value={form.temporaryPassword} onChange={e=>updateField('temporaryPassword',e.target.value)} aria-invalid={Boolean(fieldErrors.temporaryPassword)} aria-describedby={`temporary-password-requirements${fieldErrors.temporaryPassword?' temporary-password-error':''}`} autoComplete="new-password" />
            <button type="button" className="secondary-button user-password-visibility" onClick={()=>setShowPassword(current=>!current)} aria-label={showPassword?'Hide temporary password':'Show temporary password'}>{showPassword?'Hide':'Show'}</button>
          </div>
          <ul className="user-password-requirements" id="temporary-password-requirements" aria-label="Temporary password requirements">
            {temporaryPasswordRequirements.map(requirement=>{
              const met=passwordValidation[requirement.key];
              return <li key={requirement.key} className={met?'is-met':'is-unmet'}><span className="user-password-requirement-icon" aria-hidden="true">{met?'✓':'○'}</span><span>{requirement.label}</span><strong>{met?'Met':'Not met'}</strong></li>;
            })}
          </ul>
          {fieldErrors.temporaryPassword&&<span className="user-field-error" id="temporary-password-error" role="alert">{fieldErrors.temporaryPassword}</span>}
          <div className="user-password-actions">
            <button type="button" className="secondary-button compact-button" onClick={generatePassword}>Generate Password</button>
            <button type="button" className="secondary-button compact-button" onClick={copyPassword} disabled={!form.temporaryPassword||!navigator.clipboard?.writeText}>Copy Password</button>
            <span className="user-copy-message" role="status" aria-live="polite">{copyMessage}</span>
          </div>
        </div>
        <button className="primary-button user-create-button" type="submit" disabled={isSubmitting}>{isSubmitting?'Creating User…':'Create User'}</button>
      </form>

      {msg&&<p className={error?'form-message error':'form-message'} role={error?'alert':'status'}>{msg}</p>}

      <div className="mcc-card table-card">
        <table>
          <thead>
            <tr><th>Name</th><th>Email</th><th>Rank</th><th>Last login</th><th>Status</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {users.map(u=>
              <tr key={u.id}>
                <td><strong className="user-name">{u.fullName}</strong></td>
                <td>{u.email}</td>
                <td><RoleBadge role={u.role} isOwnerAdmin={u.isOwnerAdmin} /></td>
                <td className="user-last-login">{formatMccDateTime(u.lastLoginAt)}</td>
                <td><span className={u.disabled?'status-pill disabled':'status-pill'}>{u.disabled?'Disabled':'Active'}</span></td>
                <td>
                  <div className="user-actions">
                    {u.canDisable&&<button type="button" className="secondary-button compact-button" onClick={()=>toggle(u)}>{u.disabled?'Enable':'Disable'}</button>}
                    {u.canDelete&&<button type="button" className="danger-button compact-button" onClick={()=>deleteUser(u)}>Delete</button>}
                    {!u.canDisable&&!u.canDelete&&<span className="locked-action">Protected</span>}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
