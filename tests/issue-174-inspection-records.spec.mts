import { expect, type Locator, type Page, type TestInfo, test } from '@playwright/test';
import fs from 'node:fs';
import { PDFDocument } from '../backend/node_modules/pdf-lib/cjs/index.js';
import { owner, request } from './helpers/security-process.mjs';
import { inspectionFixture } from './helpers/inspection-records-fixture.mjs';

const year = new Date().getFullYear();
const previous = String(year - 1);
const older = String(year - 2);
const asset = {
  ...Object.fromEntries(['screwType', 'screwTipType', 'screwInstalledDate', 'screwTipInstalledDate', 'barrelInstalledDate',
    'barrelEndCapInstalledDate', 'screwLength', 'barrelLength', 'screw2InstalledDate', 'screw2TipInstalledDate',
    'barrel2InstalledDate', 'barrel2EndCapInstalledDate', 'plungerInstalledDate', 'plungerBarrelInstalledDate',
    'plungerBarrelEndCapInstalledDate', 'notes', 'criticalNotes'].map(key => [key, ''])),
  id: 174, assetNumber: 'PROTECT-174', assetName: 'Inspection Test Press', brand: 'MCC', model: 'Test', serialNumber: 'LOCAL-174',
  machineYear: '2020', machineType: 'Injection Molding Machine', powerType: 'Electric', setupType: 'Standard Injection',
  shotSizeOz: 12, tonnage: 300, barrelDiameter: '40 mm', status: 'active', location: 'Disposable Test Cell', department: 'Test',
  screwConditionStatus: 'used', barrelConditionStatus: 'used', hasDoubleShotInjection: false, hasPlungerInjection: false,
  createdAt: `${previous}-01-01T12:00:00Z`, updatedAt: `${previous}-01-01T12:00:00Z`, historyPreview: [], pmSummary: null,
};
function record(id: number, recordYear: string, assetId = 174) {
  return { id: `server-${id}`, serverId: id, storage: 'server', name: `Inspection-${id}.pdf`, size: 1024,
    type: 'application/pdf', uploadedAt: `${recordYear}-06-01T12:00:00Z`, recordDate: `${recordYear}-06-01`, year: recordYear,
    assetId: String(assetId), assetNumber: assetId === 174 ? 'PROTECT-174' : 'OTHER-175', hasStoredFile: true,
    contentUrl: `/api/machine-library/inspection-records/${id}/file`, downloadUrl: `/api/machine-library/inspection-records/${id}/file?download=true` };
}
const records = [record(1, String(year)), record(2, previous), record(3, previous, 175), record(4, older)];

function observe(page: Page) {
  const errors: string[] = [], failures: string[] = [], httpErrors: string[] = [], deletes: string[] = [], dialogs: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('requestfailed', req => failures.push(`${req.method()} ${req.url()} ${req.failure()?.errorText}`));
  page.on('response', res => { if (res.status() >= 400) httpErrors.push(`${res.status()} ${res.url()}`); });
  page.on('request', req => { if (req.method() === 'DELETE') deletes.push(req.url()); });
  page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  return { errors, failures, httpErrors, deletes, dialogs };
}
async function activate(button: Locator, mobile: boolean) {
  if (mobile) await button.tap();
  else { await button.focus(); await button.press('Enter'); }
}
async function expectProtectedYears(panel: Locator) {
  const folders = panel.locator('.measurement-folder-row');
  await expect(folders.getByRole('button', { name: /delete|remove|^x$/i })).toHaveCount(0);
  const wrappers = folders.locator('.measurement-folder-pill-wrap');
  expect(await wrappers.count()).toBeGreaterThan(0);
  for (const wrapper of await wrappers.all()) await expect(wrapper.getByRole('button')).toHaveCount(1);
}
async function review(page: Page, panel: Locator, observations: ReturnType<typeof observe>, testInfo: TestInfo) {
  await expectProtectedYears(panel);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  expect(observations.errors).toEqual([]);
  expect(observations.failures).toEqual([]);
  expect(observations.httpErrors).toEqual([]);
  await testInfo.attach('browser-observations.json', { body: JSON.stringify(observations, null, 2), contentType: 'application/json' });
}

