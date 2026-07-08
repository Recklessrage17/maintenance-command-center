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

type StoredMeasurementFile = {
  id: string;
  name: string;
  type: string;
  uploadedAt: string;
  blob: Blob;
};

type TemplateFile = {
  id: string;
  name: string;
  type: string;
  updatedAt: string;
  blob: Blob;
};

const PANEL_SELECTOR = '.measurement-log-panel';
const LOG_STORAGE_KEY = 'mcc:measurement-inspection-logs:v2';
const LOG_DB_NAME = 'mcc-measurement-inspection-logs';
const LOG_DB_VERSION = 1;
const LOG_FILE_STORE = 'files';
const TEMPLATE_DB_NAME = 'mcc-measurement-inspection-template';
const TEMPLATE_DB_VERSION = 1;
const TEMPLATE_STORE = 'templates';
const DEFAULT_TEMPLATE_ID = 'screw-barrel-default-template';

function readLogs(): MeasurementLogEntry[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LOG_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
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

async function readStoredFile(id: string) {
  const db = await openDb(LOG_DB_NAME, LOG_FILE_STORE, LOG_DB_VERSION);
  const file = await new Promise<StoredMeasurementFile | undefined>((resolve, reject) => {
    const request = db.transaction(LOG_FILE_STORE, 'readonly').objectStore(LOG_FILE_STORE).get(id);
    request.onerror = () => reject(request.error ?? new Error('Unable to read stored measurement file.'));
    request.onsuccess = () => resolve(request.result as StoredMeasurementFile | undefined);
  });
  db.close();
  return file;
}

async function readTemplate() {
  const db = await openDb(TEMPLATE_DB_NAME, TEMPLATE_STORE, TEMPLATE_DB_VERSION);
  const template = await new Promise<TemplateFile | undefined>((resolve, reject) => {
    const request = db.transaction(TEMPLATE_STORE, 'readonly').objectStore(TEMPLATE_STORE).get(DEFAULT_TEMPLATE_ID);
    request.onerror = () => reject(request.error ?? new Error('Unable to read template file.'));
    request.onsuccess = () => resolve(request.result as TemplateFile | undefined);
  });
  db.close();
  return template;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read file for backup.'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'application/json' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 30000);
}

async function exportMeasurementBackup() {
  const logs = readLogs();
  const files = await Promise.all(logs.map(async log => {
    const stored = await readStoredFile(log.id).catch(() => undefined);
    return stored ? {
      id: stored.id,
      name: stored.name,
      type: stored.type,
      uploadedAt: stored.uploadedAt,
      dataUrl: await blobToDataUrl(stored.blob),
    } : null;
  }));
  const template = await readTemplate().catch(() => undefined);
  const backup = {
    backupType: 'MCC Measurement Inspection Logs',
    version: 1,
    exportedAt: new Date().toISOString(),
    note: 'Backup of local browser measurement inspection logs, uploaded files, and custom blank form template.',
    logs,
    files: files.filter(Boolean),
    template: template ? {
      id: template.id,
      name: template.name,
      type: template.type,
      updatedAt: template.updatedAt,
      dataUrl: await blobToDataUrl(template.blob),
    } : null,
  };
  const stamp = new Date().toISOString().slice(0, 10);
  downloadTextFile(`MCC_Measurement_Inspection_Backup_${stamp}.json`, JSON.stringify(backup, null, 2));
}

function getActiveYear(panel: HTMLElement) {
  const text = panel.querySelector('[data-measurement-active-year]')?.textContent ?? '';
  return text.match(/\b(20\d{2})\b/)?.[1] ?? String(new Date().getFullYear());
}

function setFolderOpen(panel: HTMLElement, open: boolean) {
  panel.classList.toggle('measurement-folder-open', open);
  panel.classList.toggle('measurement-folder-closed', !open);
  panel.dataset.measurementFolderOpen = open ? 'true' : 'false';
}

function wireFolderButtons(panel: HTMLElement) {
  panel.querySelectorAll<HTMLButtonElement>('[data-measurement-year]').forEach(folderButton => {
    if (folderButton.dataset.refinedFolder === 'true') return;
    folderButton.dataset.refinedFolder = 'true';
    folderButton.title = 'Open year folder';
    folderButton.addEventListener('click', () => {
      window.setTimeout(() => setFolderOpen(panel, true), 0);
    }, true);
  });
}

function addFolderDeleteButtons(panel: HTMLElement) {
  const existingDeleteButton = panel.querySelector<HTMLButtonElement>('[data-delete-current-folder]');
  if (!existingDeleteButton) return;
  panel.querySelectorAll<HTMLButtonElement>('[data-measurement-year]').forEach(folderButton => {
    if (folderButton.parentElement?.classList.contains('measurement-folder-pill-wrap')) return;
    const wrap = document.createElement('span');
    wrap.className = 'measurement-folder-pill-wrap';
    folderButton.parentNode?.insertBefore(wrap, folderButton);
    wrap.appendChild(folderButton);
    const deleteButton = document.createElement('button');
    deleteButton.className = 'measurement-folder-delete-x';
    deleteButton.type = 'button';
    deleteButton.title = `Delete ${folderButton.dataset.measurementYear ?? getActiveYear(panel)} folder`;
    deleteButton.textContent = '×';
    deleteButton.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      folderButton.click();
      window.setTimeout(() => existingDeleteButton.click(), 70);
    });
    wrap.appendChild(deleteButton);
  });
}

