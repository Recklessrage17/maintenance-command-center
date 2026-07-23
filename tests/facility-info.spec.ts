import {expect,type Page,test} from '@playwright/test';

const area={id:21,name:'Production',description:'Main production floor references.',building:'Building A',location:'North Wing',department:'Molding',status:'active',createdAt:'2026-07-20T12:00:00Z',updatedAt:'2026-07-23T12:00:00Z',summary:{folderCount:2,documentCount:1,pictureCount:1,videoCount:1}};
const secondArea={...area,id:22,name:'Warehouse / Shipping',description:'Dock and warehouse records.',location:'South Dock',department:'Logistics',summary:{folderCount:0,documentCount:0,pictureCount:0,videoCount:0}};
const folders=[{id:31,areaId:21,parentId:null,name:'Electrical Prints',description:'Controlled electrical references.',path:'Electrical Prints',itemCount:1,childCount:1,createdAt:area.createdAt,updatedAt:area.updatedAt},{id:32,areaId:21,parentId:31,name:'Panels',description:'Panel schedules and field media.',path:'Electrical Prints / Panels',itemCount:2,childCount:0,createdAt:area.createdAt,updatedAt:area.updatedAt}];
const baseItem={areaId:21,facilityName:'Production',folderName:'Panels',folderPath:'Electrical Prints / Panels',description:'North wing panel reference',caption:'Panel A',revision:'B',date:'2026-07-23',durationSeconds:null,uploadedAt:'2026-07-23T12:00:00Z',updatedAt:'2026-07-23T12:00:00Z',uploadedBy:'Facility Tester'};
const items=[
  {...baseItem,id:41,folderId:31,folderName:'Electrical Prints',folderPath:'Electrical Prints',mediaType:'document',originalFilename:'Panel Schedule.pdf',displayFilename:'Panel Schedule.pdf',extension:'.pdf',mimeType:'application/pdf',sizeBytes:120000,contentUrl:'/api/facility-info/items/41/content',downloadUrl:'/api/facility-info/items/41/download',canPrint:true},
  {...baseItem,id:42,folderId:32,mediaType:'picture',originalFilename:'Panel Photo.png',displayFilename:'Panel Photo.png',extension:'.png',mimeType:'image/png',sizeBytes:850000,contentUrl:'/api/facility-info/items/42/content',downloadUrl:'/api/facility-info/items/42/download',canPrint:true},
  {...baseItem,id:43,folderId:32,mediaType:'video',originalFilename:'Panel Walkthrough.mp4',displayFilename:'Panel Walkthrough.mp4',extension:'.mp4',mimeType:'video/mp4',sizeBytes:12000000,contentUrl:'/api/facility-info/items/43/content',downloadUrl:'/api/facility-info/items/43/download',canPrint:false},
];
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');

async function mockFacility(page:Page){
  await page.route('**/api/auth/status',route=>route.fulfill({json:{setupRequired:false,user:{id:1,fullName:'Facility Tester',email:'facility@example.com',role:'Admin',isOwnerAdmin:true,forcePasswordChange:false}}}));
  await page.route(/\/api\/facility-info\/permissions$/,route=>route.fulfill({json:{ok:true,canWrite:true,canRecoveryExport:true}}));
  await page.route(/\/api\/facility-info$/,route=>route.fulfill({json:{ok:true,areas:[area,secondArea],limits:{documentsMb:50,picturesMb:50,videosMb:500}}}));
  await page.route(/\/api\/facility-info\/areas\/21$/,route=>route.fulfill({json:{ok:true,area,folders,items}}));
  await page.route(/\/api\/facility-info\/search(?:\?.*)?$/,route=>route.fulfill({json:{ok:true,query:'panel',count:items.length,items}}));
  await page.route(/\/api\/facility-info\/items\/42\/content$/,route=>route.fulfill({contentType:'image/png',body:pixel}));
  await page.route(/\/api\/facility-info\/items\/43\/content$/,route=>route.fulfill({status:206,headers:{'Accept-Ranges':'bytes','Content-Range':'bytes 0-23/24','Content-Type':'video/mp4'},body:Buffer.from([0,0,0,20,0x66,0x74,0x79,0x70,0x69,0x73,0x6f,0x6d,0,0,0,0,0,0,0,0,0,0,0,0])}));
}

