import {rectPathData} from '../geometry/pathData';
import {pieceMetrics,type JobPiece,type PieceMetrics,type ProductionJob} from '../job';
import {MACHINE_GUESS_LABELS,MM_PER_IN,SETTING_LABELS,type EstimateConfig,type LayerRecipe,type MachineProfile,type MaterialSettings,type SettingField,type StockItem} from './config';
import {fitsBed,piecesPerSheet} from './fit';

// The material, machine-time and cost estimate for one production job. Pure: a job and a config in,
// an Estimate out, so it re-runs on every settings edit without touching the scene, and the same
// numbers back the sidebar panel, the quote sheet and the JSON export.

// A piece with the material it is cut from, after the size's layer recipe has been applied. manual
// pieces are made by hand: bought, not lasered.
export type AssignedPiece={piece:JobPiece;materialId:string;manual?:boolean;note?:string};

export type PieceMinutes={cut:number;score:number;engrave:number;motion:number;overhead:number;total:number};

export type EstimatePiece={
 id:string;name:string;role:JobPiece['role'];manual:boolean;
 materialId:string;materialName:string;thicknessMm:number;
 widthMm:number;heightMm:number;
 cutLengthMm:number;scoreLengthMm:number;engraveAreaMm2:number;
 stockId:string|null;stockName:string|null;piecesPerSheet:number;sheetFraction:number;
 fitsStock:boolean;fitsBed:boolean;
 minutes:PieceMinutes;
};

export type MaterialLine={materialId:string;materialName:string;pieces:number;stockId:string|null;stockName:string|null;piecesPerSheet:number;sheets:number;sheetPrice:number;cost:number;unplaced:number};

// placeholder: an input the time depends on (a speed, the line interval, the machine's travel
// multiplier or overhead) is still a default or a guess.
// uncalibrated: every such input was entered, but the multiplier in use has not been checked against
// a real job recorded after it was set.
// calibrated: jobs recorded at the multiplier in use, after it was set, land within 10% of it.
export type TimeConfidence='placeholder'|'uncalibrated'|'calibrated';

// estimatedMin is what the estimate said the laser software would report: motion x the multiplier at
// the time, no overhead. checked: recorded at the multiplier now in use, after it was set.
export type CalibrationRow={id:string;label:string;recordedAt:string;estimatedMin:number;actualMin:number;ratio:number;checked:boolean};
export type CalibrationSummary={machineId:string;entries:number;meanRatio:number|null;suggestedMultiplier:number|null;checkedEntries:number;calibrated:boolean;rows:CalibrationRow[]};

export type DesignTime={hours:number;source:'timer'|'default'};

export type Estimate={
 recipe:{id:string;label:string}|null;
 machine:{id:string;name:string;location:string;hourlyRate:number;chosenBy:'recipe'|'bed fit'|'default'};
 widthMm:number;heightMm:number;
 strokedLines:EstimateConfig['strokedLines'];
 pieces:EstimatePiece[];
 materials:MaterialLine[];
 design:DesignTime;
 totals:{motionMin:number;overheadMin:number;machineMin:number;machineHours:number;materialCost:number;suppliesCost:number;laserCost:number;designCost:number;frameCost:number|null;suggestedTotal:number};
 timeConfidence:TimeConfidence;
 // The unverified inputs this job's time depends on, e.g. "line interval (TruFlat ...)".
 placeholderInputs:string[];
 calibration:CalibrationSummary;
 warnings:string[];
};

const IN_TOLERANCE=.06;
const inches=(mm:number)=>mm/MM_PER_IN;
const fmtIn=(mm:number)=>`${+inches(mm).toFixed(2)}`;

// The recipe for a product size, matched in either orientation (14x11 is an 11x14 board).
export function matchRecipe(widthMm:number,heightMm:number,recipes:LayerRecipe[]):LayerRecipe|undefined{
 const w=inches(widthMm),h=inches(heightMm);
 return recipes.find(r=>(Math.abs(r.widthIn-w)<=IN_TOLERANCE&&Math.abs(r.heightIn-h)<=IN_TOLERANCE)||(Math.abs(r.widthIn-h)<=IN_TOLERANCE&&Math.abs(r.heightIn-w)<=IN_TOLERANCE));
}

