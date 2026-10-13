import { useEffect, useRef, useState } from 'react';
import { LibraryExportProgress } from '../../components/LibraryExportProgress';
import type { MachineLifecycleAsset } from './MachineLifecycleControls';

type ExportState = { active: boolean; title: string; message: string; transferredBytes: number; totalBytes: number; completedFiles: number; fileCount: number; error: string };
type Writable = { write: (bytes: Uint8Array) => Promise<void>; close: () => Promise<void>; abort: () => Promise<void> };
type Picker = Window & { showSaveFilePicker?: (options: { suggestedName: string; types: Array<{ description: string; accept: Record<string, string[]> }> }) => Promise<{ createWritable: () => Promise<Writable> }> };

// Read only. IDs/asset numbers are structured associations; filenames and prose
// cannot establish which machine owns an orphaned browser file.
export async function browserInspectionCoverage(asset: MachineLifecycleAsset) {
  let checked = true;
  const records = new Set<string>(), allIds = new Set<string>();
  for (const key of ['mcc:screw-barrel-inspection-records:v3', 'mcc:measurement-inspection-logs:v2', 'mcc:measurement-inspection-logs:v1']) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      if (raw.length > 4 * 1024 ** 2) { checked = false; continue; }
      const rows = JSON.parse(raw) as Array<{ id?: string; assetId?: string; assetNumber?: string; storage?: string }>;
      if (!Array.isArray(rows) || rows.length > 10000) { checked = false; continue; }
      for (const row of rows) if (row && row.storage !== 'server' && row.id) {
        allIds.add(String(row.id));
        if (String(row.assetId) === String(asset.id) || (!row.assetId || row.assetId === row.assetNumber) && row.assetNumber === asset.assetNumber) records.add(String(row.id));
      }
    } catch { checked = false; }
  }
  let unmappedFiles = 0;
  try {
    // databases() avoids creating an empty legacy DB just to inspect coverage.
    if (!indexedDB.databases) checked = false;
    else if ((await indexedDB.databases()).some(db => db.name === 'mcc-measurement-inspection-logs')) {
      const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
        const request = indexedDB.open('mcc-measurement-inspection-logs');
        let db: IDBDatabase | undefined;
        const timer = setTimeout(() => { db?.close(); reject(Error('Browser inspection check timed out.')); }, 5000);
        request.onupgradeneeded = () => { request.transaction?.abort(); };
        request.onerror = () => { clearTimeout(timer); reject(request.error); };
        request.onblocked = () => { clearTimeout(timer); reject(Error('Browser inspection files are locked.')); };
        request.onsuccess = () => {
          db = request.result;
          if (!db.objectStoreNames.contains('files')) { clearTimeout(timer); db.close(); reject(Error('Browser inspection source is unavailable.')); return; }
          const tx = db.transaction('files', 'readonly');
          // Key cursor bounds memory even if unrelated legacy files are numerous.
          const result: IDBValidKey[] = []; const cursor = tx.objectStore('files').openKeyCursor();
          cursor.onsuccess = () => { if (cursor.result) { result.push(cursor.result.key); if (result.length > 100000) { tx.abort(); return; } cursor.result.continue(); } };
          tx.oncomplete = () => { clearTimeout(timer); db?.close(); resolve(result); };
          tx.onabort = tx.onerror = () => { clearTimeout(timer); db?.close(); reject(Error('Browser inspection check failed.')); };
        };
      });
      unmappedFiles = keys.filter(key => !allIds.has(String(key))).length;
    }
  } catch { checked = false; }
  return { checked, recordCount: records.size, unmappedFiles };
}

