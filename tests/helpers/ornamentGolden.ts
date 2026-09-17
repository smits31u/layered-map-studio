import type {MultiPolygonMm} from '../../src/geometry/shoreline/polygonEngine';
import {buildFeatureGeometry,type FeatureGeometryResult,type FeatureGeometrySettings} from '../../src/ornament/geometry/featureGeometry';
import {GOLDEN_FIXTURES,type GoldenFixtureName} from '../fixtures/ornament/captures';
import {fixtureCapture} from './ornamentCapture';

// The digest a golden fixture is recorded as, shared by the test that checks it and the script that
// regenerates it.
//
// It is a digest rather than the geometry because a golden file of several megabytes of coordinates
// cannot be reviewed: a one-vertex change and a catastrophic one produce diffs of the same shape.
// Component counts, hole counts, areas, bounding boxes and warning codes change visibly and say
// which part of the pipeline moved. Coordinate-level determinism is asserted separately, by building
// the same fixture twice.

const round=(value:number)=>Number(value.toFixed(3));

export const boundsOf=(geometry:MultiPolygonMm):number[]|null=>{
 if(!geometry.length)return null;
 let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
 for(const [x,y] of geometry.flat().flat()){if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y}
 return [round(minX),round(minY),round(maxX),round(maxY)];
};

export const digest=(result:FeatureGeometryResult)=>({
 roads:{
  components:result.roadsEngrave.length,
  vertices:result.metrics.roads.vertices,
  areaMm2:round(result.metrics.roads.areaMm2),
  widthsMm:result.metrics.roads.widthsMm.map(round),
  bounds:boundsOf(result.roadsEngrave),
 },
 water:{
  components:result.metrics.water.components,
  holes:result.metrics.water.holes,
  filledHoles:result.metrics.water.filledHoles,
  areaMm2:round(result.metrics.water.areaMm2),
  bounds:boundsOf(result.waterEngrave.length?result.waterEngrave:result.waterCut),
 },
 land:{
  components:result.landCut.length,
  areaMm2:round(result.metrics.landAreaMm2),
  islandsDetected:result.islands.detected.length,
  islandsRemaining:result.islands.remaining.length,
 },
 warnings:result.warnings.map(warning=>warning.code).sort(),
});

export const GOLDEN_SETTINGS:FeatureGeometrySettings={
 diameterMm:101.6,
 detail:'high',
 widthScale:1,
 buildMode:'classic-2-piece',
 // Pinned to 'keep-separate' rather than tracking the app default, which is now 'bridge'. A golden
 // fixture exists to show what the pipeline does to a given input; if it followed the default, a
 // change of default would silently rewrite every recorded digest and the file would stop being
 // evidence of anything. The default is exercised on its own in ornamentLandIslands.test.ts.
 // Pinned at 4mm-squared rather than tracking the app default, which is now 2mm-squared, for the
 // same reason the policy is pinned: a golden file records what the pipeline does to a given input,
 // and one that followed the defaults would rewrite itself every time a default moved.
 land:{islandPolicy:'keep-separate',minIslandAreaMm2:4,bridgeWidthMm:1.5,structuralRingWidthMm:2},
};

export const buildGoldenFixture=(name:GoldenFixtureName,over:Partial<FeatureGeometrySettings>={}):FeatureGeometryResult=>
 buildFeatureGeometry({
  revision:1,
  capture:fixtureCapture(GOLDEN_FIXTURES[name](),{detail:'high'}),
  settings:{...GOLDEN_SETTINGS,...over},
 });
