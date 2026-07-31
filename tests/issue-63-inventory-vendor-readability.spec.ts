import { expect, type Page, test } from '@playwright/test';

const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'raspberry-pi', width: 1024, height: 600 },
  { name: 'mobile', width: 390, height: 844 },
];

const descriptions = {
  short: 'Short seal',
  multiline: 'Replacement hydraulic manifold seal for the north press, including installation orientation, material compatibility, and handling notes for maintenance technicians.',
  unbroken: `MCC${'VeryLongUnbrokenDescription'.repeat(18)}`,
};

function inventoryPart(id: string, partNumber: string, description: string, location: string) {
  return {
    id,
    itemId: `ITEM-${id}`,
    partNumber,
    description,
    location,
    vendor: 'Issue 63 Supply',
    quantity: 8,
    minQuantity: 2,
    status: 'In Stock',
    requisition: '',
    orderPlaced: false,
    hasActiveRequisitionRecord: false,
    isInRequisitionStaging: false,
    requisitionStagingItemId: null,
    requisitionStagingStatus: '',
    partInfoUrl: '',
    manufacturerBrand: 'MCC',
    unitCost: 12.5,
    supplierPartNumber: '',
    leadTime: '',
    importantNote: '',
    createdAt: '2026-07-31T12:00:00.000Z',
    updatedAt: '2026-07-31T12:00:00.000Z',
  };
}

const inventoryParts = [
  inventoryPart('1', 'SHORT-1', descriptions.short, 'Stores A-01'),
  inventoryPart('2', 'MULTI-2', descriptions.multiline, 'Tool Crib B-12'),
  inventoryPart('3', 'LONG-3', descriptions.unbroken, 'Warehouse C-03'),
];

type Contact = {
  id: number;
  vendorId: number;
  contactName: string;
  contactTitle: string;
  email: string;
  phoneType: 'Work';
  phoneNumber: string;
  phoneNormalized: string;
  phoneExt: string;
  notes: string;
  isPrimary: boolean;
  deleted: boolean;
};

function contact(id: number, vendorId: number, contactName: string, isPrimary: boolean): Contact {
  return {
    id,
    vendorId,
    contactName,
    contactTitle: isPrimary ? 'Primary Account Representative' : 'Inside Sales',
    email: `contact${id}@example.com`,
    phoneType: 'Work',
    phoneNumber: '(555) 410-2200',
    phoneNormalized: '5554102200',
    phoneExt: '',
    notes: '',
    isPrimary,
    deleted: false,
  };
}

const longPrimaryName = `Alexandria${'Maximillian'.repeat(9)}`;
const onePrimaryContact = contact(201, 2, 'Ron McCray', true);
const multipleContacts = [
  contact(301, 3, 'Secondary Contact', false),
  contact(302, 3, longPrimaryName, true),
];

function vendor(id: number, companyName: string, contacts: Contact[], primaryContactName = '') {
  return {
    id,
    companyName,
    phoneType: 'Main',
    phoneNumber: '(555) 410-2000',
    phoneNormalized: '5554102000',
    phoneExt: '',
    websiteUrl: '',
    addressLine1: '4100 Foundry Road',
    addressLine2: '',
    city: 'Milwaukee',
    state: 'WI',
    postalCode: '53201',
    country: 'United States',
    contactName: primaryContactName,
    contactTitle: '',
    contactPhoneType: 'Work',
    contactPhoneNumber: '',
    contactPhoneExt: '',
    contactEmail: '',
    notes: '',
    isActive: true,
    deleted: false,
    status: 'Enabled',
    contactCount: contacts.length,
    primaryContactName,
    primaryContactEmail: contacts.find(item => item.isPrimary)?.email ?? '',
    contacts,
  };
}

const vendors = [
  vendor(1, 'No Primary Vendor', []),
  vendor(2, 'Ron McCray Supply', [onePrimaryContact], onePrimaryContact.contactName),
  vendor(3, 'Multiple Contact Vendor', multipleContacts, longPrimaryName),
];

