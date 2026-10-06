import { expect, test } from '@playwright/test';

const machine = { screwInstalledDate:'',screwTipInstalledDate:'',barrelInstalledDate:'',barrelEndCapInstalledDate:'', id: 13801, assetNumber: 'Press 138', assetName: 'North Press', brand: 'Toyo', model: 'SI-250', serialNumber: 'T-138', machineYear: '2020', location: 'North', department: 'Molding', status: 'active', pmSummary: { total: 0, status: 'current', label: 'PM: Current' }, historyPreview: [] };
const equipment = { id: 13802, assetNumber: 'EQ-138', equipmentName: 'North Dryer', assetName: 'North Dryer', category: 'Dryer', equipmentType: 'Dryer', manufacturer: 'Matsui', brand: 'Matsui', model: 'MJ5', serialNumber: 'D-138', equipmentYear: '2020', year: '2020', location: 'North', department: 'Molding', status: 'active', criticality: 'high', powerType: 'Electric', voltage: '480', phase: '3', amperage: '42', airRequirement: '', waterRequirement: '', capacityRating: '500', dimensions: '48', weight: '825', specificationNotes: '', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };

for (const item of [
  { name: 'Machine', path: '/machine-library', card: '.machine-asset-card', detail: '.machine-detail-heading', asset: machine },
  { name: 'Equipment', path: '/equipment-library', card: '.equipment-asset-card', detail: '.equipment-detail-header', asset: equipment },
] as const) {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    test(`${item.name} title returns from detail at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.route('**/api/auth/status', route => route.fulfill({ json: { setupRequired: false, user: { id: 1, fullName: 'QA', email: 'qa@example.com', role: 'Admin', isOwnerAdmin: true, forcePasswordChange: false } } }));
      await page.route(new RegExp(`/api/${item.name.toLowerCase()}-library/assets(?:\\?.*)?$`), route => route.fulfill({ json: { ok: true, assets: [item.asset], categories: ['Dryer'], brandSettings: [], permissions: { canEdit: true, canDelete: true, canManagePm: true } } }));
      await page.route(new RegExp(`/api/${item.name.toLowerCase()}-library/assets/\\d+/history$`), route => route.fulfill({ json: { records: [] } }));
      await page.goto(item.path);
      await expect(page.locator(item.card)).toHaveCount(1);
      await page.locator(item.card).click();
      await expect(page.locator(item.detail)).toBeVisible();
      const title = page.getByRole('button', { name: `Back to ${item.name} Library` });
      await expect(title).toBeVisible();
      await page.locator(item.detail).evaluate(element => { (element as HTMLElement).style.minHeight = '1800px'; });
      await page.evaluate(() => window.scrollTo(0, 900));
      await expect(title).toBeInViewport();
      await page.getByRole('button', { name: `About ${item.name} Library` }).click();
      await expect(page.locator(item.detail)).toBeVisible();
      await page.getByRole('button', { name: 'Open command menu' }).click();
      await expect(page.getByRole('button', { name: 'Close command menu' })).toBeVisible();
      await page.getByRole('button', { name: 'Close command menu' }).click();
      if (testInfo.project.name === 'mobile-chromium') await title.tap();
      else { await title.focus(); await expect(title).toBeFocused(); await page.keyboard.press('Enter'); }
      await expect(page.locator(item.card)).toHaveCount(1);
      await expect(title).toHaveCount(0);
      await page.locator(item.card).click();
      if (item.name === 'Machine') await page.locator('.machine-detail-heading').getByRole('button', { name: 'Close' }).click();
      else await page.locator('.asset-detail-back').click();
      await expect(page.locator(item.card)).toHaveCount(1);
    });
  }
}

test('Equipment title and Back protect unsaved edits', async ({ page }) => {
  await page.route('**/api/auth/status', route => route.fulfill({ json: { setupRequired: false, user: { id: 1, fullName: 'QA', email: 'qa@example.com', role: 'Admin', isOwnerAdmin: true } } }));
  await page.route('**/api/equipment-library/assets', route => route.fulfill({ json: { ok: true, assets: [equipment], categories: ['Dryer'], permissions: { canEdit: true, canDelete: true, canManagePm: true } } }));
  await page.route('**/api/equipment-library/assets/13802/history', route => route.fulfill({ json: { records: [] } }));
  await page.goto('/equipment-library');
  await page.locator('.equipment-asset-card').click();
  await page.getByRole('button', { name: 'Edit Mode' }).first().click();
  await page.getByLabel('Equipment Name').fill('Changed dryer');
  const title = page.getByRole('button', { name: 'Back to Equipment Library' });
  page.once('dialog', async dialog => { expect(dialog.message()).toContain('Discard unsaved'); await dialog.dismiss(); });
  await title.focus();
  await page.keyboard.press('Space');
  await expect(page.locator('.equipment-detail-header')).toBeVisible();
  page.once('dialog', async dialog => { await dialog.dismiss(); });
  await page.locator('.asset-detail-back').click();
  await expect(page.locator('.equipment-detail-header')).toBeVisible();
  page.once('dialog', async dialog => { await dialog.accept(); });
  await title.click();
  await expect(page.locator('.equipment-asset-card')).toHaveCount(1);
});
