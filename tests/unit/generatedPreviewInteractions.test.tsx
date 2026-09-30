import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {GeneratedPreview} from '../../src/components/preview/GeneratedPreview';
import {buildScene} from '../../src/export/buildScene';
import {caldronFallsFeatures,caldronFallsProject} from '../fixtures/caldronFalls';
import type {MapMarker,MapProject} from '../../src/types/project';

// Phase 0 backlog item 6: GeneratedPreview.tsx had no direct component tests of its own (only its
// no-scene empty/error states were exercised, indirectly, through App in generateFailureUi.test.tsx).
// This covers the actual generated-scene UI: view switching, the layer picker, zoom controls, and —
// the bulk of the component's own logic — selecting an object in the SVG and editing it (nudge,
// rotate, toggle visible, flip side, reset), which drives onCommitOverride exactly as the real app's
// commitOverride path does.

const marker=(overrides:Partial<MapMarker> = {}):MapMarker=>({
 id:'marker-1',markerType:'pin',sizeMm:8,rotationDeg:0,showLabel:false,labelSizeMm:3,visible:true,operation:'engrave',keepOutEnabled:false,keepOutPaddingMm:2,
 lat:45.3685,lng:-88.207,
 ...overrides,
});

// A project with something selectable on every object kind GeneratedPreview distinguishes: a title
// (with text, so buildScene actually emits it), a marker, and a named road label.
const editableProject:MapProject={
 ...caldronFallsProject,
 title:{...caldronFallsProject.title,text:'Test Lake'},
 roadLabels:{...caldronFallsProject.roadLabels,visible:true},
 markers:[marker()],
};

afterEach(()=>{cleanup()});

describe('GeneratedPreview: no-scene states',()=>{
 it('prompts to load features when nothing has been extracted yet',()=>{
  render(<GeneratedPreview featuresLoaded={false}/>);
  expect(screen.getByText(/Load vector features, then generate/)).toBeTruthy();
 });

 it('prompts to generate once features are loaded but nothing has been built',()=>{
  render(<GeneratedPreview featuresLoaded={true}/>);
  expect(screen.getByText(/Click Generate scene to build the manufacturing preview/)).toBeTruthy();
 });

 it('shows a generate-failed alert instead of the loaded/not-loaded prompt when an error is present',()=>{
  render(<GeneratedPreview featuresLoaded={true} error="No water features found in the selected crop"/>);
  const alert=screen.getByRole('alert');
  expect(alert.textContent).toMatch(/Generate failed:/);
  expect(alert.textContent).toMatch(/No water features found/);
 });
});

describe('GeneratedPreview: view and zoom controls',()=>{
 it('switches between Individual, Composite and Exploded views, showing the layer picker only in Individual',()=>{
  const scene=buildScene(editableProject,caldronFallsFeatures);
  render(<GeneratedPreview scene={scene}/>);
  expect(screen.getByRole('button',{name:'Individual Layer'}).className).toMatch(/active/);
  expect(screen.getByRole('combobox')).toBeTruthy(); // the layer picker

  fireEvent.click(screen.getByRole('button',{name:'Composite'}));
  expect(screen.getByRole('button',{name:'Composite'}).className).toMatch(/active/);
  expect(screen.getByRole('button',{name:'Individual Layer'}).className).not.toMatch(/active/);
  expect(screen.queryByRole('combobox')).toBeNull();

  fireEvent.click(screen.getByRole('button',{name:'Exploded'}));
  expect(screen.getByRole('button',{name:'Exploded'}).className).toMatch(/active/);
  expect(screen.queryByRole('combobox')).toBeNull();

  fireEvent.click(screen.getByRole('button',{name:'Individual Layer'}));
  expect(screen.getByRole('combobox')).toBeTruthy();
 });

 it('lists every physical layer in the picker, one option per layer',()=>{
  const scene=buildScene(editableProject,caldronFallsFeatures);
  render(<GeneratedPreview scene={scene}/>);
  const options=screen.getAllByRole('option') as HTMLOptionElement[];
  expect(options.map(o=>o.textContent)).toEqual(scene.layers.map(l=>l.name));
 });

 it('zooms in and out around the viewport center, moving the zoom readout away from 100%',()=>{
  const scene=buildScene(editableProject,caldronFallsFeatures);
  const {container}=render(<GeneratedPreview scene={scene}/>);
  const readout=()=>container.querySelector('.zoom-readout')!.textContent;
  expect(readout()).toBe('100%');
  fireEvent.click(screen.getByTitle('Zoom in'));
  expect(readout()).toBe('125%');
  fireEvent.click(screen.getByTitle('Zoom out'));
  fireEvent.click(screen.getByTitle('Zoom out'));
  expect(readout()).toBe('80%');
 });

 it('shows the physical size, panel count and lake occupancy in the size readout',()=>{
  const scene=buildScene(editableProject,caldronFallsFeatures);
  render(<GeneratedPreview scene={scene}/>);
  expect(screen.getByText(new RegExp(`${scene.layers.length} panels`))).toBeTruthy();
  expect(screen.getByText(/Lake occupancy/)).toBeTruthy();
 });
});

