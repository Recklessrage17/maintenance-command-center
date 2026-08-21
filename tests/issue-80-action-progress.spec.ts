import {expect,type Locator,type Page,type Route,test} from '@playwright/test';
import {expectCompactActionRow} from './issue-80-progress-helpers';

type Deferred={promise:Promise<void>;release:()=>void};

function deferred():Deferred{
  let release=()=>undefined;
  const promise=new Promise<void>(resolve=>{release=resolve;});
  return {promise,release};
}

function fulfill(route:Route,json:unknown,status=200){return route.fulfill({status,contentType:'application/json',body:JSON.stringify(json)});}

const owner={id:80,fullName:'Issue 80 Tester',email:'issue80@example.com',role:'Admin',isOwnerAdmin:true,canViewSystemVersion:false,forcePasswordChange:false};
const auth={setupRequired:false,user:owner};

function progress(button:Locator){return button.locator('.action-button-progress');}

async function expectPending(button:Locator){
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute('aria-busy','true');
  await expect(progress(button)).toHaveAttribute('data-action-progress','pending');
  await expect(progress(button).locator('[data-action-progress-indicator="pending"]')).toBeVisible();
  await expect(button).not.toContainText('%');
}

function vendor(id:number,companyName:string){
  return {id,companyName,phoneType:'',phoneNumber:'',phoneNormalized:'',phoneExt:'',websiteUrl:'',addressLine1:'',addressLine2:'',city:'',state:'',postalCode:'',country:'United States',contactName:'',contactTitle:'',contactPhoneType:'',contactPhoneNumber:'',contactPhoneExt:'',contactEmail:'',notes:'',isActive:true,deleted:false,status:'Enabled',contactCount:0,primaryContactName:'',primaryContactEmail:'',contacts:[]};
}

test('Vendor create/edit shows stable pending/success/error states, blocks duplicates, and reduces motion',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  const rows=[vendor(1,'Existing Supply')];
  let gate=deferred();
  let mutation:'create'|'edit-error'='create';
  let requests=0;
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/auth/status')return fulfill(route,auth);
    if(path==='/api/vendors'&&route.request().method()==='GET')return fulfill(route,{ok:true,vendors:rows});
    if((path==='/api/vendors'&&route.request().method()==='POST')||(/\/api\/vendors\/\d+$/.test(path)&&route.request().method()==='PUT')){
      requests+=1;const current=gate;await current.promise;
      if(mutation==='edit-error')return fulfill(route,{error:'Vendor save failed safely.'},500);
      const saved=vendor(2,'Deferred Vendor');rows.push(saved);return fulfill(route,{ok:true,vendor:saved},201);
    }
    return fulfill(route,{ok:true});
  });

  await page.goto('/vendors');
  await page.getByRole('button',{name:'Add Vendor',exact:true}).click();
  const modal=page.locator('.vendor-modal').filter({has:page.getByRole('heading',{name:'Add vendor record'})});
  await modal.getByLabel(/Company Name/).fill('Deferred Vendor');
  const button=modal.locator('button[type="submit"]');
  await expectCompactActionRow(button,modal.getByRole('button',{name:'Cancel'}));
  const idleBox=(await button.boundingBox())!;
  await button.evaluate((element:HTMLButtonElement)=>{element.click();element.click();});
  await expect.poll(()=>requests).toBe(1);
  await expectPending(button);
  let activeBox=(await button.boundingBox())!;
  expect(Math.abs(activeBox.width-idleBox.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(activeBox.height-idleBox.height)).toBeLessThanOrEqual(1);
  expect(await progress(button).locator('.action-button-progress__indicator').evaluate(element=>getComputedStyle(element).animationName)).toBe('none');
  gate.release();
  await expect(progress(button)).toHaveAttribute('data-action-progress','success');
  activeBox=(await button.boundingBox())!;
  expect(Math.abs(activeBox.width-idleBox.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(activeBox.height-idleBox.height)).toBeLessThanOrEqual(1);
  expect(await progress(button).locator('.action-button-progress__indicator').evaluate(element=>getComputedStyle(element).animationName)).toBe('none');
  await expect(modal).toHaveCount(0);

  mutation='edit-error';gate=deferred();
  await page.goto('/vendors');
  const existing=page.locator('.vendor-card',{hasText:'Existing Supply'});
  await existing.getByRole('button',{name:'Edit',exact:true}).click();
  const editModal=page.locator('.vendor-modal').filter({has:page.getByRole('heading',{name:'Edit vendor record'})});
  const editButton=editModal.locator('button[type="submit"]');
  await editButton.click();
  await expectPending(editButton);
  gate.release();
  await expect(progress(editButton)).toHaveAttribute('data-action-progress','error');
  await expect(editModal.getByText('Vendor save failed safely.')).toBeVisible();
  await expect(editButton).toBeEnabled();
  await expect(progress(editButton)).not.toHaveAttribute('data-action-progress','success');
  expect(requests).toBe(2);
});

