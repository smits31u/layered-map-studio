import {defaultProject} from '../defaultProject';
import {validateDimensionMm} from '../../utils/units';
import {DEFAULT_SIMPLE_TERRAIN_CONTROLS} from '../../geometry/terrain/terrainParams';
import {MARKER_REGISTRY} from '../../geometry/scene/markerRegistry';
import type {CropGeography,ExtractedFeatures,GeoLine,GeoPlace,GeoPolygon,LngLat,MapMarker,MapProject,ObjectOverride} from '../../types/project';

// Turns a stored or imported lake project back into one the app can safely run. Everything read
// from storage or from a file somebody picked is untrusted: a value is kept only if it has the type
// the default has (and, for the choices, is one of the allowed choices); anything else falls back to
// the default, so a hand-edited, truncated or older file opens instead of crashing the editor.

type Obj=Record<string,unknown>;
const obj=(v:unknown):Obj|undefined=>v&&typeof v==='object'&&!Array.isArray(v)?v as Obj:undefined;
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const oneOf=<T extends string>(v:unknown,allowed:readonly T[],fallback:T):T=>typeof v==='string'&&(allowed as readonly string[]).includes(v)?v as T:fallback;

// Copies `raw` over `base` key by key, keeping a raw value only when it has the base value's type.
// Plain objects merge recursively; arrays are kept only when every element matches the base array's
// first element's type. Keys the base does not have are dropped.
function mergeTyped<T>(base:T,raw:unknown):T{
 const r=obj(raw);
 if(!r||!obj(base))return base;
 const out:Obj={...(base as Obj)};
 for(const [key,baseValue] of Object.entries(base as Obj)){
  const value=r[key];
  if(value===undefined)continue;
  if(Array.isArray(baseValue)){
   if(Array.isArray(value)&&(baseValue.length===0||value.every(x=>typeof x===typeof baseValue[0]&&(typeof x!=='number'||Number.isFinite(x)))))out[key]=value;
  }else if(obj(baseValue))out[key]=mergeTyped(baseValue,value);
  else if(typeof baseValue==='number'){if(finite(value))out[key]=value}
  else if(typeof value===typeof baseValue)out[key]=value;
 }
 return out as T;
}

const lngLat=(v:unknown):LngLat|undefined=>{const o=obj(v);return o&&finite(o.lng)&&finite(o.lat)&&Math.abs(o.lat)<=90&&Math.abs(o.lng)<=540?{lng:o.lng,lat:o.lat}:undefined};

function crop(v:unknown):CropGeography|undefined{
 const o=obj(v);if(!o)return undefined;
 const nw=lngLat(o.nw),ne=lngLat(o.ne),se=lngLat(o.se),sw=lngLat(o.sw);
 const bbox=Array.isArray(o.bbox)&&o.bbox.length===4&&o.bbox.every(finite)?o.bbox as [number,number,number,number]:undefined;
 return nw&&ne&&se&&sw&&bbox?{nw,ne,se,sw,bbox}:undefined;
}

const override=(v:unknown):ObjectOverride|undefined=>{
 const o=obj(v);if(!o)return undefined;
 const out:ObjectOverride={};
 for(const k of ['xMm','yMm','rotationDeg','scale'] as const)if(finite(o[k]))out[k]=o[k] as number;
 for(const k of ['visible','flipSide'] as const)if(typeof o[k]==='boolean')out[k]=o[k] as boolean;
 return out;
};

const MARKER_TYPES=MARKER_REGISTRY.map(m=>m.type);
const MARKER_DEFAULT:MapMarker={id:'',markerType:'pin',sizeMm:8,rotationDeg:0,showLabel:false,labelSizeMm:3,visible:true,operation:'engrave',keepOutEnabled:false,keepOutPaddingMm:2};
function marker(v:unknown):MapMarker|undefined{
 const o=obj(v);if(!o||typeof o.id!=='string'||!o.id)return undefined;
 const m=mergeTyped(MARKER_DEFAULT,o);
 return {...m,id:o.id,markerType:oneOf(o.markerType,MARKER_TYPES,'pin'),operation:oneOf(o.operation,['engrave','cut'] as const,'engrave'),
  ...(typeof o.address==='string'?{address:o.address}:{}),...(finite(o.lat)&&finite(o.lng)?{lat:o.lat,lng:o.lng}:{}),...(typeof o.label==='string'?{label:o.label}:{})};
}

