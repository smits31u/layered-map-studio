import {describe,expect,it} from 'vitest';
import {CROP_ASPECT_TOLERANCE,assertCropMatchesBoard,cropAspect,cropContains,cropMatchesBoard,cropNorthDeg,cropStretch,fitCropToBoard} from '../../src/geometry/projection/cropAspect';
import {cropFromCorners,mercator} from '../../src/geometry/projection/cropProjection';
import type {CropGeography,LngLat} from '../../src/types/project';

// The crop-shape checks behind the 2026-10-15 audit: a crop that is not the board's shape stretched
// every exported panel (x0.956 on a 1600x1000 window, x1.127 after a 14x11 -> 18x12 resize).

const unmercator=(x:number,y:number):LngLat=>({lng:x*360-180,lat:Math.atan(Math.sinh(Math.PI*(1-2*y)))*180/Math.PI});
// A crop as the map measures it: a rectangle in Mercator units, `wide` by `tall`, turned clockwise on
// screen by `bearing` degrees (the map's bearing), about Caldron Falls.
function crop(wide:number,tall:number,bearing=0):CropGeography{
 const c=mercator({lng:-88.207,lat:45.3685}),t=bearing*Math.PI/180,at=(a:number,b:number)=>unmercator(c.x+a*Math.cos(t)-b*Math.sin(t),c.y+a*Math.sin(t)+b*Math.cos(t));
 return cropFromCorners(at(-wide/2,-tall/2),at(wide/2,-tall/2),at(wide/2,tall/2),at(-wide/2,tall/2));
}
const centre=(c:CropGeography)=>{const p=[c.nw,c.ne,c.se,c.sw].map(mercator);return{x:p.reduce((s,q)=>s+q.x,0)/4,y:p.reduce((s,q)=>s+q.y,0)/4}};
const W14=355.6,H11=279.4,W18=457.2,H12=304.8;

describe('crop aspect',()=>{
 it('reads the crop\'s shape on the ground, whatever its bearing',()=>{
  expect(cropAspect(crop(.0014,.0011))).toBeCloseTo(14/11,6);
  expect(cropAspect(crop(.0014,.0011,30))).toBeCloseTo(14/11,6);
 });

 it('measures the stretch an export would have: 1 for a crop of the board\'s shape',()=>{
  expect(cropStretch(crop(.0014,.0011),W14,H11)).toBeCloseTo(1,6);
  // The audit's wide-window frame: 4.4% wider than the board.
  expect(cropStretch(crop(.0014*1.046,.0011),W14,H11)).toBeCloseTo(.956,3);
  // The audit's resize: a 14x11 crop on an 18x12 board.
  expect(cropStretch(crop(.0014,.0011),W18,H12)).toBeCloseTo(1.179,3);
 });

 it('refuses a crop outside the tolerance, with the stretch in the message, and passes pixel rounding',()=>{
  expect(()=>assertCropMatchesBoard(crop(.0014*1.046,.0011),W14,H11)).toThrow(/not the board's shape: it would stretch the map x0\.956/);
  expect(()=>assertCropMatchesBoard(crop(.0014,.0011),W18,H12)).toThrow(/x1\.179/);
  // One pixel on a 700 px tall frame.
  expect(()=>assertCropMatchesBoard(crop(.0014,.0011*(1+1/700)),W14,H11)).not.toThrow();
  expect(cropMatchesBoard(crop(.0014*(1+CROP_ASPECT_TOLERANCE*.9),.0011),W14,H11)).toBe(true);
  expect(cropMatchesBoard(crop(.0014*(1+CROP_ASPECT_TOLERANCE*1.2),.0011),W14,H11)).toBe(false);
 });

 it('refuses a degenerate crop rather than building from it',()=>{
  const p={lng:-88.2,lat:45.3};
  expect(()=>assertCropMatchesBoard(cropFromCorners(p,p,p,p),W14,H11)).toThrow(/not the board's shape/);
 });
});

describe('fitCropToBoard',()=>{
 const captured=crop(.0014,.0011);
 it('refits a 14x11 crop to an 18x12 board: true shape, same centre, inside the captured crop',()=>{
  const fitted=fitCropToBoard(captured,W18,H12);
  expect(cropStretch(fitted,W18,H12)).toBeCloseTo(1,9);
  expect(centre(fitted).x).toBeCloseTo(centre(captured).x,12);
  expect(centre(fitted).y).toBeCloseTo(centre(captured).y,12);
  expect(cropContains(captured,fitted)).toBe(true);
  // Wider board: the full width is kept and the height trimmed.
  const [nw,ne,sw]=[fitted.nw,fitted.ne,fitted.sw].map(mercator),[cnw,cne]=[captured.nw,captured.ne].map(mercator);
  expect(ne.x-nw.x).toBeCloseTo(cne.x-cnw.x,12);
  expect(sw.y-nw.y).toBeCloseTo(.0014*H12/W18,12);
 });

 it('trims the width for a taller board, and keeps the crop\'s bearing',()=>{
  const turned=crop(.0014,.0011,25),fitted=fitCropToBoard(turned,10*25.4,10*25.4);
  expect(cropStretch(fitted,254,254)).toBeCloseTo(1,9);
  expect(cropContains(turned,fitted)).toBe(true);
  expect(cropNorthDeg(fitted,254,254)).toBeCloseTo(cropNorthDeg(turned,W14,H11),3);
 });

 it('comes back to the captured crop: 14x11 -> 18x12 -> 14x11, each refit from the capture',()=>{
  const back=fitCropToBoard(captured,W14,H11);
  for(const corner of ['nw','ne','se','sw'] as const){expect(back[corner].lng).toBeCloseTo(captured[corner].lng,9);expect(back[corner].lat).toBeCloseTo(captured[corner].lat,9)}
 });
});

describe('cropContains',()=>{
 const outer=crop(.0014,.0011);
 it('is true for the crop itself and a crop inside it, false for a moved crop',()=>{
  expect(cropContains(outer,outer)).toBe(true);
  expect(cropContains(outer,crop(.001,.001))).toBe(true);
  const c=mercator({lng:-88.207,lat:45.3685}),moved=cropFromCorners(...[[-1,-1],[1,-1],[1,1],[-1,1]].map(([a,b])=>unmercator(c.x+.0001+a*.0007,c.y+b*.00055)) as [LngLat,LngLat,LngLat,LngLat]);
  expect(cropContains(outer,moved)).toBe(false);
  expect(cropContains(outer,crop(.0014*1.01,.0011))).toBe(false);
 });
});

describe('cropNorthDeg',()=>{
 it('is zero for an unrotated crop',()=>{
  expect(Math.abs(cropNorthDeg(crop(.0014,.0011),W14,H11))).toBeLessThan(.01);
 });
 it('is minus the map bearing: with east up (bearing 90) north points left',()=>{
  expect(cropNorthDeg(crop(.0014,.0011,90),W14,H11)).toBeCloseTo(-90,1);
  expect(cropNorthDeg(crop(.0014,.0011,-30),W14,H11)).toBeCloseTo(30,1);
 });
});
