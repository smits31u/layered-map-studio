import {describe,expect,it} from 'vitest';
import {multiPolygonArea,type MultiPolygonMm,type RingMm} from '../../src/geometry/shoreline/polygonEngine';
import {
 analyseLandIslands,
 applyIslandPolicy,
 bridgeTab,
 LAND_ISLAND_POLICIES,
 nearestPair,
 totalIslandAreaMm2,
} from '../../src/ornament/geometry/landIslands';

// The plan calls this out as a fabrication defect rather than a cosmetic one: "Detect and warn about
// loose land islands that would fall out after cutting. Offer three explicit policies: keep as
// separate pieces, bridge automatically using user-visible tabs, or omit below a size threshold.
// Default to warning, never silently discard meaningful islands."
//
// The last clause is the one most of these tests are about. Every policy — including the two that
// change the geometry — has to report everything it found.

const square=(cx:number,cy:number,half:number):RingMm=>[
 [cx-half,cy-half],[cx+half,cy-half],[cx+half,cy+half],[cx-half,cy+half],[cx-half,cy-half],
];

const mainland:MultiPolygonMm=[[square(0,0,20)]];
const bigIsland:MultiPolygonMm=[[square(30,0,4)]];     // 64mm², well above the default threshold
const smallIsland:MultiPolygonMm=[[square(-30,0,.8)]]; // 2.56mm², below it
const farIsland:MultiPolygonMm=[[square(0,80,3)]];     // 54mm² but 57mm away

const scene=(...parts:MultiPolygonMm[]):MultiPolygonMm=>parts.flat();

const options={policy:'keep-separate' as const,minIslandAreaMm2:4,bridgeWidthMm:1.5};

describe('detection',()=>{
 it('finds nothing on a single connected piece',()=>{
  const analysis=analyseLandIslands(mainland);
  expect(analysis.islands).toHaveLength(0);
  expect(analysis.mainIndex).toBe(0);
 });

 it('treats the largest component as the mainland, wherever it sits in the list',()=>{
  const analysis=analyseLandIslands(scene(bigIsland,mainland,smallIsland));
  expect(analysis.mainIndex).toBe(1);
  expect(analysis.islands).toHaveLength(2);
 });

 it('measures each island by area and by extent',()=>{
  const analysis=analyseLandIslands(scene(mainland,bigIsland));
  expect(analysis.islands[0].areaMm2).toBeCloseTo(64,6);
  expect(analysis.islands[0].extentMm).toBeCloseTo(8,6);
  expect(analysis.islands[0].centroidMm[0]).toBeCloseTo(30,6);
 });

 it('handles empty geometry without inventing a mainland',()=>{
  expect(analyseLandIslands([]).mainIndex).toBe(-1);
 });
});

describe('every policy reports what it found',()=>{
 // This is the "never silently discard" requirement made testable: whatever the policy, `detected`
 // is the complete list.
 it.each(LAND_ISLAND_POLICIES)('%s reports all three islands',policy=>{
  const result=applyIslandPolicy(scene(mainland,bigIsland,smallIsland,farIsland),{...options,policy});
  expect(result.detected).toHaveLength(3);
  expect(totalIslandAreaMm2(result.detected)).toBeGreaterThan(0);
 });
});

describe('keep as separate pieces',()=>{
 const result=applyIslandPolicy(scene(mainland,bigIsland,smallIsland),{...options,policy:'keep-separate'});

 it('changes nothing about the geometry',()=>{
  expect(result.geometry).toHaveLength(3);
  expect(multiPolygonArea(result.geometry)).toBeCloseTo(multiPolygonArea(scene(mainland,bigIsland,smallIsland)),6);
 });

 it('leaves both islands loose, and says so',()=>{
  expect(result.remaining).toHaveLength(2);
  expect(result.omitted).toHaveLength(0);
  expect(result.bridges).toHaveLength(0);
 });
});

describe('omit below threshold',()=>{
 const result=applyIslandPolicy(scene(mainland,bigIsland,smallIsland),{...options,policy:'omit-below-threshold'});

 it('removes only what is under the threshold',()=>{
  expect(result.omitted).toHaveLength(1);
  expect(result.omitted[0].areaMm2).toBeCloseTo(2.56,6);
  expect(result.geometry).toHaveLength(2);
 });

 it('reports the size of what it removed, not just the count',()=>{
  expect(result.omitted[0].areaMm2).toBeGreaterThan(0);
  expect(result.omitted[0].extentMm).toBeGreaterThan(0);
 });

 it('still reports the island it kept as loose',()=>{
  expect(result.remaining).toHaveLength(1);
  expect(result.remaining[0].areaMm2).toBeCloseTo(64,6);
 });

 it('keeps everything when the threshold is zero',()=>{
  const kept=applyIslandPolicy(scene(mainland,bigIsland,smallIsland),{...options,policy:'omit-below-threshold',minIslandAreaMm2:0});
  expect(kept.omitted).toHaveLength(0);
  expect(kept.geometry).toHaveLength(3);
 });

 it('never removes the mainland, however large the threshold',()=>{
  const kept=applyIslandPolicy(scene(mainland,bigIsland),{...options,policy:'omit-below-threshold',minIslandAreaMm2:1e6});
  expect(kept.geometry).toHaveLength(1);
  expect(multiPolygonArea(kept.geometry)).toBeCloseTo(1600,6);
 });
});

