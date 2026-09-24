import {createHash} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import {buildWaterModel,type MultiPolygonMm,type RingMm} from '../../src/geometry/shoreline/polygonEngine';
import {CropProjection} from '../../src/geometry/projection/cropProjection';
import {generateDepthTerrain,noiseContrast,type DepthTerrain} from '../../src/geometry/terrain/depthTerrain';
import {DEFAULT_TERRAIN_PARAMS,expandSimpleControls,normalizeTerrainParams,TERRAIN_PROFILE_NAMES,type TerrainParamsInput} from '../../src/geometry/terrain/terrainParams';
import {cellCenterX,cellCenterY} from '../../src/geometry/terrain/terrainRaster';
import {caldronFixture,noquebayFixture} from '../fixtures/regressionFixtures';

// End-to-end properties of the depth-terrain pipeline. This grid is going to be contoured into
// cut layers, so the invariants are held to the same standard as cut geometry: exact where exact
// is achievable (determinism, normalization targets), bounded everywhere else, and no non-finite
// value under any input the parameter type admits.

const rect=(x0:number,y0:number,x1:number,y1:number):RingMm=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]];
function lcg(seed:number){let s=seed>>>0;return ()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296}}
function star(cx:number,cy:number,spikes:number,inner:number,outer:number,seed:number):RingMm{
 const rand=lcg(seed),ring:RingMm=[];
 for(let k=0;k<spikes*2;k++){const angle=k*Math.PI/spikes,r=(k%2?inner:outer)*(.75+.5*rand());ring.push([cx+r*Math.cos(angle),cy+r*Math.sin(angle)])}
 ring.push([...ring[0]] as [number,number]);
 return ring;
}
const bytes=(array:Float64Array|Int32Array|Uint8Array)=>new Uint8Array(array.buffer,array.byteOffset,array.byteLength);
const sha256=(array:Float64Array|Int32Array|Uint8Array)=>createHash('sha256').update(bytes(array)).digest('hex');
const deepFreeze=<T>(value:T):T=>{if(value&&typeof value==='object'){for(const v of Object.values(value))deepFreeze(v);Object.freeze(value)}return value};

// A lake with an island, a separate bay, and a small pond: holes, a MultiPolygon, three bodies.
const lake:MultiPolygonMm=[
 [star(60,50,19,28,44,1),star(55,48,7,4,8,2)],
 [star(140,40,11,9,16,3)],
 [rect(120,85,128,92)],
];
const everythingOn:TerrainParamsInput={seed:424242,profile:'stepped-benches',maxDepth:.8,bankSteepness:.7,shelfWidth:.2,terraceStrength:.6,terraceLevels:5,noiseAmplitude:.6,featureScale:.18,octaves:6,roughness:.55,ridged:.5,warpStrength:1.2,grainAngleDeg:35,grainStrength:.6,bodyScaleExponent:.5,resolution:{cellMm:.75}};

function assertTerrainInvariants(terrain:DepthTerrain,label:string){
 const {depth,inside,bodyId,distanceCells,bodies,params}=terrain;
 const max=new Float64Array(bodies.length);
 for(let i=0;i<depth.length;i++){
  const d=depth[i];
  if(!Number.isFinite(d)||!Number.isFinite(distanceCells[i]))throw new Error(`${label}: non-finite value at cell ${i}`);
  if(!inside[i]){if(d!==0||bodyId[i]!==-1)throw new Error(`${label}: outside cell ${i} has depth ${d} / body ${bodyId[i]}`);continue}
  const body=bodies[bodyId[i]];
  // Size threshold: a body at or above it is strictly deeper than 0 in every cell; a body below it
  // is exactly 0 in every cell — checked, not skipped.
  if(body.cellCount<params.minBodyCells){
   if(!body.dropped||!Object.is(d,0))throw new Error(`${label}: cell ${i} of below-threshold body ${body.id} (${body.cellCount} cells) has depth ${d}, dropped=${body.dropped}`);
   continue;
  }
  if(body.dropped)throw new Error(`${label}: body ${body.id} (${body.cellCount} cells) dropped at threshold ${params.minBodyCells}`);
  if(!(d>0))throw new Error(`${label}: inside cell ${i} has non-positive depth ${d}`);
  if(d>body.targetDepth)throw new Error(`${label}: cell ${i} depth ${d} exceeds body target ${body.targetDepth}`);
  if(d>max[body.id])max[body.id]=d;
 }
 const kept=bodies.filter(body=>!body.dropped);
 for(const body of bodies){
  if(body.dropped){expect(body.areaScale).toBe(0);expect(body.targetDepth).toBe(0);continue}
  expect(Number.isFinite(body.areaScale)&&body.areaScale>0&&body.areaScale<=1,`${label}: areaScale ${body.areaScale}`).toBe(true);
  expect(max[body.id],`${label}: body ${body.id} max`).toBe(body.targetDepth);
 }
 if(kept.length)expect(Math.max(...kept.map(body=>body.targetDepth)),`${label}: deepest target`).toBe(params.maxDepth);
 else if(bodies.length)expect(terrain.warnings.join(' '),`${label}: all-dropped warning`).toContain('smaller than minBodyCells');
}

