import ClipperLib from 'clipper-lib';
import type {MultiPolygonMm,PolygonMm,RingMm} from '../shoreline/polygonEngine';
import {simplifyRing} from '../../ornament/geometry/simplify';
import type {DepthTerrain} from './depthTerrain';
import {chaikinRing,findCrossingRings,localSignedArea,pointInRing} from './contourGeometry';
import {traceContourRings,type IndexRing} from './marchingSquares';

// Phase B: turns a Phase A depth grid into nested contour polygons, one set per requested depth
// threshold per water body. Pure and UI-independent, like Phase A. See docs/depth-terrain.md.
//
// Per threshold, per body:
//   1. marching squares (marchingSquares.ts): closed raw rings, exactly nested by construction
//   2. Douglas–Peucker simplification, in mm (the ornament's simplifyRing, reused)
//   3. optional single Chaikin pass
//   4. a ring that now crosses itself or another ring steps back: first loses the smoothing, then
//      is re-simplified at half the tolerance, and so on down to raw. Raw rings never cross.
//   5. rings assembled into polygons using the *raw* rings' containment, so simplification cannot
//      change which hole belongs to which outline; holes under minHoleAreaMm2 are filled
//   6. clipped: level 1 against the shoreline itself, each deeper level against the finished level
//      above it
//   7. components under minComponentAreaMm2 dropped
//
// Nesting is the property everything downstream depends on: a deeper cut must sit inside the one
// above it. Raw marching-squares contours already nest. Simplification and smoothing can each push
// a ring outward, so the clip in step 6 is what guarantees it for the finished output — the same
// arrangement artisticDepth.ts uses. The order in steps 5–7 matters: filling a hole can only grow a
// level, so it happens before the clip; dropping a component can only shrink one, so it happens
// after. assertNestedContours then checks the result independently before it is returned.
//
// The clip runs in Clipper's integer space at the scale polygonEngine uses for its offsets (1 unit
// = 0.001mm), not in polygon-clipping. polygon-clipping's floating-point sweep throws ("Unable to
// find segment…") on exactly this input — a polygon whose edges lie along its container's, which is
// what clipping produces by definition. Clipper is exact on integers except that each new
// intersection vertex is rounded to the grid, which can move it up to ~0.71 units — outside the
// container, if the vertex sat on its boundary. So each container is first eroded by
// NESTING_MARGIN_UNITS (3 units, 0.003mm). Three roundings can each move a boundary up to ~0.71
// units — the float shoreline onto the grid, the eroded outline, and the new intersection vertices
// — which still leaves every output edge ~0.87 units inside the true container. Containment is
// therefore exact rather than "within rounding", and assertNestedContours requires zero area
// outside. The price is 0.003mm per level, about 1/50 of a 0.15mm kerf.
//
// Thresholds are absolute depths on the same 0–1 scale as DepthTerrain.depth, so a threshold is the
// same depth in every body. A body shallower than a threshold has no contour at it. A dropped body
// (Phase A's minBodyCells) is depth 0 everywhere and never has contours.
//
// Output rings are closed, outer rings wind positive (shoelace) and holes negative.

export interface ContourOptions{
 // Douglas–Peucker tolerance in mm. 0 disables simplification.
 simplifyToleranceMm:number;
 // One Chaikin corner-cutting pass after simplification.
 smooth:boolean;
 // Output polygons smaller than this are dropped, and holes smaller than this are filled.
 minComponentAreaMm2:number;
 minHoleAreaMm2:number;
}

// 0.04mm matches the ornament's simplification tolerance, about a quarter of a typical 0.15mm
// kerf, so the thinning is not visible in the cut. 0.25mm² (about half a millimetre square) is the
// smallest island or hole kept: anything smaller is a laser dwelling in one spot, not a feature.
export const DEFAULT_CONTOUR_OPTIONS:ContourOptions={simplifyToleranceMm:.04,smooth:true,minComponentAreaMm2:.25,minHoleAreaMm2:.25};

export const CONTOUR_CLIPPER_SCALE=1000;
export const NESTING_MARGIN_UNITS=3;
export const NESTING_MARGIN_MM=NESTING_MARGIN_UNITS/CONTOUR_CLIPPER_SCALE;
// Re-simplification attempts before a crossing ring falls back to raw: tolerance, ½, ¼, … ⅛.
const SIMPLIFY_RETRIES=4;

