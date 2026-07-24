import { type CSSProperties, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type RequisitionPopoverLine = {
  id:number;
  partNumber:string;
  quantityRequested:number;
  description:string;
};

function quantity(value:number) {
  return Number.isInteger(value)?String(value):String(Math.round(value*100)/100);
}

export function RequisitionItemsPopover({lines,label}:{lines:RequisitionPopoverLine[];label:string}) {
  const [open,setOpen]=useState(false);
  const [panelStyle,setPanelStyle]=useState<CSSProperties>({visibility:'hidden'});
  const id=useId();
  const rootRef=useRef<HTMLSpanElement>(null);
  const triggerRef=useRef<HTMLButtonElement>(null);
  const panelRef=useRef<HTMLDivElement>(null);
  const closeTimerRef=useRef<number|null>(null);
  const frameRef=useRef<number|null>(null);
  const lastPointerTypeRef=useRef('');
  const ignoreTouchClickUntilRef=useRef(0);
  const lastTouchEndRef=useRef(0);

  const clearCloseTimer=useCallback(()=>{
    if(closeTimerRef.current===null)return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current=null;
  },[]);
  const scheduleClose=useCallback(()=>{
    clearCloseTimer();
    closeTimerRef.current=window.setTimeout(()=>{closeTimerRef.current=null;setOpen(false);},160);
  },[clearCloseTimer]);
  const updatePosition=useCallback(()=>{
    const trigger=triggerRef.current;
    const panel=panelRef.current;
    if(!trigger||!panel)return;
    const margin=10;
    const gap=7;
    const viewportWidth=window.visualViewport?.width??window.innerWidth;
    const viewportHeight=window.visualViewport?.height??window.innerHeight;
    const viewportLeft=window.visualViewport?.offsetLeft??0;
    const viewportTop=window.visualViewport?.offsetTop??0;
    const rect=trigger.getBoundingClientRect();
    const width=Math.min(panel.scrollWidth,viewportWidth-(margin*2));
    const naturalHeight=Math.min(panel.scrollHeight,360);
    const below=viewportTop+viewportHeight-rect.bottom-gap-margin;
    const above=rect.top-viewportTop-gap-margin;
    const opensUp=naturalHeight>Math.max(0,below)&&above>below;
    const availableHeight=Math.max(96,opensUp?above:below);
    const height=Math.min(naturalHeight,availableHeight);
    const left=Math.min(viewportLeft+viewportWidth-margin-width,Math.max(viewportLeft+margin,rect.left));
    const top=opensUp?Math.max(viewportTop+margin,rect.top-gap-height):Math.min(viewportTop+viewportHeight-margin-height,rect.bottom+gap);
    setPanelStyle({top,left,width,maxHeight:availableHeight,visibility:'visible'});
  },[]);
  const schedulePosition=useCallback(()=>{
    if(frameRef.current!==null)cancelAnimationFrame(frameRef.current);
    frameRef.current=requestAnimationFrame(()=>{frameRef.current=null;updatePosition();});
  },[updatePosition]);

  useLayoutEffect(()=>{
    if(!open)return;
    setPanelStyle({visibility:'hidden'});
    updatePosition();
  },[open,lines.length,updatePosition]);

  useEffect(()=>{
    if(!open)return;
    function outside(event:PointerEvent){
      const target=event.target as Node;
      if(rootRef.current?.contains(target)||panelRef.current?.contains(target))return;
      setOpen(false);
    }
    function escape(event:KeyboardEvent){
      if(event.key!=='Escape')return;
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener('pointerdown',outside);
    document.addEventListener('keydown',escape);
    window.addEventListener('resize',schedulePosition);
    window.addEventListener('scroll',schedulePosition,true);
    window.visualViewport?.addEventListener('resize',schedulePosition);
    window.visualViewport?.addEventListener('scroll',schedulePosition);
    return()=>{
      document.removeEventListener('pointerdown',outside);
      document.removeEventListener('keydown',escape);
      window.removeEventListener('resize',schedulePosition);
      window.removeEventListener('scroll',schedulePosition,true);
      window.visualViewport?.removeEventListener('resize',schedulePosition);
      window.visualViewport?.removeEventListener('scroll',schedulePosition);
    };
  },[open,schedulePosition]);

  useEffect(()=>()=>{clearCloseTimer();if(frameRef.current!==null)cancelAnimationFrame(frameRef.current);},[clearCloseTimer]);
  if(lines.length<2)return <>{label}</>;

  function pointerEnter(event:ReactPointerEvent){
    clearCloseTimer();
    if(event.pointerType==='mouse'){
      lastPointerTypeRef.current='mouse';
      setOpen(true);
    }
  }
  function pointerLeave(){
    if(lastPointerTypeRef.current==='mouse')scheduleClose();
  }
  function blurClose(){
    if(lastPointerTypeRef.current!=='touch')scheduleClose();
  }

  return <span className="requisition-items-popover" ref={rootRef} onPointerEnter={pointerEnter} onPointerLeave={pointerLeave} onFocus={clearCloseTimer} onBlur={blurClose} onClick={event=>event.stopPropagation()} onPointerDown={event=>event.stopPropagation()}>
    <button
      ref={triggerRef}
      className="requisition-items-popover__trigger"
      type="button"
      aria-expanded={open}
      aria-controls={id}
      aria-haspopup="dialog"
      onPointerDown={event=>{lastPointerTypeRef.current=event.pointerType;event.stopPropagation();}}
      onTouchEnd={event=>{event.stopPropagation();const timestamp=Date.now();if(timestamp-lastTouchEndRef.current<50)return;lastTouchEndRef.current=timestamp;lastPointerTypeRef.current='touch';ignoreTouchClickUntilRef.current=timestamp+700;setOpen(current=>!current);}}
      onClick={event=>{event.stopPropagation();if(lastPointerTypeRef.current==='touch'||Date.now()<ignoreTouchClickUntilRef.current)return;setOpen(true);}}
      onKeyDown={event=>{event.stopPropagation();if(event.key==='Enter'||event.key===' '){event.preventDefault();setOpen(current=>!current);}else if(event.key==='Escape'){setOpen(false);}}}
    >{label}</button>
    {open&&createPortal(<div
      className="requisition-items-popover__panel"
      id={id}
      ref={panelRef}
      role="dialog"
      aria-label={`${label} details`}
      style={panelStyle}
      onPointerEnter={clearCloseTimer}
      onPointerLeave={pointerLeave}
      onFocus={clearCloseTimer}
      onBlur={blurClose}
      onPointerDown={event=>event.stopPropagation()}
      onClick={event=>event.stopPropagation()}
    ><table><thead><tr><th>Part #</th><th>Qty</th><th>Description</th></tr></thead><tbody>{lines.map((line,index)=><tr key={line.id||`${line.partNumber}-${index}`}><td>{line.partNumber||'-'}</td><td>{quantity(line.quantityRequested)}</td><td>{line.description||'-'}</td></tr>)}</tbody></table></div>,document.body)}
  </span>;
}
