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
const uploadsDir = path.resolve(__dirname, '../../uploads');
const brandingUploadsDir = path.join(uploadsDir, 'branding');
const dbPath = path.join(dataDir, 'mcc.sqlite');
const isProd = process.env.NODE_ENV === 'production';
const sessionSecretConfigured = Boolean(process.env.SESSION_SECRET);
const smtpConfigured = Boolean(process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.SMTP_FROM);
const smtpPort = Number(process.env.SMTP_PORT ?? 587);
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(48).toString('hex');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(brandingUploadsDir, { recursive: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { files: 1, fileSize: 8 * 1024 * 1024 } });
const brandingLogoUpload = multer({ storage: multer.memoryStorage(), limits: { files: 1, fileSize: 1 * 1024 * 1024 } });
app.use(express.json({ limit: '50mb' }));
app.use('/uploads/branding', express.static(brandingUploadsDir, {
  fallthrough: false,
  setHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=3600');
  },
}));

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
CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_by_user_id INTEGER, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS inventory_vendors (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone_type TEXT NOT NULL DEFAULT '', phone_number TEXT NOT NULL DEFAULT '', phone_ext TEXT NOT NULL DEFAULT '', website_url TEXT NOT NULL DEFAULT '', address_line1 TEXT NOT NULL DEFAULT '', address_line2 TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '', state TEXT NOT NULL DEFAULT '', postal_code TEXT NOT NULL DEFAULT '', country TEXT NOT NULL DEFAULT 'USA', contact_name TEXT NOT NULL DEFAULT '', contact_title TEXT NOT NULL DEFAULT '', contact_phone_type TEXT NOT NULL DEFAULT '', contact_phone_number TEXT NOT NULL DEFAULT '', contact_phone_ext TEXT NOT NULL DEFAULT '', contact_email TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', is_active INTEGER NOT NULL DEFAULT 1, source TEXT NOT NULL DEFAULT 'mcc', imported_from_mit3_at TEXT, created_by_user_id INTEGER, updated_by_user_id INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, deleted_at TEXT, deleted_by_user_id INTEGER);
CREATE TABLE IF NOT EXISTS vendor_contacts (id INTEGER PRIMARY KEY AUTOINCREMENT, vendor_id INTEGER NOT NULL, contact_name TEXT NOT NULL, contact_title TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', phone_type TEXT NOT NULL DEFAULT '', phone_number TEXT NOT NULL DEFAULT '', phone_ext TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', is_primary INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by_user_id INTEGER, updated_by_user_id INTEGER, deleted_at TEXT, deleted_by_user_id INTEGER);
CREATE TABLE IF NOT EXISTS inventory_locations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'mcc', imported_from_mit3_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS inventory_parts (id INTEGER PRIMARY KEY AUTOINCREMENT, mit3_item_id TEXT, part_number TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', location_id INTEGER, vendor_id INTEGER, quantity REAL NOT NULL DEFAULT 0, min_quantity REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT '', requisition TEXT NOT NULL DEFAULT '', part_info_url TEXT NOT NULL DEFAULT '', manufacturer_brand TEXT NOT NULL DEFAULT '', unit_cost REAL NOT NULL DEFAULT 0, supplier_part_number TEXT NOT NULL DEFAULT '', lead_time TEXT NOT NULL DEFAULT '', important_note TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'mcc', imported_from_mit3_at TEXT, created_by_user_id INTEGER, updated_by_user_id INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, deleted_at TEXT, deleted_by_user_id INTEGER);
CREATE TABLE IF NOT EXISTS inventory_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_user_id INTEGER, action TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL, details_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS inventory_requisitions (id INTEGER PRIMARY KEY AUTOINCREMENT, requisition_number TEXT NOT NULL UNIQUE, inventory_part_id INTEGER NOT NULL, part_number TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', vendor_name TEXT NOT NULL DEFAULT '', location_name TEXT NOT NULL DEFAULT '', quantity_requested REAL NOT NULL DEFAULT 1, unit_cost REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'Requested', requested_by_user_id INTEGER, requested_by_name TEXT NOT NULL DEFAULT '', po_initiator TEXT NOT NULL DEFAULT '', requisitioned_by_name TEXT NOT NULL DEFAULT '', tax_exempt TEXT NOT NULL DEFAULT 'No', confirmed_with TEXT NOT NULL DEFAULT '', material_cert TEXT NOT NULL DEFAULT 'No', ship_via TEXT NOT NULL DEFAULT '', fob TEXT NOT NULL DEFAULT 'Destination', requested_at TEXT NOT NULL, ordered_by_user_id INTEGER, ordered_at TEXT, received_by_user_id INTEGER, received_at TEXT, canceled_by_user_id INTEGER, canceled_at TEXT, cancel_reason TEXT NOT NULL DEFAULT '', work_order_number TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, deleted_at TEXT, deleted_by_user_id INTEGER);
CREATE TABLE IF NOT EXISTS inventory_requisition_lines (id INTEGER PRIMARY KEY AUTOINCREMENT, requisition_id INTEGER NOT NULL, inventory_part_id INTEGER NOT NULL, part_number TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', vendor_name TEXT NOT NULL DEFAULT '', location_name TEXT NOT NULL DEFAULT '', quantity_requested REAL NOT NULL DEFAULT 1, unit_cost REAL NOT NULL DEFAULT 0, unit_of_measure TEXT NOT NULL DEFAULT 'EA', item_number TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, deleted_at TEXT, deleted_by_user_id INTEGER);
CREATE TABLE IF NOT EXISTS requisition_staging_items (id INTEGER PRIMARY KEY AUTOINCREMENT, inventory_part_id INTEGER, part_number TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', vendor_name TEXT NOT NULL DEFAULT '', supplier_part_number TEXT NOT NULL DEFAULT '', quantity_requested REAL NOT NULL, unit_cost REAL NOT NULL DEFAULT 0, location_name TEXT NOT NULL DEFAULT '', asset_machine TEXT NOT NULL DEFAULT '', work_order_number TEXT NOT NULL DEFAULT '', priority TEXT NOT NULL DEFAULT 'Normal', notes TEXT NOT NULL DEFAULT '', requested_by TEXT NOT NULL DEFAULT '', date_added TEXT NOT NULL, needed_by_date TEXT, status TEXT NOT NULL DEFAULT 'Need to Order', created_requisition_id INTEGER, created_requisition_number TEXT NOT NULL DEFAULT '', created_by_user_id INTEGER, updated_by_user_id INTEGER, removed_by_user_id INTEGER, removed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS machine_assets (id INTEGER PRIMARY KEY AUTOINCREMENT, asset_number TEXT NOT NULL UNIQUE COLLATE NOCASE, asset_name TEXT NOT NULL DEFAULT '', brand TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', serial_number TEXT NOT NULL DEFAULT '', machine_year TEXT NOT NULL DEFAULT '', machine_type TEXT NOT NULL DEFAULT 'Injection Molding Machine', power_type TEXT NOT NULL DEFAULT '', shot_size_oz REAL NOT NULL DEFAULT 0, tonnage REAL NOT NULL DEFAULT 0, barrel_diameter TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '', department TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active', voltage_value TEXT NOT NULL DEFAULT '', voltage_type TEXT NOT NULL DEFAULT '', full_load_amp TEXT NOT NULL DEFAULT '', machine_length TEXT NOT NULL DEFAULT '', machine_width TEXT NOT NULL DEFAULT '', machine_height TEXT NOT NULL DEFAULT '', full_die_height_length TEXT NOT NULL DEFAULT '', screw_type TEXT NOT NULL DEFAULT '', screw_tip_type TEXT NOT NULL DEFAULT '', screw_tip_installed_date TEXT NOT NULL DEFAULT '', screw_installed_date TEXT NOT NULL DEFAULT '', barrel_installed_date TEXT NOT NULL DEFAULT '', barrel_end_cap_installed_date TEXT NOT NULL DEFAULT '', barrel_length TEXT NOT NULL DEFAULT '', screw_length TEXT NOT NULL DEFAULT '', screw_rebuild_repaired INTEGER NOT NULL DEFAULT 0, barrel_rebuild_repaired INTEGER NOT NULL DEFAULT 0, screw_condition_status TEXT NOT NULL DEFAULT 'new', barrel_condition_status TEXT NOT NULL DEFAULT 'new', notes TEXT NOT NULL DEFAULT '', critical_notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by_user_id INTEGER, updated_by_user_id INTEGER, deleted INTEGER NOT NULL DEFAULT 0, deleted_at TEXT, deleted_by_user_id INTEGER);
CREATE TABLE IF NOT EXISTS machine_brand_settings (id INTEGER PRIMARY KEY AUTOINCREMENT, brand_name TEXT NOT NULL UNIQUE COLLATE NOCASE, color_hex TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by_user_id INTEGER);
CREATE TABLE IF NOT EXISTS history_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, section TEXT NOT NULL, action TEXT NOT NULL, entity_type TEXT, entity_id TEXT, entity_label TEXT, work_order_number TEXT, part_number TEXT, requisition_number TEXT, asset_id TEXT, machine_name TEXT, equipment_name TEXT, location_name TEXT, vendor_name TEXT, old_value_json TEXT, new_value_json TEXT, quantity_before REAL, quantity_after REAL, quantity_delta REAL, reason_note TEXT, user_id INTEGER, user_name TEXT, user_email TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_inventory_parts_mit3_item_id ON inventory_parts (mit3_item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_parts_part_number ON inventory_parts (part_number COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_inventory_parts_deleted ON inventory_parts (deleted);
CREATE INDEX IF NOT EXISTS idx_inventory_vendors_name ON inventory_vendors (name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_vendor_contacts_vendor ON vendor_contacts (vendor_id,deleted,is_primary);
CREATE INDEX IF NOT EXISTS idx_inventory_locations_name ON inventory_locations (name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_inventory_requisitions_number ON inventory_requisitions (requisition_number COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_inventory_requisitions_part ON inventory_requisitions (inventory_part_id,status,deleted);
CREATE INDEX IF NOT EXISTS idx_inventory_requisitions_status ON inventory_requisitions (status,deleted);
CREATE INDEX IF NOT EXISTS idx_inventory_requisition_lines_req ON inventory_requisition_lines (requisition_id,deleted);
CREATE INDEX IF NOT EXISTS idx_inventory_requisition_lines_part ON inventory_requisition_lines (inventory_part_id,deleted);
CREATE INDEX IF NOT EXISTS idx_requisition_staging_status ON requisition_staging_items (status,updated_at);
CREATE INDEX IF NOT EXISTS idx_requisition_staging_part ON requisition_staging_items (inventory_part_id,status);
CREATE INDEX IF NOT EXISTS idx_requisition_staging_requisition ON requisition_staging_items (created_requisition_id);
CREATE INDEX IF NOT EXISTS idx_machine_assets_asset_number ON machine_assets (asset_number COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_machine_assets_brand ON machine_assets (brand COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_machine_assets_status ON machine_assets (status,deleted);
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
  if (!inventoryPartColumns.has('lead_time')) run("ALTER TABLE inventory_parts ADD COLUMN lead_time TEXT NOT NULL DEFAULT ''");
  if (!inventoryPartColumns.has('important_note')) run("ALTER TABLE inventory_parts ADD COLUMN important_note TEXT NOT NULL DEFAULT ''");
  run('UPDATE inventory_parts SET unit_cost=0 WHERE unit_cost IS NULL');

  const inventoryVendorColumns = new Set(all<{ name: string }>('PRAGMA table_info(inventory_vendors)').map(column => column.name));
  const vendorTextColumns = [
    'phone_type',
    'phone_number',
    'phone_ext',
    'website_url',
    'address_line1',
    'address_line2',
    'city',
    'state',
    'postal_code',
    'contact_name',
    'contact_title',
    'contact_phone_type',
    'contact_phone_number',
    'contact_phone_ext',
    'contact_email',
    'notes',
  ];
  for (const column of vendorTextColumns) {
    if (!inventoryVendorColumns.has(column)) run(`ALTER TABLE inventory_vendors ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`);
  }
  if (!inventoryVendorColumns.has('country')) run("ALTER TABLE inventory_vendors ADD COLUMN country TEXT NOT NULL DEFAULT 'USA'");
  if (!inventoryVendorColumns.has('created_by_user_id')) run('ALTER TABLE inventory_vendors ADD COLUMN created_by_user_id INTEGER');
  if (!inventoryVendorColumns.has('updated_by_user_id')) run('ALTER TABLE inventory_vendors ADD COLUMN updated_by_user_id INTEGER');
  if (!inventoryVendorColumns.has('is_active')) run('ALTER TABLE inventory_vendors ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1');
  if (!inventoryVendorColumns.has('deleted_at')) run('ALTER TABLE inventory_vendors ADD COLUMN deleted_at TEXT');
  if (!inventoryVendorColumns.has('deleted_by_user_id')) run('ALTER TABLE inventory_vendors ADD COLUMN deleted_by_user_id INTEGER');
  run("UPDATE inventory_vendors SET country='USA' WHERE country IS NULL OR country=''");
  run('UPDATE inventory_vendors SET is_active=1 WHERE is_active IS NULL');
  db.exec(`CREATE TABLE IF NOT EXISTS vendor_contacts (id INTEGER PRIMARY KEY AUTOINCREMENT, vendor_id INTEGER NOT NULL, contact_name TEXT NOT NULL, contact_title TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', phone_type TEXT NOT NULL DEFAULT '', phone_number TEXT NOT NULL DEFAULT '', phone_ext TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', is_primary INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by_user_id INTEGER, updated_by_user_id INTEGER, deleted_at TEXT, deleted_by_user_id INTEGER);
CREATE INDEX IF NOT EXISTS idx_vendor_contacts_vendor ON vendor_contacts (vendor_id,deleted,is_primary);`);
  const vendorContactColumns = new Set(all<{ name: string }>('PRAGMA table_info(vendor_contacts)').map(column => column.name));
  const vendorContactTextColumns = ['contact_title','email','phone_type','phone_number','phone_ext','notes'];
  for (const column of vendorContactTextColumns) {
    if (!vendorContactColumns.has(column)) run(`ALTER TABLE vendor_contacts ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`);
  }
  if (!vendorContactColumns.has('is_primary')) run('ALTER TABLE vendor_contacts ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0');
  if (!vendorContactColumns.has('deleted')) run('ALTER TABLE vendor_contacts ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0');
  if (!vendorContactColumns.has('created_at')) run("ALTER TABLE vendor_contacts ADD COLUMN created_at TEXT NOT NULL DEFAULT ''");
  if (!vendorContactColumns.has('updated_at')) run("ALTER TABLE vendor_contacts ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''");
  if (!vendorContactColumns.has('created_by_user_id')) run('ALTER TABLE vendor_contacts ADD COLUMN created_by_user_id INTEGER');
  if (!vendorContactColumns.has('updated_by_user_id')) run('ALTER TABLE vendor_contacts ADD COLUMN updated_by_user_id INTEGER');
  if (!vendorContactColumns.has('deleted_at')) run('ALTER TABLE vendor_contacts ADD COLUMN deleted_at TEXT');
  if (!vendorContactColumns.has('deleted_by_user_id')) run('ALTER TABLE vendor_contacts ADD COLUMN deleted_by_user_id INTEGER');
  const vendorContactMigrationTime = now();
  run(`INSERT INTO vendor_contacts (vendor_id,contact_name,contact_title,email,phone_type,phone_number,phone_ext,notes,is_primary,deleted,created_at,updated_at,created_by_user_id,updated_by_user_id)
SELECT v.id,v.contact_name,v.contact_title,v.contact_email,CASE WHEN v.contact_phone_type='Main' THEN 'Office' ELSE v.contact_phone_type END,v.contact_phone_number,v.contact_phone_ext,'',1,0,COALESCE(NULLIF(v.created_at,''),?),COALESCE(NULLIF(v.updated_at,''),?),v.created_by_user_id,v.updated_by_user_id
FROM inventory_vendors v
WHERE (trim(COALESCE(v.contact_name,''))<>'' OR trim(COALESCE(v.contact_email,''))<>'' OR trim(COALESCE(v.contact_phone_number,''))<>'')
AND NOT EXISTS (SELECT 1 FROM vendor_contacts c WHERE c.vendor_id=v.id)`, [vendorContactMigrationTime,vendorContactMigrationTime]);

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
  db.exec(`CREATE TABLE IF NOT EXISTS requisition_staging_items (id INTEGER PRIMARY KEY AUTOINCREMENT, inventory_part_id INTEGER, part_number TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', vendor_name TEXT NOT NULL DEFAULT '', supplier_part_number TEXT NOT NULL DEFAULT '', quantity_requested REAL NOT NULL, unit_cost REAL NOT NULL DEFAULT 0, location_name TEXT NOT NULL DEFAULT '', asset_machine TEXT NOT NULL DEFAULT '', work_order_number TEXT NOT NULL DEFAULT '', priority TEXT NOT NULL DEFAULT 'Normal', notes TEXT NOT NULL DEFAULT '', requested_by TEXT NOT NULL DEFAULT '', date_added TEXT NOT NULL, needed_by_date TEXT, status TEXT NOT NULL DEFAULT 'Need to Order', created_requisition_id INTEGER, created_requisition_number TEXT NOT NULL DEFAULT '', created_by_user_id INTEGER, updated_by_user_id INTEGER, removed_by_user_id INTEGER, removed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_requisition_staging_status ON requisition_staging_items (status,updated_at);
CREATE INDEX IF NOT EXISTS idx_requisition_staging_part ON requisition_staging_items (inventory_part_id,status);
CREATE INDEX IF NOT EXISTS idx_requisition_staging_requisition ON requisition_staging_items (created_requisition_id);`);

  db.exec(`CREATE TABLE IF NOT EXISTS machine_assets (id INTEGER PRIMARY KEY AUTOINCREMENT, asset_number TEXT NOT NULL UNIQUE COLLATE NOCASE, asset_name TEXT NOT NULL DEFAULT '', brand TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', serial_number TEXT NOT NULL DEFAULT '', machine_year TEXT NOT NULL DEFAULT '', machine_type TEXT NOT NULL DEFAULT 'Injection Molding Machine', power_type TEXT NOT NULL DEFAULT '', shot_size_oz REAL NOT NULL DEFAULT 0, tonnage REAL NOT NULL DEFAULT 0, barrel_diameter TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '', department TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active', voltage_value TEXT NOT NULL DEFAULT '', voltage_type TEXT NOT NULL DEFAULT '', full_load_amp TEXT NOT NULL DEFAULT '', machine_length TEXT NOT NULL DEFAULT '', machine_width TEXT NOT NULL DEFAULT '', machine_height TEXT NOT NULL DEFAULT '', full_die_height_length TEXT NOT NULL DEFAULT '', screw_type TEXT NOT NULL DEFAULT '', screw_tip_type TEXT NOT NULL DEFAULT '', screw_tip_installed_date TEXT NOT NULL DEFAULT '', screw_installed_date TEXT NOT NULL DEFAULT '', barrel_installed_date TEXT NOT NULL DEFAULT '', barrel_end_cap_installed_date TEXT NOT NULL DEFAULT '', barrel_length TEXT NOT NULL DEFAULT '', screw_length TEXT NOT NULL DEFAULT '', screw_rebuild_repaired INTEGER NOT NULL DEFAULT 0, barrel_rebuild_repaired INTEGER NOT NULL DEFAULT 0, screw_condition_status TEXT NOT NULL DEFAULT 'new', barrel_condition_status TEXT NOT NULL DEFAULT 'new', notes TEXT NOT NULL DEFAULT '', critical_notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by_user_id INTEGER, updated_by_user_id INTEGER, deleted INTEGER NOT NULL DEFAULT 0, deleted_at TEXT, deleted_by_user_id INTEGER);
CREATE TABLE IF NOT EXISTS machine_brand_settings (id INTEGER PRIMARY KEY AUTOINCREMENT, brand_name TEXT NOT NULL UNIQUE COLLATE NOCASE, color_hex TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by_user_id INTEGER);
CREATE INDEX IF NOT EXISTS idx_machine_assets_asset_number ON machine_assets (asset_number COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_machine_assets_brand ON machine_assets (brand COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_machine_assets_status ON machine_assets (status,deleted);`);

  const machineAssetColumns = new Set(all<{ name: string }>('PRAGMA table_info(machine_assets)').map(column => column.name));
  if (!machineAssetColumns.has('screw_rebuild_repaired')) run('ALTER TABLE machine_assets ADD COLUMN screw_rebuild_repaired INTEGER NOT NULL DEFAULT 0');
  if (!machineAssetColumns.has('barrel_rebuild_repaired')) run('ALTER TABLE machine_assets ADD COLUMN barrel_rebuild_repaired INTEGER NOT NULL DEFAULT 0');
  if (!machineAssetColumns.has('screw_condition_status')) run("ALTER TABLE machine_assets ADD COLUMN screw_condition_status TEXT NOT NULL DEFAULT 'new'");
  if (!machineAssetColumns.has('barrel_condition_status')) run("ALTER TABLE machine_assets ADD COLUMN barrel_condition_status TEXT NOT NULL DEFAULT 'new'");
  const machineInjectionColumns: Array<{ name: string; definition: string }> = [
    { name: 'has_double_shot_injection', definition: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'has_plunger_injection', definition: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'screw2_type', definition: "TEXT NOT NULL DEFAULT ''" },
    { name: 'screw2_tip_type', definition: "TEXT NOT NULL DEFAULT ''" },
    { name: 'screw2_rebuild_repaired', definition: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'screw2_condition_status', definition: "TEXT NOT NULL DEFAULT 'new'" },
    { name: 'screw2_installed_date', definition: "TEXT NOT NULL DEFAULT ''" },
    { name: 'screw2_tip_installed_date', definition: "TEXT NOT NULL DEFAULT ''" },
    { name: 'screw2_length', definition: "TEXT NOT NULL DEFAULT ''" },
    { name: 'barrel2_diameter', definition: "TEXT NOT NULL DEFAULT ''" },
    { name: 'barrel2_rebuild_repaired', definition: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'barrel2_condition_status', definition: "TEXT NOT NULL DEFAULT 'new'" },
    { name: 'barrel2_installed_date', definition: "TEXT NOT NULL DEFAULT ''" },
    { name: 'barrel2_end_cap_installed_date', definition: "TEXT NOT NULL DEFAULT ''" },
    { name: 'barrel2_length', definition: "TEXT NOT NULL DEFAULT ''" },
    { name: 'plunger_type', definition: "TEXT NOT NULL DEFAULT ''" },
    { name: 'plunger_rebuild_repaired', definition: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'plunger_condition_status', definition: "TEXT NOT NULL DEFAULT 'new'" },
    { name: 'plunger_installed_date', definition: "TEXT NOT NULL DEFAULT ''" },
    { name: 'plunger_length', definition: "TEXT NOT NULL DEFAULT ''" },
    { name: 'plunger_diameter', definition: "TEXT NOT NULL DEFAULT ''" },
    { name: 'plunger_barrel_type', definition: "TEXT NOT NULL DEFAULT ''" },
    { name: 'plunger_barrel_rebuild_repaired', definition: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'plunger_barrel_condition_status', definition: "TEXT NOT NULL DEFAULT 'new'" },
    { name: 'plunger_barrel_installed_date', definition: "TEXT NOT NULL DEFAULT ''" },
    { name: 'plunger_barrel_end_cap_installed_date', definition: "TEXT NOT NULL DEFAULT ''" },
    { name: 'plunger_barrel_length', definition: "TEXT NOT NULL DEFAULT ''" },
    { name: 'plunger_barrel_diameter', definition: "TEXT NOT NULL DEFAULT ''" },
  ];
  for (const column of machineInjectionColumns) {
    if (!machineAssetColumns.has(column.name)) run(`ALTER TABLE machine_assets ADD COLUMN ${column.name} ${column.definition}`);
  }
  run("UPDATE machine_assets SET screw_rebuild_repaired=0 WHERE screw_rebuild_repaired IS NULL");
  run("UPDATE machine_assets SET barrel_rebuild_repaired=0 WHERE barrel_rebuild_repaired IS NULL");
  run("UPDATE machine_assets SET screw_condition_status='new' WHERE screw_condition_status IS NULL OR screw_condition_status='' OR screw_condition_status NOT IN ('new','used','worn','rebuilt_repaired')");
  run("UPDATE machine_assets SET barrel_condition_status='new' WHERE barrel_condition_status IS NULL OR barrel_condition_status='' OR barrel_condition_status NOT IN ('new','used','worn','rebuilt_repaired')");
  for (const column of ['has_double_shot_injection','has_plunger_injection','screw2_rebuild_repaired','barrel2_rebuild_repaired','plunger_rebuild_repaired','plunger_barrel_rebuild_repaired']) {
    run(`UPDATE machine_assets SET ${column}=0 WHERE ${column} IS NULL`);
  }
  for (const column of ['screw2_condition_status','barrel2_condition_status','plunger_condition_status','plunger_barrel_condition_status']) {
    run(`UPDATE machine_assets SET ${column}='new' WHERE ${column} IS NULL OR ${column}='' OR ${column} NOT IN ('new','used','worn','rebuilt_repaired')`);
  }

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
function shouldScheduleDailyBackupFromAudit(action: string) {
  const value = action.toLowerCase();
  if (value.startsWith('failed ') || value.includes(' login') || value === 'login' || value === 'logout') return false;
  if (value.includes('export') || value.includes('pdf') || value.includes('backup') || value.includes('restore')) return false;
  return value.startsWith('user ')
    || value.startsWith('password change')
    || value.startsWith('password reset')
    || value.startsWith('vendor ')
    || value.startsWith('branding ')
    || value.startsWith('reset ')
    || value.includes('inventory native')
    || value.includes('inventory import')
    || value.includes('import from mit3')
    || (value.includes('requisition') && !value.includes('previewed'));
}
function auditWriteBackup(req: Request, action: string) {
  if (shouldScheduleDailyBackupFromAudit(action)) scheduleAutoBackup(`audit:${action}`, (req as AuthRequest).user ?? null);
}
type HistorySection = 'inventory' | 'vendors' | 'requisitions' | 'machine_library' | 'equipment_library' | 'facility_info' | 'preventive_maintenance' | 'settings';
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
const historySections: HistorySection[] = ['inventory','vendors','requisitions','machine_library','equipment_library','facility_info','preventive_maintenance','settings'];
const historySectionLabels: Record<HistorySection, string> = {
  inventory: 'Inventory',
  vendors: 'Vendors',
  requisitions: 'Requisitions',
  machine_library: 'Machine Library',
  equipment_library: 'Equipment Library',
  facility_info: 'Facility Info',
  preventive_maintenance: 'Preventive Maintenance',
  settings: 'Settings / System',
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
type LogoMode = 'text' | 'image';
type IconAnimation = 'none' | 'glow' | 'rotate' | 'pulse';
type BrandingSettings = {
  companyName: string;
  companySubtitle: string;
  companyAccentText: string;
  logoMode: LogoMode;
  logoUrl: string;
  logoFileName: string;
  iconAnimation: IconAnimation;
};
const defaultBrandingSettings: BrandingSettings = {
  companyName: 'MCC',
  companySubtitle: 'Maintenance Command Center',
  companyAccentText: '',
  logoMode: 'text',
  logoUrl: '',
  logoFileName: '',
  iconAnimation: 'none',
};
const allowedIconAnimations: IconAnimation[] = ['none','glow','rotate','pulse'];
const allowedLogoMimeTypes: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};
function appSettingJson<T>(key: string): Partial<T> {
  const row = one<{ value_json: string }>('SELECT value_json FROM app_settings WHERE key=?', [key]);
  if (!row) return {};
  try {
    const parsed = JSON.parse(row.value_json);
    return isRecord(parsed) ? parsed as Partial<T> : {};
  } catch {
    return {};
  }
}
function setAppSettingJson(key: string, value: Record<string, unknown>, actor?: User | null) {
  run('INSERT INTO app_settings (key,value_json,updated_by_user_id,updated_at) VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_by_user_id=excluded.updated_by_user_id, updated_at=excluded.updated_at', [
    key,
    JSON.stringify(value),
    actor?.id ?? null,
    now(),
  ]);
}
function normalizeBrandingSettings(value: Partial<BrandingSettings>): BrandingSettings {
  const companyName = String(value.companyName ?? defaultBrandingSettings.companyName).trim().slice(0, 20) || defaultBrandingSettings.companyName;
  const companySubtitle = String(value.companySubtitle ?? defaultBrandingSettings.companySubtitle).trim().slice(0, 40);
  const companyAccentText = String(value.companyAccentText ?? defaultBrandingSettings.companyAccentText).trim().slice(0, 8);
  const logoMode = value.logoMode === 'image' ? 'image' : 'text';
  const logoUrl = String(value.logoUrl ?? '').trim();
  const logoFileName = String(value.logoFileName ?? '').trim();
  const iconAnimation = allowedIconAnimations.includes(value.iconAnimation as IconAnimation) ? value.iconAnimation as IconAnimation : 'none';
  return {
    companyName,
    companySubtitle,
    companyAccentText,
    logoMode: logoMode === 'image' && logoUrl ? 'image' : 'text',
    logoUrl: logoUrl.startsWith('/uploads/branding/') ? logoUrl : '',
    logoFileName: logoFileName.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 120),
    iconAnimation,
  };
}
function currentBrandingSettings() {
  return normalizeBrandingSettings(appSettingJson<BrandingSettings>('branding'));
}
function validateBrandingInput(body: unknown, previous: BrandingSettings): BrandingSettings {
  const input = isRecord(body) ? body : {};
  const companyName = String(input.companyName ?? previous.companyName).trim();
  const companySubtitle = String(input.companySubtitle ?? previous.companySubtitle).trim();
  const companyAccentText = String(input.companyAccentText ?? previous.companyAccentText).trim();
  const logoMode = String(input.logoMode ?? previous.logoMode).trim();
  const iconAnimation = String(input.iconAnimation ?? previous.iconAnimation).trim();
  if (!companyName) throw new Error('Company Name is required.');
  if (companyName.length > 20) throw new Error('Company Name must be 20 characters or fewer.');
  if (companySubtitle.length > 40) throw new Error('Subtitle must be 40 characters or fewer.');
  if (companyAccentText.length > 8) throw new Error('Accent Text must be 8 characters or fewer.');
  if (!['text','image'].includes(logoMode)) throw new Error('Logo Mode is invalid.');
  if (!allowedIconAnimations.includes(iconAnimation as IconAnimation)) throw new Error('Icon Animation is invalid.');
  const next = normalizeBrandingSettings({
    ...previous,
    companyName,
    companySubtitle,
    companyAccentText,
    logoMode: logoMode as LogoMode,
    iconAnimation: iconAnimation as IconAnimation,
  });
  if (next.logoMode === 'image' && !next.logoUrl) return { ...next, logoMode: 'text' };
  return next;
}
function publicBrandingSettings(value = currentBrandingSettings()) {
  return {
    companyName: value.companyName,
    companySubtitle: value.companySubtitle,
    companyAccentText: value.companyAccentText,
    logoMode: value.logoMode,
    logoUrl: value.logoUrl,
    logoFileName: value.logoFileName,
    iconAnimation: value.iconAnimation,
  };
}
function safeBrandingFileName(originalName: string, extension: string) {
  const base = path.basename(originalName, path.extname(originalName)).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || 'company-logo';
  return `${base}-${crypto.randomBytes(8).toString('hex')}${extension}`;
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
      message: response.ok ? 'Retired inventory bridge reachable' : 'Retired inventory bridge unavailable',
    };
  } catch {
    return {
      ok: false,
      mit3Url,
      healthUrl: mit3HealthUrl,
      message: 'Retired inventory bridge unavailable',
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
    if (!response.ok) throw new Error(`Retired inventory import source returned HTTP ${response.status}`);
    const payload = await response.json();
    const root = isRecord(payload) ? payload : {};
    const data = isRecord(root.data) ? root.data : root;
    if (!isRecord(data) || data.app !== 'maintenance-inventory-tracker') throw new Error('Retired inventory import data shape is not supported.');
    return data;
  } catch {
    throw new Error('Retired inventory import source is unavailable. Use MCC Inventory import tools instead.');
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
  lead_time: string;
  important_note: string;
  notes: string;
  source: string;
  imported_from_mit3_at: string | null;
  created_at: string;
  updated_at: string;
  location_name: string | null;
  vendor_name: string | null;
  vendor_deleted: number | null;
  vendor_is_active: number | null;
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
  const existing = one<{ id: number; deleted?: number }>(`SELECT id, deleted FROM ${table} WHERE lower(name)=lower(?) ORDER BY deleted ASC, id LIMIT 1`, [cleanName]);
  if (existing) {
    if (Number(existing.deleted ?? 0) === 0) run(`UPDATE ${table} SET source=?, imported_from_mit3_at=?, updated_at=? WHERE id=?`, ['Retired inventory import',timestamp,timestamp,existing.id]);
    return { id: existing.id, created: false };
  }
  const result = run(`INSERT INTO ${table} (name,source,imported_from_mit3_at,created_at,updated_at,deleted) VALUES (?,?,?,?,?,0)`, [cleanName,'Retired inventory import',timestamp,timestamp,timestamp]);
  return { id: Number(result.lastInsertRowid), created: true };
}
function getOrCreateMccNativeLookup(req: Request, table: NativeLookupTable, name: string, timestamp: string, vendorHistoryAction = 'vendor_created_from_inventory') {
  const cleanName = name.trim();
  if (!cleanName) return { id: null as number | null, created: false };
  const existing = one<{ id: number }>(`SELECT id FROM ${table} WHERE lower(name)=lower(?) ORDER BY deleted ASC, id LIMIT 1`, [cleanName]);
  if (existing) return { id: existing.id, created: false };
  const result = run(`INSERT INTO ${table} (name,source,imported_from_mit3_at,created_at,updated_at,deleted) VALUES (?,?,?,?,?,0)`, [cleanName,'mcc',null,timestamp,timestamp]);
  const id = Number(result.lastInsertRowid);
  const isVendor = table === 'inventory_vendors';
  inventoryAudit(req,isVendor ? 'vendor auto-create' : 'location auto-create',isVendor ? 'vendor' : 'location',id,{name:cleanName});
  audit(req,isVendor ? 'inventory vendor auto-create' : 'inventory location auto-create',isVendor ? 'inventory_vendor' : 'inventory_location',id,{name:cleanName});
  if (isVendor && (req as AuthRequest).user) {
    recordVendorHistory({
      action: vendorHistoryAction,
      actor: (req as AuthRequest).user!,
      vendorId: id,
      companyName: cleanName,
      newValue: { companyName: cleanName, source: 'mcc' },
    });
  }
  return { id, created: true };
}
interface VendorRow {
  id: number;
  name: string;
  phone_type: string;
  phone_number: string;
  phone_ext: string;
  website_url: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  contact_name: string;
  contact_title: string;
  contact_phone_type: string;
  contact_phone_number: string;
  contact_phone_ext: string;
  contact_email: string;
  notes: string;
  is_active: number;
  source: string;
  imported_from_mit3_at: string | null;
  created_by_user_id: number | null;
  updated_by_user_id: number | null;
  created_at: string;
  updated_at: string;
  deleted: number;
  deleted_at: string | null;
  deleted_by_user_id: number | null;
}
interface VendorContactRow {
  id: number;
  vendor_id: number;
  contact_name: string;
  contact_title: string;
  email: string;
  phone_type: string;
  phone_number: string;
  phone_ext: string;
  notes: string;
  is_primary: number;
  deleted: number;
  created_at: string;
  updated_at: string;
  created_by_user_id: number | null;
  updated_by_user_id: number | null;
  deleted_at: string | null;
  deleted_by_user_id: number | null;
}
const vendorPhoneTypes = new Set(['Mobile','Work','Cell','Office','Main','Other','']);
const vendorContactPhoneTypes = new Set(['Cell','Mobile','Work','Office','Other','']);
function normalizePhoneType(value: string) {
  const clean = value.trim();
  if (!clean) return '';
  const match = [...vendorPhoneTypes].find(option=>option.toLowerCase() === clean.toLowerCase());
  if (!match) throw new Error('Phone type must be Mobile, Work, Cell, Office, Main, or Other.');
  return match;
}
function normalizeVendorContactPhoneType(value: string) {
  const clean = value.trim();
  if (!clean) return '';
  if (clean.toLowerCase() === 'main') return 'Office';
  const match = [...vendorContactPhoneTypes].find(option=>option.toLowerCase() === clean.toLowerCase());
  if (!match) throw new Error('Contact Phone Type must be Cell, Mobile, Work, Office, or Other.');
  return match;
}
function cleanVendorCompanyName(input: Record<string, unknown>) {
  const companyName = textField(input, ['companyName','company_name','name']).replace(/\s+/g, ' ').trim();
  if (!companyName) throw new Error('Company Name is required.');
  if (companyName.length > 120) throw new Error('Company Name must be 120 characters or less.');
  return companyName;
}
function normalizedVendorName(value: string) {
  return value.trim().toLowerCase().replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').replace(/[\s-]+/g, '');
}
function cleanVendorWebsiteUrl(input: Record<string, unknown>) {
  const websiteUrl = textField(input, ['websiteUrl','website_url','website','url']).trim();
  if (!websiteUrl) return '';
  if (websiteUrl.length > 260) throw new Error('Website URL must be 260 characters or less.');
  try {
    const parsed = new URL(websiteUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('unsupported protocol');
    return parsed.toString();
  } catch {
    throw new Error('Website URL must start with http:// or https://.');
  }
}
function validateVendorContactInput(body: unknown, requireName = true) {
  const input = isRecord(body) ? body : {};
  const contactName = textField(input, ['contactName','contact_name','name']).replace(/\s+/g, ' ').trim();
  const contactTitle = textField(input, ['contactTitle','contact_title','title']).slice(0, 160);
  const email = textField(input, ['email','contactEmail','contact_email']).slice(0, 180);
  const phoneType = normalizeVendorContactPhoneType(textField(input, ['phoneType','phone_type','contactPhoneType','contact_phone_type']));
  const phoneNumber = textField(input, ['phoneNumber','phone_number','phone','contactPhoneNumber','contact_phone_number']).slice(0, 80);
  const phoneExt = textField(input, ['phoneExt','phone_ext','ext','contactPhoneExt','contact_phone_ext']).slice(0, 20);
  const notes = textField(input, ['notes','contactNotes','contact_notes']).slice(0, 1200);
  const hasAnyValue = Boolean(contactName || contactTitle || email || phoneType || phoneNumber || phoneExt || notes);
  if (!hasAnyValue && !requireName) return null;
  if (!contactName) throw new Error('Contact Name is required.');
  if (contactName.length > 160) throw new Error('Contact Name must be 160 characters or less.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Contact Email must be a valid email address.');
  return {
    id: Number.isInteger(Number(input.id)) && Number(input.id) > 0 ? Number(input.id) : undefined,
    contactName,
    contactTitle,
    email,
    phoneType,
    phoneNumber,
    phoneExt,
    notes,
    isPrimary: input.isPrimary === true || input.is_primary === 1 || String(input.isPrimary ?? input.is_primary).toLowerCase() === 'true' || String(input.isPrimary ?? input.is_primary).toLowerCase() === 'yes',
    deleted: input.deleted === true || input.deleted === 1 || String(input.deleted ?? '').toLowerCase() === 'true',
  };
}
type VendorContactInput = NonNullable<ReturnType<typeof validateVendorContactInput>>;
function validateVendorContactInputs(body: unknown) {
  if (!isRecord(body) || !Array.isArray(body.contacts)) return [];
  return body.contacts.map(contact => validateVendorContactInput(contact, false)).filter(Boolean) as VendorContactInput[];
}
function validateVendorInput(body: unknown) {
  const input = isRecord(body) ? body : {};
  const companyName = cleanVendorCompanyName(input);
  const contactEmail = textField(input, ['contactEmail','contact_email']).slice(0, 180);
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) throw new Error('Contact Email must be a valid email address.');
  const phoneExt = textField(input, ['phoneExt','phone_ext','ext']).slice(0, 20);
  const contactPhoneExt = textField(input, ['contactPhoneExt','contact_phone_ext','contactExt']).slice(0, 20);
  return {
    companyName,
    phoneType: normalizePhoneType(textField(input, ['phoneType','phone_type'])),
    phoneNumber: textField(input, ['phoneNumber','phone_number','phone']).slice(0, 80),
    phoneExt,
    websiteUrl: cleanVendorWebsiteUrl(input),
    addressLine1: textField(input, ['addressLine1','address_line1','address']).slice(0, 180),
    addressLine2: textField(input, ['addressLine2','address_line2']).slice(0, 180),
    city: textField(input, ['city']).slice(0, 120),
    state: textField(input, ['state']).slice(0, 80),
    postalCode: textField(input, ['postalCode','postal_code','zip']).slice(0, 40),
    country: textField(input, ['country'], 'USA').slice(0, 80) || 'USA',
    contactName: textField(input, ['contactName','contact_name']).slice(0, 160),
    contactTitle: textField(input, ['contactTitle','contact_title']).slice(0, 160),
    contactPhoneType: normalizePhoneType(textField(input, ['contactPhoneType','contact_phone_type'])),
    contactPhoneNumber: textField(input, ['contactPhoneNumber','contact_phone_number','contactPhone']).slice(0, 80),
    contactPhoneExt,
    contactEmail,
    notes: textField(input, ['notes']).slice(0, 2000),
    isActive: input.isActive === undefined && input.is_active === undefined ? true : !(input.isActive === false || input.isActive === 0 || String(input.isActive ?? input.is_active).toLowerCase() === 'false' || String(input.isActive ?? input.is_active).toLowerCase() === 'disabled'),
    reasonNote: textField(input, ['reasonNote','reason']).slice(0, 1200),
    contacts: validateVendorContactInputs(input),
  };
}
type VendorInput = ReturnType<typeof validateVendorInput>;
function vendorById(id: number) {
  return one<VendorRow>('SELECT * FROM inventory_vendors WHERE id=?', [id]);
}
function vendorByName(companyName: string, excludeId?: number) {
  const normalized = normalizedVendorName(companyName);
  if (!normalized) return undefined;
  return all<VendorRow>('SELECT * FROM inventory_vendors ORDER BY deleted ASC, id').find(row => row.id !== excludeId && normalizedVendorName(row.name) === normalized);
}
function vendorContactById(vendorId: number, contactId: number, includeDeleted = false) {
  return one<VendorContactRow>(`SELECT * FROM vendor_contacts WHERE vendor_id=? AND id=?${includeDeleted ? '' : ' AND deleted=0'}`, [vendorId,contactId]);
}
function vendorContacts(vendorId: number, includeDeleted = false) {
  return all<VendorContactRow>(`SELECT * FROM vendor_contacts WHERE vendor_id=?${includeDeleted ? '' : ' AND deleted=0'} ORDER BY is_primary DESC, contact_name COLLATE NOCASE, id`, [vendorId]);
}
function publicVendorContact(row: VendorContactRow) {
  return {
    id: row.id,
    vendorId: row.vendor_id,
    contactName: row.contact_name ?? '',
    contactTitle: row.contact_title ?? '',
    email: row.email ?? '',
    phoneType: row.phone_type ?? '',
    phoneNumber: row.phone_number ?? '',
    phoneExt: row.phone_ext ?? '',
    notes: row.notes ?? '',
    isPrimary: Boolean(row.is_primary),
    deleted: Boolean(row.deleted),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function vendorContactHistoryValue(row: VendorContactRow | VendorContactInput) {
  return 'contact_name' in row ? publicVendorContact(row) : {
    id: row.id,
    contactName: row.contactName,
    contactTitle: row.contactTitle,
    email: row.email,
    phoneType: row.phoneType,
    phoneNumber: row.phoneNumber,
    phoneExt: row.phoneExt,
    notes: row.notes,
    isPrimary: row.isPrimary,
    deleted: row.deleted,
  };
}
function vendorContactSummary(vendorId: number) {
  const contacts = vendorContacts(vendorId);
  const primary = contacts.find(contact => contact.is_primary) ?? contacts[0];
  return {
    contactCount: contacts.length,
    primaryContactName: primary?.contact_name ?? '',
    primaryContactEmail: primary?.email ?? '',
  };
}
function publicVendor(row: VendorRow) {
  const summary = vendorContactSummary(row.id);
  return {
    id: row.id,
    companyName: row.name,
    phoneType: row.phone_type ?? '',
    phoneNumber: row.phone_number ?? '',
    phoneExt: row.phone_ext ?? '',
    websiteUrl: row.website_url ?? '',
    addressLine1: row.address_line1 ?? '',
    addressLine2: row.address_line2 ?? '',
    city: row.city ?? '',
    state: row.state ?? '',
    postalCode: row.postal_code ?? '',
    country: row.country ?? 'USA',
    contactName: row.contact_name ?? '',
    contactTitle: row.contact_title ?? '',
    contactPhoneType: row.contact_phone_type ?? '',
    contactPhoneNumber: row.contact_phone_number ?? '',
    contactPhoneExt: row.contact_phone_ext ?? '',
    contactEmail: row.contact_email ?? '',
    notes: row.notes ?? '',
    isActive: Boolean(row.is_active),
    deleted: Boolean(row.deleted),
    status: row.deleted ? 'Deleted' : row.is_active ? 'Enabled' : 'Disabled',
    source: row.source,
    importedFromMit3At: row.imported_from_mit3_at ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...summary,
    contacts: vendorContacts(row.id).map(publicVendorContact),
  };
}
function vendorHistoryValue(row: VendorRow | VendorInput) {
  return 'name' in row ? publicVendor(row) : {
    companyName: row.companyName,
    phoneType: row.phoneType,
    phoneNumber: row.phoneNumber,
    phoneExt: row.phoneExt,
    websiteUrl: row.websiteUrl,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    city: row.city,
    state: row.state,
    postalCode: row.postalCode,
    country: row.country,
    contactName: row.contactName,
    contactTitle: row.contactTitle,
    contactPhoneType: row.contactPhoneType,
    contactPhoneNumber: row.contactPhoneNumber,
    contactPhoneExt: row.contactPhoneExt,
    contactEmail: row.contactEmail,
    notes: row.notes,
    isActive: row.isActive,
  };
}
function recordVendorHistory(input: { action: string; actor: User; vendorId: number; companyName: string; oldValue?: Record<string, unknown> | null; newValue?: Record<string, unknown> | null; reasonNote?: string }) {
  recordHistoryLog({
    section: 'vendors',
    action: input.action,
    entityType: 'vendor',
    entityId: String(input.vendorId),
    entityLabel: input.companyName,
    vendorName: input.companyName,
    oldValue: input.oldValue,
    newValue: input.newValue,
    reasonNote: input.reasonNote,
    actor: input.actor,
  });
}
function recordVendorContactHistory(input: { action: string; actor: User; vendor: VendorRow; contactId: number; contactName: string; oldValue?: Record<string, unknown> | null; newValue?: Record<string, unknown> | null; reasonNote?: string }) {
  recordHistoryLog({
    section: 'vendors',
    action: input.action,
    entityType: 'vendor_contact',
    entityId: String(input.contactId),
    entityLabel: input.contactName,
    vendorName: input.vendor.name,
    oldValue: input.oldValue,
    newValue: { vendorId: input.vendor.id, vendorCompanyName: input.vendor.name, contactId: input.contactId, contactName: input.contactName, ...(input.newValue ?? {}) },
    reasonNote: input.reasonNote,
    actor: input.actor,
  });
}
function updateVendorRow(id: number, input: VendorInput, actor: User, timestamp: string) {
  run(`UPDATE inventory_vendors SET name=?, phone_type=?, phone_number=?, phone_ext=?, website_url=?, address_line1=?, address_line2=?, city=?, state=?, postal_code=?, country=?, contact_name=?, contact_title=?, contact_phone_type=?, contact_phone_number=?, contact_phone_ext=?, contact_email=?, notes=?, is_active=?, deleted=CASE WHEN ?=1 THEN 0 ELSE deleted END, deleted_at=CASE WHEN ?=1 THEN NULL ELSE deleted_at END, deleted_by_user_id=CASE WHEN ?=1 THEN NULL ELSE deleted_by_user_id END, source='mcc', updated_by_user_id=?, updated_at=? WHERE id=?`, [
    input.companyName,input.phoneType,input.phoneNumber,input.phoneExt,input.websiteUrl,input.addressLine1,input.addressLine2,input.city,input.state,input.postalCode,input.country,input.contactName,input.contactTitle,input.contactPhoneType,input.contactPhoneNumber,input.contactPhoneExt,input.contactEmail,input.notes,input.isActive ? 1 : 0,input.isActive ? 1 : 0,input.isActive ? 1 : 0,input.isActive ? 1 : 0,actor.id,timestamp,id,
  ]);
}
function insertVendorRow(input: VendorInput, actor: User, timestamp: string) {
  const result = run(`INSERT INTO inventory_vendors (name,phone_type,phone_number,phone_ext,website_url,address_line1,address_line2,city,state,postal_code,country,contact_name,contact_title,contact_phone_type,contact_phone_number,contact_phone_ext,contact_email,notes,is_active,source,imported_from_mit3_at,created_by_user_id,updated_by_user_id,created_at,updated_at,deleted) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'mcc',?,?,?,?,?,0)`, [
    input.companyName,input.phoneType,input.phoneNumber,input.phoneExt,input.websiteUrl,input.addressLine1,input.addressLine2,input.city,input.state,input.postalCode,input.country,input.contactName,input.contactTitle,input.contactPhoneType,input.contactPhoneNumber,input.contactPhoneExt,input.contactEmail,input.notes,input.isActive ? 1 : 0,null,actor.id,actor.id,timestamp,timestamp,
  ]);
  return Number(result.lastInsertRowid);
}
function normalizeContactName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}
function normalizeContactPhone(value: string) {
  return value.replace(/\D+/g, '');
}
function vendorContactDuplicateKey(input: Pick<VendorContactInput, 'contactName' | 'email' | 'phoneNumber'>) {
  const name = normalizeContactName(input.contactName);
  const email = input.email.trim().toLowerCase();
  const phone = normalizeContactPhone(input.phoneNumber);
  return email ? `${name}|email:${email}` : `${name}|phone:${phone}`;
}
function matchingVendorContact(vendorId: number, input: VendorContactInput, excludeId?: number) {
  const key = vendorContactDuplicateKey(input);
  return vendorContacts(vendorId, true).find(contact => contact.id !== excludeId && vendorContactDuplicateKey({
    contactName: contact.contact_name,
    email: contact.email,
    phoneNumber: contact.phone_number,
  }) === key);
}
function ensureSinglePrimaryContact(vendorId: number, primaryContactId: number) {
  run('UPDATE vendor_contacts SET is_primary=0 WHERE vendor_id=? AND id<>?', [vendorId,primaryContactId]);
}
function insertVendorContact(vendorId: number, input: VendorContactInput, actor: User, timestamp: string) {
  const result = run(`INSERT INTO vendor_contacts (vendor_id,contact_name,contact_title,email,phone_type,phone_number,phone_ext,notes,is_primary,deleted,created_at,updated_at,created_by_user_id,updated_by_user_id) VALUES (?,?,?,?,?,?,?,?,?,0,?,?,?,?)`, [
    vendorId,input.contactName,input.contactTitle,input.email,input.phoneType,input.phoneNumber,input.phoneExt,input.notes,input.isPrimary ? 1 : 0,timestamp,timestamp,actor.id,actor.id,
  ]);
  const contactId = Number(result.lastInsertRowid);
  if (input.isPrimary) ensureSinglePrimaryContact(vendorId, contactId);
  return contactId;
}
function updateVendorContact(vendorId: number, contactId: number, input: VendorContactInput, actor: User, timestamp: string) {
  run(`UPDATE vendor_contacts SET contact_name=?, contact_title=?, email=?, phone_type=?, phone_number=?, phone_ext=?, notes=?, is_primary=?, deleted=CASE WHEN ?=1 THEN 0 ELSE deleted END, deleted_at=CASE WHEN ?=1 THEN NULL ELSE deleted_at END, deleted_by_user_id=CASE WHEN ?=1 THEN NULL ELSE deleted_by_user_id END, updated_by_user_id=?, updated_at=? WHERE vendor_id=? AND id=?`, [
    input.contactName,input.contactTitle,input.email,input.phoneType,input.phoneNumber,input.phoneExt,input.notes,input.isPrimary ? 1 : 0,input.deleted ? 0 : 1,input.deleted ? 0 : 1,input.deleted ? 0 : 1,actor.id,timestamp,vendorId,contactId,
  ]);
  if (input.isPrimary) ensureSinglePrimaryContact(vendorId, contactId);
}
function syncVendorContacts(vendor: VendorRow, contacts: VendorContactInput[], actor: User, timestamp: string, reasonNote = 'Saved with vendor record.') {
  if (!contacts.length) return;
  const keptIds = new Set<number>();
  let primaryAssigned = false;
  for (const contact of contacts) {
    const input = { ...contact, isPrimary: contact.isPrimary && !primaryAssigned };
    if (input.isPrimary) primaryAssigned = true;
    const existingById = input.id ? vendorContactById(vendor.id, input.id, true) : undefined;
    const existing = existingById ?? matchingVendorContact(vendor.id, input);
    if (existing) {
      const oldValue = vendorContactHistoryValue(existing);
      updateVendorContact(vendor.id, existing.id, input, actor, timestamp);
      keptIds.add(existing.id);
      const updated = vendorContactById(vendor.id, existing.id, true)!;
      recordVendorContactHistory({ action: 'vendor_contact_updated', actor, vendor, contactId: existing.id, contactName: input.contactName, oldValue, newValue: vendorContactHistoryValue(updated), reasonNote });
    } else {
      const contactId = insertVendorContact(vendor.id, input, actor, timestamp);
      keptIds.add(contactId);
      const created = vendorContactById(vendor.id, contactId)!;
      recordVendorContactHistory({ action: 'vendor_contact_created', actor, vendor, contactId, contactName: input.contactName, newValue: vendorContactHistoryValue(created), reasonNote });
    }
  }
  for (const existing of vendorContacts(vendor.id)) {
    if (keptIds.has(existing.id)) continue;
    run('UPDATE vendor_contacts SET deleted=1, deleted_at=?, deleted_by_user_id=?, updated_by_user_id=?, updated_at=? WHERE id=?', [timestamp,actor.id,actor.id,timestamp,existing.id]);
    recordVendorContactHistory({ action: 'vendor_contact_deleted', actor, vendor, contactId: existing.id, contactName: existing.contact_name, oldValue: vendorContactHistoryValue(existing), newValue: { ...vendorContactHistoryValue(existing), deleted: true }, reasonNote });
  }
}
const vendorExportHeaders = ['Company Name','Website URL','General Email','Phone Type','Phone Number','EXT #','Address Line 1','Address Line 2','City','State','Postal Code','Country','Status','Notes','Contact Name','Contact Title','Contact Email','Contact Phone Type','Contact Phone Number','Contact EXT #','Contact Notes','Primary Contact'] as const;
function vendorExportRecord(row: VendorRow, contact?: VendorContactRow) {
  return {
    'Company Name': row.name ?? '',
    'Website URL': row.website_url ?? '',
    'General Email': row.contact_email ?? '',
    'Phone Type': row.phone_type ?? '',
    'Phone Number': row.phone_number ?? '',
    'EXT #': row.phone_ext ?? '',
    'Address Line 1': row.address_line1 ?? '',
    'Address Line 2': row.address_line2 ?? '',
    City: row.city ?? '',
    State: row.state ?? '',
    'Postal Code': row.postal_code ?? '',
    Country: row.country ?? 'USA',
    Status: row.deleted ? 'Deleted' : row.is_active ? 'Enabled' : 'Disabled',
    Notes: row.notes ?? '',
    'Contact Name': contact?.contact_name ?? '',
    'Contact Title': contact?.contact_title ?? '',
    'Contact Email': contact?.email ?? '',
    'Contact Phone Type': contact?.phone_type ?? '',
    'Contact Phone Number': contact?.phone_number ?? '',
    'Contact EXT #': contact?.phone_ext ?? '',
    'Contact Notes': contact?.notes ?? '',
    'Primary Contact': contact?.is_primary ? 'Yes' : '',
  };
}
function vendorCsvFromRows(rows: Record<string, string>[]) {
  const lines = [vendorExportHeaders.map(csvCell).join(',')];
  for (const row of rows) lines.push(vendorExportHeaders.map(header => csvCell(row[header] ?? '')).join(','));
  return `${lines.join('\n')}\n`;
}
function vendorImportRecordsFromCsv(buffer: Buffer) {
  const rows = parseCsvRows(buffer.toString('utf8')).filter(row => row.some(cell => cell.trim()));
  if (!rows.length) throw new Error('Vendor import file is empty.');
  const headers = rows[0].map(header => header.trim());
  const normalizedHeaders = headers.map(normalizeImportHeader);
  if (!normalizedHeaders.includes(normalizeImportHeader('Company Name'))) throw new Error('Vendor import must include Company Name.');
  return rows.slice(1).map((row,rowIndex) => {
    const value = (...names: string[]) => {
      for (const name of names) {
        const index = normalizedHeaders.indexOf(normalizeImportHeader(name));
        if (index >= 0) return row[index]?.trim() ?? '';
      }
      return '';
    };
    const status = value('Status','Vendor Status','Active').toLowerCase();
    const contact = validateVendorContactInput({
      contactName: value('Contact Name'),
      contactTitle: value('Contact Title'),
      email: value('Contact Email','Email'),
      phoneType: value('Contact Phone Type'),
      phoneNumber: value('Contact Phone Number','Contact Phone #','Contact Phone'),
      phoneExt: value('Contact EXT #','Contact Ext'),
      notes: value('Contact Notes','Contact Note'),
      isPrimary: value('Primary Contact','Primary').toLowerCase() === 'yes' || value('Primary Contact','Primary').toLowerCase() === 'true' || value('Primary Contact','Primary') === '1',
    }, false);
    return {
      rowNumber: rowIndex + 2,
      input: validateVendorInput({
        companyName: value('Company Name','Vendor Name','Vendor','Name'),
        websiteUrl: value('Website URL','Website','URL'),
        phoneType: value('Phone Type','Company Phone Type'),
        phoneNumber: value('Phone Number','Company Phone #','Company Phone','Phone'),
        phoneExt: value('EXT #','Company EXT #','Company Ext','Ext'),
        addressLine1: value('Address Line 1','Address 1','Address'),
        addressLine2: value('Address Line 2','Address 2'),
        city: value('City'),
        state: value('State'),
        postalCode: value('Postal Code','Zip'),
        country: value('Country') || 'USA',
        contactName: value('Contact Name'),
        contactTitle: value('Contact Title'),
        contactPhoneType: value('Contact Phone Type'),
        contactPhoneNumber: value('Contact Phone Number','Contact Phone #','Contact Phone'),
        contactPhoneExt: value('Contact EXT #','Contact Ext'),
        contactEmail: value('General Email','Sales Email','Service Email'),
        notes: value('Notes'),
        isActive: status ? !(status === 'disabled' || status === 'inactive' || status === 'deleted' || status === 'false' || status === 'no') : true,
      }),
      contact,
    };
  });
}
function importVendorRows(req: AuthRequest, rows: { rowNumber: number; input: VendorInput; contact: VendorContactInput | null }[]) {
  const actor = req.user!;
  const timestamp = now();
  const seenContacts = new Map<string, number>();
  const importedVendors = new Set<string>();
  const summary = { vendorsAdded: 0, vendorsUpdated: 0, contactsAdded: 0, contactsUpdated: 0, duplicateContactsSkipped: 0, skippedCount: 0, errorCount: 0, errors: [] as string[] };
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const row of rows) {
      const vendorKey = normalizedVendorName(row.input.companyName);
      let vendor = vendorByName(row.input.companyName);
      if (!vendor) {
        const vendorId = insertVendorRow(row.input,actor,timestamp);
        vendor = vendorById(vendorId);
        if (!vendor) throw new Error('Vendor import failed.');
        recordVendorHistory({ action: row.input.isActive ? 'vendor_created' : 'vendor_disabled', actor, vendorId, companyName: row.input.companyName, newValue: vendorHistoryValue(row.input), reasonNote: 'Imported from CSV.' });
        summary.vendorsAdded++;
      } else if (!importedVendors.has(vendorKey)) {
        updateVendorRow(vendor.id,row.input,actor,timestamp);
        recordVendorHistory({ action: 'vendor_updated', actor, vendorId: vendor.id, companyName: row.input.companyName, oldValue: vendorHistoryValue(vendor), newValue: vendorHistoryValue(row.input), reasonNote: 'Imported from CSV.' });
        vendor = vendorById(vendor.id);
        if (!vendor) throw new Error('Vendor import failed.');
        summary.vendorsUpdated++;
      }
      importedVendors.add(vendorKey);
      if (!row.contact) continue;
      const contactKey = `${vendor.id}|${vendorContactDuplicateKey(row.contact)}`;
      const duplicateRow = seenContacts.get(contactKey);
      if (duplicateRow) {
        summary.duplicateContactsSkipped++;
        summary.skippedCount++;
        summary.errors.push(`Rows ${duplicateRow} and ${row.rowNumber}: duplicate contact skipped for ${vendor.name}.`);
        continue;
      }
      seenContacts.set(contactKey, row.rowNumber);
      const existingContact = matchingVendorContact(vendor.id, row.contact);
      if (existingContact) {
        const oldValue = vendorContactHistoryValue(existingContact);
        updateVendorContact(vendor.id, existingContact.id, row.contact, actor, timestamp);
        const updated = vendorContactById(vendor.id, existingContact.id, true)!;
        recordVendorContactHistory({ action: 'vendor_import_contact_updated', actor, vendor, contactId: existingContact.id, contactName: row.contact.contactName, oldValue, newValue: vendorContactHistoryValue(updated), reasonNote: 'Imported from CSV.' });
        summary.contactsUpdated++;
      } else {
        const contactId = insertVendorContact(vendor.id, row.contact, actor, timestamp);
        const created = vendorContactById(vendor.id, contactId)!;
        recordVendorContactHistory({ action: 'vendor_import_contact_created', actor, vendor, contactId, contactName: row.contact.contactName, newValue: vendorContactHistoryValue(created), reasonNote: 'Imported from CSV.' });
        summary.contactsAdded++;
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  audit(req,'vendor import','vendor','bulk',summary);
  return summary;
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
  const activeStaging = activeStagingForPart(row.id);
  return {
    id: String(row.id),
    itemId: row.mit3_item_id || String(row.id),
    partNumber: row.part_number,
    description: row.description,
    location: row.location_name ?? '',
    vendor: row.vendor_name ?? '',
    vendorId: row.vendor_id ? String(row.vendor_id) : '',
    vendorDeleted: Boolean(row.vendor_deleted ?? 0),
    vendorIsActive: row.vendor_id ? Boolean(row.vendor_is_active ?? 0) : true,
    quantity: Number(row.quantity ?? 0),
    minQuantity: Number(row.min_quantity ?? 0),
    status: row.status,
    requisition: activeRequisition?.status ?? row.requisition,
    orderPlaced: Boolean(activeRequisition || row.requisition),
    hasActiveRequisitionRecord: Boolean(activeRequisition),
    activeRequisitionNumber: activeRequisition?.requisition_number ?? '',
    isInRequisitionStaging: Boolean(activeStaging),
    requisitionStagingItemId: activeStaging?.id ?? null,
    requisitionStagingStatus: activeStaging?.status ?? '',
    partInfoUrl: validWebUrl(row.part_info_url),
    manufacturerBrand: row.manufacturer_brand ?? '',
    unitCost: Number(row.unit_cost ?? 0),
    supplierPartNumber: row.supplier_part_number ?? '',
    leadTime: row.lead_time ?? '',
    importantNote: row.important_note ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    source: row.source,
    importedFromMit3At: row.imported_from_mit3_at ?? '',
  };
}
function nativePartRowById(id: number) {
  return one<NativePartRow>(`SELECT p.*, l.name AS location_name, v.name AS vendor_name, v.deleted AS vendor_deleted, v.is_active AS vendor_is_active
FROM inventory_parts p
LEFT JOIN inventory_locations l ON l.id=p.location_id AND l.deleted=0
LEFT JOIN inventory_vendors v ON v.id=p.vendor_id
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
    leadTime: 'lead_time' in row ? row.lead_time ?? '' : row.leadTime,
    importantNote: 'important_note' in row ? row.important_note ?? '' : row.importantNote,
    partInfoUrl: 'part_info_url' in row ? row.part_info_url ?? '' : row.partInfoUrl,
    notes: 'notes' in row ? row.notes ?? '' : '',
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
    where.push('(p.part_number LIKE ? ESCAPE \'\\\' COLLATE NOCASE OR p.description LIKE ? ESCAPE \'\\\' COLLATE NOCASE OR p.important_note LIKE ? ESCAPE \'\\\' COLLATE NOCASE OR p.lead_time LIKE ? ESCAPE \'\\\' COLLATE NOCASE OR l.name LIKE ? ESCAPE \'\\\' COLLATE NOCASE OR v.name LIKE ? ESCAPE \'\\\' COLLATE NOCASE)');
    params.push(like,like,like,like,like,like);
  }
  if (filter === 'low') where.push("(p.status IN ('Low Stock','Out of Stock') OR (p.min_quantity > 0 AND p.quantity <= p.min_quantity))");
  if (filter === 'requisition') where.push("p.requisition<>''");
  return all<NativePartRow>(`SELECT p.*, l.name AS location_name, v.name AS vendor_name, v.deleted AS vendor_deleted, v.is_active AS vendor_is_active
FROM inventory_parts p
LEFT JOIN inventory_locations l ON l.id=p.location_id AND l.deleted=0
LEFT JOIN inventory_vendors v ON v.id=p.vendor_id
WHERE ${where.join(' AND ')}
ORDER BY p.part_number COLLATE NOCASE, p.description COLLATE NOCASE, p.id`, params).map(normalizeNativePart);
}
const nativeExportHeaders = ['MCC Item ID','Part Number','Description','Location','Vendor','Quantity','Minimum Quantity','Requisition','Part Info URL','Manufacturer/Brand','Unit Cost','Supplier Part Number','Lead Time','Important Note','Notes'] as const;
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
  leadTime: string;
  importantNote: string;
  notes: string;
};
type NativeImportSummary = {
  addedCount: number;
  updatedCount: number;
  skippedCount: number;
  duplicateMergedCount: number;
  duplicatesRemovedCount: number;
  vendorCreatedCount: number;
  locationCreatedCount: number;
  invalidUrlCount: number;
  errorCount: number;
  errors: string[];
};
type PreparedNativeImportRow = {
  rowNumber: number;
  mccItemId: string;
  partNumber: string;
  description: string;
  location: string;
  vendor: string;
  quantity: number;
  minQuantity: number;
  requisition: string;
  partInfoUrl: string;
  manufacturerBrand: string;
  unitCost: number;
  supplierPartNumber: string;
  leadTime: string;
  importantNote: string;
  notes: string;
  status: string;
};
function nativeInventoryRows() {
  return all<NativePartRow>(`SELECT p.*, l.name AS location_name, v.name AS vendor_name, v.deleted AS vendor_deleted, v.is_active AS vendor_is_active
FROM inventory_parts p
LEFT JOIN inventory_locations l ON l.id=p.location_id AND l.deleted=0
LEFT JOIN inventory_vendors v ON v.id=p.vendor_id
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
    'Lead Time': row.lead_time ?? '',
    'Important Note': row.important_note ?? '',
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
type BackupCategory = 'daily' | 'weekly' | 'master' | 'legacy';
type CreatableBackupCategory = Exclude<BackupCategory, 'legacy'>;
type LegacyMasterBackupType = 'startup' | 'scheduled' | 'auto' | 'manual' | 'pre_restore';
type BackupType =
  | 'daily_auto'
  | 'daily_manual'
  | 'weekly_scheduled'
  | 'weekly_manual'
  | 'master_scheduled'
  | 'master_manual'
  | 'pre_restore'
  | 'startup'
  | 'scheduled'
  | 'auto'
  | 'manual'
  | 'legacy';
type BackupHealth = {
  ok: boolean;
  label: 'Healthy' | 'Needs Attention' | 'Hidden';
  message: string;
};
type BackupManifest = {
  appName: string;
  backupCategory?: BackupCategory;
  backupType: BackupType;
  createdAt: string;
  createdBy: { id: number; fullName: string; email: string; role: Role } | null;
  appVersion: string;
  databaseFile: 'mcc.sqlite';
  databaseSizeBytes: number;
  includedPaths: string[];
  includedFolders: string[];
  recordCounts: Record<string, number>;
  checksumSha256: string;
  notes: string;
};
type BackupSummary = {
  id: string;
  name: string;
  category: BackupCategory;
  categoryLabel: string;
  type: BackupType;
  typeLabel: string;
  createdAt: string;
  sizeBytes: number;
  databaseSizeBytes: number;
  includedPaths: string[];
  includedFolders: string[];
  recordCounts: Record<string, number>;
  checksumSha256: string;
  notes: string;
  restorable: boolean;
  folderLabel: string;
};
type ProtectedAreaStatus = 'protected' | 'ready' | 'pending';
type ProtectedBackupArea = {
  key: string;
  label: string;
  status: ProtectedAreaStatus;
  detail: string;
};
type BackupOperationResult = {
  ok: boolean;
  category?: BackupCategory;
  type?: BackupType;
  backupId?: string;
  createdAt?: string;
  message: string;
};
const dailyBackupDir = path.join(backupsDir, 'daily');
const weeklyBackupDir = path.join(backupsDir, 'MCC Full Back up _ Weekly');
const masterFullBackupDir = path.join(backupsDir, 'MCC Master back up');
const legacyMasterBackupDir = path.join(backupsDir, 'master');
const corruptBackupDir = path.join(backupsDir, 'corrupt');
const backupCategoryDetails: Record<CreatableBackupCategory, { label: string; folderLabel: string; dir: string; prefix: string }> = {
  daily: { label: 'Daily / Auto Change Backup', folderLabel: 'backend/backups/daily', dir: dailyBackupDir, prefix: 'MCC_Daily_Backup_' },
  weekly: { label: 'Weekly Full Backup', folderLabel: 'backend/backups/MCC Full Back up _ Weekly', dir: weeklyBackupDir, prefix: 'MCC_Weekly_Full_Backup_' },
  master: { label: 'MCC Master Full Backup', folderLabel: 'backend/backups/MCC Master back up', dir: masterFullBackupDir, prefix: 'MCC_Master_Backup_' },
};
const legacyBackupDetail = { label: 'Legacy Master Backup', folderLabel: 'backend/backups/master', dir: legacyMasterBackupDir, prefix: 'MCC_Master_Backup_' };
const backupCategories: BackupCategory[] = ['daily','weekly','master','legacy'];
const creatableBackupCategories: CreatableBackupCategory[] = ['daily','weekly','master'];
const knownBackupTypes: BackupType[] = [
  'weekly_scheduled',
  'master_scheduled',
  'weekly_manual',
  'master_manual',
  'daily_manual',
  'daily_auto',
  'pre_restore',
  'scheduled',
  'startup',
  'manual',
  'auto',
  'legacy',
];
const backupTypeLabels: Record<BackupType, string> = {
  daily_auto: 'Daily / Auto Change',
  daily_manual: 'Daily Manual',
  weekly_scheduled: 'Weekly Scheduled',
  weekly_manual: 'Weekly Manual',
  master_scheduled: 'Monthly Master',
  master_manual: 'Master Manual',
  pre_restore: 'Pre-Restore Safety',
  startup: 'Legacy Startup',
  scheduled: 'Legacy Hourly',
  auto: 'Legacy Auto',
  manual: 'Legacy Manual',
  legacy: 'Legacy',
};
const autoBackupDelayMs = 45 * 1000;
const weeklyBackupHour = 13;
const masterBackupHour = 13;
const maxBackupScheduleDelayMs = 24 * 60 * 60 * 1000;
const backupRetention: Record<CreatableBackupCategory, Partial<Record<BackupType, number>>> = {
  daily: { daily_auto: 60, daily_manual: 30 },
  weekly: { weekly_scheduled: 26, weekly_manual: 12 },
  master: { master_scheduled: 24, master_manual: 30, pre_restore: 20, startup: 10 },
};
const masterBackupFolderCandidates = ['uploads','documents','files'];
const backupDataAreaDefinitions = [
  { key: 'inventoryParts', label: 'Inventory', tables: ['inventory_parts'] },
  { key: 'vendors', label: 'Vendors', tables: ['inventory_vendors'] },
  { key: 'requisitions', label: 'Requisitions', tables: ['inventory_requisitions','inventory_requisition_lines','requisition_staging_items'] },
  { key: 'historyLogs', label: 'History', tables: ['history_logs'] },
  { key: 'preventiveMaintenanceRecords', label: 'PM', tables: ['pm_tasks','pm_history','preventive_maintenance'] },
  { key: 'machineRecords', label: 'Machines', tables: ['machine_assets','machines','machine_library','machine_pms'] },
  { key: 'equipmentRecords', label: 'Equipment', tables: ['equipment_assets','equipment','equipment_library','equipment_pms'] },
  { key: 'facilityRecords', label: 'Facility', tables: ['facility_documents','facility_info','building_prints','facility_pms'] },
  { key: 'users', label: 'Users/Roles', tables: ['users'] },
  { key: 'settingsBranding', label: 'Settings/Branding', tables: ['app_settings'] },
] as const;
let autoBackupTimer: NodeJS.Timeout | undefined;
let autoBackupReason = '';
let autoBackupActor: User | null = null;
let weeklyBackupTimer: NodeJS.Timeout | undefined;
let masterBackupTimer: NodeJS.Timeout | undefined;
let nextWeeklyBackupAt: string | null = null;
let nextMasterBackupAt: string | null = null;
let lastBackupResult: BackupOperationResult = { ok: true, message: 'No tiered backup has run yet.' };
let backupInProgress = false;

function backupCategoryLabel(category: BackupCategory) {
  return category === 'legacy' ? legacyBackupDetail.label : backupCategoryDetails[category].label;
}
function backupFolderLabel(category: BackupCategory) {
  return category === 'legacy' ? legacyBackupDetail.folderLabel : backupCategoryDetails[category].folderLabel;
}
function backupTypeLabel(type: BackupType) {
  return backupTypeLabels[type] ?? type.split('_').map(value=>value.charAt(0).toUpperCase() + value.slice(1)).join(' ');
}
function backupDirectory(category: BackupCategory) {
  return category === 'legacy' ? legacyBackupDetail.dir : backupCategoryDetails[category].dir;
}
function backupPrefix(category: BackupCategory) {
  return category === 'legacy' ? legacyBackupDetail.prefix : backupCategoryDetails[category].prefix;
}
function ensureBackupDirs() {
  fs.mkdirSync(backupsDir, { recursive: true });
  for (const category of creatableBackupCategories) fs.mkdirSync(backupDirectory(category), { recursive: true });
}
function ensureBackupCategoryDir(category: CreatableBackupCategory) {
  fs.mkdirSync(backupDirectory(category), { recursive: true });
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
function removeDirectoryIfPresent(targetPath: string) {
  if (fs.existsSync(targetPath)) fs.rmSync(targetPath, { recursive: true, force: true });
}
function tableCount(tableName: string) {
  try {
    return one<{ count: number }>(`SELECT COUNT(*) AS count FROM ${tableName}`)?.count ?? 0;
  } catch {
    return 0;
  }
}
function tableGroupCount(tableNames: readonly string[]) {
  return tableNames.reduce((total, tableName)=>total + (tableExists(tableName) ? tableCount(tableName) : 0), 0);
}
function masterBackupRecordCounts() {
  return {
    users: tableCount('users'),
    vendors: tableCount('inventory_vendors'),
    inventoryParts: tableCount('inventory_parts'),
    requisitions: tableCount('inventory_requisitions'),
    requisitionLines: tableCount('inventory_requisition_lines'),
    requisitionStagingItems: tableCount('requisition_staging_items'),
    historyLogs: tableCount('history_logs'),
    machineRecords: tableGroupCount(['machine_assets','machines','machine_library','machine_pms']),
    equipmentRecords: tableGroupCount(['equipment_assets','equipment','equipment_library','equipment_pms']),
    facilityRecords: tableGroupCount(['facility_documents','facility_info','building_prints','facility_pms']),
    preventiveMaintenanceRecords: tableGroupCount(['pm_tasks','pm_history','preventive_maintenance']),
  };
}
function masterBackupProtectedAreas(): ProtectedBackupArea[] {
  const counts = masterBackupRecordCounts();
  return backupDataAreaDefinitions.map(area=>{
    const existingTables = area.tables.filter(tableName=>tableExists(tableName));
    const recordCount = Number(counts[area.key as keyof typeof counts] ?? 0);
    if (!existingTables.length) {
      return { key: area.key, label: area.label, status: 'ready', detail: 'Ready / No data yet' };
    }
    return {
      key: area.key,
      label: area.label,
      status: 'protected',
      detail: recordCount > 0 ? `${recordCount} record${recordCount === 1 ? '' : 's'}` : 'Protected / No data yet',
    };
  });
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
function backupCategoryFromValue(value: unknown, fallback: BackupCategory = 'master') {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return fallback;
  if (backupCategories.includes(text as BackupCategory)) return text as BackupCategory;
  throw new Error('Invalid backup category.');
}
function manifestBackupCategory(value: unknown, fallback: BackupCategory) {
  try {
    return backupCategoryFromValue(value, fallback);
  } catch {
    return fallback;
  }
}
function backupTypeFromValue(value: unknown, fallback: BackupType = 'legacy') {
  const text = String(value ?? '').trim();
  return knownBackupTypes.includes(text as BackupType) ? text as BackupType : fallback;
}
function backupTypeFromFolderName(name: string): BackupType | null {
  return knownBackupTypes.find(type=>name.endsWith(`_${type}`)) ?? null;
}
function backupIdHasUnsafePathSegment(id: string) {
  return !id || id.includes('/') || id.includes('\\') || id.includes('..') || id !== path.basename(id);
}
function backupPathFromId(category: BackupCategory, id: unknown) {
  const clean = String(id ?? '').trim();
  if (backupIdHasUnsafePathSegment(clean) || !clean.startsWith(backupPrefix(category))) throw new Error('Backup not found.');
  const root = path.resolve(backupDirectory(category));
  const resolved = path.resolve(root, clean);
  if (path.dirname(resolved) !== root) throw new Error('Backup not found.');
  return resolved;
}
function resolveBackupCategoryForRequest(category: unknown, backupId: unknown) {
  if (String(category ?? '').trim()) return backupCategoryFromValue(category);
  const clean = String(backupId ?? '').trim();
  if (!backupIdHasUnsafePathSegment(clean)) {
    for (const candidate of backupCategories) {
      try {
        const candidatePath = backupPathFromId(candidate, clean);
        if (fs.existsSync(candidatePath)) return candidate;
      } catch {}
    }
  }
  return 'master';
}
function readBackupManifest(folderPath: string): BackupManifest | null {
  try {
    const manifestPath = path.join(folderPath, 'manifest.json');
    if (!fs.existsSync(manifestPath)) return null;
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as BackupManifest;
  } catch {
    return null;
  }
}
function summaryFromBackupFolder(folderPath: string, fallbackCategory: BackupCategory): BackupSummary | null {
  const name = path.basename(folderPath);
  const manifest = readBackupManifest(folderPath);
  const category = fallbackCategory === 'legacy' ? 'legacy' : manifestBackupCategory(manifest?.backupCategory, fallbackCategory);
  const type = backupTypeFromValue(manifest?.backupType, backupTypeFromFolderName(name) ?? (category === 'legacy' ? 'legacy' : 'manual'));
  const dbFile = path.join(folderPath, 'mcc.sqlite');
  const stat = fs.statSync(folderPath);
  return {
    id: name,
    name,
    category,
    categoryLabel: backupCategoryLabel(category),
    type,
    typeLabel: backupTypeLabel(type),
    createdAt: manifest?.createdAt ?? stat.birthtime.toISOString(),
    sizeBytes: folderSizeBytes(folderPath),
    databaseSizeBytes: manifest?.databaseSizeBytes ?? (fs.existsSync(dbFile) ? fs.statSync(dbFile).size : 0),
    includedPaths: manifest?.includedPaths ?? (fs.existsSync(dbFile) ? ['mcc.sqlite'] : []),
    includedFolders: manifest?.includedFolders ?? (manifest?.includedPaths ?? []).filter(value=>value.endsWith('/')),
    recordCounts: manifest?.recordCounts ?? {},
    checksumSha256: manifest?.checksumSha256 ?? '',
    notes: manifest?.notes ?? '',
    restorable: fs.existsSync(dbFile),
    folderLabel: backupFolderLabel(category),
  };
}
function listBackupDirectory(category: BackupCategory) {
  const root = backupDirectory(category);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(entry=>entry.isDirectory() && entry.name.startsWith(backupPrefix(category)))
    .map(entry=>summaryFromBackupFolder(path.join(root, entry.name), category))
    .filter((backup): backup is BackupSummary => Boolean(backup))
    .sort((left,right)=>right.createdAt.localeCompare(left.createdAt));
}
function listBackupsByCategory(category: BackupCategory, options: { includeLegacy?: boolean } = {}) {
  const backups = listBackupDirectory(category);
  if (category === 'master' && options.includeLegacy) return [...backups, ...listBackupDirectory('legacy')].sort((left,right)=>right.createdAt.localeCompare(left.createdAt));
  return backups;
}
function listMasterBackupsInternal() {
  return listBackupsByCategory('master', { includeLegacy: true });
}
function backupCountsByType(backups = listMasterBackupsInternal()) {
  const counts = Object.fromEntries(knownBackupTypes.map(type=>[type, 0])) as Record<BackupType, number>;
  for (const backup of backups) counts[backup.type] = (counts[backup.type] ?? 0) + 1;
  return counts;
}
function removeBackupFolder(category: CreatableBackupCategory, folderPath: string) {
  const resolved = path.resolve(folderPath);
  const root = path.resolve(backupDirectory(category));
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error('Unsafe backup retention target.');
  fs.rmSync(resolved, { recursive: true, force: true });
}
function applyBackupRetention(category: CreatableBackupCategory) {
  const backups = listBackupsByCategory(category);
  const retention = backupRetention[category];
  for (const type of Object.keys(retention) as BackupType[]) {
    const limit = retention[type] ?? 0;
    if (limit <= 0) continue;
    const typed = backups.filter(backup=>backup.type===type).sort((left,right)=>right.createdAt.localeCompare(left.createdAt));
    typed.slice(limit).forEach(backup=>removeBackupFolder(category, path.join(backupDirectory(category), backup.id)));
  }
}
function defaultManualBackupType(category: CreatableBackupCategory): BackupType {
  if (category === 'daily') return 'daily_manual';
  if (category === 'weekly') return 'weekly_manual';
  return 'master_manual';
}
function createBackup(input: { category: CreatableBackupCategory; type?: BackupType; actor?: User | null; notes?: string }) {
  if (backupInProgress) throw new Error('Another backup is already running.');
  backupInProgress = true;
  const category = input.category;
  const type = input.type ?? defaultManualBackupType(category);
  try {
    ensureBackupCategoryDir(category);
    const createdAt = now();
    const folderName = `${backupPrefix(category)}${safeFolderStamp()}_${type}`;
    const targetDir = path.join(backupDirectory(category), folderName);
    fs.mkdirSync(targetDir, { recursive: false });
    const backupDbPath = path.join(targetDir, 'mcc.sqlite');
    db.exec('PRAGMA wal_checkpoint(FULL);');
    db.exec(`VACUUM INTO ${sqliteLiteral(backupDbPath)}`);
    const includedPaths = ['mcc.sqlite'];
    const includedFolders: string[] = [];
    const fileTargetRoot = path.join(targetDir, 'files');
    for (const includedFolder of masterBackupFolderCandidates) {
      const sourcePath = path.resolve(__dirname, '../../', includedFolder);
      if (copyDirectoryIfPresent(sourcePath, path.join(fileTargetRoot, includedFolder))) {
        includedPaths.push(`${includedFolder}/`);
        includedFolders.push(`${includedFolder}/`);
      }
    }
    const databaseSizeBytes = fs.statSync(backupDbPath).size;
    const manifest: BackupManifest = {
      appName,
      backupCategory: category,
      backupType: type,
      createdAt,
      createdBy: actorForManifest(input.actor),
      appVersion: version,
      databaseFile: 'mcc.sqlite',
      databaseSizeBytes,
      includedPaths,
      includedFolders,
      recordCounts: masterBackupRecordCounts(),
      checksumSha256: sha256File(backupDbPath),
      notes: input.notes ?? '',
    };
    fs.writeFileSync(path.join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    applyBackupRetention(category);
    const summary = summaryFromBackupFolder(targetDir, category);
    lastBackupResult = { ok: true, category, type, backupId: folderName, createdAt, message: `${backupTypeLabel(type)} backup created.` };
    return summary!;
  } catch (error) {
    lastBackupResult = { ok: false, category, type, createdAt: now(), message: safeBackupClientError(error, 'Backup failed.') };
    throw error;
  } finally {
    backupInProgress = false;
  }
}
function legacyMasterTypeToTiered(type: LegacyMasterBackupType): { category: CreatableBackupCategory; type: BackupType } {
  if (type === 'auto') return { category: 'daily', type: 'daily_auto' };
  if (type === 'scheduled') return { category: 'master', type: 'master_scheduled' };
  if (type === 'manual') return { category: 'master', type: 'master_manual' };
  if (type === 'pre_restore') return { category: 'master', type: 'pre_restore' };
  return { category: 'master', type: 'startup' };
}
function createMasterBackup(input: { type: LegacyMasterBackupType; actor?: User | null; notes?: string }) {
  const tiered = legacyMasterTypeToTiered(input.type);
  return createBackup({ category: tiered.category, type: tiered.type, actor: input.actor, notes: input.notes });
}
function scheduleAutoBackup(reason: string, actor?: User | null) {
  autoBackupReason = reason;
  if (actor) autoBackupActor = actor;
  if (autoBackupTimer) clearTimeout(autoBackupTimer);
  autoBackupTimer = setTimeout(()=>{
    autoBackupTimer = undefined;
    try {
      createBackup({ category: 'daily', type: 'daily_auto', actor: autoBackupActor, notes: autoBackupReason || 'Automatic backup after MCC data changes.' });
    } catch (error) {
      console.log(`MCC daily auto backup failed: ${safeErrorMessage(error)}`);
    } finally {
      autoBackupReason = '';
      autoBackupActor = null;
    }
  }, autoBackupDelayMs);
  autoBackupTimer.unref?.();
}
function verifyBackup(category: BackupCategory, id: unknown) {
  const folderPath = backupPathFromId(category, id);
  if (!fs.existsSync(folderPath)) throw new Error('Backup not found.');
  const summary = summaryFromBackupFolder(folderPath, category);
  if (!summary?.restorable) throw new Error('Backup database file is missing.');
  const dbFile = path.join(folderPath, 'mcc.sqlite');
  const manifest = readBackupManifest(folderPath);
  const checksumSha256 = sha256File(dbFile);
  const checksumMatches = !manifest?.checksumSha256 || manifest.checksumSha256 === checksumSha256;
  return { ok: checksumMatches, backup: summary, checksumSha256, message: checksumMatches ? 'Backup verified.' : 'Backup checksum does not match the manifest.' };
}
function verifyMasterBackup(id: unknown) {
  return verifyBackup('master', id);
}
function appDataFolderPath(folderName: string) {
  if (!masterBackupFolderCandidates.includes(folderName)) throw new Error('Unsafe restore folder.');
  const backendRoot = path.resolve(__dirname, '../../');
  const resolved = path.resolve(backendRoot, folderName);
  if (!resolved.startsWith(`${backendRoot}${path.sep}`)) throw new Error('Unsafe restore folder.');
  return resolved;
}
function restoreWhitelistedFoldersFromBackup(backupFolderPath: string, options: { removeMissing: boolean }) {
  const restoredFolders: string[] = [];
  const backupFilesRoot = path.join(backupFolderPath, 'files');
  for (const folderName of masterBackupFolderCandidates) {
    const sourcePath = path.join(backupFilesRoot, folderName);
    const targetPath = appDataFolderPath(folderName);
    if (fs.existsSync(sourcePath) && fs.statSync(sourcePath).isDirectory()) {
      removeDirectoryIfPresent(targetPath);
      fs.cpSync(sourcePath, targetPath, { recursive: true });
      restoredFolders.push(folderName);
    } else if (options.removeMissing) {
      removeDirectoryIfPresent(targetPath);
    }
  }
  fs.mkdirSync(brandingUploadsDir, { recursive: true });
  return restoredFolders;
}
function restoreBackup(input: { category: BackupCategory; backupId: unknown; actor: User; confirmation: unknown }) {
  if (String(input.confirmation ?? '').trim() !== 'RESTORE MCC') throw new Error('Type RESTORE MCC to confirm restore.');
  const verification = verifyBackup(input.category, input.backupId);
  if (!verification.ok) throw new Error(verification.message);
  const backupFolderPath = backupPathFromId(input.category, input.backupId);
  const backupDbPath = path.join(backupFolderPath, 'mcc.sqlite');
  const preRestoreBackup = createBackup({ category: 'master', type: 'pre_restore', actor: input.actor, notes: `Before restoring ${verification.backup.name}` });
  const preRestoreFolderPath = backupPathFromId('master', preRestoreBackup.id);
  const preRestoreDbPath = path.join(preRestoreFolderPath, 'mcc.sqlite');
  let restoredFolders: string[] = [];
  try {
    db.close();
    for (const filePath of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
      if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
    }
    fs.copyFileSync(backupDbPath, dbPath);
    db = new DatabaseSync(dbPath);
    db.exec('PRAGMA journal_mode=WAL;');
    initDb();
    migrateDb();
    restoredFolders = restoreWhitelistedFoldersFromBackup(backupFolderPath, { removeMissing: true });
    try { audit({ user: input.actor, ip: '', get: () => '' } as unknown as Request, 'backup restore completed', 'backup', verification.backup.id, { preRestoreBackupId: preRestoreBackup.id, category: input.category, restoredFolders }); } catch {}
    lastBackupResult = { ok: true, category: input.category, type: verification.backup.type, backupId: verification.backup.id, createdAt: now(), message: `Restored ${verification.backup.name}.` };
    return { restoredBackup: verification.backup, preRestoreBackup, restoredFolders };
  } catch (error) {
    try { db.close(); } catch {}
    try {
      for (const filePath of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
        if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
      }
      if (fs.existsSync(preRestoreDbPath)) fs.copyFileSync(preRestoreDbPath, dbPath);
      if (fs.existsSync(dbPath)) {
        db = new DatabaseSync(dbPath);
        db.exec('PRAGMA journal_mode=WAL;');
        initDb();
        migrateDb();
      }
      restoreWhitelistedFoldersFromBackup(preRestoreFolderPath, { removeMissing: true });
    } catch (rollbackError) {
      console.log(`MCC pre-restore rollback failed: ${safeErrorMessage(rollbackError)}`);
    }
    throw error;
  }
}
function restoreMasterBackup(input: { backupId: unknown; actor: User; confirmation: unknown }) {
  return restoreBackup({ category: 'master', backupId: input.backupId, actor: input.actor, confirmation: input.confirmation });
}
function backupGroupHealth(category: BackupCategory, backups: BackupSummary[]): BackupHealth {
  const root = backupDirectory(category);
  if (!fs.existsSync(root)) return { ok: false, label: 'Needs Attention', message: `${backupCategoryLabel(category)} folder is missing.` };
  const health = databaseQuickCheck();
  if (!health.ok) return { ok: false, label: 'Needs Attention', message: health.message };
  if (!backups.some(backup=>backup.restorable)) return { ok: false, label: 'Needs Attention', message: 'No restorable backup found yet.' };
  return { ok: true, label: 'Healthy', message: 'Latest backup storage is ready.' };
}
function hiddenBackupGroup(category: BackupCategory) {
  return {
    category,
    categoryLabel: backupCategoryLabel(category),
    visible: false,
    latestBackup: null,
    lastAutoBackup: null,
    count: 0,
    health: { ok: false, label: 'Hidden', message: 'Not available for this role.' } as BackupHealth,
    folderLabel: '',
    folderPath: '',
    autoBackupPending: false,
    nextScheduledBackupAt: null,
  };
}
function backupGroupStatus(category: Exclude<BackupCategory, 'legacy'>, actor: User) {
  if (!canViewBackupCategory(actor, category)) return hiddenBackupGroup(category);
  const backups = listBackupsByCategory(category, { includeLegacy: category === 'master' });
  return {
    category,
    categoryLabel: backupCategoryLabel(category),
    visible: true,
    latestBackup: backups[0] ?? null,
    lastAutoBackup: category === 'daily' ? backups.find(backup=>backup.type === 'daily_auto' || backup.type === 'auto') ?? null : null,
    count: backups.length,
    health: backupGroupHealth(category, backups),
    folderLabel: backupFolderLabel(category),
    folderPath: backupFolderLabel(category),
    autoBackupPending: category === 'daily' ? Boolean(autoBackupTimer) : false,
    nextScheduledBackupAt: category === 'weekly' ? nextWeeklyBackupAt : category === 'master' ? nextMasterBackupAt : null,
  };
}
function backupPermissionStatus(actor: User) {
  const canViewDaily = canViewBackupCategory(actor, 'daily');
  const canCreateDaily = canCreateBackupCategory(actor, 'daily');
  const canRestoreDaily = canRestoreBackupCategory(actor, 'daily');
  const canViewWeekly = canViewBackupCategory(actor, 'weekly');
  const canCreateWeekly = canCreateBackupCategory(actor, 'weekly');
  const canRestoreWeekly = canRestoreBackupCategory(actor, 'weekly');
  const canViewMaster = canViewBackupCategory(actor, 'master');
  const canCreateMaster = canCreateBackupCategory(actor, 'master');
  const canRestoreMaster = canRestoreBackupCategory(actor, 'master');
  return {
    canViewDaily,
    canCreateDaily,
    canRestoreDaily,
    canViewWeekly,
    canCreateWeekly,
    canRestoreWeekly,
    canViewMaster,
    canCreateMaster,
    canRestoreMaster,
    canViewBackups: canViewDaily || canViewWeekly || canViewMaster,
    canCreateBackup: canCreateMaster,
    canRestoreBackup: canRestoreMaster,
  };
}
function masterBackupStatus(actor?: User) {
  ensureBackupDirs();
  const visibleBackups = actor
    ? (['daily','weekly','master'] as const).flatMap(category=>canViewBackupCategory(actor, category) ? listBackupsByCategory(category, { includeLegacy: category === 'master' }) : [])
    : listMasterBackupsInternal();
  const backups = visibleBackups.sort((left,right)=>right.createdAt.localeCompare(left.createdAt));
  const latestBackup = backups[0] ?? null;
  const dbStat = fs.existsSync(dbPath) ? fs.statSync(dbPath) : null;
  const health = databaseQuickCheck();
  const daily = actor ? backupGroupStatus('daily', actor) : hiddenBackupGroup('daily');
  const weekly = actor ? backupGroupStatus('weekly', actor) : hiddenBackupGroup('weekly');
  const master = actor ? backupGroupStatus('master', actor) : hiddenBackupGroup('master');
  return {
    ok: true,
    daily,
    weekly,
    master,
    latestBackup,
    lastAutoBackup: backups.find(backup=>backup.type === 'daily_auto' || backup.type === 'auto') ?? null,
    lastManualBackup: backups.find(backup=>backup.type === 'daily_manual' || backup.type === 'weekly_manual' || backup.type === 'master_manual' || backup.type === 'manual') ?? null,
    lastPreResetBackup: backups.find(backup=>(backup.type === 'master_manual' || backup.type === 'manual') && /pre-reset backup/i.test(backup.notes)) ?? null,
    lastPreRestoreBackup: backups.find(backup=>backup.type === 'pre_restore') ?? null,
    backupFolderExists: fs.existsSync(backupsDir),
    backupCountsByType: backupCountsByType(backups),
    lastBackupResult,
    autoBackupPending: Boolean(autoBackupTimer),
    protectedAreas: masterBackupProtectedAreas(),
    nextScheduledBackupAt: nextWeeklyBackupAt,
    nextWeeklyBackupAt,
    nextMasterBackupAt,
    databaseSize: dbStat?.size ?? 0,
    backupHealth: health.ok ? 'Healthy' : `Needs attention: ${health.message}`,
    autoBackupDelaySeconds: Math.round(autoBackupDelayMs / 1000),
    scheduledBackupIntervalMinutes: null,
    permissions: actor ? backupPermissionStatus(actor) : undefined,
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
function backupCreatedAtDate(backup: BackupSummary) {
  const date = new Date(backup.createdAt);
  return Number.isNaN(date.getTime()) ? null : date;
}
function hasSuccessfulBackupSince(category: Exclude<BackupCategory, 'legacy'>, start: Date, options: { includeLegacy?: boolean } = {}) {
  return listBackupsByCategory(category, { includeLegacy: options.includeLegacy }).some(backup=>{
    if (!backup.restorable) return false;
    const createdAt = backupCreatedAtDate(backup);
    return Boolean(createdAt && createdAt >= start);
  });
}
function nextFridayOnePm(from = new Date()) {
  const target = new Date(from.getFullYear(), from.getMonth(), from.getDate(), weeklyBackupHour, 0, 0, 0);
  const daysUntilFriday = (5 - target.getDay() + 7) % 7;
  target.setDate(target.getDate() + daysUntilFriday);
  if (target <= from) target.setDate(target.getDate() + 7);
  return target;
}
function currentWeeklyWindowStart(from = new Date()) {
  const target = new Date(from.getFullYear(), from.getMonth(), from.getDate(), weeklyBackupHour, 0, 0, 0);
  const daysSinceFriday = (target.getDay() - 5 + 7) % 7;
  target.setDate(target.getDate() - daysSinceFriday);
  if (target > from) target.setDate(target.getDate() - 7);
  return target;
}
function nextMonthlyMasterOnePm(from = new Date()) {
  let target = new Date(from.getFullYear(), from.getMonth(), 1, masterBackupHour, 0, 0, 0);
  if (target <= from) target = new Date(from.getFullYear(), from.getMonth() + 1, 1, masterBackupHour, 0, 0, 0);
  return target;
}
function currentMonthlyScheduleTime(from = new Date()) {
  return new Date(from.getFullYear(), from.getMonth(), 1, masterBackupHour, 0, 0, 0);
}
function currentMonthStart(from = new Date()) {
  return new Date(from.getFullYear(), from.getMonth(), 1, 0, 0, 0, 0);
}
function createMissedWeeklyBackupIfNeeded() {
  const windowStart = currentWeeklyWindowStart();
  if (hasSuccessfulBackupSince('weekly', windowStart)) return;
  try {
    createBackup({ category: 'weekly', type: 'weekly_scheduled', notes: 'Missed Friday 1:00 PM weekly full backup created on startup.' });
  } catch (error) {
    console.log(`MCC missed weekly backup failed: ${safeErrorMessage(error)}`);
  }
}
function createMissedMasterBackupIfNeeded() {
  const currentTime = new Date();
  if (currentTime < currentMonthlyScheduleTime(currentTime)) return;
  if (hasSuccessfulBackupSince('master', currentMonthStart(currentTime), { includeLegacy: true })) return;
  try {
    createBackup({ category: 'master', type: 'master_scheduled', notes: 'Missed monthly master backup created on startup.' });
  } catch (error) {
    console.log(`MCC missed monthly master backup failed: ${safeErrorMessage(error)}`);
  }
}
function armWeeklyBackupTimer(target: Date) {
  const delay = Math.max(1000, Math.min(target.getTime() - Date.now(), maxBackupScheduleDelayMs));
  weeklyBackupTimer = setTimeout(()=>{
    if (Date.now() < target.getTime() - 1000) {
      armWeeklyBackupTimer(target);
      return;
    }
    try {
      createBackup({ category: 'weekly', type: 'weekly_scheduled', notes: 'Scheduled Friday 1:00 PM weekly full backup.' });
    } catch (error) {
      console.log(`MCC weekly backup failed: ${safeErrorMessage(error)}`);
    } finally {
      scheduleWeeklyBackupTimer();
    }
  }, delay);
  weeklyBackupTimer.unref?.();
}
function scheduleWeeklyBackupTimer() {
  if (weeklyBackupTimer) clearTimeout(weeklyBackupTimer);
  const target = nextFridayOnePm();
  nextWeeklyBackupAt = target.toISOString();
  armWeeklyBackupTimer(target);
}
function armMasterBackupTimer(target: Date) {
  const delay = Math.max(1000, Math.min(target.getTime() - Date.now(), maxBackupScheduleDelayMs));
  masterBackupTimer = setTimeout(()=>{
    if (Date.now() < target.getTime() - 1000) {
      armMasterBackupTimer(target);
      return;
    }
    try {
      if (!hasSuccessfulBackupSince('master', currentMonthStart(), { includeLegacy: true })) {
        createBackup({ category: 'master', type: 'master_scheduled', notes: 'Scheduled monthly master full backup.' });
      }
    } catch (error) {
      console.log(`MCC monthly master backup failed: ${safeErrorMessage(error)}`);
    } finally {
      scheduleMasterBackupTimer();
    }
  }, delay);
  masterBackupTimer.unref?.();
}
function scheduleMasterBackupTimer() {
  if (masterBackupTimer) clearTimeout(masterBackupTimer);
  const target = nextMonthlyMasterOnePm();
  nextMasterBackupAt = target.toISOString();
  armMasterBackupTimer(target);
}
function startBackupSchedulers() {
  ensureBackupDirs();
  if (quarantineLiveDatabaseIfUnhealthy()) return;
  createMissedWeeklyBackupIfNeeded();
  createMissedMasterBackupIfNeeded();
  scheduleWeeklyBackupTimer();
  scheduleMasterBackupTimer();
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
function isPartNumberHeader(header: string) {
  return ['partnumber','partno'].includes(normalizeImportHeader(header));
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
  const notes = appendImportNotes(value('Notes','Note'), {
    Asset: value('Asset','Asset No','Asset Number'),
    Dept: value('Dept','Department'),
  });
  return {
    rowNumber,
    mccItemId: value('MCC Item ID','Item ID','ID'),
    partNumber: value('Part Number','PartNumber','Part No','Part','SKU'),
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
    leadTime: value('Lead Time','LeadTime','Delivery Time','ETA'),
    importantNote: value('Important Note','Important','Alert Note','Red Note'),
    notes,
  };
}
function appendImportNotes(notes: string, additions: Record<string, string>) {
  const lines = Object.entries(additions)
    .map(([label, raw]) => [label, raw.trim()] as const)
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`);
  const cleanNotes = notes.trim();
  if (!lines.length) return cleanNotes;
  return [cleanNotes, ...lines].filter(Boolean).join('\n');
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
    if (typeof record.hyperLink === 'string') return record.hyperLink.trim();
    if (record.text && typeof record.text === 'object') {
      const textRecord = record.text as unknown as Record<string, unknown>;
      if (typeof textRecord.hyperlink === 'string') return textRecord.hyperlink.trim();
    }
  }
  return '';
}
function excelCellImportValue(cell: ExcelJS.Cell, headerName: string): NativeImportCell {
  const text = excelCellText(cell);
  const hyperlink = isPartInfoUrlHeader(headerName) || isPartNumberHeader(headerName) ? excelCellHyperlink(cell) : '';
  return { text, hyperlink };
}
function importRowsFromExcelCells(rows: NativeImportCell[][]) {
  if (rows.length < 1) return [];
  const headers = rows[0].map(cell => cell.text.trim());
  const normalizedHeaders = headers.map(normalizeImportHeader);
  return rows.slice(1).map((row, index) => {
    const record: Record<string, string> = {};
    let partInfoUrl = '';
    let partNumberHyperlink = '';
    headers.forEach((header, columnIndex) => {
      const cell = row[columnIndex] ?? { text: '', hyperlink: '' };
      const value = isPartInfoUrlHeader(header) ? cell.hyperlink || cell.text : cell.text;
      if (isPartInfoUrlHeader(header) && value.trim()) partInfoUrl = value.trim();
      if (isPartNumberHeader(header) && cell.hyperlink.trim() && !partNumberHyperlink) partNumberHyperlink = cell.hyperlink.trim();
      record[header] = value;
      record[normalizedHeaders[columnIndex]] = value;
    });
    if (!partInfoUrl && partNumberHyperlink) {
      record['Part Info URL'] = partNumberHyperlink;
      record[normalizeImportHeader('Part Info URL')] = partNumberHyperlink;
    }
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
  const cleaned = value.trim().replace(/[$,\s]/g, '');
  if (!cleaned) return 0;
  const parsed = Number(cleaned);
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
function addImportError(summary: NativeImportSummary, message: string) {
  summary.errorCount += 1;
  if (summary.errors.length < 5) summary.errors.push(message);
}
function prepareNativeImportRow(row: NativeImportRow, summary: NativeImportSummary): PreparedNativeImportRow {
  const partNumber = row.partNumber.trim();
  if (!partNumber) throw new Error(`Row ${row.rowNumber}: Part Number is required.`);
  const quantity = numericImportValue(row.quantity, 'Quantity', row.rowNumber);
  const minQuantity = numericImportValue(row.minQuantity, 'Minimum Quantity', row.rowNumber);
  const unitCost = numericImportValue(row.unitCost, 'Unit Cost', row.rowNumber);
  if (unitCost < 0) throw new Error(`Row ${row.rowNumber}: Unit Cost must be zero or greater.`);
  const rawUrl = row.partInfoUrl.trim();
  const partInfoUrl = rawUrl ? validWebUrl(rawUrl) : '';
  if (rawUrl && !partInfoUrl) {
    summary.invalidUrlCount += 1;
    addImportError(summary, `Row ${row.rowNumber}: unsafe Part Info URL was skipped.`);
  }
  const status = nativePartStatus(quantity, minQuantity);
  return {
    rowNumber: row.rowNumber,
    mccItemId: row.mccItemId.trim(),
    partNumber,
    description: row.description.trim(),
    location: row.location.trim(),
    vendor: row.vendor.trim(),
    quantity,
    minQuantity,
    requisition: requisitionImportValue(row.requisition),
    partInfoUrl,
    manufacturerBrand: row.manufacturerBrand.trim(),
    unitCost,
    supplierPartNumber: row.supplierPartNumber.trim(),
    leadTime: row.leadTime.trim().slice(0, 120),
    importantNote: row.importantNote.trim().slice(0, 500),
    notes: row.notes.trim(),
    status,
  };
}
function consolidatedNativeImportRows(rows: NativeImportRow[], summary: NativeImportSummary) {
  const order: string[] = [];
  const preparedByPartNumber = new Map<string, PreparedNativeImportRow>();
  for (const row of rows) {
    try {
      const prepared = prepareNativeImportRow(row, summary);
      const key = normalizedPartNumberKey(prepared.partNumber);
      const previous = preparedByPartNumber.get(key);
      if (previous) {
        summary.duplicateMergedCount += 1;
        addImportError(summary, `Rows ${previous.rowNumber} and ${prepared.rowNumber}: duplicate Part Number in import file; row ${prepared.rowNumber} was used.`);
      } else {
        order.push(key);
      }
      preparedByPartNumber.set(key, prepared);
    } catch (error) {
      summary.skippedCount += 1;
      addImportError(summary, safeErrorMessage(error));
    }
  }
  return order.map(key => preparedByPartNumber.get(key)).filter(Boolean) as PreparedNativeImportRow[];
}
function cleanupDuplicateNativeParts(req: Request, actor: User, primary: NativePartRow, candidates: NativePartRow[], timestamp: string, summary: NativeImportSummary, rowNumber: number) {
  const reasonNote = 'Duplicate Part Number cleaned during inventory import.';
  for (const candidate of candidates) {
    if (candidate.id === primary.id) continue;
    const activeRequisitionCount = activeRequisitionCountForPart(candidate.id);
    if (activeRequisitionCount > 0) {
      addImportError(summary, `Row ${rowNumber}: duplicate Part Number ${primary.part_number} on part ID ${candidate.id} has an active requisition and was left active.`);
      continue;
    }
    run('UPDATE inventory_parts SET deleted=1, deleted_at=?, deleted_by_user_id=?, updated_at=? WHERE id=? AND deleted=0', [timestamp,actor.id,timestamp,candidate.id]);
    summary.duplicatesRemovedCount += 1;
    inventoryAudit(req,'duplicate_soft_deleted','part',candidate.id,{partNumber:candidate.part_number,primaryPartId:primary.id,reason:reasonNote});
    recordInventoryPartHistory({
      action: 'duplicate_soft_deleted',
      actor,
      partId: candidate.id,
      row: candidate,
      oldValue: nativePartHistoryValue(candidate),
      newValue: { ...nativePartHistoryValue(candidate), deleted: true, primaryPartId: primary.id },
      quantityBefore: Number(candidate.quantity ?? 0),
      quantityAfter: Number(candidate.quantity ?? 0),
      reasonNote,
    });
  }
}
function updateNativeImportPart(req: Request, actor: User, existing: NativePartRow, input: PreparedNativeImportRow, timestamp: string, summary: NativeImportSummary) {
  const location = getOrCreateMccNativeLookup(req,'inventory_locations',input.location,timestamp);
  const vendor = getOrCreateMccNativeLookup(req,'inventory_vendors',input.vendor,timestamp,'vendor_created_from_import');
  if (location.created) summary.locationCreatedCount += 1;
  if (vendor.created) summary.vendorCreatedCount += 1;
  const quantityBefore = Number(existing.quantity ?? 0);
  const quantityAfter = Number(input.quantity ?? 0);
  run(`UPDATE inventory_parts SET part_number=?, description=?, location_id=?, vendor_id=?, quantity=?, min_quantity=?, status=?, requisition=?, part_info_url=?, manufacturer_brand=?, unit_cost=?, supplier_part_number=?, lead_time=?, important_note=?, notes=?, source=?, updated_by_user_id=?, updated_at=? WHERE id=?`, [input.partNumber,input.description,location.id,vendor.id,input.quantity,input.minQuantity,input.status,input.requisition,input.partInfoUrl,input.manufacturerBrand,input.unitCost,input.supplierPartNumber,input.leadTime,input.importantNote,input.notes,'mcc',actor.id,timestamp,existing.id]);
  const updatedRow = nativePartRowById(existing.id);
  summary.updatedCount += 1;
  inventoryAudit(req,'inventory import update','part',existing.id,{partNumber:input.partNumber,locationAutoCreated:location.created,vendorAutoCreated:vendor.created,rowNumber:input.rowNumber});
  recordInventoryPartHistory({
    action: 'updated',
    actor,
    partId: existing.id,
    row: updatedRow,
    oldValue: nativePartHistoryValue(existing),
    newValue: updatedRow ? nativePartHistoryValue(updatedRow) : null,
    quantityBefore,
    quantityAfter,
  });
  return updatedRow ?? existing;
}
function insertNativeImportPart(req: Request, actor: User, input: PreparedNativeImportRow, timestamp: string, summary: NativeImportSummary) {
  const location = getOrCreateMccNativeLookup(req,'inventory_locations',input.location,timestamp);
  const vendor = getOrCreateMccNativeLookup(req,'inventory_vendors',input.vendor,timestamp,'vendor_created_from_import');
  if (location.created) summary.locationCreatedCount += 1;
  if (vendor.created) summary.vendorCreatedCount += 1;
  const result = run(`INSERT INTO inventory_parts (mit3_item_id,part_number,description,location_id,vendor_id,quantity,min_quantity,status,requisition,part_info_url,manufacturer_brand,unit_cost,supplier_part_number,lead_time,important_note,notes,source,imported_from_mit3_at,created_by_user_id,updated_by_user_id,created_at,updated_at,deleted) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`, [null,input.partNumber,input.description,location.id,vendor.id,input.quantity,input.minQuantity,input.status,input.requisition,input.partInfoUrl,input.manufacturerBrand,input.unitCost,input.supplierPartNumber,input.leadTime,input.importantNote,input.notes,'mcc',null,actor.id,actor.id,timestamp,timestamp]);
  const partId = Number(result.lastInsertRowid);
  const createdRow = nativePartRowById(partId);
  summary.addedCount += 1;
  inventoryAudit(req,'inventory import create','part',partId,{partNumber:input.partNumber,locationAutoCreated:location.created,vendorAutoCreated:vendor.created,rowNumber:input.rowNumber});
  recordInventoryPartHistory({
    action: 'created',
    actor,
    partId,
    row: createdRow,
    newValue: createdRow ? nativePartHistoryValue(createdRow) : null,
    quantityAfter: input.quantity,
  });
}
function upsertNativeImportRow(req: Request, actor: User, input: PreparedNativeImportRow, timestamp: string, summary: NativeImportSummary) {
  const candidates = findActivePartsByPartNumber(input.partNumber);
  const mccItemId = Number(input.mccItemId);
  const existingById = Number.isInteger(mccItemId) && mccItemId > 0 ? nativePartRowById(mccItemId) : undefined;
  const activeCandidates = candidates.length ? candidates : existingById ? [existingById] : [];
  if (activeCandidates.length) {
    const primary = choosePrimaryNativePart(activeCandidates).row;
    const updatedPrimary = updateNativeImportPart(req, actor, primary, input, timestamp, summary);
    cleanupDuplicateNativeParts(req, actor, updatedPrimary, activeCandidates, timestamp, summary, input.rowNumber);
  } else {
    insertNativeImportPart(req, actor, input, timestamp, summary);
  }
}
function importNativeInventoryRows(req: Request, rows: NativeImportRow[]) {
  const actor = (req as AuthRequest).user!;
  const summary: NativeImportSummary = { addedCount: 0, updatedCount: 0, skippedCount: 0, duplicateMergedCount: 0, duplicatesRemovedCount: 0, vendorCreatedCount: 0, locationCreatedCount: 0, invalidUrlCount: 0, errorCount: 0, errors: [] };
  const timestamp = now();
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const row of consolidatedNativeImportRows(rows, summary)) {
      try {
        upsertNativeImportRow(req, actor, row, timestamp, summary);
      } catch (error) {
        summary.skippedCount += 1;
        addImportError(summary, safeErrorMessage(error));
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
    'Retired inventory import',
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
  if (input.quantity === undefined || input.quantity === null || String(input.quantity).trim() === '') throw new Error('Quantity is required.');
  const quantity = numericInput(input, 'quantity', 'Quantity');
  const minQuantity = numericInput(input, 'minQuantity', 'Minimum Quantity');
  if (quantity < 0) throw new Error('Quantity cannot be negative.');
  if (minQuantity < 0) throw new Error('Minimum Quantity cannot be negative.');
  const manufacturerBrand = textField(input, ['manufacturerBrand','manufacturer','brand']).slice(0, 160);
  if (input.unitCost === undefined || input.unitCost === null || String(input.unitCost).trim() === '') throw new Error('Unit Cost is required.');
  const unitCost = numericInput(input, 'unitCost', 'Unit Cost');
  if (unitCost < 0) throw new Error('Unit Cost cannot be negative.');
  const supplierPartNumber = textField(input, ['supplierPartNumber','supplierPartNo']).slice(0, 160);
  const leadTime = textField(input, ['leadTime','lead_time','deliveryTime','eta']).slice(0, 120);
  const importantNote = textField(input, ['importantNote','important_note','important','alertNote','redNote']).slice(0, 500);
  const rawUrl = textField(input, ['partInfoUrl']);
  const partInfoUrl = rawUrl ? safePartInfoUrl(rawUrl) : '';
  if (rawUrl && !partInfoUrl) throw new Error('Part Info URL must be blank or a valid http/https URL.');
  return {partNumber,description,location,vendor,quantity,minQuantity,manufacturerBrand,unitCost,supplierPartNumber,leadTime,importantNote,partInfoUrl,status:nativePartStatus(quantity,minQuantity)};
}
type NativePartInput = ReturnType<typeof validateNativePartInput>;
function findDuplicateNativePart(partNumber: string, excludeId?: number) {
  if (!partNumber) return undefined;
  return excludeId
    ? one<{ id: number }>('SELECT id FROM inventory_parts WHERE deleted=0 AND lower(trim(part_number))=lower(?) AND id<>? ORDER BY id LIMIT 1', [partNumber.trim(),excludeId])
    : one<{ id: number }>('SELECT id FROM inventory_parts WHERE deleted=0 AND lower(trim(part_number))=lower(?) ORDER BY id LIMIT 1', [partNumber.trim()]);
}
function normalizedPartNumberKey(partNumber: string) {
  return partNumber.trim().toLowerCase();
}
function findActivePartsByPartNumber(partNumber: string) {
  const clean = partNumber.trim();
  if (!clean) return [];
  return all<NativePartRow>(`SELECT p.*, l.name AS location_name, v.name AS vendor_name, v.deleted AS vendor_deleted, v.is_active AS vendor_is_active
FROM inventory_parts p
LEFT JOIN inventory_locations l ON l.id=p.location_id AND l.deleted=0
LEFT JOIN inventory_vendors v ON v.id=p.vendor_id
WHERE p.deleted=0 AND lower(trim(p.part_number))=lower(?) ORDER BY p.id`, [clean]);
}
function inventoryHistoryCountForPart(partId: number) {
  return one<{ count: number }>("SELECT COUNT(*) AS count FROM history_logs WHERE section='inventory' AND entity_id=?", [String(partId)])?.count ?? 0;
}
function choosePrimaryNativePart(rows: NativePartRow[]) {
  return rows.map(row => ({
    row,
    activeRequisitionCount: activeRequisitionCountForPart(row.id),
    historyCount: inventoryHistoryCountForPart(row.id),
  })).sort((left, right) => {
    const activeDelta = Number(right.activeRequisitionCount > 0) - Number(left.activeRequisitionCount > 0);
    if (activeDelta) return activeDelta;
    const historyDelta = Number(right.historyCount > 0) - Number(left.historyCount > 0);
    if (historyDelta) return historyDelta;
    return left.row.id - right.row.id;
  })[0];
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
type RequisitionStagingStatus = 'Need to Order' | 'Ready for Requisition' | 'Requisition Created' | 'Ordered' | 'Removed / Canceled';
type RequisitionStagingPriority = 'Critical' | 'High' | 'Normal' | 'Low';
const requisitionStagingStatuses: RequisitionStagingStatus[] = ['Need to Order','Ready for Requisition','Requisition Created','Ordered','Removed / Canceled'];
const requisitionStagingPriorities: RequisitionStagingPriority[] = ['Critical','High','Normal','Low'];
interface RequisitionStagingRow {
  id: number;
  inventory_part_id: number | null;
  part_number: string;
  description: string;
  vendor_name: string;
  supplier_part_number: string;
  quantity_requested: number;
  unit_cost: number;
  location_name: string;
  asset_machine: string;
  work_order_number: string;
  priority: RequisitionStagingPriority;
  notes: string;
  requested_by: string;
  date_added: string;
  needed_by_date: string | null;
  status: RequisitionStagingStatus;
  created_requisition_id: number | null;
  created_requisition_number: string;
  created_by_user_id: number | null;
  updated_by_user_id: number | null;
  removed_by_user_id: number | null;
  removed_at: string | null;
  created_at: string;
  updated_at: string;
}
function publicRequisitionStagingItem(row: RequisitionStagingRow) {
  return {
    id: row.id,
    inventoryPartId: row.inventory_part_id,
    partNumber: row.part_number,
    description: row.description,
    vendor: row.vendor_name,
    supplierPartNumber: row.supplier_part_number,
    quantityRequested: Number(row.quantity_requested),
    unitCost: Number(row.unit_cost ?? 0),
    location: row.location_name,
    assetMachine: row.asset_machine,
    workOrderNumber: row.work_order_number,
    priority: row.priority,
    notes: row.notes,
    requestedBy: row.requested_by,
    dateAdded: row.date_added,
    neededByDate: row.needed_by_date ?? '',
    status: row.status,
    createdRequisitionId: row.created_requisition_id,
    createdRequisitionNumber: row.created_requisition_number,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function requisitionStagingById(id: number) {
  return one<RequisitionStagingRow>('SELECT * FROM requisition_staging_items WHERE id=?', [id]);
}
function activeStagingForPart(partId: number) {
  return one<{ id: number; status: RequisitionStagingStatus }>("SELECT id,status FROM requisition_staging_items WHERE inventory_part_id=? AND status IN ('Need to Order','Ready for Requisition') ORDER BY updated_at DESC,id DESC LIMIT 1", [partId]);
}
function isOpenRequisitionStagingStatus(status: RequisitionStagingStatus) {
  return status === 'Need to Order' || status === 'Ready for Requisition';
}
function requisitionStagingList(search = '') {
  const where = ["status IN ('Need to Order','Ready for Requisition')"];
  const params: SqlParam[] = [];
  if (search.trim()) {
    const like = `%${escapeLike(search.trim())}%`;
    where.push("(part_number LIKE ? ESCAPE '\\' COLLATE NOCASE OR description LIKE ? ESCAPE '\\' COLLATE NOCASE OR vendor_name LIKE ? ESCAPE '\\' COLLATE NOCASE OR supplier_part_number LIKE ? ESCAPE '\\' COLLATE NOCASE OR location_name LIKE ? ESCAPE '\\' COLLATE NOCASE OR asset_machine LIKE ? ESCAPE '\\' COLLATE NOCASE OR work_order_number LIKE ? ESCAPE '\\' COLLATE NOCASE OR requested_by LIKE ? ESCAPE '\\' COLLATE NOCASE OR notes LIKE ? ESCAPE '\\' COLLATE NOCASE OR created_requisition_number LIKE ? ESCAPE '\\' COLLATE NOCASE)");
    params.push(like,like,like,like,like,like,like,like,like,like);
  }
  return all<RequisitionStagingRow>(`SELECT * FROM requisition_staging_items WHERE ${where.join(' AND ')} ORDER BY CASE status WHEN 'Ready for Requisition' THEN 1 ELSE 2 END, CASE priority WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 WHEN 'Normal' THEN 3 ELSE 4 END, date_added DESC,id DESC`, params).map(publicRequisitionStagingItem);
}
function dateOnlyInput(value: unknown, label: string) {
  const clean = cleanPdfText(value);
  if (!clean) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean) || Number.isNaN(Date.parse(`${clean}T00:00:00`))) throw new Error(`${label} must be a valid date.`);
  return clean;
}
function validateRequisitionStagingInput(body: unknown, existing?: RequisitionStagingRow) {
  const input = isRecord(body) ? body : {};
  const inventoryPartIdRaw = input.inventoryPartId ?? input.inventory_part_id ?? existing?.inventory_part_id ?? null;
  const inventoryPartId = inventoryPartIdRaw === null || inventoryPartIdRaw === '' ? null : Number(inventoryPartIdRaw);
  if (inventoryPartId !== null && (!Number.isInteger(inventoryPartId) || inventoryPartId <= 0)) throw new Error('Inventory part not found.');
  const part = inventoryPartId ? nativePartRowById(inventoryPartId) : undefined;
  if (inventoryPartId && !part) throw new Error('Inventory part not found.');
  const field = (keys: string[], fallback = '') => {
    for (const key of keys) if (input[key] !== undefined) return cleanPdfText(input[key]);
    return fallback;
  };
  const partNumber = field(['partNumber','part_number'], part?.part_number ?? existing?.part_number ?? '').slice(0,160);
  const description = field(['description'], part?.description ?? existing?.description ?? '').slice(0,500);
  const vendor = field(['vendor','vendorName','vendor_name'], part?.vendor_name ?? existing?.vendor_name ?? '').slice(0,200);
  if (!partNumber) throw new Error('Part Number is required.');
  if (!description) throw new Error('Description is required.');
  if (!vendor) throw new Error('Vendor is required.');
  const rawQuantity = input.quantityRequested ?? input.quantity_requested ?? input.quantity ?? existing?.quantity_requested;
  const quantityRequested = validateQuantityRequested(rawQuantity);
  const rawUnitCost = input.unitCost ?? input.unit_cost ?? part?.unit_cost ?? existing?.unit_cost ?? 0;
  const unitCost = Number(rawUnitCost);
  if (!Number.isFinite(unitCost) || unitCost < 0) throw new Error('Unit Cost must be zero or a positive number.');
  const priority = field(['priority'], existing?.priority ?? 'Normal') as RequisitionStagingPriority;
  if (!requisitionStagingPriorities.includes(priority)) throw new Error('Priority is invalid.');
  const status = field(['status'], existing?.status ?? 'Need to Order') as RequisitionStagingStatus;
  if (!requisitionStagingStatuses.includes(status) || !isOpenRequisitionStagingStatus(status)) throw new Error('Staging status is invalid.');
  return {
    inventoryPartId,
    partNumber,
    description,
    vendor,
    supplierPartNumber: field(['supplierPartNumber','supplier_part_number'], part?.supplier_part_number ?? existing?.supplier_part_number ?? '').slice(0,160),
    quantityRequested,
    unitCost,
    location: field(['location','locationName','location_name'], part?.location_name ?? existing?.location_name ?? '').slice(0,200),
    assetMachine: field(['assetMachine','asset','machine','asset_machine'], existing?.asset_machine ?? '').slice(0,200),
    workOrderNumber: field(['workOrderNumber','work_order_number'], existing?.work_order_number ?? '').slice(0,160),
    priority,
    notes: field(['notes'], existing?.notes ?? '').slice(0,1200),
    requestedBy: field(['requestedBy','requested_by'], existing?.requested_by ?? '').slice(0,160),
    neededByDate: dateOnlyInput(input.neededByDate ?? input.needed_by_date ?? existing?.needed_by_date ?? '', 'Needed-by date'),
    status,
  };
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
const pdfWhite = rgb(1, 1, 1);
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
  printAreaEndColumn: string;
  printAreaEndRow: number;
  templatePath: string;
};
type XlsxCell = {
  formula?: (formula?: string) => string | undefined;
  style?: (style?: Record<string, unknown>) => unknown;
  value: (value?: unknown) => unknown;
};
type XlsxRow = {
  height?: (height?: number) => unknown;
  hidden?: (hidden?: boolean) => unknown;
};
type XlsxColumn = {
  width?: (width?: number) => unknown;
};
type XlsxSheet = {
  _node?: { children?: Array<{ name: string; attributes?: Record<string, unknown>; children?: unknown[] }> };
  cell: (address: string) => XlsxCell;
  column?: (columnNameOrNumber: string | number) => XlsxColumn;
  definedName?: (name: string, refersTo?: unknown) => unknown;
  pageMargins?: (attributeName: string, value?: number) => unknown;
  pageMarginsPreset?: (presetName?: string, presetAttributes?: Record<string, number>) => unknown;
  printOptions?: (attributeName: string, attributeEnabled?: boolean) => unknown;
  range?: (address: string) => unknown;
  row?: (rowNumber: number) => XlsxRow;
};
type OfficialPdfChoices = {
  fob: string;
  materialCert: string;
  printArea: string;
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
    printAreaEndColumn: 'P',
    printAreaEndRow: 40,
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
    lineEndRow: 32,
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
    printAreaEndColumn: 'O',
    printAreaEndRow: 37,
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
  return `${Number(month)}/${Number(day)}/${year}`;
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
    cell.style?.({ fontSize: 8.5, shrinkToFit: false, verticalAlignment: 'top', wrapText: true });
  } catch {
    // Official template cells can reject style updates; the filled value is still useful.
  }
  return officialCountWrappedLines(wrappedValue);
}

function officialSetShrinkCellValue(cell: XlsxCell, value: unknown, maxChars = 100, fontSize = 7.6) {
  cell.value(cleanPdfText(value).slice(0, maxChars));
  try {
    cell.style?.({ fontSize, shrinkToFit: true, verticalAlignment: 'center', wrapText: false });
  } catch {
    // Template cells can reject style updates; the value should still export.
  }
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

  officialSetShrinkCellValue(sheet.cell(map.poNo), '', 40);
  officialSetShrinkCellValue(sheet.cell(map.poInitiator), textField(header, ['poInitiator']), 70);
  officialSetShrinkCellValue(sheet.cell(map.shipVia), textField(header, ['shipVia']), 40);
  officialSetShrinkCellValue(sheet.cell(map.poClass), textField(header, ['poClass']), 40);
  officialSetCellValue(sheet, map.reqDate, officialParseDateInput(textField(header, ['requestDate','reqDate'])));
  officialSetShrinkCellValue(sheet.cell(map.vendorName), textField(header, ['vendorName'], vendor), 90);
  officialSetShrinkCellValue(sheet.cell(map.vendorAddressLine1), vendorAddressLine1, 100);
  officialSetShrinkCellValue(sheet.cell(map.vendorAddressLine2), vendorAddressLine2, 100);
  officialSetShrinkCellValue(sheet.cell(map.confirmedWith), textField(header, ['confirmedWith']), 70);
  officialSetShrinkCellValue(sheet.cell(map.assetNo), textField(header, ['assetNo']), 50);
  officialSetShrinkCellValue(sheet.cell(map.moldNo), textField(header, ['moldNo']), 40);
  officialSetShrinkCellValue(sheet.cell(map.equipmentNo), textField(header, ['equipmentNo']), 50);
  officialSetShrinkCellValue(sheet.cell(map.partNo), textField(header, ['partNo']), 40);
  officialSetShrinkCellValue(sheet.cell(map.jobNo), textField(header, ['jobNo']), 40);
  officialSetShrinkCellValue(sheet.cell(map.initials), textField(header, ['initials']), 12);
  officialSetShrinkCellValue(sheet.cell(map.tsNo), textField(header, ['tsNo']), 30);
  officialSetShrinkCellValue(sheet.cell(map.codeNo), textField(header, ['codeNo']), 30);
  officialSetShrinkCellValue(sheet.cell(map.workOrderNo), textField(header, ['workOrderNo']), 70);
  officialSetWrappedCellValue(sheet.cell(map.comments), officialComments(header, notes), 72, 2);
  officialSetShrinkCellValue(sheet.cell(map.departmentManager), textField(header, ['departmentManager']), 70);
  officialSetShrinkCellValue(sheet.cell(map.requisitionedBy), textField(header, ['requisitionedBy'], requestedBy), 70);
  officialSetShrinkCellValue(sheet.cell(map.authorizedBy), textField(header, ['authorizedBy']), 70);
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
  const itemNumberLines = officialSetWrappedCellValue(itemNumberCell, item.supplierPartNumber || item.partNumber || '', 18, 2);
  const descriptionLines = officialSetWrappedCellValue(descriptionCell, officialLineDescription(item), 50, 3);
  officialSetCellValue(sheet, dueDateCell, officialParseDateInput(item.dueDate ?? ''));

  if (typeof unitPriceCell.formula === 'function') unitPriceCell.formula(undefined);
  if (typeof totalPriceCell.formula === 'function') totalPriceCell.formula(undefined);
  unitPriceCell.value(unitPrice);
  totalPriceCell.value(quantity * unitPrice);

  try {
    const lineCount = Math.max(itemNumberLines, descriptionLines);
    sheet.row?.(row).height?.(Math.min(50, 22 + (lineCount - 1) * 12));
  } catch {
    // Keep export moving if row-height changes are rejected.
  }
  try {
    sheet.cell(quantityCell).style?.({ fontSize: 8.5, horizontalAlignment: 'center', shrinkToFit: true, verticalAlignment: 'center' });
    sheet.cell(unitCell).style?.({ fontSize: 8, horizontalAlignment: 'center', shrinkToFit: true, verticalAlignment: 'center' });
    sheet.cell(dueDateCell).style?.({ fontSize: 8, horizontalAlignment: 'center', shrinkToFit: true, verticalAlignment: 'center' });
    unitPriceCell.style?.({ fontSize: 8, horizontalAlignment: 'right', numberFormat: '$#,##0.00', shrinkToFit: true, verticalAlignment: 'center' });
    totalPriceCell.style?.({ fontSize: 8, horizontalAlignment: 'right', numberFormat: '$#,##0.00', shrinkToFit: true, verticalAlignment: 'center' });
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

function officialWorksheetChild(sheet: XlsxSheet, childName: string) {
  return sheet._node?.children?.find(child => child.name === childName);
}

function officialSetFitToPage(sheet: XlsxSheet) {
  const sheetPr = officialWorksheetChild(sheet, 'sheetPr') as { children?: Array<{ name: string; attributes?: Record<string, unknown>; children?: unknown[] }> } | undefined;
  if (!sheetPr) return;
  const children = sheetPr.children ?? [];
  let pageSetUpPr = children.find(child => child.name === 'pageSetUpPr');
  if (!pageSetUpPr) {
    pageSetUpPr = { name: 'pageSetUpPr', attributes: {}, children: [] };
    sheetPr.children = [...children, pageSetUpPr];
  }
  pageSetUpPr.attributes = { ...(pageSetUpPr.attributes ?? {}), fitToPage: 1 };
}

function officialSetSheetChildAttributes(sheet: XlsxSheet, childName: string, attributes: Record<string, unknown>) {
  const child = officialWorksheetChild(sheet, childName);
  if (!child) return;
  child.attributes = { ...(child.attributes ?? {}), ...attributes };
}

function officialSetPageSetup(sheet: XlsxSheet) {
  try {
    const pageSetup = officialWorksheetChild(sheet, 'pageSetup');
    if (!pageSetup) return;
    pageSetup.attributes = {
      ...(pageSetup.attributes ?? {}),
      paperSize: 1,
      orientation: 'landscape',
      fitToWidth: 1,
      fitToHeight: 1,
      horizontalDpi: 300,
      verticalDpi: 300,
      scale: undefined,
    };
    delete pageSetup.attributes.scale;
    officialSetSheetChildAttributes(sheet, 'pageMargins', { left: 0.25, right: 0.25, top: 0.25, bottom: 0.25, header: 0.1, footer: 0.12 });
    officialSetSheetChildAttributes(sheet, 'printOptions', { horizontalCentered: 1, verticalCentered: 0 });
    officialSetFitToPage(sheet);
  } catch {
    // Direct page-setup XML tuning is best-effort; Excel COM still applies the same settings during export.
  }
}

function officialSetPrintArea(sheet: XlsxSheet, map: OfficialTemplateCellMap) {
  const printRange = `A1:${map.printAreaEndColumn}${map.printAreaEndRow}`;
  try {
    const range = sheet.range?.(printRange) ?? printRange;
    sheet.definedName?.('_xlnm.Print_Area', range);
  } catch {
    // Excel COM receives the same print area during export if workbook-defined names are unavailable.
  }
}

function officialHideUnusedLineRows(sheet: XlsxSheet, map: OfficialTemplateCellMap, itemCount: number) {
  const templateRowCount = map.lineEndRow - map.lineStartRow + 1;
  const visibleRowCount = Math.max(1, Math.min(itemCount, templateRowCount));
  const firstHiddenRow = map.lineStartRow + visibleRowCount;
  for (let row = map.lineStartRow; row <= map.lineEndRow; row += 1) {
    try {
      sheet.row?.(row).hidden?.(row >= firstHiddenRow);
    } catch {
      // Hidden rows are layout polish only; cleared unused cells still prevent stale printed data.
    }
  }
}

function officialApplyWorkbookLayout(sheet: XlsxSheet, type: RequisitionTemplateKind) {
  try {
    sheet.pageMarginsPreset?.('mcc-letter-safe', { left: 0.25, right: 0.25, top: 0.25, bottom: 0.25, header: 0.1, footer: 0.12 });
    sheet.printOptions?.('horizontalCentered', true);
    sheet.printOptions?.('verticalCentered', false);
  } catch {
    // Margin/print options are layout polish only; keep generation moving.
  }
  officialSetPageSetup(sheet);

  if (type === 'under-100') {
    officialSetColumnWidth(sheet, 'A', 5.8);
    officialSetColumnWidth(sheet, 'B', 15.4);
    officialSetColumnWidth(sheet, 'C', 14.8);
    officialSetColumnWidth(sheet, 'D', 9.8);
    officialSetColumnWidth(sheet, 'E', 9.8);
    officialSetColumnWidth(sheet, 'F', 11.8);
    officialSetColumnWidth(sheet, 'G', 9.8);
    officialSetColumnWidth(sheet, 'H', 9.8);
    officialSetColumnWidth(sheet, 'I', 9.4);
    officialSetColumnWidth(sheet, 'J', 6.8);
    officialSetColumnWidth(sheet, 'K', 6.8);
    officialSetColumnWidth(sheet, 'L', 9.4);
    officialSetColumnWidth(sheet, 'M', 9.4);
    officialSetColumnWidth(sheet, 'N', 7.4);
    officialSetColumnWidth(sheet, 'O', 2.4);
  } else {
    officialSetColumnWidth(sheet, 'B', 6.2);
    officialSetColumnWidth(sheet, 'C', 13.2);
    officialSetColumnWidth(sheet, 'D', 17.2);
    officialSetColumnWidth(sheet, 'E', 8.2);
    officialSetColumnWidth(sheet, 'F', 7.2);
    officialSetColumnWidth(sheet, 'G', 11.4);
    officialSetColumnWidth(sheet, 'H', 9.4);
    officialSetColumnWidth(sheet, 'I', 9.4);
    officialSetColumnWidth(sheet, 'J', 3.8);
    officialSetColumnWidth(sheet, 'K', 6.2);
    officialSetColumnWidth(sheet, 'L', 7.2);
    officialSetColumnWidth(sheet, 'M', 9.3);
    officialSetColumnWidth(sheet, 'N', 6.1);
    officialSetColumnWidth(sheet, 'O', 8.6);
    officialSetColumnWidth(sheet, 'P', 2.4);
  }
}

function officialStyleStaticLabel(sheet: XlsxSheet, address: string, fontSize = 8) {
  try {
    sheet.cell(address).style?.({ fontSize, shrinkToFit: true, verticalAlignment: 'center', wrapText: false });
  } catch {
    // Static template label tuning only.
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
  if (type === 'under-100') {
    officialStyleStaticLabel(sheet, 'F12', 7.5);
    officialStyleStaticLabel(sheet, 'B13', 7);
    officialStyleStaticLabel(sheet, 'B14', 7);
    officialStyleStaticLabel(sheet, 'B18', 8);
    officialStyleStaticLabel(sheet, 'F18', 7.5);
    return;
  }
  officialStyleStaticLabel(sheet, 'C14', 6.8);
  officialStyleStaticLabel(sheet, 'C15', 6.8);
  officialStyleStaticLabel(sheet, 'G13', 7.4);
  officialStyleStaticLabel(sheet, 'C19', 7.6);
  officialStyleStaticLabel(sheet, 'E19', 7.4);
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
  // Fill the workbook template instead of redrawing price fields by PDF coordinates.
  const workbook = await XlsxPopulate.fromFileAsync(map.templatePath);
  const sheet = workbook.sheet(0) as XlsxSheet;
  officialApplyWorkbookLayout(sheet, input.type);
  officialWriteHeader(sheet, map.header, input);
  officialAdjustHeaderSpacing(sheet, input.type);
  officialWriteLineItems(sheet, map, input.items);
  officialHideUnusedLineRows(sheet, map, input.items.length);
  officialWriteGrandTotal(sheet, map.grandTotal, input.total);
  officialSetPrintArea(sheet, map);
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
  [string]$PrintArea = "",
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
    if ($PrintArea.Trim()) { $worksheet.PageSetup.PrintArea = $PrintArea.Trim() }
    $worksheet.PageSetup.PaperSize = 1
    $worksheet.PageSetup.Orientation = 2
    $worksheet.PageSetup.Zoom = $false
    $worksheet.PageSetup.FitToPagesWide = 1
    $worksheet.PageSetup.FitToPagesTall = 1
    $worksheet.PageSetup.CenterHorizontally = $true
    $worksheet.PageSetup.CenterVertically = $false
    $worksheet.PageSetup.LeftMargin = $excel.InchesToPoints(0.25)
    $worksheet.PageSetup.RightMargin = $excel.InchesToPoints(0.25)
    $worksheet.PageSetup.TopMargin = $excel.InchesToPoints(0.25)
    $worksheet.PageSetup.BottomMargin = $excel.InchesToPoints(0.25)
    $worksheet.PageSetup.HeaderMargin = $excel.InchesToPoints(0.10)
    $worksheet.PageSetup.FooterMargin = $excel.InchesToPoints(0.12)
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
  const output = spawnSync('powershell.exe', ['-NoProfile','-ExecutionPolicy','Bypass','-File',scriptPath,'-XlsxPath',xlsxPath,'-PdfPath',pdfPath,'-PrintArea',choices.printArea,'-TaxExempt',choices.taxExempt,'-MaterialCert',choices.materialCert,'-Fob',choices.fob], {
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
      throw new Error('Official requisition PDF export failed. Microsoft Excel or LibreOffice could not convert the official workbook template.');
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
    page.drawRectangle({ x: width - 142, y: 0, width: 134, height: 34, color: pdfWhite });
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
  const printArea = `A1:${officialTemplateMaps[type].printAreaEndColumn}${officialTemplateMaps[type].printAreaEndRow}`;
  const choices = {
    fob: textField(header, ['fob'], 'Destination'),
    materialCert: textField(header, ['materialCert','material_cert'], 'No'),
    printArea,
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
  // The workbook templates include placeholder prices ($0.00 / $ -).
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
  // The workbook templates already include table headers. Keep normal output clean.
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
  const userComments = cleanPdfText(requisition.notes ?? '');
  const requisitionedByName = requisition.requisitioned_by_name || requisition.requested_by_name;
  return buildRequisitionPdf({
    vendor: vendorName,
    requisitionNumber: requisition.requisition_number,
    requestedBy: requisitionedByName,
    createdAt: requisition.requested_at,
    notes: userComments,
    header: {
      poNo: '',
      requestDate: localDateOnly(),
      vendorName,
      poInitiator: requisition.po_initiator,
      shipVia: requisition.ship_via,
      confirmedWith: requisition.confirmed_with,
      workOrderNo: requisition.work_order_number,
      comments: userComments,
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
function createRequisitionsFromStaging(req: AuthRequest, actor: User, input: Record<string, unknown>) {
  const rawIds = Array.isArray(input.stagingItemIds) ? input.stagingItemIds : [];
  const stagingIds = uniquePositiveIds(rawIds.map(value=>Number(value)));
  if (!stagingIds.length) throw new Error('Select at least one staged item.');
  const placeholders = stagingIds.map(()=>'?').join(',');
  const rows = all<RequisitionStagingRow>(`SELECT * FROM requisition_staging_items WHERE id IN (${placeholders}) ORDER BY id`, stagingIds);
  if (rows.length !== stagingIds.length) throw new Error('One or more staged items were not found.');
  for (const row of rows) {
    if (!['Need to Order','Ready for Requisition'].includes(row.status)) throw new Error(`${row.part_number} is no longer available for requisition creation.`);
    if (row.inventory_part_id && activeRequisitionCountForPart(row.inventory_part_id) > 0) throw new Error(`Active requisition already exists for ${row.part_number}.`);
  }
  const header = parseRequisitionHeaderInput(input, actor, { requirePreviewFields: true });
  const timestamp = now();
  const groups = new Map<string, RequisitionStagingRow[]>();
  for (const row of rows) {
    const key = requisitionVendorKey(row.vendor_name);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const createdIds: number[] = [];
  for (const groupRows of groups.values()) {
    const first = groupRows[0];
    const requisitionNumber = requisitionNumberForTimestamp(timestamp);
    const totalQuantity = groupRows.reduce((sum,row)=>sum + Number(row.quantity_requested),0);
    const requisitionWorkOrder = header.workOrderNumber || summaryText(groupRows.map(row=>row.work_order_number), first.work_order_number);
    const headerLocation = summaryText(groupRows.map(row=>row.location_name), first.location_name);
    const result = run(`INSERT INTO inventory_requisitions (requisition_number,inventory_part_id,part_number,description,vendor_name,location_name,quantity_requested,unit_cost,status,requested_by_user_id,requested_by_name,po_initiator,requisitioned_by_name,tax_exempt,confirmed_with,material_cert,ship_via,fob,requested_at,work_order_number,notes,created_at,updated_at,deleted) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`, [
      requisitionNumber,first.inventory_part_id ?? 0,first.part_number,first.description,requisitionVendorName(first.vendor_name),headerLocation,totalQuantity,Number(first.unit_cost ?? 0),'Requested',actor.id,actor.full_name,header.poInitiator,header.requisitionedByName,header.taxExempt,header.confirmedWith,header.materialCert,header.shipVia,header.fob,timestamp,requisitionWorkOrder,header.notes,timestamp,timestamp,
    ]);
    const requisitionId = Number(result.lastInsertRowid);
    createdIds.push(requisitionId);
    for (const row of groupRows) {
      run(`INSERT INTO inventory_requisition_lines (requisition_id,inventory_part_id,part_number,description,vendor_name,location_name,quantity_requested,unit_cost,unit_of_measure,item_number,notes,created_at,updated_at,deleted) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0)`, [
        requisitionId,row.inventory_part_id ?? 0,row.part_number,row.description,row.vendor_name,row.location_name,row.quantity_requested,row.unit_cost,'EA',row.supplier_part_number || row.part_number,row.notes,timestamp,timestamp,
      ]);
      run('DELETE FROM requisition_staging_items WHERE id=?', [row.id]);
    }
    const historyRow = requisitionById(requisitionId, { includeDeleted: true });
    if (historyRow) recordRequisitionHistory({action:'requested_from_staging',actor,row:historyRow,newValue:requisitionHistoryValue(historyRow),createdAt:timestamp});
    const details = {requisitionNumber,requisitionId,stagingItemIds:groupRows.map(row=>row.id),vendorName:first.vendor_name,lineCount:groupRows.length};
    inventoryAudit(req,'requisition created from staged items','requisition',requisitionId,details);
    audit(req,'requisition created from staged items','requisition',requisitionId,details);
  }
  syncRequisitionPartFlags(rows.map(row=>row.inventory_part_id).filter((id): id is number=>Boolean(id)),timestamp);
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
  const status = /not found/i.test(message) ? 404 : /already exists/i.test(message) ? 409 : /must|requires|required|unsupported|only|cannot/i.test(message) ? 400 : 500;
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
  if (response.status === 404 || response.status === 405) throw new Error('Retired inventory bridge write endpoint is not available.');
  if (!response.ok) {
    const body = await response.json().catch(async () => ({error: await response.text().catch(() => '')}));
    const message = isRecord(body) ? textField(body, ['error', 'message'], `HTTP ${response.status}`) : `HTTP ${response.status}`;
    throw new Error(message || 'Retired inventory bridge write failed.');
  }
  return response.json().catch(() => ({}));
}
function canInventoryWrite(actor: User) {
  return roleRank(actor.role) >= roleRank('Maintenance Tech 2');
}
function canInventoryImport(actor: User) {
  return roleRank(actor.role) >= roleRank('Maintenance Tech 3');
}
function canViewHistory(actor: User) {
  return actor.role === 'Admin' || actor.role === 'Manager';
}
function canExportHistory(actor: User) {
  return actor.role === 'Admin' || actor.role === 'Manager';
}
function isOwnerAdmin(actor: User) {
  return Boolean(actor.is_owner_admin);
}
function canViewBackupCategory(actor: User, category: BackupCategory) {
  if (isOwnerAdmin(actor)) return true;
  if (category === 'daily') return roleRank(actor.role) >= roleRank('Maintenance Tech 3');
  if (category === 'weekly') return roleRank(actor.role) >= roleRank('Manager');
  return actor.role === 'Admin';
}
function canCreateBackupCategory(actor: User, category: BackupCategory) {
  if (category === 'legacy') return false;
  if (isOwnerAdmin(actor)) return true;
  if (category === 'daily') return roleRank(actor.role) >= roleRank('Maintenance Tech 3');
  if (category === 'weekly') return roleRank(actor.role) >= roleRank('Manager');
  return actor.role === 'Admin';
}
function canRestoreBackupCategory(actor: User, category: BackupCategory) {
  if (isOwnerAdmin(actor)) return true;
  if (category === 'daily') return roleRank(actor.role) >= roleRank('Manager');
  if (category === 'weekly') return roleRank(actor.role) >= roleRank('Manager');
  return actor.role === 'Admin';
}
function canViewMasterBackups(actor: User) {
  return canViewBackupCategory(actor, 'master');
}
function canCreateMasterBackups(actor: User) {
  return canCreateBackupCategory(actor, 'master');
}
function canRestoreMasterBackups(actor: User) {
  return canRestoreBackupCategory(actor, 'master');
}
type ResetSection =
  | 'inventory'
  | 'requisitions'
  | 'history_inventory'
  | 'history_requisitions'
  | 'history_machine_library'
  | 'history_equipment_library'
  | 'history_facility_info'
  | 'history_preventive_maintenance'
  | 'history_settings'
  | 'history_section'
  | 'machine_library'
  | 'equipment_library'
  | 'facility_info'
  | 'preventive_maintenance';
type ResetRequest = { section: ResetSection; reasonNote: string; confirmation: string; options: Record<string, unknown> };
const resetConfirmations: Record<Exclude<ResetSection, 'history_section'>, string> = {
  inventory: 'RESET INVENTORY',
  requisitions: 'RESET REQUISITIONS',
  history_inventory: 'RESET HISTORY',
  history_requisitions: 'RESET HISTORY',
  history_machine_library: 'RESET HISTORY',
  history_equipment_library: 'RESET HISTORY',
  history_facility_info: 'RESET HISTORY',
  history_preventive_maintenance: 'RESET HISTORY',
  history_settings: 'RESET HISTORY',
  machine_library: 'RESET MACHINE LIBRARY',
  equipment_library: 'RESET EQUIPMENT LIBRARY',
  facility_info: 'RESET FACILITY INFO',
  preventive_maintenance: 'RESET PM',
};
const sectionLabels: Record<Exclude<ResetSection, 'history_section'>, string> = {
  inventory: 'Inventory data',
  requisitions: 'Requisitions data',
  history_inventory: 'Inventory history logs',
  history_requisitions: 'Requisition history logs',
  history_machine_library: 'Machine Library history logs',
  history_equipment_library: 'Equipment Library history logs',
  history_facility_info: 'Facility Info history logs',
  history_preventive_maintenance: 'Preventive Maintenance history logs',
  history_settings: 'Settings / System history logs',
  machine_library: 'Machine Library data',
  equipment_library: 'Equipment Library data',
  facility_info: 'Facility Info data',
  preventive_maintenance: 'Preventive Maintenance data',
};
const resetSections = new Set<ResetSection>([
  'inventory',
  'requisitions',
  'history_inventory',
  'history_requisitions',
  'history_machine_library',
  'history_equipment_library',
  'history_facility_info',
  'history_preventive_maintenance',
  'history_settings',
  'history_section',
  'machine_library',
  'equipment_library',
  'facility_info',
  'preventive_maintenance',
]);
const resetTableAllowlists: Record<'machine_library' | 'equipment_library' | 'facility_info' | 'preventive_maintenance', string[]> = {
  machine_library: ['machine_assets','machine_brand_settings','machines','machine_library','machine_pms'],
  equipment_library: ['equipment_assets','equipment','equipment_library','equipment_pms'],
  facility_info: ['facility_documents','facility_info','building_prints','facility_pms'],
  preventive_maintenance: ['pm_tasks','pm_history','preventive_maintenance'],
};
const resetHistorySectionByReset: Partial<Record<ResetSection, HistorySection>> = {
  history_inventory: 'inventory',
  history_requisitions: 'requisitions',
  history_machine_library: 'machine_library',
  history_equipment_library: 'equipment_library',
  history_facility_info: 'facility_info',
  history_preventive_maintenance: 'preventive_maintenance',
  history_settings: 'settings',
};
function tableExists(tableName: string) {
  if (!/^[A-Za-z0-9_]+$/.test(tableName)) return false;
  return Boolean(one<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [tableName]));
}
function rowCount(tableName: string, where = '', params: SqlParam[] = []) {
  if (!tableExists(tableName)) return 0;
  return one<{ count: number }>(`SELECT COUNT(*) AS count FROM ${tableName}${where}`, params)?.count ?? 0;
}
function deleteRows(tableName: string, where = '', params: SqlParam[] = []) {
  if (!tableExists(tableName)) return 0;
  const before = rowCount(tableName, where, params);
  run(`DELETE FROM ${tableName}${where}`, params);
  return before;
}
function resetSqliteSequence(tableName: string) {
  if (tableExists('sqlite_sequence')) run('DELETE FROM sqlite_sequence WHERE name=?', [tableName]);
}
function resetStatusCounts() {
  const historyCounts = Object.fromEntries(historySections.map(section=>[section, rowCount('history_logs',' WHERE section=?', [section])]));
  const futureTableCounts = Object.fromEntries(Object.entries(resetTableAllowlists).map(([section,tables])=>[
    section,
    Object.fromEntries(tables.map(table=>[table, tableExists(table) ? rowCount(table) : null])),
  ]));
  return {
    ok: true,
    counts: {
      inventoryParts: rowCount('inventory_parts'),
      inventoryVendors: rowCount('inventory_vendors'),
      inventoryLocations: rowCount('inventory_locations'),
      requisitions: rowCount('inventory_requisitions'),
      requisitionLines: rowCount('inventory_requisition_lines'),
      requisitionStagingItems: rowCount('requisition_staging_items'),
      historyCounts,
      futureTableCounts,
    },
  };
}
function validateResetRequest(body: unknown): ResetRequest {
  const input = isRecord(body) ? body : {};
  const section = String(input.section ?? '').trim() as ResetSection;
  if (!resetSections.has(section)) throw new Error('Reset section is invalid.');
  const options = isRecord(input.options) ? input.options : {};
  const confirmation = String(input.confirmation ?? '').trim();
  const reasonNote = requiredReasonNote(input.reasonNote, 'Reset');
  const expectedConfirmation = section === 'history_section' ? 'RESET HISTORY' : resetConfirmations[section];
  if (confirmation !== expectedConfirmation) throw new Error(`Type ${expectedConfirmation} to confirm reset.`);
  return { section, reasonNote, confirmation, options };
}
function resetTableGroup(section: keyof typeof resetTableAllowlists, deletedCounts: Record<string, number>) {
  let existingTableCount = 0;
  for (const tableName of resetTableAllowlists[section]) {
    if (!tableExists(tableName)) continue;
    existingTableCount += 1;
    deletedCounts[tableName] = deleteRows(tableName);
    resetSqliteSequence(tableName);
  }
  return existingTableCount;
}
function resetRequisitionsData(deletedCounts: Record<string, number>) {
  deletedCounts.requisitionStagingItems = deleteRows('requisition_staging_items');
  deletedCounts.inventoryRequisitionLines = deleteRows('inventory_requisition_lines');
  deletedCounts.inventoryRequisitions = deleteRows('inventory_requisitions');
  if (tableExists('inventory_parts')) run("UPDATE inventory_parts SET requisition='', updated_at=? WHERE requisition<>''", [now()]);
  resetSqliteSequence('requisition_staging_items');
  resetSqliteSequence('inventory_requisition_lines');
  resetSqliteSequence('inventory_requisitions');
}
function deleteNativeInventoryBackupFiles() {
  if (!fs.existsSync(backupsDir)) return 0;
  let deleted = 0;
  for (const fileName of fs.readdirSync(backupsDir)) {
    if (!/^MCC_Native_Inventory_Backup_.+\.(json|csv)$/i.test(fileName)) continue;
    const resolved = path.resolve(backupsDir, fileName);
    if (path.dirname(resolved) !== path.resolve(backupsDir)) continue;
    fs.rmSync(resolved, { force: true });
    deleted += 1;
  }
  return deleted;
}
function historySectionForReset(request: ResetRequest): HistorySection {
  if (request.section === 'history_section') {
    const selected = historySectionFromValue(request.options.historySection);
    if (!selected) throw new Error('History section is required.');
    return selected;
  }
  const selected = resetHistorySectionByReset[request.section];
  if (!selected) throw new Error('History reset section is invalid.');
  return selected;
}
function performReset(req: AuthRequest, request: ResetRequest) {
  const actor = req.user!;
  const preResetBackup = createMasterBackup({ type: 'manual', actor, notes: `Pre-reset backup before ${request.section}: ${request.reasonNote}` });
  const verified = verifyMasterBackup(preResetBackup.id);
  if (!verified.ok) throw new Error('Pre-reset backup could not be verified.');
  const deletedCounts: Record<string, number> = {};
  let message = `${sectionLabels[request.section === 'history_section' ? 'history_settings' : request.section]} reset complete.`;
  const timestamp = now();
  db.exec('BEGIN IMMEDIATE');
  try {
    if (request.section === 'inventory') {
      deletedCounts.inventoryParts = deleteRows('inventory_parts');
      resetSqliteSequence('inventory_parts');
      if (request.options.includeVendorsLocations === true) {
        deletedCounts.inventoryVendors = deleteRows('inventory_vendors');
        deletedCounts.inventoryLocations = deleteRows('inventory_locations');
        resetSqliteSequence('inventory_vendors');
        resetSqliteSequence('inventory_locations');
      }
      if (request.options.includeLinkedRequisitions === true) resetRequisitionsData(deletedCounts);
      message = 'Inventory data reset complete.';
    } else if (request.section === 'requisitions') {
      resetRequisitionsData(deletedCounts);
      message = 'Requisitions data reset complete.';
    } else if (request.section.startsWith('history_')) {
      const historySection = historySectionForReset(request);
      deletedCounts.historyLogs = deleteRows('history_logs',' WHERE section=?', [historySection]);
      message = `${historySectionLabels[historySection]} history logs reset complete.`;
    } else {
      const dataSection = request.section as keyof typeof resetTableAllowlists;
      const existingTableCount = resetTableGroup(dataSection, deletedCounts);
      if (request.options.includeHistory === true) {
        deletedCounts.historyLogs = deleteRows('history_logs',' WHERE section=?', [dataSection]);
      }
      if (existingTableCount === 0) {
        message = `No ${sectionLabels[dataSection]} table exists yet.`;
      } else {
        message = `${sectionLabels[dataSection]} reset complete.`;
      }
    }
    recordHistoryLog({
      section: 'settings',
      action: `reset_${request.section}`,
      entityType: 'admin_reset',
      entityLabel: sectionLabels[request.section === 'history_section' ? 'history_settings' : request.section],
      reasonNote: request.reasonNote,
      newValue: { deletedCounts, preResetBackupId: preResetBackup.id, options: request.options },
      actor,
      createdAt: timestamp,
    });
    audit(req, `reset ${request.section}`, 'admin_reset', request.section, { deletedCounts, preResetBackupId: preResetBackup.id });
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  if (request.section === 'inventory' && request.options.includeInventoryBackups === true) {
    try {
      deletedCounts.inventoryBackupFiles = deleteNativeInventoryBackupFiles();
    } catch (error) {
      deletedCounts.inventoryBackupFiles = 0;
      message += ' Inventory backup list files were not removed.';
      console.log(`MCC inventory backup file cleanup failed: ${safeErrorMessage(error)}`);
    }
  }
  return { ok: true, section: request.section, deletedCounts, preResetBackup, message, status: resetStatusCounts() };
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
type MeasurementPdfMode = 'filled' | 'blank';
type MeasurementPdfTarget = { assetNumber: string; brand: string; model: string; serialNumber: string; machineYear: string; setup: string };
const measurementPdfComponentLabels: Record<string, string> = { screw: 'Screw', barrel: 'Barrel', tip: 'Tip', plunger: 'Plunger', screw_2: 'Unit 2 Screw', barrel_2: 'Unit 2 Barrel', tip_2: 'Unit 2 Tip' };
const measurementPdfFieldLabels: Record<string, string> = {
  oldNew: 'OLD / NEW',
  dateMeasured: 'Date Measured',
  dateInstalled: 'Date Installed',
  inspectorName: 'Inspector Name',
  comments: 'Comments',
  reasonForPull: 'Reason for Pull',
  screwSerialNumber: 'Screw Serial #',
  screwPartNumber: 'Screw Part #',
  ldRatio: 'L/D',
  compressionRatio: 'Compression Ratio',
  screwOverallLength: 'Screw Overall Length',
  screwOverallLengthWithTip: 'Screw Overall Length With Tip',
  screwLength: 'Screw Length',
  flightSectionLength: 'Flight Section Length',
  leadGapMeasurement: 'Lead Gap Measurement',
  splineCheck: 'Spline Check',
  splineNotes: 'Spline Notes',
  screwComments: 'Screw Comments',
  barrelPartNumber: 'Barrel Part #',
  oemBarrelBore: 'OEM Barrel Bore',
  barrelLength: 'Barrel Length',
  barrelBoreScrewDiameter: 'Barrel Bore / Screw Diameter',
  barrelNotes: 'Barrel Notes',
  barrelComments: 'Barrel Comments',
  tipMfg: 'Tip MFG',
  tipPartNumber: 'Tip Part #',
  tipType: 'Tip Type',
  checkRingDia: 'Check Ring Dia',
  seatCondition: 'Seat Condition',
  tipThreadInspection: 'Tip Thread Inspection',
  tipThreadNotes: 'Tip Thread Notes',
  checkRingDiameter: 'Check Ring Diameter',
  tipDiameter: 'Tip Diameter',
  tipLength: 'Tip Length',
  seatMeasurement: 'Seat Measurement',
  tipComments: 'Tip Comments',
  plungerType: 'Plunger Type',
  plungerDiameter: 'Plunger Diameter',
  plungerLength: 'Plunger Length',
  plungerOverallLength: 'Plunger Overall Length',
  plungerRebuildRepaired: 'Plunger Rebuild / Repaired',
  plungerCondition: 'Plunger Condition',
  plungerNotes: 'Plunger Notes',
  plungerComments: 'Plunger Comments',
  plungerBarrelType: 'Plunger Barrel Type',
  cylinderBarrelBore: 'Cylinder Barrel Bore',
  cylinderBarrelLength: 'Cylinder Barrel Length',
  cylinderBarrelNotes: 'Cylinder Barrel Notes',
};
const measurementPdfScrewSectionLabels: Record<string, string> = { metering: 'Metering', transition: 'Transition', feed: 'Feed' };
const measurementPdfScrewKindLabels: Record<string, string> = { flight: 'Flight', root: 'Root' };
function measurementPdfMode(body: Record<string, unknown>): MeasurementPdfMode {
  return String(body.mode ?? '').toLowerCase() === 'blank' ? 'blank' : 'filled';
}
function measurementPdfTarget(body: Record<string, unknown>): MeasurementPdfTarget {
  const target = isRecord(body.target) ? body.target : {};
  const hasDouble = Boolean(target.hasDoubleShotInjection);
  const hasPlunger = Boolean(target.hasPlungerInjection);
  const setup = hasDouble && hasPlunger ? 'Double Shot + Plunger' : hasDouble ? 'Double Shot' : hasPlunger ? 'Plunger' : 'Standard Injection';
  return {
    assetNumber: cleanPdfText(target.assetNumber) || 'Machine Asset',
    brand: cleanPdfText(target.brand),
    model: cleanPdfText(target.model),
    serialNumber: cleanPdfText(target.serialNumber),
    machineYear: cleanPdfText(target.machineYear),
    setup,
  };
}
function measurementPdfComponents(body: Record<string, unknown>) {
  const raw = Array.isArray(body.components) ? body.components.map(value=>cleanPdfText(value)) : [];
  const allowed = new Set(Object.keys(measurementPdfComponentLabels));
  const components = raw.filter(component=>allowed.has(component));
  return components.length ? [...new Set(components)] : ['screw','barrel','tip'];
}
function measurementPdfLabel(key: string) {
  if (measurementPdfFieldLabels[key]) return measurementPdfFieldLabels[key];
  return key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').replace(/\b\w/g, letter=>letter.toUpperCase()).trim();
}
function measurementPdfValue(value: unknown) {
  if (!isRecord(value)) return cleanPdfText(value);
  const raw = cleanPdfText(value.rawInput);
  const inches = typeof value.valueInches === 'number' && Number.isFinite(value.valueInches) ? `${value.valueInches.toFixed(3)} in` : '';
  const mm = typeof value.valueMm === 'number' && Number.isFinite(value.valueMm) ? `${value.valueMm.toFixed(2)} mm` : '';
  const converted = [inches,mm].filter(Boolean).join(' / ');
  return [raw,converted].filter(Boolean).join(' | ');
}
function measurementPdfSmallest(values: unknown[]) {
  const parsed = values.filter(isRecord).map(value=>value.value).filter(isRecord).filter(value=>typeof value.valueInches === 'number' && Number.isFinite(value.valueInches));
  if (!parsed.length) return '';
  const smallest = parsed.reduce((current,value)=>Number(value.valueInches) < Number(current.valueInches) ? value : current);
  return measurementPdfValue(smallest);
}
function measurementPdfScrewReadingEntries(record: Record<string, unknown>) {
  const readings = isRecord(record.screwReadings) ? record.screwReadings : {};
  const entries: Array<{ label: string; value: string }> = [];
  for (const kind of ['flight','root']) {
    const kindRecord = isRecord(readings[kind]) ? readings[kind] : {};
    for (const section of ['feed','transition','metering']) {
      const sectionReadings = Array.isArray(kindRecord[section]) ? kindRecord[section] as unknown[] : [];
      entries.push({ label: `${measurementPdfScrewKindLabels[kind]} ${measurementPdfScrewSectionLabels[section]} Smallest Dia`, value: measurementPdfSmallest(sectionReadings) || 'No readings' });
      sectionReadings.filter(isRecord).forEach((reading,index)=>{
        const label = cleanPdfText(reading.label) || `Point ${index + 1}`;
        const value = measurementPdfValue(reading.value);
        const notes = cleanPdfText(reading.notes);
        entries.push({ label: `${measurementPdfScrewKindLabels[kind]} ${measurementPdfScrewSectionLabels[section]} ${label}`, value: [value, notes && `Notes ${notes}`].filter(Boolean).join(' | ') });
      });
    }
  }
  return entries;
}
function measurementPdfReasonText(record: Record<string, unknown>) {
  const reasonRecord = isRecord(record.reasonForPull) ? record.reasonForPull : {};
  const selected = Object.entries(reasonRecord).filter(([,value])=>Boolean(value)).map(([key])=>key);
  const other = cleanPdfText(record.reasonForPullOther);
  return selected.map(reason=>reason === 'Other' && other ? `Other: ${other}` : reason).join(', ');
}
function measurementPdfRecordEntries(record: Record<string, unknown>) {
  const entries: Array<{ label: string; value: string }> = [
    { label: measurementPdfLabel('oldNew'), value: cleanPdfText(record.oldNew).replace(/_/g, ' ') },
    { label: measurementPdfLabel('dateMeasured'), value: cleanPdfText(record.dateMeasured) },
    { label: measurementPdfLabel('dateInstalled'), value: cleanPdfText(record.dateInstalled) },
    { label: measurementPdfLabel('inspectorName'), value: cleanPdfText(record.inspectorName) },
  ];
  const reasons = measurementPdfReasonText(record);
  if (reasons) entries.push({ label: measurementPdfLabel('reasonForPull'), value: reasons });
  for (const groupKey of ['textFields','selectFields','measurements']) {
    const group = isRecord(record[groupKey]) ? record[groupKey] : {};
    for (const [key,value] of Object.entries(group)) {
      const text = groupKey === 'measurements' ? measurementPdfValue(value) : cleanPdfText(value);
      entries.push({ label: measurementPdfLabel(key), value: text });
    }
  }
  if (cleanPdfText(record.componentType) === 'screw' || cleanPdfText(record.componentType) === 'screw_2') entries.push(...measurementPdfScrewReadingEntries(record));
  const stations = Array.isArray(record.stations) ? record.stations.filter(isRecord) : [];
  stations.forEach((station,index)=>{
    const distance = measurementPdfValue(station.distance);
    const insideDiameter = measurementPdfValue(station.insideDiameter);
    const notes = cleanPdfText(station.notes);
    entries.push({ label: `Station ${index + 1}`, value: [distance && `Distance ${distance}`, insideDiameter && `ID ${insideDiameter}`, notes && `Notes ${notes}`].filter(Boolean).join(' | ') });
  });
  const comments = cleanPdfText(record.comments);
  if (comments) entries.push({ label: measurementPdfLabel('comments'), value: comments });
  return entries.filter(entry=>entry.value || entry.label);
}
function measurementPdfBlankEntries(component: string) {
  const common = ['Inspector Name','Date Measured','Date Installed','OLD / NEW','Comments'];
  const componentFields: Record<string, string[]> = {
    screw: ['Reason for Pull','Screw Serial #','Screw Part #','L/D','Compression Ratio','Screw Overall Length','Screw Overall Length With Tip','Screw Length','Flight Section Length','Lead Gap Measurement','Flight Feed Readings','Flight Transition Readings','Flight Metering Readings','Root Feed Readings','Root Transition Readings','Root Metering Readings','Flight Smallest Dia Summary','Root Smallest Dia Summary','Spline Check','Spline Notes','Screw Comments'],
    screw_2: ['Reason for Pull','Screw Serial #','Screw Part #','L/D','Compression Ratio','Screw Overall Length','Screw Overall Length With Tip','Screw Length','Flight Section Length','Lead Gap Measurement','Flight Feed Readings','Flight Transition Readings','Flight Metering Readings','Root Feed Readings','Root Transition Readings','Root Metering Readings','Flight Smallest Dia Summary','Root Smallest Dia Summary','Spline Check','Spline Notes','Screw Comments'],
    barrel: ['Barrel Part #','OEM Barrel Bore','Barrel Length','Barrel Bore / Screw Diameter','Station 1 Distance / ID','Station 2 Distance / ID','Station 3 Distance / ID','Station 4 Distance / ID','Station 5 Distance / ID','Station 6 Distance / ID','Barrel Notes','Barrel Comments'],
    barrel_2: ['Barrel Part #','OEM Barrel Bore','Barrel Length','Barrel Bore / Screw Diameter','Station 1 Distance / ID','Station 2 Distance / ID','Station 3 Distance / ID','Station 4 Distance / ID','Station 5 Distance / ID','Station 6 Distance / ID','Barrel Notes','Barrel Comments'],
    tip: ['Tip MFG','Tip Part #','Tip Type','Check Ring Dia','Seat Condition','Lead Gap Measurement','Tip Thread Check','Tip Thread Notes','Check Ring Diameter','Tip Diameter','Tip Length','Seat Measurement','Tip Comments'],
    tip_2: ['Tip MFG','Tip Part #','Tip Type','Check Ring Dia','Seat Condition','Lead Gap Measurement','Tip Thread Check','Tip Thread Notes','Check Ring Diameter','Tip Diameter','Tip Length','Seat Measurement','Tip Comments'],
    plunger: ['Plunger Type','Plunger Diameter','Plunger Length','Plunger Overall Length','Plunger Rebuild / Repaired','Plunger Condition','Plunger Barrel Type','Cylinder Barrel Bore','Cylinder Barrel Length','Station 1 Distance / ID','Station 2 Distance / ID','Station 3 Distance / ID','Station 4 Distance / ID','Plunger Notes','Cylinder Barrel Notes'],
  };
  return [...common,...(componentFields[component] ?? [])].map(label=>({label,value:''}));
}
async function buildMeasurementInspectionPdf(body: Record<string, unknown>, actor: User) {
  const mode = measurementPdfMode(body);
  const target = measurementPdfTarget(body);
  const components = measurementPdfComponents(body);
  const records = Array.isArray(body.records) ? body.records.filter(isRecord) : [];
  const recordsByComponent = new Map(records.map(record=>[cleanPdfText(record.componentType), record]));
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const width = 792;
  const height = 612;
  const margin = 30;
  const accent = rgb(0.02, 0.45, 0.72);
  const soft = rgb(0.92, 0.97, 1);
  const dark = rgb(0.05, 0.08, 0.12);
  const gray = rgb(0.35, 0.42, 0.48);
  const border = rgb(0.72, 0.82, 0.88);
  let page: PDFPage;
  let y = 0;
  let pageNumber = 0;
  const title = mode === 'blank' ? 'MCC Screw / Barrel / Tip Measurement Sheet - Blank' : 'MCC Measurement Inspection';
  const addPage = () => {
    page = pdf.addPage([width,height]);
    pageNumber += 1;
    page.drawRectangle({ x: 0, y: height - 62, width, height: 62, color: soft });
    page.drawRectangle({ x: 0, y: height - 62, width: 7, height: 62, color: accent });
    page.drawText(title, { x: margin, y: height - 34, size: 17, font: bold, color: dark });
    page.drawText(`Generated ${new Date().toLocaleString('en-US')} by ${actor.full_name}`, { x: margin, y: height - 51, size: 8, font: regular, color: gray });
    y = height - 86;
  };
  const ensure = (space: number) => {
    if (y - space < margin + 24) addPage();
  };
  const drawSectionHeader = (label: string) => {
    ensure(30);
    page.drawRectangle({ x: margin, y: y - 20, width: width - margin * 2, height: 22, color: accent });
    page.drawText(label, { x: margin + 8, y: y - 14, size: 10, font: bold, color: pdfWhite });
    y -= 30;
  };
  const drawEntry = (entry: { label: string; value: string }, x: number, boxWidth: number, rowY: number) => {
    page.drawRectangle({ x, y: rowY - 34, width: boxWidth, height: 34, borderColor: border, borderWidth: 0.6, color: rgb(0.985,0.995,1) });
    page.drawText(truncateToFit(entry.label, bold, 6.6, boxWidth - 10), { x: x + 5, y: rowY - 10, size: 6.6, font: bold, color: accent });
    const lines = wrapPdfText(entry.value, regular, 7.2, boxWidth - 10, 2);
    lines.forEach((line,index)=>page.drawText(line, { x: x + 5, y: rowY - 22 - index * 8, size: 7.2, font: regular, color: dark }));
  };
  const drawEntries = (entries: Array<{ label: string; value: string }>) => {
    const gap = 8;
    const boxWidth = (width - margin * 2 - gap) / 2;
    for (let index = 0; index < entries.length; index += 2) {
      ensure(42);
      const rowY = y;
      drawEntry(entries[index], margin, boxWidth, rowY);
      if (entries[index + 1]) drawEntry(entries[index + 1], margin + boxWidth + gap, boxWidth, rowY);
      y -= 42;
    }
  };
  addPage();
  drawSectionHeader('Machine');
  drawEntries([
    { label: 'Press #', value: target.assetNumber },
    { label: 'Brand', value: target.brand },
    { label: 'Model', value: target.model },
    { label: 'Serial #', value: target.serialNumber },
    { label: 'Machine Year / Age', value: target.machineYear },
    { label: 'Injection Setup', value: target.setup },
  ]);
  for (const component of components) {
    drawSectionHeader(measurementPdfComponentLabels[component] ?? component);
    const record = recordsByComponent.get(component);
    const entries = mode === 'blank' || !record ? measurementPdfBlankEntries(component) : measurementPdfRecordEntries(record);
    drawEntries(entries);
  }
  const pages = pdf.getPages();
  pages.forEach((pdfPage,index)=>pdfPage.drawText(`Page ${index + 1} of ${pages.length}`, { x: width - 88, y: 16, size: 8, font: regular, color: gray }));
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
  if (!match) throw new Error(`${label} "${value}" was not found. Use an existing ${label.toLowerCase()} or leave it blank.`);
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
  audit(req,'failed retired inventory bridge write attempt','inventory',targetId,{operation,error:message});
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

type MachineAssetStatus = 'active' | 'down' | 'disabled' | 'removed';
type MachineConditionStatus = 'new' | 'used' | 'worn' | 'rebuilt_repaired';
type MachineReplacementField = 'screw' | 'screw_tip' | 'barrel' | 'barrel_end_cap' | 'screw2' | 'screw2_tip' | 'barrel2' | 'barrel2_end_cap' | 'plunger' | 'plunger_barrel' | 'plunger_barrel_end_cap';
type MachineAssetRow = {
  id: number; asset_number: string; asset_name: string; brand: string; model: string; serial_number: string; machine_year: string; machine_type: string; power_type: string; shot_size_oz: number; tonnage: number; barrel_diameter: string; location: string; department: string; status: MachineAssetStatus; voltage_value: string; voltage_type: string; full_load_amp: string; machine_length: string; machine_width: string; machine_height: string; full_die_height_length: string; screw_type: string; screw_tip_type: string; screw_tip_installed_date: string; screw_installed_date: string; barrel_installed_date: string; barrel_end_cap_installed_date: string; barrel_length: string; screw_length: string; screw_rebuild_repaired: number; barrel_rebuild_repaired: number; screw_condition_status: MachineConditionStatus; barrel_condition_status: MachineConditionStatus; has_double_shot_injection: number; has_plunger_injection: number; screw2_type: string; screw2_tip_type: string; screw2_rebuild_repaired: number; screw2_condition_status: MachineConditionStatus; screw2_installed_date: string; screw2_tip_installed_date: string; screw2_length: string; barrel2_diameter: string; barrel2_rebuild_repaired: number; barrel2_condition_status: MachineConditionStatus; barrel2_installed_date: string; barrel2_end_cap_installed_date: string; barrel2_length: string; plunger_type: string; plunger_rebuild_repaired: number; plunger_condition_status: MachineConditionStatus; plunger_installed_date: string; plunger_length: string; plunger_diameter: string; plunger_barrel_type: string; plunger_barrel_rebuild_repaired: number; plunger_barrel_condition_status: MachineConditionStatus; plunger_barrel_installed_date: string; plunger_barrel_end_cap_installed_date: string; plunger_barrel_length: string; plunger_barrel_diameter: string; notes: string; critical_notes: string; created_at: string; updated_at: string; created_by_user_id: number | null; updated_by_user_id: number | null; deleted: number; deleted_at: string | null; deleted_by_user_id: number | null; brand_color_hex?: string | null;
};
const machineStatuses: MachineAssetStatus[] = ['active','down','disabled','removed'];
const machineConditionStatuses: MachineConditionStatus[] = ['new','used','worn','rebuilt_repaired'];
const voltageTypes = new Set(['AC','DC','']);
const machineRequiredDefaultBrandColors: Record<string, string> = { Toyo: '#1E6BFF', Engel: '#FFFFFF' };
const machineDefaultBrandColors: Record<string, string> = { ...machineRequiredDefaultBrandColors, Arburg: '#38D7B3', Husky: '#FFD45A', Sodick: '#8C7CFF', Default: '#44D7FF', Unknown: '#44D7FF' };
const machineRequiredImportHeaderGroups = [
  ['Press','Asset Number','Asset Number / Press Number'],
  ['Shot (oz)','Shot Size (oz)','Shot Size Oz','Shot'],
  ['Ton','Tonnage'],
  ['H&E','Power Type'],
  ['Mfg','Brand','Manufacturer'],
  ['Barrel','Barrel/Screw Diameter','Barrel Diameter'],
  ['Year','Machine Year'],
  ['Model #','Model','Model Number'],
  ['Equip Serial #','Serial Number','Equip Serial Number'],
] as const;
const machineImportHeaders = ['Asset Number','Brand','Model','Serial Number','Shot Size (oz)','Tonnage','Power Type','Barrel/Screw Diameter','Machine Year','Machine Type','Screw Type','Screw Tip Type','Screw Rebuild / Repaired','Screw Condition Status','Screw Installed Date','Screw Tip Installed Date','Screw Length','Barrel Rebuild / Repaired','Barrel Condition Status','Barrel Installed Date','Barrel End Cap Installed Date','Barrel Length','Machine Length','Machine Width','Machine Height','Full Die Height Length / Range','Notes','Critical Notes','Double Shot Injection','Plunger Injection','Screw 2 Type','Screw 2 Tip Type','Screw 2 Rebuild / Repaired','Screw 2 Condition Status','Screw 2 Installed Date','Screw 2 Tip Installed Date','Screw 2 Length','Barrel 2 Diameter','Barrel 2 Rebuild / Repaired','Barrel 2 Condition Status','Barrel 2 Installed Date','Barrel 2 End Cap Installed Date','Barrel 2 Length','Plunger Type','Plunger Rebuild / Repaired','Plunger Condition Status','Plunger Installed Date','Plunger Length','Plunger Diameter','Plunger Barrel Type','Plunger Barrel Rebuild / Repaired','Plunger Barrel Condition Status','Plunger Barrel Installed Date','Plunger Barrel End Cap Installed Date','Plunger Barrel Length','Plunger Barrel Diameter'] as const;
type MachineAssetInput = ReturnType<typeof validateMachineAssetInput>;
function canMachineWrite(actor: User) { return roleRank(actor.role) >= roleRank('Maintenance Tech 3'); }
function canMachineDelete(actor: User) { return roleRank(actor.role) >= roleRank('Manager'); }
function safeHexColor(value: unknown, fallback = '#44D7FF') {
  const clean = String(value ?? '').trim();
  return /^#[0-9A-Fa-f]{6}$/.test(clean) ? clean.toUpperCase() : fallback;
}
function seedMachineBrandSettings(actor?: User | null) {
  const timestamp = now();
  for (const [brandName, colorHex] of Object.entries(machineDefaultBrandColors)) run('INSERT OR IGNORE INTO machine_brand_settings (brand_name,color_hex,created_at,updated_at,updated_by_user_id) VALUES (?,?,?,?,?)', [brandName,colorHex,timestamp,timestamp,actor?.id ?? null]);
  for (const [brandName, colorHex] of Object.entries(machineRequiredDefaultBrandColors)) {
    run(`INSERT INTO machine_brand_settings (brand_name,color_hex,created_at,updated_at,updated_by_user_id) VALUES (?,?,?,?,?)
      ON CONFLICT(brand_name) DO UPDATE SET color_hex=excluded.color_hex, updated_at=excluded.updated_at, updated_by_user_id=COALESCE(excluded.updated_by_user_id, updated_by_user_id)
      WHERE upper(color_hex) <> upper(excluded.color_hex)`, [brandName,colorHex,timestamp,timestamp,actor?.id ?? null]);
  }
}
seedMachineBrandSettings();
function normalizeMachineBrand(value: string) {
  const clean = value.trim().replace(/\s+/g, ' ');
  return (clean || 'Unknown').slice(0, 120);
}
function ensureMachineBrandSetting(brandName: string, actor?: User | null) {
  const clean = normalizeMachineBrand(brandName);
  if (one<{ id: number }>('SELECT id FROM machine_brand_settings WHERE lower(brand_name)=lower(?)', [clean])) return;
  const timestamp = now();
  run('INSERT INTO machine_brand_settings (brand_name,color_hex,created_at,updated_at,updated_by_user_id) VALUES (?,?,?,?,?)', [clean,machineDefaultBrandColors[clean] ?? machineDefaultBrandColors.Default,timestamp,timestamp,actor?.id ?? null]);
}
function machineText(input: Record<string, unknown>, keys: string[], maxLength = 240, fallback = '') {
  return textField(input, keys, fallback).slice(0, maxLength);
}
function machineNumericInput(input: Record<string, unknown>, keys: string[], label: string, fallback = 0) {
  for (const key of keys) {
    const value = input[key];
    if (value === undefined || value === null || String(value).trim() === '') continue;
    const parsed = typeof value === 'number' ? value : Number(String(value).replace(/,/g, '').trim());
    if (!Number.isFinite(parsed)) throw new Error(`${label} must be numeric.`);
    return parsed;
  }
  return fallback;
}
function machineBooleanInput(input: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = input[key];
    if (value === undefined || value === null || String(value).trim() === '') continue;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    return ['1','true','yes','y','on','checked'].includes(String(value).trim().toLowerCase());
  }
  return false;
}
function machineConditionInput(input: Record<string, unknown>, keys: string[], rebuildRepaired: boolean) {
  let condition = '';
  for (const key of keys) {
    const value = input[key];
    if (value === undefined || value === null) continue;
    condition = String(value).trim().toLowerCase().replace(/\/+/g, '_').replace(/[\s-]+/g, '_').replace(/_+/g, '_');
    break;
  }
  if (rebuildRepaired && !condition) return 'rebuilt_repaired' as MachineConditionStatus;
  if (!rebuildRepaired && (!condition || condition === 'rebuilt_repaired')) return 'new' as MachineConditionStatus;
  if (!machineConditionStatuses.includes(condition as MachineConditionStatus)) throw new Error('Machine condition status must be New, Used, Worn, or Rebuilt / Repaired.');
  return condition as MachineConditionStatus;
}
function normalizeMachinePowerType(value: string) {
  const clean = value.trim();
  const lower = clean.toLowerCase();
  if (/hyb/.test(lower)) return 'Hybrid';
  if (/elec/.test(lower)) return 'Electric';
  if (/hyd/.test(lower)) return 'Hydraulic';
  return clean ? 'Other' : '';
}
function validateMachineAssetInput(body: unknown) {
  const input = isRecord(body) ? body : {};
  const assetNumber = machineText(input, ['assetNumber','asset_number','press','pressNumber'], 120).replace(/\s+/g, ' ').trim();
  if (!assetNumber) throw new Error('Asset Number is required.');
  const brand = normalizeMachineBrand(machineText(input, ['brand','manufacturer','mfg'], 120));
  if (!brand) throw new Error('Brand is required.');
  const statusInput = machineText(input, ['status'], 40, 'active').toLowerCase() as MachineAssetStatus;
  const status = machineStatuses.includes(statusInput) ? statusInput : 'active';
  const voltageType = machineText(input, ['voltageType','voltage_type'], 12).toUpperCase();
  if (!voltageTypes.has(voltageType)) throw new Error('Voltage Type must be AC or DC.');
  const screwRebuildRepaired = machineBooleanInput(input, ['screwRebuildRepaired','screw_rebuild_repaired']);
  const barrelRebuildRepaired = machineBooleanInput(input, ['barrelRebuildRepaired','barrel_rebuild_repaired']);
  const screwConditionStatus = machineConditionInput(input, ['screwConditionStatus','screw_condition_status'], screwRebuildRepaired);
  const barrelConditionStatus = machineConditionInput(input, ['barrelConditionStatus','barrel_condition_status'], barrelRebuildRepaired);
  const hasDoubleShotInjection = machineBooleanInput(input, ['hasDoubleShotInjection','has_double_shot_injection','doubleShotInjection','Double Shot Injection']);
  const hasPlungerInjection = machineBooleanInput(input, ['hasPlungerInjection','has_plunger_injection','plungerInjection','Plunger Injection']);
  const screw2RebuildRepaired = machineBooleanInput(input, ['screw2RebuildRepaired','screw2_rebuild_repaired','Screw 2 Rebuild / Repaired']);
  const barrel2RebuildRepaired = machineBooleanInput(input, ['barrel2RebuildRepaired','barrel2_rebuild_repaired','Barrel 2 Rebuild / Repaired']);
  const plungerRebuildRepaired = machineBooleanInput(input, ['plungerRebuildRepaired','plunger_rebuild_repaired','Plunger Rebuild / Repaired']);
  const plungerBarrelRebuildRepaired = machineBooleanInput(input, ['plungerBarrelRebuildRepaired','plunger_barrel_rebuild_repaired','Plunger Barrel Rebuild / Repaired']);
  const screw2ConditionStatus = machineConditionInput(input, ['screw2ConditionStatus','screw2_condition_status','Screw 2 Condition Status'], screw2RebuildRepaired);
  const barrel2ConditionStatus = machineConditionInput(input, ['barrel2ConditionStatus','barrel2_condition_status','Barrel 2 Condition Status'], barrel2RebuildRepaired);
  const plungerConditionStatus = machineConditionInput(input, ['plungerConditionStatus','plunger_condition_status','Plunger Condition Status'], plungerRebuildRepaired);
  const plungerBarrelConditionStatus = machineConditionInput(input, ['plungerBarrelConditionStatus','plunger_barrel_condition_status','Plunger Barrel Condition Status'], plungerBarrelRebuildRepaired);
  return {
    assetNumber, assetName: machineText(input, ['assetName','asset_name','name'], 160, assetNumber), brand,
    model: machineText(input, ['model','modelNumber','model_number'], 160), serialNumber: machineText(input, ['serialNumber','serial_number','equipSerialNumber'], 160),
    machineYear: machineText(input, ['machineYear','machine_year','year'], 40), machineType: machineText(input, ['machineType','machine_type'], 120, 'Injection Molding Machine') || 'Injection Molding Machine',
    powerType: normalizeMachinePowerType(machineText(input, ['powerType','power_type','he'])), shotSizeOz: machineNumericInput(input, ['shotSizeOz','shot_size_oz','shot'], 'Shot Size', 0), tonnage: machineNumericInput(input, ['tonnage','ton'], 'Tonnage', 0),
    barrelDiameter: machineText(input, ['barrelDiameter','barrel_diameter','barrel'], 120), location: machineText(input, ['location'], 120), department: machineText(input, ['department'], 120), status,
    voltageValue: machineText(input, ['voltageValue','voltage_value','voltage'], 80), voltageType, fullLoadAmp: machineText(input, ['fullLoadAmp','full_load_amp'], 80),
    machineLength: machineText(input, ['machineLength','machine_length'], 80), machineWidth: machineText(input, ['machineWidth','machine_width'], 80), machineHeight: machineText(input, ['machineHeight','machine_height'], 80), fullDieHeightLength: machineText(input, ['fullDieHeightLength','full_die_height_length'], 120),
    screwType: machineText(input, ['screwType','screw_type'], 120), screwTipType: machineText(input, ['screwTipType','screw_tip_type'], 120), screwTipInstalledDate: machineText(input, ['screwTipInstalledDate','screw_tip_installed_date'], 80), screwInstalledDate: machineText(input, ['screwInstalledDate','screw_installed_date'], 80),
    barrelInstalledDate: machineText(input, ['barrelInstalledDate','barrel_installed_date'], 80), barrelEndCapInstalledDate: machineText(input, ['barrelEndCapInstalledDate','barrel_end_cap_installed_date'], 80), barrelLength: machineText(input, ['barrelLength','barrel_length'], 80), screwLength: machineText(input, ['screwLength','screw_length'], 80),
    screwRebuildRepaired, barrelRebuildRepaired, screwConditionStatus, barrelConditionStatus,
    hasDoubleShotInjection, hasPlungerInjection,
    screw2Type: machineText(input, ['screw2Type','screw2_type','Screw 2 Type'], 120), screw2TipType: machineText(input, ['screw2TipType','screw2_tip_type','Screw 2 Tip Type'], 120), screw2RebuildRepaired, screw2ConditionStatus, screw2InstalledDate: machineText(input, ['screw2InstalledDate','screw2_installed_date','Screw 2 Installed Date'], 80), screw2TipInstalledDate: machineText(input, ['screw2TipInstalledDate','screw2_tip_installed_date','Screw 2 Tip Installed Date'], 80), screw2Length: machineText(input, ['screw2Length','screw2_length','Screw 2 Length'], 80),
    barrel2Diameter: machineText(input, ['barrel2Diameter','barrel2_diameter','Barrel 2 Diameter'], 120), barrel2RebuildRepaired, barrel2ConditionStatus, barrel2InstalledDate: machineText(input, ['barrel2InstalledDate','barrel2_installed_date','Barrel 2 Installed Date'], 80), barrel2EndCapInstalledDate: machineText(input, ['barrel2EndCapInstalledDate','barrel2_end_cap_installed_date','Barrel 2 End Cap Installed Date'], 80), barrel2Length: machineText(input, ['barrel2Length','barrel2_length','Barrel 2 Length'], 80),
    plungerType: machineText(input, ['plungerType','plunger_type','Plunger Type'], 120), plungerRebuildRepaired, plungerConditionStatus, plungerInstalledDate: machineText(input, ['plungerInstalledDate','plunger_installed_date','Plunger Installed Date'], 80), plungerLength: machineText(input, ['plungerLength','plunger_length','Plunger Length'], 80), plungerDiameter: machineText(input, ['plungerDiameter','plunger_diameter','Plunger Diameter'], 120),
    plungerBarrelType: machineText(input, ['plungerBarrelType','plunger_barrel_type','Plunger Barrel Type'], 120), plungerBarrelRebuildRepaired, plungerBarrelConditionStatus, plungerBarrelInstalledDate: machineText(input, ['plungerBarrelInstalledDate','plunger_barrel_installed_date','Plunger Barrel Installed Date'], 80), plungerBarrelEndCapInstalledDate: machineText(input, ['plungerBarrelEndCapInstalledDate','plunger_barrel_end_cap_installed_date','Plunger Barrel End Cap Installed Date'], 80), plungerBarrelLength: machineText(input, ['plungerBarrelLength','plunger_barrel_length','Plunger Barrel Length'], 80), plungerBarrelDiameter: machineText(input, ['plungerBarrelDiameter','plunger_barrel_diameter','Plunger Barrel Diameter'], 120),
    notes: machineText(input, ['notes'], 2400), criticalNotes: machineText(input, ['criticalNotes','critical_notes'], 2400),
  };
}
function publicMachineAsset(row: MachineAssetRow) {
  return {
    id: row.id, assetNumber: row.asset_number, assetName: row.asset_name, brand: row.brand, model: row.model, serialNumber: row.serial_number, machineYear: row.machine_year, machineType: row.machine_type, powerType: row.power_type,
    shotSizeOz: Number(row.shot_size_oz ?? 0), tonnage: Number(row.tonnage ?? 0), barrelDiameter: row.barrel_diameter, location: row.location, department: row.department, status: row.status, voltageValue: row.voltage_value, voltageType: row.voltage_type, fullLoadAmp: row.full_load_amp,
    machineLength: row.machine_length, machineWidth: row.machine_width, machineHeight: row.machine_height, fullDieHeightLength: row.full_die_height_length, screwType: row.screw_type, screwTipType: row.screw_tip_type, screwTipInstalledDate: row.screw_tip_installed_date, screwInstalledDate: row.screw_installed_date,
    barrelInstalledDate: row.barrel_installed_date, barrelEndCapInstalledDate: row.barrel_end_cap_installed_date, barrelLength: row.barrel_length, screwLength: row.screw_length,
    screwRebuildRepaired: Boolean(row.screw_rebuild_repaired), barrelRebuildRepaired: Boolean(row.barrel_rebuild_repaired), screwConditionStatus: row.screw_condition_status || 'new', barrelConditionStatus: row.barrel_condition_status || 'new',
    hasDoubleShotInjection: Boolean(row.has_double_shot_injection), hasPlungerInjection: Boolean(row.has_plunger_injection),
    screw2Type: row.screw2_type, screw2TipType: row.screw2_tip_type, screw2RebuildRepaired: Boolean(row.screw2_rebuild_repaired), screw2ConditionStatus: row.screw2_condition_status || 'new', screw2InstalledDate: row.screw2_installed_date, screw2TipInstalledDate: row.screw2_tip_installed_date, screw2Length: row.screw2_length,
    barrel2Diameter: row.barrel2_diameter, barrel2RebuildRepaired: Boolean(row.barrel2_rebuild_repaired), barrel2ConditionStatus: row.barrel2_condition_status || 'new', barrel2InstalledDate: row.barrel2_installed_date, barrel2EndCapInstalledDate: row.barrel2_end_cap_installed_date, barrel2Length: row.barrel2_length,
    plungerType: row.plunger_type, plungerRebuildRepaired: Boolean(row.plunger_rebuild_repaired), plungerConditionStatus: row.plunger_condition_status || 'new', plungerInstalledDate: row.plunger_installed_date, plungerLength: row.plunger_length, plungerDiameter: row.plunger_diameter,
    plungerBarrelType: row.plunger_barrel_type, plungerBarrelRebuildRepaired: Boolean(row.plunger_barrel_rebuild_repaired), plungerBarrelConditionStatus: row.plunger_barrel_condition_status || 'new', plungerBarrelInstalledDate: row.plunger_barrel_installed_date, plungerBarrelEndCapInstalledDate: row.plunger_barrel_end_cap_installed_date, plungerBarrelLength: row.plunger_barrel_length, plungerBarrelDiameter: row.plunger_barrel_diameter,
    notes: row.notes, criticalNotes: row.critical_notes, createdAt: row.created_at, updatedAt: row.updated_at, deleted: Boolean(row.deleted),
    brandColorHex: safeHexColor(row.brand_color_hex, machineDefaultBrandColors.Default),
  };
}
function machineAssetById(id: number, includeDeleted = false) {
  return one<MachineAssetRow>(`SELECT a.*, COALESCE(bs.color_hex, def.color_hex, ?) AS brand_color_hex FROM machine_assets a LEFT JOIN machine_brand_settings bs ON lower(bs.brand_name)=lower(a.brand) LEFT JOIN machine_brand_settings def ON lower(def.brand_name)='default' WHERE a.id=? ${includeDeleted ? '' : 'AND a.deleted=0'}`, [machineDefaultBrandColors.Default,id]);
}
function normalizedMachineAssetNumber(value: string) {
  return value.trim().replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').toLowerCase();
}
function machineAssetByNumber(assetNumber: string) {
  return one<MachineAssetRow>('SELECT * FROM machine_assets WHERE lower(trim(asset_number))=lower(?) ORDER BY deleted ASC, id LIMIT 1', [assetNumber.trim()]);
}
function activeMachineAssetsByNormalizedNumber() {
  const map = new Map<string, MachineAssetRow[]>();
  for (const row of all<MachineAssetRow>('SELECT * FROM machine_assets WHERE deleted=0 ORDER BY id')) {
    const key = normalizedMachineAssetNumber(row.asset_number);
    if (!key) continue;
    map.set(key, [...(map.get(key) ?? []), row]);
  }
  return map;
}
function machineAssetHistoryValue(row: MachineAssetRow | MachineAssetInput) {
  return 'asset_number' in row ? publicMachineAsset(row) : row;
}
function recordMachineAssetHistory(input: { action: string; actor: User; row: MachineAssetRow; oldValue?: Record<string, unknown> | null; newValue?: Record<string, unknown> | null; reasonNote?: string }) {
  recordHistoryLog({ section: 'machine_library', action: input.action, entityType: 'machine_asset', entityId: input.row.id, entityLabel: input.row.asset_number, assetId: String(input.row.id), machineName: input.row.asset_number, oldValue: input.oldValue, newValue: input.newValue, reasonNote: input.reasonNote, actor: input.actor });
}
function machineAssetDbValues(input: MachineAssetInput) {
  return {
    asset_number: input.assetNumber, asset_name: input.assetName, brand: input.brand, model: input.model, serial_number: input.serialNumber, machine_year: input.machineYear, machine_type: input.machineType, power_type: input.powerType, shot_size_oz: input.shotSizeOz, tonnage: input.tonnage,
    barrel_diameter: input.barrelDiameter, location: input.location, department: input.department, status: input.status, voltage_value: input.voltageValue, voltage_type: input.voltageType, full_load_amp: input.fullLoadAmp, machine_length: input.machineLength, machine_width: input.machineWidth, machine_height: input.machineHeight, full_die_height_length: input.fullDieHeightLength,
    screw_type: input.screwType, screw_tip_type: input.screwTipType, screw_tip_installed_date: input.screwTipInstalledDate, screw_installed_date: input.screwInstalledDate, barrel_installed_date: input.barrelInstalledDate, barrel_end_cap_installed_date: input.barrelEndCapInstalledDate, barrel_length: input.barrelLength, screw_length: input.screwLength,
    screw_rebuild_repaired: input.screwRebuildRepaired ? 1 : 0, barrel_rebuild_repaired: input.barrelRebuildRepaired ? 1 : 0, screw_condition_status: input.screwConditionStatus, barrel_condition_status: input.barrelConditionStatus, has_double_shot_injection: input.hasDoubleShotInjection ? 1 : 0, has_plunger_injection: input.hasPlungerInjection ? 1 : 0,
    screw2_type: input.screw2Type, screw2_tip_type: input.screw2TipType, screw2_rebuild_repaired: input.screw2RebuildRepaired ? 1 : 0, screw2_condition_status: input.screw2ConditionStatus, screw2_installed_date: input.screw2InstalledDate, screw2_tip_installed_date: input.screw2TipInstalledDate, screw2_length: input.screw2Length,
    barrel2_diameter: input.barrel2Diameter, barrel2_rebuild_repaired: input.barrel2RebuildRepaired ? 1 : 0, barrel2_condition_status: input.barrel2ConditionStatus, barrel2_installed_date: input.barrel2InstalledDate, barrel2_end_cap_installed_date: input.barrel2EndCapInstalledDate, barrel2_length: input.barrel2Length,
    plunger_type: input.plungerType, plunger_rebuild_repaired: input.plungerRebuildRepaired ? 1 : 0, plunger_condition_status: input.plungerConditionStatus, plunger_installed_date: input.plungerInstalledDate, plunger_length: input.plungerLength, plunger_diameter: input.plungerDiameter,
    plunger_barrel_type: input.plungerBarrelType, plunger_barrel_rebuild_repaired: input.plungerBarrelRebuildRepaired ? 1 : 0, plunger_barrel_condition_status: input.plungerBarrelConditionStatus, plunger_barrel_installed_date: input.plungerBarrelInstalledDate, plunger_barrel_end_cap_installed_date: input.plungerBarrelEndCapInstalledDate, plunger_barrel_length: input.plungerBarrelLength, plunger_barrel_diameter: input.plungerBarrelDiameter,
    notes: input.notes, critical_notes: input.criticalNotes,
  } as Record<string, SqlParam>;
}
function insertMachineAsset(input: MachineAssetInput, actor: User, timestamp: string) {
  ensureMachineBrandSetting(input.brand, actor);
  const values = machineAssetDbValues(input);
  values.created_at = timestamp;
  values.updated_at = timestamp;
  values.created_by_user_id = actor.id;
  values.updated_by_user_id = actor.id;
  values.deleted = 0;
  const columns = Object.keys(values);
  const result = run(`INSERT INTO machine_assets (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`, columns.map(column=>values[column]));
  return Number(result.lastInsertRowid);
}
function updateMachineAsset(id: number, input: MachineAssetInput, actor: User, timestamp: string) {
  ensureMachineBrandSetting(input.brand, actor);
  const values = machineAssetDbValues(input);
  values.updated_at = timestamp;
  values.updated_by_user_id = actor.id;
  const columns = Object.keys(values);
  run(`UPDATE machine_assets SET ${columns.map(column=>`${column}=?`).join(',')},deleted=0,deleted_at=NULL,deleted_by_user_id=NULL WHERE id=?`, [...columns.map(column=>values[column]),id]);
}
function machineCsvFromRows(headers: readonly string[], rows: Array<Record<string, string | number>>) {
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) lines.push(headers.map(header=>csvCell(row[header] ?? '')).join(','));
  return `${lines.join('\r\n')}\r\n`;
}
function machineImportRecordFromRow(record: Record<string, string>, rowNumber: number) {
  const value = (...headers: string[]) => {
    for (const header of headers) {
      const direct = record[header];
      if (direct !== undefined) return direct.trim();
      const normalized = record[normalizeImportHeader(header)];
      if (normalized !== undefined) return normalized.trim();
    }
    return '';
  };
  const press = value('Press','Asset Number','Asset Number / Press Number');
  return {
    rowNumber, assetNumber: press ? (/^press\s+/i.test(press) ? press : `Press ${press}`) : '', shotSizeOz: value('Shot (oz)','Shot','Shot Size Oz','Shot Size (oz)'), tonnage: value('Ton','Tonnage'), powerType: value('H&E','Power Type'), brand: value('Mfg','Brand','Manufacturer'), barrelDiameter: value('Barrel','Barrel/Screw Diameter','Barrel Diameter'), machineYear: value('Year','Machine Year'), model: value('Model #','Model','Model Number'), serialNumber: value('Equip Serial #','Serial Number','Equip Serial Number'), machineType: value('Machine Type'),
    screwType: value('Screw Type'), screwTipType: value('Screw Tip Type'), screwRebuildRepaired: value('Screw Rebuild / Repaired'), screwConditionStatus: value('Screw Condition Status'), screwInstalledDate: value('Screw Installed Date'), screwTipInstalledDate: value('Screw Tip Installed Date'), screwLength: value('Screw Length'),
    barrelRebuildRepaired: value('Barrel Rebuild / Repaired'), barrelConditionStatus: value('Barrel Condition Status'), barrelInstalledDate: value('Barrel Installed Date'), barrelEndCapInstalledDate: value('Barrel End Cap Installed Date'), barrelLength: value('Barrel Length'),
    machineLength: value('Machine Length'), machineWidth: value('Machine Width'), machineHeight: value('Machine Height'), fullDieHeightLength: value('Full Die Height Length / Range'), notes: value('Notes'), criticalNotes: value('Critical Notes'),
    hasDoubleShotInjection: value('Double Shot Injection'), hasPlungerInjection: value('Plunger Injection'),
    screw2Type: value('Screw 2 Type'), screw2TipType: value('Screw 2 Tip Type'), screw2RebuildRepaired: value('Screw 2 Rebuild / Repaired'), screw2ConditionStatus: value('Screw 2 Condition Status'), screw2InstalledDate: value('Screw 2 Installed Date'), screw2TipInstalledDate: value('Screw 2 Tip Installed Date'), screw2Length: value('Screw 2 Length'),
    barrel2Diameter: value('Barrel 2 Diameter'), barrel2RebuildRepaired: value('Barrel 2 Rebuild / Repaired'), barrel2ConditionStatus: value('Barrel 2 Condition Status'), barrel2InstalledDate: value('Barrel 2 Installed Date'), barrel2EndCapInstalledDate: value('Barrel 2 End Cap Installed Date'), barrel2Length: value('Barrel 2 Length'),
    plungerType: value('Plunger Type'), plungerRebuildRepaired: value('Plunger Rebuild / Repaired'), plungerConditionStatus: value('Plunger Condition Status'), plungerInstalledDate: value('Plunger Installed Date'), plungerLength: value('Plunger Length'), plungerDiameter: value('Plunger Diameter'),
    plungerBarrelType: value('Plunger Barrel Type'), plungerBarrelRebuildRepaired: value('Plunger Barrel Rebuild / Repaired'), plungerBarrelConditionStatus: value('Plunger Barrel Condition Status'), plungerBarrelInstalledDate: value('Plunger Barrel Installed Date'), plungerBarrelEndCapInstalledDate: value('Plunger Barrel End Cap Installed Date'), plungerBarrelLength: value('Plunger Barrel Length'), plungerBarrelDiameter: value('Plunger Barrel Diameter'),
  };
}
function machineImportRowsFromTable(rows: string[][]) {
  const [headers = [], ...dataRows] = rows;
  const normalizedHeaders = headers.map(normalizeImportHeader);
  for (const group of machineRequiredImportHeaderGroups) if (!group.some(required=>normalizedHeaders.includes(normalizeImportHeader(required)))) throw new Error('Machine import must include Asset Number, Shot Size (oz), Tonnage, Power Type, Brand, Barrel/Screw Diameter, Machine Year, Model, and Serial Number headers.');
  return dataRows.map((row,index)=>{
    const record: Record<string, string> = {};
    headers.forEach((header,columnIndex)=>{ record[header] = row[columnIndex] ?? ''; record[normalizeImportHeader(header)] = row[columnIndex] ?? ''; });
    return machineImportRecordFromRow(record, index + 2);
  });
}
async function parseMachineImportFile(file: Express.Multer.File | undefined) {
  if (!file) throw new Error('Choose a CSV or Excel file to import.');
  const extension = path.extname(file.originalname).toLowerCase();
  if (extension === '.csv' || file.mimetype.includes('csv')) return machineImportRowsFromTable(parseCsvRows(file.buffer.toString('utf8')));
  if (extension === '.xlsx') {
    const workbook = new ExcelJS.Workbook();
    const arrayBuffer = file.buffer.buffer.slice(file.buffer.byteOffset, file.buffer.byteOffset + file.buffer.byteLength) as ArrayBuffer;
    await workbook.xlsx.load(arrayBuffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error('Excel import file is empty.');
    const rows: string[][] = [];
    sheet.eachRow({ includeEmpty: false }, row=>{
      const values: string[] = [];
      for (let columnNumber = 1; columnNumber <= Math.max(row.cellCount, machineImportHeaders.length); columnNumber += 1) values.push(excelCellText(row.getCell(columnNumber)).trim());
      if (values.some(Boolean)) rows.push(values);
    });
    return machineImportRowsFromTable(rows);
  }
  throw new Error('Machine import file must be CSV or .xlsx Excel format.');
}
function machineInputFromImport(row: ReturnType<typeof machineImportRecordFromRow>) {
  return validateMachineAssetInput({ ...row, assetNumber: row.assetNumber, assetName: row.assetNumber, brand: row.brand || 'Unknown', model: row.model, serialNumber: row.serialNumber, machineYear: row.machineYear, machineType: 'Injection Molding Machine', powerType: row.powerType, shotSizeOz: row.shotSizeOz, tonnage: row.tonnage, barrelDiameter: row.barrelDiameter, status: 'active' });
}
type MachineImportMode = 'add_new_only' | 'upsert';
type MachineImportRejectedDuplicate = { rowNumber: number; assetNumber: string; reason: string };
function machineImportModeFromValue(value: unknown): MachineImportMode {
  return String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_') === 'upsert' ? 'upsert' : 'add_new_only';
}
function importMachineAssetRows(req: AuthRequest, rows: ReturnType<typeof machineImportRecordFromRow>[], mode: MachineImportMode) {
  const actor = req.user!;
  const timestamp = now();
  const summary = { ok: true, addedCount: 0, updatedCount: 0, skippedCount: 0, rejectedDuplicateCount: 0, errorCount: 0, errors: [] as string[], rejectedDuplicates: [] as MachineImportRejectedDuplicate[], changedAssetNumbers: [] as string[] };
  const seen = new Set<string>();
  const dbAssetsByKey = activeMachineAssetsByNormalizedNumber();
  const rejectDuplicate = (rowNumber: number, assetNumber: string, reason: string) => {
    summary.rejectedDuplicateCount += 1;
    summary.skippedCount += 1;
    summary.rejectedDuplicates.push({ rowNumber, assetNumber, reason });
  };
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const row of rows) {
      const assetNumber = String(row.assetNumber ?? '').trim().replace(/\s+/g, ' ');
      const key = normalizedMachineAssetNumber(assetNumber);
      if (!key) {
        summary.skippedCount += 1;
        summary.errorCount += 1;
        summary.errors.push(`Row ${row.rowNumber}: Asset Number is required.`);
        continue;
      }
      if (seen.has(key)) {
        rejectDuplicate(row.rowNumber, assetNumber, 'Duplicate inside import file.');
        continue;
      }
      const dbMatches = dbAssetsByKey.get(key) ?? [];
      try {
        const input = machineInputFromImport(row);
        seen.add(key);
        if (dbMatches.length > 1) {
          rejectDuplicate(row.rowNumber, assetNumber, 'Duplicate Asset Number already exists in MCC. Clean existing records first.');
          continue;
        }
        if (mode === 'add_new_only' && dbMatches.length === 1) {
          rejectDuplicate(row.rowNumber, assetNumber, 'Already exists in MCC.');
          continue;
        }
        const existing = mode === 'upsert' && dbMatches.length === 1 ? dbMatches[0] : undefined;
        if (existing) {
          const oldValue = machineAssetHistoryValue(existing);
          updateMachineAsset(existing.id, input, actor, timestamp);
          const updated = machineAssetById(existing.id, true)!;
          summary.updatedCount += 1;
          summary.changedAssetNumbers.push(updated.asset_number);
          recordMachineAssetHistory({ action: 'machine_asset_updated', actor, row: updated, oldValue, newValue: machineAssetHistoryValue(updated), reasonNote: 'Imported from CSV/XLSX.' });
        } else {
          const id = insertMachineAsset(input, actor, timestamp);
          const created = machineAssetById(id)!;
          summary.addedCount += 1;
          summary.changedAssetNumbers.push(created.asset_number);
          dbAssetsByKey.set(key, [created]);
          recordMachineAssetHistory({ action: 'machine_asset_created', actor, row: created, newValue: machineAssetHistoryValue(created), reasonNote: 'Imported from CSV/XLSX.' });
        }
      } catch (error) {
        summary.skippedCount += 1;
        summary.errorCount += 1;
        summary.errors.push(`Row ${row.rowNumber}: ${safeErrorMessage(error) || 'Invalid value skipped.'}`);
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  audit(req, 'machine asset import', 'machine_asset', 'bulk', summary);
  if (summary.addedCount + summary.updatedCount > 0) scheduleAutoBackup('machine asset import', actor);
  return summary;
}
const replacementFields: Record<MachineReplacementField, { column: keyof MachineAssetRow; action: string; label: string }> = {
  screw: { column: 'screw_installed_date', action: 'new_screw_installed', label: 'Screw' },
  screw_tip: { column: 'screw_tip_installed_date', action: 'new_screw_tip_installed', label: 'Screw Tip' },
  barrel: { column: 'barrel_installed_date', action: 'new_barrel_installed', label: 'Barrel' },
  barrel_end_cap: { column: 'barrel_end_cap_installed_date', action: 'new_barrel_end_cap_installed', label: 'Barrel End Cap' },
  screw2: { column: 'screw2_installed_date', action: 'new_screw2_installed', label: 'Screw 2' },
  screw2_tip: { column: 'screw2_tip_installed_date', action: 'new_screw2_tip_installed', label: 'Screw 2 Tip' },
  barrel2: { column: 'barrel2_installed_date', action: 'new_barrel2_installed', label: 'Barrel 2' },
  barrel2_end_cap: { column: 'barrel2_end_cap_installed_date', action: 'new_barrel2_end_cap_installed', label: 'Barrel 2 End Cap' },
  plunger: { column: 'plunger_installed_date', action: 'new_plunger_installed', label: 'Plunger' },
  plunger_barrel: { column: 'plunger_barrel_installed_date', action: 'new_plunger_barrel_installed', label: 'Plunger Barrel' },
  plunger_barrel_end_cap: { column: 'plunger_barrel_end_cap_installed_date', action: 'new_plunger_barrel_end_cap_installed', label: 'Plunger Barrel End Cap' },
};

function requireAuth(req: AuthRequest, res: Response, next: NextFunction) { const sid=unsign(cookie(req,'mcc_session')); if (!sid) return res.status(401).json({error:'Login required.'}); const s=one<{user_id:number}>('SELECT user_id FROM sessions WHERE id=? AND expires_at > ?', [sid,now()]); const u=s && findUserById(s.user_id); if (!u) return res.status(401).json({error:'Login required.'}); if (u.disabled) { clearSession(req,res); return res.status(403).json({error:'Account disabled.'}); } req.user=u; req.sessionId=sid; next(); }
function requireOwnerAdmin(req: AuthRequest, res: Response, next: NextFunction) { return Boolean(req.user?.is_owner_admin) ? next() : res.status(403).json({ok:false,error:'Owner Admin only.'}); }
function requirePermission(permission: string) { return (req: AuthRequest,res:Response,next:NextFunction) => { const role=req.user!.role; const userMgmt=role !== 'Maintenance Tech 1'; const ok = ['dashboard.view','inventory.view','settings.view','machine.view'].includes(permission) || (permission==='inventory.write'&&canInventoryWrite(req.user!)) || (permission==='inventory.import'&&canInventoryImport(req.user!)) || (permission==='machine.write'&&canMachineWrite(req.user!)) || (permission==='machine.delete'&&canMachineDelete(req.user!)) || (permission==='history.view'&&canViewHistory(req.user!)) || (permission==='history.export'&&canExportHistory(req.user!)) || (['users.view','users.create','users.edit','users.disable','users.delete','users.resetPassword'].includes(permission)&&userMgmt) || (permission==='audit.view'&&['Admin','Manager'].includes(role)); return ok ? next() : res.status(403).json({error:'Permission denied.'}); }; }

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
app.get('/api/vendors', requireAuth, (req,res)=>{
  const q = queryText(req.query.q);
  const includeDeleted = String(req.query.includeDeleted ?? '').toLowerCase() === '1' || String(req.query.includeDeleted ?? '').toLowerCase() === 'true';
  const where = includeDeleted ? ['1=1'] : ['deleted=0'];
  const params: SqlParam[] = [];
  if (q) {
    const like = `%${escapeLike(q)}%`;
    where.push('(name LIKE ? ESCAPE \'\\\' COLLATE NOCASE OR phone_number LIKE ? ESCAPE \'\\\' COLLATE NOCASE OR contact_name LIKE ? ESCAPE \'\\\' COLLATE NOCASE OR contact_phone_number LIKE ? ESCAPE \'\\\' COLLATE NOCASE OR contact_email LIKE ? ESCAPE \'\\\' COLLATE NOCASE OR address_line1 LIKE ? ESCAPE \'\\\' COLLATE NOCASE OR address_line2 LIKE ? ESCAPE \'\\\' COLLATE NOCASE OR city LIKE ? ESCAPE \'\\\' COLLATE NOCASE OR state LIKE ? ESCAPE \'\\\' COLLATE NOCASE OR postal_code LIKE ? ESCAPE \'\\\' COLLATE NOCASE OR website_url LIKE ? ESCAPE \'\\\' COLLATE NOCASE OR EXISTS (SELECT 1 FROM vendor_contacts vc WHERE vc.vendor_id=inventory_vendors.id AND vc.deleted=0 AND (vc.contact_name LIKE ? ESCAPE \'\\\' COLLATE NOCASE OR vc.contact_title LIKE ? ESCAPE \'\\\' COLLATE NOCASE OR vc.email LIKE ? ESCAPE \'\\\' COLLATE NOCASE OR vc.phone_number LIKE ? ESCAPE \'\\\' COLLATE NOCASE)))');
    params.push(like,like,like,like,like,like,like,like,like,like,like,like,like,like,like);
  }
  const vendors = all<VendorRow>(`SELECT * FROM inventory_vendors WHERE ${where.join(' AND ')} ORDER BY name COLLATE NOCASE, id`, params).map(publicVendor);
  res.json({ok:true,vendors});
});
app.get('/api/vendors/options', requireAuth, (_req,res)=>{
  const options = all<{ id: number; name: string; is_active: number; deleted: number }>('SELECT id, name, is_active, deleted FROM inventory_vendors WHERE deleted=0 AND is_active=1 ORDER BY name COLLATE NOCASE, id').map(row=>({id:row.id,companyName:row.name,isActive:Boolean(row.is_active),deleted:Boolean(row.deleted)}));
  res.json({ok:true,options});
});
app.get('/api/vendors/export/template', requireAuth, requirePermission('inventory.write'), (_req,res)=>{
  sendDownload(res, `MCC_Vendors_Template_${downloadDateStamp()}.csv`, 'text/csv; charset=utf-8', vendorCsvFromRows([]));
});
app.get('/api/vendors/export/csv', requireAuth, requirePermission('inventory.write'), (req,res)=>{
  const rows = all<VendorRow>('SELECT * FROM inventory_vendors WHERE deleted=0 ORDER BY name COLLATE NOCASE, id').flatMap(vendor => {
    const contacts = vendorContacts(vendor.id);
    return contacts.length ? contacts.map(contact => vendorExportRecord(vendor, contact)) : [vendorExportRecord(vendor)];
  });
  audit(req,'vendor export CSV','vendor','bulk',{rowCount:rows.length});
  sendDownload(res, `MCC_Vendors_Export_${downloadDateStamp()}.csv`, 'text/csv; charset=utf-8', vendorCsvFromRows(rows));
});
app.post('/api/vendors/import', requireAuth, requirePermission('inventory.write'), upload.single('file'), async (req:AuthRequest,res)=>{
  try {
    const file = req.file;
    if (!file) throw new Error('Choose a CSV file to import.');
    const extension = path.extname(file.originalname).toLowerCase();
    if (extension !== '.csv' && !file.mimetype.includes('csv')) throw new Error('Vendor import file must be CSV format.');
    const rows = vendorImportRecordsFromCsv(file.buffer);
    const summary = importVendorRows(req, rows);
    res.json({ok:true,...summary});
  } catch (error) {
    const message = safeErrorMessage(error);
    res.status(/choose|must include|must be CSV|required|valid|120|20|phone type|Website URL/i.test(message) ? 400 : 500).json({ok:false,error:message,vendorsAdded:0,vendorsUpdated:0,contactsAdded:0,contactsUpdated:0,duplicateContactsSkipped:0,skippedCount:0,errorCount:1,errors:[message]});
  }
});
app.get('/api/vendors/:id/contacts', requireAuth, (req:AuthRequest,res)=>{
  const vendorId = Number(req.params.id);
  const vendor = Number.isInteger(vendorId) && vendorId > 0 ? vendorById(vendorId) : undefined;
  if (!vendor) return res.status(404).json({ok:false,error:'Vendor not found.'});
  const includeDeleted = (String(req.query.includeDeleted ?? '').toLowerCase() === '1' || String(req.query.includeDeleted ?? '').toLowerCase() === 'true') && roleRank(req.user!.role) >= roleRank('Manager');
  res.json({ok:true,vendor:publicVendor(vendor),contacts:vendorContacts(vendorId, includeDeleted).map(publicVendorContact)});
});
app.post('/api/vendors/:id/contacts', requireAuth, requirePermission('inventory.write'), (req:AuthRequest,res)=>{
  const vendorId = Number(req.params.id);
  try {
    const actor = req.user!;
    const vendor = Number.isInteger(vendorId) && vendorId > 0 ? vendorById(vendorId) : undefined;
    if (!vendor) throw new Error('Vendor not found.');
    const input = validateVendorContactInput(req.body);
    if (!input) throw new Error('Contact Name is required.');
    const duplicate = matchingVendorContact(vendorId, input);
    if (duplicate && !duplicate.deleted) throw new Error('Contact already exists for this vendor.');
    const timestamp = now();
    const contactId = duplicate ? duplicate.id : insertVendorContact(vendorId, input, actor, timestamp);
    if (duplicate) updateVendorContact(vendorId, duplicate.id, input, actor, timestamp);
    const contact = vendorContactById(vendorId, contactId)!;
    recordVendorContactHistory({ action: duplicate ? 'vendor_contact_updated' : 'vendor_contact_created', actor, vendor, contactId, contactName: input.contactName, oldValue: duplicate ? vendorContactHistoryValue(duplicate) : null, newValue: vendorContactHistoryValue(contact) });
    audit(req, duplicate ? 'vendor contact update' : 'vendor contact create', 'vendor_contact', contactId, {vendorId,companyName:vendor.name,contactName:input.contactName});
    res.status(duplicate ? 200 : 201).json({ok:true,contact:publicVendorContact(contact),vendor:publicVendor(vendor)});
  } catch (error) {
    const message = safeErrorMessage(error);
    res.status(/not found/i.test(message) ? 404 : /already exists/i.test(message) ? 409 : /required|valid|160|20|phone type/i.test(message) ? 400 : 500).json({ok:false,error:message});
  }
});
app.put('/api/vendors/:vendorId/contacts/:contactId', requireAuth, requirePermission('inventory.write'), (req:AuthRequest,res)=>{
  const vendorId = Number(req.params.vendorId);
  const contactId = Number(req.params.contactId);
  try {
    const actor = req.user!;
    const vendor = Number.isInteger(vendorId) && vendorId > 0 ? vendorById(vendorId) : undefined;
    if (!vendor) throw new Error('Vendor not found.');
    const existing = Number.isInteger(contactId) && contactId > 0 ? vendorContactById(vendorId, contactId, true) : undefined;
    if (!existing) throw new Error('Contact not found.');
    const input = validateVendorContactInput(req.body);
    if (!input) throw new Error('Contact Name is required.');
    const duplicate = matchingVendorContact(vendorId, input, contactId);
    if (duplicate && !duplicate.deleted) throw new Error('Contact already exists for this vendor.');
    const timestamp = now();
    updateVendorContact(vendorId, contactId, input, actor, timestamp);
    const contact = vendorContactById(vendorId, contactId, true)!;
    recordVendorContactHistory({ action: 'vendor_contact_updated', actor, vendor, contactId, contactName: input.contactName, oldValue: vendorContactHistoryValue(existing), newValue: vendorContactHistoryValue(contact) });
    audit(req, 'vendor contact update', 'vendor_contact', contactId, {vendorId,companyName:vendor.name,contactName:input.contactName});
    res.json({ok:true,contact:publicVendorContact(contact),vendor:publicVendor(vendor)});
  } catch (error) {
    const message = safeErrorMessage(error);
    res.status(/not found/i.test(message) ? 404 : /already exists/i.test(message) ? 409 : /required|valid|160|20|phone type/i.test(message) ? 400 : 500).json({ok:false,error:message});
  }
});
app.delete('/api/vendors/:vendorId/contacts/:contactId', requireAuth, (req:AuthRequest,res)=>{
  const vendorId = Number(req.params.vendorId);
  const contactId = Number(req.params.contactId);
  try {
    if (roleRank(req.user!.role) < roleRank('Manager')) return res.status(403).json({ok:false,error:'Permission denied.'});
    const vendor = Number.isInteger(vendorId) && vendorId > 0 ? vendorById(vendorId) : undefined;
    if (!vendor) throw new Error('Vendor not found.');
    const existing = Number.isInteger(contactId) && contactId > 0 ? vendorContactById(vendorId, contactId) : undefined;
    if (!existing) throw new Error('Contact not found.');
    const reasonNote = requiredReasonNote(isRecord(req.body) ? req.body.reasonNote ?? req.body.reason : '', 'Vendor contact delete');
    const timestamp = now();
    run('UPDATE vendor_contacts SET deleted=1, deleted_at=?, deleted_by_user_id=?, updated_by_user_id=?, updated_at=? WHERE vendor_id=? AND id=?', [timestamp,req.user!.id,req.user!.id,timestamp,vendorId,contactId]);
    recordVendorContactHistory({ action: 'vendor_contact_deleted', actor: req.user!, vendor, contactId, contactName: existing.contact_name, oldValue: vendorContactHistoryValue(existing), newValue: { ...vendorContactHistoryValue(existing), deleted: true }, reasonNote });
    audit(req, 'vendor contact delete', 'vendor_contact', contactId, {vendorId,companyName:vendor.name,contactName:existing.contact_name});
    res.json({ok:true,vendor:publicVendor(vendor)});
  } catch (error) {
    const message = safeErrorMessage(error);
    res.status(/not found/i.test(message) ? 404 : /reason|required/i.test(message) ? 400 : 500).json({ok:false,error:message});
  }
});
app.post('/api/vendors/:vendorId/contacts/:contactId/restore', requireAuth, requirePermission('inventory.write'), (req:AuthRequest,res)=>{
  const vendorId = Number(req.params.vendorId);
  const contactId = Number(req.params.contactId);
  try {
    const vendor = Number.isInteger(vendorId) && vendorId > 0 ? vendorById(vendorId) : undefined;
    if (!vendor) throw new Error('Vendor not found.');
    const existing = Number.isInteger(contactId) && contactId > 0 ? vendorContactById(vendorId, contactId, true) : undefined;
    if (!existing) throw new Error('Contact not found.');
    const timestamp = now();
    run('UPDATE vendor_contacts SET deleted=0, deleted_at=NULL, deleted_by_user_id=NULL, updated_by_user_id=?, updated_at=? WHERE vendor_id=? AND id=?', [req.user!.id,timestamp,vendorId,contactId]);
    const contact = vendorContactById(vendorId, contactId)!;
    recordVendorContactHistory({ action: 'vendor_contact_restored', actor: req.user!, vendor, contactId, contactName: contact.contact_name, oldValue: vendorContactHistoryValue(existing), newValue: vendorContactHistoryValue(contact) });
    audit(req, 'vendor contact restore', 'vendor_contact', contactId, {vendorId,companyName:vendor.name,contactName:contact.contact_name});
    res.json({ok:true,contact:publicVendorContact(contact),vendor:publicVendor(vendor)});
  } catch (error) {
    const message = safeErrorMessage(error);
    res.status(/not found/i.test(message) ? 404 : 500).json({ok:false,error:message});
  }
});
app.get('/api/vendors/:id', requireAuth, (req,res)=>{
  const vendorId = Number(req.params.id);
  const vendor = Number.isInteger(vendorId) && vendorId > 0 ? vendorById(vendorId) : undefined;
  if (!vendor) return res.status(404).json({ok:false,error:'Vendor not found.'});
  res.json({ok:true,vendor:publicVendor(vendor)});
});
app.post('/api/vendors', requireAuth, requirePermission('inventory.write'), (req:AuthRequest,res)=>{
  try {
    const actor = req.user!;
    const input = validateVendorInput(req.body);
    if (!input.isActive && !input.reasonNote) throw new Error('Reason for disabling vendor is required.');
    const timestamp = now();
    const existing = vendorByName(input.companyName);
    if (existing) return res.status(409).json({ok:false,error:'Company Name already exists.'});
    let vendorId = 0;
    db.exec('BEGIN IMMEDIATE');
    try {
      vendorId = insertVendorRow(input,actor,timestamp);
      recordVendorHistory({
        action: input.isActive ? 'vendor_created' : 'vendor_disabled',
        actor,
        vendorId,
        companyName: input.companyName,
        newValue: vendorHistoryValue(input),
        reasonNote: input.isActive ? undefined : input.reasonNote,
      });
      const createdVendor = vendorById(vendorId);
      if (createdVendor) syncVendorContacts(createdVendor,input.contacts,actor,timestamp,'Saved with new vendor.');
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    const vendor = vendorById(vendorId);
    audit(req, 'vendor create', 'vendor', vendorId, {companyName: input.companyName});
    res.status(201).json({ok:true,vendor:vendor ? publicVendor(vendor) : null,mergedExisting:false});
  } catch (error) {
    const message = safeErrorMessage(error);
    res.status(/already exists/i.test(message) ? 409 : /required|valid|120|20|phone type|reason|Website URL/i.test(message) ? 400 : 500).json({ok:false,error:message});
  }
});
app.put('/api/vendors/:id', requireAuth, requirePermission('inventory.write'), (req:AuthRequest,res)=>{
  const vendorId = Number(req.params.id);
  try {
    if (!Number.isInteger(vendorId) || vendorId <= 0) throw new Error('Vendor not found.');
    const actor = req.user!;
    const existing = vendorById(vendorId);
    if (!existing) throw new Error('Vendor not found.');
    const input = validateVendorInput(req.body);
    const duplicate = vendorByName(input.companyName,vendorId);
    if (duplicate) throw new Error('Company Name already exists for another active vendor.');
    if (existing.is_active && !input.isActive && !input.reasonNote) throw new Error('Reason for disabling vendor is required.');
    const timestamp = now();
    db.exec('BEGIN IMMEDIATE');
    try {
      updateVendorRow(vendorId,input,actor,timestamp);
      const updatedVendorBase = vendorById(vendorId);
      if (updatedVendorBase) syncVendorContacts(updatedVendorBase,input.contacts,actor,timestamp,'Saved with vendor edit.');
      recordVendorHistory({
        action: existing.deleted && input.isActive ? 'vendor_reactivated' : existing.is_active && !input.isActive ? 'vendor_disabled' : !existing.is_active && input.isActive ? 'vendor_enabled' : 'vendor_updated',
        actor,
        vendorId,
        companyName: input.companyName,
        oldValue: vendorHistoryValue(existing),
        newValue: vendorHistoryValue(input),
        reasonNote: existing.is_active && !input.isActive ? input.reasonNote : undefined,
      });
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    const vendor = vendorById(vendorId);
    audit(req,'vendor update','vendor',vendorId,{companyName: input.companyName});
    res.json({ok:true,vendor:vendor ? publicVendor(vendor) : null});
  } catch (error) {
    const message = safeErrorMessage(error);
    res.status(/not found/i.test(message) ? 404 : /already exists/i.test(message) ? 409 : /required|valid|120|20|phone type|reason/i.test(message) ? 400 : 500).json({ok:false,error:message});
  }
});
app.delete('/api/vendors/:id', requireAuth, (req:AuthRequest,res)=>{
  const vendorId = Number(req.params.id);
  try {
    if (!Number.isInteger(vendorId) || vendorId <= 0) throw new Error('Vendor not found.');
    if (roleRank(req.user!.role) < roleRank('Manager')) return res.status(403).json({ok:false,error:'Permission denied.'});
    const existing = vendorById(vendorId);
    if (!existing) throw new Error('Vendor not found.');
    const reasonNote = requiredReasonNote(isRecord(req.body) ? req.body.reasonNote ?? req.body.reason : '', 'Vendor delete');
    const timestamp = now();
    run('UPDATE inventory_vendors SET deleted=1, is_active=0, deleted_at=?, deleted_by_user_id=?, updated_by_user_id=?, updated_at=? WHERE id=? AND deleted=0', [timestamp,req.user!.id,req.user!.id,timestamp,vendorId]);
    recordVendorHistory({
      action: 'vendor_deleted',
      actor: req.user!,
      vendorId,
      companyName: existing.name,
      oldValue: vendorHistoryValue(existing),
      newValue: { ...vendorHistoryValue(existing), deleted: true },
      reasonNote,
    });
    audit(req,'vendor delete','vendor',vendorId,{companyName: existing.name});
    res.json({ok:true});
  } catch (error) {
    const message = safeErrorMessage(error);
    res.status(/not found/i.test(message) ? 404 : /used by active|reason|required/i.test(message) ? 400 : 500).json({ok:false,error:message});
  }
});
app.get('/api/machine-library/assets', requireAuth, requirePermission('machine.view'), (req:AuthRequest,res)=>{
  seedMachineBrandSettings();
  const search = queryText(req.query.q);
  const brand = queryText(req.query.brand);
  const status = queryText(req.query.status);
  const where = ['a.deleted=0'];
  const params: SqlParam[] = [machineDefaultBrandColors.Default];
  if (search) {
    const like = `%${escapeLike(search)}%`;
    where.push('(a.asset_number LIKE ? ESCAPE \'\\\' COLLATE NOCASE OR a.asset_name LIKE ? ESCAPE \'\\\' COLLATE NOCASE OR a.brand LIKE ? ESCAPE \'\\\' COLLATE NOCASE OR a.model LIKE ? ESCAPE \'\\\' COLLATE NOCASE OR a.serial_number LIKE ? ESCAPE \'\\\' COLLATE NOCASE)');
    params.push(like,like,like,like,like);
  }
  if (brand) { where.push('lower(a.brand)=lower(?)'); params.push(brand); }
  if (status && machineStatuses.includes(status as MachineAssetStatus)) { where.push('a.status=?'); params.push(status); }
  const assets = all<MachineAssetRow>(`SELECT a.*, COALESCE(bs.color_hex, def.color_hex, ?) AS brand_color_hex FROM machine_assets a LEFT JOIN machine_brand_settings bs ON lower(bs.brand_name)=lower(a.brand) LEFT JOIN machine_brand_settings def ON lower(def.brand_name)='default' WHERE ${where.join(' AND ')} ORDER BY a.asset_number COLLATE NOCASE`, params).map(publicMachineAsset);
  const brandSettings = all<{ brand_name: string; color_hex: string }>('SELECT brand_name,color_hex FROM machine_brand_settings ORDER BY brand_name COLLATE NOCASE').map(row=>({brandName:row.brand_name,colorHex:safeHexColor(row.color_hex)}));
  res.json({ok:true,assets,brandSettings,permissions:{canEdit:canMachineWrite(req.user!),canDelete:canMachineDelete(req.user!)}});
});
app.post('/api/machine-library/assets', requireAuth, requirePermission('machine.write'), (req:AuthRequest,res)=>{
  try {
    const actor = req.user!;
    const input = validateMachineAssetInput(req.body);
    const existing = machineAssetByNumber(input.assetNumber);
    if (existing && !existing.deleted) return res.status(409).json({ok:false,error:'Asset Number already exists.'});
    const timestamp = now();
    const id = existing?.deleted ? existing.id : 0;
    db.exec('BEGIN IMMEDIATE');
    try {
      const assetId = id || insertMachineAsset(input, actor, timestamp);
      if (id) updateMachineAsset(id, input, actor, timestamp);
      const row = machineAssetById(assetId)!;
      recordMachineAssetHistory({ action: 'machine_asset_created', actor, row, newValue: machineAssetHistoryValue(row) });
      db.exec('COMMIT');
      audit(req,'machine asset create','machine_asset',assetId,{assetNumber:input.assetNumber});
      scheduleAutoBackup('machine asset create', actor);
      res.status(201).json({ok:true,asset:publicMachineAsset(machineAssetById(assetId)!)});
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } catch (error) {
    const message = safeErrorMessage(error);
    res.status(/required|numeric|Voltage Type|already/i.test(message) ? 400 : 500).json({ok:false,error:message});
  }
});
app.put('/api/machine-library/assets/:id', requireAuth, requirePermission('machine.write'), (req:AuthRequest,res)=>{
  try {
    const actor = req.user!;
    const id = Number(req.params.id);
    const existing = machineAssetById(id);
    if (!existing) return res.status(404).json({ok:false,error:'Machine asset not found.'});
    const input = validateMachineAssetInput(req.body);
    const duplicate = machineAssetByNumber(input.assetNumber);
    if (duplicate && duplicate.id !== id && !duplicate.deleted) return res.status(409).json({ok:false,error:'Asset Number already exists.'});
    const oldValue = machineAssetHistoryValue(existing);
    const timestamp = now();
    updateMachineAsset(id, input, actor, timestamp);
    const updated = machineAssetById(id)!;
    recordMachineAssetHistory({ action: 'machine_asset_updated', actor, row: updated, oldValue, newValue: machineAssetHistoryValue(updated), reasonNote: textField(isRecord(req.body) ? req.body : {}, ['reasonNote','reason']) });
    audit(req,'machine asset update','machine_asset',id,{assetNumber:input.assetNumber});
    scheduleAutoBackup('machine asset update', actor);
    res.json({ok:true,asset:publicMachineAsset(updated)});
  } catch (error) {
    const message = safeErrorMessage(error);
    res.status(/not found/i.test(message) ? 404 : /required|numeric|Voltage Type|already/i.test(message) ? 400 : 500).json({ok:false,error:message});
  }
});
for (const action of ['disable','enable'] as const) app.post(`/api/machine-library/assets/:id/${action}`, requireAuth, requirePermission('machine.delete'), (req:AuthRequest,res)=>{
  try {
    const actor = req.user!;
    const asset = machineAssetById(Number(req.params.id));
    if (!asset) return res.status(404).json({ok:false,error:'Machine asset not found.'});
    const oldValue = machineAssetHistoryValue(asset);
    const status = action === 'disable' ? 'disabled' : 'active';
    const timestamp = now();
    run('UPDATE machine_assets SET status=?, updated_at=?, updated_by_user_id=? WHERE id=?', [status,timestamp,actor.id,asset.id]);
    const updated = machineAssetById(asset.id)!;
    recordMachineAssetHistory({ action: action === 'disable' ? 'machine_asset_disabled' : 'machine_asset_enabled', actor, row: updated, oldValue, newValue: machineAssetHistoryValue(updated), reasonNote: textField(isRecord(req.body) ? req.body : {}, ['reasonNote','reason']) });
    audit(req,`machine asset ${action}`,'machine_asset',asset.id,{assetNumber:asset.asset_number});
    scheduleAutoBackup(`machine asset ${action}`, actor);
    res.json({ok:true,asset:publicMachineAsset(updated)});
  } catch (error) {
    res.status(500).json({ok:false,error:safeErrorMessage(error)});
  }
});
app.delete('/api/machine-library/assets/:id', requireAuth, requirePermission('machine.delete'), (req:AuthRequest,res)=>{
  try {
    const actor = req.user!;
    const asset = machineAssetById(Number(req.params.id));
    if (!asset) return res.status(404).json({ok:false,error:'Machine asset not found.'});
    const reasonNote = requiredReasonNote(isRecord(req.body) ? req.body.reasonNote ?? req.body.reason : '', 'Machine delete');
    const timestamp = now();
    run('UPDATE machine_assets SET deleted=1,status=?,deleted_at=?,deleted_by_user_id=?,updated_at=?,updated_by_user_id=? WHERE id=?', ['removed',timestamp,actor.id,timestamp,actor.id,asset.id]);
    const removed = machineAssetById(asset.id, true)!;
    recordMachineAssetHistory({ action: 'machine_asset_deleted', actor, row: removed, oldValue: machineAssetHistoryValue(asset), newValue: machineAssetHistoryValue(removed), reasonNote });
    audit(req,'machine asset delete','machine_asset',asset.id,{assetNumber:asset.asset_number});
    scheduleAutoBackup('machine asset delete', actor);
    res.json({ok:true});
  } catch (error) {
    const message = safeErrorMessage(error);
    res.status(/required/i.test(message) ? 400 : 500).json({ok:false,error:message});
  }
});
app.post('/api/machine-library/assets/:id/replacements/:field', requireAuth, requirePermission('machine.write'), (req:AuthRequest,res)=>{
  try {
    const actor = req.user!;
    const config = replacementFields[String(req.params.field) as MachineReplacementField];
    if (!config) return res.status(400).json({ok:false,error:'Replacement field is invalid.'});
    const asset = machineAssetById(Number(req.params.id));
    if (!asset) return res.status(404).json({ok:false,error:'Machine asset not found.'});
    const input = isRecord(req.body) ? req.body : {};
    const installDate = machineText(input, ['installDate','installedDate','date'], 80);
    if (!installDate) return res.status(400).json({ok:false,error:'Install Date is required.'});
    const reasonNote = machineText(input, ['reasonNote','reason','note'], 1200);
    const oldDate = String(asset[config.column] ?? '');
    const timestamp = now();
    run(`UPDATE machine_assets SET ${String(config.column)}=?, updated_at=?, updated_by_user_id=? WHERE id=?`, [installDate,timestamp,actor.id,asset.id]);
    const updated = machineAssetById(asset.id)!;
    recordMachineAssetHistory({ action: config.action, actor, row: updated, oldValue: { [config.column]: oldDate }, newValue: { [config.column]: installDate, assetNumber: updated.asset_number, brand: updated.brand, model: updated.model }, reasonNote });
    audit(req,config.action,'machine_asset',asset.id,{assetNumber:asset.asset_number,oldInstalledDate:oldDate,newInstalledDate:installDate});
    scheduleAutoBackup(config.action, actor);
    res.json({ok:true,asset:publicMachineAsset(updated)});
  } catch (error) {
    res.status(500).json({ok:false,error:safeErrorMessage(error)});
  }
});
app.get('/api/machine-library/brand-settings', requireAuth, requirePermission('machine.view'), (_req,res)=>{
  seedMachineBrandSettings();
  res.json({ok:true,brandSettings:all<{ brand_name: string; color_hex: string }>('SELECT brand_name,color_hex FROM machine_brand_settings ORDER BY brand_name COLLATE NOCASE').map(row=>({brandName:row.brand_name,colorHex:safeHexColor(row.color_hex)}))});
});
app.put('/api/machine-library/brand-settings/:brandName', requireAuth, requirePermission('machine.write'), (req:AuthRequest,res)=>{
  try {
    const actor = req.user!;
    const brandName = normalizeMachineBrand(String(req.params.brandName));
    const colorHex = safeHexColor(isRecord(req.body) ? req.body.colorHex : '', '');
    if (!colorHex) return res.status(400).json({ok:false,error:'Brand color must be a safe #RRGGBB hex value.'});
    const previous = one<{ brand_name: string; color_hex: string }>('SELECT brand_name,color_hex FROM machine_brand_settings WHERE lower(brand_name)=lower(?)', [brandName]);
    const timestamp = now();
    run('INSERT INTO machine_brand_settings (brand_name,color_hex,created_at,updated_at,updated_by_user_id) VALUES (?,?,?,?,?) ON CONFLICT(brand_name) DO UPDATE SET color_hex=excluded.color_hex, updated_at=excluded.updated_at, updated_by_user_id=excluded.updated_by_user_id', [brandName,colorHex,timestamp,timestamp,actor.id]);
    recordHistoryLog({ section: 'machine_library', action: 'brand_color_changed', entityType: 'machine_brand_settings', entityLabel: brandName, oldValue: previous ? { brandName: previous.brand_name, colorHex: previous.color_hex } : null, newValue: { brandName, colorHex }, reasonNote: textField(isRecord(req.body) ? req.body : {}, ['reasonNote','reason']), actor });
    audit(req,'machine brand color change','machine_brand_settings',brandName,{brandName,colorHex});
    scheduleAutoBackup('machine brand color change', actor);
    res.json({ok:true,brandSetting:{brandName,colorHex}});
  } catch (error) {
    res.status(500).json({ok:false,error:safeErrorMessage(error)});
  }
});
app.get('/api/machine-library/assets/:id/history', requireAuth, requirePermission('machine.view'), (req,res)=>{
  const asset = machineAssetById(Number(req.params.id), true);
  if (!asset) return res.status(404).json({ok:false,error:'Machine asset not found.'});
  const records = all<HistoryLogRow>("SELECT * FROM history_logs WHERE section='machine_library' AND entity_type='machine_asset' AND (entity_id=? OR asset_id=? OR entity_label=?) ORDER BY created_at DESC, id DESC LIMIT 200", [String(asset.id),String(asset.id),asset.asset_number]).map(publicHistoryRecord);
  res.json({ok:true,asset:publicMachineAsset(asset),records});
});
type MeasurementRecordPdfInput = { name: string; type: string; assetNumber: string; recordDate: string; uploadedAt: string; size: number; dataUrl: string };
function bufferFromDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!match) throw new Error('Invalid file data.');
  return Buffer.from(match[3], match[2] ? 'base64' : 'utf8');
}
function measurementRecordPdfInputs(value: unknown): MeasurementRecordPdfInput[] {
  const body = isRecord(value) ? value : {};
  const rows = Array.isArray(body.records) ? body.records : [];
  return rows.slice(0, 75).map(row => {
    const item = isRecord(row) ? row : {};
    const name = cleanPdfText(String(item.name ?? 'Inspection record'));
    const dataUrl = String(item.dataUrl ?? '');
    if (!dataUrl.startsWith('data:')) throw new Error('Record file data is missing.');
    return {
      name,
      type: cleanPdfText(String(item.type ?? 'application/octet-stream')).toLowerCase(),
      assetNumber: cleanPdfText(String(item.assetNumber ?? 'Unassigned')),
      recordDate: cleanPdfText(String(item.recordDate ?? '')),
      uploadedAt: cleanPdfText(String(item.uploadedAt ?? '')),
      size: Number(item.size ?? 0) || 0,
      dataUrl,
    };
  });
}
function measurementRecordPdfFileName(value: unknown) {
  const body = isRecord(value) ? value : {};
  const requested = String(body.fileName ?? '').replace(/\.pdf$/i, '');
  return `${safeFileToken(requested || `MCC_Screw_Barrel_Records_${downloadDateStamp()}`)}.pdf`;
}
function drawMeasurementRecordHeader(page: PDFPage, record: MeasurementRecordPdfInput, font: PDFFont, bold: PDFFont, index: number) {
  const { width, height } = page.getSize();
  page.drawRectangle({ x: 0, y: height - 50, width, height: 50, color: pdfWhite, borderColor: rgb(0.72,0.82,0.88), borderWidth: 0.6 });
  page.drawText(`Asset: ${truncateToFit(record.assetNumber || 'Unassigned', bold, 12, width - 72)}`, { x: 30, y: height - 20, size: 12, font: bold, color: pdfBlack });
  page.drawText(`Record Date: ${record.recordDate || '-'}  |  File: ${truncateToFit(record.name, font, 8, width - 190)}  |  Page ${index}`, { x: 30, y: height - 36, size: 8, font, color: rgb(0.28,0.34,0.4) });
}
function addMeasurementRecordInfoPage(pdf: PDFDocument, record: MeasurementRecordPdfInput, font: PDFFont, bold: PDFFont, message: string) {
  const page = pdf.addPage([612, 792]);
  drawMeasurementRecordHeader(page, record, font, bold, pdf.getPageCount());
  page.drawText('Screw & Barrel Inspection Record', { x: 36, y: 700, size: 18, font: bold, color: pdfBlack });
  page.drawText(message, { x: 36, y: 674, size: 10, font, color: rgb(0.18,0.24,0.3) });
  page.drawText(`Original file type: ${record.type || '-'}`, { x: 36, y: 650, size: 9, font, color: rgb(0.18,0.24,0.3) });
  page.drawText(`Uploaded: ${record.uploadedAt || '-'}`, { x: 36, y: 634, size: 9, font, color: rgb(0.18,0.24,0.3) });
}
async function buildCombinedMeasurementRecordPdf(input: unknown) {
  const records = measurementRecordPdfInputs(input);
  if (!records.length) throw new Error('Select at least one record.');
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (const record of records) {
    const bytes = bufferFromDataUrl(record.dataUrl);
    if (record.type.includes('pdf') || record.name.toLowerCase().endsWith('.pdf')) {
      const source = await PDFDocument.load(bytes);
      const pages = await pdf.copyPages(source, source.getPageIndices());
      pages.forEach(page => {
        pdf.addPage(page);
        drawMeasurementRecordHeader(page, record, font, bold, pdf.getPageCount());
      });
      continue;
    }
    if (record.type.includes('png') || /\.png$/i.test(record.name) || record.type.includes('jpeg') || record.type.includes('jpg') || /\.jpe?g$/i.test(record.name)) {
      const page = pdf.addPage([612, 792]);
      drawMeasurementRecordHeader(page, record, font, bold, pdf.getPageCount());
      const image = record.type.includes('png') || /\.png$/i.test(record.name) ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
      const maxWidth = 540;
      const maxHeight = 690;
      const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
      const drawWidth = image.width * scale;
      const drawHeight = image.height * scale;
      page.drawImage(image, { x: (612 - drawWidth) / 2, y: 34, width: drawWidth, height: drawHeight });
      continue;
    }
    if (record.type.includes('text') || /\.(csv|txt|json)$/i.test(record.name)) {
      const text = bytes.toString('utf8').replace(/\r/g, '').slice(0, 10000);
      const page = pdf.addPage([612, 792]);
      drawMeasurementRecordHeader(page, record, font, bold, pdf.getPageCount());
      const lines = text.split('\n').flatMap(line => {
        const chunks: string[] = [];
        let rest = line || ' ';
        while (rest.length > 0) {
          chunks.push(rest.slice(0, 110));
          rest = rest.slice(110);
        }
        return chunks;
      }).slice(0, 72);
      lines.forEach((line,index)=>page.drawText(cleanPdfText(line), { x: 34, y: 704 - index * 9, size: 7.2, font, color: pdfBlack }));
      continue;
    }
    addMeasurementRecordInfoPage(pdf, record, font, bold, 'This file type is included in the record set but cannot be rendered into the combined PDF.');
  }
  return Buffer.from(await pdf.save());
}
app.post('/api/machine-library/measurement-records/combined-pdf', requireAuth, requirePermission('machine.view'), async (req:AuthRequest,res)=>{
  try {
    const buffer = await buildCombinedMeasurementRecordPdf(req.body);
    audit(req,'measurement record combined pdf generated','machine_asset','local-records',{recordCount:Array.isArray((req.body as {records?: unknown[]}).records) ? (req.body as {records: unknown[]}).records.length : 0});
    sendDownload(res, measurementRecordPdfFileName(req.body), 'application/pdf', buffer);
  } catch (error) {
    console.error('Measurement record combined PDF failed', error);
    res.status(400).json({ok:false,error:safeErrorMessage(error) || 'Combined PDF generation failed.'});
  }
});
app.post('/api/machine-library/measurement-inspection/pdf', requireAuth, requirePermission('machine.view'), async (req:AuthRequest,res)=>{
  try {
    const body = isRecord(req.body) ? req.body : {};
    const mode = measurementPdfMode(body);
    const target = measurementPdfTarget(body);
    const buffer = await buildMeasurementInspectionPdf(body, req.user!);
    const fileName = `MCC_Measurement_Inspection_${safeFileToken(target.assetNumber)}_${mode}_${downloadDateStamp()}.pdf`;
    try {
      audit(req,'measurement inspection pdf generated','machine_asset',target.assetNumber,{mode,componentCount:measurementPdfComponents(body).length});
    } catch (auditError) {
      console.error('Measurement PDF audit logging failed', auditError);
    }
    sendDownload(res,fileName,'application/pdf',buffer);
  } catch (error) {
    console.error('Measurement PDF generation failed', error);
    res.status(500).json({ok:false,error:'Measurement PDF generation failed. Check server console for details.',detail:safeErrorMessage(error)});
  }
});
app.get('/api/machine-library/export/template', requireAuth, requirePermission('machine.write'), (_req,res)=>{
  sendDownload(res, `MCC_Machine_List_Template_${downloadDateStamp()}.csv`, 'text/csv; charset=utf-8', machineCsvFromRows(machineImportHeaders, []));
});
app.post('/api/machine-library/import', requireAuth, requirePermission('machine.write'), upload.single('file'), async (req:AuthRequest,res)=>{
  try {
    const rows = await parseMachineImportFile(req.file);
    const summary = importMachineAssetRows(req, rows, machineImportModeFromValue(isRecord(req.body) ? req.body.importMode : ''));
    res.json(summary);
  } catch (error) {
    const message = safeErrorMessage(error);
    res.status(/Choose|must include|must be CSV|numeric|required/i.test(message) ? 400 : 500).json({ok:false,error:message,addedCount:0,updatedCount:0,skippedCount:0,rejectedDuplicateCount:0,errorCount:1,errors:[message],rejectedDuplicates:[],changedAssetNumbers:[]});
  }
});

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
    res.json(masterBackupStatus(req.user!));
  } catch (error) {
    res.status(500).json({ok:false,error:safeErrorMessage(error, [], 'Backup status failed.')});
  }
});
app.get('/api/backup/list', requireAuth, (req:AuthRequest,res)=>{
  try {
    const category = backupCategoryFromValue(req.query.category, 'master');
    if (!canViewBackupCategory(req.user!, category)) return res.status(403).json({ok:false,error:'Permission denied.'});
    res.json({ok:true,category,backups:listBackupsByCategory(category, { includeLegacy: category === 'master' })});
  } catch (error) {
    res.status(/category/i.test(safeErrorMessage(error)) ? 400 : 500).json({ok:false,error:safeErrorMessage(error, [], 'Backup list failed.')});
  }
});
app.post('/api/backup/create', requireAuth, (req:AuthRequest,res)=>{
  try {
    const body = isRecord(req.body) ? req.body : {};
    const category = backupCategoryFromValue(body.category, 'master');
    if (category === 'legacy') return res.status(400).json({ok:false,error:'Legacy backups are read-only.'});
    if (!canCreateBackupCategory(req.user!, category)) return res.status(403).json({ok:false,error:'Permission denied.'});
    const backup = createBackup({ category, type: defaultManualBackupType(category), actor: req.user!, notes: `${backupCategoryLabel(category)} created from MCC Settings.` });
    try { audit(req,`${category} backup created`,'backup',backup.id,{backupCategory:backup.category,backupType:backup.type}); } catch (auditError) { console.log(`MCC manual backup audit failed: ${safeErrorMessage(auditError, [], 'Audit failed.')}`); }
    res.status(201).json({ok:true,backup,status:masterBackupStatus(req.user!),message:`${backupCategoryLabel(category)} created successfully.`});
  } catch (error) {
    const rawMessage = safeErrorMessage(error, [], 'Backup failed.');
    const message = /category|read-only/i.test(rawMessage) ? rawMessage : safeBackupClientError(error, 'Backup failed.');
    try { audit(req,'backup failed','backup','manual',{error:message}); } catch {}
    res.status(/already running/i.test(message) ? 409 : /category|read-only/i.test(message) ? 400 : 500).json({ok:false,error:message});
  }
});
app.post('/api/backup/verify', requireAuth, (req:AuthRequest,res)=>{
  try {
    const body = isRecord(req.body) ? req.body : {};
    const category = resolveBackupCategoryForRequest(body.category, body.backupId);
    if (!canViewBackupCategory(req.user!, category)) return res.status(403).json({error:'Permission denied.'});
    res.json(verifyBackup(category, body.backupId));
  } catch (error) {
    const message = safeErrorMessage(error);
    res.status(/not found|missing/i.test(message) ? 404 : /category/i.test(message) ? 400 : 500).json({ok:false,error:safeErrorMessage(error, [], 'Backup verification failed.')});
  }
});
app.post('/api/backup/restore', requireAuth, (req:AuthRequest,res)=>{
  try {
    const body = isRecord(req.body) ? req.body : {};
    const category = resolveBackupCategoryForRequest(body.category, body.backupId);
    if (!canRestoreBackupCategory(req.user!, category)) return res.status(403).json({error:'Permission denied.'});
    const result = restoreBackup({ category, backupId: body.backupId, confirmation: body.confirmation, actor: req.user! });
    res.json({ok:true,...result,message:'Backup restored. Refresh MCC and log in again if needed.'});
  } catch (error) {
    const message = safeErrorMessage(error, [], 'Restore failed.');
    try { audit(req,'master restore failed','backup',isRecord(req.body) ? String(req.body.backupId ?? '') : '',{error:message}); } catch {}
    res.status(/confirm|not found|missing|checksum|category/i.test(message) ? 400 : 500).json({ok:false,error:message});
  }
});
app.get('/api/settings/branding', requireAuth, (_req,res)=>{
  res.json({ok:true,branding:publicBrandingSettings()});
});
app.put('/api/settings/branding', requireAuth, requireOwnerAdmin, (req:AuthRequest,res)=>{
  try {
    const previous = currentBrandingSettings();
    const body = isRecord(req.body) ? req.body : {};
    const next = body.resetToDefault === true ? defaultBrandingSettings : validateBrandingInput(body, previous);
    setAppSettingJson('branding', next, req.user!);
    recordHistoryLog({
      section: 'settings',
      action: body.resetToDefault === true ? 'branding_reset_to_default' : 'branding_updated',
      entityType: 'branding',
      entityLabel: next.logoMode === 'image' ? 'Company logo/icon' : `${next.companyName} ${next.companyAccentText}`.trim(),
      oldValue: publicBrandingSettings(previous),
      newValue: publicBrandingSettings(next),
      actor: req.user!,
    });
    audit(req, body.resetToDefault === true ? 'branding reset to default' : 'branding updated', 'settings', 'branding', {
      oldBranding: publicBrandingSettings(previous),
      newBranding: publicBrandingSettings(next),
    });
    res.json({ok:true,branding:publicBrandingSettings(next),message:body.resetToDefault === true ? 'Branding reset to MCC.' : 'Company branding saved.'});
  } catch (error) {
    const message = safeErrorMessage(error, [], 'Branding update failed.');
    res.status(/required|characters|invalid/i.test(message) ? 400 : 500).json({ok:false,error:message});
  }
});
app.post('/api/settings/branding/logo', requireAuth, requireOwnerAdmin, brandingLogoUpload.single('file'), (req:AuthRequest,res)=>{
  try {
    if (!req.file) throw new Error('Choose a logo/icon file.');
    const extension = allowedLogoMimeTypes[req.file.mimetype];
    if (!extension) throw new Error('Logo/icon must be PNG, JPG, WEBP, or GIF.');
    const fileName = safeBrandingFileName(req.file.originalname, extension);
    const targetPath = path.join(brandingUploadsDir, fileName);
    fs.writeFileSync(targetPath, req.file.buffer);
    const previous = currentBrandingSettings();
    const next = normalizeBrandingSettings({
      ...previous,
      logoMode: 'image',
      logoUrl: `/uploads/branding/${fileName}`,
      logoFileName: fileName,
    });
    setAppSettingJson('branding', next, req.user!);
    recordHistoryLog({
      section: 'settings',
      action: 'branding_logo_uploaded',
      entityType: 'branding',
      entityLabel: 'Company logo/icon',
      oldValue: publicBrandingSettings(previous),
      newValue: publicBrandingSettings(next),
      actor: req.user!,
    });
    audit(req, 'branding logo uploaded', 'settings', 'branding', {
      fileName,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
    });
    res.status(201).json({ok:true,branding:publicBrandingSettings(next),message:'Company logo/icon uploaded.'});
  } catch (error) {
    const message = safeErrorMessage(error, [], 'Logo upload failed.');
    res.status(/choose|must be|file too large|Unexpected field/i.test(message) ? 400 : 500).json({ok:false,error:message});
  }
});
app.get('/api/admin/reset/status', requireAuth, requireOwnerAdmin, (_req,res)=>{
  try {
    res.json(resetStatusCounts());
  } catch (error) {
    res.status(500).json({ok:false,error:safeErrorMessage(error, [], 'Reset status failed.')});
  }
});
app.post('/api/admin/reset/section', requireAuth, requireOwnerAdmin, (req:AuthRequest,res)=>{
  let section = '';
  try {
    const request = validateResetRequest(req.body);
    section = request.section;
    res.json(performReset(req, request));
  } catch (error) {
    const message = safeErrorMessage(error, [], 'Reset failed. No data was removed.');
    try { audit(req,'reset failed','admin_reset',section,{error:message}); } catch {}
    res.status(/invalid|required|confirm|Owner Admin|backup/i.test(message) ? 400 : 500).json({ok:false,error:/backup|already running/i.test(message) ? message : 'Reset failed. No data was removed.'});
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
app.get('/api/requisition-staging', requireAuth, requirePermission('inventory.view'), (req:AuthRequest,res)=>{
  try {
    const items = requisitionStagingList(queryText(req.query.search ?? req.query.q));
    res.json({ok:true,items,openCount:items.length});
  } catch (error) {
    res.status(400).json({ok:false,error:safeErrorMessage(error)});
  }
});
app.post('/api/requisition-staging', requireAuth, requirePermission('inventory.write'), (req:AuthRequest,res)=>{
  const actor = req.user!;
  try {
    const input = validateRequisitionStagingInput(req.body);
    const timestamp = now();
    let itemId = 0;
    db.exec('BEGIN IMMEDIATE');
    try {
      if (input.inventoryPartId) {
        const existing = activeStagingForPart(input.inventoryPartId);
        if (existing) throw new Error(`Inventory part is already staged (staging item ${existing.id}).`);
      }
      const result = run(`INSERT INTO requisition_staging_items (inventory_part_id,part_number,description,vendor_name,supplier_part_number,quantity_requested,unit_cost,location_name,asset_machine,work_order_number,priority,notes,requested_by,date_added,needed_by_date,status,created_requisition_id,created_requisition_number,created_by_user_id,updated_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,'',?,?,?,?)`, [
        input.inventoryPartId,input.partNumber,input.description,input.vendor,input.supplierPartNumber,input.quantityRequested,input.unitCost,input.location,input.assetMachine,input.workOrderNumber,input.priority,input.notes,input.requestedBy || actor.full_name,timestamp,input.neededByDate || null,input.status,actor.id,actor.id,timestamp,timestamp,
      ]);
      itemId = Number(result.lastInsertRowid);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    res.status(201).json({ok:true,item:publicRequisitionStagingItem(requisitionStagingById(itemId)!)});
  } catch (error) {
    const message = safeErrorMessage(error);
    res.status(/already staged/i.test(message) ? 409 : /required|must|invalid|not found/i.test(message) ? 400 : 500).json({ok:false,error:message});
  }
});
app.patch('/api/requisition-staging/:id', requireAuth, requirePermission('inventory.write'), (req:AuthRequest,res)=>{
  const actor = req.user!;
  const itemId = Number(req.params.id);
  try {
    const existing = requisitionStagingById(itemId);
    if (!existing) throw new Error('Staged item not found.');
    if (!isOpenRequisitionStagingStatus(existing.status)) throw new Error('Only open staged items can be edited.');
    const input = validateRequisitionStagingInput(req.body, existing);
    if (input.inventoryPartId) {
      const duplicate = activeStagingForPart(input.inventoryPartId);
      if (duplicate && duplicate.id !== itemId && ['Need to Order','Ready for Requisition'].includes(input.status)) throw new Error(`Inventory part is already staged (staging item ${duplicate.id}).`);
    }
    const timestamp = now();
    db.exec('BEGIN IMMEDIATE');
    try {
      run(`UPDATE requisition_staging_items SET inventory_part_id=?,part_number=?,description=?,vendor_name=?,supplier_part_number=?,quantity_requested=?,unit_cost=?,location_name=?,asset_machine=?,work_order_number=?,priority=?,notes=?,requested_by=?,needed_by_date=?,status=?,updated_by_user_id=?,updated_at=? WHERE id=?`, [
        input.inventoryPartId,input.partNumber,input.description,input.vendor,input.supplierPartNumber,input.quantityRequested,input.unitCost,input.location,input.assetMachine,input.workOrderNumber,input.priority,input.notes,input.requestedBy || actor.full_name,input.neededByDate || null,input.status,actor.id,timestamp,itemId,
      ]);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    res.json({ok:true,item:publicRequisitionStagingItem(requisitionStagingById(itemId)!)});
  } catch (error) {
    const message = safeErrorMessage(error);
    res.status(/not found/i.test(message) ? 404 : /already staged/i.test(message) ? 409 : /required|must|invalid/i.test(message) ? 400 : 500).json({ok:false,error:message});
  }
});
app.post('/api/requisition-staging/clear-selected', requireAuth, requirePermission('inventory.write'), (req:AuthRequest,res)=>{
  try {
    const input = isRecord(req.body) ? req.body : {};
    const ids = Array.isArray(input.ids) ? uniquePositiveIds(input.ids.map(value=>Number(value))) : [];
    if (!ids.length) throw new Error('Select at least one staged item.');
    const placeholders = ids.map(()=>'?').join(',');
    let removedCount = 0;
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = run(`DELETE FROM requisition_staging_items WHERE id IN (${placeholders}) AND status IN ('Need to Order','Ready for Requisition')`, ids);
      removedCount = Number(result.changes);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    res.json({ok:true,removedCount});
  } catch (error) {
    const message = safeErrorMessage(error);
    res.status(/select/i.test(message) ? 400 : 500).json({ok:false,error:message});
  }
});
app.delete('/api/requisition-staging/:id', requireAuth, requirePermission('inventory.write'), (req:AuthRequest,res)=>{
  const itemId = Number(req.params.id);
  try {
    const existing = requisitionStagingById(itemId);
    if (!existing) throw new Error('Staged item not found.');
    if (!isOpenRequisitionStagingStatus(existing.status)) throw new Error('Only open staged items can be removed.');
    db.exec('BEGIN IMMEDIATE');
    try {
      run('DELETE FROM requisition_staging_items WHERE id=?', [itemId]);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    res.json({ok:true,removedId:itemId});
  } catch (error) {
    const message = safeErrorMessage(error);
    res.status(/not found/i.test(message) ? 404 : /only/i.test(message) ? 400 : 500).json({ok:false,error:message});
  }
});
app.post('/api/requisition-staging/create-requisitions', requireAuth, requirePermission('inventory.write'), (req:AuthRequest,res)=>{
  const actor = req.user!;
  try {
    const input = isRecord(req.body) ? req.body : {};
    let requisitions: ReturnType<typeof publicCreatedRequisition>[] = [];
    db.exec('BEGIN IMMEDIATE');
    try {
      requisitions = createRequisitionsFromStaging(req,actor,input);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    res.status(201).json({ok:true,requisition:requisitions[0],requisitions,summary:requisitionSummary()});
  } catch (error) {
    sendRequisitionError(req,res,'requisition create from staging','selection',error);
  }
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
        const part = one<NativePartRow>(`SELECT p.*, l.name AS location_name, v.name AS vendor_name, v.deleted AS vendor_deleted, v.is_active AS vendor_is_active
FROM inventory_parts p
LEFT JOIN inventory_locations l ON l.id=p.location_id AND l.deleted=0
LEFT JOIN inventory_vendors v ON v.id=p.vendor_id
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
      const allowedTransitions: Partial<Record<RequisitionStatus, RequisitionStatus[]>> = {
        Requested: ['Ordered','Received','Canceled'],
        Ordered: ['Received','Canceled'],
      };
      if (!allowedTransitions[existing.status]?.includes(nextStatus)) throw new Error(`A ${existing.status} requisition cannot be changed to ${nextStatus}.`);
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
    res.status(/choose a CSV|must include|must be CSV|numeric|required|already exists/i.test(message) ? 400 : 500).json({ok:false,error:message,addedCount:0,updatedCount:0,skippedCount:0,duplicateMergedCount:0,duplicatesRemovedCount:0,vendorCreatedCount:0,locationCreatedCount:0,invalidUrlCount:0,errorCount:1,errors:[message]});
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
      const result = run(`INSERT INTO inventory_parts (mit3_item_id,part_number,description,location_id,vendor_id,quantity,min_quantity,status,requisition,part_info_url,manufacturer_brand,unit_cost,supplier_part_number,lead_time,important_note,notes,source,imported_from_mit3_at,created_by_user_id,updated_by_user_id,created_at,updated_at,deleted) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`, [null,input.partNumber,input.description,location.id,vendor.id,input.quantity,input.minQuantity,input.status,'',input.partInfoUrl,input.manufacturerBrand,input.unitCost,input.supplierPartNumber,input.leadTime,input.importantNote,'','mcc',null,actor.id,actor.id,timestamp,timestamp]);
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
      run(`UPDATE inventory_parts SET part_number=?, description=?, location_id=?, vendor_id=?, quantity=?, min_quantity=?, status=?, part_info_url=?, manufacturer_brand=?, unit_cost=?, supplier_part_number=?, lead_time=?, important_note=?, source=?, updated_by_user_id=?, updated_at=? WHERE id=?`, [input.partNumber,input.description,location.id,vendor.id,input.quantity,input.minQuantity,input.status,input.partInfoUrl,input.manufacturerBrand,input.unitCost,input.supplierPartNumber,input.leadTime,input.importantNote,'mcc',actor.id,timestamp,partId]);
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
          if (errors.length < 12) errors.push('Skipped one retired import item because it did not have a source item ID or part number.');
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
    inventoryAudit(req,'retired inventory import','inventory','native',{importedCount,updatedCount,skippedCount,skippedUrlCount,vendorCount:summary.vendorCount,locationCount:summary.locationCount});
    audit(req,'inventory retired import','inventory','native',{importedCount,updatedCount,skippedCount,skippedUrlCount});
    res.json(response);
  } catch (error) {
    const message = safeErrorMessage(error);
    inventoryAudit(req,'failed retired inventory import','inventory','native',{error:message});
    audit(req,'failed inventory retired import','inventory','native',{error:message});
    const summary = nativeInventorySummary();
    res.status(/retired inventory import source|unavailable|app-data/i.test(message) ? 503 : 500).json({ok:false,error:message,importedCount:0,updatedCount:0,skippedCount:0,vendorCount:summary.vendorCount,locationCount:summary.locationCount,errors:[message],nativeSummary:summary});
  }
});
app.get('/api/inventory/mit3-status', requireAuth, requirePermission('inventory.view'), async (_req,res)=>res.json(await checkMit3Status()));
app.get('/api/inventory/mit3-parts', requireAuth, requirePermission('inventory.view'), async (_req,res)=>{
  try {
    res.json({ok:true,mit3Url,writeAvailable:true,...await fetchMit3Inventory()});
  } catch (error) {
    res.status(503).json({ok:false,error:error instanceof Error ? error.message : 'Retired inventory bridge unavailable.',mit3Url});
  }
});
app.post('/api/inventory/mit3-parts', requireAuth, requirePermission('inventory.write'), async (req,res)=>{
  const operation = 'inventory add through retired inventory bridge';
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
  const operation = 'inventory edit through retired inventory bridge';
  const targetId = String(req.params.id ?? '');
  try {
    const input = validateMit3PartInput(req.body);
    const {part,id} = await mutateMit3Inventory(req, operation, targetId, data => {
      const items = recordArray(data, 'items');
      const index = findMit3Item(items, targetId);
      if (index < 0 || !isRecord(items[index])) throw new Error('Retired inventory item not found.');
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
  const operation = 'inventory requisition update through retired inventory bridge';
  const targetId = String(req.params.id ?? '');
  try {
    const input = isRecord(req.body) ? req.body : {};
    const requisition = Boolean(input.requisition ?? input.orderPlaced);
    const {part,id} = await mutateMit3Inventory(req, operation, targetId, data => {
      const items = recordArray(data, 'items');
      const index = findMit3Item(items, targetId);
      if (index < 0 || !isRecord(items[index])) throw new Error('Retired inventory item not found.');
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
  startBackupSchedulers();
});
