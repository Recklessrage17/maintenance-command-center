import {expect,type Page,test} from '@playwright/test';

const machine={id:129,assetNumber:'PRESS-129',assetName:'UI Modernization Press',brand:'MCC',model:'MOD-129',serialNumber:'SERIAL-129',machineYear:'2023',location:'North Cell',department:'Molding',status:'active',brandColorHex:'#44D7FF',pmSummary:{total:0,status:'current',label:'PM: Current'},historyPreview:[],createdAt:'2026-09-01T12:00:00Z',updatedAt:'2026-09-15T12:00:00Z'};
const equipment={id:229,assetNumber:'EQ-229',equipmentName:'UI Modernization Dryer',assetName:'UI Modernization Dryer',category:'Dryer',equipmentType:'Desiccant Dryer',manufacturer:'MCC',brand:'MCC',model:'MOD-229',serialNumber:'SERIAL-229',equipmentYear:'2023',year:'2023',location:'South Cell',department:'Molding',status:'active',criticality:'normal',powerType:'Electric',voltage:'480 VAC',phase:'3 phase',amperage:'30 A',airRequirement:'N/A',waterRequirement:'N/A',capacityRating:'200 lb',dimensions:'40 x 40 x 70 in',weight:'500 lb',specificationNotes:'N/A',pmSummary:{total:0,status:'current',label:'PM: Current'},latestHistory:null,createdAt:'2026-09-01T12:00:00Z',updatedAt:'2026-09-15T12:00:00Z'};
const permissions={canEdit:true,canDelete:true,canResolve:false,canReopen:false,canAddUpdate:false,canDeleteAttachments:true};

function note(library:'machine'|'equipment'){
  const asset=library==='machine'?machine:equipment;const noteId=library==='machine'?1291:2291;
  return {id:noteId,assetId:asset.id,title:'Modern attachment reference',noteDate:'2026-09-15',body:'Focused Issue 129 Asset Notes UI regression fixture.',warning:false,createdBy:'Issue 129 Tester',createdAt:'2026-09-15T15:30:00Z',updatedAt:'2026-09-15T16:30:00Z',pdfFilename:`${asset.assetNumber}_Modern_Note.pdf`,pdfUrl:`/api/${library}-library/asset-notes/${noteId}/pdf`,pdfDownloadUrl:`/api/${library}-library/asset-notes/${noteId}/pdf?download=true`,permissions,attachments:[{id:1,noteId,filename:'electrical-inspection.pdf',mimeType:'application/pdf',fileSize:4096,createdAt:'2026-09-15T15:45:00Z',contentUrl:`/api/${library}-library/asset-note-attachments/1/file`,downloadUrl:`/api/${library}-library/asset-note-attachments/1/file?download=true`},{id:2,noteId,filename:'nameplate-photo.webp',mimeType:'image/webp',fileSize:15360,createdAt:'2026-09-15T15:50:00Z',contentUrl:`/api/${library}-library/asset-note-attachments/2/file`,downloadUrl:`/api/${library}-library/asset-note-attachments/2/file?download=true`}],updates:[],lifecycle:[]};
}

