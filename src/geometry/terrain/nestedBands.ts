import ClipperLib from 'clipper-lib';
import type {MultiPolygonMm,PolygonMm,RingMm} from '../shoreline/polygonEngine';
import {simplifyRing} from '../../ornament/geometry/simplify';
import {chaikinRing,findCrossingRings,localSignedArea,pointInRing} from './contourGeometry';
import {traceContourRings,type IndexRing} from './marchingSquares';

// Exactly nested band polygons from a sampled grid: the machinery Phase B built for depth contours
// (depthContours.ts), extracted so the topo builder's elevation bands use the same code rather than
// a copy. Moved, not rewritten — depthContours.ts now calls into this file, and its pinned
// fingerprints are what show the move changed nothing.
//
// Per level, given the level's raw marching-squares rings and the finished level above it:
//   1. Douglas–Peucker simplification, in mm (the ornament's simplifyRing, reused)
//   2. optional single Chaikin pass
//   3. a ring that now crosses itself or another ring steps back: first loses the smoothing, then
//      is re-simplified at half the tolerance, and so on down to raw. Raw rings never cross.
//   4. rings assembled into polygons using the *raw* rings' containment, so simplification cannot
//      change which hole belongs to which outline; holes under minHoleAreaMm2 are filled
//   5. clipped against the level above (the first level against the caller's container)
//   6. components under minComponentAreaMm2 dropped
//
// Nesting is the property everything downstream depends on: a deeper or higher band must sit inside
// the one before it. Raw marching-squares contours already nest. Simplification and smoothing can
// each push a ring outward, so the clip in step 5 is what guarantees it for the finished output —
// the same arrangement artisticDepth.ts uses. The order in steps 4–6 matters: filling a hole can only
// grow a level, so it happens before the clip; dropping a component can only shrink one, so it
// happens after. assertLevelChain then checks the result independently.
//
// The clip runs in Clipper's integer space at the scale polygonEngine uses for its offsets (1 unit
// = 0.001mm), not in polygon-clipping. polygon-clipping's floating-point sweep throws ("Unable to
// find segment…") on exactly this input — a polygon whose edges lie along its container's, which is
// what clipping produces by definition. Clipper is exact on integers except that each new
// intersection vertex is rounded to the grid, which can move it up to ~0.71 units — outside the
// container, if the vertex sat on its boundary. So each container is first eroded by
// NESTING_MARGIN_UNITS (3 units, 0.003mm). Three roundings can each move a boundary up to ~0.71
// units — the float container onto the grid, the eroded outline, and the new intersection vertices
// — which still leaves every output edge ~0.87 units inside the true container. Containment is
// therefore exact rather than "within rounding", and assertLevelChain requires zero area outside.
// The price is 0.003mm per level, about 1/50 of a 0.15mm kerf.
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

export interface ContourStats{simplifyFallbacks:number;smoothFallbacks:number}

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

// ---- Clipper integer space ----

export type ClipperPath=ClipperLib.IntPoint[];
export const toPath=(ring:RingMm):ClipperPath=>ring.slice(0,-1).map(([x,y])=>({X:Math.round(x*CONTOUR_CLIPPER_SCALE),Y:Math.round(y*CONTOUR_CLIPPER_SCALE)}));
export const toPaths=(geometry:MultiPolygonMm):ClipperPath[]=>geometry.flatMap(polygon=>polygon.map(toPath));
const toRing=(path:ClipperPath):RingMm=>{const ring:RingMm=path.map(p=>[p.X/CONTOUR_CLIPPER_SCALE,p.Y/CONTOUR_CLIPPER_SCALE] as [number,number]);ring.push([ring[0][0],ring[0][1]]);return ring};
const oriented=(ring:RingMm,positive:boolean)=>(localSignedArea(ring)>0)===positive?ring:ring.slice().reverse();

// The container shrunk by NESTING_MARGIN_UNITS. ClipperOffset reads direction from winding, so each
// ring is first wound as Clipper expects for its role (outer or hole), as offsetWater does.
export function erode(container:MultiPolygonMm):ClipperPath[]{
 const offset=new ClipperLib.ClipperOffset(2,.25),out:ClipperPath[]=[];
 for(const polygon of container)polygon.forEach((ring,index)=>{
  const path=toPath(ring);
  if(path.length<3)return;
  if(ClipperLib.Clipper.Orientation(path)!==(index===0))path.reverse();
  offset.AddPath(path,ClipperLib.JoinType.jtMiter,ClipperLib.EndType.etClosedPolygon);
 });
 offset.Execute(out,-NESTING_MARGIN_UNITS);
 return out;
}

