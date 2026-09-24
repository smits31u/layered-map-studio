import {createHash} from 'node:crypto';
import ClipperLib from 'clipper-lib';
import {describe,expect,it} from 'vitest';
import {buildWaterModel,signedArea,type MultiPolygonMm,type RingMm} from '../../src/geometry/shoreline/polygonEngine';
import {CropProjection} from '../../src/geometry/projection/cropProjection';
import {simplifyRing} from '../../src/ornament/geometry/simplify';
import {generateDepthTerrain,type DepthTerrain} from '../../src/geometry/terrain/depthTerrain';
import {DEFAULT_CONTOUR_OPTIONS,NESTING_MARGIN_MM,extractDepthContours,normalizeContourOptions,normalizeThresholds,type ContourOptions,type DepthContours} from '../../src/geometry/terrain/depthContours';
import {traceContourRings} from '../../src/geometry/terrain/marchingSquares';
import {DEFAULT_TERRAIN_PARAMS,TERRAIN_PROFILE_NAMES,expandSimpleControls,type TerrainParamsInput} from '../../src/geometry/terrain/terrainParams';
import {caldronFixture,noquebayFixture} from '../fixtures/regressionFixtures';

// Contour extraction is the step that turns the depth grid into cut paths, and the one property
// everything depends on is nesting: a deeper cut inside the shallower one, for the same body. The
// pipeline enforces it and asserts it itself; these tests check it again with methods that share
// nothing with the implementation (polygon difference, and dense point sampling with a separate
// point-in-polygon), across real lakes, several threshold sets and every processing option.

const rect=(x0:number,y0:number,x1:number,y1:number):RingMm=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]];
function lcg(seed:number){let s=seed>>>0;return ()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296}}
function star(cx:number,cy:number,spikes:number,inner:number,outer:number,seed:number):RingMm{
 const rand=lcg(seed),ring:RingMm=[];
 for(let k=0;k<spikes*2;k++){const angle=k*Math.PI/spikes,r=(k%2?inner:outer)*(.75+.5*rand());ring.push([cx+r*Math.cos(angle),cy+r*Math.sin(angle)])}
 ring.push([...ring[0]] as [number,number]);
 return ring;
}
const circle=(cx:number,cy:number,r:number,n=96):RingMm=>{const ring:RingMm=Array.from({length:n},(_,k)=>[cx+r*Math.cos(2*Math.PI*k/n),cy+r*Math.sin(2*Math.PI*k/n)] as [number,number]);ring.push([...ring[0]] as [number,number]);return ring};

const realLake=(fixture:typeof caldronFixture)=>{const {widthMm,heightMm}=fixture.dimensions;return buildWaterModel(fixture.water,new CropProjection(fixture.crop,widthMm,heightMm),widthMm,heightMm,{mode:'primary',minAreaMm2:1}).water};
const LAKES=[{name:'Caldron Falls',water:realLake(caldronFixture)},{name:'Lake Noquebay',water:realLake(noquebayFixture)}];
// The multi-body lake from the Phase A tests: a star lake with an island, a separate bay, a pond.
const multiLake:MultiPolygonMm=[[star(60,50,19,28,44,1),star(55,48,7,4,8,2)],[star(140,40,11,9,16,3)],[rect(120,85,128,92)]];

const THRESHOLD_SETS:Record<string,number[]>={
 sixths:[1/6,2/6,3/6,4/6,5/6],
 shallow:[.05,.1,.15,.2],
 deep:[.6,.7,.8,.9,.95,.99],
 uneven:[.03,.31,.32,.77],
};
const OPTION_SETS:Record<string,Partial<ContourOptions>>={
 raw:{simplifyToleranceMm:0,smooth:false,minComponentAreaMm2:0,minHoleAreaMm2:0},
 default:{},
 coarse:{simplifyToleranceMm:.5,smooth:true},
 veryCoarse:{simplifyToleranceMm:2,smooth:false},
};

