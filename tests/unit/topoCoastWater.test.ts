import ClipperLib from 'clipper-lib';
import {beforeAll,describe,expect,it} from 'vitest';
import type {MultiPolygonMm} from '../../src/geometry/shoreline/polygonEngine';
import {pointInRing} from '../../src/geometry/terrain/contourGeometry';
import {areaMm2,clip,toPaths} from '../../src/geometry/terrain/nestedBands';
import type {TopoCapture} from '../../src/topo/capture/topoCapture';
import {boardProjection} from '../../src/topo/features/projection';
import {generateTerrain,type TerrainResult,type TerrainSettings} from '../../src/topo/terrain/pipeline';
import {flattenGeometry,geometryFingerprint} from '../helpers/terrarium';
import {loadFixtureTiles,loadTopoFixture,replayCapture} from '../helpers/topoFixtures';

// Phase 2's known gap, checked on real data: a coastal board layered the sea floor as land, because
// Terrarium tiles include bathymetry and nothing captured water to subtract.
//
// The fixture is real (tests/fixtures/topo/README.md): the Golden Gate at map zoom 12 on a 9 in
// board, recorded in headless Chromium through the real MapLibre, the real OpenFreeMap basemap and
// captureTopoFeatures itself, plus the nine Terrarium tiles the pipeline plans for that view, byte
// for byte as the terrain proxy served them. The same capture and tiles are run twice: without water
// (Phase 2's behaviour, which the page still produces when no map is available) and with it.

const HEAVY=120_000;
const fixture=loadTopoFixture('sf-coast');
// The app's defaults: four layers at 50/25/12%, 8 contours, smoothing 3, the full working grid.
const SETTINGS:TerrainSettings={layerCount:4,coveragePercent:[100,50,25,12],contoursEnabled:true,contourCount:8,smoothingRadius:3};

const insideGeometry=(x:number,y:number,g:MultiPolygonMm)=>g.some(polygon=>pointInRing(x,y,polygon[0])&&!polygon.slice(1).some(hole=>pointInRing(x,y,hole)));
const overlap=(a:MultiPolygonMm,b:MultiPolygonMm)=>a.length&&b.length?areaMm2(clip(ClipperLib.ClipType.ctIntersection,a,toPaths(b),ClipperLib.PolyFillType.pftEvenOdd,'test','test')):0;
const contourVerticesIn=(r:TerrainResult,g:MultiPolygonMm)=>r.contours.reduce((n,level)=>n+level.lines.reduce((m,line)=>m+line.slice(1,-1).filter(([x,y])=>insideGeometry(x,y,g)).length,0),0);
const fingerprint=(r:TerrainResult)=>{
 const numbers:number[]=[r.elevation.minM,r.elevation.maxM];
 flattenGeometry(r.water,numbers);
 for(const layer of r.layers){numbers.push(layer.thresholdM??-1e300);flattenGeometry(layer.geometry,numbers)}
 for(const level of r.contours){numbers.push(level.elevation);for(const line of level.lines){for(const [x,y] of line)numbers.push(x,y);numbers.push(1e300)}}
 return geometryFingerprint({numbers});
};

// Places on the board, by their real coordinates.
const PLACES={
 // Mid-channel, just west of the bridge: about 100 m deep.
 strait:[-122.4880,37.8135] as [number,number],
 // Open bay east of the bridge.
 bay:[-122.4560,37.8290] as [number,number],
 // Hawk Hill, Marin Headlands: ~280 m.
 hawkHill:[-122.4990,37.8265] as [number,number],
 // The Presidio.
 presidio:[-122.4660,37.7990] as [number,number],
};

let capture:TopoCapture,before:TerrainResult,after:TerrainResult;
let W:number,H:number,at:(place:[number,number])=>[number,number];
beforeAll(async()=>{
 capture=(await replayCapture(fixture)).capture;
 const tiles=loadFixtureTiles('sf-coast');
 before=generateTerrain({view:capture.view,tiles,water:[],settings:SETTINGS});
 after=generateTerrain({view:capture.view,tiles,water:[],capturedWater:capture.features.water,settings:SETTINGS});
 W=capture.view.widthMm;H=capture.view.heightMm;
 const project=boardProjection(capture.view);
 at=([lng,lat])=>project(lng,lat);
},HEAVY);

describe('the recorded capture',()=>{
 it('replays to exactly what captureTopoFeatures returned in the browser',()=>{
  expect(capture.features.counts).toEqual(fixture.expected.counts);
  expect(capture.features.water).toHaveLength(fixture.expected.water);
  expect(capture.features.roads).toHaveLength(fixture.expected.roads);
  expect(capture.labels).toHaveLength(fixture.expected.labels);
  expect(capture.layers).toEqual(fixture.expected.layers);
  expect(capture.view).toEqual(fixture.expected.view);
  // Water was found by source-layer in the real basemap style, not by a hard-coded id.
  expect(capture.layers.water).toContain('water');
 });

 it('holds the ocean and an inland lake',()=>{
  const classes=fixture.rendered.features.filter(f=>f.sourceLayer==='water').map(f=>f.properties?.class);
  expect(classes).toEqual(expect.arrayContaining(['ocean','lake']));
  expect(capture.features.water.length).toBe(3);
 });
});

