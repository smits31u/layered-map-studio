import {useState} from 'react';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import {Controls} from '../../src/components/controls/Controls';
import {GeneratedPreview} from '../../src/components/preview/GeneratedPreview';
import {buildScene} from '../../src/export/buildScene';
import {ARTISTIC_DEPTH_PRESETS} from '../../src/geometry/shoreline/artisticDepth';
import {serializeCropSnapshot} from '../../src/geometry/projection/cropSnapshot';
import {cornerPosition} from '../../src/geometry/scene/compass';
import {MapViewer} from '../../src/map/mapViewer/MapViewer';
import type {MapProject} from '../../src/types/project';
import {installFakeMapLibre} from '../helpers/fakeMapLibre';
import {caldronFallsFeatures,caldronFallsProject} from '../fixtures/caldronFalls';

// The lake tool's sidebar, generated-map editor and map host, along the paths a user takes that
// the earlier interaction tests did not reach: dragging, rotating and typing positions in the
// editor; switching layers and wheel zoom; compass corners, presets, label summaries, the backer and
// the crop-JSON tool in the sidebar; and the map host's tile-timeout, source-error and closed-map
// failures.

afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.useRealTimers()});

describe('GeneratedPreview: editing on the Land / Top layer',()=>{
 const project:MapProject={...caldronFallsProject,title:{...caldronFallsProject.title,text:'Test Lake'}};
 let scene:ReturnType<typeof buildScene>;
 beforeAll(()=>{
  scene=buildScene({...project,shoreline:{...project.shoreline}},caldronFallsFeatures);
  // jsdom has no layout: 2 screen px per mm.
  (SVGElement.prototype as unknown as {getScreenCTM:()=>{a:number;d:number}}).getScreenCTM=()=>({a:2,d:2});
  // jsdom has no CSS.escape, which every browser does; the drag code looks objects up with it.
  if(!globalThis.CSS?.escape)(globalThis as unknown as {CSS:{escape:(s:string)=>string}}).CSS={escape:s=>s.replace(/[^a-zA-Z0-9_-]/g,c=>'\\'+c)};
 });
 const setup=()=>{const commits:((p:MapProject)=>MapProject)[]=[];const view=render(<GeneratedPreview scene={scene} project={project} onCommitOverride={u=>commits.push(u)}/>);return {commits,...view,title:()=>view.container.querySelector('[data-object-id="title"]')!}};

 it('dragging the title moves it by the dragged distance in millimetres and commits once',()=>{
  const {commits,title}=setup();
  fireEvent.pointerDown(title(),{clientX:100,clientY:100,button:0});
  const startX=+(screen.getByLabelText(/^X mm/) as HTMLInputElement).value,startY=+(screen.getByLabelText(/^Y mm/) as HTMLInputElement).value;
  fireEvent.pointerMove(window,{clientX:110,clientY:105});
  fireEvent.pointerMove(window,{clientX:120,clientY:110});
  fireEvent.pointerUp(window,{clientX:120,clientY:110});
  expect(commits).toHaveLength(1);
  const moved=commits[0](project).overrides.title!;
  expect(moved.xMm).toBeCloseTo(startX+10,1);
  expect(moved.yMm).toBeCloseTo(startY+5,1);
 });

 it('a click without movement selects but does not move anything',()=>{
  const {commits,title}=setup();
  fireEvent.pointerDown(title(),{clientX:100,clientY:100,button:0});
  fireEvent.pointerUp(window,{clientX:100,clientY:100});
  expect(commits).toHaveLength(0);
  expect(document.querySelector('.object-editor b')?.textContent).toBe('title');
 });

 it('typing X and a rotation commits exactly those fields',()=>{
  const {commits,title}=setup();
  fireEvent.pointerDown(title(),{clientX:0,clientY:0,button:0});
  fireEvent.pointerUp(window,{clientX:0,clientY:0});
  fireEvent.change(screen.getByLabelText(/^X mm/),{target:{value:'42.5'}});
  fireEvent.change(screen.getByLabelText(/^Rotation/),{target:{value:'15'}});
  expect(commits.map(c=>c(project).overrides.title)).toEqual([{xMm:42.5},{rotationDeg:15}]);
 });

 it('switching to a depth panel closes the editor and says where editing happens',()=>{
  const {title}=setup();
  fireEvent.pointerDown(title(),{clientX:0,clientY:0,button:0});
  expect(document.querySelector('.object-editor')).toBeTruthy();
  fireEvent.change(screen.getByRole('combobox'),{target:{value:'2'}});
  expect(document.querySelector('.object-editor')).toBeNull();
  expect(document.querySelector('.edit-hint')?.textContent).toMatch(/Land\/Top/);
 });

 it('the mouse wheel zooms in and out around the pointer',()=>{
  const {container}=setup();
  const readout=()=>container.querySelector('.zoom-readout')!.textContent;
  fireEvent.wheel(container.querySelector('.svg-viewport')!,{deltaY:-100,clientX:50,clientY:50});
  expect(readout()).toBe('112%');
  fireEvent.wheel(container.querySelector('.svg-viewport')!,{deltaY:100,clientX:50,clientY:50});
  fireEvent.wheel(container.querySelector('.svg-viewport')!,{deltaY:100,clientX:50,clientY:50});
  expect(readout()).toBe('89%');
 });

 it('shows the scene\'s manufacturing warnings above the preview',()=>{
  render(<GeneratedPreview scene={{...scene,manufacturingWarnings:['Layer 4 collapsed at the selected Artistic Depth offset and duplicates the Base geometry.']}}/>);
  expect(screen.getByText('Layer 4 collapsed at the selected Artistic Depth offset and duplicates the Base geometry.')).toBeTruthy();
 });
});

