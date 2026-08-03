import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

const testPort = process.env.MCC_PLAYWRIGHT_PORT ?? '4273';
const baseURL = `http://localhost:${testPort}`;
const testStorageRoot = resolve('tmp', `playwright-${process.pid}`);

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  reporter: 'line',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: testPort === '4273' ? 'npm start' : `npm run preview --prefix frontend -- --host 127.0.0.1 --port ${testPort}`,
    url: testPort === '4273' ? `${baseURL}/api/health` : baseURL,
    reuseExistingServer: false,
    env: {
      NODE_ENV: 'test',
      MCC_DATA_DIR: resolve(testStorageRoot, 'data'),
      MCC_UPLOADS_DIR: resolve(testStorageRoot, 'uploads'),
      MCC_BACKUPS_DIR: resolve(testStorageRoot, 'backups'),
    },
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
