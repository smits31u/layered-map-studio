import {describe,expect,it} from 'vitest';
import {buildFeatureGeometry,type FeatureGeometryInput} from '../../src/ornament/geometry/featureGeometry';
import {
 createGeometryRunner,
 createInlineRunner,
 GeometryCancelledError,
 isCancelled,
 type WorkerLike,
} from '../../src/ornament/worker/geometryRunner';
import type {GeometryWorkerRequest,GeometryWorkerResponse} from '../../src/ornament/worker/protocol';
import {isGeometryWorkerResponse} from '../../src/ornament/worker/protocol';
import {cityCapture,ruralCapture} from '../fixtures/ornament/captures';
import {fixtureCapture} from '../helpers/ornamentCapture';
import {GOLDEN_SETTINGS} from '../helpers/ornamentGolden';

// "Move expensive geometry work to a cancellable Web Worker." Two claims to check: that the work can
// actually be cancelled, and that the result is the same whichever side of the boundary it was
// computed on.
//
// jsdom has no `Worker`, so the worker path is driven through an injected fake that runs the same
// pure function the real worker module runs. What the fake cannot prove is that Vite bundles the
// worker chunk correctly — that is a production-build concern, checked by building the container.

const input=(revision=1,capture=fixtureCapture(ruralCapture(),{detail:'high'})):FeatureGeometryInput=>
 ({revision,capture,settings:GOLDEN_SETTINGS});

// Stands in for the real worker: same protocol, same function, but the "thread" is a deferred
// callback this test controls, so a job can be left in flight and then cancelled.
function fakeWorkerFactory(){
 const created:{worker:WorkerLike;flush():void;terminated:boolean}[]=[];
 const factory=():WorkerLike=>{
  const pending:(()=>void)[]=[];
  const record={
   terminated:false,
   flush(){const queued=[...pending];pending.length=0;for(const run of queued)run()},
   worker:{
    onmessage:null,
    onerror:null,
    postMessage(message:GeometryWorkerRequest){
     pending.push(()=>{
      if(record.terminated)return;
      let response:GeometryWorkerResponse;
      try{response={jobId:message.jobId,ok:true,result:buildFeatureGeometry(message.input),durationMs:7}}
      catch(error){response={jobId:message.jobId,ok:false,error:(error as Error).message}}
      record.worker.onmessage?.({data:response});
     });
    },
    terminate(){record.terminated=true;pending.length=0},
   } as WorkerLike,
  };
  created.push(record);
  return record.worker;
 };
 return {factory,created};
}

describe('protocol',()=>{
 it('recognises its own messages and nothing else',()=>{
  expect(isGeometryWorkerResponse({jobId:1,ok:true})).toBe(true);
  expect(isGeometryWorkerResponse({jobId:1})).toBe(false);
  expect(isGeometryWorkerResponse(null)).toBe(false);
  expect(isGeometryWorkerResponse('done')).toBe(false);
 });
});

describe('inline runner',()=>{
 it('reports that it is not off the main thread, rather than pretending',()=>{
  expect(createInlineRunner().offMainThread).toBe(false);
 });

 it('produces the same result the pure function does',async()=>{
  const runner=createInlineRunner();
  const job=input();
  const result=await runner.run(job).result;
  const direct=buildFeatureGeometry(job);
  expect(JSON.stringify(result.roadsEngrave)).toBe(JSON.stringify(direct.roadsEngrave));
  expect(result.revision).toBe(direct.revision);
 });

 it('records how long the build took',async()=>{
  const result=await createInlineRunner().run(input()).result;
  expect(typeof result.metrics.durationMs).toBe('number');
 });

 it('is asynchronous, so nothing can depend on a synchronous result',()=>{
  let settled=false;
  createInlineRunner().run(input()).result.then(()=>{settled=true});
  expect(settled).toBe(false);
 });

 it('rejects a cancelled run rather than resolving with work nobody wants',async()=>{
  const handle=createInlineRunner().run(input());
  handle.cancel();
  await expect(handle.result).rejects.toThrow(GeometryCancelledError);
 });

 it('stops answering once disposed',async()=>{
  const runner=createInlineRunner();
  runner.dispose();
  await expect(runner.run(input()).result).rejects.toThrow(GeometryCancelledError);
 });

 it('surfaces a build failure as a rejection, not as an empty result',async()=>{
  // A structurally broken capture — the shape a corrupted postMessage or a future schema change
  // would produce. The point is that it rejects with the real error rather than resolving with an
  // empty ornament that looks like "this place has no roads".
  const broken={revision:1,capture:{},settings:GOLDEN_SETTINGS} as unknown as FeatureGeometryInput;
  await expect(createInlineRunner().run(broken).result).rejects.toThrow();
 });
});

