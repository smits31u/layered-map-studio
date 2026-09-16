import {createDefaultOrnamentProject} from './defaults';
import type {OrnamentProject} from './types';
import {clampOrnamentProject} from './validation';

export const ORNAMENT_STORAGE_KEY='layered-map-studio.ornament.v1';

type Storage={getItem(k:string):string|null;setItem(k:string,v:string):void;removeItem(k:string):void};

const defaultStorage=():Storage|undefined=>{
 try{return typeof localStorage==='undefined'?undefined:localStorage}catch{return undefined}
};

// Anything persisted is user input from a previous session and is treated as untrusted: it is
// structurally merged over a fresh default and then clamped, so a hand-edited or
// partially-written record can never put the editor into a state the UI cannot represent.
export function loadOrnamentProject(storage=defaultStorage()):OrnamentProject|undefined{
 if(!storage)return undefined;
 let raw:string|null=null;
 try{raw=storage.getItem(ORNAMENT_STORAGE_KEY)}catch{return undefined}
 if(!raw)return undefined;
 try{
  const parsed=JSON.parse(raw) as Partial<OrnamentProject>;
  if(!parsed||parsed.schemaVersion!==1)return undefined;
  return clampOrnamentProject(merge(createDefaultOrnamentProject(),parsed));
 }catch{return undefined}
}

export function saveOrnamentProject(project:OrnamentProject,storage=defaultStorage()):void{
 if(!storage)return;
 try{storage.setItem(ORNAMENT_STORAGE_KEY,JSON.stringify(project))}catch{/* quota or private mode — persistence is a convenience, not a guarantee */}
}

export function clearOrnamentProject(storage=defaultStorage()):void{
 if(!storage)return;
 try{storage.removeItem(ORNAMENT_STORAGE_KEY)}catch{/* see saveOrnamentProject */}
}

function merge(base:OrnamentProject,patch:Partial<OrnamentProject>):OrnamentProject{
 return {
  ...base,
  ...patch,
  schemaVersion:1,
  viewport:{...base.viewport,...patch.viewport,bearing:0,pitch:0},
  ornament:{...base.ornament,...patch.ornament,hangingLoop:{...base.ornament.hangingLoop,...patch.ornament?.hangingLoop}},
  roads:{...base.roads,...patch.roads},
  marker:{...base.marker,...patch.marker},
  text:{
   ...base.text,
   ...patch.text,
   subtitle:{...base.text.subtitle,...patch.text?.subtitle},
   title:{...base.text.title,...patch.text?.title},
   date:{...base.text.date,...patch.text?.date},
  },
 };
}
