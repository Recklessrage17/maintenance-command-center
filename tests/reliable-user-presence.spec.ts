import {expect,type Page,test} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const policy=JSON.parse(fs.readFileSync(path.resolve('shared/presence-policy.json'),'utf8')) as {
  heartbeatIntervalMs:number;
  rosterRefreshIntervalMs:number;
  onlineTimeoutMs:number;
  awayAfterMs:number;
  writeThrottleMs:number;
};
const now='2026-07-28T16:30:00.000Z';
const owner={id:1,fullName:'Owner Admin',email:'owner@example.com',role:'Admin',isOwnerAdmin:true,canViewSystemVersion:true,forcePasswordChange:false,disabled:false,lastLoginAt:now,effectivePermissions:[],canDisable:false,canDelete:false,canResetPassword:false,canManagePermissions:false,specialPermissionGrants:[],presence:'Online',lastSeenAt:now};
const initialUsers=[
  owner,
  {id:2,fullName:'Manager Online',email:'manager@example.com',role:'Manager',isOwnerAdmin:false,forcePasswordChange:false,disabled:false,lastLoginAt:now,canDisable:true,canDelete:true,canResetPassword:true,canManagePermissions:true,specialPermissionGrants:[],presence:'Online',lastSeenAt:now},
  {id:3,fullName:'Tech Away',email:'away@example.com',role:'Maintenance Tech 2',isOwnerAdmin:false,forcePasswordChange:false,disabled:false,lastLoginAt:now,canDisable:true,canDelete:true,canResetPassword:true,canManagePermissions:true,specialPermissionGrants:[],presence:'Away',lastSeenAt:'2026-07-28T16:26:00.000Z'},
  {id:4,fullName:'Tech Offline',email:'offline@example.com',role:'Maintenance Tech 1',isOwnerAdmin:false,forcePasswordChange:false,disabled:false,lastLoginAt:null,canDisable:true,canDelete:true,canResetPassword:true,canManagePermissions:true,specialPermissionGrants:[],presence:'Offline',lastSeenAt:null},
  {id:5,fullName:'Disabled User',email:'disabled@example.com',role:'Maintenance Tech 1',isOwnerAdmin:false,forcePasswordChange:false,disabled:true,lastLoginAt:now,canDisable:true,canDelete:true,canResetPassword:true,canManagePermissions:true,specialPermissionGrants:[],presence:'Offline',lastSeenAt:'2026-07-28T15:00:00.000Z'},
];

async function mockPresence(page:Page){
  let users=structuredClone(initialUsers);
  let usersCalls=0;
  const heartbeatBodies:Record<string,unknown>[]=[];
  const disconnectBodies:Record<string,unknown>[]=[];
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url());
    const pathname=url.pathname;
    if(pathname==='/api/auth/status')return route.fulfill({json:{setupRequired:false,user:owner}});
    if(pathname==='/api/presence/heartbeat'){
      heartbeatBodies.push(route.request().postDataJSON() as Record<string,unknown>);
      return route.fulfill({json:{ok:true,serverTime:now,written:true,policy}});
    }
    if(pathname==='/api/presence/disconnect'){
      disconnectBodies.push(route.request().postDataJSON() as Record<string,unknown>);
      return route.fulfill({json:{ok:true,disconnected:true,serverTime:now}});
    }
    if(pathname==='/api/presence/team')return route.fulfill({json:{serverTime:now,policy,totalUsers:users.length,activeUsers:users.filter(user=>!user.disabled).length,onlineCount:users.filter(user=>!user.disabled&&user.presence==='Online').length,awayCount:users.filter(user=>!user.disabled&&user.presence==='Away').length,offlineCount:users.filter(user=>!user.disabled&&user.presence==='Offline').length,disabledCount:users.filter(user=>user.disabled).length,users:users.map(user=>({id:user.id,fullName:user.fullName,role:user.role,isOwnerAdmin:user.isOwnerAdmin,disabled:user.disabled,isCurrentUser:user.id===owner.id,presence:user.presence,lastSeenAt:user.lastSeenAt,rankProvenance:{currentRank:user.role,assignedBy:null,assignedAt:null,previousRank:null,reason:null,assignmentSourceAvailable:false,source:'unavailable'},specialPermissionGrants:[]}))}});
    if(pathname==='/api/users'&&route.request().method()==='GET'){usersCalls+=1;return route.fulfill({json:{users,presencePolicy:policy}});}
    if(pathname==='/api/settings/branding')return route.fulfill({json:{branding:{}}});
    return route.fulfill({json:{ok:true}});
  });
  return{
    heartbeatBodies,
    disconnectBodies,
    usersCalls:()=>usersCalls,
    setManagerOffline:()=>{users=users.map(user=>user.id===2?{...user,presence:'Offline',lastSeenAt:'2026-07-28T16:31:00.000Z'}:user);},
  };
}

