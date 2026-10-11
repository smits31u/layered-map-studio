import {describe,expect,it,vi} from 'vitest';
import {MichiganDnrProvider,MICHIGAN_DNR_ATTRIBUTION,StateRoutedProvider,WisconsinDnrProvider,contourRegions} from '../../src/bathymetry/providers';
import type {BathymetryProvider,GeoMultiPolygon} from '../../src/bathymetry/model';
import {multiPolygonAreaM2,interiorPoint,type Ring} from '../../src/bathymetry/geo';
import {statesForWater} from '../../src/bathymetry/states';
import {buildScene} from '../../src/export/buildScene';
import {caldronFallsFeatures,caldronFallsProject} from '../fixtures/caldronFalls';
import recorded from '../fixtures/michiganDnr/dickinsonCounty.json';

// The real Michigan DNR answer for the Hamilton/Mary/Louise Lake crop in Waucedah Twp, Dickinson
// Co. (see the fixture's note). The 0 ft contour of each lake stands in for its captured shoreline.
type RecordedContour={attributes:{NewKey:string;Name:string;MinDepth:number};geometry:{paths:[number,number][][]}};
const contours=recorded.contours as RecordedContour[];
const shoreline=(key:string):GeoMultiPolygon=>[[contours.find(f=>f.attributes.NewKey===key&&f.attributes.MinDepth===0)!.geometry.paths[0]]];
const hamilton=shoreline('22-15'),mary=shoreline('22-14');
const ft=(meters:number)=>+(meters/0.3048).toFixed(3);
const ok=(json:unknown)=>({ok:true,json:async()=>json});

// Serves layer 0 (deep points) and layer 1 (contours) from the recording, like the FeatureServer.
function arcgis(features:{deepPoints?:unknown[];contours?:unknown[]}={},pageSize=Infinity){
 return vi.fn(async(input:string)=>{
  const url=new URL(input),layer=url.pathname.match(/FeatureServer\/(\d)\/query$/)![1],all=(layer==='0'?features.deepPoints??recorded.deepPoints:features.contours??contours) as unknown[],offset=Number(url.searchParams.get('resultOffset')??0),page=all.slice(offset,offset+pageSize);
  return ok({features:page,exceededTransferLimit:offset+pageSize<all.length});
 });
}

describe('Wisconsin DNR: WBIC 0, null or missing is no match',()=>{
 for(const [label,wbic] of [['0',0],['"0"','0'],['null',null],['missing',undefined]] as const){
  it(`treats WBIC ${label} as no match, never "Waterbody found"`,async()=>{
   const attributes:Record<string,unknown>={WATERBODY_NAME:'Hamilton Lake'};
   if(wbic!==undefined)attributes.WATERBODY_WBIC=wbic;
   const fetcher=vi.fn().mockResolvedValue(ok({features:[{attributes}]})),result=await new WisconsinDnrProvider(fetcher as any).resolve({longitude:-87.785,latitude:45.755,waterbodyName:'Hamilton Lake'});
   expect(result.status).toBe('unavailable');
   expect(result.waterbodyId).toBeUndefined();
   expect(result.message).not.toMatch(/identifies|WBIC/);
  });
 }
 it('skips a WBIC 0 record and reports the real waterbody beside it',async()=>{
  const fetcher=vi.fn().mockResolvedValue(ok({features:[{attributes:{WATERBODY_NAME:'Caldron Falls Flowage',WATERBODY_WBIC:0}},{attributes:{WATERBODY_NAME:'Caldron Falls Reservoir',WATERBODY_WBIC:545400}}]})),result=await new WisconsinDnrProvider(fetcher as any).resolve({longitude:-88.23,latitude:45.35,waterbodyName:'Caldron Falls'});
  expect(result).toMatchObject({status:'unsupported',waterbodyId:'545400'});
 });
});

