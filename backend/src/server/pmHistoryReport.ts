import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';

export const PM_REPORT_LIMITS = { records: 200, textBytes: 1024 * 1024, pages: 120, pdfBytes: 4 * 1024 * 1024, concurrent: 2 } as const;
export class PmReportError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
export function pmReportSelection(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new PmReportError('Choose completion records for the report.');
  const input = body as Record<string, unknown>, ids = input.completionIds;
  if (!Array.isArray(ids) || !ids.length) throw new PmReportError('Select at least one completion record.');
  if (ids.length > PM_REPORT_LIMITS.records) throw new PmReportError(`Select at most ${PM_REPORT_LIMITS.records} completions per report.`, 413);
  if (ids.some(id => !Number.isSafeInteger(id) || Number(id) <= 0) || new Set(ids).size !== ids.length) throw new PmReportError('Completion IDs must be distinct positive integers.');
  if (input.pmTaskId !== undefined && (!Number.isSafeInteger(input.pmTaskId) || Number(input.pmTaskId) <= 0)) throw new PmReportError('The PM task identifier is invalid.');
  return { ids: ids as number[], taskId: input.pmTaskId as number | undefined };
}
export type PmReportRecord = {
  id: number; pmTaskId: number; taskTitle: string; intervalType: string; completionDate: string;
  performedBy: string; participants: Array<{ displayName: string }>; workOrderNumber: string;
  machineNotScheduledOrRunning: boolean; previousDueDate: string | null; previousDueMeter: number | null;
  nextDueDate: string | null; nextDueMeter: number | null; completedMeter: number | null;
  followUpRequired: boolean; followUpReason: string; completionNotes: string;
  attachment: { filename: string; status: string } | null;
};
type ReportInput = { library: 'machine' | 'equipment'; asset: { number: string; name: string; model: string; serial: string }; records: PmReportRecord[]; generatedAt: string };
const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
export function pmReportFilename(assetNumber: string, records: PmReportRecord[]) {
  const dates = new Set(records.map(row => /^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(row.completionDate) ? row.completionDate.slice(0, 7) : 'unknown'));
  const month = dates.size === 1 ? [...dates][0] : 'unknown';
  const period = month === 'unknown' ? 'Selected-Dates' : `${months[Number(month.slice(5)) - 1]}-${month.slice(0, 4)}`;
  const identity = assetNumber.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'Asset';
  return `MCC_PM_History_${identity}_${period}.pdf`;
}

