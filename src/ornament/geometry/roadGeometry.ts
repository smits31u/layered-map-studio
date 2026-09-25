import {simplifyGeometry} from '../../geometry/shoreline/artisticDepth';
import type {MultiPolygonMm} from '../../geometry/shoreline/polygonEngine';
import {ARC_TOLERANCE_MM} from './circle';
import {clipPolylinesToMapWindow,type MapWindow,type PolylineMm} from './clipLine';
import {offsetPaths} from './offsetPaths';
import {assertFinite,countVertices,geometryAreaMm2,normalizeTopology,repairGeometry,unionAll} from './polygonRepair';
import {quantiseWidthMm,roadClassesForDetailSet,roadWidthMm,type RoadWidthSettings} from './roadWidths';
import type {RoadDetail} from '../types';

// Road centrelines → engraving geometry.
//
// The plan's §Roads gives the pipeline in order and this file follows it literally: "Clip
// centerlines, offset them with round joins/caps, union, simplify, remove tiny islands, and run
// polygon repair."
//
// Two of those steps are load-bearing in ways that are easy to get backwards:
//
//   * **Clip first, offset second.** Offsetting before clipping and then intersecting with the disk
//     would produce square-looking ends wherever a road meets the rim — the round cap would be cut
//     off by the disk boundary. Clipping the centreline first means every end the offsetter sees is
//     a real end, and gets a real round cap. It is also enormously cheaper: a city capture that is
//     90% outside the ornament does 90% less offsetting.
//   * **Simplify after union, not before.** Simplifying centrelines first would move them, and two
//     roads that met at a junction would stop meeting. Simplifying the unioned outline only removes
//     vertices from a shape that is already final.
//
// The clipping itself is Phase 1's `clipPolylinesToMapWindow`, unchanged and unforked. It was
// written against the same circle-and-chord region the preview's crop mask is built from, and it
// already handles every case the plan names for it (tangents, endpoints on the circle, multiple
// re-entry, zero-length pieces) — a captured road is just another polyline.

export interface ProjectedRoad{roadClass:string;line:PolylineMm}

export interface RoadGeometryOptions{
 detail:RoadDetail;
 widths:RoadWidthSettings;
 // Where centrelines are clipped before buffering: the ornament's map window, or any other clip as a
 // function of one polyline (the topo builder passes its board rectangle).
 window:MapWindow|((line:PolylineMm)=>PolylineMm[]);
 // Vertices closer to the outline than this are removed after the union.
 //
 // The default is derived from the narrowest road in the build rather than fixed, and the reason is
 // the requirement immediately above it: road ends must stay round. A cap on a 0.25mm road is an arc
 // of radius 0.125mm, and simplifying that at the ornament's general 0.02mm sagitta budget would
 // collapse it into a straight line — the engraving would come out with blunt ends and nothing would
 // report it. Tying the tolerance to the buffer radius keeps simplification doing what it is for
 // (removing the collinear runs Clipper emits along straight roads) and nothing else.
 simplifyToleranceMm?:number;
 // Islands below this are removed ("remove tiny islands"). The default is the area of a square of
 // the thinnest engravable line, which is the smallest mark the machine can make on purpose.
 minIslandAreaMm2?:number;
 minHoleAreaMm2?:number;
}

export interface RoadGeometryMetrics{
 inputRoads:number;
 roadsOutsideDetail:number;
 clippedPieces:number;
 widthGroups:number;
 widthsMm:number[];
 areaMm2:number;
 vertices:number;
 droppedIslands:number;
 filledHoles:number;
}

export interface RoadGeometryResult{geometry:MultiPolygonMm;metrics:RoadGeometryMetrics}

export const DEFAULT_ROAD_SIMPLIFY_TOLERANCE_MM=ARC_TOLERANCE_MM/2;
export const DEFAULT_MIN_ROAD_ISLAND_AREA_MM2=.0625;