// The laser a job runs on: the one its size's recipe names, else the smallest bed the board fits on,
// else the default machine (whose bed the estimate then reports as too small).
export function machineFor(widthMm:number,heightMm:number,recipe:LayerRecipe|undefined,config:EstimateConfig):{machine:MachineProfile;chosenBy:Estimate['machine']['chosenBy']}{
 const named=recipe?.machineId?config.machines.find(m=>m.id===recipe.machineId):undefined;
 if(named)return {machine:named,chosenBy:'recipe'};
 const fitting=config.machines.filter(m=>fitsBed(widthMm,heightMm,m.bedWidthMm,m.bedHeightMm)).sort((a,b)=>a.bedWidthMm*a.bedHeightMm-b.bedWidthMm*b.bedHeightMm);
 if(fitting[0])return {machine:fitting[0],chosenBy:'bed fit'};
 return {machine:config.machines.find(m=>m.id===config.defaultMachineId)??config.machines[0],chosenBy:'default'};
}

// The border piece a recipe adds: the product rectangle with a window borderWidth in from each edge.
export function borderPiece(id:string,widthMm:number,heightMm:number,borderWidthMm:number):JobPiece{
 const inset=Math.min(borderWidthMm,widthMm/2-1,heightMm/2-1);
 const shapes=[{id:`${id}-outer`,d:rectPathData(0,0,widthMm,heightMm),operation:'cut' as const,outline:true}];
 if(inset>0)shapes.push({id:`${id}-window`,d:rectPathData(inset,inset,widthMm-2*inset,heightMm-2*inset),operation:'cut' as const,outline:true});
 return {id,name:'Border',role:'border',widthMm,heightMm,shapes};
}

const materialName=(config:EstimateConfig,id:string)=>config.materials.find(m=>m.id===id)?.name??id;

// Applies a layer recipe to the job's pieces: border slots become extra pieces, layer slots are
// handed to the scene's layers top-down. The scene is what gets cut, so its layer count wins; a
// recipe that lists a different count is reported, never silently "corrected".
export function assignMaterials(job:ProductionJob,recipe:LayerRecipe|undefined,config:EstimateConfig):{pieces:AssignedPiece[];warnings:string[]}{
 const warnings:string[]=[];
 const layers=job.pieces.filter(p=>p.role==='layer'),extras=job.pieces.filter(p=>p.role!=='layer');
 if(!recipe){
  const fallback=config.materials[0]?.id??'material';
  warnings.push(`No layer recipe for ${fmtIn(job.widthMm)} x ${fmtIn(job.heightMm)} in. Every layer is estimated as ${materialName(config,fallback)}; add a recipe for this size in the estimate settings.`);
  return {pieces:[...extras.map(piece=>({piece,materialId:fallback})),...layers.map(piece=>({piece,materialId:fallback}))],warnings};
 }
 const pieces:AssignedPiece[]=extras.map(piece=>({piece,materialId:config.materials[0]?.id??'material'}));
 const layerSlots:{materialId:string;note?:string;manual?:boolean}[]=[];
 let borderIndex=0;
 for(const slot of recipe.slots){
  const extra={...(slot.note?{note:slot.note}:{}),...(slot.manual?{manual:true}:{})};
  if(slot.kind==='border'){for(let k=0;k<slot.count;k++){const piece=borderPiece(`border-${++borderIndex}`,job.widthMm,job.heightMm,config.borderWidthMm);pieces.push({piece:slot.manual?{...piece,name:'Border (by hand)'}:piece,materialId:slot.materialId,...extra})}}
  else for(let k=0;k<slot.count;k++)layerSlots.push({materialId:slot.materialId,...extra});
 }
 const lastLayerSlot=[...recipe.slots].reverse().find(s=>s.kind==='layer');
 layers.forEach((piece,index)=>{
  const slot=layerSlots[index]??{materialId:lastLayerSlot?.materialId??config.materials[0]?.id??'material'};
  pieces.push({piece,materialId:slot.materialId,...(slot.note?{note:slot.note}:{}),...(slot.manual?{manual:true}:{})});
 });
 const listed=recipe.slots.filter(s=>s.kind==='layer').map(s=>`${s.upTo?'up to ':''}${s.count} ${materialName(config,s.materialId)}`).join(' + ');
 const hasUpTo=recipe.slots.some(s=>s.kind==='layer'&&s.upTo);
 if(layers.length>layerSlots.length)warnings.push(`Recipe ${recipe.label} lists ${layerSlots.length} layers (${listed}); this scene cuts ${layers.length}. The extra ${layers.length-layerSlots.length} are estimated as ${materialName(config,lastLayerSlot?.materialId??'')}.`);
 else if(layers.length<layerSlots.length&&!hasUpTo)warnings.push(`Recipe ${recipe.label} lists ${layerSlots.length} layers (${listed}); this scene cuts ${layers.length}. Estimating the scene's ${layers.length}.`);
 return {pieces,warnings};
}

