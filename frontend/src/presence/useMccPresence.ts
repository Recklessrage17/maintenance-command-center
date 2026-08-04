import { useEffect } from 'react';
import presencePolicy from '../../../shared/presence-policy.json';

const presenceClientStorageKey='mcc_presence_client_instance';
const presenceClientIdPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function createClientInstanceId() {
  if(typeof crypto.randomUUID==='function') return crypto.randomUUID();
  const bytes=crypto.getRandomValues(new Uint8Array(16));
  bytes[6]=(bytes[6]&0x0f)|0x40;
  bytes[8]=(bytes[8]&0x3f)|0x80;
  const value=[...bytes].map(byte=>byte.toString(16).padStart(2,'0')).join('');
  return `${value.slice(0,8)}-${value.slice(8,12)}-${value.slice(12,16)}-${value.slice(16,20)}-${value.slice(20)}`;
}

function presenceClientInstanceId() {
  try{
    const existing=sessionStorage.getItem(presenceClientStorageKey);
    if(existing&&presenceClientIdPattern.test(existing)) return existing;
    const created=createClientInstanceId();
    sessionStorage.setItem(presenceClientStorageKey,created);
    return created;
  }catch{
    return createClientInstanceId();
  }
}

export function useMccPresence(enabled:boolean) {
  useEffect(()=>{
    if(!enabled)return;
    const clientInstanceId=presenceClientInstanceId();
    let activitySinceLastHeartbeat=true;
    let lastActivityAt=new Date().toISOString();
    let lastActivityCapture=0;
    let heartbeatInFlight=false;
    let stopped=false;

    const captureActivity=()=>{
      const timestamp=Date.now();
      if(timestamp-lastActivityCapture<1_000)return;
      lastActivityCapture=timestamp;
      lastActivityAt=new Date(timestamp).toISOString();
      activitySinceLastHeartbeat=true;
    };
    const sendHeartbeat=async(forceActivity=false)=>{
      if(stopped||heartbeatInFlight)return;
      const sentActivityAt=lastActivityAt;
      const sentActivity=forceActivity||activitySinceLastHeartbeat;
      heartbeatInFlight=true;
      try{
        const response=await fetch('/api/presence/heartbeat',{
          method:'POST',
          credentials:'include',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({
            clientInstanceId,
            visibility:document.visibilityState==='hidden'?'hidden':'visible',
            activitySinceLastHeartbeat:sentActivity,
            lastActivityAt:sentActivityAt,
          }),
        });
        if(response.ok&&lastActivityAt===sentActivityAt)activitySinceLastHeartbeat=false;
      }catch{
        // The server timeout remains authoritative while the client is offline.
      }finally{
        heartbeatInFlight=false;
      }
    };
    const disconnect=()=>{
      const body=JSON.stringify({clientInstanceId});
      try{
        const payload=new Blob([body],{type:'application/json'});
        if(navigator.sendBeacon('/api/presence/disconnect',payload))return;
      }catch{}
      void fetch('/api/presence/disconnect',{
        method:'POST',
        credentials:'include',
        headers:{'Content-Type':'application/json'},
        body,
        keepalive:true,
      }).catch(()=>undefined);
    };
    const onFocus=()=>{captureActivity();void sendHeartbeat(true);};
    const onVisibilityChange=()=>{
      if(document.visibilityState==='visible')captureActivity();
      void sendHeartbeat(document.visibilityState==='visible');
    };
    const onPageHide=(event:PageTransitionEvent)=>{if(!event.persisted)disconnect();};
    const onOnline=()=>void sendHeartbeat();
    const activityEvents=['keydown','mousedown','mousemove','pointerdown','pointermove','scroll','touchstart'] as const;
    activityEvents.forEach(eventName=>window.addEventListener(eventName,captureActivity,{passive:true,capture:true}));
    window.addEventListener('focus',onFocus);
    window.addEventListener('online',onOnline);
    window.addEventListener('pagehide',onPageHide);
    document.addEventListener('visibilitychange',onVisibilityChange);
    void sendHeartbeat(true);
    const heartbeatTimer=window.setInterval(()=>void sendHeartbeat(),presencePolicy.heartbeatIntervalMs);

    return()=>{
      stopped=true;
      activityEvents.forEach(eventName=>window.removeEventListener(eventName,captureActivity,{capture:true}));
      window.removeEventListener('focus',onFocus);
      window.removeEventListener('online',onOnline);
      window.removeEventListener('pagehide',onPageHide);
      document.removeEventListener('visibilitychange',onVisibilityChange);
      window.clearInterval(heartbeatTimer);
    };
  },[enabled]);
}
