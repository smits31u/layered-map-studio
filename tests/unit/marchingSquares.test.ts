import * as polygonClipping from 'polygon-clipping';
import {describe,expect,it} from 'vitest';
import {multiPolygonArea,signedArea,type MultiPolygonMm,type RingMm} from '../../src/geometry/shoreline/polygonEngine';
import {EDGE_CROSSING_MARGIN,caseIndex,cellSegments,crossingFraction,saddleValue,traceContourRings} from '../../src/geometry/terrain/marchingSquares';

// Marching squares is checked three independent ways: a hand-derived table of all 16 cases, a
// geometric property every non-ambiguous segment must satisfy (above corners on one side, below on
// the other), and a comparison of whole-grid topology against a dense sampling of the bilinear
// surface the asymptotic decider is meant to reproduce.

// Local edges: 0 top, 1 right, 2 bottom, 3 left. Midpoints when the crossing is halfway along.
const MID:[number,number][]=[[.5,0],[1,.5],[.5,1],[0,.5]];
const CORNERS:[number,number][]=[[0,0],[1,0],[1,1],[0,1]];
const valuesFor=(index:number)=>[index&1?1:0,index&2?1:0,index&4?1:0,index&8?1:0] as const;

// Worked out by hand from the definitions in marchingSquares.ts: corners TL,TR,BR,BL = bits 1,2,4,8,
// each segment runs from the edge where the clockwise walk leaves the above region to the edge
// where it re-enters. Saddles 5 and 10 at 1/0 corner values have saddle value exactly 0.5, which is
// >= 0.5, so their above corners are joined.
const EXPECTED:Record<number,[number,number][]>={
 0:[],1:[[0,3]],2:[[1,0]],3:[[1,3]],4:[[2,1]],5:[[0,1],[2,3]],6:[[2,0]],7:[[2,3]],
 8:[[3,2]],9:[[0,2]],10:[[1,2],[3,0]],11:[[1,2]],12:[[3,1]],13:[[0,1]],14:[[3,0]],15:[],
};

describe('marching squares: the 16 cases',()=>{
 it.each(Array.from({length:16},(_,i)=>i))('case %i emits the hand-derived segments',index=>{
  const [tl,tr,br,bl]=valuesFor(index);
  expect(caseIndex(tl,tr,br,bl,.5)).toBe(index);
  expect(cellSegments(tl,tr,br,bl,.5).map(s=>[s.fromEdge,s.toEdge])).toEqual(EXPECTED[index]);
 });

 it('puts every above corner on one side of a non-ambiguous segment and every below corner on the other',()=>{
  for(let index=1;index<15;index++){
   if(index===5||index===10)continue;
   const values=valuesFor(index),[segment]=cellSegments(...values,.5);
   const [ax,ay]=MID[segment.fromEdge],[bx,by]=MID[segment.toEdge];
   CORNERS.forEach(([cx,cy],k)=>{
    const side=(bx-ax)*(cy-ay)-(by-ay)*(cx-ax);
    // Positive cross product = right-hand side on screen in y-down space.
    if(values[k])expect(side,`case ${index} corner ${k}`).toBeGreaterThan(0);else expect(side,`case ${index} corner ${k}`).toBeLessThan(0);
   });
  }
 });

 it('treats a corner exactly at the threshold as above',()=>{
  expect(caseIndex(.5,.49,.49,.49,.5)).toBe(1);
  expect(cellSegments(.5,.49,.49,.49,.5)).toEqual([{fromEdge:0,toEdge:3}]);
 });
});