describe('Controls: settings that do more than store a value',()=>{
 const counts={water:0,roads:0,namedRoads:0,places:0};
 let latest:MapProject;
 function Harness({initial}:{initial:MapProject}){
  const [project,setProject]=useState(initial);
  latest=project;
  return <Controls project={project} setProject={setProject} onSelect={()=>{}} onGenerate={()=>{}} onExport={()=>{}} status="Ready" counts={counts}/>;
 }
 const open=()=>{for(const d of document.querySelectorAll('details'))d.setAttribute('open','')};
 const selectByOption=(value:string)=>screen.getAllByRole('combobox').find(n=>[...(n as HTMLSelectElement).options].some(o=>o.value===value)) as HTMLSelectElement;
 const summary=(heading:string)=>[...document.querySelectorAll('summary')].find(s=>s.textContent?.startsWith(heading))!.textContent;

 it('moving the compass to a corner places it at that corner for this product size',()=>{
  render(<Harness initial={caldronFallsProject}/>);open();
  fireEvent.change(selectByOption('top-right'),{target:{value:'top-right'}});
  const {widthMm,heightMm}=caldronFallsProject.dimensions;
  expect(latest.compass).toMatchObject({...cornerPosition('top-right',widthMm,heightMm,latest.compass.sizeMm),position:'top-right'});
  fireEvent.change(selectByOption('top-right'),{target:{value:'off'}});
  expect(summary('Compass')).toBe('CompassOff');
 });

 it('choosing a preset loads its offsets; Custom keeps the current ones',()=>{
  render(<Harness initial={caldronFallsProject}/>);open();
  fireEvent.change(selectByOption('wide'),{target:{value:'wide'}});
  expect(latest.shoreline.artisticOffsetsNormalized).toEqual([...ARTISTIC_DEPTH_PRESETS.wide.normalizedOffsets]);
  fireEvent.change(selectByOption('wide'),{target:{value:'custom'}});
  expect(latest.shoreline.preset).toBe('custom');
  expect(latest.shoreline.artisticOffsetsNormalized).toEqual([...ARTISTIC_DEPTH_PRESETS.wide.normalizedOffsets]);
 });

 it('label sections summarise what is on: place kinds count down to Hidden, road labels to Shown',()=>{
  render(<Harness initial={caldronFallsProject}/>);open();
  expect(summary('Place labels')).toBe('Place labels4 of 4 kinds');
  for(const name of ['Cities','Towns','Villages','Hamlets']){fireEvent.click(screen.getByRole('checkbox',{name}))}
  expect(summary('Place labels')).toBe('Place labelsHidden');
  expect(summary('Road labels')).toBe('Road labelsHidden');
  fireEvent.click(screen.getAllByRole('checkbox',{name:'Show'})[0]);
  expect(summary('Road labels')).toBe('Road labelsShown');
 });

 it('a title backer reveals its padding field, which is then stored',()=>{
  render(<Harness initial={caldronFallsProject}/>);open();
  expect(screen.queryByLabelText(/^Backer padding mm/)).toBeNull();
  fireEvent.change(selectByOption('offset'),{target:{value:'offset'}});
  fireEvent.change(screen.getByLabelText(/^Backer padding mm/),{target:{value:'3.5'}});
  expect(latest.title).toMatchObject({backer:'offset',backerPaddingMm:3.5});
 });

 it('Crop JSON: copies to the clipboard, falls back to the text box without one, and applies a pasted crop',async()=>{
  const writeText=vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator',{...navigator,clipboard:{writeText}});
  render(<Harness initial={caldronFallsProject}/>);open();
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Copy Crop JSON'}))});
  expect(screen.getByText('Crop JSON copied to clipboard.')).toBeTruthy();
  expect(JSON.parse(writeText.mock.calls[0][0])).toEqual(serializeCropSnapshot(caldronFallsProject));
  vi.stubGlobal('navigator',{...navigator,clipboard:undefined});
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Copy Crop JSON'}))});
  expect(screen.getByText('Clipboard unavailable — copy the JSON below manually.')).toBeTruthy();
  // Paste a different crop and apply it.
  const moved={...serializeCropSnapshot(caldronFallsProject)};
  const snapshot=JSON.parse(JSON.stringify(moved));
  snapshot.center.lon=-88.1;
  fireEvent.change(screen.getByPlaceholderText(/Paste a saved Crop JSON/),{target:{value:JSON.stringify(snapshot)}});
  fireEvent.click(screen.getByRole('button',{name:'Apply Crop JSON'}));
  expect(screen.getByText(/^Crop applied from JSON\./)).toBeTruthy();
  expect(latest.map.longitude).toBe(-88.1);
 });

 it('pressing Enter in the search box searches',async()=>{
  const fetchMock=vi.fn().mockResolvedValue({ok:true,status:200,json:async()=>({query:'x',provider:'photon',attribution:'',results:[]})});
  vi.stubGlobal('fetch',fetchMock);
  render(<Harness initial={caldronFallsProject}/>);
  fireEvent.keyDown(screen.getByLabelText('Lake or place name'),{key:'Enter'});
  await waitFor(()=>expect(screen.getByText('No search results found')).toBeTruthy());
  expect(fetchMock).toHaveBeenCalledOnce();
 });
});

