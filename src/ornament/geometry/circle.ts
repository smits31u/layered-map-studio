import type {MultiPolygonMm,RingMm} from '../../geometry/shoreline/polygonEngine';

// Default sagitta budget for flattening a circle to a polygon. 0.02mm, not the shoreline engine's
// 0.25mm — see ADR 0001 for the measured reason: at 0.25mm a 1mm-radius arc degenerates to 6
// vertices and loses 5% of its area, which is invisible on a 355mm lake panel and obvious on a
// 101.6mm ornament rim.
export const ARC_TOLERANCE_MM=.02;

// Segments needed so the polygon never deviates from the true circle by more than toleranceMm.
// Sagitta of one segment is r(1 - cos(pi/n)); solving for n gives pi/acos(1 - tol/r). Clamped low
// so degenerate radii cannot produce a 3-gon, and clamped high so a tiny tolerance on a large
// radius cannot emit a pathological vertex count.
export function circleSegments(radiusMm:number,toleranceMm=ARC_TOLERANCE_MM):number{
 if(!(radiusMm>0)||!(toleranceMm>0))return 12;
 const ratio=1-Math.min(toleranceMm,radiusMm)/radiusMm;
 const n=Math.ceil(Math.PI/Math.acos(Math.max(-1,Math.min(1,ratio))));
 return Math.max(12,Math.min(2048,Number.isFinite(n)?n:12));
}

// Closed ring (last point repeats the first), matching the RingMm convention used by the shoreline
// engine so both tools' geometry flows through the same boolean and serialization helpers.
export function circleRing(cx:number,cy:number,radiusMm:number,toleranceMm=ARC_TOLERANCE_MM):RingMm{
 const n=circleSegments(radiusMm,toleranceMm),ring:RingMm=[];
 for(let i=0;i<n;i++){const t=2*Math.PI*i/n;ring.push([cx+radiusMm*Math.cos(t),cy+radiusMm*Math.sin(t)])}
 ring.push([...ring[0]] as [number,number]);
 return ring;
}

export const circle=(cx:number,cy:number,radiusMm:number,toleranceMm=ARC_TOLERANCE_MM):MultiPolygonMm=>[[circleRing(cx,cy,radiusMm,toleranceMm)]];

// Everything strictly above `y` (smaller y — geometry space is +y downward), as a rectangle large
// enough to act as a half-plane for the extent it will be intersected against. Used for chord
// clipping: the ornament's map window is the inner disk above the map/text boundary.
export function halfPlaneAbove(y:number,extentMm:number):MultiPolygonMm{
 const e=Math.abs(extentMm);
 return [[[[-e,-e],[e,-e],[e,y],[-e,y],[-e,-e]]]];
}

export function halfPlaneBelow(y:number,extentMm:number):MultiPolygonMm{
 const e=Math.abs(extentMm);
 return [[[[-e,y],[e,y],[e,e],[-e,e],[-e,y]]]];
}

// Half-width of the chord at height y inside a circle of the given radius centred at the origin:
// the horizontal space actually available to a text line sitting at that height. Zero outside.
export const chordHalfWidthAt=(y:number,radiusMm:number)=>{const d=radiusMm*radiusMm-y*y;return d>0?Math.sqrt(d):0};
