// @vitest-environment node
import {mkdtemp,readdir,readFile,rm,stat,utimes} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {createSemaphore,createTerrainTileHandler,type TerrainFetchLike} from '../../src/server/terrain/handler';
import {serveTerrainTile,type BinaryResponseLike} from '../../src/server/terrain/httpRoute';
import {createDiskTileCache,createMemoryTileCache} from '../../src/server/terrain/tileCache';
import {DEFAULT_TERRAIN_TILES_URL,isValidTile,parseTilePath,tileUrl} from '../../src/server/terrain/tilePath';

// The /api/terrain proxy (ADR 0004): strict tile addressing, cache, concurrency cap, and errors that
// say what happened instead of inventing a tile.

const PNG=Uint8Array.of(0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1,2,3,4);
const reply=(status:number,body:Uint8Array=PNG)=>({ok:status>=200&&status<300,status,arrayBuffer:async()=>body.slice().buffer});

function response(){
 const headers:Record<string,string>={};
 const res={statusCode:0,headers,body:undefined as Uint8Array|string|undefined,ended:false,
  setHeader(name:string,value:string){headers[name.toLowerCase()]=value},
  end(body?:Uint8Array|string){res.body=body;res.ended=true}};
 return res as typeof res&BinaryResponseLike;
}

describe('tile path validation',()=>{
 it('accepts integer tiles inside the pyramid',()=>{
  expect(parseTilePath('/api/terrain/12/1027/1474.png')).toEqual({z:12,x:1027,y:1474});
  expect(parseTilePath('/api/terrain/0/0/0.png')).toEqual({z:0,x:0,y:0});
  expect(parseTilePath('/api/terrain/15/32767/32767.png')).toEqual({z:15,x:32767,y:32767});
 });
 it.each([
  '/api/terrain/12/1027/1474',
  '/api/terrain/12/1027/1474.jpg',
  '/api/terrain/16/0/0.png',
  '/api/terrain/12/4096/0.png',
  '/api/terrain/12/0/4096.png',
  '/api/terrain/-1/0/0.png',
  '/api/terrain/12/-1/0.png',
  '/api/terrain/1.5/0/0.png',
  '/api/terrain/12/1e3/0.png',
  '/api/terrain/12/0x10/0.png',
  '/api/terrain/12/ 1/0.png',
  '/api/terrain/12/1027/1474.png/extra',
  '/api/terrain/../../etc/passwd',
  '/api/terrain/12/../../../etc/passwd.png',
  '/api/terrain/12/%2e%2e/1.png',
  '/api/terrain/12/1027/..%2f..%2f1474.png',
  '/api/terrain/12/1027/1474.png%00',
  '/api/terrain/12//1474.png',
  '/api/terrain/99999999999999999999/0/0.png',
 ])('rejects %s',path=>{
  expect(parseTilePath(path)).toBeUndefined();
 });
 it('checks integer bounds directly too',()=>{
  expect(isValidTile({z:3,x:7,y:7})).toBe(true);
  expect(isValidTile({z:3,x:8,y:0})).toBe(false);
  expect(isValidTile({z:3,x:1.5,y:0})).toBe(false);
  expect(isValidTile({z:3,x:Number.NaN,y:0})).toBe(false);
 });
 it('builds the AWS Terrarium URL from integers only',()=>{
  expect(tileUrl(DEFAULT_TERRAIN_TILES_URL,{z:12,x:1027,y:1474})).toBe('https://s3.amazonaws.com/elevation-tiles-prod/terrarium/12/1027/1474.png');
 });
});

