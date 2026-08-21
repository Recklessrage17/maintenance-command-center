import {expect,type Page,test} from '@playwright/test';
import {actionProgress,deferred,expectActionPending,fulfill,issue80Auth,issue80MachineAsset} from './issue-80-progress-helpers';

async function openBrandColors(page:Page){
  await page.getByRole('button',{name:'Machine Library tools'}).click();
  await page.getByRole('menuitem',{name:/Brand Color Settings/}).click();
}

test('Machine brand-color and replacement-date saves use compact ordinary-action progress',async({page},testInfo)=>{
  const gate=deferred();const replacementGate=deferred();let requests=0;let replacementRequests=0;
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;const method=route.request().method();
    if(path==='/api/auth/status')return fulfill(route,issue80Auth);
    if(path==='/api/machine-library/assets')return fulfill(route,{ok:true,assets:[issue80MachineAsset],brandSettings:[{brandName:'Toyo',colorHex:'#1E6BFF'},{brandName:'Engel',colorHex:'#FFFFFF'}],permissions:{canEdit:true,canDelete:true,canManagePm:true}});
    if(path==='/api/machine-library/brand-settings/Toyo'&&method==='PUT'){requests+=1;await gate.promise;return fulfill(route,{ok:true,brandSetting:{brandName:'Toyo',colorHex:'#EB5E41'}});}
    if(path==='/api/machine-library/assets/8080/replacements/screw'&&method==='POST'){replacementRequests+=1;await replacementGate.promise;return fulfill(route,{ok:true});}
    if(path.endsWith('/preventive-maintenance'))return fulfill(route,{ok:true,tasks:[],summary:{total:0,dueSoon:0,overdue:0,nextDueDate:null,nextDueMeter:null}});
    if(path.endsWith('/document-folders'))return fulfill(route,{ok:true,folders:[],summary:{folderCount:0,documentCount:0}});
    if(path.endsWith('/documents'))return fulfill(route,{ok:true,documents:[]});
    if(path.endsWith('/notes'))return fulfill(route,{ok:true,notes:[]});
    if(path.endsWith('/history'))return fulfill(route,{ok:true,records:[]});
    if(path.endsWith('/inspection-records'))return fulfill(route,{ok:true,records:[]});
    if(path.endsWith('/component-images'))return fulfill(route,{ok:true,images:[]});
    return fulfill(route,{ok:true});
  });
  await page.goto('/machine-library');await openBrandColors(page);const row=page.locator('.machine-color-row',{hasText:'Toyo'});await row.getByLabel('Hex color').fill('#EB5E41');const button=row.locator('.secondary-button');
  page.on('dialog',dialog=>dialog.accept());await button.evaluate((element:HTMLButtonElement)=>{element.click();element.click();});await expect.poll(()=>requests).toBe(1);await expectActionPending(button);
  await expect(page.locator('.machine-color-row',{hasText:'Engel'}).getByRole('button',{name:'Save'})).toBeEnabled();gate.release();await expect(actionProgress(button)).toHaveAttribute('data-action-progress','success');await expect(page.getByText('Toyo color updated.')).toBeVisible();
  if(testInfo.project.name==='mobile-chromium')return;
  await page.getByRole('dialog').getByRole('button',{name:'Close'}).click();await page.locator('.machine-asset-card').click();await page.getByRole('button',{name:'Edit Mode'}).first().click();const editor=page.locator('.machine-editor-modal');await editor.getByRole('button',{name:'New Screw',exact:true}).click();
  const modal=page.locator('.machine-small-modal');await modal.getByRole('textbox',{name:/Install Date/}).fill('08/21/2026');await modal.getByLabel('Reason / Note').fill('Documented replacement.');const replacementButton=modal.locator('button[type="submit"]');
  await replacementButton.evaluate((element:HTMLButtonElement)=>{element.click();element.click();});await expect.poll(()=>replacementRequests).toBe(1);await expectActionPending(replacementButton);replacementGate.release();await expect(actionProgress(replacementButton)).toHaveAttribute('data-action-progress','success');await expect(page.getByText('Screw install date updated.')).toBeVisible();
});

