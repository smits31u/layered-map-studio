import 'fake-indexeddb/auto';
import {IDBFactory} from 'fake-indexeddb';
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import App from '../../src/App';
import {MapViewer} from '../../src/map/mapViewer/MapViewer';
import {defaultProject} from '../../src/state/defaultProject';
import {installFakeMapLibre,type InstalledFakeMapLibre} from '../helpers/fakeMapLibre';
import type {CaptureMapFeature} from '../../src/ornament/capture/mapCapture';
import {caldronFallsProject} from '../fixtures/caldronFalls';

// Saved projects in the lake tool, end to end with a real (in-memory) IndexedDB: save, reload the
// page, and the project comes back exactly, rebuilt from its saved geography without the map being
// queried again; open, new, and the dirty marker.

const tick=()=>act(()=>new Promise(resolve=>setTimeout(resolve,0)));
const settle=async()=>{for(let i=0;i<6;i++)await tick()};
const {longitude:lng,latitude:lat}=defaultProject.map;
const square=(d:number)=>[[[lng-d,lat-d],[lng+d,lat-d],[lng+d,lat+d],[lng-d,lat+d],[lng-d,lat-d]]];
const lake={source:'openmaptiles',sourceLayer:'water',geometry:{type:'Polygon',coordinates:square(.02)},properties:{class:'lake'}};
const road={source:'openmaptiles',sourceLayer:'transportation',geometry:{type:'LineString',coordinates:[[lng-.05,lat-.03],[lng+.05,lat-.03]]},properties:{class:'secondary',name:'County Road 577'}};
const captures=(fake:InstalledFakeMapLibre)=>fake.state.queries.length;
const name=()=>screen.getByTestId('project-name').textContent;
const status=()=>screen.getByTestId('project-status').textContent;

let fake:InstalledFakeMapLibre,rect:ReturnType<typeof vi.spyOn>;
beforeEach(()=>{
 // A fresh database per test; the App's store opens globalThis.indexedDB.
 globalThis.indexedDB=new IDBFactory();
 fake=installFakeMapLibre();
 rect=vi.spyOn(Element.prototype,'getBoundingClientRect').mockImplementation(function(this:Element){
  const r=this.classList.contains('crop-frame')?{left:80,top:100,right:320,bottom:300}:{left:0,top:0,right:400,bottom:400};
  return {...r,x:r.left,y:r.top,width:r.right-r.left,height:r.bottom-r.top,toJSON(){}} as DOMRect;
 });
});
afterEach(()=>{cleanup();rect.mockRestore();vi.restoreAllMocks();fake.uninstall()});
const titleText=()=>(screen.getByLabelText('Title text') as HTMLInputElement).value;

async function generateAndName(title:string){
 fake.setFeatures([lake,road] as unknown as CaptureMapFeature[]);
 render(<App/>);
 await settle();
 fireEvent.change(screen.getByLabelText('Title text'),{target:{value:title}});
 fireEvent.click(screen.getByText('Generate scene'));
 await settle();
 expect(screen.getByText('Generated Map').className).toBe('active');
}

