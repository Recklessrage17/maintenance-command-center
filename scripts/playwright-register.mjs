// Inherited by every Node subprocess, including Playwright workers and the server.
import { readRun, registerProcess } from './playwright-storage.mjs';
if (!process.env.MCC_PLAYWRIGHT_RUN_ID) throw new Error('Missing managed Playwright run');
registerProcess(readRun(process.env.MCC_PLAYWRIGHT_RUN_ID));
