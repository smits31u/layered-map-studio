// Seeded value noise for the depth-terrain generator: an integer hash, smoothstep-interpolated
// lattice noise, fBm with ridge blending, domain warping and a directional grain transform.
//
// Determinism: a sample is a pure function of (coordinates, seed, options). No Math.random, no
// module-level mutable state, no permutation table built at import time. Per sample, the arithmetic
// is Math.imul/shifts plus IEEE-754 +,−,×,÷, floor and abs, all exactly specified, so a sample is
// bit-identical on every conforming JS engine. The only transcendental calls (cos/sin of the grain
// angle) run once per sampler, not per sample.
//
// The hash multipliers and salts below are arbitrary odd constants chosen for this module. Their
// mixing quality (uniform output, balanced bits, ~16 of 32 bits flipping per unit input step) is
// pinned by terrainNoise.test.ts rather than assumed.

const SEED_SALT=0x1d4c9a36;
const LATTICE_X=0x2f6b4d93,LATTICE_Y=0x51c3a8e7;
const MIX_A=0x7a3d1c4b,MIX_B=0x3e95b2d1,MIX_C=0x58f16a0f;
// Independent noise streams derived from one user seed.
const STREAM_OCTAVE=0x11,STREAM_MAIN=0x23,STREAM_WARP_U=0x35,STREAM_WARP_V=0x47;
// Per-octave lattice shift, so octaves do not all share lattice points at the origin (which shows
// up as a visible pinch where every octave interpolates from the same corner).
const OCTAVE_SHIFT_X=.3719,OCTAVE_SHIFT_Y=.6173;
// The warp field is sampled at half the base frequency with two octaves: slow, broad displacement.
const WARP_FREQUENCY=.5;
const WARP_OCTAVES=2;
// Elongation at full grain strength: features become (1 + this) times longer along the grain.
const GRAIN_MAX_STRETCH=4;

const UINT32_RANGE=4294967296;

export function hash2(x:number,y:number,seed:number):number{
 let h=Math.imul((seed^SEED_SALT)|0,MIX_A);
 h^=Math.imul(x|0,LATTICE_X);h^=h>>>15;h=Math.imul(h,MIX_B);
 h^=Math.imul(y|0,LATTICE_Y);h^=h>>>13;h=Math.imul(h,MIX_C);
 h^=h>>>16;h=Math.imul(h,MIX_A);h^=h>>>14;
 return h>>>0;
}

// Lattice value in [0,1).
export const latticeValue=(x:number,y:number,seed:number)=>hash2(x,y,seed)/UINT32_RANGE;

export const deriveSeed=(seed:number,stream:number,index=0)=>hash2(index,stream,seed);

// Bilinear interpolation of lattice values with a smoothstep fade, so the surface is C1 across
// lattice lines. Output in [0,1).
export function valueNoise(x:number,y:number,seed:number):number{
 const x0=Math.floor(x),y0=Math.floor(y),fx=x-x0,fy=y-y0;
 const sx=fx*fx*(3-2*fx),sy=fy*fy*(3-2*fy);
 const v00=latticeValue(x0,y0,seed),v10=latticeValue(x0+1,y0,seed),v01=latticeValue(x0,y0+1,seed),v11=latticeValue(x0+1,y0+1,seed);
 const top=v00+(v10-v00)*sx,bottom=v01+(v11-v01)*sx;
 return top+(bottom-top)*sy;
}

// The ridge transform: 1 at the noise midline, 0 at both extremes, squared to sharpen the crest.
export const ridge=(v:number)=>{const r=1-Math.abs(2*v-1);return r*r};

export interface FbmOptions{octaves:number;roughness:number;ridged:number}

// Fractional Brownian motion: octaves at doubling frequency, each weighted by roughness^octave, the
// sum divided by the total weight so the output stays in [0,1] whatever the octave count. Each
// octave is blended toward its ridged form by `ridged` before summing.
export function fbm(x:number,y:number,seed:number,options:FbmOptions):number{
 let sum=0,weight=0,amplitude=1,frequency=1;
 for(let octave=0;octave<options.octaves;octave++){
  const octaveSeed=deriveSeed(seed,STREAM_OCTAVE,octave);
  let v=valueNoise(x*frequency+octave*OCTAVE_SHIFT_X,y*frequency+octave*OCTAVE_SHIFT_Y,octaveSeed);
  if(options.ridged>0)v+=(ridge(v)-v)*options.ridged;
  sum+=amplitude*v;weight+=amplitude;
  amplitude*=options.roughness;frequency*=2;
 }
 return weight>0?sum/weight:0;
}

export interface TerrainNoiseOptions extends FbmOptions{seed:number;warpStrength:number;grainAngleDeg:number;grainStrength:number}
export type NoiseSampler=(x:number,y:number)=>number;

// Builds the full sampler. Coordinates are in base-feature units (one unit = one base feature).
// Order: grain first (rotate into the grain frame, compress along the grain axis so features
// elongate along it, rotate back), then the domain warp so it bends already-elongated features,
// then the main fBm lookup. Output in [0,1].
//
// At zero grain strength the grain transform is skipped outright rather than applied as a rotation
// there and back, so the grain angle has exactly no effect until grain is turned on.
export function createNoiseSampler(options:TerrainNoiseOptions):NoiseSampler{
 const radians=options.grainAngleDeg*Math.PI/180,cos=Math.cos(radians),sin=Math.sin(radians);
 const stretch=1+GRAIN_MAX_STRETCH*options.grainStrength;
 const mainSeed=deriveSeed(options.seed,STREAM_MAIN),warpSeedU=deriveSeed(options.seed,STREAM_WARP_U),warpSeedV=deriveSeed(options.seed,STREAM_WARP_V);
 const main:FbmOptions={octaves:options.octaves,roughness:options.roughness,ridged:options.ridged};
 const warp:FbmOptions={octaves:WARP_OCTAVES,roughness:.5,ridged:0};
 const warpStrength=options.warpStrength;
 return (x,y)=>{
  let u=x,v=y;
  if(stretch!==1){const along=(x*cos+y*sin)/stretch,across=y*cos-x*sin;u=along*cos-across*sin;v=along*sin+across*cos}
  if(warpStrength>0){
   const wu=fbm(u*WARP_FREQUENCY,v*WARP_FREQUENCY,warpSeedU,warp),wv=fbm(u*WARP_FREQUENCY,v*WARP_FREQUENCY,warpSeedV,warp);
   u+=(2*wu-1)*warpStrength;v+=(2*wv-1)*warpStrength;
  }
  return fbm(u,v,mainSeed,main);
 };
}
