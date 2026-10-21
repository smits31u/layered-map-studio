import {strFromU8,unzipSync} from 'fflate';
import {describe,expect,it} from 'vitest';
import {buildScene} from '../../src/export/buildScene';
import {individualSvgs,individualSvgsZip} from '../../src/export/svg/exportSvg';
import {lakeSceneToJob} from '../../src/production/adapters/lakeScene';
import {CALIBRATION_GATE_PCT,describeError,formatPercentError,percentError,withinGate} from '../../src/production/estimate/calibration';
import {createDefaultEstimateConfig,type EstimateConfig} from '../../src/production/estimate/config';
import {confidenceBadge,designTimeFrom,estimateJob,matchRecipe,summarizeCalibration} from '../../src/production/estimate/estimate';
import {ESTIMATE_JSON_SCHEMA,calibrationEntryFrom,estimateFilesFor,estimateSummaryFiles,estimateSummaryText,operationTotals} from '../../src/production/estimate/exports';
import {loadEstimateConfig} from '../../src/production/estimate/persistence';
import {rectPathData} from '../../src/production/geometry/pathData';
import type {ProductionJob} from '../../src/production/job';
import {caldronFallsFeatures,caldronFallsProject} from '../fixtures/caldronFalls';

// V2 Step 1 (A5): the calibration percent error and its 15% gate, the export summary, recipes
// limited to a product, and hairline scores. Expected numbers are worked out in the comments.

// Fixed fixture geometry: a 100 x 100 mm board (no recipe for that size, so every piece is 1/8" MDF
// on the smallest bed it fits, the P2S), cut around its edge (400 mm), one hairline score with no
// width ('M0 0 L30 40', 50 mm) and one 10 x 5 mm engraved block (50 mm²).
const board:ProductionJob={product:'topo-map',widthMm:100,heightMm:100,pieces:[{id:'base',name:'Base',role:'layer',widthMm:100,heightMm:100,shapes:[
 {id:'edge',d:rectPathData(0,0,100,100),operation:'cut',outline:true},
 {id:'contour',d:'M0 0 L30 40',operation:'score'},
 {id:'mark',d:rectPathData(20,20,10,5),operation:'engrave'},
]}]};
const meta={product:'Test board',title:'Fixture',appVersion:'test'};

describe('percent error against a timed job',()=>{
 it('is (estimate - actual) / actual, signed, and the gate is 15% either way',()=>{
  expect(CALIBRATION_GATE_PCT).toBe(15);
  expect(percentError(46,40)).toBeCloseTo(15,9);// 6 over 40
  expect(percentError(34,40)).toBeCloseTo(-15,9);
  expect(percentError(46.1,40)).toBeCloseTo(15.25,9);
  expect(withinGate(percentError(46,40))).toBe(true);
  expect(withinGate(percentError(34,40))).toBe(true);
  expect(withinGate(percentError(46.1,40))).toBe(false);
  expect(withinGate(null)).toBe(false);
 });
 it('has no value without a positive estimate and actual',()=>{
  expect(percentError(0,40)).toBeNull();
  expect(percentError(40,0)).toBeNull();
  expect(percentError(Number.NaN,40)).toBeNull();
 });
 it('formats with a sign and says which side of the gate it is on',()=>{
  expect(formatPercentError(12.345)).toBe('+12.3%');
  expect(formatPercentError(-4)).toBe('-4.0%');
  expect(formatPercentError(null)).toBe('-');
  expect(describeError(-20)).toBe('Estimate -20.0% (low): outside the 15% gate.');
  expect(describeError(10)).toBe('Estimate +10.0% (high): within the 15% gate.');
 });
 it('each recorded job carries its error against the estimate made at the time',()=>{
  const config=createDefaultEstimateConfig();
  const estimate=estimateJob(board,config);
  // Recorded at 2.84 min: the estimate (3.265 min, worked below) is 15.0% high.
  const entry=calibrationEntryFrom(estimate,config,2.84,'Fixture',new Date('2026-10-20T12:00:00Z'));
  const rows=summarizeCalibration({...config,calibration:[entry]},'xtool-p2s-55w').rows;
  expect(rows[0].errorPct).toBeCloseTo((3.265417-2.84)/2.84*100,3);
  expect(withinGate(rows[0].errorPct)).toBe(true);
 });
});