test('Facility cards are fully clickable, keyboard reachable, and keep summary tokens content-sized',async({page},testInfo)=>{
  await mockFacility(page);await page.goto('/facility-info');
  const card=page.getByRole('button',{name:'Open Production'});await expect(card).toBeVisible();await expect(card).toContainText('1 document');await expect(card).toContainText('1 picture');await expect(card).toContainText('1 video');
  const cardWidth=await card.evaluate(element=>element.getBoundingClientRect().width);const tokenAudit=await card.locator('.mcc-summary-token').evaluateAll(tokens=>tokens.map(token=>({width:token.getBoundingClientRect().width,cssWidth:getComputedStyle(token).width,flex:getComputedStyle(token).flexGrow})));
  expect(tokenAudit.every(token=>token.width<cardWidth*.72&&token.cssWidth!=='100%'&&token.flex==='0')).toBeTruthy();
  await card.focus();await page.keyboard.press('Space');await expect(page.getByRole('heading',{name:'Production'})).toBeVisible();
  const dimensions=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client);
  if(testInfo.project.name==='mobile-chromium'){const actions=page.locator('.facility-folder-header .mcc-action-group');await expect(actions.first()).toBeVisible();const direction=await actions.first().evaluate(element=>getComputedStyle(element).flexDirection);expect(direction).not.toBe('column');}
});

test('Facility folders, gallery, image viewer, and video controls remain compact and accessible',async({page})=>{
  await mockFacility(page);await page.goto('/facility-info');await page.getByRole('button',{name:'Open Production'}).click();
  await expect(page.getByRole('button',{name:'Close Electrical Prints'})).toBeVisible();await page.getByRole('button',{name:'Open Panels'}).click();
  const panelRow=page.locator('.facility-item-row').filter({hasText:'Panel Photo.png'});await expect(panelRow).toBeVisible();await expect(panelRow.locator('.mcc-resource-row__actions > .mcc-action-group > button,.mcc-resource-row__actions > .mcc-action-group > .mcc-overflow-menu')).toHaveCount(3);
  await panelRow.getByRole('button',{name:'Open'}).click();await expect(page.locator('.facility-viewer')).toBeVisible();await expect(page.locator('.facility-viewer img')).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('.facility-viewer')).toHaveCount(0);
  await page.getByRole('button',{name:'Gallery'}).click();const videoCard=page.getByRole('button',{name:/Panel Walkthrough.mp4/});await expect(videoCard).toBeVisible();await videoCard.click();const video=page.locator('.facility-viewer video');await expect(video).toBeVisible();await expect(video).toHaveAttribute('controls','');await expect(page.locator('.facility-viewer').getByRole('button',{name:'Print'})).toHaveCount(0);await page.keyboard.press('Escape');
  const dimensions=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client);
});

test('Global Facility search exposes Facility and folder context and opens the matching item',async({page})=>{
  await mockFacility(page);await page.goto('/facility-info');const search=page.getByPlaceholder('Facility, folder, filename, caption, revision, uploader');await search.fill('panel');await expect(page.getByRole('heading',{name:'3 results'})).toBeVisible();const result=page.locator('.facility-item-row').filter({hasText:'Panel Photo.png'});await expect(result).toContainText('Production / Electrical Prints / Panels');await result.getByRole('button',{name:'Open'}).click();await expect(page.locator('.facility-viewer')).toBeVisible();await expect(page.locator('.facility-viewer')).toContainText('Production / Electrical Prints / Panels');
});
