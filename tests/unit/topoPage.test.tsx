import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {TopoPage} from '../../src/topo/ui/TopoPage';
import {TOPO_STORAGE_KEY} from '../../src/topo/persistence';
import {installFakeMapLibre,type InstalledFakeMapLibre} from '../helpers/fakeMapLibre';

// Phase 1's exit criteria, driven through the page as a user drives it: "a user can select a place,
// set a board size, pan/zoom, load a GPX, reload the app, and recover non-file state."
//
// The map is the shared fake MapLibre (tests/helpers/fakeMapLibre.ts): real Web Mercator
// projection, no rendering. A reload is an unmount and a fresh mount against the same localStorage.

const PLACE={id:'nominatim:1',label:'Rib Mountain, Marathon County, Wisconsin, United States',coordinates:[-89.6851,44.9197],boundingBox:[-89.72,44.90,-89.65,44.94],provider:'nominatim',attribution:'© OpenStreetMap contributors',kind:'peak'};
const PROVIDERS=[{id:'nominatim',label:'Nominatim (OpenStreetMap)',attribution:'a',note:'Worldwide'}];
const gpx=(name:string,points:[number,number][])=>`<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${name}</name><trkseg>${points.map(([lat,lon])=>`<trkpt lat="${lat}" lon="${lon}"/>`).join('')}</trkseg></trk></gpx>`;
const file=(text:string,name='ride.gpx')=>new File([text],name,{type:'application/gpx+xml'});

let fake:InstalledFakeMapLibre;
// The fake's instance, captured so a test can play the part of a user dragging the map.
let mapInstance:{jumpTo(to:{center?:[number,number];zoom?:number}):void}|undefined;
const stored=()=>JSON.parse(localStorage.getItem(TOPO_STORAGE_KEY)!);
const field=(label:string)=>screen.getByLabelText(label) as HTMLInputElement;
// A user gesture on the map: MapLibre fires its events outside React, so the resulting store update
// is wrapped in act() to flush before the test reads anything.
const gesture=(to:{center?:[number,number];zoom?:number})=>act(()=>{mapInstance!.jumpTo(to)});
// jsdom normalises `aspect-ratio: 2` to `2 / 1`; compare the ratio, not the string.
const frameRatio=()=>{const [a,b='1']=screen.getByTestId('topo-crop-frame').style.aspectRatio.split('/');return Number(a)/Number(b)};
const commit=(label:string,value:string)=>{fireEvent.change(field(label),{target:{value}});fireEvent.blur(field(label))};

beforeEach(()=>{
 localStorage.clear();
 fake=installFakeMapLibre();
 const FakeMap=(globalThis.maplibregl as unknown as {Map:new(options:Record<string,unknown>)=>typeof mapInstance}).Map;
 vi.stubGlobal('maplibregl',{...globalThis.maplibregl,Map:class extends (FakeMap as unknown as new(options:Record<string,unknown>)=>object){constructor(options:Record<string,unknown>){super(options);mapInstance=this as unknown as typeof mapInstance}}});
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,status:200,json:async()=>({query:'Rib Mountain',provider:'nominatim',attribution:PLACE.attribution,results:[PLACE],cached:false,providers:PROVIDERS})}));
});
afterEach(()=>{cleanup();fake.uninstall();mapInstance=undefined});

