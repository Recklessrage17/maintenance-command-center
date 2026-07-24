import { expect, type Page, type Route, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const fixedNow = '2026-07-24T14:00:00.000Z';
const artifactDirectory = resolve(process.cwd(), 'artifacts', 'issue-49');
const fullPermissions = [
  'inventory.view', 'inventory.create', 'inventory.edit', 'inventory.delete', 'inventory.import', 'inventory.export', 'inventory.requisition_stage',
  'requisitions.view', 'requisitions.create', 'requisitions.edit', 'requisitions.mark_ordered', 'requisitions.mark_received', 'requisitions.cancel', 'requisitions.delete', 'requisitions.manage_batches', 'requisitions.print_download',
  'machine.view', 'machine.create', 'machine.edit', 'machine.delete', 'machine.pm_manage', 'machine.documents_upload', 'machine.documents_manage', 'machine.notes_manage', 'machine.import_export',
  'equipment.view', 'equipment.create', 'equipment.edit', 'equipment.delete', 'equipment.pm_manage', 'equipment.documents_upload', 'equipment.documents_manage', 'equipment.notes_manage', 'equipment.import_export',
  'facility.view', 'facility.create', 'facility.edit', 'facility.delete', 'facility.folders_manage', 'facility.upload', 'facility.rename_move', 'facility.content_delete', 'facility.recovery_export',
  'vendors.view', 'vendors.create', 'vendors.edit', 'vendors.delete', 'vendors.import_export', 'history.view', 'history.export',
];
const owner = {
  id: 1,
  fullName: 'Jeff R Grove',
  email: 'owner@example.com',
  role: 'Admin',
  isOwnerAdmin: true,
  forcePasswordChange: false,
  disabled: false,
  lastLoginAt: null,
  canDisable: false,
  canDelete: false,
  canResetPassword: false,
  canManagePermissions: false,
  specialPermissionGrants: [],
  effectivePermissions: fullPermissions,
};

const specialGrants = [
  { id: 10, permissionKey: 'inventory.create', label: 'Add inventory items', module: 'inventory', moduleLabel: 'Inventory', moduleShortLabel: 'Inventory', grantedByUserId: 1, grantedBy: owner.fullName, grantedAt: fixedNow, expiresAt: null, reason: null },
  { id: 11, permissionKey: 'inventory.edit', label: 'Edit inventory items', module: 'inventory', moduleLabel: 'Inventory', moduleShortLabel: 'Inventory', grantedByUserId: 1, grantedBy: owner.fullName, grantedAt: fixedNow, expiresAt: null, reason: null },
  { id: 12, permissionKey: 'facility.upload', label: 'Upload documents or media', module: 'facility', moduleLabel: 'Facility Info', moduleShortLabel: 'Facility', grantedByUserId: 1, grantedBy: owner.fullName, grantedAt: fixedNow, expiresAt: null, reason: null },
];
const securityUser = {
  id: 2,
  fullName: 'Alex Rivera',
  email: 'alex@example.com',
  role: 'Maintenance Tech 3',
  isOwnerAdmin: false,
  forcePasswordChange: false,
  disabled: false,
  lastLoginAt: '2026-07-24T12:00:00.000Z',
  canDisable: true,
  canDelete: true,
  canResetPassword: true,
  canManagePermissions: true,
  specialPermissionGrants: specialGrants,
  effectivePermissions: [...fullPermissions, ...specialGrants.map(grant => grant.permissionKey)],
};
const presencePolicy = { heartbeatIntervalMs: 45_000, rosterRefreshIntervalMs: 25_000, onlineThresholdMs: 120_000, awayAfterMs: 600_000, writeThrottleMs: 25_000 };
const roster = {
  serverTime: fixedNow,
  policy: presencePolicy,
  totalUsers: 4,
  activeUsers: 3,
  onlineCount: 1,
  awayCount: 1,
  offlineCount: 1,
  disabledCount: 1,
  users: [
    { id: 1, fullName: owner.fullName, role: 'Admin', isOwnerAdmin: true, disabled: false, isCurrentUser: true, presence: 'Online', lastSeenAt: fixedNow, rankProvenance: { currentRank: 'Owner Admin', assignedBy: 'System bootstrap', assignedAt: '2026-07-01T12:00:00.000Z', previousRank: null, reason: null, assignmentSourceAvailable: true, source: 'system_bootstrap' }, specialPermissionGrants: [] },
    { id: 2, fullName: securityUser.fullName, role: securityUser.role, isOwnerAdmin: false, disabled: false, isCurrentUser: false, presence: 'Away', lastSeenAt: '2026-07-24T13:48:00.000Z', rankProvenance: { currentRank: securityUser.role, assignedBy: owner.fullName, assignedAt: '2026-07-20T12:00:00.000Z', previousRank: 'Maintenance Tech 2', reason: 'Training completed', assignmentSourceAvailable: true, source: 'role_assignment_history' }, specialPermissionGrants: specialGrants },
    { id: 3, fullName: 'Morgan Lee', role: 'Manager', isOwnerAdmin: false, disabled: false, isCurrentUser: false, presence: 'Offline', lastSeenAt: '2026-07-23T14:00:00.000Z', rankProvenance: { currentRank: 'Manager', assignedBy: null, assignedAt: null, previousRank: null, reason: null, assignmentSourceAvailable: false, source: 'unavailable' }, specialPermissionGrants: [] },
    { id: 4, fullName: 'Disabled Fixture', role: 'Maintenance Tech 1', isOwnerAdmin: false, disabled: true, isCurrentUser: false, presence: 'Offline', lastSeenAt: null, rankProvenance: { currentRank: 'Maintenance Tech 1', assignedBy: owner.fullName, assignedAt: '2026-07-20T12:00:00.000Z', previousRank: null, reason: null, assignmentSourceAvailable: true, source: 'role_assignment_history' }, specialPermissionGrants: [specialGrants[2]] },
  ],
};

const machineHistory = { id: 901, action: 'preventive_maintenance_completed', entityLabel: 'Press 51', userName: 'Jeff R Grove', reasonNote: 'Completed inspection and lubrication.', createdAt: '2026-07-23T15:30:00.000Z' };
const machineDefaults = {
  machineType: 'Injection Molding Machine', powerType: 'Electric', setupType: 'Standard Injection', shotSizeOz: 12, tonnage: 250,
  voltageValue: '480', voltageType: 'VAC', fullLoadAmp: '320', machineLength: '22 ft', machineWidth: '7 ft', machineHeight: '8 ft', fullDieHeightLength: '48 in',
  screwType: 'General Purpose', screwTipType: 'Sliding Ring', screwTipInstalledDate: '2025-10-01', screwInstalledDate: '2025-10-01', barrelInstalledDate: '2025-10-01', barrelEndCapInstalledDate: '', barrelLength: '96 in', screwLength: '92 in',
  screwRebuildRepaired: false, barrelRebuildRepaired: false, screwConditionStatus: 'used', barrelConditionStatus: 'used',
  hasDoubleShotInjection: false, hasPlungerInjection: false,
  screw2Type: '', screw2TipType: '', screw2RebuildRepaired: false, screw2ConditionStatus: 'new', screw2InstalledDate: '', screw2TipInstalledDate: '', screw2Length: '',
  barrel2Diameter: '', barrel2RebuildRepaired: false, barrel2ConditionStatus: 'new', barrel2InstalledDate: '', barrel2EndCapInstalledDate: '', barrel2Length: '',
  plungerType: '', plungerRebuildRepaired: false, plungerConditionStatus: 'new', plungerInstalledDate: '', plungerLength: '', plungerDiameter: '',
  plungerBarrelType: '', plungerBarrelRebuildRepaired: false, plungerBarrelConditionStatus: 'new', plungerBarrelInstalledDate: '', plungerBarrelEndCapInstalledDate: '', plungerBarrelLength: '', plungerBarrelDiameter: '',
  notes: 'Representative visual fixture.', criticalNotes: '', createdAt: '2026-01-01T12:00:00.000Z', updatedAt: '2026-07-23T15:30:00.000Z',
};
const machines = [
  { ...machineDefaults, id: 51, assetNumber: 'Press 51', assetName: 'North Cell Press', brand: 'Toyo', model: 'SI-250-6', serialNumber: '1694010', machineYear: '2012', barrelDiameter: '35mm', location: 'North Cell', department: 'Molding', status: 'active', brandColorHex: '#44D7FF', pmSummary: { total: 2, status: 'due-soon', label: 'PM: 1 Due Soon' }, historyPreview: [machineHistory] },
  { ...machineDefaults, id: 52, assetNumber: 'Press 52', assetName: 'South Cell Press', brand: 'Engel', model: 'Victory 330', serialNumber: 'ENG-052', machineYear: '2018', barrelDiameter: '40mm', location: 'South Cell', department: 'Molding', status: 'active', brandColorHex: '#F5A623', pmSummary: { total: 1, status: 'current', label: 'PM: Current' }, historyPreview: [] },
];
const equipment = {
  id: 301, assetNumber: 'EQ-301', equipmentName: 'Central Resin Dryer', assetName: 'Central Resin Dryer', category: 'Dryer', equipmentType: 'Desiccant Dryer', manufacturer: 'Matsui', brand: 'Matsui', model: 'MJ5-i', serialNumber: 'DRY-301', equipmentYear: '2020', year: '2020', location: 'Molding Bay 2', department: 'Molding', status: 'active', criticality: 'high',
  powerType: 'Electric', voltage: '480 VAC', phase: '3 phase', amperage: '42 A', airRequirement: '90 PSI', waterRequirement: '', capacityRating: '500 lb hopper', dimensions: '48 x 36 x 84 in', weight: '825 lb', specificationNotes: 'Keep desiccant filters clean.', createdAt: '2026-07-20T12:00:00.000Z', updatedAt: '2026-07-23T12:00:00.000Z',
  pmSummary: { total: 1, status: 'due-soon', label: 'PM: 1 Due Soon' }, latestHistory: { id: 11, action: 'equipment_edited', entityLabel: 'EQ-301', reasonNote: 'Updated capacity.', userName: owner.fullName, createdAt: '2026-07-23T12:00:00.000Z' },
};

function inventoryPart(id: number, partNumber: string, quantity: number) {
  return {
    id: String(id), itemId: `ITEM-${id}`, partNumber, description: `Maintenance fixture ${partNumber}`, location: 'Stores A-01', vendor: 'Industrial Supply Co.',
    quantity, minQuantity: 4, status: quantity <= 4 ? 'Low Stock' : 'In Stock', requisition: '', orderPlaced: false, hasActiveRequisitionRecord: false,
    isInRequisitionStaging: false, requisitionStagingItemId: null, requisitionStagingStatus: '', partInfoUrl: `https://parts.example.com/${partNumber.toLowerCase()}`,
    manufacturerBrand: 'MCC', unitCost: 12.5, supplierPartNumber: `SUP-${id}`, leadTime: '3 days', importantNote: '',
    createdAt: '2026-07-17T12:00:00.000Z', updatedAt: '2026-07-23T12:00:00.000Z',
  };
}
const inventoryParts = [inventoryPart(1, '35MB', 12), inventoryPart(2, 'SEAL-220', 3), inventoryPart(3, 'HEATER-BAND-75', 8)];
const vendorContacts = [
  { id: 711, vendorId: 71, contactName: 'Sam Ortega', contactTitle: 'Account Manager', email: 'sam.ortega@example.com', phoneType: 'Work', phoneNumber: '(555) 410-2200', phoneNormalized: '5554102200', phoneExt: '104', notes: 'Primary maintenance supply contact.', isPrimary: true, deleted: false },
];
const vendors = [
  {
    id: 71, companyName: 'Industrial Supply Co.', phoneType: 'Main', phoneNumber: '(555) 410-2000', phoneNormalized: '5554102000', phoneExt: '',
    websiteUrl: 'https://example.com', addressLine1: '4100 Foundry Road', addressLine2: '', city: 'Milwaukee', state: 'WI', postalCode: '53201', country: 'United States',
    contactName: 'Sam Ortega', contactTitle: 'Account Manager', contactPhoneType: 'Work', contactPhoneNumber: '(555) 410-2200', contactPhoneExt: '104', contactEmail: 'sam.ortega@example.com',
    notes: 'Preferred supplier for hydraulic and electrical maintenance stock.', isActive: true, deleted: false, status: 'Enabled', source: 'manual',
    createdAt: '2026-06-10T12:00:00.000Z', updatedAt: '2026-07-23T12:00:00.000Z', contactCount: 1, primaryContactName: 'Sam Ortega', primaryContactEmail: 'sam.ortega@example.com', contacts: vendorContacts,
  },
];
function requisition(id: number, status: 'Requested' | 'Ordered' | 'Received') {
  const lines = Array.from({ length: 3 }, (_, index) => ({ id: id * 10 + index, inventoryPartId: id * 10 + index, partNumber: `PART-${id}-${index + 1}`, description: `Maintenance line item ${index + 1}`, vendorName: 'Industrial Supply Co.', locationName: 'Stores', quantityRequested: index + 1, unitCost: 12, totalCost: (index + 1) * 12, unitOfMeasure: 'EA', itemNumber: `ITEM-${index + 1}`, notes: '' }));
  return {
    id, requisitionNumber: `REQ-${id}`, inventoryPartId: id, partNumber: lines[0].partNumber, description: lines[0].description, vendorName: 'Industrial Supply Co.', locationName: 'Stores', quantityRequested: 6,
    lineCount: lines.length, firstPartNumber: lines[0].partNumber, firstDescription: lines[0].description, totalQuantity: 6, totalCost: 72, vendorSummary: 'Industrial Supply Co.', locationSummary: 'Stores', partNumbers: lines.map(line => line.partNumber), descriptions: lines.map(line => line.description), lines,
    status, requestedByName: owner.fullName, requestedAt: '2026-07-16T12:00:00.000Z', orderedAt: status !== 'Requested' ? '2026-07-22T12:00:00.000Z' : null, receivedAt: status === 'Received' ? '2026-07-23T12:00:00.000Z' : null, canceledAt: null, workOrderNumber: 'WO-4102', notes: 'Production maintenance', cancelReason: '', deleted: false, deletedAt: null,
  };
}
const requisitions = [requisition(101, 'Requested'), requisition(102, 'Ordered'), requisition(103, 'Received')];
const requisitionSummary = { requestedCount: 1, orderedCount: 1, receivedCount: 1, canceledCount: 0, activeCount: 2 };
const historyRecord = {
  id: 801, section: 'inventory', sectionLabel: 'Inventory', action: 'quantity_changed', entityType: 'inventory_part', entityId: '1', entityLabel: '35MB',
  workOrderNumber: 'WO-4102', partNumber: '35MB', requisitionNumber: '', assetId: '', machineName: '', equipmentName: '',
  quantityBefore: 8, quantityAfter: 12, quantityDelta: 4, reasonNote: 'Cycle count adjustment.', userName: owner.fullName, userEmail: owner.email, createdAt: '2026-07-23T16:15:00.000Z',
};
const historySummary = [
  { section: 'inventory', sectionLabel: 'Inventory', count: 4, latestCreatedAt: historyRecord.createdAt },
  { section: 'vendors', sectionLabel: 'Vendors', count: 2, latestCreatedAt: '2026-07-22T12:00:00.000Z' },
  { section: 'requisitions', sectionLabel: 'Requisitions', count: 3, latestCreatedAt: '2026-07-21T12:00:00.000Z' },
  { section: 'machine_library', sectionLabel: 'Machine Library', count: 2, latestCreatedAt: '2026-07-20T12:00:00.000Z' },
  { section: 'equipment_library', sectionLabel: 'Equipment Library', count: 1, latestCreatedAt: '2026-07-19T12:00:00.000Z' },
  { section: 'facility_info', sectionLabel: 'Facility Info', count: 2, latestCreatedAt: '2026-07-18T12:00:00.000Z' },
  { section: 'preventive_maintenance', sectionLabel: 'Preventive Maintenance', count: 3, latestCreatedAt: '2026-07-17T12:00:00.000Z' },
  { section: 'settings', sectionLabel: 'Settings / System', count: 1, latestCreatedAt: '2026-07-16T12:00:00.000Z' },
];
const dashboardAlerts = [
  { id: 51, assetId: 51, assetNumber: 'Press 51', assetName: 'North Cell Press', brand: 'Toyo', model: 'SI-250-6', serialNumber: '1694010', title: 'Machine Greasing', instructions: 'Follow the approved lubrication procedure.', notes: 'Record findings.', intervalType: 'days', intervalLabel: 'Days', intervalValue: 30, status: 'Past Due', relativeMessage: 'Past due by 2 days', countdown: '', scheduleStatus: 'active', lastCompletedDate: '2026-06-22', lastCompletedMeter: null, currentMeter: null, nextDueDate: '2026-07-22', nextDueMeter: null, historyCount: 1, createdAt: '2026-06-01T12:00:00.000Z', updatedAt: fixedNow },
  { id: 52, assetId: 52, assetNumber: 'Press 52', assetName: 'South Cell Press', brand: 'Engel', model: 'Victory 330', serialNumber: 'ENG-052', title: 'Safety Interlock Check', instructions: 'Verify guards and interlocks.', notes: '', intervalType: 'days', intervalLabel: 'Days', intervalValue: 30, status: 'Due Soon', relativeMessage: 'Due in 5 days', countdown: '', scheduleStatus: 'active', lastCompletedDate: '2026-06-29', lastCompletedMeter: null, currentMeter: null, nextDueDate: '2026-07-29', nextDueMeter: null, historyCount: 0, createdAt: '2026-06-01T12:00:00.000Z', updatedAt: fixedNow },
];
const facilityArea = { id: 21, name: 'Production', description: 'Main production floor references.', building: 'Building A', location: 'North Wing', department: 'Molding', status: 'active', createdAt: '2026-07-20T12:00:00.000Z', updatedAt: '2026-07-23T12:00:00.000Z', summary: { folderCount: 2, documentCount: 4, pictureCount: 2, videoCount: 1 } };
const secondFacilityArea = { ...facilityArea, id: 22, name: 'Warehouse / Shipping', description: 'Dock and warehouse records.', location: 'South Dock', department: 'Logistics', summary: { folderCount: 1, documentCount: 2, pictureCount: 0, videoCount: 0 } };
const branding = { companyName: 'MCC', companySubtitle: 'Maintenance Command Center', companyAccentText: '', logoMode: 'text', logoUrl: '', logoFileName: '', iconAnimation: 'none' };

function fulfillJson(route: Route, json: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) });
}

