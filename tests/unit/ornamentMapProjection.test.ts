import {describe,expect,it} from 'vitest';
import {CropProjection,cropFromCorners} from '../../src/geometry/projection/cropProjection';
import {
 clampLatitude,
 createMapProjection,
 exportScaleMmPerPx,
 MAPLIBRE_TILE_SIZE,
 viewportCornersMm,
 ZeroSizedViewportError,
 type ViewportSnapshot,
} from '../../src/ornament/geometry/mapProjection';
import {FIXTURE_CENTER,FIXTURE_ZOOM,offsetLngLat} from '../fixtures/ornament/captures';
import {boundsFor} from '../helpers/ornamentCapture';

// The plan's §Coordinate system, and the claim made in `mapProjection.ts`'s header comment: the
// ornament reuses the lake tool's Mercator but not the inverse-bilinear wrapper around it, because
// over a bearing-0 viewport the two give the same answer. That claim is checked here rather than
// asserted in a comment.

const viewport=(over:Partial<ViewportSnapshot>={}):ViewportSnapshot=>({
 center:[FIXTURE_CENTER[0],FIXTURE_CENTER[1]],
 zoom:FIXTURE_ZOOM,
 bearing:0,
 pitch:0,
 widthPx:400,
 heightPx:400,
 bounds:boundsFor(FIXTURE_CENTER,FIXTURE_ZOOM,400),
 tileSize:MAPLIBRE_TILE_SIZE,
 ...over,
});

describe('export scale',()=>{
 it('is diameter divided by rendered pixels, exactly as the plan specifies',()=>{
  expect(exportScaleMmPerPx(89.6,400)).toBeCloseTo(.224,12);
 });

 // "Do not infer export scale from an arbitrary DOM fallback. Require a measured map viewport and
 // fail clearly if it is zero-sized."
 it('refuses a zero-sized viewport rather than substituting a fallback',()=>{
  expect(()=>exportScaleMmPerPx(89.6,0)).toThrow(ZeroSizedViewportError);
  expect(()=>exportScaleMmPerPx(89.6,Number.NaN)).toThrow(ZeroSizedViewportError);
  expect(()=>exportScaleMmPerPx(89.6,-10)).toThrow(ZeroSizedViewportError);
 });

 it('refuses an ornament with no map opening',()=>{
  expect(()=>exportScaleMmPerPx(0,400)).toThrow(ZeroSizedViewportError);
 });

 it('says how to recover rather than only that it failed',()=>{
  expect(()=>exportScaleMmPerPx(89.6,0)).toThrow(/capture again/i);
 });
});

