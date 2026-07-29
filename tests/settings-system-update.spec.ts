import { expect, type Page, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

type UpdateState = {
  ok: boolean;
  configured: boolean;
  available: boolean;
  state: string;
  code: string;
  message: string;
  mode: string;
  environmentLabel: string;
  installedVersion: string | null;
  installedCommit: string | null;
  targetVersion: string | null;
  targetCommit: string | null;
  startedAt: string | null;
  requestedAt: string | null;
  lastUpdatedAt: string;
  completedAt: string | null;
  requester: { id: number; name: string } | null;
  outcome: string;
  checkToken: string | null;
  checkExpiresAt: string | null;
  csrfToken: string;
  active: boolean;
};

const timestamp = '2026-07-29T12:00:00.000Z';
const approvalArtifactDirectory = resolve(process.cwd(), 'artifacts', 'issue-60');
const availableUpdate: UpdateState = {
  ok: true,
  configured: true,
  available: true,
  state: 'update_available',
  code: 'update_available',
  message: 'MCC v1.3.0 is available from the approved origin/main branch.',
  mode: 'raspberry_pi',
  environmentLabel: 'RASPBERRY PI PRODUCTION',
  installedVersion: '1.2.1',
  installedCommit: 'abc1234',
  targetVersion: '1.3.0',
  targetCommit: 'def5678',
  startedAt: null,
  requestedAt: null,
  lastUpdatedAt: timestamp,
  completedAt: timestamp,
  requester: { id: 1, name: 'Admin Fixture' },
  outcome: 'none',
  checkToken: 'verified-check-token',
  checkExpiresAt: '2026-07-29T12:10:00.000Z',
  csrfToken: 'session-csrf-token',
  active: false,
};

function update(overrides: Partial<UpdateState>): UpdateState {
  return { ...availableUpdate, ...overrides };
}

async function mockSettings(
  page: Page,
  options: {
    role?: string;
    isOwnerAdmin?: boolean;
    canViewSystemVersion?: boolean;
    initialUpdate?: UpdateState;
    checkUpdate?: UpdateState;
    onInstall?: () => UpdateState;
    onStatus?: (requestNumber: number) => UpdateState | 'abort';
  } = {},
) {
  const role = options.role ?? 'Admin';
  const canViewSystemVersion = options.canViewSystemVersion ?? role === 'Admin';
  let statusRequests = 0;
  let checkRequests = 0;
  let installRequests = 0;
  const user = {
    id: 1,
    fullName: 'Admin Fixture',
    email: 'admin@example.com',
    role,
    isOwnerAdmin: options.isOwnerAdmin ?? false,
    canViewSystemVersion,
    forcePasswordChange: false,
    effectivePermissions: [],
  };
  await page.route('**/api/auth/status', route => route.fulfill({ json: { setupRequired: false, user } }));
  await page.route('**/api/presence/**', route => route.fulfill({ json: { ok: true } }));
  await page.route('**/api/version', route => route.fulfill({
    json: { version: '1.2.1', displayVersion: 'v1.2.1', commit: 'abc1234', buildDate: null },
  }));
  await page.route('**/api/system/update/status', route => {
    statusRequests += 1;
    const next = options.onStatus?.(statusRequests) ?? options.initialUpdate ?? availableUpdate;
    if (next === 'abort') return route.abort('failed');
    return route.fulfill({ json: next });
  });
  await page.route('**/api/system/update/check', route => {
    checkRequests += 1;
    return route.fulfill({ json: options.checkUpdate ?? availableUpdate });
  });
  await page.route('**/api/system/update/install', async route => {
    installRequests += 1;
    const requestBody = route.request().postDataJSON();
    expect(requestBody).toEqual({ confirm: true, checkToken: 'verified-check-token' });
    expect(route.request().headers()['x-mcc-csrf-token']).toBe('session-csrf-token');
    const queued = options.onInstall?.() ?? {
      ...(options.initialUpdate??availableUpdate),
      state: 'queued',
      code: 'queued',
      message: 'The MCC update is queued for the external update runner.',
      startedAt: timestamp,
      completedAt: null,
      checkToken: null,
      checkExpiresAt: null,
      active: true,
    };
    return route.fulfill({ status: 202, json: { ...queued, accepted: true, jobId: 'job-1' } });
  });
  await page.route('**/api/settings/branding', route => route.fulfill({ json: { branding: {} } }));
  await page.route('**/api/settings/network-links', route => route.fulfill({
    json: { localPort: 4273, localhostUrl: 'http://localhost:4273', detectedLanUrls: [], primaryLanUrl: null },
  }));
  await page.route('**/api/backup/status', route => route.fulfill({ status: 403, json: { error: 'Not available in fixture.' } }));
  await page.route('**/api/admin/reset/status', route => route.fulfill({ status: 403, json: { error: 'Not available in fixture.' } }));
  return {
    statusRequests: () => statusRequests,
    checkRequests: () => checkRequests,
    installRequests: () => installRequests,
  };
}

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
}

