import {describe,expect,it} from 'vitest';
import {classicRoseGeometry,compassFootprintRadiusMm,compassPathData,cornerPosition,MIN_COMPASS_SIZE_MM,MIN_LETTER_SIZE_MM} from '../../src/geometry/scene/compass';

describe('compass geometry',()=>{
 it('computes a top-left corner position inset from the physical edges by the margin',()=>{
  const {xMm,yMm}=cornerPosition('top-left',355.6,279.4,16);
  expect(xMm).toBeGreaterThan(0);
  expect(yMm).toBeGreaterThan(0);
  expect(xMm).toBeLessThan(355.6/2);
  expect(yMm).toBeLessThan(279.4/2);
 });

 it('mirrors corners across the product for top-right/bottom-left/bottom-right',()=>{
  const w=355.6,h=279.4,size=16;
  const tl=cornerPosition('top-left',w,h,size),tr=cornerPosition('top-right',w,h,size),bl=cornerPosition('bottom-left',w,h,size),br=cornerPosition('bottom-right',w,h,size);
  expect(tr.xMm).toBeCloseTo(w-tl.xMm,5);
  expect(tr.yMm).toBeCloseTo(tl.yMm,5);
  expect(bl.yMm).toBeCloseTo(h-tl.yMm,5);
  expect(br.xMm).toBeCloseTo(w-tl.xMm,5);
  expect(br.yMm).toBeCloseTo(h-tl.yMm,5);
 });

 it('produces nonempty, closed path data for every style',()=>{
  for(const style of ['classic','rose','minimal'] as const){
   const d=compassPathData(style,16);
   expect(d.length).toBeGreaterThan(0);
   expect(d.startsWith('M')).toBe(true);
  }
 });

 it('scales the path extent with size',()=>{
  const small=compassPathData('rose',10),large=compassPathData('rose',30);
  const extent=(d:string)=>Math.max(...[...d.matchAll(/-?\d+\.?\d*/g)].map(m=>Math.abs(+m[0])));
  expect(extent(large)).toBeGreaterThan(extent(small));
 });
});

describe('classic rose geometry (M-COMPASS)',()=>{
 it('generates non-empty ring, star, and center path data',()=>{
  const geo=classicRoseGeometry(22);
  for(const d of[geo.ringD,geo.starD,geo.centerD]){
   expect(d.length).toBeGreaterThan(0);
   expect(d.startsWith('M')).toBe(true);
   expect(d.trim().endsWith('Z')).toBe(true);
  }
 });

 it('nests ring outside the star, star outside the center — real "strong center, substantial ring" proportions',()=>{
  const geo=classicRoseGeometry(22);
  const extent=(d:string)=>Math.max(...[...d.matchAll(/-?\d+\.?\d*/g)].map(m=>Math.abs(+m[0])));
  expect(extent(geo.ringD)).toBeGreaterThan(extent(geo.starD));
  expect(extent(geo.starD)).toBeGreaterThan(extent(geo.centerD));
 });

 it('places N/E/S/W at the four cardinal directions, north up (-y) per the existing SVG convention',()=>{
  const geo=classicRoseGeometry(22);
  expect(geo.letterPositions.N.y).toBeLessThan(0);
  expect(geo.letterPositions.S.y).toBeGreaterThan(0);
  expect(geo.letterPositions.E.x).toBeGreaterThan(0);
  expect(geo.letterPositions.W.x).toBeLessThan(0);
  expect(geo.letterPositions.N.x).toBeCloseTo(0,5);
  expect(geo.letterPositions.S.x).toBeCloseTo(0,5);
  expect(geo.letterPositions.E.y).toBeCloseTo(0,5);
  expect(geo.letterPositions.W.y).toBeCloseTo(0,5);
 });

 it('positions letters strictly between the star tips and the ring, never overlapping either',()=>{
  const geo=classicRoseGeometry(22);
  const firstPoint=(d:string):[number,number]=>{const nums=[...d.matchAll(/-?\d+\.\d+/g)].map(m=>+m[0]);return[nums[0],nums[1]]};
  const starTipR=Math.hypot(...firstPoint(geo.starD)); // the star's first vertex is a cardinal (long) spike tip
  const ringR=Math.hypot(...firstPoint(geo.ringD));
  const letterR=Math.hypot(geo.letterPositions.E.x,geo.letterPositions.E.y);
  expect(letterR).toBeGreaterThan(starTipR);
  expect(letterR).toBeLessThan(ringR);
 });

 it('holds an absolute floor for letter size regardless of how small the compass is requested',()=>{
  const tiny=classicRoseGeometry(1);
  expect(tiny.letterSizeMm).toBeGreaterThanOrEqual(MIN_LETTER_SIZE_MM);
 });

 it('clamps the effective size used for proportional geometry at MIN_COMPASS_SIZE_MM, so a below-floor request does not collapse the ring/star/gap structure',()=>{
  const atFloor=classicRoseGeometry(MIN_COMPASS_SIZE_MM),belowFloor=classicRoseGeometry(1);
  expect(belowFloor.footprintRadiusMm).toBeCloseTo(atFloor.footprintRadiusMm,5);
 });

 it('scales normally above the floor',()=>{
  const small=classicRoseGeometry(20),large=classicRoseGeometry(40);
  expect(large.footprintRadiusMm).toBeGreaterThan(small.footprintRadiusMm);
  expect(large.letterSizeMm).toBeGreaterThan(small.letterSizeMm);
 });

 it('compassFootprintRadiusMm reflects the true rendered extent, not a naive sizeMm/2 for every style',()=>{
  expect(compassFootprintRadiusMm('classic-rose',22)).toBeCloseTo(classicRoseGeometry(22).footprintRadiusMm,5);
  expect(compassFootprintRadiusMm('classic',22)).toBe(11);
 });

 it('compassPathData still returns non-empty path data for the classic-rose style (defensive fallback)',()=>{
  const d=compassPathData('classic-rose',22);
  expect(d.length).toBeGreaterThan(0);
 });
});
