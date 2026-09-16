import {beforeEach,describe,expect,it} from 'vitest';
import {createDefaultOrnamentProject,DEFAULT_ZOOM} from '../../src/ornament/defaults';
import {ORNAMENT_STORAGE_KEY,clearOrnamentProject,loadOrnamentProject,saveOrnamentProject} from '../../src/ornament/persistence';
import {ornamentReducer,type OrnamentAction} from '../../src/ornament/store';
import {ORNAMENT_LIMITS,type OrnamentProject} from '../../src/ornament/types';
import {clampTo,fromDisplay,snapTo,toDisplay} from '../../src/ornament/validation';

const run=(actions:OrnamentAction[],from=createDefaultOrnamentProject())=>actions.reduce(ornamentReducer,from);

// Every leaf value in the project, addressed by path. Used to prove reset is total rather than
// "total for the fields somebody remembered to list in a test".
function leaves(value:unknown,prefix=''):[string,unknown][]{
 if(value&&typeof value==='object'&&!Array.isArray(value))return Object.entries(value).flatMap(([k,v])=>leaves(v,prefix?`${prefix}.${k}`:k));
 return [[prefix,value]];
}

// Drives every stored field away from its default. If a field is added to OrnamentProject and not
// added here, the "touches every field" test below fails and says which one.
const MUTATIONS:OrnamentAction[]=[
 {type:'setViewport',patch:{center:[10,20],zoom:7,selectedPlaceLabel:'Somewhere Else'}},
 {type:'setOrnament',patch:{diameterMm:180,rimWidthMm:12,mapToTextBoundaryMm:-5}},
 {type:'setHangingLoop',patch:{outerDiameterMm:24,innerDiameterMm:12,overlapMm:7,minNeckWidthMm:5}},
 {type:'setRoads',patch:{detail:'high',widthScale:2.5}},
 {type:'setMarker',patch:{kind:'house',position:[1,2],sizeMm:15,output:'engraved'}},
 {type:'setTextLine',key:'subtitle',patch:{value:'north woods',fontId:'cinzel',sizeMm:6,letterSpacingMm:1}},
 {type:'setTextLine',key:'title',patch:{value:'Caldron Falls',fontId:'inter',sizeMm:18,letterSpacingMm:.9}},
 {type:'setTextLine',key:'date',patch:{value:'1967',fontId:'cinzel',sizeMm:5,letterSpacingMm:.8}},
 {type:'setTextGap',key:'gap12Mm',value:9},
 {type:'setTextGap',key:'gap23Mm',value:11},
 {type:'setBuildMode',value:'water-cutout-3-piece'},
 {type:'setExportPreset',value:'lightburn-colors'},
 {type:'setDisplayUnit',value:'mm'},
];

describe('reset',()=>{
 it('the mutation set actually moves every stored field off its default',()=>{
  const defaults=createDefaultOrnamentProject(),mutated=run(MUTATIONS);
  const before=new Map(leaves(defaults)),after=new Map(leaves(mutated));
  const unchanged=[...before.entries()].filter(([path,value])=>JSON.stringify(after.get(path))===JSON.stringify(value)&&path!=='schemaVersion'&&path!=='viewport.bearing'&&path!=='viewport.pitch');
  expect(unchanged.map(([path])=>path)).toEqual([]);
 });

 // The reference generator's reset left the zoom control showing 7 while state intended 14 — a
 // second source of truth for one value. Reset here is "replace with defaults", so the assertion is
 // total: every leaf, not a chosen few.
 it('restores every stored leaf to its schema default',()=>{
  const reset=run([...MUTATIONS,{type:'reset'}]);
  expect(reset).toEqual(createDefaultOrnamentProject());
  const defaults=new Map(leaves(createDefaultOrnamentProject()));
  for(const [path,value] of leaves(reset))expect([path,value]).toEqual([path,defaults.get(path)]);
 });

 it('restores zoom to 14 specifically, from the 7 the reference tool got stuck on',()=>{
  const mutated=run([{type:'setViewport',patch:{zoom:7}}]);
  expect(mutated.viewport.zoom).toBe(7);
  expect(ornamentReducer(mutated,{type:'reset'}).viewport.zoom).toBe(DEFAULT_ZOOM);
 });

 it('hands back a fresh object graph that later edits cannot write back into the defaults',()=>{
  const first=ornamentReducer(run(MUTATIONS),{type:'reset'});
  const edited=ornamentReducer(first,{type:'setTextLine',key:'title',patch:{value:'mutated'}});
  const second=ornamentReducer(edited,{type:'reset'});
  expect(second).toEqual(createDefaultOrnamentProject());
  expect(second.text.title.value).toBe('');
  expect(first.text).not.toBe(second.text);
 });
});

