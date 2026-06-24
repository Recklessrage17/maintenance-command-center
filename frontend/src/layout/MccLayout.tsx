import { type ReactNode, useEffect, useRef, useState } from 'react';
import { RoleBadge } from '../components/RoleBadge';

export type MccSection = 'dashboard' | 'inventory' | 'requisitions' | 'history' | 'machine-library' | 'equipment-library' | 'facility-info' | 'users' | 'settings';
type LauncherMode = 'hover' | 'pinned' | null;
const baseNav: Array<{ id: MccSection; label: string; management?: boolean }> = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'inventory', label: 'Inventory' },
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

 function selectSection(section:MccSection) {
   onSectionChange(section);
   closeLauncher();
 }

 return (
   <div className={inventoryFocus?'mcc-shell command-shell inventory-focus-shell':'mcc-shell command-shell'}>
     <div className={launcherOpen?'command-launcher open':'command-launcher'} ref={launcherRef} onMouseEnter={openLauncherByHover} onMouseLeave={scheduleLauncherClose}>
       <div className="mcc-brand command-brand" aria-label="JBT USA">
         <div className="mcc-brand-mark">
           <strong><span className="mcc-brand-jbt">JBT</span><span className="mcc-brand-usa">USA</span></strong>
           <span>Maintenance Command Center</span>
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
     <main className="mcc-main">
       <section className="mcc-content">{children}</section>
     </main>
   </div>
 );
}
