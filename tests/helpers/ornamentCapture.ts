import {extractCapturedFeatures,type CaptureMapFeature} from '../../src/ornament/capture/mapCapture';
import type {FeatureCapture} from '../../src/ornament/capture/featureTypes';
import {exportScaleMmPerPx,MAPLIBRE_TILE_SIZE} from '../../src/ornament/geometry/mapProjection';
import {OPENFREEMAP} from '../../src/ornament/map/provider';
import type {RoadDetail} from '../../src/ornament/types';
import {FIXTURE_CANVAS_PX,FIXTURE_CENTER,FIXTURE_ZOOM} from '../fixtures/ornament/captures';

// Builds a FeatureCapture from fixture features without going near MapLibre.
//
// This is the seam the whole Phase 3 pipeline is designed around: everything downstream of a capture
// is pure, so a test can construct the capture directly and exercise projection, clipping, buffering,
// water and island policy with no map, no WebGL and no network. `capturedAt` is fixed rather than
// `Date.now()` so a golden comparison of a whole capture stays stable.

export const DEFAULT_INNER_RADIUS_MM=(101.6-2*6)/2;
export const DEFAULT_CHORD_Y_MM=14;

export interface FixtureCaptureOptions{
 detail?:RoadDetail;
 innerRadiusMm?:number;
 chordYMm?:number;
 zoom?:number;
 canvasPx?:number;
 center?:[number,number];
}

export function fixtureCapture(features:CaptureMapFeature[],options:FixtureCaptureOptions={}):FeatureCapture{
 const canvasPx=options.canvasPx??FIXTURE_CANVAS_PX;
 const innerRadiusMm=options.innerRadiusMm??DEFAULT_INNER_RADIUS_MM;
 const center=options.center??FIXTURE_CENTER;
 const zoom=options.zoom??FIXTURE_ZOOM;
 return {
  viewport:{
   center:[center[0],center[1]],
   zoom,
   bearing:0,
   pitch:0,
   widthPx:canvasPx,
   heightPx:canvasPx,
   bounds:boundsFor(center,zoom,canvasPx),
   tileSize:MAPLIBRE_TILE_SIZE,
  },
  mmPerPx:exportScaleMmPerPx(innerRadiusMm*2,canvasPx),
  innerRadiusMm,
  chordYMm:options.chordYMm??DEFAULT_CHORD_Y_MM,
  detail:options.detail??'medium',
  features:extractCapturedFeatures(features,OPENFREEMAP),
  capturedAt:0,
 };
}

// Web Mercator bounds of a square viewport, computed the same way MapLibre does. Only used for the
// `bounds` field a capture records for description and debugging; nothing projects through it.
export function boundsFor(center:[number,number],zoom:number,sizePx:number):[number,number,number,number]{
 const worldSize=MAPLIBRE_TILE_SIZE*Math.pow(2,zoom);
 const half=sizePx/2/worldSize;
 const x=(center[0]+180)/360;
 const latRad=center[1]*Math.PI/180;
 const y=(1-Math.log(Math.tan(latRad)+1/Math.cos(latRad))/Math.PI)/2;
 const lng=(value:number)=>value*360-180;
 const lat=(value:number)=>{
  const n=Math.PI-2*Math.PI*value;
  return 180/Math.PI*Math.atan(.5*(Math.exp(n)-Math.exp(-n)));
 };
 return [lng(x-half),lat(y+half),lng(x+half),lat(y-half)];
}
