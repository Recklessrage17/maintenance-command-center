export type CalendarAge = { years: number; months: number; days: number };

function validDateParts(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

function addCalendarMonths(value: Date, months: number) {
  const result = new Date(value.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0, 12)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

export function calendarAge(value: string, at = new Date()): CalendarAge | null {
  const start = validDateParts(value);
  if (!start || Number.isNaN(at.getTime())) return null;
  const end = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), 12));
  if (start.getTime() > end.getTime()) return null;
  let months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth();
  let cursor = addCalendarMonths(start, months);
  if (cursor.getTime() > end.getTime()) {
    months -= 1;
    cursor = addCalendarMonths(start, months);
  }
  const days = Math.floor((end.getTime() - cursor.getTime()) / 86_400_000);
  return { years: Math.floor(months / 12), months: months % 12, days };
}

function unit(value: number, singular: string, plural: string) {
  return `${value} ${value === 1 ? singular : plural}`;
}

export function formatServiceAge(value: string, at = new Date()) {
  const age = calendarAge(value, at);
  if (!age) return '';
  const parts = [
    age.years ? unit(age.years, 'yr', 'yrs') : '',
    age.months ? unit(age.months, 'mo', 'mos') : '',
    age.days || (!age.years && !age.months) ? unit(age.days, 'day', 'days') : '',
  ].filter(Boolean);
  return parts.join(' ');
}

export function formatMachineAge(machineYear: string, at = new Date()) {
  if (!/^\d{4}$/.test(machineYear.trim())) return 'Unknown';
  const year = Number(machineYear);
  const age = at.getUTCFullYear() - year;
  return age >= 0 && age < 300 ? unit(age, 'yr', 'yrs') : 'Unknown';
}

export function assetSpecPdfUrl(assetId: number, download = false) {
  return `/api/machine-library/assets/${assetId}/specification.pdf${download ? '?download=true' : ''}`;
}

export function assetSpecFilename(assetNumber: string, at = new Date()) {
  const clean = assetNumber.trim().replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'Machine_Asset';
  const prefix = /^press/i.test(clean) ? clean : `Press${clean}`;
  return `${prefix}_Machine_Asset_Specification_${at.toISOString().slice(0, 10)}.pdf`;
}

function dispositionFilename(value: string | null) {
  const match = /filename="?([^";]+)"?/i.exec(value ?? '');
  return match?.[1]?.trim() || '';
}

export async function downloadAssetSpecPdf(assetId: number, assetNumber: string) {
  const response = await fetch(assetSpecPdfUrl(assetId, true), { credentials: 'include' });
  if (!response.ok) {
    const data = await response.json().catch(()=>({})) as { error?: string };
    throw new Error(data.error || 'Machine asset specification PDF could not be downloaded.');
  }
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = dispositionFilename(response.headers.get('content-disposition')) || assetSpecFilename(assetNumber);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(()=>window.URL.revokeObjectURL(url), 0);
}
