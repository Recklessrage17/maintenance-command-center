export {};

type MeasurementLogEntry = {
  id: string;
  name: string;
  size: number;
  type: string;
  uploadedAt: string;
  year: string;
  hasStoredFile?: boolean;
};

type TemplateFile = { id: string; name: string; type: string; updatedAt: string; blob: Blob };

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
  return value.replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character] ?? character));
}

function readLogEntries(): MeasurementLogEntry[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LOG_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLogEntries(logs: MeasurementLogEntry[]) {
  window.localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(logs.slice(0, 300)));
}

function currentFolderYear(panel: HTMLElement) {
  const text = panel.querySelector('[data-measurement-active-year]')?.textContent ?? '';
  return text.match(/\b(20\d{2})\b/)?.[1] ?? String(new Date().getFullYear());
}

function canDeleteYearFolder() {
  const chunks = [document.body.innerText || ''];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index) ?? '';
    if (/role|user|auth|session/i.test(key)) chunks.push(`${key} ${window.localStorage.getItem(key) ?? ''}`);
  }
  return /maintenance\s*tech\s*3|tier\s*3|manager|admin|administrator/i.test(chunks.join(' '));
}

function openDb(name: string, store: string, version = 1): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(name, version);
    request.onerror = () => reject(request.error ?? new Error(`Unable to open ${name}.`));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function deleteStoredMeasurementFile(id: string) {
  const db = await openDb(LOG_DB_NAME, LOG_FILE_STORE, LOG_DB_VERSION);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(LOG_FILE_STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Unable to delete measurement file.'));
    tx.objectStore(LOG_FILE_STORE).delete(id);
  });
  db.close();
}

async function saveTemplateFile(file: File) {
  const db = await openDb(TEMPLATE_DB_NAME, TEMPLATE_STORE, TEMPLATE_DB_VERSION);
  const template: TemplateFile = { id: DEFAULT_TEMPLATE_ID, name: file.name, type: file.type || 'application/pdf', updatedAt: new Date().toISOString(), blob: file };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(TEMPLATE_STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Unable to save template.'));
    tx.objectStore(TEMPLATE_STORE).put(template);
  });
  db.close();
}

