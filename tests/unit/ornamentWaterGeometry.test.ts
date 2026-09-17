import {describe,expect,it} from 'vitest';
import {multiPolygonArea,polygonArea,signedArea,type MultiPolygonMm,type RingMm} from '../../src/geometry/shoreline/polygonEngine';
import {
 buildLandPiece,
 buildWaterRegion,
 innerDisk,
 structuralRing,
 type ProjectedWater,
} from '../../src/ornament/geometry/waterGeometry';

// "Water polygons preserve islands/holes through clip, union, and difference" — the acceptance-suite
// item this file exists for. Each of the three verbs gets its own test, because each loses holes in
// a different way and a test that only looked at the final outline would pass while the island was
// quietly gone.

const INNER_RADIUS=44.8;
// The ornament's own disk is flattened with the shared arc tolerance, not with a test's segment
// count, so its area is measured rather than assumed.

const square=(cx:number,cy:number,half:number):RingMm=>[
 [cx-half,cy-half],[cx+half,cy-half],[cx+half,cy+half],[cx-half,cy+half],[cx-half,cy-half],
];

const ring=(cx:number,cy:number,radius:number,segments=64):RingMm=>{
 const out:RingMm=[];
 for(let i=0;i<segments;i++){const t=2*Math.PI*i/segments;out.push([cx+radius*Math.cos(t),cy+radius*Math.sin(t)])}
 out.push([out[0][0],out[0][1]]);
 return out;
};

const water=(rings:RingMm[]):ProjectedWater=>({rings});

// Areas here are compared against the area of the *polygon* a test built, not against the circle it
// approximates: a 64-segment ring is roughly 0.16% smaller than πr², and a test that ignored that
// would be asserting how finely its own fixture was sampled rather than whether an island survived.
const ringArea=(radius:number,segments=64)=>segments/2*radius*radius*Math.sin(2*Math.PI/segments);
const closeTo=(actual:number,expected:number,relative=1e-9)=>expect(Math.abs(actual-expected)/expected).toBeLessThan(relative);

const diskArea=multiPolygonArea(innerDisk(INNER_RADIUS));
const holeCount=(geometry:MultiPolygonMm)=>geometry.reduce((sum,polygon)=>sum+polygon.length-1,0);
const allPoints=(geometry:MultiPolygonMm)=>geometry.flat().flat();

describe('holes survive the pipeline',()=>{
 // A lake with one island, entirely inside the disk: no clipping involved, so this isolates
 // normalisation and union.
 it('through union',()=>{
  const lake=water([ring(0,0,25),ring(0,0,8)]);
  const result=buildWaterRegion([lake],{innerRadiusMm:INNER_RADIUS});
  expect(result.geometry).toHaveLength(1);
  expect(holeCount(result.geometry)).toBe(1);
  expect(result.metrics.holes).toBe(1);
  // Area is the annulus, not the disc: an island that was lost would show up here even if the
  // ring count somehow looked right.
  closeTo(result.metrics.areaMm2,ringArea(25)-ringArea(8),1e-6);
 });

 it('through union of two overlapping lakes, each with its own island',()=>{
  const result=buildWaterRegion([
   water([ring(-10,0,20),ring(-16,0,5)]),
   water([ring(10,0,20),ring(16,0,5)]),
  ],{innerRadiusMm:INNER_RADIUS});
  expect(result.geometry).toHaveLength(1);
  expect(holeCount(result.geometry)).toBe(2);
 });

 it('through clipping to the inner disk',()=>{
  // A lake far larger than the ornament, with an island near the centre. The outline is cut by the
  // disk; the island is not, and must still be there.
  const result=buildWaterRegion([water([square(0,0,400),ring(6,-6,7)])],{innerRadiusMm:INNER_RADIUS});
  expect(holeCount(result.geometry)).toBe(1);
  closeTo(result.metrics.areaMm2,diskArea-ringArea(7),1e-3);
 });

 it('through the difference that makes the land piece',()=>{
  const region=buildWaterRegion([water([ring(0,0,25),ring(0,0,8)])],{innerRadiusMm:INNER_RADIUS});
  const piece=buildLandPiece(region.geometry,{innerRadiusMm:INNER_RADIUS,structuralRingWidthMm:0});
  // The land is the disk minus the annulus: a ring of mainland plus the island, as two components.
  expect(piece.land).toHaveLength(2);
  const areas=piece.land.map(polygonArea).sort((a,b)=>a-b);
  closeTo(areas[0],ringArea(8),1e-6);
  closeTo(areas[1],diskArea-ringArea(25),1e-3);
 });

 it('keeps land and water an exact partition of the disk',()=>{
  const region=buildWaterRegion([water([ring(-8,4,22),ring(-8,4,6)])],{innerRadiusMm:INNER_RADIUS});
  const piece=buildLandPiece(region.geometry,{innerRadiusMm:INNER_RADIUS,structuralRingWidthMm:2});
  const disk=multiPolygonArea(innerDisk(INNER_RADIUS));
  expect(multiPolygonArea(piece.land)+multiPolygonArea(piece.waterCut)).toBeCloseTo(disk,3);
 });
});

