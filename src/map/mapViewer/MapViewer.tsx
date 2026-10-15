import {useEffect,useRef,useState,type CSSProperties} from 'react';
import type {CropGeography,ExtractedFeatures,MapProject} from '../../types/project';
import {cropFromCorners} from '../../geometry/projection/cropProjection';
import {CROP_ASPECT_TOLERANCE} from '../../geometry/projection/cropAspect';
import {extractMapLibreFeatures,type QueryBox} from '../featureExtraction/mapLibreExtractor';
import {canvasLocalQueryBox} from './queryBox';
declare const maplibregl:any;

// Captures the vector features inside the crop frame from the live map. Exposed to the app through
// `captureRef` so Generate can capture on its own when nothing fresh has been captured yet.
export type MapCapture=()=>Promise<ExtractedFeatures>;

// Waits for the map to settle — tiles loaded *and* the style/camera done (map.loaded()). Tiles alone
// can be loaded mid-flight, right after a search result's flyTo, which a capture that Generate or
// Check Bathymetry starts on its own is likely to hit.
const waitForTiles=(map:any)=>new Promise<void>((resolve,reject)=>{
 if(map.areTilesLoaded?.()&&(map.loaded?.()??true)){resolve();return;}
 const timeout=window.setTimeout(()=>{cleanup();reject(new Error('Map tiles did not finish loading. Try again after the map settles.'));},15000);
 const idle=()=>{cleanup();resolve();};
 const removed=()=>{cleanup();reject(new Error('The map was closed before feature loading completed.'));};
 const cleanup=()=>{window.clearTimeout(timeout);map.off('idle',idle);map.off('remove',removed);};
 map.once('idle',idle);map.once('remove',removed);
});
export const cropFrameStyle=(width:number,height:number):CSSProperties&{'--ratio':number}=>{const ratio=width/height;return{aspectRatio:String(ratio),'--ratio':ratio}};

