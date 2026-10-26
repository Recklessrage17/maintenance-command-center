import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

// This renderer only consumes report data. Storage, permissions and captured-PDF
// composition stay in the existing export path.
export type MaintenanceRecord = {
  title: string; body: string; is_warning: number; issue_status: string; is_on_hold: number;
  asset_number?: string; asset_name?: string; brand?: string; category?: string;
  asset_library?: string; model?: string; serial_number?: string; location?: string;
  work_order_reference: string; resolved_at: string | null; resolved_by_name: string;
  resolution_summary: string;
};
export type RecordTechnician = { displayName: string; hours: number; isPrimary: boolean };
export type RecordUpdate = {
  created_at: string; created_by_name: string; body: string;
  entries: { work_date: string; labor_hours: number; body: string }[];
  attachments: { original_filename: string }[];
};
type Style = 'regular' | 'bold' | 'italic' | 'boldItalic' | 'code';
type Span = { text: string; style: Style };

/** Helvetica supports WinAnsi, including °, ±, µ and accented Latin names.
 * Keep those characters intact; make unsupported glyphs explicit rather than
 * silently turning a measurement or a name into a question mark.
 */
function printable(value: string, font: PDFFont) {
  return Array.from(value.normalize('NFC')).map(character => {
    try { font.encodeText(character); return character; }
    catch { return `[U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}]`; }
  }).join('');
}