function inventoryPart(id:string,partNumber:string,description:string){
  return {id,itemId:`ITEM-${id}`,partNumber,description,location:'Stores',vendor:'Issue 80 Supply',vendorId:'8',vendorDeleted:false,vendorIsActive:true,quantity:4,minQuantity:1,status:'In Stock',requisition:'',orderPlaced:false,hasActiveRequisitionRecord:false,isInRequisitionStaging:false,requisitionStagingItemId:null,requisitionStagingStatus:'',partInfoUrl:'',manufacturerBrand:'MCC',unitCost:12.5,supplierPartNumber:'',leadTime:'',importantNote:'',createdAt:'2026-08-21T12:00:00Z',updatedAt:'2026-08-21T12:00:00Z'};
}

test('Inventory create/edit shows pending/success/error and prevents duplicate item requests',async({page},testInfo)=>{
  const parts:Array<ReturnType<typeof inventoryPart>>=[];
  const supply=vendor(8,'Issue 80 Supply');
  let gate=deferred();let fail=false;let requests=0;
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;const method=route.request().method();
    if(path==='/api/auth/status')return fulfill(route,auth);
    if(path==='/api/inventory/native/summary')return fulfill(route,{ok:true,totalParts:parts.length,lowStockCount:0,requisitionCount:0,vendorCount:1,locationCount:1});
    if(path==='/api/inventory/native/parts'&&method==='GET')return fulfill(route,{ok:true,parts});
    if(path==='/api/inventory/native/backups')return fulfill(route,{ok:true,backups:[]});
    if(path==='/api/vendors')return fulfill(route,{ok:true,vendors:[supply]});
    if((path==='/api/inventory/native/parts'&&method==='POST')||(/\/api\/inventory\/native\/parts\/[^/]+$/.test(path)&&method==='PATCH')){
      requests+=1;const current=gate;await current.promise;
      if(fail)return fulfill(route,{error:'Inventory save failed safely.'},500);
      const saved=inventoryPart('80','PART-80','Deferred inventory part');parts.splice(0,parts.length,saved);return fulfill(route,{ok:true,part:saved},method==='POST'?201:200);
    }
    return fulfill(route,{ok:true});
  });

  await page.goto('/inventory');
  if(testInfo.project.name==='mobile-chromium')await page.locator('.mobile-inventory-controls summary').click();
  await page.getByRole('button',{name:'Add Part',exact:true}).first().click();
  const modal=page.locator('.inventory-modal');
  await modal.getByLabel(/Part Number/).fill('PART-80');
  await modal.getByLabel(/Description/).fill('Deferred inventory part');
  await modal.getByLabel(/Vendor/).fill('Issue 80 Supply');
  await modal.locator('.inventory-numeric-grid label').first().locator('input').fill('4');
  await modal.getByLabel(/Unit Cost/).fill('12.50');
  const addButton=modal.locator('button[type="submit"]');
  await expectCompactActionRow(addButton,modal.getByRole('button',{name:'Cancel'}));
  await addButton.evaluate((element:HTMLButtonElement)=>{element.click();element.click();});
  await expect.poll(()=>requests).toBe(1);
  await expectPending(addButton);
  gate.release();
  await expect(progress(addButton)).toHaveAttribute('data-action-progress','success');
  await expect(modal).toHaveCount(0);
  await expect(page.getByText('PART-80',{exact:true})).toBeVisible();

  fail=true;gate=deferred();
  const row=page.locator('tbody tr',{hasText:'PART-80'});
  await row.getByRole('button',{name:'Edit',exact:true}).click();
  const editModal=page.locator('.inventory-modal');
  await editModal.getByLabel(/Description/).fill('Edit must fail');
  const editButton=editModal.locator('button[type="submit"]');
  await editButton.click();
  await expectPending(editButton);
  gate.release();
  await expect(progress(editButton)).toHaveAttribute('data-action-progress','error');
  await expect(editModal.getByText('Inventory save failed safely.')).toBeVisible();
  await expect(editButton).toBeEnabled();
  await expect(progress(editButton)).not.toHaveAttribute('data-action-progress','success');
  expect(requests).toBe(2);
});

