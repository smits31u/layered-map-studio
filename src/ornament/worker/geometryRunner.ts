import {buildFeatureGeometry,type FeatureGeometryInput,type FeatureGeometryResult} from '../geometry/featureGeometry';
import {isGeometryWorkerResponse,type GeometryWorkerRequest,type GeometryWorkerResponse} from './protocol';

// A cancellable runner for the geometry pipeline.
//
// The plan's Phase 3 step 6: "Move expensive geometry work to a cancellable Web Worker." Two words
// there carry all the design.
//
// **Worker.** A dense city capture at high detail is tens of thousands of offset operations and a
// union over the result. On the main thread that is a preview that stops repainting and a page that
// stops answering the mouse, which on a fabrication tool reads as a crash and gets the tab closed
// halfway through. There is no existing worker in this repository to build on — the lake tool's
// `buildScene` is synchronous and called straight from React — so this is new, and it is kept as
// small as it can be so it stays the only one.
//
// **Cancellable.** `buildFeatureGeometry` is a single synchronous call into Clipper and
// polygon-clipping, neither of which takes a cancellation token, so there is no cooperative way to
// stop it part-way. The only real cancellation available is `worker.terminate()`, and that is what
// this does: a cancelled job kills the worker and a fresh one is created for the next job. That
// costs a worker start-up (a few milliseconds) on the job after a cancellation, and it buys actual
// cancellation rather than a promise that resolves to nothing while a core stays pinned.
//
// The fallback path matters as much as the worker path. `Worker` does not exist under jsdom, in an
// SSR build, or in a browser that blocks blob/module workers, and the ornament has to keep working
// in all three. The fallback runs the same pure function inline and honours cancellation the only
// way it can — by refusing to deliver a result nobody is waiting for any more.

export class GeometryCancelledError extends Error{
 constructor(){super('Geometry build cancelled.');this.name='GeometryCancelledError'}
}

export const isCancelled=(error:unknown)=>error instanceof GeometryCancelledError||(error as Error)?.name==='GeometryCancelledError';

export interface GeometryRunHandle{
 result:Promise<FeatureGeometryResult>;
 cancel():void;
}

export interface GeometryRunner{
 run(input:FeatureGeometryInput):GeometryRunHandle;
 // True when work is actually happening off the main thread. Surfaced so the UI can say so, and so
 // a test can assert which path it exercised rather than inferring it.
 readonly offMainThread:boolean;
 dispose():void;
}

// The narrow slice of the Worker API used here, so the runner can be handed a fake in a test without
// jsdom growing a Worker implementation.
export interface WorkerLike{
 postMessage(message:GeometryWorkerRequest):void;
 terminate():void;
 onmessage:((event:{data:unknown})=>void)|null;
 onerror:((event:unknown)=>void)|null;
}

export type WorkerFactory=()=>WorkerLike;

// Vite rewrites `new Worker(new URL('./geometryWorker.ts', import.meta.url), {type:'module'})` at
// build time into a real bundled worker chunk. It is constructed lazily, inside the factory, so the
// `new URL` is never evaluated in an environment that has no worker to run.
export const defaultWorkerFactory:WorkerFactory|undefined=
 typeof Worker==='undefined'
  ?undefined
  :()=>new Worker(new URL('./geometryWorker.ts',import.meta.url),{type:'module'}) as unknown as WorkerLike;

export function createGeometryRunner(factory:WorkerFactory|undefined=defaultWorkerFactory):GeometryRunner{
 if(!factory)return createInlineRunner();

 let worker:WorkerLike|undefined;
 let nextJobId=1;
 // The job the live worker is currently running. Anything arriving with a different id is the echo
 // of a job that was cancelled or superseded, and is dropped rather than resolving a stale promise.
 let activeJobId=0;
 let settle:{resolve(result:FeatureGeometryResult):void;reject(error:unknown):void}|undefined;

 const ensureWorker=():WorkerLike=>{
  if(worker)return worker;
  const created=factory();
  created.onmessage=event=>{
   const message=event.data;
   if(!isGeometryWorkerResponse(message)||message.jobId!==activeJobId)return;
   const pending=settle;
   settle=undefined;
   if(!pending)return;
   const response=message as GeometryWorkerResponse;
   if(response.ok)pending.resolve(withDuration(response.result,response.durationMs));
   else pending.reject(new Error(response.error));
  };
  created.onerror=event=>{
   const pending=settle;
   settle=undefined;
   // A worker that errors out is not reusable: its module scope may be half-initialised. Drop it so
   // the next run starts clean.
   discard();
   pending?.reject(new Error(errorMessage(event)));
  };
  worker=created;
  return created;
 };

 const discard=()=>{
  if(!worker)return;
  worker.onmessage=null;
  worker.onerror=null;
  try{worker.terminate()}catch{/* already gone */}
  worker=undefined;
 };

 const cancelActive=()=>{
  const pending=settle;
  settle=undefined;
  activeJobId=0;
  // Terminating is the cancellation. Nothing else stops a synchronous boolean operation mid-union.
  discard();
  pending?.reject(new GeometryCancelledError());
 };

 return {
  offMainThread:true,
  run(input){
   // Starting a run supersedes whatever was running: there is one preview, so there is one answer
   // worth having, and the older job's result would only be discarded on arrival anyway.
   if(settle)cancelActive();
   const jobId=nextJobId++;
   activeJobId=jobId;
   const result=new Promise<FeatureGeometryResult>((resolve,reject)=>{
    settle={resolve,reject};
    try{ensureWorker().postMessage({jobId,input})}
    catch(error){settle=undefined;activeJobId=0;discard();reject(error)}
   });
   return {result,cancel(){if(activeJobId===jobId)cancelActive()}};
  },
  dispose(){
   settle=undefined;
   activeJobId=0;
   discard();
  },
 };
}

// The no-Worker path. The work still happens synchronously — there is nowhere else to put it — but
// the promise contract, the cancellation semantics and the result shape are identical, so nothing
// upstream branches on which runner it got.
export function createInlineRunner():GeometryRunner{
 let disposed=false;
 return {
  offMainThread:false,
  run(input){
   let cancelled=false;
   const result=new Promise<FeatureGeometryResult>((resolve,reject)=>{
    // A microtask, not a synchronous call: it gives the caller a chance to cancel, and it keeps the
    // inline path asynchronous like the worker path so a test cannot accidentally depend on the
    // result being available before `run` returns.
    queueMicrotask(()=>{
     if(cancelled||disposed){reject(new GeometryCancelledError());return}
     const startedAt=Date.now();
     try{resolve(withDuration(buildFeatureGeometry(input),Date.now()-startedAt))}
     catch(error){reject(error)}
    });
   });
   return {result,cancel(){cancelled=true}};
  },
  dispose(){disposed=true},
 };
}

const withDuration=(result:FeatureGeometryResult,durationMs:number):FeatureGeometryResult=>
 ({...result,metrics:{...result.metrics,durationMs}});

const errorMessage=(event:unknown):string=>{
 const message=(event as {message?:unknown})?.message;
 return typeof message==='string'&&message?message:'The geometry worker stopped unexpectedly.';
};
