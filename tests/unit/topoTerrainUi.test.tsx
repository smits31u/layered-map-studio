import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {TopoPage} from '../../src/topo/ui/TopoPage';
import {TERRARIUM_TILE_SIZE,latOfMercatorY,lngOfMercatorX} from '../../src/topo/terrain/tiles';
import {installFakeMapLibre,type InstalledFakeMapLibre} from '../helpers/fakeMapLibre';
import {terrariumTile} from '../helpers/terrarium';

// Phase 2 through the page: Generate terrain → edit mode with a preview, settings reruns, the flat
// warning, the missing-tile error, and cancellation by going back to the map. The map is the shared
// fake; /api/terrain is answered with synthetic Terrarium tiles computed from the tile's own
// coordinates, so any view the page freezes gets consistent data. jsdom has no Worker, so this runs
// the runner's inline path — the same generateTerrain the worker runs.

const HEAVY=60_000;
type Elevation=(lng:number,lat:number)=>number;

// A hill centred on the builder's default location.
const hill:Elevation=(lng,lat)=>250+600*Math.exp(-(((lng+88.207)/.012)**2+((lat-45.3685)/.009)**2));
const plain:Elevation=(lng,lat)=>200+3*Math.sin(lng*900)+2*Math.cos(lat*700);

function serveTiles(elevation:Elevation,options:{missing?:(key:string,index:number)=>boolean;hold?:Promise<void>}={}){
 const requested:string[]=[];
 const fetchMock=vi.fn(async(url:string)=>{
  const match=/^\/api\/terrain\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(url);
  if(!match)throw new Error(`unexpected fetch ${url}`);
  const [z,x,y]=match.slice(1).map(Number),key=`${z}/${x}/${y}`;
  const index=requested.push(key)-1;
  await options.hold;
  if(options.missing?.(key,index))return {ok:false,status:404,arrayBuffer:async()=>new ArrayBuffer(0),json:async()=>({code:'missing-tile',error:`Terrain tile ${key} does not exist upstream (HTTP 403).`})};
  const scale=TERRARIUM_TILE_SIZE*2**z;
  const bytes=terrariumTile((px,py)=>Math.round(elevation(lngOfMercatorX((x*TERRARIUM_TILE_SIZE+px+.5)/scale),latOfMercatorY((y*TERRARIUM_TILE_SIZE+py+.5)/scale))*256)/256);
  return {ok:true,status:200,arrayBuffer:async()=>bytes.slice().buffer};
 });
 vi.stubGlobal('fetch',fetchMock);
 return {fetchMock,requested};
}

let fake:InstalledFakeMapLibre;
beforeEach(()=>{localStorage.clear();fake=installFakeMapLibre()});
afterEach(()=>{cleanup();fake.uninstall();vi.unstubAllGlobals()});

const generateButton=()=>screen.getByRole('button',{name:'Generate terrain'});

describe('terrain generation in the topo page',()=>{
 it('generates a preview with layers and contours, and reruns on setting changes without downloading again',async()=>{
  const {fetchMock}=serveTiles(hill);
  render(<TopoPage/>);
  fireEvent.click(generateButton());
  // Capture waits for the map to settle before edit mode opens.
  expect(await screen.findByText('Edit mode')).toBeTruthy();
  await waitFor(()=>expect(screen.getByTestId('terrain-preview')).toBeTruthy(),{timeout:HEAVY});
  // Every request went through the proxy route, one per tile, padding ring included.
  const downloads=fetchMock.mock.calls.length;
  expect(downloads).toBeGreaterThanOrEqual(9);
  expect(fetchMock.mock.calls.every(([url])=>String(url).startsWith('/api/terrain/14/'))).toBe(true);
  expect(screen.getByTestId('terrain-layer-1')).toBeTruthy();
  expect(screen.queryByTestId('terrain-layer-2')).toBeNull();
  expect(screen.getAllByTestId('terrain-contour').length).toBeGreaterThan(0);
  expect(screen.getByLabelText('Terrain details').textContent).toMatch(/Layer 1all land/);
  expect(screen.queryByText(/Very flat area/)).toBeNull();

  fireEvent.click(screen.getByRole('button',{name:'3 layers'}));
  await waitFor(()=>expect(screen.getByTestId('terrain-layer-3')).toBeTruthy(),{timeout:HEAVY});
  expect(screen.getByTestId('terrain-layer-2')).toBeTruthy();
  expect(fetchMock.mock.calls.length).toBe(downloads);
  expect(screen.getByLabelText('Terrain details').textContent).toMatch(/Layer 3≥ [\d.]+ m · 2[45](\.\d)?% of land/);

  fireEvent.click(screen.getByRole('checkbox',{name:'Contours'}));
  // A count, not the element list: a retry that prints <path> nodes makes React warn about `key`.
  await waitFor(()=>expect(screen.queryAllByTestId('terrain-contour').length).toBe(0),{timeout:HEAVY});
 },HEAVY);

 it('warns about a very flat area and still shows the terrain',async()=>{
  serveTiles(plain);
  render(<TopoPage/>);
  fireEvent.click(generateButton());
  await waitFor(()=>expect(screen.getByTestId('terrain-preview')).toBeTruthy(),{timeout:HEAVY});
  expect(screen.getByText(/Very flat area: the land inside the board varies by only [\d.]+ m/)).toBeTruthy();
  expect(screen.getByTestId('terrain-layer-1')).toBeTruthy();
 },HEAVY);

 it('reports a missing tile clearly instead of generating sea level',async()=>{
  const {requested}=serveTiles(hill,{missing:(_key,index)=>index===2});
  render(<TopoPage/>);
  fireEvent.click(generateButton());
  const alert=await screen.findByRole('alert',{},{timeout:HEAVY});
  expect(alert.textContent).toMatch(/Elevation data is missing for this area\./);
  expect(alert.textContent).toMatch(/Elevation tile 14\/\d+\/\d+ is not available/);
  expect(alert.textContent).toMatch(/not replaced with sea level/);
  expect(screen.queryByTestId('terrain-preview')).toBeNull();
  expect(requested.length).toBeGreaterThan(0);
 },HEAVY);

 it('going back to the map cancels a download in progress and discards its result',async()=>{
  let release!:()=>void;
  serveTiles(hill,{hold:new Promise<void>(r=>{release=r})});
  render(<TopoPage/>);
  fireEvent.click(generateButton());
  expect((await screen.findAllByText(/Downloading elevation tiles/)).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button',{name:'← Back to map'}));
  expect(generateButton()).toBeTruthy();
  release();
  await new Promise(r=>setTimeout(r,50));
  expect(screen.queryByTestId('terrain-preview')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText('Map mode')).toBeTruthy();
 },HEAVY);
});
