import {expect,test,type Page} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {owner,password,request} from './helpers/security-process.mjs';
import {inspectionFixture} from './helpers/inspection-records-fixture.mjs';
import {seedMachineHistory} from './helpers/machine-archive-data.mjs';
import JSZip from '../backend/node_modules/jszip/lib/index.js';

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
  await expect(page.getByRole('button',{name:'Export History',exact:true})).toHaveCount(administrative?1:0);
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
    await page.screenshot({path:testInfo.outputPath('retirement-dialog.png'),fullPage:true});
    await dialog.getByRole('button',{name:'Confirm Archive',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(page.getByText('Lifecycle: Archived',{exact:true})).toBeVisible();
    await page.goto(`${runtime.base}/machine-library`);await page.getByRole('button',{name:'Old Machines Archive',exact:true}).click();
    if(isMobile)await page.getByRole('button',{name:'Search',exact:true}).click();
    await page.getByRole(isMobile?'searchbox':'textbox',{name:'Search assets',exact:true}).fill('Synthetic replacement archive');
    await expect(page.getByRole('button',{name:'View details for ARCHIVE-QA',exact:true})).toBeVisible();
    if(isMobile){await page.getByRole('button',{name:'Machine Library',exact:true}).tap();await expect(page.getByRole('button',{name:'Machine Library',exact:true})).toHaveAttribute('aria-pressed','true');await page.getByRole('button',{name:'Old Machines Archive',exact:true}).tap();await expect(page.getByRole('button',{name:'View details for ARCHIVE-QA',exact:true})).toBeVisible();}
    await page.screenshot({path:testInfo.outputPath('archive-search.png'),fullPage:true});
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

test('history ZIP uses save picker, discloses legacy coverage, cancels writes, reports errors and supports download fallback',async({page},testInfo)=>{
  const {runtime,id}=await realRuntime(page,'machine-history-browser');
  try{
    await page.getByRole('button',{name:'View details for ARCHIVE-QA',exact:true}).click();
    await page.evaluate(async()=>{
      localStorage.setItem('mcc:screw-barrel-inspection-records:v3',JSON.stringify([{id:'legacy-qa',assetId:'1',assetNumber:'ARCHIVE-QA',storage:'browser',name:'Browser-only.txt'}]));
      await new Promise<void>((resolve,reject)=>{const request=indexedDB.open('mcc-measurement-inspection-logs',1);request.onupgradeneeded=()=>request.result.createObjectStore('files',{keyPath:'id'});request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;const tx=db.transaction('files','readwrite');tx.objectStore('files').put({id:'unmapped-qa',name:'Orphan-inspection.txt',blob:new Blob(['Unmapped browser inspection'])});tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(tx.error);};};});
      const state={bytes:0,closed:false,aborted:false,suggested:'',hold:false,activated:false};(window as any).qaSave=state;
      (window as any).showSaveFilePicker=async(options:any)=>{state.activated=navigator.userActivation.isActive;state.suggested=options.suggestedName;return{createWritable:async()=>({write:async(bytes:Uint8Array)=>{state.bytes+=bytes.length;if(state.hold)await new Promise(resolve=>{(window as any).releaseWrite=resolve;});},close:async()=>{state.closed=true;},abort:async()=>{state.aborted=true;}})};};
    });
    await page.getByRole('button',{name:'Retire / Archive Machine',exact:true}).click();
    const retirement=page.getByRole('dialog',{name:'Retire / Archive Machine',exact:true});await retirement.getByRole('combobox',{name:'Retirement Reason *',exact:true}).selectOption('other');await retirement.getByRole('textbox',{name:'Explanation *',exact:true}).fill('Keep retirement draft while exporting');
    const exportRequest=page.waitForRequest(request=>request.url().includes('/history-export.zip?'));
    await retirement.getByRole('button',{name:'Export History',exact:true}).click();
    const progress=page.getByRole('dialog',{name:'Machine History Export',exact:true});await expect(progress.getByText(/ZIP saved/)).toBeVisible();
    const query=new URL((await exportRequest).url()).searchParams;expect(query.get('legacyCount')).toBe('1');expect(query.get('unmappedFiles')).toBe('1');expect(query.get('legacyChecked')).toBe('1');
    const saved=await page.evaluate(()=>(window as any).qaSave);expect(saved.bytes).toBeGreaterThan(1000);expect(saved.closed).toBe(true);expect(saved.activated).toBe(true);expect(saved.suggested).toMatch(/History\.zip$/);
    await expect(progress.getByText(/browser-only records/)).toBeVisible();await page.screenshot({path:testInfo.outputPath('export-result.png'),fullPage:true});
    expect(await progress.locator('.library-upload-progress strong').evaluate(element=>getComputedStyle(element).whiteSpace)).toBe('normal');
    await progress.getByRole('button',{name:'Close',exact:true}).click();
    await expect(retirement.getByRole('textbox',{name:'Explanation *',exact:true})).toHaveValue('Keep retirement draft while exporting');await retirement.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.getByText('Lifecycle: Active',{exact:true})).toBeVisible();
    await page.evaluate(()=>{(window as any).qaSave.hold=true;});await page.getByRole('button',{name:'Export History',exact:true}).click();
    await expect(progress.getByText('Saving the history ZIP…',{exact:true})).toBeVisible();
    await progress.getByRole('button',{name:'Cancel Export',exact:true}).click();await page.evaluate(()=>(window as any).releaseWrite?.());
    await expect(progress.getByText('History export cancelled.',{exact:true})).toBeVisible();expect(await page.evaluate(()=>(window as any).qaSave.aborted)).toBe(true);await progress.getByRole('button',{name:'Close',exact:true}).click();
    await page.route('**/history-export.zip?*',route=>route.fulfill({status:507,json:{ok:false,error:'There is insufficient temporary storage for a safe history snapshot.'}}));
    await page.getByRole('button',{name:'Export History',exact:true}).click();await expect(progress.getByRole('alert')).toHaveText(/insufficient temporary storage/);await progress.getByRole('button',{name:'Close',exact:true}).click();await page.unroute('**/history-export.zip?*');
    await page.evaluate(()=>{delete(window as any).showSaveFilePicker;});
    const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Export History',exact:true}).click();const download=await downloadPromise;
    const zipPath=testInfo.outputPath('history.zip');
    expect(download.suggestedFilename()).toMatch(/History\.zip$/);await download.saveAs(zipPath);expect(await download.failure()).toBeNull();
    const zip=await JSZip.loadAsync(fs.readFileSync(zipPath));const manifest=JSON.parse(await zip.file(Object.keys(zip.files).find(name=>name.endsWith('/MANIFEST.json'))!)!.async('string'));
    expect(manifest.coverage.browserInspectionRecords).toMatchObject({checked:true,recordCount:1,unmappedFiles:1});expect(manifest.coverage.completeAvailableHistory).toBe(false);expect(manifest.entries.some((entry:any)=>entry.originalFilename==='Browser-only.txt'||entry.originalFilename==='Orphan-inspection.txt')).toBe(false);
    await expect(progress.getByText(/browser manages download progress and cancellation/)).toBeVisible();
    await progress.getByRole('button',{name:'Close',exact:true}).focus();await page.keyboard.press('Tab');await expect(progress.getByRole('button',{name:'Close',exact:true})).toBeFocused();await page.keyboard.press('Escape');await expect(progress).toHaveCount(0);
  }finally{await runtime.close();}
});
