// Integration-only native maintenance-record print audit, derived from the
// reviewed requisition native viewer/print harness; never sends a paper job.
import {test,expect,chromium} from '@playwright/test';
import fs from 'node:fs';
import {backendFixture,owner,request,fixtureDirectory} from './helpers/security-process.mjs';

for(const library of ['machine','equipment'])test(`integrated ${library} native Chromium maintenance-record print preview`,async({},info)=>{
  test.setTimeout(150000);
  const runtime=await backendFixture('release-record-print');
  let context;
  try {
    const cookie=await owner(runtime.base);
    const post=async(url:string,body:unknown)=>{
      const result=await request(runtime.base,url,{method:'POST',cookie,body});
      expect(result.response.ok,JSON.stringify(result.data)).toBe(true);return result.data;
    };
    const asset=(await post(`/api/${library}-library/assets`,library==='machine'
      ?{assetNumber:'SYNTHETIC-NATIVE-PRESS',assetName:'Synthetic native print press',brand:'MCC',status:'active'}
      :{assetNumber:'SYNTHETIC-NATIVE-DRYER',equipmentName:'Synthetic native print dryer',category:'Dryer',status:'active'})).asset;
    const form=new FormData();
    for(const [key,value]of Object.entries({title:'Synthetic native print record',noteDate:'2026-01-15',body:'Synthetic maintenance verification only.',warning:'true',workOrder:'QA-NATIVE-PRINT'}))form.append(key,value);
    const created=(await post(`/api/${library}-library/assets/${asset.id}/notes`,form)).note;
    const note=(await post(`/api/${library}-library/asset-notes/${created.id}/resolve`,{resolutionSummary:'Repair verified at 650\u00b0F and returned to service.'})).note;
    context=await chromium.launchPersistentContext(fixtureDirectory('native-print-profile'),{channel:'chromium',headless:false,viewport:{width:1440,height:1000}});
    const separator=cookie.indexOf('=');
    await context.addCookies([{name:cookie.slice(0,separator),value:cookie.slice(separator+1),url:runtime.base,httpOnly:true,sameSite:'Lax'}]);
    const page=context.pages()[0];
    await page.goto(`${runtime.base}${note.pdfUrl}`);
    await page.waitForTimeout(1500); // Allow the native PDF plugin to paint.
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
    await waitForPreview();
    const screenshot=await send('Page.captureScreenshot',{format:'png'});
    fs.writeFileSync(info.outputPath('native-print-preview.png'),Buffer.from(screenshot.data,'base64'));
    await info.attach('native print preview',{path:info.outputPath('native-print-preview.png'),contentType:'image/png'});
    const initialTicket=await send('Runtime.evaluate',{returnByValue:true,expression:"document.querySelector('print-preview-app').shadowRoot.querySelector('print-preview-preview-area').getLastTicketForTest().requestID"});
    const grayscale=await send('Runtime.evaluate',{returnByValue:true,expression:`(()=>{
      const roots=[document];
      for(let i=0;i<roots.length;i++){
        for(const element of roots[i].querySelectorAll('*'))if(element.shadowRoot)roots.push(element.shadowRoot);
        for(const select of roots[i].querySelectorAll('select')){
          const option=[...select.options].find(option=>/black|gray/i.test(option.textContent));
          if(option){select.value=option.value;select.dispatchEvent(new Event('change',{bubbles:true,composed:true}));return true;}
        }
      }
      return false;
    })()`});
    expect(grayscale.result.value).toBe(true);
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
  } finally {if(context)await context.close();await runtime.close();}
});
