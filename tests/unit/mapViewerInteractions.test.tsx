import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,describe,expect,it} from 'vitest';
import {MapViewer,cropFrameStyle} from '../../src/map/mapViewer/MapViewer';
import {installFakeMapLibre} from '../helpers/fakeMapLibre';
import {caldronFallsProject} from '../fixtures/caldronFalls';

// Phase 0 backlog item 6: MapViewer.tsx (the lake tool's own MapLibre host) had no direct tests —
// every existing test that reaches it avoids installing a real map, per topoFeaturesUi.test.tsx's
// own comment ("The lake tool's own map needs more of MapLibre than the shared fake has"). This
// extends the shared fake (tests/helpers/fakeMapLibre.ts: addControl, a canvas with
// getBoundingClientRect) just enough to drive MapViewer's own wiring — not its extraction math,
// which mapLibreExtractor.test.ts already covers directly — and tests what was previously entirely
// unexercised: the "MapLibre didn't load" and "map not ready" error paths, and the crop/view update
// wiring on the map's own load/moveend events.

const tick=()=>act(()=>new Promise(resolve=>setTimeout(resolve,0)));
const noop=()=>{};

afterEach(()=>{cleanup()});

describe('MapViewer: MapLibre unavailable',()=>{
 it('shows a clear error instead of a blank map when the MapLibre script never loaded',()=>{
  render(<MapViewer project={caldronFallsProject} onView={noop} onCrop={noop} onFeatures={noop} onStatus={noop}/>);
  expect(screen.getByText('MapLibre failed to load')).toBeTruthy();
 });

 it('still renders the extract button, which reports "Map is not ready" rather than doing nothing',()=>{
  const statuses:string[]=[];
  render(<MapViewer project={caldronFallsProject} onView={noop} onCrop={noop} onFeatures={noop} onStatus={s=>statuses.push(s)}/>);
  fireEvent.click(screen.getByRole('button',{name:'Load visible vector features'}));
  expect(screen.getByText('Feature extraction failed: Map is not ready.')).toBeTruthy();
  expect(statuses).toContain('Feature extraction failed: Map is not ready.');
 });
});

describe('MapViewer: with a map',()=>{
 it('renders the map host and a crop frame sized to the project\'s aspect ratio', ()=>{
  const fake=installFakeMapLibre();
  try{
   const {container}=render(<MapViewer project={caldronFallsProject} onView={noop} onCrop={noop} onFeatures={noop} onStatus={noop}/>);
   expect(container.querySelector('.mode-badge')?.textContent).toBe('MAP MODE');
   const frame=container.querySelector('.crop-frame') as HTMLElement;
   expect(frame).toBeTruthy();
   const expectedRatio=cropFrameStyle(caldronFallsProject.dimensions.widthMm,caldronFallsProject.dimensions.heightMm)['--ratio'];
   expect(frame.style.getPropertyValue('--ratio')).toBe(String(expectedRatio));
  }finally{fake.uninstall()}
 });

 it('reports the crop and view once the map finishes its own load event',async()=>{
  const fake=installFakeMapLibre();
  const views:unknown[]=[],crops:unknown[]=[];
  try{
   render(<MapViewer project={caldronFallsProject} onView={v=>views.push(v)} onCrop={c=>crops.push(c)} onFeatures={noop} onStatus={noop}/>);
   await tick(); // the fake fires its 'load' event via a real setTimeout(0)
   expect(views.length).toBeGreaterThan(0);
   expect(crops.length).toBeGreaterThan(0);
   const view=views[views.length-1] as {zoom:number;bearing:number};
   expect(view.zoom).toBe(fake.state.zoom);
   expect(view.bearing).toBe(0); // the fake's getBearing() always reports 0
  }finally{fake.uninstall()}
 });

 it('extract: shows the loading state immediately, then a real failure when the crop frame has no on-screen area',async()=>{
  const fake=installFakeMapLibre();
  const statuses:string[]=[];
  try{
   render(<MapViewer project={caldronFallsProject} onView={noop} onCrop={noop} onFeatures={noop} onStatus={s=>statuses.push(s)}/>);
   await tick();
   const button=()=>screen.getByRole('button',{name:/Load visible vector features|Loading vector features/});
   fireEvent.click(button());
   expect(button().textContent).toBe('Loading vector features...');
   expect((button() as HTMLButtonElement).disabled).toBe(true);
   expect(statuses).toContain('Loading vector features...');
   await tick();
   await tick();
   // jsdom never lays out the crop frame, so it has zero on-screen size — extraction correctly
   // refuses to query a zero-area box rather than silently returning nothing.
   expect(screen.getByText(/Feature extraction failed:/).textContent).toMatch(/no area|outside the map canvas/);
   expect(button().textContent).toBe('Load visible vector features');
   expect((button() as HTMLButtonElement).disabled).toBe(false);
  }finally{fake.uninstall()}
 });
});
