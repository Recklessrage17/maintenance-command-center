import { expect, test } from '@playwright/test';

const adminSession={setupRequired:false,user:{id:1,fullName:'Route Test Admin',email:'routes@example.com',role:'Admin',isOwnerAdmin:true,forcePasswordChange:false}};
async function mockFacilityApis(page:import('@playwright/test').Page){
  await page.route(/\/api\/facility-info\/permissions$/,route=>route.fulfill({json:{ok:true,canWrite:true,canRecoveryExport:true}}));
  await page.route(/\/api\/facility-info$/,route=>route.fulfill({json:{ok:true,areas:[],limits:{documentsMb:50,picturesMb:50,videosMb:500}}}));
}

test('route modules load on demand with a styled fallback and navigation prefetch',async({page})=>{
  let facilityRequests=0;let equipmentRequests=0;
  await page.route('**/api/auth/status',route=>route.fulfill({json:adminSession}));
  await mockFacilityApis(page);
  await page.route(/\/assets\/FacilityInfoPage-[^/]+\.js$/,async route=>{facilityRequests+=1;await new Promise(resolve=>setTimeout(resolve,500));await route.continue();});
  await page.route(/\/assets\/EquipmentLibraryPage-[^/]+\.js$/,async route=>{equipmentRequests+=1;await route.continue();});
  await page.goto('/facility-info',{waitUntil:'domcontentloaded'});
  await expect(page.getByRole('status')).toContainText('Loading workspace');
  await expect(page.getByRole('heading',{name:'Facility Areas'})).toBeVisible();
  expect(facilityRequests).toBe(1);
  await page.getByRole('button',{name:'Open command menu'}).click();
  await page.getByRole('menuitem',{name:/Equipment Library/}).focus();
  await expect.poll(()=>equipmentRequests).toBe(1);
});

test('a failed route chunk shows a recoverable module-load error',async({page})=>{
  let facilityRequests=0;
  await page.route('**/api/auth/status',route=>route.fulfill({json:adminSession}));
  await mockFacilityApis(page);
  await page.route(/\/assets\/FacilityInfoPage-[^/]+\.js$/,async route=>{facilityRequests+=1;if(facilityRequests===1)await route.abort('failed');else await route.continue();});
  await page.goto('/facility-info',{waitUntil:'domcontentloaded'});
  const error=page.getByRole('alert');
  await expect(error).toContainText('Workspace could not load');
  await error.getByRole('button',{name:'Reload MCC'}).click();
  await expect(page.getByRole('heading',{name:'Facility Areas'})).toBeVisible();
  expect(facilityRequests).toBeGreaterThanOrEqual(2);
});
