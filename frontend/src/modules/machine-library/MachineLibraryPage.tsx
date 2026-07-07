import { type CSSProperties, type Dispatch, type FormEvent, type ReactNode, type SetStateAction, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ScrewMeasurementMap from './ScrewMeasurementMap';

type ConditionStatus = 'new' | 'used' | 'worn' | 'rebuilt_repaired';
type MachineAsset = {
  id: number; assetNumber: string; assetName: string; brand: string; model: string; serialNumber: string; machineYear: string; machineType: string; powerType: string; shotSizeOz: number; tonnage: number; barrelDiameter: string; location: string; department: string; status: string; voltageValue: string; voltageType: string; fullLoadAmp: string; machineLength: string; machineWidth: string; machineHeight: string; fullDieHeightLength: string; screwType: string; screwTipType: string; screwTipInstalledDate: string; screwInstalledDate: string; barrelInstalledDate: string; barrelEndCapInstalledDate: string; barrelLength: string; screwLength: string; screwRebuildRepaired: boolean; barrelRebuildRepaired: boolean; screwConditionStatus: ConditionStatus; barrelConditionStatus: ConditionStatus; hasDoubleShotInjection: boolean; hasPlungerInjection: boolean; screw2Type: string; screw2TipType: string; screw2RebuildRepaired: boolean; screw2ConditionStatus: ConditionStatus; screw2InstalledDate: string; screw2TipInstalledDate: string; screw2Length: string; barrel2Diameter: string; barrel2RebuildRepaired: boolean; barrel2ConditionStatus: ConditionStatus; barrel2InstalledDate: string; barrel2EndCapInstalledDate: string; barrel2Length: string; plungerType: string; plungerRebuildRepaired: boolean; plungerConditionStatus: ConditionStatus; plungerInstalledDate: string; plungerLength: string; plungerDiameter: string; plungerBarrelType: string; plungerBarrelRebuildRepaired: boolean; plungerBarrelConditionStatus: ConditionStatus; plungerBarrelInstalledDate: string; plungerBarrelEndCapInstalledDate: string; plungerBarrelLength: string; plungerBarrelDiameter: string; notes: string; criticalNotes: string; brandColorHex: string; createdAt: string; updatedAt: string;
};
type BrandSetting = { brandName: string; colorHex: string };
type HistoryRecord = { id: number; action: string; entityLabel: string; userName: string; reasonNote: string; createdAt: string };
type ImportMode = 'add_new_only' | 'upsert';
type ImportRejectedDuplicate = { rowNumber: number; assetNumber: string; reason: string };
type MachineImportSummary = { addedCount: number; updatedCount: number; skippedCount: number; rejectedDuplicateCount: number; errors?: string[]; rejectedDuplicates?: ImportRejectedDuplicate[]; changedAssetNumbers?: string[] };
type AssetForm = Omit<MachineAsset, 'id' | 'brandColorHex' | 'createdAt' | 'updatedAt' | 'shotSizeOz'> & { shotSizeOz: string };
type MeasurementComponentType = 'screw' | 'barrel' | 'tip' | 'plunger' | 'screw_2' | 'barrel_2' | 'tip_2';
type MeasurementUnit = 'in' | 'mm';
type MeasurementOldNew = 'old' | 'new' | 'rebuilt_repaired';
type MeasurementStationInterval = '3' | '6' | 'custom';
type ScrewMeasurementKind = 'flight' | 'root';
type ScrewSectionKey = 'metering' | 'transition' | 'feed';
type MeasurementValue = { rawInput: string; valueInches: number | null; valueMm: number | null; unitDetected: MeasurementUnit | ''; validationMessage: string };
type InspectionContext = { id?: number; assetNumber: string; brand: string; model: string; serialNumber: string; machineYear: string; hasDoubleShotInjection: boolean; hasPlungerInjection: boolean; barrelLength: string; barrel2Length: string; plungerBarrelLength: string; barrelDiameter: string; barrel2Diameter: string; plungerDiameter: string };
type MeasurementCardDefinition = { type: MeasurementComponentType; title: string; badge: string; description: string };
type MeasurementStation = { id: string; distance: MeasurementValue; insideDiameter: MeasurementValue; notes: string };
type ScrewMeasurementReading = { id: string; label: string; value: MeasurementValue; notes: string };
type ScrewMeasurementReadings = Record<ScrewMeasurementKind, Record<ScrewSectionKey, ScrewMeasurementReading[]>>;
type MeasurementInspectionRecord = {
  componentType: MeasurementComponentType;
  status: 'draft' | 'completed';
  oldNew: MeasurementOldNew;
  dateMeasured: string;
  dateInstalled: string;
  inspectorName: string;
  comments: string;
  reasonForPull: Record<string, boolean>;
  reasonForPullOther: string;
  textFields: Record<string, string>;
  measurements: Record<string, MeasurementValue>;
  selectFields: Record<string, string>;
  stationInterval: MeasurementStationInterval;
  customStationInterval: MeasurementValue;
  stations: MeasurementStation[];
  screwReadings: ScrewMeasurementReadings;
};
type MeasurementInspectionRecordMap = Record<string, MeasurementInspectionRecord>;
type MeasurementInspectionState = { target: InspectionContext; componentType: MeasurementComponentType };
type ReplacementField = 'screw' | 'screw_tip' | 'barrel' | 'barrel_end_cap' | 'screw2' | 'screw2_tip' | 'barrel2' | 'barrel2_end_cap' | 'plunger' | 'plunger_barrel' | 'plunger_barrel_end_cap';
type UnitFieldKey = 'machineLength' | 'machineWidth' | 'machineHeight' | 'fullDieHeightLength' | 'barrelLength' | 'screwLength' | 'screw2Length' | 'barrel2Length' | 'plungerLength' | 'plungerDiameter' | 'plungerBarrelLength' | 'plungerBarrelDiameter';
type StringFormKey = { [K in keyof AssetForm]: AssetForm[K] extends string ? K : never }[keyof AssetForm];
type BooleanFormKey = { [K in keyof AssetForm]: AssetForm[K] extends boolean ? K : never }[keyof AssetForm];
type ConditionFormKey = { [K in keyof AssetForm]: AssetForm[K] extends ConditionStatus ? K : never }[keyof AssetForm];
type MachineDetailEditableSectionKey = 'basic' | 'electrical' | 'screw' | 'screwTip' | 'barrel' | 'barrelEndCap' | 'screw2' | 'screw2Tip' | 'barrel2' | 'barrel2EndCap' | 'plunger' | 'plungerBarrel' | 'plungerBarrelEndCap' | 'notes';
type MachineDetailSectionKey = MachineDetailEditableSectionKey | 'inspection';
type DatePopoverPosition = { top: number; left: number; width: number; placement: 'top' | 'bottom' };

const blankAssetForm: AssetForm = {
  assetNumber: '', assetName: '', brand: '', model: '', serialNumber: '', machineYear: '', machineType: 'Injection Molding Machine', powerType: '', shotSizeOz: '', tonnage: 0, barrelDiameter: '', location: '', department: '', status: 'active', voltageValue: '', voltageType: '', fullLoadAmp: '', machineLength: '', machineWidth: '', machineHeight: '', fullDieHeightLength: '', screwType: '', screwTipType: '', screwTipInstalledDate: '', screwInstalledDate: '', barrelInstalledDate: '', barrelEndCapInstalledDate: '', barrelLength: '', screwLength: '', screwRebuildRepaired: false, barrelRebuildRepaired: false, screwConditionStatus: 'new', barrelConditionStatus: 'new', hasDoubleShotInjection: false, hasPlungerInjection: false, screw2Type: '', screw2TipType: '', screw2RebuildRepaired: false, screw2ConditionStatus: 'new', screw2InstalledDate: '', screw2TipInstalledDate: '', screw2Length: '', barrel2Diameter: '', barrel2RebuildRepaired: false, barrel2ConditionStatus: 'new', barrel2InstalledDate: '', barrel2EndCapInstalledDate: '', barrel2Length: '', plungerType: '', plungerRebuildRepaired: false, plungerConditionStatus: 'new', plungerInstalledDate: '', plungerLength: '', plungerDiameter: '', plungerBarrelType: '', plungerBarrelRebuildRepaired: false, plungerBarrelConditionStatus: 'new', plungerBarrelInstalledDate: '', plungerBarrelEndCapInstalledDate: '', plungerBarrelLength: '', plungerBarrelDiameter: '', notes: '', criticalNotes: '',
};
const replacementLabels: Record<ReplacementField, string> = { screw: 'Screw', screw_tip: 'Screw Tip', barrel: 'Barrel', barrel_end_cap: 'Barrel End Cap', screw2: 'Screw 2', screw2_tip: 'Screw 2 Tip', barrel2: 'Barrel 2', barrel2_end_cap: 'Barrel 2 End Cap', plunger: 'Plunger', plunger_barrel: 'Plunger Barrel', plunger_barrel_end_cap: 'Plunger Barrel End Cap' };
const replacementGroups: Array<{ title: string; enabled: (form: AssetForm) => boolean; fields: ReplacementField[] }> = [
  { title: 'Unit 1', enabled: () => true, fields: ['screw','screw_tip','barrel','barrel_end_cap'] },
  { title: 'Unit 2 / Secondary Injection', enabled: form => form.hasDoubleShotInjection, fields: ['screw2','screw2_tip','barrel2','barrel2_end_cap'] },
  { title: 'Plunger Injection', enabled: form => form.hasPlungerInjection, fields: ['plunger','plunger_barrel','plunger_barrel_end_cap'] },
];
const editableRoles = new Set(['Maintenance Tech 3','Manager','Admin']);
const deleteRoles = new Set(['Manager','Admin']);
const unitFields: Array<{ key: UnitFieldKey; label: string }> = [
  { key: 'machineLength', label: 'Machine Length' },
  { key: 'machineWidth', label: 'Machine Width' },
  { key: 'machineHeight', label: 'Machine Height' },
  { key: 'fullDieHeightLength', label: 'Full Die Height Length / Range' },
];
const conditionLabels: Record<ConditionStatus, string> = { new: 'New', used: 'Used', worn: 'Worn', rebuilt_repaired: 'Rebuilt / Repaired' };
const measurementComponentLabels: Record<MeasurementComponentType, string> = { screw: 'Screw', barrel: 'Barrel', tip: 'Tip', plunger: 'Plunger', screw_2: 'Unit 2 Screw', barrel_2: 'Unit 2 Barrel', tip_2: 'Unit 2 Tip' };
const measurementOldNewLabels: Record<MeasurementOldNew, string> = { old: 'Old', new: 'New', rebuilt_repaired: 'Rebuilt / Repaired' };
const measurementReasons = ['Contamination','Splay','Cushion','Streaks','Metal','Recovery','History','Other'];
const screwIdentityFields = [
  ['screwSerialNumber','Screw Serial #'],
  ['screwPartNumber','Screw Part #'],
  ['ldRatio','L/D'],
  ['compressionRatio','Compression Ratio'],
] as const;
const screwMeasurementFields = [
  ['screwOverallLength','Screw Overall Length'],
  ['screwOverallLengthWithTip','Screw Overall Length With Tip'],
  ['screwLength','Screw Length'],
  ['flightSectionLength','Flight Section Length'],
  ['leadGapMeasurement','Lead Gap Measurement'],
] as const;
const screwSections: Array<{ key: ScrewSectionKey; label: string; shortLabel: string }> = [
  { key: 'feed', label: 'Feed Section', shortLabel: 'Feed' },
  { key: 'transition', label: 'Transition Section', shortLabel: 'Transition' },
  { key: 'metering', label: 'Metering Section', shortLabel: 'Metering' },
];
const screwMeasurementKinds: Array<{ key: ScrewMeasurementKind; label: string; shortLabel: string; accent: string }> = [
  { key: 'flight', label: 'Flight Measurements', shortLabel: 'Flight OD', accent: 'flight' },
  { key: 'root', label: 'Root Measurements', shortLabel: 'Root Dia', accent: 'root' },
];
const barrelIdentityFields = [
  ['barrelPartNumber','Barrel Part #'],
] as const;
const barrelMeasurementFields = [
  ['oemBarrelBore','OEM Barrel Bore'],
  ['barrelLength','Barrel Length'],
  ['barrelBoreScrewDiameter','Barrel Bore / Screw Diameter'],
] as const;
const tipIdentityFields = [
  ['tipMfg','Tip MFG'],
  ['tipPartNumber','Tip Part #'],
  ['tipType','Tip Type'],
  ['seatCondition','Seat Condition'],
] as const;
const tipMeasurementFields = [
  ['checkRingDia','Check Ring Dia'],
  ['leadGapMeasurement','Lead Gap Measurement'],
  ['checkRingDiameter','Check Ring Diameter'],
  ['tipDiameter','Tip Diameter'],
  ['tipLength','Tip Length'],
  ['seatMeasurement','Seat Measurement'],
] as const;
const plungerTextFields = [
  ['plungerType','Plunger Type'],
  ['plungerRebuildRepaired','Plunger Rebuild / Repaired'],
  ['plungerCondition','Plunger Condition'],
  ['plungerBarrelType','Plunger Barrel Type'],
] as const;
const plungerMeasurementFields = [
  ['plungerDiameter','Plunger Diameter'],
  ['plungerLength','Plunger Length'],
  ['plungerOverallLength','Plunger Overall Length'],
  ['cylinderBarrelBore','Cylinder Barrel Bore'],
  ['cylinderBarrelLength','Cylinder Barrel Length'],
] as const;
const machineDetailSectionFields: Record<MachineDetailEditableSectionKey, readonly (keyof AssetForm)[]> = {
  basic: ['assetName','brand','model','serialNumber','machineYear','machineType','powerType','tonnage','shotSizeOz','barrelDiameter','location','status'],
  electrical: ['voltageValue','voltageType','fullLoadAmp','machineLength','machineWidth','machineHeight','fullDieHeightLength'],
  screw: ['screwType','screwInstalledDate','screwLength','screwRebuildRepaired','screwConditionStatus'],
  screwTip: ['screwTipType','screwTipInstalledDate'],
  barrel: ['barrelDiameter','barrelInstalledDate','barrelLength','barrelRebuildRepaired','barrelConditionStatus'],
  barrelEndCap: ['barrelEndCapInstalledDate'],
  screw2: ['screw2Type','screw2InstalledDate','screw2Length','screw2RebuildRepaired','screw2ConditionStatus'],
  screw2Tip: ['screw2TipType','screw2TipInstalledDate'],
  barrel2: ['barrel2Diameter','barrel2InstalledDate','barrel2Length','barrel2RebuildRepaired','barrel2ConditionStatus'],
  barrel2EndCap: ['barrel2EndCapInstalledDate'],
  plunger: ['plungerType','plungerInstalledDate','plungerLength','plungerDiameter','plungerRebuildRepaired','plungerConditionStatus'],
  plungerBarrel: ['plungerBarrelType','plungerBarrelInstalledDate','plungerBarrelLength','plungerBarrelDiameter','plungerBarrelRebuildRepaired','plungerBarrelConditionStatus'],
  plungerBarrelEndCap: ['plungerBarrelEndCapInstalledDate'],
  notes: ['notes','criticalNotes'],
};

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { credentials: 'include', headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) }, ...options });
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(data.error || 'Request failed.');
  return data as T;
}
function assetToForm(asset: MachineAsset): AssetForm {
  const { id: _id, brandColorHex: _color, createdAt: _created, updatedAt: _updated, shotSizeOz, ...form } = asset;
  return { ...form, shotSizeOz: shotSizeOz ? String(shotSizeOz) : '' };
}
function formatDateTime(value?: string) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined,{dateStyle:'short',timeStyle:'short'}).format(date);
}
function actionLabel(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, letter=>letter.toUpperCase());
}
function ageYears(value: string) {
  if (!value.trim()) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  const years = (Date.now() - date.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  return years < 0 ? 'Unknown' : `${years.toFixed(1)} years`;
}
function machineYearAge(value: string) {
  const yearText = value.trim();
  if (!/^\d{4}$/.test(yearText)) return 'Unknown';
  const year = Number(yearText);
  const currentYear = new Date().getFullYear();
  if (!Number.isFinite(year) || year < 1900 || year > currentYear) return 'Unknown';
  const age = currentYear - year;
  return `${age} ${age === 1 ? 'yr' : 'yrs'}`;
}
function safeCssHex(value: string) {
  return /^#[0-9A-Fa-f]{6}$/.test(value) ? value : '#44D7FF';
}
function isEngelBrand(value: string) {
  return value.trim().toLowerCase() === 'engel';
}
function machineStatusLabel(status: string) {
  const normalized = status || 'active';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}
function machineSummaryStatusClass(status: string) {
  if (status === 'active') return 'status-active';
  if (status === 'down') return 'status-down';
  if (status === 'disabled') return 'status-disabled';
  if (status === 'removed') return 'status-removed';
  return 'status-unknown';
}
function machineSummarySetupClass(asset: Pick<MachineAsset, 'hasDoubleShotInjection' | 'hasPlungerInjection'>) {
  if (asset.hasDoubleShotInjection && asset.hasPlungerInjection) return 'setup-combo';
  if (asset.hasDoubleShotInjection) return 'setup-double';
  if (asset.hasPlungerInjection) return 'setup-plunger';
  return 'setup-standard';
}
function machineSummaryKnownClass(value: string, base: string) {
  return value.trim() ? base : `${base} is-unknown`;
}
function downloadTemplate() {
  window.location.href = '/api/machine-library/export/template';
}
function displayShotSize(value: number | string) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '-';
}
function injectionSetupLabel(asset: Pick<MachineAsset, 'hasDoubleShotInjection' | 'hasPlungerInjection'>) {
  if (asset.hasDoubleShotInjection && asset.hasPlungerInjection) return 'Double Shot + Plunger';
  if (asset.hasDoubleShotInjection) return 'Double Shot';
  if (asset.hasPlungerInjection) return 'Plunger';
  return '';
}
function inspectionContext(asset: Partial<MachineAsset> | Partial<AssetForm>): InspectionContext {
  return {
    id: 'id' in asset && typeof asset.id === 'number' ? asset.id : undefined,
    assetNumber: asset.assetNumber || 'Machine Asset',
    brand: asset.brand || '',
    model: asset.model || '',
    serialNumber: asset.serialNumber || '',
    machineYear: asset.machineYear || '',
    hasDoubleShotInjection: Boolean(asset.hasDoubleShotInjection),
    hasPlungerInjection: Boolean(asset.hasPlungerInjection),
    barrelLength: asset.barrelLength || '',
    barrel2Length: asset.barrel2Length || '',
    plungerBarrelLength: asset.plungerBarrelLength || '',
    barrelDiameter: asset.barrelDiameter || '',
    barrel2Diameter: asset.barrel2Diameter || '',
    plungerDiameter: asset.plungerDiameter || '',
  };
}
function measurementComponentCards(target: Pick<InspectionContext, 'hasDoubleShotInjection' | 'hasPlungerInjection'>): MeasurementCardDefinition[] {
  const cards: MeasurementCardDefinition[] = [
    { type: 'screw', title: 'Screw Inspection', badge: 'Root / Flight', description: 'Measure root, flight, length, spline.' },
    { type: 'barrel', title: 'Barrel Inspection', badge: 'Bore Stations', description: 'Measure barrel bore / inside diameter stations.' },
    { type: 'tip', title: 'Tip Inspection', badge: 'Ring / Seat', description: 'Measure check ring, tip thread, seat condition.' },
  ];
  if (target.hasPlungerInjection) cards.push({ type: 'plunger', title: 'Plunger Inspection', badge: 'Plunger', description: 'Measure plunger and plunger barrel / cylinder barrel.' });
  if (target.hasDoubleShotInjection) cards.push(
    { type: 'screw_2', title: 'Unit 2 Screw Inspection', badge: 'Unit 2', description: 'Measure secondary screw root, flight, length, spline.' },
    { type: 'barrel_2', title: 'Unit 2 Barrel Inspection', badge: 'Unit 2', description: 'Measure secondary barrel bore / inside diameter stations.' },
    { type: 'tip_2', title: 'Unit 2 Tip Inspection', badge: 'Unit 2', description: 'Measure secondary check ring, tip thread, seat condition.' },
  );
  return cards;
}
function defaultMeasurementComponent(target: Pick<InspectionContext, 'hasDoubleShotInjection' | 'hasPlungerInjection'>): MeasurementComponentType {
  return measurementComponentCards(target)[0]?.type ?? 'screw';
}
function componentSummary(type: string, date: string) {
  return `${type || '-'} / ${ageYears(date)}`;
}
function effectiveCondition(rebuildRepaired: boolean, status: ConditionStatus | string): ConditionStatus {
  if (rebuildRepaired) return 'rebuilt_repaired';
  return status === 'used' || status === 'worn' ? status : 'new';
}
function detailValue(value: string | number | boolean | null | undefined, fallback = '-') {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text ? text : fallback;
}
function detailSummary(...parts: Array<string | false | null | undefined>) {
  return parts.filter((part): part is string => Boolean(part && part.trim())).join(' / ') || 'Not set';
}
function assetDimensionSummary(asset: Pick<MachineAsset, 'machineLength' | 'machineWidth' | 'machineHeight'>) {
  return asset.machineLength || asset.machineWidth || asset.machineHeight ? 'Dimensions set' : 'Dimensions not set';
}
function mergeAssetSectionDraft(asset: MachineAsset, draft: AssetForm, fields: readonly (keyof AssetForm)[]): AssetForm {
  const payload = assetToForm(asset);
  for (const key of fields) (payload as Record<string, unknown>)[key] = draft[key];
  return payload;
}
function isoDateValue(value: string) {
  const clean = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
  const parsed = new Date(clean);
  if (!clean || Number.isNaN(parsed.getTime())) return clean ? null : '';
  return parsed.toISOString().slice(0, 10);
}
function formatUnitNumber(value: number, decimals: number) {
  return Number(value.toFixed(decimals)).toLocaleString(undefined, { maximumFractionDigits: decimals });
}
function localIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
function parseIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}
function parseDimensionValue(value: string) {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(mm|millimeter|millimeters|in|inch|inches|"|ft|foot|feet|')$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (!Number.isFinite(amount)) return null;
  const mm = unit.startsWith('mm') || unit.startsWith('millimeter') ? amount : unit === 'in' || unit === 'inch' || unit === 'inches' || unit === '"' ? amount * 25.4 : amount * 304.8;
  return { mm, inches: mm / 25.4, feet: mm / 304.8 };
}
function measurementValueFromRaw(rawInput: string): MeasurementValue {
  const raw = rawInput;
  const clean = raw.trim();
  if (!clean) return { rawInput: raw, valueInches: null, valueMm: null, unitDetected: '', validationMessage: '' };
  if (/^[+-]?$|^[+-]?\.$/.test(clean)) return { rawInput: raw, valueInches: null, valueMm: null, unitDetected: '', validationMessage: '' };
  const match = clean.match(/^([+-]?(?:\d+\.?\d*|\.\d+))\s*(mm|millimeter|millimeters|in|inch|inches|")?$/i);
  if (!match) return { rawInput: raw, valueInches: null, valueMm: null, unitDetected: '', validationMessage: 'Enter a number with optional in or mm.' };
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return { rawInput: raw, valueInches: null, valueMm: null, unitDetected: '', validationMessage: 'Enter a numeric measurement.' };
  if (amount < 0) return { rawInput: raw, valueInches: null, valueMm: null, unitDetected: '', validationMessage: 'Measurement cannot be negative.' };
  const unitText = (match[2] || 'in').toLowerCase();
  const unitDetected: MeasurementUnit = unitText.startsWith('mm') || unitText.startsWith('millimeter') ? 'mm' : 'in';
  const valueMm = unitDetected === 'mm' ? amount : amount * 25.4;
  const valueInches = valueMm / 25.4;
  return { rawInput: raw, valueInches, valueMm, unitDetected, validationMessage: '' };
}
function measurementValueFromKnownDimension(value: string) {
  const parsed = parseDimensionValue(value);
  if (parsed) return measurementValueFromRaw(`${formatUnitNumber(parsed.inches, 3)}in`);
  return measurementValueFromRaw(value);
}
function measurementHelperText(value: MeasurementValue) {
  if (value.validationMessage) return value.validationMessage;
  if (value.valueInches === null || value.valueMm === null || !value.unitDetected) return '';
  return value.unitDetected === 'mm' ? `${formatUnitNumber(value.valueInches, 3)} in` : `${formatUnitNumber(value.valueMm, 2)} mm`;
}
function emptyScrewReadings(): ScrewMeasurementReadings {
  return {
    flight: { feed: [], transition: [], metering: [] },
    root: { feed: [], transition: [], metering: [] },
  };
}
function screwReadingsForRecord(record: MeasurementInspectionRecord) {
  return record.screwReadings ?? emptyScrewReadings();
}
function createScrewReading(kind: ScrewMeasurementKind, section: ScrewSectionKey, index: number): ScrewMeasurementReading {
  const sectionLabel = screwSections.find(item=>item.key===section)?.shortLabel ?? section;
  const kindLabel = kind === 'flight' ? 'Flight' : 'Root';
  return { id: `${kind}-${section}-${Date.now()}-${Math.random().toString(16).slice(2)}`, label: `${sectionLabel} ${kindLabel} ${index}`, value: measurementValueFromRaw(''), notes: '' };
}
function smallestScrewReading(readings: ScrewMeasurementReading[]) {
  const values = readings.map(reading=>reading.value).filter(value=>!value.validationMessage && value.valueInches !== null && value.valueMm !== null);
  if (!values.length) return null;
  return values.reduce((smallest,value)=>value.valueInches! < smallest.valueInches! ? value : smallest);
}
function measurementValueDisplay(value: MeasurementValue | null) {
  if (!value || value.valueInches === null || value.valueMm === null) return 'No readings';
  return `${formatUnitNumber(value.valueInches, 3)} in / ${formatUnitNumber(value.valueMm, 2)} mm`;
}
function measurementRecordKey(target: InspectionContext, componentType: MeasurementComponentType) {
  return `${target.id ?? (target.assetNumber || 'draft')}:${componentType}`;
}
function measurementTargetKey(target: InspectionContext) {
  return String(target.id ?? (target.assetNumber || 'draft'));
}
function fieldMap(keys: readonly (readonly [string, string])[]) {
  return Object.fromEntries(keys.map(([key])=>[key,'']));
}
function measurementMap(keys: readonly (readonly [string, string])[], defaults: Record<string, string> = {}) {
  return Object.fromEntries(keys.map(([key])=>[key,measurementValueFromKnownDimension(defaults[key] ?? '')]));
}
function stationRowsFromLength(lengthValue: MeasurementValue, intervalValue: MeasurementValue) {
  const length = lengthValue.valueInches;
  const interval = intervalValue.valueInches;
  if (!length || !interval || length <= 0 || interval <= 0) return [];
  const rows: MeasurementStation[] = [];
  for (let distance = 0; distance <= length + 0.001; distance += interval) {
    rows.push({ id: `station-${rows.length}-${distance.toFixed(3)}`, distance: measurementValueFromRaw(`${formatUnitNumber(distance, 3)}in`), insideDiameter: measurementValueFromRaw(''), notes: '' });
    if (rows.length > 80) break;
  }
  if (rows.length && rows[rows.length - 1].distance.valueInches !== null && Math.abs(rows[rows.length - 1].distance.valueInches! - length) > 0.05) rows.push({ id: `station-${rows.length}-${length.toFixed(3)}`, distance: measurementValueFromRaw(`${formatUnitNumber(length, 3)}in`), insideDiameter: measurementValueFromRaw(''), notes: '' });
  return rows;
}
function defaultMeasurementRecord(target: InspectionContext, componentType: MeasurementComponentType, inspectorName = ''): MeasurementInspectionRecord {
  const isUnit2 = componentType.endsWith('_2');
  const isBarrel = componentType === 'barrel' || componentType === 'barrel_2';
  const isTip = componentType === 'tip' || componentType === 'tip_2';
  const isPlunger = componentType === 'plunger';
  const barrelLength = isUnit2 ? target.barrel2Length : target.barrelLength;
  const barrelDiameter = isUnit2 ? target.barrel2Diameter : target.barrelDiameter;
  const plungerBarrelLength = target.plungerBarrelLength;
  const base: MeasurementInspectionRecord = {
    componentType,
    status: 'draft',
    oldNew: 'old',
    dateMeasured: localIsoDate(new Date()),
    dateInstalled: '',
    inspectorName,
    comments: '',
    reasonForPull: Object.fromEntries(measurementReasons.map(reason=>[reason,false])),
    reasonForPullOther: '',
    textFields: {},
    measurements: {},
    selectFields: {},
    stationInterval: '3',
    customStationInterval: measurementValueFromRaw(''),
    stations: [],
    screwReadings: emptyScrewReadings(),
  };
  if (componentType === 'screw' || componentType === 'screw_2') {
    return { ...base, textFields: { ...fieldMap(screwIdentityFields), splineNotes: '', screwComments: '' }, measurements: measurementMap(screwMeasurementFields), selectFields: { splineCheck: '' } };
  }
  if (isBarrel) {
    const measurements = measurementMap(barrelMeasurementFields, { barrelLength, barrelBoreScrewDiameter: barrelDiameter, oemBarrelBore: barrelDiameter });
    const interval = Number(measurements.barrelLength.valueInches ?? 0) > 40 ? measurementValueFromRaw('6in') : measurementValueFromRaw('3in');
    return { ...base, stationInterval: interval.valueInches === 6 ? '6' : '3', textFields: { ...fieldMap(barrelIdentityFields), barrelNotes: '', barrelComments: '' }, measurements, stations: stationRowsFromLength(measurements.barrelLength, interval) };
  }
  if (isTip) {
    return { ...base, textFields: { ...fieldMap(tipIdentityFields), tipThreadNotes: '', tipComments: '' }, measurements: measurementMap(tipMeasurementFields), selectFields: { tipThreadInspection: '' } };
  }
  if (isPlunger) {
    const measurements = measurementMap(plungerMeasurementFields, { plungerDiameter: target.plungerDiameter, cylinderBarrelLength: plungerBarrelLength });
    return { ...base, textFields: { ...fieldMap(plungerTextFields), plungerNotes: '', plungerComments: '', cylinderBarrelNotes: '' }, measurements, stations: stationRowsFromLength(measurements.cylinderBarrelLength, measurementValueFromRaw('3in')) };
  }
  return base;
}
function ensureMeasurementRecord(records: MeasurementInspectionRecordMap, target: InspectionContext, componentType: MeasurementComponentType, inspectorName = '') {
  const key = measurementRecordKey(target, componentType);
  return records[key] ? records : { ...records, [key]: defaultMeasurementRecord(target, componentType, inspectorName) };
}
function targetMeasurementRecords(records: MeasurementInspectionRecordMap, target: InspectionContext) {
  const targetKey = measurementTargetKey(target);
  return Object.entries(records).filter(([key])=>key.startsWith(`${targetKey}:`)).map(([,record])=>record);
}
function importToast(summary: MachineImportSummary) {
  const added = summary.addedCount ?? 0;
  const updated = summary.updatedCount ?? 0;
  const skipped = summary.skippedCount ?? 0;
  const rejected = summary.rejectedDuplicateCount ?? 0;
  if (added + updated > 0) return { kind: 'success' as const, text: `Machine import complete: ${added} added, ${updated} updated, ${rejected} rejected.` };
  return { kind: 'error' as const, text: `Machine import finished with no changes: ${rejected} rejected, ${skipped} skipped.` };
}

export function MachineLibraryPage({ userRole = '', userFullName = '' }: { userRole?: string; userFullName?: string }) {
  const [assets,setAssets]=useState<MachineAsset[]>([]);
  const [brandSettings,setBrandSettings]=useState<BrandSetting[]>([]);
  const [permissions,setPermissions]=useState({canEdit:editableRoles.has(userRole),canDelete:deleteRoles.has(userRole)});
  const [search,setSearch]=useState('');
  const [brandFilter,setBrandFilter]=useState('');
  const [statusFilter,setStatusFilter]=useState('');
  const [message,setMessage]=useState<{kind:'success'|'error';text:string}|null>(null);
  const [importMode,setImportMode]=useState<ImportMode>('add_new_only');
  const [isImporting,setIsImporting]=useState(false);
  const [importSummary,setImportSummary]=useState<MachineImportSummary|null>(null);
  const [highlightedAssets,setHighlightedAssets]=useState<Set<string>>(new Set());
  const [editing,setEditing]=useState<MachineAsset|null>(null);
  const [form,setForm]=useState<AssetForm>(blankAssetForm);
  const [setupDraft,setSetupDraft]=useState({hasDoubleShotInjection:false,hasPlungerInjection:false});
  const [showSetup,setShowSetup]=useState(false);
  const [showEditor,setShowEditor]=useState(false);
  const [showColors,setShowColors]=useState(false);
  const [colorDrafts,setColorDrafts]=useState<Record<string,string>>({});
  const [detailAsset,setDetailAsset]=useState<MachineAsset|null>(null);
  const [inspection,setInspection]=useState<MeasurementInspectionState|null>(null);
  const [measurementRecords,setMeasurementRecords]=useState<MeasurementInspectionRecordMap>({});
  const [logs,setLogs]=useState<{asset:MachineAsset;records:HistoryRecord[]}|null>(null);
  const [replacement,setReplacement]=useState<{asset:MachineAsset;field:ReplacementField;installDate:string;reasonNote:string}|null>(null);
  const fileRef = useRef<HTMLInputElement|null>(null);
  const brands = useMemo(()=>[...new Set(assets.map(asset=>asset.brand).filter(Boolean))].sort((a,b)=>a.localeCompare(b)),[assets]);
  const canEdit = permissions.canEdit || editableRoles.has(userRole);
  const canDelete = permissions.canDelete || deleteRoles.has(userRole);

  function loadAssets() {
    const params = new URLSearchParams();
    if (search.trim()) params.set('q', search.trim());
    if (brandFilter) params.set('brand', brandFilter);
    if (statusFilter) params.set('status', statusFilter);
    api<{ok:boolean;assets:MachineAsset[];brandSettings:BrandSetting[];permissions:{canEdit:boolean;canDelete:boolean}}>(`/api/machine-library/assets?${params}`)
      .then(data=>{ setAssets(data.assets ?? []); setBrandSettings(data.brandSettings ?? []); setPermissions(data.permissions ?? permissions); setColorDrafts(Object.fromEntries((data.brandSettings ?? []).map(setting=>[setting.brandName,setting.colorHex]))); })
      .catch(error=>setMessage({kind:'error',text:(error as Error).message}));
  }
  useEffect(()=>{ loadAssets(); },[search,brandFilter,statusFilter]);

  function openAdd() { setSetupDraft({hasDoubleShotInjection:false,hasPlungerInjection:false}); setShowSetup(true); }
  function continueAddFromSetup() { setEditing(null); setForm({...blankAssetForm,...setupDraft}); setShowSetup(false); setShowEditor(true); }
  function openEdit(asset: MachineAsset) { setEditing(asset); setForm(assetToForm(asset)); setShowEditor(true); }
  function setField<K extends keyof AssetForm>(key: K, value: AssetForm[K]) { setForm(current=>({...current,[key]:value})); }
  async function saveAsset(event: FormEvent) {
    event.preventDefault();
    if (!canEdit) return;
    try {
      const path = editing ? `/api/machine-library/assets/${editing.id}` : '/api/machine-library/assets';
      const method = editing ? 'PUT' : 'POST';
      await api(path,{method,body:JSON.stringify(form)});
      setShowEditor(false);
      setMessage({kind:'success',text:editing ? 'Machine asset updated.' : 'Machine asset created.'});
      loadAssets();
    } catch (error) {
      setMessage({kind:'error',text:(error as Error).message});
    }
  }
  async function updateReplacement(event: FormEvent) {
    event.preventDefault();
    if (!replacement) return;
    try {
      await api(`/api/machine-library/assets/${replacement.asset.id}/replacements/${replacement.field}`,{method:'POST',body:JSON.stringify({installDate:replacement.installDate,reasonNote:replacement.reasonNote})});
      setReplacement(null);
      setMessage({kind:'success',text:`${replacementLabels[replacement.field]} install date updated.`});
      loadAssets();
    } catch (error) {
      setMessage({kind:'error',text:(error as Error).message});
    }
  }
  async function disableAsset(asset: MachineAsset) {
    if (!canDelete) return;
    const reasonNote = window.prompt(`Reason for disabling ${asset.assetNumber}?`)?.trim();
    if (!reasonNote) return;
    await api(`/api/machine-library/assets/${asset.id}/disable`,{method:'POST',body:JSON.stringify({reasonNote})});
    setMessage({kind:'success',text:`${asset.assetNumber} disabled.`});
    loadAssets();
  }
  async function loadLogs(asset: MachineAsset) {
    try {
      const data = await api<{ok:boolean;asset:MachineAsset;records:HistoryRecord[]}>(`/api/machine-library/assets/${asset.id}/history`);
      setLogs({asset:data.asset,records:data.records ?? []});
    } catch (error) {
      setMessage({kind:'error',text:(error as Error).message});
    }
  }
  async function saveColor(brandName: string) {
    const colorHex = colorDrafts[brandName] ?? '';
    if (!window.confirm(`Are you sure? This will change the color for all ${brandName} machine assets.`)) return;
    try {
      await api(`/api/machine-library/brand-settings/${encodeURIComponent(brandName)}`,{method:'PUT',body:JSON.stringify({colorHex})});
      setMessage({kind:'success',text:`${brandName} color updated.`});
      loadAssets();
    } catch (error) {
      setMessage({kind:'error',text:(error as Error).message});
    }
  }
  async function importMachineList() {
    const file = fileRef.current?.files?.[0];
    if (!file || isImporting) return;
    const body = new FormData();
    body.append('file', file);
    body.append('importMode', importMode);
    setIsImporting(true);
    try {
      const res = await fetch('/api/machine-library/import',{method:'POST',credentials:'include',body});
      const data = await res.json().catch(()=>({}));
      if (!res.ok) { setMessage({kind:'error',text:data.error || 'Machine import failed.'}); return; }
      const summary = data as MachineImportSummary;
      const changed = new Set((summary.changedAssetNumbers ?? []).map(String));
      if (changed.size) {
        setHighlightedAssets(changed);
        window.setTimeout(()=>setHighlightedAssets(new Set()), 5 * 60 * 1000);
      }
      if ((summary.rejectedDuplicateCount ?? 0) > 0) setImportSummary(summary);
      else setMessage(importToast(summary));
      loadAssets();
    } catch (error) {
      setMessage({kind:'error',text:(error as Error).message || 'Machine import failed.'});
    } finally {
      setIsImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }
  function closeImportSummary() {
    if (importSummary) setMessage(importToast(importSummary));
    setImportSummary(null);
  }
  function openMeasurementInspection(target: InspectionContext, componentType = defaultMeasurementComponent(target)) {
    setMeasurementRecords(current=>ensureMeasurementRecord(current,target,componentType,userFullName));
    setInspection({target,componentType});
  }

  return (
    <div className="page-stack machine-library-page">
      {message&&<p className={message.kind==='error'?'form-message inventory-toast error':'form-message inventory-toast'}>{message.text}<button className="toast-close-button" type="button" onClick={()=>setMessage(null)}>Close</button></p>}
      <section className="mcc-card machine-toolbar-card">
        <label className="form-field machine-search"><span>Search assets</span><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Press 14, Toyo, model, serial number..." /></label>
        <label className="form-field"><span>Brand</span><select value={brandFilter} onChange={event=>setBrandFilter(event.target.value)}><option value="">All brands</option>{brands.map(brand=><option key={brand} value={brand}>{brand}</option>)}</select></label>
        <label className="form-field"><span>Status</span><select value={statusFilter} onChange={event=>setStatusFilter(event.target.value)}><option value="">All status</option><option value="active">Active</option><option value="down">Down</option><option value="disabled">Disabled</option><option value="removed">Removed</option></select></label>
        <div className="machine-toolbar-actions">
          <button className="primary-button compact-button" type="button" onClick={openAdd} disabled={!canEdit}>Add Machine Asset</button>
          <label className="form-field machine-import-mode"><span>Import Mode</span><select value={importMode} onChange={event=>setImportMode(event.target.value as ImportMode)} disabled={!canEdit||isImporting}><option value="add_new_only">Add New Only</option><option value="upsert">Update Existing / Upsert</option></select></label>
          <button className="secondary-button compact-button" type="button" onClick={()=>fileRef.current?.click()} disabled={!canEdit||isImporting}>{isImporting?'Importing...':'Import Machine List'}</button>
          <button className="secondary-button compact-button" type="button" onClick={downloadTemplate} disabled={!canEdit}>Export Machine Template</button>
          <button className="secondary-button compact-button" type="button" onClick={()=>setShowColors(true)}>Brand Color Settings</button>
          <input ref={fileRef} type="file" accept=".csv,.xlsx" className="hidden-file-input" onChange={()=>void importMachineList()} />
        </div>
        <p className="form-help machine-toolbar-note">Add New Only rejects existing Asset Numbers. Upsert updates existing assets and creates new ones. Duplicate Asset Numbers inside one file are always rejected after the first valid row.</p>
        {!canEdit&&<p className="form-help machine-toolbar-note">Tier 3, Manager, Admin, or Owner Admin access is required to add or edit machine assets.</p>}
      </section>
      <div className={`machine-card-grid ${assets.length === 1 ? 'single-result' : 'multi-results'}`}>
        {assets.map(asset=>(
          <article className={`machine-asset-card ${highlightedAssets.has(asset.assetNumber) ? 'machine-import-highlight' : ''} ${isEngelBrand(asset.brand) ? 'machine-brand-engel' : ''}`} style={{'--brand-color':safeCssHex(asset.brandColorHex)} as CSSProperties} key={asset.id} role="button" tabIndex={0} aria-label={`View details for ${asset.assetNumber}`} onClick={()=>setDetailAsset(asset)} onKeyDown={event=>{ if (event.target !== event.currentTarget) return; if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setDetailAsset(asset); } }}>
            <div className="machine-card-head">
              <button className="machine-asset-number" type="button" onClick={event=>{ event.stopPropagation(); void loadLogs(asset); }}>{asset.assetNumber}</button>
              {asset.status === 'active'
                ? <span className="machine-status-badge status-active" title="Active" aria-label="Active"><span className="status-pulse-dot" /></span>
                : <span className={`machine-status-badge status-${asset.status}`}>{machineStatusLabel(asset.status)}</span>}
            </div>
            <div className="machine-card-title">
              <div className="machine-card-brand-row">
                <strong className="machine-card-brand-name">{asset.brand || 'Unknown'}</strong>
                <span className="machine-age-pill">Year {asset.machineYear || 'Unknown'} &bull; Age {machineYearAge(asset.machineYear)}</span>
              </div>
              <div className="machine-card-identity">
                <div><span>Model:</span><strong>{asset.model || '-'}</strong></div>
                <div><span>Serial #:</span><strong>{asset.serialNumber || '-'}</strong></div>
              </div>
            </div>
            <dl className="machine-spec-grid">
              <div><dt>Tonnage</dt><dd>{asset.tonnage || '-'}</dd></div><div><dt>Shot Size</dt><dd>{displayShotSize(asset.shotSizeOz)} oz</dd></div><div><dt>Barrel</dt><dd>{asset.barrelDiameter || '-'}</dd></div><div><dt>Power</dt><dd>{asset.powerType || '-'}</dd></div>
            </dl>
            <div className="machine-wear-grid">
              {injectionSetupLabel(asset)&&<span className="machine-setup-badge">{injectionSetupLabel(asset)}</span>}
              {!asset.hasDoubleShotInjection&&!asset.hasPlungerInjection&&<>
                <ConditionBadge label="Screw" status={effectiveCondition(asset.screwRebuildRepaired, asset.screwConditionStatus)} />
                <ConditionBadge label="Barrel" status={effectiveCondition(asset.barrelRebuildRepaired, asset.barrelConditionStatus)} />
                <div><span>Screw</span><strong>{asset.screwInstalledDate || '-'}</strong></div>
                <div><span>Barrel</span><strong>{asset.barrelInstalledDate || '-'}</strong></div>
                <div><span>Tip</span><strong>{asset.screwTipInstalledDate || '-'}</strong></div>
                <div><span>End Cap</span><strong>{asset.barrelEndCapInstalledDate || '-'}</strong></div>
              </>}
              {asset.hasDoubleShotInjection&&<>
                <div><span>U1 Screw</span><strong>{componentSummary(asset.screwType, asset.screwInstalledDate)}</strong></div>
                <div><span>U1 Barrel</span><strong>{componentSummary(asset.barrelDiameter, asset.barrelInstalledDate)}</strong></div>
                <div><span>U2 Screw</span><strong>{componentSummary(asset.screw2Type, asset.screw2InstalledDate)}</strong></div>
                <div><span>U2 Barrel</span><strong>{componentSummary(asset.barrel2Diameter, asset.barrel2InstalledDate)}</strong></div>
              </>}
              {asset.hasPlungerInjection&&<>
                <div><span>Plunger</span><strong>{componentSummary(asset.plungerType || asset.plungerDiameter, asset.plungerInstalledDate)}</strong></div>
                <div><span>Plunger Barrel</span><strong>{componentSummary(asset.plungerBarrelType || asset.plungerBarrelDiameter, asset.plungerBarrelInstalledDate)}</strong></div>
              </>}
            </div>
            {(asset.notes || asset.criticalNotes)&&<div className="machine-card-notes">{asset.notes&&<p className="machine-note-text">{asset.notes}</p>}{asset.criticalNotes&&<p className="machine-critical-text">{asset.criticalNotes}</p>}</div>}
            <div className="machine-card-actions">
              <button className="primary-button compact-button" type="button" onClick={event=>{ event.stopPropagation(); openEdit(asset); }}>{canEdit?'View/Edit':'View'}</button>
              <button className="secondary-button compact-button" type="button" onClick={event=>{ event.stopPropagation(); void loadLogs(asset); }}>Logs</button>
              {canDelete&&asset.status!=='disabled'&&<button className="secondary-button compact-button" type="button" onClick={event=>{ event.stopPropagation(); void disableAsset(asset); }}>Disable</button>}
            </div>
          </article>
        ))}
        {!assets.length&&<section className="mcc-card machine-empty-card"><strong>No machine assets found.</strong><p>Add a machine asset or import the press list template.</p></section>}
      </div>
      {showSetup&&<InjectionSetupModal setup={setupDraft} setSetup={setSetupDraft} onContinue={continueAddFromSetup} onCancel={()=>setShowSetup(false)} />}
      {detailAsset&&<MachineDetailModal asset={detailAsset} canEdit={canEdit} measurementRecords={measurementRecords} onClose={()=>setDetailAsset(null)} onEdit={()=>{ const asset = detailAsset; setDetailAsset(null); openEdit(asset); }} onLogs={()=>{ const asset = detailAsset; setDetailAsset(null); void loadLogs(asset); }} onInspection={componentType=>openMeasurementInspection(inspectionContext(detailAsset),componentType)} onAssetUpdated={updated=>{ setDetailAsset(updated); setAssets(current=>current.map(asset=>asset.id===updated.id ? updated : asset)); setMessage({kind:'success',text:'Machine asset section updated.'}); loadAssets(); }} />}
      {showEditor&&<MachineEditorModal form={form} setField={setField} onClose={()=>setShowEditor(false)} onSubmit={saveAsset} canEdit={canEdit} asset={editing} onReplacement={(asset,field)=>setReplacement({asset,field,installDate:'',reasonNote:''})} onInspection={()=>{ const target = inspectionContext(editing ?? form); openMeasurementInspection(target, defaultMeasurementComponent(target)); }} />}
      {inspection&&<MeasurementInspectionModal target={inspection.target} initialComponentType={inspection.componentType} records={measurementRecords} setRecords={setMeasurementRecords} userFullName={userFullName} onClose={()=>setInspection(null)} />}
      {importSummary&&<ImportResultModal summary={importSummary} onClose={closeImportSummary} />}
      {showColors&&<BrandColorModal brandSettings={brandSettings} colorDrafts={colorDrafts} setColorDrafts={setColorDrafts} canEdit={canEdit} onSave={saveColor} onClose={()=>setShowColors(false)} />}
      {replacement&&<ReplacementModal replacement={replacement} setReplacement={setReplacement} onSubmit={updateReplacement} />}
      {logs&&<LogsModal logs={logs} onClose={()=>setLogs(null)} onBackToAsset={()=>{ setForm(assetToForm(logs.asset)); setEditing(logs.asset); setLogs(null); setShowEditor(true); }} />}
    </div>
  );
}

function MachineDetailModal({asset,canEdit,measurementRecords,onClose,onEdit,onLogs,onInspection,onAssetUpdated}:{asset:MachineAsset;canEdit:boolean;measurementRecords:MeasurementInspectionRecordMap;onClose:()=>void;onEdit:()=>void;onLogs:()=>void;onInspection:(componentType:MeasurementComponentType)=>void;onAssetUpdated:(asset:MachineAsset)=>void}) {
  const [currentAsset,setCurrentAsset]=useState(asset);
  const [draft,setDraft]=useState<AssetForm>(()=>assetToForm(asset));
  const [openSection,setOpenSection]=useState<MachineDetailSectionKey|null>(null);
  const [editingSection,setEditingSection]=useState<MachineDetailEditableSectionKey|null>(null);
  const [savingSection,setSavingSection]=useState<MachineDetailEditableSectionKey|null>(null);
  const [sectionErrors,setSectionErrors]=useState<Partial<Record<MachineDetailEditableSectionKey,string>>>({});
  const unitLabel = injectionSetupLabel(currentAsset) || 'Standard Injection';
  const screwCondition = effectiveCondition(currentAsset.screwRebuildRepaired, currentAsset.screwConditionStatus);
  const barrelCondition = effectiveCondition(currentAsset.barrelRebuildRepaired, currentAsset.barrelConditionStatus);
  const screw2Condition = effectiveCondition(currentAsset.screw2RebuildRepaired, currentAsset.screw2ConditionStatus);
  const barrel2Condition = effectiveCondition(currentAsset.barrel2RebuildRepaired, currentAsset.barrel2ConditionStatus);
  const plungerCondition = effectiveCondition(currentAsset.plungerRebuildRepaired, currentAsset.plungerConditionStatus);
  const plungerBarrelCondition = effectiveCondition(currentAsset.plungerBarrelRebuildRepaired, currentAsset.plungerBarrelConditionStatus);

  useEffect(()=>{
    setCurrentAsset(asset);
    setDraft(assetToForm(asset));
    setOpenSection(null);
    setEditingSection(null);
    setSectionErrors({});
  },[asset.id]);
  useEffect(()=>{
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || editingSection) return;
      setOpenSection(null);
    }
    document.addEventListener('keydown',onKeyDown);
    return ()=>document.removeEventListener('keydown',onKeyDown);
  },[editingSection]);

  function setDraftField<K extends keyof AssetForm>(key: K, value: AssetForm[K]) {
    setDraft(current=>({...current,[key]:value}));
  }
  function toggleOpenSection(key: MachineDetailSectionKey) {
    if (editingSection) return;
    setOpenSection(current=>current === key ? null : key);
  }
  function beginSectionEdit(key: MachineDetailEditableSectionKey) {
    if (!canEdit) return;
    setDraft(assetToForm(currentAsset));
    setOpenSection(key);
    setEditingSection(key);
    setSectionErrors(current=>({...current,[key]:undefined}));
  }
  function cancelSectionEdit() {
    setDraft(assetToForm(currentAsset));
    setEditingSection(null);
  }
  async function saveSection(key: MachineDetailEditableSectionKey) {
    if (!canEdit || savingSection) return;
    setSavingSection(key);
    setSectionErrors(current=>({...current,[key]:undefined}));
    try {
      const payload = mergeAssetSectionDraft(currentAsset,draft,machineDetailSectionFields[key]);
      const data = await api<{ok:boolean;asset:MachineAsset}>(`/api/machine-library/assets/${currentAsset.id}`,{method:'PUT',body:JSON.stringify(payload)});
      setCurrentAsset(data.asset);
      setDraft(assetToForm(data.asset));
      setOpenSection(key);
      setEditingSection(null);
      onAssetUpdated(data.asset);
    } catch (error) {
      setSectionErrors(current=>({...current,[key]:(error as Error).message || 'Section save failed.'}));
    } finally {
      setSavingSection(null);
    }
  }

  const sections: Array<{key:MachineDetailSectionKey;editableKey?:MachineDetailEditableSectionKey;title:string;summary:string;status?:ReactNode;actionLabel?:string;onAction?:()=>void;view:ReactNode;edit?:ReactNode}> = [
    {
      key: 'basic',
      editableKey: 'basic',
      title: 'Basic Info',
      summary: detailSummary(currentAsset.assetName || currentAsset.assetNumber, currentAsset.brand || 'Brand unknown', currentAsset.machineYear ? `${currentAsset.machineYear} / ${machineYearAge(currentAsset.machineYear)}` : 'Year unknown'),
      view: <><DetailItem label="Asset Name" value={detailValue(currentAsset.assetName)} /><DetailItem label="Brand" value={detailValue(currentAsset.brand)} /><DetailItem label="Model" value={detailValue(currentAsset.model)} /><DetailItem label="Serial #" value={detailValue(currentAsset.serialNumber)} /><DetailItem label="Machine Year" value={<>{detailValue(currentAsset.machineYear)} <small className="machine-age-pill machine-age-helper-pill">Age: {machineYearAge(currentAsset.machineYear)}</small></>} /><DetailItem label="Machine Type" value={detailValue(currentAsset.machineType)} /><DetailItem label="Power Type" value={detailValue(currentAsset.powerType)} /><DetailItem label="Tonnage" value={detailValue(currentAsset.tonnage)} /><DetailItem label="Shot Size" value={`${displayShotSize(currentAsset.shotSizeOz)} oz`} /><DetailItem label="Barrel / Screw Diameter" value={detailValue(currentAsset.barrelDiameter)} /><DetailItem label="Location" value={detailValue(currentAsset.location)} /><DetailItem label="Status" value={machineStatusLabel(currentAsset.status)} /></>,
      edit: <><Text label="Asset Name" value={draft.assetName} set={v=>setDraftField('assetName',v)} disabled={!canEdit}/><Text label="Brand *" value={draft.brand} set={v=>setDraftField('brand',v)} disabled={!canEdit}/><Text label="Model" value={draft.model} set={v=>setDraftField('model',v)} disabled={!canEdit}/><Text label="Serial Number" value={draft.serialNumber} set={v=>setDraftField('serialNumber',v)} disabled={!canEdit}/><Text label="Machine Year" value={draft.machineYear} set={v=>setDraftField('machineYear',v)} disabled={!canEdit} helper={<small className="machine-age-pill machine-age-helper-pill">Age: {machineYearAge(draft.machineYear)}</small>}/><Text label="Machine Type" value={draft.machineType} set={v=>setDraftField('machineType',v)} disabled={!canEdit}/><Select label="Power Type" value={draft.powerType} set={v=>setDraftField('powerType',v)} options={['','Hydraulic','Electric','Hybrid','Other']} disabled={!canEdit}/><Text label="Tonnage" value={String(draft.tonnage)} set={v=>setDraftField('tonnage',Number(v)||0)} disabled={!canEdit}/><DecimalInput label="Shot Size (oz)" value={draft.shotSizeOz} set={v=>setDraftField('shotSizeOz',v)} disabled={!canEdit}/><Text label="Barrel/Screw Diameter" value={draft.barrelDiameter} set={v=>setDraftField('barrelDiameter',v)} disabled={!canEdit}/><Text label="Location" value={draft.location} set={v=>setDraftField('location',v)} disabled={!canEdit}/><Select label="Status" value={draft.status} set={v=>setDraftField('status',v)} options={['active','down','disabled','removed']} disabled={!canEdit}/></>,
    },
    {
      key: 'electrical',
      editableKey: 'electrical',
      title: 'Electrical / Dimensions',
      summary: detailSummary(currentAsset.powerType || 'Power unknown', currentAsset.voltageValue ? `${currentAsset.voltageValue} ${currentAsset.voltageType}`.trim() : 'Voltage unknown', assetDimensionSummary(currentAsset)),
      view: <><DetailItem label="Voltage" value={detailValue(currentAsset.voltageValue)} /><DetailItem label="Voltage Type" value={detailValue(currentAsset.voltageType)} /><DetailItem label="Full Load Amp" value={detailValue(currentAsset.fullLoadAmp)} /><DetailItem label="Machine Length" value={detailValue(currentAsset.machineLength)} /><DetailItem label="Machine Width" value={detailValue(currentAsset.machineWidth)} /><DetailItem label="Machine Height" value={detailValue(currentAsset.machineHeight)} /><DetailItem label="Full Die Height Length / Range" value={detailValue(currentAsset.fullDieHeightLength)} /></>,
      edit: <><Text label="Voltage" value={draft.voltageValue} set={v=>setDraftField('voltageValue',v)} disabled={!canEdit}/><Select label="Voltage Type" value={draft.voltageType} set={v=>setDraftField('voltageType',v)} options={['','AC','DC']} disabled={!canEdit}/><Text label="Full Load Amp" value={draft.fullLoadAmp} set={v=>setDraftField('fullLoadAmp',v)} disabled={!canEdit}/><UnitDimensionField label="Machine Length" value={draft.machineLength} set={v=>setDraftField('machineLength',v)} disabled={!canEdit}/><UnitDimensionField label="Machine Width" value={draft.machineWidth} set={v=>setDraftField('machineWidth',v)} disabled={!canEdit}/><UnitDimensionField label="Machine Height" value={draft.machineHeight} set={v=>setDraftField('machineHeight',v)} disabled={!canEdit}/><UnitDimensionField label="Full Die Height Length / Range" value={draft.fullDieHeightLength} set={v=>setDraftField('fullDieHeightLength',v)} disabled={!canEdit}/></>,
    },
    {
      key: 'screw',
      editableKey: 'screw',
      title: 'Screw',
      summary: detailSummary(conditionLabels[screwCondition], currentAsset.screwLength || 'Length unknown', currentAsset.screwInstalledDate || 'Installed date unknown'),
      status: <DetailStatusPill status={screwCondition} />,
      view: <><DetailItem label="Screw Type" value={detailValue(currentAsset.screwType)} /><DetailItem label="Screw Installed Date" value={detailValue(currentAsset.screwInstalledDate)} /><DetailItem label="Screw Length" value={detailValue(currentAsset.screwLength)} /><DetailItem label="Screw Rebuild / Repaired" value={detailValue(currentAsset.screwRebuildRepaired)} /><ConditionBadge label="Screw condition" status={screwCondition} /></>,
      edit: <><Text label="Screw Type" value={draft.screwType} set={v=>setDraftField('screwType',v)} disabled={!canEdit}/><DateWithAge label="Screw Installed Date" value={draft.screwInstalledDate} set={v=>setDraftField('screwInstalledDate',v)} disabled={!canEdit}/><UnitDimensionField label="Screw Length" value={draft.screwLength} set={v=>setDraftField('screwLength',v)} disabled={!canEdit}/><ComponentConditionEditor rebuildLabel="Screw Rebuild / Repaired" conditionLabel="Screw Condition" rebuild={draft.screwRebuildRepaired} condition={draft.screwConditionStatus} setRebuild={v=>setDraftField('screwRebuildRepaired',v)} setCondition={v=>setDraftField('screwConditionStatus',v)} disabled={!canEdit}/></>,
    },
    {
      key: 'screwTip',
      editableKey: 'screwTip',
      title: 'Screw Tip',
      summary: detailSummary(currentAsset.screwTipType || 'Type unknown', currentAsset.screwTipInstalledDate || 'Installed date unknown'),
      view: <><DetailItem label="Screw Tip Type" value={detailValue(currentAsset.screwTipType)} /><DetailItem label="Screw Tip Installed Date" value={detailValue(currentAsset.screwTipInstalledDate)} /></>,
      edit: <><Text label="Screw Tip Type" value={draft.screwTipType} set={v=>setDraftField('screwTipType',v)} disabled={!canEdit}/><DateWithAge label="Screw Tip Installed Date" value={draft.screwTipInstalledDate} set={v=>setDraftField('screwTipInstalledDate',v)} disabled={!canEdit}/></>,
    },
    {
      key: 'barrel',
      editableKey: 'barrel',
      title: 'Barrel',
      summary: detailSummary(conditionLabels[barrelCondition], currentAsset.barrelDiameter || 'Diameter unknown', currentAsset.barrelInstalledDate || 'Installed date unknown'),
      status: <DetailStatusPill status={barrelCondition} />,
      view: <><DetailItem label="Barrel Diameter" value={detailValue(currentAsset.barrelDiameter)} /><DetailItem label="Barrel Installed Date" value={detailValue(currentAsset.barrelInstalledDate)} /><DetailItem label="Barrel Length" value={detailValue(currentAsset.barrelLength)} /><DetailItem label="Barrel Rebuild / Repaired" value={detailValue(currentAsset.barrelRebuildRepaired)} /><ConditionBadge label="Barrel condition" status={barrelCondition} /></>,
      edit: <><Text label="Barrel Diameter" value={draft.barrelDiameter} set={v=>setDraftField('barrelDiameter',v)} disabled={!canEdit}/><DateWithAge label="Barrel Installed Date" value={draft.barrelInstalledDate} set={v=>setDraftField('barrelInstalledDate',v)} disabled={!canEdit}/><UnitDimensionField label="Barrel Length" value={draft.barrelLength} set={v=>setDraftField('barrelLength',v)} disabled={!canEdit}/><ComponentConditionEditor rebuildLabel="Barrel Rebuild / Repaired" conditionLabel="Barrel Condition" rebuild={draft.barrelRebuildRepaired} condition={draft.barrelConditionStatus} setRebuild={v=>setDraftField('barrelRebuildRepaired',v)} setCondition={v=>setDraftField('barrelConditionStatus',v)} disabled={!canEdit}/></>,
    },
    {
      key: 'barrelEndCap',
      editableKey: 'barrelEndCap',
      title: 'Barrel End Cap',
      summary: currentAsset.barrelEndCapInstalledDate || 'Installed date unknown',
      view: <DetailItem label="Barrel End Cap Installed Date" value={detailValue(currentAsset.barrelEndCapInstalledDate)} />,
      edit: <DateWithAge label="Barrel End Cap Installed Date" value={draft.barrelEndCapInstalledDate} set={v=>setDraftField('barrelEndCapInstalledDate',v)} disabled={!canEdit}/>,
    },
    ...(currentAsset.hasDoubleShotInjection ? [
      {
        key: 'screw2' as const,
        editableKey: 'screw2' as const,
        title: 'Injection Unit 2 Screw',
        summary: detailSummary(conditionLabels[screw2Condition], currentAsset.screw2Length || 'Length unknown', currentAsset.screw2InstalledDate || 'Installed date unknown'),
        status: <DetailStatusPill status={screw2Condition} />,
        view: <><DetailItem label="Screw 2 Type" value={detailValue(currentAsset.screw2Type)} /><DetailItem label="Screw 2 Installed Date" value={detailValue(currentAsset.screw2InstalledDate)} /><DetailItem label="Screw 2 Length" value={detailValue(currentAsset.screw2Length)} /><DetailItem label="Screw 2 Rebuild / Repaired" value={detailValue(currentAsset.screw2RebuildRepaired)} /><ConditionBadge label="Screw 2 condition" status={screw2Condition} /></>,
        edit: <><Text label="Screw 2 Type" value={draft.screw2Type} set={v=>setDraftField('screw2Type',v)} disabled={!canEdit}/><DateWithAge label="Screw 2 Installed Date" value={draft.screw2InstalledDate} set={v=>setDraftField('screw2InstalledDate',v)} disabled={!canEdit}/><UnitDimensionField label="Screw 2 Length" value={draft.screw2Length} set={v=>setDraftField('screw2Length',v)} disabled={!canEdit}/><ComponentConditionEditor rebuildLabel="Screw 2 Rebuild / Repaired" conditionLabel="Screw 2 Condition" rebuild={draft.screw2RebuildRepaired} condition={draft.screw2ConditionStatus} setRebuild={v=>setDraftField('screw2RebuildRepaired',v)} setCondition={v=>setDraftField('screw2ConditionStatus',v)} disabled={!canEdit}/></>,
      },
      {
        key: 'screw2Tip' as const,
        editableKey: 'screw2Tip' as const,
        title: 'Injection Unit 2 Screw Tip',
        summary: detailSummary(currentAsset.screw2TipType || 'Type unknown', currentAsset.screw2TipInstalledDate || 'Installed date unknown'),
        view: <><DetailItem label="Screw 2 Tip Type" value={detailValue(currentAsset.screw2TipType)} /><DetailItem label="Screw 2 Tip Installed Date" value={detailValue(currentAsset.screw2TipInstalledDate)} /></>,
        edit: <><Text label="Screw 2 Tip Type" value={draft.screw2TipType} set={v=>setDraftField('screw2TipType',v)} disabled={!canEdit}/><DateWithAge label="Screw 2 Tip Installed Date" value={draft.screw2TipInstalledDate} set={v=>setDraftField('screw2TipInstalledDate',v)} disabled={!canEdit}/></>,
      },
      {
        key: 'barrel2' as const,
        editableKey: 'barrel2' as const,
        title: 'Injection Unit 2 Barrel',
        summary: detailSummary(conditionLabels[barrel2Condition], currentAsset.barrel2Diameter || 'Diameter unknown', currentAsset.barrel2InstalledDate || 'Installed date unknown'),
        status: <DetailStatusPill status={barrel2Condition} />,
        view: <><DetailItem label="Barrel 2 Diameter" value={detailValue(currentAsset.barrel2Diameter)} /><DetailItem label="Barrel 2 Installed Date" value={detailValue(currentAsset.barrel2InstalledDate)} /><DetailItem label="Barrel 2 Length" value={detailValue(currentAsset.barrel2Length)} /><DetailItem label="Barrel 2 Rebuild / Repaired" value={detailValue(currentAsset.barrel2RebuildRepaired)} /><ConditionBadge label="Barrel 2 condition" status={barrel2Condition} /></>,
        edit: <><Text label="Barrel 2 Diameter" value={draft.barrel2Diameter} set={v=>setDraftField('barrel2Diameter',v)} disabled={!canEdit}/><DateWithAge label="Barrel 2 Installed Date" value={draft.barrel2InstalledDate} set={v=>setDraftField('barrel2InstalledDate',v)} disabled={!canEdit}/><UnitDimensionField label="Barrel 2 Length" value={draft.barrel2Length} set={v=>setDraftField('barrel2Length',v)} disabled={!canEdit}/><ComponentConditionEditor rebuildLabel="Barrel 2 Rebuild / Repaired" conditionLabel="Barrel 2 Condition" rebuild={draft.barrel2RebuildRepaired} condition={draft.barrel2ConditionStatus} setRebuild={v=>setDraftField('barrel2RebuildRepaired',v)} setCondition={v=>setDraftField('barrel2ConditionStatus',v)} disabled={!canEdit}/></>,
      },
      {
        key: 'barrel2EndCap' as const,
        editableKey: 'barrel2EndCap' as const,
        title: 'Injection Unit 2 Barrel End Cap',
        summary: currentAsset.barrel2EndCapInstalledDate || 'Installed date unknown',
        view: <DetailItem label="Barrel 2 End Cap Installed Date" value={detailValue(currentAsset.barrel2EndCapInstalledDate)} />,
        edit: <DateWithAge label="Barrel 2 End Cap Installed Date" value={draft.barrel2EndCapInstalledDate} set={v=>setDraftField('barrel2EndCapInstalledDate',v)} disabled={!canEdit}/>,
      },
    ] : []),
    ...(currentAsset.hasPlungerInjection ? [
      {
        key: 'plunger' as const,
        editableKey: 'plunger' as const,
        title: 'Plunger',
        summary: detailSummary(conditionLabels[plungerCondition], currentAsset.plungerDiameter || 'Diameter unknown', currentAsset.plungerInstalledDate || 'Installed date unknown'),
        status: <DetailStatusPill status={plungerCondition} />,
        view: <><DetailItem label="Plunger Type" value={detailValue(currentAsset.plungerType)} /><DetailItem label="Plunger Installed Date" value={detailValue(currentAsset.plungerInstalledDate)} /><DetailItem label="Plunger Length" value={detailValue(currentAsset.plungerLength)} /><DetailItem label="Plunger Diameter" value={detailValue(currentAsset.plungerDiameter)} /><DetailItem label="Plunger Rebuild / Repaired" value={detailValue(currentAsset.plungerRebuildRepaired)} /><ConditionBadge label="Plunger condition" status={plungerCondition} /></>,
        edit: <><Text label="Plunger Type" value={draft.plungerType} set={v=>setDraftField('plungerType',v)} disabled={!canEdit}/><DateWithAge label="Plunger Installed Date" value={draft.plungerInstalledDate} set={v=>setDraftField('plungerInstalledDate',v)} disabled={!canEdit}/><UnitDimensionField label="Plunger Length" value={draft.plungerLength} set={v=>setDraftField('plungerLength',v)} disabled={!canEdit}/><UnitDimensionField label="Plunger Diameter" value={draft.plungerDiameter} set={v=>setDraftField('plungerDiameter',v)} disabled={!canEdit}/><ComponentConditionEditor rebuildLabel="Plunger Rebuild / Repaired" conditionLabel="Plunger Condition" rebuild={draft.plungerRebuildRepaired} condition={draft.plungerConditionStatus} setRebuild={v=>setDraftField('plungerRebuildRepaired',v)} setCondition={v=>setDraftField('plungerConditionStatus',v)} disabled={!canEdit}/></>,
      },
      {
        key: 'plungerBarrel' as const,
        editableKey: 'plungerBarrel' as const,
        title: 'Plunger Barrel / Cylinder Barrel',
        summary: detailSummary(conditionLabels[plungerBarrelCondition], currentAsset.plungerBarrelDiameter || 'Diameter unknown', currentAsset.plungerBarrelInstalledDate || 'Installed date unknown'),
        status: <DetailStatusPill status={plungerBarrelCondition} />,
        view: <><DetailItem label="Plunger Barrel Type" value={detailValue(currentAsset.plungerBarrelType)} /><DetailItem label="Plunger Barrel Installed Date" value={detailValue(currentAsset.plungerBarrelInstalledDate)} /><DetailItem label="Plunger Barrel Length" value={detailValue(currentAsset.plungerBarrelLength)} /><DetailItem label="Plunger Barrel Diameter" value={detailValue(currentAsset.plungerBarrelDiameter)} /><DetailItem label="Plunger Barrel Rebuild / Repaired" value={detailValue(currentAsset.plungerBarrelRebuildRepaired)} /><ConditionBadge label="Plunger Barrel condition" status={plungerBarrelCondition} /></>,
        edit: <><Text label="Plunger Barrel Type" value={draft.plungerBarrelType} set={v=>setDraftField('plungerBarrelType',v)} disabled={!canEdit}/><DateWithAge label="Plunger Barrel Installed Date" value={draft.plungerBarrelInstalledDate} set={v=>setDraftField('plungerBarrelInstalledDate',v)} disabled={!canEdit}/><UnitDimensionField label="Plunger Barrel Length" value={draft.plungerBarrelLength} set={v=>setDraftField('plungerBarrelLength',v)} disabled={!canEdit}/><UnitDimensionField label="Plunger Barrel Diameter" value={draft.plungerBarrelDiameter} set={v=>setDraftField('plungerBarrelDiameter',v)} disabled={!canEdit}/><ComponentConditionEditor rebuildLabel="Plunger Barrel Rebuild / Repaired" conditionLabel="Plunger Barrel Condition" rebuild={draft.plungerBarrelRebuildRepaired} condition={draft.plungerBarrelConditionStatus} setRebuild={v=>setDraftField('plungerBarrelRebuildRepaired',v)} setCondition={v=>setDraftField('plungerBarrelConditionStatus',v)} disabled={!canEdit}/></>,
      },
      {
        key: 'plungerBarrelEndCap' as const,
        editableKey: 'plungerBarrelEndCap' as const,
        title: 'Plunger Barrel End Cap',
        summary: currentAsset.plungerBarrelEndCapInstalledDate || 'Installed date unknown',
        view: <DetailItem label="Plunger Barrel End Cap Installed Date" value={detailValue(currentAsset.plungerBarrelEndCapInstalledDate)} />,
        edit: <DateWithAge label="Plunger Barrel End Cap Installed Date" value={draft.plungerBarrelEndCapInstalledDate} set={v=>setDraftField('plungerBarrelEndCapInstalledDate',v)} disabled={!canEdit}/>,
      },
    ] : []),
    {
      key: 'notes',
      editableKey: 'notes',
      title: 'Notes / Critical Notes',
      summary: detailSummary(currentAsset.criticalNotes ? 'Critical notes set' : 'No critical notes', currentAsset.notes ? 'Notes set' : 'No notes'),
      status: currentAsset.criticalNotes ? <span className="machine-section-alert-pill">Critical</span> : undefined,
      view: <><DetailItem label="Notes" value={detailValue(currentAsset.notes)} tone="note" /><DetailItem label="Critical Notes" value={detailValue(currentAsset.criticalNotes)} tone="critical" /></>,
      edit: <><Area tone="note" label="Notes" value={draft.notes} set={v=>setDraftField('notes',v)} disabled={!canEdit}/><Area tone="critical" label="Critical Notes" value={draft.criticalNotes} set={v=>setDraftField('criticalNotes',v)} disabled={!canEdit}/></>,
    },
  ];

  return <div className="modal-backdrop" role="dialog" aria-modal="true"><section className="mcc-card machine-modal machine-detail-modal">
    <div className="modal-heading machine-detail-heading"><div><p className="eyebrow">Machine Asset Detail</p><h3>{currentAsset.assetNumber}</h3><p className="machine-detail-identity-badge" style={{'--machine-detail-brand-color':safeCssHex(currentAsset.brandColorHex)} as CSSProperties}><span className="machine-detail-brand-dot" aria-hidden="true" /><span>{currentAsset.brand || 'Brand unknown'}</span><span>Model {currentAsset.model || '-'}</span><span>S/N {currentAsset.serialNumber || '-'}</span></p></div><div className="machine-detail-header-actions"><button className="secondary-button compact-button" type="button" onClick={onLogs}>Logs</button><button className="primary-button compact-button" type="button" onClick={onEdit}>{canEdit ? 'Edit Mode' : 'View Form'}</button><button className="link-button compact-button" type="button" onClick={onClose}>Close</button></div></div>
    <div className="machine-detail-summary-grid">
      <SummaryBadge label="Status" value={machineStatusLabel(currentAsset.status)} tone={machineSummaryStatusClass(currentAsset.status)} />
      <SummaryBadge label="Setup" value={unitLabel} tone={machineSummarySetupClass(currentAsset)} />
      <SummaryBadge label="Year / Age" value={`${currentAsset.machineYear || '-'} / ${machineYearAge(currentAsset.machineYear)}`} tone={machineSummaryKnownClass(currentAsset.machineYear,'year-age')} />
      <SummaryBadge label="Location" value={detailValue(currentAsset.location)} tone={machineSummaryKnownClass(currentAsset.location,'location')} />
    </div>
    <MeasurementInspectionLaunchPanel target={inspectionContext(currentAsset)} records={measurementRecords} onOpen={onInspection} />
    <div className="machine-detail-accordion-list">
      {sections.map(section=>{
        const editableKey = section.editableKey;
        const isEditing = Boolean(editableKey && editingSection === editableKey);
        const isOpen = isEditing || openSection === section.key;
        const actionLabel = section.actionLabel ?? (editableKey && canEdit ? 'Edit' : undefined);
        const onAction = section.onAction ?? (editableKey ? ()=>beginSectionEdit(editableKey) : undefined);
        return <MachineDetailAccordionSection key={section.key} sectionKey={section.key} title={section.title} summary={section.summary} status={section.status} expanded={isOpen} editing={isEditing} actionLabel={actionLabel} onAction={onAction} onToggle={()=>toggleOpenSection(section.key)} onSave={editableKey ? ()=>void saveSection(editableKey) : undefined} onCancel={editableKey ? cancelSectionEdit : undefined} saving={Boolean(editableKey && savingSection === editableKey)} error={editableKey ? sectionErrors[editableKey] : undefined}>{isEditing ? section.edit : section.view}</MachineDetailAccordionSection>;
      })}
    </div>
    <div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Close</button><button className="primary-button" type="button" onClick={onEdit}>{canEdit ? 'Edit Mode' : 'View Form'}</button></div>
  </section></div>;
}
function MachineDetailAccordionSection({sectionKey,title,summary,status,expanded,editing,actionLabel,onAction,onToggle,onSave,onCancel,saving,error,children}:{sectionKey:MachineDetailSectionKey;title:string;summary:string;status?:ReactNode;expanded:boolean;editing:boolean;actionLabel?:string;onAction?:()=>void;onToggle:()=>void;onSave?:()=>void;onCancel?:()=>void;saving:boolean;error?:string;children:ReactNode}) {
  const panelId = `machine-detail-panel-${sectionKey}`;
  return <article className={`machine-detail-accordion-card ${expanded ? 'is-open' : ''} ${editing ? 'is-editing' : ''}`}>
    <div className="machine-detail-accordion-header">
      <button className="machine-detail-accordion-toggle" type="button" aria-expanded={expanded} aria-controls={panelId} onClick={onToggle}>
        <span className="machine-detail-section-title">{title}</span>
        <span className="machine-detail-section-summary">{summary}</span>
        {status}
        <span className="machine-accordion-chevron" aria-hidden="true">v</span>
      </button>
      <div className="machine-detail-section-actions">
        {editing&&<><button className="primary-button compact-button" type="button" onClick={onSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button><button className="secondary-button compact-button" type="button" onClick={onCancel} disabled={saving}>Cancel</button></>}
        {!editing&&actionLabel&&onAction&&<button className="secondary-button compact-button" type="button" onClick={onAction}>{actionLabel}</button>}
      </div>
    </div>
    <div className="machine-detail-accordion-panel" id={panelId} aria-hidden={!expanded}>
      <div className={editing ? 'machine-detail-grid machine-detail-edit-grid' : 'machine-detail-grid'}>{children}</div>
      {error&&<p className="form-message error machine-section-error">{error}</p>}
    </div>
  </article>;
}
function DetailStatusPill({status}:{status:ConditionStatus}) { return <span className={`machine-section-status-pill condition-${status}`}>{conditionLabels[status]}</span>; }
function SummaryBadge({label,value,tone}:{label:string;value:ReactNode;tone:string}) { return <div className="machine-detail-summary-card"><span className="machine-detail-summary-label">{label}</span><strong className={`machine-detail-summary-pill ${tone}`}>{value}</strong></div>; }
function DetailItem({label,value,tone}:{label:string;value:ReactNode;tone?:'note'|'critical'}) { return <div className={`machine-detail-pill ${tone === 'critical' ? 'machine-critical-text' : tone === 'note' ? 'machine-note-text' : ''}`}><span className="machine-detail-pill-label">{label}</span><strong className="machine-detail-pill-value">{value}</strong></div>; }
function MeasurementInspectionLaunchPanel({target,records,onOpen}:{target:InspectionContext;records:MeasurementInspectionRecordMap;onOpen:(componentType:MeasurementComponentType)=>void}) {
  return <section className="machine-measurement-panel">
    <div className="machine-measurement-panel-heading"><div><p className="eyebrow">Measurement Inspection</p><h4>Measurement Inspection</h4></div><span className="machine-measurement-setup-pill">{injectionSetupLabel(target) || 'Standard Injection'}</span></div>
    <div className="machine-inspection-card-grid">
      {measurementComponentCards(target).map(card=>{
        const record = records[measurementRecordKey(target,card.type)];
        const status = record?.status === 'completed' ? `Completed ${record.dateMeasured || ''}` : record ? 'Draft in progress' : 'No inspection yet';
        return <article className="machine-inspection-card" key={card.type}>
          <span>{card.badge}</span>
          <strong>{card.title}</strong>
          <small>{card.description}</small>
          <em>{status}</em>
          <button className="secondary-button compact-button" type="button" onClick={()=>onOpen(card.type)}>{record ? 'Open Inspection' : 'Start Inspection'}</button>
        </article>;
      })}
    </div>
  </section>;
}
function MeasurementInspectionModal({target,initialComponentType,records,setRecords,userFullName,onClose}:{target:InspectionContext;initialComponentType:MeasurementComponentType;records:MeasurementInspectionRecordMap;setRecords:Dispatch<SetStateAction<MeasurementInspectionRecordMap>>;userFullName:string;onClose:()=>void}) {
  const [activeComponent,setActiveComponent]=useState<MeasurementComponentType>(initialComponentType);
  const [validationMessage,setValidationMessage]=useState('');
  const [confirmingComplete,setConfirmingComplete]=useState(false);
  const [isGeneratingPdf,setIsGeneratingPdf]=useState(false);
  const [pdfMessage,setPdfMessage]=useState('');
  const cards = measurementComponentCards(target);
  const activeKey = measurementRecordKey(target,activeComponent);
  const record = records[activeKey] ?? defaultMeasurementRecord(target,activeComponent,userFullName);
  useEffect(()=>{ setRecords(current=>ensureMeasurementRecord(current,target,activeComponent,userFullName)); },[activeComponent,target.assetNumber,target.id,userFullName,setRecords]);
  function updateRecord(updater:(record:MeasurementInspectionRecord)=>MeasurementInspectionRecord) {
    setRecords(current=>{
      const base = current[activeKey] ?? record;
      return { ...current, [activeKey]: updater(base) };
    });
  }
  function updateTextField(key:string,value:string) { updateRecord(current=>({...current,textFields:{...current.textFields,[key]:value},status:current.status==='completed'?'draft':current.status})); }
  function updateMeasurement(key:string,value:MeasurementValue) { updateRecord(current=>({...current,measurements:{...current.measurements,[key]:value},status:current.status==='completed'?'draft':current.status})); }
  function updateSelectField(key:string,value:string) { updateRecord(current=>({...current,selectFields:{...current.selectFields,[key]:value},status:current.status==='completed'?'draft':current.status})); }
  function updateStation(stationId:string,patch:Partial<MeasurementStation>) { updateRecord(current=>({...current,stations:current.stations.map(station=>station.id===stationId?{...station,...patch}:station),status:current.status==='completed'?'draft':current.status})); }
  function addStation() { updateRecord(current=>({...current,stations:[...current.stations,{id:`manual-${Date.now()}-${Math.random().toString(16).slice(2)}`,distance:measurementValueFromRaw(''),insideDiameter:measurementValueFromRaw(''),notes:''}]})); }
  function removeStation(stationId:string) { updateRecord(current=>({...current,stations:current.stations.filter(station=>station.id!==stationId)})); }
  function generateStations() {
    const lengthKey = record.componentType === 'plunger' ? 'cylinderBarrelLength' : 'barrelLength';
    const interval = record.stationInterval === 'custom' ? record.customStationInterval : measurementValueFromRaw(`${record.stationInterval}in`);
    updateRecord(current=>({...current,stations:stationRowsFromLength(current.measurements[lengthKey] ?? measurementValueFromRaw(''),interval)}));
  }
  function requestComplete() {
    if (!record.inspectorName.trim()) { setValidationMessage('Inspector Name is required to complete this inspection.'); return; }
    if (!record.dateMeasured.trim()) { setValidationMessage('Date Measured is required to complete this inspection.'); return; }
    setValidationMessage('');
    setConfirmingComplete(true);
  }
  function completeRecord() {
    updateRecord(current=>({...current,status:'completed'}));
    setConfirmingComplete(false);
  }
  async function downloadMeasurementPdf(mode:'filled'|'blank') {
    setPdfMessage('');
    setIsGeneratingPdf(true);
    try {
      const snapshot = { ...records, [activeKey]: record };
      const payload = { mode, target, components: cards.map(card=>card.type), records: mode === 'blank' ? [] : targetMeasurementRecords(snapshot,target) };
      const res = await fetch('/api/machine-library/measurement-inspection/pdf',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      if (!res.ok) {
        const data = await res.json().catch(async()=>({ error: await res.text().catch(()=>`HTTP ${res.status}`) }));
        throw new Error(data.error || `Measurement PDF generation failed with HTTP ${res.status}.`);
      }
      const blob = await res.blob();
      const fileName = downloadFileName(res.headers.get('Content-Disposition')) || `MCC_Measurement_Inspection_${target.assetNumber.replace(/\W+/g,'_')}_${mode}.pdf`;
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setPdfMessage(mode === 'blank' ? 'Blank measurement PDF generated.' : 'Filled measurement PDF generated.');
    } catch (error) {
      console.error('Measurement PDF generation failed', error);
      setPdfMessage('Measurement PDF generation failed. Check console for details.');
    } finally {
      setIsGeneratingPdf(false);
    }
  }
  return createPortal(<div className="modal-backdrop measurement-modal-backdrop" role="dialog" aria-modal="true">
    <section className="mcc-card measurement-inspection-modal">
      <div className="modal-heading measurement-modal-heading"><div><p className="eyebrow">Measurement Inspection Alpha</p><h3>{measurementComponentLabels[activeComponent]} Inspection</h3><p>{target.assetNumber}</p></div><button className="link-button compact-button" type="button" onClick={onClose}>Close</button></div>
      <div className="measurement-machine-badge-grid">
        <DetailItem label="Press #" value={detailValue(target.assetNumber)} />
        <DetailItem label="Brand" value={detailValue(target.brand)} />
        <DetailItem label="Model" value={detailValue(target.model)} />
        <DetailItem label="Serial #" value={detailValue(target.serialNumber)} />
        <DetailItem label="Machine Year / Age" value={`${target.machineYear || '-'} / ${machineYearAge(target.machineYear)}`} />
        <DetailItem label="Injection Setup" value={injectionSetupLabel(target) || 'Standard Injection'} />
      </div>
      <div className="measurement-component-tabs">{cards.map(card=><button className={card.type===activeComponent?'measurement-component-tab active':'measurement-component-tab'} type="button" key={card.type} onClick={()=>{ setActiveComponent(card.type); setValidationMessage(''); setConfirmingComplete(false); }}><span>{card.badge}</span><strong>{card.title}</strong></button>)}</div>
      <div className="measurement-form-shell">
        <section className="measurement-form-section measurement-general-section">
          <div className="measurement-section-heading"><h4>{measurementComponentLabels[activeComponent]}</h4><span className={`measurement-status-pill status-${record.status}`}>{record.status === 'completed' ? 'Completed' : 'Draft'}</span></div>
          <div className="measurement-general-grid">
            <PillSelector label="OLD / NEW" value={record.oldNew} options={measurementOldNewLabels} set={value=>updateRecord(current=>({...current,oldNew:value,status:current.status==='completed'?'draft':current.status}))} />
            <MeasurementDateField label="Date Measured *" value={record.dateMeasured} set={value=>updateRecord(current=>({...current,dateMeasured:value,status:current.status==='completed'?'draft':current.status}))} />
            <MeasurementDateField label="Date Installed" value={record.dateInstalled} set={value=>updateRecord(current=>({...current,dateInstalled:value,status:current.status==='completed'?'draft':current.status}))} />
            <Text label="Inspector Name *" value={record.inspectorName} set={value=>updateRecord(current=>({...current,inspectorName:value,status:current.status==='completed'?'draft':current.status}))} disabled={false}/>
            <Area label="Comments" value={record.comments} set={value=>updateRecord(current=>({...current,comments:value,status:current.status==='completed'?'draft':current.status}))} disabled={false}/>
          </div>
        </section>
        <MeasurementComponentForm record={record} onText={updateTextField} onMeasurement={updateMeasurement} onSelect={updateSelectField} onRecord={updateRecord} onStation={updateStation} onAddStation={addStation} onRemoveStation={removeStation} onGenerateStations={generateStations} />
      </div>
      {(validationMessage||pdfMessage)&&<p className={validationMessage||/failed|required|error/i.test(pdfMessage)?'form-message error':'form-message'}>{validationMessage || pdfMessage}</p>}
      <div className="modal-actions measurement-modal-actions">
        <button className="secondary-button" type="button" onClick={()=>void downloadMeasurementPdf('blank')} disabled={isGeneratingPdf}>Generate Blank Measurement PDF</button>
        <button className="secondary-button" type="button" onClick={()=>void downloadMeasurementPdf('filled')} disabled={isGeneratingPdf}>{isGeneratingPdf ? 'Generating PDF...' : 'Generate Filled Measurement PDF'}</button>
        <button className="primary-button" type="button" onClick={requestComplete}>Complete Inspection</button>
      </div>
      {confirmingComplete&&<div className="measurement-confirm-backdrop" role="dialog" aria-modal="true"><section className="mcc-card measurement-confirm-modal"><h4>Complete measurement inspection for {target.assetNumber}?</h4><p>{measurementComponentLabels[activeComponent]} will be marked completed for this alpha session.</p><div className="modal-actions"><button className="secondary-button" type="button" onClick={()=>setConfirmingComplete(false)}>Cancel</button><button className="primary-button" type="button" onClick={completeRecord}>Complete Inspection</button></div></section></div>}
    </section>
  </div>, document.body);
}
function downloadFileName(disposition: string | null) {
  const match = disposition?.match(/filename="([^"]+)"/i);
  return match?.[1] ?? '';
}
function MeasurementComponentForm({record,onText,onMeasurement,onSelect,onRecord,onStation,onAddStation,onRemoveStation,onGenerateStations}:{record:MeasurementInspectionRecord;onText:(key:string,value:string)=>void;onMeasurement:(key:string,value:MeasurementValue)=>void;onSelect:(key:string,value:string)=>void;onRecord:(updater:(record:MeasurementInspectionRecord)=>MeasurementInspectionRecord)=>void;onStation:(stationId:string,patch:Partial<MeasurementStation>)=>void;onAddStation:()=>void;onRemoveStation:(stationId:string)=>void;onGenerateStations:()=>void}) {
  if (record.componentType === 'screw' || record.componentType === 'screw_2') return <ScrewInspectionForm record={record} onText={onText} onMeasurement={onMeasurement} onSelect={onSelect} onRecord={onRecord} />;
  if (record.componentType === 'barrel' || record.componentType === 'barrel_2') return <BarrelInspectionForm record={record} onText={onText} onMeasurement={onMeasurement} onStation={onStation} onAddStation={onAddStation} onRemoveStation={onRemoveStation} onGenerateStations={onGenerateStations} onRecord={onRecord} />;
  if (record.componentType === 'tip' || record.componentType === 'tip_2') return <TipInspectionForm record={record} onText={onText} onMeasurement={onMeasurement} onSelect={onSelect} />;
  return <PlungerInspectionForm record={record} onText={onText} onMeasurement={onMeasurement} onStation={onStation} onAddStation={onAddStation} onRemoveStation={onRemoveStation} onGenerateStations={onGenerateStations} />;
}
function ScrewInspectionForm({record,onText,onMeasurement,onSelect,onRecord}:{record:MeasurementInspectionRecord;onText:(key:string,value:string)=>void;onMeasurement:(key:string,value:MeasurementValue)=>void;onSelect:(key:string,value:string)=>void;onRecord:(updater:(record:MeasurementInspectionRecord)=>MeasurementInspectionRecord)=>void}) {
  function addReading(kind: ScrewMeasurementKind, section: ScrewSectionKey) {
    onRecord(current=>{
      const readings = screwReadingsForRecord(current);
      const currentSection = readings[kind][section] ?? [];
      return {
        ...current,
        status: current.status === 'completed' ? 'draft' : current.status,
        screwReadings: {
          ...readings,
          [kind]: {
            ...readings[kind],
            [section]: [...currentSection, createScrewReading(kind, section, currentSection.length + 1)],
          },
        },
      };
    });
  }
  function updateReading(kind: ScrewMeasurementKind, section: ScrewSectionKey, readingId: string, patch: Partial<ScrewMeasurementReading>) {
    onRecord(current=>{
      const readings = screwReadingsForRecord(current);
      return {
        ...current,
        status: current.status === 'completed' ? 'draft' : current.status,
        screwReadings: {
          ...readings,
          [kind]: {
            ...readings[kind],
            [section]: (readings[kind][section] ?? []).map(reading=>reading.id===readingId ? {...reading,...patch} : reading),
          },
        },
      };
    });
  }
  function removeReading(kind: ScrewMeasurementKind, section: ScrewSectionKey, readingId: string) {
    onRecord(current=>{
      const readings = screwReadingsForRecord(current);
      return {
        ...current,
        screwReadings: {
          ...readings,
          [kind]: {
            ...readings[kind],
            [section]: (readings[kind][section] ?? []).filter(reading=>reading.id!==readingId),
          },
        },
      };
    });
  }
  return <section className="measurement-form-section screw-inspection-form">
    <MeasurementSectionHeading title="Reason for Pull" />
    <div className="measurement-reason-grid">{measurementReasons.map(reason=><label className="machine-check-field" key={reason}><input type="checkbox" checked={Boolean(record.reasonForPull[reason])} onChange={event=>onRecord(current=>({...current,reasonForPull:{...current.reasonForPull,[reason]:event.target.checked},status:current.status==='completed'?'draft':current.status}))} /><span>{reason}</span></label>)}</div>
    {record.reasonForPull.Other&&<Text label="Other Reason" value={record.reasonForPullOther} set={value=>onRecord(current=>({...current,reasonForPullOther:value,status:current.status==='completed'?'draft':current.status}))} disabled={false}/>}
    <MeasurementSectionHeading title="Screw Identity" />
    <FieldGrid>{screwIdentityFields.map(([key,label])=><Text key={key} label={label} value={record.textFields[key] ?? ''} set={value=>onText(key,value)} disabled={false}/>)}</FieldGrid>
    <MeasurementSectionHeading title="Screw Measurements" />
    <MeasurementFieldGrid>{screwMeasurementFields.map(([key,label])=><MeasurementInput key={key} label={label} value={record.measurements[key] ?? measurementValueFromRaw('')} set={value=>onMeasurement(key,value)} />)}</MeasurementFieldGrid>
    <ScrewMeasurementMap onAddReading={addReading} />
    <ScrewSmallestSummary record={record} />
    <ScrewMeasurementAreas record={record} onAddReading={addReading} onUpdateReading={updateReading} onRemoveReading={removeReading} />
    <MeasurementSectionHeading title="Spline Check" />
    <FieldGrid><Select label="Spline Check" value={record.selectFields.splineCheck ?? ''} set={value=>onSelect('splineCheck',value)} options={['','Good','Worn','Damaged']} disabled={false}/><Area label="Spline Notes" value={record.textFields.splineNotes ?? ''} set={value=>onText('splineNotes',value)} disabled={false}/><Area label="Screw Comments" value={record.textFields.screwComments ?? ''} set={value=>onText('screwComments',value)} disabled={false}/></FieldGrid>
  </section>;
}
function ScrewSmallestSummary({record}:{record:MeasurementInspectionRecord}) {
  const readings = screwReadingsForRecord(record);
  return <section className="screw-smallest-summary">
    {screwMeasurementKinds.map(kind=><div className={`screw-smallest-group ${kind.accent}`} key={kind.key}><strong>{kind.label} Smallest Dia</strong><div>{screwSections.map(section=>{ const smallest = smallestScrewReading(readings[kind.key][section.key] ?? []); return <span key={section.key}><em>{section.shortLabel}</em>{measurementValueDisplay(smallest)}</span>; })}</div></div>)}
  </section>;
}
function ScrewMeasurementAreas({record,onAddReading,onUpdateReading,onRemoveReading}:{record:MeasurementInspectionRecord;onAddReading:(kind:ScrewMeasurementKind,section:ScrewSectionKey)=>void;onUpdateReading:(kind:ScrewMeasurementKind,section:ScrewSectionKey,readingId:string,patch:Partial<ScrewMeasurementReading>)=>void;onRemoveReading:(kind:ScrewMeasurementKind,section:ScrewSectionKey,readingId:string)=>void}) {
  const readings = screwReadingsForRecord(record);
  return <div className="screw-measurement-area-grid">
    {screwMeasurementKinds.map(kind=><section className={`screw-measurement-area ${kind.accent}`} key={kind.key}>
      <MeasurementSectionHeading title={kind.label} />
      <div className="screw-section-grid">
        {screwSections.map(section=><ScrewMeasurementSectionCard kind={kind.key} section={section.key} title={section.label} readings={readings[kind.key][section.key] ?? []} key={section.key} onAddReading={onAddReading} onUpdateReading={onUpdateReading} onRemoveReading={onRemoveReading} />)}
      </div>
    </section>)}
  </div>;
}
function ScrewMeasurementSectionCard({kind,section,title,readings,onAddReading,onUpdateReading,onRemoveReading}:{kind:ScrewMeasurementKind;section:ScrewSectionKey;title:string;readings:ScrewMeasurementReading[];onAddReading:(kind:ScrewMeasurementKind,section:ScrewSectionKey)=>void;onUpdateReading:(kind:ScrewMeasurementKind,section:ScrewSectionKey,readingId:string,patch:Partial<ScrewMeasurementReading>)=>void;onRemoveReading:(kind:ScrewMeasurementKind,section:ScrewSectionKey,readingId:string)=>void}) {
  const smallest = smallestScrewReading(readings);
  return <article className="screw-section-card">
    <div className="screw-section-card-heading"><strong>{title}</strong><span>{measurementValueDisplay(smallest)}</span></div>
    <button className="secondary-button compact-button" type="button" onClick={()=>onAddReading(kind,section)}>Add Reading</button>
    <div className="screw-reading-list">
      {readings.map((reading,index)=><div className="screw-reading-row" key={reading.id}><label className="form-field"><span>Reading label</span><input value={reading.label} onChange={event=>onUpdateReading(kind,section,reading.id,{label:event.target.value})} /></label><MeasurementInput label={`Point ${index + 1}`} value={reading.value} set={value=>onUpdateReading(kind,section,reading.id,{value})} /><label className="form-field"><span>Note</span><input value={reading.notes} onChange={event=>onUpdateReading(kind,section,reading.id,{notes:event.target.value})} /></label><button className="link-button compact-button" type="button" onClick={()=>onRemoveReading(kind,section,reading.id)}>Remove</button></div>)}
      {!readings.length&&<p className="form-help">No readings yet.</p>}
    </div>
  </article>;
}
function BarrelInspectionForm({record,onText,onMeasurement,onStation,onAddStation,onRemoveStation,onGenerateStations,onRecord}:{record:MeasurementInspectionRecord;onText:(key:string,value:string)=>void;onMeasurement:(key:string,value:MeasurementValue)=>void;onStation:(stationId:string,patch:Partial<MeasurementStation>)=>void;onAddStation:()=>void;onRemoveStation:(stationId:string)=>void;onGenerateStations:()=>void;onRecord:(updater:(record:MeasurementInspectionRecord)=>MeasurementInspectionRecord)=>void}) {
  return <section className="measurement-form-section"><MeasurementSectionHeading title="Barrel Identity" /><FieldGrid>{barrelIdentityFields.map(([key,label])=><Text key={key} label={label} value={record.textFields[key] ?? ''} set={value=>onText(key,value)} disabled={false}/>)}</FieldGrid><MeasurementSectionHeading title="Barrel Measurements" /><MeasurementFieldGrid>{barrelMeasurementFields.map(([key,label])=><MeasurementInput key={key} label={label} value={record.measurements[key] ?? measurementValueFromRaw('')} set={value=>onMeasurement(key,value)} />)}</MeasurementFieldGrid><StationControls record={record} onRecord={onRecord} onGenerateStations={onGenerateStations} onAddStation={onAddStation} /><StationTable stations={record.stations} distanceLabel="Station distance from feed throat/front" measurementLabel="Inside Diameter measurement" onStation={onStation} onRemove={onRemoveStation} /><FieldGrid><Area label="Barrel Notes" value={record.textFields.barrelNotes ?? ''} set={value=>onText('barrelNotes',value)} disabled={false}/><Area label="Barrel Comments" value={record.textFields.barrelComments ?? ''} set={value=>onText('barrelComments',value)} disabled={false}/></FieldGrid></section>;
}
function TipInspectionForm({record,onText,onMeasurement,onSelect}:{record:MeasurementInspectionRecord;onText:(key:string,value:string)=>void;onMeasurement:(key:string,value:MeasurementValue)=>void;onSelect:(key:string,value:string)=>void}) {
  return <section className="measurement-form-section"><MeasurementSectionHeading title="Tip Identity" /><FieldGrid>{tipIdentityFields.map(([key,label])=><Text key={key} label={label} value={record.textFields[key] ?? ''} set={value=>onText(key,value)} disabled={false}/>)}</FieldGrid><MeasurementSectionHeading title="Tip Thread Inspection" /><FieldGrid><Select label="Tip Thread Check" value={record.selectFields.tipThreadInspection ?? ''} set={value=>onSelect('tipThreadInspection',value)} options={['','Good','Worn','Damaged']} disabled={false}/><Area label="Tip Thread Notes" value={record.textFields.tipThreadNotes ?? ''} set={value=>onText('tipThreadNotes',value)} disabled={false}/></FieldGrid><MeasurementSectionHeading title="Tip Measurements" /><MeasurementFieldGrid>{tipMeasurementFields.map(([key,label])=><MeasurementInput key={key} label={label} value={record.measurements[key] ?? measurementValueFromRaw('')} set={value=>onMeasurement(key,value)} />)}</MeasurementFieldGrid><Area label="Tip Comments" value={record.textFields.tipComments ?? ''} set={value=>onText('tipComments',value)} disabled={false}/></section>;
}
function PlungerInspectionForm({record,onText,onMeasurement,onStation,onAddStation,onRemoveStation,onGenerateStations}:{record:MeasurementInspectionRecord;onText:(key:string,value:string)=>void;onMeasurement:(key:string,value:MeasurementValue)=>void;onStation:(stationId:string,patch:Partial<MeasurementStation>)=>void;onAddStation:()=>void;onRemoveStation:(stationId:string)=>void;onGenerateStations:()=>void}) {
  return <section className="measurement-form-section"><MeasurementSectionHeading title="Plunger" /><FieldGrid>{plungerTextFields.map(([key,label])=><Text key={key} label={label} value={record.textFields[key] ?? ''} set={value=>onText(key,value)} disabled={false}/>)}</FieldGrid><MeasurementSectionHeading title="Plunger Measurements" /><MeasurementFieldGrid>{plungerMeasurementFields.map(([key,label])=><MeasurementInput key={key} label={label} value={record.measurements[key] ?? measurementValueFromRaw('')} set={value=>onMeasurement(key,value)} />)}</MeasurementFieldGrid><MeasurementSectionHeading title="Plunger Barrel / Cylinder Barrel Stations" /><div className="measurement-station-actions"><button className="secondary-button compact-button" type="button" onClick={onGenerateStations}>Generate Cylinder Stations</button><button className="secondary-button compact-button" type="button" onClick={onAddStation}>Add Station</button></div><StationTable stations={record.stations} distanceLabel="Station distance" measurementLabel="Inside Diameter measurement" onStation={onStation} onRemove={onRemoveStation} /><FieldGrid><Area label="Plunger Notes" value={record.textFields.plungerNotes ?? ''} set={value=>onText('plungerNotes',value)} disabled={false}/><Area label="Plunger Comments" value={record.textFields.plungerComments ?? ''} set={value=>onText('plungerComments',value)} disabled={false}/><Area label="Cylinder Barrel Notes" value={record.textFields.cylinderBarrelNotes ?? ''} set={value=>onText('cylinderBarrelNotes',value)} disabled={false}/></FieldGrid></section>;
}
function MeasurementSectionHeading({title}:{title:string}) { return <div className="measurement-section-heading"><h4>{title}</h4></div>; }
function FieldGrid({children}:{children:ReactNode}) { return <div className="measurement-field-grid">{children}</div>; }
function MeasurementFieldGrid({children}:{children:ReactNode}) { return <div className="measurement-field-grid measurement-input-grid">{children}</div>; }
function PillSelector<T extends string>({label,value,options,set}:{label:string;value:T;options:Record<T,string>;set:(value:T)=>void}) {
  return <div className="form-field measurement-pill-selector"><span>{label}</span><div>{(Object.keys(options) as T[]).map(option=><button className={value===option?'active':''} key={option} type="button" onClick={()=>set(option)}>{options[option]}</button>)}</div></div>;
}
function MeasurementDateField({label,value,set}:{label:string;value:string;set:(value:string)=>void}) {
  return <label className="form-field"><span>{label}</span><input type="date" value={isoDateValue(value) ?? ''} onChange={event=>set(event.target.value)} /></label>;
}
function MeasurementInput({label,value,set}:{label:string;value:MeasurementValue;set:(value:MeasurementValue)=>void}) {
  const helper = measurementHelperText(value);
  return <label className="form-field measurement-input-field"><span>{label}</span><input value={value.rawInput} inputMode="decimal" placeholder="1.03, 100mm, 1.03in" onChange={event=>set(measurementValueFromRaw(event.target.value))} />{helper&&<small className={value.validationMessage?'measurement-helper error':'measurement-helper'}>{helper}</small>}</label>;
}
function StationControls({record,onRecord,onGenerateStations,onAddStation}:{record:MeasurementInspectionRecord;onRecord:(updater:(record:MeasurementInspectionRecord)=>MeasurementInspectionRecord)=>void;onGenerateStations:()=>void;onAddStation:()=>void}) {
  return <div className="measurement-station-control-grid"><label className="form-field"><span>Station Interval</span><select value={record.stationInterval} onChange={event=>onRecord(current=>({...current,stationInterval:event.target.value as MeasurementStationInterval}))}><option value="3">3 in</option><option value="6">6 in</option><option value="custom">Custom</option></select></label>{record.stationInterval === 'custom'&&<MeasurementInput label="Custom Interval" value={record.customStationInterval} set={value=>onRecord(current=>({...current,customStationInterval:value}))} />}<div className="measurement-station-actions"><button className="secondary-button compact-button" type="button" onClick={onGenerateStations}>Generate Stations</button><button className="secondary-button compact-button" type="button" onClick={onAddStation}>Add Station</button></div></div>;
}
function StationTable({stations,distanceLabel,measurementLabel,onStation,onRemove}:{stations:MeasurementStation[];distanceLabel:string;measurementLabel:string;onStation:(stationId:string,patch:Partial<MeasurementStation>)=>void;onRemove:(stationId:string)=>void}) {
  return <div className="measurement-station-table"><div className="measurement-station-header"><span>{distanceLabel}</span><span>{measurementLabel}</span><span>Notes</span><span></span></div>{stations.map(station=><div className="measurement-station-row" key={station.id}><MeasurementInput label={distanceLabel} value={station.distance} set={value=>onStation(station.id,{distance:value})} /><MeasurementInput label={measurementLabel} value={station.insideDiameter} set={value=>onStation(station.id,{insideDiameter:value})} /><label className="form-field"><span>Notes</span><input value={station.notes} onChange={event=>onStation(station.id,{notes:event.target.value})} /></label><button className="link-button compact-button" type="button" onClick={()=>onRemove(station.id)}>Remove</button></div>)}{!stations.length&&<p className="form-help">No station rows yet.</p>}</div>;
}

function MachineEditorModal({form,setField,onClose,onSubmit,canEdit,asset,onReplacement,onInspection}:{form:AssetForm;setField:<K extends keyof AssetForm>(key:K,value:AssetForm[K])=>void;onClose:()=>void;onSubmit:(event:FormEvent)=>void;canEdit:boolean;asset:MachineAsset|null;onReplacement:(asset:MachineAsset,field:ReplacementField)=>void;onInspection:()=>void}) {
  const disabled = !canEdit;
  const setupChanged = Boolean(asset && (form.hasDoubleShotInjection !== asset.hasDoubleShotInjection || form.hasPlungerInjection !== asset.hasPlungerInjection));
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><form className="mcc-card machine-modal" onSubmit={onSubmit}>
    <div className="modal-heading"><div><p className="eyebrow">Machine Asset Detail</p><h3>{form.assetNumber || 'New Machine Asset'}</h3><p>{form.brand || 'Brand'} / {form.model || 'Model'} / S/N: {form.serialNumber || '-'}</p></div><button className="link-button compact-button" type="button" onClick={onClose}>Close</button></div>
    <MachineSection title="Basic Info"><Text label="Asset Number / Press Number *" value={form.assetNumber} set={v=>setField('assetNumber',v)} disabled={disabled}/><Text label="Asset Name" value={form.assetName} set={v=>setField('assetName',v)} disabled={disabled}/><Text label="Brand *" value={form.brand} set={v=>setField('brand',v)} disabled={disabled}/><Text label="Model" value={form.model} set={v=>setField('model',v)} disabled={disabled}/><Text label="Serial Number" value={form.serialNumber} set={v=>setField('serialNumber',v)} disabled={disabled}/><Text label="Machine Year" value={form.machineYear} set={v=>setField('machineYear',v)} disabled={disabled} helper={<small className="machine-age-pill machine-age-helper-pill">Age: {machineYearAge(form.machineYear)}</small>}/><Text label="Machine Type" value={form.machineType} set={v=>setField('machineType',v)} disabled={disabled}/><Select label="Power Type" value={form.powerType} set={v=>setField('powerType',v)} options={['','Hydraulic','Electric','Hybrid','Other']} disabled={disabled}/><DecimalInput label="Shot Size (oz)" value={form.shotSizeOz} set={v=>setField('shotSizeOz',v)} disabled={disabled}/><Text label="Tonnage" value={String(form.tonnage)} set={v=>setField('tonnage',Number(v)||0)} disabled={disabled}/><Text label="Barrel/Screw Diameter" value={form.barrelDiameter} set={v=>setField('barrelDiameter',v)} disabled={disabled}/><Text label="Location" value={form.location} set={v=>setField('location',v)} disabled={disabled}/><Select label="Status" value={form.status} set={v=>setField('status',v)} options={['active','down','disabled','removed']} disabled={disabled}/></MachineSection>
    <section className="machine-form-section"><span>Injection Setup</span><div className="machine-setup-grid"><YesNoToggle label="Double Shot Injection" value={form.hasDoubleShotInjection} set={value=>setField('hasDoubleShotInjection',value)} disabled={disabled}/><YesNoToggle label="Plunger Injection" value={form.hasPlungerInjection} set={value=>setField('hasPlungerInjection',value)} disabled={disabled}/></div>{setupChanged&&<p className="machine-setup-warning">Changing injection setup can show or hide component fields. Existing saved data will not be deleted.</p>}</section>
    <MachineSection title="Electrical"><Text label="Voltage" value={form.voltageValue} set={v=>setField('voltageValue',v)} disabled={disabled}/><Select label="Voltage Type" value={form.voltageType} set={v=>setField('voltageType',v)} options={['','AC','DC']} disabled={disabled}/><Text label="Full Load Amp" value={form.fullLoadAmp} set={v=>setField('fullLoadAmp',v)} disabled={disabled}/></MachineSection>
    <MachineSection title="Dimensions">{unitFields.map(field=><UnitDimensionField key={field.key} label={field.label} value={form[field.key]} set={v=>setField(field.key,v)} disabled={disabled}/>)}</MachineSection>
    {!form.hasDoubleShotInjection&&<section className="machine-form-section"><span>Screw / Barrel</span><div className="machine-screw-barrel-grid"><ScrewBox title="Screw Box" form={form} setField={setField} disabled={disabled} typeKey="screwType" tipTypeKey="screwTipType" rebuildKey="screwRebuildRepaired" conditionKey="screwConditionStatus" installedDateKey="screwInstalledDate" tipInstalledDateKey="screwTipInstalledDate" lengthKey="screwLength" conditionLabel="Screw condition" /><BarrelBox title="Barrel Box" form={form} setField={setField} disabled={disabled} diameterKey="barrelDiameter" rebuildKey="barrelRebuildRepaired" conditionKey="barrelConditionStatus" installedDateKey="barrelInstalledDate" endCapDateKey="barrelEndCapInstalledDate" lengthKey="barrelLength" conditionLabel="Barrel condition" /></div><MeasurementRow canEdit={canEdit} label="Measurement Inspection" onInspection={onInspection}/></section>}
    {form.hasDoubleShotInjection&&<><section className="machine-form-section"><span>Injection Unit 1</span><div className="machine-screw-barrel-grid"><ScrewBox title="Screw 1 Box" form={form} setField={setField} disabled={disabled} typeKey="screwType" tipTypeKey="screwTipType" rebuildKey="screwRebuildRepaired" conditionKey="screwConditionStatus" installedDateKey="screwInstalledDate" tipInstalledDateKey="screwTipInstalledDate" lengthKey="screwLength" conditionLabel="Screw 1 condition" /><BarrelBox title="Barrel 1 Box" form={form} setField={setField} disabled={disabled} diameterKey="barrelDiameter" rebuildKey="barrelRebuildRepaired" conditionKey="barrelConditionStatus" installedDateKey="barrelInstalledDate" endCapDateKey="barrelEndCapInstalledDate" lengthKey="barrelLength" conditionLabel="Barrel 1 condition" /></div><MeasurementRow canEdit={canEdit} label="Unit 1 Measurement Inspection" onInspection={onInspection}/></section><section className="machine-form-section"><span>Injection Unit 2</span><div className="machine-screw-barrel-grid"><ScrewBox title="Screw 2 Box" form={form} setField={setField} disabled={disabled} typeKey="screw2Type" tipTypeKey="screw2TipType" rebuildKey="screw2RebuildRepaired" conditionKey="screw2ConditionStatus" installedDateKey="screw2InstalledDate" tipInstalledDateKey="screw2TipInstalledDate" lengthKey="screw2Length" conditionLabel="Screw 2 condition" /><BarrelBox title="Barrel 2 Box" form={form} setField={setField} disabled={disabled} diameterKey="barrel2Diameter" rebuildKey="barrel2RebuildRepaired" conditionKey="barrel2ConditionStatus" installedDateKey="barrel2InstalledDate" endCapDateKey="barrel2EndCapInstalledDate" lengthKey="barrel2Length" conditionLabel="Barrel 2 condition" /></div><MeasurementRow canEdit={canEdit} label="Unit 2 Measurement Inspection" onInspection={onInspection}/></section></>}
    {form.hasPlungerInjection&&<section className="machine-form-section"><span>Plunger Injection</span><div className="machine-screw-barrel-grid"><PlungerBox title="Plunger Box" form={form} setField={setField} disabled={disabled}/><PlungerBarrelBox title="Plunger Barrel / Cylinder Barrel Box" form={form} setField={setField} disabled={disabled}/></div><MeasurementRow canEdit={canEdit} label="Plunger Measurement Inspection" onInspection={onInspection}/></section>}
    {asset&&<ReplacementUpdatesPanel asset={asset} form={form} canEdit={canEdit} onReplacement={onReplacement} />}
    <MachineSection title="Notes / Critical Notes"><Area tone="note" label="Notes" value={form.notes} set={v=>setField('notes',v)} disabled={disabled}/><Area tone="critical" label="Critical Notes" value={form.criticalNotes} set={v=>setField('criticalNotes',v)} disabled={disabled}/></MachineSection>
    <div className="machine-placeholder-grid"><section>Linked Inventory Parts coming next</section><section>Machine PM schedules coming next</section><section>Machine documents coming next</section><section>History preview available from Logs</section></div>
    <div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit" disabled={!canEdit}>{asset?'Save Machine Asset':'Create Machine Asset'}</button></div>
  </form></div>;
}
function InjectionSetupModal({setup,setSetup,onContinue,onCancel}:{setup:{hasDoubleShotInjection:boolean;hasPlungerInjection:boolean};setSetup:Dispatch<SetStateAction<{hasDoubleShotInjection:boolean;hasPlungerInjection:boolean}>>;onContinue:()=>void;onCancel:()=>void}) {
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><section className="mcc-card machine-setup-modal"><div className="modal-heading"><div><p className="eyebrow">Machine Asset Setup</p><h3>Machine Injection Setup</h3></div><button className="link-button compact-button" type="button" onClick={onCancel}>Close</button></div><div className="machine-setup-grid"><YesNoToggle label="Does this machine have double shot injection?" value={setup.hasDoubleShotInjection} set={value=>setSetup(current=>({...current,hasDoubleShotInjection:value}))} disabled={false}/><YesNoToggle label="Does this machine have plunger injection?" value={setup.hasPlungerInjection} set={value=>setSetup(current=>({...current,hasPlungerInjection:value}))} disabled={false}/></div><div className="modal-actions"><button className="secondary-button" type="button" onClick={onCancel}>Cancel</button><button className="primary-button" type="button" onClick={onContinue}>Continue</button></div></section></div>;
}
function ImportResultModal({summary,onClose}:{summary:MachineImportSummary;onClose:()=>void}) {
  const rejected = summary.rejectedDuplicates ?? [];
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><section className="mcc-card machine-import-result-modal"><div className="modal-heading"><div><p className="eyebrow">Machine Import</p><h3>Machine import rejected duplicates</h3></div><button className="link-button compact-button" type="button" onClick={onClose}>Close</button></div><div className="machine-import-summary-grid"><div><span>Added</span><strong>{summary.addedCount ?? 0}</strong></div><div><span>Updated</span><strong>{summary.updatedCount ?? 0}</strong></div><div><span>Skipped</span><strong>{summary.skippedCount ?? 0}</strong></div><div><span>Rejected duplicates</span><strong>{summary.rejectedDuplicateCount ?? 0}</strong></div></div><div className="machine-import-rejection-list">{rejected.slice(0,10).map(item=><p key={`${item.rowNumber}-${item.assetNumber}-${item.reason}`}>Row {item.rowNumber}: {item.assetNumber || 'Asset Number'} {item.reason.charAt(0).toLowerCase() + item.reason.slice(1)}</p>)}{rejected.length > 10&&<small>Showing first 10 of {rejected.length} rejected duplicates.</small>}</div><div className="modal-actions"><button className="primary-button" type="button" onClick={onClose}>OK</button></div></section></div>;
}
function YesNoToggle({label,value,set,disabled}:{label:string;value:boolean;set:(value:boolean)=>void;disabled:boolean}) {
  return <div className="form-field machine-yes-no"><span>{label}</span><div><button className={value ? 'primary-button compact-button' : 'secondary-button compact-button'} type="button" onClick={()=>set(true)} disabled={disabled}>Yes</button><button className={!value ? 'primary-button compact-button' : 'secondary-button compact-button'} type="button" onClick={()=>set(false)} disabled={disabled}>No</button></div></div>;
}
function setComponentRebuild<K extends BooleanFormKey, C extends ConditionFormKey>(setField:<T extends keyof AssetForm>(key:T,value:AssetForm[T])=>void,rebuildKey:K,conditionKey:C,checked:boolean) {
  setField(rebuildKey, checked as AssetForm[K]);
  setField(conditionKey, (checked ? 'rebuilt_repaired' : 'new') as AssetForm[C]);
}
function machineComponentClass(tone: 'screw' | 'barrel' | 'screw-secondary' | 'barrel-secondary' | 'plunger' | 'plunger-barrel') {
  return `machine-component-box component-${tone}`;
}
function ScrewBox({title,form,setField,disabled,typeKey,tipTypeKey,rebuildKey,conditionKey,installedDateKey,tipInstalledDateKey,lengthKey,conditionLabel}:{title:string;form:AssetForm;setField:<K extends keyof AssetForm>(key:K,value:AssetForm[K])=>void;disabled:boolean;typeKey:StringFormKey;tipTypeKey:StringFormKey;rebuildKey:BooleanFormKey;conditionKey:ConditionFormKey;installedDateKey:StringFormKey;tipInstalledDateKey:StringFormKey;lengthKey:UnitFieldKey;conditionLabel:string}) {
  return <div className={machineComponentClass(title.includes('2') ? 'screw-secondary' : 'screw')}><h4>{title}</h4><Text label="Screw Type" value={String(form[typeKey] ?? '')} set={v=>setField(typeKey,v as AssetForm[typeof typeKey])} disabled={disabled}/><Text label="Screw Tip Type" value={String(form[tipTypeKey] ?? '')} set={v=>setField(tipTypeKey,v as AssetForm[typeof tipTypeKey])} disabled={disabled}/><Check label={`${title.replace(' Box','')} Rebuild / Repaired`} checked={Boolean(form[rebuildKey])} set={checked=>setComponentRebuild(setField,rebuildKey,conditionKey,checked)} disabled={disabled}/><DateWithAge label={`${title.replace(' Box','')} Installed Date`} value={String(form[installedDateKey] ?? '')} set={v=>setField(installedDateKey,v as AssetForm[typeof installedDateKey])} disabled={disabled}/><DateWithAge label={`${title.replace(' Box','')} Tip Installed Date`} value={String(form[tipInstalledDateKey] ?? '')} set={v=>setField(tipInstalledDateKey,v as AssetForm[typeof tipInstalledDateKey])} disabled={disabled}/><UnitDimensionField label={`${title.replace(' Box','')} Length`} value={String(form[lengthKey] ?? '')} set={v=>setField(lengthKey,v as AssetForm[typeof lengthKey])} disabled={disabled}/><ConditionBadge label={conditionLabel} status={effectiveCondition(Boolean(form[rebuildKey]), String(form[conditionKey]))} /></div>;
}
function BarrelBox({title,form,setField,disabled,diameterKey,rebuildKey,conditionKey,installedDateKey,endCapDateKey,lengthKey,conditionLabel}:{title:string;form:AssetForm;setField:<K extends keyof AssetForm>(key:K,value:AssetForm[K])=>void;disabled:boolean;diameterKey:StringFormKey;rebuildKey:BooleanFormKey;conditionKey:ConditionFormKey;installedDateKey:StringFormKey;endCapDateKey:StringFormKey;lengthKey:UnitFieldKey;conditionLabel:string}) {
  return <div className={machineComponentClass(title.includes('2') ? 'barrel-secondary' : 'barrel')}><h4>{title}</h4><Text label={`${title.replace(' Box','')} Diameter`} value={String(form[diameterKey] ?? '')} set={v=>setField(diameterKey,v as AssetForm[typeof diameterKey])} disabled={disabled}/><Check label={`${title.replace(' Box','')} Rebuild / Repaired`} checked={Boolean(form[rebuildKey])} set={checked=>setComponentRebuild(setField,rebuildKey,conditionKey,checked)} disabled={disabled}/><DateWithAge label={`${title.replace(' Box','')} Installed Date`} value={String(form[installedDateKey] ?? '')} set={v=>setField(installedDateKey,v as AssetForm[typeof installedDateKey])} disabled={disabled}/><DateWithAge label={`${title.replace(' Box','')} End Cap Installed Date`} value={String(form[endCapDateKey] ?? '')} set={v=>setField(endCapDateKey,v as AssetForm[typeof endCapDateKey])} disabled={disabled}/><UnitDimensionField label={`${title.replace(' Box','')} Length`} value={String(form[lengthKey] ?? '')} set={v=>setField(lengthKey,v as AssetForm[typeof lengthKey])} disabled={disabled}/><ConditionBadge label={conditionLabel} status={effectiveCondition(Boolean(form[rebuildKey]), String(form[conditionKey]))} /></div>;
}
function PlungerBox({title,form,setField,disabled}:{title:string;form:AssetForm;setField:<K extends keyof AssetForm>(key:K,value:AssetForm[K])=>void;disabled:boolean}) {
  return <div className={machineComponentClass('plunger')}><h4>{title}</h4><Text label="Plunger Type" value={form.plungerType} set={v=>setField('plungerType',v)} disabled={disabled}/><Check label="Plunger Rebuild / Repaired" checked={form.plungerRebuildRepaired} set={checked=>setComponentRebuild(setField,'plungerRebuildRepaired','plungerConditionStatus',checked)} disabled={disabled}/><DateWithAge label="Plunger Installed Date" value={form.plungerInstalledDate} set={v=>setField('plungerInstalledDate',v)} disabled={disabled}/><UnitDimensionField label="Plunger Length" value={form.plungerLength} set={v=>setField('plungerLength',v)} disabled={disabled}/><UnitDimensionField label="Plunger Diameter" value={form.plungerDiameter} set={v=>setField('plungerDiameter',v)} disabled={disabled}/><ConditionBadge label="Plunger condition" status={effectiveCondition(form.plungerRebuildRepaired, form.plungerConditionStatus)} /></div>;
}
function PlungerBarrelBox({title,form,setField,disabled}:{title:string;form:AssetForm;setField:<K extends keyof AssetForm>(key:K,value:AssetForm[K])=>void;disabled:boolean}) {
  return <div className={machineComponentClass('plunger-barrel')}><h4>{title}</h4><Text label="Plunger Barrel Type" value={form.plungerBarrelType} set={v=>setField('plungerBarrelType',v)} disabled={disabled}/><Check label="Plunger Barrel Rebuild / Repaired" checked={form.plungerBarrelRebuildRepaired} set={checked=>setComponentRebuild(setField,'plungerBarrelRebuildRepaired','plungerBarrelConditionStatus',checked)} disabled={disabled}/><DateWithAge label="Plunger Barrel Installed Date" value={form.plungerBarrelInstalledDate} set={v=>setField('plungerBarrelInstalledDate',v)} disabled={disabled}/><DateWithAge label="Plunger Barrel End Cap Installed Date" value={form.plungerBarrelEndCapInstalledDate} set={v=>setField('plungerBarrelEndCapInstalledDate',v)} disabled={disabled}/><UnitDimensionField label="Plunger Barrel Length" value={form.plungerBarrelLength} set={v=>setField('plungerBarrelLength',v)} disabled={disabled}/><UnitDimensionField label="Plunger Barrel Diameter" value={form.plungerBarrelDiameter} set={v=>setField('plungerBarrelDiameter',v)} disabled={disabled}/><ConditionBadge label="Plunger Barrel condition" status={effectiveCondition(form.plungerBarrelRebuildRepaired, form.plungerBarrelConditionStatus)} /></div>;
}
function MeasurementRow({canEdit,label,onInspection}:{canEdit:boolean;label:string;onInspection:()=>void}) {
  return <div className="measurement-inspection-row">{canEdit&&<button className="machine-action-badge measurement-inspection-button" type="button" onClick={onInspection}>{label}</button>}<small>Open alpha measurement forms for screw, barrel, tip, and enabled injection components.</small></div>;
}
function ReplacementUpdatesPanel({asset,form,canEdit,onReplacement}:{asset:MachineAsset;form:AssetForm;canEdit:boolean;onReplacement:(asset:MachineAsset,field:ReplacementField)=>void}) {
  const groups = replacementGroups.filter(group=>group.enabled(form));
  return <section className="machine-replacement-panel"><span>Replacement Updates</span><div className="machine-replacement-groups">{groups.map(group=><div className="machine-replacement-group" key={group.title}><strong>{group.title}</strong><div className="machine-replacement-actions">{group.fields.map(field=><button className="machine-action-badge" type="button" key={field} onClick={()=>onReplacement(asset,field)} disabled={!canEdit}><span aria-hidden="true">+</span>New {replacementLabels[field]}</button>)}</div></div>)}</div></section>;
}
function MachineSection({title,children}:{title:string;children:ReactNode}) { return <section className="machine-form-section"><span>{title}</span><div className="machine-form-grid">{children}</div></section>; }
function Text({label,value,set,disabled,helper}:{label:string;value:string;set:(value:string)=>void;disabled:boolean;helper?:ReactNode}) { return <label className="form-field"><span>{label}</span><input value={value} disabled={disabled} onChange={event=>set(event.target.value)} />{helper}</label>; }
function DecimalInput({label,value,set,disabled}:{label:string;value:string;set:(value:string)=>void;disabled:boolean}) { return <label className="form-field"><span>{label}</span><input type="number" step="0.01" inputMode="decimal" value={value} disabled={disabled} onChange={event=>set(event.target.value)} /></label>; }
function Area({label,value,set,disabled,tone}:{label:string;value:string;set:(value:string)=>void;disabled:boolean;tone?:'note'|'critical'}) { return <label className={`form-field machine-form-wide ${tone === 'critical' ? 'machine-critical-field' : tone === 'note' ? 'machine-note-field' : ''}`}><span>{label}</span><textarea value={value} disabled={disabled} onChange={event=>set(event.target.value)} /></label>; }
function Select({label,value,set,options,disabled}:{label:string;value:string;set:(value:string)=>void;options:string[];disabled:boolean}) { return <label className="form-field"><span>{label}</span><select value={value} disabled={disabled} onChange={event=>set(event.target.value)}>{options.map(option=><option key={option} value={option}>{option || 'Select'}</option>)}</select></label>; }
function Check({label,checked,set,disabled}:{label:string;checked:boolean;set:(checked:boolean)=>void;disabled:boolean}) { return <label className="machine-check-field"><input type="checkbox" checked={checked} disabled={disabled} onChange={event=>set(event.target.checked)} /><span>{label}</span></label>; }
function ConditionSelect({label,value,set,disabled}:{label:string;value:ConditionStatus;set:(value:ConditionStatus)=>void;disabled:boolean}) {
  return <label className="form-field"><span>{label}</span><select value={value} disabled={disabled} onChange={event=>set(event.target.value as ConditionStatus)}>{(Object.keys(conditionLabels) as ConditionStatus[]).map(option=><option key={option} value={option}>{conditionLabels[option]}</option>)}</select></label>;
}
function ComponentConditionEditor({rebuildLabel,conditionLabel,rebuild,condition,setRebuild,setCondition,disabled}:{rebuildLabel:string;conditionLabel:string;rebuild:boolean;condition:ConditionStatus;setRebuild:(value:boolean)=>void;setCondition:(value:ConditionStatus)=>void;disabled:boolean}) {
  const effective = rebuild ? 'rebuilt_repaired' : condition;
  return <><Check label={rebuildLabel} checked={rebuild} set={checked=>{ setRebuild(checked); setCondition(checked ? 'rebuilt_repaired' : 'new'); }} disabled={disabled}/><ConditionSelect label={conditionLabel} value={effective} set={value=>{ if (value === 'rebuilt_repaired') { setRebuild(true); setCondition('rebuilt_repaired'); } else { setRebuild(false); setCondition(value); } }} disabled={disabled}/></>;
}
function DateWithAge({label,value,set,disabled}:{label:string;value:string;set:(value:string)=>void;disabled:boolean}) {
  const isoValue = isoDateValue(value);
  const useDatePicker = isoValue !== null;
  if (!useDatePicker) return <label className="form-field machine-date-field"><span>{label}</span><input value={value} disabled={disabled} onChange={event=>set(event.target.value)} placeholder="YYYY-MM-DD or known text" /><small className="machine-age-label">Year count: {ageYears(value)}</small></label>;
  return <MccDateField label={label} value={isoValue} set={set} disabled={disabled} ageText={ageYears(value)} />;
}
function MccDateField({label,value,set,disabled,ageText}:{label:string;value:string;set:(value:string)=>void;disabled:boolean;ageText:string}) {
  const today = useMemo(()=>new Date(),[]);
  const selectedDate = parseIsoDate(value);
  const [open,setOpen]=useState(false);
  const [viewDate,setViewDate]=useState<Date>(selectedDate ?? today);
  const wrapRef=useRef<HTMLLabelElement>(null);
  const popoverRef=useRef<HTMLDivElement>(null);
  const [position,setPosition]=useState<DatePopoverPosition>({top:0,left:0,width:312,placement:'bottom'});
  const viewYear = viewDate.getFullYear();
  const viewMonth = viewDate.getMonth();
  const monthStart = new Date(viewYear, viewMonth, 1);
  const gridStart = new Date(viewYear, viewMonth, 1 - monthStart.getDay());
  const days = Array.from({length:42},(_,index)=>new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index));
  const selectedIso = selectedDate ? localIsoDate(selectedDate) : '';
  const todayIso = localIsoDate(today);
  function updatePopoverPosition() {
    const anchor = wrapRef.current?.querySelector('.mcc-date-control') ?? wrapRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const margin = 10;
    const preferredWidth = Math.min(312, Math.max(260, window.innerWidth - margin * 2));
    const popoverHeight = popoverRef.current?.offsetHeight || 344;
    const width = Math.min(preferredWidth, window.innerWidth - margin * 2);
    const belowTop = rect.bottom + 8;
    const aboveTop = rect.top - popoverHeight - 8;
    const hasRoomBelow = belowTop + popoverHeight <= window.innerHeight - margin;
    const top = hasRoomBelow ? belowTop : Math.max(margin, aboveTop);
    const left = Math.min(Math.max(margin, rect.right - width), window.innerWidth - width - margin);
    setPosition({top,left,width,placement:hasRoomBelow ? 'bottom' : 'top'});
  }
  useEffect(()=>{
    if(!open) return;
    setViewDate(selectedDate ?? today);
    updatePopoverPosition();
    const frame = window.requestAnimationFrame(updatePopoverPosition);
    return ()=>window.cancelAnimationFrame(frame);
  },[open,selectedIso,today]);
  useEffect(()=>{
    if(!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if(wrapRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if(event.key==='Escape') setOpen(false);
    }
    document.addEventListener('pointerdown',onPointerDown);
    document.addEventListener('keydown',onKeyDown);
    window.addEventListener('resize',updatePopoverPosition);
    window.addEventListener('scroll',updatePopoverPosition,true);
    return ()=>{
      document.removeEventListener('pointerdown',onPointerDown);
      document.removeEventListener('keydown',onKeyDown);
      window.removeEventListener('resize',updatePopoverPosition);
      window.removeEventListener('scroll',updatePopoverPosition,true);
    };
  },[open]);
  function chooseDate(date: Date) {
    set(localIsoDate(date));
    setOpen(false);
  }
  function moveMonth(offset: number) {
    setViewDate(current=>new Date(current.getFullYear(), current.getMonth() + offset, 1));
  }
  const calendar = open ? createPortal(<div className={`mcc-date-popover placement-${position.placement}`} ref={popoverRef} role="dialog" aria-label={`${label} calendar`} style={{top:position.top,left:position.left,width:position.width}}><div className="mcc-date-header"><button type="button" onClick={()=>moveMonth(-1)} aria-label="Previous month">&lt;</button><strong>{viewDate.toLocaleString(undefined,{month:'long',year:'numeric'})}</strong><button type="button" onClick={()=>moveMonth(1)} aria-label="Next month">&gt;</button></div><div className="mcc-date-weekdays" aria-hidden="true">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(day=><span key={day}>{day}</span>)}</div><div className="mcc-date-grid">{days.map(day=>{ const iso=localIsoDate(day); const outside=day.getMonth()!==viewMonth; return <button className={`${outside?'outside ':''}${iso===todayIso?'today ':''}${iso===selectedIso?'selected ':''}`.trim()} type="button" key={iso} onClick={()=>chooseDate(day)} aria-label={day.toLocaleDateString(undefined,{dateStyle:'full'})} aria-pressed={iso===selectedIso}>{day.getDate()}</button>; })}</div><div className="mcc-date-footer"><button type="button" onClick={()=>{ set(''); setOpen(false); }}>Clear</button><button type="button" onClick={()=>chooseDate(today)}>Today</button></div></div>, document.body) : null;
  return <label className={open?'form-field machine-date-field mcc-date-open':'form-field machine-date-field'} ref={wrapRef}><span>{label}</span><div className="mcc-date-control"><input className="mcc-date-input" type="text" inputMode="numeric" value={value} disabled={disabled} onFocus={()=>setOpen(true)} onChange={event=>set(event.target.value)} placeholder="YYYY-MM-DD" /><button className="mcc-date-trigger" type="button" aria-label={`Open ${label} calendar`} disabled={disabled} onClick={()=>setOpen(current=>!current)}><span className="mcc-date-icon" aria-hidden="true" /></button>{calendar}</div><small className="machine-age-label">Year count: {ageText}</small></label>;
}
function ConditionBadge({label,status}:{label:string;status:ConditionStatus}) {
  return <div className={`machine-condition-badge condition-${status}`}><span>{label}</span><strong>{conditionLabels[status]}</strong></div>;
}
function UnitDimensionField({label,value,set,disabled}:{label:string;value:string;set:(value:string)=>void;disabled:boolean}) {
  const [isEditing,setIsEditing]=useState(!parseDimensionValue(value));
  const parsed = parseDimensionValue(value);
  const hasValue = Boolean(value.trim());
  const showInput = isEditing || !hasValue || !parsed;
  return <div className="form-field machine-unit-field">
    <span>{label}</span>
    {showInput ? <>
      <input value={value} disabled={disabled} onChange={event=>set(event.target.value)} onBlur={()=>{ if (parseDimensionValue(value)) setIsEditing(false); }} placeholder="100mm, 72in, 6ft" />
      {hasValue&&!parsed&&<small className="machine-unit-warning">Enter a value like 100mm, 72in, or 6ft.</small>}
    </> : <div className="machine-unit-display"><div><span className="unit-mm">{formatUnitNumber(parsed.mm, 1)}mm</span><span className="unit-in">{formatUnitNumber(parsed.inches, 2)}in</span><span className="unit-ft">{formatUnitNumber(parsed.feet, 2)}ft</span></div>{!disabled&&<button className="machine-unit-edit" type="button" onClick={()=>setIsEditing(true)} aria-label={`Edit ${label}`}>Edit</button>}</div>}
  </div>;
}
function BrandColorModal({brandSettings,colorDrafts,setColorDrafts,canEdit,onSave,onClose}:{brandSettings:BrandSetting[];colorDrafts:Record<string,string>;setColorDrafts:Dispatch<SetStateAction<Record<string,string>>>;canEdit:boolean;onSave:(brandName:string)=>void;onClose:()=>void}) {
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><section className="mcc-card machine-color-modal"><div className="modal-heading"><div><p className="eyebrow">Brand Color Settings</p><h3>Machine Brand Colors</h3></div><button className="link-button compact-button" type="button" onClick={onClose}>Close</button></div>{brandSettings.map(setting=><div className="machine-color-row" key={setting.brandName}><span className={`machine-color-swatch ${isEngelBrand(setting.brandName) ? 'machine-color-swatch-engel' : ''}`} style={{background:safeCssHex(colorDrafts[setting.brandName] ?? setting.colorHex)}} /><strong>{setting.brandName}</strong><input value={colorDrafts[setting.brandName] ?? setting.colorHex} disabled={!canEdit} onChange={event=>setColorDrafts(current=>({...current,[setting.brandName]:event.target.value}))} /><button className="secondary-button compact-button" type="button" onClick={()=>onSave(setting.brandName)} disabled={!canEdit}>Save</button></div>)}</section></div>;
}
function ReplacementModal({replacement,setReplacement,onSubmit}:{replacement:{asset:MachineAsset;field:ReplacementField;installDate:string;reasonNote:string};setReplacement:Dispatch<SetStateAction<{asset:MachineAsset;field:ReplacementField;installDate:string;reasonNote:string}|null>>;onSubmit:(event:FormEvent)=>void}) {
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><form className="mcc-card machine-small-modal" onSubmit={onSubmit}><p className="eyebrow">Replacement Update</p><h3>Update New {replacementLabels[replacement.field]} Install Date</h3><DateWithAge label="Install Date *" value={replacement.installDate} set={installDate=>setReplacement(current=>current&&({...current,installDate}))} disabled={false}/><Area label="Reason / Note" value={replacement.reasonNote} set={reasonNote=>setReplacement(current=>current&&({...current,reasonNote}))} disabled={false}/><div className="modal-actions"><button className="secondary-button" type="button" onClick={()=>setReplacement(null)}>Cancel</button><button className="primary-button" type="submit">Update {replacementLabels[replacement.field]} Date</button></div></form></div>;
}
function LogsModal({logs,onClose,onBackToAsset}:{logs:{asset:MachineAsset;records:HistoryRecord[]};onClose:()=>void;onBackToAsset:()=>void}) {
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><section className="mcc-card machine-logs-modal"><div className="modal-heading"><div><p className="eyebrow">Machine Asset History</p><h3>{logs.asset.assetNumber}</h3></div><button className="link-button compact-button" type="button" onClick={onClose}>Close</button></div><div className="machine-log-list">{logs.records.map(record=><article className="machine-log-row" key={record.id}><span>{formatDateTime(record.createdAt)}</span><strong>{actionLabel(record.action)}</strong><p>{record.userName || 'Unknown'} / {record.reasonNote || 'No reason note'}</p></article>)}{!logs.records.length&&<p className="form-message">No machine-specific logs yet.</p>}</div><div className="modal-actions"><button className="secondary-button" type="button" onClick={onBackToAsset}>Back to Asset</button><button className="primary-button" type="button" onClick={onClose}>Done</button></div></section></div>;
}
