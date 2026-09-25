import {useCallback,useEffect,useRef,useState,type CSSProperties} from 'react';
import {getMapLibre,supportsInteractiveMap,type OrnamentMapInstance} from '../../ornament/map/maplibreGlobal';
import {TOPO_LIMITS,type TopoRoute} from '../types';

// The topo builder's map: MapLibre with bearing and pitch locked at 0, a crop frame at the board's
// aspect ratio, and the loaded GPX route drawn over it.
//
// Reuses rather than rebuilds: the MapLibre global comes through the ornament's typed facade (ADR
// 0003), the basemap is the same OpenFreeMap style the lake tool renders (VITE_MAP_STYLE_URL), and
// the frame uses the lake tool's `.crop-frame` class. What is new is the route overlay and the
// two-way viewport sync.
//
// The route is drawn as an SVG overlay re-projected through `map.project` on every move, not as a
// MapLibre layer. That keeps it independent of the basemap style (no layer to re-add after a style
// load, nothing to collide with the style's own ids), and it is the same projection the export will
// use, so what the overlay shows is where the route will be cut.

const STYLE_URL=import.meta.env.VITE_MAP_STYLE_URL||'https://tiles.openfreemap.org/styles/bright';
// A prop change within these tolerances is the echo of a movement the map itself reported, not an
// instruction; without them every moveend would bounce map → store → map.
const SAME_CENTER=1e-7,SAME_ZOOM=1e-4;
const FIT_MARGIN_PX=16;

type Padding={top:number;bottom:number;left:number;right:number};
type TopoMapInstance=Omit<OrnamentMapInstance,'fitBounds'>&{fitBounds(bounds:[[number,number],[number,number]],options?:{padding?:number|Padding;maxZoom?:number;duration?:number}):void};

type Props={
 center:[number,number];
 zoom:number;
 widthMm:number;
 heightMm:number;
 route:TopoRoute|null;
 // A token, not a callback holding the map: the MapLibre object never leaves this component.
 fitRequest?:{bounds:[number,number,number,number];token:number};
 onViewportChange:(view:{center:[number,number];zoom:number})=>void;
 // Filled in while mounted, for "Generate terrain" to freeze the view. A handle rather than the map
 // itself, for the same reason as fitRequest.
 handleRef?:{current:TopoMapHandle|null};
};

export interface TopoMapHandle{
 // The live centre and zoom, and the crop frame's width in CSS pixels: what generation freezes.
 frozenFrame():{center:[number,number];zoom:number;frameWidthPx:number};
}

// The crop frame is `width:min(75%, 75vh·ratio)` of the map (styles.css). When layout reports no size
// (a hidden pane, or jsdom) the frame is assumed to be that 75% of the map element's width.
const FRAME_FRACTION=.75,FALLBACK_MAP_WIDTH_PX=640;