const reqLine={id:801,inventoryPartId:80,partNumber:'REQ-PART-80',description:'Issue 80 requisition line',vendorName:'Issue 80 Supply',locationName:'Stores',quantityRequested:2,unitCost:5,totalCost:10,unitOfMeasure:'EA',itemNumber:'ITEM-80',notes:''};
const requisition={id:80,requisitionNumber:'REQ-80',inventoryPartId:80,partNumber:reqLine.partNumber,description:reqLine.description,vendorName:reqLine.vendorName,locationName:reqLine.locationName,quantityRequested:2,lineCount:1,firstPartNumber:reqLine.partNumber,firstDescription:reqLine.description,totalQuantity:2,totalCost:10,vendorSummary:reqLine.vendorName,locationSummary:reqLine.locationName,partNumbers:[reqLine.partNumber],descriptions:[reqLine.description],lines:[reqLine],status:'Requested',requestedByName:'Issue 80 Tester',requestedAt:'2026-08-20T12:00:00Z',orderedAt:null,receivedAt:null,canceledAt:null,workOrderNumber:'WO-80',notes:'Original',cancelReason:'',deleted:false,deletedAt:null};

test('Requisition edit uses the shared compact action lifecycle',async({page})=>{
  const gate=deferred();let requests=0;
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;const method=route.request().method();
    if(path==='/api/auth/status')return fulfill(route,auth);
    if(path==='/api/inventory/native/parts')return fulfill(route,{ok:true,parts:[]});
    if(path==='/api/requisitions'&&method==='GET')return fulfill(route,{ok:true,requisitions:[requisition],summary:{requestedCount:1,orderedCount:0,receivedCount:0,canceledCount:0,activeCount:1}});
    if(path==='/api/requisitions/80'&&method==='PATCH'){requests+=1;await gate.promise;return fulfill(route,{ok:true,requisition});}
    return fulfill(route,{ok:true});
  });
  await page.goto('/requisitions?view=active');
  await page.locator('tbody tr',{hasText:'REQ-80'}).getByRole('button',{name:'Edit',exact:true}).click();
  const modal=page.locator('.requisition-modal').filter({hasText:'Edit requisition'});
  const button=modal.locator('button[type="submit"]');
  await button.evaluate((element:HTMLButtonElement)=>{element.click();element.click();});
  await expect.poll(()=>requests).toBe(1);
  await expectPending(button);
  gate.release();
  await expect(progress(button)).toHaveAttribute('data-action-progress','success');
  await expect(modal).toHaveCount(0);
});