describe('the estimate on fixed geometry',()=>{
 const config=createDefaultEstimateConfig();
 const e=estimateJob(board,config);
 it('a hairline score stays a score when roads are engraved; only stroked lines become area',()=>{
  expect(config.strokedLines).toBe('engrave');
  expect(e.pieces[0]).toMatchObject({cutLengthMm:400,scoreLengthMm:50,engraveAreaMm2:50});
 });
 it('minutes per operation, labor at the laser rate, material from the cheapest MDF sheet',()=>{
  const ops=operationTotals(e);
  // P2S, MDF: cut 400 / 50 mm/s = 8 s; score 50 / 100 mm/s = 0.5 s; engrave 50 / (400 x 1/30) = 3.75 s.
  expect(ops.cutMin).toBeCloseTo(8/60,9);
  expect(ops.scoreMin).toBeCloseTo(.5/60,9);
  expect(ops.engraveMin).toBeCloseTo(3.75/60,9);
  // (8 + 0.5 + 3.75) s = 0.2041667 min, x1.3 travel = 0.2654167, + 3 min overhead = 3.2654167 min.
  expect(e.totals.machineMin).toBeCloseTo(3.2654167,6);
  // Labor: 3.2654167 / 60 h x $25 = $1.360590.
  expect(e.totals.laserCost).toBeCloseTo(1.360590,5);
  // Cheapest MDF stock that fits: the 12x20 12-pack, $26 / 12 = $2.1667 a sheet, one whole sheet.
  expect(e.materials).toMatchObject([{materialId:'mdf-1-8',stockId:'mdf-12x20',sheets:1}]);
  expect(e.totals.materialCost).toBeCloseTo(26/12,9);
  // Total: 2.166667 + 10% supplies 0.216667 + 1.360590 = 3.743924.
  expect(e.totals.suggestedTotal).toBeCloseTo(3.743924,5);
 });
 it('says the score speed is a placeholder, so the badge says so',()=>{
  expect(e.timeConfidence).toBe('placeholder');
  expect(e.placeholderInputs).toEqual(['score speed (1/8" MDF)']);
  expect(confidenceBadge(e.timeConfidence)).toBe('Placeholder speeds');
  expect(confidenceBadge('uncalibrated')).toBe('Uncalibrated');
 });
 it('the text summary lists sheets, minutes, material, labor and total',()=>{
  const text=estimateSummaryText(e,config,meta);
  expect(text).toContain('Machine time: ~5 min (3.3 min computed) - PLACEHOLDER SPEEDS');
  expect(text).toContain('  Cut     0.40 m   0.1 min');
  expect(text).toContain('  Score   0.05 m   0.0 min');
  expect(text).toContain('  Engrave 50 mm²   0.1 min');
  expect(text).toContain('  1/8" MDF: 1 piece(s) on 1 x 1/8" MDF 12x20 in (12-pack) = $2.17');
  expect(text).toContain('Material  $2.17');
  expect(text).toContain('Labor     $1.36 (laser 0.05 h at $25.00/h)');
  expect(text).toContain('Total     $3.74');
  expect(text).toContain('no timed jobs recorded');
 });
 it('the JSON summary carries the operations and the gate, and no clock reading',()=>{
  const files=estimateSummaryFiles(e,config,meta);
  const json=JSON.parse(files['estimate.json']);
  expect(json.schema).toBe(ESTIMATE_JSON_SCHEMA);
  expect('generatedAt' in json).toBe(false);
  expect(json.operations).toMatchObject({cutLengthMm:400,scoreLengthMm:50,engraveAreaMm2:50,cutMin:.13,scoreMin:.01});
  expect(json.operations.engraveMin).toBeCloseTo(.0625,2);
  expect(json.calibration).toMatchObject({gatePct:15,latestErrorPct:null,entries:0});
  expect(json.totals.machineMin).toBe(3.265);
 });
 it('an estimate that cannot be built leaves a note instead of stopping the export',()=>{
  const broken={...config,machines:[]} as EstimateConfig;
  const files=estimateFilesFor(board,broken,designTimeFrom(0,0),meta);
  expect(Object.keys(files)).toEqual(['estimate.txt']);
  expect(files['estimate.txt']).toMatch(/^The estimate could not be built for this export: /);
 });
});

