import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {OrnamentPage} from '../../src/ornament/ui/OrnamentPage';
import {cityCapture} from '../fixtures/ornament/captures';
import {installFakeMapLibre,type InstalledFakeMapLibre} from '../helpers/fakeMapLibre';

// Phase 5 hardening, driven through the UI: the cancellation and stale-result guards, and the
// progress signal the rest of the suite now synchronises on.

const CRIVITZ={
 id:'nominatim:374550587',
 label:'Crivitz, Marinette County, Wisconsin, United States',
 coordinates:[-88.0043,45.2323],
 boundingBox:[-88.0246,45.2166,-87.9884,45.2498],
 provider:'nominatim',
 attribution:'© OpenStreetMap contributors — geocoding by Nominatim',
 kind:'village',
};
const PROVIDERS=[{id:'nominatim',label:'Nominatim (OpenStreetMap)',attribution:'a',note:'Worldwide'}];

const proxyReply=(results:unknown[])=>({
 ok:true,
 status:200,
 json:async()=>({query:'Crivitz',provider:'nominatim',attribution:CRIVITZ.attribution,results,cached:false,providers:PROVIDERS}),
});

const field=(label:string)=>screen.getByLabelText(label) as HTMLInputElement;
const openEverySection=()=>{for(const section of document.querySelectorAll('details'))section.setAttribute('open','')};
const progress=()=>document.querySelector('.ornament-progress')!;
const pipelineIsIdle=()=>progress().getAttribute('aria-busy')==='false';
const exportButton=()=>screen.getByRole('button',{name:'Export SVG'}) as HTMLButtonElement;
const blockedReasons=()=>within(document.getElementById('ornament-export-blocked')!).queryAllByRole('listitem').map(item=>item.textContent??'');
const captureButtonLabels=()=>Array.from(document.querySelectorAll('button')).map(b=>b.textContent??'').filter(text=>/Working|apture map geometry/.test(text));

const search=async()=>{
 fireEvent.change(field('Place or address'),{target:{value:'Crivitz, Wisconsin'}});
 fireEvent.click(screen.getByRole('button',{name:'Search'}));
 await waitFor(()=>expect(document.querySelector('.ornament-results,.ornament-retry')).not.toBeNull());
};

const chooseWithoutFitting=async()=>{
 await search();
 fireEvent.click(screen.getByLabelText(/Zoom to fit/));
 fireEvent.click(screen.getByRole('button',{name:new RegExp(CRIVITZ.label.slice(0,20))}));
 openEverySection();
};

const mount=(options:{deferIdle?:boolean}={})=>{
 const fake=installFakeMapLibre({features:cityCapture(),...options});
 vi.stubGlobal('fetch',vi.fn().mockImplementation(()=>Promise.resolve(proxyReply([CRIVITZ]))));
 render(<OrnamentPage onExit={()=>{}}/>);
 openEverySection();
 return fake;
};

describe('the pipeline says when it is busy',()=>{
 let fake:InstalledFakeMapLibre;
 beforeEach(()=>{localStorage.clear();fake=mount()});
 afterEach(()=>{cleanup();fake.uninstall()});

 it('starts idle',()=>{
  expect(pipelineIsIdle()).toBe(true);
  expect(progress().getAttribute('aria-live')).toBe('polite');
 });

 // The bug behind the flaky "re-capturing after a move clears the dirty state" case. "Captured N
 // feature(s)" appears when the snapshot is set, which is one render before the geometry built from
 // it is finished — at that instant the capture button still reads "Working…". A test that treated
 // the snapshot text as "the capture is done" therefore carried on into a UI that was still moving,
 // and whether its next synchronous query found the settled button label depended on when an
 // out-of-act React update happened to flush. Under full-suite load it sometimes did not.
 //
 // This is the invariant that makes that impossible to get wrong again: while the snapshot text is
 // on screen and the pipeline still reports itself busy, the button is not yet back to its settled
 // name — so `aria-busy` is the only safe thing to wait on, and it is what the suite waits on.
 it('is still busy at the moment the snapshot text first appears',async()=>{
  await chooseWithoutFitting();
  fireEvent.click(screen.getByRole('button',{name:'Capture map geometry'}));
  await waitFor(()=>expect(screen.getByText(/Captured \d+ feature/)).toBeTruthy());
  expect(pipelineIsIdle()).toBe(false);
  expect(captureButtonLabels()).toContain('Working…');
  expect(screen.queryByRole('button',{name:'Re-capture map geometry'})).toBeNull();
 });

 it('reports idle only once the geometry has been built, and the button has settled by then',async()=>{
  await chooseWithoutFitting();
  fireEvent.click(screen.getByRole('button',{name:'Capture map geometry'}));
  await waitFor(()=>{
   expect(screen.getByText(/Captured \d+ feature/)).toBeTruthy();
   expect(pipelineIsIdle()).toBe(true);
  });
  openEverySection();
  expect(captureButtonLabels()).not.toContain('Working…');
  expect(screen.getByRole('button',{name:'Re-capture map geometry'})).toBeTruthy();
  // Idle means the build landed, not merely that the capture did.
  expect(screen.getByText(/road piece\(s\)/)).toBeTruthy();
 });
});

