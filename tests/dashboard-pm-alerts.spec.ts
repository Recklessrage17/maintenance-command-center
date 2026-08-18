import { expect, type Locator, type Page, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

type AlertOverrides=Record<string,unknown>;
function alert(id:number,status:string,overrides:AlertOverrides={}) {
  return {
    id,assetId:id,assetNumber:`Press ${id}`,assetName:`Test Press ${id}`,brand:id%2?'Toyo':'Engel',model:`Model ${id}`,serialNumber:`SER-${id}`,
    assetLibrary:'machine',assetAccentColor:id%2?'#1E6BFF':'#FFFFFF',assetCategory:'',
    title:`PM Task ${id}`,instructions:'Follow the approved maintenance procedure.',notes:'Record measurements before returning the asset to service.',
    intervalType:'days',intervalLabel:'Days',intervalValue:30,status,relativeMessage:status==='Due Soon'?'Due in 5 days':status==='Due Now'?'Due Now — perform maintenance today':'Past due by 2 days',countdown:'',scheduleStatus:'active',
    lastCompletedDate:'2026-06-17',lastCompletedMeter:null,currentMeter:null,nextDueDate:'2026-07-17',nextDueMeter:null,historyCount:1,createdAt:'2026-06-01T12:00:00Z',updatedAt:'2026-07-17T12:00:00Z',
    ...overrides,
  };
}

const fixtureAlerts=[
  alert(551,'Past Due',{assetId:51,assetNumber:'Press 51',assetName:'North Cell Press',brand:'Toyo',title:'Machine Greasing',intervalType:'hourly',intervalLabel:'Hourly',intervalValue:250,lastCompletedDate:null,lastCompletedMeter:1000,currentMeter:1270,nextDueDate:null,nextDueMeter:1250,relativeMessage:'Past due by 20 hours'}),
  alert(552,'Past Due',{assetId:51,assetNumber:'Press 51',assetName:'North Cell Press',brand:'Toyo',title:'Filter Inspection',intervalType:'hourly',intervalLabel:'Hourly',intervalValue:250,lastCompletedDate:null,lastCompletedMeter:1000,currentMeter:1255,nextDueDate:null,nextDueMeter:1250,relativeMessage:'Past due by 5 hours'}),
  alert(553,'Due Now',{assetId:51,assetNumber:'Press 51',assetName:'North Cell Press',brand:'Toyo',title:'Safety Interlock Check',nextDueDate:'2026-07-17'}),
  alert(471,'Due Soon',{assetId:47,assetNumber:'Press 47',assetName:'South Cell Press',brand:'Toyo',nextDueDate:'2026-07-22',relativeMessage:'Due in 5 days'}),
  alert(3011,'Past Due',{assetLibrary:'equipment',assetId:301,assetNumber:'EQ-301',assetName:'Plant Air Compressor',brand:'Atlas Copco',assetCategory:'Air Compressor',title:'Drain Inspection',intervalType:'cycles',intervalLabel:'Cycles',intervalValue:500,lastCompletedDate:null,lastCompletedMeter:1000,currentMeter:1700,nextDueDate:null,nextDueMeter:1500,relativeMessage:'Past due by 200 cycles'}),
  alert(3012,'Due Soon',{assetLibrary:'equipment',assetId:301,assetNumber:'EQ-301',assetName:'Plant Air Compressor',brand:'Atlas Copco',assetCategory:'Air Compressor',title:'Belt Inspection',nextDueDate:'2026-07-22',relativeMessage:'Due in 5 days'}),
  alert(57,'Past Due',{scheduleStatus:'hold',title:'Held PM must be excluded'}),
  alert(58,'Due Now',{scheduleStatus:'inactive',title:'Inactive PM must be excluded'}),
];

async function mockDashboard(page:Page,alerts=fixtureAlerts) {
  await page.addInitScript(()=>{(window as unknown as {__printCalls:number}).__printCalls=0;window.print=()=>{(window as unknown as {__printCalls:number}).__printCalls+=1;};});
  await page.route('**/api/auth/status',route=>route.fulfill({json:{setupRequired:false,user:{id:1,fullName:'Dashboard Tester',email:'dashboard@example.com',role:'Admin',isOwnerAdmin:true,forcePasswordChange:false,effectivePermissions:['machine.view','machine.pm_manage','equipment.view','equipment.pm_manage']}}}));
  await page.route('**/api/requisitions/summary',route=>route.fulfill({json:{ok:true,requestedCount:0,orderedCount:0,receivedCount:0,canceledCount:0,activeCount:0}}));
  await page.route('**/api/dashboard/preventive-maintenance-due',route=>route.fulfill({json:{ok:true,alerts,summary:{}}}));
  await page.route(/\/api\/machine-library\/preventive-maintenance\/\d+\/history$/,route=>route.fulfill({json:{ok:true,history:[{id:1,completionDate:'2026-06-17',completedMeter:1000,performedBy:'Dashboard Tester',completionNotes:'Completed',createdAt:'2026-06-17T12:00:00Z'}]}}));
}
async function activate(locator:Locator,mobile:boolean){if(mobile)await locator.tap();else await locator.click();}
function pdfPageCount(pdf:Uint8Array){return new TextDecoder('latin1').decode(pdf).match(/\/Type\s*\/Page\b/g)?.length??0;}

test('groups and separates PMs, manages accordion state, priority sorts overdue tasks, and prints a one-page work order',async({page},testInfo)=>{
  const mobile=testInfo.project.name==='mobile-chromium';
  await mockDashboard(page);
  await page.goto('/');
  const machineSection=page.locator('.dashboard-pm-section--machine');
  const equipmentSection=page.locator('.dashboard-pm-section--equipment');
  await expect(machineSection.getByRole('heading',{name:'Machine PM Attention'})).toBeVisible();
  await expect(equipmentSection.getByRole('heading',{name:'Equipment PM Attention'})).toBeVisible();
  await expect(machineSection.locator('.dashboard-pm-asset-group')).toHaveCount(2);
  await expect(equipmentSection.locator('.dashboard-pm-asset-group')).toHaveCount(1);
  await expect(machineSection.getByText('1 Due Soon',{exact:true})).toBeVisible();
  await expect(machineSection.getByText('1 Due Now',{exact:true})).toBeVisible();
  await expect(machineSection.getByText('2 Past Due',{exact:true})).toBeVisible();
  await expect(equipmentSection.getByText('1 Due Soon',{exact:true})).toBeVisible();
  await expect(equipmentSection.getByText('1 Past Due',{exact:true})).toBeVisible();
  await expect(page.getByText('Held PM must be excluded')).toHaveCount(0);
  await expect(page.getByText('Inactive PM must be excluded')).toHaveCount(0);
  const press51=machineSection.getByRole('button',{name:/Press 51 \(Toyo\)/});
  const press47=machineSection.getByRole('button',{name:/Press 47 \(Toyo\)/});
  await expect(press51).toHaveAttribute('aria-expanded','false');
  await expect(press47).toHaveAttribute('aria-expanded','false');
  await press51.press('Enter');
  await expect(press51).toHaveAttribute('aria-expanded','true');
  await expect(press51).toBeFocused();
  await expect(press51).toHaveCSS('outline-style','solid');
  const overdueRows=machineSection.locator('.dashboard-pm-asset-group.is-open .dashboard-pm-status-section.status-past-due .dashboard-pm-task-row');
  await expect(overdueRows).toHaveCount(2);
  await expect(overdueRows.nth(0)).toContainText('Machine Greasing');
  await expect(overdueRows.nth(0)).toContainText('Past due by 20 hours');
  await expect(overdueRows.nth(1)).toContainText('Past due by 5 hours');
  await expect(overdueRows.nth(0).locator('.dashboard-pm-interval')).toHaveClass(/dashboard-pm-interval--hourly/);
  await expect(overdueRows.nth(0).locator('.dashboard-pm-interval')).toHaveCSS('color','rgb(168, 242, 205)');
  await activate(press47,mobile);
  await expect(press47).toHaveAttribute('aria-expanded','true');
  await expect(press51).toHaveAttribute('aria-expanded','false');
  await activate(press47,mobile);
  await expect(press47).toHaveAttribute('aria-expanded','false');
  const equipment301=equipmentSection.getByRole('button',{name:/EQ-301 \(Atlas Copco\)/});
  await activate(equipment301,mobile);
  await expect(equipment301).toHaveAttribute('aria-expanded','true');
  await activate(equipmentSection.getByRole('button',{name:/Open Drain Inspection preventive maintenance details/}),mobile);
  await expect(page.getByRole('dialog',{name:'Drain Inspection'})).toBeVisible();
  await activate(page.getByRole('dialog',{name:'Drain Inspection'}).getByRole('button',{name:'Close'}).first(),mobile);
  await activate(press51,mobile);
  await activate(machineSection.getByRole('button',{name:/Open Machine Greasing preventive maintenance details/}),mobile);
  const dialog=page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading',{name:'Machine Greasing'})).toBeVisible();
  await expect(dialog).toContainText('Press 51');
  await expect(dialog.locator('.dashboard-pm-detail-item--hourly')).toContainText('Every 250 hours');
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

test('sorts date, hour, and cycle past-due tasks by greatest overdue amount',async({page})=>{
  const alerts=[
    alert(1001,'Past Due',{assetId:10,assetNumber:'Press 10',title:'Date most overdue',nextDueDate:'2026-05-01',relativeMessage:'Past due by 90 days'}),
    alert(1002,'Past Due',{assetId:10,assetNumber:'Press 10',title:'Date less overdue',nextDueDate:'2026-07-01',relativeMessage:'Past due by 29 days'}),
    alert(2001,'Past Due',{assetId:20,assetNumber:'Press 20',title:'Hour most overdue',intervalType:'hourly',nextDueDate:null,nextDueMeter:1000,currentMeter:1400,relativeMessage:'Past due by 400 hours'}),
    alert(2002,'Past Due',{assetId:20,assetNumber:'Press 20',title:'Hour less overdue',intervalType:'hourly',nextDueDate:null,nextDueMeter:1000,currentMeter:1100,relativeMessage:'Past due by 100 hours'}),
    alert(3001,'Past Due',{assetLibrary:'equipment',assetId:30,assetNumber:'EQ-30',title:'Cycle most overdue',intervalType:'cycles',nextDueDate:null,nextDueMeter:5000,currentMeter:5900,relativeMessage:'Past due by 900 cycles'}),
    alert(3002,'Past Due',{assetLibrary:'equipment',assetId:30,assetNumber:'EQ-30',title:'Cycle less overdue',intervalType:'cycles',nextDueDate:null,nextDueMeter:5000,currentMeter:5200,relativeMessage:'Past due by 200 cycles'}),
  ];
  await mockDashboard(page,alerts);
  await page.goto('/');
  for(const [asset,expected] of [['Press 10','Date most overdue'],['Press 20','Hour most overdue'],['EQ-30','Cycle most overdue']] as const){
    const toggle=page.getByRole('button',{name:new RegExp(asset)});
    await toggle.click();
    const group=toggle.locator('..');
    await expect(group.locator('.dashboard-pm-task-row').first()).toContainText(expected);
  }
});

test('opens the shared Edit, Complete, and History workflows from dashboard PM details',async({page})=>{
  await mockDashboard(page,[fixtureAlerts[0]]);await page.goto('/');await page.getByRole('button',{name:/Press 51 \(Toyo\)/}).click();await page.getByRole('button',{name:/Open Machine Greasing preventive maintenance details/}).click();const detail=page.getByRole('dialog',{name:'Machine Greasing'});await expect(detail.getByRole('button',{name:'Edit PM'})).toBeVisible();await expect(detail.getByRole('button',{name:'Complete PM'})).toBeVisible();await expect(detail.getByRole('button',{name:'View History'})).toBeVisible();
  await detail.getByRole('button',{name:'Edit PM'}).click();const edit=page.getByRole('dialog',{name:'Edit Preventive Maintenance Tracking'});await expect(edit.getByRole('textbox',{name:'PM Title'})).toHaveValue('Machine Greasing');await edit.getByRole('button',{name:'Close'}).click();
  await detail.getByRole('button',{name:'Complete PM'}).click();const complete=page.getByRole('dialog',{name:'Complete Machine Greasing'});await expect(complete.locator('.pm-identity-chip--asset')).toHaveText('PRESS 51');await expect(complete.locator('.pm-identity-chip--brand')).toHaveText('TOYO');await expect(complete).toContainText('Dashboard Tester');await complete.getByRole('button',{name:'Close'}).click();
  await detail.getByRole('button',{name:'View History'}).click();const history=page.getByRole('dialog',{name:'Machine Greasing'}).last();await expect(history).toContainText('Performed by Dashboard Tester');await history.getByRole('button',{name:'Close'}).first().click();
});

test('shows the compact empty state when no preventive maintenance needs attention',async({page})=>{
  await mockDashboard(page,[]);
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Maintenance Attention'})).toBeVisible();
  await expect(page.getByText('No machine PM tasks need attention.')).toBeVisible();
  await expect(page.getByText('No equipment PM tasks need attention.')).toBeVisible();
  await expect(page.locator('.dashboard-pm-asset-group')).toHaveCount(0);
});

test('switches Machine and Equipment accordions above or below in one interaction',async({page},testInfo)=>{
  const mobile=testInfo.project.name==='mobile-chromium';
  const alerts=[...fixtureAlerts,alert(3021,'Due Now',{assetLibrary:'equipment',assetId:302,assetNumber:'EQ-302',assetName:'Backup Air Compressor',brand:'Atlas Copco',assetCategory:'Air Compressor',title:'Oil Inspection',nextDueDate:'2026-07-17'})];
  await mockDashboard(page,alerts);
  await page.goto('/');

  for(const library of ['machine','equipment'] as const){
    const toggles=page.locator(`.dashboard-pm-section--${library} .dashboard-pm-asset-toggle`);
    await expect(toggles).toHaveCount(2);
    const upper=toggles.nth(0);
    const lower=toggles.nth(1);

    await activate(upper,mobile);
    await expect(upper).toHaveAttribute('aria-expanded','true');
    await lower.locator('.dashboard-pm-asset-identity strong').dispatchEvent('pointerdown',{pointerType:mobile?'touch':'mouse',isPrimary:true});
    await expect(upper).toHaveAttribute('aria-expanded','true');
    await lower.dispatchEvent('click');
    await expect(lower).toHaveAttribute('aria-expanded','true');
    await expect(upper).toHaveAttribute('aria-expanded','false');

    await activate(upper,mobile);
    await expect(upper).toHaveAttribute('aria-expanded','true');
    await expect(lower).toHaveAttribute('aria-expanded','false');
    await activate(upper,mobile);
    await expect(upper).toHaveAttribute('aria-expanded','false');
  }
});

test('closes Machine and Equipment accordions outside or on Escape, but not on inside pointer events',async({page},testInfo)=>{
  const mobile=testInfo.project.name==='mobile-chromium';
  await mockDashboard(page);
  await page.goto('/');
  const machineSection=page.locator('.dashboard-pm-section--machine');
  const equipmentSection=page.locator('.dashboard-pm-section--equipment');
  const press51=machineSection.getByRole('button',{name:/Press 51 \(Toyo\)/});
  const equipment301=equipmentSection.getByRole('button',{name:/EQ-301 \(Atlas Copco\)/});
  const verifyInsidePointerKeepsOpen=async(toggle:Locator,heading:Locator)=>{
    await expect(toggle).toHaveAttribute('aria-expanded','true');
    await expect(heading).toBeVisible();
    await heading.dispatchEvent('pointerdown',{pointerType:mobile?'touch':'mouse',isPrimary:true});
    await expect(toggle).toHaveAttribute('aria-expanded','true');
  };

  await activate(press51,mobile);
  await verifyInsidePointerKeepsOpen(press51,machineSection.locator('.dashboard-pm-status-section h4').first());
  await activate(machineSection.getByRole('heading',{name:'Machine PM Attention'}),mobile);
  await expect(press51).toHaveAttribute('aria-expanded','false');

  await press51.focus();
  await press51.press('Enter');
  await press51.press('Escape');
  await expect(press51).toHaveAttribute('aria-expanded','false');
  await expect(press51).toBeFocused();

  await activate(equipment301,mobile);
  await verifyInsidePointerKeepsOpen(equipment301,equipmentSection.locator('.dashboard-pm-status-section h4').first());
  await activate(equipmentSection.getByRole('heading',{name:'Equipment PM Attention'}),mobile);
  await expect(equipment301).toHaveAttribute('aria-expanded','false');
});

test('centers and highlights smoothly rotating PM chevrons in both libraries',async({page})=>{
  await mockDashboard(page);
  await page.goto('/');

  for(const [sectionClass,assetName] of [['machine','Press 51 \\(Toyo\\)'],['equipment','EQ-301 \\(Atlas Copco\\)']] as const){
    const section=page.locator(`.dashboard-pm-section--${sectionClass}`);
    const toggle=section.getByRole('button',{name:new RegExp(assetName)});
    const chevron=toggle.locator('.dashboard-pm-chevron');
    const icon=chevron.locator('svg');
    const closedStyle=await chevron.evaluate(element=>{
      const style=getComputedStyle(element);
      const identityBox=element.parentElement!.querySelector('.dashboard-pm-asset-identity')!.getBoundingClientRect();
      const chevronBox=element.getBoundingClientRect();
      return {
        centerOffset:Math.abs((chevronBox.top+chevronBox.height/2)-(identityBox.top+identityBox.height/2)),
        background:style.backgroundColor,
        boxShadow:style.boxShadow,
        transitionProperties:style.transitionProperty,
      };
    });
    expect(closedStyle.centerOffset).toBeLessThanOrEqual(1);
    expect(closedStyle.transitionProperties).toContain('box-shadow');
    await expect(icon).toHaveCSS('transition-property','transform');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded','true');
    await expect(icon).toHaveCSS('transform','matrix(-1, 0, 0, -1, 0, 0)');
    const openStyle=await chevron.evaluate(element=>({background:getComputedStyle(element).backgroundColor,boxShadow:getComputedStyle(element).boxShadow}));
    expect(openStyle.background).not.toBe(closedStyle.background);
    expect(openStyle.boxShadow).not.toBe(closedStyle.boxShadow);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded','false');
    await expect(icon).toHaveCSS('transform','matrix(1, 0, 0, 1, 0, 0)');
  }
});

test('renders sharp readable expanded PM task details in both libraries',async({page})=>{
  await mockDashboard(page);
  await page.goto('/');

  for(const [sectionClass,assetName,detailColor] of [['machine','Press 51 \\(Toyo\\)','rgb(168, 242, 205)'],['equipment','EQ-301 \\(Atlas Copco\\)','rgb(197, 220, 231)']] as const){
    const section=page.locator(`.dashboard-pm-section--${sectionClass}`);
    await section.getByRole('button',{name:new RegExp(assetName)}).click();
    const row=section.locator('.dashboard-pm-task-row').first();
    const title=row.locator('.dashboard-pm-task-main strong');
    const detail=row.locator('.dashboard-pm-task-main span');
    const due=row.locator('.dashboard-pm-task-due strong');
    const styles=await row.evaluate(element=>{
      const rowStyle=getComputedStyle(element);
      const titleStyle=getComputedStyle(element.querySelector('.dashboard-pm-task-main strong')!);
      const detailStyle=getComputedStyle(element.querySelector('.dashboard-pm-task-main span')!);
      const dueStyle=getComputedStyle(element.querySelector('.dashboard-pm-task-due strong')!);
      return {
        rowBackground:rowStyle.backgroundColor,
        title:{fontSize:Number.parseFloat(titleStyle.fontSize),fontWeight:Number(titleStyle.fontWeight),opacity:titleStyle.opacity,filter:titleStyle.filter,textShadow:titleStyle.textShadow},
        detail:{fontSize:Number.parseFloat(detailStyle.fontSize),fontWeight:Number(detailStyle.fontWeight),color:detailStyle.color,opacity:detailStyle.opacity,filter:detailStyle.filter,textShadow:detailStyle.textShadow},
        due:{fontSize:Number.parseFloat(dueStyle.fontSize),fontWeight:Number(dueStyle.fontWeight),opacity:dueStyle.opacity,filter:dueStyle.filter,textShadow:dueStyle.textShadow},
      };
    });
    expect(styles.rowBackground).toBe('rgba(3, 14, 27, 0.92)');
    expect(styles.title).toMatchObject({fontSize:14.72,fontWeight:950,opacity:'1',filter:'none',textShadow:'none'});
    expect(styles.detail).toMatchObject({fontSize:12,fontWeight:800,color:detailColor,opacity:'1',filter:'none',textShadow:'none'});
    expect(styles.due).toMatchObject({fontSize:12.48,fontWeight:900,opacity:'1',filter:'none',textShadow:'none'});
  }
});

test('keeps 1, 2, 3, 5, and 10 asset groups compact, wrapping, and mobile-safe',async({page},testInfo)=>{
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
    const groups=page.locator('.dashboard-pm-section--machine .dashboard-pm-asset-group');
    await expect(groups).toHaveCount(count);
    const layout=await page.evaluate(()=>{
      const panel=document.querySelector<HTMLElement>('.dashboard-pm-panel')!;
      const section=document.querySelector<HTMLElement>('.dashboard-pm-section--machine')!;
      const list=document.querySelector<HTMLElement>('.dashboard-pm-section--machine .dashboard-pm-asset-list')!;
      const groups=[...document.querySelectorAll<HTMLElement>('.dashboard-pm-section--machine .dashboard-pm-asset-group')];
      const tokens=[...document.querySelectorAll<HTMLElement>('.dashboard-pm-section--machine .dashboard-pm-section-counts .mcc-summary-token')];
      return {
        panelWidth:panel.getBoundingClientRect().width,
        sectionLeft:section.getBoundingClientRect().left,
        sectionRight:section.getBoundingClientRect().right,
        listWidth:list.getBoundingClientRect().width,
        listLeft:list.getBoundingClientRect().left,
        listRight:list.getBoundingClientRect().right,
        documentOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
        groups:groups.map(group=>({left:group.getBoundingClientRect().left,width:group.getBoundingClientRect().width,scrollWidth:group.scrollWidth,clientWidth:group.clientWidth})),
        tokenWidths:tokens.map(token=>token.getBoundingClientRect().width),
      };
    });
    expect(layout.documentOverflow).toBeLessThanOrEqual(0);
    expect(layout.groups.every(group=>group.width<=layout.listWidth+1&&group.scrollWidth<=group.clientWidth+1)).toBeTruthy();
    expect(Math.abs(layout.groups[0].left-layout.listLeft)).toBeLessThanOrEqual(2);
    expect(layout.tokenWidths.every(width=>width<150)).toBeTruthy();
    expect(layout.groups.every(group=>group.width>=layout.listWidth-2)).toBeTruthy();
    expect(layout.listWidth).toBeLessThanOrEqual(layout.panelWidth);
    expect(Math.abs((layout.listLeft-layout.sectionLeft)-(layout.sectionRight-layout.listRight))).toBeLessThanOrEqual(2);
  }

  const firstGroup=page.locator('.dashboard-pm-section--machine .dashboard-pm-asset-group').first();
  await activate(firstGroup.locator('.dashboard-pm-asset-toggle'),mobile);
  const title=firstGroup.locator('.dashboard-pm-task-main strong').first();
  const titleLayout=await title.evaluate(element=>({height:element.getBoundingClientRect().height,lineHeight:Number.parseFloat(getComputedStyle(element).lineHeight),scrollWidth:element.scrollWidth,clientWidth:element.clientWidth}));
  expect(titleLayout.height).toBeGreaterThan(titleLayout.lineHeight);
  expect(titleLayout.scrollWidth).toBeLessThanOrEqual(titleLayout.clientWidth+1);
  await activate(firstGroup.locator('.dashboard-pm-task-row').first(),mobile);
  await expect(page.getByRole('dialog')).toBeVisible();
});
