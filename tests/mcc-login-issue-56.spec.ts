import { expect, type Page, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const artifactDirectory = resolve(process.cwd(), 'artifacts', 'issue-56');
const fullPermissions = [
  'inventory.view',
  'vendors.view',
  'requisitions.view',
  'history.view',
  'machine.view',
  'equipment.view',
  'facility.view',
];
const owner = {
  id: 1,
  fullName: 'MCC Owner',
  email: 'owner@example.com',
  role: 'Admin',
  isOwnerAdmin: true,
  forcePasswordChange: false,
  effectivePermissions: fullPermissions,
};
const presencePolicy = {
  heartbeatIntervalMs: 45_000,
  rosterRefreshIntervalMs: 25_000,
  onlineThresholdMs: 120_000,
  awayAfterMs: 600_000,
  writeThrottleMs: 25_000,
};

async function mockLoginAndDashboard(page: Page) {
  let authenticated = false;
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (path === '/api/auth/status') {
      return route.fulfill({ json: { setupRequired: false, user: authenticated ? owner : null } });
    }
    if (path === '/api/auth/login') {
      const credentials = request.postDataJSON() as { email?: string; password?: string };
      await new Promise(resolveDelay => setTimeout(resolveDelay, 90));
      if (credentials.email !== owner.email || credentials.password !== 'Correct-Password!7') {
        return route.fulfill({ status: 401, json: { error: 'Invalid email or password.' } });
      }
      authenticated = true;
      return route.fulfill({ json: { user: owner } });
    }
    if (path === '/api/auth/forgot-password') {
      return route.fulfill({
        json: { message: 'If the email matches an account, password reset instructions will be sent.' },
      });
    }
    if (path === '/api/settings/branding') {
      return route.fulfill({
        json: {
          branding: {
            companyName: 'MCC',
            companySubtitle: 'Maintenance Command Center',
            companyAccentText: '',
            logoMode: 'text',
            logoUrl: '',
            iconAnimation: 'none',
          },
        },
      });
    }
    if (path === '/api/presence/heartbeat') {
      return route.fulfill({
        json: { ok: true, serverTime: '2026-07-28T14:00:00.000Z', written: true, policy: presencePolicy },
      });
    }
    if (path === '/api/presence/team') {
      return route.fulfill({
        json: {
          serverTime: '2026-07-28T14:00:00.000Z',
          policy: presencePolicy,
          totalUsers: 1,
          activeUsers: 1,
          onlineCount: 1,
          awayCount: 0,
          offlineCount: 0,
          disabledCount: 0,
          users: [],
        },
      });
    }
    if (path === '/api/requisitions/summary') {
      return route.fulfill({
        json: { requestedCount: 3, orderedCount: 2, receivedCount: 8, canceledCount: 0, activeCount: 5 },
      });
    }
    if (path === '/api/dashboard/preventive-maintenance-due') {
      return route.fulfill({ json: { alerts: [], summary: { dueSoon: 0, dueNow: 0, pastDue: 0 } } });
    }

    return route.fulfill({ json: { ok: true } });
  });
}

async function expectContained(page: Page) {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

test('logon screen is contained at MCC target viewports', async ({ page }, testInfo) => {
  await mockLoginAndDashboard(page);
  await mkdir(artifactDirectory, { recursive: true });

  const viewports = testInfo.project.name === 'mobile-chromium'
    ? [{ width: 390, height: 844, name: 'logon-mobile-390x844.png' }]
    : [
        { width: 1366, height: 768, name: 'logon-1366x768.png' },
        { width: 1920, height: 1080, name: 'logon-1920x1080.png' },
      ];

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Enter command center' })).toBeVisible();
    await expect(page.getByText('System Online', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'ENTER COMMAND CENTER' })).toBeVisible();
    await expect(page.getByLabel('Email address')).toHaveAttribute('autocomplete', 'email');
    await expect(page.getByLabel('Password')).toHaveAttribute('autocomplete', 'current-password');
    await expectContained(page);

    const controlHeights = await page.locator('.mcc-login input, .mcc-login button').evaluateAll(elements =>
      elements.map(element => Math.round(element.getBoundingClientRect().height)),
    );
    expect(controlHeights.every(height => height >= 44)).toBe(true);

    await page.screenshot({ path: resolve(artifactDirectory, viewport.name), fullPage: true });
  }
});

test('invalid, recovery, keyboard login, authenticating, and dashboard flows remain intact', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Desktop flow and approval screenshot');
  await mockLoginAndDashboard(page);
  await mkdir(artifactDirectory, { recursive: true });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');

  await page.getByLabel('Email address').fill('owner@example.com');
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByLabel('Password').press('Enter');
  await expect(page.getByRole('alert')).toHaveText('Invalid email or password.');
  await expect(page.getByRole('button', { name: 'ENTER COMMAND CENTER' })).toBeEnabled();

  await page.getByRole('button', { name: 'Forgot Password' }).click();
  await expect(page.getByRole('heading', { name: 'Forgot Password' })).toBeVisible();
  await page.getByLabel('Email').fill('owner@example.com');
  await page.getByRole('button', { name: 'Request Reset' }).click();
  await expect(page.getByText('If the email matches an account, password reset instructions will be sent.')).toBeVisible();
  await page.getByRole('button', { name: 'Back to Login' }).click();
  await expect(page.getByRole('heading', { name: 'Enter command center' })).toBeVisible();

  await page.getByLabel('Email address').fill('owner@example.com');
  await page.getByLabel('Password').fill('Correct-Password!7');
  await page.getByLabel('Password').press('Enter');
  const submit = page.locator('.mcc-login__submit');
  await expect(submit).toBeDisabled();
  await expect(submit).toContainText('AUTHENTICATING');
  await expect(submit).toContainText('ACCESS GRANTED');

  await expect(page.locator('.mcc-shell')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expectContained(page);
  await page.screenshot({
    path: resolve(artifactDirectory, 'dashboard-after-logon-1366x768.png'),
    fullPage: true,
  });

  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('.mcc-shell')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});

test('reduced motion keeps login state legible without animation', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Single reduced-motion audit');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockLoginAndDashboard(page);
  await page.goto('/');

  const motion = await page.locator('.mcc-login').evaluate(element => {
    const online = element.querySelector('.mcc-login__online > span')!;
    const submit = element.querySelector('.mcc-login__submit')!;
    return {
      onlineAnimation: getComputedStyle(online).animationName,
      submitTransition: getComputedStyle(submit).transitionDuration,
      sweepAnimation: getComputedStyle(submit, '::after').animationName,
    };
  });

  expect(motion.onlineAnimation).toBe('none');
  expect(motion.submitTransition).toBe('0s');
  expect(motion.sweepAnimation).toBe('none');
});

test('session loading, first-admin setup, and forced password change still render', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Single pre-auth flow audit');

  await page.route('**/api/auth/status', async route => {
    await new Promise(resolveDelay => setTimeout(resolveDelay, 180));
    return route.fulfill({ json: { setupRequired: false, user: null } });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Loading MCC' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Enter command center' })).toBeVisible();

  await page.unroute('**/api/auth/status');
  await page.route('**/api/auth/status', route =>
    route.fulfill({ json: { setupRequired: true, user: null } }),
  );
  await page.reload();
  await expect(page.getByRole('heading', { name: 'First Admin Setup' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create First Admin' })).toBeVisible();

  await page.unroute('**/api/auth/status');
  await page.route('**/api/auth/status', route =>
    route.fulfill({ json: { setupRequired: false, user: { ...owner, forcePasswordChange: true } } }),
  );
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Change Password Required' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save New Password' })).toBeVisible();
});
