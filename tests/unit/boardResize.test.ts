import {describe,expect,it} from 'vitest';
import {resizeBoard} from '../../src/state/boardResize';
import {defaultProject} from '../../src/state/defaultProject';
import {cropContains,cropStretch,fitCropToBoard} from '../../src/geometry/projection/cropAspect';
import {cornerPosition} from '../../src/geometry/scene/compass';
import type {MapProject} from '../../src/types/project';

// 2026-10-15 audit: changing the board size kept the old crop, so the map stretched x1.127 on export
// (14x11 -> 18x12), and the title stayed at y=265 mm, off a 10 in tall board.

const W14=355.6,H11=279.4,W18=457.2,H12=304.8;
const captured=fitCropToBoard({nw:{lng:-88.32,lat:45.45},ne:{lng:-88.1,lat:45.45},se:{lng:-88.1,lat:45.3},sw:{lng:-88.32,lat:45.3},bbox:[-88.32,45.3,-88.1,45.45]},W14,H11);
const base:MapProject={...defaultProject,map:{...defaultProject.map,crop:captured}};
const resized=(p:MapProject,widthMm:number,heightMm:number)=>({...p,dimensions:{...p.dimensions,widthMm,heightMm}});
const previous=(p:MapProject)=>({...p.dimensions,crop:p.map.crop});

describe('resizeBoard',()=>{
 it('refits the crop to the new board inside the captured crop, so nothing stretches',()=>{
  expect(cropStretch(captured,W18,H12)).toBeCloseTo(1.179,3); // what the old code exported
  const next=resizeBoard(resized(base,W18,H12),previous(base),captured);
  expect(cropStretch(next.map.crop!,W18,H12)).toBeCloseTo(1,9);
  expect(cropContains(captured,next.map.crop!)).toBe(true);
 });

 it('refits from the captured crop each time, so a size change and back returns the same crop',()=>{
  const wide=resizeBoard(resized(base,W18,H12),previous(base),captured);
  const back=resizeBoard(resized(wide,W14,H11),previous(wide),captured);
  for(const corner of ['nw','ne','se','sw'] as const)expect(back.map.crop![corner].lng).toBeCloseTo(captured[corner].lng,9);
 });

 it('without a capture, refits the current crop',()=>{
  const next=resizeBoard(resized(base,254,254),previous(base));
  expect(cropStretch(next.map.crop!,254,254)).toBeCloseTo(1,9);
  expect(cropContains(captured,next.map.crop!)).toBe(true);
 });

 it('keeps a crop set together with the size (the crop JSON tool)',()=>{
  const other=fitCropToBoard(captured,W18,H12),next=resizeBoard({...resized(base,W18,H12),map:{...base.map,crop:other}},previous(base),captured);
  expect(next.map.crop).toBe(other);
 });

 it('moves the title and subtitle in proportion, so they stay on a smaller board',()=>{
  const next=resizeBoard(resized(base,W14,254),previous(base),captured);
  expect(base.title.yMm).toBe(265);
  expect(next.title.yMm).toBeCloseTo(265*254/H11,9);
  expect(next.title.yMm).toBeLessThan(254);
  expect(next.title.xMm).toBeCloseTo(base.title.xMm,9);
  expect(next.subtitle.yMm).toBeCloseTo(base.subtitle.yMm*254/H11,9);
 });

 it('keeps a corner compass in its corner and scales a custom one, and scales dragged positions',()=>{
  const corner=resizeBoard(resized({...base,compass:{...base.compass,position:'bottom-right'}},W18,H12),previous(base),captured);
  expect({xMm:corner.compass.xMm,yMm:corner.compass.yMm}).toEqual(cornerPosition('bottom-right',W18,H12,base.compass.sizeMm));
  const custom={...base,compass:{...base.compass,position:'custom' as const,xMm:100,yMm:100},overrides:{title:{xMm:50,yMm:200,rotationDeg:5},'place-1':{xMm:10,yMm:10}}};
  const next=resizeBoard(resized(custom,W18,H12),previous(custom),captured);
  expect(next.compass.xMm).toBeCloseTo(100*W18/W14,9);
  expect(next.compass.yMm).toBeCloseTo(100*H12/H11,9);
  expect(next.overrides.title!.xMm).toBeCloseTo(50*W18/W14,9);expect(next.overrides.title!.yMm).toBeCloseTo(200*H12/H11,9);expect(next.overrides.title!.rotationDeg).toBe(5);
  expect(next.overrides['place-1']).toEqual({xMm:10,yMm:10});
 });

 it('changes nothing when the size did not change',()=>{
  const p={...base,title:{...base.title,text:'Caldron Falls'}};
  expect(resizeBoard(p,previous(base),captured)).toBe(p);
 });
});
