import {createMapProjection,MAPLIBRE_TILE_SIZE,ZeroSizedViewportError,type LngLatTuple,type ViewportSnapshot} from '../geometry/mapProjection';
import type {VectorTileProvider} from '../map/provider';
import {visibleRoadLayerIds,WATER_LAYER_ID} from '../map/style';
import type {RoadDetail} from '../types';
import {assessCaptureCapacity} from '../limits';
import {dedupeBy,lineKey,polygonKey} from './dedupe';
import type {CapturedFeatures,CapturedRoad,CapturedWater,FeatureCapture} from './featureTypes';

// The one place in the ornament that touches a live map.
//
// Everything downstream of `captureOrnamentFeatures` is pure and serializable; everything MapLibre
// knows arrives through here and is copied out. The plan's §Feature capture lists five steps and
// this file is those five steps in order:
//
//   1. wait for `map.isStyleLoaded()` and a settled idle state with a timeout;
//   2. query the entire rendered viewport for only required layers;
//   3. deduplicate features;
//   4. snapshot the result so later panning cannot mutate an in-flight export;
//   5. reject stale export results if the project revision changed.
//
// Step 4 is the one worth spelling out. `queryRenderedFeatures` hands back objects whose coordinate
// arrays are decoded from tile data the map is free to evict, re-decode or re-use as the user keeps
// panning. Every coordinate below is copied into a fresh `[number, number]` before this function
// returns, and the viewport is read into a frozen record, so a capture is a value rather than a view
// onto a map that is still moving.

export interface CaptureMapFeature{
 geometry:{type:string;coordinates:unknown};
 properties?:Record<string,unknown>|null;
 layer?:{id?:string};
 sourceLayer?:string;
}

// The slice of MapLibre a capture needs. Declared structurally so a test can drive the whole capture
// path with an object literal, and so this file cannot quietly start using more of the map than it
// says it does.
export interface CaptureMap{
 isStyleLoaded():boolean;
 loaded():boolean;
 areTilesLoaded():boolean;
 once(event:string,handler:()=>void):void;
 off(event:string,handler:()=>void):void;
 getCenter():{lng:number;lat:number};
 getZoom():number;
 getBearing():number;
 getPitch():number;
 getBounds():{getWest():number;getSouth():number;getEast():number;getNorth():number};
 getCanvas():{clientWidth:number;clientHeight:number};
 project(lngLat:[number,number]):{x:number;y:number};
 queryRenderedFeatures(geometry?:unknown,options?:{layers?:string[]}):CaptureMapFeature[];
}

export type CaptureErrorCode='not-ready'|'rotated'|'unmeasured'|'moved'|'projection-mismatch'|'too-large';

export class CaptureError extends Error{
 constructor(message:string,readonly code:CaptureErrorCode){super(message);this.name='CaptureError'}
}

export interface CaptureWarning{code:string;message:string}

export interface CaptureResult{capture:FeatureCapture;warnings:CaptureWarning[]}

export interface CaptureOptions{
 provider:VectorTileProvider;
 detail:RoadDetail;
 // The ornament's map window, in millimetres, at the moment capture was requested.
 innerRadiusMm:number;
 chordYMm:number;
 // Millimetres per rendered CSS pixel, supplied by the preview layout.
 //
 // It used to be derived here, as `innerRadiusMm*2 / canvasWidthPx`, which was correct only while
 // the map element was exactly the ornament's map window. The element now fills the preview pane, so
 // its width says how much of the screen the map occupies and nothing about physical scale. Getting
 // this from the layout keeps the export the same physical size whatever size the window is — and
 // `assertProjectionAgrees` below checks the number against the live map rather than trusting it.
 mmPerPx:number;
 idleTimeoutMs?:number;
 now?:()=>number;
}

// Long enough that a cold tile cache on a slow connection usually settles; short enough that a dead
// tile server does not look like a hung button. Exceeding it is a warning, not a failure — a capture
// of a partly-loaded view is still useful to look at, it just must not be mistaken for a complete
// one, which is what the warning is for.
export const DEFAULT_IDLE_TIMEOUT_MS=8000;

