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

export function loadFont(id:FontId):Promise<opentype.Font>{
 const cached=resolved.get(id);
 if(cached)return Promise.resolve(cached);
 const inFlight=pending.get(id);
 if(inFlight)return inFlight;
 const definition=FONT_REGISTRY.find(f=>f.id===id);
 if(!definition)return Promise.reject(new Error(`Unknown font "${id}"`));
 const promise=fetch(definition.url)
  .then(response=>{if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.arrayBuffer()})
  .then(buffer=>opentype.parse(buffer))
  .then(font=>{resolved.set(id,font);pending.delete(id);return font})
  .catch(error=>{pending.delete(id);throw new Error(`Font "${definition.label}" failed to load: ${(error as Error).message}`)});
 pending.set(id,promise);
 return promise;
}

// Synchronous accessor for the manufacturing pipeline, which is not async. Returns undefined until
// loadFont(id) has resolved at least once — buildScene surfaces this as a clear "still loading"
// error rather than silently dropping the text object.
export function getLoadedFont(id:FontId):opentype.Font|undefined{
 return resolved.get(id);
}

export function preloadAllFonts():Promise<void>{
 return Promise.all(FONT_REGISTRY.map(f=>loadFont(f.id).catch(()=>undefined))).then(()=>undefined);
}

// Test-only synchronous registration, bypassing fetch (unavailable/undesirable in unit tests).
// Tests load the real bundled font files from disk and register them once in a global setup file
// so buildScene's requireFont() sees them as already loaded, exactly like a real preloaded browser.
export function registerFontForTesting(id:FontId,font:opentype.Font):void{
 resolved.set(id,font);
}
