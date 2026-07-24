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

async function mockFacility(page:Page,areas=[area,secondArea]){
  await page.route('**/api/auth/status',route=>route.fulfill({json:{setupRequired:false,user:{id:1,fullName:'Facility Tester',email:'facility@example.com',role:'Admin',isOwnerAdmin:true,forcePasswordChange:false}}}));
  await page.route(/\/api\/facility-info\/permissions$/,route=>route.fulfill({json:{ok:true,canWrite:true,canRecoveryExport:true}}));
  await page.route(/\/api\/facility-info$/,route=>route.fulfill({json:{ok:true,areas,limits:{documentsMb:50,picturesMb:50,videosMb:500}}}));
  await page.route(/\/api\/facility-info\/areas\/21$/,route=>route.fulfill({json:{ok:true,area,folders,items}}));
  await page.route(/\/api\/facility-info\/search(?:\?.*)?$/,route=>route.fulfill({json:{ok:true,query:'panel',count:items.length,items}}));
  await page.route(/\/api\/facility-info\/items\/42\/content$/,route=>route.fulfill({contentType:'image/png',body:pixel}));
  await page.route(/\/api\/facility-info\/items\/43\/content$/,route=>route.fulfill({status:206,headers:{'Accept-Ranges':'bytes','Content-Range':'bytes 0-23/24','Content-Type':'video/mp4'},body:Buffer.from([0,0,0,20,0x66,0x74,0x79,0x70,0x69,0x73,0x6f,0x6d,0,0,0,0,0,0,0,0,0,0,0,0])}));
}

test('shared More menu portals above Facility cards, stays in the viewport, and isolates card activation',async({page},testInfo)=>{
  const areas=[
    {...area,id:61,name:'Basement',description:'Basement utilities',summary:{folderCount:0,documentCount:0,pictureCount:0,videoCount:0}},
    {...area,id:62,name:'Clean Room',description:'Clean room references',summary:{folderCount:0,documentCount:0,pictureCount:0,videoCount:0}},
    {...area,id:63,name:'Engineering',description:'Engineering references',summary:{folderCount:0,documentCount:0,pictureCount:0,videoCount:0}},
  ];
  let deleted=false;
  await mockFacility(page,areas);
  await page.route(/\/api\/facility-info\/areas\/63$/,async route=>{
    if(route.request().method()==='DELETE'){deleted=true;await route.fulfill({json:{ok:true}});return;}
    await route.fulfill({json:{ok:true,area:areas[2],folders:[],items:[]}});
  });
  await page.goto('/facility-info');

  for(const name of ['Basement','Clean Room','Engineering']){
    const trigger=page.getByRole('button',{name:`Manage ${name}`});
    await trigger.click();
    const menu=page.getByRole('menu',{name:`Manage ${name}`});
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem',{name:'Edit Facility Area'})).toBeVisible();
    await expect(menu.getByRole('menuitem',{name:'Delete Facility Area'})).toBeVisible();
    const geometry=await menu.evaluate(element=>{
      const rect=element.getBoundingClientRect();
      const topElement=document.elementFromPoint(rect.left+Math.min(20,rect.width/2),rect.top+Math.min(20,rect.height/2));
      const style=getComputedStyle(element);
      return {left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:innerWidth,height:innerHeight,position:style.position,zIndex:Number(style.zIndex),topClass:topElement?.className??''};
    });
    expect(geometry.position).toBe('fixed');
    expect(geometry.zIndex).toBeGreaterThan(30);
    expect(geometry.left).toBeGreaterThanOrEqual(8);
    expect(geometry.right).toBeLessThanOrEqual(geometry.width-8);
    expect(geometry.top).toBeGreaterThanOrEqual(8);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.height-8);
    expect(String(geometry.topClass)).toContain('mcc-overflow-menu__');
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }

  if(testInfo.project.name==='desktop-chromium'){
    for(const viewport of [{width:1152,height:720},{width:960,height:600}]){
      await page.setViewportSize(viewport);
      await page.getByRole('button',{name:'Manage Engineering'}).click();
      const zoomMenu=page.getByRole('menu',{name:'Manage Engineering'});
      const box=await zoomMenu.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x+box!.width).toBeLessThanOrEqual(viewport.width-8);
      await page.keyboard.press('Escape');
    }
  }
  await page.evaluate(()=>{const grid=document.querySelector<HTMLElement>('.facility-card-grid');if(grid)grid.style.marginTop='760px';});
  await page.evaluate(()=>window.scrollTo(0,620));
  const engineeringTrigger=page.getByRole('button',{name:'Manage Engineering'});
  await engineeringTrigger.scrollIntoViewIfNeeded();
  await engineeringTrigger.click();
  const engineeringMenu=page.getByRole('menu',{name:'Manage Engineering'});
  const scrolledGeometry=await engineeringMenu.boundingBox();
  expect(scrolledGeometry).not.toBeNull();
  expect(scrolledGeometry!.x).toBeGreaterThanOrEqual(8);
  const viewportWidth=await page.evaluate(()=>innerWidth);
  expect(scrolledGeometry!.x+scrolledGeometry!.width).toBeLessThanOrEqual(viewportWidth-8);
  await engineeringMenu.getByRole('menuitem',{name:'Edit Facility Area'}).click();
  await expect(page.getByRole('dialog',{name:'Edit Facility Area'})).toBeVisible();
  await page.getByRole('dialog',{name:'Edit Facility Area'}).getByRole('button',{name:'Close'}).click();
  await engineeringTrigger.click();
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('menu',{name:'Manage Engineering'}).getByRole('menuitem',{name:'Delete Facility Area'}).click();
  await expect.poll(()=>deleted).toBeTruthy();
  await expect(page.locator('.facility-area-heading h2',{hasText:'Engineering'})).toHaveCount(0);
  const dimensions=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client);
});

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
