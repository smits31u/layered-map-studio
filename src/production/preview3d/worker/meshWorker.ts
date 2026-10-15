import {buildLayerMesh} from './buildLayerMesh';
import type {MeshWorkerRequest,MeshWorkerResponse} from './protocol';

// Builds the preview's layer solids off the main thread and posts each one as soon as it is done,
// so the preview fills in layer by layer and the page keeps answering while a shoreline with
// hundreds of islands is triangulated. The typed arrays are transferred, not copied.
//
// Declares the two worker-scope members it uses instead of adding the WebWorker lib project-wide
// (same reasoning as src/ornament/worker/geometryWorker.ts).
interface DedicatedWorkerScope{
 onmessage:((event:{data:unknown})=>void)|null;
 postMessage(message:MeshWorkerResponse,transfer?:Transferable[]):void;
}

const scope=globalThis as unknown as DedicatedWorkerScope;

scope.onmessage=event=>{
 const request=event.data as MeshWorkerRequest;
 const started=Date.now();
 try{
  for(const layer of request.layers){
   const layerStarted=Date.now();
   const mesh=buildLayerMesh(layer);
   scope.postMessage({jobId:request.jobId,kind:'layer',id:layer.id,mesh,durationMs:Date.now()-layerStarted},[mesh.positions.buffer,mesh.normals.buffer,mesh.uvs.buffer,mesh.indices.buffer]);
  }
  scope.postMessage({jobId:request.jobId,kind:'done',durationMs:Date.now()-started});
 }catch(error){
  scope.postMessage({jobId:request.jobId,kind:'error',error:(error as Error)?.message??String(error)});
 }
};