for (const role of ['Maintenance Tech 1', 'Maintenance Tech 2', 'Maintenance Tech 3', 'Manager', 'Admin', 'Owner Admin']) {
  test(`${role}: global and machine years only navigate and preserve records`, async ({ page, isMobile }, testInfo) => {
    const observations = observe(page);
    await page.route('**/api/**', route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/api/auth/status') return route.fulfill({ json: { setupRequired: false, user: {
        id: 1, fullName: 'Inspection Tester', email: 'inspection@example.test', role: role === 'Owner Admin' ? 'Admin' : role,
        isOwnerAdmin: role === 'Owner Admin', forcePasswordChange: false,
      } } });
      if (pathname === '/api/machine-library/assets') return route.fulfill({ json: { ok: true, assets: [asset], brandSettings: [],
        permissions: { canEdit: false, canDelete: false, canManagePm: false } } });
      if (pathname.endsWith('/inspection-records')) return route.fulfill({ json: { ok: true,
        records: pathname.includes('/assets/') ? records.filter(item => item.assetId === '174') : records } });
      return route.fulfill({ json: { ok: true, records: [], notes: [], images: [], folders: [], documents: [], tasks: [], summary: {} } });
    });
    // Include a legacy browser record: grouping it must never erase local data.
    await page.addInitScript(({ recordYear }) => localStorage.setItem('mcc:screw-barrel-inspection-records:v3', JSON.stringify([
      { id: 'legacy-174', name: 'Legacy-inspection.txt', assetId: '174', assetNumber: 'PROTECT-174', storage: 'browser',
        uploadedAt: `${recordYear}-02-01T12:00:00Z`, recordDate: `${recordYear}-02-01`, size: 10, type: 'text/plain', hasStoredFile: false },
    ])), { recordYear: older });
    await page.goto('/machine-library');
    await expect(page.locator('.machine-asset-card')).toHaveCount(1);
    const legacyBefore = await page.evaluate(() => localStorage.getItem('mcc:screw-barrel-inspection-records:v3'));
    await activate(page.getByRole('button', { name: 'Machine Library tools', exact: true }), isMobile);
    await activate(page.getByRole('menuitem', { name: /Measurement Inspection Logs/ }), isMobile);
    let panel = page.locator('.measurement-records-panel');
    await expect(panel.getByText('Global Screw & Barrel Inspection Records', { exact: true })).toBeVisible();
    await expect(panel.locator('.measurement-year-folder')).toHaveCount(3);
    await expectProtectedYears(panel);
    await activate(panel.locator('.measurement-year-folder').filter({ hasText: previous }), isMobile);
    await expect(panel.locator('.measurement-record-row')).toHaveCount(2);
    await expect(panel.getByText('OTHER-175', { exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Delete Selected', exact: true })).toBeDisabled();
    await expectProtectedYears(panel);
    if (role === 'Owner Admin') await page.screenshot({ path: testInfo.outputPath('global-years.png'), fullPage: !isMobile });
    await panel.locator('.measurement-record-row').first().getByRole('button', { name: 'Open', exact: true }).scrollIntoViewIfNeeded();
    await expect(panel.locator('.measurement-record-row').first().getByRole('button', { name: 'Open', exact: true })).toBeInViewport();
    if (role === 'Owner Admin') await page.screenshot({ path: testInfo.outputPath('global-records.png'), fullPage: !isMobile });
    await activate(panel.getByRole('button', { name: 'Back to Folders' }), isMobile);
    await activate(panel.locator('.measurement-year-folder').filter({ hasText: older }), isMobile);
    await expect(panel.locator('.measurement-record-row')).toHaveCount(2);
    await expect(panel.locator('.measurement-record-filename').filter({ hasText: 'Legacy-inspection.txt' })).toBeVisible();
    await review(page, panel, observations, testInfo);
    await page.keyboard.press('Escape');
    await expect(page.locator('.measurement-records-panel')).toHaveCount(0);
    await page.locator('.machine-asset-card .machine-card-brand-name').click();
    await page.locator('.machine-detail-header-actions').getByRole('button', { name: 'Barrel & Screw Logs', exact: true }).click();
    panel = page.locator('.measurement-record-modal .measurement-records-panel');
    await expect(panel.locator('.measurement-record-filename').filter({ hasText: 'Inspection-1.pdf' })).toBeVisible();
    await activate(panel.locator('.measurement-year-folder').filter({ hasText: previous }), isMobile);
    await expect(panel.locator('.measurement-record-row')).toHaveCount(1);
    await expect(panel.locator('.measurement-record-filename').filter({ hasText: 'Inspection-2.pdf' })).toBeVisible();
    await expect(panel.getByText('OTHER-175', { exact: true })).toHaveCount(0);
    if (role === 'Owner Admin') await page.screenshot({ path: testInfo.outputPath('machine-years.png'), fullPage: !isMobile });
    await panel.locator('.measurement-record-row').getByRole('button', { name: 'Open', exact: true }).scrollIntoViewIfNeeded();
    await expect(panel.locator('.measurement-record-row').getByRole('button', { name: 'Open', exact: true })).toBeInViewport();
    if (role === 'Owner Admin') await page.screenshot({ path: testInfo.outputPath('machine-records.png'), fullPage: !isMobile });
    await activate(panel.locator('.measurement-year-folder').filter({ hasText: older }), isMobile);
    await expect(panel.locator('.measurement-record-row')).toHaveCount(2);
    await activate(panel.locator('.measurement-year-folder').filter({ hasText: String(year) }), isMobile);
    await expect(panel.locator('.measurement-record-row')).toHaveCount(1);
    if (!isMobile) {
      await panel.locator('.measurement-year-folder').filter({ hasText: String(year) }).focus();
      await page.keyboard.press('Tab');
      await expect(panel.locator('.measurement-year-folder').filter({ hasText: previous })).toBeFocused();
    }
    await review(page, panel, observations, testInfo);
    expect(await page.evaluate(() => localStorage.getItem('mcc:screw-barrel-inspection-records:v3'))).toBe(legacyBefore);
    expect(observations.deletes).toEqual([]);
    expect(observations.dialogs).toEqual([]);
  });
}

