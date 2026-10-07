import { expect, type Page, test as base } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const pdfBytes=Buffer.from('%PDF-1.4\n%%EOF');
const test=base.extend<{attachmentServer:string}>({
  attachmentServer:async({},use)=>{
    // Serve real bytes because Chromium cancels downloads fulfilled by page.route.
    const server=createServer((_request,response)=>{
      response.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="attachment.pdf"'});
      response.end(pdfBytes);
    });
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    const address=server.address() as {port:number};
    try { await use(`http://127.0.0.1:${address.port}`); }
    finally { await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())); }
  },
});

type Library = 'machine' | 'equipment';
type Status = 'ordinary' | 'active' | 'hold' | 'resolved';
const asset = {
  id:181, assetNumber:'ASSET-181', assetName:'Summary Press', equipmentName:'Summary Dryer',
  brand:'MCC', manufacturer:'MCC', model:'181', serialNumber:'SN181', machineYear:'2026',
  equipmentYear:'2026', year:'2026', category:'Dryer', equipmentType:'Dryer', location:'North',
  machineType:'Injection Molding Machine', powerType:'Electric', setupType:'Standard Injection',
  screwInstalledDate:'', screwTipInstalledDate:'', barrelInstalledDate:'', barrelEndCapInstalledDate:'',
  department:'Molding', status:'active', brandColorHex:'#44D7FF', historyPreview:[],
  createdAt:'2026-10-07T12:00:00Z', updatedAt:'2026-10-07T12:00:00Z',
  criticality:'high', voltage:'480', phase:'3', amperage:'42', airRequirement:'', waterRequirement:'',
  capacityRating:'500', dimensions:'48', weight:'825', specificationNotes:'',
};

function note(library:Library, id:number, status:Status) {
  return {
    id, assetId:181, title:`Summary record ${id}`, noteDate:'2026-10-07', body:'Saved summary fixture.',
    warning:status!=='ordinary', hold:status==='hold',
    // Ordinary legacy notes need no explicit status to remain unresolved.
    status:status==='ordinary'?undefined:status==='hold'?'active':status,
    workOrder:`WO-${id}`, createdBy:'Summary Tester', createdAt:'2026-10-07T12:00:00Z',
    updatedAt:'2026-10-07T12:00:00Z', resolvedAt:status==='resolved'?'2026-10-07T13:00:00Z':null,
    resolvedYear:status==='resolved'?'2026':'', resolvedBy:'Summary Tester', resolutionSummary:'Verified repair.',
    pdfFilename:`note-${id}.pdf`, pdfUrl:`/api/${library}-library/asset-notes/${id}/pdf`,
    pdfDownloadUrl:`/api/${library}-library/asset-notes/${id}/pdf?download=true`,
    attachments:[{
      id, noteId:id, filename:`attachment-${id}.pdf`, mimeType:'application/pdf', fileSize:100,
      createdAt:'2026-10-07T12:00:00Z', contentUrl:`/api/${library}-library/asset-note-attachments/${id}/file`,
      downloadUrl:`/api/${library}-library/asset-note-attachments/${id}/file?download=true`,
    }],
    updates:[], lifecycle:[],
    permissions:{canEdit:false,canDelete:false,canResolve:false,canReopen:false,canAddUpdate:false,canDeleteAttachments:false},
  };
}

async function mockLibrary(page:Page, library:Library, state:{notes:ReturnType<typeof note>[]}) {
  await page.route('**/api/auth/status', route=>route.fulfill({json:{setupRequired:false,user:{
    id:1, fullName:'Summary Tester', email:'summary@example.com', role:'Admin', isOwnerAdmin:true,
    forcePasswordChange:false,
  }}}));
  const base=`/api/${library}-library/assets`;
  await page.route(new RegExp(`${base}(?:\\?.*)?$`), route=>route.fulfill({json:{
    ok:true, assets:[asset], categories:['Dryer'], brandSettings:[], permissions:{canEdit:true,canDelete:true},
  }}));
  await page.route(new RegExp(`${base}/181/(history|component-images|inspection-records)$`),
    route=>route.fulfill({json:{ok:true,records:[],images:[]}}));
  await page.route(new RegExp(`${base}/181/(document-folders|documents)$`),
    route=>route.fulfill({json:{ok:true,folders:[],documents:[]}}));
  await page.route(new RegExp(`${base}/181/preventive-maintenance$`), route=>route.fulfill({json:{
    ok:true,tasks:[],summary:{total:1,dueSoon:0,overdue:0,nextDueDate:null,nextDueMeter:null},
  }}));
  await page.route(new RegExp(`${base}/181/notes$`), route=>route.fulfill({json:{
    ok:true,notes:state.notes,permissions:{canCreate:true,canExportWorkOrderRecords:false},
  }}));
  await page.route(new RegExp(`/api/${library}-library/asset-note-attachments/\\d+/file(?:\\?.*)?$`),
    route=>route.fulfill({contentType:'application/pdf',body:Buffer.from('%PDF-1.4\n%%EOF'),
      headers:route.request().url().includes('download=true')?{'Content-Disposition':'attachment; filename="attachment.pdf"'}:{}}));
}

