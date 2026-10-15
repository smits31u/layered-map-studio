import {IDBFactory} from 'fake-indexeddb';
import {describe,expect,it} from 'vitest';
import {DEFAULT_SIMPLE_TERRAIN_CONTROLS} from '../../src/geometry/terrain/terrainParams';
import {defaultProject} from '../../src/state/defaultProject';
import {normalizeFeatures,normalizeMapProject} from '../../src/state/projects/normalize';
import {createIndexedDbProjectStore,createMemoryProjectStore,parseProjectFile,projectFileJson,type LakeProjectStore,type SavedLakeProject} from '../../src/state/projects/projectStore';
import type {MapProject} from '../../src/types/project';
import {caldronFallsFeatures,caldronFallsProject} from '../fixtures/caldronFalls';

// Saved lake projects: what is stored comes back exactly, what is malformed is repaired or refused,
// and project files move a project between browsers.

const full:MapProject={...caldronFallsProject,title:{...caldronFallsProject.title,text:'Caldron Falls'},markers:[{id:'marker-1',markerType:'cabin',sizeMm:9,rotationDeg:15,showLabel:true,label:'Our cabin',labelSizeMm:3,visible:true,operation:'engrave',keepOutEnabled:true,keepOutPaddingMm:2,lat:45.36,lng:-88.2}],overrides:{title:{xMm:120,yMm:250},compass:{rotationDeg:12,visible:false}},bathymetry:{...caldronFallsProject.bathymetry,mode:'procedural-terrain',terrain:{...DEFAULT_SIMPLE_TERRAIN_CONTROLS,seed:7}}};
const saved=(id:string,name:string,updatedAt:string):SavedLakeProject=>({id,name,createdAt:updatedAt,updatedAt,appVersion:'0.1.0',project:full,features:caldronFallsFeatures});

describe('normalizeMapProject',()=>{
 it('returns a valid project unchanged: defaults, a full Caldron Falls project with markers, overrides and terrain',()=>{
  expect(normalizeMapProject(JSON.parse(JSON.stringify(defaultProject)))).toEqual(defaultProject);
  expect(normalizeMapProject(JSON.parse(JSON.stringify(full)))).toEqual(full);
 });

 it('refuses something that is not a lake project',()=>{
  expect(()=>normalizeMapProject({version:2})).toThrow(/not a lake map project/);
  expect(()=>normalizeMapProject('hello')).toThrow();
 });

 it('repairs bad values field by field instead of failing the whole project',()=>{
  const p=normalizeMapProject({
   version:1,
   map:{latitude:'north',longitude:-88.2,zoom:99,bearing:0,crop:{nw:{lng:1,lat:2},ne:{lng:'x',lat:2}}},
   dimensions:{widthMm:10,heightMm:300,displayUnit:'furlongs',lockAspect:'yes'},
   shoreline:{enabledLayers:[true,false],preset:'enormous',waterMode:'all'},
   roads:{mode:'some',majorWidthMm:NaN,minorWidthMm:.3},
   title:{text:42,font:'comic-sans',backer:'rectangle'},
   compass:{position:'middle'},
   markers:[{id:'m1',markerType:'unicorn',sizeMm:'big'},{markerType:'pin'}],
   overrides:{title:{xMm:5,yMm:'far',visible:true},junk:7},
  });
  expect(p.map).toEqual({latitude:defaultProject.map.latitude,longitude:-88.2,zoom:24,bearing:0});
  expect(p.dimensions).toEqual({widthMm:defaultProject.dimensions.widthMm,heightMm:300,displayUnit:'in',lockAspect:true});
  expect(p.shoreline.enabledLayers).toEqual(defaultProject.shoreline.enabledLayers);
  expect(p.shoreline.preset).toBe('normal');
  expect(p.shoreline.waterMode).toBe('all');
  expect(p.roads).toEqual({mode:'all',majorWidthMm:defaultProject.roads.majorWidthMm,minorWidthMm:.3});
  expect(p.title).toMatchObject({text:'',font:'cinzel',backer:'rectangle'});
  expect(p.compass.position).toBe('top-left');
  expect(p.markers).toEqual([{id:'m1',markerType:'pin',sizeMm:8,rotationDeg:0,showLabel:false,labelSizeMm:3,visible:true,operation:'engrave',keepOutEnabled:false,keepOutPaddingMm:2}]);
  expect(p.overrides).toEqual({title:{xMm:5,visible:true}});
 });

 it('keeps only well-formed geography',()=>{
  const f=normalizeFeatures({water:[{id:'ok',rings:[[{lng:1,lat:1},{lng:2,lat:1},{lng:2,lat:2}]]},{id:'bad',rings:[[{lng:1,lat:1}]]},{rings:[]}],roads:[{id:'r',coordinates:[{lng:1,lat:1},{lng:'x',lat:2}]},{id:'r2',class:'secondary',name:'County C',coordinates:[{lng:1,lat:1},{lng:2,lat:2}]}],places:[{id:'p',name:'Town',class:'metropolis',coordinate:{lng:1,lat:1}},{id:'q'}]});
  expect(f.water.map(w=>w.id)).toEqual(['ok']);
  expect(f.roads).toEqual([{id:'r2',class:'secondary',name:'County C',coordinates:[{lng:1,lat:1},{lng:2,lat:2}]}]);
  expect(f.places).toEqual([{id:'p',name:'Town',class:'hamlet',coordinate:{lng:1,lat:1}}]);
  expect(normalizeFeatures(JSON.parse(JSON.stringify(caldronFallsFeatures)))).toEqual(caldronFallsFeatures);
 });
});

