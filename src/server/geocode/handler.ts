import {createLruCache,type Cache} from './cache';
import {createRateLimiter,type Clock,type RateLimiter,systemClock} from './rateLimiter';
import {createCensusAdapter} from './adapters/census';
import {createNominatimAdapter} from './adapters/nominatim';
import {createPhotonAdapter} from './adapters/photon';
import type {FetchLike,GeocodeCandidate,GeocodeFailureCode,GeocodeOutcome,GeocodeProviderId,GeocodeProviderInfo,ProviderAdapter} from './types';

// The plan caps the result list at five: "Return up to five normalized candidates".
export const MAX_RESULTS=5;
export const DEFAULT_CACHE_ENTRIES=200;
export const DEFAULT_CACHE_TTL_MS=6*60*60*1000;
export const DEFAULT_TIMEOUT_MS=8000;
export const MAX_QUERY_LENGTH=200;

// A descriptive, server-side User-Agent, which is the whole point of proxying: Nominatim's policy
// requires the application to identify itself and to be contactable. `GEOCODER_CONTACT` is how the
// operator supplies that contact; when it is unset the header says so in plain words rather than
// impersonating a browser or inventing an address nobody reads.
export function buildUserAgent(version:string,contact?:string):string{
 const who=contact&&contact.trim()?contact.trim():'contact not configured — set GEOCODER_CONTACT';
 return `LayeredMapStudio-Ornament/${version} (self-hosted localhost map ornament generator; ${who})`;
}

export interface GeocodeHandlerOptions{
 adapters?:ProviderAdapter[];
 defaultProvider?:GeocodeProviderId;
 fetchImpl?:FetchLike;
 userAgent?:string;
 cache?:Cache<{results:GeocodeCandidate[];attribution:string}>;
 clock?:Clock;
 timeoutMs?:number;
 maxResults?:number;
}

export interface GeocodeRequest{q?:string|null;provider?:string|null}
export type GeocodeHandler=(request:GeocodeRequest)=>Promise<GeocodeOutcome>;

// Endpoints are server-side environment variables, not `VITE_` ones: they are never read by the
// browser, and a self-hosted Nominatim should not be baked into a client bundle.
const fromEnv=(name:string):string|undefined=>{const value=typeof process==='undefined'?undefined:process.env[name];return value&&value.trim()?value.trim():undefined};
export const createDefaultAdapters=():ProviderAdapter[]=>[
 createNominatimAdapter(fromEnv('NOMINATIM_URL')),
 createPhotonAdapter(fromEnv('PHOTON_URL')),
 createCensusAdapter(fromEnv('CENSUS_GEOCODER_URL')),
];

const describe=(adapters:ProviderAdapter[]):GeocodeProviderInfo[]=>adapters.map(a=>({id:a.id,label:a.label,attribution:a.attribution,note:a.note}));

// Collapses runs of whitespace so "Crivitz,   WI" and "Crivitz, WI" are one cache entry rather than
// two upstream requests. Control characters are rejected separately, below.
export const normalizeQuery=(raw:string):string=>raw.replace(/\s+/g,' ').trim();

// Tab, newline and carriage return are allowed through because normalizeQuery folds them into a
// single space - someone pasting an address out of a document should not be told off for it. Every
// other C0 control, DEL and the C1 block is rejected outright: none of them can occur in a real
// place name, and they would otherwise be percent-encoded straight into an upstream URL.
export function hasControlCharacters(value:string):boolean{
 for(let index=0;index<value.length;index++){
  const code=value.charCodeAt(index);
  if(code===9||code===10||code===13)continue;
  if(code<32||(code>=127&&code<=159))return true;
 }
 return false;
}

