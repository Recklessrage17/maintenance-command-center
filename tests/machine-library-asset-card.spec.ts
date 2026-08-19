import { expect, type Locator, type Page, test } from '@playwright/test';

const historyRecord = {
  id: 901,
  action: 'asset_updated',
  entityLabel: 'Press 51',
  userName: 'Automated Test',
  reasonNote: 'Updated barrel measurements.',
  createdAt: '2026-07-16T15:30:00.000Z',
};

const olderHistoryRecord = {
  ...historyRecord,
  id: 899,
  userName: 'Previous Technician',
  reasonNote: 'Older inspection note that must not appear in the card preview.',
  createdAt: '2026-07-14T09:00:00.000Z',
};

const newestHistoryRecord = {
  ...historyRecord,
  id: 902,
  action: 'preventive_maintenance_completed',
  userName: 'Newest Technician',
  reasonNote: 'Newest history summary with extra text that remains compact in the preview.',
  createdAt: '2026-07-17T14:45:00.000Z',
};

const emptyAssetFields = {
  machineType: 'Injection Molding Machine', powerType: 'Electric', shotSizeOz: 12, tonnage: 250,
  voltageValue: '480', voltageType: 'VAC', fullLoadAmp: '320', machineLength: '22 ft', machineWidth: '7 ft', machineHeight: '8 ft', fullDieHeightLength: '48 in',
  screwType: 'General Purpose', screwTipType: 'Sliding Ring', screwTipInstalledDate: '', screwInstalledDate: '', barrelInstalledDate: '', barrelEndCapInstalledDate: '', barrelLength: '96 in', screwLength: '92 in',
  screwRebuildRepaired: false, barrelRebuildRepaired: false, screwConditionStatus: 'used', barrelConditionStatus: 'used',
  hasDoubleShotInjection: false, hasPlungerInjection: false,
  screw2Type: '', screw2TipType: '', screw2RebuildRepaired: false, screw2ConditionStatus: 'new', screw2InstalledDate: '', screw2TipInstalledDate: '', screw2Length: '',
  barrel2Diameter: '', barrel2RebuildRepaired: false, barrel2ConditionStatus: 'new', barrel2InstalledDate: '', barrel2EndCapInstalledDate: '', barrel2Length: '',
  plungerType: '', plungerRebuildRepaired: false, plungerConditionStatus: 'new', plungerInstalledDate: '', plungerLength: '', plungerDiameter: '',
  plungerBarrelType: '', plungerBarrelRebuildRepaired: false, plungerBarrelConditionStatus: 'new', plungerBarrelInstalledDate: '', plungerBarrelEndCapInstalledDate: '', plungerBarrelLength: '', plungerBarrelDiameter: '',
  notes: '', criticalNotes: '', createdAt: '2026-01-01T12:00:00.000Z', updatedAt: '2026-07-16T15:30:00.000Z',
};

const assets = [
  {
    ...emptyAssetFields,
    id: 51, assetNumber: 'Press 51', assetName: 'North Cell Press', brand: 'Toyo', model: 'SI-250-6', serialNumber: '1694010', machineYear: '2000', barrelDiameter: '35mm', location: 'North Cell', department: 'Molding', status: 'active', brandColorHex: '#44D7FF',
    pmSummary: { total: 2, status: 'due-soon', label: 'PM: 1 Due Soon' },
    historyPreview: [historyRecord, olderHistoryRecord, newestHistoryRecord],
  },
  {
    ...emptyAssetFields,
    id: 52, assetNumber: 'Press 52', assetName: 'South Cell Press', brand: 'Engel', model: 'Victory 330', serialNumber: 'ENG-052', machineYear: '2018', barrelDiameter: '40mm', location: 'South Cell', department: 'Molding', status: 'active', brandColorHex: '#F5A623',
    pmSummary: { total: 1, status: 'current', label: 'PM: Current' },
    historyPreview: [],
  },
];

