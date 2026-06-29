import { ChangeEvent, useEffect, useMemo, useState } from 'react';

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
type BrandingSettings = {
  companyName: string;
  companySubtitle: string;
  companyAccentText: string;
  logoMode: 'text' | 'image';
  logoUrl: string;
  logoFileName: string;
  iconAnimation: 'none' | 'glow' | 'rotate' | 'pulse';
};
type ResetCounts = {
  inventoryParts: number;
  inventoryVendors: number;
  inventoryLocations: number;
  requisitions: number;
  requisitionLines: number;
  historyCounts: Record<string, number>;
  futureTableCounts: Record<string, Record<string, number | null>>;
};
type ResetStatus = { ok: boolean; counts: ResetCounts };
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
  | 'machine_library'
  | 'equipment_library'
  | 'facility_info'
  | 'preventive_maintenance';
type ResetConfig = {
  section: ResetSection;
  title: string;
  description: string;
  confirmation: string;
  count: (counts: ResetCounts) => string;
  options?: Array<{ key: string; label: string; description: string }>;
};
type ResetModalState = {
  target: ResetConfig;
  reason: string;
  confirmation: string;
  options: Record<string, boolean>;
  state: 'idle' | 'running' | 'success' | 'error';
  activeStep: number;
  message: string;
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
const resetStepLabels = [
  'Creating pre-reset backup',
  'Verifying backup',
  'Resetting selected data',
  'Recording history',
  'Refreshing status',
  'Complete',
];
const emptyBackupCounts: Record<BackupType, number> = { startup: 0, scheduled: 0, auto: 0, manual: 0, pre_restore: 0 };
const emptyBackupPermissions = { canViewBackups: false, canCreateBackup: false, canRestoreBackup: false };
const defaultBranding: BrandingSettings = {
  companyName: 'JBT',
  companySubtitle: 'Maintenance Command Center',
  companyAccentText: 'USA',
  logoMode: 'text',
  logoUrl: '',
  logoFileName: '',
  iconAnimation: 'none',
};

async function api(path:string, options:RequestInit={}) {
  const res=await fetch(path,{credentials:'include',headers:{'Content-Type':'application/json',...(options.headers??{})},...options});
  const data=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeBranding(value: unknown): BrandingSettings {
  const data = asRecord(value);
  const logoMode = data.logoMode === 'image' && data.logoUrl ? 'image' : 'text';
  const iconAnimation = ['none','glow','rotate','pulse'].includes(String(data.iconAnimation)) ? String(data.iconAnimation) as BrandingSettings['iconAnimation'] : 'none';
  return {
    companyName: String(data.companyName ?? defaultBranding.companyName).slice(0, 20) || defaultBranding.companyName,
    companySubtitle: String(data.companySubtitle ?? defaultBranding.companySubtitle).slice(0, 40),
    companyAccentText: String(data.companyAccentText ?? defaultBranding.companyAccentText).slice(0, 8),
    logoMode,
    logoUrl: String(data.logoUrl ?? ''),
    logoFileName: String(data.logoFileName ?? ''),
    iconAnimation,
  };
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

export function SettingsPage({isOwnerAdmin=false}:{isOwnerAdmin?: boolean}) {
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
  const [branding,setBranding]=useState<BrandingSettings>(defaultBranding);
  const [brandingMsg,setBrandingMsg]=useState('');
  const [brandingLoading,setBrandingLoading]=useState(false);
  const [resetStatus,setResetStatus]=useState<ResetStatus|null>(null);
  const [resetMsg,setResetMsg]=useState('');
  const [resetModal,setResetModal]=useState<ResetModalState|null>(null);
  const detectedLanUrls = links?.detectedLanUrls ?? [];
  const primaryLanUrl = links?.primaryLanUrl ?? detectedLanUrls[0] ?? '';
  const backupPermissions = backupStatus?.permissions ?? emptyBackupPermissions;
  const backupCounts = backupStatus?.backupCountsByType ?? emptyBackupCounts;
  const displayedBackupResult = lastManualBackupResult ?? backupStatus?.lastBackupResult ?? null;
  const resetConfigs = useMemo<ResetConfig[]>(()=>[
    {
      section: 'inventory',
      title: 'Reset Inventory Data',
      description: 'Wipes MCC inventory parts. Linked requisitions and lookup lists stay unless selected.',
      confirmation: 'RESET INVENTORY',
      count: counts => `${counts.inventoryParts} parts`,
      options: [
        { key: 'includeLinkedRequisitions', label: 'Also reset linked requisitions', description: 'Deletes requisitions and requisition lines too.' },
        { key: 'includeVendorsLocations', label: 'Clean vendors and locations', description: 'Deletes inventory lookup lists.' },
        { key: 'includeInventoryBackups', label: 'Remove inventory backup list files', description: 'Does not delete master backups.' },
      ],
    },
    { section: 'requisitions', title: 'Reset Requisitions Data', description: 'Wipes requisitions and requisition lines, then clears active requisition flags on remaining parts.', confirmation: 'RESET REQUISITIONS', count: counts => `${counts.requisitions} requisitions / ${counts.requisitionLines} lines` },
    { section: 'history_inventory', title: 'Reset Inventory History Logs', description: 'Wipes only Inventory history log rows.', confirmation: 'RESET HISTORY', count: counts => `${counts.historyCounts.inventory ?? 0} logs` },
    { section: 'history_requisitions', title: 'Reset Requisition History Logs', description: 'Wipes only Requisition history log rows.', confirmation: 'RESET HISTORY', count: counts => `${counts.historyCounts.requisitions ?? 0} logs` },
    { section: 'history_machine_library', title: 'Reset Machine History Logs', description: 'Wipes only Machine Library history log rows.', confirmation: 'RESET HISTORY', count: counts => `${counts.historyCounts.machine_library ?? 0} logs` },
    { section: 'history_equipment_library', title: 'Reset Equipment History Logs', description: 'Wipes only Equipment Library history log rows.', confirmation: 'RESET HISTORY', count: counts => `${counts.historyCounts.equipment_library ?? 0} logs` },
    { section: 'history_facility_info', title: 'Reset Facility History Logs', description: 'Wipes only Facility Info history log rows.', confirmation: 'RESET HISTORY', count: counts => `${counts.historyCounts.facility_info ?? 0} logs` },
    { section: 'history_preventive_maintenance', title: 'Reset PM History Logs', description: 'Wipes only Preventive Maintenance history log rows.', confirmation: 'RESET HISTORY', count: counts => `${counts.historyCounts.preventive_maintenance ?? 0} logs` },
    { section: 'history_settings', title: 'Reset Settings History Logs', description: 'Wipes only Settings / System history log rows.', confirmation: 'RESET HISTORY', count: counts => `${counts.historyCounts.settings ?? 0} logs` },
    { section: 'machine_library', title: 'Reset Machine Library Data', description: 'Wipes allowlisted machine records if those tables exist.', confirmation: 'RESET MACHINE LIBRARY', count: counts => futureCountLabel(counts, 'machine_library'), options: [{ key: 'includeHistory', label: 'Also reset machine history logs', description: 'Deletes Machine Library history log rows too.' }] },
    { section: 'equipment_library', title: 'Reset Equipment Library Data', description: 'Wipes allowlisted equipment records if those tables exist.', confirmation: 'RESET EQUIPMENT LIBRARY', count: counts => futureCountLabel(counts, 'equipment_library'), options: [{ key: 'includeHistory', label: 'Also reset equipment history logs', description: 'Deletes Equipment Library history log rows too.' }] },
    { section: 'facility_info', title: 'Reset Facility Info Data', description: 'Wipes allowlisted facility records if those tables exist. Uploaded files are not removed.', confirmation: 'RESET FACILITY INFO', count: counts => futureCountLabel(counts, 'facility_info'), options: [{ key: 'includeHistory', label: 'Also reset facility history logs', description: 'Deletes Facility Info history log rows too.' }] },
    { section: 'preventive_maintenance', title: 'Reset Preventive Maintenance Data', description: 'Wipes allowlisted PM records if those tables exist.', confirmation: 'RESET PM', count: counts => futureCountLabel(counts, 'preventive_maintenance'), options: [{ key: 'includeHistory', label: 'Also reset PM history logs', description: 'Deletes Preventive Maintenance history log rows too.' }] },
  ],[]);

  function loadLinks() {
    setLoading(true);
    api('/api/settings/network-links')
      .then(data=>{ setLinks(data); setMsg(''); })
      .catch(e=>setMsg(e.message))
      .finally(()=>setLoading(false));
  }

  function loadBranding() {
    setBrandingLoading(true);
    return api('/api/settings/branding')
      .then(data=>{ setBranding(normalizeBranding(data.branding)); setBrandingMsg(''); })
      .catch(e=>setBrandingMsg(e.message))
      .finally(()=>setBrandingLoading(false));
  }

  async function saveBranding(nextBranding = branding, resetToDefault = false) {
    setBrandingLoading(true);
    setBrandingMsg('');
    try {
      const data = await api('/api/settings/branding',{method:'PUT',body:JSON.stringify(resetToDefault ? {resetToDefault:true} : nextBranding)});
      const saved = normalizeBranding(data.branding);
      setBranding(saved);
      window.dispatchEvent(new CustomEvent('mcc-branding-updated',{detail:saved}));
      setBrandingMsg(String(data.message ?? 'Company branding saved.'));
    } catch (e) {
      setBrandingMsg((e as Error).message);
    } finally {
      setBrandingLoading(false);
    }
  }

  async function uploadLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBrandingLoading(true);
    setBrandingMsg('');
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch('/api/settings/branding/logo',{method:'POST',credentials:'include',body});
      const data = await res.json().catch(()=>({}));
      if (!res.ok) throw new Error(data.error || 'Logo upload failed.');
      const saved = normalizeBranding(data.branding);
      setBranding(saved);
      window.dispatchEvent(new CustomEvent('mcc-branding-updated',{detail:saved}));
      setBrandingMsg(String(data.message ?? 'Company logo/icon uploaded.'));
    } catch (e) {
      setBrandingMsg((e as Error).message);
    } finally {
      setBrandingLoading(false);
    }
  }

  function loadBackupStatus(options: { quiet?: boolean } = {}) {
    if (!options.quiet) setBackupLoading(true);
    return api('/api/backup/status')
      .then(data=>{ setBackupStatus(normalizeBackupStatus(data)); setMsg(''); })
      .catch(e=>setMsg(e.message))
      .finally(()=>{ if (!options.quiet) setBackupLoading(false); });
  }

  function loadResetStatus(options: { quiet?: boolean } = {}) {
    if (!isOwnerAdmin) return Promise.resolve();
    return api('/api/admin/reset/status')
      .then(data=>{ setResetStatus(data as ResetStatus); setResetMsg(''); })
      .catch(e=>setResetMsg(e.message));
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

  function openResetModal(target: ResetConfig) {
    const options = Object.fromEntries((target.options ?? []).map(option=>[option.key,false]));
    setResetModal({target,reason:'',confirmation:'',options,state:'idle',activeStep:0,message:''});
  }

  async function runReset() {
    if (!resetModal || resetModal.state === 'running') return;
    const current = resetModal;
    setResetMsg('');
    setResetModal({...current,state:'running',activeStep:0,message:'Creating pre-reset backup'});
    try {
      const dataPromise = api('/api/admin/reset/section',{method:'POST',body:JSON.stringify({
        section: current.target.section,
        reasonNote: current.reason,
        confirmation: current.confirmation,
        options: current.options,
      })});
      const timer = window.setInterval(()=>{
        setResetModal(existing=>existing?.state === 'running' ? {...existing,activeStep:Math.min(existing.activeStep + 1, resetStepLabels.length - 2)} : existing);
      }, 700);
      const data = await dataPromise.finally(()=>window.clearInterval(timer));
      setResetModal(existing=>existing ? {...existing,state:'success',activeStep:resetStepLabels.length - 1,message:String(data.message ?? 'Reset complete.')} : existing);
      setResetMsg(String(data.message ?? 'Reset complete.'));
      await loadResetStatus({quiet:true});
      await loadBackupStatus({quiet:true}).catch(()=>undefined);
    } catch (e) {
      setResetModal(existing=>existing ? {...existing,state:'error',message:(e as Error).message || 'Reset failed. No data was removed.'} : existing);
    }
  }

  useEffect(()=>{
    loadLinks();
    loadBranding();
    loadBackupStatus();
    if (isOwnerAdmin) void loadResetStatus();
  },[isOwnerAdmin]);
  useEffect(()=>{
    if (manualBackupProgress.state !== 'running' || manualBackupProgress.activeStep >= backupStepLabels.length - 2) return;
    const timer = window.setTimeout(()=>{
      setManualBackupProgress(current=>current.state === 'running' ? {...current,activeStep:Math.min(current.activeStep + 1, backupStepLabels.length - 2)} : current);
    }, 700);
    return () => window.clearTimeout(timer);
  },[manualBackupProgress.activeStep,manualBackupProgress.state]);

  const resetReady = Boolean(resetModal && resetModal.reason.trim() && resetModal.confirmation === resetModal.target.confirmation && resetModal.state !== 'running');

  return (
    <div className="page-stack settings-page">
      <div className="page-heading">
        <p className="eyebrow">Settings</p>
        <h2>MCC Settings</h2>
        <p>Share local access details, protect MCC data, and manage company branding without exposing private system settings.</p>
      </div>

      <article className="mcc-card wide-card branding-card">
        <div className="share-card-heading">
          <div>
            <span>Company Branding</span>
            <strong>Launcher logo and company name</strong>
            <p>Keep JBT USA as the default, or switch the launcher to another company name and safe uploaded icon.</p>
          </div>
          <div className="branding-preview">
            <div className={`mcc-brand command-brand brand-animation-${branding.iconAnimation} ${branding.logoMode==='image'?'image-brand':'text-brand'}`} aria-label={`${branding.companyName} ${branding.companyAccentText}`.trim()}>
              <div className="mcc-brand-mark">
                {branding.logoMode==='image'&&branding.logoUrl ? <img className="mcc-brand-image" src={branding.logoUrl} alt="" /> : <strong><span className="mcc-brand-jbt">{branding.companyName}</span>{branding.companyAccentText&&<span className="mcc-brand-usa">{branding.companyAccentText}</span>}</strong>}
                <span>{branding.companySubtitle}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="branding-form-grid">
          <label className="form-field">
            <span>Company Name <b className="required-marker">*</b></span>
            <input value={branding.companyName} maxLength={20} disabled={!isOwnerAdmin || brandingLoading} onChange={event=>setBranding(current=>({...current,companyName:event.target.value.slice(0,20)}))} />
          </label>
          <label className="form-field">
            <span>Accent Text</span>
            <input value={branding.companyAccentText} maxLength={8} disabled={!isOwnerAdmin || brandingLoading} onChange={event=>setBranding(current=>({...current,companyAccentText:event.target.value.slice(0,8)}))} />
          </label>
          <label className="form-field">
            <span>Subtitle</span>
            <input value={branding.companySubtitle} maxLength={40} disabled={!isOwnerAdmin || brandingLoading} onChange={event=>setBranding(current=>({...current,companySubtitle:event.target.value.slice(0,40)}))} />
          </label>
          <label className="form-field">
            <span>Logo Mode</span>
            <select value={branding.logoMode} disabled={!isOwnerAdmin || brandingLoading} onChange={event=>setBranding(current=>({...current,logoMode:event.target.value as BrandingSettings['logoMode']}))}>
              <option value="text">Text Logo</option>
              <option value="image">Uploaded Logo/Icon</option>
            </select>
          </label>
          <label className="form-field">
            <span>Icon Animation</span>
            <select value={branding.iconAnimation} disabled={!isOwnerAdmin || brandingLoading} onChange={event=>setBranding(current=>({...current,iconAnimation:event.target.value as BrandingSettings['iconAnimation']}))}>
              <option value="none">None</option>
              <option value="glow">Soft Glow</option>
              <option value="rotate">Slow Rotate</option>
              <option value="pulse">Pulse</option>
            </select>
          </label>
          <label className="form-field">
            <span>Upload Logo/Icon</span>
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={!isOwnerAdmin || brandingLoading} onChange={uploadLogo} />
          </label>
        </div>

        <div className="backup-action-row">
          <button className="primary-button compact-button" type="button" onClick={()=>void saveBranding()} disabled={!isOwnerAdmin || brandingLoading || !branding.companyName.trim()}>{brandingLoading ? 'Saving...' : 'Save Branding'}</button>
          <button className="secondary-button compact-button" type="button" onClick={()=>void saveBranding(defaultBranding,true)} disabled={!isOwnerAdmin || brandingLoading}>Reset to Default JBT</button>
        </div>
        {!isOwnerAdmin&&<p className="form-help">Owner Admin access is required to change branding.</p>}
        {brandingMsg&&<p className="form-message">{brandingMsg}</p>}
      </article>

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

      {isOwnerAdmin&&(
        <article className="mcc-card wide-card danger-zone-card">
          <div className="share-card-heading">
            <div>
              <span>Owner Admin Danger Zone</span>
              <strong>Reset MCC section data</strong>
              <p>Reset MCC section data only when you have a backup and understand this cannot be undone.</p>
            </div>
            <button className="secondary-button compact-button" type="button" onClick={()=>void loadResetStatus()}>{resetStatus ? 'Refresh counts' : 'Load counts'}</button>
          </div>
          {resetMsg&&<p className="form-message">{resetMsg}</p>}
          <div className="reset-card-grid">
            {resetConfigs.map(config=>(
              <section className="reset-option-card" key={config.section}>
                <div>
                  <span>Owner Admin only</span>
                  <strong>{config.title}</strong>
                  <p>{config.description}</p>
                </div>
                <small>{resetStatus ? config.count(resetStatus.counts) : 'Counts not loaded'}</small>
                <button className="danger-button compact-button" type="button" onClick={()=>openResetModal(config)}>Reset</button>
              </section>
            ))}
          </div>
        </article>
      )}

      {resetModal&&(
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <section className="mcc-card inventory-modal reset-modal">
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Owner Admin reset</p>
                <h3>{resetModal.target.title}</h3>
              </div>
              <button className="link-button compact-button" type="button" onClick={()=>setResetModal(null)} disabled={resetModal.state==='running'}>Close</button>
            </div>
            <p className="form-help">This will permanently remove selected MCC data after creating a safety backup.</p>
            <label className="form-field">
              <span>Reason for reset <b className="required-marker">*</b></span>
              <textarea value={resetModal.reason} onChange={event=>setResetModal(current=>current ? {...current,reason:event.target.value} : current)} disabled={resetModal.state==='running'} />
            </label>
            <label className="form-field">
              <span>Type {resetModal.target.confirmation} to continue</span>
              <input value={resetModal.confirmation} onChange={event=>setResetModal(current=>current ? {...current,confirmation:event.target.value} : current)} disabled={resetModal.state==='running'} />
            </label>
            {Boolean(resetModal.target.options?.length)&&(
              <div className="reset-checkbox-list">
                {resetModal.target.options!.map(option=>(
                  <label className="reset-checkbox-row" key={option.key}>
                    <input type="checkbox" checked={Boolean(resetModal.options[option.key])} onChange={event=>setResetModal(current=>current ? {...current,options:{...current.options,[option.key]:event.target.checked}} : current)} disabled={resetModal.state==='running'} />
                    <span><strong>{option.label}</strong><small>{option.description}</small></span>
                  </label>
                ))}
              </div>
            )}
            {resetModal.state!=='idle'&&(
              <section className={`backup-progress-panel ${resetModal.state}`} aria-live="polite">
                <div className="backup-progress-heading">
                  <div>
                    <span>{resetModal.state==='running'?'Reset in progress':'Reset result'}</span>
                    <strong>{resetModal.message || resetStepLabels[resetModal.activeStep]}</strong>
                  </div>
                  {resetModal.state==='running'&&<span className="backup-spinner" aria-hidden="true" />}
                </div>
                <ol className="backup-step-list">
                  {resetStepLabels.map((step,index)=>{
                    const done = resetModal.state==='success' || index < resetModal.activeStep;
                    const running = resetModal.state==='running' && index === resetModal.activeStep;
                    const failed = resetModal.state==='error' && index === resetModal.activeStep;
                    return <li className={failed ? 'failed' : running ? 'running' : done ? 'done' : ''} key={step}>{step}</li>;
                  })}
                </ol>
              </section>
            )}
            <div className="modal-actions">
              <button className="danger-button" type="button" onClick={()=>void runReset()} disabled={!resetReady}>Create Backup and Reset</button>
              <button className="secondary-button" type="button" onClick={()=>setResetModal(null)} disabled={resetModal.state==='running'}>Cancel</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function futureCountLabel(counts: ResetCounts, section: string) {
  const tableCounts = counts.futureTableCounts[section] ?? {};
  const existing = Object.values(tableCounts).filter(value=>typeof value === 'number') as number[];
  if (!existing.length) return 'No data table exists yet';
  return `${existing.reduce((sum,value)=>sum + value, 0)} records`;
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
