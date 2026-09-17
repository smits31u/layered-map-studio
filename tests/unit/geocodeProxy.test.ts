import {describe,expect,it} from 'vitest';
import {createLruCache} from '../../src/server/geocode/cache';
import {createRateLimiter,type Clock} from '../../src/server/geocode/rateLimiter';
import {buildUserAgent,createDefaultAdapters,createGeocodeHandler,MAX_RESULTS,normalizeQuery} from '../../src/server/geocode/handler';
import {GEOCODE_PATH,serveGeocode} from '../../src/server/geocode/httpRoute';
import {createNominatimAdapter} from '../../src/server/geocode/adapters/nominatim';
import {createPhotonAdapter} from '../../src/server/geocode/adapters/photon';
import {createCensusAdapter} from '../../src/server/geocode/adapters/census';
import type {FetchLike,GeocodeSuccess,GeocodeFailure} from '../../src/server/geocode/types';

// A clock that never really sleeps: `sleep` advances a virtual timeline instead, so the
// one-request-per-second policy can be asserted exactly without the test taking seconds.
function fakeClock(){
 let current=0;
 const clock:Clock={now:()=>current,sleep:async ms=>{current+=ms}};
 return {clock,advance:(ms:number)=>{current+=ms},get time(){return current}};
}

const jsonOk=(body:unknown)=>({ok:true,status:200,json:async()=>body});

const nominatimBody=[{place_id:1,display_name:'Crivitz, Marinette County, Wisconsin, United States',lat:'45.2352',lon:'-88.0040',boundingbox:['45.22','45.25','-88.02','-87.99'],type:'village'}];

describe('rate limiter',()=>{
 it('holds successive calls at least the configured interval apart',async()=>{
  const {clock}=fakeClock();
  const limiter=createRateLimiter(1000,clock);
  const startedAt:number[]=[];
  const task=()=>{startedAt.push(clock.now());return Promise.resolve(null)};
  await Promise.all([limiter.run(task),limiter.run(task),limiter.run(task)]);
  expect(startedAt).toEqual([0,1000,2000]);
 });

 it('does not make a caller wait when enough time has already passed',async()=>{
  const {clock,advance}=fakeClock();
  const limiter=createRateLimiter(1000,clock);
  await limiter.run(async()=>null);
  advance(5000);
  const at:number[]=[];
  await limiter.run(async()=>{at.push(clock.now())});
  expect(at).toEqual([5000]);
 });

 it('keeps serving after a task throws instead of wedging the queue',async()=>{
  const {clock}=fakeClock();
  const limiter=createRateLimiter(10,clock);
  await expect(limiter.run(async()=>{throw new Error('upstream down')})).rejects.toThrow('upstream down');
  await expect(limiter.run(async()=>'recovered')).resolves.toBe('recovered');
 });

 it('runs without delay when the interval is zero',async()=>{
  const {clock}=fakeClock();
  const limiter=createRateLimiter(0,clock);
  const at:number[]=[];
  await Promise.all([limiter.run(async()=>{at.push(clock.now())}),limiter.run(async()=>{at.push(clock.now())})]);
  expect(at).toEqual([0,0]);
 });
});

describe('response cache',()=>{
 it('returns a stored value and forgets it once the TTL passes',()=>{
  let now=0;
  const cache=createLruCache<string>(10,1000,()=>now);
  cache.set('a','one');
  expect(cache.get('a')).toBe('one');
  now=1001;
  expect(cache.get('a')).toBeUndefined();
 });

 it('evicts the least recently used entry when full',()=>{
  const cache=createLruCache<string>(2,10_000);
  cache.set('a','1');cache.set('b','2');
  cache.get('a');            // 'a' is now the most recent, so 'b' is next out
  cache.set('c','3');
  expect(cache.get('a')).toBe('1');
  expect(cache.get('b')).toBeUndefined();
  expect(cache.get('c')).toBe('3');
 });
});