// Even/odd point-in-multipolygon, written separately from the implementation's.
function inside(geometry:MultiPolygonMm,x:number,y:number){
 let hit=false;
 for(const polygon of geometry)for(const ring of polygon)for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const [ax,ay]=ring[i],[bx,by]=ring[j];
  if((ay>y)!==(by>y)&&x<(bx-ax)*(y-ay)/(by-ay)+ax)hit=!hit;
 }
 return hit;
}
// Boolean area helpers on Clipper at 0.0001mm (ten times finer than the implementation's grid, and
// written separately from it). polygon-clipping cannot be used here: it throws on polygons sharing
// edges with their container, which nested contours do by construction.
const S=10000;
const paths=(g:MultiPolygonMm)=>g.flatMap(p=>p.map(r=>r.slice(0,-1).map(([x,y])=>({X:Math.round(x*S),Y:Math.round(y*S)}))));
function booleanArea(type:ClipperLib.ClipType,a:MultiPolygonMm,b:MultiPolygonMm){
 const c=new ClipperLib.Clipper(),out:ClipperLib.Paths=[];
 c.AddPaths(paths(a),ClipperLib.PolyType.ptSubject,true);c.AddPaths(paths(b),ClipperLib.PolyType.ptClip,true);
 c.Execute(type,out,ClipperLib.PolyFillType.pftEvenOdd,ClipperLib.PolyFillType.pftEvenOdd);
 return Math.abs(out.reduce((sum,path)=>sum+ClipperLib.Clipper.Area(path),0))/(S*S);
}
const outsideArea=(inner:MultiPolygonMm,outer:MultiPolygonMm)=>booleanArea(ClipperLib.ClipType.ctDifference,inner,outer);
function bbox(geometry:MultiPolygonMm){let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;for(const p of geometry)for(const r of p)for(const [x,y] of r){if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y}return {minX,minY,maxX,maxY}}

// Every level inside the level above it (level 1 inside the shoreline), by polygon difference and
// by sampling. Returns how many sample points landed inside some level, so callers can confirm the
// sampling actually exercised something. worstOutside records the largest outside area seen, which
// the report quotes.
const worstOutside={value:0};
function expectNested(contours:DepthContours,shoreline:MultiPolygonMm,label:string,samples=40){
 let exercised=0;
 for(const body of contours.bodies){
  let outer=shoreline;
  for(const level of body.levels){
   const where=`${label} body ${body.bodyId} @${level.threshold}`;
   if(level.geometry.length){
    const outside=outsideArea(level.geometry,outer);
    expect(outside,where).toBe(0);
    worstOutside.value=Math.max(worstOutside.value,outside);
    const b=bbox(level.geometry);
    for(let j=0;j<samples;j++)for(let i=0;i<samples;i++){
     const x=b.minX+(i+.3719)*(b.maxX-b.minX)/samples,y=b.minY+(j+.6173)*(b.maxY-b.minY)/samples;
     if(inside(level.geometry,x,y)){exercised++;if(!inside(outer,x,y))throw new Error(`${where}: point ${x},${y} is inside this level but outside the one above`)}
    }
   }
   outer=level.geometry;
  }
 }
 return exercised;
}

// Brute force with an x-sorted sweep: no two non-adjacent edges of one ring may meet at all, and no
// two rings of one level may properly cross.
function selfIntersections(geometry:MultiPolygonMm){
 type Seg={ring:number;index:number;n:number;ax:number;ay:number;bx:number;by:number};
 const segs:Seg[]=[];let ringId=0;
 for(const polygon of geometry)for(const ring of polygon){const n=ring.length-1;for(let i=0;i<n;i++)segs.push({ring:ringId,index:i,n,ax:ring[i][0],ay:ring[i][1],bx:ring[i+1][0],by:ring[i+1][1]});ringId++}
 segs.sort((p,q)=>Math.min(p.ax,p.bx)-Math.min(q.ax,q.bx));
 const cross=(ax:number,ay:number,bx:number,by:number,cx:number,cy:number)=>(bx-ax)*(cy-ay)-(by-ay)*(cx-ax);
 let problems=0;
 for(let a=0;a<segs.length;a++){
  const s=segs[a],sMaxX=Math.max(s.ax,s.bx);
  for(let b=a+1;b<segs.length;b++){
   const t=segs[b];
   if(Math.min(t.ax,t.bx)>sMaxX)break;
   if(Math.max(s.ay,s.by)<Math.min(t.ay,t.by)||Math.max(t.ay,t.by)<Math.min(s.ay,s.by))continue;
   const sameRing=s.ring===t.ring,d=Math.abs(s.index-t.index);
   if(sameRing&&(d===1||d===s.n-1))continue;
   const d1=cross(t.ax,t.ay,t.bx,t.by,s.ax,s.ay),d2=cross(t.ax,t.ay,t.bx,t.by,s.bx,s.by),d3=cross(s.ax,s.ay,s.bx,s.by,t.ax,t.ay),d4=cross(s.ax,s.ay,s.bx,s.by,t.bx,t.by);
   const proper=((d1>0&&d2<0)||(d1<0&&d2>0))&&((d3>0&&d4<0)||(d3<0&&d4>0));
   // An endpoint touches only if it is on the other segment itself, not merely on its line.
   const on=(px:number,py:number,ax:number,ay:number,bx:number,by:number)=>px>=Math.min(ax,bx)&&px<=Math.max(ax,bx)&&py>=Math.min(ay,by)&&py<=Math.max(ay,by);
   const touching=!proper&&((d1===0&&on(s.ax,s.ay,t.ax,t.ay,t.bx,t.by))||(d2===0&&on(s.bx,s.by,t.ax,t.ay,t.bx,t.by))||(d3===0&&on(t.ax,t.ay,s.ax,s.ay,s.bx,s.by))||(d4===0&&on(t.bx,t.by,s.ax,s.ay,s.bx,s.by)));
   if(proper||(sameRing&&touching))problems++;
  }
 }
 return problems;
}