export interface ContourLevel{
 threshold:number;
 geometry:MultiPolygonMm;
 areaMm2:number;
 vertexCount:number;
 // Rings marching squares produced for this body at this threshold, before any processing.
 rawRingCount:number;
}
export interface BodyContours{bodyId:number;levels:ContourLevel[]}
export interface ContourStats{simplifyFallbacks:number;smoothFallbacks:number}
export interface DepthContours{thresholds:number[];options:ContourOptions;bodies:BodyContours[];stats:ContourStats}

const finiteOr=(value:unknown,fallback:number)=>typeof value==='number'&&Number.isFinite(value)?value:fallback;
const clamp=(value:number,min:number,max:number)=>value<min?min:value>max?max:value;

// Same policy as Phase A's parameters: never rejected, clamped, non-finite falls back to default.
export function normalizeContourOptions(input:Partial<ContourOptions>={}):ContourOptions{
 const d=DEFAULT_CONTOUR_OPTIONS;
 return {
  simplifyToleranceMm:clamp(finiteOr(input.simplifyToleranceMm,d.simplifyToleranceMm),0,5),
  smooth:typeof input.smooth==='boolean'?input.smooth:d.smooth,
  minComponentAreaMm2:clamp(finiteOr(input.minComponentAreaMm2,d.minComponentAreaMm2),0,1e6),
  minHoleAreaMm2:clamp(finiteOr(input.minHoleAreaMm2,d.minHoleAreaMm2),0,1e6),
 };
}

// Thresholds are a geometry request rather than a style parameter: a bad one is refused, not
// clamped. Quietly dropping or moving a requested layer would produce a different stack of cuts
// than the one asked for. Returned sorted ascending with duplicates removed.
export function normalizeThresholds(thresholds:readonly number[]):number[]{
 if(!thresholds.length)throw new Error('Depth contours: no thresholds requested.');
 for(const t of thresholds)if(!(typeof t==='number'&&Number.isFinite(t)&&t>0&&t<=1))throw new Error(`Depth contours: threshold ${t} is not a depth in (0, 1].`);
 return [...new Set(thresholds)].sort((a,b)=>a-b);
}

// ---- Clipper integer space ----

type Path=ClipperLib.IntPoint[];
const toPath=(ring:RingMm):Path=>ring.slice(0,-1).map(([x,y])=>({X:Math.round(x*CONTOUR_CLIPPER_SCALE),Y:Math.round(y*CONTOUR_CLIPPER_SCALE)}));
const toPaths=(geometry:MultiPolygonMm):Path[]=>geometry.flatMap(polygon=>polygon.map(toPath));
const toRing=(path:Path):RingMm=>{const ring:RingMm=path.map(p=>[p.X/CONTOUR_CLIPPER_SCALE,p.Y/CONTOUR_CLIPPER_SCALE] as [number,number]);ring.push([ring[0][0],ring[0][1]]);return ring};
const oriented=(ring:RingMm,positive:boolean)=>(localSignedArea(ring)>0)===positive?ring:ring.slice().reverse();

// The container shrunk by NESTING_MARGIN_UNITS. ClipperOffset reads direction from winding, so each
// ring is first wound as Clipper expects for its role (outer or hole), as offsetWater does.
function erode(container:MultiPolygonMm):Path[]{
 const offset=new ClipperLib.ClipperOffset(2,.25),out:Path[]=[];
 for(const polygon of container)polygon.forEach((ring,index)=>{
  const path=toPath(ring);
  if(path.length<3)return;
  if(ClipperLib.Clipper.Orientation(path)!==(index===0))path.reverse();
  offset.AddPath(path,ClipperLib.JoinType.jtMiter,ClipperLib.EndType.etClosedPolygon);
 });
 offset.Execute(out,-NESTING_MARGIN_UNITS);
 return out;
}

