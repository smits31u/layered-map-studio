import type {GeocodeCandidate,ProviderAdapter} from '../types';

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

export const ATTRIBUTION='© OpenStreetMap contributors — geocoding by Nominatim';

export function createNominatimAdapter(endpoint:string='https://nominatim.openstreetmap.org'):ProviderAdapter{
 return {
  id:'nominatim',
  label:'Nominatim (OpenStreetMap)',
  attribution:ATTRIBUTION,
  note:'Addresses and places worldwide. Rate limited to one request per second.',
  minIntervalMs:1000,
  endpoint,
  buildUrl:(query,limit)=>`${endpoint.replace(/\/+$/,'')}/search?q=${encodeURIComponent(query)}&format=jsonv2&addressdetails=0&limit=${limit}`,
  headers:userAgent=>({'User-Agent':userAgent,Accept:'application/json','Accept-Language':'en'}),
  parse(body,limit){
   if(!Array.isArray(body))throw new Error('Nominatim returned a response that was not a result list.');
   const results:GeocodeCandidate[]=[];
   for(const raw of body){
    if(!raw||typeof raw!=='object')continue;
    const row=raw as Record<string,unknown>;
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
    });
    if(results.length>=limit)break;
   }
   return results;
  },
 };
}
