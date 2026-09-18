import {describe,expect,it} from 'vitest';
import {importDepthRegionGeoJson} from '../../src/bathymetry/model';
import {buildScene} from '../../src/export/buildScene';
import {sceneToSvg,individualSvgs} from '../../src/export/svg/exportSvg';
import {caldronFallsFeatures,caldronFallsProject} from '../fixtures/caldronFalls';
const rectangle=(depth:number,delta:number,extra:any={})=>({type:'Feature',properties:{depth,depth_unit:'ft'},geometry:{type:'Polygon',coordinates:[[[-88.21-delta,45.37-delta],[-88.21+delta,45.37-delta],[-88.21+delta,45.37+delta],[-88.21-delta,45.37+delta],[-88.21-delta,45.37-delta]]]},...extra});
const imported=importDepthRegionGeoJson({type:'FeatureCollection',features:[rectangle(5,.025),rectangle(15,.015),rectangle(30,.007)]},'caldron-digitized.geojson');
const trueBathymetryProject={...caldronFallsProject,bathymetry:{mode:'true-bathymetry' as const,provider:'user' as const,datasetId:imported.source.datasetId,status:'available' as const,selection:'automatic' as const,thresholdsMeters:[],dataset:imported}};
const scene=buildScene(trueBathymetryProject,caldronFallsFeatures);
describe('bathymetry golden-fixture SVG export',()=>{
 it('exports a production-layout SVG from a real true-bathymetry scene',()=>{const svg=sceneToSvg(scene,'production',10,true);expect(svg.startsWith('<svg ')).toBe(true);expect(svg.trim().endsWith('</svg>')).toBe(true)});
 it('balances every <g> open tag with a matching close, and every shape is self-closed',()=>{const svg=sceneToSvg(scene,'registered',0,false);const gOpens=(svg.match(/<g /g)??[]).length,gCloses=(svg.match(/<\/g>/g)??[]).length;expect(gOpens).toBeGreaterThan(0);expect(gOpens).toBe(gCloses);const shapeOpens=[...svg.matchAll(/<(rect|path)[^>]*>/g)];expect(shapeOpens.length).toBeGreaterThan(0);for(const[tag]of shapeOpens)expect(tag.endsWith('/>')).toBe(true)});
 it('emits correctly-named depth-layer group ids matching the i+1 indexing',()=>{const svg=sceneToSvg(scene,'registered',0,false);for(const id of['layer-depth-2','layer-depth-3','layer-depth-4']){expect(svg).toContain(`<g id="${id}"`);expect(svg).toContain(`<g id="${id}-cut"`);expect(svg).toContain(`<g id="${id}-engrave"`)}expect(svg).toContain('<g id="layer-land"');expect(svg).toContain('<g id="layer-base"')});
 it('contains no NaN or Infinity in any path d attribute',()=>{const svg=sceneToSvg(scene,'production',10,true);for(const[,d]of svg.matchAll(/ d="([^"]+)"/g))expect(d).not.toMatch(/NaN|Infinity/)});
 it('closes every cut path with Z, every subpath',()=>{const svg=sceneToSvg(scene,'registered',0,false);for(const[,body]of svg.matchAll(/<g id="[^"]*-cut"[^>]*>(.*?)<\/g>/gs))for(const[,d]of body.matchAll(/ d="([^"]+)"/g))expect(d.split(/(?=M)/).filter(Boolean).every(sub=>/Z\s*$/.test(sub.trim()))).toBe(true)});
 it('individual SVGs export one well-formed file per depth layer, each carrying its own layer id',()=>{const files=individualSvgs(scene);expect(Object.keys(files)).toEqual(expect.arrayContaining(['layer-depth-2.svg','layer-depth-3.svg','layer-depth-4.svg']));const depth3=files['layer-depth-3.svg'];expect(depth3.startsWith('<svg ')).toBe(true);expect(depth3).toContain('<g id="layer-depth-3"');expect(depth3).not.toContain('layer-depth-2')});
 it('is byte-identical across repeated exports of the same scene',()=>{expect(sceneToSvg(scene,'production',10,true)).toBe(sceneToSvg(scene,'production',10,true))});
});
