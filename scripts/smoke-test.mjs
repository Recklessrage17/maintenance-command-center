import { spawn, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const baseUrl = process.env.MCC_SMOKE_URL ?? 'http://127.0.0.1:4273';
const startupTimeoutMs = Number(process.env.MCC_SMOKE_TIMEOUT_MS ?? 15000);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForHealth() {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < startupTimeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      const body = await response.json();
      if (response.ok && body.ok === true) return body;
      lastError = new Error(`Health returned ${response.status}: ${JSON.stringify(body)}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`MCC did not become healthy within ${startupTimeoutMs}ms. Last error: ${lastError?.message ?? lastError}`);
}

async function fetchShellHtml() {
  const response = await fetch(baseUrl);
  const html = await response.text();
  assert(response.ok, `Expected app shell HTML to return OK, got ${response.status}.`);
  assert(html.includes('<div id="root"></div>'), 'Expected Vite root element in app shell HTML.');
  assert(html.includes('/assets/'), 'Expected built frontend asset references in app shell HTML.');
  return html;
}

async function assertSourceWiring() {
  const [layout, app, inventory, vendors, history, pm, assets, prints] = await Promise.all([
    readFile('frontend/src/layout/MccLayout.tsx', 'utf8'),
    readFile('frontend/src/App.tsx', 'utf8'),
    readFile('frontend/src/modules/inventory/InventoryPage.tsx', 'utf8'),
    readFile('frontend/src/modules/vendors/VendorsPage.tsx', 'utf8'),
    readFile('frontend/src/modules/history/HistoryPage.tsx', 'utf8'),
    readFile('frontend/src/modules/machine-library/MachineLibraryPage.tsx', 'utf8'),
    readFile('frontend/src/modules/equipment-library/EquipmentLibraryPage.tsx', 'utf8'),
    readFile('frontend/src/modules/facility-info/FacilityInfoPage.tsx', 'utf8'),
  ]);

  const requiredTabs = [
    ['Inventory', "'inventory'", 'InventoryPage'],
    ['Vendors', "'vendors'", 'VendorsPage'],
    ['History Logs', "'history'", 'HistoryPage'],
    ['Machine Library', "'machine-library'", 'MachineLibraryPage'],
    ['Equipment Library', "'equipment-library'", 'EquipmentLibraryPage'],
    ['Facility Info', "'facility-info'", 'FacilityInfoPage'],
  ];

  for (const [label, sectionId, component] of requiredTabs) {
    assert(layout.includes(`label: '${label}'`), `Missing ${label} tab in MCC navigation.`);
    assert(layout.includes(sectionId), `Missing ${label} section id in MCC section type/navigation.`);
    assert(app.includes(component), `Missing ${label} page component wiring in App.tsx.`);
  }

  assert(inventory.includes('InventoryPage'), 'Inventory page module did not load for smoke inspection.');
  assert(vendors.includes('Manage vendor companies'), 'Vendors page module did not load for smoke inspection.');
  assert(layout.includes("i.id !== 'history' || canViewHistory"), 'History Logs navigation is not gated by role.');
  assert(app.includes('canViewHistory') && app.includes("user.role === 'Admin' || user.role === 'Manager'"), 'History Logs route is not limited to Admin/Manager users.');
  assert(history.includes('History Logs'), 'History Logs page module did not load for smoke inspection.');
  assert(pm.includes('Injection molding machine records, technical specs, replacement tracking, brand colors, and machine-specific history.'), 'Machine Library page shell is missing.');
  assert(assets.includes('Auxiliary and support equipment records, PMs, parts, and documents.'), 'Equipment Library page shell is missing.');
  assert(prints.includes('Building prints, facility documents, and plant reference information.'), 'Facility Info page shell is missing.');
}

const isWindows = process.platform === 'win32';
const npmCommand = 'npm';
const server = spawn(npmCommand, ['start'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, HOST: '127.0.0.1' },
  detached: !isWindows,
  shell: isWindows,
  windowsHide: isWindows,
});

let serverOutput = '';
server.stdout.on('data', (chunk) => { serverOutput += chunk; });
server.stderr.on('data', (chunk) => { serverOutput += chunk; });

try {
  const health = await waitForHealth();
  await fetchShellHtml();
  await assertSourceWiring();
  console.log(`MCC smoke test passed: ${health.app ?? 'app'} healthy on port ${health.port ?? 4273}.`);
} catch (error) {
  console.error('MCC smoke test failed.');
  console.error(error instanceof Error ? error.message : error);
  if (serverOutput.trim()) {
    console.error('\nServer output:');
    console.error(serverOutput.trim());
  }
  process.exitCode = 1;
} finally {
  if (server.pid) {
    try {
      if (isWindows) spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
      else process.kill(-server.pid, 'SIGTERM');
    } catch {
      server.kill('SIGTERM');
    }
  }
}

