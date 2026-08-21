import { useCallback, useEffect, useRef, useState } from 'react';

export type ActionProgressPhase='idle'|'pending'|'success'|'error';

export type ActionProgressRunResult<T>=
  | {status:'success';value:T}
  | {status:'error';error:unknown}
  | {status:'duplicate'};

type ActionProgressOptions={successDurationMs?:number;errorDurationMs?:number};

const defaultSuccessDurationMs=650;
const defaultErrorDurationMs=1400;

export function useActionProgressState({successDurationMs=defaultSuccessDurationMs,errorDurationMs=defaultErrorDurationMs}:ActionProgressOptions={}){
  const [phase,setPhase]=useState<ActionProgressPhase>('idle');
  const phaseRef=useRef<ActionProgressPhase>('idle');
  const activeRef=useRef(false);
  const mountedRef=useRef(true);
  const errorTimerRef=useRef(0);

  useEffect(()=>{
    mountedRef.current=true;
    return()=>{
      mountedRef.current=false;
      window.clearTimeout(errorTimerRef.current);
    };
  },[]);

  const updatePhase=useCallback((next:ActionProgressPhase)=>{
    phaseRef.current=next;
    if(mountedRef.current)setPhase(next);
  },[]);

  const begin=useCallback(()=>{
    if(activeRef.current)return false;
    window.clearTimeout(errorTimerRef.current);
    activeRef.current=true;
    updatePhase('pending');
    return true;
  },[updatePhase]);

  const succeed=useCallback(async()=>{
    if(phaseRef.current!=='pending')return;
    updatePhase('success');
    await new Promise<void>(resolve=>window.setTimeout(resolve,successDurationMs));
    activeRef.current=false;
    if((phaseRef.current as ActionProgressPhase)==='success')updatePhase('idle');
  },[successDurationMs,updatePhase]);

  const fail=useCallback(()=>{
    activeRef.current=false;
    updatePhase('error');
    window.clearTimeout(errorTimerRef.current);
    errorTimerRef.current=window.setTimeout(()=>{
      if(phaseRef.current==='error')updatePhase('idle');
    },errorDurationMs);
  },[errorDurationMs,updatePhase]);

  const reset=useCallback(()=>{
    window.clearTimeout(errorTimerRef.current);
    activeRef.current=false;
    updatePhase('idle');
  },[updatePhase]);

  return {phase,pending:phase==='pending',active:phase==='pending'||phase==='success',begin,succeed,fail,reset};
}

export function useActionProgress(options:ActionProgressOptions={}){
  const state=useActionProgressState(options);
  const {begin,succeed,fail}=state;
  const run=useCallback(async<T,>(operation:()=>Promise<T>):Promise<ActionProgressRunResult<T>>=>{
    if(!begin())return {status:'duplicate'};
    try{
      const value=await operation();
      await succeed();
      return {status:'success',value};
    }catch(error){
      fail();
      return {status:'error',error};
    }
  },[begin,fail,succeed]);
  return {...state,run};
}

export function ActionButtonProgress({phase,idleLabel,pendingLabel='Saving...',successLabel='Saved',errorLabel='Try again'}:{phase:ActionProgressPhase;idleLabel:string;pendingLabel?:string;successLabel?:string;errorLabel?:string}){
  const labels:Record<ActionProgressPhase,string>={idle:idleLabel,pending:pendingLabel,success:successLabel,error:errorLabel};
  return <span className={`action-button-progress action-button-progress--${phase}`} data-action-progress={phase}>
    <span className="action-button-progress__indicator" data-action-progress-indicator={phase} aria-hidden="true" />
    <span className="action-button-progress__labels" aria-live="polite">{(Object.keys(labels) as ActionProgressPhase[]).map(key=><span className={key===phase?'is-current':''} key={key} aria-hidden={key===phase?undefined:true}>{labels[key]}</span>)}</span>
  </span>;
}
