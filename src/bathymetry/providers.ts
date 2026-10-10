import * as polygonClipping from 'polygon-clipping';
import type {BathymetryProvider,BathymetryProviderResult,BathymetryQuery,GeoMultiPolygon} from './model';
import {importDepthRegionGeoJson,sourceMetadata} from './model';
import {bbox,distanceM,multiPolygonAreaM2,pointInMultiPolygon,ringAreaM2,type Position,type Ring} from './geo';
import {statesForWater,type StateCode} from './states';

// A WBIC of 0, null or missing is the hydro layer saying "not a Wisconsin waterbody" (it returns
// out-of-state lakes that way), never an identity.
const validWbic=(value:unknown)=>{if(value===null||value===undefined||value==='')return;const n=Number(value);return Number.isFinite(n)&&n>0?String(value):undefined};

export class WisconsinDnrProvider implements BathymetryProvider{
 id='wisconsin-dnr';label='Wisconsin DNR';
 constructor(private fetcher:typeof fetch=(input,init)=>globalThis.fetch(input,init)){}
 async resolve(query:BathymetryQuery):Promise<BathymetryProviderResult>{
  const params=new URLSearchParams({f:'json',geometry:`${query.longitude},${query.latitude}`,geometryType:'esriGeometryPoint',inSR:'4326',spatialRel:'esriSpatialRelIntersects',distance:'5000',units:'esriSRUnit_Meter',outFields:'WATERBODY_NAME,WATERBODY_WBIC',returnGeometry:'false'}),url=`https://dnrmaps.wi.gov/arcgis/rest/services/ER_Biotics/ER_Biotics_WGS84_Hydro/MapServer/0/query?${params}`;
  try{const response=await this.fetcher(url);if(!response.ok)throw new Error(`HTTP ${response.status}`);const json=await response.json(),features=(json.features??[]).filter((feature:any)=>validWbic(feature.attributes?.WATERBODY_WBIC)),words=(value:string)=>new Set(value.toLowerCase().match(/[a-z]+/g)?.filter(word=>!['lake','reservoir','wisconsin','the'].includes(word))??[]),wanted=words(query.waterbodyName??''),rank=(feature:any)=>[...words(String(feature.attributes?.WATERBODY_NAME??''))].filter(word=>wanted.has(word)).length,attributes=[...features].sort((a,b)=>rank(b)-rank(a))[0]?.attributes;if(!attributes||query.waterbodyName&&rank({attributes})===0)return{provider:'wisconsin-dnr',status:'unavailable',message:'Wisconsin DNR hydrography found no matching lake within 5 km of the selected point.'};const wbic=validWbic(attributes.WATERBODY_WBIC)!,sourceUrl=`https://apps.dnr.wi.gov/lakes/lakepages/LakeDetail.aspx?page=facts&wbic=${wbic}`;return{provider:'wisconsin-dnr',status:'unsupported',waterbodyId:wbic,sourceUrl,message:`Wisconsin DNR identifies ${attributes.WATERBODY_NAME??'this waterbody'} (WBIC ${wbic}). DNR contour maps may be scanned historical documents; no verified georeferenced depth polygons were returned automatically.`}}catch(error){return{provider:'wisconsin-dnr',status:'unavailable',message:`Wisconsin DNR provider unavailable: ${(error as Error).message}`}}
 }
}

// Michigan DNR / Institute for Fisheries Research inland lake survey data: layer 0 is one deep
// point per basin (MaxDepth in feet), layer 1 the digitised contour lines (MinDepth is the line's
// depth in feet; MaxDepth is unreliable — 0 on most of Mary Lake's lines). Michigan public record.
export const MICHIGAN_DNR_SERVICE='https://services3.arcgis.com/Jdnp1TjADvSDxMAX/ArcGIS/rest/services/DNRHydrologyOPENDATA/FeatureServer';
export const MICHIGAN_DNR_ATTRIBUTION='Michigan DNR / Institute for Fisheries Research';
const PAGE_SIZE=2000,MAX_PAGES=25;
// Contours under this area are spot soundings drawn as 2–5 m² squares (Hamilton Lake's 12, 26,
// 27 and 31 ft), not depth regions; the deepest one is already the deep point.
const MIN_CONTOUR_AREA_M2=50;
// Endpoints this close are a ring the digitiser didn't quite close (seen: 0.2 m, 0.6 m).
const MAX_CLOSE_GAP_M=5;
// Share of a surveyed lake's outer contour that must overlap the selected water body (or of the
// water body, when the crop cuts the lake) for the survey to count as that lake.
const MIN_OVERLAP=.5;
type EsriFeature={attributes:Record<string,any>;geometry?:{x?:number;y?:number;paths?:Position[][]}};
type DeepPoint={key:string;name:string;maxDepthFt:number;county?:string;point:Position};
type ContourRing={key:string;name:string;depthFt:number;ring:Ring};

// ArcGIS responses, shared by every provider instance for the life of the page: Check Bathymetry
// builds a new resolver per click, and toggling Primary/All water re-asks about the same lakes.
const responseCache=new Map<string,Promise<EsriFeature[]>>();

