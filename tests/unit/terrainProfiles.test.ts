import {describe,expect,it} from 'vitest';
import {TERRAIN_PROFILE_NAMES} from '../../src/geometry/terrain/terrainParams';
import {applyProfile,bankGain,bankRemap,shelfRemap,terrace} from '../../src/geometry/terrain/terrainProfiles';

// Every shaping curve must send 0 to 0, 1 to 1 and never decrease; the pipeline composes them on
// that assumption. The fixture points are worked out by hand from each curve's formula.

const samples=Array.from({length:10001},(_,i)=>i/10000);
function expectUnitMonotone(f:(t:number)=>number,label:string){
 expect(f(0),`${label} at 0`).toBe(0);
 expect(f(1),`${label} at 1`).toBe(1);
 let previous=-Infinity;
 for(const t of samples){const v=f(t);expect(v,`${label} at ${t}`).toBeGreaterThanOrEqual(previous);expect(v).toBeGreaterThanOrEqual(0);expect(v).toBeLessThanOrEqual(1);previous=v}
}

describe('bottom profiles',()=>{
 it.each(TERRAIN_PROFILE_NAMES)('%s maps 0 to 0 and 1 to 1 and is monotonic',name=>{
  expectUnitMonotone(t=>applyProfile(name,t),name);
 });

 it.each(TERRAIN_PROFILE_NAMES)('%s clamps out-of-range and NaN input',name=>{
  expect(applyProfile(name,-3)).toBe(0);
  expect(applyProfile(name,4)).toBe(1);
  expect(applyProfile(name,Number.NaN)).toBe(0);
 });

 it('even-slope is the identity',()=>{
  for(const t of [.1,.3,.5,.77])expect(applyProfile('even-slope',t)).toBe(t);
 });

 it('smooth-basin is x(2-x): steep at the shore, flat at the bottom, above the diagonal',()=>{
  expect(applyProfile('smooth-basin',.5)).toBe(.75);
  expect(applyProfile('smooth-basin',.25)).toBe(.4375);
  expect(applyProfile('smooth-basin',1e-6)/1e-6).toBeCloseTo(2,5);
  expect((1-applyProfile('smooth-basin',1-1e-6))/1e-6).toBeCloseTo(0,5);
  for(const t of samples)expect(applyProfile('smooth-basin',t)).toBeGreaterThanOrEqual(t);
 });

 it('broad-shelf stays on its shallow lead-in until the break, then drops',()=>{
  expect(applyProfile('broad-shelf',.3)).toBeCloseTo(.054,15);
  expect(applyProfile('broad-shelf',.2)).toBeCloseTo(.036,15);
  expect(applyProfile('broad-shelf',.65)).toBeCloseTo(.18*.65+.82*.5,15);
  for(const t of samples.filter(t=>t<=.5))expect(applyProfile('broad-shelf',t)).toBeLessThan(t+1e-12);
 });

 it('stepped-benches has four flat benches at quarter depths with smooth risers',()=>{
  for(const level of [.25,.5,.75]){
   expect(applyProfile('stepped-benches',level)).toBeCloseTo(level,15);
   expect(Math.abs(applyProfile('stepped-benches',level+1e-3)-level)).toBeLessThan(1e-6);
   expect(Math.abs(applyProfile('stepped-benches',level-1e-3)-level)).toBeLessThan(1e-6);
  }
  expect(applyProfile('stepped-benches',.125)).toBeCloseTo(.125,15);
  expect(applyProfile('stepped-benches',.625)).toBeCloseTo(.625,15);
 });
});

describe('shelf, bank and terrace shaping',()=>{
 it('shelf remap is the identity at zero width and reaches the shelf lip at the shelf edge',()=>{
  for(const t of [.1,.5,.9])expect(shelfRemap(t,0)).toBe(t);
  for(const width of [.1,.3,.6]){
   expectUnitMonotone(t=>shelfRemap(t,width),`shelf ${width}`);
   expect(shelfRemap(width,width)).toBeCloseTo(.15,15);
   expect(shelfRemap(width-1e-9,width)).toBeCloseTo(.15,7);
  }
 });

 it('bank steepness sets the slope at the waterline: 0.4 gentle, 1 neutral, 7 steep',()=>{
  expect(bankGain(0)).toBeCloseTo(-.6,15);expect(bankGain(.5)).toBe(0);expect(bankGain(1)).toBe(6);
  expect(bankRemap(1e-7,0)/1e-7).toBeCloseTo(.4,5);
  expect(bankRemap(1e-7,1)/1e-7).toBeCloseTo(7,4);
  for(const t of [.2,.6])expect(bankRemap(t,.5)).toBe(t);
  for(const s of [0,.1,.25,.5,.75,.9,1])expectUnitMonotone(t=>bankRemap(t,s),`bank ${s}`);
  expect(bankRemap(.3,.9)).toBeGreaterThan(bankRemap(.3,.6));
 });

 it('terrace is the identity at zero strength and snaps to benches at full strength',()=>{
  for(const v of [.01,.3,.99])expect(terrace(v,6,0)).toBe(v);
  expect(terrace(.52,6,1)).toBeCloseTo(3/6,15);
  expect(terrace(.99,6,1)).toBeCloseTo(1,15);
  expect(terrace(.52,4,.5)).toBeCloseTo(.51,15);
 });

 it('never snaps a positive depth to the shoreline level 0',()=>{
  expect(terrace(1e-9,6,1)).toBeCloseTo(1/6,15);
  expect(terrace(.05,12,1)).toBeCloseTo(1/12,15);
  expect(terrace(0,6,1)).toBe(0);
 });

 it('caps the bench a value may snap to, and is unchanged when the cap is not reached',()=>{
  expect(terrace(.35,5,1)).toBeCloseTo(.4,15);
  expect(terrace(.35,5,1,1)).toBeCloseTo(.2,15);
  expect(terrace(.35,5,.5,1)).toBeCloseTo(.275,15);
  for(const v of [.01,.3,.52,.99])expect(terrace(v,6,1,6)).toBe(terrace(v,6,1));
  // Capped terracing stays monotonic and never exceeds the larger of the value and the cap.
  let previous=-Infinity;
  for(const t of samples){const v=terrace(t,5,1,2);expect(v).toBeGreaterThanOrEqual(previous);expect(v).toBeLessThanOrEqual(Math.max(t,2/5)+1e-15);previous=v}
 });

 it('keeps terrace monotonic for every strength',()=>{
  for(const strength of [.25,.5,1]){let previous=-Infinity;for(const t of samples){const v=terrace(t,5,strength);expect(v).toBeGreaterThanOrEqual(previous);previous=v}}
 });
});
