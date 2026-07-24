import { expect, type Locator, type Page, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

type AlertOverrides=Record<string,unknown>;
function alert(id:number,status:string,overrides:AlertOverrides={}) {
  return {
    id,assetId:id,assetNumber:`Press ${id}`,assetName:`Test Press ${id}`,brand:id%2?'Toyo':'Engel',model:`Model ${id}`,serialNumber:`SER-${id}`,
    title:`PM Task ${id}`,instructions:'Follow the approved maintenance procedure.',notes:'Record measurements before returning the asset to service.',
    intervalType:'days',intervalLabel:'Days',intervalValue:30,status,relativeMessage:status==='Due Soon'?'Due in 5 days':status==='Due Now'?'Due Now — perform maintenance today':'Past due by 2 days',countdown:'',scheduleStatus:'active',
    lastCompletedDate:'2026-06-17',lastCompletedMeter:null,currentMeter:null,nextDueDate:'2026-07-17',nextDueMeter:null,historyCount:1,createdAt:'2026-06-01T12:00:00Z',updatedAt:'2026-07-17T12:00:00Z',
    ...overrides,
  };
}

const fixtureAlerts=[
  alert(55,'Due Soon',{nextDueDate:'2026-07-22',relativeMessage:'Due in 5 days'}),
  alert(54,'Due Now',{nextDueDate:'2026-07-17'}),
  alert(53,'Past Due',{intervalType:'hourly',intervalLabel:'Hourly',intervalValue:250,lastCompletedDate:null,lastCompletedMeter:1000,currentMeter:1255,nextDueDate:null,nextDueMeter:1250,relativeMessage:'Past due by 5 hours'}),
  alert(51,'Past Due',{title:'Machine Greasing',intervalType:'hourly',intervalLabel:'Hourly',intervalValue:250,lastCompletedDate:null,lastCompletedMeter:1000,currentMeter:1270,nextDueDate:null,nextDueMeter:1250,relativeMessage:'Past due by 20 hours'}),
  alert(57,'Past Due',{scheduleStatus:'hold',title:'Held PM must be excluded'}),
  alert(58,'Due Now',{scheduleStatus:'inactive',title:'Inactive PM must be excluded'}),
];

async function mockDashboard(page:Page,alerts=fixtureAlerts) {
  await page.addInitScript(()=>{(window as unknown as {__printCalls:number}).__printCalls=0;window.print=()=>{(window as unknown as {__printCalls:number}).__printCalls+=1;};});
  await page.route('**/api/auth/status',route=>route.fulfill({json:{setupRequired:false,user:{id:1,fullName:'Dashboard Tester',email:'dashboard@example.com',role:'Admin',isOwnerAdmin:true,forcePasswordChange:false}}}));
  await page.route('**/api/requisitions/summary',route=>route.fulfill({json:{ok:true,requestedCount:0,orderedCount:0,receivedCount:0,canceledCount:0,activeCount:0}}));
  await page.route('**/api/dashboard/preventive-maintenance-due',route=>route.fulfill({json:{ok:true,alerts,summary:{}}}));
  await page.route(/\/api\/machine-library\/preventive-maintenance\/\d+\/history$/,route=>route.fulfill({json:{ok:true,history:[{id:1,completionDate:'2026-06-17',completedMeter:1000,performedBy:'Dashboard Tester',completionNotes:'Completed',createdAt:'2026-06-17T12:00:00Z'}]}}));
}
async function activate(locator:Locator,mobile:boolean){if(mobile)await locator.tap();else await locator.click();}
function pdfPageCount(pdf:Uint8Array){return new TextDecoder('latin1').decode(pdf).match(/\/Type\s*\/Page\b/g)?.length??0;}

test('sorts attention PMs, opens details, excludes paused schedules, and prints a one-page blank-number work order',async({page},testInfo)=>{
  const mobile=testInfo.project.name==='mobile-chromium';
  await mockDashboard(page);
  await page.goto('/');
  const cards=page.locator('.dashboard-pm-alert');
  await expect(cards).toHaveCount(4);
  await expect(page.getByText('1 Due Soon',{exact:true})).toBeVisible();
  await expect(page.getByText('1 Due Now',{exact:true})).toBeVisible();
  await expect(page.getByText('2 Past Due',{exact:true})).toBeVisible();
  await expect(page.getByText('Held PM must be excluded')).toHaveCount(0);
  await expect(page.getByText('Inactive PM must be excluded')).toHaveCount(0);
  await expect(cards.nth(0)).toContainText('Press 51');
  await expect(cards.nth(0)).toContainText('Past due by 20 hours');
  await expect(cards.nth(1)).toContainText('Press 53');
  await expect(cards.nth(2)).toContainText('Due Now');
  await expect(cards.nth(3)).toContainText('Due Soon');

  await activate(cards.first(),mobile);
  const dialog=page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading',{name:'Machine Greasing'})).toBeVisible();
  await expect(dialog).toContainText('Press 51');
  await activate(dialog.getByRole('button',{name:'Print / Save PDF'}),mobile);
  expect(await page.evaluate(()=>(window as unknown as {__printCalls:number}).__printCalls)).toBe(1);

  await page.emulateMedia({media:'print'});
  const workOrder=page.locator('.pm-work-order-print');
  await expect(workOrder).toBeVisible();
  await expect(workOrder).toContainText('Preventive Maintenance Work Order');
  await expect(workOrder).toContainText('WO #: ______________________________');
  await expect(workOrder).toContainText('Performed By: ______________________________');
  await expect(workOrder).toContainText('Signature: _________________________________');
  await expect(workOrder).not.toContainText('JBT');
  const printLayout=await workOrder.evaluate(element=>{
    const style=getComputedStyle(element);
    const backdrop=element.closest('.dashboard-pm-backdrop') as HTMLElement;
    const detail=element.closest('.dashboard-pm-detail') as HTMLElement;
    const mainHeader=element.querySelector('header')!;
    const sectionHeader=element.querySelector('section h2')!;
    const label=element.querySelector('.pm-work-order-grid span')!;
    const value=element.querySelector('.pm-work-order-grid strong')!;
    const grid=element.querySelector('.pm-work-order-grid')!;
    const writingLine=element.querySelector('.pm-work-order-completion p')!;
    return {
      rootDisplay:getComputedStyle(document.getElementById('root')!).display,
      top:element.getBoundingClientRect().top,
      position:style.position,
      margin:style.margin,
      opacity:style.opacity,
      filter:style.filter,
      mixBlendMode:style.mixBlendMode,
      transform:style.transform,
      minHeight:style.minHeight,
      height:style.height,
      breakBefore:style.breakBefore,
      pageBreakBefore:style.pageBreakBefore,
      printColorAdjust:style.getPropertyValue('print-color-adjust'),
      mainHeaderBackground:getComputedStyle(mainHeader).backgroundColor,
      mainHeaderColor:getComputedStyle(mainHeader).color,
      sectionHeaderBackground:getComputedStyle(sectionHeader).backgroundColor,
      sectionHeaderColor:getComputedStyle(sectionHeader).color,
      bodyColor:style.color,
      labelColor:getComputedStyle(label).color,
      valueColor:getComputedStyle(value).color,
      gridBorderColor:getComputedStyle(grid).borderTopColor,
      writingLineColor:getComputedStyle(writingLine).color,
      backdropPosition:getComputedStyle(backdrop).position,
      backdropOpacity:getComputedStyle(backdrop).opacity,
      backdropFilter:getComputedStyle(backdrop).filter,
      backdropMargin:getComputedStyle(backdrop).margin,
      detailPosition:getComputedStyle(detail).position,
      detailOpacity:getComputedStyle(detail).opacity,
      detailFilter:getComputedStyle(detail).filter,
    };
  });
  expect(printLayout).toMatchObject({rootDisplay:'none',position:'static',margin:'0px',opacity:'1',filter:'none',mixBlendMode:'normal',transform:'none',minHeight:'0px',breakBefore:'auto',pageBreakBefore:'auto',printColorAdjust:'exact',mainHeaderBackground:'rgb(0, 90, 156)',mainHeaderColor:'rgb(255, 255, 255)',sectionHeaderBackground:'rgb(22, 118, 184)',sectionHeaderColor:'rgb(255, 255, 255)',bodyColor:'rgb(17, 24, 39)',labelColor:'rgb(55, 65, 81)',valueColor:'rgb(17, 24, 39)',gridBorderColor:'rgb(107, 135, 155)',writingLineColor:'rgb(17, 24, 39)',backdropPosition:'static',backdropOpacity:'1',backdropFilter:'none',backdropMargin:'0px',detailPosition:'static',detailOpacity:'1',detailFilter:'none'});
  expect(printLayout.top).toBeLessThanOrEqual(1);
  expect(printLayout.height).not.toBe('100vh');
  const pdf=await page.pdf({preferCSSPageSize:true,printBackground:true});
  expect(pdfPageCount(pdf)).toBe(1);
  await testInfo.attach('normal-pm-work-order.pdf',{body:pdf,contentType:'application/pdf'});
  const pdfWithoutBackgroundGraphics=await page.pdf({preferCSSPageSize:true,printBackground:false});
  expect(pdfPageCount(pdfWithoutBackgroundGraphics)).toBe(1);
  await testInfo.attach('normal-pm-work-order-no-background-graphics.pdf',{body:pdfWithoutBackgroundGraphics,contentType:'application/pdf'});
  const qaPdfPath=process.env.MCC_PM_QA_PDF?.replace('{project}',testInfo.project.name);
  if(qaPdfPath){await writeFile(qaPdfPath,pdf);await writeFile(qaPdfPath.replace(/\.pdf$/,'-no-background-graphics.pdf'),pdfWithoutBackgroundGraphics);}
});

test('shows the compact empty state when no preventive maintenance needs attention',async({page})=>{
  await mockDashboard(page,[]);
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Preventive Maintenance Due'})).toBeVisible();
  await expect(page.getByText('No preventive maintenance is currently due.')).toBeVisible();
  await expect(page.locator('.dashboard-pm-alert')).toHaveCount(0);
});

test('keeps 1, 2, 3, 5, and 10 PM alerts compact, content-sized, wrapping, and mobile-safe',async({page},testInfo)=>{
  const mobile=testInfo.project.name==='mobile-chromium';
  const dynamicAlerts=[alert(1,'Past Due')];
  await mockDashboard(page,dynamicAlerts);
  await page.goto('/');

  for(const count of [1,2,3,5,10]){
    dynamicAlerts.splice(0,dynamicAlerts.length,...Array.from({length:count},(_,index)=>alert(index+1,index%3===0?'Past Due':index%3===1?'Due Now':'Due Soon',index===0?{
      assetNumber:'PRESS-ENGINEERING-LONG-ASSET-0001',
      brand:'',
      title:'Exceptionally long preventive maintenance task title that must wrap safely inside the technical alert module',
      relativeMessage:'Past due by 2 hours after the scheduled production maintenance window',
    }:{})));
    await page.reload();
    const cards=page.locator('.dashboard-pm-alert');
    await expect(cards).toHaveCount(count);
    const layout=await page.evaluate(()=>{
      const panel=document.querySelector<HTMLElement>('.dashboard-pm-panel')!;
      const grid=document.querySelector<HTMLElement>('.dashboard-pm-grid')!;
      const cards=[...document.querySelectorAll<HTMLElement>('.dashboard-pm-alert')];
      const tokens=[...document.querySelectorAll<HTMLElement>('.dashboard-pm-counts .mcc-summary-token')];
      return {
        panelWidth:panel.getBoundingClientRect().width,
        gridWidth:grid.getBoundingClientRect().width,
        gridLeft:grid.getBoundingClientRect().left,
        documentOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
        cards:cards.map(card=>({left:card.getBoundingClientRect().left,top:card.getBoundingClientRect().top,width:card.getBoundingClientRect().width,scrollWidth:card.scrollWidth,clientWidth:card.clientWidth,flexGrow:getComputedStyle(card).flexGrow})),
        tokenWidths:tokens.map(token=>token.getBoundingClientRect().width),
      };
    });
    expect(layout.documentOverflow).toBeLessThanOrEqual(0);
    expect(layout.cards.every(card=>card.flexGrow==='0'&&card.width<=441&&card.scrollWidth<=card.clientWidth+1)).toBeTruthy();
    expect(Math.abs(layout.cards[0].left-layout.gridLeft)).toBeLessThanOrEqual(2);
    expect(layout.tokenWidths.every(width=>width<150)).toBeTruthy();
    if(mobile)expect(layout.cards.every(card=>card.width>=layout.gridWidth-2)).toBeTruthy();
    else {
      expect(layout.cards[0].width).toBeLessThan(layout.panelWidth*.6);
      if(count===10)expect(new Set(layout.cards.map(card=>Math.round(card.top))).size).toBeGreaterThan(1);
    }
  }

  const title=page.locator('.dashboard-pm-task strong').first();
  const titleLayout=await title.evaluate(element=>({height:element.getBoundingClientRect().height,lineHeight:Number.parseFloat(getComputedStyle(element).lineHeight),scrollWidth:element.scrollWidth,clientWidth:element.clientWidth}));
  expect(titleLayout.height).toBeGreaterThan(titleLayout.lineHeight);
  expect(titleLayout.scrollWidth).toBeLessThanOrEqual(titleLayout.clientWidth+1);
  await activate(page.locator('.dashboard-pm-alert').first(),mobile);
  await expect(page.getByRole('dialog')).toBeVisible();
});