describe('depth terrain determinism',()=>{
 it('produces byte-identical grids for identical inputs, with no state carried between calls',()=>{
  const runs:DepthTerrain[]=[];
  for(let k=0;k<3;k++){
   runs.push(generateDepthTerrain(lake,everythingOn));
   generateDepthTerrain([[star(10,10,5,3,8,99)]],{seed:k,noiseAmplitude:1,warpStrength:2});
  }
  for(const run of runs.slice(1)){
   expect(bytes(run.depth)).toEqual(bytes(runs[0].depth));
   expect(bytes(run.distanceCells)).toEqual(bytes(runs[0].distanceCells));
   expect(bytes(run.bodyId)).toEqual(bytes(runs[0].bodyId));
   expect(run.inside).toEqual(runs[0].inside);
   expect(run.bodies).toEqual(runs[0].bodies);
   expect(run.grid).toEqual(runs[0].grid);
  }
 });

 it('does not mutate its inputs',()=>{
  const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;
  const shoreline=deepFreeze(clone(lake)),params=deepFreeze(clone(everythingOn));
  expect(()=>generateDepthTerrain(shoreline,params)).not.toThrow();
  expect(shoreline).toEqual(lake);expect(params).toEqual(everythingOn);
 });

 it('matches a pinned fingerprint, so any change to the generated terrain is deliberate',()=>{
  // If this fails after an intentional change to the algorithm or its constants, re-pin it and say
  // so in the commit: a terrain that differs for the same seed is a different product.
  const terrain=generateDepthTerrain(lake,everythingOn);
  expect(terrain.grid).toMatchObject({columns:194,rows:128,cellMm:.75});
  expect(terrain.bodies.map(body=>body.cellCount)).toEqual(PINNED.cellCounts);
  expect(terrain.bodies.map(body=>body.dropped)).toEqual([true,false,false,false]);
  expect(sha256(terrain.depth)).toBe(PINNED.depthSha256);
 });

 it('differs from the pre-threshold fingerprint only by the dropped fragment',()=>{
  // With nothing dropped the output is byte-identical to the fingerprint pinned before dropping
  // existed, and the default differs from it in exactly the dropped body's one cell.
  const keepAll=generateDepthTerrain(lake,{...everythingOn,minBodyCells:1}),terrain=generateDepthTerrain(lake,everythingOn);
  expect(sha256(keepAll.depth)).toBe(PINNED.keepAllDepthSha256);
  const changed=[...terrain.depth.keys()].filter(i=>terrain.depth[i]!==keepAll.depth[i]);
  expect(changed).toHaveLength(1);
  expect(terrain.bodyId[changed[0]]).toBe(0);
  expect(terrain.depth[changed[0]]).toBe(0);
 });

 it('gives the same terrain for the same lake at another product size (scaled cell size)',()=>{
  const scaled:MultiPolygonMm=lake.map(polygon=>polygon.map(ring=>ring.map(([x,y])=>[x*2,y*2] as [number,number])));
  const a=generateDepthTerrain(lake,everythingOn),b=generateDepthTerrain(scaled,{...everythingOn,resolution:{cellMm:1.5}});
  expect(bytes(b.depth)).toEqual(bytes(a.depth));
 });
});