// Sagitta as a fraction of the buffer radius, chosen so a cap is always at least sixteen segments
// around a full circle: acos(1 - 0.019) ≈ π/16. The ornament's absolute 0.02mm budget is kept as a
// ceiling, so a wide road never gets a *finer* cap than the rim it sits inside.
const CAP_SAGITTA_RATIO=.019;
export const capArcToleranceMm=(halfWidthMm:number)=>Math.min(ARC_TOLERANCE_MM,Math.max(1e-4,halfWidthMm*CAP_SAGITTA_RATIO));
// A tenth of the cap's own sagitta: enough to drop collinear vertices, far too fine to touch an arc.
export const roadSimplifyToleranceMm=(narrowestHalfWidthMm:number)=>
 Math.min(DEFAULT_ROAD_SIMPLIFY_TOLERANCE_MM,capArcToleranceMm(narrowestHalfWidthMm)/10);

export function buildRoadEngraving(roads:ProjectedRoad[],options:RoadGeometryOptions):RoadGeometryResult{
 const allowed=roadClassesForDetailSet(options.detail);
 const minIslandAreaMm2=options.minIslandAreaMm2??DEFAULT_MIN_ROAD_ISLAND_AREA_MM2;

 // Grouped by physical width so each width is one offset pass. A Map keyed on the quantised width
 // preserves insertion order, which keeps the union's argument order — and therefore its output — a
 // function of the capture alone.
 const byWidth=new Map<number,PolylineMm[]>();
 let roadsOutsideDetail=0,clippedPieces=0;
 for(const road of roads){
  if(!allowed.has(road.roadClass)){roadsOutsideDetail++;continue}
  const pieces=typeof options.window==='function'?options.window(road.line):clipPolylinesToMapWindow([road.line],options.window);
  if(!pieces.length)continue;
  clippedPieces+=pieces.length;
  const width=quantiseWidthMm(roadWidthMm(road.roadClass,options.widths));
  const bucket=byWidth.get(width);
  if(bucket)bucket.push(...pieces);
  else byWidth.set(width,[...pieces]);
 }

 const buffered:MultiPolygonMm[]=[];
 for(const [widthMm,lines] of byWidth){
  // Round joins and round caps, as required. `offsetPaths` defaults to both; they are passed
  // explicitly because they are a fabrication requirement rather than a convenience — a square cap
  // on an engraved road end reads as a deliberate blunt terminus on the finished piece.
  const part=offsetPaths(lines,widthMm/2,{joinStyle:'round',endStyle:'open-round',arcToleranceMm:capArcToleranceMm(widthMm/2)});
  if(part.length)buffered.push(part);
 }

 const narrowestHalfWidthMm=byWidth.size?Math.min(...byWidth.keys())/2:DEFAULT_ROAD_SIMPLIFY_TOLERANCE_MM;
 const simplifyToleranceMm=options.simplifyToleranceMm??roadSimplifyToleranceMm(narrowestHalfWidthMm);

 const unioned=unionAll(buffered,'Road engraving');
 const simplified=simplifyToleranceMm>0?simplifyGeometry(unioned,simplifyToleranceMm):unioned;
 const {geometry:cleaned,report}=repairGeometry(simplified,'Road engraving',{
  minComponentAreaMm2:minIslandAreaMm2,
  minHoleAreaMm2:options.minHoleAreaMm2??minIslandAreaMm2,
 });
 // The final topology pass. Simplification can make two previously-touching outlines overlap by a
 // fraction of the tolerance, and an overlapping pair of rings is not a valid MultiPolygon for
 // anything that comes after.
 const repaired=normalizeTopology(cleaned,'Road engraving');
 assertFinite(repaired,'Road engraving');

 return {
  geometry:repaired,
  metrics:{
   inputRoads:roads.length,
   roadsOutsideDetail,
   clippedPieces,
   widthGroups:byWidth.size,
   widthsMm:[...byWidth.keys()].sort((a,b)=>a-b),
   areaMm2:geometryAreaMm2(repaired),
   vertices:countVertices(repaired),
   droppedIslands:report.droppedComponents,
   filledHoles:report.filledHoles,
  },
 };
}
