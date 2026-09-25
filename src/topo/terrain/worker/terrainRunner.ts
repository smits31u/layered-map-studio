import {TerrainError} from '../errors';
import {generateTerrain,type TerrainJob,type TerrainResult,type TerrainStage} from '../pipeline';
import {isTerrainWorkerResponse,type TerrainWorkerRequest} from './protocol';

// A cancellable runner for terrain generation, following the ornament's geometry runner
// (src/ornament/worker/geometryRunner.ts) point for point:
//   - one job at a time; starting a job supersedes the one before it
//   - cancellation is worker.terminate(), because generateTerrain is one synchronous call with
//     nowhere to check a flag; the next job starts a fresh worker
//   - job ids, so a message from a superseded job is dropped instead of resolving the new promise
//   - a timeout that also terminates, reported as a fault rather than as a cancellation
//   - an inline fallback with the same promise contract where `Worker` does not exist (jsdom, SSR)
// It is a sibling rather than a generalisation of that runner so the ornament's code is untouched
// by the topo builder; folding the two into one generic runner is a mechanical follow-up.

export class TerrainCancelledError extends Error{
 constructor(){super('Terrain generation cancelled.');this.name='TerrainCancelledError'}
}
export class TerrainTimeoutError extends Error{
 constructor(readonly timeoutMs:number){super(`Terrain generation did not finish within ${Math.round(timeoutMs/1000)} seconds and was stopped.`);this.name='TerrainTimeoutError'}
}
export const isTerrainCancelled=(error:unknown)=>error instanceof TerrainCancelledError||(error as Error)?.name==='TerrainCancelledError';

// A 600 mm board at the full sample budget with four layers and 18 contours is the worst case; it
// finishes well inside this on an ordinary laptop.
export const DEFAULT_TERRAIN_TIMEOUT_MS=90_000;

export interface TerrainRunHandle{result:Promise<TerrainResult&{durationMs:number}>;cancel():void}
export interface TerrainRunOptions{timeoutMs?:number;onStage?:(stage:TerrainStage)=>void}
export interface TerrainRunner{run(job:TerrainJob,options?:TerrainRunOptions):TerrainRunHandle;readonly offMainThread:boolean;dispose():void}

export interface TerrainWorkerLike{
 postMessage(message:TerrainWorkerRequest):void;
 terminate():void;
 onmessage:((event:{data:unknown})=>void)|null;
 onerror:((event:unknown)=>void)|null;
}
export type TerrainWorkerFactory=()=>TerrainWorkerLike;

export const defaultTerrainWorkerFactory:TerrainWorkerFactory|undefined=
 typeof Worker==='undefined'
  ?undefined
  :()=>new Worker(new URL('./terrainWorker.ts',import.meta.url),{type:'module'}) as unknown as TerrainWorkerLike;

type Settle={resolve(result:TerrainResult&{durationMs:number}):void;reject(error:unknown):void;onStage?:(stage:TerrainStage)=>void};

export function createTerrainRunner(factory:TerrainWorkerFactory|undefined=defaultTerrainWorkerFactory):TerrainRunner{
 if(!factory)return createInlineTerrainRunner();
 let worker:TerrainWorkerLike|undefined,nextJobId=1,activeJobId=0,settle:Settle|undefined;

 const discard=()=>{
  if(!worker)return;
  worker.onmessage=null;worker.onerror=null;
  try{worker.terminate()}catch{/* already gone */}
  worker=undefined;
 };
 const ensureWorker=()=>{
  if(worker)return worker;
  const created=factory();
  created.onmessage=event=>{
   const message=event.data;
   if(!isTerrainWorkerResponse(message)||message.jobId!==activeJobId||!settle)return;
   if(message.type==='progress'){settle.onStage?.(message.stage);return}
   const pending=settle;settle=undefined;
   if(message.ok)pending.resolve({...message.result,durationMs:message.durationMs});
   else pending.reject(message.code?new TerrainError(message.code,message.error):new Error(message.error));
  };
  created.onerror=event=>{
   const pending=settle;settle=undefined;
   discard();
   const text=(event as {message?:unknown})?.message;
   pending?.reject(new Error(typeof text==='string'&&text?text:'The terrain worker stopped unexpectedly.'));
  };
  worker=created;
  return created;
 };
 const cancelActive=()=>{
  const pending=settle;settle=undefined;activeJobId=0;
  discard();
  pending?.reject(new TerrainCancelledError());
 };

 return {
  offMainThread:true,
  run(job,options){
   if(settle)cancelActive();
   const jobId=nextJobId++;
   activeJobId=jobId;
   const timeoutMs=options?.timeoutMs??DEFAULT_TERRAIN_TIMEOUT_MS;
   let timer:ReturnType<typeof setTimeout>|undefined;
   const result=new Promise<TerrainResult&{durationMs:number}>((resolve,reject)=>{
    settle={resolve,reject,onStage:options?.onStage};
    if(timeoutMs>0&&Number.isFinite(timeoutMs))timer=setTimeout(()=>{
     if(activeJobId!==jobId)return;
     const pending=settle;settle=undefined;activeJobId=0;
     discard();
     pending?.reject(new TerrainTimeoutError(timeoutMs));
    },timeoutMs);
    try{ensureWorker().postMessage({jobId,job})}
    catch(error){settle=undefined;activeJobId=0;discard();reject(error)}
   });
   const clear=()=>{if(timer!==undefined){clearTimeout(timer);timer=undefined}};
   result.then(clear,clear);
   return {result,cancel(){clear();if(activeJobId===jobId)cancelActive()}};
  },
  dispose(){settle=undefined;activeJobId=0;discard()},
 };
}

// No Worker: the same function, inline, after a microtask so the caller can still cancel and so the
// result is never available synchronously. As with the ornament's inline runner there is no timeout —
// a timer cannot fire while the only thread is inside the job.
export function createInlineTerrainRunner():TerrainRunner{
 let disposed=false;
 return {
  offMainThread:false,
  run(job,options){
   let cancelled=false;
   const result=new Promise<TerrainResult&{durationMs:number}>((resolve,reject)=>{
    queueMicrotask(()=>{
     if(cancelled||disposed){reject(new TerrainCancelledError());return}
     const startedAt=Date.now();
     try{const out=generateTerrain(job,options?.onStage);resolve({...out,durationMs:Date.now()-startedAt})}
     catch(error){reject(error)}
    });
   });
   return {result,cancel(){cancelled=true}};
  },
  dispose(){disposed=true},
 };
}