describe('terrain tile handler',()=>{
 it('fetches a miss upstream, caches it, and answers the next request from the cache',async()=>{
  const fetchImpl=vi.fn<TerrainFetchLike>(async()=>reply(200));
  const cache=createMemoryTileCache();
  const handle=createTerrainTileHandler({fetchImpl,cache});
  const first=await handle({z:12,x:1,y:2});
  expect(first).toMatchObject({status:200,cache:'miss'});
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(fetchImpl.mock.calls[0][0]).toBe('https://s3.amazonaws.com/elevation-tiles-prod/terrarium/12/1/2.png');
  expect(fetchImpl.mock.calls[0][1].headers['User-Agent']).toMatch(/LayeredMapStudio/);
  expect(cache.size).toBe(1);
  const second=await handle({z:12,x:1,y:2});
  expect(second).toMatchObject({status:200,cache:'hit'});
  expect(fetchImpl).toHaveBeenCalledTimes(1);
 });

 it('shares one upstream request between concurrent requests for the same tile',async()=>{
  let release!:()=>void;
  const gate=new Promise<void>(r=>{release=r});
  const fetchImpl=vi.fn<TerrainFetchLike>(async()=>{await gate;return reply(200)});
  const handle=createTerrainTileHandler({fetchImpl});
  const all=Promise.all([handle({z:5,x:1,y:1}),handle({z:5,x:1,y:1}),handle({z:5,x:1,y:1})]);
  await Promise.resolve();
  release();
  expect((await all).map(o=>o.status)).toEqual([200,200,200]);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
 });

 it('never has more than `concurrency` upstream requests open',async()=>{
  let open=0,peak=0;
  const fetchImpl:TerrainFetchLike=async()=>{open++;peak=Math.max(peak,open);await new Promise(r=>setTimeout(r,5));open--;return reply(200)};
  const handle=createTerrainTileHandler({fetchImpl,concurrency:3});
  const results=await Promise.all(Array.from({length:12},(_,i)=>handle({z:10,x:i,y:0})));
  expect(results.every(r=>r.status===200)).toBe(true);
  expect(peak).toBe(3);
 });

 it('reports a tile the upstream does not have as missing, and caches nothing',async()=>{
  for(const status of [403,404]){
   const cache=createMemoryTileCache();
   const outcome=await createTerrainTileHandler({fetchImpl:async()=>reply(status),cache})({z:14,x:5,y:6});
   expect(outcome).toMatchObject({status:404,code:'missing-tile'});
   expect(cache.size).toBe(0);
  }
 });

 it('distinguishes upstream failure, a non-PNG body, and a timeout',async()=>{
  expect(await createTerrainTileHandler({fetchImpl:async()=>reply(500)})({z:1,x:0,y:0})).toMatchObject({status:502,code:'upstream-failed'});
  expect(await createTerrainTileHandler({fetchImpl:async()=>{throw new Error('ECONNREFUSED')}})({z:1,x:0,y:0})).toMatchObject({status:502,code:'upstream-failed',error:expect.stringContaining('ECONNREFUSED')});
  expect(await createTerrainTileHandler({fetchImpl:async()=>reply(200,new TextEncoder().encode('<html>'))})({z:1,x:0,y:0})).toMatchObject({status:502,code:'not-a-png'});
  const hang:TerrainFetchLike=(_url,init)=>new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('aborted'))));
  expect(await createTerrainTileHandler({fetchImpl:hang,timeoutMs:20})({z:1,x:0,y:0})).toMatchObject({status:504,code:'upstream-timeout'});
 });

 it('still serves a tile when the cache cannot be written',async()=>{
  const cache={get:async()=>undefined,set:async()=>{throw new Error('EACCES')}};
  expect(await createTerrainTileHandler({fetchImpl:async()=>reply(200),cache})({z:1,x:0,y:0})).toMatchObject({status:200,cache:'miss'});
 });

 it('ignores a corrupt cache entry and refetches',async()=>{
  const fetchImpl=vi.fn<TerrainFetchLike>(async()=>reply(200));
  const cache={get:async()=>Uint8Array.of(1,2,3),set:async()=>{}};
  expect(await createTerrainTileHandler({fetchImpl,cache})({z:1,x:0,y:0})).toMatchObject({status:200,cache:'miss'});
  expect(fetchImpl).toHaveBeenCalledTimes(1);
 });
});

describe('semaphore',()=>{
 it('runs waiters in arrival order and releases on failure',async()=>{
  const s=createSemaphore(1),order:number[]=[];
  await Promise.allSettled([s.run(async()=>{order.push(1);throw new Error('x')}),s.run(async()=>{order.push(2)}),s.run(async()=>{order.push(3)})]);
  expect(order).toEqual([1,2,3]);
  expect(s.active).toBe(0);
 });
});

