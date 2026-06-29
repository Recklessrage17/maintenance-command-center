import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express, { type NextFunction, type Request, type Response } from 'express';
import ExcelJS from 'exceljs';
import multer from 'multer';
import nodemailer from 'nodemailer';
import { PDFDocument, type PDFFont, type PDFPage, StandardFonts, rgb } from 'pdf-lib';
import XlsxPopulate from 'xlsx-populate';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRootPath = path.resolve(__dirname, '../../..');
const rootEnvPath = path.join(repoRootPath, '.env');
if (fs.existsSync(rootEnvPath)) {
  dotenv.populate(process.env, dotenv.parse(fs.readFileSync(rootEnvPath)), { override: false });
}

const app = express();
const port = 4273;
const appName = 'Maintenance Command Center';
const version = '0.1.0';
const mit3Url = 'http://localhost:4173';
const mit3HealthUrl = `${mit3Url}/api/health`;
const mit3AppDataUrl = `${mit3Url}/api/app-data`;
const frontendDistPath = path.resolve(__dirname, '../../../frontend/dist');
const dataDir = path.resolve(__dirname, '../../data');
const backupsDir = path.resolve(__dirname, '../../backups');
const dbPath = path.join(dataDir, 'mcc.sqlite');
const isProd = process.env.NODE_ENV === 'production';
const sessionSecretConfigured = Boolean(process.env.SESSION_SECRET);
const smtpConfigured = Boolean(process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.SMTP_FROM);
const smtpPort = Number(process.env.SMTP_PORT ?? 587);
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(48).toString('hex');
fs.mkdirSync(dataDir, { recursive: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { files: 1, fileSize: 8 * 1024 * 1024 } });
app.use(express.json({ limit: '50kb' }));

type Role = 'Admin' | 'Manager' | 'Maintenance Tech 3' | 'Maintenance Tech 2' | 'Maintenance Tech 1';
const roles: Role[] = ['Maintenance Tech 1', 'Maintenance Tech 2', 'Maintenance Tech 3', 'Manager', 'Admin'];
const roleRank = (role: Role) => roles.indexOf(role);
const canManageRole = (actor: Role, target: Role) => roleRank(actor) >= roleRank(target);
const passwordOk = (p: string) => p.length >= 10 && /[A-Z]/.test(p) && /[a-z]/.test(p) && /\d/.test(p) && /[^A-Za-z0-9]/.test(p);
const now = () => new Date().toISOString();
const tempExpiry = () => new Date(Date.now() + 30 * 60 * 1000).toISOString();

let db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode=WAL;');

