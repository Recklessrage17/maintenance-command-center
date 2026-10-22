import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

test('managed cleanup lifecycle probe', async ({ page }) => {
  test.skip(!process.env.MCC_CLEANUP_PROBE, 'Only invoked by cleanup infrastructure checks');
  await page.setContent('<h1>MCC cleanup diagnostic probe</h1>');
  for (const key of ['MCC_DATA_DIR', 'MCC_UPLOADS_DIR', 'MCC_BACKUPS_DIR', 'TMP']) {
    fs.writeFileSync(path.join(process.env[key]!, 'cleanup-probe.txt'), 'owned disposable data');
  }
  fs.writeFileSync(path.join(process.env.MCC_RECOVERY_DIR!, 'probe-snapshot.txt'), 'preserve recovery evidence');
  const fixtureRecovery = path.join(process.env.TMP!, 'fixture', 'recovery');
  fs.mkdirSync(fixtureRecovery, { recursive: true });
  fs.writeFileSync(path.join(fixtureRecovery, 'snapshot.txt'), 'preserve nested fixture recovery');
  if (process.env.MCC_CLEANUP_PROBE === 'interrupt') {
    console.log('CLEANUP_PROBE_READY');
    await new Promise(() => {});
  }
  expect(process.env.MCC_CLEANUP_PROBE, 'intentional failure to verify retained evidence').not.toBe('fail');
});
