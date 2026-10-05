import { expect, test } from '@playwright/test';

for(const library of ['machine','equipment'] as const){
  test(library+' Dashboard notes share chevrons, smooth motion, inert content and modal keyboard behavior',async({page})=>{
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.route('**/api/auth/status',route=>route.fulfill({json:{setupRequired:false,user:{id:1,fullName:'Tester',email:'test@example.com',role:'Admin',isOwnerAdmin:true,forcePasswordChange:false,effectivePermissions:['machine.view','equipment.view','inventory.view']}}}));
    await page.route('**/api/dashboard/inventory-attention',route=>route.fulfill({json:{items:[],outOfStockCount:0,lowStockCount:0}}));
    await page.route('**/api/requisitions/summary',route=>route.fulfill({json:{ok:true,requestedCount:2,orderedCount:1,activeCount:3}}));
    const notes=[1,2].map(id=>({id,assetId:900,assetLibrary:library,assetNumber:'Asset 900',assetName:'Test asset',brand:'Test',assetAccentColor:'#1E6BFF',title:'Warning '+id,noteDate:'2026-09-30',body:'Long technician warning body. '.repeat(20),warning:true,createdBy:'Technician',createdAt:'2026-09-30T12:00:00Z',pdfUrl:'/note.pdf'}));
    await page.route('**/api/dashboard/preventive-maintenance-due',route=>route.fulfill({json:{ok:true,alerts:[],warningNotes:notes}}));
    await page.goto('/');
    // Requisition navigation keeps its existing action arrow presentation.
    const arrows=page.locator('.dashboard-requisition-summary .dashboard-metric-arrow');
    await expect(arrows).toHaveCount(3);await expect(arrows.locator('.dashboard-round-expander')).toHaveCount(0);
    const inventoryArrows=page.locator('.dashboard-stock-counter-arrow');await expect(inventoryArrows).toHaveCount(2);
    for(const control of [arrows,inventoryArrows]){for(const path of await control.locator('path').all())await expect(path).toHaveAttribute('d','M5 10h9m-3.5-3.5L14 10l-3.5 3.5');expect(await control.evaluateAll(elements=>elements.every(el=>!el.closest('[aria-expanded]')&&!el.classList.contains('dashboard-round-expander')))).toBe(true);}
    const pmCircle=page.locator('.dashboard-pm-section--'+library+' .dashboard-round-expander');
    const pmStyle=await pmCircle.evaluate(element=>{const s=getComputedStyle(element);return {width:s.width,height:s.height,radius:s.borderRadius,border:s.borderTopWidth,iconDuration:getComputedStyle(element.querySelector('svg')!).transitionDuration};});
    const opener=page.getByRole('button',{name:'Open 2 Open work orders for Asset 900'});await opener.click();
    const dialog=page.getByRole('dialog');const row=dialog.locator('.dashboard-tech-note-row').first();
    const toggle=row.locator('.dashboard-tech-note-toggle');const circle=toggle.locator('.dashboard-round-expander');const body=row.locator('.dashboard-tech-note-body');
    await expect(toggle.locator('button')).toHaveCount(0);await expect(toggle).toHaveAttribute('aria-expanded','false');
    await expect(body).toHaveAttribute('aria-hidden','true');await expect(body).toHaveAttribute('inert','');await expect(body).not.toHaveAttribute('hidden');
    await expect(circle.locator('path')).toHaveAttribute('d','m5.5 7.5 4.5 4.5 4.5-4.5');
    await expect(circle.locator('svg')).toHaveCSS('transform','matrix(1, 0, 0, 1, 0, 0)');
    const noteStyle=await circle.evaluate(element=>{const s=getComputedStyle(element);return {width:s.width,height:s.height,radius:s.borderRadius,border:s.borderTopWidth,iconDuration:getComputedStyle(element.querySelector('svg')!).transitionDuration};});expect(noteStyle).toEqual(pmStyle);
    expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await toggle.focus();await page.keyboard.press('Tab');await expect(dialog.locator('.dashboard-tech-note-toggle').nth(1)).toBeFocused();
    await toggle.focus();await toggle.press('Enter');await expect(toggle).toHaveAttribute('aria-expanded','true');await expect(body).not.toHaveAttribute('inert');
    await expect(body).toHaveCSS('transition-duration','0.3s, 0.3s, 0s');await expect(body).toHaveCSS('opacity','1');await expect(circle.locator('svg')).toHaveCSS('transform','matrix(-1, 0, 0, -1, 0, 0)');
    const height=(await body.boundingBox())!.height;
    const closing=await toggle.evaluate(async element=>{(element as HTMLButtonElement).click();await new Promise(requestAnimationFrame);const body=element.parentElement!.querySelector('.dashboard-tech-note-body')!;const animations=body.getAnimations();animations.forEach(a=>{a.pause();a.currentTime=100;});const sample={height:body.getBoundingClientRect().height,opacity:Number(getComputedStyle(body).opacity)};animations.forEach(a=>a.play());return sample;});
    expect(closing.height).toBeGreaterThan(0);expect(closing.height).toBeLessThan(height);expect(closing.opacity).toBeGreaterThan(0);expect(closing.opacity).toBeLessThan(1);
    await expect(toggle).toHaveAttribute('aria-expanded','false');await expect(body).toHaveAttribute('inert','');await expect(body).toHaveCSS('visibility','hidden');
    const opening=await toggle.evaluate(async element=>{(element as HTMLButtonElement).click();await new Promise(requestAnimationFrame);const body=element.parentElement!.querySelector('.dashboard-tech-note-body')!;const animations=body.getAnimations();animations.forEach(a=>{a.pause();a.currentTime=100;});const sample={height:body.getBoundingClientRect().height,opacity:Number(getComputedStyle(body).opacity)};animations.forEach(a=>a.play());return sample;});
    expect(opening.height).toBeGreaterThan(0);expect(opening.height).toBeLessThan(height);expect(opening.opacity).toBeGreaterThan(0);expect(opening.opacity).toBeLessThan(1);
    await expect(body).toHaveCSS('opacity','1');await toggle.focus();await page.keyboard.press('Tab');await expect(body.getByRole('button',{name:'Print / PDF'})).toBeFocused();
    await toggle.click();await expect(body).toHaveAttribute('inert','');await toggle.focus();await page.keyboard.press('Tab');await expect(dialog.locator('.dashboard-tech-note-toggle').nth(1)).toBeFocused();
    for(const width of [390,768,1440]){await page.setViewportSize({width,height:900});expect(await dialog.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);}
    await page.emulateMedia({reducedMotion:'reduce'});await expect(body).toHaveCSS('transition-duration','0s');await expect(circle.locator('svg')).toHaveCSS('transition-duration','0s');
    await toggle.press('Space');await expect(toggle).toHaveAttribute('aria-expanded','true');await expect(body).toHaveCSS('opacity','1');await toggle.press('Space');await expect(body).toHaveCSS('visibility','hidden');
    await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(opener).toBeFocused();
  });
}