describe('saved lake projects',()=>{
 it('Save names the project; a reload reopens it and rebuilds it from the saved geography, no new map query',async()=>{
  await generateAndName('Hamilton Lake');
  expect(name()).toBe('Unsaved project');
  fireEvent.click(screen.getByRole('button',{name:'Save'}));
  expect((screen.getByLabelText('Project name') as HTMLInputElement).value).toBe('Hamilton Lake 14x11');
  fireEvent.submit(screen.getByLabelText('Project name').closest('form')!);
  await waitFor(()=>expect(name()).toBe('Hamilton Lake 14x11'));
  expect(status()).toMatch(/^Saved/);
  const queriesBefore=captures(fake);
  const totalBefore=screen.getByTestId('estimate-total').textContent;
  // Let the debounced autosave land, then "reload": a brand-new App on the same database.
  await act(()=>new Promise(resolve=>setTimeout(resolve,1000)));
  cleanup();
  render(<App/>);
  await waitFor(()=>expect(name()).toBe('Hamilton Lake 14x11'));
  await waitFor(()=>expect(screen.getByText('Generated Map').className).toBe('active'));
  await waitFor(()=>expect(screen.getByTestId('estimate-total').textContent).toBe(totalBefore));
  expect((screen.getByLabelText('Title text') as HTMLInputElement).value).toBe('Hamilton Lake');
  expect(status()).toMatch(/^Saved/);
  expect(screen.getByTestId('project-message').textContent).toBe('Reopened Hamilton Lake 14x11.');
  expect(captures(fake)).toBe(queriesBefore);
 },20000);

 it('a change marks it unsaved; Save writes over it; Save as makes a second project',async()=>{
  await generateAndName('Hamilton Lake');
  fireEvent.click(screen.getByRole('button',{name:'Save'}));
  fireEvent.submit(screen.getByLabelText('Project name').closest('form')!);
  await waitFor(()=>expect(status()).toMatch(/^Saved/));
  fireEvent.change(screen.getByLabelText('Title text'),{target:{value:'Hamilton Lake North'}});
  await waitFor(()=>expect(status()).toBe('Unsaved changes'));
  fireEvent.click(screen.getByRole('button',{name:'Save'}));
  await waitFor(()=>expect(status()).toMatch(/^Saved/));
  fireEvent.click(screen.getByRole('button',{name:'Save as…'}));
  fireEvent.change(screen.getByLabelText('Project name'),{target:{value:'Hamilton 12x18 version'}});
  fireEvent.submit(screen.getByLabelText('Project name').closest('form')!);
  await waitFor(()=>expect(name()).toBe('Hamilton 12x18 version'));
  fireEvent.click(screen.getByRole('button',{name:'Open…'}));
  const list=await screen.findByRole('list',{name:'Projects'});
  await waitFor(()=>expect(within(list).getAllByRole('listitem')).toHaveLength(2));
  expect(within(list).getAllByRole('listitem').map(li=>li.querySelector('b')!.firstChild!.textContent)).toEqual(['Hamilton 12x18 version','Hamilton Lake 14x11']);
 },20000);

 it('Open brings back another project; New starts from the defaults',async()=>{
  await generateAndName('First Lake');
  fireEvent.click(screen.getByRole('button',{name:'Save'}));
  fireEvent.submit(screen.getByLabelText('Project name').closest('form')!);
  await waitFor(()=>expect(name()).toBe('First Lake 14x11'));
  fireEvent.click(screen.getByRole('button',{name:'New'}));
  await waitFor(()=>expect(name()).toBe('Unsaved project'));
  expect((screen.getByLabelText('Title text') as HTMLInputElement).value).toBe('');
  expect(screen.getByText('Map Mode').className).toBe('active');
  fireEvent.click(screen.getByRole('button',{name:'Open…'}));
  fireEvent.click(await screen.findByRole('button',{name:'Open First Lake 14x11'}));
  await waitFor(()=>expect(name()).toBe('First Lake 14x11'));
  await waitFor(()=>expect(screen.getByText('Generated Map').className).toBe('active'));
  expect((screen.getByLabelText('Title text') as HTMLInputElement).value).toBe('First Lake');
 },20000);

 it('a map never saved asks before New; the replaced map comes back with Recover last session',async()=>{
  await generateAndName('Unsaved Lake');
  expect(status()).toBe('Not saved yet (autosaved in this browser)');
  expect(screen.getByTestId('project-status').dataset.dirty).toBe('true');
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
  fireEvent.click(screen.getByRole('button',{name:'New'}));
  expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/^Start a new project\? This map has not been saved/));
  await settle();
  expect(titleText()).toBe('Unsaved Lake');
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole('button',{name:'New'}));
  await waitFor(()=>expect(titleText()).toBe(''));
  await settle();
  // The new map loading into its own view is not unsaved work.
  expect(screen.getByTestId('project-status').dataset.dirty).toBe('false');
  // Let the autosave overwrite the old session; the recovery slot still has it.
  await act(()=>new Promise(resolve=>setTimeout(resolve,1000)));
  fireEvent.click(screen.getByRole('button',{name:'Recover last session'}));
  await waitFor(()=>expect(titleText()).toBe('Unsaved Lake'));
  await waitFor(()=>expect(screen.getByText('Generated Map').className).toBe('active'));
  expect(screen.getByTestId('project-status').dataset.dirty).toBe('true');
 },20000);

 it('Import over unsaved work asks first; cancelling leaves the map alone',async()=>{
  await generateAndName('Unsaved Lake');
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
  fireEvent.click(screen.getByRole('button',{name:'Open…'}));
  const input=await screen.findByLabelText('Import project file');
  fireEvent.change(input,{target:{files:[new File(['{}'],'other.lmsproject.json',{type:'application/json'})]}});
  expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/^Import other\.lmsproject\.json\? This map has not been saved/));
  await settle();
  expect(titleText()).toBe('Unsaved Lake');
  expect(screen.getByRole('dialog',{name:'Saved projects'})).toBeTruthy();
 },20000);

 it('opening a project saved without geography is not marked unsaved when the map loads; moving it is',async()=>{
  render(<App/>);
  await settle();
  fireEvent.change(screen.getByLabelText('Title text'),{target:{value:'Plain Lake'}});
  fireEvent.click(screen.getByRole('button',{name:'Save'}));
  fireEvent.submit(screen.getByLabelText('Project name').closest('form')!);
  await waitFor(()=>expect(status()).toMatch(/^Saved/));
  fireEvent.click(screen.getByRole('button',{name:'New'}));
  await waitFor(()=>expect(name()).toBe('Unsaved project'));
  await settle();
  fireEvent.click(screen.getByRole('button',{name:'Open…'}));
  fireEvent.click(await screen.findByRole('button',{name:'Open Plain Lake 14x11'}));
  await waitFor(()=>expect(name()).toBe('Plain Lake 14x11'));
  await settle();
  expect(status()).toMatch(/^Saved/);
  // MapLibre answers a layout resize with another moveend; nobody touched the map, so still saved.
  act(()=>fake.emit('moveend'));
  await settle();
  expect(status()).toMatch(/^Saved/);
  // The user drags the map: the camera moves, and that is a change.
  fireEvent.pointerDown(document.querySelector('.workspace')!);
  act(()=>{fake.state.center={lng:fake.state.center.lng+.01,lat:fake.state.center.lat};fake.emit('moveend')});
  await waitFor(()=>expect(status()).toBe('Unsaved changes'));
 },20000);
});

describe('MapViewer keepCrop',()=>{
 it('leaves an opened project\'s crop alone when the map loads, and reports a new one once the map is moved',async()=>{
  const crops:unknown[]=[],views:unknown[]=[];
  render(<MapViewer keepCrop project={caldronFallsProject} onView={v=>views.push(v)} onCrop={c=>crops.push(c)} onFeatures={()=>{}} onStatus={()=>{}}/>);
  await tick();
  expect(crops).toEqual([]);
  expect(views).toEqual([]);
  act(()=>fake.emit('moveend'));
  expect(crops).toHaveLength(1);
 });
});
