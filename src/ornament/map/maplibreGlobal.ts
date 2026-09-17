// A narrow, typed facade over the MapLibre global.
//
// MapLibre is loaded from a version-pinned CDN `<script>` in index.html (5.6.2), which is how the
// lake map tool has always consumed it. Phase 2 had to decide whether to keep that or take it as an
// npm dependency; keeping it is recorded in docs/adr/0003. What is *not* kept is the lake tool's
// `declare const maplibregl:any`: an `any` map object would let a typo in a method name reach the
// browser, so the ornament declares the surface it actually uses and nothing more.
//
// Declaring less than MapLibre offers is deliberate. This interface is the list of things the
// ornament is allowed to do to a map, and it does not include `setBearing` to a non-zero value or
// anything that would tilt it.

export interface LngLatLike{lng:number;lat:number}
export interface PointLike{x:number;y:number}

export interface OrnamentMapInstance{
 on(event:string,handler:(event?:unknown)=>void):void;
 off(event:string,handler:(event?:unknown)=>void):void;
 remove():void;
 resize():void;
 getCenter():LngLatLike;
 getZoom():number;
 getBearing():number;
 getPitch():number;
 jumpTo(options:{center?:[number,number];zoom?:number;bearing?:number;pitch?:number}):void;
 easeTo(options:{center?:[number,number];zoom?:number;duration?:number}):void;
 fitBounds(bounds:[[number,number],[number,number]],options?:{padding?:number;maxZoom?:number;duration?:number}):void;
 project(lngLat:[number,number]):PointLike;
 // Added in Phase 3 for feature capture. `queryRenderedFeatures` is declared with the narrow
 // signature the ornament uses — no geometry argument, an explicit layer list — because the layer
 // list is not optional here: querying without it would pull in whatever else a future style draws.
 queryRenderedFeatures(geometry?:unknown,options?:{layers?:string[]}):{geometry:{type:string;coordinates:unknown};properties?:Record<string,unknown>|null;layer?:{id?:string};sourceLayer?:string}[];
 getBounds():{getWest():number;getSouth():number;getEast():number;getNorth():number};
 // The canvas' CSS size, not its drawing buffer: the export scale is millimetres per *CSS* pixel,
 // and on a HiDPI display the two differ by the device pixel ratio.
 getCanvas():{clientWidth:number;clientHeight:number};
 once(event:string,handler:()=>void):void;
 loaded():boolean;
 areTilesLoaded():boolean;
 unproject(point:[number,number]):LngLatLike;
 setLayoutProperty(layerId:string,name:string,value:unknown):void;
 getLayer(layerId:string):unknown;
 getSource(sourceId:string):unknown;
 isStyleLoaded():boolean;
 dragRotate:{disable():void};
 touchZoomRotate:{disableRotation():void};
}

export interface MapLibreGlobal{
 Map:new(options:Record<string,unknown>)=>OrnamentMapInstance;
 NavigationControl:new(options?:Record<string,unknown>)=>unknown;
}

declare global{
 // eslint-disable-next-line no-var
 var maplibregl:MapLibreGlobal|undefined;
}

export const getMapLibre=():MapLibreGlobal|undefined=>(typeof globalThis.maplibregl==='undefined'?undefined:globalThis.maplibregl);

// MapLibre needs WebGL. Probing for it keeps the ornament editor usable — with the frame, the text
// and the controls all working — on a machine or a test environment that cannot render a map,
// rather than throwing during the first render. The probe only runs when MapLibre itself is
// present, so a jsdom test never reaches a canvas context it does not implement.
export function supportsInteractiveMap():boolean{
 if(!getMapLibre())return false;
 try{
  const canvas=document.createElement('canvas');
  return Boolean(canvas.getContext('webgl2')||canvas.getContext('webgl'));
 }catch{return false}
}
