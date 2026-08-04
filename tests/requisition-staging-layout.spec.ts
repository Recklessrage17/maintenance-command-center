import {expect,type Page,test} from '@playwright/test';

type BatchStatus='Open'|'Ready'|'Converted'|'Closed';
type Batch={id:number;name:string;description:string;assetMachine:string;workOrderNumber:string;neededByDate:string;status:BatchStatus;isGeneral:boolean;itemCount:number;openItemCount:number;convertedItemCount:number;requisitions:Array<{id:number;requisitionNumber:string}>;createdBy:string;createdAt:string;convertedAt:string};
type Item={id:number;batchId:number;inventoryPartId:number;partNumber:string;description:string;vendor:string;supplierPartNumber:string;quantityRequested:number;unitCost:number;location:string;assetMachine:string;workOrderNumber:string;priority:'Critical'|'High'|'Normal'|'Low';notes:string;requestedBy:string;dateAdded:string;neededByDate:string;status:'Need to Order'|'Ready for Requisition'|'Requisition Created';createdRequisitionNumber?:string};

const now='2026-07-24T12:00:00Z';
function batch(id:number,name:string,isGeneral=false):Batch{return {id,name,description:`${name} fixture`,assetMachine:'Press 51',workOrderNumber:'WO-44',neededByDate:'2026-08-15',status:'Open',isGeneral,itemCount:0,openItemCount:0,convertedItemCount:0,requisitions:[],createdBy:'Layout Tester',createdAt:now,convertedAt:''};}
function item(id:number,batchId:number,partNumber:string):Item{return {id,batchId,inventoryPartId:id,partNumber,description:`${partNumber} fixture description`,vendor:'Fixture Vendor',supplierPartNumber:`SUP-${id}`,quantityRequested:2,unitCost:5,location:'Stores',assetMachine:'Press 51',workOrderNumber:'WO-44',priority:'Normal',notes:'',requestedBy:'Layout Tester',dateAdded:now,neededByDate:'2026-08-15',status:'Need to Order'};}

async function mockStaging(page:Page){
  const batches=[batch(1,'General / Unassigned',true),batch(2,'Press 51 Repair'),batch(3,'Secondary Batch')];
  const items=[item(101,2,'STG-A1'),item(102,2,'STG-A2'),item(103,3,'STG-B1')];
  let nextBatchId=10;
  let previewItemIds:number[]=[];
  const refreshCounts=()=>{
    for(const entry of batches){
      const entries=items.filter(candidate=>candidate.batchId===entry.id);
      entry.itemCount=entries.length;
      entry.openItemCount=entries.filter(candidate=>candidate.status!=='Requisition Created').length;
      entry.convertedItemCount=entries.filter(candidate=>candidate.status==='Requisition Created').length;
    }
  };
  refreshCounts();

  await page.route('**/api/auth/status',route=>route.fulfill({json:{setupRequired:false,user:{id:1,fullName:'Layout Tester',email:'layout@example.com',role:'Admin',isOwnerAdmin:true,forcePasswordChange:false}}}));
  await page.route(/\/api\/inventory\/native\/parts$/,route=>route.fulfill({json:{ok:true,parts:[]}}));
  await page.route(/\/api\/requisitions\/summary$/,route=>route.fulfill({json:{ok:true,requestedCount:0,orderedCount:0,receivedCount:0,canceledCount:0,activeCount:0}}));
  await page.route(/\/api\/requisition-batches(?:\?.*)?$/,async route=>{
    if(route.request().method()==='POST'){
      const body=route.request().postDataJSON() as Partial<Batch>;
      const created={...batch(nextBatchId++,String(body.name)),...body,id:nextBatchId-1,isGeneral:false,itemCount:0,openItemCount:0,convertedItemCount:0,requisitions:[]} as Batch;
      batches.push(created);refreshCounts();await route.fulfill({json:{ok:true,batch:created}});return;
    }
    refreshCounts();
    const view=new URL(route.request().url()).searchParams.get('view')??'active';
    await route.fulfill({json:{ok:true,batches:batches.filter(entry=>view==='completed'?['Converted','Closed'].includes(entry.status):['Open','Ready'].includes(entry.status))}});
  });
  await page.route(/\/api\/requisition-batches\/\d+$/,async route=>{
    const id=Number(route.request().url().match(/requisition-batches\/(\d+)/)?.[1]);
    const target=batches.find(entry=>entry.id===id)!;
    if(route.request().method()==='DELETE'){
      const index=batches.indexOf(target);if(index>=0)batches.splice(index,1);
      for(const entry of items.filter(candidate=>candidate.batchId===id))entry.batchId=1;
      refreshCounts();await route.fulfill({json:{ok:true,movedCount:0}});return;
    }
    const body=route.request().postDataJSON() as Partial<Batch>;Object.assign(target,body);refreshCounts();
    await route.fulfill({json:{ok:true,batch:target}});
  });
  await page.route(/\/api\/requisition-staging\/clear-selected$/,async route=>{
    const ids=(route.request().postDataJSON() as {ids:number[]}).ids;
    for(let index=items.length-1;index>=0;index-=1)if(ids.includes(items[index].id))items.splice(index,1);
    refreshCounts();await route.fulfill({json:{ok:true,removedCount:ids.length}});
  });
  await page.route(/\/api\/requisition-staging\/move$/,async route=>{
    const body=route.request().postDataJSON() as {itemIds:number[];destinationBatchId:number};
    for(const entry of items.filter(candidate=>body.itemIds.includes(candidate.id)))entry.batchId=body.destinationBatchId;
    refreshCounts();await route.fulfill({json:{ok:true,movedCount:body.itemIds.length,mergedCount:0}});
  });
  await page.route(/\/api\/requisition-staging\/preview$/,async route=>{
    previewItemIds=(route.request().postDataJSON() as {stagingItemIds:number[]}).stagingItemIds;
    await route.fulfill({json:{ok:true,token:'preview-44',previews:[{id:1,vendorName:'Fixture Vendor',lineCount:previewItemIds.length,total:10,pdfUrl:'/api/requisition-staging/previews/1/pdf'}]}});
  });
  await page.route(/\/api\/requisition-staging\/create-requisitions$/,async route=>{
    for(const entry of items.filter(candidate=>previewItemIds.includes(candidate.id))){entry.status='Requisition Created';entry.createdRequisitionNumber='REQ-44';}
    const convertedBatch=batches.find(entry=>entry.id===2);if(convertedBatch){convertedBatch.status='Converted';convertedBatch.requisitions=[{id:44,requisitionNumber:'REQ-44'}];}
    refreshCounts();await route.fulfill({json:{ok:true,requisitions:[{id:44,requisitionNumber:'REQ-44',vendorName:'Fixture Vendor',lineCount:previewItemIds.length,pdfUrl:'/api/requisitions/44/pdf'}]}});
  });
  await page.route(/\/api\/requisition-staging\/previews\/1\/pdf$/,route=>route.fulfill({contentType:'application/pdf',body:Buffer.from('%PDF-1.4\n%%EOF')}));
  await page.route(/\/api\/requisition-staging\/\d+$/,async route=>{
    const id=Number(route.request().url().match(/requisition-staging\/(\d+)/)?.[1]);
    if(route.request().method()==='DELETE'){const index=items.findIndex(entry=>entry.id===id);if(index>=0)items.splice(index,1);refreshCounts();}
    await route.fulfill({json:{ok:true}});
  });
  await page.route(/\/api\/requisition-staging(?:\?.*)?$/,route=>{
    const url=new URL(route.request().url());const batchId=Number(url.searchParams.get('batchId'));
    route.fulfill({json:{ok:true,items:items.filter(entry=>entry.batchId===batchId)}});
  });
  return {batches,items};
}