describe('state routing',()=>{
 const stub=(id:string)=>({id,label:id,resolve:vi.fn().mockResolvedValue({provider:id,status:'unsupported',message:id})}) satisfies BathymetryProvider;
 const caldron:GeoMultiPolygon=[[caldronFallsFeatures.water[0].rings[0].map(p=>[p.lng,p.lat] as [number,number])]];

 it('places the test lakes in the right state from the selected water polygon',async()=>{
  expect(await statesForWater(hamilton,interiorPoint(hamilton))).toEqual(['MI']);
  expect(await statesForWater(caldron,interiorPoint(caldron))).toEqual(['WI']);
 });

 it('never asks Wisconsin DNR about an out-of-state (Michigan) lake',async()=>{
  const WI=stub('wisconsin-dnr'),MI=stub('michigan-dnr'),[longitude,latitude]=interiorPoint(hamilton);
  const result=await new StateRoutedProvider({WI,MI}).resolve({longitude,latitude,water:hamilton,waterbodyName:'Hamilton Lake'});
  expect(WI.resolve).not.toHaveBeenCalled();
  expect(MI.resolve).toHaveBeenCalledOnce();
  expect(result.provider).toBe('michigan-dnr');
 });

 it('asks only Wisconsin DNR about a Wisconsin lake',async()=>{
  const WI=stub('wisconsin-dnr'),MI=stub('michigan-dnr'),[longitude,latitude]=interiorPoint(caldron);
  await new StateRoutedProvider({WI,MI}).resolve({longitude,latitude,water:caldron});
  expect(WI.resolve).toHaveBeenCalledOnce();
  expect(MI.resolve).not.toHaveBeenCalled();
 });

 it('answers "no measured source for this state" outside Wisconsin and Michigan instead of a fake match',async()=>{
  const WI=stub('wisconsin-dnr'),MI=stub('michigan-dnr'),illinois:GeoMultiPolygon=[[[[-88.1,42.2],[-88.09,42.2],[-88.09,42.21],[-88.1,42.21],[-88.1,42.2]]]];
  const result=await new StateRoutedProvider({WI,MI}).resolve({longitude:-88.095,latitude:42.205,water:illinois});
  expect(WI.resolve).not.toHaveBeenCalled();
  expect(MI.resolve).not.toHaveBeenCalled();
  expect(result).toMatchObject({provider:'none',status:'unavailable'});
  expect(result.message).toContain('No measured depth source for this state');
 });
});

describe('Michigan DNR adapter',()=>{
 const query=(water:GeoMultiPolygon)=>{const[longitude,latitude]=interiorPoint(water);return{longitude,latitude,water}};

 it('loads Hamilton Lake 22-15 as nested depth regions in feet with Michigan DNR / IFR provenance',async()=>{
  const result=await new MichiganDnrProvider(arcgis() as any,new Map()).resolve(query(hamilton));
  expect(result).toMatchObject({provider:'michigan-dnr',status:'available',waterbodyId:'22-15'});
  const dataset=result.dataset!;
  // 0 ft is the shoreline; the 12/26/27/31 ft rings are 2–5 m² spot soundings, not regions.
  expect(dataset.contours.map(c=>ft(c.depthMeters))).toEqual([5,10,15,25,30]);
  expect(dataset.source).toMatchObject({provider:'michigan-dnr',datasetId:'michigan-dnr:22-15',attribution:MICHIGAN_DNR_ATTRIBUTION,license:expect.stringContaining('public record'),notForNavigation:true});
  expect(dataset.source.title).toContain('Hamilton Lake (22-15, Dickinson Co.)');
  expect(result.message).toContain('max 31 ft');
  const areas=dataset.contours.map(c=>multiPolygonAreaM2(c.geometry.map(p=>p.rings.map(r=>r.map(q=>[q.lng,q.lat] as [number,number])))));
  for(let i=1;i<areas.length;i++)expect(areas[i]).toBeLessThan(areas[i-1]);
 });

 it('matches lakes by location, not by name',async()=>{
  // Every contour in the area renamed "Hamilton Lake": Mary Lake's water must still get Mary's survey.
  const renamed=contours.map(f=>({...f,attributes:{...f.attributes,Name:'Hamilton Lake'}})),deepPoints=recorded.deepPoints.map(f=>({...f,attributes:{...f.attributes,LakeName:'Hamilton Lake'}}));
  const result=await new MichiganDnrProvider(arcgis({contours:renamed,deepPoints}) as any,new Map()).resolve(query(mary));
  expect(result.waterbodyId).toBe('22-14');
  expect(result.dataset!.contours.map(c=>ft(c.depthMeters))).toEqual([5,10,20,30,40,50,60,70,80]);
 });

 it('reports no match for water with no survey rather than borrowing a neighbour',async()=>{
  const pond:GeoMultiPolygon=[[[[-87.835,45.738],[-87.834,45.738],[-87.834,45.739],[-87.835,45.739],[-87.835,45.738]]]];
  const result=await new MichiganDnrProvider(arcgis() as any,new Map()).resolve(query(pond));
  expect(result.status).toBe('unavailable');
  expect(result.dataset).toBeUndefined();
 });

 it('requests outSR=4326 and pages past maxRecordCount',async()=>{
  // Enough copies of the recording to need a second 2000-record page; duplicates collapse.
  const many=Array.from({length:Math.ceil(2100/contours.length)},()=>contours).flat(),paged=arcgis({contours:many},2000);
  const result=await new MichiganDnrProvider(paged as any,new Map()).resolve(query(hamilton));
  const contourUrls=paged.mock.calls.map(([u])=>new URL(u)).filter(u=>u.pathname.endsWith('/1/query'));
  expect(contourUrls.map(u=>u.searchParams.get('resultOffset'))).toEqual(['0','2000']);
  expect(contourUrls.every(u=>u.searchParams.get('outSR')==='4326'&&u.searchParams.get('inSR')==='4326')).toBe(true);
  expect(result.dataset!.contours.map(c=>ft(c.depthMeters))).toEqual([5,10,15,25,30]);
 });

 it('caches service responses across provider instances',async()=>{
  const fetcher=arcgis(),cache=new Map();
  await new MichiganDnrProvider(fetcher as any,cache).resolve(query(hamilton));
  const calls=fetcher.mock.calls.length;
  await new MichiganDnrProvider(fetcher as any,cache).resolve(query(hamilton));
  expect(calls).toBe(2);
  expect(fetcher).toHaveBeenCalledTimes(2);
 });

 it('feeds the existing depth-region path: panels clipped to the shoreline, nested, attributed',async()=>{
  const dataset=(await new MichiganDnrProvider(arcgis() as any,new Map()).resolve(query(hamilton))).dataset!;
  const ring=hamilton[0][0],lngs=ring.map(p=>p[0]),lats=ring.map(p=>p[1]),pad=.004,[w,s,e,n]=[Math.min(...lngs)-pad,Math.min(...lats)-pad,Math.max(...lngs)+pad,Math.max(...lats)+pad],[lng,lat]=interiorPoint(hamilton);
  const project={...caldronFallsProject,map:{...caldronFallsProject.map,longitude:lng,latitude:lat,crop:{nw:{lng:w,lat:n},ne:{lng:e,lat:n},se:{lng:e,lat:s},sw:{lng:w,lat:s},bbox:[w,s,e,n] as [number,number,number,number]}},bathymetry:{mode:'true-bathymetry' as const,provider:'michigan-dnr' as const,datasetId:dataset.source.datasetId,status:'available' as const,selection:'automatic' as const,thresholdsMeters:[],dataset}};
  const scene=buildScene(project,{water:[{id:'hamilton',rings:[ring.map(([lng,lat])=>({lng,lat}))]}],roads:[],places:[]}),areas=scene.geometryMetrics!.openingAreasMm2;
  expect(scene.layers.slice(1,4).map(layer=>ft(layer.depthMeters!))).toEqual([5,15,30]);
  for(let i=1;i<4;i++)expect(areas[i]).toBeLessThan(areas[i-1]);
  expect(scene.bathymetrySource?.attribution).toBe(MICHIGAN_DNR_ATTRIBUTION);
 });
});

