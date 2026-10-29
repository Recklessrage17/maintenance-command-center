import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {backendFixture,owner,request,root} from './helpers/security-process.mjs';

for(const manager of [false,true])test(`Patch 1 real ${manager?'manager':'owner'} session defaults creator across vendor groups and rejects another session`,async({page},info)=>{
  test.setTimeout(150000);
  const runtime=await backendFixture('p1-ui',{}, {serveFrontend:true});
  try {
    fs.cpSync(path.join(root,'backend/templates'),path.join(runtime.appRoot,'backend/templates'),{recursive:true});
    const ownerCookie=await owner(runtime.base);
    const post=async(url:string,body:unknown,cookie=ownerCookie)=>{
      const r=await request(runtime.base,url,{method:'POST',cookie,body});expect(r.response.ok,JSON.stringify(r.data)).toBe(true);return r;
    };
    const temporaryPassword='Synthetic-Temporary!91';const password='Synthetic-Permanent!92';
    await post('/api/users',{fullName:'Synthetic Manager',email:'manager@example.test',role:'Manager',temporaryPassword});
    let second=await post('/api/auth/login',{email:'manager@example.test',password:temporaryPassword},'');
    const secondCookie=second.cookie;
    await post('/api/auth/change-password',{currentPassword:temporaryPassword,newPassword:password,confirmPassword:password},secondCookie);
    second=await post('/api/auth/login',{email:'manager@example.test',password},'');
    const cookie=manager?second.cookie:ownerCookie;
    const other=manager?ownerCookie:second.cookie;
    const fullName=manager?'Synthetic Manager':'Local Security Owner';
    const batch=(await post('/api/requisition-batches',{name:'Synthetic grouped review'},cookie)).data.batch;
    for(const [i,vendor,unitCost] of [[1,'Synthetic Low Vendor',5],[2,'Synthetic High Vendor',125]] as const){
      await post('/api/requisition-staging',{batchId:batch.id,partNumber:`GROUP-${i}`,description:'Synthetic grouped item',vendor,quantityRequested:1,unitCost,priority:'Normal',status:'Need to Order'},cookie);
    }
    const separator=cookie.indexOf('=');
    await page.context().addCookies([{name:cookie.slice(0,separator),value:cookie.slice(separator+1),url:runtime.base,httpOnly:true,sameSite:'Lax'}]);
    await page.goto(`${runtime.base}/requisitions?batch=${batch.id}`);
    await page.getByRole('button',{name:'Select Visible'}).click();
    await page.getByRole('button',{name:'Preview Requisition',exact:true}).click();
    const form=page.locator('form.staging-review-modal');
    await expect(form.getByLabel('P.O. Initiator')).toHaveValue(fullName);
    await form.getByLabel('Tax Exempt').selectOption('No');
    const previewResponse=page.waitForResponse(r=>r.url().endsWith('/api/requisition-staging/preview')&&r.request().method()==='POST');
    await form.getByRole('button',{name:'Generate PDF Preview'}).click();
    const preview=await (await previewResponse).json();
    expect(preview.previews).toHaveLength(2);
    expect(preview.previews.map((p:any)=>p.total).sort((a:number,b:number)=>a-b)).toEqual([5,125]);
    for(const entry of preview.previews){
      const unauthorized=await fetch(runtime.base+entry.pdfUrl,{headers:{Cookie:other}});
      expect(unauthorized.status).toBeGreaterThanOrEqual(400);
    }
    const wrongSession=await request(runtime.base,'/api/requisition-staging/create-requisitions',{method:'POST',cookie:other,body:{token:preview.token}});
    expect(wrongSession.response.ok).toBe(false);
    await expect(page.locator('#staging-requisition-preview-frame')).toHaveAttribute('src',/^blob:/,{timeout:60000});
    await page.screenshot({path:info.outputPath('actual-pdf-preview.png'),fullPage:true});
    const downloadEvent=page.waitForEvent('download');
    await form.getByRole('button',{name:'Download Preview'}).click();
    const download=await downloadEvent;await download.saveAs(info.outputPath('downloaded-preview.pdf'));
    expect(fs.readFileSync(info.outputPath('downloaded-preview.pdf')).subarray(0,5).toString()).toBe('%PDF-');
    // Keep native print invocation within the synthetic browser; observe the
    // button's target without sending paper to a workstation printer.
    await page.evaluate(()=>{
      const frame=document.querySelector<HTMLIFrameElement>('#staging-requisition-preview-frame')!;
      (window as any).__printCount=0;frame.contentWindow!.print=()=>{(window as any).__printCount++;};
    });
    await form.getByRole('button',{name:'Print Preview'}).click();
    expect(await page.evaluate(()=>(window as any).__printCount)).toBe(1);
    const confirmation=page.waitForResponse(r=>r.url().endsWith('/api/requisition-staging/create-requisitions')&&r.request().method()==='POST');
    await form.getByRole('button',{name:'Confirm & Create Requisition'}).click();
    const created=await (await confirmation).json();expect(created.requisitions).toHaveLength(2);
    for(const entry of created.requisitions){
      const stored=await request(runtime.base,`/api/requisitions/${entry.id}`,{cookie});
      expect(stored.data.requisition.poInitiator).toBe(fullName);
      expect(stored.data.requisition.taxExempt).toBe('No');
      expect(stored.data.requisition.requestedByName).toBe(fullName);
    }
    await page.reload();await expect(page.getByRole('heading',{name:'Requisitions',exact:true}).first()).toBeVisible();
    const replay=await request(runtime.base,'/api/requisition-staging/create-requisitions',{method:'POST',cookie,body:{token:preview.token}});
    expect(replay.response.ok).toBe(false);
    await post('/api/inventory/native/parts',{partNumber:'SYNTHETIC-INVENTORY',description:'Synthetic inventory review',location:'QA Stores',vendor:'Synthetic Inventory Vendor',quantity:1,minQuantity:2,unitCost:5},cookie);
    await page.goto(`${runtime.base}/inventory`);
    await page.locator('tr',{hasText:'SYNTHETIC-INVENTORY'}).getByRole('button',{name:'Select',exact:true}).click();
    const inventoryControls=page.locator('details.mobile-inventory-controls');
    if(await inventoryControls.isVisible()&&await inventoryControls.getAttribute('open')===null)await inventoryControls.locator('summary').click();
    await page.getByRole('button',{name:'Preview Requisition',exact:true}).click();
    const inventoryReview=page.locator('form.inventory-modal').filter({has:page.getByLabel('P.O. Initiator')});
    await expect(inventoryReview.getByLabel('P.O. Initiator')).toHaveValue(fullName);
    await inventoryReview.getByLabel('P.O. Initiator').fill('Authorized Inventory Edit');
    await inventoryReview.getByLabel('Tax Exempt').selectOption('Yes');
    await inventoryReview.getByLabel('Line Notes').fill('Synthetic rerender');
    await expect(inventoryReview.getByLabel('P.O. Initiator')).toHaveValue('Authorized Inventory Edit');
    await expect(inventoryReview.getByLabel('Tax Exempt')).toHaveValue('Yes');
    await inventoryReview.getByRole('button',{name:'Close',exact:true}).click();
    await request(runtime.base,'/api/auth/logout',{method:'POST',cookie});
    expect((await request(runtime.base,'/api/requisitions',{cookie})).response.status).toBe(401);
  } finally {await runtime.close();}
});
