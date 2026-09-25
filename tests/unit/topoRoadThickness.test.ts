import {beforeAll,describe,expect,it} from 'vitest';
import type {MultiPolygonMm} from '../../src/geometry/shoreline/polygonEngine';
import {areaMm2} from '../../src/geometry/terrain/nestedBands';
import {MIN_ENGRAVABLE_WIDTH_MM,ROAD_WIDTH_TABLE_MM} from '../../src/ornament/geometry/roadWidths';
import {getLoadedFont} from '../../src/text/fontRegistry';
import type {TopoCapture} from '../../src/topo/capture/topoCapture';
import {createDefaultTopoProject} from '../../src/topo/defaults';
import {MIN_BRIDGE_TAB_WIDTH_MM,bridgeTabs,findBridgeSpans} from '../../src/topo/features/bridges';
import {buildOverlay,type OverlayCache} from '../../src/topo/features/overlay';
import {buildTopoRoads,roadBridgeCandidates,topoRoadWidthMm} from '../../src/topo/features/roads';
import {loadTopoProject,saveTopoProject} from '../../src/topo/persistence';
import {terrainRunKey} from '../../src/topo/regeneration';
import {topoReducer} from '../../src/topo/store';
import {generateTerrain} from '../../src/topo/terrain/pipeline';
import {TOPO_LIMITS} from '../../src/topo/types';
import {clampTopoProject} from '../../src/topo/validation';
import {loadFixtureTiles,loadTopoFixture,replayCapture} from '../helpers/topoFixtures';

// The road thickness control: a multiplier on the physical width table, 1× being the table itself.
// Bridge tabs are their road's width, so the same control decides how sturdy a bridge is. It is an
// overlay control: it rebuilds road and bridge geometry, never terrain.

const HEAVY=120_000;
const W=228.6,H=228.6;
let capture:TopoCapture,land:MultiPolygonMm,water:MultiPolygonMm;
beforeAll(async()=>{
 capture=(await replayCapture(loadTopoFixture('sf-coast'))).capture;
 const terrain=generateTerrain({view:capture.view,tiles:loadFixtureTiles('sf-coast'),water:[],capturedWater:capture.features.water,settings:{layerCount:1,coveragePercent:[100,50,25,12],contoursEnabled:false,contourCount:8,smoothingRadius:3,gridLongSide:300}});
 land=terrain.layers[0].geometry;water=terrain.water;
},HEAVY);

const spansAt=(scale:number)=>findBridgeSpans(roadBridgeCandidates(capture.features.roads,capture.view,'high',0,capture.tunnelRoadKeys).map(c=>({...c,widthMm:topoRoadWidthMm(c.tag!,capture.view,scale)})),water,W,H).spans;
const roadsAt=(scale:number)=>buildTopoRoads(capture.features.roads,capture.view,{detail:'high',thicknessScale:scale},land,{water,tunnelRoadKeys:capture.tunnelRoadKeys});

describe('1× is today\'s width table exactly',()=>{
 it('is the default, and every class is the table width times the board factor (√(228.6/101.6) = 1.5)',()=>{
  expect(createDefaultTopoProject().roads.thicknessScale).toBe(1);
  for(const [roadClass,base] of Object.entries(ROAD_WIDTH_TABLE_MM))expect(topoRoadWidthMm(roadClass,capture.view,1)).toBeCloseTo(Math.max(MIN_ENGRAVABLE_WIDTH_MM,base*1.5),12);
 });
 it('gives the Golden Gate\'s tabs the same widths as before the control was touched',()=>{
  const motorway=spansAt(1).filter(s=>s.tag==='motorway');
  expect(motorway).toHaveLength(2);
  for(const span of motorway)expect(span.widthMm).toBeCloseTo(1.35,12);
  expect(roadsAt(1).bridges).toMatchObject({spans:5,narrowestTabMm:.39});
  expect(roadsAt(1).bridges.widestTabMm).toBeCloseTo(1.35,12);
 },HEAVY);
});

