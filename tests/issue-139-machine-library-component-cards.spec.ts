import { expect, type Page, test } from '@playwright/test';
const fixture = {
  id:96,assetNumber:'45',assetName:'Primary Production Press',brand:'Toyo',model:'TM-450',serialNumber:'SN-45',machineYear:'2018',machineType:'Injection Molding Machine',powerType:'Electric',setupType:'Standard Injection',shotSizeOz:18.5,tonnage:450,barrelDiameter:'55 mm',location:'Molding Cell 4',department:'Molding',status:'active',voltageValue:'480',voltageType:'AC',fullLoadAmp:'320',machineLength:'24 ft',machineWidth:'9 ft',machineHeight:'10 ft',fullDieHeightLength:'52 in',screwType:'General Purpose',screwTipType:'Sliding Ring',screwTipInstalledDate:'2025-01-15',screwInstalledDate:'2024-02-29',barrelInstalledDate:'2023-06-10',barrelEndCapInstalledDate:'2025-02-20',barrelLength:'112 in',screwLength:'108 in',screwRebuildRepaired:false,barrelRebuildRepaired:false,screwConditionStatus:'used',barrelConditionStatus:'used',hasDoubleShotInjection:false,hasPlungerInjection:false,screw2Type:'',screw2TipType:'',screw2RebuildRepaired:false,screw2ConditionStatus:'new',screw2InstalledDate:'',screw2TipInstalledDate:'',screw2Length:'',barrel2Diameter:'',barrel2RebuildRepaired:false,barrel2ConditionStatus:'new',barrel2InstalledDate:'',barrel2EndCapInstalledDate:'',barrel2Length:'',plungerType:'',plungerRebuildRepaired:false,plungerConditionStatus:'new',plungerInstalledDate:'',plungerLength:'',plungerDiameter:'',plungerBarrelType:'',plungerBarrelRebuildRepaired:false,plungerBarrelConditionStatus:'new',plungerBarrelInstalledDate:'',plungerBarrelEndCapInstalledDate:'',plungerBarrelLength:'',plungerBarrelDiameter:'',notes:'',criticalNotes:'',brandColorHex:'#1E6BFF',createdAt:'2026-01-01T12:00:00Z',updatedAt:'2026-07-23T12:00:00Z',pmSummary:null,historyPreview:[],
};

async function openAsset(page:Page,canEdit=true,overrides:Partial<typeof fixture>={}) {
  let asset = {...fixture,...overrides};
  let writes = 0;
  await page.route('**/api/auth/status',route=>route.fulfill({json:{setupRequired:false,user:{id:1,fullName:'Component Tester',email:'cards@example.com',role:canEdit?'Admin':'Maintenance Tech 1',isOwnerAdmin:canEdit,forcePasswordChange:false}}}));
  await page.route(/\/api\/machine-library\/assets(?:\?.*)?$/,route=>route.fulfill({json:{ok:true,assets:[asset],brandSettings:[],permissions:{canEdit,canDelete:canEdit}}}));
  await page.route(/\/api\/machine-library\/assets\/96$/,async route=>{
    if(route.request().method()!=='PUT')return route.fallback();
    writes++;
    asset={...asset,...route.request().postDataJSON()};
    await route.fulfill({json:{ok:true,asset}});
  });
  await page.route(/\/api\/machine-library\/assets\/96\/(inspection-records|component-images|notes|preventive-maintenance|documents|document-folders)$/,route=>route.fulfill({json:{ok:true,records:[],images:[],notes:[],tasks:[],folders:[],documents:[],summary:{total:0,folderCount:0,documentCount:0}}}));
  await page.goto('/machine-library');
  await page.locator('.machine-asset-card .machine-card-brand-name').click();
  return {panel:page.locator('.machine-record-accordion'),writes:()=>writes};
}

