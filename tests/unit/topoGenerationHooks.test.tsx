import {act,renderHook} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {createDefaultTopoProject} from '../../src/topo/defaults';
import {terrainSettingsOf} from '../../src/topo/regeneration';
import {freezeTerrainView,terrainTilePlan,type TerrainResult} from '../../src/topo/terrain/pipeline';
import {tileKey} from '../../src/topo/terrain/tiles';
import {DEFAULT_TILE_FETCH_TIMEOUT_MS,type TileFetchLike} from '../../src/topo/terrain/fetchTiles';
import {TerrainCancelledError,TerrainTimeoutError,type TerrainRunHandle,type TerrainRunner} from '../../src/topo/terrain/worker/terrainRunner';
import {useTerrainGeneration} from '../../src/topo/ui/useTerrainGeneration';
import {FABRICATION_DEBOUNCE_MS,useFeatureFabrication,type FabricationInputs} from '../../src/topo/ui/useFeatureFabrication';
import {FeatureJobCancelledError,type FeatureRunHandle,type FeatureRunner} from '../../src/topo/features/worker/featureRunner';
import type {FeatureJob,FeatureJobResult} from '../../src/topo/features/worker/featureJob';
import type {TopoCapture} from '../../src/topo/capture/topoCapture';

// The page-level orchestration of the topo builder's two workers. The runners themselves are tested
// in topoTerrainRunner.test.ts and featureRunner.test.ts; these test what the page sees: tile
// download failures and timeouts, cancellation part-way through, and a superseded request's late
// answer never landing on top of the newer one.

