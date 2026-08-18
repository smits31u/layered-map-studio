import {describe,expect,it} from 'vitest';
import {buildRoadLabelCandidates,resolveRoadLabelObject} from '../../src/geometry/scene/roadLabels';
import type {MapProject} from '../../src/types/project';

const config:MapProject['roadLabels']={visible:true,font:'inter',sizeMm:2.4,offsetMm:1,flipAllSides:false};
const road=(clazz:'primary'|'minor',name:string|undefined,points:[number,number][])=>({class:clazz,name,points:points.map(([x,y])=>({x,y}))});

describe('road label candidates',()=>{
 it('never labels an unnamed road',()=>{
  expect(buildRoadLabelCandidates([road('primary',undefined,[[0,0],[100,0]])])).toHaveLength(0);
 });

 it('picks the longest straight sub-segment among duplicate fragments sharing a name+class',()=>{
  const candidates=buildRoadLabelCandidates([
   road('primary','Main Street',[[0,0],[5,0]]),        // short fragment
   road('primary','Main Street',[[10,0],[90,0]]),        // long fragment (80 units)
  ]);
  expect(candidates).toHaveLength(1);
  expect(candidates[0].segmentLengthMm).toBeCloseTo(80,5);
  expect(candidates[0].baseXMm).toBeCloseTo(50,5);
 });

 it('keeps distinct named roads of the same class as separate candidates',()=>{
  const candidates=buildRoadLabelCandidates([road('primary','Main Street',[[0,0],[50,0]]),road('primary','Oak Avenue',[[0,10],[50,10]])]);
  expect(candidates).toHaveLength(2);
 });

 it('orients a horizontal west-to-east road at 0 degrees (never upside down)',()=>{
  const [candidate]=buildRoadLabelCandidates([road('primary','Main Street',[[0,0],[100,0]])]);
  expect(candidate.tangentAngleDeg).toBeCloseTo(0,5);
 });

 it('flips a right-to-left road 180 degrees so the label never reads upside down',()=>{
  const [candidate]=buildRoadLabelCandidates([road('primary','Main Street',[[100,0],[0,0]])]);
  // raw atan2 would be 180 (or -180); corrected orientation must stay within (-90,90]
  expect(Math.abs(candidate.tangentAngleDeg)).toBeLessThanOrEqual(90);
 });

 it('resolves a default offset perpendicular to the road, flippable via config or per-label override',()=>{
  const [candidate]=buildRoadLabelCandidates([road('primary','Main Street',[[0,0],[100,0]])]);
  const normal=resolveRoadLabelObject(candidate,config,undefined);
  const flippedGlobal=resolveRoadLabelObject(candidate,{...config,flipAllSides:true},undefined);
  const flippedPerLabel=resolveRoadLabelObject(candidate,config,{flipSide:true});
  expect(normal.yMm).not.toBeCloseTo(flippedGlobal.yMm,5);
  expect(flippedGlobal.yMm).toBeCloseTo(flippedPerLabel.yMm,5); // XOR: both produce the flipped side
  expect(normal.flipSide).toBe(false);
  expect(flippedGlobal.flipSide).toBe(true);
 });

 it('an absolute manual override wins over the computed default position',()=>{
  const [candidate]=buildRoadLabelCandidates([road('primary','Main Street',[[0,0],[100,0]])]);
  const resolved=resolveRoadLabelObject(candidate,config,{xMm:5,yMm:5});
  expect(resolved.xMm).toBe(5);
  expect(resolved.yMm).toBe(5);
 });

 it('honors a visible:false override (Hide)',()=>{
  const [candidate]=buildRoadLabelCandidates([road('primary','Main Street',[[0,0],[100,0]])]);
  expect(resolveRoadLabelObject(candidate,config,{visible:false}).visible).toBe(false);
 });
});
