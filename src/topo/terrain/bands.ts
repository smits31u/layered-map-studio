import ClipperLib from 'clipper-lib';
import type {MultiPolygonMm} from '../../geometry/shoreline/polygonEngine';
import {extractContourLines,type ContourLineLevel,type ContourLineOptions} from '../../geometry/terrain/contourLines';
import {areaMm2,clip,extractNestedBands,toPath,vertexCount,type ClipperPath,type ContourOptions,type SampleGrid} from '../../geometry/terrain/nestedBands';
import {rasterizeShoreline} from '../../geometry/terrain/terrainRaster';
import type {ElevationGrid} from './elevationGrid';

// Terrain bands and contours from an elevation grid (plan §Terrain bands and contours).
//
//   layer 1   the board minus water — "the base layer covers the entire land area"
//   layer k   land at or above the elevation that the user's coverage target for layer k puts there:
//             coverage p% becomes the threshold t with p% of the land samples at or above it
//   contours  centerlines at evenly spaced elevations between the land's lowest and highest samples
//
// Layers 2–4 come from the same nested-band machinery as the lake tool's depth contours
// (nestedBands.ts), with nothing treated as lying outside the grid (outside = −∞): elevations can be
// negative (below sea level) or zero, and neither may be special. Each band is clipped against the
// one below it and the first against layer 1, so water is subtracted from every layer and layer 4 ⊂
// 3 ⊂ 2 ⊂ 1 holds exactly (assertLevelChain checks it before anything is returned).
//
// Water is a parameter. Phase 2 has no vector capture yet, so the UI passes none; the coastal golden
// fixture passes polygons directly. Water samples are left out of the quantiles and the elevation
// range: coverage is a share of the land, and a sea floor must not drag the thresholds down.

export const FLAT_AREA_RANGE_M=30;

export interface TerrainBandSettings{
 layerCount:1|2|3|4;
 coveragePercent:readonly [100,number,number,number];
 contoursEnabled:boolean;
 contourCount:number;
}

export interface TerrainLayer{
 index:number;
 targetCoveragePercent:number;
 // null for layer 1, which is all land whatever its elevation.
 thresholdM:number|null;
 geometry:MultiPolygonMm;
 areaMm2:number;
 // Share of the land area this layer actually covers, after shaping and clipping.
 coveragePercent:number;
 vertexCount:number;
}

export type TerrainWarning=
 |{code:'flat-area';rangeM:number;message:string}
 |{code:'clamped-elevations';samples:number;message:string}
 |{code:'no-land';message:string};

export interface TerrainBands{
 widthMm:number;heightMm:number;
 land:MultiPolygonMm;
 layers:TerrainLayer[];
 contours:ContourLineLevel[];
 elevation:{minM:number;maxM:number;rangeM:number;landSamples:number};
 warnings:TerrainWarning[];
}

export interface TerrainBandOptions{band?:Partial<ContourOptions>;line?:Partial<ContourLineOptions>}

export const boardRectangle=(widthMm:number,heightMm:number):MultiPolygonMm=>[[[[0,0],[widthMm,0],[widthMm,heightMm],[0,heightMm],[0,0]]]];

// Rings wound the way Clipper's non-zero rule expects for their role, so overlapping water polygons
// (a river over a lake, duplicates across tiles) union rather than cancel.
function orientedPaths(geometry:MultiPolygonMm):ClipperPath[]{
 const out:ClipperPath[]=[];
 for(const polygon of geometry)polygon.forEach((ring,index)=>{
  const path=toPath(ring);
  if(path.length<3)return;
  if(ClipperLib.Clipper.Orientation(path)!==(index===0))path.reverse();
  out.push(path);
 });
 return out;
}

export function landArea(widthMm:number,heightMm:number,water:MultiPolygonMm):MultiPolygonMm{
 const board=boardRectangle(widthMm,heightMm);
 if(!water.length)return board;
 return clip(ClipperLib.ClipType.ctDifference,board,orientedPaths(water),ClipperLib.PolyFillType.pftNonZero,'land','Terrain bands');
}

