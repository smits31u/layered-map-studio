import * as polygonClipping from 'polygon-clipping';
import {multiPolygonArea,polygonArea,signedArea,type MultiPolygonMm,type PolygonMm,type RingMm} from '../../geometry/shoreline/polygonEngine';

// The repair pass every piece of fabrication geometry goes through before anything is allowed to
// look at it.
//
// The plan asks for it three times — "remove tiny islands, and run polygon repair" for roads,
// "union, and repair" for water, and a Phase 4 preflight for "open cut paths, self-intersections,
// disconnected pieces, tiny islands, minimum neck/feature width, text overflow, and NaN/Infinity".
// Doing it once, here, is what keeps Phase 4 a layout problem rather than a geometry problem.
//
// "Repair" is four separate things, and they are separate functions because they fail differently:
//
//   * closing and de-duplicating rings, so every ring is a closed loop with no repeated vertices;
//   * normalising winding, so a consumer can tell an outer ring from a hole without a point-in-
//     polygon test;
//   * dropping components and holes below a physical minimum, because a 0.01mm island is not a
//     feature, it is a laser dwelling in one spot;
//   * asserting every coordinate is finite, because a single NaN silently poisons every boolean
//     operation downstream and surfaces as an empty export.

export const ORNAMENT_EPSILON_MM=1e-6;

export interface RepairOptions{
 // Components smaller than this are dropped. Zero keeps everything.
 minComponentAreaMm2?:number;
 // Holes smaller than this are filled in. Zero keeps everything.
 minHoleAreaMm2?:number;
}

export interface RepairReport{
 droppedComponents:number;
 droppedComponentAreaMm2:number;
 filledHoles:number;
}

export class NonFiniteGeometryError extends Error{
 constructor(label:string){
  super(label+' produced a coordinate that is not a finite number (NaN or Infinity). This is a bug in the geometry pipeline, not something a different map view will fix.');
  this.name='NonFiniteGeometryError';
 }
}

const same=(a:[number,number],b:[number,number])=>Math.abs(a[0]-b[0])<=ORNAMENT_EPSILON_MM&&Math.abs(a[1]-b[1])<=ORNAMENT_EPSILON_MM;

// Drops repeated vertices and guarantees the closing point. A ring that cannot survive this — fewer
// than three distinct vertices, or any non-finite coordinate — is returned as undefined rather than
// repaired into something invented.
export function cleanRingMm(ring:RingMm):RingMm|undefined{
 const points:RingMm=[];
 for(const point of ring){
  if(!Number.isFinite(point[0])||!Number.isFinite(point[1]))return undefined;
  const pair:[number,number]=[point[0],point[1]];
  if(points.length&&same(points[points.length-1],pair))continue;
  points.push(pair);
 }
 while(points.length>1&&same(points[0],points[points.length-1]))points.pop();
 if(points.length<3)return undefined;
 points.push([points[0][0],points[0][1]]);
 return points;
}

// Outer rings are given positive signed area and holes negative.
//
// The sign convention itself is arbitrary — what matters is that there is one, written down, and
// tested. With the ornament's +y-downward space a positive signed area reads as clockwise on screen.
// Fixing it here means the SVG export in Phase 4 can emit `fill-rule="evenodd"` or `"nonzero"` and
// get the same picture either way, which is the difference between a lake that engraves as a lake
// and one that engraves as a filled disc.
export function normalizeWinding(polygon:PolygonMm):PolygonMm{
 return polygon.map((ring,index)=>{
  const area=signedArea(ring);
  const wantPositive=index===0;
  return (area>=0)===wantPositive?ring:[...ring].reverse();
 });
}

export function assertFinite(geometry:MultiPolygonMm,label:string):void{
 for(const polygon of geometry)for(const ring of polygon)for(const point of ring)
  if(!Number.isFinite(point[0])||!Number.isFinite(point[1]))throw new NonFiniteGeometryError(label);
}

// The full pass. Order matters: clean before measuring areas (a ring with duplicate vertices can
// report a misleading area), drop small holes before small components (filling a hole can lift a
// sliver above the component threshold), and normalise winding last so nothing reverses it again.
export function repairGeometry(geometry:MultiPolygonMm,label:string,options:RepairOptions={}):{geometry:MultiPolygonMm;report:RepairReport}{
 const minComponent=Math.max(0,options.minComponentAreaMm2??0);
 const minHole=Math.max(0,options.minHoleAreaMm2??0);
 const report:RepairReport={droppedComponents:0,droppedComponentAreaMm2:0,filledHoles:0};
 const repaired:MultiPolygonMm=[];
 for(const polygon of geometry){
  const outer=polygon.length?cleanRingMm(polygon[0]):undefined;
  if(!outer)continue;
  const holes:RingMm[]=[];
  for(const hole of polygon.slice(1)){
   const cleaned=cleanRingMm(hole);
   if(!cleaned)continue;
   if(minHole>0&&Math.abs(signedArea(cleaned))<minHole){report.filledHoles++;continue}
   holes.push(cleaned);
  }
  const candidate:PolygonMm=[outer,...holes];
  const area=polygonArea(candidate);
  if(minComponent>0&&area<minComponent){report.droppedComponents++;report.droppedComponentAreaMm2+=area;continue}
  if(area<=0){report.droppedComponents++;continue}
  repaired.push(normalizeWinding(candidate));
 }
 assertFinite(repaired,label);
 return {geometry:repaired,report};
}

// Re-running a MultiPolygon through the boolean engine against itself is how polygon-clipping is
// asked to normalise topology: overlaps merge, self-intersections resolve, and nesting is recomputed.
// It is the "repair" the plan names, and it is separate from `repairGeometry` because it is the
// expensive half — worth doing once after a union, not after every filter.
export function normalizeTopology(geometry:MultiPolygonMm,label:string):MultiPolygonMm{
 if(!geometry.length)return [];
 try{return polygonClipping.union(geometry) as MultiPolygonMm}
 catch(error){throw new Error(label+' could not be repaired: '+(error as Error).message)}
}

export function unionAll(parts:MultiPolygonMm[],label:string):MultiPolygonMm{
 const usable=parts.filter(part=>part.length);
 if(!usable.length)return [];
 try{return polygonClipping.union(usable[0],...usable.slice(1)) as MultiPolygonMm}
 catch(error){throw new Error(label+' union failed: '+(error as Error).message)}
}

export function intersect(a:MultiPolygonMm,b:MultiPolygonMm,label:string):MultiPolygonMm{
 if(!a.length||!b.length)return [];
 try{return polygonClipping.intersection(a,b) as MultiPolygonMm}
 catch(error){throw new Error(label+' clipping failed: '+(error as Error).message)}
}

export function subtract(a:MultiPolygonMm,b:MultiPolygonMm,label:string):MultiPolygonMm{
 if(!a.length)return [];
 if(!b.length)return a;
 try{return polygonClipping.difference(a,b) as MultiPolygonMm}
 catch(error){throw new Error(label+' difference failed: '+(error as Error).message)}
}

export const geometryAreaMm2=multiPolygonArea;

export const countVertices=(geometry:MultiPolygonMm):number=>
 geometry.reduce((total,polygon)=>total+polygon.reduce((sum,ring)=>sum+ring.length,0),0);