async function mockIndustrialSuite(page: Page) {
  const unhandled = new Set<string>();
  await page.clock.setFixedTime(fixedNow);
  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === '/api/auth/status') return fulfillJson(route, { setupRequired: false, user: owner });
    if (path === '/api/auth/logout') return fulfillJson(route, { ok: true });
    if (path === '/api/settings/branding') return fulfillJson(route, { ok: true, branding });
    if (path === '/api/settings/network-links') return fulfillJson(route, { localPort: 4273, localhostUrl: 'http://localhost:4273', detectedLanUrls: ['http://192.168.10.24:4273'], primaryLanUrl: 'http://192.168.10.24:4273' });
    if (path === '/api/presence/heartbeat') return fulfillJson(route, { ok: true, serverTime: fixedNow, written: true, policy: presencePolicy });
    if (path === '/api/presence/team') return fulfillJson(route, roster);
    if (path === '/api/requisitions/summary') return fulfillJson(route, { ok: true, ...requisitionSummary });
    if (path === '/api/dashboard/preventive-maintenance-due') return fulfillJson(route, { ok: true, alerts: dashboardAlerts, summary: { dueSoon: 1, dueNow: 0, pastDue: 1 } });
    if (path === '/api/inventory/native/summary') return fulfillJson(route, { ok: true, totalParts: inventoryParts.length, lowStockCount: 1, requisitionCount: 2, vendorCount: 1, locationCount: 1 });
    if (path === '/api/inventory/native/parts') return fulfillJson(route, { ok: true, parts: inventoryParts });
    if (path === '/api/inventory/native/backups') return fulfillJson(route, { ok: true, backups: [] });
    if (path === '/api/vendors') return fulfillJson(route, { ok: true, vendors });
    if (/^\/api\/vendors\/\d+\/contacts$/.test(path)) return fulfillJson(route, { ok: true, vendor: vendors[0], contacts: vendorContacts });
    if (path === '/api/requisitions') {
      const status = url.searchParams.get('status');
      const visible = status && status !== 'all' ? requisitions.filter(row => row.status === status) : requisitions.filter(row => row.status !== 'Received');
      return fulfillJson(route, { ok: true, requisitions: visible, summary: requisitionSummary });
    }
    if (path === '/api/requisition-batches') return fulfillJson(route, { ok: true, batches: [] });
    if (path === '/api/requisition-staging') return fulfillJson(route, { ok: true, items: [] });
    if (path === '/api/history/summary') return fulfillJson(route, { ok: true, summary: historySummary });
    if (path === '/api/history') return fulfillJson(route, { ok: true, records: [historyRecord], total: 1, page: 1, pageSize: Number(url.searchParams.get('pageSize') ?? 50) });
    if (path === '/api/machine-library/assets') return fulfillJson(route, { ok: true, assets: machines, brandSettings: [], permissions: { canEdit: true, canDelete: true } });
    if (/^\/api\/machine-library\/assets\/\d+\/history$/.test(path)) return fulfillJson(route, { ok: true, asset: machines[0], records: [machineHistory] });
    if (/^\/api\/machine-library\/assets\/\d+\/inspection-records$/.test(path)) return fulfillJson(route, { ok: true, records: [] });
    if (/^\/api\/machine-library\/assets\/\d+\/preventive-maintenance$/.test(path)) return fulfillJson(route, { ok: true, tasks: [], summary: { total: 0, current: 0, dueSoon: 0, dueNow: 0, overdue: 0, hold: 0, inactive: 0, incomplete: 0, nextDueDate: null, nextDueMeter: null } });
    if (/^\/api\/machine-library\/assets\/\d+\/notes$/.test(path)) return fulfillJson(route, { ok: true, notes: [] });
    if (/^\/api\/machine-library\/assets\/\d+\/component-images$/.test(path)) return fulfillJson(route, { ok: true, images: [] });
    if (/^\/api\/machine-library\/assets\/\d+\/document-folders$/.test(path)) return fulfillJson(route, { ok: true, folders: [], summary: { folderCount: 0, documentCount: 0 } });
    if (/^\/api\/machine-library\/assets\/\d+\/documents$/.test(path)) return fulfillJson(route, { ok: true, documents: [] });
    if (path === '/api/equipment-library/assets') return fulfillJson(route, { ok: true, assets: [equipment], categories: ['Dryer'], permissions: { canEdit: true, canDelete: true } });
    if (/^\/api\/equipment-library\/assets\/\d+\/history$/.test(path)) return fulfillJson(route, { ok: true, asset: equipment, records: [equipment.latestHistory] });
    if (/^\/api\/equipment-library\/assets\/\d+\/preventive-maintenance$/.test(path)) return fulfillJson(route, { ok: true, tasks: [], summary: { total: 0, dueSoon: 0, overdue: 0, nextDueDate: null, nextDueMeter: null } });
    if (/^\/api\/equipment-library\/assets\/\d+\/document-folders$/.test(path)) return fulfillJson(route, { ok: true, folders: [], summary: { folderCount: 0, documentCount: 0 } });
    if (/^\/api\/equipment-library\/assets\/\d+\/documents$/.test(path)) return fulfillJson(route, { ok: true, documents: [] });
    if (/^\/api\/equipment-library\/assets\/\d+\/notes$/.test(path)) return fulfillJson(route, { ok: true, notes: [] });
    if (path === '/api/facility-info') return fulfillJson(route, { ok: true, areas: [facilityArea, secondFacilityArea], limits: { documentsMb: 50, picturesMb: 50, videosMb: 500 } });
    if (path === '/api/facility-info/permissions') return fulfillJson(route, { ok: true, canWrite: true, canRecoveryExport: true });
    if (path === '/api/users') return fulfillJson(route, { users: [owner, securityUser] });
    if (path === '/api/backup/status') return fulfillJson(route, { ok: true, backupFolderExists: true, backupHealth: 'Healthy', databaseSize: 4_200_000, permissions: {}, protectedAreas: [], lastBackupResult: { ok: true, message: 'Visual fixture ready.' } });
    if (path === '/api/admin/reset/status') return fulfillJson(route, { ok: true, counts: { inventoryParts: 3, inventoryVendors: 1, inventoryLocations: 1, requisitions: 3, requisitionLines: 9, historyCounts: { inventory: 4, requisitions: 3, machine_library: 2, equipment_library: 1, facility_info: 2, preventive_maintenance: 3, settings: 1 }, futureTableCounts: {} } });
    unhandled.add(`${request.method()} ${path}`);
    return fulfillJson(route, { ok: true, error: `Unhandled Issue #49 visual fixture: ${path}` });
  });
  return unhandled;
}