describe('a capture cannot overwrite newer state',()=>{
 let fake:InstalledFakeMapLibre;
 // Held at "still settling", so a capture stays genuinely in flight while the test moves the map
 // underneath it — the rapid pan-during-capture case, made deterministic.
 beforeEach(()=>{localStorage.clear();fake=mount({deferIdle:true})});
 afterEach(()=>{cleanup();fake.uninstall()});

 // Panning during a capture is *not* a stale-result case, and it is worth pinning down why rather
 // than assuming it. `captureOrnamentFeatures` waits for the map to settle and only then reads the
 // viewport, so a pan that happens during the wait is simply part of the view that gets captured —
 // and a pan that happens across the read itself is caught by the before/after check inside the
 // capture, which throws rather than returning half of each view. The capture that arrives here
 // describes the settled map, so export is correctly allowed against it.
 it('captures the settled view when the map is panned while it waits',async()=>{
  await chooseWithoutFitting();
  fireEvent.click(screen.getByRole('button',{name:'Capture map geometry'}));
  expect(pipelineIsIdle()).toBe(false);

  fireEvent.change(field('Zoom'),{target:{value:'16'}});
  openEverySection();

  await act(async()=>{fake.releaseIdle()});
  await waitFor(()=>expect(pipelineIsIdle()).toBe(true));
  openEverySection();

  expect(screen.getByText(/Captured \d+ feature\(s\) at zoom 16/)).toBeTruthy();
  expect(exportButton().disabled).toBe(false);
 });

 // Road detail is the case that genuinely can go stale, because unlike the viewport it is read
 // *before* the wait: the capture asks the map for exactly the layers that detail level draws, and
 // that decision is made when the button is pressed. Change it while the capture is in flight and
 // the features that arrive are the old tier's, under a project that now says otherwise.
 //
 // Before the guard, the arriving capture was stamped with whatever the project's fingerprint said
 // at the moment it landed — the new tier — and export unblocked against features captured under the
 // old one. The snapshot is now built from the capture's own record, so it is stale on arrival and
 // says so instead.
 it('records the detail it actually captured, so changing detail mid-capture blocks export',async()=>{
  await chooseWithoutFitting();
  fireEvent.click(screen.getByRole('button',{name:'Capture map geometry'}));
  expect(pipelineIsIdle()).toBe(false);

  fireEvent.click(screen.getByRole('button',{name:'High'}));
  openEverySection();

  await act(async()=>{fake.releaseIdle()});
  await waitFor(()=>expect(pipelineIsIdle()).toBe(true));
  openEverySection();

  expect(exportButton().disabled).toBe(true);
  expect(blockedReasons().join(' ')).toMatch(/map has moved since the geometry was captured/i);
  expect(screen.getByText(/Map moved since the geometry was captured/)).toBeTruthy();
 });

 it('clears once re-captured, because the second capture describes the current settings',async()=>{
  await chooseWithoutFitting();
  fireEvent.click(screen.getByRole('button',{name:'Capture map geometry'}));
  fireEvent.click(screen.getByRole('button',{name:'High'}));
  await act(async()=>{fake.releaseIdle()});
  await waitFor(()=>expect(pipelineIsIdle()).toBe(true));
  openEverySection();
  expect(exportButton().disabled).toBe(true);

  fireEvent.click(screen.getByRole('button',{name:'Re-capture map geometry'}));
  await waitFor(()=>expect(pipelineIsIdle()).toBe(true));
  openEverySection();
  expect(exportButton().disabled).toBe(false);
 });
});
