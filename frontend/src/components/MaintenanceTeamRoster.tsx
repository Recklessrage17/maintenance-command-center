import { type CSSProperties, type KeyboardEvent, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MccPermissionBadgeGroup, type SpecialPermissionGrant } from './MccPermissionBadges';
import { RoleBadge } from './RoleBadge';

type PresenceState='Online'|'Away'|'Offline';
type RankProvenance={
  currentRank:string;
  assignedBy:string|null;
  assignedAt:string|null;
  previousRank:string|null;
  reason:string|null;
  assignmentSourceAvailable:boolean;
  source:'role_assignment_history'|'system_bootstrap'|'unavailable';
};
type TeamUser={
  id:number;
  fullName:string;
  role:string;
  isOwnerAdmin:boolean;
  disabled:boolean;
  isCurrentUser:boolean;
  presence:PresenceState;
  lastSeenAt:string|null;
  rankProvenance:RankProvenance;
  specialPermissionGrants:SpecialPermissionGrant[];
};
type PresencePolicy={
  heartbeatIntervalMs:number;
  rosterRefreshIntervalMs:number;
  onlineThresholdMs:number;
  awayAfterMs:number;
  writeThrottleMs:number;
};
type TeamResponse={
  serverTime:string;
  policy:PresencePolicy;
  totalUsers:number;
  activeUsers:number;
  onlineCount:number;
  awayCount:number;
  offlineCount:number;
  disabledCount:number;
  users:TeamUser[];
};

const fallbackPolicy:PresencePolicy={heartbeatIntervalMs:45_000,rosterRefreshIntervalMs:25_000,onlineThresholdMs:120_000,awayAfterMs:600_000,writeThrottleMs:25_000};

async function jsonRequest(path:string,options:RequestInit={}){
  const response=await fetch(path,{credentials:'include',headers:{'Content-Type':'application/json',...(options.headers??{})},...options});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||'Maintenance Team is unavailable.');
  return data;
}

function initials(name:string){
  const parts=name.trim().split(/\s+/).filter(Boolean);
  return (parts.length>1?`${parts[0][0]}${parts.at(-1)?.[0]??''}`:parts[0]?.slice(0,2)??'?').toUpperCase();
}

function readableDate(value:string|null){
  if(!value)return '';
  const date=new Date(value);
  return Number.isNaN(date.getTime())?value:date.toLocaleDateString(undefined,{month:'long',day:'numeric',year:'numeric'});
}

function relativeLastSeen(value:string|null,serverTime:string){
  if(!value)return 'Last seen unavailable';
  const elapsed=Math.max(0,Date.parse(serverTime)-Date.parse(value));
  if(!Number.isFinite(elapsed))return 'Last seen unavailable';
  if(elapsed<60_000)return 'Last seen just now';
  const minutes=Math.floor(elapsed/60_000);
  if(minutes<60)return `Last seen ${minutes}m ago`;
  const hours=Math.floor(minutes/60);
  if(hours<24)return `Last seen ${hours}h ago`;
  const days=Math.floor(hours/24);
  return `Last seen ${days}d ago`;
}

function TeamsIcon(){
  return <svg className="teams-control-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M8.5 11a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5ZM3 19a5.5 5.5 0 0 1 11 0M16.2 10.2a2.5 2.5 0 1 0 0-4.9M15.2 14.1a4.8 4.8 0 0 1 5.8 4.7" />
  </svg>;
}

function rankPopoverPosition(anchor:HTMLElement,panel:HTMLElement){
  const anchorRect=anchor.getBoundingClientRect();
  const panelRect=panel.getBoundingClientRect();
  const margin=10;
  let left=Math.min(Math.max(margin,anchorRect.left),window.innerWidth-panelRect.width-margin);
  let top=anchorRect.bottom+8;
  if(top+panelRect.height>window.innerHeight-margin)top=Math.max(margin,anchorRect.top-panelRect.height-8);
  return {left,top};
}

