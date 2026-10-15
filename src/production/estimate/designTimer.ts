// A design timer for the job on screen: start it when the design work starts, and the time feeds the
// estimate's design cost instead of the default design hours.
//
// It counts time between bursts of activity in the page (clicks, keys, the wheel), not wall-clock
// time, so a timer left running over lunch does not bill lunch: a gap longer than IDLE_LIMIT_MS
// between two pieces of activity counts nothing. It persists, so a reload neither loses the time
// nor stops a running timer.
//
// Each project has its own timer, stored under its id: a saved project's id, or for a session not
// saved yet an id the autosave carries. The first version kept one global timer (DESIGN_TIMER_KEY)
// that kept counting across projects; it is handed to the session restored after the update.

export const IDLE_LIMIT_MS=10*60_000;
export const DESIGN_TIMER_KEY='layered-map-studio.design-timer.v1';
export const DESIGN_TIMER_PREFIX='layered-map-studio.design-timer.v2:';
export const designTimerKey=(id:string)=>DESIGN_TIMER_PREFIX+id;
export const newUnsavedTimerId=()=>`unsaved-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;

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

type Storage={getItem(k:string):string|null;setItem(k:string,v:string):void;removeItem(k:string):void};
const defaultStorage=():Storage|undefined=>{try{return typeof localStorage==='undefined'?undefined:localStorage}catch{return undefined}};

export function parseTimer(raw:string|null|undefined):DesignTimer{
 try{
  if(!raw)return emptyTimer();
  const o=JSON.parse(raw) as Partial<DesignTimer>;
  const accumulatedMs=typeof o.accumulatedMs==='number'&&Number.isFinite(o.accumulatedMs)&&o.accumulatedMs>=0?o.accumulatedMs:0;
  const lastActivity=typeof o.lastActivity==='number'&&Number.isFinite(o.lastActivity)?o.lastActivity:null;
  return {running:o.running===true&&lastActivity!==null,accumulatedMs,lastActivity:o.running===true?lastActivity:null};
 }catch{return emptyTimer()}
}

export function loadTimer(id:string,storage=defaultStorage()):DesignTimer{
 try{return parseTimer(storage?.getItem(designTimerKey(id)))}catch{return emptyTimer()}
}

// The old global timer, if it is still there, becomes this project's (once): the session calls this
// for the project it restores on the first load after the update.
export function adoptLegacyTimer(id:string,storage=defaultStorage()):void{
 try{
  const legacy=storage?.getItem(DESIGN_TIMER_KEY);
  if(!legacy)return;
  if(!storage?.getItem(designTimerKey(id)))storage?.setItem(designTimerKey(id),JSON.stringify(parseTimer(legacy)));
  storage?.removeItem(DESIGN_TIMER_KEY);
 }catch{/* see saveTimer */}
}

export function saveTimer(t:DesignTimer,id:string,storage=defaultStorage()):void{
 try{storage?.setItem(designTimerKey(id),JSON.stringify(t))}catch{/* persistence is a convenience */}
}

// Saving an unsaved session (or Save as) gives the project a new id; its time goes with it.
export function copyTimer(from:string,to:string,storage=defaultStorage()):void{
 if(from===to)return;
 try{const raw=storage?.getItem(designTimerKey(from));if(raw)storage?.setItem(designTimerKey(to),raw)}catch{/* see saveTimer */}
}