const deferred=<T,>()=>{let resolve!:(v:T)=>void,reject!:(e:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const flush=()=>act(async()=>{for(let i=0;i<5;i++)await Promise.resolve()});

const project=createDefaultTopoProject(),settings=terrainSettingsOf(project,0);
const viewA=freezeTerrainView([-89.7,44.9],13,300,60,60),viewB=freezeTerrainView([-89.5,44.9],13,300,60,60);
const keysOf=(view:typeof viewA)=>[...new Set(terrainTilePlan(view).tiles.map(tileKey))];

// A fetch whose every tile is answered by the test, honouring the abort signal like a real fetch.
function controllableFetch(){
 const calls:{url:string;signal:AbortSignal;answer:ReturnType<typeof deferred<Awaited<ReturnType<TileFetchLike>>>>}[]=[];
 const fetchImpl:TileFetchLike=(url,init)=>{const answer=deferred<Awaited<ReturnType<TileFetchLike>>>();init.signal.addEventListener('abort',()=>answer.reject(Object.assign(new Error('aborted'),{name:'AbortError'})));calls.push({url,signal:init.signal,answer});return answer.promise};
 const ok={ok:true,status:200,arrayBuffer:async()=>new ArrayBuffer(8)};
 // Tiles download a few at a time, so answering is repeated until nothing is left waiting.
 const answerAll=async(from=0)=>{for(let round=0;round<30;round++){for(const c of calls.slice(from))c.answer.resolve(ok);await flush()}};
 return {calls,fetchImpl,ok,answerAll};
}

// A terrain runner whose jobs the test finishes, fails or watches being cancelled.
function controllableRunner(){
 const jobs:{view:unknown;result:ReturnType<typeof deferred<TerrainResult&{durationMs:number}>>;cancelled:boolean}[]=[];
 const runner:TerrainRunner={offMainThread:true,dispose:vi.fn(),run(job){
  const result=deferred<TerrainResult&{durationMs:number}>(),entry={view:job.view,result,cancelled:false};
  jobs.push(entry);
  const handle:TerrainRunHandle={result:result.promise,cancel(){entry.cancelled=true;result.reject(new TerrainCancelledError())}};
  return handle;
 }};
 return {jobs,runner};
}
const resultFor=(label:string)=>({label,durationMs:1} as unknown as TerrainResult&{durationMs:number});

afterEach(()=>{vi.useRealTimers()});

describe('useTerrainGeneration: tile download',()=>{
 it('a failed tile download ends in an error naming the tile, and never starts the worker',async()=>{
  const fetchImpl:TileFetchLike=vi.fn(async()=>({ok:false,status:502,arrayBuffer:async()=>new ArrayBuffer(0),json:async()=>({error:'upstream timeout'})}));
  const {jobs,runner}=controllableRunner(),{result}=renderHook(()=>useTerrainGeneration({fetchImpl,createRunner:()=>runner}));
  await act(()=>result.current.generate(viewA,settings));
  expect(result.current.state.status).toBe('error');
  expect(result.current.state.error?.code).toBe('tile-fetch-failed');
  expect(result.current.state.error?.message).toMatch(/^Elevation tile \d+\/\d+\/\d+ could not be downloaded \(HTTP 502\)\. upstream timeout$/);
  expect(jobs).toHaveLength(0);
 });

 it('a tile the source does not have is a missing-tile error, never sea level',async()=>{
  const fetchImpl:TileFetchLike=vi.fn(async()=>({ok:false,status:404,arrayBuffer:async()=>new ArrayBuffer(0)}));
  const {runner}=controllableRunner(),{result}=renderHook(()=>useTerrainGeneration({fetchImpl,createRunner:()=>runner}));
  await act(()=>result.current.generate(viewA,settings));
  expect(result.current.state.error?.code).toBe('missing-tile');
 });

 it('a tile that never arrives times out into an error instead of downloading forever',async()=>{
  vi.useFakeTimers();
  const {fetchImpl}=controllableFetch(),{jobs,runner}=controllableRunner(),{result}=renderHook(()=>useTerrainGeneration({fetchImpl,createRunner:()=>runner}));
  let done!:Promise<void>;
  act(()=>{done=result.current.generate(viewA,settings)});
  expect(result.current.state).toMatchObject({status:'working',stage:'download'});
  await act(async()=>{await vi.advanceTimersByTimeAsync(DEFAULT_TILE_FETCH_TIMEOUT_MS+1);await done});
  expect(result.current.state.status).toBe('error');
  expect(result.current.state.error?.message).toMatch(/did not download within 20 seconds\.$/);
  expect(jobs).toHaveLength(0);
 });
});

describe('useTerrainGeneration: cancellation',()=>{
 it('cancel during the download aborts every request and returns to idle with no error',async()=>{
  const net=controllableFetch(),{jobs,runner}=controllableRunner(),{result}=renderHook(()=>useTerrainGeneration({fetchImpl:net.fetchImpl,createRunner:()=>runner}));
  let done!:Promise<void>;
  act(()=>{done=result.current.generate(viewA,settings)});
  await flush();
  expect(net.calls.length).toBeGreaterThan(0);
  act(()=>result.current.cancel());
  await act(()=>done);
  expect(net.calls.every(c=>c.signal.aborted)).toBe(true);
  expect(result.current.state).toEqual({status:'idle',result:undefined});
  expect(jobs).toHaveLength(0);
 });

 it('cancel while the worker runs cancels the job and keeps the previous result on screen',async()=>{
  const net=controllableFetch(),{jobs,runner}=controllableRunner(),{result}=renderHook(()=>useTerrainGeneration({fetchImpl:net.fetchImpl,createRunner:()=>runner}));
  // A first, finished generation.
  let done!:Promise<void>;
  act(()=>{done=result.current.generate(viewA,settings)});
  await flush();await net.answerAll();
  jobs[0].result.resolve(resultFor('A'));
  await act(()=>done);
  expect(result.current.state.status).toBe('ready');
  // A settings change reruns on the cached tiles; cancel it mid-run.
  act(()=>{done=result.current.generate(viewA,{...settings,layerCount:2},{keepResult:true})});
  await flush();
  expect(jobs).toHaveLength(2);
  act(()=>result.current.cancel());
  await act(()=>done);
  expect(jobs[1].cancelled).toBe(true);
  expect(result.current.state.status).toBe('ready');
  expect((result.current.state.result as unknown as {label:string}).label).toBe('A');
  expect(result.current.state.error).toBeUndefined();
 });

 it('a worker timeout surfaces as an error the page can show',async()=>{
  const net=controllableFetch(),{jobs,runner}=controllableRunner(),{result}=renderHook(()=>useTerrainGeneration({fetchImpl:net.fetchImpl,createRunner:()=>runner}));
  let done!:Promise<void>;
  act(()=>{done=result.current.generate(viewA,settings)});
  await flush();await net.answerAll();
  jobs[0].result.reject(new TerrainTimeoutError(90_000));
  await act(()=>done);
  expect(result.current.state).toMatchObject({status:'error',error:{message:'Terrain generation did not finish within 90 seconds and was stopped.'}});
 });
});

describe('useTerrainGeneration: stale results',()=>{
 it('a superseded download that finishes late never reaches the worker or the state',async()=>{
  const net=controllableFetch(),{jobs,runner}=controllableRunner(),{result}=renderHook(()=>useTerrainGeneration({fetchImpl:net.fetchImpl,createRunner:()=>runner}));
  let first!:Promise<void>,second!:Promise<void>;
  act(()=>{first=result.current.generate(viewA,settings)});
  await flush();
  const aCalls=net.calls.length;
  act(()=>{second=result.current.generate(viewB,settings)});
  await flush();
  // A's requests were aborted when B started.
  expect(net.calls.slice(0,aCalls).every(c=>c.signal.aborted)).toBe(true);
  await net.answerAll(aCalls);
  expect(jobs.map(j=>j.view)).toEqual([viewB]);
  jobs[0].result.resolve(resultFor('B'));
  await act(()=>Promise.all([first,second]));
  expect((result.current.state.result as unknown as {label:string}).label).toBe('B');
  expect(result.current.state.status).toBe('ready');
 });

 it('an older worker result that arrives after a newer request is ignored',async()=>{
  const net=controllableFetch(),{jobs,runner}=controllableRunner(),{result}=renderHook(()=>useTerrainGeneration({fetchImpl:net.fetchImpl,createRunner:()=>runner}));
  let first!:Promise<void>,second!:Promise<void>;
  act(()=>{first=result.current.generate(viewA,settings)});
  await flush();await net.answerAll();
  act(()=>{second=result.current.generate(viewA,{...settings,layerCount:3})});
  await flush();
  expect(jobs).toHaveLength(2);
  // The first job was cancelled when the second started; even if its answer still arrived, the
  // token check keeps it out of state.
  expect(jobs[0].cancelled).toBe(true);
  jobs[1].result.resolve(resultFor('second'));
  await act(()=>Promise.all([first,second]));
  expect((result.current.state.result as unknown as {label:string}).label).toBe('second');
  expect(keysOf(viewA).length).toBeGreaterThan(0);
 });

 it('unmounting mid-generation cancels the job and disposes the worker',async()=>{
  const net=controllableFetch(),{jobs,runner}=controllableRunner(),{result,unmount}=renderHook(()=>useTerrainGeneration({fetchImpl:net.fetchImpl,createRunner:()=>runner}));
  let done!:Promise<void>;
  act(()=>{done=result.current.generate(viewA,settings)});
  await flush();await net.answerAll();
  unmount();
  await done;
  expect(jobs[0].cancelled).toBe(true);
  expect(runner.dispose).toHaveBeenCalledOnce();
 });
});

describe('useFeatureFabrication',()=>{
 function controllableFeatureRunner(){
  const runs:{job:FeatureJob;result:ReturnType<typeof deferred<FeatureJobResult>>;cancelled:boolean}[]=[];
  const runner:FeatureRunner={offMainThread:true,dispose:vi.fn(),run(job){const result=deferred<FeatureJobResult>(),entry={job,result,cancelled:false};runs.push(entry);const handle:FeatureRunHandle={result:result.promise,cancel(){entry.cancelled=true;result.reject(new FeatureJobCancelledError())}};return handle}};
  return {runs,runner};
 }
 const capture={features:{roads:[]}} as unknown as TopoCapture;
 // Stable like the page's memoised land and water: fresh arrays every render would be a new job
 // every render.
 const LAND:[]=[],WATER:[]=[];
 const inputs=(runner:FeatureRunner,thicknessScale:number):FabricationInputs=>({capture,view:viewA,land:LAND,water:WATER,roads:{...project.roads,thicknessScale},routeLines:undefined,routeWidthMm:undefined,createRunner:()=>runner});
 const roadsResult=(label:string)=>({kind:'roads',layer:{label}} as unknown as FeatureJobResult);

 it('drops a superseded road build that finishes after the newer one started',async()=>{
  vi.useFakeTimers();
  const {runs,runner}=controllableFeatureRunner();
  const {result,rerender}=renderHook(({scale})=>useFeatureFabrication(inputs(runner,scale)),{initialProps:{scale:1}});
  await act(()=>vi.advanceTimersByTimeAsync(FABRICATION_DEBOUNCE_MS));
  expect(runs).toHaveLength(1);
  rerender({scale:2});
  await act(()=>vi.advanceTimersByTimeAsync(FABRICATION_DEBOUNCE_MS));
  expect(runs).toHaveLength(2);
  expect(runs[0].cancelled).toBe(true);
  // The old build's answer arrives late anyway: it must not replace anything.
  await act(async()=>{runs[0].result.resolve(roadsResult('old'))});
  expect(result.current.roads).toBeUndefined();
  expect(result.current.pending).toBe(true);
  await act(async()=>{runs[1].result.resolve(roadsResult('new'))});
  expect(result.current.roads).toEqual({label:'new'});
  expect(result.current.pending).toBe(false);
 });

 it('reports a failed build, and the next successful build clears the error',async()=>{
  vi.useFakeTimers();
  const {runs,runner}=controllableFeatureRunner();
  const {result,rerender}=renderHook(({scale})=>useFeatureFabrication(inputs(runner,scale)),{initialProps:{scale:1}});
  await act(()=>vi.advanceTimersByTimeAsync(FABRICATION_DEBOUNCE_MS));
  await act(async()=>{runs[0].result.reject(new Error('Feature geometry build did not finish within 45 seconds and was stopped.'))});
  expect(result.current).toMatchObject({pending:false,error:'Feature geometry build did not finish within 45 seconds and was stopped.'});
  rerender({scale:1.5});
  await act(()=>vi.advanceTimersByTimeAsync(FABRICATION_DEBOUNCE_MS));
  await act(async()=>{runs[1].result.resolve(roadsResult('ok'))});
  expect(result.current.error).toBeUndefined();
  expect(result.current.roads).toEqual({label:'ok'});
 });

 it('unmounting mid-build cancels it, disposes the runner, and updates nothing afterwards',async()=>{
  vi.useFakeTimers();
  const {runs,runner}=controllableFeatureRunner();
  const errors=vi.spyOn(console,'error').mockImplementation(()=>{});
  const {unmount}=renderHook(()=>useFeatureFabrication(inputs(runner,1)));
  await act(()=>vi.advanceTimersByTimeAsync(FABRICATION_DEBOUNCE_MS));
  unmount();
  expect(runs[0].cancelled).toBe(true);
  expect(runner.dispose).toHaveBeenCalledOnce();
  runs[0].result.resolve(roadsResult('late'));
  await Promise.resolve();
  expect(errors).not.toHaveBeenCalled();
  errors.mockRestore();
 });
});
