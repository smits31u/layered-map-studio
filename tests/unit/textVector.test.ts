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

// opentype.js 2.0.0 writes NaN into path data for a coordinate within ~1e-6 of a whole number (its
// roundDecimal builds "2.8e-14e+3" and parses it). Found by the topo export's non-finite preflight on
// a real "Golden Gate" title in Cinzel. textPathData snaps those coordinates first; everything else
// must format exactly as opentype formats it, so no existing output moves.
describe('opentype.js near-integer NaN',()=>{
 const withClose=(d:string)=>d.split('M').filter(Boolean).map(s=>{const sub=`M${s}`.trimEnd();return sub.endsWith('Z')?sub:`${sub}Z`}).join('');
 it('never writes NaN, in any bundled font, at any position — Cinzel\'s "Golden Gate" included',()=>{
  let raw=0;
  for(const id of ['inter','cinzel','great-vibes'] as const){
   const f=getLoadedFont(id)!;
   for(const text of ['Golden Gate','CALDRON FALLS','Wausau, WI 54401'])for(let x=-20;x<230;x+=1.37){
    const ours=textPathData(f,text,10,'center',x,217);
    expect(ours.d).not.toMatch(/NaN|Infinity/);
    // What opentype itself writes for the same layout, for comparison.
    const theirs=withClose(f.getPath(text,x-ours.widthMm/2,217,10).toPathData(3));
    if(/NaN/.test(theirs)){raw++;continue}
    expect(ours.d).toBe(theirs);
   }
  }
  // The bug is real and common: without the fix, hundreds of these layouts contain NaN.
  expect(raw).toBeGreaterThan(50);
 },60_000);
 it('the exact title that exposed it: Cinzel, 10 mm, at the live board\'s position',()=>{
  const {d}=textPathData(getLoadedFont('cinzel')!,'Golden Gate',10,'center',74.3,216.73);
  expect(d).not.toMatch(/NaN/);
  expect(d.length).toBeGreaterThan(1000);
 });
});
