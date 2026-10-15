import * as polygonClipping from 'polygon-clipping';
import ClipperLib from 'clipper-lib';
import {describe,expect,it,vi} from 'vitest';
import {buildGeometryLayers} from '../../src/export/buildScene';
import {cropFromCorners,CropProjection} from '../../src/geometry/projection/cropProjection';
import type {MultiPolygonMm} from '../../src/geometry/shoreline/polygonEngine';
import {robustBoolean} from '../../src/geometry/shoreline/robustBoolean';
import * as nestedBands from '../../src/geometry/terrain/nestedBands';
import {NESTING_AREA_TOLERANCE_MM2,NESTING_SLIVER_TOLERANCE_MM2,areaMm2,enforceNesting,toPaths,type NestingSliver} from '../../src/geometry/terrain/nestedBands';
import {importDepthRegionGeoJson} from '../../src/bathymetry/model';
import {defaultProject} from '../../src/state/defaultProject';
import type {MapProject} from '../../src/types/project';
import {caldronFallsFeatures,caldronFallsProject} from '../fixtures/caldronFalls';
import willow from '../fixtures/lakes/willowFlowageZ13.json';

vi.mock('../../src/geometry/terrain/nestedBands',async original=>{
 const actual=await original<typeof import('../../src/geometry/terrain/nestedBands')>();
 return {...actual,enforceNesting:vi.fn(actual.enforceNesting)};
});

// Depth layers must nest: every depth panel's opening inside the one above it, the first inside the
// shoreline. Each mode builds its openings by clipping to the parent; buildGeometryLayers then
// re-checks the finished openings for all three modes (enforceNesting). Rounding noise passes, a
// sliver under NESTING_SLIVER_TOLERANCE_MM2 is trimmed with a warning, and a real violation blocks
// with the layer and where it is.

const square=(x0:number,y0:number,x1:number,y1:number):MultiPolygonMm=>[[[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]]]];
const outsideArea=(level:MultiPolygonMm,parent:MultiPolygonMm)=>areaMm2(nestedBands.clip(ClipperLib.ClipType.ctDifference,level,toPaths(parent),ClipperLib.PolyFillType.pftEvenOdd,'test'));

describe('enforceNesting: tolerance',()=>{
 const parent=square(0,0,100,80);
 it('leaves a level that is inside its parent untouched',()=>{
  const level=square(10,10,90,70),slivers:NestingSliver[]=[];
  expect(enforceNesting(level,parent,'Layer 3','Layer 2',slivers)).toBe(level);
  expect(slivers).toEqual([]);
 });

 it('trims a synthetic sliver under the tolerance and reports where it was, without blocking',()=>{
  // A 0.05 × 0.1 mm bump (0.005 mm²) past the parent's right edge: above the noise floor, under the
  // 0.01 mm² sliver tolerance.
  const level=robustBoolean('union',square(10,10,100,70),[square(100,40,100.05,40.1)]),slivers:NestingSliver[]=[];
  expect(outsideArea(level,parent)).toBeGreaterThan(NESTING_AREA_TOLERANCE_MM2);
  const trimmed=enforceNesting(level,parent,'Layer 3','Layer 2',slivers);
  expect(slivers).toHaveLength(1);
  expect(slivers[0].areaMm2).toBeGreaterThan(NESTING_AREA_TOLERANCE_MM2);
  expect(slivers[0].areaMm2).toBeLessThanOrEqual(NESTING_SLIVER_TOLERANCE_MM2);
  expect(slivers[0].atMm[0]).toBeCloseTo(100.03,1);
  expect(slivers[0].atMm[1]).toBeCloseTo(40.05,1);
  expect(outsideArea(trimmed,parent)).toBeLessThanOrEqual(NESTING_AREA_TOLERANCE_MM2);
  expect(nestedBands.nestingSliverWarning(slivers[0])).toMatch(/^Layer 3 poked 0\.00\d+ mm² outside Layer 2 near x=100\.0 mm, y=40\.\d mm; .*trimmed\.$/);
 });

 it('still blocks a real violation above the tolerance, naming the layer and where it is',()=>{
  // A 1 × 1 mm tab outside the parent: a deeper panel would be cut outside a shallower one. It
  // measures 0.997 mm²: only material beyond the 0.003 mm rounding band counts.
  const level=robustBoolean('union',square(10,10,100,70),[square(100,30,101,31)]);
  expect(()=>enforceNesting(level,parent,'Layer 4','Layer 3',[],'Depth layers'))
   .toThrow(/^Depth layers: Layer 4 extends 0\.99\d+ mm² outside Layer 3, near x=100\.5 mm, y=30\.5 mm from the top-left of the product\./);
 });

 it('documents the tolerance against the kerf',()=>{
  // Under a 0.15 mm kerf's footprint (~0.02 mm²), and well above the rounding-noise floor.
  expect(NESTING_SLIVER_TOLERANCE_MM2).toBeLessThan(.02);
  expect(NESTING_SLIVER_TOLERANCE_MM2).toBeGreaterThan(NESTING_AREA_TOLERANCE_MM2*5);
 });
});

