import {expect,type Page,test} from '@playwright/test';

async function mockHeader(page:Page){
  await page.route('**/api/**',route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/auth/status')return route.fulfill({json:{setupRequired:false,user:{id:1,fullName:'Header Tester',email:'header@example.com',role:'Admin',isOwnerAdmin:true,canViewSystemVersion:false,forcePasswordChange:false}}});
    if(path==='/api/settings/branding')return route.fulfill({json:{ok:true,branding:{companyName:'MCC',companySubtitle:'Maintenance Command Center',companyAccentText:'',logoMode:'text',logoUrl:'',iconAnimation:'none'}}});
    if(path==='/api/inventory/native/summary')return route.fulfill({json:{ok:true,totalParts:1,lowStockCount:1,requisitionCount:0,vendorCount:1,locationCount:1}});
    if(path==='/api/inventory/native/parts')return route.fulfill({json:{ok:true,parts:[{id:'1',itemId:'ITEM-1',partNumber:'HEADER-108',description:'Header regression part',location:'Stores',vendor:'MCC Supply',quantity:1,minQuantity:2,status:'Low Stock',requisition:'',orderPlaced:false,hasActiveRequisitionRecord:false,activeRequisitionNumber:'',isInRequisitionStaging:false,requisitionStagingItemId:null,requisitionStagingStatus:'',partInfoUrl:'',manufacturerBrand:'MCC',unitCost:12.5,supplierPartNumber:'',leadTime:'',importantNote:'',obsolete:false,createdAt:'2026-08-25T12:00:00Z',updatedAt:'2026-08-25T12:00:00Z'}]}});
    if(path==='/api/inventory/native/backups')return route.fulfill({json:{ok:true,backups:[]}});
    if(path==='/api/vendors')return route.fulfill({json:{ok:true,vendors:[]}});
    return route.fulfill({json:{ok:true}});
  });
}

function boxesOverlap(a:{x:number;y:number;width:number;height:number},b:{x:number;y:number;width:number;height:number}){
  return a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
}

test('Issue 108 keeps the illuminated MCC lockup and Inventory title geometry stable',async({page},testInfo)=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  await mockHeader(page);
  await page.goto('/inventory');

  const brand=page.locator('[data-mcc-header-brand]');
  const wordmark=brand.locator('.mcc-brand-name');
  const subtitle=brand.locator('.mcc-brand-subtitle');
  const menu=page.getByRole('button',{name:'Open command menu'});
  const topbar=page.locator('.mcc-page-topbar');
  const title=topbar.getByRole('heading',{name:'Inventory'});
  const live=topbar.locator('[data-inventory-live-state]');

  await expect(brand).toBeVisible();
  await expect(brand).toHaveAttribute('aria-label','MCC Maintenance Command Center');
  await expect(wordmark).toHaveText('MCC');
  await expect(subtitle).toHaveText('Maintenance Command Center');
  await expect(subtitle).toBeVisible();
  await expect(menu).toBeVisible();
  await expect(title).toBeVisible();
  await expect(live).toHaveAttribute('data-inventory-live-state','live');

  const visuals=await brand.evaluate(element=>{
    const surface=getComputedStyle(element);
    const mark=getComputedStyle(element.querySelector('.mcc-brand-name')!);
    return{backgroundImage:surface.backgroundImage,borderColor:surface.borderColor,boxShadow:surface.boxShadow,color:mark.color,textShadow:mark.textShadow,animationName:mark.animationName};
  });
  expect(visuals.backgroundImage).not.toBe('none');
  expect(visuals.borderColor).not.toBe('rgba(0, 0, 0, 0)');
  expect(visuals.boxShadow).toContain('68, 215, 255');
  expect(visuals.textShadow).toContain('68, 215, 255');
  expect(visuals.animationName).toBe('none');

  const [brandBox,menuBox,topbarBox,titleBox,liveBox]=await Promise.all([brand.boundingBox(),menu.boundingBox(),topbar.boundingBox(),title.boundingBox(),live.boundingBox()]);
  for(const box of [brandBox,menuBox,topbarBox,titleBox,liveBox])expect(box).not.toBeNull();
  expect(boxesOverlap(brandBox!,menuBox!)).toBe(false);
  expect(boxesOverlap(topbarBox!,menuBox!)).toBe(false);
  expect(boxesOverlap(titleBox!,liveBox!)).toBe(false);
  expect(menuBox!.height).toBeGreaterThanOrEqual(44);
  expect(titleBox!.width).toBeGreaterThan(40);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

  await menu.click();
  await expect(page.getByRole('button',{name:'Close command menu'})).toBeVisible();
  await expect(page.getByRole('navigation',{name:'Maintenance Command Center'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.keyboard.press('Escape');
  await expect(menu).toBeFocused();
  await expect(title).toBeVisible();
  await expect(live).toBeVisible();
  expect(await brand.boundingBox()).toEqual(brandBox);
  expect(await topbar.boundingBox()).toEqual(topbarBox);

  if(process.env.MCC_ISSUE_108_VISUAL_QA==='1')await page.screenshot({path:testInfo.outputPath(`${testInfo.project.name}-header.png`)});
});

test('Issue 108 preserves the MCC mark when the narrowest mobile layout collapses its subtitle',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='mobile-chromium','Constrained mobile behavior is covered on the touch project.');
  await mockHeader(page);
  await page.setViewportSize({width:340,height:760});
  await page.goto('/inventory');

  const brand=page.locator('[data-mcc-header-brand]');
  const wordmark=brand.locator('.mcc-brand-name');
  const subtitle=brand.locator('.mcc-brand-subtitle');
  const menu=page.getByRole('button',{name:'Open command menu'});
  const title=page.locator('.mcc-page-topbar').getByRole('heading',{name:'Inventory'});

  await expect(brand).toBeVisible();
  await expect(wordmark).toBeVisible();
  await expect(wordmark).toHaveText('MCC');
  await expect(subtitle).toBeHidden();
  await expect(menu).toBeVisible();
  await expect(title).toBeVisible();
  expect((await menu.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});
