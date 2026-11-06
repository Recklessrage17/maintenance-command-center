import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { validatePortablePackage, verifyPortableArchiveMatchesPackage, sha256FileSync, portablePackageRoot } from './portableBackup.js';

export const MASTER_RETENTION_LIMIT = 3;
const idPattern = /^MCC_Master_Backup_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)_(master_manual|master_scheduled)$/;
const journalPattern = /^\.master-retention-[0-9a-f-]{36}\.json$/;
type Entry = { relative: string; sha256: string };
export type MasterSet = { id: string; createdAt: string; type: string; sizeBytes: number; archive: string; fingerprint: string; verified: true; publication?: string };
type Journal = { version: 1; set: MasterSet; files: Entry[]; directories: string[] };
export type RetentionPreview = {
  limit: number; verifiedCount: number; keep: MasterSet[]; candidates: MasterSet[];
  excluded: { id: string; reason: string }[]; pending: { id: string; journal: string; fingerprint: string }[]; fingerprint: string;
};
export type MasterRetentionOptions = { masterRoot: string; portableRoot: string; appVersion: string; secret: string };
export type MasterRetentionStatus = { limit: number; verifiedCount: number; excludedCount: number; pendingCount: number; unknownCount: number; latestVerified: string | null; checkedAt: string | null; verificationInProgress: boolean; secretConfigured: boolean; sets: MasterSet[] };

function digest(value: string) { return crypto.createHash('sha256').update(value).digest('hex'); }
function fail(message: string): never { throw new Error(message); }
function syncDirectory(directory:string) {
  if (process.platform==='win32') return; // Windows does not expose directory fsync through Node.
  const descriptor=fs.openSync(directory,'r');
  try {fs.fsyncSync(descriptor);} finally {fs.closeSync(descriptor);}
}
function syncFile(filename:string) {
  noLinks(filename);
  const descriptor=fs.openSync(filename,process.platform==='win32'?'r+':'r');
  try {fs.fsyncSync(descriptor);} finally {fs.closeSync(descriptor);}
}

// Inspect every ancestor, not just the final path; Windows junctions are links.
function noLinks(target: string, missing = false) {
  const absolute = path.resolve(target);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const segment of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try { if (fs.lstatSync(current).isSymbolicLink()) fail('Links/junctions are protected.'); }
    catch (error) { if (missing && (error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  }
  if (fs.existsSync(absolute) && fs.realpathSync(absolute) !== absolute) fail('Canonical path mismatch.');
}

function child(root: string, id: string, missing = false) {
  const resolvedRoot = path.resolve(root);
  noLinks(resolvedRoot);
  const target = path.resolve(resolvedRoot, id);
  if (!id || id !== path.basename(id) || id.includes('..') || /[\\/:\0]/.test(id) || path.dirname(target) !== resolvedRoot) fail('Unsafe retention path.');
  noLinks(target, missing);
  return target;
}

function tree(root: string) {
  const files: Entry[] = []; const directories: string[] = [];
  function visit(current: string) {
    noLinks(current);
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a,b)=>a.name.localeCompare(b.name))) {
      const target = path.join(current, entry.name);
      noLinks(target);
      const stat = fs.lstatSync(target);
      const relative = path.relative(root, target).split(path.sep).join('/');
      if (stat.isDirectory()) { directories.push(relative); visit(target); }
      else if (stat.isFile() && stat.nlink === 1) files.push({ relative, sha256: sha256FileSync(target) });
      else fail('Unsupported or hard-linked retention entry.');
    }
  }
  visit(root);
  return { files, directories };
}

export class MasterRetention {
  private readonly verified = new Map<string, { set: MasterSet; stamp: string; checkedAt: string }>();
  constructor(private readonly options: MasterRetentionOptions) {}

