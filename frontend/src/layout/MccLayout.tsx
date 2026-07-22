import { type ReactNode, useEffect, useRef, useState } from 'react';
import { RoleBadge } from '../components/RoleBadge';
import { mccPageMetadata, type MccSection } from './pageMetadata';

export type { MccSection };
type BrandingSettings = {
  companyName: string;
  companySubtitle: string;
  companyAccentText: string;
  logoMode: 'text' | 'image';
  logoUrl: string;
  iconAnimation: 'none' | 'glow' | 'rotate' | 'pulse';
};
const defaultBranding: BrandingSettings = { companyName: 'MCC', companySubtitle: 'Maintenance Command Center', companyAccentText: '', logoMode: 'text', logoUrl: '', iconAnimation: 'none' };
const MENU_WARP_MS = 190;
const PAGE_ENTER_MS = 260;
const baseNav: Array<{ id: MccSection; label: string; microLabel: string; management?: boolean }> = [
  { id: 'dashboard', label: 'Dashboard', microLabel: 'Overview' },
  { id: 'inventory', label: 'Inventory', microLabel: 'Parts' },
  { id: 'vendors', label: 'Vendors', microLabel: 'Partners' },
  { id: 'requisitions', label: 'Requisitions', microLabel: 'Requests' },
  { id: 'history', label: 'History Logs', microLabel: 'Audit' },
  { id: 'machine-library', label: 'Machine Library', microLabel: 'Machines' },
  { id: 'equipment-library', label: 'Equipment Library', microLabel: 'Tools' },
  { id: 'facility-info', label: 'Facility Info', microLabel: 'Plant docs' },
  { id: 'users', label: 'Admin / Users', microLabel: 'Security', management: true },
  { id: 'settings', label: 'Settings', microLabel: 'System' },
];

const moduleIconPaths: Record<MccSection, string[]> = {
  dashboard: ['M4 13a8 8 0 0 1 16 0', 'M12 13l4-4', 'M5 19h14'],
  inventory: ['M4 8l8-4 8 4-8 4-8-4z', 'M4 8v8l8 4 8-4V8', 'M12 12v8'],
  vendors: ['M5 8h6v11H5z', 'M13 5h6v14h-6z', 'M7 11h2', 'M15 9h2', 'M15 13h2'],
  requisitions: ['M7 3h7l4 4v14H7z', 'M14 3v5h5', 'M9 14l2 2 4-5'],
  history: ['M12 4a8 8 0 1 0 0 16a8 8 0 0 0 0-16z', 'M12 8v5l3 2'],
  'machine-library': ['M5 16h14', 'M7 16V9h10v7', 'M9 9V6h6v3', 'M9 12h2', 'M13 12h2'],
  'equipment-library': ['M5 9h14v9H5z', 'M9 9V7h6v2', 'M8 13h8'],
  'facility-info': ['M5 19V7l7-3 7 3v12', 'M9 19v-5h6v5', 'M8 10h1', 'M15 10h1'],
  users: ['M12 4l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V7z', 'M12 10a2 2 0 1 0 0-4a2 2 0 0 0 0 4z', 'M8.5 15a3.5 3.5 0 0 1 7 0'],
  settings: ['M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8z', 'M12 3v3', 'M12 18v3', 'M3 12h3', 'M18 12h3', 'M5.6 5.6l2.1 2.1', 'M16.3 16.3l2.1 2.1', 'M18.4 5.6l-2.1 2.1', 'M7.7 16.3l-2.1 2.1'],
};

function ModuleIcon({ section }: { section: MccSection }) {
  return (
    <svg className="command-menu-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {moduleIconPaths[section].map(path=><path d={path} key={path} />)}
    </svg>
  );
}


function scrubJbtBrandText(value: unknown, fallback = '') {
  const text = String(value ?? '').trim();
  if (!text) return fallback;
  if (/^JBT(\s+USA)?$/i.test(text) || /^USA$/i.test(text)) return fallback;
  return text;
}

