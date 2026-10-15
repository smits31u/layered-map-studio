import {describe,expect,it} from 'vitest';
import {buildScene} from '../../src/export/buildScene';
import {sceneToSvg} from '../../src/export/svg/exportSvg';
import {lakeSceneToJob} from '../../src/production/adapters/lakeScene';
import {createDefaultEstimateConfig} from '../../src/production/estimate/config';
import {estimateJob} from '../../src/production/estimate/estimate';
import {pieceMetrics} from '../../src/production/job';
import {caldronFallsFeatures,caldronFallsProject} from '../fixtures/caldronFalls';

// The lake scene as a production job must be exactly what the SVG export writes, path for path.

const scene=buildScene({...caldronFallsProject,title:{...caldronFallsProject.title,text:'Caldron Falls'}},caldronFallsFeatures);
const job=lakeSceneToJob(scene);
// Every path's d attribute inside one layer's group of the registered-layers SVG.
const exportedPaths=(svg:string,layerId:string,operation:'cut'|'engrave')=>{
 const doc=new DOMParser().parseFromString(svg,'image/svg+xml');
 return [...doc.querySelectorAll(`[id="${layerId}-${operation}"] path`)].map(p=>({id:p.getAttribute('id')!,d:p.getAttribute('d')!}));
};

describe('lakeSceneToJob',()=>{
 const svg=sceneToSvg(scene,'registered',0,false);

 it('one piece per layer, top of the stack first',()=>{
  expect(job.pieces.map(p=>p.id)).toEqual(scene.layers.map(l=>l.id));
  expect(job.pieces[0].id).toBe('layer-land');
  expect(job.pieces.at(-1)!.id).toBe('layer-base');
  expect(job.pieces.every(p=>p.widthMm===scene.widthMm&&p.heightMm===scene.heightMm)).toBe(true);
 });

 it('carries exactly the cut and engrave paths the SVG export writes for each layer',()=>{
  for(const piece of job.pieces){
   const cut=piece.shapes.filter(s=>s.operation==='cut').map(s=>s.id).sort();
   const marks=piece.shapes.filter(s=>s.operation!=='cut').map(s=>({id:s.id,d:s.d}));
   const exportedCut=exportedPaths(svg,piece.id,'cut');
   // The base is a rect in the scene and in the file; the job carries it as the same rectangle path.
   if(piece.id==='layer-base')expect(piece.shapes[0].d).toBe(`M0 0 L${scene.widthMm} 0 L${scene.widthMm} ${scene.heightMm} L0 ${scene.heightMm} Z`);
   else expect(cut).toEqual(exportedCut.map(p=>p.id).sort());
   for(const shape of piece.shapes.filter(s=>s.operation==='cut'&&piece.id!=='layer-base'))expect(exportedCut.find(p=>p.id===shape.id)!.d).toBe(shape.d);
   expect(marks.sort((a,b)=>a.id.localeCompare(b.id))).toEqual(exportedPaths(svg,piece.id,'engrave').sort((a,b)=>a.id.localeCompare(b.id)));
  }
 });

 it('labels, title and compass ride on Land / Top only; roads become score lines, glyphs engrave areas',()=>{
  const land=job.pieces[0];
  expect(land.shapes.some(s=>s.id==='title-text'&&s.operation==='engrave')).toBe(true);
  expect(land.shapes.some(s=>s.id==='compass'&&s.operation==='engrave')).toBe(true);
  expect(land.shapes.filter(s=>s.id.startsWith('road-')).every(s=>s.operation==='score')).toBe(true);
  expect(job.pieces.slice(1).every(p=>p.shapes.every(s=>s.operation==='cut'))).toBe(true);
  expect(land.shapes.filter(s=>s.outline).map(s=>s.id)).toEqual(['layer-land-panel']);
 });

 it('measures the real scene: board perimeter plus shoreline, roads scored, text engraved',()=>{
  const land=pieceMetrics(job.pieces[0]),base=pieceMetrics(job.pieces.at(-1)!);
  const perimeter=2*(scene.widthMm+scene.heightMm);
  expect(base.cutLengthMm).toBeCloseTo(perimeter,6);
  expect(land.cutLengthMm).toBeGreaterThan(perimeter+100);
  expect(land.scoreLengthMm).toBeGreaterThan(100);
  expect(land.engraveAreaMm2).toBeGreaterThan(10);
  const e=estimateJob(job,createDefaultEstimateConfig());
  expect(e.recipe?.id).toBe('11x14');
  expect(e.totals.suggestedTotal).toBeGreaterThan(0);
  expect(Number.isFinite(e.totals.machineMin)).toBe(true);
 });
});
