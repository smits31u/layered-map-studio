import {describe,expect,it} from 'vitest';
import {buildPlaceLabelObjects} from '../../src/geometry/scene/placeLabels';
import {CropProjection} from '../../src/geometry/projection/cropProjection';
import type {CropGeography,GeoPlace,MapProject} from '../../src/types/project';

const crop:CropGeography={nw:{lng:0,lat:1},ne:{lng:1,lat:1},se:{lng:1,lat:0},sw:{lng:0,lat:0},bbox:[0,0,1,1]};
const projection=new CropProjection(crop,100,100);
const config:MapProject['placeLabels']={classes:{city:true,town:true,village:true,hamlet:false},font:'inter',sizeMm:3};
const place=(id:string,name:string,cls:GeoPlace['class'],lng:number,lat:number):GeoPlace=>({id,name,class:cls,coordinate:{lng,lat}});

describe('place label scene objects',()=>{
 it('projects places through the canonical crop projection at their correct physical position',()=>{
  const objects=buildPlaceLabelObjects([place('a','Springfield','city',.5,.5)],projection,100,100,config,{});
  expect(objects).toHaveLength(1);
  // Web Mercator Y is nonlinear in latitude, so the geometric midpoint of a 1-degree-tall crop
  // isn't bit-exact at lat=0.5 — a loose tolerance here reflects the real projection, not a bug.
  expect(objects[0].defaultXMm).toBeCloseTo(50,5);
  expect(objects[0].defaultYMm).toBeCloseTo(50,1);
  expect(objects[0].xMm).toBe(objects[0].defaultXMm);
 });

 it('respects the class enable/disable toggles',()=>{
  const objects=buildPlaceLabelObjects([place('a','Rest Stop','hamlet',.5,.5)],projection,100,100,config,{});
  expect(objects).toHaveLength(0);
 });

 it('drops places outside the physical product bounds',()=>{
  const objects=buildPlaceLabelObjects([place('a','Offscreen','city',5,5)],projection,100,100,config,{});
  expect(objects).toHaveLength(0);
 });

 it('avoids exact duplicate labels (same name + class)',()=>{
  const objects=buildPlaceLabelObjects([place('a','Springfield','city',.3,.3),place('b','Springfield','city',.31,.31)],projection,100,100,config,{});
  expect(objects).toHaveLength(1);
 });

 it('keeps distinct names or classes even at the same point',()=>{
  const objects=buildPlaceLabelObjects([place('a','Springfield','city',.3,.3),place('b','Springfield','town',.3,.3)],projection,100,100,config,{});
  expect(objects).toHaveLength(2);
 });

 it('nudges a label whose default position nearly coincides with an already-placed one',()=>{
  const objects=buildPlaceLabelObjects([place('a','North Town','town',.3,.3),place('b','South Town','town',.301,.301)],projection,100,100,config,{});
  expect(objects).toHaveLength(2);
  expect(Math.hypot(objects[0].xMm-objects[1].xMm,objects[0].yMm-objects[1].yMm)).toBeGreaterThan(1);
 });

 it('applies a manual override as an absolute position, independent of the default',()=>{
  const objects=buildPlaceLabelObjects([place('a','Springfield','city',.5,.5)],projection,100,100,config,{'place-a':{xMm:10,yMm:20}});
  expect(objects[0].xMm).toBe(10);
  expect(objects[0].yMm).toBe(20);
  expect(objects[0].defaultXMm).toBeCloseTo(50,5); // default preserved for Reset
 });

 it('honors a visible:false override (Hide)',()=>{
  const objects=buildPlaceLabelObjects([place('a','Springfield','city',.5,.5)],projection,100,100,config,{'place-a':{visible:false}});
  expect(objects[0].visible).toBe(false);
 });
});
