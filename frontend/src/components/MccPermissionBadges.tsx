import { KeyboardEvent, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
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

function readableDate(value:string|null){
  if(!value)return 'No expiration';
  const date=new Date(value);
  return Number.isNaN(date.getTime())?value:date.toLocaleString();
}

export function MccPermissionBadgeGroup({grants,disabledAccount=false}:{grants:SpecialPermissionGrant[];disabledAccount?:boolean}){
  const grouped=useMemo(()=>Object.values(grants.reduce<Record<string,{module:string;label:string;shortLabel:string;grants:SpecialPermissionGrant[]}>>((result,grant)=>{
    const group=result[grant.module]??={module:grant.module,label:grant.moduleLabel,shortLabel:grant.moduleShortLabel,grants:[]};
    group.grants.push(grant);
    return result;
  },{})),[grants]);
  const [openModule,setOpenModule]=useState<string|null>(null);
  const [position,setPosition]=useState({left:0,top:0});
  const anchors=useRef(new Map<string,HTMLButtonElement>());
  const panelRef=useRef<HTMLDivElement>(null);
  const closeTimer=useRef<number>();
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
      let left=Math.min(Math.max(margin,rect.left),window.innerWidth-panelRect.width-margin);
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

  function keyDown(event:KeyboardEvent<HTMLButtonElement>,module:string){
    if(event.key==='Enter'||event.key===' '){event.preventDefault();setOpenModule(current=>current===module?null:module);}
    if(event.key==='Escape'){event.preventDefault();setOpenModule(null);}
  }

  if(!grouped.length)return <span className="permission-badge-empty">No special permissions</span>;
  return <>
    <div className="permission-badge-group" ref={groupRef}>
      {grouped.map(group=>{
        const id=`${popoverId}-${group.module}`;
        const expanded=openModule===group.module;
        return <button
          key={group.module}
          ref={element=>{if(element)anchors.current.set(group.module,element);else anchors.current.delete(group.module);}}
          className={`permission-module-badge permission-module-badge--${group.module}`}
          type="button"
          aria-label={`${group.label}: ${group.grants.length} active special permission${group.grants.length===1?'':'s'}${disabledAccount?' for disabled account':''}`}
          aria-expanded={expanded}
          aria-controls={id}
          onMouseEnter={()=>open(group.module)}
          onMouseLeave={closeSoon}
          onFocus={()=>open(group.module)}
          onClick={()=>setOpenModule(current=>current===group.module?null:group.module)}
          onKeyDown={event=>keyDown(event,group.module)}
        >{group.shortLabel} {group.grants.length}</button>;
      })}
      {disabledAccount&&<span className="permission-disabled-note">Disabled account</span>}
    </div>
    {openGroup&&createPortal(
      <div
        ref={panelRef}
        id={`${popoverId}-${openGroup.module}`}
        className="permission-details-popover"
        role="region"
        aria-label={`${openGroup.label} special permissions`}
        style={{left:position.left,top:position.top}}
        onMouseEnter={cancelClose}
        onMouseLeave={closeSoon}
        onKeyDown={event=>{if(event.key==='Escape'){setOpenModule(null);anchors.current.get(openGroup.module)?.focus();}}}
      >
        <strong>{openGroup.label} special permissions</strong>
        <ul>
          {openGroup.grants.map(grant=><li key={grant.id}>
            <span>{grant.label}</span>
            <small>Specially granted</small>
            <small>Granted by {grant.grantedBy} · {readableDate(grant.grantedAt)}</small>
            {grant.expiresAt&&<small>Expires {readableDate(grant.expiresAt)}</small>}
          </li>)}
        </ul>
      </div>,
      document.body,
    )}
  </>;
}
