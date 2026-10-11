import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import App from '../../src/App';
import {defaultProject} from '../../src/state/defaultProject';
import {installFakeMapLibre,type InstalledFakeMapLibre} from '../helpers/fakeMapLibre';
import type {CaptureMapFeature} from '../../src/ornament/capture/mapCapture';

// Hamilton Lake, Waucedah Twp: Generate was pressed without "Load visible vector features" and
// failed with "No water features found in the selected crop" while the crop plainly held three
// lakes and a county road — it had built from an empty capture. Generate now captures on its own
// whenever nothing has been captured for the current crop.

const tick=()=>act(()=>new Promise(resolve=>setTimeout(resolve,0)));
const settle=async()=>{for(let i=0;i<6;i++)await tick()};
const {longitude:lng,latitude:lat}=defaultProject.map;
const square=(d:number)=>[[[lng-d,lat-d],[lng+d,lat-d],[lng+d,lat+d],[lng-d,lat+d],[lng-d,lat-d]]];
// What the lake tool's extractor reads: vector-source features by OpenMapTiles source-layer.
const lake={source:'openmaptiles',sourceLayer:'water',geometry:{type:'Polygon',coordinates:square(.02)},properties:{class:'lake'}};
const road={source:'openmaptiles',sourceLayer:'transportation',geometry:{type:'LineString',coordinates:[[lng-.05,lat-.03],[lng+.05,lat-.03]]},properties:{class:'secondary',name:'County Road 577'}};
const captures=(fake:InstalledFakeMapLibre)=>fake.state.queries.length;
const counts=()=>document.querySelector('.diagnostics')!.textContent!;

let fake:InstalledFakeMapLibre,rect:ReturnType<typeof vi.spyOn>;
beforeEach(()=>{
 fake=installFakeMapLibre();
 // jsdom lays nothing out; give the crop frame an on-screen box inside the 400 px fake canvas.
 rect=vi.spyOn(Element.prototype,'getBoundingClientRect').mockImplementation(function(this:Element){
  const r=this.classList.contains('crop-frame')?{left:80,top:100,right:320,bottom:300}:{left:0,top:0,right:400,bottom:400};
  return {...r,x:r.left,y:r.top,width:r.right-r.left,height:r.bottom-r.top,toJSON(){}} as DOMRect;
 });
});
afterEach(()=>{cleanup();rect.mockRestore();fake.uninstall()});

describe('Generate with no prior capture',()=>{
 it('captures the visible features itself and builds the scene',async()=>{
  fake.setFeatures([lake,road] as unknown as CaptureMapFeature[]);
  render(<App/>);
  await settle(); // the map's load event sets the crop
  expect(captures(fake)).toBe(0);
  fireEvent.click(screen.getByText('Generate scene'));
  await settle();
  expect(captures(fake)).toBe(1);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText('Done')).toBeTruthy();
  expect(counts()).toContain('Water polygons: 1');
  expect(counts()).toContain('Named roads: 1');
  expect(screen.getByText('Generated Map').className).toBe('active');
 });

 it('reuses a capture already taken for the same crop instead of capturing again',async()=>{
  fake.setFeatures([lake,road] as unknown as CaptureMapFeature[]);
  render(<App/>);
  await settle();
  fireEvent.click(screen.getByRole('button',{name:'Load visible vector features'}));
  await settle();
  expect(captures(fake)).toBe(1);
  fireEvent.click(screen.getByText('Generate scene'));
  await settle();
  expect(captures(fake)).toBe(1);
  expect(screen.getByText('Done')).toBeTruthy();
 });

 it('says "No features captured", not "No water found", when the capture comes back empty',async()=>{
  render(<App/>);
  await settle();
  fireEvent.click(screen.getByText('Generate scene'));
  await settle();
  expect(captures(fake)).toBe(1);
  const alerts=screen.getAllByRole('alert').map(node=>node.textContent??'');
  expect(alerts.some(text=>text.includes('No features captured'))).toBe(true);
  expect(alerts.some(text=>/No water/i.test(text))).toBe(false);
  expect(screen.getByText('Generate failed')).toBeTruthy();
 });

 it('still says "No water features found" when roads were captured but no water',async()=>{
  fake.setFeatures([road] as unknown as CaptureMapFeature[]);
  render(<App/>);
  await settle();
  fireEvent.click(screen.getByText('Generate scene'));
  await settle();
  expect(screen.getAllByRole('alert').some(node=>node.textContent==='No water features found in the selected crop')).toBe(true);
 });
});
