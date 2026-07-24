import {expect,type Page,test} from '@playwright/test';
import {formatElapsedStatusAge} from '../frontend/src/components/MccStatusAge';

type Status='Requested'|'Ordered'|'Received'|'Canceled';
type Line={id:number;inventoryPartId:number;partNumber:string;description:string;vendorName:string;locationName:string;quantityRequested:number;unitCost:number;totalCost:number;unitOfMeasure:string;itemNumber:string;notes:string};
type Requisition={
  id:number;requisitionNumber:string;inventoryPartId:number;partNumber:string;description:string;vendorName:string;locationName:string;quantityRequested:number;
  lineCount:number;firstPartNumber:string;firstDescription:string;totalQuantity:number;totalCost:number;vendorSummary:string;locationSummary:string;partNumbers:string[];descriptions:string[];lines:Line[];
  status:Status;requestedByName:string;requestedAt:string;orderedAt:string|null;receivedAt:string|null;canceledAt:string|null;workOrderNumber:string;notes:string;cancelReason:string;deleted:boolean;deletedAt:null;
};

function daysAgo(days:number){return new Date(Date.now()-days*86_400_000).toISOString();}
function lines(seed:number):Line[]{return Array.from({length:4},(_,index)=>({id:seed*10+index,inventoryPartId:seed*10+index,partNumber:`PART-${seed}-${index+1}`,description:`Fixture description ${index+1}`,vendorName:'Fixture Vendor',locationName:'Stores',quantityRequested:index+1,unitCost:2,totalCost:(index+1)*2,unitOfMeasure:'EA',itemNumber:`ITEM-${index+1}`,notes:''}));}
function requisition(id:number,status:Status):Requisition{
  const requisitionLines=lines(id);
  return {
    id,requisitionNumber:`REQ-${id}`,inventoryPartId:id,partNumber:requisitionLines[0].partNumber,description:requisitionLines[0].description,vendorName:'Fixture Vendor',locationName:'Stores',quantityRequested:10,
    lineCount:4,firstPartNumber:requisitionLines[0].partNumber,firstDescription:requisitionLines[0].description,totalQuantity:10,totalCost:20,vendorSummary:'Fixture Vendor',locationSummary:'Stores',partNumbers:requisitionLines.map(line=>line.partNumber),descriptions:requisitionLines.map(line=>line.description),lines:requisitionLines,
    status,requestedByName:'Requisition Tester',requestedAt:daysAgo(8),orderedAt:status==='Ordered'||status==='Received'?daysAgo(2):null,receivedAt:status==='Received'?daysAgo(1):null,canceledAt:status==='Canceled'?daysAgo(1):null,workOrderNumber:'WO-41',notes:'Fixture notes',cancelReason:status==='Canceled'?'No longer required':'',deleted:false,deletedAt:null,
  };
}
function summary(rows:Requisition[]){
  const count=(status:Status)=>rows.filter(row=>row.status===status).length;
  return {requestedCount:count('Requested'),orderedCount:count('Ordered'),receivedCount:count('Received'),canceledCount:count('Canceled'),activeCount:count('Requested')+count('Ordered')};
}

test('formats status ages with calendar-aware singular, plural, month, year, and safe fallback values',()=>{
  const now=new Date(2026,6,24,12);
  const stamp=(year:number,month:number,day:number)=>new Date(year,month,day,12).toISOString();
  expect(formatElapsedStatusAge(stamp(2026,6,24),now)).toBe('today');
  expect(formatElapsedStatusAge(stamp(2026,6,23),now)).toBe('1 day ago');
  expect(formatElapsedStatusAge(stamp(2026,6,16),now)).toBe('8 days ago');
  expect(formatElapsedStatusAge(stamp(2026,4,20),now)).toBe('2 mos 4 days ago');
  expect(formatElapsedStatusAge(stamp(2025,3,24),now)).toBe('1 yr 3 mos ago');
  expect(formatElapsedStatusAge(stamp(2026,7,1),now)).toBe('date unavailable');
  expect(formatElapsedStatusAge('not-a-date',now)).toBe('date unavailable');
});