// keepCrop: the project's crop is pinned (a saved project was just opened or the session restored).
// Instead of measuring a new crop from the frame when the map loads, the map zooms so the frame shows
// the saved crop, and the crop is left exactly as saved until the user moves the map. A crop measured
// in a differently sized window would differ slightly, and the saved geography would no longer match.
// A window resize while pinned refits the view to the saved crop instead: MapLibre answers a resize
// with a moveend of its own, which used to re-measure the crop and drop the saved geography.
//
// Rotation and pitch are off. The compass is drawn pointing straight up the board, so a rotated map
// shipped a compass pointing the wrong way; a pitched one makes the frame a trapezoid on the ground.
// A project saved with a bearing still opens at it (buildScene turns its compass to match).
export function MapViewer({project,onView,onCrop,onFeatures,onStatus,flyTo,captureRef,keepCrop=false}:{project:MapProject;onView:(v:MapProject['map'])=>void;onCrop:(c:CropGeography)=>void;onFeatures:(f:ExtractedFeatures)=>void;onStatus:(message:string)=>void;flyTo?:{lng:number;lat:number;zoom?:number};captureRef?:{current:MapCapture|undefined};keepCrop?:boolean}){
 const host=useRef<HTMLDivElement>(null),mapRef=useRef<any>(undefined),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 // The map's handlers are registered once, at mount; these let them read the current props.
 const projectRef=useRef(project),keepCropRef=useRef(keepCrop),updateRef=useRef<()=>void>(undefined);
 projectRef.current=project;keepCropRef.current=keepCrop;
 useEffect(()=>{if(!host.current)return;if(typeof maplibregl==='undefined'){setError('MapLibre failed to load');return}const map=new maplibregl.Map({container:host.current,style:import.meta.env.VITE_MAP_STYLE_URL||'https://tiles.openfreemap.org/styles/bright',center:[project.map.longitude,project.map.latitude],zoom:project.map.zoom,bearing:keepCrop?project.map.bearing:0,dragRotate:false,pitchWithRotate:false,touchPitch:false,maxPitch:0});mapRef.current=map;map.touchZoomRotate?.disableRotation?.();map.keyboard?.disableRotation?.();map.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-right');map.on('error',(e:any)=>{const message=`Map source failure: ${e.error?.message??'unknown error'}`;setError(message);console.error(message,e.error)});const update=()=>{const el=host.current!.querySelector('.crop-frame')!.getBoundingClientRect(),box=host.current!.getBoundingClientRect(),p=(x:number,y:number)=>{const q=map.unproject([x-box.left,y-box.top]);return{lng:q.lng,lat:q.lat}};const crop=cropFromCorners(p(el.left,el.top),p(el.right,el.top),p(el.right,el.bottom),p(el.left,el.bottom));onCrop(crop);const c=map.getCenter();onView({...project.map,latitude:c.lat,longitude:c.lng,zoom:map.getZoom(),bearing:map.getBearing(),crop})};updateRef.current=update;
  // camera: where fitSavedCrop last left the view. While pinned, a moveend that finds the camera still
  // there was not the user moving the map (a resize, say) and must not re-measure.
  let ignoreMove=false,fitted='';const camera=()=>{const c=map.getCenter();return JSON.stringify([c.lng,c.lat,map.getZoom()])},pinned=()=>keepCropRef.current&&Boolean(projectRef.current.map.crop);
  const fitSavedCrop=()=>{const {map:view}=projectRef.current,crop=view.crop!,el=host.current!.querySelector('.crop-frame')!.getBoundingClientRect(),box=host.current!.getBoundingClientRect(),midY=(el.top+el.bottom)/2-box.top,left=map.unproject([el.left-box.left,midY]),right=map.unproject([el.right-box.left,midY]),span=right.lng-left.lng,saved=crop.ne.lng-crop.nw.lng;if(span>0&&saved>0&&typeof map.jumpTo==='function'){ignoreMove=true;try{map.jumpTo({center:[view.longitude,view.latitude],zoom:map.getZoom()+Math.log2(span/saved)})}finally{ignoreMove=false}}fitted=camera()};
  map.on('resize',()=>{if(pinned())fitSavedCrop()});map.on('moveend',()=>{if(ignoreMove||pinned()&&camera()===fitted)return;update()});map.on('load',()=>{if(pinned())fitSavedCrop();else update()});return()=>{mapRef.current=undefined;updateRef.current=undefined;map.remove()}},[]);
 // A board size change reshapes the frame, so the crop is re-measured from it now rather than at the
 // next map move; Generate would otherwise capture the old crop and stretch it onto the new board.
 const sizeKey=`${project.dimensions.widthMm}x${project.dimensions.heightMm}`,sizeRef=useRef(sizeKey);
 useEffect(()=>{if(sizeRef.current===sizeKey)return;sizeRef.current=sizeKey;if(!keepCropRef.current)updateRef.current?.()},[sizeKey]);
 useEffect(()=>{if(flyTo)mapRef.current?.flyTo({center:[flyTo.lng,flyTo.lat],zoom:flyTo.zoom??12})},[flyTo]);
 const capture:MapCapture=async()=>{
  const map=mapRef.current;
  if(!map)throw new Error('Map is not ready.');
  setLoading(true);setError('');onStatus('Loading vector features...');
  try{
   await waitForTiles(map);
   if(!map.loaded?.())throw new Error('The map style is not loaded yet.');
   const frame=host.current!.querySelector('.crop-frame')!.getBoundingClientRect(),canvas=map.getCanvas().getBoundingClientRect();
   const box:QueryBox=canvasLocalQueryBox(frame,canvas);
   // The crop is measured off this frame, so a frame that is not the board's shape is a stretched map.
   const ratio=projectRef.current.dimensions.widthMm/projectRef.current.dimensions.heightMm;
   if(Math.abs(frame.width/frame.height/ratio-1)>CROP_ASPECT_TOLERANCE)throw new Error(`the crop frame on screen is not the board's shape (${(frame.width/frame.height).toFixed(3)} wide per tall, board ${ratio.toFixed(3)}). Resize the window and try again.`);
   return extractMapLibreFeatures(map,box,diagnostics=>console.info('Map feature extraction',JSON.stringify({queryBox:box,canvas:{width:canvas.width,height:canvas.height},vectorSources:diagnostics.vectorSources,renderedLayerIds:diagnostics.renderedLayerIds,rawCount:diagnostics.rawCount,sample:diagnostics.sample})));
  }finally{setLoading(false)}
 };
 // Re-registered every render so the app always calls the current closure; cleared on unmount so
 // the app can tell the map is gone (Generated Map mode) rather than calling a removed map.
 useEffect(()=>{if(!captureRef)return;captureRef.current=capture;return()=>{if(captureRef.current===capture)captureRef.current=undefined}});
 const fail=(reason:Error)=>{const message=`Feature extraction failed: ${reason.message}`;setError(message);onStatus(message);console.error(message,reason)};
 const extract=async()=>{
  // Reported synchronously, as before capture moved into its own function.
  if(!mapRef.current){fail(new Error('Map is not ready.'));return}
  try{onFeatures(await capture())}catch(reason){fail(reason as Error)}
 };
 return <div className="map-host" ref={host}><div className="mode-badge">MAP MODE</div><div className="crop-frame" style={cropFrameStyle(project.dimensions.widthMm,project.dimensions.heightMm)}/><button className="extract" onClick={extract} disabled={loading}>{loading?'Loading vector features...':'Load visible vector features'}</button>{error&&<div className="map-error">{error}</div>}</div>;
}
