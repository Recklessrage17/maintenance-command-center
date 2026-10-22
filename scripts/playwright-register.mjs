// Inherited by every Node subprocess, including Playwright workers and the server.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { readRun, registerProcess, root } from './playwright-storage.mjs';
if (!process.env.MCC_PLAYWRIGHT_RUN_ID) throw new Error('Missing managed Playwright run');
const run = readRun(process.env.MCC_PLAYWRIGHT_RUN_ID);
registerProcess(run);
register('./playwright-fixture-loader.mjs', import.meta.url, { data: {
  fixtureRoot: pathToFileURL(`${run.directory}${path.sep}`).href,
  dependencyParent: pathToFileURL(path.join(root, 'backend/dist/server/index.js')).href,
} });
