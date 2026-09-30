import {describe,expect,it,vi} from 'vitest';
import type {MultiPolygonMm} from '../../src/geometry/shoreline/polygonEngine';
import {freezeTerrainView} from '../../src/topo/terrain/pipeline';
import {buildFeatureJob,type FeatureJob,type FeatureJobResult} from '../../src/topo/features/worker/featureJob';
import {
 FeatureJobCancelledError,
 FeatureJobTimeoutError,
 createFeatureRunner,
 createInlineFeatureRunner,
 isFeatureJobCancelled,
 type FeatureWorkerLike,
} from '../../src/topo/features/worker/featureRunner';

// Phase 0 backlog item 3: featureRunner.ts had ~25% statement coverage and no test file at all,
// thin specifically on error and cancellation paths. Mirrors the terrain runner's own test file
// (tests/unit/topoTerrainRunner.test.ts) since the two runners share the same contract; this also
// covers the worker timeout added alongside this test (featureRunner previously had none, so a
// stuck worker left `pending` true forever -- a silent hang rather than a reported fault).

class FakeWorker implements FeatureWorkerLike{
 onmessage:((event:{data:unknown})=>void)|null=null;
 onerror:((event:unknown)=>void)|null=null;
 posted:{jobId:number;job:FeatureJob}[]=[];
 terminated=false;
 postMessage(message:{jobId:number;job:FeatureJob}){this.posted.push(message)}
 terminate(){this.terminated=true}
 reply(data:unknown){this.onmessage?.({data})}
}
const setup=()=>{const workers:FakeWorker[]=[];const runner=createFeatureRunner(()=>{const w=new FakeWorker();workers.push(w);return w});return {workers,runner}};

const NOWHERE:MultiPolygonMm=[];
const VIEW=freezeTerrainView([-89.7,44.9],13,300,60,60);
const ROAD_JOB:FeatureJob={kind:'roads',roads:[],view:VIEW,settings:{detail:'high',thicknessScale:1},land:NOWHERE,water:NOWHERE};
const ROAD_RESULT={kind:'roads',layer:{}} as unknown as FeatureJobResult;

