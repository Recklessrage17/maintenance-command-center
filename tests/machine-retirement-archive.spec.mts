import {expect,test,type Page} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {owner,password,request,root} from './helpers/security-process.mjs';
import {inspectionFixture} from './helpers/inspection-records-fixture.mjs';
import {seedMachineHistory} from './helpers/machine-archive-data.mjs';

const asset={...Object.fromEntries(['screwType','screwTipType','screwInstalledDate','screwTipInstalledDate','barrelInstalledDate','barrelEndCapInstalledDate','screwLength','barrelLength','screw2Type','screw2TipType','screw2InstalledDate','screw2TipInstalledDate','screw2Length','barrel2InstalledDate','barrel2EndCapInstalledDate','barrel2Diameter','barrel2Length','plungerType','plungerInstalledDate','plungerLength','plungerDiameter','plungerBarrelType','plungerBarrelInstalledDate','plungerBarrelEndCapInstalledDate','plungerBarrelLength','plungerBarrelDiameter','notes','criticalNotes','machineLength','machineWidth','machineHeight','fullDieHeightLength','voltageValue','voltageType','fullLoadAmp'].map(key=>[key,''])),id:1,assetNumber:'ARCHIVE-QA',assetName:'Synthetic Retirement Press',brand:'MCC',model:'Local',serialNumber:'QA-ONLY',machineYear:'2020',machineType:'Injection Molding Machine',powerType:'Electric',setupType:'Standard Injection',shotSizeOz:12,tonnage:300,barrelDiameter:'40 mm',status:'active',location:'Disposable Cell',department:'QA',screwConditionStatus:'used',barrelConditionStatus:'used',hasDoubleShotInjection:false,hasPlungerInjection:false,createdAt:'2025-01-01T12:00:00Z',updatedAt:'2025-01-01T12:00:00Z',brandColorHex:'#44D7FF',historyPreview:[],pmSummary:null,lifecycleStatus:'archived',lifecycleRevision:1,retirementReason:'replaced',retirementNotes:'Synthetic archived machine',retiredAt:'2025-01-01T12:00:00Z',retiredBy:'Synthetic Manager',replacementMachineId:2,replacementMachine:{id:2,assetNumber:'NEW-QA',assetName:'Replacement',lifecycleStatus:'active'}};
function observations(page:Page){const errors:string[]=[],requests:string[]=[],failed:string[]=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});page.on('request',request=>requests.push(`${request.method()} ${request.url()}`));page.on('requestfailed',request=>failed.push(`${request.url()} ${request.failure()?.errorText}`));return{errors,requests,failed};}

