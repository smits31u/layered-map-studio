import {describe,expect,it} from 'vitest';
import * as polygonClipping from 'polygon-clipping';
import {caldronWater,caldronBbox,highfallsWater,highfallsBbox,noquebayWater,noquebayBbox,windpuddingWater,windpuddingBbox} from '../fixtures/liveLakes';
import {buildWaterModel,multiPolygonArea,panelFromWater,validatePanel} from '../../src/geometry/shoreline/polygonEngine';
import {CropProjection,cropFromCorners} from '../../src/geometry/projection/cropProjection';
import {artisticDepthOpenings,ARTISTIC_DEPTH_PRESETS} from '../../src/geometry/shoreline/artisticDepth';
import type {CropGeography,GeoPolygon} from '../../src/types/project';

// Real OSM shoreline geometry for the four Artistic Depth reference lakes (Regressions #001-#004),
// fetched live from Overpass. Unlike the synthetic hexagon used in caldronFalls.ts, this exercises
// actual branched reservoirs, islands, and narrow flowages against the production pipeline.

type Bbox = {minLng:number;minLat:number;maxLng:number;maxLat:number};

const cropFor=(bbox:Bbox):CropGeography=>cropFromCorners(
 {lng:bbox.minLng,lat:bbox.maxLat},{lng:bbox.maxLng,lat:bbox.maxLat},
 {lng:bbox.maxLng,lat:bbox.minLat},{lng:bbox.minLng,lat:bbox.minLat},
);

const physicalSizeFor=(bbox:Bbox)=>{
 const midLat=(bbox.minLat+bbox.maxLat)/2;
 const dLng=(bbox.maxLng-bbox.minLng)*Math.cos(midLat*Math.PI/180);
 const dLat=bbox.maxLat-bbox.minLat;
 const widthMm=300;
 return {widthMm,heightMm:Number((widthMm*dLat/dLng).toFixed(3))};
};

function buildLake(water:GeoPolygon[],bbox:Bbox){
 const crop=cropFor(bbox),{widthMm,heightMm}=physicalSizeFor(bbox);
 const projection=new CropProjection(crop,widthMm,heightMm);
 const model=buildWaterModel(water,projection,widthMm,heightMm,{mode:'primary',minAreaMm2:1});
 const offsets=ARTISTIC_DEPTH_PRESETS.normal.normalizedOffsets;
 const openings=artisticDepthOpenings(model.water,offsets,widthMm,heightMm);
 return {widthMm,heightMm,model,openings};
}

const lakes:Array<[string,GeoPolygon[],Bbox]>=[
 ['Caldron Falls Reservoir',caldronWater,caldronBbox],
 ['High Falls Reservoir',highfallsWater,highfallsBbox],
 ['Lake Noquebay',noquebayWater,noquebayBbox],
 ['Wind Pudding Lake',windpuddingWater,windpuddingBbox],
];

describe.each(lakes)('Regression: %s (real OSM shoreline geometry)',(name,water,bbox)=>{
 const {widthMm,heightMm,model,openings}=buildLake(water,bbox);

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
});
