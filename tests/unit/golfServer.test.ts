import {mkdtempSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {createGeocodeHandler} from '../../src/server/geocode/handler';
import {createNominatimAdapter,FILTERED_UPSTREAM_LIMIT} from '../../src/server/geocode/adapters/nominatim';
import {createPhotonAdapter} from '../../src/server/geocode/adapters/photon';
import {createCensusAdapter} from '../../src/server/geocode/adapters/census';
import type {Clock} from '../../src/server/geocode/rateLimiter';
import {createGolfSnapshotHandler,type GolfFetchLike} from '../../src/server/golf/handler';
import {parseSnapshotPath,serveGolf} from '../../src/server/golf/httpRoute';
import {boundaryQuery,buildGolfUserAgent,featureQuery,padBbox} from '../../src/server/golf/overpass';
import {createDiskSnapshotCache,createMemorySnapshotCache,snapshotKey} from '../../src/server/golf/snapshotCache';
import {GOLF_QUERY_VERSION} from '../../src/server/golf/types';
import {midValleeElements,midValleeSnapshot} from '../helpers/golfFixture';

// The golf snapshot route (docs/GOLF_MODULE_PLAN.md §2.2–2.3) and the geocoder's golf filter (§2.1),
// with an injected fetch: no test reaches a public service.

const instant:Clock={now:()=>0,sleep:async()=>{}};

// Answers the boundary query with the fixture's boundary and the feature query with its features,
// and records every call.
function overpass(status:(call:number)=>number=()=>200){
 const {boundary,features,osmBase}=midValleeElements();
 const calls:{url:string;body:string;headers:Record<string,string>}[]=[];
 const fetchImpl:GolfFetchLike=async(url,init)=>{
  calls.push({url,body:decodeURIComponent(init.body.replace(/^data=/,'')),headers:init.headers});
  const code=status(calls.length);
  const query=calls[calls.length-1].body;
  const elements=query.includes('[bbox:')?features:[boundary];
  return {ok:code===200,status:code,json:async()=>({osm3s:{timestamp_osm_base:osmBase},elements})};
 };
 return {fetchImpl,calls};
}

describe('golf snapshot handler',()=>{
 it('fetches the boundary, then its padded bbox, one request at a time, and caches the result',async()=>{
  const {fetchImpl,calls}=overpass();
  const cache=createMemorySnapshotCache();
  const handler=createGolfSnapshotHandler({fetchImpl,cache,clock:instant,userAgent:'test-agent',now:()=>new Date('2026-10-22T20:24:48.000Z')});
  const first=await handler({osmType:'way',osmId:29060461});
  expect(first.status).toBe(200);
  expect(calls).toHaveLength(2);
  expect(calls[0].body).toBe(boundaryQuery('way',29060461));
  expect(calls[1].body).toMatch(/^\[out:json\]\[timeout:60\]\[bbox:44\.35\d+,-88\.19\d+,44\.37\d+,-88\.17\d+\];/);
  expect(calls.every(c=>c.headers['User-Agent']==='test-agent')).toBe(true);
  if(first.status!==200)return;
  expect(first.body.cached).toBe(false);
  expect(JSON.stringify(first.body.snapshot)).toBe(JSON.stringify(midValleeSnapshot()));
  const second=await handler({osmType:'way',osmId:29060461});
  expect(second.status===200&&second.body.cached).toBe(true);
  expect(calls).toHaveLength(2);
  expect(cache.writes).toBe(1);
 });

 it('says OpenStreetMap is busy on 429 and 504, and never caches the failure',async()=>{
  for(const code of [429,504]){
   const {fetchImpl}=overpass(()=>code);
   const cache=createMemorySnapshotCache();
   const handler=createGolfSnapshotHandler({fetchImpl,cache,clock:instant});
   const outcome=await handler({osmType:'way',osmId:29060461});
   expect(outcome.status).toBe(503);
   expect(outcome.body).toEqual({error:'OpenStreetMap is busy, try again in a minute.',code:'overpass-busy'});
   expect(cache.size).toBe(0);
  }
 });

 it('treats an Overpass runtime remark as busy too',async()=>{
  const fetchImpl:GolfFetchLike=async()=>({ok:true,status:200,json:async()=>({elements:[],remark:'runtime error: Query timed out in "query" at line 1 after 61 seconds.'})});
  const outcome=await createGolfSnapshotHandler({fetchImpl,clock:instant})({osmType:'way',osmId:1});
  expect(outcome.body).toMatchObject({code:'overpass-busy'});
 });

 it('keeps the cached snapshot when a refresh fails, and replaces it when one succeeds',async()=>{
  let fail=false;
  const {fetchImpl:ok}=overpass();
  const fetchImpl:GolfFetchLike=async(url,init)=>fail?{ok:false,status:429,json:async()=>({})}:ok(url,init);
  const cache=createMemorySnapshotCache();
  let clock=0;
  const handler=createGolfSnapshotHandler({fetchImpl,cache,clock:instant,now:()=>new Date(Date.UTC(2026,9,22,0,0,++clock))});
  const first=await handler({osmType:'way',osmId:29060461});
  fail=true;
  const refused=await handler({osmType:'way',osmId:29060461,refresh:true});
  expect(refused.status).toBe(503);
  const kept=await handler({osmType:'way',osmId:29060461});
  expect(kept.status===200&&first.status===200&&kept.body.snapshot.fetchedAt===first.body.snapshot.fetchedAt).toBe(true);
  fail=false;
  const refreshed=await handler({osmType:'way',osmId:29060461,refresh:true});
  expect(refreshed.status===200&&first.status===200&&refreshed.body.snapshot.fetchedAt!==first.body.snapshot.fetchedAt).toBe(true);
 });

 it('refuses ids that are not golf courses, or not there',async()=>{
  const missing:GolfFetchLike=async()=>({ok:true,status:200,json:async()=>({elements:[]})});
  expect((await createGolfSnapshotHandler({fetchImpl:missing,clock:instant})({osmType:'relation',osmId:5})).body).toMatchObject({code:'not-found'});
  const park:GolfFetchLike=async()=>({ok:true,status:200,json:async()=>({elements:[{type:'way',id:5,tags:{leisure:'park'},geometry:[{lat:0,lon:0}]}]})});
  expect((await createGolfSnapshotHandler({fetchImpl:park,clock:instant})({osmType:'way',osmId:5})).body).toMatchObject({code:'not-a-golf-course'});
  expect((await createGolfSnapshotHandler({fetchImpl:park,clock:instant})({osmType:'node' as 'way',osmId:5})).status).toBe(400);
 });

 it('shares one upstream fetch between simultaneous requests for one course',async()=>{
  const {fetchImpl,calls}=overpass();
  const handler=createGolfSnapshotHandler({fetchImpl,clock:instant});
  const [a,b]=await Promise.all([handler({osmType:'way',osmId:29060461}),handler({osmType:'way',osmId:29060461})]);
  expect(a.status).toBe(200);
  expect(b.status).toBe(200);
  expect(calls).toHaveLength(2);
 });
});

describe('golf snapshot cache',()=>{
 const dirs:string[]=[];
 afterEach(()=>{for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true})});

 it('changes its key with the query version',()=>{
  expect(snapshotKey('way',29060461)).toBe(`way-29060461-v${GOLF_QUERY_VERSION}`);
  expect(snapshotKey('way',29060461,GOLF_QUERY_VERSION+1)).not.toBe(snapshotKey('way',29060461));
 });

 it('writes atomically to disk and reads back only what it recognises',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'golf-cache-'));dirs.push(dir);
  const cache=createDiskSnapshotCache(dir);
  const snapshot=midValleeSnapshot();
  const key=snapshotKey('way',29060461);
  expect(await cache.get(key)).toBeUndefined();
  await Promise.all([cache.set(key,snapshot),cache.set(key,snapshot)]);
  expect(readdirSync(dir)).toEqual([`${key}.json`]);
  expect(JSON.stringify(await cache.get(key))).toBe(JSON.stringify(snapshot));
  writeFileSync(join(dir,`${key}.json`),JSON.stringify({...snapshot,queryVersion:0}));
  expect(await cache.get(key)).toBeUndefined();
  writeFileSync(join(dir,`${key}.json`),'{not json');
  expect(await cache.get(key)).toBeUndefined();
 });

 it('refuses a key that could name a path',async()=>{
  const cache=createMemorySnapshotCache();
  await expect(cache.get('../etc/passwd')).rejects.toThrow();
 });
});

