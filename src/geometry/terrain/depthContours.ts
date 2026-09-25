import type {MultiPolygonMm,RingMm} from '../shoreline/polygonEngine';
import type {DepthTerrain} from './depthTerrain';
import {traceContourRings,type IndexRing} from './marchingSquares';
import {areaMm2,assertLevelChain,nestedBandLevel,normalizeContourOptions,vertexCount,type ContourOptions,type ContourStats} from './nestedBands';

// Phase B: turns a Phase A depth grid into nested contour polygons, one set per requested depth
// threshold per water body. Pure and UI-independent, like Phase A. See docs/depth-terrain.md.
//
// The per-level machinery — simplify, smooth, crossing fallback, hole assignment, the eroded
// Clipper clip that makes nesting exact, and the independent nesting check — lives in
// nestedBands.ts, where the topo builder's elevation bands use it too. It was moved there verbatim;
// what stays here is what is specific to depth: thresholds restricted to (0, 1], the grid's outside
// read as 0 (the shore), and one chain of levels per water body, each starting from the shoreline.
//
// Thresholds are absolute depths on the same 0–1 scale as DepthTerrain.depth, so a threshold is the
// same depth in every body. A body shallower than a threshold has no contour at it. A dropped body
// (Phase A's minBodyCells) is depth 0 everywhere and never has contours.
//
// Output rings are closed, outer rings wind positive (shoelace) and holes negative.

export {CONTOUR_CLIPPER_SCALE,DEFAULT_CONTOUR_OPTIONS,NESTING_MARGIN_MM,NESTING_MARGIN_UNITS,normalizeContourOptions} from './nestedBands';
export type {ContourOptions,ContourStats} from './nestedBands';

export interface ContourLevel{
 threshold:number;
 geometry:MultiPolygonMm;
 areaMm2:number;
 vertexCount:number;
 // Rings marching squares produced for this body at this threshold, before any processing.
 rawRingCount:number;
}
export interface BodyContours{bodyId:number;levels:ContourLevel[]}
export interface DepthContours{thresholds:number[];options:ContourOptions;bodies:BodyContours[];stats:ContourStats}

// Thresholds are a geometry request rather than a style parameter: a bad one is refused, not
// clamped. Quietly dropping or moving a requested layer would produce a different stack of cuts
// than the one asked for. Returned sorted ascending with duplicates removed.
export function normalizeThresholds(thresholds:readonly number[]):number[]{
 if(!thresholds.length)throw new Error('Depth contours: no thresholds requested.');
 for(const t of thresholds)if(!(typeof t==='number'&&Number.isFinite(t)&&t>0&&t<=1))throw new Error(`Depth contours: threshold ${t} is not a depth in (0, 1].`);
 return [...new Set(thresholds)].sort((a,b)=>a-b);
}

export function extractDepthContours(terrain:DepthTerrain,shoreline:MultiPolygonMm,thresholds:readonly number[],input:Partial<ContourOptions>={}):DepthContours{
 const options=normalizeContourOptions(input),levels=normalizeThresholds(thresholds);
 const {grid}=terrain,stats:ContourStats={simplifyFallbacks:0,smoothFallbacks:0};
 const kept=terrain.bodies.filter(body=>!body.dropped);
 const bodies:BodyContours[]=kept.map(body=>({bodyId:body.id,levels:[]}));
 const byId=new Map(bodies.map(body=>[body.bodyId,body]));
 const previous=new Map<number,MultiPolygonMm>(kept.map(body=>[body.id,shoreline]));
 const toMm=(ring:IndexRing):RingMm=>ring.points.map(([x,y])=>[grid.originXMm+(x+.5)*grid.cellMm,grid.originYMm+(y+.5)*grid.cellMm] as [number,number]);

 for(const threshold of levels){
  const raw=traceContourRings(terrain.depth,grid.columns,grid.rows,threshold,sample=>terrain.bodyId[sample]);
  const byBody=new Map<number,RingMm[]>();
  for(const ring of raw){
   if(!byId.has(ring.tag))throw new Error(`Depth contours: a contour at ${threshold} borders body ${ring.tag}, which is not a kept water body. This is a bug.`);
   const list=byBody.get(ring.tag);
   if(list)list.push(toMm(ring));else byBody.set(ring.tag,[toMm(ring)]);
  }
  for(const body of bodies){
   const rings=byBody.get(body.bodyId)??[],container=previous.get(body.bodyId)!;
   const geometry=rings.length&&container.length?nestedBandLevel(rings,container,options,stats,`body ${body.bodyId} at ${threshold}`):[];
   body.levels.push({threshold,geometry,areaMm2:areaMm2(geometry),vertexCount:vertexCount(geometry),rawRingCount:rings.length});
   previous.set(body.bodyId,geometry);
  }
 }
 const result={thresholds:levels,options,bodies,stats};
 assertNestedContours(result,shoreline);
 return result;
}

// Independent check of the output before it is returned: every coordinate finite, every ring
// closed, level 1 inside the shoreline, and every level inside the one above it for the same body,
// with exactly zero area outside. Throws rather than returning something that would cut a deeper
// layer outside a shallower one.
export function assertNestedContours(contours:DepthContours,shoreline:MultiPolygonMm):void{
 for(const body of contours.bodies)assertLevelChain(body.levels,shoreline,'the shoreline',threshold=>`body ${body.bodyId} at ${threshold}`);
}
