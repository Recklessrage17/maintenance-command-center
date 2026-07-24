import {expect,type Page,test} from '@playwright/test';

const owner={id:1,fullName:'Jeff R Grove',email:'owner@example.com',role:'Admin',isOwnerAdmin:true,forcePasswordChange:false,disabled:false,lastLoginAt:null,canDisable:false,canDelete:false,canResetPassword:false,canManagePermissions:false,specialPermissionGrants:[],effectivePermissions:['inventory.view','requisitions.view','machine.view','equipment.view','facility.view','vendors.view','history.view']};
const grants=[
  {id:10,permissionKey:'inventory.create',label:'Add inventory items',module:'inventory',moduleLabel:'Inventory',moduleShortLabel:'Inventory',grantedByUserId:1,grantedBy:'Jeff R Grove',grantedAt:'2026-07-24T12:00:00.000Z',expiresAt:null,reason:null},
  {id:11,permissionKey:'inventory.edit',label:'Edit inventory items',module:'inventory',moduleLabel:'Inventory',moduleShortLabel:'Inventory',grantedByUserId:1,grantedBy:'Jeff R Grove',grantedAt:'2026-07-24T12:00:00.000Z',expiresAt:null,reason:null},
  {id:12,permissionKey:'facility.upload',label:'Upload documents or media',module:'facility',moduleLabel:'Facility Info',moduleShortLabel:'Facility',grantedByUserId:1,grantedBy:'Jeff R Grove',grantedAt:'2026-07-24T12:00:00.000Z',expiresAt:'2026-08-24T12:00:00.000Z',reason:null},
];
const roster={
  serverTime:'2026-07-24T14:00:00.000Z',
  policy:{heartbeatIntervalMs:45000,rosterRefreshIntervalMs:25000,onlineThresholdMs:120000,awayAfterMs:600000,writeThrottleMs:25000},
  totalUsers:4,activeUsers:3,onlineCount:1,awayCount:1,offlineCount:1,disabledCount:1,
  users:[
    {id:1,fullName:'Jeff R Grove',role:'Admin',isOwnerAdmin:true,disabled:false,isCurrentUser:true,presence:'Online',lastSeenAt:'2026-07-24T14:00:00.000Z',rankProvenance:{currentRank:'Owner Admin',assignedBy:'System bootstrap',assignedAt:'2026-07-01T12:00:00.000Z',previousRank:null,reason:null,assignmentSourceAvailable:true,source:'system_bootstrap'},specialPermissionGrants:[]},
    {id:2,fullName:'Alex Rivera',role:'Maintenance Tech 3',isOwnerAdmin:false,disabled:false,isCurrentUser:false,presence:'Away',lastSeenAt:'2026-07-24T13:48:00.000Z',rankProvenance:{currentRank:'Maintenance Tech 3',assignedBy:'Jeff R Grove',assignedAt:'2026-07-24T12:00:00.000Z',previousRank:'Maintenance Tech 2',reason:'Training completed',assignmentSourceAvailable:true,source:'role_assignment_history'},specialPermissionGrants:grants},
    {id:3,fullName:'Morgan Lee',role:'Manager',isOwnerAdmin:false,disabled:false,isCurrentUser:false,presence:'Offline',lastSeenAt:'2026-07-23T14:00:00.000Z',rankProvenance:{currentRank:'Manager',assignedBy:null,assignedAt:null,previousRank:null,reason:null,assignmentSourceAvailable:false,source:'unavailable'},specialPermissionGrants:[]},
    {id:4,fullName:'Disabled Fixture',role:'Maintenance Tech 1',isOwnerAdmin:false,disabled:true,isCurrentUser:false,presence:'Offline',lastSeenAt:null,rankProvenance:{currentRank:'Maintenance Tech 1',assignedBy:'Jeff R Grove',assignedAt:'2026-07-20T12:00:00.000Z',previousRank:null,reason:null,assignmentSourceAvailable:true,source:'role_assignment_history'},specialPermissionGrants:[grants[2]]},
  ],
};

async function mockTeam(page:Page){
  let logoutCalls=0;
  let heartbeatCalls=0;
  await page.route('**/api/auth/status',route=>route.fulfill({json:{setupRequired:false,user:owner}}));
  await page.route('**/api/settings/branding',route=>route.fulfill({json:{branding:{companyName:'MCC',companySubtitle:'Maintenance Command Center',companyAccentText:'',logoMode:'text',logoUrl:'',iconAnimation:'none'}}}));
  await page.route('**/api/presence/heartbeat',route=>{heartbeatCalls+=1;return route.fulfill({json:{ok:true,serverTime:roster.serverTime,written:heartbeatCalls===1,policy:roster.policy}});});
  await page.route('**/api/presence/team',route=>route.fulfill({json:roster}));
  await page.route(/\/api\/users(?:\?.*)?$/,route=>route.fulfill({json:{users:[owner]}}));
  await page.route('**/api/auth/logout',route=>{logoutCalls+=1;return route.fulfill({json:{ok:true}});});
  return{logoutCalls:()=>logoutCalls,heartbeatCalls:()=>heartbeatCalls};
}

async function openRoster(page:Page){
  await page.getByRole('button',{name:'Open command menu'}).click();
  const teams=page.getByRole('button',{name:'Open Maintenance Team roster'});
  await expect(teams).toBeVisible();
  await teams.click();
  const dialog=page.getByRole('dialog',{name:'Maintenance Team'});
  await expect(dialog).toBeVisible();
  return{teams,dialog};
}

async function expectNoOverflow(page:Page){
  const size=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));
  expect(size.scroll).toBeLessThanOrEqual(size.client);
}