// The subject rings never cross (step 4), so even/odd reads them correctly, islands in holes
// included. The clip side is either the eroded container (consistently wound by ClipperOffset:
// non-zero) or a finished level or the shoreline (valid, non-overlapping: even/odd).
function clip(type:ClipperLib.ClipType,subject:MultiPolygonMm,container:Path[],containerFill:ClipperLib.PolyFillType,label:string):MultiPolygonMm{
 const clipper=new ClipperLib.Clipper(),tree=new ClipperLib.PolyTree();
 clipper.StrictlySimple=true;
 clipper.AddPaths(toPaths(subject),ClipperLib.PolyType.ptSubject,true);
 clipper.AddPaths(container,ClipperLib.PolyType.ptClip,true);
 if(!clipper.Execute(type,tree,ClipperLib.PolyFillType.pftEvenOdd,containerFill))throw new Error(`Depth contours: clipping failed (${label}).`);
 return ClipperLib.JS.PolyTreeToExPolygons(tree)
  .filter(ex=>ex.outer.length>=3)
  .map(ex=>[oriented(toRing(ex.outer),true),...ex.holes.filter(h=>h.length>=3).map(h=>oriented(toRing(h),false))]);
}

const polygonAreaMm2=(polygon:PolygonMm)=>polygon.reduce((sum,ring,i)=>sum+(i?-1:1)*Math.abs(localSignedArea(ring)),0);
const areaMm2=(geometry:MultiPolygonMm)=>geometry.reduce((sum,polygon)=>sum+polygonAreaMm2(polygon),0);
const vertexCount=(geometry:MultiPolygonMm)=>geometry.reduce((sum,polygon)=>sum+polygon.reduce((s,ring)=>s+ring.length-1,0),0);

export function extractDepthContours(terrain:DepthTerrain,shoreline:MultiPolygonMm,thresholds:readonly number[],input:Partial<ContourOptions>={}):DepthContours{
 const options=normalizeContourOptions(input),levels=normalizeThresholds(thresholds);
 const {grid}=terrain,stats:ContourStats={simplifyFallbacks:0,smoothFallbacks:0};
 const kept=terrain.bodies.filter(body=>!body.dropped);
 const bodies:BodyContours[]=kept.map(body=>({bodyId:body.id,levels:[]}));
 const byId=new Map(bodies.map(body=>[body.bodyId,body]));
 const previous=new Map<number,MultiPolygonMm>(kept.map(body=>[body.id,shoreline]));
 const toMm=(ring:IndexRing):RingMm=>ring.points.map(([x,y])=>[grid.originXMm+(x+.5)*grid.cellMm,grid.originYMm+(y+.5)*grid.cellMm] as [number,number]);

 for(const threshold of levels){
  const raw=traceContourRings(terrain.depth,grid.columns,grid.rows,threshold,sample=>terrain.bodyId[sample]);
  const byBody=new Map<number,RingMm[]>();
  for(const ring of raw){
   if(!byId.has(ring.tag))throw new Error(`Depth contours: a contour at ${threshold} borders body ${ring.tag}, which is not a kept water body. This is a bug.`);
   const list=byBody.get(ring.tag);
   if(list)list.push(toMm(ring));else byBody.set(ring.tag,[toMm(ring)]);
  }
  for(const body of bodies){
   const rings=byBody.get(body.bodyId)??[],container=previous.get(body.bodyId)!;
   const geometry=rings.length&&container.length?buildLevel(rings,container,options,stats,`body ${body.bodyId} at ${threshold}`):[];
   body.levels.push({threshold,geometry,areaMm2:areaMm2(geometry),vertexCount:vertexCount(geometry),rawRingCount:rings.length});
   previous.set(body.bodyId,geometry);
  }
 }
 const result={thresholds:levels,options,bodies,stats};
 assertNestedContours(result,shoreline);
 return result;
}

type StageKind='raw'|'simplified'|'smoothed';