const fingerprint=(contours:DepthContours)=>{
 const values:number[]=[];
 for(const body of contours.bodies){values.push(-1,body.bodyId);for(const level of body.levels){values.push(-2,level.threshold,level.geometry.length);for(const polygon of level.geometry){values.push(-3,polygon.length);for(const ring of polygon){values.push(-4,ring.length);for(const [x,y] of ring)values.push(x,y)}}}}
 return createHash('sha256').update(new Uint8Array(new Float64Array(values).buffer)).digest('hex');
};

describe('contours on a round lake',()=>{
 it('produce one clean closed ring per threshold, centred, shrinking with depth',()=>{
  const shoreline:MultiPolygonMm=[[circle(50,50,40)]];
  const terrain=generateDepthTerrain(shoreline,{noiseAmplitude:0,profile:'even-slope',shelfWidth:0,bankSteepness:.5});
  const contours=extractDepthContours(terrain,shoreline,[.25,.5,.75]);
  expect(contours.bodies).toHaveLength(1);
  let previousArea=Infinity;
  for(const level of contours.bodies[0].levels){
   expect(level.geometry,`@${level.threshold}`).toHaveLength(1);
   expect(level.geometry[0],`@${level.threshold} holes`).toHaveLength(1);
   const ring=level.geometry[0][0];
   expect(ring[0]).toEqual(ring.at(-1));
   const b=bbox(level.geometry);
   expect((b.minX+b.maxX)/2).toBeCloseTo(50,0);expect((b.minY+b.maxY)/2).toBeCloseTo(50,0);
   // Depth ∝ distance on this profile, so the ring at depth d sits about (1−d)·40mm from the centre.
   const expectedRadius=40*(1-level.threshold),radius=(b.maxX-b.minX)/2;
   expect(Math.abs(radius-expectedRadius),`radius @${level.threshold}`).toBeLessThan(1.5);
   expect(level.areaMm2).toBeLessThan(previousArea);previousArea=level.areaMm2;
   expect(selfIntersections(level.geometry)).toBe(0);
  }
 });
});

// The describes below do real geometry work (Clipper booleans and dense point sampling over two real
// lakes and several option sets) and are CPU-bound, not waiting on anything; 30s is headroom for a
// loaded machine running the whole suite in parallel, not cover for a race.
const HEAVY={timeout:30000};

