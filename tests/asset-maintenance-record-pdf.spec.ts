import { expect, test, type TestInfo } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createAssetMaintenanceRecordPdf, type MaintenanceRecord, type RecordUpdate } from '../backend/src/server/assetMaintenanceRecordPdf.js';

const note: MaintenanceRecord = {
  title: 'End Cap Leaks', asset_number: 'Press 47', asset_name: 'Press 47',
  brand: 'Toyo', model: 'Si-400', serial_number: 'SYNTHETIC-047', location: '-',
  is_warning: 1, is_on_hold: 0, issue_status: 'resolved', work_order_reference: 'WO-2026-0047',
  body: 'Material was leaking around the barrel end cap during production.\n\nInspect the sealing surfaces and verify operation at normal processing temperature.',
  resolved_at: '2026-10-20T16:30:00Z', resolved_by_name: 'José Martínez',
  resolution_summary: '**Repair completed:** Removed the end cap and cleaned the sealing surfaces. Replaced the seal and reassembled to the specified torque.\n\nHeated the barrel to 650°F and checked for leakage under production load. No further leaks were observed. Returned the press to service.\n\nVerified heater-zone readings after the soak period and confirmed that the end-cap area remained dry. The operator completed an additional production cycle and reported stable pressure with no visible material leakage.',
};
const technician = { displayName: 'José Martínez', hours: 2.5, isPrimary: true };
type Inspection = { pages: { width: number; height: number; text: string; image: string;
  spans: { text: string; font: string; size: number; bbox: number[]; origin: number[] }[] }[] };