export function MccLayout({activeSection,children,onSectionChange,onPrefetchSection,user,canManageUsers,canViewHistory,onLogout}:{activeSection:MccSection;children:ReactNode;onSectionChange:(section:MccSection)=>void;onPrefetchSection?:(section:MccSection)=>void;user:{fullName:string;role:string;isOwnerAdmin?:boolean};canManageUsers:boolean;canViewHistory:boolean;onLogout:()=>void}) {
 const navItems=baseNav.filter(i=>(!i.management||canManageUsers) && (i.id !== 'history' || canViewHistory));
 const currentPage=mccPageMetadata[activeSection];
 const pageTooltipId=`mcc-page-tooltip-${activeSection}`;
 const [launcherOpen,setLauncherOpen]=useState(false);
 const [warpingSection,setWarpingSection]=useState<MccSection|null>(null);
 const [pageEntering,setPageEntering]=useState(false);
 const [branding,setBranding]=useState<BrandingSettings>(defaultBranding);
 const launcherRef=useRef<HTMLDivElement>(null);
 const warpTimerRef=useRef<number>();
 const inventoryFocus=activeSection==='inventory';

 function clearWarpTimer() {
   if(warpTimerRef.current){
     window.clearTimeout(warpTimerRef.current);
     warpTimerRef.current=undefined;
   }
 }

 function closeLauncher() {
   setLauncherOpen(false);
 }

 function toggleLauncher() {
   setLauncherOpen(current=>!current);
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

 useEffect(()=>()=>{ clearWarpTimer(); },[]);

 useEffect(()=>{
   const targets=[document.documentElement,document.body];
   targets.forEach(target=>target.classList.add('mcc-scrollbar-hidden'));
   return()=>targets.forEach(target=>target.classList.remove('mcc-scrollbar-hidden'));
 },[]);

 useEffect(()=>{
   setPageEntering(true);
   const timer=window.setTimeout(()=>setPageEntering(false),PAGE_ENTER_MS);
   return ()=>window.clearTimeout(timer);
 },[activeSection]);

 useEffect(()=>{
   let cancelled=false;
   function normalize(value: unknown): BrandingSettings {
     const data = value && typeof value === 'object' && !Array.isArray(value) ? value as Partial<BrandingSettings> : {};
     return {
       companyName: scrubJbtBrandText(data.companyName, defaultBranding.companyName).slice(0,20) || defaultBranding.companyName,
       companySubtitle: String(data.companySubtitle ?? defaultBranding.companySubtitle).slice(0,40),
       companyAccentText: scrubJbtBrandText(data.companyAccentText, '').slice(0,8),
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
   if(warpingSection) return;
   clearWarpTimer();
   setWarpingSection(section);
   warpTimerRef.current=window.setTimeout(()=>{
     onSectionChange(section);
     setWarpingSection(null);
     closeLauncher();
   },MENU_WARP_MS);
 }

 return (
   <div className={inventoryFocus?'mcc-shell command-shell inventory-focus-shell mcc-scrollbar-hidden':'mcc-shell command-shell mcc-scrollbar-hidden'}>
     <div className={launcherOpen?'command-launcher open':'command-launcher'} ref={launcherRef}>
       <div className={`mcc-brand command-brand brand-animation-${branding.iconAnimation} ${branding.logoMode==='image'?'image-brand':'text-brand'}`} aria-label={`${branding.companyName} ${branding.companyAccentText}`.trim()}>
         <div className="mcc-brand-mark">
           {branding.logoMode==='image'&&branding.logoUrl ? (
             <img className="mcc-brand-image" src={branding.logoUrl} alt={`${branding.companyName} logo`} onError={()=>setBranding(defaultBranding)} />
           ) : (
              <strong><span className="mcc-brand-name">{branding.companyName}</span>{branding.companyAccentText&&<span className="mcc-brand-accent">{branding.companyAccentText}</span>}</strong>
           )}
           <span>{branding.companySubtitle}</span>
         </div>
       </div>
       <button className="command-launcher-button" type="button" aria-label={launcherOpen?'Close command menu':'Open command menu'} aria-haspopup="menu" aria-expanded={launcherOpen} aria-controls="command-launcher-menu" onClick={toggleLauncher}>
         <span className="launcher-gear" aria-hidden="true">⚙</span>
         <span>Menu</span>
       </button>
       <nav className="command-menu" id="command-launcher-menu" aria-label="MCC navigation">
         <div className="command-menu-heading">
           <div className="command-menu-title">
             <span>Command modules</span>
             <strong>Navigate MCC</strong>
           </div>
           <div className="command-menu-user">
             <div className="command-menu-user-main">
               <strong>{user.fullName}</strong>
               <RoleBadge role={user.role} isOwnerAdmin={user.isOwnerAdmin} compact />
             </div>
             <button className="secondary-button compact-button" type="button" onClick={()=>{ closeLauncher(); onLogout(); }}>Logout</button>
           </div>
         </div>
         <div className="command-menu-list" role="menu">
           {navItems.map(item=>(
             <button className={`${item.id===activeSection?'command-menu-item active':'command-menu-item'} mcc-bubble-transition mcc-menu-item-warp${warpingSection===item.id?' is-warping':''}`} key={item.id} onClick={()=>selectSection(item.id)} onPointerEnter={()=>onPrefetchSection?.(item.id)} onFocus={()=>onPrefetchSection?.(item.id)} type="button" role="menuitem" aria-busy={warpingSection===item.id}>
               <span className="command-menu-icon-wrap" aria-hidden="true"><ModuleIcon section={item.id} /></span>
               <span className="command-menu-item-copy">
                 <span className="command-menu-item-label">{item.label}</span>
                 <span className="command-menu-item-meta">{item.microLabel}</span>
               </span>
             </button>
           ))}
         </div>
       </nav>
     </div>
     <header className="mcc-page-topbar" aria-label="Current page">
       <div className="mcc-current-page">
         <h1>{currentPage.title}</h1>
         <span className="mcc-page-help-wrap">
           <button className="mcc-page-help" type="button" aria-label={`About ${currentPage.title}`} aria-describedby={pageTooltipId}>i</button>
           <span className="mcc-page-tooltip" id={pageTooltipId} role="tooltip">{currentPage.description}</span>
         </span>
       </div>
     </header>
     <main className="mcc-main mcc-workspace-frame">
       <section className={pageEntering?'mcc-content mcc-workspace mcc-page-enter':'mcc-content mcc-workspace'}>{children}</section>
     </main>
   </div>
 );
}
