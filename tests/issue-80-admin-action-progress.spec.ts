import {expect,type Page,test} from '@playwright/test';
import {actionProgress,deferred,expectActionPending,fulfill,issue80Auth,issue80Owner,vendorRecord} from './issue-80-progress-helpers';

const managedUser={id:81,fullName:'Managed User',email:'managed@example.com',role:'Maintenance Tech 2',isOwnerAdmin:false,forcePasswordChange:false,disabled:false,lastLoginAt:null,canDisable:true,canDelete:true,canResetPassword:true,canManagePermissions:true,specialPermissionGrants:[]};

async function mockUsers(page:Page){
  const users=[issue80Owner,managedUser];
  const createGate=deferred();const resetGate=deferred();const permissionGate=deferred();
  let createRequests=0;let resetRequests=0;let permissionRequests=0;
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;const method=route.request().method();
    if(path==='/api/auth/status')return fulfill(route,issue80Auth);
    if(path==='/api/users'&&method==='GET')return fulfill(route,{users});
    if(path==='/api/users'&&method==='POST'){createRequests+=1;await createGate.promise;return fulfill(route,{user:{...managedUser,id:82,fullName:'Created Progress User'}},201);}
    if(path==='/api/users/81/reset-password'&&method==='POST'){resetRequests+=1;await resetGate.promise;return fulfill(route,{temporaryPassword:'Valid-Reset!80',tempPasswordExpiresAt:'2026-08-21T13:00:00Z'});}
    if(path==='/api/users/81/permissions'&&method==='GET')return fulfill(route,{user:managedUser,canManage:true,specialPermissionGrants:[],catalog:[{key:'inventory',label:'Inventory',permissions:[{key:'inventory.export',label:'Export Inventory',inherited:false}]}]});
    if(path==='/api/users/81/permissions'&&method==='PUT'){permissionRequests+=1;await permissionGate.promise;return fulfill(route,{ok:true});}
    return fulfill(route,{ok:true});
  });
  return {createGate,resetGate,permissionGate,createRequests:()=>createRequests,resetRequests:()=>resetRequests,permissionRequests:()=>permissionRequests};
}

test('User create has compact pending/success feedback and prevents duplicate requests',async({page})=>{
  const api=await mockUsers(page);await page.goto('/users');
  await page.getByLabel('Full name').fill('Created Progress User');
  await page.getByLabel('Email').fill('created-progress@example.com');
  await page.getByRole('textbox',{name:'Temporary password',exact:true}).fill('Valid-Temporary!80');
  const form=page.locator('.user-create-form');const button=form.locator('button[type="submit"]');
  await form.evaluate((element:HTMLFormElement)=>{element.requestSubmit();element.requestSubmit();});
  await expect.poll(api.createRequests).toBe(1);await expectActionPending(button);
  await expect(form.getByRole('button',{name:'Generate Password'})).toBeEnabled();
  api.createGate.release();await expect(actionProgress(button)).toHaveAttribute('data-action-progress','success');
  await expect(page.getByText('User created successfully')).toBeVisible();
});

test('Admin password reset and permission save use independent ordinary-action progress',async({page},testInfo)=>{
  test.skip(testInfo.project.name==='mobile-chromium','Secondary admin form coverage runs once on desktop.');
  const api=await mockUsers(page);await page.goto('/users');const row=page.locator('tbody tr',{hasText:'Managed User'});

  await row.getByRole('button',{name:'Reset Password'}).click();
  let modal=page.getByRole('dialog',{name:'Reset password for Managed User'});
  await modal.getByRole('textbox',{name:'Temporary Password',exact:true}).fill('Valid-Reset!80');
  await modal.getByRole('textbox',{name:'Confirm Temporary Password',exact:true}).fill('Valid-Reset!80');
  let button=modal.locator('button[type="submit"]');
  await button.evaluate((element:HTMLButtonElement)=>{element.click();element.click();});
  await expect.poll(api.resetRequests).toBe(1);await expectActionPending(button);
  api.resetGate.release();await expect(actionProgress(button)).toHaveAttribute('data-action-progress','success');
  await expect(modal.getByText('Temporary password created successfully')).toBeVisible();
  await modal.getByRole('button',{name:'Done'}).click();

  await row.getByRole('button',{name:'Special Permissions'}).click();
  modal=page.getByRole('dialog',{name:'Special permissions for Managed User'});
  await modal.getByLabel('Export Inventory').check();button=modal.locator('.mcc-modal-actions .primary-button');
  await button.evaluate((element:HTMLButtonElement)=>{element.click();element.click();});
  await expect.poll(api.permissionRequests).toBe(1);await expectActionPending(button);
  api.permissionGate.release();await expect(actionProgress(button)).toHaveAttribute('data-action-progress','success');
  await expect(modal).toHaveCount(0);
});