describe('seed isolation',()=>{
 it('changes the terrain and nothing else when only the seed changes',()=>{
  const a=generateDepthTerrain(lake,everythingOn),b=generateDepthTerrain(lake,{...everythingOn,seed:everythingOn.seed!+1});
  expect(b.grid).toEqual(a.grid);
  expect(b.inside).toEqual(a.inside);
  expect(bytes(b.bodyId)).toEqual(bytes(a.bodyId));
  expect(bytes(b.distanceCells)).toEqual(bytes(a.distanceCells));
  expect(b.bodies).toEqual(a.bodies);
  expect({...b.params,seed:0}).toEqual({...a.params,seed:0});
  let differing=0,insideCells=0;
  for(let i=0;i<a.depth.length;i++){if(!a.inside[i])continue;insideCells++;if(a.depth[i]!==b.depth[i])differing++}
  expect(differing/insideCells).toBeGreaterThan(.5);
 });

 it('passes noise through a contrast curve that is odd, monotonic and strictly inside ±0.5',()=>{
  // The dry-spot guarantee (t' > t/2) rests on this bound, so it is checked over the whole input
  // range the sampler can produce, endpoints included.
  expect(noiseContrast(.5)).toBe(0);
  expect(noiseContrast(0)).toBeGreaterThan(-.5);expect(noiseContrast(1)).toBeLessThan(.5);
  let previous=-Infinity;
  for(let k=0;k<=10000;k++){const n=k/10000,z=noiseContrast(n);expect(z).toBeGreaterThan(previous);expect(Math.abs(z)).toBeLessThan(.5);expect(noiseContrast(1-n)).toBeCloseTo(-z,15);previous=z}
  expect((noiseContrast(.5+1e-7)-noiseContrast(.5))/1e-7).toBeCloseTo(3,4);
 });

 it('has no effect at all when noise is off',()=>{
  const off={...everythingOn,noiseAmplitude:0};
  expect(bytes(generateDepthTerrain(lake,{...off,seed:9}).depth)).toEqual(bytes(generateDepthTerrain(lake,{...off,seed:10}).depth));
 });

 it('without noise depth is a function of shore distance alone (concentric), with noise it is not',()=>{
  // Measured on the largest body: the star's spike tips can rasterize as separate one-cell bodies.
  const spread=(terrain:DepthTerrain)=>{
   const byDistance=new Map<string,number[]>(),main=terrain.bodies.find(body=>body.areaScale===1)!.id;
   for(let i=0;i<terrain.depth.length;i++)if(terrain.bodyId[i]===main){const key=terrain.distanceCells[i].toFixed(9);byDistance.set(key,[...(byDistance.get(key)??[]),terrain.depth[i]])}
   let worst=0;for(const values of byDistance.values())worst=Math.max(worst,Math.max(...values)-Math.min(...values));
   return worst;
  };
  const params={...everythingOn,terraceStrength:0};
  // Not exactly 0: chamfer sums reached in different orders (1+√2 vs √2+1) can differ by an ulp
  // while sharing the rounded key.
  expect(spread(generateDepthTerrain(lake,{...params,noiseAmplitude:0}))).toBeLessThan(1e-12);
  expect(spread(generateDepthTerrain(lake,params))).toBeGreaterThan(.1);
 });
});