async function mockRequisitions(page:Page,{failReceiveId=0}:{failReceiveId?:number}={}){
  const rows=[requisition(101,'Requested'),requisition(102,'Ordered'),requisition(103,'Received'),requisition(104,'Canceled')];
  const originalRequestedAt=rows[0].requestedAt;
  let editPreserved=false;
  await page.route('**/api/auth/status',route=>route.fulfill({json:{setupRequired:false,user:{id:1,fullName:'Requisition Tester',email:'requisition@example.com',role:'Admin',isOwnerAdmin:true,forcePasswordChange:false}}}));
  await page.route(/\/api\/inventory\/native\/parts$/,route=>route.fulfill({json:{ok:true,parts:[]}}));
  await page.route(/\/api\/requisitions(?:\?.*)?$/,route=>{
    const url=new URL(route.request().url());
    const filter=url.searchParams.get('status');
    const visible=!filter?rows.filter(row=>row.status==='Requested'||row.status==='Ordered'):filter==='all'?rows:rows.filter(row=>row.status===filter);
    return route.fulfill({json:{ok:true,requisitions:visible,summary:summary(rows)}});
  });
  await page.route(/\/api\/requisitions\/\d+\/status$/,async route=>{
    const id=Number(route.request().url().match(/requisitions\/(\d+)\/status/)?.[1]);
    const body=route.request().postDataJSON() as {status:Status};
    if(id===failReceiveId&&body.status==='Received'){await route.fulfill({status:500,json:{error:'Simulated receive failure'}});return;}
    const row=rows.find(item=>item.id===id)!;
    row.status=body.status;
    if(body.status==='Ordered'&&!row.orderedAt)row.orderedAt=new Date().toISOString();
    if(body.status==='Received'&&!row.receivedAt)row.receivedAt=new Date().toISOString();
    if(body.status==='Canceled'&&!row.canceledAt)row.canceledAt=new Date().toISOString();
    await route.fulfill({json:{ok:true,requisition:row,summary:summary(rows)}});
  });
  await page.route(/\/api\/requisitions\/\d+$/,async route=>{
    const id=Number(route.request().url().match(/requisitions\/(\d+)$/)?.[1]);
    const row=rows.find(item=>item.id===id)!;
    if(route.request().method()==='PATCH'){
      const body=route.request().postDataJSON() as {workOrderNumber:string;notes:string};
      row.workOrderNumber=body.workOrderNumber;
      row.notes=body.notes;
      editPreserved=row.requestedAt===originalRequestedAt;
      await route.fulfill({json:{ok:true,requisition:row}});
      return;
    }
    await route.fulfill({json:{ok:true,requisition:row}});
  });
  return {rows,originalRequestedAt,editPreserved:()=>editPreserved};
}

async function openGroupedItems(page:Page,mobile:boolean){
  const trigger=page.getByRole('button',{name:'Multiple items (4)'}).first();
  if(mobile)await trigger.tap();else await trigger.hover();
  const panel=page.getByRole('dialog',{name:'Multiple items (4) details'});
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('columnheader',{name:'Part #'})).toBeVisible();
  await expect(panel.getByRole('columnheader',{name:'Qty'})).toBeVisible();
  await expect(panel.getByRole('columnheader',{name:'Description'})).toBeVisible();
  await expect(panel.locator('tbody tr')).toHaveCount(4);
  return {trigger,panel};
}

