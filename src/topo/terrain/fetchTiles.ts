import {TerrainError} from './errors';
import {tileKey,type TilePlan} from './tiles';

// Downloads a tile plan through the /api/terrain proxy (ADR 0004): at most `concurrency` requests at
// once (the plan's "cap concurrency (start at 6)"), each with its own timeout, all cancelled together
// through one AbortSignal. The first failure aborts the rest — a generation missing any tile cannot
// be completed, so there is no point finishing the others.

export const TERRAIN_ENDPOINT='/api/terrain';
export const DEFAULT_TILE_FETCH_CONCURRENCY=6;
export const DEFAULT_TILE_FETCH_TIMEOUT_MS=20_000;

export type TileFetchLike=(url:string,init:{signal:AbortSignal})=>Promise<{ok:boolean;status:number;arrayBuffer():Promise<ArrayBuffer>;json?():Promise<unknown>}>;

export interface FetchTilesOptions{
 fetchImpl?:TileFetchLike;
 endpoint?:string;
 concurrency?:number;
 timeoutMs?:number;
 signal?:AbortSignal;
 onProgress?:(done:number,total:number)=>void;
}

export class TileFetchCancelledError extends Error{
 constructor(){super('Terrain download cancelled.');this.name='TileFetchCancelledError'}
}

async function proxyError(response:{status:number;json?():Promise<unknown>},key:string):Promise<TerrainError>{
 let body:{code?:unknown;error?:unknown}|undefined;
 try{body=(await response.json?.()) as typeof body}catch{/* not JSON */}
 if(response.status===404||body?.code==='missing-tile')return new TerrainError('missing-tile',`Elevation tile ${key} is not available from the terrain source, so this area cannot be generated. It was not replaced with sea level.`);
 const detail=typeof body?.error==='string'?` ${body.error}`:'';
 return new TerrainError('tile-fetch-failed',`Elevation tile ${key} could not be downloaded (HTTP ${response.status}).${detail}`);
}

export async function fetchTerrainTiles(plan:TilePlan,options:FetchTilesOptions={}):Promise<Record<string,Uint8Array>>{
 const doFetch=options.fetchImpl??(globalThis.fetch as unknown as TileFetchLike);
 const endpoint=options.endpoint??TERRAIN_ENDPOINT;
 const concurrency=Math.max(1,options.concurrency??DEFAULT_TILE_FETCH_CONCURRENCY);
 const timeoutMs=options.timeoutMs??DEFAULT_TILE_FETCH_TIMEOUT_MS;
 const keys=[...new Set(plan.tiles.map(tileKey))];
 const out:Record<string,Uint8Array>={};
 const stop=new AbortController();
 const outer=options.signal;
 const onOuterAbort=()=>stop.abort();
 if(outer?.aborted)throw new TileFetchCancelledError();
 outer?.addEventListener('abort',onOuterAbort);
 let next=0,done=0,failure:unknown;

 const fetchOne=async(key:string)=>{
  const perTile=new AbortController(),abort=()=>perTile.abort();
  stop.signal.addEventListener('abort',abort);
  let timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;perTile.abort()},timeoutMs);
  try{
   const response=await doFetch(`${endpoint}/${key}.png`,{signal:perTile.signal});
   if(!response.ok)throw await proxyError(response,key);
   out[key]=new Uint8Array(await response.arrayBuffer());
   done++;
   options.onProgress?.(done,keys.length);
  }catch(error){
   if(timedOut)throw new TerrainError('tile-fetch-failed',`Elevation tile ${key} did not download within ${Math.round(timeoutMs/1000)} seconds.`);
   if(error instanceof TerrainError)throw error;
   if(stop.signal.aborted)throw new TileFetchCancelledError();
   throw new TerrainError('tile-fetch-failed',`Elevation tile ${key} could not be downloaded: ${(error as Error)?.message??String(error)}`);
  }finally{
   clearTimeout(timer);
   stop.signal.removeEventListener('abort',abort);
  }
 };

 const worker=async()=>{
  while(next<keys.length&&failure===undefined){
   const key=keys[next++];
   try{await fetchOne(key)}
   catch(error){if(failure===undefined)failure=error;stop.abort()}
  }
 };
 try{
  options.onProgress?.(0,keys.length);
  await Promise.all(Array.from({length:Math.min(concurrency,keys.length)},worker));
 }finally{
  outer?.removeEventListener('abort',onOuterAbort);
 }
 if(outer?.aborted)throw new TileFetchCancelledError();
 if(failure!==undefined)throw failure;
 return out;
}