async function goTo(page: Page, path: string, heading: string) {
  await page.goto(path);
  await expect(page.locator('.mcc-current-page h1')).toHaveText(heading);
  await expect(page.locator('.mcc-route-state')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
}

async function capture(page: Page, name: string, fullPage = false) {
  await mkdir(artifactDirectory, { recursive: true });
  await page.screenshot({
    path: resolve(artifactDirectory, name),
    fullPage,
    animations: 'disabled',
    caret: 'hide',
    mask: [page.locator('time:visible, .mcc-status-age:visible, .maintenance-team-last-seen:visible')],
    maskColor: '#15232d',
  });
}

async function expectNoDocumentOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(dimensions.scrollWidth - dimensions.clientWidth).toBeLessThanOrEqual(1);
}

async function tableOverflowReport(page: Page) {
  return page.evaluate(() => [...document.querySelectorAll('table')].filter(table => {
    const box = table.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  }).map(table => {
    let parent: HTMLElement | null = table.parentElement;
    let scroller: HTMLElement | null = null;
    while (parent && parent !== document.body) {
      const overflowX = getComputedStyle(parent).overflowX;
      if (overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'overlay') {
        scroller = parent;
        break;
      }
      parent = parent.parentElement;
    }
    return {
      hasLocalScroller: Boolean(scroller),
      localScrollWidth: scroller?.scrollWidth ?? 0,
      localClientWidth: scroller?.clientWidth ?? 0,
    };
  }));
}