// Two decodings of the same pixel should agree to well under a pixel. Half a pixel is a generous
// bound that still catches the failures that matter: a provider serving 256px tiles, a padded
// transform, or a future MapLibre changing its projection.
const PROJECTION_TOLERANCE_PX=.5;

export async function waitForIdle(map:CaptureMap,timeoutMs:number):Promise<boolean>{
 if(map.isStyleLoaded()&&map.loaded()&&map.areTilesLoaded())return true;
 return new Promise<boolean>(resolve=>{
  let settled=false;
  const finish=(idle:boolean)=>{
   if(settled)return;
   settled=true;
   clearTimeout(timer);
   map.off('idle',onIdle);
   resolve(idle);
  };
  const onIdle=()=>finish(true);
  const timer=setTimeout(()=>finish(false),Math.max(0,timeoutMs));
  map.once('idle',onIdle);
 });
}

export function readViewport(map:CaptureMap):ViewportSnapshot{
 const bearing=map.getBearing(),pitch=map.getPitch();
 // Not a defensive nicety: the millimetre projection has no way to represent a rotated or tilted
 // view, so capturing one would produce geometry that looks plausible and is wrong.
 if(Math.abs(bearing)>1e-6||Math.abs(pitch)>1e-6)
  throw new CaptureError('The map is rotated or tilted, which this ornament cannot project. Reset the map to north-up and try again.','rotated');
 const center=map.getCenter(),bounds=map.getBounds(),canvas=map.getCanvas();
 return Object.freeze({
  center:[center.lng,center.lat] as LngLatTuple,
  zoom:map.getZoom(),
  bearing:0,
  pitch:0,
  widthPx:canvas.clientWidth,
  heightPx:canvas.clientHeight,
  bounds:[bounds.getWest(),bounds.getSouth(),bounds.getEast(),bounds.getNorth()] as [number,number,number,number],
  tileSize:MAPLIBRE_TILE_SIZE,
 });
}

export const sameViewport=(a:ViewportSnapshot,b:ViewportSnapshot)=>
 Math.abs(a.center[0]-b.center[0])<1e-9&&Math.abs(a.center[1]-b.center[1])<1e-9
 &&Math.abs(a.zoom-b.zoom)<1e-9&&a.widthPx===b.widthPx&&a.heightPx===b.heightPx;

const isLngLat=(value:unknown):value is LngLatTuple=>
 Array.isArray(value)&&value.length>=2&&typeof value[0]==='number'&&typeof value[1]==='number';

// Deep-copies into fresh tuples. This is step 4 of the plan's capture sequence, and it is why the
// copy is not skipped for "obviously already-plain" arrays: the point is to own the memory, not to
// convert a type.
const copyLine=(value:unknown):LngLatTuple[]|undefined=>{
 if(!Array.isArray(value))return undefined;
 const line:LngLatTuple[]=[];
 for(const point of value){if(!isLngLat(point))return undefined;line.push([point[0],point[1]])}
 return line.length>=2?line:undefined;
};

const copyRings=(value:unknown):LngLatTuple[][]|undefined=>{
 if(!Array.isArray(value))return undefined;
 const rings:LngLatTuple[][]=[];
 for(const ring of value){const copied=copyLine(ring);if(copied&&copied.length>=3)rings.push(copied)}
 return rings.length?rings:undefined;
};

