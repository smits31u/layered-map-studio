import ClipperLib from 'clipper-lib';
import {beforeAll,describe,expect,it,vi} from 'vitest';
import type {MultiPolygonMm} from '../../src/geometry/shoreline/polygonEngine';
import {areaMm2,clip,toPaths} from '../../src/geometry/terrain/nestedBands';
import {pointInRing} from '../../src/geometry/terrain/contourGeometry';
import {FLAT_AREA_RANGE_M,contourElevations,quantileThreshold} from '../../src/topo/terrain/bands';
import {TerrainError} from '../../src/topo/terrain/errors';
import {TileFetchCancelledError,fetchTerrainTiles,type TileFetchLike} from '../../src/topo/terrain/fetchTiles';
import {freezeTerrainView,generateTerrain,terrainTilePlan,type TerrainResult,type TerrainSettings} from '../../src/topo/terrain/pipeline';
import {gaussianKernel,smoothGrid} from '../../src/topo/terrain/smooth';
import {tileKey} from '../../src/topo/terrain/tiles';
import {flattenGeometry,geometryFingerprint,tilesForView} from '../helpers/terrarium';

// Phase 2's pipeline end to end: tiles → mosaic → crop/resample → smoothing → quantile bands with
// water masking → contour centerlines. The exit criterion is "three fixed test locations
// (mountainous, coastal, flat) generate deterministic previews"; the three goldens below are those,
// built from synthetic Terrarium tiles so the elevations are known exactly and no network is needed.

const HEAVY=60_000;

describe('smoothing',()=>{
 it('radius 0 is the identity',()=>{
  const values=Float32Array.from({length:30},(_,i)=>i*i%7);
  const out=smoothGrid(values,6,5,0);
  expect(out).toEqual(values);
  expect(out).not.toBe(values);
 });
 it('uses a normalised, symmetric Gaussian kernel of width 2r+1',()=>{
  for(const r of [1,2,3,6]){
   const k=gaussianKernel(r);
   expect(k).toHaveLength(2*r+1);
   expect(k.reduce((a,b)=>a+b,0)).toBeCloseTo(1,12);
   for(let i=0;i<=r;i++)expect(k[i]).toBe(k[2*r-i]);
   expect(k[r]).toBe(Math.max(...k));
  }
  expect(()=>gaussianKernel(-1)).toThrow(/non-negative/);
 });
 it('leaves flat ground flat, including at the edges',()=>{
  const out=smoothGrid(new Float32Array(40*30).fill(-123.5),40,30,4);
  for(const v of out)expect(v).toBeCloseTo(-123.5,4);
 });
 it('spreads a spike symmetrically and conserves its total away from the edges',()=>{
  const values=new Float32Array(21*21);values[10*21+10]=1000;
  const out=smoothGrid(values,21,21,3);
  expect(out[10*21+10]).toBeLessThan(1000);
  expect(out[10*21+7]).toBeCloseTo(out[10*21+13],4);
  expect(out[7*21+10]).toBeCloseTo(out[13*21+10],4);
  expect(out[7*21+10]).toBeCloseTo(out[10*21+7],4);
  expect(out.reduce((a,b)=>a+b,0)).toBeCloseTo(1000,1);
 });
 it('smooths more with a larger radius',()=>{
  const noise=Float32Array.from({length:50*50},(_,i)=>Math.sin(i*12.9898)*43758.5453%1*20);
  const roughness=(g:Float32Array)=>{let s=0;for(let y=0;y<50;y++)for(let x=1;x<50;x++)s+=Math.abs(g[y*50+x]-g[y*50+x-1]);return s};
  const r0=roughness(noise),r1=roughness(smoothGrid(noise,50,50,1)),r4=roughness(smoothGrid(noise,50,50,4));
  expect(r1).toBeLessThan(r0);
  expect(r4).toBeLessThan(r1);
 });
});

describe('quantile thresholds',()=>{
 const sorted=Float64Array.from({length:100},(_,i)=>i+1);
 it('put exactly the requested share of samples at or above the threshold',()=>{
  for(const p of [.5,.25,.12,.01,.999]){
   const t=quantileThreshold(sorted,p);
   expect(sorted.filter(v=>v>=t).length).toBe(Math.ceil(p*100));
  }
  expect(quantileThreshold(sorted,1)).toBe(1);
  expect(quantileThreshold(sorted,0)).toBe(100);
 });
 it('are monotonic in the coverage',()=>{
  const data=Float64Array.from({length:997},(_,i)=>Math.sin(i*1.7)*300-i%13).sort();
  let previous=-Infinity;
  for(let p=100;p>=1;p--){const t=quantileThreshold(data,p/100);expect(t).toBeGreaterThanOrEqual(previous);previous=t}
 });
 it('refuse an empty sample',()=>{
  expect(()=>quantileThreshold(new Float64Array(),.5)).toThrow(/no land samples/);
 });
});

