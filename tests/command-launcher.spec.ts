import { expect, type Page, test } from '@playwright/test';

const fullPermissions=['inventory.view','requisitions.view','machine.view','equipment.view','facility.view','vendors.view','history.view'];
const owner={id:1,fullName:'Jeff R Grove',email:'owner@example.com',role:'Admin',isOwnerAdmin:true,forcePasswordChange:false,disabled:false,lastLoginAt:null,effectivePermissions:fullPermissions};
const roster={
  serverTime:'2026-07-24T14:00:00.000Z',
  policy:{heartbeatIntervalMs:45000,rosterRefreshIntervalMs:25000,onlineThresholdMs:120000,awayAfterMs:600000,writeThrottleMs:25000},
  totalUsers:1,activeUsers:1,onlineCount:1,awayCount:0,offlineCount:0,disabledCount:0,
  users:[{id:1,fullName:'Jeff R Grove',role:'Admin',isOwnerAdmin:true,disabled:false,isCurrentUser:true,presence:'Online',lastSeenAt:'2026-07-24T14:00:00.000Z',rankProvenance:{currentRank:'Owner Admin',assignedBy:'System bootstrap',assignedAt:'2026-07-01T12:00:00.000Z',previousRank:null,reason:null,assignmentSourceAvailable:true,source:'system_bootstrap'},specialPermissionGrants:[]}],
};

async function mockLauncher(page:Page,user=owner){
  let logoutCalls=0;
  await page.route('**/api/auth/status',route=>route.fulfill({json:{setupRequired:false,user}}));
  await page.route('**/api/settings/branding',route=>route.fulfill({json:{branding:{companyName:'MCC',companySubtitle:'Maintenance Command Center',companyAccentText:'',logoMode:'text',logoUrl:'',iconAnimation:'none'}}}));
  await page.route('**/api/presence/heartbeat',route=>route.fulfill({json:{ok:true,serverTime:roster.serverTime,written:true,policy:roster.policy}}));
  await page.route('**/api/presence/team',route=>route.fulfill({json:roster}));
  await page.route('**/api/requisitions/summary',route=>route.fulfill({json:{requestedCount:0,orderedCount:0,receivedCount:0,canceledCount:0,activeCount:0}}));
  await page.route('**/api/dashboard/preventive-maintenance-due',route=>route.fulfill({json:{alerts:[]}}));
  await page.route('**/api/auth/logout',route=>{logoutCalls+=1;return route.fulfill({json:{ok:true}});});
  return{logoutCalls:()=>logoutCalls};
}

async function openDeck(page:Page){
  await page.getByRole('button',{name:'Open command menu'}).click();
  const deck=page.locator('.mcc-command-deck');
  await expect(deck).toBeVisible();
  return deck;
}

async function expectNoHorizontalOverflow(page:Page){
  const dimensions=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth}));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
}

test('industrial command deck has shared smoke-glass tiles, module accents, and a non-color active marker',async({page})=>{
  await mockLauncher(page);
  await page.goto('/');
  const deck=await openDeck(page);
  await expect(deck.getByText('COMMAND DECK',{exact:true})).toBeVisible();
  await expect(deck.getByRole('heading',{name:'Maintenance Command Center'})).toBeVisible();
  const console=deck.getByRole('region',{name:'Signed-in user command console'});
  await expect(console).toContainText('Jeff R Grove');
  await expect(console).toContainText('Online');
  await expect(console).toContainText('Owner Admin');
  await expect(console.getByRole('button',{name:'Open Maintenance Team roster'})).toHaveText(/Teams\s*1/);

  const tiles=deck.getByRole('menuitem');
  await expect(tiles).toHaveCount(10);
  const active=deck.getByRole('menuitem',{name:/Dashboard/});
  await expect(active).toHaveAttribute('aria-current','page');
  await expect(active).toContainText('Active');
  await expect(deck.getByRole('menuitem',{name:/Inventory/})).not.toHaveAttribute('aria-current','page');

  const tileStyles=await tiles.evaluateAll(elements=>elements.map(element=>{
    const style=getComputedStyle(element);
    return{height:element.getBoundingClientRect().height,background:style.backgroundImage,borderRadius:style.borderRadius};
  }));
  expect(new Set(tileStyles.map(style=>Math.round(style.height))).size).toBe(1);
  expect(tileStyles.every(style=>style.background.includes('linear-gradient')&&!style.background.includes('rgb(68, 215, 255)'))).toBe(true);
  expect(tileStyles.every(style=>Number.parseFloat(style.borderRadius)<=6)).toBe(true);

  const inventory=deck.getByRole('menuitem',{name:/Inventory/});
  await inventory.hover();
  await expect(inventory.locator('.mcc-command-module-icon-housing')).toHaveCSS('color','rgb(243, 254, 255)');
  await expectNoHorizontalOverflow(page);
});

