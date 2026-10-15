import {describe,expect,it} from 'vitest';
import {evenOddArea,nestRings,parsePathData,pathLength,rectPathData,transformScale} from '../../src/production/geometry/pathData';

// The path reader behind the estimate and the 3D preview: every command the repo's manufacturing
// paths use, measured against shapes whose length and area are known exactly.

const circle=(cx:number,cy:number,r:number)=>`M${cx-r} ${cy} A${r} ${r} 0 1 0 ${cx+r} ${cy} A${r} ${r} 0 1 0 ${cx-r} ${cy} Z`;

describe('parsePathData',()=>{
 it('reads geometryPath panels: M/L rings closed with Z, the duplicate closing point dropped',()=>{
  const subs=parsePathData('M0.000 0.000 L10.000 0.000 L10.000 5.000 L0.000 5.000 L0.000 0.000 Z');
  expect(subs).toHaveLength(1);
  expect(subs[0].closed).toBe(true);
  expect(subs[0].points).toEqual([[0,0],[10,0],[10,5],[0,5]]);
  expect(pathLength(subs)).toBeCloseTo(30,9);
 });

 it('reads opentype-style numbers packed with no separators, and relative commands',()=>{
  const subs=parsePathData('M1.5-2L3.5-2l0 4h-2v-4z');
  expect(subs[0].points).toEqual([[1.5,-2],[3.5,-2],[3.5,2],[1.5,2]]);
  expect(pathLength(subs)).toBeCloseTo(12,9);
 });

 it('treats extra pairs after a moveto as linetos',()=>{
  expect(parsePathData('M0 0 3 4')[0].points).toEqual([[0,0],[3,4]]);
 });

 it('flattens arcs: a two-arc circle measures 2πr long and πr² in area',()=>{
  const subs=parsePathData(circle(5,5,10));
  expect(pathLength(subs)).toBeCloseTo(2*Math.PI*10,1);
  expect(evenOddArea(subs)).toBeCloseTo(Math.PI*100,0);
 });

 it('reads arc flags written with no separator',()=>{
  const spaced=parsePathData('M0 0 A5 5 0 0 1 10 0'),packed=parsePathData('M0 0 A5 5 0 01 10 0');
  expect(pathLength(packed)).toBeCloseTo(pathLength(spaced),9);
  expect(pathLength(spaced)).toBeCloseTo(Math.PI*5,1);
 });

 it('flattens cubic and quadratic curves close to their true length',()=>{
  // A straight-line cubic and quadratic are exactly their chord.
  expect(pathLength(parsePathData('M0 0 C3 0 6 0 9 0'))).toBeCloseTo(9,6);
  expect(pathLength(parsePathData('M0 0 Q5 0 10 0'))).toBeCloseTo(10,6);
  // The standard 4-cubic circle approximation of r=10.
  const k=10*.5522847498;
  const d=`M10 0 C10 ${k} ${k} 10 0 10 C${-k} 10 -10 ${k} -10 0 C-10 ${-k} ${-k} -10 0 -10 C${k} -10 10 ${-k} 10 0 Z`;
  expect(pathLength(parsePathData(d))).toBeCloseTo(2*Math.PI*10,0);
 });

 it('refuses garbage instead of returning a wrong shape',()=>{
  expect(()=>parsePathData('M0 0 L1 x')).toThrow(/Unreadable path data/);
  expect(()=>parsePathData('0 0 L1 1')).toThrow(/must start with a command/);
 });
});

describe('even-odd area and nesting',()=>{
 it('a board with a lake opening, an island in it and a pond on the island',()=>{
  const d=[rectPathData(0,0,100,80),rectPathData(10,10,60,50),rectPathData(20,20,20,20),rectPathData(25,25,5,5)].join(' ');
  // 8000 - 3000 + 400 - 25
  expect(evenOddArea(parsePathData(d))).toBeCloseTo(5375,6);
  const polygons=nestRings(parsePathData(d).map(s=>s.points));
  expect(polygons).toHaveLength(2);
  expect(polygons.map(p=>p.holes.length).sort()).toEqual([1,1]);
 });

 it('does not depend on ring direction (fonts and Clipper wind holes differently)',()=>{
  const cw='M0 0 L0 10 L10 10 L10 0 Z',ccwHole='M2 2 L8 2 L8 8 L2 8 Z',cwHole='M2 2 L2 8 L8 8 L8 2 Z';
  expect(evenOddArea(parsePathData(`${cw} ${ccwHole}`))).toBeCloseTo(64,9);
  expect(evenOddArea(parsePathData(`${cw} ${cwHole}`))).toBeCloseTo(64,9);
 });

 it('separate shapes add up',()=>{
  expect(evenOddArea(parsePathData(`${rectPathData(0,0,2,2)} ${rectPathData(10,10,3,3)}`))).toBeCloseTo(13,9);
 });
});

describe('transformScale',()=>{
 it('is 1 for the translate/rotate transforms scenes write, and reads a scale()',()=>{
  expect(transformScale('translate(10 20) rotate(35)')).toBe(1);
  expect(transformScale(undefined)).toBe(1);
  expect(transformScale('translate(1 1) scale(2)')).toBe(2);
  expect(transformScale('scale(2 8)')).toBe(4);
 });
});
