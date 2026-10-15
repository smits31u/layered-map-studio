// A design timer for the job on screen: start it when the design work starts, and the time feeds the
// estimate's design cost instead of the default design hours.
//
// It counts time between bursts of activity in the page (clicks, keys, the wheel), not wall-clock
// time, so a timer left running over lunch does not bill lunch: a gap longer than IDLE_LIMIT_MS
// between two pieces of activity counts nothing. It persists, so a reload neither loses the time
// nor stops a running timer.

export const IDLE_LIMIT_MS=10*60_000;
export const DESIGN_TIMER_KEY='layered-map-studio.design-timer.v1';

// lastActivity: when the last counted activity happened while running (null when paused).
export type DesignTimer={running:boolean;accumulatedMs:number;lastActivity:number|null};

export const emptyTimer=():DesignTimer=>({running:false,accumulatedMs:0,lastActivity:null});

// Credits the time since the last activity if it was short enough to be work.
const credit=(t:DesignTimer,now:number)=>t.running&&t.lastActivity!==null&&now>=t.lastActivity&&now-t.lastActivity<=IDLE_LIMIT_MS?now-t.lastActivity:0;

export const startTimer=(t:DesignTimer,now:number):DesignTimer=>t.running?t:{running:true,accumulatedMs:t.accumulatedMs,lastActivity:now};
export const pauseTimer=(t:DesignTimer,now:number):DesignTimer=>t.running?{running:false,accumulatedMs:t.accumulatedMs+credit(t,now),lastActivity:null}:t;
export const noteActivity=(t:DesignTimer,now:number):DesignTimer=>t.running?{running:true,accumulatedMs:t.accumulatedMs+credit(t,now),lastActivity:now}:t;

// Time to show now: the counted time, plus the current stretch while it is still within the limit.
export const timerElapsedMs=(t:DesignTimer,now:number)=>t.accumulatedMs+credit(t,now);
// True while running but idle past the limit: the display says it is not counting.
export const timerIdle=(t:DesignTimer,now:number)=>t.running&&t.lastActivity!==null&&now-t.lastActivity>IDLE_LIMIT_MS;

export const formatTimer=(ms:number)=>{const s=Math.floor(ms/1000);return `${Math.floor(s/3600)}:${String(Math.floor(s/60)%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`};

type Storage={getItem(k:string):string|null;setItem(k:string,v:string):void};
const defaultStorage=():Storage|undefined=>{try{return typeof localStorage==='undefined'?undefined:localStorage}catch{return undefined}};

export function loadTimer(storage=defaultStorage()):DesignTimer{
 try{
  const raw=storage?.getItem(DESIGN_TIMER_KEY);if(!raw)return emptyTimer();
  const o=JSON.parse(raw) as Partial<DesignTimer>;
  const accumulatedMs=typeof o.accumulatedMs==='number'&&Number.isFinite(o.accumulatedMs)&&o.accumulatedMs>=0?o.accumulatedMs:0;
  const lastActivity=typeof o.lastActivity==='number'&&Number.isFinite(o.lastActivity)?o.lastActivity:null;
  return {running:o.running===true&&lastActivity!==null,accumulatedMs,lastActivity:o.running===true?lastActivity:null};
 }catch{return emptyTimer()}
}

export function saveTimer(t:DesignTimer,storage=defaultStorage()):void{
 try{storage?.setItem(DESIGN_TIMER_KEY,JSON.stringify(t))}catch{/* persistence is a convenience */}
}