function addBackButton(panel: HTMLElement) {
  const bulkActions = panel.querySelector<HTMLElement>('.measurement-log-bulk-actions');
  if (!bulkActions || bulkActions.querySelector('[data-close-folder]')) return;
  const back = document.createElement('button');
  back.className = 'secondary-button compact-button measurement-back-folder-button';
  back.type = 'button';
  back.dataset.closeFolder = 'true';
  back.textContent = '← Folders';
  back.addEventListener('click', () => setFolderOpen(panel, false));
  bulkActions.insertBefore(back, bulkActions.firstChild);
}

function addBackupButton(panel: HTMLElement) {
  const importCard = panel.querySelector<HTMLElement>('.measurement-log-import-card');
  if (!importCard || importCard.querySelector('[data-backup-measurement-data]')) return;
  const actions = importCard.querySelector<HTMLElement>('.measurement-log-actions');
  if (!actions) return;
  const button = document.createElement('button');
  button.className = 'secondary-button compact-button measurement-backup-button';
  button.type = 'button';
  button.dataset.backupMeasurementData = 'true';
  button.textContent = 'Backup Data';
  button.addEventListener('click', () => {
    void exportMeasurementBackup().catch(error => {
      console.error('Measurement backup export failed', error);
      window.alert('Backup export failed. Check console for details.');
    });
  });
  actions.appendChild(button);
}

function cleanCopy(panel: HTMLElement) {
  const importButton = panel.querySelector<HTMLElement>('[data-measurement-import]');
  if (importButton) importButton.remove();
  panel.querySelectorAll<HTMLElement>('.measurement-tier-note').forEach(note => { note.style.display = 'none'; });
  const oldDeleteButton = panel.querySelector<HTMLElement>('[data-delete-current-folder]');
  if (oldDeleteButton) oldDeleteButton.classList.add('measurement-hidden-original-delete');
  const uploadCopy = panel.querySelector('.measurement-log-import-card small');
  if (uploadCopy && uploadCopy.textContent?.includes('CSV files, or imported records')) {
    uploadCopy.textContent = 'Upload completed inspection PDFs, scans, photos, or files. MCC files them into yearly folders automatically.';
  }
}

function refreshPanel(panel: HTMLElement) {
  cleanCopy(panel);
  wireFolderButtons(panel);
  addFolderDeleteButtons(panel);
  addBackButton(panel);
  addBackupButton(panel);
  if (!panel.dataset.measurementFolderOpen) setFolderOpen(panel, false);
}

function injectStyles() {
  if (document.getElementById('measurement-log-ui-refinement-styles')) return;
  const style = document.createElement('style');
  style.id = 'measurement-log-ui-refinement-styles';
  style.textContent = `
    .measurement-log-panel .measurement-log-shell {
      grid-template-columns: minmax(260px, .62fr) minmax(420px, 1.38fr) !important;
    }
    .measurement-log-import-card,
    .measurement-log-list-card {
      background: linear-gradient(145deg, rgba(5, 28, 41, .82), rgba(3, 13, 24, .92)) !important;
      box-shadow: inset 0 1px 0 rgba(255,255,255,.035), 0 10px 30px rgba(0,0,0,.14);
    }
    .measurement-log-import-card .measurement-log-actions {
      border-top: 1px solid rgba(68,215,255,.14);
      padding-top: 12px;
    }
    .measurement-template-card .measurement-log-actions {
      border-top: 0;
      padding-top: 0;
    }
    .measurement-folder-closed .measurement-log-bulk-actions,
    .measurement-folder-closed [data-measurement-log-list],
    .measurement-folder-closed [data-measurement-selected-count] {
      display: none !important;
    }
    .measurement-folder-closed .measurement-log-list-card::after {
      border: 1px dashed rgba(68,215,255,.22);
      border-radius: 12px;
      color: #a8c7d5;
      content: 'Click a year folder to open the records.';
      display: block;
      font-weight: 900;
      margin-top: 14px;
      padding: 18px;
      text-align: center;
    }
    .measurement-folder-pill-wrap {
      align-items: center;
      display: inline-flex;
      gap: 6px;
    }
    .measurement-folder-pill-wrap .measurement-year-folder {
      margin-top: 0 !important;
    }
    .measurement-folder-delete-x {
      align-items: center;
      background: rgba(100, 8, 22, .62);
      border: 1px solid rgba(255, 91, 113, .62);
      border-radius: 999px;
      color: #ffb7c2;
      cursor: pointer;
      display: inline-flex;
      font-size: 1rem;
      font-weight: 950;
      height: 27px;
      justify-content: center;
      line-height: 1;
      width: 27px;
    }
    .measurement-folder-delete-x:hover {
      background: rgba(178, 25, 45, .82);
      color: #fff;
      box-shadow: 0 0 14px rgba(255, 91, 113, .22);
    }
    .measurement-hidden-original-delete,
    .measurement-tier-note {
      display: none !important;
    }
    .measurement-back-folder-button {
      border-color: rgba(68,215,255,.28) !important;
      color: #86f1ff !important;
    }
    .measurement-backup-button {
      border-color: rgba(255,210,94,.34) !important;
      color: #ffd25e !important;
    }
  `;
  document.head.appendChild(style);
}

let scheduled = false;
function scheduleRefresh() {
  if (scheduled) return;
  scheduled = true;
  window.requestAnimationFrame(() => {
    scheduled = false;
    document.querySelectorAll<HTMLElement>(PANEL_SELECTOR).forEach(refreshPanel);
  });
}

if (typeof window !== 'undefined') {
  injectStyles();
  window.requestAnimationFrame(scheduleRefresh);
  const interval = window.setInterval(scheduleRefresh, 900);
  window.setTimeout(() => window.clearInterval(interval), 18000);
}
