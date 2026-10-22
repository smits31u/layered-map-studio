import {createRateLimiter,systemClock,type Clock} from '../geocode/rateLimiter';
import {GolfSnapshotError,normalizeSnapshot,type OverpassElement} from './normalize';
import {OVERPASS_BUSY_MESSAGE,OVERPASS_DEFAULT_URL,OVERPASS_TIMEOUT_S,OverpassError,boundaryQuery,buildGolfUserAgent,featureQuery,padBbox,readOverpassReply} from './overpass';
import {createMemorySnapshotCache,snapshotKey,type SnapshotCache} from './snapshotCache';
import type {GolfOsmType,GolfSnapshot} from './types';

// The course snapshot route's logic (GET /api/golf/snapshot/:osmType/:osmId), written like the
// geocode and terrain handlers: a plain function over an injected fetch, cache and clock, so it is
// tested without a socket or a network, and mounted by both server/index.ts and the Vite dev plugin.
//
// Public Overpass rules (§2.3): one request at a time with a descriptive User-Agent and a 60 s
// timeout; a 429 or 504 is "OpenStreetMap is busy" and is never cached. A cached snapshot is served
// until somebody asks for a refresh, and a refresh that fails leaves the cached one in place.

export type GolfFetchLike=(url:string,init:{method:'POST';headers:Record<string,string>;body:string;signal:AbortSignal})=>Promise<{ok:boolean;status:number;json():Promise<unknown>}>;

export type GolfFailureCode='invalid-request'|'not-found'|'not-a-golf-course'|'no-boundary'|'overpass-busy'|'upstream-failed';
export type GolfSnapshotOutcome=
 |{status:200;body:{snapshot:GolfSnapshot;cached:boolean}}
 |{status:400|404|422|502|503|504;body:{error:string;code:GolfFailureCode}};

export interface GolfSnapshotRequest{osmType:GolfOsmType;osmId:number;refresh?:boolean}
export type GolfSnapshotHandler=(request:GolfSnapshotRequest)=>Promise<GolfSnapshotOutcome>;

export interface GolfHandlerOptions{
 fetchImpl?:GolfFetchLike;
 cache?:SnapshotCache;
 clock?:Clock;
 endpoint?:string;
 userAgent?:string;
 timeoutMs?:number;
 // Spacing between the starts of two upstream requests. They are already one at a time; this keeps
 // the two halves of one snapshot from landing on the public server back to back.
 minIntervalMs?:number;
 now?:()=>Date;
}

const fromEnv=(name:string)=>{const v=typeof process==='undefined'?undefined:process.env[name];return v&&v.trim()?v.trim():undefined};

