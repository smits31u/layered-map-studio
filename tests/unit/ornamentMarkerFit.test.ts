import {describe,expect,it} from 'vitest';
import {createDefaultOrnamentProject} from '../../src/ornament/defaults';
import {mapWindowOf} from '../../src/ornament/geometry/clipLine';
import {buildOrnamentGeometry} from '../../src/ornament/geometry/ornamentShape';
import {boundsCorners,buildOrnamentMarker,markerFitIssues,markerFitsInMapWindow,pathBoundsMm,placedBounds} from '../../src/ornament/markers/ornamentMarker';
import type {MarkerKind} from '../../src/ornament/types';

const KINDS:MarkerKind[]=['heart','pin','house'];
const geometry=buildOrnamentGeometry(createDefaultOrnamentProject().ornament);
const window=mapWindowOf(geometry);

describe('path bounds',()=>{
 it('bounds a polygon exactly',()=>{
  expect(pathBoundsMm('M0 0 L10 0 L10 5 L0 5 Z')).toEqual({minX:0,minY:0,maxX:10,maxY:5});
 });

 it('bounds a cubic by its control hull, which contains the curve',()=>{
  const bounds=pathBoundsMm('M0 0 C0 -10 10 -10 10 0');
  expect(bounds.minY).toBe(-10);           // conservative: the curve itself only reaches -7.5
  expect(bounds.maxX).toBe(10);
 });

 it('bounds an arc by expanding its endpoints by the radii',()=>{
  const bounds=pathBoundsMm('M-5 0 A5 5 0 1 0 5 0 A5 5 0 1 0 -5 0 Z');
  expect(bounds.minX).toBeLessThanOrEqual(-5);
  expect(bounds.maxX).toBeGreaterThanOrEqual(5);
  expect(bounds.minY).toBeLessThanOrEqual(-5);
  expect(bounds.maxY).toBeGreaterThanOrEqual(5);
 });

 it('handles relative commands and implicit linetos after a moveto',()=>{
  expect(pathBoundsMm('M0 0 l5 5 l5 -5')).toEqual({minX:0,minY:0,maxX:10,maxY:5});
  expect(pathBoundsMm('M0 0 2 2 4 0')).toEqual({minX:0,minY:0,maxX:4,maxY:2});
 });

 it('returns a zero box for empty or unparseable data instead of Infinity',()=>{
  for(const d of ['','Z','nonsense'])expect(pathBoundsMm(d)).toEqual({minX:0,minY:0,maxX:0,maxY:0});
 });

 it('closes back to the subpath start on Z',()=>{
  expect(pathBoundsMm('M0 0 L10 0 Z L0 -4')).toEqual({minX:0,minY:-4,maxX:10,maxY:0});
 });
});

describe('ornament marker symbols',()=>{
 it('provides original artwork for all three kinds the plan names',()=>{
  for(const kind of KINDS){
   const symbol=buildOrnamentMarker(kind,8);
   expect(symbol.path.length).toBeGreaterThan(0);
   expect(symbol.path).toMatch(/^M/);
   expect(symbol.path).not.toMatch(/<|text|image/i);
  }
 });

 it('rejects a kind it has no artwork for rather than drawing nothing',()=>{
  expect(()=>buildOrnamentMarker('obelisk' as MarkerKind,8)).toThrow(/obelisk/);
 });

 it('scales with the requested size',()=>{
  for(const kind of KINDS){
   const small=buildOrnamentMarker(kind,4),large=buildOrnamentMarker(kind,16);
   const height=(s:typeof small)=>s.bounds.maxY-s.bounds.minY;
   expect(height(large)).toBeGreaterThan(height(small)*3);
  }
 });

 it('anchors a pin at its tip and the emblems at their centre',()=>{
  const pin=buildOrnamentMarker('pin',10);
  expect(pin.anchorMm).toEqual([0,5]);
  // The tip really is the lowest point of the artwork, so the anchor is on the symbol.
  expect(pin.bounds.maxY).toBeCloseTo(5,6);
  expect(buildOrnamentMarker('heart',10).anchorMm).toEqual([0,0]);
  expect(buildOrnamentMarker('house',10).anchorMm).toEqual([0,0]);
 });

 it('places the anchor at the given point, so the pin hangs above its location',()=>{
  const pin=buildOrnamentMarker('pin',10);
  const bounds=placedBounds(pin,[3,-4]);
  expect(bounds.maxY).toBeCloseTo(-4,6);      // tip on the coordinate
  expect(bounds.minY).toBeLessThan(-4);       // body above it
  const heart=placedBounds(buildOrnamentMarker('heart',10),[3,-4]);
  expect(heart.minY).toBeLessThan(-4);
  expect(heart.maxY).toBeGreaterThan(-4);     // centred on the coordinate
 });
});

describe('marker fit inside the map window',()=>{
 const heart=buildOrnamentMarker('heart',8);

 it('fits at the centre of the map window',()=>{
  expect(markerFitsInMapWindow(heart,[0,-10],window)).toBe(true);
  expect(markerFitIssues(heart,[0,-10],window)).toEqual([]);
 });

 it('does not fit when the place is outside the disk',()=>{
  expect(markerFitsInMapWindow(heart,[window.innerRadiusMm+5,0],window)).toBe(false);
  expect(markerFitIssues(heart,[window.innerRadiusMm+5,0],window)[0].code).toBe('marker-outside-window');
 });

 it('does not fit when the place is inside but the symbol overhangs the rim',()=>{
  const nearEdge:[number,number]=[window.innerRadiusMm-0.5,0];
  expect(markerFitsInMapWindow(heart,nearEdge,window)).toBe(false);
  expect(markerFitIssues(heart,nearEdge,window)[0].code).toBe('marker-clipped');
 });

 it('does not fit when the symbol overhangs the text chord',()=>{
  const nearChord:[number,number]=[0,window.chordYMm-0.5];
  expect(markerFitsInMapWindow(heart,nearChord,window)).toBe(false);
  expect(markerFitIssues(heart,nearChord,window)[0].code).toBe('marker-clipped');
 });

 it('warns rather than moving the marker, whatever the problem',()=>{
  for(const position of [[window.innerRadiusMm+5,0],[0,window.chordYMm+5],[window.innerRadiusMm-0.5,0]] as [number,number][]){
   const issues=markerFitIssues(heart,position,window);
   expect(issues).toHaveLength(1);
   expect(issues[0].severity).toBe('warning');
   expect(issues[0].message.length).toBeGreaterThan(20);
  }
 });

 it('reports a non-finite position as off the map rather than throwing',()=>{
  expect(markerFitIssues(heart,[Number.NaN,0],window)[0].code).toBe('marker-off-map');
 });

 it('gets harder to fit as the marker grows',()=>{
  const position:[number,number]=[0,-window.innerRadiusMm+6];
  expect(markerFitsInMapWindow(buildOrnamentMarker('heart',4),position,window)).toBe(true);
  expect(markerFitsInMapWindow(buildOrnamentMarker('heart',40),position,window)).toBe(false);
 });

 it('tests the bounding box by its corners, which is exact for a convex region',()=>{
  const bounds=placedBounds(heart,[0,-10]);
  expect(boundsCorners(bounds)).toHaveLength(4);
  expect(boundsCorners(bounds).map(([x])=>x)).toEqual([bounds.minX,bounds.maxX,bounds.maxX,bounds.minX]);
 });
});
