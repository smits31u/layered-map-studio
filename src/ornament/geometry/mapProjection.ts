import {mercator} from '../../geometry/projection/cropProjection';
import type {PolylineMm} from './clipLine';

// Map geography → ornament millimetres.
//
// The plan's §Coordinate system is the whole specification: freeze the viewport at export start, put
// the ornament centre at (0,0) with +y downward, and convert screen pixels with
// `diameterMm / renderedMapDiameterPx`. What is written here is the two halves of that — a frozen
// viewport record, and the projection derived from it — with no MapLibre object in sight, so every
// millimetre in an export can be recomputed from a JSON blob in a test or in a worker.
//
// ## Why this is not CropProjection
//
// The lake tool's `CropProjection` maps lng/lat into a rectangle defined by four *arbitrary*
// geographic corners, by Newton-iterating the inverse of a bilinear interpolation. It is built for a
// crop the user dragged out, which need not be axis-aligned in Mercator space.
//
// An ornament capture is the opposite case by construction: the plan forbids bearing and pitch, so
// the viewport is an axis-aligned Mercator rectangle, and over such a rectangle the bilinear map
// degenerates to an affine one. Running twelve Newton iterations per vertex to invert an affine map
// gives the same answer as one subtraction and one multiply, several hundred thousand times per
// capture, and then lands in a top-left-origin box that the ornament would have to translate to
// centre-origin anyway.
//
// So the *math* is reused — `mercator` below is the lake tool's own forward projection, exported
// rather than copied, which is what keeps the two tools on one definition of Web Mercator — and only
// the inverse-bilinear wrapper is left behind. `ornamentProjection.test.ts` asserts the two agree at
// the viewport corners and at interior points, so the claim in this comment is checked rather than
// asserted.

export type LngLatTuple=[number,number];

// MapLibre's vector tiles are 512px. The projection scale is `tileSize · 2^zoom` pixels per world,
// so getting this wrong scales every feature; it is a field rather than a constant so a capture
// records the value it was taken with instead of trusting a future default.
export const MAPLIBRE_TILE_SIZE=512;

// Web Mercator is undefined at the poles. MapLibre clamps to this latitude and so does every tile
// scheme; a feature coordinate beyond it is data corruption, and clamping keeps one bad vertex from
// turning into an Infinity that propagates through the whole union.
export const MAX_MERCATOR_LATITUDE=85.051128779806604;

// Everything the geometry pipeline is allowed to know about the map, captured once at the start of
// an export and never re-read. The plan: "Freeze the map center, zoom, bounds, canvas size, bearing,
// and pitch at export start."
export interface ViewportSnapshot{
 center:LngLatTuple;
 zoom:number;
 // Literal 0 rather than number, for the same reason OrnamentProject uses literals: the first
 // release must enforce bearing 0 and pitch 0, and a literal makes a rotated capture a compile
 // error instead of a runtime check somebody forgets to call.
 bearing:0;
 pitch:0;
 // The measured size of the rendered map element, in CSS pixels. Square, because the ornament's map
 // element is the square circumscribing the inner disk.
 widthPx:number;
 heightPx:number;
 // [west, south, east, north] at capture time. Not used by the projection — recorded so a capture
 // can be described, compared and debugged without re-deriving it from centre and zoom.
 bounds:[number,number,number,number];
 tileSize:number;
}

export class ZeroSizedViewportError extends Error{
 constructor(message:string){super(message);this.name='ZeroSizedViewportError'}
}

// The plan is emphatic: "Do not infer export scale from an arbitrary DOM fallback. Require a
// measured map viewport and fail clearly if it is zero-sized." A silently-substituted fallback here
// would produce an ornament whose roads are the wrong physical size — which nothing downstream can
// detect and the laser will happily cut.
export function exportScaleMmPerPx(mapDiameterMm:number,renderedMapDiameterPx:number):number{
 if(!Number.isFinite(renderedMapDiameterPx)||renderedMapDiameterPx<=0)
  throw new ZeroSizedViewportError('The map has not been measured yet (its rendered size is zero), so captured geometry has no physical scale. Wait for the preview to lay out and capture again.');
 if(!Number.isFinite(mapDiameterMm)||mapDiameterMm<=0)
  throw new ZeroSizedViewportError('The ornament has no map opening to project into — check the diameter and rim width.');
 return mapDiameterMm/renderedMapDiameterPx;
}

export type ProjectPoint=(lng:number,lat:number)=>[number,number];

// A closure rather than a class: it captures four numbers, is called once per vertex, and has no
// state to invalidate. `mmPerPx` folds the plan's pixel→millimetre division in, so a projected
// coordinate is already in ornament space and there is no intermediate pixel value for anything
// downstream to mistake for one.
export function createMapProjection(viewport:ViewportSnapshot,mmPerPx:number):ProjectPoint{
 const worldSize=viewport.tileSize*Math.pow(2,viewport.zoom);
 const scale=worldSize*mmPerPx;
 const origin=mercator({lng:viewport.center[0],lat:clampLatitude(viewport.center[1])});
 return (lng,lat)=>{
  if(!Number.isFinite(lng)||!Number.isFinite(lat))return [Number.NaN,Number.NaN];
  const point=mercator({lng,lat:clampLatitude(lat)});
  return [(point.x-origin.x)*scale,(point.y-origin.y)*scale];
 };
}

export const clampLatitude=(lat:number)=>Math.min(MAX_MERCATOR_LATITUDE,Math.max(-MAX_MERCATOR_LATITUDE,lat));

export const projectLine=(line:LngLatTuple[],project:ProjectPoint):PolylineMm=>line.map(([lng,lat])=>project(lng,lat));

export const projectRings=(rings:LngLatTuple[][],project:ProjectPoint):PolylineMm[]=>rings.map(ring=>projectLine(ring,project));

// The four corners of the frozen viewport, as ornament millimetres. Half of the map element's own
// width and height, because the ornament centre is the map element's centre — the registration
// `mapWindowLayout` establishes and `ornamentCropMask.test.ts` pins.
export function viewportCornersMm(viewport:ViewportSnapshot,mmPerPx:number):{nw:[number,number];ne:[number,number];se:[number,number];sw:[number,number]}{
 const halfW=viewport.widthPx*mmPerPx/2,halfH=viewport.heightPx*mmPerPx/2;
 return {nw:[-halfW,-halfH],ne:[halfW,-halfH],se:[halfW,halfH],sw:[-halfW,halfH]};
}
