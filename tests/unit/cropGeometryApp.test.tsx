import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import App from '../../src/App';
import {defaultProject} from '../../src/state/defaultProject';
import {installFakeMapLibre,type InstalledFakeMapLibre} from '../helpers/fakeMapLibre';
import type {CaptureMapFeature} from '../../src/ornament/capture/mapCapture';
import {cropContains,cropStretch} from '../../src/geometry/projection/cropAspect';
import type {CropSnapshot} from '../../src/geometry/projection/cropSnapshot';
import {cropGeographyFromSnapshot} from '../../src/geometry/projection/cropSnapshot';

// The 2026-10-15 crop audit, through the app. After Generate, moving the map and then editing a
// sidebar field or pressing Export paired the new crop with features captured for the old one; and
// a board resize away from the map rebuilt from the old crop, stretched onto the new board.

const tick=()=>act(()=>new Promise(resolve=>setTimeout(resolve,0)));
const settle=async()=>{for(let i=0;i<6;i++)await tick()};
// Past the sidebar's live-update debounce.
const debounce=()=>act(()=>new Promise(resolve=>setTimeout(resolve,200)));
const {longitude:lng,latitude:lat}=defaultProject.map;
const square=(d:number)=>[[[lng-d,lat-d],[lng+d,lat-d],[lng+d,lat+d],[lng-d,lat+d],[lng-d,lat-d]]];
const lake={source:'openmaptiles',sourceLayer:'water',geometry:{type:'Polygon',coordinates:square(.02)},properties:{class:'lake'}};
const captures=(fake:InstalledFakeMapLibre)=>fake.state.queries.length;
const alerts=()=>screen.queryAllByRole('alert').map(node=>node.textContent??'').join(' | ');
const cropJson=async():Promise<CropSnapshot>=>{fireEvent.click(screen.getByRole('button',{name:'Copy Crop JSON'}));await settle();return JSON.parse((document.querySelector('textarea') as HTMLTextAreaElement).value)};
const stretch=(s:CropSnapshot)=>cropStretch(cropGeographyFromSnapshot(s),s.dimensions.widthMm,s.dimensions.heightMm);

let fake:InstalledFakeMapLibre,rect:ReturnType<typeof vi.spyOn>,downloads:number;
beforeEach(()=>{
 fake=installFakeMapLibre();
 fake.setFeatures([lake] as unknown as CaptureMapFeature[]);
 // A 280x220 frame (the 14x11 board's shape) inside the fake's 400 px canvas.
 rect=vi.spyOn(Element.prototype,'getBoundingClientRect').mockImplementation(function(this:Element){
  const r=this.classList.contains('crop-frame')?{left:60,top:90,right:340,bottom:310}:{left:0,top:0,right:400,bottom:400};
  return {...r,x:r.left,y:r.top,width:r.right-r.left,height:r.bottom-r.top,toJSON(){}} as DOMRect;
 });
 downloads=0;
 vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{downloads++});
 URL.createObjectURL=vi.fn(()=>'blob:test');URL.revokeObjectURL=vi.fn();
});
afterEach(()=>{cleanup();vi.restoreAllMocks();fake.uninstall()});

async function generated(){
 render(<App/>);
 await settle();
 fireEvent.click(screen.getByText('Generate scene'));
 await settle();
 expect(screen.getByText('Done')).toBeTruthy();
 expect(captures(fake)).toBe(1);
}
// Back to Map Mode and pan the map, as a user would; the crop follows the map.
async function moveMap(){
 fireEvent.click(screen.getByText('Map Mode'));
 await settle();
 act(()=>{fake.state.center={lng:fake.state.center.lng+.05,lat:fake.state.center.lat};fake.emit('moveend')});
 fireEvent.click(screen.getByText('Generated Map'));
 await settle();
}

describe('stale capture',()=>{
 it('a sidebar edit after the map moved is refused, not built from the old crop\'s geography',async()=>{
  await generated();
  await moveMap();
  fireEvent.change(screen.getByLabelText('Title text'),{target:{value:'Caldron Falls'}});
  await debounce();
  expect(screen.getByText('Update refused')).toBeTruthy();
  expect(alerts()).toMatch(/moved since its features were captured/);
 });

 it('Export after the map moved is refused; Generate recaptures and Export then works',async()=>{
  await generated();
  await moveMap();
  fireEvent.click(screen.getByRole('button',{name:'Export SVG'}));
  expect(downloads).toBe(0);
  expect(alerts()).toMatch(/SVG export failed: The map has moved since its features were captured/);
  // Generate mounts the map again and waits for it (polled every 50 ms) before capturing.
  fireEvent.click(screen.getByText('Generate scene'));
  await debounce();await settle();
  expect(captures(fake)).toBe(2);
  fireEvent.click(screen.getByRole('button',{name:'Export SVG'}));
  expect(alerts()).toBe('');
  expect(downloads).toBe(1);
 });
});

describe('board resize away from the map',()=>{
 it('refits the crop to the new board inside the capture and rebuilds without stretching or recapturing',async()=>{
  await generated();
  const before=await cropJson();
  expect(stretch(before)).toBeCloseTo(1,3);
  fireEvent.change(screen.getByLabelText(/^Width \(in\)/),{target:{value:'18'}});
  await debounce();
  fireEvent.change(screen.getByLabelText(/^Height \(in\)/),{target:{value:'12'}});
  await debounce();
  const after=await cropJson();
  expect(after.dimensions.widthMm).toBeCloseTo(457.2,6);expect(after.dimensions.heightMm).toBeCloseTo(304.8,6);
  expect(stretch(after)).toBeCloseTo(1,6);
  expect(cropContains(cropGeographyFromSnapshot(before),cropGeographyFromSnapshot(after))).toBe(true);
  expect(captures(fake)).toBe(1);
  expect(screen.getByText('Updated')).toBeTruthy();
  expect(alerts()).toBe('');
 });
});
