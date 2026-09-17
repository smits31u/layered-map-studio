import {describe,expect,it} from 'vitest';
import {checkProviderCompatibility,isTierVisible,OPENFREEMAP,ROAD_CLASS_TIERS,roadClassesForDetail} from '../../src/ornament/map/provider';
import {allRoadLayerIds,buildOrnamentStyle,LAND_LAYER_ID,roadLayerId,visibleRoadLayerIds,WATER_LAYER_ID} from '../../src/ornament/map/style';
import type {RoadDetail} from '../../src/ornament/types';

const layerById=(detail:RoadDetail)=>new Map(buildOrnamentStyle(detail).layers.map(layer=>[String(layer.id),layer]));

describe('road detail policy',()=>{
 // Straight from the plan: "Low: motorway, trunk, primary, secondary. Medium: Low plus tertiary,
 // residential, unclassified/minor. High: Medium plus service, track, path, pedestrian."
 it('matches the plan tier by tier',()=>{
  expect(roadClassesForDetail('low')).toEqual(['motorway','trunk','primary','secondary']);
  for(const cls of ['tertiary','minor','residential','unclassified'])expect(roadClassesForDetail('medium')).toContain(cls);
  for(const cls of ['service','track','path','pedestrian'])expect(roadClassesForDetail('high')).toContain(cls);
 });

 it('is strictly cumulative',()=>{
  const low=roadClassesForDetail('low'),medium=roadClassesForDetail('medium'),high=roadClassesForDetail('high');
  for(const cls of low)expect(medium).toContain(cls);
  for(const cls of medium)expect(high).toContain(cls);
  expect(medium.length).toBeGreaterThan(low.length);
  expect(high.length).toBeGreaterThan(medium.length);
 });

 it('never lists the same class in two tiers',()=>{
  const all=[...ROAD_CLASS_TIERS.low,...ROAD_CLASS_TIERS.medium,...ROAD_CLASS_TIERS.high];
  expect(new Set(all).size).toBe(all.length);
 });

 it('excludes transport that is not a road',()=>{
  for(const cls of ['rail','ferry','aerialway','transit'])expect(roadClassesForDetail('high')).not.toContain(cls);
 });

 it('reports tier visibility cumulatively',()=>{
  expect(isTierVisible('low','low')).toBe(true);
  expect(isTierVisible('medium','low')).toBe(false);
  expect(isTierVisible('high','high')).toBe(true);
  expect(isTierVisible('medium','high')).toBe(true);
 });
});

describe('minimal ornament style',()=>{
 it('draws only land, water and roads',()=>{
  const ids=buildOrnamentStyle('high').layers.map(layer=>String(layer.id));
  expect(new Set(ids)).toEqual(new Set([LAND_LAYER_ID,WATER_LAYER_ID,...allRoadLayerIds()]));
 });

 it('declares one vector source pointing at the provider TileJSON',()=>{
  const style=buildOrnamentStyle('medium');
  expect(Object.keys(style.sources)).toEqual([OPENFREEMAP.sourceId]);
  expect(style.sources[OPENFREEMAP.sourceId]).toMatchObject({type:'vector',url:OPENFREEMAP.tileJsonUrl,attribution:OPENFREEMAP.attribution});
 });

 it('reads its source-layer names from the provider adapter rather than hard-coding them',()=>{
  const custom={...OPENFREEMAP,sourceId:'mine',sourceLayers:{water:'hydro',transportation:'ways'},tileJsonUrl:'https://example.test/tiles.json'};
  const layers=buildOrnamentStyle('high',custom).layers;
  expect(layers.find(l=>l.id===WATER_LAYER_ID)).toMatchObject({'source-layer':'hydro',source:'mine'});
  expect(layers.find(l=>l.id===roadLayerId('high'))).toMatchObject({'source-layer':'ways'});
 });

 it('shows exactly the tiers the detail level calls for',()=>{
  expect(visibleRoadLayerIds('low')).toEqual([roadLayerId('low')]);
  expect(visibleRoadLayerIds('medium')).toEqual([roadLayerId('low'),roadLayerId('medium')]);
  expect(visibleRoadLayerIds('high')).toEqual(allRoadLayerIds());
 });

 it('sets layer visibility to match the detail level at build time too',()=>{
  const low=layerById('low');
  expect((low.get(roadLayerId('low'))as{layout:{visibility:string}}).layout.visibility).toBe('visible');
  expect((low.get(roadLayerId('medium'))as{layout:{visibility:string}}).layout.visibility).toBe('none');
  expect((low.get(roadLayerId('high'))as{layout:{visibility:string}}).layout.visibility).toBe('none');
 });

 it('filters each tier to its own classes',()=>{
  const style=buildOrnamentStyle('high');
  for(const tier of ['low','medium','high'] as RoadDetail[]){
   const layer=style.layers.find(l=>l.id===roadLayerId(tier)) as {filter:unknown[]};
   expect(layer.filter[0]).toBe('in');
   expect(layer.filter[2]).toEqual(['literal',[...ROAD_CLASS_TIERS[tier]]]);
  }
 });

 it('draws major roads last so they sit above minor ones',()=>{
  const ids=buildOrnamentStyle('high').layers.map(layer=>String(layer.id));
  expect(ids.indexOf(roadLayerId('low'))).toBeGreaterThan(ids.indexOf(roadLayerId('high')));
 });

 it('needs no glyphs or sprites, because it renders no labels or icons',()=>{
  const style=buildOrnamentStyle('medium') as unknown as Record<string,unknown>;
  expect(style.glyphs).toBeUndefined();
  expect(style.sprite).toBeUndefined();
 });
});

describe('provider compatibility',()=>{
 it('accepts raw TileJSON that carries the required layers',()=>{
  expect(checkProviderCompatibility(OPENFREEMAP,{vector_layers:[{id:'water'},{id:'transportation'},{id:'place'}]})).toMatchObject({compatible:true});
 });

 it('accepts a live MapLibre vector source, which flattens the same list',()=>{
  expect(checkProviderCompatibility(OPENFREEMAP,{vectorLayerIds:['water','transportation']})).toMatchObject({compatible:true});
 });

 it('names the layers that have disappeared',()=>{
  const result=checkProviderCompatibility(OPENFREEMAP,{vectorLayerIds:['water']});
  expect(result.compatible).toBe(false);
  expect(result.missing).toEqual(['transportation']);
  expect(result.message).toContain('transportation');
 });

 it('says it does not know, rather than that layers are missing, when the source has not loaded',()=>{
  for(const source of [undefined,null,{},{vector_layers:'nope'}]){
   const result=checkProviderCompatibility(OPENFREEMAP,source);
   expect(result.compatible).toBe(false);
   expect(result.missing).toEqual([]);
  }
 });
});
