import type {MultiPolygonMm,RingMm} from '../../geometry/shoreline/polygonEngine';
import {ARC_TOLERANCE_MM} from '../geometry/circle';
import {offsetPaths} from '../geometry/offsetPaths';
import {geometryAreaMm2,normalizeTopology,subtract,unionAll} from '../geometry/polygonRepair';

// Erosion and dilation of finished geometry, which is how "is this thinner than X millimetres?" is
// answered without trusting the parameters the geometry was built from.
//
// Every width check in this phase measures the polygon that is actually going to be serialised into
// the SVG. That distinction is the whole point: the editor already checks the hanging loop
// analytically, from the diameters and the overlap, and that check cannot see a bug in the boolean
// chain, a repair pass that clipped the bridge, or a simplify that ate it. Eroding the emitted
// polygon can.
//
// ## Why the boundary-band construction rather than a negative polygon offset
//
// Clipper will offset a closed polygon by a negative delta directly, but which way "negative" goes
// depends on each ring's orientation, and this codebase works in a +y-downward space where the sign
// of a ring's signed area reads opposite to Clipper's own documentation. Getting that backwards
// inverts the test silently — a too-thin neck would report as comfortably wide. So erosion is built
// from a construction with no orientation in it at all:
//
//   erode(G, r)  = G − band(∂G, r)      the boundary thickened by r, removed from the inside
//   dilate(G, r) = G ∪ band(∂G, r)      the same band, added on the outside
//
// where band(∂G, r) is every ring offset as a *closed line* by r, which Clipper produces as a collar
// of width 2r straddling the boundary. Both identities are exact for a disk structuring element, and
// `ornamentMorphology.test.ts` pins them against known shapes (a disk, an annulus and a dumbbell)
// rather than taking them on trust.

export interface MorphologyOptions{arcToleranceMm?:number}

const ringsOf=(geometry:MultiPolygonMm):RingMm[]=>geometry.flat();

// The collar of width 2r straddling every boundary ring of the geometry.
export function boundaryBand(geometry:MultiPolygonMm,radiusMm:number,options:MorphologyOptions={}):MultiPolygonMm{
 if(!geometry.length||!(radiusMm>0))return [];
 return offsetPaths(ringsOf(geometry),radiusMm,{
  joinStyle:'round',
  endStyle:'closed-line',
  arcToleranceMm:options.arcToleranceMm??ARC_TOLERANCE_MM,
 });
}

export function erodeGeometry(geometry:MultiPolygonMm,radiusMm:number,options:MorphologyOptions={}):MultiPolygonMm{
 if(!geometry.length)return [];
 if(!(radiusMm>0))return geometry;
 const band=boundaryBand(geometry,radiusMm,options);
 if(!band.length)return geometry;
 return normalizeTopology(subtract(geometry,band,'Erosion'),'Erosion');
}

export function dilateGeometry(geometry:MultiPolygonMm,radiusMm:number,options:MorphologyOptions={}):MultiPolygonMm{
 if(!geometry.length)return [];
 if(!(radiusMm>0))return geometry;
 const band=boundaryBand(geometry,radiusMm,options);
 if(!band.length)return geometry;
 return normalizeTopology(unionAll([geometry,band],'Dilation'),'Dilation');
}

export interface ThinFeatureReport{
 // Material that survives in the geometry but not in its morphological opening: every region
 // narrower than `minWidthMm` across.
 geometry:MultiPolygonMm;
 areaMm2:number;
 regions:number;
 minWidthMm:number;
}

// The morphological opening — erode then dilate by the same radius — removes exactly those parts of
// a shape a disk of that radius cannot reach into. What the original has and the opening does not is
// therefore precisely the sub-minimum-width material, which is the plan's "minimum neck/feature
// width" preflight check applied to a whole piece rather than to one junction.
//
// Slivers below `noiseAreaMm2` are discarded: the two offsets are computed on a 0.001mm integer grid
// and their boundaries do not land on identical coordinates, so a perfectly uniform shape still
// leaves a thread of area behind. The floor is far below any feature a laser can resolve.
export const OPENING_NOISE_AREA_MM2=.02;

export function thinFeatures(geometry:MultiPolygonMm,minWidthMm:number,options:MorphologyOptions={}):ThinFeatureReport{
 const empty:ThinFeatureReport={geometry:[],areaMm2:0,regions:0,minWidthMm};
 if(!geometry.length||!(minWidthMm>0))return empty;
 const radius=minWidthMm/2;
 const opened=dilateGeometry(erodeGeometry(geometry,radius,options),radius,options);
 if(!opened.length)return {geometry,areaMm2:geometryAreaMm2(geometry),regions:geometry.length,minWidthMm};
 const thin=normalizeTopology(subtract(geometry,opened,'Thin features'),'Thin features')
  .filter(polygon=>geometryAreaMm2([polygon])>OPENING_NOISE_AREA_MM2);
 return {geometry:thin,areaMm2:geometryAreaMm2(thin),regions:thin.length,minWidthMm};
}
