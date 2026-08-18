import { expect, type Page, test } from '@playwright/test';

type FixtureRole='admin'|'manager'|'tech3';

type RestoreStatus={active:boolean;backupId:string;state:'running'|'success'|'error';phase:string;progressPercent:number;message:string;startedAt:string;updatedAt:string;completedAt:string|null;error:string|null};

function restoreStatus(overrides:Partial<RestoreStatus>={}):RestoreStatus{
  const timestamp='2026-08-18T12:00:00.000Z';
  return{active:true,backupId:'MCC_Master_Backup_2026-08-17_12-00-00',state:'running',phase:'restoring_database',progressPercent:60,message:'Restoring MCC database...',startedAt:timestamp,updatedAt:timestamp,completedAt:null,error:null,...overrides};
}

function group(category:string,visible:boolean){return{category,categoryLabel:category,visible,latestBackup:null,lastAutoBackup:null,count:0,health:{ok:visible,label:visible?'Healthy':'Hidden',message:visible?'Ready':'Not available for this role.'},folderLabel:visible?category:'',folderPath:visible?category:'',autoBackupPending:false,nextScheduledBackupAt:null};}

async function mockSettings(page:Page,role:FixtureRole){
  const admin=role==='admin';const manager=role==='manager';const userRole=admin?'Admin':manager?'Manager':'Maintenance Tech 3';
  await page.route('**/api/auth/status',route=>route.fulfill({json:{setupRequired:false,user:{id:1,fullName:`${role} Fixture`,email:`${role}@example.com`,role:userRole,isOwnerAdmin:false,canViewSystemVersion:admin,forcePasswordChange:false,effectivePermissions:[]}}}));
  await page.route('**/api/version',route=>route.fulfill({json:{version:'1.5.7',displayVersion:'v1.5.7',commit:'abc1234',buildDate:null}}));
  await page.route('**/api/system/update/status',route=>route.fulfill({json:{ok:true,configured:false,available:false,state:'idle',code:'deployment_not_configured',message:'Not configured.',mode:'disabled',environmentLabel:'UPDATER NOT CONFIGURED',installedVersion:'1.5.7',installedCommit:'abc1234',targetVersion:null,targetCommit:null,startedAt:null,requestedAt:null,lastUpdatedAt:new Date().toISOString(),completedAt:null,requester:null,outcome:'none',checkToken:null,checkExpiresAt:null,csrfToken:'',active:false}}));
  await page.route('**/api/settings/branding',route=>route.fulfill({json:{branding:{}}}));
  await page.route('**/api/settings/network-links',route=>route.fulfill({json:{localhostUrl:'http://localhost:4273',detectedLanUrls:[]}}));
  await page.route('**/api/backup/status',route=>route.fulfill({json:{
    ok:true,daily:group('daily',true),weekly:group('weekly',manager||admin),master:group('master',admin),latestBackup:null,lastAutoBackup:null,lastManualBackup:null,lastPreResetBackup:null,lastPreRestoreBackup:null,backupFolderExists:true,backupCountsByType:{},lastBackupResult:{ok:true,message:'Ready'},autoBackupPending:false,protectedAreas:[],nextScheduledBackupAt:null,nextWeeklyBackupAt:null,nextMasterBackupAt:null,databaseSize:1024,backupHealth:'Healthy',autoBackupDelaySeconds:45,scheduledBackupIntervalMinutes:null,
    portableBackups:[{id:'MCC_Master_Backup_fixture_master_manual',name:'fixture',category:'master',categoryLabel:'MCC Master Backup',type:'master_manual',typeLabel:'Master Manual',createdAt:'2026-08-17T12:00:00.000Z',sizeBytes:2048,databaseSizeBytes:1024,recordCounts:{},includedPaths:[],includedFolders:[],notes:'',restorable:true,folderLabel:'master',portableArchiveFilename:'MCC_Master_Backup_2026-08-17_12-00-00.zip',portableArchiveSizeBytes:2048,portableReady:true}],
    importedRecoveryBackups:[{id:'MCC_Master_Backup_2026-08-17_12-00-00',name:'MCC_Master_Backup_2026-08-17_12-00-00',createdAt:'2026-08-17T12:00:00.000Z',appVersion:'1.5.7',backupType:'master_manual',archiveFilename:'MCC_Master_Backup_2026-08-17_12-00-00.zip',archiveSizeBytes:2048,importedAt:'2026-08-17T12:05:00.000Z',checkedFileCount:9,safeToDisconnect:true}],
    recoveryLocation:'/var/lib/mcc-recovery',recoveryStorage:{usedBytes:4096,remainingBytes:8192-4096,quotaBytes:8192,packageCount:1,maxPackages:3,atCapacity:false},externalBackup:{destination:'/media/usb/MCC_Backups',enabled:true,lastTestAt:'2026-08-17T12:00:00.000Z',lastTestOk:true,lastTestMessage:'Writable.',lastCopyAt:'2026-08-17T12:01:00.000Z',lastCopyOk:true,lastCopyMessage:'Verified external copy completed.',lastCopyBackupId:'fixture',lastCopyFilename:'MCC_Master_Backup_2026-08-17_12-00-00.zip'},
    permissions:{canViewDaily:true,canCreateDaily:true,canRestoreDaily:manager||admin,canViewWeekly:manager||admin,canCreateWeekly:manager||admin,canRestoreWeekly:manager||admin,canViewMaster:admin,canCreateMaster:admin,canRestoreMaster:admin,canUsePortableRecovery:manager||admin,canConfigureExternalBackup:admin,canViewBackups:true,canCreateBackup:admin,canRestoreBackup:admin},
  }}));
  await page.route('**/api/admin/reset/status',route=>route.fulfill({status:403,json:{error:'Owner Admin only.'}}));
}

