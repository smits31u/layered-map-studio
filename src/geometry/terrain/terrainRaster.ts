import type {MultiPolygonMm} from '../shoreline/polygonEngine';
import type {TerrainResolution} from './terrainParams';

// Grid stages of the depth-terrain pipeline: shoreline rasterization, the chamfer distance
// transform and connected-component labelling. Grids are row-major (index = row*columns + column),
// rows running +y (down, in this codebase's mm space), and a cell's value belongs to its centre:
//   centre(column,row) = (originXMm + (column+0.5)*cellMm, originYMm + (row+0.5)*cellMm)

export interface TerrainGridSpec{columns:number;rows:number;cellMm:number;originXMm:number;originYMm:number}
export interface ShorelineBounds{minX:number;minY:number;maxX:number;maxY:number}

// One guaranteed-outside cell on every side, so every water cell has a shore cell to measure from
// even when the shoreline runs along its own bounding box.
export const GRID_PADDING_CELLS=1;

export function shorelineBounds(shoreline:MultiPolygonMm):ShorelineBounds{
 let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,points=0;
 for(const polygon of shoreline)for(const ring of polygon)for(const point of ring){
  const [x,y]=point;
  if(!Number.isFinite(x)||!Number.isFinite(y))throw new Error('Depth terrain: shoreline contains a non-finite coordinate.');
  if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;points++;
 }
 if(!points)throw new Error('Depth terrain: shoreline has no coordinates.');
 return {minX,minY,maxX,maxY};
}

// Cell size: the preferred physical size, but never so small that the longer side exceeds
// maxCellsLongSide (browser time and memory) nor so large that it falls under minCellsLongSide
// (tiny shorelines still get a usable grid). Because the size is physical, cell count grows with
// the shoreline until the cap takes over.
export function terrainGridSpec(bounds:ShorelineBounds,resolution:TerrainResolution):TerrainGridSpec{
 const width=bounds.maxX-bounds.minX,height=bounds.maxY-bounds.minY,longSide=Math.max(width,height);
 if(!(longSide>0))throw new Error('Depth terrain: shoreline has zero extent.');
 const cellMm=Math.min(Math.max(resolution.cellMm,longSide/resolution.maxCellsLongSide),longSide/resolution.minCellsLongSide);
 const pad=GRID_PADDING_CELLS;
 return {
  columns:Math.ceil(width/cellMm)+2*pad,
  rows:Math.ceil(height/cellMm)+2*pad,
  cellMm,
  originXMm:bounds.minX-pad*cellMm,
  originYMm:bounds.minY-pad*cellMm,
 };
}

export const cellCenterX=(grid:TerrainGridSpec,column:number)=>grid.originXMm+(column+.5)*grid.cellMm;
export const cellCenterY=(grid:TerrainGridSpec,row:number)=>grid.originYMm+(row+.5)*grid.cellMm;

// Scanline even/odd rasterization sampled at cell centres. Each polygon is filled on its own —
// outer ring and holes together under the even/odd rule, so holes (and islands inside holes) come
// out right regardless of winding — and polygons are then OR-ed together, so overlapping or
// touching MultiPolygon members union rather than cancelling each other out as they would under a
// single global even/odd pass. Rings may be given closed (first point repeated) or open.
//
// A cell is inside when its centre lies in a half-open span [x0,x1) between consecutive sorted edge
// crossings of its row's centre line; edges use the half-open (ay>y)!==(by>y) test, so a vertex
// exactly on a scanline is counted once. That is exactly equivalent to ray casting at the centre.
export function rasterizeShoreline(shoreline:MultiPolygonMm,grid:TerrainGridSpec):Uint8Array{
 const {columns,rows}=grid,inside=new Uint8Array(columns*rows),crossings:number[]=[];
 for(const polygon of shoreline){
  let minY=Infinity,maxY=-Infinity;
  for(const ring of polygon)for(const [,y] of ring){if(y<minY)minY=y;if(y>maxY)maxY=y}
  if(!(maxY>minY))continue;
  const firstRow=Math.max(0,Math.floor((minY-grid.originYMm)/grid.cellMm-.5)),lastRow=Math.min(rows-1,Math.ceil((maxY-grid.originYMm)/grid.cellMm-.5));
  for(let row=firstRow;row<=lastRow;row++){
   const y=cellCenterY(grid,row);
   crossings.length=0;
   for(const ring of polygon){
    for(let a=0,b=ring.length-1;a<ring.length;b=a++){
     const [ax,ay]=ring[a],[bx,by]=ring[b];
     if((ay>y)!==(by>y))crossings.push((bx-ax)*(y-ay)/(by-ay)+ax);
    }
   }
   if(crossings.length<2)continue;
   crossings.sort((p,q)=>p-q);
   const base=row*columns;
   for(let k=0;k+1<crossings.length;k+=2){
    const start=firstCenterAtOrAfter(grid,crossings[k]),end=firstCenterAtOrAfter(grid,crossings[k+1]);
    for(let column=start;column<end;column++)inside[base+column]=1;
   }
  }
 }
 return inside;
}