function rowFor(page:Page,name:string){
  return page.locator('.user-table-card tbody tr').filter({hasText:name});
}

async function expectNoHorizontalOverflow(page:Page){
  const width=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));
  expect(width.scroll).toBeLessThanOrEqual(width.client);
}

test('Users keeps live presence separate from Active and Disabled account state',async({page})=>{
  await page.clock.install({time:new Date(now)});
  const fixture=await mockPresence(page);
  await page.goto('/users');
  await expect(page.getByRole('columnheader',{name:'Presence'})).toBeVisible();
  await expect(page.getByRole('columnheader',{name:'Account status'})).toBeVisible();

  const manager=rowFor(page,'Manager Online');
  await expect(manager.getByText('Online',{exact:true})).toBeVisible();
  await expect(manager.getByText('Online now',{exact:true})).toBeVisible();
  await expect(manager.getByText('Active',{exact:true})).toBeVisible();
  const away=rowFor(page,'Tech Away');
  await expect(away.getByText('Away',{exact:true})).toBeVisible();
  await expect(away.getByText(/Away — last active 4 minutes ago/)).toBeVisible();
  const offline=rowFor(page,'Tech Offline');
  await expect(offline.getByText('Offline',{exact:true})).toBeVisible();
  await expect(offline.getByText('Never connected',{exact:true})).toBeVisible();
  const disabled=rowFor(page,'Disabled User');
  await expect(disabled.getByText('Offline',{exact:true})).toBeVisible();
  await expect(disabled.getByText('Disabled',{exact:true})).toBeVisible();

  const initialCalls=fixture.usersCalls();
  await page.clock.fastForward(policy.rosterRefreshIntervalMs+100);
  await expect.poll(()=>fixture.usersCalls()).toBeGreaterThan(initialCalls);
  fixture.setManagerOffline();
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(manager.getByText('Offline',{exact:true})).toBeVisible();

  for(const viewport of [{width:1024,height:600},{width:390,height:844}]){
    await page.setViewportSize(viewport);
    await expectNoHorizontalOverflow(page);
    await expect(disabled.getByText('Disabled',{exact:true})).toBeVisible();
  }
});

test('authenticated presence client uses one timer, safe activity payloads, focus, and per-tab disconnect',async({page})=>{
  await page.clock.install({time:new Date(now)});
  const fixture=await mockPresence(page);
  await page.goto('/');
  await expect.poll(()=>fixture.heartbeatBodies.length).toBeGreaterThanOrEqual(1);
  const first=fixture.heartbeatBodies[0];
  expect(first.clientInstanceId).toMatch(/^[0-9a-f-]{36}$/i);
  expect(first.visibility).toBe('visible');
  expect(first.activitySinceLastHeartbeat).toBe(true);
  expect(Math.abs(Date.parse(String(first.lastActivityAt))-Date.parse(now))).toBeLessThan(1_000);
  expect(first).not.toHaveProperty('userId');
  expect(first).not.toHaveProperty('sessionId');

  const beforeFirstInterval=fixture.heartbeatBodies.length;
  await page.clock.fastForward(policy.heartbeatIntervalMs+100);
  await expect.poll(()=>fixture.heartbeatBodies.length).toBe(beforeFirstInterval+1);
  const beforeSecondInterval=fixture.heartbeatBodies.length;
  await page.clock.fastForward(policy.heartbeatIntervalMs+100);
  await expect.poll(()=>fixture.heartbeatBodies.length).toBe(beforeSecondInterval+1);
  const beforeFocus=fixture.heartbeatBodies.length;
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect.poll(()=>fixture.heartbeatBodies.length).toBe(beforeFocus+1);

  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false})));
  await expect.poll(()=>fixture.disconnectBodies.length).toBe(1);
  expect(fixture.disconnectBodies[0]).toEqual({clientInstanceId:first.clientInstanceId});
});
