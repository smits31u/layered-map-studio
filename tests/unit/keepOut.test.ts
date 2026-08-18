import {describe,expect,it} from 'vitest';
import {clipPolylineAgainstCircles,keepOutFootprint,pointInsideAnyCircle,regionAffects,type Circle} from '../../src/geometry/scene/keepOut';

describe('keep-out polyline clipping',()=>{
 it('returns the original polyline unchanged when there are no circles',()=>{
  const points=[{x:0,y:0},{x:10,y:0}];
  expect(clipPolylineAgainstCircles(points,[])).toEqual([points]);
 });

 it('drops the whole polyline when every point is inside the circle',()=>{
  const points=[{x:0,y:0},{x:1,y:0},{x:2,y:0}];
  const circle:Circle={cx:1,cy:0,r:10};
  expect(clipPolylineAgainstCircles(points,[circle])).toEqual([]);
 });

 it('leaves a polyline untouched when it never enters the circle',()=>{
  const points=[{x:-100,y:0},{x:-90,y:0}];
  const circle:Circle={cx:0,cy:0,r:5};
  const result=clipPolylineAgainstCircles(points,[circle]);
  expect(result).toEqual([points]);
 });

 it('cuts a straight line that passes through a circle into two outside segments',()=>{
  // line from (-10,0) to (10,0), circle of radius 3 centered at origin — crosses at x=-3 and x=3
  const points=[{x:-10,y:0},{x:10,y:0}];
  const circle:Circle={cx:0,cy:0,r:3};
  const result=clipPolylineAgainstCircles(points,[circle]);
  expect(result.length).toBe(2);
  expect(result[0][0]).toEqual({x:-10,y:0});
  expect(result[0][result[0].length-1].x).toBeCloseTo(-3,5);
  expect(result[1][0].x).toBeCloseTo(3,5);
  expect(result[1][result[1].length-1]).toEqual({x:10,y:0});
 });

 it('handles a polyline that starts inside the circle and exits it once',()=>{
  const points=[{x:0,y:0},{x:10,y:0}];
  const circle:Circle={cx:0,cy:0,r:3};
  const result=clipPolylineAgainstCircles(points,[circle]);
  expect(result.length).toBe(1);
  expect(result[0][0].x).toBeCloseTo(3,5);
  expect(result[0][result[0].length-1]).toEqual({x:10,y:0});
 });

 it('clips correctly against multiple circles along one polyline (roads-major/minor style padding)',()=>{
  const points=[{x:-20,y:0},{x:20,y:0}];
  const circles:Circle[]=[{cx:-10,cy:0,r:2},{cx:10,cy:0,r:2}];
  const result=clipPolylineAgainstCircles(points,circles);
  expect(result.length).toBe(3);
  expect(result[0][result[0].length-1].x).toBeCloseTo(-12,5);
  expect(result[1][0].x).toBeCloseTo(-8,5);
  expect(result[1][result[1].length-1].x).toBeCloseTo(8,5);
  expect(result[2][0].x).toBeCloseTo(12,5);
});

 it('drops degenerate single-point or empty input',()=>{
  expect(clipPolylineAgainstCircles([],[{cx:0,cy:0,r:1}])).toEqual([]);
  expect(clipPolylineAgainstCircles([{x:0,y:0}],[{cx:0,cy:0,r:1}])).toEqual([]);
 });
});

describe('keep-out footprint / region helpers',()=>{
 it('keepOutFootprint pads the circle radius by the requested padding',()=>{
  const region=keepOutFootprint('compass-keepout','compass',10,10,5,3,['roads-major']);
  expect(region.circles).toEqual([{cx:10,cy:10,r:8}]);
  expect(region.affects).toEqual(['roads-major']);
 });

 it('clamps negative radius/padding to zero rather than producing a negative-radius circle',()=>{
  const region=keepOutFootprint('id','src',0,0,-5,-5,[]);
  expect(region.circles[0].r).toBe(0);
 });

 it('regionAffects filters regions down to only those declaring the requested target',()=>{
  const a=keepOutFootprint('a','compass',0,0,5,0,['roads-major','road-labels']);
  const b=keepOutFootprint('b','compass',0,0,5,0,['place-labels']);
  expect(regionAffects([a,b],'roads-major')).toEqual([a]);
  expect(regionAffects([a,b],'place-labels')).toEqual([b]);
 });
});

describe('label suppression via point-in-circle',()=>{
 it('suppresses a label whose anchor is inside a keep-out circle',()=>{
  expect(pointInsideAnyCircle({x:1,y:1},[{cx:0,cy:0,r:5}])).toBe(true);
 });

 it('does not suppress a label whose anchor is well outside every circle',()=>{
  expect(pointInsideAnyCircle({x:100,y:100},[{cx:0,cy:0,r:5}])).toBe(false);
 });

 it('honors an extra radius margin so labels whose text extends toward the circle are also suppressed',()=>{
  // anchor sits 8mm from center, circle radius 5mm — anchor alone is outside, but a label whose
  // text run reaches another 4mm toward the circle should still be suppressed.
  expect(pointInsideAnyCircle({x:8,y:0},[{cx:0,cy:0,r:5}])).toBe(false);
  expect(pointInsideAnyCircle({x:8,y:0},[{cx:0,cy:0,r:5}],4)).toBe(true);
 });
});
