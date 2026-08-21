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

export const issue80Owner={id:80,fullName:'Issue 80 Owner',email:'issue80-owner@example.com',role:'Admin',isOwnerAdmin:true,canViewSystemVersion:false,forcePasswordChange:false,disabled:false,lastLoginAt:null,canDisable:false,canDelete:false};
export const issue80Auth={setupRequired:false,user:issue80Owner};

export function vendorRecord(id:number,companyName:string,contacts:unknown[]=[]){
  return {id,companyName,phoneType:'',phoneNumber:'',phoneNormalized:'',phoneExt:'',websiteUrl:'',addressLine1:'',addressLine2:'',city:'',state:'',postalCode:'',country:'United States',contactName:'',contactTitle:'',contactPhoneType:'',contactPhoneNumber:'',contactPhoneExt:'',contactEmail:'',notes:'',isActive:true,deleted:false,status:'Enabled',contactCount:contacts.length,primaryContactName:'',primaryContactEmail:'',contacts};
}

export const issue80MachineAsset={id:8080,assetNumber:'PRESS-80',assetName:'Issue 80 Press',brand:'Toyo',model:'M-80',serialNumber:'M80-SN',machineYear:'2022',machineType:'Injection Molding Machine',powerType:'Electric',setupType:'Standard Injection',shotSizeOz:12,tonnage:250,barrelDiameter:'35mm',location:'North Cell',department:'Molding',status:'active',voltageValue:'480',voltageType:'AC',fullLoadAmp:'120',machineLength:'20 ft',machineWidth:'7 ft',machineHeight:'8 ft',fullDieHeightLength:'48 in',screwType:'GP',screwTipType:'Ring',screwTipInstalledDate:'',screwInstalledDate:'',barrelInstalledDate:'',barrelEndCapInstalledDate:'',barrelLength:'96 in',screwLength:'92 in',screwRebuildRepaired:false,barrelRebuildRepaired:false,screwConditionStatus:'used',barrelConditionStatus:'used',hasDoubleShotInjection:false,hasPlungerInjection:false,screw2Type:'',screw2TipType:'',screw2RebuildRepaired:false,screw2ConditionStatus:'new',screw2InstalledDate:'',screw2TipInstalledDate:'',screw2Length:'',barrel2Diameter:'',barrel2RebuildRepaired:false,barrel2ConditionStatus:'new',barrel2InstalledDate:'',barrel2EndCapInstalledDate:'',barrel2Length:'',plungerType:'',plungerRebuildRepaired:false,plungerConditionStatus:'new',plungerInstalledDate:'',plungerLength:'',plungerDiameter:'',plungerBarrelType:'',plungerBarrelRebuildRepaired:false,plungerBarrelConditionStatus:'new',plungerBarrelInstalledDate:'',plungerBarrelEndCapInstalledDate:'',plungerBarrelLength:'',plungerBarrelDiameter:'',notes:'',criticalNotes:'',createdAt:'2026-08-20T12:00:00Z',updatedAt:'2026-08-20T12:00:00Z',brandColorHex:'#1E6BFF',pmSummary:null,historyPreview:[]};
