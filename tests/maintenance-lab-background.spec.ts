import { expect, type Page, test } from '@playwright/test';

const detailFields={machineType:'Injection Molding Machine',powerType:'Electric',shotSizeOz:12,tonnage:250,voltageValue:'480',voltageType:'VAC',fullLoadAmp:'320',machineLength:'',machineWidth:'',machineHeight:'',fullDieHeightLength:'',location:'',department:'Molding',screwType:'',screwTipType:'',screwTipInstalledDate:'',screwInstalledDate:'',barrelInstalledDate:'',barrelEndCapInstalledDate:'',barrelLength:'',screwLength:'',screwRebuildRepaired:false,barrelRebuildRepaired:false,screwConditionStatus:'new',barrelConditionStatus:'new',hasDoubleShotInjection:false,hasPlungerInjection:false,screw2Type:'',screw2TipType:'',screw2RebuildRepaired:false,screw2ConditionStatus:'new',screw2InstalledDate:'',screw2TipInstalledDate:'',screw2Length:'',barrel2Diameter:'',barrel2RebuildRepaired:false,barrel2ConditionStatus:'new',barrel2InstalledDate:'',barrel2EndCapInstalledDate:'',barrel2Length:'',plungerType:'',plungerRebuildRepaired:false,plungerConditionStatus:'new',plungerInstalledDate:'',plungerLength:'',plungerDiameter:'',plungerBarrelType:'',plungerBarrelRebuildRepaired:false,plungerBarrelConditionStatus:'new',plungerBarrelInstalledDate:'',plungerBarrelEndCapInstalledDate:'',plungerBarrelLength:'',plungerBarrelDiameter:'',notes:'',criticalNotes:'',createdAt:'2026-01-01T12:00:00Z',updatedAt:'2026-07-17T12:00:00Z'};
const assets=Array.from({length:18},(_,index)=>({
  ...detailFields,id:index+1,assetNumber:`Press ${index+1}`,assetName:`Test Press ${index+1}`,brand:index%2?'Toyo':'Engel',model:`Model ${index+1}`,serialNumber:`SER-${index+1}`,machineYear:'2018',barrelDiameter:'35mm',status:'active',brandColorHex:index%2?'#44D7FF':'#F5A623',pmSummary:null,historyPreview:[],
}));

async function mockApp(page:Page) {
  await page.route('**/api/auth/status',route=>route.fulfill({json:{setupRequired:false,user:{id:1,fullName:'Background Tester',email:'background@example.com',role:'Admin',isOwnerAdmin:true,forcePasswordChange:false}}}));
  await page.route('**/api/settings/branding',route=>route.fulfill({json:{ok:true,branding:{companyName:'MCC',companySubtitle:'Maintenance Command Center',companyAccentText:'',logoMode:'text',logoUrl:'',iconAnimation:'none'}}}));
  await page.route('**/api/requisitions/summary',route=>route.fulfill({json:{ok:true,requestedCount:0,orderedCount:0,receivedCount:0,canceledCount:0,activeCount:0}}));
  await page.route(/\/api\/machine-library\/assets(?:\?.*)?$/,route=>route.fulfill({json:{ok:true,assets,brandSettings:[],permissions:{canEdit:true,canDelete:true}}}));
  await page.route(/\/api\/machine-library\/assets\/\d+\/inspection-records$/,route=>route.fulfill({json:{ok:true,records:[]}}));
  await page.route(/\/api\/machine-library\/assets\/\d+\/history$/,route=>route.fulfill({json:{ok:true,asset:assets[0],records:[]}}));
  await page.route(/\/api\/machine-library\/assets\/\d+\/preventive-maintenance$/,route=>route.fulfill({json:{ok:true,tasks:[],summary:{total:0,current:0,dueSoon:0,dueNow:0,overdue:0,hold:0,inactive:0,incomplete:0,nextDueDate:null,nextDueMeter:null}}}));
  await page.route(/\/api\/machine-library\/assets\/\d+\/notes$/,route=>route.fulfill({json:{ok:true,notes:[]}}));
  await page.route(/\/api\/machine-library\/assets\/\d+\/component-images$/,route=>route.fulfill({json:{ok:true,images:[]}}));
  await page.route(/\/api\/machine-library\/assets\/\d+\/document-folders$/,route=>route.fulfill({json:{ok:true,folders:[],summary:{folderCount:0,documentCount:0}}}));
  await page.route(/\/api\/machine-library\/assets\/\d+\/documents$/,route=>route.fulfill({json:{ok:true,documents:[]}}));
}

async function swipePageUp(page:Page) {
  const session=await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:195,y:700,radiusX:4,radiusY:4,force:1}]});
  for(const y of [620,540,460,380,300,220])await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:195,y,radiusX:4,radiusY:4,force:1}]});
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await session.detach();
}

