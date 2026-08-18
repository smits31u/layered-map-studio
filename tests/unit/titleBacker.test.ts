import {describe,expect,it} from 'vitest';
import {titleBackerPath,unionBounds} from '../../src/geometry/scene/titleBacker';

const bounds={minX:-10,minY:-4,maxX:10,maxY:2};

describe('title backer geometry',()=>{
 it('produces no geometry for mode "none"',()=>{
  expect(titleBackerPath('none',bounds,2)).toBeUndefined();
 });

 it('produces a sharp-cornered rectangle padded around the text bounds for "rectangle"',()=>{
  const d=titleBackerPath('rectangle',bounds,2)!;
  expect(d).toContain('M-12 -6');
  expect(d.trim().endsWith('Z')).toBe(true);
  expect(d).not.toContain('A'); // no arcs — sharp corners
 });

 it('produces a rounded-corner path for "offset"',()=>{
  const d=titleBackerPath('offset',bounds,2)!;
  expect(d).toContain('A'); // elliptical arc commands for rounded corners
  expect(d.trim().endsWith('Z')).toBe(true);
 });

 it('clamps the corner radius so it never exceeds half the padded box', () => {
  const tiny={minX:0,minY:0,maxX:1,maxY:1};
  expect(()=>titleBackerPath('offset',tiny,10)).not.toThrow();
 });

 it('unions two bounding boxes into their combined extent',()=>{
  const a={minX:0,minY:0,maxX:5,maxY:5},b={minX:-2,minY:3,maxX:8,maxY:4};
  expect(unionBounds(a,b)).toEqual({minX:-2,minY:0,maxX:8,maxY:5});
 });

 it('returns the first bounds unchanged when no second bounds is given',()=>{
  const a={minX:1,minY:1,maxX:2,maxY:2};
  expect(unionBounds(a)).toEqual(a);
 });
});
