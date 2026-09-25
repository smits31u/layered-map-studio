import ClipperLib from 'clipper-lib';
import {beforeAll,describe,expect,it} from 'vitest';
import type {MultiPolygonMm} from '../../src/geometry/shoreline/polygonEngine';
import {areaMm2,clip,toPaths} from '../../src/geometry/terrain/nestedBands';
import type {CaptureMapFeature} from '../../src/ornament/capture/mapCapture';
import {getLoadedFont} from '../../src/text/fontRegistry';
import {discoverCaptureLayers,extractTopoLabels,TopoCaptureError,type TopoCapture} from '../../src/topo/capture/topoCapture';
import {createDefaultTopoProject} from '../../src/topo/defaults';
import {buildFrame} from '../../src/topo/features/frame';
import {placeLabels} from '../../src/topo/features/labels';
import {buildOverlay,type OverlayCache,type OverlaySettings} from '../../src/topo/features/overlay';
import {boardProjection} from '../../src/topo/features/projection';
import {buildTopoRoads,roadCentrelines,topoRoadWidthMm} from '../../src/topo/features/roads';
import {buildRouteGeometry,projectRouteLines} from '../../src/topo/features/route';
import {buildTitle} from '../../src/topo/features/title';
import {terrainRunKey} from '../../src/topo/regeneration';
import {topoReducer,type TopoAction} from '../../src/topo/store';
import {boardRectangle} from '../../src/topo/terrain/bands';
import {freezeTerrainView,generateTerrain} from '../../src/topo/terrain/pipeline';
import {frameBounds,mercatorX,mercatorY} from '../../src/topo/terrain/tiles';
import type {TopoProject,TopoRoute} from '../../src/topo/types';
import {clampTopoProject} from '../../src/topo/validation';
import {flattenGeometry,geometryFingerprint} from '../helpers/terrarium';
import {loadFixtureTiles,loadTopoFixture,replayCapture,replayMap} from '../helpers/topoFixtures';
import {captureTopoFeatures} from '../../src/topo/capture/topoCapture';

// Phase 3's vector features: capture and dedupe, roads, labels, frame, title, the GPX route, and the
// overlay cache that keeps them from ever regenerating terrain.
//
// The dense-city golden is real (tests/fixtures/topo/README.md): downtown San Francisco at the plan's
// default zoom 14 on a 9 in board, recorded through the real MapLibre, the real OpenFreeMap basemap
// and captureTopoFeatures itself, centred on a vector-tile corner so the capture spans four tiles.

const HEAVY=120_000;
const inter=()=>getLoadedFont('inter')!;
const finite=(g:MultiPolygonMm)=>g.every(p=>p.every(r=>r.every(([x,y])=>Number.isFinite(x)&&Number.isFinite(y))));
const within=(g:MultiPolygonMm,W:number,H:number,eps=1e-6)=>g.every(p=>p.every(r=>r.every(([x,y])=>x>=-eps&&y>=-eps&&x<=W+eps&&y<=H+eps)));
const overlap=(a:MultiPolygonMm,b:MultiPolygonMm)=>a.length&&b.length?areaMm2(clip(ClipperLib.ClipType.ctIntersection,a,toPaths(b),ClipperLib.PolyFillType.pftEvenOdd,'test','test')):0;
const pathNumbers=(d:string)=>(d.match(/-?\d+(\.\d+)?(e-?\d+)?/gi)??[]).map(Number);

describe('capture layers are discovered by source-layer',()=>{
 it('finds water fills, road lines and label symbols in the real basemap style, and nothing else',()=>{
  const style=loadTopoFixture('sf-city').style;
  const layers=discoverCaptureLayers(style);
  const byId=new Map(style.layers!.map(l=>[l.id,l]));
  expect(layers.water.length).toBeGreaterThan(0);
  expect(layers.roads.length).toBeGreaterThan(10);
  expect(layers.labels.length).toBeGreaterThan(0);
  for(const id of layers.water)expect(byId.get(id)).toMatchObject({type:'fill','source-layer':'water'});
  for(const id of layers.roads)expect(byId.get(id)).toMatchObject({type:'line','source-layer':'transportation'});
  for(const id of layers.labels)expect(['place','poi']).toContain(byId.get(id)!['source-layer']);
 });
 it('refuses a style with no water or roads, naming what is missing',()=>{
  const style={sources:{s:{type:'vector'}},layers:[{id:'roads',type:'line',source:'s','source-layer':'transportation'}]};
  expect(()=>discoverCaptureLayers(style)).toThrow(TopoCaptureError);
  expect(()=>discoverCaptureLayers(style)).toThrow(/no water/);
  // A raster or GeoJSON layer that happens to be called "water" is not the vector water layer.
  expect(()=>discoverCaptureLayers({sources:{s:{type:'raster'}},layers:[{id:'water',type:'fill',source:'s','source-layer':'water'}]})).toThrow(/no water or roads/);
 });
});

