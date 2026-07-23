import { expect, type Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument } from '../backend/node_modules/pdf-lib/cjs/index.js';
const asset = {
  id:96,assetNumber:'45',assetName:'Primary Production Press',brand:'Toyo',model:'TM-450',serialNumber:'SN-45',machineYear:'2018',machineType:'Injection Molding Machine',powerType:'Electric',setupType:'Standard Injection',shotSizeOz:18.5,tonnage:450,barrelDiameter:'55 mm',location:'Molding Cell 4',department:'Molding',status:'active',voltageValue:'480',voltageType:'AC',fullLoadAmp:'320',machineLength:'24 ft',machineWidth:'9 ft',machineHeight:'10 ft',fullDieHeightLength:'52 in',screwType:'General Purpose',screwTipType:'Sliding Ring',screwTipInstalledDate:'2025-01-15',screwInstalledDate:'2024-02-29',barrelInstalledDate:'2023-06-10',barrelEndCapInstalledDate:'2025-02-20',barrelLength:'112 in',screwLength:'108 in',screwRebuildRepaired:false,barrelRebuildRepaired:false,screwConditionStatus:'used',barrelConditionStatus:'used',hasDoubleShotInjection:false,hasPlungerInjection:false,screw2Type:'',screw2TipType:'',screw2RebuildRepaired:false,screw2ConditionStatus:'new',screw2InstalledDate:'',screw2TipInstalledDate:'',screw2Length:'',barrel2Diameter:'',barrel2RebuildRepaired:false,barrel2ConditionStatus:'new',barrel2InstalledDate:'',barrel2EndCapInstalledDate:'',barrel2Length:'',plungerType:'',plungerRebuildRepaired:false,plungerConditionStatus:'new',plungerInstalledDate:'',plungerLength:'',plungerDiameter:'',plungerBarrelType:'',plungerBarrelRebuildRepaired:false,plungerBarrelConditionStatus:'new',plungerBarrelInstalledDate:'',plungerBarrelEndCapInstalledDate:'',plungerBarrelLength:'',plungerBarrelDiameter:'',notes:'',criticalNotes:'',brandColorHex:'#1E6BFF',createdAt:'2026-01-01T12:00:00Z',updatedAt:'2026-07-23T12:00:00Z',pmSummary:null,historyPreview:[],
};
const pmTasks = [
  {id:1,title:'Annual electrical inspection',intervalType:'annual',intervalLabel:'Annual',intervalValue:1,nextDueDate:'2027-01-15',nextDueMeter:null,scheduleStatus:'active',active:true,status:'Current'},
  {id:2,title:'Lubricate clamp system',intervalType:'monthly',intervalLabel:'Monthly',intervalValue:3,nextDueDate:'2026-10-15',nextDueMeter:null,scheduleStatus:'active',active:true,status:'Current'},
  {id:3,title:'Retired schedule',intervalType:'annual',intervalLabel:'Annual',intervalValue:1,nextDueDate:'2026-01-01',nextDueMeter:null,scheduleStatus:'inactive',active:false,status:'Inactive'},
];

async function mockMachineLibrary(page:Page) {
  const fixturePdf = await PDFDocument.create();
  fixturePdf.addPage([612,792]);
  const pdfBytes = Buffer.from(await fixturePdf.save());
  await page.route('**/api/auth/status',route=>route.fulfill({json:{setupRequired:false,user:{id:1,fullName:'Asset Spec Tester',email:'asset-spec@example.com',role:'Admin',isOwnerAdmin:true,forcePasswordChange:false}}}));
  await page.route(/\/api\/machine-library\/assets(?:\?.*)?$/,route=>route.fulfill({json:{ok:true,assets:[asset],brandSettings:[],permissions:{canEdit:true,canDelete:true}}}));
  await page.route(/\/api\/machine-library\/assets\/96\/preventive-maintenance$/,route=>route.fulfill({json:pmTasks}));
  await page.route(/\/api\/machine-library\/assets\/96\/specification\.pdf(?:\?.*)?$/,route=>route.fulfill({status:200,contentType:'application/pdf',headers:{'content-disposition':'attachment; filename="Press45_Machine_Asset_Specification_2026-07-23.pdf"'},body:pdfBytes}));
  await page.route(/\/api\/machine-library\/assets\/96\/notes$/,route=>route.fulfill({json:{ok:true,notes:[]}}));
  await page.route(/\/api\/machine-library\/assets\/96\/component-images$/,route=>route.fulfill({json:{ok:true,images:[]}}));
  await page.route(/\/api\/machine-library\/assets\/96\/inspection-records$/,route=>route.fulfill({json:{ok:true,records:[]}}));
  await page.route(/\/api\/machine-library\/assets\/96\/document-folders$/,route=>route.fulfill({json:{ok:true,folders:[],summary:{folderCount:0,documentCount:0}}}));
  await page.route(/\/api\/machine-library\/assets\/96\/documents$/,route=>route.fulfill({json:{ok:true,documents:[]}}));
}

