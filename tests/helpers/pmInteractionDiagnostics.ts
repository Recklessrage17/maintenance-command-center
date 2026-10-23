import type { Page, TestInfo } from '@playwright/test';

// Observe the original native input path; never synthesize input or delay an action.
export async function observePmInteractions(page:Page,withGeometry:boolean) {
  await page.addInitScript(({withGeometry})=>{
    type Entry=Record<string,unknown>;
    const state=window as typeof window&{__pmInteractionDiagnostics?:Entry[]};
    const entries:Entry[]=[];state.__pmInteractionDiagnostics=entries;
    const describe=(node:EventTarget|null)=>{
      if(!(node instanceof Element))return node===document?'document':String(node);
      return {tag:node.tagName,id:node.id,class:node.getAttribute('class'),label:node.getAttribute('aria-label'),button:node.closest('button')?.getAttribute('aria-label')};
    };
    const record=(kind:string,data:Entry={})=>{
      if(entries.length<599)entries.push({time:performance.now(),kind,...data});
      else if(entries.length===599)entries.push({time:performance.now(),kind:'truncated'});
    };
    const geometry=()=>{
      const row=document.querySelector('[aria-label^="Open Drain Inspection"]');
      const body=row?.closest('.dashboard-accordion-body');
      const rect=(element:Element|null|undefined)=>{const r=element?.getBoundingClientRect();return r?{x:r.x,y:r.y,width:r.width,height:r.height}:null;};
      return {row:rect(row),body:rect(body),opacity:body?getComputedStyle(body).opacity:null,scrollX,scrollY,viewport:{width:innerWidth,height:innerHeight,scale:visualViewport?.scale,offsetTop:visualViewport?.offsetTop},expanded:row?.closest('article')?.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded')};
    };
    for(const type of ['pointerdown','pointerup','pointercancel','touchstart','touchend','touchcancel','mousedown','mouseup','click']) {
      document.addEventListener(type,event=>{
        const touch=(event as TouchEvent).changedTouches?.[0];
        const point=touch??event as MouseEvent;
        const isDrain=event.target instanceof Element&&event.target.closest('[aria-label^="Open Drain Inspection"]');
        const equipmentOpen=document.getElementById('dashboard-pm-group-equipment-301')?.getAttribute('aria-hidden')==='false';
        const hasPoint=Number.isFinite(point.clientX)&&Number.isFinite(point.clientY);
        record(type,{target:describe(event.target),path:event.composedPath().slice(0,5).map(describe),x:point.clientX,y:point.clientY,touchId:touch?.identifier,defaultPrevented:event.defaultPrevented,cancelable:event.cancelable,trusted:event.isTrusted,...((isDrain||equipmentOpen)&&withGeometry?{...geometry(),hit:hasPoint?describe(document.elementFromPoint(point.clientX,point.clientY)):null,stack:hasPoint?document.elementsFromPoint(point.clientX,point.clientY).slice(0,4).map(describe):[]}:{})});
      },{capture:true,passive:true});
    }
    // This phase runs after React's root listener, without wrapping application handlers.
    window.addEventListener('click',event=>{
      record('click-bubbled',{target:describe(event.target),defaultPrevented:event.defaultPrevented});
    },{passive:true});
    document.addEventListener('keydown',event=>record('keydown',{key:event.key,target:describe(event.target)}),{capture:true,passive:true});
    document.addEventListener('focusin',event=>record('focusin',{target:describe(event.target)}),{capture:true,passive:true});
    document.addEventListener('scrollend',()=>record('scrollend',withGeometry?geometry():{scrollX,scrollY}),{passive:true});
    for(const type of ['transitionrun','transitionend','transitioncancel'])document.addEventListener(type,event=>{
      if(event.target instanceof Element&&event.target.matches('#dashboard-pm-group-equipment-301'))record(type,{property:(event as TransitionEvent).propertyName,...(withGeometry?geometry():{})});
    },{capture:true,passive:true});
    const dialogs=(node:Node)=>node instanceof Element?[...(node.matches('[role="dialog"]')?[node]:[]),...node.querySelectorAll('[role="dialog"]')]:[];
    const modal=(element:Element)=>({label:element.getAttribute('aria-label'),labelledby:element.getAttribute('aria-labelledby'),labelText:(element.getAttribute('aria-labelledby')??'').split(/\s+/).filter(Boolean).map(id=>document.getElementById(id)?.textContent),heading:element.querySelector('h2')?.textContent,connected:element.isConnected,hidden:element.getAttribute('aria-hidden')});
    const observed=new WeakSet<Element>();
    const observeDialog=(element:Element)=>{
      if(observed.has(element))return;observed.add(element);
      new MutationObserver(changes=>{
        for(const change of changes)record('dialog-attribute',{target:describe(change.target),attribute:change.attributeName,...modal(element)});
      }).observe(element,{attributes:true,subtree:true,attributeFilter:['aria-hidden','aria-labelledby','aria-label','hidden','class','style']});
    };
    new MutationObserver(records=>{
      for(const mutation of records){
        for(const node of mutation.addedNodes)for(const element of dialogs(node)){record('dialog-added',modal(element));observeDialog(element);}
        for(const node of mutation.removedNodes)for(const element of dialogs(node))record('dialog-removed',modal(element));
      }
    }).observe(document,{childList:true,subtree:true});
    window.addEventListener('error',event=>record('page-error',{message:event.message}));
    window.addEventListener('unhandledrejection',event=>record('unhandled-rejection',{reason:String(event.reason)}));
  },{withGeometry});
}

export async function attachPmInteractions(page:Page,testInfo:TestInfo) {
  if(page.isClosed())return;
  const evidence=await page.evaluate(()=>({
    events:(window as typeof window&{__pmInteractionDiagnostics?:unknown[]}).__pmInteractionDiagnostics,
    finalDialogs:[...document.querySelectorAll('[role="dialog"]')].map(element=>({name:element.querySelector('h2')?.textContent,label:element.getAttribute('aria-label'),labelledby:element.getAttribute('aria-labelledby'),labelText:(element.getAttribute('aria-labelledby')??'').split(/\s+/).filter(Boolean).map(id=>document.getElementById(id)?.textContent),hidden:element.getAttribute('aria-hidden'),hiddenAncestor:element.closest('[hidden],[inert],[aria-hidden="true"]')?.tagName,display:getComputedStyle(element).display,visibility:getComputedStyle(element).visibility})),
  }));
  await testInfo.attach('pm-native-interactions.json',{body:JSON.stringify(evidence,null,2),contentType:'application/json'});
}
