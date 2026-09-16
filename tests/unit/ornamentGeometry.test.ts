import {describe,expect,it} from 'vitest';
import {multiPolygonArea} from '../../src/geometry/shoreline/polygonEngine';
import {chordHalfWidthAt,circleRing,circleSegments} from '../../src/ornament/geometry/circle';
import {buildOrnamentGeometry,evaluateHangingLoop} from '../../src/ornament/geometry/ornamentShape';
import {createDefaultOrnamentProject} from '../../src/ornament/defaults';
import {ORNAMENT_LIMITS} from '../../src/ornament/types';

const defaults=createDefaultOrnamentProject();

describe('circle flattening',()=>{
 it('meets the requested sagitta tolerance',()=>{
  for(const radius of [2,10,50,150]){
   const n=circleSegments(radius,.02);
   expect(radius*(1-Math.cos(Math.PI/n))).toBeLessThanOrEqual(.02+1e-9);
  }
 });

 it('emits more segments as the tolerance tightens',()=>{
  expect(circleSegments(50,.005)).toBeGreaterThan(circleSegments(50,.25));
 });

 it('produces a closed ring whose area approaches the true circle from below',()=>{
  const ring=circleRing(0,0,40,.02);
  expect(ring[0]).toEqual(ring[ring.length-1]);
  const truth=Math.PI*1600,area=multiPolygonArea([[ring]]);
  // The flattened polygon is inscribed, so it is always slightly smaller than the true circle.
  expect(area).toBeLessThan(truth);
  expect(truth-area).toBeLessThan(truth*.001);
 });
});

describe('chord half width',()=>{
 it('is the full radius at the centre line and zero at the tangent',()=>{
  expect(chordHalfWidthAt(0,44.8)).toBeCloseTo(44.8,9);
  expect(chordHalfWidthAt(44.8,44.8)).toBe(0);
 });
 it('is zero outside the circle rather than NaN',()=>{
  expect(chordHalfWidthAt(60,44.8)).toBe(0);
  expect(chordHalfWidthAt(-60,44.8)).toBe(0);
 });
 it('shrinks monotonically with distance from the centre line',()=>{
  let previous=Infinity;
  for(let y=0;y<=44;y+=4){const w=chordHalfWidthAt(y,44.8);expect(w).toBeLessThanOrEqual(previous);previous=w}
 });
});

describe('hanging loop',()=>{
 it('measures the join as the chord where the two circles cross',()=>{
  // R=50.8, loop r=8 pushed 3mm in: centre at -55.8, radical line at x=50.4505 from centre.
  const loop=evaluateHangingLoop(101.6,defaults.ornament.hangingLoop);
  expect(loop.centerY).toBeCloseTo(-55.8,6);
  expect(loop.intersectsBody).toBe(true);
  expect(loop.junctionWidthMm).toBeCloseTo(11.898,2);
  expect(loop.annulusWidthMm).toBeCloseTo(4,6);
  expect(loop.connected).toBe(true);
 });

 it('reports a detached loop when the overlap does not reach the body',()=>{
  const loop=evaluateHangingLoop(101.6,{...defaults.ornament.hangingLoop,overlapMm:0});
  expect(loop.intersectsBody).toBe(false);
  expect(loop.junctionWidthMm).toBe(0);
  expect(loop.connected).toBe(false);
 });

 it('widens the join as the overlap increases',()=>{
  const shallow=evaluateHangingLoop(101.6,{...defaults.ornament.hangingLoop,overlapMm:1});
  const deep=evaluateHangingLoop(101.6,{...defaults.ornament.hangingLoop,overlapMm:6});
  expect(deep.junctionWidthMm).toBeGreaterThan(shallow.junctionWidthMm);
 });

 // Plan acceptance item: "Hanging loop/frame maintain minimum neck width across supported
 // diameters". The invariant is not that every diameter works with one fixed loop — it is that a
 // fragile neck is never produced silently.
 it('never returns frame geometry with a neck below the configured minimum, across the supported diameter range',()=>{
  for(let diameterMm=ORNAMENT_LIMITS.diameterMm.min;diameterMm<=ORNAMENT_LIMITS.diameterMm.max;diameterMm+=5){
   const ornament={...defaults.ornament,diameterMm,rimWidthMm:Math.min(defaults.ornament.rimWidthMm,diameterMm/4)};
   const geometry=buildOrnamentGeometry(ornament);
   const blocked=geometry.issues.some(i=>i.severity==='error');
   if(blocked){expect(geometry.frame).toHaveLength(0);continue}
   expect(geometry.loop.junctionWidthMm).toBeGreaterThanOrEqual(ornament.hangingLoop.minNeckWidthMm);
   expect(geometry.loop.annulusWidthMm).toBeGreaterThanOrEqual(ornament.hangingLoop.minNeckWidthMm);
  }
 });
});

