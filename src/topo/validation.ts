import {FONT_REGISTRY} from '../text/fontRegistry';
import type {FontId} from '../types/project';
import {createDefaultTopoProject,DEFAULT_ROUTE_WIDTH_MM} from './defaults';
import {MERCATOR_MAX_LATITUDE,TOPO_CONTOUR_COUNTS,TOPO_LIMITS,type NumericLimit,type TopoContourCount,type TopoProject,type TopoRoute} from './types';

// Every state the store holds passes through clampTopoProject, including anything loaded from
// storage, which is untrusted input from a previous session. A value that is out of range is
// clamped; a value that is not a finite number, or not one of a union's members, falls back to the
// default. Nothing is rejected: a hand-edited or half-written record must still open.

const finiteOr=(value:unknown,fallback:number)=>typeof value==='number'&&Number.isFinite(value)?value:fallback;
const clampTo=(value:unknown,limit:NumericLimit,fallback:number)=>{const v=finiteOr(value,fallback);return v<limit.min?limit.min:v>limit.max?limit.max:v};
const oneOf=<T extends string|number>(value:unknown,allowed:readonly T[],fallback:T):T=>(allowed as readonly unknown[]).includes(value)?value as T:fallback;
const round3=(n:number)=>Number(n.toFixed(3));

// Longitude wraps (it is circular); latitude clamps at Web Mercator's limit (it is not). An
// in-range longitude is returned untouched: running it through the modular arithmetic anyway turns
// -90.1 into -90.10000000000002, a drift the map would then have to be told about.
export function normalizeCenter(center:unknown,fallback:[number,number]):[number,number]{
 const pair=Array.isArray(center)?center:fallback;
 const lng=finiteOr(pair[0],fallback[0]),lat=finiteOr(pair[1],fallback[1]);
 const wrapped=lng>=-180&&lng<=180?lng:((lng+180)%360+360)%360-180;
 return [wrapped,Math.max(-MERCATOR_MAX_LATITUDE,Math.min(MERCATOR_MAX_LATITUDE,lat))];
}

// The zoom control moves in 0.5 steps; the map itself zooms continuously (wheel, pinch), and that
// value is kept as the map reports it — snapping it would fight the user's gesture.
export const snapZoom=(zoom:number)=>Math.round(zoom/TOPO_LIMITS.zoom.step)*TOPO_LIMITS.zoom.step;

// A route is file-derived data, so it is validated as strictly as the GPX parser does: every point
// finite and on the globe, every segment drawable. Anything else drops the route rather than
// keeping a partial one.
export function validRoute(route:unknown,widthFallback:number):TopoRoute|null{
 if(!route||typeof route!=='object')return null;
 const r=route as Partial<TopoRoute>;
 if(!Array.isArray(r.segments))return null;
 let clean=true;
 for(const segment of r.segments){
  if(!Array.isArray(segment)||segment.length<2)return null;
  for(const point of segment){
   if(!Array.isArray(point)||point.length<2)return null;
   const [lng,lat]=point;
   if(!Number.isFinite(lng)||!Number.isFinite(lat)||Math.abs(lng)>180||Math.abs(lat)>90)return null;
   if(point.length!==2)clean=false;
  }
 }
 // Already exactly [lng, lat] pairs — what the GPX parser produces — so the same arrays are kept.
 // Every reducer action re-clamps the project, and copying a 250,000-point route on each one would
 // also make every toggle look like a new route to the board's overlay cache (features/overlay.ts).
 const segments:[number,number][][]=clean?r.segments:r.segments.map(segment=>segment.map(([lng,lat])=>[lng,lat] as [number,number]));
 if(!segments.length)return null;
 return {
  segments,
  widthMm:round3(clampTo(r.widthMm,TOPO_LIMITS.routeWidthMm,widthFallback)),
  source:oneOf(r.source,['track','route','waypoints'] as const,'track'),
  ...(typeof r.name==='string'&&r.name.trim()?{name:r.name.trim().slice(0,200)}:{}),
  pointCount:segments.reduce((sum,segment)=>sum+segment.length,0),
 };
}