async function mockMachineLibrary(page: Page) {
  await page.route('**/api/auth/status', route=>route.fulfill({
    json: { setupRequired: false, user: { id: 1, fullName: 'Automated Test', email: 'test@example.com', role: 'Admin', isOwnerAdmin: true, forcePasswordChange: false } },
  }));
  await page.route(/\/api\/machine-library\/assets(?:\?.*)?$/, route=>route.fulfill({
    json: { ok: true, assets, brandSettings: [], permissions: { canEdit: true, canDelete: true } },
  }));
  await page.route(/\/api\/machine-library\/assets\/\d+\/history$/, route=>route.fulfill({
    json: { ok: true, asset: assets[0], records: [newestHistoryRecord, historyRecord, olderHistoryRecord] },
  }));
  await page.route(/\/api\/machine-library\/assets\/\d+\/inspection-records$/, route=>route.fulfill({ json: { ok: true, records: [] } }));
  await page.route(/\/api\/machine-library\/assets\/\d+\/preventive-maintenance$/, route=>route.fulfill({
    json: { ok: true, tasks: [], summary: { total: 0, current: 0, dueSoon: 0, dueNow: 0, overdue: 0, hold: 0, inactive: 0, incomplete: 0, nextDueDate: null, nextDueMeter: null } },
  }));
  await page.route(/\/api\/machine-library\/assets\/\d+\/notes$/, route=>route.fulfill({ json: { ok: true, notes: [] } }));
  await page.route(/\/api\/machine-library\/assets\/\d+\/component-images$/, route=>route.fulfill({ json: { ok: true, images: [] } }));
  await page.route(/\/api\/machine-library\/assets\/\d+\/document-folders$/, route=>route.fulfill({ json: { ok: true, folders: [], summary: { folderCount: 0, documentCount: 0 } } }));
  await page.route(/\/api\/machine-library\/assets\/\d+\/documents$/, route=>route.fulfill({ json: { ok: true, documents: [] } }));
}

async function activate(locator: Locator, mobile: boolean, options?: { position?: { x: number; y: number } }) {
  if (mobile) await locator.tap(options);
  else await locator.click(options);
}

async function expectSingleDetail(page: Page, assetNumber = 'Press 51') {
  const detail = page.locator('.machine-detail-modal');
  await expect(detail).toHaveCount(1);
  await expect(detail).toBeVisible();
  await expect(detail.getByRole('heading', { name: assetNumber })).toBeVisible();
  await expect(detail).toBeFocused();
}

async function closeDetail(page: Page, mobile: boolean) {
  const detail = page.locator('.machine-detail-modal');
  const assetNumber = (await detail.locator('h3').first().textContent())?.trim();
  await activate(detail.getByRole('button', { name: 'Close' }).first(), mobile);
  await expect(detail).toHaveCount(0);
  await expect(page.locator('.machine-asset-card')).toHaveCount(2);
  if (!assetNumber) throw new Error('Machine detail asset number was unavailable.');
  await expect(page.getByRole('button', { name: `View details for ${assetNumber}` })).toBeFocused();
}

async function tabToAssetCard(page: Page, assetNumber = 'Press 51') {
  await page.evaluate(()=>{
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  });
  for (let index = 0; index < 60; index += 1) {
    await page.keyboard.press('Tab');
    if (await page.evaluate(expectedLabel=>(
      document.activeElement?.classList.contains('machine-asset-card')
      && document.activeElement.getAttribute('aria-label')===expectedLabel
    ),`View details for ${assetNumber}`)) return;
  }
  throw new Error(`${assetNumber} was not reached after 60 Tab presses.`);
}

async function documentCardClickCount(page: Page) {
  return page.evaluate(()=>(window as unknown as { __assetCardDocumentClicks: number }).__assetCardDocumentClicks);
}

test('Machine asset query opens the requested full detail', async ({ page }) => {
  await mockMachineLibrary(page);
  await page.goto('/machine-library?asset=52');
  await expectSingleDetail(page,'Press 52');
});