describe('GeneratedPreview: selecting and editing an object (editable mode)',()=>{
 let scene:ReturnType<typeof buildScene>,project:MapProject,commits:((p:MapProject)=>MapProject)[];
 const onCommitOverride=(updater:(p:MapProject)=>MapProject)=>{commits.push(updater)};

 beforeEach(()=>{
  project=editableProject;
  scene=buildScene(project,caldronFallsFeatures);
  commits=[];
 });

 it('does not attach selection behavior when the preview is read-only (no project/onCommitOverride)',()=>{
  const {container}=render(<GeneratedPreview scene={scene}/>);
  const titleEl=container.querySelector('[data-object-id="title"]')!;
  fireEvent.pointerDown(titleEl,{clientX:10,clientY:10,button:0});
  expect(screen.queryByText('Reset to default')).toBeNull();
 });

 it('selects the title on pointerdown and shows its object editor with X/Y and no rotation-only fields hidden incorrectly',()=>{
  const {container}=render(<GeneratedPreview scene={scene} project={project} onCommitOverride={onCommitOverride}/>);
  const titleEl=container.querySelector('[data-object-id="title"]')!;
  fireEvent.pointerDown(titleEl,{clientX:10,clientY:10,button:0});
  expect(container.querySelector('.object-editor b')?.textContent).toBe('title');
  expect(screen.getByLabelText(/^X mm/)).toBeTruthy();
  expect(screen.getByLabelText(/^Y mm/)).toBeTruthy();
  expect(screen.getByLabelText(/^Rotation/)).toBeTruthy(); // title rotation IS shown per kind list
  expect(screen.getByRole('checkbox',{name:'Visible'})).toBeTruthy();
  expect(screen.queryByRole('button',{name:'Flip Side'})).toBeNull(); // only road labels flip
 });

 it('nudges the selected title up by 1mm, committing an override with the new Y position',()=>{
  const {container}=render(<GeneratedPreview scene={scene} project={project} onCommitOverride={onCommitOverride}/>);
  const titleEl=container.querySelector('[data-object-id="title"]')!;
  fireEvent.pointerDown(titleEl,{clientX:10,clientY:10,button:0});
  const startY=+((screen.getByLabelText(/^Y mm/) as HTMLInputElement).value);
  fireEvent.click(screen.getByRole('button',{name:'↑1'}));
  expect(commits).toHaveLength(1);
  const next=commits[0](project);
  expect(next.overrides.title?.yMm).toBeCloseTo(startY-1,5);
 });

 it('toggles the selected title invisible via the Visible checkbox',()=>{
  const {container}=render(<GeneratedPreview scene={scene} project={project} onCommitOverride={onCommitOverride}/>);
  const titleEl=container.querySelector('[data-object-id="title"]')!;
  fireEvent.pointerDown(titleEl,{clientX:10,clientY:10,button:0});
  fireEvent.click(screen.getByRole('checkbox',{name:'Visible'}));
  expect(commits).toHaveLength(1);
  const next=commits[0](project);
  expect(next.overrides.title?.visible).toBe(false);
 });

 it('resets the selected title, clearing its override fields',()=>{
  const withOverride:MapProject={...project,overrides:{...project.overrides,title:{xMm:1,yMm:2}}};
  const {container}=render(<GeneratedPreview scene={scene} project={withOverride} onCommitOverride={onCommitOverride}/>);
  const titleEl=container.querySelector('[data-object-id="title"]')!;
  fireEvent.pointerDown(titleEl,{clientX:10,clientY:10,button:0});
  fireEvent.click(screen.getByRole('button',{name:'Reset to default'}));
  expect(commits).toHaveLength(1);
  const next=commits[0](withOverride);
  expect(next.overrides.title).toBeUndefined();
 });

 it('selects a marker and does not offer Flip Side for it either',()=>{
  const {container}=render(<GeneratedPreview scene={scene} project={project} onCommitOverride={onCommitOverride}/>);
  const markerEl=container.querySelector('[data-object-id="marker-1"]')!;
  fireEvent.pointerDown(markerEl,{clientX:5,clientY:5,button:0});
  expect(screen.getByText('marker')).toBeTruthy();
  expect(screen.queryByRole('button',{name:'Flip Side'})).toBeNull();
 });

 it('selects a road label and offers Flip Side, which commits a flipSide override toggle',()=>{
  const {container}=render(<GeneratedPreview scene={scene} project={project} onCommitOverride={onCommitOverride}/>);
  const roadLabelEl=container.querySelector('[data-object-id^="road-label-"]')!;
  expect(roadLabelEl).toBeTruthy();
  fireEvent.pointerDown(roadLabelEl,{clientX:5,clientY:5,button:0});
  expect(screen.getByText('road label')).toBeTruthy();
  const flip=screen.getByRole('button',{name:'Flip Side'});
  fireEvent.click(flip);
  expect(commits).toHaveLength(1);
  const objectId=roadLabelEl.getAttribute('data-object-id')!;
  const next=commits[0](project);
  expect(next.overrides[objectId]?.flipSide).toBe(true);
 });
});