test('Machine Asset Detail prints and downloads a compact one-page persisted specification',async({page},testInfo)=>{
  await mockMachineLibrary(page);
  await page.goto('/machine-library');
  await page.locator('.machine-asset-card .machine-card-brand-name').click();
  const detail = page.locator('.machine-detail-modal');
  await expect(detail.getByRole('button',{name:'Print Asset Spec'})).toBeVisible();
  await expect(detail.getByRole('button',{name:'Download Spec PDF'})).toBeVisible();

  const directDownload = page.waitForEvent('download');
  await detail.getByRole('button',{name:'Download Spec PDF'}).click();
  expect((await directDownload).suggestedFilename()).toBe('Press45_Machine_Asset_Specification_2026-07-23.pdf');

  await detail.getByRole('button',{name:'Print Asset Spec'}).click();
  const preview = page.getByRole('dialog',{name:'Machine Asset Specification'});
  const sheet = preview.getByTestId('machine-asset-spec-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('WO# / Reference');
  await expect(sheet).toContainText('Primary Production Press');
  await expect(sheet).toContainText('Asset Number45');
  await expect(sheet).toContainText('Machine Year / Age2018 /');
  await expect(sheet).toContainText('Electrical / Dimensions');
  await expect(sheet).toContainText('ScrewCondition: Used');
  await expect(sheet).toContainText('Screw TipType: Sliding Ring');
  await expect(sheet).toContainText('BarrelCondition: Used');
  await expect(sheet).toContainText('Barrel End Cap');
  await expect(sheet).toContainText('in service');
  await expect(sheet).toContainText('Annual electrical inspection');
  await expect(sheet).toContainText('Lubricate clamp system');
  await expect(sheet).not.toContainText('Retired schedule');
  await expect(sheet).toContainText('Technician Notes');
  await expect(sheet).toContainText('Technician Signature');
  await expect(sheet).not.toContainText('JBT');
  await expect(preview.getByRole('button',{name:'Print / Save as PDF'})).toBeVisible();
  await expect(preview.getByRole('button',{name:'Download Spec PDF'})).toBeVisible();

  const printPdf = await page.pdf({format:'Letter',preferCSSPageSize:true,printBackground:true});
  const parsed = await PDFDocument.load(printPdf);
  expect(parsed.getPageCount()).toBe(1);
  if (process.env.MCC_KEEP_ASSET_SPEC_ARTIFACTS === '1') {
    const output = path.resolve('output','pdf');
    fs.mkdirSync(output,{recursive:true});
    fs.writeFileSync(path.join(output,`Press45_Machine_Asset_Specification_2026-07-23_${testInfo.project.name}.pdf`),printPdf);
    await sheet.screenshot({path:path.join(output,`Press45_Machine_Asset_Specification_2026-07-23_${testInfo.project.name}.png`)});
  }
  await testInfo.attach(`machine-asset-spec-${testInfo.project.name}.pdf`,{body:printPdf,contentType:'application/pdf'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

  const previewDownload = page.waitForEvent('download');
  await preview.getByRole('button',{name:'Download Spec PDF'}).click();
  expect((await previewDownload).suggestedFilename()).toBe('Press45_Machine_Asset_Specification_2026-07-23.pdf');
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
  await expect(detail).toBeVisible();
});