test('PM hour meter keeps PM polling while exposing compact pending and completed button states',async({page})=>{
  const gate=deferred();let requests=0;let taskLoads=0;let currentReading=3560;
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;const method=route.request().method();
    if(path==='/api/auth/status')return fulfill(route,{...issue80Auth,user:{...issue80Auth.user,effectivePermissions:['machine.view','machine.pm_manage']}});
    if(path==='/api/machine-library/assets')return fulfill(route,{ok:true,assets:[issue80MachineAsset],brandSettings:[],permissions:{canEdit:true,canDelete:true,canManagePm:true}});
    if(path==='/api/machine-library/assets/8080/preventive-maintenance'){taskLoads+=1;return fulfill(route,{ok:true,tasks:[],summary:{total:0,dueSoon:0,overdue:0,nextDueDate:null,nextDueMeter:null}});}
    if(path==='/api/machine-library/assets/8080/preventive-maintenance/meters'&&method==='GET')return fulfill(route,{ok:true,meters:{hours:{id:1,meterType:'hours',currentReading,updatedAt:'2026-08-20T12:00:00Z'},cycles:null},history:[]});
    if(path==='/api/machine-library/assets/8080/preventive-maintenance/meters/hours'&&method==='PUT'){requests+=1;await gate.promise;currentReading=3600;return fulfill(route,{ok:true});}
    if(path==='/api/pm-excel/status')return fulfill(route,{ok:true,sync:{status:'success'}});
    if(path.endsWith('/document-folders'))return fulfill(route,{ok:true,folders:[],summary:{folderCount:0,documentCount:0}});
    if(path.endsWith('/documents'))return fulfill(route,{ok:true,documents:[]});
    if(path.endsWith('/notes'))return fulfill(route,{ok:true,notes:[]});
    if(path.endsWith('/history'))return fulfill(route,{ok:true,records:[]});
    if(path.endsWith('/inspection-records'))return fulfill(route,{ok:true,records:[]});
    if(path.endsWith('/component-images'))return fulfill(route,{ok:true,images:[]});
    return fulfill(route,{ok:true});
  });
  await page.goto('/machine-library');await page.locator('.machine-asset-card').click();await page.getByRole('button',{name:/Preventive Maintenance Tracking/}).click();const panel=page.getByRole('region',{name:'Machine-level meters'});await panel.getByRole('spinbutton',{name:'New reading'}).first().fill('3600');const button=panel.locator('.pm-machine-meter-card').first().locator('button[type="submit"]');
  await button.evaluate((element:HTMLButtonElement)=>{element.click();element.click();});await expect.poll(()=>requests).toBe(1);await expectActionPending(button);const initialLoads=taskLoads;await expect.poll(()=>taskLoads,{timeout:7000}).toBeGreaterThan(initialLoads);
  gate.release();await expect(actionProgress(button)).toHaveAttribute('data-action-progress','success');await expect(panel).toContainText('3,600');
});

function backupStatus(){return{ok:true,externalBackup:{destination:'/media/usb/MCC_Backups',enabled:true,lastTestAt:null,lastTestOk:null,lastTestMessage:'Not tested',lastCopyAt:null,lastCopyOk:null,lastCopyMessage:'No copy has run',lastCopyBackupId:null,lastCopyFilename:null},portableBackups:[],importedRecoveryBackups:[],recoveryLocation:'/var/lib/mcc-recovery',recoveryStorage:{usedBytes:0,remainingBytes:8192,quotaBytes:8192,packageCount:0,maxPackages:3,atCapacity:false},permissions:{canViewDaily:true,canCreateDaily:true,canRestoreDaily:true,canViewWeekly:true,canCreateWeekly:true,canRestoreWeekly:true,canViewMaster:true,canCreateMaster:true,canRestoreMaster:true,canUsePortableRecovery:true,canConfigureExternalBackup:true,canViewBackups:true,canCreateBackup:true,canRestoreBackup:true},daily:{category:'daily',categoryLabel:'Daily',visible:true},weekly:{category:'weekly',categoryLabel:'Weekly',visible:true},master:{category:'master',categoryLabel:'Master',visible:true}};}

test('Settings backup-location configuration save does not lock unrelated backup controls',async({page})=>{
  const gate=deferred();let requests=0;
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;const method=route.request().method();
    if(path==='/api/auth/status')return fulfill(route,issue80Auth);
    if(path==='/api/version')return fulfill(route,{version:'1.5.7',displayVersion:'v1.5.7',commit:'issue80',buildDate:null});
    if(path==='/api/system/update/status')return fulfill(route,{ok:true,configured:false,available:false,state:'idle',mode:'disabled',environmentLabel:'UPDATER NOT CONFIGURED',installedVersion:'1.5.7',installedCommit:'issue80',csrfToken:'',active:false});
    if(path==='/api/settings/branding')return fulfill(route,{branding:{}});
    if(path==='/api/settings/network-links')return fulfill(route,{localhostUrl:'http://localhost:4273',detectedLanUrls:[]});
    if(path==='/api/backup/status')return fulfill(route,backupStatus());
    if(path==='/api/backup/external'&&method==='PUT'){requests+=1;await gate.promise;return fulfill(route,{ok:true,message:'Backup location saved for Issue 80.'});}
    if(path==='/api/admin/reset/status')return fulfill(route,{error:'Owner Admin only.'},403);
    return fulfill(route,{ok:true});
  });
  await page.goto('/settings');const panel=page.getByRole('region',{name:'Portable Master Backup and Recovery'});await panel.getByLabel('Server-side external backup destination').fill('/mnt/issue80');const button=panel.locator('.backup-external-controls .primary-button');
  await button.evaluate((element:HTMLButtonElement)=>{element.click();element.click();});await expect.poll(()=>requests).toBe(1);await expectActionPending(button);await expect(panel.getByRole('button',{name:'Test Backup Location'})).toBeEnabled();gate.release();
  await expect(actionProgress(button)).toHaveAttribute('data-action-progress','success');await expect(panel.getByText('Backup location saved for Issue 80.')).toBeVisible();
});

