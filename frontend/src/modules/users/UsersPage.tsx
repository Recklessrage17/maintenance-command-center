import { FormEvent, useEffect, useState } from 'react';
import { RoleBadge } from '../../components/RoleBadge';

const roles = ['Admin','Manager','Maintenance Tech 3','Maintenance Tech 2','Maintenance Tech 1'];
const roleHelp: Record<string, string> = {
  Admin: 'Admin - full user management',
  Manager: 'Manager - manager and tech users',
  'Maintenance Tech 3': 'Maintenance Tech 3 - tech 3 and below',
  'Maintenance Tech 2': 'Maintenance Tech 2 - tech 2 and below',
  'Maintenance Tech 1': 'Maintenance Tech 1 - no user management',
};

async function api(path:string, options:RequestInit={}) {
  const res=await fetch(path,{credentials:'include',headers:{'Content-Type':'application/json'},...options});
  const data=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

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

export function UsersPage(){
  const [users,setUsers]=useState<User[]>([]);
  const [msg,setMsg]=useState('');
  const [error,setError]=useState(false);
  const [form,setForm]=useState({fullName:'',email:'',role:'Maintenance Tech 1',temporaryPassword:''});

  const load=()=>api('/api/users').then(d=>setUsers(d.users)).catch(e=>{setError(true);setMsg(e.message);});
  useEffect(()=>{ void load(); },[]);

  async function create(e:FormEvent){
    e.preventDefault();
    setMsg('');
    setError(false);
    try{
      await api('/api/users',{method:'POST',body:JSON.stringify(form)});
      setForm({fullName:'',email:'',role:'Maintenance Tech 1',temporaryPassword:''});
      setMsg('User created.');
      await load();
    }catch(err){
      setError(true);
      setMsg((err as Error).message);
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
      <div className="page-heading">
        <p className="eyebrow">Admin / Users</p>
        <h2>User Management</h2>
        <p>Create local MCC users, assign ranks, protect the owner admin, and keep disabled users visible until they are deleted.</p>
      </div>

      <form className="mcc-card user-form user-create-form" onSubmit={create}>
        <label className="form-field">
          <span>Full name</span>
          <input value={form.fullName} onChange={e=>setForm({...form,fullName:e.target.value})} />
        </label>
        <label className="form-field">
          <span>Email</span>
          <input value={form.email} onChange={e=>setForm({...form,email:e.target.value})} />
        </label>
        <label className="form-field">
          <span>Role / rank</span>
          <select value={form.role} onChange={e=>setForm({...form,role:e.target.value})}>
            {roles.map(r=><option key={r} value={r}>{roleHelp[r]}</option>)}
          </select>
        </label>
        <label className="form-field">
          <span>Temporary password</span>
          <input type="password" value={form.temporaryPassword} onChange={e=>setForm({...form,temporaryPassword:e.target.value})} />
        </label>
        <button className="primary-button user-create-button">Create User</button>
      </form>

      {msg&&<p className={error?'form-message error':'form-message'}>{msg}</p>}

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
                <td>{u.lastLoginAt ?? 'Never'}</td>
                <td><span className={u.disabled?'status-pill disabled':'status-pill'}>{u.disabled?'Disabled':'Active'}</span></td>
                <td>
                  <div className="user-actions">
                    {u.canDisable&&<button className="secondary-button compact-button" onClick={()=>toggle(u)}>{u.disabled?'Enable':'Disable'}</button>}
                    {u.canDelete&&<button className="danger-button compact-button" onClick={()=>deleteUser(u)}>Delete</button>}
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
