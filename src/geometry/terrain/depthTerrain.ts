import type {MultiPolygonMm} from '../shoreline/polygonEngine';
import {normalizeTerrainParams,type TerrainParams,type TerrainParamsInput} from './terrainParams';
import {createNoiseSampler} from './terrainNoise';
import {applyProfile,bankRemap,shelfRemap,terrace} from './terrainProfiles';
import {cellCenterX,cellCenterY,chamferDistance,labelWaterBodies,rasterizeShoreline,shorelineBounds,terrainGridSpec,type TerrainGridSpec} from './terrainRaster';

// Procedural depth-terrain generator for Artistic Depth: turns a shoreline into a grid of depth
// values (0 at the shoreline, maxDepth at the deepest cell of the largest water body). Pure and
// UI-independent: no DOM, no map, no scene, no caches — same shoreline + same params gives a
// byte-identical result. See docs/depth-terrain.md.
//
// Pipeline, per inside cell of water body b:
//   t  = shore distance normalized to b's own deepest point                        (0,1]
//   t' = t perturbed by seeded noise, enveloped so it cannot reach 0 or wander far   (0,1)
//   v  = profile(bank(shelf(t')))                                                   (0,1]
//   d  = v scaled so b's deepest cell equals maxDepth * areaScale(b)                (0,target]
//   depth = maxDepth · terrace(d / maxDepth), at the shared global benches k/N · maxDepth
// Outside cells are 0, and so is every cell of a dropped body (fewer than minBodyCells cells).
//
// Terracing comes after normalization so that every body's benches sit at the same depths —
// the depths the stacked layers are cut at — rather than each body getting its own N benches
// squeezed into its own depth range. Two rules keep a body from being terraced deeper than it was
// designed: a body whose target depth is shallower than the first bench is not terraced at all
// (it keeps its continuous depth), and no cell may snap to a bench deeper than its body's target.

// fBm averages its octaves, so its output clusters around 0.5 (standard deviation ~0.12 at the
// default settings) and used raw it barely moves the depth. It is re-centred, multiplied by this
// gain and passed through x/(1+2|x|): smooth, odd, slope 1 at 0, and strictly inside ±0.5 however
// large x gets — the bound the dry-spot guarantee below depends on. A hard clamp would do the same
// job but leave flat plateaus wherever the noise saturates.
const NOISE_GAIN=3;
export const noiseContrast=(n:number)=>{const x=(n-.5)*NOISE_GAIN;return x/(1+2*Math.abs(x))};

export interface DepthTerrainBody{
 id:number;
 cellCount:number;
 areaMm2:number;
 maxDistanceMm:number;
 // Fewer than params.minBodyCells cells: the body stays water (inside, labelled) but every cell is
 // left at depth 0, shoreline level, and areaScale and targetDepth are 0.
 dropped:boolean;
 // (cellCount / largest body's cellCount) ^ bodyScaleExponent; exactly 1 for the largest body.
 areaScale:number;
 // maxDepth * areaScale — the body's design depth. No cell is ever deeper. An un-terraced body's
 // deepest cell equals it exactly; a terraced body's deepest cells move toward the deepest global
 // bench at or below it (topBench/terraceLevels · maxDepth), all the way at full strength. The
 // largest body's bench is maxDepth itself, so it hits maxDepth exactly either way.
 targetDepth:number;
 // Whether the global benches were applied to this body. False when terracing is off, when the
 // body is dropped, or when its target is shallower than the first bench (see topBench).
 terraced:boolean;
 // The deepest bench (1..terraceLevels) this body's cells may snap to: floor(areaScale · levels).
 // 0 means the body never reaches the first bench and is left un-terraced.
 topBench:number;
}

export interface DepthTerrain{
 grid:TerrainGridSpec;
 params:TerrainParams;
 inside:Uint8Array;
 bodyId:Int32Array;
 distanceCells:Float64Array;
 depth:Float64Array;
 bodies:DepthTerrainBody[];
 warnings:string[];
}

