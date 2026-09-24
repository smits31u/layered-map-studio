import {createHash} from 'node:crypto';
import ClipperLib from 'clipper-lib';
import {describe,expect,it} from 'vitest';
import {importDepthRegionGeoJson} from '../../src/bathymetry/model';
import {buildGeometryLayers,buildPresentationScene,buildScene} from '../../src/export/buildScene';
import {geometryKeyOf,getCachedGeometryLayers,type GeometryCache} from '../../src/export/geometryCache';
import {assertManufacturingSceneUsable,type ManufacturingScene} from '../../src/export/scene';
import {individualSvgs,sceneToSvg} from '../../src/export/svg/exportSvg';
import {CropProjection} from '../../src/geometry/projection/cropProjection';
import {proceduralDepthOpenings,proceduralThresholds} from '../../src/geometry/shoreline/proceduralDepth';
import {buildWaterModel,type MultiPolygonMm} from '../../src/geometry/shoreline/polygonEngine';
import {DEFAULT_SIMPLE_TERRAIN_CONTROLS} from '../../src/geometry/terrain/terrainParams';
import {defaultProject} from '../../src/state/defaultProject';
import type {ExtractedFeatures,MapProject} from '../../src/types/project';
import {caldronFallsFeatures,caldronFallsProject} from '../fixtures/caldronFalls';
import {caldronFixture,noquebayFixture,type RegressionFixture} from '../fixtures/regressionFixtures';

// Procedural Terrain as a live depth mode: real fixtures through the real buildScene and SVG
// export, the settings reaching the geometry, the geometry cache, switching between all three
// modes, and a degenerate shoreline being refused with a message rather than a dead preview.

const procedural=(project:MapProject,terrain?:Partial<typeof DEFAULT_SIMPLE_TERRAIN_CONTROLS>):MapProject=>({...project,bathymetry:{...project.bathymetry,mode:'procedural-terrain',...(terrain?{terrain:{...DEFAULT_SIMPLE_TERRAIN_CONTROLS,...terrain}}:{})}});
const fixtureProject=(fixture:RegressionFixture,enabledLayers=[true,true,true,true,true,true,true]):MapProject=>{
 const [west,south,east,north]=fixture.crop.bbox;
 return {...defaultProject,map:{latitude:(south+north)/2,longitude:(west+east)/2,zoom:12,bearing:0,crop:fixture.crop},dimensions:{...defaultProject.dimensions,...fixture.dimensions},shoreline:{...defaultProject.shoreline,enabledLayers}};
};
const featuresOf=(fixture:RegressionFixture):ExtractedFeatures=>({water:fixture.water,roads:[],places:[]});
const depthLayers=(scene:ManufacturingScene)=>scene.layers.filter(layer=>layer.id.startsWith('layer-depth-'));
const sha=(text:string)=>createHash('sha256').update(text).digest('hex');

// Containment check on Clipper at 0.0001mm, independent of the pipeline's own.
const S=10000;
const paths=(g:MultiPolygonMm)=>g.flatMap(p=>p.map(r=>r.slice(0,-1).map(([x,y])=>({X:Math.round(x*S),Y:Math.round(y*S)}))));
function outsideArea(inner:MultiPolygonMm,outer:MultiPolygonMm){
 const c=new ClipperLib.Clipper(),out:ClipperLib.Paths=[];
 c.AddPaths(paths(inner),ClipperLib.PolyType.ptSubject,true);c.AddPaths(paths(outer),ClipperLib.PolyType.ptClip,true);
 c.Execute(ClipperLib.ClipType.ctDifference,out,ClipperLib.PolyFillType.pftEvenOdd,ClipperLib.PolyFillType.pftEvenOdd);
 return Math.abs(out.reduce((sum,path)=>sum+ClipperLib.Clipper.Area(path),0))/(S*S);
}

