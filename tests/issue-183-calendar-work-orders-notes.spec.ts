import { expect, type Locator, type Page, test } from '@playwright/test';

type Library = 'machine' | 'equipment';
const asset = {
  id: 183, assetNumber: 'ASSET-183', assetName: 'Calendar Press', equipmentName: 'Calendar Dryer',
  brand: 'MCC', manufacturer: 'MCC', model: '183', serialNumber: 'SN183', machineYear: '2026',
  equipmentYear: '2026', year: '2026', category: 'Dryer', equipmentType: 'Dryer', location: 'North',
  machineType: 'Injection Molding Machine', powerType: 'Electric', setupType: 'Standard Injection',
  screwInstalledDate: '', screwTipInstalledDate: '', barrelInstalledDate: '', barrelEndCapInstalledDate: '',
  department: 'Molding', status: 'active', brandColorHex: '#44D7FF', historyPreview: [],
  criticality: 'high', voltage: '480', phase: '3', amperage: '42', airRequirement: '', waterRequirement: '',
  capacityRating: '500', dimensions: '48', weight: '825', specificationNotes: '',
  createdAt: '2026-10-07T12:00:00Z', updatedAt: '2026-10-07T12:00:00Z',
};

async function openNotes(page: Page, library: Library) {
  const user = { id: 1, fullName: 'Calendar Tester', email: 'calendar@example.com', role: 'Admin', isOwnerAdmin: true, forcePasswordChange: false };
  await page.route('**/api/auth/status', route => route.fulfill({ json: { setupRequired: false, user } }));
  const base = `/api/${library}-library`;
  await page.route(new RegExp(`${base}/assets(?:\\?.*)?$`), route => route.fulfill({ json: {
    ok: true, assets: [asset], categories: ['Dryer'], brandSettings: [], permissions: { canEdit: true, canDelete: true },
  } }));
  await page.route(new RegExp(`${base}/assets/183/(history|component-images|inspection-records|document-folders|documents)$`),
    route => route.fulfill({ json: { ok: true, records: [], images: [], folders: [], documents: [] } }));
  await page.route(new RegExp(`${base}/assets/183/preventive-maintenance$`), route => route.fulfill({ json: {
    ok: true, tasks: [], summary: { total: 0, dueSoon: 0, overdue: 0, nextDueDate: null, nextDueMeter: null },
  } }));
  await page.route(new RegExp(`${base}/asset-note-technicians(?:\\?.*)?$`), route => route.fulfill({ json: {
    ok: true, technicians: [{ ...user, isCurrentUser: true }],
  } }));
  await page.route(new RegExp(`${base}/assets/183/notes$`), route => route.fulfill({ json: {
    ok: true, currentUser: user, permissions: { canCreate: true, canExportWorkOrderRecords: true },
    notes: [{ id: 1831, assetId: 183, title: 'Calendar service record', noteDate: '2026-09-15',
      body: 'Bearing service.', warning: true, hold: true, status: 'active', workOrder: 'WO-183',
      createdBy: user.fullName, createdByUserId: 1, createdAt: '2026-09-15T12:00:00Z', updatedAt: '2026-09-15T12:00:00Z',
      pdfFilename: 'service.pdf', pdfUrl: `${base}/asset-notes/1831/pdf`, pdfDownloadUrl: `${base}/asset-notes/1831/pdf?download=true`,
      attachments: [], updates: [], lifecycle: [], labor: [],
      permissions: { canEdit: true, canDelete: true, canResolve: true, canReopen: false, canAddUpdate: true, canDeleteAttachments: true },
    }],
  } }));
  await page.goto(`/${library}-library?asset=183`);
  await page.getByRole('button', { name: /^Work Orders & Notes/ }).click();
}

async function expectPill(button: Locator) {
  await expect(button).toBeVisible();
  const metrics = await button.evaluate(element => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const range = document.createRange(); range.selectNodeContents(element);
    return { width: box.width, height: box.height, radius: parseFloat(style.borderRadius),
      contentWidth: range.getBoundingClientRect().width, parentWidth: element.parentElement!.clientWidth };
  });
  expect(metrics.height).toBeGreaterThanOrEqual(44);
  expect(metrics.width).toBeGreaterThanOrEqual(44);
  expect(metrics.radius).toBeGreaterThanOrEqual(20);
  expect(metrics.width - metrics.contentWidth).toBeLessThanOrEqual(55);
}