describe('worker runner',()=>{
 it('reports that it is off the main thread',()=>{
  const {factory}=fakeWorkerFactory();
  expect(createGeometryRunner(factory).offMainThread).toBe(true);
 });

 it('resolves with the worker result',async()=>{
  const {factory,created}=fakeWorkerFactory();
  const runner=createGeometryRunner(factory);
  const handle=runner.run(input());
  created[0].flush();
  const result=await handle.result;
  expect(result.revision).toBe(1);
  expect(result.metrics.durationMs).toBe(7);
  runner.dispose();
 });

 // The cancellation that matters. `buildFeatureGeometry` is one synchronous call into Clipper and
 // polygon-clipping, so terminating the worker is the only way to actually stop it — a promise that
 // merely stops listening would leave a core pinned on a dense city capture.
 it('terminates the worker on cancel instead of only ignoring the answer',async()=>{
  const {factory,created}=fakeWorkerFactory();
  const runner=createGeometryRunner(factory);
  const handle=runner.run(input());
  handle.cancel();
  expect(created[0].terminated).toBe(true);
  await expect(handle.result).rejects.toThrow(GeometryCancelledError);
  runner.dispose();
 });

 it('cancels the run in flight when a new one starts',async()=>{
  const {factory,created}=fakeWorkerFactory();
  const runner=createGeometryRunner(factory);
  const first=runner.run(input(1));
  const rejection=expect(first.result).rejects.toThrow(GeometryCancelledError);
  const second=runner.run(input(2));
  created[created.length-1].flush();
  expect((await second.result).revision).toBe(2);
  await rejection;
  runner.dispose();
 });

 it('starts a fresh worker after a cancellation rather than reusing a terminated one',async()=>{
  const {factory,created}=fakeWorkerFactory();
  const runner=createGeometryRunner(factory);
  const first=runner.run(input(1));
  first.cancel();
  await first.result.catch(()=>{});
  const second=runner.run(input(2));
  expect(created).toHaveLength(2);
  created[1].flush();
  expect((await second.result).revision).toBe(2);
  runner.dispose();
 });

 it('ignores a late message from a superseded job',async()=>{
  const {factory,created}=fakeWorkerFactory();
  const runner=createGeometryRunner(factory);
  const handle=runner.run(input(1));
  created[0].worker.onmessage?.({data:{jobId:999,ok:true,result:{revision:999},durationMs:0}});
  created[0].flush();
  expect((await handle.result).revision).toBe(1);
  runner.dispose();
 });

 it('rejects when the worker itself fails, with a message rather than silence',async()=>{
  const {factory,created}=fakeWorkerFactory();
  const runner=createGeometryRunner(factory);
  const handle=runner.run(input());
  created[0].worker.onerror?.({message:'Failed to construct Worker'});
  await expect(handle.result).rejects.toThrow(/Failed to construct Worker/);
  runner.dispose();
 });

 it('rejects when the worker reports a geometry failure',async()=>{
  const {factory,created}=fakeWorkerFactory();
  const runner=createGeometryRunner(factory);
  const handle=runner.run(input());
  created[0].worker.onmessage?.({data:{jobId:1,ok:false,error:'Water union failed'}});
  await expect(handle.result).rejects.toThrow('Water union failed');
  runner.dispose();
 });

 it('cancelling a job that already finished does nothing',async()=>{
  const {factory,created}=fakeWorkerFactory();
  const runner=createGeometryRunner(factory);
  const handle=runner.run(input());
  created[0].flush();
  await handle.result;
  expect(()=>handle.cancel()).not.toThrow();
  runner.dispose();
 });

 it('falls back to the inline runner when the environment has no Worker',()=>{
  expect(createGeometryRunner(undefined).offMainThread).toBe(false);
 });

 it('rejects rather than hanging when the worker cannot be constructed at all',async()=>{
  const runner=createGeometryRunner(()=>{throw new Error('Workers are blocked here')});
  await expect(runner.run(input()).result).rejects.toThrow('Workers are blocked here');
 });
});

describe('the two runners agree',()=>{
 it('produce byte-identical geometry for a dense city capture',async()=>{
  const job=input(1,fixtureCapture(cityCapture(),{detail:'high'}));
  const {factory,created}=fakeWorkerFactory();
  const worker=createGeometryRunner(factory);
  const handle=worker.run(job);
  created[0].flush();
  const offThread=await handle.result;
  const onThread=await createInlineRunner().run(job).result;
  expect(JSON.stringify(offThread.roadsEngrave)).toBe(JSON.stringify(onThread.roadsEngrave));
  worker.dispose();
 });
});

describe('the worker module',()=>{
 it('answers a request with a result carrying the same job id',async()=>{
  const posted:GeometryWorkerResponse[]=[];
  void posted;
  const scope={onmessage:null as ((event:{data:unknown})=>void)|null,postMessage:(message:GeometryWorkerResponse)=>{posted.push(message)}};
  const originalPost=Object.getOwnPropertyDescriptor(globalThis,'postMessage');
  Object.defineProperty(globalThis,'postMessage',{configurable:true,writable:true,value:scope.postMessage});
  const original=Object.getOwnPropertyDescriptor(globalThis,'onmessage');
  Object.defineProperty(globalThis,'onmessage',{configurable:true,writable:true,value:null});
  try{
   await import('../../src/ornament/worker/geometryWorker');
   const handler=(globalThis as unknown as {onmessage:((event:{data:unknown})=>void)|null}).onmessage;
   expect(handler).toBeTypeOf('function');
   const received:GeometryWorkerResponse[]=[];
   (globalThis as unknown as {postMessage:(m:GeometryWorkerResponse)=>void}).postMessage=message=>received.push(message);
   handler!({data:{jobId:42,input:input(42)} satisfies GeometryWorkerRequest});
   expect(received).toHaveLength(1);
   expect(received[0].jobId).toBe(42);
   expect(received[0].ok).toBe(true);
  }finally{
   if(original)Object.defineProperty(globalThis,'onmessage',original);
   if(originalPost)Object.defineProperty(globalThis,'postMessage',originalPost);
  }
 });
});
