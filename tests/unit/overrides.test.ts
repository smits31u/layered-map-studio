import {describe,expect,it} from 'vitest';
import {resetOverrideFields,resolvePlacement,screenDeltaToMm,setOverride} from '../../src/geometry/scene/overrides';
import {defaultProject} from '../../src/state/defaultProject';

describe('resolvePlacement',()=>{
 it('falls back to defaults when no override exists',()=>{
  const resolved=resolvePlacement({xMm:10,yMm:20,rotationDeg:5,scale:1,visible:true,flipSide:false});
  expect(resolved).toEqual({xMm:10,yMm:20,rotationDeg:5,scale:1,visible:true,flipSide:false});
 });

 it('an override field takes precedence over the default for that field only',()=>{
  const resolved=resolvePlacement({xMm:10,yMm:20},{xMm:99});
  expect(resolved.xMm).toBe(99);
  expect(resolved.yMm).toBe(20);
 });

 it('applies sensible zero/one/true defaults for rotation, scale, and visibility when absent from both',()=>{
  const resolved=resolvePlacement({xMm:0,yMm:0});
  expect(resolved).toMatchObject({rotationDeg:0,scale:1,visible:true,flipSide:false});
 });
});

describe('setOverride / resetOverrideFields (project state)',()=>{
 it('setOverride creates a new override entry without mutating the original project',()=>{
  const next=setOverride(defaultProject,'title',{xMm:50,yMm:60});
  expect(defaultProject.overrides.title).toBeUndefined();
  expect(next.overrides.title).toEqual({xMm:50,yMm:60});
 });

 it('setOverride merges into an existing entry rather than replacing it',()=>{
  const withPosition=setOverride(defaultProject,'title',{xMm:50,yMm:60});
  const withRotationToo=setOverride(withPosition,'title',{rotationDeg:15});
  expect(withRotationToo.overrides.title).toEqual({xMm:50,yMm:60,rotationDeg:15});
 });

 it('resetOverrideFields with no field list clears the whole entry',()=>{
  const withOverride=setOverride(defaultProject,'title',{xMm:50,yMm:60});
  const reset=resetOverrideFields(withOverride,'title');
  expect(reset.overrides.title).toBeUndefined();
 });

 it('resetOverrideFields with a field list clears only those fields',()=>{
  const withOverride=setOverride(defaultProject,'title',{xMm:50,yMm:60,rotationDeg:15});
  const reset=resetOverrideFields(withOverride,'title',['rotationDeg']);
  expect(reset.overrides.title).toEqual({xMm:50,yMm:60});
 });

 it('resetOverrideFields removes the entry entirely once its last field is cleared',()=>{
  const withOverride=setOverride(defaultProject,'title',{rotationDeg:15});
  const reset=resetOverrideFields(withOverride,'title',['rotationDeg']);
  expect(reset.overrides.title).toBeUndefined();
 });

 it('resetOverrideFields is a no-op for an object with no override',()=>{
  expect(resetOverrideFields(defaultProject,'title')).toBe(defaultProject);
 });
});

describe('screenDeltaToMm',()=>{
 const fakeSvg=(a:number,d:number)=>({getScreenCTM:()=>({a,d})}) as unknown as SVGSVGElement;

 it('converts a screen-pixel delta to mm using the CTM scale factors',()=>{
  expect(screenDeltaToMm(fakeSvg(2,2),20,10)).toEqual({dxMm:10,dyMm:5});
 });

 it('handles independently different X and Y scale (non-uniform CSS scaling)',()=>{
  expect(screenDeltaToMm(fakeSvg(2,4),20,20)).toEqual({dxMm:10,dyMm:5});
 });

 it('returns a zero delta when no CTM is available',()=>{
  const svg={getScreenCTM:()=>null} as unknown as SVGSVGElement;
  expect(screenDeltaToMm(svg,50,50)).toEqual({dxMm:0,dyMm:0});
 });
});