async function mockIssue63(page: Page) {
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/status') {
      return route.fulfill({
        json: {
          setupRequired: false,
          user: {
            id: 1,
            fullName: 'Issue 63 Tester',
            email: 'issue63@example.com',
            role: 'Admin',
            isOwnerAdmin: true,
            forcePasswordChange: false,
          },
        },
      });
    }
    if (path === '/api/inventory/native/summary') return route.fulfill({ json: { ok: true, totalParts: inventoryParts.length, lowStockCount: 0, requisitionCount: 0, vendorCount: vendors.length, locationCount: inventoryParts.length } });
    if (path === '/api/inventory/native/parts') return route.fulfill({ json: { ok: true, parts: inventoryParts } });
    if (path === '/api/inventory/native/backups') return route.fulfill({ json: { ok: true, backups: [] } });
    if (path === '/api/vendors') return route.fulfill({ json: { ok: true, vendors } });
    return route.fulfill({ json: { ok: true } });
  });
}

test('inventory descriptions wrap fully and preserve the Location column at every required width', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'This test sets each required viewport explicitly.');
  await mockIssue63(page);

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/inventory');

    const shortText = page.locator('.inventory-description-text', { hasText: descriptions.short });
    const multilineText = page.locator('.inventory-description-text', { hasText: descriptions.multiline });
    const unbrokenText = page.locator('.inventory-description-text', { hasText: descriptions.unbroken });
    await expect(shortText, `${viewport.name}: short description`).toBeVisible();
    await expect(multilineText, `${viewport.name}: multi-line description`).toHaveText(descriptions.multiline);
    await expect(unbrokenText, `${viewport.name}: unbroken description`).toHaveText(descriptions.unbroken);

    const styles = await multilineText.evaluate(element => {
      const style = getComputedStyle(element);
      return {
        whiteSpace: style.whiteSpace,
        overflowWrap: style.overflowWrap,
        wordBreak: style.wordBreak,
        textOverflow: style.textOverflow,
        overflow: style.overflow,
        lineClamp: style.getPropertyValue('-webkit-line-clamp'),
      };
    });
    expect(styles, `${viewport.name}: description wrapping styles`).toEqual({
      whiteSpace: 'normal',
      overflowWrap: 'anywhere',
      wordBreak: 'normal',
      textOverflow: 'clip',
      overflow: 'visible',
      lineClamp: 'none',
    });

    const textGeometry = await Promise.all([shortText, multilineText, unbrokenText].map(locator => locator.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        height: rect.height,
        lineHeight: Number.parseFloat(style.lineHeight),
        horizontalOverflow: element.scrollWidth - element.clientWidth,
        verticalOverflow: element.scrollHeight - element.clientHeight,
      };
    })));
    expect(textGeometry[0].height, `${viewport.name}: short description stays compact`).toBeLessThanOrEqual(textGeometry[0].lineHeight * 1.5);
    expect(textGeometry[1].height, `${viewport.name}: sentence wraps`).toBeGreaterThan(textGeometry[1].lineHeight * 2);
    expect(textGeometry[2].height, `${viewport.name}: unbroken description wraps`).toBeGreaterThan(textGeometry[2].lineHeight * 2);
    for (const geometry of textGeometry) {
      expect(geometry.horizontalOverflow, `${viewport.name}: description horizontal overflow`).toBeLessThanOrEqual(1);
      expect(geometry.verticalOverflow, `${viewport.name}: description vertical overflow`).toBeLessThanOrEqual(1);
    }

    const longRow = unbrokenText.locator('xpath=ancestor::tr');
    const topAlignment = await longRow.evaluate(row => {
      const cells = row.querySelectorAll('td');
      return {
        partNumber: getComputedStyle(cells[0]).verticalAlign,
        description: getComputedStyle(cells[1]).verticalAlign,
        location: getComputedStyle(cells[2]).verticalAlign,
        locationWidth: cells[2].getBoundingClientRect().width,
        locationText: cells[2].textContent?.trim(),
      };
    });
    expect(topAlignment, `${viewport.name}: taller row alignment`).toEqual({
      partNumber: 'top',
      description: 'top',
      location: 'top',
      locationWidth: expect.any(Number),
      locationText: 'Warehouse C-03',
    });
    expect(topAlignment.locationWidth, `${viewport.name}: Location column width`).toBeGreaterThanOrEqual(120);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${viewport.name}: document overflow`).toBeLessThanOrEqual(1);
  }
});

test('vendor primary-contact pills use semantic success without changing empty or count states', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'This test sets each required viewport explicitly.');
  await mockIssue63(page);

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/vendors');

    const noPrimaryCard = page.locator('.vendor-card', { hasText: 'No Primary Vendor' });
    const onePrimaryCard = page.locator('.vendor-card', { hasText: 'Ron McCray Supply' });
    const multipleCard = page.locator('.vendor-card', { hasText: 'Multiple Contact Vendor' });
    const noPrimaryPill = noPrimaryCard.locator('.vendor-primary-contact-name');
    const onePrimaryPill = onePrimaryCard.locator('.vendor-primary-contact-name');
    const multiplePrimaryPill = multipleCard.locator('.vendor-primary-contact-name');

    await expect(noPrimaryPill, `${viewport.name}: empty primary state`).toHaveText('No primary contact');
    await expect(noPrimaryPill).toHaveClass(/mcc-contact-pill/);
    await expect(noPrimaryPill).not.toHaveClass(/mcc-status-pill--success/);
    await expect(onePrimaryPill, `${viewport.name}: one primary contact`).toHaveText('Ron McCray');
    await expect(onePrimaryPill).toHaveClass(/mcc-status-pill--success/);
    await expect(multiplePrimaryPill, `${viewport.name}: designated primary among multiple contacts`).toHaveText(longPrimaryName);
    await expect(multiplePrimaryPill).toHaveClass(/mcc-status-pill--success/);
    await expect(multipleCard.locator('.vendor-primary-contact-label')).toHaveText('Primary Contact');
    await expect(noPrimaryCard.locator('.vendor-contact-count-badge')).toHaveText('0 contacts');
    await expect(onePrimaryCard.locator('.vendor-contact-count-badge')).toHaveText('1 contact');
    await expect(multipleCard.locator('.vendor-contact-count-badge')).toHaveText('2 contacts');

    const pillGeometry = await multiplePrimaryPill.evaluate(element => ({
      horizontalOverflow: element.scrollWidth - element.clientWidth,
      width: element.getBoundingClientRect().width,
      parentWidth: element.parentElement!.getBoundingClientRect().width,
      lines: element.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(element).lineHeight),
      animation: getComputedStyle(element).animationName,
    }));
    expect(pillGeometry.horizontalOverflow, `${viewport.name}: long contact overflow`).toBeLessThanOrEqual(1);
    expect(pillGeometry.width, `${viewport.name}: long contact width`).toBeLessThanOrEqual(pillGeometry.parentWidth + 1);
    expect(pillGeometry.lines, `${viewport.name}: long contact wraps`).toBeGreaterThan(1);
    expect(pillGeometry.animation, `${viewport.name}: low-power-safe pill`).toBe('none');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${viewport.name}: document overflow`).toBeLessThanOrEqual(1);

    const summaryButton = multipleCard.locator('.vendor-contact-summary-button');
    await summaryButton.focus();
    expect(await summaryButton.evaluate(element => element.matches(':focus-visible')), `${viewport.name}: keyboard focus indicator`).toBe(true);
    expect(await summaryButton.evaluate(element => getComputedStyle(element).outlineStyle), `${viewport.name}: visible focus outline`).not.toBe('none');
  }

  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.goto('/vendors');
  const highContrastPrimary = page.locator('.vendor-card', { hasText: 'Ron McCray Supply' }).locator('.vendor-primary-contact-name');
  await expect(highContrastPrimary).toBeVisible();
  await expect(highContrastPrimary).toHaveText('Ron McCray');
  const highContrastStyle = await highContrastPrimary.evaluate(element => ({
    color: getComputedStyle(element).color,
    background: getComputedStyle(element).backgroundColor,
    border: getComputedStyle(element).borderTopColor,
  }));
  expect(highContrastStyle.color).not.toBe('rgba(0, 0, 0, 0)');
  expect(highContrastStyle.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(highContrastStyle.border).not.toBe('rgba(0, 0, 0, 0)');
});
