import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import './pm-history-report.css';

type Completion = { id: number; completionDate: string };
const limit = 200;
const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
function calendarMonth(date: string) { return /^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(date) ? date.slice(0, 7) : ''; }
function monthLabel(month: string) { return `${monthNames[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`; }
function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove();
  // The browser consumes the link in this event turn; release it afterward.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
function printView(target: Window, blob: Blob, filename: string) {
  const doc = target.document; doc.title = filename; doc.body.replaceChildren();
  doc.body.style.cssText = 'margin:0;font:16px Arial,sans-serif;background:#eef3f5;color:#183644';
  const header = doc.createElement('header'); header.style.cssText = 'padding:12px;display:flex;gap:12px;flex-wrap:wrap;align-items:center';
  const title = doc.createElement('strong'); title.textContent = 'MCC PM Completion History';
  const instructions = doc.createElement('p'); instructions.textContent = 'Use Print PDF or the PDF viewer Print control. Open PDF also supports the normal browser print dialog.';
  instructions.style.cssText = 'margin:0;width:100%';
  const frame = doc.createElement('iframe'); frame.title = 'Selected PM completion report'; frame.style.cssText = 'border:0;width:100%;height:calc(100vh - 125px)';
  // The print window owns its blob, so closing the history modal does not
  // revoke an in-use report. Closing this window releases it.
  const urls = (target as Window & typeof globalThis).URL, url = urls.createObjectURL(blob);
  const open = doc.createElement('a'); open.textContent = 'Open PDF'; open.href = url; open.target = '_blank'; open.rel = 'noopener';
  const download = doc.createElement('a'); download.textContent = 'Download PDF'; download.href = url; download.download = filename;
  const print = doc.createElement('button'); print.textContent = 'Print PDF'; print.type = 'button';
  print.onclick = () => { try { if (!frame.contentWindow) throw Error(); frame.contentWindow.focus(); frame.contentWindow.print(); } catch { instructions.textContent = 'This browser requires the PDF viewer Print control. Use Open PDF, then Print or Ctrl+P.'; } };
  header.append(title, print, open, download, instructions); doc.body.append(header, frame); frame.src = url;
  target.addEventListener('beforeunload', () => urls.revokeObjectURL(url), { once: true });
}