describe('marching squares: the ambiguous saddle cases',()=>{
 it('computes the bilinear saddle value',()=>{
  expect(saddleValue(1,0,1,0)).toBe(.5);
  expect(saddleValue(1,.4,1,.4)).toBeCloseTo(.84/1.2,15);
  expect(saddleValue(.6,0,.6,0)).toBeCloseTo(.3,15);
 });

 it('joins the above corners of case 5 when the saddle is above the threshold, separates them when below',()=>{
  expect(cellSegments(1,.4,1,.4,.5).map(s=>[s.fromEdge,s.toEdge])).toEqual([[0,1],[2,3]]);
  expect(cellSegments(.6,0,.6,0,.5).map(s=>[s.fromEdge,s.toEdge])).toEqual([[0,3],[2,1]]);
 });

 it('does the same for case 10',()=>{
  expect(cellSegments(.4,1,.4,1,.5).map(s=>[s.fromEdge,s.toEdge])).toEqual([[1,2],[3,0]]);
  expect(cellSegments(0,.6,0,.6,.5).map(s=>[s.fromEdge,s.toEdge])).toEqual([[1,0],[3,2]]);
 });

 it('gives one ring for joined diagonal peaks and two for separate ones, in both orientations',()=>{
  // Zero border, a 2x2 saddle in the middle.
  const grid=(a:number,b:number,c:number,d:number)=>[0,0,0,0, 0,a,b,0, 0,c,d,0, 0,0,0,0];
  const count=(values:number[])=>traceContourRings(values,4,4,.5).length;
  expect(count(grid(1,.4,.4,1))).toBe(1);
  expect(count(grid(.6,0,0,.6))).toBe(2);
  expect(count(grid(.4,1,1,.4))).toBe(1);
  expect(count(grid(0,.6,.6,0))).toBe(2);
 });

 it('switches from joined to separate exactly once as the threshold rises, never back',()=>{
  // The decision depends on the threshold only through s >= threshold, so it is monotone.
  const s=saddleValue(.9,.2,.7,.1);
  let previousJoined=true;
  for(let t=.21;t<.69;t+=.01){
   const joined=cellSegments(.9,.2,.7,.1,t)[0].toEdge===1;
   if(joined)expect(previousJoined).toBe(true);
   expect(joined).toBe(s>=t);
   previousJoined=joined;
  }
 });

 it('matches the topology of the bilinear surface on random grids',()=>{
  // Independent check: sample the piecewise-bilinear interpolant densely and count connected
  // above-regions and enclosed below-regions, then compare with the number of positive and
  // negative rings. Grids with a value or a saddle too close to the threshold are skipped, since
  // their topology is decided by features narrower than the sampling can see.
  let seed=12345;const rand=()=>{seed=(Math.imul(seed,1103515245)+12345)>>>0;return seed/4294967296};
  // Corners sit on the sampling lattice, so a region hanging off a corner is always seen; only a
  // saddle neck narrower than the sampling could be missed, hence the saddle margin.
  const t=.5,S=32;let tested=0,saddlesTested=0;
  for(let trial=0;trial<1500&&tested<120;trial++){
   const C=5,R=5,values=Array.from({length:C*R},()=>rand());
   const at=(c:number,r:number)=>c<0||r<0||c>=C||r>=R?0:values[r*C+c];
   let degenerate=values.some(v=>Math.abs(v-t)<.02),saddles=0;
   for(let r=-1;r<R&&!degenerate;r++)for(let c=-1;c<C;c++){
    const i=caseIndex(at(c,r),at(c+1,r),at(c+1,r+1),at(c,r+1),t);
    if(i===5||i===10){saddles++;if(Math.abs(saddleValue(at(c,r),at(c+1,r),at(c+1,r+1),at(c,r+1))-t)<.04)degenerate=true}
   }
   if(!degenerate)saddlesTested+=saddles;
   if(degenerate)continue;
   tested++;
   const W=(C+1)*S+1,H=(R+1)*S+1,above=new Uint8Array(W*H);
   for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const gx=x/S-1,gy=y/S-1,c=Math.min(Math.floor(gx),C-1),r=Math.min(Math.floor(gy),R-1),fx=gx-c,fy=gy-r;
    const v=(at(c,r)*(1-fx)+at(c+1,r)*fx)*(1-fy)+(at(c,r+1)*(1-fx)+at(c+1,r+1)*fx)*fy;
    above[y*W+x]=v>=t?1:0;
   }
   const components=(want:number)=>{
    const seen=new Uint8Array(W*H);let enclosed=0,total=0;
    for(let start=0;start<W*H;start++){
     if(seen[start]||above[start]!==want)continue;
     total++;let touchesBorder=false;const stack=[start];seen[start]=1;
     while(stack.length){
      const i=stack.pop()!,x=i%W,y=(i-x)/W;
      if(x===0||y===0||x===W-1||y===H-1)touchesBorder=true;
      for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=W||ny>=H)continue;const j=ny*W+nx;if(!seen[j]&&above[j]===want){seen[j]=1;stack.push(j)}}
     }
     if(!touchesBorder)enclosed++;
    }
    return {total,enclosed};
   };
   const rings=traceContourRings(values,C,R,t);
   const positive=rings.filter(ring=>signedArea(ring.points)>0).length,negative=rings.length-positive;
   expect(positive,`trial ${trial} above-regions`).toBe(components(1).total);
   expect(negative,`trial ${trial} enclosed below-regions`).toBe(components(0).enclosed);
  }
  expect(tested).toBeGreaterThanOrEqual(100);
  // The comparison is only meaningful if the ambiguous cases actually came up.
  expect(saddlesTested).toBeGreaterThan(50);
 });
});

