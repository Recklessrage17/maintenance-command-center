import { type ReactNode, useEffect, useRef, useState } from 'react';
import { RoleBadge } from '../components/RoleBadge';

export type MccSection = 'dashboard' | 'inventory' | 'vendors' | 'requisitions' | 'history' | 'machine-library' | 'equipment-library' | 'facility-info' | 'users' | 'settings';
type LauncherMode = 'hover' | 'pinned' | null;
type BrandingSettings = {
  companyName: string;
  companySubtitle: string;
  companyAccentText: string;
  logoMode: 'text' | 'image';
  logoUrl: string;
  iconAnimation: 'none' | 'glow' | 'rotate' | 'pulse';
};
const defaultBranding: BrandingSettings = { companyName: 'JBT', companySubtitle: 'Maintenance Command Center', companyAccentText: 'USA', logoMode: 'text', logoUrl: '', iconAnimation: 'none' };
const baseNav: Array<{ id: MccSection; label: string; management?: boolean }> = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'vendors', label: 'Vendors' },
  { id: 'requisitions', label: 'Requisitions' },
  { id: 'history', label: 'History Logs' },
  { id: 'machine-library', label: 'Machine Library' },
  { id: 'equipment-library', label: 'Equipment Library' },
  { id: 'facility-info', label: 'Facility Info' },
  { id: 'users', label: 'Admin / Users', management: true },
  { id: 'settings', label: 'Settings' },
];
export function MccLayout({activeSection,children,onSectionChange,user,canManageUsers,onLogout}:{activeSection:MccSection;children:ReactNode;onSectionChange:(section:MccSection)=>void;user:{fullName:string;role:string;isOwnerAdmin?:boolean};canManageUsers:boolean;onLogout:()=>void}) {
 const navItems=baseNav.filter(i=>!i.management||canManageUsers);
 const [launcherOpen,setLauncherOpen]=useState(false);
 const [branding,setBranding]=useState<BrandingSettings>(defaultBranding);
 const launcherRef=useRef<HTMLDivElement>(null);
 const closeTimerRef=useRef<number>();
 const launcherModeRef=useRef<LauncherMode>(null);
 const inventoryFocus=activeSection==='inventory';

 function clearLauncherClose() {
   if(closeTimerRef.current){
     window.clearTimeout(closeTimerRef.current);
     closeTimerRef.current=undefined;
   }
 }

 function closeLauncher() {
   clearLauncherClose();
   launcherModeRef.current=null;
   setLauncherOpen(false);
 }

 function supportsHoverLauncher() {
   return window.matchMedia?.('(hover: hover) and (pointer: fine)').matches ?? true;
 }

 function openLauncherByHover() {
   if(!supportsHoverLauncher()) return;
   clearLauncherClose();
   if(launcherModeRef.current!=='pinned') {
     launcherModeRef.current='hover';
   }
   setLauncherOpen(true);
 }

 function toggleLauncher() {
   clearLauncherClose();
   setLauncherOpen(current=>{
     if(current&&launcherModeRef.current==='pinned') {
       launcherModeRef.current=null;
       return false;
     }
     launcherModeRef.current='pinned';
     return true;
   });
 }

 function scheduleLauncherClose() {
   if(launcherModeRef.current==='pinned') return;
   clearLauncherClose();
   closeTimerRef.current=window.setTimeout(()=>closeLauncher(),420);
 }

 useEffect(()=>{
   if(!launcherOpen) return;
   function onKeyDown(event: KeyboardEvent) {
     if(event.key==='Escape') {
       closeLauncher();
     }
   }
   function onPointerDown(event: PointerEvent) {
     if(launcherRef.current&&!launcherRef.current.contains(event.target as Node)) {
       closeLauncher();
     }
   }
   document.addEventListener('keydown',onKeyDown);
   document.addEventListener('pointerdown',onPointerDown);
   return ()=>{
     document.removeEventListener('keydown',onKeyDown);
     document.removeEventListener('pointerdown',onPointerDown);
   };
 },[launcherOpen]);

 useEffect(()=>()=>clearLauncherClose(),[]);

 useEffect(()=>{
   let cancelled=false;
   function normalize(value: unknown): BrandingSettings {
     const data = value && typeof value === 'object' && !Array.isArray(value) ? value as Partial<BrandingSettings> : {};
     return {
       companyName: String(data.companyName ?? defaultBranding.companyName).slice(0,20) || defaultBranding.companyName,
       companySubtitle: String(data.companySubtitle ?? defaultBranding.companySubtitle).slice(0,40),
       companyAccentText: String(data.companyAccentText ?? defaultBranding.companyAccentText).slice(0,8),
       logoMode: data.logoMode === 'image' && data.logoUrl ? 'image' : 'text',
       logoUrl: String(data.logoUrl ?? ''),
       iconAnimation: ['none','glow','rotate','pulse'].includes(String(data.iconAnimation)) ? data.iconAnimation as BrandingSettings['iconAnimation'] : 'none',
     };
   }
   fetch('/api/settings/branding',{credentials:'include'})
     .then(res=>res.json())
     .then(data=>{ if(!cancelled) setBranding(normalize(data.branding)); })
     .catch(()=>{ if(!cancelled) setBranding(defaultBranding); });
   function onBrandingUpdated(event: Event) {
     const custom = event as CustomEvent<BrandingSettings>;
     setBranding(normalize(custom.detail));
   }
   window.addEventListener('mcc-branding-updated',onBrandingUpdated);
   return ()=>{
     cancelled=true;
     window.removeEventListener('mcc-branding-updated',onBrandingUpdated);
   };
 },[]);

 function selectSection(section:MccSection) {
   onSectionChange(section);
   closeLauncher();
 }

 return (
   <div className={inventoryFocus?'mcc-shell command-shell inventory-focus-shell':'mcc-shell command-shell'}>
     <div className={launcherOpen?'command-launcher open':'command-launcher'} ref={launcherRef} onMouseEnter={openLauncherByHover} onMouseLeave={scheduleLauncherClose}>
       <div className={`mcc-brand command-brand brand-animation-${branding.iconAnimation} ${branding.logoMode==='image'?'image-brand':'text-brand'}`} aria-label={`${branding.companyName} ${branding.companyAccentText}`.trim()}>
         <div className="mcc-brand-mark">
           {branding.logoMode==='image'&&branding.logoUrl ? (
             <img className="mcc-brand-image" src={branding.logoUrl} alt={`${branding.companyName} logo`} onError={()=>setBranding(defaultBranding)} />
           ) : (
             <strong><span className="mcc-brand-jbt">{branding.companyName}</span>{branding.companyAccentText&&<span className="mcc-brand-usa">{branding.companyAccentText}</span>}</strong>
           )}
           <span>{branding.companySubtitle}</span>
         </div>
       </div>
       <button className="command-launcher-button" type="button" aria-label={launcherOpen?'Close command menu':'Open command menu'} aria-haspopup="menu" aria-expanded={launcherOpen} aria-controls="command-launcher-menu" onMouseEnter={openLauncherByHover} onClick={toggleLauncher}>
         <span className="launcher-gear" aria-hidden="true">⚙</span>
         <span>Menu</span>
       </button>
       <nav className="command-menu" id="command-launcher-menu" aria-label="MCC navigation" onMouseEnter={openLauncherByHover} onMouseLeave={scheduleLauncherClose}>
         <div className="command-menu-title">
           <span>Command modules</span>
           <strong>Navigate MCC</strong>
         </div>
         <div className="command-menu-list" role="menu">
           {navItems.map(item=>(
             <button className={item.id===activeSection?'command-menu-item active':'command-menu-item'} key={item.id} onClick={()=>selectSection(item.id)} type="button" role="menuitem">
               <span className="command-menu-dot" aria-hidden="true" />
               <span>{item.label}</span>
             </button>
           ))}
         </div>
         <div className="command-menu-user">
           <div>
             <strong>{user.fullName}</strong>
             <RoleBadge role={user.role} isOwnerAdmin={user.isOwnerAdmin} compact />
           </div>
           <button className="secondary-button compact-button" type="button" onClick={()=>{ closeLauncher(); onLogout(); }}>Logout</button>
         </div>
       </nav>
     </div>
     <main className="mcc-main mcc-workspace-frame">
       <section className="mcc-content mcc-workspace">{children}</section>
     </main>
   </div>
 );
}
