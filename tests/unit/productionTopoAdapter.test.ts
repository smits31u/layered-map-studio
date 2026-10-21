import {beforeAll,describe,expect,it} from 'vitest';
import {topoBoardToJob,TOPO_PRODUCT} from '../../src/production/adapters/topoBoard';
import {createDefaultEstimateConfig} from '../../src/production/estimate/config';
import {estimateJob} from '../../src/production/estimate/estimate';
import {evenOddArea,parsePathData} from '../../src/production/geometry/pathData';
import {meshVolume,topCapArea} from '../../src/production/preview3d/extrude';
import {defaultLayerColors,stackLayers} from '../../src/production/preview3d/stack';
import {buildLayerMesh} from '../../src/production/preview3d/worker/buildLayerMesh';
import type {ProductionJob} from '../../src/production/job';
import {getLoadedFont} from '../../src/text/fontRegistry';
import {createDefaultTopoProject} from '../../src/topo/defaults';
import {exportTopo,type TopoExportResult} from '../../src/topo/export/exportTopo';
import {generateTerrain} from '../../src/topo/terrain/pipeline';
import {loadFixtureTiles,loadTopoFixture,replayCapture} from '../helpers/topoFixtures';

// V2 Step 1 (A5/A6 for topo): the topo export board as a production job. The 3D preview may never
// differ from what gets cut, so its layers are checked against the exported SVG itself: the same
// layer count, the same order (layer 1 at the bottom), and each layer's outline the exact path data
// of its group in the file. Board: the real Golden Gate fixture the topo export golden uses.

const HEAVY=180_000;
const W=228.6,H=228.6;
const config=createDefaultEstimateConfig();
let exported:TopoExportResult,job:ProductionJob,svg:Document;

beforeAll(async()=>{
 const capture=(await replayCapture(loadTopoFixture('sf-coast'))).capture;
 const base=createDefaultTopoProject();
 const project={...base,output:{widthMm:W,heightMm:H},terrain:{...base.terrain,layerCount:4 as const},frame:{enabled:true,thicknessMm:6},title:{...base.title,text:'Golden Gate',dyMm:-120}};
 const terrain=generateTerrain({view:capture.view,tiles:loadFixtureTiles('sf-coast'),water:[],capturedWater:capture.features.water,settings:{...project.terrain,smoothingRadius:3}});
 exported=exportTopo({project,terrain,capture,font:getLoadedFont,generatedAt:new Date('2026-10-20T12:00:00Z'),appVersion:'test'});
 job=topoBoardToJob(exported.board);
 svg=new DOMParser().parseFromString(exported.svg!,'image/svg+xml');
},HEAVY);

const pathsOf=(groupId:string)=>[...svg.getElementById(groupId)!.getElementsByTagName('path')].map(p=>p.getAttribute('d')!);

describe('topo board as a production job',()=>{
 it('exports, and the job is a topo job at the board size',()=>{
  expect(exported.ok).toBe(true);
  expect(job).toMatchObject({product:TOPO_PRODUCT,widthMm:W,heightMm:H});
 });

 it('the preview stacks exactly the exported layers, layer 1 at the bottom',()=>{
  const bands=['cut/terrain-1','cut/terrain-2','cut/terrain-3','cut/terrain-4'].filter(id=>pathsOf(id).length);
  expect(bands).toHaveLength(4);
  const layers=stackLayers(job,config);
  expect(layers.map(l=>l.id)).toEqual(['terrain-1','terrain-2','terrain-3','terrain-4']);
  expect(layers.map(l=>l.level)).toEqual([0,1,2,3]);
  // Same path data as the file, character for character, group for layer.
  layers.forEach((layer,i)=>expect(layer.outlinePaths).toEqual(pathsOf(bands[i])));
  // Each sits on the one below at its material's thickness.
  for(let i=1;i<layers.length;i++)expect(layers[i].baseY).toBeCloseTo(layers[i-1].baseY+layers[i-1].thicknessMm,9);
 });

 it('each solid is its exported outline: top face area and volume',()=>{
  for(const layer of stackLayers(job,config)){
   const mesh=buildLayerMesh({id:layer.id,outlinePaths:layer.outlinePaths,widthMm:W,heightMm:H,thicknessMm:layer.thicknessMm});
   const area=evenOddArea(layer.outlinePaths.flatMap(d=>parsePathData(d)));
   expect(area).toBeGreaterThan(0);
   expect(topCapArea(mesh)/area).toBeCloseTo(1,5);
   expect(meshVolume(mesh)/(area*layer.thicknessMm)).toBeCloseTo(1,4);
  }
 },HEAVY);

 it('the frame is costed but not stacked; the water group is not counted twice',()=>{
  const frame=job.pieces.find(p=>p.id==='frame')!;
  expect(frame.role).toBe('border');
  expect(frame.shapes.map(s=>s.d)).toEqual(pathsOf('cut/frame'));
  expect(stackLayers(job,config).some(l=>l.id==='frame')).toBe(false);
  const all=new Set(job.pieces.flatMap(p=>p.shapes.map(s=>s.d)));
  expect(pathsOf('cut/water').length).toBeGreaterThan(0);
  for(const d of pathsOf('cut/water'))expect(all.has(d)).toBe(false);
 });

 it('roads, contours, the route and glyphs are counted on layer 1, from the file\'s path data',()=>{
  const base=job.pieces.find(p=>p.id==='terrain-1')!;
  const byGroup=(prefix:string)=>base.shapes.filter(s=>s.id.startsWith(`${prefix}#`));
  expect(byGroup('cut/roads').map(s=>s.d)).toEqual(pathsOf('cut/roads'));
  expect(byGroup('cut/roads').every(s=>s.operation==='cut'&&!s.outline)).toBe(true);
  const contours=byGroup('score/contours');
  expect(contours.map(s=>s.d)).toEqual(pathsOf('score/contours'));
  // Contours are hairlines: no width, so they stay scores even when stroked lines are engraved.
  expect(contours.every(s=>s.operation==='score'&&s.strokeWidthMm===undefined)).toBe(true);
  expect(byGroup('engrave/title').map(s=>s.d)).toEqual(pathsOf('engrave/title'));
  // The upper layers carry only their own outlines.
  for(const id of ['terrain-2','terrain-3','terrain-4'])expect(job.pieces.find(p=>p.id===id)!.shapes.every(s=>s.outline)).toBe(true);
 });

 it('estimates on bed fit with no lake recipe, upper layers on their own footprint',()=>{
  const e=estimateJob(job,config);
  expect(e.recipe).toBeNull();
  expect(e.machine).toMatchObject({id:'xtool-p2s-55w',chosenBy:'bed fit'});
  expect(e.warnings[0]).toMatch(/^No layer recipe for 9 x 9 in\./);
  const top=e.pieces.find(p=>p.id==='terrain-4')!;
  expect(top.widthMm).toBeLessThan(W);
  expect(e.pieces.find(p=>p.id==='terrain-1')!.scoreLengthMm).toBeGreaterThan(0);
  expect(e.totals.machineMin).toBeGreaterThan(0);
 });

 it('topo layers default to earth tones climbing from the base',()=>{
  const colors=defaultLayerColors(stackLayers(job,config),job.product);
  expect(colors[0]).toBe('#5f7d4e');
  expect(colors.at(-1)).toBe('#d9c9a3');
 });
});