describe('terrain HTTP route',()=>{
 const handler=createTerrainTileHandler({fetchImpl:async()=>reply(200)});

 it('answers a PNG with image headers and the cache status',async()=>{
  const res=response();
  await serveTerrainTile({url:'/api/terrain/3/1/2.png',method:'GET'},res,handler);
  expect(res.statusCode).toBe(200);
  expect(res.headers['content-type']).toBe('image/png');
  expect(res.headers['cache-control']).toMatch(/immutable/);
  expect(res.headers['x-terrain-cache']).toBe('miss');
  expect(res.body).toEqual(PNG);
 });

 it('reads the full path from originalUrl when mounted as dev middleware',async()=>{
  const res=response();
  await serveTerrainTile({url:'/3/1/2.png',originalUrl:'/api/terrain/3/1/2.png',method:'GET'},res,handler);
  expect(res.statusCode).toBe(200);
 });

 it('rejects bad tile paths with 400 before touching the handler',async()=>{
  const spy=vi.fn(handler);
  for(const url of ['/api/terrain/3/8/0.png','/api/terrain/../../etc/passwd','/api/terrain/3/1/2.png?x=../../','/api/terrain/%2e%2e/%2e%2e/etc/passwd']){
   const res=response();
   await serveTerrainTile({url,method:'GET'},res,spy);
   // A query string is ignored (the path is what is validated), so only the first three differ.
   if(url.includes('?')){expect(res.statusCode).toBe(200);continue}
   expect(res.statusCode).toBe(400);
   expect(JSON.parse(String(res.body))).toMatchObject({code:'invalid-tile'});
   expect(res.headers['cache-control']).toBe('no-store');
  }
  expect(spy).toHaveBeenCalledTimes(1);
 });

 it('allows GET and HEAD only; HEAD has no body',async()=>{
  const post=response();
  await serveTerrainTile({url:'/api/terrain/3/1/2.png',method:'POST'},post,handler);
  expect(post.statusCode).toBe(405);
  expect(post.headers.allow).toBe('GET, HEAD');
  const head=response();
  await serveTerrainTile({url:'/api/terrain/3/1/2.png',method:'HEAD'},head,handler);
  expect(head.statusCode).toBe(200);
  expect(head.body).toBeUndefined();
 });

 it('passes a missing tile through as a 404 with its code, uncacheable',async()=>{
  const res=response();
  await serveTerrainTile({url:'/api/terrain/3/1/2.png',method:'GET'},res,createTerrainTileHandler({fetchImpl:async()=>reply(404)}));
  expect(res.statusCode).toBe(404);
  expect(JSON.parse(String(res.body))).toMatchObject({code:'missing-tile'});
  expect(res.headers['cache-control']).toBe('no-store');
 });
});

describe('disk tile cache',()=>{
 let dir:string|undefined;
 afterEach(async()=>{if(dir)await rm(dir,{recursive:true,force:true});dir=undefined});

 it('persists tiles at <dir>/<z>/<x>/<y>.png across cache instances (a restarted server)',async()=>{
  dir=await mkdtemp(join(tmpdir(),'terrain-cache-'));
  await createDiskTileCache(dir).set({z:12,x:1027,y:1474},PNG);
  expect(new Uint8Array(await readFile(join(dir,'12','1027','1474.png')))).toEqual(PNG);
  expect(await createDiskTileCache(dir).get({z:12,x:1027,y:1474})).toEqual(PNG);
  expect(await createDiskTileCache(dir).get({z:12,x:1027,y:1475})).toBeUndefined();
  // No temporary files left behind by the write-then-rename.
  expect(await readdir(join(dir,'12','1027'))).toEqual(['1474.png']);
 });

 it('evicts the oldest tiles once over its size limit',async()=>{
  dir=await mkdtemp(join(tmpdir(),'terrain-cache-'));
  const big=new Uint8Array(1000);big.set(PNG);
  const seed=createDiskTileCache(dir);
  for(let i=0;i<5;i++){await seed.set({z:10,x:i,y:0},big);await utimes(join(dir,'10',String(i),'0.png'),1000+i,1000+i)}
  const cache=createDiskTileCache(dir,{maxBytes:5500});
  await cache.set({z:10,x:9,y:0},big);
  const exists=async(x:number)=>stat(join(dir!,'10',String(x),'0.png')).then(()=>true,()=>false);
  expect(await exists(0)).toBe(false);
  expect(await exists(1)).toBe(false);
  expect(await exists(4)).toBe(true);
  expect(await exists(9)).toBe(true);
 });

 it('serves through the handler as a hit after a restart',async()=>{
  dir=await mkdtemp(join(tmpdir(),'terrain-cache-'));
  await createTerrainTileHandler({fetchImpl:async()=>reply(200),cache:createDiskTileCache(dir)})({z:4,x:3,y:2});
  const fetchImpl=vi.fn<TerrainFetchLike>(async()=>reply(500));
  expect(await createTerrainTileHandler({fetchImpl,cache:createDiskTileCache(dir)})({z:4,x:3,y:2})).toMatchObject({status:200,cache:'hit'});
  expect(fetchImpl).not.toHaveBeenCalled();
 });
});