describe('clamping',()=>{
 it('holds every numeric inside its published limit',()=>{
  const wild=run([
   {type:'setOrnament',patch:{diameterMm:9999,rimWidthMm:-40,mapToTextBoundaryMm:1e6}},
   {type:'setHangingLoop',patch:{outerDiameterMm:1e4,innerDiameterMm:-3,overlapMm:1e4,minNeckWidthMm:-1}},
   {type:'setRoads',patch:{widthScale:99}},
   {type:'setMarker',patch:{sizeMm:-5}},
   {type:'setTextLine',key:'title',patch:{sizeMm:1e5,letterSpacingMm:-99}},
   {type:'setTextGap',key:'gap12Mm',value:1e5},
   {type:'setViewport',patch:{zoom:99}},
  ]);
  const L=ORNAMENT_LIMITS;
  expect(wild.ornament.diameterMm).toBe(L.diameterMm.max);
  expect(wild.ornament.rimWidthMm).toBe(L.rimWidthMm.min);
  expect(wild.ornament.mapToTextBoundaryMm).toBe(L.mapToTextBoundaryMm.max);
  expect(wild.ornament.hangingLoop.outerDiameterMm).toBe(L.loopOuterDiameterMm.max);
  expect(wild.ornament.hangingLoop.innerDiameterMm).toBe(L.loopInnerDiameterMm.min);
  expect(wild.ornament.hangingLoop.minNeckWidthMm).toBe(L.loopMinNeckWidthMm.min);
  expect(wild.roads.widthScale).toBe(L.roadWidthScale.max);
  expect(wild.marker.sizeMm).toBe(L.markerSizeMm.min);
  expect(wild.text.title.sizeMm).toBe(L.textSizeMm.max);
  expect(wild.text.title.letterSpacingMm).toBe(L.letterSpacingMm.min);
  expect(wild.text.gap12Mm).toBe(L.lineGapMm.max);
  expect(wild.viewport.zoom).toBe(L.zoom.max);
 });

 it('substitutes the minimum for a non-finite value rather than storing NaN',()=>{
  const broken=run([{type:'setOrnament',patch:{diameterMm:Number.NaN}}]);
  expect(Number.isFinite(broken.ornament.diameterMm)).toBe(true);
  expect(broken.ornament.diameterMm).toBe(ORNAMENT_LIMITS.diameterMm.min);
 });

 it('keeps bearing and pitch pinned at zero for the first release',()=>{
  const moved=run([{type:'setViewport',patch:{center:[1,2]}}]);
  expect(moved.viewport.bearing).toBe(0);
  expect(moved.viewport.pitch).toBe(0);
 });

 it('snaps zoom to the half steps the slider can express',()=>{
  expect(snapTo(14.27,ORNAMENT_LIMITS.zoom)).toBe(14.5);
  expect(snapTo(14.2,ORNAMENT_LIMITS.zoom)).toBe(14);
  expect(clampTo(3,ORNAMENT_LIMITS.zoom)).toBe(7);
 });
});

describe('unit conversion',()=>{
 it('round-trips inches without drift at the default diameter',()=>{
  expect(toDisplay(101.6,'in')).toBeCloseTo(4,9);
  expect(fromDisplay(4,'in')).toBeCloseTo(101.6,9);
  expect(fromDisplay(toDisplay(101.6,'in'),'in')).toBeCloseTo(101.6,9);
 });
 it('passes millimetres through untouched',()=>{
  expect(toDisplay(87.3,'mm')).toBe(87.3);
  expect(fromDisplay(87.3,'mm')).toBe(87.3);
 });
 it('changing the display unit never changes stored millimetres',()=>{
  const before=createDefaultOrnamentProject();
  const after=ornamentReducer(before,{type:'setDisplayUnit',value:'mm'});
  expect(after.ornament.diameterMm).toBe(before.ornament.diameterMm);
 });
});

describe('local persistence',()=>{
 beforeEach(()=>localStorage.clear());

 it('round-trips a project',()=>{
  const project=run(MUTATIONS);
  saveOrnamentProject(project);
  expect(loadOrnamentProject()).toEqual(project);
 });

 it('returns nothing when there is no record',()=>{
  expect(loadOrnamentProject()).toBeUndefined();
 });

 it('ignores a record from another schema version',()=>{
  localStorage.setItem(ORNAMENT_STORAGE_KEY,JSON.stringify({...createDefaultOrnamentProject(),schemaVersion:2}));
  expect(loadOrnamentProject()).toBeUndefined();
 });

 it('ignores unparseable content instead of throwing',()=>{
  localStorage.setItem(ORNAMENT_STORAGE_KEY,'{not json');
  expect(loadOrnamentProject()).toBeUndefined();
 });

 it('fills a partial record from defaults and clamps what it does contain',()=>{
  localStorage.setItem(ORNAMENT_STORAGE_KEY,JSON.stringify({schemaVersion:1,ornament:{diameterMm:99999}}));
  const loaded=loadOrnamentProject() as OrnamentProject;
  expect(loaded.ornament.diameterMm).toBe(ORNAMENT_LIMITS.diameterMm.max);
  expect(loaded.text.title.fontId).toBe(createDefaultOrnamentProject().text.title.fontId);
  expect(loaded.ornament.hangingLoop).toEqual(createDefaultOrnamentProject().ornament.hangingLoop);
 });

 it('clears the record so a reset session does not reload the old project',()=>{
  saveOrnamentProject(run(MUTATIONS));
  clearOrnamentProject();
  expect(loadOrnamentProject()).toBeUndefined();
 });
});
