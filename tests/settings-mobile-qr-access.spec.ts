import { expect, type Page, type Route, test } from '@playwright/test';

type NetworkLinks = {
  localPort: number;
  localhostUrl: string;
  detectedLanUrls: string[];
  primaryLanUrl: string | null;
};

const lanUrl = 'http://10.1.2.188:4273';
const refreshedLanUrl = 'http://10.1.2.199:4273';
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
  return {localPort:4273,localhostUrl:'http://localhost:4273',detectedLanUrls,primaryLanUrl};
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

test('starts compact, then opens a local accessible QR with the displayed LAN URL', async ({page})=>{
  const externalRequests:string[] = [];
  page.on('request',request=>{
    const hostname = new URL(request.url()).hostname;
    if (hostname !== 'localhost' && hostname !== '127.0.0.1') externalRequests.push(request.url());
  });
  await mockSettings(page,[links(lanUrl)]);
  await page.goto('/settings');

  const displayedUrl = mobilePanel(page).locator('.share-url-row code');
  await expect(displayedUrl).toHaveText(lanUrl);
  await expect(qrTrigger(page)).toBeVisible();
  await expect(mobilePanel(page).locator('.mobile-access-control-group').getByRole('button',{name:'Show mobile access QR code'})).toBeVisible();
  await expect(qrTrigger(page)).toHaveAttribute('title','Show mobile QR code');
  await expect(page.locator('svg[data-qr-payload]')).toHaveCount(0);

  await qrTrigger(page).click();
  const dialog = qrDialog(page);
  const qr = dialog.locator('svg[role="img"]');
  await expect(dialog).toBeVisible();
  await expect(qr).toHaveAttribute('data-qr-payload',lanUrl);
  await expect(qr).toHaveAttribute('data-qr-size','176');
  await expect(qr).toHaveAttribute('data-qr-level','H');
  await expect(qr).toHaveAttribute('data-qr-brand','wrench');
  await expect(qr.locator('image')).toHaveCount(1);
  await expect(qr).toHaveAttribute('aria-label',`QR code to open Maintenance Command Center at ${lanUrl}`);
  await expect(dialog).toContainText('Scan while connected to the same plant Wi-Fi/network.');
  await expect(dialog).toContainText('Do not use cellular data.');
  await expect(dialog.locator('.share-url-row code')).toHaveText(lanUrl);
  expect(await qr.getAttribute('data-qr-payload')).toBe(await displayedUrl.textContent());
  expect(externalRequests).toEqual([]);
});

test('Close and Escape dismiss the QR dialog', async ({page})=>{
  await mockSettings(page,[links(lanUrl)]);
  await page.goto('/settings');
  await qrTrigger(page).click();
  await qrDialog(page).getByRole('button',{name:'Close'}).last().click();
  await expect(qrDialog(page)).toHaveCount(0);

  await qrTrigger(page).click();
  await page.keyboard.press('Escape');
  await expect(qrDialog(page)).toHaveCount(0);
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

test('falls back to a usable detected LAN URL when primary is unavailable', async ({page})=>{
  await mockSettings(page,[links(null,[lanUrl])]);
  await page.goto('/settings');
  await expect(mobilePanel(page).locator('.share-url-row code')).toHaveText(lanUrl);
  await qrTrigger(page).click();
  await expect(qrDialog(page).locator('svg[role="img"]')).toHaveAttribute('data-qr-payload',lanUrl);
});

test('Refresh network links reactively updates an open QR without a reload', async ({page})=>{
  const fixture = await mockSettings(page,[links(lanUrl),links(refreshedLanUrl)]);
  await page.goto('/settings');
  await qrTrigger(page).click();
  const qr = qrDialog(page).locator('svg[role="img"]');
  await expect(qr).toHaveAttribute('data-qr-payload',lanUrl);

  await qrDialog(page).getByRole('button',{name:'Refresh network links'}).click();
  await expect(qr).toHaveAttribute('data-qr-payload',refreshedLanUrl);
  await expect(mobilePanel(page).locator('.share-url-row code')).toHaveText(refreshedLanUrl);
  await expect(qrDialog(page).locator('.share-url-row code')).toHaveText(refreshedLanUrl);
  expect(fixture.networkRequestCount()).toBe(2);
});

test('the existing mobile URL Copy button remains usable', async ({page,context})=>{
  await context.grantPermissions(['clipboard-read','clipboard-write']);
  await mockSettings(page,[links(lanUrl)]);
  await page.goto('/settings');
  await mobilePanel(page).getByRole('button',{name:`Copy ${lanUrl}`}).click();
  await expect(page.getByText(`Copied ${lanUrl}`)).toBeVisible();
  expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(lanUrl);
});

test('desktop, tablet, and mobile layouts keep the QR trigger integrated without overflow', async ({page})=>{
  await mockSettings(page,[links(lanUrl)]);
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
  expect(desktopTrigger!.x).toBeGreaterThan(desktopUrl!.x);
  expect(desktopTrigger!.x + desktopTrigger!.width).toBeLessThanOrEqual(desktopGroup!.x + desktopGroup!.width);
  expect(desktopTrigger!.y).toBeGreaterThanOrEqual(desktopGroup!.y);
  expect(desktopTrigger!.y + desktopTrigger!.height).toBeLessThanOrEqual(desktopGroup!.y + desktopGroup!.height);
  await expectNoHorizontalOverflow(page);

  for (const viewport of [{width:820,height:900},{width:390,height:844}]) {
    await page.setViewportSize(viewport);
    const compactTrigger = await trigger.boundingBox();
    const compactGroup = await controlGroup.boundingBox();
    expect(compactTrigger?.width).toBe(58);
    expect(compactTrigger?.height).toBe(58);
    expect(compactGroup).not.toBeNull();
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
