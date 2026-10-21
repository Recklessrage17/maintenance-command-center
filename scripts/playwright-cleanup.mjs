import fs from 'node:fs';
import { cleanupRun, runsRoot } from './playwright-storage.mjs';

const args = process.argv.slice(2);
if (args.some(arg => !['--apply', '--run'].includes(arg) && !/^run-\d+-[0-9a-f-]{36}$/.test(arg)) ||
    (args.includes('--run') && !args[args.indexOf('--run') + 1]?.startsWith('run-'))) {
  throw new Error('Usage: node scripts/playwright-cleanup.mjs [--run <run-id>] [--apply]');
}
const ids = args.includes('--run') ? [args[args.indexOf('--run') + 1]] :
  (fs.existsSync(runsRoot) ? fs.readdirSync(runsRoot) : []);
for (const id of ids) {
  try {
    cleanupRun(id, { apply: args.includes('--apply') });
    console.log(`${args.includes('--apply') ? 'Removed' : 'Eligible (dry run)'}: ${id}`);
  } catch (error) { console.error(`Retained ${id}: ${error.message}`); process.exitCode = 1; }
}
if (!ids.length) console.log('No managed stale runs. Legacy/unmarked directories are never swept.');