test('four cards reuse component edits, images and saved summaries inside Inspection Records',async({page})=>{
  const {panel,writes}=await openAsset(page);
  for(const name of ['Screw','Screw Tip','Barrel','Barrel End Cap']) {
    await expect(page.locator('.machine-detail-accordion-list .machine-detail-section-title').filter({hasText:new RegExp(`^${name}$`)})).toHaveCount(0);
    await expect(panel.getByRole('button',{name:`Edit ${name} component`,exact:true})).toBeVisible();
  }
  const screw=panel.getByRole('button',{name:'Edit Screw component',exact:true});
  for(const [name,value] of [['Screw',fixture.screwInstalledDate],['Screw Tip',fixture.screwTipInstalledDate],['Barrel',fixture.barrelInstalledDate],['Barrel End Cap',fixture.barrelEndCapInstalledDate]]) {
    const [year,month,day]=value.split('-').map(Number);
    const expectedAge=((Date.now()-new Date(year,month-1,day).getTime())/(365.25*24*60*60*1000)).toFixed(1);
    const card=panel.getByRole('button',{name:`Edit ${name} component`,exact:true});
    await expect(card).toContainText(`Age: ${expectedAge} years`);
    await expect(card).toContainText('Installed:');
  }
  await expect(panel.getByRole('button',{name:'Edit Barrel component',exact:true}).locator('.machine-inspection-component-summary-state')).toHaveText('Used / Size: 55 mm');
  await expect(panel.locator('.machine-inspection-component-summary-size')).toHaveCount(0);
  await screw.focus();
  await page.keyboard.press('Tab');
  const tip=panel.getByRole('button',{name:'Edit Screw Tip component',exact:true});
  await expect(tip).toBeFocused();
  expect(await tip.evaluate(el=>getComputedStyle(el).outlineStyle)).toBe('solid');
  await page.keyboard.press('Enter');
  await expect(panel.getByLabel('Screw Tip Type', {exact:true})).toHaveValue('Sliding Ring');
  await expect(panel.locator('.machine-component-image-card')).toBeVisible();
  await expect(panel.locator('.machine-component-image-card').getByRole('button',{name:'Upload Image',exact:true})).toBeVisible();
  await expect(panel.locator('.machine-component-image-card').getByRole('button',{name:'Take Photo',exact:true})).toBeVisible();
  await panel.getByLabel('Screw Tip Type',{exact:true}).fill('Updated Ring');
  await panel.getByRole('button',{name:'Save',exact:true}).click();
  await expect(tip).toContainText('Updated Ring');
  await screw.click();
  await expect(panel.locator('.machine-component-image-card')).toBeVisible();
  await expect(panel.locator('.machine-component-image-card').getByRole('button',{name:'Upload Image',exact:true})).toBeVisible();
  await expect(panel.locator('.machine-component-image-card').getByRole('button',{name:'Take Photo',exact:true})).toBeVisible();
  await panel.getByLabel('Screw Type',{exact:true}).fill('Updated Screw');
  await panel.getByRole('button',{name:'Save',exact:true}).click();
  await expect(screw).toContainText('Updated Screw');
  await panel.getByRole('button',{name:'Edit Barrel component',exact:true}).click();
  await panel.getByLabel('Barrel Diameter',{exact:true}).fill('63 mm');
  await panel.getByRole('button',{name:'Save',exact:true}).click();
  await expect(panel.getByRole('button',{name:'Edit Barrel component',exact:true}).locator('.machine-inspection-component-summary-state')).toHaveText('Used / Size: 63 mm');
  await panel.getByRole('button',{name:'Edit Barrel End Cap component',exact:true}).click();
  await expect(panel.getByRole('textbox',{name:/^Barrel End Cap Installed Date/})).toBeVisible();
  await panel.getByRole('textbox',{name:/^Barrel End Cap Installed Date/}).fill('01/15/2025');
  await panel.getByRole('button',{name:'Save',exact:true}).click();
  await expect(panel.getByRole('button',{name:'Edit Barrel End Cap component',exact:true})).toContainText('Jan 15, 2025');
  expect(writes()).toBe(4);
  await panel.getByRole('button',{name:/Screw & Barrel Inspection Records/}).click();
  for(const name of ['Upload File','Take Photo','Barrel & Screw Logs']) await expect(panel.getByRole('button',{name,exact:true})).toBeVisible();
  await expect(panel).toContainText('No inspection records yet.');
  await expect(page.getByRole('button',{name:'Print Asset Spec',exact:true})).toBeVisible();
});

test('Issue 173 combines the saved Barrel condition and size once without changing dates or permissions',async({page})=>{
  for(const item of [
    {diameter:'28mm',condition:'new',repaired:false,label:'New'},
    {diameter:'25mm',condition:'used',repaired:false,label:'Used'},
    {diameter:'63.5 mm',condition:'worn',repaired:false,label:'Worn'},
    {diameter:'90 / 95 mm',condition:'used',repaired:true,label:'Rebuilt / Repaired'},
  ]) {
    const {panel,writes}=await openAsset(page,false,{barrelDiameter:item.diameter,barrelConditionStatus:item.condition,barrelRebuildRepaired:item.repaired});
    const barrel=panel.getByRole('button',{name:'View Barrel component',exact:true});
    await expect(barrel.locator('.machine-inspection-component-summary-state')).toHaveText(`${item.label} / Size: ${item.diameter}`);
    expect((await barrel.textContent())!.split(`Size: ${item.diameter}`).length-1).toBe(1);
    await expect(barrel).toContainText('Age:');await expect(barrel).toContainText('Installed: Jun 10, 2023');
    await expect(barrel.locator('.machine-inspection-component-summary-size')).toHaveCount(0);
    await barrel.focus();await barrel.press('Enter');
    await expect(panel.getByRole('button',{name:'Save',exact:true})).toHaveCount(0);
    expect(writes()).toBe(0);
  }
});

