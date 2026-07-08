type MeasurementLogEntry = {
  id: string;
  name: string;
  size: number;
  type: string;
  uploadedAt: string;
  year: string;
  hasStoredFile?: boolean;
};

type TemplateFile = {
  id: string;
  name: string;
  type: string;
  updatedAt: string;
  blob: Blob;
};

const LOG_PANEL_SELECTOR = '.measurement-log-panel';
const ENHANCED_ATTR = 'data-measurement-log-enhanced';
const LOG_STORAGE_KEY = 'mcc:measurement-inspection-logs:v2';
const LOG_DB_NAME = 'mcc-measurement-inspection-logs';
const LOG_DB_VERSION = 1;
const LOG_FILE_STORE = 'files';
const TEMPLATE_DB_NAME = 'mcc-measurement-inspection-template';
const TEMPLATE_DB_VERSION = 1;
const TEMPLATE_STORE = 'templates';
const DEFAULT_TEMPLATE_ID = 'screw-barrel-default-template';
const DEFAULT_TEMPLATE_NAME = 'JBT Screw & Barrel Measurement Sheet OLD/NEW Rev. 9';

function escapeHtml(value: string) {
  return value.replace(/[&<>'\"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '\"': '&quot;' }[character] ?? character));
}

function readLogs(): MeasurementLogEntry[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LOG_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLogs(logs: MeasurementLogEntry[]) {
  window.localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(logs.slice(0, 300)));
}

function currentYear(panel: HTMLElement) {
  const text = panel.querySelector('[data-measurement-active-year]')?.textContent ?? '';
  const match = text.match(/\b(20\d{2})\b/);
  return match?.[1] ?? String(new Date().getFullYear());
}

function roleTextFromPage() {
  const chunks = [document.body.innerText || ''];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index) ?? '';
    if (/role|user|auth|session/i.test(key)) chunks.push(`${key} ${window.localStorage.getItem(key) ?? ''}`);
  }
  return chunks.join(' ').toLowerCase();
}

function canDeleteYearFolders() {
  const text = roleTextFromPage();
  return /maintenance\s*tech\s*3|tier\s*3|manager|admin|administrator/.test(text);
}

function openLogDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(LOG_DB_NAME, LOG_DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error('Unable to open log storage.'));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LOG_FILE_STORE)) db.createObjectStore(LOG_FILE_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function deleteLogFile(id: string) {
  const db = await openLogDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(LOG_FILE_STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Unable to delete file.'));
    tx.objectStore(LOG_FILE_STORE).delete(id);
  });
  db.close();
}

function openTemplateDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(TEMPLATE_DB_NAME, TEMPLATE_DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error('Unable to open template storage.'));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TEMPLATE_STORE)) db.createObjectStore(TEMPLATE_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function saveTemplate(file: File) {
  const db = await openTemplateDb();
  const template: TemplateFile = {
    id: DEFAULT_TEMPLATE_ID,
    name: file.name,
    type: file.type || 'application/pdf',
    updatedAt: new Date().toISOString(),
    blob: file,
  };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(TEMPLATE_STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Unable to save template.'));
    tx.objectStore(TEMPLATE_STORE).put(template);
  });
  db.close();
}

async function readTemplate() {
  const db = await openTemplateDb();
  const template = await new Promise<TemplateFile | undefined>((resolve, reject) => {
    const tx = db.transaction(TEMPLATE_STORE, 'readonly');
    const request = tx.objectStore(TEMPLATE_STORE).get(DEFAULT_TEMPLATE_ID);
    request.onerror = () => reject(request.error ?? new Error('Unable to read template.'));
    request.onsuccess = () => resolve(request.result as TemplateFile | undefined);
  });
  db.close();
  return template;
}