export class MichiganDnrProvider implements BathymetryProvider{
 id='michigan-dnr';label='Michigan DNR';
 constructor(private fetcher:typeof fetch=(input,init)=>globalThis.fetch(input,init),private cache=responseCache){}

 private query(layer:0|1,envelope:[number,number,number,number],outFields:string){
  const base={where:'1=1',geometry:envelope.join(','),geometryType:'esriGeometryEnvelope',inSR:'4326',spatialRel:'esriSpatialRelIntersects',outFields,returnGeometry:'true',outSR:'4326',orderByFields:'OBJECTID',resultRecordCount:String(PAGE_SIZE),f:'json'},key=`${layer}?${new URLSearchParams(base)}`;
  let pending=this.cache.get(key);
  if(!pending){
   pending=(async()=>{const all:EsriFeature[]=[];for(let page=0;page<MAX_PAGES;page++){const url=`${MICHIGAN_DNR_SERVICE}/${layer}/query?${new URLSearchParams({...base,resultOffset:String(page*PAGE_SIZE)})}`,response=await this.fetcher(url);if(!response.ok)throw new Error(`HTTP ${response.status}`);const json=await response.json();if(json.error)throw new Error(json.error.message??'ArcGIS query error');all.push(...(json.features??[]));if(!json.exceededTransferLimit)return all}throw new Error(`more than ${MAX_PAGES*PAGE_SIZE} features in the selected area`)})();
   this.cache.set(key,pending);
   pending.catch(()=>this.cache.delete(key));
  }
  return pending;
 }

 async resolve(query:BathymetryQuery):Promise<BathymetryProviderResult>{
  const water=query.water;
  if(!water?.length)return{provider:'michigan-dnr',status:'unavailable',message:'Michigan DNR lakes are matched against the selected water body; capture the map features first.'};
  try{
   const envelope=bbox(water),[deepFeatures,contourFeatures]=await Promise.all([this.query(0,envelope,'NewKey,LakeName,MaxDepth,County'),this.query(1,envelope,'NewKey,Name,MinDepth')]);
   const deepPoints:DeepPoint[]=deepFeatures.filter(f=>f.attributes.NewKey&&Number.isFinite(f.geometry?.x)&&Number.isFinite(f.geometry?.y)).map(f=>({key:String(f.attributes.NewKey),name:String(f.attributes.LakeName??''),maxDepthFt:Number(f.attributes.MaxDepth),county:f.attributes.County??undefined,point:[f.geometry!.x!,f.geometry!.y!]}));
   const rings:ContourRing[]=[];let unclosed=0;
   for(const f of contourFeatures){const key=f.attributes.NewKey,depthFt=Number(f.attributes.MinDepth);if(!key||!Number.isFinite(depthFt))continue;for(const path of f.geometry?.paths??[]){if(path.length<4)continue;const closed=distanceM(path[0],path.at(-1)!)<=MAX_CLOSE_GAP_M;if(!closed){unclosed++;continue}const ring:Ring=[...path.slice(0,-1),[...path[0]] as Position];rings.push({key:String(key),name:String(f.attributes.Name??''),depthFt,ring})}}
   // Match by geometry, never by name: Michigan has dozens of lakes called "Hamilton Lake". A
   // survey belongs to the selected water when one of its deep points lies in it, or when its
   // outermost contour (the surveyed shoreline) mostly overlaps it.
   const waterArea=multiPolygonAreaM2(water),keys=new Set(deepPoints.filter(p=>pointInMultiPolygon(p.point,water)).map(p=>p.key));
   for(const key of new Set(rings.map(r=>r.key))){if(keys.has(key))continue;const outer=rings.filter(r=>r.key===key).sort((a,b)=>ringAreaM2(b.ring)-ringAreaM2(a.ring))[0].ring,overlap=multiPolygonAreaM2(polygonClipping.intersection([[outer]],water));if(overlap>=MIN_OVERLAP*Math.min(ringAreaM2(outer),waterArea))keys.add(key)}
   if(!keys.size)return{provider:'michigan-dnr',status:'unavailable',message:'Michigan DNR has no surveyed lake contours for the selected water body.'};
   const lakes=[...keys].sort().map(key=>{const points=deepPoints.filter(p=>p.key===key),name=points[0]?.name||rings.find(r=>r.key===key)?.name||'Unnamed lake';return{key,name,county:points[0]?.county,maxDepthFt:points.length?Math.max(...points.map(p=>p.maxDepthFt)):undefined}});
   const usable=rings.filter(r=>keys.has(r.key)&&r.depthFt>0&&ringAreaM2(r.ring)>=MIN_CONTOUR_AREA_M2);
   if(!usable.length)return{provider:'michigan-dnr',status:'unsupported',waterbodyId:lakes.map(l=>l.key).join(','),sourceUrl:MICHIGAN_DNR_SERVICE,message:`Michigan DNR surveyed ${lakes.map(l=>l.name).join(', ')}, but no usable depth contours below the shoreline were found.`};
   const features=contourRegions(usable).map(({depthFt,geometry})=>({type:'Feature' as const,properties:{depth:depthFt,depth_unit:'ft'},geometry:{type:'MultiPolygon' as const,coordinates:geometry}}));
   const imported=importDepthRegionGeoJson({type:'FeatureCollection',features},'michigan-dnr.geojson'),title=lakes.map(l=>`${l.name} (${l.key}${l.county?`, ${l.county} Co.`:''})`).join(', '),levels=[...new Set(usable.map(r=>r.depthFt))].sort((a,b)=>a-b);
   const dataset={...imported,source:sourceMetadata({provider:'michigan-dnr',datasetId:`michigan-dnr:${lakes.map(l=>l.key).join('+')}`,title:`Michigan DNR contours — ${title}`,retrievedAt:new Date().toISOString(),sourceUrl:MICHIGAN_DNR_SERVICE,attribution:MICHIGAN_DNR_ATTRIBUTION,license:'Michigan public record; no use restrictions.',quality:'IFR inland lake survey contours (surveys since the 1930s), depths in feet; lake matched to the selected water body by location. Not for navigation.'})};
   const maxText=lakes.map(l=>l.maxDepthFt!==undefined?`${l.name} max ${l.maxDepthFt} ft`:l.name).join('; ');
   return{provider:'michigan-dnr',status:'available',dataset,waterbodyId:lakes.map(l=>l.key).join(','),sourceUrl:MICHIGAN_DNR_SERVICE,message:`Michigan DNR contours loaded for ${title}: ${levels.length} depth levels (${levels.join(', ')} ft; ${maxText}).${unclosed?` ${unclosed} unclosed contour line${unclosed===1?'':'s'} skipped.`:''} Source: ${MICHIGAN_DNR_ATTRIBUTION}.`};
  }catch(error){return{provider:'michigan-dnr',status:'unavailable',message:`Michigan DNR provider unavailable: ${(error as Error).message}`}}
 }
}

