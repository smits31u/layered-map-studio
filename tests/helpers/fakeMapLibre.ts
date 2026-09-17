import {vi} from 'vitest';
import type {CaptureMapFeature} from '../../src/ornament/capture/mapCapture';
import {MAPLIBRE_TILE_SIZE} from '../../src/ornament/geometry/mapProjection';
import {FIXTURE_CANVAS_PX} from '../fixtures/ornament/captures';
import {boundsFor} from './ornamentCapture';

// A fake MapLibre, enough of one to drive feature capture end to end in jsdom.
//
// Phase 2 could not do this: its tests drove the store through the controls and documented that the
// map's own gestures need WebGL. Phase 3 changed what the capture button does — it now reads the
// map — so "click capture, expect a snapshot" stopped being a statement about the store and became a
// statement about a map that is not there. Rather than delete those acceptance tests or weaken them
// into unit tests of the readiness function (which `ornamentSnapshot.test.ts` already covers), this
// supplies a map.
//
// The fake is honest in the one place it has to be: `project` is real Web Mercator with 512px tiles,
// because `captureOrnamentFeatures` cross-checks its own projection against `map.project` and throws
// if they disagree. A fake that returned convenient numbers would make that check pass vacuously.
// Everything else — tiles, rendering, gestures — is absent, and the fake reports itself as loaded
// and idle immediately.

export interface FakeMapState{
 center:{lng:number;lat:number};
 zoom:number;
 layerVisibility:Record<string,string>;
 queries:{layers:string[]}[];
 resizes:number;
}

export interface FakeMapLibreOptions{
 features?:CaptureMapFeature[];
 canvasSizePx?:number;
 // Set to make every capture report the map as still loading tiles, to drive the "not idle" warning.
 neverIdle?:boolean;
}

export interface InstalledFakeMapLibre{
 state:FakeMapState;
 setFeatures(features:CaptureMapFeature[]):void;
 uninstall():void;
}

const mercatorY=(lat:number)=>{
 const rad=lat*Math.PI/180;
 return (1-Math.log(Math.tan(rad)+1/Math.cos(rad))/Math.PI)/2;
};

export function installFakeMapLibre(options:FakeMapLibreOptions={}):InstalledFakeMapLibre{
 const size=options.canvasSizePx??FIXTURE_CANVAS_PX;
 let features=options.features??[];
 const state:FakeMapState={center:{lng:0,lat:0},zoom:0,layerVisibility:{},queries:[],resizes:0};

 // The preview measures its container to build the millimetre-to-pixel transform, and jsdom reports
 // every element as zero-sized. Without this the preview decides the map is not on screen and never
 // mounts it.
 const elementProto=globalThis.HTMLElement.prototype as unknown as Record<string,unknown>;
 const originalWidth=Object.getOwnPropertyDescriptor(elementProto,'clientWidth');
 const originalHeight=Object.getOwnPropertyDescriptor(elementProto,'clientHeight');
 Object.defineProperty(elementProto,'clientWidth',{configurable:true,get(){return 640}});
 Object.defineProperty(elementProto,'clientHeight',{configurable:true,get(){return 640}});

 // `supportsInteractiveMap()` probes for a WebGL context before creating a map.
 const originalGetContext=globalThis.HTMLCanvasElement.prototype.getContext;
 globalThis.HTMLCanvasElement.prototype.getContext=function(this:HTMLCanvasElement,id:string){
  if(id==='webgl'||id==='webgl2')return {} as unknown as RenderingContext;
  return null;
 } as typeof originalGetContext;

 class FakeMap{
  private handlers=new Map<string,Set<(event?:unknown)=>void>>();
  dragRotate={disable(){}};
  touchZoomRotate={disableRotation(){}};
  constructor(config:Record<string,unknown>){
   const center=config.center as [number,number];
   state.center={lng:center[0],lat:center[1]};
   state.zoom=config.zoom as number;
   // MapLibre fires `load` asynchronously; so does this, so a test that asserts on the pre-load
   // render still sees it.
   setTimeout(()=>this.fire('load'),0);
  }
  private fire(event:string){for(const handler of this.handlers.get(event)??[])handler()}
  on(event:string,handler:(event?:unknown)=>void){(this.handlers.get(event)??this.handlers.set(event,new Set()).get(event)!).add(handler)}
  off(event:string,handler:(event?:unknown)=>void){this.handlers.get(event)?.delete(handler)}
  once(event:string,handler:()=>void){
   const wrapped=()=>{this.off(event,wrapped);handler()};
   this.on(event,wrapped);
   if(event==='idle'&&!options.neverIdle)setTimeout(()=>this.fire('idle'),0);
  }
  remove(){this.handlers.clear()}
  resize(){state.resizes++}
  getCenter(){return {...state.center}}
  getZoom(){return state.zoom}
  getBearing(){return 0}
  getPitch(){return 0}
  loaded(){return !options.neverIdle}
  areTilesLoaded(){return !options.neverIdle}
  isStyleLoaded(){return true}
  jumpTo(to:{center?:[number,number];zoom?:number}){
   if(to.center)state.center={lng:to.center[0],lat:to.center[1]};
   if(typeof to.zoom==='number')state.zoom=to.zoom;
   this.fire('move');
   this.fire('moveend');
  }
  easeTo(to:{center?:[number,number];zoom?:number}){this.jumpTo(to)}
  fitBounds(bounds:[[number,number],[number,number]]){
   this.jumpTo({center:[(bounds[0][0]+bounds[1][0])/2,(bounds[0][1]+bounds[1][1])/2]});
  }
  getBounds(){
   const [west,south,east,north]=boundsFor([state.center.lng,state.center.lat],state.zoom,size);
   return {getWest:()=>west,getSouth:()=>south,getEast:()=>east,getNorth:()=>north};
  }
  getCanvas(){return {clientWidth:size,clientHeight:size}}
  project(lngLat:[number,number]){
   const worldSize=MAPLIBRE_TILE_SIZE*Math.pow(2,state.zoom);
   return {
    x:size/2+((lngLat[0]+180)/360-(state.center.lng+180)/360)*worldSize,
    y:size/2+(mercatorY(lngLat[1])-mercatorY(state.center.lat))*worldSize,
   };
  }
  unproject(){return {...state.center}}
  setLayoutProperty(layerId:string,name:string,value:unknown){if(name==='visibility')state.layerVisibility[layerId]=String(value)}
  getLayer(layerId:string){return {id:layerId}}
  getSource(){return {vectorLayerIds:['water','transportation']}}
  queryRenderedFeatures(_geometry?:unknown,queryOptions?:{layers?:string[]}){
   const layers=queryOptions?.layers??[];
   state.queries.push({layers:[...layers]});
   // A real query returns only what the named layers drew. Filtering by the fixture's recorded layer
   // id is what makes "changing detail changes captured road classes" a real assertion rather than
   // one about a filter applied twice.
   return features.filter(feature=>!feature.layer?.id||layers.includes(feature.layer.id));
  }
 }

 vi.stubGlobal('maplibregl',{Map:FakeMap,NavigationControl:class{}});

 return {
  state,
  setFeatures(next){features=next},
  uninstall(){
   vi.unstubAllGlobals();
   globalThis.HTMLCanvasElement.prototype.getContext=originalGetContext;
   if(originalWidth)Object.defineProperty(elementProto,'clientWidth',originalWidth);
   else delete elementProto.clientWidth;
   if(originalHeight)Object.defineProperty(elementProto,'clientHeight',originalHeight);
   else delete elementProto.clientHeight;
  },
 };
}