function printDefaultBlankForm() {
  const win = window.open('', '_blank', 'width=1100,height=850');
  if (!win) {
    window.alert('Popup blocked. Allow popups for MCC to print the blank form.');
    return;
  }
  win.document.write(`<!doctype html><html><head><title>${DEFAULT_TEMPLATE_NAME}</title><style>
    body{font-family:Arial,sans-serif;margin:18px;color:#111} h1{font-size:18px;margin:0 0 4px;text-align:center} h2{font-size:13px;margin:14px 0 6px} .grid{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-bottom:8px}.field{border:1px solid #111;min-height:28px;padding:4px;font-size:10px}.big{min-height:78px}.section{border:2px solid #111;padding:8px;margin:8px 0}.line{height:34px;border-bottom:1px solid #111;margin:6px 0}.checks{display:grid;grid-template-columns:repeat(8,1fr);gap:4px}.check{border:1px solid #111;padding:6px;font-size:10px}@media print{body{margin:10mm}.no-print{display:none}}
  </style></head><body><button class="no-print" onclick="window.print()">Print</button><h1>SCREW & BARREL MEASUREMENT SHEET OLD/NEW Rev. 9</h1><p style="text-align:center;margin:0 0 10px">Default blank JBT record form</p><div class="grid"><div class="field">Press #</div><div class="field">Press S/N</div><div class="field">Plant</div><div class="field">Injection Size oz</div><div class="field">OEM Barrel Bore</div></div><h2>Reason For Pull</h2><div class="checks"><div class="check">Contamination</div><div class="check">Splay</div><div class="check">Cushion</div><div class="check">Streaks</div><div class="check">Metal</div><div class="check">Recovery</div><div class="check">History</div><div class="check">Other</div></div><div class="section"><h2>Barrel Inside Diameter Measurements</h2>${Array.from({length:12}).map((_,i)=>`<div class="line">Station ${i+1}</div>`).join('')}</div><div class="section"><h2>Screw Root / Flight Measurements</h2>${Array.from({length:10}).map((_,i)=>`<div class="line">Measurement ${i+1}</div>`).join('')}</div><div class="grid"><div class="field">Check Ring Dia</div><div class="field">Tip Mfg.</div><div class="field">Tip Part #</div><div class="field">Tip Type</div><div class="field">Seat Condition</div><div class="field">Screw Serial #</div><div class="field">Screw Part #</div><div class="field">L/D</div><div class="field">Compression Ratio</div><div class="field">Lead Gap Measurement</div></div><div class="grid"><div class="field">Name</div><div class="field">Date Measured</div><div class="field">Date Installed</div><div class="field big" style="grid-column:span 2">Comments</div></div><script>setTimeout(()=>window.print(),400)</script></body></html>`);
  win.document.close();
}

async function printBlankForm() {
  const template = await readTemplate();
  if (!template) {
    printDefaultBlankForm();
    return;
  }
  const url = window.URL.createObjectURL(template.blob);
  const win = window.open(url, '_blank', 'width=1100,height=850');
  if (!win) window.alert('Popup blocked. Allow popups for MCC to open the blank form.');
  window.setTimeout(() => window.URL.revokeObjectURL(url), 30000);
}

async function updateTemplateStatus(panel: HTMLElement) {
  const status = panel.querySelector<HTMLElement>('[data-template-status]');
  const template = await readTemplate().catch(() => undefined);
  if (!status) return;
  status.textContent = template ? `Custom form active: ${template.name}` : `Default locked: ${DEFAULT_TEMPLATE_NAME}`;
}

function enhanceSavedPaths(panel: HTMLElement) {
  const year = currentYear(panel);
  panel.querySelectorAll<HTMLElement>('.measurement-log-row').forEach(row => {
    if (row.querySelector('.measurement-log-path')) return;
    const fileName = row.querySelector('.measurement-log-main strong')?.textContent?.trim() || 'record';
    const path = document.createElement('small');
    path.className = 'measurement-log-path';
    path.textContent = `Saved: Measurement Inspection Logs / ${year} / ${fileName}`;
    row.querySelector('.measurement-log-main')?.appendChild(path);
  });
}

async function deleteCurrentFolder(panel: HTMLElement) {
  const year = currentYear(panel);
  if (!canDeleteYearFolders()) {
    window.alert('Folder delete is locked. Maintenance Tech 3 / Tier 3, Manager, or Admin access is required.');
    return;
  }
  const count = readLogs().filter(log => (log.year || new Date(log.uploadedAt).getFullYear().toString()) === year).length;
  if (!count) {
    window.alert(`The ${year} folder is already empty.`);
    return;
  }
  if (!window.confirm(`WARNING: Delete the entire ${year} Measurement Inspection folder and all ${count} log(s)? This cannot be undone.`)) return;
  const typed = window.prompt(`Type DELETE ${year} to confirm folder deletion.`);
  if (typed !== `DELETE ${year}`) {
    window.alert('Folder delete cancelled.');
    return;
  }
  const logs = readLogs();
  const deleteIds = logs.filter(log => (log.year || new Date(log.uploadedAt).getFullYear().toString()) === year).map(log => log.id);
  await Promise.all(deleteIds.map(deleteLogFile));
  writeLogs(logs.filter(log => !deleteIds.includes(log.id)));
  panel.removeAttribute('data-measurement-log-panel');
  panel.removeAttribute('data-measurement-log-enhanced');
  window.requestAnimationFrame(() => window.location.reload());
}

