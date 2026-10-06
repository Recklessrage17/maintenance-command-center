import { expect, type Page, test } from '@playwright/test';

const fixture = { id:175,assetNumber:'PRESS-175',assetName:'Status Press',brand:'Toyo',model:'SI-250',serialNumber:'SN175',machineYear:'2020',machineType:'Injection Molding Machine',powerType:'Electric',setupType:'Standard Injection',tonnage:250,shotSizeOz:12,location:'North',department:'Molding',status:'active',brandColorHex:'#44D7FF',historyPreview:[],screwInstalledDate:'',screwTipInstalledDate:'',barrelInstalledDate:'',barrelEndCapInstalledDate:'' };

async function openAsset(page:Page,status='active',canEdit=true) {
  let asset={...fixture,status};
  const saves={writes:0,failNext:false,hold:false,release:undefined as undefined | (()=>void)};
  await page.route('**/api/auth/status',route=>route.fulfill({json:{setupRequired:false,user:{id:1,fullName:'Status Tester',email:'status@example.com',role:canEdit?'Admin':'Maintenance Tech 1',isOwnerAdmin:canEdit,forcePasswordChange:false}}}));
  await page.route(/\/api\/machine-library\/assets(?:\?.*)?$/,route=>route.fulfill({json:{ok:true,assets:[asset],brandSettings:[],permissions:{canEdit,canDelete:canEdit,canManagePm:canEdit}}}));
  await page.route(/\/api\/machine-library\/assets\/175$/,async route=>{
    if(route.request().method()!=='PUT')return route.fallback();
    saves.writes++;
    if(saves.hold)await new Promise<void>(resolve=>{saves.release=resolve;});
    if(saves.failNext){saves.failNext=false;return route.fulfill({status:500,json:{ok:false,error:'Status save failed'}});}
    asset={...asset,...route.request().postDataJSON()};
    await route.fulfill({json:{ok:true,asset}});
  });
  await page.route(/\/api\/machine-library\/assets\/175\/(inspection-records|component-images|notes|preventive-maintenance|documents|document-folders)$/,route=>route.fulfill({json:{ok:true,records:[],images:[],notes:[],tasks:[],folders:[],documents:[],summary:{total:0,dueSoon:0,overdue:0,nextDueDate:null,nextDueMeter:null}}}));
  await page.goto('/machine-library');
  const card=page.getByRole('button',{name:'View details for PRESS-175',exact:true});
  await card.focus();await card.press('Enter');
  const detail=page.locator('.machine-detail-modal');
  const badge=detail.getByRole('status',{name:/^Machine status:/});
  await expect(badge).toBeVisible();
  return {detail,badge,dot:badge.locator('.machine-detail-status-dot'),saves};
}

for(const status of ['active','disabled','down','removed']) {
  test(`${status} uses an accessible dot in the title row and only Active pulses`,async({page})=>{
    await page.emulateMedia({reducedMotion:'no-preference'});
    const {detail,badge,dot}=await openAsset(page,status);
    await expect(badge).toHaveAccessibleName(`Machine status: ${status.toUpperCase()}`);
    await expect(badge.locator('.sr-only')).toHaveText(`Machine status: ${status.toUpperCase()}`);
    await expect(detail.locator('.machine-detail-title-row [role="status"]')).toHaveCount(1);
    await expect(detail.locator('.asset-detail-identity-strip .machine-detail-status')).toHaveCount(0);
    await expect(detail.locator('.machine-detail-status-pill')).toHaveCount(0);
    await expect(badge).toHaveAttribute('aria-atomic','true');
    await expect(dot).toHaveAttribute('aria-hidden','true');
    await expect(detail.locator('.machine-detail-status-dot')).toHaveCount(1);
    await expect(detail.locator('.machine-detail-heading .machine-detail-brand-dot')).toHaveCount(0);
    expect(await dot.evaluate(el=>getComputedStyle(el).animationName)).toBe(status==='active'?'machine-detail-status-pulse':'none');
    if(status==='active')expect(await dot.evaluate(el=>getComputedStyle(el).animationIterationCount)).toBe('infinite');
    // The badge conveys information and adds no extra keyboard stop.
    await expect(badge).not.toHaveAttribute('tabindex','0');
    await expect(detail.locator('.asset-detail-brand-copy')).toContainText('Toyo');
  });
}