test('Issue 173 omits empty, missing and whitespace-only Barrel sizes without a placeholder',async({page})=>{
  for(const diameter of ['',undefined,'   ']) {
    const {panel}=await openAsset(page,false,{barrelDiameter:diameter});
    const barrel=panel.getByRole('button',{name:'View Barrel component',exact:true});
    await expect(barrel.locator('.machine-inspection-component-summary-state')).toHaveText('Used');
    await expect(barrel).not.toContainText('Size:');await expect(barrel).not.toContainText('Unknown');
    await expect(barrel).toContainText('Age:');await expect(barrel).toContainText('Installed: Jun 10, 2023');
    await expect(barrel.locator('.machine-inspection-component-summary-size')).toHaveCount(0);
  }
});

test('unknown, invalid and future dates are safe and read-only cards cannot write',async({page})=>{
  const {panel,writes}=await openAsset(page,false,{screwInstalledDate:'',screwTipInstalledDate:'invalid',barrelInstalledDate:'2099-01-01',barrelEndCapInstalledDate:'2025-02-30'});
  const cards=panel.locator('.machine-inspection-component-summary-card');
  await expect(cards).toHaveCount(4);
  for(const card of await cards.all()) {
    await expect(card).toContainText('Age: Unknown');
    await expect(card).toContainText('Installed date unknown');
    await card.click();
    await expect(panel.getByRole('button',{name:'Save',exact:true})).toHaveCount(0);
    await expect(panel.getByRole('button',{name:'Edit',exact:true})).toHaveCount(0);
    await expect(panel.locator('input:not([type="file"])')).toHaveCount(0);
  }
  expect(writes()).toBe(0);
});

test('desktop, tablet and mobile cards wrap with readable touch targets and no overflow',async({page},testInfo)=>{
  const {panel}=await openAsset(page);
  for(const width of [1440,768,390,320]) {
    await page.setViewportSize({width,height:900});
    const boxes=await panel.locator('.machine-inspection-component-summary-card').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}));
    expect(boxes.every(box=>box.width>100&&box.height>=44)).toBeTruthy();
    expect(new Set(boxes.map(box=>Math.round(box.y))).size).toBe(width===1440?1:width===320?4:2);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await panel.screenshot({path:testInfo.outputPath(`component-cards-${width}.png`)});
  }
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect(panel.locator('.machine-inspection-component-summary-card').first()).toBeVisible();
});


test('component image viewers and replace controls remain reachable for Screw and Screw Tip',async({page})=>{
  const {panel}=await openAsset(page);
  const pixel='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
  await page.route(/\/api\/machine-library\/assets\/96\/component-images$/,route=>route.fulfill({json:{ok:true,images:['screw','screw-tip'].map((componentType,index)=>({id:index+1,assetId:96,componentType,filename:`${componentType}.png`,mimeType:'image/png',fileSize:68,uploadedAt:'2026-01-01T12:00:00Z',contentUrl:pixel,downloadUrl:pixel}))}}));
  for(const name of ['Screw','Screw Tip']) {
    await panel.getByRole('button',{name:`Edit ${name} component`,exact:true}).click();
    await panel.getByRole('button',{name:`Open full-size ${name} image`,exact:true}).click();
    const viewer=page.getByRole('dialog',{name:`${name} full-size image`,exact:true});
    await expect(viewer.getByRole('button',{name:'Download Image',exact:true})).toBeVisible();
    await expect(viewer.getByRole('button',{name:'Print / Save as PDF',exact:true})).toBeVisible();
    await viewer.getByRole('button',{name:'Replace Image',exact:true}).click();
    const replacement=page.locator('.component-image-replace-dialog');
    await expect(replacement.getByRole('button',{name:'Replace Without Saving',exact:true})).toBeVisible();
    await replacement.getByRole('button',{name:'Cancel',exact:true}).click();
    await viewer.getByRole('button',{name:'Close',exact:true}).first().click();
    await panel.getByRole('button',{name:'Cancel',exact:true}).click();
  }
});

test('component edits preserve validation, cancellation and a single draft',async({page})=>{
  const {panel,writes}=await openAsset(page);
  await panel.getByRole('button',{name:'Edit Screw component',exact:true}).click();
  await expect(panel.getByRole('button',{name:'Edit Barrel component',exact:true})).toBeDisabled();
  const date=panel.getByRole('textbox',{name:/^Screw Installed Date/});
  await date.fill('02/30/2025');
  await panel.getByRole('button',{name:'Save',exact:true}).click();
  await expect(panel.getByRole('alert')).toContainText('must be a valid date');
  expect(writes()).toBe(0);
  await panel.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(panel.getByRole('button',{name:'Edit Screw component',exact:true})).toContainText('Feb 29, 2024');
  await panel.getByRole('button',{name:'Edit Barrel component',exact:true}).focus();
  await page.keyboard.press('Space');
  await expect(panel.getByLabel('Barrel Diameter',{exact:true})).toHaveValue('55 mm');
  await panel.getByRole('button',{name:'Cancel',exact:true}).click();
});