describe('provider adapters',()=>{
 it('normalizes Nominatim rows, reordering its boundingbox to west/south/east/north',()=>{
  const [result]=createNominatimAdapter().parse(nominatimBody,MAX_RESULTS);
  expect(result.coordinates).toEqual([-88.004,45.2352]);
  expect(result.boundingBox).toEqual([-88.02,45.22,-87.99,45.25]);
  expect(result.provider).toBe('nominatim');
  expect(result.attribution).toMatch(/OpenStreetMap/);
 });

 it('caps Nominatim at one request per second and sends an identifying User-Agent',()=>{
  const adapter=createNominatimAdapter();
  expect(adapter.minIntervalMs).toBe(1000);
  const agent=buildUserAgent('0.1.0','ops@example.test');
  expect(adapter.headers(agent)['User-Agent']).toBe(agent);
  expect(agent).toMatch(/LayeredMapStudio-Ornament\/0\.1\.0/);
  expect(agent).toContain('ops@example.test');
 });

 it('says so in the User-Agent when no contact has been configured, rather than inventing one',()=>{
  expect(buildUserAgent('0.1.0')).toMatch(/GEOCODER_CONTACT/);
  expect(buildUserAgent('0.1.0','   ')).toMatch(/GEOCODER_CONTACT/);
 });

 it('normalizes Photon features, reordering its extent',()=>{
  const [result]=createPhotonAdapter().parse({features:[{geometry:{coordinates:[-88.004,45.2352]},properties:{osm_id:7,osm_type:'N',name:'Crivitz',state:'Wisconsin',country:'United States',osm_value:'village',extent:[-88.02,45.25,-87.99,45.22]}}]},MAX_RESULTS);
  expect(result.coordinates).toEqual([-88.004,45.2352]);
  expect(result.boundingBox).toEqual([-88.02,45.22,-87.99,45.25]);
  expect(result.label).toBe('Crivitz, Wisconsin, United States');
 });

 it('normalizes Census matches and leaves the bounding box undefined rather than inventing one',()=>{
  const [result]=createCensusAdapter().parse({result:{addressMatches:[{matchedAddress:'123 MAIN ST, CRIVITZ, WI, 54114',coordinates:{x:-88.004,y:45.2352},tigerLine:{tigerLineId:'6104'}}]}},MAX_RESULTS);
  expect(result.coordinates).toEqual([-88.004,45.2352]);
  expect(result.boundingBox).toBeUndefined();
  expect(result.provider).toBe('census');
 });

 it('rejects a malformed response instead of returning nothing and looking like a genuine miss',()=>{
  expect(()=>createNominatimAdapter().parse({error:'nope'},5)).toThrow();
  expect(()=>createPhotonAdapter().parse({},5)).toThrow();
  expect(()=>createCensusAdapter().parse({result:{}},5)).toThrow();
 });

 it('skips rows with unusable coordinates rather than emitting NaN',()=>{
  const results=createNominatimAdapter().parse([{place_id:1,lat:'nope',lon:'-88'},...nominatimBody],MAX_RESULTS);
  expect(results).toHaveLength(1);
  expect(results[0].coordinates.every(Number.isFinite)).toBe(true);
 });
});

