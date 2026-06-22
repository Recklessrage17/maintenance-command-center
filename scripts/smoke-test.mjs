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
  const [layout, app, inventory, pm, assets, prints] = await Promise.all([
    readFile('frontend/src/layout/MccLayout.tsx', 'utf8'),
    readFile('frontend/src/App.tsx', 'utf8'),
    readFile('frontend/src/modules/inventory/InventoryPage.tsx', 'utf8'),
    readFile('frontend/src/modules/preventive-maintenance/PreventiveMaintenancePage.tsx', 'utf8'),
    readFile('frontend/src/modules/assets/AssetsPage.tsx', 'utf8'),
    readFile('frontend/src/modules/documents/DocumentsPage.tsx', 'utf8'),
  ]);

  const requiredTabs = [
    ['Inventory', "'inventory'", 'InventoryPage'],
    ['Preventive Maintenance', "'preventive-maintenance'", 'PreventiveMaintenancePage'],
    ['Assets', "'assets'", 'AssetsPage'],
    ['Building Prints', "'building-prints'", 'DocumentsPage'],
  ];

  for (const [label, sectionId, component] of requiredTabs) {
    assert(layout.includes(`label: '${label}'`), `Missing ${label} tab in MCC navigation.`);
    assert(layout.includes(sectionId), `Missing ${label} section id in MCC section type/navigation.`);
    assert(app.includes(component), `Missing ${label} page component wiring in App.tsx.`);
  }

  assert(inventory.includes('InventoryPage'), 'Inventory page module did not load for smoke inspection.');
  assert(pm.includes('Preventive Maintenance'), 'Preventive Maintenance page placeholder heading is missing.');
  assert(assets.includes('Assets'), 'Assets page placeholder heading is missing.');
  assert(prints.includes('Documents / Prints'), 'Building Prints/Documents page placeholder heading is missing.');
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

