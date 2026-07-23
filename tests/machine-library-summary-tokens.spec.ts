import { expect, type Locator, type Page, test } from '@playwright/test';

const asset={
  id:91,assetNumber:'TOKEN-PRESS-91',assetName:'Token Press',brand:'Toyo',model:'T-91',serialNumber:'TOK-91',machineYear:'2021',machineType:'Injection Molding Machine',powerType:'Electric',setupType:'Standard Injection',shotSizeOz:12,tonnage:300,barrelDiameter:'40 mm',location:'Token Cell',department:'Molding',status:'active',voltageValue:'480',voltageType:'AC',fullLoadAmp:'180',machineLength:'20 ft',machineWidth:'8 ft',machineHeight:'9 ft',fullDieHeightLength:'48 in',screwType:'General',screwTipType:'Ring',screwTipInstalledDate:'',screwInstalledDate:'',barrelInstalledDate:'',barrelEndCapInstalledDate:'',barrelLength:'90 in',screwLength:'88 in',screwRebuildRepaired:false,barrelRebuildRepaired:false,screwConditionStatus:'used',barrelConditionStatus:'used',hasDoubleShotInjection:false,hasPlungerInjection:false,screw2Type:'',screw2TipType:'',screw2RebuildRepaired:false,screw2ConditionStatus:'new',screw2InstalledDate:'',screw2TipInstalledDate:'',screw2Length:'',barrel2Diameter:'',barrel2RebuildRepaired:false,barrel2ConditionStatus:'new',barrel2InstalledDate:'',barrel2EndCapInstalledDate:'',barrel2Length:'',plungerType:'',plungerRebuildRepaired:false,plungerConditionStatus:'new',plungerInstalledDate:'',plungerLength:'',plungerDiameter:'',plungerBarrelType:'',plungerBarrelRebuildRepaired:false,plungerBarrelConditionStatus:'new',plungerBarrelInstalledDate:'',plungerBarrelEndCapInstalledDate:'',plungerBarrelLength:'',plungerBarrelDiameter:'',notes:'',criticalNotes:'',brandColorHex:'#44D7FF',createdAt:'2026-01-01T12:00:00Z',updatedAt:'2026-07-23T12:00:00Z',pmSummary:null,historyPreview:[],
};
type Counts={folders:number;documents:number;notes:number;attachments:number};

