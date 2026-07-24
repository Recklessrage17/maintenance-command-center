import {expect,type Page,test} from '@playwright/test';

type Grant={id:number;permissionKey:string;label:string;module:string;moduleLabel:string;moduleShortLabel:string;grantedByUserId:number;grantedBy:string;grantedAt:string;expiresAt:null;reason:null};
const owner={id:1,fullName:'Owner Admin',email:'owner@example.com',role:'Admin',isOwnerAdmin:true,forcePasswordChange:false,disabled:false,lastLoginAt:null,canDisable:false,canDelete:false,canResetPassword:false,canManagePermissions:false,specialPermissionGrants:[],effectivePermissions:['inventory.view','requisitions.view','machine.view','equipment.view','facility.view','vendors.view','history.view']};
const definitions={
  'inventory.view':{label:'View inventory',module:'inventory',moduleLabel:'Inventory',moduleShortLabel:'Inventory'},
  'inventory.create':{label:'Add inventory items',module:'inventory',moduleLabel:'Inventory',moduleShortLabel:'Inventory'},
  'inventory.edit':{label:'Edit inventory items',module:'inventory',moduleLabel:'Inventory',moduleShortLabel:'Inventory'},
  'facility.upload':{label:'Upload documents or media',module:'facility',moduleLabel:'Facility Info',moduleShortLabel:'Facility'},
};
function grant(id:number,key:keyof typeof definitions):Grant{return{id,permissionKey:key,...definitions[key],grantedByUserId:1,grantedBy:'Owner Admin',grantedAt:'2026-07-24T12:00:00.000Z',expiresAt:null,reason:null};}

async function mockSecurity(page:Page){
  let grants=[grant(1,'inventory.create'),grant(2,'inventory.edit'),grant(3,'facility.upload')];
  const target=()=>({id:2,fullName:'Tier 1 Fixture',email:'tier1@example.com',role:'Maintenance Tech 1',isOwnerAdmin:false,forcePasswordChange:false,disabled:false,lastLoginAt:null,canDisable:true,canDelete:true,canResetPassword:true,canManagePermissions:true,specialPermissionGrants:grants,effectivePermissions:['inventory.view','requisitions.view','machine.view','equipment.view','facility.view','vendors.view',...grants.map(item=>item.permissionKey)]});
  const resetBodies:unknown[]=[];
  const changeBodies:unknown[]=[];
  const details=()=>({
    user:target(),
    catalog:[
      {key:'inventory',label:'Inventory',shortLabel:'Inventory',permissions:[
        {key:'inventory.view',label:'View inventory',state:'inherited',inherited:true,speciallyGranted:false,grant:null},
        {key:'inventory.create',label:'Add inventory items',state:grants.some(item=>item.permissionKey==='inventory.create')?'granted':'not_allowed',inherited:false,speciallyGranted:grants.some(item=>item.permissionKey==='inventory.create'),grant:grants.find(item=>item.permissionKey==='inventory.create')??null},
        {key:'inventory.edit',label:'Edit inventory items',state:grants.some(item=>item.permissionKey==='inventory.edit')?'granted':'not_allowed',inherited:false,speciallyGranted:grants.some(item=>item.permissionKey==='inventory.edit'),grant:grants.find(item=>item.permissionKey==='inventory.edit')??null},
      ]},
      {key:'facility',label:'Facility Info',shortLabel:'Facility',permissions:[
        {key:'facility.upload',label:'Upload documents or media',state:grants.some(item=>item.permissionKey==='facility.upload')?'granted':'not_allowed',inherited:false,speciallyGranted:grants.some(item=>item.permissionKey==='facility.upload'),grant:grants.find(item=>item.permissionKey==='facility.upload')??null},
      ]},
    ],
    inheritedPermissions:['inventory.view','requisitions.view','machine.view','equipment.view','facility.view','vendors.view'],
    specialPermissionGrants:grants,
    effectivePermissions:target().effectivePermissions,
    canManage:true,
  });
  await page.route('**/api/auth/status',route=>route.fulfill({json:{setupRequired:false,user:owner}}));
  await page.route(/\/api\/users(?:\?.*)?$/,route=>route.fulfill({json:{users:[owner,target()]}}));
  await page.route(/\/api\/users\/2\/permissions$/,async route=>{
    if(route.request().method()==='PUT'){
      const keys=(route.request().postDataJSON() as {permissionKeys:string[]}).permissionKeys;
      grants=keys.map((key,index)=>grant(10+index,key as keyof typeof definitions));
      return route.fulfill({json:{ok:true,...details()}});
    }
    return route.fulfill({json:details()});
  });
  await page.route(/\/api\/users\/2\/reset-password$/,route=>{
    resetBodies.push(route.request().postDataJSON());
    const body=route.request().postDataJSON() as {temporaryPassword:string};
    return route.fulfill({json:{ok:true,message:'Temporary password created successfully',temporaryPassword:body.temporaryPassword,tempPasswordExpiresAt:'2026-07-24T12:30:00.000Z',forcePasswordChange:true,sessionsInvalidated:2}});
  });
  await page.route(/\/api\/auth\/change-password$/,route=>{changeBodies.push(route.request().postDataJSON());return route.fulfill({json:{ok:true}});});
  return{grants:()=>grants,resetBodies,changeBodies};
}

