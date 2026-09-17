import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {OrnamentPage} from '../../src/ornament/ui/OrnamentPage';
import {DEFAULT_ZOOM} from '../../src/ornament/defaults';
import {cityCapture} from '../fixtures/ornament/captures';
import {installFakeMapLibre,type InstalledFakeMapLibre} from '../helpers/fakeMapLibre';

// Phase 2's exit criteria, driven through the UI: "a user can search, choose a result, pan/zoom,
// switch detail, and place the marker while preview and state remain synchronized."
//
// The interactive map itself needs WebGL, which jsdom does not provide, so OrnamentMap renders its
// documented fallback here and the map's own pan/zoom gestures are out of reach. Everything the map
// reports back — viewport changes, the chosen place, the marker position, the dirty flag — goes
// through the store, and that is what this drives. The controls are the same path the map uses.

const CRIVITZ={
 id:'nominatim:374550587',
 label:'Crivitz, Marinette County, Wisconsin, United States',
 coordinates:[-88.0043,45.2323],
 boundingBox:[-88.0246,45.2166,-87.9884,45.2498],
 provider:'nominatim',
 attribution:'© OpenStreetMap contributors — geocoding by Nominatim',
 kind:'village',
};
const SUAMICO={...CRIVITZ,id:'nominatim:2',label:'Suamico, Brown County, Wisconsin',coordinates:[-88.0398,44.6327],boundingBox:undefined};

const PROVIDERS=[
 {id:'nominatim',label:'Nominatim (OpenStreetMap)',attribution:'a',note:'Worldwide'},
 {id:'photon',label:'Photon (Komoot)',attribution:'b',note:'Forgiving'},
 {id:'census',label:'US Census Bureau',attribution:'c',note:'US only'},
];

const proxyReply=(results:unknown[],over:Record<string,unknown>={})=>({
 ok:true,
 status:200,
 json:async()=>({query:'Crivitz',provider:'nominatim',attribution:CRIVITZ.attribution,results,cached:false,providers:PROVIDERS,...over}),
});

const stubFetch=(impl:(url:string)=>unknown)=>{
 const spy=vi.fn().mockImplementation((url:string)=>Promise.resolve(impl(url)));
 vi.stubGlobal('fetch',spy);
 return spy;
};

const field=(label:string)=>screen.getByLabelText(label) as HTMLInputElement;
const openEverySection=()=>{for(const section of document.querySelectorAll('details'))section.setAttribute('open','')};

const search=async(text='Crivitz, Wisconsin')=>{
 fireEvent.change(field('Place or address'),{target:{value:text}});
 fireEvent.click(screen.getByRole('button',{name:'Search'}));
 // The results list, or the "try another provider" block on a miss. Waiting on a result *button*
 // would be ambiguous as soon as two results share a word.
 await waitFor(()=>expect(document.querySelector('.ornament-results,.ornament-retry')).not.toBeNull());
};

const chooseCrivitz=async()=>{
 await search();
 fireEvent.click(screen.getByRole('button',{name:new RegExp(CRIVITZ.label.slice(0,20))}));
 openEverySection();
};

const markerReadout=()=>screen.getByText(/^Marker at /).textContent??'';
const centreReadout=()=>screen.getByText(/^Centre /).textContent??'';

