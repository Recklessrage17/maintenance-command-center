import {expect,test,type Page} from '@playwright/test';

const allPermissions=['inventory.view','inventory.create','inventory.edit','inventory.requisition_stage','requisitions.view'];
function part(id:number,quantity=0,workflow='Needs Action') {
  return {id:String(id),itemId:String(id),partNumber:`STOCK-${id}`,description:`Hydraulic component ${id}`,quantity,minQuantity:4,vendor:'McMaster-Carr',location:'Maint',status:quantity===0?'Out of Stock':'Low Stock',workflow,dashboardStockAlertEnabled:true,obsolete:false,requisition:workflow==='Ordered'?'Ordered':'',orderPlaced:workflow==='Ordered',hasActiveRequisitionRecord:workflow==='Requisition Added'||workflow==='Ordered',isInRequisitionStaging:workflow==='Added to Stage',activeRequisitionNumber:workflow==='Requisition Added'||workflow==='Ordered'?`REQ-${id}`:'',requisitionStagingStatus:'Need to Order',requisitionStagingBatchId:7,requisitionStagingItemId:10,partInfoUrl:'',manufacturerBrand:'',unitCost:2,supplierPartNumber:'',leadTime:'',importantNote:'',createdAt:'2026-09-09',updatedAt:'2026-09-09'};
}
async function mockApp(page:Page,permissions=allPermissions) {
  const parts=[part(1),part(2,1),part(3,0,'Added to Stage'),part(4,0,'Requisition Added'),part(5,0,'Ordered')];
  const submissions:Record<string,unknown>[]=[];
  let reject=false;
  await page.route('**/api/**',async route=>{
    const req=route.request();const path=new URL(req.url()).pathname;
    if(path==='/api/auth/status')return route.fulfill({json:{setupRequired:false,user:{id:1,fullName:'Stock QA',email:'qa@example.com',role:'Admin',isOwnerAdmin:true,forcePasswordChange:false,effectivePermissions:permissions}}});
    if(path==='/api/dashboard/inventory-attention'){
      const items=parts.filter(p=>p.dashboardStockAlertEnabled&&!p.obsolete&&p.quantity<=p.minQuantity);
      return route.fulfill({json:{ok:true,items,outOfStockCount:items.filter(p=>p.quantity===0).length,lowStockCount:items.filter(p=>p.quantity>0).length}});
    }
    if(path==='/api/vendors')return route.fulfill({json:{ok:true,vendors:[{id:1,companyName:'McMaster-Carr',isActive:true,deleted:false,contacts:[]}]}});
    if(path==='/api/requisition-batches')return route.fulfill({json:{batches:[{id:7,name:'General / Unassigned',isGeneral:true,status:'Open'}]}});
    if(path==='/api/requisition-staging/bulk'){
      const body=req.postDataJSON();submissions.push(body);
      if(reject)return route.fulfill({status:409,json:{error:'This part is already in the requisition workflow.'}});
      parts.find(p=>p.id===String(body.items[0].inventoryPartId))!.workflow='Added to Stage';
      return route.fulfill({status:201,json:{ok:true,addedCount:1}});
    }
    if(path==='/api/inventory/native/summary')return route.fulfill({json:{ok:true,totalParts:parts.length,lowStockCount:parts.length,requisitionCount:3,vendorCount:1,locationCount:1}});
    if(path==='/api/inventory/native/parts'&&req.method()==='POST'){
      const body=req.postDataJSON();submissions.push(body);const created={...part(9),...body};parts.push(created);return route.fulfill({status:201,json:{ok:true,part:created}});
    }
    if(path==='/api/inventory/native/parts')return route.fulfill({json:{ok:true,parts,writeAvailable:true}});
    if(/\/api\/inventory\/native\/parts\/\d+$/.test(path)&&req.method()==='PATCH'){
      const body=req.postDataJSON();submissions.push(body);const found=parts.find(p=>p.id===path.split('/').at(-1))!;Object.assign(found,body);return route.fulfill({json:{ok:true,part:found}});
    }
    return route.fulfill({json:{ok:true,alerts:[],warningNotes:[],requestedCount:1,orderedCount:1,activeCount:2,vendors:[],backups:[],requisitions:[],items:[]}});
  });
  return {parts,submissions,rejectNext:()=>{reject=true;}};
}