export function generateDepthTerrain(shoreline:MultiPolygonMm,input:TerrainParamsInput={}):DepthTerrain{
 const params=normalizeTerrainParams(input);
 const bounds=shorelineBounds(shoreline),grid=terrainGridSpec(bounds,params.resolution);
 const {columns,rows,cellMm}=grid,cellCount=columns*rows;

 const inside=rasterizeShoreline(shoreline,grid);
 const distanceCells=chamferDistance(inside,columns,rows);
 const {labels:bodyId,bodies:stats}=labelWaterBodies(inside,distanceCells,columns,rows);
 const depth=new Float64Array(cellCount);
 const warnings:string[]=[];
 if(!stats.length){
  warnings.push('No grid cell centre falls inside the shoreline: it is narrower than one cell. Use a smaller cellMm.');
  return {grid,params,inside,bodyId,distanceCells,depth,bodies:[],warnings};
 }

 // Area scaling is relative to the largest body. If any body survives the size threshold, the
 // largest one does, so dropping never changes a kept body's scale.
 let largest=0;
 for(const body of stats)if(body.cellCount>largest)largest=body.cellCount;
 const bodies:DepthTerrainBody[]=stats.map(body=>{
  const dropped=body.cellCount<params.minBodyCells;
  const areaScale=dropped?0:Math.pow(body.cellCount/largest,params.bodyScaleExponent);
  // Benches are k/levels of maxDepth, so the deepest one within this body's target is
  // floor(areaScale·levels). No epsilon: a body a hair short of a bench does not reach it.
  const topBench=dropped?0:Math.min(params.terraceLevels,Math.floor(areaScale*params.terraceLevels));
  const terraced=!dropped&&params.terraceStrength>0&&topBench>=1;
  return {id:body.id,cellCount:body.cellCount,areaMm2:body.cellCount*cellMm*cellMm,maxDistanceMm:body.maxDistanceCells*cellMm,dropped,areaScale,targetDepth:params.maxDepth*areaScale,terraced,topBench};
 });
 if(bodies.every(body=>body.dropped))warnings.push(`Every water body is smaller than minBodyCells (${params.minBodyCells} cells), so the terrain is flat. Lower minBodyCells or use a smaller cellMm.`);

 // Noise is sampled in base-feature units measured from the shoreline's own bounding box, not from
 // the padded grid origin, so changing the resolution samples the same continuous field.
 const featureMm=params.featureScale*Math.max(bounds.maxX-bounds.minX,bounds.maxY-bounds.minY);
 const noise=params.noiseAmplitude>0?createNoiseSampler(params):undefined;
 const amplitude=params.noiseAmplitude,noiseHeadroom=1+amplitude/2;

 const shapedMax=new Float64Array(stats.length);
 for(let row=0;row<rows;row++){
  for(let column=0;column<columns;column++){
   const i=row*columns+column,body=bodyId[i];
   if(body<0||bodies[body].dropped)continue;
   // The shoreline runs between an inside cell and its outside neighbour, so an edge cell's centre
   // is ~half a cell from shore: measure from there, which keeps every cell of a kept body > 0.
   // maxDistanceCells >= 1 for any body, so the denominator is >= 0.5.
   let t=(distanceCells[i]-.5)/(stats[body].maxDistanceCells-.5);
   if(noise){
    // Additive noise z in (−0.5,0.5) with an envelope that ramps in over the first `amplitude` of
    // the distance: for t < amplitude the change is multiplicative (t scaled by 0.5..1.5), beyond
    // it additive (±amplitude/2). Either way t' > t/2 > 0, so noise can never open a dry spot
    // inside the water, and t' < 1 + amplitude/2, which the headroom division brings back under 1.
    // The effect is that shallow contours stay shoreline-shaped while deeper ones wander.
    const x=(cellCenterX(grid,column)-bounds.minX)/featureMm,y=(cellCenterY(grid,row)-bounds.minY)/featureMm;
    const envelope=t<amplitude?t/amplitude:1;
    t=(t+amplitude*noiseContrast(noise(x,y))*envelope)/noiseHeadroom;
   }
   const v=applyProfile(params.profile,bankRemap(shelfRemap(t,params.shelfWidth),params.bankSteepness));
   depth[i]=v;
   if(v>shapedMax[body])shapedMax[body]=v;
  }
 }

 // Per-body normalization, then terracing at the global benches. The deepest cell is assigned the
 // target outright rather than computed as v*(target/max), which can land an ulp off; every other
 // cell is scaled and clamped under it. The terraced value is clamped under the target too, so
 // floating-point rounding in the bench arithmetic can never put a cell below its design depth.
 const {maxDepth,terraceLevels,terraceStrength}=params;
 for(let i=0;i<cellCount;i++){
  const b=bodyId[i];
  if(b<0)continue;
  const body=bodies[b];
  if(body.dropped)continue;
  const max=shapedMax[b],target=body.targetDepth;
  if(!(max>0)){depth[i]=0;continue}
  const v=depth[i],normalized=v===max?target:Math.min(target,v*(target/max));
  depth[i]=body.terraced?Math.min(target,maxDepth*terrace(normalized/maxDepth,terraceLevels,terraceStrength,body.topBench)):normalized;
 }
 return {grid,params,inside,bodyId,distanceCells,depth,bodies,warnings};
}
