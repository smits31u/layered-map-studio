import ClipperLib from 'clipper-lib';
import type {MultiPolygonMm} from '../shoreline/polygonEngine';
import {simplifyLine,simplifyRing} from '../../ornament/geometry/simplify';
import {chaikinRing} from './contourGeometry';
import {traceContourLines} from './marchingSquares';
import {CONTOUR_CLIPPER_SCALE,gridPointToMm,toPaths,type ClipperPath,type SampleGrid} from './nestedBands';

// Contour centerlines: the plan's "optional contour centerlines with marching squares at evenly
// spaced elevation values … chain segments, smooth lightly, simplify, and clip".
//
// Unlike nested bands these are lines, not areas, so a contour that runs off the edge of the grid is
// an open polyline that simply ends there (traceContourLines) rather than being closed around the
// outside. Per elevation:
//   1. trace (asymptotic decider on saddles, the same marching squares as the bands)
//   2. simplify in mm with the ornament's Douglas–Peucker (simplifyLine / simplifyRing)
//   3. optional single Chaikin pass; open lines keep their endpoints so they still reach the edge
//   4. clip to the caller's area (the land: board minus water) as Clipper open paths, so lines stop
//      exactly at the board edge and at every shoreline
//   5. fragments shorter than minLengthMm dropped — too short to read or cut as a line
//
// Contour lines at different elevations do not cross in raw form. Simplification and smoothing can
// bring two very close lines into contact; for engraved centerlines that is cosmetic, so unlike the
// band pipeline there is no crossing fallback here.

export type LineMm=[number,number][];

export interface ContourLineOptions{simplifyToleranceMm:number;smooth:boolean;minLengthMm:number}
export const DEFAULT_CONTOUR_LINE_OPTIONS:ContourLineOptions={simplifyToleranceMm:.04,smooth:true,minLengthMm:1};

export interface ContourLineLevel{elevation:number;lines:LineMm[];rawLineCount:number;vertexCount:number;lengthMm:number}

// One Chaikin pass on an open polyline, endpoints fixed: interior corners are cut exactly as
// chaikinRing cuts them, and the first and last points stay where they are.
export function chaikinLine(line:LineMm):LineMm{
 const n=line.length;
 if(n<3)return line.slice();
 const out:LineMm=[[line[0][0],line[0][1]]];
 for(let i=0;i<n-1;i++){
  const [px,py]=line[i],[qx,qy]=line[i+1];
  if(i>0)out.push([.75*px+.25*qx,.75*py+.25*qy]);
  if(i<n-2)out.push([.25*px+.75*qx,.25*py+.75*qy]);
 }
 out.push([line[n-1][0],line[n-1][1]]);
 return out;
}

export const lineLengthMm=(line:LineMm)=>{let sum=0;for(let i=1;i<line.length;i++)sum+=Math.hypot(line[i][0]-line[i-1][0],line[i][1]-line[i-1][1]);return sum};

const toOpenPath=(line:LineMm):ClipperPath=>line.map(([x,y])=>({X:Math.round(x*CONTOUR_CLIPPER_SCALE),Y:Math.round(y*CONTOUR_CLIPPER_SCALE)}));

// Open-path intersection with a polygon area. `area` must be valid (non-overlapping rings, holes
// inside outlines), which is what the band pipeline produces, so even/odd reads it correctly.
export function clipLinesToArea(lines:readonly LineMm[],area:MultiPolygonMm):LineMm[]{
 if(!lines.length||!area.length)return [];
 const clipper=new ClipperLib.Clipper(),tree=new ClipperLib.PolyTree();
 for(const line of lines){const path=toOpenPath(line);if(path.length>=2)clipper.AddPath(path,ClipperLib.PolyType.ptSubject,false)}
 clipper.AddPaths(toPaths(area),ClipperLib.PolyType.ptClip,true);
 if(!clipper.Execute(ClipperLib.ClipType.ctIntersection,tree,ClipperLib.PolyFillType.pftNonZero,ClipperLib.PolyFillType.pftEvenOdd))throw new Error('Contour lines: clipping failed.');
 return ClipperLib.Clipper.OpenPathsFromPolyTree(tree).filter(path=>path.length>=2).map(path=>path.map(p=>[p.X/CONTOUR_CLIPPER_SCALE,p.Y/CONTOUR_CLIPPER_SCALE] as [number,number]));
}

export function extractContourLines(grid:SampleGrid,elevations:readonly number[],clipTo:MultiPolygonMm,input:Partial<ContourLineOptions>={}):ContourLineLevel[]{
 const options={...DEFAULT_CONTOUR_LINE_OPTIONS,...input};
 const sorted=[...new Set(elevations.filter(Number.isFinite))].sort((a,b)=>a-b);
 return sorted.map(elevation=>{
  const raw=traceContourLines(grid.values,grid.columns,grid.rows,elevation);
  const shaped=raw.map(line=>{
   const mm:LineMm=line.points.map(point=>gridPointToMm(grid,point));
   if(line.closed){
    const simplified=simplifyRing(mm,options.simplifyToleranceMm);
    return options.smooth?chaikinRing(simplified):simplified;
   }
   const simplified=simplifyLine(mm,options.simplifyToleranceMm);
   return options.smooth?chaikinLine(simplified):simplified;
  });
  const lines=clipLinesToArea(shaped,clipTo).filter(line=>lineLengthMm(line)>=options.minLengthMm);
  return {elevation,lines,rawLineCount:raw.length,vertexCount:lines.reduce((sum,line)=>sum+line.length,0),lengthMm:lines.reduce((sum,line)=>sum+lineLengthMm(line),0)};
 });
}