describe('scaling moves roads and bridge tabs together',()=>{
 it.each([.5,2,3])('%s× scales every road class above the engraving floor by exactly that',scale=>{
  for(const [roadClass,base] of Object.entries(ROAD_WIDTH_TABLE_MM)){
   const width=topoRoadWidthMm(roadClass,capture.view,scale);
   if(base*1.5*scale>=MIN_ENGRAVABLE_WIDTH_MM)expect(width).toBeCloseTo(topoRoadWidthMm(roadClass,capture.view,1)*scale,12);
   else expect(width).toBe(MIN_ENGRAVABLE_WIDTH_MM);
  }
 });

 it.each([.5,2,3])('%s× widens (or narrows) the Golden Gate\'s bridge tabs with the road',scale=>{
  const base=spansAt(1).filter(s=>s.tag==='motorway'),scaled=spansAt(scale).filter(s=>s.tag==='motorway');
  // The same spans are found; only their width changes.
  expect(scaled.map(s=>s.lengthMm)).toEqual(base.map(s=>s.lengthMm));
  for(const [i,span] of scaled.entries()){
   expect(span.widthMm).toBeCloseTo(base[i].widthMm*scale,12);
   // The material itself: the tab's area grows with its width.
   const w=span.widthMm;
   expect(areaMm2(bridgeTabs([span]))).toBeCloseTo(span.lengthMm*w+Math.PI*(w/2)**2,0);
  }
 });

 it('in the fabricated roads too: tab widths, tab material and the engraved deck all follow the control',()=>{
  const [half,one,three]=[.5,1,3].map(roadsAt);
  expect(three.bridges.widestTabMm).toBeCloseTo(1.35*3,9);
  expect(three.bridges.narrowestTabMm).toBeCloseTo(.39*3,9);
  expect(half.bridges.widestTabMm).toBeCloseTo(1.35*.5,9);
  // Footpaths at 0.5× would be 0.195 mm; the engraving floor holds them at 0.25 mm.
  expect(half.bridges.narrowestTabMm).toBe(MIN_ENGRAVABLE_WIDTH_MM);
  expect(areaMm2(half.bridgeTabs)).toBeLessThan(areaMm2(one.bridgeTabs));
  expect(areaMm2(three.bridgeTabs)).toBeGreaterThan(2*areaMm2(one.bridgeTabs));
 },HEAVY);

 it('lets Ben lift the major spans past the ornament\'s 3 mm neck minimum, and says what is still thin',()=>{
  const narrow=(scale:number)=>roadsAt(scale).warnings.find(w=>w.code==='bridge-tab-narrow-road')?.message;
  // At 1×, all five spans are under 3 mm, the motorway's included.
  expect(narrow(1)).toMatch(/^5 road bridge tabs are as narrow as 0\.39 mm/);
  expect(narrow(1)).toMatch(/raise Road thickness to widen them/);
  // At 3× the motorway tabs are 4.05 mm; only the three footpath tabs (1.17 mm) are still under it.
  expect(1.35*3).toBeGreaterThan(MIN_BRIDGE_TAB_WIDTH_MM);
  expect(narrow(3)).toMatch(/^3 road bridge tabs are as narrow as 1\.17 mm/);
 },HEAVY);
});

describe('the control is clamped to 0.5×–3×',()=>{
 const set=(value:unknown)=>topoReducer(createDefaultTopoProject(),{type:'setRoads',patch:{thicknessScale:value as number}}).roads.thicknessScale;
 it('publishes its range as 0.5–3 in 0.05 steps',()=>{
  expect(TOPO_LIMITS.roadThicknessScale).toEqual({min:.5,max:3,step:.05});
 });
 it.each([[0,.5],[-2,.5],[.1,.5],[.5,.5],[1,1],[2.25,2.25],[3,3],[3.01,3],[100,3],[1e9,3]])('%s becomes %s',(value,expected)=>{
  expect(set(value)).toBe(expected);
 });
 it('falls back to 1× for anything that is not a finite number',()=>{
  for(const value of [Number.NaN,Number.POSITIVE_INFINITY,Number.NEGATIVE_INFINITY,'2',null,undefined])expect(set(value)).toBe(1);
 });
 it('clamps a stored project too, including one saved under the old 0.25–4× range',()=>{
  const memory=new Map<string,string>();
  const storage={getItem:(k:string)=>memory.get(k)??null,setItem:(k:string,v:string)=>{memory.set(k,v)},removeItem:(k:string)=>{memory.delete(k)}};
  for(const [stored,expected] of [[4,3],[.25,.5],[1.5,1.5]]){
   const project=createDefaultTopoProject();
   saveTopoProject({...project,roads:{...project.roads,thicknessScale:stored}},storage);
   expect(loadTopoProject(storage)!.roads.thicknessScale).toBe(expected);
  }
  expect(clampTopoProject({...createDefaultTopoProject(),roads:{enabled:true,detail:'high',thicknessScale:0}}).roads.thicknessScale).toBe(.5);
 });
});

describe('it never regenerates terrain',()=>{
 it('leaves the terrain run key alone at every value, clamped extremes included',()=>{
  const base=createDefaultTopoProject(),key=terrainRunKey(base,3);
  for(const value of [.5,.75,1,2,3,0,100,Number.NaN])expect(terrainRunKey(topoReducer(base,{type:'setRoads',patch:{thicknessScale:value}}),3)).toBe(key);
 });

 it('rebuilds no cached overlay part: roads and bridges take the new width as a stroke',()=>{
  const project=createDefaultTopoProject();
  const settings={roads:project.roads,labels:project.labels,frame:project.frame,title:project.title,route:null};
  let cache:OverlayCache={entries:{}};
  const first=buildOverlay({capture,view:capture.view,water,settings,font:getLoadedFont},cache);
  cache=first.cache;
  for(const scale of [.5,2,3,1]){
   const out=buildOverlay({capture,view:capture.view,water,settings:{...settings,roads:{...project.roads,thicknessScale:scale}},font:getLoadedFont},cache);
   cache=out.cache;
   expect(out.rebuilt).toEqual([]);
   const motorway=out.overlay.roads.bridges.find(b=>b.roadClass==='motorway')!;
   expect(motorway.widthMm).toBeCloseTo(1.35*scale,9);
   expect(motorway.d).toBe(first.overlay.roads.bridges.find(b=>b.roadClass==='motorway')!.d);
   const minor=out.overlay.roads.classes.find(c=>c.roadClass==='minor')!;
   expect(minor.widthMm).toBeCloseTo(.63*scale,9);
  }
 },HEAVY);
});