async function commonRoutes(page:Page){
  await page.route('**/api/auth/status',route=>route.fulfill({json:{setupRequired:false,user:{id:1,fullName:'Issue 129 Tester',email:'issue129@example.com',role:'Admin',isOwnerAdmin:true,forcePasswordChange:false,effectivePermissions:['machine.view','machine.notes_manage','machine.import_export','equipment.view','equipment.notes_manage','equipment.import_export']}}}));
  await page.route('**/api/requisitions/summary',route=>route.fulfill({json:{ok:true,requestedCount:0,orderedCount:0,receivedCount:0,canceledCount:0,activeCount:0}}));
  await page.route(/\/api\/machine-library\/assets(?:\?.*)?$/,route=>route.fulfill({json:{ok:true,assets:[machine],brandSettings:[],permissions:{canEdit:true,canDelete:true}}}));
  await page.route(/\/api\/machine-library\/assets\/129\/history$/,route=>route.fulfill({json:{ok:true,asset:machine,records:[]}}));
  await page.route(/\/api\/machine-library\/assets\/129\/(inspection-records|component-images)$/,route=>route.fulfill({json:{ok:true,records:[],images:[]}}));
  await page.route(/\/api\/machine-library\/assets\/129\/preventive-maintenance$/,route=>route.fulfill({json:{ok:true,tasks:[],summary:{total:0,current:0,dueSoon:0,dueNow:0,overdue:0,hold:0,inactive:0,incomplete:0,nextDueDate:null,nextDueMeter:null}}}));
  await page.route(/\/api\/machine-library\/assets\/129\/(document-folders|documents)$/,route=>route.fulfill({json:{ok:true,folders:[],documents:[],summary:{folderCount:0,documentCount:0}}}));
  await page.route(/\/api\/equipment-library\/assets(?:\?.*)?$/,route=>route.fulfill({json:{ok:true,assets:[equipment],categories:['Dryer'],permissions:{canEdit:true,canDelete:true}}}));
  await page.route(/\/api\/equipment-library\/assets\/229\/history$/,route=>route.fulfill({json:{ok:true,asset:equipment,records:[]}}));
  await page.route(/\/api\/equipment-library\/assets\/229\/preventive-maintenance$/,route=>route.fulfill({json:{ok:true,tasks:[],summary:{total:0,dueSoon:0,overdue:0,nextDueDate:null,nextDueMeter:null}}}));
  await page.route(/\/api\/equipment-library\/assets\/229\/(document-folders|documents)$/,route=>route.fulfill({json:{ok:true,folders:[],documents:[],summary:{folderCount:0,documentCount:0}}}));
  await page.route(/\/api\/(machine|equipment)-library\/asset-note-attachments\/2\/file(?:\?.*)?$/,route=>route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64')}));
}

async function openNotes(page:Page,library:'machine'|'equipment',withNote=true){
  await commonRoutes(page);const asset=library==='machine'?machine:equipment;
  await page.route(new RegExp(`/api/${library}-library/assets/${asset.id}/notes$`),route=>route.fulfill({json:{ok:true,notes:withNote?[note(library)]:[],permissions:{canCreate:true,canExportWorkOrderRecords:true}}}));
  await page.goto(`/${library}-library?asset=${asset.id}`);
  await page.getByRole('button',{name:/Asset Notes & Attachments/}).click();
}

for(const library of ['machine','equipment'] as const){
  test(`${library} Asset Notes uses compact accessible attention status and preserves photo PDF entry`,async({page})=>{
    await openNotes(page,library,false);await page.getByRole('button',{name:'Add Note'}).click();
    const status=page.locator('.asset-note-warning-field');const toggle=page.getByRole('checkbox',{name:/Needs Attention/});
    await expect(status).toHaveAttribute('data-state','off');await expect(status).toContainText('Standard note · alert is off');await expect(status.getByText('Off',{exact:true})).toBeVisible();await expect(toggle).not.toBeChecked();
    const offStyle=await status.evaluate(element=>({border:getComputedStyle(element).borderColor,background:getComputedStyle(element).backgroundImage,color:getComputedStyle(element.querySelector('.asset-note-warning-copy strong')!).color}));
    await toggle.check();await expect(status).toHaveAttribute('data-state','on');await expect(status).toContainText('Dashboard maintenance alert is on');await expect(status.getByText('On',{exact:true})).toBeVisible();await expect(toggle).toBeChecked();
    const onStyle=await status.evaluate(element=>({border:getComputedStyle(element).borderColor,background:getComputedStyle(element).backgroundImage,color:getComputedStyle(element.querySelector('.asset-note-warning-copy strong')!).color}));expect(onStyle).not.toEqual(offStyle);
    await expect(page.getByRole('button',{name:'Take Work Order Photo'})).toBeVisible();await expect(page.getByLabel('Take Asset Notes work-order photo')).toHaveAttribute('capture','environment');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  });

  test(`${library} Asset Notes file cards expose lifecycle-appropriate actions and metadata`,async({page})=>{
    await openNotes(page,library);const asset=library==='machine'?machine:equipment;
    const generated=page.getByLabel(`Generated note PDF ${asset.assetNumber}_Modern_Note.pdf`);await expect(generated).toContainText(`${asset.assetNumber}_Modern_Note.pdf`);await expect(generated).toContainText('PDF · Generated note');await expect(generated).toContainText('Updated');await expect(generated.getByRole('button',{name:'Preview'})).toBeVisible();await expect(generated.getByRole('button',{name:'Download'})).toBeVisible();
    const attachment=page.getByLabel('Attachment electrical-inspection.pdf');await expect(attachment).toContainText('PDF · 4.0 KB');await expect(attachment).toContainText('Added');for(const action of ['Preview','Download','Remove'])await expect(attachment.getByRole('button',{name:action,exact:true})).toBeVisible();
    const image=page.getByLabel('Attachment nameplate-photo.webp');await expect(image).toContainText('WEBP · 15 KB');await expect(image.locator('img.asset-attachment-thumbnail')).toHaveAttribute('loading','lazy');
    await generated.getByRole('button',{name:'Preview'}).click();await expect(page.getByRole('dialog',{name:`${asset.assetNumber}_Modern_Note.pdf viewer`})).toBeVisible();await page.getByRole('dialog',{name:`${asset.assetNumber}_Modern_Note.pdf viewer`}).getByRole('button',{name:'Close'}).first().click();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  });
}

test('staged Asset Notes cards preview, replace, and remove without changing saved attachment APIs',async({page})=>{
  await openNotes(page,'machine',false);await page.getByRole('button',{name:'Add Note'}).click();const picker=page.locator('.asset-note-attachment-picker input[type=file]');
  await picker.setInputFiles({name:'first-draft.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 issue 129')});const card=page.getByLabel('Pending attachment first-draft.pdf');await expect(card.getByRole('button',{name:'Preview'})).toBeVisible();await expect(card.getByRole('button',{name:'Replace'})).toBeVisible();await expect(card.getByRole('button',{name:'Remove'})).toBeVisible();
  await card.getByLabel('Replace first-draft.pdf').setInputFiles({name:'final-draft.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 replacement')});await expect(page.getByLabel('Pending attachment final-draft.pdf')).toBeVisible();await page.getByLabel('Pending attachment final-draft.pdf').getByRole('button',{name:'Remove'}).click();await expect(page.getByLabel('Pending attachment final-draft.pdf')).toHaveCount(0);
});

