import crypto from 'node:crypto';
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

const db = new DatabaseSync(dbPath);
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
CREATE TABLE IF NOT EXISTS inventory_parts (id INTEGER PRIMARY KEY AUTOINCREMENT, mit3_item_id TEXT, part_number TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', location_id INTEGER, vendor_id INTEGER, quantity REAL NOT NULL DEFAULT 0, min_quantity REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT '', requisition TEXT NOT NULL DEFAULT '', part_info_url TEXT NOT NULL DEFAULT '', manufacturer_brand TEXT NOT NULL DEFAULT '', unit_cost REAL, supplier_part_number TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'mcc', imported_from_mit3_at TEXT, created_by_user_id INTEGER, updated_by_user_id INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, deleted_at TEXT, deleted_by_user_id INTEGER);
CREATE TABLE IF NOT EXISTS inventory_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_user_id INTEGER, action TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL, details_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS inventory_requisitions (id INTEGER PRIMARY KEY AUTOINCREMENT, requisition_number TEXT NOT NULL UNIQUE, inventory_part_id INTEGER NOT NULL, part_number TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', vendor_name TEXT NOT NULL DEFAULT '', location_name TEXT NOT NULL DEFAULT '', quantity_requested REAL NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'Requested', requested_by_user_id INTEGER, requested_by_name TEXT NOT NULL DEFAULT '', requested_at TEXT NOT NULL, ordered_by_user_id INTEGER, ordered_at TEXT, received_by_user_id INTEGER, received_at TEXT, canceled_by_user_id INTEGER, canceled_at TEXT, cancel_reason TEXT NOT NULL DEFAULT '', work_order_number TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, deleted_at TEXT, deleted_by_user_id INTEGER);
CREATE INDEX IF NOT EXISTS idx_inventory_parts_mit3_item_id ON inventory_parts (mit3_item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_parts_part_number ON inventory_parts (part_number COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_inventory_parts_deleted ON inventory_parts (deleted);
CREATE INDEX IF NOT EXISTS idx_inventory_vendors_name ON inventory_vendors (name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_inventory_locations_name ON inventory_locations (name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_inventory_requisitions_number ON inventory_requisitions (requisition_number COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_inventory_requisitions_part ON inventory_requisitions (inventory_part_id,status,deleted);
CREATE INDEX IF NOT EXISTS idx_inventory_requisitions_status ON inventory_requisitions (status,deleted);`);
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
  if (!inventoryPartColumns.has('unit_cost')) run('ALTER TABLE inventory_parts ADD COLUMN unit_cost REAL');
  if (!inventoryPartColumns.has('supplier_part_number')) run("ALTER TABLE inventory_parts ADD COLUMN supplier_part_number TEXT NOT NULL DEFAULT ''");

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
function audit(req: Request, action: string, targetType?: string, targetId?: string|number, details: Record<string, unknown> = {}) { const u = (req as AuthRequest).user; run('INSERT INTO audit_log (actor_user_id,actor_email,action,target_type,target_id,details_json,ip_address,user_agent,created_at) VALUES (?,?,?,?,?,?,?,?,?)', [u?.id ?? null,u?.email ?? '',action,targetType ?? '',String(targetId ?? ''),JSON.stringify(details),req.ip ?? '',req.get('user-agent') ?? '',now()]); }
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
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const entry of interfaces ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) urls.add(`http://${entry.address}:${port}`);
    }
  }
  return [...urls].sort();
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
type NativePartFilter = 'all' | 'low' | 'requisition' | 'hasLink' | 'noLink';
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
    unitCost: row.unit_cost === null || row.unit_cost === undefined ? null : Number(row.unit_cost),
    supplierPartNumber: row.supplier_part_number ?? '',
    updatedAt: row.updated_at,
    source: row.source,
    importedFromMit3At: row.imported_from_mit3_at ?? '',
  };
}
function nativePartById(id: number) {
  const row = one<NativePartRow>(`SELECT p.*, l.name AS location_name, v.name AS vendor_name
FROM inventory_parts p
LEFT JOIN inventory_locations l ON l.id=p.location_id AND l.deleted=0
LEFT JOIN inventory_vendors v ON v.id=p.vendor_id AND v.deleted=0
WHERE p.deleted=0 AND p.id=?`, [id]);
  return row ? normalizeNativePart(row) : undefined;
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
  if (filter === 'hasLink') where.push("p.part_info_url<>''");
  if (filter === 'noLink') where.push("p.part_info_url=''");
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
    'Unit Cost': row.unit_cost === null || row.unit_cost === undefined ? '' : Number(row.unit_cost),
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
  for (const record of records) sheet.addRow(headers.map(header => record[header as NativeExportHeader] ?? ''));
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
function excelCellText(cell: ExcelJS.Cell) {
  const value = cell.value;
  if (value && typeof value === 'object') {
    if ('text' in value && value.text !== undefined) return String(value.text).trim();
    if ('result' in value && value.result !== undefined) return String(value.result).trim();
    if ('richText' in value && Array.isArray(value.richText)) return value.richText.map(part => part.text).join('').trim();
  }
  return String(cell.text ?? value ?? '').trim();
}
async function importRowsFromExcel(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook();
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  await workbook.xlsx.load(arrayBuffer);
  const sheet = workbook.getWorksheet('MCC Inventory Update') ?? workbook.getWorksheet('MCC Inventory Import');
  if (!sheet) throw new Error('Excel file must include a sheet named MCC Inventory Import or MCC Inventory Update.');
  const rows: string[][] = [];
  const columnCount = Math.max(sheet.columnCount, nativeExportHeaders.length);
  for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const values: string[] = [];
    for (let columnNumber = 1; columnNumber <= columnCount; columnNumber += 1) {
      values.push(excelCellText(row.getCell(columnNumber)));
    }
    if (values.some(value => value.trim())) rows.push(values);
  }
  return importRowsFromTable(rows);
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
        const unitCost = row.unitCost.trim() ? numericImportValue(row.unitCost, 'Unit Cost', row.rowNumber) : null;
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
    Number.isFinite(part.unitCost) ? Number(part.unitCost) : null,
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
  const location = textField(input, ['location']);
  const vendor = textField(input, ['vendor']);
  const quantity = numericInput(input, 'quantity', 'Quantity');
  const minQuantity = numericInput(input, 'minQuantity', 'Minimum Quantity');
  const manufacturerBrand = textField(input, ['manufacturerBrand','manufacturer','brand']).slice(0, 160);
  const unitCost = input.unitCost === undefined || input.unitCost === null || String(input.unitCost).trim() === '' ? null : numericInput(input, 'unitCost', 'Unit Cost');
  if (unitCost !== null && unitCost < 0) throw new Error('Unit Cost must be zero or greater.');
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
  if (/required|numeric|valid http\/https/i.test(message)) return 400;
  return 500;
}
function sendNativeInventoryError(req: Request, res: Response, operation: string, targetId: string|number, error: unknown) {
  const message = safeErrorMessage(error);
  inventoryAudit(req,'failed native write','inventory',targetId,{operation,error:message});
  audit(req,'failed inventory native write','inventory',targetId,{operation,error:message});
  res.status(nativeInventoryErrorStatus(message)).json({ok:false,error:message});
}
type RequisitionStatus = 'Requested' | 'Ordered' | 'Received' | 'Canceled';
const requisitionStatuses: RequisitionStatus[] = ['Requested','Ordered','Received','Canceled'];
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
  status: RequisitionStatus;
  requested_by_user_id: number | null;
  requested_by_name: string;
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
function publicRequisition(row: RequisitionRow) {
  return {
    id: row.id,
    requisitionNumber: row.requisition_number,
    inventoryPartId: row.inventory_part_id,
    partNumber: row.part_number,
    description: row.description,
    vendorName: row.vendor_name,
    locationName: row.location_name,
    quantityRequested: Number(row.quantity_requested ?? 0),
    status: row.status,
    requestedByUserId: row.requested_by_user_id,
    requestedByName: row.requested_by_name,
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
  };
}
function activeRequisitionForPart(partId: number) {
  return one<{ requisition_number: string; status: RequisitionStatus }>(`SELECT requisition_number,status FROM inventory_requisitions WHERE deleted=0 AND inventory_part_id=? AND status IN ('Requested','Ordered') ORDER BY requested_at DESC, id DESC LIMIT 1`, [partId]);
}
function activeRequisitionCountForPart(partId: number) {
  return one<{ count: number }>(`SELECT COUNT(*) AS count FROM inventory_requisitions WHERE deleted=0 AND inventory_part_id=? AND status IN ('Requested','Ordered')`, [partId])?.count ?? 0;
}
function syncPartRequisitionFlag(partId: number, timestamp = now()) {
  const active = activeRequisitionForPart(partId);
  run('UPDATE inventory_parts SET requisition=?, updated_at=? WHERE id=?', [active ? active.status : '',timestamp,partId]);
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

function pdfEscape(value: string) {
  return value.replace(/[\\()]/g, match => `\\${match}`);
}
function safeFileToken(value: string) {
  return (value || 'Unknown_Vendor').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'Unknown_Vendor';
}
function wrapPdfText(value: string, max = 78) {
  const words = String(value || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > max && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}
type PdfPage = { width: number; height: number; content: string };
type RequisitionPdfItem = {partNumber:string;description:string;locationName:string;quantityRequested:number;unitCost?:number|null;supplierPartNumber?:string;dueDate?:string;notes?:string;unitOfMeasure?:string};
type RequisitionTemplateKind = 'under-100' | 'over-100';
type TemplateFieldKey = 'poNo' | 'poInitiator' | 'shipVia' | 'poClass' | 'requestDate' | 'vendorName' | 'vendorAddress' | 'confirmedWith' | 'assetNo' | 'moldNo' | 'equipmentNo' | 'partNo' | 'jobNo' | 'initials' | 'tsNo' | 'codeNo' | 'workOrderNo' | 'comments' | 'departmentManager' | 'requisitionedBy' | 'authorizedBy' | 'taxExempt' | 'materialCert' | 'fob';
type RequisitionTemplateConfig = {
  kind: RequisitionTemplateKind;
  sheetName: string;
  usedRange: string;
  printArea: string;
  title: string;
  defaultRowHeight: number;
  rowHeights: Record<number, number>;
  columnWidths: number[];
  formX: number;
  formY: number;
  formW: number;
  formH: number;
  titleRange: string;
  labels: Array<{range: string; text: string; size?: number; align?: 'left' | 'center' | 'right'}>;
  fields: Record<TemplateFieldKey, string>;
  itemRows: {start: number; end: number};
  itemColumns: {quantity: string; unitOfMeasure: string; itemNumber: string; description: string; dueDate: string; unitPrice: string; totalPrice: string};
  vendorTotalRange: string;
};

function buildPdfDocument(pdfPages: PdfPage[]) {
  const objects: string[] = [];
  const pageObjectNumbers: number[] = [];
  for (const page of pdfPages) {
    const content = page.content;
    const contentObjectNumber = objects.length + 1;
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`);
    const pageObjectNumber = objects.length + 1;
    objects.push(`<< /Type /Page /Parent 0 0 R /MediaBox [0 0 ${page.width} ${page.height}] /Resources << /Font << /F1 0 0 R /F2 0 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`);
    pageObjectNumbers.push(pageObjectNumber);
  }
  const regularFontObjectNumber = objects.length + 1;
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const boldFontObjectNumber = objects.length + 1;
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  const pagesObjectNumber = objects.length + 1;
  objects.push(`<< /Type /Pages /Kids [${pageObjectNumbers.map(n=>`${n} 0 R`).join(' ')}] /Count ${pageObjectNumbers.length} >>`);
  const catalogObjectNumber = objects.length + 1;
  objects.push(`<< /Type /Catalog /Pages ${pagesObjectNumber} 0 R >>`);
  const patched = objects.map((object) => {
    return object
      .replaceAll('/Parent 0 0 R', `/Parent ${pagesObjectNumber} 0 R`)
      .replaceAll('/F1 0 0 R', `/F1 ${regularFontObjectNumber} 0 R`)
      .replaceAll('/F2 0 0 R', `/F2 ${boldFontObjectNumber} 0 R`);
  });
  const parts = ['%PDF-1.4\n'];
  const offsets: number[] = [0];
  for (let i = 0; i < patched.length; i += 1) {
    offsets.push(Buffer.byteLength(parts.join('')));
    parts.push(`${i + 1} 0 obj\n${patched[i]}\nendobj\n`);
  }
  const xrefOffset = Buffer.byteLength(parts.join(''));
  parts.push(`xref\n0 ${patched.length + 1}\n0000000000 65535 f \n`);
  for (let i = 1; i < offsets.length; i += 1) parts.push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  parts.push(`trailer\n<< /Size ${patched.length + 1} /Root ${catalogObjectNumber} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
  return Buffer.from(parts.join(''));
}

function pdfNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/,'').replace(/\.$/,'');
}

function columnNameToNumber(name: string) {
  return name.split('').reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0);
}

function parseCellRef(ref: string) {
  const match = /^([A-Z]+)(\d+)$/.exec(ref.trim());
  if (!match) throw new Error(`Invalid cell reference: ${ref}`);
  return { column: columnNameToNumber(match[1]), row: Number(match[2]) };
}

function parseRangeRef(ref: string) {
  const [startRef, endRef = startRef] = ref.split(':');
  const start = parseCellRef(startRef);
  const end = parseCellRef(endRef);
  return {
    startColumn: Math.min(start.column, end.column),
    endColumn: Math.max(start.column, end.column),
    startRow: Math.min(start.row, end.row),
    endRow: Math.max(start.row, end.row),
  };
}

function makeRequisitionTemplateGeometry(config: RequisitionTemplateConfig) {
  const print = parseRangeRef(config.printArea);
  const rowHeights = new Map<number, number>();
  for (let row = print.startRow; row <= print.endRow; row += 1) rowHeights.set(row, config.rowHeights[row] ?? config.defaultRowHeight);
  const totalHeight = [...rowHeights.values()].reduce((sum, height) => sum + height, 0);
  const totalWidth = config.columnWidths.slice(0, print.endColumn).reduce((sum, width) => sum + width, 0);
  const scaleY = config.formH / totalHeight;
  const scaleX = config.formW / totalWidth;
  const xEdges = [config.formX];
  for (let index = 0; index < print.endColumn; index += 1) xEdges.push(xEdges[index] + config.columnWidths[index] * scaleX);
  const yEdges = [config.formY];
  for (let row = print.startRow; row <= print.endRow; row += 1) yEdges.push(yEdges[yEdges.length - 1] + (rowHeights.get(row) ?? config.defaultRowHeight) * scaleY);
  const box = (range: string) => {
    const parsed = parseRangeRef(range);
    const left = xEdges[parsed.startColumn - 1];
    const right = xEdges[parsed.endColumn];
    const top = yEdges[parsed.startRow - print.startRow];
    const bottom = yEdges[parsed.endRow - print.startRow + 1];
    return { x: left, y: top, width: right - left, height: bottom - top };
  };
  const rowBox = (row: number, startColumn: number, endColumn: number) => {
    const left = xEdges[startColumn - 1];
    const right = xEdges[endColumn];
    const top = yEdges[row - print.startRow];
    const bottom = yEdges[row - print.startRow + 1];
    return { x: left, y: top, width: right - left, height: bottom - top };
  };
  return { print, box, rowBox };
}

function fitText(text: string, maxWidth: number, size: number) {
  const value = text.replace(/\s+/g, ' ').trim();
  if (!value) return '';
  const maxChars = Math.max(1, Math.floor(maxWidth / (size * 0.52)));
  return value.length <= maxChars ? value : `${value.slice(0, Math.max(1, maxChars - 1))}...`;
}

function wrapTextToBox(text: string, maxWidth: number, size: number, maxLines: number) {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (!words.length) return [''];
  const maxChars = Math.max(4, Math.floor(maxWidth / (size * 0.52)));
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const visible = lines.slice(0, maxLines);
    visible[visible.length - 1] = fitText(`${visible[visible.length - 1]} ...`, maxWidth, size);
    return visible;
  }
  return lines;
}

function pdfRect(box: {x:number;y:number;width:number;height:number}, pageHeight: number, options: {stroke?: string; fill?: string; width?: number} = {}) {
  const y = pageHeight - box.y - box.height;
  const width = options.width ?? 0.45;
  const color = options.stroke ?? '0 0 0';
  const fill = options.fill;
  if (fill) return `${fill} rg ${color} RG ${pdfNumber(width)} w ${pdfNumber(box.x)} ${pdfNumber(y)} ${pdfNumber(box.width)} ${pdfNumber(box.height)} re B\n`;
  return `${color} RG ${pdfNumber(width)} w ${pdfNumber(box.x)} ${pdfNumber(y)} ${pdfNumber(box.width)} ${pdfNumber(box.height)} re S\n`;
}

function pdfText(text: string, box: {x:number;y:number;width:number;height:number}, pageHeight: number, options: {size?: number; bold?: boolean; align?: 'left'|'center'|'right'; valign?: 'top'|'middle'|'bottom'; maxLines?: number; color?: string} = {}) {
  const size = options.size ?? 8;
  const align = options.align ?? 'left';
  const maxLines = options.maxLines ?? 1;
  const lines = maxLines > 1 ? wrapTextToBox(text, box.width - 4, size, maxLines) : [fitText(text, box.width - 4, size)];
  const lineHeight = size * 1.15;
  const totalLineHeight = lines.length * lineHeight;
  const yTop = options.valign === 'bottom'
    ? box.y + box.height - totalLineHeight - 2
    : options.valign === 'middle'
      ? box.y + Math.max(1, (box.height - totalLineHeight) / 2)
      : box.y + 2;
  let content = `${options.color ?? '0 0 0'} rg BT\n/${options.bold ? 'F2' : 'F1'} ${pdfNumber(size)} Tf\n`;
  lines.forEach((line, index) => {
    const estimatedWidth = line.length * size * 0.52;
    const x = align === 'right' ? box.x + box.width - estimatedWidth - 2 : align === 'center' ? box.x + (box.width - estimatedWidth) / 2 : box.x + 2;
    const y = pageHeight - (yTop + index * lineHeight + size);
    content += `1 0 0 1 ${pdfNumber(x)} ${pdfNumber(y)} Tm (${pdfEscape(line)}) Tj\n`;
  });
  content += 'ET\n';
  return content;
}

const under100Template: RequisitionTemplateConfig = {
  kind: 'under-100',
  sheetName: 'PURCHASE ORDER under $100',
  usedRange: 'A1:P37',
  printArea: 'A1:N37',
  title: 'PURCHASE ORDER REQUISITION Under $100.00',
  defaultRowHeight: 12.75,
  rowHeights: {4:15.75,10:13.5,15:15.75,16:15.75,17:15.75,18:16.5,20:16.5,21:13.5,22:40.5,23:48.75},
  columnWidths: [6.28515625,16.28515625,13.85546875,9.140625,9.140625,9.140625,9.140625,9.140625,9.140625,9.140625,9.140625,9.140625,9.140625,9.140625],
  formX: 36,
  formY: 28,
  formW: 720,
  formH: 542,
  titleRange: 'A4:N4',
  labels: [
    {range:'B6:B6',text:'P.O. No.:'},{range:'F6:F6',text:'P.O. Initiator:'},{range:'K6:K6',text:'Ship Via:'},
    {range:'B8:B8',text:'P.O. Class:'},{range:'F8:F8',text:'Tax Exempt ?:'},{range:'K8:K8',text:'F.O.B.:'},
    {range:'B10:B10',text:'Req. Date:'},{range:'F10:F10',text:'Material Cert?:'},{range:'M11:N11',text:'Tooling Orders ONLY',align:'center',size:7},
    {range:'B12:B12',text:'Vendor Name:'},{range:'B13:B13',text:'(Address & Phone No.'},{range:'B14:B14',text:'ONLY if new vendor)'},
    {range:'F12:F12',text:'Confirmed With:'},{range:'F15:F15',text:'Asset No.:'},{range:'J16:J16',text:'Initials'},
    {range:'B18:B18',text:'Work Order No.:'},{range:'F18:G18',text:'Equipment No.:'},{range:'L13:L13',text:'Part No.:'},
    {range:'L14:L14',text:'Job No.:'},{range:'L15:L15',text:'Mold No.:'},{range:'L16:L16',text:'T/S No.:'},{range:'L17:L17',text:'Code No.:'},
    {range:'A20:A21',text:'Quantity',align:'center'},{range:'B20:B20',text:'Unit of',align:'center'},{range:'B21:B21',text:'Measure',align:'center'},
    {range:'C20:C20',text:'Item',align:'center'},{range:'C21:C21',text:'Number',align:'center'},{range:'D20:I21',text:'Item Description/Revision',align:'center'},
    {range:'J20:K20',text:'Due',align:'center'},{range:'J21:K21',text:'Date',align:'center'},{range:'L20:L20',text:'Unit',align:'center'},
    {range:'L21:L21',text:'Price',align:'center'},{range:'M20:M20',text:'Total',align:'center'},{range:'M21:M21',text:'Price',align:'center'},
    {range:'B34:B34',text:'COMMENTS:'},{range:'L35:N35',text:'DEPARTMENT  MANAGER',align:'center',size:7},{range:'G37:I37',text:'REQUISITIONED',align:'center',size:7},{range:'L37:N37',text:'AUTHORIZED BY:',align:'center',size:7},
  ],
  fields: {
    poNo:'C6:D6', poInitiator:'G6:I6', shipVia:'L6:N6', poClass:'C8:D8', taxExempt:'G8:I8', fob:'L8:N8',
    requestDate:'C10:D10', materialCert:'G10:I10', vendorName:'C12:D12', vendorAddress:'C13:D14', confirmedWith:'G12:I12',
    assetNo:'G15:H15', moldNo:'M15:N15', equipmentNo:'H18:J18', partNo:'M13:N13', jobNo:'M14:N14', initials:'K16:K16',
    tsNo:'M16:N16', codeNo:'M17:N17', workOrderNo:'C18:E18', comments:'C34:I34', departmentManager:'L34:N34',
    requisitionedBy:'F36:I36', authorizedBy:'L36:N36',
  },
  itemRows: {start: 22, end: 32},
  itemColumns: {quantity:'A',unitOfMeasure:'B',itemNumber:'C',description:'D:I',dueDate:'J:K',unitPrice:'L',totalPrice:'M:N'},
  vendorTotalRange: 'N20:N21',
};

const over100Template: RequisitionTemplateConfig = {
  kind: 'over-100',
  sheetName: 'Sheet1',
  usedRange: 'A1:S39',
  printArea: 'A1:P40',
  title: 'PURCHASE ORDER REQUISITION',
  defaultRowHeight: 12.75,
  rowHeights: {5:15,6:12.75,9:12.95,11:13.5,13:15,14:15,15:15,16:15,17:15,18:15,19:15.75,21:14.1,22:14.1,23:54.75,24:64.5,25:45.75,26:27.75,27:33,28:44.25,29:17.1,30:17.1,31:17.1,32:17.1,33:27.75,34:29.25,36:50.25},
  columnWidths: [4.140625,8,10.7109375,23.140625,7.28515625,6,10.28515625,9.42578125,9.42578125,2.7109375,4.7109375,8.7109375,10.28515625,6.5703125,8.28515625,11],
  formX: 30,
  formY: 24,
  formW: 732,
  formH: 550,
  titleRange: 'C5:O5',
  labels: [
    {range:'C7:C7',text:'P.O. No.:'},{range:'G7:G7',text:'P.O. Initiator:'},{range:'L7:L7',text:'Ship Via:'},
    {range:'C9:C9',text:'P.O. Class:'},{range:'G9:G9',text:'Tax Exempt ?:'},{range:'L9:L9',text:'F.O.B.:'},
    {range:'C11:C11',text:'Req. Date:'},{range:'G11:G11',text:'Material Cert?:'},{range:'N12:O12',text:'Tooling Orders ONLY',align:'center',size:7},
    {range:'C13:C13',text:'Vendor Name:'},{range:'C14:C14',text:'(Address & Phone No.'},{range:'C15:C15',text:'ONLY if new vendor)'},
    {range:'G13:G13',text:'Confirmed With:'},{range:'G16:G16',text:'Asset No.:'},{range:'K17:K17',text:'Initials'},
    {range:'C19:C19',text:'Work Order No.:'},{range:'E19:F19',text:'Equipment No.:'},{range:'M14:M14',text:'Part No.:'},
    {range:'M15:M15',text:'Job No.:'},{range:'M16:M16',text:'Mold No.:'},{range:'M17:M17',text:'T/S No.:'},{range:'M18:M18',text:'Code No.:'},
    {range:'B21:B22',text:'Quantity',align:'center'},{range:'C21:C21',text:'Unit of',align:'center'},{range:'C22:C22',text:'Measure',align:'center'},
    {range:'D21:D21',text:'Item',align:'center'},{range:'D22:D22',text:'Number',align:'center'},{range:'E21:J22',text:'Item Description/Revision',align:'center'},
    {range:'K21:L21',text:'Due',align:'center'},{range:'K22:L22',text:'Date',align:'center'},{range:'M21:M21',text:'Unit',align:'center'},
    {range:'M22:M22',text:'Price',align:'center'},{range:'N21:N21',text:'Total',align:'center'},{range:'N22:N22',text:'Price',align:'center'},
    {range:'C36:C36',text:'COMMENTS:'},{range:'M37:O37',text:'DEPARTMENT  MANAGER',align:'center',size:7},{range:'H39:J39',text:'REQUISITIONED',align:'center',size:7},{range:'M39:O39',text:'AUTHORIZED BY:',align:'center',size:7},
  ],
  fields: {
    poNo:'D7:E7', poInitiator:'H7:J7', shipVia:'M7:O7', poClass:'D9:E9', taxExempt:'H9:J9', fob:'M9:O9',
    requestDate:'D11:E11', materialCert:'H11:J11', vendorName:'D13:E13', vendorAddress:'D14:E16', confirmedWith:'H13:J13',
    assetNo:'H16:I16', moldNo:'N16:O16', equipmentNo:'G19:H19', partNo:'N14:O14', jobNo:'N15:O15', initials:'L17:L17',
    tsNo:'N17:O17', codeNo:'N18:O18', workOrderNo:'D19:D19', comments:'D36:J36', departmentManager:'M36:O36',
    requisitionedBy:'G38:J38', authorizedBy:'M38:O38',
  },
  itemRows: {start: 23, end: 34},
  itemColumns: {quantity:'B',unitOfMeasure:'C',itemNumber:'D',description:'E:J',dueDate:'K:L',unitPrice:'M',totalPrice:'N:O'},
  vendorTotalRange: 'O21:O22',
};

function templateForRequisitionType(type: RequisitionTemplateKind) {
  return type === 'over-100' ? over100Template : under100Template;
}

function money(value: number) {
  return value ? `$${value.toFixed(2)}` : '';
}

function normalizedRequisitionType(rawType: string, total: number): RequisitionTemplateKind {
  const clean = rawType.toLowerCase();
  if (clean.includes('over')) return 'over-100';
  if (clean.includes('under')) return 'under-100';
  return total >= 100 ? 'over-100' : 'under-100';
}

function columnRangeForRow(columnRange: string, row: number) {
  const [start, end = start] = columnRange.split(':');
  return `${start}${row}:${end}${row}`;
}

function buildRequisitionPage(input: { vendor: string; requisitionNumber: string; requestedBy: string; createdAt: string; notes: string; header: Record<string, unknown>; items: RequisitionPdfItem[]; pageItems: RequisitionPdfItem[]; pageIndex: number; pageCount: number; total: number; template: RequisitionTemplateConfig }) {
  const pageWidth = 792;
  const pageHeight = 612;
  const { template } = input;
  const geometry = makeRequisitionTemplateGeometry(template);
  const field = (keys: string[], fallback = '') => textField(input.header, keys, fallback);
  const date = field(['requestDate']) || new Date(input.createdAt).toLocaleDateString('en-US');
  const fieldValues: Record<TemplateFieldKey, string> = {
    poNo: field(['poNo'], input.requisitionNumber),
    poInitiator: field(['poInitiator']),
    shipVia: field(['shipVia']),
    poClass: field(['poClass']),
    requestDate: date,
    vendorName: field(['vendorName'], input.vendor || 'Unknown Vendor'),
    vendorAddress: field(['vendorAddress']),
    confirmedWith: field(['confirmedWith']),
    assetNo: field(['assetNo']),
    moldNo: field(['moldNo']),
    equipmentNo: field(['equipmentNo']),
    partNo: field(['partNo']),
    jobNo: field(['jobNo']),
    initials: field(['initials']),
    tsNo: field(['tsNo']),
    codeNo: field(['codeNo']),
    workOrderNo: field(['workOrderNo']),
    comments: field(['comments'], input.notes || ''),
    departmentManager: field(['departmentManager']),
    requisitionedBy: field(['requisitionedBy'], input.requestedBy || ''),
    authorizedBy: field(['authorizedBy']),
    taxExempt: field(['taxExempt'], 'No'),
    materialCert: field(['materialCert'], 'No'),
    fob: field(['fob'], 'Destination'),
  };
  let content = '';
  const formBox = geometry.box(template.printArea);
  content += pdfRect(formBox, pageHeight, {stroke:'0 0 0', width:0.7});
  content += pdfText(template.title, geometry.box(template.titleRange), pageHeight, {size:12, bold:true, align:'center', valign:'middle'});
  for (const label of template.labels) {
    content += pdfText(label.text, geometry.box(label.range), pageHeight, {size:label.size ?? 7.5, bold:true, align:label.align ?? 'left', valign:'middle'});
  }
  const fieldRanges = Object.values(template.fields);
  for (const range of fieldRanges) content += pdfRect(geometry.box(range), pageHeight, {stroke:'0.25 0.25 0.25', width:0.45});
  content += pdfRect(geometry.box(template.vendorTotalRange), pageHeight, {stroke:'0 0 0', width:0.55});
  for (const [key, range] of Object.entries(template.fields) as Array<[TemplateFieldKey, string]>) {
    const box = geometry.box(range);
    content += pdfText(fieldValues[key], box, pageHeight, {size: key === 'comments' || key === 'vendorAddress' ? 7 : 7.5, maxLines: key === 'comments' || key === 'vendorAddress' ? 3 : 1, valign:'middle'});
  }
  content += pdfText(money(input.total), geometry.box(template.vendorTotalRange), pageHeight, {size:8, bold:true, align:'center', valign:'middle'});

  const itemStartColumn = parseRangeRef(columnRangeForRow(template.itemColumns.quantity, template.itemRows.start)).startColumn;
  const itemEndColumn = parseRangeRef(columnRangeForRow(template.itemColumns.totalPrice, template.itemRows.end)).endColumn;
  for (let row = template.itemRows.start - 2; row <= template.itemRows.end; row += 1) {
    content += pdfRect(geometry.rowBox(row, itemStartColumn, itemEndColumn), pageHeight, {stroke:'0 0 0', fill: row < template.itemRows.start ? '0.92 0.92 0.92' : undefined, width:0.45});
  }
  for (let row = template.itemRows.start; row <= template.itemRows.end; row += 1) {
    for (const columnRange of Object.values(template.itemColumns)) content += pdfRect(geometry.box(columnRangeForRow(columnRange, row)), pageHeight, {stroke:'0 0 0', width:0.35});
  }
  input.pageItems.forEach((item, offset) => {
    const row = template.itemRows.start + offset;
    const unitCost = Number(item.unitCost ?? 0) || 0;
    const total = unitCost * item.quantityRequested;
    const number = item.supplierPartNumber || item.partNumber || '';
    const notes = item.notes ? ` Notes: ${item.notes}` : '';
    const description = `${item.description || '-'}${notes}`;
    const values = {
      quantity: String(item.quantityRequested),
      unitOfMeasure: item.unitOfMeasure || 'EA',
      itemNumber: number,
      description,
      dueDate: item.dueDate || '',
      unitPrice: money(unitCost),
      totalPrice: money(total),
    };
    content += pdfText(values.quantity, geometry.box(columnRangeForRow(template.itemColumns.quantity, row)), pageHeight, {size:7, align:'center', valign:'middle'});
    content += pdfText(values.unitOfMeasure, geometry.box(columnRangeForRow(template.itemColumns.unitOfMeasure, row)), pageHeight, {size:7, align:'center', valign:'middle'});
    content += pdfText(values.itemNumber, geometry.box(columnRangeForRow(template.itemColumns.itemNumber, row)), pageHeight, {size:6.5, align:'center', valign:'middle'});
    content += pdfText(values.description, geometry.box(columnRangeForRow(template.itemColumns.description, row)), pageHeight, {size:6.5, maxLines: Math.max(1, Math.floor(geometry.box(columnRangeForRow(template.itemColumns.description, row)).height / 8)), valign:'top'});
    content += pdfText(values.dueDate, geometry.box(columnRangeForRow(template.itemColumns.dueDate, row)), pageHeight, {size:6.5, align:'center', valign:'middle'});
    content += pdfText(values.unitPrice, geometry.box(columnRangeForRow(template.itemColumns.unitPrice, row)), pageHeight, {size:6.5, align:'right', valign:'middle'});
    content += pdfText(values.totalPrice, geometry.box(columnRangeForRow(template.itemColumns.totalPrice, row)), pageHeight, {size:6.5, align:'right', valign:'middle'});
  });
  content += pdfText(`Page ${input.pageIndex + 1} of ${input.pageCount}`, {x:650,y:584,width:106,height:14}, pageHeight, {size:8, align:'right'});
  content += pdfText(`Generated by MCC - ${template.sheetName} ${template.printArea}`, {x:36,y:584,width:360,height:14}, pageHeight, {size:6.5, color:'0.35 0.35 0.35'});
  return { width: pageWidth, height: pageHeight, content };
}

function buildRequisitionPdf(input: { vendor: string; requisitionNumber: string; requestedBy: string; createdAt: string; notes: string; requisitionType?: string; header?: Record<string, unknown>; items: RequisitionPdfItem[] }) {
  const header = isRecord(input.header) ? input.header : {};
  const field = (keys: string[], fallback = '') => textField(header, keys, fallback);
  const total = input.items.reduce((sum, item) => sum + (Number(item.unitCost ?? 0) || 0) * item.quantityRequested, 0);
  const type = normalizedRequisitionType(input.requisitionType || field(['requisitionType']), total);
  const template = templateForRequisitionType(type);
  const itemsPerPage = template.itemRows.end - template.itemRows.start + 1;
  const chunks: RequisitionPdfItem[][] = [];
  for (let index = 0; index < input.items.length; index += itemsPerPage) chunks.push(input.items.slice(index, index + itemsPerPage));
  const pages = chunks.map((pageItems, pageIndex) => buildRequisitionPage({...input, header, template, pageItems, pageIndex, pageCount: chunks.length, total}));
  return buildPdfDocument(pages);
}
function requisitionById(id: number) {
  return one<RequisitionRow>('SELECT * FROM inventory_requisitions WHERE deleted=0 AND id=?', [id]);
}
function validateQuantityRequested(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error('Qty requested must be a positive number.');
  return parsed;
}
function requisitionList(statusFilter = '') {
  const params: SqlParam[] = [];
  let where = 'deleted=0';
  const cleanStatus = statusFilter.trim();
  if (!cleanStatus) {
    where += " AND status IN ('Requested','Ordered')";
  } else if (cleanStatus.toLowerCase() !== 'all') {
    if (!requisitionStatuses.includes(cleanStatus as RequisitionStatus)) throw new Error('Unsupported requisition status filter.');
    where += ' AND status=?';
    params.push(cleanStatus);
  }
  return all<RequisitionRow>(`SELECT * FROM inventory_requisitions WHERE ${where} ORDER BY CASE status WHEN 'Requested' THEN 1 WHEN 'Ordered' THEN 2 WHEN 'Received' THEN 3 ELSE 4 END, requested_at DESC, id DESC`, params).map(publicRequisition);
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
function requirePermission(permission: string) { return (req: AuthRequest,res:Response,next:NextFunction) => { const role=req.user!.role; const userMgmt=role !== 'Maintenance Tech 1'; const ok = ['dashboard.view','inventory.view','settings.view'].includes(permission) || (permission==='inventory.write'&&canInventoryWrite(req.user!)) || (permission==='inventory.import'&&canInventoryImport(req.user!)) || (['users.view','users.create','users.edit','users.disable','users.delete','users.resetPassword'].includes(permission)&&userMgmt) || (permission==='audit.view'&&['Admin','Manager'].includes(role)); return ok ? next() : res.status(403).json({error:'Permission denied.'}); }; }

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
app.get('/api/settings/network-links', requireAuth, requirePermission('settings.view'), (_req,res)=>res.json({localPort:port,localhostUrl:`http://localhost:${port}`,detectedLanUrls:detectedLanUrls()}));
app.get('/api/requisitions/summary', requireAuth, (_req,res)=>res.json({ok:true,...requisitionSummary()}));
app.get('/api/requisitions', requireAuth, (req,res)=>{
  try {
    res.json({ok:true,requisitions:requisitionList(queryText(req.query.status)),summary:requisitionSummary()});
  } catch (error) {
    res.status(400).json({ok:false,error:safeErrorMessage(error)});
  }
});
app.get('/api/requisitions/:id', requireAuth, (req,res)=>{
  const requisition = requisitionById(Number(req.params.id));
  if (!requisition) return res.status(404).json({ok:false,error:'Requisition not found.'});
  res.json({ok:true,requisition:publicRequisition(requisition)});
});
app.post('/api/requisitions', requireAuth, requirePermission('inventory.write'), (req:AuthRequest,res)=>{
  const actor = req.user!;
  const operation = 'requisition create';
  try {
    const input = isRecord(req.body) ? req.body : {};
    const partId = Number(input.inventoryPartId ?? input.partId);
    if (!Number.isInteger(partId) || partId <= 0) throw new Error('Native inventory part not found.');
    const quantityRequested = validateQuantityRequested(input.quantityRequested ?? input.quantity);
    const allowDuplicate = input.allowDuplicate === true;
    const timestamp = now();
    let requisitionId = 0;
    db.exec('BEGIN IMMEDIATE');
    try {
      const part = one<NativePartRow>(`SELECT p.*, l.name AS location_name, v.name AS vendor_name
FROM inventory_parts p
LEFT JOIN inventory_locations l ON l.id=p.location_id AND l.deleted=0
LEFT JOIN inventory_vendors v ON v.id=p.vendor_id AND v.deleted=0
WHERE p.deleted=0 AND p.id=?`, [partId]);
      if (!part) throw new Error('Native inventory part not found.');
      if (activeRequisitionCountForPart(partId) > 0 && !allowDuplicate) throw new Error('Active requisition already exists for this part.');
      const requisitionNumber = requisitionNumberForTimestamp(timestamp);
      const result = run(`INSERT INTO inventory_requisitions (requisition_number,inventory_part_id,part_number,description,vendor_name,location_name,quantity_requested,status,requested_by_user_id,requested_by_name,requested_at,work_order_number,notes,created_at,updated_at,deleted) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`, [
        requisitionNumber,
        part.id,
        part.part_number,
        part.description,
        part.vendor_name ?? '',
        part.location_name ?? '',
        quantityRequested,
        'Requested',
        actor.id,
        actor.full_name,
        timestamp,
        textField(input, ['workOrderNumber','work_order_number','workOrder']),
        textField(input, ['notes','note']),
        timestamp,
        timestamp,
      ]);
      requisitionId = Number(result.lastInsertRowid);
      syncPartRequisitionFlag(partId,timestamp);
      inventoryAudit(req,'requisition create','requisition',requisitionId,{requisitionNumber,partId,partNumber:part.part_number,quantityRequested});
      audit(req,'requisition create','requisition',requisitionId,{requisitionNumber,partId,partNumber:part.part_number,quantityRequested});
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    res.status(201).json({ok:true,requisition:publicRequisition(requisitionById(requisitionId)!),summary:requisitionSummary()});
  } catch (error) {
    sendRequisitionError(req,res,operation,'',error);
  }
});

app.post('/api/requisitions/vendor-pdf', requireAuth, requirePermission('inventory.write'), (req:AuthRequest,res)=>{
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
        const result = run(`INSERT INTO inventory_requisitions (requisition_number,inventory_part_id,part_number,description,vendor_name,location_name,quantity_requested,status,requested_by_user_id,requested_by_name,requested_at,work_order_number,notes,created_at,updated_at,deleted) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`, [
          rawItems.length > 1 ? `${requisitionNumber}-${String(requisitionIds.length + 1).padStart(2,'0')}` : requisitionNumber,
          part.id, part.part_number, part.description, vendorName, part.location_name ?? '', quantityRequested, 'Requested', actor.id, actor.full_name, timestamp, '', notes, timestamp, timestamp,
        ]);
        requisitionIds.push(Number(result.lastInsertRowid));
        syncPartRequisitionFlag(partId,timestamp);
        pdfItems.push({partNumber:part.part_number,description:part.description,locationName:part.location_name ?? '',quantityRequested,unitCost:Number(rawItem.unitCost ?? part.unit_cost ?? 0) || null,supplierPartNumber:textField(rawItem, ['supplierPartNumber']) || (part.supplier_part_number ?? ''),dueDate:textField(rawItem, ['dueDate']),notes:textField(rawItem, ['notes','note'])});
      }
      inventoryAudit(req,'vendor requisition PDF create','requisition',requisitionNumber,{vendorName,itemCount:pdfItems.length,requisitionIds});
      audit(req,'vendor requisition PDF create','requisition',requisitionNumber,{vendorName,itemCount:pdfItems.length,requisitionIds});
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    const buffer = buildRequisitionPdf({vendor:vendorName,requisitionNumber,requestedBy:actor.full_name,createdAt:timestamp,notes,requisitionType,header,items:pdfItems});
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
      previousStatus = existing.status;
      if (nextStatus === 'Ordered') {
        run('UPDATE inventory_requisitions SET status=?, ordered_by_user_id=?, ordered_at=?, updated_at=? WHERE id=?', [nextStatus,actor.id,timestamp,timestamp,requisitionId]);
      } else if (nextStatus === 'Received') {
        run('UPDATE inventory_requisitions SET status=?, received_by_user_id=?, received_at=?, updated_at=? WHERE id=?', [nextStatus,actor.id,timestamp,timestamp,requisitionId]);
      } else {
        run('UPDATE inventory_requisitions SET status=?, canceled_by_user_id=?, canceled_at=?, cancel_reason=?, updated_at=? WHERE id=?', [nextStatus,actor.id,timestamp,cancelReason,timestamp,requisitionId]);
      }
      syncPartRequisitionFlag(existing.inventory_part_id,timestamp);
      inventoryAudit(req,'requisition status changed','requisition',requisitionId,{previousStatus,nextStatus});
      audit(req,'requisition status changed','requisition',requisitionId,{previousStatus,nextStatus});
      const specificAction = nextStatus === 'Ordered' ? 'requisition ordered' : nextStatus === 'Received' ? 'requisition received' : 'requisition canceled';
      inventoryAudit(req,specificAction,'requisition',requisitionId,{previousStatus,nextStatus});
      audit(req,specificAction,'requisition',requisitionId,{previousStatus,nextStatus});
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
      const quantityRequested = input.quantityRequested === undefined && input.quantity === undefined ? existing.quantity_requested : validateQuantityRequested(input.quantityRequested ?? input.quantity);
      const workOrderNumber = input.workOrderNumber === undefined && input.work_order_number === undefined ? existing.work_order_number : textField(input, ['workOrderNumber','work_order_number','workOrder']);
      const notes = input.notes === undefined ? existing.notes : textField(input, ['notes','note']);
      run('UPDATE inventory_requisitions SET quantity_requested=?, work_order_number=?, notes=?, updated_at=? WHERE id=?', [quantityRequested,workOrderNumber,notes,timestamp,requisitionId]);
      inventoryAudit(req,'requisition edit','requisition',requisitionId,{quantityRequested,workOrderNumber});
      audit(req,'requisition edit','requisition',requisitionId,{quantityRequested,workOrderNumber});
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
app.get('/api/inventory/native/summary', requireAuth, requirePermission('inventory.view'), (_req,res)=>res.json({ok:true,...nativeInventorySummary()}));
app.get('/api/inventory/native/parts', requireAuth, requirePermission('inventory.view'), (req,res)=>{
  const search = queryText(req.query.search ?? req.query.q);
  const requestedFilter = queryText(req.query.filter);
  const filter: NativePartFilter = ['low','requisition','hasLink','noLink'].includes(requestedFilter) ? requestedFilter as NativePartFilter : 'all';
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
      inventoryAudit(req,'native part create','part',partId,{partNumber:input.partNumber,locationAutoCreated:location.created,vendorAutoCreated:vendor.created});
      audit(req,'inventory native part create','inventory',partId,{partNumber:input.partNumber});
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
      const existing = one<{ id: number }>('SELECT id FROM inventory_parts WHERE deleted=0 AND id=?', [partId]);
      if (!existing) throw new Error('Native inventory part not found.');
      if (findDuplicateNativePart(input.partNumber,partId)) throw new Error('Part Number already exists in MCC native inventory.');
      const location = getOrCreateMccNativeLookup(req,'inventory_locations',input.location,timestamp);
      const vendor = getOrCreateMccNativeLookup(req,'inventory_vendors',input.vendor,timestamp);
      run(`UPDATE inventory_parts SET part_number=?, description=?, location_id=?, vendor_id=?, quantity=?, min_quantity=?, status=?, part_info_url=?, manufacturer_brand=?, unit_cost=?, supplier_part_number=?, source=?, updated_by_user_id=?, updated_at=? WHERE id=?`, [input.partNumber,input.description,location.id,vendor.id,input.quantity,input.minQuantity,input.status,input.partInfoUrl,input.manufacturerBrand,input.unitCost,input.supplierPartNumber,'mcc',actor.id,timestamp,partId]);
      inventoryAudit(req,'native part edit','part',partId,{partNumber:input.partNumber,locationAutoCreated:location.created,vendorAutoCreated:vendor.created});
      audit(req,'inventory native part edit','inventory',partId,{partNumber:input.partNumber});
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
});
