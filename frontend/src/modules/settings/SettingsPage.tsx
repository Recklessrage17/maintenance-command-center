import { useEffect, useState } from 'react';

type NetworkLinks = {
  localPort: number;
  localhostUrl: string;
  detectedLanUrls: string[];
  primaryLanUrl: string | null;
};

type BackupType = 'startup' | 'scheduled' | 'auto' | 'manual' | 'pre_restore';
type BackupSummary = {
  id: string;
  name: string;
  type: BackupType;
  typeLabel: string;
  createdAt: string;
  sizeBytes: number;
  databaseSizeBytes: number;
  recordCounts: Record<string, number>;
  includedPaths: string[];
  notes: string;
  restorable: boolean;
};
type BackupStatus = {
  ok: boolean;
  latestBackup: BackupSummary | null;
  backupFolderExists: boolean;
  backupCountsByType: Record<BackupType, number>;
  lastBackupResult: { ok: boolean; message: string; backupId?: string; createdAt?: string };
  nextScheduledBackupAt: string | null;
  databaseSize: number;
  backupHealth: string;
  autoBackupDelaySeconds: number;
  scheduledBackupIntervalMinutes: number;
  permissions: {
    canViewBackups: boolean;
    canCreateBackup: boolean;
    canRestoreBackup: boolean;
  };
};
type ManualBackupProgress = {
  state: 'idle' | 'running' | 'success' | 'error';
  activeStep: number;
  message: string;
  completedAt?: string;
};

const backupStepLabels = [
  'Preparing backup folder',
  'Snapshotting MCC database',
  'Copying MCC files/uploads if present',
  'Writing backup manifest',
  'Verifying backup',
  'Refreshing backup status',
  'Complete',
];
const emptyBackupCounts: Record<BackupType, number> = { startup: 0, scheduled: 0, auto: 0, manual: 0, pre_restore: 0 };
const emptyBackupPermissions = { canViewBackups: false, canCreateBackup: false, canRestoreBackup: false };