test('launcher preserves Escape, outside-click, keyboard navigation, warp, and aria-current',async({page})=>{
  await mockLauncher(page);
  await page.goto('/');
  await openDeck(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('.command-launcher')).not.toHaveClass(/\bopen\b/);
  await expect(page.getByRole('button',{name:'Open command menu'})).toHaveAttribute('aria-expanded','false');

  await openDeck(page);
  await page.locator('.mcc-page-topbar').dispatchEvent('pointerdown');
  await expect(page.locator('.command-launcher')).not.toHaveClass(/\bopen\b/);
  await expect(page.getByRole('button',{name:'Open command menu'})).toHaveAttribute('aria-expanded','false');

  const deck=await openDeck(page);
  const inventory=deck.getByRole('menuitem',{name:/Inventory/});
  await inventory.focus();
  await page.keyboard.press('Space');
  await expect(page).toHaveURL(/\/inventory$/);
  await openDeck(page);
  await expect(page.getByRole('menuitem',{name:/Inventory/})).toHaveAttribute('aria-current','page');
});

test('permission-controlled module visibility remains authoritative',async({page})=>{
  await mockLauncher(page,{...owner,isOwnerAdmin:false,effectivePermissions:['inventory.view']});
  await page.goto('/');
  const deck=await openDeck(page);
  await expect(deck.getByRole('menuitem')).toHaveCount(4);
  await expect(deck.getByRole('menuitem',{name:/Dashboard/})).toBeVisible();
  await expect(deck.getByRole('menuitem',{name:/Inventory/})).toBeVisible();
  await expect(deck.getByRole('menuitem',{name:/Admin \/ Users/})).toBeVisible();
  await expect(deck.getByRole('menuitem',{name:/Settings/})).toBeVisible();
  await expect(deck.getByRole('menuitem',{name:/Vendors/})).toHaveCount(0);
  await expect(deck.getByRole('menuitem',{name:/History Logs/})).toHaveCount(0);
});

test('user console actions stay content-sized and preserve password and logout flows',async({page})=>{
  const fixture=await mockLauncher(page);
  await page.goto('/');
  let deck=await openDeck(page);
  const actions=deck.locator('.mcc-user-console-actions');
  await expect(actions).toHaveCSS('flex-direction','row');
  const update=deck.getByRole('button',{name:'Update Password'});
  const logout=deck.getByRole('button',{name:'Logout'});
  const actionWidths=await Promise.all([update,logout].map(async button=>(await button.boundingBox())!.width));
  expect(actionWidths.every(width=>width<160)).toBe(true);
  await update.click();
  await expect(page.getByRole('heading',{name:'Update Password'})).toBeVisible();

  await page.reload();
  deck=await openDeck(page);
  await deck.getByRole('button',{name:'Logout'}).click();
  await expect(page.getByRole('heading',{name:'MCC Login'})).toBeVisible();
  expect(fixture.logoutCalls()).toBe(1);
});

test('390px mobile uses one column and horizontally wrapped console actions without clipping',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.emulateMedia({reducedMotion:'reduce'});
  await mockLauncher(page);
  await page.goto('/');
  const deck=await openDeck(page);
  await expect(deck.locator('.mcc-command-module-grid')).toHaveCSS('grid-template-columns',/\d+px/);
  const tiles=deck.getByRole('menuitem');
  const first=await tiles.nth(0).boundingBox();
  const second=await tiles.nth(1).boundingBox();
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  expect(Math.abs(first!.x-second!.x)).toBeLessThanOrEqual(3);
  expect(second!.y).toBeGreaterThan(first!.y+first!.height-1);

  const actions=deck.locator('.mcc-user-console-actions');
  await expect(actions).toHaveCSS('flex-direction','row');
  const boxes=await actions.locator(':scope > *').evaluateAll(elements=>elements.map(element=>{
    const box=element.getBoundingClientRect();
    return{x:box.x,y:box.y,right:box.right,width:box.width};
  }));
  expect(boxes.every(box=>box.right<=390&&box.width<190)).toBe(true);
  expect(new Set(boxes.map(box=>Math.round(box.y))).size).toBeLessThan(boxes.length);
  await expect(tiles.first()).toHaveCSS('transition-duration','0s');
  await expectNoHorizontalOverflow(page);
});

test('desktop launcher remains usable at 125% and 150% equivalent layout zoom',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','Desktop zoom coverage');
  await mockLauncher(page);
  for(const viewport of [{width:1152,height:720},{width:960,height:600}]){
    await page.setViewportSize(viewport);
    await page.goto('/');
    const deck=await openDeck(page);
    const box=await deck.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x+box!.width).toBeLessThanOrEqual(viewport.width);
    const first=await deck.getByRole('menuitem').nth(0).boundingBox();
    const second=await deck.getByRole('menuitem').nth(1).boundingBox();
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second!.x).toBeGreaterThan(first!.x);
    await expectNoHorizontalOverflow(page);
    await page.getByRole('button',{name:'Close command menu'}).click();
  }
});