async function actionGroupGeometry(page: Page, selector: string) {
  const group = page.locator(selector).first();
  await expect(group).toBeVisible();
  return group.evaluate(element => {
    const groupBox = element.getBoundingClientRect();
    const controls = [...element.querySelectorAll<HTMLElement>(':scope > button, :scope > a, :scope > label')]
      .map(control => {
        const box = control.getBoundingClientRect();
        const style = getComputedStyle(control);
        return {
          text: (control.textContent ?? '').replace(/\s+/g, ' ').trim(),
          top: box.top,
          left: box.left,
          width: box.width,
          height: box.height,
          display: style.display,
          visibility: style.visibility,
        };
      })
      .filter(control => control.width > 0 && control.height > 0 && control.display !== 'none' && control.visibility !== 'hidden');
    const rowCenters: number[] = [];
    for (const control of [...controls].sort((left, right) => left.top - right.top || left.left - right.left)) {
      const center = control.top + control.height / 2;
      if (!rowCenters.some(rowCenter => Math.abs(rowCenter - center) <= 2)) rowCenters.push(center);
    }
    return {
      containerWidth: groupBox.width,
      controls,
      rowCount: rowCenters.length,
    };
  });
}

test('canonical industrial tokens, smoke-glass surfaces, and keyboard focus are available', async ({ page }) => {
  const unhandled = await mockIndustrialSuite(page);
  await goTo(page, '/', 'Dashboard');
  const prefixes = ['--mcc-bg-', '--mcc-surface-', '--mcc-border-', '--mcc-text-', '--mcc-accent-', '--mcc-status-', '--mcc-shadow-', '--mcc-motion-'];
  const tokens = await page.evaluate(requestedPrefixes => {
    const declared = new Set<string>();
    const scan = (rules: CSSRuleList) => {
      for (const rule of [...rules]) {
        if (rule instanceof CSSStyleRule) {
          for (const property of [...rule.style]) if (property.startsWith('--mcc-')) declared.add(property);
        }
        const nested = (rule as CSSRule & { cssRules?: CSSRuleList }).cssRules;
        if (nested) scan(nested);
      }
    };
    for (const sheet of [...document.styleSheets]) {
      try { if (sheet.cssRules) scan(sheet.cssRules); } catch { /* Local evidence only; ignore inaccessible sheets. */ }
    }
    const computed = getComputedStyle(document.documentElement);
    return requestedPrefixes.map(prefix => {
      const names = [...declared].filter(name => name.startsWith(prefix));
      return { prefix, names, resolved: names.filter(name => computed.getPropertyValue(name).trim()) };
    });
  }, prefixes);
  for (const family of tokens) {
    expect(family.names.length, `${family.prefix} token declarations`).toBeGreaterThan(0);
    expect(family.resolved.length, `${family.prefix} resolved root tokens`).toBeGreaterThan(0);
  }

  const surface = page.locator('.glass-panel:visible, .mcc-industrial-panel:visible, .mcc-card:visible').first();
  await expect(surface).toBeVisible();
  const surfaceStyle = await surface.evaluate(element => {
    const style = getComputedStyle(element);
    return { backgroundImage: style.backgroundImage, borderColor: style.borderColor, boxShadow: style.boxShadow };
  });
  expect(surfaceStyle.backgroundImage).toContain('gradient');
  expect(surfaceStyle.borderColor).not.toBe('rgba(0, 0, 0, 0)');
  expect(surfaceStyle.boxShadow).not.toBe('none');

  const menu = page.getByRole('button', { name: 'Open command menu' });
  await menu.focus();
  const focus = await menu.evaluate(element => {
    const style = getComputedStyle(element);
    return { visible: element.matches(':focus-visible'), outline: style.outlineStyle, outlineWidth: style.outlineWidth, boxShadow: style.boxShadow };
  });
  expect(focus.visible).toBe(true);
  expect(focus.outline !== 'none' && focus.outlineWidth !== '0px' || focus.boxShadow !== 'none').toBe(true);
  await expectNoDocumentOverflow(page);
  expect([...unhandled]).toEqual([]);
});

