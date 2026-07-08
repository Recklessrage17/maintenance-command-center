type MeasurementLogEntry = {
  id: string;
  name: string;
  size: number;
  type: string;
  uploadedAt: string;
};

const PANEL_SELECTOR = '.machine-measurement-panel';
const PATCHED_ATTR = 'data-measurement-log-panel';
const STORAGE_KEY = 'mcc:measurement-inspection-logs:v1';

function formatBytes(size: number) {
  if (!Number.isFinite(size) || size <= 0) return '-';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function readLogs(): MeasurementLogEntry[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLogs(logs: MeasurementLogEntry[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(logs.slice(0, 100)));
}

function renderLogRows(container: HTMLElement) {
  const logs = readLogs();
  const list = container.querySelector<HTMLElement>('[data-measurement-log-list]');
  if (!list) return;
  if (!logs.length) {
    list.innerHTML = `
      <div class="measurement-log-empty">
        <strong>No measurement inspection logs uploaded yet.</strong>
        <span>Upload the completed screw/barrel inspection PDF, scan, photo, or imported record here.</span>
      </div>
    `;
    return;
  }
  list.innerHTML = logs.map(log => `
    <article class="measurement-log-row">
      <div>
        <strong>${escapeHtml(log.name)}</strong>
        <span>${escapeHtml(log.type || 'File')} • ${formatBytes(log.size)} • ${new Date(log.uploadedAt).toLocaleString()}</span>
      </div>
      <em>Imported</em>
    </article>
  `).join('');
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character] ?? character));
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
        <small>Upload completed inspection PDFs, scans, photos, CSV files, or imported records for this asset.</small>
        <div class="measurement-log-actions">
          <button class="secondary-button compact-button" type="button" data-measurement-upload>Upload File</button>
          <button class="secondary-button compact-button" type="button" data-measurement-import>Import Record</button>
        </div>
        <input type="file" data-measurement-file-input multiple hidden accept=".pdf,.png,.jpg,.jpeg,.csv,.xlsx,.xls,.doc,.docx" />
      </div>
      <div class="measurement-log-list-card">
        <div class="measurement-log-list-heading">
          <strong>Uploaded / Imported Logs</strong>
          <span>Local browser log until backend file storage is wired.</span>
        </div>
        <div data-measurement-log-list></div>
      </div>
    </div>
  `;

  const fileInput = panel.querySelector<HTMLInputElement>('[data-measurement-file-input]');
  const uploadButton = panel.querySelector<HTMLButtonElement>('[data-measurement-upload]');
  const importButton = panel.querySelector<HTMLButtonElement>('[data-measurement-import]');
  const triggerInput = () => fileInput?.click();
  uploadButton?.addEventListener('click', triggerInput);
  importButton?.addEventListener('click', triggerInput);
  fileInput?.addEventListener('change', () => {
    const selectedFiles = Array.from(fileInput.files ?? []);
    if (!selectedFiles.length) return;
    const newLogs = selectedFiles.map(file => ({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: file.name,
      size: file.size,
      type: file.type || file.name.split('.').pop()?.toUpperCase() || 'File',
      uploadedAt: new Date().toISOString(),
    }));
    writeLogs([...newLogs, ...readLogs()]);
    fileInput.value = '';
    renderLogRows(panel);
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
      grid-template-columns: minmax(260px, .8fr) minmax(320px, 1.2fr);
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
    .measurement-log-actions {
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
    .measurement-log-empty,
    .measurement-log-row {
      border: 1px solid rgba(68, 215, 255, .16);
      border-radius: 10px;
      background: rgba(2, 10, 18, .62);
      padding: 11px;
    }
    .measurement-log-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-top: 8px;
    }
    .measurement-log-row em {
      color: #ffd25e;
      font-size: .72rem;
      font-style: normal;
      font-weight: 950;
      text-transform: uppercase;
    }
    @media (max-width: 900px) {
      .measurement-log-panel .measurement-log-shell { grid-template-columns: 1fr; }
      .measurement-log-list-heading { display: block; }
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