// The subject rings never cross (step 3), so even/odd reads them correctly, islands in holes
// included. The clip side is either the eroded container (consistently wound by ClipperOffset:
// non-zero) or a finished level or the caller's container (valid, non-overlapping: even/odd).
export function clip(type:ClipperLib.ClipType,subject:MultiPolygonMm,container:ClipperPath[],containerFill:ClipperLib.PolyFillType,label:string,context='Depth contours'):MultiPolygonMm{
 const clipper=new ClipperLib.Clipper(),tree=new ClipperLib.PolyTree();
 clipper.StrictlySimple=true;
 clipper.AddPaths(toPaths(subject),ClipperLib.PolyType.ptSubject,true);
 clipper.AddPaths(container,ClipperLib.PolyType.ptClip,true);
 if(!clipper.Execute(type,tree,ClipperLib.PolyFillType.pftEvenOdd,containerFill))throw new Error(`${context}: clipping failed (${label}).`);
 return ClipperLib.JS.PolyTreeToExPolygons(tree)
  .filter(ex=>ex.outer.length>=3)
  .map(ex=>[oriented(toRing(ex.outer),true),...ex.holes.filter(h=>h.length>=3).map(h=>oriented(toRing(h),false))]);
}

export const polygonAreaMm2=(polygon:PolygonMm)=>polygon.reduce((sum,ring,i)=>sum+(i?-1:1)*Math.abs(localSignedArea(ring)),0);
export const areaMm2=(geometry:MultiPolygonMm)=>geometry.reduce((sum,polygon)=>sum+polygonAreaMm2(polygon),0);
export const vertexCount=(geometry:MultiPolygonMm)=>geometry.reduce((sum,polygon)=>sum+polygon.reduce((s,ring)=>s+ring.length-1,0),0);

type StageKind='raw'|'simplified'|'smoothed';

// Steps 1–6 for one level: the level's raw rings (in mm) in, the finished, clipped level out.
export function nestedBandLevel(raw:RingMm[],container:MultiPolygonMm,options:ContourOptions,stats:ContourStats,label:string,context='Depth contours'):MultiPolygonMm{
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
  if(!moved)throw new Error(`${context}: raw marching-squares rings cross (${label}). This is a bug.`);
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
  if(parent<0)throw new Error(`${context}: a hole has no enclosing outline (${label}). This is a bug.`);
  holesOf.get(parent)!.push(i);
 });
 const polygons:PolygonMm[]=outers.map(o=>[final[o],...holesOf.get(o)!.filter(h=>Math.abs(localSignedArea(final[h]))>=options.minHoleAreaMm2).map(h=>final[h])]);
 if(!polygons.length)return [];
 const eroded=erode(container);
 if(!eroded.length)return [];
 return clip(ClipperLib.ClipType.ctIntersection,polygons,eroded,ClipperLib.PolyFillType.pftNonZero,label,context).filter(polygon=>polygonAreaMm2(polygon)>=options.minComponentAreaMm2);
}

// Below this, an "outside" area is float/rounding noise rather than a real containment breach,
// and does not fail the chain. It comes up only with very complex, many-small-island real
// coastlines: each vertex the ctDifference clip introduces is rounded to the integer grid (see
// the file-level comment on NESTING_MARGIN_UNITS), which can leave a single-grid-unit sliver —
// about 1e-6mm² — outside the container at any one boundary crossing. A coastline with hundreds
// of small islands can have hundreds of such crossings, whose slivers areaMm2 then sums; that
// accumulation is what this tolerance absorbs. It is picked to comfortably cover that (roughly
// a thousand single-unit slivers) while staying two orders of magnitude below anything
// manufacturable — a 0.15mm-kerf-scale feature is already ~0.02mm², twenty times this tolerance —
// so a real nesting violation, which starts at a full grid cell, is never masked by it.
export const NESTING_AREA_TOLERANCE_MM2=1e-3;

