import {describe,expect,it} from 'vitest';
import {getLoadedFont} from '../../src/text/fontRegistry';
import {measureTextWidthMm,textPathData} from '../../src/text/textVector';

const font=()=>{const f=getLoadedFont('inter');if(!f)throw new Error('inter font not preloaded by tests/setup.ts');return f};

describe('text-to-vector engine',()=>{
 it('measures text width proportionally to font size',()=>{
  const at10=measureTextWidthMm(font(),'CALDRON FALLS',10);
  const at20=measureTextWidthMm(font(),'CALDRON FALLS',20);
  expect(at20).toBeCloseTo(at10*2,4);
 });

 it('produces nonempty path data for real text',()=>{
  const {d,widthMm}=textPathData(font(),'Caldron Falls',8);
  expect(d.length).toBeGreaterThan(0);
  expect(d.startsWith('M')).toBe(true);
  expect(widthMm).toBeGreaterThan(0);
 });

 it('produces an empty-ish but non-throwing result for empty text',()=>{
  const {widthMm}=textPathData(font(),'',8);
  expect(widthMm).toBe(0);
 });

 it('center-anchors text so its bounds straddle x=0',()=>{
  const {bounds}=textPathData(font(),'Wisconsin',8,'center');
  expect(bounds.minX).toBeLessThan(0);
  expect(bounds.maxX).toBeGreaterThan(0);
 });

 it('left-anchors text so its bounds start at or after x=0',()=>{
  const {bounds}=textPathData(font(),'Wisconsin',8,'left');
  expect(bounds.minX).toBeGreaterThanOrEqual(-0.5); // small slack for left side-bearing
 });

 it('right-anchors text so its bounds end at or before x=0',()=>{
  const {bounds}=textPathData(font(),'Wisconsin',8,'right');
  expect(bounds.maxX).toBeLessThanOrEqual(0.5);
 });

 // opentype.js leaves contours geometrically closed but without a Z; manufacturing output states it
 // explicitly so a CAM importer cannot read a glyph contour as an open polyline. See textVector.ts.
 it('closes every glyph contour explicitly',()=>{
  const {d}=textPathData(font(),'CALDRON FALLS',8);
  const subpaths=d.split('M').filter(Boolean);
  expect(subpaths.length).toBeGreaterThanOrEqual([...'CALDRONFALLS'].length);
  for(const sub of subpaths)expect(sub.endsWith('Z')).toBe(true);
  expect(d).not.toMatch(/ZZ/);
 });

 it('keeps each closed contour geometrically coincident, not just Z-terminated',()=>{
  const {d}=textPathData(font(),'O',8);
  for(const sub of d.split('M').filter(Boolean)){
   // Path data packs a negative coordinate straight onto the previous one ("5.616-2.336"), so read
   // the numbers as tokens. Every command ends on its endpoint, making the last pair the subpath's.
   const nums=(sub.replace(/Z$/,'').match(/-?\d*\.?\d+/g)??[]).map(Number);
   expect(nums.length).toBeGreaterThanOrEqual(4);
   expect(nums.at(-2)).toBeCloseTo(nums[0],3);
   expect(nums.at(-1)).toBeCloseTo(nums[1],3);
  }
 });

 it('produces a taller/wider path for a larger font size',()=>{
  const small=textPathData(font(),'N',4);
  const large=textPathData(font(),'N',12);
  expect(large.bounds.maxY-large.bounds.minY).toBeGreaterThan(small.bounds.maxY-small.bounds.minY);
 });
});

describe('font registry',()=>{
 it('has all three fonts registered and preloaded for tests',()=>{
  for(const id of ['inter','cinzel','great-vibes'] as const){
   expect(getLoadedFont(id),`${id} should be preloaded`).toBeDefined();
  }
 });
});
