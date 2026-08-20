import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInflateRaw, crc32 } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { ZipArchive, type ArchiverError } from 'archiver';
import ExcelJS from 'exceljs';

export const PORTABLE_PACKAGE_VERSION = 1;
export const PORTABLE_SCHEMA_VERSION = 1;
export const PORTABLE_ZIP_MIME = 'application/zip';
export const DEFAULT_MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
export const DEFAULT_MAX_EXPANDED_BYTES = 4 * 1024 * 1024 * 1024;
export const DEFAULT_MAX_ARCHIVE_ENTRIES = 50_000;
export const DEFAULT_RECOVERY_QUOTA_BYTES = 8 * 1024 * 1024 * 1024;
export const DEFAULT_RECOVERY_MAX_PACKAGES = 3;
const MAX_CENTRAL_DIRECTORY_BYTES = 32 * 1024 * 1024;
const RECOVERY_IMPORT_HEADROOM_BYTES = 64 * 1024 * 1024;
const EXCEL_CELL_LIMIT = 32_000;
const PORTABLE_ROOT_PATTERN = /^MCC_Master_Backup_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(?:_\d+)?$/;
const PORTABLE_ARCHIVE_PATTERN = /^MCC_Master_Backup_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(?:_\d+)?\.zip$/;

export type PortablePackageManifest = {
  packageVersion: number;
  schemaVersion: number;
  appName: string;
  appVersion: string;
  backupCategory: string;
  backupType: string;
  createdAt: string;
  databaseFile: string;
  databaseSizeBytes: number;
  checksumSha256: string;
  fileChecksums: Record<string, string>;
  recordCounts: Record<string, number>;
  includedPaths: string[];
  includedFolders: string[];
  portableArchive: { filename: string; packageRoot: string };
  excelExports: string[];
  payloadSizeBytes?: number;
  [key: string]: unknown;
};

export type PortablePackageValidation = {
  ok: true;
  packagePath: string;
  manifest: PortablePackageManifest;
  databasePath: string;
  checkedFileCount: number;
  expandedSizeBytes: number;
};

export type ImportedPortablePackage = {
  id: string;
  name: string;
  createdAt: string;
  appVersion: string;
  backupType: string;
  packagePath: string;
  archivePath: string;
  archiveFilename: string;
  archiveSizeBytes: number;
  archiveSha256: string;
  importedAt: string;
  checkedFileCount: number;
  safeToDisconnect: true;
  alreadyImported?: boolean;
};

type CentralDirectoryEntry = {
  name: string;
  flags: number;
  compressionMethod: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  externalAttributes: number;
  localHeaderOffset: number;
  directory: boolean;
};

type ArchiveInspection = {
  entries: CentralDirectoryEntry[];
  rootName: string;
  compressedSizeBytes: number;
  expandedSizeBytes: number;
  centralDirectoryOffset: number;
};

export type RecoveryStoragePolicy = {
  quotaBytes: number;
  maxPackages: number;
};

export type RecoveryStorageStatus = RecoveryStoragePolicy & {
  usedBytes: number;
  remainingBytes: number;
  packageCount: number;
  atCapacity: boolean;
};

type WorkbookSheet = {
  table: string;
  name: string;
  query?: string;
  derivedColumns?: Array<{ name: string; value: (row: Record<string, unknown>) => unknown }>;
  hyperlinkColumns?: string[];
};

export function normalizeArchiveLimits(input: { maxArchiveBytes?: number; maxExpandedBytes?: number; maxEntries?: number } = {}) {
  return {
    maxArchiveBytes: positiveLimit(input.maxArchiveBytes, DEFAULT_MAX_ARCHIVE_BYTES),
    maxExpandedBytes: positiveLimit(input.maxExpandedBytes, DEFAULT_MAX_EXPANDED_BYTES),
    maxEntries: positiveLimit(input.maxEntries, DEFAULT_MAX_ARCHIVE_ENTRIES),
  };
}

function positiveLimit(value: number | undefined, fallback: number) {
  return Number.isFinite(value) && Number(value) > 0 ? Math.floor(Number(value)) : fallback;
}

export function portablePackageRoot(createdAt: string) {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) throw new Error('Backup creation timestamp is invalid.');
  const iso = date.toISOString();
  return `MCC_Master_Backup_${iso.slice(0, 10)}_${iso.slice(11, 19).replace(/:/g, '-')}`;
}

export function portableArchiveFilename(createdAt: string) {
  return `${portablePackageRoot(createdAt)}.zip`;
}

export function databasePathInPackage(packagePath: string, manifest?: Partial<PortablePackageManifest> | null) {
  const relative = String(manifest?.databaseFile ?? '').replace(/\\/g, '/');
  const candidates = relative ? [relative, 'database/mcc.sqlite', 'mcc.sqlite'] : ['database/mcc.sqlite', 'mcc.sqlite'];
  for (const candidate of candidates) {
    if (!safeRelativePath(candidate)) continue;
    const resolved = resolveInside(packagePath, candidate);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return resolved;
  }
  return resolveInside(packagePath, candidates[0]);
}

export async function sha256File(filePath: string) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest('hex');
}

export function sha256FileSync(filePath: string) {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const read = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (!read) break;
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

export function packageFileChecksums(packagePath: string) {
  const checksums: Record<string, string> = {};
  for (const file of walkPackageFiles(packagePath)) {
    if (file.relativePath === 'manifest.json') continue;
    checksums[file.relativePath] = sha256FileSync(file.absolutePath);
  }
  return checksums;
}

export function packagePayloadSize(packagePath: string) {
  return walkPackageFiles(packagePath)
    .filter(file => file.relativePath !== 'manifest.json')
    .reduce((total, file) => total + file.sizeBytes, 0);
}

function walkPackageFiles(packagePath: string) {
  const root = path.resolve(packagePath);
  const files: Array<{ relativePath: string; absolutePath: string; sizeBytes: number }> = [];
  function visit(current: string) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const absolutePath = path.join(current, entry.name);
      const relativePath = path.relative(root, absolutePath).split(path.sep).join('/');
      const stat = fs.lstatSync(absolutePath);
      if (stat.isSymbolicLink()) throw new Error(`Portable package contains an unsupported link: ${relativePath}`);
      if (entry.isDirectory()) visit(absolutePath);
      else if (entry.isFile()) files.push({ relativePath, absolutePath, sizeBytes: stat.size });
      else throw new Error(`Portable package contains an unsupported filesystem entry: ${relativePath}`);
    }
  }
  visit(root);
  return files;
}