describe('MapViewer: capture failures',()=>{
 const noop=()=>{};
 it('a map whose tiles never settle reports a timeout after 15 seconds instead of waiting forever',async()=>{
  const fake=installFakeMapLibre({neverIdle:true});
  try{
   vi.useFakeTimers();
   const statuses:string[]=[];
   render(<MapViewer project={caldronFallsProject} onView={noop} onCrop={noop} onFeatures={noop} onStatus={s=>statuses.push(s)}/>);
   await act(()=>vi.advanceTimersByTimeAsync(10));
   fireEvent.click(screen.getByRole('button',{name:'Load visible vector features'}));
   await act(()=>vi.advanceTimersByTimeAsync(15_000));
   expect(statuses.at(-1)).toBe('Feature extraction failed: Map tiles did not finish loading. Try again after the map settles.');
   expect(screen.getByRole('button',{name:'Load visible vector features'})).toHaveProperty('disabled',false);
  }finally{fake.uninstall()}
 });

 it('closing the map mid-capture reports that, rather than hanging',async()=>{
  const fake=installFakeMapLibre({deferIdle:true});
  try{
   const statuses:string[]=[];
   render(<MapViewer project={caldronFallsProject} onView={noop} onCrop={noop} onFeatures={noop} onStatus={s=>statuses.push(s)}/>);
   await act(()=>new Promise(r=>setTimeout(r,10)));
   fireEvent.click(screen.getByRole('button',{name:'Load visible vector features'}));
   await act(async()=>{fake.emit('remove')});
   expect(statuses.at(-1)).toBe('Feature extraction failed: The map was closed before feature loading completed.');
  }finally{fake.uninstall()}
 });

 it('a failing map source is shown on the map, with its message',async()=>{
  const fake=installFakeMapLibre();
  const errors=vi.spyOn(console,'error').mockImplementation(()=>{});
  try{
   render(<MapViewer project={caldronFallsProject} onView={noop} onCrop={noop} onFeatures={noop} onStatus={noop}/>);
   await act(async()=>{fake.emit('error',{error:new Error('tiles.openfreemap.org: 503')})});
   expect(screen.getByText('Map source failure: tiles.openfreemap.org: 503')).toBeTruthy();
  }finally{fake.uninstall();errors.mockRestore()}
 });
});