async function inspect(bytes: Uint8Array, name: string, info: TestInfo): Promise<Inspection> {
  const filename = info.outputPath(`${name}.pdf`);
  fs.writeFileSync(filename, bytes);
  await info.attach(name, { path: filename, contentType: 'application/pdf' });
  const result = JSON.parse(execFileSync(process.env.PYTHON || 'python', ['-B', 'tests/helpers/inspect-maintenance-pdf.py', filename], { encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 }));
  for (const [index, page] of (result as Inspection).pages.entries()) {
    await info.attach(`${name}-page-${index + 1}`, { path: page.image, contentType: 'image/png' });
  }
  return result;
}
function checkLayout(result: Inspection) {
  const headings = ['ORIGINAL ISSUE', 'TECHNICIAN COMMENTS / DAILY WORK LOGS', 'RESOLUTION', 'TECHNICIANS / LABOR'];
  for (const [index, page] of result.pages.entries()) {
    expect([page.width, page.height]).toEqual([612, 792]);
    expect(page.text).toContain(`Page ${index + 1} of ${result.pages.length}`);
    expect(page.text).toContain('Generated ');
    if (index) expect(page.text).toContain('(continued)');
    for (const span of page.spans) {
      expect(span.bbox[0], span.text).toBeGreaterThanOrEqual(43.5);
      expect(span.bbox[2], span.text).toBeLessThanOrEqual(568.5);
      expect(span.bbox[1], span.text).toBeGreaterThanOrEqual(24);
      expect(span.bbox[3], span.text).toBeLessThanOrEqual(777);
      if (span.origin[1] < 750) expect(span.bbox[3], span.text).toBeLessThan(744);
      if (headings.includes(span.text)) {
        expect(page.spans.some(next => next.origin[1] > span.origin[1] + 5 && next.origin[1] < 740), `orphaned ${span.text}`).toBe(true);
      }
    }
    // Different text rows must not collide; same-baseline rich-text spans and
    // metadata columns are expected. Ignore trailing space-only spans.
    const baselines = [...new Set(page.spans.filter(span => span.text.trim()).map(span => span.origin[1]))].sort((a,b) => a-b);
    for (let row = 1; row < baselines.length; row++) expect(baselines[row] - baselines[row - 1]).toBeGreaterThanOrEqual(12);
  }
}
const compactText = (result: Inspection) => result.pages.map(page => page.text).join('').replace(/\s/g, '');
const paragraph = 'The technician inspected the barrel, cleaned the sealing faces, replaced the worn seal, and verified the specified torque. Temperature and pressure were checked through a full production cycle. ';
const cases = [
  { name: 'press-47-short', changes: {}, expectedPages: 1 },
  { name: 'long-resolution', changes: { resolution_summary: Array.from({length: 15}, (_,i) => `Stage ${i+1}. ${paragraph}`).join('\n\n') }, expectedPages: 2 },
  { name: 'many-comments', changes: {}, updates: Array.from({length: 10}, (_,i): RecordUpdate => ({
    created_at: `2026-10-${String(i+1).padStart(2,'0')}T12:00:00Z`, created_by_name: `Technician ${i+1}`, body: '',
    entries: [{work_date:'2026-10-01', labor_hours:.25, body:`Log ${i+1}. ${paragraph.repeat(i===0?20:2)}\n\nFinal reading ${i+1}: 650°F.`}], attachments:[{original_filename:`inspection-${i+1}.jpg`}],
  })), minPages: 3 },
  { name: 'multiple-technicians', changes: {}, technicians: [technician, {displayName:'Renée O’Connor',hours:1.25,isPrimary:false},{displayName:'André Müller',hours:.75,isPrimary:false}], expectedPages: 1 },
  { name: 'long-identifiers', changes: { title: 'End cap inspection and corrective maintenance with a detailed issue title that must wrap without being truncated', asset_name:'Synthetic injection molding press with an extended production cell asset name and complete service identification', work_order_reference:'WO-'+ '1234567890'.repeat(13), serial_number:'SERIAL-'+ 'ABCDEFGH'.repeat(8), location:'North production cell / molding department' }, expectedPages: 1 },
  { name: 'empty-optional', changes: { brand:'',model:'',serial_number:'',location:' N/A ',work_order_reference:'' }, expectedPages: 1 },
  { name: 'unicode-formatting', changes: { body:'**Bold inspection** at 650°F ± 5°F.\n\n*Italic note*, ***bold italic*** and `M47`.\nCafé, José, Renée, Müller. 25 µm × 2.\nA literal temperature already stored as 650?F remains 650?F.\nUnmatched ** markers remain visible.\nUnsupported glyph: 漢.', resolution_summary:'__Verified repair__\nParagraph one.\n\nParagraph two with • bullet and 90° angle.' }, expectedPages: 1 },
  { name: 'heading-boundary', changes: { body: Array.from({length:25},(_,i)=>`Inspection line ${i+1}: assembly checked.`).join('\n'), resolution_summary:paragraph.repeat(5) }, minPages: 2 },
  { name: 'literal-identifiers', changes: { body:'Part BRG_6205_C3, sensor SENSOR_A_B and file maintenance_record_47.pdf.\nDouble BRG__6205__C3 and accented é_SENSOR_A_B.\nCompact formula:3*4*5. Spaced formula:3 * 4 * 5.\n**Bold inspection**, _italic note_ and __verified repair__ remain formatted.', resolution_summary:'Replaced BRG_6205_C3; verified SENSOR_A_B at 3*4*5 cycles.' }, updates:[{created_at:'2026-10-23T12:00:00Z',created_by_name:'Synthetic Technician',body:'',entries:[{work_date:'2026-10-23',labor_hours:.25,body:'Installed BRG__6205__C3 and checked SENSOR_A_B.'}],attachments:[]}], expectedPages: 1 },
];

