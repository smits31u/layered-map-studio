import {describe,expect,it} from 'vitest';
import {encodePng,readPngInfo} from '../../src/production/preview3d/png';
import {EXPORT_ASPECTS,EXPORT_WIDTHS,MIN_PROOF_LONG_SIDE,PROOF_BACKGROUND,exportSize,finalizePreviewPng} from '../../src/production/preview3d/previewImage';

// V2 Step 1 (A6): customer proofs and listing photos are at least 2000 px on the long side, on an
// opaque neutral background.

const meta={title:'Proof',appVersion:'test',createdAt:'2026-10-20T12:00:00.000Z',watermarked:false};
const blank=(w:number,h:number)=>encodePng(new Uint8Array(w*h*4),w,h);

describe('proof image size',()=>{
 it('every width and shape on offer is at least 2000 px on its long side',()=>{
  expect(MIN_PROOF_LONG_SIDE).toBe(2000);
  for(const width of EXPORT_WIDTHS)for(const aspect of EXPORT_ASPECTS){
   const size=exportSize(width,aspect.id);
   expect(Math.max(size.width,size.height)).toBeGreaterThanOrEqual(MIN_PROOF_LONG_SIDE);
  }
 });
 it('an image at the floor is finalized; one below it is refused',()=>{
  const ok=finalizePreviewPng(blank(2000,4),{width:2000,height:4},meta);
  expect(readPngInfo(ok)).toMatchObject({width:2000,height:4});
  expect(()=>finalizePreviewPng(blank(1999,4),{width:1999,height:4},meta)).toThrow(/at least 2000 px on its long side/);
 });
 it('the long side may be the height',()=>{
  expect(()=>finalizePreviewPng(blank(4,2400),{width:4,height:2400},meta)).not.toThrow();
 });
 it('the proof background is an opaque light neutral',()=>{
  const [r,g,b]=[1,3,5].map(i=>parseInt(PROOF_BACKGROUND.slice(i,i+2),16));
  // Neutral: no channel more than 8 apart. Light: every channel above 220.
  expect(Math.max(r,g,b)-Math.min(r,g,b)).toBeLessThanOrEqual(8);
  expect(Math.min(r,g,b)).toBeGreaterThan(220);
 });
});
