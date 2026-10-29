import { expect, test } from '@playwright/test';
import { backendFixture, owner, request } from './helpers/security-process.mjs';
import pdfLib from '../backend/node_modules/pdf-lib/cjs/index.js';
const {PDFDocument}=pdfLib;

test('Patch 2 real Equipment fields persist across all editors and child records survive',async({page},testInfo)=>{
  test.setTimeout(90_000);
  const runtime=await backendFixture('patch2-equipment',{}, {serveFrontend:true});
  try {
    const cookie=await owner(runtime.base);
    await page.context().addCookies([{name:'mcc_session',value:cookie.slice(cookie.indexOf('=')+1),url:runtime.base}]);
    const values:Record<string,string>={assetNumber:'DEMO-EQ-209',equipmentName:'Synthetic QA Dryer',category:'Dryer',equipmentType:'Desiccant',manufacturer:'Demo Brand',model:'D-209',serialNumber:'DEMO-SN-209',equipmentYear:'2020',location:'Demo Cell',department:'QA',status:'active',criticality:'high',powerType:'Electric',voltage:'480 VAC',phase:'3',amperage:'42 A',airRequirement:'80 psi',waterRequirement:'5 GPM',capacityRating:'500 lb/hr',dimensions:'48 x 36 x 72 in',weight:'825 lb',specificationNotes:'Synthetic specifications only.'};
    let result=await request(runtime.base,'/api/equipment-library/assets',{method:'POST',cookie,body:values});
    expect(result.response.status).toBe(201);
    const id=result.data.asset.id;
    const base=`/api/equipment-library/assets/${id}`;
    result=await request(runtime.base,`${base}/preventive-maintenance`,{method:'POST',cookie,body:{title:'Synthetic filter check',intervalType:'days',intervalValue:30,lastCompletedDate:'2026-10-01',scheduleStatus:'active'}});
    expect(result.response.status).toBe(201);
    const pmId=result.data.task.id;
    result=await request(runtime.base,`${base}/document-folders`,{method:'POST',cookie,body:{name:'Demo Manuals'}});
    expect(result.response.status).toBe(201);
    const folderId=result.data.folder.id;
    const manual=await PDFDocument.create();manual.addPage();
    const documentBody=new FormData();documentBody.append('documents',new Blob([await manual.save()],{type:'application/pdf'}),'Demo Manual.pdf');
    result=await request(runtime.base,`${base}/document-folders/${folderId}/documents`,{method:'POST',cookie,body:documentBody});
    expect(result.response.status).toBe(201);
    const doc=result.data.documents[0];
    const noteBody=new FormData();
    for(const [key,value] of Object.entries({title:'Synthetic observation',noteDate:'2026-10-28',body:'Demo work-order record.',workOrderReference:'DEMO-WO-209',warning:'true'}))noteBody.append(key,value);
    noteBody.append('attachments',new Blob([await manual.save()],{type:'application/pdf'}),'Demo attachment.pdf');
    result=await request(runtime.base,`${base}/notes`,{method:'POST',cookie,body:noteBody});
    expect(result.response.status,JSON.stringify(result.data)).toBe(201);
    const note=result.data.note;

    await page.goto(`${runtime.base}/equipment-library?asset=${id}`);
    const detail=page.locator('.equipment-detail-page');
    const grid=detail.locator('.mcc-compact-detail-grid');
    await expect(detail).toBeVisible();
    await expect(grid.locator('.machine-detail-accordion-panel[aria-hidden="false"]')).toHaveCount(0);
    const sections=[
      {accent:'basic',fields:[['Equipment Name *','equipmentName'],['Equipment Asset # *','assetNumber'],['Equipment Type','equipmentType'],['Manufacturer / Brand','manufacturer'],['Model','model'],['Serial Number','serialNumber'],['Year','equipmentYear'],['Location','location'],['Department / Area','department']]},
      {accent:'electrical',fields:[['Power Type','powerType'],['Voltage','voltage'],['Phase','phase'],['Amperage','amperage'],['Air Requirement','airRequirement'],['Water Requirement','waterRequirement']]},
      {accent:'neutral',fields:[['Capacity / Rating','capacityRating'],['Dimensions','dimensions'],['Weight','weight'],['Equipment-Specific Specification Notes','specificationNotes']]},
    ];
    for(const section of sections) {
      const card=grid.locator(`[data-category-accent="${section.accent}"]`);
      await card.locator('.machine-detail-accordion-toggle').click();
      for(const [,key] of section.fields)await expect(card.locator('.equipment-detail-grid')).toContainText(values[key]);
      await card.getByRole('button',{name:'Edit Mode',exact:true}).click();
      for(const [label,key] of section.fields) {
        await expect(card.getByRole('textbox',{name:label,exact:true})).toHaveValue(values[key]);
        values[key]=key==='equipmentYear'?'2021':`${values[key]} updated`;
        await card.getByRole('textbox',{name:label,exact:true}).fill(values[key]);
      }
      if(section.accent==='basic') {
        await expect(card.getByRole('combobox',{name:'Category *'})).toHaveValue('Dryer');
        await card.getByRole('combobox',{name:'Category *'}).fill('Chiller');
        await card.getByRole('option',{name:'Chiller',exact:true}).click();values.category='Chiller';
        await card.getByRole('combobox',{name:'Status',exact:true}).selectOption('down');values.status='down';
        await card.getByRole('combobox',{name:'Criticality',exact:true}).selectOption('critical');values.criticality='critical';
      }
      await card.getByRole('button',{name:'Save',exact:true}).click();
      await expect(card.locator('.equipment-edit-grid')).toHaveCount(0);
      result=await request(runtime.base,'/api/equipment-library/assets',{cookie});
      expect(result.data.assets.find((asset:{id:number})=>asset.id===id)).toMatchObject(values);
      await page.reload();
      await expect(grid.locator('.machine-detail-accordion-panel[aria-hidden="false"]')).toHaveCount(0);
      await card.getByRole('button',{name:'Edit Mode',exact:true}).click();
      for(const [label,key] of section.fields)await expect(card.getByRole('textbox',{name:label,exact:true})).toHaveValue(values[key]);
      const [label]=section.fields[0];await card.getByRole('textbox',{name:label,exact:true}).fill('Cancelled synthetic draft');
      await card.getByRole('button',{name:'Cancel',exact:true}).click();
      await expect(card.locator('.equipment-detail-grid')).not.toContainText('Cancelled synthetic draft');
      await card.locator('.machine-detail-accordion-toggle').click();
    }
    await grid.getByRole('button',{name:/Preventive Maintenance Tracking/}).click();
    await expect(grid.getByText('Synthetic filter check',{exact:true})).toBeVisible();
    await grid.getByRole('button',{name:/Asset Document Library/}).click();
    await grid.getByRole('button',{name:/Demo Manuals.*1 document/}).click();
    await expect(grid.locator('.machine-document-row',{hasText:'Demo Manual.pdf'})).toBeVisible();
    await grid.getByRole('button',{name:/Work Orders & Notes/}).click();
    await expect(grid.locator('.asset-note-issue-title').filter({hasText:'Synthetic observation'})).toBeVisible();
    await detail.getByRole('button',{name:'View Full History'}).click();
    await expect(page.getByRole('dialog',{name:'Full Equipment History'})).toBeVisible();
    await page.getByRole('dialog',{name:'Full Equipment History'}).getByRole('button',{name:'Close',exact:true}).click();
    page.once('dialog',async dialog=>{expect(dialog.message()).toContain('Disable');await dialog.dismiss();});
    await detail.getByRole('button',{name:'Disable Equipment',exact:true}).click();
    page.once('dialog',async dialog=>{expect(dialog.type()).toBe('prompt');await dialog.dismiss();});
    await detail.getByRole('button',{name:'Remove',exact:true}).click();
    result=await request(runtime.base,`${base}/preventive-maintenance`,{cookie});
    expect(result.data.some((task:{id:number})=>task.id===pmId)).toBe(true);
    result=await request(runtime.base,`${base}/notes`,{cookie});
    expect(result.data.notes[0]).toMatchObject({id:note.id,workOrder:'DEMO-WO-209'});
    expect(result.data.notes[0].attachments).toHaveLength(1);
    for(const path of [`${base}/specification.pdf`,note.pdfUrl,doc.openUrl]) {
      const response=await page.context().request.get(`${runtime.base}${path}`);
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toContain('application/pdf');
      expect((await PDFDocument.load(await response.body())).getPageCount()).toBeGreaterThan(0);
    }
    await page.screenshot({path:testInfo.outputPath('equipment-real-records.png'),fullPage:true});
  } finally {await runtime.close();}
});
