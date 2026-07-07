import { FormEvent, useEffect, useMemo, useState } from 'react';
import { MccLayout, type MccSection } from './layout/MccLayout';
import { DashboardPage } from './modules/dashboard/DashboardPage';
import { InventoryPage } from './modules/inventory/InventoryPage';
import { MachineLibraryPage } from './modules/machine-library/MachineLibraryPage';
import { EquipmentLibraryPage } from './modules/equipment-library/EquipmentLibraryPage';
import { FacilityInfoPage } from './modules/facility-info/FacilityInfoPage';
import { HistoryPage, historySectionFromPath, historySectionSlug, type HistorySection } from './modules/history/HistoryPage';
import { RequisitionsPage } from './modules/requisitions/RequisitionsPage';
import { SettingsPage } from './modules/settings/SettingsPage';
import { UsersPage } from './modules/users/UsersPage';
import { VendorsPage } from './modules/vendors/VendorsPage';

type User = { id:number; fullName:string; email:string; role:string; isOwnerAdmin:boolean; forcePasswordChange:boolean };
type AuthMode = 'loading' | 'setup' | 'login' | 'forgot' | 'change' | 'app';
const LOGIN_SUCCESS_WARP_MS = 280;
async function api(path:string, options:RequestInit={}) { const res=await fetch(path,{credentials:'include',headers:{'Content-Type':'application/json',...(options.headers??{})},...options}); const data=await res.json().catch(()=>({})); if(!res.ok) throw new Error(data.error || 'Request failed.'); return data; }
function AuthCard({title,eyebrow,children}:{title:string;eyebrow:string;children:React.ReactNode}) { return <main className="auth-shell"><section className="auth-card"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{children}</section></main>; }
function Field({label,type='text',value,onChange,autoComplete}:{label:string;type?:string;value:string;onChange:(v:string)=>void;autoComplete?:string}) { return <label className="form-field"><span>{label}</span><input type={type} value={value} autoComplete={autoComplete} onChange={e=>onChange(e.target.value)} /></label>; }
function routeFromPath(pathname: string): { section: MccSection; historySection: HistorySection | null } {
  const clean = pathname.replace(/^\/+|\/+$/g, '');
  if (clean.startsWith('history')) return { section: 'history', historySection: historySectionFromPath(clean) };
  const first = clean.split('/')[0] as MccSection;
  if (['inventory','vendors','requisitions','machine-library','equipment-library','facility-info','users','settings'].includes(first)) return { section: first, historySection: null };
  return { section: 'dashboard', historySection: null };
}
function pathForSection(section: MccSection, historySection?: HistorySection | null) {
  if (section === 'dashboard') return '/';
  if (section === 'history') return historySection ? `/history/${historySectionSlug(historySection)}` : '/history';
  return `/${section}`;
}
function App() {
  const initialRoute = useMemo(()=>routeFromPath(window.location.pathname),[]);
  const [mode,setMode]=useState<AuthMode>('loading'); const [user,setUser]=useState<User|null>(null); const [activeSection,setActiveSection]=useState<MccSection>(initialRoute.section); const [historySection,setHistorySection]=useState<HistorySection|null>(initialRoute.historySection);
  const refresh=()=>api('/api/auth/status').then(d=>{setUser(d.user); setMode(d.setupRequired?'setup':d.user?.forcePasswordChange?'change':d.user?'app':'login');}).catch(()=>setMode('login'));
  useEffect(()=>{ refresh(); },[]);
  useEffect(()=>{
    function onPopState() {
      const route = routeFromPath(window.location.pathname);
      setActiveSection(route.section);
      setHistorySection(route.historySection);
    }
    window.addEventListener('popstate',onPopState);
    return ()=>window.removeEventListener('popstate',onPopState);
  },[]);
  const permissions=useMemo(()=>({canManageUsers: !!user && user.role !== 'Maintenance Tech 1', canViewHistory: !!user && (user.role === 'Admin' || user.role === 'Manager')}),[user]);
  function navigate(section: MccSection, nextHistorySection: HistorySection | null = null) {
    setActiveSection(section);
    setHistorySection(section === 'history' ? nextHistorySection : null);
    window.history.pushState(null,'',pathForSection(section,nextHistorySection));
  }
  const page = activeSection === 'inventory' ? <InventoryPage userRole={user?.role ?? ''} userFullName={user?.fullName ?? ''} onBackToDashboard={()=>navigate('dashboard')} onOpenRequisitions={()=>navigate('requisitions')} /> : activeSection === 'vendors' ? <VendorsPage userRole={user?.role ?? ''} /> : activeSection === 'machine-library' ? <MachineLibraryPage userRole={user?.role ?? ''} userFullName={user?.fullName ?? ''} /> : activeSection === 'equipment-library' ? <EquipmentLibraryPage /> : activeSection === 'facility-info' ? <FacilityInfoPage /> : activeSection === 'history' ? (permissions.canViewHistory ? <HistoryPage userRole={user?.role ?? ''} selectedSection={historySection} onSectionChange={section=>navigate('history',section)} onBackToLanding={()=>navigate('history')} /> : <div className="page-stack"><div className="page-heading"><p className="eyebrow">Not Authorized</p><h2>History Logs locked</h2><p>Admin or Manager access is required to view MCC history logs.</p></div></div>) : activeSection === 'requisitions' ? <RequisitionsPage userRole={user?.role ?? ''} /> : activeSection === 'users' ? <UsersPage /> : activeSection === 'settings' ? <SettingsPage isOwnerAdmin={Boolean(user?.isOwnerAdmin)} /> : <DashboardPage />;
  if(mode==='loading') return <AuthCard title="Loading MCC" eyebrow="Secure local access"><p>Checking local session…</p></AuthCard>;
  if(mode==='setup') return <Setup onDone={()=>setMode('login')} />;
  if(mode==='login') return <Login onForgot={()=>setMode('forgot')} onLogin={u=>{setUser(u); setMode(u.forcePasswordChange?'change':'app');}} />;
  if(mode==='forgot') return <Forgot onBack={()=>setMode('login')} />;
  if(mode==='change') return <Change onDone={refresh} />;
  return <MccLayout activeSection={activeSection} onSectionChange={section=>navigate(section)} user={user!} canManageUsers={permissions.canManageUsers} canViewHistory={permissions.canViewHistory} onLogout={async()=>{await api('/api/auth/logout',{method:'POST'}); setUser(null); setMode('login');}}>{page}</MccLayout>;
}
function Setup({onDone}:{onDone:()=>void}) { const [fullName,setFullName]=useState(''),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[confirmPassword,setConfirm]=useState(''),[msg,setMsg]=useState(''); async function submit(e:FormEvent){e.preventDefault();setMsg('');try{await api('/api/auth/setup-first-admin',{method:'POST',body:JSON.stringify({fullName,email,password,confirmPassword})});setMsg('First Admin created. Please log in.'); setTimeout(onDone,800);}catch(err){setMsg((err as Error).message)}} return <AuthCard title="First Admin Setup" eyebrow="MCC security foundation"><form onSubmit={submit} className="auth-form"><Field label="Full name" value={fullName} onChange={setFullName}/><Field label="Email" value={email} onChange={setEmail} autoComplete="email"/><Field label="Password" type="password" value={password} onChange={setPassword}/><Field label="Confirm password" type="password" value={confirmPassword} onChange={setConfirm}/><p className="form-help">Minimum 10 characters with uppercase, lowercase, number, and special character.</p><button className="primary-button">Create First Admin</button>{msg&&<p className="form-message">{msg}</p>}</form></AuthCard> }
function Login({onLogin,onForgot}:{onLogin:(u:User)=>void;onForgot:()=>void}) {
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[msg,setMsg]=useState(''),[isSubmitting,setIsSubmitting]=useState(false);
  async function submit(e:FormEvent){
    e.preventDefault();
    if(isSubmitting) return;
    const startedAt=Date.now();
    setMsg('');
    setIsSubmitting(true);
    try{
      const d=await api('/api/auth/login',{method:'POST',body:JSON.stringify({email,password})});
      window.setTimeout(()=>onLogin(d.user),LOGIN_SUCCESS_WARP_MS);
    }catch(err){
      const remainingWarpMs=Math.max(0,LOGIN_SUCCESS_WARP_MS-(Date.now()-startedAt));
      if(remainingWarpMs) await new Promise(resolve=>window.setTimeout(resolve,remainingWarpMs));
      setIsSubmitting(false);
      setMsg((err as Error).message);
    }
  }
  return <AuthCard title="MCC Login" eyebrow="Maintenance command center"><form onSubmit={submit} className="auth-form" aria-busy={isSubmitting}><Field label="Email" value={email} onChange={setEmail} autoComplete="email"/><Field label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password"/><button className={isSubmitting?'primary-button mcc-bubble-transition mcc-login-warp is-warping':'primary-button mcc-bubble-transition mcc-login-warp'} type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>{isSubmitting?'Opening MCC':'Log In'}</button><button type="button" className="link-button" onClick={onForgot} disabled={isSubmitting}>Forgot Password</button>{msg&&<p className="form-message error" role="alert">{msg}</p>}</form></AuthCard>
}
function Forgot({onBack}:{onBack:()=>void}) { const [email,setEmail]=useState(''),[msg,setMsg]=useState(''); async function submit(e:FormEvent){e.preventDefault();try{const d=await api('/api/auth/forgot-password',{method:'POST',body:JSON.stringify({email})});setMsg(d.message);}catch(err){setMsg((err as Error).message)}} return <AuthCard title="Forgot Password" eyebrow="Secure reset"><form onSubmit={submit} className="auth-form"><Field label="Email" value={email} onChange={setEmail}/><button className="primary-button">Request Reset</button><button type="button" className="link-button" onClick={onBack}>Back to Login</button>{msg&&<p className="form-message">{msg}</p>}</form></AuthCard> }
function Change({onDone}:{onDone:()=>void}) { const [currentPassword,setCurrent]=useState(''),[newPassword,setNew]=useState(''),[confirmPassword,setConfirm]=useState(''),[msg,setMsg]=useState(''); async function submit(e:FormEvent){e.preventDefault();try{await api('/api/auth/change-password',{method:'POST',body:JSON.stringify({currentPassword,newPassword,confirmPassword})});onDone();}catch(err){setMsg((err as Error).message)}} return <AuthCard title="Change Password Required" eyebrow="Temporary credential"><form onSubmit={submit} className="auth-form"><Field label="Temporary/current password" type="password" value={currentPassword} onChange={setCurrent}/><Field label="New password" type="password" value={newPassword} onChange={setNew}/><Field label="Confirm new password" type="password" value={confirmPassword} onChange={setConfirm}/><button className="primary-button">Save New Password</button>{msg&&<p className="form-message error">{msg}</p>}</form></AuthCard> }
export default App;