function MccRankBadge({user}:{user:TeamUser}){
  const [open,setOpen]=useState(false);
  const [position,setPosition]=useState({left:0,top:0});
  const triggerRef=useRef<HTMLButtonElement>(null);
  const panelRef=useRef<HTMLDivElement>(null);
  const closeTimer=useRef<number>();
  const pointerStartedOpen=useRef(false);
  const popoverId=`rank-${useId().replace(/:/g,'')}`;
  const cancelClose=()=>{if(closeTimer.current)window.clearTimeout(closeTimer.current);};
  const closeSoon=()=>{cancelClose();closeTimer.current=window.setTimeout(()=>setOpen(false),140);};

  useLayoutEffect(()=>{
    if(!open||!triggerRef.current||!panelRef.current)return;
    const update=()=>{if(triggerRef.current&&panelRef.current)setPosition(rankPopoverPosition(triggerRef.current,panelRef.current));};
    update();
    window.addEventListener('resize',update);
    window.addEventListener('scroll',update,true);
    return()=>{window.removeEventListener('resize',update);window.removeEventListener('scroll',update,true);};
  },[open]);

  useEffect(()=>{
    if(!open)return;
    const outside=(event:PointerEvent)=>{
      const target=event.target as Node;
      if(triggerRef.current?.contains(target)||panelRef.current?.contains(target))return;
      setOpen(false);
    };
    const escape=(event:globalThis.KeyboardEvent)=>{
      if(event.key!=='Escape')return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      window.requestAnimationFrame(()=>triggerRef.current?.focus());
    };
    document.addEventListener('pointerdown',outside);
    document.addEventListener('keydown',escape,true);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape,true);};
  },[open]);

  function onKeyDown(event:KeyboardEvent<HTMLButtonElement>){
    if(event.key==='Enter'||event.key===' '){event.preventDefault();setOpen(current=>!current);}
    if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();setOpen(false);}
  }

  const provenance=user.rankProvenance;
  return <>
    <button
      ref={triggerRef}
      className="team-rank-trigger"
      type="button"
      aria-label={`Rank details for ${user.fullName}: ${provenance.currentRank}`}
      aria-expanded={open}
      aria-controls={popoverId}
      onMouseEnter={()=>{cancelClose();setOpen(true);}}
      onMouseLeave={closeSoon}
      onFocus={()=>setOpen(true)}
      onPointerDown={()=>{pointerStartedOpen.current=open;}}
      onClick={()=>setOpen(!pointerStartedOpen.current)}
      onKeyDown={onKeyDown}
    ><RoleBadge role={user.role} isOwnerAdmin={user.isOwnerAdmin} compact /></button>
    {open&&createPortal(
      <div
        ref={panelRef}
        id={popoverId}
        className="team-rank-popover"
        role="region"
        aria-label={`Rank provenance for ${user.fullName}`}
        data-mcc-nested-popover
        style={position}
        onMouseEnter={cancelClose}
        onMouseLeave={closeSoon}
        onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();setOpen(false);triggerRef.current?.focus();}}}
      >
        <strong>{provenance.currentRank}</strong>
        {provenance.assignmentSourceAvailable?<small>Assigned by: {provenance.assignedBy}</small>:<small>Assignment source unavailable</small>}
        {provenance.assignedAt&&<small>Assigned: {readableDate(provenance.assignedAt)}</small>}
        {provenance.previousRank&&<small>Previous rank: {provenance.previousRank}</small>}
        {provenance.reason&&<small>Reason: {provenance.reason}</small>}
      </div>,
      document.body,
    )}
  </>;
}

function TeamRow({user,serverTime}:{user:TeamUser;serverTime:string}){
  return <article className={`maintenance-team-row presence-${user.presence.toLowerCase()}${user.disabled?' is-disabled':''}`} aria-label={`${user.fullName}, ${user.disabled?'Disabled':user.presence}`}>
    <div className="team-avatar" aria-hidden="true">
      <span>{initials(user.fullName)}</span>
      <i className={`presence-dot presence-${user.disabled?'offline':user.presence.toLowerCase()}`} />
    </div>
    <div className="team-user-copy">
      <div className="team-user-heading">
        <strong>{user.fullName}</strong>
        {user.isCurrentUser&&<span className="team-you-token">You</span>}
      </div>
      <span className={`team-presence-label presence-${user.disabled?'offline':user.presence.toLowerCase()}`}>{user.disabled?'Disabled':user.presence}</span>
      {!user.disabled&&user.presence!=='Online'&&<small>{relativeLastSeen(user.lastSeenAt,serverTime)}</small>}
      <div className="team-user-badges">
        <MccRankBadge user={user} />
        {user.specialPermissionGrants.length>0&&<MccPermissionBadgeGroup grants={user.specialPermissionGrants} disabledAccount={user.disabled} />}
      </div>
    </div>
  </article>;
}

function TeamSection({state,users,serverTime}:{state:PresenceState;users:TeamUser[];serverTime:string}){
  if(!users.length)return null;
  return <section className="maintenance-team-section" aria-labelledby={`team-section-${state.toLowerCase()}`}>
    <div className="maintenance-team-section-heading">
      <span id={`team-section-${state.toLowerCase()}`}>{state}</span>
      <strong>{users.length}</strong>
    </div>
    <div className="maintenance-team-rows">{users.map(user=><TeamRow key={user.id} user={user} serverTime={serverTime} />)}</div>
  </section>;
}

