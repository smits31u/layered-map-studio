import type {OrnamentGeometry} from './ornamentShape';

// Analytic clipping of polylines to the ornament's map window: the inner disk, intersected with the
// half-plane above the map/text chord.
//
// The plan permits this shortcut explicitly — "Analytic line-circle clipping may be used for
// performance" — and immediately names the cases that make it go wrong: "test tangents, endpoints
// on the circle, multiple re-entry segments, and zero-length lines". Each of those is a way to
// produce a piece with no length, and a zero-length piece is not harmless: offset with round caps
// it becomes a dot engraved on the ornament, so dropping it is a fabrication requirement, not
// tidiness.
//
// Everything here is pure and shares the ornament's geometry space: millimetres, ornament centre at
// (0,0), +y downward. The clipping *region* is the same circle and chord `buildOrnamentGeometry`
// builds `mapOpening` from, so a road clipped here and the preview's crop mask cannot disagree.

export type PointMm=[number,number];
export type PolylineMm=PointMm[];

// Shorter than this and a piece has no engravable extent; it exists only as float noise from a
// tangent, an endpoint sitting exactly on the boundary, or a repeated vertex. One nanometre is far
// below any real fabrication feature and far above the residue those cases leave behind.
export const MIN_PIECE_LENGTH_MM=1e-6;

const lerp=(a:PointMm,b:PointMm,t:number):PointMm=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
const distance=(a:PointMm,b:PointMm)=>Math.hypot(b[0]-a[0],b[1]-a[1]);
const finite=(p:PointMm)=>Number.isFinite(p[0])&&Number.isFinite(p[1]);

export const polylineLengthMm=(line:PolylineMm):number=>{
 let total=0;
 for(let i=1;i<line.length;i++)total+=distance(line[i-1],line[i]);
 return total;
};

// The sub-interval of a→b that lies inside the circle, as [tEnter, tExit] clamped to [0,1], or
// undefined when none of it does.
//
// Solving |a + t(b-a) - c|² = r² gives (d·d)t² + 2(f·d)t + (f·f - r²) = 0 with d = b-a, f = a-c.
// A tangent is the discriminant-zero case: it yields a single t, an interval of zero width, which
// this returns faithfully. It is the caller that drops it, so the distinction between "grazes the
// circle" and "does not reach it" survives as far as it is useful.
export function segmentCircleInterval(a:PointMm,b:PointMm,cx:number,cy:number,radiusMm:number):[number,number]|undefined{
 if(!(radiusMm>0))return undefined;
 const dx=b[0]-a[0],dy=b[1]-a[1];
 const fx=a[0]-cx,fy=a[1]-cy;
 const dd=dx*dx+dy*dy;
 if(dd===0)return fx*fx+fy*fy<=radiusMm*radiusMm?[0,0]:undefined;
 const fd=fx*dx+fy*dy;
 const ff=fx*fx+fy*fy-radiusMm*radiusMm;
 const disc=fd*fd-dd*ff;
 if(disc<0)return undefined;
 const root=Math.sqrt(disc);
 const enter=Math.max(0,(-fd-root)/dd);
 const exit=Math.min(1,(-fd+root)/dd);
 return exit<enter?undefined:[enter,exit];
}

// The sub-interval of a→b lying at or above the chord. "Above" is smaller y: geometry space has +y
// downward to match SVG, so the map window is the part of the disk with y <= chordY.
export function segmentAboveChordInterval(a:PointMm,b:PointMm,chordYMm:number):[number,number]|undefined{
 const inA=a[1]<=chordYMm,inB=b[1]<=chordYMm;
 if(inA&&inB)return [0,1];
 if(!inA&&!inB)return undefined;
 // One endpoint is strictly on each side, so b[1]-a[1] cannot be zero here.
 const t=(chordYMm-a[1])/(b[1]-a[1]);
 const crossing=Math.min(1,Math.max(0,t));
 return inA?[0,crossing]:[crossing,1];
}

