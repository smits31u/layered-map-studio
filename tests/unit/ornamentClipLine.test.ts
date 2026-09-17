import {describe,expect,it} from 'vitest';
import {
 clipPolylineAboveChord,
 clipPolylineToDisk,
 clipPolylineToMapWindow,
 clipPolylinesToMapWindow,
 isInsideMapWindow,
 mapWindowOf,
 polylineLengthMm,
 segmentAboveChordInterval,
 segmentCircleInterval,
 type PointMm,
 type PolylineMm,
} from '../../src/ornament/geometry/clipLine';
import {buildOrnamentGeometry} from '../../src/ornament/geometry/ornamentShape';
import {createDefaultOrnamentProject} from '../../src/ornament/defaults';

// The plan singles these out: "Analytic line-circle clipping may be used for performance, but test
// tangents, endpoints on the circle, multiple re-entry segments, and zero-length lines."
// They are correctness-critical because every one of them can leave behind a piece with no length,
// and a zero-length piece offset with round caps engraves as a dot on a finished ornament.

const R=40;
const near=(a:number,b:number,tol=1e-9)=>Math.abs(a-b)<=tol;
const closeTo=(point:PointMm,expected:PointMm,tol=1e-9)=>near(point[0],expected[0],tol)&&near(point[1],expected[1],tol);

describe('segment/circle interval',()=>{
 it('returns the full segment when it lies entirely inside',()=>{
  expect(segmentCircleInterval([-10,0],[10,0],0,0,R)).toEqual([0,1]);
 });

 it('returns nothing when the segment misses the circle entirely',()=>{
  expect(segmentCircleInterval([-100,R+5],[100,R+5],0,0,R)).toBeUndefined();
 });

 it('clips a segment that crosses the circle once',()=>{
  const interval=segmentCircleInterval([0,0],[100,0],0,0,R)!;
  expect(interval[0]).toBe(0);
  expect(interval[1]).toBeCloseTo(0.4,12);   // exits at x=40 along a 100mm run
 });

 it('returns a zero-width interval for an exact tangent rather than a spurious crossing',()=>{
  const interval=segmentCircleInterval([-50,R],[50,R],0,0,R);
  expect(interval).toBeDefined();
  expect(interval![1]-interval![0]).toBeLessThan(1e-6);
 });

 it('treats a zero-length segment as inside or outside, never as a crossing',()=>{
  expect(segmentCircleInterval([1,1],[1,1],0,0,R)).toEqual([0,0]);
  expect(segmentCircleInterval([100,100],[100,100],0,0,R)).toBeUndefined();
 });

 it('has no interior when a segment starts on the circle and points outward',()=>{
  const interval=segmentCircleInterval([R,0],[R+30,0],0,0,R)!;
  expect(interval[1]-interval[0]).toBeLessThan(1e-9);
 });

 it('keeps the whole segment when both endpoints sit exactly on the circle',()=>{
  const interval=segmentCircleInterval([-R,0],[R,0],0,0,R)!;
  expect(interval[0]).toBeCloseTo(0,12);
  expect(interval[1]).toBeCloseTo(1,12);
 });
});

