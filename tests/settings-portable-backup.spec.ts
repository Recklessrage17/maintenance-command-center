import { expect, type Page, test } from '@playwright/test';

type FixtureRole='admin'|'manager'|'tech3';

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

test('Maintenance Tech 3 cannot see portable recovery controls',async({page})=>{await mockSettings(page,'tech3');await page.goto('/settings');await expect(page.getByRole('region',{name:'Portable Master Backup and Recovery'})).toHaveCount(0);});
