import {expect,type Locator,type Page,test} from '@playwright/test';

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

async function inspectRow(row:Locator){
  return row.evaluate(element=>{
    const cells=Array.from(element.querySelectorAll('td'));
    const rowStyle=getComputedStyle(element);
    const cellStyle=(cell:Element)=>{const style=getComputedStyle(cell);return{backgroundColor:style.backgroundColor,backgroundImage:style.backgroundImage,boxShadow:style.boxShadow,borderBottomColor:style.borderBottomColor,borderTopLeftRadius:style.borderTopLeftRadius,borderTopRightRadius:style.borderTopRightRadius};};
    return{height:element.getBoundingClientRect().height,rowSurface:`${rowStyle.backgroundImage} ${rowStyle.backgroundColor}`,rowShadow:rowStyle.boxShadow,transitionDuration:rowStyle.transitionDuration,cells:cells.map(cellStyle)};
  });
}

function expectTransparentCells(visual:Awaited<ReturnType<typeof inspectRow>>){
  for(const cell of visual.cells){expect(cell.backgroundImage).toBe('none');expect(cell.backgroundColor).toBe('rgba(0, 0, 0, 0)');}
}

test('Issue 106 marks and clears obsolete inventory with persistent compact visual state',async({page},testInfo)=>{
  await page.emulateMedia({reducedMotion:'reduce'});const state=await mockInventory(page);await page.goto('/inventory');
  const activeRow=rowFor(page,'ACTIVE-106');const obsoleteRow=rowFor(page,'OBSOLETE-106');
  await expect(activeRow).toHaveAttribute('data-obsolete','false');await expect(activeRow).not.toHaveClass(/inventory-row-obsolete/);await expect(activeRow.getByText('OBSOLETE',{exact:true})).toHaveCount(0);
  await expect(obsoleteRow).toHaveAttribute('data-obsolete','true');await expect(obsoleteRow).toHaveClass(/inventory-row-obsolete/);await expect(obsoleteRow.getByText('OBSOLETE',{exact:true})).toBeVisible();
  const activeRest=await inspectRow(activeRow);const obsoleteRest=await inspectRow(obsoleteRow);
  expect(obsoleteRest.rowSurface).toContain('255, 117, 138');expect(obsoleteRest.rowSurface).not.toContain('68, 215, 255');expectTransparentCells(obsoleteRest);expect(obsoleteRest.cells[0].boxShadow).toContain('255, 117, 138');expect(obsoleteRest.transitionDuration).toBe('0s');
  if(process.env.MCC_ISSUE_106_VISUAL_QA==='1')await page.screenshot({path:testInfo.outputPath('normal-row-rest.png')});
  await activeRow.locator('td').first().hover();const activeHover=await inspectRow(activeRow);
  expect(activeHover.rowSurface).toContain('68, 215, 255');expect(activeHover.rowSurface).not.toContain('255, 117, 138');expect(activeHover.rowShadow).toContain('68, 215, 255');expectTransparentCells(activeHover);expect(activeHover.cells[0].boxShadow).toContain('68, 215, 255');expect(activeHover.cells.at(-1)!.boxShadow).toContain('68, 215, 255');expect(activeHover.cells[0].borderTopLeftRadius).not.toBe('0px');expect(activeHover.cells.at(-1)!.borderTopRightRadius).not.toBe('0px');expect(activeHover.height).toBeCloseTo(activeRest.height,3);expect(activeHover.transitionDuration).toBe('0s');
  if(process.env.MCC_ISSUE_106_VISUAL_QA==='1')await page.screenshot({path:testInfo.outputPath('normal-row-hover.png')});
  await page.mouse.move(0,0);if(process.env.MCC_ISSUE_106_VISUAL_QA==='1')await page.screenshot({path:testInfo.outputPath('obsolete-row-rest.png')});
  await obsoleteRow.locator('td').first().hover();const obsoleteHover=await inspectRow(obsoleteRow);
  expect(obsoleteHover.rowSurface).toContain('255, 117, 138');expect(obsoleteHover.rowSurface).not.toContain('68, 215, 255');expect(obsoleteHover.rowShadow).toContain('255, 117, 138');expect(obsoleteHover.rowSurface).not.toBe(activeHover.rowSurface);expectTransparentCells(obsoleteHover);expect(obsoleteHover.cells[0].boxShadow).toContain('255, 117, 138');expect(obsoleteHover.cells.at(-1)!.boxShadow).toContain('255, 117, 138');expect(obsoleteHover.cells[0].borderTopLeftRadius).not.toBe('0px');expect(obsoleteHover.cells.at(-1)!.borderTopRightRadius).not.toBe('0px');expect(obsoleteHover.height).toBeCloseTo(obsoleteRest.height,3);expect(obsoleteHover.transitionDuration).toBe('0s');await expect(obsoleteRow.getByText('OBSOLETE',{exact:true})).toBeVisible();
  if(process.env.MCC_ISSUE_106_VISUAL_QA==='1')await page.screenshot({path:testInfo.outputPath('obsolete-row-hover.png')});
  await page.mouse.move(0,0);await obsoleteRow.getByRole('button',{name:'Edit'}).focus();const obsoleteFocus=await inspectRow(obsoleteRow);expect(obsoleteFocus.rowSurface).toContain('255, 117, 138');expect(obsoleteFocus.rowSurface).not.toContain('68, 215, 255');expectTransparentCells(obsoleteFocus);
  await activeRow.getByRole('button',{name:'Edit'}).focus();const activeFocus=await inspectRow(activeRow);expect(activeFocus.rowSurface).toContain('68, 215, 255');expect(activeFocus.rowSurface).not.toContain('255, 117, 138');expectTransparentCells(activeFocus);await page.getByLabel('Search inventory').focus();await page.locator('.inventory-table-wrap').evaluate(element=>{element.scrollLeft=0;});

  const search=page.getByLabel('Search inventory');await search.fill('OBSOLETE-106');await expect(obsoleteRow).toBeVisible();await expect(activeRow).toHaveCount(0);await search.fill('');
  await obsoleteRow.getByRole('button',{name:'Edit'}).click();let toggle=page.getByRole('switch',{name:'Obsolete',exact:true});await expect(toggle).toHaveAttribute('aria-checked','true');await expect(toggle).toContainText('Flagged as discontinued');
  if(process.env.MCC_ISSUE_106_VISUAL_QA==='1'){await toggle.scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath('obsolete-toggle.png')});}
  const modal=page.locator('.inventory-modal');const bounds=await Promise.all([modal.boundingBox(),toggle.boundingBox()]);expect(bounds[0]).not.toBeNull();expect(bounds[1]).not.toBeNull();expect(bounds[1]!.x).toBeGreaterThanOrEqual(bounds[0]!.x);expect(bounds[1]!.x+bounds[1]!.width).toBeLessThanOrEqual(bounds[0]!.x+bounds[0]!.width);expect(bounds[1]!.height).toBeLessThanOrEqual(56);
  await toggle.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');await expect(toggle).toBeFocused();expect(await toggle.evaluate(element=>element.matches(':focus-visible'))).toBe(true);expect(await toggle.evaluate(element=>getComputedStyle(element).outlineStyle)).not.toBe('none');expect(await toggle.evaluate(element=>getComputedStyle(element).transitionDuration)).toBe('0s');await page.keyboard.press('Space');toggle=page.getByRole('switch',{name:'Obsolete',exact:true});await expect(toggle).toHaveAttribute('aria-checked','false');
  state.blockNextSave();await page.getByRole('button',{name:'Save Changes'}).click();const saveProgress=page.locator('.inventory-modal [data-action-progress]');await expect(saveProgress).toHaveAttribute('data-action-progress','pending');state.releaseSave();await expect(saveProgress).toHaveAttribute('data-action-progress','success');await expect(modal).toHaveCount(0);await expect(rowFor(page,'OBSOLETE-106')).toHaveAttribute('data-obsolete','false');await expect(rowFor(page,'OBSOLETE-106').getByText('OBSOLETE',{exact:true})).toHaveCount(0);

  await rowFor(page,'ACTIVE-106').getByRole('button',{name:'Edit'}).click();toggle=page.getByRole('switch',{name:'Obsolete',exact:true});await toggle.click();await expect(toggle).toHaveAttribute('aria-checked','true');await page.getByRole('button',{name:'Save Changes'}).click();await expect(modal).toHaveCount(0);await expect(rowFor(page,'ACTIVE-106')).toHaveClass(/inventory-row-obsolete/);await expect(rowFor(page,'ACTIVE-106').getByText('OBSOLETE',{exact:true})).toBeVisible();
  await page.reload();await expect(rowFor(page,'ACTIVE-106')).toHaveAttribute('data-obsolete','true');await expect(rowFor(page,'OBSOLETE-106')).toHaveAttribute('data-obsolete','false');

  await page.locator('.mcc-shell').evaluate(element=>{const shell=element as HTMLElement;shell.style.setProperty('--mcc-surface-dense','#f7f9fb');shell.style.setProperty('--mcc-text-primary','#17212b');shell.style.setProperty('--mcc-text-secondary','#263544');shell.style.setProperty('--mcc-border-subtle','rgba(38,53,68,.22)');});
  const lightTokens=await rowFor(page,'ACTIVE-106').evaluate(element=>({color:getComputedStyle(element.querySelector('td')!).color,background:getComputedStyle(element).backgroundImage}));expect(lightTokens.color).toBe('rgb(38, 53, 68)');expect(lightTokens.background).toContain('linear-gradient');expect(lightTokens.background).toContain('255, 117, 138');
  const rowBox=await rowFor(page,'ACTIVE-106').boundingBox();expect(rowBox).not.toBeNull();expect(rowBox!.height).toBeLessThanOrEqual(testInfo.project.name==='mobile-chromium'?100:90);
});
