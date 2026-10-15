import {createDefaultEstimateConfig,SETTING_FIELDS,type CalibrationEntry,type EstimateConfig,type LayerRecipe,type MachineProfile,type MaterialSettings,type MaterialType,type RecipeSlot,type SettingField,type StockItem} from './config';

// localStorage persistence, the same pattern as the ornament and topo projects (schema-versioned key,
// merged over a fresh default, clamped). The estimate config is not part of any one project: it is
// the shop's prices and machines, so every tool that shows an estimate shares this one record.
//
// A stored record is untrusted input. Every number is clamped, every list entry is checked field by
// field, and an entry that cannot be repaired is dropped rather than allowed to put NaN into a quote.
//
// The first deployed shape (2026-10-14) had a single `machine`, `rates.laserPerHour` and a boolean
// `placeholder` per settings row. It still loads: the machine becomes the first of the list with the
// laser rate as its hourly rate, the other default machines are added after it, and `placeholder:
// true` means every field is unverified.

export const ESTIMATE_STORAGE_KEY='layered-map-studio.estimate.v1';

type Storage={getItem(k:string):string|null;setItem(k:string,v:string):void;removeItem(k:string):void};

const defaultStorage=():Storage|undefined=>{
 try{return typeof localStorage==='undefined'?undefined:localStorage}catch{return undefined}
};

const obj=(v:unknown):Record<string,unknown>|undefined=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:undefined;
const str=(v:unknown,fallback:string)=>typeof v==='string'&&v.trim()?v:fallback;
const num=(v:unknown,fallback:number,min:number,max:number)=>typeof v==='number'&&Number.isFinite(v)?Math.min(max,Math.max(min,v)):fallback;
const bool=(v:unknown,fallback:boolean)=>typeof v==='boolean'?v:fallback;
const list=<T>(v:unknown,each:(item:Record<string,unknown>)=>T|undefined):T[]|undefined=>Array.isArray(v)?v.map(x=>{const o=obj(x);return o?each(o):undefined}).filter((x):x is T=>x!==undefined):undefined;
const optionalNum=(v:unknown,min:number,max:number)=>v===null?null:typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max?v:undefined;

const material=(o:Record<string,unknown>):MaterialType|undefined=>typeof o.id==='string'&&o.id?{id:o.id,name:str(o.name,o.id),thicknessMm:num(o.thicknessMm,3.175,.1,50),...(typeof o.note==='string'?{note:o.note}:{})}:undefined;

function stockItem(o:Record<string,unknown>):StockItem|undefined{
 if(typeof o.id!=='string'||!o.id)return undefined;
 const materialIds=Array.isArray(o.materialIds)?o.materialIds.filter((m):m is string=>typeof m==='string'):[];
 const widthIn=optionalNum(o.widthIn,.5,240),heightIn=optionalNum(o.heightIn,.5,240);
 // Either both dimensions or neither: half a size cannot be fitted against.
 const sized=typeof widthIn==='number'&&typeof heightIn==='number';
 return {id:o.id,name:str(o.name,o.id),materialIds,widthIn:sized?widthIn:null,heightIn:sized?heightIn:null,packPrice:num(o.packPrice,0,0,100000),packQty:Math.round(num(o.packQty,1,1,10000)),...(typeof o.note==='string'?{note:o.note}:{})};
}

const placeholderFields=(v:unknown):SettingField[]=>v===true?[...SETTING_FIELDS]:v===false?[]:Array.isArray(v)?SETTING_FIELDS.filter(f=>v.includes(f)):[...SETTING_FIELDS];

const settingsRow=(o:Record<string,unknown>):MaterialSettings|undefined=>typeof o.materialId==='string'?{
 materialId:o.materialId,
 cutSpeedMmS:num(o.cutSpeedMmS,50,.1,2000),cutPowerPct:num(o.cutPowerPct,70,0,100),cutPasses:Math.round(num(o.cutPasses,1,1,20)),
 scoreSpeedMmS:num(o.scoreSpeedMmS,100,.1,2000),scorePowerPct:num(o.scorePowerPct,20,0,100),
 engraveSpeedMmS:num(o.engraveSpeedMmS,400,.1,5000),engravePowerPct:num(o.engravePowerPct,30,0,100),lineIntervalMm:num(o.lineIntervalMm,.1,.001,5),
 placeholder:placeholderFields(o.placeholder),
}:undefined;

function machine(o:Record<string,unknown>,base:MachineProfile,laserPerHour?:unknown):MachineProfile|undefined{
 if(typeof o.id!=='string'||!o.id)return undefined;
 return {
  id:o.id,name:str(o.name,base.name),location:typeof o.location==='string'?o.location:base.location,
  bedWidthMm:num(o.bedWidthMm,base.bedWidthMm,10,5000),bedHeightMm:num(o.bedHeightMm,base.bedHeightMm,10,5000),
  bedPlaceholder:bool(o.bedPlaceholder,base.bedPlaceholder),
  hourlyRate:num(o.hourlyRate??laserPerHour,base.hourlyRate,0,10000),
  perPieceOverheadMin:num(o.perPieceOverheadMin,base.perPieceOverheadMin,0,600),
  travelMultiplier:num(o.travelMultiplier,base.travelMultiplier,.1,10),
  settings:list(o.settings,settingsRow)??base.settings,
 };
}

const slot=(o:Record<string,unknown>):RecipeSlot|undefined=>typeof o.materialId==='string'?{kind:o.kind==='border'?'border':'layer',materialId:o.materialId,count:Math.round(num(o.count,1,0,30)),...(o.upTo===true?{upTo:true}:{}),...(o.manual===true?{manual:true}:{}),...(typeof o.note==='string'?{note:o.note}:{})}:undefined;