function installEnhancements(panel: HTMLElement) {
  if (panel.getAttribute(ENHANCED_ATTR) === 'true') {
    enhanceSavedPaths(panel);
    return;
  }
  panel.setAttribute(ENHANCED_ATTR, 'true');

  const heading = panel.querySelector<HTMLElement>('.machine-measurement-panel-heading');
  const shell = panel.querySelector<HTMLElement>('.measurement-log-shell');
  if (heading && shell) {
    heading.classList.add('measurement-log-toggle-heading');
    heading.setAttribute('role', 'button');
    heading.setAttribute('tabindex', '0');
    heading.insertAdjacentHTML('beforeend', '<span class="measurement-log-chevron">v</span>');
    const toggle = () => panel.classList.toggle('measurement-log-collapsed');
    heading.addEventListener('click', event => {
      if ((event.target as HTMLElement).closest('button,input,label')) return;
      toggle();
    });
    heading.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggle();
      }
    });
  }

  const importCard = panel.querySelector<HTMLElement>('.measurement-log-import-card');
  if (importCard && !importCard.querySelector('[data-print-blank-form]')) {
    importCard.insertAdjacentHTML('beforeend', `
      <div class="measurement-template-card">
        <span>Blank Form Template</span>
        <strong>Screw & Barrel Measurement Sheet</strong>
        <small data-template-status>Default locked: ${escapeHtml(DEFAULT_TEMPLATE_NAME)}</small>
        <div class="measurement-log-actions">
          <button class="secondary-button compact-button" type="button" data-print-blank-form>Print Blank Form</button>
          <button class="secondary-button compact-button" type="button" data-update-blank-form>Update Form</button>
        </div>
        <input type="file" data-template-file-input hidden accept=".pdf,.png,.jpg,.jpeg" />
      </div>
    `);
    const templateInput = importCard.querySelector<HTMLInputElement>('[data-template-file-input]');
    importCard.querySelector<HTMLButtonElement>('[data-print-blank-form]')?.addEventListener('click', () => void printBlankForm());
    importCard.querySelector<HTMLButtonElement>('[data-update-blank-form]')?.addEventListener('click', () => templateInput?.click());
    templateInput?.addEventListener('change', () => {
      void (async () => {
        const file = templateInput.files?.[0];
        if (!file) return;
        await saveTemplate(file);
        templateInput.value = '';
        await updateTemplateStatus(panel);
        window.alert('Blank form template updated. Print Blank Form will now use the updated file.');
      })().catch(error => {
        console.error('Template update failed', error);
        window.alert('Template update failed. Check console for details.');
      });
    });
    void updateTemplateStatus(panel);
  }

  const bulkActions = panel.querySelector<HTMLElement>('.measurement-log-bulk-actions');
  if (bulkActions && !bulkActions.querySelector('[data-delete-current-folder]')) {
    bulkActions.insertAdjacentHTML('beforeend', '<button class="secondary-button compact-button danger-button" type="button" data-delete-current-folder>Delete Year Folder</button><span class="measurement-tier-note">Tier 3+ only</span>');
    bulkActions.querySelector<HTMLButtonElement>('[data-delete-current-folder]')?.addEventListener('click', () => void deleteCurrentFolder(panel));
  }

  enhanceSavedPaths(panel);
}

function injectStyles() {
  if (document.getElementById('measurement-log-enhancement-styles')) return;
  const style = document.createElement('style');
  style.id = 'measurement-log-enhancement-styles';
  style.textContent = `
    .measurement-log-toggle-heading { cursor: pointer; border: 1px solid rgba(68,215,255,.18); border-radius: 10px; padding: 10px 12px; }
    .measurement-log-chevron { margin-left: auto; color: #8ff1ff; font-weight: 950; }
    .measurement-log-collapsed .measurement-log-shell { display: none !important; }
    .measurement-log-collapsed .measurement-log-chevron { transform: rotate(-90deg); display: inline-block; }
    .measurement-template-card { border-top: 1px solid rgba(68,215,255,.18); margin-top: 14px; padding-top: 13px; }
    .measurement-log-path { color: #86f1ff !important; display: block; font-size: .7rem; font-weight: 900; margin-top: 5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .measurement-tier-note { align-items: center; color: #ffd25e; display: inline-flex; font-size: .7rem; font-weight: 950; letter-spacing: .03em; text-transform: uppercase; }
    .danger-button { border-color: rgba(255, 99, 99, .45) !important; color: #ffb5b5 !important; }
  `;
  document.head.appendChild(style);
}

function runEnhancements() {
  document.querySelectorAll<HTMLElement>(LOG_PANEL_SELECTOR).forEach(installEnhancements);
}

if (typeof window !== 'undefined') {
  injectStyles();
  window.requestAnimationFrame(runEnhancements);
  const observer = new MutationObserver(runEnhancements);
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
