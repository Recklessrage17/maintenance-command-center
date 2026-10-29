import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

test('real cookies, login errors, required password rotation, logout, and recovery stay intact', async ({ page, playwright }, testInfo) => {
  // Keep the existing ESM fixture helper in Node's native loader. This spec is
  // transformed as CommonJS by Playwright; requiring it would lose import.meta.
  const { backendFixture } = await new Function('url', 'return import(url)')(
    pathToFileURL(resolve('tests/helpers/security-process.mjs')).href,
  );
  const runtime = await backendFixture('patch3-auth', {}, { serveFrontend: true });
  const request = await playwright.request.newContext({ baseURL: runtime.base });
  try {
  const ownerPassword = 'Owner-Patch3!9Aa';
  const temporaryPassword = 'Temporary-Patch3!9';
  const changedPassword = 'Changed-Patch3!8Aa';
  const email = `${testInfo.project.name}@example.test`;
  // This nested backend/database belongs to the managed runner. API cookies are
  // separate from the page context so the browser starts unauthenticated.
  const status = await (await request.get('/api/auth/status')).json();
  if (status.setupRequired) {
    const setup = await request.post('/api/auth/setup-first-admin', { data: {
      fullName: 'Synthetic Owner', email: 'owner@example.test',
      password: ownerPassword, confirmPassword: ownerPassword,
    } });
    expect(setup.status()).toBe(200);
  }
  expect((await request.post('/api/auth/login', { data: { email: 'owner@example.test', password: ownerPassword } })).status()).toBe(200);
  const created = await request.post('/api/users', { data: {
    fullName: 'Synthetic Operator', email, role: 'Maintenance Tech 1', temporaryPassword,
  } });
  expect(created.status()).toBe(201);
  await page.goto(runtime.base);
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Wrong-Synthetic!9');
  await page.getByRole('button', { name: 'SIGN IN TO MCC' }).click();
  await expect(page.getByRole('alert')).toHaveText('Invalid email or password.');
  await page.getByLabel('Password', { exact: true }).fill(temporaryPassword);
  await page.getByLabel('Password', { exact: true }).press('Enter');
  await expect(page.getByRole('heading', { name: 'Change Password Required' })).toBeVisible();
  const session = (await page.context().cookies()).find(item => item.name === 'mcc_session');
  expect(session).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Change Password Required' })).toBeVisible();
  await page.getByLabel('Temporary/current password', { exact: true }).fill(temporaryPassword);
  await page.getByLabel('New password', { exact: true }).fill(changedPassword);
  await page.getByLabel('Confirm new password', { exact: true }).fill(changedPassword);
  await page.getByRole('button', { name: 'Save New Password' }).click();
  await expect(page.locator('.mcc-shell')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('.mcc-shell')).toBeVisible();
  await page.context().request.post(`${runtime.base}/api/auth/logout`);
  await page.reload();
  await expect(page.getByRole('button', { name: 'SIGN IN TO MCC' })).toBeVisible();

  expect((await request.post('/api/auth/login', { data: { email, password: temporaryPassword } })).status()).toBe(401);
  const newLogin = await request.post('/api/auth/login', { data: { email, password: changedPassword } });
  expect(newLogin.status()).toBe(200);
  const loginBody = await newLogin.json();
  expect(loginBody.user.forcePasswordChange).toBe(false);
  expect(JSON.stringify(loginBody)).not.toContain(changedPassword);
  expect(JSON.stringify(loginBody)).not.toContain(temporaryPassword);

  await page.getByRole('button', { name: 'Forgot Password?' }).click();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Request Reset' }).click();
  const genericMessage = 'If the email matches an account, password reset instructions will be sent.';
  await expect(page.getByText(genericMessage, { exact: true })).toBeVisible();
  const unknown = await request.post('/api/auth/forgot-password', { data: { email: 'unknown@example.test' } });
  expect((await unknown.json()).message).toBe(genericMessage);
  expect((await (await request.get('/api/auth/status')).json()).user).toBeNull();
  } finally {
    await request.dispose();
    await runtime.close();
    await testInfo.attach('isolated-auth-backend-log', { body: runtime.output(), contentType: 'text/plain' });
  }
});