export function usePmHistorySelection(history: Completion[], reportUrl: string, taskId?: number) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [month, setMonth] = useState(''), [mode, setMode] = useState<'download' | 'print' | null>(null);
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [fallback, setFallback] = useState('');
  const operation = useRef<AbortController | null>(null), fallbackUrl = useRef(''), alive = useRef(true);
  const identity = `${reportUrl}:${taskId ?? 'all'}`;
  const idsKey = history.map(record => record.id).join(',');
  const months = useMemo(() => [...new Set(history.filter(record => Number.isSafeInteger(record.id) && record.id > 0).map(record => calendarMonth(record.completionDate)).filter(Boolean))].sort().reverse(), [history]);
  useEffect(() => {
    alive.current = true; setSelected(new Set()); setMonth(''); setError(''); setMessage(''); setFallback('');
    return () => { alive.current = false; operation.current?.abort(); if (fallbackUrl.current) URL.revokeObjectURL(fallbackUrl.current); };
  }, [identity]);
  useEffect(() => { const valid = new Set(history.map(record => record.id)); setSelected(previous => [...previous].every(id => valid.has(id)) ? previous : new Set([...previous].filter(id => valid.has(id)))); }, [idsKey]);
  const chosenMonth = months.includes(month) ? month : months[0] || '';
  function toggle(id: number) { if (operation.current || !Number.isSafeInteger(id) || id <= 0) return; setSelected(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  function selectMonth() { if (operation.current) return; setSelected(previous => new Set([...previous, ...history.filter(record => calendarMonth(record.completionDate) === chosenMonth && Number.isSafeInteger(record.id) && record.id > 0).map(record => record.id)])); }
  async function report(action: 'download' | 'print') {
    if (operation.current || !selected.size || selected.size > limit) return;
    const completionIds = [...selected].sort((a, b) => a - b), controller = new AbortController(); operation.current = controller;
    let target: Window | null = null;
    if (action === 'print') {
      try { target = window.open('', '_blank'); if (target) { target.opener = null; target.document.title = 'MCC PM History'; target.document.body.textContent = 'Preparing the selected PM history PDF…'; } } catch { target = null; }
    }
    setMode(action); setError(''); setMessage(''); setFallback('');
    if (fallbackUrl.current) { URL.revokeObjectURL(fallbackUrl.current); fallbackUrl.current = ''; }
    try {
      const response = await fetch(reportUrl, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ completionIds, ...(taskId === undefined ? {} : { pmTaskId: taskId }) }), signal: controller.signal });
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw Error(data.error || 'The selected PM report could not be prepared.'); }
      if (!response.headers.get('Content-Type')?.startsWith('application/pdf')) throw Error('The server did not return a PDF report.');
      const length = Number(response.headers.get('Content-Length'));
      if (!Number.isSafeInteger(length) || length < 1 || length > 4 * 1024 * 1024) throw Error('The report download size is invalid.');
      const blob = await response.blob(); if (blob.size !== length) throw Error('The PDF report download was interrupted.');
      controller.signal.throwIfAborted();
      const filename = response.headers.get('Content-Disposition')?.match(/filename="([A-Za-z0-9._-]+\.pdf)"/)?.[1] || 'MCC_PM_History_Selected-Dates.pdf';
      if (action === 'download') { save(blob, filename); setMessage('PDF download requested through your browser.'); }
      else if (target && !target.closed) { printView(target, blob, filename); target.focus(); setMessage('Report opened for printing. Use its PDF print controls.'); }
      else { fallbackUrl.current = URL.createObjectURL(blob); setFallback(fallbackUrl.current); setMessage('The print window was blocked or closed. Open the PDF below, then use the browser print controls.'); }
    } catch (failure) {
      target?.close(); if (alive.current && !controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'The PDF report could not be prepared.');
    } finally { operation.current = null; if (alive.current) setMode(null); }
  }
  return { selected, months, month: chosenMonth, setMonth, toggle, selectMonth, clear: () => { if (!operation.current) { setSelected(new Set()); setError(''); setMessage(''); } }, mode, error, message, fallback, report };
}
export function PmHistorySelectionToolbar({ selection, loading }: { selection: ReturnType<typeof usePmHistorySelection>; loading: boolean }) {
  const busy = Boolean(selection.mode), unavailable = loading || busy;
  return <div className="pm-report-toolbar" role="group" aria-label="PM history selection and reporting">
    <label className="form-field pm-report-month"><span>Completion Month</span><select value={selection.month} onChange={event => selection.setMonth(event.target.value)} disabled={unavailable || !selection.months.length}>{!selection.months.length && <option value="">No completion months</option>}{selection.months.map(month => <option key={month} value={month}>{monthLabel(month)}</option>)}</select></label>
    <button type="button" className="secondary-button compact-button" onClick={selection.selectMonth} disabled={unavailable || !selection.month}>Select Month</button>
    <button type="button" className="secondary-button compact-button" onClick={selection.clear} disabled={unavailable || !selection.selected.size}>Clear Selection</button>
    <output aria-live="polite" className="pm-report-count">{selection.selected.size} selected</output>
    <button type="button" className="primary-button compact-button" onClick={() => void selection.report('download')} disabled={unavailable || !selection.selected.size || selection.selected.size > limit}>Download PDF</button>
    <button type="button" className="secondary-button compact-button" onClick={() => void selection.report('print')} disabled={unavailable || !selection.selected.size || selection.selected.size > limit}>Print Selected</button>
    <small className="pm-report-hint">Select Month adds matching records. Reports include only your selected completions.</small>
    {selection.selected.size > limit && <p role="alert">Select at most {limit} completions per report. Clear the selection and choose a smaller group.</p>}
    {busy && <p role="status">Preparing selected completion report…</p>}
    {selection.error && <p className="form-message error" role="alert">{selection.error}</p>}
    {selection.message && <p role="status">{selection.message}</p>}
    {selection.fallback && <a className="secondary-button compact-button" href={selection.fallback} target="_blank" rel="noopener noreferrer">Open PDF for printing</a>}
  </div>;
}
export function PmHistorySelectCheckbox({ record, title, selection }: { record: Completion; title: string; selection: ReturnType<typeof usePmHistorySelection> }) {
  return <label className="pm-report-checkbox"><input type="checkbox" aria-label={`Select completion #${record.id} on ${record.completionDate} for ${title}`} checked={selection.selected.has(record.id)} onChange={() => selection.toggle(record.id)} disabled={Boolean(selection.mode) || !Number.isSafeInteger(record.id) || record.id <= 0} /><span>Select</span></label>;
}
export function usePmHistoryModalFocus(ref: RefObject<HTMLElement | null>, onClose: () => void) {
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null, frame = requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('button')?.focus());
    function key(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close.current(); }
      if (event.key !== 'Tab') return;
      const controls = [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]') ?? [])].filter(element => element.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener('keydown', key, true);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('keydown', key, true); if (opener?.isConnected) opener.focus(); };
  }, [ref]);
}
