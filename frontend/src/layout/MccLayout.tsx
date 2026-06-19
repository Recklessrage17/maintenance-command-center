import type { ReactNode } from 'react';

export type MccSection =
  | 'dashboard'
  | 'inventory'
  | 'preventiveMaintenance'
  | 'assets'
  | 'workOrders'
  | 'requisitions'
  | 'vendors'
  | 'locations'
  | 'documents'
  | 'reports'
  | 'settings';

const navItems: Array<{ id: MccSection; label: string }> = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'preventiveMaintenance', label: 'Preventive Maintenance' },
  { id: 'assets', label: 'Assets' },
  { id: 'workOrders', label: 'Work Orders' },
  { id: 'requisitions', label: 'Requisitions' },
  { id: 'vendors', label: 'Vendors' },
  { id: 'locations', label: 'Locations' },
  { id: 'documents', label: 'Documents / Prints' },
  { id: 'reports', label: 'Reports' },
  { id: 'settings', label: 'Settings' },
];

export function MccLayout({
  activeSection,
  children,
  onSectionChange,
}: {
  activeSection: MccSection;
  children: ReactNode;
  onSectionChange: (section: MccSection) => void;
}) {
  return (
    <div className="mcc-shell">
      <aside className="mcc-sidebar" aria-label="MCC module navigation">
        <div className="mcc-brand">
          <span className="mcc-brand-mark">MCC</span>
          <div>
            <strong>Maintenance</strong>
            <span>Command Center</span>
          </div>
        </div>
        <nav className="mcc-nav">
          {navItems.map((item) => (
            <button
              className={item.id === activeSection ? 'mcc-nav-button active' : 'mcc-nav-button'}
              key={item.id}
              onClick={() => onSectionChange(item.id)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="mcc-main">
        <header className="mcc-header">
          <div>
            <p className="eyebrow">JBT Maintenance Department</p>
            <h1>Maintenance Command Center</h1>
          </div>
          <div className="mcc-status-pill">Local Port 4273</div>
        </header>
        <section className="mcc-content">{children}</section>
      </main>
    </div>
  );
}
