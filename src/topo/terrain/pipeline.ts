import type {MultiPolygonMm} from '../../geometry/shoreline/polygonEngine';
import type {CapturedWater} from '../../ornament/capture/featureTypes';
import {unionAll} from '../../ornament/geometry/polygonRepair';
import type {WaterGeometryMetrics} from '../../ornament/geometry/waterGeometry';
import {buildBoardWater} from '../features/water';
import {buildTerrainBands,type TerrainBandOptions,type TerrainBandSettings,type TerrainBands} from './bands';
import {buildMosaic,resampleToBoard,workingGridSpec} from './elevationGrid';
import {TerrainError} from './errors';
import {smoothGrid} from './smooth';
import {frameBounds,planTerrainTiles,type GeoBounds,type TilePlan} from './tiles';

// The whole terrain generation, as one pure function of serializable input: the frozen view, the
// tile bytes, water, and settings in; bands, contours and diagnostics out. The worker runs exactly
// this, the inline fallback runs exactly this, and the golden tests run exactly this.
//
// Fetching is not in here. Tiles are downloaded on the page (fetchTiles.ts) — network I/O does not
// block a thread — and handed over as bytes, which keeps this function deterministic and testable
// without a network.

// The plan: "At generation time, freeze center, zoom, geographic bounds, CSS canvas size, and output
// size." The crop frame's CSS size stands in for the canvas size: it is the part of the map that
// becomes the board.
export interface FrozenTerrainView{
 center:[number,number];
 zoom:number;
 frameWidthPx:number;
 frameHeightPx:number;
 widthMm:number;
 heightMm:number;
 bounds:GeoBounds;
}

export function freezeTerrainView(center:[number,number],zoom:number,frameWidthPx:number,widthMm:number,heightMm:number):FrozenTerrainView{
 if(!(frameWidthPx>0)||!(widthMm>0)||!(heightMm>0))throw new TerrainError('invalid-view','The crop frame has no size, so there is no area to generate.');
 // The frame's height follows from its width and the board's proportions rather than from layout,
 // so a fractional CSS pixel of rounding in the frame cannot skew the board.
 const frameHeightPx=frameWidthPx*heightMm/widthMm;
 return {center:[center[0],center[1]],zoom,frameWidthPx,frameHeightPx,widthMm,heightMm,bounds:frameBounds(center,zoom,frameWidthPx,frameHeightPx)};
}

export const DEFAULT_SMOOTHING_RADIUS=3;

export interface TerrainSettings extends TerrainBandSettings{
 // Gaussian radius in working-grid samples (smooth.ts). 0 disables smoothing.
 smoothingRadius:number;
 // Overrides the working grid's long side. Tests use it to stay fast; the app leaves it unset.
 gridLongSide?:number;
}

export interface TerrainJob{
 view:FrozenTerrainView;
 // Terrarium PNG bytes keyed "z/x/y", for every tile in planTerrainTiles(view.bounds, view.zoom).
 tiles:Record<string,Uint8Array>;
 // Water already in board millimetres. Tests pass polygons here directly.
 water:MultiPolygonMm;
 // Water as captured from the map (lng/lat rings), projected and unioned here in the worker by the
 // ornament's water pipeline (features/water.ts), then joined with `water`. This is what the page
 // passes. Phase 2 had no capture, so a coastal board layered the sea floor as land.
 capturedWater?:readonly CapturedWater[];
 waterSimplifyToleranceMm?:number;
 settings:TerrainSettings;
 options?:TerrainBandOptions;
}

export type TerrainStage='decode'|'resample'|'smooth'|'water'|'bands'|'contours';

export interface TerrainResult extends TerrainBands{
 view:FrozenTerrainView;
 settings:TerrainSettings;
 grid:{columns:number;rows:number;cellMm:number;tileZoom:number;tileCount:number};
 // The water region subtracted from every layer, in board millimetres, and what building it did.
 water:MultiPolygonMm;
 waterMetrics?:WaterGeometryMetrics;
}

export const terrainTilePlan=(view:FrozenTerrainView):TilePlan=>{
 try{return planTerrainTiles(view.bounds,view.zoom)}
 catch(error){throw new TerrainError('invalid-view',(error as Error).message)}
};

export function generateTerrain(job:TerrainJob,onStage?:(stage:TerrainStage)=>void):TerrainResult{
 const {view,settings}=job;
 const plan=terrainTilePlan(view);
 onStage?.('decode');
 const mosaic=buildMosaic(plan,job.tiles);
 onStage?.('resample');
 const spec=workingGridSpec(view.widthMm,view.heightMm,settings.gridLongSide);
 const grid=resampleToBoard(mosaic,view.bounds,view.widthMm,view.heightMm,spec);
 onStage?.('smooth');
 const smoothed={...grid,values:smoothGrid(grid.values,grid.columns,grid.rows,settings.smoothingRadius)};
 let water=job.water,waterMetrics:WaterGeometryMetrics|undefined;
 if(job.capturedWater?.length){
  onStage?.('water');
  const built=buildBoardWater(job.capturedWater,view,job.waterSimplifyToleranceMm);
  water=job.water.length?unionAll([job.water,built.geometry],'Water'):built.geometry;
  waterMetrics=built.metrics;
 }
 onStage?.(settings.contoursEnabled?'contours':'bands');
 const bands=buildTerrainBands(smoothed,water,settings,job.options);
 return {...bands,view,settings,grid:{columns:grid.columns,rows:grid.rows,cellMm:grid.cellMm,tileZoom:plan.z,tileCount:plan.tiles.length},water,...(waterMetrics?{waterMetrics}:{})};
}
