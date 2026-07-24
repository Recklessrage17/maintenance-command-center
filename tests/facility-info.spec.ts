import {expect,type Page,type TestInfo,test} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {PDFDocument} from '../backend/node_modules/pdf-lib/cjs/index.js';

const area={id:21,name:'Production',description:'Main production floor references.',building:'Building A',location:'North Wing',department:'Molding',status:'active',createdAt:'2026-07-20T12:00:00Z',updatedAt:'2026-07-23T12:00:00Z',summary:{folderCount:2,documentCount:1,pictureCount:1,videoCount:1}};
const secondArea={...area,id:22,name:'Warehouse / Shipping',description:'Dock and warehouse records.',location:'South Dock',department:'Logistics',summary:{folderCount:0,documentCount:0,pictureCount:0,videoCount:0}};
const folders=[{id:31,areaId:21,parentId:null,name:'Electrical Prints',description:'Controlled electrical references.',path:'Electrical Prints',itemCount:1,childCount:1,createdAt:area.createdAt,updatedAt:area.updatedAt},{id:32,areaId:21,parentId:31,name:'Panels',description:'Panel schedules and field media.',path:'Electrical Prints / Panels',itemCount:2,childCount:0,createdAt:area.createdAt,updatedAt:area.updatedAt}];
const baseItem={areaId:21,facilityName:'Production',folderName:'Panels',folderPath:'Electrical Prints / Panels',description:'North wing panel reference',caption:'Panel A',revision:'B',date:'2026-07-23',durationSeconds:null,uploadedAt:'2026-07-23T12:00:00Z',updatedAt:'2026-07-23T12:00:00Z',uploadedBy:'Facility Tester'};
const items=[
  {...baseItem,id:41,folderId:31,folderName:'Electrical Prints',folderPath:'Electrical Prints',mediaType:'document',originalFilename:'Panel Schedule.pdf',displayFilename:'Panel Schedule.pdf',extension:'.pdf',mimeType:'application/pdf',sizeBytes:120000,contentUrl:'/api/facility-info/items/41/content',downloadUrl:'/api/facility-info/items/41/download',canPrint:true},
  {...baseItem,id:42,folderId:32,mediaType:'picture',originalFilename:'Panel Photo.png',displayFilename:'Panel Photo.png',extension:'.png',mimeType:'image/png',sizeBytes:850000,contentUrl:'/api/facility-info/items/42/content',downloadUrl:'/api/facility-info/items/42/download',canPrint:true},
  {...baseItem,id:43,folderId:32,mediaType:'video',originalFilename:'Panel Walkthrough.mp4',displayFilename:'Panel Walkthrough.mp4',extension:'.mp4',mimeType:'video/mp4',sizeBytes:12000000,contentUrl:'/api/facility-info/items/43/content',downloadUrl:'/api/facility-info/items/43/download',canPrint:false},
];
const printableImage=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><rect width="800" height="600" fill="#fff"/><rect x="32" y="32" width="736" height="536" rx="8" fill="#f4f6f8" stroke="#111" stroke-width="6"/><rect x="120" y="130" width="560" height="300" fill="#dce8f2" stroke="#174f78" stroke-width="8"/><path d="M160 205h480M160 280h480M160 355h480" stroke="#174f78" stroke-width="10"/><text x="400" y="505" text-anchor="middle" font-family="Arial,sans-serif" font-size="34" font-weight="700" fill="#111">PANEL A / NORTH WING</text></svg>');

