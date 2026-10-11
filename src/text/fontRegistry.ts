import * as opentype from 'opentype.js';
import type {FontId} from '../types/project';

export type FontDefinition={id:FontId;label:string;url:string};

// All three are SIL OFL-licensed (see public/fonts/*-OFL.txt), locally bundled — manufacturing
// export must never depend on a font being installed on the destination computer.
export const FONT_REGISTRY:FontDefinition[]=[
 {id:'inter',label:'Inter',url:'/fonts/Inter-Regular.ttf'},
 {id:'cinzel',label:'Cinzel',url:'/fonts/Cinzel-Regular.ttf'},
 {id:'great-vibes',label:'Great Vibes',url:'/fonts/GreatVibes-Regular.ttf'},
];

const resolved=new Map<FontId,opentype.Font>();
const pending=new Map<FontId,Promise<opentype.Font>>();
// A load that has actually failed (bad HTTP status, a corrupt/unparseable file, a network error),
// as opposed to one that simply hasn't finished yet. Previously getLoadedFont's undefined meant
// both "still loading" and "gave up and failed" indistinguishably, so a genuine failure (a typo'd
// URL, a missing font file in a deploy) surfaced to the user as a permanent, misleading "still
// loading — wait a moment and try again", never as the actionable error it actually is.
const failed=new Map<FontId,Error>();

// A fetch that never settles (a stalled connection, a proxy holding the request) used to leave a
// font "still loading" forever, with nothing for the user to act on. After this long the attempt is
// aborted and recorded as a failure, which the UI shows with a Retry. The fonts are ~100–300 KB
// served from this app's own origin, so 20s is generous even on a poor connection.
export const FONT_LOAD_TIMEOUT_MS=20_000;

// Font state changes (loading → ready / failed, and a retry back to loading) for the UI's notice and
// for tools that rebuild once a font arrives.
const listeners=new Set<()=>void>();
let version=0;
const notify=()=>{version++;for(const listener of [...listeners])listener()};
export function subscribeFonts(listener:()=>void):()=>void{listeners.add(listener);return()=>{listeners.delete(listener)}}
// Changes whenever any font's state does — a cheap snapshot for useSyncExternalStore.
export const fontStateVersion=()=>version;

export type FontStatus='ready'|'loading'|'failed'|'idle';
export const fontStatus=(id:FontId):FontStatus=>resolved.has(id)?'ready':pending.has(id)?'loading':failed.has(id)?'failed':'idle';
export const failedFonts=():{id:FontId;label:string;error:Error}[]=>FONT_REGISTRY.filter(f=>!resolved.has(f.id)&&failed.has(f.id)).map(f=>({id:f.id,label:f.label,error:failed.get(f.id)!}));
export const fontLabel=(id:FontId)=>FONT_REGISTRY.find(f=>f.id===id)?.label??id;

export function loadFont(id:FontId,options:{timeoutMs?:number}={}):Promise<opentype.Font>{
 const cached=resolved.get(id);
 if(cached)return Promise.resolve(cached);
 const inFlight=pending.get(id);
 if(inFlight)return inFlight;
 const definition=FONT_REGISTRY.find(f=>f.id===id);
 if(!definition){const error=new Error(`Unknown font "${id}"`);failed.set(id,error);notify();return Promise.reject(error)}
 // A fresh attempt clears any earlier failure, so a retry (the caller calling loadFont again,
 // e.g. after the network recovers) can turn a failed state back into loading, then resolved.
 failed.delete(id);
 const timeoutMs=options.timeoutMs??FONT_LOAD_TIMEOUT_MS,controller=typeof AbortController==='undefined'?undefined:new AbortController();
 let timedOut=false,timer:ReturnType<typeof setTimeout>|undefined;
 const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{timedOut=true;controller?.abort();reject(new Error(`did not finish loading within ${Math.round(timeoutMs/1000)} seconds`))},timeoutMs)});
 const attempt=fetch(definition.url,controller?{signal:controller.signal}:undefined)
  .then(response=>{if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.arrayBuffer()})
  .then(buffer=>opentype.parse(buffer));
 const promise=Promise.race([attempt,deadline])
  .then(font=>{clearTimeout(timer);resolved.set(id,font);pending.delete(id);failed.delete(id);notify();return font})
  .catch(error=>{
   clearTimeout(timer);
   pending.delete(id);
   const reason=timedOut?`did not finish loading within ${Math.round(timeoutMs/1000)} seconds`:(error as Error).message;
   const wrapped=new Error(`Font "${definition.label}" failed to load: ${reason}`);
   failed.set(id,wrapped);
   notify();
   throw wrapped;
  });
 // The race's loser must not surface as an unhandled rejection.
 attempt.catch(()=>{});
 pending.set(id,promise);
 notify();
 return promise;
}

// The UI's Retry: a new attempt for a font whose last one failed. Resolves to whether it loaded.
export const retryFont=(id:FontId)=>loadFont(id).then(()=>true,()=>false);

// Synchronous accessor for the manufacturing pipeline, which is not async. Returns undefined until
// loadFont(id) has resolved at least once — buildScene surfaces this as a clear "still loading"
// error rather than silently dropping the text object.
export function getLoadedFont(id:FontId):opentype.Font|undefined{
 return resolved.get(id);
}

// The error from the most recent loadFont(id) attempt, if it failed and hasn't been retried since.
// undefined here does NOT mean the font loaded — combine with getLoadedFont: font present = ready,
// no font and no error = still loading, no font and an error = genuinely failed.
export function getFontLoadError(id:FontId):Error|undefined{
 return failed.get(id);
}

export function preloadAllFonts():Promise<void>{
 return Promise.all(FONT_REGISTRY.map(f=>loadFont(f.id).catch(()=>undefined))).then(()=>undefined);
}

// Test-only synchronous registration, bypassing fetch (unavailable/undesirable in unit tests).
// Tests load the real bundled font files from disk and register them once in a global setup file
// so buildScene's requireFont() sees them as already loaded, exactly like a real preloaded browser.
export function registerFontForTesting(id:FontId,font:opentype.Font):void{
 resolved.set(id,font);
 failed.delete(id);
 notify();
}

// Test-only: simulate a genuinely failed load without going through fetch, and clear it again.
export function setFontLoadErrorForTesting(id:FontId,error:Error|undefined):void{
 if(error)failed.set(id,error);else failed.delete(id);
 notify();
}

// Test-only: remove a font's cached resolution, returning whatever was cached so the caller can
// restore it later (registerFontForTesting). Fonts are pre-registered as loaded globally in
// tests/setup.ts (see registerFontForTesting above), so a test that wants to exercise the
// "genuinely failed, never successfully loaded" state — the only state in which requireFont's
// getFontLoadError check actually matters, since a font present in `resolved` is always ready
// regardless of a later failed retry (see getFontLoadError's docs) — needs a way to evict that
// pre-registration first.
export function forgetFontForTesting(id:FontId):opentype.Font|undefined{
 const font=resolved.get(id);
 resolved.delete(id);
 notify();
 return font;
}
