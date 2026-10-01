import { type CSSProperties, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MccStatusPill } from '../../components/MccPills';
import { groupPmAlerts, pmStatusOrder, type PmAlert, type PmAssetGroup, type PmLibrary, type PmStatus, type WarningNote } from './dashboardPm';
import { DashboardExpander, DashboardTaskArrow } from './DashboardExpander';

function statusClass(status:PmStatus){return status.toLowerCase().replace(/\s+/g,'-');}

function formatDate(value:string|null) {
  if(!value)return 'Not set';
  const date=new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())?value:date.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
}
function formatNumber(value:number|null){return value===null?'Not set':value.toLocaleString();}
export function intervalSummary(alert:PmAlert) {
  const fixed:Record<string,string>={bi_weekly:'Every 2 weeks',quarterly:'Every 3 months',bi_annual:'Every 6 months',annual:'Every 12 months'};
  if(fixed[alert.intervalType])return fixed[alert.intervalType];
  const units:Record<string,[string,string]>={hourly:['hour','hours'],cycles:['cycle','cycles'],days:['day','days'],weekly:['week','weeks'],monthly:['month','months']};
  const unit=units[alert.intervalType]??['interval','intervals'];
  return `Every ${alert.intervalValue.toLocaleString()} ${Math.abs(alert.intervalValue)===1?unit[0]:unit[1]}`;
}
export function dueInformation(alert:PmAlert) {
  if(alert.nextDueDate)return `Due ${formatDate(alert.nextDueDate)}`;
  if(alert.nextDueMeter!==null)return `Due at ${formatNumber(alert.nextDueMeter)} ${alert.intervalType==='hourly'?'hours':'cycles'}`;
  return 'Next due information unavailable';
}

function AssetStatusPills({group}:{group:PmAssetGroup}) {
  return <span className="dashboard-pm-asset-statuses" aria-label="Asset PM status counts">{(['Due Soon','Due Now','Past Due'] as PmStatus[]).map(status=>group.counts[status]>0&&<MccStatusPill key={status} variant={status==='Due Soon'?'warning':'danger'} className={`dashboard-pm-count-pill status-${statusClass(status)}`}>{status} <strong>{group.counts[status]}</strong></MccStatusPill>)}</span>;
}

function PmTaskRow({alert,onOpen}:{alert:PmAlert;onOpen:()=>void}) {
  return <button className={`dashboard-pm-task-row status-${statusClass(alert.status)}`} type="button" onClick={onOpen} aria-label={`Open ${alert.title} preventive maintenance details for ${alert.assetNumber}`}>
    <span className="dashboard-pm-task-main"><strong>{alert.title}</strong><span className={`dashboard-pm-interval${alert.intervalType==='hourly'?' dashboard-pm-interval--hourly':''}`}>{intervalSummary(alert)}</span></span>
    <span className="dashboard-pm-task-due"><span>{dueInformation(alert)}</span><strong>{alert.relativeMessage||alert.countdown}</strong></span>
    <DashboardTaskArrow/>
  </button>;
}