for (const fixture of cases) test(`maintenance PDF: ${fixture.name}`, async ({}, info) => {
  const technicians = fixture.technicians ?? [technician];
  const data = { note: { ...note, ...fixture.changes }, technicians, totalHours:technicians.reduce((sum,item)=>sum+item.hours,0), updates: fixture.updates ?? [], generatedAt: new Date('2026-10-23T17:00:00Z') };
  const before = JSON.stringify(data);
  const {pdf,addFooters} = await createAssetMaintenanceRecordPdf(data);
  addFooters();
  const result = await inspect(await pdf.save(), fixture.name, info);
  expect(JSON.stringify(data)).toBe(before);
  if (fixture.expectedPages) expect(result.pages.length).toBe(fixture.expectedPages);
  if (fixture.minPages) expect(result.pages.length).toBeGreaterThanOrEqual(fixture.minPages);
  checkLayout(result);
  const full = compactText(result);
  expect(full).not.toContain('Press47-Press47');
  expect(full).not.toContain('Opened/NoteDate');
  expect(full).not.toContain('ResolvedBy');
  expect(full).toContain('JoséMartínez');
  expect(full).toContain('Resolved');
  if (fixture.name === 'press-47-short') {
    expect(full).toContain('650°F');
    expect(full).not.toContain('Location');
    const issue = result.pages[0].spans.find(span => span.text.startsWith('Material was leaking'))!;
    expect(issue.origin[1]).toBeLessThan(225); // Meaningful content starts high on the page.
    const first = result.pages[0].spans.find(span => span.text === 'Asset')!;
    const last = result.pages[0].spans.find(span => span.text === 'Recorded labor')!;
    expect(last.origin[1] - first.origin[1]).toBeLessThanOrEqual(108);
  }
  if (fixture.name === 'long-resolution') for(let i=1;i<=15;i++) expect(full).toContain(`Stage${i}.`);
  if (fixture.name === 'many-comments') for(let i=1;i<=10;i++) expect(full).toContain(`Finalreading${i}:650°F.`);
  if (fixture.name === 'long-identifiers') {
    const spans = result.pages[0].spans;
    const top = spans.find(span=>span.text==='Work Order #')!.origin[1];
    const bottom = spans.find(span=>span.text==='Primary technician')!.origin[1];
    // Text extraction interleaves the two metadata columns. Read the work-order
    // value column in visual order when checking a wrapped identifier.
    const workOrder = spans.filter(span=>span.origin[0]>=404 && span.origin[1]>=top && span.origin[1]<bottom).map(span=>span.text).join('');
    expect(workOrder).toBe(data.note.work_order_reference);
    expect(full).toContain(data.note.title.replace(/\s/g,''));
  }
  if (fixture.name === 'multiple-technicians') for(const tech of technicians) expect(full).toContain(tech.displayName.replace(/\s/g,''));
  if (fixture.name === 'literal-identifiers') {
    for (const value of ['BRG_6205_C3','SENSOR_A_B','maintenance_record_47.pdf','BRG__6205__C3','é_SENSOR_A_B','Compactformula:3*4*5','Spacedformula:3*4*5']) expect(full).toContain(value);
    expect(full).toContain('InstalledBRG__6205__C3andcheckedSENSOR_A_B.');
    expect(full).toContain('ReplacedBRG_6205_C3;verifiedSENSOR_A_Bat3*4*5cycles.');
    const spans=result.pages.flatMap(page=>page.spans);
    expect(spans.find(span=>span.text.includes('Bold inspection'))?.font).toBe('Helvetica-Bold');
    expect(spans.find(span=>span.text.includes('italic note'))?.font).toBe('Helvetica-Oblique');
    expect(spans.find(span=>span.text.includes('verified repair'))?.font).toBe('Helvetica-Bold');
  }
  if (fixture.name === 'unicode-formatting') {
    const spans = result.pages.flatMap(page=>page.spans);
    expect(spans.find(span => span.text.includes('Bold inspection'))?.font).toBe('Helvetica-Bold');
    expect(spans.find(span => span.text.includes('Italic note'))?.font).toBe('Helvetica-Oblique');
    expect(spans.find(span => span.text.includes('bold italic'))?.font).toBe('Helvetica-BoldOblique');
    expect(full).toContain('650°F±5°F');expect(full).toContain('650?F');expect(full).toContain('25µm×2');
    expect(full).toContain('[U+6F22]');expect(full).toContain('Unmatched**markers');
  }
});

test('maintenance PDF: existing machine/equipment export and captured-page regression', async ({}, info) => {
  test.setTimeout(90_000);
  const log = info.outputPath('export-regression.log');
  const fd = fs.openSync(log,'w');
  try { execFileSync(process.execPath, ['tests/issue-129-asset-notes-api.mjs'], { windowsHide:true, stdio:['ignore',fd,fd] }); }
  finally { fs.closeSync(fd); await info.attach('export regression log',{path:log,contentType:'text/plain'}); }
});
