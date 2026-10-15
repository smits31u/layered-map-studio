import {describe,expect,it} from 'vitest';
import {createDefaultEstimateConfig,PLACEHOLDER_LABEL} from '../../src/production/estimate/config';
import {clampEstimateConfig,ESTIMATE_STORAGE_KEY,loadEstimateConfig,saveEstimateConfig} from '../../src/production/estimate/persistence';

// The estimate config persists the same way the ornament and topo projects do: one schema-versioned
// localStorage record, merged over defaults and clamped, so nothing stored can break a quote.

const memoryStorage=()=>{const data=new Map<string,string>();return {data,getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v)},removeItem:(k:string)=>{data.delete(k)}}};

describe('estimate config defaults',()=>{
 it('carries Ben\'s prices, labelled for verification, and placeholder speeds',()=>{
  const c=createDefaultEstimateConfig();
  const price=(id:string)=>{const s=c.stock.find(x=>x.id===id)!;return s.packPrice/s.packQty};
  expect(price('mdf-12x20')).toBeCloseTo(26/12,9);
  expect(price('mdf-18x38')).toBe(6.5);
  expect(price('mdf-20x48')).toBe(9.5);
  expect(price('mdf-birch-24x36')).toBeCloseTo(110/6,9);
  expect(price('birch-18x36')).toBe(12.45);
  expect(price('birch-20x48')).toBe(19);
  expect(price('truflat-piece')).toBe(5.25);
  expect(c.stock.every(s=>/from Ben's notes, verify/.test(s.note??''))).toBe(true);
  expect(c.machine.name).toBe('xTool P2S 55W CO2');
  expect(c.machine.settings.every(s=>s.placeholder)).toBe(true);
  expect(PLACEHOLDER_LABEL).toBe('PLACEHOLDER - calibrate');
  expect(c.rates).toEqual({laserPerHour:25,designPerHour:25,designHours:0,suppliesPct:10});
  expect(c.materials.find(m=>m.id==='mdf-1-8')!.thicknessMm).toBe(3.175);
  const slots=(id:string)=>c.recipes.find(r=>r.id===id)!.slots.map(s=>`${s.kind}:${s.count}${s.upTo?'+':''}:${s.materialId}`);
  for(const id of ['8x10','10x10','12x12','11x14'])expect(slots(id)).toEqual(['border:1:truflat','layer:1:truflat','layer:4:mdf-1-8']);
  expect(slots('12x18')).toEqual(['border:1:truflat','layer:1:truflat','layer:7:mdf-1-8']);
  expect(slots('18x24')).toEqual(['layer:1:birch','layer:7+:mdf-1-8']);
  expect(slots('24x36')).toEqual(['layer:1:birch','layer:5:mdf-1-8']);
  expect(c.recipes.every(r=>r.frameCost===null)).toBe(true);
 });
});

describe('estimate config persistence',()=>{
 it('round-trips edits: prices, a recipe change, real speeds and calibration',()=>{
  const storage=memoryStorage(),c=createDefaultEstimateConfig();
  const edited={
   ...c,
   stock:c.stock.map(s=>s.id==='mdf-18x38'?{...s,packPrice:7.25}:s),
   recipes:c.recipes.map(r=>r.id==='24x36'?{...r,slots:[{kind:'layer' as const,materialId:'mdf-1-8',count:6},{kind:'layer' as const,materialId:'birch',count:1,note:'back'}],frameCost:42}:r),
   machine:{...c.machine,travelMultiplier:1.45,settings:c.machine.settings.map(s=>s.materialId==='mdf-1-8'?{...s,cutSpeedMmS:18,placeholder:false}:s)},
   calibration:[{id:'cal-1',recordedAt:'2026-10-14T12:00:00Z',label:'Job',estimatedMotionMin:30,estimatedOverheadMin:12,multiplierAtTime:1.3,actualMin:55}],
  };
  saveEstimateConfig(edited,storage);
  expect(storage.data.has(ESTIMATE_STORAGE_KEY)).toBe(true);
  expect(loadEstimateConfig(storage)).toEqual(edited);
 });

 it('nothing stored, unparseable JSON or another schema version all load the defaults',()=>{
  const storage=memoryStorage();
  expect(loadEstimateConfig(storage)).toEqual(createDefaultEstimateConfig());
  storage.setItem(ESTIMATE_STORAGE_KEY,'{not json');
  expect(loadEstimateConfig(storage)).toEqual(createDefaultEstimateConfig());
  storage.setItem(ESTIMATE_STORAGE_KEY,JSON.stringify({schemaVersion:2,rates:{laserPerHour:99}}));
  expect(loadEstimateConfig(storage).rates.laserPerHour).toBe(25);
 });

 it('clamps a hand-edited record instead of letting NaN or nonsense into a quote',()=>{
  const c=clampEstimateConfig({
   schemaVersion:1,
   rates:{laserPerHour:-5,designPerHour:'lots',suppliesPct:1e9},
   machine:{travelMultiplier:0,settings:[{materialId:'mdf-1-8',cutSpeedMmS:0,cutPasses:2.6,lineIntervalMm:'x'}]},
   stock:[{id:'half',name:'Half sized',materialIds:['mdf-1-8'],widthIn:12,heightIn:null,packPrice:5,packQty:0},{name:'no id'}],
   recipes:[{id:'r',widthIn:11,heightIn:14,slots:[{kind:'weird',materialId:'mdf-1-8',count:-3},{count:2}]}],
   calibration:[{id:'bad',actualMin:-4},{id:'ok',actualMin:12,estimatedMotionMin:5}],
  });
  expect(c.rates.laserPerHour).toBe(0);
  expect(c.rates.designPerHour).toBe(25);
  expect(c.rates.suppliesPct).toBe(500);
  expect(c.machine.travelMultiplier).toBe(.1);
  const mdf=c.machine.settings.find(s=>s.materialId==='mdf-1-8')!;
  expect(mdf.cutSpeedMmS).toBe(.1);
  expect(mdf.cutPasses).toBe(3);
  expect(mdf.lineIntervalMm).toBe(.1);
  expect(mdf.placeholder).toBe(true);
  // Materials that lost their settings row get a placeholder one.
  expect(c.machine.settings.map(s=>s.materialId).sort()).toEqual(['birch','mdf-1-8','truflat']);
  expect(c.stock).toEqual([{id:'half',name:'Half sized',materialIds:['mdf-1-8'],widthIn:null,heightIn:null,packPrice:5,packQty:1}]);
  expect(c.recipes[0].slots).toEqual([{kind:'layer',materialId:'mdf-1-8',count:0}]);
  expect(c.calibration.map(e=>e.id)).toEqual(['ok']);
 });

 it('survives storage that throws (private mode, quota)',()=>{
  const throwing={getItem:()=>{throw new Error('denied')},setItem:()=>{throw new Error('quota')},removeItem:()=>{}};
  expect(loadEstimateConfig(throwing)).toEqual(createDefaultEstimateConfig());
  expect(()=>saveEstimateConfig(createDefaultEstimateConfig(),throwing)).not.toThrow();
 });
});
