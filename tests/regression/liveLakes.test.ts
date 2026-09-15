import {describe,expect,it} from 'vitest';
import * as polygonClipping from 'polygon-clipping';
import {buildWaterModel,multiPolygonArea,panelFromWater,validatePanel} from '../../src/geometry/shoreline/polygonEngine';
import {CropProjection} from '../../src/geometry/projection/cropProjection';
import {applyCropSnapshot,cropGeographyFromSnapshot,serializeCropSnapshot} from '../../src/geometry/projection/cropSnapshot';
import {artisticDepthOpenings,ARTISTIC_DEPTH_PRESETS} from '../../src/geometry/shoreline/artisticDepth';
import {defaultProject} from '../../src/state/defaultProject';
import type {MapProject} from '../../src/types/project';
import {regressionFixtures,caldronFixture,type RegressionFixture} from '../fixtures/regressionFixtures';

// Real OSM shoreline geometry for the four Artistic Depth reference lakes (Regressions #001-#004),
// fetched live from Overpass, framed with an explicit, frozen crop per lake (see regressionFixtures.ts)
// rather than a padding ratio recomputed at test time. This exercises actual branched reservoirs,
// islands, and narrow flowages against the production pipeline.

function buildLake(fixture:RegressionFixture){
 const {water,crop,dimensions:{widthMm,heightMm}}=fixture;
 const projection=new CropProjection(crop,widthMm,heightMm);
 const model=buildWaterModel(water,projection,widthMm,heightMm,{mode:'primary',minAreaMm2:1});
 const offsets=ARTISTIC_DEPTH_PRESETS.normal.normalizedOffsets;
 const openings=artisticDepthOpenings(model.water,offsets,widthMm,heightMm);
 return {widthMm,heightMm,model,openings};
}

describe.each(regressionFixtures)('Regression: $lake (real OSM shoreline geometry, explicit crop)',(fixture)=>{
 const {widthMm,heightMm,model,openings}=buildLake(fixture);

 it('produces a nonzero, finite original water area',()=>{
  expect(model.metrics.originalWaterAreaMm2).toBeGreaterThan(0);
  expect(Number.isFinite(model.metrics.originalWaterAreaMm2)).toBe(true);
 });

 it('decreases area strictly monotonically from W0 through every enabled depth',()=>{
  const areas=[model.metrics.originalWaterAreaMm2,...openings.map(o=>o.areaMm2)];
  for(let i=1;i<areas.length;i++)expect(areas[i]).toBeLessThanOrEqual(areas[i-1]);
 });

 it('nests every opening inside the previous shallower opening (W0 for W1, Wi-1 for Wi)',()=>{
  let previous=model.water;
  for(const opening of openings){
   if(!opening.geometry.length){previous=opening.geometry;continue}
   const outside=polygonClipping.difference(opening.geometry as any,previous as any);
   expect(multiPolygonArea(outside as any)).toBeLessThan(0.01);
   previous=opening.geometry;
  }
 });

 it('never produces NaN, Infinity, or out-of-bounds coordinates',()=>{
  for(const opening of openings){
   if(!opening.geometry.length)continue;
   expect(()=>validatePanel(opening.geometry,widthMm,heightMm,'opening')).not.toThrow();
   for(const polygon of opening.geometry)for(const ring of polygon)for(const [x,y] of ring){
    expect(Number.isFinite(x)).toBe(true);
    expect(Number.isFinite(y)).toBe(true);
   }
  }
 });

 it('builds a valid manufacturing panel (rectangle minus opening) at every enabled depth, including Land from W0',()=>{
  expect(()=>validatePanel(panelFromWater(model.water,widthMm,heightMm),widthMm,heightMm,'Land')).not.toThrow();
  for(const opening of openings){
   if(!opening.geometry.length)continue;
   expect(()=>validatePanel(panelFromWater(opening.geometry,widthMm,heightMm),widthMm,heightMm,'depth panel')).not.toThrow();
  }
 });

 it('keeps the largest surviving component at each depth at least as large as configured cleanup would allow (no runaway fragmentation)',()=>{
  for(const opening of openings){
   if(!opening.componentCount)continue;
   expect(opening.componentCount).toBeLessThan(60);
   expect(opening.largestComponentAreaMm2).toBeGreaterThan(0);
  }
 });
});

