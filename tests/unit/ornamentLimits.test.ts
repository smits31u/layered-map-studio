import {describe,expect,it} from 'vitest';
import {extractCapturedFeatures,type CaptureMapFeature} from '../../src/ornament/capture/mapCapture';
import {buildFeatureGeometry} from '../../src/ornament/geometry/featureGeometry';
import {simplifyLine,simplifyRing} from '../../src/ornament/geometry/simplify';
import {assessCaptureCapacity,countCapturedVertices,estimateCaptureBytes,ORNAMENT_CAPACITY} from '../../src/ornament/limits';
import {OPENFREEMAP} from '../../src/ornament/map/provider';
import {FIXTURE_CENTER} from '../fixtures/ornament/captures';
import {fixtureCapture} from '../helpers/ornamentCapture';
import {GOLDEN_SETTINGS} from '../helpers/ornamentGolden';

// Phase 5's "feature-count, vertex-count, memory, and simplification limits", sized for an ornament
// of 4in or less. Two things need to be true and are easy to get wrong in opposite directions: a
// capture dense enough to hang the tab must be refused with an instruction, and an ordinary capture
// must pass through untouched — a limit that quietly thins every export would be worse than none.

// A road running due east from the fixture centre with `points` vertices, spaced finely enough that
// consecutive points are far below the simplification tolerance once projected.
const denseRoad=(points:number,lat=FIXTURE_CENTER[1]):CaptureMapFeature=>({
 sourceLayer:'transportation',
 layer:{id:'roads-low'},
 properties:{class:'motorway'},
 geometry:{
  type:'LineString',
  coordinates:Array.from({length:points},(_,index)=>[FIXTURE_CENTER[0]+index*1e-6,lat]),
 },
});

const tinyRoads=(count:number):CaptureMapFeature[]=>Array.from({length:count},(_,index)=>({
 sourceLayer:'transportation',
 layer:{id:'roads-low'},
 properties:{class:'motorway'},
 geometry:{type:'LineString',coordinates:[[FIXTURE_CENTER[0],FIXTURE_CENTER[1]+index*1e-7],[FIXTURE_CENTER[0]+1e-5,FIXTURE_CENTER[1]+index*1e-7]]},
}));

const featuresOf=(raw:CaptureMapFeature[])=>extractCapturedFeatures(raw,OPENFREEMAP);

describe('capture capacity',()=>{
 it('counts vertices across roads and every water ring',()=>{
  const features=featuresOf([
   denseRoad(10),
   {sourceLayer:'water',layer:{id:'water'},geometry:{type:'Polygon',coordinates:[
    [[0,0],[0,1],[1,1],[1,0],[0,0]],
    [[.2,.2],[.2,.4],[.4,.4],[.2,.2]],
   ]}},
  ]);
  // 10 road points, then a 5-point outer ring and a 4-point hole.
  expect(countCapturedVertices(features)).toBe(19);
 });

 it('lets an ordinary capture through with nothing to do',()=>{
  const capacity=assessCaptureCapacity(featuresOf([denseRoad(40),...tinyRoads(5)]));
  expect(capacity.refusal).toBeUndefined();
  expect(capacity.simplifyToleranceMm).toBeUndefined();
  expect(capacity.featureCount).toBe(6);
 });

 it('asks for simplification once a capture passes the density threshold',()=>{
  const capacity=assessCaptureCapacity(featuresOf([denseRoad(ORNAMENT_CAPACITY.simplifyAboveVertices+50)]));
  expect(capacity.refusal).toBeUndefined();
  expect(capacity.simplifyToleranceMm).toBe(ORNAMENT_CAPACITY.simplifyToleranceMm);
 });

 it('refuses too many features, and the refusal says what to change',()=>{
  const capacity=assessCaptureCapacity(featuresOf(tinyRoads(ORNAMENT_CAPACITY.maxCapturedFeatures+1)));
  expect(capacity.refusal).toBeTruthy();
  // Actionable, per the exit criterion: the message names both levers the user actually has.
  expect(capacity.refusal).toMatch(/zoom in/i);
  expect(capacity.refusal).toMatch(/detail/i);
 });

 it('refuses too many vertices even when the feature count is small',()=>{
  const capacity=assessCaptureCapacity(featuresOf([denseRoad(ORNAMENT_CAPACITY.maxCapturedVertices+10)]));
  expect(capacity.refusal).toMatch(/points/i);
  expect(capacity.featureCount).toBe(1);
 });

 it('estimates memory from the vertex count so a refusal can quote a size',()=>{
  expect(estimateCaptureBytes(1000)).toBe(1000*ORNAMENT_CAPACITY.bytesPerVertex);
 });

 it('is sized for the ornament this tool is for, not an arbitrary one',()=>{
  expect(ORNAMENT_CAPACITY.sizedForDiameterMm).toBeCloseTo(101.6,1);
  expect(ORNAMENT_CAPACITY.simplifyAboveVertices).toBeLessThan(ORNAMENT_CAPACITY.maxCapturedVertices);
 });
});