describe('nesting',HEAVY,()=>{
 for(const lake of LAKES){
  for(const [setName,thresholds] of Object.entries(THRESHOLD_SETS)){
   it(`holds on ${lake.name}, ${setName} thresholds, under every processing option`,()=>{
    const terrain=generateDepthTerrain(lake.water,DEFAULT_TERRAIN_PARAMS);
    for(const [optionName,options] of Object.entries(OPTION_SETS)){
     const contours=extractDepthContours(terrain,lake.water,thresholds,options);
     const exercised=expectNested(contours,lake.water,`${lake.name}/${setName}/${optionName}`);
     if(setName!=='deep')expect(exercised).toBeGreaterThan(200);
    }
   });
  }
 }

 it('holds under rugged, ridged, terraced and grained terrain on both lakes',()=>{
  for(const lake of LAKES)for(const params of [expandSimpleControls({character:1,seed:3}),expandSimpleControls({character:.6,weave:.9,weaveAngleDeg:30,terracing:1,seed:9}),{...DEFAULT_TERRAIN_PARAMS,profile:'stepped-benches' as const,terraceStrength:1}]){
   const terrain=generateDepthTerrain(lake.water,params);
   for(const options of [OPTION_SETS.default,OPTION_SETS.coarse])expectNested(extractDepthContours(terrain,lake.water,THRESHOLD_SETS.sixths,options),lake.water,`${lake.name} ${params.profile}`,60);
  }
 });

 it('holds under normalize-first terracing, including thresholds exactly on the shared benches',()=>{
  // Terracing now happens after normalization, at global benches k/N. At full strength that makes
  // the grid a set of flat plateaus sitting exactly on those depths — the most degenerate input
  // marching squares sees (every sample on a bench equals the threshold). Thresholds exactly on the
  // benches, midway between them, and uneven ones, at full and partial strength, 5 and 6 benches,
  // on the multi-body lake (terraced lake and bay, un-terraced shallow pond) and both real lakes.
  let checked=0;
  for(const [name,shape] of [['multi-body',multiLake],...LAKES.map(l=>[l.name,l.water] as const)] as const){
   for(const N of [5,6])for(const strength of [1,.5]){
    const terrain=generateDepthTerrain(shape,{...DEFAULT_TERRAIN_PARAMS,terraceLevels:N,terraceStrength:strength,maxDepth:1,resolution:{cellMm:name==='multi-body'?.5:DEFAULT_TERRAIN_PARAMS.resolution.cellMm}});
    const onBenches=Array.from({length:N},(_,k)=>(k+1)/N),midway=Array.from({length:N},(_,k)=>(k+.5)/N);
    for(const thresholds of [onBenches,midway,THRESHOLD_SETS.uneven]){
     const contours=extractDepthContours(terrain,shape,thresholds);
     expectNested(contours,shape,`${name} N=${N} s=${strength} ${thresholds.map(t=>t.toFixed(3)).join('/')}`,25);
     for(const body of contours.bodies)for(const level of body.levels)expect(selfIntersections(level.geometry),`${name} N=${N} s=${strength} @${level.threshold}`).toBe(0);
     checked++;
    }
   }
  }
  expect(checked).toBe(3*2*2*3);
 });

 it('holds per body on a multi-body lake, and bodies stay independent and inside the shoreline',()=>{
  const terrain=generateDepthTerrain(multiLake,{...DEFAULT_TERRAIN_PARAMS,maxDepth:1,resolution:{cellMm:.4}});
  const contours=extractDepthContours(terrain,multiLake,[.05,.1,.2,.3,.5]);
  expect(contours.bodies.map(body=>body.bodyId)).toEqual(terrain.bodies.filter(body=>!body.dropped).map(body=>body.id));
  expectNested(contours,multiLake,'multi-body');
  // No two bodies' contours overlap at any threshold.
  for(let k=0;k<contours.thresholds.length;k++)for(let a=0;a<contours.bodies.length;a++)for(let b=a+1;b<contours.bodies.length;b++){
   const A=contours.bodies[a].levels[k].geometry,B=contours.bodies[b].levels[k].geometry;
   if(A.length&&B.length)expect(booleanArea(ClipperLib.ClipType.ctIntersection,A,B)).toBe(0);
  }
  // A shallow body has no contour below its own deepest point.
  for(const body of contours.bodies){
   const target=terrain.bodies[body.bodyId].targetDepth;
   for(const level of body.levels)if(level.threshold>target)expect(level.geometry,`body ${body.bodyId} @${level.threshold} (target ${target})`).toEqual([]);
  }
 });

 it('closes the gap the clip exists for: a simplified deeper ring really can poke out, and does not in the output',()=>{
  // Two thresholds so close their raw contours nearly coincide. Simplified on its own at 1mm, the
  // deeper ring has vertices outside the shallower level; through the pipeline it does not.
  const water=LAKES[1].water,terrain=generateDepthTerrain(water,DEFAULT_TERRAIN_PARAMS),g=terrain.grid;
  const options={simplifyToleranceMm:1,smooth:true,minComponentAreaMm2:0,minHoleAreaMm2:0};
  const contours=extractDepthContours(terrain,water,[.5,.5005],options);
  const shallow=contours.bodies[0].levels[0].geometry;
  const raw=traceContourRings(terrain.depth,g.columns,g.rows,.5005,s=>terrain.bodyId[s]).map(r=>r.points.map(([x,y])=>[g.originXMm+(x+.5)*g.cellMm,g.originYMm+(y+.5)*g.cellMm] as [number,number]));
  const naiveVertices=raw.filter(r=>signedArea(r)>0).flatMap(r=>simplifyRing(r,1));
  const escaped=naiveVertices.filter(([x,y])=>!inside(shallow,x,y)).length;
  expect(escaped).toBeGreaterThan(0);
  expectNested(contours,water,'near-coincident');
 });

 it('leaves nothing outside the containing level beyond vertex-rounding slivers',()=>{
  // Runs after every nesting test above (tests in a file run in order) and reports the largest
  // outside area any of them saw. The per-level allowance is perimeter × 0.001mm; the real figure
  // should be orders of magnitude below that.
  console.log(`worst outside area across nesting tests: ${worstOutside.value} mm²`);
  expect(worstOutside.value).toBe(0);
  expect(NESTING_MARGIN_MM).toBe(.003);
 });
});

