import {describe,expect,it} from 'vitest';
import {multiPolygonArea} from '../../src/geometry/shoreline/polygonEngine';
import {buildFeatureGeometry,type FeatureGeometrySettings} from '../../src/ornament/geometry/featureGeometry';
import type {LandIslandPolicy} from '../../src/ornament/geometry/landIslands';
import {coastCapture,GOLDEN_FIXTURES,GOLDEN_FIXTURE_NAMES,lakeCapture} from '../fixtures/ornament/captures';
import {DEFAULT_CHORD_Y_MM,DEFAULT_INNER_RADIUS_MM,fixtureCapture} from '../helpers/ornamentCapture';
import {buildGoldenFixture,digest} from '../helpers/ornamentGolden';

// Phase 3's exit criteria: "fixed city, coast, island, and rural fixtures generate deterministic,
// valid geometry without freezing the UI." The last clause is the worker's job and is covered in
// `ornamentGeometryWorker.test.ts`; the first two are here.
//
// Each fixture is recorded as a digest under tests/fixtures/ornament/golden/ rather than as the
// geometry itself. Storing several megabytes of coordinates would make any real change unreviewable —
// a one-vertex difference and a catastrophic one produce diffs of the same shape — while a digest of
// component counts, hole counts, areas, bounding boxes and warning codes changes visibly and says
// which part of the pipeline moved. Determinism at the coordinate level is asserted separately, by
// building the same fixture twice and comparing the serialisations.
//
// Regenerate with `npx vitest run -u`, then read the diff before committing it. That diff is the
// whole value of a golden file; regenerating to make a red test green defeats the point of having one.

const settings=(over:Partial<FeatureGeometrySettings>={}):FeatureGeometrySettings=>({
 diameterMm:101.6,
 detail:'high',
 widthScale:1,
 buildMode:'classic-2-piece',
 land:{islandPolicy:'keep-separate',minIslandAreaMm2:4,bridgeWidthMm:1.5,structuralRingWidthMm:2},
 ...over,
});

const buildFixture=buildGoldenFixture;

// Serialised rather than compared as an object so the recorded file is readable JSON that a reviewer
// can diff line by line, instead of a pretty-printed object dump.
const record=(result:Parameters<typeof digest>[0])=>JSON.stringify(digest(result),null,1)+'\n';

describe('golden fixtures',()=>{
 it('covers the four cases the plan names',()=>{
  expect(GOLDEN_FIXTURE_NAMES).toEqual(['city','rural','lake','coast']);
 });

 describe.each(GOLDEN_FIXTURE_NAMES)('%s',name=>{
  const classic=buildFixture(name);
  const cutout=buildFixture(name,{buildMode:'water-cutout-3-piece'});

  it('matches the recorded classic-mode digest',async()=>{
   await expect(record(classic)).toMatchFileSnapshot(`../fixtures/ornament/golden/${name}.classic.json`);
  });

  it('matches the recorded water-cutout digest',async()=>{
   await expect(record(cutout)).toMatchFileSnapshot(`../fixtures/ornament/golden/${name}.water-cutout.json`);
  });

  it('is deterministic down to the coordinate',()=>{
   const again=buildFixture(name);
   expect(JSON.stringify(again.roadsEngrave)).toBe(JSON.stringify(classic.roadsEngrave));
   expect(JSON.stringify(again.waterEngrave)).toBe(JSON.stringify(classic.waterEngrave));
  });

  it('produces only finite coordinates',()=>{
   for(const geometry of [classic.roadsEngrave,classic.waterEngrave,cutout.landCut,cutout.waterCut])
    for(const [x,y] of geometry.flat().flat()){
     expect(Number.isFinite(x)).toBe(true);
     expect(Number.isFinite(y)).toBe(true);
    }
  });

  it('closes every ring',()=>{
   for(const geometry of [classic.roadsEngrave,classic.waterEngrave,cutout.landCut,cutout.waterCut])
    for(const polygon of geometry)for(const ring of polygon){
     expect(ring.length).toBeGreaterThanOrEqual(4);
     expect(ring[0]).toEqual(ring[ring.length-1]);
    }
  });

  // Water is clipped to the disk, so it stops exactly at the boundary. Roads are *centrelines*
  // clipped to the window and then given a physical width, so their engraving legitimately reaches
  // half a road-width past it — which is what a road running along the rim looks like on the
  // finished piece. The widest road at the reference diameter is 0.9mm, so half a millimetre is the
  // real allowance and a whole one is a comfortable bound on it.
  const MAX_ROAD_OVERHANG_MM=1;

  it('stays inside the ornament map window',()=>{
   for(const [x,y] of classic.roadsEngrave.flat().flat()){
    expect(Math.hypot(x,y)).toBeLessThanOrEqual(DEFAULT_INNER_RADIUS_MM+MAX_ROAD_OVERHANG_MM);
    expect(y).toBeLessThanOrEqual(DEFAULT_CHORD_Y_MM+MAX_ROAD_OVERHANG_MM);
   }
   for(const [x,y] of classic.waterEngrave.flat().flat())
    expect(Math.hypot(x,y)).toBeLessThanOrEqual(DEFAULT_INNER_RADIUS_MM+1e-6);
  });

  it('keeps water out of classic mode geometry and land out of cutout-free mode',()=>{
   expect(classic.landCut).toHaveLength(0);
   expect(classic.waterCut).toHaveLength(0);
   expect(cutout.waterEngrave).toHaveLength(0);
  });
 });
});