test('Teams control opens a safe live roster with shared permission and rank provenance popovers',async({page})=>{
  const fixture=await mockTeam(page);
  await page.goto('/users');
  const originalUrl=page.url();
  const{teams,dialog}=await openRoster(page);
  await expect(teams).toHaveText(/Teams\s*1/);
  await expect(page.getByRole('button',{name:'Update Password'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Logout'})).toBeVisible();
  await expect(dialog.getByText('4 users')).toBeVisible();
  const rows=dialog.locator('.maintenance-team-row');
  await expect(rows.first()).toHaveAccessibleName(/Jeff R Grove, Online/);
  await expect(dialog.locator('.maintenance-team-section-heading').filter({hasText:'Away'})).toBeVisible();
  await expect(dialog.locator('.maintenance-team-section-heading').filter({hasText:'Offline'})).toBeVisible();
  await expect(dialog.getByText('Last seen 12m ago')).toBeVisible();
  await expect(dialog.getByText('Last seen 1d ago')).toBeVisible();

  await dialog.getByRole('button',{name:/Rank details for Jeff R Grove/}).hover();
  let rankPopover=page.getByRole('region',{name:'Rank provenance for Jeff R Grove'});
  await expect(rankPopover.getByText('Assigned by: System bootstrap')).toBeVisible();
  await expect(rankPopover.getByText('Assigned: July 1, 2026')).toBeVisible();

  const alex=dialog.locator('.maintenance-team-row').filter({hasText:'Alex Rivera'});
  const inventory=alex.getByRole('button',{name:/Inventory: 2 active special permissions/});
  await expect(inventory).toHaveText('Inventory 2');
  await expect(alex.getByRole('button',{name:/Facility Info: 1 active special permission/})).toHaveText('Facility 1');
  await inventory.hover();
  const permissionPopover=page.getByRole('region',{name:'Inventory special permissions'});
  await expect(permissionPopover.getByText('Add inventory items')).toBeVisible();
  await expect(permissionPopover.getByText('Edit inventory items')).toBeVisible();
  await expect(permissionPopover.getByText(/Granted by Jeff R Grove/).first()).toBeVisible();
  await expect(dialog).toBeVisible();

  await alex.getByRole('button',{name:/Rank details for Alex Rivera/}).focus();
  rankPopover=page.getByRole('region',{name:'Rank provenance for Alex Rivera'});
  await expect(rankPopover.getByText('Assigned by: Jeff R Grove')).toBeVisible();
  await expect(rankPopover.getByText('Previous rank: Maintenance Tech 2')).toBeVisible();
  await expect(dialog).toBeVisible();

  await expect(dialog.locator('summary')).toHaveText(/Disabled accounts\s*1/);
  await expect(dialog.locator('.maintenance-team-disabled')).not.toHaveAttribute('open','');
  const box=await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x+box!.width).toBeLessThanOrEqual(await page.evaluate(()=>innerWidth));
  expect(page.url()).toBe(originalUrl);
  expect(fixture.logoutCalls()).toBe(0);
  expect(fixture.heartbeatCalls()).toBeGreaterThan(0);
  await expectNoOverflow(page);
});

test('roster Escape, outside click, and nested popovers preserve command-menu focus behavior',async({page})=>{
  await mockTeam(page);
  await page.goto('/users');
  let{teams,dialog}=await openRoster(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(teams).toBeFocused();
  await expect(page.getByText('Navigate MCC')).toBeVisible();

  await teams.click();
  dialog=page.getByRole('dialog',{name:'Maintenance Team'});
  const alex=dialog.locator('.maintenance-team-row').filter({hasText:'Alex Rivera'});
  await alex.getByRole('button',{name:/Rank details for Alex Rivera/}).click();
  const rankPopover=page.getByRole('region',{name:'Rank provenance for Alex Rivera'});
  await rankPopover.getByText('Assigned by: Jeff R Grove').click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(rankPopover).toHaveCount(0);
  await expect(dialog).toBeVisible();

  await page.locator('.command-menu-title').click({force:true});
  await expect(dialog).toHaveCount(0);
  await expect(teams).toBeFocused();
  await expect(page.getByText('Navigate MCC')).toBeVisible();
});

test('390px Teams drawer wraps account controls, traps focus, supports touch, and respects reduced motion',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.emulateMedia({reducedMotion:'reduce'});
  await mockTeam(page);
  await page.goto('/users');
  const{dialog}=await openRoster(page);
  const box=await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBe(0);
  expect(Math.round(box!.width)).toBe(390);
  expect(Math.round(box!.y+box!.height)).toBe(844);
  await expect(dialog).toHaveCSS('animation-name','none');

  const controls=page.locator('.command-menu-user-actions');
  const controlBox=await controls.boundingBox();
  expect(controlBox).not.toBeNull();
  expect(controlBox!.x+controlBox!.width).toBeLessThanOrEqual(390);
  await expect(page.getByRole('button',{name:'Update Password'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Logout'})).toBeVisible();

  const alex=dialog.locator('.maintenance-team-row').filter({hasText:'Alex Rivera'});
  const inventory=alex.getByRole('button',{name:/Inventory: 2 active special permissions/});
  await inventory.click();
  const permissionPopover=page.getByRole('region',{name:'Inventory special permissions'});
  await expect(permissionPopover).toBeVisible();
  await inventory.click();
  await expect(permissionPopover).toHaveCount(0);

  const close=dialog.getByRole('button',{name:'Close Maintenance Team roster'});
  await dialog.locator('summary').focus();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await expectNoOverflow(page);
});
