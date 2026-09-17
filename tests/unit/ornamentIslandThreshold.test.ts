import {describe,expect,it} from 'vitest';
import type {MultiPolygonMm} from '../../src/geometry/shoreline/polygonEngine';
import {createDefaultOrnamentProject} from '../../src/ornament/defaults';
import {applyIslandPolicy} from '../../src/ornament/geometry/landIslands';
import {loadOrnamentProject,ORNAMENT_STORAGE_KEY} from '../../src/ornament/persistence';
import type {OrnamentProject} from '../../src/ornament/types';

// The omit threshold, and what removing the marker did to a saved project.
//
// Ben was asked explicitly whether "islands under 2mm" meant an area or a linear dimension, because
// the setting has always been an area in mm² and "2mm" is a length. He chose area: 2mm². That is
// recorded here rather than inferred, and the direction matters — 2mm² is *looser* than the 4mm²
// it replaced, so an island that used to be dropped can now survive.

const square=(cx:number,cy:number,sideMm:number):MultiPolygonMm[number]=>{
 const h=sideMm/2;
 return [[[cx-h,cy-h],[cx+h,cy-h],[cx+h,cy+h],[cx-h,cy+h],[cx-h,cy-h]]];
};

// A mainland plus three islands, sized to straddle both the old and the new threshold. All three sit
// far enough away that no tab can reach them, so the omit rule is the only thing acting on them.
const AREAS={big:9,middle:3,speck:1} as const;
const land=():MultiPolygonMm=>[
 square(0,0,40),
 square(200,0,Math.sqrt(AREAS.big)),
 square(260,0,Math.sqrt(AREAS.middle)),
 square(320,0,Math.sqrt(AREAS.speck)),
];

const omitAt=(minIslandAreaMm2:number)=>applyIslandPolicy(land(),{
 policy:'omit-below-threshold',
 minIslandAreaMm2,
 bridgeWidthMm:1.5,
});

const keptAreas=(result:ReturnType<typeof omitAt>)=>result.remaining.map(island=>Number(island.areaMm2.toFixed(2))).sort((a,b)=>a-b);

describe('island omit threshold',()=>{
 it('defaults to 2mm² of area, as Ben specified',()=>{
  expect(createDefaultOrnamentProject().land.minIslandAreaMm2).toBe(2);
 });

 it('before and after: the 3mm² island survives the new threshold and did not survive the old',()=>{
  const before=omitAt(4);
  const after=omitAt(2);

  // Old default: the 3mm² island and the 1mm² speck both go.
  expect(before.omitted.map(island=>Number(island.areaMm2.toFixed(2))).sort((a,b)=>a-b)).toEqual([1,3]);
  expect(keptAreas(before)).toEqual([9]);

  // New default: only the speck goes.
  expect(after.omitted.map(island=>Number(island.areaMm2.toFixed(2)))).toEqual([1]);
  expect(keptAreas(after)).toEqual([3,9]);
 });

 it('keeps an island exactly on the line, and drops one just under it',()=>{
  const onTheLine=applyIslandPolicy([square(0,0,40),square(200,0,Math.sqrt(2))],{policy:'omit-below-threshold',minIslandAreaMm2:2,bridgeWidthMm:1.5});
  expect(onTheLine.omitted).toHaveLength(0);
  const justUnder=applyIslandPolicy([square(0,0,40),square(200,0,Math.sqrt(1.99))],{policy:'omit-below-threshold',minIslandAreaMm2:2,bridgeWidthMm:1.5});
  expect(justUnder.omitted).toHaveLength(1);
 });

 it('still reports everything it removed, with sizes',()=>{
  const result=omitAt(2);
  expect(result.detected).toHaveLength(3);
  expect(result.omitted).toHaveLength(1);
  expect(result.omitted[0].areaMm2).toBeCloseTo(1,6);
 });

 it('applies the same threshold to fragments bridging cannot reach',()=>{
  // The default policy. Nothing here is within tab reach, so bridge falls back to the omit rule.
  const result=applyIslandPolicy(land(),{policy:'bridge',minIslandAreaMm2:2,bridgeWidthMm:1.5});
  expect(result.bridges).toHaveLength(0);
  expect(result.omitted.map(island=>Number(island.areaMm2.toFixed(2)))).toEqual([1]);
  expect(keptAreas(result)).toEqual([3,9]);
 });
});

describe('a project saved before the marker was removed',()=>{
 const legacy={
  ...createDefaultOrnamentProject(),
  // Exactly what the previous build wrote, marker and all.
  marker:{kind:'heart',sizeMm:8},
  land:{islandPolicy:'keep-separate',minIslandAreaMm2:4,bridgeWidthMm:1.5,structuralRingWidthMm:2},
 };

 const storage=()=>{
  const map=new Map<string,string>([[ORNAMENT_STORAGE_KEY,JSON.stringify(legacy)]]);
  return {
   getItem:(k:string)=>map.get(k)??null,
   setItem:(k:string,v:string)=>{map.set(k,v)},
   removeItem:(k:string)=>{map.delete(k)},
  };
 };

 // schemaVersion deliberately stayed at 1 through the removal. Bumping it would have rejected every
 // project saved by the previous build to avoid carrying one unread key.
 it('still loads, rather than being rejected as a foreign schema',()=>{
  const loaded=loadOrnamentProject(storage());
  expect(loaded).toBeDefined();
  expect(loaded!.schemaVersion).toBe(1);
 });

 it('keeps the settings that still exist',()=>{
  const loaded=loadOrnamentProject(storage())!;
  expect(loaded.land.islandPolicy).toBe('keep-separate');
  expect(loaded.land.minIslandAreaMm2).toBe(4);
  expect(loaded.ornament.diameterMm).toBe(101.6);
 });

 it('carries the dead marker key inertly, and nothing reads it',()=>{
  const loaded=loadOrnamentProject(storage())!;
  // It rides through the merge as an extra property. That is the cost of not bumping the schema,
  // and it is a few bytes rather than a lost project.
  expect((loaded as OrnamentProject&{marker?:unknown}).marker).toBeDefined();
  // What matters is that nothing in the shipped type refers to it.
  expect(Object.keys(createDefaultOrnamentProject())).not.toContain('marker');
 });
});