function PmAssetAccordion({group,isOpen,isWide,summaryTrack,onToggle,onOpenTask,onOpenWarnings}:{group:PmAssetGroup;isOpen:boolean;isWide:boolean;summaryTrack:number;onToggle:()=>void;onOpenTask:(alert:PmAlert)=>void;onOpenWarnings:(group:PmAssetGroup)=>void}) {
  const contentId=`dashboard-pm-group-${group.library}-${group.assetId}`;
  const label=`${group.assetNumber}${group.brand?` (${group.brand})`:''}`;
  const inactiveContentProps=isOpen?{}:{inert:''};
  const groupRef=useRef<HTMLElement>(null);
  const wasOpen=useRef(false);
  useLayoutEffect(()=>{
    const card=groupRef.current;const summary=card?.querySelector<HTMLElement>('.dashboard-pm-summary');
    if(!card||!summary)return;
    const measure=()=>{
      const style=getComputedStyle(card);
      const tracks=style.gridTemplateColumns.split(' ').length;
      // Subgrid applies the card border only to its outer tracks. Restore compact-card insets
      // on interior tracks so identity/status/WO and the control's starting X do not shift.
      card.style.setProperty('--dashboard-pm-summary-inset-start',isWide&&summaryTrack>1?style.borderLeftWidth:'0px');
      card.style.setProperty('--dashboard-pm-summary-inset-end',isWide&&summaryTrack<tracks?style.borderRightWidth:'0px');
      const innerRight=card.getBoundingClientRect().right-Number.parseFloat(style.borderRightWidth);
      const travel=Math.max(0,innerRight-summary.getBoundingClientRect().right);
      card.style.setProperty('--dashboard-pm-expander-travel',`${travel}px`);
    };
    // Set the responsive endpoint before paint; only the control transforms, not the summary.
    measure();
    const observer=new ResizeObserver(measure);observer.observe(card);observer.observe(summary);
    return()=>observer.disconnect();
  },[isOpen,isWide,summaryTrack]);
  useEffect(()=>{
    const justOpened=isOpen&&!wasOpen.current;
    wasOpen.current=isOpen;
    if(!justOpened)return;
    const frame=window.requestAnimationFrame(()=>{
      const element=groupRef.current;
      if(!element?.isConnected)return;
      const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      element.scrollIntoView({behavior:reducedMotion?'auto':'smooth',block:'center',inline:'nearest'});
    });
    return()=>window.cancelAnimationFrame(frame);
  },[isOpen]);
  return <article ref={groupRef} data-pm-group-key={group.key} className={`dashboard-pm-asset-group${isOpen?' is-open':''}${isWide?' is-wide':''}${group.warningNotes.length?' has-tech-notes':''}`} style={{'--dashboard-asset-accent':group.accentColor} as CSSProperties}>
    <div className="dashboard-pm-summary">
      <button className="dashboard-pm-asset-toggle" type="button" aria-expanded={isOpen} aria-controls={contentId} onClick={onToggle}>
        <span className="dashboard-pm-asset-identity"><strong>{label}</strong>{group.assetName&&<span>{group.assetName}</span>}</span>
        <AssetStatusPills group={group}/>
        <DashboardExpander className="dashboard-pm-chevron"/>
      </button>
      {group.warningNotes.length>0&&<div className="dashboard-wo-badge" role="group" aria-label={`Work order counts for ${group.assetNumber}`}><span className="dashboard-wo-label">WO</span><span aria-hidden="true">(</span>{(['open','hold'] as const).map(filter=>{const notes=group.warningNotes.filter(note=>Boolean(note.hold)===(filter==='hold'));const label=filter==='hold'?'Hold':'Open';return <span className="dashboard-wo-segment" key={filter}>{filter==='hold'&&<span aria-hidden="true">/</span>}<button className={`dashboard-wo-count is-${filter}`} type="button" disabled={!notes.length} onClick={()=>onOpenWarnings({...group,warningNotes:notes,warningFilter:filter})} aria-label={`Open ${notes.length} ${label} work orders for ${group.assetNumber}`}>{label} <strong>{notes.length}</strong></button></span>;})}<span aria-hidden="true">)</span></div>}
    </div>
    <div id={contentId} className="dashboard-pm-accordion-body dashboard-accordion-body" aria-hidden={!isOpen} {...inactiveContentProps}>
      <div className="dashboard-pm-accordion-inner dashboard-accordion-inner">
        {pmStatusOrder.map(status=>{
          const tasks=group.alerts.filter(alert=>alert.status===status);
          return tasks.length>0&&<section className={`dashboard-pm-status-section status-${statusClass(status)}`} key={status} aria-labelledby={`${contentId}-${statusClass(status)}`}>
            <h4 id={`${contentId}-${statusClass(status)}`}>{status}<span>{tasks.length}</span></h4>
            <div className="dashboard-pm-task-list">{tasks.map(alert=><PmTaskRow key={`${alert.assetLibrary??'machine'}:${alert.id}`} alert={alert} onOpen={()=>onOpenTask(alert)}/>)}</div>
          </section>;
        })}
      </div>
    </div>
  </article>;
}