type SegmentInterval=(a:PointMm,b:PointMm)=>[number,number]|undefined;

// Walks the polyline once, accumulating contiguous inside runs. A piece stays open across a vertex
// only when the previous segment was inside right up to its end *and* the next one is inside from
// its start — which is what makes a polyline that leaves and re-enters the disk come back as
// several pieces rather than one with a chord drawn across the gap.
function clipPolyline(line:PolylineMm,inside:SegmentInterval,minLengthMm:number):PolylineMm[]{
 const pieces:PolylineMm[]=[];
 let current:PolylineMm|undefined;
 let openAtEnd=false;

 const flush=()=>{
  if(current&&current.length>=2&&polylineLengthMm(current)>=minLengthMm)pieces.push(current);
  current=undefined;
 };

 for(let i=0;i+1<line.length;i++){
  const a=line[i],b=line[i+1];
  if(!finite(a)||!finite(b)){flush();openAtEnd=false;continue}
  // A repeated vertex is not a break in the line, just a segment with nowhere to go. Skipping it
  // without closing the piece is what keeps [p, p, q] equivalent to [p, q].
  if(a[0]===b[0]&&a[1]===b[1])continue;
  const interval=inside(a,b);
  if(!interval){flush();openAtEnd=false;continue}
  const [t0,t1]=interval;
  const start=lerp(a,b,t0),end=lerp(a,b,t1);
  if(current&&openAtEnd&&t0===0)current.push(end);
  else{flush();current=[start,end]}
  openAtEnd=t1===1;
 }
 flush();
 return pieces.map(dedupe).filter(piece=>piece.length>=2&&polylineLengthMm(piece)>=minLengthMm);
}

// Removes vertices that coincide with their predecessor. They can appear where a run opens exactly
// at a vertex the previous segment already ended on.
const dedupe=(line:PolylineMm):PolylineMm=>line.filter((point,index)=>index===0||distance(line[index-1],point)>0);

export function clipPolylineToDisk(line:PolylineMm,cx:number,cy:number,radiusMm:number,minLengthMm=MIN_PIECE_LENGTH_MM):PolylineMm[]{
 return clipPolyline(line,(a,b)=>segmentCircleInterval(a,b,cx,cy,radiusMm),minLengthMm);
}

export function clipPolylineAboveChord(line:PolylineMm,chordYMm:number,minLengthMm=MIN_PIECE_LENGTH_MM):PolylineMm[]{
 return clipPolyline(line,(a,b)=>segmentAboveChordInterval(a,b,chordYMm),minLengthMm);
}

export interface MapWindow{innerRadiusMm:number;chordYMm:number}

export const mapWindowOf=(geometry:OrnamentGeometry):MapWindow=>({innerRadiusMm:geometry.innerRadiusMm,chordYMm:geometry.chordYMm});

// The clip the plan actually asks for: "Clip roads and water to the ornament's inner map disk. Also
// clip roads to the region above the map/text chord so engraving cannot collide with personalized
// text." Order does not matter mathematically — the region is the intersection either way — and
// disk-first is cheaper, since it usually removes the most.
export function clipPolylineToMapWindow(line:PolylineMm,window:MapWindow,minLengthMm=MIN_PIECE_LENGTH_MM):PolylineMm[]{
 return clipPolylineToDisk(line,0,0,window.innerRadiusMm,minLengthMm)
  .flatMap(piece=>clipPolylineAboveChord(piece,window.chordYMm,minLengthMm));
}

export const clipPolylinesToMapWindow=(lines:PolylineMm[],window:MapWindow,minLengthMm=MIN_PIECE_LENGTH_MM):PolylineMm[]=>
 lines.flatMap(line=>clipPolylineToMapWindow(line,window,minLengthMm));

// True when the point is inside the map window, boundary included.
export const isInsideMapWindow=(point:PointMm,window:MapWindow):boolean=>
 finite(point)&&point[1]<=window.chordYMm&&Math.hypot(point[0],point[1])<=window.innerRadiusMm;
