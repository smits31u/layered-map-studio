import {createDefaultTopoProject} from './defaults';
import type {TopoProject} from './types';
import {clampTopoProject} from './validation';

// localStorage persistence, the plan's "Persist projects to localStorage with a schema version".
//
// Phase 1's exit criterion is recovering *non-file* state after a reload, and the route is file
// state: it is not saved. That is a choice, not an omission. A GPX track is a detailed record of
// where somebody went, often from their own front door; writing it into the browser's storage
// would keep that record around after the user has closed the file and, as far as they can tell,
// dismissed it. The file is on their disk already; reloading it is one click. Everything else — the
// place, the board size and unit, the viewport, and every setting — is restored.
//
// A stored record is untrusted: it is merged over a fresh default and clamped, so a hand-edited or
// partially written record can never put the page into a state its controls cannot represent.

export const TOPO_STORAGE_KEY='layered-map-studio.topo.v1';

type Storage={getItem(k:string):string|null;setItem(k:string,v:string):void;removeItem(k:string):void};

const defaultStorage=():Storage|undefined=>{
 try{return typeof localStorage==='undefined'?undefined:localStorage}catch{return undefined}
};

export function loadTopoProject(storage=defaultStorage()):TopoProject|undefined{
 if(!storage)return undefined;
 let raw:string|null=null;
 try{raw=storage.getItem(TOPO_STORAGE_KEY)}catch{return undefined}
 if(!raw)return undefined;
 try{
  const parsed=JSON.parse(raw) as Partial<TopoProject>;
  if(!parsed||typeof parsed!=='object'||parsed.schemaVersion!==1)return undefined;
  return clampTopoProject({...merge(createDefaultTopoProject(),parsed),route:null});
 }catch{return undefined}
}

export function saveTopoProject(project:TopoProject,storage=defaultStorage()):void{
 if(!storage)return;
 try{storage.setItem(TOPO_STORAGE_KEY,JSON.stringify({...project,route:null}))}catch{/* quota or private mode: persistence is a convenience, not a guarantee */}
}

export function clearTopoProject(storage=defaultStorage()):void{
 if(!storage)return;
 try{storage.removeItem(TOPO_STORAGE_KEY)}catch{/* see saveTopoProject */}
}

function merge(base:TopoProject,patch:Partial<TopoProject>):TopoProject{
 return {
  ...base,
  ...patch,
  schemaVersion:1,
  viewport:{...base.viewport,...patch.viewport,bearing:0,pitch:0},
  output:{...base.output,...patch.output},
  terrain:{...base.terrain,...patch.terrain},
  roads:{...base.roads,...patch.roads},
  labels:{...base.labels,...patch.labels},
  frame:{...base.frame,...patch.frame},
  compass:{...base.compass,...patch.compass},
  title:{...base.title,...patch.title},
 };
}
