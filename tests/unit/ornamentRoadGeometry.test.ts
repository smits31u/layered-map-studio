import {describe,expect,it} from 'vitest';
import {signedArea,type MultiPolygonMm} from '../../src/geometry/shoreline/polygonEngine';
import type {MapWindow} from '../../src/ornament/geometry/clipLine';
import {buildRoadEngraving,type ProjectedRoad} from '../../src/ornament/geometry/roadGeometry';
import {
 diameterWidthFactor,
 MIN_ENGRAVABLE_WIDTH_MM,
 quantiseWidthMm,
 REFERENCE_DIAMETER_MM,
 roadClassesForDetailSet,
 roadWidthMm,
 ROAD_WIDTH_TABLE_MM,
 UNKNOWN_ROAD_WIDTH_MM,
} from '../../src/ornament/geometry/roadWidths';

// The acceptance suite item, verbatim: "Road buffers have round ends, valid winding, and no
// NaN/Infinity." Plus the plan's prohibition — fabrication widths come from a physical table, never
// from the style's pixel widths.

const WINDOW:MapWindow={innerRadiusMm:44.8,chordYMm:14};
const WIDTHS={diameterMm:REFERENCE_DIAMETER_MM,widthScale:1};

const build=(roads:ProjectedRoad[],over:Partial<Parameters<typeof buildRoadEngraving>[1]>={})=>
 buildRoadEngraving(roads,{detail:'high',widths:WIDTHS,window:WINDOW,...over});

const distanceToSegment=(p:[number,number],a:[number,number],b:[number,number])=>{
 const dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy;
 const t=length?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length)):0;
 return Math.hypot(p[0]-(a[0]+t*dx),p[1]-(a[1]+t*dy));
};

const everyPoint=(geometry:MultiPolygonMm)=>geometry.flat().flat();

describe('physical width table',()=>{
 // "Avoid using map style pixel widths as fabrication widths." The style's widths interpolate over
 // zoom; these do not depend on zoom at all, which is the observable difference.
 it('depends on road class and ornament size, and on nothing else',()=>{
  expect(roadWidthMm('motorway',WIDTHS)).toBeGreaterThan(roadWidthMm('primary',WIDTHS));
  expect(roadWidthMm('primary',WIDTHS)).toBeGreaterThan(roadWidthMm('minor',WIDTHS));
  expect(roadWidthMm('minor',WIDTHS)).toBeGreaterThan(roadWidthMm('path',WIDTHS));
 });

 it('reproduces the table exactly at the reference diameter',()=>{
  for(const [roadClass,width] of Object.entries(ROAD_WIDTH_TABLE_MM))
   expect(roadWidthMm(roadClass,WIDTHS)).toBeCloseTo(width,10);
 });

 it('falls back to the thinnest tier for a class the provider invents',()=>{
  expect(roadWidthMm('hyperloop',WIDTHS)).toBeCloseTo(UNKNOWN_ROAD_WIDTH_MM,10);
 });

 // "scaled modestly with diameter"
 it('grows sub-linearly with diameter',()=>{
  const small=roadWidthMm('primary',{diameterMm:50.8,widthScale:1});
  const reference=roadWidthMm('primary',WIDTHS);
  const large=roadWidthMm('primary',{diameterMm:203.2,widthScale:1});
  expect(small).toBeLessThan(reference);
  expect(large).toBeGreaterThan(reference);
  expect(large/reference).toBeLessThan(2);
 });

 it('clamps the diameter factor at both ends of the supported range',()=>{
  expect(diameterWidthFactor(25)).toBeGreaterThanOrEqual(.6);
  expect(diameterWidthFactor(300)).toBeLessThanOrEqual(2);
  expect(diameterWidthFactor(Number.NaN)).toBeGreaterThan(0);
 });

 // "bounded by a minimum engravable width"
 it('never returns a width below the engravable floor, whatever the user asks for',()=>{
  for(const roadClass of Object.keys(ROAD_WIDTH_TABLE_MM))
   expect(roadWidthMm(roadClass,{diameterMm:25,widthScale:.25})).toBeGreaterThanOrEqual(MIN_ENGRAVABLE_WIDTH_MM);
 });

 it('applies the user scale on top',()=>{
  expect(roadWidthMm('motorway',{...WIDTHS,widthScale:2})).toBeCloseTo(ROAD_WIDTH_TABLE_MM.motorway*2,10);
 });

 it('ignores a nonsensical scale rather than producing a zero-width road',()=>{
  expect(roadWidthMm('motorway',{...WIDTHS,widthScale:0})).toBeCloseTo(ROAD_WIDTH_TABLE_MM.motorway,10);
  expect(roadWidthMm('motorway',{...WIDTHS,widthScale:Number.NaN})).toBeCloseTo(ROAD_WIDTH_TABLE_MM.motorway,10);
 });

 it('quantises so classes sharing a width share one offset pass',()=>{
  expect(quantiseWidthMm(roadWidthMm('minor',WIDTHS))).toBe(quantiseWidthMm(roadWidthMm('residential',WIDTHS)));
 });
});

