import { expect, test } from '@playwright/test';

const adminSession={setupRequired:false,user:{id:1,fullName:'Route Test Admin',email:'routes@example.com',role:'Admin',isOwnerAdmin:true,forcePasswordChange:false}};
async function mockFacilityApis(page:import('@playwright/test').Page){
  await page.route('**/api/presence/**',route=>route.fulfill({json:{ok:true}}));
  await page.route('**/api/settings/branding',route=>route.fulfill({json:{branding:{}}}));
  await page.route(/\/api\/facility-info\/permissions$/,route=>route.fulfill({json:{ok:true,canWrite:true,canRecoveryExport:true}}));
  await page.route(/\/api\/facility-info$/,route=>route.fulfill({json:{ok:true,areas:[],limits:{documentsMb:50,picturesMb:50,videosMb:500}}}));
  await page.route(/\/api\/equipment-library\/assets(?:\?.*)?$/,route=>route.fulfill({json:{ok:true,assets:[],categories:[],permissions:{canEdit:true,canDelete:true}}}));
}

test('initial route modules load through application readiness with navigation prefetch',async({page})=>{
  let facilityRequests=0;let equipmentRequests=0;
  let release=()=>{};const chunkGate=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/auth/status',route=>route.fulfill({json:adminSession}));
  await mockFacilityApis(page);
  await page.route(/\/assets\/FacilityInfoPage-[^/]+\.js$/,async route=>{facilityRequests+=1;await chunkGate;await route.continue();});
  await page.route(/\/assets\/EquipmentLibraryPage-[^/]+\.js$/,async route=>{equipmentRequests+=1;await route.continue();});
  await page.goto('/facility-info',{waitUntil:'domcontentloaded'});
  try{
    await expect(page.getByRole('status')).toContainText('Loading operator workspace');
    await expect(page.getByRole('progressbar',{name:'MCC application readiness'})).toHaveAttribute('aria-valuenow','38');
    await expect(page.locator('.mcc-shell')).toHaveCount(0);
    expect(equipmentRequests).toBe(0);
  }finally{release();}
  await expect(page.getByRole('heading',{name:'Facility Areas'})).toBeVisible();
  expect(facilityRequests).toBe(1);
  await page.getByRole('button',{name:'Open command menu'}).click();
  await page.getByRole('button',{name:/Equipment Library/}).focus();
  await expect.poll(()=>equipmentRequests).toBe(1);
});

test('a failed initial route chunk shows a safe error and retry reloads the workspace',async({page})=>{
  let facilityRequests=0;
  await page.route('**/api/auth/status',route=>route.fulfill({json:adminSession}));
  await mockFacilityApis(page);
  await page.route(/\/assets\/FacilityInfoPage-[^/]+\.js$/,async route=>{facilityRequests+=1;if(facilityRequests===1)await route.abort('failed');else await route.continue();});
  await page.goto('/facility-info',{waitUntil:'domcontentloaded'});
  const error=page.getByRole('alert');
  await expect(error).toContainText('Workspace could not load');
  await expect(error).not.toContainText(/Failed to fetch|\/assets\/|http:/);
  await expect(page.locator('.mcc-shell')).toHaveCount(0);
  await page.getByRole('button',{name:'Retry initialization'}).click();
  await expect(page.getByRole('heading',{name:'Facility Areas'})).toBeVisible();
  expect(facilityRequests).toBeGreaterThanOrEqual(2);
});

test('navigation keeps the styled lazy-module fallback and loads only the selected module',async({page})=>{
  let equipmentRequests=0;let release=()=>{};const chunkGate=new Promise<void>(resolve=>{release=resolve;});
  const pageErrors:string[]=[];page.on('pageerror',error=>pageErrors.push(error.message));
  await page.route('**/api/auth/status',route=>route.fulfill({json:adminSession}));await mockFacilityApis(page);
  await page.route(/\/assets\/EquipmentLibraryPage-[^/]+\.js$/,async route=>{equipmentRequests+=1;await chunkGate;await route.continue();});
  await page.goto('/facility-info');await expect(page.getByRole('heading',{name:'Facility Areas'})).toBeVisible();
  expect(equipmentRequests).toBe(0);
  try{
    await page.getByRole('button',{name:'Open command menu'}).click();await page.getByRole('button',{name:/Equipment Library/}).click();
    await expect(page.locator('.mcc-route-state[role=status]')).toContainText('Loading workspace');
    await expect.poll(()=>equipmentRequests).toBe(1);
  }finally{release();}
  await expect(page.getByRole('heading',{name:'Equipment Library',exact:true})).toBeVisible();expect(equipmentRequests).toBe(1);expect(pageErrors).toEqual([]);
});

test('a failed navigation chunk retains the recoverable route boundary and reload action',async({page})=>{
  let equipmentRequests=0;
  await page.route('**/api/auth/status',route=>route.fulfill({json:adminSession}));await mockFacilityApis(page);
  await page.route(/\/assets\/EquipmentLibraryPage-[^/]+\.js$/,async route=>{equipmentRequests+=1;if(equipmentRequests===1)await route.abort('failed');else await route.continue();});
  await page.goto('/facility-info');await expect(page.getByRole('heading',{name:'Facility Areas'})).toBeVisible();
  await page.getByRole('button',{name:'Open command menu'}).click();await page.getByRole('button',{name:/Equipment Library/}).click();
  const error=page.getByRole('alert');await expect(error).toContainText('Workspace could not load');await error.getByRole('button',{name:'Reload MCC'}).click();
  await expect(page.getByRole('heading',{name:'Equipment Library',exact:true})).toBeVisible();expect(equipmentRequests).toBeGreaterThanOrEqual(2);
});
