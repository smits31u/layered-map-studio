import {useCallback,useEffect,useRef,useState} from 'react';
import type {ExtractedFeatures,MapProject} from '../../types/project';
import {createProjectStore,newProjectId,parseProjectFile,projectFileJson,type LakeProjectStore,type SavedLakeProject} from './projectStore';

// The lake tool's project session: which saved project is on screen, whether it has changed since it
// was saved, autosaving the session so a reload or a closed tab loses nothing, and the save / open /
// new / import operations the sidebar and the projects dialog call.
//
// The app owns the project and its geography; this hook only watches them and hands them back
// through `apply` when a project is opened or the session restored.

export const AUTOSAVE_DELAY_MS=800;

export type ApplyHow='restore'|'open'|'new';
export type SessionApply=(project:MapProject,features:ExtractedFeatures|undefined,how:ApplyHow)=>void;

export type ProjectSession={
 ready:boolean;
 current:{id?:string;name?:string;dirty:boolean;savedAt?:string};
 // Set after a save/open/import/restore; read by the sidebar's status line.
 message:string;
 error:string;
 list():Promise<SavedLakeProject[]>;
 save(name?:string):Promise<void>;
 open(id:string):Promise<void>;
 newProject():void;
 rename(id:string,name:string):Promise<void>;
 duplicate(id:string):Promise<void>;
 remove(id:string):Promise<void>;
 exportFile(id?:string):Promise<{name:string;json:string}>;
 // Resolves true when the file was imported and opened.
 importFile(text:string):Promise<boolean>;
};

const hasGeography=(f:ExtractedFeatures)=>f.water.length+f.roads.length+f.places.length>0;