describe('golden: dense city (real, downtown San Francisco)',()=>{
 const fixture=loadTopoFixture('sf-city');
 let capture:TopoCapture;
 beforeAll(async()=>{capture=(await replayCapture(fixture)).capture},HEAVY);

 it('replays to exactly what the browser captured, with thousands of cross-layer duplicates removed',()=>{
  expect(capture.features.counts).toEqual(fixture.expected.counts);
  expect(capture.features.roads).toHaveLength(fixture.expected.roads);
  expect(capture.labels).toHaveLength(fixture.expected.labels);
  expect(capture.view).toEqual(fixture.expected.view);
  // Road casings and fills are separate style layers over one feature: every road came back more
  // than once, and exactly one of each survives.
  expect(capture.features.counts.duplicateRoads).toBe(2498);
  expect(capture.features.roads).toHaveLength(7059);
  // The frame sits on a vector-tile corner, so the capture spans four tiles.
  const {west,east,north,south}=capture.view.bounds,n=2**14;
  expect(Math.floor(mercatorX(west)*n)).not.toBe(Math.floor(mercatorX(east)*n));
  expect(Math.floor(mercatorY(north)*n)).not.toBe(Math.floor(mercatorY(south)*n));
 });

 it('dedupes tile-seam re-decodings (sub-quantum jitter, reversed, repeated across tiles) without merging distinct roads',async()=>{
  // The ornament's dedupe pattern, on real data: the same road decoded by a neighbouring tile agrees
  // to within a fraction of a quantum and may run the other way.
  const roads=fixture.rendered.features.filter(f=>f.sourceLayer==='transportation'&&f.geometry.type==='LineString').slice(0,200);
  const jittered:CaptureMapFeature[]=roads.map((f,i)=>({...f,geometry:{type:'LineString',coordinates:((f.geometry.coordinates as [number,number][]).map(([x,y])=>[x+1e-11,y-1e-11]) as [number,number][])[i%2?'reverse':'slice']()}}));
  const labelCopies=fixture.rendered.labels.map(f=>({...f,geometry:{type:'Point',coordinates:[(f.geometry.coordinates as number[])[0]+1e-11,(f.geometry.coordinates as number[])[1]]}}));
  const augmented={...fixture,rendered:{features:[...fixture.rendered.features,...jittered],labels:[...fixture.rendered.labels,...labelCopies]}};
  const {capture:again}=await captureTopoFeatures(replayMap(augmented),{...fixture.request,now:()=>0});
  expect(again.features.roads).toHaveLength(capture.features.roads.length);
  expect(again.features.counts.duplicateRoads).toBe(capture.features.counts.duplicateRoads+jittered.length);
  expect(again.labels).toHaveLength(capture.labels.length);
  expect(again.duplicateLabels).toBe(labelCopies.length);
  // A road moved by a real distance (a metre) is a different road and is kept.
  const moved={...fixture,rendered:{features:[...fixture.rendered.features,{...roads[0],geometry:{type:'LineString',coordinates:(roads[0].geometry.coordinates as [number,number][]).map(([x,y])=>[x+1e-5,y])}}],labels:fixture.rendered.labels}};
  const {capture:kept}=await captureTopoFeatures(replayMap(moved),{...fixture.request,now:()=>0});
  expect(kept.features.roads).toHaveLength(capture.features.roads.length+1);
 },HEAVY);

 it('filters roads by the Low/Medium/High tiers and draws each class at its physical width',()=>{
  const classes=(detail:'low'|'medium'|'high')=>roadCentrelines(capture.features.roads,capture.view,detail).map(g=>g.roadClass).sort();
  expect(classes('low')).toEqual(['secondary']);
  expect(classes('medium')).toEqual(['minor','secondary','tertiary']);
  expect(classes('high')).toEqual(['minor','path','secondary','service','tertiary']);
  // Transit rail is on the transportation layer and is not a road at any detail.
  expect(capture.features.roads.some(r=>r.roadClass==='transit')).toBe(true);
  expect(classes('high')).not.toContain('transit');
  // The ornament's mm table, scaled by √(228.6 / 101.6) = 1.5 for a 9 in board — not style pixels.
  const w=(c:string,s=1)=>topoRoadWidthMm(c,capture.view,s);
  expect(w('secondary')).toBeCloseTo(.9,9);
  expect(w('tertiary')).toBeCloseTo(.75,9);
  expect(w('minor')).toBeCloseTo(.63,9);
  expect(w('service')).toBeCloseTo(.48,9);
  expect(w('path')).toBeCloseTo(.39,9);
  expect(w('path',2)).toBeCloseTo(.78,9);
  // Widths do not depend on the map zoom the capture was taken at.
  const zoomedOut={...capture.view,zoom:12};
  expect(topoRoadWidthMm('minor',zoomedOut,1)).toBe(w('minor'));
 });

 it('buffers, unions and repairs roads, more of them at each tier, all finite and on the board',()=>{
  const land=boardRectangle(capture.view.widthMm,capture.view.heightMm);
  const layers=(['low','medium','high'] as const).map(detail=>buildTopoRoads(capture.features.roads,capture.view,{detail,thicknessScale:1},land));
  expect(layers[0].metrics.finalAreaMm2).toBeLessThan(layers[1].metrics.finalAreaMm2);
  expect(layers[1].metrics.finalAreaMm2).toBeLessThan(layers[2].metrics.finalAreaMm2);
  for(const layer of layers){
   expect(finite(layer.geometry)).toBe(true);
   expect(within(layer.geometry,capture.view.widthMm,capture.view.heightMm)).toBe(true);
  }
  expect(layers[2].metrics.widthsMm.map(x=>+x.toFixed(4))).toEqual([.39,.48,.63,.75,.9]);
  const numbers:number[]=[];flattenGeometry(layers[2].geometry,numbers);
  expect(geometryFingerprint({numbers})).toBe(ROADS_HIGH_FINGERPRINT);
 },HEAVY);

 it('at the default road thickness (1×, the project default) reproduces the pinned golden exactly',()=>{
  const project=createDefaultTopoProject();
  expect(project.roads.thicknessScale).toBe(1);
  const land=boardRectangle(capture.view.widthMm,capture.view.heightMm);
  const numbers:number[]=[];
  flattenGeometry(buildTopoRoads(capture.features.roads,capture.view,{detail:'high',thicknessScale:project.roads.thicknessScale},land).geometry,numbers);
  // Pinned before the thickness control's range was touched: 1× is the width table, unchanged.
  expect(geometryFingerprint({numbers})).toBe(ROADS_HIGH_FINGERPRINT);
 },HEAVY);

 it('reports minimum-feature problems instead of hiding them',()=>{
  const land=boardRectangle(capture.view.widthMm,capture.view.heightMm);
  // High detail downtown: sidewalks beside streets leave slivers too small to stand.
  const high=buildTopoRoads(capture.features.roads,capture.view,{detail:'high',thicknessScale:1},land);
  expect(high.warnings.map(w=>w.code)).toContain('road-gaps-filled');
  expect(high.metrics.filledHoles).toBeGreaterThan(10);
  // Half the thickness — the control's minimum — pushes the thinnest class under the engravable minimum.
  const thin=buildTopoRoads(capture.features.roads,capture.view,{detail:'high',thicknessScale:.5},land);
  const floor=thin.warnings.find(w=>w.code==='road-width-floor');
  expect(floor?.message).toMatch(/path/);
  expect(floor?.message).toMatch(/0\.25 mm/);
  // Labels below the repository's minimum engraved letter size.
  const small=placeLabels(capture.labels,capture.view,inter(),{sizeMm:2,insetMm:0,water:[],keepOut:[]});
  expect(small.warnings.map(w=>w.code)).toContain('label-size-below-minimum');
 },HEAVY);

 it('places only place names by default: points of interest are a separate toggle, off',()=>{
  const project=createDefaultTopoProject();
  expect(project.labels).toMatchObject({enabled:true,poiEnabled:false});
  const settings={roads:project.roads,labels:project.labels,frame:project.frame,title:project.title,route:null};
  const byDefault=buildOverlay({capture,view:capture.view,water:[],settings,font:getLoadedFont}).overlay.labels.layer!.placed;
  expect(byDefault.length).toBeGreaterThan(0);
  expect(byDefault.every(label=>label.kind==='place')).toBe(true);
  const withPoi=buildOverlay({capture,view:capture.view,water:[],settings:{...settings,labels:{...project.labels,poiEnabled:true}},font:getLoadedFont}).overlay.labels.layer!.placed;
  expect(withPoi.some(label=>label.kind==='poi')).toBe(true);
  const poiOnly=buildOverlay({capture,view:capture.view,water:[],settings:{...settings,labels:{...project.labels,enabled:false,poiEnabled:true}},font:getLoadedFont}).overlay;
  expect(poiOnly.labels.visible).toBe(true);
  expect(poiOnly.labels.layer!.placed.every(label=>label.kind==='poi')).toBe(true);
  // A stored project from before the toggle existed opens with POIs off.
  expect(clampTopoProject({...project,labels:{enabled:true,sizeMm:3}} as unknown as TopoProject).labels.poiEnabled).toBe(false);
 });

 it('places labels as glyph paths, highest priority first, never overlapping, inside the frame',()=>{
  const title=buildTitle({text:'San Francisco',fontId:'inter',sizeMm:10,dxMm:0,dyMm:0},228.6,228.6,6,inter(),[]).title!;
  const layer=placeLabels(capture.labels,capture.view,inter(),{sizeMm:3,insetMm:6,water:[],keepOut:[title.box]});
  const names=layer.placed.map(l=>l.name);
  expect(names[0]).toBe('San Francisco');
  expect(names).toEqual(expect.arrayContaining(['Chinatown','Tenderloin','Union Square']));
  // Places outrank bus stops.
  const firstPoi=layer.placed.findIndex(l=>l.kind==='poi');
  expect(layer.placed.slice(firstPoi).every(l=>l.kind==='poi')).toBe(true);
  for(const [i,a] of layer.placed.entries()){
   expect(a.box.minX).toBeGreaterThanOrEqual(6);expect(a.box.minY).toBeGreaterThanOrEqual(6);
   expect(a.box.maxX).toBeLessThanOrEqual(228.6-6);expect(a.box.maxY).toBeLessThanOrEqual(228.6-6);
   for(const b of [...layer.placed.slice(i+1).map(l=>l.box),title.box])expect(a.box.minX<b.maxX&&b.minX<a.box.maxX&&a.box.minY<b.maxY&&b.minY<a.box.maxY).toBe(false);
   // Outlines, not text: closed subpaths with finite coordinates baked in, inside the label's box.
   expect(a.d).toMatch(/^M/);
   expect(a.d.split('M').filter(Boolean).every(sub=>sub.trimEnd().endsWith('Z'))).toBe(true);
   const numbers=pathNumbers(a.d);
   expect(numbers.every(Number.isFinite)).toBe(true);
   const xs=numbers.filter((_,k)=>k%2===0),ys=numbers.filter((_,k)=>k%2===1);
   expect(Math.min(...xs)).toBeGreaterThanOrEqual(a.box.minX-1e-6);expect(Math.max(...xs)).toBeLessThanOrEqual(a.box.maxX+1e-6);
   expect(Math.min(...ys)).toBeGreaterThanOrEqual(a.box.minY-1e-6);expect(Math.max(...ys)).toBeLessThanOrEqual(a.box.maxY+1e-6);
  }
  expect(layer.dropped.outside+layer.dropped.collision+layer.placed.length+layer.dropped.duplicate).toBe(capture.labels.length);
  expect(layer.placed.map(l=>l.d).join('')).toBe(placeLabels(capture.labels,capture.view,inter(),{sizeMm:3,insetMm:6,water:[],keepOut:[title.box]}).placed.map(l=>l.d).join(''));
 });
});