function recipe(o:Record<string,unknown>):LayerRecipe|undefined{
 if(typeof o.id!=='string'||!o.id)return undefined;
 const frame=o.frameCost===null||o.frameCost===undefined?null:optionalNum(o.frameCost,0,100000);
 return {id:o.id,label:str(o.label,o.id),widthIn:num(o.widthIn,11,.5,240),heightIn:num(o.heightIn,14,.5,240),slots:list(o.slots,slot)??[],frameCost:frame??null,...(typeof o.machineId==='string'&&o.machineId?{machineId:o.machineId}:{})};
}

const calibrationEntry=(o:Record<string,unknown>,fallbackMachine:string):CalibrationEntry|undefined=>typeof o.id==='string'&&typeof o.actualMin==='number'&&o.actualMin>0?{
 id:o.id,recordedAt:str(o.recordedAt,''),label:str(o.label,'Past job'),machineId:str(o.machineId,fallbackMachine),
 estimatedMotionMin:num(o.estimatedMotionMin,0,0,100000),estimatedOverheadMin:num(o.estimatedOverheadMin,0,0,100000),
 multiplierAtTime:num(o.multiplierAtTime,1,.1,10),actualMin:num(o.actualMin,1,.01,100000),
}:undefined;

// Clamps any partial or hand-edited config into one the estimate can safely run on.
export function clampEstimateConfig(raw:unknown):EstimateConfig{
 const base=createDefaultEstimateConfig(),o=obj(raw)??{};
 const ratesIn=obj(o.rates)??{};
 const baseFor=(id:string)=>base.machines.find(m=>m.id===id)??base.machines[0];
 let machines=list(o.machines,m=>machine(m,baseFor(String(m.id))));
 const legacy=obj(o.machine);
 if(!machines&&legacy){
  const migrated=machine(legacy,baseFor(String(legacy.id)),ratesIn.laserPerHour);
  machines=migrated?[migrated,...base.machines.filter(m=>m.id!==migrated.id)]:undefined;
 }
 if(!machines?.length)machines=base.machines;
 const materials=list(o.materials,material);
 const config:EstimateConfig={
  schemaVersion:1,
  machines,
  defaultMachineId:typeof o.defaultMachineId==='string'&&machines.some(m=>m.id===o.defaultMachineId)?o.defaultMachineId:machines[0].id,
  materials:materials?.length?materials:base.materials,
  stock:list(o.stock,stockItem)??base.stock,
  stockSelection:{...base.stockSelection,...Object.fromEntries(Object.entries(obj(o.stockSelection)??{}).filter((e):e is [string,string]=>typeof e[1]==='string'))},
  recipes:list(o.recipes,recipe)??base.recipes,
  rates:{designPerHour:num(ratesIn.designPerHour,base.rates.designPerHour,0,10000),designHours:num(ratesIn.designHours,base.rates.designHours,0,1000),suppliesPct:num(ratesIn.suppliesPct,base.rates.suppliesPct,0,500)},
  strokedLines:o.strokedLines==='score'?'score':o.strokedLines==='engrave'?'engrave':base.strokedLines,
  sheetMarginMm:num(o.sheetMarginMm,base.sheetMarginMm,0,200),
  pieceSpacingMm:num(o.pieceSpacingMm,base.pieceSpacingMm,0,200),
  chargeWholeSheets:bool(o.chargeWholeSheets,base.chargeWholeSheets),
  borderWidthMm:num(o.borderWidthMm,base.borderWidthMm,1,500),
  calibration:[],
  lineIntervalUnit:o.lineIntervalUnit==='lpi'||o.lineIntervalUnit==='mm'||o.lineIntervalUnit==='lpcm'?o.lineIntervalUnit:base.lineIntervalUnit,
 };
 config.calibration=list(o.calibration,e=>calibrationEntry(e,config.defaultMachineId))??[];
 // Every material needs a settings row on every machine for the time estimate; a missing one gets
 // that machine's first row with every field marked unverified, so the estimate runs and says so.
 for(const m of config.machines)for(const mat of config.materials)if(!m.settings.some(s=>s.materialId===mat.id))m.settings.push({...(baseFor(m.id).settings.find(s=>s.materialId===mat.id)??m.settings[0]??baseFor(m.id).settings[0]),materialId:mat.id,placeholder:[...SETTING_FIELDS]});
 return config;
}

export function loadEstimateConfig(storage=defaultStorage()):EstimateConfig{
 if(!storage)return createDefaultEstimateConfig();
 let raw:string|null=null;
 try{raw=storage.getItem(ESTIMATE_STORAGE_KEY)}catch{return createDefaultEstimateConfig()}
 if(!raw)return createDefaultEstimateConfig();
 try{
  const parsed=JSON.parse(raw) as {schemaVersion?:unknown};
  if(!parsed||typeof parsed!=='object'||parsed.schemaVersion!==1)return createDefaultEstimateConfig();
  return clampEstimateConfig(parsed);
 }catch{return createDefaultEstimateConfig()}
}

export function saveEstimateConfig(config:EstimateConfig,storage=defaultStorage()):void{
 if(!storage)return;
 try{storage.setItem(ESTIMATE_STORAGE_KEY,JSON.stringify(config))}catch{/* quota or private mode: persistence is a convenience, not a guarantee */}
}

export function clearEstimateConfig(storage=defaultStorage()):void{
 if(!storage)return;
 try{storage.removeItem(ESTIMATE_STORAGE_KEY)}catch{/* see saveEstimateConfig */}
}