describe('detail policy',()=>{
 // The plan's suggested policy, which Phase 2 encoded in the provider adapter.
 it('is cumulative: Low ⊂ Medium ⊂ High',()=>{
  const low=roadClassesForDetailSet('low'),medium=roadClassesForDetailSet('medium'),high=roadClassesForDetailSet('high');
  for(const value of low)expect(medium.has(value)).toBe(true);
  for(const value of medium)expect(high.has(value)).toBe(true);
  expect(low.has('motorway')).toBe(true);
  expect(low.has('tertiary')).toBe(false);
  expect(medium.has('tertiary')).toBe(true);
  expect(medium.has('service')).toBe(false);
  expect(high.has('service')).toBe(true);
  expect(high.has('path')).toBe(true);
 });

 it('drops and counts roads outside the current detail level',()=>{
  const result=build([
   {roadClass:'primary',line:[[-20,0],[20,0]]},
   {roadClass:'service',line:[[-20,5],[20,5]]},
  ],{detail:'low'});
  expect(result.metrics.roadsOutsideDetail).toBe(1);
  expect(result.metrics.widthsMm).toHaveLength(1);
 });
});

describe('road buffers',()=>{
 const a:[number,number]=[-20,-5],b:[number,number]=[20,-5];
 const result=build([{roadClass:'primary',line:[a,b]}]);
 const half=ROAD_WIDTH_TABLE_MM.primary/2;

 it('produces exactly one component for one road',()=>{
  expect(result.geometry).toHaveLength(1);
 });

 // "Road buffers have round ends". A butt or square cap would stop at x = ±20; a round one reaches
 // half a width past the end, and does so through an arc rather than a corner.
 it('has round ends rather than flat or square ones',()=>{
  const points=everyPoint(result.geometry);
  const maxX=Math.max(...points.map(point=>point[0]));
  expect(maxX).toBeGreaterThan(b[0]+half*.95);
  expect(maxX).toBeLessThanOrEqual(b[0]+half+1e-6);
  // Beyond the segment end, every vertex sits on the cap arc: at (half) from the endpoint.
  const capPoints=points.filter(point=>point[0]>b[0]+1e-9);
  expect(capPoints.length).toBeGreaterThan(4);
  for(const point of capPoints)expect(Math.hypot(point[0]-b[0],point[1]-b[1])).toBeCloseTo(half,2);
 });

 it('keeps every vertex on the offset boundary, so the stroke is the width the table asked for',()=>{
  for(const point of everyPoint(result.geometry))
   expect(distanceToSegment(point,a,b)).toBeCloseTo(half,2);
 });

 // A round cap is a polygon inscribed in its arc, so it can never quite reach the ideal capsule —
 // and must never exceed it. Asserting the band rather than an exact figure keeps this about the cap
 // being round, rather than about how many segments the current arc tolerance happens to produce.
 it('has the area of a capsule',()=>{
  const ideal=Math.hypot(b[0]-a[0],b[1]-a[1])*half*2+Math.PI*half*half;
  expect(result.metrics.areaMm2).toBeLessThanOrEqual(ideal);
  expect(result.metrics.areaMm2/ideal).toBeGreaterThan(.999);
 });

 // "valid winding"
 it('winds outer rings positive and holes negative',()=>{
  // Roads are open centrelines, so a "closed" loop has to overrun its own start for the buffer to
  // meet itself — which is what a real ring road does, and what leaves a hole once buffered.
  const ring=[[-30,-20],[30,-20],[30,10],[-30,10],[-30,-25]] as [number,number][];
  const inner=[[-20,-12],[20,-12],[20,2],[-20,2],[-20,-16]] as [number,number][];
  const loop=build([{roadClass:'motorway',line:ring},{roadClass:'motorway',line:inner}]);
  const withHole=loop.geometry.find(polygon=>polygon.length>1);
  expect(withHole).toBeDefined();
  expect(signedArea(withHole![0])).toBeGreaterThan(0);
  for(const hole of withHole!.slice(1))expect(signedArea(hole)).toBeLessThan(0);
  for(const polygon of loop.geometry)expect(signedArea(polygon[0])).toBeGreaterThan(0);
 });

 // "no NaN/Infinity"
 it('produces only finite coordinates, even from an input full of them',()=>{
  const messy=build([
   {roadClass:'primary',line:[[-20,0],[Number.NaN,0],[20,0]]},
   {roadClass:'minor',line:[[0,0],[0,0]]},
   {roadClass:'minor',line:[[5,5],[Number.POSITIVE_INFINITY,5]]},
  ]);
  for(const point of everyPoint(messy.geometry)){
   expect(Number.isFinite(point[0])).toBe(true);
   expect(Number.isFinite(point[1])).toBe(true);
  }
 });

 it('closes every ring',()=>{
  for(const polygon of result.geometry)for(const ring of polygon){
   expect(ring.length).toBeGreaterThanOrEqual(4);
   expect(ring[0]).toEqual(ring[ring.length-1]);
  }
 });
});