for(const role of ['Maintenance Tech 1','Maintenance Tech 2','Maintenance Tech 3','Manager','Admin','Owner Admin'])test(`${role} archive controls respect administrative roles even with general edit permissions`,async({page})=>{
  const observed=observations(page);
  await page.route('**/api/**',route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/api/auth/status')return route.fulfill({json:{setupRequired:false,user:{id:1,fullName:'Synthetic Tester',email:'qa@example.test',role:role==='Owner Admin'?'Admin':role,isOwnerAdmin:role==='Owner Admin',forcePasswordChange:false}}});
    if(url.pathname==='/api/machine-library/assets')return route.fulfill({json:{ok:true,assets:url.searchParams.get('lifecycle')==='archived'?[asset]:[],brandSettings:[],permissions:{canEdit:true,canDelete:true,canManagePm:true}}});
    if(url.pathname==='/api/machine-library/assets/1')return route.fulfill({json:{ok:true,asset}});
    return route.fulfill({json:{ok:true,records:[],notes:[],images:[],folders:[],documents:[],tasks:[],summary:{}}});
  });
  await page.goto('/machine-library');await page.getByRole('button',{name:'Old Machines Archive',exact:true}).click();
  await expect(page.getByRole('button',{name:'Old Machines Archive',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('button',{name:'Add Machine Asset',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'View details for ARCHIVE-QA',exact:true}).click();
  const administrative=['Manager','Admin','Owner Admin'].includes(role);
  await expect(page.getByRole('button',{name:'Retire / Archive Machine',exact:true})).toHaveCount(administrative?1:0);
  await expect(page.getByRole('button',{name:'Restore Machine',exact:true})).toHaveCount(administrative?1:0);
  await expect(page.getByRole('button',{name:'Export History',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Replacement: NEW-QA',exact:true})).toBeVisible();
  expect(observed.errors).toEqual([]);expect(observed.requests.some(line=>line.startsWith('DELETE')||line.includes('/lifecycle'))).toBe(false);
});

async function realRuntime(page:Page,label:string){
  const runtime=await inspectionFixture(label,{serveFrontend:true});
  try{
    const cookie=await owner(runtime.base);
    const result=await request(runtime.base,'/api/machine-library/assets',{method:'POST',cookie,body:{assetNumber:'ARCHIVE-QA',assetName:'Synthetic Retirement Press',brand:'MCC',model:'Local',serialNumber:'QA-ONLY',status:'active'}});
    expect(result.response.status).toBe(201);
    const other=await request(runtime.base,'/api/machine-library/assets',{method:'POST',cookie,body:{assetNumber:'NEW-QA',assetName:'Synthetic Replacement',brand:'MCC',status:'active'}});
    const db=new DatabaseSync(path.join(runtime.fixture,'data/mcc.sqlite'));
    const data=seedMachineHistory(db,runtime,result.data.asset.id,other.data.asset.id);db.close();
    await page.context().addCookies([{name:cookie.split('=')[0],value:cookie.slice(cookie.indexOf('=')+1),url:runtime.base}]);
    await page.goto(`${runtime.base}/machine-library`);
    return{runtime,id:result.data.asset.id,data,cookie};
  }catch(error){await runtime.close();throw error;}
}
test('retirement pending state prevents duplicate submissions and retains the draft after a stale-request error',async({page})=>{
  let submissions=0;let pending:any;
  await page.route('**/api/**',route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/api/auth/status')return route.fulfill({json:{setupRequired:false,user:{id:1,fullName:'Synthetic Manager',email:'manager@example.test',role:'Manager',forcePasswordChange:false}}});
    if(url.pathname==='/api/machine-library/assets')return route.fulfill({json:{ok:true,assets:[{...asset,lifecycleStatus:'active',lifecycleRevision:0,retirementReason:'',retirementNotes:'',replacementMachine:null,replacementMachineId:null}],brandSettings:[],permissions:{canEdit:true,canManagePm:true}}});
    if(url.pathname.endsWith('/lifecycle')){submissions++;pending=route;return;}
    return route.fulfill({json:{ok:true,records:[],notes:[],images:[],folders:[],documents:[],tasks:[],summary:{}}});
  });
  await page.goto('/machine-library');await page.getByRole('button',{name:'View details for ARCHIVE-QA',exact:true}).click();await page.getByRole('button',{name:'Retire / Archive Machine',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Retire / Archive Machine',exact:true});
  await dialog.getByRole('combobox',{name:'Retirement Reason *',exact:true}).selectOption('other');await dialog.getByRole('textbox',{name:'Explanation *',exact:true}).fill('Keep this reason after a failed request');
  await dialog.getByRole('button',{name:'Confirm Archive',exact:true}).click();await expect(dialog.getByRole('button',{name:'Saving…',exact:true})).toBeDisabled();
  await dialog.evaluate(form=>{form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
  await expect.poll(()=>submissions).toBe(1);await page.keyboard.press('Tab');await expect(dialog).toBeFocused();await page.keyboard.press('Escape');await expect(dialog).toBeVisible();await expect(dialog.getByRole('button',{name:'Cancel',exact:true})).toBeDisabled();
  await pending.fulfill({status:409,json:{ok:false,error:'This machine changed. Refresh it and review the action again.',code:'LIFECYCLE_STALE'}});
  await expect(dialog.getByRole('alert')).toHaveText(/This machine changed/);await expect(dialog.getByRole('textbox',{name:'Explanation *',exact:true})).toHaveValue('Keep this reason after a failed request');
  await expect(dialog.getByRole('button',{name:'Confirm Archive',exact:true})).toBeEnabled();expect(submissions).toBe(1);await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(page.getByRole('button',{name:'Retire / Archive Machine',exact:true})).toBeFocused();
});
test('archive, search, replacement navigation and restore preserve records with keyboard and mobile dialogs',async({page,isMobile},testInfo)=>{
  const observed=observations(page);const {runtime,id,data,cookie}=await realRuntime(page,'machine-archive-browser');
  try{
    await page.getByRole('button',{name:'View details for ARCHIVE-QA',exact:true}).click();
    await page.getByRole('button',{name:'Retire / Archive Machine',exact:true}).click();
    let dialog=page.getByRole('dialog',{name:'Retire / Archive Machine',exact:true});
    await expect(dialog.getByRole('combobox',{name:'Action',exact:true})).toBeFocused();
    await expect(dialog.getByRole('button',{name:'Confirm Archive',exact:true})).toBeDisabled();
    await dialog.getByRole('combobox',{name:'Retirement Reason *',exact:true}).selectOption('other');
    await expect(dialog.getByRole('button',{name:'Confirm Archive',exact:true})).toBeDisabled();
    await dialog.getByRole('textbox',{name:'Explanation *',exact:true}).fill('Synthetic preservation check');
    await dialog.getByRole('button',{name:'Confirm Archive',exact:true}).focus();await page.keyboard.press('Tab');await expect(dialog.getByRole('combobox',{name:'Action',exact:true})).toBeFocused();
    await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(page.getByRole('button',{name:'Retire / Archive Machine',exact:true})).toBeFocused();
    await page.getByRole('button',{name:'Retire / Archive Machine',exact:true}).click();dialog=page.getByRole('dialog',{name:'Retire / Archive Machine',exact:true});
    await dialog.getByRole('combobox',{name:'Retirement Reason *',exact:true}).selectOption('replaced');
    await expect(dialog.getByRole('combobox',{name:'Replacement Machine (optional)',exact:true}).locator('option',{hasText:'ARCHIVE-QA'})).toHaveCount(0);
    await dialog.getByRole('combobox',{name:'Replacement Machine (optional)',exact:true}).selectOption({label:'NEW-QA · Synthetic Replacement'});
    await dialog.getByRole('textbox',{name:'Retirement Notes',exact:true}).fill('Synthetic replacement archive');
    const screenshotDir=path.join(root,'output/machine-archive/screenshots');fs.mkdirSync(screenshotDir,{recursive:true});
    await page.screenshot({path:path.join(screenshotDir,`${testInfo.project.name}-retirement-dialog.png`),fullPage:true});
    await dialog.getByRole('button',{name:'Confirm Archive',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(page.getByText('Lifecycle: Archived',{exact:true})).toBeVisible();
    await page.goto(`${runtime.base}/machine-library`);await page.getByRole('button',{name:'Old Machines Archive',exact:true}).click();
    if(isMobile)await page.getByRole('button',{name:'Search',exact:true}).click();
    await page.getByRole(isMobile?'searchbox':'textbox',{name:'Search assets',exact:true}).fill('Synthetic replacement archive');
    await expect(page.getByRole('button',{name:'View details for ARCHIVE-QA',exact:true})).toBeVisible();
    if(isMobile){await page.getByRole('button',{name:'Machine Library',exact:true}).tap();await expect(page.getByRole('button',{name:'Machine Library',exact:true})).toHaveAttribute('aria-pressed','true');await page.getByRole('button',{name:'Old Machines Archive',exact:true}).tap();await expect(page.getByRole('button',{name:'View details for ARCHIVE-QA',exact:true})).toBeVisible();}
    await page.screenshot({path:path.join(screenshotDir,`${testInfo.project.name}-archive-search.png`),fullPage:true});
    await page.getByRole('button',{name:'View details for ARCHIVE-QA',exact:true}).click();
    await page.getByRole('button',{name:'Replacement: NEW-QA',exact:true}).click();await expect(page.getByText('Lifecycle: Active',{exact:true})).toBeVisible();
    await page.goto(`${runtime.base}/machine-library?asset=${id}`);await expect(page.getByText('Lifecycle: Archived',{exact:true})).toBeVisible();
    // Real historical inspection list survives archiving and year selection.
    await page.getByRole('button',{name:/Screw.*Barrel Inspection Records/}).click();
    await page.getByRole('button',{name:'Barrel & Screw Logs',exact:true}).first().click();
    await expect(page.locator('.measurement-records-panel')).toBeVisible();
    await page.locator('.measurement-year-folder').filter({hasText:'2024'}).click();await expect(page.getByText('Inspection-original.txt',{exact:true})).toBeVisible();
    await expect(page.locator('.measurement-folder-row').getByRole('button',{name:/delete|remove|^x$/i})).toHaveCount(0);
    await page.keyboard.press('Escape');
    // Reload returns to the archived identity without depending on list presence.
    await page.goto(`${runtime.base}/machine-library?asset=${id}`);await page.getByRole('button',{name:'Restore Machine',exact:true}).click();
    dialog=page.getByRole('dialog',{name:'Restore Machine',exact:true});await dialog.getByRole('textbox',{name:'Restore Reason *',exact:true}).fill('Synthetic recommission');
    await dialog.getByRole('button',{name:'Confirm Restore',exact:true}).click();await expect(page.getByText('Lifecycle: Active',{exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Retire / Archive Machine',exact:true})).toBeFocused();
    const records=await request(runtime.base,`/api/machine-library/assets/${id}/inspection-records`,{cookie});expect(records.data.records).toHaveLength(1);
    await page.goto(`${runtime.base}/machine-library`);await expect(page.getByRole('button',{name:'View details for ARCHIVE-QA',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Old Machines Archive',exact:true}).click();await expect(page.getByText('No machine assets found.',{exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    expect(observed.errors).toEqual([]);expect(observed.requests.filter(line=>line.startsWith('DELETE'))).toEqual([]);
    await testInfo.attach('browser-review.json',{body:JSON.stringify(observed,null,2),contentType:'application/json'});
  }finally{await runtime.close();}
});