describe('contour elevations',()=>{
 it('are evenly spaced strictly inside the range',()=>{
  expect(contourElevations(0,90,8)).toEqual([10,20,30,40,50,60,70,80]);
  expect(contourElevations(-30,30,5)).toEqual([-20,-10,0,10,20]);
  expect(contourElevations(5,5,3)).toEqual([]);
 });
});

// ---- Golden fixtures ----

const VIEW=freezeTerrainView([-89.7,44.9],13,480,120,90);
const W=VIEW.widthMm,H=VIEW.heightMm;
const BASE:TerrainSettings={layerCount:4,coveragePercent:[100,50,25,12],contoursEnabled:true,contourCount:8,smoothingRadius:2,gridLongSide:160};

const mountain=(u:number,v:number)=>250+900*Math.exp(-((u-.4)**2+(v-.45)**2)/.03)+500*Math.exp(-((u-.75)**2+(v-.7)**2)/.02)+60*u;
const coast=(u:number,v:number)=>400*(u-.35)+30*Math.sin(6*v)+150*Math.exp(-((u-.15)**2+(v-.5)**2)/.004);
const flat=(u:number,v:number)=>180+4*Math.sin(6*u)+3*Math.cos(5*v);

const circle=(cx:number,cy:number,r:number,n=48)=>{const ring:[number,number][]=[];for(let i=0;i<n;i++){const a=2*Math.PI*i/n;ring.push([cx+r*Math.cos(a),cy+r*Math.sin(a)])}ring.push([ring[0][0],ring[0][1]]);return ring};
// The sea: everything west of 35% of the board (reaching past its edges), with an island left in it.
const SEA:MultiPolygonMm=[[[[-10,-10],[.35*W,-10],[.35*W,H+10],[-10,H+10],[-10,-10]],circle(.15*W,.5*H,7.2).reverse()]];

const fingerprint=(r:TerrainResult)=>{
 const numbers:number[]=[r.elevation.minM,r.elevation.maxM];
 for(const layer of r.layers){numbers.push(layer.thresholdM??-1e300);flattenGeometry(layer.geometry,numbers)}
 for(const level of r.contours){numbers.push(level.elevation);for(const line of level.lines){for(const [x,y] of line)numbers.push(x,y);numbers.push(1e300)}}
 return geometryFingerprint({numbers});
};

// Independent of the pipeline's own assertLevelChain: every vertex of an inner layer lies inside the
// layer below it by even/odd point-in-polygon, a test that shares no code with Clipper.
const insideGeometry=(x:number,y:number,g:MultiPolygonMm)=>g.some(polygon=>pointInRing(x,y,polygon[0])&&!polygon.slice(1).some(hole=>pointInRing(x,y,hole)));
const expectNested=(inner:MultiPolygonMm,outer:MultiPolygonMm)=>{
 for(const polygon of inner)for(const ring of polygon)for(const [x,y] of ring)if(!insideGeometry(x,y,outer))throw new Error(`vertex (${x}, ${y}) is outside the layer below`);
};
const overlapWithWater=(g:MultiPolygonMm,water:MultiPolygonMm)=>g.length?areaMm2(clip(ClipperLib.ClipType.ctIntersection,g,toPaths(water),ClipperLib.PolyFillType.pftEvenOdd,'test','test')):0;
const expectWellFormed=(r:TerrainResult)=>{
 for(const layer of r.layers)for(const polygon of layer.geometry)for(const ring of polygon){
  expect(ring[0]).toEqual(ring[ring.length-1]);
  for(const [x,y] of ring){expect(Number.isFinite(x)&&Number.isFinite(y)).toBe(true);expect(x>=0&&x<=W&&y>=0&&y<=H).toBe(true)}
 }
 for(const level of r.contours)for(const line of level.lines)for(const [x,y] of line){expect(Number.isFinite(x)&&Number.isFinite(y)).toBe(true);expect(x>=0&&x<=W&&y>=0&&y<=H).toBe(true)}
};

