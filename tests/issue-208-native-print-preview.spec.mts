import {test,expect,chromium} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {backendFixture,owner,request,root,fixtureDirectory} from './helpers/security-process.mjs';

const scenarios=[
  {name:'blank',taxExempt:'Yes',notes:''},
  {name:'short',taxExempt:'No',notes:'Synthetic comment: inspect before service.'},
  {name:'multiline',taxExempt:'No',notes:'Synthetic comment one: inspect the replacement assembly before service.\nSynthetic comment two: verify fit and operation.'},
  {name:'long',taxExempt:'Yes',notes:Array.from({length:39},(_,i)=>`Synthetic comment line ${String(i+1).padStart(2,'0')}: verify safe operation.`).join('\n')},
];
for(const kind of ['under','over'])for(const scenario of scenarios)test(`Patch 1 ${kind} ${scenario.name} native Chromium PDF and print preview`,async({},info)=>{
  const {taxExempt,notes}=scenario;
  test.setTimeout(150000);
  const runtime=await backendFixture('p1-print');
  let context;
  try {
    fs.cpSync(path.join(root,'backend/templates'),path.join(runtime.appRoot,'backend/templates'),{recursive:true});
    const cookie=await owner(runtime.base);
    const part=await request(runtime.base,'/api/inventory/native/parts',{method:'POST',cookie,body:{partNumber:'PRINT-QA',description:'Synthetic native print preview',location:'QA',vendor:'Synthetic Vendor',quantity:1,minQuantity:2,unitCost:kind==='under'?5:125}});
    expect(part.response.status).toBe(201);
    const created=await request(runtime.base,'/api/requisitions',{method:'POST',cookie,body:{poInitiator:'Local Security Owner',requisitionedByName:'Local Security Owner',taxExempt,notes,items:[{inventoryPartId:Number(part.data.part.id),quantityRequested:1}]}});
    expect(created.response.status).toBe(201);
    // The managed run's long TMPDIR exceeds Linux's Unix socket path limit
    // for Chromium's org.chromium.Chromium.*/SingletonSocket. Only Chromium's
    // child process uses GitHub's short, job-owned temporary directory; the
    // persistent browser profile stays in the managed fixture for safe cleanup.
    const useShortTemp = process.platform === 'linux' && process.env.GITHUB_ACTIONS === 'true';
    const runnerTemp = useShortTemp ? process.env.RUNNER_TEMP : undefined;
    if(useShortTemp && (!runnerTemp || !path.isAbsolute(runnerTemp) ||
        fs.realpathSync(runnerTemp) !== path.resolve(runnerTemp) ||
        Buffer.byteLength(path.join(runnerTemp,'org.chromium.Chromium.XXXXXX','SingletonSocket')) >= 108)){
      throw new Error('GitHub runner temporary directory is unsuitable for Chromium singleton socket.');
    }
    context=await chromium.launchPersistentContext(fixtureDirectory('native-print-profile'),{
      channel:'chromium',headless:false,viewport:{width:1440,height:1000},
      ...(runnerTemp ? {env:{...process.env,TMPDIR:runnerTemp}} : {}),
    });
    const separator=cookie.indexOf('=');
    await context.addCookies([{name:cookie.slice(0,separator),value:cookie.slice(separator+1),url:runtime.base,httpOnly:true,sameSite:'Lax'}]);
    const page=context.pages()[0];
    const pdfResponse=await page.goto(`${runtime.base}/api/requisitions/${created.data.requisition.id}/pdf?preview=true`);
    expect(pdfResponse?.status()).toBe(200);
    expect(pdfResponse?.headers()['content-type']).toMatch(/^application\/pdf\b/);
    // Chromium loads the PDF in its built-in extension (a separate frame).
    // Navigation 'load' alone is not proof the PDF plugin finished rendering.
    // Wait for the viewer's real document-load state, not a fixed sleep.
    await expect.poll(async()=>{
      const frame=page.frames().find(f=>f.url().startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html'));
      if(!frame)return false;
      return frame.evaluate(()=>{
        const viewer=document.querySelector('pdf-viewer') as any;
        return viewer?.getLoadSucceededForTesting?.()===true;
      }).catch(()=>false);
    },{timeout:15000,message:'Native Chromium PDF viewer must finish loading its document'}).toBe(true);
    const pdfViewerFrame=page.frames().find(f=>f.url().startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html'))!;
    // Let the loaded document complete two composited frames before capture.
    await pdfViewerFrame.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
    await page.screenshot({path:info.outputPath('native-pdf-viewer.png')});
    await page.evaluate(()=>{setTimeout(()=>window.print(),0);});
    const cdp=await context.newCDPSession(page);
    let targets:any[]=[];
    await expect.poll(async()=>{
      targets=(await cdp.send('Target.getTargets')).targetInfos;
      return targets.some(t=>t.url.startsWith('chrome://print'));
    },{timeout:15000}).toBe(true);
    fs.writeFileSync(info.outputPath('print-targets.json'),JSON.stringify(targets.map(t=>({type:t.type,url:t.url,title:t.title})),null,2));
    // Chromium's privileged print dialog is a separate target that Playwright
    // does not expose as a normal page. Capture that exact owned target.
    const target=targets.find(t=>t.url.startsWith('chrome://print'))!;
    const {sessionId}=await cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:false});
    let messageId=0;
    const send=async(method:string,params:Record<string,unknown>={})=>{
      const id=++messageId;
      const reply=new Promise<any>((resolve,reject)=>{
        const listener=(event:any)=>{if(event.sessionId!==sessionId)return;const message=JSON.parse(event.message);if(message.id!==id)return;cdp.off('Target.receivedMessageFromTarget',listener);message.error?reject(new Error(JSON.stringify(message.error))):resolve(message.result);};
        cdp.on('Target.receivedMessageFromTarget',listener);
      });
      await cdp.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id,method,params})});return reply;
    };
    await send('Page.enable');
    await expect.poll(async()=>{
      const result=await send('Runtime.evaluate',{expression:"document.readyState==='complete' && Boolean(document.querySelector('print-preview-app'))",returnByValue:true});
      return result.result.value;
    },{timeout:10000}).toBe(true);
    // The dialog shell can be ready while the compositor still says "Loading
    // preview". Wait for Chromium's actual loaded preview before capturing.
    // See chrome/browser/resources/print_preview/ui/preview_area.ts.
    const waitForPreview=async()=>{
      await expect.poll(async()=>{
        const result=await send('Runtime.evaluate',{returnByValue:true,expression:
          "document.querySelector('print-preview-app')?.shadowRoot?.querySelector('print-preview-preview-area')?.previewState"});
        return result.result.value;
      },{timeout:20000}).toBe('display-preview');
      await send('Runtime.evaluate',{awaitPromise:true,expression:
        'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'});
    };
    // The stock "Save as PDF" destination has no visible Color setting for
    // an existing PDF. In GitHub CI use the real color-capable CUPS test queue.
    const ciPrintDestination=process.env.CI_PRINT_TEST_PRINTER;
    if(ciPrintDestination){
      await send('Runtime.evaluate',{expression:`(()=>{
        const settings=document.querySelector('print-preview-app')?.shadowRoot?.querySelector('print-preview-destination-settings');
        settings?.getDestinationStoreForTest?.()?.startLoadAllDestinations();
      })()`});
      await expect.poll(async()=>{
        const result=await send('Runtime.evaluate',{returnByValue:true,expression:`(()=>{
          const settings=document.querySelector('print-preview-app')?.shadowRoot?.querySelector('print-preview-destination-settings');
          const store=settings?.getDestinationStoreForTest?.();
          return Boolean(store?.destinations().some(d=>d.id===${JSON.stringify(ciPrintDestination)}));
        })()`});
        return result.result.value;
      },{timeout:15000,message:'CI color-capable CUPS printer must be discovered by native Chromium'}).toBe(true);
      const selected=await send('Runtime.evaluate',{returnByValue:true,expression:`(()=>{
        const settings=document.querySelector('print-preview-app').shadowRoot.querySelector('print-preview-destination-settings');
        const store=settings.getDestinationStoreForTest();
        const destination=store.destinations().find(d=>d.id===${JSON.stringify(ciPrintDestination)});
        store.selectDestination(destination);
        return store.selectedDestination.id;
      })()`});
      expect(selected.result.value).toBe(ciPrintDestination);
      await expect.poll(async()=>{
        const result=await send('Runtime.evaluate',{returnByValue:true,expression:
          "document.querySelector('print-preview-app').shadowRoot.querySelector('print-preview-preview-area').getLastTicketForTest()?.deviceName"});
        return result.result.value;
      },{timeout:15000}).toBe(ciPrintDestination);
    }
    await waitForPreview();
    const pageSettings=await send('Runtime.evaluate',{returnByValue:true,expression:`(()=>{
      const roots=[document];
      for(let i=0;i<roots.length;i++)for(const element of roots[i].querySelectorAll('*'))if(element.shadowRoot)roots.push(element.shadowRoot);
      const settings=roots.flatMap(root=>[...root.querySelectorAll('print-preview-pages-settings')])[0];
      return {settings:settings?.shadowRoot?.innerHTML,ticket:document.querySelector('print-preview-app').shadowRoot.querySelector('print-preview-preview-area').getLastTicketForTest()};
    })()`});
    fs.writeFileSync(info.outputPath('native-page-settings.json'),JSON.stringify(pageSettings.result.value,null,2));
    const screenshot=await send('Page.captureScreenshot',{format:'png'});
    fs.writeFileSync(info.outputPath('native-print-preview.png'),Buffer.from(screenshot.data,'base64'));
    await info.attach('native print preview',{path:info.outputPath('native-print-preview.png'),contentType:'image/png'});
    const initialTicket=await send('Runtime.evaluate',{returnByValue:true,expression:"document.querySelector('print-preview-app').shadowRoot.querySelector('print-preview-preview-area').getLastTicketForTest().requestID"});
    // Change the *visible* Color select for the selected physical-capability
    // destination. Searching all hidden select tags can change a dormant
    // template, which never fires the real Chromium preview update.
    const selectPrintColor=async(color:boolean)=>{
      const result=await send('Runtime.evaluate',{returnByValue:true,expression:`(()=>{
        const roots=[document];
        for(let i=0;i<roots.length;i++)
          for(const element of roots[i].querySelectorAll('*'))if(element.shadowRoot)roots.push(element.shadowRoot);
        const widget=roots.flatMap(root=>[...root.querySelectorAll('print-preview-color-settings')])[0];
        const select=widget?.shadowRoot?.querySelector('select');
        const option=select&&[...select.options].find(option=>
          ${color?'/^color$/i':'/black|gray/i'}.test(option.textContent.trim()));
        if(!select||!option||!select.getClientRects().length)
          return {changed:false,reason:'Color/Black and white must be a visible available printer setting'};
        if(select.value===option.value)
          return {changed:false,reason:'Requested printer color mode is already selected'};
        select.value=option.value;
        select.dispatchEvent(new Event('change',{bubbles:true,composed:true}));
        return {changed:true,selected:option.textContent.trim()};
      })()`});
      expect(result.result.value).toMatchObject({changed:true});
    };
    await selectPrintColor(false);
    // Settings can debounce a new ticket. The old loaded preview must not be
    // captured as grayscale before Chromium requests its replacement.
    await expect.poll(async()=>{
      const ticket=await send('Runtime.evaluate',{returnByValue:true,expression:
        "document.querySelector('print-preview-app').shadowRoot.querySelector('print-preview-preview-area').getLastTicketForTest().requestID"});
      return ticket.result.value;
    },{timeout:20000}).toBeGreaterThan(initialTicket.result.value);
    await waitForPreview();
    const mono=await send('Page.captureScreenshot',{format:'png'});
    fs.writeFileSync(info.outputPath('native-print-preview-grayscale.png'),Buffer.from(mono.data,'base64'));
    await info.attach('grayscale print preview',{path:info.outputPath('native-print-preview-grayscale.png'),contentType:'image/png'});
    if(scenario.name==='long'){
      const ticket=async()=>{
        const result=await send('Runtime.evaluate',{returnByValue:true,expression:"document.querySelector('print-preview-app').shadowRoot.querySelector('print-preview-preview-area').getLastTicketForTest()"});
        return result.result.value;
      };
      const advance=async(previous:number)=>{
        await expect.poll(async()=>(await ticket()).requestID,{timeout:20000}).toBeGreaterThan(previous);
        await waitForPreview();
      };
      const setColor=async(color:boolean)=>{
        const previous=(await ticket()).requestID;
        await selectPrintColor(color);
        await advance(previous);
      };
      for(const pageNumber of [2,3]){
        const previous=(await ticket()).requestID;
        // Use Chromium's observed Custom page-range controls. Selecting just
        // one appendix page makes that exact page visible in native preview.
        await send('Runtime.evaluate',{expression:`(()=>{
          const roots=[document];
          for(let i=0;i<roots.length;i++)for(const element of roots[i].querySelectorAll('*'))if(element.shadowRoot)roots.push(element.shadowRoot);
          const settings=roots.flatMap(root=>[...root.querySelectorAll('print-preview-pages-settings')])[0];
          const select=settings.shadowRoot.querySelector('select');select.value='3';select.dispatchEvent(new Event('change',{bubbles:true,composed:true}));
        })()`});
        const changed=await send('Runtime.evaluate',{returnByValue:true,expression:`(()=>{
          const roots=[document];
          for(let i=0;i<roots.length;i++)for(const element of roots[i].querySelectorAll('*'))if(element.shadowRoot)roots.push(element.shadowRoot);
          const input=roots.flatMap(root=>[...root.querySelectorAll('cr-input#pageSettingsCustomInput')])[0].shadowRoot.querySelector('input');
          input.value='${pageNumber}';input.dispatchEvent(new Event('input',{bubbles:true,composed:true}));return input.value;
        })()`});
        expect(changed.result.value).toBe(String(pageNumber));
        await expect.poll(async()=>(await ticket()).pageRange,{timeout:20000}).toEqual([{from:pageNumber,to:pageNumber}]);
        await advance(previous);
        for(const color of [true,false]){
          await setColor(color);
          const image=await send('Page.captureScreenshot',{format:'png'});
          const name=`native-continuation-${pageNumber}-${color?'color':'grayscale'}.png`;
          fs.writeFileSync(info.outputPath(name),Buffer.from(image.data,'base64'));
          fs.writeFileSync(info.outputPath(name+'.ticket.json'),JSON.stringify(await ticket(),null,2));
          await info.attach(name,{path:info.outputPath(name),contentType:'image/png'});
        }
      }
    }
  } finally {if(context)await context.close();await runtime.close();}
});
