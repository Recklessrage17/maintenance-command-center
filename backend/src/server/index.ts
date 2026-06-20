import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express, { type NextFunction, type Request, type Response } from 'express';
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
const frontendDistPath = path.resolve(__dirname, '../../../frontend/dist');
const dataDir = path.resolve(__dirname, '../../data');
const dbPath = path.join(dataDir, 'mcc.sqlite');
const isProd = process.env.NODE_ENV === 'production';
const sessionSecretConfigured = Boolean(process.env.SESSION_SECRET);
const smtpConfigured = Boolean(process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.SMTP_FROM);
const smtpPort = Number(process.env.SMTP_PORT ?? 587);
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(48).toString('hex');
fs.mkdirSync(dataDir, { recursive: true });
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
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);`);
}
initDb();
function migrateDb() {
  const userColumns = new Set(all<{ name: string }>('PRAGMA table_info(users)').map(column => column.name));
  if (!userColumns.has('is_owner_admin')) run('ALTER TABLE users ADD COLUMN is_owner_admin INTEGER NOT NULL DEFAULT 0');
  if (!userColumns.has('deleted')) run('ALTER TABLE users ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0');
  if (!userColumns.has('deleted_at')) run('ALTER TABLE users ADD COLUMN deleted_at TEXT');
  if (!userColumns.has('deleted_by_user_id')) run('ALTER TABLE users ADD COLUMN deleted_by_user_id INTEGER');

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
function safeErrorMessage(error: unknown, extraSecrets: string[] = []) {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of [process.env.SMTP_PASS, ...extraSecrets]) {
    if (secret) message = message.split(secret).join('[redacted]');
  }
  return message.replace(/\s+/g, ' ').slice(0, 300) || 'Unknown SMTP error.';
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

function requireAuth(req: AuthRequest, res: Response, next: NextFunction) { const sid=unsign(cookie(req,'mcc_session')); if (!sid) return res.status(401).json({error:'Login required.'}); const s=one<{user_id:number}>('SELECT user_id FROM sessions WHERE id=? AND expires_at > ?', [sid,now()]); const u=s && findUserById(s.user_id); if (!u) return res.status(401).json({error:'Login required.'}); if (u.disabled) { clearSession(req,res); return res.status(403).json({error:'Account disabled.'}); } req.user=u; req.sessionId=sid; next(); }
function requirePermission(permission: string) { return (req: AuthRequest,res:Response,next:NextFunction) => { const role=req.user!.role; const userMgmt=role !== 'Maintenance Tech 1'; const ok = ['dashboard.view','inventory.view','settings.view'].includes(permission) || (['users.view','users.create','users.edit','users.disable','users.delete','users.resetPassword'].includes(permission)&&userMgmt) || (permission==='audit.view'&&['Admin','Manager'].includes(role)); return ok ? next() : res.status(403).json({error:'Permission denied.'}); }; }

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
      const safeMessage = safeErrorMessage(error, [temp]);
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
app.get('/api/inventory/mit3-status', requireAuth, requirePermission('inventory.view'), async (_req,res)=>res.json(await checkMit3Status()));
app.use(express.static(frontendDistPath));
app.get('*', (_req,res)=>res.sendFile(path.join(frontendDistPath,'index.html')));
app.listen(port,()=>{
  console.log(`${appName} running at http://localhost:${port}`);
  console.log(`SESSION_SECRET configured: ${sessionSecretConfigured ? 'yes' : 'no'}`);
  console.log(`SMTP configured: ${smtpConfigured ? 'yes' : 'no'}`);
});