// The same structural checks the bathymetry golden-fixture export test applies.
function expectValidExport(scene:ManufacturingScene,label:string){
 const production=sceneToSvg(scene,'production',10,true),registered=sceneToSvg(scene,'registered',0,false);
 expect(production.startsWith('<svg '),label).toBe(true);expect(production.trim().endsWith('</svg>'),label).toBe(true);
 const gOpens=(registered.match(/<g /g)??[]).length;
 expect(gOpens,label).toBeGreaterThan(0);expect((registered.match(/<\/g>/g)??[]).length,label).toBe(gOpens);
 for(const [tag] of registered.matchAll(/<(rect|path)[^>]*>/g))expect(tag.endsWith('/>'),label).toBe(true);
 for(const [,d] of production.matchAll(/ d="([^"]+)"/g))expect(d,label).not.toMatch(/NaN|Infinity/);
 for(const [,body] of registered.matchAll(/<g id="[^"]*-cut"[^>]*>(.*?)<\/g>/gs))for(const [,d] of body.matchAll(/ d="([^"]+)"/g))expect(d.split(/(?=M)/).filter(Boolean).every(sub=>/Z\s*$/.test(sub.trim())),label).toBe(true);
 for(const layer of scene.layers){
  expect(registered,label).toContain(`<g id="${layer.id}"`);
  const file=individualSvgs(scene)[`${layer.id}.svg`];
  expect(file.startsWith('<svg '),label).toBe(true);expect(file).toContain(`<g id="${layer.id}"`);
 }
 expect(sceneToSvg(scene,'production',10,true)).toBe(production);
 return production;
}

describe('Procedural Terrain scenes on real fixtures',()=>{
 it('builds the Caldron Falls project fixture into the same panel structure as the other modes',()=>{
  const scene=buildScene(procedural(caldronFallsProject),caldronFallsFeatures),artistic=buildScene(caldronFallsProject,caldronFallsFeatures);
  expect(scene.layers.map(l=>l.id)).toEqual(artistic.layers.map(l=>l.id));
  expect(depthLayers(scene).map(l=>l.name)).toEqual(['Terrain Depth 1','Terrain Depth 2','Terrain Depth 3']);
  expect(scene.depthMode).toBe('procedural-terrain');
  expect(scene.manufacturingWarnings).toEqual([]);
  expect(scene.bathymetrySource).toBeUndefined();
  expect(scene.layers.every(l=>l.depthMeters===undefined)).toBe(true);
  // Land and Base do not depend on the depth mode at all.
  for(const id of ['layer-land','layer-base'])expect(scene.layers.find(l=>l.id===id)).toEqual(artistic.layers.find(l=>l.id===id));
  const areas=scene.geometryMetrics!.openingAreasMm2;
  for(let k=1;k<areas.length;k++)expect(areas[k],`opening ${k}`).toBeLessThan(areas[k-1]);
  const svg=expectValidExport(scene,'caldron project');
  // Pinned so a change to the procedural cut geometry is always deliberate.
  expect(sha(svg)).toBe(PINNED_PROJECT_SVG);
 });

 it.each([['Caldron Falls',caldronFixture],['Lake Noquebay',noquebayFixture]] as const)('%s with all five depth panels: valid, nested, exportable',(name,fixture)=>{
  const project=procedural(fixtureProject(fixture)),features=featuresOf(fixture);
  const scene=buildScene(project,features);
  expect(scene.layers).toHaveLength(7);
  expect(scene.manufacturingWarnings,name).toEqual([]);
  for(const layer of scene.layers)for(const shape of layer.shapes)if(shape.d)expect(shape.d).not.toMatch(/NaN|Infinity/);
  expectValidExport(scene,name);
  // The openings the scene cut, rebuilt through the adapter directly: every deeper one lies inside
  // the one above it, and the first inside the shoreline — exactly zero area outside.
  const {widthMm,heightMm}=fixture.dimensions,projection=new CropProjection(fixture.crop,widthMm,heightMm);
  const water=buildWaterModel(fixture.water,projection,widthMm,heightMm,{mode:project.shoreline.waterMode,minAreaMm2:project.shoreline.minWaterAreaMm2,focus:{lng:project.map.longitude,lat:project.map.latitude}}).water;
  const openings=proceduralDepthOpenings(water,5,project.bathymetry.terrain);
  expect(openings.map(o=>o.threshold)).toEqual(proceduralThresholds(5));
  expect(scene.geometryMetrics!.openingAreasMm2.slice(1)).toEqual(openings.map(o=>o.areaMm2));
  let container=water;
  for(const opening of openings){expect(opening.areaMm2).toBeGreaterThan(0);expect(outsideArea(opening.geometry,container),`${name} @${opening.threshold}`).toBe(0);container=opening.geometry}
 },30000);
});

describe('Procedural Terrain settings reach the geometry',()=>{
 const base=procedural(caldronFallsProject);
 const depthD=(scene:ManufacturingScene)=>depthLayers(scene).map(l=>l.shapes[0].d);

 it('changes the depth panels, and only the depth panels, when the seed or a control changes',()=>{
  const a=buildScene(base,caldronFallsFeatures);
  for(const change of [{seed:99},{character:.9},{weave:.8,weaveAngleDeg:40},{terracing:1},{bankSteepness:1},{profile:'broad-shelf' as const}]){
   const b=buildScene(procedural(caldronFallsProject,change),caldronFallsFeatures);
   expect(depthD(b),JSON.stringify(change)).not.toEqual(depthD(a));
   for(const id of ['layer-land','layer-base'])expect(b.layers.find(l=>l.id===id)).toEqual(a.layers.find(l=>l.id===id));
  }
 });

 it('treats absent terrain settings as the defaults',()=>{
  expect(buildScene(base,caldronFallsFeatures)).toEqual(buildScene(procedural(caldronFallsProject,{}),caldronFallsFeatures));
 });

 it('cuts one panel per enabled depth layer at evenly spaced planes',()=>{
  expect(proceduralThresholds(3)).toEqual([1.5/4,2.5/4,3.5/4]);
  const two=buildScene({...base,shoreline:{...base.shoreline,enabledLayers:[true,true,false,true,false,false,true]}},caldronFallsFeatures);
  expect(depthLayers(two).map(l=>l.id)).toEqual(['layer-depth-2','layer-depth-4']);
  expect(two.manufacturingWarnings).toEqual([]);
 });

 it('reports empty deep panels as collapsed layers and refuses to export them, when Max depth is low',()=>{
  const shallow=buildScene(procedural(caldronFallsProject,{maxDepth:.5}),caldronFallsFeatures);
  // Planes at 37.5 / 62.5 / 87.5%: a lake only 50% deep reaches the first and nothing below it.
  expect(shallow.manufacturingWarnings).toEqual([
   'Layer 3 is empty: the procedural terrain never reaches 63% depth, so this panel duplicates the Base geometry. Raise Max depth or disable the layer.',
   'Layer 4 is empty: the procedural terrain never reaches 88% depth, so this panel duplicates the Base geometry. Raise Max depth or disable the layer.',
  ]);
  expect(()=>assertManufacturingSceneUsable(shallow)).toThrow('Layer 3 is empty');
  expect(()=>sceneToSvg(shallow,'production')).toThrow('Layer 3 is empty');
 });
});

describe('geometry cache',()=>{
 it('keys on the terrain settings in Procedural Terrain mode only',()=>{
  const p=procedural(caldronFallsProject);
  expect(geometryKeyOf(procedural(caldronFallsProject,{seed:2}))).not.toBe(geometryKeyOf(p));
  expect(geometryKeyOf(procedural(caldronFallsProject,{}))).toBe(geometryKeyOf(p));
  // In Artistic Depth, terrain settings are inert and must not invalidate its cached geometry.
  const artisticWithTerrain:MapProject={...caldronFallsProject,bathymetry:{...caldronFallsProject.bathymetry,terrain:{...DEFAULT_SIMPLE_TERRAIN_CONTROLS,seed:77}}};
  expect(geometryKeyOf(artisticWithTerrain)).toBe(geometryKeyOf(caldronFallsProject));
 });
});

describe('switching depth modes',()=>{
 const rect=(depth:number,delta:number)=>({type:'Feature',properties:{depth,depth_unit:'ft'},geometry:{type:'Polygon',coordinates:[[[-88.21-delta,45.37-delta],[-88.21+delta,45.37-delta],[-88.21+delta,45.37+delta],[-88.21-delta,45.37+delta],[-88.21-delta,45.37-delta]]]}});
 const dataset=importDepthRegionGeoJson({type:'FeatureCollection',features:[rect(5,.025),rect(15,.015),rect(30,.007)]},'caldron.geojson');

 it('leaves no state behind: every step through the shared cache equals a fresh build of that mode',()=>{
  // Driven the way App.rebuildScene drives it: one cache, one project edited in place.
  const artistic=caldronFallsProject;
  const terrain=procedural(artistic,{seed:5,terracing:.8});
  const truth:MapProject={...terrain,bathymetry:{...terrain.bathymetry,mode:'true-bathymetry',provider:'user',datasetId:dataset.source.datasetId,status:'available',dataset,selection:'automatic',thresholdsMeters:[]}};
  const backToArtistic:MapProject={...truth,bathymetry:{...truth.bathymetry,mode:'decorative-offsets'}};
  const terrainAgain:MapProject={...backToArtistic,bathymetry:{...backToArtistic.bathymetry,mode:'procedural-terrain'}};
  let cache:GeometryCache;
  const scenes:ManufacturingScene[]=[];
  for(const project of [artistic,terrain,truth,backToArtistic,terrainAgain]){
   const step=getCachedGeometryLayers(cache,project,caldronFallsFeatures);
   expect(step.reused).toBe(false);
   cache=step.cache;
   const scene=buildPresentationScene(project,caldronFallsFeatures,step.result);
   expect(scene).toEqual(buildScene(project,caldronFallsFeatures));
   scenes.push(scene);
  }
  const [a,t,b,a2,t2]=scenes;
  expect([a.depthMode,t.depthMode,b.depthMode,a2.depthMode,t2.depthMode]).toEqual(['decorative-offsets','procedural-terrain','true-bathymetry','decorative-offsets','procedural-terrain']);
  // Coming back reproduces the earlier scene exactly, even with another mode's settings still on
  // the project (a loaded dataset, terrain controls) — they are inert outside their own mode.
  expect(a2).toEqual(a);
  expect(t2).toEqual(t);
  expect(b.bathymetrySource).toBeDefined();expect(t.bathymetrySource).toBeUndefined();expect(t2.bathymetrySource).toBeUndefined();
  expect(depthLayers(b).every(l=>l.depthMeters!==undefined)).toBe(true);
  expect(depthLayers(t2).every(l=>l.depthMeters===undefined)).toBe(true);
  expect(a2.geometryMetrics!.artisticOffsetsNormalized).toBeDefined();expect(t2.geometryMetrics!.artisticOffsetsNormalized).toBeUndefined();
 });
});

describe('a shoreline the terrain cannot model',()=>{
 // A real water feature inside the Caldron crop, about 0.2mm wide and 200mm long on the product:
 // big enough to survive the 1mm² minimum-water filter, too narrow for any terrain grid cell.
 const sliver:ExtractedFeatures={...caldronFallsFeatures,water:[{id:'sliver',rings:[[{lng:-88.27,lat:45.36994},{lng:-88.135,lat:45.36994},{lng:-88.135,lat:45.37006},{lng:-88.27,lat:45.37006},{lng:-88.27,lat:45.36994}]]}]};

 it('is refused with a message that names the mode and says what to do',()=>{
  expect(()=>buildGeometryLayers(caldronFallsProject,sliver)).not.toThrow();
  expect(()=>buildScene(procedural(caldronFallsProject),sliver)).toThrow('PROCEDURAL TERRAIN selected, but the water in this crop is too small or too narrow to model as terrain at this product size. Choose Artistic Depth, zoom in, or enlarge the product.');
 });
});

// Production-sheet SVG of the Caldron Falls project fixture in Procedural Terrain mode at the default
// controls, pinned 2026-09-24 when the mode was first wired in.
const PINNED_PROJECT_SVG='a0c2adae78dba10f603e0be27152204198201ab081136bc27bdff6c884d02b35';
