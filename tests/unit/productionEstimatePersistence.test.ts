import {describe,expect,it} from 'vitest';
import {createDefaultEstimateConfig,lineIntervalFromUnit,lineIntervalToUnit,PLACEHOLDER_LABEL,SETTING_FIELDS} from '../../src/production/estimate/config';
import {clampEstimateConfig,ESTIMATE_STORAGE_KEY,loadEstimateConfig,saveEstimateConfig} from '../../src/production/estimate/persistence';
import {DESIGN_TIMER_KEY,IDLE_LIMIT_MS,adoptLegacyTimer,copyTimer,designTimerKey,emptyTimer,formatTimer,loadTimer,noteActivity,pauseTimer,saveTimer,startTimer,timerElapsedMs,timerIdle} from '../../src/production/estimate/designTimer';

// The estimate config persists the same way the ornament and topo projects do: one schema-versioned
// localStorage record, merged over defaults and clamped, so nothing stored can break a quote.

const memoryStorage=()=>{const data=new Map<string,string>();return {data,getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v)},removeItem:(k:string)=>{data.delete(k)}}};

describe('estimate config defaults',()=>{
 const c=createDefaultEstimateConfig();
 it('carries Ben\'s prices, labelled for verification',()=>{
  const price=(id:string)=>{const s=c.stock.find(x=>x.id===id)!;return s.packPrice/s.packQty};
  expect(price('mdf-12x20')).toBeCloseTo(26/12,9);
  expect(price('mdf-18x38')).toBe(6.5);
  expect(price('mdf-20x48')).toBe(9.5);
  expect(price('mdf-birch-24x36')).toBeCloseTo(110/6,9);
  expect(price('birch-18x36')).toBe(12.45);
  expect(price('birch-20x48')).toBe(19);
  expect(price('truflat-12x19')).toBe(5.25);
  expect(c.stock.find(x=>x.id==='truflat-12x19')).toMatchObject({widthIn:12,heightIn:19});
  expect(c.stock.every(s=>/from Ben's notes, verify/.test(s.note??''))).toBe(true);
  expect(c.rates).toEqual({designPerHour:25,designHours:0,suppliesPct:10});
  expect(c.strokedLines).toBe('engrave');
  expect(c.materials.find(m=>m.id==='mdf-1-8')!.thicknessMm).toBe(3.175);
 });

 it('three machines, all on Ben\'s settings; the Thunder\'s 3 x 5 ft bed known, the others not',()=>{
  expect(c.machines.map(m=>`${m.name} (${m.location}) $${m.hourlyRate}/h`)).toEqual(['xTool P2S 55W CO2 (Home) $25/h','OMTech (Sterlings) $25/h','Thunder (Sterlings) $25/h']);
  for(const m of c.machines)for(const s of m.settings){
   expect(s).toMatchObject({cutSpeedMmS:50,cutPowerPct:70,cutPasses:1,engraveSpeedMmS:400});
   expect(s.lineIntervalMm).toBeCloseTo(10/300,12);
   expect([...s.placeholder].sort()).toEqual(['engravePowerPct','scorePowerPct','scoreSpeedMmS']);
  }
  expect(c.machines.map(m=>[m.bedWidthMm,m.bedHeightMm,m.bedPlaceholder])).toEqual([[600,308,true],[711,508,true],[1524,914.4,false]]);
  expect(c.lineIntervalUnit).toBe('lpcm');
  expect(PLACEHOLDER_LABEL).toBe('PLACEHOLDER - calibrate');
 });

 it('line interval converts between xTool\'s lines/cm, DPI and mm',()=>{
  expect(lineIntervalToUnit(10/300,'lpcm')).toBeCloseTo(300,9);
  expect(lineIntervalToUnit(10/300,'lpi')).toBeCloseTo(762,9);
  expect(lineIntervalToUnit(.1,'mm')).toBe(.1);
  expect(lineIntervalFromUnit(254,'lpi')).toBeCloseTo(.1,12);
  expect(lineIntervalFromUnit(100,'lpcm')).toBeCloseTo(.1,12);
 });

 it('recipes: hand-made TruFlat border, TruFlat top, MDF; 12x18 has six MDF; birch tops on the big sizes',()=>{
  const slots=(id:string)=>c.recipes.find(r=>r.id===id)!.slots.map(s=>`${s.kind}:${s.count}${s.upTo?'+':''}${s.manual?'(hand)':''}:${s.materialId}`);
  for(const id of ['8x10','10x10','12x12','11x14'])expect(slots(id)).toEqual(['border:1(hand):truflat','layer:1:truflat','layer:4:mdf-1-8']);
  expect(slots('12x18')).toEqual(['border:1(hand):truflat','layer:1:truflat','layer:6:mdf-1-8']);
  expect(slots('18x24')).toEqual(['layer:1:birch','layer:7+:mdf-1-8']);
  expect(slots('24x36')).toEqual(['layer:1:birch','layer:5:mdf-1-8']);
  expect(Object.fromEntries(c.recipes.map(r=>[r.id,r.machineId]))).toEqual({'8x10':'xtool-p2s-55w','10x10':'xtool-p2s-55w','12x12':'xtool-p2s-55w','11x14':'xtool-p2s-55w','12x18':'xtool-p2s-55w','18x24':'omtech-sterlings','24x36':'thunder-sterlings'});
  expect(c.recipes.every(r=>r.frameCost===null)).toBe(true);
 });
});

describe('estimate config persistence',()=>{
 it('round-trips edits: prices, a recipe change, a machine\'s settings and calibration',()=>{
  const storage=memoryStorage(),c=createDefaultEstimateConfig();
  const edited={
   ...c,
   strokedLines:'score' as const,
   stock:c.stock.map(s=>s.id==='mdf-18x38'?{...s,packPrice:7.25}:s),
   recipes:c.recipes.map(r=>r.id==='24x36'?{...r,machineId:'omtech-sterlings',slots:[{kind:'layer' as const,materialId:'mdf-1-8',count:6},{kind:'layer' as const,materialId:'birch',count:1,note:'back'}],frameCost:42}:r),
   machines:c.machines.map(m=>m.id==='thunder-sterlings'?{...m,name:'Thunder Nova 51',hourlyRate:35,travelMultiplier:1.45,bedPlaceholder:false,settings:m.settings.map(s=>s.materialId==='mdf-1-8'?{...s,lineIntervalMm:.08,placeholder:s.placeholder.filter(f=>f!=='lineIntervalMm')}:s)}:m),
   calibration:[{id:'cal-1',recordedAt:'2026-10-14T12:00:00Z',label:'Job',machineId:'xtool-p2s-55w',estimatedMotionMin:30,estimatedOverheadMin:12,multiplierAtTime:1.3,actualMin:55}],
  };
  saveEstimateConfig(edited,storage);
  expect(storage.data.has(ESTIMATE_STORAGE_KEY)).toBe(true);
  expect(loadEstimateConfig(storage)).toEqual(edited);
 });

 it('loads the shape deployed on 2026-10-14: one machine, a laser rate, boolean placeholders',()=>{
  const legacy={schemaVersion:1,machine:{id:'xtool-p2s-55w',name:'xTool P2S 55W CO2',bedWidthMm:600,bedHeightMm:308,bedPlaceholder:true,perPieceOverheadMin:3,travelMultiplier:1.5,settings:[{materialId:'mdf-1-8',cutSpeedMmS:18,cutPowerPct:100,cutPasses:1,scoreSpeedMmS:100,scorePowerPct:20,engraveSpeedMmS:300,engravePowerPct:30,lineIntervalMm:.1,placeholder:false},{materialId:'truflat',cutSpeedMmS:15,cutPowerPct:100,cutPasses:1,scoreSpeedMmS:100,scorePowerPct:20,engraveSpeedMmS:300,engravePowerPct:30,lineIntervalMm:.1,placeholder:true}]},rates:{laserPerHour:30,designPerHour:25,designHours:.5,suppliesPct:10},calibration:[{id:'old',recordedAt:'x',label:'Old job',estimatedMotionMin:10,estimatedOverheadMin:5,multiplierAtTime:1.3,actualMin:20}]};
  const c=clampEstimateConfig(legacy);
  expect(c.machines.map(m=>m.id)).toEqual(['xtool-p2s-55w','omtech-sterlings','thunder-sterlings']);
  const p2s=c.machines[0];
  expect(p2s).toMatchObject({hourlyRate:30,travelMultiplier:1.5,location:'Home'});
  expect(p2s.settings.find(s=>s.materialId==='mdf-1-8')).toMatchObject({cutSpeedMmS:18,placeholder:[]});
  expect(p2s.settings.find(s=>s.materialId==='truflat')!.placeholder).toEqual([...SETTING_FIELDS]);
  // A material the old record had no row for gets one, fully unverified.
  expect(p2s.settings.find(s=>s.materialId==='birch')!.placeholder).toEqual([...SETTING_FIELDS]);
  expect(c.rates).toEqual({designPerHour:25,designHours:.5,suppliesPct:10});
  expect(c.calibration[0].machineId).toBe('xtool-p2s-55w');
  // Saved before machines listed their guesses: a value still at the studio's default is one, a
  // changed one (the 1.5 multiplier) is Ben's.
  expect(p2s.guessed).toEqual(['perPieceOverheadMin']);
  expect(c.machines[1].guessed).toEqual(['travelMultiplier','perPieceOverheadMin']);
 });

 it('a stock choice naming removed stock, or stock of another material, loads as auto',()=>{
  const c=createDefaultEstimateConfig();
  const loaded=clampEstimateConfig({...c,stock:c.stock.filter(s=>s.id!=='mdf-20x48'),stockSelection:{'mdf-1-8':'mdf-20x48',birch:'mdf-12x20',truflat:'truflat-12x19'}});
  expect(loaded.stockSelection).toEqual({'mdf-1-8':'auto',birch:'auto',truflat:'truflat-12x19'});
 });

 it('nothing stored, unparseable JSON or another schema version all load the defaults',()=>{
  const storage=memoryStorage();
  expect(loadEstimateConfig(storage)).toEqual(createDefaultEstimateConfig());
  storage.setItem(ESTIMATE_STORAGE_KEY,'{not json');
  expect(loadEstimateConfig(storage)).toEqual(createDefaultEstimateConfig());
  storage.setItem(ESTIMATE_STORAGE_KEY,JSON.stringify({schemaVersion:2,rates:{designPerHour:99}}));
  expect(loadEstimateConfig(storage).rates.designPerHour).toBe(25);
 });

 it('clamps a hand-edited record instead of letting NaN or nonsense into a quote',()=>{
  const c=clampEstimateConfig({
   schemaVersion:1,
   rates:{designPerHour:'lots',suppliesPct:1e9},
   machines:[{id:'xtool-p2s-55w',hourlyRate:-5,travelMultiplier:0,settings:[{materialId:'mdf-1-8',cutSpeedMmS:0,cutPasses:2.6,lineIntervalMm:'x',placeholder:['lineIntervalMm','bogus']}]},{name:'no id'}],
   defaultMachineId:'gone',
   strokedLines:'laser',
   stock:[{id:'half',name:'Half sized',materialIds:['mdf-1-8'],widthIn:12,heightIn:null,packPrice:5,packQty:0},{name:'no id'}],
   recipes:[{id:'r',widthIn:11,heightIn:14,machineId:7,slots:[{kind:'weird',materialId:'mdf-1-8',count:-3,manual:'yes'},{count:2}]}],
   calibration:[{id:'bad',actualMin:-4},{id:'ok',actualMin:12,estimatedMotionMin:5}],
  });
  expect(c.rates.designPerHour).toBe(25);
  expect(c.rates.suppliesPct).toBe(500);
  expect(c.machines).toHaveLength(1);
  expect(c.defaultMachineId).toBe('xtool-p2s-55w');
  expect(c.strokedLines).toBe('engrave');
  const p2s=c.machines[0];
  expect(p2s.hourlyRate).toBe(0);
  expect(p2s.travelMultiplier).toBe(.1);
  const mdf=p2s.settings.find(s=>s.materialId==='mdf-1-8')!;
  expect(mdf).toMatchObject({cutSpeedMmS:.1,cutPasses:3,lineIntervalMm:.1,placeholder:['lineIntervalMm']});
  expect(p2s.settings.map(s=>s.materialId).sort()).toEqual(['birch','mdf-1-8','truflat']);
  expect(c.stock).toEqual([{id:'half',name:'Half sized',materialIds:['mdf-1-8'],widthIn:null,heightIn:null,packPrice:5,packQty:1}]);
  expect(c.recipes[0].slots).toEqual([{kind:'layer',materialId:'mdf-1-8',count:0}]);
  expect(c.recipes[0].machineId).toBeUndefined();
  expect(c.calibration.map(e=>[e.id,e.machineId])).toEqual([['ok','xtool-p2s-55w']]);
 });

 it('survives storage that throws (private mode, quota)',()=>{
  const throwing={getItem:()=>{throw new Error('denied')},setItem:()=>{throw new Error('quota')},removeItem:()=>{}};
  expect(loadEstimateConfig(throwing)).toEqual(createDefaultEstimateConfig());
  expect(()=>saveEstimateConfig(createDefaultEstimateConfig(),throwing)).not.toThrow();
 });
});

describe('design timer',()=>{
 const MIN=60_000;
 it('counts time between activity while running, nothing while paused',()=>{
  let t=startTimer(emptyTimer(),0);
  t=noteActivity(t,5*MIN);
  t=noteActivity(t,12*MIN);
  expect(timerElapsedMs(t,12*MIN)).toBe(12*MIN);
  t=pauseTimer(t,14*MIN);
  expect(t.accumulatedMs).toBe(14*MIN);
  expect(timerElapsedMs(t,60*MIN)).toBe(14*MIN);
  expect(noteActivity(t,70*MIN)).toBe(t);
 });

 it('does not bill a gap longer than the idle limit, and resumes counting at the next activity',()=>{
  let t=startTimer(emptyTimer(),0);
  t=noteActivity(t,8*MIN);
  // Away for an hour: shown as idle, and that hour never counts.
  expect(timerIdle(t,8*MIN+IDLE_LIMIT_MS+1)).toBe(true);
  expect(timerElapsedMs(t,68*MIN)).toBe(8*MIN);
  t=noteActivity(t,68*MIN);
  t=noteActivity(t,71*MIN);
  expect(timerElapsedMs(t,71*MIN)).toBe(11*MIN);
 });

 it('persists per project, including a running timer across a reload',()=>{
  const storage=memoryStorage();
  const t=noteActivity(startTimer(emptyTimer(),1000),61000);
  saveTimer(t,'lake-a',storage);
  expect(storage.data.has(designTimerKey('lake-a'))).toBe(true);
  expect(loadTimer('lake-a',storage)).toEqual(t);
  // Another project's timer is its own, starting at zero.
  expect(loadTimer('lake-b',storage)).toEqual(emptyTimer());
  storage.setItem(designTimerKey('lake-a'),JSON.stringify({running:true,accumulatedMs:-5,lastActivity:'x'}));
  expect(loadTimer('lake-a',storage)).toEqual(emptyTimer());
  expect(formatTimer(3*3600_000+4*60_000+5000)).toBe('3:04:05');
 });

 it('saving a session under a new id carries its time; the old global timer goes to one project, once',()=>{
  const storage=memoryStorage();
  const t=pauseTimer(startTimer(emptyTimer(),0),25*60_000);
  saveTimer(t,'unsaved-x',storage);
  copyTimer('unsaved-x','lake-saved',storage);
  expect(loadTimer('lake-saved',storage)).toEqual(t);
  // The first version's single timer, still in storage after the update.
  storage.setItem(DESIGN_TIMER_KEY,JSON.stringify({running:false,accumulatedMs:40*60_000,lastActivity:null}));
  adoptLegacyTimer('lake-restored',storage);
  expect(loadTimer('lake-restored',storage).accumulatedMs).toBe(40*60_000);
  expect(storage.data.has(DESIGN_TIMER_KEY)).toBe(false);
  adoptLegacyTimer('lake-other',storage);
  expect(loadTimer('lake-other',storage)).toEqual(emptyTimer());
  // A project that already has its own timer keeps it.
  storage.setItem(DESIGN_TIMER_KEY,JSON.stringify({running:false,accumulatedMs:5,lastActivity:null}));
  adoptLegacyTimer('lake-saved',storage);
  expect(loadTimer('lake-saved',storage)).toEqual(t);
 });
});
