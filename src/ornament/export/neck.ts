import type {MultiPolygonMm} from '../../geometry/shoreline/polygonEngine';
import {ARC_TOLERANCE_MM,circle,halfPlaneAbove} from '../geometry/circle';
import type {OrnamentGeometry} from '../geometry/ornamentShape';
import {geometryAreaMm2,intersect,subtract} from '../geometry/polygonRepair';
import type {OrnamentProject} from '../types';
import {erodeGeometry} from './morphology';

// How wide the hanging loop's neck actually is, measured on the geometry that is about to be cut.
//
// This is the highest-consequence check in the export. A neck that is too thin does not look wrong —
// it looks exactly right, all the way through preview, export, import and the cut itself — and then
// the ornament snaps off its loop in a box in December. Nothing downstream of this function can
// detect it, so it is the last place it can be caught.
//
// ## Why the editor's existing check is not enough
//
// `evaluateHangingLoop` solves the two circles' radical line and reports the chord where they cross.
// That is correct arithmetic about the *parameters*, and Phase 1 blocks on it. It is not a statement
// about the *polygon*. It cannot see:
//
//   * the loop hole dipping below the junction line, which turns one wide neck into two thin struts —
//     the chord is unchanged and the annulus is unchanged, so both existing checks still pass;
//   * a mistake anywhere in the boolean chain that builds the frame, since the chord is computed from
//     the diameters and never looks at the result;
//   * a repair, simplify or arc-flattening pass trimming the bridge, for the same reason.
//
// So this measures the emitted polygon instead, and it measures the quantity the requirement is
// actually about — not "how wide is the chord" but "how much material connects the loop to the body".
// Those are the same number on a healthy ornament and different numbers on a broken one.
//
// ## The measurement
//
// Erode the frame by w/2 and ask whether any single connected component still contains both loop
// material and body material. That is the definition of "joined by at least w of material": a disk of
// diameter w can be slid from the loop to the body without leaving the shape exactly when the
// connection is everywhere at least w wide. Binary-searching w for the largest value that still
// passes gives the neck width itself, in millimetres, with no assumption about where the neck is or
// what shape it has.
//
// The probes are regions, not points, so nothing depends on guessing a coordinate that survives
// erosion:
//
//   loop probe — the half of the loop's annulus on the far side of the hole from the body: the
//                material a ribbon actually hangs from.
//   body probe — the frame inside the body disk and outside the loop: material that can only be the
//                body.
//
// The loop probe is the far half rather than the whole annulus on purpose. The whole annulus reaches
// right down to where the loop meets the body, and a component that merely touches that last sliver
// would count as "connected to the loop" without ever crossing the bridge — so a design notched
// anywhere between the hanging point and the body would measure as healthy. Taking the far half
// forces the measurement to traverse the entire load path, which is the thing that has to hold.
//
// Both are derived from the same circles the frame was built from, so a frame that does not contain
// them is itself the finding.

export interface NeckMeasurement{
 // The largest width, in millimetres, at which the loop is still joined to the body through the
 // emitted geometry. Saturates at `searchedToMm` when the neck is wider than the search ever went.
 measuredMm:number;
 requiredMm:number;
 // False when the loop and the body are not one piece even before any erosion — a detached loop.
 attachedAtAll:boolean;
 meetsMinimum:boolean;
 // True when the search hit its ceiling, so `measuredMm` is a lower bound rather than the answer.
 saturated:boolean;
 searchedToMm:number;
 resolutionMm:number;
 loopProbeAreaMm2:number;
 bodyProbeAreaMm2:number;
 // The chord where the two circles cross, as the editor computes it.
 analyticJunctionMm:number;
 // What the parameters predict the measurement will find: the thinnest place on the whole path from
 // the loop to the body, which is the narrower of the junction chord and the loop's own annulus.
 //
 // These two are different numbers and it matters which one is compared against. The junction chord
 // on a default ornament is 11.90mm while the annulus is 4mm — so a measurement that walks from loop
 // material to body material has to squeeze through 4mm, and reporting 11.90mm as "the neck" would
 // overstate the connection by a factor of three. The analytic prediction below is what a healthy
 // export should measure; a large gap between prediction and measurement means the polygon is not
 // the shape the parameters describe.
 analyticNeckMm:number;
}

export interface NeckOptions{
 resolutionMm?:number;
 maxSearchMm?:number;
 arcToleranceMm?:number;
 // Overlap below which a probe is considered not to have been touched at all. Well under anything
 // fabricable, and well over the sliver two independently-offset boundaries leave behind.
 probeTouchAreaMm2?:number;
 // Where the frame was placed on the sheet. The probes are built in ornament-local coordinates and
 // the geometry being measured is in sheet coordinates, so one of the two has to move; moving the
 // probes means the polygon under test is the one that will be written to the file, untouched.
 offsetMm?:[number,number];
}

export const DEFAULT_NECK_RESOLUTION_MM=.01;
export const DEFAULT_NECK_PROBE_TOUCH_AREA_MM2=.01;

export interface NeckProbes{loop:MultiPolygonMm;body:MultiPolygonMm}

