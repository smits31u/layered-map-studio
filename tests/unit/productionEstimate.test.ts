import {describe,expect,it} from 'vitest';
import {createDefaultEstimateConfig,MM_PER_IN,type EstimateConfig} from '../../src/production/estimate/config';
import {assignMaterials,estimateJob,formatMachineTime,machineFor,matchRecipe,pieceMinutes,summarizeCalibration} from '../../src/production/estimate/estimate';
import {calibrationEntryFrom,estimateJson,quoteSheetHtml} from '../../src/production/estimate/exports';
import {fitsBed,piecesPerSheet} from '../../src/production/estimate/fit';
import {rectPathData} from '../../src/production/geometry/pathData';
import {pieceMetrics,type JobPiece,type ProductionJob} from '../../src/production/job';

// Estimate math against hand-worked fixtures: sheet fit, machine choice, machine time, material
// cost, recipes and calibration. Every expected number below is worked out in the comment next to it.

const IN=MM_PER_IN;
// A plain board of the given size with a rectangular "lake" cut out of it, plus optional score and
// engrave paths: lengths and areas are exact.
const piece=(id:string,w:number,h:number,extra:JobPiece['shapes']=[]):JobPiece=>({id,name:id,role:'layer',widthMm:w,heightMm:h,shapes:[{id:`${id}-panel`,d:`${rectPathData(0,0,w,h)} ${rectPathData(w/4,h/4,w/2,h/2)}`,operation:'cut',outline:true},...extra]});
const job=(wIn:number,hIn:number,layers:number,topExtra:JobPiece['shapes']=[]):ProductionJob=>{const w=wIn*IN,h=hIn*IN;return {product:'test',widthMm:w,heightMm:h,pieces:Array.from({length:layers},(_,i)=>piece(i===0?'layer-land':i===layers-1?'layer-base':`layer-depth-${i+1}`,w,h,i===0?topExtra:[]))}};
const testConfig=(patch:Partial<EstimateConfig>={}):EstimateConfig=>({...createDefaultEstimateConfig(),sheetMarginMm:3,pieceSpacingMm:3,...patch});
// A road 50mm long, 0.45mm wide, and a 5 x 4 mm engraved glyph.
const road={id:'road',d:'M0 0 L30 40',operation:'score' as const,strokeWidthMm:.45};
const glyph={id:'glyph',d:rectPathData(0,0,5,4),operation:'engrave' as const,transform:'translate(10 10) rotate(30)'};

describe('sheet fit (bounding-box grid)',()=>{
 it('11x14 on a 12x20 sheet: one piece',()=>{
  expect(piecesPerSheet(11*IN,14*IN,12*IN,20*IN,3,3)).toBe(1);
 });
 it('8x10 on a 24x36 sheet: 8, found by turning the pieces',()=>{
  // usable 603.6 x 908.4. Upright: floor(606.6/206.2)=2 x floor(911.4/257)=3 = 6.
  // Turned: floor(606.6/257)=2 x floor(911.4/206.2)=4 = 8.
  expect(piecesPerSheet(8*IN,10*IN,24*IN,36*IN,3,3)).toBe(8);
 });
 it('a piece exactly the sheet size fits with no margin and not with one',()=>{
  expect(piecesPerSheet(24*IN,36*IN,24*IN,36*IN,0,2)).toBe(1);
  expect(piecesPerSheet(24*IN,36*IN,24*IN,36*IN,3,2)).toBe(0);
 });
 it('TruFlat 12x19: one 11x14 or 12x18 top per sheet, two 8x10 tops',()=>{
  expect(piecesPerSheet(11*IN,14*IN,12*IN,19*IN,0,2)).toBe(1);
  expect(piecesPerSheet(12*IN,18*IN,12*IN,19*IN,0,2)).toBe(1);
  // Turned: 10 across 12 (1), 8 down 19: floor((482.6+2)/(203.2+2))=2.
  expect(piecesPerSheet(8*IN,10*IN,12*IN,19*IN,0,2)).toBe(2);
 });
 it('machine beds: 11x14 and 12x18 fit the 600x308 P2S, 18x24 does not',()=>{
  expect(fitsBed(14*IN,11*IN,600,308)).toBe(true);
  expect(fitsBed(12*IN,18*IN,600,308)).toBe(true);
  expect(fitsBed(18*IN,24*IN,600,308)).toBe(false);
 });
});