describe('water bodies and normalization',()=>{
 const big=rect(20,0,40,20),small=rect(0,0,10,10);
 const flat:TerrainParamsInput={noiseAmplitude:0,profile:'even-slope',shelfWidth:0,bankSteepness:.5,terraceStrength:0,resolution:{cellMm:1,minCellsLongSide:8}};

 it('scales a smaller body by its area ratio to the power of the exponent',()=>{
  // Row-major labelling reaches the small square's first cell (x=0) before the big one's (x=20).
  const terrain=generateDepthTerrain([[big],[small]],{...flat,maxDepth:.9});
  expect(terrain.bodies.map(body=>body.cellCount)).toEqual([100,400]);
  expect(terrain.bodies[1]).toMatchObject({areaScale:1,targetDepth:.9,areaMm2:400,maxDistanceMm:10});
  expect(terrain.bodies[0].areaScale).toBeCloseTo(.5,15);
  expect(terrain.bodies[0].targetDepth).toBeCloseTo(.45,15);
  assertTerrainInvariants(terrain,'two squares');
  const flatExponent=generateDepthTerrain([[big],[small]],{...flat,bodyScaleExponent:0});
  expect(flatExponent.bodies.map(body=>body.targetDepth)).toEqual([1,1]);
  const steep=generateDepthTerrain([[big],[small]],{...flat,bodyScaleExponent:1});
  expect(steep.bodies[0].targetDepth).toBeCloseTo(.25,15);
 });

 it('treats equal bodies equally',()=>{
  const terrain=generateDepthTerrain([[rect(0,0,10,10)],[rect(20,0,30,10)]],flat);
  expect(terrain.bodies.map(body=>body.targetDepth)).toEqual([1,1]);
 });

 it('shapes each body independently: a body\'s relative profile does not depend on its neighbours',()=>{
  const alone=generateDepthTerrain([[small]],flat),together=generateDepthTerrain([[small],[big]],flat);
  const target=together.bodies[together.bodyId[together.grid.columns+1]].targetDepth;
  for(let row=0;row<alone.grid.rows;row++)for(let column=0;column<alone.grid.columns;column++){
   const i=row*alone.grid.columns+column;
   if(!alone.inside[i])continue;
   // Both grids start at the same origin with the same cell size, so cell (column,row) is the
   // same physical cell in both.
   expect(cellCenterX(together.grid,column)).toBe(cellCenterX(alone.grid,column));
   expect(cellCenterY(together.grid,row)).toBe(cellCenterY(alone.grid,row));
   const j=row*together.grid.columns+column;
   expect(together.depth[j]/target).toBeCloseTo(alone.depth[i],12);
  }
 });

 it('keeps a lake with an island as one body and leaves the island dry',()=>{
  const terrain=generateDepthTerrain([[rect(0,0,30,30),rect(10,10,20,20)]],flat);
  expect(terrain.bodies).toHaveLength(1);
  const {grid}=terrain,islandCell=Math.floor((15-grid.originYMm)/grid.cellMm)*grid.columns+Math.floor((15-grid.originXMm)/grid.cellMm);
  expect(terrain.inside[islandCell]).toBe(0);expect(terrain.depth[islandCell]).toBe(0);
  assertTerrainInvariants(terrain,'island');
 });

 it('hits the requested max depth exactly, per body, for every profile and max depth',()=>{
  for(const profile of TERRAIN_PROFILE_NAMES)for(const maxDepth of [.01,.25,.6,1]){
   assertTerrainInvariants(generateDepthTerrain(lake,{...everythingOn,profile,maxDepth}),`${profile} @ ${maxDepth}`);
  }
 });

 it('reaches depth 0 only outside the water, rising from the shore',()=>{
  const terrain=generateDepthTerrain([[rect(0,0,40,40)]],flat),{grid}=terrain;
  const row=Math.floor(grid.rows/2),depthAt=(column:number)=>terrain.depth[row*grid.columns+column];
  expect(depthAt(0)).toBe(0);
  for(let column=1;column<grid.columns/2-1;column++)expect(depthAt(column+1)).toBeGreaterThan(depthAt(column));
  expect(depthAt(1)).toBeCloseTo(.5/19.5,12);
 });
});

