import {buildFeatureJob,type FeatureJob} from './featureJob';

// The feature worker: runs buildFeatureJob, the same pure function the inline fallback and the tests
// run. Structured like the terrain worker, declaring the two worker-scope members it uses.
interface DedicatedWorkerScope{
 onmessage:((event:{data:unknown})=>void)|null;
 postMessage(message:unknown):void;
}

const scope=globalThis as unknown as DedicatedWorkerScope;

scope.onmessage=event=>{
 const {jobId,job}=event.data as {jobId:number;job:FeatureJob};
 try{scope.postMessage({jobId,ok:true,result:buildFeatureJob(job)})}
 catch(error){scope.postMessage({jobId,ok:false,error:(error as Error)?.message??String(error)})}
};
