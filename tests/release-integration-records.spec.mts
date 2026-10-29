import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {backendFixture,owner,request} from './helpers/security-process.mjs';
import {PDFDocument,StandardFonts} from '../backend/node_modules/pdf-lib/cjs/index.js';

for(const library of ['machine','equipment'] as const) test(`integrated ${library} real resolution, PDF preview/download/print and saved history preserve captured pages`,async({page},info)=>{
  test.setTimeout(90_000);
  const runtime=await backendFixture('release-records',{}, {serveFrontend:true});
  const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
  try {
    const cookie=await owner(runtime.base);
    const send=async(url:string,body:unknown)=>{
      const r=await request(runtime.base,url,{method:'POST',cookie,body});
      expect(r.response.ok,JSON.stringify(r.data)).toBe(true);return r.data;
    };
    const assetNumber=`SYNTHETIC-${library.toUpperCase()}`;
    const asset=(await send(`/api/${library}-library/assets`,library==='machine'
      ?{assetNumber,assetName:'Synthetic release press',brand:'MCC',status:'active'}
      :{assetNumber,equipmentName:'Synthetic release dryer',category:'Dryer',status:'active'})).asset;
    const photo=await PDFDocument.create();const font=await photo.embedFont(StandardFonts.Helvetica);
    photo.addPage([400,500]).drawText('SYNTHETIC CAPTURED WORK ORDER PAGE',{x:25,y:450,size:13,font});
    const captured=await photo.save();
    async function create(title:string) {
      const form=new FormData();
      for(const [key,value]of Object.entries({title,noteDate:'2026-01-15',body:'Synthetic inspection and maintenance only.',warning:'true',workOrder:`QA-${title}`}))form.append(key,value);
      form.append('attachmentSources',JSON.stringify(['work_order_photo']));
      form.append('attachments',new Blob([captured],{type:'application/pdf'}),'synthetic-captured.pdf');
      return (await send(`/api/${library}-library/assets/${asset.id}/notes`,form)).note;
    }
    const historical=await create('Previously saved record');
    Object.assign(historical,(await send(`/api/${library}-library/asset-notes/${historical.id}/resolve`,{resolutionSummary:'Earlier synthetic repair verified.'})).note);
    const pdfBytes=async(url:string)=>{
      const response=await fetch(runtime.base+url,{headers:{Cookie:cookie}});
      expect(response.status).toBe(200);expect(response.headers.get('content-type')).toContain('application/pdf');
      return Buffer.from(await response.arrayBuffer());
    };
    const historicalBefore=await pdfBytes(historical.pdfUrl);
    const fresh=await create('New release record');
    await page.context().addCookies([{name:'mcc_session',value:cookie.slice(cookie.indexOf('=')+1),url:runtime.base}]);
    await page.addInitScript(()=>{
      (window as any).__releasePrintTargets=[];
      window.open=((url?:string|URL)=>{(window as any).__releasePrintTargets.push(String(url));return null;}) as typeof window.open;
    });
    await page.goto(`${runtime.base}/${library}-library?asset=${asset.id}`);
    await page.getByRole('button',{name:/Work Orders & Notes/}).click();
    const card=page.locator('.asset-note-active-issue-card',{hasText:fresh.title});
    await card.locator('.asset-note-issue-toggle').click();
    await card.getByRole('button',{name:'Issue is Resolved',exact:true}).click();
    await card.getByLabel('Resolution Summary *').fill('Synthetic repair verified at 650°F; returned to service.');
    const resolutionResponse=page.waitForResponse(r=>r.url().endsWith(`/asset-notes/${fresh.id}/resolve`)&&r.request().method()==='POST');
    await card.getByRole('button',{name:'Confirm Resolution',exact:true}).click();
    Object.assign(fresh,(await (await resolutionResponse).json()).note);
    await page.getByRole('alertdialog',{name:'Print / save the Maintenance Record PDF now?'}).getByRole('button',{name:'Yes',exact:true}).click();
    const viewer=page.getByRole('dialog',{name:`${fresh.pdfFilename} viewer`});
    await expect(viewer).toBeVisible();await expect(viewer.locator('object')).toHaveAttribute('data',fresh.pdfUrl);
    const downloadEvent=page.waitForEvent('download');
    await viewer.getByRole('button',{name:'Download',exact:true}).click();
    const download=await downloadEvent;const file=info.outputPath(`${library}-resolved.pdf`);await download.saveAs(file);
    const resolved=fs.readFileSync(file);expect((await PDFDocument.load(resolved)).getPageCount()).toBe(2);
    const layout=JSON.parse(execFileSync(process.env.PYTHON||'python',['-B','tests/helpers/inspect-maintenance-pdf.py',file],{encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024}));
    expect(layout.pages[0].text).toContain('Synthetic repair verified at 650°F');
    expect(layout.pages[1].text).toContain('SYNTHETIC CAPTURED WORK ORDER PAGE');
    for(const [i,p] of layout.pages.entries())await info.attach(`resolved-page-${i+1}`,{path:p.image,contentType:'image/png'});
    await viewer.getByRole('button',{name:'Print',exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>(window as any).__releasePrintTargets)).toContain(fresh.pdfUrl);
    await viewer.getByRole('button',{name:'Close',exact:true}).first().click();
    await page.reload();await page.getByRole('button',{name:/Work Orders & Notes/}).click();
    await page.getByRole('button',{name:/Work Order History/}).click();
    const history=page.getByRole('dialog',{name:`Resolved History for ${assetNumber}`});
    await history.getByRole('button',{name:/2026.*2 resolved issues/}).click();
    for(const note of [historical,fresh]){
      const trigger=history.getByRole('button',{name:`More actions for ${note.title}`});
      await trigger.click();await page.getByRole('menu',{name:`More actions for ${note.title}`}).getByRole('menuitem',{name:'Print Maintenance Record',exact:true}).click();
      await expect.poll(()=>page.evaluate(()=>(window as any).__releasePrintTargets)).toContain(note.pdfUrl);
    }
    expect(hash(await pdfBytes(historical.pdfUrl))).toBe(hash(historicalBefore));
    expect(hash(await pdfBytes(fresh.pdfUrl))).toBe(hash(resolved));
    const list=await request(runtime.base,`/api/${library}-library/assets/${asset.id}/notes`,{cookie});
    for(const note of list.data.notes)expect(note.workOrderPages[0].sha256).toBe(hash(captured));
    await page.screenshot({path:info.outputPath('persisted-record-history.png'),fullPage:true});
    await info.attach('resolved-maintenance-record',{path:file,contentType:'application/pdf'});
  } finally {await runtime.close();}
});