describe('Phase 1 exit criteria',()=>{
 it('selects a place through the existing geocoder proxy and frames it',async()=>{
  render(<TopoPage/>);
  fireEvent.change(field('Place or address'),{target:{value:'Rib Mountain'}});
  fireEvent.click(screen.getByRole('button',{name:'Search'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:/Rib Mountain, Marathon/})).toBeTruthy());
  expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatch(/^\/api\/geocode\?/);
  fireEvent.click(screen.getByRole('button',{name:/Rib Mountain, Marathon/}));
  // Fitted to the result's box: the map is centred inside it, and the store followed the map.
  expect(fake.state.center.lng).toBeGreaterThan(-89.72);expect(fake.state.center.lng).toBeLessThan(-89.65);
  expect(stored().viewport.selectedPlaceLabel).toBe(PLACE.label);
  expect(stored().viewport.center[0]).toBeCloseTo(fake.state.center.lng,9);
 });

 it('sets the board size in either unit, clamps it, and reshapes the crop frame',()=>{
  render(<TopoPage/>);
  expect(field('Width (in)').value).toBe('9');
  commit('Width (in)','12');
  expect(stored().output.widthMm).toBe(304.8);
  fireEvent.click(screen.getByRole('button',{name:'Millimetres'}));
  expect(field('Width (mm)').value).toBe('304.8');
  commit('Height (mm)','152.4');
  expect(stored().output).toEqual({widthMm:304.8,heightMm:152.4});
  expect(frameRatio()).toBe(2);
  commit('Width (mm)','900');
  expect(stored().output.widthMm).toBe(600);
  // Half-typed input is not clamped mid-keystroke: nothing commits until blur or Enter.
  fireEvent.change(field('Height (mm)'),{target:{value:'1'}});
  expect(stored().output.heightMm).toBe(152.4);
  fireEvent.keyDown(field('Height (mm)'),{key:'Enter'});
  expect(stored().output.heightMm).toBe(50);
 });

 it('keeps zoom in sync both ways: the control moves the map, and a map gesture moves the control',()=>{
  render(<TopoPage/>);
  fireEvent.change(field('Zoom'),{target:{value:'11.5'}});
  expect(fake.state.zoom).toBe(11.5);
  expect(stored().viewport.zoom).toBe(11.5);
  // A user drags and wheel-zooms the map; the map reports a continuous zoom, which is kept as-is.
  gesture({center:[-90.1,46.2],zoom:12.37});
  expect(stored().viewport).toMatchObject({center:[-90.1,46.2],zoom:12.37});
  expect(screen.getByText('12.37')).toBeTruthy();
 });

 it('loads a GPX, draws and fits it, replaces it, keeps it through a bad file, and clears it',async()=>{
  render(<TopoPage/>);
  fireEvent.change(field('Load GPX file'),{target:{files:[file(gpx('Ridge loop',[[44.91,-89.70],[44.93,-89.66],[44.92,-89.68]]))]}});
  await waitFor(()=>expect(screen.getByText(/Ridge loop · 3 points from the track/)).toBeTruthy());
  expect(document.querySelector('.topo-route-overlay path')?.getAttribute('d')).toMatch(/^M[\d.-]+ [\d.-]+ L/);
  // Fitted: the map is centred on the route's box.
  expect(fake.state.center.lng).toBeCloseTo(-89.68,6);expect(fake.state.center.lat).toBeCloseTo(44.92,6);

  fireEvent.change(field('Replace GPX file'),{target:{files:[file(gpx('Summit spur',[[44.95,-89.60],[44.96,-89.61]]),'spur.gpx')]}});
  await waitFor(()=>expect(screen.getByText(/Summit spur · 2 points/)).toBeTruthy());

  fireEvent.change(field('Replace GPX file'),{target:{files:[file('<kml/>','notes.kml')]}});
  await waitFor(()=>expect(screen.getByRole('alert').textContent).toMatch(/notes\.kml: The file is XML but not GPX.*The previous route is unchanged/));
  expect(screen.getByText(/Summit spur · 2 points/)).toBeTruthy();

  gesture({center:[-80,40]});
  fireEvent.click(screen.getByRole('button',{name:'Fit to route'}));
  expect(fake.state.center.lng).toBeCloseTo(-89.605,6);

  fireEvent.click(screen.getByRole('button',{name:'Clear route'}));
  expect(screen.queryByText(/Summit spur/)).toBeNull();
  expect(document.querySelector('.topo-route-overlay')).toBeNull();
  expect(field('Load GPX file')).toBeTruthy();
 });

 it('recovers every piece of non-file state after a reload, and not the route',async()=>{
  const first=render(<TopoPage/>);
  fireEvent.click(screen.getByRole('button',{name:'Millimetres'}));
  commit('Width (mm)','400');commit('Height (mm)','250');
  fireEvent.change(field('Place or address'),{target:{value:'Rib Mountain'}});
  fireEvent.click(screen.getByRole('button',{name:'Search'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:/Rib Mountain, Marathon/})).toBeTruthy());
  fireEvent.click(screen.getByRole('button',{name:/Rib Mountain, Marathon/}));
  gesture({center:[-89.7,44.92],zoom:13.25});
  fireEvent.change(field('Load GPX file'),{target:{files:[file(gpx('Ridge loop',[[44.91,-89.70],[44.93,-89.66]]))]}});
  await waitFor(()=>expect(screen.getByText(/Ridge loop/)).toBeTruthy());
  // Loading refits the map onto the route; that lands one render after the summary appears.
  await waitFor(()=>expect(stored().viewport.center[0]).toBeCloseTo(-89.68,9));
  const before=stored();
  first.unmount();

  // Reload.
  render(<TopoPage/>);
  expect(stored()).toEqual(before);
  expect(field('Width (mm)').value).toBe('400');
  expect(field('Height (mm)').value).toBe('250');
  expect(screen.getByRole('button',{name:'Millimetres'}).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByText('13.25')).toBeTruthy();
  // Loading the GPX refitted the map onto the route, so the saved centre is the route's, not the
  // pan before it; the reloaded map opens exactly where the session left it.
  expect(fake.state).toMatchObject({center:{lng:before.viewport.center[0],lat:before.viewport.center[1]},zoom:13.25});
  expect(frameRatio()).toBe(1.6);
  expect(document.body.textContent).toContain(PLACE.label);
  // The route is file state: not persisted, by design.
  expect(screen.queryByText(/Ridge loop/)).toBeNull();
  expect(field('Load GPX file')).toBeTruthy();
 });
});

describe('without WebGL',()=>{
 it('still offers board size and GPX loading, and says why there is no map',()=>{
  fake.uninstall();
  vi.unstubAllGlobals();
  render(<TopoPage/>);
  expect(screen.getByRole('alert').textContent).toMatch(/cannot display an interactive map/);
  commit('Width (in)','10');
  expect(stored().output.widthMm).toBe(254);
 });
});