async function api(path:string, options:RequestInit={}) {
  const res=await fetch(path,{credentials:'include',headers:{'Content-Type':'application/json',...(options.headers??{})},...options});
  const data=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeBackupSummary(value: unknown): BackupSummary | null {
  const data = asRecord(value);
  const type = String(data.type ?? 'manual') as BackupType;
  if (!data.id && !data.name && !data.createdAt) return null;
  return {
    id: String(data.id ?? data.name ?? ''),
    name: String(data.name ?? data.id ?? 'MCC master backup'),
    type,
    typeLabel: String(data.typeLabel ?? typeLabel(type)),
    createdAt: String(data.createdAt ?? ''),
    sizeBytes: Number(data.sizeBytes ?? 0),
    databaseSizeBytes: Number(data.databaseSizeBytes ?? 0),
    recordCounts: asRecord(data.recordCounts) as Record<string, number>,
    includedPaths: Array.isArray(data.includedPaths) ? data.includedPaths.map(String) : [],
    notes: String(data.notes ?? ''),
    restorable: Boolean(data.restorable ?? false),
  };
}

function normalizeBackupStatus(value: unknown): BackupStatus {
  const data = asRecord(value);
  const counts = asRecord(data.backupCountsByType);
  const permissions = asRecord(data.permissions);
  const lastResult = asRecord(data.lastBackupResult);
  return {
    ok: data.ok !== false,
    latestBackup: normalizeBackupSummary(data.latestBackup),
    backupFolderExists: Boolean(data.backupFolderExists),
    backupCountsByType: {
      startup: Number(counts.startup ?? 0),
      scheduled: Number(counts.scheduled ?? 0),
      auto: Number(counts.auto ?? 0),
      manual: Number(counts.manual ?? 0),
      pre_restore: Number(counts.pre_restore ?? 0),
    },
    lastBackupResult: {
      ok: lastResult.ok !== false,
      message: String(lastResult.message ?? 'No master backup has run yet.'),
      backupId: lastResult.backupId ? String(lastResult.backupId) : undefined,
      createdAt: lastResult.createdAt ? String(lastResult.createdAt) : undefined,
    },
    nextScheduledBackupAt: data.nextScheduledBackupAt ? String(data.nextScheduledBackupAt) : null,
    databaseSize: Number(data.databaseSize ?? 0),
    backupHealth: String(data.backupHealth ?? 'Checking...'),
    autoBackupDelaySeconds: Number(data.autoBackupDelaySeconds ?? 45),
    scheduledBackupIntervalMinutes: Number(data.scheduledBackupIntervalMinutes ?? 60),
    permissions: {
      canViewBackups: Boolean(permissions.canViewBackups),
      canCreateBackup: Boolean(permissions.canCreateBackup),
      canRestoreBackup: Boolean(permissions.canRestoreBackup),
    },
  };
}

function CopyUrl({url,onCopied}:{url:string;onCopied:(value:string)=>void}) {
  async function copy() {
    await navigator.clipboard.writeText(url);
    onCopied(url);
  }
  return (
    <div className="share-url-row">
      <code title={url}>{url}</code>
      <button className="secondary-button compact-button" type="button" aria-label={`Copy ${url}`} onClick={()=>{void copy();}}>Copy</button>
    </div>
  );
}

export function SettingsPage() {
  const [links,setLinks]=useState<NetworkLinks|null>(null);
  const [backupStatus,setBackupStatus]=useState<BackupStatus|null>(null);
  const [backups,setBackups]=useState<BackupSummary[]>([]);
  const [showBackups,setShowBackups]=useState(false);
  const [restoreTarget,setRestoreTarget]=useState<BackupSummary|null>(null);
  const [restoreConfirmation,setRestoreConfirmation]=useState('');
  const [msg,setMsg]=useState('');
  const [loading,setLoading]=useState(false);
  const [backupLoading,setBackupLoading]=useState(false);
  const [manualBackupProgress,setManualBackupProgress]=useState<ManualBackupProgress>({state:'idle',activeStep:0,message:''});
  const [lastManualBackupResult,setLastManualBackupResult]=useState<{ok:boolean;message:string;createdAt:string}|null>(null);
  const detectedLanUrls = links?.detectedLanUrls ?? [];
  const primaryLanUrl = links?.primaryLanUrl ?? detectedLanUrls[0] ?? '';
  const backupPermissions = backupStatus?.permissions ?? emptyBackupPermissions;
  const backupCounts = backupStatus?.backupCountsByType ?? emptyBackupCounts;
  const displayedBackupResult = lastManualBackupResult ?? backupStatus?.lastBackupResult ?? null;

  function loadLinks() {
    setLoading(true);
    api('/api/settings/network-links')
      .then(data=>{ setLinks(data); setMsg(''); })
      .catch(e=>setMsg(e.message))
      .finally(()=>setLoading(false));
  }

  function loadBackupStatus(options: { quiet?: boolean } = {}) {
    if (!options.quiet) setBackupLoading(true);
    return api('/api/backup/status')
      .then(data=>{ setBackupStatus(normalizeBackupStatus(data)); setMsg(''); })
      .catch(e=>setMsg(e.message))
      .finally(()=>{ if (!options.quiet) setBackupLoading(false); });
  }

  function loadBackups(options: { quiet?: boolean } = {}) {
    if (!options.quiet) setBackupLoading(true);
    return api('/api/backup/list')
      .then(data=>{
        const backupList = Array.isArray(data.backups) ? (data.backups as unknown[]).map(normalizeBackupSummary).filter((backup): backup is BackupSummary => Boolean(backup)) : [];
        setBackups(backupList);
        setShowBackups(true);
        setMsg('');
      })
      .catch(e=>setMsg(e.message))
      .finally(()=>{ if (!options.quiet) setBackupLoading(false); });
  }

  async function createManualBackup() {
    if (manualBackupProgress.state === 'running') return;
    setBackupLoading(true);
    setMsg('');
    setManualBackupProgress({state:'running',activeStep:0,message:'Creating MCC Master Backup'});
    try {
      const data = await api('/api/backup/create',{method:'POST',body:JSON.stringify({})});
      const nextStatus = normalizeBackupStatus(data.status ?? data);
      setBackupStatus(nextStatus);
      const message = String(data.message ?? (data.ok === false ? 'Backup failed.' : 'Manual backup created successfully.'));
      if (data.ok === false) throw new Error(message);
      setManualBackupProgress({state:'success',activeStep:backupStepLabels.length - 1,message,completedAt:new Date().toISOString()});
      setLastManualBackupResult({ok:true,message:'Last manual backup succeeded.',createdAt:new Date().toISOString()});
      setMsg(message);
      await loadBackupStatus({quiet:true});
      if (showBackups) await loadBackups({quiet:true});
    } catch (e) {
      const rawMessage = (e as Error).message || 'Backup failed.';
      const message = rawMessage.replace(/\s+/g, ' ').slice(0, 180);
      const safeMessage = !message || message === 'Backup failed.' || message === 'Request failed.'
        ? 'Backup failed. Settings is still safe. Check server console/logs.'
        : `Backup failed. Settings is still safe. ${message}`;
      setManualBackupProgress({state:'error',activeStep:Math.min(manualBackupProgress.activeStep, backupStepLabels.length - 2),message:safeMessage,completedAt:new Date().toISOString()});
      setLastManualBackupResult({ok:false,message:'Last manual backup failed.',createdAt:new Date().toISOString()});
      setMsg(safeMessage);
      await loadBackupStatus({quiet:true}).catch(()=>undefined);
    } finally {
      setBackupLoading(false);
    }
  }

  function verifyBackup(backup: BackupSummary) {
    setBackupLoading(true);
    api('/api/backup/verify',{method:'POST',body:JSON.stringify({backupId:backup.id})})
      .then(data=>setMsg(data.message ?? 'Backup verified.'))
      .catch(e=>setMsg(e.message))
      .finally(()=>setBackupLoading(false));
  }

  function restoreBackup() {
    if (!restoreTarget) return;
    setBackupLoading(true);
    api('/api/backup/restore',{method:'POST',body:JSON.stringify({backupId:restoreTarget.id,confirmation:restoreConfirmation})})
      .then(data=>{
        setMsg(data.message ?? 'Backup restored. Refresh MCC before continuing.');
        setRestoreTarget(null);
        setRestoreConfirmation('');
        setBackups([]);
        setShowBackups(false);
        loadBackupStatus();
      })
      .catch(e=>setMsg(e.message))
      .finally(()=>setBackupLoading(false));
  }

  useEffect(()=>{
    loadLinks();
    loadBackupStatus();
  },[]);
  useEffect(()=>{
    if (manualBackupProgress.state !== 'running' || manualBackupProgress.activeStep >= backupStepLabels.length - 2) return;
    const timer = window.setTimeout(()=>{
      setManualBackupProgress(current=>current.state === 'running' ? {...current,activeStep:Math.min(current.activeStep + 1, backupStepLabels.length - 2)} : current);
    }, 700);
    return () => window.clearTimeout(timer);
  },[manualBackupProgress.activeStep,manualBackupProgress.state]);

  return (
    <div className="page-stack settings-page">
      <div className="page-heading">
        <p className="eyebrow">Settings</p>
        <h2>MCC Settings</h2>
        <p>Share local access details without exposing SMTP, session, database, or private system settings.</p>
      </div>

      <article className="mcc-card wide-card share-card">
        <div className="share-card-heading">
          <div>
            <span>Network access</span>
            <strong>Share MCC to another device</strong>
            <p>MCC runs on port {links?.localPort ?? 4273}. Use these links only on devices connected to the same plant network.</p>
          </div>
          <button className="secondary-button compact-button" type="button" onClick={loadLinks} disabled={loading}>{loading ? 'Checking...' : 'Refresh network links'}</button>
        </div>

        <div className="network-link-grid">
          <section className="network-link-panel">
            <span>This MCC computer</span>
            <strong>Host PC URL</strong>
            <p>Use this only on the MCC host computer.</p>
            {links&&<CopyUrl url={links.localhostUrl} onCopied={value=>setMsg(`Copied ${value}`)} />}
          </section>

          <section className="network-link-panel">
            <span>Other PC on same network</span>
            <strong>Other PC URL</strong>
            <p>Use this from another Windows PC on the same network.</p>
            {primaryLanUrl ? <CopyUrl url={primaryLanUrl} onCopied={value=>setMsg(`Copied ${value}`)} /> : <p className="form-help">No network IP detected. Open Command Prompt and run ipconfig, then use IPv4 Address with port 4273.</p>}
          </section>

          <section className="network-link-panel">
            <span>Mobile / Tablet</span>
            <strong>Phone or tablet URL</strong>
            <p>Use this on phone/tablet when connected to the same Wi-Fi/network. Do not use cellular data.</p>
            {primaryLanUrl ? <CopyUrl url={primaryLanUrl} onCopied={value=>setMsg(`Copied ${value}`)} /> : <p className="form-help">No network IP detected. Open Command Prompt and run ipconfig, then use IPv4 Address with port 4273.</p>}
          </section>
        </div>

        {links&&detectedLanUrls.length>1&&(
          <section className="network-link-panel">
            <span>Detected network URLs</span>
            <strong>All detected LAN links</strong>
            <div className="share-url-list">
              {detectedLanUrls.map(url=><CopyUrl key={url} url={url} onCopied={value=>setMsg(`Copied ${value}`)} />)}
            </div>
          </section>
        )}

        <section className="network-notes">
          <strong>Important notes</strong>
          <ul>
            <li>MCC computer must stay on.</li>
            <li>MCC Website must be running.</li>
            <li>Other devices must be on same network/Wi-Fi.</li>
            <li>If it does not open, Windows Firewall may need port 4273 allowed.</li>
          </ul>
        </section>

        {msg&&<p className="form-message">{msg}</p>}
      </article>

      <article className="mcc-card wide-card backup-card">
        <div className="share-card-heading">
          <div>
            <span>MCC Master Backup</span>
            <strong>Automatic database protection</strong>
            <p>Startup, hourly, automatic write-triggered, and manual backups protect MCC data without showing private system paths.</p>
          </div>
          <div className="backup-action-row">
            <button className="secondary-button compact-button" type="button" onClick={()=>void loadBackupStatus()} disabled={backupLoading}>{backupLoading ? 'Working...' : 'Refresh status'}</button>
            <button className="primary-button compact-button" type="button" onClick={()=>void createManualBackup()} disabled={backupLoading || !backupPermissions.canCreateBackup}>{manualBackupProgress.state === 'running' ? 'Creating...' : 'Create Manual Backup'}</button>
          </div>
        </div>

        {manualBackupProgress.state!=='idle'&&(
          <section className={`backup-progress-panel ${manualBackupProgress.state}`} aria-live="polite">
            <div className="backup-progress-heading">
              <div>
                <span>{manualBackupProgress.state==='running'?'Creating MCC Master Backup':'MCC Master Backup'}</span>
                <strong>{manualBackupProgress.message}</strong>
              </div>
              {manualBackupProgress.state==='running'&&<span className="backup-spinner" aria-hidden="true" />}
            </div>
            <ol className="backup-step-list">
              {backupStepLabels.map((step,index)=>{
                const done = manualBackupProgress.state==='success' || index < manualBackupProgress.activeStep;
                const running = manualBackupProgress.state==='running' && index === manualBackupProgress.activeStep;
                const failed = manualBackupProgress.state==='error' && index === manualBackupProgress.activeStep;
                return <li className={failed ? 'failed' : running ? 'running' : done ? 'done' : ''} key={step}>{step}</li>;
              })}
            </ol>
          </section>
        )}

        <div className="backup-status-grid">
          <section className="backup-status-panel">
            <span>Backup health</span>
            <strong>{backupStatus?.backupHealth ?? 'Checking...'}</strong>
            <p>{backupStatus?.backupFolderExists ? 'Backup storage is ready.' : 'Backup storage is not ready.'}</p>
          </section>
          <section className="backup-status-panel">
            <span>Latest backup</span>
            <strong>{backupStatus?.latestBackup ? backupStatus.latestBackup.typeLabel : 'None yet'}</strong>
            <p>{formatDateTime(backupStatus?.latestBackup?.createdAt)}</p>
          </section>
          <section className="backup-status-panel">
            <span>Live database</span>
            <strong>{formatBytes(backupStatus?.databaseSize ?? 0)}</strong>
            <p>Next scheduled backup: {formatDateTime(backupStatus?.nextScheduledBackupAt)}</p>
          </section>
        </div>

        <div className="backup-count-row">
          {(['manual','auto','scheduled','startup','pre_restore'] as BackupType[]).map(type=>(
            <span className={`backup-type-pill ${type}`} key={type}>{typeLabel(type)}: {backupCounts[type] ?? 0}</span>
          ))}
        </div>

        <section className="network-notes backup-notes">
          <strong>Automatic safety</strong>
          <ul>
            <li>Startup backup runs when MCC starts successfully.</li>
            <li>Scheduled backup runs every {backupStatus?.scheduledBackupIntervalMinutes ?? 60} minutes while MCC is running.</li>
            <li>Write-triggered backup waits about {backupStatus?.autoBackupDelaySeconds ?? 45} seconds after MCC data changes.</li>
            <li>A pre-restore backup is created before any restore is applied.</li>
          </ul>
        </section>

        <div className="backup-action-row">
          <button className="secondary-button" type="button" onClick={()=>void loadBackups()} disabled={backupLoading || !backupPermissions.canViewBackups}>{showBackups ? 'Refresh Backups' : 'View Backups'}</button>
          {showBackups&&<button className="link-button" type="button" onClick={()=>{setShowBackups(false);setRestoreTarget(null);}}>Hide Backups</button>}
        </div>

        {showBackups&&(
          <div className="backup-list">
            {backups.map(backup=>(
              <section className="backup-list-row" key={backup.id}>
                <div>
                  <span className={`backup-type-pill ${backup.type}`}>{backup.typeLabel}</span>
                  <strong>{formatDateTime(backup.createdAt)}</strong>
                  <p>{formatBytes(backup.sizeBytes)} total / {formatBytes(backup.databaseSizeBytes)} database</p>
                  <small>{backup.notes || 'No notes'}</small>
                </div>
                <div className="backup-row-actions">
                  <button className="secondary-button compact-button" type="button" onClick={()=>verifyBackup(backup)} disabled={backupLoading}>Verify</button>
                  <button className="danger-button compact-button" type="button" onClick={()=>{setRestoreTarget(backup);setRestoreConfirmation('');}} disabled={backupLoading || !backupPermissions.canRestoreBackup || !backup.restorable}>Restore</button>
                </div>
              </section>
            ))}
            {!backups.length&&<p className="form-message">No master backups found yet.</p>}
          </div>
        )}

        {restoreTarget&&(
          <section className="restore-panel">
            <span>Restore confirmation</span>
            <strong>{restoreTarget.typeLabel} backup from {formatDateTime(restoreTarget.createdAt)}</strong>
            <p>A pre-restore safety backup will be created before restoring. Type RESTORE MCC to continue.</p>
            <label className="form-field">
              <span>Confirmation</span>
              <input value={restoreConfirmation} onChange={event=>setRestoreConfirmation(event.target.value)} placeholder="RESTORE MCC" />
            </label>
            <div className="backup-action-row">
              <button className="danger-button" type="button" onClick={restoreBackup} disabled={backupLoading || restoreConfirmation !== 'RESTORE MCC'}>Restore Backup</button>
              <button className="link-button" type="button" onClick={()=>setRestoreTarget(null)}>Cancel</button>
            </div>
          </section>
        )}

        {displayedBackupResult&&(
          <section className={displayedBackupResult.ok ? 'backup-result-panel success' : 'backup-result-panel error'}>
            <span>Last result</span>
            <strong>{lastManualBackupResult?.message ?? (displayedBackupResult.ok ? 'Last backup succeeded' : 'Last backup failed')}</strong>
            <p>{lastManualBackupResult ? formatDateTime(lastManualBackupResult.createdAt) : displayedBackupResult.message}</p>
          </section>
        )}
      </article>
    </div>
  );
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined,{dateStyle:'short',timeStyle:'short'}).format(date);
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B','KB','MB','GB','TB'];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function typeLabel(type: BackupType) {
  return type.split('_').map(part=>part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}
