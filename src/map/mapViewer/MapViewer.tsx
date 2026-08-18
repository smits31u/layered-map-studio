import {useEffect,useRef,useState,type CSSProperties} from 'react';
import type {CropGeography,ExtractedFeatures,MapProject} from '../../types/project';
import {cropFromCorners} from '../../geometry/projection/cropProjection';
import {extractMapLibreFeatures,type QueryBox} from '../featureExtraction/mapLibreExtractor';
import {canvasLocalQueryBox} from './queryBox';
declare const maplibregl:any;

const waitForTiles=(map:any)=>new Promise<void>((resolve,reject)=>{
 if(map.areTilesLoaded?.()){resolve();return;}
 const timeout=window.setTimeout(()=>{cleanup();reject(new Error('Map tiles did not finish loading. Try again after the map settles.'));},15000);
 const idle=()=>{cleanup();resolve();};
 const removed=()=>{cleanup();reject(new Error('The map was closed before feature loading completed.'));};
 const cleanup=()=>{window.clearTimeout(timeout);map.off('idle',idle);map.off('remove',removed);};
 map.once('idle',idle);map.once('remove',removed);
});
export const cropFrameStyle=(width:number,height:number):CSSProperties&{'--ratio':number}=>{const ratio=width/height;return{aspectRatio:String(ratio),'--ratio':ratio}};

export function MapViewer({project,onView,onCrop,onFeatures,onStatus,flyTo}:{project:MapProject;onView:(v:MapProject['map'])=>void;onCrop:(c:CropGeography)=>void;onFeatures:(f:ExtractedFeatures)=>void;onStatus:(message:string)=>void;flyTo?:{lng:number;lat:number;zoom?:number}}){
 const host=useRef<HTMLDivElement>(null),mapRef=useRef<any>(undefined),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 useEffect(()=>{if(!host.current)return;if(typeof maplibregl==='undefined'){setError('MapLibre failed to load');return}const map=new maplibregl.Map({container:host.current,style:import.meta.env.VITE_MAP_STYLE_URL||'https://tiles.openfreemap.org/styles/bright',center:[project.map.longitude,project.map.latitude],zoom:project.map.zoom,bearing:project.map.bearing});mapRef.current=map;map.addControl(new maplibregl.NavigationControl(),'top-right');map.on('error',(e:any)=>{const message=`Map source failure: ${e.error?.message??'unknown error'}`;setError(message);console.error(message,e.error)});const update=()=>{const el=host.current!.querySelector('.crop-frame')!.getBoundingClientRect(),box=host.current!.getBoundingClientRect(),p=(x:number,y:number)=>{const q=map.unproject([x-box.left,y-box.top]);return{lng:q.lng,lat:q.lat}};const crop=cropFromCorners(p(el.left,el.top),p(el.right,el.top),p(el.right,el.bottom),p(el.left,el.bottom));onCrop(crop);const c=map.getCenter();onView({...project.map,latitude:c.lat,longitude:c.lng,zoom:map.getZoom(),bearing:map.getBearing(),crop})};map.on('moveend',update);map.on('load',update);return()=>{mapRef.current=undefined;map.remove()}},[]);
 useEffect(()=>{if(flyTo)mapRef.current?.flyTo({center:[flyTo.lng,flyTo.lat],zoom:flyTo.zoom??12})},[flyTo]);
 const extract=async()=>{
  const map=mapRef.current;
  if(!map){const message='Feature extraction failed: Map is not ready.';setError(message);onStatus(message);return;}
  setLoading(true);setError('');onStatus('Loading vector features...');
  try{
   await waitForTiles(map);
   if(!map.loaded?.())throw new Error('The map style is not loaded yet.');
   const frame=host.current!.querySelector('.crop-frame')!.getBoundingClientRect(),canvas=map.getCanvas().getBoundingClientRect();
   const box:QueryBox=canvasLocalQueryBox(frame,canvas);
   const features=extractMapLibreFeatures(map,box,diagnostics=>console.info('Map feature extraction',JSON.stringify({queryBox:box,canvas:{width:canvas.width,height:canvas.height},vectorSources:diagnostics.vectorSources,renderedLayerIds:diagnostics.renderedLayerIds,rawCount:diagnostics.rawCount,sample:diagnostics.sample})));
   onFeatures(features);
  }catch(reason){const message=`Feature extraction failed: ${(reason as Error).message}`;setError(message);onStatus(message);console.error(message,reason)}finally{setLoading(false)}
 };
 return <div className="map-host" ref={host}><div className="mode-badge">MAP MODE</div><div className="crop-frame" style={cropFrameStyle(project.dimensions.widthMm,project.dimensions.heightMm)}/><button className="extract" onClick={extract} disabled={loading}>{loading?'Loading vector features...':'Load visible vector features'}</button>{error&&<div className="map-error">{error}</div>}</div>;
}