test('Machine create uses shared progress and suppresses duplicate submissions',async({page})=>{
  const gate=deferred();let requests=0;
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;const method=route.request().method();
    if(path==='/api/auth/status')return fulfill(route,auth);
    if(path==='/api/machine-library/assets'&&method==='GET')return fulfill(route,{ok:true,assets:[],brandSettings:[],permissions:{canEdit:true,canDelete:true,canManagePm:true}});
    if(path==='/api/machine-library/assets'&&method==='POST'){requests+=1;await gate.promise;return fulfill(route,{ok:true},201);}
    return fulfill(route,{ok:true});
  });
  await page.goto('/machine-library');
  await page.getByRole('button',{name:'Add Machine Asset'}).click();
  await page.getByRole('button',{name:'Continue'}).click();
  const modal=page.locator('.machine-editor-modal');
  await modal.getByLabel(/Asset Number \/ Press Number/).fill('PRESS-80');
  await modal.getByLabel('Brand *').fill('MCC');
  const button=modal.locator('button[type="submit"]');
  await button.evaluate((element:HTMLButtonElement)=>{element.click();element.click();});
  await expect.poll(()=>requests).toBe(1);
  await expectPending(button);
  gate.release();
  await expect(progress(button)).toHaveAttribute('data-action-progress','success');
  await expect(modal).toHaveCount(0);
});

const equipment={id:301,assetNumber:'EQ-301',equipmentName:'Issue 80 Dryer',assetName:'Issue 80 Dryer',category:'Dryer',equipmentType:'Desiccant Dryer',manufacturer:'MCC',brand:'MCC',model:'M80',serialNumber:'EQ80',equipmentYear:'2024',year:'2024',location:'Stores',department:'Maintenance',status:'active',criticality:'high',powerType:'Electric',voltage:'480 VAC',phase:'3 phase',amperage:'20 A',airRequirement:'',waterRequirement:'',capacityRating:'100 lb',dimensions:'40 x 40',weight:'200 lb',specificationNotes:'Issue 80 fixture',createdAt:'2026-08-20T12:00:00Z',updatedAt:'2026-08-20T12:00:00Z',pmSummary:null,latestHistory:null};

test('Equipment create uses shared progress and suppresses duplicate submissions',async({page})=>{
  const gate=deferred();let requests=0;
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;const method=route.request().method();
    if(path==='/api/auth/status')return fulfill(route,auth);
    if(path==='/api/equipment-library/assets'&&method==='GET')return fulfill(route,{ok:true,assets:[],categories:['Dryer'],permissions:{canEdit:true,canDelete:true,canManagePm:true}});
    if(path==='/api/equipment-library/assets'&&method==='POST'){requests+=1;await gate.promise;return fulfill(route,{ok:true,asset:equipment},201);}
    return fulfill(route,{ok:true});
  });
  await page.goto('/equipment-library');
  await page.getByRole('button',{name:'Add Equipment'}).click();
  const modal=page.locator('.equipment-form-modal');
  await modal.getByLabel('Equipment Name *').fill('Issue 80 Dryer');
  await modal.getByLabel('Equipment Asset # *').fill('EQ-301');
  const category=modal.getByRole('combobox',{name:'Category *'});await category.click();await category.fill('Dryer');await modal.getByRole('option',{name:'Dryer',exact:true}).click();
  const button=modal.locator('button[type="submit"]');
  await button.evaluate((element:HTMLButtonElement)=>{element.click();element.click();});
  await expect.poll(()=>requests).toBe(1);
  await expectPending(button);
  gate.release();
  await expect(progress(button)).toHaveAttribute('data-action-progress','success');
  await expect(modal).toHaveCount(0);
});

