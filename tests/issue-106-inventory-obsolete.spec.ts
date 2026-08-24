import {expect,type Page,test} from '@playwright/test';

type MockPart={id:string;itemId:string;partNumber:string;description:string;location:string;vendor:string;vendorId:string;vendorDeleted:boolean;vendorIsActive:boolean;quantity:number;minQuantity:number;status:string;requisition:string;orderPlaced:boolean;hasActiveRequisitionRecord:boolean;isInRequisitionStaging:boolean;requisitionStagingItemId:null;requisitionStagingStatus:string;partInfoUrl:string;manufacturerBrand:string;unitCost:number;supplierPartNumber:string;leadTime:string;importantNote:string;obsolete:boolean;createdAt:string;updatedAt:string};

function part(id:string,partNumber:string,obsolete:boolean):MockPart{return{id,itemId:`ITEM-${id}`,partNumber,description:`Issue 106 ${obsolete?'obsolete':'active'} part`,location:'Stores',vendor:'Issue 106 Vendor',vendorId:'11',vendorDeleted:false,vendorIsActive:true,quantity:6,minQuantity:2,status:'In Stock',requisition:'',orderPlaced:false,hasActiveRequisitionRecord:false,isInRequisitionStaging:false,requisitionStagingItemId:null,requisitionStagingStatus:'',partInfoUrl:'',manufacturerBrand:'MCC',unitCost:12.5,supplierPartNumber:`SUP-${id}`,leadTime:'2 days',importantNote:'',obsolete,createdAt:'2026-08-24T12:00:00.000Z',updatedAt:'2026-08-24T12:00:00.000Z'};}

async function mockInventory(page:Page){
  const parts=[part('1','ACTIVE-106',false),part('2','OBSOLETE-106',true)];
  let releaseSave:(()=>void)|null=null;
  let blockSave=false;
  await page.route('**/api/**',async route=>{
    const request=route.request();const url=new URL(request.url());const pathname=url.pathname;
    if(pathname==='/api/auth/status')return route.fulfill({json:{setupRequired:false,user:{id:1,fullName:'Inventory Tester',email:'inventory@example.com',role:'Admin',isOwnerAdmin:true,forcePasswordChange:false}}});
    if(pathname==='/api/inventory/native/summary')return route.fulfill({json:{ok:true,totalParts:parts.length,lowStockCount:0,requisitionCount:0,vendorCount:1,locationCount:1}});
    if(pathname==='/api/inventory/native/parts'&&request.method()==='GET')return route.fulfill({json:{ok:true,parts}});
    const match=pathname.match(/^\/api\/inventory\/native\/parts\/(\d+)$/);
    if(match&&request.method()==='PATCH'){
      if(blockSave){await new Promise<void>(resolve=>{releaseSave=resolve;});blockSave=false;releaseSave=null;}
      const index=parts.findIndex(candidate=>candidate.id===match[1]);const body=request.postDataJSON() as Partial<MockPart>;parts[index]={...parts[index],...body,updatedAt:'2026-08-24T13:00:00.000Z'};
      return route.fulfill({json:{ok:true,part:parts[index]}});
    }
    if(pathname==='/api/inventory/native/backups')return route.fulfill({json:{ok:true,backups:[]}});
    if(pathname==='/api/vendors')return route.fulfill({json:{ok:true,vendors:[{id:11,companyName:'Issue 106 Vendor',isActive:true,deleted:false}]}});
    return route.fulfill({json:{ok:true}});
  });
  return{parts,blockNextSave(){blockSave=true;},releaseSave(){releaseSave?.();}};
}

function rowFor(page:Page,partNumber:string){return page.getByRole('row').filter({hasText:partNumber});}

