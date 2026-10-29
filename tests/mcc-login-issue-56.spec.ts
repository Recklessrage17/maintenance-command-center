import { expect, type Page, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const artifactDirectory = resolve(process.env.MCC_PLAYWRIGHT_DIAGNOSTICS!, 'visual', 'issue-210');
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
  heartbeatIntervalMs: 25_000,
  rosterRefreshIntervalMs: 25_000,
  onlineTimeoutMs: 90_000,
  awayAfterMs: 300_000,
  writeThrottleMs: 20_000,
};

async function mockLoginAndDashboard(page: Page, forcePasswordChange = false) {
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
      return route.fulfill({ json: { user: { ...owner, forcePasswordChange } } });
    }
    if (path === '/api/auth/forgot-password') {
      await new Promise(resolveDelay => setTimeout(resolveDelay, 90));
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
    if (path === '/api/dashboard/inventory-attention') {
      return route.fulfill({ json: { items: [], outOfStockCount: 0, lowStockCount: 0 } });
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
        { width: 1585, height: 992, name: 'logon-approved-reference-size.png' },
        { width: 768, height: 1024, name: 'logon-tablet-768x1024.png' },
      ];

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Enter command center' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'JBT USA' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'SIGN IN TO MCC' })).toBeVisible();
    await expect(page.getByLabel('Email address', { exact: true })).toHaveAttribute('autocomplete', 'email');
    await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('autocomplete', 'current-password');
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await expect(page.getByText(/System Online|Encrypted local session/i)).toHaveCount(0);
    const card = await page.locator('.mcc-login__concept-card').boundingBox();
    expect(card!.width).toBeLessThanOrEqual(590);
    expect(Math.abs(card!.x + card!.width / 2 - viewport.width / 2)).toBeLessThan(2);
    await expectContained(page);
    await expect(page.locator('.mcc-login__concept-card')).toHaveCSS('opacity', '1');

    const controlHeights = await page.locator('.mcc-login input, .mcc-login button').evaluateAll(elements =>
      elements.map(element => Math.round(element.getBoundingClientRect().height)),
    );
    expect(controlHeights.every(height => height >= 44)).toBe(true);

    await page.screenshot({ path: resolve(artifactDirectory, viewport.name), fullPage: true });

    await page.getByRole('button', { name: 'Forgot Password' }).click();
    await expect(page.locator('.mcc-reset__panel')).toBeVisible();
    await expect(page.getByText('Secure reset', { exact: true })).toBeVisible();
    await page.getByLabel('Email').focus();
    const resetFocus = await page.getByLabel('Email').evaluate(element => ({
      borderColor: getComputedStyle(element).borderColor,
      boxShadow: getComputedStyle(element).boxShadow,
    }));
    expect(resetFocus.boxShadow).not.toBe('none');
    expect(resetFocus.borderColor).not.toBe('rgba(0, 0, 0, 0)');
    const resetButton = page.getByRole('button', { name: 'Request Reset' });
    await resetButton.hover();
    expect(await resetButton.evaluate(element => getComputedStyle(element).boxShadow)).not.toBe('none');
    const resetControlHeights = await page.locator('.mcc-reset input, .mcc-reset button').evaluateAll(elements =>
      elements.map(element => Math.round(element.getBoundingClientRect().height)),
    );
    expect(resetControlHeights.every(height => height >= 44)).toBe(true);
    await expectContained(page);
    await page.screenshot({
      path: resolve(artifactDirectory, `forgot-${viewport.name}`),
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Back to Login' }).click();
    await expect(page.getByRole('heading', { name: 'Enter command center' })).toBeVisible();
  }
});

