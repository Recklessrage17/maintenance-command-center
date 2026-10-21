import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createRun, cleanupRun, root, activeProcesses } from './playwright-storage.mjs';

const args = process.argv.slice(2);
// These overrides can cause Playwright to erase another run's evidence or bypass isolation.
if (args.some(arg => /^-c/.test(arg) || /^--(config|output|reporter|ui|ui-host|ui-port)(=|$)/.test(arg))) {
  throw new Error('Managed runs own config, output and reporters; UI mode is not supported. Use normal test filters/options.');
}
const run = createRun();
console.log(`MCC Playwright run: ${run.id}\nDiagnostics: ${run.diagnostics}`);
const log = fs.openSync(path.join(run.diagnostics, 'runner.log'), 'a');
let child;
let interrupted = false;
let exitCode = 1;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function interrupt(signal) {
  interrupted = true;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    // Windows has no POSIX signal forwarding. Kill only the spawned test tree.
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch {}
  } else child.kill(signal);
}
const onSigint = () => interrupt('SIGINT');
const onSigterm = () => interrupt('SIGTERM');
process.on('SIGINT', onSigint);
process.on('SIGTERM', onSigterm);
try {
  const listener = net.createServer();
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
  const port = process.env.MCC_PLAYWRIGHT_PORT || String(listener.address().port);
  await new Promise(resolve => listener.close(resolve));
  if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535 || Number(port) === 4273) throw new Error('Use a test port from 1024 to 65535, excluding MCC development port 4273');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(MCC_|SMTP_|SESSION_SECRET$|NODE_OPTIONS$|NODE_PATH$|PLAYWRIGHT_.*(OUTPUT|REPORT)|.*_PROXY$)/i.test(key)));
  Object.assign(env, {
    MCC_PLAYWRIGHT_RUN_ID: run.id, MCC_PLAYWRIGHT_DIAGNOSTICS: run.diagnostics,
    MCC_PLAYWRIGHT_PORT: port, MCC_PLAYWRIGHT_FRONTEND_ONLY: process.env.MCC_PLAYWRIGHT_FRONTEND_ONLY || '',
    NODE_OPTIONS: `--import=${pathToFileURL(path.join(root, 'scripts/playwright-register.mjs')).href}`,
    NODE_ENV: 'test', PORT: port, MCC_BIND_HOST: '127.0.0.1',
    MCC_DATA_DIR: path.join(run.directory, 'data'), MCC_UPLOADS_DIR: path.join(run.directory, 'uploads'),
    MCC_BACKUPS_DIR: path.join(run.directory, 'backups'), MCC_RECOVERY_DIR: path.join(run.directory, 'recovery'),
    MCC_PM_EXCEL_DIR: path.join(run.directory, 'pm-excel'), MCC_PM_WORK_ORDER_DIR: path.join(run.directory, 'pm-work-orders'),
    MCC_UPDATE_MODE: '', MCC_UPDATE_APP_DIR: path.join(run.directory, 'updater-disabled'),
    MCC_UPDATE_STATE_DIR: path.join(run.directory, 'updater-disabled'), MCC_UPDATE_WINDOWS_CONFIG: '',
    MCC_HTTPS_MODE: '', MCC_HTTPS_HOSTNAME: '',
    SESSION_SECRET: run.id, SMTP_HOST: '', SMTP_PORT: '', SMTP_USER: '', SMTP_PASS: '', SMTP_FROM: '',
    TEMP: path.join(run.directory, 'runtime'), TMP: path.join(run.directory, 'runtime'), TMPDIR: path.join(run.directory, 'runtime'),
    FORCE_COLOR: '0',
  });
  for (const key of ['MCC_KEEP_ASSET_SPEC_ARTIFACTS', 'MCC_ISSUE_106_VISUAL_QA']) {
    if (process.env[key] === '1') env[key] = '1';
  }
  if (process.env.MCC_PM_QA_PDF) env.MCC_PM_QA_PDF = path.join(run.diagnostics, 'pm-{project}.pdf');
  if (process.env.MCC_PDF_QA_DIR) env.MCC_PDF_QA_DIR = path.join(run.diagnostics, 'pdf');
  if (['pass', 'fail', 'interrupt'].includes(process.env.MCC_CLEANUP_PROBE)) env.MCC_CLEANUP_PROBE = process.env.MCC_CLEANUP_PROBE;
  if (interrupted) throw new Error('Interrupted before test launch');
  child = spawn(process.execPath, [path.join(root, 'node_modules/playwright/cli.js'), 'test', ...args], {
    cwd: root, env, windowsHide: true, stdio: ['inherit', 'pipe', 'pipe'],
  });
  for (const [stream, destination] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
    stream.on('data', chunk => { fs.writeSync(log, chunk); destination.write(chunk); });
  }
  exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => resolve(code ?? 1)); });
} catch (error) {
  fs.writeSync(log, `${error.stack}\n`);
  console.error(error);
} finally {
  process.removeListener('SIGINT', onSigint);
  process.removeListener('SIGTERM', onSigterm);
  fs.closeSync(log);
  fs.writeFileSync(path.join(run.diagnostics, 'result.json'), JSON.stringify({ exitCode, interrupted, finishedAt: new Date().toISOString() }, null, 2));
  try {
    // Playwright closes workers and webServer before its process exits. Allow OS reaping.
    for (let attempt = 0; attempt < 10 && activeProcesses(run, process.pid).length; attempt++) await pause(500);
    cleanupRun(run.id, { currentRunner: true, apply: true });
    console.log(`Removed owned runtime: ${run.directory}`);
  } catch (error) {
    const message = `Cleanup safely deferred: ${error.message}. Use npm run test:playwright:cleanup after processes stop.\n`;
    fs.appendFileSync(path.join(run.diagnostics, 'runner.log'), message);
    console.error(message);
    exitCode = exitCode || 1;
  }
}
process.exitCode = interrupted ? 130 : exitCode;