test('shows lifecycle ages and grouped-item hover, keyboard, tap, and view coverage',async({page},testInfo)=>{
  const mobile=testInfo.project.name==='mobile-chromium';
  await mockRequisitions(page);
  await page.goto('/requisitions?view=active');
  await expect(page.getByText('Requested 8 days ago',{exact:true})).toBeVisible();
  await expect(page.getByText('Ordered 2 days ago',{exact:true})).toBeVisible();

  for(const view of ['Active','Requested','Ordered','Received','All']){
    await page.getByRole('button',{name:view,exact:true}).click();
    const expectedId=view==='Ordered'?102:view==='Received'?103:101;
    await expect(page.getByText(`REQ-${expectedId}`,{exact:true})).toBeVisible();
    const {trigger,panel}=await openGroupedItems(page,mobile);
    expect(await panel.locator('tbody tr').evaluateAll(rows=>rows.map(row=>[...row.children].map(cell=>cell.textContent?.trim())))).toEqual([
      [`PART-${expectedId}-1`,'1','Fixture description 1'],
      [`PART-${expectedId}-2`,'2','Fixture description 2'],
      [`PART-${expectedId}-3`,'3','Fixture description 3'],
      [`PART-${expectedId}-4`,'4','Fixture description 4'],
    ]);
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }

  const trigger=page.getByRole('button',{name:'Multiple items (4)'}).first();
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog',{name:'Multiple items (4) details'})).toBeVisible();
  await page.keyboard.press('Escape');
  await trigger.focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('dialog',{name:'Multiple items (4) details'})).toBeVisible();
  await page.locator('.requisition-search input').click();
  await expect(page.getByRole('dialog',{name:'Multiple items (4) details'})).toHaveCount(0);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('preserves requested time through edit, resets Ordered age, celebrates successful receive once, and removes waiting age from Received',async({page})=>{
  const fixture=await mockRequisitions(page);
  await page.goto('/requisitions?view=active');
  await expect(page.getByText('Requested 8 days ago',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Edit',exact:true}).first().click();
  const editor=page.locator('form.requisition-modal');
  await editor.getByLabel('Notes').fill('Edited without resetting status time');
  await editor.getByRole('button',{name:'Save Changes'}).click();
  await expect.poll(fixture.editPreserved).toBeTruthy();
  expect(fixture.rows[0].requestedAt).toBe(fixture.originalRequestedAt);
  await expect(page.getByText('Requested 8 days ago',{exact:true})).toBeVisible();

  await page.getByRole('button',{name:'Mark Ordered'}).click();
  await expect(page.getByText('Ordered today',{exact:true})).toBeVisible();
  expect(fixture.rows[0].requestedAt).toBe(fixture.originalRequestedAt);
  expect(fixture.rows[0].orderedAt).not.toBeNull();

  await page.getByRole('button',{name:'Mark Received'}).first().click();
  await expect(page.getByRole('button',{name:'Received ✓'})).toBeVisible();
  await expect(page.locator('.mcc-success-burst')).toHaveCount(1);
  await expect(page.getByText('REQ-101',{exact:true})).toHaveCount(0,{timeout:2500});
  await expect(page.locator('.mcc-success-burst')).toHaveCount(0);
  await page.getByRole('button',{name:'Received',exact:true}).click();
  const receivedRow=page.locator('tr').filter({hasText:'REQ-101'});
  await expect(receivedRow).toBeVisible();
  await expect(receivedRow.locator('.mcc-status-age')).toHaveCount(0);
  expect(fixture.rows[0].receivedAt).not.toBeNull();
});

test('uses industrial workflow states and never celebrates a failed or reduced-motion receive with moving particles',async({page},testInfo)=>{
  const fixture=await mockRequisitions(page,{failReceiveId:101});
  await page.goto('/requisitions?view=active');
  const staging=page.getByRole('button',{name:'Requisition Staging'});
  const active=page.getByRole('button',{name:'Active',exact:true});
  await expect(active).toHaveAttribute('aria-pressed','true');
  await expect(staging).toHaveClass(/mcc-industrial-button/);
  const inactiveAppearance=await staging.evaluate(element=>({background:getComputedStyle(element).backgroundImage,border:getComputedStyle(element).borderColor}));
  expect(inactiveAppearance.background).toContain('linear-gradient');
  expect(inactiveAppearance.border).not.toBe('rgb(68, 215, 255)');

  for(const [view,expectedClass] of [['Ordered','workflow-ordered'],['Received','workflow-received'],['Canceled','workflow-canceled']] as const){
    const button=page.getByRole('button',{name:view,exact:true});
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed','true');
    await expect(button).toHaveClass(new RegExp(`${expectedClass}.*active`));
    const selectedAppearance=await button.evaluate(element=>({background:getComputedStyle(element).backgroundImage,boxShadow:getComputedStyle(element).boxShadow}));
    expect(selectedAppearance.background).not.toBe(inactiveAppearance.background);
    expect(selectedAppearance.boxShadow).not.toContain('rgba(0, 0, 0, 0.16)');
  }

  await active.click();
  await page.getByRole('button',{name:'Mark Received'}).first().click();
  await expect(page.getByText('Simulated receive failure')).toBeVisible();
  await expect(page.locator('.mcc-success-burst')).toHaveCount(0);
  expect(fixture.rows[0].status).toBe('Requested');

  const actionLayout=await page.locator('.requisition-row-actions').first().evaluate(element=>({direction:getComputedStyle(element).flexDirection,scrollWidth:element.scrollWidth,clientWidth:element.clientWidth}));
  expect(actionLayout.direction).toBe('row');
  expect(actionLayout.scrollWidth).toBeLessThanOrEqual(actionLayout.clientWidth+1);

  if(testInfo.project.name==='desktop-chromium'){
    await page.emulateMedia({reducedMotion:'reduce'});
    fixture.rows[0].id=105;
    await page.unroute(/\/api\/requisitions\/\d+\/status$/);
    await page.route(/\/api\/requisitions\/\d+\/status$/,async route=>{
      const row=fixture.rows[0];row.status='Received';row.receivedAt=new Date().toISOString();
      await route.fulfill({json:{ok:true,requisition:row,summary:summary(fixture.rows)}});
    });
    await page.reload();
    await page.getByRole('button',{name:'Mark Received'}).first().click();
    await expect(page.locator('.mcc-success-burst')).toHaveCount(1);
    expect(await page.locator('.mcc-success-burst > span').first().evaluate(element=>getComputedStyle(element).display)).toBe('none');
  }
});