export function TopoMap({center,zoom,widthMm,heightMm,route,fitRequest,onViewportChange,handleRef}:Props){
 const host=useRef<HTMLDivElement>(null),frame=useRef<HTMLDivElement>(null);
 const mapRef=useRef<TopoMapInstance|undefined>(undefined);
 const [error,setError]=useState('');
 const [routePath,setRoutePath]=useState('');
 // Read from map event handlers, which are registered once.
 const latest=useRef({route,onViewportChange});
 latest.current={route,onViewportChange};

 const redrawRoute=useCallback(()=>{
  const map=mapRef.current,current=latest.current.route;
  if(!map||!current){setRoutePath('');return}
  setRoutePath(current.segments.map(segment=>segment.map(([lng,lat],i)=>{const p=map.project([lng,lat]);return `${i?'L':'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`}).join(' ')).join(' '));
 },[]);

 useEffect(()=>{
  const maplibregl=getMapLibre();
  if(!host.current)return;
  if(!maplibregl||!supportsInteractiveMap()){
   setError('This browser cannot display an interactive map (WebGL is unavailable). Board size and GPX loading still work.');
   return;
  }
  let map:TopoMapInstance;
  try{
   map=new maplibregl.Map({
    container:host.current,
    style:STYLE_URL,
    center,
    zoom,
    bearing:0,
    pitch:0,
    minZoom:TOPO_LIMITS.zoom.min,
    maxZoom:TOPO_LIMITS.zoom.max,
    // Disabling rotation is what actually enforces the plan's bearing-0/pitch-0 rule; setting the
    // initial values alone would let a right-drag rotate the map away from them.
    dragRotate:false,
    pitchWithRotate:false,
    touchPitch:false,
   }) as unknown as TopoMapInstance;
  }catch(reason){
   setError(`The map could not be created: ${(reason as Error).message}`);
   return;
  }
  mapRef.current=map;
  map.dragRotate.disable();
  map.touchZoomRotate.disableRotation();
  const report=()=>{const c=map.getCenter();latest.current.onViewportChange({center:[c.lng,c.lat],zoom:map.getZoom()})};
  map.on('move',redrawRoute);
  map.on('load',redrawRoute);
  map.on('moveend',report);
  redrawRoute();
  return ()=>{mapRef.current=undefined;map.remove()};
  // The map is created once; later prop changes reach it through the effects below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);

 // Store → map, for changes that did not come from the map (search, the zoom control, a reload).
 useEffect(()=>{
  const map=mapRef.current;
  if(!map)return;
  const c=map.getCenter();
  if(Math.abs(c.lng-center[0])>SAME_CENTER||Math.abs(c.lat-center[1])>SAME_CENTER||Math.abs(map.getZoom()-zoom)>SAME_ZOOM)map.jumpTo({center,zoom});
 },[center,zoom]);

 useEffect(redrawRoute,[route,redrawRoute]);

 const viewProps=useRef({center,zoom});
 viewProps.current={center,zoom};
 useEffect(()=>{
  if(!handleRef)return;
  handleRef.current={frozenFrame(){
   const map=mapRef.current,c=map?.getCenter();
   const measured=frame.current?.getBoundingClientRect().width??0;
   const frameWidthPx=measured>0?measured:(host.current?.clientWidth||FALLBACK_MAP_WIDTH_PX)*FRAME_FRACTION;
   return {center:c?[c.lng,c.lat]:[viewProps.current.center[0],viewProps.current.center[1]],zoom:map?map.getZoom():viewProps.current.zoom,frameWidthPx};
  }};
  return ()=>{handleRef.current=null};
 },[handleRef]);

 // Fit so the bounds land inside the crop frame, not merely inside the map: the frame is the board,
 // and a route fitted to the whole map would spill past the part that gets cut.
 useEffect(()=>{
  const map=mapRef.current;
  if(!map||!fitRequest)return;
  const [west,south,east,north]=fitRequest.bounds;
  const hostBox=host.current?.getBoundingClientRect(),frameBox=frame.current?.getBoundingClientRect();
  const padding:Padding|number=hostBox&&frameBox&&frameBox.width>0&&frameBox.height>0
   ?{top:frameBox.top-hostBox.top+FIT_MARGIN_PX,bottom:hostBox.bottom-frameBox.bottom+FIT_MARGIN_PX,left:frameBox.left-hostBox.left+FIT_MARGIN_PX,right:hostBox.right-frameBox.right+FIT_MARGIN_PX}
   :40;
  map.fitBounds([[west,south],[east,north]],{padding,maxZoom:TOPO_LIMITS.zoom.max,duration:0});
 },[fitRequest]);

 const ratio=widthMm/heightMm;
 const frameStyle:CSSProperties&{'--ratio':number}={aspectRatio:String(ratio),'--ratio':ratio};
 return <div className="map-host topo-map" ref={host}>
  <div className="crop-frame" ref={frame} style={frameStyle} data-testid="topo-crop-frame" aria-label={`Board crop, ${widthMm.toFixed(1)} by ${heightMm.toFixed(1)} millimetres`}/>
  {routePath&&<svg className="topo-route-overlay" aria-hidden="true"><path d={routePath}/></svg>}
  {error&&<p className="map-error" role="alert">{error}</p>}
 </div>;
}
