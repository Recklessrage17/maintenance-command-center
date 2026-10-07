import { expect, type Page, test } from '@playwright/test';

const machine = { screwInstalledDate:'',screwTipInstalledDate:'',barrelInstalledDate:'',barrelEndCapInstalledDate:'', id:176,assetNumber:'PRESS-176',assetName:'Compact Press',brand:'Toyo',model:'SI-250',serialNumber:'SN176',machineYear:'2020',machineType:'Injection Molding Machine',powerType:'Electric',setupType:'Standard Injection',tonnage:250,shotSizeOz:12,voltageValue:'480',voltageType:'AC',location:'North',department:'Molding',status:'active',brandColorHex:'#44D7FF',historyPreview:[] };
const equipment = { id:176,assetNumber:'EQ-176',equipmentName:'Compact Dryer',assetName:'Compact Dryer',category:'Dryer',equipmentType:'Dryer',manufacturer:'Matsui',brand:'Matsui',model:'MJ5',serialNumber:'SN176',equipmentYear:'2020',year:'2020',location:'North',department:'Molding',status:'active',criticality:'high',powerType:'Electric',voltage:'480',phase:'3',amperage:'42',airRequirement:'',waterRequirement:'',capacityRating:'500',dimensions:'48',weight:'825',specificationNotes:'',createdAt:'2026-01-01',updatedAt:'2026-01-01' };

async function openAsset(page:Page,library:'machine'|'equipment',canEdit=true,deepLink=false) {
  let asset:Record<string,unknown> = {...(library==='machine'?machine:equipment)};
  let writes=0;
  await page.route('**/api/auth/status',route=>route.fulfill({json:{setupRequired:false,user:{id:1,fullName:'Compact Tester',email:'compact@example.com',role:canEdit?'Admin':'Maintenance Tech 1',isOwnerAdmin:canEdit,forcePasswordChange:false}}}));
  const base=`/api/${library}-library/assets`;
  await page.route(new RegExp(`${base}(?:\\?.*)?$`),route=>route.fulfill({json:{ok:true,assets:[asset],categories:['Dryer'],brandSettings:[],permissions:{canEdit,canDelete:canEdit,canManagePm:canEdit}}}));
  await page.route(new RegExp(`${base}/176$`),async route=>{
    if(route.request().method()!=='PUT')return route.fallback();
    writes++;asset={...asset,...route.request().postDataJSON()};
    await route.fulfill({json:{ok:true,asset}});
  });
  await page.route(new RegExp(`${base}/176/(history|component-images|inspection-records)$`),route=>route.fulfill({json:{ok:true,records:[],images:[]}}));
  await page.route(new RegExp(`${base}/176/preventive-maintenance$`),route=>route.fulfill({json:{ok:true,tasks:[],summary:{total:12,dueSoon:1,overdue:2,nextDueDate:'2026-11-01',nextDueMeter:null}}}));
  await page.route(new RegExp(`${base}/176/document-folders$`),route=>route.fulfill({json:{ok:true,folders:[{id:1,assetId:176,name:'Manuals',path:'Manuals',description:'',documentCount:0,childCount:0}]}}));
  await page.route(new RegExp(`${base}/176/documents$`),route=>route.fulfill({json:{ok:true,documents:[]}}));
  await page.route(new RegExp(`${base}/176/notes$`),route=>route.fulfill({json:{ok:true,permissions:{canCreate:canEdit},notes:[{id:1761,assetId:176,title:'Resolved test issue',noteDate:'2026-01-01',body:'Saved note',warning:true,status:'resolved',resolvedYear:'2026',resolvedAt:'2026-01-02',createdBy:'Tester',createdAt:'2026-01-01',updatedAt:'2026-01-02',pdfFilename:'note.pdf',attachments:[{id:1,noteId:1761,filename:'attachment.pdf',mimeType:'application/pdf',fileSize:100,createdAt:'2026-01-01'}]}]}}));
  await page.goto(`/${library}-library${deepLink?'?asset=176&note=1761':''}`);
  if(!deepLink)await page.locator(`.${library}-asset-card`).click();
  const grid=page.locator('.mcc-compact-detail-grid');
  await expect(grid.getByRole('button',{name:/Preventive Maintenance Tracking/})).toContainText('12 schedules');
  return {grid,writes:()=>writes};
}

