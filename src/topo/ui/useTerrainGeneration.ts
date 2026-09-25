import {useCallback,useEffect,useRef,useState} from 'react';
import type {CapturedWater} from '../../ornament/capture/featureTypes';
import {TerrainError,type TerrainErrorCode} from '../terrain/errors';
import {TileFetchCancelledError,fetchTerrainTiles,type TileFetchLike} from '../terrain/fetchTiles';
import {terrainTilePlan,type FrozenTerrainView,type TerrainResult,type TerrainSettings,type TerrainStage} from '../terrain/pipeline';
import {tileKey} from '../terrain/tiles';
import {createTerrainRunner,isTerrainCancelled,type TerrainRunHandle,type TerrainRunner} from '../terrain/worker/terrainRunner';

// Generation as the page sees it: download the tiles for a frozen view, run the pipeline in the
// worker, and hold the latest result. One generation at a time — starting one cancels the previous
// download and terminates the previous worker job, and a job-token check means nothing from a
// superseded run can ever land in state (the plan: "Cancellation prevents an old worker result
// overwriting new state").
//
// Tiles are kept for the last tile set, so changing layers, coverage, contours or smoothing reruns
// the pipeline on the same bytes without downloading anything.

export type GenerationStage='download'|TerrainStage;

export interface GenerationState{
 status:'idle'|'working'|'ready'|'error';
 stage?:GenerationStage;
 done?:number;
 total?:number;
 // The latest finished result. Kept while a settings change reruns, so the preview does not blank.
 result?:TerrainResult&{durationMs:number};
 error?:{message:string;code?:TerrainErrorCode};
}

export interface TerrainGenerationDeps{createRunner?:()=>TerrainRunner;fetchImpl?:TileFetchLike}

export interface GenerateOptions{
 keepResult?:boolean;
 // The water captured with the view, subtracted from every layer in the worker. Absent only when
 // there was no live map to capture from.
 water?:readonly CapturedWater[];
 waterSimplifyToleranceMm?:number;
}

export function useTerrainGeneration(deps:TerrainGenerationDeps={}){
 const [state,setState]=useState<GenerationState>({status:'idle'});
 const runner=useRef<TerrainRunner|null>(null);
 const active=useRef<{abort:AbortController;handle?:TerrainRunHandle}|null>(null);
 const token=useRef(0);
 const tileCache=useRef<{key:string;tiles:Record<string,Uint8Array>}|null>(null);
 const depsRef=useRef(deps);
 depsRef.current=deps;

 const stopActive=()=>{
  const current=active.current;
  active.current=null;
  current?.abort.abort();
  current?.handle?.cancel();
 };

 useEffect(()=>()=>{token.current++;stopActive();runner.current?.dispose();runner.current=null},[]);

 const cancel=useCallback(()=>{
  token.current++;
  stopActive();
  setState(previous=>previous.status==='working'?{status:previous.result?'ready':'idle',result:previous.result}:previous);
 },[]);

 const generate=useCallback(async(view:FrozenTerrainView,settings:TerrainSettings,{keepResult=false,water,waterSimplifyToleranceMm}:GenerateOptions={})=>{
  stopActive();
  const mine=++token.current,isCurrent=()=>token.current===mine;
  const abort=new AbortController();
  active.current={abort};
  setState(previous=>({status:'working',stage:'download',done:0,total:0,result:keepResult?previous.result:undefined}));
  try{
   const plan=terrainTilePlan(view);
   const key=plan.tiles.map(tileKey).join('|');
   let tiles=tileCache.current?.key===key?tileCache.current.tiles:undefined;
   if(!tiles){
    tiles=await fetchTerrainTiles(plan,{fetchImpl:depsRef.current.fetchImpl,signal:abort.signal,onProgress:(done,total)=>{if(isCurrent())setState(s=>({...s,stage:'download',done,total}))}});
    if(!isCurrent())return;
    tileCache.current={key,tiles};
   }
   runner.current??=(depsRef.current.createRunner??createTerrainRunner)();
   const handle=runner.current.run({view,tiles,water:[],...(water?.length?{capturedWater:water,waterSimplifyToleranceMm}:{}),settings},{onStage:stage=>{if(isCurrent())setState(s=>({...s,stage}))}});
   if(active.current)active.current.handle=handle;
   setState(s=>({...s,stage:'decode'}));
   const result=await handle.result;
   if(isCurrent()){active.current=null;setState({status:'ready',result})}
  }catch(error){
   if(!isCurrent()||isTerrainCancelled(error)||error instanceof TileFetchCancelledError)return;
   active.current=null;
   setState(s=>({status:'error',result:s.result,error:{message:(error as Error)?.message??String(error),code:error instanceof TerrainError?error.code:undefined}}));
  }
 },[]);

 return {state,generate,cancel};
}