export const settingsFor=(machine:MachineProfile,materialId:string):MaterialSettings=>machine.settings.find(s=>s.materialId===materialId)??{materialId,cutSpeedMmS:50,cutPowerPct:70,cutPasses:1,scoreSpeedMmS:100,scorePowerPct:20,engraveSpeedMmS:400,engravePowerPct:30,lineIntervalMm:.1,placeholder:['cutSpeedMmS','cutPowerPct','cutPasses','scoreSpeedMmS','scorePowerPct','engraveSpeedMmS','engravePowerPct','lineIntervalMm']};

// Machine minutes for one piece: cut length / cut speed (times passes) + score length / score speed
// + engrave area / (engrave speed x line interval), times the travel multiplier, plus the per-piece
// overhead. The multiplier scales motion only; setup time does not get longer with travel moves.
export function pieceMinutes(metrics:{cutLengthMm:number;scoreLengthMm:number;engraveAreaMm2:number},settings:MaterialSettings,travelMultiplier:number,overheadMin:number):PieceMinutes{
 const cut=metrics.cutLengthMm*settings.cutPasses/settings.cutSpeedMmS/60;
 const score=metrics.scoreLengthMm/settings.scoreSpeedMmS/60;
 const engrave=metrics.engraveAreaMm2/(settings.engraveSpeedMmS*settings.lineIntervalMm)/60;
 const motion=cut+score+engrave;
 return {cut,score,engrave,motion,overhead:overheadMin,total:motion*travelMultiplier+overheadMin};
}

// What the laser does on a piece once the shop's choice for stroked lines is applied: engraved
// roads join the engrave area (length x stroke width) and leave the score length.
export function laserWork(metrics:PieceMetrics,strokedLines:EstimateConfig['strokedLines']){
 return strokedLines==='engrave'
  ?{cutLengthMm:metrics.cutLengthMm,scoreLengthMm:0,engraveAreaMm2:metrics.engraveAreaMm2+metrics.scoreAreaMm2}
  :{cutLengthMm:metrics.cutLengthMm,scoreLengthMm:metrics.scoreLengthMm,engraveAreaMm2:metrics.engraveAreaMm2};
}

// The settings fields a piece's time actually depends on.
const fieldsUsed=(work:{cutLengthMm:number;scoreLengthMm:number;engraveAreaMm2:number}):SettingField[]=>[
 ...(work.cutLengthMm>0?['cutSpeedMmS','cutPasses'] as const:[]),
 ...(work.scoreLengthMm>0?['scoreSpeedMmS'] as const:[]),
 ...(work.engraveAreaMm2>0?['engraveSpeedMmS','lineIntervalMm'] as const:[]),
];

type StockChoice={stock:StockItem|null;perSheet:number;sheets:number;sheetPrice:number;cost:number};

