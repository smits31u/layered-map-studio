import {describe,expect,it} from 'vitest';
import {buildWaterModel,multiPolygonArea,offsetWater,panelFromWater,validatePanel} from '../../src/geometry/shoreline/polygonEngine';
import {CropProjection} from '../../src/geometry/projection/cropProjection';
import type {CropGeography,GeoPolygon} from '../../src/types/project';
const crop:CropGeography={nw:{lng:0,lat:1},ne:{lng:1,lat:1},se:{lng:1,lat:0},sw:{lng:0,lat:0},bbox:[0,0,1,1]};
const projection=new CropProjection(crop,100,100);
const polygon=(id:string,x1:number,y1:number,x2:number,y2:number):GeoPolygon=>({id,rings:[[{lng:x1,lat:y1},{lng:x2,lat:y1},{lng:x2,lat:y2},{lng:x1,lat:y2},{lng:x1,lat:y1}]]});
describe('physical polygon engine',()=>{
 it('unions adjacent tile fragments before offsets and clips to the product',()=>{const model=buildWaterModel([polygon('a',-.1,.2,.5,.8),polygon('b',.5,.2,1.1,.8)],projection,100,100,{mode:'all',minAreaMm2:0});expect(model.metrics.normalizedPolygonComponents).toBe(2);expect(model.metrics.unionedComponents).toBe(1);expect(model.water).toHaveLength(1);validatePanel(panelFromWater(model.water,100,100),100,100,'Land')});
 it('selects the component containing the focus point and filters physical noise',()=>{const model=buildWaterModel([polygon('major',.1,.1,.6,.6),polygon('tiny',.9,.9,.901,.901)],projection,100,100,{mode:'primary',minAreaMm2:1,focus:{lng:.3,lat:.3}});expect(model.water).toHaveLength(1);expect(multiPolygonArea(model.water)).toBeGreaterThan(1000)});
 it('creates monotonic expanded openings using literal millimeter offsets',()=>{const model=buildWaterModel([polygon('water',.2,.2,.8,.8)],projection,100,100,{mode:'all'}),areas=[0,2.5,6,12].map(offset=>multiPolygonArea(offsetWater(model.water,offset,100,100)));expect(areas[1]).toBeGreaterThan(areas[0]);expect(areas[2]).toBeGreaterThan(areas[1]);expect(areas[3]).toBeGreaterThan(areas[2])});
});
