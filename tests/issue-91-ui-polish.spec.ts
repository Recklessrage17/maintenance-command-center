import { expect, type Page, test } from '@playwright/test';

const user={id:1,fullName:'Issue 91 Operator',email:'operator@example.com',role:'Admin',isOwnerAdmin:true,forcePasswordChange:false,effectivePermissions:['inventory.view','vendors.view','requisitions.view','history.view','machine.view','equipment.view','facility.view']};
const machine={id:91,assetNumber:'Press 91',assetName:'Issue Press',brand:'Toyo',model:'SI-350',serialNumber:'MCC-091',machineYear:'2019',machineType:'Injection Molding Machine',setupType:'Standard Injection',barrelDiameter:'42 mm',location:'Bay 1',department:'Molding',status:'active',brandColorHex:'#44D7FF',pmSummary:{total:1,status:'current',label:'PM: Current'},historyPreview:[]};
const equipment={id:92,assetNumber:'EQ-092',equipmentName:'Process Chiller',assetName:'Process Chiller',category:'Chiller',equipmentType:'Air Cooled',manufacturer:'Advantage',brand:'Advantage',model:'MK-7',serialNumber:'EQ-SN-92',equipmentYear:'2021',year:'2021',location:'Utility Room',department:'Facilities',status:'active',criticality:'high',powerType:'Electric',voltage:'480 VAC',phase:'3 phase',amperage:'',airRequirement:'',waterRequirement:'',capacityRating:'',dimensions:'',weight:'',specificationNotes:'',createdAt:'2026-08-01T12:00:00Z',updatedAt:'2026-08-19T12:00:00Z',pmSummary:null,latestHistory:null};

async function mockIssue91(page:Page,{initiallyAuthenticated=false,failVerification=false,holdInitialAuth=false}={}){
  let authenticated=initiallyAuthenticated;
  let initialAuthReleased=!holdInitialAuth;
  let releaseInitialAuthGate:()=>void=()=>{};
  const initialAuthGate=new Promise<void>(resolve=>{releaseInitialAuthGate=resolve;});
  let holdVerification=false;
  let releaseVerification:undefined|(()=>void);
  let verificationShouldFail=failVerification;
  await page.route('**/api/**',async route=>{
    const request=route.request();const path=new URL(request.url()).pathname;
    if(path==='/api/auth/status'){
      if(!authenticated&&!initialAuthReleased)await initialAuthGate;
      if(authenticated&&holdVerification)await new Promise<void>(resolve=>{releaseVerification=resolve;});
      if(authenticated&&verificationShouldFail){verificationShouldFail=false;return route.fulfill({status:503,json:{error:'Initialization service unavailable.'}});}
      return route.fulfill({json:{setupRequired:false,user:authenticated?user:null}});
    }
    if(path==='/api/auth/login'){authenticated=true;holdVerification=true;return route.fulfill({json:{user}});}
    if(path==='/api/auth/logout'){authenticated=false;holdVerification=false;return route.fulfill({json:{ok:true}});}
    if(path==='/api/settings/branding')return route.fulfill({json:{branding:{companyName:'MCC',companySubtitle:'Maintenance Command Center',companyAccentText:'',logoMode:'text',logoUrl:'',iconAnimation:'none'}}});
    if(path==='/api/machine-library/assets')return route.fulfill({json:{ok:true,assets:[machine,{...machine,id:93,assetNumber:'Press 93',brand:'Engel',serialNumber:'MCC-093'}],brandSettings:[],permissions:{canEdit:true,canDelete:true,canManagePm:true}}});
    if(path==='/api/equipment-library/assets')return route.fulfill({json:{ok:true,assets:[equipment,{...equipment,id:94,assetNumber:'EQ-094',equipmentName:'Vacuum Pump',serialNumber:'EQ-SN-94'}],categories:['Chiller'],permissions:{canEdit:true,canDelete:true,canManagePm:true}}});
    if(path==='/api/requisitions/summary')return route.fulfill({json:{requestedCount:0,orderedCount:0,receivedCount:0,canceledCount:0,activeCount:0}});
    if(path==='/api/dashboard/preventive-maintenance-due')return route.fulfill({json:{alerts:[],summary:{dueSoon:0,dueNow:0,pastDue:0}}});
    if(path==='/api/presence/heartbeat')return route.fulfill({json:{ok:true,policy:{heartbeatIntervalMs:25000,rosterRefreshIntervalMs:25000,onlineTimeoutMs:90000,awayAfterMs:300000,writeThrottleMs:20000}}});
    return route.fulfill({json:{ok:true}});
  });
  return {
    releaseInitialAuth(){initialAuthReleased=true;releaseInitialAuthGate();},
    releaseVerification(){holdVerification=false;releaseVerification?.();},
    releaseFailedVerification(){holdVerification=false;releaseVerification?.();},
  };
}