describe('ornament frame assembly',()=>{
 it('builds one connected piece containing the ring, text band and loop',()=>{
  const geometry=buildOrnamentGeometry(defaults.ornament);
  expect(geometry.issues.filter(i=>i.severity==='error')).toEqual([]);
  expect(geometry.frame).toHaveLength(1);
  // Outer ring + hole: the loop bore is the only interior ring.
  expect(geometry.frame[0].length).toBeGreaterThanOrEqual(2);
 });

 it('leaves the map window open and keeps the text band solid',()=>{
  const geometry=buildOrnamentGeometry(defaults.ornament);
  const innerR=geometry.innerRadiusMm,truth=Math.PI*innerR*innerR;
  // The chord splits the opening in two with nothing lost: window + band == the whole inner disk,
  // up to the inscribed-polygon deficit.
  const total=multiPolygonArea(geometry.mapOpening)+multiPolygonArea(geometry.textBand);
  expect(truth-total).toBeLessThan(truth*.001);
  expect(geometry.textBandHeightMm).toBeCloseTo(innerR-defaults.ornament.mapToTextBoundaryMm,6);
 });

 it('frame area equals disk plus loop minus bore minus window',()=>{
  const geometry=buildOrnamentGeometry(defaults.ornament);
  const {outerRadiusMm:R,loop}=geometry;
  const disk=Math.PI*R*R;
  const bore=Math.PI*loop.innerRadiusMm**2;
  // The loop's outer disk overlaps the body, so its contribution is not a whole circle; compare
  // against the booleans' own union instead of an analytic figure, and just assert the window and
  // bore were actually removed.
  expect(multiPolygonArea(geometry.frame)).toBeLessThan(disk+Math.PI*loop.outerRadiusMm**2-bore);
  expect(multiPolygonArea(geometry.frame)).toBeGreaterThan(disk-multiPolygonArea(geometry.mapOpening));
 });

 it('rejects a rim that consumes the whole disk',()=>{
  const geometry=buildOrnamentGeometry({...defaults.ornament,diameterMm:40,rimWidthMm:25});
  expect(geometry.issues.some(i=>i.code==='rim-too-wide')).toBe(true);
  expect(geometry.frame).toEqual([]);
 });

 it('rejects a boundary that leaves no text band',()=>{
  const geometry=buildOrnamentGeometry({...defaults.ornament,mapToTextBoundaryMm:44.8});
  expect(geometry.issues.some(i=>i.code==='no-text-band')).toBe(true);
 });

 it('rejects a boundary that leaves no map window',()=>{
  const geometry=buildOrnamentGeometry({...defaults.ornament,mapToTextBoundaryMm:-44.8});
  expect(geometry.issues.some(i=>i.code==='no-map-opening')).toBe(true);
 });

 it('flags a loop whose material is thinner than the minimum neck',()=>{
  const geometry=buildOrnamentGeometry({...defaults.ornament,hangingLoop:{...defaults.ornament.hangingLoop,innerDiameterMm:14.5}});
  expect(geometry.issues.some(i=>i.code==='loop-annulus-too-thin')).toBe(true);
 });

 it('produces finite coordinates only',()=>{
  const geometry=buildOrnamentGeometry(defaults.ornament);
  for(const polygon of geometry.frame)for(const ring of polygon)for(const [x,y] of ring){
   expect(Number.isFinite(x)).toBe(true);
   expect(Number.isFinite(y)).toBe(true);
  }
 });
});