test('shared maintenance-lab background fills a short Dashboard without intercepting input',async({page})=>{
  await mockApp(page);
  await page.goto('/');
  const shell=page.locator('.mcc-shell');
  await expect(shell).toBeVisible();
  const audit=await shell.evaluate(element=>{
    const rect=element.getBoundingClientRect();
    const top=document.elementFromPoint(rect.left+rect.width/2,Math.min(rect.bottom-2,150));
    return {
      shellBackground:getComputedStyle(element).backgroundImage,
      beforeBackground:getComputedStyle(element,'::before').backgroundImage,
      beforePointerEvents:getComputedStyle(element,'::before').pointerEvents,
      afterPointerEvents:getComputedStyle(element,'::after').pointerEvents,
      htmlScrollbar:getComputedStyle(document.documentElement).scrollbarWidth,
      bodyScrollbar:getComputedStyle(document.body).scrollbarWidth,
      webkitScrollbarWidth:getComputedStyle(document.documentElement,'::-webkit-scrollbar').width,
      intercepted:top!==element&&!element.contains(top),
      horizontalOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
      verticalOverflow:document.documentElement.scrollHeight-window.innerHeight,
    };
  });
  expect(audit.shellBackground).not.toBe('none');
  expect(audit.beforeBackground).toContain('data:image/svg+xml');
  expect(audit.beforePointerEvents).toBe('none');
  expect(audit.afterPointerEvents).toBe('none');
  expect(audit.htmlScrollbar).toBe('none');
  expect(audit.bodyScrollbar).toBe('none');
  expect(audit.webkitScrollbarWidth).toBe('0px');
  expect(audit.intercepted).toBe(false);
  expect(audit.horizontalOverflow).toBeLessThanOrEqual(1);
  expect(audit.verticalOverflow).toBeLessThanOrEqual(1);
});

test('long Machine Library pages and true modals keep document, keyboard, pointer, and touch scrolling',async({page},testInfo)=>{
  const mobile=testInfo.project.name==='mobile-chromium';
  await mockApp(page);
  await page.goto('/machine-library');
  const cards=page.locator('.machine-asset-card');
  await expect(cards).toHaveCount(18);
  const dimensions=await page.evaluate(()=>{const main=document.querySelector('.mcc-main')! as HTMLElement;const workspace=document.querySelector('.mcc-workspace')! as HTMLElement;main.scrollTop=50;workspace.scrollTop=50;const result={scrollHeight:document.documentElement.scrollHeight,innerHeight:window.innerHeight,horizontal:document.documentElement.scrollWidth-document.documentElement.clientWidth,mainScrollTop:main.scrollTop,workspaceScrollTop:workspace.scrollTop};main.scrollTop=0;workspace.scrollTop=0;return result;});
  expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.innerHeight);
  expect(dimensions.horizontal).toBeLessThanOrEqual(1);
  expect(dimensions.mainScrollTop).toBe(0);
  expect(dimensions.workspaceScrollTop).toBe(0);

  if(!mobile) {
    await page.keyboard.press('End');
    await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBeGreaterThan(0);
    await page.keyboard.press('Control+Home');
    await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBe(0);
    await page.keyboard.press('PageDown');
    await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBeGreaterThan(0);
  }
  await page.evaluate(()=>window.scrollTo(0,0));
  if(mobile)await swipePageUp(page);else await page.mouse.wheel(0,650);
  await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBeGreaterThan(0);

  await page.goto('/machine-library');
  await expect(cards.first()).toBeVisible();
  await cards.first().locator('.machine-asset-number-pill').click();
  await expect(page.locator('.machine-detail-modal')).toBeVisible();
  const detailOverlayAudit=await page.locator('.mcc-shell').evaluate(element=>({before:getComputedStyle(element,'::before').pointerEvents,after:getComputedStyle(element,'::after').pointerEvents}));
  expect(detailOverlayAudit).toEqual({before:'none',after:'none'});
  await page.goto('/machine-library');
  await expect(cards.first()).toBeVisible();

  await page.setViewportSize({width:mobile?390:1000,height:500});
  const logsButton=cards.first().getByRole('button',{name:'Barrel & Screw Logs'});
  await logsButton.click();
  const modal=page.locator('.measurement-record-modal');
  await expect(modal).toBeVisible();
  const modalAudit=await modal.evaluate(element=>({scrollHeight:element.scrollHeight,clientHeight:element.clientHeight,scrollbarWidth:getComputedStyle(element).scrollbarWidth,webkitWidth:getComputedStyle(element,'::-webkit-scrollbar').width}));
  expect(modalAudit.scrollHeight).toBeGreaterThan(modalAudit.clientHeight);
  expect(modalAudit.scrollbarWidth).toBe('none');
  expect(modalAudit.webkitWidth).toBe('0px');
  const modalScrollTop=await modal.evaluate(element=>{element.scrollTop=element.scrollHeight;return element.scrollTop;});
  expect(modalScrollTop).toBeGreaterThan(0);
});