describe('tiny-fragment dropping',()=>{
 // A lake with an island, and a 2x2mm pond (4 cells at 1mm) on the island. The pond sits inside the
 // lake's bounding box, so adding or removing it cannot move the noise field: any change to the
 // lake's own depths would have to come from the pond itself.
 const lakeRing=[rect(0,0,40,40),rect(10,10,30,30)],pond=rect(18,18,20,20);
 const noisy:TerrainParamsInput={...everythingOn,resolution:{cellMm:1,minCellsLongSide:8}};
 const pondCells=(terrain:DepthTerrain)=>{const id=terrain.bodies.find(body=>body.cellCount===4)!.id;return [...terrain.bodyId.keys()].filter(i=>terrain.bodyId[i]===id)};

 it('defaults to 16 cells, and 1 keeps every body',()=>{
  expect(DEFAULT_TERRAIN_PARAMS.minBodyCells).toBe(16);
  const terrain=generateDepthTerrain([lakeRing,[pond]],{...noisy,minBodyCells:1});
  expect(terrain.bodies.map(body=>[body.cellCount,body.dropped])).toEqual([[1200,false],[4,false]]);
  assertTerrainInvariants(terrain,'minBodyCells 1');
 });

 it('flattens a body below the threshold to exactly 0 while it stays water',()=>{
  const terrain=generateDepthTerrain([lakeRing,[pond]],{...noisy,minBodyCells:16});
  const fragment=terrain.bodies.find(body=>body.cellCount===4)!;
  expect(fragment).toMatchObject({dropped:true,areaScale:0,targetDepth:0});
  const cells=pondCells(terrain);
  expect(cells).toHaveLength(4);
  for(const i of cells){expect(terrain.inside[i]).toBe(1);expect(Object.is(terrain.depth[i],0)).toBe(true)}
  expect(terrain.warnings).toEqual([]);
  assertTerrainInvariants(terrain,'pond dropped');
 });

 it('treats the threshold as inclusive: a body of exactly minBodyCells cells is kept',()=>{
  const atThreshold=generateDepthTerrain([lakeRing,[pond]],{...noisy,minBodyCells:4});
  for(const i of pondCells(atThreshold))expect(atThreshold.depth[i]).toBeGreaterThan(0);
  const justAbove=generateDepthTerrain([lakeRing,[pond]],{...noisy,minBodyCells:5});
  for(const i of pondCells(justAbove))expect(justAbove.depth[i]).toBe(0);
 });

 it('leaves a body above the threshold exactly as it would be without the dropped fragment',()=>{
  const withPond=generateDepthTerrain([lakeRing,[pond]],noisy),without=generateDepthTerrain([lakeRing],noisy);
  expect(withPond.grid).toEqual(without.grid);
  const lakeId=withPond.bodies.find(body=>!body.dropped)!.id;
  expect(withPond.bodies[lakeId]).toMatchObject({dropped:false,areaScale:1,targetDepth:everythingOn.maxDepth});
  for(let i=0;i<withPond.depth.length;i++)if(withPond.bodyId[i]===lakeId)expect(withPond.depth[i]).toBe(without.depth[i]);
 });

 it('does not change the scale of the bodies it keeps',()=>{
  // Pond kept or dropped, the lake's scale is relative to the largest body, which is the lake.
  const kept=generateDepthTerrain([lakeRing,[pond]],{...noisy,minBodyCells:1}),dropped=generateDepthTerrain([lakeRing,[pond]],noisy);
  const lake=(terrain:DepthTerrain)=>terrain.bodies.find(body=>body.cellCount===1200)!;
  expect(lake(dropped).areaScale).toBe(lake(kept).areaScale);
  for(let i=0;i<kept.depth.length;i++)if(kept.bodyId[i]===lake(kept).id)expect(dropped.depth[i]).toBe(kept.depth[i]);
 });

 it('warns, and stays finite and flat, when every body is below the threshold',()=>{
  const terrain=generateDepthTerrain([lakeRing,[pond]],{...noisy,minBodyCells:5000});
  expect(terrain.bodies.every(body=>body.dropped)).toBe(true);
  expect(terrain.depth.every(v=>v===0)).toBe(true);
  expect(terrain.warnings[0]).toContain('smaller than minBodyCells (5000 cells)');
  assertTerrainInvariants(terrain,'all dropped');
 });
});

