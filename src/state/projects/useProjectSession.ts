import {useCallback,useEffect,useRef,useState} from 'react';
import type {ExtractedFeatures,MapProject} from '../../types/project';
import {adoptLegacyTimer,copyTimer,newUnsavedTimerId} from '../../production/estimate/designTimer';
import {createProjectStore,newProjectId,parseProjectFile,projectFileJson,type LakeAutosave,type LakeProjectStore,type SavedLakeProject} from './projectStore';
import {absorbMapReport,changedSince,hasGeography,restoredDirty,sessionRecord,type SessionBaseline,type SessionCurrent} from './sessionLogic';

// The lake tool's project session: which saved project is on screen, whether it has unsaved work,
// autosaving the session so a reload or a closed tab loses nothing, and the save / open / new /
// import / recover operations the sidebar and the projects dialog call.
//
// The app owns the project and its geography; this hook only watches them and hands them back
// through `apply` when a project is opened or the session restored.
//
// Unsaved work is tracked for sessions never saved too: any edit or generated geography since New.
// New, Open and Import put a session with unsaved work in the recovery slot before replacing it;
// the single autosave slot is overwritten moments later, so that slot is the only way back.

export const AUTOSAVE_DELAY_MS=800;

export type ApplyHow='restore'|'open'|'new';
export type SessionApply=(project:MapProject,features:ExtractedFeatures|undefined,how:ApplyHow)=>void;

export type ProjectSession={
 ready:boolean;
 // dirty: unsaved work, whether or not the project was ever saved. timerId: the design timer's id.
 current:SessionCurrent;
 // Set after a save/open/import/restore; read by the sidebar's status line.
 message:string;
 error:string;
 // The session New/Open/Import last replaced while it had unsaved work.
 recovery?:{name?:string;updatedAt:string};
 list():Promise<SavedLakeProject[]>;
 save(name?:string):Promise<void>;
 open(id:string):Promise<void>;
 newProject():Promise<void>;
 // Swaps the recovered session in; the one on screen takes its place in the slot if it has work.
 recover():Promise<void>;
 rename(id:string,name:string):Promise<void>;
 duplicate(id:string):Promise<void>;
 remove(id:string):Promise<void>;
 exportFile(id?:string):Promise<{name:string;json:string}>;
 // Resolves true when the file was imported and opened.
 importFile(text:string):Promise<boolean>;
 // The map's report of its own view and crop as it loads (not a move by the user): see absorbMapReport.
 absorbMapReport(previous:MapProject,next:MapProject):void;
};

const recoveryInfo=(r:LakeAutosave|undefined)=>r&&{...(r.savedName?{name:r.savedName}:{}),updatedAt:r.updatedAt};