describe('the fixtures exercise what they are named for',()=>{
 it('the city fixture is dense and rectilinear',()=>{
  const city=buildFixture('city');
  expect(city.metrics.roads.clippedPieces).toBeGreaterThan(20);
  expect(city.metrics.roads.widthsMm.length).toBeGreaterThanOrEqual(3);
  expect(city.metrics.water.components).toBe(0);
 });

 it('the rural fixture has road ends inside the disk, so caps are exercised',()=>{
  const rural=buildFixture('rural');
  expect(rural.roadsEngrave.length).toBeGreaterThan(0);
  const points=rural.roadsEngrave.flat().flat();
  const inside=points.filter(([x,y])=>Math.hypot(x,y)<DEFAULT_INNER_RADIUS_MM-2);
  expect(inside.length).toBeGreaterThan(20);
 });

 it('the lake fixture keeps its islands and reports the one too small to cut',()=>{
  const lake=buildFixture('lake');
  expect(lake.metrics.water.holes).toBeGreaterThanOrEqual(2);
  expect(lake.metrics.water.filledHoles).toBeGreaterThanOrEqual(1);
  expect(lake.warnings.map(warning=>warning.code)).toContain('water-holes-filled');
 });

 it('the coast fixture crosses the ornament boundary and strands land',()=>{
  const coast=buildFixture('coast',{buildMode:'water-cutout-3-piece',land:{islandPolicy:'keep-separate',minIslandAreaMm2:4,bridgeWidthMm:1.5,structuralRingWidthMm:0}});
  expect(coast.metrics.water.areaMm2).toBeGreaterThan(100);
  expect(coast.islands.detected.length).toBeGreaterThanOrEqual(1);
  expect(coast.warnings.map(warning=>warning.code)).toContain('land-islands-detected');
 });
});

describe('settings change the geometry in the ways they claim to',()=>{
 it('road detail changes which classes are engraved',()=>{
  const capture=fixtureCapture(GOLDEN_FIXTURES.city(),{detail:'high'});
  const low=buildFeatureGeometry({revision:1,capture,settings:settings({detail:'low'})});
  const high=buildFeatureGeometry({revision:1,capture,settings:settings({detail:'high'})});
  expect(low.metrics.roads.roadsOutsideDetail).toBeGreaterThan(0);
  expect(high.metrics.roads.roadsOutsideDetail).toBe(0);
  expect(low.metrics.roads.areaMm2).toBeLessThan(high.metrics.roads.areaMm2);
 });

 it('width scale changes engraved area without changing which roads are there',()=>{
  const capture=fixtureCapture(GOLDEN_FIXTURES.rural(),{detail:'high'});
  const thin=buildFeatureGeometry({revision:1,capture,settings:settings({widthScale:.5})});
  const thick=buildFeatureGeometry({revision:1,capture,settings:settings({widthScale:2})});
  expect(thick.metrics.roads.areaMm2).toBeGreaterThan(thin.metrics.roads.areaMm2);
  expect(thick.metrics.roads.clippedPieces).toBe(thin.metrics.roads.clippedPieces);
 });

 it('echoes the revision it was given, so a stale result can be recognised',()=>{
  const capture=fixtureCapture(GOLDEN_FIXTURES.rural());
  expect(buildFeatureGeometry({revision:97,capture,settings:settings()}).revision).toBe(97);
 });
});

describe('island policies on real geometry',()=>{
 const capture=fixtureCapture(lakeCapture(),{detail:'high'});
 const withPolicy=(islandPolicy:LandIslandPolicy,minIslandAreaMm2=4)=>buildFeatureGeometry({
  revision:1,
  capture,
  settings:settings({buildMode:'water-cutout-3-piece',land:{islandPolicy,minIslandAreaMm2,bridgeWidthMm:1.5,structuralRingWidthMm:0}}),
 });

 it('detects the lake islands as loose land',()=>{
  const keep=withPolicy('keep-separate');
  expect(keep.islands.detected.length).toBeGreaterThanOrEqual(2);
  expect(keep.islands.remaining.length).toBe(keep.islands.detected.length);
 });

 it('bridging leaves fewer loose pieces than keeping them',()=>{
  const keep=withPolicy('keep-separate'),bridged=withPolicy('bridge');
  expect(bridged.islands.remaining.length).toBeLessThan(keep.islands.remaining.length);
  expect(bridged.warnings.map(warning=>warning.code)).toContain('land-islands-bridged');
 });

 it('omitting removes area and says how much',()=>{
  const keep=withPolicy('keep-separate'),omitted=withPolicy('omit-below-threshold',1e6);
  expect(multiPolygonArea(omitted.landCut)).toBeLessThan(multiPolygonArea(keep.landCut));
  expect(omitted.warnings.map(warning=>warning.code)).toContain('land-islands-omitted');
  expect(omitted.warnings.find(warning=>warning.code==='land-islands-omitted')?.message).toMatch(/mm²/);
 });

 it('warns about the islands it found whichever policy is chosen',()=>{
  for(const policy of ['keep-separate','bridge','omit-below-threshold'] as LandIslandPolicy[])
   expect(withPolicy(policy).warnings.map(warning=>warning.code)).toContain('land-islands-detected');
 });
});

describe('empty and hostile captures',()=>{
 it('builds nothing from nothing rather than throwing',()=>{
  const result=buildFeatureGeometry({revision:1,capture:fixtureCapture([]),settings:settings()});
  expect(result.roadsEngrave).toHaveLength(0);
  expect(result.waterEngrave).toHaveLength(0);
  expect(result.warnings).toHaveLength(0);
 });

 it('says so when every road fell outside the framing',()=>{
  const away=fixtureCapture(coastCapture(),{center:[10,10]});
  const result=buildFeatureGeometry({revision:1,capture:away,settings:settings()});
  expect(result.roadsEngrave).toHaveLength(0);
  expect(result.warnings.map(warning=>warning.code)).toContain('roads-empty');
 });
});