function folderFixture(id:number){return{id,assetId:91,name:`Folder ${id}`,description:'',documentCount:0,createdAt:'2026-07-23T12:00:00Z',updatedAt:'2026-07-23T12:00:00Z'};}
function documentFixture(id:number){return{id,assetId:91,folderId:1,folderName:'Folder 1',originalFilename:`Document ${id}.pdf`,displayFilename:`Document ${id}.pdf`,extension:'.pdf',mimeType:'application/pdf',sizeBytes:2048,description:'',revision:'A',uploadedAt:'2026-07-23T12:00:00Z',updatedAt:'2026-07-23T12:00:00Z',uploadedBy:'Token Tester',openUrl:`/documents/${id}/open`,downloadUrl:`/documents/${id}/download`,canPrint:true};}
function noteFixtures(noteCount:number,attachmentCount:number){
  const attachmentsPerNote=noteCount?Math.floor(attachmentCount/noteCount):0;
  let remainder=noteCount?attachmentCount%noteCount:0;
  let attachmentId=1;
  return Array.from({length:noteCount},(_,noteIndex)=>{
    const count=attachmentsPerNote+(remainder-->0?1:0);
    const attachments=Array.from({length:count},()=>{const id=attachmentId++;return{id,noteId:noteIndex+1,filename:`Attachment ${id}.pdf`,mimeType:'application/pdf',fileSize:2048,createdAt:'2026-07-23T12:00:00Z',contentUrl:`/attachments/${id}`,downloadUrl:`/attachments/${id}/download`};});
    return{id:noteIndex+1,assetId:91,title:`Note ${noteIndex+1}`,noteDate:'2026-07-23',body:'Summary token fixture.',createdBy:'Token Tester',createdAt:'2026-07-23T12:00:00Z',updatedAt:'2026-07-23T12:00:00Z',pdfFilename:`Note ${noteIndex+1}.pdf`,pdfUrl:`/notes/${noteIndex+1}/pdf`,pdfDownloadUrl:`/notes/${noteIndex+1}/pdf?download=true`,attachments};
  });
}
async function mockMachineLibrary(page:Page,state:{counts:Counts}){
  await page.route('**/api/auth/status',route=>route.fulfill({json:{setupRequired:false,user:{id:1,fullName:'Token Tester',email:'tokens@example.com',role:'Admin',isOwnerAdmin:true,forcePasswordChange:false}}}));
  await page.route(/\/api\/machine-library\/assets(?:\?.*)?$/,route=>route.fulfill({json:{ok:true,assets:[asset],brandSettings:[],permissions:{canEdit:true,canDelete:true}}}));
  await page.route(/\/api\/machine-library\/assets\/91\/preventive-maintenance$/,route=>route.fulfill({json:{ok:true,tasks:[],summary:{total:12,dueSoon:1,overdue:2,nextDueDate:'2026-08-01',nextDueMeter:null}}}));
  await page.route(/\/api\/machine-library\/assets\/91\/notes$/,route=>route.fulfill({json:{ok:true,notes:noteFixtures(state.counts.notes,state.counts.attachments)}}));
  await page.route(/\/api\/machine-library\/assets\/91\/component-images$/,route=>route.fulfill({json:{ok:true,images:[]}}));
  await page.route(/\/api\/machine-library\/assets\/91\/inspection-records$/,route=>route.fulfill({json:{ok:true,records:[]}}));
  await page.route(/\/api\/machine-library\/assets\/91\/document-folders$/,route=>route.fulfill({json:{ok:true,folders:Array.from({length:state.counts.folders},(_,index)=>folderFixture(index+1))}}));
  await page.route(/\/api\/machine-library\/assets\/91\/documents$/,route=>route.fulfill({json:{ok:true,documents:Array.from({length:state.counts.documents},(_,index)=>documentFixture(index+1))}}));
}
function section(detail:Locator,title:string){return detail.locator('.machine-detail-section-title').filter({hasText:new RegExp(`^${title}$`)}).locator('xpath=ancestor::article[1]');}
async function openDetail(page:Page){
  await page.goto('/machine-library');
  await page.locator('.machine-asset-card .machine-card-brand-name').click();
  return page.locator('.machine-detail-modal');
}
async function expectContentSizedHeader(card:Locator,expectedTexts:string[],mobile:boolean){
  const toggle=card.locator('.machine-detail-accordion-toggle');
  const tokens=card.locator('.mcc-summary-token');
  await expect(tokens).toHaveCount(expectedTexts.length);
  for(let index=0;index<expectedTexts.length;index+=1)await expect(tokens.nth(index)).toHaveText(expectedTexts[index]);
  const layout=await toggle.evaluate((element)=>{
    const button=element as HTMLElement;
    const title=button.querySelector('.machine-detail-section-title') as HTMLElement;
    const group=button.querySelector('.mcc-summary-token-group') as HTMLElement;
    const chevron=button.querySelector('.machine-accordion-chevron') as HTMLElement;
    const tokenMetrics=Array.from(button.querySelectorAll('.mcc-summary-token')).map(node=>{
      const token=node as HTMLElement;
      const style=getComputedStyle(token);
      const clone=token.cloneNode(true) as HTMLElement;
      clone.style.position='fixed';clone.style.visibility='hidden';clone.style.width='max-content';clone.style.maxWidth='none';clone.style.flex='none';
      document.body.append(clone);
      const intrinsicWidth=clone.getBoundingClientRect().width;
      clone.remove();
      return{width:token.getBoundingClientRect().width,intrinsicWidth,display:style.display,flexGrow:style.flexGrow,flexShrink:style.flexShrink,whiteSpace:style.whiteSpace};
    });
    const buttonBox=button.getBoundingClientRect();
    const titleBox=title.getBoundingClientRect();
    const groupBox=group.getBoundingClientRect();
    const chevronBox=chevron.getBoundingClientRect();
    const groupStyle=getComputedStyle(group);
    return{height:buttonBox.height,overflow:button.scrollWidth-button.clientWidth,buttonRight:buttonBox.right,titleTop:titleBox.top,groupTop:groupBox.top,chevronRight:chevronBox.right,groupDisplay:groupStyle.display,groupWrap:groupStyle.flexWrap,groupMinWidth:groupStyle.minWidth,tokens:tokenMetrics};
  });
  expect(layout.groupDisplay).toBe('flex');
  expect(layout.groupWrap).toBe('wrap');
  expect(layout.groupMinWidth).toBe('0px');
  expect(layout.overflow).toBeLessThanOrEqual(1);
  expect(layout.chevronRight).toBeGreaterThan(layout.buttonRight-35);
  expect(layout.height).toBeLessThan(mobile?105:76);
  for(const token of layout.tokens){
    expect(token.display).toBe('flex');
    expect(token.flexGrow).toBe('0');
    expect(token.flexShrink).toBe('0');
    expect(token.whiteSpace).toBe('nowrap');
    expect(Math.abs(token.width-token.intrinsicWidth)).toBeLessThanOrEqual(1);
  }
  if(mobile)expect(layout.groupTop).toBeGreaterThan(layout.titleTop);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded','true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded','false');
}

test('shared count pills remain content-sized for zero, singular, and large values',async({page},testInfo)=>{
  const state={counts:{folders:0,documents:1,notes:0,attachments:0}};
  await mockMachineLibrary(page,state);
  const scenarios:Counts[]=[
    {folders:0,documents:1,notes:0,attachments:0},
    {folders:1,documents:1,notes:1,attachments:1},
    {folders:12,documents:999,notes:12,attachments:120},
  ];
  for(const counts of scenarios){
    state.counts=counts;
    const detail=await openDetail(page);
    await expectContentSizedHeader(section(detail,'Asset Document Library'),[`${counts.folders} folder${counts.folders===1?'':'s'}`,`${counts.documents} document${counts.documents===1?'':'s'}`],testInfo.project.name==='mobile-chromium');
    await expectContentSizedHeader(section(detail,'Asset Notes & Attachments'),[`${counts.notes} note${counts.notes===1?'':'s'}`,`${counts.attachments} attachment${counts.attachments===1?'':'s'}`],testInfo.project.name==='mobile-chromium');
    await expect(section(detail,'Asset Notes & Attachments').locator('.machine-detail-accordion-toggle')).not.toContainText('No notes');
    await expect(section(detail,'Preventive Maintenance Tracking').locator('.mcc-summary-token')).toHaveCount(4);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  }
});

test('shared count pills remain compact at tablet width',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','Tablet coverage runs once in desktop Chromium.');
  await page.setViewportSize({width:820,height:1000});
  const state={counts:{folders:12,documents:999,notes:12,attachments:120}};
  await mockMachineLibrary(page,state);
  const detail=await openDetail(page);
  await expectContentSizedHeader(section(detail,'Asset Document Library'),['12 folders','999 documents'],false);
  await expectContentSizedHeader(section(detail,'Asset Notes & Attachments'),['12 notes','120 attachments'],false);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});
