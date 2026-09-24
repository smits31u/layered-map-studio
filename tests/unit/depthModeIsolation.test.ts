import {createHash} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import {importDepthRegionGeoJson} from '../../src/bathymetry/model';
import {buildScene} from '../../src/export/buildScene';
import {geometryKeyOf} from '../../src/export/geometryCache';
import {individualSvgs,sceneToSvg} from '../../src/export/svg/exportSvg';
import {defaultProject} from '../../src/state/defaultProject';
import type {ExtractedFeatures,MapProject} from '../../src/types/project';
import {caldronFallsFeatures,caldronFallsProject} from '../fixtures/caldronFalls';
import {regressionFixtures,type RegressionFixture} from '../fixtures/regressionFixtures';

// Adding the procedural-terrain depth mode must not change the two existing modes at all. "Their
// tests still pass" is too weak a check for that — a test only looks at what it asserts. So each
// existing mode's complete output is fingerprinted here: the whole ManufacturingScene, every export
// layout, and the geometry-cache key that decides when it is rebuilt. PRE_TERRAIN was recorded from
// the code *before* the procedural mode existed (2026-09-24, at cb2ecb5). Any byte of difference in
// Artistic Depth or True Bathymetry output fails here.

const sha=(text:string)=>createHash('sha256').update(text).digest('hex');

function digest(project:MapProject,features:ExtractedFeatures){
 const scene=buildScene(project,features);
 const parts=[JSON.stringify(scene)];
 // A scene with a collapsed layer refuses to export by design; its scene JSON still pins it.
 if(!scene.manufacturingWarnings?.length)parts.push(sceneToSvg(scene,'production',10,true),sceneToSvg(scene,'registered',0,false),JSON.stringify(individualSvgs(scene)));
 return {scene:sha(parts.join('\u0000')),key:sha(geometryKeyOf(project)),exported:parts.length>1};
}

const fixtureProject=(fixture:RegressionFixture):MapProject=>{
 const [west,south,east,north]=fixture.crop.bbox;
 return {...defaultProject,map:{latitude:(south+north)/2,longitude:(west+east)/2,zoom:12,bearing:0,crop:fixture.crop},dimensions:{...defaultProject.dimensions,...fixture.dimensions}};
};

// The True Bathymetry golden fixture, built exactly as bathymetryGoldenSvg.test.ts builds it.
const rectangle=(depth:number,delta:number)=>({type:'Feature',properties:{depth,depth_unit:'ft'},geometry:{type:'Polygon',coordinates:[[[-88.21-delta,45.37-delta],[-88.21+delta,45.37-delta],[-88.21+delta,45.37+delta],[-88.21-delta,45.37+delta],[-88.21-delta,45.37-delta]]]}});
const imported=importDepthRegionGeoJson({type:'FeatureCollection',features:[rectangle(5,.025),rectangle(15,.015),rectangle(30,.007)]},'caldron-digitized.geojson');
// retrievedAt is a wall-clock stamp taken at import; it is pinned so the fingerprint tests geometry, not the clock.
const dataset={...imported,source:{...imported.source,retrievedAt:'2026-09-24T00:00:00.000Z'}};
const trueBathymetryProject:MapProject={...caldronFallsProject,bathymetry:{mode:'true-bathymetry',provider:'user',datasetId:dataset.source.datasetId,status:'available',selection:'automatic',thresholdsMeters:[],dataset}};

describe('existing depth modes are byte-identical to before procedural terrain existed',()=>{
 it('Artistic Depth on the Caldron Falls project fixture',()=>{
  const d=digest(caldronFallsProject,caldronFallsFeatures);
  expect(d.exported).toBe(true);
  expect(d).toEqual({...PRE_TERRAIN.artisticCaldronProject,exported:true});
 });

 it.each(regressionFixtures.map(f=>[f.lake,f] as const))('Artistic Depth on %s',(lake,fixture)=>{
  const d=digest(fixtureProject(fixture),{water:fixture.water,roads:[],places:[]});
  expect({scene:d.scene,key:d.key}).toEqual(PRE_TERRAIN.artisticLakes[lake]);
 });

 it('True Bathymetry on the golden fixture',()=>{
  const d=digest(trueBathymetryProject,caldronFallsFeatures);
  expect(d.exported).toBe(true);
  expect(d).toEqual({...PRE_TERRAIN.trueBathymetry,exported:true});
 });

});

// Recorded at cb2ecb5, before any procedural-terrain wiring existed.
const PRE_TERRAIN={
 artisticCaldronProject:{scene:'d5363fc5255f5126b0c1240e5108ffb18bc723dbbb998cd37474ff070bf86d77',key:'2785d5003de62ff8bc3c084997d0949c810b36c1e58aceedb311b8633735e258'},
 artisticLakes:{
  'Caldron Falls Reservoir':{scene:'1563f6c093ebb0cbfa48f0fac98e45dd715c5a97688b3097a05539eb1c337e7f',key:'090b8c2e00a92a40a320e28fd11dde319434e474b731ae2f4ce17b94a5f7b6cb'},
  'High Falls Reservoir':{scene:'45ad1c16c7f0d07a5e76cb0834ea3b17075715a87d6f59fbdbeaebbccb12fc22',key:'f95bf60564fcbbade7714e63899d1a2b72cbb0fe65dbf4f3b4681ff6a6faab40'},
  'Lake Noquebay':{scene:'f7d79c9c0628c576213d34e9dc5db8b8ce9b2d584e2db2ebbc5a1faa03f657ea',key:'9d1ac70f4eb6211cc8d3e2138a74d7ea9681e4696d920d4e24ef427bd0586e03'},
  'Wind Pudding Lake':{scene:'d3762aa4346ddde25d7a731a2a5c593d2d35257cc9897279c7624bca9092f3bd',key:'f365ea1a78f9ac406beb1a6dac648d1dd535fc3c62442874573dbac317d4e34d'},
 } as Record<string,{scene:string;key:string}>,
 trueBathymetry:{scene:'c22aed917c97c5d42b11cd9411766bee0b1803f349115cb57140e24a4e95cf27',key:'6c5588aa760b1685962d969639e5d7c6a5518b3426aeb12a2a59b7707fece2b1'},
};
