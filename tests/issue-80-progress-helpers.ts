import {expect,type Locator,type Route} from '@playwright/test';

export type Deferred={promise:Promise<void>;release:()=>void};

export function deferred():Deferred{
  let release=()=>undefined;
  const promise=new Promise<void>(resolve=>{release=resolve;});
  return {promise,release};
}

export function fulfill(route:Route,json:unknown,status=200){
  return route.fulfill({status,contentType:'application/json',body:JSON.stringify(json)});
}

export function actionProgress(button:Locator){
  return button.locator('.action-button-progress');
}

export async function expectActionPending(button:Locator){
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute('aria-busy','true');
  await expect(actionProgress(button)).toHaveAttribute('data-action-progress','pending');
  await expect(actionProgress(button).locator('[data-action-progress-indicator="pending"]')).toBeVisible();
  await expect(button).not.toContainText('%');
}

export async function expectCompactActionRow(button:Locator,cancel:Locator){
  const buttonBox=await button.boundingBox();
  const cancelBox=await cancel.boundingBox();
  expect(buttonBox).not.toBeNull();
  expect(cancelBox).not.toBeNull();
  expect(buttonBox!.height).toBeGreaterThanOrEqual(34);
  expect(buttonBox!.height).toBeLessThanOrEqual(38);
  expect(cancelBox!.height).toBeGreaterThanOrEqual(34);
  expect(cancelBox!.height).toBeLessThanOrEqual(38);
  expect(Math.abs((buttonBox!.y+buttonBox!.height/2)-(cancelBox!.y+cancelBox!.height/2))).toBeLessThanOrEqual(1);
  const radius=Number.parseFloat(await button.evaluate(element=>getComputedStyle(element).borderTopLeftRadius));
  expect(radius).toBeGreaterThanOrEqual(buttonBox!.height/2-1);
  const progressBox=await actionProgress(button).boundingBox();
  expect(progressBox).not.toBeNull();
  expect(progressBox!.height).toBeLessThanOrEqual(16);
  expect(progressBox!.y).toBeGreaterThanOrEqual(buttonBox!.y);
  expect(progressBox!.y+progressBox!.height).toBeLessThanOrEqual(buttonBox!.y+buttonBox!.height);

  const before=await cancel.evaluate(element=>{
    const style=getComputedStyle(element);
    return {background:style.backgroundImage,border:style.borderColor,shadow:style.boxShadow};
  });
  await cancel.hover();
  await expect.poll(()=>cancel.evaluate(element=>getComputedStyle(element).backgroundImage)).toContain('151, 36, 57');
  await expect.poll(()=>cancel.evaluate(element=>getComputedStyle(element).borderColor)).toContain('255, 112, 135');
  const hovered=await cancel.evaluate(element=>{
    const style=getComputedStyle(element);
    return {background:style.backgroundImage,border:style.borderColor,shadow:style.boxShadow};
  });
  expect(hovered.background).not.toBe(before.background);
  expect(hovered.border).not.toBe(before.border);
  expect(hovered.shadow).not.toBe(before.shadow);
  expect(hovered.background).toContain('151, 36, 57');
  expect(hovered.border).toContain('255, 112, 135');
}

export const issue80Owner={id:80,fullName:'Issue 80 Owner',email:'issue80-owner@example.com',role:'Admin',isOwnerAdmin:true,canViewSystemVersion:false,forcePasswordChange:false,disabled:false,lastLoginAt:null,canDisable:false,canDelete:false};
export const issue80Auth={setupRequired:false,user:issue80Owner};

export function vendorRecord(id:number,companyName:string,contacts:unknown[]=[]){
  return {id,companyName,phoneType:'',phoneNumber:'',phoneNormalized:'',phoneExt:'',websiteUrl:'',addressLine1:'',addressLine2:'',city:'',state:'',postalCode:'',country:'United States',contactName:'',contactTitle:'',contactPhoneType:'',contactPhoneNumber:'',contactPhoneExt:'',contactEmail:'',notes:'',isActive:true,deleted:false,status:'Enabled',contactCount:contacts.length,primaryContactName:'',primaryContactEmail:'',contacts};
}

export const issue80MachineAsset={id:8080,assetNumber:'PRESS-80',assetName:'Issue 80 Press',brand:'Toyo',model:'M-80',serialNumber:'M80-SN',machineYear:'2022',machineType:'Injection Molding Machine',powerType:'Electric',setupType:'Standard Injection',shotSizeOz:12,tonnage:250,barrelDiameter:'35mm',location:'North Cell',department:'Molding',status:'active',voltageValue:'480',voltageType:'AC',fullLoadAmp:'120',machineLength:'20 ft',machineWidth:'7 ft',machineHeight:'8 ft',fullDieHeightLength:'48 in',screwType:'GP',screwTipType:'Ring',screwTipInstalledDate:'',screwInstalledDate:'',barrelInstalledDate:'',barrelEndCapInstalledDate:'',barrelLength:'96 in',screwLength:'92 in',screwRebuildRepaired:false,barrelRebuildRepaired:false,screwConditionStatus:'used',barrelConditionStatus:'used',hasDoubleShotInjection:false,hasPlungerInjection:false,screw2Type:'',screw2TipType:'',screw2RebuildRepaired:false,screw2ConditionStatus:'new',screw2InstalledDate:'',screw2TipInstalledDate:'',screw2Length:'',barrel2Diameter:'',barrel2RebuildRepaired:false,barrel2ConditionStatus:'new',barrel2InstalledDate:'',barrel2EndCapInstalledDate:'',barrel2Length:'',plungerType:'',plungerRebuildRepaired:false,plungerConditionStatus:'new',plungerInstalledDate:'',plungerLength:'',plungerDiameter:'',plungerBarrelType:'',plungerBarrelRebuildRepaired:false,plungerBarrelConditionStatus:'new',plungerBarrelInstalledDate:'',plungerBarrelEndCapInstalledDate:'',plungerBarrelLength:'',plungerBarrelDiameter:'',notes:'',criticalNotes:'',createdAt:'2026-08-20T12:00:00Z',updatedAt:'2026-08-20T12:00:00Z',brandColorHex:'#1E6BFF',pmSummary:null,historyPreview:[]};