describe('polyline clipped to the disk',()=>{
 it('keeps a line that never leaves',()=>{
  const pieces=clipPolylineToDisk([[-10,0],[0,5],[10,0]],0,0,R);
  expect(pieces).toEqual([[[-10,0],[0,5],[10,0]]]);
 });

 it('drops a line that never enters',()=>{
  expect(clipPolylineToDisk([[-100,100],[100,100]],0,0,R)).toEqual([]);
 });

 it('trims a line to the boundary where it crosses',()=>{
  const [piece]=clipPolylineToDisk([[0,0],[100,0]],0,0,R);
  expect(closeTo(piece[0],[0,0])).toBe(true);
  expect(closeTo(piece[1],[R,0],1e-9)).toBe(true);
 });

 it('drops a tangent line instead of emitting a zero-length piece',()=>{
  expect(clipPolylineToDisk([[-50,R],[50,R]],0,0,R)).toEqual([]);
  expect(clipPolylineToDisk([[-50,-R],[50,-R]],0,0,R)).toEqual([]);
 });

 it('drops a line that only touches the circle at an endpoint',()=>{
  expect(clipPolylineToDisk([[R,0],[R+30,0]],0,0,R)).toEqual([]);
  expect(clipPolylineToDisk([[R+30,0],[R,0]],0,0,R)).toEqual([]);
  expect(clipPolylineToDisk([[0,-R],[0,-R-10]],0,0,R)).toEqual([]);
 });

 it('keeps a chord whose endpoints are exactly on the circle',()=>{
  const [piece]=clipPolylineToDisk([[-R,0],[R,0]],0,0,R);
  expect(piece).toBeDefined();
  expect(polylineLengthMm(piece)).toBeCloseTo(2*R,6);
 });

 it('splits a line that leaves and re-enters into separate pieces',()=>{
  // Left of the disk, in, out through the top, back in, out to the right.
  const line:PolylineMm=[[-100,0],[0,0],[0,-100],[20,-100],[20,0],[100,0]];
  const pieces=clipPolylineToDisk(line,0,0,R);
  expect(pieces).toHaveLength(2);
  for(const piece of pieces)expect(polylineLengthMm(piece)).toBeGreaterThan(1);
  // No piece may bridge the gap: every vertex of every piece is inside the disk.
  for(const piece of pieces)for(const [x,y] of piece)expect(Math.hypot(x,y)).toBeLessThanOrEqual(R+1e-9);
 });

 it('handles three separate re-entries',()=>{
  const line:PolylineMm=[];
  for(let i=0;i<3;i++){
   const x=-20+i*20;
   line.push([x,-100],[x,100],[x+5,100],[x+5,-100],[x+10,-100]);
  }
  const pieces=clipPolylineToDisk(line,0,0,R);
  expect(pieces.length).toBeGreaterThanOrEqual(3);
  for(const piece of pieces)expect(polylineLengthMm(piece)).toBeGreaterThan(0);
 });

 it('returns nothing for a zero-length line, a single point, or an empty line',()=>{
  expect(clipPolylineToDisk([[1,1],[1,1]],0,0,R)).toEqual([]);
  expect(clipPolylineToDisk([[1,1]],0,0,R)).toEqual([]);
  expect(clipPolylineToDisk([],0,0,R)).toEqual([]);
  expect(clipPolylineToDisk([[1,1],[1,1],[1,1]],0,0,R)).toEqual([]);
 });

 it('treats a repeated vertex mid-line as if it were not there',()=>{
  const withRepeat=clipPolylineToDisk([[-10,0],[0,0],[0,0],[10,0]],0,0,R);
  const without=clipPolylineToDisk([[-10,0],[0,0],[10,0]],0,0,R);
  expect(withRepeat).toHaveLength(1);
  expect(polylineLengthMm(withRepeat[0])).toBeCloseTo(polylineLengthMm(without[0]),12);
 });

 it('never emits NaN, and drops a line containing one',()=>{
  const pieces=clipPolylineToDisk([[-10,0],[Number.NaN,0],[10,0]],0,0,R);
  for(const piece of pieces)for(const [x,y] of piece){expect(Number.isFinite(x)).toBe(true);expect(Number.isFinite(y)).toBe(true)}
 });

 it('returns nothing for a non-positive radius rather than throwing',()=>{
  expect(clipPolylineToDisk([[-10,0],[10,0]],0,0,0)).toEqual([]);
  expect(clipPolylineToDisk([[-10,0],[10,0]],0,0,-5)).toEqual([]);
 });

 it('respects a circle that is not centred at the origin',()=>{
  const [piece]=clipPolylineToDisk([[100,10],[110,10]],105,10,3);
  expect(closeTo(piece[0],[102,10],1e-9)).toBe(true);
  expect(closeTo(piece[1],[108,10],1e-9)).toBe(true);
 });
});