export async function writeExcelInsuranceExports(snapshotDatabasePath: string, excelRoot: string) {
  fs.mkdirSync(excelRoot, { recursive: true });
  const database = new DatabaseSync(snapshotDatabasePath, { readOnly: true });
  try {
    const existing = new Set(
      (database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>).map(row => row.name),
    );
    const historyTables = [...existing].filter(name => /history|audit/i.test(name)).sort();
    const exports: Array<{ filename: string; sheets: WorkbookSheet[] }> = [
      { filename: 'MCC_Inventory.xlsx', sheets: [
        { table: 'inventory_parts', name: 'Inventory Parts', hyperlinkColumns: ['part_info_url'] },
        { table: 'inventory_locations', name: 'Inventory Locations' },
      ] },
      { filename: 'MCC_Vendors.xlsx', sheets: [
        { table: 'inventory_vendors', name: 'Vendors' },
        { table: 'vendor_contacts', name: 'Vendor Contacts' },
      ] },
      { filename: 'MCC_Machine_List.xlsx', sheets: [
        { table: 'machine_assets', name: 'Machine Assets' },
        { table: 'machines', name: 'Machines' },
        { table: 'machine_library', name: 'Machine Library' },
        { table: 'pm_tasks', name: 'Machine PM', query: "SELECT * FROM pm_tasks WHERE asset_library='machine' ORDER BY rowid" },
        { table: 'machine_pms', name: 'Machine PM Legacy' },
        {
          table: 'machine_document_folders',
          name: 'Document Folders',
          query: 'SELECT f.*,a.asset_number AS asset_number FROM machine_document_folders f LEFT JOIN machine_assets a ON a.id=f.asset_id ORDER BY f.rowid',
          derivedColumns: [{ name: 'asset_number', value: row => row.asset_number }],
        },
        {
          table: 'machine_documents',
          name: 'Documents',
          query: 'SELECT d.*,a.asset_number AS asset_number,f.name AS folder_name FROM machine_documents d LEFT JOIN machine_assets a ON a.id=d.asset_id LEFT JOIN machine_document_folders f ON f.id=d.folder_id ORDER BY d.rowid',
          derivedColumns: [
            { name: 'asset_number', value: row => row.asset_number },
            { name: 'folder_name', value: row => row.folder_name },
            { name: 'portable_relative_path', value: machineDocumentPortablePath },
          ],
        },
        {
          table: 'machine_asset_notes',
          name: 'Asset Notes',
          query: 'SELECT n.*,a.asset_number AS asset_number FROM machine_asset_notes n LEFT JOIN machine_assets a ON a.id=n.asset_id ORDER BY n.rowid',
          derivedColumns: [
            { name: 'asset_number', value: row => row.asset_number },
            { name: 'portable_pdf_relative_path', value: row => portableStoredReference(row.pdf_stored_reference) },
          ],
        },
        {
          table: 'machine_asset_note_attachments',
          name: 'Note Attachments',
          query: 'SELECT x.*,n.asset_id AS asset_id,a.asset_number AS asset_number FROM machine_asset_note_attachments x LEFT JOIN machine_asset_notes n ON n.id=x.note_id LEFT JOIN machine_assets a ON a.id=n.asset_id ORDER BY x.rowid',
          derivedColumns: [
            { name: 'asset_id', value: row => row.asset_id },
            { name: 'asset_number', value: row => row.asset_number },
            { name: 'portable_relative_path', value: row => portableStoredReference(row.stored_file_reference) },
          ],
        },
        {
          table: 'asset_note_updates',
          name: 'Issue Updates',
          query: "SELECT u.*,n.asset_id AS asset_id,n.title AS note_title,n.work_order_reference AS work_order_reference,a.asset_number AS asset_number FROM asset_note_updates u LEFT JOIN machine_asset_notes n ON n.id=u.note_id LEFT JOIN machine_assets a ON a.id=n.asset_id WHERE u.asset_library='machine' ORDER BY u.rowid",
          derivedColumns: [
            { name: 'asset_id', value: row => row.asset_id },
            { name: 'asset_number', value: row => row.asset_number },
            { name: 'note_title', value: row => row.note_title },
            { name: 'work_order_reference', value: row => row.work_order_reference },
          ],
        },
        {
          table: 'asset_note_update_attachments',
          name: 'Update Attachments',
          query: "SELECT x.*,u.note_id AS note_id,n.asset_id AS asset_id,n.title AS note_title,a.asset_number AS asset_number FROM asset_note_update_attachments x LEFT JOIN asset_note_updates u ON u.id=x.update_id LEFT JOIN machine_asset_notes n ON n.id=u.note_id LEFT JOIN machine_assets a ON a.id=n.asset_id WHERE u.asset_library='machine' ORDER BY x.rowid",
          derivedColumns: [
            { name: 'note_id', value: row => row.note_id },
            { name: 'asset_id', value: row => row.asset_id },
            { name: 'asset_number', value: row => row.asset_number },
            { name: 'note_title', value: row => row.note_title },
            { name: 'portable_relative_path', value: row => portableStoredReference(row.stored_file_reference) },
          ],
        },
        {
          table: 'asset_note_lifecycle_events',
          name: 'Issue Lifecycle',
          query: "SELECT e.*,n.asset_id AS asset_id,n.title AS note_title,n.work_order_reference AS work_order_reference,a.asset_number AS asset_number FROM asset_note_lifecycle_events e LEFT JOIN machine_asset_notes n ON n.id=e.note_id LEFT JOIN machine_assets a ON a.id=n.asset_id WHERE e.asset_library='machine' ORDER BY e.rowid",
          derivedColumns: [
            { name: 'asset_id', value: row => row.asset_id },
            { name: 'asset_number', value: row => row.asset_number },
            { name: 'note_title', value: row => row.note_title },
            { name: 'work_order_reference', value: row => row.work_order_reference },
          ],
        },
        {
          table: 'machine_inspection_records',
          name: 'Inspection Records',
          query: 'SELECT r.*,a.asset_number AS asset_number FROM machine_inspection_records r LEFT JOIN machine_assets a ON a.id=r.asset_id ORDER BY r.rowid',
          derivedColumns: [
            { name: 'asset_number', value: row => row.asset_number },
            { name: 'portable_relative_path', value: row => portableStoredReference(row.stored_file_reference) },
          ],
        },
        {
          table: 'machine_component_images',
          name: 'Component Images',
          query: 'SELECT i.*,a.asset_number AS asset_number FROM machine_component_images i LEFT JOIN machine_assets a ON a.id=i.asset_id ORDER BY i.rowid',
          derivedColumns: [
            { name: 'asset_number', value: row => row.asset_number },
            { name: 'portable_relative_path', value: row => portableStoredReference(row.stored_file_reference) },
          ],
        },
      ] },
      { filename: 'MCC_Equipment_List.xlsx', sheets: [
        { table: 'equipment_assets', name: 'Equipment Assets' },
        { table: 'equipment_library', name: 'Equipment Library' },
        { table: 'equipment', name: 'Equipment' },
        { table: 'equipment_pms', name: 'Equipment PM' },
        {
          table: 'equipment_asset_notes',
          name: 'Equipment Asset Notes',
          query: 'SELECT n.*,a.asset_number AS asset_number,a.equipment_name AS equipment_name,a.category AS category FROM equipment_asset_notes n LEFT JOIN equipment_assets a ON a.id=n.asset_id ORDER BY n.rowid',
          derivedColumns: [
            { name: 'asset_number', value: row => row.asset_number },
            { name: 'equipment_name', value: row => row.equipment_name },
            { name: 'category', value: row => row.category },
            { name: 'portable_pdf_relative_path', value: row => portableStoredReference(row.pdf_stored_reference) },
          ],
        },
        {
          table: 'equipment_asset_note_attachments',
          name: 'Equipment Note Attachments',
          query: 'SELECT x.*,n.asset_id AS asset_id,n.title AS note_title,a.asset_number AS asset_number,a.equipment_name AS equipment_name,a.category AS category FROM equipment_asset_note_attachments x LEFT JOIN equipment_asset_notes n ON n.id=x.note_id LEFT JOIN equipment_assets a ON a.id=n.asset_id ORDER BY x.rowid',
          derivedColumns: [
            { name: 'asset_id', value: row => row.asset_id },
            { name: 'note_title', value: row => row.note_title },
            { name: 'asset_number', value: row => row.asset_number },
            { name: 'equipment_name', value: row => row.equipment_name },
            { name: 'category', value: row => row.category },
            { name: 'portable_relative_path', value: row => portableStoredReference(row.stored_file_reference) },
          ],
        },
        {
          table: 'asset_note_updates',
          name: 'Equipment Issue Updates',
          query: "SELECT u.*,n.asset_id AS asset_id,n.title AS note_title,n.work_order_reference AS work_order_reference,a.asset_number AS asset_number,a.equipment_name AS equipment_name,a.category AS category FROM asset_note_updates u LEFT JOIN equipment_asset_notes n ON n.id=u.note_id LEFT JOIN equipment_assets a ON a.id=n.asset_id WHERE u.asset_library='equipment' ORDER BY u.rowid",
          derivedColumns: [
            { name: 'asset_id', value: row => row.asset_id },
            { name: 'asset_number', value: row => row.asset_number },
            { name: 'equipment_name', value: row => row.equipment_name },
            { name: 'category', value: row => row.category },
            { name: 'note_title', value: row => row.note_title },
            { name: 'work_order_reference', value: row => row.work_order_reference },
          ],
        },
        {
          table: 'asset_note_update_attachments',
          name: 'Equipment Update Files',
          query: "SELECT x.*,u.note_id AS note_id,n.asset_id AS asset_id,n.title AS note_title,a.asset_number AS asset_number,a.equipment_name AS equipment_name,a.category AS category FROM asset_note_update_attachments x LEFT JOIN asset_note_updates u ON u.id=x.update_id LEFT JOIN equipment_asset_notes n ON n.id=u.note_id LEFT JOIN equipment_assets a ON a.id=n.asset_id WHERE u.asset_library='equipment' ORDER BY x.rowid",
          derivedColumns: [
            { name: 'note_id', value: row => row.note_id },
            { name: 'asset_id', value: row => row.asset_id },
            { name: 'asset_number', value: row => row.asset_number },
            { name: 'equipment_name', value: row => row.equipment_name },
            { name: 'category', value: row => row.category },
            { name: 'note_title', value: row => row.note_title },
            { name: 'portable_relative_path', value: row => portableStoredReference(row.stored_file_reference) },
          ],
        },
        {
          table: 'asset_note_lifecycle_events',
          name: 'Equipment Issue Lifecycle',
          query: "SELECT e.*,n.asset_id AS asset_id,n.title AS note_title,n.work_order_reference AS work_order_reference,a.asset_number AS asset_number,a.equipment_name AS equipment_name,a.category AS category FROM asset_note_lifecycle_events e LEFT JOIN equipment_asset_notes n ON n.id=e.note_id LEFT JOIN equipment_assets a ON a.id=n.asset_id WHERE e.asset_library='equipment' ORDER BY e.rowid",
          derivedColumns: [
            { name: 'asset_id', value: row => row.asset_id },
            { name: 'asset_number', value: row => row.asset_number },
            { name: 'equipment_name', value: row => row.equipment_name },
            { name: 'category', value: row => row.category },
            { name: 'note_title', value: row => row.note_title },
            { name: 'work_order_reference', value: row => row.work_order_reference },
          ],
        },
      ] },
      { filename: 'MCC_History.xlsx', sheets: (historyTables.length ? historyTables : ['history_logs']).map(table => ({ table, name: table })) },
    ];
    for (const item of exports) {
      await writeDatabaseWorkbook(database, path.join(excelRoot, item.filename), item.sheets.filter(sheet => existing.has(sheet.table)));
    }
    return exports.map(item => `excel/${item.filename}`);
  } finally {
    database.close();
  }
}

