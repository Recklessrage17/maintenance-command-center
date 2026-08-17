import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { DatabaseSync } from 'node:sqlite';
import { ZipArchive, type ArchiverError } from 'archiver';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

export const PORTABLE_PACKAGE_VERSION = 1;
export const PORTABLE_SCHEMA_VERSION = 1;
export const PORTABLE_ZIP_MIME = 'application/zip';
export const DEFAULT_MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
export const DEFAULT_MAX_EXPANDED_BYTES = 4 * 1024 * 1024 * 1024;
export const DEFAULT_MAX_ARCHIVE_ENTRIES = 50_000;
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
  compressedSize: number;
  uncompressedSize: number;
  externalAttributes: number;
  directory: boolean;
};

type ArchiveInspection = {
  entries: CentralDirectoryEntry[];
  rootName: string;
  compressedSizeBytes: number;
  expandedSizeBytes: number;
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
    const exports = [
      { filename: 'MCC_Inventory.xlsx', tables: ['inventory_parts', 'inventory_locations'] },
      { filename: 'MCC_Vendors.xlsx', tables: ['inventory_vendors'] },
      { filename: 'MCC_Machine_List.xlsx', tables: ['machine_assets', 'machine_library', 'machines', 'machine_pms'] },
      { filename: 'MCC_Equipment_List.xlsx', tables: ['equipment_assets', 'equipment_library', 'equipment', 'equipment_pms'] },
      { filename: 'MCC_History.xlsx', tables: historyTables.length ? historyTables : ['history_logs'] },
    ];
    for (const item of exports) {
      await writeDatabaseWorkbook(database, path.join(excelRoot, item.filename), item.tables.filter(table => existing.has(table)));
    }
    return exports.map(item => `excel/${item.filename}`);
  } finally {
    database.close();
  }
}

async function writeDatabaseWorkbook(database: DatabaseSync, outputPath: string, tables: string[]) {
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
  if (!tables.length) {
    const sheet = workbook.addWorksheet('No records');
    sheet.columns = [{ header: 'Status', key: 'status', width: 70 }];
    styleStreamingHeader(sheet);
    sheet.addRow({ status: 'No applicable records were present in this database snapshot.' }).commit();
    sheet.commit();
  }
  for (const table of tables) {
    const columns = (database.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all() as Array<{ name: string }>).map(row => row.name);
    if (!columns.length) continue;
    const sheetName = uniqueSheetName(table, usedSheetNames);
    const sheet = workbook.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = columns.map(column => ({ header: column, key: column, width: Math.min(42, Math.max(12, column.length + 3)) }));
    styleStreamingHeader(sheet);
    let sourceRow = 1;
    const statement = database.prepare(`SELECT * FROM ${quoteIdentifier(table)} ORDER BY rowid`);
    for (const row of statement.iterate() as Iterable<Record<string, unknown>>) {
      sourceRow += 1;
      const output: Record<string, unknown> = {};
      for (const column of columns) {
        const value = excelValue(row[column]);
        if (typeof value === 'string' && value.length > EXCEL_CELL_LIMIT) {
          const reference = `OV-${++overflowSequence}`;
          output[column] = `[Full value in Oversized Values: ${reference}]`;
          const parts = splitText(value, EXCEL_CELL_LIMIT);
          parts.forEach((part, index) => overflow.addRow({ reference, sheet: sheetName, sourceRow, column, part: `${index + 1}/${parts.length}`, value: part }).commit());
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
  const buffer = fs.readFileSync(archivePath);
  const entries = parseCentralDirectory(buffer, limits.maxEntries);
  let expandedSizeBytes = 0;
  const names = new Set<string>();
  const roots = new Set<string>();
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
  return { entries, rootName, compressedSizeBytes: stat.size, expandedSizeBytes };
}

function parseCentralDirectory(buffer: Buffer, maxEntries: number) {
  const eocdSignature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const minimum = Math.max(0, buffer.length - 65_557);
  const eocdOffset = buffer.lastIndexOf(eocdSignature);
  if (eocdOffset < minimum || eocdOffset + 22 > buffer.length) throw new Error('Portable archive is corrupt or missing its central directory.');
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralSize = buffer.readUInt32LE(eocdOffset + 12);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) throw new Error('ZIP64 portable archives are not supported by this recovery version.');
  if (!entryCount || entryCount > maxEntries) throw new Error(`Portable archive entry count is invalid or exceeds ${maxEntries}.`);
  if (centralOffset + centralSize > eocdOffset || centralOffset < 0) throw new Error('Portable archive central directory is corrupt.');
  const entries: CentralDirectoryEntry[] = [];
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('Portable archive central directory entry is corrupt.');
    const flags = buffer.readUInt16LE(offset + 8);
    if (flags & 0x1) throw new Error('Encrypted portable archives are not supported.');
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const externalAttributes = buffer.readUInt32LE(offset + 38);
    const nextOffset = offset + 46 + nameLength + extraLength + commentLength;
    if (!nameLength || nextOffset > buffer.length) throw new Error('Portable archive contains an invalid central directory name.');
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString((flags & 0x800) ? 'utf8' : 'latin1');
    entries.push({ name, compressedSize, uncompressedSize, externalAttributes, directory: name.endsWith('/') });
    offset = nextOffset;
  }
  if (offset !== centralOffset + centralSize) throw new Error('Portable archive central directory length does not match its metadata.');
  return entries;
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
}) {
  const inspection = inspectPortableArchive(input.archivePath, input.limits);
  ensureAvailableSpace(input.recoveryRoot, inspection.compressedSizeBytes + inspection.expandedSizeBytes + 64 * 1024 * 1024);
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
    const archiveBuffer = fs.readFileSync(input.archivePath);
    const zip = await JSZip.loadAsync(archiveBuffer, { checkCRC32: true, createFolders: true });
    for (const entry of inspection.entries) {
      const target = resolveInside(stagingPath, entry.name.replace(/\/$/, ''));
      if (entry.directory) {
        fs.mkdirSync(target, { recursive: true });
        continue;
      }
      const zipEntry = zip.file(entry.name);
      if (!zipEntry) throw new Error(`Portable archive entry could not be read: ${entry.name}`);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      await pipeline(zipEntry.nodeStream(), fs.createWriteStream(target, { flags: 'wx', mode: 0o600 }));
      if (fs.statSync(target).size !== entry.uncompressedSize) throw new Error(`Portable archive entry size does not match its metadata: ${entry.name}`);
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
