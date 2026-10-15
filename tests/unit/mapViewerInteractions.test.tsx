import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {MapViewer,cropFrameStyle} from '../../src/map/mapViewer/MapViewer';
import {installFakeMapLibre} from '../helpers/fakeMapLibre';
import {caldronFallsProject} from '../fixtures/caldronFalls';
import {cropStretch} from '../../src/geometry/projection/cropAspect';
import type {CropGeography} from '../../src/types/project';

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

// The 2026-10-15 crop audit. jsdom lays nothing out, so these give the crop frame a box: `frame` is
// its size in px, centred in the fake's 400 px canvas.
describe('MapViewer: crop geometry',()=>{
 const W=caldronFallsProject.dimensions.widthMm,H=caldronFallsProject.dimensions.heightMm;
 let frame={width:280,height:280*H/W};
 const layout=()=>vi.spyOn(Element.prototype,'getBoundingClientRect').mockImplementation(function(this:Element){
  const r=this.classList.contains('crop-frame')?{left:200-frame.width/2,top:200-frame.height/2,right:200+frame.width/2,bottom:200+frame.height/2}:{left:0,top:0,right:400,bottom:400};
  return {...r,x:r.left,y:r.top,width:r.right-r.left,height:r.bottom-r.top,toJSON(){}} as DOMRect;
 });
 afterEach(()=>{vi.restoreAllMocks();frame={width:280,height:280*H/W}});

 it('turns rotation and pitch off: the compass is drawn pointing up the board',async()=>{
  const fake=installFakeMapLibre(),configs:Record<string,unknown>[]=[],controls:unknown[]=[];
  const lib=(globalThis as unknown as {maplibregl:{Map:new(c:Record<string,unknown>)=>unknown;NavigationControl:unknown}}).maplibregl,Base=lib.Map;
  lib.Map=class extends (Base as new(c:Record<string,unknown>)=>object){constructor(c:Record<string,unknown>){super(c);configs.push(c)}};
  lib.NavigationControl=class{constructor(o:unknown){controls.push(o)}};
  try{
   render(<MapViewer project={{...caldronFallsProject,map:{...caldronFallsProject.map,bearing:40}}} onView={noop} onCrop={noop} onFeatures={noop} onStatus={noop}/>);
   expect(configs[0]).toMatchObject({dragRotate:false,pitchWithRotate:false,touchPitch:false,maxPitch:0,bearing:0});
   expect(controls).toEqual([{showCompass:false}]);
  }finally{fake.uninstall()}
 });

 it('re-measures the crop when the board size changes, without the map moving',async()=>{
  const fake=installFakeMapLibre(),crops:CropGeography[]=[];layout();
  try{
   const {rerender}=render(<MapViewer project={caldronFallsProject} onView={noop} onCrop={c=>crops.push(c)} onFeatures={noop} onStatus={noop}/>);
   await tick();
   expect(cropStretch(crops.at(-1)!,W,H)).toBeCloseTo(1,3);
   // 14x11 -> 18x12: CSS reshapes the frame; the crop must follow it at once.
   const resized={...caldronFallsProject,dimensions:{...caldronFallsProject.dimensions,widthMm:457.2,heightMm:304.8}};
   frame={width:300,height:200};
   const before=crops.length;
   rerender(<MapViewer project={resized} onView={noop} onCrop={c=>crops.push(c)} onFeatures={noop} onStatus={noop}/>);
   expect(crops.length).toBe(before+1);
   expect(cropStretch(crops.at(-1)!,457.2,304.8)).toBeCloseTo(1,3);
  }finally{fake.uninstall()}
 });

 it('keeps a pinned crop through a window resize, and still re-measures an unpinned one',async()=>{
  const fake=installFakeMapLibre(),crops:CropGeography[]=[];layout();
  try{
   render(<MapViewer project={caldronFallsProject} keepCrop onView={noop} onCrop={c=>crops.push(c)} onFeatures={noop} onStatus={noop}/>);
   await tick();
   expect(crops).toEqual([]);
   // MapLibre answers a resize with resize, then moveend, with the camera where it was.
   frame={width:320,height:320*H/W};
   act(()=>{fake.emit('resize');fake.emit('moveend')});
   expect(crops).toEqual([]);
   cleanup();
   render(<MapViewer project={caldronFallsProject} onView={noop} onCrop={c=>crops.push(c)} onFeatures={noop} onStatus={noop}/>);
   await tick();
   const loaded=crops.length;
   act(()=>{fake.emit('resize');fake.emit('moveend')});
   expect(crops.length).toBe(loaded+1);
  }finally{fake.uninstall()}
 });

 it('a pinned crop is released when the user moves the map',async()=>{
  const fake=installFakeMapLibre(),crops:CropGeography[]=[];layout();
  try{
   render(<MapViewer project={caldronFallsProject} keepCrop onView={noop} onCrop={c=>crops.push(c)} onFeatures={noop} onStatus={noop}/>);
   await tick();
   act(()=>{fake.state.center={lng:fake.state.center.lng+.01,lat:fake.state.center.lat};fake.emit('moveend')});
   expect(crops.length).toBe(1);
  }finally{fake.uninstall()}
 });

 it('refuses to capture through a frame that is not the board\'s shape',async()=>{
  const fake=installFakeMapLibre();layout();
  try{
   render(<MapViewer project={caldronFallsProject} onView={noop} onCrop={noop} onFeatures={noop} onStatus={noop}/>);
   await tick();
   // The audit's wide window: the frame came out 4.4% wider than the board.
   frame={width:280*1.046,height:280*H/W};
   fireEvent.click(screen.getByRole('button',{name:'Load visible vector features'}));
   await tick();await tick();
   expect(screen.getByText(/Feature extraction failed:/).textContent).toMatch(/crop frame on screen is not the board's shape/);
  }finally{fake.uninstall()}
 });
});