test('asset card has no dead zones and keeps child controls independent', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile-chromium';
  await mockMachineLibrary(page);
  await page.goto('/machine-library');

  const cards = page.locator('.machine-asset-card');
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toBeVisible();
  await expect(cards.nth(1)).toBeVisible();
  await cards.first().scrollIntoViewIfNeeded();

  await page.evaluate(()=>{
    (window as unknown as { __assetCardDocumentClicks: number }).__assetCardDocumentClicks = 0;
    document.addEventListener('click', event=>{
      const target = event.target;
      if (target instanceof Element && target.closest('.machine-asset-card')) {
        (window as unknown as { __assetCardDocumentClicks: number }).__assetCardDocumentClicks += 1;
      }
    });
  });

  const domAudit = await cards.first().evaluate(card=>{
    const rect = card.getBoundingClientRect();
    const samplePoints = [
      [rect.left + 8, rect.top + 28],
      [rect.right - 8, rect.top + 28],
      [rect.right - 8, rect.top + rect.height / 2],
    ];
    return {
      rootTag: card.tagName,
      role: card.getAttribute('role'),
      tabIndex: (card as HTMLElement).tabIndex,
      pointerEvents: getComputedStyle(card).pointerEvents,
      cursor: getComputedStyle(card).cursor,
      beforePointerEvents: getComputedStyle(card, '::before').pointerEvents,
      afterPointerEvents: getComputedStyle(card, '::after').pointerEvents,
      invalidNestedButtons: document.querySelectorAll('button button').length,
      interceptedPoints: samplePoints.filter(([x,y])=>{
        const top = document.elementFromPoint(x,y);
        return top !== card && !card.contains(top);
      }).length,
    };
  });
  expect(domAudit).toEqual({
    rootTag: 'ARTICLE', role: 'button', tabIndex: 0, pointerEvents: 'auto', cursor: 'pointer',
    beforePointerEvents: 'none', afterPointerEvents: 'none', invalidNestedButtons: 0, interceptedPoints: 0,
  });

  await expect(cards.first()).not.toContainText('Type / Brand');
  await expect(cards.first()).not.toContainText('Barrel & Screw Logs');
  await expect(cards.first()).not.toContainText('History Preview');
  await expect(cards.first().locator('.machine-pill-card-metrics .mcc-metric-pill')).toHaveCount(4);
  const machineYear = cards.first().locator('.mcc-metric-pill', { hasText: 'Year / Age' });
  await expect(machineYear.locator('.asset-year-number')).toHaveText('2000');
  await expect(machineYear.locator('.asset-year-separator')).toHaveText('/');
  await expect(machineYear.locator('.asset-age-inline')).toHaveText('26');
  const rowPolish = await cards.first().evaluate(card=>{
    const brand = getComputedStyle(card.querySelector('.machine-card-brand-name')!);
    const yearElement = card.querySelector('.asset-year-number')!;
    const separatorElement = card.querySelector('.asset-year-separator')!;
    const ageElement = card.querySelector('.asset-age-inline')!;
    const year = getComputedStyle(yearElement);
    const separator = getComputedStyle(separatorElement);
    const age = getComputedStyle(card.querySelector('.asset-age-inline')!);
    const metricSizes = [...card.querySelectorAll('.machine-pill-card-metrics .mcc-metric-pill > strong')].map(element=>Number.parseFloat(getComputedStyle(element).fontSize));
    const yearBox = yearElement.getBoundingClientRect();
    const separatorBox = separatorElement.getBoundingClientRect();
    const ageBox = ageElement.getBoundingClientRect();
    return { brandSize: Number.parseFloat(brand.fontSize), minMetricSize: Math.min(...metricSizes), yearSize: Number.parseFloat(year.fontSize), ageSize: age.fontSize, ageColor: age.color, yearColor: year.color, separatorColor: separator.color, baselineSpread: Math.max(yearBox.bottom,separatorBox.bottom,ageBox.bottom)-Math.min(yearBox.bottom,separatorBox.bottom,ageBox.bottom) };
  });
  expect(rowPolish.brandSize).toBeGreaterThanOrEqual(15);
  expect(rowPolish.minMetricSize).toBeGreaterThanOrEqual(15);
  expect(rowPolish.yearSize).toBeGreaterThanOrEqual(15);
  expect(rowPolish.ageSize).toBe(`${rowPolish.yearSize}px`);
  expect(rowPolish.ageColor).toBe('rgb(255, 159, 67)');
  expect(rowPolish.yearColor).not.toBe(rowPolish.ageColor);
  expect(rowPolish.separatorColor).not.toBe(rowPolish.ageColor);
  expect(rowPolish.baselineSpread).toBeLessThanOrEqual(1);
  await expect(cards.first().getByRole('button', { name: /PM: 1 Due Soon/ })).toBeVisible();

  await activate(cards.first().locator('.machine-asset-number-pill'), mobile);
  await expectSingleDetail(page);
  const machineIdentity = page.locator('.machine-detail-modal .asset-detail-identity-strip');
  await expect(machineIdentity).toHaveCount(1);
  await expect(machineIdentity.locator('.asset-detail-brand-chip')).toContainText('Toyo');
  await expect(machineIdentity.locator('.asset-detail-data-chip')).toHaveCount(2);
  await expect(machineIdentity.locator('.asset-detail-data-chip').first()).toContainText('ModelSI-250-6');
  await expect(machineIdentity.locator('.asset-detail-data-chip').nth(1)).toContainText('Serial #1694010');
  await expect(page.locator('.machine-detail-modal .asset-detail-context')).toHaveText('North Cell Press');
  await expect(page.locator('.machine-detail-modal .machine-detail-summary-card')).toHaveCount(4);
  const detailYearAge = page.locator('.machine-detail-modal .machine-detail-summary-pill.year-age');
  await expect(detailYearAge.locator('.asset-year-number')).toHaveText('2000');
  await expect(detailYearAge.locator('.asset-year-separator')).toHaveText('/');
  await expect(detailYearAge.locator('.asset-age-inline')).toHaveText('26');
  const detailPolish = await page.locator('.machine-detail-modal').evaluate(detail=>{
    const identity = detail.querySelector('.asset-detail-identity-strip')!.getBoundingClientRect();
    const chips = [...detail.querySelectorAll('.asset-detail-identity-strip > span')].map(element=>element.getBoundingClientRect());
    const values = [...detail.querySelectorAll('.asset-detail-identity-strip strong')].map(element=>Number.parseFloat(getComputedStyle(element).fontSize));
    const yearAge = detail.querySelector('.machine-detail-summary-pill.year-age')!;
    const yearAgeStyle = getComputedStyle(yearAge);
    const yearAgeRow = yearAge.querySelector('.asset-year-value')!;
    const yearAgeRowStyle = getComputedStyle(yearAgeRow);
    const yearAgeParts = [...yearAgeRow.querySelectorAll(':scope > span')];
    const yearAgePartStyles = yearAgeParts.map(element=>getComputedStyle(element));
    const yearAgePartBoxes = yearAgeParts.map(element=>element.getBoundingClientRect());
    return {
      identityWidth: identity.width,
      chipsWidth: chips.reduce((total,box)=>total+box.width,0),
      modelSerialGap: chips[2].left-chips[1].right,
      modelSerialTopDelta: Math.abs(chips[2].top-chips[1].top),
      minValueSize: Math.min(...values),
      yearAgeBorder: yearAgeStyle.borderTopWidth,
      yearAgeBackground: yearAgeStyle.backgroundImage,
      yearAgeSize: Number.parseFloat(yearAgeStyle.fontSize),
      yearAgeFlexDirection: yearAgeRowStyle.flexDirection,
      yearAgeFlexWrap: yearAgeRowStyle.flexWrap,
      yearAgeWhiteSpace: yearAgeRowStyle.whiteSpace,
      yearAgePartSizes: yearAgePartStyles.map(style=>style.fontSize),
      yearAgePartColors: yearAgePartStyles.map(style=>style.color),
      yearAgePartLefts: yearAgePartBoxes.map(box=>box.left),
      yearAgePartRights: yearAgePartBoxes.map(box=>box.right),
      yearAgePartCenters: yearAgePartBoxes.map(box=>box.top+(box.height/2)),
    };
  });
  expect(detailPolish.identityWidth-detailPolish.chipsWidth).toBeLessThanOrEqual(17);
  expect(detailPolish.modelSerialGap).toBeGreaterThanOrEqual(0);
  expect(detailPolish.modelSerialGap).toBeLessThanOrEqual(9);
  expect(detailPolish.modelSerialTopDelta).toBeLessThanOrEqual(1);
  expect(detailPolish.minValueSize).toBeGreaterThanOrEqual(15);
  expect(detailPolish.yearAgeBorder).toBe('0px');
  expect(detailPolish.yearAgeBackground).toBe('none');
  expect(detailPolish.yearAgeSize).toBeGreaterThanOrEqual(15);
  if (!mobile) {
    expect(detailPolish.yearAgeFlexDirection).toBe('row');
    expect(detailPolish.yearAgeFlexWrap).toBe('nowrap');
    expect(detailPolish.yearAgeWhiteSpace).toBe('nowrap');
    expect(detailPolish.yearAgePartSizes).toEqual([`${detailPolish.yearAgeSize}px`,`${detailPolish.yearAgeSize}px`,`${detailPolish.yearAgeSize}px`]);
    expect(detailPolish.yearAgePartColors[0]).not.toBe(detailPolish.yearAgePartColors[1]);
    expect(detailPolish.yearAgePartColors[2]).toBe('rgb(255, 159, 67)');
    expect(detailPolish.yearAgePartRights[0]).toBeLessThanOrEqual(detailPolish.yearAgePartLefts[1]);
    expect(detailPolish.yearAgePartRights[1]).toBeLessThanOrEqual(detailPolish.yearAgePartLefts[2]);
    expect(Math.max(...detailPolish.yearAgePartCenters)-Math.min(...detailPolish.yearAgePartCenters)).toBeLessThanOrEqual(1);
  }
  await closeDetail(page, mobile);

  await activate(cards.first().locator('.machine-card-brand-name'), mobile);
  await expectSingleDetail(page);
  await closeDetail(page, mobile);

  await activate(cards.first().locator('.mcc-metric-pill').filter({ hasText: 'Model' }), mobile);
  await expectSingleDetail(page);
  await closeDetail(page, mobile);

  const cardBox = await cards.first().boundingBox();
  if (!cardBox) throw new Error('Asset card did not have a bounding box.');
  const paddingPosition = { x: cardBox.width - 8, y: Math.min(28, cardBox.height / 2) };
  const paddingTargetIsCard = await cards.first().evaluate((card, position)=>{
    const rect = card.getBoundingClientRect();
    return document.elementFromPoint(rect.left + position.x, rect.top + position.y) === card;
  }, paddingPosition);
  expect(paddingTargetIsCard).toBe(true);
  await activate(cards.first(), mobile, { position: paddingPosition });
  await expectSingleDetail(page);
  await closeDetail(page, mobile);

  await tabToAssetCard(page);
  await page.keyboard.press('Enter');
  await expectSingleDetail(page);
  await closeDetail(page, mobile);

  await tabToAssetCard(page);
  await page.keyboard.press('Space');
  await expectSingleDetail(page);
  await closeDetail(page, mobile);

  await activate(cards.first(), mobile);
  await expectSingleDetail(page);
  const detail = page.locator('.machine-detail-modal');
  await activate(detail.getByRole('button', { name: 'Barrel & Screw Logs' }).first(), mobile);
  await expect(page.locator('.measurement-record-modal')).toBeVisible();
  await activate(page.locator('.measurement-record-modal').getByRole('button', { name: 'Close' }), mobile);
  await expect(detail).toBeVisible();
  await activate(detail.getByRole('button', { name: 'History' }), mobile);
  await expect(detail).toHaveCount(0);
  await expect(page.locator('.machine-logs-modal')).toBeVisible();
  await expect(page.locator('.machine-logs-modal')).toContainText('Newest history summary');
  await activate(page.locator('.machine-logs-modal').getByRole('button', { name: 'Done' }), mobile);

  const before = await documentCardClickCount(page);
  await activate(cards.first().getByRole('button', { name: /PM: 1 Due Soon/ }), mobile);
  expect(await documentCardClickCount(page)).toBe(before);
  await expectSingleDetail(page);
  await closeDetail(page, mobile);

  await activate(cards.nth(1).locator('.machine-card-brand-name'), mobile);
  await expectSingleDetail(page, 'Press 52');
  await expect(page.locator('.machine-detail-modal')).toHaveCount(1);
});
