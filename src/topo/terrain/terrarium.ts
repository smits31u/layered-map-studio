import {decodePng} from './png';

// Terrarium elevation encoding (Mapzen / AWS Open Data Terrain Tiles): each pixel stores elevation
// in metres as
//   elevation = R·256 + G + B/256 − 32768
// so the range is −32768 to +32767.996 m in steps of 1/256 m. The plan quotes the same formula.

export const terrariumElevation=(r:number,g:number,b:number)=>r*256+g+b/256-32768;

// Values outside Earth's surface range are data faults, not terrain. The plan: "Clamp clearly
// invalid values only after recording a warning." Challenger Deep is about −10,935 m and Everest
// 8,849 m; these bounds leave margin on both.
export const PLAUSIBLE_ELEVATION_M={min:-11500,max:9000};

export interface DecodedTerrainTile{
 size:number;
 // Row-major, size×size. Float32 is exact here: 24 mantissa bits cover ±32768 m at 1/256 m.
 elevations:Float32Array;
 clampedSamples:number;
}

export class TerrainTileError extends Error{
 constructor(message:string){super(message);this.name='TerrainTileError'}
}

export function decodeTerrariumRgba(rgba:Uint8Array,width:number,height:number):DecodedTerrainTile{
 if(width!==height)throw new TerrainTileError(`Terrain tiles are square; this one is ${width}×${height}.`);
 if(rgba.length<width*height*4)throw new TerrainTileError('Terrain tile pixel data is shorter than its dimensions.');
 const elevations=new Float32Array(width*height);
 let clampedSamples=0;
 for(let p=0;p<width*height;p++){
  let e=terrariumElevation(rgba[p*4],rgba[p*4+1],rgba[p*4+2]);
  if(e<PLAUSIBLE_ELEVATION_M.min){e=PLAUSIBLE_ELEVATION_M.min;clampedSamples++}
  else if(e>PLAUSIBLE_ELEVATION_M.max){e=PLAUSIBLE_ELEVATION_M.max;clampedSamples++}
  elevations[p]=e;
 }
 return {size:width,elevations,clampedSamples};
}

export const decodeTerrariumPng=(bytes:Uint8Array):DecodedTerrainTile=>{const {width,height,rgba}=decodePng(bytes);return decodeTerrariumRgba(rgba,width,height)};