export function MaintenanceTeamControl({onOpenChange}:{onOpenChange?:(open:boolean)=>void}){
  const [data,setData]=useState<TeamResponse|null>(null);
  const [open,setOpen]=useState(false);
  const [error,setError]=useState('');
  const [panelStyle,setPanelStyle]=useState<CSSProperties>({left:10,top:10});
  const [mobile,setMobile]=useState(false);
  const triggerRef=useRef<HTMLButtonElement>(null);
  const panelRef=useRef<HTMLDivElement>(null);
  const activitySinceHeartbeat=useRef(true);
  const lastActivityCapture=useRef(0);

  const fetchTeam=useCallback(async()=>{
    try{
      const roster=await jsonRequest('/api/presence/team') as TeamResponse;
      if(!roster||!Array.isArray(roster.users))return;
      setData(roster);
      setError('');
    }catch(nextError){setError((nextError as Error).message);}
  },[]);
  const sendHeartbeat=useCallback(async(forceActivity=false)=>{
    const active=forceActivity||activitySinceHeartbeat.current;
    try{
      await jsonRequest('/api/presence/heartbeat',{method:'POST',body:JSON.stringify({active})});
      activitySinceHeartbeat.current=false;
    }catch{}
  },[]);

  useEffect(()=>{
    const captureActivity=()=>{
      const timestamp=Date.now();
      if(timestamp-lastActivityCapture.current<15_000)return;
      lastActivityCapture.current=timestamp;
      activitySinceHeartbeat.current=true;
    };
    const activityEvents=['pointerdown','keydown','touchstart','wheel'] as const;
    activityEvents.forEach(eventName=>window.addEventListener(eventName,captureActivity,{passive:true}));
    const visible=()=>{if(document.visibilityState==='visible'){captureActivity();void sendHeartbeat(true).then(fetchTeam);}};
    document.addEventListener('visibilitychange',visible);
    void sendHeartbeat(true).then(fetchTeam);
    const heartbeatTimer=window.setInterval(()=>void sendHeartbeat(),data?.policy.heartbeatIntervalMs??fallbackPolicy.heartbeatIntervalMs);
    const rosterTimer=window.setInterval(()=>void fetchTeam(),data?.policy.rosterRefreshIntervalMs??fallbackPolicy.rosterRefreshIntervalMs);
    return()=>{
      activityEvents.forEach(eventName=>window.removeEventListener(eventName,captureActivity));
      document.removeEventListener('visibilitychange',visible);
      window.clearInterval(heartbeatTimer);
      window.clearInterval(rosterTimer);
    };
  },[data?.policy.heartbeatIntervalMs,data?.policy.rosterRefreshIntervalMs,fetchTeam,sendHeartbeat]);

  const close=useCallback((restoreFocus=true)=>{
    setOpen(false);
    onOpenChange?.(false);
    if(restoreFocus)window.requestAnimationFrame(()=>triggerRef.current?.focus());
  },[onOpenChange]);

  const updatePosition=useCallback(()=>{
    const trigger=triggerRef.current;
    const panel=panelRef.current;
    if(!trigger)return;
    const isMobile=window.innerWidth<=600;
    setMobile(isMobile);
    if(isMobile){
      setPanelStyle({});
      return;
    }
    const triggerRect=trigger.getBoundingClientRect();
    const panelWidth=Math.min(410,window.innerWidth-20);
    const panelHeight=panel?.getBoundingClientRect().height??Math.min(680,window.innerHeight-20);
    const margin=10;
    const left=Math.min(Math.max(margin,triggerRect.right-panelWidth),window.innerWidth-panelWidth-margin);
    let top=triggerRect.bottom+10;
    if(top+panelHeight>window.innerHeight-margin)top=Math.max(margin,triggerRect.top-panelHeight-10);
    setPanelStyle({left,top,width:panelWidth});
  },[]);

  useLayoutEffect(()=>{
    if(!open)return;
    updatePosition();
    window.addEventListener('resize',updatePosition);
    window.addEventListener('scroll',updatePosition,true);
    window.requestAnimationFrame(()=>panelRef.current?.querySelector<HTMLButtonElement>('.maintenance-team-close')?.focus());
    return()=>{window.removeEventListener('resize',updatePosition);window.removeEventListener('scroll',updatePosition,true);};
  },[open,updatePosition,data?.users.length]);

  useEffect(()=>{
    if(!open)return;
    const onPointerDown=(event:PointerEvent)=>{
      const target=event.target as Node;
      if(triggerRef.current?.contains(target)||panelRef.current?.contains(target))return;
      if(target instanceof Element&&target.closest('[data-mcc-nested-popover]'))return;
      close();
    };
    const onKeyDown=(event:globalThis.KeyboardEvent)=>{
      const target=event.target;
      if(event.key==='Escape'){
        if(document.querySelector('[data-mcc-nested-popover]'))return;
        event.preventDefault();
        close();
        return;
      }
    };
    document.addEventListener('pointerdown',onPointerDown);
    document.addEventListener('keydown',onKeyDown);
    return()=>{document.removeEventListener('pointerdown',onPointerDown);document.removeEventListener('keydown',onKeyDown);};
  },[close,mobile,open]);

  const grouped=useMemo(()=>({
    Online:data?.users.filter(user=>!user.disabled&&user.presence==='Online')??[],
    Away:data?.users.filter(user=>!user.disabled&&user.presence==='Away')??[],
    Offline:data?.users.filter(user=>!user.disabled&&user.presence==='Offline')??[],
    Disabled:data?.users.filter(user=>user.disabled)??[],
  }),[data]);

  function toggle(){
    if(open){close();return;}
    setOpen(true);
    onOpenChange?.(true);
    void sendHeartbeat().then(fetchTeam);
  }

  function trapPanelFocus(event:KeyboardEvent<HTMLElement>){
    if(event.key!=='Tab'||window.innerWidth>600||!panelRef.current)return;
    const focusable=[...panelRef.current.querySelectorAll<HTMLElement>('button,summary,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter(element=>{
      const rect=element.getBoundingClientRect();
      return !element.classList.contains('maintenance-team-focus-sentinel')&&!element.hasAttribute('disabled')&&rect.width>0&&rect.height>0;
    });
    if(!focusable.length)return;
    const first=focusable[0],last=focusable.at(-1)!;
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  }
  function focusPanelBoundary(edge:'first'|'last'){
    if(window.innerWidth>600||!panelRef.current)return;
    const focusable=[...panelRef.current.querySelectorAll<HTMLElement>('button,summary,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter(element=>{
      const rect=element.getBoundingClientRect();
      return !element.classList.contains('maintenance-team-focus-sentinel')&&!element.hasAttribute('disabled')&&rect.width>0&&rect.height>0;
    });
    (edge==='first'?focusable[0]:focusable.at(-1))?.focus();
  }
  useEffect(()=>{
    if(!open||!panelRef.current)return;
    const panel=panelRef.current;
    const onFocusIn=(event:FocusEvent)=>{
      const edge=(event.target as HTMLElement)?.dataset.teamFocusEdge;
      if(edge==='first'||edge==='last')window.requestAnimationFrame(()=>focusPanelBoundary(edge));
    };
    panel.addEventListener('focusin',onFocusIn);
    return()=>panel.removeEventListener('focusin',onFocusIn);
  },[mobile,open]);

  return <>
    <button
      ref={triggerRef}
      className="secondary-button compact-button teams-control"
      type="button"
      aria-label="Open Maintenance Team roster"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls="maintenance-team-roster"
      onClick={toggle}
    ><TeamsIcon /><span>Teams</span><strong>{data?.onlineCount??0}</strong></button>
    {open&&createPortal(
      <aside
        ref={panelRef}
        id="maintenance-team-roster"
        className={`maintenance-team-panel${mobile?' is-mobile':''}`}
        role="dialog"
        aria-modal={mobile}
        aria-labelledby="maintenance-team-title"
        data-mcc-command-overlay
        style={panelStyle}
        onKeyDownCapture={trapPanelFocus}
      >
        <span className="maintenance-team-focus-sentinel" tabIndex={mobile?0:-1} aria-hidden="true" data-team-focus-edge="last" />
        <header className="maintenance-team-header">
          <div>
            <span className="eyebrow">MCC presence</span>
            <h2 id="maintenance-team-title">Maintenance Team</h2>
            <p>{data?.totalUsers??0} users · <strong>{data?.onlineCount??0} Online</strong></p>
          </div>
          <button className="maintenance-team-close" type="button" aria-label="Close Maintenance Team roster" onClick={()=>close()}>×</button>
        </header>
        {error&&<p className="maintenance-team-error" role="status">{error}</p>}
        {!data&&!error&&<p className="maintenance-team-loading" role="status">Loading live presence…</p>}
        {data&&<div className="maintenance-team-scroll">
          <TeamSection state="Online" users={grouped.Online} serverTime={data.serverTime} />
          <TeamSection state="Away" users={grouped.Away} serverTime={data.serverTime} />
          <TeamSection state="Offline" users={grouped.Offline} serverTime={data.serverTime} />
          {grouped.Disabled.length>0&&<details className="maintenance-team-disabled">
            <summary>Disabled accounts <strong>{grouped.Disabled.length}</strong></summary>
            <div className="maintenance-team-rows">{grouped.Disabled.map(user=><TeamRow key={user.id} user={user} serverTime={data.serverTime} />)}</div>
          </details>}
        </div>}
        <span className="maintenance-team-focus-sentinel" tabIndex={mobile?0:-1} aria-hidden="true" data-team-focus-edge="first" />
      </aside>,
      document.body,
    )}
  </>;
}
