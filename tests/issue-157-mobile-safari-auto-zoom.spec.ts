import { expect, test } from '@playwright/test';

test('phone text controls avoid Safari focus zoom without restricting the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/auth/status', route => route.fulfill({ json: { setupRequired: false, user: null } }));
  await page.goto('/');

  const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
  expect(viewport).toContain('width=device-width');
  expect(viewport).toContain('initial-scale=1.0');
  expect(viewport).toContain('viewport-fit=cover');
  expect(viewport).not.toMatch(/user-scalable=no|maximum-scale=1/);

  await expect(page.locator('#mcc-login-email')).toBeVisible();
  await page.evaluate(() => {
    const form = document.createElement('div');
    form.innerHTML = '<input class="glass-input" type="search" aria-label="Machine mobile Search"><input class="glass-input" type="search" aria-label="Equipment mobile Search"><label class="form-field">Settings input<input type="text"></label><select class="glass-input" aria-label="Select"><option>Option</option></select><textarea class="glass-input" aria-label="Textarea"></textarea><input type="checkbox" aria-label="Checkbox">';
    form.style.cssText = 'width: min(300px, 100%); position: absolute; left: 0; top: 0; visibility: hidden';
    document.body.append(form);
  });
  for (const selector of ['#mcc-login-email', '#mcc-login-password', '[aria-label="Machine mobile Search"]', '[aria-label="Equipment mobile Search"]', '.form-field input', 'select.glass-input', 'textarea.glass-input']) {
    const size = await page.locator(selector).first().evaluate(element => parseFloat(getComputedStyle(element).fontSize));
    expect(size, selector).toBeGreaterThanOrEqual(16);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test('tablet and desktop input typography retain their existing size', async ({ page }) => {
  await page.route('**/api/auth/status', route => route.fulfill({ json: { setupRequired: false, user: null } }));
  for (const width of [768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.locator('#mcc-login-email')).toBeVisible();
    expect(await page.locator('#mcc-login-email').evaluate(element => getComputedStyle(element).fontSize)).toBe('15.2px');
    expect(await page.evaluate(() => {
      const input = document.createElement('input');
      document.body.append(input);
      const size = getComputedStyle(input).fontSize;
      input.remove();
      return size;
    })).toBe('14.88px');
  }
});
