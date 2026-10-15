import {useState} from 'react';
import {act,renderHook,waitFor} from '@testing-library/react';
import {afterEach,describe,expect,it} from 'vitest';
import {defaultProject} from '../../src/state/defaultProject';
import {createMemoryProjectStore,type LakeProjectStore} from '../../src/state/projects/projectStore';
import {absorbMapReport,changedSince,replaceWarning,restoredDirty,sessionRecord} from '../../src/state/projects/sessionLogic';
import {useProjectSession} from '../../src/state/projects/useProjectSession';
import {loadTimer,pauseTimer,saveTimer,startTimer,emptyTimer,designTimerKey} from '../../src/production/estimate/designTimer';
import type {ExtractedFeatures,MapProject} from '../../src/types/project';
import {caldronFallsFeatures,caldronFallsProject} from '../fixtures/caldronFalls';

// The project session's unsaved-work rules: a session never saved counts too, New/Open/Import keep
// what they replace in a recovery slot, each project has its own design timer id, and the map
// settling into a project's view on load is not a change.

const empty:ExtractedFeatures={water:[],roads:[],places:[]};
const titled=(p:MapProject,text:string):MapProject=>({...p,title:{...p.title,text}});
afterEach(()=>{localStorage.clear()});

// The session the way App uses it: apply replaces the project and features in the same update.
function mount(store:LakeProjectStore){
 return renderHook(()=>{
  const[state,setState]=useState({project:defaultProject,features:empty});
  const session=useProjectSession({...state,defaultProject,apply:(project,features)=>setState({project,features:features??empty}),appVersion:'test',store});
  return {session,state,setState};
 });
}

describe('session rules',()=>{
 it('asks before replacing unsaved work, saved before or not, and only then',()=>{
  expect(replaceWarning({dirty:false},'new')).toBeUndefined();
  expect(replaceWarning({id:'a',name:'Mary Lake',dirty:false},'open','Hamilton')).toBeUndefined();
  expect(replaceWarning({dirty:true},'new')).toBe('Start a new project? This map has not been saved and will be replaced. You can get it back once with Recover last session.');
  expect(replaceWarning({id:'a',name:'Mary Lake',dirty:true},'open','Hamilton')).toBe('Open Hamilton? Your unsaved changes to Mary Lake will be replaced. You can get them back once with Recover last session.');
  expect(replaceWarning({dirty:true},'import','hamilton.lmsproject.json')).toMatch(/^Import hamilton\.lmsproject\.json\? This map has not been saved/);
 });

 it('an old unsaved autosave with geography restores as unsaved work; a saved, clean one does not',()=>{
  expect(restoredDirty({project:defaultProject,features:caldronFallsFeatures,dirty:false,updatedAt:''})).toBe(true);
  expect(restoredDirty({project:defaultProject,dirty:false,updatedAt:''})).toBe(false);
  expect(restoredDirty({project:defaultProject,features:caldronFallsFeatures,savedId:'lake-1',dirty:false,updatedAt:''})).toBe(false);
 });

 it('absorbs the map\'s load report only while nothing has changed, even when React repeats the updater',()=>{
  const base={project:defaultProject,features:empty};
  const settled={...defaultProject,map:{...defaultProject.map,zoom:11.2}};
  const once=absorbMapReport(base,defaultProject,settled)!;
  expect(changedSince(once,settled,empty)).toBe(false);
  // StrictMode runs the updater twice: the second result replaces the first.
  const again={...defaultProject,map:{...defaultProject.map,zoom:11.2}};
  expect(changedSince(absorbMapReport(once,defaultProject,again),again,empty)).toBe(false);
  // After an edit the report is a change like any other.
  const edited=titled(defaultProject,'Edited');
  expect(absorbMapReport(base,edited,{...edited,map:settled.map})).toBe(base);
  expect(absorbMapReport(undefined,defaultProject,settled)).toBeUndefined();
 });
});

