import {describe,expect,it} from 'vitest';
import * as polygonClipping from 'polygon-clipping';
import {closeWater,artisticDepthOpenings,DEFAULT_ARTISTIC_DEPTH_CLEANUP,normalizedOffsetToMm} from '../../src/geometry/shoreline/artisticDepth';
import {buildWaterModel,multiPolygonArea} from '../../src/geometry/shoreline/polygonEngine';
import {CropProjection} from '../../src/geometry/projection/cropProjection';
import {caldronFixture,noquebayFixture,windPuddingFixture} from '../fixtures/regressionFixtures';

// Root cause (see the Caldron collapse investigation): shorelines with high perimeter-to-area
// complexity (branches, islands — e.g. Caldron Falls) shed disproportionately more area than
// simple/round shorelines under uniform Euclidean erosion, because narrow necks pinched by land
// intrusions disconnect early. closeWater (dilate then erode by the same amount) heals those necks
// in the working copy used to compute each depth's erosion, without changing the true W0 shoreline
// used by Land. This is applied with a depth-indexed schedule (stronger at deeper, more collapse-
// prone layers) via DEFAULT_ARTISTIC_DEPTH_CLEANUP.closingEpsilonNormalized.
describe('morphological closing pre-pass (narrow-channel fix)',()=>{
 it('is a no-op at epsilon <= 0',()=>{
  const water=caldronFixture.water,projection=new CropProjection(caldronFixture.crop,caldronFixture.dimensions.widthMm,caldronFixture.dimensions.heightMm);
  const model=buildWaterModel(water,projection,caldronFixture.dimensions.widthMm,caldronFixture.dimensions.heightMm,{mode:'primary',minAreaMm2:1});
  expect(closeWater(model.water,0,caldronFixture.dimensions.widthMm,caldronFixture.dimensions.heightMm)).toEqual(model.water);
 });

 it('never shrinks area on real shoreline data (closing is extensive: close(S) always contains S)',()=>{
  for(const fixture of [caldronFixture,noquebayFixture,windPuddingFixture]){
   const {widthMm,heightMm}=fixture.dimensions,projection=new CropProjection(fixture.crop,widthMm,heightMm);
   const model=buildWaterModel(fixture.water,projection,widthMm,heightMm,{mode:'primary',minAreaMm2:1});
   const originalArea=multiPolygonArea(model.water);
   for(const epsilonUnits of [4,6,7]){
    const closed=closeWater(model.water,normalizedOffsetToMm(epsilonUnits,widthMm),widthMm,heightMm);
    expect(multiPolygonArea(closed),`${fixture.lake} at epsilon=${epsilonUnits}`).toBeGreaterThanOrEqual(originalArea-.01);
   }
  }
 });

 it('brings Caldron Falls within the documented acceptance band (W1 +/-3, W2/W3 +/-5) using the production default schedule',()=>{
  const {water,crop,dimensions}=caldronFixture,{widthMm,heightMm}=dimensions;
  const projection=new CropProjection(crop,widthMm,heightMm);
  const model=buildWaterModel(water,projection,widthMm,heightMm,{mode:'primary',minAreaMm2:1});
  const openings=artisticDepthOpenings(model.water,[3,9,20],widthMm,heightMm);
  const w0=multiPolygonArea(model.water);
  const measured=openings.map(o=>o.areaMm2/w0*100),target=[72,52,24],tolerance=[3,5,5];
  measured.forEach((value,index)=>expect(Math.abs(value-target[index]),`W${index+1}`).toBeLessThanOrEqual(tolerance[index]));
 });

 it('does not materially damage the already-close Noquebay and Wind Pudding matches',()=>{
  for(const [fixture,target] of [[noquebayFixture,[88,72,42]],[windPuddingFixture,[77,43,7]]] as const){
   const {water,crop,dimensions}=fixture,{widthMm,heightMm}=dimensions;
   const projection=new CropProjection(crop,widthMm,heightMm);
   const model=buildWaterModel(water,projection,widthMm,heightMm,{mode:'primary',minAreaMm2:1});
   const openings=artisticDepthOpenings(model.water,[3,9,20],widthMm,heightMm);
   const w0=multiPolygonArea(model.water);
   const measured=openings.map(o=>o.areaMm2/w0*100);
   measured.forEach((value,index)=>expect(Math.abs(value-target[index]),`${fixture.lake} W${index+1}`).toBeLessThan(8));
  }
 });

 it('keeps every opening strictly nested inside the previous opening even with different closing epsilon per depth',()=>{
  // This is the specific bug found and fixed while implementing the closing pre-pass: plain
  // Euclidean-erosion monotonicity no longer guarantees Wi stays inside Wi-1 once closing epsilon
  // varies by depth (a more-closed deeper level can heal a neck a less-closed shallower level
  // excluded), so artisticDepthStages must explicitly clamp each depth to the previous one.
  const {water,crop,dimensions}=caldronFixture,{widthMm,heightMm}=dimensions;
  const projection=new CropProjection(crop,widthMm,heightMm);
  const model=buildWaterModel(water,projection,widthMm,heightMm,{mode:'primary',minAreaMm2:1});
  const openings=artisticDepthOpenings(model.water,[3,9,20,34,52],widthMm,heightMm);
  let previous=model.water;
  for(const opening of openings){
   if(!opening.geometry.length){previous=opening.geometry;continue}
   const outside=polygonClipping.difference(opening.geometry as any,previous as any);
   expect(multiPolygonArea(outside as any)).toBeLessThan(0.01);
   previous=opening.geometry;
  }
 });

 it('custom cleanup configs that omit closingEpsilonNormalized behave exactly as before (no closing)',()=>{
  const {preOffsetSimplifyTolerance,postOffsetSimplifyTolerance,minimumComponentAreaNormalized,minimumComponentAreaRatio,minimumHoleAreaNormalized,cropEdgeMinimumAreaNormalized}=DEFAULT_ARTISTIC_DEPTH_CLEANUP;
  const legacyCleanup={preOffsetSimplifyTolerance,postOffsetSimplifyTolerance,minimumComponentAreaNormalized,minimumComponentAreaRatio,minimumHoleAreaNormalized,cropEdgeMinimumAreaNormalized}; // no closingEpsilonNormalized field
  const water=caldronFixture.water,{widthMm,heightMm}=caldronFixture.dimensions,projection=new CropProjection(caldronFixture.crop,widthMm,heightMm);
  const model=buildWaterModel(water,projection,widthMm,heightMm,{mode:'primary',minAreaMm2:1});
  const withExplicitZero=artisticDepthOpenings(model.water,[9],widthMm,heightMm,undefined,{...legacyCleanup,closingEpsilonNormalized:[0]});
  const withOmittedField=artisticDepthOpenings(model.water,[9],widthMm,heightMm,undefined,legacyCleanup);
  expect(withOmittedField[0].geometry).toEqual(withExplicitZero[0].geometry);
 });
});
