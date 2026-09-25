import {MERCATOR_MAX_LATITUDE} from '../types';

// Web Mercator and XYZ tile arithmetic for terrain acquisition (plan §Terrain acquisition).
//
// Positions are normalised Mercator: x in [0,1) left to right across the antimeridian-cut world, y in
// [0,1] top (north) to bottom. A tile pixel at zoom z is that times TILE_SIZE·2^z.

export const TERRARIUM_TILE_SIZE=256;
// Tiles are requested at clamp(floor(mapZoom), 5, 14) (the plan).
export const TERRAIN_ZOOM_MIN=5,TERRAIN_ZOOM_MAX=14;
// A board fills part of one screen, so a generation needs a few dozen tiles at most. Past this the
// view is not what the tool is for, and the request is refused rather than queued.
export const MAX_TERRAIN_TILES=64;
// MapLibre's own tile size, for turning a map zoom and a frame in CSS pixels into geographic bounds.
export const MAPLIBRE_WORLD_TILE=512;

export interface GeoBounds{west:number;south:number;east:number;north:number}
export interface TileRef{z:number;x:number;y:number}

export const terrainZoomFor=(mapZoom:number)=>Math.min(TERRAIN_ZOOM_MAX,Math.max(TERRAIN_ZOOM_MIN,Math.floor(mapZoom)));

const clampLat=(lat:number)=>Math.max(-MERCATOR_MAX_LATITUDE,Math.min(MERCATOR_MAX_LATITUDE,lat));
export const mercatorX=(lng:number)=>(lng+180)/360;
export const mercatorY=(lat:number)=>{const phi=clampLat(lat)*Math.PI/180;return (1-Math.log(Math.tan(phi)+1/Math.cos(phi))/Math.PI)/2};
export const lngOfMercatorX=(x:number)=>x*360-180;
export const latOfMercatorY=(y:number)=>Math.atan(Math.sinh(Math.PI*(1-2*y)))*180/Math.PI;

export const tileKey=({z,x,y}:TileRef)=>`${z}/${x}/${y}`;
const wrapX=(x:number,z:number)=>{const n=2**z;return ((x%n)+n)%n};

// The geographic bounds of a frame of `widthPx`×`heightPx` CSS pixels centred on the map centre, at a
// bearing-0, pitch-0 map zoom. Pure arithmetic, so it does not depend on MapLibre's unproject and is
// exactly reproducible from the frozen centre and zoom. East may exceed 180 when the frame crosses
// the antimeridian; it is kept unwrapped so west < east always holds.
export function frameBounds(center:[number,number],mapZoom:number,widthPx:number,heightPx:number):GeoBounds{
 const world=MAPLIBRE_WORLD_TILE*2**mapZoom;
 const cx=mercatorX(center[0]),cy=mercatorY(center[1]);
 const dx=widthPx/2/world,dy=heightPx/2/world;
 return {west:lngOfMercatorX(cx-dx),east:lngOfMercatorX(cx+dx),north:latOfMercatorY(Math.max(0,cy-dy)),south:latOfMercatorY(Math.min(1,cy+dy))};
}

export interface TilePlan{
 z:number;
 // The mosaic spans unwrapped tile columns x0 … x0+columns−1 and rows y0 … y0+rows−1.
 x0:number;y0:number;columns:number;rows:number;
 // Every tile to fetch, `x` wrapped into the world; `column`/`row` place it in the mosaic.
 tiles:(TileRef&{column:number;row:number})[];
}

// The tiles covering `bounds` at the terrain zoom, plus a one-tile padding ring (the plan: "to avoid
// edge artifacts" — resampling and smoothing near the board edge read pixels beyond it). Rows are
// not padded past the poles; columns wrap across the antimeridian.
export function planTerrainTiles(bounds:GeoBounds,mapZoom:number,padding=1):TilePlan{
 const {west,south,east,north}=bounds;
 if(![west,south,east,north,mapZoom].every(Number.isFinite)||!(east>west)||!(north>south))throw new Error('Terrain: the frozen view has invalid bounds.');
 const z=terrainZoomFor(mapZoom),n=2**z;
 const eps=1e-9;
 const xa=Math.floor(mercatorX(west)*n),xb=Math.floor(mercatorX(east)*n-eps);
 const ya=Math.floor(mercatorY(north)*n),yb=Math.floor(mercatorY(south)*n-eps);
 const x0=xa-padding,x1=xb+padding,y0=Math.max(0,ya-padding),y1=Math.min(n-1,yb+padding);
 const columns=x1-x0+1,rows=y1-y0+1;
 if(columns*rows>MAX_TERRAIN_TILES)throw new Error(`Terrain: this view needs ${columns*rows} tiles, more than the ${MAX_TERRAIN_TILES} allowed. Zoom in.`);
 const tiles:TilePlan['tiles']=[];
 for(let row=0;row<rows;row++)for(let column=0;column<columns;column++)tiles.push({z,x:wrapX(x0+column,z),y:y0+row,column,row});
 return {z,x0,y0,columns,rows,tiles};
}