// The stock item chosen for a material, when the choice still names stock of that material. A
// choice left pointing at removed stock, or at stock no longer listed for the material, is 'auto':
// before, it matched nothing and the material silently cost $0.
export function selectedStockId(config:EstimateConfig,materialId:string):string|undefined{
 const selected=config.stockSelection[materialId];
 return selected&&selected!=='auto'&&config.stock.some(s=>s.id===selected&&s.materialIds.includes(materialId))?selected:undefined;
}

function chooseStock(config:EstimateConfig,materialId:string,widthMm:number,heightMm:number,count:number):StockChoice{
 const candidates=config.stock.filter(s=>s.materialIds.includes(materialId));
 const selected=selectedStockId(config,materialId);
 const pool=selected?candidates.filter(s=>s.id===selected):candidates;
 let best:StockChoice={stock:null,perSheet:0,sheets:0,sheetPrice:0,cost:0};
 for(const stock of pool){
  const perSheet=stock.widthIn===null||stock.heightIn===null?1:piecesPerSheet(widthMm,heightMm,stock.widthIn*MM_PER_IN,stock.heightIn*MM_PER_IN,config.sheetMarginMm,config.pieceSpacingMm);
  if(perSheet<1)continue;
  const sheetPrice=stock.packPrice/Math.max(1,stock.packQty);
  const sheets=config.chargeWholeSheets?Math.ceil(count/perSheet):count/perSheet;
  const cost=sheets*sheetPrice;
  if(!best.stock||cost<best.cost-1e-9||(Math.abs(cost-best.cost)<=1e-9&&perSheet>best.perSheet))best={stock,perSheet,sheets,sheetPrice,cost};
 }
 return best;
}

export const CALIBRATION_TOLERANCE=.1;

// Calibration is per machine: a multiplier tuned on the P2S says nothing about the Thunder.
//
// The time Ben records is the job time the laser software (xTool Studio) reported. That is the
// laser's own run: it leaves out the setup and material changes between pieces. So it is compared
// with motion x multiplier, and the multiplier that would have made a job exact is actual / motion.
// Overhead stays out of calibration entirely (it used to be subtracted from the software's time,
// which never contained it, pulling the suggestion low by overhead / motion).
//
// One recorded job only suggests a multiplier. The time counts as calibrated once a multiplier is in
// use that was set on purpose (applied from here or typed), and the jobs recorded at it since then
// all land within 10% of what it predicts.
export function summarizeCalibration(config:EstimateConfig,machineId:string):CalibrationSummary{
 const machine=config.machines.find(m=>m.id===machineId);
 const entries=config.calibration.filter(e=>e.machineId===machineId);
 const settled=Boolean(machine)&&!machine!.guessed.includes('travelMultiplier');
 const checks=(e:EstimateConfig['calibration'][number])=>settled&&Math.abs(e.multiplierAtTime-machine!.travelMultiplier)<1e-9&&(!machine!.multiplierSetAt||e.recordedAt>machine!.multiplierSetAt);
 const rows=entries.map(e=>{const estimatedMin=e.estimatedMotionMin*e.multiplierAtTime;return{id:e.id,label:e.label,recordedAt:e.recordedAt,estimatedMin,actualMin:e.actualMin,ratio:estimatedMin>0?e.actualMin/estimatedMin:NaN,checked:checks(e)}});
 const ratios=rows.map(r=>r.ratio).filter(Number.isFinite);
 const implied=entries.filter(e=>e.estimatedMotionMin>0).map(e=>e.actualMin/e.estimatedMotionMin).filter(m=>Number.isFinite(m)&&m>0);
 const checked=rows.filter(r=>r.checked);
 return {
  machineId,entries:rows.length,rows,
  meanRatio:ratios.length?ratios.reduce((a,b)=>a+b,0)/ratios.length:null,
  suggestedMultiplier:implied.length?Math.min(10,Math.max(.1,implied.reduce((a,b)=>a+b,0)/implied.length)):null,
  checkedEntries:checked.length,
  calibrated:checked.length>0&&checked.every(r=>Number.isFinite(r.ratio)&&Math.abs(r.ratio-1)<=CALIBRATION_TOLERANCE+1e-9),
 };
}