describe('which machine',()=>{
 const config=createDefaultEstimateConfig();
 const pick=(wIn:number,hIn:number)=>{const r=matchRecipe(wIn*IN,hIn*IN,config.recipes);const {machine,chosenBy}=machineFor(wIn*IN,hIn*IN,r,config);return `${machine.id}/${chosenBy}`};
 it('follows Ben\'s split: up to 12x18 on the P2S, 18x24 on the OMTech, bigger on the Thunder',()=>{
  expect(pick(14,11)).toBe('xtool-p2s-55w/recipe');
  expect(pick(12,18)).toBe('xtool-p2s-55w/recipe');
  expect(pick(24,18)).toBe('omtech-sterlings/recipe');
  expect(pick(36,24)).toBe('thunder-sterlings/recipe');
 });
 it('a size with no recipe goes to the smallest bed it fits, and to the default when none fits',()=>{
  // 16x20 in = 406 x 508 mm: too big for the P2S (308), fits the OMTech (711 x 508).
  expect(pick(16,20)).toBe('omtech-sterlings/bed fit');
  expect(pick(40,60)).toBe('xtool-p2s-55w/default');
 });
});

describe('machine time',()=>{
 it('cut / speed x passes + score / speed + area / (speed x interval), x multiplier, + overhead',()=>{
  const settings={materialId:'m',cutSpeedMmS:10,cutPowerPct:100,cutPasses:2,scoreSpeedMmS:100,scorePowerPct:20,engraveSpeedMmS:300,engravePowerPct:30,lineIntervalMm:.1,placeholder:[]};
  const m=pieceMinutes({cutLengthMm:1000,scoreLengthMm:600,engraveAreaMm2:3000},settings,1.5,2);
  expect(m.cut).toBeCloseTo(1000*2/10/60,9);// 200 s
  expect(m.score).toBeCloseTo(6/60,9);// 6 s
  expect(m.engrave).toBeCloseTo(100/60,9);// 3000 / 30 = 100 s
  expect(m.motion).toBeCloseTo(306/60,9);
  expect(m.total).toBeCloseTo(306/60*1.5+2,9);
 });

 it('per-piece metrics come from the paths: cut perimeter, road length and width, engrave area',()=>{
  const m=pieceMetrics(piece('p',100,80,[road,glyph]));
  expect(m.cutLengthMm).toBeCloseTo(360+180,6);// board 2x(100+80) + opening 2x(50+40)
  expect(m.scoreLengthMm).toBeCloseTo(50,6);
  expect(m.scoreAreaMm2).toBeCloseTo(50*.45,6);
  expect(m.engraveAreaMm2).toBeCloseTo(20,6);
 });

 it('roads are engraved by default (area joins the engrave), or scored when set',()=>{
  const engraved=estimateJob(job(14,11,5,[road,glyph]),testConfig()).pieces.find(p=>p.id==='layer-land')!;
  expect(engraved.scoreLengthMm).toBe(0);
  expect(engraved.engraveAreaMm2).toBeCloseTo(20+22.5,6);
  const scored=estimateJob(job(14,11,5,[road,glyph]),testConfig({strokedLines:'score'})).pieces.find(p=>p.id==='layer-land')!;
  expect(scored.scoreLengthMm).toBeCloseTo(50,6);
  expect(scored.engraveAreaMm2).toBeCloseTo(20,6);
 });

 it('uses Ben\'s P2S settings: 50 mm/s cut, 1 pass, 400 mm/s engrave',()=>{
  const e=estimateJob(job(14,11,5,[glyph]),testConfig());
  const base=e.pieces.find(p=>p.id==='layer-base')!;
  // 11x14 base with a 7x5.5 in opening: cut = 2(355.6+279.4) + 2(177.8+139.7) = 1905 mm at 50 mm/s.
  expect(base.minutes.cut).toBeCloseTo(1905/50/60,6);
  expect(base.minutes.total).toBeCloseTo(1905/50/60*1.3+3,6);
  const top=e.pieces.find(p=>p.id==='layer-land')!;
  expect(top.minutes.engrave).toBeCloseTo(20/(400*.1)/60,9);
 });

 it('says which unverified inputs the time depends on, and only those',()=>{
  // Cutting only: speed and passes are Ben's, so nothing on the P2S is a placeholder.
  const cutOnly=estimateJob(job(14,11,5),testConfig());
  expect(cutOnly.placeholderInputs).toEqual([]);
  expect(cutOnly.timeConfidence).toBe('uncalibrated');
  // Engraving the top needs the line interval, which is not known yet.
  const engraved=estimateJob(job(14,11,5,[glyph]),testConfig());
  expect(engraved.timeConfidence).toBe('placeholder');
  expect(engraved.placeholderInputs).toEqual(['line interval (TruFlat premium top (maple/cherry))']);
  // The OMTech's settings are all copied from the P2S and unverified.
  const omtech=estimateJob(job(24,18,5),testConfig());
  expect(omtech.placeholderInputs).toEqual(['cut speed (Birch ply)','cut passes (Birch ply)','cut speed (1/8" MDF)','cut passes (1/8" MDF)']);
 });

 it('is never shown more precisely than its confidence allows',()=>{
  expect(formatMachineTime(47.2,'placeholder')).toBe('~45 min');
  expect(formatMachineTime(83,'uncalibrated')).toBe('~1 h 25 min');
  expect(formatMachineTime(47.2,'calibrated')).toBe('47 min');
  expect(formatMachineTime(1,'placeholder')).toBe('~5 min');
  expect(formatMachineTime(0,'placeholder')).toBe('-');
 });
});