describe('robustness',()=>{
 const shapes:Record<string,MultiPolygonMm>={
  lake,
  tiny:[[rect(0,0,.05,.05)]],
  sliverDiagonal:[[[[0,0],[1,0],[200,120],[199,120],[0,0]]]],
  spiky:[[star(0,0,90,5,60,77)]],
  comb:[[[[0,0],[100,0],[100,5],...Array.from({length:20},(_,k)=>[[95-5*k,5],[95-5*k,40],[93-5*k,40],[93-5*k,5]] as [number,number][]).flat(),[0,5],[0,0]]]],
  huge:[[star(2500,2500,31,1500,2400,5),star(2500,2500,9,200,500,6)]],
  manyBodies:[Array.from({length:30},(_,k)=>rect(k*7,(k%5)*9,k*7+1+k%4,(k%5)*9+2+(k%3))).map(ring=>[ring])].flat(),
 };

 it('never emits a non-finite or out-of-range value for any parameter combination, however malformed',()=>{
  const rand=lcg(20260924);
  const pick=<T>(values:T[])=>values[Math.floor(rand()*values.length)];
  const wild=()=>pick([Number.NaN,Infinity,-Infinity,-1,0,1,1e9,-1e9,rand(),rand()*3]);
  const numericKeys=['seed','maxDepth','bankSteepness','shelfWidth','terraceStrength','terraceLevels','noiseAmplitude','featureScale','octaves','roughness','ridged','warpStrength','grainAngleDeg','grainStrength','bodyScaleExponent','minBodyCells'] as const;
  for(const [name,shape] of Object.entries(shapes)){
   for(let trial=0;trial<12;trial++){
    const params:Record<string,unknown>={profile:pick([...TERRAIN_PROFILE_NAMES,'nonsense',undefined])};
    for(const key of numericKeys)if(rand()<.7)params[key]=wild();
    // Grid caps are kept small here purely for test run time; the cap itself is tested below.
    if(rand()<.5)params.resolution={cellMm:pick([Number.NaN,.01,.3,1,50]),minCellsLongSide:pick([0,16,64]),maxCellsLongSide:pick([Number.NaN,32,300])};
    else params.resolution={maxCellsLongSide:160};
    const terrain=generateDepthTerrain(shape,params as TerrainParamsInput);
    assertTerrainInvariants(terrain,`${name} trial ${trial} ${JSON.stringify(params)}`);
   }
  }
 });

 it('handles the extreme corners of every range',()=>{
  for(const corner of [0,1])assertTerrainInvariants(generateDepthTerrain(lake,{
   maxDepth:corner,bankSteepness:corner,shelfWidth:corner,terraceStrength:corner,terraceLevels:corner?12:2,noiseAmplitude:corner,featureScale:corner?2:.02,
   octaves:corner?8:1,roughness:corner,ridged:corner,warpStrength:corner*2,grainStrength:corner,bodyScaleExponent:corner*2,
  }),`corner ${corner}`);
 });

 it('gives a tiny shoreline a full grid and a sliver narrower than a cell a clear warning',()=>{
  const tiny=generateDepthTerrain(shapes.tiny);
  expect(tiny.grid.columns).toBe(64+2);
  expect(tiny.bodies).toHaveLength(1);
  const sliver=generateDepthTerrain([[rect(0,0,50,.1)]],{resolution:{cellMm:.5}});
  expect(sliver.bodies).toHaveLength(0);
  expect(sliver.warnings[0]).toContain('narrower than one cell');
  expect(sliver.depth.every(v=>v===0)).toBe(true);
 });

 it('rejects geometry it cannot measure with a clear error, never a NaN grid',()=>{
  expect(()=>generateDepthTerrain([])).toThrow('no coordinates');
  expect(()=>generateDepthTerrain([[[[3,3],[3,3],[3,3],[3,3]]]])).toThrow('zero extent');
  expect(()=>generateDepthTerrain([[[[0,0],[5,0],[5,Number.NaN],[0,0]]]])).toThrow('non-finite');
 });

 it('caps the grid for very large shorelines',()=>{
  const terrain=generateDepthTerrain(shapes.huge);
  expect(Math.max(terrain.grid.columns,terrain.grid.rows)).toBeLessThanOrEqual(512+2);
 });
});

describe('real shorelines',()=>{
 it.each([caldronFixture,noquebayFixture])('generates a valid terrain for $lake',fixture=>{
  const {widthMm,heightMm}=fixture.dimensions,projection=new CropProjection(fixture.crop,widthMm,heightMm);
  const model=buildWaterModel(fixture.water,projection,widthMm,heightMm,{mode:'primary',minAreaMm2:1});
  const terrain=generateDepthTerrain(model.water,DEFAULT_TERRAIN_PARAMS);
  expect(terrain.bodies.length).toBeGreaterThan(0);
  expect(terrain.warnings).toEqual([]);
  assertTerrainInvariants(terrain,fixture.lake);
 });
});

