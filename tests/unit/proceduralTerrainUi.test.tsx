import {useState} from 'react';
import {afterEach,describe,expect,it} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {Controls} from '../../src/components/controls/Controls';
import {GeneratedPreview} from '../../src/components/preview/GeneratedPreview';
import {buildScene} from '../../src/export/buildScene';
import {DEFAULT_SIMPLE_TERRAIN_CONTROLS} from '../../src/geometry/terrain/terrainParams';
import {defaultProject} from '../../src/state/defaultProject';
import type {ExtractedFeatures,MapProject} from '../../src/types/project';
import {caldronFallsFeatures,caldronFallsProject} from '../fixtures/caldronFalls';

// The Procedural Terrain controls as a user meets them: chosen from the existing Depth Data mode
// selector, simple controls only, values kept in the project, gone again in the other modes — and a
// shoreline the terrain cannot model reported where the eye lands, like True Bathymetry's refusal.

const openEverySection=()=>{for(const section of document.querySelectorAll('details'))section.setAttribute('open','')};
const depthModeSelect=()=>screen.getAllByRole('combobox').find(node=>[...(node as HTMLSelectElement).options].some(option=>option.value==='procedural-terrain')) as HTMLSelectElement;
const counts={water:0,roads:0,namedRoads:0,places:0};

// A controlled harness around the real Controls, recording every project it is handed.
let latest:MapProject=defaultProject;
function Harness({initial=defaultProject}:{initial?:MapProject}){
 const [project,setProject]=useState(initial);
 latest=project;
 return <Controls project={project} setProject={p=>{latest=p;setProject(p)}} onSelect={()=>{}} onGenerate={()=>{}} onExport={()=>{}} status="Ready" counts={counts}/>;
}

describe('Procedural Terrain controls',()=>{
 afterEach(cleanup);

 it('is offered alongside the existing modes, and its controls appear only when it is selected',()=>{
  render(<Harness/>);openEverySection();
  const select=depthModeSelect();
  expect([...select.options].map(o=>o.value)).toEqual(['true-bathymetry','decorative-offsets','procedural-terrain']);
  expect(select.value).toBe('decorative-offsets');
  expect(screen.queryByLabelText('Character')).toBeNull();
  fireEvent.change(select,{target:{value:'procedural-terrain'}});
  expect(latest.bathymetry.mode).toBe('procedural-terrain');
  for(const label of ['Bottom profile','Character','Bank steepness','Weave','Terracing','Max depth','Seed'])expect(screen.getByLabelText(label),label).toBeTruthy();
  expect(screen.getByText('Shuffle')).toBeTruthy();
  expect(screen.getByText(/the preset above does not apply/)).toBeTruthy();
  // Simple controls only: none of the engine's advanced parameters are exposed.
  for(const advanced of ['Octaves','Roughness','Ridged','Warp','Feature scale','Terrace levels'])expect(screen.queryByLabelText(advanced)).toBeNull();
 });

 it('writes every edit into the project as a complete control set, and Shuffle picks a new seed',()=>{
  render(<Harness initial={{...defaultProject,bathymetry:{...defaultProject.bathymetry,mode:'procedural-terrain'}}}/>);openEverySection();
  fireEvent.change(screen.getByLabelText('Character'),{target:{value:'0.9'}});
  expect(latest.bathymetry.terrain).toEqual({...DEFAULT_SIMPLE_TERRAIN_CONTROLS,character:.9});
  fireEvent.change(screen.getByLabelText('Bottom profile'),{target:{value:'stepped-benches'}});
  expect(latest.bathymetry.terrain).toMatchObject({character:.9,profile:'stepped-benches'});
  const seeds=new Set<number>();
  for(let k=0;k<5;k++){fireEvent.click(screen.getByText('Shuffle'));seeds.add(latest.bathymetry.terrain!.seed)}
  for(const seed of seeds){expect(Number.isInteger(seed)).toBe(true);expect(seed).toBeGreaterThanOrEqual(0);expect(seed).toBeLessThan(1000000)}
  expect(seeds.size).toBeGreaterThan(1);
  expect(latest.bathymetry.terrain).toMatchObject({character:.9,profile:'stepped-benches'});
 });

 it('shows the weave angle only once there is weave to point',()=>{
  render(<Harness initial={{...defaultProject,bathymetry:{...defaultProject.bathymetry,mode:'procedural-terrain'}}}/>);openEverySection();
  expect(screen.queryByLabelText('Weave angle')).toBeNull();
  fireEvent.change(screen.getByLabelText('Weave'),{target:{value:'0.6'}});
  fireEvent.change(screen.getByLabelText('Weave angle'),{target:{value:'35'}});
  expect(latest.bathymetry.terrain).toMatchObject({weave:.6,weaveAngleDeg:35});
 });

 it('hides the terrain controls in the other modes and keeps their values for when it comes back',()=>{
  render(<Harness/>);openEverySection();
  fireEvent.change(depthModeSelect(),{target:{value:'procedural-terrain'}});
  fireEvent.change(screen.getByLabelText('Terracing'),{target:{value:'0.7'}});
  for(const mode of ['true-bathymetry','decorative-offsets']){
   fireEvent.change(depthModeSelect(),{target:{value:mode}});
   expect(latest.bathymetry.mode).toBe(mode);
   expect(screen.queryByLabelText('Terracing'),mode).toBeNull();
   expect(screen.queryByText(/the preset above does not apply/),mode).toBeNull();
  }
  fireEvent.change(depthModeSelect(),{target:{value:'procedural-terrain'}});
  expect((screen.getByLabelText('Terracing') as HTMLInputElement).value).toBe('0.7');
 });
});

describe('a shoreline the terrain cannot model is impossible to miss',()=>{
 afterEach(cleanup);
 // The real refusal from the real pipeline, as in generateFailureUi.test.tsx: a genuine water
 // feature about 0.2mm wide on the product, which no terrain grid cell can land inside.
 const sliver:ExtractedFeatures={...caldronFallsFeatures,water:[{id:'sliver',rings:[[{lng:-88.27,lat:45.36994},{lng:-88.135,lat:45.36994},{lng:-88.135,lat:45.37006},{lng:-88.27,lat:45.37006},{lng:-88.27,lat:45.36994}]]}]};
 const REFUSAL=(()=>{
  try{buildScene({...caldronFallsProject,bathymetry:{...caldronFallsProject.bathymetry,mode:'procedural-terrain'}},sliver);return '(not refused)'}
  catch(reason){return (reason as Error).message}
 })();

 it('shows the refusal verbatim in the Generated Map panel and beside the Generate button',()=>{
  expect(REFUSAL).toContain('PROCEDURAL TERRAIN selected');
  render(<GeneratedPreview featuresLoaded error={REFUSAL}/>);
  expect(screen.getByRole('alert').textContent).toBe(`Generate failed: ${REFUSAL}`);
  cleanup();
  render(<Controls project={defaultProject} setProject={()=>{}} onSelect={()=>{}} onGenerate={()=>{}} onExport={()=>{}} status="Generate failed" generateError={REFUSAL} counts={counts}/>);
  openEverySection();
  const beside=screen.getByRole('alert');
  expect(beside.textContent).toBe(REFUSAL);
  expect(beside.closest('details')?.textContent).toContain('Generate scene');
 });
});