describe('chord clipping',()=>{
 const chordY=14;

 it('keeps a line entirely above the chord and drops one entirely below',()=>{
  expect(clipPolylineAboveChord([[-10,0],[10,0]],chordY)).toEqual([[[-10,0],[10,0]]]);
  expect(clipPolylineAboveChord([[-10,20],[10,20]],chordY)).toEqual([]);
 });

 it('cuts a crossing segment exactly at the chord',()=>{
  const [piece]=clipPolylineAboveChord([[0,0],[0,28]],chordY);
  expect(closeTo(piece[1],[0,chordY],1e-9)).toBe(true);
 });

 it('cuts a segment crossing upward at the chord',()=>{
  const [piece]=clipPolylineAboveChord([[0,28],[0,0]],chordY);
  expect(closeTo(piece[0],[0,chordY],1e-9)).toBe(true);
 });

 it('keeps a segment whose endpoint lies exactly on the chord',()=>{
  const [piece]=clipPolylineAboveChord([[0,0],[0,chordY]],chordY);
  expect(polylineLengthMm(piece)).toBeCloseTo(chordY,9);
 });

 it('drops a segment that only touches the chord at an endpoint from below',()=>{
  expect(clipPolylineAboveChord([[0,chordY],[0,30]],chordY)).toEqual([]);
 });

 it('drops a line running exactly along the chord only if it has no length',()=>{
  // A line lying on the chord is inside (the boundary is included), so it survives with length.
  const [piece]=clipPolylineAboveChord([[-10,chordY],[10,chordY]],chordY);
  expect(polylineLengthMm(piece)).toBeCloseTo(20,9);
 });

 it('splits a line that dips below the chord and comes back',()=>{
  const pieces=clipPolylineAboveChord([[-10,0],[-10,30],[10,30],[10,0]],chordY);
  expect(pieces).toHaveLength(2);
  for(const piece of pieces)for(const [,y] of piece)expect(y).toBeLessThanOrEqual(chordY+1e-9);
 });

 it('reports intervals directly for endpoints on the chord',()=>{
  expect(segmentAboveChordInterval([0,chordY],[0,chordY-5],chordY)).toEqual([0,1]);
  expect(segmentAboveChordInterval([0,chordY],[0,chordY+5],chordY)).toEqual([0,0]);
  // Coming up from below and stopping exactly on the chord touches it at one point: a zero-width
  // interval, reported faithfully here and dropped by the assembler, exactly like a tangent.
  expect(segmentAboveChordInterval([0,chordY+5],[0,chordY],chordY)).toEqual([1,1]);
  expect(segmentAboveChordInterval([0,chordY+5],[0,chordY+9],chordY)).toBeUndefined();
 });
});

describe('map window (disk and chord together)',()=>{
 const defaults=createDefaultOrnamentProject();
 const geometry=buildOrnamentGeometry(defaults.ornament);
 const window=mapWindowOf(geometry);

 it('uses the same inner radius and chord the ornament frame was built from',()=>{
  expect(window.innerRadiusMm).toBeCloseTo(defaults.ornament.diameterMm/2-defaults.ornament.rimWidthMm,12);
  expect(window.chordYMm).toBe(defaults.ornament.mapToTextBoundaryMm);
 });

 it('keeps every output vertex inside the disk and above the chord',()=>{
  const lines:PolylineMm[]=[
   [[-100,-100],[100,100]],
   [[-60,10],[60,10]],
   [[0,-60],[0,60]],
   [[-30,-30],[30,-30],[30,30],[-30,30],[-30,-30]],
  ];
  const pieces=clipPolylinesToMapWindow(lines,window);
  expect(pieces.length).toBeGreaterThan(0);
  for(const piece of pieces)for(const point of piece)expect(isInsideMapWindow(point,window)).toBe(true);
 });

 it('drops a line that is inside the disk but entirely in the text band',()=>{
  expect(clipPolylineToMapWindow([[-20,20],[20,20]],window)).toEqual([]);
 });

 it('drops a line above the chord but outside the disk',()=>{
  expect(clipPolylineToMapWindow([[-200,-60],[200,-60]],window)).toEqual([]);
 });

 it('never emits a piece shorter than the minimum engravable length',()=>{
  const lines:PolylineMm[]=[
   [[-100,window.chordYMm],[100,window.chordYMm]],     // along the chord, clipped by the disk
   [[-100,-window.innerRadiusMm],[100,-window.innerRadiusMm]], // tangent to the top of the disk
   [[window.innerRadiusMm,0],[window.innerRadiusMm+50,0]],     // starts on the circle, heads out
  ];
  for(const piece of clipPolylinesToMapWindow(lines,window))expect(polylineLengthMm(piece)).toBeGreaterThanOrEqual(1e-6);
 });

 it('agrees with the frame geometry about what the window contains',()=>{
  // Sampled against the independently-built mapOpening: a point the clipper calls inside must be
  // within the opening's bounding extent, and the top of the disk must be inside while the text
  // band must not be.
  expect(isInsideMapWindow([0,-window.innerRadiusMm+0.001],window)).toBe(true);
  expect(isInsideMapWindow([0,window.chordYMm+0.001],window)).toBe(false);
  expect(isInsideMapWindow([window.innerRadiusMm+0.001,0],window)).toBe(false);
  expect(geometry.mapOpening.length).toBe(1);
 });
});
