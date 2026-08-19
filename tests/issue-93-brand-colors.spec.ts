import { expect, type Page, test } from '@playwright/test';

const user={id:1,fullName:'Brand Color Admin',email:'brand@example.com',role:'Admin',isOwnerAdmin:true,forcePasswordChange:false,effectivePermissions:['machine.view','machine.edit']};
const baseAsset={assetName:'Injection Press',model:'Model 1',serialNumber:'SER-1',machineYear:'2020',machineType:'Injection Molding Machine',powerType:'Electric',setupType:'Standard Injection',shotSizeOz:12,tonnage:250,barrelDiameter:'40 mm',location:'Molding',department:'Production',status:'active',voltageValue:'480',voltageType:'VAC',fullLoadAmp:'',machineLength:'',machineWidth:'',machineHeight:'',fullDieHeightLength:'',screwType:'',screwTipType:'',screwTipInstalledDate:'',screwInstalledDate:'',barrelInstalledDate:'',barrelEndCapInstalledDate:'',barrelLength:'',screwLength:'',screwRebuildRepaired:false,barrelRebuildRepaired:false,screwConditionStatus:'new',barrelConditionStatus:'new',hasDoubleShotInjection:false,hasPlungerInjection:false,screw2Type:'',screw2TipType:'',screw2RebuildRepaired:false,screw2ConditionStatus:'new',screw2InstalledDate:'',screw2TipInstalledDate:'',screw2Length:'',barrel2Diameter:'',barrel2RebuildRepaired:false,barrel2ConditionStatus:'new',barrel2InstalledDate:'',barrel2EndCapInstalledDate:'',barrel2Length:'',plungerType:'',plungerRebuildRepaired:false,plungerConditionStatus:'new',plungerInstalledDate:'',plungerLength:'',plungerDiameter:'',plungerBarrelType:'',plungerBarrelRebuildRepaired:false,plungerBarrelConditionStatus:'new',plungerBarrelInstalledDate:'',plungerBarrelEndCapInstalledDate:'',plungerBarrelLength:'',plungerBarrelDiameter:'',notes:'',criticalNotes:'',createdAt:'2026-08-19T12:00:00Z',updatedAt:'2026-08-19T12:00:00Z',pmSummary:null,historyPreview:[]};
const initialColors:Record<string,string>={Toyo:'#1E6BFF',Arburg:'#38D7B3',Engel:'#FFFFFF',Husky:'#FFD45A',Netstal:'#EB5E41','Custom Co':'#8C7CFF'};

async function mockBrandColors(page:Page){
  const colors={...initialColors};
  const saves:Array<{brandName:string;colorHex:string}>=[];
  await page.route('**/api/**',async route=>{
    const request=route.request();const path=new URL(request.url()).pathname;
    if(path==='/api/auth/status')return route.fulfill({json:{setupRequired:false,user}});
    if(path==='/api/settings/branding')return route.fulfill({json:{branding:{companyName:'MCC',companySubtitle:'Maintenance Command Center',companyAccentText:'',logoMode:'text',logoUrl:'',iconAnimation:'none'}}});
    if(path==='/api/machine-library/assets'){
      const brandSettings=Object.entries(colors).map(([brandName,colorHex])=>({brandName,colorHex}));
      const assets=brandSettings.slice(0,5).map((setting,index)=>({...baseAsset,id:index+1,assetNumber:`Press ${index+1}`,brand:setting.brandName,brandColorHex:setting.colorHex,serialNumber:`SER-${index+1}`}));
      return route.fulfill({json:{ok:true,assets,brandSettings,permissions:{canEdit:true,canDelete:true,canManagePm:true}}});
    }
    if(path.startsWith('/api/machine-library/brand-settings/')&&request.method()==='PUT'){
      const brandName=decodeURIComponent(path.split('/').at(-1)!);const body=request.postDataJSON() as {colorHex:string};colors[brandName]=body.colorHex;saves.push({brandName,colorHex:body.colorHex});
      return route.fulfill({json:{ok:true,brandSetting:{brandName,colorHex:body.colorHex}}});
    }
    if(path==='/api/presence/heartbeat')return route.fulfill({json:{ok:true,policy:{heartbeatIntervalMs:25000,rosterRefreshIntervalMs:25000,onlineTimeoutMs:90000,awayAfterMs:300000,writeThrottleMs:20000}}});
    return route.fulfill({json:{ok:true}});
  });
  return {colors,saves};
}

