import { expect, type Page, type Route, test } from '@playwright/test';

type NetworkLinks = {
  accessMode?: 'https' | 'development';
  canonicalUrl?: string | null;
  localPort?: number | null;
  localhostUrl?: string | null;
  detectedLanUrls?: string[];
  primaryLanUrl?: string | null;
};

const stagingUrl = 'https://mcc-stage.local';
const productionUrl = 'https://mcc.local';
const lanUrl = 'http://10.1.2.188:4273';
const user = {
  id: 71,
  fullName: 'Issue 71 Fixture',
  email: 'issue71@example.com',
  role: 'Manager',
  isOwnerAdmin: false,
  canViewSystemVersion: false,
  forcePasswordChange: false,
  effectivePermissions: [],
};

function fulfillJson(route:Route,json:unknown,status=200) {
  return route.fulfill({status,contentType:'application/json',body:JSON.stringify(json)});
}

async function mockSettings(page:Page,networkResponses:NetworkLinks[]) {
  let networkRequestCount = 0;
  await page.route('**/api/**', route=>{
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/status') return fulfillJson(route,{setupRequired:false,user});
    if (path === '/api/settings/branding') return fulfillJson(route,{ok:true,branding:{}});
    if (path === '/api/settings/network-links') {
      const response = networkResponses[Math.min(networkRequestCount,networkResponses.length-1)];
      networkRequestCount += 1;
      return fulfillJson(route,response);
    }
    if (path === '/api/backup/status') return fulfillJson(route,{error:'Not available in fixture.'},403);
    if (path === '/api/presence/heartbeat' || path === '/api/presence/disconnect') return fulfillJson(route,{ok:true});
    return fulfillJson(route,{ok:true});
  });
  return {networkRequestCount:()=>networkRequestCount};
}

function links(primaryLanUrl:string|null,detectedLanUrls:string[] = primaryLanUrl ? [primaryLanUrl] : []):NetworkLinks {
  return {accessMode:'development',canonicalUrl:null,localPort:4273,localhostUrl:'http://localhost:4273',detectedLanUrls,primaryLanUrl};
}

function httpsLinks(canonicalUrl:string):NetworkLinks {
  return {accessMode:'https',canonicalUrl};
}

function mobilePanel(page:Page) {
  return page.locator('.mobile-access-panel');
}

function qrTrigger(page:Page) {
  return page.getByRole('button',{name:'Show mobile access QR code'});
}

function qrDialog(page:Page) {
  return page.getByRole('dialog',{name:'Mobile / Tablet Access'});
}

