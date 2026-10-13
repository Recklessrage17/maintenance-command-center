import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { Response } from 'express';
import { ZipArchive } from 'archiver';
import { safeShareableSegment } from './libraryFolderExport.js';
import { MachineLifecycleError } from './machineLifecycle.js';
import { pmWorkOrderAbsolutePath } from './pmWorkOrders.js';

type Row = Record<string, unknown>;
type Source = { category: string; recordId: number; name: string; root: string; relative: string; bytes?: number; expectedHash?: string };
type Entry = { path: string; bytes: number; sha256: string; category: string; recordId?: number; originalFilename?: string; modifiedAt?: string; snapshot: string };
const MAX_BYTES = 2 * 1024 ** 3;
const MAX_METADATA = 32 * 1024 ** 2;
const MAX_RECORDS = 25_000;
const MAX_FILES = 10_000;
const hash = (bytes: Buffer | string) => crypto.createHash('sha256').update(bytes).digest('hex');
const safeName = (name: unknown) => safeShareableSegment(name, 'Unnamed').slice(0, 120);

export function machineHistorySnapshot(db: DatabaseSync, assetId: number) {
  const recordsSnapshotAt=new Date().toISOString();
  let estimatedBytes = 0, recordCount = 0;
  const tables: Record<string, Row[]> = {};
  function collect(table: string, where: string, params: SQLInputValue[] = [assetId]) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!columns.length) throw new MachineLifecycleError('A required history source is unavailable.', 503, 'HISTORY_SOURCE_UNAVAILABLE');
    const size = columns.map(column => `COALESCE(length(CAST("${column.name.replace(/"/g,'""')}" AS BLOB)),0)`).join('+');
    const budget = db.prepare(`SELECT COUNT(*) AS count,COALESCE(SUM(${size}),0) AS bytes FROM ${table} WHERE ${where}`).get(...params)!;
    recordCount += Number(budget.count); estimatedBytes += Number(budget.bytes) * 6 + Number(budget.count) * 1024;
    if (recordCount > MAX_RECORDS || estimatedBytes > MAX_METADATA) throw new MachineLifecycleError('This machine exceeds the bounded history export size. Arrange a larger supervised export.', 413, 'HISTORY_EXPORT_LIMIT');
    tables[table] = db.prepare(`SELECT * FROM ${table} WHERE ${where} ORDER BY id`).all(...params) as Row[];
  }
  const notes = 'SELECT id FROM machine_asset_notes WHERE asset_id=?';
  const updates = `SELECT id FROM asset_note_updates WHERE asset_library='machine' AND note_id IN (${notes})`;
  db.exec('BEGIN');
  try {
    collect('machine_assets', 'id=? AND deleted=0');
    if (!tables.machine_assets.length) throw new MachineLifecycleError('Machine not found.', 404, 'MACHINE_NOT_FOUND');
    for (const table of ['machine_inspection_records', 'machine_component_images', 'machine_document_folders', 'machine_documents', 'machine_asset_notes']) collect(table, 'asset_id=?');
    collect('machine_asset_note_attachments', `note_id IN (${notes})`);
    for (const table of ['asset_note_updates', 'asset_note_lifecycle_events', 'asset_note_labor']) collect(table, `asset_library='machine' AND note_id IN (${notes})`);
    for (const table of ['asset_note_update_entries', 'asset_note_update_attachments']) collect(table, `update_id IN (${updates})`);
    for (const table of ['pm_tasks', 'pm_history', 'pm_asset_meters', 'pm_meter_history', 'pm_work_order_attachments']) collect(table, "asset_library='machine' AND asset_id=?");
    collect('pm_history_participants', "pm_history_id IN (SELECT id FROM pm_history WHERE asset_library='machine' AND asset_id=?)");
    collect('history_logs', `(section='machine_library' AND (asset_id=? OR (entity_type='machine_asset' AND entity_id=?))) OR
      (section='preventive_maintenance' AND ((entity_type='pm_task' AND entity_id IN (SELECT CAST(id AS TEXT) FROM pm_tasks WHERE asset_library='machine' AND asset_id=?)) OR
      (entity_type='pm_asset_meter' AND entity_id IN (SELECT CAST(id AS TEXT) FROM pm_asset_meters WHERE asset_library='machine' AND asset_id=?))))`,
      [String(assetId), String(assetId), assetId, assetId]);
    collect('audit_log', `(target_type='machine_asset' AND target_id=? AND action NOT IN ('measurement inspection pdf generated','measurement record combined pdf generated')) OR
      (target_type='machine_asset_note' AND target_id IN (SELECT CAST(id AS TEXT) FROM machine_asset_notes WHERE asset_id=?))`, [String(assetId), assetId]);
    const unsupportedSources: Array<{ source: string; reason: string; potentialRecordCount?: number }> = [];
    for (const table of ['machines', 'machine_library', 'machine_pms', 'preventive_maintenance', 'work_orders']) {
      if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)) continue;
      const count = Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()!.count);
      if (count) unsupportedSources.push({ source: table, potentialRecordCount: count, reason: 'Legacy records have no verified relationship to machine_assets.id. They may or may not belong to this machine.' });
    }
    db.exec('COMMIT');
    return { tables, unsupportedSources, recordsSnapshotAt };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