async function readTemplateFile() {
  const db = await openDb(TEMPLATE_DB_NAME, TEMPLATE_STORE, TEMPLATE_DB_VERSION);
  const template = await new Promise<TemplateFile | undefined>((resolve, reject) => {
    const request = db.transaction(TEMPLATE_STORE, 'readonly').objectStore(TEMPLATE_STORE).get(DEFAULT_TEMPLATE_ID);
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
  const stations = Array.from({ length: 14 }, (_, index) => `<div class="line">Station ${index + 1}</div>`).join('');
  const screwLines = Array.from({ length: 12 }, (_, index) => `<div class="line">Root / Flight ${index + 1}</div>`).join('');
  win.document.write(`<!doctype html><html><head><title>${DEFAULT_TEMPLATE_NAME}</title><style>
    body{font-family:Arial,sans-serif;margin:18px;color:#111}h1{font-size:18px;margin:0;text-align:center}p{margin:4px 0 10px;text-align:center}.grid{display:grid;grid-template-columns:repeat(5,1fr);gap:6px}.field,.check{border:1px solid #111;min-height:28px;padding:4px;font-size:10px}.checks{display:grid;grid-template-columns:repeat(8,1fr);gap:4px}.section{border:2px solid #111;margin:9px 0;padding:8px}.line{height:30px;border-bottom:1px solid #111;font-size:10px}.big{min-height:74px}@media print{.no-print{display:none}body{margin:9mm}}
  </style></head><body><button class="no-print" onclick="window.print()">Print</button><h1>SCREW & BARREL MEASUREMENT SHEET OLD/NEW Rev. 9</h1><p>Blank inspection record</p><div class="grid"><div class="field">Press #</div><div class="field">Press S/N</div><div class="field">Plant</div><div class="field">Injection Size oz</div><div class="field">OEM Barrel Bore</div></div><h3>Reason For Pull</h3><div class="checks"><div class="check">Contamination</div><div class="check">Splay</div><div class="check">Cushion</div><div class="check">Streaks</div><div class="check">Metal</div><div class="check">Recovery</div><div class="check">History</div><div class="check">Other</div></div><div class="section"><h3>Barrel Inside Diameter Measurements</h3>${stations}</div><div class="section"><h3>Screw Root / Flight Measurements</h3>${screwLines}</div><div class="grid"><div class="field">Check Ring Dia</div><div class="field">Tip Mfg.</div><div class="field">Tip Part #</div><div class="field">Tip Type</div><div class="field">Seat Condition</div><div class="field">Screw Serial #</div><div class="field">Screw Part #</div><div class="field">L/D</div><div class="field">Compression Ratio</div><div class="field">Lead Gap Measurement</div><div class="field">Name</div><div class="field">Date Measured</div><div class="field">Date Installed</div><div class="field big" style="grid-column:span 2">Comments</div></div><script>setTimeout(()=>window.print(),400)</script></body></html>`);
  win.document.close();
}

async function printBlankForm() {
  const template = await readTemplateFile().catch(() => undefined);
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
  if (!status) return;
  const template = await readTemplateFile().catch(() => undefined);
  const nextText = template ? `Custom form active: ${template.name}` : `Default locked: ${DEFAULT_TEMPLATE_NAME}`;
  if (status.textContent !== nextText) status.textContent = nextText;
}

function addSavedPathRows(panel: HTMLElement) {
  const year = currentFolderYear(panel);
  panel.querySelectorAll<HTMLElement>('.measurement-log-row').forEach(row => {
    if (row.querySelector('.measurement-log-path')) return;
    const fileName = row.querySelector('.measurement-log-main strong')?.textContent?.trim() || 'record';
    const path = document.createElement('small');
    path.className = 'measurement-log-path';
    path.textContent = `Saved: Measurement Inspection Logs / ${year} / ${fileName}`;
    row.querySelector('.measurement-log-main')?.appendChild(path);
  });
}

function disableLogOnlySelections(panel: HTMLElement) {
  panel.querySelectorAll<HTMLElement>('.measurement-log-row').forEach(row => {
    const status = row.querySelector('.measurement-log-row-actions em')?.textContent?.trim().toLowerCase() ?? '';
    const checkbox = row.querySelector<HTMLInputElement>('[data-measurement-log-check]');
    if (status !== 'log only' || !checkbox) return;
    if (checkbox.checked) checkbox.checked = false;
    if (!checkbox.disabled) checkbox.disabled = true;
    row.classList.add('measurement-log-row-disabled');
    const select = row.querySelector('.measurement-log-select');
    if (select?.getAttribute('title') !== 'Upload this record again before printing.') select?.setAttribute('title', 'Upload this record again before printing.');
    if (!row.querySelector('.measurement-log-upload-note')) {
      const note = document.createElement('small');
      note.className = 'measurement-log-upload-note';
      note.textContent = 'Upload again to print.';
      row.querySelector('.measurement-log-main')?.appendChild(note);
    }
  });
  const counter = panel.querySelector<HTMLElement>('[data-measurement-selected-count]');
  const selectedCount = panel.querySelectorAll<HTMLInputElement>('[data-measurement-log-check]:checked:not(:disabled)').length;
  const nextText = `${selectedCount} selected`;
  if (counter && counter.textContent !== nextText) counter.textContent = nextText;
}

async function deleteCurrentYearFolder(panel: HTMLElement) {
  const year = currentFolderYear(panel);
  if (!canDeleteYearFolder()) {
    window.alert('Folder delete is locked. Maintenance Tech 3 / Tier 3, Manager, or Admin access is required.');
    return;
  }
  const logs = readLogEntries();
  const deleteIds = logs.filter(log => (log.year || new Date(log.uploadedAt).getFullYear().toString()) === year).map(log => log.id);
  if (!deleteIds.length) {
    window.alert(`The ${year} folder is already empty.`);
    return;
  }
  if (!window.confirm(`WARNING: Delete the entire ${year} Measurement Inspection folder and all ${deleteIds.length} log(s)? This cannot be undone.`)) return;
  if (window.prompt(`Type DELETE ${year} to confirm folder deletion.`) !== `DELETE ${year}`) {
    window.alert('Folder delete cancelled.');
    return;
  }
  await Promise.all(deleteIds.map(deleteStoredMeasurementFile));
  writeLogEntries(logs.filter(log => !deleteIds.includes(log.id)));
  window.location.reload();
}

function refreshRowEnhancements(panel: HTMLElement) {
  addSavedPathRows(panel);
  disableLogOnlySelections(panel);
}

function enhancePanel(panel: HTMLElement) {
  if (panel.getAttribute(ENHANCED_ATTR) === 'true') {
    refreshRowEnhancements(panel);
    return;
  }
  panel.setAttribute(ENHANCED_ATTR, 'true');

  const heading = panel.querySelector<HTMLElement>('.machine-measurement-panel-heading');
  if (heading) {
    heading.classList.add('measurement-log-toggle-heading');
    heading.setAttribute('role', 'button');
    heading.setAttribute('tabindex', '0');
    if (!heading.querySelector('.measurement-log-chevron')) heading.insertAdjacentHTML('beforeend', '<span class="measurement-log-chevron">v</span>');
    const toggle = () => panel.classList.toggle('measurement-log-collapsed');
    heading.addEventListener('click', event => { if (!(event.target as HTMLElement).closest('button,input,label')) toggle(); });
    heading.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); } });
  }

  const importCard = panel.querySelector<HTMLElement>('.measurement-log-import-card');
  if (importCard && !importCard.querySelector('[data-print-blank-form]')) {
    importCard.insertAdjacentHTML('beforeend', `<div class="measurement-template-card"><span>Blank Form Template</span><strong>Screw & Barrel Measurement Sheet</strong><small data-template-status>Default locked: ${escapeHtml(DEFAULT_TEMPLATE_NAME)}</small><div class="measurement-log-actions"><button class="secondary-button compact-button" type="button" data-print-blank-form>Print Blank Form</button><button class="secondary-button compact-button" type="button" data-update-blank-form>Update Form</button></div><input type="file" data-template-file-input hidden accept=".pdf,.png,.jpg,.jpeg" /></div>`);
    const templateInput = importCard.querySelector<HTMLInputElement>('[data-template-file-input]');
    importCard.querySelector<HTMLButtonElement>('[data-print-blank-form]')?.addEventListener('click', () => void printBlankForm());
    importCard.querySelector<HTMLButtonElement>('[data-update-blank-form]')?.addEventListener('click', () => templateInput?.click());
    templateInput?.addEventListener('change', () => { void (async () => {
      const file = templateInput.files?.[0];
      if (!file) return;
      await saveTemplateFile(file);
      templateInput.value = '';
      await updateTemplateStatus(panel);
      window.alert('Blank form template updated. Print Blank Form will now use the updated file.');
    })().catch(error => { console.error(error); window.alert('Template update failed.'); }); });
    void updateTemplateStatus(panel);
  }

  const bulkActions = panel.querySelector<HTMLElement>('.measurement-log-bulk-actions');
  if (bulkActions && !bulkActions.querySelector('[data-delete-current-folder]')) {
    bulkActions.insertAdjacentHTML('beforeend', '<button class="secondary-button compact-button danger-button" type="button" data-delete-current-folder>Delete Year Folder</button><span class="measurement-tier-note">Tier 3+ only</span>');
    bulkActions.querySelector<HTMLButtonElement>('[data-delete-current-folder]')?.addEventListener('click', () => void deleteCurrentYearFolder(panel));
  }
  refreshRowEnhancements(panel);
}

