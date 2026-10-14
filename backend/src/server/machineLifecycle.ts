import type { DatabaseSync } from 'node:sqlite';

export type MachineLifecycleState = 'active' | 'out_of_service' | 'archived';
export type MachineLifecycleRow = {
  lifecycle_status: MachineLifecycleState; retirement_reason: string; retirement_notes: string;
  retired_at: string | null; retired_by_user_id: number | null; retired_by_name: string;
  replacement_asset_id: number | null; lifecycle_revision: number; lifecycle_updated_at: string | null;
  lifecycle_updated_by_user_id: number | null; restored_at: string | null; restored_by_user_id: number | null;
};
type Actor = { id: number; role: string; full_name: string };
type Asset = MachineLifecycleRow & { id: number; asset_number: string; deleted: number };

export class MachineLifecycleError extends Error {
  constructor(message: string, public status = 400, public code = 'LIFECYCLE_INVALID') { super(message); }
}
export function canManageMachineLifecycle(actor: { role: string }) {
  return actor.role === 'Manager' || actor.role === 'Admin';
}
export function migrateMachineLifecycle(db: DatabaseSync) {
  const columns = new Set((db.prepare('PRAGMA table_info(machine_assets)').all() as { name: string }[]).map(row => row.name));
  const additions: Record<string, string> = {
    lifecycle_status: "TEXT NOT NULL DEFAULT 'active' CHECK(lifecycle_status IN ('active','out_of_service','archived'))",
    retirement_reason: "TEXT NOT NULL DEFAULT ''", retirement_notes: "TEXT NOT NULL DEFAULT ''",
    retired_at: 'TEXT', retired_by_user_id: 'INTEGER', retired_by_name: "TEXT NOT NULL DEFAULT ''",
    replacement_asset_id: 'INTEGER REFERENCES machine_assets(id)', lifecycle_revision: 'INTEGER NOT NULL DEFAULT 0',
    lifecycle_updated_at: 'TEXT', lifecycle_updated_by_user_id: 'INTEGER', restored_at: 'TEXT', restored_by_user_id: 'INTEGER',
  };
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const [name, definition] of Object.entries(additions)) if (!columns.has(name)) db.exec(`ALTER TABLE machine_assets ADD COLUMN ${name} ${definition}`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_machine_lifecycle ON machine_assets(lifecycle_status,deleted)');
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
export function publicMachineLifecycle(row: MachineLifecycleRow, db: DatabaseSync) {
  const replacement = row.replacement_asset_id ? db.prepare('SELECT id,asset_number,asset_name,lifecycle_status FROM machine_assets WHERE id=?').get(row.replacement_asset_id) : null;
  return { lifecycleStatus: row.lifecycle_status ?? 'active', lifecycleRevision: Number(row.lifecycle_revision ?? 0),
    retirementReason: row.retirement_reason ?? '', retirementNotes: row.retirement_notes ?? '', retiredAt: row.retired_at,
    retiredByUserId: row.retired_by_user_id, retiredBy: row.retired_by_name ?? '', replacementMachineId: row.replacement_asset_id,
    replacementMachine: replacement ? { id: replacement.id, assetNumber: replacement.asset_number, assetName: replacement.asset_name, lifecycleStatus: replacement.lifecycle_status } : null,
    lifecycleUpdatedAt: row.lifecycle_updated_at, restoredAt: row.restored_at, restoredByUserId: row.restored_by_user_id };
}
function text(value: unknown, label: string, required = false) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.length > 1200 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new MachineLifecycleError(`${label} must be text of at most 1,200 characters.`);
  const clean = value.trim();
  if (required && !clean) throw new MachineLifecycleError(`${label} is required.`);
  return clean;
}
export function changeMachineLifecycle(db: DatabaseSync, id: number, actor: Actor, input: unknown,
  record: (event: { action: string; before: Asset; after: Asset; reason: string }) => void) {
  if (!canManageMachineLifecycle(actor)) throw new MachineLifecycleError('Manager or Admin access required.', 403, 'LIFECYCLE_FORBIDDEN');
  if (!Number.isSafeInteger(id) || id < 1) throw new MachineLifecycleError('Machine not found.', 404, 'MACHINE_NOT_FOUND');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new MachineLifecycleError('Choose a lifecycle action.');
  const body = input as Record<string, unknown>;
  const state = body.lifecycleStatus;
  if (typeof state !== 'string' || !['active', 'out_of_service', 'archived'].includes(state)) throw new MachineLifecycleError('Lifecycle status is invalid.');
  if (!Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 0) throw new MachineLifecycleError('Refresh the machine before changing its lifecycle.', 409, 'LIFECYCLE_STALE');
  const restoring = state === 'active';
  const reason = restoring ? '' : body.retirementReason;
  if (!restoring && (typeof reason !== 'string' || !['replaced', 'scrapped', 'retired', 'other'].includes(reason))) throw new MachineLifecycleError('Select a retirement reason.');
  const notes = text(restoring ? body.restoreReason : body.retirementNotes, restoring ? 'Restore reason' : 'Retirement notes', restoring || reason === 'other');
  const replacement = restoring ? undefined : body.replacementMachineId ?? null;
  if (replacement !== undefined && replacement !== null && (!Number.isSafeInteger(replacement) || Number(replacement) < 1 || reason !== 'replaced')) throw new MachineLifecycleError('Select a valid replacement machine for the Replaced reason.');
  db.exec('BEGIN IMMEDIATE');
  try {
    const before = db.prepare('SELECT * FROM machine_assets WHERE id=? AND deleted=0').get(id) as Asset | undefined;
    if (!before) throw new MachineLifecycleError('Machine not found.', 404, 'MACHINE_NOT_FOUND');
    if (before.lifecycle_revision !== body.expectedRevision) throw new MachineLifecycleError('This machine changed. Refresh it and review the action again.', 409, 'LIFECYCLE_STALE');
    if (restoring && before.lifecycle_status === 'active') throw new MachineLifecycleError('This machine is already active.', 409, 'LIFECYCLE_UNCHANGED');
    if (!restoring && before.lifecycle_status === state && before.retirement_reason === reason && before.retirement_notes === notes && before.replacement_asset_id === replacement) throw new MachineLifecycleError('This lifecycle change is already recorded.', 409, 'LIFECYCLE_UNCHANGED');
    if (replacement !== undefined && replacement !== null) {
      const visited = new Set<number>([id]);
      let next: number | null = Number(replacement);
      while (next !== null) {
        if (visited.has(next) || visited.size > 1000) throw new MachineLifecycleError('Replacement relationships cannot reference themselves or form a cycle.');
        visited.add(next);
        const target = db.prepare('SELECT id,replacement_asset_id,deleted FROM machine_assets WHERE id=?').get(next) as { replacement_asset_id: number | null; deleted: number } | undefined;
        if (!target || target.deleted) throw new MachineLifecycleError('Replacement machine not found.');
        next = target.replacement_asset_id === null ? null : Number(target.replacement_asset_id);
      }
    }
    const timestamp = new Date().toISOString();
    if (restoring) db.prepare(`UPDATE machine_assets SET lifecycle_status='active',lifecycle_revision=lifecycle_revision+1,lifecycle_updated_at=?,lifecycle_updated_by_user_id=?,restored_at=?,restored_by_user_id=?,updated_at=?,updated_by_user_id=? WHERE id=?`)
      .run(timestamp, actor.id, timestamp, actor.id, timestamp, actor.id, id);
    else db.prepare(`UPDATE machine_assets SET lifecycle_status=?,retirement_reason=?,retirement_notes=?,retired_at=?,retired_by_user_id=?,retired_by_name=?,replacement_asset_id=?,lifecycle_revision=lifecycle_revision+1,lifecycle_updated_at=?,lifecycle_updated_by_user_id=?,updated_at=?,updated_by_user_id=? WHERE id=?`)
      .run(String(state), String(reason), notes, timestamp, actor.id, actor.full_name, replacement as number | null, timestamp, actor.id, timestamp, actor.id, id);
    const after = db.prepare('SELECT * FROM machine_assets WHERE id=?').get(id) as Asset;
    record({ action: restoring ? 'machine_restored' : state === 'archived' ? 'machine_archived' : 'machine_out_of_service', before, after, reason: restoring ? notes : `${reason}: ${notes}` });
    if (!restoring && before.replacement_asset_id !== after.replacement_asset_id) record({ action: 'machine_replacement_changed', before, after, reason: `${reason}: ${notes}` });
    db.exec('COMMIT');
    return after;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