// Uses the existing portable PDF engine and fonts. Unsupported glyphs are
// explicitly escaped by code point rather than silently dropping recorded text.
function printable(value: unknown, font: PDFFont) {
  return [...String(value ?? '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ')].map(character => {
    if (character === '\n') return character;
    try { font.encodeText(character); return character; }
    catch { return `[U+${character.codePointAt(0)!.toString(16).toUpperCase()}]`; }
  }).join('');
}
export function createPmHistoryReportBuilder() {
  let active = 0;
  return async function build(input: ReportInput) {
    if (active >= PM_REPORT_LIMITS.concurrent) throw new PmReportError('Two PM reports are already being prepared. Try again shortly.', 429);
    active++;
    try {
      if (!input.records.length || input.records.length > PM_REPORT_LIMITS.records || Buffer.byteLength(JSON.stringify(input)) > PM_REPORT_LIMITS.textBytes) throw new PmReportError('This selection exceeds the report size limit. Select fewer records.', 413);
      const records = [...input.records].sort((a, b) => a.completionDate.localeCompare(b.completionDate) || a.id - b.id);
      const pdf = await PDFDocument.create(), regular = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
      pdf.setTitle('MCC PM Completion History'); pdf.setSubject(`${input.library} library; completion IDs ${records.map(row => row.id).join(', ')}`);
      pdf.setAuthor('Maintenance Command Center');
      const margin = 42, width = 612, height = 792, usable = width - margin * 2, bottom = 48;
      const ink = rgb(.08,.17,.22), muted = rgb(.3,.4,.44), accent = rgb(.02,.38,.48);
      let page = pdf.addPage([width, height]), y = height - margin, continuation = '';
      function newPage() {
        if (pdf.getPageCount() >= PM_REPORT_LIMITS.pages) throw new PmReportError('This selection exceeds 120 report pages. Select fewer records.', 413);
        page = pdf.addPage([width, height]); y = height - margin;
        page.drawText('MCC PM Completion History - continued', { x: margin, y, size: 10, font: bold, color: accent }); y -= 24;
        if (continuation) { page.drawText(continuation, { x: margin, y, size: 9, font: regular, color: muted }); y -= 18; }
      }
      function space(amount: number) { if (y - amount < bottom) newPage(); }
      const widths = new Map<string, number>();
      function lines(text: string, font: PDFFont, size: number) {
        const result: string[] = [];
        // Character wrapping remains linear even for a single enormous word.
        for (const paragraph of text.split('\n')) {
          let line = '', used = 0;
          for (const character of paragraph) {
            const key = `${font.name}:${size}:${character}`;
            const amount = widths.get(key) ?? font.widthOfTextAtSize(character, size); widths.set(key, amount);
            while (used + amount > usable && line) {
              const breakAt = line.lastIndexOf(' ');
              if (breakAt > 0) { result.push(line.slice(0, breakAt)); line = line.slice(breakAt + 1); used = font.widthOfTextAtSize(line, size); }
              else { result.push(line); line = ''; used = 0; }
            }
            line += character; used += amount;
          }
          result.push(line);
        }
        return result;
      }
      function text(value: string, font = regular, size = 10, color = ink) {
        for (const line of lines(printable(value, font), font, size)) { space(size + 5); page.drawText(line, { x: margin, y, size, font, color }); y -= size + 5; }
      }
      function field(label: string, value: unknown) { text(`${label}: ${value === null || value === undefined || value === '' ? 'Not recorded' : String(value)}`); }
      text('MAINTENANCE COMMAND CENTER', bold, 11, accent); y -= 6;
      text('PM Completion History', bold, 21); y -= 5;
      text(`${input.library === 'machine' ? 'Machine' : 'Equipment'} Library`, bold, 12);
      field('Asset', `${input.asset.number} - ${input.asset.name}`); field('Model', input.asset.model); field('Serial number', input.asset.serial);
      field('Generated (UTC)', input.generatedAt); field('Included completions', records.length);
      text('Selected immutable completion records; original attachment PDFs are separate documents.', regular, 9, muted);
      if ([...JSON.stringify(input)].some(character => { try { regular.encodeText(character === '\n' ? ' ' : character); return false; } catch { return true; } })) text('Characters outside standard-font coverage are shown as [U+code point].', regular, 9, muted);
      for (const [index, record] of records.entries()) {
        continuation = ''; space(95); y -= 12;
        continuation = `Completion #${record.id} | PM task #${record.pmTaskId} - continued`;
        page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1, color: accent }); y -= 21;
        text(`Record ${index + 1} of ${records.length} | Completion #${record.id} | PM task #${record.pmTaskId}`, bold, 10, accent);
        text(record.taskTitle || 'Untitled PM task', bold, 13);
        field('Completion date', record.completionDate); field('Performed by', record.performedBy);
        field('Recorded participants', record.participants.map(person => person.displayName).join(', '));
        field('Work order', record.machineNotScheduledOrRunning ? `Not required - machine not scheduled / not running${record.workOrderNumber ? ` (${record.workOrderNumber})` : ''}` : record.workOrderNumber || 'Not recorded');
        const unit = record.intervalType === 'hourly' ? 'hours' : record.intervalType === 'cycles' ? 'cycles' : 'meter units not recorded';
        const meter = (value: number | null) => value === null ? 'Not recorded' : `${value} ${unit}`;
        field('Previous due', `${record.previousDueDate || 'Date not recorded'}; ${meter(record.previousDueMeter)}`);
        field('Next due', `${record.nextDueDate || 'Date not recorded'}; ${meter(record.nextDueMeter)}`);
        field('Completed meter', meter(record.completedMeter)); field('Follow-up required', record.followUpRequired ? 'Yes' : 'No');
        if (record.followUpReason) field('Follow-up reason', record.followUpReason);
        field('Original work-order PDF', record.attachment ? `${record.attachment.filename} (${record.attachment.status})` : 'No PDF attached');
        text('Completion notes', bold, 10); text(record.completionNotes || 'No completion notes recorded.');
        if (index % 10 === 9) await new Promise<void>(resolve => setImmediate(resolve));
      }
      for (const [index, reportPage] of pdf.getPages().entries()) {
        reportPage.drawLine({ start: { x: margin, y: 33 }, end: { x: width - margin, y: 33 }, thickness: .5, color: muted });
        reportPage.drawText(`MCC | ${printable(input.asset.number, regular).slice(0, 55)}`, { x: margin, y: 20, size: 8, font: regular, color: muted });
        reportPage.drawText(`Page ${index + 1} of ${pdf.getPageCount()}`, { x: width - 108, y: 20, size: 8, font: regular, color: muted });
      }
      const bytes = Buffer.from(await pdf.save());
      if (bytes.length > PM_REPORT_LIMITS.pdfBytes) throw new PmReportError('This PDF exceeds the report download limit. Select fewer records.', 413);
      return { bytes, filename: pmReportFilename(input.asset.number, records), count: records.length };
    } finally { active--; }
  };
}
