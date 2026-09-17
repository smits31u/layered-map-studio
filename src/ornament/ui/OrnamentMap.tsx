import {useEffect,useRef,useState} from 'react';
import {captureOrnamentFeatures,type CaptureMap} from '../capture/mapCapture';
import type {MapWindowLayout} from '../map/cropMask';
import {getMapLibre,supportsInteractiveMap,type OrnamentMapInstance} from '../map/maplibreGlobal';
import {checkProviderCompatibility,OPENFREEMAP,type VectorTileProvider} from '../map/provider';
import {allRoadLayerIds,buildOrnamentStyle,visibleRoadLayerIds} from '../map/style';
import {ORNAMENT_LIMITS,type RoadDetail} from '../types';
import type {CaptureOutcome} from './OrnamentPage';

type Props={
 layout:MapWindowLayout;
 center:[number,number];
 zoom:number;
 detail:RoadDetail;
 chordYMm:number;
 provider?:VectorTileProvider;
 fitBounds?:{bounds:[number,number,number,number];token:number};
 // Bumped by the "Capture map geometry" action. A token rather than a callback prop holding the map
 // instance, so the MapLibre object never leaves this component — the same pattern `fitBounds`
 // already uses to send an instruction into the map without letting the map out.
 captureRequest?:{token:number};
 onCapture:(outcome:CaptureOutcome)=>void;
 onViewportChange:(view:{center:[number,number];zoom:number})=>void;
 onStatus:(message:string)=>void;
};

// Two float comparisons decide whether a prop change is a real instruction to the map or just the
// echo of a movement the map itself reported. Without them, every `moveend` would write to the
// store, the store would write back to the map, and the map would fire `moveend` again.
const SAME_CENTER=1e-7,SAME_ZOOM=1e-4;