async function signIn(page:Page){await page.getByLabel('Email address').fill(user.email);await page.getByLabel('Password').fill('Issue-91!Password');await page.getByRole('button',{name:'ENTER COMMAND CENTER'}).click();}

test('login readiness reaches 100%, resets stale routes, and logout cannot restore them',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','Desktop session-flow audit');
  const control=await mockIssue91(page,{holdInitialAuth:true});
  await page.goto('/machine-library');
  await expect(page.getByRole('progressbar',{name:'MCC application readiness'})).toHaveAttribute('aria-valuenow','0');
  control.releaseInitialAuth();
  await expect(page.getByRole('heading',{name:'Enter command center'})).toBeVisible();
  await signIn(page);
  const loader=page.locator('.mcc-app-loading');const progress=page.getByRole('progressbar',{name:'MCC application readiness'});
  await expect(loader).toBeVisible();await expect(progress).toHaveAttribute('aria-valuenow','12');await expect(page.locator('.mcc-shell')).toHaveCount(0);await expect(page).toHaveURL(/\/$/);
  await page.evaluate(()=>{const values:number[]=[];(window as unknown as {__issue91Progress:number[]}).__issue91Progress=values;const progress=document.querySelector('[role="progressbar"]');if(!progress)return;values.push(Number(progress.getAttribute('aria-valuenow')));new MutationObserver(()=>values.push(Number(progress.getAttribute('aria-valuenow')))).observe(progress,{attributes:true,attributeFilter:['aria-valuenow']});});
  control.releaseVerification();
  await expect(page.locator('.mcc-shell')).toBeVisible();await expect(page.getByRole('heading',{name:'Dashboard'})).toBeVisible();
  const progressValues=await page.evaluate(()=>(window as unknown as {__issue91Progress:number[]}).__issue91Progress);expect(progressValues).toContain(100);expect(progressValues).toEqual([...progressValues].sort((left,right)=>left-right));
  await page.getByRole('button',{name:'Open command menu'}).click();await page.getByRole('button',{name:/Machine Library/}).click();await expect(page.getByRole('heading',{name:'Machine Library'})).toBeVisible();await expect(page).toHaveURL(/\/machine-library$/);
  await page.getByRole('button',{name:'Open command menu'}).click();await page.getByRole('button',{name:'Logout'}).click();await expect(page.getByRole('heading',{name:'Enter command center'})).toBeVisible();await expect(page).toHaveURL(/\/$/);
  await signIn(page);await expect(page.getByRole('progressbar',{name:'MCC application readiness'})).toHaveAttribute('aria-valuenow','12');control.releaseVerification();await expect(page.getByRole('heading',{name:'Dashboard'})).toBeVisible();await expect(page).toHaveURL(/\/$/);
});

test('initialization failure blocks the app and offers an accessible retry',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','Desktop failure-path audit');
  const control=await mockIssue91(page,{failVerification:true});await page.goto('/');await expect(page.getByRole('heading',{name:'Enter command center'})).toBeVisible();await signIn(page);await expect(page.getByRole('progressbar',{name:'MCC application readiness'})).toHaveAttribute('aria-valuenow','12');control.releaseFailedVerification();
  await expect(page.getByRole('heading',{name:'MCC initialization paused'})).toBeVisible();await expect(page.getByRole('alert')).toContainText('Initialization service unavailable.');await expect(page.locator('.mcc-shell')).toHaveCount(0);
  await page.getByRole('button',{name:'Retry initialization'}).click();control.releaseVerification();await expect(page.getByRole('heading',{name:'Dashboard'})).toBeVisible();
});

