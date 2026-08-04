import { expect, type Locator, type Page, test } from '@playwright/test';

let currentAsset = {
  id:81,assetNumber:'SETUP-PRESS-81',assetName:'Setup Press',brand:'Toyo',model:'S-81',serialNumber:'SET-81',machineYear:'2022',machineType:'Injection Molding Machine',powerType:'Servo Hydraulic',setupType:'Multi-Component / Multi-Material',shotSizeOz:16,tonnage:400,barrelDiameter:'45 mm',location:'Cell 8',department:'Molding',status:'active',voltageValue:'480',voltageType:'AC',fullLoadAmp:'220',machineLength:'22 ft',machineWidth:'9 ft',machineHeight:'10 ft',fullDieHeightLength:'52 in',screwType:'General',screwTipType:'Ring',screwTipInstalledDate:'',screwInstalledDate:'',barrelInstalledDate:'',barrelEndCapInstalledDate:'',barrelLength:'95 in',screwLength:'92 in',screwRebuildRepaired:false,barrelRebuildRepaired:false,screwConditionStatus:'used',barrelConditionStatus:'used',hasDoubleShotInjection:true,hasPlungerInjection:true,screw2Type:'Secondary',screw2TipType:'Secondary Ring',screw2RebuildRepaired:false,screw2ConditionStatus:'new',screw2InstalledDate:'',screw2TipInstalledDate:'',screw2Length:'70 in',barrel2Diameter:'28 mm',barrel2RebuildRepaired:false,barrel2ConditionStatus:'new',barrel2InstalledDate:'',barrel2EndCapInstalledDate:'',barrel2Length:'72 in',plungerType:'Direct',plungerRebuildRepaired:false,plungerConditionStatus:'new',plungerInstalledDate:'',plungerLength:'30 in',plungerDiameter:'18 mm',plungerBarrelType:'Cylinder',plungerBarrelRebuildRepaired:false,plungerBarrelConditionStatus:'new',plungerBarrelInstalledDate:'',plungerBarrelEndCapInstalledDate:'',plungerBarrelLength:'34 in',plungerBarrelDiameter:'20 mm',notes:'',criticalNotes:'',brandColorHex:'#2B7FFF',createdAt:'2026-01-01T12:00:00Z',updatedAt:'2026-07-23T12:00:00Z',pmSummary:null,historyPreview:[],
};

