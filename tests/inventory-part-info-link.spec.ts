import { expect, type BrowserContext, type Locator, type Page, test } from '@playwright/test';

const longPartNumber = 'MCC-EXTREMELY-LONG-PART-NUMBER-1234567890-ALPHA';

function part(id:string,partNumber:string,partInfoUrl:string) {
  return {
    id,itemId:`ITEM-${id}`,partNumber,description:`Test part ${partNumber}`,location:'Stores',vendor:'Test Vendor',
    quantity:4,minQuantity:2,status:'In Stock',requisition:'',orderPlaced:false,hasActiveRequisitionRecord:false,
    isInRequisitionStaging:false,requisitionStagingItemId:null,requisitionStagingStatus:'',partInfoUrl,
    manufacturerBrand:'MCC',unitCost:12.5,supplierPartNumber:'',leadTime:'',importantNote:'',
    createdAt:'2026-07-17T12:00:00Z',updatedAt:'2026-07-17T12:00:00Z',
  };
}

const parts = [
  part('1','35MB','parts.example.com/35mb'),
  part('2','PLAIN-22',''),
  part('3',longPartNumber,'https://parts.example.com/long'),
  part('4','INVALID-URL','javascript:alert(1)'),
];

async function mockInventory(page:Page,context:BrowserContext) {
  await context.route('https://parts.example.com/**',route=>route.fulfill({contentType:'text/html',body:'<title>Part information</title>'}));
  await page.route('**/api/**',route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/auth/status') return route.fulfill({json:{setupRequired:false,user:{id:1,fullName:'Inventory Tester',email:'inventory@example.com',role:'Admin',isOwnerAdmin:true,forcePasswordChange:false}}});
    if(path==='/api/inventory/native/summary') return route.fulfill({json:{ok:true,totalParts:parts.length,lowStockCount:0,requisitionCount:0,vendorCount:1,locationCount:1}});
    if(path==='/api/inventory/native/parts') return route.fulfill({json:{ok:true,parts}});
    if(path==='/api/inventory/native/backups') return route.fulfill({json:{ok:true,backups:[]}});
    if(path==='/api/vendors') return route.fulfill({json:{ok:true,vendors:[]}});
    return route.fulfill({json:{ok:true}});
  });
}

async function openOnce(page:Page,context:BrowserContext,link:Locator,activate:()=>Promise<void>,expectedPath:string) {
  const popupPromise=page.waitForEvent('popup');
  await activate();
  const popup=await popupPromise;
  await popup.waitForLoadState('domcontentloaded');
  expect(new URL(popup.url()).pathname).toBe(expectedPath);
  expect(context.pages()).toHaveLength(2);
  await popup.close();
  await expect.poll(()=>context.pages().length).toBe(1);
  await expect(link).toBeVisible();
}