describe('projection',()=>{
 const mmPerPx=exportScaleMmPerPx(89.6,400);

 it('puts the viewport centre at the ornament centre',()=>{
  const project=createMapProjection(viewport(),mmPerPx);
  const [x,y]=project(FIXTURE_CENTER[0],FIXTURE_CENTER[1]);
  expect(x).toBeCloseTo(0,12);
  expect(y).toBeCloseTo(0,12);
 });

 it('puts +y downward, to match SVG',()=>{
  const project=createMapProjection(viewport(),mmPerPx);
  const north=offsetLngLat(0,500);
  expect(project(north[0],north[1])[1]).toBeLessThan(0);
 });

 it('puts +x east',()=>{
  const project=createMapProjection(viewport(),mmPerPx);
  const east=offsetLngLat(500,0);
  expect(project(east[0],east[1])[0]).toBeGreaterThan(0);
 });

 // "Pixel-to-mm projection at several rendered sizes" from the acceptance suite.
 //
 // The invariant is about pixels, not about places: a point a quarter of the viewport from the
 // centre lands a quarter of the map opening from the ornament centre, whatever size the element was
 // rendered at. A *fixed place* deliberately does not stay put — a larger element at the same zoom
 // fits more ground into the same 89.6mm, which is the whole reason the export scale is measured
 // rather than assumed.
 it('maps a given fraction of the viewport to the same millimetre at every rendered size',()=>{
  const worldSize=MAPLIBRE_TILE_SIZE*Math.pow(2,FIXTURE_ZOOM);
  for(const size of [200,400,640,1024]){
   const view=viewport({widthPx:size,heightPx:size});
   const project=createMapProjection(view,exportScaleMmPerPx(89.6,size));
   // The longitude sitting exactly a quarter of the element's width east of centre.
   const lng=FIXTURE_CENTER[0]+(size/4/worldSize)*360;
   expect(project(lng,FIXTURE_CENTER[1])[0]).toBeCloseTo(89.6/4,9);
  }
 });

 // And the consequence, stated explicitly so it is a decision rather than a surprise.
 it('fits more ground into the ornament as the rendered element grows',()=>{
  const place=offsetLngLat(320,0);
  const small=createMapProjection(viewport({widthPx:200,heightPx:200}),exportScaleMmPerPx(89.6,200))(place[0],place[1])[0];
  const large=createMapProjection(viewport({widthPx:400,heightPx:400}),exportScaleMmPerPx(89.6,400))(place[0],place[1])[0];
  expect(large).toBeCloseTo(small/2,9);
 });

 it('scales with ornament diameter',()=>{
  const point=offsetLngLat(320,0);
  const small=createMapProjection(viewport(),exportScaleMmPerPx(50,400))(point[0],point[1]);
  const large=createMapProjection(viewport(),exportScaleMmPerPx(100,400))(point[0],point[1]);
  expect(large[0]/small[0]).toBeCloseTo(2,9);
 });

 it('halves the millimetres per degree for each zoom step, because the world doubles',()=>{
  const point=offsetLngLat(200,0);
  const at14=createMapProjection(viewport({zoom:14}),mmPerPx)(point[0],point[1])[0];
  const at15=createMapProjection(viewport({zoom:15}),mmPerPx)(point[0],point[1])[0];
  expect(at15/at14).toBeCloseTo(2,9);
 });

 it('returns NaN rather than a plausible wrong number for a non-finite coordinate',()=>{
  const project=createMapProjection(viewport(),mmPerPx);
  expect(project(Number.NaN,45)[0]).toBeNaN();
  expect(project(0,Number.POSITIVE_INFINITY)[1]).toBeNaN();
 });

 it('clamps latitude to the Mercator limit instead of producing an Infinity',()=>{
  const project=createMapProjection(viewport(),mmPerPx);
  const [x,y]=project(FIXTURE_CENTER[0],89.9);
  expect(Number.isFinite(x)).toBe(true);
  expect(Number.isFinite(y)).toBe(true);
  expect(clampLatitude(89.9)).toBeLessThan(86);
 });
});

// The reuse claim, checked. CropProjection maps lng/lat into a rectangle given four geographic
// corners; over a north-up viewport those corners form an axis-aligned Mercator rectangle, so its
// inverse-bilinear iteration and the ornament's single division must agree.
describe('agreement with the lake tool CropProjection',()=>{
 it('lands on the same millimetre across the viewport',()=>{
  const view=viewport();
  const mmPerPx=exportScaleMmPerPx(89.6,view.widthPx);
  const project=createMapProjection(view,mmPerPx);
  const [west,south,east,north]=view.bounds;
  const corners=viewportCornersMm(view,mmPerPx);
  const widthMm=corners.ne[0]-corners.nw[0],heightMm=corners.sw[1]-corners.nw[1];
  const crop=cropFromCorners(
   {lng:west,lat:north},
   {lng:east,lat:north},
   {lng:east,lat:south},
   {lng:west,lat:south},
  );
  const lake=new CropProjection(crop,widthMm,heightMm);

  for(let i=0;i<=4;i++)for(let j=0;j<=4;j++){
   const lng=west+(east-west)*i/4,lat=north+(south-north)*j/4;
   const ornament=project(lng,lat);
   const reference=lake.project({lng,lat});
   // CropProjection's origin is the crop's top-left corner; the ornament's is its centre.
   expect(ornament[0]).toBeCloseTo(reference.x+corners.nw[0],6);
   expect(ornament[1]).toBeCloseTo(reference.y+corners.nw[1],6);
  }
 });
});

describe('viewport corners',()=>{
 it('are half the rendered size in each direction from the ornament centre',()=>{
  const view=viewport();
  const corners=viewportCornersMm(view,.224);
  expect(corners.nw[0]).toBeCloseTo(-44.8,9);
  expect(corners.nw[1]).toBeCloseTo(-44.8,9);
  expect(corners.se[0]).toBeCloseTo(44.8,9);
  expect(corners.se[1]).toBeCloseTo(44.8,9);
 });
});
