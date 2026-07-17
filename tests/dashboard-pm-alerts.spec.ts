import { expect, type Locator, type Page, test } from '@playwright/test';

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
  await expect(page.getByText('PM Due: 1 Due Soon · 1 Due Now · 2 Past Due')).toBeVisible();
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
    return {
      rootDisplay:getComputedStyle(document.getElementById('root')!).display,
      top:element.getBoundingClientRect().top,
      position:style.position,
      margin:style.margin,
      transform:style.transform,
      minHeight:style.minHeight,
      height:style.height,
      breakBefore:style.breakBefore,
      pageBreakBefore:style.pageBreakBefore,
      backdropPosition:getComputedStyle(backdrop).position,
      backdropMargin:getComputedStyle(backdrop).margin,
      detailPosition:getComputedStyle(detail).position,
    };
  });
  expect(printLayout).toMatchObject({rootDisplay:'none',position:'static',margin:'0px',transform:'none',minHeight:'0px',breakBefore:'auto',pageBreakBefore:'auto',backdropPosition:'static',backdropMargin:'0px',detailPosition:'static'});
  expect(printLayout.top).toBeLessThanOrEqual(1);
  expect(printLayout.height).not.toBe('100vh');
  const pdf=await page.pdf({preferCSSPageSize:true,printBackground:true});
  expect(pdfPageCount(pdf)).toBe(1);
});

test('shows the compact empty state when no preventive maintenance needs attention',async({page})=>{
  await mockDashboard(page,[]);
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Preventive Maintenance Due'})).toBeVisible();
  await expect(page.getByText('No preventive maintenance is currently due.')).toBeVisible();
  await expect(page.locator('.dashboard-pm-alert')).toHaveCount(0);
});
