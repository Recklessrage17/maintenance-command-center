import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react';
import { MccCommandDeck } from '../components/MccCommandDeck';
import {
  MccIndustrialSurfaceBoundary,
  MccLegacyDialogManager,
} from '../components/MccIndustrialPrimitives';
import { mccPageMetadata, type MccSection } from './pageMetadata';

export type { MccSection };
export type MccPageLiveStatus = {
  state: 'refreshing' | 'updated' | 'live' | 'stale';
  label: string;
};
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

function scrubJbtBrandText(value: unknown, fallback = '') {
  const text = String(value ?? '').trim();
  if (!text) return fallback;
  if (/^JBT(\s+USA)?$/i.test(text) || /^USA$/i.test(text)) return fallback;
  return text;
}

export function MccLayout({activeSection,children,pageLiveStatus,onSectionChange,onPrefetchSection,user,canManageUsers,canViewHistory,allowedSections,onUpdatePassword,onLogout}:{activeSection:MccSection;children:ReactNode;pageLiveStatus?:MccPageLiveStatus;onSectionChange:(section:MccSection)=>void;onPrefetchSection?:(section:MccSection)=>void;user:{fullName:string;role:string;isOwnerAdmin?:boolean};canManageUsers:boolean;canViewHistory:boolean;allowedSections?:string[];onUpdatePassword:()=>void;onLogout:()=>void}) {
 const navItems=baseNav.filter(i=>(!i.management||canManageUsers) && (i.id !== 'history' || canViewHistory) && (!allowedSections||allowedSections.includes(i.id)));
 const currentPage=mccPageMetadata[activeSection];
 const pageTooltipId=`mcc-page-tooltip-${activeSection}`;
 const [launcherOpen,setLauncherOpen]=useState(false);
 const [warpingSection,setWarpingSection]=useState<MccSection|null>(null);
 const [pageEntering,setPageEntering]=useState(false);
 const [branding,setBranding]=useState<BrandingSettings>(defaultBranding);
 const [teamsOpen,setTeamsOpen]=useState(false);
 const routeAccentStyle={
   '--mcc-module-accent':`var(--mcc-accent-module-${activeSection})`,
   '--mcc-module-accent-rgb':`var(--mcc-accent-module-${activeSection}-rgb)`,
 } as CSSProperties;
 const launcherRef=useRef<HTMLDivElement>(null);
 const launcherButtonRef=useRef<HTMLButtonElement>(null);
 const warpTimerRef=useRef<number>();
 const launcherFocusFrameRef=useRef<number>();
 const inventoryFocus=activeSection==='inventory';

 function clearWarpTimer() {
   if(warpTimerRef.current){
     window.clearTimeout(warpTimerRef.current);
     warpTimerRef.current=undefined;
   }
 }

 function closeLauncher(restoreFocus=false) {
   setLauncherOpen(false);
   if(!restoreFocus) return;
   if(launcherFocusFrameRef.current) window.cancelAnimationFrame(launcherFocusFrameRef.current);
   launcherFocusFrameRef.current=window.requestAnimationFrame(()=>{
     launcherFocusFrameRef.current=undefined;
     launcherButtonRef.current?.focus();
   });
 }

 function toggleLauncher() {
   setLauncherOpen(current=>!current);
 }

 useEffect(()=>{
   if(!launcherOpen) return;
   function onKeyDown(event: KeyboardEvent) {
     if(event.key==='Escape') {
       if(teamsOpen) return;
       event.preventDefault();
       event.stopPropagation();
       closeLauncher(true);
     }
   }
   function onPointerDown(event: PointerEvent) {
     if(teamsOpen) return;
     if(event.target instanceof Element&&event.target.closest('[data-mcc-command-overlay]')) return;
     if(launcherRef.current&&!launcherRef.current.contains(event.target as Node)) {
       closeLauncher(true);
     }
   }
   document.addEventListener('keydown',onKeyDown);
   document.addEventListener('pointerdown',onPointerDown);
   return ()=>{
     document.removeEventListener('keydown',onKeyDown);
     document.removeEventListener('pointerdown',onPointerDown);
   };
 },[launcherOpen,teamsOpen]);

 useEffect(()=>()=>{
   clearWarpTimer();
   if(launcherFocusFrameRef.current) window.cancelAnimationFrame(launcherFocusFrameRef.current);
 },[]);

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
     closeLauncher(true);
   },MENU_WARP_MS);
 }

 return (
   <MccIndustrialSurfaceBoundary surface="strong" className={inventoryFocus?'mcc-shell command-shell inventory-focus-shell mcc-scrollbar-hidden':'mcc-shell command-shell mcc-scrollbar-hidden'} data-mcc-module={activeSection} style={routeAccentStyle}>
     <MccLegacyDialogManager />
     <div className={launcherOpen?'command-launcher open':'command-launcher'} ref={launcherRef}>
       <div className={`mcc-brand command-brand brand-animation-${branding.iconAnimation} ${branding.logoMode==='image'?'image-brand':'text-brand'}`} data-mcc-header-brand aria-label={[branding.companyName,branding.companyAccentText,branding.companySubtitle].filter(Boolean).join(' ')}>
         <div className="mcc-brand-mark">
           {branding.logoMode==='image'&&branding.logoUrl ? (
             <img className="mcc-brand-image" src={branding.logoUrl} alt={`${branding.companyName} logo`} onError={()=>setBranding(defaultBranding)} />
           ) : (
              <strong><span className="mcc-brand-name">{branding.companyName}</span>{branding.companyAccentText&&<span className="mcc-brand-accent">{branding.companyAccentText}</span>}</strong>
           )}
           <span className="mcc-brand-subtitle">{branding.companySubtitle}</span>
         </div>
       </div>
       <button ref={launcherButtonRef} className="command-launcher-button" type="button" aria-label={launcherOpen?'Close command menu':'Open command menu'} aria-expanded={launcherOpen} aria-controls="command-launcher-menu" onClick={toggleLauncher}>
         <span className="launcher-gear" aria-hidden="true">⚙</span>
         <span>Menu</span>
       </button>
        <MccCommandDeck
          id="command-launcher-menu"
          open={launcherOpen}
          modules={navItems}
          activeSection={activeSection}
          warpingSection={warpingSection}
          user={user}
          onTeamsOpenChange={setTeamsOpen}
          onUpdatePassword={()=>{ closeLauncher(); onUpdatePassword(); }}
          onLogout={()=>{ closeLauncher(); onLogout(); }}
          onSelect={selectSection}
          onPrefetch={onPrefetchSection}
        />
     </div>
     <header className="mcc-page-topbar" aria-label="Current page">
       <div className="mcc-current-page">
         <h1>{currentPage.title}</h1>
         {pageLiveStatus&&<span className={`inventory-live-indicator inventory-live-indicator--${pageLiveStatus.state}`} data-inventory-live-state={pageLiveStatus.state} role="status" aria-live="polite" aria-label={pageLiveStatus.label} title={pageLiveStatus.label} tabIndex={0}><span className="inventory-live-indicator__visual" aria-hidden="true" /></span>}
         <span className="mcc-page-help-wrap">
           <button className="mcc-page-help" type="button" aria-label={`About ${currentPage.title}`} aria-describedby={pageTooltipId}>i</button>
           <span className="mcc-page-tooltip" id={pageTooltipId} role="tooltip">{currentPage.description}</span>
         </span>
       </div>
     </header>
     <main className="mcc-main mcc-workspace-frame">
       <section className={pageEntering?'mcc-content mcc-workspace mcc-page-enter':'mcc-content mcc-workspace'}>{children}</section>
     </main>
   </MccIndustrialSurfaceBoundary>
 );
}
