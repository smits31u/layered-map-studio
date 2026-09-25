import {describe,expect,it} from 'vitest';
import {traceContourLines,traceContourRings} from '../../src/geometry/terrain/marchingSquares';
import {chaikinLine,clipLinesToArea,extractContourLines,lineLengthMm} from '../../src/geometry/terrain/contourLines';
import {extractNestedBands,type SampleGrid} from '../../src/geometry/terrain/nestedBands';

// The generalised contour code (topo Phase 2): open centerlines that end at the grid boundary, and
// band tracing with no "outside = 0 / thresholds > 0" assumption. The depth-contour pins that prove
// the generalisation changed nothing for the lake tool live in depthContours.test.ts and
// depthTerrain.test.ts and are unchanged.

const grid=(columns:number,rows:number,f:(x:number,y:number)=>number):{values:Float64Array;columns:number;rows:number}=>{
 const values=new Float64Array(columns*rows);
 for(let y=0;y<rows;y++)for(let x=0;x<columns;x++)values[y*columns+x]=f(x,y);
 return {values,columns,rows};
};
const onBoundary=([x,y]:[number,number],columns:number,rows:number)=>x===0||y===0||x===columns-1||y===rows-1;

describe('open contour lines',()=>{
 it('terminate on the grid boundary when the contour leaves the grid',()=>{
  // A plane rising to the east: every contour is a north–south line crossing the whole grid.
  const g=grid(12,9,x=>x*10);
  const lines=traceContourLines(g.values,g.columns,g.rows,45);
  expect(lines).toHaveLength(1);
  const [line]=lines;
  expect(line.closed).toBe(false);
  expect(onBoundary(line.points[0],12,9)).toBe(true);
  expect(onBoundary(line.points[line.points.length-1],12,9)).toBe(true);
  // x = 4.5 all the way down: interpolated, not snapped to a sample.
  for(const [x] of line.points)expect(x).toBeCloseTo(4.5,12);
  expect(new Set(line.points.map(p=>p[1]))).toEqual(new Set([0,1,2,3,4,5,6,7,8]));
 });

 it('close into loops when the contour stays inside, with the first point repeated',()=>{
  const g=grid(15,15,(x,y)=>100-((x-7)**2+(y-7)**2));
  const [loop]=traceContourLines(g.values,g.columns,g.rows,80);
  expect(loop.closed).toBe(true);
  expect(loop.points[0]).toEqual(loop.points[loop.points.length-1]);
  for(const p of loop.points.slice(0,-1))expect(onBoundary(p,15,15)).toBe(false);
 });

 it('mix open and closed lines at one level, open first',()=>{
  // A ridge running off the east edge plus a separate knoll.
  const g=grid(20,12,(x,y)=>Math.max(50-Math.abs(y-3)*10+x,60-((x-6)**2+(y-8)**2)*4));
  const lines=traceContourLines(g.values,g.columns,g.rows,48);
  expect(lines.some(l=>l.closed)).toBe(true);
  expect(lines.some(l=>!l.closed)).toBe(true);
  const firstClosed=lines.findIndex(l=>l.closed);
  expect(lines.slice(firstClosed).every(l=>l.closed)).toBe(true);
  for(const l of lines.filter(l=>!l.closed)){expect(onBoundary(l.points[0],20,12)).toBe(true);expect(onBoundary(l.points[l.points.length-1],20,12)).toBe(true)}
 });

 it('handle thresholds below sea level',()=>{
  const g=grid(10,10,x=>-200+x*20);
  const [line]=traceContourLines(g.values,g.columns,g.rows,-110);
  expect(line.closed).toBe(false);
  for(const [x] of line.points)expect(x).toBeCloseTo(4.5,12);
 });

 it('treat zero as an ordinary elevation',()=>{
  const g=grid(10,6,x=>x-4);
  const [line]=traceContourLines(g.values,g.columns,g.rows,0);
  // The sample at exactly 0 counts as at-or-above, so the crossing sits a hair below it.
  for(const [x] of line.points)expect(x).toBeCloseTo(4,5);
  // A field that is exactly zero everywhere is entirely "at or above" zero: no line.
  const flat=grid(10,6,()=>0);
  expect(traceContourLines(flat.values,flat.columns,flat.rows,0)).toEqual([]);
  expect(traceContourLines(flat.values,flat.columns,flat.rows,1e-9)).toEqual([]);
 });

 it('produce no lines at thresholds outside the data, and refuse non-finite ones',()=>{
  const g=grid(6,6,(x,y)=>x+y);
  expect(traceContourLines(g.values,g.columns,g.rows,-1)).toEqual([]);
  expect(traceContourLines(g.values,g.columns,g.rows,100)).toEqual([]);
  expect(()=>traceContourLines(g.values,g.columns,g.rows,Number.NaN)).toThrow();
  expect(()=>traceContourLines(g.values,g.columns,g.rows,Infinity)).toThrow();
 });

 it('resolve saddles the same way the band tracer does',()=>{
  // Case 5/10 saddle: diagonal highs. The asymptotic decider joins the highs when the centre value
  // is at or above the threshold.
  const values=Float64Array.of(10,0,0,10);
  // The far endpoint of the line that starts on the top edge (y = 0).
  const partnerOfTop=(threshold:number)=>{
   const lines=traceContourLines(values,2,2,threshold);
   expect(lines).toHaveLength(2);
   const line=lines.find(l=>l.points.some(p=>p[1]===0))!;
   return line.points.find(p=>p[1]!==0)!;
  };
  // Centre value 5. At 4 the highs join, so the top-edge line cuts off the low top-right corner and
  // ends on the right edge; at 6 they separate and it cuts off the high top-left corner instead.
  expect(partnerOfTop(4)[0]).toBe(1);
  expect(partnerOfTop(6)[0]).toBe(0);
 });
});