describe('golf route',()=>{
 it('parses only way/relation and digits',()=>{
  expect(parseSnapshotPath('/api/golf/snapshot/way/29060461')).toEqual({osmType:'way',osmId:29060461});
  expect(parseSnapshotPath('/api/golf/snapshot/relation/7')).toEqual({osmType:'relation',osmId:7});
  for(const bad of ['/api/golf/snapshot/node/1','/api/golf/snapshot/way/1.5','/api/golf/snapshot/way/%2e%2e','/api/golf/snapshot/way/0x1','/api/golf/snapshot/way/'])expect(parseSnapshotPath(bad)).toBeUndefined();
 });

 it('answers JSON, passes refresh=1, and refuses other methods',async()=>{
  const seen:unknown[]=[];
  const handler=async(request:unknown)=>{seen.push(request);return {status:200 as const,body:{snapshot:midValleeSnapshot(),cached:true}}};
  const response={statusCode:0,headers:{} as Record<string,string>,body:'',setHeader(n:string,v:string){this.headers[n]=v},end(b?:string){this.body=b??''}};
  await serveGolf({url:'/api/golf/snapshot/way/29060461?refresh=1',method:'GET'},response,handler);
  expect(response.statusCode).toBe(200);
  expect(response.headers['Content-Type']).toMatch(/json/);
  expect(seen).toEqual([{osmType:'way',osmId:29060461,refresh:true}]);
  await serveGolf({url:'/api/golf/snapshot/way/1',method:'POST'},response,handler);
  expect(response.statusCode).toBe(405);
 });
});