async function openBatch(page:Page,name='Press 51 Repair'){
  await page.locator('.requisition-batch-card').filter({hasText:name}).click();
  await expect(page.locator('.active-requisition-batch-heading')).toContainText(name);
}

async function layoutSnapshot(page:Page){
  return page.evaluate(()=>{
    const section=document.querySelector<HTMLElement>('.staging-list-card')!;
    const controls=document.querySelector<HTMLElement>('.requisition-batch-view-pills')!;
    const buttons=[...controls.querySelectorAll<HTMLElement>('button')];
    const firstCard=document.querySelector<HTMLElement>('.requisition-batch-card')!;
    const visibleChildren=[...section.children].filter((child):child is HTMLElement=>child instanceof HTMLElement&&getComputedStyle(child).display!=='none').map(child=>child.getBoundingClientRect()).sort((a,b)=>a.top-b.top);
    const controlRect=controls.getBoundingClientRect();
    const cardRect=firstCard.getBoundingClientRect();
    const sectionStyle=getComputedStyle(section);
    const controlsStyle=getComputedStyle(controls);
    return {
      buttonHeights:buttons.map(button=>button.getBoundingClientRect().height),
      controlsToCardGap:cardRect.top-controlRect.bottom,
      largestChildGap:Math.max(0,...visibleChildren.slice(1).map((rect,index)=>rect.top-visibleChildren[index].bottom)),
      sectionHeight:section.getBoundingClientRect().height,
      sectionScrollHeight:section.scrollHeight,
      sectionAlignContent:sectionStyle.alignContent,
      sectionGridAutoRows:sectionStyle.gridAutoRows,
      controlsAlignSelf:controlsStyle.alignSelf,
      controlsFlexGrow:controlsStyle.flexGrow,
      controlsHeight:controlRect.height,
      documentOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
    };
  });
}