export function useProjectSession({project,features,defaultProject,apply,appVersion,store:injected}:{project:MapProject;features:ExtractedFeatures;defaultProject:MapProject;apply:SessionApply;appVersion:string;store?:LakeProjectStore}):ProjectSession{
 const storeRef=useRef<LakeProjectStore>(injected??createProjectStore());
 const store=storeRef.current;
 const[ready,setReady]=useState(false);
 const[current,setCurrent]=useState<ProjectSession['current']>({dirty:false});
 const[message,setMessage]=useState(''),[error,setError]=useState('');
 // The project and geography as last opened, saved or restored. Anything else on screen is a change.
 const baseline=useRef<{project:MapProject;features:ExtractedFeatures}|undefined>(undefined);
 const latest=useRef({project,features});
 latest.current={project,features};
 const applyRef=useRef(apply);
 applyRef.current=apply;

 const settle=(p:MapProject,f:ExtractedFeatures|undefined)=>{baseline.current={project:p,features:f??{water:[],roads:[],places:[]}}};
 const fail=(e:unknown)=>{setError((e as Error)?.message??String(e))};

 // Restore the last session once, on mount.
 useEffect(()=>{
  let cancelled=false;
  store.getAutosave().then(saved=>{
   if(cancelled)return;
   if(saved){
    applyRef.current(saved.project,saved.features,'restore');
    setCurrent({id:saved.savedId,name:saved.savedName,dirty:saved.dirty});
    setMessage(saved.savedName?`Reopened ${saved.savedName}${saved.dirty?' with your unsaved changes':''}.`:'Reopened your last session.');
    // A restored session that was already dirty stays dirty; a clean one is its own baseline.
    if(!saved.dirty)settle(saved.project,saved.features);
    else baseline.current=undefined;
   }
   setReady(true);
  },e=>{if(!cancelled){fail(e);setReady(true)}});
  return ()=>{cancelled=true};
 },[store]);

 // Changes since the baseline mark the session dirty. Reference comparison is enough: the app makes
 // a new project or features object for every change and never mutates one in place.
 useEffect(()=>{
  if(!ready)return;
  const b=baseline.current;
  const changed=!b||b.project!==project||b.features!==features&&(hasGeography(features)||hasGeography(b.features));
  if(changed&&!current.dirty&&(current.id||b))setCurrent(c=>({...c,dirty:true}));
 },[project,features,ready]);

 // Autosave, debounced: typing a title writes once when the typing stops.
 useEffect(()=>{
  if(!ready)return;
  const timer=window.setTimeout(()=>{
   const {project:p,features:f}=latest.current;
   store.putAutosave({project:p,...(hasGeography(f)?{features:f}:{}),...(current.id?{savedId:current.id,savedName:current.name}:{}),dirty:current.dirty,updatedAt:new Date().toISOString()}).catch(fail);
  },AUTOSAVE_DELAY_MS);
  return ()=>window.clearTimeout(timer);
 },[project,features,current,ready,store]);

 const record=(id:string,name:string,createdAt?:string):SavedLakeProject=>{
  const {project:p,features:f}=latest.current,now=new Date().toISOString();
  return {id,name,createdAt:createdAt??now,updatedAt:now,appVersion,project:p,...(hasGeography(f)?{features:f}:{})};
 };

 const save=useCallback(async(name?:string)=>{
  setError('');
  try{
   // A name means "save as": a new project. No name saves over the project that is open.
   const existing=!name&&current.id?await store.get(current.id):undefined;
   const saved=record(existing?.id??newProjectId(),name?.trim()||existing?.name||current.name||'Untitled project',existing?.createdAt);
   await store.put(saved);
   settle(latest.current.project,latest.current.features);
   setCurrent({id:saved.id,name:saved.name,dirty:false,savedAt:saved.updatedAt});
   setMessage(`Saved ${saved.name}.`);
  }catch(e){fail(e)}
 },[current,store,appVersion]);

 const open=useCallback(async(id:string)=>{
  setError('');
  try{
   const saved=await store.get(id);
   if(!saved)throw new Error('That project is no longer saved in this browser.');
   applyRef.current(saved.project,saved.features,'open');
   settle(saved.project,saved.features);
   setCurrent({id:saved.id,name:saved.name,dirty:false,savedAt:saved.updatedAt});
   setMessage(`Opened ${saved.name}.`);
  }catch(e){fail(e)}
 },[store]);

 const newProject=useCallback(()=>{
  setError('');
  applyRef.current(defaultProject,undefined,'new');
  baseline.current=undefined;
  setCurrent({dirty:false});
  setMessage('New project.');
 },[defaultProject]);

 const rename=useCallback(async(id:string,name:string)=>{
  try{
   const saved=await store.get(id);if(!saved||!name.trim())return;
   await store.put({...saved,name:name.trim(),updatedAt:new Date().toISOString()});
   if(current.id===id)setCurrent(c=>({...c,name:name.trim()}));
  }catch(e){fail(e)}
 },[current.id,store]);

 const duplicate=useCallback(async(id:string)=>{
  try{
   const saved=await store.get(id);if(!saved)return;
   const now=new Date().toISOString();
   await store.put({...saved,id:newProjectId(),name:`${saved.name} copy`,createdAt:now,updatedAt:now});
  }catch(e){fail(e)}
 },[store]);

 const remove=useCallback(async(id:string)=>{
  try{
   await store.remove(id);
   // The project stays on screen as an unsaved one; nothing the user is looking at disappears.
   if(current.id===id){setCurrent({dirty:true});baseline.current=undefined;setMessage('Deleted the saved copy; what is on screen is now unsaved.')}
  }catch(e){fail(e)}
 },[current.id,store]);

 const exportFile=useCallback(async(id?:string)=>{
  const saved=id?await store.get(id):undefined;
  const source=saved??{...record(current.id??'',current.name??'Untitled project')};
  return {name:source.name,json:projectFileJson(source)};
 },[current,store,appVersion]);

 const importFile=useCallback(async(text:string)=>{
  setError('');
  try{
   const parsed=parseProjectFile(text);
   const now=new Date().toISOString();
   const saved:SavedLakeProject={id:newProjectId(),name:parsed.name,createdAt:now,updatedAt:now,appVersion,project:parsed.project,...(parsed.features?{features:parsed.features}:{})};
   await store.put(saved);
   applyRef.current(saved.project,saved.features,'open');
   settle(saved.project,saved.features);
   setCurrent({id:saved.id,name:saved.name,dirty:false,savedAt:now});
   setMessage(`Imported ${saved.name}.`);
   return true;
  }catch(e){fail(e);return false}
 },[store,appVersion]);

 return {ready,current,message,error,list:()=>store.list(),save,open,newProject,rename,duplicate,remove,exportFile,importFile};
}