describe('coast: roads, labels and the title stay off the water',()=>{
 const fixture=loadTopoFixture('sf-coast');
 let capture:TopoCapture,land:MultiPolygonMm,water:MultiPolygonMm;
 beforeAll(async()=>{
  capture=(await replayCapture(fixture)).capture;
  const terrain=generateTerrain({view:capture.view,tiles:loadFixtureTiles('sf-coast'),water:[],capturedWater:capture.features.water,settings:{layerCount:1,coveragePercent:[100,50,25,12],contoursEnabled:false,contourCount:8,smoothingRadius:3,gridLongSide:300}});
  land=terrain.layers[0].geometry;water=terrain.water;
 },HEAVY);

 it('leaves the Golden Gate Bridge deck off the board, because the strait under it is cut out',()=>{
  const roads=buildTopoRoads(capture.features.roads,capture.view,{detail:'high',thicknessScale:1},land);
  expect(roads.warnings.map(w=>w.code)).toContain('roads-over-water');
  expect(roads.metrics.overWaterAreaMm2).toBeGreaterThan(10);
  expect(overlap(roads.geometry,water)).toBeLessThan(.01);
  expect(finite(roads.geometry)).toBe(true);
 },HEAVY);

 it('warns when the title is moved over water, and not when it sits on land or on the frame band',()=>{
  const at=boardProjection(capture.view);
  const [sx,sy]=at(-122.4880,37.8135);
  const over=buildTitle({text:'Golden Gate',fontId:'inter',sizeMm:8,dxMm:sx-228.6/2,dyMm:sy-(228.6-6-4-2)},228.6,228.6,0,inter(),water);
  expect(over.warnings.map(w=>w.code)).toContain('title-over-water');
  const onFrame=buildTitle({text:'Golden Gate',fontId:'inter',sizeMm:4,dxMm:0,dyMm:6},228.6,228.6,8,inter(),water);
  expect(onFrame.warnings).toEqual([]);
 },HEAVY);
});

