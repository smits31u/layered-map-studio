import {TerrainError} from '../errors';
import {generateTerrain} from '../pipeline';
import type {TerrainWorkerRequest,TerrainWorkerResponse} from './protocol';

// The terrain worker: runs generateTerrain, the same pure function the tests and the inline fallback
// run, and reports its stages. Structured as the ornament's geometry worker is, including declaring
// the two worker-scope members it uses instead of adding the WebWorker lib project-wide.
interface DedicatedWorkerScope{
 onmessage:((event:{data:unknown})=>void)|null;
 postMessage(message:TerrainWorkerResponse):void;
}

const scope=globalThis as unknown as DedicatedWorkerScope;

scope.onmessage=event=>{
 const {jobId,job}=event.data as TerrainWorkerRequest;
 const startedAt=Date.now();
 try{
  const result=generateTerrain(job,stage=>scope.postMessage({jobId,type:'progress',stage}));
  scope.postMessage({jobId,type:'done',ok:true,result,durationMs:Date.now()-startedAt});
 }catch(error){
  scope.postMessage({jobId,type:'done',ok:false,error:(error as Error)?.message??String(error),code:error instanceof TerrainError?error.code:undefined});
 }
};