type SqlParam = string | number | bigint | Buffer | null;
function all<T>(sql: string, params: SqlParam[] = []): T[] { return db.prepare(sql).all(...params) as T[]; }
function one<T>(sql: string, params: SqlParam[] = []): T | undefined { return db.prepare(sql).get(...params) as T | undefined; }
function run(sql: string, params: SqlParam[] = []) { return db.prepare(sql).run(...params); }
function initDb() {
  db.exec(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE, role TEXT NOT NULL, password_hash TEXT NOT NULL, force_password_change INTEGER NOT NULL DEFAULT 0, disabled INTEGER NOT NULL DEFAULT 0, is_owner_admin INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0, deleted_at TEXT, deleted_by_user_id INTEGER, temp_password_expires_at TEXT, created_by_user_id INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_login_at TEXT);
CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_user_id INTEGER, actor_email TEXT, action TEXT NOT NULL, target_type TEXT, target_id TEXT, details_json TEXT, ip_address TEXT, user_agent TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS inventory_vendors (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'mcc', imported_from_mit3_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS inventory_locations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'mcc', imported_from_mit3_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS inventory_parts (id INTEGER PRIMARY KEY AUTOINCREMENT, mit3_item_id TEXT, part_number TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', location_id INTEGER, vendor_id INTEGER, quantity REAL NOT NULL DEFAULT 0, min_quantity REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT '', requisition TEXT NOT NULL DEFAULT '', part_info_url TEXT NOT NULL DEFAULT '', manufacturer_brand TEXT NOT NULL DEFAULT '', unit_cost REAL NOT NULL DEFAULT 0, supplier_part_number TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'mcc', imported_from_mit3_at TEXT, created_by_user_id INTEGER, updated_by_user_id INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, deleted_at TEXT, deleted_by_user_id INTEGER);
CREATE TABLE IF NOT EXISTS inventory_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_user_id INTEGER, action TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL, details_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS inventory_requisitions (id INTEGER PRIMARY KEY AUTOINCREMENT, requisition_number TEXT NOT NULL UNIQUE, inventory_part_id INTEGER NOT NULL, part_number TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', vendor_name TEXT NOT NULL DEFAULT '', location_name TEXT NOT NULL DEFAULT '', quantity_requested REAL NOT NULL DEFAULT 1, unit_cost REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'Requested', requested_by_user_id INTEGER, requested_by_name TEXT NOT NULL DEFAULT '', po_initiator TEXT NOT NULL DEFAULT '', requisitioned_by_name TEXT NOT NULL DEFAULT '', tax_exempt TEXT NOT NULL DEFAULT 'No', confirmed_with TEXT NOT NULL DEFAULT '', material_cert TEXT NOT NULL DEFAULT 'No', ship_via TEXT NOT NULL DEFAULT '', fob TEXT NOT NULL DEFAULT 'Destination', requested_at TEXT NOT NULL, ordered_by_user_id INTEGER, ordered_at TEXT, received_by_user_id INTEGER, received_at TEXT, canceled_by_user_id INTEGER, canceled_at TEXT, cancel_reason TEXT NOT NULL DEFAULT '', work_order_number TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, deleted_at TEXT, deleted_by_user_id INTEGER);
CREATE TABLE IF NOT EXISTS inventory_requisition_lines (id INTEGER PRIMARY KEY AUTOINCREMENT, requisition_id INTEGER NOT NULL, inventory_part_id INTEGER NOT NULL, part_number TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', vendor_name TEXT NOT NULL DEFAULT '', location_name TEXT NOT NULL DEFAULT '', quantity_requested REAL NOT NULL DEFAULT 1, unit_cost REAL NOT NULL DEFAULT 0, unit_of_measure TEXT NOT NULL DEFAULT 'EA', item_number TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, deleted_at TEXT, deleted_by_user_id INTEGER);
CREATE TABLE IF NOT EXISTS history_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, section TEXT NOT NULL, action TEXT NOT NULL, entity_type TEXT, entity_id TEXT, entity_label TEXT, work_order_number TEXT, part_number TEXT, requisition_number TEXT, asset_id TEXT, machine_name TEXT, equipment_name TEXT, location_name TEXT, vendor_name TEXT, old_value_json TEXT, new_value_json TEXT, quantity_before REAL, quantity_after REAL, quantity_delta REAL, reason_note TEXT, user_id INTEGER, user_name TEXT, user_email TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_inventory_parts_mit3_item_id ON inventory_parts (mit3_item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_parts_part_number ON inventory_parts (part_number COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_inventory_parts_deleted ON inventory_parts (deleted);
CREATE INDEX IF NOT EXISTS idx_inventory_vendors_name ON inventory_vendors (name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_inventory_locations_name ON inventory_locations (name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_inventory_requisitions_number ON inventory_requisitions (requisition_number COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_inventory_requisitions_part ON inventory_requisitions (inventory_part_id,status,deleted);
CREATE INDEX IF NOT EXISTS idx_inventory_requisitions_status ON inventory_requisitions (status,deleted);
CREATE INDEX IF NOT EXISTS idx_inventory_requisition_lines_req ON inventory_requisition_lines (requisition_id,deleted);
CREATE INDEX IF NOT EXISTS idx_inventory_requisition_lines_part ON inventory_requisition_lines (inventory_part_id,deleted);
CREATE INDEX IF NOT EXISTS idx_history_logs_section ON history_logs (section);
CREATE INDEX IF NOT EXISTS idx_history_logs_action ON history_logs (action);
CREATE INDEX IF NOT EXISTS idx_history_logs_created_at ON history_logs (created_at);
CREATE INDEX IF NOT EXISTS idx_history_logs_user_name ON history_logs (user_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_history_logs_work_order ON history_logs (work_order_number COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_history_logs_part_number ON history_logs (part_number COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_history_logs_requisition_number ON history_logs (requisition_number COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_history_logs_asset_id ON history_logs (asset_id COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_history_logs_entity_label ON history_logs (entity_label COLLATE NOCASE);`);
}
initDb();
function migrateDb() {
  const userColumns = new Set(all<{ name: string }>('PRAGMA table_info(users)').map(column => column.name));
  if (!userColumns.has('is_owner_admin')) run('ALTER TABLE users ADD COLUMN is_owner_admin INTEGER NOT NULL DEFAULT 0');
  if (!userColumns.has('deleted')) run('ALTER TABLE users ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0');
  if (!userColumns.has('deleted_at')) run('ALTER TABLE users ADD COLUMN deleted_at TEXT');
  if (!userColumns.has('deleted_by_user_id')) run('ALTER TABLE users ADD COLUMN deleted_by_user_id INTEGER');

  const inventoryPartColumns = new Set(all<{ name: string }>('PRAGMA table_info(inventory_parts)').map(column => column.name));
  if (!inventoryPartColumns.has('manufacturer_brand')) run("ALTER TABLE inventory_parts ADD COLUMN manufacturer_brand TEXT NOT NULL DEFAULT ''");
  if (!inventoryPartColumns.has('unit_cost')) run('ALTER TABLE inventory_parts ADD COLUMN unit_cost REAL NOT NULL DEFAULT 0');
  if (!inventoryPartColumns.has('supplier_part_number')) run("ALTER TABLE inventory_parts ADD COLUMN supplier_part_number TEXT NOT NULL DEFAULT ''");
  run('UPDATE inventory_parts SET unit_cost=0 WHERE unit_cost IS NULL');

  const requisitionColumns = new Set(all<{ name: string }>('PRAGMA table_info(inventory_requisitions)').map(column => column.name));
  if (!requisitionColumns.has('unit_cost')) run('ALTER TABLE inventory_requisitions ADD COLUMN unit_cost REAL NOT NULL DEFAULT 0');
  if (!requisitionColumns.has('po_initiator')) run("ALTER TABLE inventory_requisitions ADD COLUMN po_initiator TEXT NOT NULL DEFAULT ''");
  if (!requisitionColumns.has('requisitioned_by_name')) run("ALTER TABLE inventory_requisitions ADD COLUMN requisitioned_by_name TEXT NOT NULL DEFAULT ''");
  if (!requisitionColumns.has('tax_exempt')) run("ALTER TABLE inventory_requisitions ADD COLUMN tax_exempt TEXT NOT NULL DEFAULT 'No'");
  if (!requisitionColumns.has('confirmed_with')) run("ALTER TABLE inventory_requisitions ADD COLUMN confirmed_with TEXT NOT NULL DEFAULT ''");
  if (!requisitionColumns.has('material_cert')) run("ALTER TABLE inventory_requisitions ADD COLUMN material_cert TEXT NOT NULL DEFAULT 'No'");
  if (!requisitionColumns.has('ship_via')) run("ALTER TABLE inventory_requisitions ADD COLUMN ship_via TEXT NOT NULL DEFAULT ''");
  if (!requisitionColumns.has('fob')) run("ALTER TABLE inventory_requisitions ADD COLUMN fob TEXT NOT NULL DEFAULT 'Destination'");
  run('UPDATE inventory_requisitions SET unit_cost=0 WHERE unit_cost IS NULL');
  run("UPDATE inventory_requisitions SET requisitioned_by_name=requested_by_name WHERE (requisitioned_by_name IS NULL OR requisitioned_by_name='') AND requested_by_name<>''");
  run("UPDATE inventory_requisitions SET tax_exempt='No' WHERE tax_exempt IS NULL OR tax_exempt=''");
  run("UPDATE inventory_requisitions SET material_cert='No' WHERE material_cert IS NULL OR material_cert=''");
  run("UPDATE inventory_requisitions SET fob='Destination' WHERE fob IS NULL OR fob=''");
  db.exec(`CREATE TABLE IF NOT EXISTS inventory_requisition_lines (id INTEGER PRIMARY KEY AUTOINCREMENT, requisition_id INTEGER NOT NULL, inventory_part_id INTEGER NOT NULL, part_number TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', vendor_name TEXT NOT NULL DEFAULT '', location_name TEXT NOT NULL DEFAULT '', quantity_requested REAL NOT NULL DEFAULT 1, unit_cost REAL NOT NULL DEFAULT 0, unit_of_measure TEXT NOT NULL DEFAULT 'EA', item_number TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, deleted_at TEXT, deleted_by_user_id INTEGER);
CREATE INDEX IF NOT EXISTS idx_inventory_requisition_lines_req ON inventory_requisition_lines (requisition_id,deleted);
CREATE INDEX IF NOT EXISTS idx_inventory_requisition_lines_part ON inventory_requisition_lines (inventory_part_id,deleted);`);

  const existingOwner = one<{ id: number }>('SELECT id FROM users WHERE is_owner_admin=1 ORDER BY id LIMIT 1');
  if (existingOwner) {
    run('UPDATE users SET is_owner_admin=0 WHERE id<>?', [existingOwner.id]);
    run("UPDATE users SET role='Admin', disabled=0, deleted=0, deleted_at=NULL, deleted_by_user_id=NULL WHERE id=?", [existingOwner.id]);
    return;
  }

  const oldestAdmin = one<{ id: number }>("SELECT id FROM users WHERE role='Admin' AND deleted=0 ORDER BY created_at ASC, id ASC LIMIT 1");
  if (oldestAdmin) run("UPDATE users SET is_owner_admin=1, role='Admin', disabled=0 WHERE id=?", [oldestAdmin.id]);
}
migrateDb();

interface User { id:number; full_name:string; email:string; role:Role; password_hash:string; force_password_change:number; disabled:number; is_owner_admin:number; deleted:number; deleted_at?:string; deleted_by_user_id?:number; temp_password_expires_at?:string; created_by_user_id?:number; created_at:string; updated_at:string; last_login_at?:string }
interface AuthRequest extends Request { user?: User; sessionId?: string }
const publicUser = (u: User) => ({ id:u.id, fullName:u.full_name, email:u.email, role:u.role, isOwnerAdmin:!!u.is_owner_admin, forcePasswordChange:!!u.force_password_change, disabled:!!u.disabled, createdByUserId:u.created_by_user_id ?? null, createdAt:u.created_at, updatedAt:u.updated_at, lastLoginAt:u.last_login_at ?? null });
const userCount = () => one<{count:number}>('SELECT COUNT(*) as count FROM users WHERE deleted=0')?.count ?? 0;
const findUserByEmail = (email: string) => one<User>('SELECT * FROM users WHERE deleted=0 AND lower(email)=lower(?)', [email.trim()]);
const findUserById = (id: number) => one<User>('SELECT * FROM users WHERE deleted=0 AND id=?', [Number(id)]);

function hashPassword(password: string) { const salt = crypto.randomBytes(16).toString('hex'); const hash = crypto.scryptSync(password, salt, 64).toString('hex'); return `scrypt$${salt}$${hash}`; }
function verifyPassword(password: string, stored: string) { const [, salt, hash] = stored.split('$'); const candidate = crypto.scryptSync(password, salt, 64); return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), candidate); }
function sign(id: string) { return `${id}.${crypto.createHmac('sha256', sessionSecret).update(id).digest('hex')}`; }
function unsign(cookie?: string) { if (!cookie) return; const [id, sig] = cookie.split('.'); if (!id || !sig) return; return sign(id) === cookie ? id : undefined; }
function cookie(req: Request, name: string) { return req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith(`${name}=`))?.split('=').slice(1).join('='); }
function setSession(res: Response, userId: number) { const id = crypto.randomBytes(32).toString('hex'); const exp = new Date(Date.now()+8*60*60*1000).toISOString(); run('INSERT INTO sessions (id,user_id,expires_at,created_at) VALUES (?,?,?,?)', [id,userId,exp,now()]); res.cookie('mcc_session', sign(id), { httpOnly:true, sameSite:'lax', secure:isProd, maxAge:8*60*60*1000, path:'/' }); }
function clearSession(req: AuthRequest, res: Response) { if (req.sessionId) run('DELETE FROM sessions WHERE id=?', [req.sessionId]); res.clearCookie('mcc_session', { path: '/' }); }
function audit(req: Request, action: string, targetType?: string, targetId?: string|number, details: Record<string, unknown> = {}) { const u = (req as AuthRequest).user; run('INSERT INTO audit_log (actor_user_id,actor_email,action,target_type,target_id,details_json,ip_address,user_agent,created_at) VALUES (?,?,?,?,?,?,?,?,?)', [u?.id ?? null,u?.email ?? '',action,targetType ?? '',String(targetId ?? ''),JSON.stringify(details),req.ip ?? '',req.get('user-agent') ?? '',now()]); auditWriteBackup(req, action); }
function shouldScheduleMasterBackupFromAudit(action: string) {
  const value = action.toLowerCase();
  if (value.startsWith('failed ') || value.includes(' login') || value === 'login' || value === 'logout') return false;
  if (value.includes('export') || value.includes('pdf') || value.includes('backup') || value.includes('restore')) return false;
  return value.startsWith('user ')
    || value.startsWith('password change')
    || value.startsWith('password reset')
    || value.includes('inventory native')
    || value.includes('inventory import')
    || value.includes('import from mit3')
    || (value.includes('requisition') && !value.includes('previewed'));
}
function auditWriteBackup(req: Request, action: string) {
  if (shouldScheduleMasterBackupFromAudit(action)) scheduleAutoBackup(`audit:${action}`, (req as AuthRequest).user ?? null);
}
type HistorySection = 'inventory' | 'requisitions' | 'machine_library' | 'equipment_library' | 'facility_info' | 'preventive_maintenance';
type HistoryLogInput = {
  section: HistorySection;
  action: string;
  entityType?: string;
  entityId?: string | number;
  entityLabel?: string;
  workOrderNumber?: string;
  partNumber?: string;
  requisitionNumber?: string;
  assetId?: string;
  machineName?: string;
  equipmentName?: string;
  locationName?: string;
  vendorName?: string;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  quantityBefore?: number | null;
  quantityAfter?: number | null;
  quantityDelta?: number | null;
  reasonNote?: string;
  actor?: User | null;
  createdAt?: string;
};
type HistoryLogRow = {
  id: number;
  section: HistorySection;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  entity_label: string | null;
  work_order_number: string | null;
  part_number: string | null;
  requisition_number: string | null;
  asset_id: string | null;
  machine_name: string | null;
  equipment_name: string | null;
  location_name: string | null;
  vendor_name: string | null;
  old_value_json: string | null;
  new_value_json: string | null;
  quantity_before: number | null;
  quantity_after: number | null;
  quantity_delta: number | null;
  reason_note: string | null;
  user_id: number | null;
  user_name: string | null;
  user_email: string | null;
  created_at: string;
};
const historySections: HistorySection[] = ['inventory','requisitions','machine_library','equipment_library','facility_info','preventive_maintenance'];
const historySectionLabels: Record<HistorySection, string> = {
  inventory: 'Inventory',
  requisitions: 'Requisitions',
  machine_library: 'Machine Library',
  equipment_library: 'Equipment Library',
  facility_info: 'Facility Info',
  preventive_maintenance: 'Preventive Maintenance',
};
function historyString(value: unknown, maxLength = 240) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}
function historyJson(value: Record<string, unknown> | null | undefined) {
  if (!value) return null;
  return JSON.stringify(value);
}
function recordHistoryLog(input: HistoryLogInput) {
  const actor = input.actor ?? null;
  run(`INSERT INTO history_logs (section,action,entity_type,entity_id,entity_label,work_order_number,part_number,requisition_number,asset_id,machine_name,equipment_name,location_name,vendor_name,old_value_json,new_value_json,quantity_before,quantity_after,quantity_delta,reason_note,user_id,user_name,user_email,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
    input.section,
    historyString(input.action, 80),
    historyString(input.entityType, 80),
    historyString(input.entityId, 120),
    historyString(input.entityLabel, 240),
    historyString(input.workOrderNumber, 160),
    historyString(input.partNumber, 160),
    historyString(input.requisitionNumber, 160),
    historyString(input.assetId, 160),
    historyString(input.machineName, 160),
    historyString(input.equipmentName, 160),
    historyString(input.locationName, 160),
    historyString(input.vendorName, 160),
    historyJson(input.oldValue),
    historyJson(input.newValue),
    input.quantityBefore ?? null,
    input.quantityAfter ?? null,
    input.quantityDelta ?? null,
    historyString(input.reasonNote, 1200),
    actor?.id ?? null,
    actor?.full_name ?? '',
    actor?.email ?? '',
    input.createdAt ?? now(),
  ]);
}
function requiredReasonNote(value: unknown, label: string) {
  const reason = String(value ?? '').trim();
  if (!reason) throw new Error(`${label} reason is required.`);
  return reason.slice(0, 1200);
}
function createUser(input: {fullName:string; email:string; role:Role; password:string; force?: boolean; owner?: boolean; createdBy?: number|null}) { const t=now(); const result = run('INSERT INTO users (full_name,email,role,password_hash,force_password_change,is_owner_admin,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)', [input.fullName,input.email,input.role,hashPassword(input.password),input.force?1:0,input.owner?1:0,input.createdBy ?? null,t,t]); return Number(result.lastInsertRowid); }
const loginHits = new Map<string, number[]>(), forgotHits = new Map<string, number[]>();
function limited(map: Map<string, number[]>, key: string, max: number, windowMs: number) { const t=Date.now(); const a=(map.get(key)??[]).filter(x=>t-x<windowMs); a.push(t); map.set(key,a); return a.length>max; }
function canUserManage(actor: User) { return actor.role !== 'Maintenance Tech 1'; }
function canEditTarget(actor: User, target: User) { return canUserManage(actor) && !target.is_owner_admin && !target.deleted && canManageRole(actor.role, target.role); }
function canToggleDisabledTarget(actor: User, target: User) { return canEditTarget(actor, target) && actor.id !== target.id; }
function canDeleteTarget(actor: User, target: User) { return canEditTarget(actor, target) && actor.id !== target.id; }
function publicUserForActor(u: User, actor: User) {
  return {
    ...publicUser(u),
    canEdit: canEditTarget(actor, u),
    canDisable: canToggleDisabledTarget(actor, u),
    canDelete: canDeleteTarget(actor, u),
  };
}
function safeErrorMessage(error: unknown, extraSecrets: string[] = [], fallback = 'Unknown error.') {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of [process.env.SMTP_PASS, ...extraSecrets]) {
    if (secret) message = message.split(secret).join('[redacted]');
  }
  return message.replace(/\s+/g, ' ').slice(0, 300) || fallback;
}
function safeBackupClientError(error: unknown, fallback = 'Backup failed.') {
  const message = safeErrorMessage(error, [], fallback);
  if (/already running/i.test(message)) return 'Another backup is already running.';
  if (/permission denied/i.test(message)) return 'Permission denied.';
  return fallback;
}
function smtpTransport() {
  if (!smtpConfigured) return undefined;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST!,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: {
      user: process.env.SMTP_USER!,
      pass: process.env.SMTP_PASS!,
    },
  });
}
async function sendResetEmail(user: User, temporaryPassword: string, expiresAt: string) {
  const transporter = smtpTransport();
  if (!transporter) throw new Error('SMTP is not configured.');
  const info = await transporter.sendMail({
    from: process.env.SMTP_FROM!,
    to: user.email,
    subject: 'MCC password reset',
    text: [
      'A temporary password was created for your Maintenance Command Center account.',
      '',
      `Temporary password: ${temporaryPassword}`,
      `Expires: ${expiresAt}`,
      '',
      'After logging in, you will be required to choose a new password.',
      'If you did not request this reset, contact an MCC administrator.',
    ].join('\n'),
  });
  return info.messageId;
}
function detectedLanUrls() {
  const urls = new Set<string>();
  for (const [name, interfaces] of Object.entries(os.networkInterfaces())) {
    if (isVirtualNetworkInterface(name)) continue;
    for (const entry of interfaces ?? []) {
      if (entry.family === 'IPv4' && !entry.internal && isUsableLanIpv4(entry.address)) urls.add(`http://${entry.address}:${port}`);
    }
  }
  return [...urls];
}
function isVirtualNetworkInterface(name: string) {
  return /docker|hyper-v|loopback|npcap|virtual|virtualbox|vmware|vEthernet|wsl/i.test(name);
}
function isUsableLanIpv4(address: string) {
  if (address === '127.0.0.1' || address.startsWith('127.') || address.startsWith('169.254.')) return false;
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(address);
}
async function checkMit3Status() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(mit3HealthUrl, { signal: controller.signal });
    return {
      ok: response.ok,
      mit3Url,
      healthUrl: mit3HealthUrl,
      message: response.ok ? 'MIT3 online' : 'MIT3 offline or not reachable',
    };
  } catch {
    return {
      ok: false,
      mit3Url,
      healthUrl: mit3HealthUrl,
      message: 'MIT3 offline or not reachable',
    };
  } finally {
    clearTimeout(timeout);
  }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
function textField(record: Record<string, unknown>, keys: string[], fallback = '') {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return fallback;
}
function numberField(record: Record<string, unknown>, keys: string[], fallback = 0) {
  for (const key of keys) {
    const value = record[key];
    const parsed = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}
function booleanField(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (value === true || value === 1 || String(value).toLowerCase() === 'true') return true;
  }
  return false;
}
function validWebUrl(value: string) {
  const raw = value.trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    const localHost = host === 'localhost' || host === '[::1]' || host === '::1' || host === '0.0.0.0' || host.startsWith('127.') || host.endsWith('.local');
    return (url.protocol === 'http:' || url.protocol === 'https:') && !localHost ? url.toString() : '';
  } catch {
    return '';
  }
}
function lookupName(records: unknown[], id: string) {
  if (!id) return '';
  for (const record of records) {
    if (!isRecord(record)) continue;
    if (textField(record, ['id']) === id) return textField(record, ['name', 'title', 'label'], id);
  }
  return id;
}
function itemStatus(item: Record<string, unknown>, quantity: number, minQuantity: number) {
  if (booleanField(item, ['nonStocked', 'non_stocked'])) return 'Order As Needed';
  if (quantity <= 0) return 'Out of Stock';
  const alertLevel = numberField(item, ['lowStockAlertLevel', 'low_stock_alert_level', 'lowStockAlert', 'low_alert'], minQuantity);
  if (alertLevel > 0 && quantity <= alertLevel) return 'Low Stock';
  return 'In Stock';
}
function activeRequisitionByItem(data: Record<string, unknown>) {
  const map = new Map<string, string>();
  const records = Array.isArray(data.requisitionMadeRecords) ? data.requisitionMadeRecords : [];
  for (const record of records) {
    if (!isRecord(record)) continue;
    const status = textField(record, ['status'], 'Requisition Made');
    const inactive = /completed|cancelled|canceled|archived|history/i.test(status);
    if (inactive) continue;
    const label = textField(record, ['id']) ? `${status} (${textField(record, ['id'])})` : status;
    for (const itemId of Array.isArray(record.itemIds) ? record.itemIds : []) {
      if (itemId !== undefined && itemId !== null) map.set(String(itemId), label);
    }
  }
  return map;
}
function normalizeMit3Parts(payload: unknown) {
  const root = isRecord(payload) ? payload : {};
  const data = isRecord(root.data) ? root.data : root;
  const items = Array.isArray(data.items) ? data.items : [];
  const locations = Array.isArray(data.locations) ? data.locations : [];
  const vendors = Array.isArray(data.vendors) ? data.vendors : [];
  const requisitions = activeRequisitionByItem(data);
  return items.filter(isRecord).map((item, index) => {
    const mit3ItemId = textField(item, ['itemId', 'item_id', 'id']);
    const id = mit3ItemId || `mit3-item-${index + 1}`;
    const itemId = mit3ItemId || id;
    const partNumber = textField(item, ['partNumber', 'part_number', 'partNo', 'sku']);
    const quantity = numberField(item, ['quantityOnHand', 'stockOnHand', 'stock_on_hand', 'quantity', 'qty']);
    const minQuantity = numberField(item, ['minimumStockLevel', 'minimum', 'minimumStock', 'minQuantity', 'min']);
    const locationId = textField(item, ['locationId', 'location_id']);
    const vendorId = textField(item, ['vendorId', 'vendor_id']);
    const orderPlaced = booleanField(item, ['orderPlaced', 'order_placed']);
    const activeRequisition = requisitions.get(id) ?? requisitions.get(itemId) ?? '';
    const directRequisition = orderPlaced ? textField(item, ['orderRequisitionId', 'order_requisition_id'], 'Requisition Made') : '';
    const rawPartInfoUrl = textField(item, ['itemUrl', 'item_url', 'partInfoUrl', 'url']);
    return {
      id,
      itemId,
      mit3ItemId,
      partNumber,
      description: textField(item, ['description', 'name', 'itemName', 'item_name'], partNumber || id),
      location: textField(item, ['location', 'locationName'], lookupName(locations, locationId)),
      vendor: textField(item, ['vendor', 'vendorName'], lookupName(vendors, vendorId)),
      quantity,
      minQuantity,
      status: itemStatus(item, quantity, minQuantity),
      requisition: activeRequisition || directRequisition,
      orderPlaced,
      hasActiveRequisitionRecord: Boolean(activeRequisition),
      partInfoUrl: validWebUrl(rawPartInfoUrl),
      rawPartInfoUrl,
      manufacturerBrand: textField(item, ['manufacturerBrand','manufacturer_brand','manufacturer','brand','make']),
      unitCost: numberField(item, ['unitCost','unit_cost','cost','price','unitPrice','unit_price','estimatedCost','estimated_cost'], NaN),
      supplierPartNumber: textField(item, ['supplierPartNumber','supplier_part_number','vendorPartNumber','vendor_part_number','supplierSku','supplier_sku','manufacturerPartNumber','manufacturer_part_number']),
      notes: textField(item, ['notes', 'note']),
      updatedAt: textField(item, ['updatedAt', 'updated_at'], textField(data, ['lastSavedAt'])),
    };
  });
}
function normalizeMit3LookupOptions(records: unknown[]) {
  return records.filter(isRecord).map(record => ({
    id: textField(record, ['id']),
    name: textField(record, ['name', 'title', 'label']),
  })).filter(record => record.id && record.name);
}
function normalizeMit3InventoryPayload(payload: unknown) {
  const root = isRecord(payload) ? payload : {};
  const data = isRecord(root.data) ? root.data : root;
  return {
    parts: normalizeMit3Parts(data),
    locations: normalizeMit3LookupOptions(Array.isArray(data.locations) ? data.locations : []),
    vendors: normalizeMit3LookupOptions(Array.isArray(data.vendors) ? data.vendors : []),
  };
}
async function fetchMit3AppData() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(mit3AppDataUrl, { signal: controller.signal });
    if (!response.ok) throw new Error(`MIT3 app-data returned HTTP ${response.status}`);
    const payload = await response.json();
    const root = isRecord(payload) ? payload : {};
    const data = isRecord(root.data) ? root.data : root;
    if (!isRecord(data) || data.app !== 'maintenance-inventory-tracker') throw new Error('MIT3 app-data shape is not supported.');
    return data;
  } catch {
    throw new Error('MIT3 is offline or not reachable. Start MIT3 Website first.');
  } finally {
    clearTimeout(timeout);
  }
}
async function fetchMit3Inventory() {
  return normalizeMit3InventoryPayload(await fetchMit3AppData());
}

type NormalizedMit3Part = ReturnType<typeof normalizeMit3Parts>[number];
type NativeLookupTable = 'inventory_vendors' | 'inventory_locations';
type NativePartFilter = 'all' | 'low' | 'requisition';
interface NativePartRow {
  id: number;
  mit3_item_id: string | null;
  part_number: string;
  description: string;
  location_id: number | null;
  vendor_id: number | null;
  quantity: number;
  min_quantity: number;
  status: string;
  requisition: string;
  part_info_url: string;
  manufacturer_brand: string;
  unit_cost: number | null;
  supplier_part_number: string;
  notes: string;
  source: string;
  imported_from_mit3_at: string | null;
  created_at: string;
  updated_at: string;
  location_name: string | null;
  vendor_name: string | null;
}
function inventoryAudit(req: Request, action: string, targetType: string, targetId: string|number, details: Record<string, unknown> = {}) {
  const u = (req as AuthRequest).user;
  run('INSERT INTO inventory_audit (actor_user_id,action,target_type,target_id,details_json,created_at) VALUES (?,?,?,?,?,?)', [u?.id ?? null,action,targetType,String(targetId ?? ''),JSON.stringify(details),now()]);
}
function queryText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}
function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, match => `\\${match}`);
}
function getOrCreateNativeLookup(table: NativeLookupTable, name: string, timestamp: string) {
  const cleanName = name.trim();
  if (!cleanName) return { id: null as number | null, created: false };
  const existing = one<{ id: number }>(`SELECT id FROM ${table} WHERE deleted=0 AND lower(name)=lower(?) ORDER BY id LIMIT 1`, [cleanName]);
  if (existing) {
    run(`UPDATE ${table} SET source=?, imported_from_mit3_at=?, updated_at=? WHERE id=?`, ['MIT3 HTTP API',timestamp,timestamp,existing.id]);
    return { id: existing.id, created: false };
  }
  const result = run(`INSERT INTO ${table} (name,source,imported_from_mit3_at,created_at,updated_at,deleted) VALUES (?,?,?,?,?,0)`, [cleanName,'MIT3 HTTP API',timestamp,timestamp,timestamp]);
  return { id: Number(result.lastInsertRowid), created: true };
}
function getOrCreateMccNativeLookup(req: Request, table: NativeLookupTable, name: string, timestamp: string) {
  const cleanName = name.trim();
  if (!cleanName) return { id: null as number | null, created: false };
  const existing = one<{ id: number }>(`SELECT id FROM ${table} WHERE deleted=0 AND lower(name)=lower(?) ORDER BY id LIMIT 1`, [cleanName]);
  if (existing) return { id: existing.id, created: false };
  const result = run(`INSERT INTO ${table} (name,source,imported_from_mit3_at,created_at,updated_at,deleted) VALUES (?,?,?,?,?,0)`, [cleanName,'mcc',null,timestamp,timestamp]);
  const id = Number(result.lastInsertRowid);
  const isVendor = table === 'inventory_vendors';
  inventoryAudit(req,isVendor ? 'vendor auto-create' : 'location auto-create',isVendor ? 'vendor' : 'location',id,{name:cleanName});
  audit(req,isVendor ? 'inventory vendor auto-create' : 'inventory location auto-create',isVendor ? 'inventory_vendor' : 'inventory_location',id,{name:cleanName});
  return { id, created: true };
}
function findNativePart(mit3ItemId: string, partNumber: string) {
  if (mit3ItemId) {
    const mit3Match = one<{ id: number }>('SELECT id FROM inventory_parts WHERE deleted=0 AND mit3_item_id=? ORDER BY id LIMIT 1', [mit3ItemId]);
    if (mit3Match) return mit3Match;
  }
  if (partNumber) {
    return one<{ id: number }>('SELECT id FROM inventory_parts WHERE deleted=0 AND lower(part_number)=lower(?) ORDER BY id LIMIT 1', [partNumber]);
  }
  return undefined;
}
function normalizeNativePart(row: NativePartRow) {
  const activeRequisition = activeRequisitionForPart(row.id);
  return {
    id: String(row.id),
    itemId: row.mit3_item_id || String(row.id),
    partNumber: row.part_number,
    description: row.description,
    location: row.location_name ?? '',
    vendor: row.vendor_name ?? '',
    quantity: Number(row.quantity ?? 0),
    minQuantity: Number(row.min_quantity ?? 0),
    status: row.status,
    requisition: activeRequisition?.status ?? row.requisition,
    orderPlaced: Boolean(activeRequisition || row.requisition),
    hasActiveRequisitionRecord: Boolean(activeRequisition),
    activeRequisitionNumber: activeRequisition?.requisition_number ?? '',
    partInfoUrl: validWebUrl(row.part_info_url),
    manufacturerBrand: row.manufacturer_brand ?? '',
    unitCost: Number(row.unit_cost ?? 0),
    supplierPartNumber: row.supplier_part_number ?? '',
    updatedAt: row.updated_at,
    source: row.source,
    importedFromMit3At: row.imported_from_mit3_at ?? '',
  };
}
function nativePartRowById(id: number) {
  return one<NativePartRow>(`SELECT p.*, l.name AS location_name, v.name AS vendor_name
FROM inventory_parts p
LEFT JOIN inventory_locations l ON l.id=p.location_id AND l.deleted=0
LEFT JOIN inventory_vendors v ON v.id=p.vendor_id AND v.deleted=0
WHERE p.deleted=0 AND p.id=?`, [id]);
}
function nativePartById(id: number) {
  const row = nativePartRowById(id);
  return row ? normalizeNativePart(row) : undefined;
}
function nativePartHistoryValue(row: NativePartRow | (NativePartInput & { location_name?: string | null; vendor_name?: string | null })) {
  return {
    partNumber: 'part_number' in row ? row.part_number : row.partNumber,
    description: row.description,
    location: 'location_name' in row ? row.location_name ?? '' : row.location,
    vendor: 'vendor_name' in row ? row.vendor_name ?? '' : row.vendor,
    quantity: Number(row.quantity ?? 0),
    minQuantity: 'min_quantity' in row ? Number(row.min_quantity ?? 0) : row.minQuantity,
    status: row.status,
    unitCost: 'unit_cost' in row ? Number(row.unit_cost ?? 0) : row.unitCost,
    manufacturerBrand: 'manufacturer_brand' in row ? row.manufacturer_brand ?? '' : row.manufacturerBrand,
    supplierPartNumber: 'supplier_part_number' in row ? row.supplier_part_number ?? '' : row.supplierPartNumber,
  };
}
function recordInventoryPartHistory(input: { action: string; actor: User; partId: number; row?: NativePartRow; oldValue?: Record<string, unknown> | null; newValue?: Record<string, unknown> | null; quantityBefore?: number | null; quantityAfter?: number | null; reasonNote?: string }) {
  const row = input.row ?? nativePartRowById(input.partId);
  recordHistoryLog({
    section: 'inventory',
    action: input.action,
    entityType: 'inventory_part',
    entityId: input.partId,
    entityLabel: row?.part_number ?? String(input.partId),
    partNumber: row?.part_number ?? '',
    locationName: row?.location_name ?? '',
    vendorName: row?.vendor_name ?? '',
    oldValue: input.oldValue,
    newValue: input.newValue,
    quantityBefore: input.quantityBefore,
    quantityAfter: input.quantityAfter,
    quantityDelta: input.quantityBefore === null || input.quantityBefore === undefined || input.quantityAfter === null || input.quantityAfter === undefined ? null : input.quantityAfter - input.quantityBefore,
    reasonNote: input.reasonNote,
    actor: input.actor,
  });
}
function nativeParts(search = '', filter: NativePartFilter = 'all') {
  const where = ['p.deleted=0'];
  const params: SqlParam[] = [];
  const needle = search.trim();
  if (needle) {
    const like = `%${escapeLike(needle)}%`;
    where.push('(p.part_number LIKE ? ESCAPE \'\\\' COLLATE NOCASE OR p.description LIKE ? ESCAPE \'\\\' COLLATE NOCASE OR l.name LIKE ? ESCAPE \'\\\' COLLATE NOCASE OR v.name LIKE ? ESCAPE \'\\\' COLLATE NOCASE)');
    params.push(like,like,like,like);
  }
  if (filter === 'low') where.push("(p.status IN ('Low Stock','Out of Stock') OR (p.min_quantity > 0 AND p.quantity <= p.min_quantity))");
  if (filter === 'requisition') where.push("p.requisition<>''");
  return all<NativePartRow>(`SELECT p.*, l.name AS location_name, v.name AS vendor_name
FROM inventory_parts p
LEFT JOIN inventory_locations l ON l.id=p.location_id AND l.deleted=0
LEFT JOIN inventory_vendors v ON v.id=p.vendor_id AND v.deleted=0
WHERE ${where.join(' AND ')}
ORDER BY p.part_number COLLATE NOCASE, p.description COLLATE NOCASE, p.id`, params).map(normalizeNativePart);
}
const nativeExportHeaders = ['MCC Item ID','Part Number','Description','Location','Vendor','Quantity','Minimum Quantity','Requisition','Part Info URL','Manufacturer/Brand','Unit Cost','Supplier Part Number','Notes'] as const;
const nativeBlankImportHeaders = nativeExportHeaders.filter(header => header !== 'MCC Item ID');
type NativeExportHeader = typeof nativeExportHeaders[number];
type NativeExportRecord = Record<NativeExportHeader, string | number>;
type NativeImportCell = { text: string; hyperlink: string };
type NativeImportRow = {
  rowNumber: number;
  mccItemId: string;
  partNumber: string;
  description: string;
  location: string;
  vendor: string;
  quantity: string;
  minQuantity: string;
  requisition: string;
  partInfoUrl: string;
  manufacturerBrand: string;
  unitCost: string;
  supplierPartNumber: string;
  notes: string;
};
type NativeImportSummary = {
  addedCount: number;
  updatedCount: number;
  skippedCount: number;
  vendorCreatedCount: number;
  locationCreatedCount: number;
  invalidUrlCount: number;
  errors: string[];
};
function nativeInventoryRows() {
  return all<NativePartRow>(`SELECT p.*, l.name AS location_name, v.name AS vendor_name
FROM inventory_parts p
LEFT JOIN inventory_locations l ON l.id=p.location_id AND l.deleted=0
LEFT JOIN inventory_vendors v ON v.id=p.vendor_id AND v.deleted=0
WHERE p.deleted=0
ORDER BY p.part_number COLLATE NOCASE, p.description COLLATE NOCASE, p.id`);
}
function nativeExportRecord(row: NativePartRow): NativeExportRecord {
  return {
    'MCC Item ID': row.id,
    'Part Number': row.part_number,
    Description: row.description,
    Location: row.location_name ?? '',
    Vendor: row.vendor_name ?? '',
    Quantity: Number(row.quantity ?? 0),
    'Minimum Quantity': Number(row.min_quantity ?? 0),
    Requisition: row.requisition,
    'Part Info URL': validWebUrl(row.part_info_url),
    'Manufacturer/Brand': row.manufacturer_brand ?? '',
    'Unit Cost': Number(row.unit_cost ?? 0),
    'Supplier Part Number': row.supplier_part_number ?? '',
    Notes: row.notes,
  };
}
function csvCell(value: string | number) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
function csvFromRecords(headers: readonly string[], records: NativeExportRecord[]) {
  const lines = [headers.map(csvCell).join(',')];
  for (const record of records) lines.push(headers.map(header => csvCell(record[header as NativeExportHeader] ?? '')).join(','));
  return `${lines.join('\r\n')}\r\n`;
}
function downloadDateStamp() {
  return new Date().toISOString().slice(0, 10);
}
function backupFileStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}
function sendDownload(res: Response, fileName: string, contentType: string, content: string | Buffer) {
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.send(content);
}
function styleInventorySheet(sheet: ExcelJS.Worksheet) {
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { vertical: 'middle' };
  sheet.columns.forEach(column => {
    let maxLength = 12;
    column.eachCell?.({ includeEmpty: true }, cell => {
      maxLength = Math.max(maxLength, String(cell.text ?? '').length + 2);
    });
    column.width = Math.min(Math.max(maxLength, 12), 42);
  });
}
async function workbookBuffer(sheetName: string, headers: readonly string[], records: NativeExportRecord[]) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = appName;
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.addRow([...headers]);
  const urlColumnIndex = headers.findIndex(header => isPartInfoUrlHeader(header)) + 1;
  for (const record of records) {
    const row = sheet.addRow(headers.map(header => record[header as NativeExportHeader] ?? ''));
    if (urlColumnIndex > 0) {
      const url = validWebUrl(String(record['Part Info URL'] ?? ''));
      if (url) {
        row.getCell(urlColumnIndex).value = { text: url, hyperlink: url };
        row.getCell(urlColumnIndex).font = { color: { argb: 'FF0563C1' }, underline: true };
      }
    }
  }
  styleInventorySheet(sheet);
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer as ArrayBuffer);
}
function backupInfo(filePath: string) {
  const stat = fs.statSync(filePath);
  const extension = path.extname(filePath).toLowerCase();
  return {
    fileName: path.basename(filePath),
    createdTime: stat.birthtime.toISOString(),
    type: extension === '.json' ? 'JSON' : 'CSV',
    size: stat.size,
  };
}
function listNativeInventoryBackups() {
  if (!fs.existsSync(backupsDir)) return [];
  return fs.readdirSync(backupsDir)
    .filter(fileName => /^MCC_Native_Inventory_Backup_.+\.(json|csv)$/i.test(fileName))
    .map(fileName => backupInfo(path.join(backupsDir, fileName)))
    .sort((left, right) => right.createdTime.localeCompare(left.createdTime));
}
function createNativeInventoryBackups(reason: string) {
  fs.mkdirSync(backupsDir, { recursive: true });
  const rows = nativeInventoryRows();
  const records = rows.map(nativeExportRecord);
  const stamp = backupFileStamp();
  const jsonPath = path.join(backupsDir, `MCC_Native_Inventory_Backup_${stamp}.json`);
  const csvPath = path.join(backupsDir, `MCC_Native_Inventory_Backup_${stamp}.csv`);
  fs.writeFileSync(jsonPath, JSON.stringify({
    app: appName,
    backupType: 'MCC Native Inventory',
    reason,
    createdAt: now(),
    partCount: records.length,
    parts: records,
  }, null, 2));
  fs.writeFileSync(csvPath, csvFromRecords(nativeExportHeaders, records));
  return [backupInfo(jsonPath), backupInfo(csvPath)];
}
function createAndAuditNativeBackup(req: Request, reason: string) {
  try {
    const backups = createNativeInventoryBackups(reason);
    inventoryAudit(req,'inventory backup create','inventory','native',{reason,files:backups.map(file => file.fileName)});
    audit(req,'inventory backup create','inventory','native',{reason,files:backups.map(file => file.fileName)});
    return backups;
  } catch (error) {
    const message = safeErrorMessage(error);
    inventoryAudit(req,'failed backup','inventory','native',{reason,error:message});
    audit(req,'failed inventory backup','inventory','native',{reason,error:message});
    throw error;
  }
}
type MasterBackupType = 'startup' | 'scheduled' | 'auto' | 'manual' | 'pre_restore';
type MasterBackupManifest = {
  appName: string;
  backupType: MasterBackupType;
  createdAt: string;
  createdBy: { id: number; fullName: string; email: string; role: Role } | null;
  appVersion: string;
  databaseFile: 'mcc.sqlite';
  databaseSizeBytes: number;
  includedPaths: string[];
  recordCounts: Record<string, number>;
  checksumSha256: string;
  notes: string;
};
type MasterBackupSummary = {
  id: string;
  name: string;
  type: MasterBackupType;
  typeLabel: string;
  createdAt: string;
  sizeBytes: number;
  databaseSizeBytes: number;
  includedPaths: string[];
  recordCounts: Record<string, number>;
  checksumSha256: string;
  notes: string;
  restorable: boolean;
};
type BackupOperationResult = {
  ok: boolean;
  type?: MasterBackupType;
  backupId?: string;
  createdAt?: string;
  message: string;
};
const masterBackupDir = path.join(backupsDir, 'master');
const corruptBackupDir = path.join(backupsDir, 'corrupt');
const masterBackupPrefix = 'MCC_Master_Backup_';
const scheduledBackupIntervalMs = 60 * 60 * 1000;
const autoBackupDelayMs = 45 * 1000;
const backupRetention: Record<MasterBackupType, number> = { startup: 10, scheduled: 30, auto: 50, manual: 30, pre_restore: 20 };
let autoBackupTimer: NodeJS.Timeout | undefined;
let autoBackupReason = '';
let autoBackupActor: User | null = null;
let nextScheduledBackupAt: string | null = null;
let lastBackupResult: BackupOperationResult = { ok: true, message: 'No master backup has run yet.' };
let backupInProgress = false;

function masterBackupTypeLabel(type: MasterBackupType) {
  return type.split('_').map(value=>value.charAt(0).toUpperCase() + value.slice(1)).join(' ');
}
function ensureMasterBackupDir() {
  fs.mkdirSync(masterBackupDir, { recursive: true });
}
function sqliteLiteral(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}
function sha256File(filePath: string) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}
function safeFolderStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}
function folderSizeBytes(folderPath: string): number {
  if (!fs.existsSync(folderPath)) return 0;
  const stat = fs.statSync(folderPath);
  if (stat.isFile()) return stat.size;
  return fs.readdirSync(folderPath).reduce((total, entry)=>total + folderSizeBytes(path.join(folderPath, entry)), 0);
}
function copyDirectoryIfPresent(sourcePath: string, targetPath: string) {
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isDirectory()) return false;
  fs.cpSync(sourcePath, targetPath, { recursive: true });
  return true;
}
function tableCount(tableName: string) {
  try {
    return one<{ count: number }>(`SELECT COUNT(*) AS count FROM ${tableName}`)?.count ?? 0;
  } catch {
    return 0;
  }
}
function masterBackupRecordCounts() {
  return {
    users: tableCount('users'),
    inventoryParts: tableCount('inventory_parts'),
    requisitions: tableCount('inventory_requisitions'),
    requisitionLines: tableCount('inventory_requisition_lines'),
    historyLogs: tableCount('history_logs'),
  };
}
function actorForManifest(actor?: User | null) {
  return actor ? { id: actor.id, fullName: actor.full_name, email: actor.email, role: actor.role } : null;
}
function databaseQuickCheck() {
  try {
    const result = db.prepare('PRAGMA quick_check').get() as Record<string, unknown> | undefined;
    const value = String(result?.quick_check ?? Object.values(result ?? {})[0] ?? '');
    return value.toLowerCase() === 'ok' ? { ok: true, message: 'Healthy' } : { ok: false, message: value || 'Database check failed.' };
  } catch (error) {
    return { ok: false, message: safeErrorMessage(error, [], 'Database check failed.') };
  }
}
function backupPathFromId(id: unknown) {
  const clean = String(id ?? '').trim();
  if (!/^MCC_Master_Backup_[A-Za-z0-9T_-]+_(startup|scheduled|auto|manual|pre_restore)$/.test(clean)) throw new Error('Backup not found.');
  const resolved = path.resolve(masterBackupDir, clean);
  if (path.dirname(resolved) !== path.resolve(masterBackupDir)) throw new Error('Backup not found.');
  return resolved;
}
function readMasterBackupManifest(folderPath: string): MasterBackupManifest | null {
  try {
    const manifestPath = path.join(folderPath, 'manifest.json');
    if (!fs.existsSync(manifestPath)) return null;
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as MasterBackupManifest;
  } catch {
    return null;
  }
}
function summaryFromMasterBackupFolder(folderPath: string): MasterBackupSummary | null {
  const name = path.basename(folderPath);
  const manifest = readMasterBackupManifest(folderPath);
  const match = name.match(/_(startup|scheduled|auto|manual|pre_restore)$/);
  const type = (manifest?.backupType ?? match?.[1]) as MasterBackupType | undefined;
  if (!type) return null;
  const dbFile = path.join(folderPath, 'mcc.sqlite');
  const stat = fs.statSync(folderPath);
  return {
    id: name,
    name,
    type,
    typeLabel: masterBackupTypeLabel(type),
    createdAt: manifest?.createdAt ?? stat.birthtime.toISOString(),
    sizeBytes: folderSizeBytes(folderPath),
    databaseSizeBytes: manifest?.databaseSizeBytes ?? (fs.existsSync(dbFile) ? fs.statSync(dbFile).size : 0),
    includedPaths: manifest?.includedPaths ?? (fs.existsSync(dbFile) ? ['mcc.sqlite'] : []),
    recordCounts: manifest?.recordCounts ?? {},
    checksumSha256: manifest?.checksumSha256 ?? '',
    notes: manifest?.notes ?? '',
    restorable: fs.existsSync(dbFile),
  };
}
function listMasterBackupsInternal() {
  if (!fs.existsSync(masterBackupDir)) return [];
  return fs.readdirSync(masterBackupDir, { withFileTypes: true })
    .filter(entry=>entry.isDirectory() && entry.name.startsWith(masterBackupPrefix))
    .map(entry=>summaryFromMasterBackupFolder(path.join(masterBackupDir, entry.name)))
    .filter((backup): backup is MasterBackupSummary => Boolean(backup))
    .sort((left,right)=>right.createdAt.localeCompare(left.createdAt));
}
function backupCountsByType(backups = listMasterBackupsInternal()) {
  const counts: Record<MasterBackupType, number> = { startup: 0, scheduled: 0, auto: 0, manual: 0, pre_restore: 0 };
  for (const backup of backups) counts[backup.type] += 1;
  return counts;
}
function removeMasterBackupFolder(folderPath: string) {
  const resolved = path.resolve(folderPath);
  const root = path.resolve(masterBackupDir);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error('Unsafe backup retention target.');
  fs.rmSync(resolved, { recursive: true, force: true });
}
function applyMasterBackupRetention() {
  const backups = listMasterBackupsInternal();
  for (const type of Object.keys(backupRetention) as MasterBackupType[]) {
    const typed = backups.filter(backup=>backup.type===type).sort((left,right)=>right.createdAt.localeCompare(left.createdAt));
    typed.slice(backupRetention[type]).forEach(backup=>removeMasterBackupFolder(path.join(masterBackupDir, backup.id)));
  }
}
function createMasterBackup(input: { type: MasterBackupType; actor?: User | null; notes?: string }) {
  if (backupInProgress) throw new Error('Another master backup is already running.');
  backupInProgress = true;
  try {
    ensureMasterBackupDir();
    const createdAt = now();
    const folderName = `${masterBackupPrefix}${safeFolderStamp()}_${input.type}`;
    const targetDir = path.join(masterBackupDir, folderName);
    fs.mkdirSync(targetDir, { recursive: false });
    const backupDbPath = path.join(targetDir, 'mcc.sqlite');
    db.exec('PRAGMA wal_checkpoint(FULL);');
    db.exec(`VACUUM INTO ${sqliteLiteral(backupDbPath)}`);
    const includedPaths = ['mcc.sqlite'];
    const fileTargetRoot = path.join(targetDir, 'files');
    for (const includedFolder of ['uploads','documents','files']) {
      const sourcePath = path.resolve(__dirname, '../../', includedFolder);
      if (copyDirectoryIfPresent(sourcePath, path.join(fileTargetRoot, includedFolder))) includedPaths.push(`${includedFolder}/`);
    }
    const databaseSizeBytes = fs.statSync(backupDbPath).size;
    const manifest: MasterBackupManifest = {
      appName,
      backupType: input.type,
      createdAt,
      createdBy: actorForManifest(input.actor),
      appVersion: version,
      databaseFile: 'mcc.sqlite',
      databaseSizeBytes,
      includedPaths,
      recordCounts: masterBackupRecordCounts(),
      checksumSha256: sha256File(backupDbPath),
      notes: input.notes ?? '',
    };
    fs.writeFileSync(path.join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    applyMasterBackupRetention();
    const summary = summaryFromMasterBackupFolder(targetDir);
    lastBackupResult = { ok: true, type: input.type, backupId: folderName, createdAt, message: `${masterBackupTypeLabel(input.type)} backup created.` };
    return summary!;
  } catch (error) {
    lastBackupResult = { ok: false, type: input.type, createdAt: now(), message: safeBackupClientError(error, 'Master backup failed.') };
    throw error;
  } finally {
    backupInProgress = false;
  }
}
function scheduleAutoBackup(reason: string, actor?: User | null) {
  autoBackupReason = reason;
  if (actor) autoBackupActor = actor;
  if (autoBackupTimer) clearTimeout(autoBackupTimer);
  autoBackupTimer = setTimeout(()=>{
    autoBackupTimer = undefined;
    try {
      createMasterBackup({ type: 'auto', actor: autoBackupActor, notes: autoBackupReason || 'Automatic backup after MCC data changes.' });
    } catch (error) {
      console.log(`MCC auto backup failed: ${safeErrorMessage(error)}`);
    } finally {
      autoBackupReason = '';
      autoBackupActor = null;
    }
  }, autoBackupDelayMs);
  autoBackupTimer.unref?.();
}
function verifyMasterBackup(id: unknown) {
  const folderPath = backupPathFromId(id);
  if (!fs.existsSync(folderPath)) throw new Error('Backup not found.');
  const summary = summaryFromMasterBackupFolder(folderPath);
  if (!summary?.restorable) throw new Error('Backup database file is missing.');
  const dbFile = path.join(folderPath, 'mcc.sqlite');
  const manifest = readMasterBackupManifest(folderPath);
  const checksumSha256 = sha256File(dbFile);
  const checksumMatches = !manifest?.checksumSha256 || manifest.checksumSha256 === checksumSha256;
  return { ok: checksumMatches, backup: summary, checksumSha256, message: checksumMatches ? 'Backup verified.' : 'Backup checksum does not match the manifest.' };
}
function restoreMasterBackup(input: { backupId: unknown; actor: User; confirmation: unknown }) {
  if (String(input.confirmation ?? '').trim() !== 'RESTORE MCC') throw new Error('Type RESTORE MCC to confirm restore.');
  const verification = verifyMasterBackup(input.backupId);
  if (!verification.ok) throw new Error(verification.message);
  const backupDbPath = path.join(backupPathFromId(input.backupId), 'mcc.sqlite');
  const preRestoreBackup = createMasterBackup({ type: 'pre_restore', actor: input.actor, notes: `Before restoring ${verification.backup.name}` });
  const preRestoreDbPath = path.join(masterBackupDir, preRestoreBackup.id, 'mcc.sqlite');
  let reopened = false;
  db.close();
  try {
    for (const filePath of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
      if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
    }
    fs.copyFileSync(backupDbPath, dbPath);
    db = new DatabaseSync(dbPath);
    db.exec('PRAGMA journal_mode=WAL;');
    initDb();
    migrateDb();
    reopened = true;
    try { audit({ user: input.actor, ip: '', get: () => '' } as unknown as Request, 'master restore completed', 'backup', verification.backup.id, { preRestoreBackupId: preRestoreBackup.id }); } catch {}
    lastBackupResult = { ok: true, type: 'pre_restore', backupId: preRestoreBackup.id, createdAt: now(), message: `Restored ${verification.backup.name}.` };
    return { restoredBackup: verification.backup, preRestoreBackup };
  } catch (error) {
    if (!reopened && fs.existsSync(preRestoreDbPath)) {
      for (const filePath of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
        if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
      }
      fs.copyFileSync(preRestoreDbPath, dbPath);
      db = new DatabaseSync(dbPath);
      db.exec('PRAGMA journal_mode=WAL;');
      initDb();
      migrateDb();
    }
    throw error;
  }
}
function masterBackupStatus() {
  ensureMasterBackupDir();
  const backups = listMasterBackupsInternal();
  const latestBackup = backups[0] ?? null;
  const dbStat = fs.existsSync(dbPath) ? fs.statSync(dbPath) : null;
  const health = databaseQuickCheck();
  return {
    ok: true,
    latestBackup,
    backupFolderExists: fs.existsSync(masterBackupDir),
    backupCountsByType: backupCountsByType(backups),
    lastBackupResult,
    nextScheduledBackupAt,
    databaseSize: dbStat?.size ?? 0,
    backupHealth: health.ok ? 'Healthy' : `Needs attention: ${health.message}`,
    autoBackupDelaySeconds: Math.round(autoBackupDelayMs / 1000),
    scheduledBackupIntervalMinutes: Math.round(scheduledBackupIntervalMs / 60000),
  };
}
function quarantineLiveDatabaseIfUnhealthy() {
  const health = databaseQuickCheck();
  if (health.ok) return false;
  fs.mkdirSync(corruptBackupDir, { recursive: true });
  const stamp = safeFolderStamp();
  const targetDir = path.join(corruptBackupDir, `MCC_Corrupt_DB_${stamp}`);
  fs.mkdirSync(targetDir, { recursive: false });
  for (const filePath of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (fs.existsSync(filePath)) fs.copyFileSync(filePath, path.join(targetDir, path.basename(filePath)));
  }
  fs.writeFileSync(path.join(targetDir, 'manifest.json'), JSON.stringify({ appName, createdAt: now(), reason: health.message }, null, 2));
  lastBackupResult = { ok: false, createdAt: now(), message: `Live database needs attention: ${health.message}` };
  return true;
}
function startMasterBackupScheduler() {
  ensureMasterBackupDir();
  if (quarantineLiveDatabaseIfUnhealthy()) return;
  try {
    createMasterBackup({ type: 'startup', notes: 'Created when MCC server started.' });
  } catch (error) {
    console.log(`MCC startup backup failed: ${safeErrorMessage(error)}`);
  }
  nextScheduledBackupAt = new Date(Date.now() + scheduledBackupIntervalMs).toISOString();
  const timer = setInterval(()=>{
    try {
      createMasterBackup({ type: 'scheduled', notes: 'Hourly scheduled backup.' });
    } catch (error) {
      console.log(`MCC scheduled backup failed: ${safeErrorMessage(error)}`);
    } finally {
      nextScheduledBackupAt = new Date(Date.now() + scheduledBackupIntervalMs).toISOString();
    }
  }, scheduledBackupIntervalMs);
  timer.unref?.();
}
function parseCsvRows(content: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const text = content.replace(/^\uFEFF/, '');
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell.trim());
      cell = '';
    } else if (char === '\n') {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }
  row.push(cell.trim());
  if (row.some(value => value)) rows.push(row);
  return rows;
}
function normalizeImportHeader(header: string) {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}
function isPartInfoUrlHeader(header: string) {
  return ['partinfourl','parturl','url'].includes(normalizeImportHeader(header));
}
function importRowFromRecord(record: Record<string, string>, rowNumber: number): NativeImportRow {
  const value = (...headers: string[]) => {
    for (const header of headers) {
      const direct = record[header];
      if (direct !== undefined) return direct.trim();
      const normalized = record[normalizeImportHeader(header)];
      if (normalized !== undefined) return normalized.trim();
    }
    return '';
  };
  return {
    rowNumber,
    mccItemId: value('MCC Item ID','Item ID','ID'),
    partNumber: value('Part Number','Part No','Part','SKU'),
    description: value('Description','Name'),
    location: value('Location','Location Name'),
    vendor: value('Vendor','Vendor Name'),
    quantity: value('Quantity','Qty','Stock On Hand'),
    minQuantity: value('Minimum Quantity','Min Quantity','Minimum','Min'),
    requisition: value('Requisition','Requisition Status','Order Placed'),
    partInfoUrl: value('Part Info URL','Part URL','URL'),
    manufacturerBrand: value('Manufacturer/Brand','Manufacturer','Brand','Make'),
    unitCost: value('Unit Cost','UnitCost','Unit Price','Price','Cost','Estimated Cost'),
    supplierPartNumber: value('Supplier Part Number','Supplier Part No','Supplier Part','Vendor Part Number','Vendor Part No','Manufacturer Part Number','Manufacturer Part No'),
    notes: value('Notes','Note'),
  };
}
function importRowsFromTable(rows: string[][]) {
  if (rows.length < 1) return [];
  const headers = rows[0].map(header => header.trim());
  const normalizedHeaders = headers.map(normalizeImportHeader);
  return rows.slice(1).map((row, index) => {
    const record: Record<string, string> = {};
    headers.forEach((header, columnIndex) => {
      record[header] = row[columnIndex] ?? '';
      record[normalizedHeaders[columnIndex]] = row[columnIndex] ?? '';
    });
    return importRowFromRecord(record, index + 2);
  }).filter(row => Object.values(row).some(value => String(value).trim()));
}
function stringFromExcelValue(value: unknown) {
  if (value === undefined || value === null) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return String(value).trim();
  const record = value as Record<string, unknown>;
  if (typeof record.text === 'string') return record.text.trim();
  if (record.result !== undefined && record.result !== null) return String(record.result).trim();
  if (Array.isArray(record.richText)) {
    return record.richText.map(part => isRecord(part) ? String(part.text ?? '') : '').join('').trim();
  }
  return '';
}
function excelCellText(cell: ExcelJS.Cell) {
  return stringFromExcelValue(cell.value) || String(cell.text ?? '').trim();
}
function excelCellHyperlink(cell: ExcelJS.Cell) {
  const cellWithHyperlink = cell as ExcelJS.Cell & { hyperlink?: unknown };
  if (typeof cellWithHyperlink.hyperlink === 'string') return cellWithHyperlink.hyperlink.trim();
  const value = cell.value;
  if (value && typeof value === 'object') {
    const record = value as unknown as Record<string, unknown>;
    if (typeof record.hyperlink === 'string') return record.hyperlink.trim();
    if (record.text && typeof record.text === 'object') {
      const textRecord = record.text as unknown as Record<string, unknown>;
      if (typeof textRecord.hyperlink === 'string') return textRecord.hyperlink.trim();
    }
  }
  return '';
}
function excelCellImportValue(cell: ExcelJS.Cell, headerName: string): NativeImportCell {
  const text = excelCellText(cell);
  const hyperlink = isPartInfoUrlHeader(headerName) ? excelCellHyperlink(cell) : '';
  return { text, hyperlink };
}
function importRowsFromExcelCells(rows: NativeImportCell[][]) {
  if (rows.length < 1) return [];
  const headers = rows[0].map(cell => cell.text.trim());
  const normalizedHeaders = headers.map(normalizeImportHeader);
  return rows.slice(1).map((row, index) => {
    const record: Record<string, string> = {};
    headers.forEach((header, columnIndex) => {
      const cell = row[columnIndex] ?? { text: '', hyperlink: '' };
      const value = isPartInfoUrlHeader(header) ? cell.hyperlink || cell.text : cell.text;
      record[header] = value;
      record[normalizedHeaders[columnIndex]] = value;
    });
    return importRowFromRecord(record, index + 2);
  }).filter(row => Object.values(row).some(value => String(value).trim()));
}
async function importRowsFromExcel(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook();
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  await workbook.xlsx.load(arrayBuffer);
  const sheet = workbook.getWorksheet('MCC Inventory Update') ?? workbook.getWorksheet('MCC Inventory Import');
  if (!sheet) throw new Error('Excel file must include a sheet named MCC Inventory Import or MCC Inventory Update.');
  const rows: NativeImportCell[][] = [];
  const columnCount = Math.max(sheet.columnCount, nativeExportHeaders.length);
  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  for (let columnNumber = 1; columnNumber <= columnCount; columnNumber += 1) {
    headers.push(excelCellText(headerRow.getCell(columnNumber)));
  }
  for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const values: NativeImportCell[] = [];
    for (let columnNumber = 1; columnNumber <= columnCount; columnNumber += 1) {
      values.push(excelCellImportValue(row.getCell(columnNumber), headers[columnNumber - 1] ?? ''));
    }
    if (values.some(value => value.text.trim() || value.hyperlink.trim())) rows.push(values);
  }
  return importRowsFromExcelCells(rows);
}
async function parseInventoryImportFile(file: Express.Multer.File | undefined) {
  if (!file) throw new Error('Choose a CSV or Excel file to import.');
  const extension = path.extname(file.originalname).toLowerCase();
  if (extension === '.csv' || file.mimetype.includes('csv')) return importRowsFromTable(parseCsvRows(file.buffer.toString('utf8')));
  if (extension === '.xlsx') return importRowsFromExcel(file.buffer);
  throw new Error('Import file must be CSV or .xlsx Excel format.');
}
function numericImportValue(value: string, label: string, rowNumber: number) {
  if (!value.trim()) return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Row ${rowNumber}: ${label} must be numeric.`);
  return parsed;
}
function requisitionImportValue(value: string) {
  const clean = value.trim();
  if (!clean) return '';
  const normalized = clean.toLowerCase();
  if (['true','yes','y','1'].includes(normalized)) return 'Requisition Made';
  if (['false','no','n','0'].includes(normalized)) return '';
  return clean.slice(0, 120);
}
function addImportError(errors: string[], message: string) {
  if (errors.length < 25) errors.push(message);
}
function importNativeInventoryRows(req: Request, rows: NativeImportRow[]) {
  const actor = (req as AuthRequest).user!;
  const summary: NativeImportSummary = { addedCount: 0, updatedCount: 0, skippedCount: 0, vendorCreatedCount: 0, locationCreatedCount: 0, invalidUrlCount: 0, errors: [] };
  const timestamp = now();
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const row of rows) {
      try {
        const partNumber = row.partNumber.trim();
        if (!partNumber) throw new Error(`Row ${row.rowNumber}: Part Number is required.`);
        const quantity = numericImportValue(row.quantity, 'Quantity', row.rowNumber);
        const minQuantity = numericImportValue(row.minQuantity, 'Minimum Quantity', row.rowNumber);
        const unitCost = row.unitCost.trim() ? numericImportValue(row.unitCost, 'Unit Cost', row.rowNumber) : 0;
        if (unitCost < 0) throw new Error(`Row ${row.rowNumber}: Unit Cost must be zero or greater.`);
        const rawUrl = row.partInfoUrl.trim();
        const partInfoUrl = rawUrl ? validWebUrl(rawUrl) : '';
        if (rawUrl && !partInfoUrl) {
          summary.invalidUrlCount += 1;
          addImportError(summary.errors, `Row ${row.rowNumber}: unsafe Part Info URL was skipped.`);
        }
        let existing = row.mccItemId.trim() ? one<{ id: number }>('SELECT id FROM inventory_parts WHERE deleted=0 AND id=?', [Number(row.mccItemId)]) : undefined;
        if (!existing) existing = findDuplicateNativePart(partNumber);
        if (existing && findDuplicateNativePart(partNumber, existing.id)) throw new Error(`Row ${row.rowNumber}: Part Number already exists on another native inventory item.`);
        const location = getOrCreateMccNativeLookup(req,'inventory_locations',row.location,timestamp);
        const vendor = getOrCreateMccNativeLookup(req,'inventory_vendors',row.vendor,timestamp);
        if (location.created) summary.locationCreatedCount += 1;
        if (vendor.created) summary.vendorCreatedCount += 1;
        const status = nativePartStatus(quantity, minQuantity);
        const requisition = requisitionImportValue(row.requisition);
        if (existing) {
          run(`UPDATE inventory_parts SET part_number=?, description=?, location_id=?, vendor_id=?, quantity=?, min_quantity=?, status=?, requisition=?, part_info_url=?, manufacturer_brand=?, unit_cost=?, supplier_part_number=?, notes=?, source=?, updated_by_user_id=?, updated_at=? WHERE id=?`, [partNumber,row.description.trim(),location.id,vendor.id,quantity,minQuantity,status,requisition,partInfoUrl,row.manufacturerBrand.trim(),unitCost,row.supplierPartNumber.trim(),row.notes.trim(),'mcc',actor.id,timestamp,existing.id]);
          summary.updatedCount += 1;
        } else {
          run(`INSERT INTO inventory_parts (mit3_item_id,part_number,description,location_id,vendor_id,quantity,min_quantity,status,requisition,part_info_url,manufacturer_brand,unit_cost,supplier_part_number,notes,source,imported_from_mit3_at,created_by_user_id,updated_by_user_id,created_at,updated_at,deleted) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`, [null,partNumber,row.description.trim(),location.id,vendor.id,quantity,minQuantity,status,requisition,partInfoUrl,row.manufacturerBrand.trim(),unitCost,row.supplierPartNumber.trim(),row.notes.trim(),'mcc',null,actor.id,actor.id,timestamp,timestamp]);
          summary.addedCount += 1;
        }
      } catch (error) {
        summary.skippedCount += 1;
        addImportError(summary.errors, safeErrorMessage(error));
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return summary;
}
function nativeInventorySummary() {
  return {
    totalParts: one<{ count: number }>('SELECT COUNT(*) AS count FROM inventory_parts WHERE deleted=0')?.count ?? 0,
    lowStockCount: one<{ count: number }>("SELECT COUNT(*) AS count FROM inventory_parts WHERE deleted=0 AND (status IN ('Low Stock','Out of Stock') OR (min_quantity > 0 AND quantity <= min_quantity))")?.count ?? 0,
    requisitionCount: one<{ count: number }>("SELECT COUNT(*) AS count FROM inventory_parts WHERE deleted=0 AND requisition<>''")?.count ?? 0,
    vendorCount: one<{ count: number }>('SELECT COUNT(*) AS count FROM inventory_vendors WHERE deleted=0')?.count ?? 0,
    locationCount: one<{ count: number }>('SELECT COUNT(*) AS count FROM inventory_locations WHERE deleted=0')?.count ?? 0,
    lastImportedFromMit3At: one<{ lastImportedFromMit3At: string | null }>('SELECT MAX(imported_from_mit3_at) AS lastImportedFromMit3At FROM inventory_parts WHERE deleted=0')?.lastImportedFromMit3At ?? null,
  };
}
function importMit3Part(part: NormalizedMit3Part, actorId: number, timestamp: string) {
  const mit3ItemId = part.mit3ItemId.trim();
  const partNumber = part.partNumber.trim();
  if (!mit3ItemId && !partNumber) return { imported: false, updated: false, skipped: true };
  const location = getOrCreateNativeLookup('inventory_locations', part.location, timestamp);
  const vendor = getOrCreateNativeLookup('inventory_vendors', part.vendor, timestamp);
  const existing = findNativePart(mit3ItemId, partNumber);
  const requisition = part.requisition || (part.orderPlaced ? 'Requisition Made' : '');
  const partParams: SqlParam[] = [
    mit3ItemId || null,
    partNumber,
    part.description.trim(),
    location.id,
    vendor.id,
    Number(part.quantity ?? 0),
    Number(part.minQuantity ?? 0),
    part.status,
    requisition,
    part.partInfoUrl,
    part.manufacturerBrand.trim(),
    Number.isFinite(part.unitCost) ? Math.max(0, Number(part.unitCost)) : 0,
    part.supplierPartNumber.trim(),
    part.notes.trim(),
    'MIT3 HTTP API',
    timestamp,
  ];
  if (existing) {
    run(`UPDATE inventory_parts SET mit3_item_id=?, part_number=?, description=?, location_id=?, vendor_id=?, quantity=?, min_quantity=?, status=?, requisition=?, part_info_url=?, manufacturer_brand=?, unit_cost=?, supplier_part_number=?, notes=?, source=?, imported_from_mit3_at=?, updated_by_user_id=?, updated_at=?, deleted=0, deleted_at=NULL, deleted_by_user_id=NULL WHERE id=?`, [...partParams,actorId,timestamp,existing.id]);
    return { imported: false, updated: true, skipped: false };
  }
  run(`INSERT INTO inventory_parts (mit3_item_id,part_number,description,location_id,vendor_id,quantity,min_quantity,status,requisition,part_info_url,manufacturer_brand,unit_cost,supplier_part_number,notes,source,imported_from_mit3_at,created_by_user_id,updated_by_user_id,created_at,updated_at,deleted) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`, [...partParams,actorId,actorId,timestamp,timestamp]);
  return { imported: true, updated: false, skipped: false };
}
function safePartInfoUrl(value: string) {
  return validWebUrl(value);
}
function numericInput(input: Record<string, unknown>, key: string, label: string, fallback = 0) {
  const value = input[key];
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const parsed = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be numeric.`);
  return parsed;
}
function nativePartStatus(quantity: number, minQuantity: number) {
  if (quantity <= 0) return 'Out of Stock';
  if (minQuantity > 0 && quantity <= minQuantity) return 'Low Stock';
  return 'In Stock';
}
function validateNativePartInput(body: unknown) {
  const input = isRecord(body) ? body : {};
  const partNumber = textField(input, ['partNumber']);
  if (!partNumber) throw new Error('Part Number is required.');
  const description = textField(input, ['description']);
  if (!description) throw new Error('Description is required.');
  const location = textField(input, ['location']);
  const vendor = textField(input, ['vendor']);
  if (!vendor) throw new Error('Vendor is required.');
  const quantity = numericInput(input, 'quantity', 'Quantity');
  const minQuantity = numericInput(input, 'minQuantity', 'Minimum Quantity');
  const manufacturerBrand = textField(input, ['manufacturerBrand','manufacturer','brand']).slice(0, 160);
  if (input.unitCost === undefined || input.unitCost === null || String(input.unitCost).trim() === '') throw new Error('Unit Cost is required.');
  const unitCost = numericInput(input, 'unitCost', 'Unit Cost');
  if (unitCost < 0) throw new Error('Unit Cost cannot be negative.');
  const supplierPartNumber = textField(input, ['supplierPartNumber','supplierPartNo']).slice(0, 160);
  const rawUrl = textField(input, ['partInfoUrl']);
  const partInfoUrl = rawUrl ? safePartInfoUrl(rawUrl) : '';
  if (rawUrl && !partInfoUrl) throw new Error('Part Info URL must be blank or a valid http/https URL.');
  return {partNumber,description,location,vendor,quantity,minQuantity,manufacturerBrand,unitCost,supplierPartNumber,partInfoUrl,status:nativePartStatus(quantity,minQuantity)};
}
type NativePartInput = ReturnType<typeof validateNativePartInput>;
function findDuplicateNativePart(partNumber: string, excludeId?: number) {
  if (!partNumber) return undefined;
  return excludeId
    ? one<{ id: number }>('SELECT id FROM inventory_parts WHERE deleted=0 AND lower(part_number)=lower(?) AND id<>? ORDER BY id LIMIT 1', [partNumber,excludeId])
    : one<{ id: number }>('SELECT id FROM inventory_parts WHERE deleted=0 AND lower(part_number)=lower(?) ORDER BY id LIMIT 1', [partNumber]);
}
function nativeRequisitionFromInput(body: unknown) {
  const input = isRecord(body) ? body : {};
  const value = input.requisition ?? input.orderPlaced;
  if (value === false || value === 0 || String(value).toLowerCase() === 'false') return '';
  if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 120);
  return value ? textField(input, ['status','label'], 'Requisition Made').slice(0, 120) : '';
}
function nativeInventoryErrorStatus(message: string) {
  if (/not found/i.test(message)) return 404;
  if (/already exists/i.test(message)) return 409;
  if (/required|numeric|negative|valid http\/https/i.test(message)) return 400;
  return 500;
}
function sendNativeInventoryError(req: Request, res: Response, operation: string, targetId: string|number, error: unknown) {
  const message = safeErrorMessage(error);
  inventoryAudit(req,'failed native write','inventory',targetId,{operation,error:message});
  audit(req,'failed inventory native write','inventory',targetId,{operation,error:message});
  res.status(nativeInventoryErrorStatus(message)).json({ok:false,error:message});
}
type RequisitionStatus = 'Draft' | 'Requested' | 'Ordered' | 'Received' | 'Canceled';
const requisitionStatuses: RequisitionStatus[] = ['Draft','Requested','Ordered','Received','Canceled'];
const activeRequisitionStatuses: RequisitionStatus[] = ['Requested','Ordered'];
interface RequisitionRow {
  id: number;
  requisition_number: string;
  inventory_part_id: number;
  part_number: string;
  description: string;
  vendor_name: string;
  location_name: string;
  quantity_requested: number;
  unit_cost: number | null;
  status: RequisitionStatus;
  requested_by_user_id: number | null;
  requested_by_name: string;
  po_initiator: string;
  requisitioned_by_name: string;
  tax_exempt: string;
  confirmed_with: string;
  material_cert: string;
  ship_via: string;
  fob: string;
  requested_at: string;
  ordered_by_user_id: number | null;
  ordered_at: string | null;
  received_by_user_id: number | null;
  received_at: string | null;
  canceled_by_user_id: number | null;
  canceled_at: string | null;
  cancel_reason: string;
  work_order_number: string;
  notes: string;
  created_at: string;
  updated_at: string;
  deleted: number;
  deleted_at: string | null;
  deleted_by_user_id: number | null;
}
interface RequisitionLineRow {
  id: number;
  requisition_id: number;
  inventory_part_id: number;
  part_number: string;
  description: string;
  vendor_name: string;
  location_name: string;
  quantity_requested: number;
  unit_cost: number | null;
  unit_of_measure: string;
  item_number: string;
  notes: string;
  created_at: string;
  updated_at: string;
  deleted: number;
  deleted_at: string | null;
  deleted_by_user_id: number | null;
}
function publicRequisitionLine(line: RequisitionLineRow) {
  const quantityRequested = Number(line.quantity_requested ?? 0) || 0;
  const unitCost = Number(line.unit_cost ?? 0);
  const safeUnitCost = Number.isFinite(unitCost) && unitCost >= 0 ? unitCost : 0;
  return {
    id: line.id,
    requisitionId: line.requisition_id,
    inventoryPartId: line.inventory_part_id,
    partNumber: line.part_number,
    description: line.description,
    vendorName: line.vendor_name,
    locationName: line.location_name,
    quantityRequested,
    unitCost: safeUnitCost,
    totalCost: quantityRequested * safeUnitCost,
    unitOfMeasure: line.unit_of_measure || 'EA',
    itemNumber: line.item_number || line.part_number,
    notes: line.notes,
    deleted: Boolean(line.deleted),
    deletedAt: line.deleted_at,
  };
}
function legacyLineFromRequisition(row: RequisitionRow): RequisitionLineRow {
  return {
    id: 0,
    requisition_id: row.id,
    inventory_part_id: row.inventory_part_id,
    part_number: row.part_number,
    description: row.description,
    vendor_name: row.vendor_name,
    location_name: row.location_name,
    quantity_requested: row.quantity_requested,
    unit_cost: row.unit_cost,
    unit_of_measure: 'EA',
    item_number: row.part_number,
    notes: '',
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted: row.deleted,
    deleted_at: row.deleted_at,
    deleted_by_user_id: row.deleted_by_user_id,
  };
}
function requisitionLineRows(requisitionId: number, options: { includeDeleted?: boolean } = {}) {
  return all<RequisitionLineRow>(`SELECT * FROM inventory_requisition_lines WHERE requisition_id=? ${options.includeDeleted ? '' : 'AND deleted=0'} ORDER BY id`, [requisitionId]);
}
function requisitionLinesForRow(row: RequisitionRow, options: { includeDeleted?: boolean } = {}) {
  const rows = requisitionLineRows(row.id, options);
  return rows.length ? rows : [legacyLineFromRequisition(row)];
}
function uniqueTextValues(values: string[]) {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}
function summaryText(values: string[], fallback = '') {
  const unique = uniqueTextValues(values);
  if (unique.length === 0) return fallback;
  if (unique.length === 1) return unique[0];
  return `Multiple (${unique.length})`;
}
function requisitionVendorKey(value: string | null | undefined) {
  const clean = cleanPdfText(value);
  return clean ? clean.toLowerCase().replace(/\s+/g, ' ') : 'unknown-vendor';
}
function requisitionVendorName(value: string | null | undefined) {
  return cleanPdfText(value) || 'Unknown Vendor';
}
function uniquePositiveIds(ids: Array<number | null | undefined>) {
  return [...new Set(ids.filter((id): id is number => typeof id === 'number' && Number.isInteger(id) && id > 0))];
}
function publicRequisition(row: RequisitionRow, options: { includeDeletedLines?: boolean } = {}) {
  const lines = requisitionLinesForRow(row, { includeDeleted: options.includeDeletedLines }).map(publicRequisitionLine);
  const firstLine = lines[0];
  const totalQuantity = lines.reduce((sum,line)=>sum + line.quantityRequested, 0);
  const totalCost = lines.reduce((sum,line)=>sum + line.totalCost, 0);
  const partNumbers = lines.map(line=>line.partNumber).filter(Boolean);
  const descriptions = lines.map(line=>line.description).filter(Boolean);
  return {
    id: row.id,
    requisitionNumber: row.requisition_number,
    inventoryPartId: firstLine?.inventoryPartId ?? row.inventory_part_id,
    partNumber: firstLine?.partNumber ?? row.part_number,
    description: firstLine?.description ?? row.description,
    vendorName: firstLine?.vendorName ?? row.vendor_name,
    locationName: firstLine?.locationName ?? row.location_name,
    quantityRequested: totalQuantity || Number(row.quantity_requested ?? 0),
    unitCost: firstLine?.unitCost ?? Number(row.unit_cost ?? 0),
    totalCost,
    lineCount: lines.length,
    firstPartNumber: firstLine?.partNumber ?? row.part_number,
    firstDescription: firstLine?.description ?? row.description,
    totalQuantity: totalQuantity || Number(row.quantity_requested ?? 0),
    vendorSummary: summaryText(lines.map(line=>line.vendorName), row.vendor_name),
    locationSummary: summaryText(lines.map(line=>line.locationName), row.location_name),
    partNumbers,
    descriptions,
    lines,
    status: row.status,
    requestedByUserId: row.requested_by_user_id,
    requestedByName: row.requested_by_name,
    poInitiator: row.po_initiator,
    requisitionedByName: row.requisitioned_by_name || row.requested_by_name,
    taxExempt: row.tax_exempt || 'No',
    confirmedWith: row.confirmed_with,
    materialCert: row.material_cert || 'No',
    shipVia: row.ship_via,
    fob: row.fob || 'Destination',
    requestedAt: row.requested_at,
    orderedByUserId: row.ordered_by_user_id,
    orderedAt: row.ordered_at,
    receivedByUserId: row.received_by_user_id,
    receivedAt: row.received_at,
    canceledByUserId: row.canceled_by_user_id,
    canceledAt: row.canceled_at,
    cancelReason: row.cancel_reason,
    workOrderNumber: row.work_order_number,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deleted: Boolean(row.deleted),
    deletedAt: row.deleted_at,
  };
}
function requisitionHistoryValue(row: RequisitionRow) {
  const publicRow = publicRequisition(row, { includeDeletedLines: true });
  return {
    requisitionNumber: publicRow.requisitionNumber,
    status: publicRow.status,
    lineCount: publicRow.lineCount,
    partNumbers: publicRow.partNumbers,
    firstPartNumber: publicRow.firstPartNumber,
    description: publicRow.firstDescription,
    vendor: publicRow.vendorSummary || publicRow.vendorName,
    location: publicRow.locationSummary || publicRow.locationName,
    quantityRequested: publicRow.totalQuantity,
    totalCost: publicRow.totalCost,
    workOrderNumber: publicRow.workOrderNumber,
    notes: publicRow.notes,
    cancelReason: publicRow.cancelReason,
  };
}
function recordRequisitionHistory(input: { action: string; actor: User; row: RequisitionRow; oldValue?: Record<string, unknown> | null; newValue?: Record<string, unknown> | null; reasonNote?: string; createdAt?: string }) {
  const value = requisitionHistoryValue(input.row);
  recordHistoryLog({
    section: 'requisitions',
    action: input.action,
    entityType: 'requisition',
    entityId: input.row.id,
    entityLabel: input.row.requisition_number,
    workOrderNumber: input.row.work_order_number,
    partNumber: Array.isArray(value.partNumbers) ? value.partNumbers.join(', ') : input.row.part_number,
    requisitionNumber: input.row.requisition_number,
    locationName: input.row.location_name,
    vendorName: input.row.vendor_name,
    oldValue: input.oldValue,
    newValue: input.newValue ?? value,
    quantityAfter: Number(input.row.quantity_requested ?? 0),
    reasonNote: input.reasonNote,
    actor: input.actor,
    createdAt: input.createdAt,
  });
}
function activeRequisitionForPart(partId: number) {
  return one<{ requisition_number: string; status: RequisitionStatus }>(`SELECT r.requisition_number,r.status
FROM inventory_requisitions r
LEFT JOIN inventory_requisition_lines line ON line.requisition_id=r.id AND line.deleted=0
WHERE r.deleted=0 AND r.status IN ('Requested','Ordered') AND (line.inventory_part_id=? OR (line.id IS NULL AND r.inventory_part_id=?))
ORDER BY r.requested_at DESC, r.id DESC LIMIT 1`, [partId,partId]);
}
function activeRequisitionCountForPart(partId: number) {
  return one<{ count: number }>(`SELECT COUNT(DISTINCT r.id) AS count
FROM inventory_requisitions r
LEFT JOIN inventory_requisition_lines line ON line.requisition_id=r.id AND line.deleted=0
WHERE r.deleted=0 AND r.status IN ('Requested','Ordered') AND (line.inventory_part_id=? OR (line.id IS NULL AND r.inventory_part_id=?))`, [partId,partId])?.count ?? 0;
}
function syncPartRequisitionFlag(partId: number, timestamp = now()) {
  const active = activeRequisitionForPart(partId);
  run('UPDATE inventory_parts SET requisition=?, updated_at=? WHERE id=?', [active ? active.status : '',timestamp,partId]);
}
function requisitionPartIds(row: RequisitionRow, options: { includeDeletedLines?: boolean } = {}) {
  const lineRows = requisitionLineRows(row.id, { includeDeleted: options.includeDeletedLines });
  const ids = lineRows.length ? lineRows.map(line=>line.inventory_part_id) : [row.inventory_part_id];
  return uniquePositiveIds(ids);
}
function syncRequisitionPartFlags(partIds: number[], timestamp = now()) {
  for (const partId of uniquePositiveIds(partIds)) syncPartRequisitionFlag(partId, timestamp);
}
function requisitionNumberForTimestamp(timestamp: string) {
  const year = timestamp.slice(0, 4);
  const latest = one<{ requisition_number: string }>("SELECT requisition_number FROM inventory_requisitions WHERE requisition_number LIKE ? ORDER BY requisition_number DESC LIMIT 1", [`REQ-${year}-%`]);
  let next = 1;
  const match = latest?.requisition_number.match(/^REQ-\d{4}-(\d{6})/);
  if (match) next = Number(match[1]) + 1;
  for (;;) {
    const requisitionNumber = `REQ-${year}-${String(next).padStart(6, '0')}`;
    const existing = one<{ id: number }>('SELECT id FROM inventory_requisitions WHERE requisition_number=?', [requisitionNumber]);
    if (!existing) return requisitionNumber;
    next += 1;
  }
}