describe('feature runner (worker path)',()=>{
 it('posts the job and resolves with the worker result',async()=>{
  const {workers,runner}=setup();
  const handle=runner.run(ROAD_JOB);
  const [worker]=workers,{jobId}=worker.posted[0];
  expect(worker.posted[0].job).toBe(ROAD_JOB);
  worker.reply({jobId,ok:true,result:ROAD_RESULT});
  await expect(handle.result).resolves.toBe(ROAD_RESULT);
  expect(runner.offMainThread).toBe(true);
 });

 it('a new run cancels the old one by terminating its worker, and the old job\'s late answer is ignored',async()=>{
  const {workers,runner}=setup();
  const first=runner.run(ROAD_JOB);
  const second=runner.run(ROAD_JOB);
  await expect(first.result).rejects.toBeInstanceOf(FeatureJobCancelledError);
  expect(isFeatureJobCancelled(await first.result.catch(e=>e))).toBe(true);
  expect(workers[0].terminated).toBe(true);
  expect(workers).toHaveLength(2);
  const oldId=workers[0].posted[0].jobId,newId=workers[1].posted[0].jobId;
  expect(newId).not.toBe(oldId);
  workers[1].reply({jobId:oldId,ok:true,result:{...ROAD_RESULT,stale:true}});
  workers[1].reply({jobId:newId,ok:true,result:ROAD_RESULT});
  await expect(second.result).resolves.not.toHaveProperty('stale');
 });

 it('cancel() rejects with FeatureJobCancelledError, terminates, and the next run starts a fresh worker',async()=>{
  const {workers,runner}=setup();
  const handle=runner.run(ROAD_JOB);
  handle.cancel();
  await expect(handle.result).rejects.toBeInstanceOf(FeatureJobCancelledError);
  expect(workers[0].terminated).toBe(true);
  runner.run(ROAD_JOB);
  expect(workers).toHaveLength(2);
 });

 it('a mid-generation failure reported by the worker rejects with a clear message, not a hang',async()=>{
  const {workers,runner}=setup();
  const handle=runner.run(ROAD_JOB);
  workers[0].reply({jobId:workers[0].posted[0].jobId,ok:false,error:'Road geometry could not be unioned: self-intersecting input'});
  await expect(handle.result).rejects.toThrow('Road geometry could not be unioned: self-intersecting input');
 });

 it('rejects when the worker crashes outright, and replaces it for the next run',async()=>{
  const {workers,runner}=setup();
  const handle=runner.run(ROAD_JOB);
  workers[0].onerror?.({message:'Uncaught RangeError'});
  await expect(handle.result).rejects.toThrow('Uncaught RangeError');
  expect(workers[0].terminated).toBe(true);
  runner.run(ROAD_JOB);
  expect(workers).toHaveLength(2);
 });

 it('falls back to a generic message when the worker crashes without one',async()=>{
  const {workers,runner}=setup();
  const handle=runner.run(ROAD_JOB);
  workers[0].onerror?.({});
  await expect(handle.result).rejects.toThrow('The feature worker stopped unexpectedly.');
 });

 it('times out a stuck worker, terminates it, and reports a clear, distinct error',async()=>{
  vi.useFakeTimers();
  try{
   const {workers,runner}=setup();
   const handle=runner.run(ROAD_JOB,{timeoutMs:1000});
   const settled=handle.result.catch(e=>e);
   vi.advanceTimersByTime(1001);
   const error=await settled;
   expect(error).toBeInstanceOf(FeatureJobTimeoutError);
   expect(error.message).toMatch(/did not finish within 1 seconds and was stopped/);
   expect(workers[0].terminated).toBe(true);
   // A timeout is not treated as a user-initiated cancellation.
   expect(isFeatureJobCancelled(error)).toBe(false);
  }finally{vi.useRealTimers()}
 });

 it('does not time out a job that finishes first, and clears the timer',async()=>{
  vi.useFakeTimers();
  try{
   const {workers,runner}=setup();
   const handle=runner.run(ROAD_JOB,{timeoutMs:1000});
   workers[0].reply({jobId:workers[0].posted[0].jobId,ok:true,result:ROAD_RESULT});
   await expect(handle.result).resolves.toBe(ROAD_RESULT);
   vi.advanceTimersByTime(2000);
   // No stray timeout rejection after the timer would otherwise have fired.
   expect(workers[0].terminated).toBe(false);
  }finally{vi.useRealTimers()}
 });

 it('applies the default timeout when none is given, without ever firing on a normal reply',async()=>{
  vi.useFakeTimers();
  try{
   const {workers,runner}=setup();
   const handle=runner.run(ROAD_JOB);
   workers[0].reply({jobId:workers[0].posted[0].jobId,ok:true,result:ROAD_RESULT});
   await expect(handle.result).resolves.toBe(ROAD_RESULT);
  }finally{vi.useRealTimers()}
 });

 it('ignores a malformed or stale message shape',async()=>{
  const {workers,runner}=setup();
  const handle=runner.run(ROAD_JOB);
  workers[0].reply(null);
  workers[0].reply({jobId:'not-a-number',ok:true,result:ROAD_RESULT});
  workers[0].reply({jobId:999999,ok:true,result:ROAD_RESULT});
  workers[0].reply({jobId:workers[0].posted[0].jobId,ok:true,result:ROAD_RESULT});
  await expect(handle.result).resolves.toBe(ROAD_RESULT);
 });

 it('dispose() drops the pending settle and terminates the worker',async()=>{
  const {workers,runner}=setup();
  runner.run(ROAD_JOB);
  runner.dispose();
  expect(workers[0].terminated).toBe(true);
 });
});

describe('feature runner (inline fallback)',()=>{
 it('is used without Worker and returns exactly what buildFeatureJob returns',async()=>{
  const runner=createInlineFeatureRunner();
  expect(runner.offMainThread).toBe(false);
  const result=await runner.run(ROAD_JOB).result;
  expect(result).toEqual(buildFeatureJob(ROAD_JOB));
 });

 it('can be cancelled before it starts, rejecting with FeatureJobCancelledError',async()=>{
  const handle=createInlineFeatureRunner().run(ROAD_JOB);
  handle.cancel();
  await expect(handle.result).rejects.toBeInstanceOf(FeatureJobCancelledError);
 });

 it('rejects in-flight work once disposed, rather than resolving after teardown',async()=>{
  const runner=createInlineFeatureRunner();
  const handle=runner.run(ROAD_JOB);
  runner.dispose();
  await expect(handle.result).rejects.toBeInstanceOf(FeatureJobCancelledError);
 });

 it('surfaces a synchronous build failure as a rejection, not a thrown exception or a hang',async()=>{
  const runner=createInlineFeatureRunner();
  const badJob={kind:'roads',roads:null,view:VIEW,settings:{detail:'high',thicknessScale:1},land:NOWHERE,water:NOWHERE} as unknown as FeatureJob;
  await expect(runner.run(badJob).result).rejects.toBeTruthy();
 });
});
