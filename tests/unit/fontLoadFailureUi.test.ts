import {afterEach,describe,expect,it} from 'vitest';
import {buildScene} from '../../src/export/buildScene';
import {forgetFontForTesting,registerFontForTesting,setFontLoadErrorForTesting} from '../../src/text/fontRegistry';
import {caldronFallsFeatures,caldronFallsProject} from '../fixtures/caldronFalls';
import type {MapProject} from '../../src/types/project';

// Phase 0 backlog item 4, continued: requireFont() (src/export/buildScene.ts) is the lake tool's
// synchronous point of failure for a missing font. It used to say "is still loading — wait a
// moment and try again" whether the font was genuinely loading or had permanently failed. This
// checks the two are now told apart at that call site.
//
// A font that has already resolved successfully stays ready forever, regardless of a later failed
// retry (loadFont only ever attempts a fetch again once no cached font exists — see
// getFontLoadError's docs in fontRegistry.ts) — that combination is deliberately untested in
// fontRegistry.test.ts. The only reachable "genuinely failed" state is one where the font never
// resolved in the first place, so these tests use forgetFontForTesting to undo tests/setup.ts's
// global pre-registration before recording a failure, then restore it via registerFontForTesting.

const project:MapProject={...caldronFallsProject,title:{...caldronFallsProject.title,text:'CALDRON FALLS'}};

describe('buildScene requireFont surfaces a real load failure distinctly from "still loading"',()=>{
 afterEach(()=>{setFontLoadErrorForTesting(project.title.font,undefined)});

 it('builds normally (no recorded failure) as the baseline for the next test',()=>{
  expect(()=>buildScene(project,caldronFallsFeatures)).not.toThrow();
 });

 it('throws a message naming the real failure, not "still loading", once one is recorded',()=>{
  const savedFont=forgetFontForTesting(project.title.font);
  try{
   setFontLoadErrorForTesting(project.title.font,new Error(`Font "Cinzel" failed to load: HTTP 404`));
   expect(()=>buildScene(project,caldronFallsFeatures)).toThrow(/failed to load: HTTP 404/);
   expect(()=>buildScene(project,caldronFallsFeatures)).not.toThrow(/still loading/);
  }finally{
   if(savedFont)registerFontForTesting(project.title.font,savedFont);
  }
 });

 it('clearing the recorded failure (a successful retry) restores normal building',()=>{
  const savedFont=forgetFontForTesting(project.title.font);
  try{
   setFontLoadErrorForTesting(project.title.font,new Error('boom'));
   expect(()=>buildScene(project,caldronFallsFeatures)).toThrow();
  }finally{
   setFontLoadErrorForTesting(project.title.font,undefined);
   if(savedFont)registerFontForTesting(project.title.font,savedFont);
  }
  expect(()=>buildScene(project,caldronFallsFeatures)).not.toThrow();
 });
});
