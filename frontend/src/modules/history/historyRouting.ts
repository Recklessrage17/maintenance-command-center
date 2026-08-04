export type HistorySection = 'inventory' | 'vendors' | 'requisitions' | 'machine_library' | 'equipment_library' | 'facility_info' | 'preventive_maintenance' | 'settings';

const historySections = new Set<HistorySection>(['inventory','vendors','requisitions','machine_library','equipment_library','facility_info','preventive_maintenance','settings']);

export function historySectionSlug(section: HistorySection) {
  return section.replace(/_/g, '-');
}

export function historySectionFromPath(value: string): HistorySection | null {
  const normalized = value.replace(/^\/+|\/+$/g, '').split('/').pop()?.replace(/-/g, '_') ?? '';
  return historySections.has(normalized as HistorySection) ? normalized as HistorySection : null;
}