test('Issue 106 marks and clears obsolete inventory with persistent compact visual state',async({page},testInfo)=>{
  await page.emulateMedia({reducedMotion:'reduce'});const state=await mockInventory(page);await page.goto('/inventory');
  const activeRow=rowFor(page,'ACTIVE-106');const obsoleteRow=rowFor(page,'OBSOLETE-106');
  await expect(activeRow).toHaveAttribute('data-obsolete','false');await expect(activeRow).not.toHaveClass(/inventory-row-obsolete/);await expect(activeRow.getByText('OBSOLETE',{exact:true})).toHaveCount(0);
  await expect(obsoleteRow).toHaveAttribute('data-obsolete','true');await expect(obsoleteRow).toHaveClass(/inventory-row-obsolete/);await expect(obsoleteRow.getByText('OBSOLETE',{exact:true})).toBeVisible();
  if(process.env.MCC_ISSUE_106_VISUAL_QA==='1')await page.screenshot({path:testInfo.outputPath('obsolete-row.png')});
  const visual=await Promise.all([activeRow.locator('td').first().evaluate(element=>({background:getComputedStyle(element).backgroundImage,border:getComputedStyle(element).borderBottomColor})),obsoleteRow.locator('td').first().evaluate(element=>({background:getComputedStyle(element).backgroundImage,border:getComputedStyle(element).borderBottomColor,shadow:getComputedStyle(element).boxShadow,transition:getComputedStyle(element.closest('tr')!).transitionDuration}))]);
  expect(visual[1].background).not.toBe(visual[0].background);expect(visual[1].border).not.toBe(visual[0].border);expect(visual[1].shadow).not.toBe('none');expect(visual[1].transition).toBe('0s');

  const search=page.getByLabel('Search inventory');await search.fill('OBSOLETE-106');await expect(obsoleteRow).toBeVisible();await expect(activeRow).toHaveCount(0);await search.fill('');
  await obsoleteRow.getByRole('button',{name:'Edit'}).click();let toggle=page.getByRole('switch',{name:'Obsolete',exact:true});await expect(toggle).toHaveAttribute('aria-checked','true');await expect(toggle).toContainText('Flagged as discontinued');
  if(process.env.MCC_ISSUE_106_VISUAL_QA==='1'){await toggle.scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath('obsolete-toggle.png')});}
  const modal=page.locator('.inventory-modal');const bounds=await Promise.all([modal.boundingBox(),toggle.boundingBox()]);expect(bounds[0]).not.toBeNull();expect(bounds[1]).not.toBeNull();expect(bounds[1]!.x).toBeGreaterThanOrEqual(bounds[0]!.x);expect(bounds[1]!.x+bounds[1]!.width).toBeLessThanOrEqual(bounds[0]!.x+bounds[0]!.width);expect(bounds[1]!.height).toBeLessThanOrEqual(56);
  await toggle.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');await expect(toggle).toBeFocused();expect(await toggle.evaluate(element=>element.matches(':focus-visible'))).toBe(true);expect(await toggle.evaluate(element=>getComputedStyle(element).outlineStyle)).not.toBe('none');expect(await toggle.evaluate(element=>getComputedStyle(element).transitionDuration)).toBe('0s');await page.keyboard.press('Space');toggle=page.getByRole('switch',{name:'Obsolete',exact:true});await expect(toggle).toHaveAttribute('aria-checked','false');
  state.blockNextSave();await page.getByRole('button',{name:'Save Changes'}).click();const saveProgress=page.locator('.inventory-modal [data-action-progress]');await expect(saveProgress).toHaveAttribute('data-action-progress','pending');state.releaseSave();await expect(saveProgress).toHaveAttribute('data-action-progress','success');await expect(modal).toHaveCount(0);await expect(rowFor(page,'OBSOLETE-106')).toHaveAttribute('data-obsolete','false');await expect(rowFor(page,'OBSOLETE-106').getByText('OBSOLETE',{exact:true})).toHaveCount(0);

  await rowFor(page,'ACTIVE-106').getByRole('button',{name:'Edit'}).click();toggle=page.getByRole('switch',{name:'Obsolete',exact:true});await toggle.click();await expect(toggle).toHaveAttribute('aria-checked','true');await page.getByRole('button',{name:'Save Changes'}).click();await expect(modal).toHaveCount(0);await expect(rowFor(page,'ACTIVE-106')).toHaveClass(/inventory-row-obsolete/);await expect(rowFor(page,'ACTIVE-106').getByText('OBSOLETE',{exact:true})).toBeVisible();
  await page.reload();await expect(rowFor(page,'ACTIVE-106')).toHaveAttribute('data-obsolete','true');await expect(rowFor(page,'OBSOLETE-106')).toHaveAttribute('data-obsolete','false');

  await page.locator('.mcc-shell').evaluate(element=>{const shell=element as HTMLElement;shell.style.setProperty('--mcc-surface-dense','#f7f9fb');shell.style.setProperty('--mcc-text-primary','#17212b');shell.style.setProperty('--mcc-text-secondary','#263544');shell.style.setProperty('--mcc-border-subtle','rgba(38,53,68,.22)');});
  const lightTokens=await rowFor(page,'ACTIVE-106').locator('td').first().evaluate(element=>({color:getComputedStyle(element).color,background:getComputedStyle(element).backgroundImage}));expect(lightTokens.color).toBe('rgb(38, 53, 68)');expect(lightTokens.background).toContain('linear-gradient');
  const rowBox=await rowFor(page,'ACTIVE-106').boundingBox();expect(rowBox).not.toBeNull();expect(rowBox!.height).toBeLessThanOrEqual(testInfo.project.name==='mobile-chromium'?100:90);
});