for (const library of ['machine', 'equipment'] as const) {
  test(`${library} selected-day calendar preserves parsing, keyboard, focus and Escape`, async ({ page }) => {
    await openNotes(page, library);
    await page.getByRole('button', { name: 'Add Note', exact: true }).click();
    const editor = page.locator('.asset-note-form');
    const date = editor.getByLabel('Note Date *', { exact: true });
    const trigger = editor.getByRole('button', { name: /^Open Note Date calendar/ });
    const day = trigger.locator('.mcc-date-icon-day');
    await date.fill('2026-09-15');
    await expect(day).toHaveText('15');
    await expect(trigger).toHaveAttribute('aria-label', 'Open Note Date calendar — selected September 15, 2026');
    await expect(trigger).toHaveAttribute('title', 'Open Note Date calendar — selected September 15, 2026');
    // Move from the editable date to the trigger using the keyboard.
    await date.focus(); await page.keyboard.press('Tab');
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveCSS('outline-width', '2px');
    await expect(trigger).toHaveCSS('outline-style', 'solid');
    await expectPill(trigger);
    await page.keyboard.press('Enter');
    const calendar = page.getByRole('dialog', { name: 'Note Date * calendar', exact: true });
    await expect(calendar).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(calendar).toHaveCount(0); await expect(trigger).toBeFocused();
    await expect(editor).toBeVisible();
    await trigger.press('Space'); await expect(calendar).toBeVisible();
    await calendar.locator('[data-mcc-calendar-date="2026-09-23"]').click();
    await expect(date).toHaveValue('09/23/2026'); await expect(day).toHaveText('23');
    await expect(trigger).toHaveAttribute('title', /September 23, 2026/);
    await expect(trigger).toBeFocused();
    await date.fill('02/30/2026');
    await expect(date).toHaveAttribute('aria-invalid', 'true');
    await expect(day).toHaveText('—'); await expect(trigger).toHaveAttribute('title', /enter a valid date/);
    await date.fill(''); await expect(day).toHaveText('—');
    await expect(trigger).toHaveAttribute('title', /no date selected/);
    await date.fill('2026-09-15'); await trigger.press('ArrowDown');
    await expect(calendar.locator('[data-mcc-calendar-date="2026-09-15"]')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(calendar.locator('[data-mcc-calendar-date="2026-09-16"]')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(day).toHaveText('16'); await expect(trigger).toBeFocused();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(trigger).toHaveCSS('transition-duration', '0s');
    await expect(editor.getByRole('checkbox', { name: /Needs Attention/ })).toBeVisible();
    await expect(editor.getByRole('checkbox', { name: /Put on Hold/ })).toBeVisible();
  });

  test(`${library} compact actions and editor fit desktop, tablet, mobile and narrow screens`, async ({ page }, testInfo) => {
    await openNotes(page, library);
    for (const width of [1440, 820, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expectPill(page.getByRole('button', { name: 'Add Note', exact: true }));
      await expectPill(page.getByRole('button', { name: 'Export Work Order Records', exact: true }));
      await expectPill(page.getByRole('button', { name: /Work Order History/ }));
      await page.getByRole('button', { name: 'Add Note', exact: true }).click();
      const editor = page.locator('.asset-note-form');
      await expect(editor.locator('.asset-note-editor-banner')).toHaveText('Create maintenance record');
      await expect(editor.locator('.asset-note-editor-banner span')).toHaveCount(0);
      await expect(editor).not.toContainText(/NEW RECORD|EDITING/);
      const attention = editor.getByRole('checkbox', { name: /Needs Attention/ });
      const hold = editor.getByRole('checkbox', { name: /Put on Hold/ });
      await expect(hold).toBeDisabled(); await attention.check(); await hold.check();
      await expect(hold).toBeChecked();
      await attention.uncheck(); await expect(hold).not.toBeChecked(); await expect(hold).toBeDisabled();
      for (const name of ['Save Note', 'Cancel', 'Add Attachments', 'Take Work Order Photo']) {
        await expectPill(editor.getByRole('button', { name, exact: true }));
      }
      const geometry = await editor.evaluate(element => ({ overflow: element.scrollWidth - element.clientWidth,
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
      expect(geometry.overflow).toBeLessThanOrEqual(1); expect(geometry.pageOverflow).toBeLessThanOrEqual(1);
      const trigger = editor.locator('.mcc-date-trigger'); await trigger.click();
      const calendar = page.locator('.mcc-date-popover');
      const box = await calendar.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      await page.keyboard.press('Escape');
      await editor.screenshot({ path: testInfo.outputPath(`${library}-editor-${width}.png`) });
      await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    }
    // Existing edit mode keeps the heading, locked lifecycle state and hold control.
    const record = page.locator('.asset-note-active-issue-card');
    await record.locator('.asset-note-issue-toggle').click();
    const more = record.getByRole('button', { name: 'More actions for Calendar service record', exact: true });
    await more.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
    await expect(more).toBeInViewport(); await more.click();
    await page.getByRole('menuitem', { name: 'Edit Note', exact: true }).click();
    const editor = page.locator('.asset-note-form.is-editing');
    await expect(editor.locator('.asset-note-editor-banner')).toHaveText('Update maintenance record');
    await expect(editor.locator('.asset-note-editor-banner span')).toHaveCount(0);
    await expect(editor.getByRole('status', { name: 'Needs Attention active and lifecycle locked' })).toBeVisible();
    await expect(editor.getByRole('checkbox', { name: /Put on Hold/ })).toBeChecked();
    await expect(editor.locator('.mcc-date-icon-day')).toHaveText('15');
  });
}
