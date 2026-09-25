import {describe,expect,it,vi} from 'vitest';
import {TerrainError} from '../../src/topo/terrain/errors';
import {freezeTerrainView,generateTerrain,type TerrainJob,type TerrainResult} from '../../src/topo/terrain/pipeline';
import type {TerrainWorkerRequest} from '../../src/topo/terrain/worker/protocol';
import {TerrainCancelledError,TerrainTimeoutError,createInlineTerrainRunner,createTerrainRunner,type TerrainWorkerLike} from '../../src/topo/terrain/worker/terrainRunner';
import {tilesForView} from '../helpers/terrarium';

// The terrain worker runner: the ornament runner's contract (cancel = terminate, job ids against
// stale results, timeout, inline fallback), plus stage progress and error codes across the boundary.

class FakeWorker implements TerrainWorkerLike{
 onmessage:((event:{data:unknown})=>void)|null=null;
 onerror:((event:unknown)=>void)|null=null;
 posted:TerrainWorkerRequest[]=[];
 terminated=false;
 postMessage(message:TerrainWorkerRequest){this.posted.push(message)}
 terminate(){this.terminated=true}
 reply(data:unknown){this.onmessage?.({data})}
}
const setup=()=>{const workers:FakeWorker[]=[];const runner=createTerrainRunner(()=>{const w=new FakeWorker();workers.push(w);return w});return {workers,runner}};
const JOB={view:{},tiles:{},water:[],settings:{}} as unknown as TerrainJob;
const RESULT={layers:[],contours:[]} as unknown as TerrainResult;

describe('terrain runner (worker path)',()=>{
 it('posts the job, relays stages, and resolves with the result',async()=>{
  const {workers,runner}=setup(),stages:string[]=[];
  const handle=runner.run(JOB,{onStage:s=>stages.push(s)});
  const [worker]=workers,{jobId}=worker.posted[0];
  worker.reply({jobId,type:'progress',stage:'decode'});
  worker.reply({jobId,type:'progress',stage:'bands'});
  worker.reply({jobId,type:'done',ok:true,result:RESULT,durationMs:12});
  await expect(handle.result).resolves.toMatchObject({durationMs:12});
  expect(stages).toEqual(['decode','bands']);
  expect(runner.offMainThread).toBe(true);
 });

 it('a new run cancels the old one by terminating its worker, and the old job\'s late answer is ignored',async()=>{
  const {workers,runner}=setup();
  const first=runner.run(JOB);
  const second=runner.run(JOB);
  await expect(first.result).rejects.toBeInstanceOf(TerrainCancelledError);
  expect(workers[0].terminated).toBe(true);
  expect(workers).toHaveLength(2);
  const oldId=workers[0].posted[0].jobId,newId=workers[1].posted[0].jobId;
  expect(newId).not.toBe(oldId);
  // The terminated worker's message can no longer arrive; one echoed onto the new worker is dropped.
  workers[1].reply({jobId:oldId,type:'done',ok:true,result:{...RESULT,stale:true},durationMs:1});
  workers[1].reply({jobId:newId,type:'done',ok:true,result:RESULT,durationMs:2});
  await expect(second.result).resolves.not.toHaveProperty('stale');
 });

 it('cancel() rejects, terminates, and the next run starts a fresh worker',async()=>{
  const {workers,runner}=setup();
  const handle=runner.run(JOB);
  handle.cancel();
  await expect(handle.result).rejects.toBeInstanceOf(TerrainCancelledError);
  expect(workers[0].terminated).toBe(true);
  runner.run(JOB);
  expect(workers).toHaveLength(2);
 });

 it('keeps the error code across the worker boundary',async()=>{
  const {workers,runner}=setup();
  const handle=runner.run(JOB);
  workers[0].reply({jobId:workers[0].posted[0].jobId,type:'done',ok:false,error:'Elevation tile 13/1/2 is missing',code:'missing-tile'});
  const error=await handle.result.catch(e=>e);
  expect(error).toBeInstanceOf(TerrainError);
  expect(error).toMatchObject({code:'missing-tile',message:'Elevation tile 13/1/2 is missing'});
 });

 it('times out a stuck worker and terminates it',async()=>{
  vi.useFakeTimers();
  try{
   const {workers,runner}=setup();
   const handle=runner.run(JOB,{timeoutMs:1000});
   const settled=handle.result.catch(e=>e);
   vi.advanceTimersByTime(1001);
   expect(await settled).toBeInstanceOf(TerrainTimeoutError);
   expect(workers[0].terminated).toBe(true);
  }finally{vi.useRealTimers()}
 });

 it('rejects when the worker crashes, and replaces it',async()=>{
  const {workers,runner}=setup();
  const handle=runner.run(JOB);
  workers[0].onerror?.({message:'Uncaught RangeError'});
  await expect(handle.result).rejects.toThrow('Uncaught RangeError');
  runner.run(JOB);
  expect(workers).toHaveLength(2);
 });
});

describe('terrain runner (inline fallback)',()=>{
 const view=freezeTerrainView([-89.7,44.9],13,300,60,60);
 const job:TerrainJob={view,tiles:tilesForView(view,(u,v)=>100+200*u+50*v),water:[],settings:{layerCount:2,coveragePercent:[100,50,25,12],contoursEnabled:true,contourCount:3,smoothingRadius:1,gridLongSide:60}};

 it('is used without Worker and returns exactly what generateTerrain returns',async()=>{
  const runner=createTerrainRunner(undefined);
  expect(runner.offMainThread).toBe(false);
  const stages:string[]=[];
  const {durationMs,...result}=await runner.run(job,{onStage:s=>stages.push(s)}).result;
  expect(durationMs).toBeGreaterThanOrEqual(0);
  expect(JSON.stringify(result)).toBe(JSON.stringify(generateTerrain(job)));
  expect(stages).toEqual(['decode','resample','smooth','contours']);
 });

 it('can be cancelled before it starts',async()=>{
  const handle=createInlineTerrainRunner().run(job);
  handle.cancel();
  await expect(handle.result).rejects.toBeInstanceOf(TerrainCancelledError);
 });
});