const FONTS=['inter','cinzel','great-vibes'] as const;
const PRESETS=['xfine','fine','narrow','normal','wide','custom'] as const;

export function normalizeMapProject(raw:unknown):MapProject{
 const o=obj(raw);
 if(!o||o.version!==1)throw new Error('This is not a lake map project this version of the studio can open.');
 const base=defaultProject;
 const p=mergeTyped(base,o);
 const mapIn=obj(o.map)??{};
 const dims=obj(o.dimensions)??{};
 const shoreIn=obj(o.shoreline)??{};
 const bathIn=obj(o.bathymetry)??{};
 const widthMm=finite(dims.widthMm)&&validateDimensionMm(dims.widthMm)?dims.widthMm:base.dimensions.widthMm;
 const heightMm=finite(dims.heightMm)&&validateDimensionMm(dims.heightMm)?dims.heightMm:base.dimensions.heightMm;
 const enabledLayers=Array.isArray(shoreIn.enabledLayers)&&shoreIn.enabledLayers.length===7&&shoreIn.enabledLayers.every(x=>typeof x==='boolean')?shoreIn.enabledLayers as boolean[]:base.shoreline.enabledLayers;
 const numbers=(v:unknown)=>Array.isArray(v)&&v.every(finite)?v as number[]:undefined;
 const cropValue=crop(mapIn.crop);
 const dataset=obj(bathIn.dataset)&&Array.isArray(obj(bathIn.dataset)!.contours)&&obj(obj(bathIn.dataset)!.source)?bathIn.dataset as MapProject['bathymetry']['dataset']:undefined;
 const terrain=obj(bathIn.terrain)?mergeTyped(DEFAULT_SIMPLE_TERRAIN_CONTROLS,bathIn.terrain):undefined;
 const artistic=numbers(shoreIn.artisticOffsetsNormalized);
 return {
  ...p,
  version:1,
  map:{latitude:finite(mapIn.latitude)&&Math.abs(mapIn.latitude)<=85?mapIn.latitude:base.map.latitude,longitude:finite(mapIn.longitude)&&Math.abs(mapIn.longitude)<=540?mapIn.longitude:base.map.longitude,zoom:finite(mapIn.zoom)?Math.min(24,Math.max(0,mapIn.zoom)):base.map.zoom,bearing:finite(mapIn.bearing)?mapIn.bearing:base.map.bearing,...(cropValue?{crop:cropValue}:{})},
  dimensions:{widthMm,heightMm,displayUnit:oneOf(dims.displayUnit,['in','mm'] as const,base.dimensions.displayUnit),lockAspect:typeof dims.lockAspect==='boolean'?dims.lockAspect:base.dimensions.lockAspect},
  shoreline:{
   enabledLayers,
   offsetsMm:numbers(shoreIn.offsetsMm)??base.shoreline.offsetsMm,
   ...(artistic?{artisticOffsetsNormalized:artistic}:{}),
   preset:oneOf(shoreIn.preset,PRESETS,base.shoreline.preset),
   waterMode:oneOf(shoreIn.waterMode,['all','primary'] as const,base.shoreline.waterMode??'primary'),
   ...(finite(shoreIn.minWaterAreaMm2)&&shoreIn.minWaterAreaMm2>=0?{minWaterAreaMm2:shoreIn.minWaterAreaMm2}:{minWaterAreaMm2:base.shoreline.minWaterAreaMm2}),
   ...(finite(shoreIn.minArtisticComponentAreaNormalized)?{minArtisticComponentAreaNormalized:shoreIn.minArtisticComponentAreaNormalized}:{}),
  },
  bathymetry:{
   ...p.bathymetry,
   mode:oneOf(bathIn.mode,['true-bathymetry','decorative-offsets','procedural-terrain'] as const,base.bathymetry.mode),
   selection:oneOf(bathIn.selection,['automatic','manual'] as const,'automatic'),
   thresholdsMeters:numbers(bathIn.thresholdsMeters)??[],
   status:oneOf(bathIn.status,['unchecked','available','unavailable','unsupported','error'] as const,'unchecked'),
   ...(typeof bathIn.statusMessage==='string'?{statusMessage:bathIn.statusMessage}:{}),
   ...(typeof bathIn.provider==='string'?{provider:bathIn.provider as MapProject['bathymetry']['provider']}:{}),
   ...(typeof bathIn.datasetId==='string'?{datasetId:bathIn.datasetId}:{}),
   ...(dataset?{dataset}:{}),
   ...(terrain?{terrain}:{}),
  },
  roads:{...p.roads,mode:oneOf(p.roads.mode,['all','main','off'] as const,'all')},
  roadLabels:{...p.roadLabels,font:oneOf(p.roadLabels.font,FONTS,base.roadLabels.font)},
  placeLabels:{...p.placeLabels,font:oneOf(p.placeLabels.font,FONTS,base.placeLabels.font)},
  compass:{...p.compass,style:oneOf(p.compass.style,['classic','rose','minimal','classic-rose'] as const,base.compass.style),position:oneOf(p.compass.position,['top-left','top-right','bottom-left','bottom-right','custom','off'] as const,base.compass.position)},
  title:{...p.title,font:oneOf(p.title.font,FONTS,base.title.font),backer:oneOf(p.title.backer,['none','offset','rectangle'] as const,'none')},
  subtitle:{...p.subtitle,font:oneOf(p.subtitle.font,FONTS,base.subtitle.font)},
  exportSettings:{...p.exportSettings,layout:oneOf(p.exportSettings.layout,['production','registered','individual'] as const,'production')},
  overrides:Object.fromEntries(Object.entries(obj(o.overrides)??{}).map(([k,v])=>[k,override(v)]).filter((e):e is [string,ObjectOverride]=>Boolean(e[1]))),
  markers:Array.isArray(o.markers)?o.markers.map(marker).filter((m):m is MapMarker=>Boolean(m)):[],
 };
}