describe('geocode handler',()=>{
 const build=(fetchImpl:FetchLike,overrides={})=>createGeocodeHandler({
  adapters:[createNominatimAdapter('https://nominatim.test'),createPhotonAdapter('https://photon.test')],
  fetchImpl,
  clock:fakeClock().clock,
  userAgent:'test-agent',
  ...overrides,
 });

 it('returns normalized candidates with attribution and the provider list',async()=>{
  const handler=build(async()=>jsonOk(nominatimBody));
  const outcome=await handler({q:'Crivitz, WI'});
  expect(outcome.status).toBe(200);
  const body=outcome.body as GeocodeSuccess;
  expect(body.provider).toBe('nominatim');
  expect(body.results[0]).toMatchObject({label:expect.stringContaining('Crivitz'),coordinates:[-88.004,45.2352]});
  expect(body.attribution).toMatch(/OpenStreetMap/);
  expect(body.providers.map(p=>p.id)).toEqual(['nominatim','photon']);
 });

 it('never returns more than five candidates',async()=>{
  const many=Array.from({length:12},(_,i)=>({place_id:i,display_name:`Place ${i}`,lat:'45',lon:'-88'}));
  const handler=build(async()=>jsonOk(many));
  const body=(await handler({q:'many'})).body as GeocodeSuccess;
  expect(body.results).toHaveLength(MAX_RESULTS);
 });

 it('asks upstream for at most five and sends the configured User-Agent',async()=>{
  const seen:{url:string;headers:Record<string,string>}[]=[];
  const handler=build(async(url,init)=>{seen.push({url,headers:init.headers});return jsonOk(nominatimBody)});
  await handler({q:'Crivitz'});
  expect(seen[0].url).toContain('limit=5');
  expect(seen[0].url).toContain('q=Crivitz');
  expect(seen[0].headers['User-Agent']).toBe('test-agent');
 });

 it('serves a repeated query from cache without a second upstream request',async()=>{
  let calls=0;
  const handler=build(async()=>{calls++;return jsonOk(nominatimBody)});
  expect(((await handler({q:'Crivitz, WI'})).body as GeocodeSuccess).cached).toBe(false);
  const second=(await handler({q:'  crivitz,   wi '})).body as GeocodeSuccess;
  expect(second.cached).toBe(true);
  expect(calls).toBe(1);
 });

 it('caches per provider, so switching provider is a real request',async()=>{
  let calls=0;
  const handler=build(async()=>{calls++;return jsonOk({features:[]})},{});
  await handler({q:'x',provider:'photon'});
  await handler({q:'x',provider:'photon'});
  expect(calls).toBe(1);
  await handler({q:'x',provider:'nominatim'});
  expect(calls).toBe(2);
 });

 it('does not fall back to another provider when a search legitimately finds nothing',async()=>{
  const used:string[]=[];
  const handler=build(async url=>{used.push(url);return jsonOk([])});
  const body=(await handler({q:'nowhere at all'})).body as GeocodeSuccess;
  expect(body.results).toEqual([]);
  expect(used).toHaveLength(1);
  expect(used[0]).toContain('nominatim.test');
 });

 it('does not fall back to another provider when the chosen one fails',async()=>{
  const used:string[]=[];
  const handler=build(async url=>{used.push(url);return {ok:false,status:503,json:async()=>({})}});
  const outcome=await handler({q:'Crivitz'});
  expect(outcome.status).toBe(502);
  expect((outcome.body as GeocodeFailure).code).toBe('upstream-failed');
  expect(used).toHaveLength(1);
 });

 it('honours an explicitly chosen provider and rejects an unknown one',async()=>{
  const used:string[]=[];
  const handler=build(async url=>{used.push(url);return jsonOk({features:[]})});
  await handler({q:'Crivitz',provider:'photon'});
  expect(used[0]).toContain('photon.test');
  const bad=await handler({q:'Crivitz',provider:'google'});
  expect(bad.status).toBe(400);
  expect((bad.body as GeocodeFailure).code).toBe('unknown-provider');
 });

 it('rejects an empty, over-long or control-character query before touching a provider',async()=>{
  let calls=0;
  const handler=build(async()=>{calls++;return jsonOk(nominatimBody)});
  expect((await handler({q:'   '})).status).toBe(400);
  expect((await handler({q:null})).status).toBe(400);
  expect((await handler({q:'x'.repeat(201)})).status).toBe(400);
  expect(((await handler({q:`Crivitz${String.fromCharCode(0)}WI`})).body as GeocodeFailure).code).toBe("query-invalid");
  expect(calls).toBe(0);
 });

 it('reports a timeout distinctly from an upstream failure',async()=>{
  const handler=build(async()=>{throw Object.assign(new Error('aborted'),{name:'AbortError'})});
  const outcome=await handler({q:'Crivitz'});
  expect(outcome.status).toBe(504);
  expect((outcome.body as GeocodeFailure).code).toBe('upstream-timeout');
 });

 it('applies the provider rate limit across separate searches',async()=>{
  const clock=fakeClock();
  const at:number[]=[];
  const handler=createGeocodeHandler({
   adapters:[createNominatimAdapter('https://nominatim.test')],
   clock:clock.clock,
   userAgent:'test-agent',
   fetchImpl:async()=>{at.push(clock.clock.now());return jsonOk(nominatimBody)},
  });
  await Promise.all([handler({q:'one'}),handler({q:'two'}),handler({q:'three'})]);
  expect(at).toEqual([0,1000,2000]);
 });

 it('ships three swappable adapters by default',()=>{
  expect(createDefaultAdapters().map(a=>a.id)).toEqual(['nominatim','photon','census']);
 });

 it('collapses whitespace when normalizing a query',()=>{
  expect(normalizeQuery('  Crivitz,\t  WI \n')).toBe('Crivitz, WI');
 });
});

describe('http route',()=>{
 const collect=()=>{
  const headers:Record<string,string>={};
  let body='';
  return {headers,get body(){return body},response:{statusCode:0,setHeader:(k:string,v:string)=>{headers[k]=v},end:(b?:string)=>{body=b??''}}};
 };

 it('reads q and provider from the query string and answers JSON',async()=>{
  const sink=collect();
  await serveGeocode({url:`${GEOCODE_PATH}?q=Crivitz&provider=photon`,method:'GET'},sink.response,async req=>({status:200,body:{query:String(req.q),provider:'photon',attribution:'a',results:[],cached:false,providers:[]}}));
  expect(sink.response.statusCode).toBe(200);
  expect(sink.headers['Content-Type']).toMatch(/application\/json/);
  expect(JSON.parse(sink.body)).toMatchObject({query:'Crivitz',provider:'photon'});
 });

 it('tells the browser not to cache what somebody searched for',async()=>{
  const sink=collect();
  await serveGeocode({url:`${GEOCODE_PATH}?q=x`,method:'GET'},sink.response,async()=>({status:200,body:{query:'x',provider:'nominatim',attribution:'',results:[],cached:false,providers:[]}}));
  expect(sink.headers['Cache-Control']).toBe('no-store');
 });

 it('refuses a non-GET method',async()=>{
  const sink=collect();
  await serveGeocode({url:GEOCODE_PATH,method:'POST'},sink.response,async()=>{throw new Error('handler must not run')});
  expect(sink.response.statusCode).toBe(405);
 });

 it('passes the handler status through',async()=>{
  const sink=collect();
  await serveGeocode({url:GEOCODE_PATH,method:'GET'},sink.response,async()=>({status:400,body:{error:'no query',code:'missing-query',providers:[]}}));
  expect(sink.response.statusCode).toBe(400);
  expect(JSON.parse(sink.body).code).toBe('missing-query');
 });
});