test('invalid, recovery, keyboard login, authenticating, and dashboard flows remain intact', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Desktop flow and approval screenshot');
  await mockLoginAndDashboard(page);
  await mkdir(artifactDirectory, { recursive: true });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');

  await page.getByLabel('Email address').fill('owner@example.com');
  await page.getByLabel('Password', { exact: true }).fill('wrong-password');
  await page.getByLabel('Password', { exact: true }).press('Enter');
  await expect(page.getByRole('alert')).toHaveText('Invalid email or password.');
  await expect(page.getByRole('button', { name: 'SIGN IN TO MCC' })).toBeEnabled();

  await page.getByRole('button', { name: 'Forgot Password' }).click();
  await expect(page.getByRole('heading', { name: 'Forgot Password' })).toBeVisible();
  await page.getByLabel('Email').fill('owner@example.com');
  await page.getByRole('button', { name: 'Request Reset' }).click();
  await expect(page.getByRole('button', { name: 'REQUESTING RESET' })).toBeDisabled();
  await expect(page.getByText('If the email matches an account, password reset instructions will be sent.')).toBeVisible();
  await page.screenshot({ path: resolve(artifactDirectory, 'forgot-success-1366x768.png'), fullPage: true });
  await page.getByRole('button', { name: 'Back to Login' }).click();
  await expect(page.getByRole('heading', { name: 'Enter command center' })).toBeVisible();

  await page.getByLabel('Email address').fill('owner@example.com');
  await page.getByLabel('Password', { exact: true }).fill('Correct-Password!7');
  await page.getByLabel('Password', { exact: true }).press('Enter');
  const submit = page.locator('.mcc-login__submit');
  await expect(submit).toBeDisabled();
  await expect(submit).toContainText('AUTHENTICATING');
  await expect(submit).toContainText('ACCESS GRANTED');

  await expect(page.locator('.mcc-shell')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText('All enabled stock alerts are clear.')).toBeVisible();
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
    const card = element.querySelector('.mcc-login__concept-card')!;
    const submit = element.querySelector('.mcc-login__submit')!;
    return {
      cardAnimation: getComputedStyle(card).animationName,
      glowAnimation: getComputedStyle(card, '::before').animationName,
      submitTransition: getComputedStyle(submit).transitionDuration,
      sweepAnimation: getComputedStyle(submit, '::after').animationName,
    };
  });

  expect(motion.cardAnimation).toBe('none');
  expect(motion.glowAnimation).toBe('none');
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

test('pill controls support keyboard, visibility, touch, and a shortened viewport', async ({ page }, testInfo) => {
  await mockLoginAndDashboard(page);
  await page.goto('/');
  const email = page.getByLabel('Email address', { exact: true });
  const password = page.getByLabel('Password', { exact: true });
  await expect(email).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(email).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(password).toBeFocused();
  await password.fill('Synthetic-Visibility!9');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Show password' })).toBeFocused();
  await page.keyboard.press('Space');
  await expect(password).toHaveAttribute('type', 'text');
  await expect(page.getByRole('button', { name: 'Hide password' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Space');
  await expect(password).toHaveAttribute('type', 'password');
  await expect(password).toHaveValue('Synthetic-Visibility!9');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Forgot Password?' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'SIGN IN TO MCC' })).toBeFocused();
  expect(await page.locator('.mcc-login__submit').evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');

  if (testInfo.project.name === 'mobile-chromium') {
    await email.tap();
    await expect(email).toBeFocused();
    await page.setViewportSize({ width: 390, height: 420 });
  } else {
    // 200% layout zoom at the 1366x768 laptop size; controls remain scroll reachable.
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  }
  await password.fill('');
  await page.locator('.mcc-login__submit').scrollIntoViewIfNeeded();
  await expect(page.locator('.mcc-login__submit')).toBeInViewport();
  await expectContained(page);
  await page.screenshot({ path: testInfo.outputPath('login-zoom-or-keyboard.png'), fullPage: true });
});

test('successful temporary-password sign-in enters the required change flow', async ({ page }) => {
  await mockLoginAndDashboard(page, true);
  await page.goto('/');
  await page.getByLabel('Email address', { exact: true }).fill(owner.email);
  await page.getByLabel('Password', { exact: true }).fill('Correct-Password!7');
  const request = page.waitForRequest('**/api/auth/login');
  await page.getByRole('button', { name: 'SIGN IN TO MCC' }).click();
  expect((await request).postDataJSON()).toEqual({ email: owner.email, password: 'Correct-Password!7' });
  await expect(page.getByRole('heading', { name: 'Change Password Required' })).toBeVisible();
  const storage = await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(storage.local).toEqual({});
  // Existing presence identity is unrelated to credentials/session authentication.
  expect(Object.keys(storage.session)).toEqual(['mcc_presence_client_instance']);
  expect(JSON.stringify(storage)).not.toContain('Correct-Password!7');
  expect(JSON.stringify(storage)).not.toContain(owner.email);
});
