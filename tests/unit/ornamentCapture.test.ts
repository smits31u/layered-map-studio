import {describe,expect,it,vi} from 'vitest';
import {
 captureLayerIds,
 captureOrnamentFeatures,
 CaptureError,
 readViewport,
 waitForIdle,
 type CaptureMap,
 type CaptureMapFeature,
} from '../../src/ornament/capture/mapCapture';
import {ZeroSizedViewportError,MAPLIBRE_TILE_SIZE} from '../../src/ornament/geometry/mapProjection';
import {OPENFREEMAP} from '../../src/ornament/map/provider';
import {roadLayerId,WATER_LAYER_ID} from '../../src/ornament/map/style';
import {cityCapture,FIXTURE_CENTER,FIXTURE_ZOOM,lakeCapture} from '../fixtures/ornament/captures';
import {boundsFor} from '../helpers/ornamentCapture';

// The plan's §Feature capture, step by step:
//
//   1. wait for `map.isStyleLoaded()` and a settled idle state with a timeout;
//   2. query the entire rendered viewport for only required layers;
//   3. deduplicate features;
//   4. snapshot the result so later panning cannot mutate an in-flight export;
//   5. reject stale export results if the project revision changed.
//
// Step 3 has its own file. The rest are here, driven through a stub map rather than MapLibre.

const SIZE=400;

interface StubOptions{
 features?:CaptureMapFeature[];
 zoom?:number;
 center?:[number,number];
 canvasPx?:number;
 bearing?:number;
 pitch?:number;
 styleLoaded?:boolean;
 idle?:boolean;
 // Called after queryRenderedFeatures returns, to simulate the user panning mid-capture.
 onQuery?:(map:StubMap)=>void;
 projectOffset?:number;
}

interface StubMap extends CaptureMap{
 state:{center:{lng:number;lat:number};zoom:number};
 queries:{layers:string[]}[];
}

function stubMap(options:StubOptions={}):StubMap{
 const size=options.canvasPx??SIZE;
 const state={center:{lng:(options.center??FIXTURE_CENTER)[0],lat:(options.center??FIXTURE_CENTER)[1]},zoom:options.zoom??FIXTURE_ZOOM};
 const queries:{layers:string[]}[]=[];
 const idleHandlers=new Set<()=>void>();
 const mercatorY=(lat:number)=>{
  const rad=lat*Math.PI/180;
  return (1-Math.log(Math.tan(rad)+1/Math.cos(rad))/Math.PI)/2;
 };
 const map:StubMap={
  state,
  queries,
  isStyleLoaded:()=>options.styleLoaded!==false,
  loaded:()=>options.idle!==false,
  areTilesLoaded:()=>options.idle!==false,
  once(event,handler){if(event==='idle')idleHandlers.add(handler)},
  off(event,handler){if(event==='idle')idleHandlers.delete(handler as()=>void)},
  getCenter:()=>({...state.center}),
  getZoom:()=>state.zoom,
  getBearing:()=>options.bearing??0,
  getPitch:()=>options.pitch??0,
  getBounds(){
   const [west,south,east,north]=boundsFor([state.center.lng,state.center.lat],state.zoom,size);
   return {getWest:()=>west,getSouth:()=>south,getEast:()=>east,getNorth:()=>north};
  },
  getCanvas:()=>({clientWidth:size,clientHeight:options.canvasPx===undefined?SIZE:size}),
  project(lngLat){
   const worldSize=MAPLIBRE_TILE_SIZE*Math.pow(2,state.zoom);
   return {
    x:size/2+((lngLat[0]+180)/360-(state.center.lng+180)/360)*worldSize+(options.projectOffset??0),
    y:size/2+(mercatorY(lngLat[1])-mercatorY(state.center.lat))*worldSize,
   };
  },
  queryRenderedFeatures(_geometry,queryOptions){
   queries.push({layers:[...(queryOptions?.layers??[])]});
   const layers=queryOptions?.layers??[];
   const result=(options.features??[]).filter(feature=>!feature.layer?.id||layers.includes(feature.layer.id));
   options.onQuery?.(map);
   return result;
  },
 };
 return map;
}

