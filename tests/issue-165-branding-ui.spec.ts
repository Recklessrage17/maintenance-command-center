import {expect, test, type Page, type Route} from '@playwright/test';

const baseBranding={companyName:'MCC',companyAccentText:'',companySubtitle:'Maintenance Command Center',logoMode:'text',logoUrl:'',iconAnimation:'none'};
const owner={id:165,fullName:'Branding Owner',email:'owner@example.com',role:'Admin',isOwnerAdmin:true,forcePasswordChange:false};
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=';

function fulfill(route:Route,json:unknown,status=200){return route.fulfill({status,json});}

async function setup(page:Page,options:{logoUrl?:string;owner?:boolean;holdUpload?:Promise<void>}={}){
  let branding={...baseBranding,logoUrl:options.logoUrl??'',logoMode:options.logoUrl?'image':'text'};
  const requests:{method:string;body:string|null}[]=[];
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    const method=route.request().method();
    if(path==='/api/auth/status')return fulfill(route,{setupRequired:false,user:{...owner,isOwnerAdmin:options.owner!==false}});
    if(path==='/api/settings/branding'&&method==='GET')return fulfill(route,{ok:true,branding});
    if(path==='/api/settings/branding'&&method==='PUT'){
      requests.push({method,body:route.request().postData()});
      branding=route.request().postDataJSON().resetToDefault?{...baseBranding}:{...branding,...route.request().postDataJSON()};
      return fulfill(route,{ok:true,branding});
    }
    if(path==='/api/settings/branding/logo'){
      if(options.holdUpload)await options.holdUpload;
      branding={...branding,logoUrl:'/uploads/branding/saved.png',logoMode:'image'};
      return fulfill(route,{ok:true,branding});
    }
    if(path==='/api/backup/status'||path==='/api/admin/reset/status')return fulfill(route,{error:'Unavailable in fixture.'},403);
    if(path==='/api/presence/heartbeat'||path==='/api/presence/disconnect')return fulfill(route,{ok:true});
    return fulfill(route,{ok:true});
  });
  await page.route('**/uploads/branding/*.png',route=>route.fulfill({body:Buffer.from(image.split(',')[1],'base64'),contentType:'image/png'}));
  await page.goto('/settings');
  return requests;
}

test('branding preview updates live, contains long text, and stacks on mobile',async({page})=>{
  await setup(page);
  const card=page.locator('.branding-card');
  await expect(card.getByText('No logo uploaded')).toBeVisible();
  await card.getByLabel(/Company Name/).fill('Very Long Company');
  await card.getByLabel('Accent Text').fill('MACHINES');
  await card.getByLabel('Subtitle').fill('A long subtitle for the launcher preview');
  const preview=card.locator('.branding-preview');
  await expect(preview).toContainText('Very Long Company');
  await expect(preview).toContainText('MACHINES');
  await expect(preview).toContainText('A long subtitle for the launcher preview');
  for(const animation of ['none','glow','rotate','pulse']){
    await card.getByLabel('Icon Animation').selectOption(animation);
    await expect(preview.locator('.command-brand')).toHaveClass(new RegExp(`brand-animation-${animation}`));
  }
  await expect(preview.locator('.command-brand')).toHaveClass(/text-brand/);
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:900});
    const box=await preview.boundingBox();
    const brand=await preview.locator('.command-brand').boundingBox();
    expect(box&&brand).toBeTruthy();
    expect(brand!.x).toBeGreaterThanOrEqual(box!.x);
    expect(brand!.x+brand!.width).toBeLessThanOrEqual(box!.x+box!.width+1);
    expect(Math.abs((brand!.x+brand!.width/2)-(box!.x+box!.width/2))).toBeLessThanOrEqual(2);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
});

test('saved logo and selected image render contained previews without persisting a blob URL',async({page})=>{
  let release=()=>{};
  const holdUpload=new Promise<void>(resolve=>{release=resolve;});
  const requests=await setup(page,{logoUrl:'/uploads/branding/existing.png',holdUpload});
  const card=page.locator('.branding-card');
  const preview=card.locator('.branding-logo-preview img');
  await expect(preview).toHaveAttribute('src','/uploads/branding/existing.png');
  await expect(card.locator('.branding-file-name')).toHaveText('existing.png');
  await expect(preview).toHaveCSS('object-fit','contain');
  await expect(card.locator('.branding-preview .command-brand')).toHaveClass(/image-brand/);
  await card.getByLabel('Logo Mode').selectOption('text');
  await expect(card.locator('.branding-preview .command-brand')).toHaveClass(/text-brand/);
  await card.getByLabel('Logo Mode').selectOption('image');
  await card.getByLabel('Replace logo or icon file').setInputFiles({name:'new.png',mimeType:'image/png',buffer:Buffer.from(image.split(',')[1],'base64')});
  await expect(preview).toHaveAttribute('src',/^blob:/);
  await expect(card.locator('.branding-file-name')).toHaveText('new.png');
  release();
  await expect(preview).toHaveAttribute('src','/uploads/branding/saved.png');
  await card.getByRole('button',{name:'Save Branding'}).click();
  await expect.poll(()=>requests.length).toBe(1);
  expect(requests[0].body).not.toContain('blob:');
});

test('non-owner cannot upload, save, or reset branding',async({page})=>{
  await setup(page,{owner:false});
  const card=page.locator('.branding-card');
  await expect(card.getByLabel('Choose logo or icon file')).toBeDisabled();
  await expect(card.getByRole('button',{name:'Save Branding'})).toBeDisabled();
  await expect(card.getByRole('button',{name:'Reset to Default MCC'})).toBeDisabled();
});
