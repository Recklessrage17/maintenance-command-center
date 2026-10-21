import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

if (!process.env.MCC_PLAYWRIGHT_RUN_ID) {
  throw new Error('Use npm run test:playwright -- <arguments> so runtime cleanup and diagnostics are managed.');
}
if (!/^run-\d+-[0-9a-f-]{36}$/.test(process.env.MCC_PLAYWRIGHT_RUN_ID)) throw new Error('Invalid managed run ID');
const run = { diagnostics: resolve('diagnostics', 'playwright', process.env.MCC_PLAYWRIGHT_RUN_ID) };
const testPort = process.env.MCC_PLAYWRIGHT_PORT!;
const baseURL = `http://127.0.0.1:${testPort}`;
const frontendOnly = process.env.MCC_PLAYWRIGHT_FRONTEND_ONLY === '1';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  outputDir: resolve(run.diagnostics, 'test-results'),
  reporter: [
    ['line'],
    ['json', { outputFile: resolve(run.diagnostics, 'report.json') }],
    ['html', { outputFolder: resolve(run.diagnostics, 'html'), open: 'never' }],
  ],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: frontendOnly
      ? `node frontend/node_modules/vite/bin/vite.js preview frontend --host 127.0.0.1 --port ${testPort} --strictPort`
      : 'node backend/dist/server/index.js',
    url: frontendOnly ? baseURL : `${baseURL}/api/health`,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 30_000,
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile-chromium',
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
});
