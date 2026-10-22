import type {GeocodeCandidate,GeocodeOsmRef,ProviderAdapter} from '../types';

// OpenStreetMap's public Nominatim.
//
// Its usage policy is the strictest of the three adapters and is the reason the proxy exists at
// all: an absolute maximum of one request per second, a genuine identifying User-Agent naming the
// application and a way to contact whoever runs it, and results must be cached rather than
// re-requested. None of those can be honoured from a browser, so `minIntervalMs` is 1000 here and
// the handler holds every call behind a per-provider queue.
//
// `endpoint` is overridable so a self-hosted Nominatim can be dropped in without touching this
// file — the policy numbers below describe the *public* instance, and a self-hosted one should set
// its own interval when it is registered.

const num=(value:unknown):number|undefined=>{
 const n=typeof value==='string'?Number(value):typeof value==='number'?value:NaN;
 return Number.isFinite(n)?n:undefined;
};

// Nominatim's free-text search has no class/type parameter, so the golf filter is applied to the
// answer (jsonv2's `category`/`type`), and the upstream request asks for more rows than will be shown
// so that a course ranked below a few same-named roads or towns still comes back. 40 is Nominatim's
// own maximum for `limit`.
export const FILTERED_UPSTREAM_LIMIT=40;
const OSM_TYPES=new Set<GeocodeOsmRef['type']>(['node','way','relation']);

export const ATTRIBUTION='© OpenStreetMap contributors — geocoding by Nominatim';

export function createNominatimAdapter(endpoint:string='https://nominatim.openstreetmap.org'):ProviderAdapter{
 return {
  id:'nominatim',
  label:'Nominatim (OpenStreetMap)',
  attribution:ATTRIBUTION,
  note:'Addresses and places worldwide. Rate limited to one request per second.',
  minIntervalMs:1000,
  endpoint,
  filters:['golf-course'],
  buildUrl:(query,limit,filter)=>`${endpoint.replace(/\/+$/,'')}/search?q=${encodeURIComponent(query)}&format=jsonv2&addressdetails=0&limit=${filter?FILTERED_UPSTREAM_LIMIT:limit}`,
  headers:userAgent=>({'User-Agent':userAgent,Accept:'application/json','Accept-Language':'en'}),
  parse(body,limit,filter){
   if(!Array.isArray(body))throw new Error('Nominatim returned a response that was not a result list.');
   const results:GeocodeCandidate[]=[];
   for(const raw of body){
    if(!raw||typeof raw!=='object')continue;
    const row=raw as Record<string,unknown>;
    if(filter==='golf-course'&&(row.category!=='leisure'||row.type!=='golf_course'))continue;
    const lon=num(row.lon),lat=num(row.lat);
    if(lon===undefined||lat===undefined)continue;
    // Nominatim's boundingbox is [south, north, west, east] as strings; every other consumer here
    // speaks [west, south, east, north], so it is reordered once, at the edge.
    const box=Array.isArray(row.boundingbox)?row.boundingbox.map(num):undefined;
    const boundingBox=box&&box.length===4&&box.every(v=>v!==undefined)
     ?[box[2] as number,box[0] as number,box[3] as number,box[1] as number] as [number,number,number,number]
     :undefined;
    results.push({
     id:`nominatim:${String(row.place_id??`${lon},${lat}`)}`,
     label:typeof row.display_name==='string'&&row.display_name?row.display_name:`${lat.toFixed(5)}, ${lon.toFixed(5)}`,
     coordinates:[lon,lat],
     boundingBox,
     provider:'nominatim',
     attribution:ATTRIBUTION,
     kind:typeof row.type==='string'?row.type:undefined,
     ...(osmOf(row)?{osm:osmOf(row)}:{}),
    });
    if(results.length>=limit)break;
   }
   return results;
  },
 };
}

function osmOf(row:Record<string,unknown>):GeocodeOsmRef|undefined{
 const type=row.osm_type as GeocodeOsmRef['type'],id=num(row.osm_id);
 return OSM_TYPES.has(type)&&id!==undefined&&Number.isSafeInteger(id)&&id>0?{type,id}:undefined;
}