function injectEnhancementStyles() {
  if (document.getElementById('measurement-log-enhancement-styles')) return;
  const style = document.createElement('style');
  style.id = 'measurement-log-enhancement-styles';
  style.textContent = `.measurement-log-toggle-heading{cursor:pointer;border:1px solid rgba(68,215,255,.18);border-radius:10px;padding:10px 12px}.measurement-log-chevron{margin-left:auto;color:#8ff1ff;font-weight:950}.measurement-log-collapsed .measurement-log-shell{display:none!important}.measurement-log-collapsed .measurement-log-chevron{transform:rotate(-90deg);display:inline-block}.measurement-template-card{border-top:1px solid rgba(68,215,255,.18);margin-top:14px;padding-top:13px}.measurement-log-path{color:#86f1ff!important;display:block;font-size:.7rem;font-weight:900;margin-top:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.measurement-tier-note{align-items:center;color:#ffd25e;display:inline-flex;font-size:.7rem;font-weight:950;letter-spacing:.03em;text-transform:uppercase}.danger-button{border-color:rgba(255,99,99,.45)!important;color:#ffb5b5!important}.measurement-log-row-disabled{opacity:.55}.measurement-log-row-disabled .measurement-log-select{cursor:not-allowed}.measurement-log-row-disabled .measurement-log-select span{border-color:rgba(255,210,94,.32)}.measurement-log-upload-note{color:#ffd25e!important;display:block;font-size:.7rem;font-weight:950;margin-top:5px}`;
  document.head.appendChild(style);
}

let scheduled = false;
function scheduleEnhancements() {
  if (scheduled) return;
  scheduled = true;
  window.requestAnimationFrame(() => {
    scheduled = false;
    document.querySelectorAll<HTMLElement>(LOG_PANEL_SELECTOR).forEach(enhancePanel);
  });
}

if (typeof window !== 'undefined') {
  injectEnhancementStyles();
  window.requestAnimationFrame(scheduleEnhancements);
  const interval = window.setInterval(scheduleEnhancements, 750);
  window.setTimeout(() => window.clearInterval(interval), 20000);
}