// The threshold with (at least) p of the sorted samples at or above it: the ⌈p·n⌉-th largest.
export function quantileThreshold(sortedAscending:ArrayLike<number>,fraction:number):number{
 const n=sortedAscending.length;
 if(!n)throw new Error('Terrain bands: no land samples to take a quantile of.');
 const k=Math.min(n,Math.max(1,Math.ceil(fraction*n)));
 return sortedAscending[n-k];
}

export function contourElevations(minM:number,maxM:number,count:number):number[]{
 if(!(maxM>minM)||count<1)return [];
 return Array.from({length:count},(_,i)=>minM+(i+1)*(maxM-minM)/(count+1));
}

export function buildTerrainBands(grid:ElevationGrid,water:MultiPolygonMm,settings:TerrainBandSettings,options:TerrainBandOptions={}):TerrainBands{
 const {widthMm,heightMm,columns,rows,cellMm,originXMm,originYMm}=grid;
 const sampleGrid:SampleGrid={values:grid.values,columns,rows,originXMm,originYMm,cellWidthMm:cellMm,cellHeightMm:cellMm};
 const warnings:TerrainWarning[]=[];
 const land=landArea(widthMm,heightMm,water);
 const landTotal=areaMm2(land);

 // Samples counted as land: centre on the board and not in water.
 const wet=water.length?rasterizeShoreline(water,{columns,rows,cellMm,originXMm,originYMm}):undefined;
 const picked:number[]=[];
 for(let r=0;r<rows;r++){
  const y=originYMm+(r+.5)*cellMm;
  if(y<0||y>heightMm)continue;
  for(let c=0;c<columns;c++){
   const x=originXMm+(c+.5)*cellMm,i=r*columns+c;
   if(x<0||x>widthMm||wet?.[i])continue;
   picked.push(grid.values[i]);
  }
 }
 const sorted=Float64Array.from(picked).sort();
 const layer1:TerrainLayer={index:1,targetCoveragePercent:100,thresholdM:null,geometry:land,areaMm2:landTotal,coveragePercent:landTotal>0?100:0,vertexCount:vertexCount(land)};
 if(!sorted.length||!land.length){
  warnings.push({code:'no-land',message:'There is no land inside the board, so there is no terrain to layer.'});
  return {widthMm,heightMm,land,layers:[layer1],contours:[],elevation:{minM:NaN,maxM:NaN,rangeM:0,landSamples:0},warnings};
 }
 const minM=sorted[0],maxM=sorted[sorted.length-1],rangeM=maxM-minM;
 if(rangeM<FLAT_AREA_RANGE_M)warnings.push({code:'flat-area',rangeM,message:`Very flat area: the land inside the board varies by only ${rangeM.toFixed(1)} m, so the layers and contours will show very little relief. You can still export it.`});
 if(grid.clampedSamples>0)warnings.push({code:'clamped-elevations',samples:grid.clampedSamples,message:`${grid.clampedSamples.toLocaleString('en-US')} elevation samples were outside Earth's surface range and were clamped. The terrain source may have a fault in this area.`});

 const layers=[layer1];
 const wanted=settings.coveragePercent.slice(1,settings.layerCount);
 if(wanted.length){
  const thresholds=wanted.map(p=>quantileThreshold(sorted,p/100));
  const bands=extractNestedBands(sampleGrid,thresholds,land,options.band,-Infinity,'Terrain bands');
  wanted.forEach((target,i)=>{
   const level=bands.levels.find(l=>l.threshold===thresholds[i])!;
   layers.push({index:i+2,targetCoveragePercent:target,thresholdM:thresholds[i],geometry:level.geometry,areaMm2:level.areaMm2,coveragePercent:landTotal>0?level.areaMm2/landTotal*100:0,vertexCount:level.vertexCount});
  });
 }
 const contours=settings.contoursEnabled?extractContourLines(sampleGrid,contourElevations(minM,maxM,settings.contourCount),land,options.line):[];
 return {widthMm,heightMm,land,layers,contours,elevation:{minM,maxM,rangeM,landSamples:sorted.length},warnings};
}
