import {describe,expect,it} from 'vitest';
import {createNoiseSampler,fbm,hash2,latticeValue,ridge,valueNoise,type TerrainNoiseOptions} from '../../src/geometry/terrain/terrainNoise';

// The hash constants are this module's own, so their quality is measured here rather than assumed:
// a poor mix shows up as visible lattice patterns in the terrain long before it shows up anywhere
// else.

const popcount=(v:number)=>{let c=0;while(v){v&=v-1;c++}return c};
const base:TerrainNoiseOptions={seed:7,octaves:5,roughness:.5,ridged:0,warpStrength:0,grainAngleDeg:0,grainStrength:0};

describe('integer hash',()=>{
 it('is a pure function of its inputs',()=>{
  expect(hash2(12,-7,99)).toBe(hash2(12,-7,99));
  expect(hash2(0,0,0)).toBe(hash2(0,0,0));
 });

 it('is uniform with balanced output bits over a lattice region',()=>{
  const bits=new Array(32).fill(0);let n=0,sum=0;
  for(const seed of [0,1,99])for(let y=-60;y<60;y++)for(let x=-60;x<60;x++){const h=hash2(x,y,seed);n++;sum+=h/4294967296;for(let b=0;b<32;b++)if((h>>>b)&1)bits[b]++}
  expect(Math.abs(sum/n-.5)).toBeLessThan(.005);
  for(const count of bits)expect(Math.abs(count/n-.5)).toBeLessThan(.01);
 });

 it('flips about half its bits when x, y or seed moves by one',()=>{
  let flips=0,trials=0;
  for(let y=-40;y<40;y++)for(let x=-40;x<40;x++){const h=hash2(x,y,5);flips+=popcount((h^hash2(x+1,y,5))>>>0)+popcount((h^hash2(x,y+1,5))>>>0)+popcount((h^hash2(x,y,6))>>>0);trials+=3}
  expect(flips/trials).toBeGreaterThan(15.5);
  expect(flips/trials).toBeLessThan(16.5);
 });

 it('is not symmetric in x and y',()=>{
  let same=0;
  for(let a=1;a<200;a++)if(hash2(a,a+3,1)===hash2(a+3,a,1))same++;
  expect(same).toBe(0);
 });
});

describe('value noise and fBm',()=>{
 it('passes through the lattice values at integer points and stays in [0,1)',()=>{
  for(let y=-3;y<3;y++)for(let x=-3;x<3;x++)expect(valueNoise(x,y,4)).toBe(latticeValue(x,y,4));
  for(let k=0;k<5000;k++){const v=valueNoise(k*.137-300,k*.071+11,4);expect(v).toBeGreaterThanOrEqual(0);expect(v).toBeLessThan(1)}
 });

 it('is continuous, including across lattice lines',()=>{
  for(const x of [2-1e-9,2,2.5,-1-1e-9,-1,7.999999]){expect(Math.abs(valueNoise(x+1e-7,.3,4)-valueNoise(x,.3,4))).toBeLessThan(1e-6)}
 });

 it('keeps fBm in [0,1] for every octave count and roughness, ridged or not',()=>{
  for(const octaves of [1,3,8])for(const roughness of [0,.5,1])for(const ridged of [0,.5,1])for(let k=0;k<300;k++){
   const v=fbm(k*.731-50,k*.419+3,11,{octaves,roughness,ridged});
   expect(v).toBeGreaterThanOrEqual(0);expect(v).toBeLessThanOrEqual(1);
  }
 });

 it('reduces to its first octave at zero roughness',()=>{
  for(let k=0;k<200;k++){const x=k*.37,y=k*.21;expect(fbm(x,y,3,{octaves:6,roughness:0,ridged:0})).toBe(fbm(x,y,3,{octaves:1,roughness:0,ridged:0}))}
 });

 it('becomes the ridge transform of the smooth octave at ridged = 1',()=>{
  expect(ridge(0)).toBe(0);expect(ridge(1)).toBe(0);expect(ridge(.5)).toBe(1);expect(ridge(.25)).toBe(.25);
  for(let k=0;k<200;k++){const x=k*.37,y=k*.21,smooth=fbm(x,y,3,{octaves:1,roughness:.5,ridged:0});expect(fbm(x,y,3,{octaves:1,roughness:.5,ridged:1})).toBeCloseTo(ridge(smooth),14)}
 });

 it('produces an uncorrelated field for a different seed',()=>{
  const a:number[]=[],b:number[]=[];
  for(let k=0;k<2000;k++){const x=(k%50)*1.37,y=Math.floor(k/50)*1.41;a.push(fbm(x,y,1,base));b.push(fbm(x,y,2,base))}
  const mean=(v:number[])=>v.reduce((s,x)=>s+x,0)/v.length,ma=mean(a),mb=mean(b);
  let cov=0,va=0,vb=0;
  for(let i=0;i<a.length;i++){cov+=(a[i]-ma)*(b[i]-mb);va+=(a[i]-ma)**2;vb+=(b[i]-mb)**2}
  expect(Math.abs(cov/Math.sqrt(va*vb))).toBeLessThan(.1);
 });
});

describe('terrain noise sampler',()=>{
 const meanStep=(sample:(x:number,y:number)=>number,dx:number,dy:number)=>{let sum=0,n=0;for(let j=0;j<40;j++)for(let i=0;i<40;i++){const x=i*.61+.13,y=j*.53+.29;sum+=Math.abs(sample(x+dx,y+dy)-sample(x,y));n++}return sum/n};

 it('stays in [0,1] under warp, grain and ridges',()=>{
  const sample=createNoiseSampler({...base,ridged:.8,warpStrength:2,grainAngleDeg:33,grainStrength:1});
  for(let k=0;k<3000;k++){const v=sample(k*.093-40,k*.057+9);expect(v).toBeGreaterThanOrEqual(0);expect(v).toBeLessThanOrEqual(1)}
 });

 it('ignores the grain angle entirely while grain strength is zero',()=>{
  const a=createNoiseSampler({...base,warpStrength:.7,grainAngleDeg:0}),b=createNoiseSampler({...base,warpStrength:.7,grainAngleDeg:71});
  for(let k=0;k<500;k++)expect(b(k*.3,k*.17)).toBe(a(k*.3,k*.17));
 });

 it('changes the field when the domain warp is turned on',()=>{
  const plain=createNoiseSampler(base),warped=createNoiseSampler({...base,warpStrength:1});
  let moved=0;for(let k=0;k<500;k++)if(Math.abs(plain(k*.3,k*.17)-warped(k*.3,k*.17))>.01)moved++;
  expect(moved).toBeGreaterThan(400);
 });

 it('is isotropic without grain and elongates features along the grain angle with it',()=>{
  const step=.25;
  const iso=createNoiseSampler(base);
  const ratioIso=meanStep(iso,step,0)/meanStep(iso,0,step);
  expect(ratioIso).toBeGreaterThan(.8);expect(ratioIso).toBeLessThan(1.25);
  for(const angle of [0,30,90,145]){
   const sample=createNoiseSampler({...base,grainAngleDeg:angle,grainStrength:1}),r=angle*Math.PI/180;
   const along=meanStep(sample,step*Math.cos(r),step*Math.sin(r)),across=meanStep(sample,-step*Math.sin(r),step*Math.cos(r));
   expect(along/across,`angle ${angle}`).toBeLessThan(.45);
  }
 });
});