const capture=(map:CaptureMap,over:Partial<Parameters<typeof captureOrnamentFeatures>[1]>={})=>
 captureOrnamentFeatures(map,{provider:OPENFREEMAP,detail:'high',innerRadiusMm:44.8,chordYMm:14,now:()=>0,...over});

describe('layer selection',()=>{
 // "query the entire rendered viewport for only required layers"
 it('asks for water and exactly the road tiers the detail level draws',()=>{
  expect(captureLayerIds('low')).toEqual([WATER_LAYER_ID,roadLayerId('low')]);
  expect(captureLayerIds('medium')).toEqual([WATER_LAYER_ID,roadLayerId('low'),roadLayerId('medium')]);
  expect(captureLayerIds('high')).toEqual([WATER_LAYER_ID,roadLayerId('low'),roadLayerId('medium'),roadLayerId('high')]);
 });

 it('queries by layer, not by filtering everything the style might draw',async()=>{
  const map=stubMap({features:cityCapture()});
  await capture(map,{detail:'low'});
  expect(map.queries).toHaveLength(1);
  expect(map.queries[0].layers).toEqual(captureLayerIds('low'));
 });

 // The acceptance-suite item: "Changing detail changes captured road classes."
 it('captures fewer road classes at a lower detail level',async()=>{
  const features=cityCapture();
  const low=await capture(stubMap({features}),{detail:'low'});
  const high=await capture(stubMap({features}),{detail:'high'});
  expect(low.capture.features.roads.length).toBeLessThan(high.capture.features.roads.length);
  expect(new Set(low.capture.features.roads.map(road=>road.roadClass)).has('service')).toBe(false);
  expect(new Set(high.capture.features.roads.map(road=>road.roadClass)).has('service')).toBe(true);
 });
});

describe('waiting for idle',()=>{
 it('returns immediately when the map is already settled',async()=>{
  expect(await waitForIdle(stubMap(),1000)).toBe(true);
 });

 it('times out rather than waiting for ever on a dead tile server',async()=>{
  vi.useFakeTimers();
  try{
   const pending=waitForIdle(stubMap({idle:false}),5000);
   await vi.advanceTimersByTimeAsync(5000);
   expect(await pending).toBe(false);
  }finally{vi.useRealTimers()}
 });

 it('warns rather than failing when the map never settled',async()=>{
  vi.useFakeTimers();
  try{
   const pending=capture(stubMap({idle:false,features:cityCapture()}),{idleTimeoutMs:100});
   await vi.advanceTimersByTimeAsync(100);
   const result=await pending;
   expect(result.warnings.map(warning=>warning.code)).toContain('not-idle');
   expect(result.capture.features.roads.length).toBeGreaterThan(0);
  }finally{vi.useRealTimers()}
 });
});

describe('the frozen viewport',()=>{
 it('records centre, zoom, bearing, pitch, bounds and canvas size',()=>{
  const viewport=readViewport(stubMap());
  expect(viewport.center).toEqual(FIXTURE_CENTER);
  expect(viewport.zoom).toBe(FIXTURE_ZOOM);
  expect(viewport.bearing).toBe(0);
  expect(viewport.pitch).toBe(0);
  expect(viewport.widthPx).toBe(SIZE);
  expect(viewport.bounds).toHaveLength(4);
  expect(viewport.tileSize).toBe(MAPLIBRE_TILE_SIZE);
 });

 it('is frozen, so nothing downstream can edit the record of what was captured',()=>{
  const viewport=readViewport(stubMap());
  expect(Object.isFrozen(viewport)).toBe(true);
 });

 // "First release must enforce bearing 0 and pitch 0."
 it('refuses a rotated map rather than projecting it wrongly',()=>{
  expect(()=>readViewport(stubMap({bearing:35}))).toThrow(CaptureError);
  expect(()=>readViewport(stubMap({bearing:35}))).toThrow(/rotated or tilted/);
 });

 it('refuses a tilted map',()=>{
  expect(()=>readViewport(stubMap({pitch:40}))).toThrow(/rotated or tilted/);
 });

 it('refuses a zero-sized map instead of guessing a scale',async()=>{
  await expect(capture(stubMap({canvasPx:0}))).rejects.toThrow(ZeroSizedViewportError);
 });
});