test('stock popup shows all workflow states, stages an editable shortage quantity and refreshes immediately',async({page})=>{
  const fixture=await mockApp(page);await page.goto('/');
  await page.getByRole('button',{name:/Out of Stock: 4/}).click();
  const dialog=page.getByRole('dialog',{name:'Out of Stock Inventory'});await expect(dialog).toBeVisible();
  const closeBox=await dialog.getByRole('button',{name:'Close',exact:true}).boundingBox();expect(closeBox!.width).toBeLessThanOrEqual(100);
  await expect(dialog.getByText('Requisition Added',{exact:true})).toBeVisible();await expect(dialog.getByText('REQ-4',{exact:true})).toBeVisible();
  await expect(dialog.getByText('Ordered',{exact:true})).toBeVisible();
  await expect(dialog.getByRole('link',{name:'View/Edit Staged Qty'})).toHaveAttribute('href','/requisitions?batch=7&search=STOCK-3');
  await expect(dialog.getByRole('link',{name:'STOCK-1',exact:true})).toHaveAttribute('href','/inventory?part=1&search=STOCK-1');
  await expect(dialog.getByRole('button',{name:'Add to Stage',exact:true})).toHaveCount(1);
  await dialog.getByRole('button',{name:'Add to Stage',exact:true}).click();
  const quantity=dialog.getByLabel('How many do you want to request?');await expect(quantity).toHaveValue('4');await expect(quantity).toBeFocused();
  await quantity.fill('6');await dialog.getByRole('button',{name:'Confirm Add to Stage'}).click();
  await expect(dialog.getByRole('status')).toContainText('STOCK-1 added');
  await expect(dialog.getByText('Added to Stage',{exact:true})).toHaveCount(2);
  expect(fixture.submissions).toEqual([{batchId:7,dashboardAttention:true,items:[{inventoryPartId:1,quantityRequested:6}]}]);
  await expect(dialog.getByRole('button',{name:'Add to Stage',exact:true})).toHaveCount(0);
  expect(await dialog.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
  await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:/Low Stock: 1/}).click();
  await page.getByRole('button',{name:'Add to Stage',exact:true}).click();await expect(page.getByLabel('How many do you want to request?')).toHaveValue('3');
});

test('requisition summary and inventory attention share the desktop command row and stack on mobile',async({page},testInfo)=>{
  await mockApp(page);await page.goto('/');
  const requisitions=page.locator('.dashboard-requisition-summary');const inventory=page.locator('.dashboard-inventory-attention');
  await expect(requisitions).toBeVisible();await expect(inventory).toBeVisible();
  const requisitionBox=await requisitions.boundingBox();const inventoryBox=await inventory.boundingBox();
  if(testInfo.project.name==='desktop-chromium'){
    expect(inventoryBox!.x).toBeGreaterThan(requisitionBox!.x+requisitionBox!.width);
    expect(Math.abs(inventoryBox!.y-requisitionBox!.y)).toBeLessThanOrEqual(2);
    expect(Math.abs((inventoryBox!.y+inventoryBox!.height)-(requisitionBox!.y+requisitionBox!.height))).toBeLessThanOrEqual(2);
  }else{
    expect(inventoryBox!.y).toBeGreaterThan(requisitionBox!.y+requisitionBox!.height);
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test('popup keeps focus, supports Escape and reports staging conflicts without duplicate success',async({page})=>{
  const fixture=await mockApp(page);fixture.rejectNext();await page.goto('/');
  const trigger=page.getByRole('button',{name:/Low Stock: 1/});await trigger.click();
  const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Close',exact:true}).focus();await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate(el=>el.contains(document.activeElement))).toBe(true);
  await dialog.getByRole('button',{name:'Add to Stage',exact:true}).click();
  await page.getByLabel('How many do you want to request?').fill('-1');await page.getByRole('button',{name:'Confirm Add to Stage'}).click();expect(fixture.submissions).toHaveLength(0);
  await page.getByLabel('How many do you want to request?').fill('2');await page.getByRole('button',{name:'Confirm Add to Stage'}).click();await expect(dialog.getByRole('alert')).toContainText('already in the requisition workflow');
  await page.keyboard.press('Escape');await expect(dialog.getByRole('button',{name:'Add to Stage',exact:true})).toBeFocused();
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused();
});

test('focus refresh removes replenished and disabled alerts and view-only users have no mutation action',async({page})=>{
  const fixture=await mockApp(page,['inventory.view']);await page.goto('/');
  await page.getByRole('button',{name:/Out of Stock: 4/}).click();await expect(page.getByRole('button',{name:'Add to Stage',exact:true})).toHaveCount(0);
  fixture.parts[0].quantity=9;fixture.parts[2].dashboardStockAlertEnabled=false;
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('button',{name:/Out of Stock: 2/})).toBeAttached();await expect(page.getByRole('dialog').getByRole('link',{name:'STOCK-1',exact:true})).toHaveCount(0);
});

test('inventory deep link opens edit and persists the opt-in toggle',async({page})=>{
  const fixture=await mockApp(page);await page.goto('/inventory?part=1&search=STOCK-1');
  const toggle=page.getByRole('checkbox',{name:/Dashboard Stock Alert/});await expect(toggle).toBeChecked();await toggle.uncheck();await page.getByRole('button',{name:'Save Changes',exact:true}).click();
  await expect(page.locator('.inventory-modal')).toHaveCount(0);expect(fixture.submissions[0].dashboardStockAlertEnabled).toBe(false);
});

test('inventory create defaults stock alert OFF',async({page},testInfo)=>{
  await mockApp(page);await page.goto('/inventory');if(testInfo.project.name==='mobile-chromium')await page.locator('.mobile-inventory-controls summary').click();await page.getByRole('button',{name:'Add Part',exact:true}).click();
  const toggle=page.getByRole('checkbox',{name:/Dashboard Stock Alert/});await expect(toggle).not.toBeChecked();
  const box=await toggle.boundingBox();expect(box!.width).toBeLessThanOrEqual(40);expect(box!.height).toBeLessThanOrEqual(24);
});
