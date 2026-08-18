import type {ExtractedFeatures,GeoLine,GeoPlace,GeoPolygon,LngLat,RoadClass} from '../../types/project';

export type QueryBox=[[number,number],[number,number]];
export type MapFeature={id?:string|number;source?:string;sourceLayer?:string;layer?:{id?:string};geometry:{type:string;coordinates:any};properties?:Record<string,any>};
type FeatureMap={
 getStyle:()=>{sources?:Record<string,{type?:string}>;layers?:Array<{id:string;source?:string;['source-layer']?:string}>};
 queryRenderedFeatures:(box:QueryBox)=>MapFeature[];
};

export type ExtractionDiagnostics={vectorSources:string[];styleLayers:Record<string,string[]>;renderedLayerIds:string[];rawCount:number;sample:Array<{source?:string;sourceLayer?:string;layerId?:string;geometryType:string;properties:Record<string,any>}>};

const roadClass=(v:string):RoadClass|undefined=>({motorway:'motorway',trunk:'trunk',primary:'primary',secondary:'secondary',tertiary:'tertiary',minor:'minor',residential:'minor',unclassified:'minor',service:'service',track:'service'} as Record<string,RoadClass>)[v];
const point=(c:number[]):LngLat=>({lng:c[0],lat:c[1]});
const relevantLayers=new Set(['water','transportation','transportation_name','place']);
const fingerprint=(f:MapFeature)=>`${f.source??''}|${f.sourceLayer??''}|${String(f.id??'')}|${f.geometry.type}|${JSON.stringify(f.geometry.coordinates)}|${JSON.stringify(f.properties??{})}`;

export function extractFeatures(features:MapFeature[]):ExtractedFeatures{
 const seen=new Set<string>(),water:GeoPolygon[]=[],roads:GeoLine[]=[],places:GeoPlace[]=[];
 for(const f of features){
  const layer=f.sourceLayer??'';
  if(!relevantLayers.has(layer))continue;
  const g=f.geometry,p=f.properties??{};
  const id=fingerprint(f);
  if(seen.has(id))continue;
  seen.add(id);
  if(layer==='water'&&g.type==='Polygon')water.push({id,rings:g.coordinates.map((r:number[][])=>r.map(point))});
  if(layer==='water'&&g.type==='MultiPolygon')g.coordinates.forEach((poly:number[][][],i:number)=>water.push({id:`${id}-${i}`,rings:poly.map(r=>r.map(point))}));
  if((layer==='transportation'||layer==='transportation_name')&&(g.type==='LineString'||g.type==='MultiLineString')){
   const cls=roadClass(p.class);
   if(cls){const lines=g.type==='LineString'?[g.coordinates]:g.coordinates;lines.forEach((l:number[][],i:number)=>roads.push({id:`${id}-${i}`,coordinates:l.map(point),class:cls,name:p.name}));}
  }
  if(layer==='place'&&g.type==='Point'&&['city','town','village','hamlet'].includes(p.class))places.push({id,coordinate:point(g.coordinates),name:p.name??'',class:p.class});
 }
 return{water,roads,places};
}

export function extractMapLibreFeatures(map:FeatureMap,box:QueryBox,onDiagnostics?:(diagnostics:ExtractionDiagnostics)=>void):ExtractedFeatures{
 const style=map.getStyle(),vectorSources=Object.entries(style.sources??{}).filter(([,source])=>source.type==='vector').map(([id])=>id);
 if(!vectorSources.length)throw new Error('The current map style has no vector sources.');
 const raw=map.queryRenderedFeatures(box);
 const features=raw.filter(feature=>feature.source&&vectorSources.includes(feature.source));
 const families:Record<string,string[]>=Object.fromEntries(['water','waterway','transportation','transportation_name','place'].map(sourceLayer=>[sourceLayer,(style.layers??[]).filter(layer=>layer.source&&vectorSources.includes(layer.source)&&layer['source-layer']===sourceLayer).map(layer=>layer.id)]));
 onDiagnostics?.({vectorSources,styleLayers:families,renderedLayerIds:[...new Set(raw.map(feature=>feature.layer?.id).filter((id):id is string=>Boolean(id)))],rawCount:raw.length,sample:raw.slice(0,5).map(feature=>({source:feature.source,sourceLayer:feature.sourceLayer,layerId:feature.layer?.id,geometryType:feature.geometry.type,properties:feature.properties??{}}))});
 return extractFeatures(features);
}
