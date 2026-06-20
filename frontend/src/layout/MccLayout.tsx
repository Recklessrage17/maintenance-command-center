import { useState, type ReactNode } from 'react';
import { RoleBadge } from '../components/RoleBadge';

export type MccSection = 'dashboard' | 'inventory' | 'requisitions' | 'users' | 'settings';
const baseNav: Array<{ id: MccSection; label: string; management?: boolean }> = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'requisitions', label: 'Requisitions' },
  { id: 'users', label: 'Admin / Users', management: true },
  { id: 'settings', label: 'Settings' },
];
const logoModules = import.meta.glob('../assets/jbt-usa-logo.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string | undefined>;
const jbtLogoUrl = logoModules['../assets/jbt-usa-logo.png'];

export function MccLayout({activeSection,children,onSectionChange,user,canManageUsers,onLogout}:{activeSection:MccSection;children:ReactNode;onSectionChange:(section:MccSection)=>void;user:{fullName:string;role:string;isOwnerAdmin?:boolean};canManageUsers:boolean;onLogout:()=>void}) {
 const navItems=baseNav.filter(i=>!i.management||canManageUsers);
 const [logoReady,setLogoReady]=useState(Boolean(jbtLogoUrl));
 const inventoryFocus=activeSection==='inventory';
 return <div className={inventoryFocus?'mcc-shell inventory-focus-shell':'mcc-shell'}>{!inventoryFocus&&<aside className="mcc-sidebar" aria-label="MCC module navigation"><div className="mcc-brand">{logoReady&&jbtLogoUrl?<img className="mcc-brand-logo" src={jbtLogoUrl} alt="JBT USA" onError={()=>setLogoReady(false)} />:<div className="mcc-brand-fallback"><strong>JBT USA</strong><span>Maintenance Command Center</span></div>}</div><nav className="mcc-nav">{navItems.map(item=><button className={item.id===activeSection?'mcc-nav-button active':'mcc-nav-button'} key={item.id} onClick={()=>onSectionChange(item.id)} type="button">{item.label}</button>)}</nav></aside>}<main className="mcc-main">{!inventoryFocus&&<header className="mcc-header"><div><p className="eyebrow">JBT Maintenance Department</p><h1>Maintenance Command Center</h1></div><div className="header-actions"><div className="user-pill"><strong>{user.fullName}</strong><RoleBadge role={user.role} isOwnerAdmin={user.isOwnerAdmin} compact /></div><button className="secondary-button" onClick={onLogout}>Logout</button></div></header>}<section className="mcc-content">{children}</section></main></div>;
}