// Independent check of a chain of levels before it is returned: every coordinate finite, every ring
// closed, the first level inside the container, and every level inside the one before it, with
// zero area outside (up to NESTING_AREA_TOLERANCE_MM2 of floating-point noise). Throws rather than
// returning something that would cut a deeper layer outside a shallower one.
export function assertLevelChain(levels:readonly {threshold:number;geometry:MultiPolygonMm}[],container:MultiPolygonMm,containerLabel:string,labelOf:(threshold:number)=>string,context='Depth contours'):void{
 let outer=container,outerLabel=containerLabel;
 for(const level of levels){
  const label=labelOf(level.threshold);
  for(const polygon of level.geometry)for(const ring of polygon){
   if(ring.length<4)throw new Error(`${context}: ${label} has a degenerate ring.`);
   const first=ring[0],last=ring[ring.length-1];
   if(first[0]!==last[0]||first[1]!==last[1])throw new Error(`${context}: ${label} has an open ring.`);
   for(const [x,y] of ring)if(!Number.isFinite(x)||!Number.isFinite(y))throw new Error(`${context}: ${label} has a non-finite coordinate.`);
  }
  if(level.geometry.length){
   const outside=areaMm2(clip(ClipperLib.ClipType.ctDifference,level.geometry,toPaths(outer),ClipperLib.PolyFillType.pftEvenOdd,label,context));
   if(outside>NESTING_AREA_TOLERANCE_MM2)throw new Error(`${context}: ${label} extends ${outside}mm² outside ${outerLabel}.`);
  }
  outer=level.geometry;outerLabel=`the ${level.threshold} level`;
 }
}

// ---- The generic entry point ----

// A grid of samples laid out in mm: sample (c, r) sits at
// (originXMm + (c+½)·cellWidthMm, originYMm + (r+½)·cellHeightMm). Cells may be non-square, which
// an elevation grid resampled to a board with independent X/Y scales needs.
export interface SampleGrid{values:ArrayLike<number>;columns:number;rows:number;originXMm:number;originYMm:number;cellWidthMm:number;cellHeightMm:number}

export interface BandLevel{threshold:number;geometry:MultiPolygonMm;areaMm2:number;vertexCount:number;rawRingCount:number}
export interface NestedBands{thresholds:number[];options:ContourOptions;levels:BandLevel[];stats:ContourStats}

export const gridPointToMm=(grid:SampleGrid,[x,y]:[number,number]):[number,number]=>[grid.originXMm+(x+.5)*grid.cellWidthMm,grid.originYMm+(y+.5)*grid.cellHeightMm];

// Nested regions at or above each threshold, the first clipped to `container`, each next one to the
// one before. Any finite thresholds, sorted ascending and de-duplicated. `outside` is what samples
// beyond the grid read as (see traceContourRings); the default is -Infinity, below every threshold,
// which is right for any grid whose thresholds are not all positive — an elevation grid in
// particular.
export function extractNestedBands(grid:SampleGrid,thresholds:readonly number[],container:MultiPolygonMm,input:Partial<ContourOptions>={},outside=-Infinity,context='Nested bands'):NestedBands{
 if(!thresholds.length)throw new Error(`${context}: no thresholds requested.`);
 for(const t of thresholds)if(!(typeof t==='number'&&Number.isFinite(t)&&t>outside))throw new Error(`${context}: threshold ${t} is not a finite number above the outside value ${outside}.`);
 const options=normalizeContourOptions(input),sorted=[...new Set(thresholds)].sort((a,b)=>a-b);
 const stats:ContourStats={simplifyFallbacks:0,smoothFallbacks:0},levels:BandLevel[]=[];
 const toMm=(ring:IndexRing):RingMm=>ring.points.map(point=>gridPointToMm(grid,point));
 let previous=container;
 for(const threshold of sorted){
  const raw=traceContourRings(grid.values,grid.columns,grid.rows,threshold,()=>0,{outside}).map(toMm);
  const geometry=raw.length&&previous.length?nestedBandLevel(raw,previous,options,stats,`level ${threshold}`,context):[];
  levels.push({threshold,geometry,areaMm2:areaMm2(geometry),vertexCount:vertexCount(geometry),rawRingCount:raw.length});
  previous=geometry;
 }
 assertLevelChain(levels,container,'the container',threshold=>`level ${threshold}`,context);
 return {thresholds:sorted,options,levels,stats};
}