describe('bridge with tabs',()=>{
 const result=applyIslandPolicy(scene(mainland,bigIsland),{...options,policy:'bridge'});

 it('joins the island to the mainland, leaving one piece',()=>{
  expect(result.geometry).toHaveLength(1);
  expect(result.remaining).toHaveLength(0);
 });

 it('adds material rather than moving anything',()=>{
  expect(multiPolygonArea(result.geometry)).toBeGreaterThan(multiPolygonArea(scene(mainland,bigIsland)));
 });

 it('reports the tab it added, so it is user-visible rather than a surprise',()=>{
  expect(result.bridges).toHaveLength(1);
  expect(result.bridges[0].widthMm).toBe(1.5);
  expect(result.bridges[0].lengthMm).toBeCloseTo(6,6);
  expect(result.bridges[0].from[0]).toBeCloseTo(26,6);
  expect(result.bridges[0].to[0]).toBeCloseTo(20,6);
 });

 it('bridges several islands independently',()=>{
  const many=applyIslandPolicy(scene(mainland,bigIsland,smallIsland),{...options,policy:'bridge'});
  expect(many.bridges).toHaveLength(2);
  expect(many.geometry).toHaveLength(1);
 });

 // "where possible" in the plan is load-bearing: a tab across half the ornament is a new design
 // decision, not a fix, so the island is reported rather than strutted.
 it('refuses a tab longer than the maximum and reports the island as unbridged',()=>{
  const far=applyIslandPolicy(scene(mainland,farIsland),{...options,policy:'bridge',maxBridgeLengthMm:12});
  expect(far.bridges).toHaveLength(0);
  expect(far.unbridged).toHaveLength(1);
  expect(far.remaining).toHaveLength(1);
 });

 it('bridges the same island in the same place every time',()=>{
  const again=applyIslandPolicy(scene(mainland,bigIsland),{...options,policy:'bridge'});
  expect(JSON.stringify(again.bridges)).toBe(JSON.stringify(result.bridges));
  expect(JSON.stringify(again.geometry)).toBe(JSON.stringify(result.geometry));
 });
});

describe('tab geometry',()=>{
 it('is a capsule exactly as long as the gap, with butt ends so it does not spill into the water',()=>{
  const tab=bridgeTab([0,0],[10,0],2);
  const points=tab.flat().flat();
  expect(Math.min(...points.map(point=>point[0]))).toBeCloseTo(0,3);
  expect(Math.max(...points.map(point=>point[0]))).toBeCloseTo(10,3);
  expect(Math.max(...points.map(point=>point[1]))).toBeCloseTo(1,3);
  expect(multiPolygonArea(tab)).toBeCloseTo(20,2);
 });

 it('is empty for a zero-length gap, because touching pieces need no tab',()=>{
  expect(bridgeTab([5,5],[5,5],2)).toHaveLength(0);
 });

 it('is empty for a zero width',()=>{
  expect(bridgeTab([0,0],[10,0],0)).toHaveLength(0);
 });
});

describe('nearest pair',()=>{
 it('finds the closest vertices between two rings',()=>{
  const pair=nearestPair(square(0,0,5),square(20,0,5));
  expect(pair?.lengthMm).toBeCloseTo(10,6);
  expect(pair?.from[0]).toBeCloseTo(5,6);
  expect(pair?.to[0]).toBeCloseTo(15,6);
 });

 it('is deterministic on a dense ring, because it samples by stride rather than at random',()=>{
  const dense:RingMm=[];
  for(let i=0;i<4000;i++){const t=2*Math.PI*i/4000;dense.push([30+8*Math.cos(t),8*Math.sin(t)])}
  dense.push([dense[0][0],dense[0][1]]);
  const first=nearestPair(dense,square(0,0,5));
  const second=nearestPair(dense,square(0,0,5));
  expect(first).toEqual(second);
 });

 it('returns nothing for an empty ring rather than a pair of undefineds',()=>{
  expect(nearestPair([],square(0,0,5))).toBeUndefined();
 });
});