describe('design time for the summary',()=>{
 it('the timer counts once it has a whole minute, otherwise the default hours',()=>{
  expect(designTimeFrom(59_999,.5)).toEqual({hours:.5,source:'default'});
  expect(designTimeFrom(90_000,.5)).toEqual({hours:1/60,source:'timer'});
 });
});

describe('recipes limited to a product',()=>{
 const config=createDefaultEstimateConfig();
 it('Ben\'s recipes are lake-map recipes: an 11x14 topo board gets none',()=>{
  expect(config.recipes.every(r=>r.products?.join()==='lake-map')).toBe(true);
  expect(matchRecipe(279.4,355.6,config.recipes,'lake-map')?.id).toBe('11x14');
  expect(matchRecipe(279.4,355.6,config.recipes,'topo-map')).toBeUndefined();
  // No product given: unfiltered, as before.
  expect(matchRecipe(279.4,355.6,config.recipes)?.id).toBe('11x14');
 });
 it('a recipe for every product matches any job',()=>{
  const open=config.recipes.map(r=>r.id==='11x14'?{...r,products:[]}:r);
  expect(matchRecipe(279.4,355.6,open,'topo-map')?.id).toBe('11x14');
 });
 it('a saved config from before the scope keeps the default recipes on lake maps, and custom ones open',()=>{
  const saved=createDefaultEstimateConfig() as unknown as Record<string,unknown>;
  const recipes=(saved.recipes as Record<string,unknown>[]).map(({products:_,...r})=>r);
  recipes.push({id:'recipe-custom',label:'16x20',widthIn:16,heightIn:20,slots:[{kind:'layer',materialId:'mdf-1-8',count:5}],frameCost:null});
  const store=new Map([['layered-map-studio.estimate.v1',JSON.stringify({...saved,recipes})]]);
  const loaded=loadEstimateConfig({getItem:k=>store.get(k)??null,setItem:()=>{},removeItem:()=>{}});
  expect(loaded.recipes.find(r=>r.id==='11x14')?.products).toEqual(['lake-map']);
  expect(loaded.recipes.find(r=>r.id==='recipe-custom')?.products).toBeUndefined();
 });
});

describe('the lake export ZIP carries the estimate',()=>{
 const scene=buildScene({...caldronFallsProject,title:{...caldronFallsProject.title,text:'Caldron Falls'}},caldronFallsFeatures);
 const config=createDefaultEstimateConfig();
 const files=()=>estimateFilesFor(lakeSceneToJob(scene),config,designTimeFrom(0,config.rates.designHours),{product:'Lake depth map',title:'Caldron Falls',appVersion:'test'});
 it('beside every panel SVG, unchanged',()=>{
  const entries=unzipSync(individualSvgsZip(scene,files()));
  const panels=individualSvgs(scene);
  expect(Object.keys(entries).sort()).toEqual([...Object.keys(panels),'estimate.json','estimate.txt'].sort());
  for(const [name,svg] of Object.entries(panels))expect(strFromU8(entries[name])).toBe(svg);
  const json=JSON.parse(strFromU8(entries['estimate.json']));
  expect(json.recipe.id).toBe('11x14');
  // Every scene layer plus the recipe's hand-made border.
  expect(json.pieces).toHaveLength(scene.layers.length+1);
  expect(strFromU8(entries['estimate.txt'])).toMatch(/^Layered Map Studio estimate - Caldron Falls \(Lake depth map\)\n/);
 });
 it('re-exporting the same design gives the same bytes',()=>{
  expect(individualSvgsZip(scene,files())).toEqual(individualSvgsZip(scene,files()));
 });
 it('a summary file may never replace a panel',()=>{
  const name=Object.keys(individualSvgs(scene))[0];
  expect(()=>individualSvgsZip(scene,{[name]:'x'})).toThrow(/would replace a panel file/);
 });
});