async function mockFacility(page:Page,areas=[area,secondArea],facilityItems=items){
  await page.route('**/api/auth/status',route=>route.fulfill({json:{setupRequired:false,user:{id:1,fullName:'Facility Tester',email:'facility@example.com',role:'Admin',isOwnerAdmin:true,forcePasswordChange:false}}}));
  await page.route(/\/api\/facility-info\/permissions$/,route=>route.fulfill({json:{ok:true,canWrite:true,canRecoveryExport:true}}));
  await page.route(/\/api\/facility-info$/,route=>route.fulfill({json:{ok:true,areas,limits:{documentsMb:50,picturesMb:50,videosMb:500}}}));
  await page.route(/\/api\/facility-info\/areas\/21$/,route=>route.fulfill({json:{ok:true,area,folders,items:facilityItems}}));
  await page.route(/\/api\/facility-info\/search(?:\?.*)?$/,route=>route.fulfill({json:{ok:true,query:'panel',count:facilityItems.length,items:facilityItems}}));
  await page.context().route(/\/api\/facility-info\/items\/42\/content$/,route=>route.fulfill({contentType:'image/svg+xml',body:printableImage}));
  await page.context().route(/\/api\/facility-info\/items\/43\/content$/,route=>route.fulfill({status:206,headers:{'Accept-Ranges':'bytes','Content-Range':'bytes 0-23/24','Content-Type':'video/mp4'},body:Buffer.from([0,0,0,20,0x66,0x74,0x79,0x70,0x69,0x73,0x6f,0x6d,0,0,0,0,0,0,0,0,0,0,0,0])}));
}

function contrastRatio(foreground:string,background:string){
  const parse=(value:string)=>{
    const channels=value.match(/[\d.]+/g)?.slice(0,3).map(Number);
    if(!channels||channels.length!==3)throw new Error(`Expected an RGB color, received ${value}`);
    return channels.map(channel=>{const normalized=channel/255;return normalized<=.04045?normalized/12.92:((normalized+.055)/1.055)**2.4;});
  };
  const luminance=(value:string)=>{const [red,green,blue]=parse(value);return .2126*red+.7152*green+.0722*blue;};
  const foregroundLuminance=luminance(foreground);const backgroundLuminance=luminance(background);
  return (Math.max(foregroundLuminance,backgroundLuminance)+.05)/(Math.min(foregroundLuminance,backgroundLuminance)+.05);
}

async function assertSinglePagePdf(popup:Page,testInfo:TestInfo,filename:string,orientation:'portrait'|'landscape'){
  const bytes=await popup.pdf({preferCSSPageSize:true,printBackground:true});
  const document=await PDFDocument.load(bytes);
  expect(document.getPageCount()).toBe(1);
  const page=document.getPage(0);const {width,height}=page.getSize();
  expect(orientation==='landscape'?width>height:height>width).toBeTruthy();
  await testInfo.attach(filename,{body:bytes,contentType:'application/pdf'});
  const qaDirectory=process.env.MCC_PDF_QA_DIR;
  if(qaDirectory){const output=path.resolve(qaDirectory);await mkdir(output,{recursive:true});await writeFile(path.join(output,filename),bytes);}
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

  const keyboardTrigger=page.getByRole('button',{name:'Manage Basement'});
  await keyboardTrigger.focus();
  await keyboardTrigger.press('ArrowDown');
  let keyboardMenu=page.getByRole('menu',{name:'Manage Basement'});
  await expect(keyboardMenu.getByRole('menuitem').first()).toBeFocused();
  expect(await keyboardMenu.getByRole('menuitem').evaluateAll(items=>items.map(item=>(item as HTMLElement).tabIndex))).toEqual([-1,-1]);
  await page.keyboard.press('Tab');
  await expect(keyboardMenu).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Open Clean Room'})).toBeFocused();

  await keyboardTrigger.focus();
  await keyboardTrigger.press('ArrowDown');
  keyboardMenu=page.getByRole('menu',{name:'Manage Basement'});
  await expect(keyboardMenu.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(keyboardMenu).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Open Basement'})).toBeFocused();

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
  await expect(engineeringTrigger).toBeFocused();
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
  const alternateVideo={...items[2],id:44,originalFilename:'Backup Walkthrough.mp4',displayFilename:'Backup Walkthrough.mp4'};
  await mockFacility(page,[area,secondArea],[...items,alternateVideo]);await page.goto('/facility-info');await page.getByRole('button',{name:'Open Production'}).click();
  await expect(page.getByRole('button',{name:'Close Electrical Prints'})).toBeVisible();await page.getByRole('button',{name:'Open Panels'}).click();
  const panelRow=page.locator('.facility-item-row').filter({hasText:'Panel Photo.png'});await expect(panelRow).toBeVisible();await expect(panelRow.locator('.mcc-resource-row__actions > .mcc-action-group > button,.mcc-resource-row__actions > .mcc-action-group > .mcc-overflow-menu')).toHaveCount(3);
  await panelRow.getByRole('button',{name:'Open'}).click();const imageViewer=page.locator('.facility-viewer');await expect(imageViewer).toBeVisible();await expect(imageViewer.locator('img')).toBeVisible();await expect(imageViewer.getByRole('button',{name:'Zoom out'})).toBeVisible();await expect(imageViewer.getByRole('button',{name:'Zoom in'})).toBeVisible();await page.keyboard.press('Escape');await expect(imageViewer).toHaveCount(0);
  await page.getByRole('button',{name:'Gallery'}).click();const videoCard=page.getByRole('button',{name:/Panel Walkthrough.mp4/});await expect(videoCard).toBeVisible();await videoCard.click();const videoViewer=page.locator('.facility-viewer');const video=videoViewer.locator('video');await expect(video).toBeVisible();await expect(video).toHaveAttribute('controls','');await expect(videoViewer.getByRole('button',{name:'Print'})).toHaveCount(0);await expect(videoViewer).toHaveAttribute('aria-label','Panel Walkthrough.mp4');await video.focus();await expect(video).toBeFocused();await page.keyboard.press('ArrowRight');await expect(videoViewer).toBeVisible();await expect(videoViewer).toHaveAttribute('aria-label','Panel Walkthrough.mp4');await expect(videoViewer).not.toContainText('Backup Walkthrough.mp4');await page.keyboard.press('Escape');await expect(videoViewer).toHaveCount(0);
  const dimensions=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client);
});

