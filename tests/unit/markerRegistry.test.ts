import {describe,expect,it} from 'vitest';
import {DEFAULT_MARKER_SIZE_MM,MARKER_REGISTRY,MIN_MARKER_SIZE_MM,markerDefinition,markerFootprintRadiusMm,markerPathData} from '../../src/geometry/scene/markerRegistry';
import type {MarkerType} from '../../src/types/project';

const ALL_TYPES:MarkerType[]=['pin','star','heart','house','cabin','campfire','fish','boat','anchor','crosshair','circle','diamond','flag'];

describe('marker registry',()=>{
 it('registers every V1 marker type from the spec (pin/star/heart/house/cabin/campfire/fish/boat/anchor/crosshair/circle/diamond/flag)',()=>{
  expect(MARKER_REGISTRY.map(d=>d.type).sort()).toEqual([...ALL_TYPES].sort());
 });

 it('produces non-empty, closed vector path data for every registered type, never <text>',()=>{
  for(const type of ALL_TYPES){
   const d=markerPathData(type,DEFAULT_MARKER_SIZE_MM);
   expect(d.length).toBeGreaterThan(0);
   expect(d.startsWith('M')).toBe(true);
   expect(d).not.toMatch(/<text/i);
  }
 });

 it('scales path extent with size for every type',()=>{
  for(const type of ALL_TYPES){
   const small=markerPathData(type,6),large=markerPathData(type,20);
   const extent=(d:string)=>Math.max(...[...d.matchAll(/-?\d+\.?\d*/g)].map(m=>Math.abs(+m[0])));
   expect(extent(large)).toBeGreaterThan(extent(small));
  }
 });

 it('falls back to the first registered definition for an unrecognized type rather than throwing',()=>{
  const def=markerDefinition('nonexistent' as MarkerType);
  expect(def).toBe(MARKER_REGISTRY[0]);
 });

 it('every definition exposes a default size at or above its own minimum, and at or above the shared floor',()=>{
  for(const def of MARKER_REGISTRY){
   expect(def.defaultSizeMm).toBeGreaterThanOrEqual(def.minimumSizeMm);
   expect(def.minimumSizeMm).toBeGreaterThanOrEqual(MIN_MARKER_SIZE_MM);
  }
 });

 it('markerFootprintRadiusMm is half the size, matching the shared centered-at-origin convention',()=>{
  expect(markerFootprintRadiusMm(20)).toBe(10);
 });
});
