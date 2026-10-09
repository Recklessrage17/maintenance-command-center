import { expect, type Page, test } from '@playwright/test';

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
    ok:true,notes:state.notes,currentUser:{id:1,fullName:'Summary Tester',email:'summary@example.com',role:'Admin'},permissions:{canCreate:true,canExportWorkOrderRecords:true},
  }}));
  await page.route(new RegExp(`/api/${library}-library/asset-note-attachments/\\d+/file(?:\\?.*)?$`),
    route=>route.fulfill({contentType:'application/pdf',body:Buffer.from('%PDF-1.4\n%%EOF'),
      headers:route.request().url().includes('download=true')?{'Content-Disposition':'attachment; filename="attachment.pdf"'}:{}}));
}

async function openEditor(page:Page, library:Library) {
  const state={notes:[] as ReturnType<typeof note>[]};
  await mockLibrary(page,library,state);
  await page.goto(`/${library}-library?asset=181`);
  await page.getByRole('button',{name:/^Work Orders & Notes/}).click();
  await page.getByRole('button',{name:'Add Note',exact:true}).click();
  return page.getByRole('dialog',{name:'Add Note',exact:true});
}

for (const library of ['machine','equipment'] as const) {
  test(`${library} centered note modal contains keyboard focus, supports calendar and never overflows`, async({page},testInfo)=>{
    const dialog=await openEditor(page,library);
    await expect(dialog.getByLabel('Note Title *',{exact:true})).toBeFocused();
    const saveGeometry=await dialog.getByRole('button',{name:'Save Note',exact:true}).evaluate(el=>{const button=el.getBoundingClientRect();const label=el.querySelector('.is-current')!.getBoundingClientRect();return {height:button.height,centerDelta:Math.abs(button.top+button.height/2-label.top-label.height/2)};});
    expect(saveGeometry.height).toBeLessThanOrEqual(44);expect(saveGeometry.centerDelta).toBeLessThanOrEqual(2);
    await expect(page.locator('.asset-notes-panel .asset-note-form')).toHaveCount(0);
    const close=dialog.getByRole('button',{name:'Close',exact:true});
    await close.focus();await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('button',{name:'Save Note',exact:true})).toBeFocused();
    await page.keyboard.press('Tab');await expect(close).toBeFocused();
    // Attempts to focus the background must stay inside the editor.
    await page.getByRole('button',{name:'Add Note',exact:true}).evaluate(el=>(el as HTMLElement).focus());
    expect(await dialog.evaluate(el=>el.contains(document.activeElement))).toBe(true);
    await dialog.getByRole('button',{name:/Open Note Date.*calendar/}).click();
    const calendar=page.getByRole('dialog',{name:'Note Date * calendar'});
    await expect(calendar).toBeVisible();await page.keyboard.press('Escape');
    await expect(calendar).toHaveCount(0);await expect(dialog).toBeVisible();
    for(const viewport of [{width:1440,height:900},{width:820,height:900},{width:390,height:844},{width:320,height:640},{width:844,height:390}]) {
      await page.setViewportSize(viewport);
      const geometry=await dialog.evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,viewWidth:innerWidth,viewHeight:innerHeight,overflow:el.scrollWidth-el.clientWidth,pageOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth};});
      expect(Math.abs(geometry.x+geometry.width/2-geometry.viewWidth/2)).toBeLessThanOrEqual(2);
      expect(Math.abs(geometry.y+geometry.height/2-geometry.viewHeight/2)).toBeLessThanOrEqual(2);
      expect(geometry.y).toBeGreaterThanOrEqual(10);expect(geometry.overflow).toBeLessThanOrEqual(1);expect(geometry.pageOverflow).toBeLessThanOrEqual(1);
      await dialog.screenshot({path:testInfo.outputPath(`${library}-note-modal-${viewport.width}.png`)});
    }
    await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Add Note',exact:true})).toBeFocused();
    expect(await page.evaluate(()=>document.body.style.overflow)).not.toBe('hidden');
  });

  test(`${library} guards changed status, dates and attachments on Escape, cancel and backdrop`,async({page})=>{
    const dialog=await openEditor(page,library);
    await dialog.getByRole('checkbox',{name:/Needs Attention/}).check();
    page.once('dialog',prompt=>prompt.dismiss());await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();await expect(dialog.getByRole('checkbox',{name:/Needs Attention/})).toBeChecked();
    page.once('dialog',prompt=>prompt.dismiss());await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
    await expect(dialog).toBeVisible();
    page.once('dialog',prompt=>prompt.accept());await page.locator('.asset-note-editor-backdrop').click({position:{x:2,y:2}});
    await expect(dialog).toHaveCount(0);
    await page.getByRole('button',{name:'Add Note',exact:true}).click();
    await dialog.getByLabel('Note Date *',{exact:true}).fill('10/06/2026');
    page.once('dialog',prompt=>prompt.dismiss());await dialog.getByRole('button',{name:'Close',exact:true}).click();
    await expect(dialog).toBeVisible();
    await dialog.locator('input[type=file]').first().setInputFiles({name:'guard.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4')});
    await expect(dialog.getByLabel('Pending attachment guard.pdf')).toBeVisible();
    page.once('dialog',prompt=>prompt.accept());await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
    await expect(dialog).toHaveCount(0);
  });

  for (const withAttachment of [false,true]) {
    test(`${library} save ${withAttachment?'with attachment':'without attachment'} shows checkmark only after server success then restores saved flow`,async({page},testInfo)=>{
      const dialog=await openEditor(page,library);
      const record=note(library,1,'hold');
      let submitted='';let release!:()=>void;
      const responseReady=new Promise<void>(resolve=>{release=resolve;});
      await page.route(`**/api/${library}-library/assets/181/notes`,async route=>{
        if(route.request().method()==='POST') {
          submitted=route.request().postData()??'';
          await responseReady;await route.fulfill({json:{ok:true,note:record}});
        } else await route.fulfill({json:{ok:true,notes:[record],permissions:{canCreate:true}}});
      });
      await dialog.getByLabel('Note Title *',{exact:true}).fill('Saved maintenance record');
      await dialog.getByRole('checkbox',{name:/Needs Attention/}).check();
      await dialog.getByRole('checkbox',{name:/Put on Hold/}).check();
      await dialog.getByLabel('Original Issue Body *',{exact:true}).fill('Check drive temperature and attach service record.');
      if(withAttachment) await dialog.locator('input[type=file]').first().setInputFiles({name:'service.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4')});
      await dialog.getByRole('button',{name:'Save Note',exact:true}).click();
      await expect(dialog.locator('[data-note-save-state]')).toHaveAttribute('data-note-save-state','pending');
      await expect(dialog.getByLabel('Note Title *',{exact:true})).toBeDisabled();
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate(el=>el.contains(document.activeElement))).toBe(true);
      await page.keyboard.press('Escape');await expect(dialog).toBeVisible();
      expect(submitted).toMatch(/name="hold"\r?\n\r?\ntrue/);
      if(withAttachment) expect(submitted).toContain('filename="service.pdf"');
      release();
      await expect(dialog.locator('[data-note-save-state]')).toHaveAttribute('data-note-save-state','success');
      await expect(dialog.getByRole('button',{name:'Note Saved',exact:true})).toBeVisible();
      await expect(dialog.locator('.asset-note-save-check')).toBeVisible();
      await dialog.screenshot({path:testInfo.outputPath(`${library}-saved-${withAttachment}.png`)});
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole('button',{name:'Add Note',exact:true})).toBeFocused();
      await expect(page.getByRole('button',{name:/^Work Orders & Notes/})).toContainText('1 active issue');
      await page.getByRole('button',{name:'Add Note',exact:true}).click();
      await expect(dialog.getByRole('button',{name:'Save Note',exact:true})).toBeVisible();
      await expect(dialog.getByLabel('Note Title *',{exact:true})).toHaveValue('');
    });
  }

  test(`${library} reduced motion keeps successful save feedback without animation`,async({page})=>{
    await page.emulateMedia({reducedMotion:'reduce'});
    const dialog=await openEditor(page,library);
    await page.route(`**/api/${library}-library/assets/181/notes`,route=>route.fulfill({json:{ok:true,notes:[],note:note(library,1,'ordinary')}}));
    await dialog.getByLabel('Note Title *',{exact:true}).fill('Reduced motion');
    await dialog.getByLabel('Note Body *',{exact:true}).fill('Clear success feedback.');
    await dialog.getByRole('button',{name:'Save Note',exact:true}).click();
    await expect(dialog.getByRole('button',{name:'Note Saved',exact:true})).toBeVisible();
    await expect(dialog.locator('.asset-note-save-check')).toHaveCSS('animation-name','none');
    await expect(dialog.locator('.asset-note-save-check path')).toHaveCSS('animation-name','none');
    await expect(dialog).toHaveCount(0);
  });

  test(`${library} save failure leaves draft and attachments available for retry`,async({page})=>{
    const dialog=await openEditor(page,library);
    await page.route(`**/api/${library}-library/assets/181/notes`,route=>route.fulfill({status:500,json:{error:'Save unavailable. Try again.'}}));
    await dialog.getByLabel('Note Title *',{exact:true}).fill('Keep my draft');
    await dialog.getByLabel('Note Body *',{exact:true}).fill('Do not lose this note.');
    await dialog.locator('input[type=file]').first().setInputFiles({name:'retry.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4')});
    await dialog.getByRole('button',{name:'Save Note',exact:true}).click();
    await expect(dialog.getByRole('alert')).toHaveText('Save unavailable. Try again.');
    await expect(dialog.getByLabel('Note Title *',{exact:true})).toHaveValue('Keep my draft');
    await expect(dialog.getByLabel('Pending attachment retry.pdf')).toBeVisible();
    await expect(dialog.locator('.asset-note-save-check')).not.toBeVisible();
    await expect(dialog.getByRole('button',{name:'Try Note Save',exact:true})).toBeEnabled();
  });
}