describe('overpass queries',()=>{
 it('pads the bbox by 50 m and asks for every golf, water and tree feature in it',()=>{
  const [w,s,e,n]=padBbox([-88.19,44.35,-88.17,44.37]);
  expect((44.35-s)*111320).toBeCloseTo(50,6);
  expect((-88.19-w)*111320*Math.cos(44.36*Math.PI/180)).toBeCloseTo(50,6);
  expect(e).toBeGreaterThan(-88.17);
  expect(n).toBeGreaterThan(44.37);
  const q=featureQuery([w,s,e,n]);
  for(const part of ['nwr["golf"];','nwr["natural"~"^(water|tree|wood)$"];','nwr["water"~"^(pond|lake)$"];','nwr["waterway"];','nwr["landuse"="forest"];','way["highway"]["golf_cart"];','out geom;'])expect(q).toContain(part);
 });
 it('identifies itself, in ASCII',()=>{
  expect(buildGolfUserAgent('1.2.3','ops@example.com')).toBe('LayeredMapStudio-Golf/1.2.3 (self-hosted laser map builder; golf course snapshots; ops@example.com)');
  expect(buildGolfUserAgent('1.2.3')).toMatch(/contact not configured/);
 });
});

describe('geocoder golf filter (§2.1)',()=>{
 it('asks Photon for leisure=golf_course and keeps the OSM type and id',()=>{
  const photon=createPhotonAdapter('https://photon.example');
  expect(photon.buildUrl('Mid Vallee',5,'golf-course')).toBe('https://photon.example/api/?q=Mid%20Vallee&limit=5&osm_tag=leisure:golf_course');
  expect(photon.buildUrl('Mid Vallee',5)).toBe('https://photon.example/api/?q=Mid%20Vallee&limit=5');
  const body={features:[
   {geometry:{coordinates:[-88.18,44.36]},properties:{osm_type:'W',osm_id:29060461,osm_key:'leisure',osm_value:'golf_course',name:'Mid Vallee Golf Course',city:'De Pere',state:'Wisconsin'}},
   {geometry:{coordinates:[-88.1,44.4]},properties:{osm_type:'N',osm_id:9,osm_key:'place',osm_value:'town',name:'De Pere'}},
  ]};
  const filtered=photon.parse(body,5,'golf-course');
  expect(filtered).toHaveLength(1);
  expect(filtered[0]).toMatchObject({osm:{type:'way',id:29060461},kind:'golf_course',label:'Mid Vallee Golf Course, De Pere, Wisconsin'});
  expect(photon.parse(body,5)).toHaveLength(2);
 });

 it('post-filters Nominatim on category and type, asking for more rows upstream',()=>{
  const nominatim=createNominatimAdapter('https://nominatim.example');
  expect(nominatim.buildUrl('Mid Vallee',5,'golf-course')).toContain(`&limit=${FILTERED_UPSTREAM_LIMIT}`);
  expect(nominatim.buildUrl('Mid Vallee',5)).toContain('&limit=5');
  const rows=[
   {place_id:1,osm_type:'way',osm_id:29060461,category:'leisure',type:'golf_course',lat:'44.36',lon:'-88.18',display_name:'Mid Vallee Golf Course, De Pere'},
   {place_id:2,osm_type:'way',osm_id:3,category:'highway',type:'residential',lat:'44.36',lon:'-88.18',display_name:'Mid Valley Drive'},
  ];
  const filtered=nominatim.parse(rows,5,'golf-course');
  expect(filtered).toHaveLength(1);
  expect(filtered[0].osm).toEqual({type:'way',id:29060461});
 });

 it('puts the filter in the cache key and refuses a provider that cannot filter',async()=>{
  const urls:string[]=[];
  const fetchImpl=async(url:string)=>{urls.push(url);return {ok:true,status:200,json:async()=>({features:[]})}};
  const handler=createGeocodeHandler({adapters:[createPhotonAdapter('https://photon.example'),createCensusAdapter('https://census.example')],fetchImpl,clock:instant});
  await handler({q:'Mid Vallee',provider:'photon'});
  const filtered=await handler({q:'Mid Vallee',provider:'photon',filter:'golf-course'});
  expect(urls).toHaveLength(2);
  expect(filtered.status===200&&'filter' in filtered.body&&filtered.body.filter).toBe('golf-course');
  expect((await handler({q:'Mid Vallee',provider:'census',filter:'golf-course'})).body).toMatchObject({code:'filter-unsupported'});
  expect((await handler({q:'Mid Vallee',provider:'photon',filter:'pizza'})).body).toMatchObject({code:'unknown-filter'});
 });
});