// One line under the calibration table saying where calibration stands and what to do next.
export function calibrationAdvice(summary:CalibrationSummary,machine:MachineProfile):string{
 const m=`x${+machine.travelMultiplier.toFixed(3)}`;
 if(!summary.entries)return `No jobs recorded on the ${machine.name} yet.`;
 if(summary.calibrated)return `Calibrated: ${summary.checkedEntries} job${summary.checkedEntries===1?'':'s'} recorded at ${m} landed within 10%.`;
 if(machine.guessed.includes('travelMultiplier'))return `The ${m} multiplier is a guess. Use the suggested one, then record another job to confirm it.`;
 if(!summary.checkedEntries)return `Record a job at ${m} to confirm it.`;
 return `Jobs recorded at ${m} are more than 10% off. Use the suggested multiplier, then record another job.`;
}

export function estimateJob(job:ProductionJob,config:EstimateConfig,design:DesignTime={hours:config.rates.designHours,source:'default'}):Estimate{
 const recipe=matchRecipe(job.widthMm,job.heightMm,config.recipes);
 const {machine,chosenBy}=machineFor(job.widthMm,job.heightMm,recipe,config);
 const {pieces:assigned,warnings}=assignMaterials(job,recipe,config);

 // Stock is chosen per material over all of its pieces at once, so pieces share sheets.
 const byMaterial=new Map<string,AssignedPiece[]>();
 for(const a of assigned)byMaterial.set(a.materialId,[...(byMaterial.get(a.materialId)??[]),a]);
 const choices=new Map<string,StockChoice>();
 const materials:MaterialLine[]=[];
 for(const [materialId,list] of byMaterial){
  const widthMm=Math.max(...list.map(a=>a.piece.widthMm)),heightMm=Math.max(...list.map(a=>a.piece.heightMm));
  const choice=chooseStock(config,materialId,widthMm,heightMm,list.length);
  choices.set(materialId,choice);
  const name=materialName(config,materialId);
  if(!choice.stock){
   const selected=selectedStockId(config,materialId);
   const which=selected?`the selected ${config.stock.find(s=>s.id===selected)?.name??selected}`:`any configured ${name} stock`;
   warnings.push(`${list.map(a=>a.piece.name).join(', ')} (${fmtIn(widthMm)} x ${fmtIn(heightMm)} in) will not fit on ${which}. Material cost excludes ${list.length===1?'it':'them'}.`);
  }
  materials.push({materialId,materialName:name,pieces:list.length,stockId:choice.stock?.id??null,stockName:choice.stock?.name??null,piecesPerSheet:choice.perSheet,sheets:choice.sheets,sheetPrice:choice.sheetPrice,cost:choice.cost,unplaced:choice.stock?0:list.length});
 }

 const placeholderInputs=new Set<string>();
 const noWork={cutLengthMm:0,scoreLengthMm:0,engraveAreaMm2:0};
 const pieces:EstimatePiece[]=assigned.map(({piece,materialId,manual})=>{
  const settings=settingsFor(machine,materialId),choice=choices.get(materialId)!;
  const material=config.materials.find(m=>m.id===materialId);
  const work=manual?noWork:laserWork(pieceMetrics(piece),config.strokedLines);
  if(!manual)for(const field of fieldsUsed(work))if(settings.placeholder.includes(field))placeholderInputs.add(`${SETTING_LABELS[field]} (${materialName(config,materialId)})`);
  return {
   id:piece.id,name:piece.name,role:piece.role,manual:Boolean(manual),materialId,materialName:materialName(config,materialId),thicknessMm:material?.thicknessMm??3.175,
   widthMm:piece.widthMm,heightMm:piece.heightMm,...work,
   stockId:choice.stock?.id??null,stockName:choice.stock?.name??null,piecesPerSheet:choice.perSheet,sheetFraction:choice.perSheet?1/choice.perSheet:0,
   fitsStock:Boolean(choice.stock),fitsBed:manual?true:fitsBed(piece.widthMm,piece.heightMm,machine.bedWidthMm,machine.bedHeightMm),
   minutes:manual?{cut:0,score:0,engrave:0,motion:0,overhead:0,total:0}:pieceMinutes(work,settings,machine.travelMultiplier,machine.perPieceOverheadMin),
  };
 });
 // The machine's own guesses feed every lasered piece's time.
 if(pieces.some(p=>!p.manual))for(const field of machine.guessed)placeholderInputs.add(`${MACHINE_GUESS_LABELS[field]} (${machine.name})`);
 const machineLabel=`${machine.name}${machine.location?` (${machine.location})`:''}`;
 const tooBig=pieces.filter(p=>!p.fitsBed);
 if(tooBig.length)warnings.push(`${tooBig.length===pieces.filter(p=>!p.manual).length?'Every piece':tooBig.map(p=>p.name).join(', ')} (${fmtIn(job.widthMm)} x ${fmtIn(job.heightMm)} in) is larger than the ${machineLabel} bed (${machine.bedWidthMm} x ${machine.bedHeightMm} mm${machine.bedPlaceholder?', not verified':''}).`);
 // The Sterlings machines' beds are stand-ins until their models are known; say so on every job sent there.
 if(machine.bedPlaceholder&&machine.id!==config.defaultMachineId&&!tooBig.length)warnings.push(`${machineLabel}: bed size not verified (${machine.bedWidthMm} x ${machine.bedHeightMm} mm assumed).`);

 const motionMin=pieces.reduce((s,p)=>s+p.minutes.motion,0),overheadMin=pieces.reduce((s,p)=>s+p.minutes.overhead,0);
 const machineMin=pieces.reduce((s,p)=>s+p.minutes.total,0),machineHours=machineMin/60;
 const materialCost=materials.reduce((s,m)=>s+m.cost,0);
 const suppliesCost=materialCost*config.rates.suppliesPct/100;
 const laserCost=machineHours*machine.hourlyRate;
 const designCost=design.hours*config.rates.designPerHour;
 const frameCost=recipe?.frameCost??null;
 const calibration=summarizeCalibration(config,machine.id);
 const timeConfidence:TimeConfidence=placeholderInputs.size?'placeholder':calibration.calibrated?'calibrated':'uncalibrated';
 return {
  recipe:recipe?{id:recipe.id,label:recipe.label}:null,
  machine:{id:machine.id,name:machine.name,location:machine.location,hourlyRate:machine.hourlyRate,chosenBy},
  widthMm:job.widthMm,heightMm:job.heightMm,
  strokedLines:config.strokedLines,
  pieces,materials,design,
  totals:{motionMin,overheadMin,machineMin,machineHours,materialCost,suppliesCost,laserCost,designCost,frameCost,suggestedTotal:materialCost+suppliesCost+laserCost+designCost+(frameCost??0)},
  timeConfidence,placeholderInputs:[...placeholderInputs],calibration,warnings,
 };
}

// Times are only ever shown at a precision the confidence supports: placeholder and uncalibrated
// estimates round to the nearest 5 minutes and say what they are.
export function formatMachineTime(minutes:number,confidence:TimeConfidence):string{
 if(minutes===0)return '-';
 const rounded=confidence==='calibrated'?Math.round(minutes):Math.max(5,Math.round(minutes/5)*5);
 const text=rounded>=60?`${Math.floor(rounded/60)} h ${String(rounded%60).padStart(2,'0')} min`:`${rounded} min`;
 return confidence==='calibrated'?text:`~${text}`;
}

export const confidenceLabel=(confidence:TimeConfidence)=>confidence==='placeholder'?'PLACEHOLDER inputs - not a real time':confidence==='uncalibrated'?'Uncalibrated - record a real job to check it':'Calibrated against recorded jobs';
