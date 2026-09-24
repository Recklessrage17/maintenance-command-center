import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ZipArchive, type Archiver } from 'archiver';
import type { Response } from 'express';

export type WorkOrderRecordLibrary = 'machine' | 'equipment';

export type WorkOrderRecordAttachmentSource = {
  id: number;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sourcePath: string;
  downloadUrl: string;
  sourceType?: 'supporting' | 'work_order_photo';
  sha256?: string;
  sourceError?: string;
};

export type WorkOrderRecordUpdateSource = {
  id: number;
  body: string;
  createdByUserId: number | null;
  createdBy: string;
  createdAt: string;
  attachments: WorkOrderRecordAttachmentSource[];
};

export type WorkOrderRecordSource = {
  library: WorkOrderRecordLibrary;
  asset: {
    id: number;
    assetNumber: string;
    assetName: string;
    brand: string;
    model: string;
    serialNumber: string;
    location: string;
    category: string;
  };
  note: {
    id: number;
    title: string;
    noteDate: string;
    body: string;
    warning: boolean;
    workOrder: string;
    status: string;
    hold?: boolean;
    statusLabel?: string;
    createdByUserId: number | null;
    createdBy: string;
    createdAt: string;
    updatedAt: string;
    resolvedAt: string | null;
    resolvedByUserId: number | null;
    resolvedBy: string;
    resolutionSummary: string;
    reopenedAt: string | null;
    reopenedByUserId: number | null;
    reopenedBy: string;
    labor: Array<{ userId: number | null; displayName: string; hours: number; isPrimary: boolean; order: number }>;
    totalLaborHours: number;
  };
  generatedPdf: WorkOrderRecordAttachmentSource | null;
  attachments: WorkOrderRecordAttachmentSource[];
  updates: WorkOrderRecordUpdateSource[];
  lifecycle: Array<Record<string, unknown>>;
};

export type WorkOrderArchiveEntry = {
  key: string;
  path: string;
  sha256: string;
  sizeBytes: number;
  mimeType: string;
  kind: 'record' | 'record-pdf' | 'attachment' | 'update-attachment';
  library: WorkOrderRecordLibrary;
  assetId: number;
  recordId: number;
  attachmentId?: number;
  updateId?: number;
  downloadUrl?: string;
  content?: string;
  sourcePath?: string;
};

export type WorkOrderArchivePlan = {
  schemaVersion: 1;
  year: number;
  directoryName: string;
  generatedAt: string;
  libraries: WorkOrderRecordLibrary[];
  conflictPolicy: string;
  totals: {
    assetCount: number;
    recordCount: number;
    attachmentCount: number;
    recordPdfCount: number;
    fileCount: number;
    totalBytes: number;
  };
  entries: WorkOrderArchiveEntry[];
  failures: Array<{ key: string; path: string; message: string }>;
};

export type WorkOrderArchiveManifest = Omit<WorkOrderArchivePlan, 'entries'> & {
  entries: Array<Omit<WorkOrderArchiveEntry, 'content' | 'sourcePath' | 'downloadUrl'>>;
};

const archiveConflictPolicy = 'Match stable entry keys first. Add new entries, replace changed entries when SHA-256 differs, skip byte-identical entries, and retain prior entries that are absent from MCC.';

function safeSegment(value: unknown, fallback: string, maxLength = 120) {
  const normalized = String(value ?? '').normalize('NFKC').replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, '-').replace(/\s+/g, ' ').replace(/[. ]+$/g, '').trim();
  const safe = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(normalized) ? `${normalized}-record` : normalized;
  return (safe || fallback).slice(0, maxLength);
}

