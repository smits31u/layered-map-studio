// Terrain tile addressing for the /api/terrain proxy (ADR 0004).
//
// z, x and y arrive in a request path and leave in two places: an upstream URL and a cache file
// path. So they are validated as integers inside the tile pyramid before either use, and nothing
// else from the request ever reaches either. The pattern admits digits only — no signs, dots,
// separators or encodings — so there is no string that parses as a tile and also escapes the cache
// directory or reshapes the upstream URL.

export const TERRAIN_PATH_PREFIX='/api/terrain/';
// AWS Terrain Tiles publish Terrarium zoom levels 0–15.
export const TERRAIN_TILE_MAX_ZOOM=15;

export interface TileCoord{z:number;x:number;y:number}

const TILE_PATH=/^\/api\/terrain\/(\d{1,2})\/(\d{1,6})\/(\d{1,6})\.png$/;

export function parseTilePath(pathname:string):TileCoord|undefined{
 const match=TILE_PATH.exec(pathname);
 if(!match)return undefined;
 const [z,x,y]=match.slice(1).map(Number);
 if(!isValidTile({z,x,y}))return undefined;
 return {z,x,y};
}

export function isValidTile({z,x,y}:TileCoord):boolean{
 if(![z,x,y].every(Number.isSafeInteger))return false;
 if(z<0||z>TERRAIN_TILE_MAX_ZOOM)return false;
 const n=2**z;
 return x>=0&&x<n&&y>=0&&y<n;
}

export const tileKey=({z,x,y}:TileCoord)=>`${z}/${x}/${y}`;

export const DEFAULT_TERRAIN_TILES_URL='https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

// Only ever called with a validated TileCoord, so the substituted values are plain integers.
export const tileUrl=(template:string,{z,x,y}:TileCoord)=>template.replace('{z}',String(z)).replace('{x}',String(x)).replace('{y}',String(y));