describe('ornament map and search',()=>{
 beforeEach(()=>{localStorage.clear();stubFetch(()=>proxyReply([CRIVITZ,SUAMICO]));render(<OrnamentPage onExit={()=>{}}/>);openEverySection()});
 afterEach(()=>{cleanup();vi.unstubAllGlobals()});

 it('searches only through this app own proxy, and only on submit',async()=>{
  const spy=stubFetch(()=>proxyReply([CRIVITZ]));
  fireEvent.change(field('Place or address'),{target:{value:'Crivitz, Wisconsin'}});
  expect(spy).not.toHaveBeenCalled();                    // no search-as-you-type
  fireEvent.click(screen.getByRole('button',{name:'Search'}));
  await waitFor(()=>expect(spy).toHaveBeenCalledTimes(1));
  const url=String(spy.mock.calls[0][0]);
  expect(url.startsWith('/api/geocode?')).toBe(true);
  expect(url).not.toMatch(/nominatim\.|photon\.|census\./);
 });

 it('refuses to search for nothing',async()=>{
  const spy=stubFetch(()=>proxyReply([CRIVITZ]));
  fireEvent.click(screen.getByRole('button',{name:'Search'}));
  await waitFor(()=>expect(screen.getByText(/Enter a place or address/)).toBeTruthy());
  expect(spy).not.toHaveBeenCalled();
 });

 it('lists the results with their provider attribution',async()=>{
  await search();
  expect(screen.getByText(new RegExp(`2 results from ${PROVIDERS[0].label.slice(0,9)}`))).toBeTruthy();
  expect(screen.getByText(CRIVITZ.attribution)).toBeTruthy();
 });

 it('offers other providers on a miss but does not call them by itself',async()=>{
  const spy=stubFetch(()=>proxyReply([]));
  await search('nowhere at all');
  expect(spy).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button',{name:/Search Photon/})).toBeTruthy();
  expect(screen.getByRole('button',{name:/Search US Census/})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:/Search Photon/}));
  await waitFor(()=>expect(spy).toHaveBeenCalledTimes(2));
  expect(String(spy.mock.calls[1][0])).toContain('provider=photon');
 });

 it('explains a proxy failure instead of failing silently',async()=>{
  stubFetch(()=>({ok:false,status:504,json:async()=>({error:'Nominatim did not respond within 8000ms.',code:'upstream-timeout'})}));
  fireEvent.change(field('Place or address'),{target:{value:'Crivitz'}});
  fireEvent.click(screen.getByRole('button',{name:'Search'}));
  await waitFor(()=>expect(screen.getByText(/did not respond/)).toBeTruthy());
 });

 it('moves the map to a chosen result and puts the marker on it',async()=>{
  await chooseCrivitz();
  expect(centreReadout()).toContain('45.23230, -88.00430');
  expect(markerReadout()).toContain('45.23230, -88.00430');
  // The chosen place is named in the workspace header, not only in the result list it came from.
  expect(document.querySelector('.mode-note')?.textContent).toContain('Crivitz, Marinette County');
 });

 // The bug the plan names directly: "Position the marker at the selected place coordinate, not
 // automatically at the current map center after panning."
 it('leaves the marker where the place is when the map pans',async()=>{
  await chooseCrivitz();
  const before=markerReadout();
  fireEvent.change(field('Zoom'),{target:{value:'17'}});
  openEverySection();
  expect(field('Zoom').value).toBe('17');
  expect(markerReadout()).toBe(before);
 });

 it('moves the marker to the map centre only when explicitly asked',async()=>{
  await chooseCrivitz();
  fireEvent.click(screen.getByRole('button',{name:'Move marker to map centre'}));
  openEverySection();
  expect(markerReadout()).toContain('45.23230, -88.00430');
  // Choosing a second place moves both; then centring keeps them together.
  await search();
  fireEvent.click(screen.getByRole('button',{name:new RegExp(SUAMICO.label.slice(0,14))}));
  openEverySection();
  expect(markerReadout()).toContain('44.63270, -88.03980');
 });

 it('returns the marker to the selected place after it has been moved',async()=>{
  await chooseCrivitz();
  const back=screen.getByRole('button',{name:'Return marker to selected place'}) as HTMLButtonElement;
  expect(back.disabled).toBe(false);
  fireEvent.click(screen.getByRole('button',{name:'Move marker to map centre'}));
  openEverySection();
  fireEvent.click(screen.getByRole('button',{name:'Return marker to selected place'}));
  openEverySection();
  expect(markerReadout()).toContain('45.23230, -88.00430');
 });

 it('cannot return the marker to a place before one has been chosen',()=>{
  expect((screen.getByRole('button',{name:'Return marker to selected place'}) as HTMLButtonElement).disabled).toBe(true);
 });

 it('keeps zoom inside 7 to 19 in half steps',()=>{
  const zoom=field('Zoom');
  expect(zoom.min).toBe('7');
  expect(zoom.max).toBe('19');
  expect(zoom.step).toBe('0.5');
  expect(zoom.value).toBe(String(DEFAULT_ZOOM));
  fireEvent.change(zoom,{target:{value:'25'}});
  expect(field('Zoom').value).toBe('19');
  fireEvent.change(field('Zoom'),{target:{value:'2'}});
  expect(field('Zoom').value).toBe('7');
  fireEvent.change(field('Zoom'),{target:{value:'14.3'}});
  expect(field('Zoom').value).toBe('14.5');
 });

 it('switches road detail',()=>{
  fireEvent.click(screen.getByRole('button',{name:'High'}));
  expect(screen.getByRole('button',{name:'High'}).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('button',{name:'Medium'}).getAttribute('aria-pressed')).toBe('false');
 });

 it('says that bearing and tilt are fixed for this release',()=>{
  expect(screen.getByText(/bearing and tilt are fixed at 0/)).toBeTruthy();
 });
});