test('captures deterministic visual evidence for every representative MCC workspace', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'The stable route evidence set is captured once at the large desktop baseline.');
  const unhandled = await mockIndustrialSuite(page);
  await goTo(page, '/', 'Dashboard');
  await expect(page.locator('.dashboard-pm-alert')).toHaveCount(2);
  await capture(page, 'dashboard.png');

  await goTo(page, '/inventory', 'Inventory');
  await expect(page.getByText('35MB', { exact: true })).toBeVisible();
  await capture(page, 'inventory.png');

  await goTo(page, '/vendors', 'Vendors');
  await expect(page.getByText(vendors[0].companyName, { exact: true })).toBeVisible();
  const vendorActions = await actionGroupGeometry(page, '.vendor-card-actions');
  expect(vendorActions.controls).toHaveLength(3);
  expect(vendorActions.rowCount, `vendor action rows: ${JSON.stringify(vendorActions.controls)}`).toBe(1);
  for (const control of vendorActions.controls) {
    expect(control.width, `${control.text} should not consume the full vendor action row`).toBeLessThan(vendorActions.containerWidth * 0.75);
  }
  await capture(page, 'vendors.png');

  await goTo(page, '/requisitions?view=active', 'Requisitions');
  await expect(page.getByText('REQ-101', { exact: true })).toBeVisible();
  await capture(page, 'requisitions.png');

  await goTo(page, '/history/inventory', 'History Logs');
  await expect(page.getByText('Inventory History Log', { exact: true })).toBeVisible();
  await expect(page.getByText('Cycle count adjustment.', { exact: true })).toBeVisible();
  await capture(page, 'history-logs.png');

  await goTo(page, '/machine-library', 'Machine Library');
  await expect(page.locator('.machine-asset-card')).toHaveCount(2);
  await capture(page, 'machine-library-home.png');
  await page.getByRole('button', { name: 'View details for Press 51' }).click();
  await expect(page.locator('.machine-detail-modal')).toBeVisible();
  await capture(page, 'machine-library-detail.png');

  await goTo(page, '/equipment-library', 'Equipment Library');
  await expect(page.locator('.equipment-asset-card')).toHaveCount(1);
  await capture(page, 'equipment-library-home.png');
  await page.getByRole('button', { name: /Open Equipment EQ-301/ }).click();
  await expect(page.locator('.equipment-detail-page')).toBeVisible();
  await capture(page, 'equipment-library-detail.png');

  await goTo(page, '/facility-info', 'Facility Info');
  await expect(page.getByText('Production', { exact: true })).toBeVisible();
  await capture(page, 'facility-info.png');

  await goTo(page, '/users', 'Users / Security');
  await expect(page.getByText(securityUser.fullName, { exact: true })).toBeVisible();
  await capture(page, 'users-security.png');

  await goTo(page, '/settings', 'Settings');
  await expect(page.locator('.branding-card input').first()).toHaveValue('MCC');
  await capture(page, 'settings.png');

  await goTo(page, '/', 'Dashboard');
  await page.getByRole('button', { name: 'Open command menu' }).click();
  await expect(page.locator('.mcc-command-deck')).toBeVisible();
  await capture(page, 'command-deck.png');
  await page.getByRole('button', { name: 'Open Maintenance Team roster' }).click();
  await expect(page.getByRole('dialog', { name: 'Maintenance Team' })).toBeVisible();
  await capture(page, 'teams-roster.png');

  await expectNoDocumentOverflow(page);
  expect([...unhandled]).toEqual([]);
});