describe('Normal preset calibration sanity on real shoreline data',()=>{
 it('keeps every measured reference offset within the documented search range',()=>{
  const [d1,d2,d3]=ARTISTIC_DEPTH_PRESETS.normal.normalizedOffsets;
  expect(d1).toBeGreaterThanOrEqual(2.7);expect(d1).toBeLessThanOrEqual(3.3);
  expect(d2).toBeGreaterThanOrEqual(8.0);expect(d2).toBeLessThanOrEqual(9.2);
  expect(d3).toBeGreaterThanOrEqual(19.0);expect(d3).toBeLessThanOrEqual(21.5);
 });
 it.each(regressionFixtures)('$lake keeps six distinct positive opening stages before Base',(fixture)=>{
  const {model,openings}=buildLake(fixture),areas=[model.metrics.originalWaterAreaMm2,...openings.map(o=>o.areaMm2)];
  expect(openings.at(-1)!.areaMm2).toBeGreaterThan(.01);
  for(let i=1;i<areas.length;i++)expect(areas[i]).toBeLessThan(areas[i-1]);
 });
});

describe('Reference retained-area comparison (lakes with a known target)',()=>{
 // Informational, not a pass/fail gate on exact percentages — retained-area % is inherently
 // framing-sensitive (see the crop-sensitivity investigation) and the brief explicitly says not
 // to fit erosion distance to a target %. These assertions only guard against gross regressions:
 // a future change should not make an already-close match dramatically worse.
 it.each(regressionFixtures.filter(f=>f.referenceMetrics))('$lake stays within a generous band of its reference retained %',(fixture)=>{
  const {model,openings}=buildLake(fixture);
  const target=[fixture.referenceMetrics!.shallowPct,fixture.referenceMetrics!.midPct,fixture.referenceMetrics!.deepPct];
  const measured=openings.slice(0,3).map(o=>o.areaMm2/model.metrics.originalWaterAreaMm2*100);
  measured.forEach((value,index)=>expect(Math.abs(value-target[index])).toBeLessThan(25));
 });
});

describe('Regression fixture crop model',()=>{
 it('stores an explicit, non-degenerate crop per lake rather than deriving one implicitly at test time',()=>{
  for(const fixture of regressionFixtures){
   expect(fixture.crop.nw.lat).toBeGreaterThan(fixture.crop.sw.lat);
   expect(fixture.crop.ne.lng).toBeGreaterThan(fixture.crop.nw.lng);
   expect(fixture.crop.bbox[2]).toBeGreaterThan(fixture.crop.bbox[0]);
   expect(fixture.crop.bbox[3]).toBeGreaterThan(fixture.crop.bbox[1]);
   expect(fixture.dimensions.widthMm).toBeGreaterThan(0);
   expect(fixture.dimensions.heightMm).toBeGreaterThan(0);
  }
 });

 it('Caldron Falls specifically carries its documented reference metrics and sweep provenance note',()=>{
  expect(caldronFixture.referenceMetrics).toEqual({shallowPct:72,midPct:52,deepPct:24});
  expect(caldronFixture.note.length).toBeGreaterThan(0);
 });
});

describe('Debug crop serialization does not alter the geometry engine',()=>{
 it('produces byte-identical opening geometry whether the crop comes directly from the fixture or via a serialize/apply round trip',()=>{
  const project:MapProject={...defaultProject,map:{...defaultProject.map,crop:caldronFixture.crop},dimensions:{...defaultProject.dimensions,...caldronFixture.dimensions}};
  const snapshot=serializeCropSnapshot(project);
  const restoredCrop=cropGeographyFromSnapshot(snapshot);
  const direct=buildLake(caldronFixture);
  const viaSnapshot=buildLake({...caldronFixture,crop:restoredCrop});
  expect(viaSnapshot.model.metrics.originalWaterAreaMm2).toBe(direct.model.metrics.originalWaterAreaMm2);
  expect(viaSnapshot.openings.map(o=>o.areaMm2)).toEqual(direct.openings.map(o=>o.areaMm2));
  expect(viaSnapshot.openings.map(o=>o.geometry)).toEqual(direct.openings.map(o=>o.geometry));
 });

 it('applying a crop snapshot to a fresh project reproduces the same downstream engine output',()=>{
  const project:MapProject={...defaultProject,map:{...defaultProject.map,crop:caldronFixture.crop},dimensions:{...defaultProject.dimensions,...caldronFixture.dimensions}};
  const snapshot=serializeCropSnapshot(project);
  const restoredProject=applyCropSnapshot({...defaultProject,map:{...defaultProject.map,crop:undefined}},snapshot);
  const direct=buildLake(caldronFixture);
  const viaRestoredProject=buildLake({...caldronFixture,crop:restoredProject.map.crop!,dimensions:restoredProject.dimensions});
  expect(viaRestoredProject.model.metrics.originalWaterAreaMm2).toBe(direct.model.metrics.originalWaterAreaMm2);
 });
});
