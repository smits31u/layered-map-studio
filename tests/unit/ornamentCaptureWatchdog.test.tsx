import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,render,screen,fireEvent} from '@testing-library/react';
import {cityCapture} from '../fixtures/ornament/captures';
import {installFakeMapLibre,type InstalledFakeMapLibre} from '../helpers/fakeMapLibre';

// The capture watchdog: Phase 5's "explicit timeout for capture/export so a hung worker doesn't
// leave the UI stuck indefinitely", on the capture side.
//
// Capture is started by an effect in the map component and reports back through a callback. Every
// other failure path reports *something* — a rotated map, a style that never loaded, a view too
// large. The one this guards is the path where nothing reports at all, which no amount of error
// handling inside the capture can cover, because the capture is where the silence is. The map is
// therefore replaced with one whose capture never settles; that is the only way to be that failure
// rather than to simulate its symptoms.
vi.mock('../../src/ornament/capture/mapCapture',async importOriginal=>{
 const actual=await importOriginal<typeof import('../../src/ornament/capture/mapCapture')>();
 return {...actual,captureOrnamentFeatures:()=>new Promise(()=>{})};
});

const {OrnamentPage}=await import('../../src/ornament/ui/OrnamentPage');
const {CAPTURE_TIMEOUT_MS}=await import('../../src/ornament/ui/OrnamentPage');

const openEverySection=()=>{for(const section of document.querySelectorAll('details'))section.setAttribute('open','')};
const pipelineIsIdle=()=>document.querySelector('.ornament-progress')?.getAttribute('aria-busy')==='false';
const statusText=()=>document.querySelector('.mode-note')?.textContent??'';

describe('a capture that never reports back',()=>{
 let fake:InstalledFakeMapLibre;
 beforeEach(()=>{
  localStorage.clear();
  fake=installFakeMapLibre({features:cityCapture()});
  vi.stubGlobal('fetch',vi.fn().mockImplementation(()=>Promise.resolve({ok:true,status:200,json:async()=>({results:[],providers:[]})})));
  render(<OrnamentPage onExit={()=>{}}/>);
  openEverySection();
 });
 afterEach(()=>{vi.useRealTimers();cleanup();fake.uninstall()});

 it('is given up on, with an instruction, instead of working for ever',async()=>{
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole('button',{name:'Capture map geometry'}));
  expect(pipelineIsIdle()).toBe(false);

  // Just short of the deadline it is still legitimately working: a watchdog that fires early would
  // abandon slow captures that were about to succeed.
  await act(async()=>{await vi.advanceTimersByTimeAsync(CAPTURE_TIMEOUT_MS-1000)});
  expect(pipelineIsIdle()).toBe(false);

  await act(async()=>{await vi.advanceTimersByTimeAsync(2000)});
  openEverySection();

  expect(pipelineIsIdle()).toBe(true);
  // Actionable, per the exit criterion: it says what went wrong and what to look at.
  expect(statusText()).toMatch(/did not finish capturing within 20 seconds/);
  expect(statusText()).toMatch(/tiles are loading/);
  // And the control is usable again rather than stuck reading "Working…".
  expect(screen.getByRole('button',{name:'Capture map geometry'})).toBeTruthy();
  expect((screen.getByRole('button',{name:'Capture map geometry'}) as HTMLButtonElement).disabled).toBe(false);
 });

 it('does not claim a capture it never received',async()=>{
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole('button',{name:'Capture map geometry'}));
  await act(async()=>{await vi.advanceTimersByTimeAsync(CAPTURE_TIMEOUT_MS+1000)});
  openEverySection();
  expect(screen.queryByText(/Captured \d+ feature/)).toBeNull();
  expect(screen.getByText(/Nothing captured yet/)).toBeTruthy();
  expect((screen.getByRole('button',{name:'Export SVG'}) as HTMLButtonElement).disabled).toBe(true);
 });
});