test('dot remains aligned and accessible with reduced motion at desktop, tablet and mobile widths',async({page},testInfo)=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  const {badge,dot}=await openAsset(page);
  for(const width of [1440,820,390,320]) {
    await page.setViewportSize({width,height:900});
    await expect(badge).toHaveAccessibleName('Machine status: ACTIVE');
    expect(await dot.evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
    const geometry=await badge.evaluate(el=>{
      const rect=el.getBoundingClientRect();
      const row=el.closest('.machine-detail-title-row')!.getBoundingClientRect();
      const title=el.closest('.machine-detail-title-row')!.querySelector('.eyebrow')!.getBoundingClientRect();
      const hidden=el.querySelector('.sr-only')!.getBoundingClientRect();
      return {width:rect.width,height:rect.height,right:rect.right,overflow:el.scrollWidth-el.clientWidth,rightGap:row.right-rect.right,centerDelta:Math.abs(rect.top+rect.height/2-(title.top+title.height/2)),afterTitle:rect.left>=title.right,hiddenWidth:hidden.width,hiddenHeight:hidden.height};
    });
    expect(geometry.width).toBe(20);expect(geometry.height).toBe(20);
    expect(geometry.rightGap).toBeLessThanOrEqual(1);expect(geometry.centerDelta).toBeLessThanOrEqual(1);expect(geometry.afterTitle).toBeTruthy();
    expect(geometry.hiddenWidth).toBeLessThanOrEqual(1);expect(geometry.hiddenHeight).toBeLessThanOrEqual(1);
    expect(geometry.right).toBeLessThanOrEqual(width);expect(geometry.overflow).toBeLessThanOrEqual(1);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.locator('.machine-detail-heading').screenshot({path:testInfo.outputPath(`status-dot-${width}.png`)});
  }
});

test('keyboard status editing updates the dot only after successful save and preserves cancel and failure',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  const {detail,badge,saves}=await openAsset(page);
  const basic=detail.locator('.mcc-compact-detail-grid [data-category-accent="basic"]');
  const edit=basic.getByRole('button',{name:'Edit',exact:true});
  await edit.focus();await edit.press('Enter');
  await basic.getByRole('combobox',{name:'Status',exact:true}).selectOption('disabled');
  await expect(badge).toHaveAccessibleName('Machine status: ACTIVE');
  await basic.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(badge).toHaveAccessibleName('Machine status: ACTIVE');expect(saves.writes).toBe(0);
  await edit.focus();await edit.press('Space');
  await basic.getByRole('combobox',{name:'Status',exact:true}).selectOption('disabled');
  saves.failNext=true;
  await basic.getByRole('button',{name:'Save',exact:true}).click();
  await expect(basic.getByRole('alert')).toContainText('Status save failed');
  await expect(badge).toHaveAccessibleName('Machine status: ACTIVE');
  saves.hold=true;
  await basic.getByRole('button',{name:'Try Save',exact:true}).click();
  await expect.poll(()=>Boolean(saves.release)).toBe(true);
  await expect(badge).toHaveAccessibleName('Machine status: ACTIVE');
  saves.hold=false;saves.release!();
  await expect(badge).toHaveAccessibleName('Machine status: DISABLED');
  await expect(basic.getByRole('combobox',{name:'Status',exact:true})).toHaveCount(0);
  await edit.click();await basic.getByRole('combobox',{name:'Status',exact:true}).selectOption('active');
  await basic.getByRole('button',{name:'Save',exact:true}).click();
  await expect(badge).toHaveAccessibleName('Machine status: ACTIVE');expect(saves.writes).toBe(3);
});

test('read-only users see the status without gaining editing permissions',async({page})=>{
  const {detail,badge,saves}=await openAsset(page,'disabled',false);
  await expect(badge).toHaveAccessibleName('Machine status: DISABLED');
  await expect(detail.locator('.mcc-compact-detail-grid .machine-detail-section-actions button')).toHaveCount(0);
  await detail.getByRole('button',{name:/^Basic Info/}).click();
  await expect(detail.getByRole('combobox',{name:'Status',exact:true})).toHaveCount(0);
  expect(saves.writes).toBe(0);
});