describe('degenerate input',()=>{
 it('drops a ring that cannot be cleaned and says so, keeping the polygon',()=>{
  const result=buildWaterRegion([water([ring(0,0,20),[[1,1],[1,1],[1,1],[1,1]]])],{innerRadiusMm:INNER_RADIUS});
  expect(result.metrics.rejectedRings).toBe(1);
  expect(result.geometry).toHaveLength(1);
  expect(holeCount(result.geometry)).toBe(0);
 });

 it('drops a polygon whose outer ring is unusable rather than emitting an empty one',()=>{
  const result=buildWaterRegion([water([[[0,0],[Number.NaN,1],[2,2],[0,0]]])],{innerRadiusMm:INNER_RADIUS});
  expect(result.geometry).toHaveLength(0);
  expect(result.metrics.rejectedRings).toBe(1);
 });

 it('produces no non-finite coordinates from non-finite input',()=>{
  const result=buildWaterRegion([
   water([ring(0,0,20)]),
   water([[[0,0],[Number.POSITIVE_INFINITY,0],[1,1],[0,0]]]),
  ],{innerRadiusMm:INNER_RADIUS});
  for(const point of allPoints(result.geometry)){
   expect(Number.isFinite(point[0])).toBe(true);
   expect(Number.isFinite(point[1])).toBe(true);
  }
 });

 it('winds outer rings positive and holes negative',()=>{
  const result=buildWaterRegion([water([ring(0,0,25),ring(0,0,8)])],{innerRadiusMm:INNER_RADIUS});
  for(const polygon of result.geometry){
   expect(signedArea(polygon[0])).toBeGreaterThan(0);
   for(const hole of polygon.slice(1))expect(signedArea(hole)).toBeLessThan(0);
  }
 });

 it('is unaffected by the winding it was handed',()=>{
  const forward=buildWaterRegion([water([ring(0,0,25),ring(0,0,8)])],{innerRadiusMm:INNER_RADIUS});
  const reversedOuter=[...ring(0,0,25).slice(0,-1)].reverse();
  const backward=buildWaterRegion([water([[...reversedOuter,reversedOuter[0]],ring(0,0,8)])],{innerRadiusMm:INNER_RADIUS});
  expect(backward.metrics.areaMm2).toBeCloseTo(forward.metrics.areaMm2,6);
  expect(backward.metrics.holes).toBe(1);
 });
});

describe('minimum sizes',()=>{
 it('fills an island too small to cut, and reports it as a filled hole',()=>{
  const result=buildWaterRegion([water([ring(0,0,25),ring(10,0,.05)])],{innerRadiusMm:INNER_RADIUS});
  expect(result.metrics.filledHoles).toBe(1);
  expect(result.metrics.holes).toBe(0);
 });

 it('keeps an island comfortably above the threshold',()=>{
  const result=buildWaterRegion([water([ring(0,0,25),ring(10,0,2)])],{innerRadiusMm:INNER_RADIUS});
  expect(result.metrics.filledHoles).toBe(0);
  expect(result.metrics.holes).toBe(1);
 });

 it('drops a water component too small to matter',()=>{
  const result=buildWaterRegion([water([ring(0,0,25)]),water([ring(35,0,.05)])],{innerRadiusMm:INNER_RADIUS});
  expect(result.metrics.droppedComponents).toBeGreaterThanOrEqual(1);
  expect(result.geometry).toHaveLength(1);
 });
});

describe('structural outer ring',()=>{
 it('is an annulus of the requested width',()=>{
  const annulus=structuralRing(INNER_RADIUS,3);
  const expected=Math.PI*(INNER_RADIUS*INNER_RADIUS-(INNER_RADIUS-3)*(INNER_RADIUS-3));
  expect(multiPolygonArea(annulus)).toBeCloseTo(expected,0);
 });

 it('is empty when it has no width, so the option is genuinely off',()=>{
  expect(structuralRing(INNER_RADIUS,0)).toHaveLength(0);
 });

 it('becomes the whole disk rather than inverting when it is wider than the radius',()=>{
  closeTo(multiPolygonArea(structuralRing(INNER_RADIUS,100)),diskArea,1e-9);
 });

 // The plan's reason for it: "Add the structural outer ring back to the land piece so islands and
 // coastal fragments remain registered and connected where possible."
 it('reconnects a coastline that would otherwise split the disk in two',()=>{
  const sea=water([[[-200,5],[200,5],[200,200],[-200,200],[-200,5]]]);
  const region=buildWaterRegion([sea],{innerRadiusMm:INNER_RADIUS});
  const without=buildLandPiece(region.geometry,{innerRadiusMm:INNER_RADIUS,structuralRingWidthMm:0});
  const withRing=buildLandPiece(region.geometry,{innerRadiusMm:INNER_RADIUS,structuralRingWidthMm:2});
  expect(without.land).toHaveLength(1);
  expect(withRing.land).toHaveLength(1);
  // With the ring, the land reaches all the way round; without it, it is only the northern cap.
  expect(multiPolygonArea(withRing.land)).toBeGreaterThan(multiPolygonArea(without.land));
 });

 it('holds an offshore island in place once the ring reaches it',()=>{
  // The island sits well inside the disk so this test is about the ring reconnecting it, not about
  // what happens to a feature the disk itself cuts through.
  const sea=water([[[-200,5],[200,5],[200,200],[-200,200],[-200,5]],ring(0,25,6)]);
  const region=buildWaterRegion([sea],{innerRadiusMm:INNER_RADIUS});
  const loose=buildLandPiece(region.geometry,{innerRadiusMm:INNER_RADIUS,structuralRingWidthMm:0});
  const held=buildLandPiece(region.geometry,{innerRadiusMm:INNER_RADIUS,structuralRingWidthMm:26});
  expect(loose.land.length).toBe(2);
  expect(held.land.length).toBe(1);
 });
});

describe('determinism',()=>{
 it('gives byte-identical output for the same input',()=>{
  const input=[water([ring(0,0,25),ring(6,6,5)]),water([ring(-20,10,9)])];
  const first=buildWaterRegion(input,{innerRadiusMm:INNER_RADIUS});
  const second=buildWaterRegion(input,{innerRadiusMm:INNER_RADIUS});
  expect(JSON.stringify(first.geometry)).toBe(JSON.stringify(second.geometry));
 });
});