  // Metadata only: detects ordinary replacement/edit/removal, never authorizes
  // deletion. Content hashes, SQLite and ZIP validation remain in verify().
  private stamp(set: MasterSet) {
    const entries: unknown[] = [];
    const visit = (filename: string) => {
      const stat = fs.lstatSync(filename, { bigint: true });
      if (stat.isSymbolicLink()) fail('Linked status entry.');
      if (stat.nlink !== 1n && !stat.isDirectory()) fail('Hard-linked status entry.');
      entries.push([filename, String(stat.dev), String(stat.ino), String(stat.size), String(stat.mtimeNs), String(stat.ctimeNs)]);
      if (stat.isDirectory()) for (const name of fs.readdirSync(filename).sort()) visit(path.join(filename,name));
      else if (!stat.isFile()) fail('Unsupported status entry.');
    };
    visit(child(this.options.masterRoot,set.id));
    visit(child(this.options.portableRoot,set.archive));
    visit(child(this.options.portableRoot,`${set.archive}.sha256`));
    if (set.publication) visit(child(this.options.masterRoot,set.publication));
    return JSON.stringify(entries);
  }

  status(): MasterRetentionStatus {
    noLinks(this.options.masterRoot); noLinks(this.options.portableRoot);
    const names = fs.readdirSync(this.options.masterRoot);
    const pendingCount = names.filter(name=>name.startsWith('.master-retention-')).length;
    const normal = names.filter(name=>idPattern.test(name));
    for (const [id, saved] of this.verified) {
      try { if (!normal.includes(id) || this.stamp(saved.set)!==saved.stamp) this.verified.delete(id); }
      catch { this.verified.delete(id); }
    }
    const saved = [...this.verified.values()].sort((a,b)=>b.set.createdAt.localeCompare(a.set.createdAt));
    const receipts = new Set(normal.map(id=>`.master-published-${id}.json`));
    return {limit:3,verifiedCount:saved.length,excludedCount:names.filter(name=>!idPattern.test(name)&&!name.startsWith('.master-retention-')&&!receipts.has(name)).length,
      pendingCount,unknownCount:normal.length-saved.length,latestVerified:saved.map(item=>item.checkedAt).sort().at(-1)??null,
      checkedAt:new Date().toISOString(),verificationInProgress:false,secretConfigured:Boolean(this.options.secret),sets:saved.map(item=>item.set)};
  }

