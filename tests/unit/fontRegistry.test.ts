import {afterEach,describe,expect,it} from 'vitest';
import type {FontId} from '../../src/types/project';
import {getFontLoadError,getLoadedFont,loadFont,setFontLoadErrorForTesting} from '../../src/text/fontRegistry';

// Phase 0 backlog item 4: a font load that genuinely fails (bad URL, corrupt file, network error)
// used to be indistinguishable from one that simply hadn't finished yet -- getLoadedFont returned
// undefined either way. This tests the new getFontLoadError state directly, using the test-only
// setFontLoadErrorForTesting seam (fonts are pre-registered as loaded globally in tests/setup.ts,
// so exercising the real fetch/opentype.parse failure path isn't practical here; the seam lets this
// test the state machine's distinction, which is exactly what downstream callers key off).

describe('fontRegistry load-error state',()=>{
 afterEach(()=>{setFontLoadErrorForTesting('inter',undefined)});

 it('reports no error for a font that has never failed',()=>{
  expect(getFontLoadError('inter')).toBeUndefined();
 });

 it('distinguishes "still loading" (no font, no error) from "failed" (no font, an error)',()=>{
  // In this test env 'inter' is pre-registered, so getLoadedFont would return it; the point here
  // is purely that the two states -- absent vs an actual Error -- are independently observable.
  expect(getFontLoadError('inter')).toBeUndefined();
  const error=new Error('Font "Inter" failed to load: HTTP 404');
  setFontLoadErrorForTesting('inter',error);
  expect(getFontLoadError('inter')).toBe(error);
  // A previously-resolved font is untouched by a later recorded failure -- getLoadedFont and
  // getFontLoadError are independent, so downstream code combines them rather than one gating
  // the other.
  expect(getLoadedFont('inter')).toBeTruthy();
 });

 it('clears the recorded failure once retried (the testing seam mirrors loadFont\'s own retry-clears-failure behaviour)',()=>{
  setFontLoadErrorForTesting('inter',new Error('boom'));
  expect(getFontLoadError('inter')).toBeDefined();
  setFontLoadErrorForTesting('inter',undefined);
  expect(getFontLoadError('inter')).toBeUndefined();
 });

 it('records a real, unmocked loadFont failure for an unregistered id',async()=>{
  const badId='not-a-real-font' as FontId;
  expect(getFontLoadError(badId)).toBeUndefined();
  await expect(loadFont(badId)).rejects.toThrow('Unknown font "not-a-real-font"');
  const error=getFontLoadError(badId);
  expect(error).toBeInstanceOf(Error);
  expect(error!.message).toBe('Unknown font "not-a-real-font"');
  expect(getLoadedFont(badId)).toBeUndefined();
 });
});