// Phase 3 changed what "Capture map geometry" does: it used to record a fingerprint, and now it
// reads features off the map. These tests therefore need a map. The fake in tests/helpers is enough
// of one — real Web Mercator, a real layer filter, fixture features — that clicking capture
// exercises the whole path from queryRenderedFeatures to built geometry, which is more than these
// tests could reach in Phase 2.
describe('dirty state and export blocking',()=>{
 let fake:InstalledFakeMapLibre;
 beforeEach(()=>{
  localStorage.clear();
  fake=installFakeMapLibre({features:cityCapture()});
  stubFetch(()=>proxyReply([CRIVITZ,SUAMICO]));
  render(<OrnamentPage onExit={()=>{}}/>);
  openEverySection();
 });
 afterEach(()=>{cleanup();fake.uninstall()});

 const exportButton=()=>screen.getByRole('button',{name:'Export SVG'}) as HTMLButtonElement;
 const blockedReasons=()=>within(document.getElementById('ornament-export-blocked')!).queryAllByRole('listitem').map(item=>item.textContent??'');

 // Choosing a result with "zoom to fit" left on would move the map to the bounding box centre, which
 // is correct behaviour and simply not what these tests are about.
 const chooseWithoutFitting=async()=>{
  await search();
  fireEvent.click(screen.getByLabelText(/Zoom to fit/));
  fireEvent.click(screen.getByRole('button',{name:new RegExp(CRIVITZ.label.slice(0,20))}));
  openEverySection();
 };

 // Capture is asynchronous now: it waits for the map to settle, reads it, then builds the geometry.
 const captureGeometry=async(name:string|RegExp='Capture map geometry')=>{
  fireEvent.click(screen.getByRole('button',{name}));
  await waitFor(()=>expect(screen.getByText(/Captured \d+ feature/)).toBeTruthy());
  openEverySection();
 };

 it('blocks export before anything is chosen or captured',()=>{
  expect(exportButton().disabled).toBe(true);
  expect(blockedReasons().join(' ')).toMatch(/Search for a place/);
  expect(blockedReasons().join(' ')).toMatch(/Capture the map geometry/);
 });

 it('still blocks export after choosing a place but before capturing',async()=>{
  await chooseWithoutFitting();
  expect(exportButton().disabled).toBe(true);
  expect(blockedReasons().join(' ')).toMatch(/Capture the map geometry/);
  expect(blockedReasons().join(' ')).not.toMatch(/Search for a place/);
 });

 it('allows export once a place is chosen and the geometry is captured',async()=>{
  await chooseWithoutFitting();
  await captureGeometry();
  openEverySection();
  expect(exportButton().disabled).toBe(false);
  expect(screen.queryByText(/Map moved since the geometry was captured/)).toBeNull();
 });

 // The acceptance suite item: "Moving the viewport after a geometry snapshot marks export dirty."
 it('marks the project dirty and disables export when the viewport moves after a capture',async()=>{
  await chooseWithoutFitting();
  await captureGeometry();
  openEverySection();
  expect(exportButton().disabled).toBe(false);

  fireEvent.change(field('Zoom'),{target:{value:'16'}});
  openEverySection();
  expect(exportButton().disabled).toBe(true);
  expect(blockedReasons().join(' ')).toMatch(/map has moved since the geometry was captured/i);
  expect(screen.getByText(/Map moved since the geometry was captured/)).toBeTruthy();
 });

 it('marks it dirty when the road detail changes, because that changes what is captured',async()=>{
  await chooseWithoutFitting();
  await captureGeometry();
  openEverySection();
  fireEvent.click(screen.getByRole('button',{name:'High'}));
  openEverySection();
  expect(exportButton().disabled).toBe(true);
 });

 it('does not mark it dirty for a change that does not affect what is captured',async()=>{
  await chooseWithoutFitting();
  await captureGeometry();
  openEverySection();
  fireEvent.change(field('Title'),{target:{value:'Caldron Falls'}});
  fireEvent.change(field('Road width scale'),{target:{value:'2'}});
  openEverySection();
  expect(exportButton().disabled).toBe(false);
 });

 it('re-capturing after a move clears the dirty state',async()=>{
  await chooseWithoutFitting();
  await captureGeometry();
  openEverySection();
  fireEvent.change(field('Zoom'),{target:{value:'16'}});
  openEverySection();
  await captureGeometry('Re-capture map geometry');
  openEverySection();
  expect(exportButton().disabled).toBe(false);
 });

 it('drops the capture when a different place is chosen',async()=>{
  await chooseWithoutFitting();
  await captureGeometry();
  openEverySection();
  await search();
  fireEvent.click(screen.getByRole('button',{name:new RegExp(SUAMICO.label.slice(0,14))}));
  openEverySection();
  expect(exportButton().disabled).toBe(true);
  expect(blockedReasons().join(' ')).toMatch(/Capture the map geometry/);
  // The header must stop claiming a capture that has just been thrown away.
  expect(document.querySelector('.mode-note')?.textContent).not.toMatch(/captured/i);
 });

 it('resets the place, the capture and the zoom together',async()=>{
  await chooseWithoutFitting();
  await captureGeometry();
  openEverySection();
  fireEvent.click(screen.getByRole('button',{name:'Reset to defaults'}));
  openEverySection();
  expect(field('Zoom').value).toBe(String(DEFAULT_ZOOM));
  expect(exportButton().disabled).toBe(true);
  expect((screen.getByRole('button',{name:'Return marker to selected place'}) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole('button',{name:'Capture map geometry'})).toBeTruthy();
 });
});
