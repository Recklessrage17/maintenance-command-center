import { type KeyboardEvent, type RefObject, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type SpecialPermissionGrant={
  id:number;
  permissionKey:string;
  label:string;
  module:string;
  moduleLabel:string;
  moduleShortLabel:string;
  grantedByUserId:number;
  grantedBy:string;
  grantedAt:string;
  expiresAt:string|null;
  reason:string|null;
};

export type MccPermissionModuleGroup={
  module:string;
  label:string;
  shortLabel:string;
  grants:SpecialPermissionGrant[];
};

function readableDate(value:string|null){
  if(!value)return 'No expiration';
  const date=new Date(value);
  return Number.isNaN(date.getTime())?value:date.toLocaleString();
}

export function MccPermissionBadge({group,expanded,popoverId,disabledAccount,onOpen,onCloseSoon,onPointerDown,onToggle,onKeyDown,anchorRef}:{
  group:MccPermissionModuleGroup;
  expanded:boolean;
  popoverId:string;
  disabledAccount:boolean;
  onOpen:()=>void;
  onCloseSoon:()=>void;
  onPointerDown:()=>void;
  onToggle:()=>void;
  onKeyDown:(event:KeyboardEvent<HTMLButtonElement>)=>void;
  anchorRef:(element:HTMLButtonElement|null)=>void;
}){
  return <button
    ref={anchorRef}
    className={`permission-module-badge permission-module-badge--${group.module}`}
    type="button"
    aria-label={`${group.label}: ${group.grants.length} active special permission${group.grants.length===1?'':'s'}${disabledAccount?' for disabled account':''}`}
    aria-expanded={expanded}
    aria-controls={popoverId}
    onMouseEnter={onOpen}
    onMouseLeave={onCloseSoon}
    onFocus={onOpen}
    onPointerDown={onPointerDown}
    onClick={onToggle}
    onKeyDown={onKeyDown}
  >{group.shortLabel} {group.grants.length}</button>;
}

export function MccPermissionDetailsPopover({group,id,position,panelRef,onMouseEnter,onMouseLeave,onEscape}:{
  group:MccPermissionModuleGroup;
  id:string;
  position:{left:number;top:number};
  panelRef:RefObject<HTMLDivElement>;
  onMouseEnter:()=>void;
  onMouseLeave:()=>void;
  onEscape:()=>void;
}){
  return <div
    ref={panelRef}
    id={id}
    className="permission-details-popover"
    role="region"
    aria-label={`${group.label} special permissions`}
    data-mcc-nested-popover
    style={{left:position.left,top:position.top}}
    onMouseEnter={onMouseEnter}
    onMouseLeave={onMouseLeave}
    onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();onEscape();}}}
  >
    <strong>{group.label} special permissions</strong>
    <ul>
      {group.grants.map(grant=><li key={grant.id}>
        <span>{grant.label}</span>
        <small>Specially granted</small>
        <small>Granted by {grant.grantedBy} · {readableDate(grant.grantedAt)}</small>
        {grant.expiresAt&&<small>Expires {readableDate(grant.expiresAt)}</small>}
      </li>)}
    </ul>
  </div>;
}

