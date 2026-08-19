import {afterEach,describe,expect,it,vi} from 'vitest';
import {FallbackGeocoder,NominatimGeocoder,PhotonGeocoder,type GeocoderService} from '../../src/map/geocoding/GeocoderService';

const jsonResponse=(body:unknown,ok=true,status=200)=>({ok,status,json:async()=>body}) as Response;

afterEach(()=>{vi.unstubAllGlobals()});

describe('PhotonGeocoder',()=>{
 it('maps Photon features into GeocoderResult',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(jsonResponse({features:[{id:'1',properties:{osm_id:42,name:'Crivitz',state:'Wisconsin',country:'USA'},geometry:{coordinates:[-88.2,45.25]},bbox:[-88.3,45.2,-88.1,45.3]}]})));
  const results=await new PhotonGeocoder().search('Crivitz, WI');
  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({latitude:45.25,longitude:-88.2,provider:'Photon'});
 });

 it('throws a clear error on a non-OK HTTP response',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(jsonResponse({},false,500)));
  await expect(new PhotonGeocoder().search('x')).rejects.toThrow(/HTTP 500/);
 });

 it('throws a clear timeout error on abort',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockRejectedValue(Object.assign(new Error('aborted'),{name:'AbortError'})));
  await expect(new PhotonGeocoder().search('x')).rejects.toThrow(/timed out/);
 });
});

describe('NominatimGeocoder',()=>{
 it('maps Nominatim results into GeocoderResult',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(jsonResponse([{place_id:99,display_name:'123 Lakeview Rd, Crivitz, WI 54114',lat:'45.25',lon:'-88.2',boundingbox:['45.2','45.3','-88.3','-88.1'],type:'house'}])));
  const results=await new NominatimGeocoder().search('123 Lakeview Rd, Crivitz WI');
  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({latitude:45.25,longitude:-88.2,provider:'Nominatim',displayName:'123 Lakeview Rd, Crivitz, WI 54114'});
 });

 it('rejects a malformed (non-array) response instead of silently returning garbage',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(jsonResponse({error:'nope'})));
  await expect(new NominatimGeocoder().search('x')).rejects.toThrow();
 });
});

describe('FallbackGeocoder',()=>{
 const okResult=[{id:'1',displayName:'ok',latitude:1,longitude:2,provider:'test'}];
 const failing:GeocoderService={search:async()=>{throw new Error('primary down')}};
 const empty:GeocoderService={search:async()=>[]};
 const succeeding:GeocoderService={search:async()=>okResult};

 it('returns the primary provider result when it succeeds with matches',async()=>{
  const results=await new FallbackGeocoder([succeeding,failing]).search('x');
  expect(results).toEqual(okResult);
 });

 it('falls back to the next provider when the primary throws',async()=>{
  const results=await new FallbackGeocoder([failing,succeeding]).search('x');
  expect(results).toEqual(okResult);
 });

 it('falls back to the next provider when the primary returns zero results',async()=>{
  const results=await new FallbackGeocoder([empty,succeeding]).search('x');
  expect(results).toEqual(okResult);
 });

 it('surfaces the last error when every provider fails',async()=>{
  await expect(new FallbackGeocoder([failing,failing]).search('x')).rejects.toThrow('primary down');
 });

 it('returns an empty array (not-found, not an error) when every provider genuinely finds nothing',async()=>{
  const results=await new FallbackGeocoder([empty,empty]).search('x');
  expect(results).toEqual([]);
 });
});