describe('band tracing with no virtual sea level',()=>{
 it('closes rings around the grid at an outside value of −∞, so negative and zero thresholds work',()=>{
  const g=grid(8,8,x=>-50+x*10);
  for(const t of [-35,5,15]){
   const rings=traceContourRings(g.values,g.columns,g.rows,t,()=>0,{outside:-Infinity});
   expect(rings).toHaveLength(1);
   const xs=rings[0].points.map(p=>p[0]);
   // One side sits on the interpolated contour, the rest hug the grid's outer samples.
   expect(Math.min(...xs)).toBeCloseTo((t+50)/10,6);
   expect(Math.max(...xs)).toBeGreaterThan(7);
  }
 });

 it('still refuses a threshold at or below the outside value',()=>{
  const g=grid(4,4,()=>1);
  expect(()=>traceContourRings(g.values,4,4,0)).toThrow('Contour threshold must be > 0 (got 0); samples outside the grid are treated as 0.');
  expect(()=>traceContourRings(g.values,4,4,-5,()=>0,{outside:-10})).not.toThrow();
  expect(()=>traceContourRings(g.values,4,4,-10,()=>0,{outside:-10})).toThrow(/above the outside value -10/);
 });

 it('nests bands at thresholds below, at and above zero',()=>{
  const sample:SampleGrid={...grid(30,30,(x,y)=>40-((x-15)**2+(y-15)**2)*.5),originXMm:0,originYMm:0,cellWidthMm:1,cellHeightMm:1};
  const board=[[[[0,0],[30,0],[30,30],[0,30],[0,0]] as [number,number][]]];
  const bands=extractNestedBands(sample,[20,-30,0],board,{},-Infinity);
  expect(bands.thresholds).toEqual([-30,0,20]);
  const areas=bands.levels.map(l=>l.areaMm2);
  expect(areas[0]).toBeGreaterThan(areas[1]);
  expect(areas[1]).toBeGreaterThan(areas[2]);
  expect(areas[2]).toBeGreaterThan(0);
 });
});

describe('contour line shaping and clipping',()=>{
 it('Chaikin keeps an open line\'s endpoints',()=>{
  const line:[number,number][]=[[0,0],[10,0],[10,10],[20,10]];
  const smooth=chaikinLine(line);
  expect(smooth[0]).toEqual([0,0]);
  expect(smooth[smooth.length-1]).toEqual([20,10]);
  expect(smooth).toHaveLength(2+2*(line.length-2));
  expect(chaikinLine([[0,0],[1,1]])).toEqual([[0,0],[1,1]]);
 });

 it('clips lines to an area with holes, as open paths',()=>{
  const area=[[[[0,0],[100,0],[100,100],[0,100],[0,0]],[[40,40],[40,60],[60,60],[60,40],[40,40]]] as [number,number][][]];
  const clipped=clipLinesToArea([[[-10,50],[110,50]]],area);
  expect(clipped).toHaveLength(2);
  const total=clipped.reduce((s,l)=>s+lineLengthMm(l),0);
  expect(total).toBeCloseTo(80,6);
  for(const l of clipped)for(const [x] of l)expect(x>=0&&x<=100&&!(x>40&&x<60)).toBe(true);
 });

 it('extracts lines in millimetres that end exactly on the clip boundary',()=>{
  const g:SampleGrid={...grid(42,32,x=>x*5),originXMm:-1,originYMm:-1,cellWidthMm:1,cellHeightMm:1};
  const board=[[[[0,0],[40,0],[40,30],[0,30],[0,0]] as [number,number][]]];
  const [level]=extractContourLines(g,[102.5],board);
  expect(level.lines).toHaveLength(1);
  const line=level.lines[0];
  const ys=[line[0][1],line[line.length-1][1]].sort((a,b)=>a-b);
  expect(ys).toEqual([0,30]);
  // x = −1 + (20.5 + ½)·1 = 20
  for(const [x] of line)expect(x).toBeCloseTo(20,3);
  expect(level.lengthMm).toBeCloseTo(30,3);
 });
});