async function expectNoOverflow(page:Page){
  const size=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));
  expect(size.scroll).toBeLessThanOrEqual(size.client);
}

test('module badges stay content-sized and portal details support hover, keyboard, and touch',async({page},testInfo)=>{
  await mockSecurity(page);
  await page.goto('/users');
  const row=page.locator('tbody tr').filter({hasText:'Tier 1 Fixture'});
  const inventory=row.getByRole('button',{name:/Inventory: 2 active special permissions/});
  const facility=row.getByRole('button',{name:/Facility Info: 1 active special permission/});
  await expect(inventory).toHaveText('Inventory 2');
  await expect(facility).toHaveText('Facility 1');
  const sizing=await inventory.evaluate(element=>{const style=getComputedStyle(element);const rect=element.getBoundingClientRect();return{display:style.display,width:style.width,flexGrow:style.flexGrow,rectWidth:rect.width,parentWidth:element.parentElement!.getBoundingClientRect().width};});
  expect(['inline-flex','flex']).toContain(sizing.display);
  expect(sizing.flexGrow).toBe('0');
  expect(sizing.rectWidth).toBeLessThan(sizing.parentWidth);

  await inventory.hover();
  const popover=page.getByRole('region',{name:'Inventory special permissions'});
  await expect(popover).toBeVisible();
  await expect(popover.getByText('Add inventory items')).toBeVisible();
  await expect(popover.getByText('Edit inventory items')).toBeVisible();
  await expect(popover.getByText('View inventory')).toHaveCount(0);
  const box=await popover.boundingBox();expect(box).not.toBeNull();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(await page.evaluate(()=>innerWidth));

  await inventory.focus();
  await page.keyboard.press('Escape');
  await expect(popover).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(popover).toBeVisible();
  await expect(inventory).toHaveAttribute('aria-expanded','true');
  await page.keyboard.press('Escape');
  await expect(inventory).toHaveAttribute('aria-expanded','false');

  await page.setViewportSize({width:390,height:844});
  if(testInfo.project.name==='mobile-chromium'){
    await inventory.click();
    await expect(popover).toBeVisible();
    await inventory.click();
    await expect(popover).toHaveCount(0);
  }
  await expectNoOverflow(page);
});