  async verify(id: string, publishing = false): Promise<MasterSet> {
    this.verified.delete(id);
    const match = idPattern.exec(id);
    if (!match) fail('Unrecognized normal Master backup ID; protected.');
    const folder = child(this.options.masterRoot, id);
    if (!fs.lstatSync(folder).isDirectory()) fail('Master package is not a directory.');
    const before = tree(folder);
    const { manifest } = validatePortablePackage(folder, this.options.appVersion);
    if (manifest.backupId !== undefined && manifest.backupId !== id) fail('Master manifest backup ID mismatch.');
    if (manifest.backupCategory !== 'master' || manifest.backupType !== match[2]) fail('Master manifest type/ID mismatch.');
    const date = new Date(manifest.createdAt);
    if (!Number.isFinite(date.getTime()) || date.toISOString() !== manifest.createdAt) fail('Invalid UTC creation time.');
    // IDs were historically stamped just after createdAt. Permit at most one
    // second of rounding/clock skew, never an arbitrary manifest date.
    const idDate = match[1].replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, 'T$1:$2:$3.$4Z');
    if (Math.abs(Date.parse(idDate) - date.getTime()) > 1000) fail('Master manifest date/ID mismatch.');
    const packageRoot = String(manifest.portableArchive?.packageRoot ?? '');
    const base = portablePackageRoot(manifest.createdAt);
    if (packageRoot !== base && !new RegExp(`^${base}_(?:[2-9]|[1-9][0-9]+)$`).test(packageRoot)) fail('Master archive date/ID mismatch.');
    const archive = String(manifest.portableArchive?.filename ?? '');
    if (archive !== `${packageRoot}.zip`) fail('Master archive linkage mismatch.');
    for (const other of fs.readdirSync(this.options.masterRoot)) {
      if (other === id || other.startsWith('.master-retention-') || other.startsWith('.master-published-')) continue;
      const otherPath = child(this.options.masterRoot,other);
      if (!fs.lstatSync(otherPath).isDirectory()) continue;
      const otherManifest = path.join(otherPath,'manifest.json');
      if (!fs.existsSync(otherManifest)) continue;
      noLinks(otherManifest);
      let linked: { portableArchive?: { filename?: string } };
      try { linked = JSON.parse(fs.readFileSync(otherManifest,'utf8')); } catch { continue; }
      if (linked?.portableArchive?.filename === archive) fail('Portable archive is shared by multiple packages; protected.');
    }
    const archivePath = child(this.options.portableRoot, archive);
    const sidecar = child(this.options.portableRoot, `${archive}.sha256`);
    for (const file of [archivePath, sidecar]) {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.nlink !== 1) fail('Unsupported or hard-linked archive.');
    }
    const archiveHash = sha256FileSync(archivePath);
    if (fs.readFileSync(sidecar, 'utf8') !== `${archiveHash}  ${archive}\n`) fail('Master ZIP checksum sidecar mismatch.');
    await verifyPortableArchiveMatchesPackage(archivePath, folder, manifest);
    const after = tree(folder);
    if (JSON.stringify(before) !== JSON.stringify(after) || sha256FileSync(archivePath) !== archiveHash) fail('Master set changed during verification.');
    const fingerprint = digest(JSON.stringify({ id, ...after, archive, archiveHash, sidecar: sha256FileSync(sidecar) }));
    const sizeBytes = after.files.reduce((n,file)=>n + fs.statSync(path.join(folder, file.relative)).size,0) + fs.statSync(archivePath).size + fs.statSync(sidecar).size;
    const publication = manifest.masterRetentionVersion === 1 ? `.master-published-${id}.json` : undefined;
    if (publication && !publishing) {
      const receipt=JSON.parse(fs.readFileSync(child(this.options.masterRoot,publication),'utf8'));
      if (receipt.fingerprint!==fingerprint || receipt.signature!==this.publicationSignature(id,fingerprint)) fail('Master publication receipt mismatch; protected.');
    }
    const set: MasterSet = { id, createdAt: manifest.createdAt, type: manifest.backupType, sizeBytes, archive, fingerprint, verified: true, ...(publication?{publication}:{}) };
    if (!publishing) this.verified.set(id,{set,stamp:this.stamp(set),checkedAt:new Date().toISOString()});
    return set;
  }

  private requireSecret() { if (!this.options.secret) fail('A persistent SESSION_SECRET is required for Master retention; backups are protected.'); }
  private publicationSignature(id:string,fingerprint:string) { this.requireSecret(); return crypto.createHmac('sha256',this.options.secret).update(`mcc-master-published-v1:${id}:${fingerprint}`).digest('hex'); }

  async publish(id:string) {
    this.requireSecret();
    const set=await this.verify(id,true);
    if (!set.publication) fail('New Master package requires a publication receipt.');
    const folder=child(this.options.masterRoot,id);
    const inventory=tree(folder);
    for (const file of inventory.files) syncFile(path.join(folder,file.relative));
    for (const dir of [...inventory.directories].sort((a,b)=>b.split('/').length-a.split('/').length)) syncDirectory(path.join(folder,dir));
    syncDirectory(folder);
    const zip=child(this.options.portableRoot,set.archive);
    syncFile(zip);syncFile(`${zip}.sha256`);syncDirectory(this.options.portableRoot);
    const descriptor=fs.openSync(child(this.options.masterRoot,set.publication,true),'wx',0o600);
    try {fs.writeFileSync(descriptor,JSON.stringify({fingerprint:set.fingerprint,signature:this.publicationSignature(id,set.fingerprint)}));fs.fsyncSync(descriptor);}
    finally {fs.closeSync(descriptor);}
    syncDirectory(this.options.masterRoot);
    this.verified.set(id,{set,stamp:this.stamp(set),checkedAt:new Date().toISOString()});
    return set;
  }

  private readJournal(name: string) {
    if (!journalPattern.test(name)) fail('Invalid retention journal.');
    const filename = child(this.options.masterRoot, name);
    const raw = fs.readFileSync(filename, 'utf8');
    const saved = JSON.parse(raw) as { plan: Journal; signature: string };
    const signature = this.sign(saved.plan);
    if (saved.signature !== signature || saved.plan.version !== 1 || !idPattern.test(saved.plan.set.id)) fail('Untrusted retention journal; operator review required.');
    return { plan: saved.plan, fingerprint: digest(raw), filename };
  }

  private sign(plan: Journal) { this.requireSecret(); return crypto.createHmac('sha256', this.options.secret).update(`mcc-master-retention-v1:${JSON.stringify(plan)}`).digest('hex'); }

  async preview(): Promise<RetentionPreview> {
    noLinks(this.options.masterRoot); noLinks(this.options.portableRoot);
    const valid: MasterSet[] = []; const excluded: RetentionPreview['excluded'] = []; const pending: RetentionPreview['pending'] = [];
    const names = fs.readdirSync(this.options.masterRoot).sort();
    const pendingIds = new Set<string>();
    for (const name of names.filter(name=>name.startsWith('.master-retention-'))) {
      try { const saved = this.readJournal(name); pendingIds.add(saved.plan.set.id); pending.push({ id: saved.plan.set.id, journal: name, fingerprint: saved.fingerprint }); }
      catch { excluded.push({ id: name, reason: 'Untrusted/interrupted cleanup journal; operator review required.' }); }
    }
    for (const name of names.filter(name=>!name.startsWith('.master-retention-')&&!name.startsWith('.master-published-'))) {
      if (pendingIds.has(name)) continue;
      try { valid.push(await this.verify(name)); }
      catch (error) { excluded.push({ id: name, reason: error instanceof Error ? error.message : 'Verification failed; protected.' }); }
    }
    valid.sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
    const result = { limit: MASTER_RETENTION_LIMIT, verifiedCount: valid.length, keep: valid.slice(0,MASTER_RETENTION_LIMIT), candidates: valid.slice(MASTER_RETENTION_LIMIT), excluded, pending };
    return { ...result, fingerprint: digest(JSON.stringify(result)) };
  }

  // No recursive deletion: a durable, authenticated allowlist records precisely
  // the verified files. Missing files are idempotent after interruption. Changed
  // or extra files stop cleanup; they are never inferred to be owned.
  private executeJournal(name: string) {
    const { plan, filename } = this.readJournal(name);
    const folder = child(this.options.masterRoot, plan.set.id, true);
    const zip = child(this.options.portableRoot, plan.set.archive, true);
    const expected = new Map(plan.files.map(file=>[file.relative,file.sha256]));
    const target = (relative: string) => {
      if (relative === '@zip') return zip;
      if (relative === '@sha') return `${zip}.sha256`;
      if (relative === '@publication' && plan.set.publication === `.master-published-${plan.set.id}.json`) return child(this.options.masterRoot,plan.set.publication,true);
      if (!relative || relative.includes('\\') || relative.split('/').some(p=>!p || p==='.' || p==='..' || p.includes(':'))) fail('Unsafe journal entry.');
      const resolved = path.resolve(folder, ...relative.split('/'));
      if (!resolved.startsWith(`${folder}${path.sep}`)) fail('Unsafe journal containment.');
      return resolved;
    };
    if (fs.existsSync(folder)) {
      const actual = tree(folder);
      if (actual.files.some(file=>expected.get(file.relative)!==file.sha256) || actual.directories.some(dir=>!plan.directories.includes(dir))) fail('Cleanup interrupted: package changed; operator review required.');
    }
    for (const file of plan.files) {
      const item = target(file.relative); noLinks(item,true);
      if (fs.existsSync(item)) {
        const stat = fs.lstatSync(item);
        if (!stat.isFile() || stat.nlink !== 1 || sha256FileSync(item) !== file.sha256) fail('Cleanup target changed; operator review required.');
      }
    }
    for (const file of plan.files) {
      const item = target(file.relative); noLinks(item,true);
      if (fs.existsSync(item)) {
        if (sha256FileSync(item) !== file.sha256) fail('Cleanup target changed.');
        fs.unlinkSync(item);
      }
    }
    if (fs.existsSync(folder)) {
      for (const dir of [...plan.directories].sort((a,b)=>b.split('/').length-a.split('/').length)) {
        const item = target(dir); noLinks(item,true); if (fs.existsSync(item)) fs.rmdirSync(item);
      }
      fs.rmdirSync(folder);
    }
    fs.unlinkSync(filename);
    syncDirectory(this.options.portableRoot);syncDirectory(this.options.masterRoot);
  }

  async cleanup(input: { preview: RetentionPreview; automaticNewId?: string }) {
    this.requireSecret();
    const current = await this.preview();
    if (current.fingerprint !== input.preview.fingerprint) fail('Backup inventory changed. Preview cleanup again.');
    const removed: string[] = []; const failed: { id: string; reason: string }[] = [];
    if (input.automaticNewId && !current.keep.some(set=>set.id===input.automaticNewId)) fail('New Master set is not a newest verified survivor; nothing pruned.');
    if (current.excluded.some(entry=>entry.id.startsWith('.master-retention-'))) fail('Untrusted cleanup journal; operator review required before cleanup.');
    // Historical backlog and interrupted work always require an admin preview.
    const candidates = input.automaticNewId ? current.pending.length ? [] : current.candidates.slice(-1) : current.candidates.slice().reverse();
    const work = input.automaticNewId ? [] : current.pending;
    for (const entry of [...work.map(p=>({id:p.id,journal:p.journal})), ...candidates.map(set=>({id:set.id,journal:''}))]) {
      try {
        // All three survivors must still validate immediately before each delete.
        if (current.keep.length !== MASTER_RETENTION_LIMIT) fail('Fewer than three verified survivors; nothing pruned.');
        for (const survivor of current.keep) if ((await this.verify(survivor.id)).fingerprint !== survivor.fingerprint) fail('Surviving Master backup changed.');
        let name = entry.journal;
        if (!name) {
          const set = await this.verify(entry.id);
          if (set.fingerprint !== candidates.find(candidate=>candidate.id===entry.id)!.fingerprint) fail('Cleanup candidate changed.');
          const inventory = tree(child(this.options.masterRoot, entry.id));
          const zip = child(this.options.portableRoot, set.archive);
          const plan: Journal = { version:1, set, directories:inventory.directories, files:[
            {relative:'@zip',sha256:sha256FileSync(zip)}, {relative:'@sha',sha256:sha256FileSync(`${zip}.sha256`)},
            ...(set.publication?[{relative:'@publication',sha256:sha256FileSync(child(this.options.masterRoot,set.publication))}]:[]),
            ...inventory.files.filter(file=>file.relative!=='manifest.json'), ...inventory.files.filter(file=>file.relative==='manifest.json'),
          ] };
          name = `.master-retention-${crypto.randomUUID()}.json`;
          const descriptor = fs.openSync(child(this.options.masterRoot,name,true),'wx',0o600);
          try { fs.writeFileSync(descriptor,JSON.stringify({plan,signature:this.sign(plan)})); fs.fsyncSync(descriptor); }
          finally { fs.closeSync(descriptor); }
          syncDirectory(this.options.masterRoot);
        }
        this.executeJournal(name); removed.push(entry.id);
      } catch (error) { failed.push({id:entry.id,reason:error instanceof Error?error.message:'Cleanup failed.'}); break; }
    }
    const final = removed.length || failed.length ? await this.preview() : current;
    return { removed, failed, retained:final.verifiedCount, skipped:final.excluded.length, pending:final.pending.length, preview:final };
  }
}
