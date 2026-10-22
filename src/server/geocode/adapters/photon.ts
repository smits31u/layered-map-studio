import type {GeocodeCandidate,GeocodeOsmRef,ProviderAdapter} from '../types';

// Komoot's Photon: OSM data, better at partial and misspelt place names than Nominatim, worse at
// exact street addresses. It is offered as an explicit alternative the user can pick, never as an
// automatic fallback — the plan forbids firing a second provider for every ambiguous result.
//
// Photon publishes no hard rate limit, only a request to be reasonable with the public instance.
// 250ms is this proxy's own self-imposed floor rather than a quoted policy number; it is not
// pretending to be a published limit.

const ATTRIBUTION='© OpenStreetMap contributors — geocoding by Photon (Komoot)';

const label=(properties:Record<string,unknown>):string=>{
 const parts=['name','street','city','state','country']
  .map(key=>properties[key])
  .filter((v):v is string=>typeof v==='string'&&v.length>0);
 const unique=parts.filter((value,index)=>parts.indexOf(value)===index);
 return unique.join(', ');
};

// Photon names the element N, W or R. The golf filter is Photon's own `osm_tag=key:value` query
// parameter; `osm_key`/`osm_value` are the matching response fields, checked again on the way back so
// a self-hosted instance that ignores the parameter still cannot hand the golf starter a town.
const OSM_TYPES:Record<string,GeocodeOsmRef['type']>={N:'node',W:'way',R:'relation'};
const osmRef=(properties:Record<string,unknown>):GeocodeOsmRef|undefined=>{
 const type=OSM_TYPES[String(properties.osm_type??'')],id=Number(properties.osm_id);
 return type&&Number.isSafeInteger(id)&&id>0?{type,id}:undefined;
};

export function createPhotonAdapter(endpoint:string='https://photon.komoot.io'):ProviderAdapter{
 return {
  id:'photon',
  label:'Photon (Komoot)',
  attribution:ATTRIBUTION,
  note:'Forgiving place-name search. Weaker on exact street addresses.',
  minIntervalMs:250,
  endpoint,
  filters:['golf-course'],
  buildUrl:(query,limit,filter)=>`${endpoint.replace(/\/+$/,'')}/api/?q=${encodeURIComponent(query)}&limit=${limit}${filter==='golf-course'?'&osm_tag=leisure:golf_course':''}`,
  headers:userAgent=>({'User-Agent':userAgent,Accept:'application/json'}),
  parse(body,limit,filter){
   const features=(body as {features?:unknown})?.features;
   if(!Array.isArray(features))throw new Error('Photon returned a response with no feature list.');
   const results:GeocodeCandidate[]=[];
   for(const raw of features){
    if(!raw||typeof raw!=='object')continue;
    const feature=raw as Record<string,unknown>;
    const geometry=feature.geometry as {coordinates?:unknown}|undefined;
    const coordinates=geometry?.coordinates;
    if(!Array.isArray(coordinates)||coordinates.length<2)continue;
    const lon=Number(coordinates[0]),lat=Number(coordinates[1]);
    if(!Number.isFinite(lon)||!Number.isFinite(lat))continue;
    const properties=(feature.properties??{}) as Record<string,unknown>;
    if(filter==='golf-course'&&(properties.osm_key!=='leisure'||properties.osm_value!=='golf_course'))continue;
    // Photon's `extent` is [west, north, east, south] — north and south are the other way round
    // from the [west, south, east, north] convention used everywhere else here.
    const extent=Array.isArray(properties.extent)?properties.extent.map(Number):undefined;
    const boundingBox=extent&&extent.length===4&&extent.every(Number.isFinite)
     ?[extent[0],extent[3],extent[2],extent[1]] as [number,number,number,number]
     :undefined;
    const text=label(properties);
    results.push({
     id:`photon:${String(properties.osm_type??'')}${String(properties.osm_id??`${lon},${lat}`)}`,
     label:text||`${lat.toFixed(5)}, ${lon.toFixed(5)}`,
     coordinates:[lon,lat],
     boundingBox,
     provider:'photon',
     attribution:ATTRIBUTION,
     kind:typeof properties.osm_value==='string'?properties.osm_value:typeof properties.type==='string'?properties.type:undefined,
     ...(osmRef(properties)?{osm:osmRef(properties)}:{}),
    });
    if(results.length>=limit)break;
   }
   return results;
  },
 };
}
