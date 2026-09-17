import type {GeocodeCandidate,GeocodeProviderId,GeocodeProviderInfo} from '../../server/geocode/types';

export type {GeocodeCandidate,GeocodeProviderId,GeocodeProviderInfo};

// Browser-side geocoding. Every provider now sits behind the localhost proxy at `/api/geocode`.
//
// Until Phase 2 this file called Photon and Nominatim directly from the page. That breaks the
// plan's §Geocoding plan on four counts at once — no descriptive User-Agent, no one-request-per-
// second cap for Nominatim, no caching, and the user's own IP address sent to a third party — and
// none of them are fixable in a browser. The provider code (URL shapes, response normalization,
// rate policy, attribution) therefore moved to `src/server/geocode/adapters/`, and what is left
// here is a client for our own endpoint.
//
// The `GeocoderService` interface and the `GeocoderResult` shape are unchanged so the lake map
// tool's call sites keep working. `FallbackGeocoder` is kept for the lake tool's marker lookup,
// which relied on it, and it still only advances on an outright failure or an empty result — never
// on a merely ambiguous one, which is the behaviour the plan forbids.

export type GeocoderResult={id:string;displayName:string;latitude:number;longitude:number;boundingBox?:[number,number,number,number];resultType?:string;provider:string};
export interface GeocoderService{search(query:string,signal?:AbortSignal):Promise<GeocoderResult[]>}

export interface GeocodeSearchResponse{
 query:string;
 provider:GeocodeProviderId;
 attribution:string;
 results:GeocodeCandidate[];
 cached:boolean;
 providers:GeocodeProviderInfo[];
}

export const GEOCODE_ENDPOINT='/api/geocode';

export const candidateToResult=(candidate:GeocodeCandidate):GeocoderResult=>({
 id:candidate.id,
 displayName:candidate.label,
 latitude:candidate.coordinates[1],
 longitude:candidate.coordinates[0],
 boundingBox:candidate.boundingBox,
 resultType:candidate.kind,
 provider:candidate.provider,
});

// Thrown with the proxy's own message so the UI can show why a search failed (unreachable provider,
// timeout, query too long) instead of a generic failure. `code` lets the UI distinguish "your input
// is wrong" from "the provider is down", which want different recovery advice.
export class GeocodeError extends Error{
 constructor(message:string,readonly code:string,readonly status:number){super(message);this.name='GeocodeError'}
}

export class ProxyGeocoder implements GeocoderService{
 constructor(private provider?:GeocodeProviderId,private endpoint:string=GEOCODE_ENDPOINT,private fetchImpl:typeof fetch=(...args)=>fetch(...args)){}

 // The full proxy response, including attribution and the provider list — what the ornament's
 // result chooser renders. `search` below is the narrower shape the lake tool already consumes.
 async searchDetailed(query:string,signal?:AbortSignal):Promise<GeocodeSearchResponse>{
  const url=`${this.endpoint}?q=${encodeURIComponent(query)}${this.provider?`&provider=${encodeURIComponent(this.provider)}`:''}`;
  let response:Response;
  try{
   response=await this.fetchImpl(url,{signal,headers:{Accept:'application/json'}});
  }catch(error){
   if((error as Error).name==='AbortError')throw error;
   throw new GeocodeError('The geocoding service on this machine could not be reached. Is the app running through its own server rather than as static files?','proxy-unreachable',0);
  }
  const body=await response.json().catch(()=>undefined) as Partial<GeocodeSearchResponse&{error:string;code:string}>|undefined;
  if(!response.ok||!body||!Array.isArray(body.results))throw new GeocodeError(body?.error??`The geocoding proxy returned HTTP ${response.status}.`,body?.code??'proxy-failed',response.status);
  return {query:body.query??query,provider:body.provider!,attribution:body.attribution??'',results:body.results,cached:Boolean(body.cached),providers:body.providers??[]};
 }

 async search(query:string,signal?:AbortSignal):Promise<GeocoderResult[]>{
  return (await this.searchDetailed(query,signal)).results.map(candidateToResult);
 }
}

// Retained for the lake map tool's marker address lookup, which has always had this behaviour.
// It advances to the next provider only when one outright fails or returns nothing at all: a
// provider that successfully finds zero matches for a typo is not broken, so a genuine not-found
// still surfaces as not-found rather than being masked by fanning out across every provider.
//
// The ornament tool deliberately does not use this. Its result chooser names the provider that
// answered and offers the others as an explicit choice, per the plan's "do not fire fallbacks
// automatically for every ambiguous result".
export class FallbackGeocoder implements GeocoderService{
 constructor(private providers:GeocoderService[]=[new ProxyGeocoder('photon'),new ProxyGeocoder('nominatim')]){}
 async search(query:string,signal?:AbortSignal){
  let lastError:Error|undefined;
  for(const provider of this.providers){
   try{
    const results=await provider.search(query,signal);
    if(results.length)return results;
   }catch(error){
    if((error as Error).name==='AbortError')throw error;
    lastError=error as Error;
   }
  }
  if(lastError)throw lastError;
  return [];
 }
}
