export type PermissionRole =
  | 'Admin'
  | 'Manager'
  | 'Maintenance Tech 3'
  | 'Maintenance Tech 2'
  | 'Maintenance Tech 1';

export const permissionModules = [
  {
    key: 'inventory',
    label: 'Inventory',
    shortLabel: 'Inventory',
    permissions: [
      ['inventory.view', 'View inventory'],
      ['inventory.create', 'Add inventory items'],
      ['inventory.edit', 'Edit inventory items'],
      ['inventory.delete', 'Delete inventory items'],
      ['inventory.import', 'Import inventory'],
      ['inventory.export', 'Export inventory'],
      ['inventory.requisition_stage', 'Stage inventory for requisitions'],
    ],
  },
  {
    key: 'requisitions',
    label: 'Requisitions',
    shortLabel: 'Requisitions',
    permissions: [
      ['requisitions.view', 'View requisitions'],
      ['requisitions.create', 'Create requisitions'],
      ['requisitions.edit', 'Edit requisitions'],
      ['requisitions.mark_ordered', 'Mark requisitions ordered'],
      ['requisitions.mark_received', 'Mark requisitions received'],
      ['requisitions.cancel', 'Cancel requisitions'],
      ['requisitions.delete', 'Delete requisitions'],
      ['requisitions.manage_batches', 'Manage requisition batches'],
      ['requisitions.print_download', 'Print or download requisitions'],
    ],
  },
  {
    key: 'machine',
    label: 'Machine Library',
    shortLabel: 'Machine',
    permissions: [
      ['machine.view', 'View Machine Library'],
      ['machine.create', 'Add machines'],
      ['machine.edit', 'Edit machines'],
      ['machine.delete', 'Delete machines'],
      ['machine.pm_manage', 'Manage machine preventive maintenance'],
      ['machine.documents_upload', 'Upload machine documents'],
      ['machine.documents_manage', 'Manage machine documents'],
      ['machine.notes_manage', 'Manage machine notes'],
      ['machine.import_export', 'Import or export machines'],
    ],
  },
  {
    key: 'equipment',
    label: 'Equipment Library',
    shortLabel: 'Equipment',
    permissions: [
      ['equipment.view', 'View Equipment Library'],
      ['equipment.create', 'Add equipment'],
      ['equipment.edit', 'Edit equipment'],
      ['equipment.delete', 'Delete equipment'],
      ['equipment.pm_manage', 'Manage equipment preventive maintenance'],
      ['equipment.documents_upload', 'Upload equipment documents'],
      ['equipment.documents_manage', 'Manage equipment documents'],
      ['equipment.notes_manage', 'Manage equipment notes'],
      ['equipment.import_export', 'Import or export equipment'],
    ],
  },
  {
    key: 'facility',
    label: 'Facility Info',
    shortLabel: 'Facility',
    permissions: [
      ['facility.view', 'View Facility Info'],
      ['facility.create', 'Create facility areas'],
      ['facility.edit', 'Edit facility areas'],
      ['facility.delete', 'Delete facility areas'],
      ['facility.folders_manage', 'Manage facility folders'],
      ['facility.upload', 'Upload documents or media'],
      ['facility.rename_move', 'Rename or move facility content'],
      ['facility.content_delete', 'Delete facility content'],
      ['facility.recovery_export', 'Export Facility recovery archive'],
    ],
  },
  {
    key: 'vendors',
    label: 'Vendors',
    shortLabel: 'Vendors',
    permissions: [
      ['vendors.view', 'View vendors'],
      ['vendors.create', 'Add vendors'],
      ['vendors.edit', 'Edit vendors'],
      ['vendors.delete', 'Delete vendors'],
      ['vendors.import_export', 'Import or export vendors'],
    ],
  },
  {
    key: 'history',
    label: 'History Logs',
    shortLabel: 'History',
    permissions: [
      ['history.view', 'View History Logs'],
      ['history.export', 'Export History Logs'],
    ],
  },
] as const;

export type PermissionKey = typeof permissionModules[number]['permissions'][number][0];

export const permissionCatalog = permissionModules.flatMap(module =>
  module.permissions.map(([key, label]) => ({
    key,
    label,
    module: module.key,
    moduleLabel: module.label,
    moduleShortLabel: module.shortLabel,
  })),
);

export const permissionKeys = new Set<PermissionKey>(permissionCatalog.map(permission => permission.key));
export const permissionByKey = new Map(permissionCatalog.map(permission => [permission.key, permission]));

const viewPermissions: PermissionKey[] = [
  'inventory.view',
  'requisitions.view',
  'machine.view',
  'equipment.view',
  'facility.view',
  'vendors.view',
];

const tech2Permissions: PermissionKey[] = [
  ...viewPermissions,
  'inventory.create',
  'inventory.edit',
  'inventory.export',
  'inventory.requisition_stage',
  'requisitions.create',
  'requisitions.edit',
  'requisitions.mark_ordered',
  'requisitions.mark_received',
  'requisitions.cancel',
  'requisitions.print_download',
  'vendors.create',
  'vendors.edit',
  'vendors.import_export',
];

const tech3Permissions: PermissionKey[] = [
  ...tech2Permissions,
  'inventory.import',
  'requisitions.manage_batches',
  'machine.create',
  'machine.edit',
  'machine.pm_manage',
  'machine.documents_upload',
  'machine.documents_manage',
  'machine.notes_manage',
  'machine.import_export',
  'equipment.create',
  'equipment.edit',
  'equipment.pm_manage',
  'equipment.documents_upload',
  'equipment.documents_manage',
  'equipment.notes_manage',
  'equipment.import_export',
  'facility.create',
  'facility.edit',
  'facility.delete',
  'facility.folders_manage',
  'facility.upload',
  'facility.rename_move',
  'facility.content_delete',
  'facility.recovery_export',
];

const managerPermissions: PermissionKey[] = permissionCatalog.map(permission => permission.key);

export const roleBasePermissions: Record<PermissionRole, ReadonlySet<PermissionKey>> = {
  'Maintenance Tech 1': new Set(viewPermissions),
  'Maintenance Tech 2': new Set(tech2Permissions),
  'Maintenance Tech 3': new Set(tech3Permissions),
  Manager: new Set(managerPermissions),
  Admin: new Set(managerPermissions),
};

export function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === 'string' && permissionKeys.has(value as PermissionKey);
}

export function inheritedPermissions(role: PermissionRole): PermissionKey[] {
  return [...roleBasePermissions[role]];
}
