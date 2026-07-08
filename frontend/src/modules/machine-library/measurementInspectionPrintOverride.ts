export {};

type StoredMeasurementFile = {
  id: string;
  name: string;
  type: string;
  uploadedAt: string;
  blob: Blob;
};

const DB_NAME = 'mcc-measurement-inspection-logs';
const DB_VERSION = 1;
const FILE_STORE = 'files';

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

function selectedReadyIds(panel: HTMLElement) {
  return Array.from(panel.querySelectorAll<HTMLInputElement>('[data-measurement-log-check]:checked:not(:disabled)')).map(input => input.value);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character] ?? character));
}

function isPdf(file: StoredMeasurementFile) {
  return file.type.toLowerCase().includes('pdf') || file.name.toLowerCase().endsWith('.pdf');
}

function isImage(file: StoredMeasurementFile) {
  return file.type.toLowerCase().startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(file.name);
}

async function printSelectedMeasurementLogs(panel: HTMLElement) {
  const ids = selectedReadyIds(panel);
  if (!ids.length) {
    window.alert('Select one or more READY measurement logs to print. LOG ONLY records need to be uploaded again first.');
    return;
  }

  const files = (await Promise.all(ids.map(readStoredFile))).filter((file): file is StoredMeasurementFile => Boolean(file));
  if (!files.length) {
    window.alert('No printable files found. Upload the record again so MCC can store the file, then print.');
    return;
  }

  const objectUrls: string[] = [];
  const pdfs = files.filter(isPdf);
  const printableInline = files.filter(file => !isPdf(file));

  for (const file of pdfs) {
    const url = window.URL.createObjectURL(file.blob);
    objectUrls.push(url);
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (!opened) {
      window.alert('Popup blocked. Allow popups for MCC so the PDF can open in the browser viewer for printing.');
      break;
    }
  }

  if (printableInline.length) {
    const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=1100,height=850');
    if (!printWindow) {
      window.alert('Popup blocked. Allow popups for MCC to print selected logs.');
      return;
    }
    const sections = await Promise.all(printableInline.map(async file => {
      const url = window.URL.createObjectURL(file.blob);
      objectUrls.push(url);
      const safeName = escapeHtml(file.name);
      if (isImage(file)) return `<section class="print-page"><h2>${safeName}</h2><img src="${url}" alt="${safeName}" /></section>`;
      if (file.type.toLowerCase().includes('text') || /\.(csv|txt)$/i.test(file.name)) {
        return `<section class="print-page"><h2>${safeName}</h2><pre>${escapeHtml(await file.blob.text())}</pre></section>`;
      }
      return `<section class="print-page"><h2>${safeName}</h2><p>Open this file and print it from its native app.</p><a href="${url}" download="${safeName}">Open / Download file</a></section>`;
    }));
    printWindow.document.write(`<!doctype html><html><head><title>Measurement Inspection Logs</title><style>body{margin:0;font-family:Arial,sans-serif;color:#111}.print-cover{padding:24px;border-bottom:2px solid #111}.print-page{break-after:page;page-break-after:always;padding:18px}h2{font-size:16px;margin:0 0 12px}img{display:block;max-width:100%;max-height:92vh;margin:0 auto}pre{white-space:pre-wrap;font-size:11px;border:1px solid #ccc;padding:12px}</style></head><body><section class="print-cover"><h1>Measurement Inspection Logs</h1><p>${new Date().toLocaleString()} • ${sections.length} selected non-PDF record(s)</p></section>${sections.join('')}</body></html>`);
    printWindow.document.close();
    window.setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 900);
  }

  if (pdfs.length) {
    window.setTimeout(() => {
      window.alert(`${pdfs.length} PDF record(s) opened in the browser PDF viewer. Use the PDF viewer print button or Ctrl+P to print. This avoids blank PDF print pages.`);
    }, 350);
  }

  window.setTimeout(() => objectUrls.forEach(url => window.URL.revokeObjectURL(url)), 60000);
}

if (typeof window !== 'undefined') {
  document.addEventListener('click', event => {
    const button = (event.target as HTMLElement | null)?.closest?.('[data-measurement-print-selected]');
    if (!button) return;
    const panel = button.closest('.measurement-log-panel') as HTMLElement | null;
    if (!panel) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    void printSelectedMeasurementLogs(panel).catch(error => {
      console.error('Measurement log print failed', error);
      window.alert('Measurement log print failed. Try opening the file and printing from the browser PDF viewer.');
    });
  }, true);
}