describe('golden: mountain',()=>{
 let tiles:Record<string,Uint8Array>,result:TerrainResult;
 beforeAll(()=>{tiles=tilesForView(VIEW,mountain);result=generateTerrain({view:VIEW,tiles,water:[],settings:BASE})},HEAVY);

 it('has four distinct nested bands at increasing thresholds near their coverage targets',()=>{
  expect(result.layers.map(l=>l.index)).toEqual([1,2,3,4]);
  const thresholds=result.layers.slice(1).map(l=>l.thresholdM!);
  expect(thresholds[0]).toBeLessThan(thresholds[1]);
  expect(thresholds[1]).toBeLessThan(thresholds[2]);
  for(const layer of result.layers.slice(1)){
   expect(layer.geometry.length).toBeGreaterThan(0);
   expect(Math.abs(layer.coveragePercent-layer.targetCoveragePercent)).toBeLessThan(2);
  }
  expect(result.layers[0].areaMm2).toBeCloseTo(W*H,6);
  for(let k=1;k<4;k++)expectNested(result.layers[k].geometry,result.layers[k-1].geometry);
  // The two peaks share one massif up to the 25% band; the top 12% separates them into two summits.
  expect(result.layers.map(l=>l.geometry.length)).toEqual([1,1,1,2]);
 },HEAVY);

 it('has contours at eight evenly spaced elevations, clipped to the board',()=>{
  expect(result.contours).toHaveLength(8);
  const step=result.elevation.rangeM/9;
  result.contours.forEach((level,i)=>expect(level.elevation).toBeCloseTo(result.elevation.minM+(i+1)*step,9));
  expect(result.contours.every(level=>level.lines.length>0)).toBe(true);
  expectWellFormed(result);
  expect(result.warnings).toEqual([]);
 },HEAVY);

 it('covers the synthetic relief and is deterministic',()=>{
  expect(result.elevation.minM).toBeGreaterThan(240);
  expect(result.elevation.maxM).toBeGreaterThan(1000);
  expect(result.grid).toMatchObject({columns:162,rows:122,tileZoom:13});
  const again=generateTerrain({view:VIEW,tiles,water:[],settings:BASE});
  expect(fingerprint(again)).toBe(fingerprint(result));
  expect(fingerprint(result)).toBe('613e77169aeb633bb6338217ca0161486045dfac043627bc3f4c460c94964837');
 },HEAVY);
});

describe('golden: coast',()=>{
 let result:TerrainResult;
 beforeAll(()=>{result=generateTerrain({view:VIEW,tiles:tilesForView(VIEW,coast),water:SEA,settings:{...BASE,layerCount:3,contourCount:5}})},HEAVY);

 it('cuts the sea out of every layer and keeps the island',()=>{
  expect(result.layers).toHaveLength(3);
  for(const layer of result.layers)expect(overlapWithWater(layer.geometry,SEA)).toBeLessThan(1e-6);
  for(const level of result.contours)for(const line of level.lines)for(const [x,y] of line.slice(1,-1))expect(insideGeometry(x,y,SEA)).toBe(false);
  // Layer 1 is the mainland plus the island.
  expect(result.layers[0].geometry).toHaveLength(2);
  const island=result.layers[0].geometry.find(p=>p[0].every(([x])=>x<.35*W))!;
  expect(areaMm2([island])).toBeCloseTo(Math.PI*7.2**2,-1);
  expect(result.layers[0].areaMm2).toBeCloseTo(.65*W*H+areaMm2([island]),0);
  for(let k=1;k<3;k++)expectNested(result.layers[k].geometry,result.layers[k-1].geometry);
  expectWellFormed(result);
 },HEAVY);

 it('takes its quantiles and range from the land only, including land below sea level',()=>{
  // The sea floor reaches −140 m at the west edge; it must not pull the range down. The island's
  // shore does dip below 0 m and that land is kept.
  expect(result.elevation.minM).toBeLessThan(0);
  expect(result.elevation.minM).toBeGreaterThan(-100);
  expect(result.layers[1].coveragePercent).toBeGreaterThan(45);
  expect(result.layers[1].coveragePercent).toBeLessThan(55);
  expect(fingerprint(result)).toBe('f9ea442d56c03094c2a98081fa8da0de595d1f2386e16731cf9d087fa9b87e9d');
 },HEAVY);
});

describe('golden: flat',()=>{
 let result:TerrainResult;
 beforeAll(()=>{result=generateTerrain({view:VIEW,tiles:tilesForView(VIEW,flat),water:[],settings:{...BASE,layerCount:1,contourCount:5}})},HEAVY);

 it('warns that the area is very flat and still produces a valid one-layer result',()=>{
  expect(result.elevation.rangeM).toBeLessThan(FLAT_AREA_RANGE_M);
  expect(result.warnings.map(w=>w.code)).toEqual(['flat-area']);
  expect(result.warnings[0].message).toMatch(/Very flat area.*still export/);
  expect(result.layers).toHaveLength(1);
  expect(result.layers[0].areaMm2).toBeCloseTo(W*H,6);
  expect(result.contours).toHaveLength(5);
  expectWellFormed(result);
  expect(fingerprint(result)).toBe('8317eb223a219dd3dcab9b2f9da78f149cd2390d38386a27008082713cf676e3');
 },HEAVY);

 it('stays valid when extra layers are asked of flat ground',()=>{
  const r=generateTerrain({view:VIEW,tiles:tilesForView(VIEW,flat),water:[],settings:BASE});
  expect(r.layers).toHaveLength(4);
  for(let k=1;k<4;k++)expectNested(r.layers[k].geometry,r.layers[k-1].geometry);
  expectWellFormed(r);
 },HEAVY);
});