test('real inspection uploads, viewing, download, printing and selected-record deletion still work', async ({ page, context, isMobile }, testInfo) => {
  const runtime = await inspectionFixture('issue-174-browser', { serveFrontend: true });
  const observations = observe(page);
  try {
    const cookie = await owner(runtime.base);
    const pdf = await PDFDocument.create();
    pdf.addPage([612, 792]).drawText('Issue 174 real browser inspection');
    const bytes = Buffer.from(await pdf.save());
    const created = await request(runtime.base, '/api/machine-library/assets', { method: 'POST', cookie,
      body: { assetNumber: 'BROWSER-174', assetName: 'Protected Browser Press', brand: 'MCC', status: 'active' } });
    expect(created.response.status).toBe(201);
    const assetId = created.data.asset.id;
    const form = new FormData();
    form.append('recordDate', `${year}-01-01`);
    form.append('file', new Blob([bytes], { type: 'application/pdf' }), 'Keep-current.pdf');
    expect((await request(runtime.base, `/api/machine-library/assets/${assetId}/inspection-records`, { method: 'POST', cookie, body: form })).response.status).toBe(201);
    const split = cookie.indexOf('=');
    await context.addCookies([{ name: cookie.slice(0, split), value: cookie.slice(split + 1), url: runtime.base, httpOnly: true, sameSite: 'Lax' }]);
    await page.addInitScript(() => {
      const originalOpen = window.open.bind(window);
      window.open = ((...args: Parameters<typeof window.open>) => {
        (window as unknown as { lastInspectionOpen: string }).lastInspectionOpen = String(args[0]);
        return originalOpen(...args);
      }) as typeof window.open;
    });
    await page.goto(`${runtime.base}/machine-library`);
    await page.locator('.machine-asset-card .machine-card-brand-name').click();
    const detail = page.locator('.machine-detail-modal');
    await detail.locator('.machine-detail-header-actions').getByRole('button', { name: 'Barrel & Screw Logs' }).click();
    let panel = page.locator('.measurement-record-modal .measurement-records-panel');
    await expect(panel.locator('.measurement-record-filename').filter({ hasText: 'Keep-current.pdf' })).toBeVisible();
    const upload = page.waitForResponse(res => res.request().method() === 'POST' && res.url().endsWith('/inspection-records'));
    await panel.locator('input[type="file"][multiple]').setInputFiles({ name: 'New-inspection.pdf', mimeType: 'application/pdf', buffer: bytes });
    expect((await upload).status()).toBe(201);
    await expect(panel.locator('.measurement-record-row')).toHaveCount(2);
    const newRow = panel.locator('.measurement-record-row').filter({ hasText: 'New-inspection.pdf' });
    const fileResponse = page.waitForResponse(res => res.url().includes('/inspection-records/') && res.url().includes('/file'));
    let popupReady = page.waitForEvent('popup');
    await newRow.getByRole('button', { name: 'Open', exact: true }).click();
    expect((await fileResponse).status()).toBe(200);
    await (await popupReady).close();
    await newRow.getByRole('checkbox').check();
    for (const [action, count] of [['Print Selected', 1], ['Print Folder PDF', 2]] as const) {
      const combined = page.waitForResponse(res => res.url().endsWith('/measurement-records/combined-pdf'));
      popupReady = page.waitForEvent('popup');
      await panel.getByRole('button', { name: action, exact: true }).click();
      const response = await combined;
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toBe('application/pdf');
      const printed = await popupReady;
      // Inspect the actual blob passed to the native popup. Chromium's PDF
      // viewer can obscure both its popup URL and debugging response body.
      const openedUrl = await page.evaluate(() => (window as unknown as { lastInspectionOpen: string }).lastInspectionOpen);
      expect(openedUrl).toMatch(/^blob:/);
      const openedBytes = await page.evaluate(async url => Array.from(new Uint8Array(await (await fetch(url)).arrayBuffer())), openedUrl);
      expect((await PDFDocument.load(new Uint8Array(openedBytes))).getPageCount()).toBe(count);
      await printed.close();
    }
    await expectProtectedYears(panel);
    await page.locator('.measurement-record-modal').getByRole('button', { name: 'Close', exact: true }).click();
    await detail.locator('.machine-record-accordion-header').click();
    await detail.locator('.machine-record-newest-preview').click();
    const viewer = page.getByRole('dialog', { name: 'New-inspection.pdf viewer' });
    await expect(viewer.getByRole('button', { name: 'Download', exact: true })).toBeEnabled();
    const downloadReady = page.waitForEvent('download');
    await viewer.getByRole('button', { name: 'Download', exact: true }).click();
    const download = await downloadReady;
    expect(download.suggestedFilename()).toBe('New-inspection.pdf');
    expect(fs.readFileSync((await download.path())!)).toEqual(bytes);
    await page.keyboard.press('Escape');
    await expect(viewer).toHaveCount(0);
    await detail.locator('.machine-detail-header-actions').getByRole('button', { name: 'Barrel & Screw Logs' }).click();
    panel = page.locator('.measurement-record-modal .measurement-records-panel');
    await expect(panel.locator('.measurement-record-row')).toHaveCount(2);
    expect(observations.deletes).toEqual([]);
    // The unchanged noopener callers display these alerts even when the native
    // popup opens. Verify the existing messages and real PDF output explicitly.
    expect(observations.dialogs).toEqual([
      'Popup blocked. Allow popups for MCC to open this record.',
      'Popup blocked. Allow popups for MCC to open the combined PDF.',
      'Popup blocked. Allow popups for MCC to open the combined PDF.',
    ]);
    await panel.locator('.measurement-record-row').filter({ hasText: 'New-inspection.pdf' }).getByRole('checkbox').check();
    page.removeAllListeners('dialog');
    page.once('dialog', async dialog => { expect(dialog.message()).toBe('Delete 1 selected record log(s)?'); await dialog.accept(); });
    const deletion = page.waitForResponse(res => res.request().method() === 'DELETE');
    await panel.getByRole('button', { name: 'Delete Selected', exact: true }).click();
    expect((await deletion).status()).toBe(200);
    await expect(panel.locator('.measurement-record-row')).toHaveCount(1);
    await expect(panel.locator('.measurement-record-filename').filter({ hasText: 'Keep-current.pdf' })).toBeVisible();
    expect(observations.deletes).toHaveLength(1);
    const remaining = await request(runtime.base, `/api/machine-library/assets/${assetId}/inspection-records`, { cookie });
    expect(remaining.data.records.map((item: { name: string }) => item.name)).toEqual(['Keep-current.pdf']);
    await activate(panel.locator('.measurement-year-folder').filter({ hasText: String(year) }), isMobile);
    await panel.getByRole('button', { name: 'Open', exact: true }).scrollIntoViewIfNeeded();
    await expect(panel.getByRole('button', { name: 'Open', exact: true })).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath('real-inspection-records.png'), fullPage: !isMobile });
    await review(page, panel, observations, testInfo);
  } finally { await runtime.close(); }
});