test('Manager sees portable import/download but not destructive restore or external configuration',async({page})=>{
  await mockSettings(page,'manager');await page.goto('/settings');
  const panel=page.getByRole('region',{name:'Portable Master Backup and Recovery'});await expect(panel).toBeVisible();await expect(panel.getByText('Download Portable Backup')).toBeVisible();await expect(panel.getByText('Pull Master Backup into MCC')).toBeVisible();await expect(panel.getByText(/1 of 3 packages\. MCC never auto-deletes recovery packages/)).toBeVisible();await expect(panel.getByText(/External backup drive may now be disconnected/)).toBeVisible();await expect(panel.getByRole('button',{name:'Restore Verified Backup'})).toHaveCount(0);await expect(panel.getByLabel('Server-side external backup destination')).toHaveCount(0);
});

test('Admin sees external controls and protected portable restore confirmation',async({page})=>{
  await mockSettings(page,'admin');await page.goto('/settings');const panel=page.getByRole('region',{name:'Portable Master Backup and Recovery'});await expect(panel.getByLabel('Server-side external backup destination')).toHaveValue('/media/usb/MCC_Backups');await expect(panel.getByRole('button',{name:'Test Backup Location'})).toBeVisible();await panel.getByRole('button',{name:'Restore Verified Backup'}).click();await expect(page.getByText('Type RESTORE MCC to continue')).toBeVisible();await expect(page.getByRole('button',{name:'Restore Verified Backup'}).last()).toBeDisabled();await page.setViewportSize({width:390,height:844});const widths=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));expect(widths.scroll).toBeLessThanOrEqual(widths.client);
});

