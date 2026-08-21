import { Component, lazy, Suspense, type ErrorInfo, type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { withJsonRequestDefaults } from './apiRequest';
import { ActionButtonProgress, useActionProgress } from './components/ActionProgress';
import { MccForgotPassword } from './components/auth/MccForgotPassword';
import { MccAppLoading } from './components/auth/MccAppLoading';
import { MccLogin } from './components/auth/MccLogin';
import { MccLayout, type MccSection } from './layout/MccLayout';
import { historySectionFromPath, historySectionSlug, type HistorySection } from './modules/history/historyRouting';
import { useMccPresence } from './presence/useMccPresence';

type DashboardRequisitionView = 'active'|'requested'|'ordered';
function cachedImport<T>(loader:()=>Promise<T>){let promise:Promise<T>|undefined;return()=>promise??=loader();}
const loadDashboard=cachedImport(()=>import('./modules/dashboard/DashboardPage'));
const loadInventory=cachedImport(()=>import('./modules/inventory/InventoryPage'));
const loadVendors=cachedImport(()=>import('./modules/vendors/VendorsPage'));
const loadRequisitions=cachedImport(()=>import('./modules/requisitions/RequisitionsPage'));
const loadMachineLibrary=cachedImport(()=>import('./modules/machine-library/MachineLibraryPage'));
const loadEquipmentLibrary=cachedImport(()=>import('./modules/equipment-library/EquipmentLibraryPage'));
const loadFacilityInfo=cachedImport(()=>import('./modules/facility-info/FacilityInfoPage'));
const loadHistory=cachedImport(()=>import('./modules/history/HistoryPage'));
const loadUsers=cachedImport(()=>import('./modules/users/UsersPage'));
const loadSettings=cachedImport(()=>import('./modules/settings/SettingsPage'));
const DashboardPage=lazy(()=>loadDashboard().then(module=>({default:module.DashboardPage})));
const InventoryPage=lazy(()=>loadInventory().then(module=>({default:module.InventoryPage})));
const VendorsPage=lazy(()=>loadVendors().then(module=>({default:module.VendorsPage})));
const RequisitionsPage=lazy(()=>loadRequisitions().then(module=>({default:module.RequisitionsPage})));
const MachineLibraryPage=lazy(()=>loadMachineLibrary().then(module=>({default:module.MachineLibraryPage})));
const EquipmentLibraryPage=lazy(()=>loadEquipmentLibrary().then(module=>({default:module.EquipmentLibraryPage})));
const FacilityInfoPage=lazy(()=>loadFacilityInfo().then(module=>({default:module.FacilityInfoPage})));
const HistoryPage=lazy(()=>loadHistory().then(module=>({default:module.HistoryPage})));
const UsersPage=lazy(()=>loadUsers().then(module=>({default:module.UsersPage})));
const SettingsPage=lazy(()=>loadSettings().then(module=>({default:module.SettingsPage})));
const routeLoaders:Record<MccSection,()=>Promise<unknown>>={dashboard:loadDashboard,inventory:loadInventory,vendors:loadVendors,requisitions:loadRequisitions,history:loadHistory,'machine-library':loadMachineLibrary,'equipment-library':loadEquipmentLibrary,'facility-info':loadFacilityInfo,users:loadUsers,settings:loadSettings};
function prefetchSection(section:MccSection){void routeLoaders[section]().catch(()=>undefined);}

function RouteLoadingState(){return <div className="mcc-route-state" role="status" aria-live="polite"><span className="mcc-route-loader" aria-hidden="true" /><div><strong>Loading workspace</strong><span>Preparing this MCC module...</span></div></div>;}
class RouteModuleBoundary extends Component<{resetKey:MccSection;children:ReactNode},{failed:boolean}>{state={failed:false};static getDerivedStateFromError(){return{failed:true};}componentDidCatch(error:Error,info:ErrorInfo){console.error('MCC route module failed to load.',error,info);}componentDidUpdate(previous:{resetKey:MccSection}){if(previous.resetKey!==this.props.resetKey&&this.state.failed)this.setState({failed:false});}render(){if(this.state.failed)return <div className="mcc-route-state mcc-route-state--error" role="alert"><div><strong>Workspace could not load</strong><span>The module download was interrupted. Reload MCC to try again.</span></div><button className="primary-button compact-button" type="button" onClick={()=>window.location.reload()}>Reload MCC</button></div>;return this.props.children;}}

type User = { id:number; fullName:string; email:string; role:string; isOwnerAdmin:boolean; canViewSystemVersion:boolean; forcePasswordChange:boolean; effectivePermissions?:string[] };
type AuthMode = 'loading' | 'initializing' | 'setup' | 'login' | 'forgot' | 'change' | 'app';
type AppInitialization = { progress:number; stage:string; error:string; target:MccSection; resetToDashboard:boolean };
async function api(path:string, options:RequestInit={}) { const res=await fetch(path,withJsonRequestDefaults(options)); const data=await res.json().catch(()=>({})); if(!res.ok) throw new Error(data.error || 'Request failed.'); return data; }
type UpdateNoticeState={kind:'available'|'succeeded';version:string;commit:string;storageKey:string};
function cleanNoticePart(value:unknown){return typeof value==='string'?value.replace(/[^a-zA-Z0-9._-]/g,'').slice(0,80):'';}
function SystemUpdateNotice({user,onViewUpdate}:{user:User;onViewUpdate:()=>void}) {
  const [notice,setNotice]=useState<UpdateNoticeState|null>(null);
  useEffect(()=>{
    if(!user.canViewSystemVersion||user.forcePasswordChange){setNotice(null);return;}
    let cancelled=false;
    api('/api/system/update/status').then(data=>{
      if(cancelled||data?.active===true)return;
      const code=String(data?.code??'');
      const state=String(data?.state??'');
      if(state==='update_available'&&['update_available','same_version_different_commit'].includes(code)) {
        const version=cleanNoticePart(data.targetVersion);
        const commit=cleanNoticePart(data.targetCommit);
        if(!version||!commit)return;
        const storageKey=`mcc:update-notice:dismissed:${user.id}:${version}:${commit}`;
        if(window.localStorage.getItem(storageKey)!=='1')setNotice({kind:'available',version,commit,storageKey});
        return;
      }
      if(state==='succeeded'&&code==='succeeded') {
        const version=cleanNoticePart(data.installedVersion??data.targetVersion);
        const commit=cleanNoticePart(data.installedCommit??data.targetCommit);
        if(!version||!commit)return;
        const storageKey=`mcc:update-notice:success-seen:${user.id}:${version}:${commit}`;
        if(window.localStorage.getItem(storageKey)==='1')return;
        window.localStorage.setItem(storageKey,'1');
        setNotice({kind:'succeeded',version,commit,storageKey});
      }
    }).catch(()=>undefined);
    return()=>{cancelled=true;};
  },[user.id,user.canViewSystemVersion,user.forcePasswordChange]);
  if(!notice)return null;
  const dismiss=()=>{
    if(notice.kind==='available')window.localStorage.setItem(notice.storageKey,'1');
    setNotice(null);
  };
  return createPortal(<aside className={`mcc-update-notice ${notice.kind}`} role="status" aria-live="polite" aria-label={notice.kind==='available'?'MCC update available':'MCC updated'}>
    <button className="mcc-update-notice-dismiss" type="button" aria-label="Dismiss update notification" onClick={dismiss}>×</button>
    <span className="mcc-update-notice-kicker">{notice.kind==='available'?'MCC UPDATE AVAILABLE':'MCC UPDATED'}</span>
    <strong>{notice.kind==='available'?`v${notice.version} is ready to install.`:`MCC was updated successfully to v${notice.version}.`}</strong>
    <small>Build {notice.commit.slice(0,7)}</small>
    {notice.kind==='available'&&<div className="mcc-update-notice-actions">
      <button className="primary-button compact-button" type="button" onClick={()=>{dismiss();onViewUpdate();}}>View update</button>
      <button className="link-button compact-button" type="button" onClick={dismiss}>Dismiss</button>
    </div>}
  </aside>,document.body);
}
function AuthCard({title,eyebrow,children}:{title:string;eyebrow:string;children:ReactNode}) { return <main className="auth-shell"><section className="auth-card"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{children}</section></main>; }
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
  const [initialization,setInitialization]=useState<AppInitialization>({progress:0,stage:'Checking secure local session...',error:'',target:initialRoute.section,resetToDashboard:false});
  const initializationRunRef=useRef(0);
  useMccPresence(Boolean(user)&&(mode==='app'||mode==='change'));
  function nextPaint(){return new Promise<void>(resolve=>window.requestAnimationFrame(()=>resolve()));}
  async function initializeApplication(nextUser:User,{resetToDashboard,verifySession}:{resetToDashboard:boolean;verifySession:boolean}) {
    const runId=++initializationRunRef.current;
    const route=resetToDashboard?{section:'dashboard' as MccSection,historySection:null}:routeFromPath(window.location.pathname);
    if(resetToDashboard){setActiveSection('dashboard');setHistorySection(null);window.history.replaceState(null,'','/');}
    setUser(nextUser);
    setInitialization({progress:0,stage:'Credentials accepted. Establishing secure session...',error:'',target:route.section,resetToDashboard});
    setMode('initializing');
    const update=(progress:number,stage:string)=>{if(initializationRunRef.current===runId)setInitialization(current=>({...current,progress,stage,error:''}));};
    try {
      await nextPaint();
      update(12,'Credentials accepted. Establishing secure session...');
      let readyUser=nextUser;
      if(verifySession){
        const status=await api('/api/auth/status');
        if(!status.user)throw new Error('The secure session could not be verified. Please sign in again.');
        readyUser=status.user;
      }
      if(initializationRunRef.current!==runId)return;
      setUser(readyUser);
      update(38,'Secure session verified. Loading operator workspace...');
      await routeLoaders[route.section]();
      update(76,`${route.section==='dashboard'?'Dashboard':'Workspace'} module ready. Synchronizing interface...`);
      if(document.fonts?.ready)await document.fonts.ready;
      update(92,'Interface ready. Finalizing controls...');
      await nextPaint();
      update(100,`${route.section==='dashboard'?'Dashboard':'Workspace'} ready.`);
      await nextPaint();
      if(initializationRunRef.current===runId)setMode(readyUser.forcePasswordChange?'change':'app');
    } catch(value) {
      if(initializationRunRef.current!==runId)return;
      const message=(value as Error).message||'MCC could not finish loading. Check the connection and try again.';
      setInitialization(current=>({...current,error:message,stage:'Initialization interrupted.'}));
    }
  }
  function refresh(resetToDashboard=false) {
    return api('/api/auth/status').then(d=>{
      if(d.setupRequired){setUser(null);setMode('setup');return;}
      if(!d.user){setUser(null);setMode('login');return;}
      if(d.user.forcePasswordChange){setUser(d.user);if(resetToDashboard){setActiveSection('dashboard');setHistorySection(null);window.history.replaceState(null,'','/');}setMode('change');return;}
      return initializeApplication(d.user,{resetToDashboard,verifySession:false});
    }).catch(()=>{setUser(null);setMode('login');});
  }
  useEffect(()=>{void refresh();},[]);
  useEffect(()=>{
    function onPopState() {
      const route = routeFromPath(window.location.pathname);
      setActiveSection(route.section);
      setHistorySection(route.historySection);
    }
    window.addEventListener('popstate',onPopState);
    return ()=>window.removeEventListener('popstate',onPopState);
  },[]);
  const permissions=useMemo(()=>{
    const effective=new Set(user?.effectivePermissions??[]);
    const authoritative=Boolean(user?.effectivePermissions);
    const can=(key:string,fallback=true)=>authoritative?effective.has(key):fallback;
    return {
      canManageUsers:!!user&&user.role!=='Maintenance Tech 1',
      canViewHistory:!!user&&can('history.view',user.role==='Admin'||user.role==='Manager'),
      allowedSections:['dashboard',...(can('inventory.view')?['inventory']:[]),...(can('vendors.view')?['vendors']:[]),...(can('requisitions.view')?['requisitions']:[]),...(can('history.view',user?.role==='Admin'||user?.role==='Manager')?['history']:[]),...(can('machine.view')?['machine-library']:[]),...(can('equipment.view')?['equipment-library']:[]),...(can('facility.view')?['facility-info']:[]),'users','settings'],
    };
  },[user]);
  function navigate(section: MccSection, nextHistorySection: HistorySection | null = null) {
    setActiveSection(section);
    setHistorySection(section === 'history' ? nextHistorySection : null);
    window.history.pushState(null,'',pathForSection(section,nextHistorySection));
  }
  function navigateToRequisitions(view:DashboardRequisitionView) {
    setActiveSection('requisitions');
    setHistorySection(null);
    window.history.pushState(null,'',`/requisitions?view=${view}`);
  }
  function navigateToSystemUpdate() {
    setActiveSection('settings');
    setHistorySection(null);
    window.history.pushState(null,'','/settings#system-update');
  }
  const page = activeSection === 'inventory' ? <InventoryPage userRole={user?.role ?? ''} effectivePermissions={user?.effectivePermissions} userFullName={user?.fullName ?? ''} onBackToDashboard={()=>navigate('dashboard')} onOpenRequisitions={()=>navigate('requisitions')} /> : activeSection === 'vendors' ? <VendorsPage userRole={user?.role ?? ''} effectivePermissions={user?.effectivePermissions} /> : activeSection === 'machine-library' ? <MachineLibraryPage userRole={user?.role ?? ''} userFullName={user?.fullName ?? ''} /> : activeSection === 'equipment-library' ? <EquipmentLibraryPage userFullName={user?.fullName ?? ''} /> : activeSection === 'facility-info' ? <FacilityInfoPage /> : activeSection === 'history' ? (permissions.canViewHistory ? <HistoryPage userRole={user?.role ?? ''} selectedSection={historySection} onSectionChange={section=>navigate('history',section)} onBackToLanding={()=>navigate('history')} /> : <div className="page-stack"><div className="page-heading"><p className="eyebrow">Not Authorized</p><h2>History Logs locked</h2><p>History Logs permission is required.</p></div></div>) : activeSection === 'requisitions' ? <RequisitionsPage userRole={user?.role ?? ''} effectivePermissions={user?.effectivePermissions} userFullName={user?.fullName ?? ''} /> : activeSection === 'users' ? <UsersPage /> : activeSection === 'settings' ? <SettingsPage isOwnerAdmin={Boolean(user?.isOwnerAdmin)} canViewSystemVersion={Boolean(user?.canViewSystemVersion)} /> : <DashboardPage onOpenRequisitions={navigateToRequisitions} userFullName={user?.fullName??''} effectivePermissions={user?.effectivePermissions??[]} />;
  if(mode==='loading') return <MccAppLoading progress={0} stage="Checking secure local session..." />;
  if(mode==='initializing') return <MccAppLoading progress={initialization.progress} stage={initialization.stage} error={initialization.error} onRetry={initialization.error&&user?()=>void initializeApplication(user,{resetToDashboard:initialization.resetToDashboard,verifySession:true}):undefined} />;
  if(mode==='setup') return <Setup onDone={()=>setMode('login')} />;
  if(mode==='login') return <Login onForgot={()=>setMode('forgot')} onLogin={u=>{if(u.forcePasswordChange){setUser(u);setActiveSection('dashboard');setHistorySection(null);window.history.replaceState(null,'','/');setMode('change');return;}void initializeApplication(u,{resetToDashboard:true,verifySession:true});}} />;
  if(mode==='forgot') return <MccForgotPassword onBack={()=>setMode('login')} requestReset={async email=>{const data=await api('/api/auth/forgot-password',{method:'POST',body:JSON.stringify({email})});return data.message;}} />;
  if(mode==='change') return <Change forced={Boolean(user?.forcePasswordChange)} onDone={()=>void refresh(Boolean(user?.forcePasswordChange))} />;
  return <MccLayout activeSection={activeSection} onSectionChange={section=>navigate(section)} onPrefetchSection={prefetchSection} user={user!} canManageUsers={permissions.canManageUsers} canViewHistory={permissions.canViewHistory} allowedSections={permissions.allowedSections} onUpdatePassword={()=>setMode('change')} onLogout={async()=>{await api('/api/auth/logout',{method:'POST'});initializationRunRef.current+=1;setActiveSection('dashboard');setHistorySection(null);window.history.replaceState(null,'','/');setUser(null);setMode('login');}}><SystemUpdateNotice user={user!} onViewUpdate={navigateToSystemUpdate}/><RouteModuleBoundary resetKey={activeSection}><Suspense fallback={<RouteLoadingState />}>{page}</Suspense></RouteModuleBoundary></MccLayout>;
}
function Setup({onDone}:{onDone:()=>void}) { const [fullName,setFullName]=useState(''),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[confirmPassword,setConfirm]=useState(''),[msg,setMsg]=useState('');const setupAction=useActionProgress();async function submit(e:FormEvent){e.preventDefault();setMsg('');const result=await setupAction.run(()=>api('/api/auth/setup-first-admin',{method:'POST',body:JSON.stringify({fullName,email,password,confirmPassword})}));if(result.status==='duplicate')return;if(result.status==='error'){setMsg((result.error as Error).message);return;}setMsg('First Admin created. Please log in.');setTimeout(onDone,800);} return <AuthCard title="First Admin Setup" eyebrow="MCC security foundation"><form onSubmit={submit} className="auth-form"><Field label="Full name" value={fullName} onChange={setFullName}/><Field label="Email" value={email} onChange={setEmail} autoComplete="email"/><Field label="Password" type="password" value={password} onChange={setPassword}/><Field label="Confirm password" type="password" value={confirmPassword} onChange={setConfirm}/><p className="form-help">Minimum 10 characters with uppercase, lowercase, number, and special character.</p><button className="primary-button" disabled={setupAction.active} aria-busy={setupAction.pending}><ActionButtonProgress phase={setupAction.phase} idleLabel="Create First Admin" pendingLabel="Creating First Admin..." successLabel="Admin Created" errorLabel="Try Admin Creation" /></button>{msg&&<p className="form-message">{msg}</p>}</form></AuthCard> }
function Login({onLogin,onForgot}:{onLogin:(u:User)=>void;onForgot:()=>void}) {
  return <MccLogin<User> authenticate={async(email,password)=>{const data=await api('/api/auth/login',{method:'POST',body:JSON.stringify({email,password})});return data.user;}} onForgot={onForgot} onLogin={onLogin} />;
}
function Change({forced,onDone}:{forced:boolean;onDone:()=>void}) { const [currentPassword,setCurrent]=useState(''),[newPassword,setNew]=useState(''),[confirmPassword,setConfirm]=useState(''),[msg,setMsg]=useState('');const passwordAction=useActionProgress();async function submit(e:FormEvent){e.preventDefault();setMsg('');const result=await passwordAction.run(()=>api('/api/auth/change-password',{method:'POST',body:JSON.stringify({currentPassword,newPassword,confirmPassword})}));if(result.status==='duplicate')return;if(result.status==='error'){setMsg((result.error as Error).message);return;}onDone();} return <AuthCard title={forced?'Change Password Required':'Update Password'} eyebrow={forced?'Temporary credential':'Account security'}><form onSubmit={submit} className="auth-form"><Field label={forced?'Temporary/current password':'Current password'} type="password" value={currentPassword} onChange={setCurrent}/><Field label="New password" type="password" value={newPassword} onChange={setNew}/><Field label="Confirm new password" type="password" value={confirmPassword} onChange={setConfirm}/><button className="primary-button" disabled={passwordAction.active} aria-busy={passwordAction.pending}><ActionButtonProgress phase={passwordAction.phase} idleLabel="Save New Password" pendingLabel="Updating Password..." successLabel="Password Updated" errorLabel="Try Password Update" /></button>{msg&&<p className="form-message error">{msg}</p>}</form></AuthCard> }
export default App;
