import {describe,expect,it} from 'vitest';
import {createDefaultTopoProject} from '../../src/topo/defaults';
import {loadTopoProject,saveTopoProject,TOPO_STORAGE_KEY} from '../../src/topo/persistence';
import {topoReducer} from '../../src/topo/store';
import {MERCATOR_MAX_LATITUDE,type TopoProject,type TopoRoute} from '../../src/topo/types';
import {clampTopoProject,normalizeCenter,validRoute} from '../../src/topo/validation';
import {inchesToMm,mmToInches} from '../../src/utils/units';

// The topo builder's domain model: the plan's observed defaults, unit conversion, validation of
// everything the store can hold, the reducer, and localStorage persistence.

const route:TopoRoute={segments:[[[-88.1,45.1],[-88.2,45.2]]],widthMm:.6,source:'track',name:'Loop',pointCount:2};
const memory=()=>{const data=new Map<string,string>();return {data,getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v)},removeItem:(k:string)=>{data.delete(k)}}};

describe('defaults',()=>{
 it('match the plan\'s observed initial settings',()=>{
  const p=createDefaultTopoProject();
  expect(p.output).toEqual({widthMm:228.6,heightMm:228.6});
  expect(mmToInches(p.output.widthMm)).toBe(9);
  expect(p.viewport).toMatchObject({zoom:14,bearing:0,pitch:0});
  expect(p.terrain).toEqual({layerCount:1,coveragePercent:[100,50,25,12],contoursEnabled:true,contourCount:8});
  expect(p.roads).toMatchObject({enabled:true,detail:'high'});
  expect(p.labels.enabled).toBe(true);
  expect(p.route).toBeNull();
  expect(clampTopoProject(p)).toEqual(p);
 });
});

describe('units',()=>{
 it('round-trips inches and millimetres across the whole board range',()=>{
  // Each direction rounds to 9 decimals, so the round trip is exact to 8.
  for(let inches=1.97;inches<=23.62;inches+=.137)expect(mmToInches(inchesToMm(inches))).toBeCloseTo(inches,8);
  for(let mm=50;mm<=600;mm+=3.7)expect(inchesToMm(mmToInches(mm))).toBeCloseTo(mm,6);
 });
});

describe('validation',()=>{
 const d=createDefaultTopoProject();
 const clamp=(patch:Record<string,unknown>)=>clampTopoProject({...d,...patch} as TopoProject);

 it('clamps the board to 50–600 mm and replaces non-finite sizes with the default',()=>{
  expect(clamp({output:{widthMm:10,heightMm:900}}).output).toEqual({widthMm:50,heightMm:600});
  expect(clamp({output:{widthMm:Number.NaN,heightMm:'wide'}}).output).toEqual(d.output);
 });

 it('clamps zoom to 6–18 without snapping it',()=>{
  expect(clamp({viewport:{...d.viewport,zoom:2}}).viewport.zoom).toBe(6);
  expect(clamp({viewport:{...d.viewport,zoom:30}}).viewport.zoom).toBe(18);
  expect(clamp({viewport:{...d.viewport,zoom:12.37}}).viewport.zoom).toBe(12.37);
 });

 it('wraps longitude and clamps latitude to the Web Mercator limit',()=>{
  expect(normalizeCenter([190,10],[0,0])).toEqual([-170,10]);
  expect(normalizeCenter([-181,10],[0,0])[0]).toBeCloseTo(179,9);
  expect(normalizeCenter([180,10],[0,0])).toEqual([180,10]);
  expect(normalizeCenter([0,89],[0,0])).toEqual([0,MERCATOR_MAX_LATITUDE]);
  expect(normalizeCenter([Number.NaN,'x'],[5,6])).toEqual([5,6]);
  // In-range longitudes pass through bit-for-bit, not via the wrap arithmetic.
  for(const lng of [-90.1,-179.99,0.1,123.456789])expect(normalizeCenter([lng,0],[0,0])[0]).toBe(lng);
 });

 it('keeps higher terrain layers from covering more than lower ones',()=>{
  expect(clamp({terrain:{...d.terrain,coveragePercent:[100,30,60,90]}}).terrain.coveragePercent).toEqual([100,30,30,30]);
  expect(clamp({terrain:{...d.terrain,coveragePercent:[100,0,-5,500]}}).terrain.coveragePercent).toEqual([100,1,1,1]);
 });

 it('falls back to the default for values outside a union',()=>{
  const p=clamp({displayUnit:'furlongs',terrain:{...d.terrain,layerCount:7,contourCount:9},roads:{...d.roads,detail:'extreme'},title:{...d.title,fontId:'comic-sans'},compass:{...d.compass,position:'middle'}});
  expect([p.displayUnit,p.terrain.layerCount,p.terrain.contourCount,p.roads.detail,p.title.fontId,p.compass.position]).toEqual(['in',1,8,'high','inter','off']);
 });

 it('accepts a valid route and drops an invalid one whole',()=>{
  expect(validRoute(route,.6)).toEqual(route);
  expect(validRoute({...route,widthMm:9},.6)?.widthMm).toBe(2.5);
  for(const bad of [{...route,segments:[]},{...route,segments:[[[-88,45]]]},{...route,segments:[[[-88,45],[Number.NaN,45]]]},{...route,segments:[[[-88,45],[200,45]]]},'route',null])expect(validRoute(bad,.6)).toBeNull();
 });
});

