import {describe,expect,it} from 'vitest';
import type {MultiPolygonMm,RingMm} from '../../src/geometry/shoreline/polygonEngine';
import {cellCenterX,cellCenterY,chamferDistance,labelWaterBodies,rasterizeShoreline,shorelineBounds,terrainGridSpec,type TerrainGridSpec} from '../../src/geometry/terrain/terrainRaster';

// The grid stages are checked against things that can be worked out without the code under test:
// hand-drawn masks, distances counted on paper, and an independent brute-force ray-casting
// reference evaluated at every cell centre.

const rect=(x0:number,y0:number,x1:number,y1:number):RingMm=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]];
const exactGrid=(shoreline:MultiPolygonMm,cellMm=1):TerrainGridSpec=>terrainGridSpec(shorelineBounds(shoreline),{cellMm,minCellsLongSide:8,maxCellsLongSide:4096});
const countInside=(mask:Uint8Array)=>mask.reduce((sum,v)=>sum+v,0);
const picture=(mask:Uint8Array,grid:TerrainGridSpec)=>Array.from({length:grid.rows},(_,row)=>Array.from({length:grid.columns},(_,column)=>mask[row*grid.columns+column]?'#':'.').join(''));

// Independent reference: textbook even/odd ray casting per polygon, OR across polygons.
function referenceInside(shoreline:MultiPolygonMm,x:number,y:number){
 return shoreline.some(polygon=>{
  let inside=false;
  for(const ring of polygon)for(let i=0,j=ring.length-1;i<ring.length;j=i++){
   const [ax,ay]=ring[i],[bx,by]=ring[j];
   if((ay>y)!==(by>y)&&x<(bx-ax)*(y-ay)/(by-ay)+ax)inside=!inside;
  }
  return inside;
 });
}
function referenceMask(shoreline:MultiPolygonMm,grid:TerrainGridSpec){
 const mask=new Uint8Array(grid.columns*grid.rows);
 for(let row=0;row<grid.rows;row++)for(let column=0;column<grid.columns;column++)if(referenceInside(shoreline,cellCenterX(grid,column),cellCenterY(grid,row)))mask[row*grid.columns+column]=1;
 return mask;
}

// Deterministic star-shaped rings (no Math.random: fixtures must be stable).
function lcg(seed:number){let s=seed>>>0;return ()=>{s=(Math.imul(s,1103515245)+12345)>>>0;return s/4294967296}}
function star(cx:number,cy:number,spikes:number,inner:number,outer:number,seed:number,clockwise=false):RingMm{
 const rand=lcg(seed),ring:RingMm=[];
 for(let k=0;k<spikes*2;k++){const angle=(clockwise?-1:1)*k*Math.PI/spikes,r=(k%2?inner:outer)*(.75+.5*rand());ring.push([cx+r*Math.cos(angle),cy+r*Math.sin(angle)])}
 ring.push([...ring[0]] as [number,number]);
 return ring;
}

describe('terrain grid sizing',()=>{
 it('uses the preferred physical cell size inside the bounds, padded by one cell each side',()=>{
  const grid=terrainGridSpec({minX:0,minY:0,maxX:100,maxY:40},{cellMm:.5,minCellsLongSide:64,maxCellsLongSide:512});
  expect(grid).toEqual({columns:202,rows:82,cellMm:.5,originXMm:-.5,originYMm:-.5});
 });
 it('caps the cell count for large shorelines',()=>{
  const grid=terrainGridSpec({minX:0,minY:0,maxX:2000,maxY:1000},{cellMm:.5,minCellsLongSide:64,maxCellsLongSide:512});
  expect(grid.cellMm).toBe(2000/512);
  expect(grid.columns).toBe(512+2);
  expect(grid.rows).toBe(256+2);
 });
 it('refines the cell for tiny shorelines so they still get a usable grid',()=>{
  const grid=terrainGridSpec({minX:0,minY:0,maxX:.2,maxY:.2},{cellMm:.5,minCellsLongSide:64,maxCellsLongSide:512});
  expect(grid.cellMm).toBe(.2/64);
  expect(grid.columns).toBe(66);
 });
 it('rejects shorelines with no extent, no coordinates or non-finite coordinates',()=>{
  expect(()=>terrainGridSpec({minX:5,minY:5,maxX:5,maxY:5},{cellMm:1,minCellsLongSide:8,maxCellsLongSide:64})).toThrow('zero extent');
  expect(()=>shorelineBounds([])).toThrow('no coordinates');
  expect(()=>shorelineBounds([[[[0,0],[1,0],[Number.NaN,1],[0,0]]]])).toThrow('non-finite');
  expect(()=>shorelineBounds([[[[0,0],[Infinity,0],[1,1],[0,0]]]])).toThrow('non-finite');
 });
});