function safeFileToken(value: string) {
  return (value || 'Unknown_Vendor').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'Unknown_Vendor';
}
type RequisitionPdfItem = {partNumber:string;description:string;locationName:string;quantityRequested:number;unitCost?:number|null;supplierPartNumber?:string;dueDate?:string;notes?:string;unitOfMeasure?:string};
type RequisitionTemplateKind = 'under-100' | 'over-100';
type PdfPoint = { x: number; topY: number };
type PdfBox = { x: number; topY: number; width: number; height: number };
type StampPositions = {
  assetNo: PdfPoint;
  authorizedBy: PdfPoint;
  codeNo: PdfPoint;
  comments: PdfPoint;
  confirmedWith: PdfPoint;
  departmentManager: PdfPoint;
  equipmentNo: PdfPoint;
  fobDestination: PdfPoint;
  fobOrigin: PdfPoint;
  initials: PdfPoint;
  jobNo: PdfPoint;
  lineDescriptionX: number;
  lineDueDateX: number;
  lineItemNumberX: number;
  lineQuantityX: number;
  lineRowHeight: number;
  lineStartTopY: number;
  lineTotalPriceX: number;
  lineUnitPriceX: number;
  lineUnitX: number;
  lineBoxes: {
    quantity: PdfBox;
    unit: PdfBox;
    itemNumber: PdfBox;
    description: PdfBox;
    dueDate: PdfBox;
    unitPrice: PdfBox;
    totalPrice: PdfBox;
  };
  lineRowTopYs: number[];
  materialCertNo: PdfPoint;
  materialCertYes: PdfPoint;
  maxLineRows: number;
  moldNo: PdfPoint;
  partNo: PdfPoint;
  poClass: PdfPoint;
  poInitiator: PdfPoint;
  poNo: PdfPoint;
  reqDate: PdfPoint;
  requisitionedBy: PdfPoint;
  shipVia: PdfPoint;
  tableHeaderTopY: number;
  taxExemptNo: PdfPoint;
  taxExemptYes: PdfPoint;
  tsNo: PdfPoint;
  vendorAddressLine1: PdfPoint;
  vendorAddressLine2: PdfPoint;
  vendorName: PdfPoint;
  requisitionedByBox: PdfBox;
  vendorTotal: PdfPoint;
  vendorTotalBox: PdfBox;
  workOrderNo: PdfPoint;
};

