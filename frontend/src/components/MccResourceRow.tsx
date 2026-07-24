import { type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type MccOverflowMenuItem = {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
};

type ResourceRowProps = {
  icon: ReactNode;
  title: ReactNode;
  titleText?: string;
  metadata?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  trailingContent?: ReactNode;
  className?: string;
  onActivate?: () => void;
  activateLabel?: string;
  expanded?: boolean;
  controls?: string;
};

/*
 * MCC resource-row guardrail:
 * - expose no more than two visible primary actions; put remaining actions in More
 * - verify desktop, tablet, and 390px mobile layouts
 * - action groups wrap horizontally; vertical action towers are not acceptable
 */
export function MccResourceRow({icon,title,titleText,metadata,description,actions,trailingContent,className='',onActivate,activateLabel,expanded,controls}:ResourceRowProps) {
  const content=<><span className="mcc-resource-row__icon">{icon}</span><span className="mcc-resource-row__copy"><strong className="mcc-resource-row__title" title={titleText}>{title}</strong>{metadata&&<span className="mcc-resource-row__metadata">{metadata}</span>}{description&&<span className="mcc-resource-row__description">{description}</span>}</span>{trailingContent&&<span className="mcc-resource-row__trailing" aria-hidden="true">{trailingContent}</span>}</>;
  return <div className={`mcc-resource-row${onActivate?' is-activatable':''}${className?` ${className}`:''}`}>
    {onActivate?<button className="mcc-resource-row__content" type="button" onClick={onActivate} aria-label={activateLabel} aria-expanded={expanded} aria-controls={controls}>{content}</button>:<div className="mcc-resource-row__content">{content}</div>}
    {actions&&<div className="mcc-resource-row__actions">{actions}</div>}
  </div>;
}

export function MccActionGroup({children,className='',align='end'}:{children:ReactNode;className?:string;align?:'start'|'end'}) {
  return <div className={`mcc-action-group mcc-action-group--${align}${className?` ${className}`:''}`}>{children}</div>;
}

export function MccOverflowMenu({items,label='More',ariaLabel,className=''}:{items:MccOverflowMenuItem[];label?:string;ariaLabel?:string;className?:string}) {
  const [open,setOpen]=useState(false);
  const [panelStyle,setPanelStyle]=useState<CSSProperties>({visibility:'hidden'});
  const rootRef=useRef<HTMLDivElement>(null);
  const triggerRef=useRef<HTMLButtonElement>(null);
  const panelRef=useRef<HTMLDivElement>(null);
  const positionFrameRef=useRef<number|null>(null);
  const focusMenuOnOpenRef=useRef(false);

  const updatePosition=useCallback(()=>{
    const trigger=triggerRef.current;
    const panel=panelRef.current;
    if(!trigger||!panel)return;
    const margin=10;
    const gap=6;
    const viewportWidth=window.visualViewport?.width??window.innerWidth;
    const viewportHeight=window.visualViewport?.height??window.innerHeight;
    const viewportLeft=window.visualViewport?.offsetLeft??0;
    const viewportTop=window.visualViewport?.offsetTop??0;
    const rect=trigger.getBoundingClientRect();
    const panelWidth=Math.min(panel.scrollWidth,Math.max(170,viewportWidth-(margin*2)));
    const naturalHeight=Math.min(panel.scrollHeight,320);
    const below=viewportTop+viewportHeight-rect.bottom-gap-margin;
    const above=rect.top-viewportTop-gap-margin;
    const opensUp=nativeHeightExceeds(naturalHeight,below)&&above>below;
    const availableHeight=Math.max(72,opensUp?above:below);
    const renderedHeight=Math.min(naturalHeight,availableHeight);
    const defaultLeft=rect.right-panelWidth;
    const left=Math.min(
      viewportLeft+viewportWidth-margin-panelWidth,
      Math.max(viewportLeft+margin,defaultLeft),
    );
    const top=opensUp
      ? Math.max(viewportTop+margin,rect.top-gap-renderedHeight)
      : Math.min(viewportTop+viewportHeight-margin-renderedHeight,rect.bottom+gap);
    setPanelStyle({top,left,width:panelWidth,maxHeight:availableHeight,visibility:'visible'});
  },[]);

  function schedulePosition(){
    if(positionFrameRef.current!==null)cancelAnimationFrame(positionFrameRef.current);
    positionFrameRef.current=requestAnimationFrame(()=>{
      positionFrameRef.current=null;
      updatePosition();
    });
  }

  useEffect(()=>{
    if(!open)return;
    function onPointerDown(event:PointerEvent){
      const target=event.target as Node;
      if(rootRef.current?.contains(target)||panelRef.current?.contains(target))return;
      setOpen(false);
    }
    function onKeyDown(event:KeyboardEvent){if(event.key!=='Escape')return;setOpen(false);triggerRef.current?.focus();}
    function onViewportChange(){schedulePosition();}
    document.addEventListener('pointerdown',onPointerDown);
    document.addEventListener('keydown',onKeyDown);
    window.addEventListener('resize',onViewportChange);
    window.addEventListener('scroll',onViewportChange,true);
    window.visualViewport?.addEventListener('resize',onViewportChange);
    window.visualViewport?.addEventListener('scroll',onViewportChange);
    return()=>{
      document.removeEventListener('pointerdown',onPointerDown);
      document.removeEventListener('keydown',onKeyDown);
      window.removeEventListener('resize',onViewportChange);
      window.removeEventListener('scroll',onViewportChange,true);
      window.visualViewport?.removeEventListener('resize',onViewportChange);
      window.visualViewport?.removeEventListener('scroll',onViewportChange);
    };
  },[open,updatePosition]);

  useLayoutEffect(()=>{
    if(!open)return;
    setPanelStyle({visibility:'hidden'});
    updatePosition();
    if(focusMenuOnOpenRef.current){
      focusMenuOnOpenRef.current=false;
      panelRef.current?.querySelector<HTMLButtonElement>('.mcc-overflow-menu__item:not(:disabled)')?.focus();
    }
  },[open,items.length,updatePosition]);

  useEffect(()=>()=>{
    if(positionFrameRef.current!==null)cancelAnimationFrame(positionFrameRef.current);
  },[]);
  useEffect(()=>{if(!items.length)setOpen(false);},[items.length]);

  function handlePanelKeyDown(event:ReactKeyboardEvent<HTMLDivElement>){
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
    const buttons=[...event.currentTarget.querySelectorAll<HTMLButtonElement>('.mcc-overflow-menu__item:not(:disabled)')];
    if(!buttons.length)return;
    event.preventDefault();
    const current=buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:event.key==='ArrowDown'?(current+1+buttons.length)%buttons.length:(current-1+buttons.length)%buttons.length;
    buttons[next].focus();
  }

  if(!items.length)return null;
  return <div className={`mcc-overflow-menu${open?' is-open':''}${className?` ${className}`:''}`} ref={rootRef} onClick={event=>event.stopPropagation()} onPointerDown={event=>event.stopPropagation()}>
    <button ref={triggerRef} className="secondary-button compact-button glass-button glass-button--secondary mcc-overflow-menu__trigger" type="button" aria-haspopup="menu" aria-expanded={open} aria-label={ariaLabel??label} onKeyDown={event=>{if(['Enter',' ','ArrowDown'].includes(event.key))focusMenuOnOpenRef.current=true;if(event.key==='ArrowDown'&&!open){event.preventDefault();setOpen(true);}}} onClick={()=>setOpen(current=>!current)}>{label}<span aria-hidden="true">&#9662;</span></button>
    {open&&createPortal(<div ref={panelRef} className="mcc-overflow-menu__panel" role="menu" aria-label={ariaLabel??label} style={panelStyle} onKeyDown={handlePanelKeyDown} onClick={event=>event.stopPropagation()} onPointerDown={event=>event.stopPropagation()}>{items.map(item=><button className={`mcc-overflow-menu__item${item.danger?' is-danger':''}`} type="button" role="menuitem" disabled={item.disabled} key={item.label} onClick={()=>{setOpen(false);item.onSelect();}}>{item.label}</button>)}</div>,document.body)}
  </div>;
}

function nativeHeightExceeds(panelHeight:number,availableHeight:number){
  return panelHeight>Math.max(0,availableHeight);
}

export function MccResponsiveToolbar({children,className=''}:{children:ReactNode;className?:string}) {
  return <div className={`mcc-responsive-toolbar${className?` ${className}`:''}`}>{children}</div>;
}
