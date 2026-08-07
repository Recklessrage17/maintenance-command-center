import { useCallback, useEffect, useRef, useState } from 'react';

import type { AssetLibraryScope } from '../machine-library/PreventiveMaintenanceTracking';

export const PM_ACTION_POLL_INTERVAL_MS=3000;

type ProgressOptions={label:string;pollStatus?:()=>void|Promise<void>};

export function usePmActionProgress({label,pollStatus}:ProgressOptions){
  const [pending,setPending]=useState(false);const [checkCount,setCheckCount]=useState(0);const pendingRef=useRef(false);const pollingRef=useRef(false);const pollStatusRef=useRef(pollStatus);
  useEffect(()=>{pollStatusRef.current=pollStatus;},[pollStatus]);
  useEffect(()=>{
    if(!pending)return;
    const interval=window.setInterval(async()=>{
      if(!pendingRef.current||pollingRef.current)return;
      pollingRef.current=true;setCheckCount(count=>count+1);
      try{await pollStatusRef.current?.();}catch{/* The original mutation remains authoritative; the next poll will retry. */}
      finally{pollingRef.current=false;}
    },PM_ACTION_POLL_INTERVAL_MS);
    return()=>window.clearInterval(interval);
  },[pending]);
  const run=useCallback(async<T,>(operation:()=>Promise<T>)=>{
    if(pendingRef.current)throw new Error('This PM action is already processing.');
    pendingRef.current=true;setPending(true);setCheckCount(0);
    try{return await operation();}
    finally{pendingRef.current=false;pollingRef.current=false;setPending(false);}
  },[]);
  return {pending,checkCount,label,run};
}

export function PmActionProgress({pending,checkCount,label,compact=false}:{pending:boolean;checkCount:number;label:string;compact?:boolean}){
  const [visible,setVisible]=useState(false);
  useEffect(()=>{if(!pending){setVisible(false);return;}const timer=window.setTimeout(()=>setVisible(true),180);return()=>window.clearTimeout(timer);},[pending]);
  if(!visible)return null;
  return <div className={`pm-action-progress${compact?' pm-action-progress--compact':''}`} role="status" aria-live="polite"><span className="pm-action-spinner" aria-hidden="true"/><span><strong>{label}</strong><small>{checkCount>0?`Still processing - status checked ${checkCount} ${checkCount===1?'time':'times'}. Checking again in about 3 seconds.`:'Saving changes and refreshing PM data...'}</small></span></div>;
}

export function PmActionButtonLabel({pending,idle,pendingLabel}:{pending:boolean;idle:string;pendingLabel:string}){
  return <>{pending&&<span className="pm-action-button-spinner" aria-hidden="true"/>}<span>{pending?pendingLabel:idle}</span></>;
}

export async function pollPmWorkflowStatus(library:AssetLibraryScope,assetId?:number){
  const urls:string[]=[];
  if(Number.isFinite(assetId))urls.push(`/api/${library}-library/assets/${assetId}/preventive-maintenance`);
  if(library==='machine')urls.push('/api/pm-excel/status');
  await Promise.allSettled(urls.map(async url=>{const response=await fetch(url,{credentials:'include',cache:'no-store'});if(!response.ok)throw new Error(`PM status check failed (${response.status}).`);await response.json();}));
}