describe('missing and broken tiles',()=>{
 let tiles:Record<string,Uint8Array>;
 beforeAll(()=>{tiles=tilesForView(VIEW,flat)},HEAVY);

 it('a missing tile is an explicit error naming the tile, never sea level',()=>{
  const plan=terrainTilePlan(VIEW),key=tileKey(plan.tiles[7]);
  const {[key]:_dropped,...incomplete}=tiles;
  let error:unknown;
  try{generateTerrain({view:VIEW,tiles:incomplete,water:[],settings:BASE})}catch(e){error=e}
  expect(error).toBeInstanceOf(TerrainError);
  expect((error as TerrainError).code).toBe('missing-tile');
  expect((error as TerrainError).message).toContain(key);
  expect((error as TerrainError).message).toMatch(/not replaced with sea level/);
 });

 it('an undecodable tile is an explicit error too',()=>{
  const key=tileKey(terrainTilePlan(VIEW).tiles[0]);
  expect(()=>generateTerrain({view:VIEW,tiles:{...tiles,[key]:new TextEncoder().encode('<Error>AccessDenied</Error>')},water:[],settings:BASE})).toThrow(expect.objectContaining({code:'invalid-tile'}));
 });
});

describe('tile download',()=>{
 const plan=terrainTilePlan(VIEW);
 const ok=(key:string)=>({ok:true,status:200,arrayBuffer:async()=>new TextEncoder().encode(key).buffer});

 it('fetches every tile through the proxy with at most six in flight, reporting progress',async()=>{
  let open=0,peak=0;
  const fetchImpl=vi.fn<TileFetchLike>(async url=>{open++;peak=Math.max(peak,open);await new Promise(r=>setTimeout(r,2));open--;return ok(url)});
  const progress:number[]=[];
  const tiles=await fetchTerrainTiles(plan,{fetchImpl,onProgress:done=>progress.push(done)});
  expect(Object.keys(tiles).sort()).toEqual(plan.tiles.map(tileKey).sort());
  expect(fetchImpl.mock.calls.map(c=>c[0])).toContain(`/api/terrain/${tileKey(plan.tiles[0])}.png`);
  expect(peak).toBe(6);
  expect(progress[0]).toBe(0);
  expect(progress[progress.length-1]).toBe(plan.tiles.length);
 });

 it('turns a 404 from the proxy into a missing-tile error and stops the rest',async()=>{
  const missing=tileKey(plan.tiles[3]);
  const fetchImpl=vi.fn<TileFetchLike>(async url=>url.includes(`/${missing}.png`)?{ok:false,status:404,arrayBuffer:async()=>new ArrayBuffer(0),json:async()=>({code:'missing-tile',error:'x'})}:ok(url));
  await expect(fetchTerrainTiles(plan,{fetchImpl,concurrency:1})).rejects.toMatchObject({code:'missing-tile',message:expect.stringContaining(missing)});
  expect(fetchImpl.mock.calls.length).toBe(4);
 });

 it('reports other proxy failures and timeouts as download failures',async()=>{
  await expect(fetchTerrainTiles(plan,{fetchImpl:async()=>({ok:false,status:502,arrayBuffer:async()=>new ArrayBuffer(0),json:async()=>({code:'upstream-failed',error:'upstream returned HTTP 500.'})})})).rejects.toMatchObject({code:'tile-fetch-failed',message:expect.stringContaining('HTTP 502')});
  const hang:TileFetchLike=(_url,init)=>new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('aborted'))));
  await expect(fetchTerrainTiles(plan,{fetchImpl:hang,timeoutMs:10})).rejects.toMatchObject({code:'tile-fetch-failed',message:expect.stringMatching(/did not download within/)});
 });

 it('cancels cleanly through its signal',async()=>{
  const controller=new AbortController();
  const hang:TileFetchLike=(_url,init)=>new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('aborted'))));
  const pending=fetchTerrainTiles(plan,{fetchImpl:hang,signal:controller.signal});
  controller.abort();
  await expect(pending).rejects.toBeInstanceOf(TileFetchCancelledError);
 });
});