describe('ring validity',HEAVY,()=>{
 it('uses a checker that does catch crossings and pinches (so a pass below means something)',()=>{
  expect(selfIntersections([[[[0,0],[10,10],[10,0],[0,10],[0,0]]]])).toBeGreaterThan(0);
  // A ring that touches itself at (5,5) without crossing.
  expect(selfIntersections([[[[0,0],[10,0],[5,5],[10,10],[0,10],[5,5],[0,0]]]])).toBeGreaterThan(0);
  // A notch whose far side, (5,0)–(6,0), lies on the *line* of the edge (0,0)–(2,0) but beyond its
  // end: collinear, not touching — the case the first version of this checker got wrong.
  expect(selfIntersections([[[[0,0],[2,0],[2,1],[4,1],[5,0],[6,0],[6,3],[0,3],[0,0]]]])).toBe(0);
  expect(selfIntersections([[rect(0,0,10,10)]])).toBe(0);
 });

 it('emits no self-intersecting or mutually crossing rings, on either lake, under any option set',()=>{
  for(const lake of LAKES){
   const terrain=generateDepthTerrain(lake.water,expandSimpleControls({character:.8,seed:2}));
   for(const options of Object.values(OPTION_SETS)){
    const contours=extractDepthContours(terrain,lake.water,THRESHOLD_SETS.sixths,options);
    for(const body of contours.bodies)for(const level of body.levels){
     expect(selfIntersections(level.geometry),`${lake.name} ${JSON.stringify(options)} @${level.threshold}`).toBe(0);
     for(const polygon of level.geometry)for(const ring of polygon){expect(ring.length).toBeGreaterThanOrEqual(4);expect(ring[0]).toEqual(ring.at(-1))}
    }
   }
  }
 });

 it('drops components and fills holes below the minimum area, and never the other way round',()=>{
  const water=LAKES[0].water,terrain=generateDepthTerrain(water,expandSimpleControls({character:1,seed:5}));
  const keepAll=extractDepthContours(terrain,water,THRESHOLD_SETS.sixths,{minComponentAreaMm2:0,minHoleAreaMm2:0});
  const cleaned=extractDepthContours(terrain,water,THRESHOLD_SETS.sixths,{minComponentAreaMm2:5,minHoleAreaMm2:5});
  let dropped=0;
  for(const [b,body] of cleaned.bodies.entries())for(const [k,level] of body.levels.entries()){
   for(const polygon of level.geometry){expect(Math.abs(signedArea(polygon[0]))).toBeGreaterThanOrEqual(5);for(const hole of polygon.slice(1))expect(Math.abs(signedArea(hole))).toBeGreaterThanOrEqual(5)}
   dropped+=keepAll.bodies[b].levels[k].geometry.length-level.geometry.length;
  }
  expect(dropped).toBeGreaterThan(0);
  expectNested(cleaned,water,'cleaned');
 });
});

