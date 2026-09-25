import {TerrainError} from './errors';
import {decodeTerrariumPng,type DecodedTerrainTile} from './terrarium';
import {TERRARIUM_TILE_SIZE,mercatorX,mercatorY,tileKey,type GeoBounds,type TilePlan} from './tiles';

// Mosaic → crop → resample: Terrarium tiles in, an elevation grid in board millimetres out (plan
// §Terrain acquisition).
//
// The working grid has square cells laid over the board with its sample centres at
// origin + (i+½)·cell, the layout nestedBands' SampleGrid uses. It deliberately extends one cell
// past every board edge: band rings then close outside the board and the clip to the board cuts them
// exactly at its edge, instead of leaving a half-cell sliver between a band and the edge. The tiles'
// padding ring is what makes those extra samples real data rather than extrapolation.
//
// Resolution: the plan's "width near 900 samples for the default 9-inch square, scaling modestly
// with output perimeter" — the long side is 900·√(perimeter / 914.4 mm) — under a hard budget of
// WORKING_GRID.maxSamples so a 600 mm board cannot exhaust memory.

export const WORKING_GRID={baseSamples:900,basePerimeterMm:914.4,minLongSide:32,maxSamples:2_000_000};

export interface WorkingGridSpec{columns:number;rows:number;cellMm:number;originXMm:number;originYMm:number}

export function workingGridSpec(widthMm:number,heightMm:number,longSide?:number):WorkingGridSpec{
 if(!(widthMm>0&&heightMm>0))throw new TerrainError('invalid-view',`Board size ${widthMm}×${heightMm} mm is not valid.`);
 const perimeter=2*(widthMm+heightMm);
 const long=Math.max(WORKING_GRID.minLongSide,Math.round(longSide??WORKING_GRID.baseSamples*Math.sqrt(perimeter/WORKING_GRID.basePerimeterMm)));
 const dims=(cell:number)=>[Math.ceil(widthMm/cell-1e-9)+2,Math.ceil(heightMm/cell-1e-9)+2];
 let cell=Math.max(widthMm,heightMm)/long,[columns,rows]=dims(cell);
 while(columns*rows>WORKING_GRID.maxSamples){cell*=Math.max(1.001,Math.sqrt(columns*rows/WORKING_GRID.maxSamples));[columns,rows]=dims(cell)}
 return {columns,rows,cellMm:cell,originXMm:(widthMm-columns*cell)/2,originYMm:(heightMm-rows*cell)/2};
}

export interface ElevationGrid extends WorkingGridSpec{
 widthMm:number;heightMm:number;
 // Row-major elevations in metres, one per sample.
 values:Float32Array;
 // Samples clamped to the plausible range while decoding (terrarium.ts), summed over the tiles.
 clampedSamples:number;
}

export interface Mosaic{z:number;x0:number;y0:number;width:number;height:number;values:Float32Array;clampedSamples:number}

// Decode every planned tile and lay them side by side. A tile absent from `tiles` is an error that
// names it — never a hole filled with a default.
export function buildMosaic(plan:TilePlan,tiles:Readonly<Record<string,Uint8Array>>):Mosaic{
 const size=TERRARIUM_TILE_SIZE,width=plan.columns*size,height=plan.rows*size;
 const values=new Float32Array(width*height);
 let clampedSamples=0;
 const decoded=new Map<string,DecodedTerrainTile>();
 for(const tile of plan.tiles){
  const key=tileKey(tile);
  let data=decoded.get(key);
  if(!data){
   const bytes=tiles[key];
   if(!bytes)throw new TerrainError('missing-tile',`Elevation tile ${key} is missing, so this area cannot be generated. It was not replaced with sea level.`);
   try{data=decodeTerrariumPng(bytes)}catch(error){throw new TerrainError('invalid-tile',`Elevation tile ${key} could not be decoded: ${(error as Error).message}`)}
   if(data.size!==size)throw new TerrainError('invalid-tile',`Elevation tile ${key} is ${data.size} px; Terrarium tiles are ${size} px.`);
   decoded.set(key,data);
   clampedSamples+=data.clampedSamples;
  }
  const left=tile.column*size,top=tile.row*size;
  for(let y=0;y<size;y++)values.set(data.elevations.subarray(y*size,(y+1)*size),(top+y)*width+left);
 }
 return {z:plan.z,x0:plan.x0,y0:plan.y0,width,height,values,clampedSamples};
}

// Bilinear sample of the mosaic at fractional pixel (px, py), measured from its top-left corner with
// pixel centres at half-integers. Clamped at the mosaic edge; the padding ring keeps every board
// sample well inside it except against the poles.
function sampleMosaic(m:Mosaic,px:number,py:number):number{
 const fx=Math.min(m.width-1,Math.max(0,px-.5)),fy=Math.min(m.height-1,Math.max(0,py-.5));
 const x0=Math.floor(fx),y0=Math.floor(fy),x1=Math.min(m.width-1,x0+1),y1=Math.min(m.height-1,y0+1);
 const tx=fx-x0,ty=fy-y0,v=m.values,w=m.width;
 const top=v[y0*w+x0]*(1-tx)+v[y0*w+x1]*tx,bottom=v[y1*w+x0]*(1-tx)+v[y1*w+x1]*tx;
 return top*(1-ty)+bottom*ty;
}

// Crop and resample. The board maps linearly onto the frozen bounds in Web Mercator — x on
// longitude, y on Mercator y — which is exactly how the bearing-0 map displays them, so a board
// millimetre and the map pixel under the crop frame are the same place.
export function resampleToBoard(mosaic:Mosaic,bounds:GeoBounds,widthMm:number,heightMm:number,spec:WorkingGridSpec):ElevationGrid{
 const scale=TERRARIUM_TILE_SIZE*2**mosaic.z;
 const mx0=mercatorX(bounds.west),mx1=mercatorX(bounds.east),my0=mercatorY(bounds.north),my1=mercatorY(bounds.south);
 const values=new Float32Array(spec.columns*spec.rows);
 const px=new Float64Array(spec.columns);
 for(let c=0;c<spec.columns;c++){
  const xMm=spec.originXMm+(c+.5)*spec.cellMm;
  px[c]=(mx0+xMm/widthMm*(mx1-mx0))*scale-mosaic.x0*TERRARIUM_TILE_SIZE;
 }
 for(let r=0;r<spec.rows;r++){
  const yMm=spec.originYMm+(r+.5)*spec.cellMm;
  const py=(my0+yMm/heightMm*(my1-my0))*scale-mosaic.y0*TERRARIUM_TILE_SIZE;
  for(let c=0;c<spec.columns;c++)values[r*spec.columns+c]=sampleMosaic(mosaic,px[c],py);
 }
 return {...spec,widthMm,heightMm,values,clampedSamples:mosaic.clampedSamples};
}
