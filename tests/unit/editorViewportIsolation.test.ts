import {describe,expect,it} from 'vitest';
import {buildScene} from '../../src/export/buildScene';
import {sceneToSvg,individualSvgs} from '../../src/export/svg/exportSvg';
import {caldronFallsFeatures,caldronFallsProject} from '../fixtures/caldronFalls';
import {screenDeltaToMm} from '../../src/geometry/scene/overrides';
import type {MapProject} from '../../src/types/project';

// EditorViewport (src/geometry/scene/viewport.ts) is never a parameter of buildScene,
// buildGeometryLayers, buildPresentationScene, or any SVG serializer — this is an architectural
// invariant, not something that happens to be true today. These tests exercise the actual public
// API surface those functions expose and confirm there is no way to make editor zoom/pan affect
// physical output, short of literally changing MapProject.dimensions.
describe('M-LIVE: editor viewport state cannot leak into export geometry',()=>{
 it('buildScene output is identical regardless of any "current editor zoom" a caller might imagine — there is no such parameter to pass',()=>{
  // buildScene's signature is (project, features) => ManufacturingScene. There is no third
  // argument for viewport/zoom/pan; TypeScript would reject one. Calling it twice with identical
  // project/features must therefore always produce identical output.
  const a=buildScene(caldronFallsProject,caldronFallsFeatures);
  const b=buildScene(caldronFallsProject,caldronFallsFeatures);
  expect(a).toEqual(b);
 });

 it('exported SVG physical width/height/viewBox are identical across simulated 50%, 100%, and 200% editor zoom sessions',()=>{
  // Since the export functions take no viewport argument, "simulating" different zoom levels
  // means nothing more than calling them multiple times — proving there is no hidden global/module
  // state a zoom level could have poisoned.
  const scene=buildScene(caldronFallsProject,caldronFallsFeatures);
  const svgs=[0.5,1,2].map(()=>sceneToSvg(scene,'production'));
  const dims=svgs.map(svg=>{
   const doc=new DOMParser().parseFromString(svg,'image/svg+xml');
   return{width:doc.documentElement.getAttribute('width'),height:doc.documentElement.getAttribute('height'),viewBox:doc.documentElement.getAttribute('viewBox')};
  });
  expect(new Set(dims.map(d=>JSON.stringify(d))).size).toBe(1);
  expect(dims[0].width).toBe('1818mm'); // 5 panels * 355.6mm + 4*10mm gap, exact — see caldronFalls.test.ts
 });

 it('individual-layer SVGs stay at the exact 355.6 x 279.4mm physical size regardless of how many times exported ("re-exporting at a different zoom")',()=>{
  const scene=buildScene(caldronFallsProject,caldronFallsFeatures);
  for(let i=0;i<3;i++){
   const files=individualSvgs(scene);
   for(const svg of Object.values(files)){
    const root=new DOMParser().parseFromString(svg,'image/svg+xml').documentElement;
    expect(root.getAttribute('width')).toBe('355.6mm');
    expect(root.getAttribute('height')).toBe('279.4mm');
   }
  }
 });

 it('MapProject has no viewport/zoom/pan field for a stray write to accidentally reach',()=>{
  const keys=Object.keys(caldronFallsProject);
  expect(keys).not.toContain('viewport');
  expect(keys).not.toContain('zoom');
  expect(keys).not.toContain('editorZoom');
 });
});

describe('M-LIVE: pointer drag stays physically correct under editor zoom (pure math)',()=>{
 // screenDeltaToMm (used by the object-drag handlers in GeneratedPreview.tsx) reads the SVG's
 // actual getScreenCTM(), which the browser computes by walking every ancestor CSS transform —
 // including the editor's own zoom/pan wrapper. Simulating that scale factor directly here proves
 // the same screen-pixel drag produces a proportionally smaller/larger mm delta at different
 // editor zoom levels, exactly as dragging a physically-fixed-size object under a magnifying glass
 // should behave, with no special-casing required in the drag handlers themselves.
 const fakeSvgAtScale=(pxPerMm:number)=>({getScreenCTM:()=>({a:pxPerMm,d:pxPerMm})}) as unknown as SVGSVGElement;
 const BASE_PX_PER_MM=3.29; // matches the real measured scale from manual browser verification

 it('the same screen-pixel drag yields a smaller mm delta at 200% editor zoom than at 100%',()=>{
  const at100=screenDeltaToMm(fakeSvgAtScale(BASE_PX_PER_MM),40,30);
  const at200=screenDeltaToMm(fakeSvgAtScale(BASE_PX_PER_MM*2),40,30);
  expect(at200.dxMm).toBeCloseTo(at100.dxMm/2,6);
  expect(at200.dyMm).toBeCloseTo(at100.dyMm/2,6);
 });

 it('the same screen-pixel drag yields a larger mm delta at 50% editor zoom than at 100%',()=>{
  const at100=screenDeltaToMm(fakeSvgAtScale(BASE_PX_PER_MM),40,30);
  const at50=screenDeltaToMm(fakeSvgAtScale(BASE_PX_PER_MM*0.5),40,30);
  expect(at50.dxMm).toBeCloseTo(at100.dxMm*2,6);
  expect(at50.dyMm).toBeCloseTo(at100.dyMm*2,6);
 });

 it('a physical-mm drag target is reached with the correspondingly different screen-pixel distance at each zoom',()=>{
  const targetMm=12;
  for(const zoom of [0.5,1,2]){
   const pxPerMm=BASE_PX_PER_MM*zoom;
   const requiredPx=targetMm*pxPerMm;
   const {dxMm}=screenDeltaToMm(fakeSvgAtScale(pxPerMm),requiredPx,0);
   expect(dxMm).toBeCloseTo(targetMm,6);
  }
 });
});

describe('M-LIVE: sanity — Caldron Falls regression still holds after buildScene split',()=>{
 it('exactly five physical panels at exactly 355.6 x 279.4 mm each',()=>{
  const scene=buildScene(caldronFallsProject,caldronFallsFeatures);
  expect(scene.layers).toHaveLength(5);
  expect(scene.widthMm).toBe(355.6);
  expect(scene.heightMm).toBe(279.4);
 });

 it('a full 7-layer project still produces 6 complete panels plus base',()=>{
  const allLayers:MapProject={...caldronFallsProject,shoreline:{...caldronFallsProject.shoreline,enabledLayers:Array(7).fill(true)}};
  const scene=buildScene(allLayers,caldronFallsFeatures);
  expect(scene.layers).toHaveLength(7);
 });
});
