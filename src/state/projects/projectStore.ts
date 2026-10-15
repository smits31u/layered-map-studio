import type {ExtractedFeatures,MapProject} from '../../types/project';
import {normalizeFeatures,normalizeMapProject} from './normalize';

// Saved lake projects and the autosaved current session.
//
// IndexedDB, not localStorage like the ornament and topo projects: a lake project carries its
// captured geography (so reopening it rebuilds exactly what was quoted and cut, even after the map
// data changes) and, with true bathymetry, the depth dataset. Together that can be hundreds of KB per
// project, which a 5 MB localStorage quota would run out of after a handful of maps.

export type SavedLakeProject={
 id:string;
 name:string;
 createdAt:string;
 updatedAt:string;
 appVersion:string;
 project:MapProject;
 // The geography captured for project.map.crop, when there was one.
 features?:ExtractedFeatures;
};

// What reopening the studio restores: the project on screen, its geography, and which saved project
// it is (if any) and whether it has changed since that save.
export type LakeAutosave={project:MapProject;features?:ExtractedFeatures;savedId?:string;savedName?:string;dirty:boolean;updatedAt:string};

export interface LakeProjectStore{
 list():Promise<SavedLakeProject[]>;
 get(id:string):Promise<SavedLakeProject|undefined>;
 put(project:SavedLakeProject):Promise<void>;
 remove(id:string):Promise<void>;
 getAutosave():Promise<LakeAutosave|undefined>;
 putAutosave(autosave:LakeAutosave):Promise<void>;
}

const DB_NAME='layered-map-studio';
const DB_VERSION=1;
const PROJECTS='lake-projects';
const SESSION='lake-session';
const AUTOSAVE_KEY='autosave';

// Stored records are re-validated on the way out, like every other persisted state in the studio.
export function reviveSavedProject(raw:unknown):SavedLakeProject|undefined{
 const o=raw&&typeof raw==='object'?raw as Record<string,unknown>:undefined;
 if(!o||typeof o.id!=='string'||!o.id)return undefined;
 try{
  const features=o.features?normalizeFeatures(o.features):undefined;
  return {
   id:o.id,
   name:typeof o.name==='string'&&o.name.trim()?o.name:'Untitled project',
   createdAt:typeof o.createdAt==='string'?o.createdAt:'',
   updatedAt:typeof o.updatedAt==='string'?o.updatedAt:'',
   appVersion:typeof o.appVersion==='string'?o.appVersion:'',
   project:normalizeMapProject(o.project),
   ...(features&&features.water.length+features.roads.length+features.places.length>0?{features}:{}),
  };
 }catch{return undefined}
}

function reviveAutosave(raw:unknown):LakeAutosave|undefined{
 const o=raw&&typeof raw==='object'?raw as Record<string,unknown>:undefined;
 if(!o)return undefined;
 try{
  const features=o.features?normalizeFeatures(o.features):undefined;
  return {
   project:normalizeMapProject(o.project),
   ...(features&&features.water.length+features.roads.length+features.places.length>0?{features}:{}),
   ...(typeof o.savedId==='string'?{savedId:o.savedId}:{}),
   ...(typeof o.savedName==='string'?{savedName:o.savedName}:{}),
   dirty:o.dirty===true,
   updatedAt:typeof o.updatedAt==='string'?o.updatedAt:'',
  };
 }catch{return undefined}
}

const request=<T>(r:IDBRequest<T>)=>new Promise<T>((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error??new Error('IndexedDB request failed.'))});

