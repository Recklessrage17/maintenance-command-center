import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type MachineLifecycleAsset = {
  id: number; assetNumber: string; assetName: string; brand: string; model: string; serialNumber: string;
  lifecycleStatus?: 'active' | 'out_of_service' | 'archived'; lifecycleRevision?: number;
  retirementReason?: string; retirementNotes?: string; retiredAt?: string | null; retiredBy?: string;
  replacementMachineId?: number | null;
  replacementMachine?: { id: number; assetNumber: string; assetName: string; lifecycleStatus: string } | null;
};
export const lifecycleLabel = (state?: string) => state === 'archived' ? 'Archived' : state === 'out_of_service' ? 'Out of Service' : 'Active';

export function MachineLifecycleControls({ asset, canManage, onChanged, onOpenReplacement }: {
  asset: MachineLifecycleAsset; canManage: boolean; onChanged: (asset: MachineLifecycleAsset) => void;
  onOpenReplacement: (id: number) => void;
}) {
  const [mode, setMode] = useState<'retire' | 'restore' | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const panel = useRef<HTMLElement | null>(null);
  function close() { setMode(null); requestAnimationFrame(() => {
    if(opener.current?.isConnected)opener.current.focus();
    else (panel.current?.querySelector<HTMLElement>('.machine-lifecycle-actions button')??panel.current)?.focus();
  }); }
  return <section ref={panel} tabIndex={-1} className="mcc-card glass-panel machine-lifecycle-panel" aria-label="Machine lifecycle">
    <div className="machine-lifecycle-copy"><strong>Lifecycle: {lifecycleLabel(asset.lifecycleStatus)}</strong>
      {asset.retirementReason && <span>Reason: {asset.retirementReason} · {asset.retiredAt ? new Date(asset.retiredAt).toLocaleDateString() : ''}{asset.retiredBy ? ` · ${asset.retiredBy}` : ''}</span>}
      {asset.retirementNotes && <p>{asset.retirementNotes}</p>}
      {asset.replacementMachine && <button className="link-button" type="button" onClick={() => onOpenReplacement(asset.replacementMachine!.id)}>Replacement: {asset.replacementMachine.assetNumber}</button>}
    </div>
    {canManage && <div className="machine-lifecycle-actions">
      <button className="secondary-button compact-button" type="button" onClick={event => { opener.current = event.currentTarget; setMode('retire'); }}>Retire / Archive Machine</button>
      {asset.lifecycleStatus && asset.lifecycleStatus !== 'active' && <button className="primary-button compact-button" type="button" onClick={event => { opener.current = event.currentTarget; setMode('restore'); }}>Restore Machine</button>}
    </div>}
    {mode && <MachineLifecycleDialog key={`${asset.id}:${mode}`} asset={asset} restore={mode === 'restore'} onClose={close} onChanged={updated => { onChanged(updated); close(); }} />}
  </section>;
}
function MachineLifecycleDialog({ asset, restore, onClose, onChanged }: {
  asset: MachineLifecycleAsset; restore: boolean; onClose: () => void;
  onChanged: (asset: MachineLifecycleAsset) => void;
}) {
  const [state, setState] = useState(restore ? 'active' : asset.lifecycleStatus === 'out_of_service' ? 'out_of_service' : 'archived');
  const [reason, setReason] = useState(asset.retirementReason ?? '');
  const [notes, setNotes] = useState(restore ? '' : asset.retirementNotes ?? '');
  const [replacement, setReplacement] = useState(String(asset.replacementMachineId ?? ''));
  const [choices, setChoices] = useState<MachineLifecycleAsset[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const locked = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('select,textarea')?.focus());
    let cancelled = false;
    if (!restore) void fetch('/api/machine-library/assets?lifecycle=current', { credentials: 'include' }).then(async response => {
      if (!response.ok) throw Error('Replacement machines could not be loaded.');
      const data = await response.json(); if (!cancelled) setChoices((data.assets ?? []).filter((item: MachineLifecycleAsset) => item.id !== asset.id));
    }).catch(() => { if (!cancelled) setError('Replacement choices could not be loaded. You can archive without a replacement.'); });
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, [asset.id, restore]);
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (document.querySelector('.library-export-modal')) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); if (!locked.current) onClose(); }
      if (event.key !== 'Tab') return;
      const controls = [...(form.current?.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),textarea:not(:disabled),input:not(:disabled)') ?? [])];
      if (!controls.length) { event.preventDefault(); form.current?.focus(); return; }
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener('keydown', keydown, true);
    return () => document.removeEventListener('keydown', keydown, true);
  }, [onClose]);
  const valid = restore ? Boolean(notes.trim()) : Boolean(reason) && (reason !== 'other' || Boolean(notes.trim()));
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!valid || locked.current) return;
    locked.current = true; setPending(true); setError('');
    try {
      const response = await fetch(`/api/machine-library/assets/${asset.id}/lifecycle`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(restore ? { lifecycleStatus: 'active', expectedRevision: asset.lifecycleRevision ?? 0, restoreReason: notes } : {
          lifecycleStatus: state, expectedRevision: asset.lifecycleRevision ?? 0, retirementReason: reason, retirementNotes: notes,
          replacementMachineId: reason === 'replaced' && replacement ? Number(replacement) : null,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw Error(data.error || 'Machine lifecycle could not be changed.');
      onChanged(data.asset);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Machine lifecycle could not be changed.'); }
    finally { locked.current = false; setPending(false); }
  }
  return createPortal(<div className="modal-backdrop glass-modal-backdrop machine-lifecycle-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !locked.current) onClose(); }}>
    <form className="mcc-card glass-modal-shell machine-lifecycle-dialog" ref={form} role="dialog" tabIndex={-1} aria-modal="true" aria-labelledby="machine-lifecycle-title" aria-busy={pending} onSubmit={submit}>
      <div className="modal-heading"><div><p className="eyebrow">Machine lifecycle</p><h3 id="machine-lifecycle-title">{restore ? 'Restore Machine' : 'Retire / Archive Machine'}</h3></div></div>
      <p><strong>{asset.assetNumber} · {asset.assetName}</strong><br />{asset.brand} · {asset.model}{asset.serialNumber ? ` · S/N ${asset.serialNumber}` : ''}</p>
      <p>{restore ? 'Return this same machine to the active library. Its history and files will be retained.' : 'Keep this machine and all of its records. Archiving removes it from daily machine lists; Out of Service keeps it visible without active PM scheduling.'}</p>
      {!restore && <><label className="form-field"><span>Action</span><select value={state} onChange={event => setState(event.target.value)} disabled={pending}><option value="archived">Archive Machine</option><option value="out_of_service">Mark Out of Service</option></select></label>
        <label className="form-field"><span>Retirement Reason *</span><select value={reason} onChange={event => setReason(event.target.value)} disabled={pending} required><option value="">Select a reason</option><option value="replaced">Replaced</option><option value="scrapped">Scrapped</option><option value="retired">Retired</option><option value="other">Other</option></select></label>
        {reason === 'replaced' && <label className="form-field"><span>Replacement Machine (optional)</span><select value={replacement} onChange={event => setReplacement(event.target.value)} disabled={pending}><option value="">No replacement selected</option>{asset.replacementMachine && !choices.some(item => item.id === asset.replacementMachine!.id) && <option value={asset.replacementMachine.id}>{asset.replacementMachine.assetNumber}</option>}{choices.map(item => <option key={item.id} value={item.id}>{item.assetNumber} · {item.assetName}</option>)}</select></label>}</>}
      <label className="form-field"><span>{restore ? 'Restore Reason *' : reason === 'other' ? 'Explanation *' : 'Retirement Notes'}</span><textarea value={notes} onChange={event => setNotes(event.target.value)} maxLength={1200} required={restore || reason === 'other'} disabled={pending} rows={3} /></label>
      {error && <p className="form-message error" role="alert">{error}</p>}
      <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose} disabled={pending}>Cancel</button>
        <button type="submit" className="primary-button" disabled={!valid || pending}>{pending ? 'Saving…' : restore ? 'Confirm Restore' : state === 'archived' ? 'Confirm Archive' : 'Confirm Out of Service'}</button></div>
    </form>
  </div>, document.body);
}
