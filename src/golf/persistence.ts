import {createDefaultGolfProject} from './defaults';
import type {GolfProject} from './types';
import {clampGolfProject} from './validation';

// localStorage persistence, the topo builder's pattern (src/topo/persistence.ts): one record, merged
// over a fresh default and clamped, so a hand-edited or partly written record cannot put the page into
// a state its controls cannot show. The course geometry is not stored here; it comes back from the
// server's snapshot cache by `course`.

export const GOLF_STORAGE_KEY='layered-map-studio.golf.v1';

type Storage={getItem(k:string):string|null;setItem(k:string,v:string):void;removeItem(k:string):void};

const defaultStorage=():Storage|undefined=>{
 try{return typeof localStorage==='undefined'?undefined:localStorage}catch{return undefined}
};

export function loadGolfProject(storage=defaultStorage()):GolfProject|undefined{
 if(!storage)return undefined;
 let raw:string|null=null;
 try{raw=storage.getItem(GOLF_STORAGE_KEY)}catch{return undefined}
 if(!raw)return undefined;
 try{
  const parsed=JSON.parse(raw) as Partial<GolfProject>;
  if(!parsed||typeof parsed!=='object'||parsed.schemaVersion!==1)return undefined;
  const base=createDefaultGolfProject();
  return clampGolfProject({
   ...base,...parsed,schemaVersion:1,
   board:{...base.board,...parsed.board},
   marks:{...base.marks,...parsed.marks},
   title:{...base.title,...parsed.title,show:{...base.title.show,...parsed.title?.show},text:{...base.title.text,...parsed.title?.text}},
  });
 }catch{return undefined}
}

export function saveGolfProject(project:GolfProject,storage=defaultStorage()):void{
 if(!storage)return;
 try{storage.setItem(GOLF_STORAGE_KEY,JSON.stringify(project))}catch{/* quota or private mode: persistence is a convenience */}
}