function portableRow(row: Row) {
  const result = { ...row };
  for (const key of ['stored_file_reference', 'pdf_stored_reference', 'stored_relative_path', 'import_source_ref']) {
    const value = result[key];
    if (typeof value === 'string' && (/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(value) || value.replace(/\\/g, '/').split('/').includes('..'))) result[key] = '[unsafe or absolute server reference omitted]';
  }
  delete result.ip_address; delete result.user_agent;
  return result;
}
function fileSources(tables: Record<string, Row[]>, roots: { uploads: string; documents: string; pmWorkOrders: string }): Source[] {
  const result: Source[] = [];
  function upload(category: string, row: Row, prefix: string, reference = row.stored_file_reference, name = row.original_filename, bytes = row.file_size) {
    const portable = typeof reference === 'string' ? reference.replace(/\\/g, '/') : '';
    result.push({ category, recordId: Number(row.id), name: String(name || `Record-${row.id}`), root: roots.uploads,
      relative: portable.startsWith(prefix) ? portable.slice('uploads/'.length) : '',
      ...(bytes === undefined ? {} : { bytes: Number(bytes) }), ...(row.sha256 ? { expectedHash: String(row.sha256) } : {}) });
  }
  for (const row of tables.machine_inspection_records) upload(`Inspections/${/^\d{4}-/.test(String(row.record_date)) ? String(row.record_date).slice(0, 4) : 'Undated'}`, row, 'uploads/machine-inspection-records/');
  for (const row of tables.machine_component_images) upload('Component Photographs', row, 'uploads/machine-component-images/');
  for (const row of tables.machine_asset_notes) upload('Asset Notes/Record PDFs', row, 'uploads/machine-asset-notes/', row.pdf_stored_reference, row.pdf_filename || `Note-${row.id}.pdf`, undefined);
  for (const row of tables.machine_asset_note_attachments) upload(`Asset Notes/Note-${row.note_id}/Attachments`, row, 'uploads/machine-asset-notes/');
  for (const row of tables.asset_note_update_attachments) upload(`Asset Notes/Update-${row.update_id}/Attachments`, row, 'uploads/machine-asset-notes/');
  const folders = new Map(tables.machine_document_folders.map(row => [row.id, row.name]));
  for (const row of tables.machine_documents) result.push({ category: `Documents/Folder-${Number(row.folder_id)}_${safeName(folders.get(row.folder_id))}`, recordId: Number(row.id),
    name: String(row.display_filename || row.original_filename), root: roots.documents, relative: String(row.stored_filename), bytes: Number(row.size_bytes) });
  for (const row of tables.pm_work_order_attachments) {
    let relative='';
    try{relative=path.relative(roots.pmWorkOrders,pmWorkOrderAbsolutePath(roots.pmWorkOrders,String(row.stored_relative_path)));}catch{/* Disclose an unsafe reference as a missing attachment. */}
    result.push({ category: 'Preventive Maintenance/Work Orders', recordId: Number(row.id), name: String(row.original_filename),
      root: roots.pmWorkOrders, relative, bytes: Number(row.size_bytes), expectedHash: String(row.sha256) });
  }
  return result;
}
async function checkedFile(source: Source) {
  const relative = source.relative.replace(/\\/g, '/');
  if (!relative || path.isAbsolute(relative) || /^[A-Za-z]:/.test(relative) || relative.split('/').some(part => !part || part === '.' || part === '..') || /[\x00-\x1f\x7f]/.test(relative)) throw Error('Invalid stored file reference');
  const root = await fs.promises.realpath(source.root);
  const candidate = path.resolve(source.root, relative);
  const within = path.relative(path.resolve(source.root), candidate);
  if (!within || within.startsWith('..') || path.isAbsolute(within)) throw Error('Invalid stored file reference');
  let current = path.resolve(source.root);
  for (const segment of relative.split('/')) { current = path.join(current, segment); if ((await fs.promises.lstat(current)).isSymbolicLink()) throw Error('Linked file references are not supported'); }
  const actual = await fs.promises.realpath(candidate);
  const realWithin = path.relative(root, actual);
  if (!realWithin || realWithin.startsWith('..') || path.isAbsolute(realWithin)) throw Error('Invalid stored file reference');
  const handle = await fs.promises.open(actual, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  const stat = await handle.stat();
  if (!stat.isFile() || (source.bytes !== undefined && (!Number.isSafeInteger(source.bytes) || source.bytes < 0 || stat.size !== source.bytes))) { await handle.close(); throw Error('Stored file size is inconsistent'); }
  return { handle, stat };
}

export function createMachineHistoryExporter() {
  let active = 0;
  return async function exportHistory(input: {
    db: DatabaseSync; assetId: number; appVersion: string; uploads: string; documents: string; pmWorkOrders: string;
    legacy: { checked: boolean; recordCount: number; unmappedFiles: number }; signal: AbortSignal;
    generated: (details: Record<string, unknown>) => void;
  }, res: Response) {
    if (active >= 2) throw new MachineLifecycleError('Two history exports are already running. Try again shortly.', 503, 'HISTORY_EXPORT_BUSY');
    active++;
    let stage = '';
    try {
      const snapshot = machineHistorySnapshot(input.db, input.assetId);
      const asset = snapshot.tables.machine_assets[0];
      const sources = fileSources(snapshot.tables, input);
      if (sources.length > MAX_FILES) throw new MachineLifecycleError('This machine exceeds the bounded export file count.', 413, 'HISTORY_EXPORT_LIMIT');
      stage = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mcc-machine-history-'));
      const entries: Entry[] = [];
      const missing: Array<{ category: string; recordId: number; filename: string; reason: string }> = [];
      let totalBytes = 0;
      const rootName = `Machine-${input.assetId}_${safeName(asset.asset_number).slice(0, 60)}`;
      for (const source of sources) {
        input.signal.throwIfAborted();
        let opened: Awaited<ReturnType<typeof checkedFile>> | undefined;
        const destination = path.join(stage, `${entries.length}-${crypto.randomUUID()}.bin`);
        try {
          opened = await checkedFile(source);
          if (totalBytes + opened.stat.size > MAX_BYTES) throw new MachineLifecycleError('This machine exceeds the 2 GiB history file limit.', 413, 'HISTORY_EXPORT_LIMIT');
          const free = await fs.promises.statfs(stage);
          if (free.bavail * free.bsize < (totalBytes + opened.stat.size) * 2 + MAX_METADATA + 256 * 1024 ** 2) throw new MachineLifecycleError('There is insufficient temporary storage for a safe history snapshot.', 507, 'HISTORY_EXPORT_STORAGE');
          const digest = crypto.createHash('sha256'); let copied = 0;
          const checksum = new Transform({ transform(chunk: Buffer, _encoding, callback) {
            copied += chunk.length;
            if (copied > opened!.stat.size) { callback(Error('Stored file changed during export')); return; }
            digest.update(chunk); callback(null, chunk);
          } });
          await pipeline(opened.handle.createReadStream({ highWaterMark: 1024 * 1024, autoClose: false }), checksum, fs.createWriteStream(destination, { flags: 'wx' }), { signal: input.signal });
          const after = await opened.handle.stat(); const sha256 = digest.digest('hex');
          if (copied !== opened.stat.size || after.size !== opened.stat.size || after.mtimeMs !== opened.stat.mtimeMs || (source.expectedHash && source.expectedHash !== sha256)) throw Error('Stored file changed or checksum is inconsistent');
          totalBytes += copied;
          entries.push({ path: `${rootName}/${source.category}/${source.recordId}_${safeName(source.name)}`, bytes: copied, sha256,
            category: source.category, recordId: source.recordId, originalFilename: source.name, modifiedAt: opened.stat.mtime.toISOString(), snapshot: destination });
        } catch (error) {
          await fs.promises.rm(destination, { force: true });
          if (input.signal.aborted || error instanceof MachineLifecycleError) throw error;
          missing.push({ category: source.category, recordId: source.recordId, filename: source.name,
            reason: 'Attachment is unavailable, unsafe, inconsistent, or changed during the snapshot.' });
        } finally { await opened?.handle.close(); }
      }
      const counts = Object.fromEntries(Object.entries(snapshot.tables).map(([table, records]) => [table, records.length]));
      let metadataBytes = 0;
      for (const [table, records] of Object.entries(snapshot.tables)) {
        const content = Buffer.from(`${JSON.stringify(records.map(portableRow), null, 2)}\n`);
        metadataBytes += content.length;
        if(metadataBytes>MAX_METADATA)throw new MachineLifecycleError('This machine exceeds the history metadata limit.',413,'HISTORY_EXPORT_LIMIT');
        const destination = path.join(stage, `${table}.json`);
        await fs.promises.writeFile(destination, content, { flag: 'wx' });
        entries.push({ path: `${rootName}/Records/${table}.json`, bytes: content.length, sha256: hash(content), category: 'Record metadata', snapshot: destination });
      }
      const serverComplete = missing.length === 0 && snapshot.unsupportedSources.length === 0;
      const coverage = { completeServerSources: serverComplete, completeAvailableHistory: false,
        browserInspectionRecords: { clientReported: true, ...input.legacy,
          limitation: 'Browser-only files are not in this ZIP. Other browsers/devices and unmapped IndexedDB files cannot be attributed by the server.' },
        unsupportedSources: snapshot.unsupportedSources,
        excludedRelationships: ['Free-text machine mentions in requisitions/global work orders are not machine-ID relationships.',
          'Legacy inspection-print audit actions use asset numbers/local labels rather than numeric machine IDs and cannot be safely attributed.',
          'Global PM workbooks and bulk/import events are not per-machine originals. Committed linked PM records are included; unconfirmed workbook data needs separate review.',
          'Unattributed legacy and browser records cannot be inferred from filenames or prose.'] };
      const generatedAt = new Date().toISOString();
      const summary = `MCC Machine History Export\nMachine: ${asset.asset_number} (ID ${asset.id})\nGenerated: ${generatedAt}\nVersion: ${input.appVersion}\n\n` +
        `Supported server coverage: ${serverComplete ? 'All available supported server records included.' : 'INCOMPLETE. Review missing attachments and unsupported sources in the manifest.'}\n` +
        `Missing attachments: ${missing.length}\nBrowser-only inspections reported: ${input.legacy.checked ? input.legacy.recordCount : 'not checked'}\nUnmapped browser files reported: ${input.legacy.unmappedFiles}\n` +
        'This ZIP does not claim universal completeness. Browser-only records, other devices, and unverified free-text/legacy relationships require separate review.\n' +
        'Original IDs, timestamps, record relationships, folder hierarchy and lifecycle details are in Records/*.json. SHA-256 entries cover every payload file except the manifest itself.\n';
      const summaryPath = path.join(stage, 'SUMMARY.txt'); await fs.promises.writeFile(summaryPath, summary);
      entries.push({ path: `${rootName}/SUMMARY.txt`, bytes: Buffer.byteLength(summary), sha256: hash(summary), category: 'Summary', snapshot: summaryPath });
      const used = new Set<string>();
      for (const entry of entries) {
        if (path.posix.normalize(entry.path) !== entry.path || entry.path.split('/').some(segment => !segment || segment === '..' || segment === '.')) throw new MachineLifecycleError('Stored history identifiers are unsafe.', 409, 'HISTORY_EXPORT_UNSAFE');
        const key = entry.path.normalize('NFC').toLowerCase();
        if (used.has(key)) throw new MachineLifecycleError('History contains duplicate export identifiers.', 409, 'HISTORY_EXPORT_COLLISION');
        used.add(key);
      }
      const manifest = { schemaVersion: 1, exportId: crypto.randomUUID(), appVersion: input.appVersion, generatedAt, recordsSnapshotAt:snapshot.recordsSnapshotAt,
        machine: portableRow(asset), categories: counts, missingAttachments: missing, coverage,
        limits: { fileBytes: MAX_BYTES, metadataBytes: MAX_METADATA, fileCount: MAX_FILES, recordCount: MAX_RECORDS },
        entries: entries.map(({ snapshot: _snapshot, ...entry }) => entry) };
      const manifestContent = `${JSON.stringify(manifest, null, 2)}\n`;
      const zipPath = path.join(stage, 'history.zip');
      const archive = new ZipArchive({ store: true });
      archive.on('warning', error => archive.destroy(error));
      for (const entry of entries) archive.file(entry.snapshot, { name: entry.path, date: new Date(entry.modifiedAt??generatedAt) });
      archive.append(manifestContent, { name: `${rootName}/MANIFEST.json` });
      await Promise.all([pipeline(archive, fs.createWriteStream(zipPath, { flags: 'wx' }), { signal: input.signal }), archive.finalize()]);
      const zipBytes = (await fs.promises.stat(zipPath)).size;
      input.signal.throwIfAborted();
      input.generated({ exportId: manifest.exportId, manifestSha256: hash(manifestContent), generatedAt, coverage, categoryCounts: counts, fileCount: sources.length - missing.length, missingAttachments: missing.length });
      res.setHeader('Content-Type', 'application/zip');
      const filename = `MCC_Machine_${input.assetId}_${safeName(asset.asset_number).replace(/[^A-Za-z0-9_.-]/g, '_')}_History.zip`;
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', String(zipBytes)); res.setHeader('X-MCC-Export-Bytes', String(zipBytes));
      res.setHeader('X-MCC-History-Missing', String(missing.length)); res.setHeader('X-MCC-History-Server-Complete', String(serverComplete));
      res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
      await pipeline(fs.createReadStream(zipPath, { highWaterMark: 1024 * 1024 }), res, { signal: input.signal });
    } finally {
      try { if (stage) await fs.promises.rm(stage, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
      finally { active--; }
    }
  };
}