test('Portable restore renders real progress, locks controls, and preserves a clear success state',async({page})=>{
  await mockSettings(page,'admin');
  let releaseRestore=()=>{};const restoreGate=new Promise<void>(resolve=>{releaseRestore=resolve;});
  await page.route('**/api/backup/recovery/restore/status?*',route=>route.fulfill({json:{ok:true,status:restoreStatus()}}));
  await page.route('**/api/backup/recovery/restore',async route=>{await restoreGate;const status=restoreStatus({active:false,state:'success',phase:'complete',progressPercent:100,message:'Restore complete.',completedAt:'2026-08-18T12:01:00.000Z',error:null});await route.fulfill({json:{ok:true,restoreStatus:status,message:'MCC restored successfully. Refresh MCC and log in again if needed.'}});});
  await page.goto('/settings');const panel=page.getByRole('region',{name:'Portable Master Backup and Recovery'});await panel.getByRole('button',{name:'Restore Verified Backup'}).click();const dialog=page.getByRole('dialog');const confirmation=dialog.getByPlaceholder('RESTORE MCC');const restoreButton=dialog.getByRole('button',{name:'Restore Verified Backup'});await expect(restoreButton).toBeDisabled();await confirmation.fill('RESTORE MCC');await expect(restoreButton).toBeEnabled();await restoreButton.click();
  const progress=dialog.getByRole('progressbar',{name:'Verified backup restore progress'});await expect(progress).toBeVisible();await expect(progress).toHaveAttribute('aria-valuemin','0');await expect(progress).toHaveAttribute('aria-valuemax','100');await expect(progress).toHaveAttribute('aria-valuenow','5');await expect(confirmation).toBeDisabled();await expect(dialog.getByRole('button',{name:'Restoring...'})).toBeDisabled();await expect(dialog.getByRole('button',{name:'Cancel'})).toBeDisabled();await expect(dialog.getByRole('button',{name:'Close'})).toBeDisabled();
  await expect(progress).toHaveAttribute('aria-valuenow','60');await expect(dialog.getByText('Restoring MCC database...')).toBeVisible();const layout=await page.evaluate(()=>{const modal=document.querySelector('.restore-modal')?.getBoundingClientRect();const track=document.querySelector('.restore-progress-track')?.getBoundingClientRect();return{scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth,modalLeft:modal?.left??-1,modalRight:modal?.right??Number.MAX_SAFE_INTEGER,trackWidth:track?.width??0};});expect(layout.scroll).toBeLessThanOrEqual(layout.client);expect(layout.modalLeft).toBeGreaterThanOrEqual(0);expect(layout.modalRight).toBeLessThanOrEqual(layout.client+1);expect(layout.trackWidth).toBeGreaterThan(180);
  releaseRestore();await expect(progress).toHaveAttribute('aria-valuenow','100');await expect(dialog.getByText('Restore Complete ✓')).toBeVisible();await expect(dialog.getByText('MCC restored successfully. Refresh MCC and log in again if needed.')).toBeVisible();await expect(dialog.getByRole('button',{name:'Close'}).first()).toBeEnabled();await expect(confirmation).toBeDisabled();
});

test('Portable restore failure keeps the last real percentage and safely enables retry',async({page})=>{
  await mockSettings(page,'admin');const failed=restoreStatus({active:false,state:'error',phase:'restoring_runtime_files',progressPercent:75,message:'Runtime payload validation failed.',completedAt:'2026-08-18T12:00:30.000Z',error:'Runtime payload validation failed.'});
  await page.route('**/api/backup/recovery/restore/status?*',route=>route.fulfill({json:{ok:true,status:failed}}));
  await page.route('**/api/backup/recovery/restore',route=>route.fulfill({status:400,json:{ok:false,error:'Runtime payload validation failed.',restoreStatus:failed}}));
  await page.goto('/settings');await page.getByRole('region',{name:'Portable Master Backup and Recovery'}).getByRole('button',{name:'Restore Verified Backup'}).click();const dialog=page.getByRole('dialog');const confirmation=dialog.getByPlaceholder('RESTORE MCC');await confirmation.fill('RESTORE MCC');await dialog.getByRole('button',{name:'Restore Verified Backup'}).click();const progress=dialog.getByRole('progressbar',{name:'Verified backup restore progress'});await expect(progress).toHaveAttribute('aria-valuenow','75');await expect(dialog.getByText('Restore stopped at 75%')).toBeVisible();await expect(dialog.getByText('Runtime payload validation failed.')).toBeVisible();await expect(confirmation).toBeEnabled();await expect(dialog.getByRole('button',{name:'Retry Restore'})).toBeEnabled();await expect(dialog.getByRole('button',{name:'Cancel'})).toBeEnabled();await expect(dialog.getByRole('button',{name:'Close'})).toBeEnabled();
});

test('Maintenance Tech 3 cannot see portable recovery controls',async({page})=>{await mockSettings(page,'tech3');await page.goto('/settings');await expect(page.getByRole('region',{name:'Portable Master Backup and Recovery'})).toHaveCount(0);});
