import {simplifyGeometry} from '../../geometry/shoreline/artisticDepth';
import type {MultiPolygonMm,PolygonMm,RingMm} from '../../geometry/shoreline/polygonEngine';
import {ARC_TOLERANCE_MM,circle} from './circle';
import {assertFinite,cleanRingMm,countVertices,geometryAreaMm2,intersect,normalizeTopology,repairGeometry,subtract,unionAll} from './polygonRepair';

// Water polygons → an engrave region (classic) or a cut region (water cutout).
//
// The plan's §Water: "Capture Polygon and MultiPolygon features from the water source layer.
// Preserve inner rings/islands. Deduplicate, project, intersect with the inner disk, union, and
// repair. In classic mode, emit water as a light-engrave region. In three-piece mode, subtract water
// from the land disk. Add the structural outer ring back to the land piece so islands and coastal
// fragments remain registered and connected where possible."
//
// Holes are the whole difficulty. A lake with an island is one Polygon with two rings, and every
// step here can lose the second one: a normaliser that flattens rings into a list, a union that is
// handed rings instead of polygons, a difference whose operands have inconsistent winding. Each of
// those failures produces a plausible-looking solid lake, and on a water-cutout ornament it produces
// a hole in the wood where the island should be. So the rings stay paired from projection all the
// way to the boolean engine, and `ornamentWaterGeometry.test.ts` follows a known island through
// clip, union and difference rather than checking only the outline.
//
// Deliberate reading of the plan, recorded because it is asymmetric and looks like an oversight:
// water is clipped to the inner *disk* only, while roads are additionally clipped above the map/text
// chord. That is what the plan says, and it is right for classic mode — the base piece is a full
// disk and the part of it under the text band is covered by the frame, so water there is harmless
// and stopping it at the chord would leave a visible straight edge in the lake if the frame ever
// shifts. Whether a water *cut* should also stop at the chord is a Phase 4 layout question, since
// that is where the pieces are actually laid out; it is noted in the status document.

export interface ProjectedWater{rings:RingMm[]}

export interface WaterGeometryOptions{
 innerRadiusMm:number;
 simplifyToleranceMm?:number;
 minComponentAreaMm2?:number;
 // Holes below this are filled. A filled hole is an island that stops existing, so the count is
 // reported and the caller turns it into a warning — see `featureGeometry.ts`.
 minHoleAreaMm2?:number;
 arcToleranceMm?:number;
}

export interface WaterGeometryMetrics{
 inputPolygons:number;
 rejectedRings:number;
 components:number;
 holes:number;
 filledHoles:number;
 droppedComponents:number;
 areaMm2:number;
 vertices:number;
}

export interface WaterGeometryResult{geometry:MultiPolygonMm;metrics:WaterGeometryMetrics}

export const DEFAULT_WATER_SIMPLIFY_TOLERANCE_MM=ARC_TOLERANCE_MM/2;
// 0.25mm² is a square half a millimetre on a side — the smallest island that survives being cut and
// still looks intentional. Below it the piece is smaller than the kerf either side of it.
export const DEFAULT_MIN_WATER_HOLE_AREA_MM2=.25;
export const DEFAULT_MIN_WATER_COMPONENT_AREA_MM2=.25;

export const innerDisk=(innerRadiusMm:number,arcToleranceMm=ARC_TOLERANCE_MM):MultiPolygonMm=>
 innerRadiusMm>0?circle(0,0,innerRadiusMm,arcToleranceMm):[];

// Rings are cleaned individually and kept in their original order, so ring 0 stays the outer ring
// and rings 1..n stay its holes. A hole whose ring cannot be cleaned is dropped and counted; the
// polygon survives without it, because losing an island is better than losing the lake.
function normalizeWaterPolygon(polygon:ProjectedWater,onReject:()=>void):PolygonMm|undefined{
 if(!polygon.rings.length)return undefined;
 const outer=cleanRingMm(polygon.rings[0]);
 if(!outer){onReject();return undefined}
 const holes:RingMm[]=[];
 for(const ring of polygon.rings.slice(1)){
  const cleaned=cleanRingMm(ring);
  if(cleaned)holes.push(cleaned);else onReject();
 }
 return [outer,...holes];
}