describe('GPX route crossing the board',()=>{
 // A 9 in board at zoom 14 around the builder's default location.
 const view=freezeTerrainView([-88.207,45.3685],14,480,228.6,228.6);
 const {west,east,north,south}=frameBounds(view.center,view.zoom,view.frameWidthPx,view.frameHeightPx);
 const lng=(u:number)=>west+(east-west)*u,lat=(v:number)=>north+(south-north)*v;
 // Starts west of the board, crosses it, leaves through the north edge, comes back in from the north
 // and ends inside; a second segment lies wholly outside.
 const route:TopoRoute={segments:[
  [[lng(-.3),lat(.5)],[lng(.3),lat(.5)],[lng(.5),lat(-.2)],[lng(.7),lat(-.2)],[lng(.8),lat(.6)]],
  [[lng(1.2),lat(.1)],[lng(1.4),lat(.3)]],
 ],widthMm:.6,source:'track',pointCount:7};

 it('is clipped to the board: pieces end exactly on its edge and never cross the gap outside',()=>{
  const {lines,outsideBoard}=projectRouteLines(route,view);
  expect(outsideBoard).toBe(false);
  expect(lines).toHaveLength(2);
  const [a,b]=lines;
  expect(a[0][0]).toBeCloseTo(0,9);
  expect(a[a.length-1][1]).toBeCloseTo(0,9);
  expect(b[0][1]).toBeCloseTo(0,9);
  expect(b[b.length-1][0]).toBeCloseTo(.8*228.6,6);
  for(const line of lines)for(const [x,y] of line){expect(x).toBeGreaterThanOrEqual(-1e-9);expect(x).toBeLessThanOrEqual(228.6+1e-9);expect(y).toBeGreaterThanOrEqual(-1e-9);expect(y).toBeLessThanOrEqual(228.6+1e-9)}
 });

 it('buffers to its physical width on the board, round-capped inside and trimmed at the edge',()=>{
  const {lines,lengthMm}=projectRouteLines(route,view);
  const land=boardRectangle(228.6,228.6);
  const thin=buildRouteGeometry(lines,.6,land),wide=buildRouteGeometry(lines,2.4,land);
  expect(finite(thin.geometry)).toBe(true);
  expect(within(thin.geometry,228.6,228.6)).toBe(true);
  // Area ≈ length × width, plus the caps of the one end inside the board.
  expect(thin.areaMm2).toBeGreaterThan(lengthMm*.6*.98);
  expect(thin.areaMm2).toBeLessThan(lengthMm*.6+Math.PI*.3**2+1);
  expect(wide.areaMm2/thin.areaMm2).toBeCloseTo(4,0);
  expect(thin.warnings).toEqual([]);
 });

 it('is not drawn, with a note, when it misses the board entirely',()=>{
  const away:TopoRoute={...route,segments:[route.segments[1]]};
  expect(projectRouteLines(away,view)).toMatchObject({lines:[],outsideBoard:true});
 });
});

