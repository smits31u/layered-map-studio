import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {gunzipSync,strFromU8} from 'fflate';
import type {CaptureMapFeature,CaptureWarning} from '../../src/ornament/capture/mapCapture';
import type {CaptureCounts} from '../../src/ornament/capture/featureTypes';
import {captureTopoFeatures,type StyleLike,type TopoCaptureLayers,type TopoCaptureMap,type TopoCaptureResult} from '../../src/topo/capture/topoCapture';
import type {FrozenTerrainView} from '../../src/topo/terrain/pipeline';
import {frameBounds,mercatorX,mercatorY} from '../../src/topo/terrain/tiles';

// Real recorded fixtures (tests/fixtures/topo/README.md): what MapLibre's queryRenderedFeatures
// returned for a real view of the real OpenFreeMap basemap, recorded in headless Chromium by running
// captureTopoFeatures itself, plus — for the coast — the exact Terrarium tiles the pipeline plans.
//
// replayCapture runs captureTopoFeatures again against a map that answers with those recorded
// queries. It must reproduce the browser's result exactly (the fixture stores it), which makes the
// replay a faithful stand-in for the live map rather than a convenient one.

export type TopoFixtureName='sf-coast'|'sf-city';

export interface RecordedTopoFixture{
 description:string;
 recordedAt:string;
 maplibre:string;
 styleUrl:string;
 request:{center:[number,number];zoom:number;frameWidthPx:number;widthMm:number;heightMm:number};
 canvas:[number,number];
 style:StyleLike;
 rendered:{features:CaptureMapFeature[];labels:CaptureMapFeature[]};
 expected:{counts:CaptureCounts;water:number;roads:number;labels:number;duplicateLabels:number;layers:TopoCaptureLayers;view:FrozenTerrainView;warnings:CaptureWarning[]};
 tiles:string[];
}

const dir=(name:TopoFixtureName)=>resolve(__dirname,'..','fixtures','topo',name);
const cache=new Map<TopoFixtureName,RecordedTopoFixture>();

export function loadTopoFixture(name:TopoFixtureName):RecordedTopoFixture{
 let fixture=cache.get(name);
 if(!fixture){
  fixture=JSON.parse(strFromU8(gunzipSync(new Uint8Array(readFileSync(resolve(dir(name),'rendered.json.gz')))))) as RecordedTopoFixture;
  cache.set(name,fixture);
 }
 return fixture;
}

// The Terrarium PNGs exactly as the terrain proxy served them, keyed "z/x/y" as generateTerrain wants.
export function loadFixtureTiles(name:TopoFixtureName):Record<string,Uint8Array>{
 const fixture=loadTopoFixture(name);
 return Object.fromEntries(fixture.tiles.map(key=>[key,new Uint8Array(readFileSync(resolve(dir(name),`${key.replaceAll('/','-')}.png`)))]));
}

// A map answering exactly as the recorded one did: its centre, zoom and element size, real Web
// Mercator projection (the capture cross-checks it), its style's layer list, and the recorded
// rendered features for whichever of the recorded layers are asked for.
export function replayMap(fixture:RecordedTopoFixture):TopoCaptureMap&{queries:string[][]}{
 const {center,zoom}=fixture.request;
 const [width,height]=fixture.canvas;
 const world=512*2**zoom;
 const recorded=[...fixture.rendered.features,...fixture.rendered.labels];
 const queries:string[][]=[];
 return {
  queries,
  isStyleLoaded:()=>true,loaded:()=>true,areTilesLoaded:()=>true,
  once(){},off(){},
  getCenter:()=>({lng:center[0],lat:center[1]}),
  getZoom:()=>zoom,getBearing:()=>0,getPitch:()=>0,
  getBounds(){const b=frameBounds(center,zoom,width,height);return {getWest:()=>b.west,getSouth:()=>b.south,getEast:()=>b.east,getNorth:()=>b.north}},
  getCanvas:()=>({clientWidth:width,clientHeight:height}),
  project:([lng,lat])=>({x:width/2+(mercatorX(lng)-mercatorX(center[0]))*world,y:height/2+(mercatorY(lat)-mercatorY(center[1]))*world}),
  queryRenderedFeatures(_box,options){
   const layers=options?.layers??[];
   queries.push([...layers]);
   return recorded.filter(feature=>layers.includes(feature.layer?.id??''));
  },
  getStyle:()=>fixture.style,
 };
}

export function replayCapture(fixture:RecordedTopoFixture):Promise<TopoCaptureResult>{
 const {frameWidthPx,widthMm,heightMm}=fixture.request;
 return captureTopoFeatures(replayMap(fixture),{frameWidthPx,widthMm,heightMm,now:()=>0});
}