describe('clipping',()=>{
 // Phase 1's clipper, reused unchanged on captured features.
 it('keeps engraving inside the inner disk',()=>{
  const result=build([{roadClass:'motorway',line:[[-500,0],[500,0]]}]);
  for(const point of everyPoint(result.geometry))
   expect(Math.hypot(point[0],point[1])).toBeLessThanOrEqual(WINDOW.innerRadiusMm+ROAD_WIDTH_TABLE_MM.motorway);
 });

 // "Also clip roads to the region above the map/text chord so engraving cannot collide with
 // personalized text."
 it('keeps engraving above the text chord',()=>{
  const result=build([{roadClass:'motorway',line:[[0,-40],[0,40]]}]);
  const maxY=Math.max(...everyPoint(result.geometry).map(point=>point[1]));
  expect(maxY).toBeLessThanOrEqual(WINDOW.chordYMm+ROAD_WIDTH_TABLE_MM.motorway);
 });

 it('returns nothing for a road entirely outside the window',()=>{
  const result=build([{roadClass:'motorway',line:[[200,200],[300,300]]}]);
  expect(result.geometry).toHaveLength(0);
  expect(result.metrics.clippedPieces).toBe(0);
 });

 it('splits a road that leaves and re-enters into separate pieces, with a cap on each',()=>{
  // Enters the disk, exits through the chord, comes back above it.
  const result=build([{roadClass:'motorway',line:[[-40,0],[-10,0],[-10,30],[10,30],[10,0],[40,0]]}]);
  expect(result.metrics.clippedPieces).toBeGreaterThanOrEqual(2);
 });
});

describe('tiny islands',()=>{
 it('removes and reports fragments below the minimum engravable size',()=>{
  const result=build([
   {roadClass:'primary',line:[[-20,0],[20,0]]},
   // A hair inside the disk boundary: clipped to almost nothing.
   {roadClass:'path',line:[[0,-44.795],[.02,-44.7955]]},
  ],{minIslandAreaMm2:1});
  expect(result.metrics.droppedIslands).toBeGreaterThanOrEqual(1);
 });
});

describe('determinism',()=>{
 it('gives byte-identical output for the same input',()=>{
  const roads:ProjectedRoad[]=[
   {roadClass:'primary',line:[[-30,-10],[30,-8]]},
   {roadClass:'minor',line:[[-10,-30],[-8,10]]},
   {roadClass:'service',line:[[5,5],[25,-15]]},
  ];
  expect(JSON.stringify(build(roads).geometry)).toBe(JSON.stringify(build(roads).geometry));
 });

 it('does not depend on the order roads arrive in for the geometry it produces',()=>{
  const roads:ProjectedRoad[]=[
   {roadClass:'primary',line:[[-30,-10],[30,-8]]},
   {roadClass:'primary',line:[[-10,-30],[-8,10]]},
  ];
  const forward=build(roads).metrics.areaMm2;
  const backward=build([...roads].reverse()).metrics.areaMm2;
  expect(forward).toBeCloseTo(backward,6);
 });
});