describe('shoreline rasterization',()=>{
 it('fills exactly the cells whose centres lie inside a grid-aligned rectangle',()=>{
  const shoreline:MultiPolygonMm=[[rect(0,0,10,6)]],grid=exactGrid(shoreline),mask=rasterizeShoreline(shoreline,grid);
  expect(grid).toMatchObject({columns:12,rows:8,originXMm:-1,originYMm:-1});
  expect(countInside(mask)).toBe(60);
  expect(picture(mask,grid)).toEqual([
   '............',
   '.##########.',
   '.##########.',
   '.##########.',
   '.##########.',
   '.##########.',
   '.##########.',
   '............',
  ]);
 });

 it('leaves a hole empty',()=>{
  const shoreline:MultiPolygonMm=[[rect(0,0,8,8),rect(2,2,6,6)]],grid=exactGrid(shoreline),mask=rasterizeShoreline(shoreline,grid);
  expect(countInside(mask)).toBe(64-16);
  expect(picture(mask,grid)).toEqual([
   '..........',
   '.########.',
   '.########.',
   '.##....##.',
   '.##....##.',
   '.##....##.',
   '.##....##.',
   '.########.',
   '.########.',
   '..........',
  ]);
 });

 it('fills an island that sits inside another polygon\'s hole',()=>{
  const shoreline:MultiPolygonMm=[[rect(0,0,10,10),rect(2,2,8,8)],[rect(4,4,6,6)]],mask=rasterizeShoreline(shoreline,exactGrid(shoreline));
  expect(countInside(mask)).toBe(100-36+4);
 });

 it('fills every member of a MultiPolygon',()=>{
  const shoreline:MultiPolygonMm=[[rect(0,0,4,4)],[rect(10,0,13,2)],[rect(0,8,2,10)]],mask=rasterizeShoreline(shoreline,exactGrid(shoreline));
  expect(countInside(mask)).toBe(16+6+4);
 });

 it('unions overlapping MultiPolygon members instead of cancelling their overlap',()=>{
  // A single global even/odd pass would leave the 3x3 overlap empty; members are OR-ed instead.
  const shoreline:MultiPolygonMm=[[rect(0,0,6,6)],[rect(3,3,9,9)]],mask=rasterizeShoreline(shoreline,exactGrid(shoreline));
  expect(countInside(mask)).toBe(36+36-9);
 });

 it('does not depend on ring winding or on whether rings are explicitly closed',()=>{
  const outer=star(20,20,9,8,16,1),hole=star(20,20,5,2,5,2);
  const base:MultiPolygonMm=[[outer,hole]],grid=exactGrid(base,.7),expected=rasterizeShoreline(base,grid);
  const reversed:MultiPolygonMm=[[[...outer].reverse(),[...hole].reverse()]];
  const open:MultiPolygonMm=[[outer.slice(0,-1),hole.slice(0,-1)]];
  expect(rasterizeShoreline(reversed,grid)).toEqual(expected);
  expect(rasterizeShoreline(open,grid)).toEqual(expected);
 });

 it('counts a vertex lying exactly on a cell-centre scanline once',()=>{
  // A diamond whose every vertex sits exactly on a cell centre. Spans are half-open [x0,x1), so the
  // widest row takes the left vertex's cell but not the right one's; the apexes add nothing.
  const diamond:MultiPolygonMm=[[[[5.5,2.5],[8.5,5.5],[5.5,8.5],[2.5,5.5],[5.5,2.5]]]];
  const grid:TerrainGridSpec={columns:11,rows:11,cellMm:1,originXMm:0,originYMm:0};
  const mask=rasterizeShoreline(diamond,grid);
  expect(mask).toEqual(referenceMask(diamond,grid));
  expect(picture(mask,grid).slice(2,9)).toEqual([
   '...........',
   '....##.....',
   '...####....',
   '..######...',
   '...####....',
   '....##.....',
   '...........',
  ]);
 });

 it('matches brute-force ray casting cell for cell on irregular MultiPolygons with holes',()=>{
  const fixtures:MultiPolygonMm[]=[
   [[star(30,30,17,10,25,11),star(30,30,6,3,7,12,true)]],
   [[star(20,20,7,5,15,21)],[star(55,25,11,6,14,22),star(55,25,4,1.5,3,23)],[star(35,60,23,4,18,24)]],
   [[star(40,40,40,20,38,31),star(34,40,5,2,5,32),star(48,42,5,2,5,33)],[star(40,40,6,1,3,34)]],
  ];
  for(const shoreline of fixtures)for(const cellMm of [.37,1,2.3]){
   const grid=exactGrid(shoreline,cellMm);
   expect(rasterizeShoreline(shoreline,grid),`cell ${cellMm}`).toEqual(referenceMask(shoreline,grid));
  }
 });

 it('never marks a padding cell',()=>{
  const shoreline:MultiPolygonMm=[[star(0,0,13,4,9,5)]],grid=exactGrid(shoreline,.25),mask=rasterizeShoreline(shoreline,grid);
  for(let column=0;column<grid.columns;column++){expect(mask[column]).toBe(0);expect(mask[(grid.rows-1)*grid.columns+column]).toBe(0)}
  for(let row=0;row<grid.rows;row++){expect(mask[row*grid.columns]).toBe(0);expect(mask[row*grid.columns+grid.columns-1]).toBe(0)}
 });
});