function buildLevel(raw:RingMm[],container:MultiPolygonMm,options:ContourOptions,stats:ContourStats,label:string):MultiPolygonMm{
 // Each ring's candidate versions, least processed first: raw, then simplified at ⅛, ¼, ½ and the
 // full tolerance, then smoothed. A version that crosses anything, or flips or collapses the ring,
 // is abandoned for the one before it.
 const rawArea=raw.map(localSignedArea);
 const stages=raw.map(ring=>{
  const list:{kind:StageKind;ring:RingMm}[]=[{kind:'raw',ring}];
  if(options.simplifyToleranceMm>0)for(let k=SIMPLIFY_RETRIES-1;k>=0;k--)list.push({kind:'simplified',ring:simplifyRing(ring,options.simplifyToleranceMm/2**k)});
  if(options.smooth)list.push({kind:'smoothed',ring:chaikinRing(list[list.length-1].ring)});
  return list;
 });
 const stage=stages.map(list=>list.length-1);
 const stepBack=(i:number)=>{if(stages[i][stage[i]].kind==='smoothed')stats.smoothFallbacks++;else stats.simplifyFallbacks++;stage[i]--};
 stages.forEach((list,i)=>{while(stage[i]>0){const area=localSignedArea(list[stage[i]].ring);if(area!==0&&Math.sign(area)===Math.sign(rawArea[i]))break;stepBack(i)}});
 for(;;){
  const crossing=findCrossingRings(stages.map((list,i)=>list[stage[i]].ring));
  if(!crossing.size)break;
  let moved=false;
  for(const i of crossing)if(stage[i]>0){stepBack(i);moved=true}
  if(!moved)throw new Error(`Depth contours: raw marching-squares rings cross (${label}). This is a bug.`);
 }
 const final=stages.map((list,i)=>list[stage[i]].ring);

 // Outlines are the positive rings. Each hole goes to the smallest raw outline containing it, which
 // is its immediate parent even when an island sits inside another hole.
 const outers=raw.map((_,i)=>i).filter(i=>rawArea[i]>0);
 const holesOf=new Map<number,number[]>(outers.map(i=>[i,[]]));
 raw.forEach((ring,i)=>{
  if(rawArea[i]>0)return;
  const [x,y]=ring[0];
  let parent=-1;
  for(const o of outers)if(pointInRing(x,y,raw[o])&&(parent<0||rawArea[o]<rawArea[parent]))parent=o;
  if(parent<0)throw new Error(`Depth contours: a hole has no enclosing outline (${label}). This is a bug.`);
  holesOf.get(parent)!.push(i);
 });
 const polygons:PolygonMm[]=outers.map(o=>[final[o],...holesOf.get(o)!.filter(h=>Math.abs(localSignedArea(final[h]))>=options.minHoleAreaMm2).map(h=>final[h])]);
 if(!polygons.length)return [];
 const eroded=erode(container);
 if(!eroded.length)return [];
 return clip(ClipperLib.ClipType.ctIntersection,polygons,eroded,ClipperLib.PolyFillType.pftNonZero,label).filter(polygon=>polygonAreaMm2(polygon)>=options.minComponentAreaMm2);
}

// Independent check of the output before it is returned: every coordinate finite, every ring
// closed, level 1 inside the shoreline, and every level inside the one above it for the same body,
// with exactly zero area outside. Throws rather than returning something that would cut a deeper
// layer outside a shallower one.
export function assertNestedContours(contours:DepthContours,shoreline:MultiPolygonMm):void{
 for(const body of contours.bodies){
  let container=shoreline,containerLabel='the shoreline';
  for(const level of body.levels){
   const label=`body ${body.bodyId} at ${level.threshold}`;
   for(const polygon of level.geometry)for(const ring of polygon){
    if(ring.length<4)throw new Error(`Depth contours: ${label} has a degenerate ring.`);
    const first=ring[0],last=ring[ring.length-1];
    if(first[0]!==last[0]||first[1]!==last[1])throw new Error(`Depth contours: ${label} has an open ring.`);
    for(const [x,y] of ring)if(!Number.isFinite(x)||!Number.isFinite(y))throw new Error(`Depth contours: ${label} has a non-finite coordinate.`);
   }
   if(level.geometry.length){
    const outside=areaMm2(clip(ClipperLib.ClipType.ctDifference,level.geometry,toPaths(container),ClipperLib.PolyFillType.pftEvenOdd,label));
    if(outside>0)throw new Error(`Depth contours: ${label} extends ${outside}mm² outside ${containerLabel}.`);
   }
   container=level.geometry;containerLabel=`the ${level.threshold} level`;
  }
 }
}
