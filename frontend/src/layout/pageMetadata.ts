export type MccSection = 'dashboard' | 'inventory' | 'vendors' | 'requisitions' | 'history' | 'machine-library' | 'equipment-library' | 'facility-info' | 'users' | 'settings';

export type MccPageMetadata = {
  title: string;
  eyebrow: string;
  description: string;
  navLabel?: string;
  management?: boolean;
};

export const mccPageMetadata: Record<MccSection, MccPageMetadata> = {
  dashboard: {
    title: 'Dashboard',
    eyebrow: 'Dashboard',
    description: 'Active maintenance items that need attention.',
  },
  inventory: {
    title: 'Inventory',
    eyebrow: 'Inventory workspace',
    description: 'Search, manage, import, and requisition MCC inventory parts.',
  },
  vendors: {
    title: 'Vendors',
    eyebrow: 'Vendors',
    description: 'Manage vendor companies, contacts, phone numbers, and addresses used by MCC inventory and requisitions.',
  },
  requisitions: {
    title: 'Requisitions',
    eyebrow: 'MCC requisitions',
    description: 'Track requested, ordered, received, canceled, and active MCC requisitions.',
  },
  history: {
    title: 'History Logs',
    eyebrow: 'MCC audit trail',
    description: 'Audit-ready records for MCC activity, with search and section exports.',
  },
  'machine-library': {
    title: 'Machine Library',
    eyebrow: 'Machine Library',
    description: 'Injection molding machine records, technical specs, replacement tracking, brand colors, and machine-specific history.',
  },
  'equipment-library': {
    title: 'Equipment Library',
    eyebrow: 'Equipment Library',
    description: 'Auxiliary and support equipment records, PMs, parts, and documents.',
  },
  'facility-info': {
    title: 'Facility Info',
    eyebrow: 'Facility Info',
    description: 'Building prints, facility documents, and plant reference information.',
  },
  users: {
    title: 'Users / Security',
    eyebrow: 'Users / Security',
    description: 'Create local MCC users, assign ranks, protect the owner admin, and manage access.',
    navLabel: 'Admin / Users',
    management: true,
  },
  settings: {
    title: 'Settings',
    eyebrow: 'Settings',
    description: 'Share local access details, protect MCC data, and manage company branding.',
  },
};
