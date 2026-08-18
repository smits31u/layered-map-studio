import {describe,expect,it} from 'vitest';
import {sceneToSvg} from '../../src/export/svg/exportSvg';
import type {ManufacturingScene} from '../../src/export/scene';

const baseScene:ManufacturingScene={
 widthMm:100,heightMm:100,
 layers:[{id:'layer-land',name:'Land / Top',shapes:[{id:'land-panel',operation:'cut',kind:'path',d:'M0 0L100 0L100 100L0 100Z'}]},{id:'layer-base',name:'Base',shapes:[{id:'base-panel',operation:'cut',kind:'rect',x:0,y:0,width:100,height:100}]}],
 objects:[],
};

describe('export group hygiene',()=>{
 it('an object shape whose group name is not in the known GROUP_ORDER list is still exported, not silently dropped',()=>{
  const scene:ManufacturingScene={...baseScene,objects:[{id:'future-thing',operation:'engrave',kind:'path',d:'M1 1L2 2',group:'future-object-type',objectId:'future-thing'}]};
  const svg=sceneToSvg(scene,'registered');
  expect(svg).toContain('future-thing');
  expect(svg).toContain('id="future-object-type"');
 });

 it('never emits two elements sharing the same group id across the cut and engrave subtrees (title vs title-backer)',()=>{
  const scene:ManufacturingScene={...baseScene,objects:[
   {id:'title-backer-panel',operation:'cut',kind:'path',d:'M0 0L10 0L10 5L0 5Z',group:'title-backer',objectId:'title'},
   {id:'title-text',operation:'engrave',kind:'path',d:'M1 1L2 2',group:'title',objectId:'title'},
  ]};
  const svg=sceneToSvg(scene,'registered');
  const doc=new DOMParser().parseFromString(svg,'image/svg+xml');
  const ids=[...doc.querySelectorAll('[id]')].map(el=>el.id);
  expect(new Set(ids).size).toBe(ids.length); // every id is unique
  expect(doc.querySelector('#title-backer')?.closest('[data-operation]')?.getAttribute('data-operation')).toBe('cut');
  expect(doc.querySelector('#title')?.closest('[data-operation]')?.getAttribute('data-operation')).toBe('engrave');
 });

 it('emits named groups only when they have content',()=>{
  const svg=sceneToSvg(baseScene,'registered');
  expect(svg).not.toContain('id="title"');
  expect(svg).not.toContain('id="compass"');
 });
});