describe('useProjectSession',()=>{
 it('a session never saved has unsaved work after an edit; New keeps it recoverable and Recover swaps it back',async()=>{
  const store=createMemoryProjectStore();
  const {result}=mount(store);
  await waitFor(()=>expect(result.current.session.ready).toBe(true));
  expect(result.current.session.current.dirty).toBe(false);
  act(()=>result.current.setState({project:titled(caldronFallsProject,'Mary Lake'),features:caldronFallsFeatures}));
  await waitFor(()=>expect(result.current.session.current.dirty).toBe(true));
  const firstTimer=result.current.session.current.timerId;
  await act(()=>result.current.session.newProject());
  expect(result.current.state.project).toBe(defaultProject);
  expect(result.current.session.current).toMatchObject({dirty:false});
  // A new project has its own timer.
  expect(result.current.session.current.timerId).not.toBe(firstTimer);
  expect(result.current.session.recovery).toBeDefined();
  expect((await store.getRecovery())!.project.title.text).toBe('Mary Lake');
  // Moments later the autosave holds the new project; the recovery slot still has Mary Lake.
  await act(()=>result.current.session.recover());
  expect(result.current.state.project.title.text).toBe('Mary Lake');
  expect(result.current.state.features).toEqual(caldronFallsFeatures);
  expect(result.current.session.current).toMatchObject({dirty:true,timerId:firstTimer});
  // The session it replaced was empty, so there is nothing left to recover.
  expect(result.current.session.recovery).toBeUndefined();
  expect(await store.getRecovery()).toBeUndefined();
 });

 it('Open and Import over unsaved work keep it in the recovery slot; a clean saved project is not kept',async()=>{
  const store=createMemoryProjectStore();
  await store.put({id:'lake-saved',name:'Hamilton',createdAt:'2026-10-15T00:00:00Z',updatedAt:'2026-10-15T00:00:00Z',appVersion:'test',project:titled(caldronFallsProject,'Hamilton'),features:caldronFallsFeatures});
  const {result}=mount(store);
  await waitFor(()=>expect(result.current.session.ready).toBe(true));
  act(()=>result.current.setState(s=>({...s,project:titled(s.project,'Unsaved one')})));
  await waitFor(()=>expect(result.current.session.current.dirty).toBe(true));
  await act(()=>result.current.session.open('lake-saved'));
  expect(result.current.session.current).toMatchObject({id:'lake-saved',dirty:false,timerId:'lake-saved'});
  expect((await store.getRecovery())!.project.title.text).toBe('Unsaved one');
  // Opening another project over a clean one leaves the recovery slot alone.
  await act(()=>result.current.session.newProject());
  expect((await store.getRecovery())!.project.title.text).toBe('Unsaved one');
  act(()=>result.current.setState(s=>({...s,project:titled(s.project,'Second unsaved')})));
  await waitFor(()=>expect(result.current.session.current.dirty).toBe(true));
  const file=JSON.stringify({format:'layered-map-studio.lake-project',schemaVersion:1,name:'From file',project:titled(caldronFallsProject,'From file')});
  await act(async()=>{expect(await result.current.session.importFile(file)).toBe(true)});
  expect(result.current.state.project.title.text).toBe('From file');
  expect((await store.getRecovery())!.project.title.text).toBe('Second unsaved');
 });

 it('saving carries the design time to the saved project\'s own timer',async()=>{
  const {result}=mount(createMemoryProjectStore());
  await waitFor(()=>expect(result.current.session.ready).toBe(true));
  const unsaved=result.current.session.current.timerId;
  const t=pauseTimer(startTimer(emptyTimer(),0),20*60_000);
  saveTimer(t,unsaved);
  await act(()=>result.current.session.save('Mary Lake 14x11'));
  const {id,timerId}=result.current.session.current;
  expect(timerId).toBe(id);
  expect(loadTimer(id!)).toEqual(t);
  expect(localStorage.getItem(designTimerKey(unsaved))).not.toBeNull();
 });

 it('the autosave carries an unsaved session\'s timer id, so a reload keeps its time',async()=>{
  const store=createMemoryProjectStore();
  await store.putAutosave(sessionRecord(titled(defaultProject,'Mary Lake'),empty,{dirty:true,timerId:'unsaved-abc'}));
  const {result}=mount(store);
  await waitFor(()=>expect(result.current.session.ready).toBe(true));
  expect(result.current.session.current).toMatchObject({dirty:true,timerId:'unsaved-abc'});
 });

 it('the map settling into an opened project\'s view does not make it unsaved; a later move does',async()=>{
  const store=createMemoryProjectStore();
  // Saved with no geography: when it opens, the map loads and reports its view and crop.
  await store.put({id:'lake-plain',name:'Plain',createdAt:'',updatedAt:'2026-10-15T00:00:00Z',appVersion:'test',project:titled(defaultProject,'Plain')});
  const {result}=mount(store);
  await waitFor(()=>expect(result.current.session.ready).toBe(true));
  await act(()=>result.current.session.open('lake-plain'));
  const report=(zoom:number)=>act(()=>result.current.setState(s=>{const next={...s.project,map:{...s.project.map,zoom}};result.current.session.absorbMapReport(s.project,next);return {...s,project:next}}));
  await report(11.4);
  await act(()=>new Promise(r=>setTimeout(r,0)));
  expect(result.current.session.current.dirty).toBe(false);
  act(()=>result.current.setState(s=>({...s,project:{...s.project,map:{...s.project.map,zoom:13}}})));
  await waitFor(()=>expect(result.current.session.current.dirty).toBe(true));
 });
});