// Closed contour lines → one "deeper than D" region per contour depth D. Rings at the same depth
// combine even-odd (a same-depth ring inside another is a hump or island rising back above D), and
// the region for D is the union of every level at or below it, so each region nests inside the
// shallower one even where basins use different contour intervals (Hamilton Lake's main basin
// steps 5 → 15 ft while its west basin steps 5 → 10). Exported for tests.
export function contourRegions(input:{depthFt:number;ring:Ring}[]):{depthFt:number;geometry:GeoMultiPolygon}[]{
 // An exact duplicate line would cancel itself out under even-odd.
 const rings=[...new Map(input.map(r=>[`${r.depthFt}|${JSON.stringify(r.ring)}`,r])).values()];
 const depths=[...new Set(rings.map(r=>r.depthFt))].sort((a,b)=>b-a),regions:{depthFt:number;geometry:GeoMultiPolygon}[]=[];
 let deeper:GeoMultiPolygon=[];
 for(const depthFt of depths){
  const level=rings.filter(r=>r.depthFt===depthFt).map(r=>[r.ring] as GeoMultiPolygon[number]),evenOdd=polygonClipping.xor(level[0],...level.slice(1)) as GeoMultiPolygon;
  deeper=deeper.length?polygonClipping.union(evenOdd,deeper) as GeoMultiPolygon:evenOdd;
  if(deeper.length)regions.unshift({depthFt,geometry:deeper});
 }
 return regions;
}

// Sends each lake to the agency for the state it is in. A lake outside every supported state gets
// a plain "no measured source" answer, never another state's near-miss.
export class StateRoutedProvider implements BathymetryProvider{
 id='state-dnr';label='State DNR';
 constructor(private providers:Record<StateCode,BathymetryProvider>={WI:new WisconsinDnrProvider(),MI:new MichiganDnrProvider()},private locate:typeof statesForWater=statesForWater){}
 async resolve(query:BathymetryQuery):Promise<BathymetryProviderResult>{
  const states=await this.locate(query.water,[query.longitude,query.latitude]);
  if(!states.length)return{provider:'none',status:'unavailable',message:'No measured depth source for this state. Automated lookup covers Wisconsin (WI DNR) and Michigan (MI DNR); import a depth-region GeoJSON instead.'};
  const results=await Promise.all(states.map(state=>this.providers[state].resolve(query)));
  return results.find(r=>r.status==='available')??results.find(r=>r.status==='unsupported')??results[0];
 }
}
export class NoaaNceiProvider implements BathymetryProvider{id='noaa-ncei';label='NOAA/NCEI';async resolve():Promise<BathymetryProviderResult>{return{provider:'noaa-ncei',status:'unsupported',sourceUrl:'https://www.ncei.noaa.gov/products/great-lakes-bathymetry',message:'NOAA/NCEI machine-readable contours and grids currently cover the Great Lakes, not generic Wisconsin inland lakes.'}}}
export class UsgsProvider implements BathymetryProvider{id='usgs';label='USGS';async resolve():Promise<BathymetryProviderResult>{return{provider:'usgs',status:'unsupported',sourceUrl:'https://www.usgs.gov/3d-elevation-program/inland-bathymetry',message:'USGS inland bathymetry is survey-specific. Automatic inventory footprint ingestion is not yet implemented.'}}}
