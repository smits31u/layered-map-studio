import {describe,expect,it,vi} from 'vitest';
import {candidateToResult,FallbackGeocoder,GeocodeError,ProxyGeocoder,type GeocoderService} from '../../src/map/geocoding/GeocoderService';
import type {GeocodeCandidate} from '../../src/server/geocode/types';

// Browser-side geocoding is now a client for this app's own `/api/geocode`, so these tests assert
// what the client sends and how it handles the proxy's answers. The provider-specific parsing that
// used to live in the browser moved server-side and is covered by geocodeProxy.test.ts.

const candidate=(over:Partial<GeocodeCandidate>={}):GeocodeCandidate=>({
 id:'nominatim:1',
 label:'Crivitz, Marinette County, Wisconsin',
 coordinates:[-88.004,45.2352],
 boundingBox:[-88.02,45.22,-87.99,45.25],
 provider:'nominatim',
 attribution:'© OpenStreetMap contributors',
 kind:'village',
 ...over,
});

const proxyResponse=(over:Record<string,unknown>={})=>({
 ok:true,
 status:200,
 json:async()=>({query:'Crivitz, WI',provider:'nominatim',attribution:'© OpenStreetMap contributors',results:[candidate()],cached:false,providers:[{id:'nominatim',label:'Nominatim',attribution:'a',note:'n'}],...over}),
} as unknown as Response);

describe('candidateToResult',()=>{
 it('splits the GeoJSON coordinate pair into the lat/lng shape the lake tool consumes',()=>{
  expect(candidateToResult(candidate())).toMatchObject({latitude:45.2352,longitude:-88.004,displayName:expect.stringContaining('Crivitz'),provider:'nominatim',resultType:'village'});
 });
});

describe('ProxyGeocoder',()=>{
 it('calls this app own proxy rather than any public provider',async()=>{
  const fetchImpl=vi.fn().mockResolvedValue(proxyResponse());
  await new ProxyGeocoder(undefined,'/api/geocode',fetchImpl as unknown as typeof fetch).search('Crivitz, WI');
  const url=String(fetchImpl.mock.calls[0][0]);
  expect(url.startsWith('/api/geocode?')).toBe(true);
  expect(url).toContain('q=Crivitz%2C%20WI');
  expect(url).not.toMatch(/https?:\/\//);
 });

 it('passes an explicitly chosen provider through and omits it otherwise',async()=>{
  const fetchImpl=vi.fn().mockResolvedValue(proxyResponse());
  await new ProxyGeocoder('photon','/api/geocode',fetchImpl as unknown as typeof fetch).search('x');
  expect(String(fetchImpl.mock.calls[0][0])).toContain('provider=photon');
  const plain=vi.fn().mockResolvedValue(proxyResponse());
  await new ProxyGeocoder(undefined,'/api/geocode',plain as unknown as typeof fetch).search('x');
  expect(String(plain.mock.calls[0][0])).not.toContain('provider=');
 });

 it('returns the proxy attribution and provider list alongside the candidates',async()=>{
  const fetchImpl=vi.fn().mockResolvedValue(proxyResponse({cached:true}));
  const detailed=await new ProxyGeocoder(undefined,'/api/geocode',fetchImpl as unknown as typeof fetch).searchDetailed('Crivitz, WI');
  expect(detailed.attribution).toMatch(/OpenStreetMap/);
  expect(detailed.cached).toBe(true);
  expect(detailed.providers.map(p=>p.id)).toEqual(['nominatim']);
 });

 it('surfaces the proxy error message and code rather than a generic failure',async()=>{
  const fetchImpl=vi.fn().mockResolvedValue({ok:false,status:504,json:async()=>({error:'Nominatim did not respond within 8000ms.',code:'upstream-timeout'})} as unknown as Response);
  await expect(new ProxyGeocoder(undefined,'/api/geocode',fetchImpl as unknown as typeof fetch).search('x'))
   .rejects.toMatchObject({code:'upstream-timeout',message:/did not respond/});
 });

 it('explains that the proxy itself is missing when the request cannot be made at all',async()=>{
  const fetchImpl=vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
  const error=await new ProxyGeocoder(undefined,'/api/geocode',fetchImpl as unknown as typeof fetch).search('x').catch(e=>e as GeocodeError);
  expect(error).toBeInstanceOf(GeocodeError);
  expect((error as GeocodeError).code).toBe('proxy-unreachable');
 });

 it('re-throws an abort instead of relabelling it as a proxy outage',async()=>{
  const fetchImpl=vi.fn().mockRejectedValue(Object.assign(new Error('aborted'),{name:'AbortError'}));
  await expect(new ProxyGeocoder(undefined,'/api/geocode',fetchImpl as unknown as typeof fetch).search('x')).rejects.toMatchObject({name:'AbortError'});
 });
});

// The lake map tool's marker lookup has always advanced to a second provider when the first one
// outright fails or finds nothing at all. That is preserved unchanged; what changed is that each
// hop now goes through the proxy. It still never advances on a merely ambiguous result, which is
// the behaviour the ornament plan forbids.
describe('FallbackGeocoder',()=>{
 const okResult=[{id:'1',displayName:'ok',latitude:1,longitude:2,provider:'test'}];
 const failing:GeocoderService={search:async()=>{throw new Error('primary down')}};
 const empty:GeocoderService={search:async()=>[]};
 const succeeding:GeocoderService={search:async()=>okResult};

 it('returns the primary provider result when it succeeds with matches',async()=>{
  expect(await new FallbackGeocoder([succeeding,failing]).search('x')).toEqual(okResult);
 });

 it('falls back to the next provider when the primary throws',async()=>{
  expect(await new FallbackGeocoder([failing,succeeding]).search('x')).toEqual(okResult);
 });

 it('falls back to the next provider when the primary returns zero results',async()=>{
  expect(await new FallbackGeocoder([empty,succeeding]).search('x')).toEqual(okResult);
 });

 it('surfaces the last error when every provider fails',async()=>{
  await expect(new FallbackGeocoder([failing,failing]).search('x')).rejects.toThrow('primary down');
 });

 it('returns an empty array (not-found, not an error) when every provider genuinely finds nothing',async()=>{
  expect(await new FallbackGeocoder([empty,empty]).search('x')).toEqual([]);
 });

 it('stops immediately on abort instead of trying the next provider',async()=>{
  const aborting:GeocoderService={search:async()=>{throw Object.assign(new Error('aborted'),{name:'AbortError'})}};
  let reached=false;
  const after:GeocoderService={search:async()=>{reached=true;return okResult}};
  await expect(new FallbackGeocoder([aborting,after]).search('x')).rejects.toMatchObject({name:'AbortError'});
  expect(reached).toBe(false);
 });
});
