import {getMapLibre} from '../../../../src/ornament/map/maplibreGlobal';
import {captureTopoFeatures,discoverCaptureLayers,type StyleLike,type TopoCaptureMap} from '../../../../src/topo/capture/topoCapture';
import {terrainTilePlan} from '../../../../src/topo/terrain/pipeline';
import {tileKey} from '../../../../src/topo/terrain/tiles';

// The browser half of the fixture recorder (README.md in the parent directory). Served by the Vite
// dev server, so it runs the app's own captureTopoFeatures against the real MapLibre build and the
// real basemap style, exactly as TopoMap does, and the terrain tiles come through the app's own
// /api/terrain proxy. Not part of the app or its bundle.

const STYLE_URL=import.meta.env.VITE_MAP_STYLE_URL||'https://tiles.openfreemap.org/styles/bright';
// The properties the capture reads; the rest (dozens of name translations) are dropped.
const KEEP=['class','subclass','name','name:latin','name:en','rank','brunnel','intermittent'];

interface RecordRequest{center:[number,number];zoom:number;frameWidthPx:number;widthMm:number;heightMm:number;withTiles:boolean}
type RenderedFeature={geometry:{type:string;coordinates:unknown};properties?:Record<string,unknown>|null;sourceLayer?:string;layer?:{id?:string}};
type RecorderStyle=StyleLike&{sources:Record<string,{type?:string}>;layers:{id:string;type?:string;source?:string;'source-layer'?:string}[]};
type RecorderMap=Omit<TopoCaptureMap,'getStyle'>&{jumpTo(options:{center:[number,number];zoom:number}):void;getStyle():RecorderStyle};

const maplibregl=getMapLibre();
if(!maplibregl)throw new Error('MapLibre did not load.');
const host=document.getElementById('map')!;
const map=new maplibregl.Map({container:host,style:STYLE_URL,center:[0,0],zoom:2,bearing:0,pitch:0,dragRotate:false,pitchWithRotate:false,attributionControl:false}) as unknown as RecorderMap;
const loaded=new Promise<void>(resolve=>map.once('load',()=>resolve()));

const strip=(f:RenderedFeature)=>({geometry:{type:f.geometry.type,coordinates:f.geometry.coordinates},properties:Object.fromEntries(KEEP.filter(k=>f.properties?.[k]!==undefined).map(k=>[k,f.properties![k]])),sourceLayer:f.sourceLayer,layer:{id:f.layer?.id}});
const base64=(bytes:Uint8Array)=>{let s='';for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(s)};

(window as unknown as {recordFixture:(request:RecordRequest)=>Promise<string>}).recordFixture=async request=>{
 await loaded;
 map.jumpTo({center:request.center,zoom:request.zoom});
 const result=await captureTopoFeatures(map,{frameWidthPx:request.frameWidthPx,widthMm:request.widthMm,heightMm:request.heightMm,idleTimeoutMs:60_000,now:()=>0});
 // The capture's own queries, repeated on the same settled map before dedupe, for replay in tests.
 const style=map.getStyle();
 const layers=discoverCaptureLayers(style);
 const {view,viewport}=result.capture;
 const cx=viewport.widthPx/2,cy=viewport.heightPx/2;
 const box:[[number,number],[number,number]]=[[cx-view.frameWidthPx/2,cy-view.frameHeightPx/2],[cx+view.frameWidthPx/2,cy+view.frameHeightPx/2]];
 const rendered={
  features:map.queryRenderedFeatures(box,{layers:[...layers.water,...layers.roads]}).map(strip),
  labels:layers.labels.length?map.queryRenderedFeatures(box,{layers:layers.labels}).map(strip):[],
 };
 const tiles:Record<string,string>={};
 if(request.withTiles)for(const tile of terrainTilePlan(view).tiles){
  const response=await fetch(`/api/terrain/${tileKey(tile)}.png`);
  if(!response.ok)throw new Error(`Terrain tile ${tileKey(tile)}: HTTP ${response.status}`);
  tiles[tileKey(tile)]=base64(new Uint8Array(await response.arrayBuffer()));
 }
 const version=(maplibregl as unknown as {getVersion?:()=>string}).getVersion?.()??'unknown';
 return JSON.stringify({
  result,rendered,styleUrl:STYLE_URL,maplibre:version,canvas:[viewport.widthPx,viewport.heightPx],tiles,
  style:{sources:Object.fromEntries(Object.entries(style.sources).map(([id,s])=>[id,{type:s.type}])),layers:style.layers.map(l=>({id:l.id,type:l.type,...(l.source?{source:l.source}:{}),...(l['source-layer']?{'source-layer':l['source-layer']}:{})}))},
 });
};