describe('layer recipes',()=>{
 const config=createDefaultEstimateConfig();
 it('matches a size in either orientation: the default 14x11 board is the 11x14 recipe',()=>{
  expect(matchRecipe(355.6,279.4,config.recipes)?.id).toBe('11x14');
  expect(matchRecipe(279.4,355.6,config.recipes)?.id).toBe('11x14');
  expect(matchRecipe(400,400,config.recipes)).toBeUndefined();
 });

 it('11x14: a hand-made TruFlat border, TruFlat top, then MDF down the stack',()=>{
  const {pieces,warnings}=assignMaterials(job(14,11,5),matchRecipe(14*IN,11*IN,config.recipes),config);
  expect(pieces.map(p=>`${p.piece.id}:${p.materialId}${p.manual?':hand':''}`)).toEqual(['border-1:truflat:hand','layer-land:truflat','layer-depth-2:mdf-1-8','layer-depth-3:mdf-1-8','layer-depth-4:mdf-1-8','layer-base:mdf-1-8']);
  expect(warnings).toEqual([]);
 });

 it('12x18: top plus six MDF; 18x24: birch on top',()=>{
  expect(assignMaterials(job(18,12,7),matchRecipe(18*IN,12*IN,config.recipes),config).warnings).toEqual([]);
  expect(assignMaterials(job(24,18,5),matchRecipe(24*IN,18*IN,config.recipes),config).pieces[0]).toMatchObject({materialId:'birch'});
 });

 it('reports a scene that cuts a different number of layers than the recipe lists',()=>{
  const fewer=assignMaterials(job(14,11,4),matchRecipe(14*IN,11*IN,config.recipes),config);
  expect(fewer.warnings[0]).toMatch(/Recipe 11x14 lists 5 layers .* this scene cuts 4/);
  const more=assignMaterials(job(14,11,7),matchRecipe(14*IN,11*IN,config.recipes),config);
  expect(more.warnings[0]).toMatch(/this scene cuts 7\. The extra 2 are estimated as 1\/8" MDF/);
  expect(more.pieces.at(-1)!.materialId).toBe('mdf-1-8');
 });

 it('"up to" counts are a maximum, not a mismatch',()=>{
  const {warnings}=assignMaterials(job(24,18,5),matchRecipe(24*IN,18*IN,config.recipes),config);
  expect(warnings).toEqual([]);
 });

 it('a size with no recipe is estimated in the first material and says so',()=>{
  const {pieces,warnings}=assignMaterials(job(16,16,3),undefined,config);
  expect(pieces.every(p=>p.materialId==='mdf-1-8')).toBe(true);
  expect(warnings[0]).toMatch(/No layer recipe for 16 x 16 in/);
 });
});

describe('cost',()=>{
 it('11x14, five layers: cheapest MDF sheet, TruFlat 12x19 sheets, the hand-made border costs material only',()=>{
  const e=estimateJob(job(14,11,5),testConfig());
  // MDF, 4 pieces of 11x14. 12x20 at $26/12 = $2.1667, 1 per sheet: 4 sheets = $8.67.
  // 20x48 at $9.50 holds 4 (turned, 1 x 4) = $9.50; 24x36 at $110/6 holds 4 = $18.33; 18x38 holds 3 = 2 sheets $13.
  const mdf=e.materials.find(m=>m.materialId==='mdf-1-8')!;
  expect(mdf.stockId).toBe('mdf-12x20');
  expect(mdf.sheets).toBe(4);
  expect(mdf.cost).toBeCloseTo(26/12*4,9);
  // TruFlat: border + top, one per 12x19 sheet at $5.25.
  const truflat=e.materials.find(m=>m.materialId==='truflat')!;
  expect(truflat.stockId).toBe('truflat-12x19');
  expect(truflat.cost).toBeCloseTo(10.5,9);
  const border=e.pieces.find(p=>p.role==='border')!;
  expect(border).toMatchObject({manual:true,name:'Border (by hand)',cutLengthMm:0});
  expect(border.minutes.total).toBe(0);
  expect(e.totals.materialCost).toBeCloseTo(26/12*4+10.5,9);
  expect(e.totals.suppliesCost).toBeCloseTo((26/12*4+10.5)*.1,9);
  expect(e.totals.laserCost).toBeCloseTo(e.totals.machineHours*25,9);
  expect(e.totals.suggestedTotal).toBeCloseTo(e.totals.materialCost+e.totals.suppliesCost+e.totals.laserCost,9);
  expect(e.machine).toMatchObject({id:'xtool-p2s-55w',chosenBy:'recipe'});
 });

 it('the laser rate is the machine\'s own',()=>{
  const base=testConfig();
  const config={...base,machines:base.machines.map(m=>m.id==='omtech-sterlings'?{...m,hourlyRate:40}:m)};
  const e=estimateJob(job(24,18,5),config);
  expect(e.machine.id).toBe('omtech-sterlings');
  expect(e.totals.laserCost).toBeCloseTo(e.totals.machineHours*40,9);
 });

 it('a selected stock size is used even when another is cheaper; fractional sheets when not charging whole ones',()=>{
  const e=estimateJob(job(14,11,5),testConfig({stockSelection:{'mdf-1-8':'mdf-20x48',truflat:'auto',birch:'auto'},chargeWholeSheets:false}));
  const mdf=e.materials.find(m=>m.materialId==='mdf-1-8')!;
  expect(mdf.stockId).toBe('mdf-20x48');
  expect(mdf.piecesPerSheet).toBe(4);
  expect(mdf.sheets).toBe(1);
  expect(e.pieces.find(p=>p.id==='layer-base')!.sheetFraction).toBe(.25);
 });

 it('flags a layer that fits no configured sheet, and leaves it out of material cost',()=>{
  const e=estimateJob(job(30,40,3),testConfig());
  expect(e.pieces.every(p=>!p.fitsStock)).toBe(true);
  expect(e.warnings.join(' ')).toMatch(/will not fit on any configured 1\/8" MDF stock/);
  expect(e.totals.materialCost).toBe(0);
 });

 it('flags pieces larger than every bed, on the default machine',()=>{
  const e=estimateJob(job(40,60,3),testConfig());
  expect(e.pieces.every(p=>!p.fitsBed)).toBe(true);
  expect(e.warnings.join(' ')).toMatch(/larger than the xTool P2S 55W CO2 \(Home\) bed \(600 x 308 mm, not verified\)/);
 });

 it('says the Sterlings machines\' beds are not verified',()=>{
  expect(estimateJob(job(24,18,5),testConfig()).warnings.join(' ')).toMatch(/OMTech \(Sterlings\): bed size not verified/);
 });

 it('adds the frame and design time; timed design replaces the default',()=>{
  const base=testConfig();
  const config=testConfig({rates:{...base.rates,designHours:.5},recipes:base.recipes.map(r=>r.id==='11x14'?{...r,frameCost:30}:r)});
  const e=estimateJob(job(14,11,5),config);
  expect(e.design).toEqual({hours:.5,source:'default'});
  expect(e.totals.designCost).toBeCloseTo(12.5,9);
  expect(e.totals.frameCost).toBe(30);
  expect(e.totals.suggestedTotal).toBeCloseTo(e.totals.materialCost+e.totals.suppliesCost+e.totals.laserCost+12.5+30,9);
  const timed=estimateJob(job(14,11,5),config,{hours:1.25,source:'timer'});
  expect(timed.totals.designCost).toBeCloseTo(31.25,9);
 });
});

describe('calibration',()=>{
 it('records estimate vs actual per machine and suggests the multiplier that makes it exact',()=>{
  let config=testConfig();
  const e=estimateJob(job(14,11,5),config);
  const {motionMin,overheadMin,machineMin}=e.totals;
  const p2s=config.machines.find(m=>m.id==='xtool-p2s-55w')!;
  // The laser software reported 20% more motion time than motion x the current multiplier.
  const actual=motionMin*p2s.travelMultiplier*1.2+overheadMin;
  config={...config,calibration:[calibrationEntryFrom(e,config,actual,'Mary Lake test cut',new Date('2026-10-14T12:00:00Z'))]};
  expect(config.calibration[0].machineId).toBe('xtool-p2s-55w');
  const summary=summarizeCalibration(config,'xtool-p2s-55w');
  expect(summary.entries).toBe(1);
  expect(summary.rows[0].estimatedMin).toBeCloseTo(machineMin,9);
  expect(summary.rows[0].ratio).toBeCloseTo(actual/machineMin,9);
  expect(summary.suggestedMultiplier).toBeCloseTo(p2s.travelMultiplier*1.2,9);
  // A P2S job says nothing about the OMTech.
  expect(summarizeCalibration(config,'omtech-sterlings').entries).toBe(0);
  const tuned={...config,machines:config.machines.map(m=>m.id===p2s.id?{...m,travelMultiplier:summary.suggestedMultiplier!}:m)};
  const after=estimateJob(job(14,11,5),tuned);
  expect(after.totals.machineMin).toBeCloseTo(actual,6);
  expect(after.timeConfidence).toBe('calibrated');
 });
});

describe('exports',()=>{
 const meta={product:'Lake depth map',title:'Mary Lake <MI>',generatedAt:'2026-10-14T12:00:00.000Z',appVersion:'0.1.0'};
 it('the JSON carries the schema, machine, totals, per-piece numbers and confidence',()=>{
  const config=testConfig(),e=estimateJob(job(14,11,5,[glyph]),config),json=estimateJson(e,config,meta);
  expect(json.schema).toBe('layered-map-studio.estimate/1');
  expect(json.timeConfidence).toBe('placeholder');
  expect(json.placeholderInputs).toEqual(['line interval (TruFlat premium top (maple/cherry))']);
  expect(json.machine).toMatchObject({id:'xtool-p2s-55w',hourlyRate:25});
  expect(json.pieces).toHaveLength(6);
  expect(json.pieces[0]).toMatchObject({role:'border',manual:true});
  expect(json.totals.suggestedTotal).toBeCloseTo(e.totals.suggestedTotal,2);
  expect(JSON.parse(JSON.stringify(json))).toEqual(json);
 });
 it('the quote sheet is a self-contained page that escapes text and flags unverified times',()=>{
  const config=testConfig(),html=quoteSheetHtml(estimateJob(job(14,11,5,[glyph]),config),config,meta);
  expect(html.startsWith('<!doctype html>')).toBe(true);
  expect(html).toContain('Mary Lake &lt;MI&gt;');
  expect(html).not.toContain('<MI>');
  expect(html).toContain('PLACEHOLDER inputs - not a real time');
  expect(html).toContain('Unverified: line interval');
  expect(html).toContain('xTool P2S 55W CO2 (Home)');
  expect(html).toContain('made by hand');
  expect(html).toContain('not customer-facing');
  expect(html).toMatch(/Suggested total<\/td><td class="n">\$\d+\.\d\d/);
  expect(html).not.toMatch(/<script|https?:\/\//);
 });
});
