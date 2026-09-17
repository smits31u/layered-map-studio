import type {GeocodeCandidate,ProviderAdapter} from '../types';

// The US Census Bureau's public geocoder. US street addresses only — it will not find a lake, a
// town in Ontario, or anything outside the United States — but for a US rooftop address it is
// authoritative, free, published as public domain, and has no rate limit or identification
// requirement.
//
// It is included because the plan names it as one of the swappable providers, and because the
// product's common case is "my house in Wisconsin", which is exactly what it is best at. It is
// never selected automatically: an empty result here means "not a US address", not "try elsewhere",
// and deciding that is the user's call.

const ATTRIBUTION='US Census Bureau Geocoding Services (public domain)';

export function createCensusAdapter(endpoint:string='https://geocoding.geo.census.gov'):ProviderAdapter{
 return {
  id:'census',
  label:'US Census Bureau',
  attribution:ATTRIBUTION,
  note:'United States street addresses only. No results outside the US.',
  minIntervalMs:0,
  endpoint,
  buildUrl:query=>`${endpoint.replace(/\/+$/,'')}/geocoder/locations/onelineaddress?address=${encodeURIComponent(query)}&benchmark=Public_AR_Current&format=json`,
  headers:userAgent=>({'User-Agent':userAgent,Accept:'application/json'}),
  parse(body,limit){
   const matches=(body as {result?:{addressMatches?:unknown}})?.result?.addressMatches;
   if(!Array.isArray(matches))throw new Error('The Census geocoder returned a response with no address matches list.');
   const results:GeocodeCandidate[]=[];
   for(const raw of matches){
    if(!raw||typeof raw!=='object')continue;
    const match=raw as Record<string,unknown>;
    const point=match.coordinates as {x?:unknown;y?:unknown}|undefined;
    const lon=Number(point?.x),lat=Number(point?.y);
    if(!Number.isFinite(lon)||!Number.isFinite(lat))continue;
    results.push({
     id:`census:${String(match.tigerLine&&typeof match.tigerLine==='object'?(match.tigerLine as Record<string,unknown>).tigerLineId:'')||`${lon},${lat}`}`,
     label:typeof match.matchedAddress==='string'&&match.matchedAddress?match.matchedAddress:`${lat.toFixed(5)}, ${lon.toFixed(5)}`,
     // The Census geocoder returns a rooftop point and no extent, so there is nothing to fit a
     // bounding box to. Leaving it undefined is correct; inventing one would make the "fit to
     // result" action silently guess at a scale.
     coordinates:[lon,lat],
     provider:'census',
     attribution:ATTRIBUTION,
     kind:'address',
    });
    if(results.length>=limit)break;
   }
   return results;
  },
 };
}