async function writeDatabaseWorkbook(database: DatabaseSync, outputPath: string, sheets: WorkbookSheet[]) {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: outputPath, useStyles: true, useSharedStrings: true });
  const usedSheetNames = new Set<string>();
  const overflow = workbook.addWorksheet('Oversized Values');
  overflow.columns = [
    { header: 'Reference', key: 'reference', width: 18 },
    { header: 'Sheet', key: 'sheet', width: 28 },
    { header: 'Source Row', key: 'sourceRow', width: 14 },
    { header: 'Column', key: 'column', width: 28 },
    { header: 'Part', key: 'part', width: 10 },
    { header: 'Value', key: 'value', width: 100 },
  ];
  styleStreamingHeader(overflow);
  let overflowSequence = 0;
  if (!sheets.length) {
    const sheet = workbook.addWorksheet('No records');
    sheet.columns = [{ header: 'Status', key: 'status', width: 70 }];
    styleStreamingHeader(sheet);
    sheet.addRow({ status: 'No applicable records were present in this database snapshot.' }).commit();
    sheet.commit();
  }
  for (const definition of sheets) {
    const persistentColumns = (database.prepare(`PRAGMA table_info(${quoteIdentifier(definition.table)})`).all() as Array<{ name: string }>).map(row => row.name);
    const columns = [...persistentColumns, ...(definition.derivedColumns ?? []).map(column => column.name).filter(name => !persistentColumns.includes(name))];
    if (!columns.length) continue;
    const sheetName = uniqueSheetName(definition.name, usedSheetNames);
    const sheet = workbook.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = columns.map(column => ({ header: column, key: column, width: Math.min(42, Math.max(12, column.length + 3)) }));
    styleStreamingHeader(sheet);
    let sourceRow = 1;
    const statement = database.prepare(definition.query ?? `SELECT * FROM ${quoteIdentifier(definition.table)} ORDER BY rowid`);
    const hyperlinkColumns = new Set(definition.hyperlinkColumns ?? []);
    for (const row of statement.iterate() as Iterable<Record<string, unknown>>) {
      sourceRow += 1;
      const output: Record<string, unknown> = {};
      for (const column of columns) {
        const derived = definition.derivedColumns?.find(item => item.name === column);
        const value = excelValue(derived ? derived.value(row) : row[column]);
        if (typeof value === 'string' && value.length > EXCEL_CELL_LIMIT) {
          const reference = `OV-${++overflowSequence}`;
          output[column] = `[Full value in Oversized Values: ${reference}]`;
          const parts = splitText(value, EXCEL_CELL_LIMIT);
          parts.forEach((part, index) => overflow.addRow({ reference, sheet: sheetName, sourceRow, column, part: `${index + 1}/${parts.length}`, value: part }).commit());
        } else if (typeof value === 'string' && hyperlinkColumns.has(column) && safeHttpUrl(value)) {
          output[column] = { text: value, hyperlink: value };
        } else {
          output[column] = value;
        }
      }
      sheet.addRow(output).commit();
    }
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
    sheet.commit();
  }
  overflow.commit();
  await workbook.commit();
}

function portableStoredReference(value: unknown) {
  const relative = String(value ?? '').replace(/\\/g, '/');
  return relative.startsWith('uploads/') && safeRelativePath(relative) ? `files/${relative}` : '';
}

function machineDocumentPortablePath(row: Record<string, unknown>) {
  const assetId = Number(row.asset_id);
  const storedFilename = String(row.stored_filename ?? '');
  if (!Number.isInteger(assetId) || assetId <= 0 || storedFilename !== path.basename(storedFilename) || !storedFilename) return '';
  return `files/uploads/machine-library/asset-${assetId}/documents/${storedFilename}`;
}

