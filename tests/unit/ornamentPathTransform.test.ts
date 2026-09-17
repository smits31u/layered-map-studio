import {describe,expect,it} from 'vitest';
import {UntranslatablePathError,translatePathData} from '../../src/ornament/export/pathTransform';
import {pathBoundsMm} from '../../src/ornament/export/pathTransform';
import {getLoadedFont} from '../../src/text/fontRegistry';
import {textPathData} from '../../src/text/textVector';

// Path data is translated rather than wrapped in a transform, so this is the only thing standing
// between a glyph and being engraved in the wrong place. The cases that matter are the ones where a
// number in a path is not a coordinate: arc radii and flags, and every relative command's deltas.

describe('translating path data into sheet coordinates',()=>{
 it('moves absolute coordinates and leaves the shape alone',()=>{
  const moved=translatePathData('M0 0 L10 0 L10 10 Z',5,7);
  expect(moved).toBe('M 5 7 L 15 7 L 15 17 Z');
 });

 it('moves a multi-subpath shape by exactly the offset',()=>{
  const d='M-4 4 L4 4 L4 -1 L0 -5 L-4 -1 Z M-1 1 L1 1 L1 3 L-1 3 Z';
  const before=pathBoundsMm(d);
  const after=pathBoundsMm(translatePathData(d,30,-4));
  expect(after.minX).toBeCloseTo(before.minX+30,3);
  expect(after.maxX).toBeCloseTo(before.maxX+30,3);
  expect(after.minY).toBeCloseTo(before.minY-4,3);
  expect(after.maxY).toBeCloseTo(before.maxY-4,3);
 });

 it('does not scale or rotate an arc while moving it',()=>{
  // A circle built from two arcs: the radii must survive untouched, or the shape changes size when
  // the piece is laid out on the sheet.
  const d='M-5 0 A5 5 0 1 0 5 0 A5 5 0 1 0 -5 0 Z';
  const before=pathBoundsMm(d);
  const after=pathBoundsMm(translatePathData(d,100,100));
  expect(after.maxX-after.minX).toBeCloseTo(before.maxX-before.minX,3);
  expect(after.maxY-after.minY).toBeCloseTo(before.maxY-before.minY,3);
 });

 it('leaves an elliptical arc flag untouched',()=>{
  const moved=translatePathData('M0 0 A5 3 0 1 0 10 0 Z',2,2);
  expect(moved).toBe('M 2 2 A 5 3 0 1 0 12 2 Z');
 });

 it('moves only the opening pair of a relative path, because deltas are not positions',()=>{
  expect(translatePathData('m1 1 l4 0 l0 4 z',10,20)).toBe('m 11 21 l 4 0 l 0 4 z');
 });

 it('handles horizontal and vertical commands on their own axis',()=>{
  expect(translatePathData('M0 0 H10 V10 Z',3,4)).toBe('M 3 4 H 13 V 14 Z');
 });

 it('preserves an implicit lineto after a moveto',()=>{
  expect(translatePathData('M0 0 5 5 Z',1,1)).toBe('M 1 1 6 6 Z');
 });

 it('moves real glyph outlines without changing their width',()=>{
  const font=getLoadedFont('inter');
  expect(font).toBeDefined();
  const {d}=textPathData(font!,'Geneva',6,'center',0,0);
  const before=pathBoundsMm(d);
  const after=pathBoundsMm(translatePathData(d,42.5,-13.25));
  expect(after.maxX-after.minX).toBeCloseTo(before.maxX-before.minX,2);
  expect(after.minX).toBeCloseTo(before.minX+42.5,2);
 });

 it('is a no-op for a zero offset and for empty data',()=>{
  expect(translatePathData('M1 2 L3 4 Z',0,0)).toBe('M1 2 L3 4 Z');
  expect(translatePathData('',5,5)).toBe('');
 });

 it('refuses rather than guessing when it cannot parse or the offset is not finite',()=>{
  expect(()=>translatePathData('M0 0 L1 1',Number.NaN,0)).toThrow(UntranslatablePathError);
  expect(()=>translatePathData('10 10 L20 20',1,1)).toThrow(UntranslatablePathError);
  expect(()=>translatePathData('M0 0 L1',1,1)).toThrow(UntranslatablePathError);
 });
});