export function clampTopoProject(input:TopoProject):TopoProject{
 const d=createDefaultTopoProject();
 const p=input??d;
 const coverage=Array.isArray(p.terrain?.coveragePercent)?p.terrain.coveragePercent:d.terrain.coveragePercent;
 // Higher layers are higher elevations, so each covers no more than the one below it: the plan's
 // "quantile thresholds are monotonic" starts here, in the settings.
 const c2=clampTo(coverage[1],TOPO_LIMITS.coveragePercent,d.terrain.coveragePercent[1]);
 const c3=Math.min(c2,clampTo(coverage[2],TOPO_LIMITS.coveragePercent,d.terrain.coveragePercent[2]));
 const c4=Math.min(c3,clampTo(coverage[3],TOPO_LIMITS.coveragePercent,d.terrain.coveragePercent[3]));
 const fontIds=FONT_REGISTRY.map(font=>font.id) as FontId[];
 const label=typeof p.viewport?.selectedPlaceLabel==='string'&&p.viewport.selectedPlaceLabel.trim()?p.viewport.selectedPlaceLabel.trim().slice(0,300):undefined;
 return {
  schemaVersion:1,
  viewport:{
   center:normalizeCenter(p.viewport?.center,d.viewport.center),
   zoom:clampTo(p.viewport?.zoom,TOPO_LIMITS.zoom,d.viewport.zoom),
   bearing:0,
   pitch:0,
   ...(label?{selectedPlaceLabel:label}:{}),
  },
  output:{
   widthMm:round3(clampTo(p.output?.widthMm,TOPO_LIMITS.outputMm,d.output.widthMm)),
   heightMm:round3(clampTo(p.output?.heightMm,TOPO_LIMITS.outputMm,d.output.heightMm)),
  },
  displayUnit:oneOf(p.displayUnit,['mm','in'] as const,d.displayUnit),
  terrain:{
   layerCount:oneOf(p.terrain?.layerCount,[1,2,3,4] as const,d.terrain.layerCount),
   coveragePercent:[100,Math.round(c2),Math.round(c3),Math.round(c4)],
   contoursEnabled:typeof p.terrain?.contoursEnabled==='boolean'?p.terrain.contoursEnabled:d.terrain.contoursEnabled,
   contourCount:oneOf<TopoContourCount>(p.terrain?.contourCount,TOPO_CONTOUR_COUNTS,d.terrain.contourCount),
  },
  roads:{
   enabled:typeof p.roads?.enabled==='boolean'?p.roads.enabled:d.roads.enabled,
   detail:oneOf(p.roads?.detail,['low','medium','high'] as const,d.roads.detail),
   thicknessScale:round3(clampTo(p.roads?.thicknessScale,TOPO_LIMITS.roadThicknessScale,d.roads.thicknessScale)),
  },
  labels:{
   enabled:typeof p.labels?.enabled==='boolean'?p.labels.enabled:d.labels.enabled,
   poiEnabled:typeof p.labels?.poiEnabled==='boolean'?p.labels.poiEnabled:d.labels.poiEnabled,
   sizeMm:round3(clampTo(p.labels?.sizeMm,TOPO_LIMITS.labelSizeMm,d.labels.sizeMm)),
  },
  route:validRoute(p.route,DEFAULT_ROUTE_WIDTH_MM),
  frame:{
   enabled:typeof p.frame?.enabled==='boolean'?p.frame.enabled:d.frame.enabled,
   thicknessMm:round3(clampTo(p.frame?.thicknessMm,TOPO_LIMITS.frameThicknessMm,d.frame.thicknessMm)),
  },
  compass:{
   position:oneOf(p.compass?.position,['top-left','top-right','bottom-left','bottom-right','off'] as const,d.compass.position),
   sizeMm:round3(clampTo(p.compass?.sizeMm,TOPO_LIMITS.compassSizeMm,d.compass.sizeMm)),
   mergeWithTerrain:typeof p.compass?.mergeWithTerrain==='boolean'?p.compass.mergeWithTerrain:d.compass.mergeWithTerrain,
  },
  title:{
   text:typeof p.title?.text==='string'?p.title.text.slice(0,200):d.title.text,
   fontId:oneOf(p.title?.fontId,fontIds,d.title.fontId),
   sizeMm:round3(clampTo(p.title?.sizeMm,TOPO_LIMITS.titleSizeMm,d.title.sizeMm)),
   dxMm:round3(clampTo(p.title?.dxMm,TOPO_LIMITS.titleOffsetMm,d.title.dxMm)),
   dyMm:round3(clampTo(p.title?.dyMm,TOPO_LIMITS.titleOffsetMm,d.title.dyMm)),
  },
 };
}
