import type {MeshData} from '../extrude';
import {buildLayerMesh} from './buildLayerMesh';
import {isMeshWorkerResponse,type MeshLayerInput,type MeshWorkerRequest} from './protocol';

// Runs the layer-mesh builds for the 3D preview: in a worker when there is one, layer by layer on
// the main thread otherwise. Same shape as the ornament's geometry runner (src/ornament/worker/
// geometryRunner.ts): a newer build supersedes an older one, cancellation terminates the worker
// (triangulation takes no cancellation token), and a worker that stops answering is killed after a
// timeout and reported, never waited on.

export type MeshBuildHandle={done:Promise<{durationMs:number}>;cancel():void};
export type MeshRunner={build(layers:MeshLayerInput[],onLayer:(id:string,mesh:MeshData,durationMs:number)=>void,options?:{timeoutMs?:number}):MeshBuildHandle;readonly offMainThread:boolean;dispose():void};

export interface MeshWorkerLike{
 postMessage(message:MeshWorkerRequest):void;
 terminate():void;
 onmessage:((event:{data:unknown})=>void)|null;
 onerror:((event:unknown)=>void)|null;
}

export class MeshBuildCancelledError extends Error{constructor(){super('3D preview build cancelled.');this.name='MeshBuildCancelledError'}}
export const isMeshBuildCancelled=(e:unknown)=>(e as Error)?.name==='MeshBuildCancelledError';

// Willow Flowage's Land layer, the worst shoreline on file, builds in well under a second; a minute
// means something is wrong, and the preview says so instead of spinning.
export const DEFAULT_MESH_TIMEOUT_MS=60_000;

export const defaultMeshWorkerFactory:(()=>MeshWorkerLike)|undefined=typeof Worker==='undefined'?undefined:()=>new Worker(new URL('./meshWorker.ts',import.meta.url),{type:'module'}) as unknown as MeshWorkerLike;

export function createMeshRunner(factory=defaultMeshWorkerFactory):MeshRunner{
 if(!factory)return createInlineMeshRunner();
 let worker:MeshWorkerLike|undefined,active=0,nextJob=1;
 let settle:{resolve(v:{durationMs:number}):void;reject(e:unknown):void;onLayer:(id:string,mesh:MeshData,ms:number)=>void}|undefined;
 const discard=()=>{if(!worker)return;worker.onmessage=null;worker.onerror=null;try{worker.terminate()}catch{/* gone */}worker=undefined};
 const fail=(error:unknown)=>{const pending=settle;settle=undefined;active=0;discard();pending?.reject(error)};
 const ensure=()=>{
  if(worker)return worker;
  const created=factory();
  created.onmessage=event=>{
   const message=event.data;
   if(!isMeshWorkerResponse(message)||message.jobId!==active||!settle)return;
   if(message.kind==='layer')settle.onLayer(message.id,message.mesh,message.durationMs);
   else if(message.kind==='done'){const pending=settle;settle=undefined;active=0;pending.resolve({durationMs:message.durationMs})}
   else{const pending=settle;settle=undefined;active=0;pending.reject(new Error(message.error))}
  };
  created.onerror=event=>fail(new Error((event as {message?:string})?.message||'The 3D preview worker stopped unexpectedly.'));
  worker=created;
  return created;
 };
 return {
  offMainThread:true,
  build(layers,onLayer,options){
   if(settle)fail(new MeshBuildCancelledError());
   const jobId=nextJob++;
   active=jobId;
   const timeoutMs=options?.timeoutMs??DEFAULT_MESH_TIMEOUT_MS;
   let timer:ReturnType<typeof setTimeout>|undefined;
   const done=new Promise<{durationMs:number}>((resolve,reject)=>{
    settle={resolve,reject,onLayer};
    timer=setTimeout(()=>{if(active===jobId)fail(new Error(`The 3D preview took longer than ${Math.round(timeoutMs/1000)} seconds to build and was stopped.`))},timeoutMs);
    try{ensure().postMessage({jobId,layers})}catch(error){fail(error)}
   });
   const clear=()=>{if(timer!==undefined)clearTimeout(timer)};
   done.then(clear,clear);
   return {done,cancel(){clear();if(active===jobId)fail(new MeshBuildCancelledError())}};
  },
  dispose(){settle=undefined;active=0;discard()},
 };
}

// No worker: one layer per macrotask, so the page repaints and stays responsive between layers.
// No timeout here, for the reason the ornament's inline runner gives: a timer cannot interrupt
// synchronous work on the thread it shares.
export function createInlineMeshRunner():MeshRunner{
 let disposed=false;
 return {
  offMainThread:false,
  build(layers,onLayer){
   let cancelled=false;
   const done=new Promise<{durationMs:number}>((resolve,reject)=>{
    const started=Date.now();
    const step=(i:number)=>{
     if(cancelled||disposed){reject(new MeshBuildCancelledError());return}
     if(i>=layers.length){resolve({durationMs:Date.now()-started});return}
     try{const t=Date.now(),mesh=buildLayerMesh(layers[i]);onLayer(layers[i].id,mesh,Date.now()-t)}catch(error){reject(error);return}
     setTimeout(()=>step(i+1),0);
    };
    setTimeout(()=>step(0),0);
   });
   return {done,cancel(){cancelled=true}};
  },
  dispose(){disposed=true},
 };
}