function safeHttpUrl(value: string) {
  if (!value || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) return false;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function uniqueSheetName(table: string, used: Set<string>) {
  const base = table.replace(/[\\/*?:[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Records';
  let candidate = base;
  for (let index = 2; used.has(candidate.toLowerCase()); index += 1) candidate = `${base.slice(0, 27)} ${index}`.slice(0, 31);
  used.add(candidate.toLowerCase());
  return candidate;
}

function styleStreamingHeader(sheet: { getRow(index: number): ExcelJS.Row }) {
  const row = sheet.getRow(1);
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF173B57' } };
  row.commit();
}

function excelValue(value: unknown): string | number | boolean | Date | null {
  if (value === null || value === undefined) return null;
  if (Buffer.isBuffer(value)) return `base64:${value.toString('base64')}`;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value instanceof Date) return value;
  return JSON.stringify(value);
}

function splitText(value: string, size: number) {
  const parts: string[] = [];
  for (let offset = 0; offset < value.length; offset += size) parts.push(value.slice(offset, offset + size));
  return parts;
}

export function writeRecoveryFiles(input: {
  packagePath: string;
  createdAt: string;
  appVersion: string;
  backupType: string;
  packageRoot: string;
}) {
  const recoveryPath = path.join(input.packagePath, 'recovery');
  fs.mkdirSync(recoveryPath, { recursive: true });
  const restoreManifest = {
    packageVersion: PORTABLE_PACKAGE_VERSION,
    schemaVersion: PORTABLE_SCHEMA_VERSION,
    sourcePathsAreRelative: true,
    authoritativeDatabase: 'database/mcc.sqlite',
    currentRuntimeMappings: [
      { source: 'database/mcc.sqlite', destinationConfiguration: 'MCC_DATA_DIR/mcc.sqlite' },
      { source: 'files/uploads/', destinationConfiguration: 'MCC_UPLOADS_DIR' },
      { source: 'files/documents/', destinationConfiguration: 'MCC application runtime documents directory' },
      { source: 'files/files/', destinationConfiguration: 'MCC application runtime files directory' },
      { source: 'files/pm-work-orders/', destinationConfiguration: 'MCC_PM_WORK_ORDER_DIR' },
      { source: 'excel/PM/PM_report_latest.xlsx', destinationConfiguration: 'MCC_PM_EXCEL_DIR/PM_report_latest.xlsx' },
    ],
  };
  fs.writeFileSync(path.join(recoveryPath, 'restore-manifest.json'), `${JSON.stringify(restoreManifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  const readme = [
    'MCC MASTER BACKUP - DISASTER RECOVERY',
    '======================================',
    '',
    `Backup created: ${input.createdAt}`,
    `MCC version: ${input.appVersion}`,
    `Backup type: ${input.backupType}`,
    `Portable package: ${input.packageRoot}.zip`,
    '',
    'AUTHORITATIVE DATA',
    'database/mcc.sqlite is the authoritative relational MCC snapshot. The Excel workbooks are readable insurance and are not the full-fidelity restore source.',
    'Do not restore any package unless MCC reports that the manifest, every checksum, SQLite integrity, package version, and schema compatibility are valid.',
    '',
    'FRESH-DRIVE RECOVERY',
    '1. Install the current supported Raspberry Pi OS and the current supported MCC application release from GitHub/normal deployment.',
    '2. Git/GitHub supplies MCC application code. This Master Backup supplies MCC operational data and runtime payloads.',
    '3. Open Settings > Master Backup / Recovery as Manager or higher and import the complete MCC_Master_Backup_*.zip.',
    '4. MCC copies the archive into its configured recovery location (MCC_RECOVERY_DIR), validates the local copy, and then reports when the external drive may be disconnected.',
    '5. An Admin/Owner Admin selects the verified imported package, types RESTORE MCC, and starts restore.',
    '6. MCC creates a normal pre_restore safety backup before changing live state and restores into the CURRENT configured runtime paths.',
    '7. Restart/reload MCC if prompted, then log in with credentials from the restored database.',
    '',
    'WHAT IS RESTORED',
    'The SQLite database, uploads/documents/files, PM workbook, PM work-order files, and other packaged runtime payloads are restored automatically when present.',
    'Recovery never depends on absolute paths from the failed drive.',
    '',
    'POST-RESTORE VERIFICATION',
    'Confirm users/roles, inventory, vendors, machines, equipment, requisitions, history, PM schedules/history, the active PM workbook, documents, uploads, and work-order attachments.',
    'Run MCC backup verification again and create a new off-device portable backup after recovery.',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(input.packagePath, 'RECOVERY_README.txt'), readme, { encoding: 'utf8', mode: 0o600 });
}

export async function createPortableArchive(packagePath: string, archivePath: string, packageRoot: string) {
  if (!PORTABLE_ROOT_PATTERN.test(packageRoot)) throw new Error('Portable package root name is invalid.');
  fs.mkdirSync(path.dirname(archivePath), { recursive: true });
  const temporaryPath = `${archivePath}.partial-${crypto.randomUUID()}`;
  try {
    const output = fs.createWriteStream(temporaryPath, { flags: 'wx', mode: 0o600 });
    const archive = new ZipArchive({ zlib: { level: 6 } });
    const completion = new Promise<void>((resolve, reject) => {
      output.once('close', resolve);
      output.once('error', reject);
      archive.once('warning', (warning: ArchiverError) => warning.code === 'ENOENT' ? reject(warning) : reject(warning));
      archive.once('error', reject);
    });
    archive.pipe(output);
    archive.directory(packagePath, packageRoot);
    await archive.finalize();
    await completion;
    if (!fs.statSync(temporaryPath).size) throw new Error('Portable archive is empty.');
    if (fs.existsSync(archivePath)) throw new Error('Portable archive filename already exists.');
    fs.renameSync(temporaryPath, archivePath);
    return { archivePath, filename: path.basename(archivePath), sizeBytes: fs.statSync(archivePath).size, sha256: await sha256File(archivePath) };
  } catch (error) {
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

export function inspectPortableArchive(archivePath: string, limitsInput: { maxArchiveBytes?: number; maxExpandedBytes?: number; maxEntries?: number } = {}): ArchiveInspection {
  const limits = normalizeArchiveLimits(limitsInput);
  const stat = fs.statSync(archivePath);
  if (!stat.isFile()) throw new Error('Portable archive is not a regular file.');
  if (!stat.size || stat.size > limits.maxArchiveBytes) throw new Error(`Portable archive exceeds the ${formatBytes(limits.maxArchiveBytes)} compressed-size limit.`);
  const parsed = parseCentralDirectory(archivePath, stat.size, limits.maxEntries);
  const entries = parsed.entries;
  let expandedSizeBytes = 0;
  const names = new Set<string>();
  const roots = new Set<string>();
  const localOffsets = new Set<number>();
  for (const entry of entries) {
    validateArchiveEntryName(entry.name);
    const comparisonName = entry.name.replace(/\/$/, '').toLowerCase();
    if (names.has(comparisonName)) throw new Error(`Portable archive contains a duplicate conflicting path: ${entry.name}`);
    names.add(comparisonName);
    const rootName = entry.name.split('/')[0];
    roots.add(rootName);
    if (!PORTABLE_ROOT_PATTERN.test(rootName)) throw new Error('Portable archive has an unsupported package root.');
    validateApprovedPackageEntry(entry.name, rootName);
    const unixMode = (entry.externalAttributes >>> 16) & 0xffff;
    const unixType = unixMode & 0o170000;
    if (unixType === 0o120000) throw new Error(`Portable archive contains a symbolic link: ${entry.name}`);
    if (unixType && unixType !== 0o100000 && unixType !== 0o040000) throw new Error(`Portable archive contains an unsupported link or device entry: ${entry.name}`);
    if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) throw new Error(`Portable archive uses an unsupported compression method: ${entry.name}`);
    if (entry.directory && (entry.compressedSize !== 0 || entry.uncompressedSize !== 0)) throw new Error(`Portable archive directory entry has invalid size metadata: ${entry.name}`);
    if (entry.localHeaderOffset >= parsed.centralDirectoryOffset || localOffsets.has(entry.localHeaderOffset)) throw new Error('Portable archive local file metadata is corrupt.');
    localOffsets.add(entry.localHeaderOffset);
    expandedSizeBytes += entry.uncompressedSize;
    if (expandedSizeBytes > limits.maxExpandedBytes) throw new Error(`Portable archive exceeds the ${formatBytes(limits.maxExpandedBytes)} expanded-size limit.`);
    if (entry.compressedSize > 0 && entry.uncompressedSize / entry.compressedSize > 250 && entry.uncompressedSize > 10 * 1024 * 1024) {
      throw new Error(`Portable archive entry has an unsafe compression ratio: ${entry.name}`);
    }
  }
  if (roots.size !== 1) throw new Error('Portable archive must contain exactly one MCC Master Backup package root.');
  const rootName = [...roots][0];
  for (const required of [`${rootName}/manifest.json`, `${rootName}/RECOVERY_README.txt`, `${rootName}/database/mcc.sqlite`, `${rootName}/recovery/restore-manifest.json`]) {
    if (!names.has(required.toLowerCase())) throw new Error(`Portable archive is missing required entry: ${required.slice(rootName.length + 1)}`);
  }
  return { entries, rootName, compressedSizeBytes: stat.size, expandedSizeBytes, centralDirectoryOffset: parsed.centralDirectoryOffset };
}

function parseCentralDirectory(archivePath: string, archiveSize: number, maxEntries: number) {
  const descriptor = fs.openSync(archivePath, 'r');
  try {
    const tailSize = Math.min(archiveSize, 65_557);
    const tailOffset = archiveSize - tailSize;
    const tail = readExactly(descriptor, tailSize, tailOffset);
    let relativeEocdOffset = -1;
    for (let offset = tail.length - 22; offset >= 0; offset -= 1) {
      if (tail.readUInt32LE(offset) !== 0x06054b50) continue;
      const commentLength = tail.readUInt16LE(offset + 20);
      if (offset + 22 + commentLength === tail.length) {
        relativeEocdOffset = offset;
        break;
      }
    }
    if (relativeEocdOffset < 0) throw new Error('Portable archive is corrupt or missing its central directory.');
    const eocdOffset = tailOffset + relativeEocdOffset;
    const diskNumber = tail.readUInt16LE(relativeEocdOffset + 4);
    const centralDisk = tail.readUInt16LE(relativeEocdOffset + 6);
    const entriesOnDisk = tail.readUInt16LE(relativeEocdOffset + 8);
    const entryCount = tail.readUInt16LE(relativeEocdOffset + 10);
    const centralSize = tail.readUInt32LE(relativeEocdOffset + 12);
    const centralOffset = tail.readUInt32LE(relativeEocdOffset + 16);
    if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) throw new Error('Multi-disk portable archives are not supported.');
    if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) throw new Error('ZIP64 portable archives are not supported by this recovery version.');
    if (!entryCount || entryCount > maxEntries) throw new Error(`Portable archive entry count is invalid or exceeds ${maxEntries}.`);
    if (!centralSize || centralSize > MAX_CENTRAL_DIRECTORY_BYTES) throw new Error(`Portable archive central directory exceeds the ${formatBytes(MAX_CENTRAL_DIRECTORY_BYTES)} bounded-memory limit.`);
    if (centralOffset + centralSize > eocdOffset) throw new Error('Portable archive central directory is corrupt.');
    const buffer = readExactly(descriptor, centralSize, centralOffset);
    const entries: CentralDirectoryEntry[] = [];
    let offset = 0;
    for (let index = 0; index < entryCount; index += 1) {
      if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('Portable archive central directory entry is corrupt.');
      const flags = buffer.readUInt16LE(offset + 8);
      if (flags & 0x1) throw new Error('Encrypted portable archives are not supported.');
      const compressionMethod = buffer.readUInt16LE(offset + 10);
      const expectedCrc32 = buffer.readUInt32LE(offset + 16);
      const compressedSize = buffer.readUInt32LE(offset + 20);
      const uncompressedSize = buffer.readUInt32LE(offset + 24);
      const nameLength = buffer.readUInt16LE(offset + 28);
      const extraLength = buffer.readUInt16LE(offset + 30);
      const commentLength = buffer.readUInt16LE(offset + 32);
      const diskStart = buffer.readUInt16LE(offset + 34);
      const externalAttributes = buffer.readUInt32LE(offset + 38);
      const localHeaderOffset = buffer.readUInt32LE(offset + 42);
      const nextOffset = offset + 46 + nameLength + extraLength + commentLength;
      if (!nameLength || nextOffset > buffer.length) throw new Error('Portable archive contains an invalid central directory name.');
      if (diskStart !== 0) throw new Error('Multi-disk portable archives are not supported.');
      if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) throw new Error('ZIP64 portable archives are not supported by this recovery version.');
      const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString((flags & 0x800) ? 'utf8' : 'latin1');
      entries.push({ name, flags, compressionMethod, crc32: expectedCrc32, compressedSize, uncompressedSize, externalAttributes, localHeaderOffset, directory: name.endsWith('/') });
      offset = nextOffset;
    }
    if (offset !== centralSize) throw new Error('Portable archive central directory length does not match its metadata.');
    return { entries, centralDirectoryOffset: centralOffset };
  } finally {
    fs.closeSync(descriptor);
  }
}

function readExactly(descriptor: number, length: number, position: number) {
  const buffer = Buffer.allocUnsafe(length);
  let offset = 0;
  while (offset < length) {
    const read = fs.readSync(descriptor, buffer, offset, length - offset, position + offset);
    if (!read) throw new Error('Portable archive ended before its metadata was complete.');
    offset += read;
  }
  return buffer;
}

function validateArchiveEntryName(name: string) {
  if (!name || name.includes('\0') || name.includes('\\')) throw new Error(`Portable archive contains an unsafe path: ${name || '(empty)'}`);
  if (name.startsWith('/') || name.startsWith('//') || /^[A-Za-z]:/.test(name)) throw new Error(`Portable archive contains an absolute path: ${name}`);
  const segments = name.replace(/\/$/, '').split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) throw new Error(`Portable archive contains path traversal: ${name}`);
}

function validateApprovedPackageEntry(name: string, rootName: string) {
  const relative = name.slice(rootName.length).replace(/^\//, '').replace(/\/$/, '');
  if (!relative) return;
  const top = relative.split('/')[0];
  const approved = new Set(['manifest.json', 'RECOVERY_README.txt', 'database', 'excel', 'files', 'pm', 'recovery']);
  if (!approved.has(top)) throw new Error(`Portable archive contains an entry outside the approved package structure: ${relative}`);
  if ((top === 'manifest.json' || top === 'RECOVERY_README.txt') && relative !== top) throw new Error(`Portable archive contains an invalid package entry: ${relative}`);
}

export async function extractAndImportPortableArchive(input: {
  archivePath: string;
  recoveryRoot: string;
  currentAppVersion: string;
  limits?: { maxArchiveBytes?: number; maxExpandedBytes?: number; maxEntries?: number };
  storagePolicy?: Partial<RecoveryStoragePolicy>;
}) {
  const inspection = inspectPortableArchive(input.archivePath, input.limits);
  const stagingRoot = path.join(input.recoveryRoot, '.staging');
  const importedRoot = path.join(input.recoveryRoot, 'imported');
  const archivesRoot = path.join(input.recoveryRoot, 'archives');
  fs.mkdirSync(stagingRoot, { recursive: true });
  fs.mkdirSync(importedRoot, { recursive: true });
  fs.mkdirSync(archivesRoot, { recursive: true });
  const stagingPath = path.join(stagingRoot, `import-${crypto.randomUUID()}`);
  fs.mkdirSync(stagingPath, { recursive: false });
  const archiveSha256 = await sha256File(input.archivePath);
  const finalPackagePath = path.join(importedRoot, inspection.rootName);
  const finalArchivePath = path.join(archivesRoot, `${inspection.rootName}.zip`);
  try {
    if (fs.existsSync(finalPackagePath) || fs.existsSync(finalArchivePath)) {
      if (fs.existsSync(finalPackagePath) && fs.existsSync(finalArchivePath) && await sha256File(finalArchivePath) === archiveSha256) {
        const validation = validatePortablePackage(finalPackagePath, input.currentAppVersion);
        return importedSummary(validation, finalArchivePath, archiveSha256, true);
      }
      throw new Error('A different imported recovery package already uses this backup name.');
    }
    assertRecoveryStorageCapacity(input.recoveryRoot, inspection.compressedSizeBytes + inspection.expandedSizeBytes, input.storagePolicy);
    ensureAvailableSpace(input.recoveryRoot, inspection.compressedSizeBytes + inspection.expandedSizeBytes + RECOVERY_IMPORT_HEADROOM_BYTES);
    for (const entry of inspection.entries) {
      const target = resolveInside(stagingPath, entry.name.replace(/\/$/, ''));
      if (entry.directory) {
        fs.mkdirSync(target, { recursive: true });
        continue;
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      await extractArchiveEntry(input.archivePath, entry, inspection.centralDirectoryOffset, target);
    }
    const stagedPackagePath = path.join(stagingPath, inspection.rootName);
    const validation = validatePortablePackage(stagedPackagePath, input.currentAppVersion);
    const temporaryArchivePath = path.join(archivesRoot, `.${inspection.rootName}.${crypto.randomUUID()}.partial`);
    await copyFileVerified(input.archivePath, temporaryArchivePath, archiveSha256);
    fs.renameSync(temporaryArchivePath, finalArchivePath);
    try {
      fs.renameSync(stagedPackagePath, finalPackagePath);
    } catch (error) {
      fs.rmSync(finalArchivePath, { force: true });
      throw error;
    }
    const imported = importedSummary({ ...validation, packagePath: finalPackagePath }, finalArchivePath, archiveSha256, false);
    fs.writeFileSync(path.join(importedRoot, `${inspection.rootName}.import.json`), `${JSON.stringify(imported, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    return imported;
  } finally {
    if (isPathInside(stagingRoot, stagingPath) && fs.existsSync(stagingPath)) fs.rmSync(stagingPath, { recursive: true, force: true });
  }
}

async function extractArchiveEntry(archivePath: string, entry: CentralDirectoryEntry, centralDirectoryOffset: number, targetPath: string) {
  const descriptor = fs.openSync(archivePath, 'r');
  let dataOffset = 0;
  try {
    const localHeader = readExactly(descriptor, 30, entry.localHeaderOffset);
    if (localHeader.readUInt32LE(0) !== 0x04034b50) throw new Error(`Portable archive local header is corrupt: ${entry.name}`);
    const localFlags = localHeader.readUInt16LE(6);
    const localMethod = localHeader.readUInt16LE(8);
    const localCrc32 = localHeader.readUInt32LE(14);
    const localCompressedSize = localHeader.readUInt32LE(18);
    const localUncompressedSize = localHeader.readUInt32LE(22);
    const nameLength = localHeader.readUInt16LE(26);
    const extraLength = localHeader.readUInt16LE(28);
    if (!nameLength || (localFlags & 0x1) || localMethod !== entry.compressionMethod || (localFlags & 0x800) !== (entry.flags & 0x800)) {
      throw new Error(`Portable archive local metadata does not match its central directory: ${entry.name}`);
    }
    const nameBuffer = readExactly(descriptor, nameLength, entry.localHeaderOffset + 30);
    const localName = nameBuffer.toString((localFlags & 0x800) ? 'utf8' : 'latin1');
    if (localName !== entry.name) throw new Error(`Portable archive local path does not match its central directory: ${entry.name}`);
    if (!(localFlags & 0x8) && (localCrc32 !== entry.crc32 || localCompressedSize !== entry.compressedSize || localUncompressedSize !== entry.uncompressedSize)) {
      throw new Error(`Portable archive local size or checksum metadata does not match: ${entry.name}`);
    }
    dataOffset = entry.localHeaderOffset + 30 + nameLength + extraLength;
    if (dataOffset < 0 || dataOffset + entry.compressedSize > centralDirectoryOffset) throw new Error(`Portable archive entry data is out of bounds: ${entry.name}`);
  } finally {
    fs.closeSync(descriptor);
  }
  if (entry.compressedSize === 0) {
    if (entry.uncompressedSize !== 0 || entry.crc32 !== 0) throw new Error(`Portable archive entry integrity check failed: ${entry.name}`);
    fs.writeFileSync(targetPath, Buffer.alloc(0), { flag: 'wx', mode: 0o600 });
    return;
  }
  const source = fs.createReadStream(archivePath, { start: dataOffset, end: dataOffset + entry.compressedSize - 1 });
  const integrity = new ZipEntryIntegrity(entry);
  const output = fs.createWriteStream(targetPath, { flags: 'wx', mode: 0o600 });
  try {
    if (entry.compressionMethod === 8) await pipeline(source, createInflateRaw(), integrity, output);
    else await pipeline(source, integrity, output);
  } catch (error) {
    if (error instanceof Error && /^Portable archive entry /.test(error.message)) throw error;
    throw new Error(`Portable archive entry extraction or integrity check failed: ${entry.name}`, { cause: error });
  }
}

class ZipEntryIntegrity extends Transform {
  private byteCount = 0;
  private checksum = 0;

  constructor(private readonly entry: CentralDirectoryEntry) {
    super();
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null, data?: Buffer) => void) {
    this.byteCount += chunk.length;
    if (this.byteCount > this.entry.uncompressedSize) return callback(new Error(`Portable archive entry exceeds its declared expanded size: ${this.entry.name}`));
    this.checksum = crc32(chunk, this.checksum);
    callback(null, chunk);
  }

  override _flush(callback: (error?: Error | null) => void) {
    if (this.byteCount !== this.entry.uncompressedSize) return callback(new Error(`Portable archive entry size does not match its metadata: ${this.entry.name}`));
    if ((this.checksum >>> 0) !== this.entry.crc32) return callback(new Error(`Portable archive entry CRC integrity check failed: ${this.entry.name}`));
    callback();
  }
}

function importedSummary(validation: PortablePackageValidation, archivePath: string, archiveSha256: string, alreadyImported: boolean): ImportedPortablePackage {
  const stat = fs.statSync(archivePath);
  return {
    id: path.basename(validation.packagePath),
    name: path.basename(validation.packagePath),
    createdAt: validation.manifest.createdAt,
    appVersion: validation.manifest.appVersion,
    backupType: validation.manifest.backupType,
    packagePath: validation.packagePath,
    archivePath,
    archiveFilename: path.basename(archivePath),
    archiveSizeBytes: stat.size,
    archiveSha256,
    importedAt: new Date().toISOString(),
    checkedFileCount: validation.checkedFileCount,
    safeToDisconnect: true,
    ...(alreadyImported ? { alreadyImported: true } : {}),
  };
}

export function validatePortablePackage(packagePath: string, currentAppVersion: string): PortablePackageValidation {
  const root = path.resolve(packagePath);
  const folderName = path.basename(root);
  const manifestPath = path.join(root, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error('Portable package manifest is missing.');
  let manifest: PortablePackageManifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as PortablePackageManifest;
  } catch {
    throw new Error('Portable package manifest is invalid JSON.');
  }
  if (manifest.packageVersion !== PORTABLE_PACKAGE_VERSION) throw new Error('Portable package version is unsupported.');
  if (manifest.schemaVersion !== PORTABLE_SCHEMA_VERSION) throw new Error('Portable package schema version is incompatible.');
  const rootName = String(manifest.portableArchive?.packageRoot ?? '');
  if (!PORTABLE_ROOT_PATTERN.test(rootName)) throw new Error('Portable package root in the manifest is invalid.');
  if (PORTABLE_ROOT_PATTERN.test(folderName) && folderName !== rootName) throw new Error('Portable package root does not match the manifest.');
  assertVersionCompatible(manifest.appVersion, currentAppVersion);
  const required = [
    'RECOVERY_README.txt',
    'database/mcc.sqlite',
    'recovery/restore-manifest.json',
    'excel/MCC_Inventory.xlsx',
    'excel/MCC_Vendors.xlsx',
    'excel/MCC_Machine_List.xlsx',
    'excel/MCC_Equipment_List.xlsx',
    'excel/MCC_History.xlsx',
  ];
  for (const relative of required) {
    const candidate = resolveInside(root, relative);
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) throw new Error(`Portable package is incomplete: ${relative} is missing.`);
  }
  const actualFiles = walkPackageFiles(root);
  const checksums = manifest.fileChecksums;
  if (!checksums || typeof checksums !== 'object') throw new Error('Portable package checksum manifest is missing.');
  for (const [relative, expected] of Object.entries(checksums)) {
    if (!safeRelativePath(relative)) throw new Error(`Portable package manifest contains an unsafe path: ${relative}`);
    const candidate = resolveInside(root, relative);
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) throw new Error(`Portable package checksum target is missing: ${relative}`);
    if (!/^[a-f0-9]{64}$/i.test(String(expected)) || sha256FileSync(candidate) !== expected) throw new Error(`Portable package checksum mismatch: ${relative}`);
  }
  const unlisted = actualFiles.map(file => file.relativePath).filter(relative => relative !== 'manifest.json' && !Object.hasOwn(checksums, relative));
  if (unlisted.length) throw new Error(`Portable package contains an unverified file: ${unlisted[0]}`);
  const databasePath = databasePathInPackage(root, manifest);
  if (sha256FileSync(databasePath) !== manifest.checksumSha256) throw new Error('Portable package database checksum does not match the manifest.');
  validateSqliteDatabase(databasePath);
  validateMachineLibraryPackageIntegrity(databasePath, root);
  validateEquipmentLibraryPackageIntegrity(databasePath, root);
  const recoveryManifest = JSON.parse(fs.readFileSync(path.join(root, 'recovery', 'restore-manifest.json'), 'utf8')) as Record<string, unknown>;
  if (recoveryManifest.packageVersion !== PORTABLE_PACKAGE_VERSION || recoveryManifest.sourcePathsAreRelative !== true) throw new Error('Portable package restore manifest is incompatible.');
  return {
    ok: true,
    packagePath: root,
    manifest,
    databasePath,
    checkedFileCount: Object.keys(checksums).length,
    expandedSizeBytes: actualFiles.reduce((total, file) => total + file.sizeBytes, 0),
  };
}

export function validateMachineLibraryPackageIntegrity(databasePath: string, packagePath: string) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const tables = new Set((database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map(row => row.name));
    if (!tables.has('machine_assets')) return;
    const assetIds = new Set((database.prepare('SELECT id FROM machine_assets').all() as Array<{ id: number }>).map(row => Number(row.id)));
    const userIds = new Set(tables.has('users') ? (database.prepare('SELECT id FROM users').all() as Array<{ id: number }>).map(row => Number(row.id)) : []);
    const folderRelationships = new Set<string>();
    if (tables.has('machine_document_folders')) {
      for (const row of database.prepare('SELECT id,asset_id FROM machine_document_folders').all() as Array<{ id: number; asset_id: number }>) {
        assertMachineAssetRelationship(assetIds, row.asset_id, `document folder ${row.id}`);
        folderRelationships.add(`${Number(row.id)}:${Number(row.asset_id)}`);
      }
    }
    if (tables.has('machine_documents')) {
      for (const row of database.prepare('SELECT id,asset_id,folder_id,stored_filename,size_bytes FROM machine_documents').all() as Array<Record<string, unknown>>) {
        const id = Number(row.id);
        const assetId = Number(row.asset_id);
        assertMachineAssetRelationship(assetIds, assetId, `document ${id}`);
        if (!folderRelationships.has(`${Number(row.folder_id)}:${assetId}`)) throw new Error(`Portable package Machine Library document ${id} has an invalid folder relationship.`);
        const storedFilename = String(row.stored_filename ?? '');
        if (!storedFilename || storedFilename !== path.basename(storedFilename) || storedFilename.includes('\\')) throw new Error(`Portable package Machine Library document ${id} has an unsafe stored filename.`);
        assertMachinePayloadFile(packagePath, `files/uploads/machine-library/asset-${assetId}/documents/${storedFilename}`, row.size_bytes, `document ${id}`);
      }
    }
    const noteAssets = new Map<number, number>();
    const noteWarnings = new Map<number, boolean>();
    if (tables.has('machine_asset_notes')) {
      for (const row of database.prepare('SELECT * FROM machine_asset_notes').all() as Array<Record<string, unknown>>) {
        const id = Number(row.id);
        const assetId = Number(row.asset_id);
        assertMachineAssetRelationship(assetIds, assetId, `asset note ${id}`);
        noteAssets.set(id, assetId);
        noteWarnings.set(id, Number(row.is_warning ?? 0) === 1);
        assertAssetNoteUserRelationship(userIds,row.created_by_user_id,`Machine Library asset note ${id} creator`);
        validateAssetNoteLifecycleColumns(row,`Machine Library asset note ${id}`,userIds);
        const pdfReference = String(row.pdf_stored_reference ?? '');
        if (pdfReference) assertMachineStoredReference(packagePath, pdfReference, 'uploads/machine-asset-notes/', undefined, `asset note PDF ${id}`);
      }
    }
    if (tables.has('machine_asset_note_attachments')) {
      for (const row of database.prepare('SELECT id,note_id,file_size,stored_file_reference FROM machine_asset_note_attachments').all() as Array<Record<string, unknown>>) {
        const id = Number(row.id);
        if (!noteAssets.has(Number(row.note_id))) throw new Error(`Portable package Machine Library note attachment ${id} has an invalid note relationship.`);
        assertMachineStoredReference(packagePath, row.stored_file_reference, 'uploads/machine-asset-notes/', row.file_size, `note attachment ${id}`);
      }
    }
    validateAssetNoteIssueLifecycleIntegrity(database,tables,packagePath,'machine',noteWarnings,userIds);
    validateMachineReferencedTable(database, tables, assetIds, packagePath, {
      table: 'machine_inspection_records', prefix: 'uploads/machine-inspection-records/', label: 'inspection record', sizeColumn: 'file_size',
    });
    validateMachineReferencedTable(database, tables, assetIds, packagePath, {
      table: 'machine_component_images', prefix: 'uploads/machine-component-images/', label: 'component image', sizeColumn: 'file_size',
    });
  } finally {
    database.close();
  }
}

export function validateEquipmentLibraryPackageIntegrity(databasePath: string, packagePath: string) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const tables = new Set((database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map(row => row.name));
    if (!tables.has('equipment_assets')) return;
    const assetIds = new Set((database.prepare('SELECT id FROM equipment_assets').all() as Array<{ id: number }>).map(row => Number(row.id)));
    const userIds = new Set(tables.has('users') ? (database.prepare('SELECT id FROM users').all() as Array<{ id: number }>).map(row => Number(row.id)) : []);
    const noteAssets = new Map<number, number>();
    const noteWarnings = new Map<number, boolean>();
    if (tables.has('equipment_asset_notes')) {
      for (const row of database.prepare('SELECT * FROM equipment_asset_notes').all() as Array<Record<string, unknown>>) {
        const id = Number(row.id);
        const assetId = Number(row.asset_id);
        assertEquipmentAssetRelationship(assetIds, assetId, `asset note ${id}`);
        noteAssets.set(id, assetId);
        noteWarnings.set(id, Number(row.is_warning ?? 0) === 1);
        assertAssetNoteUserRelationship(userIds,row.created_by_user_id,`Equipment Library asset note ${id} creator`);
        validateAssetNoteLifecycleColumns(row,`Equipment Library asset note ${id}`,userIds);
        const pdfReference = String(row.pdf_stored_reference ?? '');
        if (pdfReference) assertEquipmentStoredReference(packagePath, pdfReference, undefined, `asset note PDF ${id}`);
      }
    }
    if (tables.has('equipment_asset_note_attachments')) {
      for (const row of database.prepare('SELECT id,note_id,file_size,stored_file_reference FROM equipment_asset_note_attachments').all() as Array<Record<string, unknown>>) {
        const id = Number(row.id);
        if (!noteAssets.has(Number(row.note_id))) throw new Error(`Portable package Equipment Library note attachment ${id} has an invalid note relationship.`);
        assertEquipmentStoredReference(packagePath, row.stored_file_reference, row.file_size, `note attachment ${id}`);
      }
    }
    validateAssetNoteIssueLifecycleIntegrity(database,tables,packagePath,'equipment',noteWarnings,userIds);
  } finally {
    database.close();
  }
}

function assertAssetNoteUserRelationship(userIds:Set<number>,value:unknown,label:string) {
  if(value===null||value===undefined||value==='')return;
  const userId=Number(value);
  if(!Number.isInteger(userId)||!userIds.has(userId))throw new Error(`Portable package ${label} has an invalid user relationship.`);
}

function validateAssetNoteLifecycleColumns(row:Record<string,unknown>,label:string,userIds:Set<number>) {
  if(!Object.hasOwn(row,'issue_status'))return;
  const warning=Number(row.is_warning??0)===1;
  const status=String(row.issue_status??'');
  if(!['active','resolved'].includes(status))throw new Error(`Portable package ${label} has an invalid lifecycle status.`);
  if(!warning&&String(row.work_order_reference??'').trim())throw new Error(`Portable package ${label} has a Work Order on an ordinary note.`);
  if(status==='resolved'){
    if(!warning||!String(row.resolved_at??'').trim()||!String(row.resolved_by_name??'').trim()||row.resolved_by_user_id===null||row.resolved_by_user_id===undefined||!String(row.resolution_summary??'').trim())throw new Error(`Portable package ${label} has incomplete resolution metadata.`);
    assertAssetNoteUserRelationship(userIds,row.resolved_by_user_id,`${label} resolver`);
  }
  if(Number(row.deleted??0)===1){
    if(!warning||!String(row.deleted_at??'').trim()||!String(row.deleted_by_name??'').trim()||row.deleted_by_user_id===null||row.deleted_by_user_id===undefined||!String(row.delete_reason??'').trim())throw new Error(`Portable package ${label} has incomplete delete audit evidence.`);
    assertAssetNoteUserRelationship(userIds,row.deleted_by_user_id,`${label} deleting user`);
  }
  const hasReopenMetadata=Boolean(String(row.reopened_at??'').trim()||String(row.reopened_by_name??'').trim()||row.reopened_by_user_id!==null&&row.reopened_by_user_id!==undefined);
  if(hasReopenMetadata){
    if(!String(row.reopened_at??'').trim()||!String(row.reopened_by_name??'').trim()||row.reopened_by_user_id===null||row.reopened_by_user_id===undefined)throw new Error(`Portable package ${label} has incomplete reopen audit evidence.`);
    assertAssetNoteUserRelationship(userIds,row.reopened_by_user_id,`${label} reopening user`);
  }
}

function validateAssetNoteIssueLifecycleIntegrity(database:DatabaseSync,tables:Set<string>,packagePath:string,library:'machine'|'equipment',noteWarnings:Map<number,boolean>,userIds:Set<number>) {
  const label=library==='machine'?'Machine Library':'Equipment Library';
  for(const table of ['asset_note_updates','asset_note_lifecycle_events']){
    if(!tables.has(table))continue;
    const invalid=database.prepare(`SELECT asset_library FROM ${quoteIdentifier(table)} WHERE asset_library NOT IN ('machine','equipment') LIMIT 1`).get() as Record<string,unknown>|undefined;
    if(invalid)throw new Error(`Portable package ${label} warning issue data contains an invalid library relationship.`);
  }
  const updateIds=new Set<number>();
  if(tables.has('asset_note_updates')){
    for(const row of database.prepare('SELECT * FROM asset_note_updates WHERE asset_library=?').all(library) as Array<Record<string,unknown>>){
      const id=Number(row.id);const noteId=Number(row.note_id);
      if(!noteWarnings.get(noteId))throw new Error(`Portable package ${label} warning issue update ${id} has an invalid note relationship.`);
      if(!String(row.body??'').trim()||!String(row.created_by_name??'').trim()||row.created_by_user_id===null||row.created_by_user_id===undefined||!String(row.created_at??'').trim())throw new Error(`Portable package ${label} warning issue update ${id} has incomplete audit metadata.`);
      assertAssetNoteUserRelationship(userIds,row.created_by_user_id,`${label} warning issue update ${id} creator`);
      updateIds.add(id);
    }
  }
  if(tables.has('asset_note_update_attachments')){
    const allUpdateIds=new Set((database.prepare('SELECT id FROM asset_note_updates').all() as Array<{id:number}>).map(row=>Number(row.id)));
    for(const row of database.prepare('SELECT * FROM asset_note_update_attachments').all() as Array<Record<string,unknown>>){
      const id=Number(row.id);const updateId=Number(row.update_id);
      if(!allUpdateIds.has(updateId))throw new Error(`Portable package warning issue update attachment ${id} has an invalid update relationship.`);
      if(!updateIds.has(updateId))continue;
      if(!String(row.uploaded_by_name??'').trim()||row.uploaded_by_user_id===null||row.uploaded_by_user_id===undefined)throw new Error(`Portable package ${label} warning issue update attachment ${id} has incomplete uploader metadata.`);
      assertAssetNoteUserRelationship(userIds,row.uploaded_by_user_id,`${label} warning issue update attachment ${id} uploader`);
      if(library==='machine')assertMachineStoredReference(packagePath,row.stored_file_reference,'uploads/machine-asset-notes/',row.file_size,`warning issue update attachment ${id}`);
      else assertEquipmentStoredReference(packagePath,row.stored_file_reference,row.file_size,`warning issue update attachment ${id}`);
    }
  }
  if(tables.has('asset_note_lifecycle_events')){
    for(const row of database.prepare('SELECT * FROM asset_note_lifecycle_events WHERE asset_library=?').all(library) as Array<Record<string,unknown>>){
      const id=Number(row.id);const noteId=Number(row.note_id);const type=String(row.event_type??'');
      if(!noteWarnings.get(noteId))throw new Error(`Portable package ${label} warning issue lifecycle event ${id} has an invalid note relationship.`);
      if(!type||!String(row.actor_name??'').trim()||row.actor_user_id===null||row.actor_user_id===undefined||!String(row.created_at??'').trim())throw new Error(`Portable package ${label} warning issue lifecycle event ${id} has incomplete audit metadata.`);
      if(['issue_resolved','issue_reopened','issue_deleted'].includes(type)&&!String(row.reason??'').trim())throw new Error(`Portable package ${label} warning issue lifecycle event ${id} is missing its required reason.`);
      assertAssetNoteUserRelationship(userIds,row.actor_user_id,`${label} warning issue lifecycle event ${id} actor`);
      for(const column of ['old_value_json','new_value_json']){try{JSON.parse(String(row[column]??'{}'));}catch{throw new Error(`Portable package ${label} warning issue lifecycle event ${id} has invalid audit JSON.`);}}
    }
  }
}

function assertEquipmentAssetRelationship(assetIds: Set<number>, value: unknown, label: string) {
  const assetId = Number(value);
  if (!Number.isInteger(assetId) || !assetIds.has(assetId)) throw new Error(`Portable package Equipment Library ${label} has an invalid equipment relationship.`);
}

function assertEquipmentStoredReference(packagePath: string, value: unknown, expectedSize: unknown, label: string) {
  const reference = String(value ?? '');
  if (!reference.startsWith('uploads/equipment-asset-notes/') || !safeRelativePath(reference)) throw new Error(`Portable package Equipment Library ${label} has an unsafe stored file reference.`);
  assertEquipmentPayloadFile(packagePath, `files/${reference}`, expectedSize, label);
}

function assertEquipmentPayloadFile(packagePath: string, relative: string, expectedSize: unknown, label: string) {
  const candidate = resolveInside(packagePath, relative);
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) throw new Error(`Portable package is missing Equipment Library ${label} physical file.`);
  if (expectedSize !== undefined && expectedSize !== null) {
    const size = Number(expectedSize);
    if (!Number.isSafeInteger(size) || size < 0 || fs.statSync(candidate).size !== size) throw new Error(`Portable package Equipment Library ${label} physical file size does not match its database metadata.`);
  }
}

function validateMachineReferencedTable(
  database: DatabaseSync,
  tables: Set<string>,
  assetIds: Set<number>,
  packagePath: string,
  input: { table: string; prefix: string; label: string; sizeColumn: string },
) {
  if (!tables.has(input.table)) return;
  const statement = database.prepare(`SELECT id,asset_id,stored_file_reference,${quoteIdentifier(input.sizeColumn)} AS expected_size FROM ${quoteIdentifier(input.table)}`);
  for (const row of statement.all() as Array<Record<string, unknown>>) {
    const id = Number(row.id);
    assertMachineAssetRelationship(assetIds, row.asset_id, `${input.label} ${id}`);
    assertMachineStoredReference(packagePath, row.stored_file_reference, input.prefix, row.expected_size, `${input.label} ${id}`);
  }
}

function assertMachineAssetRelationship(assetIds: Set<number>, value: unknown, label: string) {
  const assetId = Number(value);
  if (!Number.isInteger(assetId) || !assetIds.has(assetId)) throw new Error(`Portable package Machine Library ${label} has an invalid machine relationship.`);
}

function assertMachineStoredReference(packagePath: string, value: unknown, prefix: string, expectedSize: unknown, label: string) {
  const reference = String(value ?? '');
  if (!reference.startsWith(prefix) || !safeRelativePath(reference)) throw new Error(`Portable package Machine Library ${label} has an unsafe stored file reference.`);
  assertMachinePayloadFile(packagePath, `files/${reference}`, expectedSize, label);
}

function assertMachinePayloadFile(packagePath: string, relative: string, expectedSize: unknown, label: string) {
  const candidate = resolveInside(packagePath, relative);
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) throw new Error(`Portable package is missing Machine Library ${label} physical file.`);
  if (expectedSize !== undefined && expectedSize !== null) {
    const size = Number(expectedSize);
    if (!Number.isSafeInteger(size) || size < 0 || fs.statSync(candidate).size !== size) throw new Error(`Portable package Machine Library ${label} physical file size does not match its database metadata.`);
  }
}

export function validateSqliteDatabase(databasePath: string) {
  const header = Buffer.alloc(16);
  const descriptor = fs.openSync(databasePath, 'r');
  try {
    if (fs.readSync(descriptor, header, 0, header.length, 0) !== header.length || header.toString('utf8') !== 'SQLite format 3\0') throw new Error('Portable package database is not a valid SQLite file.');
  } finally {
    fs.closeSync(descriptor);
  }
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const quickCheck = database.prepare('PRAGMA quick_check').get() as Record<string, unknown> | undefined;
    const result = String(quickCheck?.quick_check ?? Object.values(quickCheck ?? {})[0] ?? '');
    if (result.toLowerCase() !== 'ok') throw new Error(`Portable package database integrity check failed: ${result || 'unknown error'}`);
    const tables = new Set((database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map(row => row.name));
    for (const required of ['users', 'app_settings']) if (!tables.has(required)) throw new Error(`Portable package database schema is incompatible: missing ${required}.`);
  } finally {
    database.close();
  }
}

function assertVersionCompatible(backupVersion: string, currentVersion: string) {
  const backup = parseVersion(backupVersion);
  const current = parseVersion(currentVersion);
  if (!backup || !current) throw new Error('Portable package MCC version metadata is invalid.');
  if (backup[0] > current[0] || (backup[0] === current[0] && backup[1] > current[1])) {
    throw new Error(`Portable package was created by newer incompatible MCC version ${backupVersion}. Install a supported matching release first.`);
  }
}

function parseVersion(value: string) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(value ?? '').trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] as const : null;
}

export function listImportedPortablePackages(recoveryRoot: string, currentAppVersion: string) {
  const importedRoot = path.join(recoveryRoot, 'imported');
  const archivesRoot = path.join(recoveryRoot, 'archives');
  if (!fs.existsSync(importedRoot)) return [] as ImportedPortablePackage[];
  const results: ImportedPortablePackage[] = [];
  for (const entry of fs.readdirSync(importedRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^MCC_Master_Backup_/.test(entry.name)) continue;
    try {
      const validation = validatePortablePackage(path.join(importedRoot, entry.name), currentAppVersion);
      const archivePath = path.join(archivesRoot, `${entry.name}.zip`);
      if (!fs.existsSync(archivePath)) continue;
      const result = importedSummary(validation, archivePath, sha256FileSync(archivePath), false);
      const sidecarPath = path.join(importedRoot, `${entry.name}.import.json`);
      if (fs.existsSync(sidecarPath)) {
        try {
          const sidecar = JSON.parse(fs.readFileSync(sidecarPath, 'utf8')) as { importedAt?: unknown };
          if (typeof sidecar.importedAt === 'string' && !Number.isNaN(Date.parse(sidecar.importedAt))) result.importedAt = sidecar.importedAt;
        } catch {}
      }
      results.push(result);
    } catch {
      // Invalid packages remain on disk for administrator inspection but are never offered for restore.
    }
  }
  return results.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function normalizeRecoveryStoragePolicy(input: Partial<RecoveryStoragePolicy> = {}): RecoveryStoragePolicy {
  return {
    quotaBytes: positiveLimit(input.quotaBytes, DEFAULT_RECOVERY_QUOTA_BYTES),
    maxPackages: positiveLimit(input.maxPackages, DEFAULT_RECOVERY_MAX_PACKAGES),
  };
}

export function recoveryStorageStatus(recoveryRoot: string, input: Partial<RecoveryStoragePolicy> = {}): RecoveryStorageStatus {
  const policy = normalizeRecoveryStoragePolicy(input);
  const importedRoot = path.join(recoveryRoot, 'imported');
  const archivesRoot = path.join(recoveryRoot, 'archives');
  const packageNames = new Set<string>();
  if (fs.existsSync(importedRoot)) {
    for (const entry of fs.readdirSync(importedRoot, { withFileTypes: true })) if (entry.isDirectory() && PORTABLE_ROOT_PATTERN.test(entry.name)) packageNames.add(entry.name);
  }
  if (fs.existsSync(archivesRoot)) {
    for (const entry of fs.readdirSync(archivesRoot, { withFileTypes: true })) {
      if (entry.isFile() && PORTABLE_ARCHIVE_PATTERN.test(entry.name)) packageNames.add(entry.name.slice(0, -4));
    }
  }
  const usedBytes = directorySizeBytes(importedRoot) + directorySizeBytes(archivesRoot);
  return {
    ...policy,
    usedBytes,
    remainingBytes: Math.max(0, policy.quotaBytes - usedBytes),
    packageCount: packageNames.size,
    atCapacity: packageNames.size >= policy.maxPackages || usedBytes >= policy.quotaBytes,
  };
}

export function assertRecoveryStorageCapacity(recoveryRoot: string, requiredBytes: number, input: Partial<RecoveryStoragePolicy> = {}) {
  const status = recoveryStorageStatus(recoveryRoot, input);
  if (status.packageCount >= status.maxPackages) {
    throw new Error(`Recovery storage retention limit reached (${status.packageCount} of ${status.maxPackages} packages). Offload an older recovery package before importing another; MCC never silently deletes recovery packages.`);
  }
  const projected = status.usedBytes + Math.max(0, requiredBytes) + 1024 * 1024;
  if (projected > status.quotaBytes) {
    throw new Error(`Recovery storage quota would be exceeded (${formatBytes(status.usedBytes)} used; ${formatBytes(status.quotaBytes)} quota). Offload an older recovery package before importing another.`);
  }
  return status;
}

function directorySizeBytes(root: string) {
  if (!fs.existsSync(root)) return 0;
  let total = 0;
  function visit(current: string) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const candidate = path.join(current, entry.name);
      const stat = fs.lstatSync(candidate);
      if (stat.isSymbolicLink()) throw new Error('Recovery storage contains an unsupported symbolic link or junction.');
      if (entry.isDirectory()) visit(candidate);
      else if (entry.isFile()) total += stat.size;
      else throw new Error('Recovery storage contains an unsupported filesystem entry.');
    }
  }
  visit(root);
  return total;
}

export function importedPackagePath(recoveryRoot: string, id: unknown) {
  const clean = String(id ?? '').trim();
  if (!PORTABLE_ROOT_PATTERN.test(clean) || clean !== path.basename(clean)) throw new Error('Imported recovery package not found.');
  const root = path.resolve(recoveryRoot, 'imported');
  const resolved = path.resolve(root, clean);
  if (!isPathInside(root, resolved)) throw new Error('Imported recovery package not found.');
  return resolved;
}

export function validateExternalDestination(input: { destination: string; forbiddenRoots: string[]; requiredBytes?: number; create?: boolean }) {
  const raw = String(input.destination ?? '').trim();
  if (!raw || raw.includes('\0')) throw new Error('External backup destination is required.');
  if (!path.isAbsolute(raw)) throw new Error('External backup destination must be an absolute server path.');
  const destination = path.resolve(raw);
  const parsed = path.parse(destination);
  if (destination === parsed.root) throw new Error('A filesystem root is too broad to use as an external backup destination.');
  for (const forbidden of input.forbiddenRoots.map(value => path.resolve(value))) {
    if (pathsOverlap(destination, forbidden)) throw new Error('External backup destination cannot overlap MCC code or runtime storage.');
  }
  rejectLinkedExistingPath(destination);
  if (!fs.existsSync(destination)) {
    if (input.create === false) throw new Error('External backup destination does not exist.');
    fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  }
  if (!fs.statSync(destination).isDirectory()) throw new Error('External backup destination is not a directory.');
  const probe = path.join(destination, `.mcc-write-test-${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(probe, 'MCC external backup location test\n', { flag: 'wx', mode: 0o600 });
    const descriptor = fs.openSync(probe, 'r+');
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  } finally {
    if (fs.existsSync(probe)) fs.rmSync(probe, { force: true });
  }
  const freeBytes = availableBytes(destination);
  const requiredBytes = Math.max(0, Number(input.requiredBytes ?? 0));
  if (requiredBytes && freeBytes < requiredBytes) throw new Error(`External backup destination has insufficient free space (${formatBytes(freeBytes)} available; ${formatBytes(requiredBytes)} required).`);
  return { destination, freeBytes, writable: true, testedAt: new Date().toISOString() };
}

function rejectLinkedExistingPath(destination: string) {
  const parsed = path.parse(destination);
  const relative = path.relative(parsed.root, destination);
  let current = parsed.root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) break;
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error('External backup destination cannot traverse a symbolic link or junction.');
  }
}

export async function copyArchiveToExternal(input: { archivePath: string; destination: string; expectedSha256?: string }) {
  const filename = path.basename(input.archivePath);
  if (!PORTABLE_ARCHIVE_PATTERN.test(filename)) throw new Error('Portable archive filename is invalid.');
  const expectedSha256 = input.expectedSha256 ?? await sha256File(input.archivePath);
  const targetPath = path.join(input.destination, filename);
  if (fs.existsSync(targetPath)) {
    if (await sha256File(targetPath) === expectedSha256) return { targetPath, filename, sha256: expectedSha256, sizeBytes: fs.statSync(targetPath).size, copiedAt: new Date().toISOString(), alreadyPresent: true };
    throw new Error('External destination already contains a different backup with this filename.');
  }
  const temporaryPath = path.join(input.destination, `.${filename}.${crypto.randomUUID()}.partial`);
  try {
    await pipeline(fs.createReadStream(input.archivePath), fs.createWriteStream(temporaryPath, { flags: 'wx', mode: 0o600 }));
    const copiedSha256 = await sha256File(temporaryPath);
    if (copiedSha256 !== expectedSha256) throw new Error('External backup copy checksum verification failed.');
    fs.renameSync(temporaryPath, targetPath);
    return { targetPath, filename, sha256: copiedSha256, sizeBytes: fs.statSync(targetPath).size, copiedAt: new Date().toISOString(), alreadyPresent: false };
  } catch (error) {
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

async function copyFileVerified(source: string, target: string, expectedSha256: string) {
  await pipeline(fs.createReadStream(source), fs.createWriteStream(target, { flags: 'wx', mode: 0o600 }));
  if (await sha256File(target) !== expectedSha256) {
    fs.rmSync(target, { force: true });
    throw new Error('Local recovery archive copy checksum verification failed.');
  }
}

export function ensureAvailableSpace(targetPath: string, requiredBytes: number) {
  fs.mkdirSync(targetPath, { recursive: true });
  const freeBytes = availableBytes(targetPath);
  if (freeBytes < requiredBytes) throw new Error(`Recovery storage has insufficient free space (${formatBytes(freeBytes)} available; ${formatBytes(requiredBytes)} required).`);
  return freeBytes;
}

function availableBytes(targetPath: string) {
  const stats = fs.statfsSync(targetPath);
  return Number(stats.bavail) * Number(stats.bsize);
}

function pathsOverlap(left: string, right: string) {
  const a = normalizeComparisonPath(left);
  const b = normalizeComparisonPath(right);
  return a === b || a.startsWith(`${b}${path.sep}`) || b.startsWith(`${a}${path.sep}`);
}

function normalizeComparisonPath(value: string) {
  const resolved = path.resolve(value).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function safeRelativePath(value: string) {
  return Boolean(value) && !value.includes('\\') && !value.includes('\0') && !value.startsWith('/') && !/^[A-Za-z]:/.test(value) && value.split('/').every(segment => Boolean(segment) && segment !== '.' && segment !== '..');
}

function resolveInside(rootPath: string, relativePath: string) {
  if (!safeRelativePath(relativePath)) throw new Error(`Unsafe portable package path: ${relativePath}`);
  const root = path.resolve(rootPath);
  const resolved = path.resolve(root, ...relativePath.split('/'));
  if (!isPathInside(root, resolved)) throw new Error(`Unsafe portable package path: ${relativePath}`);
  return resolved;
}

function isPathInside(root: string, candidate: string) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return Boolean(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} bytes`;
}
