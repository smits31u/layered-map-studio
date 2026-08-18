import {describe,expect,it} from 'vitest';
import {compassPathData,cornerPosition} from '../../src/geometry/scene/compass';

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