describe('parameter model',()=>{
 it('clamps out-of-range values, replaces non-finite ones and rounds integer knobs',()=>{
  const params=normalizeTerrainParams({maxDepth:5,shelfWidth:-1,octaves:3.6,terraceLevels:40,noiseAmplitude:Number.NaN,grainAngleDeg:-30,seed:-1,profile:'bogus' as never,resolution:{cellMm:0,minCellsLongSide:100,maxCellsLongSide:10}});
  expect(params).toMatchObject({maxDepth:1,shelfWidth:0,octaves:4,terraceLevels:12,noiseAmplitude:DEFAULT_TERRAIN_PARAMS.noiseAmplitude,grainAngleDeg:150,seed:4294967295,profile:DEFAULT_TERRAIN_PARAMS.profile});
  expect(params.resolution).toEqual({cellMm:.05,minCellsLongSide:100,maxCellsLongSide:100});
  expect(normalizeTerrainParams({minBodyCells:0}).minBodyCells).toBe(1);
  expect(normalizeTerrainParams({minBodyCells:7.6}).minBodyCells).toBe(8);
  expect(normalizeTerrainParams({minBodyCells:Number.NaN}).minBodyCells).toBe(16);
  expect(normalizeTerrainParams({minBodyCells:1e12}).minBodyCells).toBe(1000000);
 });

 it('treats grain angle as axial',()=>{
  expect(normalizeTerrainParams({grainAngleDeg:190}).grainAngleDeg).toBeCloseTo(10,12);
  expect(normalizeTerrainParams({grainAngleDeg:180}).grainAngleDeg).toBe(0);
  expect(normalizeTerrainParams({grainAngleDeg:-180}).grainAngleDeg).toBe(0);
 });

 it('expands the simple controls deterministically into an in-range full parameter set',()=>{
  expect(expandSimpleControls({character:.7,weave:.3})).toEqual(expandSimpleControls({character:.7,weave:.3}));
  for(const character of [0,.5,1])for(const bank of [0,1])for(const weave of [0,1]){
   const params=expandSimpleControls({character,bankSteepness:bank,weave,weaveAngleDeg:400,terracing:weave});
   expect(normalizeTerrainParams(params)).toEqual(params);
  }
  expect(expandSimpleControls({character:Number.NaN})).toEqual(DEFAULT_TERRAIN_PARAMS);
 });

 it('moves each simple control in the direction it describes',()=>{
  const calm=expandSimpleControls({character:0}),rugged=expandSimpleControls({character:1});
  expect(rugged.noiseAmplitude).toBeGreaterThan(calm.noiseAmplitude);
  expect(rugged.octaves).toBeGreaterThan(calm.octaves);
  expect(rugged.roughness).toBeGreaterThan(calm.roughness);
  expect(rugged.featureScale).toBeLessThan(calm.featureScale);
  expect(calm.ridged).toBe(0);expect(rugged.ridged).toBeGreaterThan(0);
  expect(calm.noiseAmplitude).toBeGreaterThan(0);
  const gentle=expandSimpleControls({bankSteepness:0}),steep=expandSimpleControls({bankSteepness:1});
  expect(steep.bankSteepness).toBeGreaterThan(gentle.bankSteepness);
  expect(steep.shelfWidth).toBeLessThan(gentle.shelfWidth);
  expect(expandSimpleControls({weave:0}).grainStrength).toBe(0);
  expect(expandSimpleControls({weave:1}).featureScale).toBeLessThan(expandSimpleControls({weave:0}).featureScale);
  expect(expandSimpleControls({weave:1}).grainStrength).toBeLessThan(1);
  expect(expandSimpleControls({weave:1,weaveAngleDeg:60}).grainAngleDeg).toBe(60);
 });
});

// Pinned 2026-09-24, re-pinned the same day when tiny-fragment dropping went in. Bodies in label
// order: a one-cell spike tip the raster separates from the main lake (now dropped, depth 0), the
// lake itself, the star-shaped bay, the rectangular pond.
const PINNED={
 cellCounts:[1,6532,800,99],
 depthSha256:'b6ea6ab82e874c2e52b4a534efd7b2d19c8133d94dfb5caff237982679136c54',
 keepAllDepthSha256:'d86b9e1025f79fe4ff1638ad3c1193e9250ad830bfdea6173eff310e03652998',
};
