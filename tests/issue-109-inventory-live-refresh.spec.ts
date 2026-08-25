import { expect, type Page, test } from '@playwright/test';

type InventoryPart = ReturnType<typeof inventoryPart>;

function inventoryPart(index:number) {
  return {
    id:String(index),itemId:`ITEM-${index}`,partNumber:`PUMP-${String(index).padStart(3,'0')}`,
    description:`Pump component ${index}`,location:index%2?'Stores A':'Stores B',vendor:'MCC Supply',
    quantity:1,minQuantity:2,status:'Low Stock',requisition:'',orderPlaced:false,
    hasActiveRequisitionRecord:false,activeRequisitionNumber:'',isInRequisitionStaging:false,
    requisitionStagingItemId:null,requisitionStagingStatus:'',partInfoUrl:'',manufacturerBrand:'MCC',
    unitCost:12.5,supplierPartNumber:'',leadTime:'',importantNote:'',obsolete:index===3,
    createdAt:'2026-08-25T12:00:00Z',updatedAt:'2026-08-25T12:00:00Z',
  };
}

async function accelerateInventoryInterval(page:Page,replacementMs:number) {
  await page.addInitScript(({replacementMs})=>{
    const intervalWindow=window as typeof window & {__inventoryIntervalDelays:number[]};
    const nativeSetInterval=window.setInterval.bind(window);
    intervalWindow.__inventoryIntervalDelays=[];
    window.setInterval=((handler:TimerHandler,timeout?:number,...args:unknown[])=>{
      const requestedDelay=Number(timeout??0);
      intervalWindow.__inventoryIntervalDelays.push(requestedDelay);
      const effectiveDelay=requestedDelay===10_000?replacementMs:requestedDelay;
      return nativeSetInterval(handler,effectiveDelay,...args);
    }) as typeof window.setInterval;
  },{replacementMs});
}

async function mockInventory(page:Page,options:{
  parts?:InventoryPart[];
  onSummary?:(requestNumber:number)=>Promise<void>|void;
  onParts?:(requestNumber:number)=>Promise<void>|void;
}={}) {
  const parts=options.parts??Array.from({length:120},(_,index)=>inventoryPart(index+1));
  let summaryRequests=0;
  let partsRequests=0;
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/auth/status') return route.fulfill({json:{setupRequired:false,user:{id:1,fullName:'Inventory Tester',email:'inventory@example.com',role:'Admin',isOwnerAdmin:true,canViewSystemVersion:false,forcePasswordChange:false}}});
    if(path==='/api/inventory/native/summary') {
      summaryRequests+=1;
      try {
        await options.onSummary?.(summaryRequests);
      } catch(error) {
        return route.fulfill({status:503,json:{error:(error as Error).message}});
      }
      return route.fulfill({json:{ok:true,totalParts:parts.length,lowStockCount:parts.length,requisitionCount:0,vendorCount:1,locationCount:2}});
    }
    if(path==='/api/inventory/native/parts') {
      partsRequests+=1;
      try {
        await options.onParts?.(partsRequests);
      } catch(error) {
        return route.fulfill({status:503,json:{error:(error as Error).message}});
      }
      return route.fulfill({json:{ok:true,parts}});
    }
    if(path==='/api/inventory/native/backups') return route.fulfill({json:{ok:true,backups:[]}});
    if(path==='/api/vendors') return route.fulfill({json:{ok:true,vendors:[]}});
    return route.fulfill({json:{ok:true}});
  });
  return {summaryRequests:()=>summaryRequests,partsRequests:()=>partsRequests};
}

test('uses a 10-second cycle and exposes refreshing, updated, live, and stale states accessibly',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','State timing is covered once on desktop.');
  await accelerateInventoryInterval(page,2_500);
  let failNextRefresh=false;
  let releaseFailure:()=>void=()=>{};
  let markFailureStarted:()=>void=()=>{};
  const failureStarted=new Promise<void>(resolve=>{markFailureStarted=resolve;});
  const failureGate=new Promise<void>(resolve=>{releaseFailure=resolve;});
  await mockInventory(page,{
    parts:[inventoryPart(1)],
    onSummary:async requestNumber=>{
      if(requestNumber===1) await new Promise(resolve=>setTimeout(resolve,220));
      if(requestNumber>1&&failNextRefresh) {
        markFailureStarted();
        await failureGate;
        throw new Error('Inventory connection unavailable');
      }
    },
  });

  await page.goto('/inventory');
  const indicator=page.locator('[data-inventory-live-state]');
  await expect(indicator).toHaveAttribute('data-inventory-live-state','refreshing');
  await expect(indicator).toHaveAttribute('aria-label','Refreshing Inventory');
  await expect(indicator.locator('.inventory-live-indicator__visual')).not.toHaveCSS('border-top-color','rgb(84, 223, 162)');

  await expect(indicator).toHaveAttribute('data-inventory-live-state','updated');
  await expect(indicator).toHaveAttribute('aria-label',/Inventory updated at/);
  await expect(indicator).toHaveAttribute('data-inventory-live-state','live');
  await expect(indicator).toHaveAttribute('aria-label',/Inventory live\. Last updated at/);
  expect(await page.evaluate(()=>(window as typeof window&{__inventoryIntervalDelays:number[]}).__inventoryIntervalDelays)).toContain(10_000);

  failNextRefresh=true;
  await failureStarted;
  await expect(indicator).toHaveAttribute('data-inventory-live-state','refreshing');
  releaseFailure();
  await expect(indicator).toHaveAttribute('data-inventory-live-state','stale');
  await expect(indicator).toHaveAttribute('aria-label',/Inventory stale\. Inventory connection unavailable/);
  await expect(indicator).not.toHaveClass(/inventory-live-indicator--live/);
  await expect(page.getByText(/MCC Inventory refreshed at/i)).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Refresh Inventory'})).toHaveCount(0);
});