const pdfBlack = rgb(0, 0, 0);
const pdfHeaderGray = rgb(0.88, 0.88, 0.88);
const requisitionTemplateDir = path.join(repoRootPath, 'reference', 'mit3-requisition', 'public', 'templates');
const pdfTemplatePaths: Record<RequisitionTemplateKind, string> = {
  'under-100': path.join(requisitionTemplateDir, 'blank-requisition-under-100.pdf'),
  'over-100': path.join(requisitionTemplateDir, 'blank-requisition-over-100.pdf'),
};
const officialRequisitionTemplateDir = path.join(repoRootPath, 'backend', 'templates');

type OfficialHeaderCellMap = {
  assetNo: string;
  authorizedBy: string;
  codeNo: string;
  comments: string;
  confirmedWith: string;
  departmentManager: string;
  equipmentNo: string;
  initials: string;
  jobNo: string;
  moldNo: string;
  partNo: string;
  poClass: string;
  poInitiator: string;
  poNo: string;
  reqDate: string;
  requisitionedBy: string;
  shipVia: string;
  tsNo: string;
  vendorAddressLine1: string;
  vendorAddressLine2: string;
  vendorName: string;
  workOrderNo: string;
};
type OfficialLineCellMap = {
  dueDate: string;
  itemDescription: string;
  itemNumber: string;
  quantity: string;
  totalPrice: string;
  unitOfMeasure: string;
  unitPrice: string;
};
type OfficialTemplateCellMap = {
  grandTotal: string;
  header: OfficialHeaderCellMap;
  line: OfficialLineCellMap;
  lineEndRow: number;
  lineStartRow: number;
  templatePath: string;
};
type XlsxCell = {
  formula?: (formula?: string) => string | undefined;
  style?: (style?: Record<string, unknown>) => unknown;
  value: (value?: unknown) => unknown;
};
type XlsxRow = {
  height?: (height?: number) => unknown;
};
type XlsxColumn = {
  width?: (width?: number) => unknown;
};
type XlsxSheet = {
  cell: (address: string) => XlsxCell;
  column?: (columnNameOrNumber: string | number) => XlsxColumn;
  pageMargins?: (attributeName: string, value?: number) => unknown;
  pageMarginsPreset?: (presetName?: string, presetAttributes?: Record<string, number>) => unknown;
  printOptions?: (attributeName: string, attributeEnabled?: boolean) => unknown;
  row?: (rowNumber: number) => XlsxRow;
};
type OfficialPdfChoices = {
  fob: string;
  materialCert: string;
  taxExempt: string;
};

const officialTemplateMaps: Record<RequisitionTemplateKind, OfficialTemplateCellMap> = {
  'over-100': {
    templatePath: path.join(officialRequisitionTemplateDir, 'requisition-over-100.xlsx'),
    header: {
      poNo: 'D7',
      poInitiator: 'H7',
      shipVia: 'M7',
      poClass: 'D9',
      reqDate: 'D11',
      vendorName: 'D13',
      confirmedWith: 'H13',
      vendorAddressLine1: 'D14',
      vendorAddressLine2: 'D15',
      partNo: 'N14',
      jobNo: 'N15',
      assetNo: 'D16',
      moldNo: 'N16',
      initials: 'K17',
      tsNo: 'N17',
      codeNo: 'N18',
      workOrderNo: 'D19',
      equipmentNo: 'E19',
      comments: 'D36',
      departmentManager: 'M38',
      requisitionedBy: 'G38',
      authorizedBy: 'M39',
    },
    lineStartRow: 23,
    lineEndRow: 34,
    line: {
      quantity: 'B',
      unitOfMeasure: 'C',
      itemNumber: 'D',
      itemDescription: 'E',
      dueDate: 'K',
      unitPrice: 'M',
      totalPrice: 'N',
    },
    grandTotal: 'O21',
  },
  'under-100': {
    templatePath: path.join(officialRequisitionTemplateDir, 'requisition-under-100.xlsx'),
    header: {
      poNo: 'C6',
      poInitiator: 'G6',
      shipVia: 'L6',
      poClass: 'C8',
      reqDate: 'C10',
      vendorName: 'C12',
      confirmedWith: 'G12',
      vendorAddressLine1: 'C13',
      vendorAddressLine2: 'C14',
      partNo: 'M13',
      jobNo: 'M14',
      assetNo: 'C15',
      moldNo: 'M15',
      initials: 'J16',
      tsNo: 'M16',
      codeNo: 'M17',
      workOrderNo: 'C18',
      equipmentNo: 'F18',
      comments: 'C34',
      departmentManager: 'L34',
      requisitionedBy: 'F36',
      authorizedBy: 'L36',
    },
    lineStartRow: 22,
    lineEndRow: 31,
    line: {
      quantity: 'A',
      unitOfMeasure: 'B',
      itemNumber: 'C',
      itemDescription: 'D',
      dueDate: 'J',
      unitPrice: 'L',
      totalPrice: 'M',
    },
    grandTotal: 'N20',
  },
};

function workbookOutputToBuffer(output: unknown) {
  if (Buffer.isBuffer(output)) return output;
  if (output instanceof ArrayBuffer) return Buffer.from(output);
  if (ArrayBuffer.isView(output)) return Buffer.from(output.buffer, output.byteOffset, output.byteLength);
  return Buffer.from(String(output ?? ''));
}

function officialParseDateInput(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(date.getTime()) ? value : date;
}

function officialWrapTextByLength(value: unknown, maxLineLength: number, maxLines = 2) {
  const words = cleanPdfText(value).split(' ').filter(Boolean);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;
    if (nextLine.length <= maxLineLength) {
      currentLine = nextLine;
      continue;
    }
    if (currentLine) lines.push(currentLine);
    if (word.length > maxLineLength) {
      for (let index = 0; index < word.length; index += maxLineLength) lines.push(word.slice(index, index + maxLineLength));
      currentLine = '';
      continue;
    }
    currentLine = word;
  }
  if (currentLine) lines.push(currentLine);

  const visible = lines.slice(0, maxLines);
  if (lines.length > maxLines && visible.length) {
    const last = visible[visible.length - 1].replace(/\.\.\.$/, '');
    visible[visible.length - 1] = `${last.slice(0, Math.max(0, maxLineLength - 3))}...`;
  }
  return visible.length ? visible.join('\n') : '';
}

function officialCountWrappedLines(value: string) {
  return Math.max(1, value.split(/\n/).length);
}

function officialSetWrappedCellValue(cell: XlsxCell, value: unknown, maxLineLength: number, maxLines = 2) {
  const wrappedValue = officialWrapTextByLength(value, maxLineLength, maxLines);
  cell.value(wrappedValue);
  try {
    cell.style?.({ shrinkToFit: true, verticalAlignment: 'center', wrapText: true });
  } catch {
    // MIT3 parity: template cells can reject style updates; the filled value is still useful.
  }
  return officialCountWrappedLines(wrappedValue);
}

function officialSetCompactHeaderCellValue(sheet: XlsxSheet, address: string, value: unknown, maxLineLength: number) {
  const cell = sheet.cell(address);
  const wrappedValue = officialWrapTextByLength(value, maxLineLength, 1);
  cell.value(wrappedValue);
  try {
    cell.style?.({ fontSize: 7.2, horizontalAlignment: 'center', shrinkToFit: true, verticalAlignment: 'center', wrapText: false });
  } catch {
    // Header field tuning only; the value should still export if the template rejects style changes.
  }
  return officialCountWrappedLines(wrappedValue);
}

function officialSetCellValue(sheet: XlsxSheet, address: string, value: unknown) {
  sheet.cell(address).value(value ?? '');
}

function officialClearCellFully(cell: XlsxCell) {
  if (typeof cell.formula === 'function') cell.formula(undefined);
  cell.value('');
}

function officialHeaderContactLines(header: Record<string, unknown>) {
  const contactLines = textField(header, ['vendorAddress'])
    .split(/\r?\n/)
    .map(line => cleanPdfText(line))
    .filter(Boolean);
  if (contactLines.length <= 2) return contactLines;
  return [contactLines[0], contactLines.slice(1).join(' | ')];
}

function officialComments(header: Record<string, unknown>, notes: string) {
  const comments = cleanPdfText(textField(header, ['comments'], notes));
  const priority = cleanPdfText(textField(header, ['priority'])).toLowerCase();
  if (priority !== 'high') return comments;
  const normalized = comments.replace(/^high priority\s*-?\s*/i, '').trim();
  return normalized ? `HIGH PRIORITY - ${normalized}` : 'HIGH PRIORITY -';
}

function officialWriteHeader(sheet: XlsxSheet, map: OfficialHeaderCellMap, input: { header: Record<string, unknown>; notes: string; requestedBy: string; vendor: string }) {
  const { header, notes, requestedBy, vendor } = input;
  const [vendorAddressLine1 = '', vendorAddressLine2 = ''] = officialHeaderContactLines(header);

  officialSetWrappedCellValue(sheet.cell(map.poNo), '', 18, 1);
  officialSetCompactHeaderCellValue(sheet, map.poInitiator, textField(header, ['poInitiator']), 22);
  officialSetWrappedCellValue(sheet.cell(map.shipVia), textField(header, ['shipVia']), 18, 1);
  officialSetWrappedCellValue(sheet.cell(map.poClass), textField(header, ['poClass']), 18, 1);
  officialSetCellValue(sheet, map.reqDate, officialParseDateInput(textField(header, ['requestDate','reqDate'])));
  officialSetWrappedCellValue(sheet.cell(map.vendorName), textField(header, ['vendorName'], vendor), 26, 1);
  officialSetWrappedCellValue(sheet.cell(map.vendorAddressLine1), vendorAddressLine1, 34, 1);
  officialSetWrappedCellValue(sheet.cell(map.vendorAddressLine2), vendorAddressLine2, 44, 1);
  officialSetCompactHeaderCellValue(sheet, map.confirmedWith, textField(header, ['confirmedWith']), 24);
  officialSetWrappedCellValue(sheet.cell(map.assetNo), textField(header, ['assetNo']), 18, 1);
  officialSetWrappedCellValue(sheet.cell(map.moldNo), textField(header, ['moldNo']), 18, 1);
  officialSetWrappedCellValue(sheet.cell(map.equipmentNo), textField(header, ['equipmentNo']), 18, 1);
  officialSetWrappedCellValue(sheet.cell(map.partNo), textField(header, ['partNo']), 18, 1);
  officialSetWrappedCellValue(sheet.cell(map.jobNo), textField(header, ['jobNo']), 18, 1);
  officialSetWrappedCellValue(sheet.cell(map.initials), textField(header, ['initials']), 8, 1);
  officialSetWrappedCellValue(sheet.cell(map.tsNo), textField(header, ['tsNo']), 16, 1);
  officialSetWrappedCellValue(sheet.cell(map.codeNo), textField(header, ['codeNo']), 16, 1);
  officialSetWrappedCellValue(sheet.cell(map.workOrderNo), textField(header, ['workOrderNo']), 18, 1);
  officialSetWrappedCellValue(sheet.cell(map.comments), officialComments(header, notes), 72, 2);
  officialSetWrappedCellValue(sheet.cell(map.departmentManager), textField(header, ['departmentManager']), 22, 1);
  officialSetWrappedCellValue(sheet.cell(map.requisitionedBy), textField(header, ['requisitionedBy'], requestedBy), 22, 1);
  officialSetWrappedCellValue(sheet.cell(map.authorizedBy), textField(header, ['authorizedBy']), 22, 1);
}

function officialLineDescription(item: RequisitionPdfItem) {
  const notes = cleanPdfText(item.notes);
  const description = item.description || item.partNumber || '';
  return notes ? `${description} - Notes: ${notes}` : description;
}

function officialWriteLineRow(sheet: XlsxSheet, columns: OfficialLineCellMap, row: number, item: RequisitionPdfItem | undefined) {
  const quantityCell = `${columns.quantity}${row}`;
  const unitCell = `${columns.unitOfMeasure}${row}`;
  const itemNumberCell = sheet.cell(`${columns.itemNumber}${row}`);
  const descriptionCell = sheet.cell(`${columns.itemDescription}${row}`);
  const dueDateCell = `${columns.dueDate}${row}`;
  const unitPriceCell = sheet.cell(`${columns.unitPrice}${row}`);
  const totalPriceCell = sheet.cell(`${columns.totalPrice}${row}`);

  if (!item) {
    officialClearCellFully(sheet.cell(quantityCell));
    officialClearCellFully(sheet.cell(unitCell));
    officialClearCellFully(itemNumberCell);
    officialClearCellFully(descriptionCell);
    officialClearCellFully(sheet.cell(dueDateCell));
    officialClearCellFully(unitPriceCell);
    officialClearCellFully(totalPriceCell);
    return;
  }

  const quantity = Number(item.quantityRequested ?? 0) || 0;
  const unitPrice = Number(item.unitCost ?? 0) || 0;
  officialSetCellValue(sheet, quantityCell, quantity);
  officialSetCellValue(sheet, unitCell, item.unitOfMeasure || 'EA');
  const itemNumberLines = officialSetWrappedCellValue(itemNumberCell, item.supplierPartNumber || item.partNumber || '', 22, 2);
  const descriptionLines = officialSetWrappedCellValue(descriptionCell, officialLineDescription(item), 54, 2);
  officialSetCellValue(sheet, dueDateCell, officialParseDateInput(item.dueDate ?? ''));

  if (typeof unitPriceCell.formula === 'function') unitPriceCell.formula(undefined);
  if (typeof totalPriceCell.formula === 'function') totalPriceCell.formula(undefined);
  unitPriceCell.value(unitPrice);
  totalPriceCell.value(quantity * unitPrice);

  try {
    const lineCount = Math.max(itemNumberLines, descriptionLines);
    sheet.row?.(row).height?.(Math.min(46, 20 + (lineCount - 1) * 12));
  } catch {
    // Keep export moving if row-height changes are rejected.
  }
  try {
    unitPriceCell.style?.({ fontSize: 8, numberFormat: '$#,##0.00', shrinkToFit: true });
    totalPriceCell.style?.({ fontSize: 8, numberFormat: '$#,##0.00', shrinkToFit: true });
  } catch {
    // Keep export moving if a template rejects style updates.
  }
}

function officialWriteLineItems(sheet: XlsxSheet, map: OfficialTemplateCellMap, items: RequisitionPdfItem[]) {
  for (let row = map.lineStartRow; row <= map.lineEndRow; row += 1) {
    officialWriteLineRow(sheet, map.line, row, items[row - map.lineStartRow]);
  }
}

function officialWriteGrandTotal(sheet: XlsxSheet, grandTotalCell: string, total: number) {
  const cell = sheet.cell(grandTotalCell);
  if (typeof cell.formula === 'function') cell.formula(undefined);
  cell.value(Number.isFinite(total) ? total : 0);
  try {
    cell.style?.({ fontSize: 8, numberFormat: '$#,##0.00', shrinkToFit: true });
  } catch {
    // Keep export moving if the template rejects style updates.
  }
}

function officialSetColumnWidth(sheet: XlsxSheet, column: string, width: number) {
  try {
    sheet.column?.(column).width?.(width);
  } catch {
    // Keep template column width if a workbook implementation rejects the update.
  }
}

function officialApplyWorkbookLayout(sheet: XlsxSheet, type: RequisitionTemplateKind) {
  try {
    sheet.pageMarginsPreset?.('mcc-tight', { left: 0.18, right: 0.18, top: 0.42, bottom: 0.42, header: 0.15, footer: 0.15 });
    sheet.printOptions?.('horizontalCentered', true);
  } catch {
    // Margin/print options are layout polish only; keep generation moving.
  }

  if (type === 'under-100') {
    officialSetColumnWidth(sheet, 'C', 15.2);
    officialSetColumnWidth(sheet, 'D', 10.2);
    officialSetColumnWidth(sheet, 'E', 10.2);
    officialSetColumnWidth(sheet, 'F', 10.6);
    officialSetColumnWidth(sheet, 'G', 11.2);
    officialSetColumnWidth(sheet, 'H', 11.2);
    officialSetColumnWidth(sheet, 'L', 10.4);
    officialSetColumnWidth(sheet, 'M', 10.4);
    officialSetColumnWidth(sheet, 'N', 9.6);
  } else {
    officialSetColumnWidth(sheet, 'D', 24.6);
    officialSetColumnWidth(sheet, 'G', 11.1);
    officialSetColumnWidth(sheet, 'H', 11.2);
    officialSetColumnWidth(sheet, 'I', 10.8);
    officialSetColumnWidth(sheet, 'M', 11.4);
    officialSetColumnWidth(sheet, 'O', 8.8);
  }
}

function officialAdjustHeaderSpacing(sheet: XlsxSheet, type: RequisitionTemplateKind) {
  try {
    if (type === 'under-100') {
      sheet.row?.(6).height?.(20);
      sheet.row?.(12).height?.(20);
      sheet.row?.(13).height?.(18);
      sheet.row?.(14).height?.(18);
      sheet.row?.(18).height?.(18);
      sheet.row?.(19).height?.(20);
    } else {
      sheet.row?.(7).height?.(20);
      sheet.row?.(13).height?.(20);
      sheet.row?.(14).height?.(18);
      sheet.row?.(15).height?.(18);
      sheet.row?.(19).height?.(19);
    }
  } catch {
    // Keep original template layout if row height changes are rejected.
  }
  if (type !== 'under-100') return;
  try {
    sheet.cell('B13').style?.({ fontSize: 7, shrinkToFit: true, verticalAlignment: 'center' });
    sheet.cell('B14').style?.({ fontSize: 7, shrinkToFit: true, verticalAlignment: 'center' });
  } catch {
    // Decorative helper label update only.
  }
}

function officialShiftUnder100TitleRight(sheet: XlsxSheet, type: RequisitionTemplateKind) {
  if (type !== 'under-100') return;
  const titleCell = sheet.cell('A4');
  const currentText = String(titleCell.value() ?? '').trim();
  if (!currentText) return;
  if (typeof titleCell.formula === 'function') titleCell.formula(undefined);
  titleCell.value(`  ${currentText}`);
  try {
    titleCell.style?.({ bold: true, horizontalAlignment: 'left', underline: true, verticalAlignment: 'center' });
  } catch {
    // Keep template styling if style update is not supported.
  }
}

async function officialWorkbookBuffer(input: { header: Record<string, unknown>; items: RequisitionPdfItem[]; notes: string; requestedBy: string; total: number; type: RequisitionTemplateKind; vendor: string }) {
  const map = officialTemplateMaps[input.type];
  if (!fs.existsSync(map.templatePath)) throw new Error(`Official requisition workbook template is missing: ${path.basename(map.templatePath)}`);
  // MIT3 parity: fill the official JBT XLSX template instead of redrawing price fields by PDF coordinates.
  const workbook = await XlsxPopulate.fromFileAsync(map.templatePath);
  const sheet = workbook.sheet(0) as XlsxSheet;
  officialApplyWorkbookLayout(sheet, input.type);
  officialWriteHeader(sheet, map.header, input);
  officialAdjustHeaderSpacing(sheet, input.type);
  officialWriteLineItems(sheet, map, input.items);
  officialWriteGrandTotal(sheet, map.grandTotal, input.total);
  officialShiftUnder100TitleRight(sheet, input.type);
  return workbookOutputToBuffer(await workbook.outputAsync());
}

function officialSafeFileBase(value: string) {
  return value
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90) || 'MCC_Requisition';
}

function commandOutputMessage(output: ReturnType<typeof spawnSync>) {
  const stderr = String(output.stderr ?? '').trim();
  const stdout = String(output.stdout ?? '').trim();
  if (stderr) return stderr;
  if (stdout) return stdout;
  return output.status === null ? 'Process did not finish.' : `Process exited with status ${output.status}.`;
}

function tryExcelComPdfExport(xlsxPath: string, pdfPath: string, choices: OfficialPdfChoices) {
  if (process.platform !== 'win32') return false;
  const script = `
param(
  [Parameter(Mandatory=$true)][string]$XlsxPath,
  [Parameter(Mandatory=$true)][string]$PdfPath,
  [string]$TaxExempt = "",
  [string]$MaterialCert = "",
  [string]$Fob = ""
)
$excel = $null
$workbook = $null
$worksheet = $null
$workbookClosed = $false
function Normalize-Choice([string]$value) {
  if ($null -eq $value) { return "" }
  return $value.Trim().ToLowerInvariant()
}
function Set-FormCheckbox($checkbox, [bool]$checked) {
  $value = if ($checked) { 1 } else { -4146 }
  try {
    $checkbox.Value = $value
    return $true
  } catch {}
  try {
    $checkbox.ControlFormat.Value = $value
    return $true
  } catch {}
  try {
    $checkbox.OLEFormat.Object.Value = $checked
    return $true
  } catch {}
  return $false
}
function Add-CheckboxControl($items, $seen, [string]$kind, $object, [string]$name, [string]$caption, [double]$left, [double]$top) {
  $key = if ($name.Trim()) { $name.Trim() } else { "$kind-$left-$top-$caption" }
  if ($seen.ContainsKey($key)) { return }
  $seen[$key] = $true
  $items.Add([PSCustomObject]@{
    Kind = $kind
    Object = $object
    Name = $name
    Caption = $caption
    Left = $left
    Top = $top
  }) | Out-Null
}
function Get-CheckboxControls($worksheet) {
  $items = New-Object System.Collections.ArrayList
  $seen = @{}
  try {
    foreach ($cb in $worksheet.CheckBoxes()) {
      $name = ""
      $caption = ""
      $left = 0
      $top = 0
      try { $name = [string]$cb.Name } catch {}
      try { $caption = [string]$cb.Caption } catch {}
      try { $left = [double]$cb.Left } catch {}
      try { $top = [double]$cb.Top } catch {}
      Add-CheckboxControl $items $seen "CheckBox" $cb $name $caption $left $top
    }
  } catch {}
  try {
    foreach ($shape in $worksheet.Shapes) {
      $name = ""
      $caption = ""
      $left = 0
      $top = 0
      $type = $null
      try { $name = [string]$shape.Name } catch {}
      try { $caption = [string]$shape.TextFrame.Characters().Text } catch {}
      try { $left = [double]$shape.Left } catch {}
      try { $top = [double]$shape.Top } catch {}
      try { $type = $shape.Type } catch {}
      if ($type -eq 8 -or $name -match "Check|Box|Option" -or $caption -match "YES|NO|Origin|Destination") {
        Add-CheckboxControl $items $seen "Shape" $shape $name $caption $left $top
      }
    }
  } catch {}
  return $items.ToArray()
}
function Group-CheckboxRows($items, [double]$tolerance) {
  $rows = @()
  foreach ($item in ($items | Sort-Object Top, Left)) {
    $matched = $false
    foreach ($row in $rows) {
      if ([Math]::Abs(([double]$row.Top) - ([double]$item.Top)) -le $tolerance) {
        $row.Items = @($row.Items + $item)
        $matched = $true
        break
      }
    }
    if (-not $matched) {
      $rows += [PSCustomObject]@{
        Top = [double]$item.Top
        Items = @($item)
      }
    }
  }
  foreach ($row in $rows) {
    $row.Items = @($row.Items | Sort-Object Left)
  }
  return @($rows | Sort-Object Top)
}
function Get-ExactRowItems($row, [int]$expectedCount) {
  $items = @($row.Items | Sort-Object Left)
  if ($items.Count -eq $expectedCount) { return $items }
  return @()
}
function Set-RequisitionCheckboxes($worksheet, [string]$taxExempt, [string]$materialCert, [string]$fob) {
  $tax = Normalize-Choice $taxExempt
  $mat = Normalize-Choice $materialCert
  $fobChoice = Normalize-Choice $fob
  $checkboxes = @(Get-CheckboxControls $worksheet | Sort-Object Top, Left)
  if ($checkboxes.Count -lt 4) { return }
  foreach ($item in $checkboxes) {
    Set-FormCheckbox $item.Object $false | Out-Null
  }
  $headerBoxes = @($checkboxes | Where-Object { $_.Top -lt 260 } | Sort-Object Top, Left)
  $taxMaterialBoxes = @(
    $headerBoxes |
      Where-Object {
        ($_.Caption -match "YES|NO" -and $_.Left -gt 250 -and $_.Left -lt 540) -or
        ($_.Left -gt 300 -and $_.Left -lt 520)
      } |
      Sort-Object Top, Left
  )
  $fobBoxes = @(
    $headerBoxes |
      Where-Object {
        ($_.Caption -match "Origin|Destination") -or
        ($_.Left -ge 520)
      } |
      Sort-Object Top, Left
  )
  $taxMaterialRows = @(Group-CheckboxRows $taxMaterialBoxes 8)
  $fobRows = @(Group-CheckboxRows $fobBoxes 8)
  if ($taxMaterialRows.Count -ge 2) {
    $taxRow = @(Get-ExactRowItems $taxMaterialRows[0] 2)
    $matRow = @(Get-ExactRowItems $taxMaterialRows[1] 2)
    if ($taxRow.Count -eq 2) {
      Set-FormCheckbox $taxRow[0].Object ($tax -eq "yes") | Out-Null
      Set-FormCheckbox $taxRow[1].Object ($tax -ne "yes") | Out-Null
    }
    if ($matRow.Count -eq 2) {
      Set-FormCheckbox $matRow[0].Object ($mat -eq "yes") | Out-Null
      Set-FormCheckbox $matRow[1].Object ($mat -ne "yes") | Out-Null
    }
  }
  if ($fobRows.Count -ge 2) {
    $originRow = @(Get-ExactRowItems $fobRows[0] 1)
    $destinationRow = @(Get-ExactRowItems $fobRows[1] 1)
    if ($originRow.Count -eq 1) {
      Set-FormCheckbox $originRow[0].Object ($fobChoice -eq "origin") | Out-Null
    }
    if ($destinationRow.Count -eq 1) {
      Set-FormCheckbox $destinationRow[0].Object ($fobChoice -eq "destination") | Out-Null
    }
  }
}
try {
  if (-not (Test-Path -LiteralPath $XlsxPath)) { throw "Workbook was not found: $XlsxPath" }
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.AskToUpdateLinks = $false
  $excel.DisplayAlerts = $false
  $excel.EnableEvents = $false
  $workbook = $excel.Workbooks.Open($XlsxPath, 0, $true)
  $worksheet = $workbook.Worksheets.Item(1)
  $worksheet.Activate() | Out-Null
  try { Set-RequisitionCheckboxes $worksheet $TaxExempt $MaterialCert $Fob } catch {}
  try {
    $worksheet.PageSetup.Zoom = $false
    $worksheet.PageSetup.FitToPagesWide = 1
    $worksheet.PageSetup.FitToPagesTall = 1
    $worksheet.PageSetup.CenterHorizontally = $true
    $worksheet.PageSetup.CenterVertically = $false
    $worksheet.PageSetup.LeftMargin = $excel.InchesToPoints(0.90)
    $worksheet.PageSetup.RightMargin = $excel.InchesToPoints(0.35)
    $worksheet.PageSetup.TopMargin = $excel.InchesToPoints(0.35)
    $worksheet.PageSetup.BottomMargin = $excel.InchesToPoints(0.35)
  } catch {}
  try { $excel.CalculateFullRebuild() } catch {}
  $workbook.ExportAsFixedFormat(0, $PdfPath)
  $workbook.Close($false)
  $workbookClosed = $true
  if (-not (Test-Path -LiteralPath $PdfPath)) { throw "PDF was not created." }
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
} finally {
  if (($workbook -ne $null) -and (-not $workbookClosed)) { try { $workbook.Close($false) } catch {} }
  if ($excel -ne $null) { try { $excel.Quit() } catch {} }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}`;
  const scriptPath = path.join(path.dirname(xlsxPath), 'export-requisition-pdf.ps1');
  fs.writeFileSync(scriptPath, script);
  const output = spawnSync('powershell.exe', ['-NoProfile','-ExecutionPolicy','Bypass','-File',scriptPath,'-XlsxPath',xlsxPath,'-PdfPath',pdfPath,'-TaxExempt',choices.taxExempt,'-MaterialCert',choices.materialCert,'-Fob',choices.fob], {
    encoding: 'utf8',
    timeout: 90_000,
    windowsHide: true,
  });
  if (output.status === 0 && fs.existsSync(pdfPath)) return true;
  void commandOutputMessage(output);
  return false;
}

