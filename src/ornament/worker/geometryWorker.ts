import {buildFeatureGeometry} from '../geometry/featureGeometry';
import type {GeometryWorkerRequest,GeometryWorkerResponse} from './protocol';

// The geometry worker.
//
// It is this short because `buildFeatureGeometry` is pure: there is no state to set up, nothing to
// cache between jobs, and no reason for the worker to know anything about the app. It receives a
// serializable input, runs the same function the tests run, and posts back a serializable result.
//
// `tsconfig.app.json` declares the DOM libs, not WebWorker — adding WebWorker globally would put two
// conflicting definitions of `self`, `postMessage` and friends in front of every file in the
// project. Declaring the two methods this file actually uses is smaller and more honest than a
// project-wide lib change made for one module.
interface DedicatedWorkerScope{
 onmessage:((event:{data:unknown})=>void)|null;
 postMessage(message:GeometryWorkerResponse):void;
}

const scope=globalThis as unknown as DedicatedWorkerScope;

scope.onmessage=event=>{
 const request=event.data as GeometryWorkerRequest;
 const startedAt=Date.now();
 try{
  const result=buildFeatureGeometry(request.input);
  scope.postMessage({jobId:request.jobId,ok:true,result,durationMs:Date.now()-startedAt});
 }catch(error){
  // Errors do not survive structured cloning with their prototype, and a worker that throws its way
  // out of onmessage produces an `error` event with no useful message in most browsers. Flattening
  // to a string here is what lets the page show the user the actual geometry failure.
  scope.postMessage({jobId:request.jobId,ok:false,error:(error as Error)?.message??String(error)});
 }
};