export function createGeocodeHandler(options:GeocodeHandlerOptions={}):GeocodeHandler{
 const adapters=options.adapters??createDefaultAdapters();
 const byId=new Map(adapters.map(adapter=>[adapter.id,adapter]));
 const providers=describe(adapters);
 const defaultProvider=options.defaultProvider??adapters[0]?.id??'nominatim';
 const doFetch=options.fetchImpl??(globalThis.fetch as unknown as FetchLike);
 // Guarded rather than read directly: this module is server-side by contract, but a stray browser
 // import should surface as a missing contact string, not a ReferenceError at module scope.
 const userAgent=options.userAgent??buildUserAgent('0.1.0',typeof process==='undefined'?undefined:process.env.GEOCODER_CONTACT);
 const cache=options.cache??createLruCache<{results:GeocodeCandidate[];attribution:string}>(DEFAULT_CACHE_ENTRIES,DEFAULT_CACHE_TTL_MS);
 const clock=options.clock??systemClock;
 const timeoutMs=options.timeoutMs??DEFAULT_TIMEOUT_MS;
 const limit=Math.max(1,Math.min(MAX_RESULTS,options.maxResults??MAX_RESULTS));

 // One queue per provider, not one shared queue: the providers' policies are independent, and
 // making a Photon search wait behind a Nominatim search would be slower for no reason.
 const limiters=new Map<GeocodeProviderId,RateLimiter>(adapters.map(adapter=>[adapter.id,createRateLimiter(adapter.minIntervalMs,clock)]));

 const fail=(status:number,code:GeocodeFailureCode,error:string):GeocodeOutcome=>({status,body:{error,code,providers}});

 return async function handleGeocode(request:GeocodeRequest):Promise<GeocodeOutcome>{
  const raw=typeof request.q==='string'?request.q:'';
  if(hasControlCharacters(raw))return fail(400,'query-invalid','The search text contains control characters.');
  const query=normalizeQuery(raw);
  if(!query)return fail(400,'missing-query','Provide a place or address to search for, as ?q=.');
  if(query.length>MAX_QUERY_LENGTH)return fail(400,'query-too-long',`The search text is longer than ${MAX_QUERY_LENGTH} characters.`);

  const requestedProvider=request.provider?normalizeQuery(request.provider).toLowerCase():'';
  const providerId=(requestedProvider||defaultProvider) as GeocodeProviderId;
  const adapter=byId.get(providerId);
  if(!adapter)return fail(400,'unknown-provider',`Unknown geocoding provider "${requestedProvider}". Available: ${adapters.map(a=>a.id).join(', ')}.`);

  // Case-insensitive cache key: address search is case-insensitive upstream, so treating "CRIVITZ"
  // and "crivitz" as two entries would mean two upstream requests for one answer.
  const key=`${adapter.id}::${query.toLowerCase()}`;
  const hit=cache.get(key);
  if(hit)return {status:200,body:{query,provider:adapter.id,attribution:hit.attribution,results:hit.results,cached:true,providers}};

  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
   // The rate limiter wraps the upstream call only. A cache hit never enters the queue, so a
   // repeated search stays instant even while the one-per-second gate is holding a real request.
   const response=await limiters.get(adapter.id)!.run(()=>doFetch(adapter.buildUrl(query,limit),{headers:adapter.headers(userAgent),signal:controller.signal}));
   if(!response.ok)return fail(502,'upstream-failed',`${adapter.label} returned HTTP ${response.status}.`);
   const results=adapter.parse(await response.json(),limit);
   cache.set(key,{results,attribution:adapter.attribution});
   return {status:200,body:{query,provider:adapter.id,attribution:adapter.attribution,results,cached:false,providers}};
  }catch(error){
   const reason=error as Error;
   if(reason?.name==='AbortError'||controller.signal.aborted)return fail(504,'upstream-timeout',`${adapter.label} did not respond within ${timeoutMs}ms.`);
   return fail(502,'upstream-failed',`${adapter.label} could not be reached: ${reason?.message??'unknown error'}`);
  }finally{
   clearTimeout(timer);
  }
 };
}
