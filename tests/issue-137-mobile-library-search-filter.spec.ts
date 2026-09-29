import { expect, type Page, test } from '@playwright/test';

const machineAssets = [
  { id: 13701, assetNumber: 'Press 137', assetName: 'North Cell Press', brand: 'Toyo', model: 'SI-250', serialNumber: 'TOYO-137', machineYear: '2020', barrelDiameter: '35mm', location: 'North Cell', department: 'Molding', status: 'active', pmSummary: { total: 0, status: 'current', label: 'PM: Current' }, historyPreview: [] },
  { id: 13702, assetNumber: 'Press 138', assetName: 'South Cell Press', brand: 'Engel', model: 'Victory', serialNumber: 'ENGEL-138', machineYear: '2021', barrelDiameter: '40mm', location: 'South Cell', department: 'Molding', status: 'down', pmSummary: { total: 0, status: 'current', label: 'PM: Current' }, historyPreview: [] },
];

const equipmentAssets = [
  { id: 13711, assetNumber: 'EQ-137', equipmentName: 'North Dryer', assetName: 'North Dryer', category: 'Dryer', equipmentType: 'Desiccant Dryer', manufacturer: 'Matsui', brand: 'Matsui', model: 'MJ5-i', serialNumber: 'DRY-137', equipmentYear: '2020', year: '2020', location: 'North Cell', department: 'Molding', status: 'active', criticality: 'high', powerType: 'Electric', voltage: '480 VAC', phase: '3 phase', amperage: '42 A', airRequirement: '90 PSI', waterRequirement: '', capacityRating: '500 lb', dimensions: '48 x 36 x 84 in', weight: '825 lb', specificationNotes: '', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 13712, assetNumber: 'EQ-138', equipmentName: 'South Chiller', assetName: 'South Chiller', category: 'Chiller', equipmentType: 'Process Chiller', manufacturer: 'Advantage', brand: 'Advantage', model: 'MK-7', serialNumber: 'CH-138', equipmentYear: '2021', year: '2021', location: 'South Cell', department: 'Molding', status: 'down', criticality: 'medium', powerType: 'Electric', voltage: '480 VAC', phase: '3 phase', amperage: '35 A', airRequirement: '', waterRequirement: '20 GPM', capacityRating: '7 ton', dimensions: '40 x 32 x 70 in', weight: '700 lb', specificationNotes: '', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
];

async function mockAuth(page: Page) {
  await page.route('**/api/auth/status', route=>route.fulfill({
    json: { setupRequired: false, user: { id: 1, fullName: 'Issue 137 QA', email: 'qa@example.com', role: 'Admin', isOwnerAdmin: true, forcePasswordChange: false } },
  }));
}

async function mockMachineLibrary(page: Page) {
  await mockAuth(page);
  await page.route(/\/api\/machine-library\/assets(?:\?.*)?$/, route=>{
    const url = new URL(route.request().url());
    const query = (url.searchParams.get('q') ?? '').toLowerCase();
    const brand = url.searchParams.get('brand') ?? '';
    const status = url.searchParams.get('status') ?? '';
    const assets = machineAssets.filter(asset=>(!query || [asset.assetNumber, asset.assetName, asset.brand, asset.model, asset.serialNumber].some(value=>value.toLowerCase().includes(query))) && (!brand || asset.brand === brand) && (!status || asset.status === status));
    return route.fulfill({ json: { ok: true, assets, brandSettings: [], permissions: { canEdit: true, canDelete: true, canManagePm: true } } });
  });
}

async function mockEquipmentLibrary(page: Page) {
  await mockAuth(page);
  await page.route(/\/api\/equipment-library\/assets(?:\?.*)?$/, route=>route.fulfill({
    json: { ok: true, assets: equipmentAssets, categories: ['Dryer', 'Chiller'], permissions: { canEdit: true, canDelete: true, canManagePm: true } },
  }));
}

async function expectPhoneLayout(page: Page, route: 'machine-library' | 'equipment-library') {
  const mobileControls = page.locator('.library-mobile-search-filter');
  const toolbar = page.locator(route === 'machine-library' ? '.machine-toolbar-card' : '.equipment-library-toolbar');
  await expect(mobileControls).toBeVisible();
  await expect(mobileControls.getByRole('button', { name: 'Search' })).toHaveAttribute('aria-expanded', 'false');
  await expect(mobileControls.getByRole('searchbox')).toHaveCount(0);
  await expect(mobileControls.getByRole('button', { name: 'Filter' })).toHaveCount(0);
  await expect(mobileControls.getByRole('button')).toHaveCount(1);
  await expect(toolbar.locator('input:not([type="file"])').first()).toBeHidden();
  await expect(toolbar).toBeVisible();
  const shell = page.locator('.library-mobile-fixed-shell');
  await expect(shell).toHaveCSS('position', 'fixed');
  expect(await mobileControls.evaluate(element=>getComputedStyle(element).position)).not.toBe('sticky');
  expect(await shell.evaluate(element=>element.parentElement === document.body)).toBe(true);
  expect(await toolbar.evaluate(element=>getComputedStyle(element).position)).not.toBe('sticky');
  const compactLayout = await mobileControls.evaluate(element=>({
    height: element.getBoundingClientRect().height,
    overflow: document.documentElement.scrollWidth-document.documentElement.clientWidth,
  }));
  expect(compactLayout.height).toBeLessThanOrEqual(70);
  expect(await mobileControls.evaluate(element=>element.getBoundingClientRect().width)).toBeLessThanOrEqual(70);
  expect(compactLayout.overflow).toBeLessThanOrEqual(1);
  const initialGeometry = await page.evaluate(() => ({
    searchBottom: document.querySelector('.library-mobile-search-filter')!.getBoundingClientRect().bottom,
    contentTop: document.querySelector('.machine-toolbar-card, .equipment-library-toolbar')!.getBoundingClientRect().top,
  }));
  expect(initialGeometry.contentTop).toBeGreaterThanOrEqual(initialGeometry.searchBottom + 4);

  await page.locator('.page-stack').evaluate(element=>{ (element as HTMLElement).style.minHeight = '1800px'; });
  await page.evaluate(()=>window.scrollTo(0, 700));
  await expect(mobileControls).toBeInViewport();
  await expect.poll(()=>shell.evaluate(element=>Math.round(element.getBoundingClientRect().top))).toBe(
    await shell.evaluate(element=>Math.round(parseFloat(getComputedStyle(element).top))),
  );
  await page.evaluate(()=>window.scrollTo(0, 0));
}

async function expectWideLayout(page: Page, route: 'machine-library' | 'equipment-library') {
  const mobileControls = page.locator('.library-mobile-search-filter');
  const toolbar = page.locator(route === 'machine-library' ? '.machine-toolbar-card' : '.equipment-library-toolbar');
  await expect(mobileControls).toBeHidden();
  await expect(toolbar.locator('input:not([type="file"])').first()).toBeVisible();
  await expect(toolbar.getByLabel(route === 'machine-library' ? 'Brand' : 'Category')).toBeVisible();
  await expect(toolbar.getByLabel('Status')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

async function expectFilterBelowSearch(page: Page) {
  const positions = await page.evaluate(() => ({
    searchBottom: document.querySelector('.library-mobile-search-filter')!.getBoundingClientRect().bottom,
    filterTop: document.querySelector('.library-mobile-filter-popover')!.getBoundingClientRect().top,
    filterBottom: document.querySelector('.library-mobile-filter-popover')!.getBoundingClientRect().bottom,
    viewportHeight: window.innerHeight,
    filterLeft: document.querySelector('.library-mobile-filter-popover')!.getBoundingClientRect().left,
    filterRight: document.querySelector('.library-mobile-filter-popover')!.getBoundingClientRect().right,
    viewportWidth: window.innerWidth,
  }));
  expect(positions.filterTop).toBeGreaterThanOrEqual(positions.searchBottom);
  expect(positions.filterBottom).toBeLessThanOrEqual(positions.viewportHeight);
  expect(positions.filterLeft).toBeGreaterThanOrEqual(0);
  expect(positions.filterRight).toBeLessThanOrEqual(positions.viewportWidth);
  expect(await page.locator('.library-mobile-filter-popover select').evaluateAll(elements=>elements.every(element=>element.getBoundingClientRect().height>=44))).toBe(true);
}

test.describe('Issue #137 responsive library controls', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'Viewport matrix runs once in desktop Chromium.');
  });

  for (const viewport of [
    { name: 'phone portrait', width: 390, height: 844 },
    { name: 'phone landscape', width: 844, height: 390 },
  ]) {
    test(`${viewport.name} keeps compact Machine Library search and filters usable`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await mockMachineLibrary(page);
      await page.goto('/machine-library');
      await expectPhoneLayout(page, 'machine-library');

      const controls = page.locator('.library-mobile-search-filter');
      const toggle = controls.getByRole('button', { name: 'Search' });
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(controls.getByRole('searchbox')).toBeFocused();
      await expect(controls.getByRole('button', { name: 'Filter' })).toBeVisible();
      await expect(controls.locator('.library-mobile-search-bar').getByRole('button', { name: 'Filter' })).toBeVisible();
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(controls.getByRole('button', { name: 'Filter' })).toHaveCount(0);
      await toggle.click();
      await controls.getByRole('searchbox').fill('Press 138');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(controls.getByRole('searchbox')).toHaveValue('Press 138');
      await expect(page.locator('.machine-asset-card')).toHaveCount(1);
      await expect(page.locator('.machine-asset-card')).toContainText('Press 138');

      await controls.getByRole('button', { name: 'Filter' }).click();
      const toolbar = page.locator('.machine-toolbar-card');
      const panel = page.locator('#machine-library-mobile-filters');
      await expect(panel.getByLabel('Brand')).toBeVisible();
      await expect(panel.getByLabel('Status')).toBeVisible();
      await expect(toolbar.getByLabel('Brand')).toBeHidden();
      await expectFilterBelowSearch(page);
      await controls.getByRole('searchbox').fill('');
      await panel.getByLabel('Brand').selectOption('Toyo');
      await panel.getByLabel('Status').selectOption('active');
      await expect(controls.getByRole('button', { name: 'Filter, 2 active' })).toHaveAttribute('aria-expanded', 'true');
      await expect(page.locator('.machine-asset-card')).toHaveCount(1);
      await expect(page.getByRole('button', { name: 'Add Machine Asset' })).toBeVisible();
      await expect(page.getByRole('button', { name: /tools/i })).toBeVisible();
      await controls.getByRole('button', { name: 'Filter, 2 active' }).click();
      await expect(panel.getByLabel('Brand')).toBeHidden();
      await expect(controls.getByRole('button', { name: 'Filter, 2 active' })).toHaveAttribute('aria-expanded', 'false');
      await controls.getByRole('button', { name: 'Filter, 2 active' }).click();
      await panel.getByLabel('Status').selectOption('');
      await panel.getByLabel('Brand').selectOption('');
      await expect(controls.getByRole('button', { name: 'Filter' })).not.toHaveClass(/has-active-filters/);
      await expect(page.locator('.machine-asset-card')).toHaveCount(2);
      await controls.getByRole('button', { name: 'Filter' }).click();
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(panel.getByLabel('Brand')).toBeHidden();
    });

    test(`${viewport.name} keeps compact Equipment Library search and filters usable`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await mockEquipmentLibrary(page);
      await page.goto('/equipment-library');
      await expectPhoneLayout(page, 'equipment-library');

      const controls = page.locator('.library-mobile-search-filter');
      const toggle = controls.getByRole('button', { name: 'Search' });
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(controls.getByRole('searchbox')).toBeFocused();
      await expect(controls.locator('.library-mobile-search-bar').getByRole('button', { name: 'Filter' })).toBeVisible();
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await toggle.click();
      await controls.getByRole('searchbox').fill('South Chiller');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(controls.getByRole('searchbox')).toHaveValue('South Chiller');
      await expect(page.locator('.equipment-asset-card')).toHaveCount(1);
      await expect(page.locator('.equipment-asset-card')).toContainText('South Chiller');

      await controls.getByRole('button', { name: 'Filter' }).click();
      const toolbar = page.locator('.equipment-library-toolbar');
      const panel = page.locator('#equipment-library-mobile-filters');
      await expect(panel.getByLabel('Category')).toBeVisible();
      await expect(panel.getByLabel('Status')).toBeVisible();
      await expect(toolbar.getByLabel('Category')).toBeHidden();
      await expectFilterBelowSearch(page);
      await controls.getByRole('searchbox').fill('');
      await panel.getByLabel('Category').selectOption('Dryer');
      await panel.getByLabel('Status').selectOption('active');
      await expect(controls.getByRole('button', { name: 'Filter, 2 active' })).toHaveAttribute('aria-expanded', 'true');
      await expect(page.locator('.equipment-asset-card')).toHaveCount(1);
      await expect(page.getByRole('button', { name: 'Add Equipment' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Export CSV' })).toBeVisible();
      await controls.getByRole('button', { name: 'Filter, 2 active' }).click();
      await expect(panel.getByLabel('Category')).toBeHidden();
      await expect(controls.getByRole('button', { name: 'Filter, 2 active' })).toHaveAttribute('aria-expanded', 'false');
      await controls.getByRole('button', { name: 'Filter, 2 active' }).click();
      await panel.getByLabel('Category').selectOption('');
      await panel.getByLabel('Status').selectOption('');
      await expect(controls.getByRole('button', { name: 'Filter' })).not.toHaveClass(/has-active-filters/);
      await expect(page.locator('.equipment-asset-card')).toHaveCount(2);
      await controls.getByRole('button', { name: 'Filter' }).click();
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(panel.getByLabel('Category')).toBeHidden();
    });
  }

  for (const viewport of [
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'desktop', width: 1440, height: 900 },
  ]) {
    test(`${viewport.name} retains existing Machine and Equipment Library toolbars`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await mockMachineLibrary(page);
      await page.goto('/machine-library');
      await expectWideLayout(page, 'machine-library');
      await expect(page.getByRole('button', { name: 'Add Machine Asset' })).toBeVisible();
      await expect(page.getByRole('button', { name: /tools/i })).toBeVisible();

      await mockEquipmentLibrary(page);
      await page.goto('/equipment-library');
      await expectWideLayout(page, 'equipment-library');
      await expect(page.getByRole('button', { name: 'Add Equipment' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Export CSV' })).toBeVisible();
    });
  }
});

async function expectUncoveredControls(page: Page, expanded: boolean) {
  const result = await page.evaluate(() => {
    const shell = document.querySelector('.library-mobile-fixed-shell')!;
    const controls = document.querySelector('.library-mobile-search-filter')!;
    const toggle = controls.querySelector('.library-mobile-search-toggle')!;
    const search = controls.querySelector('input[type="search"]');
    const filter = controls.querySelector('.library-mobile-filter-toggle');
    const header = document.querySelector('.mcc-page-topbar')!;
    const command = document.querySelector('.command-launcher')!;
    const box = (element: Element) => element.getBoundingClientRect();
    const targets = [toggle, search, filter].filter((target): target is Element => Boolean(target));
    return {
      top: box(controls).top,
      offset: parseFloat(getComputedStyle(shell).top),
      headerBottom: Math.max(box(header).bottom, box(command).bottom),
      widths: targets.map(target => box(target).width),
      heights: targets.map(target => box(target).height),
      hits: targets.map(target => {
        const rect = box(target);
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return hit === target || target.contains(hit);
      }),
    };
  });
  expect(result.top).toBeGreaterThanOrEqual(result.headerBottom + 3);
  expect(result.top).toBeGreaterThanOrEqual(result.offset - 1);
  expect(result.hits).toEqual(expanded ? [true, true, true] : [true]);
  expect(result.heights.every(height => height >= 44)).toBe(true);
  expect(result.widths.every(width => width >= 44)).toBe(true);
}

test.describe('Issue #155 fixed mobile search and #150 header hit targets', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'Touch interactions run in mobile Chromium.');
  });

  for (const viewport of [
    { name: 'iPhone portrait', width: 390, height: 844 },
    { name: 'narrow landscape', width: 844, height: 390 },
  ]) {
    for (const library of [
      { name: 'Machine', path: '/machine-library', query: 'Press 138', card: '.machine-asset-card', mock: mockMachineLibrary },
      { name: 'Equipment', path: '/equipment-library', query: 'South Chiller', card: '.equipment-asset-card', mock: mockEquipmentLibrary },
    ]) {
      test(`${viewport.name} ${library.name} Library keeps Search, Filter, and Menu tappable before and after scrolling`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await library.mock(page);
        await page.goto(library.path);
        const controls = page.locator('.library-mobile-search-filter');
        const toggle = controls.getByRole('button', { name: 'Search' });
        const menu = page.getByRole('button', { name: 'Open command menu' });
        const shell = page.locator('.library-mobile-fixed-shell');
        await expect(shell).toHaveCSS('position', 'fixed');
        await expect(controls).not.toHaveCSS('position', 'sticky');
        await expect(page.locator(library.card)).toHaveCount(2);
        await expectUncoveredControls(page, false);
        await toggle.tap();
        const search = controls.getByRole('searchbox');
        const filter = controls.getByRole('button', { name: 'Filter' });
        await expect(search).toBeFocused();
        await expectUncoveredControls(page, true);
        await search.fill(library.query);
        await expect(page.locator(library.card)).toHaveCount(1);
        await filter.tap();
        await expect(filter).toHaveAttribute('aria-expanded', 'true');
        await filter.tap();
        await expect(filter).toHaveAttribute('aria-expanded', 'false');
        await menu.tap();
        await expect(page.getByRole('button', { name: 'Close command menu' })).toBeVisible();
        await page.getByRole('button', { name: 'Close command menu' }).tap();

        await page.locator('.page-stack').evaluate(element => { (element as HTMLElement).style.minHeight = '2200px'; });
        await page.evaluate(() => window.scrollTo(0, 700));
        await expect.poll(() => shell.evaluate(element => Math.round(element.getBoundingClientRect().top))).toBe(
          await shell.evaluate(element => Math.round(parseFloat(getComputedStyle(element).top))),
        );
        await filter.tap();
        await expect(filter).toHaveAttribute('aria-expanded', 'true');
        await expectFilterBelowSearch(page);
        const fixedTop = await controls.evaluate(element => element.getBoundingClientRect().top);
        const panelTop = await page.locator('.library-mobile-filter-popover').evaluate(element => element.getBoundingClientRect().top);
        for (const scrollY of [1050, 500, 900, 700]) {
          await page.evaluate(y => window.scrollTo(0, y), scrollY);
          await expect.poll(() => controls.evaluate(element => element.getBoundingClientRect().top)).toBe(fixedTop);
          await expect.poll(() => page.locator('.library-mobile-filter-popover').evaluate(element => element.getBoundingClientRect().top)).toBe(panelTop);
          await expectUncoveredControls(page, true);
        }
        await filter.tap();
        await search.tap();
        await search.fill('no matching asset');
        await expect(page.locator(library.card)).toHaveCount(0);
        await search.fill(library.query);
        await expect(page.locator(library.card)).toHaveCount(1);
        await filter.tap();
        await expect(filter).toHaveAttribute('aria-expanded', 'true');
        await menu.tap();
        await expect(page.getByRole('button', { name: 'Close command menu' })).toBeVisible();
      });
    }
  }
});