describe('reducer',()=>{
 const d=createDefaultTopoProject();
 it('snaps the zoom control to 0.5 but keeps what the map reports',()=>{
  expect(topoReducer(d,{type:'setZoom',value:13.3}).viewport.zoom).toBe(13.5);
  expect(topoReducer(d,{type:'setViewport',center:[-89,46],zoom:13.37}).viewport).toMatchObject({center:[-89,46],zoom:13.37});
 });
 it('records a chosen place with its label',()=>{
  expect(topoReducer(d,{type:'selectPlace',label:'Crivitz',center:[-88,45.2]}).viewport).toMatchObject({center:[-88,45.2],selectedPlaceLabel:'Crivitz',zoom:14});
 });
 it('sets, replaces and clears the route',()=>{
  const loaded=topoReducer(d,{type:'setRoute',route});
  expect(loaded.route).toEqual(route);
  const replaced=topoReducer(loaded,{type:'setRoute',route:{...route,name:'Other',segments:[[[1,1],[2,2]]]}});
  expect(replaced.route?.name).toBe('Other');
  expect(topoReducer(replaced,{type:'clearRoute'}).route).toBeNull();
 });
 it('clamps board sizes and resets to exactly the defaults',()=>{
  expect(topoReducer(d,{type:'setOutput',patch:{widthMm:1000}}).output.widthMm).toBe(600);
  expect(topoReducer({...d,displayUnit:'mm',output:{widthMm:300,heightMm:200}},{type:'reset'})).toEqual(createDefaultTopoProject());
 });
});

describe('persistence',()=>{
 it('round-trips everything except the route, which is never written',()=>{
  const storage=memory();
  const project=topoReducer(topoReducer({...createDefaultTopoProject(),displayUnit:'mm',output:{widthMm:320,heightMm:180}},{type:'selectPlace',label:'Crivitz',center:[-88,45.2]}),{type:'setRoute',route});
  saveTopoProject(project,storage);
  expect(storage.data.get(TOPO_STORAGE_KEY)).not.toContain('Loop');
  expect(JSON.parse(storage.data.get(TOPO_STORAGE_KEY)!).route).toBeNull();
  expect(loadTopoProject(storage)).toEqual({...project,route:null});
 });

 it('treats a stored record as untrusted: merged over defaults and clamped',()=>{
  const storage=memory();
  storage.setItem(TOPO_STORAGE_KEY,JSON.stringify({schemaVersion:1,output:{widthMm:5000},viewport:{zoom:40,center:[400,95]},route:{segments:[[[0,0],[1,1]]]}}));
  const loaded=loadTopoProject(storage)!;
  expect(loaded.output).toEqual({widthMm:600,heightMm:228.6});
  expect(loaded.viewport.zoom).toBe(18);
  expect(loaded.viewport.center).toEqual([40,MERCATOR_MAX_LATITUDE]);
  expect(loaded.route).toBeNull();
 });

 it('ignores records it cannot trust at all, and storage that throws',()=>{
  for(const raw of ['{not json',JSON.stringify({schemaVersion:2}),JSON.stringify(null),'42']){const s=memory();s.setItem(TOPO_STORAGE_KEY,raw);expect(loadTopoProject(s)).toBeUndefined()}
  const throwing={getItem:()=>{throw new Error('denied')},setItem:()=>{throw new Error('quota')},removeItem:()=>{}};
  expect(loadTopoProject(throwing)).toBeUndefined();
  expect(()=>saveTopoProject(createDefaultTopoProject(),throwing)).not.toThrow();
 });
});