for (const library of ['machine','equipment'] as const) {
  test(`${library} splits unresolved and resolved counts with semantic compact pills at every viewport`, async({page},testInfo)=>{
    const state={notes:[] as ReturnType<typeof note>[]};
    await mockLibrary(page,library,state);
    for (const statuses of [[],['resolved'],['ordinary'],['ordinary','active','hold','resolved','resolved']] as Status[][]) {
      state.notes=statuses.map((status,index)=>note(library,index+1,status));
      await page.goto(`/${library}-library?asset=181`);
      const header=page.getByRole('button',{name:/^Work Orders & Notes/});
      const resolved=statuses.filter(status=>status==='resolved').length;
      const open=statuses.length-resolved;
      const active=statuses.filter(status=>status==='active'||status==='hold').length;
      const pills=header.locator('.mcc-summary-token');
      await expect(pills).toHaveText([
        `${open} note${open===1?'':'s'}`,
        ...(active?[`${active} active issue${active===1?'':'s'}`]:[]),
        ...(resolved?[`${resolved} resolved`]:[]),
      ]);
      await expect(pills.first()).toHaveClass(/mcc-summary-token--warning/);
      await expect(pills.first()).toHaveCSS('border-color','rgba(243, 183, 47, 0.44)');
      await expect(pills.first()).toHaveCSS('color','rgb(255, 229, 161)');
      if (resolved) {
        const resolvedPill=pills.filter({hasText:/resolved$/});
        const schedules=page.getByRole('button',{name:/Preventive Maintenance Tracking/}).locator('.mcc-summary-token--success');
        await expect(resolvedPill).toHaveClass(/mcc-summary-token--success/);
        await expect(resolvedPill).toHaveCSS('border-color','rgba(63, 205, 141, 0.42)');
        expect(await resolvedPill.evaluate(el=>getComputedStyle(el).color))
          .toBe(await schedules.evaluate(el=>getComputedStyle(el).color));
      }
      await expect(header).not.toContainText(/attachment/i);
      await expect(header.locator('.mcc-summary-token--attachment')).toHaveCount(0);
      await expect(page.getByRole('button',{name:/Asset Notes & Attachments/})).toHaveCount(0);
      for (const width of [1440,820,390,320]) {
        await page.setViewportSize({width,height:900});
        expect(await header.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
        expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
        await header.focus();await header.press('Enter');
        await expect(header).toHaveAttribute('aria-expanded','true');
        await expect(header).toBeFocused();
        expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
        if (open&&resolved) {
          await page.getByLabel('Search Asset Notes').fill('Summary record 1');
          await expect(pills.first()).toHaveText('3 notes');
          await expect(pills.filter({hasText:/resolved$/})).toHaveText('2 resolved');
          await page.getByLabel('Search Asset Notes').fill('');
        }
        await header.press('Space');await expect(header).toHaveAttribute('aria-expanded','false');
        if (open&&resolved) await page.locator('.mcc-compact-detail-grid').screenshot({path:testInfo.outputPath(`${library}-summary-${width}.png`)});
      }
    }
  });

  test(`${library} keeps attachment previews and downloads in notes and resolved history`, async({page,attachmentServer})=>{
    const state={notes:[note(library,1,'ordinary'),note(library,2,'resolved')]};
    for (const record of state.notes) record.attachments[0].downloadUrl=`${attachmentServer}/asset-note-attachments/${record.id}/file?download=true`;
    await mockLibrary(page,library,state);
    await page.goto(`/${library}-library?asset=181`);
    const header=page.getByRole('button',{name:/^Work Orders & Notes/});
    await expect(header).toContainText('1 note');await expect(header).toContainText('1 resolved');
    await expect(header).not.toContainText(/attachment/i);
    await header.click();
    const verifyAttachment=async(id:number)=>{
      const attachment=page.getByLabel(`Attachment attachment-${id}.pdf`,{exact:true});
      await expect(attachment).toBeVisible();
      await attachment.getByRole('button',{name:'Preview',exact:true}).click();
      const viewer=page.getByRole('dialog',{name:`attachment-${id}.pdf viewer`});
      await expect(viewer.locator('object')).toHaveAttribute('data',`/api/${library}-library/asset-note-attachments/${id}/file`);
      await viewer.getByRole('button',{name:'Close',exact:true}).first().click();
      const downloaded=page.waitForEvent('download');
      await attachment.getByRole('button',{name:'Download',exact:true}).click();
      const download=await downloaded;
      expect(download.url()).toContain(`/asset-note-attachments/${id}/file?download=true`);
      expect(await download.failure()).toBeNull();
      expect(await readFile((await download.path())!)).toEqual(pdfBytes);
      await expect(attachment.getByRole('button',{name:'Remove',exact:true})).toHaveCount(0);
    };
    await verifyAttachment(1);
    await page.getByRole('button',{name:/Work Order History/}).click();
    const history=page.getByRole('dialog',{name:/Resolved History for/});
    await history.getByRole('button',{name:/2026.*1 resolved issue/}).click();
    await verifyAttachment(2);
  });
}
