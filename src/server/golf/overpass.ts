import type {GolfOsmType} from './types';

// The two Overpass queries behind a course snapshot (docs/GOLF_MODULE_PLAN.md §2.2), and how a reply
// is read.
//
// Overpass cannot feed a computed bounding box back into a filter, and fairways and greens are
// almost never members of the course's own relation, so a snapshot is two requests: the boundary by
// id, then every golf, water and tree feature in the boundary's bbox plus a 50 m pad. Both go through
// one queue (handler.ts), one at a time.

export const OVERPASS_DEFAULT_URL='https://overpass-api.de/api/interpreter';
export const OVERPASS_TIMEOUT_S=60;
export const BBOX_PAD_M=50;
const METRES_PER_DEGREE=111_320;

export const boundaryQuery=(type:GolfOsmType,id:number)=>`[out:json][timeout:${OVERPASS_TIMEOUT_S}];${type}(${id});out geom;`;

// [west, south, east, north] grown by `padM` metres on every side.
export function padBbox([w,s,e,n]:[number,number,number,number],padM=BBOX_PAD_M):[number,number,number,number]{
 const dLat=padM/METRES_PER_DEGREE,dLon=padM/(METRES_PER_DEGREE*Math.cos(((s+n)/2)*Math.PI/180));
 return [w-dLon,s-dLat,e+dLon,n+dLat];
}

const f7=(v:number)=>v.toFixed(7);

// Overpass's global bbox setting is south,west,north,east.
export const featureQuery=([w,s,e,n]:[number,number,number,number])=>[
 `[out:json][timeout:${OVERPASS_TIMEOUT_S}][bbox:${f7(s)},${f7(w)},${f7(n)},${f7(e)}];`,
 '(',
 'nwr["golf"];',
 'nwr["natural"~"^(water|tree|wood)$"];',
 'nwr["water"~"^(pond|lake)$"];',
 'nwr["waterway"];',
 'nwr["landuse"="forest"];',
 'way["highway"]["golf_cart"];',
 ');',
 'out geom;',
].join('');

export function buildGolfUserAgent(version:string,contact?:string):string{
 const who=contact&&contact.trim()?contact.trim().replace(/[^\x20-\x7e]/g,'?'):'contact not configured - set GEOCODER_CONTACT';
 return `LayeredMapStudio-Golf/${version} (self-hosted laser map builder; golf course snapshots; ${who})`;
}

export type OverpassFailureCode='overpass-busy'|'upstream-failed';
export class OverpassError extends Error{
 constructor(message:string,readonly code:OverpassFailureCode,readonly status:number){super(message);this.name='OverpassError'}
}

// The plan's wording, used for every "come back later" answer: 429 (rate limited), 504 (gateway
// timeout), our own timeout, and a 200 whose `remark` says the query ran out of time or memory.
export const OVERPASS_BUSY_MESSAGE='OpenStreetMap is busy, try again in a minute.';

export interface OverpassReply{elements:unknown[];osmBase?:string}

export function readOverpassReply(body:unknown):OverpassReply{
 const reply=body as {elements?:unknown;remark?:unknown;osm3s?:{timestamp_osm_base?:unknown}}|undefined;
 if(typeof reply?.remark==='string'&&/runtime (error|remark)|timed out|out of memory/i.test(reply.remark))throw new OverpassError(OVERPASS_BUSY_MESSAGE,'overpass-busy',503);
 if(!reply||!Array.isArray(reply.elements))throw new OverpassError('Overpass returned a response with no element list.','upstream-failed',502);
 const base=reply.osm3s?.timestamp_osm_base;
 return {elements:reply.elements,...(typeof base==='string'?{osmBase:base}:{})};
}
