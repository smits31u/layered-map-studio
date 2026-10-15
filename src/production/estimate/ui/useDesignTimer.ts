import {useCallback,useEffect,useRef,useState} from 'react';
import {designTimerKey,emptyTimer,loadTimer,noteActivity,pauseTimer,saveTimer,startTimer,timerElapsedMs,timerIdle,type DesignTimer} from '../designTimer';

// The design timer as React state: page activity feeds it while it runs, the display ticks once a
// second, and every change is saved. Activity is throttled so a drag does not write storage per frame.
//
// id is the project's: switching project pauses the old project's timer and shows the new one's.
// Another tab changing the same project's timer is picked up through the storage event.
const ACTIVITY_THROTTLE_MS=5000;

export function useDesignTimer(id:string){
 const[timer,setTimer]=useState<DesignTimer>(()=>loadTimer(id));
 const[now,setNow]=useState(()=>Date.now());
 const timerRef=useRef(timer),idRef=useRef(id);
 const show=(next:DesignTimer)=>{timerRef.current=next;setTimer(next)};
 const update=useCallback((next:DesignTimer)=>{timerRef.current=next;setTimer(next);saveTimer(next,idRef.current)},[]);
 useEffect(()=>{
  if(idRef.current===id)return;
  const t=Date.now(),previous=idRef.current;
  if(timerRef.current.running)saveTimer(pauseTimer(timerRef.current,t),previous);
  idRef.current=id;
  setNow(t);show(loadTimer(id));
 },[id]);
 useEffect(()=>{
  const key=designTimerKey(id);
  const changed=(e:StorageEvent)=>{if(e.key===key){setNow(Date.now());show(loadTimer(id))}};
  window.addEventListener('storage',changed);
  return ()=>window.removeEventListener('storage',changed);
 },[id]);
 useEffect(()=>{
  if(!timer.running)return;
  const tick=window.setInterval(()=>setNow(Date.now()),1000);
  let last=0;
  const activity=()=>{const t=Date.now();if(t-last<ACTIVITY_THROTTLE_MS)return;last=t;update(noteActivity(timerRef.current,t))};
  const events=['pointerdown','keydown','wheel'] as const;
  for(const e of events)window.addEventListener(e,activity,{passive:true,capture:true});
  return ()=>{window.clearInterval(tick);for(const e of events)window.removeEventListener(e,activity,{capture:true})};
 },[timer.running,update]);
 return {
  running:timer.running,
  elapsedMs:timerElapsedMs(timer,now),
  idle:timerIdle(timer,now),
  start:()=>{const t=Date.now();setNow(t);update(startTimer(timerRef.current,t))},
  pause:()=>{const t=Date.now();setNow(t);update(pauseTimer(timerRef.current,t))},
  reset:()=>{setNow(Date.now());update(emptyTimer())},
 };
}
