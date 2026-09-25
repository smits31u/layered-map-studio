import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe,expect,it} from 'vitest';
import {decodePng,PngError} from '../../src/topo/terrain/png';
import {decodeTerrariumPng,decodeTerrariumRgba,PLAUSIBLE_ELEVATION_M,terrariumElevation} from '../../src/topo/terrain/terrarium';
import {encodePng,terrariumRgb,terrariumTile} from '../helpers/terrarium';

// Terrarium decode (plan §Terrain acquisition; acceptance: "Terrarium RGB fixtures decode to
// expected elevations").

describe('Terrarium elevation formula',()=>{
 // elevation = R·256 + G + B/256 − 32768, worked by hand.
 it.each([
  [[128,0,0],0],
  [[127,255,0],-1],
  [[128,1,128],1.5],
  [[129,110,64],366.25],
  [[130,74,46],586.1796875],
  [[128,0,1],1/256],
  [[127,255,255],-1/256],
  [[162,176,0],8880],
  [[85,76,0],-10932],
  [[0,0,0],-32768],
  [[255,255,255],32767+255/256],
 ] as const)('decodes RGB %j to %d m',(rgb,expected)=>{
  expect(terrariumElevation(rgb[0],rgb[1],rgb[2])).toBe(expected);
 });

 it('round-trips every value on the 1/256 m grid it is asked about, including below sea level and zero',()=>{
  for(const e of [-10932,-500.5,-1,-1/256,0,1/256,.5,1,99.99609375,586.1796875,8848.75])expect(terrariumElevation(...terrariumRgb(e))).toBe(e);
 });

 it('clamps implausible samples and counts them rather than passing them through',()=>{
  const rgba=new Uint8Array([0,0,0,255, 128,0,0,255, 255,255,255,255, 129,110,64,255]);
  const tile=decodeTerrariumRgba(rgba,2,2);
  expect(Array.from(tile.elevations)).toEqual([PLAUSIBLE_ELEVATION_M.min,0,PLAUSIBLE_ELEVATION_M.max,366.25]);
  expect(tile.clampedSamples).toBe(2);
 });

 it('refuses a non-square tile',()=>{
  expect(()=>decodeTerrariumRgba(new Uint8Array(4*2),2,1)).toThrow(/square/);
 });
});

describe('PNG decoder',()=>{
 const rgb=(w:number,h:number)=>{const p=new Uint8Array(w*h*3);for(let i=0;i<p.length;i++)p[i]=(i*37+(i>>3)*11)&255;return p};

 it.each([0,1,2,3,4])('inverts filter type %d exactly',filter=>{
  const pixels=rgb(9,7);
  const {width,height,rgba}=decodePng(encodePng(9,7,pixels,{filter}));
  expect([width,height]).toEqual([9,7]);
  for(let p=0;p<63;p++)expect([rgba[p*4],rgba[p*4+1],rgba[p*4+2],rgba[p*4+3]]).toEqual([pixels[p*3],pixels[p*3+1],pixels[p*3+2],255]);
 });

 it('inverts a different filter on every row',()=>{
  const pixels=rgb(16,15);
  const {rgba}=decodePng(encodePng(16,15,pixels,{filter:row=>row%5}));
  for(let p=0;p<16*15;p++)expect(rgba[p*4+1]).toBe(pixels[p*3+1]);
 });

 it('reads greyscale, grey+alpha, palette and RGBA images',()=>{
  expect(Array.from(decodePng(encodePng(2,1,Uint8Array.of(7,200),{colorType:0})).rgba)).toEqual([7,7,7,255,200,200,200,255]);
  expect(Array.from(decodePng(encodePng(1,1,Uint8Array.of(9,99),{colorType:4})).rgba)).toEqual([9,9,9,99]);
  expect(Array.from(decodePng(encodePng(2,1,Uint8Array.of(1,0),{colorType:3,palette:Uint8Array.of(1,2,3,4,5,6)})).rgba)).toEqual([4,5,6,255,1,2,3,255]);
  expect(Array.from(decodePng(encodePng(1,1,Uint8Array.of(1,2,3,4),{colorType:6,filter:4})).rgba)).toEqual([1,2,3,4]);
 });

 it('refuses what it cannot decode exactly, with a reason',()=>{
  const good=encodePng(2,2,rgb(2,2));
  expect(()=>decodePng(Uint8Array.of(1,2,3))).toThrow(PngError);
  expect(()=>decodePng(new TextEncoder().encode('<html>Not found</html>'))).toThrow(/signature/);
  expect(()=>decodePng(good.subarray(0,good.length-20))).toThrow(/Truncated/);
  expect(()=>decodePng(encodePng(2,2,rgb(2,2),{bitDepth:16}))).toThrow(/bit depth 16/);
  expect(()=>decodePng(encodePng(2,2,rgb(2,2),{interlace:1}))).toThrow(/Interlaced/);
  expect(()=>decodePng(encodePng(2,2,rgb(2,2),{filter:7}))).toThrow(/filter type 7/);
 });
});

describe('a real Terrarium tile',()=>{
 // tests/fixtures/terrain/terrarium-12-1027-1474.png: AWS Terrain Tiles (Mapzen), the z12 tile
 // containing Rib Mountain, Wisconsin. Reference values below were computed from the same file with
 // Python's PIL, independently of this decoder (see the fixture README).
 const bytes=new Uint8Array(readFileSync(resolve(__dirname,'..','fixtures','terrain','terrarium-12-1027-1474.png')));

 it('decodes to exactly the pixels PIL decodes',()=>{
  const {width,height,rgba}=decodePng(bytes);
  expect([width,height]).toEqual([256,256]);
  expect(createHash('sha256').update(rgba).digest('hex')).toBe('1fe056cc69f40c53293189c5f864f546e816e944fcb752722c013389a93f356b');
 });

 it('has Rib Mountain where it should be, at the height it should be',()=>{
  const tile=decodeTerrariumPng(bytes);
  const at=(x:number,y:number)=>tile.elevations[y*256+x];
  expect(at(0,0)).toBe(368.3359375);
  expect(at(128,128)).toBe(366.25);
  expect(at(255,255)).toBe(362.7734375);
  let max=-Infinity,maxAt=-1;
  tile.elevations.forEach((e,i)=>{if(e>max){max=e;maxAt=i}});
  // The summit is published as 1,924 ft (586 m); the tile's highest pixel agrees.
  expect(max).toBe(586.1796875);
  expect([maxAt%256,Math.floor(maxAt/256)]).toEqual([120,181]);
  expect(tile.clampedSamples).toBe(0);
 });
});

describe('synthetic Terrarium tiles',()=>{
 it('decode to exactly the elevations they were built from',()=>{
  const f=(x:number,y:number)=>Math.round((x*3.25-y*7.5+(x*y)/64-120)*256)/256;
  const tile=decodeTerrariumPng(terrariumTile(f,4));
  for(const [x,y] of [[0,0],[255,0],[0,255],[17,203],[255,255]])expect(tile.elevations[y*256+x]).toBe(f(x,y));
 });
});