test('serializes refreshes, preserves Inventory context and active edits, and stops after navigation',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','Refresh concurrency is covered once on desktop.');
  await accelerateInventoryInterval(page,1_500);
  let releaseSlowRefresh:()=>void=()=>{};
  let markSlowRefreshStarted:()=>void=()=>{};
  const slowRefreshStarted=new Promise<void>(resolve=>{markSlowRefreshStarted=resolve;});
  const slowRefreshGate=new Promise<void>(resolve=>{releaseSlowRefresh=resolve;});
  const requests=await mockInventory(page,{
    onSummary:async requestNumber=>{
      if(requestNumber===2) {
        markSlowRefreshStarted();
        await slowRefreshGate;
      }
    },
  });

  await page.goto('/inventory');
  await expect(page.locator('[data-inventory-live-state]')).toHaveAttribute('data-inventory-live-state','live');
  await page.getByPlaceholder('Part number, description, location, vendor...').fill('PUMP');
  const desktopControls=page.locator('.inventory-focus-actions');
  await desktopControls.getByLabel('Inventory filter').selectOption('low');
  await desktopControls.locator('.rows-select-field select').selectOption('50');
  await desktopControls.getByRole('button',{name:'Next'}).click();
  await expect(desktopControls.locator('.page-count')).toHaveText('Page 2 of 3');
  const targetRow=page.locator('.inventory-table-wrap tbody tr').first();
  await targetRow.getByRole('button',{name:'Select'}).click();
  await targetRow.getByRole('button',{name:'Edit'}).click();
  const description=page.locator('.inventory-modal input').nth(1);
  await description.fill('Unsaved operator edit');

  await slowRefreshStarted;
  await page.waitForTimeout(3_200);
  expect(requests.summaryRequests()).toBe(2);
  expect(requests.partsRequests()).toBe(1);
  await expect(page.locator('[data-inventory-live-state]')).toHaveAttribute('data-inventory-live-state','refreshing');
  releaseSlowRefresh();
  await expect(page.locator('[data-inventory-live-state]')).toHaveAttribute('data-inventory-live-state','updated');

  await expect(description).toHaveValue('Unsaved operator edit');
  await expect(page.locator('.inventory-modal')).toBeVisible();
  await expect(page.getByPlaceholder('Part number, description, location, vendor...')).toHaveValue('PUMP');
  await expect(desktopControls.getByLabel('Inventory filter')).toHaveValue('low');
  await expect(desktopControls.locator('.rows-select-field select')).toHaveValue('50');
  await expect(desktopControls.locator('.page-count')).toHaveText('Page 2 of 3');
  await expect(page.locator('.inventory-focus-meta')).toContainText('Selected: 1');

  await page.locator('.inventory-modal').getByRole('button',{name:'Close'}).click();
  await page.getByRole('button',{name:'Back to Command Center'}).click();
  await expect(page.getByRole('heading',{name:'Dashboard'})).toBeVisible();
  const requestsAfterNavigation=requests.summaryRequests();
  await page.waitForTimeout(1_800);
  expect(requests.summaryRequests()).toBe(requestsAfterNavigation);
  expect(requests.partsRequests()).toBe(requestsAfterNavigation);
});

test('keeps the title indicator and compact search layout stable on desktop and mobile',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  await mockInventory(page,{parts:Array.from({length:4},(_,index)=>inventoryPart(index+1))});
  await page.goto('/inventory');
  const indicator=page.locator('[data-inventory-live-state]');
  await expect(indicator).toHaveAttribute('data-inventory-live-state','live');
  expect(await indicator.evaluate(element=>element.previousElementSibling?.tagName)).toBe('H1');
  const indicatorBox=await indicator.boundingBox();
  expect(indicatorBox?.width).toBe(22);
  expect(indicatorBox?.height).toBe(22);
  const motion=await indicator.locator('.inventory-live-indicator__visual').evaluate(element=>({
    visual:getComputedStyle(element).animationName,
    pulse:getComputedStyle(element,'::after').animationName,
  }));
  expect(motion).toEqual({visual:'none',pulse:'none'});

  const search=page.locator('.inventory-search');
  const searchInput=search.locator('input');
  const searchBox=await search.boundingBox();
  const inputBox=await searchInput.boundingBox();
  expect(searchBox?.height).toBeLessThanOrEqual(page.viewportSize()!.width<=700?82:44);
  expect(inputBox?.height).toBeGreaterThanOrEqual(page.viewportSize()!.width<=700?42:38);
  await expect(page.getByRole('button',{name:'Refresh Inventory'})).toHaveCount(0);
  await expect(page.getByText(/MCC Inventory refreshed at/i)).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

  if(page.viewportSize()!.width<=700) {
    await page.locator('.mobile-inventory-controls summary').click();
    const selectionButton=page.locator('.mobile-selection-actions').getByRole('button',{name:'Select Current Page'});
    await expect(selectionButton).toBeVisible();
    expect((await selectionButton.boundingBox())!.height).toBeGreaterThanOrEqual(34);
  } else {
    await expect(page.locator('.inventory-search-tools').getByRole('button',{name:'Select Current Page'})).toBeVisible();
  }
});
