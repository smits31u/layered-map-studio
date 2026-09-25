import {useEffect,useRef,useState} from 'react';
import type {MultiPolygonMm} from '../../geometry/shoreline/polygonEngine';
import type {TopoCapture} from '../capture/topoCapture';
import type {TopoRoadLayer} from '../features/roads';
import type {RouteLines,TopoRouteLayer} from '../features/route';
import {createFeatureRunner,isFeatureJobCancelled,type FeatureRunner} from '../features/worker/featureRunner';
import type {FeatureJob} from '../features/worker/featureJob';
import type {FrozenTerrainView} from '../terrain/pipeline';
import type {TopoProject} from '../types';

// The board's fabrication geometry — buffered, unioned, land-clipped roads and route — built in the
// feature worker after the preview has already updated. Settings changes are debounced so dragging
// the thickness slider queues one rebuild rather than one per frame, and each kind has its own runner
// so a road rebuild never cancels a route rebuild. A result for settings that have since changed is
// dropped.

export const FABRICATION_DEBOUNCE_MS=150;

export interface FabricationState{roads?:TopoRoadLayer;route?:TopoRouteLayer;pending:boolean;error?:string}

export interface FabricationInputs{
 capture:TopoCapture|undefined;
 view:FrozenTerrainView|undefined;
 land:MultiPolygonMm|undefined;
 // The terrain's water, for bridge tabs across genuine crossings.
 water:MultiPolygonMm;
 roads:TopoProject['roads'];
 routeLines:RouteLines|undefined;
 routeWidthMm:number|undefined;
 createRunner?:()=>FeatureRunner;
}

function useJob(kind:'roads'|'route',job:FeatureJob|undefined,createRunner:()=>FeatureRunner){
 const [state,setState]=useState<{key?:FeatureJob;layer?:unknown;pending:boolean;error?:string}>({pending:false});
 const runner=useRef<FeatureRunner|null>(null);
 useEffect(()=>()=>{runner.current?.dispose();runner.current=null},[]);
 useEffect(()=>{
  if(!job){setState({pending:false});return}
  setState(previous=>({...previous,pending:true}));
  let handle:{cancel():void}|undefined,live=true;
  const timer=setTimeout(()=>{
   runner.current??=createRunner();
   const run=runner.current.run(job);
   handle=run;
   run.result.then(result=>{if(live&&result.kind===kind)setState({key:job,layer:result.layer,pending:false})},error=>{
    if(!live||isFeatureJobCancelled(error))return;
    setState(previous=>({...previous,pending:false,error:(error as Error)?.message??String(error)}));
   });
  },FABRICATION_DEBOUNCE_MS);
  return ()=>{live=false;clearTimeout(timer);handle?.cancel()};
  // `job` is rebuilt by the caller only when one of its inputs changes (useMemo).
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[job]);
 return state;
}

export function useFeatureFabrication(inputs:FabricationInputs):FabricationState{
 const {capture,view,land,water,roads,routeLines,routeWidthMm}=inputs;
 const create=inputs.createRunner??createFeatureRunner;
 const roadJob=useStableJob(capture&&view&&land?{kind:'roads',roads:capture.features.roads,view,settings:{detail:roads.detail,thicknessScale:roads.thicknessScale},land,water,...(capture.tunnelRoadKeys?{tunnelRoadKeys:capture.tunnelRoadKeys}:{}),...(capture.simplifyToleranceMm?{simplifyToleranceMm:capture.simplifyToleranceMm}:{})}:undefined,[capture,view,land,water,roads.detail,roads.thicknessScale]);
 const routeJob=useStableJob(routeLines&&land&&view&&routeWidthMm?{kind:'route',lines:routeLines.lines,widthMm:routeWidthMm,land,water,board:{widthMm:view.widthMm,heightMm:view.heightMm}}:undefined,[routeLines,land,water,view,routeWidthMm]);
 const roadState=useJob('roads',roadJob,create);
 const routeState=useJob('route',routeJob,create);
 return {
  ...(roadJob&&roadState.key===roadJob&&roadState.layer?{roads:roadState.layer as TopoRoadLayer}:{}),
  ...(routeJob&&routeState.key===routeJob&&routeState.layer?{route:routeState.layer as TopoRouteLayer}:{}),
  pending:roadState.pending||routeState.pending,
  ...(roadState.error??routeState.error?{error:roadState.error??routeState.error}:{}),
 };
}

// A job object whose identity changes only when one of `deps` does.
function useStableJob(job:FeatureJob|undefined,deps:readonly unknown[]):FeatureJob|undefined{
 const memo=useRef<{deps:readonly unknown[];job:FeatureJob|undefined}|undefined>(undefined);
 if(!memo.current||memo.current.deps.length!==deps.length||memo.current.deps.some((d,i)=>!Object.is(d,deps[i])))memo.current={deps,job};
 return memo.current.job;
}