test('saved attachment cards retain permission-gated destructive actions',async({page})=>{
  await commonRoutes(page);const readOnlyNote={...note('machine'),permissions:{...permissions,canEdit:false,canDelete:false,canDeleteAttachments:false}};await page.route(/\/api\/machine-library\/assets\/129\/notes$/,route=>route.fulfill({json:{ok:true,notes:[readOnlyNote],permissions:{canCreate:false,canExportWorkOrderRecords:false}}}));await page.goto('/machine-library?asset=129');await page.getByRole('button',{name:/Asset Notes & Attachments/}).click();const attachment=page.getByLabel('Attachment electrical-inspection.pdf');await expect(attachment.getByRole('button',{name:'Preview'})).toBeVisible();await expect(attachment.getByRole('button',{name:'Download'})).toBeVisible();await expect(attachment.getByRole('button',{name:'Remove'})).toHaveCount(0);await expect(page.getByRole('button',{name:'Add Note'})).toHaveCount(0);
});

test('Asset Notes file cards stay within a tablet viewport',async({page})=>{
  await page.setViewportSize({width:820,height:1180});await openNotes(page,'equipment');const cards=page.locator('.asset-attachment-chip');await expect(cards).toHaveCount(3);const geometry=await cards.evaluateAll(elements=>elements.map(element=>{const box=element.getBoundingClientRect();return{left:box.left,right:box.right,width:box.width};}));for(const box of geometry){expect(box.left).toBeGreaterThanOrEqual(0);expect(box.right).toBeLessThanOrEqual(820);expect(box.width).toBeGreaterThan(0);}expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});