export function buildWaterRegion(water:ProjectedWater[],options:WaterGeometryOptions):WaterGeometryResult{
 const simplifyToleranceMm=options.simplifyToleranceMm??DEFAULT_WATER_SIMPLIFY_TOLERANCE_MM;
 let rejectedRings=0;
 const normalized:MultiPolygonMm=[];
 for(const polygon of water){
  const cleaned=normalizeWaterPolygon(polygon,()=>rejectedRings++);
  if(cleaned)normalized.push(cleaned);
 }

 const unioned=unionAll(normalized.map(polygon=>[polygon]),'Water');
 const clipped=intersect(unioned,innerDisk(options.innerRadiusMm,options.arcToleranceMm),'Water');
 const simplified=simplifyToleranceMm>0?simplifyGeometry(clipped,simplifyToleranceMm):clipped;
 const {geometry:cleaned,report}=repairGeometry(simplified,'Water',{
  minComponentAreaMm2:options.minComponentAreaMm2??DEFAULT_MIN_WATER_COMPONENT_AREA_MM2,
  minHoleAreaMm2:options.minHoleAreaMm2??DEFAULT_MIN_WATER_HOLE_AREA_MM2,
 });
 const repaired=normalizeTopology(cleaned,'Water');
 assertFinite(repaired,'Water');

 return {
  geometry:repaired,
  metrics:{
   inputPolygons:water.length,
   rejectedRings,
   components:repaired.length,
   holes:repaired.reduce((sum,polygon)=>sum+Math.max(0,polygon.length-1),0),
   filledHoles:report.filledHoles,
   droppedComponents:report.droppedComponents,
   areaMm2:geometryAreaMm2(repaired),
   vertices:countVertices(repaired),
  },
 };
}

// The annulus at the outer edge of the map disk that stays solid in water-cutout mode.
//
// This is the plan's "Add the structural outer ring back to the land piece so islands and coastal
// fragments remain registered and connected where possible" — and "where possible" is doing real
// work. A peninsula that reaches the rim is reconnected by the ring; an island in the middle of a
// lake is not, and no ring width will change that. What the ring buys is the common case: a coastline
// crossing the ornament, which without it would leave the entire seaward half of the disk as a loose
// crescent.
export function structuralRing(innerRadiusMm:number,ringWidthMm:number,arcToleranceMm=ARC_TOLERANCE_MM):MultiPolygonMm{
 const disk=innerDisk(innerRadiusMm,arcToleranceMm);
 const inner=innerRadiusMm-ringWidthMm;
 if(!disk.length)return [];
 if(!(ringWidthMm>0))return [];
 if(inner<=0)return disk;
 return subtract(disk,circle(0,0,inner,arcToleranceMm),'Structural ring');
}

export interface LandPieceOptions{
 innerRadiusMm:number;
 structuralRingWidthMm:number;
 minComponentAreaMm2?:number;
 minHoleAreaMm2?:number;
 arcToleranceMm?:number;
}

export interface LandPieceResult{
 land:MultiPolygonMm;
 // The water that is actually cut away. Not the same as the input water: the structural ring is
 // removed from it first, so land and cut are exact complements within the disk and a Phase 4 export
 // cannot emit two paths that disagree about where the shoreline is.
 waterCut:MultiPolygonMm;
 ring:MultiPolygonMm;
}

export function buildLandPiece(water:MultiPolygonMm,options:LandPieceOptions):LandPieceResult{
 const disk=innerDisk(options.innerRadiusMm,options.arcToleranceMm);
 const ring=structuralRing(options.innerRadiusMm,options.structuralRingWidthMm,options.arcToleranceMm);
 const inDisk=intersect(water,disk,'Water cutout');
 const waterCut=normalizeTopology(subtract(inDisk,ring,'Water cutout'),'Water cutout');
 const land=normalizeTopology(subtract(disk,waterCut,'Land piece'),'Land piece');
 const {geometry:cleanedLand}=repairGeometry(land,'Land piece',{
  minComponentAreaMm2:options.minComponentAreaMm2??0,
  minHoleAreaMm2:options.minHoleAreaMm2??0,
 });
 const {geometry:cleanedWater}=repairGeometry(waterCut,'Water cutout',{
  minComponentAreaMm2:options.minComponentAreaMm2??0,
  minHoleAreaMm2:options.minHoleAreaMm2??0,
 });
 assertFinite(cleanedLand,'Land piece');
 assertFinite(cleanedWater,'Water cutout');
 return {land:cleanedLand,waterCut:cleanedWater,ring};
}