async function mockMachineLibrary(page:Page) {
  currentAsset = {...currentAsset,setupType:'Multi-Component / Multi-Material'};
  await page.route('**/api/auth/status',route => route.fulfill({json:{setupRequired:false,user:{id:1,fullName:'Setup Tester',email:'setup@example.com',role:'Admin',isOwnerAdmin:true,forcePasswordChange:false}}}));
  await page.route(/\/api\/machine-library\/assets\/81$/,async route => {
    if (route.request().method() !== 'PUT') return route.fallback();
    currentAsset = {...currentAsset,...route.request().postDataJSON(),updatedAt:'2026-07-23T13:00:00Z'};
    return route.fulfill({json:{ok:true,asset:currentAsset}});
  });
  await page.route(/\/api\/machine-library\/assets(?:\?.*)?$/,route => route.fulfill({json:{ok:true,assets:[currentAsset],brandSettings:[],permissions:{canEdit:true,canDelete:true}}}));
  await page.route(/\/api\/machine-library\/assets\/81\/preventive-maintenance$/,route => route.fulfill({json:{ok:true,tasks:[],summary:{total:0,dueSoon:0,overdue:0,nextDueDate:null,nextDueMeter:null}}}));
  await page.route(/\/api\/machine-library\/assets\/81\/notes$/,route => route.fulfill({json:{ok:true,notes:[]}}));
  await page.route(/\/api\/machine-library\/assets\/81\/component-images$/,route => route.fulfill({json:{ok:true,images:[]}}));
  await page.route(/\/api\/machine-library\/assets\/81\/document-folders$/,route => route.fulfill({json:{ok:true,folders:[{id:1,assetId:81,name:'Manuals',description:'',documentCount:1,createdAt:'2026-07-23T12:00:00Z',updatedAt:'2026-07-23T12:00:00Z'}],summary:{folderCount:1,documentCount:1}}}));
  await page.route(/\/api\/machine-library\/assets\/81\/documents$/,route => route.fulfill({json:{ok:true,documents:[{id:1,assetId:81,folderId:1,folderName:'Manuals',originalFilename:'Manual.pdf',displayFilename:'Manual.pdf',extension:'.pdf',mimeType:'application/pdf',sizeBytes:2048,description:'',revision:'A',uploadedAt:'2026-07-23T12:00:00Z',updatedAt:'2026-07-23T12:00:00Z',uploadedBy:'Setup Tester',openUrl:'/open',downloadUrl:'/download',canPrint:true}]}}));
}
function sectionByTitle(detail:Locator,title:string) {
  const pattern = new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`);
  return detail.locator('.machine-detail-section-title').filter({hasText:pattern}).locator('xpath=ancestor::article[1]');
}

test('shared category accents and searchable Setup Type remain responsive and persistent',async({page}) => {
  await mockMachineLibrary(page);
  await page.goto('/machine-library');

  await page.getByRole('button',{name:'Add Machine Asset'}).click();
  const setupDialog = page.getByRole('dialog').filter({hasText:'Machine Injection Setup'});
  const addSetup = setupDialog.getByRole('combobox',{name:'Setup Type *'});
  await addSetup.fill('vertical');
  await expect(setupDialog.getByRole('option',{name:'Vertical Insert Molding'})).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(addSetup).toHaveValue('Vertical Insert Molding');
  await setupDialog.getByRole('button',{name:'Continue'}).click();
  const editor = page.locator('.machine-editor-modal');
  await expect(editor.getByRole('combobox',{name:'Setup Type *'})).toHaveValue('Vertical Insert Molding');
  await editor.getByRole('button',{name:'Close'}).click();

  await page.locator('.machine-asset-card .machine-card-brand-name').click();
  const detail = page.locator('.machine-detail-modal');
  await expect(detail.locator('.machine-detail-summary-card',{hasText:'Setup'})).toContainText('Multi-Component / Multi-Material');

  await expect(sectionByTitle(detail,'Basic Info')).toHaveAttribute('data-category-accent','basic');
  await expect(sectionByTitle(detail,'Electrical / Dimensions')).toHaveAttribute('data-category-accent','electrical');
  await expect(sectionByTitle(detail,'Screw')).toHaveAttribute('data-category-accent','screw');
  await expect(sectionByTitle(detail,'Screw Tip')).toHaveAttribute('data-category-accent','screw');
  await expect(sectionByTitle(detail,'Barrel')).toHaveAttribute('data-category-accent','barrel');
  await expect(sectionByTitle(detail,'Barrel End Cap')).toHaveAttribute('data-category-accent','barrel');
  await expect(sectionByTitle(detail,'Injection Unit 2 Screw')).toHaveAttribute('data-category-accent','screw-secondary');
  await expect(sectionByTitle(detail,'Injection Unit 2 Barrel')).toHaveAttribute('data-category-accent','barrel-secondary');
  await expect(sectionByTitle(detail,'Plunger')).toHaveAttribute('data-category-accent','plunger');
  await expect(sectionByTitle(detail,'Preventive Maintenance Tracking')).toHaveAttribute('data-category-accent','pm');
  const library = sectionByTitle(detail,'Asset Document Library');
  await expect(library).toHaveAttribute('data-category-accent','library');
  await expect(library.locator('.mcc-summary-token--folder')).toHaveText('1 folder');
  await expect(library.locator('.mcc-summary-token--document')).toHaveText('1 document');
  await expect(sectionByTitle(detail,'Asset Notes & Attachments')).toHaveAttribute('data-category-accent','notes');
  await expect(detail.locator('[data-category-accent="inspection"]')).toHaveCount(1);

  const libraryToggle = library.getByRole('button',{name:/Asset Document Library/});
  await libraryToggle.focus();
  await page.keyboard.press('Enter');
  await expect(libraryToggle).toHaveAttribute('aria-expanded','true');
  await page.keyboard.press('Space');
  await expect(libraryToggle).toHaveAttribute('aria-expanded','false');

  const basic = sectionByTitle(detail,'Basic Info');
  await basic.getByRole('button',{name:'Edit'}).click();
  const setupCombo = basic.getByRole('combobox',{name:'Setup Type *'});
  await setupCombo.fill('2K');
  await expect(basic.getByRole('option',{name:'Two-Shot / 2K Injection'})).toBeVisible();
  await setupCombo.fill('LSR');
  await expect(basic.getByRole('option',{name:'Liquid Silicone Rubber (LSR)'})).toBeVisible();
  await setupCombo.fill('Other');
  await basic.getByRole('option',{name:'Other / Custom'}).click();
  await basic.getByRole('button',{name:'Save'}).click();
  await expect(basic.getByRole('alert')).toContainText('valid Setup Type');
  await basic.getByLabel('Custom Setup Type *').fill('Robotic Rotary Multi-Material Cell');
  await basic.getByRole('button',{name:'Save'}).click();
  await expect(detail.locator('.machine-detail-summary-card',{hasText:'Setup'})).toContainText('Robotic Rotary Multi-Material Cell');

  await page.reload();
  await page.locator('.machine-asset-card .machine-card-brand-name').click();
  await expect(page.locator('.machine-detail-summary-card',{hasText:'Setup'})).toContainText('Robotic Rotary Multi-Material Cell');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});