test('PM schedule save keeps PM polling semantics while sharing compact completion feedback',async({page})=>{
  const gate=deferred();let requests=0;
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;const method=route.request().method();
    if(path==='/api/auth/status')return fulfill(route,auth);
    if(path==='/api/equipment-library/assets'&&method==='GET')return fulfill(route,{ok:true,assets:[equipment],categories:['Dryer'],permissions:{canEdit:true,canDelete:true,canManagePm:true}});
    if(path==='/api/equipment-library/assets/301/history')return fulfill(route,{ok:true,records:[]});
    if(path==='/api/equipment-library/assets/301/preventive-maintenance'&&method==='GET')return fulfill(route,{ok:true,tasks:[],summary:{total:0,dueSoon:0,overdue:0,nextDueDate:null,nextDueMeter:null}});
    if(path==='/api/equipment-library/assets/301/preventive-maintenance'&&method==='POST'){requests+=1;await gate.promise;return fulfill(route,{ok:true},201);}
    if(path==='/api/equipment-library/assets/301/preventive-maintenance/meters')return fulfill(route,{ok:true,meters:{hours:null,cycles:null}});
    if(path.endsWith('/document-folders'))return fulfill(route,{ok:true,folders:[],summary:{folderCount:0,documentCount:0}});
    if(path.endsWith('/documents'))return fulfill(route,{ok:true,documents:[]});
    if(path.endsWith('/notes'))return fulfill(route,{ok:true,notes:[]});
    return fulfill(route,{ok:true});
  });
  await page.goto('/equipment-library');
  await page.locator('.equipment-asset-card').click();
  await page.getByRole('button',{name:/Preventive Maintenance Tracking/}).click();
  await page.getByRole('button',{name:'Add Preventive Maintenance Tracking'}).click();
  const modal=page.locator('.pm-modal').filter({has:page.getByRole('heading',{name:'Add Preventive Maintenance Tracking'})});
  await modal.getByLabel('PM Title *').fill('Inspect filters');
  await modal.getByLabel('Interval Type *').selectOption('hourly');
  await modal.getByLabel(/How long is the interval/).fill('100');
  await modal.getByLabel(/Last Completed Hours/).fill('0');
  const button=modal.locator('button[type="submit"]');
  await button.evaluate((element:HTMLButtonElement)=>{element.click();element.click();});
  await expect.poll(()=>requests).toBe(1);
  await expectPending(button);
  await expect(modal.locator('.pm-action-progress')).toBeVisible();
  gate.release();
  await expect(progress(button)).toHaveAttribute('data-action-progress','success');
  await expect(modal).toHaveCount(0);
});

test('Settings branding save uses shared pending and completed states',async({page})=>{
  const gate=deferred();let requests=0;
  const branding={companyName:'MCC',companySubtitle:'Maintenance Command Center',companyAccentText:'',logoMode:'text',logoUrl:'',logoFileName:'',iconAnimation:'none'};
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;const method=route.request().method();
    if(path==='/api/auth/status')return fulfill(route,auth);
    if(path==='/api/settings/branding'&&method==='GET')return fulfill(route,{ok:true,branding});
    if(path==='/api/settings/branding'&&method==='PUT'){requests+=1;await gate.promise;return fulfill(route,{ok:true,branding:{...branding,companyName:'MCC 80'},message:'Branding saved for Issue 80.'});}
    if(path==='/api/settings/network-links')return fulfill(route,{accessMode:'development',localhostUrl:'http://localhost:4273',detectedLanUrls:[],primaryLanUrl:null});
    if(path==='/api/backup/status'||path==='/api/admin/reset/status')return fulfill(route,{error:'Unavailable in fixture.'},403);
    return fulfill(route,{ok:true});
  });
  await page.goto('/settings');
  await page.getByLabel(/Company Name/).fill('MCC 80');
  const button=page.locator('.branding-card .backup-action-row .primary-button');
  await button.evaluate((element:HTMLButtonElement)=>{element.click();element.click();});
  await expect.poll(()=>requests).toBe(1);
  await expectPending(button);
  await expect(page.locator('.branding-card .backup-action-row .secondary-button')).toBeDisabled();
  gate.release();
  await expect(progress(button)).toHaveAttribute('data-action-progress','success');
  await expect(page.getByText('Branding saved for Issue 80.')).toBeVisible();
});
