import { expect, type Page, test } from '@playwright/test';

async function mockRequisitionBatchEditor(page: Page) {
  const unhandled = new Set<string>();
  await page.route('**/api/**', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/auth/status') {
      return route.fulfill({
        json: {
          setupRequired: false,
          user: {
            id: 1,
            fullName: 'Date Input Tester',
            email: 'date-input@example.com',
            role: 'Admin',
            isOwnerAdmin: true,
            forcePasswordChange: false,
          },
        },
      });
    }
    if (url.pathname === '/api/requisition-batches') {
      return route.fulfill({ json: { ok: true, batches: [] } });
    }
    if (url.pathname === '/api/requisitions/summary') {
      return route.fulfill({
        json: {
          ok: true,
          requestedCount: 0,
          orderedCount: 0,
          receivedCount: 0,
          canceledCount: 0,
          activeCount: 0,
        },
      });
    }
    if (url.pathname === '/api/inventory/native/parts') {
      return route.fulfill({ json: { ok: true, parts: [] } });
    }
    if (url.pathname === '/api/settings/branding') {
      return route.fulfill({
        json: {
          ok: true,
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
    if (url.pathname === '/api/presence/heartbeat') {
      return route.fulfill({
        json: {
          ok: true,
          serverTime: '2026-07-24T14:00:00.000Z',
          written: true,
          policy: {
            heartbeatIntervalMs: 45_000,
            rosterRefreshIntervalMs: 25_000,
            onlineThresholdMs: 120_000,
            awayAfterMs: 600_000,
            writeThrottleMs: 25_000,
          },
        },
      });
    }
    if (url.pathname === '/api/presence/team') {
      return route.fulfill({
        json: {
          serverTime: '2026-07-24T14:00:00.000Z',
          policy: {
            heartbeatIntervalMs: 45_000,
            rosterRefreshIntervalMs: 25_000,
            onlineThresholdMs: 120_000,
            awayAfterMs: 600_000,
            writeThrottleMs: 25_000,
          },
          totalUsers: 0,
          activeUsers: 0,
          onlineCount: 0,
          awayCount: 0,
          offlineCount: 0,
          disabledCount: 0,
          users: [],
        },
      });
    }
    unhandled.add(`${request.method()} ${url.pathname}`);
    return route.fulfill({
      status: 404,
      json: { ok: false, error: `Unhandled date-input fixture request: ${url.pathname}` },
    });
  });
  return unhandled;
}

function shiftIsoDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

test('date calendar remains an owned, keyboard-accessible portal inside a legacy dialog', async ({ page }) => {
  const unhandled = await mockRequisitionBatchEditor(page);
  await page.goto('/requisitions');
  await page.getByRole('button', { name: 'Create Requisition Batch' }).click();

  const outerDialog = page.getByRole('dialog', { name: 'Create Requisition Batch' });
  await expect(outerDialog).toBeVisible();
  await expect(outerDialog).toHaveAttribute('data-mcc-legacy-dialog', '');

  const dateField = outerDialog.locator('.machine-date-field').filter({ hasText: 'Needed-by Date' });
  const input = dateField.locator('input');
  const trigger = dateField.getByRole('button', { name: 'Open Needed-by Date calendar' });

  for (const control of [input, trigger]) {
    await expect(control).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(control).toHaveAttribute('aria-expanded', 'false');
  }
  const calendarId = await input.getAttribute('aria-controls');
  expect(calendarId).toMatch(/^mcc-date-calendar-/);
  await expect(trigger).toHaveAttribute('aria-controls', calendarId!);
  await expect(page.locator(`#${calendarId}`)).toHaveCount(0);

  await input.press('ArrowDown');
  const calendar = page.locator(`#${calendarId}`);
  await expect(calendar).toBeVisible();
  await expect(calendar).toHaveRole('dialog');
  await expect(calendar).toHaveAccessibleName('Needed-by Date calendar');
  await expect(page.locator(`body > #${calendarId}`)).toHaveCount(1);
  await expect(outerDialog.locator(`#${calendarId}`)).toHaveCount(0);
  await expect(input).toHaveAttribute('aria-expanded', 'true');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');

  const calendarDays = calendar.locator('[data-mcc-calendar-date]');
  await expect(calendarDays).toHaveCount(42);
  await expect(calendar.locator('[data-mcc-calendar-date][tabindex="0"]')).toHaveCount(1);
  const focusedDay = calendar.locator('[data-mcc-calendar-date]:focus');
  await expect(focusedDay).toHaveCount(1);
  await expect(focusedDay).toHaveAttribute('tabindex', '0');
  const startingIso = await focusedDay.getAttribute('data-mcc-calendar-date');
  expect(startingIso).toMatch(/^\d{4}-\d{2}-\d{2}$/);

  const nextIso = shiftIsoDate(startingIso!, 1);
  await page.keyboard.press('ArrowRight');
  const nextDay = calendar.locator(`[data-mcc-calendar-date="${nextIso}"]`);
  await expect(nextDay).toBeFocused();
  await expect(calendar.locator('[data-mcc-calendar-date][tabindex="0"]')).toHaveCount(1);

  const followingWeekIso = shiftIsoDate(nextIso, 7);
  await page.keyboard.press('ArrowDown');
  const followingWeekDay = calendar.locator(`[data-mcc-calendar-date="${followingWeekIso}"]`);
  await expect(followingWeekDay).toBeFocused();
  await expect(calendar.locator('[data-mcc-calendar-date][tabindex="0"]')).toHaveCount(1);

  await page.keyboard.press('Tab');
  await expect(calendar.getByRole('button', { name: 'Clear' })).toBeFocused();
  expect(await outerDialog.evaluate(dialog => !dialog.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Shift+Tab');
  await expect(followingWeekDay).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(calendar).toHaveCount(0);
  await expect(input).toHaveAttribute('aria-expanded', 'false');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(input).toBeFocused();
  await expect(outerDialog).toBeVisible();

  await trigger.focus();
  await trigger.press('ArrowDown');
  await expect(page.locator(`#${calendarId}`)).toBeVisible();
  await expect(page.locator(`#${calendarId} [data-mcc-calendar-date]:focus`)).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator(`#${calendarId}`)).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(outerDialog).toBeVisible();
  expect([...unhandled]).toEqual([]);
});
