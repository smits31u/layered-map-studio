import {describe,expect,it} from 'vitest';
import {CropProjection} from '../../src/geometry/projection/cropProjection';
import {caldronFixture,regressionFixtures} from '../fixtures/regressionFixtures';
import type {CropGeography} from '../../src/types/project';

// The artistic-depth buffer operates on projected millimeter coordinates. If CropProjection scaled
// X and Y differently, a uniform-radius negative buffer would erode unevenly by direction, which
// could plausibly explain deep-layer collapse. Prove it does not: a true ground-circle must still
// project to (approximately) a circle in mm-space, at both a small and a larger radius.
describe('CropProjection preserves isotropic (equal X/Y) scale',()=>{
 const metersPerDegLat=111320;
 function projectCircle(widthMm:number,heightMm:number,crop:CropGeography,centerLng:number,centerLat:number,radiusM:number){
  const projection=new CropProjection(crop,widthMm,heightMm);
  const metersPerDegLng=metersPerDegLat*Math.cos(centerLat*Math.PI/180);
  const points=Array.from({length:72},(_,i)=>{
   const theta=(i/72)*2*Math.PI;
   return projection.project({lng:centerLng+(radiusM*Math.cos(theta))/metersPerDegLng,lat:centerLat+(radiusM*Math.sin(theta))/metersPerDegLat});
  });
  const xs=points.map(p=>p.x),ys=points.map(p=>p.y);
  return {xRange:Math.max(...xs)-Math.min(...xs),yRange:Math.max(...ys)-Math.min(...ys)};
 }

 it('projects a true ground circle to a circle (equal X/Y extent) on the real Caldron Falls crop, at two radii',()=>{
  const {crop,dimensions}=caldronFixture;
  const centerLng=(crop.bbox[0]+crop.bbox[2])/2,centerLat=(crop.bbox[1]+crop.bbox[3])/2;
  for(const radiusM of [100,1000]){
   const {xRange,yRange}=projectCircle(dimensions.widthMm,dimensions.heightMm,crop,centerLng,centerLat,radiusM);
   expect(xRange/yRange).toBeCloseTo(1,3);
  }
 });

 it('the local Jacobian of the projection has equal singular-value magnitude in both directions (no anisotropic stretch)',()=>{
  const {crop,dimensions}=caldronFixture;
  const centerLng=(crop.bbox[0]+crop.bbox[2])/2,centerLat=(crop.bbox[1]+crop.bbox[3])/2;
  const projection=new CropProjection(crop,dimensions.widthMm,dimensions.heightMm);
  const metersPerDegLng=metersPerDegLat*Math.cos(centerLat*Math.PI/180),eps=1e-6;
  const p0=projection.project({lng:centerLng,lat:centerLat});
  const pdLng=projection.project({lng:centerLng+eps,lat:centerLat});
  const pdLat=projection.project({lng:centerLng,lat:centerLat+eps});
  const scaleEast=Math.hypot((pdLng.x-p0.x)/eps,(pdLng.y-p0.y)/eps)/metersPerDegLng;
  const scaleNorth=Math.hypot((pdLat.x-p0.x)/eps,(pdLat.y-p0.y)/eps)/metersPerDegLat;
  expect(scaleEast/scaleNorth).toBeCloseTo(1,4);
 });

 // Regression guard: an earlier version of the regression fixtures paired product dimensions with
 // crop rectangles sized to each lake's own bbox aspect ratio instead of the product's, which
 // silently introduced up to ~30% anisotropic distortion for three of the four lakes even though
 // this exact isotropy check already existed for Caldron alone. Check every fixture, not just one.
 it('every regression fixture crop is isotropic, not just Caldron',()=>{
  for(const fixture of regressionFixtures){
   const {crop,dimensions}=fixture;
   const centerLng=(crop.bbox[0]+crop.bbox[2])/2,centerLat=(crop.bbox[1]+crop.bbox[3])/2;
   const projection=new CropProjection(crop,dimensions.widthMm,dimensions.heightMm);
   const metersPerDegLng=metersPerDegLat*Math.cos(centerLat*Math.PI/180),eps=1e-6;
   const p0=projection.project({lng:centerLng,lat:centerLat});
   const pdLng=projection.project({lng:centerLng+eps,lat:centerLat});
   const pdLat=projection.project({lng:centerLng,lat:centerLat+eps});
   const scaleEast=Math.hypot((pdLng.x-p0.x)/eps,(pdLng.y-p0.y)/eps)/metersPerDegLng;
   const scaleNorth=Math.hypot((pdLat.x-p0.x)/eps,(pdLat.y-p0.y)/eps)/metersPerDegLat;
   expect(scaleEast/scaleNorth,`${fixture.lake} crop is anisotropic`).toBeCloseTo(1,3);
  }
 });
});
