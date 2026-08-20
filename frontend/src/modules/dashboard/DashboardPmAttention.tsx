import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { MccStatusPill } from '../../components/MccPills';
import { MccSummaryToken, MccSummaryTokenGroup } from '../../components/MccSummaryToken';
import { groupPmAlerts, pmStatusCounts, pmStatusOrder, type PmAlert, type PmAssetGroup, type PmLibrary, type PmStatus, type WarningNote } from './dashboardPm';

function statusClass(status:PmStatus){return status.toLowerCase().replace(/\s+/g,'-');}
function statusTone(status:PmStatus){return status==='Due Soon'?'warning':status==='Due Now'?'urgent':'danger';}

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

function PmStatusSummary({alerts,warningCount=0,className=''}:{alerts:PmAlert[];warningCount?:number;className?:string}) {
  const counts=pmStatusCounts(alerts);
  return <MccSummaryTokenGroup className={className}>{(['Due Soon','Due Now','Past Due'] as PmStatus[]).map(status=>counts[status]>0&&<MccSummaryToken key={status} tone={statusTone(status)}>{counts[status]} {status}</MccSummaryToken>)}{warningCount>0&&<MccSummaryToken className="dashboard-tech-note-summary">{warningCount} Tech Note{warningCount===1?'':'s'}</MccSummaryToken>}</MccSummaryTokenGroup>;
}

function AssetStatusPills({group}:{group:PmAssetGroup}) {
  return <span className="dashboard-pm-asset-statuses" aria-label="Asset PM status counts">{(['Due Soon','Due Now','Past Due'] as PmStatus[]).map(status=>group.counts[status]>0&&<MccStatusPill key={status} variant={status==='Due Soon'?'warning':'danger'} className={`dashboard-pm-count-pill status-${statusClass(status)}`}>{status} <strong>{group.counts[status]}</strong></MccStatusPill>)}</span>;
}

function PmTaskRow({alert,onOpen}:{alert:PmAlert;onOpen:()=>void}) {
  return <button className={`dashboard-pm-task-row status-${statusClass(alert.status)}`} type="button" onClick={onOpen} aria-label={`Open ${alert.title} preventive maintenance details for ${alert.assetNumber}`}>
    <span className="dashboard-pm-task-main"><strong>{alert.title}</strong><span className={`dashboard-pm-interval${alert.intervalType==='hourly'?' dashboard-pm-interval--hourly':''}`}>{intervalSummary(alert)}</span></span>
    <span className="dashboard-pm-task-due"><span>{dueInformation(alert)}</span><strong>{alert.relativeMessage||alert.countdown}</strong></span>
    <span className="dashboard-pm-task-open" aria-hidden="true">&rarr;</span>
  </button>;
}

function PmAssetAccordion({group,isOpen,onToggle,onOpenTask,onOpenWarnings}:{group:PmAssetGroup;isOpen:boolean;onToggle:()=>void;onOpenTask:(alert:PmAlert)=>void;onOpenWarnings:(group:PmAssetGroup)=>void}) {
  const contentId=`dashboard-pm-group-${group.library}-${group.assetId}`;
  const label=`${group.assetNumber}${group.brand?` (${group.brand})`:''}`;
  const inactiveContentProps=isOpen?{}:{inert:''};
  return <article className={`dashboard-pm-asset-group${isOpen?' is-open':''}${group.warningNotes.length?' has-tech-notes':''}`} style={{'--dashboard-asset-accent':group.accentColor} as CSSProperties}>
    <button className="dashboard-pm-asset-toggle" type="button" aria-expanded={isOpen} aria-controls={contentId} onClick={onToggle}>
      <span className="dashboard-pm-asset-identity"><strong>{label}</strong>{group.assetName&&<span>{group.assetName}</span>}</span>
      <AssetStatusPills group={group}/>
      <span className="dashboard-pm-chevron" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="m5.5 7.5 4.5 4.5 4.5-4.5"/></svg></span>
    </button>
    {group.warningNotes.length>0&&<button className="dashboard-tech-note-pill" type="button" onClick={()=>onOpenWarnings(group)} aria-label={`Open ${group.warningNotes.length} warning Tech ${group.warningNotes.length===1?'Note':'Notes'} for ${group.assetNumber}`}>Tech Note <strong>{group.warningNotes.length}</strong></button>}
    <div id={contentId} className="dashboard-pm-accordion-body" aria-hidden={!isOpen} {...inactiveContentProps}>
      <div className="dashboard-pm-accordion-inner">
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
  const sectionAlerts=useMemo(()=>groups.flatMap(group=>group.alerts),[groups]);
  const sectionWarningCount=useMemo(()=>groups.reduce((count,group)=>count+group.warningNotes.length,0),[groups]);
  const [openGroup,setOpenGroup]=useState<string|null>(null);
  const sectionRef=useRef<HTMLElement>(null);
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
      {(sectionAlerts.length>0||sectionWarningCount>0)&&<PmStatusSummary alerts={sectionAlerts} warningCount={sectionWarningCount} className="dashboard-pm-section-counts"/>}
    </header>
    {groups.length===0?<div className="dashboard-pm-section-empty"><strong>No {library} PM tasks need attention.</strong><span>Due Soon, Due Now, Past Due, and warning Tech Notes will appear here.</span></div>:<div className="dashboard-pm-asset-list">{groups.map(group=><PmAssetAccordion key={group.key} group={group} isOpen={openGroup===group.key} onToggle={()=>setOpenGroup(current=>current===group.key?null:group.key)} onOpenTask={onOpenTask} onOpenWarnings={onOpenWarnings}/>)}</div>}
  </section>;
}
