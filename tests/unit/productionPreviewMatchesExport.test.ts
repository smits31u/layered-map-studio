import {describe,expect,it} from 'vitest';
import {buildScene} from '../../src/export/buildScene';
import {sceneToSvg} from '../../src/export/svg/exportSvg';
import {cropFromCorners} from '../../src/geometry/projection/cropProjection';
import {defaultProject} from '../../src/state/defaultProject';
import type {MapProject} from '../../src/types/project';
import {lakeSceneToJob} from '../../src/production/adapters/lakeScene';
import {createDefaultEstimateConfig} from '../../src/production/estimate/config';
import {evenOddArea,parsePathData} from '../../src/production/geometry/pathData';
import {meshVolume,topCapArea} from '../../src/production/preview3d/extrude';
import {stackLayers} from '../../src/production/preview3d/stack';
import {buildLayerMesh} from '../../src/production/preview3d/worker/buildLayerMesh';
import {caldronFallsFeatures,caldronFallsProject} from '../fixtures/caldronFalls';
import willow from '../fixtures/lakes/willowFlowageZ13.json';

// The 3D preview may never differ from what gets cut. For each layer, the solid is extruded from
// the outline path the SVG export writes, and its top face covers exactly that path's even-odd area.
// Willow Flowage (Oneida Co., WI, recorded at zoom 13) is the most island-dense shoreline on file.

const config=createDefaultEstimateConfig();

// Exported coordinates have 3 decimals; Float32 vertex positions are within ~2e-5 mm of them.
const key=(x:number,z:number)=>`${Math.round(x*1000)},${Math.round(z*1000)}`;

// Outline cut paths of one layer as written in the registered-layers SVG. The base is a <rect>.
function exportedOutline(svg:string,layerId:string,widthMm:number,heightMm:number):string[]{
 const doc=new DOMParser().parseFromString(svg,'image/svg+xml');
 const group=doc.querySelector(`[id="${layerId}-cut"]`)!;
 const panel=group.querySelector(`[id="${layerId}-panel"]`)!;
 if(panel.tagName==='rect')return [`M0 0 L${widthMm} 0 L${widthMm} ${heightMm} L0 ${heightMm} Z`];
 return [panel.getAttribute('d')!];
}

function checkPreviewMatchesExport(scene:ReturnType<typeof buildScene>){
 const svg=sceneToSvg(scene,'registered',0,false),job=lakeSceneToJob(scene),layers=stackLayers(job,config);
 expect(layers.map(l=>l.id).reverse()).toEqual(scene.layers.map(l=>l.id));
 const results=layers.map(layer=>{
  const exported=exportedOutline(svg,layer.id,scene.widthMm,scene.heightMm);
  // Same path data, character for character.
  expect(layer.outlinePaths).toEqual(exported);
  const started=performance.now();
  const mesh=buildLayerMesh({id:layer.id,outlinePaths:layer.outlinePaths,widthMm:job.widthMm,heightMm:job.heightMm,thicknessMm:layer.thicknessMm});
  const ms=performance.now()-started;
  const area=evenOddArea(exported.flatMap(d=>parsePathData(d)));
  expect(topCapArea(mesh)/area).toBeCloseTo(1,6);
  expect(meshVolume(mesh)/(area*layer.thicknessMm)).toBeCloseTo(1,5);
  // Every point of the exported outline is a vertex of the solid's top face, at the right height.
  const top=new Set<string>();
  for(let v=0;v<mesh.positions.length/3;v++)if(Math.abs(mesh.positions[v*3+1]-layer.thicknessMm)<1e-4)top.add(key(mesh.positions[v*3],mesh.positions[v*3+2]));
  const rings=exported.flatMap(d=>parsePathData(d));
  for(const ring of rings)for(const [x,y] of ring.points)expect(top.has(key(x,y))).toBe(true);
  return {id:layer.id,rings:rings.length,vertices:mesh.positions.length/3,ms};
 });
 return results;
}

describe('the 3D preview matches the export geometry',()=>{
 it('Caldron Falls fixture: every layer, path for path and area for area',()=>{
  const scene=buildScene({...caldronFallsProject,title:{...caldronFallsProject.title,text:'Caldron Falls'}},caldronFallsFeatures);
  const results=checkPreviewMatchesExport(scene);
  expect(results).toHaveLength(scene.layers.length);
 });

 it('Willow Flowage z13 (all water): 60 islands and their openings, every layer built fast',()=>{
  const crop=cropFromCorners(willow.crop.nw,willow.crop.ne,willow.crop.se,willow.crop.sw);
  const project:MapProject={...defaultProject,map:{...defaultProject.map,longitude:willow.center.lng,latitude:willow.center.lat,zoom:willow.zoom,crop},shoreline:{...defaultProject.shoreline,waterMode:'all',enabledLayers:[true,true,true,true,false,false,true]}};
  const scene=buildScene(project,{water:willow.water,roads:[],places:[]});
  const results=checkPreviewMatchesExport(scene);
  const land=results.find(r=>r.id==='layer-land')!;
  // The land panel is the board with every water opening cut out, and the islands within them.
  expect(land.rings).toBeGreaterThan(50);
  // A generous bound for a slow CI box; it runs in a worker in the app, so this is about not
  // stalling the preview, not about the page (which never waits on it).
  for(const r of results)expect(r.ms).toBeLessThan(10000);
 },60000);
});