function bufferSha256(value: Buffer | string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function fileSha256(filePath: string) {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (!count) break;
      hash.update(buffer.subarray(0, count));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

function recordRoot(record: WorkOrderRecordSource) {
  const library = record.library === 'machine' ? 'Machine Library' : 'Equipment Library';
  const assetIdentity = safeSegment(record.asset.assetNumber || record.asset.assetName, 'Asset');
  const recordIdentity = safeSegment(record.note.workOrder || record.note.title, 'Work Order');
  return `${library}/${assetIdentity} [asset-${record.asset.id}]/${record.note.noteDate} ${recordIdentity} [record-${record.note.id}]`;
}

function binaryEntry(input: {
  record: WorkOrderRecordSource;
  source: WorkOrderRecordAttachmentSource;
  key: string;
  relativePath: string;
  kind: WorkOrderArchiveEntry['kind'];
  updateId?: number;
}, failures: WorkOrderArchivePlan['failures']) {
  const { record, source } = input;
  try {
    if (source.sourceError) throw new Error(source.sourceError);
    const stat = fs.lstatSync(source.sourcePath);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('The stored attachment is not a regular file.');
    if (stat.size !== Number(source.sizeBytes)) throw new Error(`Stored size ${stat.size} does not match recorded size ${source.sizeBytes}.`);
    return {
      key: input.key,
      path: input.relativePath,
      sha256: fileSha256(source.sourcePath),
      sizeBytes: stat.size,
      mimeType: source.mimeType || 'application/octet-stream',
      kind: input.kind,
      library: record.library,
      assetId: record.asset.id,
      recordId: record.note.id,
      attachmentId: source.id,
      ...(input.updateId === undefined ? {} : { updateId: input.updateId }),
      downloadUrl: source.downloadUrl,
      sourcePath: source.sourcePath,
    } satisfies WorkOrderArchiveEntry;
  } catch (error) {
    failures.push({ key: input.key, path: input.relativePath, message: error instanceof Error ? error.message : 'Stored file is unavailable.' });
    return null;
  }
}

function publicAttachment(entry: WorkOrderArchiveEntry | null) {
  if (!entry) return null;
  return { id: entry.attachmentId, filename: path.posix.basename(entry.path).replace(/^\d+_/, ''), mimeType: entry.mimeType, sizeBytes: entry.sizeBytes, sha256: entry.sha256, archiveEntryKey: entry.key };
}

export function buildWorkOrderArchivePlan(input: { year: number; generatedAt: string; records: WorkOrderRecordSource[] }): WorkOrderArchivePlan {
  if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 9999) throw new Error('Work-order export year is invalid.');
  const entries: WorkOrderArchiveEntry[] = [];
  const failures: WorkOrderArchivePlan['failures'] = [];
  const records = input.records.filter(record=>record.note.noteDate.startsWith(`${input.year}-`)).sort((left, right)=>`${left.library}:${left.asset.id}:${left.note.id}`.localeCompare(`${right.library}:${right.asset.id}:${right.note.id}`));
  for (const record of records) {
    const root = recordRoot(record);
    const prefix = `${record.library}:record:${record.note.id}`;
    const recordPdf = record.generatedPdf ? binaryEntry({ record, source: record.generatedPdf, key: `${prefix}:pdf`, relativePath: `${root}/${safeSegment(record.generatedPdf.filename, 'Asset Note.pdf', 180)}`, kind: 'record-pdf' }, failures) : null;
    if (recordPdf) entries.push(recordPdf);
    const originalAttachments = record.attachments.map(source=>binaryEntry({ record, source, key: `${prefix}:attachment:${source.id}`, relativePath: `${root}/Attachments/${source.id}_${safeSegment(source.filename, 'attachment', 170)}`, kind: 'attachment' }, failures));
    entries.push(...originalAttachments.filter((entry): entry is NonNullable<typeof entry>=>entry!==null));
    const updateAttachments = record.updates.flatMap(update=>update.attachments.map(source=>binaryEntry({ record, source, key: `${prefix}:update-attachment:${source.id}`, relativePath: `${root}/Updates/Update_${update.id}/${source.id}_${safeSegment(source.filename, 'attachment', 165)}`, kind: 'update-attachment', updateId: update.id }, failures)));
    entries.push(...updateAttachments.filter((entry): entry is NonNullable<typeof entry>=>entry!==null));
    const jsonRecord = {
      schemaVersion: 1,
      stableRecordId: `${record.library}:record:${record.note.id}`,
      assetLibrary: record.library,
      asset: record.asset,
      note: record.note,
      generatedRecordPdf: publicAttachment(recordPdf),
      attachments: originalAttachments.map(publicAttachment).filter(Boolean),
      updates: record.updates.map(update=>({ ...update, attachments: updateAttachments.filter(entry=>entry?.updateId===update.id).map(publicAttachment).filter(Boolean) })),
      lifecycle: record.lifecycle,
    };
    const content = `${JSON.stringify(jsonRecord, null, 2)}\n`;
    const bytes = Buffer.byteLength(content);
    entries.push({ key: `${prefix}:json`, path: `${root}/work-order-record.json`, sha256: bufferSha256(content), sizeBytes: bytes, mimeType: 'application/json', kind: 'record', library: record.library, assetId: record.asset.id, recordId: record.note.id, content });
  }
  entries.sort((left, right)=>left.path.localeCompare(right.path));
  const libraries = [...new Set(records.map(record=>record.library))].sort() as WorkOrderRecordLibrary[];
  const assetCount = new Set(records.map(record=>`${record.library}:${record.asset.id}`)).size;
  const attachmentCount = entries.filter(entry=>entry.kind==='attachment'||entry.kind==='update-attachment').length;
  const recordPdfCount = entries.filter(entry=>entry.kind==='record-pdf').length;
  return {
    schemaVersion: 1,
    year: input.year,
    directoryName: `WO_${input.year}_records`,
    generatedAt: input.generatedAt,
    libraries,
    conflictPolicy: archiveConflictPolicy,
    totals: { assetCount, recordCount: records.length, attachmentCount, recordPdfCount, fileCount: entries.length, totalBytes: entries.reduce((sum, entry)=>sum+entry.sizeBytes, 0) },
    entries,
    failures,
  };
}

export function workOrderArchiveManifest(plan: WorkOrderArchivePlan): WorkOrderArchiveManifest {
  return {
    ...plan,
    entries: plan.entries.map(({ content: _content, sourcePath: _sourcePath, downloadUrl: _downloadUrl, ...entry })=>entry),
  };
}

export function workOrderArchiveInfo(plan: WorkOrderArchivePlan, summary?: { added: number; updated: number; skipped: number; failed: number; mode: 'directory' | 'download' | 'master' }) {
  const result = summary ?? { added: plan.entries.length, updated: 0, skipped: 0, failed: plan.failures.length, mode: 'download' as const };
  return [
    'Maintenance Command Center - Work Order Records Export',
    '',
    `Year: ${plan.year}`,
    `Export timestamp: ${plan.generatedAt}`,
    `Export mode: ${result.mode}`,
    `Libraries: ${plan.libraries.length ? plan.libraries.join(', ') : 'none authorized / no records'}`,
    `Assets: ${plan.totals.assetCount}`,
    `Records: ${plan.totals.recordCount}`,
    `Attachments: ${plan.totals.attachmentCount}`,
    `Generated record PDFs: ${plan.totals.recordPdfCount}`,
    `Files: ${plan.totals.fileCount}`,
    `Total uncompressed bytes: ${plan.totals.totalBytes}`,
    `New: ${result.added}`,
    `Updated: ${result.updated}`,
    `Unchanged / skipped: ${result.skipped}`,
    `Failed: ${result.failed}`,
    '',
    `Conflict policy: ${plan.conflictPolicy}`,
    'Integrity: WO_EXPORT_MANIFEST.json records a SHA-256 digest and byte size for every exported record and file.',
    result.mode === 'download' ? 'Incremental limitation: this is a new downloadable package. Extract or merge it at the destination; MCC did not update an existing directory in place.' : 'Incremental behavior: prior manifest entries absent from the current MCC plan are retained and are not automatically deleted.',
    ...(plan.failures.length ? ['', 'Source failures:', ...plan.failures.map(item=>`- ${item.key}: ${item.message}`)] : []),
    '',
  ].join('\n');
}

export function writeWorkOrderArchiveDirectory(parentPath: string, plan: WorkOrderArchivePlan) {
  const root = path.join(parentPath, plan.directoryName);
  fs.mkdirSync(root, { recursive: false });
  for (const entry of plan.entries) {
    const destination = path.join(root, ...entry.path.split('/'));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (entry.sourcePath) fs.copyFileSync(entry.sourcePath, destination, fs.constants.COPYFILE_EXCL);
    else fs.writeFileSync(destination, entry.content ?? '', { flag: 'wx' });
  }
  const manifestText = `${JSON.stringify(workOrderArchiveManifest(plan), null, 2)}\n`;
  fs.writeFileSync(path.join(root, 'WO_EXPORT_MANIFEST.json'), manifestText, { flag: 'wx' });
  fs.writeFileSync(path.join(root, 'MCC_WORK_ORDER_EXPORT_INFO.txt'), `${workOrderArchiveInfo(plan, { added: plan.entries.length, updated: 0, skipped: 0, failed: plan.failures.length, mode: 'master' })}\n`, { flag: 'wx' });
  return { root, manifestSha256: bufferSha256(manifestText), ...plan.totals, failedCount: plan.failures.length };
}

export function streamWorkOrderArchive(res: Response, plan: WorkOrderArchivePlan) {
  const archive = new ZipArchive({ zlib: { level: 6 } });
  const prefix = plan.directoryName;
  archive.on('warning', (error: Error & { code?: string })=>{ if (error.code !== 'ENOENT') res.destroy(error); });
  archive.on('error', (error: Error)=>res.destroy(error));
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${prefix}.zip"`);
  res.setHeader('Cache-Control', 'private, no-store');
  archive.pipe(res);
  for (const entry of plan.entries) {
    const archivePath = `${prefix}/${entry.path}`;
    if (entry.sourcePath) archive.file(entry.sourcePath, { name: archivePath });
    else archive.append(entry.content ?? '', { name: archivePath });
  }
  archive.append(`${JSON.stringify(workOrderArchiveManifest(plan), null, 2)}\n`, { name: `${prefix}/WO_EXPORT_MANIFEST.json` });
  archive.append(`${workOrderArchiveInfo(plan)}\n`, { name: `${prefix}/MCC_WORK_ORDER_EXPORT_INFO.txt` });
  void archive.finalize();
  return archive as Archiver;
}