describe('chamfer distance transform',()=>{
 it('measures a rectangle exactly: distance = steps to the nearest outside cell',()=>{
  const shoreline:MultiPolygonMm=[[rect(0,0,10,6)]],grid=exactGrid(shoreline),mask=rasterizeShoreline(shoreline,grid);
  const distance=chamferDistance(mask,grid.columns,grid.rows);
  for(let row=0;row<grid.rows;row++)for(let column=0;column<grid.columns;column++){
   const i=row*grid.columns+column;
   if(!mask[i]){expect(distance[i]).toBe(0);continue}
   const x=column-1,y=row-1;
   expect(distance[i],`cell ${column},${row}`).toBe(Math.min(x+1,10-x,y+1,6-y));
  }
 });

 it('uses sqrt(2) for diagonal steps (hand-computed 5x5 around one shore cell)',()=>{
  const mask=new Uint8Array(25).fill(1);mask[12]=0;
  const d=chamferDistance(mask,5,5),r2=Math.SQRT2;
  const expected=[
   2*r2,1+r2,2,1+r2,2*r2,
   1+r2,r2,1,r2,1+r2,
   2,1,0,1,2,
   1+r2,r2,1,r2,1+r2,
   2*r2,1+r2,2,1+r2,2*r2,
  ];
  expected.forEach((value,i)=>expect(d[i]).toBeCloseTo(value,12));
 });

 it('equals the octile distance to the nearest outside cell, within 8.3% of Euclidean',()=>{
  const shoreline:MultiPolygonMm=[[star(25,25,11,8,22,41),star(22,27,5,2,5,42)],[star(60,20,7,4,10,43)]];
  const grid=exactGrid(shoreline,1.3),mask=rasterizeShoreline(shoreline,grid),d=chamferDistance(mask,grid.columns,grid.rows);
  const seeds:number[][]=[];
  for(let row=0;row<grid.rows;row++)for(let column=0;column<grid.columns;column++)if(!mask[row*grid.columns+column])seeds.push([column,row]);
  for(let row=0;row<grid.rows;row+=2)for(let column=0;column<grid.columns;column+=2){
   const i=row*grid.columns+column;
   if(!mask[i])continue;
   let octile=Infinity,euclid=Infinity;
   for(const [c,r] of seeds){const dx=Math.abs(c-column),dy=Math.abs(r-row),lo=Math.min(dx,dy),hi=Math.max(dx,dy);octile=Math.min(octile,hi-lo+Math.SQRT2*lo);euclid=Math.min(euclid,Math.hypot(dx,dy))}
   expect(d[i]).toBeCloseTo(octile,9);
   expect(d[i]).toBeGreaterThanOrEqual(euclid-1e-9);
   expect(d[i]).toBeLessThanOrEqual(euclid*1.0824+1e-9);
  }
 });

 it('is zero everywhere on an all-outside grid and refuses a grid with no outside cell',()=>{
  expect([...chamferDistance(new Uint8Array(12),4,3)]).toEqual(Array(12).fill(0));
  expect(()=>chamferDistance(new Uint8Array(9).fill(1),3,3)).toThrow('no shoreline cells');
 });
});

describe('water body labelling',()=>{
 const label=(shoreline:MultiPolygonMm,cellMm=1)=>{const grid=exactGrid(shoreline,cellMm),mask=rasterizeShoreline(shoreline,grid),distance=chamferDistance(mask,grid.columns,grid.rows);return {grid,mask,distance,...labelWaterBodies(mask,distance,grid.columns,grid.rows)}};

 it('separates disconnected bodies, in row-major order of their first cell, with their own stats',()=>{
  const {bodies,labels,mask}=label([[rect(20,0,30,10)],[rect(0,4,4,8)]]);
  expect(bodies).toEqual([{id:0,cellCount:100,maxDistanceCells:5},{id:1,cellCount:16,maxDistanceCells:2}]);
  for(let i=0;i<mask.length;i++)expect(labels[i]===-1).toBe(!mask[i]);
 });

 it('keeps a lake with a hole, and a U-shaped lake, as one body each',()=>{
  expect(label([[rect(0,0,8,8),rect(2,2,6,6)]]).bodies).toHaveLength(1);
  expect(label([[[[0,0],[9,0],[9,9],[6,9],[6,3],[3,3],[3,9],[0,9],[0,0]]]]).bodies).toHaveLength(1);
 });

 it('joins areas that touch only at a cell corner (8-connectivity)',()=>{
  expect(label([[rect(0,0,3,3)],[rect(3,3,6,6)]]).bodies).toHaveLength(1);
  expect(label([[rect(0,0,3,3)],[rect(4,4,7,7)]]).bodies).toHaveLength(2);
 });

 it('labels a large body iteratively without exhausting the call stack',()=>{
  const {bodies}=label([[rect(0,0,600,600)]]);
  expect(bodies).toEqual([{id:0,cellCount:360000,maxDistanceCells:300}]);
 });
});