describe('recorded real lake: Willow Flowage (Oneida Co., WI), zoom 13',()=>{
 const crop=cropFromCorners(willow.crop.nw,willow.crop.ne,willow.crop.se,willow.crop.sw);
 const features={water:willow.water,roads:[],places:[]};
 const project=(mode:MapProject['bathymetry']['mode'],waterMode:'primary'|'all'):MapProject=>({...defaultProject,map:{...defaultProject.map,longitude:willow.center.lng,latitude:willow.center.lat,zoom:willow.zoom,crop},shoreline:{...defaultProject.shoreline,waterMode,enabledLayers:[true,true,true,true,true,true,true]},bathymetry:{...defaultProject.bathymetry,mode}});

 it('is a shoreline the floating-point union cannot handle (what made it un-generatable)',()=>{
  const projection=new CropProjection(crop,defaultProject.dimensions.widthMm,defaultProject.dimensions.heightMm);
  const polygons=willow.water.map(w=>w.rings.map(ring=>ring.map(p=>{const q=projection.project(p);return [q.x,q.y] as [number,number]})));
  expect(()=>polygonClipping.union(polygons[0],...polygons.slice(1))).toThrow(/Unable to complete output ring/);
  expect(robustBoolean('union',polygons[0],polygons.slice(1)).length).toBeGreaterThan(0);
 });

 for(const mode of ['decorative-offsets','procedural-terrain'] as const)for(const waterMode of ['primary','all'] as const){
  it(`generates in ${mode} (${waterMode} water) with every depth panel nested inside the one above`,()=>{
   const geometry=buildGeometryLayers(project(mode,waterMode),features),openings=geometry.layers.slice(1,6).map(layer=>layer.shapes[0]);
   expect(geometry.layers).toHaveLength(7);
   expect(openings.every(shape=>shape.kind==='path'&&!/NaN|Infinity/.test(shape.d!))).toBe(true);
   const areas=geometry.model.metrics.openingAreasMm2;
   for(let i=1;i<areas.length;i++)expect(areas[i]).toBeLessThanOrEqual(areas[i-1]+1e-6);
   expect(geometry.manufacturingWarnings.filter(w=>/poked/.test(w))).toEqual([]);
  });
 }
});

describe('every depth mode goes through the nesting check',()=>{
 const rectangle=(depth:number,delta:number)=>({type:'Feature',properties:{depth,depth_unit:'ft'},geometry:{type:'Polygon',coordinates:[[[-88.21-delta,45.37-delta],[-88.21+delta,45.37-delta],[-88.21+delta,45.37+delta],[-88.21-delta,45.37+delta],[-88.21-delta,45.37-delta]]]}});
 const dataset=importDepthRegionGeoJson({type:'FeatureCollection',features:[rectangle(5,.025),rectangle(15,.015),rectangle(30,.007)]},'nesting.geojson');
 const modes:[string,MapProject][]=[
  ['artistic',caldronFallsProject],
  ['procedural',{...caldronFallsProject,bathymetry:{...caldronFallsProject.bathymetry,mode:'procedural-terrain'}}],
  ['measured bathymetry',{...caldronFallsProject,bathymetry:{mode:'true-bathymetry',provider:'user',datasetId:dataset.source.datasetId,status:'available',selection:'automatic',thresholdsMeters:[],dataset}}],
 ];
 for(const [name,project] of modes)it(`${name}: checks each enabled depth panel against its parent, Land first`,()=>{
  const spy=vi.mocked(nestedBands.enforceNesting);
  spy.mockClear();
  buildGeometryLayers(project,caldronFallsFeatures);
  const calls=spy.mock.calls.filter(call=>call[5]==='Depth layers').map(call=>[call[2],call[3]]);
  expect(calls).toEqual([['Layer 2','Layer 1 (Land / Top)'],['Layer 3','Layer 2'],['Layer 4','Layer 3']]);
 });
});