test('390px mobile keeps tables local, the document contained, and focus visible', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'This case requires the touch/mobile browser context.');
  const unhandled = await mockIndustrialSuite(page);
  await goTo(page, '/inventory', 'Inventory');
  expect(await page.evaluate(() => innerWidth)).toBe(390);
  await expect(page.locator('.mobile-inventory-controls')).toBeVisible();
  await expect(page.locator('.inventory-focus-actions')).toBeHidden();
  await expect(page.locator('.inventory-search-tools')).toBeHidden();
  await expectNoDocumentOverflow(page);
  const tables = await tableOverflowReport(page);
  expect(tables.length).toBeGreaterThan(0);
  expect(tables.some(table => table.hasLocalScroller)).toBe(true);
  const search = page.getByRole('textbox', { name: /Search/ }).first();
  await search.focus();
  expect(await search.evaluate(element => element.matches(':focus-visible'))).toBe(true);
  await capture(page, 'responsive-mobile-390-inventory.png');

  await goTo(page, '/machine-library', 'Machine Library');
  const machineActions = await actionGroupGeometry(page, '.machine-card-summary-actions');
  expect(machineActions.controls).toHaveLength(2);
  expect(machineActions.rowCount, `machine action rows: ${JSON.stringify(machineActions.controls)}`).toBe(1);
  for (const control of machineActions.controls) {
    expect(control.width, `${control.text} should share the machine action row`).toBeLessThan(machineActions.containerWidth * 0.8);
  }
  await expectNoDocumentOverflow(page);

  await goTo(page, '/history/inventory', 'History Logs');
  const historyActions = await actionGroupGeometry(page, '.history-table-toolbar');
  expect(historyActions.controls.length).toBeGreaterThan(1);
  expect(historyActions.rowCount, `history action rows: ${JSON.stringify(historyActions.controls)}`).toBeLessThan(historyActions.controls.length);
  for (const control of historyActions.controls) {
    expect(control.width, `${control.text} should not become a full-width history action`).toBeLessThan(historyActions.containerWidth * 0.8);
  }
  await expectNoDocumentOverflow(page);

  await goTo(page, '/requisitions?view=active', 'Requisitions');
  const requisitionActions = await actionGroupGeometry(page, '.requisition-selection-toolbar');
  expect(requisitionActions.controls.length).toBeGreaterThan(1);
  expect(requisitionActions.rowCount, `requisition action rows: ${JSON.stringify(requisitionActions.controls)}`).toBeLessThan(requisitionActions.controls.length);
  for (const control of requisitionActions.controls) {
    expect(control.width, `${control.text} should not become a full-width requisition action`).toBeLessThan(requisitionActions.containerWidth * 0.8);
  }
  await expectNoDocumentOverflow(page);
  expect([...unhandled]).toEqual([]);
});

