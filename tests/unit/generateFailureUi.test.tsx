import {afterEach,describe,expect,it} from 'vitest';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import App from '../../src/App';
import {Controls} from '../../src/components/controls/Controls';
import {GeneratedPreview} from '../../src/components/preview/GeneratedPreview';
import {defaultProject} from '../../src/state/defaultProject';
import {buildScene} from '../../src/export/buildScene';
import {caldronFallsFeatures,caldronFallsProject} from '../fixtures/caldronFalls';

// A generate that is correctly refused used to be indistinguishable from a dead button: the reason
// went to the diagnostics block at the bottom of an overflowing sidebar, below twelve expanded
// sections, in the same plain <b> that says "Done". The Generated Map panel then showed its
// never-generated-yet placeholder, so the one screen the user was looking at said nothing about the
// failure at all. These tests assert the refusal is visible where the click happened, where the eye
// lands, and without scrolling — not merely that it was recorded somewhere.

// Not a copied string: the real refusal, thrown by the real pipeline on the real Caldron Falls
// data with True Bathymetry selected and nothing imported — the exact case being tested. If the
// wording or the guard ever changes, these tests follow it instead of asserting against a stale
// literal.
const TRUE_BATHYMETRY_REFUSAL=(()=>{
 try{buildScene({...caldronFallsProject,bathymetry:{...caldronFallsProject.bathymetry,mode:'true-bathymetry',dataset:undefined}},caldronFallsFeatures);return '(true bathymetry was not refused)'}
 catch(reason){return (reason as Error).message}
})();

const openEverySection=()=>{for(const section of document.querySelectorAll('details'))section.setAttribute('open','')};
const depthModeSelect=()=>screen.getAllByRole('combobox').find(node=>[...(node as HTMLSelectElement).options].some(option=>option.value==='true-bathymetry')) as HTMLSelectElement;
const controlProps={project:defaultProject,setProject:()=>{},onSelect:()=>{},onGenerate:()=>{},onExport:()=>{},counts:{water:0,roads:0,namedRoads:0,places:0}};

describe('a refused generate is impossible to miss',()=>{
 afterEach(cleanup);

 // The end-to-end path, driven exactly as a user drives it: pick True Bathymetry, press the button,
 // read the screen. The message differs by which guard trips first (this environment has no crop
 // extracted, so the crop guard answers before the bathymetry one) — what is asserted here is that
 // whatever generate refuses with reaches all three surfaces instead of one buried one.
 it('routes a thrown generate to the sidebar, the always-visible banner, and the preview',()=>{
  render(<App/>);
  openEverySection();
  fireEvent.change(depthModeSelect(),{target:{value:'true-bathymetry'}});
  fireEvent.click(screen.getByText('Generate scene'));

  const reported=screen.getAllByRole('alert').map(node=>node.textContent??'').filter(text=>/generation|dataset|crop/i.test(text));
  // Next to the button that was pressed, and in the workspace banner that needs no scrolling.
  expect(reported.length).toBeGreaterThanOrEqual(2);
  expect(document.querySelector('.nav-error')?.textContent).toBe(reported[0]);
  // A refusal must not leave the status line reading like a success.
  expect(screen.getByText('Generate failed')).toHaveProperty('className','error');

  // And the panel the user switches to explains itself rather than showing the never-ran placeholder.
  fireEvent.click(screen.getByText('Generated Map'));
  const panel=document.querySelector('.empty')!;
  expect(within(panel as HTMLElement).getByRole('alert').textContent).toContain('Generate failed:');
  expect(panel.textContent).not.toContain('Load vector features, then generate the manufacturing scene.');
 });

 it('shows the true-bathymetry refusal verbatim where the eye lands, not a generic placeholder',()=>{
  render(<GeneratedPreview featuresLoaded error={TRUE_BATHYMETRY_REFUSAL}/>);
  // Guards the derivation above: if the guard stopped firing, the constant would be the fallback
  // string and every assertion below would still pass against it.
  expect(TRUE_BATHYMETRY_REFUSAL).toContain('TRUE BATHYMETRY selected');
  const alert=screen.getByRole('alert');
  expect(alert.textContent).toBe(`Generate failed: ${TRUE_BATHYMETRY_REFUSAL}`);
  expect(alert.className).toBe('error');
  expect(screen.queryByText(/Click Generate scene to build/)).toBeNull();
 });

 it('puts the same refusal beside the Generate button and marks the status line as a failure',()=>{
  render(<Controls {...controlProps} status="Generate failed" generateError={TRUE_BATHYMETRY_REFUSAL}/>);
  openEverySection();
  const beside=screen.getByRole('alert');
  expect(beside.textContent).toBe(TRUE_BATHYMETRY_REFUSAL);
  expect(beside.className).toBe('error');
  // Same section as the control that triggered it, so it cannot be scrolled away from the action.
  expect(beside.closest('details')?.textContent).toContain('Generate scene');
  expect(screen.getByText('Generate failed').className).toBe('error');
 });

 it('keeps ordinary status text unstyled and the placeholder intact when nothing has failed',()=>{
  render(<Controls {...controlProps} status="Done"/>);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText('Done').className).toBe('');
  cleanup();

  render(<GeneratedPreview featuresLoaded={false}/>);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText('Load vector features, then generate the manufacturing scene.')).toBeTruthy();
 });
});
