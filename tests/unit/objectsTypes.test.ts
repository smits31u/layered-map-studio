import {describe,expect,it} from 'vitest';
import {defaultProject} from '../../src/state/defaultProject';
import type {PhysicalDimensions,RoadSettings,ShorelineSettings} from '../../src/types/objects';

// These are purely-structural checks: since PhysicalDimensions/ShorelineSettings/RoadSettings
// are type aliases (not runtime values), the only thing worth testing at runtime is that real
// project data satisfies the shape — if MapProject's real fields ever drift from what these
// planning aliases describe, this test fails to compile (a type error), which is the point.
describe('V1 planning interfaces stay structurally in sync with real project data',()=>{
 it('PhysicalDimensions is satisfied by the real dimensions field',()=>{
  const dims:PhysicalDimensions=defaultProject.dimensions;
  expect(dims.widthMm).toBeGreaterThan(0);
  expect(dims.heightMm).toBeGreaterThan(0);
 });

 it('ShorelineSettings is satisfied by the real shoreline field',()=>{
  const shoreline:ShorelineSettings=defaultProject.shoreline;
  expect(Array.isArray(shoreline.enabledLayers)).toBe(true);
 });

 it('RoadSettings is satisfied by the real roads field',()=>{
  const roads:RoadSettings=defaultProject.roads;
  expect(['all','main','off']).toContain(roads.mode);
 });
});