async function openColorEditor(page:Page){
  await page.getByRole('button',{name:'Machine Library tools'}).click();
  await page.getByRole('menuitem',{name:/Brand Color Settings/}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

test('brand tint classes preserve Issue 92 rows and the custom picker stays synchronized and persistent',async({page},testInfo)=>{
  const state=await mockBrandColors(page);await page.goto('/machine-library');
  const rows=page.locator('.machine-asset-card');await expect(rows).toHaveCount(5);
  await expect(page.getByRole('button',{name:'View details for Press 1'})).not.toHaveClass(/machine-brand-tint-/);
  await expect(page.getByRole('button',{name:'View details for Press 2'})).not.toHaveClass(/machine-brand-tint-/);
  await expect(page.getByRole('button',{name:'View details for Press 3'})).toHaveClass(/machine-brand-tint-engel/);
  await expect(page.getByRole('button',{name:'View details for Press 4'})).toHaveClass(/machine-brand-tint-husky/);
  await expect(page.getByRole('button',{name:'View details for Press 5'})).toHaveClass(/machine-brand-tint-netstal/);
  const listLayout=await page.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth,heights:[...document.querySelectorAll('.machine-asset-card')].map(row=>row.getBoundingClientRect().height)}));
  expect(listLayout.scroll).toBeLessThanOrEqual(listLayout.viewport);expect(Math.max(...listLayout.heights)-Math.min(...listLayout.heights)).toBeLessThanOrEqual(2);

  await openColorEditor(page);
  const help=page.getByRole('button',{name:'About machine brand colors'});await help.focus();await expect(page.getByRole('note')).toBeVisible();await expect(page.getByRole('note')).toContainText('#EB5E41');
  const customRow=page.locator('.machine-color-row',{hasText:'Custom Co'});const hex=customRow.getByLabel('Hex color');const save=customRow.getByRole('button',{name:'Save'});
  await hex.fill('#123');await expect(hex).toHaveAttribute('aria-invalid','true');await expect(save).toBeDisabled();await expect(customRow).toContainText('Use a six-digit hex value');
  await hex.fill('#eb5e41');await expect(hex).toHaveValue('#EB5E41');await expect(hex).toHaveAttribute('aria-invalid','false');await expect(customRow.locator('.machine-color-row-preview')).toHaveCSS('border-left-color','rgb(235, 94, 65)');

  await customRow.getByRole('button',{name:'Choose Custom Co color'}).click();const picker=customRow.locator('.machine-color-picker');await expect(picker).toBeVisible();
  const beforeHue=await hex.inputValue();await customRow.getByLabel('Custom Co hue').fill('180');await expect(hex).not.toHaveValue(beforeHue);await expect(hex).toHaveValue(/^#[0-9A-F]{6}$/);
  const area=customRow.locator('.machine-color-sv-area');await expect(area).toHaveAttribute('aria-hidden','true');await expect(area).not.toHaveAttribute('role');await expect(area).not.toHaveAttribute('tabindex');
  const beforePointer=await hex.inputValue();await area.click({position:{x:40,y:30}});await expect(hex).not.toHaveValue(beforePointer);
  const saturation=customRow.getByRole('slider',{name:'Custom Co saturation'});const brightness=customRow.getByRole('slider',{name:'Custom Co brightness'});
  await expect(saturation).toHaveAttribute('min','0');await expect(saturation).toHaveAttribute('max','100');await expect(brightness).toHaveAttribute('min','0');await expect(brightness).toHaveAttribute('max','100');
  const beforeSaturation=await hex.inputValue();const saturationValue=Number(await saturation.inputValue());await saturation.focus();await page.keyboard.press('ArrowRight');await expect(saturation).toHaveValue(String(Math.min(100,saturationValue+1)));await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');await expect(hex).not.toHaveValue(beforeSaturation);
  const beforeBrightness=await hex.inputValue();const brightnessValue=Number(await brightness.inputValue());await brightness.focus();await page.keyboard.press('ArrowDown');await expect(brightness).toHaveValue(String(Math.max(0,brightnessValue-1)));await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');await expect(hex).not.toHaveValue(beforeBrightness);
  page.once('dialog',dialog=>dialog.accept());await save.click();await expect.poll(()=>state.saves.length).toBe(1);expect(state.saves[0]).toEqual({brandName:'Custom Co',colorHex:await hex.inputValue()});
  await expect(page.getByText('Custom Co color updated.')).toBeVisible();
  await page.reload();await openColorEditor(page);await expect(page.locator('.machine-color-row',{hasText:'Custom Co'}).getByLabel('Hex color')).toHaveValue(state.colors['Custom Co']);
  const modalLayout=await page.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth,modal:document.querySelector('.machine-color-modal')!.getBoundingClientRect().width}));expect(modalLayout.scroll).toBeLessThanOrEqual(modalLayout.viewport);expect(modalLayout.modal).toBeLessThanOrEqual(modalLayout.viewport);
  if(testInfo.project.name==='mobile-chromium')expect(modalLayout.modal).toBeGreaterThan(300);
});

test('brand color preview motion honors reduced-motion preference',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','One reduced-motion style audit is sufficient.');
  await page.emulateMedia({reducedMotion:'reduce'});await mockBrandColors(page);await page.goto('/machine-library');await openColorEditor(page);
  const motion=await page.locator('.machine-color-row-preview').first().evaluate(element=>getComputedStyle(element).transitionDuration);expect(motion).toBe('0s');
});
