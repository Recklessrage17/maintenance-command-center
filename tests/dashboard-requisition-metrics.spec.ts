import { expect, type Locator, type Page, test } from '@playwright/test';

type Summary={requestedCount:number;orderedCount:number;receivedCount:number;canceledCount:number;activeCount:number};
const requisitions=[
  {id:1,requisitionNumber:'REQ-001',inventoryPartId:1,partNumber:'P-100',description:'Requested part',vendorName:'Vendor A',locationName:'Stores',quantityRequested:2,totalQuantity:2,status:'Requested',requestedByName:'Dashboard Tester',requestedAt:'2026-07-17T12:00:00Z',workOrderNumber:'WO-1',notes:'',cancelReason:'',deleted:false,deletedAt:null},
  {id:2,requisitionNumber:'REQ-002',inventoryPartId:2,partNumber:'P-200',description:'Ordered part',vendorName:'Vendor B',locationName:'Stores',quantityRequested:1,totalQuantity:1,status:'Ordered',requestedByName:'Dashboard Tester',requestedAt:'2026-07-17T13:00:00Z',workOrderNumber:'WO-2',notes:'',cancelReason:'',deleted:false,deletedAt:null},
];

async function mockApp(page:Page) {
  let summary:Summary={requestedCount:3,orderedCount:2,receivedCount:7,canceledCount:1,activeCount:5};
  const listStatuses:Array<string|null>=[];
  await page.addInitScript(()=>{
    const original=window.history.pushState.bind(window.history);
    (window as unknown as {__pushStateCalls:number}).__pushStateCalls=0;
    window.history.pushState=(...args)=>{(window as unknown as {__pushStateCalls:number}).__pushStateCalls+=1;return original(...args);};
  });
  await page.route('**/api/auth/status',route=>route.fulfill({json:{setupRequired:false,user:{id:1,fullName:'Dashboard Tester',email:'dashboard@example.com',role:'Admin',isOwnerAdmin:true,forcePasswordChange:false}}}));
  await page.route('**/api/requisitions/summary',route=>route.fulfill({json:{ok:true,...summary}}));
  await page.route(/\/api\/requisitions(?:\?.*)?$/,route=>{
    const status=new URL(route.request().url()).searchParams.get('status');
    listStatuses.push(status);
    const rows=status&&status!=='all'?requisitions.filter(item=>item.status===status):requisitions;
    return route.fulfill({json:{ok:true,requisitions:rows,summary}});
  });
  await page.route('**/api/inventory/native/parts',route=>route.fulfill({json:{ok:true,parts:[]}}));
  await page.route('**/api/dashboard/preventive-maintenance-due',route=>route.fulfill({json:{ok:true,alerts:[],summary:{dueSoon:0,dueNow:0,pastDue:0}}}));
  return {setSummary:(next:Summary)=>{summary=next;},listStatuses};
}

async function activate(locator:Locator,mobile:boolean){if(mobile)await locator.tap();else await locator.click();}
async function pushStateCalls(page:Page){return page.evaluate(()=>(window as unknown as {__pushStateCalls:number}).__pushStateCalls);}
async function focusWithKeyboard(page:Page,locator:Locator){
  await page.evaluate(()=>{if(document.activeElement instanceof HTMLElement)document.activeElement.blur();});
  for(let index=0;index<12;index+=1){await page.keyboard.press('Tab');if(await locator.evaluate(element=>element===document.activeElement))return;}
  throw new Error('Metric pill was not reachable by keyboard Tab navigation.');
}

