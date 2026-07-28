import { expect, type Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const rootManifest = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as { version: string };
const versionMetadata = {
  version: rootManifest.version,
  displayVersion: `v${rootManifest.version}`,
  commit: 'abc1234',
  buildDate: null,
};

type FixtureRole = 'owner' | 'admin' | 'manager' | 'tech1' | 'tech2' | 'tech3';

const fixtureUsers = {
  owner: { role: 'Admin', isOwnerAdmin: true, canViewSystemVersion: true },
  admin: { role: 'Admin', isOwnerAdmin: false, canViewSystemVersion: true },
  manager: { role: 'Manager', isOwnerAdmin: false, canViewSystemVersion: false },
  tech1: { role: 'Maintenance Tech 1', isOwnerAdmin: false, canViewSystemVersion: false },
  tech2: { role: 'Maintenance Tech 2', isOwnerAdmin: false, canViewSystemVersion: false },
  tech3: { role: 'Maintenance Tech 3', isOwnerAdmin: false, canViewSystemVersion: false },
} as const;

async function mockSettings(page: Page, fixtureRole: FixtureRole) {
  const fixture = fixtureUsers[fixtureRole];
  let versionRequests = 0;
  const user = {
    id: 1,
    fullName: `${fixtureRole} Fixture`,
    email: `${fixtureRole}@example.com`,
    role: fixture.role,
    isOwnerAdmin: fixture.isOwnerAdmin,
    canViewSystemVersion: fixture.canViewSystemVersion,
    forcePasswordChange: false,
    effectivePermissions: [],
  };
  await page.route('**/api/auth/status', route => route.fulfill({ json: { setupRequired: false, user } }));
  await page.route('**/api/version', route => {
    versionRequests += 1;
    return route.fulfill({ json: versionMetadata });
  });
  await page.route('**/api/settings/branding', route => route.fulfill({ json: { branding: {} } }));
  await page.route('**/api/settings/network-links', route => route.fulfill({
    json: { localPort: 4273, localhostUrl: 'http://localhost:4273', detectedLanUrls: [], primaryLanUrl: null },
  }));
  await page.route('**/api/backup/status', route => route.fulfill({ status: 403, json: { error: 'Not available in fixture.' } }));
  await page.route('**/api/admin/reset/status', route => route.fulfill({ status: 403, json: { error: 'Not available in fixture.' } }));
  return { versionRequests: () => versionRequests };
}

async function expectNoHorizontalOverflow(page: Page) {
  const size = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(size.scrollWidth).toBeLessThanOrEqual(size.clientWidth);
}

for (const role of ['owner', 'admin'] as const) {
  test(`${role} sees the authoritative system version panel`, async ({ page }) => {
    const fixture = await mockSettings(page, role);
    await page.goto('/settings');
    const panel = page.getByRole('complementary', { name: 'MCC system version' });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('System Version');
    await expect(panel).toContainText(`MCC v${rootManifest.version}`);
    await expect(panel).toContainText('Build abc1234');
    await expect(page.locator('.settings-page > *').first()).toHaveClass(/system-version-panel/);
    await expect(page.getByText('Company Branding', { exact: true })).toBeVisible();
    expect(fixture.versionRequests()).toBe(1);

    for (const viewport of [{ width: 1024, height: 600 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await expect(panel).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }
    await page.reload();
    await expect(panel).toContainText(`MCC v${rootManifest.version}`);
    expect(fixture.versionRequests()).toBe(2);
  });
}

for (const role of ['manager', 'tech1', 'tech2', 'tech3'] as const) {
  test(`${role} cannot render or request system version metadata`, async ({ page }) => {
    const fixture = await mockSettings(page, role);
    await page.goto('/settings');
    await expect(page.getByRole('complementary', { name: 'MCC system version' })).toHaveCount(0);
    await expect(page.getByText('Company Branding', { exact: true })).toBeVisible();
    expect(fixture.versionRequests()).toBe(0);
  });
}