function libreOfficeCandidates() {
  return [
    'soffice',
    'libreoffice',
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
  ];
}

function tryLibreOfficePdfExport(xlsxPath: string, pdfPath: string, outputDir: string) {
  for (const candidate of libreOfficeCandidates()) {
    const output = spawnSync(candidate, ['--headless','--convert-to','pdf','--outdir',outputDir,xlsxPath], {
      encoding: 'utf8',
      timeout: 90_000,
      windowsHide: true,
    });
    if (output.status === 0 && fs.existsSync(pdfPath)) return true;
  }
  return false;
}

function convertOfficialWorkbookToPdf(workbook: Buffer, fileNameBase: string, choices: OfficialPdfChoices) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcc-requisition-'));
  try {
    const safeBase = officialSafeFileBase(fileNameBase);
    const xlsxPath = path.join(tempDir, `${safeBase}.xlsx`);
    const pdfPath = path.join(tempDir, `${safeBase}.pdf`);
    fs.writeFileSync(xlsxPath, workbook);
    const converted = tryExcelComPdfExport(xlsxPath, pdfPath, choices) || tryLibreOfficePdfExport(xlsxPath, pdfPath, tempDir);
    if (!converted || !fs.existsSync(pdfPath)) {
      throw new Error('Official requisition PDF export failed. Microsoft Excel or LibreOffice could not convert the MIT3 workbook template.');
    }
    const pdf = fs.readFileSync(pdfPath);
    if (!pdf.length) throw new Error('Official requisition PDF export failed. The generated PDF was empty.');
    return pdf;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function chunkRequisitionItems(items: RequisitionPdfItem[], size: number) {
  const chunks: RequisitionPdfItem[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks.length ? chunks : [[]];
}

async function mergeOfficialPdfPages(pdfPages: Buffer[]) {
  if (pdfPages.length === 1) return pdfPages[0];
  const mergedPdf = await PDFDocument.create();
  for (const bytes of pdfPages) {
    const sourcePdf = await PDFDocument.load(bytes);
    const copiedPages = await mergedPdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
    copiedPages.forEach(page => mergedPdf.addPage(page));
  }
  const pageNumberFont = await mergedPdf.embedFont(StandardFonts.Helvetica);
  const pages = mergedPdf.getPages();
  pages.forEach((page, index) => {
    const { width } = page.getSize();
    page.drawText(`Page ${index + 1} of ${pages.length}`, { x: width - 82, y: 16, size: 7, font: pageNumberFont, color: pdfBlack });
  });
  return Buffer.from(await mergedPdf.save());
}

async function buildOfficialRequisitionPdf(input: { vendor: string; requisitionNumber: string; requestedBy: string; createdAt: string; notes: string; requisitionType?: string; header?: Record<string, unknown>; items: RequisitionPdfItem[] }) {
  const header = isRecord(input.header) ? input.header : {};
  const total = input.items.reduce((sum, item) => sum + (Number(item.unitCost ?? 0) || 0) * (Number(item.quantityRequested ?? 0) || 0), 0);
  const type = normalizedRequisitionType(input.requisitionType || textField(header, ['requisitionType']), total);
  const rowsPerPage = officialTemplateMaps[type].lineEndRow - officialTemplateMaps[type].lineStartRow + 1;
  const chunks = chunkRequisitionItems(input.items, rowsPerPage);
  const choices = {
    fob: textField(header, ['fob'], 'Destination'),
    materialCert: textField(header, ['materialCert','material_cert'], 'No'),
    taxExempt: textField(header, ['taxExempt','tax_exempt'], 'No'),
  };
  const pdfPages: Buffer[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const pageHeader = chunks.length > 1
      ? { ...header, comments: `${textField(header, ['comments'], input.notes).trim() || 'Maintenance inventory restock.'} Page ${index + 1} of ${chunks.length}.` }
      : header;
    const workbook = await officialWorkbookBuffer({
      header: pageHeader,
      items: chunks[index],
      notes: input.notes,
      requestedBy: input.requestedBy,
      total,
      type,
      vendor: input.vendor,
    });
    const pageBase = chunks.length > 1 ? `${input.requisitionNumber}-page-${index + 1}` : input.requisitionNumber;
    pdfPages.push(convertOfficialWorkbookToPdf(workbook, `MCC_Requisition_${pageBase}`, choices));
  }
  return mergeOfficialPdfPages(pdfPages);
}

const over100Positions: StampPositions = {
  poNo: { x: 220, topY: 96 },
  poInitiator: { x: 394, topY: 96 },
  shipVia: { x: 525, topY: 96 },
  poClass: { x: 220, topY: 113 },
  taxExemptYes: { x: 401, topY: 111 },
  taxExemptNo: { x: 441, topY: 111 },
  fobOrigin: { x: 535, topY: 111 },
  fobDestination: { x: 535, topY: 124 },
  reqDate: { x: 220, topY: 130 },
  materialCertYes: { x: 401, topY: 127 },
  materialCertNo: { x: 441, topY: 127 },
  vendorName: { x: 220, topY: 148 },
  confirmedWith: { x: 394, topY: 148 },
  vendorAddressLine1: { x: 220, topY: 158 },
  vendorAddressLine2: { x: 220, topY: 168 },
  partNo: { x: 565, topY: 157 },
  jobNo: { x: 565, topY: 167 },
  assetNo: { x: 394, topY: 177 },
  moldNo: { x: 565, topY: 177 },
  initials: { x: 493, topY: 187 },
  tsNo: { x: 565, topY: 187 },
  codeNo: { x: 565, topY: 197 },
  workOrderNo: { x: 220, topY: 207 },
  equipmentNo: { x: 355, topY: 207 },
  tableHeaderTopY: 228,
  lineStartTopY: 248,
  lineRowHeight: 18,
  maxLineRows: 12,
  lineQuantityX: 152,
  lineUnitX: 186,
  lineItemNumberX: 220,
  lineDescriptionX: 308,
  lineDueDateX: 486,
  lineUnitPriceX: 535,
  lineTotalPriceX: 570,
  lineBoxes: {
    quantity: { x: 147, topY: 238, width: 30, height: 35 },
    unit: { x: 178, topY: 238, width: 39, height: 35 },
    itemNumber: { x: 218, topY: 238, width: 86, height: 35 },
    description: { x: 306, topY: 238, width: 167, height: 35 },
    dueDate: { x: 475, topY: 238, width: 49, height: 35 },
    unitPrice: { x: 525, topY: 238, width: 37, height: 35 },
    totalPrice: { x: 563, topY: 238, width: 55, height: 35 },
  },
  lineRowTopYs: [238, 274, 316, 346, 365, 386, 416, 428, 440, 452, 464, 482],
  vendorTotal: { x: 628, topY: 229 },
  vendorTotalBox: { x: 589, topY: 220, width: 30, height: 16 },
  comments: { x: 220, topY: 507 },
  departmentManager: { x: 525, topY: 507 },
  requisitionedBy: { x: 356, topY: 557 },
  requisitionedByBox: { x: 355, topY: 545, width: 118, height: 12 },
  authorizedBy: { x: 525, topY: 557 },
};

const under100Positions: StampPositions = {
  ...over100Positions,
  poNo: { x: 170, topY: 133 },
  poInitiator: { x: 374, topY: 133 },
  shipVia: { x: 600, topY: 133 },
  poClass: { x: 170, topY: 156 },
  taxExemptYes: { x: 381, topY: 151 },
  taxExemptNo: { x: 433, topY: 151 },
  fobOrigin: { x: 612, topY: 150 },
  fobDestination: { x: 612, topY: 168 },
  reqDate: { x: 170, topY: 180 },
  materialCertYes: { x: 381, topY: 173 },
  materialCertNo: { x: 433, topY: 173 },
  vendorName: { x: 170, topY: 203 },
  confirmedWith: { x: 374, topY: 203 },
  vendorAddressLine1: { x: 170, topY: 215 },
  vendorAddressLine2: { x: 170, topY: 227 },
  partNo: { x: 643, topY: 216 },
  jobNo: { x: 643, topY: 228 },
  assetNo: { x: 374, topY: 238 },
  moldNo: { x: 643, topY: 240 },
  initials: { x: 509, topY: 249 },
  tsNo: { x: 643, topY: 253 },
  codeNo: { x: 643, topY: 266 },
  workOrderNo: { x: 170, topY: 276 },
  equipmentNo: { x: 419, topY: 276 },
  tableHeaderTopY: 299,
  lineStartTopY: 326,
  lineRowHeight: 12,
  maxLineRows: 10,
  lineQuantityX: 58,
  lineUnitX: 89,
  lineItemNumberX: 170,
  lineDescriptionX: 238,
  lineDueDateX: 508,
  lineUnitPriceX: 598,
  lineTotalPriceX: 643,
  lineBoxes: {
    quantity: { x: 59, topY: 326, width: 29, height: 34 },
    unit: { x: 90, topY: 326, width: 79, height: 34 },
    itemNumber: { x: 171, topY: 326, width: 66, height: 34 },
    description: { x: 238, topY: 326, width: 268, height: 34 },
    dueDate: { x: 508, topY: 326, width: 89, height: 34 },
    unitPrice: { x: 598, topY: 326, width: 43, height: 34 },
    totalPrice: { x: 644, topY: 326, width: 88, height: 34 },
  },
  lineRowTopYs: [326, 361, 403, 414, 426, 437, 449, 460, 472, 483],
  vendorTotal: { x: 697, topY: 307 },
  vendorTotalBox: { x: 687, topY: 306, width: 44, height: 16 },
  comments: { x: 170, topY: 518 },
  departmentManager: { x: 598, topY: 524 },
  requisitionedBy: { x: 327, topY: 546 },
  requisitionedByBox: { x: 327, topY: 534, width: 181, height: 12 },
  authorizedBy: { x: 598, topY: 546 },
};

const positionsByType: Record<RequisitionTemplateKind, StampPositions> = {
  'over-100': over100Positions,
  'under-100': under100Positions,
};

function normalizedRequisitionType(rawType: string, total: number): RequisitionTemplateKind {
  const clean = rawType.toLowerCase();
  if (clean.includes('over')) return 'over-100';
  if (clean.includes('under')) return 'under-100';
  return total >= 100 ? 'over-100' : 'under-100';
}

function yFromTop(pageHeight: number, topY: number, fontSize = 8) {
  return pageHeight - topY - fontSize;
}

function money(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number.isFinite(value) ? value : 0);
}

function formatRequisitionDate(value: string | undefined) {
  if (!value) return '';
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Date(year, month - 1, day).toLocaleDateString('en-US');
}
function isoDateOnly(value: string | null | undefined) {
  if (!value) return '';
  return value.slice(0, 10);
}
function localDateOnly(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function cleanPdfText(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function truncatePdfText(text: string, maxLength: number) {
  const clean = cleanPdfText(text);
  return clean.length > maxLength ? `${clean.slice(0, Math.max(0, maxLength - 3))}...` : clean;
}

function truncateToFit(text: string, font: PDFFont, size: number, maxWidth: number, forceEllipsis = false) {
  const clean = cleanPdfText(text);
  if (!forceEllipsis && font.widthOfTextAtSize(clean, size) <= maxWidth) return clean;
  const suffix = '...';
  let value = clean.replace(/\.\.\.$/, '');
  while (value.length > 0 && font.widthOfTextAtSize(`${value}${suffix}`, size) > maxWidth) value = value.slice(0, -1);
  return value ? `${value}${suffix}` : '';
}

function fitTextToWidth(text: string, font: PDFFont, size: number, maxWidth: number, minSize = 5.5) {
  let fittedSize = size;
  while (fittedSize > minSize && font.widthOfTextAtSize(text, fittedSize) > maxWidth) {
    fittedSize = Math.max(minSize, fittedSize - 0.25);
  }
  return fittedSize;
}

function shrinkToWidth(text: string, font: PDFFont, size: number, maxWidth: number) {
  return truncateToFit(text, font, size, maxWidth);
}

function drawTextSafe(
  page: PDFPage,
  text: string | number | undefined | null,
  x: number,
  topY: number,
  options: { font: PDFFont; maxLength?: number; maxWidth?: number; pageHeight: number; size?: number; bold?: boolean }
) {
  const value = cleanPdfText(text);
  if (!value) return;
  const size = options.size ?? 8;
  const truncated = options.maxLength ? truncatePdfText(value, options.maxLength) : value;
  const finalText = options.maxWidth ? shrinkToWidth(truncated, options.font, size, options.maxWidth) : truncated;
  page.drawText(finalText, { x, y: yFromTop(options.pageHeight, topY, size), size, font: options.font, color: pdfBlack });
}

function wrapPdfText(text: string, font: PDFFont, size: number, maxWidth: number, maxLines: number) {
  const words = cleanPdfText(text).split(' ').filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (font.widthOfTextAtSize(word, size) > maxWidth) {
      if (current) {
        lines.push(current);
        current = '';
      }
      lines.push(truncateToFit(word, font, size, maxWidth));
      continue;
    }
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) {
      current = next;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  const visible = lines.slice(0, maxLines);
  if (lines.length > maxLines && visible.length) {
    visible[visible.length - 1] = truncateToFit(visible[visible.length - 1], font, size, maxWidth, true);
  }
  return visible.length ? visible : [''];
}
function drawTextInBox(
  page: PDFPage,
  text: string | number | undefined | null,
  box: PdfBox,
  options: { align?: 'left' | 'center' | 'right'; font: PDFFont; lineHeight?: number; maxLines?: number; minSize?: number; pageHeight: number; paddingX?: number; size?: number; vertical?: 'middle' | 'top' }
) {
  const value = cleanPdfText(text);
  if (!value) return;
  let size = options.size ?? 8;
  const paddingX = options.paddingX ?? 2;
  const maxLines = options.maxLines ?? 1;
  const maxWidth = Math.max(4, box.width - paddingX * 2);
  const lines = maxLines === 1
    ? (() => {
        size = fitTextToWidth(value, options.font, size, maxWidth, options.minSize ?? 5.5);
        return [truncateToFit(value, options.font, size, maxWidth)];
      })()
    : wrapPdfText(value, options.font, size, maxWidth, maxLines);
  const lineHeight = options.lineHeight ?? size + 2;
  const blockHeight = lines.length * lineHeight;
  const startTopY = options.vertical === 'top' ? box.topY + 2 : box.topY + Math.max(0, (box.height - blockHeight) / 2);
  lines.forEach((line, index) => {
    const lineWidth = options.font.widthOfTextAtSize(line, size);
    const align = options.align ?? 'left';
    const x = align === 'right'
      ? Math.max(box.x + paddingX, box.x + box.width - paddingX - lineWidth)
      : align === 'center'
        ? box.x + Math.max(0, (box.width - lineWidth) / 2)
        : box.x + paddingX;
    page.drawText(line, { x, y: yFromTop(options.pageHeight, startTopY + index * lineHeight, size), size, font: options.font, color: pdfBlack });
  });
}
function clearPdfBox(page: PDFPage, box: PdfBox, pageHeight: number, insetX = 1, insetY = 1) {
  page.drawRectangle({
    x: box.x + insetX,
    y: pageHeight - box.topY - box.height + insetY,
    width: Math.max(1, box.width - insetX * 2),
    height: Math.max(1, box.height - insetY * 2),
    color: rgb(1, 1, 1),
  });
}
function drawCurrencyInBox(
  page: PDFPage,
  value: number,
  box: PdfBox,
  options: { font: PDFFont; pageHeight: number; paddingX?: number; size?: number }
) {
  const amount = Number.isFinite(value) ? value : 0;
  // MIT3 parity: the official JBT templates include placeholder prices ($0.00 / $ -).
  // Clear the cell interior first so MCC draws exactly one fitted price value.
  clearPdfBox(page, box, options.pageHeight);
  drawTextInBox(page, money(amount), box, {
    align: 'right',
    font: options.font,
    maxLines: 1,
    minSize: 4.2,
    paddingX: options.paddingX ?? 4,
    pageHeight: options.pageHeight,
    size: options.size ?? 6.8,
  });
}
function drawCheckMark(page: PDFPage, selected: boolean, point: PdfPoint, font: PDFFont, pageHeight: number) {
  if (!selected) return;
  page.drawText('X', { x: point.x, y: yFromTop(pageHeight, point.topY, 8), size: 8, font, color: pdfBlack });
}

function getHeaderComments(header: Record<string, unknown>, notes: string) {
  const comments = cleanPdfText(textField(header, ['comments'], notes));
  const priority = cleanPdfText(textField(header, ['priority'])).toLowerCase();
  if (priority !== 'high') return comments;
  return comments ? (/^high priority\b/i.test(comments) ? comments : `HIGH PRIORITY - ${comments}`) : 'HIGH PRIORITY';
}

function getVendorContactLines(header: Record<string, unknown>) {
  const contactLines = textField(header, ['vendorAddress'])
    .split(/\r?\n/)
    .map(line => cleanPdfText(line))
    .filter(Boolean);
  if (contactLines.length <= 2) return contactLines;
  return [contactLines[0], contactLines.slice(1).join(' | ')];
}

function drawLineTableHeaders(_page: PDFPage, _positions: StampPositions, _boldFont: PDFFont, _pageHeight: number) {
  // The JBT templates already include table headers. Keep normal output clean.
}
function polishUnder100TemplateLabels(page: PDFPage, boldFont: PDFFont, regularFont: PDFFont, pageHeight: number) {
  const white = rgb(1, 1, 1);

  page.drawRectangle({ x: 55, y: pageHeight - 123, width: 156, height: 25, color: white });
  page.drawText('REQUISITION Under $100.00', { x: 61, y: yFromTop(pageHeight, 111, 10.5), size: 10.5, font: boldFont, color: pdfBlack });
  page.drawLine({ start: { x: 61, y: yFromTop(pageHeight, 125, 0) }, end: { x: 201, y: yFromTop(pageHeight, 125, 0) }, thickness: 0.8, color: pdfBlack });

  page.drawRectangle({ x: 323, y: pageHeight - 140, width: 54, height: 15, color: white });
  page.drawText('P.O. Initiator', { x: 324, y: yFromTop(pageHeight, 135, 8.5), size: 8.5, font: regularFont, color: pdfBlack });
}

function stampHeader(input: {
  boldFont: PDFFont;
  header: Record<string, unknown>;
  notes: string;
  page: PDFPage;
  pageHeight: number;
  positions: StampPositions;
  regularFont: PDFFont;
  requestedBy: string;
  requisitionNumber: string;
  vendor: string;
}) {
  const { boldFont, header, notes, page, pageHeight, positions, regularFont } = input;
  const draw = (text: string | number | undefined | null, point: PdfPoint, options: { maxLength?: number; maxWidth?: number; size?: number } = {}) =>
    drawTextSafe(page, text, point.x, point.topY - 7, { font: regularFont, pageHeight, ...options });
  const [vendorAddressLine1 = '', vendorAddressLine2 = ''] = getVendorContactLines(header);
  const fob = cleanPdfText(textField(header, ['fob'])).toLowerCase();
  const taxExempt = cleanPdfText(textField(header, ['taxExempt'], 'No')).toLowerCase();
  const materialCert = cleanPdfText(textField(header, ['materialCert'], 'No')).toLowerCase();

  draw(textField(header, ['poNo']), positions.poNo, { maxLength: 20 });
  draw(textField(header, ['poInitiator']), positions.poInitiator, { maxLength: 28 });
  draw(textField(header, ['shipVia']), positions.shipVia, { maxLength: 24 });
  draw(textField(header, ['poClass']), positions.poClass, { maxLength: 20 });
  draw(formatRequisitionDate(textField(header, ['requestDate', 'reqDate'])), positions.reqDate, { maxLength: 16 });
  draw(textField(header, ['vendorName'], input.vendor), positions.vendorName, { maxLength: 34 });
  draw(textField(header, ['confirmedWith']), positions.confirmedWith, { maxLength: 30 });
  draw(vendorAddressLine1, positions.vendorAddressLine1, { maxLength: 42 });
  draw(vendorAddressLine2, positions.vendorAddressLine2, { maxLength: 42 });
  draw(textField(header, ['partNo']), positions.partNo, { maxLength: 22 });
  draw(textField(header, ['jobNo']), positions.jobNo, { maxLength: 22 });
  draw(textField(header, ['assetNo']), positions.assetNo, { maxLength: 24 });
  draw(textField(header, ['moldNo']), positions.moldNo, { maxLength: 24 });
  draw(textField(header, ['initials']), positions.initials, { maxLength: 10 });
  draw(textField(header, ['tsNo']), positions.tsNo, { maxLength: 18 });
  draw(textField(header, ['codeNo']), positions.codeNo, { maxLength: 18 });
  draw(textField(header, ['workOrderNo']), positions.workOrderNo, { maxLength: 24 });
  draw(textField(header, ['equipmentNo']), positions.equipmentNo, { maxLength: 24 });
  drawTextInBox(page, getHeaderComments(header, notes), { x: positions.comments.x, topY: positions.comments.topY - 11, width: 330, height: 28 }, { font: regularFont, pageHeight, size: 7, maxLines: 2, vertical: 'top' });
  draw(textField(header, ['departmentManager']), positions.departmentManager, { maxLength: 28 });
  drawTextInBox(page, textField(header, ['requisitionedBy'], input.requestedBy), positions.requisitionedByBox, { align: 'center', font: regularFont, pageHeight, size: 7, maxLines: 1 });
  draw(textField(header, ['authorizedBy']), positions.authorizedBy, { maxLength: 28 });

  drawCheckMark(page, taxExempt === 'yes', positions.taxExemptYes, regularFont, pageHeight);
  drawCheckMark(page, taxExempt !== 'yes', positions.taxExemptNo, regularFont, pageHeight);
  drawCheckMark(page, materialCert === 'yes', positions.materialCertYes, regularFont, pageHeight);
  drawCheckMark(page, materialCert !== 'yes', positions.materialCertNo, regularFont, pageHeight);
  drawCheckMark(page, fob.includes('origin'), positions.fobOrigin, boldFont, pageHeight);
  drawCheckMark(page, fob.includes('destination'), positions.fobDestination, boldFont, pageHeight);
}

function stampLineItems(input: {
  items: RequisitionPdfItem[];
  page: PDFPage;
  pageHeight: number;
  positions: StampPositions;
  regularFont: PDFFont;
}) {
  const { items, page, pageHeight, positions, regularFont } = input;
  items.slice(0, positions.maxLineRows).forEach((item, index) => {
    const lineTopY = positions.lineRowTopYs[index] ?? positions.lineStartTopY + index * positions.lineRowHeight;
    const nextLineTopY = positions.lineRowTopYs[index + 1];
    const rowHeight = Math.max(10, (nextLineTopY ?? lineTopY + positions.lineRowHeight) - lineTopY);
    const rowBox = (box: PdfBox): PdfBox => ({ ...box, topY: lineTopY, height: rowHeight });
    const unitPrice = Number(item.unitCost ?? 0) || 0;
    const quantity = Number(item.quantityRequested ?? 0) || 0;
    const itemNumber = item.supplierPartNumber || item.partNumber || '';
    const notes = cleanPdfText(item.notes);
    const description = notes ? `${item.description || '-'} - Notes: ${notes}` : item.description || '-';

    drawTextInBox(page, quantity, rowBox(positions.lineBoxes.quantity), { align: 'center', font: regularFont, pageHeight, size: 7, minSize: 5.5, maxLines: 1 });
    drawTextInBox(page, cleanPdfText(item.unitOfMeasure || 'EA'), rowBox(positions.lineBoxes.unit), { align: 'center', font: regularFont, pageHeight, size: 7, minSize: 5.5, maxLines: 1 });
    drawTextInBox(page, itemNumber, rowBox(positions.lineBoxes.itemNumber), { align: 'center', font: regularFont, pageHeight, size: 7, minSize: 5.5, maxLines: 1 });
    drawTextInBox(page, description, rowBox(positions.lineBoxes.description), { font: regularFont, pageHeight, size: 6.5, lineHeight: 7.5, maxLines: 2, paddingX: 3, vertical: 'top' });
    drawTextInBox(page, formatRequisitionDate(item.dueDate), rowBox(positions.lineBoxes.dueDate), { align: 'center', font: regularFont, pageHeight, size: 7, minSize: 5.5, maxLines: 1 });
    drawCurrencyInBox(page, unitPrice, rowBox(positions.lineBoxes.unitPrice), { font: regularFont, pageHeight, size: 6.8, paddingX: 3 });
    drawCurrencyInBox(page, quantity * unitPrice, rowBox(positions.lineBoxes.totalPrice), { font: regularFont, pageHeight, size: 6.8, paddingX: 5 });
  });
}

async function buildRequisitionPdf(input: { vendor: string; requisitionNumber: string; requestedBy: string; createdAt: string; notes: string; requisitionType?: string; header?: Record<string, unknown>; items: RequisitionPdfItem[] }) {
  return buildOfficialRequisitionPdf(input);
}
function userNameById(id: number | null) {
  if (!id) return '';
  return one<{ full_name: string }>('SELECT full_name FROM users WHERE id=?', [id])?.full_name ?? '';
}
function formatPdfDateTime(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
function drawWrappedPdfText(page: PDFPage, text: string, x: number, topY: number, options: { font: PDFFont; pageHeight: number; size: number; maxWidth: number; lineHeight?: number; color?: ReturnType<typeof rgb>; maxLines?: number }) {
  const clean = cleanPdfText(text) || '-';
  const words = clean.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (options.font.widthOfTextAtSize(next, options.size) <= options.maxWidth) current = next;
    else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  const maxLines = options.maxLines ?? lines.length;
  const visible = lines.slice(0, maxLines);
  if (lines.length > maxLines && visible.length) visible[visible.length - 1] = truncatePdfText(visible[visible.length - 1], Math.max(8, visible[visible.length - 1].length - 3));
  const lineHeight = options.lineHeight ?? options.size + 4;
  visible.forEach((line, index) => {
    page.drawText(line, { x, y: yFromTop(options.pageHeight, topY + index * lineHeight, options.size), size: options.size, font: options.font, color: options.color ?? pdfBlack });
  });
  return Math.max(1, visible.length) * lineHeight;
}
async function buildSingleRequisitionPdf(requisition: RequisitionRow) {
  const lines = requisitionLinesForRow(requisition, { includeDeleted: Boolean(requisition.deleted) });
  const vendors = uniqueTextValues(lines.map(line=>line.vendor_name));
  const locations = uniqueTextValues(lines.map(line=>line.location_name));
  const vendorName = requisitionVendorName(
    requisition.vendor_name && !/^multiple\b/i.test(requisition.vendor_name) ? requisition.vendor_name : vendors[0]
  );
  const locationSummary = locations.length === 1 ? locations[0] : locations.length > 1 ? `Multiple locations (${locations.length})` : requisition.location_name;
  const lifecycleNotes = [
    `Status: ${requisition.status}`,
    lines.length > 1 ? `Lines: ${lines.length}` : '',
    locationSummary ? `Location: ${locationSummary}` : '',
    requisition.ordered_at ? `Ordered: ${userNameById(requisition.ordered_by_user_id) || '-'} ${formatPdfDateTime(requisition.ordered_at)}` : '',
    requisition.received_at ? `Received: ${userNameById(requisition.received_by_user_id) || '-'} ${formatPdfDateTime(requisition.received_at)}` : '',
    requisition.canceled_at ? `Canceled: ${userNameById(requisition.canceled_by_user_id) || '-'} ${formatPdfDateTime(requisition.canceled_at)}` : '',
    requisition.cancel_reason ? `Cancel reason: ${requisition.cancel_reason}` : '',
    requisition.notes ? `Notes: ${requisition.notes}` : '',
  ].filter(Boolean).join(' | ');
  const requisitionedByName = requisition.requisitioned_by_name || requisition.requested_by_name;
  return buildRequisitionPdf({
    vendor: vendorName,
    requisitionNumber: requisition.requisition_number,
    requestedBy: requisitionedByName,
    createdAt: requisition.requested_at,
    notes: lifecycleNotes,
    header: {
      poNo: '',
      requestDate: localDateOnly(),
      vendorName,
      poInitiator: requisition.po_initiator,
      shipVia: requisition.ship_via,
      confirmedWith: requisition.confirmed_with,
      workOrderNo: requisition.work_order_number,
      comments: lifecycleNotes,
      requisitionedBy: requisitionedByName,
      taxExempt: requisition.tax_exempt || 'No',
      materialCert: requisition.material_cert || 'No',
      fob: requisition.fob || 'Destination',
    },
    items: lines.map(line=>({
      partNumber: line.part_number,
      description: line.description,
      locationName: line.location_name,
      quantityRequested: Number(line.quantity_requested ?? 0) || 0,
      unitCost: requisitionLineUnitCost(line),
      supplierPartNumber: line.item_number || line.part_number,
      dueDate: '',
      notes: line.notes,
      unitOfMeasure: line.unit_of_measure || 'EA',
    })),
  });
}
function requisitionLineUnitCost(line: RequisitionLineRow) {
  const snapshot = Number(line.unit_cost ?? 0);
  if (Number.isFinite(snapshot) && snapshot > 0) return snapshot;
  const part = one<{ unit_cost: number | null }>('SELECT unit_cost FROM inventory_parts WHERE id=?', [line.inventory_part_id]);
  const fallback = Number(part?.unit_cost ?? 0);
  return Number.isFinite(fallback) && fallback > 0 ? fallback : 0;
}
function requisitionUnitCost(requisition: RequisitionRow) {
  const snapshot = Number(requisition.unit_cost ?? 0);
  if (Number.isFinite(snapshot) && snapshot > 0) return snapshot;
  const part = one<{ unit_cost: number | null }>('SELECT unit_cost FROM inventory_parts WHERE id=?', [requisition.inventory_part_id]);
  const fallback = Number(part?.unit_cost ?? 0);
  return Number.isFinite(fallback) && fallback > 0 ? fallback : 0;
}
function requisitionById(id: number, options: { includeDeleted?: boolean } = {}) {
  return one<RequisitionRow>(`SELECT * FROM inventory_requisitions WHERE ${options.includeDeleted ? '1=1' : 'deleted=0'} AND id=?`, [id]);
}
function validateQuantityRequested(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error('Qty requested must be a positive number.');
  return parsed;
}
type ParsedRequisitionItem = {
  itemNumber: string;
  notes: string;
  partId: number;
  quantityRequested: number;
  unitOfMeasure: string;
};
type PreparedRequisitionLine = ParsedRequisitionItem & {
  itemNumber: string;
  part: NativePartRow & { location_name?: string | null; vendor_name?: string | null };
  unitCost: number;
};
type RequisitionHeaderInput = {
  confirmedWith: string;
  fob: string;
  materialCert: string;
  notes: string;
  poInitiator: string;
  requisitionedByName: string;
  shipVia: string;
  taxExempt: string;
  workOrderNumber: string;
};
function normalizeYesNoField(value: unknown, fieldName: string, required = false) {
  const clean = cleanPdfText(value);
  if (!clean) {
    if (required) throw new Error(`${fieldName} is required.`);
    return 'No';
  }
  if (/^(yes|y|true|1)$/i.test(clean)) return 'Yes';
  if (/^(no|n|false|0)$/i.test(clean)) return 'No';
  throw new Error(`${fieldName} must be Yes or No.`);
}
function normalizeFobField(value: unknown) {
  const clean = cleanPdfText(value);
  if (!clean) return 'Destination';
  return /origin/i.test(clean) ? 'Origin' : 'Destination';
}
function parseRequisitionHeaderInput(input: Record<string, unknown>, actor: User, options: { requirePreviewFields?: boolean } = {}): RequisitionHeaderInput {
  const requirePreviewFields = Boolean(options.requirePreviewFields);
  const poInitiator = textField(input, ['poInitiator','po_initiator']).slice(0, 160);
  const requisitionedByName = textField(input, ['requisitionedByName','requisitionedBy','requisitioned_by_name'], actor.full_name).slice(0, 160);
  const taxExemptRaw = input.taxExempt ?? input.tax_exempt;
  if (requirePreviewFields && !poInitiator) throw new Error('P.O. Initiator is required.');
  if (requirePreviewFields && !requisitionedByName) throw new Error('Requisitioned By is required.');
  if (requirePreviewFields && cleanPdfText(taxExemptRaw) === '') throw new Error('Tax Exempt is required.');
  return {
    confirmedWith: textField(input, ['confirmedWith','confirmed_with']).slice(0, 160),
    fob: normalizeFobField(input.fob),
    materialCert: normalizeYesNoField(input.materialCert ?? input.material_cert, 'Material Cert'),
    notes: textField(input, ['notes','note']).slice(0, 1000),
    poInitiator,
    requisitionedByName,
    shipVia: textField(input, ['shipVia','ship_via']).slice(0, 120),
    taxExempt: normalizeYesNoField(taxExemptRaw, 'Tax Exempt', requirePreviewFields),
    workOrderNumber: textField(input, ['workOrderNumber','work_order_number','workOrder']).slice(0, 160),
  };
}
function parseRequisitionItemsInput(input: Record<string, unknown>) {
  const rawItems = Array.isArray(input.items) && input.items.length ? input.items : [input];
  const parsedItems = rawItems.map(rawItem => {
    const item = isRecord(rawItem) ? rawItem : {};
    const partId = Number(item.inventoryPartId ?? item.partId ?? item.id);
    if (!Number.isInteger(partId) || partId <= 0) throw new Error('Native inventory part not found.');
    const quantityRequested = item.quantityRequested === undefined && item.quantity === undefined ? 1 : validateQuantityRequested(item.quantityRequested ?? item.quantity);
    return {
      partId,
      quantityRequested,
      notes: textField(item, ['notes','note']).slice(0, 500),
      unitOfMeasure: (textField(item, ['unitOfMeasure','unit','uom']) || 'EA').slice(0, 32),
      itemNumber: textField(item, ['itemNumber','supplierPartNumber','supplierPartNo']).slice(0, 160),
    };
  });
  if (!parsedItems.length) throw new Error('At least one requisition item is required.');
  return parsedItems;
}
function prepareRequisitionLines(items: ParsedRequisitionItem[], allowDuplicate: boolean) {
  return items.map(item => {
    const part = nativePartRowById(item.partId);
    if (!part) throw new Error('Native inventory part not found.');
    if (activeRequisitionCountForPart(item.partId) > 0 && !allowDuplicate) throw new Error('Active requisition already exists for one or more selected parts.');
    const unitCost = Number(part.unit_cost ?? 0);
    return {
      ...item,
      part,
      unitCost: Number.isFinite(unitCost) && unitCost >= 0 ? unitCost : 0,
      itemNumber: item.itemNumber || part.supplier_part_number || part.part_number,
    };
  });
}
function groupedRequisitionLines(lines: PreparedRequisitionLine[]) {
  const vendorGroups = new Map<string, PreparedRequisitionLine[]>();
  for (const item of lines) {
    const key = requisitionVendorKey(item.part.vendor_name);
    const group = vendorGroups.get(key) ?? [];
    group.push(item);
    vendorGroups.set(key, group);
  }
  return vendorGroups;
}
function publicCreatedRequisition(id: number) {
  const row = requisitionById(id, { includeDeleted: true });
  if (!row) throw new Error('Created requisition could not be loaded.');
  const requisition = publicRequisition(row);
  return {
    id: requisition.id,
    requisitionNumber: requisition.requisitionNumber,
    vendorName: requisition.vendorSummary || requisition.vendorName || 'Unknown Vendor',
    lineCount: requisition.lineCount,
    status: requisition.status,
    pdfUrl: `/api/requisitions/${requisition.id}/pdf`,
  };
}
function createGroupedRequisitions(req: AuthRequest, actor: User, input: Record<string, unknown>, options: { requirePreviewFields?: boolean; status: RequisitionStatus; syncParts: boolean }) {
  const parsedItems = parseRequisitionItemsInput(input);
  const allowDuplicate = input.allowDuplicate === true;
  const header = parseRequisitionHeaderInput(input, actor, { requirePreviewFields: options.requirePreviewFields });
  const timestamp = now();
  const createdIds: number[] = [];
  const lineInputs = prepareRequisitionLines(parsedItems, allowDuplicate);
  const vendorGroups = groupedRequisitionLines(lineInputs);

  for (const groupLines of vendorGroups.values()) {
    const firstLine = groupLines[0];
    const totalQuantity = groupLines.reduce((sum,item)=>sum + item.quantityRequested, 0);
    const headerVendor = requisitionVendorName(firstLine.part.vendor_name);
    const headerLocation = summaryText(groupLines.map(item=>item.part.location_name ?? ''), firstLine.part.location_name ?? '');
    const requisitionNumber = requisitionNumberForTimestamp(timestamp);
    const result = run(`INSERT INTO inventory_requisitions (requisition_number,inventory_part_id,part_number,description,vendor_name,location_name,quantity_requested,unit_cost,status,requested_by_user_id,requested_by_name,po_initiator,requisitioned_by_name,tax_exempt,confirmed_with,material_cert,ship_via,fob,requested_at,work_order_number,notes,created_at,updated_at,deleted) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`, [
      requisitionNumber,
      firstLine.part.id,
      firstLine.part.part_number,
      firstLine.part.description,
      headerVendor,
      headerLocation,
      totalQuantity,
      firstLine.unitCost,
      options.status,
      actor.id,
      actor.full_name,
      header.poInitiator,
      header.requisitionedByName,
      header.taxExempt,
      header.confirmedWith,
      header.materialCert,
      header.shipVia,
      header.fob,
      timestamp,
      header.workOrderNumber,
      header.notes,
      timestamp,
      timestamp,
    ]);
    const requisitionId = Number(result.lastInsertRowid);
    createdIds.push(requisitionId);
    for (const item of groupLines) {
      run(`INSERT INTO inventory_requisition_lines (requisition_id,inventory_part_id,part_number,description,vendor_name,location_name,quantity_requested,unit_cost,unit_of_measure,item_number,notes,created_at,updated_at,deleted) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0)`, [
        requisitionId,
        item.part.id,
        item.part.part_number,
        item.part.description,
        item.part.vendor_name ?? '',
        item.part.location_name ?? '',
        item.quantityRequested,
        item.unitCost,
        item.unitOfMeasure || 'EA',
        item.itemNumber,
        item.notes,
        timestamp,
        timestamp,
      ]);
    }
    const auditDetails = {requisitionNumber,vendorName:headerVendor,status:options.status,lineCount:groupLines.length,partIds:groupLines.map(item=>item.part.id),totalQuantity};
    const createAction = options.status === 'Draft'
      ? (vendorGroups.size > 1 ? 'vendor-grouped requisition preview create' : 'requisition preview create')
      : (vendorGroups.size > 1 ? 'vendor-grouped requisition create' : lineInputs.length > 1 ? 'requisition create from selection' : 'requisition create');
    inventoryAudit(req,createAction,'requisition',requisitionId,auditDetails);
    audit(req,createAction,'requisition',requisitionId,auditDetails);
    const historyRow = requisitionById(requisitionId, { includeDeleted: true });
    if (historyRow) {
      recordRequisitionHistory({
        action: options.status === 'Draft' ? 'preview_created' : 'requested',
        actor,
        row: historyRow,
        newValue: requisitionHistoryValue(historyRow),
        createdAt: timestamp,
      });
    }
  }

  if (options.syncParts) syncRequisitionPartFlags(lineInputs.map(item=>item.part.id),timestamp);
  if (lineInputs.length > 1) {
    const overallDetails = {requisitionIds:createdIds,vendorCount:vendorGroups.size,lineCount:lineInputs.length,partIds:lineInputs.map(item=>item.part.id),status:options.status};
    const action = options.status === 'Draft' ? 'requisition preview from selection' : 'requisition create from selection';
    inventoryAudit(req,action,'requisition','selection',overallDetails);
    audit(req,action,'requisition','selection',overallDetails);
  }
  return createdIds.map(publicCreatedRequisition);
}
function requisitionList(statusFilter = '', includeDeleted = false, includeDrafts = false) {
  const params: SqlParam[] = [];
  let where = includeDeleted ? '1=1' : 'deleted=0';
  const cleanStatus = statusFilter.trim();
  if (!cleanStatus) {
    where += " AND status IN ('Requested','Ordered')";
  } else if (cleanStatus.toLowerCase() !== 'all') {
    if (!requisitionStatuses.includes(cleanStatus as RequisitionStatus)) throw new Error('Unsupported requisition status filter.');
    where += ' AND status=?';
    params.push(cleanStatus);
  } else if (!includeDrafts) {
    where += " AND status<>'Draft'";
  }
  return all<RequisitionRow>(`SELECT * FROM inventory_requisitions WHERE ${where} ORDER BY CASE status WHEN 'Requested' THEN 1 WHEN 'Ordered' THEN 2 WHEN 'Received' THEN 3 ELSE 4 END, requested_at DESC, id DESC`, params).map(row=>publicRequisition(row, { includeDeletedLines: includeDeleted }));
}
function requisitionSummary() {
  const count = (status: RequisitionStatus) => one<{ count: number }>('SELECT COUNT(*) AS count FROM inventory_requisitions WHERE deleted=0 AND status=?', [status])?.count ?? 0;
  const requestedCount = count('Requested');
  const orderedCount = count('Ordered');
  return {
    requestedCount,
    orderedCount,
    receivedCount: count('Received'),
    canceledCount: count('Canceled'),
    activeCount: requestedCount + orderedCount,
  };
}
function sendRequisitionError(req: Request, res: Response, operation: string, targetId: string|number, error: unknown) {
  const message = safeErrorMessage(error);
  inventoryAudit(req,'failed requisition action','requisition',targetId,{operation,error:message});
  audit(req,'failed requisition action','requisition',targetId,{operation,error:message});
  const status = /not found/i.test(message) ? 404 : /already exists/i.test(message) ? 409 : /must|requires|required|unsupported|only/i.test(message) ? 400 : 500;
  res.status(status).json({ok:false,error:message,activeRequisitionExists:/already exists/i.test(message)});
}
function canDeleteRequisitions(actor: User) {
  return actor.role === 'Admin' || actor.role === 'Manager';
}
async function writeMit3AppData(data: Record<string, unknown>) {
  const response = await fetch(mit3AppDataUrl, {
    method: 'PUT',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(data),
  });
  if (response.status === 404 || response.status === 405) throw new Error('MIT3 write endpoint not available yet.');
  if (!response.ok) {
    const body = await response.json().catch(async () => ({error: await response.text().catch(() => '')}));
    const message = isRecord(body) ? textField(body, ['error', 'message'], `HTTP ${response.status}`) : `HTTP ${response.status}`;
    throw new Error(message || 'MIT3 write failed.');
  }
  return response.json().catch(() => ({}));
}
function canInventoryWrite(actor: User) {
  return roleRank(actor.role) >= roleRank('Maintenance Tech 2');
}
function canInventoryImport(actor: User) {
  return roleRank(actor.role) >= roleRank('Maintenance Tech 3');
}
function canViewHistory(_actor: User) {
  return true;
}
function canExportHistory(actor: User) {
  return roleRank(actor.role) >= roleRank('Maintenance Tech 3');
}
function canViewMasterBackups(actor: User) {
  return roleRank(actor.role) >= roleRank('Manager');
}
function canCreateMasterBackups(actor: User) {
  return roleRank(actor.role) >= roleRank('Manager');
}
function canRestoreMasterBackups(actor: User) {
  return actor.role === 'Admin';
}
function historySectionFromValue(value: unknown): HistorySection | undefined {
  const clean = String(value ?? '').trim().toLowerCase().replace(/-/g, '_');
  return historySections.includes(clean as HistorySection) ? clean as HistorySection : undefined;
}
type HistoryFilters = {
  section?: HistorySection;
  q?: string;
  action?: string;
  user?: string;
  startDate?: string;
  endDate?: string;
  workOrderNumber?: string;
  partNumber?: string;
  requisitionNumber?: string;
  assetId?: string;
  selectedIds?: number[];
};
function historyFiltersFromSource(source: Record<string, unknown>): HistoryFilters {
  return {
    section: historySectionFromValue(source.section),
    q: queryText(source.q),
    action: queryText(source.action),
    user: queryText(source.user),
    startDate: queryText(source.startDate),
    endDate: queryText(source.endDate),
    workOrderNumber: queryText(source.workOrderNumber),
    partNumber: queryText(source.partNumber),
    requisitionNumber: queryText(source.requisitionNumber),
    assetId: queryText(source.assetId),
  };
}
function addHistoryLike(where: string[], params: SqlParam[], column: string, value?: string) {
  const clean = value?.trim();
  if (!clean) return;
  where.push(`${column} LIKE ? ESCAPE '\\' COLLATE NOCASE`);
  params.push(`%${escapeLike(clean)}%`);
}
function historyWhere(filters: HistoryFilters) {
  const where: string[] = [];
  const params: SqlParam[] = [];
  if (filters.selectedIds?.length) {
    where.push(`id IN (${filters.selectedIds.map(()=>'?').join(',')})`);
    params.push(...filters.selectedIds);
  }
  if (filters.section) {
    where.push('section=?');
    params.push(filters.section);
  }
  addHistoryLike(where, params, 'action', filters.action);
  addHistoryLike(where, params, 'user_name', filters.user);
  addHistoryLike(where, params, 'work_order_number', filters.workOrderNumber);
  addHistoryLike(where, params, 'part_number', filters.partNumber);
  addHistoryLike(where, params, 'requisition_number', filters.requisitionNumber);
  addHistoryLike(where, params, 'asset_id', filters.assetId);
  if (filters.startDate) {
    where.push('created_at>=?');
    params.push(filters.startDate.length <= 10 ? `${filters.startDate}T00:00:00.000Z` : filters.startDate);
  }
  if (filters.endDate) {
    where.push('created_at<=?');
    params.push(filters.endDate.length <= 10 ? `${filters.endDate}T23:59:59.999Z` : filters.endDate);
  }
  const q = filters.q?.trim();
  if (q) {
    const like = `%${escapeLike(q)}%`;
    where.push(`(section LIKE ? ESCAPE '\\' COLLATE NOCASE OR action LIKE ? ESCAPE '\\' COLLATE NOCASE OR entity_type LIKE ? ESCAPE '\\' COLLATE NOCASE OR entity_id LIKE ? ESCAPE '\\' COLLATE NOCASE OR entity_label LIKE ? ESCAPE '\\' COLLATE NOCASE OR work_order_number LIKE ? ESCAPE '\\' COLLATE NOCASE OR part_number LIKE ? ESCAPE '\\' COLLATE NOCASE OR requisition_number LIKE ? ESCAPE '\\' COLLATE NOCASE OR asset_id LIKE ? ESCAPE '\\' COLLATE NOCASE OR machine_name LIKE ? ESCAPE '\\' COLLATE NOCASE OR equipment_name LIKE ? ESCAPE '\\' COLLATE NOCASE OR location_name LIKE ? ESCAPE '\\' COLLATE NOCASE OR vendor_name LIKE ? ESCAPE '\\' COLLATE NOCASE OR reason_note LIKE ? ESCAPE '\\' COLLATE NOCASE OR user_name LIKE ? ESCAPE '\\' COLLATE NOCASE OR user_email LIKE ? ESCAPE '\\' COLLATE NOCASE)`);
    params.push(like,like,like,like,like,like,like,like,like,like,like,like,like,like,like,like);
  }
  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}
function publicHistoryRecord(row: HistoryLogRow) {
  return {
    id: row.id,
    section: row.section,
    sectionLabel: historySectionLabels[row.section] ?? row.section,
    action: row.action,
    entityType: row.entity_type ?? '',
    entityId: row.entity_id ?? '',
    entityLabel: row.entity_label ?? '',
    workOrderNumber: row.work_order_number ?? '',
    partNumber: row.part_number ?? '',
    requisitionNumber: row.requisition_number ?? '',
    assetId: row.asset_id ?? '',
    machineName: row.machine_name ?? '',
    equipmentName: row.equipment_name ?? '',
    locationName: row.location_name ?? '',
    vendorName: row.vendor_name ?? '',
    quantityBefore: row.quantity_before,
    quantityAfter: row.quantity_after,
    quantityDelta: row.quantity_delta,
    reasonNote: row.reason_note ?? '',
    userName: row.user_name ?? '',
    userEmail: row.user_email ?? '',
    createdAt: row.created_at,
  };
}
function historyRecords(filters: HistoryFilters, page = 1, pageSize = 50) {
  const safePage = Math.max(1, Math.floor(page || 1));
  const safePageSize = Math.min(Math.max(1, Math.floor(pageSize || 50)), 200);
  const { clause, params } = historyWhere(filters);
  const total = one<{ count: number }>(`SELECT COUNT(*) AS count FROM history_logs ${clause}`, params)?.count ?? 0;
  const records = all<HistoryLogRow>(`SELECT * FROM history_logs ${clause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`, [...params,safePageSize,(safePage - 1) * safePageSize]).map(publicHistoryRecord);
  return { records, total, page: safePage, pageSize: safePageSize };
}
function historyExportRows(filters: HistoryFilters) {
  const { clause, params } = historyWhere(filters);
  return all<HistoryLogRow>(`SELECT * FROM history_logs ${clause} ORDER BY created_at DESC, id DESC LIMIT 5000`, params);
}
function historyFilterSummary(filters: HistoryFilters) {
  const entries = [
    filters.q && `Search: ${filters.q}`,
    filters.action && `Action: ${filters.action}`,
    filters.user && `User: ${filters.user}`,
    filters.startDate && `Start: ${filters.startDate}`,
    filters.endDate && `End: ${filters.endDate}`,
    filters.workOrderNumber && `WO: ${filters.workOrderNumber}`,
    filters.partNumber && `Part: ${filters.partNumber}`,
    filters.requisitionNumber && `Req: ${filters.requisitionNumber}`,
    filters.assetId && `Asset: ${filters.assetId}`,
    filters.selectedIds?.length && `Selected rows: ${filters.selectedIds.length}`,
  ].filter(Boolean);
  return entries.length ? entries.join(' | ') : 'None';
}
function formatHistoryDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' });
}
function historyRecordLabel(row: HistoryLogRow) {
  return row.entity_label || row.requisition_number || row.part_number || row.asset_id || row.machine_name || row.equipment_name || row.entity_id || '-';
}
function historyReference(row: HistoryLogRow) {
  return row.requisition_number || row.part_number || row.asset_id || row.machine_name || row.equipment_name || '-';
}
function historyQty(row: HistoryLogRow) {
  const delta = row.quantity_delta;
  if (delta === null || delta === undefined) return '';
  const sign = delta > 0 ? '+' : '';
  return `${row.quantity_before ?? '-'} > ${row.quantity_after ?? '-'} (${sign}${delta})`;
}
async function buildHistoryPdf(input: { section: HistorySection; rows: HistoryLogRow[]; filters: HistoryFilters; actor: User }) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const accent = rgb(0.02, 0.45, 0.72);
  const softBlue = rgb(0.9, 0.97, 1);
  const dark = rgb(0.05, 0.08, 0.12);
  const gray = rgb(0.35, 0.42, 0.48);
  const width = 792;
  const height = 612;
  const margin = 32;
  const rowHeight = 38;
  const columns = [
    { label: 'Date/Time', x: margin, width: 72 },
    { label: 'Action', x: 108, width: 66 },
    { label: 'Record', x: 178, width: 112 },
    { label: 'User', x: 294, width: 84 },
    { label: 'WO', x: 382, width: 54 },
    { label: 'Part/Req/Asset', x: 440, width: 88 },
    { label: 'Qty Change', x: 532, width: 74 },
    { label: 'Reason/Note', x: 610, width: 150 },
  ];
  const title = `${historySectionLabels[input.section]} History Log`;
  const generatedAt = new Date();
  const filterText = historyFilterSummary(input.filters);
  let page: PDFPage;
  let y = 0;
  let pageNumber = 0;
  const addHistoryPage = () => {
    const nextPage = pdf.addPage([width,height]);
    page = nextPage;
    pageNumber += 1;
    y = height - margin;
    nextPage.drawRectangle({ x: 0, y: height - 58, width, height: 58, color: softBlue });
    nextPage.drawRectangle({ x: 0, y: height - 58, width: 7, color: accent });
    nextPage.drawText(title, { x: margin, y: height - 36, size: 18, font: bold, color: dark });
    nextPage.drawText(`Generated ${generatedAt.toLocaleString('en-US')} by ${input.actor.full_name}`, { x: margin, y: height - 52, size: 8, font: regular, color: gray });
    nextPage.drawText(`Section: ${historySectionLabels[input.section]} | Filters: ${truncateToFit(filterText, regular, 8, width - margin * 2)}`, { x: margin, y: height - 72, size: 8, font: regular, color: gray });
    y = height - 96;
    nextPage.drawRectangle({ x: margin, y: y - 15, width: width - margin * 2, height: 19, color: accent });
    for (const column of columns) nextPage.drawText(column.label, { x: column.x + 3, y: y - 9, size: 7, font: bold, color: rgb(1,1,1) });
    y -= 25;
    return nextPage;
  };
  page = addHistoryPage();
  const rows = input.rows.length ? input.rows : [];
  if (!rows.length) {
    page.drawText('No history records found for this section and filter set.', { x: margin, y, size: 11, font: regular, color: dark });
  }
  for (const row of rows) {
    if (y < 54) addHistoryPage();
    page.drawRectangle({ x: margin, y: y - rowHeight + 8, width: width - margin * 2, height: rowHeight, borderColor: rgb(0.76,0.86,0.92), borderWidth: 0.5 });
    const values = [
      formatHistoryDateTime(row.created_at),
      row.action,
      historyRecordLabel(row),
      row.user_name || '-',
      row.work_order_number || '-',
      historyReference(row),
      historyQty(row),
      row.reason_note || '',
    ];
    values.forEach((value,index)=>{
      const column = columns[index];
      const lines = wrapPdfText(value, regular, 6.8, column.width - 6, index === 7 || index === 2 ? 2 : 1);
      lines.forEach((line,lineIndex)=>{
        page.drawText(line, { x: column.x + 3, y: y - 7 - lineIndex * 8, size: 6.8, font: regular, color: dark });
      });
    });
    y -= rowHeight;
  }
  const pages = pdf.getPages();
  pages.forEach((pdfPage,index)=>{
    pdfPage.drawText(`Page ${index + 1} of ${pages.length}`, { x: width - 86, y: 18, size: 8, font: regular, color: gray });
  });
  return Buffer.from(await pdf.save());
}
function validateMit3PartInput(body: unknown) {
  const input = isRecord(body) ? body : {};
  const partNumber = textField(input, ['partNumber']);
  if (!partNumber) throw new Error('Part Number is required.');
  const description = textField(input, ['description']);
  const location = textField(input, ['location']);
  const vendor = textField(input, ['vendor']);
  const quantity = numberField(input, ['quantity']);
  const minQuantity = numberField(input, ['minQuantity']);
  if (!Number.isFinite(quantity)) throw new Error('Quantity must be numeric.');
  if (!Number.isFinite(minQuantity)) throw new Error('Minimum Quantity must be numeric.');
  const manufacturerBrand = textField(input, ['manufacturerBrand','manufacturer','brand']).slice(0, 160);
  const unitCost = input.unitCost === undefined || input.unitCost === null || String(input.unitCost).trim() === '' ? null : numericInput(input, 'unitCost', 'Unit Cost');
  if (unitCost !== null && unitCost < 0) throw new Error('Unit Cost must be zero or greater.');
  const supplierPartNumber = textField(input, ['supplierPartNumber','supplierPartNo']).slice(0, 160);
  const rawUrl = textField(input, ['partInfoUrl']);
  const partInfoUrl = rawUrl ? validWebUrl(rawUrl) : '';
  if (rawUrl && !partInfoUrl) throw new Error('Part Info URL must be blank or a valid http/https URL.');
  return {partNumber,description,location,vendor,quantity,minQuantity,partInfoUrl};
}
type Mit3PartInput = ReturnType<typeof validateMit3PartInput>;
function resolveLookupId(records: unknown[], value: string, label: string) {
  if (!value) return '';
  const normalized = value.toLowerCase();
  const match = records.filter(isRecord).find(record =>
    textField(record, ['id']).toLowerCase() === normalized ||
    textField(record, ['name', 'title', 'label']).toLowerCase() === normalized
  );
  if (!match) throw new Error(`MIT3 ${label} "${value}" was not found. Use an existing MIT3 ${label.toLowerCase()} or leave it blank.`);
  return textField(match, ['id']);
}
function findMit3Item(items: unknown[], id: string) {
  return items.findIndex(item => isRecord(item) && textField(item, ['id', 'itemId', 'item_id']) === id);
}
function normalizedMit3PartById(data: Record<string, unknown>, id: string) {
  return normalizeMit3Parts(data).find(part => part.id === id || part.itemId === id);
}
function recordArray(data: Record<string, unknown>, key: string) {
  if (!Array.isArray(data[key])) data[key] = [];
  return data[key] as unknown[];
}
function applyMit3PartInput(item: Record<string, unknown>, input: Mit3PartInput, data: Record<string, unknown>, timestamp: string) {
  const locationId = resolveLookupId(recordArray(data, 'locations'), input.location, 'Location');
  const vendorId = resolveLookupId(recordArray(data, 'vendors'), input.vendor, 'Vendor');
  item.name = input.description || input.partNumber;
  item.partNumber = input.partNumber;
  item.description = input.description;
  item.quantityOnHand = input.quantity;
  item.minimumStockLevel = input.minQuantity;
  item.lowStockAlertLevel = input.minQuantity;
  item.locationId = locationId;
  item.vendorId = vendorId;
  item.itemUrl = input.partInfoUrl;
  item.updatedAt = timestamp;
}
function mit3InventoryErrorStatus(message: string) {
  if (/not found/i.test(message)) return 404;
  if (/required|numeric|valid http\/https|use an existing/i.test(message)) return 400;
  return 503;
}
function sendMit3InventoryError(req: Request, res: Response, operation: string, targetId: string, error: unknown) {
  const message = safeErrorMessage(error);
  audit(req,'failed MIT3 write attempt','inventory',targetId,{operation,error:message});
  res.status(mit3InventoryErrorStatus(message)).json({ok:false,error:message,mit3Url});
}
async function mutateMit3Inventory(req: Request, operation: string, targetId: string, mutator: (data: Record<string, unknown>) => string) {
  const data = await fetchMit3AppData();
  const id = mutator(data);
  data.lastSavedAt = now();
  await writeMit3AppData(data);
  const part = normalizedMit3PartById(data, id);
  return {part,id};
}

function requireAuth(req: AuthRequest, res: Response, next: NextFunction) { const sid=unsign(cookie(req,'mcc_session')); if (!sid) return res.status(401).json({error:'Login required.'}); const s=one<{user_id:number}>('SELECT user_id FROM sessions WHERE id=? AND expires_at > ?', [sid,now()]); const u=s && findUserById(s.user_id); if (!u) return res.status(401).json({error:'Login required.'}); if (u.disabled) { clearSession(req,res); return res.status(403).json({error:'Account disabled.'}); } req.user=u; req.sessionId=sid; next(); }
function requirePermission(permission: string) { return (req: AuthRequest,res:Response,next:NextFunction) => { const role=req.user!.role; const userMgmt=role !== 'Maintenance Tech 1'; const ok = ['dashboard.view','inventory.view','settings.view'].includes(permission) || (permission==='inventory.write'&&canInventoryWrite(req.user!)) || (permission==='inventory.import'&&canInventoryImport(req.user!)) || (permission==='history.view'&&canViewHistory(req.user!)) || (permission==='history.export'&&canExportHistory(req.user!)) || (['users.view','users.create','users.edit','users.disable','users.delete','users.resetPassword'].includes(permission)&&userMgmt) || (permission==='audit.view'&&['Admin','Manager'].includes(role)); return ok ? next() : res.status(403).json({error:'Permission denied.'}); }; }

app.get('/api/health', (_req,res)=>res.json({ok:true,app:appName,port}));
app.get('/api/version', (_req,res)=>res.json({app:appName,version,environment:process.env.NODE_ENV??'local'}));
app.get('/api/auth/status', (req: AuthRequest,res)=> { const sid=unsign(cookie(req,'mcc_session')); const u=sid ? one<User>('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE u.deleted=0 AND s.id=? AND s.expires_at > ?', [sid,now()]) : undefined; res.json({ setupRequired:userCount()===0, user: u && !u.disabled ? publicUser(u) : null }); });
app.post('/api/auth/setup-first-admin',(req,res)=>{ if(userCount()>0) return res.status(409).json({error:'Setup is already complete.'}); const {fullName,email,password,confirmPassword}=req.body; if(!fullName||!email||password!==confirmPassword||!passwordOk(password)) return res.status(400).json({error:'Enter a full name, email, and matching strong passwords.'}); const id=createUser({fullName,email,role:'Admin',password,owner:true,createdBy:null}); (req as AuthRequest).user=findUserById(id); audit(req,'user create','user',id,{firstAdmin:true,ownerAdmin:true}); res.json({ok:true}); });
app.post('/api/auth/login',(req:AuthRequest,res)=>{ const key=`${req.ip}:${String(req.body.email??'').toLowerCase()}`; if(limited(loginHits,key,5,15*60*1000)) return res.status(429).json({error:'Too many login attempts. Try again later.'}); const u=findUserByEmail(req.body.email??''); if(!u||!verifyPassword(req.body.password??'',u.password_hash)) { audit(req,'failed login','user','',{email:req.body.email??''}); return res.status(401).json({error:'Invalid email or password.'}); } if(u.disabled) { audit(req,'failed login','user',u.id,{reason:'disabled'}); return res.status(403).json({error:'Account disabled. Contact an administrator.'}); } if(u.temp_password_expires_at && u.force_password_change && u.temp_password_expires_at < now()) return res.status(401).json({error:'Temporary password expired. Request another password reset.'}); setSession(res,u.id); run('UPDATE users SET last_login_at=?, updated_at=updated_at WHERE id=?', [now(),u.id]); req.user=u; audit(req,'login','user',u.id); res.json({user:publicUser({...u,last_login_at:now()})}); });
app.post('/api/auth/logout', requireAuth, (req:AuthRequest,res)=>{ audit(req,'logout','user',req.user!.id); clearSession(req,res); res.json({ok:true}); });
app.post('/api/auth/forgot-password', async (req,res)=>{
  const requestedEmail = String(req.body.email ?? '').trim();
  const key=`${req.ip}:${requestedEmail.toLowerCase()}`;
  if(limited(forgotHits,key,3,60*60*1000)) return res.status(429).json({error:'Too many reset requests. Try again later.'});

  console.log('MCC forgot password requested.');
  const u=findUserByEmail(requestedEmail);
  const activeUser = Boolean(u && !u.disabled);
  console.log(`MCC forgot password matching active user found: ${activeUser ? 'yes' : 'no'}`);
  console.log(`MCC forgot password SMTP configured: ${smtpConfigured ? 'yes' : 'no'}`);
  audit(req,'password reset request','user',activeUser ? u!.id : '',{matchingActiveUser:activeUser,smtpConfigured});

  if(activeUser){
    const temp=`Mcc-${crypto.randomBytes(9).toString('base64url')}!9a`;
    const expiresAt=tempExpiry();
    run('UPDATE users SET password_hash=?, force_password_change=1, temp_password_expires_at=?, updated_at=? WHERE id=?', [hashPassword(temp),expiresAt,now(),u!.id]);
    console.log('MCC reset email send attempted.');
    try {
      const messageId = await sendResetEmail(u!, temp, expiresAt);
      console.log(`MCC reset email sent successfully. messageId: ${messageId ?? 'unknown'}`);
      audit(req,'password reset email sent','user',u!.id,{messageId: messageId ?? null});
    } catch (error) {
      const safeMessage = safeErrorMessage(error, [temp], 'Unknown SMTP error.');
      console.log(`MCC reset email failed: ${safeMessage}`);
      audit(req,'password reset email failed','user',u!.id,{error:safeMessage});
    }
  }

  res.json({ok:true,message:'If the email matches an account, password reset instructions will be sent.'});
});
app.post('/api/auth/change-password', requireAuth, (req:AuthRequest,res)=>{ const {currentPassword,newPassword,confirmPassword}=req.body; const u=req.user!; if(!verifyPassword(currentPassword??'',u.password_hash)) return res.status(400).json({error:'Current password is incorrect.'}); if(newPassword!==confirmPassword||!passwordOk(newPassword)) return res.status(400).json({error:'New password must match and meet complexity rules.'}); if(verifyPassword(newPassword,u.password_hash)) return res.status(400).json({error:'New password cannot match the temporary/current password.'}); run('UPDATE users SET password_hash=?, force_password_change=0, temp_password_expires_at=NULL, updated_at=? WHERE id=?', [hashPassword(newPassword),now(),u.id]); audit(req,'password change','user',u.id); res.json({ok:true}); });
app.get('/api/users', requireAuth, requirePermission('users.view'), (req:AuthRequest,res)=>{ const max=roleRank(req.user!.role); const manageableRoles = roles.slice(0,max+1); const placeholders = manageableRoles.map(() => '?').join(','); res.json({users: all<User>(`SELECT * FROM users WHERE deleted=0 AND (?=4 OR role IN (${placeholders})) ORDER BY is_owner_admin DESC, full_name`, [max,...manageableRoles]).map(user => publicUserForActor(user, req.user!))}); });
app.post('/api/users', requireAuth, requirePermission('users.create'), (req:AuthRequest,res)=>{ const role=req.body.role as Role; if(!roles.includes(role)||!canManageRole(req.user!.role,role)) return res.status(403).json({error:'Cannot create that role.'}); if(!passwordOk(req.body.temporaryPassword??'')) return res.status(400).json({error:'Temporary password must meet complexity rules.'}); const id=createUser({fullName:req.body.fullName,email:req.body.email,role,password:req.body.temporaryPassword,force:true,createdBy:req.user!.id}); audit(req,'user create','user',id,{role}); res.status(201).json({user:publicUser(findUserById(id)!)}); });
app.patch('/api/users/:id', requireAuth, requirePermission('users.edit'), (req:AuthRequest,res)=>{ const target=findUserById(Number(req.params.id)); if(!target) return res.status(404).json({error:'User not found.'}); if(!canEditTarget(req.user!,target)) return res.status(403).json({error:'Cannot edit that user.'}); const role=(req.body.role??target.role) as Role; if(!roles.includes(role)||!canManageRole(req.user!.role,role)) return res.status(403).json({error:'Cannot assign that role.'}); run('UPDATE users SET full_name=?, email=?, role=?, updated_at=? WHERE id=?', [req.body.fullName??target.full_name,req.body.email??target.email,role,now(),target.id]); audit(req,'user update','user',target.id); res.json({user:publicUserForActor(findUserById(target.id)!, req.user!)}); });
for (const action of ['disable','enable'] as const) app.post(`/api/users/:id/${action}`, requireAuth, requirePermission('users.disable'), (req:AuthRequest,res)=>{ const target=findUserById(Number(req.params.id)); if(!target) return res.status(404).json({error:'User not found.'}); if(!canToggleDisabledTarget(req.user!,target)) return res.status(403).json({error:`Cannot ${action} that user.`}); run('UPDATE users SET disabled=?, updated_at=? WHERE id=?', [action==='disable'?1:0,now(),target.id]); audit(req,`user ${action}`,'user',target.id); res.json({user:publicUserForActor(findUserById(target.id)!, req.user!)}); });
app.delete('/api/users/:id', requireAuth, requirePermission('users.delete'), (req:AuthRequest,res)=>{ const target=findUserById(Number(req.params.id)); if(!target) return res.status(404).json({error:'User not found.'}); if(!canDeleteTarget(req.user!,target)) return res.status(403).json({error:'Cannot delete that user.'}); run('UPDATE users SET deleted=1, disabled=1, deleted_at=?, deleted_by_user_id=?, updated_at=? WHERE id=?', [now(),req.user!.id,now(),target.id]); run('DELETE FROM sessions WHERE user_id=?', [target.id]); audit(req,'user delete','user',target.id,{softDelete:true}); res.json({ok:true}); });
app.get('/api/audit', requireAuth, requirePermission('audit.view'), (_req,res)=>res.json({audit:all('SELECT * FROM audit_log ORDER BY id DESC LIMIT 200')}));
app.get('/api/history/summary', requireAuth, requirePermission('history.view'), (_req,res)=>{
  const rows = all<{ section: HistorySection; count: number; latestCreatedAt: string | null }>('SELECT section, COUNT(*) AS count, MAX(created_at) AS latestCreatedAt FROM history_logs GROUP BY section');
  const summary = historySections.map(section=>{
    const row = rows.find(item=>item.section===section);
    return {section,sectionLabel:historySectionLabels[section],count:row?.count ?? 0,latestCreatedAt:row?.latestCreatedAt ?? null};
  });
  res.json({ok:true,summary});
});
app.get('/api/history', requireAuth, requirePermission('history.view'), (req,res)=>{
  try {
    const filters = historyFiltersFromSource(req.query as Record<string, unknown>);
    const page = Number(req.query.page ?? 1);
    const pageSize = Number(req.query.pageSize ?? 50);
    res.json({ok:true,...historyRecords(filters,page,pageSize)});
  } catch (error) {
    res.status(400).json({ok:false,error:safeErrorMessage(error)});
  }
});
app.post('/api/history/export/pdf', requireAuth, requirePermission('history.export'), async (req:AuthRequest,res)=>{
  try {
    const body = isRecord(req.body) ? req.body : {};
    const section = historySectionFromValue(body.section);
    if (!section) throw new Error('History section is required.');
    const filterBody = isRecord(body.filters) ? body.filters : {};
    const selectedIds = Array.isArray(body.selectedIds) ? uniquePositiveIds(body.selectedIds.map(id => Number(id))) : [];
    const filters = {...historyFiltersFromSource(filterBody),section,selectedIds:selectedIds.length ? selectedIds : undefined};
    const rows = historyExportRows(filters);
    const buffer = await buildHistoryPdf({section,rows,filters,actor:req.user!});
    const fileName = `MCC_${safeFileToken(historySectionLabels[section])}_History_${downloadDateStamp()}.pdf`;
    recordHistoryLog({
      section,
      action: 'history_pdf_exported',
      entityType: 'history_report',
      entityLabel: `${historySectionLabels[section]} History Log`,
      newValue: { rowCount: rows.length, selectedCount: selectedIds.length, fileName },
      actor: req.user!,
    });
    sendDownload(res,fileName,'application/pdf',buffer);
  } catch (error) {
    const message = safeErrorMessage(error);
    res.status(/required|section/i.test(message) ? 400 : 500).json({ok:false,error:message});
  }
});
app.get('/api/backup/status', requireAuth, requirePermission('settings.view'), (req:AuthRequest,res)=>{
  try {
    res.json({
      ...masterBackupStatus(),
      permissions: {
        canViewBackups: canViewMasterBackups(req.user!),
        canCreateBackup: canCreateMasterBackups(req.user!),
        canRestoreBackup: canRestoreMasterBackups(req.user!),
      },
    });
  } catch (error) {
    res.status(500).json({ok:false,error:safeErrorMessage(error, [], 'Backup status failed.')});
  }
});
app.get('/api/backup/list', requireAuth, (req:AuthRequest,res)=>{
  if (!canViewMasterBackups(req.user!)) return res.status(403).json({ok:false,error:'Permission denied.'});
  try {
    res.json({ok:true,backups:listMasterBackupsInternal()});
  } catch (error) {
    res.status(500).json({ok:false,error:safeErrorMessage(error, [], 'Backup list failed.')});
  }
});
app.post('/api/backup/create', requireAuth, (req:AuthRequest,res)=>{
  if (!canCreateMasterBackups(req.user!)) return res.status(403).json({ok:false,error:'Permission denied.'});
  try {
    const backup = createMasterBackup({ type: 'manual', actor: req.user!, notes: 'Manual backup from MCC Settings.' });
    try { audit(req,'master backup created','backup',backup.id,{backupType:backup.type}); } catch (auditError) { console.log(`MCC manual backup audit failed: ${safeErrorMessage(auditError, [], 'Audit failed.')}`); }
    res.status(201).json({ok:true,backup,status:masterBackupStatus(),message:'Manual backup created successfully.'});
  } catch (error) {
    const message = safeBackupClientError(error, 'Backup failed.');
    try { audit(req,'master backup failed','backup','manual',{error:message}); } catch {}
    res.status(/already running/i.test(message) ? 409 : 500).json({ok:false,error:message});
  }
});
app.post('/api/backup/verify', requireAuth, (req:AuthRequest,res)=>{
  if (!canViewMasterBackups(req.user!)) return res.status(403).json({error:'Permission denied.'});
  try {
    res.json(verifyMasterBackup(isRecord(req.body) ? req.body.backupId : ''));
  } catch (error) {
    res.status(/not found|missing/i.test(safeErrorMessage(error)) ? 404 : 500).json({ok:false,error:safeErrorMessage(error, [], 'Backup verification failed.')});
  }
});
app.post('/api/backup/restore', requireAuth, (req:AuthRequest,res)=>{
  if (!canRestoreMasterBackups(req.user!)) return res.status(403).json({error:'Permission denied.'});
  try {
    const body = isRecord(req.body) ? req.body : {};
    const result = restoreMasterBackup({ backupId: body.backupId, confirmation: body.confirmation, actor: req.user! });
    res.json({ok:true,...result,message:'Backup restored. Refresh MCC and log in again if the restored session is no longer active.'});
  } catch (error) {
    const message = safeErrorMessage(error, [], 'Restore failed.');
    try { audit(req,'master restore failed','backup',isRecord(req.body) ? String(req.body.backupId ?? '') : '',{error:message}); } catch {}
    res.status(/confirm|not found|missing|checksum/i.test(message) ? 400 : 500).json({ok:false,error:message});
  }
});
app.get('/api/settings/network-links', requireAuth, requirePermission('settings.view'), (_req,res)=>{
  const lanUrls = detectedLanUrls();
  res.json({
    localPort: port,
    localhostUrl: `http://localhost:${port}`,
    detectedLanUrls: lanUrls,
    primaryLanUrl: lanUrls[0] ?? null,
  });
});
app.get('/api/requisitions/summary', requireAuth, requirePermission('inventory.view'), (_req,res)=>res.json({ok:true,...requisitionSummary()}));
app.get('/api/requisitions', requireAuth, requirePermission('inventory.view'), (req:AuthRequest,res)=>{
  try {
    const includeDeleted = canDeleteRequisitions(req.user!) && String(req.query.includeDeleted ?? '').toLowerCase() === 'true';
    const includeDrafts = canDeleteRequisitions(req.user!) && String(req.query.includeDrafts ?? '').toLowerCase() === 'true';
    res.json({ok:true,requisitions:requisitionList(queryText(req.query.status), includeDeleted, includeDrafts),summary:requisitionSummary()});
  } catch (error) {
    res.status(400).json({ok:false,error:safeErrorMessage(error)});
  }
});
app.get('/api/requisitions/:id', requireAuth, requirePermission('inventory.view'), (req,res)=>{
  const requisition = requisitionById(Number(req.params.id));
  if (!requisition) return res.status(404).json({ok:false,error:'Requisition not found.'});
  res.json({ok:true,requisition:publicRequisition(requisition)});
});
app.get('/api/requisitions/:id/pdf', requireAuth, requirePermission('inventory.view'), async (req:AuthRequest,res)=>{
  const requisitionId = Number(req.params.id);
  try {
    const requisition = requisitionById(requisitionId, { includeDeleted: canDeleteRequisitions(req.user!) });
    if (!requisition) throw new Error('Requisition not found.');
    const buffer = await buildSingleRequisitionPdf(requisition);
    const fileName = `MCC_Requisition_${safeFileToken(requisition.requisition_number)}.pdf`;
    const preview = ['1','true','yes'].includes(String(req.query.preview ?? '').toLowerCase());
    const action = preview ? 'requisition PDF preview generated' : 'requisition PDF generated';
    inventoryAudit(req,action,'requisition',requisition.id,{requisitionNumber:requisition.requisition_number,fileName});
    audit(req,action,'requisition',requisition.id,{requisitionNumber:requisition.requisition_number,fileName});
    recordRequisitionHistory({
      action: preview ? 'pdf_previewed' : 'pdf_generated',
      actor: req.user!,
      row: requisition,
      newValue: { requisitionNumber: requisition.requisition_number, fileName, preview },
    });
    if (preview) {
      res.setHeader('Content-Type','application/pdf');
      res.setHeader('Content-Disposition',`inline; filename="${fileName}"`);
      res.send(buffer);
    } else {
      sendDownload(res,fileName,'application/pdf',buffer);
    }
  } catch (error) {
    const message = safeErrorMessage(error);
    inventoryAudit(req,'failed PDF generation','requisition',Number.isFinite(requisitionId) ? requisitionId : String(req.params.id ?? ''),{error:message});
    audit(req,'failed PDF generation','requisition',Number.isFinite(requisitionId) ? requisitionId : String(req.params.id ?? ''),{error:message});
    res.status(/not found/i.test(message) ? 404 : 500).json({ok:false,error:message});
  }
});
app.post('/api/requisitions', requireAuth, requirePermission('inventory.write'), (req:AuthRequest,res)=>{
  const actor = req.user!;
  const operation = 'requisition create';
  try {
    const input = isRecord(req.body) ? req.body : {};
    let requisitions: ReturnType<typeof publicCreatedRequisition>[] = [];
    db.exec('BEGIN IMMEDIATE');
    try {
      requisitions = createGroupedRequisitions(req, actor, input, { status: 'Requested', syncParts: true });
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    res.status(201).json({ok:true,requisition:requisitions[0],requisitions,summary:requisitionSummary()});
  } catch (error) {
    sendRequisitionError(req,res,operation,'',error);
  }
});

app.post('/api/requisitions/preview', requireAuth, requirePermission('inventory.write'), (req:AuthRequest,res)=>{
  const actor = req.user!;
  const operation = 'requisition preview create';
  try {
    const input = isRecord(req.body) ? req.body : {};
    let requisitions: ReturnType<typeof publicCreatedRequisition>[] = [];
    db.exec('BEGIN IMMEDIATE');
    try {
      requisitions = createGroupedRequisitions(req, actor, input, { requirePreviewFields: true, status: 'Draft', syncParts: false });
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    res.status(201).json({ok:true,requisition:requisitions[0],requisitions,summary:requisitionSummary()});
  } catch (error) {
    sendRequisitionError(req,res,operation,'',error);
  }
});

app.post('/api/requisitions/:id/pass', requireAuth, requirePermission('inventory.write'), (req:AuthRequest,res)=>{
  const actor = req.user!;
  const operation = 'requisition preview pass';
  const requisitionId = Number(req.params.id);
  try {
    const timestamp = now();
    db.exec('BEGIN IMMEDIATE');
    try {
      const existing = requisitionById(requisitionId);
      if (!existing) throw new Error('Requisition not found.');
      if (existing.status !== 'Draft') throw new Error('Only Draft requisitions can be passed.');
      const partIds = requisitionPartIds(existing);
      run('UPDATE inventory_requisitions SET status=?, requested_by_user_id=?, requested_by_name=?, requested_at=?, updated_at=? WHERE id=?', [
        'Requested',
        actor.id,
        actor.full_name,
        timestamp,
        timestamp,
        requisitionId,
      ]);
      syncRequisitionPartFlags(partIds,timestamp);
      inventoryAudit(req,'requisition preview passed','requisition',requisitionId,{previousStatus:existing.status,nextStatus:'Requested',partIds});
      audit(req,'requisition preview passed','requisition',requisitionId,{previousStatus:existing.status,nextStatus:'Requested',partIds});
      inventoryAudit(req,'requisition active create','requisition',requisitionId,{requisitionNumber:existing.requisition_number,partIds});
      audit(req,'requisition active create','requisition',requisitionId,{requisitionNumber:existing.requisition_number,partIds});
      const updated = requisitionById(requisitionId, { includeDeleted: true });
      if (updated) {
        recordRequisitionHistory({
          action: 'passed',
          actor,
          row: updated,
          oldValue: requisitionHistoryValue(existing),
          newValue: requisitionHistoryValue(updated),
          createdAt: timestamp,
        });
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    res.json({ok:true,requisition:publicCreatedRequisition(requisitionId),summary:requisitionSummary()});
  } catch (error) {
    sendRequisitionError(req,res,operation,Number.isFinite(requisitionId) ? requisitionId : String(req.params.id ?? ''),error);
  }
});

app.post('/api/requisitions/vendor-pdf', requireAuth, requirePermission('inventory.write'), async (req:AuthRequest,res)=>{
  const actor = req.user!;
  const operation = 'vendor requisition PDF create';
  try {
    const input = isRecord(req.body) ? req.body : {};
    const vendorName = textField(input, ['vendorName','vendor'], 'Unknown Vendor') || 'Unknown Vendor';
    const notes = textField(input, ['notes','note']);
    const header = isRecord(input.header) ? input.header : {};
    const requisitionType = textField(input, ['requisitionType']) || textField(header, ['requisitionType']);
    const rawItems = Array.isArray(input.items) ? input.items : [];
    if (!rawItems.length) throw new Error('At least one requisition item is required.');
    const timestamp = now();
    const requisitionNumber = requisitionNumberForTimestamp(timestamp);
    const pdfItems: Array<{partNumber:string;description:string;locationName:string;quantityRequested:number;unitCost?:number|null;supplierPartNumber?:string;dueDate?:string;notes?:string}> = [];
    const requisitionIds: number[] = [];
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const rawItem of rawItems) {
        if (!isRecord(rawItem)) throw new Error('Invalid requisition item.');
        const partId = Number(rawItem.inventoryPartId ?? rawItem.partId ?? rawItem.id);
        if (!Number.isInteger(partId) || partId <= 0) throw new Error('Native inventory part not found.');
        const quantityRequested = validateQuantityRequested(rawItem.quantityRequested ?? rawItem.quantity);
        const part = one<NativePartRow>(`SELECT p.*, l.name AS location_name, v.name AS vendor_name
FROM inventory_parts p
LEFT JOIN inventory_locations l ON l.id=p.location_id AND l.deleted=0
LEFT JOIN inventory_vendors v ON v.id=p.vendor_id AND v.deleted=0
WHERE p.deleted=0 AND p.id=?`, [partId]);
        if (!part) throw new Error('Native inventory part not found.');
        const rawUnitCost = Number(rawItem.unitCost ?? part.unit_cost ?? 0);
        const unitCost = Number.isFinite(rawUnitCost) && rawUnitCost >= 0 ? rawUnitCost : 0;
        const currentRequisitionNumber = rawItems.length > 1 ? `${requisitionNumber}-${String(requisitionIds.length + 1).padStart(2,'0')}` : requisitionNumber;
        const result = run(`INSERT INTO inventory_requisitions (requisition_number,inventory_part_id,part_number,description,vendor_name,location_name,quantity_requested,unit_cost,status,requested_by_user_id,requested_by_name,requested_at,work_order_number,notes,created_at,updated_at,deleted) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`, [
          currentRequisitionNumber,
          part.id, part.part_number, part.description, vendorName, part.location_name ?? '', quantityRequested, unitCost, 'Requested', actor.id, actor.full_name, timestamp, '', notes, timestamp, timestamp,
        ]);
        const createdId = Number(result.lastInsertRowid);
        requisitionIds.push(createdId);
        syncPartRequisitionFlag(partId,timestamp);
        const createdRow = requisitionById(createdId, { includeDeleted: true });
        if (createdRow) {
          recordRequisitionHistory({
            action: 'requested',
            actor,
            row: createdRow,
            newValue: requisitionHistoryValue(createdRow),
            createdAt: timestamp,
          });
        }
        pdfItems.push({partNumber:part.part_number,description:part.description,locationName:part.location_name ?? '',quantityRequested,unitCost,supplierPartNumber:textField(rawItem, ['supplierPartNumber']) || (part.supplier_part_number ?? ''),dueDate:textField(rawItem, ['dueDate']),notes:textField(rawItem, ['notes','note'])});
      }
      inventoryAudit(req,'vendor requisition PDF create','requisition',requisitionNumber,{vendorName,itemCount:pdfItems.length,requisitionIds});
      audit(req,'vendor requisition PDF create','requisition',requisitionNumber,{vendorName,itemCount:pdfItems.length,requisitionIds});
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    const buffer = await buildRequisitionPdf({vendor:vendorName,requisitionNumber,requestedBy:actor.full_name,createdAt:timestamp,notes,requisitionType,header,items:pdfItems});
    const fileName = `MCC_Requisition_${safeFileToken(vendorName)}_${safeFileToken(requisitionNumber)}_${timestamp.slice(0,10)}.pdf`;
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition',`attachment; filename="${fileName}"`);
    res.setHeader('X-Requisition-Number', requisitionNumber);
    res.send(buffer);
  } catch (error) {
    sendRequisitionError(req,res,operation,'',error);
  }
});

app.patch('/api/requisitions/:id/status', requireAuth, requirePermission('inventory.write'), (req:AuthRequest,res)=>{
  const actor = req.user!;
  const operation = 'requisition status changed';
  const requisitionId = Number(req.params.id);
  try {
    const input = isRecord(req.body) ? req.body : {};
    const nextStatus = textField(input, ['status']) as RequisitionStatus;
    if (!['Ordered','Received','Canceled'].includes(nextStatus)) throw new Error('Status must be Ordered, Received, or Canceled.');
    const cancelReason = textField(input, ['cancelReason','cancel_reason']);
    if (nextStatus === 'Canceled' && !cancelReason) throw new Error('Cancel reason is required.');
    const timestamp = now();
    let previousStatus = '';
    db.exec('BEGIN IMMEDIATE');
    try {
      const existing = requisitionById(requisitionId);
      if (!existing) throw new Error('Requisition not found.');
      if (existing.status === 'Draft') throw new Error('Draft requisitions must be passed before status changes.');
      previousStatus = existing.status;
      const partIds = requisitionPartIds(existing);
      if (nextStatus === 'Ordered') {
        run('UPDATE inventory_requisitions SET status=?, ordered_by_user_id=?, ordered_at=?, updated_at=? WHERE id=?', [nextStatus,actor.id,timestamp,timestamp,requisitionId]);
      } else if (nextStatus === 'Received') {
        run('UPDATE inventory_requisitions SET status=?, received_by_user_id=?, received_at=?, updated_at=? WHERE id=?', [nextStatus,actor.id,timestamp,timestamp,requisitionId]);
      } else {
        run('UPDATE inventory_requisitions SET status=?, canceled_by_user_id=?, canceled_at=?, cancel_reason=?, updated_at=? WHERE id=?', [nextStatus,actor.id,timestamp,cancelReason,timestamp,requisitionId]);
      }
      syncRequisitionPartFlags(partIds,timestamp);
      inventoryAudit(req,'requisition status changed','requisition',requisitionId,{previousStatus,nextStatus});
      audit(req,'requisition status changed','requisition',requisitionId,{previousStatus,nextStatus});
      const specificAction = nextStatus === 'Ordered' ? 'requisition ordered' : nextStatus === 'Received' ? 'requisition received' : 'requisition canceled';
      inventoryAudit(req,specificAction,'requisition',requisitionId,{previousStatus,nextStatus});
      audit(req,specificAction,'requisition',requisitionId,{previousStatus,nextStatus});
      const updated = requisitionById(requisitionId, { includeDeleted: true });
      if (updated) {
        recordRequisitionHistory({
          action: nextStatus.toLowerCase(),
          actor,
          row: updated,
          oldValue: requisitionHistoryValue(existing),
          newValue: requisitionHistoryValue(updated),
          reasonNote: nextStatus === 'Canceled' ? cancelReason : '',
          createdAt: timestamp,
        });
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    res.json({ok:true,requisition:publicRequisition(requisitionById(requisitionId)!),summary:requisitionSummary()});
  } catch (error) {
    sendRequisitionError(req,res,operation,Number.isFinite(requisitionId) ? requisitionId : String(req.params.id ?? ''),error);
  }
});
app.patch('/api/requisitions/:id', requireAuth, requirePermission('inventory.write'), (req:AuthRequest,res)=>{
  const actor = req.user!;
  const operation = 'requisition edit';
  const requisitionId = Number(req.params.id);
  try {
    const input = isRecord(req.body) ? req.body : {};
    const timestamp = now();
    db.exec('BEGIN IMMEDIATE');
    try {
      const existing = requisitionById(requisitionId);
      if (!existing) throw new Error('Requisition not found.');
      if (existing.status !== 'Requested') throw new Error('Only Requested requisitions can be edited.');
      const lines = requisitionLineRows(requisitionId);
      const quantityRequested = input.quantityRequested === undefined && input.quantity === undefined ? existing.quantity_requested : validateQuantityRequested(input.quantityRequested ?? input.quantity);
      const workOrderNumber = input.workOrderNumber === undefined && input.work_order_number === undefined ? existing.work_order_number : textField(input, ['workOrderNumber','work_order_number','workOrder']);
      const notes = input.notes === undefined ? existing.notes : textField(input, ['notes','note']);
      run('UPDATE inventory_requisitions SET quantity_requested=?, work_order_number=?, notes=?, updated_at=? WHERE id=?', [quantityRequested,workOrderNumber,notes,timestamp,requisitionId]);
      if (lines.length === 1 && (input.quantityRequested !== undefined || input.quantity !== undefined)) {
        run('UPDATE inventory_requisition_lines SET quantity_requested=?, updated_at=? WHERE id=?', [quantityRequested,timestamp,lines[0].id]);
      }
      inventoryAudit(req,'requisition edit','requisition',requisitionId,{quantityRequested,workOrderNumber});
      audit(req,'requisition edit','requisition',requisitionId,{quantityRequested,workOrderNumber});
      const updated = requisitionById(requisitionId, { includeDeleted: true });
      if (updated) {
        recordRequisitionHistory({
          action: 'updated',
          actor,
          row: updated,
          oldValue: requisitionHistoryValue(existing),
          newValue: requisitionHistoryValue(updated),
          createdAt: timestamp,
        });
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    res.json({ok:true,requisition:publicRequisition(requisitionById(requisitionId)!),summary:requisitionSummary()});
  } catch (error) {
    sendRequisitionError(req,res,operation,Number.isFinite(requisitionId) ? requisitionId : String(req.params.id ?? ''),error);
  }
});
app.delete('/api/requisitions/:id', requireAuth, (req:AuthRequest,res)=>{
  const actor = req.user!;
  const requisitionId = Number(req.params.id);
  const targetId = Number.isFinite(requisitionId) ? requisitionId : String(req.params.id ?? '');
  try {
    if (!canDeleteRequisitions(actor)) {
      inventoryAudit(req,'failed delete','requisition',targetId,{error:'Permission denied.'});
      audit(req,'failed delete','requisition',targetId,{error:'Permission denied.'});
      return res.status(403).json({ok:false,error:'Permission denied.'});
    }
    if (!Number.isInteger(requisitionId) || requisitionId <= 0) throw new Error('Requisition not found.');
    const input = isRecord(req.body) ? req.body : {};
    const reasonNote = requiredReasonNote(input.reasonNote ?? input.reason ?? input.deleteReason, 'Delete requisition');
    const timestamp = now();
    db.exec('BEGIN IMMEDIATE');
    try {
      const existing = requisitionById(requisitionId);
      if (!existing) throw new Error('Requisition not found.');
      const partIds = requisitionPartIds(existing);
      run('UPDATE inventory_requisitions SET deleted=1, deleted_at=?, deleted_by_user_id=?, updated_at=? WHERE id=?', [timestamp,actor.id,timestamp,requisitionId]);
      run('UPDATE inventory_requisition_lines SET deleted=1, deleted_at=?, deleted_by_user_id=?, updated_at=? WHERE requisition_id=? AND deleted=0', [timestamp,actor.id,timestamp,requisitionId]);
      syncRequisitionPartFlags(partIds,timestamp);
      inventoryAudit(req,'requisition soft deleted','requisition',requisitionId,{requisitionNumber:existing.requisition_number});
      audit(req,'requisition soft deleted','requisition',requisitionId,{requisitionNumber:existing.requisition_number});
      const deleted = requisitionById(requisitionId, { includeDeleted: true });
      if (deleted) {
        recordRequisitionHistory({
          action: 'deleted',
          actor,
          row: deleted,
          oldValue: requisitionHistoryValue(existing),
          newValue: requisitionHistoryValue(deleted),
          reasonNote,
          createdAt: timestamp,
        });
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    res.json({ok:true,summary:requisitionSummary()});
  } catch (error) {
    const message = safeErrorMessage(error);
    inventoryAudit(req,'failed delete','requisition',targetId,{error:message});
    audit(req,'failed delete','requisition',targetId,{error:message});
    res.status(/not found/i.test(message) ? 404 : /permission/i.test(message) ? 403 : /required/i.test(message) ? 400 : 500).json({ok:false,error:message});
  }
});
app.post('/api/requisitions/bulk-cancel', requireAuth, requirePermission('inventory.write'), (req:AuthRequest,res)=>{
  const actor = req.user!;
  try {
    const input = isRecord(req.body) ? req.body : {};
    const ids = Array.isArray(input.ids) ? uniquePositiveIds(input.ids.map(id => Number(id))) : [];
    if (!ids.length) throw new Error('Select at least one requisition to cancel.');
    const reasonNote = requiredReasonNote(input.reasonNote ?? input.reason ?? input.cancelReason, 'Cancel requisition');
    const timestamp = now();
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const requisitionId of ids) {
        const existing = requisitionById(requisitionId);
        if (!existing) throw new Error('Requisition not found.');
        if (existing.status !== 'Requested' && existing.status !== 'Ordered') throw new Error('Only Requested or Ordered requisitions can be canceled.');
        const partIds = requisitionPartIds(existing);
        run('UPDATE inventory_requisitions SET status=?, canceled_by_user_id=?, canceled_at=?, cancel_reason=?, updated_at=? WHERE id=?', ['Canceled',actor.id,timestamp,reasonNote,timestamp,requisitionId]);
        syncRequisitionPartFlags(partIds,timestamp);
        inventoryAudit(req,'bulk requisition canceled','requisition',requisitionId,{requisitionNumber:existing.requisition_number});
        audit(req,'bulk requisition canceled','requisition',requisitionId,{requisitionNumber:existing.requisition_number});
        const updated = requisitionById(requisitionId, { includeDeleted: true });
        if (updated) recordRequisitionHistory({action:'canceled',actor,row:updated,oldValue:requisitionHistoryValue(existing),newValue:requisitionHistoryValue(updated),reasonNote,createdAt:timestamp});
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    res.json({ok:true,count:ids.length,summary:requisitionSummary()});
  } catch (error) {
    const message = safeErrorMessage(error);
    res.status(/not found/i.test(message) ? 404 : /required|select|only/i.test(message) ? 400 : 500).json({ok:false,error:message});
  }
});
app.post('/api/requisitions/bulk-delete', requireAuth, (req:AuthRequest,res)=>{
  const actor = req.user!;
  try {
    if (!canDeleteRequisitions(actor)) return res.status(403).json({ok:false,error:'Permission denied.'});
    const input = isRecord(req.body) ? req.body : {};
    const ids = Array.isArray(input.ids) ? uniquePositiveIds(input.ids.map(id => Number(id))) : [];
    if (!ids.length) throw new Error('Select at least one requisition to delete.');
    const reasonNote = requiredReasonNote(input.reasonNote ?? input.reason ?? input.deleteReason, 'Delete requisition');
    const timestamp = now();
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const requisitionId of ids) {
        const existing = requisitionById(requisitionId);
        if (!existing) throw new Error('Requisition not found.');
        const partIds = requisitionPartIds(existing);
        run('UPDATE inventory_requisitions SET deleted=1, deleted_at=?, deleted_by_user_id=?, updated_at=? WHERE id=?', [timestamp,actor.id,timestamp,requisitionId]);
        run('UPDATE inventory_requisition_lines SET deleted=1, deleted_at=?, deleted_by_user_id=?, updated_at=? WHERE requisition_id=? AND deleted=0', [timestamp,actor.id,timestamp,requisitionId]);
        syncRequisitionPartFlags(partIds,timestamp);
        inventoryAudit(req,'bulk requisition soft deleted','requisition',requisitionId,{requisitionNumber:existing.requisition_number});
        audit(req,'bulk requisition soft deleted','requisition',requisitionId,{requisitionNumber:existing.requisition_number});
        const deleted = requisitionById(requisitionId, { includeDeleted: true });
        if (deleted) recordRequisitionHistory({action:'deleted',actor,row:deleted,oldValue:requisitionHistoryValue(existing),newValue:requisitionHistoryValue(deleted),reasonNote,createdAt:timestamp});
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    res.json({ok:true,count:ids.length,summary:requisitionSummary()});
  } catch (error) {
    const message = safeErrorMessage(error);
    res.status(/not found/i.test(message) ? 404 : /permission/i.test(message) ? 403 : /required|select/i.test(message) ? 400 : 500).json({ok:false,error:message});
  }
});
app.get('/api/inventory/native/summary', requireAuth, requirePermission('inventory.view'), (_req,res)=>res.json({ok:true,...nativeInventorySummary()}));
app.get('/api/inventory/native/parts', requireAuth, requirePermission('inventory.view'), (req,res)=>{
  const search = queryText(req.query.search ?? req.query.q);
  const requestedFilter = queryText(req.query.filter);
  const filter: NativePartFilter = ['low','requisition'].includes(requestedFilter) ? requestedFilter as NativePartFilter : 'all';
  res.json({ok:true,source:'mcc-native',parts:nativeParts(search,filter),summary:nativeInventorySummary()});
});
app.get('/api/inventory/native/export/csv', requireAuth, requirePermission('inventory.write'), (req,res)=>{
  try {
    const records = nativeInventoryRows().map(nativeExportRecord);
    const fileName = `MCC_Inventory_Export_${downloadDateStamp()}.csv`;
    inventoryAudit(req,'inventory export CSV','inventory','native',{rowCount:records.length,fileName});
    audit(req,'inventory export CSV','inventory','native',{rowCount:records.length,fileName});
    sendDownload(res,fileName,'text/csv; charset=utf-8',csvFromRecords(nativeExportHeaders, records));
  } catch (error) {
    const message = safeErrorMessage(error);
    res.status(500).json({ok:false,error:message});
  }
});
app.get('/api/inventory/native/export/excel-update-template', requireAuth, requirePermission('inventory.write'), async (req,res)=>{
  try {
    const records = nativeInventoryRows().map(nativeExportRecord);
    const fileName = `MCC_Inventory_Update_Template_${downloadDateStamp()}.xlsx`;
    const buffer = await workbookBuffer('MCC Inventory Update', nativeExportHeaders, records);
    inventoryAudit(req,'inventory export Excel update template','inventory','native',{rowCount:records.length,fileName});
    audit(req,'inventory export Excel update template','inventory','native',{rowCount:records.length,fileName});
    sendDownload(res,fileName,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer);
  } catch (error) {
    const message = safeErrorMessage(error);
    res.status(500).json({ok:false,error:message});
  }
});
app.get('/api/inventory/native/export/blank-import-template', requireAuth, requirePermission('inventory.write'), async (req,res)=>{
  try {
    const fileName = 'MCC_Inventory_Blank_Import_Template.xlsx';
    const buffer = await workbookBuffer('MCC Inventory Import', nativeBlankImportHeaders, []);
    inventoryAudit(req,'inventory export blank template','inventory','native',{fileName});
    audit(req,'inventory export blank template','inventory','native',{fileName});
    sendDownload(res,fileName,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer);
  } catch (error) {
    const message = safeErrorMessage(error);
    res.status(500).json({ok:false,error:message});
  }
});
app.get('/api/inventory/native/backups', requireAuth, requirePermission('inventory.write'), (_req,res)=>{
  res.json({ok:true,backups:listNativeInventoryBackups()});
});
app.post('/api/inventory/native/backups/create', requireAuth, requirePermission('inventory.write'), (req,res)=>{
  try {
    const backups = createAndAuditNativeBackup(req,'manual');
    res.status(201).json({ok:true,backups,backupCount:backups.length});
  } catch (error) {
    const message = safeErrorMessage(error);
    res.status(500).json({ok:false,error:message});
  }
});
app.post('/api/inventory/native/import', requireAuth, requirePermission('inventory.write'), upload.single('file'), async (req,res)=>{
  try {
    const backupFiles = createAndAuditNativeBackup(req,'auto-before-import');
    const rows = await parseInventoryImportFile(req.file);
    const summary = importNativeInventoryRows(req, rows);
    inventoryAudit(req,'inventory import','inventory','native',{...summary,rowCount:rows.length,backupFiles:backupFiles.map(file => file.fileName)});
    audit(req,'inventory import','inventory','native',{...summary,rowCount:rows.length,backupFiles:backupFiles.map(file => file.fileName)});
    res.json({ok:true,...summary,backupFiles,nativeSummary:nativeInventorySummary()});
  } catch (error) {
    const message = safeErrorMessage(error);
    inventoryAudit(req,'failed import','inventory','native',{error:message});
    audit(req,'failed inventory import','inventory','native',{error:message});
    res.status(/choose a CSV|must include|must be CSV|numeric|required|already exists/i.test(message) ? 400 : 500).json({ok:false,error:message,addedCount:0,updatedCount:0,skippedCount:0,vendorCreatedCount:0,locationCreatedCount:0,invalidUrlCount:0,errors:[message]});
  }
});
app.post('/api/inventory/native/parts', requireAuth, requirePermission('inventory.write'), (req,res)=>{
  const actor = (req as AuthRequest).user!;
  const operation = 'native part create';
  try {
    const input: NativePartInput = validateNativePartInput(req.body);
    const timestamp = now();
    let partId = 0;
    db.exec('BEGIN IMMEDIATE');
    try {
      if (findDuplicateNativePart(input.partNumber)) throw new Error('Part Number already exists in MCC native inventory.');
      const location = getOrCreateMccNativeLookup(req,'inventory_locations',input.location,timestamp);
      const vendor = getOrCreateMccNativeLookup(req,'inventory_vendors',input.vendor,timestamp);
      const result = run(`INSERT INTO inventory_parts (mit3_item_id,part_number,description,location_id,vendor_id,quantity,min_quantity,status,requisition,part_info_url,manufacturer_brand,unit_cost,supplier_part_number,notes,source,imported_from_mit3_at,created_by_user_id,updated_by_user_id,created_at,updated_at,deleted) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`, [null,input.partNumber,input.description,location.id,vendor.id,input.quantity,input.minQuantity,input.status,'',input.partInfoUrl,input.manufacturerBrand,input.unitCost,input.supplierPartNumber,'','mcc',null,actor.id,actor.id,timestamp,timestamp]);
      partId = Number(result.lastInsertRowid);
      const createdRow = nativePartRowById(partId);
      inventoryAudit(req,'native part create','part',partId,{partNumber:input.partNumber,locationAutoCreated:location.created,vendorAutoCreated:vendor.created});
      audit(req,'inventory native part create','inventory',partId,{partNumber:input.partNumber});
      recordInventoryPartHistory({
        action: 'created',
        actor,
        partId,
        row: createdRow,
        newValue: createdRow ? nativePartHistoryValue(createdRow) : nativePartHistoryValue({...input,location_name:input.location,vendor_name:input.vendor}),
        quantityAfter: input.quantity,
      });
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    res.status(201).json({ok:true,source:'mcc-native',part:nativePartById(partId),summary:nativeInventorySummary()});
  } catch (error) {
    sendNativeInventoryError(req,res,operation,'',error);
  }
});
app.patch('/api/inventory/native/parts/:id', requireAuth, requirePermission('inventory.write'), (req,res)=>{
  const actor = (req as AuthRequest).user!;
  const operation = 'native part edit';
  const partId = Number(req.params.id);
  try {
    if (!Number.isInteger(partId) || partId <= 0) throw new Error('Native inventory part not found.');
    const input: NativePartInput = validateNativePartInput(req.body);
    const timestamp = now();
    db.exec('BEGIN IMMEDIATE');
    try {
      const existing = nativePartRowById(partId);
      if (!existing) throw new Error('Native inventory part not found.');
      if (findDuplicateNativePart(input.partNumber,partId)) throw new Error('Part Number already exists in MCC native inventory.');
      const location = getOrCreateMccNativeLookup(req,'inventory_locations',input.location,timestamp);
      const vendor = getOrCreateMccNativeLookup(req,'inventory_vendors',input.vendor,timestamp);
      run(`UPDATE inventory_parts SET part_number=?, description=?, location_id=?, vendor_id=?, quantity=?, min_quantity=?, status=?, part_info_url=?, manufacturer_brand=?, unit_cost=?, supplier_part_number=?, source=?, updated_by_user_id=?, updated_at=? WHERE id=?`, [input.partNumber,input.description,location.id,vendor.id,input.quantity,input.minQuantity,input.status,input.partInfoUrl,input.manufacturerBrand,input.unitCost,input.supplierPartNumber,'mcc',actor.id,timestamp,partId]);
      const updatedRow = nativePartRowById(partId);
      const quantityBefore = Number(existing.quantity ?? 0);
      const quantityAfter = Number(input.quantity ?? 0);
      inventoryAudit(req,'native part edit','part',partId,{partNumber:input.partNumber,locationAutoCreated:location.created,vendorAutoCreated:vendor.created});
      audit(req,'inventory native part edit','inventory',partId,{partNumber:input.partNumber});
      recordInventoryPartHistory({
        action: quantityBefore !== quantityAfter ? 'quantity_changed' : 'updated',
        actor,
        partId,
        row: updatedRow,
        oldValue: nativePartHistoryValue(existing),
        newValue: updatedRow ? nativePartHistoryValue(updatedRow) : nativePartHistoryValue({...input,location_name:input.location,vendor_name:input.vendor}),
        quantityBefore,
        quantityAfter,
      });
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    res.json({ok:true,source:'mcc-native',part:nativePartById(partId),summary:nativeInventorySummary()});
  } catch (error) {
    sendNativeInventoryError(req,res,operation,Number.isFinite(partId) ? partId : String(req.params.id ?? ''),error);
  }
});
app.patch('/api/inventory/native/parts/:id/requisition', requireAuth, requirePermission('inventory.write'), (req,res)=>{
  const actor = (req as AuthRequest).user!;
  const operation = 'native requisition change';
  const partId = Number(req.params.id);
  try {
    if (!Number.isInteger(partId) || partId <= 0) throw new Error('Native inventory part not found.');
    const nextRequisition = nativeRequisitionFromInput(req.body);
    const timestamp = now();
    let previousRequisition = '';
    db.exec('BEGIN IMMEDIATE');
    try {
      const existing = one<{ id: number; requisition: string }>('SELECT id,requisition FROM inventory_parts WHERE deleted=0 AND id=?', [partId]);
      if (!existing) throw new Error('Native inventory part not found.');
      previousRequisition = existing.requisition ?? '';
      run('UPDATE inventory_parts SET requisition=?, source=?, updated_by_user_id=?, updated_at=? WHERE id=?', [nextRequisition,'mcc',actor.id,timestamp,partId]);
      inventoryAudit(req,'native requisition change','part',partId,{previousRequisition,nextRequisition});
      audit(req,'inventory native requisition change','inventory',partId,{previousRequisition,nextRequisition});
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    res.json({ok:true,source:'mcc-native',part:nativePartById(partId),summary:nativeInventorySummary()});
  } catch (error) {
    sendNativeInventoryError(req,res,operation,Number.isFinite(partId) ? partId : String(req.params.id ?? ''),error);
  }
});
app.post('/api/inventory/native/import-from-mit3', requireAuth, requirePermission('inventory.import'), async (req,res)=>{
  const actor = (req as AuthRequest).user!;
  try {
    const data = await fetchMit3AppData();
    const parts = normalizeMit3Parts(data);
    const importedFromMit3At = now();
    let importedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let skippedUrlCount = 0;
    const errors: string[] = [];
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const part of parts) {
        if (part.rawPartInfoUrl.trim() && !part.partInfoUrl) skippedUrlCount += 1;
        const result = importMit3Part(part, actor.id, importedFromMit3At);
        if (result.imported) importedCount += 1;
        if (result.updated) updatedCount += 1;
        if (result.skipped) {
          skippedCount += 1;
          if (errors.length < 12) errors.push('Skipped one MIT3 item because it did not have a MIT3 item ID or part number.');
        }
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    if (skippedUrlCount > 0) errors.push(`${skippedUrlCount} non-http Part Info URL value(s) were skipped.`);
    const summary = nativeInventorySummary();
    const response = {
      ok: true,
      importedCount,
      updatedCount,
      skippedCount,
      vendorCount: summary.vendorCount,
      locationCount: summary.locationCount,
      skippedUrlCount,
      errors,
      importedFromMit3At,
      nativeSummary: summary,
    };
    inventoryAudit(req,'import from MIT3','inventory','native',{importedCount,updatedCount,skippedCount,skippedUrlCount,vendorCount:summary.vendorCount,locationCount:summary.locationCount});
    audit(req,'inventory native import from MIT3','inventory','native',{importedCount,updatedCount,skippedCount,skippedUrlCount});
    res.json(response);
  } catch (error) {
    const message = safeErrorMessage(error);
    inventoryAudit(req,'failed import from MIT3','inventory','native',{error:message});
    audit(req,'failed inventory native import from MIT3','inventory','native',{error:message});
    const summary = nativeInventorySummary();
    res.status(/MIT3 is offline|not reachable|app-data/i.test(message) ? 503 : 500).json({ok:false,error:message,importedCount:0,updatedCount:0,skippedCount:0,vendorCount:summary.vendorCount,locationCount:summary.locationCount,errors:[message],nativeSummary:summary});
  }
});
app.get('/api/inventory/mit3-status', requireAuth, requirePermission('inventory.view'), async (_req,res)=>res.json(await checkMit3Status()));
app.get('/api/inventory/mit3-parts', requireAuth, requirePermission('inventory.view'), async (_req,res)=>{
  try {
    res.json({ok:true,mit3Url,writeAvailable:true,...await fetchMit3Inventory()});
  } catch (error) {
    res.status(503).json({ok:false,error:error instanceof Error ? error.message : 'MIT3 is offline or not reachable. Start MIT3 Website first.',mit3Url});
  }
});
app.post('/api/inventory/mit3-parts', requireAuth, requirePermission('inventory.write'), async (req,res)=>{
  const operation = 'inventory add through MIT3';
  try {
    const input = validateMit3PartInput(req.body);
    const {part,id} = await mutateMit3Inventory(req, operation, '', data => {
      const items = recordArray(data, 'items');
      const timestamp = now();
      const item: Record<string, unknown> = {
        id: `mcc-${crypto.randomUUID()}`,
        name: input.description || input.partNumber,
        partNumber: input.partNumber,
        description: input.description,
        category: 'Other',
        quantityOnHand: input.quantity,
        stockUnit: 'each',
        minimumStockLevel: input.minQuantity,
        lowStockAlertLevel: input.minQuantity,
        locationId: '',
        vendorId: '',
        costEach: 0,
        itemUrl: input.partInfoUrl,
        notes: '',
        imagePlaceholder: '',
        imageDataUrl: '',
        barcodePlaceholder: '',
        reorderHold: false,
        orderPlaced: false,
        orderRequisitionId: '',
        hiddenFromWatchList: false,
        nonStocked: false,
        isDemo: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      applyMit3PartInput(item, input, data, timestamp);
      items.unshift(item);
      return textField(item, ['id']);
    });
    audit(req,operation,'inventory',id,{partNumber:input.partNumber});
    res.status(201).json({ok:true,mit3Url,part});
  } catch (error) {
    sendMit3InventoryError(req,res,operation,'',error);
  }
});
app.patch('/api/inventory/mit3-parts/:id', requireAuth, requirePermission('inventory.write'), async (req,res)=>{
  const operation = 'inventory edit through MIT3';
  const targetId = String(req.params.id ?? '');
  try {
    const input = validateMit3PartInput(req.body);
    const {part,id} = await mutateMit3Inventory(req, operation, targetId, data => {
      const items = recordArray(data, 'items');
      const index = findMit3Item(items, targetId);
      if (index < 0 || !isRecord(items[index])) throw new Error('MIT3 inventory item not found.');
      const item = items[index];
      applyMit3PartInput(item, input, data, now());
      return textField(item, ['id', 'itemId', 'item_id'], targetId);
    });
    audit(req,operation,'inventory',id,{partNumber:input.partNumber});
    res.json({ok:true,mit3Url,part});
  } catch (error) {
    sendMit3InventoryError(req,res,operation,targetId,error);
  }
});
app.patch('/api/inventory/mit3-parts/:id/requisition', requireAuth, requirePermission('inventory.write'), async (req,res)=>{
  const operation = 'inventory requisition update through MIT3';
  const targetId = String(req.params.id ?? '');
  try {
    const input = isRecord(req.body) ? req.body : {};
    const requisition = Boolean(input.requisition ?? input.orderPlaced);
    const {part,id} = await mutateMit3Inventory(req, operation, targetId, data => {
      const items = recordArray(data, 'items');
      const index = findMit3Item(items, targetId);
      if (index < 0 || !isRecord(items[index])) throw new Error('MIT3 inventory item not found.');
      const item = items[index];
      item.orderPlaced = requisition;
      item.orderRequisitionId = requisition ? textField(item, ['orderRequisitionId'], 'MCC Requisition') : '';
      item.updatedAt = now();
      return textField(item, ['id', 'itemId', 'item_id'], targetId);
    });
    audit(req,operation,'inventory',id,{requisition});
    res.json({ok:true,mit3Url,part});
  } catch (error) {
    sendMit3InventoryError(req,res,operation,targetId,error);
  }
});
app.use(express.static(frontendDistPath));
app.get('*', (_req,res)=>res.sendFile(path.join(frontendDistPath,'index.html')));
app.listen(port,()=>{
  console.log(`${appName} running at http://localhost:${port}`);
  console.log(`SESSION_SECRET configured: ${sessionSecretConfigured ? 'yes' : 'no'}`);
  console.log(`SMTP configured: ${smtpConfigured ? 'yes' : 'no'}`);
  startMasterBackupScheduler();
});