test('tablet, laptop 125%, and desktop 150% viewports stay contained', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Viewport-equivalent browser zoom evidence is captured from the desktop context.');
  const unhandled = await mockIndustrialSuite(page);
  const cases = [
    { width: 820, height: 900, path: '/users', heading: 'Users / Security', evidence: 'responsive-tablet-820-users-security.png' },
    { width: 1152, height: 720, path: '/', heading: 'Dashboard', evidence: 'responsive-laptop-125-dashboard.png' },
    { width: 960, height: 600, path: '/requisitions?view=active', heading: 'Requisitions', evidence: 'responsive-desktop-150-requisitions.png' },
  ];
  for (const viewport of cases) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await goTo(page, viewport.path, viewport.heading);
    await expectNoDocumentOverflow(page);
    const tables = await tableOverflowReport(page);
    for (const table of tables) expect(table.hasLocalScroller).toBe(true);
    await capture(page, viewport.evidence);
  }

  await page.setViewportSize({ width: 720, height: 900 });
  await goTo(page, '/vendors', 'Vendors');
  for (const selector of ['.vendors-toolbar-actions', '.vendor-card-actions']) {
    const group = await actionGroupGeometry(page, selector);
    expect(group.rowCount, `${selector} action rows: ${JSON.stringify(group.controls)}`).toBeLessThan(group.controls.length);
    for (const control of group.controls) {
      expect(control.width, `${selector} ${control.text} should not become full-width`).toBeLessThan(group.containerWidth * 0.9);
    }
  }
  await page.getByRole('button', { name: 'Add Vendor' }).click();
  const modalActions = await actionGroupGeometry(page, '.modal-actions:visible');
  expect(modalActions.rowCount, `modal action rows: ${JSON.stringify(modalActions.controls)}`).toBe(1);
  for (const control of modalActions.controls) {
    expect(control.width, `${control.text} should share the modal action row`).toBeLessThan(modalActions.containerWidth * 0.9);
  }

  await goTo(page, '/machine-library', 'Machine Library');
  const machineToolbar = page.locator('.machine-toolbar-actions');
  const machineToolbarWidth = await machineToolbar.evaluate(element => element.getBoundingClientRect().width);
  for (const button of await machineToolbar.locator('button:visible').all()) {
    const buttonWidth = await button.evaluate(element => element.getBoundingClientRect().width);
    expect(buttonWidth, 'machine toolbar controls should not become full-width').toBeLessThan(machineToolbarWidth * 0.9);
  }

  await goTo(page, '/settings', 'Settings');
  const backupActions = await actionGroupGeometry(page, '.backup-action-row');
  expect(backupActions.rowCount, `backup action rows: ${JSON.stringify(backupActions.controls)}`).toBeLessThan(backupActions.controls.length);
  for (const control of backupActions.controls) {
    expect(control.width, `${control.text} should share the backup action row`).toBeLessThan(backupActions.containerWidth * 0.9);
  }

  await goTo(page, '/inventory', 'Inventory');
  await page.locator('.inventory-page').evaluate(element => {
    const actions = document.createElement('div');
    actions.className = 'inventory-setup-actions';
    actions.dataset.issue49RegressionFixture = '';
    actions.innerHTML = '<button class="primary-button" type="button">Open Tools</button><button class="secondary-button" type="button">Import</button>';
    element.prepend(actions);
  });
  const inventorySetupActions = await actionGroupGeometry(page, '[data-issue49-regression-fixture]');
  expect(inventorySetupActions.rowCount, `inventory setup action rows: ${JSON.stringify(inventorySetupActions.controls)}`).toBe(1);
  for (const control of inventorySetupActions.controls) {
    expect(control.width, `${control.text} should share the inventory setup action row`).toBeLessThan(inventorySetupActions.containerWidth * 0.9);
  }
  expect([...unhandled]).toEqual([]);
});

