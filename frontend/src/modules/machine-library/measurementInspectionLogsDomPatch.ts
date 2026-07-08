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

const PANEL_SELECTOR = '.machine-measurement-panel';
const PATCHED_ATTR = 'data-measurement-log-panel';
const STORAGE_KEY = 'mcc:measurement-inspection-logs:v2';
const LEGACY_STORAGE_KEY = 'mcc:measurement-inspection-logs:v1';
const DB_NAME = 'mcc-measurement-inspection-logs';
const DB_VERSION = 1;
const FILE_STORE = 'files';

function formatBytes(size: number) {
  if (!Number.isFinite(size) || size <= 0) return '-';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function logYear(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(new Date().getFullYear()) : String(date.getFullYear());
}

function readLogs(): MeasurementLogEntry[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    const logs = parsed.map((log: Partial<MeasurementLogEntry>) => ({
      id: String(log.id ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`),
      name: String(log.name ?? 'Measurement inspection record'),
      size: Number(log.size ?? 0),
      type: String(log.type ?? 'File'),
      uploadedAt: String(log.uploadedAt ?? new Date().toISOString()),
      year: String(log.year ?? logYear(String(log.uploadedAt ?? new Date().toISOString()))),
      hasStoredFile: Boolean(log.hasStoredFile),
    }));
    if (!window.localStorage.getItem(STORAGE_KEY) && logs.length) writeLogs(logs);
    return logs;
  } catch {
    return [];
  }
}

function writeLogs(logs: MeasurementLogEntry[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(logs.slice(0, 300)));
}

function availableYears(logs: MeasurementLogEntry[]) {
  const years = new Set(logs.map(log => log.year || logYear(log.uploadedAt)));
  years.add(String(new Date().getFullYear()));
  return Array.from(years).sort((a, b) => Number(b) - Number(a));
}

function selectedYear(panel: HTMLElement, logs: MeasurementLogEntry[]) {
  const years = availableYears(logs);
  const saved = panel.dataset.selectedMeasurementYear;
  return saved && years.includes(saved) ? saved : years[0];
}

function selectedIds(panel: HTMLElement) {
  return Array.from(panel.querySelectorAll<HTMLInputElement>('[data-measurement-log-check]:checked')).map(input => input.value);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character] ?? character));
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error('Unable to open measurement log storage.'));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(FILE_STORE)) db.createObjectStore(FILE_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function saveStoredFile(file: File, id: string, uploadedAt: string) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FILE_STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Unable to save measurement file.'));
    tx.objectStore(FILE_STORE).put({ id, name: file.name, type: file.type || file.name.split('.').pop()?.toUpperCase() || 'File', uploadedAt, blob: file } satisfies StoredMeasurementFile);
  });
  db.close();
}

async function readStoredFile(id: string) {
  const db = await openDb();
  const file = await new Promise<StoredMeasurementFile | undefined>((resolve, reject) => {
    const tx = db.transaction(FILE_STORE, 'readonly');
    const request = tx.objectStore(FILE_STORE).get(id);
    request.onerror = () => reject(request.error ?? new Error('Unable to read measurement file.'));
    request.onsuccess = () => resolve(request.result as StoredMeasurementFile | undefined);
  });
  db.close();
  return file;
}

async function deleteStoredFile(id: string) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FILE_STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Unable to delete measurement file.'));
    tx.objectStore(FILE_STORE).delete(id);
  });
  db.close();
}

function renderLogRows(container: HTMLElement) {
  const logs = readLogs();
  const year = selectedYear(container, logs);
  container.dataset.selectedMeasurementYear = year;
  const folderList = container.querySelector<HTMLElement>('[data-measurement-year-folders]');
  const list = container.querySelector<HTMLElement>('[data-measurement-log-list]');
  const counter = container.querySelector<HTMLElement>('[data-measurement-selected-count]');
  const yearTitle = container.querySelector<HTMLElement>('[data-measurement-active-year]');
  if (!folderList || !list) return;

  folderList.innerHTML = availableYears(logs).map(folderYear => {
    const count = logs.filter(log => (log.year || logYear(log.uploadedAt)) === folderYear).length;
    return `<button class="measurement-year-folder ${folderYear === year ? 'active' : ''}" type="button" data-measurement-year="${folderYear}">📁 ${folderYear}<span>${count}</span></button>`;
  }).join('');
  folderList.querySelectorAll<HTMLButtonElement>('[data-measurement-year]').forEach(button => {
    button.addEventListener('click', () => {
      container.dataset.selectedMeasurementYear = button.dataset.measurementYear ?? year;
      renderLogRows(container);
    });
  });

  const yearLogs = logs.filter(log => (log.year || logYear(log.uploadedAt)) === year);
  if (yearTitle) yearTitle.textContent = `${year} Folder`;
  if (counter) counter.textContent = `${selectedIds(container).length} selected`;

  if (!yearLogs.length) {
    list.innerHTML = `
      <div class="measurement-log-empty">
        <strong>No measurement inspection logs in the ${escapeHtml(year)} folder yet.</strong>
        <span>Upload completed screw/barrel inspection PDFs, scans, photos, or import files and they will be filed by year automatically.</span>
      </div>
    `;
    return;
  }

  list.innerHTML = yearLogs.map(log => `
    <article class="measurement-log-row">
      <label class="measurement-log-select">
        <input type="checkbox" value="${escapeHtml(log.id)}" data-measurement-log-check />
        <span></span>
      </label>
      <div class="measurement-log-main">
        <strong>${escapeHtml(log.name)}</strong>
        <span>${escapeHtml(log.type || 'File')} • ${formatBytes(log.size)} • Imported ${new Date(log.uploadedAt).toLocaleString()}</span>
      </div>
      <div class="measurement-log-row-actions">
        <em>${log.hasStoredFile ? 'Ready' : 'Log Only'}</em>
        <button class="secondary-button compact-button" type="button" data-measurement-open="${escapeHtml(log.id)}">Open</button>
      </div>
    </article>
  `).join('');

  list.querySelectorAll<HTMLInputElement>('[data-measurement-log-check]').forEach(input => {
    input.addEventListener('change', () => {
      const count = selectedIds(container).length;
      if (counter) counter.textContent = `${count} selected`;
    });
  });
  list.querySelectorAll<HTMLButtonElement>('[data-measurement-open]').forEach(button => {
    button.addEventListener('click', () => void openLogFile(button.dataset.measurementOpen ?? ''));
  });
}

async function openLogFile(id: string) {
  const stored = await readStoredFile(id);
  if (!stored) {
    window.alert('This older log has the file name saved, but the file was not stored yet. Upload it again to open or print it.');
    return;
  }
  const url = window.URL.createObjectURL(stored.blob);
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.download = stored.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 30000);
}

async function printSelectedLogs(panel: HTMLElement) {
  const ids = selectedIds(panel);
  if (!ids.length) {
    window.alert('Select one or more measurement logs to print.');
    return;
  }
  const logs = readLogs().filter(log => ids.includes(log.id));
  const storedFiles = (await Promise.all(logs.map(async log => ({ log, stored: await readStoredFile(log.id) })))).filter(item => item.stored);
  if (!storedFiles.length) {
    window.alert('No printable files found. Older log-only records need to be uploaded again first.');
    return;
  }
  const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=1100,height=850');
  if (!printWindow) {
    window.alert('Popup blocked. Allow popups for MCC to print selected logs.');
    return;
  }
  const objectUrls: string[] = [];
  const documents = await Promise.all(storedFiles.map(async ({ log, stored }) => {
    if (!stored) return '';
    const url = window.URL.createObjectURL(stored.blob);
    objectUrls.push(url);
    const type = (stored.type || log.type || '').toLowerCase();
    const safeName = escapeHtml(stored.name || log.name);
    if (type.includes('pdf') || stored.name.toLowerCase().endsWith('.pdf')) {
      return `<section class="print-page"><h2>${safeName}</h2><iframe src="${url}"></iframe></section>`;
    }
    if (type.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(stored.name)) {
      return `<section class="print-page"><h2>${safeName}</h2><img src="${url}" alt="${safeName}" /></section>`;
    }
    if (type.includes('text') || /\.(csv|txt)$/i.test(stored.name)) {
      const text = escapeHtml(await stored.blob.text());
      return `<section class="print-page"><h2>${safeName}</h2><pre>${text}</pre></section>`;
    }
    return `<section class="print-page"><h2>${safeName}</h2><p>This file type may need to be opened and printed from its native app.</p><a href="${url}" download="${safeName}">Open / Download file</a></section>`;
  }));
  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>Measurement Inspection Logs</title>
        <style>
          body { margin: 0; font-family: Arial, sans-serif; background: #fff; color: #111; }
          .print-cover { padding: 24px; border-bottom: 2px solid #111; }
          .print-cover h1 { margin: 0 0 8px; font-size: 22px; }
          .print-cover p { margin: 0; color: #444; }
          .print-page { break-after: page; page-break-after: always; padding: 18px; }
          h2 { margin: 0 0 12px; font-size: 16px; }
          iframe { width: 100%; height: 92vh; border: 0; }
          img { display: block; max-width: 100%; max-height: 92vh; margin: 0 auto; }
          pre { white-space: pre-wrap; font-size: 11px; border: 1px solid #ccc; padding: 12px; }
          @media print { .print-page { min-height: 96vh; } }
        </style>
      </head>
      <body>
        <section class="print-cover"><h1>Measurement Inspection Logs</h1><p>${new Date().toLocaleString()} • ${documents.length} selected record(s)</p></section>
        ${documents.join('')}
      </body>
    </html>
  `);
  printWindow.document.close();
  window.setTimeout(() => {
    printWindow.focus();
    printWindow.print();
    window.setTimeout(() => objectUrls.forEach(url => window.URL.revokeObjectURL(url)), 30000);
  }, 1500);
}

async function deleteSelectedLogs(panel: HTMLElement) {
  const ids = selectedIds(panel);
  if (!ids.length) {
    window.alert('Select one or more measurement logs to delete.');
    return;
  }
  if (!window.confirm(`Delete ${ids.length} selected measurement log(s)?`)) return;
  await Promise.all(ids.map(deleteStoredFile));
  writeLogs(readLogs().filter(log => !ids.includes(log.id)));
  renderLogRows(panel);
}

function patchPanel(panel: HTMLElement) {
  if (panel.getAttribute(PATCHED_ATTR) === 'true') return;
  const setupText = panel.querySelector('.machine-measurement-setup-pill')?.textContent?.trim() || 'STANDARD INJECTION';
  panel.setAttribute(PATCHED_ATTR, 'true');
  panel.classList.add('measurement-log-panel');
  panel.innerHTML = `
    <div class="machine-measurement-panel-heading">
      <div>
        <p class="eyebrow">Measurement Inspection Logs</p>
        <h4>Measurement Inspection Logs</h4>
      </div>
      <span class="machine-measurement-setup-pill">${escapeHtml(setupText)}</span>
    </div>
    <div class="measurement-log-shell">
      <div class="measurement-log-import-card">
        <span>Upload / Import</span>
        <strong>Screw & Barrel Inspection Records</strong>
        <small>Upload completed inspection PDFs, scans, photos, CSV files, or imported records. MCC files them into yearly folders automatically.</small>
        <div class="measurement-log-actions">
          <button class="secondary-button compact-button" type="button" data-measurement-upload>Upload File</button>
          <button class="secondary-button compact-button" type="button" data-measurement-import>Import Record</button>
        </div>
        <input type="file" data-measurement-file-input multiple hidden accept=".pdf,.png,.jpg,.jpeg,.csv,.txt,.xlsx,.xls,.doc,.docx" />
      </div>
      <div class="measurement-log-list-card">
        <div class="measurement-log-list-heading">
          <div>
            <strong data-measurement-active-year>Year Folder</strong>
            <span>Pick a year folder, then select one or more logs to open or print.</span>
          </div>
          <em data-measurement-selected-count>0 selected</em>
        </div>
        <div class="measurement-year-folder-row" data-measurement-year-folders></div>
        <div class="measurement-log-bulk-actions">
          <button class="secondary-button compact-button" type="button" data-measurement-print-selected>Print Selected</button>
          <button class="secondary-button compact-button" type="button" data-measurement-delete-selected>Delete Selected</button>
        </div>
        <div data-measurement-log-list></div>
      </div>
    </div>
  `;

  const fileInput = panel.querySelector<HTMLInputElement>('[data-measurement-file-input]');
  const uploadButton = panel.querySelector<HTMLButtonElement>('[data-measurement-upload]');
  const importButton = panel.querySelector<HTMLButtonElement>('[data-measurement-import]');
  const printButton = panel.querySelector<HTMLButtonElement>('[data-measurement-print-selected]');
  const deleteButton = panel.querySelector<HTMLButtonElement>('[data-measurement-delete-selected]');
  const triggerInput = () => fileInput?.click();
  uploadButton?.addEventListener('click', triggerInput);
  importButton?.addEventListener('click', triggerInput);
  printButton?.addEventListener('click', () => void printSelectedLogs(panel));
  deleteButton?.addEventListener('click', () => void deleteSelectedLogs(panel));
  fileInput?.addEventListener('change', () => {
    void (async () => {
      const selectedFiles = Array.from(fileInput.files ?? []);
      if (!selectedFiles.length) return;
      const uploadedAt = new Date().toISOString();
      const newLogs: MeasurementLogEntry[] = [];
      for (const file of selectedFiles) {
        const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        await saveStoredFile(file, id, uploadedAt);
        newLogs.push({
          id,
          name: file.name,
          size: file.size,
          type: file.type || file.name.split('.').pop()?.toUpperCase() || 'File',
          uploadedAt,
          year: logYear(uploadedAt),
          hasStoredFile: true,
        });
      }
      writeLogs([...newLogs, ...readLogs()]);
      panel.dataset.selectedMeasurementYear = logYear(uploadedAt);
      fileInput.value = '';
      renderLogRows(panel);
    })().catch(error => {
      console.error('Measurement log upload failed', error);
      window.alert('Measurement log upload failed. Check console for details.');
    });
  });
  renderLogRows(panel);
}

function patchMeasurementInspectionPanels() {
  document.querySelectorAll<HTMLElement>(PANEL_SELECTOR).forEach(patchPanel);
}

function injectStyles() {
  if (document.getElementById('measurement-log-panel-styles')) return;
  const style = document.createElement('style');
  style.id = 'measurement-log-panel-styles';
  style.textContent = `
    .measurement-log-panel .measurement-log-shell {
      display: grid;
      grid-template-columns: minmax(260px, .72fr) minmax(380px, 1.28fr);
      gap: 12px;
    }
    .measurement-log-import-card,
    .measurement-log-list-card {
      border: 1px solid rgba(68, 215, 255, .28);
      border-radius: 12px;
      background: linear-gradient(145deg, rgba(6, 35, 48, .78), rgba(4, 15, 26, .88));
      padding: 14px;
      min-height: 136px;
    }
    .measurement-log-import-card span,
    .measurement-log-list-heading span {
      color: #86f1ff;
      font-size: .72rem;
      font-weight: 900;
      letter-spacing: .04em;
      text-transform: uppercase;
    }
    .measurement-log-import-card strong,
    .measurement-log-list-heading strong,
    .measurement-log-empty strong,
    .measurement-log-row strong {
      display: block;
      color: #f3fbff;
      margin-top: 5px;
    }
    .measurement-log-import-card small,
    .measurement-log-empty span,
    .measurement-log-row span {
      display: block;
      color: #a8c7d5;
      font-weight: 800;
      margin-top: 8px;
    }
    .measurement-log-actions,
    .measurement-log-bulk-actions,
    .measurement-year-folder-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 14px;
    }
    .measurement-log-list-heading {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 10px;
    }
    .measurement-log-list-heading em {
      border: 1px solid rgba(255, 210, 94, .34);
      border-radius: 999px;
      color: #ffd25e;
      font-size: .72rem;
      font-style: normal;
      font-weight: 950;
      padding: 5px 9px;
      white-space: nowrap;
    }
    .measurement-year-folder {
      align-items: center;
      background: rgba(4, 18, 34, .72);
      border: 1px solid rgba(68, 215, 255, .28);
      border-radius: 999px;
      color: #e8fbff;
      cursor: pointer;
      display: inline-flex;
      font-size: .76rem;
      font-weight: 950;
      gap: 7px;
      min-height: 30px;
      padding: 0 10px;
    }
    .measurement-year-folder.active {
      background: rgba(68, 215, 255, .18);
      border-color: #44d7ff;
      box-shadow: 0 0 14px rgba(68, 215, 255, .14);
    }
    .measurement-year-folder span {
      border: 1px solid rgba(255, 255, 255, .2);
      border-radius: 999px;
      color: #ffd25e;
      font-size: .68rem;
      padding: 1px 6px;
    }
    .measurement-log-empty,
    .measurement-log-row {
      border: 1px solid rgba(68, 215, 255, .16);
      border-radius: 10px;
      background: rgba(2, 10, 18, .62);
      padding: 11px;
    }
    .measurement-log-row {
      align-items: center;
      display: grid;
      gap: 10px;
      grid-template-columns: auto minmax(0, 1fr) auto;
      margin-top: 8px;
    }
    .measurement-log-main { min-width: 0; }
    .measurement-log-main strong,
    .measurement-log-main span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .measurement-log-select {
      align-items: center;
      cursor: pointer;
      display: inline-flex;
      height: 24px;
      justify-content: center;
      position: relative;
      width: 24px;
    }
    .measurement-log-select input { opacity: 0; position: absolute; }
    .measurement-log-select span {
      border: 1px solid rgba(68, 215, 255, .42);
      border-radius: 7px;
      display: block;
      height: 18px;
      width: 18px;
    }
    .measurement-log-select input:checked + span {
      background: #44d7ff;
      box-shadow: 0 0 12px rgba(68, 215, 255, .26);
    }
    .measurement-log-row-actions {
      align-items: center;
      display: flex;
      gap: 8px;
    }
    .measurement-log-row-actions em {
      color: #ffd25e;
      font-size: .68rem;
      font-style: normal;
      font-weight: 950;
      text-transform: uppercase;
      white-space: nowrap;
    }
    @media (max-width: 900px) {
      .measurement-log-panel .measurement-log-shell { grid-template-columns: 1fr; }
      .measurement-log-list-heading { display: block; }
      .measurement-log-row { grid-template-columns: auto minmax(0, 1fr); }
      .measurement-log-row-actions { grid-column: 2; }
    }
  `;
  document.head.appendChild(style);
}

if (typeof window !== 'undefined') {
  injectStyles();
  window.requestAnimationFrame(patchMeasurementInspectionPanels);
  const observer = new MutationObserver(() => patchMeasurementInspectionPanels());
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