describe('before: no water captured (Phase 2 behaviour)',()=>{
 it('layers the sea floor as land',()=>{
  expect(before.water).toEqual([]);
  expect(before.layers[0].areaMm2).toBeCloseTo(W*H,3);
  // The strait's bed is the lowest "land" on the board.
  expect(before.elevation.minM).toBeLessThan(-100);
  const [sx,sy]=at(PLACES.strait),[bx,by]=at(PLACES.bay);
  expect(insideGeometry(sx,sy,before.layers[0].geometry)).toBe(true);
  expect(insideGeometry(bx,by,before.layers[0].geometry)).toBe(true);
  // The sea floor drags the quantiles below sea level: half the "land" is under water.
  expect(before.layers[1].thresholdM!).toBeLessThan(0);
  // And contour lines are drawn across the sea bed.
  expect(before.contours.some(level=>level.elevation<0)).toBe(true);
  expect(contourVerticesIn(before,after.water)).toBeGreaterThan(100);
  // 60–70% of layer 1 is water.
  expect(overlap(before.layers[0].geometry,after.water)/(W*H)).toBeGreaterThan(.6);
 },HEAVY);
});

describe('after: water captured and subtracted',()=>{
 it('builds a water region for the strait, bay, ocean and lake, inside the board',()=>{
  const share=areaMm2(after.water)/(W*H);
  expect(share).toBeGreaterThan(.6);
  expect(share).toBeLessThan(.7);
  expect(after.waterMetrics).toMatchObject({inputPolygons:3,rejectedRings:0,components:3});
  const [sx,sy]=at(PLACES.strait),[bx,by]=at(PLACES.bay);
  expect(insideGeometry(sx,sy,after.water)).toBe(true);
  expect(insideGeometry(bx,by,after.water)).toBe(true);
  for(const polygon of after.water)for(const ring of polygon)for(const [x,y] of ring){
   expect(Number.isFinite(x)&&Number.isFinite(y)).toBe(true);
   expect(x>=-1e-9&&x<=W+1e-9&&y>=-1e-9&&y<=H+1e-9).toBe(true);
  }
 });

 it('no longer shows the sea floor as land: water is cut from every layer and every contour',()=>{
  for(const layer of after.layers)expect(overlap(layer.geometry,after.water)).toBeLessThan(.01);
  expect(after.layers[0].areaMm2).toBeCloseTo(W*H-areaMm2(after.water),0);
  const [sx,sy]=at(PLACES.strait),[bx,by]=at(PLACES.bay);
  for(const layer of after.layers){
   expect(insideGeometry(sx,sy,layer.geometry)).toBe(false);
   expect(insideGeometry(bx,by,layer.geometry)).toBe(false);
  }
  expect(contourVerticesIn(after,after.water)).toBe(0);
  expect(after.contours.every(level=>level.elevation>0)).toBe(true);
 },HEAVY);

 it('takes the quantiles and elevation range from the land only',()=>{
  // Only shoreline samples, blended with the sea bed by the resampler, dip below zero.
  expect(after.elevation.minM).toBeGreaterThan(-10);
  expect(after.elevation.maxM).toBeCloseTo(before.elevation.maxM,6);
  for(const layer of after.layers.slice(1)){
   expect(layer.thresholdM!).toBeGreaterThan(0);
   expect(Math.abs(layer.coveragePercent-layer.targetCoveragePercent)).toBeLessThan(2);
  }
 });

 it('keeps the land: the Marin Headlands and the Presidio, nested 4 ⊂ 3 ⊂ 2 ⊂ 1',()=>{
  const [hx,hy]=at(PLACES.hawkHill),[px,py]=at(PLACES.presidio);
  expect(insideGeometry(hx,hy,after.layers[0].geometry)).toBe(true);
  expect(insideGeometry(px,py,after.layers[0].geometry)).toBe(true);
  // Hawk Hill is among the highest ground on the board.
  expect(insideGeometry(hx,hy,after.layers[3].geometry)).toBe(true);
  for(let k=1;k<4;k++)for(const polygon of after.layers[k].geometry)for(const ring of polygon)for(const [x,y] of ring)
   expect(insideGeometry(x,y,after.layers[k-1].geometry)).toBe(true);
 },HEAVY);

 it('is deterministic',()=>{
  const again=generateTerrain({view:capture.view,tiles:loadFixtureTiles('sf-coast'),water:[],capturedWater:capture.features.water,settings:SETTINGS});
  expect(fingerprint(again)).toBe(fingerprint(after));
 },HEAVY);
});