// Pulls roads and water out of a raw `queryRenderedFeatures` result.
//
// Exported and pure so the whole extraction can be exercised from a fixture without a map. It
// deliberately reads the road class through the provider adapter rather than a hard-coded property
// name — the plan: "Do not depend solely on hard-coded style layer IDs. Keep source-layer names and
// class mapping in a provider adapter."
export function extractCapturedFeatures(features:CaptureMapFeature[],provider:VectorTileProvider):CapturedFeatures{
 const roads:CapturedRoad[]=[],water:CapturedWater[]=[];
 let unusable=0;
 for(const feature of features){
  const sourceLayer=feature.sourceLayer??'';
  const geometry=feature.geometry;
  if(sourceLayer===provider.sourceLayers.water){
   if(geometry.type==='Polygon'){
    const rings=copyRings(geometry.coordinates);
    if(rings)water.push({rings});else unusable++;
   }else if(geometry.type==='MultiPolygon'){
    const polygons=Array.isArray(geometry.coordinates)?geometry.coordinates:[];
    let used=0;
    for(const polygon of polygons){const rings=copyRings(polygon);if(rings){water.push({rings});used++}}
    if(!used)unusable++;
   }else unusable++;
   continue;
  }
  if(sourceLayer===provider.sourceLayers.transportation){
   const roadClass=String(feature.properties?.[provider.roadClassProperty]??'');
   if(!roadClass){unusable++;continue}
   if(geometry.type==='LineString'){
    const line=copyLine(geometry.coordinates);
    if(line)roads.push({roadClass,line});else unusable++;
   }else if(geometry.type==='MultiLineString'){
    const lines=Array.isArray(geometry.coordinates)?geometry.coordinates:[];
    let used=0;
    for(const part of lines){const line=copyLine(part);if(line){roads.push({roadClass,line});used++}}
    if(!used)unusable++;
   }else unusable++;
   continue;
  }
  unusable++;
 }
 // Deduplication happens here — before projection, before buffering, before any union, which is
 // where the plan requires it ("Deduplicate features" as step 3, and "Deduplicate before buffering
 // or union" in §Risks). Doing it on geographic coordinates rather than projected millimetres also
 // means the result does not depend on the zoom the capture was taken at.
 const dedupedRoads=dedupeBy(roads,road=>road.roadClass+' '+lineKey(road.line));
 const dedupedWater=dedupeBy(water,polygon=>polygonKey(polygon.rings));
 return {
  roads:dedupedRoads.items,
  water:dedupedWater.items,
  counts:{
   rawFeatures:features.length,
   duplicateRoads:dedupedRoads.duplicates,
   duplicateWater:dedupedWater.duplicates,
   unusableFeatures:unusable,
  },
 };
}

// The layers a capture is allowed to see: water plus exactly the road tiers the current detail level
// draws. Querying by layer id rather than filtering afterwards is what makes the Phase 2 style "also
// the query filter" — a layer that is switched off contributes nothing, so changing detail changes
// the captured road classes with no second code path to keep in step.
export const captureLayerIds=(detail:RoadDetail):string[]=>[WATER_LAYER_ID,...visibleRoadLayerIds(detail)];