async function expectNoHorizontalOverflow(page:Page) {
  const dimensions = await page.evaluate(()=>({
    scrollWidth:document.documentElement.scrollWidth,
    clientWidth:document.documentElement.clientWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
}

test('staging uses one canonical HTTPS value for display, copy, and QR without exposing Node ports', async ({page})=>{
  const externalRequests:string[] = [];
  page.on('request',request=>{
    const hostname = new URL(request.url()).hostname;
    if (hostname !== 'localhost' && hostname !== '127.0.0.1') externalRequests.push(request.url());
  });
  await mockSettings(page,[httpsLinks(stagingUrl)]);
  await page.goto('/settings');

  const displayedUrl = mobilePanel(page).locator('.share-url-row code');
  await expect(displayedUrl).toHaveText(stagingUrl);
  await expect(page.locator('.network-host-panel .share-url-row code')).toHaveText(stagingUrl);
  await expect(page.locator('.network-lan-panel .share-url-row code')).toHaveText(stagingUrl);
  const networkCard = page.locator('.share-card').filter({hasText:'Network access'});
  await expect(networkCard).toContainText('HTTPS ports 80/443');
  await expect(networkCard).toContainText('Node remains loopback-only');
  await expect(networkCard).toContainText('Windows PCs must trust the MCC internal CA or receive it through GPO.');
  await expect(networkCard).toContainText('Phones and tablets must trust the MCC CA on that device');
  await expect(networkCard).not.toContainText('4273');
  await expect(networkCard).not.toContainText('4274');
  await expect(networkCard).not.toContainText('Windows Firewall');
  await expect(qrTrigger(page)).toBeVisible();
  await expect(mobilePanel(page).locator('.mobile-access-control-group').getByRole('button',{name:'Show mobile access QR code'})).toBeVisible();
  await expect(qrTrigger(page)).toHaveAttribute('title','Show mobile QR code');
  await expect(page.locator('svg[data-qr-payload]')).toHaveCount(0);

  await qrTrigger(page).click();
  const dialog = qrDialog(page);
  const qr = dialog.locator('svg[role="img"]');
  await expect(dialog).toBeVisible();
  await expect(qr).toHaveAttribute('data-qr-payload',stagingUrl);
  await expect(qr).toHaveAttribute('data-qr-size','176');
  await expect(qr).toHaveAttribute('data-qr-level','H');
  await expect(qr).toHaveAttribute('data-qr-brand','wrench');
  await expect(qr.locator('image')).toHaveCount(1);
  await expect(qr).toHaveAttribute('aria-label',`QR code to open Maintenance Command Center at ${stagingUrl}`);
  await expect(dialog).toContainText('Scan while connected to the same plant Wi-Fi/network.');
  await expect(dialog).toContainText('Do not use cellular data.');
  await expect(dialog).toContainText('must trust the MCC CA');
  await expect(dialog.locator('.share-url-row code')).toHaveText(stagingUrl);
  expect(await qr.getAttribute('data-qr-payload')).toBe(await displayedUrl.textContent());
  expect(externalRequests).toEqual([]);
});

test('Close and Escape dismiss the QR dialog', async ({page})=>{
  await mockSettings(page,[httpsLinks(stagingUrl)]);
  await page.goto('/settings');
  await qrTrigger(page).click();
  await qrDialog(page).getByRole('button',{name:'Close'}).last().click();
  await expect(qrDialog(page)).toHaveCount(0);

  await qrTrigger(page).click();
  await page.keyboard.press('Escape');
  await expect(qrDialog(page)).toHaveCount(0);
});

test('production selects the production canonical HTTPS hostname', async ({page})=>{
  await mockSettings(page,[httpsLinks(productionUrl)]);
  await page.goto('/settings');
  await expect(page.locator('.network-host-panel .share-url-row code')).toHaveText(productionUrl);
  await expect(page.locator('.network-lan-panel .share-url-row code')).toHaveText(productionUrl);
  await expect(mobilePanel(page).locator('.share-url-row code')).toHaveText(productionUrl);
  await qrTrigger(page).click();
  await expect(qrDialog(page).locator('svg[role="img"]')).toHaveAttribute('data-qr-payload',productionUrl);
});

for (const [label,value] of [
  ['localhost','http://localhost:4273'],
  ['localhost subdomain','http://mcc.localhost:4273'],
  ['127.0.0.1','http://127.0.0.1:4273'],
  ['127.x','http://127.42.7.9:4273'],
  ['::1','http://[::1]:4273'],
  ['expanded ::1','http://[0:0:0:0:0:0:0:1]:4273'],
] as const) {
  test(`rejects ${label} and disables the QR trigger`, async ({page})=>{
    await mockSettings(page,[links(value)]);
    await page.goto('/settings');
    await expect(qrTrigger(page)).toBeDisabled();
    await expect(qrTrigger(page)).toHaveAttribute('title','No LAN/mobile URL detected');
    await expect(mobilePanel(page).locator('.mobile-access-control-group.is-unavailable')).toContainText('A LAN/mobile URL could not currently be detected.');
    await expect(page.locator('svg[data-qr-payload]')).toHaveCount(0);
    await expect(mobilePanel(page)).toContainText('A LAN/mobile URL could not currently be detected.');
    await expect(mobilePanel(page).locator('.share-url-row')).toHaveCount(0);
  });
}

test('rejects unsafe or malformed LAN URLs without generating a QR', async ({page})=>{
  await mockSettings(page,[links('http://user:password@10.1.2.3:4273/path?token=secret#section',[
    'ftp://10.1.2.3:4273',
    'not a URL',
  ])]);
  await page.goto('/settings');
  await expect(qrTrigger(page)).toBeDisabled();
  await expect(page.locator('svg[data-qr-payload]')).toHaveCount(0);
});

test('HTTPS mode fails closed instead of falling back to direct Node URLs', async ({page})=>{
  await mockSettings(page,[{
    accessMode:'https',
    canonicalUrl:'http://mcc-stage.local:4274',
    localPort:4274,
    localhostUrl:'http://localhost:4274',
    detectedLanUrls:['http://10.1.2.188:4274'],
    primaryLanUrl:'http://10.1.2.188:4274',
  }]);
  await page.goto('/settings');
  const networkCard = page.locator('.share-card').filter({hasText:'Network access'});
  await expect(qrTrigger(page)).toBeDisabled();
  await expect(networkCard.locator('.share-url-row')).toHaveCount(0);
  await expect(networkCard).toContainText('canonical HTTPS hostname is unavailable');
  await expect(networkCard).not.toContainText('http://10.1.2.188:4274');
  await expect(page.locator('svg[data-qr-payload]')).toHaveCount(0);
});

test('falls back to a usable detected LAN URL when primary is unavailable', async ({page})=>{
  await mockSettings(page,[links(null,[lanUrl])]);
  await page.goto('/settings');
  await expect(mobilePanel(page).locator('.share-url-row code')).toHaveText(lanUrl);
  await qrTrigger(page).click();
  await expect(qrDialog(page).locator('svg[role="img"]')).toHaveAttribute('data-qr-payload',lanUrl);
});

test('Refresh network links reactively updates an open canonical QR without a reload', async ({page})=>{
  const fixture = await mockSettings(page,[httpsLinks(stagingUrl),httpsLinks(productionUrl)]);
  await page.goto('/settings');
  await qrTrigger(page).click();
  const qr = qrDialog(page).locator('svg[role="img"]');
  await expect(qr).toHaveAttribute('data-qr-payload',stagingUrl);

  await qrDialog(page).getByRole('button',{name:'Refresh network links'}).click();
  await expect(qr).toHaveAttribute('data-qr-payload',productionUrl);
  await expect(mobilePanel(page).locator('.share-url-row code')).toHaveText(productionUrl);
  await expect(qrDialog(page).locator('.share-url-row code')).toHaveText(productionUrl);
  expect(fixture.networkRequestCount()).toBe(2);
});

test('other PC and mobile Copy buttons write the canonical HTTPS URL', async ({page,context})=>{
  await context.grantPermissions(['clipboard-read','clipboard-write']);
  await mockSettings(page,[httpsLinks(stagingUrl)]);
  await page.goto('/settings');
  await page.locator('.network-lan-panel').getByRole('button',{name:`Copy ${stagingUrl}`}).click();
  expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(stagingUrl);
  await mobilePanel(page).getByRole('button',{name:`Copy ${stagingUrl}`}).click();
  await expect(page.getByText(`Copied ${stagingUrl}`)).toBeVisible();
  expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(stagingUrl);
});

test('desktop, tablet, and mobile layouts keep the QR trigger integrated without overflow', async ({page})=>{
  await mockSettings(page,[httpsLinks(stagingUrl)]);
  await page.setViewportSize({width:1440,height:900});
  await page.goto('/settings');

  const trigger = qrTrigger(page);
  const hostCard = page.locator('.network-host-panel');
  const lanCard = page.locator('.network-lan-panel');
  const mobileCard = mobilePanel(page);
  const controlGroup = mobileCard.locator('.mobile-access-control-group');
  const urlRow = controlGroup.locator('.share-url-row');
  const desktopTrigger = await trigger.boundingBox();
  const desktopHost = await hostCard.boundingBox();
  const desktopLan = await lanCard.boundingBox();
  const desktopMobile = await mobileCard.boundingBox();
  const desktopGroup = await controlGroup.boundingBox();
  const desktopUrl = await urlRow.boundingBox();
  expect(desktopTrigger?.width).toBe(58);
  expect(desktopTrigger?.height).toBe(58);
  expect(desktopHost).not.toBeNull();
  expect(desktopLan).not.toBeNull();
  expect(desktopMobile).not.toBeNull();
  expect(desktopGroup).not.toBeNull();
  expect(desktopUrl).not.toBeNull();
  expect(desktopLan!.x).toBeGreaterThan(desktopHost!.x);
  expect(desktopMobile!.y).toBeGreaterThan(desktopHost!.y);
  expect(Math.abs(desktopMobile!.width-desktopHost!.width)).toBeLessThanOrEqual(1);
  expect(desktopMobile!.width).toBeLessThan(desktopHost!.width+desktopLan!.width);
  expect(desktopTrigger!.x).toBeGreaterThan(desktopUrl!.x);
  expect(desktopTrigger!.x + desktopTrigger!.width).toBeLessThanOrEqual(desktopGroup!.x + desktopGroup!.width);
  expect(desktopTrigger!.y).toBeGreaterThanOrEqual(desktopGroup!.y);
  expect(desktopTrigger!.y + desktopTrigger!.height).toBeLessThanOrEqual(desktopGroup!.y + desktopGroup!.height);
  const cardGeometry = await page.evaluate(()=>{
    const styles = (selector:string)=>{
      const style = getComputedStyle(document.querySelector(selector)!);
      return {padding:style.padding,borderRadius:style.borderRadius};
    };
    return {host:styles('.network-host-panel'),mobile:styles('.mobile-access-panel')};
  });
  expect(cardGeometry.mobile).toEqual(cardGeometry.host);
  await expectNoHorizontalOverflow(page);

  for (const viewport of [{width:820,height:900},{width:390,height:844}]) {
    await page.setViewportSize(viewport);
    const compactGeometry = await page.evaluate(()=>{
      const bounds = (selector:string)=>{
        const rect = document.querySelector(selector)?.getBoundingClientRect();
        return rect ? {x:rect.x,y:rect.y,width:rect.width,height:rect.height} : null;
      };
      return {
        trigger:bounds('.mobile-qr-trigger'),
        group:bounds('.mobile-access-control-group'),
        host:bounds('.network-host-panel'),
        lan:bounds('.network-lan-panel'),
        mobile:bounds('.mobile-access-panel'),
      };
    });
    const {trigger:compactTrigger,group:compactGroup,host:compactHost,lan:compactLan,mobile:compactMobile} = compactGeometry;
    expect(compactTrigger!.width).toBeGreaterThanOrEqual(58);
    expect(compactTrigger!.width).toBeLessThanOrEqual(60);
    expect(compactTrigger!.height).toBeGreaterThanOrEqual(58);
    expect(compactTrigger!.height).toBeLessThanOrEqual(60);
    expect(compactGroup).not.toBeNull();
    expect(compactHost).not.toBeNull();
    expect(compactLan).not.toBeNull();
    expect(compactMobile).not.toBeNull();
    expect(Math.abs(compactLan!.x-compactHost!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(compactMobile!.x-compactHost!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(compactMobile!.width-compactHost!.width)).toBeLessThanOrEqual(1);
    expect(compactLan!.y).toBeGreaterThan(compactHost!.y);
    expect(compactMobile!.y).toBeGreaterThan(compactLan!.y);
    expect(compactTrigger!.x).toBeGreaterThanOrEqual(compactGroup!.x);
    expect(compactTrigger!.x + compactTrigger!.width).toBeLessThanOrEqual(compactGroup!.x + compactGroup!.width);
    await expectNoHorizontalOverflow(page);

    await trigger.click();
    const modalBox = await qrDialog(page).boundingBox();
    const qrBox = await qrDialog(page).locator('svg[role="img"]').boundingBox();
    expect(modalBox).not.toBeNull();
    expect(qrBox).not.toBeNull();
    expect(modalBox!.x).toBeGreaterThanOrEqual(0);
    expect(modalBox!.x + modalBox!.width).toBeLessThanOrEqual(viewport.width);
    expect(modalBox!.height).toBeLessThanOrEqual(viewport.height);
    expect(qrBox!.width).toBeGreaterThanOrEqual(viewport.width < 620 ? 160 : 170);
    expect(qrBox!.width).toBeLessThanOrEqual(185);
    await page.keyboard.press('Escape');
  }
});
