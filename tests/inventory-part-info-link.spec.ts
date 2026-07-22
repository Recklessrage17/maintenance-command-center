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

test('linked Part Numbers use one safe, polished row-isolated link pill',async({page,context},testInfo)=>{
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
  await expect(linked).toHaveClass(/mcc-link-pill--technical/);
  const icon=linked.locator('.mcc-link-pill-icon');
  await expect(icon).toHaveCount(1);
  await expect(linked.locator('.mcc-link-pill-icon-pod')).toHaveCount(0);
  expect(await icon.evaluate(element=>element.parentElement?.classList.contains('inventory-part-info-link'))).toBe(true);
  await expect(linkedRow).not.toContainText('parts.example.com');

  const style=await linked.evaluate(element=>({
    cursor:getComputedStyle(element).cursor,
    animation:getComputedStyle(element).animationName,
    pointerEvents:getComputedStyle(element,'::before').pointerEvents,
    topHighlightPointerEvents:getComputedStyle(element,'::after').pointerEvents,
    borderRadius:getComputedStyle(element).borderRadius,
    backgroundImage:getComputedStyle(element).backgroundImage,
    borderWidth:getComputedStyle(element).borderWidth,
    fontWeight:Number(getComputedStyle(element).fontWeight),
    fontSize:Number.parseFloat(getComputedStyle(element).fontSize),
    minHeight:element.getBoundingClientRect().height,
  }));
  expect(style.cursor).toBe('pointer');
  expect(style.animation).toBe('none');
  expect(style.pointerEvents).toBe('none');
  expect(style.topHighlightPointerEvents).toBe('none');
  expect(style.borderRadius).not.toBe('999px');
  expect(style.backgroundImage.match(/linear-gradient/g)?.length).toBeGreaterThanOrEqual(2);
  expect(style.borderWidth).toBe('1px');
  expect(style.fontWeight).toBeGreaterThanOrEqual(900);
  expect(style.minHeight).toBeGreaterThanOrEqual(44);
  const iconStyle=await icon.evaluate(element=>({
    backgroundImage:getComputedStyle(element).backgroundImage,
    borderStyle:getComputedStyle(element).borderStyle,
    width:element.getBoundingClientRect().width,
  }));
  expect(iconStyle.backgroundImage).toBe('none');
  expect(iconStyle.borderStyle).toBe('none');
  expect(iconStyle.width).toBeLessThan(style.fontSize);
  const labelDimensions=await linked.locator('.mcc-link-pill-label').evaluate(element=>({clientWidth:element.clientWidth,scrollWidth:element.scrollWidth}));
  expect(labelDimensions.scrollWidth).toBeLessThanOrEqual(labelDimensions.clientWidth);
  const cellCentering=await linked.evaluate(element=>{
    const linkBox=element.getBoundingClientRect();
    const cellBox=element.closest('td')!.getBoundingClientRect();
    return Math.abs((linkBox.left+linkBox.width/2)-(cellBox.left+cellBox.width/2));
  });
  expect(cellCentering).toBeLessThanOrEqual(1);

  if(testInfo.project.name==='mobile-chromium') {
    await openOnce(page,context,linked,()=>linked.tap(),'/35mb');
  } else {
    await openOnce(page,context,linked,()=>linked.click(),'/35mb');
  }
  await expect(linkedRow.getByRole('button',{name:'Select'})).toBeVisible();
  await expect(page.locator('.inventory-modal')).toHaveCount(0);

  await linked.focus();
  await openOnce(page,context,linked,()=>linked.press('Enter'),'/35mb');

  await linked.focus();
  expect(await linked.evaluate(element=>element.matches(':focus-visible'))).toBe(true);
  expect(await linked.evaluate(element=>getComputedStyle(element).outlineStyle)).not.toBe('none');
  await openOnce(page,context,linked,()=>linked.press('Space'),'/35mb');
  await expect(linkedRow.getByRole('button',{name:'Select'})).toBeVisible();
  await expect(page.locator('.inventory-modal')).toHaveCount(0);
});

test('unlinked values stay plain and long linked values truncate without page overflow',async({page,context})=>{
  await mockInventory(page,context);
  await page.goto('/inventory');

  const plain=page.locator('.plain-part-number',{hasText:'PLAIN-22'});
  await expect(plain).toBeVisible();
  await expect(plain).toHaveAttribute('title','PLAIN-22');
  await expect(plain.locator('.mcc-link-pill-icon')).toHaveCount(0);
  await expect(plain.locator('xpath=ancestor::td').getByRole('link')).toHaveCount(0);
  const invalid=page.locator('.plain-part-number',{hasText:'INVALID-URL'});
  await expect(invalid).toBeVisible();
  await expect(invalid.locator('xpath=ancestor::td').getByRole('link')).toHaveCount(0);

  const longLink=page.getByRole('link',{name:`Open part information for ${longPartNumber}`});
  await expect(longLink).toHaveAttribute('title',longPartNumber);
  const dimensions=await longLink.locator('.mcc-link-pill-label').evaluate(element=>({clientWidth:element.clientWidth,scrollWidth:element.scrollWidth}));
  expect(dimensions.scrollWidth).toBeGreaterThan(dimensions.clientWidth);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});