test('application readiness gate respects reduced-motion preferences',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','Single reduced-motion readiness audit');
  await page.emulateMedia({reducedMotion:'reduce'});const control=await mockIssue91(page,{holdInitialAuth:true});await page.goto('/');const loader=page.locator('.mcc-app-loading');await expect(loader).toBeVisible();await expect(page.getByRole('progressbar',{name:'MCC application readiness'})).toHaveAttribute('aria-valuenow','0');
  const motion=await loader.evaluate(element=>({scan:getComputedStyle(element.querySelector('.mcc-app-loading__scan')!).animationName,transition:getComputedStyle(element.querySelector('.mcc-app-loading__progress-fill')!).transitionDuration}));expect(motion).toEqual({scan:'none',transition:'0s'});
  control.releaseInitialAuth();await expect(page.getByRole('heading',{name:'Enter command center'})).toBeVisible();
});

test('asset libraries use compact shared rows and page titles hug their content',async({page},testInfo)=>{
  await mockIssue91(page,{initiallyAuthenticated:true});await page.goto('/machine-library');
  const topbar=page.locator('.mcc-page-topbar');const machineRows=page.locator('.machine-asset-card');await expect(machineRows).toHaveCount(2);await expect(machineRows.first()).toContainText('Type / Brand');await expect(machineRows.first()).toContainText('Year / Age');await expect(machineRows.first()).toContainText('Barrel Size');await expect(machineRows.first()).toContainText('Model');await expect(machineRows.first()).toContainText('Serial #');await expect(machineRows.first()).toContainText('Active');
  const machineLayout=await page.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth,header:document.querySelector('.mcc-page-topbar')!.getBoundingClientRect().width,rows:[...document.querySelectorAll('.machine-asset-card')].map(element=>{const box=element.getBoundingClientRect();return{width:box.width,height:box.height,top:box.top};})}));expect(machineLayout.scroll).toBeLessThanOrEqual(machineLayout.viewport);expect(machineLayout.header).toBeLessThan(machineLayout.viewport*.65);expect(machineLayout.rows[1].top).toBeGreaterThan(machineLayout.rows[0].top);
  if(testInfo.project.name==='desktop-chromium')expect(machineLayout.rows[0].height).toBeLessThan(130);
  await page.getByRole('button',{name:'Open command menu'}).click();await page.getByRole('button',{name:/Equipment Library/}).click();await expect(page.getByRole('heading',{name:'Equipment Library'})).toBeVisible();const equipmentRows=page.locator('.equipment-asset-card');await expect(equipmentRows).toHaveCount(2);await expect(equipmentRows.first()).toContainText('Type / Category');await expect(equipmentRows.first()).toContainText('Brand / Model');await expect(equipmentRows.first()).toContainText('Serial #');await expect(equipmentRows.first()).toContainText('Year / Age');await expect(equipmentRows.first()).toContainText('Active');
  const equipmentLayout=await page.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth,header:document.querySelector('.mcc-page-topbar')!.getBoundingClientRect().width,rows:[...document.querySelectorAll('.equipment-asset-card')].map(element=>{const box=element.getBoundingClientRect();return{height:box.height,top:box.top};})}));expect(equipmentLayout.scroll).toBeLessThanOrEqual(equipmentLayout.viewport);expect(equipmentLayout.header).toBeLessThan(equipmentLayout.viewport*.65);expect(equipmentLayout.rows[1].top).toBeGreaterThan(equipmentLayout.rows[0].top);if(testInfo.project.name==='desktop-chromium')expect(equipmentLayout.rows[0].height).toBeLessThan(120);
  await expect(equipmentRows.first()).toHaveAttribute('role','button');await expect(equipmentRows.first()).toHaveAttribute('tabindex','0');await expect(topbar).toBeVisible();
});