test('reduced motion removes route and launcher animation while preserving the industrial state', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'One Chromium reduced-motion audit is sufficient.');
  const unhandled = await mockIndustrialSuite(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await goTo(page, '/', 'Dashboard');
  await page.getByRole('button', { name: 'Open command menu' }).click();
  const motion = await page.locator('.mcc-command-deck').evaluate(element => {
    const values = [element, ...element.querySelectorAll('*')].map(node => {
      const style = getComputedStyle(node);
      return { animationName: style.animationName, animationDuration: style.animationDuration };
    });
    return values.filter(value => value.animationName !== 'none' && !/^0(?:s|ms)$/.test(value.animationDuration));
  });
  expect(motion).toEqual([]);
  await capture(page, 'reduced-motion-command-deck.png');
  expect([...unhandled]).toEqual([]);
});

test('print media protects a light, high-contrast application surface', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Print evidence is captured once from Chromium.');
  const unhandled = await mockIndustrialSuite(page);
  await goTo(page, '/inventory', 'Inventory');
  await page.emulateMedia({ media: 'print' });
  const colors = await page.evaluate(() => {
    const rootStyle = getComputedStyle(document.documentElement);
    const style = getComputedStyle(document.body);
    const shellStyle = getComputedStyle(document.querySelector('.mcc-shell')!);
    const parse = (value: string) => {
      const channels = value.match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [0, 0, 0, 1];
      return [channels[0] ?? 0, channels[1] ?? 0, channels[2] ?? 0, channels[3] ?? 1];
    };
    const background = parse(style.backgroundColor);
    const foreground = parse(style.color);
    const luminance = ([red, green, blue]: number[]) => (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
    const relativeLuminance = ([red, green, blue]: number[]) => {
      const channels = [red, green, blue].map(value => {
        const normalized = value / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    };
    const contrast = (first: number[], second: number[]) => {
      const light = Math.max(relativeLuminance(first), relativeLuminance(second));
      const dark = Math.min(relativeLuminance(first), relativeLuminance(second));
      return (light + 0.05) / (dark + 0.05);
    };
    const effectiveBackground = (element: Element) => {
      let current: Element | null = element;
      while (current) {
        const value = getComputedStyle(current).backgroundColor;
        const parsed = parse(value);
        if (parsed[3] > 0) return { value, parsed };
        current = current.parentElement;
      }
      return { value: style.backgroundColor, parsed: background };
    };
    const surfaces = ['.inventory-focus-toolbar', '.inventory-table-wrap th'].map(selector => {
      const element = document.querySelector(selector);
      const backgroundColor = element ? getComputedStyle(element).backgroundColor : '';
      return { selector, backgroundColor, luminance: luminance(parse(backgroundColor)) };
    });
    const textSamples = [
      '.inventory-focus-meta span',
      '.inventory-search > span',
      '.inventory-part-info-link .mcc-text-link__label',
      '.vendor-name-link',
    ].map(selector => {
      const element = document.querySelector(selector);
      if (!element) return { selector, found: false, color: '', fillColor: '', backgroundColor: '', contrast: 0 };
      const elementStyle = getComputedStyle(element);
      const fillColor = elementStyle.getPropertyValue('-webkit-text-fill-color');
      const color = fillColor && fillColor !== 'rgba(0, 0, 0, 0)' && fillColor !== 'transparent' ? fillColor : elementStyle.color;
      const sampleBackground = effectiveBackground(element);
      return {
        selector,
        found: true,
        color,
        fillColor,
        backgroundColor: sampleBackground.value,
        contrast: contrast(parse(color), sampleBackground.parsed),
      };
    });
    return {
      background: luminance(background),
      foreground: luminance(foreground),
      backgroundColor: style.backgroundColor,
      color: style.color,
      rootColorScheme: rootStyle.colorScheme,
      bodyColorScheme: style.colorScheme,
      shellColorScheme: shellStyle.colorScheme,
      surfaces,
      textSamples,
    };
  });
  expect(colors.rootColorScheme).toBe('light');
  expect(colors.bodyColorScheme).toBe('light');
  expect(colors.shellColorScheme).toBe('light');
  expect(colors.background, `print background ${colors.backgroundColor}`).toBeGreaterThan(0.8);
  expect(colors.foreground, `print text ${colors.color}`).toBeLessThan(0.45);
  for (const surface of colors.surfaces) expect(surface.luminance, `${surface.selector} print background ${surface.backgroundColor}`).toBeGreaterThan(0.8);
  for (const sample of colors.textSamples) {
    expect(sample.found, `${sample.selector} should exist in the print fixture`).toBe(true);
    expect(sample.contrast, `${sample.selector} print contrast: ${JSON.stringify(sample)}`).toBeGreaterThanOrEqual(4.5);
  }
  await expect(page.locator('.inventory-page')).toBeVisible();
  await expect(page.locator('.inventory-table-wrap')).toBeVisible();
  await expect(page.getByText('35MB', { exact: true })).toBeVisible();
  await capture(page, 'print-light-inventory.png', true);

  const hiddenPrintGroups = [
    { path: '/requisitions?view=active', heading: 'Requisitions', selector: '.requisition-selection-toolbar' },
    { path: '/history/inventory', heading: 'History Logs', selector: '.history-table-toolbar' },
    { path: '/machine-library', heading: 'Machine Library', selector: '.machine-card-summary-actions' },
  ];
  for (const printCase of hiddenPrintGroups) {
    await goTo(page, printCase.path, printCase.heading);
    const group = page.locator(printCase.selector).first();
    await expect(group).toHaveCount(1);
    await expect(group).toBeHidden();
  }

  await page.emulateMedia({ media: 'screen' });
  await goTo(page, '/vendors', 'Vendors');
  await page.locator('.vendor-contact-summary-button').click();
  const contactActions = page.locator('.vendor-contact-actions');
  await expect(contactActions).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  for (const selector of ['.vendor-card-actions', '.vendor-contact-actions']) {
    const group = page.locator(selector).first();
    await expect(group).toHaveCount(1);
    await expect(group).toBeHidden();
  }
  expect([...unhandled]).toEqual([]);
});