test('grant and revoke updates module counts immediately and removes the final badge',async({page})=>{
  const fixture=await mockSecurity(page);
  await page.goto('/users');
  const row=page.locator('tbody tr').filter({hasText:'Tier 1 Fixture'});
  await row.getByRole('button',{name:'Special Permissions',exact:true}).click();
  let dialog=page.getByRole('dialog',{name:'Special permissions for Tier 1 Fixture'});
  await expect(dialog.getByRole('checkbox',{name:/View inventory/})).toBeChecked();
  await expect(dialog.getByRole('checkbox',{name:/View inventory/})).toBeDisabled();
  await dialog.getByRole('checkbox',{name:/Edit inventory items/}).uncheck();
  await dialog.getByRole('button',{name:'Save Changes'}).click();
  await expect(row.getByRole('button',{name:/Inventory: 1 active special permission/})).toHaveText('Inventory 1');
  expect(fixture.grants().map(item=>item.permissionKey)).toEqual(['inventory.create','facility.upload']);

  await row.getByRole('button',{name:'Special Permissions',exact:true}).click();
  dialog=page.getByRole('dialog',{name:'Special permissions for Tier 1 Fixture'});
  await dialog.getByRole('checkbox',{name:/Add inventory items/}).uncheck();
  await dialog.getByRole('button',{name:'Save Changes'}).click();
  await expect(row.getByRole('button',{name:/Inventory:/})).toHaveCount(0);
  await expect(row.getByRole('button',{name:/Facility Info: 1/})).toBeVisible();
});

test('reset password is one-time, wipes on close, and update-my-password uses self-service API',async({page})=>{
  const fixture=await mockSecurity(page);
  await page.goto('/users');
  const targetRow=page.locator('tbody tr').filter({hasText:'Tier 1 Fixture'});
  await targetRow.getByRole('button',{name:'Reset Password'}).click();
  let dialog=page.getByRole('dialog',{name:'Reset password for Tier 1 Fixture'});
  await dialog.getByRole('button',{name:'Generate Password'}).click();
  const generated=await dialog.getByLabel('Temporary Password',{exact:true}).inputValue();
  expect(generated.length).toBeGreaterThanOrEqual(14);
  expect(generated).toMatch(/[A-Z]/);expect(generated).toMatch(/[a-z]/);expect(generated).toMatch(/\d/);expect(generated).toMatch(/[^A-Za-z0-9]/);
  await dialog.getByRole('button',{name:'Reset Password'}).click();
  await expect(dialog.getByText('Temporary password created successfully')).toBeVisible();
  await expect(dialog.getByText(/shown one time only/)).toBeVisible();
  await expect(dialog.getByLabel('One-time temporary password')).toHaveValue(generated);
  expect(fixture.resetBodies).toHaveLength(1);
  await dialog.getByRole('button',{name:'Done'}).click();
  await expect(dialog).toHaveCount(0);
  await targetRow.getByRole('button',{name:'Reset Password'}).click();
  dialog=page.getByRole('dialog',{name:'Reset password for Tier 1 Fixture'});
  await expect(dialog.getByLabel('Temporary Password',{exact:true})).toHaveValue('');
  await dialog.getByRole('button',{name:'Close'}).click();

  const ownerRow=page.locator('tbody tr').filter({hasText:'Owner Admin'});
  await ownerRow.getByRole('button',{name:'Update My Password'}).click();
  dialog=page.getByRole('dialog',{name:'Update my password'});
  await dialog.getByLabel('Current Password').fill('Owner-Current!7');
  await dialog.getByLabel('New Password',{exact:true}).fill('Owner-New-Password!8');
  await dialog.getByLabel('Confirm New Password').fill('Owner-New-Password!8');
  await dialog.getByRole('button',{name:'Update Password'}).click();
  await expect(page.getByText('Password updated successfully.')).toBeVisible();
  expect(fixture.changeBodies).toEqual([{currentPassword:'Owner-Current!7',newPassword:'Owner-New-Password!8',confirmPassword:'Owner-New-Password!8'}]);
  await page.setViewportSize({width:390,height:844});
  await expectNoOverflow(page);
});
