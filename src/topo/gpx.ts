import type {TopoRouteSource} from './types';

// GPX parsing (plan §5: "parse tracks first, then routes, then waypoints; reject invalid XML,
// non-finite coordinates, fewer than two points, and over-large files").
//
// Runs in the browser, on the file's text, with the platform's DOMParser — no dependency, and the
// file never leaves the machine. Parsing is strict: a GPX that is malformed in any of the ways
// below is refused with a reason, never partly loaded. A route drawn from half a file looks
// plausible and is wrong, which is worse than an error.
//
// Fallback order, precisely: the first of tracks, routes, waypoints that yields a drawable line is
// used. "Drawable" means at least one segment with two or more points — a track holding a single
// stray fix falls through to the file's route rather than being accepted and then refused.

export const GPX_LIMITS={
 // A long day's track at one fix per second is ~50k points and a few MB. These bounds leave room
 // for that and stop a mis-chosen file (a whole activity archive, a map dump) from freezing the tab.
 maxBytes:15*1024*1024,
 maxPoints:250000,
};

export type GpxErrorCode='empty'|'too-large'|'invalid-xml'|'not-gpx'|'no-points'|'too-few-points'|'invalid-coordinate'|'too-many-points';

export class GpxError extends Error{
 constructor(readonly code:GpxErrorCode,message:string){super(message);this.name='GpxError'}
}

export interface ParsedGpx{
 source:TopoRouteSource;
 name?:string;
 segments:[number,number][][];
 pointCount:number;
}

// Elements are matched by local name in any namespace: GPX 1.0 and 1.1 use different namespace
// URIs, and some exporters write none at all.
const byName=(root:Element|Document,name:string)=>Array.from(root.getElementsByTagNameNS('*',name));
const childNamed=(parent:Element,name:string)=>Array.from(parent.children).find(child=>child.localName===name);
const textOf=(element:Element|undefined)=>element?.textContent?.trim()||undefined;

function readPoint(element:Element,index:number,what:string):[number,number]{
 const latText=element.getAttribute('lat'),lonText=element.getAttribute('lon');
 // Number('') is 0, which would quietly put a point in the Gulf of Guinea; an absent or blank
 // attribute is its own error.
 const lat=latText===null||latText.trim()===''?Number.NaN:Number(latText),lon=lonText===null||lonText.trim()===''?Number.NaN:Number(lonText);
 if(!Number.isFinite(lat)||!Number.isFinite(lon))throw new GpxError('invalid-coordinate',`${what} ${index+1} has a missing or non-numeric lat/lon (lat="${latText??''}", lon="${lonText??''}").`);
 if(Math.abs(lat)>90||Math.abs(lon)>180)throw new GpxError('invalid-coordinate',`${what} ${index+1} is off the globe (lat ${lat}, lon ${lon}).`);
 return [lon,lat];
}

export function parseGpx(text:string,limits=GPX_LIMITS):ParsedGpx{
 if(!text||!text.trim())throw new GpxError('empty','The file is empty.');
 if(text.length>limits.maxBytes)throw new GpxError('too-large',`The file is larger than ${Math.round(limits.maxBytes/1024/1024)} MB.`);
 // A GPX file never needs a document type or entity declarations, and they are how an XML file is
 // made to expand into something enormous. Refused before parsing, not after.
 if(/<!DOCTYPE|<!ENTITY/i.test(text))throw new GpxError('invalid-xml','GPX files do not use DOCTYPE or ENTITY declarations; this one does, so it is not loaded.');

 const doc=new DOMParser().parseFromString(text,'application/xml');
 if(doc.getElementsByTagName('parsererror').length)throw new GpxError('invalid-xml','The file is not well-formed XML.');
 const root=doc.documentElement;
 if(!root||root.localName!=='gpx')throw new GpxError('not-gpx',`The file is XML but not GPX (its root element is <${root?.localName??'nothing'}>).`);

 const metadata=byName(doc,'metadata')[0];
 const metadataName=textOf(metadata?childNamed(metadata,'name'):undefined);
 let totalPoints=0;
 const count=(n:number)=>{totalPoints+=n;if(totalPoints>limits.maxPoints)throw new GpxError('too-many-points',`The file has more than ${limits.maxPoints.toLocaleString('en-US')} points.`)};

 const candidates:{source:TopoRouteSource;name?:string;segments:[number,number][][]}[]=[];

 // Tracks: one segment per <trkseg>.
 const tracks=byName(doc,'trk');
 {
  const segments:[number,number][][]=[];
  let index=0;
  for(const track of tracks)for(const segment of Array.from(track.children).filter(child=>child.localName==='trkseg')){
   const points=Array.from(segment.children).filter(child=>child.localName==='trkpt');
   count(points.length);
   segments.push(points.map(point=>readPoint(point,index++,'Track point')));
  }
  candidates.push({source:'track',name:textOf(tracks[0]?childNamed(tracks[0],'name'):undefined),segments});
 }
 // Routes: one segment per <rte>.
 const routes=byName(doc,'rte');
 {
  const segments:[number,number][][]=[];
  let index=0;
  for(const route of routes){
   const points=Array.from(route.children).filter(child=>child.localName==='rtept');
   count(points.length);
   segments.push(points.map(point=>readPoint(point,index++,'Route point')));
  }
  candidates.push({source:'route',name:textOf(routes[0]?childNamed(routes[0],'name'):undefined),segments});
 }
 // Waypoints: all of them, in document order, as one line — the plan's last-resort fallback.
 {
  const points=Array.from(root.children).filter(child=>child.localName==='wpt');
  count(points.length);
  candidates.push({source:'waypoints',segments:[points.map((point,index)=>readPoint(point,index,'Waypoint'))]});
 }

 if(totalPoints===0)throw new GpxError('no-points','The file contains no track points, route points or waypoints.');
 for(const candidate of candidates){
  const drawable=candidate.segments.filter(segment=>segment.length>=2);
  if(!drawable.length)continue;
  const name=candidate.name??metadataName;
  return {source:candidate.source,...(name?{name}:{}),segments:drawable,pointCount:drawable.reduce((sum,segment)=>sum+segment.length,0)};
 }
 throw new GpxError('too-few-points','No track, route or set of waypoints in the file has at least two points, so there is no line to draw.');
}

// [west, south, east, north] around every point of the route, for "fit to route".
//
// A route that crosses the antimeridian is fitted around its eastern and western extremes, which
// frames most of the globe rather than the short way across 180°. Recorded as a known limitation in
// docs/topo-implementation-status.md; it cannot occur for any route a laser map of one place is for.
export function routeBounds(segments:[number,number][][]):[number,number,number,number]{
 let west=Infinity,south=Infinity,east=-Infinity,north=-Infinity;
 for(const segment of segments)for(const [lng,lat] of segment){
  if(lng<west)west=lng;if(lng>east)east=lng;if(lat<south)south=lat;if(lat>north)north=lat;
 }
 return [west,south,east,north];
}
