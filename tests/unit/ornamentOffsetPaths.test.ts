import {describe,expect,it} from 'vitest';
import {multiPolygonArea} from '../../src/geometry/shoreline/polygonEngine';
import {offsetPaths} from '../../src/ornament/geometry/offsetPaths';

// These lock in the claim ADR 0001 rests on: clipper-lib already does round-joined open-path
// offsets, so no second geometry engine was needed. If this ever stops holding, the ADR is wrong
// and Clipper2/WASM has to be reconsidered — which is exactly what the ADR says to do.
describe('open-path offsetting',()=>{
 it('buffers an open segment into a closed stadium of the analytic area',()=>{
  const result=offsetPaths([[[0,0],[10,0]]],1,{endStyle:'open-round',arcToleranceMm:.005});
  expect(result).toHaveLength(1);
  expect(result[0]).toHaveLength(1);
  const ring=result[0][0];
  expect(ring[0]).toEqual(ring[ring.length-1]);
  // 2·r·L + πr² for r=1, L=10. Flattening inscribes the caps, so the polygon is slightly under.
  expect(multiPolygonArea(result)).toBeCloseTo(20+Math.PI,1);
 });

 it('approaches the true area as the arc tolerance tightens',()=>{
  const ideal=20+Math.PI;
  const coarse=multiPolygonArea(offsetPaths([[[0,0],[10,0]]],1,{endStyle:'open-round',arcToleranceMm:.25}));
  const fine=multiPolygonArea(offsetPaths([[[0,0],[10,0]]],1,{endStyle:'open-round',arcToleranceMm:.005}));
  expect(ideal-fine).toBeLessThan(ideal-coarse);
  expect(coarse).toBeLessThan(fine);
 });

 it('squares off the ends when asked, giving a larger area than butt ends',()=>{
  const butt=multiPolygonArea(offsetPaths([[[0,0],[10,0]]],1,{endStyle:'open-butt'}));
  const square=multiPolygonArea(offsetPaths([[[0,0],[10,0]]],1,{endStyle:'open-square'}));
  expect(butt).toBeCloseTo(20,1);
  expect(square).toBeGreaterThan(butt);
 });

 it('unions overlapping strokes into a single polygon',()=>{
  const cross=offsetPaths([[[-5,0],[5,0]],[[0,-5],[0,5]]],1,{endStyle:'open-round'});
  expect(cross).toHaveLength(1);
 });

 it('survives a zero-length path without emitting NaN',()=>{
  const result=offsetPaths([[[3,3],[3,3]]],1,{endStyle:'open-round'});
  for(const polygon of result)for(const ring of polygon)for(const [x,y] of ring){
   expect(Number.isFinite(x)).toBe(true);
   expect(Number.isFinite(y)).toBe(true);
  }
 });

 it('returns nothing for inputs too short for the chosen end style',()=>{
  expect(offsetPaths([[[1,1]]],1,{endStyle:'open-round'})).toEqual([]);
  expect(offsetPaths([[[0,0],[1,1]]],1,{endStyle:'closed-polygon'})).toEqual([]);
 });
});

describe('closed-polygon offsetting',()=>{
 it('grows a square by the offset with round corners',()=>{
  const square:[number,number][]=[[0,0],[10,0],[10,10],[0,10],[0,0]];
  const grown=offsetPaths([square],2,{endStyle:'closed-polygon',arcToleranceMm:.005});
  // 100 + perimeter·2 + π·2² for fully round corners.
  expect(multiPolygonArea(grown)).toBeCloseTo(100+80+Math.PI*4,1);
 });

 it('shrinks a square inward on a negative offset',()=>{
  const square:[number,number][]=[[0,0],[10,0],[10,10],[0,10],[0,0]];
  expect(multiPolygonArea(offsetPaths([square],-2,{endStyle:'closed-polygon'}))).toBeCloseTo(36,1);
 });

 it('collapses to nothing when shrunk past its own half width',()=>{
  const square:[number,number][]=[[0,0],[10,0],[10,10],[0,10],[0,0]];
  expect(offsetPaths([square],-6,{endStyle:'closed-polygon'})).toEqual([]);
 });

 it('treats an explicitly closed ring the same as an open one',()=>{
  const closed:[number,number][]=[[0,0],[10,0],[10,10],[0,10],[0,0]];
  const open:[number,number][]=[[0,0],[10,0],[10,10],[0,10]];
  const a=multiPolygonArea(offsetPaths([closed],1,{endStyle:'closed-polygon'}));
  const b=multiPolygonArea(offsetPaths([open],1,{endStyle:'closed-polygon'}));
  expect(a).toBeCloseTo(b,6);
 });
});
