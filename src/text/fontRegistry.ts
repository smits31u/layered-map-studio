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

export function loadFont(id:FontId):Promise<opentype.Font>{
 const cached=resolved.get(id);
 if(cached)return Promise.resolve(cached);
 const inFlight=pending.get(id);
 if(inFlight)return inFlight;
 const definition=FONT_REGISTRY.find(f=>f.id===id);
 if(!definition){const error=new Error(`Unknown font "${id}"`);failed.set(id,error);return Promise.reject(error)}
 // A fresh attempt clears any earlier failure, so a retry (the caller calling loadFont again,
 // e.g. after the network recovers) can turn a failed state back into loading, then resolved.
 failed.delete(id);
 const promise=fetch(definition.url)
  .then(response=>{if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.arrayBuffer()})
  .then(buffer=>opentype.parse(buffer))
  .then(font=>{resolved.set(id,font);pending.delete(id);failed.delete(id);return font})
  .catch(error=>{
   pending.delete(id);
   const wrapped=new Error(`Font "${definition.label}" failed to load: ${(error as Error).message}`);
   failed.set(id,wrapped);
   throw wrapped;
  });
 pending.set(id,promise);
 return promise;
}

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
}

// Test-only: simulate a genuinely failed load without going through fetch, and clear it again.
export function setFontLoadErrorForTesting(id:FontId,error:Error|undefined):void{
 if(error)failed.set(id,error);else failed.delete(id);
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
 return font;
}