async function expectStableLayout(page:Page){
  const layout=await layoutSnapshot(page);
  expect(Math.max(...layout.buttonHeights)).toBeLessThan(56);
  expect(Math.max(...layout.buttonHeights)-Math.min(...layout.buttonHeights)).toBeLessThanOrEqual(3);
  expect(layout.controlsToCardGap).toBeGreaterThanOrEqual(6);
  expect(layout.controlsToCardGap).toBeLessThanOrEqual(32);
  expect(layout.largestChildGap).toBeLessThanOrEqual(40);
  expect(layout.sectionHeight-layout.sectionScrollHeight).toBeLessThanOrEqual(4);
  expect(layout.sectionAlignContent).toBe('start');
  expect(layout.sectionGridAutoRows).toBe('max-content');
  expect(layout.controlsAlignSelf).toBe('start');
  expect(layout.controlsFlexGrow).toBe('0');
  expect(layout.documentOverflow).toBeLessThanOrEqual(0);
  return layout;
}

test('keeps staging controls and batch cards intrinsic immediately after deleting an item',async({page})=>{
  await mockStaging(page);
  await page.goto('/requisitions');
  await openBatch(page);
  const before=await expectStableLayout(page);
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('tr',{hasText:'STG-A1'}).getByRole('button',{name:'Remove'}).click();
  await expect(page.getByText('STG-A1 removed from the staging list.')).toBeVisible();
  await expect(page.locator('tr',{hasText:'STG-A1'})).toHaveCount(0);
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('tr',{hasText:'STG-A2'}).getByRole('button',{name:'Remove'}).click();
  await expect(page.getByText('STG-A2 removed from the staging list.')).toBeVisible();
  await expect(page.getByText('No staged items in this batch.')).toBeVisible();
  const after=await expectStableLayout(page);
  expect(Math.abs(after.buttonHeights[0]-before.buttonHeights[0])).toBeLessThanOrEqual(2);
});

test('keeps mutation refreshes compact through clear, move, create, edit, and delete batch actions',async({page})=>{
  await mockStaging(page);
  await page.goto('/requisitions');
  await openBatch(page);

  await page.getByLabel('Select staged STG-A1').check();
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Clear Selected Items'}).click();
  await expect(page.getByText('Removed 1 item from the staging list.')).toBeVisible();
  await expectStableLayout(page);

  await page.getByLabel('Select staged STG-A2').check();
  await page.getByRole('button',{name:'Move to Batch'}).click();
  const moveDialog=page.getByRole('dialog',{name:'Move to Batch'});
  await moveDialog.getByRole('button',{name:/Secondary Batch/}).click();
  await moveDialog.getByRole('button',{name:'Move Selected Items'}).click();
  await expect(page.getByText('1 item moved to Secondary Batch.')).toBeVisible();
  await expectStableLayout(page);

  await page.getByRole('button',{name:'Create Requisition Batch'}).click();
  let editor=page.locator('form').filter({has:page.getByRole('heading',{name:'Create Requisition Batch'})});
  await editor.getByLabel('Batch Name').fill('Mutation Batch');
  await editor.getByRole('button',{name:'Create Requisition Batch'}).click();
  await expect(page.getByText(/Mutation Batch.*created/)).toBeVisible();
  await expectStableLayout(page);

  await page.getByRole('button',{name:'Edit Batch'}).click();
  editor=page.locator('form').filter({has:page.getByRole('heading',{name:'Edit Requisition Batch'})});
  await editor.getByLabel('Batch Name').fill('Mutation Batch Edited');
  await editor.getByRole('button',{name:'Save Batch Changes'}).click();
  await expect(page.getByText(/Mutation Batch Edited.*updated/)).toBeVisible();
  await expectStableLayout(page);

  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Delete Batch'}).click();
  await expect(page.getByText('Mutation Batch Edited deleted.')).toBeVisible();
  await expectStableLayout(page);
});

test('keeps empty, populated, converted, tablet, mobile, and zoom-equivalent layouts compact',async({page},testInfo)=>{
  await mockStaging(page);
  await page.goto('/requisitions');
  await openBatch(page);
  await page.getByRole('button',{name:'Select Visible'}).click();
  await page.getByRole('button',{name:'Preview Requisition'}).click();
  const review=page.locator('form.staging-review-modal');
  await review.getByLabel('P.O. Initiator').fill('Layout Tester');
  await review.getByLabel('Tax Exempt').selectOption('No');
  await review.getByRole('button',{name:'Generate PDF Preview'}).click();
  await review.getByRole('button',{name:'Confirm & Create Requisition'}).click();
  await expect(review.getByText('Official requisitions created')).toBeVisible();
  await review.getByRole('button',{name:'Done'}).click();
  await expect(page.getByText('Created 1 official vendor requisition from staged items.')).toBeVisible();
  await expectStableLayout(page);

  const viewports=testInfo.project.name==='mobile-chromium'
    ?[{width:390,height:844}]
    :[{width:1440,height:900},{width:1152,height:720},{width:960,height:650},{width:820,height:900}];
  for(const viewport of viewports){
    await page.setViewportSize(viewport);
    await expectStableLayout(page);
  }
});