export async function captureOrnamentFeatures(map:CaptureMap,options:CaptureOptions):Promise<CaptureResult>{
 const warnings:CaptureWarning[]=[];
 const idle=await waitForIdle(map,options.idleTimeoutMs??DEFAULT_IDLE_TIMEOUT_MS);
 if(!idle)warnings.push({code:'not-idle',message:'The map was still loading tiles when the geometry was captured, so some roads or water may be missing. Capture again once the map has settled.'});
 if(!map.isStyleLoaded())throw new CaptureError('The map style has not finished loading, so there is nothing to capture yet.','not-ready');

 const before=readViewport(map);
 // Throws ZeroSizedViewportError rather than substituting a fallback, per the plan: an unmeasured
 // element or a missing scale means the capture has no physical size, and guessing one produces an
 // ornament whose roads are the wrong width, which nothing downstream can detect.
 if(!Number.isFinite(before.widthPx)||before.widthPx<=0||!Number.isFinite(before.heightPx)||before.heightPx<=0)
  throw new ZeroSizedViewportError('The map has not been measured yet (its rendered size is zero), so captured geometry has no physical scale. Wait for the preview to lay out and capture again.');
 const mmPerPx=options.mmPerPx;
 if(!Number.isFinite(mmPerPx)||mmPerPx<=0)
  throw new ZeroSizedViewportError('The preview has not worked out its scale yet, so captured geometry has no physical size. Wait for the preview to lay out and capture again.');

 assertProjectionAgrees(map,before,mmPerPx);

 // Only the ornament's own map window is queried, not the whole element.
 //
 // The element is as big as the preview pane, and everything outside the opening is dimmed because
 // it will be thrown away. Querying it anyway would read thousands of features that exist only to be
 // clipped off, and would make the feature count — and therefore the capacity limits below — depend
 // on how large the user's browser window is. The ornament centre is the element centre, so the
 // window is a square of `innerRadiusMm` either side of it.
 const radiusPx=options.innerRadiusMm/mmPerPx;
 const centreXPx=before.widthPx/2,centreYPx=before.heightPx/2;
 const windowBox:[[number,number],[number,number]]=[
  [centreXPx-radiusPx,centreYPx-radiusPx],
  [centreXPx+radiusPx,centreYPx+radiusPx],
 ];
 const raw=map.queryRenderedFeatures(windowBox,{layers:captureLayerIds(options.detail)});
 const features=extractCapturedFeatures(raw,options.provider);

 // Capacity is checked here, at the boundary, rather than in the geometry pipeline. A capture too
 // large to build is refused before it is stored, before it crosses into the worker, and before the
 // UI has told the user anything was captured -- so the failure is one message with an instruction
 // in it, rather than a build that never finishes. `assessCaptureCapacity` owns the numbers and the
 // wording; this only decides that a refusal is fatal.
 const capacity=assessCaptureCapacity(features);
 if(capacity.refusal)throw new CaptureError(capacity.refusal,'too-large');

 // Step 5. The query is synchronous, but awaiting idle above is not, and a user can pan during it.
 // Comparing the viewport either side of the query is what turns "probably fine" into "checked".
 const after=readViewport(map);
 if(!sameViewport(before,after))
  throw new CaptureError('The map moved while its geometry was being captured. Capture again once it has stopped.','moved');

 return {
  capture:{
   viewport:before,
   mmPerPx,
   innerRadiusMm:options.innerRadiusMm,
   chordYMm:options.chordYMm,
   detail:options.detail,
   features,
   capturedAt:(options.now??Date.now)(),
  },
  warnings,
 };
}

// The ornament projects captured coordinates with its own pure Web Mercator rather than calling
// `map.project` per vertex — it has to, because the projection runs in a worker with no map. That
// makes "our Mercator is MapLibre's Mercator" an assumption the export depends on, so it is checked
// against the real map once per capture instead of being trusted.
//
// The probe point is a quarter of the viewport away from the centre in both axes: far enough that a
// wrong tile size or an off-by-one transform shows up, close enough that it is inside the viewport
// at every supported zoom.
function assertProjectionAgrees(map:CaptureMap,viewport:ViewportSnapshot,mmPerPx:number):void{
 const project=createMapProjection(viewport,mmPerPx);
 const centre=map.getCenter();
 const [west,south,east,north]=viewport.bounds;
 const probe:[number,number]=[centre.lng+(east-west)/4,centre.lat+(north-south)/4];
 const expected=project(probe[0],probe[1]);
 if(!Number.isFinite(expected[0])||!Number.isFinite(expected[1]))
  throw new CaptureError('The map viewport could not be projected into ornament millimetres.','projection-mismatch');
 const actual=map.project(probe);
 // map.project returns pixels from the element's top-left; the ornament's origin is its centre.
 const actualMm:[number,number]=[(actual.x-viewport.widthPx/2)*mmPerPx,(actual.y-viewport.heightPx/2)*mmPerPx];
 const tolerance=PROJECTION_TOLERANCE_PX*mmPerPx;
 if(Math.abs(actualMm[0]-expected[0])>tolerance||Math.abs(actualMm[1]-expected[1])>tolerance)
  throw new CaptureError('The ornament and the map disagree about where map coordinates fall, so the capture would be the wrong physical size. This usually means the tile provider is not using 512px tiles.','projection-mismatch');
}
