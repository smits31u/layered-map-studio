import {buildFeatureJob,type FeatureJob,type FeatureJobResult} from './featureJob';

// A cancellable runner for the board's fabrication geometry (buffered roads, the buffered route),
// the same contract as the terrain runner (src/topo/terrain/worker/terrainRunner.ts) and the
// ornament's geometry runner before it:
//   - one job at a time per runner; a new job supersedes the one in flight
//   - cancellation terminates the worker, because the job is one synchronous call
//   - job ids, so a superseded job's reply is dropped rather than resolving the new promise
//   - an inline fallback with the same promise contract where `Worker` does not exist (jsdom, SSR)
// The page keeps one runner per kind, so a road rebuild never cancels a route rebuild.
//
// None of this is on the preview's path. The preview draws centrelines at their physical widths and
// updates immediately; this builds the unioned, repaired polygons that export needs and that the
// warnings are computed from, and lands when it lands.

export class FeatureJobCancelledError extends Error{
 constructor(){super('Feature geometry build cancelled.');this.name='FeatureJobCancelledError'}
}
export class FeatureJobTimeoutError extends Error{
 constructor(readonly timeoutMs:number){super(`Feature geometry build did not finish within ${Math.round(timeoutMs/1000)} seconds and was stopped.`);this.name='FeatureJobTimeoutError'}
}
export const isFeatureJobCancelled=(error:unknown)=>error instanceof FeatureJobCancelledError||(error as Error)?.name==='FeatureJobCancelledError';

// Buffering and unioning roads or a route is lighter work than terrain generation, but a
// pathological input (a huge tangle of overlapping roads) can still make clipper-lib spin
// indefinitely. Without a timeout that showed up as `pending` staying true forever — a silent
// hang, not a reported error. 45s is generous for the largest boards this builds for.
export const DEFAULT_FEATURE_TIMEOUT_MS=45_000;

interface FeatureWorkerRequest{jobId:number;job:FeatureJob}
type FeatureWorkerResponse={jobId:number;ok:true;result:FeatureJobResult}|{jobId:number;ok:false;error:string};
export interface FeatureWorkerLike{
 postMessage(message:FeatureWorkerRequest):void;
 terminate():void;
 onmessage:((event:{data:unknown})=>void)|null;
 onerror:((event:unknown)=>void)|null;
}
export type FeatureWorkerFactory=()=>FeatureWorkerLike;

export const defaultFeatureWorkerFactory:FeatureWorkerFactory|undefined=
 typeof Worker==='undefined'
  ?undefined
  :()=>new Worker(new URL('./featureWorker.ts',import.meta.url),{type:'module'}) as unknown as FeatureWorkerLike;

export interface FeatureRunHandle{result:Promise<FeatureJobResult>;cancel():void}
export interface FeatureRunOptions{timeoutMs?:number}
export interface FeatureRunner{run(job:FeatureJob,options?:FeatureRunOptions):FeatureRunHandle;readonly offMainThread:boolean;dispose():void}

const isResponse=(value:unknown):value is FeatureWorkerResponse=>typeof value==='object'&&value!==null&&typeof (value as {jobId?:unknown}).jobId==='number'&&typeof (value as {ok?:unknown}).ok==='boolean';

export function createFeatureRunner(factory:FeatureWorkerFactory|undefined=defaultFeatureWorkerFactory):FeatureRunner{
 if(!factory)return createInlineFeatureRunner();
 let worker:FeatureWorkerLike|undefined,nextJobId=1,activeJobId=0;
 let settle:{resolve(result:FeatureJobResult):void;reject(error:unknown):void}|undefined;
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
   if(!isResponse(message)||message.jobId!==activeJobId||!settle)return;
   const pending=settle;settle=undefined;
   if(message.ok)pending.resolve(message.result);else pending.reject(new Error(message.error));
  };
  created.onerror=event=>{
   const pending=settle;settle=undefined;
   discard();
   const text=(event as {message?:unknown})?.message;
   pending?.reject(new Error(typeof text==='string'&&text?text:'The feature worker stopped unexpectedly.'));
  };
  worker=created;
  return created;
 };
 const cancelActive=()=>{const pending=settle;settle=undefined;activeJobId=0;discard();pending?.reject(new FeatureJobCancelledError())};
 return {
  offMainThread:true,
  run(job,options){
   if(settle)cancelActive();
   const jobId=nextJobId++;
   activeJobId=jobId;
   const timeoutMs=options?.timeoutMs??DEFAULT_FEATURE_TIMEOUT_MS;
   let timer:ReturnType<typeof setTimeout>|undefined;
   const result=new Promise<FeatureJobResult>((resolve,reject)=>{
    settle={resolve,reject};
    if(timeoutMs>0&&Number.isFinite(timeoutMs))timer=setTimeout(()=>{
     if(activeJobId!==jobId)return;
     const pending=settle;settle=undefined;activeJobId=0;
     discard();
     pending?.reject(new FeatureJobTimeoutError(timeoutMs));
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

// No Worker: the same function inline, after a macrotask so the preview commits first and the caller
// can still cancel.
// No Worker: the same function inline, after a macrotask. As with the terrain runner's inline
// fallback there is no real timeout here — a timer cannot fire while the only thread is inside
// the synchronous job — so `options.timeoutMs` is accepted but has no effect off-thread.
export function createInlineFeatureRunner():FeatureRunner{
 let disposed=false;
 return {
  offMainThread:false,
  run(job){
   let cancelled=false;
   const result=new Promise<FeatureJobResult>((resolve,reject)=>{
    setTimeout(()=>{
     if(cancelled||disposed){reject(new FeatureJobCancelledError());return}
     try{resolve(buildFeatureJob(job))}catch(error){reject(error)}
    },0);
   });
   return {result,cancel(){cancelled=true}};
  },
  dispose(){disposed=true},
 };
}