// Regions that can only be loop and can only be body. Both are built from the same circles
// `buildOrnamentGeometry` used, so they describe the frame that exists rather than an idealised one.
const shift=(geometry:MultiPolygonMm,offsetMm:[number,number]|undefined):MultiPolygonMm=>
 !offsetMm||(!offsetMm[0]&&!offsetMm[1])
  ?geometry
  :geometry.map(polygon=>polygon.map(ring=>ring.map(([x,y])=>[x+offsetMm[0],y+offsetMm[1]] as [number,number])));

export function neckProbes(geometry:OrnamentGeometry,arcToleranceMm=ARC_TOLERANCE_MM,offsetMm?:[number,number]):NeckProbes{
 const {loop}=geometry;
 const body=circle(0,0,geometry.outerRadiusMm,arcToleranceMm);
 const loopOuter=circle(0,loop.centerY,loop.outerRadiusMm,arcToleranceMm);
 const loopHole=loop.innerRadiusMm>0?circle(0,loop.centerY,loop.innerRadiusMm,arcToleranceMm):[];
 const opening=geometry.innerRadiusMm>0?circle(0,0,geometry.innerRadiusMm,arcToleranceMm):[];
 const extent=(geometry.outerRadiusMm+loop.outerRadiusMm)*3;
 // The loop's far half: its annulus above the hole's centre line, minus anything that is also body.
 const annulus=subtract(loopOuter,loopHole,'Loop probe');
 const farHalf=intersect(annulus,halfPlaneAbove(loop.centerY,extent),'Loop probe');
 const loopProbe=subtract(farHalf,body,'Loop probe');
 // The body's own material: the rim and text band, minus the loop's footprint. The map opening is
 // removed because it is a void in the frame, not material, and a probe that included it could be
 // "touched" by a component that merely passes over the hole.
 const bodyProbe=subtract(subtract(body,loopOuter,'Body probe'),opening,'Body probe');
 return {loop:shift(loopProbe,offsetMm),body:shift(bodyProbe,offsetMm)};
}

const touches=(component:MultiPolygonMm,probe:MultiPolygonMm,minAreaMm2:number):boolean=>
 probe.length>0&&geometryAreaMm2(intersect(component,probe,'Neck probe'))>minAreaMm2;

// True when some single connected component of the eroded frame holds both loop and body material.
//
// polygon-clipping returns a MultiPolygon whose member polygons are disjoint, so "component" and
// "member polygon" are the same thing here — the same property `landIslands.ts` relies on, and it
// holds for the same reason: the geometry has been through the boolean engine.
export function loopJoinedAtWidth(frame:MultiPolygonMm,probes:NeckProbes,widthMm:number,options:NeckOptions={}):boolean{
 if(!frame.length)return false;
 const touch=options.probeTouchAreaMm2??DEFAULT_NECK_PROBE_TOUCH_AREA_MM2;
 const eroded=widthMm>0?erodeGeometry(frame,widthMm/2,{arcToleranceMm:options.arcToleranceMm}):frame;
 for(const polygon of eroded){
  const component=[polygon];
  if(touches(component,probes.loop,touch)&&touches(component,probes.body,touch))return true;
 }
 return false;
}

export function measureLoopNeck(
 frame:MultiPolygonMm,
 geometry:OrnamentGeometry,
 ornament:OrnamentProject['ornament'],
 options:NeckOptions={},
):NeckMeasurement{
 const resolutionMm=options.resolutionMm??DEFAULT_NECK_RESOLUTION_MM;
 const required=ornament.hangingLoop.minNeckWidthMm;
 const probes=neckProbes(geometry,options.arcToleranceMm,options.offsetMm);
 // Search well past the requirement so a healthy ornament reports a real number rather than "at
 // least the minimum", which would hide a neck quietly shrinking towards it across a run of edits.
 const searchedToMm=options.maxSearchMm??Math.max(required*4,geometry.loop.annulusWidthMm*4,ornament.rimWidthMm*2,12);
 const base={
  requiredMm:required,
  searchedToMm,
  resolutionMm,
  loopProbeAreaMm2:geometryAreaMm2(probes.loop),
  bodyProbeAreaMm2:geometryAreaMm2(probes.body),
  analyticJunctionMm:geometry.loop.junctionWidthMm,
  analyticNeckMm:Math.min(geometry.loop.junctionWidthMm,geometry.loop.annulusWidthMm),
 };

 if(!loopJoinedAtWidth(frame,probes,0,options))
  return {...base,measuredMm:0,attachedAtAll:false,meetsMinimum:false,saturated:false};

 if(loopJoinedAtWidth(frame,probes,searchedToMm,options))
  return {...base,measuredMm:searchedToMm,attachedAtAll:true,meetsMinimum:searchedToMm>=required,saturated:true};

 // Invariant through the loop: `lo` is a width the join survives, `hi` is one it does not.
 let lo=0,hi=searchedToMm;
 while(hi-lo>resolutionMm){
  const mid=(lo+hi)/2;
  if(loopJoinedAtWidth(frame,probes,mid,options))lo=mid;else hi=mid;
 }
 const measuredMm=Number(lo.toFixed(3));
 return {...base,measuredMm,attachedAtAll:true,meetsMinimum:measuredMm>=required,saturated:false};
}

export const neckSummary=(measurement:NeckMeasurement):string=>
 measurement.attachedAtAll
  ?measurement.measuredMm.toFixed(2)+'mm'+(measurement.saturated?'+':'')+' of material joins the loop to the body (minimum '+measurement.requiredMm+'mm)'
  :'the loop is not joined to the body at all';
