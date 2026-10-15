import {afterEach,describe,expect,it,vi} from 'vitest';
import {rectPathData} from '../../src/production/geometry/pathData';
import {buildLayerMesh} from '../../src/production/preview3d/worker/buildLayerMesh';
import {createInlineMeshRunner,createMeshRunner,isMeshBuildCancelled,type MeshWorkerLike} from '../../src/production/preview3d/worker/meshRunner';
import type {MeshLayerInput,MeshWorkerRequest} from '../../src/production/preview3d/worker/protocol';

// The preview's mesh builds: off the main thread when a worker exists, delivered layer by layer,
// superseded and cancelled by terminating the worker, and stopped (not waited on) when it hangs.

afterEach(()=>{vi.useRealTimers()});

const layer=(id:string):MeshLayerInput=>({id,outlinePaths:[`${rectPathData(0,0,100,80)} ${rectPathData(20,20,40,30)}`],widthMm:100,heightMm:80,thicknessMm:3.175});

// A worker stand-in that runs the real build and answers asynchronously, like a worker would.
function fakeWorker(options:{hang?:boolean}={}){
 const workers:(MeshWorkerLike&{terminated:boolean})[]=[];
 const factory=()=>{
  const w:MeshWorkerLike&{terminated:boolean}={
   terminated:false,onmessage:null,onerror:null,
   terminate(){w.terminated=true},
   postMessage(request:MeshWorkerRequest){
    if(options.hang)return;
    setTimeout(()=>{
     for(const l of request.layers)if(!w.terminated)w.onmessage?.({data:{jobId:request.jobId,kind:'layer',id:l.id,mesh:buildLayerMesh(l),durationMs:1}});
     if(!w.terminated)w.onmessage?.({data:{jobId:request.jobId,kind:'done',durationMs:2}});
    },0);
   },
  };
  workers.push(w);
  return w;
 };
 return {factory,workers};
}

describe('mesh runner',()=>{
 it('delivers each layer as it is built, then resolves; reports that it ran off the main thread',async()=>{
  const {factory}=fakeWorker(),runner=createMeshRunner(factory),seen:string[]=[];
  expect(runner.offMainThread).toBe(true);
  const handle=runner.build([layer('a'),layer('b'),layer('c')],id=>seen.push(id));
  await handle.done;
  expect(seen).toEqual(['a','b','c']);
 });

 it('a newer build supersedes the running one: the old one rejects as cancelled and its worker is killed',async()=>{
  const {factory,workers}=fakeWorker({hang:true}),runner=createMeshRunner(factory);
  const first=runner.build([layer('a')],()=>{});
  runner.build([layer('b')],()=>{});
  await expect(first.done).rejects.toSatisfy(isMeshBuildCancelled);
  expect(workers[0].terminated).toBe(true);
 });

 it('a hung worker is stopped after the timeout and reported',async()=>{
  vi.useFakeTimers();
  const {factory,workers}=fakeWorker({hang:true}),runner=createMeshRunner(factory);
  const handle=runner.build([layer('a')],()=>{},{timeoutMs:5000});
  const outcome=expect(handle.done).rejects.toThrow(/longer than 5 seconds/);
  await vi.advanceTimersByTimeAsync(5001);
  await outcome;
  expect(workers[0].terminated).toBe(true);
 });

 it('a worker error rejects with its message',async()=>{
  const factory=()=>{const w:MeshWorkerLike={onmessage:null,onerror:null,terminate(){},postMessage(r){setTimeout(()=>w.onmessage?.({data:{jobId:r.jobId,kind:'error',error:'layer-land has no closed outline to extrude.'}}),0)}};return w};
  await expect(createMeshRunner(factory).build([layer('a')],()=>{}).done).rejects.toThrow(/no closed outline/);
 });

 it('without a worker, builds one layer per task so the page can repaint between them',async()=>{
  const runner=createInlineMeshRunner(),seen:string[]=[];
  expect(runner.offMainThread).toBe(false);
  const handle=runner.build([layer('a'),layer('b')],id=>seen.push(id));
  expect(seen).toEqual([]);
  await handle.done;
  expect(seen).toEqual(['a','b']);
  const cancelled=runner.build([layer('a'),layer('b')],()=>{});
  cancelled.cancel();
  await expect(cancelled.done).rejects.toSatisfy(isMeshBuildCancelled);
 });

 it('an outline with no closed ring is an error, not an empty solid',()=>{
  expect(()=>buildLayerMesh({...layer('x'),outlinePaths:['M0 0 L10 0']})).toThrow(/no closed outline/);
 });
});
