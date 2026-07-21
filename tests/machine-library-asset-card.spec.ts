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
    id: 51, assetNumber: 'Press 51', assetName: 'North Cell Press', brand: 'Toyo', model: 'SI-250-6', serialNumber: '1694010', machineYear: '2012', barrelDiameter: '35mm', location: 'North Cell', department: 'Molding', status: 'active', brandColorHex: '#44D7FF',
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
}

async function closeDetail(page: Page, mobile: boolean) {
  const detail = page.locator('.machine-detail-modal');
  await activate(detail.getByRole('button', { name: 'Close' }).first(), mobile);
  await expect(detail).toHaveCount(0);
  await expect(page.locator('.machine-asset-card')).toHaveCount(2);
}

async function tabToAssetCard(page: Page) {
  await page.evaluate(()=>{
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  });
  for (let index = 0; index < 60; index += 1) {
    await page.keyboard.press('Tab');
    if (await page.evaluate(()=>document.activeElement?.classList.contains('machine-asset-card') ?? false)) return;
  }
  throw new Error('An asset card was not reached after 60 Tab presses.');
}

async function documentCardClickCount(page: Page) {
  return page.evaluate(()=>(window as unknown as { __assetCardDocumentClicks: number }).__assetCardDocumentClicks);
}

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

  const historyRows = cards.first().locator('.machine-history-preview-row');
  await expect(historyRows).toHaveCount(1);
  await expect(historyRows).toContainText('Newest history summary');
  await expect(historyRows).toContainText('Recorded by Newest Technician');
  await expect(historyRows).not.toContainText('Older inspection note');

  await activate(cards.first().locator('.machine-asset-number-pill'), mobile);
  await expectSingleDetail(page);
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

  let before = await documentCardClickCount(page);
  await activate(cards.first().getByRole('button', { name: 'Barrel & Screw Logs' }), mobile);
  await expect(page.locator('.machine-detail-modal')).toHaveCount(0);
  await expect(page.locator('.measurement-record-modal')).toBeVisible();
  expect(await documentCardClickCount(page)).toBe(before);
  await activate(page.locator('.measurement-record-modal').getByRole('button', { name: 'Close' }), mobile);

  before = await documentCardClickCount(page);
  await activate(cards.first().getByRole('button', { name: /PM: 1 Due Soon/ }), mobile);
  expect(await documentCardClickCount(page)).toBe(before);
  await expectSingleDetail(page);
  await closeDetail(page, mobile);

  before = await documentCardClickCount(page);
  await activate(cards.first().getByRole('button', { name: 'Open full machine asset history' }), mobile);
  await expect(page.locator('.machine-detail-modal')).toHaveCount(0);
  await expect(page.locator('.machine-logs-modal')).toBeVisible();
  expect(await documentCardClickCount(page)).toBe(before);
  await activate(page.locator('.machine-logs-modal').getByRole('button', { name: 'Done' }), mobile);

  await activate(cards.nth(1).locator('.machine-card-brand-name'), mobile);
  await expectSingleDetail(page, 'Press 52');
  await expect(page.locator('.machine-detail-modal')).toHaveCount(1);
});