export function createGolfSnapshotHandler(options:GolfHandlerOptions={}):GolfSnapshotHandler{
 const doFetch=options.fetchImpl??(globalThis.fetch as unknown as GolfFetchLike);
 const cache=options.cache??createMemorySnapshotCache();
 const endpoint=options.endpoint??fromEnv('OVERPASS_URL')??OVERPASS_DEFAULT_URL;
 const userAgent=options.userAgent??buildGolfUserAgent('0.1.0',fromEnv('GEOCODER_CONTACT'));
 const timeoutMs=options.timeoutMs??OVERPASS_TIMEOUT_S*1000;
 const limiter=createRateLimiter(options.minIntervalMs??1000,options.clock??systemClock);
 const now=options.now??(()=>new Date());
 const inFlight=new Map<string,Promise<GolfSnapshotOutcome>>();

 const query=(text:string)=>limiter.run(async()=>{
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
   let response;
   try{response=await doFetch(endpoint,{method:'POST',headers:{'User-Agent':userAgent,Accept:'application/json','Content-Type':'application/x-www-form-urlencoded; charset=utf-8'},body:`data=${encodeURIComponent(text)}`,signal:controller.signal})}
   catch(error){
    if(controller.signal.aborted)throw new OverpassError(OVERPASS_BUSY_MESSAGE,'overpass-busy',504);
    throw new OverpassError(`Overpass could not be reached: ${(error as Error)?.message??'unknown error'}`,'upstream-failed',502);
   }
   if(response.status===429||response.status===504||response.status===503)throw new OverpassError(OVERPASS_BUSY_MESSAGE,'overpass-busy',503);
   if(!response.ok)throw new OverpassError(`Overpass returned HTTP ${response.status}.`,'upstream-failed',502);
   let body:unknown;
   try{body=await response.json()}
   catch{throw new OverpassError(controller.signal.aborted?OVERPASS_BUSY_MESSAGE:'Overpass returned a response that was not JSON.',controller.signal.aborted?'overpass-busy':'upstream-failed',controller.signal.aborted?504:502)}
   return readOverpassReply(body);
  }finally{clearTimeout(timer)}
 });

 const fetchSnapshot=async(osmType:GolfOsmType,osmId:number,key:string):Promise<GolfSnapshotOutcome>=>{
  try{
   const first=await query(boundaryQuery(osmType,osmId));
   const boundary=(first.elements as OverpassElement[]).find(e=>e.type===osmType&&e.id===osmId);
   if(!boundary)return {status:404,body:{error:`OpenStreetMap has no ${osmType} ${osmId}.`,code:'not-found'}};
   if(boundary.tags?.leisure!=='golf_course')return {status:422,body:{error:`OpenStreetMap ${osmType} ${osmId} is not a golf course (no leisure=golf_course tag).`,code:'not-a-golf-course'}};
   const points=(boundary.type==='way'?boundary.geometry??[]:(boundary.members??[]).flatMap(m=>m.geometry??[])).filter((p):p is {lat:number;lon:number}=>Boolean(p));
   if(!points.length)return {status:422,body:{error:`OpenStreetMap ${osmType} ${osmId} has no outline to map.`,code:'no-boundary'}};
   const bbox:[number,number,number,number]=[Math.min(...points.map(p=>p.lon)),Math.min(...points.map(p=>p.lat)),Math.max(...points.map(p=>p.lon)),Math.max(...points.map(p=>p.lat))];
   const second=await query(featureQuery(padBbox(bbox)));
   const snapshot=normalizeSnapshot({boundary,features:second.elements as OverpassElement[],fetchedAt:now().toISOString(),osmBase:second.osmBase??first.osmBase});
   await cache.set(key,snapshot).catch(()=>{/* a cache that cannot write still serves the snapshot */});
   return {status:200,body:{snapshot,cached:false}};
  }catch(error){
   if(error instanceof OverpassError)return {status:error.status as 502|503|504,body:{error:error.message,code:error.code}};
   if(error instanceof GolfSnapshotError)return {status:422,body:{error:error.message,code:error.code==='not-found'?'not-found':error.code}};
   return {status:502,body:{error:`The course could not be read: ${(error as Error)?.message??String(error)}`,code:'upstream-failed'}};
  }
 };

 return async function handleGolfSnapshot({osmType,osmId,refresh}:GolfSnapshotRequest):Promise<GolfSnapshotOutcome>{
  if((osmType!=='way'&&osmType!=='relation')||!Number.isSafeInteger(osmId)||osmId<=0)return {status:400,body:{error:'Expected /api/golf/snapshot/way/<id> or /api/golf/snapshot/relation/<id>.',code:'invalid-request'}};
  const key=snapshotKey(osmType,osmId);
  if(!refresh){
   const hit=await cache.get(key).catch(()=>undefined);
   if(hit)return {status:200,body:{snapshot:hit,cached:true}};
  }
  // Two requests for the same course while it is being fetched share one pair of upstream calls.
  const pending=inFlight.get(key);
  if(pending)return pending;
  const request=fetchSnapshot(osmType,osmId,key).finally(()=>inFlight.delete(key));
  inFlight.set(key,request);
  return request;
 };
}