test('Vendor contact save shows shared progress and suppresses duplicate contact creation',async({page})=>{
  const vendor=vendorRecord(80,'Contact Progress Supply');const savedContact={id:801,vendorId:80,contactName:'Progress Contact',contactTitle:'Buyer',email:'progress@example.com',phoneType:'',phoneNumber:'',phoneNormalized:'',phoneExt:'',notes:'',isPrimary:true,deleted:false};
  const updated={...vendor,contacts:[savedContact],contactCount:1,primaryContactName:savedContact.contactName,primaryContactEmail:savedContact.email};
  const gate=deferred();let requests=0;let contacts:unknown[]=[];
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;const method=route.request().method();
    if(path==='/api/auth/status')return fulfill(route,issue80Auth);
    if(path==='/api/vendors'&&method==='GET')return fulfill(route,{ok:true,vendors:[vendor]});
    if(path==='/api/vendors/80/contacts'&&method==='GET')return fulfill(route,{ok:true,vendor:updated,contacts});
    if(path==='/api/vendors/80/contacts'&&method==='POST'){requests+=1;await gate.promise;contacts=[savedContact];return fulfill(route,{ok:true,vendor:updated,contact:savedContact},201);}
    return fulfill(route,{ok:true});
  });
  await page.goto('/vendors');await page.locator('.vendor-contact-summary-button').click();
  const modal=page.getByRole('dialog',{name:'Contact Progress Supply contacts'});await modal.getByRole('button',{name:'Add Contact'}).click();await modal.getByLabel(/Contact Name/).fill('Progress Contact');
  const button=modal.locator('button[type="submit"]');await button.evaluate((element:HTMLButtonElement)=>{element.click();element.click();});
  await expect.poll(()=>requests).toBe(1);await expectActionPending(button);gate.release();
  await expect(actionProgress(button)).toHaveAttribute('data-action-progress','success');await expect(modal.getByText('Progress Contact')).toBeVisible();
});

test('Inventory embedded vendor editor uses shared progress without locking inventory navigation',async({page},testInfo)=>{
  test.skip(testInfo.project.name==='mobile-chromium','The embedded editor is covered on desktop; Inventory item progress already covers mobile.');
  const part={id:'80',itemId:'ITEM-80',partNumber:'UNKNOWN-80',description:'Part with unknown vendor',location:'Stores',vendor:'Embedded Progress Supply',vendorId:null,vendorDeleted:false,vendorIsActive:true,quantity:4,minQuantity:1,status:'In Stock',requisition:'',orderPlaced:false,hasActiveRequisitionRecord:false,isInRequisitionStaging:false,requisitionStagingItemId:null,requisitionStagingStatus:'',partInfoUrl:'',manufacturerBrand:'MCC',unitCost:12.5,supplierPartNumber:'',leadTime:'',importantNote:'',createdAt:'2026-08-21T12:00:00Z',updatedAt:'2026-08-21T12:00:00Z'};
  const saved=vendorRecord(82,'Embedded Progress Supply');const gate=deferred();let requests=0;
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;const method=route.request().method();
    if(path==='/api/auth/status')return fulfill(route,issue80Auth);
    if(path==='/api/inventory/native/summary')return fulfill(route,{ok:true,totalParts:1,lowStockCount:0,requisitionCount:0,vendorCount:0,locationCount:1});
    if(path==='/api/inventory/native/parts')return fulfill(route,{ok:true,parts:[part]});
    if(path==='/api/inventory/native/backups')return fulfill(route,{ok:true,backups:[]});
    if(path==='/api/vendors'&&method==='GET')return fulfill(route,{ok:true,vendors:[]});
    if(path==='/api/vendors'&&method==='POST'){requests+=1;await gate.promise;return fulfill(route,{ok:true,vendor:saved},201);}
    return fulfill(route,{ok:true});
  });
  await page.goto('/inventory');await page.getByRole('button',{name:'Embedded Progress Supply'}).click();
  const modal=page.locator('.vendor-modal').filter({has:page.getByRole('heading',{name:'Add vendor record'})});const button=modal.locator('button[type="submit"]');
  await button.evaluate((element:HTMLButtonElement)=>{element.click();element.click();});await expect.poll(()=>requests).toBe(1);await expectActionPending(button);
  await expect(page.getByRole('button',{name:'Open command menu'})).toBeEnabled();gate.release();await expect(actionProgress(button)).toHaveAttribute('data-action-progress','success');
  await expect(page.getByRole('dialog',{name:'Embedded Progress Supply vendor details'})).toBeVisible();
});
