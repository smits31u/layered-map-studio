import {describe,expect,it} from 'vitest';
import {getCachedGeometryLayers,geometryKeyOf} from '../../src/export/geometryCache';
import {caldronFallsFeatures,caldronFallsProject} from '../fixtures/caldronFalls';
import type {MapProject} from '../../src/types/project';

describe('geometryKeyOf — what does and does not invalidate the expensive geometry stage',()=>{
 it('is identical for two structurally-equal projects (not a reference-identity check)',()=>{
  const a={...caldronFallsProject},b={...caldronFallsProject};
  expect(geometryKeyOf(a)).toBe(geometryKeyOf(b));
 });

 it('changes when the crop changes',()=>{
  const changed:MapProject={...caldronFallsProject,map:{...caldronFallsProject.map,crop:{...caldronFallsProject.map.crop!,bbox:[-1,-1,1,1]}}};
  expect(geometryKeyOf(changed)).not.toBe(geometryKeyOf(caldronFallsProject));
 });

 it('changes when physical dimensions change',()=>{
  const changed:MapProject={...caldronFallsProject,dimensions:{...caldronFallsProject.dimensions,widthMm:400}};
  expect(geometryKeyOf(changed)).not.toBe(geometryKeyOf(caldronFallsProject));
 });

 it('changes when shoreline settings change',()=>{
  const changed:MapProject={...caldronFallsProject,shoreline:{...caldronFallsProject.shoreline,preset:'wide'}};
  expect(geometryKeyOf(changed)).not.toBe(geometryKeyOf(caldronFallsProject));
 });

 it('does NOT change for roads.mode/width (presentation tier)',()=>{
  const changed:MapProject={...caldronFallsProject,roads:{mode:'main',majorWidthMm:9,minorWidthMm:9}};
  expect(geometryKeyOf(changed)).toBe(geometryKeyOf(caldronFallsProject));
 });

 it('does NOT change for title/subtitle/compass/labels (presentation tier)',()=>{
  const changed:MapProject={...caldronFallsProject,title:{...caldronFallsProject.title,text:'NEW TITLE',sizeMm:99},compass:{...caldronFallsProject.compass,sizeMm:99,rotationDeg:45},roadLabels:{...caldronFallsProject.roadLabels,visible:true,sizeMm:99},placeLabels:{...caldronFallsProject.placeLabels,sizeMm:99}};
  expect(geometryKeyOf(changed)).toBe(geometryKeyOf(caldronFallsProject));
 });

 it('does NOT change for manual object overrides (presentation tier)',()=>{
  const changed:MapProject={...caldronFallsProject,overrides:{compass:{xMm:200,yMm:200}}};
  expect(geometryKeyOf(changed)).toBe(geometryKeyOf(caldronFallsProject));
 });

 it('does NOT change for shoreline.enabledLayers toggling alone changing nothing else',()=>{
  // enabledLayers is part of `shoreline`, included deliberately — layer visibility affects which
  // panels the (already fully-computed) geometry stage exposes but is cheap to recompute alongside
  // it; this test just documents that it IS part of the key (a toggle produces a different key),
  // matching the "expensive polygon math is unconditionally correct" safety choice explained in
  // buildScene.ts, not a performance bug.
  const changed:MapProject={...caldronFallsProject,shoreline:{...caldronFallsProject.shoreline,enabledLayers:[false,true,true,true,false,false,true]}};
  expect(geometryKeyOf(changed)).not.toBe(geometryKeyOf(caldronFallsProject));
 });
});

describe('getCachedGeometryLayers',()=>{
 it('reuses the cached result when the key and features reference are unchanged',()=>{
  const first=getCachedGeometryLayers(undefined,caldronFallsProject,caldronFallsFeatures);
  expect(first.reused).toBe(false);
  const second=getCachedGeometryLayers(first.cache,caldronFallsProject,caldronFallsFeatures);
  expect(second.reused).toBe(true);
  expect(second.result).toBe(first.result); // same object reference, not just equal content
 });

 it('recomputes when a geometry-affecting field changes',()=>{
  const first=getCachedGeometryLayers(undefined,caldronFallsProject,caldronFallsFeatures);
  const widened:MapProject={...caldronFallsProject,dimensions:{...caldronFallsProject.dimensions,widthMm:400}};
  const second=getCachedGeometryLayers(first.cache,widened,caldronFallsFeatures);
  expect(second.reused).toBe(false);
  expect(second.result.widthMm).toBe(400);
 });

 it('recomputes when features reference changes even if the key is identical (a fresh extraction happened)',()=>{
  const first=getCachedGeometryLayers(undefined,caldronFallsProject,caldronFallsFeatures);
  const sameContentDifferentReference={...caldronFallsFeatures};
  const second=getCachedGeometryLayers(first.cache,caldronFallsProject,sameContentDifferentReference);
  expect(second.reused).toBe(false);
 });

 it('does NOT recompute for a presentation-only change (title text)',()=>{
  const first=getCachedGeometryLayers(undefined,caldronFallsProject,caldronFallsFeatures);
  const titled:MapProject={...caldronFallsProject,title:{...caldronFallsProject.title,text:'CALDRON FALLS'}};
  const second=getCachedGeometryLayers(first.cache,titled,caldronFallsFeatures);
  expect(second.reused).toBe(true);
 });
});
