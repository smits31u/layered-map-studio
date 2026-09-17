// Geocoding runs on the server side of the localhost proxy, never in the browser.
//
// The plan (§Geocoding plan, §Risks "Geocoder policy/privacy") forbids the browser calling a public
// provider directly: a browser request carries the user's own User-Agent and IP, cannot be
// rate-limited across tabs, and cannot be cached for anyone but that one page. Every provider's
// terms of use are a server-side obligation, so provider access lives here and the browser only
// ever talks to `/api/geocode`.
//
// Nothing in `src/server/**` may import React, MapLibre or anything DOM-only. It runs under Node
// (the Vite dev middleware and the production server both mount the same handler) and is exercised
// directly by unit tests with an injected fetch.

export type GeocodeProviderId='nominatim'|'photon'|'census';

// The normalized candidate shape the plan asks for: "id, label, coordinates, bounding box, provider
// attribution". Coordinates are [longitude, latitude] — GeoJSON order, matching OrnamentProject's
// viewport.center and marker.position so a candidate can be used without re-ordering a pair.
export interface GeocodeCandidate{
 id:string;
 label:string;
 coordinates:[number,number];
 // [west, south, east, north]. Optional: a rooftop address match has no meaningful extent, and the
 // US Census provider never returns one.
 boundingBox?:[number,number,number,number];
 provider:GeocodeProviderId;
 attribution:string;
 kind?:string;
}

export interface GeocodeProviderInfo{id:GeocodeProviderId;label:string;attribution:string;note:string}

export interface GeocodeSuccess{
 query:string;
 provider:GeocodeProviderId;
 attribution:string;
 results:GeocodeCandidate[];
 // True when this response came from the proxy cache and no upstream request was made. Surfaced so
 // the UI can say so and so tests can assert the cache is actually being hit.
 cached:boolean;
 // Every provider the proxy can reach. The UI offers these as an explicit user choice — the plan
 // forbids firing a fallback provider automatically on every ambiguous result, so switching
 // provider has to be something a person does, not something the proxy does behind their back.
 providers:GeocodeProviderInfo[];
}

export type GeocodeFailureCode='missing-query'|'query-too-long'|'query-invalid'|'unknown-provider'|'upstream-failed'|'upstream-timeout';

export interface GeocodeFailure{error:string;code:GeocodeFailureCode;providers:GeocodeProviderInfo[]}

export interface GeocodeOutcome{status:number;body:GeocodeSuccess|GeocodeFailure}

export type FetchLike=(url:string,init:{headers:Record<string,string>;signal:AbortSignal})=>Promise<{ok:boolean;status:number;json():Promise<unknown>}>;

// An adapter is the whole of what the proxy knows about a provider: how to address it, what
// identification it demands, how fast it may be called, and how to normalize its answer. The plan
// requires providers stay "behind adapters" so a self-hosted Nominatim or a paid provider is a new
// file rather than a change to the handler.
export interface ProviderAdapter{
 id:GeocodeProviderId;
 label:string;
 attribution:string;
 note:string;
 // Minimum milliseconds between two upstream calls to this provider, per its published policy.
 // Public Nominatim is 1000 (its usage policy's absolute maximum of one request per second).
 minIntervalMs:number;
 endpoint:string;
 buildUrl(query:string,limit:number):string;
 // Headers are per-adapter because identification requirements differ: Nominatim requires a
 // descriptive User-Agent, Photon asks for one, the Census geocoder does not care.
 headers(userAgent:string):Record<string,string>;
 parse(body:unknown,limit:number):GeocodeCandidate[];
}