// The map shows geography and nothing else. It used to also project and draw a marker; the
// generator no longer produces one, so there is nothing here to position, drag or re-project.
export function OrnamentMap({layout,center,zoom,detail,chordYMm,provider=OPENFREEMAP,fitBounds,captureRequest,onCapture,onViewportChange,onStatus}:Props){
 const host=useRef<HTMLDivElement>(null);
 const mapRef=useRef<OrnamentMapInstance|undefined>(undefined);
 const [ready,setReady]=useState(false);
 const [error,setError]=useState('');
 // Read inside map event handlers, which are registered once and would otherwise close over the
 // first render's props forever.
 const latest=useRef({center,zoom,layout,detail,chordYMm,provider,onViewportChange,onCapture});
 latest.current={center,zoom,layout,detail,chordYMm,provider,onViewportChange,onCapture};

 useEffect(()=>{
  const maplibregl=getMapLibre();
  if(!host.current)return;
  if(!maplibregl||!supportsInteractiveMap()){
   setError('This browser cannot display an interactive map (WebGL is unavailable). The ornament frame, text and export settings still work.');
   return;
  }
  let map:OrnamentMapInstance;
  try{
   map=new maplibregl.Map({
    container:host.current,
    style:buildOrnamentStyle(detail,provider),
    center,
    zoom,
    // The plan requires the first release to enforce bearing 0 and pitch 0. Setting them is not
    // enough on its own — the interaction handlers below are what stop a user producing a rotated
    // capture that the millimetre projection has no way to represent.
    bearing:0,
    pitch:0,
    minZoom:ORNAMENT_LIMITS.zoom.min,
    maxZoom:ORNAMENT_LIMITS.zoom.max,
    attributionControl:false,
    // The map is clipped to a circle, so MapLibre's own attribution control would be cropped out of
    // sight. It is rendered in the preview pane instead, outside the mask.
    dragRotate:false,
    pitchWithRotate:false,
    touchPitch:false,
   });
  }catch(reason){
   setError(`The map could not be created: ${(reason as Error).message}`);
   return;
  }
  mapRef.current=map;
  map.dragRotate.disable();
  map.touchZoomRotate.disableRotation();

  const report=()=>{
   const c=map.getCenter();
   latest.current.onViewportChange({center:[c.lng,c.lat],zoom:map.getZoom()});
  };
  const onMoveEnd=()=>{report()};
  const onLoad=()=>{
   setReady(true);
   // The plan asks for the provider's schema to be validated on load rather than trusted, so a tile
   // server that stops carrying roads or water says so here instead of producing a blank export.
   const source=map.getSource(provider.sourceId);
   const compatibility=checkProviderCompatibility(provider,source);
   if(!compatibility.compatible&&compatibility.missing.length)setError(compatibility.message??'');
  };
  const onError=(event?:unknown)=>{
   const message=(event as {error?:{message?:string}})?.error?.message??'unknown error';
   onStatus(`Map data problem: ${message}`);
  };

  map.on('load',onLoad);
  map.on('moveend',onMoveEnd);
  map.on('error',onError);
  return ()=>{
   mapRef.current=undefined;
   map.off('load',onLoad);map.off('moveend',onMoveEnd);map.off('error',onError);
   map.remove();
  };
  // Created once. Every subsequent prop change is applied by the effects below rather than by
  // rebuilding the map, which would lose the user's framing and re-download tiles.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);

 // Centre and zoom, applied only when they actually differ from what the map already shows. The
 // stored zoom is snapped to the control's 0.5 step, so a free scroll-zoom settles onto the nearest
 // half-step: the map and the zoom control can never show different numbers.
 useEffect(()=>{
  const map=mapRef.current;
  if(!map)return;
  const current=map.getCenter();
  const moved=Math.abs(current.lng-center[0])>SAME_CENTER||Math.abs(current.lat-center[1])>SAME_CENTER;
  const zoomed=Math.abs(map.getZoom()-zoom)>SAME_ZOOM;
  if(moved||zoomed)map.jumpTo({center,zoom,bearing:0,pitch:0});
 },[center,zoom]);

 // Road detail is a visibility toggle over layers the style already defines, not a style rebuild:
 // rebuilding would drop the tile cache and flash the map on every change of a segmented control.
 useEffect(()=>{
  const map=mapRef.current;
  if(!map||!ready)return;
  const visible=new Set(visibleRoadLayerIds(detail));
  for(const id of allRoadLayerIds())if(map.getLayer(id))map.setLayoutProperty(id,'visibility',visible.has(id)?'visible':'none');
 },[detail,ready]);

 useEffect(()=>{
  const map=mapRef.current;
  if(!map||!fitBounds)return;
  const [west,south,east,north]=fitBounds.bounds;
  map.fitBounds([[west,south],[east,north]],{padding:12,maxZoom:ORNAMENT_LIMITS.zoom.max,duration:0});
 },[fitBounds]);

 // The map element is sized in pixels by the preview layout, so MapLibre has to be told when that
 // size changes — it does not observe its container.
 useEffect(()=>{mapRef.current?.resize()},[layout.elementWidthPx,layout.elementHeightPx]);

 // Feature capture. Everything it needs is read from `latest` rather than from the closure, because
 // the effect is keyed on the request token alone: a capture must record the map as it is when the
 // button is pressed, not as it was when this effect was last re-created.
 useEffect(()=>{
  if(!captureRequest)return;
  const map=mapRef.current;
  const report=latest.current.onCapture;
  if(!map){
   report({ok:false,message:error||'The map is not available, so there is no geometry to capture.'});
   return;
  }
  let live=true;
  captureOrnamentFeatures(map as unknown as CaptureMap,{
   provider:latest.current.provider,
   detail:latest.current.detail,
   innerRadiusMm:latest.current.layout.sizeMm/2,
   chordYMm:latest.current.chordYMm,
   // The scale comes from the layout, not from the element's size. They used to be the same number
   // because the element *was* the ornament's map window; now the element fills the pane, so
   // deriving the scale from its width would make the export's physical size depend on how big the
   // browser window happened to be.
   mmPerPx:latest.current.layout.scalePxPerMm>0?1/latest.current.layout.scalePxPerMm:0,
  }).then(result=>{if(live)report({ok:true,result})})
   .catch(reason=>{if(live)report({ok:false,message:(reason as Error).message})});
  return ()=>{live=false};
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[captureRequest?.token]);

 // The map element is no longer hard-clipped to the ornament's circle+chord, and no longer stops at
 // it either: it fills the preview pane, with everything outside the ornament's opening dimmed
 // rather than cropped, so a user can see the geography they are panning past instead of only what
 // is already inside the frame.
 //
 // What does *not* change with the element is the export. The element stays centred on the ornament
 // centre and the scale comes from the layout, so the same geography lands in the same millimetres
 // whatever size the pane is. `cropMask.ts`'s geometry-derived path remains the single source of
 // truth for both the dimming here and the crop that decides what actually exports, and it only
 // changes when the ornament's geometry does — never on pan or zoom — so this costs nothing per
 // frame.
 const style={
  left:`${layout.elementLeftPx}px`,
  top:`${layout.elementTopPx}px`,
  width:`${layout.elementWidthPx}px`,
  height:`${layout.elementHeightPx}px`,
 };

 if(error&&!mapRef.current)return <div className="ornament-map ornament-map-unavailable" style={style} role="note">{error}</div>;

 return <div className="ornament-map" style={style}>
  <div className="ornament-map-canvas" ref={host} aria-label="Map of the selected place" role="application"/>
  {layout.maskPathPx?<svg className="ornament-map-mask" width={layout.elementWidthPx} height={layout.elementHeightPx} aria-hidden="true">
   {/* Evenodd punches the mask shape out of the full element, so only the area that will actually be
       cut away is dimmed; the ornament's own map opening is left at full clarity. */}
   <path d={`M0 0H${layout.elementWidthPx}V${layout.elementHeightPx}H0Z ${layout.maskPathPx}`} fillRule="evenodd" className="ornament-map-mask-dim"/>
   <path d={layout.maskPathPx} className="ornament-map-mask-outline"/>
  </svg>:null}
  {error?<p className="ornament-map-error" role="status">{error}</p>:null}
 </div>;
}
