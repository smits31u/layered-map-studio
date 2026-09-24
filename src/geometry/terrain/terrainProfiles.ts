import type {TerrainProfileName} from './terrainParams';

// The shaping curves of the depth-terrain pipeline. Every function here maps [0,1] onto [0,1],
// sends 0 to exactly 0 and 1 to exactly 1, and is monotonic non-decreasing, so any composition of
// them is too — which is what lets the pipeline chain them freely without re-checking ranges.
// All of them use only +,−,×,÷, floor and round: no pow, no transcendental functions.

// NaN maps to 0 along with everything else that is not positive.
const clamp01=(x:number)=>x>0?(x<1?x:1):0;
export const smoothstep=(x:number)=>x*x*(3-2*x);
// Zero first and second derivative at both ends: flatter benches than smoothstep.
const smootherstep=(x:number)=>x*x*x*(x*(6*x-15)+10);

// broad-shelf: a gentle linear lead-in carries SHELF_LEAD of the depth everywhere; the remainder
// arrives as one smooth drop that only starts after SHELF_BREAK of the distance.
const SHELF_LEAD=.18,SHELF_BREAK=.3;
// stepped-benches: this many flat benches joined by smooth risers.
const BENCH_COUNT=4;

// Bottom-shape curves. Input: normalized distance from shore; output: normalized depth.
//  even-slope      depth proportional to distance — a straight-sided cone.
//  smooth-basin    x(2−x): full slope at the shore, flattening to a rounded bowl bottom.
//  broad-shelf     shallow for the first third, then a smooth drop to a flat deep floor.
//  stepped-benches four flat benches with smooth risers between them.
export function applyProfile(name:TerrainProfileName,t:number):number{
 const x=clamp01(t);
 if(x===0||x===1)return x;
 switch(name){
  case 'even-slope':return x;
  case 'smooth-basin':return x*(2-x);
  case 'broad-shelf':{const u=x<=SHELF_BREAK?0:(x-SHELF_BREAK)/(1-SHELF_BREAK);return SHELF_LEAD*x+(1-SHELF_LEAD)*smoothstep(u)}
  case 'stepped-benches':{const scaled=x*BENCH_COUNT,bench=Math.min(Math.floor(scaled),BENCH_COUNT-1);return (bench+smootherstep(scaled-bench))/BENCH_COUNT}
 }
}

// Depth reached at the outer edge of the near-shore shelf, as a fraction of full depth.
const SHELF_LIP=.15;

// Near-shore shelf: the first `width` of the distance only reaches SHELF_LIP of the depth; the rest
// covers the remaining depth linearly. Piecewise linear and continuous at the lip.
export function shelfRemap(t:number,width:number):number{
 const x=clamp01(t);
 if(width<=0||x===0||x===1)return x;
 return x<width?SHELF_LIP*x/width:SHELF_LIP+(1-SHELF_LIP)*(x-width)/(1-width);
}

// Bank steepness is expressed as the slope of the depth curve at the waterline. 0.5 is neutral
// (slope 1); below that the shore shallows toward a beach (slope down to 1−BANK_GENTLE), above it
// the shore drops off (slope up to 1+BANK_STEEP).
const BANK_GENTLE=.6,BANK_STEEP=6;
export const bankGain=(steepness:number)=>steepness<.5?-BANK_GENTLE*(1-2*steepness):BANK_STEEP*(2*steepness-1);

// A rational saturating curve t(1+k)/(1+kt): slope 1+k at t=0 and 1/(1+k) at t=1, monotonic for
// any k > −1. Chosen over a power curve so it stays within basic arithmetic.
export function bankRemap(t:number,steepness:number):number{
 const x=clamp01(t),k=bankGain(steepness);
 if(k===0||x===0||x===1)return x;
 return x*(1+k)/(1+k*x);
}

// Terracing: round to the nearest of `levels` benches and blend toward it by `strength`. Level 0 is
// reserved for the shoreline itself — a positive depth never snaps to 0 — because an interior cell
// at depth 0 would be a dry spot inside the water outline once this grid is contoured into layers.
// `maxLevel` caps the bench a value may snap to: a body whose design depth sits partway between two
// benches must not have its deepest cells rounded *up* past that depth.
export function terrace(v:number,levels:number,strength:number,maxLevel=levels):number{
 if(strength<=0||v<=0)return v;
 const level=Math.min(maxLevel,Math.max(1,Math.round(v*levels)))/levels;
 // At full strength return the bench itself: v+(level−v)·1 can land an ulp off it, which would
 // split one flat bench into several nearly-equal depths.
 return strength>=1?level:v+(level-v)*strength;
}