describe('simplification tolerance',HEAVY,()=>{
 it('gives fewer vertices as the tolerance rises, without ever breaking nesting',()=>{
  for(const lake of LAKES){
   const terrain=generateDepthTerrain(lake.water,DEFAULT_TERRAIN_PARAMS);
   for(const smooth of [false,true]){
    let previous=Infinity;
    for(const tolerance of [0,.02,.05,.1,.3,1,2]){
     const contours=extractDepthContours(terrain,lake.water,THRESHOLD_SETS.sixths,{simplifyToleranceMm:tolerance,smooth});
     const vertices=contours.bodies.reduce((sum,body)=>sum+body.levels.reduce((s,level)=>s+level.vertexCount,0),0);
     expect(vertices,`${lake.name} smooth=${smooth} tolerance ${tolerance}`).toBeLessThan(previous);
     previous=vertices;
     expectNested(contours,lake.water,`${lake.name} tol ${tolerance}`,20);
    }
   }
  }
 });

 it('moves the outline by no more than about the tolerance',()=>{
  const water=LAKES[1].water,terrain=generateDepthTerrain(water,DEFAULT_TERRAIN_PARAMS);
  const exact=extractDepthContours(terrain,water,[.5],{simplifyToleranceMm:0,smooth:false,minComponentAreaMm2:0,minHoleAreaMm2:0});
  for(const tolerance of [.05,.3,1]){
   const simplified=extractDepthContours(terrain,water,[.5],{simplifyToleranceMm:tolerance,smooth:false,minComponentAreaMm2:0,minHoleAreaMm2:0});
   const a=exact.bodies[0].levels[0],b=simplified.bodies[0].levels[0];
   const perimeter=a.geometry.reduce((s,p)=>s+p.reduce((t,r)=>t+r.slice(1).reduce((u,q,i)=>u+Math.hypot(q[0]-r[i][0],q[1]-r[i][1]),0),0),0);
   const changed=booleanArea(ClipperLib.ClipType.ctXor,a.geometry,b.geometry);
   expect(changed,`tolerance ${tolerance}`).toBeLessThanOrEqual(perimeter*tolerance);
  }
 });
});

describe('determinism',()=>{
 it('gives byte-identical contours for the same grid and thresholds, with no state between calls',()=>{
  const water=LAKES[0].water,terrain=generateDepthTerrain(water,expandSimpleControls({character:.7,seed:11}));
  const first=fingerprint(extractDepthContours(terrain,water,THRESHOLD_SETS.sixths));
  extractDepthContours(terrain,water,THRESHOLD_SETS.uneven,OPTION_SETS.coarse);
  expect(fingerprint(extractDepthContours(terrain,water,THRESHOLD_SETS.sixths))).toBe(first);
  expect(fingerprint(extractDepthContours(terrain,water,[...THRESHOLD_SETS.sixths].reverse()))).toBe(first);
 });

 it('matches a pinned fingerprint, so any change to the cut geometry is deliberate',()=>{
  // Re-pin only for an intentional change to the contour pipeline or the Phase A grid under it,
  // and say so in the commit.
  const terrain=generateDepthTerrain(multiLake,{seed:424242,profile:'smooth-basin',noiseAmplitude:.5,resolution:{cellMm:.75}});
  const contours=extractDepthContours(terrain,multiLake,[.1,.25,.5,.75]);
  expect(contours.bodies.map(body=>body.levels.map(level=>level.geometry.length))).toEqual(PINNED.polygonCounts);
  expect(fingerprint(contours)).toBe(PINNED.sha256);
 });

 it('does not mutate the terrain or shoreline',()=>{
  const water=JSON.parse(JSON.stringify(multiLake)) as MultiPolygonMm,terrain=generateDepthTerrain(water);
  const depthBefore=new Float64Array(terrain.depth),waterBefore=JSON.stringify(water);
  extractDepthContours(terrain,water,[.2,.4]);
  expect(terrain.depth).toEqual(depthBefore);expect(JSON.stringify(water)).toBe(waterBefore);
 });
});