test('metric pills show live counts and navigate once to the correct existing requisition views',async({page},testInfo)=>{
  const mobile=testInfo.project.name==='mobile-chromium';
  const fixture=await mockApp(page);
  await page.goto('/');

  const active=page.getByRole('button',{name:/Active Requisitions: 5\./});
  const requested=page.getByRole('button',{name:/Requested: 3\./});
  const ordered=page.getByRole('button',{name:/Ordered: 2\./});
  await expect(active).toBeVisible();
  await expect(requested).toBeVisible();
  await expect(ordered).toBeVisible();
  await expect(active).toHaveAttribute('tabindex','0');
  const interactionAudit=await active.evaluate(element=>({cursor:getComputedStyle(element).cursor,animationName:getComputedStyle(element).animationName,before:getComputedStyle(element,'::before').pointerEvents,after:getComputedStyle(element,'::after').pointerEvents,role:element.getAttribute('role')}));
  expect(interactionAudit).toEqual({cursor:'pointer',animationName:'none',before:'none',after:'none',role:'button'});
  const boxes=await page.locator('.dashboard-metric-pill').evaluateAll(elements=>elements.map(element=>{const box=element.getBoundingClientRect();return{x:box.x,y:box.y,width:box.width,height:box.height};}));
  expect(boxes).toHaveLength(3);
  expect(boxes.every(box=>box.height>=44)).toBe(true);
  if(mobile){expect(boxes[1].y).toBeGreaterThan(boxes[0].y);expect(boxes[2].y).toBeGreaterThan(boxes[1].y);}else{expect(Math.max(...boxes.map(box=>box.y))-Math.min(...boxes.map(box=>box.y))).toBeLessThanOrEqual(1);}
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

  let navigationCalls=await pushStateCalls(page);
  await activate(active.locator('.dashboard-metric-note'),mobile);
  await expect(page).toHaveURL(/\/requisitions\?view=active$/);
  expect(await pushStateCalls(page)).toBe(navigationCalls+1);
  await expect(page.getByRole('button',{name:'Active',pressed:true})).toBeVisible();
  await expect(page.locator('.requisition-status')).toHaveText(['Requested','Ordered']);
  expect(fixture.listStatuses.at(-1)).toBeNull();

  fixture.setSummary({requestedCount:1,orderedCount:4,receivedCount:7,canceledCount:1,activeCount:5});
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('button',{name:/Requested: 1\./})).toBeVisible();
  await expect(page.getByRole('button',{name:/Ordered: 4\./})).toBeVisible();

  navigationCalls=await pushStateCalls(page);
  const refreshedRequested=page.getByRole('button',{name:/Requested: 1\./});
  await focusWithKeyboard(page,refreshedRequested);
  expect(await refreshedRequested.evaluate(element=>element.matches(':focus-visible'))).toBe(true);
  expect(await refreshedRequested.evaluate(element=>getComputedStyle(element).outlineStyle)).not.toBe('none');
  await refreshedRequested.press('Enter');
  await expect(page).toHaveURL(/\/requisitions\?view=requested$/);
  expect(await pushStateCalls(page)).toBe(navigationCalls+1);
  await expect(page.getByRole('button',{name:'Requested',pressed:true})).toBeVisible();
  expect(fixture.listStatuses.at(-1)).toBe('Requested');

  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  navigationCalls=await pushStateCalls(page);
  const refreshedOrdered=page.getByRole('button',{name:/Ordered: 4\./});
  await refreshedOrdered.focus();
  await refreshedOrdered.press('Space');
  await expect(page).toHaveURL(/\/requisitions\?view=ordered$/);
  expect(await pushStateCalls(page)).toBe(navigationCalls+1);
  await expect(page.getByRole('button',{name:'Ordered',pressed:true})).toBeVisible();
  expect(fixture.listStatuses.at(-1)).toBe('Ordered');
});

test('requisition view query opens immediately and survives refresh',async({page})=>{
  await mockApp(page);
  await page.goto('/requisitions?view=ordered');
  await expect(page.getByRole('button',{name:'Ordered',pressed:true})).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/requisitions\?view=ordered$/);
  await expect(page.getByRole('button',{name:'Ordered',pressed:true})).toBeVisible();
  await expect(page.locator('.requisition-status')).toHaveText(['Ordered']);
});