// The application stores plain textarea content, not HTML. Recognize a small,
// balanced Markdown subset at export time; unmatched markers remain literal.
function emphasis(text: string): Span[] {
  // Delimiters inside identifiers or formulas are literal, not emphasis.
  const pattern = /(?<![\p{L}\p{N}_])(?:\*\*\*([^*\n]+)\*\*\*|\*\*([^*\n]+)\*\*|__([^_\n]+)__|\*([^*\n]+)\*|_([^_\n]+)_)(?![\p{L}\p{N}_])|`([^`\n]+)`/gu;
  const spans: Span[] = [];
  let end = 0;
  for (const match of text.matchAll(pattern)) {
    const value=match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? match[6];
    if (!match[6] && value !== value.trim()) continue;
    if (match.index! > end) spans.push({ text: text.slice(end, match.index), style: 'regular' });
    spans.push({ text: value,
      style: match[1] ? 'boldItalic' : match[2] || match[3] ? 'bold' : match[6] ? 'code' : 'italic' });
    end = match.index! + match[0].length;
  }
  if (end < text.length) spans.push({ text: text.slice(end), style: 'regular' });
  return spans;
}

export async function createAssetMaintenanceRecordPdf(input: {
  note: MaintenanceRecord; technicians: RecordTechnician[]; totalHours: number;
  updates: RecordUpdate[]; generatedAt?: Date;
}) {
  const { note, technicians, totalHours, updates } = input;
  const generatedAt = input.generatedAt ?? new Date();
  const pdf = await PDFDocument.create();
  const fonts: Record<Style, PDFFont> = {
    regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    italic: await pdf.embedFont(StandardFonts.HelveticaOblique), boldItalic: await pdf.embedFont(StandardFonts.HelveticaBoldOblique),
    code: await pdf.embedFont(StandardFonts.Courier),
  };
  const navy = rgb(.04, .12, .2), blue = rgb(.02, .3, .52), ink = rgb(.07, .1, .14);
  const muted = rgb(.32, .4, .48), rule = rgb(.76, .81, .85), panel = rgb(.95, .97, .985);
  const width = 612, height = 792, margin = 44, contentWidth = width - margin * 2;
  const bottom = 54, lineHeight = 14, bodySize = 10.5;
  let page!: PDFPage;
  let y = 0;

  function lines(text: string, size: number, maxWidth: number, style: Style = 'regular', rich = false): Span[][] {
    const result: Span[][] = [];
    for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
      const spans = rich ? emphasis(paragraph) : [{ text: paragraph, style }];
      let line: Span[] = [], used = 0;
      const append = (text: string, style: Style) => {
        if (line.at(-1)?.style === style) line[line.length - 1].text += text;
        else line.push({ text, style });
        used += fonts[style].widthOfTextAtSize(text, size);
      };
      for (const span of spans) {
        const text = printable(span.text.replace(/\t/g, '    '), fonts[span.style]);
        for (const token of text.match(/\s+|\S+/g) ?? []) {
          const tokenWidth = fonts[span.style].widthOfTextAtSize(token, size);
          if (used + tokenWidth > maxWidth && used) { result.push(line); line = []; used = 0; }
          if (!used && /^\s+$/.test(token)) continue;
          // Split long identifiers without losing characters or inserting spaces.
          for (const character of token) {
            const characterWidth = fonts[span.style].widthOfTextAtSize(character, size);
            if (used + characterWidth > maxWidth && used) { result.push(line); line = []; used = 0; }
            append(character, span.style);
          }
        }
      }
      result.push(line);
    }
    return result;
  }
  function drawLine(line: Span[], x: number, baseline: number, size: number, color = ink) {
    for (const span of line) {
      page.drawText(span.text, { x, y: baseline, size, font: fonts[span.style], color });
      x += fonts[span.style].widthOfTextAtSize(span.text, size);
    }
  }
  function addPage() {
    const continuation = pdf.getPageCount() > 0;
    page = pdf.addPage([width, height]);
    page.drawText('ASSET MAINTENANCE RECORD', { x: margin, y: 756, size: continuation ? 9 : 10, font: fonts.bold, color: blue });
    y = continuation ? 737 : 728;
    const size = continuation ? 10 : 18;
    const title = continuation ? `${note.asset_number || 'Asset'} / ${note.title} (continued)` : note.title;
    for (const line of lines(title, size, contentWidth, 'bold')) { drawLine(line, margin, y, size, navy); y -= continuation ? 14 : 22; }
    page.drawLine({ start: { x: margin, y: y + 8 }, end: { x: width - margin, y: y + 8 }, thickness: .7, color: rule });
    y -= 6;
  }
  function ensureSpace(needed: number) { if (y - needed < bottom) addPage(); }
  function text(text: string, options: { indent?: number; size?: number; style?: Style; rich?: boolean; color?: ReturnType<typeof rgb> } = {}) {
    const { indent = 0, size = bodySize, style = 'regular', rich = false, color = ink } = options;
    const wrapped = lines(text, size, contentWidth - indent, style, rich);
    wrapped.forEach((line, index) => {
      // Carry at least two lines of a paragraph together when possible.
      ensureSpace(index === 0 && wrapped.length > 1 && line.length ? lineHeight * 2 : lineHeight);
      drawLine(line, margin + indent, y, size, color); y -= lineHeight;
    });
  }
  function section(label: string, followingHeight = lineHeight * 2) {
    ensureSpace(28 + followingHeight);
    y -= 7;
    page.drawLine({ start: { x: margin, y: y + 6 }, end: { x: width - margin, y: y + 6 }, thickness: .5, color: rule });
    page.drawText(label, { x: margin, y: y - 7, size: 9, font: fonts.bold, color: blue });
    y -= 23;
  }
  addPage();
  const number = note.asset_number?.trim() ?? '', name = note.asset_name?.trim() ?? '';
  const asset = number && name && number.toLocaleLowerCase() !== name.toLocaleLowerCase() ? `${number} - ${name}` : number || name || 'Not specified';
  const primary = technicians.find(item => item.isPrimary) ?? technicians[0];
  const status = !note.is_warning ? 'Standard Record' : note.issue_status === 'resolved' ? 'Resolved' : note.is_on_hold ? 'On Hold' : 'Tech Open';
  const metadata = [
    ['Asset', asset], ['Status', status],
    [note.asset_library === 'equipment' ? 'Manufacturer' : 'Brand', note.brand || 'Not specified'], ['Model', note.model || 'Not specified'],
    ['Serial #', note.serial_number || 'Not specified'], ['Work Order #', note.work_order_reference || 'Not assigned'],
    ['Primary technician', primary?.displayName || 'Unknown user'], ['Recorded labor', `${totalHours.toFixed(2)} hr`],
  ];
  if (note.asset_library === 'equipment' && note.category) metadata.push(['Category', note.category]);
  const location = note.location?.trim();
  if (location && !/^(?:[-\u2013\u2014]+|n\/?a|none|null|not (?:set|specified|applicable)|unknown)$/i.test(location)) metadata.push(['Location', location]);
  // Two inline label/value columns, with measured row heights rather than a
  // fixed-height panel. Even unusually long metadata can flow to another page.
  const columnWidth = contentWidth / 2, labelWidth = 91, valueWidth = columnWidth - labelWidth - 16;
  for (let index = 0; index < metadata.length; index += 2) {
    const row = metadata.slice(index, index + 2).map(([label, value]) => ({ label, value: lines(value, 9.5, valueWidth) }));
    const count = Math.max(...row.map(cell => cell.value.length));
    for (let lineIndex = 0; lineIndex < count; lineIndex++) {
      ensureSpace(18);
      page.drawRectangle({ x: margin, y: y - 6, width: contentWidth, height: 18, color: panel });
      row.forEach((cell, column) => {
        const x = margin + column * columnWidth + 8;
        if (!lineIndex) page.drawText(cell.label, { x, y, size: 8, font: fonts.bold, color: blue });
        if (cell.value[lineIndex]) drawLine(cell.value[lineIndex], x + labelWidth, y, 9.5);
      });
      y -= 18;
    }
  }
  y -= 4;
  if (technicians.length > 1) {
    section('TECHNICIANS / LABOR');
    for (const technician of technicians) {
      text(`${technician.displayName}${technician.isPrimary ? ' (primary)' : ''} / ${technician.hours.toFixed(2)} hr`, { size: 9.5 });
    }
  }
  section(note.is_warning ? 'ORIGINAL ISSUE' : 'TECHNICIAN NOTE');
  text(note.body, { rich: true });
  if (note.is_warning) {
    const firstAuthor = updates[0] && `${new Date(updates[0].created_at).toLocaleString('en-US')} - ${updates[0].created_by_name}`;
    section('TECHNICIAN COMMENTS / DAILY WORK LOGS', firstAuthor ?
      (lines(firstAuthor, 9.5, contentWidth, 'bold').length + 3) * lineHeight : lineHeight);
    if (!updates.length) text('No maintenance updates recorded.', { size: 9.5, color: muted });
    for (const update of updates) {
      const author = `${new Date(update.created_at).toLocaleString('en-US')} - ${update.created_by_name}`;
      const authorHeight = lines(author, 9.5, contentWidth, 'bold').length * lineHeight;
      ensureSpace(authorHeight + lineHeight * 3);
      text(author, { size: 9.5, style: 'bold', color: navy });
      // Keep legacy update bodies if no migrated daily entries are available.
      if (!update.entries.length) text(update.body, { indent: 8, rich: true });
      for (const entry of update.entries) {
        ensureSpace(lineHeight * 3);
        text(`Date: ${new Date(`${entry.work_date}T12:00:00`).toLocaleDateString('en-US')} / ${entry.labor_hours.toFixed(2)} Hrs`, { indent: 8, size: 9, style: 'bold', color: navy });
        text(entry.body, { indent: 8, rich: true });
        y -= 4;
      }
      text(`Work log labor: ${update.entries.reduce((sum, entry) => sum + entry.labor_hours, 0).toFixed(2)} Hrs`, { indent: 8, size: 9, style: 'bold', color: navy });
      for (const attachment of update.attachments) text(`Attachment: ${attachment.original_filename}`, { indent: 12, size: 8.5, color: muted });
      y -= 4;
    }
    if (note.issue_status === 'resolved') {
      const attribution = `Resolved ${note.resolved_at ? new Date(note.resolved_at).toLocaleString('en-US') : '(date unavailable)'} by ${note.resolved_by_name || 'Unknown user'}`;
      const attributionHeight = lines(attribution, 9.5, contentWidth, 'bold').length * lineHeight;
      section('RESOLUTION', attributionHeight + lineHeight * 2);
      text(attribution, { size: 9.5, style: 'bold', color: navy });
      text(note.resolution_summary, { rich: true });
    }
  }
  const summaryPages = [...pdf.getPages()];
  // Called after captured work-order PDFs have been appended, so totals include
  // them while the source pages keep their original appearance and dimensions.
  function addFooters() {
    summaryPages.forEach((item, index) => {
      item.drawLine({ start: { x: margin, y: 35 }, end: { x: width - margin, y: 35 }, thickness: .6, color: rule });
      item.drawText(`Generated ${generatedAt.toLocaleString('en-US')}`, { x: margin, y: 19, size: 7.5, font: fonts.regular, color: muted });
      const label = `Page ${index + 1} of ${pdf.getPageCount()}`;
      item.drawText(label, { x: width - margin - fonts.regular.widthOfTextAtSize(label, 7.5), y: 19, size: 7.5, font: fonts.regular, color: muted });
    });
  }
  return { pdf, addFooters };
}