describe('frame',()=>{
 it('is the outer board minus the inner rectangle, and refuses to swallow the board',()=>{
  const {frame}=buildFrame(200,150,10);
  expect(areaMm2(frame!.geometry)).toBeCloseTo(200*150-180*130,9);
  expect(frame!.insetMm).toBe(10);
  expect(buildFrame(200,150,60).warnings.map(w=>w.code)).toEqual(['frame-too-thick']);
 });
});

// ---- The fast overlay-only redraw path ----

describe('what regenerates terrain',()=>{
 const base=createDefaultTopoProject();
 const route:TopoRoute={segments:[[[-88.21,45.36],[-88.2,45.37]]],widthMm:.6,source:'track',pointCount:2};
 const withRoute=topoReducer(base,{type:'setRoute',route});
 const key=terrainRunKey(withRoute,3);
 const overlayActions:TopoAction[]=[
  {type:'setRoads',patch:{enabled:false}},{type:'setRoads',patch:{detail:'low'}},{type:'setRoads',patch:{thicknessScale:2}},
  {type:'setLabels',patch:{enabled:false}},{type:'setLabels',patch:{sizeMm:5}},
  {type:'setFrame',patch:{enabled:true}},{type:'setFrame',patch:{thicknessMm:12}},
  {type:'setTitle',patch:{text:'Rib Mountain'}},{type:'setTitle',patch:{fontId:'cinzel'}},{type:'setTitle',patch:{sizeMm:14,dxMm:5,dyMm:-3}},
  {type:'setRouteWidth',widthMm:1.5},{type:'clearRoute'},
  {type:'setOutput',patch:{widthMm:300}},{type:'setDisplayUnit',value:'mm'},
 ];
 it.each(overlayActions.map(action=>[JSON.stringify(action),action] as const))('%s does not change the terrain run key',(_,action)=>{
  expect(terrainRunKey(topoReducer(withRoute,action),3)).toBe(key);
 });
 it('terrain settings and smoothing do change it',()=>{
  for(const action of [{type:'setTerrain',patch:{layerCount:3}},{type:'setTerrain',patch:{coveragePercent:[100,40,25,12]}},{type:'setTerrain',patch:{contoursEnabled:false}},{type:'setTerrain',patch:{contourCount:12}}] as TopoAction[])
   expect(terrainRunKey(topoReducer(withRoute,action),3)).not.toBe(key);
  expect(terrainRunKey(withRoute,4)).not.toBe(key);
 });
 it('keeps a clean route\'s arrays across reducer actions, so the overlay sees the same route',()=>{
  const next=topoReducer(withRoute,{type:'setLabels',patch:{sizeMm:4}});
  expect(next.route!.segments).toBe(withRoute.route!.segments);
 });
});