describe('simplification',()=>{
 it('drops collinear points and keeps the ends',()=>{
  const line:[number,number][]=[[0,0],[1,0],[2,0],[3,0],[4,0]];
  expect(simplifyLine(line,.04)).toEqual([[0,0],[4,0]]);
 });

 it('keeps a deviation larger than the tolerance',()=>{
  const line:[number,number][]=[[0,0],[2,1],[4,0]];
  expect(simplifyLine(line,.04)).toEqual(line);
 });

 it('never moves a point — it only removes them',()=>{
  const line:[number,number][]=[[0,0],[1,.01],[2,.5],[3,.01],[4,0]];
  for(const point of simplifyLine(line,.04))expect(line).toContainEqual(point);
 });

 it('keeps a ring closed',()=>{
  const ring:[number,number][]=[[0,0],[1,0],[2,0],[2,2],[0,2],[0,0]];
  const simplified=simplifyRing(ring,.04);
  expect(simplified[0]).toEqual(simplified[simplified.length-1]);
  expect(simplified.length).toBeLessThan(ring.length);
 });

 it('returns a ring unchanged rather than destroying it when it would collapse',()=>{
  // Three nearly-collinear points: simplifying to tolerance would leave two, which is not a polygon.
  const ring:[number,number][]=[[0,0],[1,.0001],[2,0],[0,0]];
  expect(simplifyRing(ring,.04)).toEqual(ring);
 });

 it('does nothing at a zero tolerance',()=>{
  const line:[number,number][]=[[0,0],[1,0],[2,0]];
  expect(simplifyLine(line,0)).toEqual(line);
 });
});

describe('the geometry pipeline under the limits',()=>{
 it('leaves an ordinary capture unsimplified, so an everyday export is untouched',()=>{
  const result=buildFeatureGeometry({revision:1,capture:fixtureCapture([denseRoad(40)]),settings:GOLDEN_SETTINGS});
  expect(result.metrics.simplification).toBeUndefined();
  expect(result.warnings.map(w=>w.code)).not.toContain('capture-simplified');
 });

 it('thins a dense capture, reports it, and says the finished piece is unchanged',()=>{
  const capture=fixtureCapture([denseRoad(ORNAMENT_CAPACITY.simplifyAboveVertices+500)]);
  const result=buildFeatureGeometry({revision:1,capture,settings:GOLDEN_SETTINGS});
  const simplification=result.metrics.simplification;
  expect(simplification).toBeDefined();
  expect(simplification!.verticesAfter).toBeLessThan(simplification!.verticesBefore);
  expect(simplification!.toleranceMm).toBe(ORNAMENT_CAPACITY.simplifyToleranceMm);
  const warning=result.warnings.find(w=>w.code==='capture-simplified');
  expect(warning?.severity).toBe('warning');
  expect(warning?.message).toMatch(/finished piece is unchanged/);
 });

 it('records what was captured in the metrics either way',()=>{
  const result=buildFeatureGeometry({revision:1,capture:fixtureCapture([denseRoad(40),...tinyRoads(3)]),settings:GOLDEN_SETTINGS});
  expect(result.metrics.capturedFeatures).toBe(4);
  expect(result.metrics.capturedVertices).toBe(40+3*2);
 });

 it('stays deterministic when simplification runs',()=>{
  const capture=fixtureCapture([denseRoad(ORNAMENT_CAPACITY.simplifyAboveVertices+500)]);
  const first=buildFeatureGeometry({revision:1,capture,settings:GOLDEN_SETTINGS});
  const second=buildFeatureGeometry({revision:1,capture,settings:GOLDEN_SETTINGS});
  expect(JSON.stringify(second.roadsEngrave)).toBe(JSON.stringify(first.roadsEngrave));
 });
});