for(const library of ['machine','equipment'] as const) {
  test(`${library} accepted card selections center the panel without changing focus or horizontal position`,async({page},testInfo)=>{
    const {grid}=await openAsset(page,library);
    await expect(grid.getByRole('button',{name:/Work Orders & Notes/})).toContainText('1 resolved');
    await expect(grid.getByRole('button',{name:/Asset Document Library/})).toContainText('1 folder');
    await page.evaluate(()=>{
      const state=window as typeof window & {compactScrolls:Array<{top:number;left:number;behavior:string;panelTop:number}>};
      state.compactScrolls=[];
      const original=window.scrollTo;
      window.scrollTo=(...args:unknown[])=>{
        const options=args[0] as ScrollToOptions;
        if(typeof options==='object') {
          const panel=document.querySelector('.mcc-compact-detail-grid > article > .machine-detail-accordion-panel[aria-hidden="false"]');
          state.compactScrolls.push({top:options.top!,left:options.left!,behavior:options.behavior!,panelTop:(panel?.getBoundingClientRect().top??0)+window.scrollY});
        }
        Reflect.apply(original,window,args);
      };
    });
    let expectedCalls=0;
    for(const reducedMotion of ['no-preference','reduce'] as const) {
      await page.emulateMedia({reducedMotion});
      for(const [title,activation] of [['Asset Document Library','pointer'],['Preventive Maintenance Tracking','Enter'],['Work Orders & Notes','Space']] as const) {
        const card=grid.getByRole('button',{name:new RegExp(`^${title}`)});
        if(activation==='pointer') {
          if(testInfo.project.name==='mobile-chromium')await card.tap();
          else await card.click();
        } else {
          await card.focus();await card.press(activation);
        }
        await expect(card).toHaveAttribute('aria-expanded','true');
        const panel=grid.locator('.machine-detail-accordion-panel[aria-hidden="false"]');
        await expect(panel).toHaveCount(1);
        expectedCalls++;
        await expect.poll(()=>page.evaluate(()=>(window as typeof window & {compactScrolls:unknown[]}).compactScrolls.length)).toBe(expectedCalls);
        const scroll=await page.evaluate(()=>(window as typeof window & {compactScrolls:Array<{top:number;left:number;behavior:string;panelTop:number}>}).compactScrolls.at(-1)!);
        expect(scroll.behavior).toBe(reducedMotion==='reduce'?'instant':'smooth');
        expect(scroll.left).toBe(0);
        // Short sections near the document's end are centered as far as native scroll limits permit.
        await expect.poll(()=>panel.evaluate(el=>{
          const bounds=el.getBoundingClientRect();
          const desired=window.scrollY+bounds.top+bounds.height/2-window.innerHeight/2;
          const clamped=Math.max(0,Math.min(desired,document.documentElement.scrollHeight-window.innerHeight));
          return Math.abs(window.scrollY-clamped);
        })).toBeLessThanOrEqual(2);
        expect(await panel.evaluate(el=>el.getBoundingClientRect().top+window.scrollY)).toBeCloseTo(scroll.panelTop,0);
        if(activation!=='pointer')await expect(card).toBeFocused();
        expect(await page.evaluate(()=>window.scrollX)).toBe(0);
        expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      }
      // Closing the active card does not schedule a second centering scroll.
      const notes=grid.getByRole('button',{name:/Work Orders & Notes/});
      await notes.click();await expect(notes).toHaveAttribute('aria-expanded','false');
      await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
      expect(await page.evaluate(()=>(window as typeof window & {compactScrolls:unknown[]}).compactScrolls.length)).toBe(expectedCalls);
    }
  });

  test(`${library} compact cards wrap and expand below the grid with keyboard focus`,async({page},testInfo)=>{
    const {grid}=await openAsset(page,library);
    const headers=grid.locator('.machine-detail-accordion-header');
    await expect(headers).toHaveCount(library==='machine'?5:6);
    const pm=grid.getByRole('button',{name:/Preventive Maintenance Tracking/});
    for(const text of ['12 schedules','1 due soon','2 overdue','Next 11/1/2026'])await expect(pm).toContainText(text);
    await expect(grid.getByRole('button',{name:/Asset Document Library/})).toContainText('1 folder');
    await expect(grid.getByRole('button',{name:/Asset Document Library/})).toContainText('0 documents');
    const notes=grid.getByRole('button',{name:/Work Orders & Notes/});
    for(const text of ['0 notes','1 resolved'])await expect(notes).toContainText(text);
    await expect(notes).not.toContainText('attachment');
    for(const width of [1440,820,390,320]) {
      await page.setViewportSize({width,height:900});
      const columns=await grid.evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length);
      expect(columns).toBe(width===1440?3:width===820?2:1);
      const boxes=await headers.evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {bottom:r.bottom,height:r.height,width:r.width};}));
      expect(boxes.every(box=>box.width>100&&box.height>=44)).toBeTruthy();
      const edit=grid.locator('[data-category-accent="basic"] .machine-detail-section-actions button');
      expect((await edit.boundingBox())!.width).toBeLessThan(boxes[0].width*.7);
      await notes.focus();await page.keyboard.press('Enter');
      await expect(notes).toHaveAttribute('aria-expanded','true');
      expect(await notes.evaluate(el=>getComputedStyle(el).outlineStyle)).toBe('solid');
      const panel=grid.locator('.machine-detail-accordion-panel[aria-hidden="false"]');
      await expect(panel).toHaveCount(1);
      const panelGap=await grid.evaluate(el=>{
        const cardsBottom=Math.max(...Array.from(el.querySelectorAll('.machine-detail-accordion-header')).map(header=>header.getBoundingClientRect().bottom));
        return el.querySelector('.machine-detail-accordion-panel[aria-hidden="false"]')!.getBoundingClientRect().top-cardsBottom;
      });
      expect(panelGap).toBeGreaterThanOrEqual(0);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      await grid.screenshot({path:testInfo.outputPath(`${library}-cards-${width}.png`)});
      await notes.press('Space');await expect(notes).toHaveAttribute('aria-expanded','false');
    }
    await page.emulateMedia({reducedMotion:'reduce'});
    await notes.click();
    expect(await grid.locator('.machine-detail-accordion-panel[aria-hidden="false"]').evaluate(el=>getComputedStyle(el).transitionDuration)).toBe('0s');
  });

  test(`${library} Edit pill preserves save, cancel and switching guards`,async({page})=>{
    const {grid,writes}=await openAsset(page,library);
    const basic=grid.locator('[data-category-accent="basic"]');
    const edit=basic.getByRole('button',{name:library==='machine'?'Edit':'Edit Mode',exact:true});
    await expect(edit).toBeVisible();
    expect(await edit.evaluate(el=>getComputedStyle(el).borderRadius)).toBe('999px');
    const field=library==='machine'?'Asset Name':'Equipment Name *';
    await edit.click();await basic.getByLabel(field,{exact:true}).fill('Cancelled draft');
    await grid.getByRole('button',{name:/Asset Document Library/}).click();
    await expect(basic.getByLabel(field,{exact:true})).toBeVisible();
    await basic.getByRole('button',{name:'Cancel',exact:true}).click();expect(writes()).toBe(0);
    await edit.click();await expect(basic.getByLabel(field,{exact:true})).toHaveValue(library==='machine'?'Compact Press':'Compact Dryer');
    await basic.getByLabel(field,{exact:true}).fill('Saved compact asset');
    await basic.getByRole('button',{name:'Save',exact:true}).click();
    await expect(basic.getByLabel(field,{exact:true})).toHaveCount(0);expect(writes()).toBe(1);
    await expect(basic).toContainText('Saved compact asset');
    await grid.getByRole('button',{name:/Work Orders & Notes/}).click();
    await grid.getByRole('button',{name:'Add Note',exact:true}).click();
    await grid.getByLabel('Note Title *',{exact:true}).fill('Unsaved note');
    page.once('dialog',async dialog=>{expect(dialog.message()).toContain('unsaved Asset Notes');await dialog.dismiss();});
    await grid.getByRole('button',{name:/Asset Document Library/}).click();
    await expect(grid.getByLabel('Note Title *',{exact:true})).toBeVisible();
    page.once('dialog',async dialog=>{await dialog.accept();});
    await grid.getByRole('button',{name:/Asset Document Library/}).click();
    await expect(grid.getByRole('button',{name:/Asset Document Library/})).toHaveAttribute('aria-expanded','true');
    await grid.getByRole('button',{name:/Work Orders & Notes/}).click();
    await expect(grid.getByLabel('Note Title *',{exact:true})).toHaveValue('Unsaved note');
  });

  test(`${library} read-only deep links preserve histories and permissions`,async({page})=>{
    const {grid,writes}=await openAsset(page,library,false,true);
    await expect(grid.getByRole('button',{name:/Work Orders & Notes/})).toHaveAttribute('aria-expanded','true');
    await expect(page.locator('.asset-note-history-modal')).toBeVisible();
    await page.locator('.asset-note-history-modal').getByRole('button',{name:'Close',exact:true}).click();
    await expect(grid.getByRole('button',{name:'Add Note',exact:true})).toHaveCount(0);
    await expect(grid.locator('.machine-detail-section-actions button')).toHaveCount(0);
    await grid.getByRole('button',{name:/Preventive Maintenance Tracking/}).click();
    await expect(grid.getByRole('button',{name:'All PM History',exact:true})).toBeVisible();
    await expect(grid.getByRole('button',{name:'Add Preventive Maintenance Tracking',exact:true})).toHaveCount(0);
    await grid.getByRole('button',{name:/Asset Document Library/}).click();
    await expect(grid.getByRole('button',{name:'Create Folder',exact:true})).toHaveCount(0);
    expect(writes()).toBe(0);
    if(library==='machine')await expect(page.getByRole('button',{name:'Download Spec PDF',exact:true})).toBeVisible();
    else await expect(page.getByRole('link',{name:'Equipment Specification PDF',exact:true})).toHaveAttribute('href',/specification\.pdf/);
  });
}