describe('contour lines to depth regions',()=>{
 const square=(x:number,y:number,size:number):Ring=>[[x,y],[x+size,y],[x+size,y+size],[x,y+size],[x,y]];
 it('nests every level inside the shallower one and treats a same-depth ring inside another as a hump',()=>{
  const regions=contourRegions([{depthFt:5,ring:square(0,0,1)},{depthFt:5,ring:square(.1,.1,.2)},{depthFt:10,ring:square(.5,.5,.3)},{depthFt:15,ring:square(.6,.6,.1)}]);
  expect(regions.map(r=>r.depthFt)).toEqual([5,10,15]);
  const area=(g:GeoMultiPolygon)=>g.reduce((sum,p)=>sum+Math.abs(p[0].slice(0,-1).reduce((a,q,i)=>a+q[0]*p[0][i+1][1]-p[0][i+1][0]*q[1],0)/2)-p.slice(1).reduce((h,r)=>h+Math.abs(r.slice(0,-1).reduce((a,q,i)=>a+q[0]*r[i+1][1]-r[i+1][0]*q[1],0)/2),0),0);
  expect(area(regions[0].geometry)).toBeCloseTo(1-.04);
  expect(area(regions[1].geometry)).toBeCloseTo(.09);
  expect(area(regions[2].geometry)).toBeCloseTo(.01);
 });
 it('keeps a deeper basin inside the shallower region even when its basin skips that contour',()=>{
  // Hamilton Lake: the main basin steps 5 → 15 ft with no 10 ft line; the west basin has one.
  const regions=contourRegions([{depthFt:5,ring:square(0,0,1)},{depthFt:5,ring:square(2,0,1)},{depthFt:10,ring:square(2.2,.2,.5)},{depthFt:15,ring:square(.2,.2,.5)}]);
  const ten=regions.find(r=>r.depthFt===10)!.geometry;
  expect(ten).toHaveLength(2);
 });
});
