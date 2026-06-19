import { useState } from 'react';
import { MccLayout, type MccSection } from './layout/MccLayout';
import { DashboardPage } from './modules/dashboard/DashboardPage';
import { InventoryPage } from './modules/inventory/InventoryPage';
import { PreventiveMaintenancePage } from './modules/preventive-maintenance/PreventiveMaintenancePage';
import { AssetsPage } from './modules/assets/AssetsPage';
import { WorkOrdersPage } from './modules/work-orders/WorkOrdersPage';
import { RequisitionsPage } from './modules/requisitions/RequisitionsPage';
import { VendorsPage } from './modules/vendors/VendorsPage';
import { LocationsPage } from './modules/locations/LocationsPage';
import { DocumentsPage } from './modules/documents/DocumentsPage';
import { ReportsPage } from './modules/reports/ReportsPage';
import { SettingsPage } from './modules/settings/SettingsPage';

const pages: Record<MccSection, JSX.Element> = {
  dashboard: <DashboardPage />,
  inventory: <InventoryPage />,
  preventiveMaintenance: <PreventiveMaintenancePage />,
  assets: <AssetsPage />,
  workOrders: <WorkOrdersPage />,
  requisitions: <RequisitionsPage />,
  vendors: <VendorsPage />,
  locations: <LocationsPage />,
  documents: <DocumentsPage />,
  reports: <ReportsPage />,
  settings: <SettingsPage />,
};

function App() {
  const [activeSection, setActiveSection] = useState<MccSection>('dashboard');

  return (
    <MccLayout activeSection={activeSection} onSectionChange={setActiveSection}>
      {pages[activeSection]}
    </MccLayout>
  );
}

export default App;
