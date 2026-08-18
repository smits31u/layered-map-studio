import {describe,expect,it} from 'vitest';
import {canvasLocalQueryBox} from '../../src/map/mapViewer/queryBox';
import {cropFrameStyle} from '../../src/map/mapViewer/MapViewer';

const rect=(left:number,top:number,width:number,height:number)=>({left,top,right:left+width,bottom:top+height,width,height});

describe('MapLibre crop query geometry',()=>{
 it('provides the CSS variable used to size the physical crop frame',()=>{
  expect(cropFrameStyle(355.6,279.4)).toMatchObject({aspectRatio:String(355.6/279.4),'--ratio':355.6/279.4});
 });
 it('removes page/sidebar offsets and returns CSS-pixel canvas coordinates',()=>{
  expect(canvasLocalQueryBox(rect(530,120,700,550),rect(330,46,1200,800))).toEqual([[200,74],[900,624]]);
 });
 it('clips the crop to the canvas without applying device-pixel ratio',()=>{
  expect(canvasLocalQueryBox(rect(300,20,1300,900),rect(330,46,1200,800))).toEqual([[0,0],[1200,800]]);
 });
 it('rejects zero-sized and non-overlapping crops',()=>{
  expect(()=>canvasLocalQueryBox(rect(500,100,0,200),rect(330,46,1200,800))).toThrow('no area');
  expect(()=>canvasLocalQueryBox(rect(10,10,100,100),rect(330,46,1200,800))).toThrow('outside');
 });
});