test('linked Part Numbers use one safe compact row-isolated text link',async({page,context},testInfo)=>{
  await mockInventory(page,context);
  await page.goto('/inventory');

  const linked=page.getByRole('link',{name:'Open part information for 35MB'});
  const linkedRow=linked.locator('xpath=ancestor::tr');
  await expect(linked).toBeVisible();
  await expect(linked).toHaveText('35MB');
  await expect(linked).toHaveAttribute('href','https://parts.example.com/35mb');
  await expect(linked).toHaveAttribute('target','_blank');
  await expect(linked).toHaveAttribute('rel','noopener noreferrer');
  await expect(linked).toHaveAttribute('title','35MB');
  expect(await linked.evaluate(element=>element.tagName)).toBe('A');
  await expect(linked).toHaveClass(/mcc-text-link/);
  await expect(linked).not.toHaveClass(/mcc-link-pill/);
  await expect(linked.locator('svg')).toHaveCount(0);
  await expect(linkedRow).not.toContainText('parts.example.com');

  const style=await linked.evaluate(element=>({
    cursor:getComputedStyle(element).cursor,
    animation:getComputedStyle(element).animationName,
    underlineOpacity:Number(getComputedStyle(element,'::after').opacity),
    underlinePointerEvents:getComputedStyle(element,'::after').pointerEvents,
    backgroundImage:getComputedStyle(element).backgroundImage,
    borderWidth:getComputedStyle(element).borderWidth,
    fontWeight:Number(getComputedStyle(element).fontWeight),
    boxShadow:getComputedStyle(element).boxShadow,
    height:element.getBoundingClientRect().height,
  }));
  expect(style.cursor).toBe('pointer');
  expect(style.animation).toBe('none');
  expect(style.underlineOpacity).toBe(0);
  expect(style.underlinePointerEvents).toBe('none');
  expect(style.backgroundImage).toBe('none');
  expect(style.borderWidth).toBe('0px');
  expect(style.boxShadow).toBe('none');
  expect(style.fontWeight).toBeGreaterThanOrEqual(700);
  expect(style.height).toBeLessThanOrEqual(30);
  const labelStyle=await linked.locator('.mcc-text-link__label').evaluate(element=>({
    backgroundImage:getComputedStyle(element).backgroundImage,
    textOverflow:getComputedStyle(element).textOverflow,
    textShadow:getComputedStyle(element).textShadow,
    clientWidth:element.clientWidth,
    scrollWidth:element.scrollWidth,
  }));
  expect(labelStyle.backgroundImage).toContain('linear-gradient');
  expect(labelStyle.textOverflow).toBe('ellipsis');
  expect(labelStyle.textShadow).not.toBe('none');
  const labelDimensions=labelStyle;
  expect(labelDimensions.scrollWidth).toBeLessThanOrEqual(labelDimensions.clientWidth);
  const compactLayout=await linked.evaluate(element=>{
    const linkBox=element.getBoundingClientRect();
    const cellBox=element.closest('td')!.getBoundingClientRect();
    const rowBox=element.closest('tr')!.getBoundingClientRect();
    return {leftInset:linkBox.left-cellBox.left,rowHeight:rowBox.height,linkRight:linkBox.right,cellRight:cellBox.right};
  });
  const plainRowHeight=await page.locator('.plain-part-number',{hasText:'PLAIN-22'}).evaluate(element=>element.closest('tr')!.getBoundingClientRect().height);
  expect(compactLayout.leftInset).toBeLessThanOrEqual(12);
  expect(compactLayout.rowHeight).toBeLessThanOrEqual(plainRowHeight+1);
  expect(compactLayout.linkRight).toBeLessThanOrEqual(compactLayout.cellRight);

  await page.evaluate(()=>{
    const state=window as typeof window & {__inventoryParentClicks?:number};
    state.__inventoryParentClicks=0;
    document.addEventListener('click',()=>{state.__inventoryParentClicks=(state.__inventoryParentClicks??0)+1;});
  });

  if(testInfo.project.name==='mobile-chromium') {
    await openOnce(page,context,linked,()=>linked.tap(),'/35mb');
  } else {
    await openOnce(page,context,linked,()=>linked.click(),'/35mb');
  }
  expect(await page.evaluate(()=>(window as typeof window & {__inventoryParentClicks?:number}).__inventoryParentClicks)).toBe(0);
  await expect(linkedRow.getByRole('button',{name:'Select'})).toBeVisible();
  await expect(page.locator('.inventory-modal')).toHaveCount(0);

  await linked.focus();
  await openOnce(page,context,linked,()=>linked.press('Enter'),'/35mb');
  expect(await page.evaluate(()=>(window as typeof window & {__inventoryParentClicks?:number}).__inventoryParentClicks)).toBe(0);

  await linked.focus();
  expect(await linked.evaluate(element=>element.matches(':focus-visible'))).toBe(true);
  expect(await linked.evaluate(element=>getComputedStyle(element).outlineStyle)).not.toBe('none');
  expect(Number(await linked.evaluate(element=>getComputedStyle(element,'::after').opacity))).toBeGreaterThan(0);
  await openOnce(page,context,linked,()=>linked.press('Space'),'/35mb');
  expect(await page.evaluate(()=>(window as typeof window & {__inventoryParentClicks?:number}).__inventoryParentClicks)).toBe(0);
  await expect(linkedRow.getByRole('button',{name:'Select'})).toBeVisible();
  await expect(page.locator('.inventory-modal')).toHaveCount(0);
});

test('unlinked values stay plain and long linked values truncate without page overflow',async({page,context})=>{
  await mockInventory(page,context);
  await page.goto('/inventory');

  const plain=page.locator('.plain-part-number',{hasText:'PLAIN-22'});
  await expect(plain).toBeVisible();
  await expect(plain).toHaveAttribute('title','PLAIN-22');
  await expect(plain).not.toHaveClass(/mcc-text-link/);
  await expect(plain.locator('xpath=ancestor::td').getByRole('link')).toHaveCount(0);
  const plainStyle=await plain.evaluate(element=>({cursor:getComputedStyle(element).cursor,textDecoration:getComputedStyle(element).textDecorationLine,textShadow:getComputedStyle(element).textShadow}));
  expect(plainStyle.cursor).not.toBe('pointer');
  expect(plainStyle.textDecoration).toBe('none');
  expect(plainStyle.textShadow).toBe('none');
  const invalid=page.locator('.plain-part-number',{hasText:'INVALID-URL'});
  await expect(invalid).toBeVisible();
  await expect(invalid.locator('xpath=ancestor::td').getByRole('link')).toHaveCount(0);

  const longLink=page.getByRole('link',{name:`Open part information for ${longPartNumber}`});
  await expect(longLink).toHaveAttribute('title',longPartNumber);
  const dimensions=await longLink.locator('.mcc-text-link__label').evaluate(element=>({clientWidth:element.clientWidth,scrollWidth:element.scrollWidth}));
  expect(dimensions.scrollWidth).toBeGreaterThan(dimensions.clientWidth);
  const longLayout=await longLink.evaluate(element=>{const link=element.getBoundingClientRect();const cell=element.closest('td')!.getBoundingClientRect();const row=element.closest('tr')!.getBoundingClientRect();return {linkRight:link.right,cellRight:cell.right,rowHeight:row.height};});
  const plainRowHeight=await plain.evaluate(element=>element.closest('tr')!.getBoundingClientRect().height);
  expect(longLayout.linkRight).toBeLessThanOrEqual(longLayout.cellRight);
  expect(longLayout.rowHeight).toBeLessThanOrEqual(plainRowHeight+1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});