export function useMachineHistoryExport() {
  const [state, setState] = useState<ExportState | null>(null);
  const controller = useRef<AbortController | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  function close() { if (controller.current) return; setState(null); requestAnimationFrame(() => opener.current?.isConnected && opener.current.focus()); }
  async function start(asset: MachineLifecycleAsset) {
    if (controller.current) return;
    const abort = new AbortController(); controller.current = abort;
    opener.current = document.activeElement as HTMLElement;
    const update = (patch: Partial<ExportState>) => setState(current => current ? { ...current, ...patch } : current);
    setState({ active: true, title: 'Machine History Export', message: 'Choose where to save the ZIP…', transferredBytes: 0, totalBytes: 0, completedFiles: 0, fileCount: 1, error: '' });
    let writable: Writable | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const filename = `MCC_Machine_${asset.id}_${asset.assetNumber.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 60)}_History.zip`;
      // Invoke the picker before awaiting coverage/network, preserving user activation.
      const picker = (window as Picker).showSaveFilePicker;
      const handle = picker ? await picker.call(window, { suggestedName: filename, types: [{ description: 'Machine history ZIP', accept: { 'application/zip': ['.zip'] } }] }) : undefined;
      abort.signal.throwIfAborted();
      update({ message: 'Checking this browser for legacy inspections. Browser-only files will be disclosed in the manifest…' });
      const coverage = await browserInspectionCoverage(asset);
      abort.signal.throwIfAborted();
      const query = new URLSearchParams({ legacyCount: String(coverage.recordCount), unmappedFiles: String(coverage.unmappedFiles) });
      if (coverage.checked) query.set('legacyChecked', '1');
      const url = `/api/machine-library/assets/${asset.id}/history-export.zip?${query}`;
      if (!handle) {
        const link = document.createElement('a'); link.href = url; link.download = filename;
        document.body.appendChild(link); link.click(); link.remove();
        update({ active: false, message: 'ZIP requested. Your browser manages download progress and cancellation. Review SUMMARY.txt and MANIFEST.json for missing attachments and browser-only records.' });
        return;
      }
      update({ message: 'Preparing a stable history snapshot and checksums…' });
      const response = await fetch(url, { credentials: 'include', signal: abort.signal });
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw Error(data.error || `History export failed (${response.status}).`); }
      const total = Number(response.headers.get('Content-Length'));
      if (!Number.isSafeInteger(total) || total < 1 || total > 3 * 1024 ** 3) { await response.body?.cancel(); throw Error('The history download size is invalid.'); }
      reader = response.body?.getReader();
      if (!reader) throw Error('The browser did not provide a download stream.');
      writable = await handle.createWritable();
      update({ message: 'Saving the history ZIP…', totalBytes: total });
      let bytes = 0;
      while (true) {
        abort.signal.throwIfAborted();
        const chunk = await reader.read(); if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > total) throw Error('The history download size changed.');
        await writable.write(chunk.value); update({ transferredBytes: bytes });
      }
      abort.signal.throwIfAborted();
      if (bytes !== total) throw Error('The history ZIP was interrupted.');
      await writable.close(); writable = undefined;
      const missing = Number(response.headers.get('X-MCC-History-Missing') || '0');
      update({ active: false, completedFiles: 1, message: `ZIP saved.${missing ? ` ${missing} attachments could not be included.` : ''} Review SUMMARY.txt and MANIFEST.json for server coverage and browser-only records.` });
    } catch (error) {
      try { await writable?.abort(); } catch { /* Browser handles rollback of an unfinished file. */ }
      try { await reader?.cancel(); } catch { /* Network may already be closed. */ }
      const cancelled = abort.signal.aborted || error instanceof DOMException && error.name === 'AbortError';
      update({ active: false, message: cancelled ? 'History export cancelled.' : 'History export failed.', error: cancelled ? '' : error instanceof Error ? error.message : 'The history ZIP could not be saved.' });
    } finally { reader?.releaseLock(); controller.current = null; }
  }
  return { state, start, cancel: () => controller.current?.abort(), close };
}

export function MachineHistoryExportProgress({ flow }: { flow: ReturnType<typeof useMachineHistoryExport> }) {
  useEffect(() => {
    if (!flow.state) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => document.querySelector<HTMLElement>('.library-export-modal button')?.focus());
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); if (flow.state?.active) flow.cancel(); else flow.close(); }
      if (event.key === 'Tab') { event.preventDefault(); document.querySelector<HTMLElement>('.library-export-modal button')?.focus(); }
    }
    document.addEventListener('keydown', keydown, true);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('keydown', keydown, true); if (previouslyFocused?.isConnected) previouslyFocused.focus(); };
  }, [Boolean(flow.state), flow.state?.active]);
  return <LibraryExportProgress state={flow.state} onCancel={flow.cancel} onClose={flow.close} />;
}