export function PmAttentionSection({library,title,description,alerts,warningNotes,onOpenTask,onOpenWarnings}:{library:PmLibrary;title:string;description:string;alerts:PmAlert[];warningNotes:WarningNote[];onOpenTask:(alert:PmAlert)=>void;onOpenWarnings:(group:PmAssetGroup)=>void}) {
  const groups=useMemo(()=>groupPmAlerts(alerts,library,warningNotes),[alerts,library,warningNotes]);
  const columns=useMemo(()=>Array.from({length:Math.ceil(groups.length/4)},(_,column)=>groups.slice(column*4,column*4+4)),[groups]);
  const [openGroup,setOpenGroup]=useState<string|null>(null);
  const sectionRef=useRef<HTMLElement>(null);
  const listRef=useRef<HTMLDivElement>(null);
  const [trackCount,setTrackCount]=useState(1);
  const [wideGroups,setWideGroups]=useState<string[]>([]);
  // Use the actual grid tracks, including responsive changes, to retain the summary's slot.
  useLayoutEffect(()=>{
    const list=listRef.current;if(!list)return;
    const observer=new ResizeObserver(()=>setTrackCount(getComputedStyle(list).gridTemplateColumns.split(' ').length));
    observer.observe(list);return()=>observer.disconnect();
  },[groups.length]);
  useEffect(()=>{
    if(openGroup)setWideGroups(current=>current.includes(openGroup)?current:[...current,openGroup]);
    let cancelled=false;
    // Retain each closing card independently during A -> B switches. Ignore perpetual WO pulses.
    sectionRef.current?.querySelectorAll<HTMLElement>('.is-wide:not(.is-open)').forEach(card=>{
      const key=card.dataset.pmGroupKey!;
      const body=card.querySelector('.dashboard-accordion-body');
      const circle=card.querySelector('.dashboard-pm-chevron');
      const icon=circle?.querySelector('svg');
      const animations=[body,circle,icon].flatMap(element=>element?.getAnimations()??[]);
      void Promise.allSettled(animations.map(animation=>animation.finished)).then(()=>{
        if(!cancelled)setWideGroups(current=>current.filter(groupKey=>groupKey!==key));
      });
    });
    return()=>{cancelled=true;};
  },[openGroup]);
  useEffect(()=>{if(openGroup&&!groups.some(group=>group.key===openGroup))setOpenGroup(null);},[groups,openGroup]);
  useEffect(()=>{
    if(!openGroup)return;
    const openAccordion=()=>sectionRef.current?.querySelector<HTMLElement>('.dashboard-pm-asset-group.is-open')??null;
    const handlePointerDown=(event:PointerEvent)=>{
      const accordion=openAccordion();
      if(!accordion||!(event.target instanceof Node)||accordion.contains(event.target))return;
      const targetElement=event.target instanceof Element?event.target:event.target.parentElement;
      const targetToggle=targetElement?.closest('.dashboard-pm-asset-toggle');
      if(targetToggle&&sectionRef.current?.contains(targetToggle))return;
      setOpenGroup(null);
    };
    const handleKeyDown=(event:KeyboardEvent)=>{
      if(event.key!=='Escape')return;
      const accordion=openAccordion();
      if(!accordion||!accordion.contains(document.activeElement))return;
      event.preventDefault();
      setOpenGroup(null);
      accordion.querySelector<HTMLElement>('.dashboard-pm-asset-toggle')?.focus();
    };
    document.addEventListener('pointerdown',handlePointerDown);
    document.addEventListener('keydown',handleKeyDown);
    return ()=>{
      document.removeEventListener('pointerdown',handlePointerDown);
      document.removeEventListener('keydown',handleKeyDown);
    };
  },[openGroup]);
  return <section ref={sectionRef} className={`dashboard-pm-section dashboard-pm-section--${library}`} aria-labelledby={`dashboard-${library}-pm-title`}>
    <header className="dashboard-pm-section-heading">
      <div><p className="dashboard-pm-library-label">{library==='machine'?'Machine Library':'Equipment Library'}</p><h3 id={`dashboard-${library}-pm-title`}>{title}</h3><p>{description}</p></div>
    </header>
    {groups.length===0?<div className="dashboard-pm-section-empty"><strong>No {library} PM tasks need attention.</strong><span>Due Soon, Due Now, Past Due, and warning Tech Notes will appear here.</span></div>:<div ref={listRef} className={`dashboard-pm-asset-list${openGroup?' has-open-group':''}`}>{columns.map((columnGroups,column)=><div className={`dashboard-pm-column${columnGroups.some(group=>group.key===openGroup||wideGroups.includes(group.key))?' is-expanded-column':''}`} key={column} style={{'--dashboard-pm-summary-track':column%trackCount+1} as CSSProperties}>{columnGroups.map(group=><PmAssetAccordion key={group.key} group={group} isOpen={openGroup===group.key} isWide={openGroup===group.key||wideGroups.includes(group.key)} summaryTrack={column%trackCount+1} onToggle={()=>setOpenGroup(current=>current===group.key?null:group.key)} onOpenTask={onOpenTask} onOpenWarnings={onOpenWarnings}/>)}</div>)}</div>}
  </section>;
}
