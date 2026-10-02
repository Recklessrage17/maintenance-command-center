const CORRECTION_WINDOW_MS = 48 * 60 * 60 * 1000;

type IssueLifecycle = { issue_status: string; resolved_at: string | null };

export function assetNoteUpdateLockAt(note: IssueLifecycle): string | null {
  if (note.issue_status !== 'resolved') return null;
  const resolved = note.resolved_at ? Date.parse(note.resolved_at) : NaN;
  const lock = resolved + CORRECTION_WINDOW_MS;
  return Number.isFinite(lock) && lock <= 8.64e15 ? new Date(lock).toISOString() : null;
}

// Caller supplies the server clock; malformed resolution metadata fails closed.
export function assetNoteUpdateWindowOpen(note: IssueLifecycle, now: string): boolean {
  if (note.issue_status === 'active') return true;
  if (note.issue_status !== 'resolved') return false;
  const lockAt = assetNoteUpdateLockAt(note);
  const current = Date.parse(now);
  return lockAt !== null && Number.isFinite(current)
    && current >= Date.parse(note.resolved_at!) && current < Date.parse(lockAt);
}

export const ISSUE_UPDATE_WINDOW_EXPIRED = {
  ok: false,
  code: 'ISSUE_UPDATE_WINDOW_EXPIRED',
  error: 'The 48-hour correction window for this resolved issue has expired. Reopen the issue to add further work.',
};

export class IssueUpdateWindowExpiredError extends Error {
  constructor() { super(ISSUE_UPDATE_WINDOW_EXPIRED.error); }
}