test('Global Facility search exposes Facility and folder context and opens the matching item',async({page})=>{
  await mockFacility(page);await page.goto('/facility-info');const search=page.getByPlaceholder('Facility, folder, filename, caption, revision, uploader');await search.fill('panel');await expect(page.getByRole('heading',{name:'3 results'})).toBeVisible();const result=page.locator('.facility-item-row').filter({hasText:'Panel Photo.png'});await expect(result).toContainText('Production / Electrical Prints / Panels');await result.getByRole('button',{name:'Open'}).click();await expect(page.locator('.facility-viewer')).toBeVisible();await expect(page.locator('.facility-viewer')).toContainText('Production / Electrical Prints / Panels');
});

test('Facility content-list and image print popups are light, high contrast, unclipped, and exactly one page',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','Facility popup PDF generation is protected by the desktop Chromium project.');
  await mockFacility(page);
  await page.goto('/facility-info');
  await page.getByRole('button',{name:'Open Production'}).click();
  await expect(page.locator('.facility-area-heading h2')).toHaveText('Production');

  const contentListPopupPromise=page.waitForEvent('popup');
  await page.getByRole('button',{name:'Print Content List'}).click();
  const contentListPopup=await contentListPopupPromise;
  await expect(contentListPopup.locator('html[data-ready="true"]')).toHaveCount(1);
  await contentListPopup.emulateMedia({media:'print'});
  await expect(contentListPopup.locator('body[data-facility-print="content-list"]')).toBeVisible();
  await expect(contentListPopup.getByRole('heading',{name:'Production'})).toBeVisible();
  await expect(contentListPopup.locator('tbody tr')).toHaveCount(3);
  await expect(contentListPopup.locator('table')).toContainText('Electrical Prints / Panels');
  await expect(contentListPopup.locator('table')).toContainText('Panel Schedule.pdf');
  await expect(contentListPopup.locator('table')).toContainText('Panel Photo.png');
  await expect(contentListPopup.locator('table')).toContainText('Panel Walkthrough.mp4');
  const contentListAudit=await contentListPopup.evaluate(()=>{
    const body=document.body;const table=document.querySelector('table')!;const heading=document.querySelector('h1')!;const header=document.querySelector('th')!;
    const bodyStyle=getComputedStyle(body);const headingStyle=getComputedStyle(heading);const headerStyle=getComputedStyle(header);
    const bodyRect=body.getBoundingClientRect();const tableRect=table.getBoundingClientRect();
    const maximumCellOverflow=Math.max(0,...Array.from(document.querySelectorAll<HTMLElement>('th,td')).map(cell=>cell.scrollWidth-cell.clientWidth));
    return {
      bodyBackground:bodyStyle.backgroundColor,
      bodyColor:bodyStyle.color,
      headingColor:headingStyle.color,
      headerBackground:headerStyle.backgroundColor,
      headerColor:headerStyle.color,
      horizontalOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
      maximumCellOverflow,
      tableWithinBody:tableRect.left>=bodyRect.left-.5&&tableRect.right<=bodyRect.right+.5,
    };
  });
  expect(contentListAudit).toMatchObject({bodyBackground:'rgb(255, 255, 255)',bodyColor:'rgb(17, 17, 17)',headingColor:'rgb(17, 17, 17)',headerBackground:'rgb(232, 237, 242)',headerColor:'rgb(17, 17, 17)',tableWithinBody:true});
  expect(contrastRatio(contentListAudit.bodyColor,contentListAudit.bodyBackground)).toBeGreaterThanOrEqual(7);
  expect(contrastRatio(contentListAudit.headerColor,contentListAudit.headerBackground)).toBeGreaterThanOrEqual(7);
  expect(contentListAudit.horizontalOverflow).toBeLessThanOrEqual(1);
  expect(contentListAudit.maximumCellOverflow).toBeLessThanOrEqual(1);
  await assertSinglePagePdf(contentListPopup,testInfo,'facility-content-list.pdf','landscape');
  await contentListPopup.close();

  await page.getByRole('button',{name:'Open Panels'}).click();
  const imageRow=page.locator('.facility-item-row').filter({hasText:'Panel Photo.png'});
  await imageRow.getByRole('button',{name:'Open'}).click();
  const viewer=page.locator('.facility-viewer');
  await expect(viewer).toBeVisible();
  const imagePopupPromise=page.waitForEvent('popup');
  await viewer.getByRole('button',{name:'Print'}).click();
  const imagePopup=await imagePopupPromise;
  await expect(imagePopup.locator('html[data-ready="true"]')).toHaveCount(1);
  await imagePopup.emulateMedia({media:'print'});
  await expect(imagePopup.locator('body[data-facility-print="image"]')).toBeVisible();
  await expect(imagePopup.getByRole('heading',{name:'Panel Photo.png'})).toBeVisible();
  await expect(imagePopup.getByRole('img',{name:'Panel A'})).toBeVisible();
  const imageAudit=await imagePopup.evaluate(()=>{
    const body=document.body;const heading=document.querySelector('h1')!;const frame=document.querySelector('main')!;const image=document.querySelector('img')!;
    const bodyStyle=getComputedStyle(body);const headingStyle=getComputedStyle(heading);const frameStyle=getComputedStyle(frame);
    const frameRect=frame.getBoundingClientRect();const imageRect=image.getBoundingClientRect();
    return {
      bodyBackground:bodyStyle.backgroundColor,
      bodyColor:bodyStyle.color,
      headingColor:headingStyle.color,
      frameBackground:frameStyle.backgroundColor,
      frameBorder:frameStyle.borderTopColor,
      frameOverflow:frameStyle.overflow,
      horizontalOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
      naturalWidth:image.naturalWidth,
      naturalHeight:image.naturalHeight,
      imageWithinFrame:imageRect.left>=frameRect.left-.5&&imageRect.right<=frameRect.right+.5&&imageRect.top>=frameRect.top-.5&&imageRect.bottom<=frameRect.bottom+.5,
    };
  });
  expect(imageAudit).toMatchObject({bodyBackground:'rgb(255, 255, 255)',bodyColor:'rgb(17, 17, 17)',headingColor:'rgb(17, 17, 17)',frameBackground:'rgb(255, 255, 255)',frameBorder:'rgb(112, 112, 112)',frameOverflow:'hidden',naturalWidth:800,naturalHeight:600,imageWithinFrame:true});
  expect(contrastRatio(imageAudit.headingColor,imageAudit.bodyBackground)).toBeGreaterThanOrEqual(7);
  expect(imageAudit.horizontalOverflow).toBeLessThanOrEqual(1);
  await assertSinglePagePdf(imagePopup,testInfo,'facility-image.pdf','portrait');
  await imagePopup.close();
});