describe('contour tracing',()=>{
 it('places crossings by linear interpolation, measured from the lower end',()=>{
  // One peak of 1 in a zero field; at 0.25 the crossing is a quarter of the way from each zero
  // neighbour toward the peak, i.e. 0.75 from the peak.
  const rings=traceContourRings([0,0,0, 0,1,0, 0,0,0],3,3,.25);
  expect(rings).toHaveLength(1);
  const points=rings[0].points.slice(0,-1).map(([x,y])=>[+x.toFixed(12),+y.toFixed(12)]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  expect(points).toEqual([[.25,1],[1,.25],[1,1.75],[1.75,1]]);
 });

 it('produces closed rings with the above region inside positive rings and holes negative',()=>{
  // A ring of high values around a low centre: one outline, one hole.
  const values=[0,0,0,0,0, 0,1,1,1,0, 0,1,0,1,0, 0,1,1,1,0, 0,0,0,0,0];
  const rings=traceContourRings(values,5,5,.5);
  expect(rings).toHaveLength(2);
  for(const ring of rings){const first=ring.points[0],last=ring.points.at(-1)!;expect(first).toEqual(last)}
  expect(rings.map(ring=>Math.sign(signedArea(ring.points))).sort()).toEqual([-1,1]);
 });

 it('closes a contour that runs off the grid half a cell beyond the edge',()=>{
  const rings=traceContourRings([1,1,1,1],2,2,.5);
  expect(rings).toHaveLength(1);
  const xs=rings[0].points.map(p=>p[0]),ys=rings[0].points.map(p=>p[1]);
  expect(Math.min(...xs)).toBeCloseTo(-.5,12);expect(Math.max(...xs)).toBeCloseTo(1.5,12);
  expect(Math.min(...ys)).toBeCloseTo(-.5,12);expect(Math.max(...ys)).toBeCloseTo(1.5,12);
 });

 it('keeps a crossing off the sample point when a value sits exactly on the threshold',()=>{
  expect(crossingFraction(0,.5,.5)).toBe(1-EDGE_CROSSING_MARGIN);
  expect(crossingFraction(.5,1,.5)).toBe(EDGE_CROSSING_MARGIN);
  // A plateau exactly at the threshold still gives simple, closed, non-pinched rings.
  const rings=traceContourRings([0,0,0,0, 0,.5,.5,0, 0,.5,.5,0, 0,0,0,0],4,4,.5);
  expect(rings).toHaveLength(1);
  expect(rings[0].points).toHaveLength(9);
 });

 it('moves each crossing monotonically toward the high end as the threshold rises',()=>{
  let previous=-Infinity;
  for(let t=.101;t<.9;t+=.013){const f=crossingFraction(.1,.9,t);expect(f).toBeGreaterThanOrEqual(previous);previous=f}
 });

 it('refuses a threshold of 0 or below, which would enclose the whole plane',()=>{
  expect(()=>traceContourRings([1],1,1,0)).toThrow('> 0');
  expect(()=>traceContourRings([1],1,1,Number.NaN)).toThrow('> 0');
 });

 it('produces raw contours that nest exactly as the threshold rises, on random fields',()=>{
  // Before any simplification or clipping: the region above a higher threshold must lie inside the
  // region above a lower one. Regions are rebuilt from the rings with even/odd (xor) so this check
  // shares nothing with the pipeline's own assembly.
  let seed=777;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};
  const region=(rings:{points:[number,number][]}[]):MultiPolygonMm=>{const polygons=rings.map(ring=>[ring.points as RingMm]);return polygons.length?polygonClipping.xor(polygons[0],...polygons.slice(1)):[]};
  for(let trial=0;trial<25;trial++){
   const C=9,R=7,values=Array.from({length:C*R},()=>rand());
   const thresholds=[.15,.3,.45,.5,.62,.8,.95];
   for(let k=1;k<thresholds.length;k++){
    const outer=region(traceContourRings(values,C,R,thresholds[k-1])),inner=region(traceContourRings(values,C,R,thresholds[k]));
    if(!inner.length)continue;
    expect(multiPolygonArea(polygonClipping.difference(inner,outer)),`trial ${trial} ${thresholds[k]} vs ${thresholds[k-1]}`).toBeLessThan(1e-9);
   }
  }
 });

 it('is deterministic',()=>{
  const values=Array.from({length:64},(_,i)=>((i*37)%17)/17);
  expect(traceContourRings(values,8,8,.4)).toEqual(traceContourRings(values,8,8,.4));
 });
});