export function useProjectSession({project,features,defaultProject,apply,appVersion,store:injected}:{project:MapProject;features:ExtractedFeatures;defaultProject:MapProject;apply:SessionApply;appVersion:string;store?:LakeProjectStore}):ProjectSession{
 const storeRef=useRef<LakeProjectStore>(injected??createProjectStore());
 const store=storeRef.current;
 const[ready,setReady]=useState(false);
 const[current,setCurrentState]=useState<SessionCurrent>(()=>({dirty:false,timerId:newUnsavedTimerId()}));
 const[recovery,setRecovery]=useState<ProjectSession['recovery']>();
 const[message,setMessage]=useState(''),[error,setError]=useState('');
 // The project and geography as last opened, saved, restored or started new. Anything else on screen
 // is unsaved work; no baseline means the session already has some.
 const baseline=useRef<SessionBaseline|undefined>(undefined);
 const latest=useRef({project,features});
 latest.current={project,features};
 const currentRef=useRef(current);
 const setCurrent=(next:SessionCurrent)=>{currentRef.current=next;setCurrentState(next)};
 const applyRef=useRef(apply);
 applyRef.current=apply;

 const settle=(p:MapProject,f:ExtractedFeatures|undefined)=>{baseline.current={project:p,features:f??{water:[],roads:[],places:[]}}};
 const fail=(e:unknown)=>{setError((e as Error)?.message??String(e))};
 // Before New, Open or Import replaces a session with unsaved work, it goes to the recovery slot.
 const keepForRecovery=async()=>{
  if(!currentRef.current.dirty)return;
  const record=sessionRecord(latest.current.project,latest.current.features,currentRef.current);
  await store.putRecovery(record);
  setRecovery(recoveryInfo(record));
 };

 // Restore the last session once, on mount.
 useEffect(()=>{
  let cancelled=false;
  Promise.all([store.getAutosave(),store.getRecovery().catch(()=>undefined)]).then(([saved,recovered])=>{
   if(cancelled)return;
   setRecovery(recoveryInfo(recovered));
   if(saved){
    const dirty=restoredDirty(saved);
    const timerId=saved.savedId??saved.timerId??newUnsavedTimerId();
    adoptLegacyTimer(timerId);
    applyRef.current(saved.project,saved.features,'restore');
    setCurrent({id:saved.savedId,name:saved.savedName,dirty,timerId});
    setMessage(saved.savedName?`Reopened ${saved.savedName}${dirty?' with your unsaved changes':''}.`:'Reopened your last session.');
    // A restored session with unsaved work keeps it; a clean one is its own baseline.
    if(!dirty)settle(saved.project,saved.features);
    else baseline.current=undefined;
   }else{
    // A fresh id, so the timer shown before this ran is reloaded with anything adopted.
    const timerId=newUnsavedTimerId();
    adoptLegacyTimer(timerId);
    setCurrent({...currentRef.current,timerId});
    settle(latest.current.project,latest.current.features);
   }
   setReady(true);
  },e=>{if(!cancelled){fail(e);settle(latest.current.project,latest.current.features);setReady(true)}});
  return ()=>{cancelled=true};
 },[store]);

 useEffect(()=>{
  if(!ready||currentRef.current.dirty)return;
  if(changedSince(baseline.current,project,features))setCurrent({...currentRef.current,dirty:true});
 },[project,features,ready]);

 // Autosave, debounced: typing a title writes once when the typing stops.
 useEffect(()=>{
  if(!ready)return;
  const timer=window.setTimeout(()=>{
   store.putAutosave(sessionRecord(latest.current.project,latest.current.features,currentRef.current)).catch(fail);
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
   const cur=currentRef.current;
   // A name means "save as": a new project. No name saves over the project that is open.
   const existing=!name&&cur.id?await store.get(cur.id):undefined;
   const saved=record(existing?.id??newProjectId(),name?.trim()||existing?.name||cur.name||'Untitled project',existing?.createdAt);
   await store.put(saved);
   // The design time so far belongs to the project it is saved as.
   copyTimer(cur.timerId,saved.id);
   settle(latest.current.project,latest.current.features);
   setCurrent({id:saved.id,name:saved.name,dirty:false,savedAt:saved.updatedAt,timerId:saved.id});
   setMessage(`Saved ${saved.name}.`);
  }catch(e){fail(e)}
 },[store,appVersion]);

 const open=useCallback(async(id:string)=>{
  setError('');
  try{
   const saved=await store.get(id);
   if(!saved)throw new Error('That project is no longer saved in this browser.');
   await keepForRecovery();
   applyRef.current(saved.project,saved.features,'open');
   settle(saved.project,saved.features);
   setCurrent({id:saved.id,name:saved.name,dirty:false,savedAt:saved.updatedAt,timerId:saved.id});
   setMessage(`Opened ${saved.name}.`);
  }catch(e){fail(e)}
 },[store]);

 const newProject=useCallback(async()=>{
  setError('');
  try{await keepForRecovery()}catch(e){fail(e);return}
  applyRef.current(defaultProject,undefined,'new');
  settle(defaultProject,undefined);
  // A new project starts its own design timer at zero.
  setCurrent({dirty:false,timerId:newUnsavedTimerId()});
  setMessage('New project.');
 },[defaultProject,store]);

 const recover=useCallback(async()=>{
  setError('');
  try{
   const recovered=await store.getRecovery();
   if(!recovered){setRecovery(undefined);return}
   const cur=currentRef.current;
   if(cur.dirty){const mine=sessionRecord(latest.current.project,latest.current.features,cur);await store.putRecovery(mine);setRecovery(recoveryInfo(mine))}
   else{await store.clearRecovery();setRecovery(undefined)}
   applyRef.current(recovered.project,recovered.features,'restore');
   baseline.current=undefined;
   setCurrent({id:recovered.savedId,name:recovered.savedName,dirty:true,timerId:recovered.savedId??recovered.timerId??newUnsavedTimerId()});
   setMessage(`Recovered ${recovered.savedName??'your unsaved map'}; it is not saved yet.`);
  }catch(e){fail(e)}
 },[store]);

 const rename=useCallback(async(id:string,name:string)=>{
  try{
   const saved=await store.get(id);if(!saved||!name.trim())return;
   await store.put({...saved,name:name.trim(),updatedAt:new Date().toISOString()});
   if(currentRef.current.id===id)setCurrent({...currentRef.current,name:name.trim()});
  }catch(e){fail(e)}
 },[store]);

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
   if(currentRef.current.id===id){setCurrent({dirty:true,timerId:currentRef.current.timerId});baseline.current=undefined;setMessage('Deleted the saved copy; what is on screen is now unsaved.')}
  }catch(e){fail(e)}
 },[store]);

 const exportFile=useCallback(async(id?:string)=>{
  const saved=id?await store.get(id):undefined;
  const cur=currentRef.current;
  const source=saved??{...record(cur.id??'',cur.name??'Untitled project')};
  return {name:source.name,json:projectFileJson(source)};
 },[store,appVersion]);

 const importFile=useCallback(async(text:string)=>{
  setError('');
  try{
   const parsed=parseProjectFile(text);
   const now=new Date().toISOString();
   const saved:SavedLakeProject={id:newProjectId(),name:parsed.name,createdAt:now,updatedAt:now,appVersion,project:parsed.project,...(parsed.features?{features:parsed.features}:{})};
   await store.put(saved);
   await keepForRecovery();
   applyRef.current(saved.project,saved.features,'open');
   settle(saved.project,saved.features);
   setCurrent({id:saved.id,name:saved.name,dirty:false,savedAt:now,timerId:saved.id});
   setMessage(`Imported ${saved.name}.`);
   return true;
  }catch(e){fail(e);return false}
 },[store,appVersion]);

 const absorb=useCallback((previous:MapProject,next:MapProject)=>{baseline.current=absorbMapReport(baseline.current,previous,next)},[]);

 return {ready,current,recovery,message,error,list:()=>store.list(),save,open,newProject,recover,rename,duplicate,remove,exportFile,importFile,absorbMapReport:absorb};
}