test('One-request Requisition batch and staged-item CRUD use shared progress while preview remains specialized',async({page})=>{
  const batchGate=deferred();const itemGate=deferred();let batchRequests=0;let itemRequests=0;const general={id:1,name:'General / Unassigned',description:'',assetMachine:'',workOrderNumber:'',neededByDate:'',status:'Open',isGeneral:true,itemCount:0,openItemCount:0,convertedItemCount:0,requisitions:[],createdBy:'Issue 80 Owner',createdAt:'2026-08-20T12:00:00Z',convertedAt:''};const createdBatch={...general,id:2,name:'Issue 80 Batch',isGeneral:false};let batches=[general];let items:unknown[]=[];
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url());const path=url.pathname;const method=route.request().method();
    if(path==='/api/auth/status')return fulfill(route,issue80Auth);
    if(path==='/api/requisitions/summary')return fulfill(route,{ok:true,requestedCount:0,orderedCount:0,receivedCount:0,canceledCount:0,activeCount:0});
    if(path==='/api/inventory/native/parts')return fulfill(route,{ok:true,parts:[]});
    if(path==='/api/requisition-batches'&&method==='GET')return fulfill(route,{ok:true,batches});
    if(path==='/api/requisition-batches'&&method==='POST'){batchRequests+=1;await batchGate.promise;batches=[...batches,createdBatch];return fulfill(route,{ok:true,batch:createdBatch},201);}
    if(path==='/api/requisition-staging'&&method==='GET')return fulfill(route,{ok:true,items});
    if(path==='/api/requisition-staging'&&method==='POST'){itemRequests+=1;await itemGate.promise;items=[{id:801,batchId:2,inventoryPartId:null,partNumber:'STAGED-80',description:'Shared progress staged item',vendor:'Issue 80 Supply',supplierPartNumber:'',quantityRequested:2,unitCost:5,location:'Stores',assetMachine:'',workOrderNumber:'',priority:'Normal',notes:'',requestedBy:'Issue 80 Owner',dateAdded:'2026-08-21T12:00:00Z',neededByDate:'',status:'Need to Order'}];return fulfill(route,{ok:true,item:items[0]},201);}
    return fulfill(route,{ok:true,requisitions:[],summary:{requestedCount:0,orderedCount:0,receivedCount:0,canceledCount:0,activeCount:0}});
  });
  await page.goto('/requisitions');await page.getByRole('button',{name:'Create Requisition Batch'}).click();let modal=page.locator('.staging-editor-modal').filter({has:page.getByRole('heading',{name:'Create Requisition Batch'})});await modal.getByLabel(/Batch Name/).fill('Issue 80 Batch');let button=modal.locator('button[type="submit"]');
  await button.evaluate((element:HTMLButtonElement)=>{element.click();element.click();});await expect.poll(()=>batchRequests).toBe(1);await expectActionPending(button);batchGate.release();await expect(actionProgress(button)).toHaveAttribute('data-action-progress','success');await expect(page.locator('.active-requisition-batch-heading')).toContainText('Issue 80 Batch');

  await page.getByRole('button',{name:'Manually Add Item'}).first().click();modal=page.locator('.staging-editor-modal').filter({has:page.getByRole('heading',{name:'Add staged item'})});await modal.getByRole('textbox',{name:'Part Number *',exact:true}).fill('STAGED-80');await modal.getByRole('textbox',{name:'Description *',exact:true}).fill('Shared progress staged item');await modal.getByRole('textbox',{name:'Vendor *',exact:true}).fill('Issue 80 Supply');await modal.getByLabel(/Quantity Requested/).fill('2');button=modal.locator('button[type="submit"]');
  await button.evaluate((element:HTMLButtonElement)=>{element.click();element.click();});await expect.poll(()=>itemRequests).toBe(1);await expectActionPending(button);itemGate.release();await expect(actionProgress(button)).toHaveAttribute('data-action-progress','success');await expect(page.getByText('STAGED-80',{exact:true})).toBeVisible();
  const preview=page.getByRole('button',{name:'Preview Requisition'});await expect(preview).not.toContainText(/Saving|Creating|%/);
});