describe('robustness',HEAVY,()=>{
 const shapes:Record<string,MultiPolygonMm>={
  multiLake,
  tiny:[[rect(0,0,.05,.05)]],
  sliverDiagonal:[[[[0,0],[1,0],[200,120],[199,120],[0,0]]]],
  spiky:[[star(0,0,90,5,60,77)]],
  comb:[[[[0,0],[100,0],[100,5],...Array.from({length:20},(_,k)=>[[95-5*k,5],[95-5*k,40],[93-5*k,40],[93-5*k,5]] as [number,number][]).flat(),[0,5],[0,0]]]],
  huge:[[star(2500,2500,31,1500,2400,5),star(2500,2500,9,200,500,6)]],
  manyBodies:Array.from({length:30},(_,k)=>[rect(k*7,(k%5)*9,k*7+1+k%4,(k%5)*9+2+(k%3))]),
 };

 it('stays finite, closed, nested and non-crossing for fuzzed shapes, terrain, thresholds and options',()=>{
  const rand=lcg(20260925);
  const pick=<T>(values:T[])=>values[Math.floor(rand()*values.length)];
  const wild=()=>pick([Number.NaN,Infinity,-1,0,rand(),rand()*3,1e9]);
  let extractions=0;
  for(const [name,shape] of Object.entries(shapes)){
   for(let trial=0;trial<5;trial++){
    const params:TerrainParamsInput={profile:pick([...TERRAIN_PROFILE_NAMES]),noiseAmplitude:rand(),seed:trial,terraceStrength:pick([0,.5,1]),minBodyCells:pick([1,16]),resolution:{maxCellsLongSide:pick([48,160])}};
    const terrain:DepthTerrain=generateDepthTerrain(shape,params);
    const count=1+Math.floor(rand()*6),thresholds=Array.from({length:count},()=>pick([1e-6,.01,rand(),rand(),.5,1]));
    const options:Record<string,unknown>={simplifyToleranceMm:wild(),smooth:pick([true,false,'yes']),minComponentAreaMm2:wild(),minHoleAreaMm2:wild()};
    const contours=extractDepthContours(terrain,shape,thresholds,options as Partial<ContourOptions>);
    extractions++;
    const label=`${name} trial ${trial} ${JSON.stringify({thresholds,options})}`;
    expectNested(contours,shape,label,25);
    for(const body of contours.bodies)for(const level of body.levels){
     expect(Number.isFinite(level.areaMm2)).toBe(true);
     for(const polygon of level.geometry)for(const ring of polygon)for(const [x,y] of ring)if(!Number.isFinite(x)||!Number.isFinite(y))throw new Error(`${label}: non-finite coordinate`);
     expect(selfIntersections(level.geometry),label).toBe(0);
    }
   }
  }
  expect(extractions).toBe(35);
 });

 it('returns no bodies, not an error, when every body was dropped',()=>{
  const water:MultiPolygonMm=[[rect(0,0,10,10)]],terrain=generateDepthTerrain(water,{minBodyCells:1e6});
  expect(extractDepthContours(terrain,water,[.5]).bodies).toEqual([]);
 });
});

describe('inputs',()=>{
 it('refuses thresholds that are not a depth in (0, 1], and sorts and de-duplicates the rest',()=>{
  for(const bad of [[],[0],[-.1],[1.01],[Number.NaN],[Infinity],[.5,Number.NaN]])expect(()=>normalizeThresholds(bad)).toThrow('Depth contours');
  expect(normalizeThresholds([.5,.1,.5,1])).toEqual([.1,.5,1]);
 });

 it('clamps options and replaces non-finite ones with defaults',()=>{
  expect(normalizeContourOptions({simplifyToleranceMm:-1,smooth:'no' as never,minComponentAreaMm2:Number.NaN,minHoleAreaMm2:Infinity})).toEqual({simplifyToleranceMm:0,smooth:DEFAULT_CONTOUR_OPTIONS.smooth,minComponentAreaMm2:DEFAULT_CONTOUR_OPTIONS.minComponentAreaMm2,minHoleAreaMm2:DEFAULT_CONTOUR_OPTIONS.minHoleAreaMm2});
  expect(DEFAULT_CONTOUR_OPTIONS).toEqual({simplifyToleranceMm:.04,smooth:true,minComponentAreaMm2:.25,minHoleAreaMm2:.25});
 });
});

// Pinned 2026-09-24 from the first Phase B implementation. Rows are the kept bodies in id order
// (lake, bay, pond), columns the thresholds 0.1/0.25/0.5/0.75: the smaller bodies run out of depth
// first, as their area scaling says they should.
const PINNED={polygonCounts:[[1,1,1,1],[1,1,0,0],[1,0,0,0]],sha256:'3029795f45888458de88ae4193175a226540cee3a51d765702714125955ab432'};
