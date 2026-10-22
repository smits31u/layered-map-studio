import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {strFromU8,unzipSync} from 'fflate';
import {GolfPage} from '../../src/golf/ui/GolfPage';
import {GOLF_STORAGE_KEY} from '../../src/golf/persistence';
import {midValleeSnapshot} from '../helpers/golfFixture';

// The golf page as a user drives it (docs/GOLF_MODULE_PLAN.md §8 Phase 1): search, pick, review the
// coverage gate, confirm, see the board, export the ZIP. Fetch is stubbed: the geocoder answers with
// the course, the snapshot route with the recorded Mid Vallee snapshot.

const snapshot=midValleeSnapshot();
const CANDIDATE={id:'photon:W29060461',label:'Mid Vallee Golf Course, De Pere, Wisconsin, United States',coordinates:[-88.18,44.36],provider:'photon',attribution:'© OpenStreetMap contributors',kind:'golf_course',osm:{type:'way',id:29060461}};
const PROVIDERS=[{id:'photon',label:'Photon (Komoot)',attribution:'a',note:'',filters:['golf-course']},{id:'nominatim',label:'Nominatim (OpenStreetMap)',attribution:'a',note:'',filters:['golf-course']},{id:'census',label:'US Census Bureau',attribution:'a',note:''}];
const stored=()=>JSON.parse(localStorage.getItem(GOLF_STORAGE_KEY)!);

let fetchMock:ReturnType<typeof vi.fn>;
let downloads:{name:string;blob:Blob}[];
beforeEach(()=>{
 localStorage.clear();
 downloads=[];
 fetchMock=vi.fn(async(url:string)=>{
  if(url.startsWith('/api/geocode'))return {ok:true,status:200,json:async()=>({query:'Mid Vallee',provider:'photon',attribution:CANDIDATE.attribution,results:[CANDIDATE],cached:false,filter:'golf-course',providers:PROVIDERS})};
  if(url.startsWith('/api/golf/snapshot/way/29060461'))return {ok:true,status:200,json:async()=>({snapshot,cached:false})};
  return {ok:false,status:404,json:async()=>({error:'nope',code:'not-found'})};
 });
 vi.stubGlobal('fetch',fetchMock);
 let blob:Blob|undefined;
 vi.stubGlobal('URL',Object.assign(URL,{createObjectURL:(b:Blob)=>{blob=b;return 'blob:test'},revokeObjectURL:()=>{}}));
 vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(function(this:HTMLAnchorElement){if(blob)downloads.push({name:this.download,blob})});
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals()});

describe('golf page',()=>{
 it('searches golf courses only, on Photon first, and picks a course by its OSM id',async()=>{
  render(<GolfPage/>);
  fireEvent.change(screen.getByLabelText('Golf course'),{target:{value:'Mid Vallee'}});
  fireEvent.click(screen.getByRole('button',{name:'Search'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:/Mid Vallee Golf Course, De Pere/})).toBeTruthy());
  const search=String(fetchMock.mock.calls[0][0]);
  expect(search).toMatch(/^\/api\/geocode\?/);
  expect(search).toContain('provider=photon');
  expect(search).toContain('filter=golf-course');
  // The Census geocoder cannot filter to golf courses, so it is not offered.
  expect(screen.queryByRole('option',{name:'US Census Bureau'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:/Mid Vallee Golf Course, De Pere/}));
  expect(stored().course).toEqual({osmType:'way',osmId:29060461,label:CANDIDATE.label});
  await waitFor(()=>expect(fetchMock.mock.calls.some(c=>String(c[0])==='/api/golf/snapshot/way/29060461')).toBe(true));
 });

 it('holds the board behind the coverage gate until the gaps are confirmed, then exports a ZIP',async()=>{
  localStorage.setItem(GOLF_STORAGE_KEY,JSON.stringify({schemaVersion:1,course:{osmType:'way',osmId:29060461,label:CANDIDATE.label}}));
  render(<GolfPage/>);
  await waitFor(()=>expect(screen.getByText(/26 greens for 27 holes/)).toBeTruthy());
  expect(screen.getByRole('button',{name:'Export ZIP'})).toHaveProperty('disabled',true);
  expect(screen.queryByRole('img',{name:/Board preview/})).toBeNull();
  fireEvent.click(screen.getByLabelText(/build the board anyway/));
  await waitFor(()=>expect(screen.getByRole('img',{name:/Board preview/})).toBeTruthy(),{timeout:15_000});
  await waitFor(()=>expect(screen.getByRole('button',{name:'Export ZIP'})).toHaveProperty('disabled',false),{timeout:15_000});
  fireEvent.click(screen.getByRole('button',{name:'Export ZIP'}));
  await waitFor(()=>expect(downloads).toHaveLength(1),{timeout:30_000});
  expect(downloads[0].name).toBe('mid-vallee-457.2x304.8mm.zip');
  const files=unzipSync(new Uint8Array(await downloads[0].blob.arrayBuffer()));
  expect(Object.keys(files).slice(0,4)).toEqual(['mid-vallee-L0-floor-3.175mm.svg','mid-vallee-L1-ground-3.175mm.svg','mid-vallee-L2-surface-pieces-3.175mm.svg','manifest.json']);
  expect(Object.keys(files)).toContain('estimate.json');
  expect(JSON.parse(strFromU8(files['manifest.json'])).coverage.confirmed).toBe(true);
  expect(screen.getByTestId('golf-export-status').textContent).toMatch(/Exported mid-vallee/);
 },60_000);

 it('takes an OpenStreetMap link instead of a search',()=>{
  render(<GolfPage/>);
  fireEvent.change(screen.getByLabelText('OpenStreetMap link'),{target:{value:'https://www.openstreetmap.org/way/29060461'}});
  fireEvent.click(screen.getByRole('button',{name:'Use'}));
  expect(stored().course).toMatchObject({osmType:'way',osmId:29060461});
  fireEvent.change(screen.getByLabelText('OpenStreetMap link'),{target:{value:'not a link'}});
  fireEvent.click(screen.getByRole('button',{name:'Use'}));
  expect(screen.getByRole('alert').textContent).toMatch(/Paste an OpenStreetMap link/);
 });

 it('shows the busy message when Overpass is throttled, and refreshes on request',async()=>{
  localStorage.setItem(GOLF_STORAGE_KEY,JSON.stringify({schemaVersion:1,course:{osmType:'way',osmId:29060461,label:CANDIDATE.label}}));
  fetchMock.mockImplementationOnce(async()=>({ok:false,status:503,json:async()=>({error:'OpenStreetMap is busy, try again in a minute.',code:'overpass-busy'})}));
  render(<GolfPage/>);
  await waitFor(()=>expect(screen.getAllByText('OpenStreetMap is busy, try again in a minute.').length).toBeGreaterThan(0));
  fireEvent.click(screen.getByRole('button',{name:'Refresh from OSM'}));
  await waitFor(()=>expect(screen.getByText(/26 greens for 27 holes/)).toBeTruthy());
  expect(fetchMock.mock.calls.map(c=>String(c[0]))).toContain('/api/golf/snapshot/way/29060461?refresh=1');
 });
});