const contract=(name:string,make:()=>LakeProjectStore)=>describe(`${name} project store`,()=>{
 it('saves, lists newest first, gets and removes projects with their geography',async()=>{
  const store=make();
  await store.put(saved('a','Caldron 14x11','2026-10-14T10:00:00Z'));
  await store.put(saved('b','Mary Lake 14x11','2026-10-15T10:00:00Z'));
  expect((await store.list()).map(p=>p.name)).toEqual(['Mary Lake 14x11','Caldron 14x11']);
  const a=await store.get('a');
  expect(a?.project).toEqual(full);
  expect(a?.features).toEqual(caldronFallsFeatures);
  await store.put({...a!,name:'Renamed',updatedAt:'2026-10-16T00:00:00Z'});
  expect((await store.list())[0].name).toBe('Renamed');
  await store.remove('a');
  expect((await store.list()).map(p=>p.id)).toEqual(['b']);
  expect(await store.get('a')).toBeUndefined();
 });

 it('keeps the autosaved session',async()=>{
  const store=make();
  expect(await store.getAutosave()).toBeUndefined();
  await store.putAutosave({project:full,features:caldronFallsFeatures,savedId:'b',savedName:'Mary Lake 14x11',dirty:true,updatedAt:'2026-10-15T10:00:00Z'});
  expect(await store.getAutosave()).toEqual({project:full,features:caldronFallsFeatures,savedId:'b',savedName:'Mary Lake 14x11',dirty:true,updatedAt:'2026-10-15T10:00:00Z'});
 });
});

contract('IndexedDB',()=>createIndexedDbProjectStore(new IDBFactory()));
contract('In-memory',createMemoryProjectStore);

describe('IndexedDB persistence across reloads',()=>{
 it('a new store on the same database (a reload) sees what the old one saved',async()=>{
  const factory=new IDBFactory();
  await createIndexedDbProjectStore(factory).put(saved('a','Caldron 14x11','2026-10-14T10:00:00Z'));
  const reloaded=createIndexedDbProjectStore(factory);
  expect((await reloaded.list()).map(p=>p.name)).toEqual(['Caldron 14x11']);
 });

 it('skips a stored record that no longer validates instead of failing the whole list',async()=>{
  const factory=new IDBFactory(),store=createIndexedDbProjectStore(factory);
  await store.put(saved('a','Good','2026-10-14T10:00:00Z'));
  await store.put({id:'bad',name:'Broken',project:{version:9}} as unknown as SavedLakeProject);
  expect((await store.list()).map(p=>p.id)).toEqual(['a']);
 });
});

describe('project files',()=>{
 it('export then import gives back the same project and geography',()=>{
  const json=projectFileJson({name:'Caldron 14x11',project:full,features:caldronFallsFeatures,appVersion:'0.1.0'},'2026-10-15T00:00:00Z');
  expect(JSON.parse(json)).toMatchObject({format:'layered-map-studio.lake-project',schemaVersion:1,name:'Caldron 14x11'});
  expect(parseProjectFile(json)).toEqual({name:'Caldron 14x11',project:full,features:caldronFallsFeatures});
 });

 it('says what is wrong with a file it cannot import',()=>{
  expect(()=>parseProjectFile('nope')).toThrow(/not valid JSON/);
  expect(()=>parseProjectFile('{"format":"something-else"}')).toThrow(/not a Layered Map Studio lake project/);
  expect(()=>parseProjectFile('{"format":"layered-map-studio.lake-project","schemaVersion":2}')).toThrow(/newer version/);
  expect(()=>parseProjectFile('{"format":"layered-map-studio.lake-project","schemaVersion":1,"project":{"version":3}}')).toThrow(/not a lake map project/);
 });
});