async function captureApproval(page:Page,name:string) {
  await mkdir(approvalArtifactDirectory,{recursive:true});
  await page.screenshot({path:resolve(approvalArtifactDirectory,name),fullPage:true});
}

test('Admin sees an available update and must explicitly confirm before installation', async ({ page },testInfo) => {
  const fixture = await mockSettings(page, {
    initialUpdate: update({ mode: 'windows_test', environmentLabel: 'WINDOWS TEST MODE' }),
  });
  await page.goto('/settings');
  const panel = page.getByRole('complementary', { name: 'MCC system version' });
  await expect(panel).toContainText('UPDATE AVAILABLE');
  await expect(panel).toContainText('WINDOWS TEST MODE');
  await expect(panel).toContainText('MCC v1.2.1');
  await expect(panel).toContainText('Build abc1234');
  if(testInfo.project.name==='desktop-chromium')await captureApproval(page,'01-update-available-windows-test.png');

  await page.getByRole('button', { name: 'Update to v1.3.0' }).click();
  const dialog = page.getByRole('dialog', { name: 'MCC Update Available' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Installed');
  await expect(dialog).toContainText('v1.2.1');
  await expect(dialog).toContainText('Available');
  await expect(dialog).toContainText('v1.3.0');
  await expect(dialog).toContainText('1–3 minutes');
  expect(fixture.installRequests()).toBe(0);
  if(testInfo.project.name==='desktop-chromium')await captureApproval(page,'02-confirmation-dialog.png');

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  expect(fixture.installRequests()).toBe(0);

  await page.getByRole('button', { name: 'Update to v1.3.0' }).click();
  await page.getByRole('dialog', { name: 'MCC Update Available' }).getByRole('button', { name: 'Install Update' }).click();
  await expect(page.getByRole('dialog', { name: 'MCC Update Progress' })).toBeVisible();
  expect(fixture.installRequests()).toBe(1);
  if(testInfo.project.name==='desktop-chromium')await captureApproval(page,'03-progress-display.png');
});

test('the existing update card shows managed Windows production and sanitized unavailable states', async ({ page }) => {
  await mockSettings(page, {
    initialUpdate: update({
      mode: 'windows_production',
      environmentLabel: 'WINDOWS 11 PRODUCTION',
      state: 'idle',
      code: 'updater_agent_offline',
      message: 'The Windows updater agent is offline.',
      available: false,
      checkToken: null,
      checkExpiresAt: null,
    }),
  });
  await page.goto('/settings');
  const panel = page.getByRole('complementary', { name: 'MCC system version' });
  await expect(panel).toContainText('WINDOWS 11 PRODUCTION');
  await expect(panel).toContainText('UPDATER AGENT OFFLINE');
  await expect(page.getByRole('button', { name: 'Unavailable' })).toBeDisabled();

  await page.route('**/api/system/update/status', route => route.fulfill({
    json: update({
      configured: false,
      available: false,
      mode: 'disabled',
      environmentLabel: 'UPDATER NOT CONFIGURED',
      state: 'idle',
      code: 'deployment_not_configured',
      message: 'The updater is not configured in this environment.',
      checkToken: null,
      checkExpiresAt: null,
    }),
  }));
  await page.reload();
  await expect(panel).toContainText('UPDATER NOT CONFIGURED');
  await expect(page.getByRole('button', { name: 'Unavailable' })).toBeDisabled();
});

test('up-to-date and failed-check states never claim success without a completed comparison', async ({ page },testInfo) => {
  const fixture = await mockSettings(page, {
    initialUpdate: update({
      state: 'idle',
      code: 'up_to_date',
      message: 'MCC is up to date with the approved origin/main branch.',
      targetVersion: '1.2.1',
      targetCommit: 'abc1234',
      checkToken: null,
      checkExpiresAt: null,
    }),
    checkUpdate: availableUpdate,
  });
  await page.goto('/settings');
  const panel = page.getByRole('complementary', { name: 'MCC system version' });
  await expect(panel).toContainText('✓ UP TO DATE');
  if(testInfo.project.name==='desktop-chromium')await captureApproval(page,'04-up-to-date-pi-production.png');
  await page.getByRole('button', { name: 'Check for updates' }).click();
  await expect(panel).toContainText('UPDATE AVAILABLE');
  expect(fixture.checkRequests()).toBe(1);

  await page.reload();
  await expect(panel).toContainText('✓ UP TO DATE');
});

test('browser tolerates restart failure, reconnects, and displays the installed target build', async ({ page },testInfo) => {
  let installed = false;
  let afterInstallPolls = 0;
  await mockSettings(page, {
    onInstall: () => {
      installed = true;
      return update({
        state: 'queued',
        code: 'queued',
        message: 'The update is queued.',
        startedAt: timestamp,
        completedAt: null,
        checkToken: null,
        checkExpiresAt: null,
        active: true,
      });
    },
    onStatus: () => {
      if (!installed) return availableUpdate;
      afterInstallPolls += 1;
      if (afterInstallPolls === 1) return 'abort';
      return update({
        state: 'succeeded',
        code: 'succeeded',
        message: 'The approved MCC update completed and passed its health check.',
        installedVersion: '1.3.0',
        installedCommit: 'def5678',
        startedAt: timestamp,
        completedAt: '2026-07-29T12:02:00.000Z',
        outcome: 'succeeded',
        checkToken: null,
        checkExpiresAt: null,
        active: false,
      });
    },
  });
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Update to v1.3.0' }).click();
  await page.getByRole('dialog', { name: 'MCC Update Available' }).getByRole('button', { name: 'Install Update' }).click();
  const progress = page.getByRole('dialog');
  await expect(progress).toContainText('temporarily unavailable', { timeout: 7_000 });
  await expect(page.getByRole('dialog', { name: 'Update Complete' })).toContainText('MCC v1.3.0 is running', { timeout: 12_000 });
  await expect(page.getByRole('dialog', { name: 'Update Complete' })).toContainText('Build def5678');
  expect(afterInstallPolls).toBeGreaterThanOrEqual(2);
  if(testInfo.project.name==='desktop-chromium')await captureApproval(page,'05-successful-update-reconnect.png');
});

test('automatic rollback remains visible and identifies the restored version', async ({ page },testInfo) => {
  let installed = false;
  await mockSettings(page, {
    onInstall: () => {
      installed = true;
      return update({
        state: 'queued',
        code: 'queued',
        message: 'The update is queued.',
        startedAt: timestamp,
        completedAt: null,
        checkToken: null,
        checkExpiresAt: null,
        active: true,
      });
    },
    onStatus: () => installed ? update({
      state: 'rolled_back',
      code: 'rolled_back',
      message: 'The update failed. MCC was restored to the previous healthy version.',
      startedAt: timestamp,
      completedAt: '2026-07-29T12:03:00.000Z',
      outcome: 'rolled_back',
      checkToken: null,
      checkExpiresAt: null,
      active: false,
    }) : availableUpdate,
  });
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Update to v1.3.0' }).click();
  await page.getByRole('dialog', { name: 'MCC Update Available' }).getByRole('button', { name: 'Install Update' }).click();
  const rollback = page.getByRole('dialog', { name: 'Update Failed' });
  await expect(rollback).toContainText('MCC was restored to v1.2.1', { timeout: 7_000 });
  await expect(rollback).toContainText('Previous version is running normally');
  await expect(rollback).toContainText('Automatic rollback completed and was not hidden');
  if(testInfo.project.name==='desktop-chromium')await captureApproval(page,'06-rollback-visible.png');
});

test('Admin updater panel is responsive at desktop, Pi-size, and 390px mobile', async ({ page },testInfo) => {
  await mockSettings(page);
  await page.goto('/settings');
  const panel = page.getByRole('complementary', { name: 'MCC system version' });
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1024, height: 600 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(panel).toBeVisible();
    await expect(page.getByRole('button', { name: 'Update to v1.3.0' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    if(viewport.width===390&&testInfo.project.name==='desktop-chromium')await captureApproval(page,'07-mobile-390-update-available.png');
  }
});

for (const role of ['Manager', 'Maintenance Tech 1', 'Maintenance Tech 2', 'Maintenance Tech 3']) {
  test(`${role} cannot render or request updater metadata`, async ({ page },testInfo) => {
    const fixture = await mockSettings(page, { role, canViewSystemVersion: false });
    await page.goto('/settings');
    await expect(page.getByRole('complementary', { name: 'MCC system version' })).toHaveCount(0);
    expect(fixture.statusRequests()).toBe(0);
    expect(fixture.checkRequests()).toBe(0);
    expect(fixture.installRequests()).toBe(0);
    if(role==='Manager'&&testInfo.project.name==='desktop-chromium')await captureApproval(page,'08-manager-update-control-hidden.png');
  });
}
