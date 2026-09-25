import {createMemoryTileCache,type TileCache} from './tileCache';
import {DEFAULT_TERRAIN_TILES_URL,tileKey,tileUrl,type TileCoord} from './tilePath';

// The terrain tile proxy: one Terrarium PNG per request, from cache when possible, from AWS Open
// Data Terrain Tiles otherwise (ADR 0004). Written like the geocode handler — a plain function over
// injected fetch and cache, so it is tested without a socket or a network — and mounted by the same
// two hosts (server/index.ts and the Vite dev plugin).
//
// What it deliberately does not do: invent data. A tile the upstream does not have is a 404 with a
// reason, never a blank or sea-level tile, because the plan's rule is that a missing tile is an
// explicit error rather than silently becoming sea level in someone's terrain.

export const DEFAULT_TERRAIN_CONCURRENCY=6;
export const DEFAULT_TERRAIN_TIMEOUT_MS=15000;
// A Terrarium tile is 256×256 RGB, typically 50–150 KB. Anything far larger is not a tile.
export const MAX_TILE_BYTES=4*1024*1024;
const PNG_SIGNATURE=[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a];

export type TerrainFetchLike=(url:string,init:{headers:Record<string,string>;signal:AbortSignal})=>Promise<{ok:boolean;status:number;arrayBuffer():Promise<ArrayBuffer>}>;

export type TerrainOutcome=
 |{status:200;body:Uint8Array;cache:'hit'|'miss'}
 |{status:404|502|504;error:string;code:'missing-tile'|'upstream-failed'|'upstream-timeout'|'not-a-png'};

export type TerrainTileHandler=(tile:TileCoord)=>Promise<TerrainOutcome>;

export interface TerrainHandlerOptions{
 fetchImpl?:TerrainFetchLike;
 cache?:TileCache;
 concurrency?:number;
 timeoutMs?:number;
 urlTemplate?:string;
 userAgent?:string;
}

// At most `limit` tasks run at once; the rest wait in arrival order. The geocoder's rate limiter
// serializes with a minimum interval, which is Nominatim's policy; tiles have no per-request
// policy, only a need not to open dozens of sockets at once, so this is a plain semaphore.
export function createSemaphore(limit:number){
 let active=0;
 const waiting:(()=>void)[]=[];
 return {
  async run<T>(task:()=>Promise<T>):Promise<T>{
   if(active>=limit)await new Promise<void>(resolve=>waiting.push(resolve));
   active++;
   try{return await task()}
   finally{active--;waiting.shift()?.()}
  },
  get active(){return active},
  get waiting(){return waiting.length},
 };
}

const isPng=(bytes:Uint8Array)=>bytes.length>PNG_SIGNATURE.length&&PNG_SIGNATURE.every((b,i)=>bytes[i]===b);

export function createTerrainTileHandler(options:TerrainHandlerOptions={}):TerrainTileHandler{
 const doFetch=options.fetchImpl??(globalThis.fetch as unknown as TerrainFetchLike);
 const cache=options.cache??createMemoryTileCache();
 const semaphore=createSemaphore(Math.max(1,options.concurrency??DEFAULT_TERRAIN_CONCURRENCY));
 const timeoutMs=options.timeoutMs??DEFAULT_TERRAIN_TIMEOUT_MS;
 const template=options.urlTemplate??DEFAULT_TERRAIN_TILES_URL;
 const userAgent=options.userAgent??'LayeredMapStudio-Topo/0.1.0 (self-hosted laser-map builder; terrain tile cache)';
 // Two requests for the same tile while it is being fetched share one upstream call.
 const inFlight=new Map<string,Promise<TerrainOutcome>>();

 const fetchTile=async(tile:TileCoord):Promise<TerrainOutcome>=>{
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
   const response=await doFetch(tileUrl(template,tile),{headers:{'User-Agent':userAgent},signal:controller.signal});
   // S3 answers 403, not 404, for a key that does not exist when listing is not public.
   if(response.status===404||response.status===403)return {status:404,code:'missing-tile',error:`Terrain tile ${tileKey(tile)} does not exist upstream (HTTP ${response.status}).`};
   if(!response.ok)return {status:502,code:'upstream-failed',error:`Terrain tile ${tileKey(tile)}: upstream returned HTTP ${response.status}.`};
   const bytes=new Uint8Array(await response.arrayBuffer());
   if(bytes.length>MAX_TILE_BYTES||!isPng(bytes))return {status:502,code:'not-a-png',error:`Terrain tile ${tileKey(tile)}: upstream did not return a PNG.`};
   await cache.set(tile,bytes).catch(()=>{/* a cache that cannot write still serves the tile */});
   return {status:200,body:bytes,cache:'miss'};
  }catch(error){
   if(controller.signal.aborted)return {status:504,code:'upstream-timeout',error:`Terrain tile ${tileKey(tile)}: upstream did not respond within ${timeoutMs}ms.`};
   return {status:502,code:'upstream-failed',error:`Terrain tile ${tileKey(tile)}: upstream could not be reached: ${(error as Error)?.message??'unknown error'}`};
  }finally{
   clearTimeout(timer);
  }
 };

 return async function handleTerrainTile(tile:TileCoord):Promise<TerrainOutcome>{
  const cached=await cache.get(tile).catch(()=>undefined);
  if(cached&&isPng(cached))return {status:200,body:cached,cache:'hit'};
  const key=tileKey(tile),pending=inFlight.get(key);
  if(pending)return pending;
  const request=semaphore.run(()=>fetchTile(tile)).finally(()=>inFlight.delete(key));
  inFlight.set(key,request);
  return request;
 };
}