// Smallest column whose centre is >= x, in [0,columns]. The arithmetic estimate is corrected
// against the exact centre expression so span membership never depends on rounding in the estimate.
function firstCenterAtOrAfter(grid:TerrainGridSpec,x:number):number{
 let column=Math.ceil((x-grid.originXMm)/grid.cellMm-.5);
 if(column<0)column=0;
 if(column>grid.columns)column=grid.columns;
 while(column>0&&cellCenterX(grid,column-1)>=x)column--;
 while(column<grid.columns&&cellCenterX(grid,column)<x)column++;
 return column;
}

const DIAGONAL=Math.SQRT2;
const UNREACHED=Number.MAX_VALUE;

// Two-pass 3x3 chamfer distance transform with orthogonal cost 1 and diagonal cost sqrt(2), in
// cells. Outside cells are the seeds (distance 0); every inside cell gets the length of the
// shortest 8-connected step path to an outside cell, which for these weights equals the octile
// distance to the nearest outside cell and over-estimates the Euclidean distance by at most ~8.2%.
// Cells beyond the grid edge are not seeds; rasterizeShoreline's padding supplies them instead.
export function chamferDistance(inside:Uint8Array,columns:number,rows:number):Float64Array{
 const distance=new Float64Array(columns*rows);
 let seeds=0;
 for(let i=0;i<inside.length;i++){if(inside[i])distance[i]=UNREACHED;else seeds++}
 if(!seeds&&inside.length)throw new Error('Depth terrain: distance transform has no shoreline cells to measure from.');
 for(let row=0;row<rows;row++){
  for(let column=0;column<columns;column++){
   const i=row*columns+column;
   let d=distance[i];
   if(d===0)continue;
   if(column>0&&distance[i-1]+1<d)d=distance[i-1]+1;
   if(row>0){
    const up=i-columns;
    if(distance[up]+1<d)d=distance[up]+1;
    if(column>0&&distance[up-1]+DIAGONAL<d)d=distance[up-1]+DIAGONAL;
    if(column<columns-1&&distance[up+1]+DIAGONAL<d)d=distance[up+1]+DIAGONAL;
   }
   distance[i]=d;
  }
 }
 for(let row=rows-1;row>=0;row--){
  for(let column=columns-1;column>=0;column--){
   const i=row*columns+column;
   let d=distance[i];
   if(d===0)continue;
   if(column<columns-1&&distance[i+1]+1<d)d=distance[i+1]+1;
   if(row<rows-1){
    const down=i+columns;
    if(distance[down]+1<d)d=distance[down]+1;
    if(column<columns-1&&distance[down+1]+DIAGONAL<d)d=distance[down+1]+DIAGONAL;
    if(column>0&&distance[down-1]+DIAGONAL<d)d=distance[down-1]+DIAGONAL;
   }
   distance[i]=d;
  }
 }
 return distance;
}

export interface WaterBodyStats{id:number;cellCount:number;maxDistanceCells:number}
export interface WaterBodyLabels{labels:Int32Array;bodies:WaterBodyStats[]}

// 8-connected flood fill of the inside mask. Ids are assigned in row-major order of each body's
// first cell, so labelling is deterministic. 8-connectivity matches the distance transform's
// neighbourhood; the consequence is that two water areas touching only at a cell corner are one
// body. Outside cells are labelled -1. Iterative with an explicit stack: no recursion depth limit.
export function labelWaterBodies(inside:Uint8Array,distance:Float64Array,columns:number,rows:number):WaterBodyLabels{
 const labels=new Int32Array(columns*rows).fill(-1),bodies:WaterBodyStats[]=[],stack:number[]=[];
 for(let start=0;start<inside.length;start++){
  if(!inside[start]||labels[start]!==-1)continue;
  const id=bodies.length;
  let cellCount=0,maxDistanceCells=0;
  labels[start]=id;stack.push(start);
  while(stack.length){
   const i=stack.pop()!,row=Math.floor(i/columns),column=i-row*columns;
   cellCount++;
   if(distance[i]>maxDistanceCells)maxDistanceCells=distance[i];
   for(let dy=-1;dy<=1;dy++){
    const r=row+dy;
    if(r<0||r>=rows)continue;
    for(let dx=-1;dx<=1;dx++){
     const c=column+dx;
     if((dx===0&&dy===0)||c<0||c>=columns)continue;
     const j=r*columns+c;
     if(inside[j]&&labels[j]===-1){labels[j]=id;stack.push(j)}
    }
   }
  }
  bodies.push({id,cellCount,maxDistanceCells});
 }
 return {labels,bodies};
}
