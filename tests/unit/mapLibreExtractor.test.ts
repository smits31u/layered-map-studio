import {describe,expect,it,vi} from 'vitest';
import {extractFeatures,extractMapLibreFeatures,type QueryBox} from '../../src/map/featureExtraction/mapLibreExtractor';

const box:QueryBox=[[10,20],[300,220]];
const feature=(sourceLayer:string,type:string,coordinates:any,properties:Record<string,any>={},id=1)=>({source:'provider-vector',sourceLayer,id,geometry:{type,coordinates},properties});

describe('visible MapLibre feature extraction',()=>{
 it('queries the crop box and transitions real provider features into manufacturing state',()=>{
  const queryRenderedFeatures=vi.fn().mockReturnValue([
   feature('water','Polygon',[[[-88.3,45.4],[-88.2,45.4],[-88.2,45.3],[-88.3,45.4]]]),
   feature('transportation','LineString',[[-88.3,45.35],[-88.2,45.36]],{class:'secondary',name:'County Road C'},2),
   feature('place','Point',[-88.21,45.36],{class:'village',name:'Caldron Falls'},3),
  ]);
  const result=extractMapLibreFeatures({getStyle:()=>({sources:{background:{type:'raster'},'provider-vector':{type:'vector'}}}),queryRenderedFeatures},box);
  expect(queryRenderedFeatures).toHaveBeenCalledWith(box);
  expect(result.water).toHaveLength(1);
  expect(result.roads).toEqual([expect.objectContaining({class:'secondary',name:'County Road C'})]);
 expect(result.places).toEqual([expect.objectContaining({name:'Caldron Falls'})]);
 });

 it('classifies actual Bright style metadata and conservatively deduplicates repeated rendered layers',()=>{
  const road=feature('transportation','LineString',[[-88.3,45.35],[-88.2,45.36]],{class:'track',name:'Forest Road'},2);
  const result=extractFeatures([road,{...road,layer:{id:'highway-minor-casing'}},feature('transportation_name','LineString',[[-88.3,45.35],[-88.2,45.36]],{class:'secondary',name:'County Road C'},3)]);
  expect(result.roads).toHaveLength(2);
  expect(result.roads.map(r=>r.name)).toEqual(['Forest Road','County Road C']);
 });

 it('reports raw features and the active style families before classification',()=>{
  const diagnostics=vi.fn(),raw={...feature('waterway','LineString',[[-88.3,45.35],[-88.2,45.36]],{class:'river'}),layer:{id:'waterway-river'}};
  extractMapLibreFeatures({getStyle:()=>({sources:{openmaptiles:{type:'vector'}},layers:[{id:'waterway-river',source:'openmaptiles','source-layer':'waterway'}]}),queryRenderedFeatures:()=>[raw]},box,diagnostics);
  expect(diagnostics).toHaveBeenCalledWith(expect.objectContaining({vectorSources:['openmaptiles'],rawCount:1,renderedLayerIds:['waterway-river'],styleLayers:expect.objectContaining({waterway:['waterway-river']})}));
 });

 it('reports provider failures instead of converting them to an empty success',()=>{
  const map={getStyle:()=>({sources:{openmaptiles:{type:'vector'}}}),queryRenderedFeatures:()=>{throw new Error('source unavailable')}};
  expect(()=>extractMapLibreFeatures(map,box)).toThrow('source unavailable');
 });

 it('rejects raster-only styles clearly',()=>{
  const map={getStyle:()=>({sources:{satellite:{type:'raster'}}}),queryRenderedFeatures:vi.fn()};
  expect(()=>extractMapLibreFeatures(map,box)).toThrow('no vector sources');
 });
});