export function createIndexedDbProjectStore(factory:IDBFactory=globalThis.indexedDB):LakeProjectStore{
 let opening:Promise<IDBDatabase>|undefined;
 const db=()=>opening??=new Promise<IDBDatabase>((resolve,reject)=>{
  const open=factory.open(DB_NAME,DB_VERSION);
  open.onupgradeneeded=()=>{
   const d=open.result;
   if(!d.objectStoreNames.contains(PROJECTS))d.createObjectStore(PROJECTS,{keyPath:'id'});
   if(!d.objectStoreNames.contains(SESSION))d.createObjectStore(SESSION);
  };
  open.onsuccess=()=>resolve(open.result);
  open.onerror=()=>{opening=undefined;reject(open.error??new Error('Could not open the project store.'))};
  open.onblocked=()=>{opening=undefined;reject(new Error('The project store is open in an older tab; close it and reload.'))};
 });
 const run=async<T>(store:string,mode:IDBTransactionMode,work:(s:IDBObjectStore)=>IDBRequest<T>)=>{
  const tx=(await db()).transaction(store,mode);
  // A write only counts once its transaction commits (a full disk aborts it after the request
  // itself succeeded), so the handlers go on before anything is awaited.
  const committed=new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error??new Error('Saving failed.'));tx.onabort=()=>reject(tx.error??new Error('Saving was aborted (storage full?).'))});
  const result=await request(work(tx.objectStore(store)));
  if(mode==='readwrite')await committed;else committed.catch(()=>{});
  return result;
 };
 return {
  async list(){
   const all=await run(PROJECTS,'readonly',s=>s.getAll() as IDBRequest<unknown[]>);
   return all.map(reviveSavedProject).filter((p):p is SavedLakeProject=>Boolean(p)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  },
  async get(id){return reviveSavedProject(await run(PROJECTS,'readonly',s=>s.get(id) as IDBRequest<unknown>))},
  async put(project){await run(PROJECTS,'readwrite',s=>s.put(project))},
  async remove(id){await run(PROJECTS,'readwrite',s=>s.delete(id))},
  async getAutosave(){return reviveAutosave(await run(SESSION,'readonly',s=>s.get(AUTOSAVE_KEY) as IDBRequest<unknown>))},
  async putAutosave(autosave){await run(SESSION,'readwrite',s=>s.put(autosave,AUTOSAVE_KEY))},
 };
}

// For environments with no IndexedDB (and tests that do not care about it): the same contract,
// nothing persisted past the page.
export function createMemoryProjectStore():LakeProjectStore{
 const projects=new Map<string,SavedLakeProject>();
 let autosave:LakeAutosave|undefined;
 const clone=<T>(v:T):T=>structuredClone(v);
 return {
  async list(){return [...projects.values()].map(clone).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))},
  async get(id){const p=projects.get(id);return p&&clone(p)},
  async put(p){projects.set(p.id,clone(p))},
  async remove(id){projects.delete(id)},
  async getAutosave(){return autosave&&clone(autosave)},
  async putAutosave(a){autosave=clone(a)},
 };
}

export const createProjectStore=():LakeProjectStore=>typeof indexedDB==='undefined'?createMemoryProjectStore():createIndexedDbProjectStore();

// ---- Project files -------------------------------------------------------------------------------
// A saved project as a file, for a backup or for moving a project to another computer (browser
// storage stays in the browser it was saved in).

export const PROJECT_FILE_FORMAT='layered-map-studio.lake-project';

export function projectFileJson(saved:Pick<SavedLakeProject,'name'|'project'|'features'|'appVersion'>,savedAt=new Date().toISOString()):string{
 return JSON.stringify({format:PROJECT_FILE_FORMAT,schemaVersion:1,name:saved.name,savedAt,appVersion:saved.appVersion,project:saved.project,...(saved.features?{features:saved.features}:{})});
}

export function parseProjectFile(text:string):{name:string;project:MapProject;features?:ExtractedFeatures}{
 let raw:unknown;
 try{raw=JSON.parse(text)}catch{throw new Error('That file is not valid JSON.')}
 const o=raw&&typeof raw==='object'?raw as Record<string,unknown>:{};
 if(o.format!==PROJECT_FILE_FORMAT)throw new Error('That file is not a Layered Map Studio lake project.');
 if(o.schemaVersion!==1)throw new Error('That project file was saved by a newer version of the studio.');
 const features=o.features?normalizeFeatures(o.features):undefined;
 return {name:typeof o.name==='string'&&o.name.trim()?o.name.trim():'Imported project',project:normalizeMapProject(o.project),...(features&&features.water.length+features.roads.length+features.places.length>0?{features}:{})};
}

export const newProjectId=()=>`lake-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