// The captured geography saved with a project, so reopening it rebuilds exactly what was quoted and
// cut, even after the map data has changed. Malformed entries are dropped.
export function normalizeFeatures(raw:unknown):ExtractedFeatures{
 const o=obj(raw)??{};
 const list=<T>(v:unknown,f:(x:unknown)=>T|undefined)=>Array.isArray(v)?v.map(f).filter((x):x is T=>x!==undefined):[];
 const points=(v:unknown)=>Array.isArray(v)?v.map(lngLat):[];
 const water=list<GeoPolygon>(o.water,v=>{const w=obj(v);if(!w||typeof w.id!=='string'||!Array.isArray(w.rings))return undefined;const rings=w.rings.map(points);return rings.every(r=>r.length>=3&&r.every(Boolean))?{id:w.id,rings:rings as LngLat[][]}:undefined});
 const roads=list<GeoLine>(o.roads,v=>{const r=obj(v);if(!r||typeof r.id!=='string')return undefined;const coordinates=points(r.coordinates);return coordinates.length>=2&&coordinates.every(Boolean)?{id:r.id,coordinates:coordinates as LngLat[],class:oneOf(r.class,['motorway','trunk','primary','secondary','tertiary','minor','service'] as const,'minor'),...(typeof r.name==='string'?{name:r.name}:{})}:undefined});
 const places=list<GeoPlace>(o.places,v=>{const p=obj(v);const c=lngLat(p?.coordinate);return p&&c&&typeof p.id==='string'&&typeof p.name==='string'?{id:p.id,coordinate:c,name:p.name,class:oneOf(p.class,['city','town','village','hamlet'] as const,'hamlet')}:undefined});
 return {water,roads,places};
}