export function MccPermissionBadgeGroup({grants,disabledAccount=false}:{grants:SpecialPermissionGrant[];disabledAccount?:boolean}){
  const grouped=useMemo(()=>Object.values(grants.reduce<Record<string,MccPermissionModuleGroup>>((result,grant)=>{
    const group=result[grant.module]??={module:grant.module,label:grant.moduleLabel,shortLabel:grant.moduleShortLabel,grants:[]};
    group.grants.push(grant);
    return result;
  },{})),[grants]);
  const [openModule,setOpenModule]=useState<string|null>(null);
  const [position,setPosition]=useState({left:0,top:0});
  const anchors=useRef(new Map<string,HTMLButtonElement>());
  const panelRef=useRef<HTMLDivElement>(null);
  const closeTimer=useRef<number>();
  const pointerStartedOpen=useRef(false);
  const groupRef=useRef<HTMLDivElement>(null);
  const popoverId=useId().replace(/:/g,'');
  const openGroup=grouped.find(group=>group.module===openModule);

  const cancelClose=()=>{if(closeTimer.current)window.clearTimeout(closeTimer.current);};
  const closeSoon=()=>{cancelClose();closeTimer.current=window.setTimeout(()=>setOpenModule(null),140);};
  const open=(module:string)=>{cancelClose();setOpenModule(module);};

  useLayoutEffect(()=>{
    if(!openModule)return;
    const anchor=anchors.current.get(openModule);
    const panel=panelRef.current;
    if(!anchor||!panel)return;
    const update=()=>{
      const rect=anchor.getBoundingClientRect();
      const panelRect=panel.getBoundingClientRect();
      const margin=10;
      const left=Math.min(Math.max(margin,rect.left),window.innerWidth-panelRect.width-margin);
      let top=rect.bottom+8;
      if(top+panelRect.height>window.innerHeight-margin)top=Math.max(margin,rect.top-panelRect.height-8);
      setPosition({left,top});
    };
    update();
    window.addEventListener('resize',update);
    window.addEventListener('scroll',update,true);
    return()=>{window.removeEventListener('resize',update);window.removeEventListener('scroll',update,true);};
  },[openModule,openGroup?.grants.length]);

  useEffect(()=>{
    const outside=(event:PointerEvent)=>{
      const target=event.target as Node;
      if(groupRef.current?.contains(target)||panelRef.current?.contains(target))return;
      setOpenModule(null);
    };
    document.addEventListener('pointerdown',outside);
    return()=>{document.removeEventListener('pointerdown',outside);cancelClose();};
  },[]);
  useEffect(()=>{
    if(!openModule)return;
    const escape=(event:globalThis.KeyboardEvent)=>{
      if(event.key!=='Escape')return;
      event.preventDefault();
      event.stopPropagation();
      setOpenModule(null);
      window.requestAnimationFrame(()=>anchors.current.get(openModule)?.focus());
    };
    document.addEventListener('keydown',escape,true);
    return()=>document.removeEventListener('keydown',escape,true);
  },[openModule]);

  function keyDown(event:KeyboardEvent<HTMLButtonElement>,module:string){
    if(event.key==='Enter'||event.key===' '){event.preventDefault();setOpenModule(current=>current===module?null:module);}
    if(event.key==='Escape'&&openModule===module){event.preventDefault();event.stopPropagation();setOpenModule(null);}
  }

  if(!grouped.length)return <span className="permission-badge-empty">No special permissions</span>;
  return <>
    <div className="permission-badge-group" ref={groupRef}>
      {grouped.map(group=>{
        const id=`${popoverId}-${group.module}`;
        return <MccPermissionBadge
          key={group.module}
          group={group}
          expanded={openModule===group.module}
          popoverId={id}
          disabledAccount={disabledAccount}
          anchorRef={element=>{if(element)anchors.current.set(group.module,element);else anchors.current.delete(group.module);}}
          onOpen={()=>open(group.module)}
          onCloseSoon={closeSoon}
          onPointerDown={()=>{pointerStartedOpen.current=openModule===group.module;}}
          onToggle={()=>setOpenModule(pointerStartedOpen.current?null:group.module)}
          onKeyDown={event=>keyDown(event,group.module)}
        />;
      })}
      {disabledAccount&&<span className="permission-disabled-note">Disabled account</span>}
    </div>
    {openGroup&&createPortal(
      <MccPermissionDetailsPopover
        group={openGroup}
        id={`${popoverId}-${openGroup.module}`}
        position={position}
        panelRef={panelRef}
        onMouseEnter={cancelClose}
        onMouseLeave={closeSoon}
        onEscape={()=>{setOpenModule(null);anchors.current.get(openGroup.module)?.focus();}}
      />,
      document.body,
    )}
  </>;
}