describe('snapshotting',()=>{
 // Step 4: "snapshot the result so later panning cannot mutate an in-flight export".
 it('copies coordinates so a map that reuses its tile arrays cannot change a capture',async()=>{
  const features=lakeCapture();
  const result=await capture(stubMap({features}));
  const ring=(features[0].geometry.coordinates as number[][][])[0];
  const before=result.capture.features.water[0].rings[0][0][0];
  ring[0][0]=999;
  expect(result.capture.features.water[0].rings[0][0][0]).toBe(before);
 });

 it('records the ornament window the capture belongs to',async()=>{
  const result=await capture(stubMap({features:cityCapture()}),{innerRadiusMm:30,chordYMm:5});
  expect(result.capture.innerRadiusMm).toBe(30);
  expect(result.capture.chordYMm).toBe(5);
  expect(result.capture.mmPerPx).toBeCloseTo(60/SIZE,12);
 });

 it('counts what it captured',async()=>{
  const result=await capture(stubMap({features:lakeCapture()}));
  expect(result.capture.features.counts.rawFeatures).toBe(lakeCapture().length);
  expect(result.capture.features.water).toHaveLength(1);
  expect(result.capture.features.roads).toHaveLength(3);
 });
});

describe('rejecting a capture that cannot be trusted',()=>{
 // Step 5, in its most immediate form: the user panned while the capture was in flight.
 it('refuses when the map moved during the capture',async()=>{
  const map=stubMap({features:cityCapture(),onQuery:moved=>{moved.state.center.lng+=.01}});
  await expect(capture(map)).rejects.toThrow(/moved while its geometry was being captured/);
 });

 it('refuses when the map zoomed during the capture',async()=>{
  const map=stubMap({features:cityCapture(),onQuery:moved=>{moved.state.zoom+=1}});
  await expect(capture(map)).rejects.toThrow(CaptureError);
 });

 // idleTimeoutMs is zero because a map whose style has not loaded will never report idle, and the
 // point of this test is the refusal, not the wait before it.
 it('refuses when the style has not loaded',async()=>{
  await expect(capture(stubMap({styleLoaded:false}),{idleTimeoutMs:0})).rejects.toThrow(/style has not finished loading/);
 });

 // The ornament projects features itself rather than calling map.project per vertex, so it checks
 // that its own Mercator agrees with the map's. A provider serving 256px tiles is the failure this
 // catches, and it would otherwise produce an ornament at half scale.
 it('refuses when its own projection disagrees with the map',async()=>{
  await expect(capture(stubMap({features:cityCapture(),projectOffset:50}))).rejects.toThrow(/disagree about where map coordinates fall/);
 });

 it('accepts a sub-pixel disagreement, which is just float noise',async()=>{
  const result=await capture(stubMap({features:cityCapture(),projectOffset:.2}));
  expect(result.capture.features.roads.length).toBeGreaterThan(0);
 });

 it('gives every refusal a code a caller can branch on',async()=>{
  expect.assertions(2);
  await capture(stubMap({styleLoaded:false}),{idleTimeoutMs:0}).catch(error=>{
   expect(error).toBeInstanceOf(CaptureError);
   expect((error as CaptureError).code).toBe('not-ready');
  });
 });
});