describe('overlay cache: toggles and size controls rebuild only what they change',()=>{
 const fixture=loadTopoFixture('sf-city');
 let capture:TopoCapture;
 const project=createDefaultTopoProject();
 const route:TopoRoute={segments:[[[-122.416,37.783],[-122.405,37.792],[-122.403,37.786]]],widthMm:.6,source:'track',pointCount:3};
 let settings:OverlaySettings;
 const water:MultiPolygonMm=[];
 let cache:OverlayCache;
 const step=(patch:Partial<OverlaySettings>)=>{
  settings={...settings,...patch};
  const started=performance.now();
  const out=buildOverlay({capture,view:capture.view,water,settings,font:getLoadedFont},cache);
  cache=out.cache;
  return {...out,ms:performance.now()-started};
 };
 beforeAll(async()=>{
  capture=(await replayCapture(fixture)).capture;
  settings={roads:project.roads,labels:project.labels,frame:project.frame,title:{...project.title,text:'Downtown'},route};
  cache={entries:{}};
  step({});
 },HEAVY);

 it.each([
  ['roads off',{roads:{...project.roads,enabled:false}},[]],
  ['roads on',{roads:{...project.roads,enabled:true}},[]],
  ['road thickness',{roads:{...project.roads,thicknessScale:2}},[]],
  // Which label kinds are placed is part of the labels key: turning place names off frees their space.
  ['place names off',{labels:{...project.labels,enabled:false}},['labels']],
  ['place names on',{labels:{...project.labels,enabled:true}},['labels']],
  ['points of interest on',{labels:{...project.labels,poiEnabled:true}},['labels']],
  ['points of interest off',{labels:{...project.labels,poiEnabled:false}},['labels']],
  ['route width',{route:{...route,widthMm:2}},[]],
  ['label size',{labels:{...project.labels,sizeMm:4.5}},['labels']],
  ['frame on',{frame:{enabled:true,thicknessMm:6}},['frame','title','labels']],
  ['frame thickness',{frame:{enabled:true,thicknessMm:9}},['frame','title','labels']],
  ['title text',{title:{...project.title,text:'Downtown San Francisco'}},['title','labels']],
  ['title size',{title:{...project.title,text:'Downtown San Francisco',sizeMm:12}},['title','labels']],
  ['road detail',{roads:{...project.roads,thicknessScale:2,detail:'medium'}},['roadLines','roadBridges']],
 ] as [string,Partial<OverlaySettings>,string[]][])('%s rebuilds exactly %j',(_,patch,expected)=>{
  const out=step(patch);
  // The real check: which parts were rebuilt, straight from the cache — not a timing.
  expect(out.rebuilt).toEqual(expected);
  // The plan's 100 ms is measured in the real page (docs/topo-implementation-status.md: 26–67 ms).
  // Under this suite's parallel workers a ~40 ms rebuild has been seen at 130 ms, so this bound only
  // catches a gross regression, such as an overlay change rebuilding the road centrelines.
  if(!expected.includes('roadLines'))expect(out.ms).toBeLessThan(500);
 });

 it('applies road thickness and route width as stroke widths without rebuilding the centrelines',()=>{
  const before=step({roads:{...project.roads,thicknessScale:1}});
  const after=step({roads:{...project.roads,thicknessScale:3},route:{...route,widthMm:2.5}});
  expect(after.rebuilt).toEqual(expect.not.arrayContaining(['roadLines','routeLines']));
  expect(after.overlay.roads.classes.map(c=>c.d)).toEqual(before.overlay.roads.classes.map(c=>c.d));
  for(const [i,c] of after.overlay.roads.classes.entries())expect(c.widthMm).toBeCloseTo(before.overlay.roads.classes[i].widthMm*3,9);
  expect(after.overlay.route!.widthMm).toBe(2.5);
 });

 it('a new capture or terrain run is a new input, and rebuilds what depends on it',()=>{
  const copy={...capture};
  const out=buildOverlay({capture:copy,view:capture.view,water,settings,font:getLoadedFont},cache);
  expect(out.rebuilt).toEqual(expect.arrayContaining(['roadLines','roadBridges','labels']));
  const wet:MultiPolygonMm=[[[[0,0],[10,0],[10,10],[0,10],[0,0]]]];
  const out2=buildOverlay({capture:copy,view:capture.view,water:wet,settings,font:getLoadedFont},out.cache);
  expect(out2.rebuilt).toEqual(['roadBridges','routeBridges','title','labels']);
 });
});

// Pinned from the first run on the recorded fixture; a change here is a change in road geometry.
const ROADS_HIGH_FINGERPRINT='a5ca7f12bd75324eb504580e766967e5340108899bfe546bc7815ba2e92635a5';
