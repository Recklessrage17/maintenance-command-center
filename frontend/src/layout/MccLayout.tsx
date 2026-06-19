import type { ReactNode } from 'react';
export type MccSection = 'dashboard' | 'users' | 'settings';
const baseNav: Array<{ id: MccSection; label: string; management?: boolean }> = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'users', label: 'Admin / Users', management: true },
  { id: 'settings', label: 'Settings', management: true },
];
export function MccLayout({activeSection,children,onSectionChange,user,canManageUsers,onLogout}:{activeSection:MccSection;children:ReactNode;onSectionChange:(section:MccSection)=>void;user:{fullName:string;role:string};canManageUsers:boolean;onLogout:()=>void}) {
 const navItems=baseNav.filter(i=>!i.management||canManageUsers);
 return <div className="mcc-shell"><aside className="mcc-sidebar" aria-label="MCC module navigation"><div className="mcc-brand"><span className="mcc-brand-mark">MCC</span><div><strong>Maintenance</strong><span>Command Center</span></div></div><nav className="mcc-nav">{navItems.map(item=><button className={item.id===activeSection?'mcc-nav-button active':'mcc-nav-button'} key={item.id} onClick={()=>onSectionChange(item.id)} type="button">{item.label}</button>)}</nav></aside><main className="mcc-main"><header className="mcc-header"><div><p className="eyebrow">JBT Maintenance Department</p><h1>Maintenance Command Center</h1></div><div className="header-actions"><div className="user-pill"><strong>{user.fullName}</strong><span>{user.role}</span></div><div className="mcc-status-pill">Local Port 4273</div><button className="secondary-button" onClick={onLogout}>Logout</button></div></header><section className="mcc-content">{children}</section></main></div>;
}
