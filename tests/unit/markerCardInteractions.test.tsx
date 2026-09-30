import {useState} from 'react';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {MarkerCard} from '../../src/components/controls/MarkerCard';
import {DEFAULT_MARKER_SIZE_MM} from '../../src/geometry/scene/markerRegistry';
import {caldronFallsProject} from '../fixtures/caldronFalls';
import type {MapMarker,MapProject} from '../../src/types/project';

// Phase 0 backlog item 6: MarkerCard.tsx (the per-marker editor block in the lake tool's sidebar)
// had 0% test coverage. It carries its own local address-search state machine (search/found/
// ambiguous/not-found/error) independent of the rest of Controls.tsx, which this exercises directly
// along with the field edits and the geographic-bounds warning.

const marker=(overrides:Partial<MapMarker> = {}):MapMarker=>({
 id:'marker-1',markerType:'pin',sizeMm:DEFAULT_MARKER_SIZE_MM,rotationDeg:0,showLabel:false,labelSizeMm:3,visible:true,operation:'engrave',keepOutEnabled:false,keepOutPaddingMm:2,
 ...overrides,
});

// A stateful harness: MarkerCard is controlled (marker/onUpdate), so an update only becomes visible
// (e.g. Status flipping to "Found") if something feeds the patch back in as a new marker prop,
// exactly like Controls.tsx's patchMarker does for the real sidebar.
function Harness({initial,project=caldronFallsProject,updates,resets,onDelete}:{initial:MapMarker;project?:MapProject;updates:Partial<MapMarker>[];resets:number[];onDelete:()=>void}){
 const [m,setM]=useState(initial);
 return <MarkerCard marker={m} project={project} index={0} onUpdate={p=>{updates.push(p);setM(prev=>({...prev,...p}))}} onResetPosition={()=>resets.push(1)} onDelete={onDelete}/>;
}

function renderCard(overrides:Partial<MapMarker> = {},project:MapProject=caldronFallsProject){
 const updates:Partial<MapMarker>[]=[],resets:number[]=[];let deleted=0;
 const m=marker(overrides);
 const utils=render(<Harness initial={m} project={project} updates={updates} resets={resets} onDelete={()=>deleted++}/>);
 return {...utils,updates,resets,getDeleted:()=>deleted,m};
}

afterEach(()=>{cleanup();vi.unstubAllGlobals()});

describe('MarkerCard: address search',()=>{
 it('shows "New marker" as the summary when the marker has no label or address yet',()=>{
  renderCard();
  expect(screen.getByText('1. New marker')).toBeTruthy();
 });

 it('requires an address before searching',()=>{
  const {updates}=renderCard();
  fireEvent.click(screen.getByRole('button',{name:'Find Address'}));
  expect(screen.getByText('Enter an address first')).toBeTruthy();
  expect(updates).toHaveLength(0);
 });

 it('auto-applies a single geocode match',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,status:200,json:async()=>({query:'x',provider:'photon',attribution:'',results:[{id:'r1',label:'123 Main St',coordinates:[-88.207,45.3685],provider:'photon'}],cached:false,providers:[]})}));
  const {updates}=renderCard();
  fireEvent.change(screen.getByLabelText('Address'),{target:{value:'123 Main St'}});
  fireEvent.click(screen.getByRole('button',{name:'Find Address'}));
  await screen.findByText('Status: Found');
  expect(updates).toHaveLength(1);
  expect(updates[0]).toMatchObject({address:'123 Main St',lat:45.3685,lng:-88.207});
 });

 it('offers a choice for an ambiguous address, applying whichever the user picks',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,status:200,json:async()=>({query:'x',provider:'photon',attribution:'',results:[
   {id:'r1',label:'Main St, Springfield, IL',coordinates:[-89.6,39.8],provider:'photon'},
   {id:'r2',label:'Main St, Springfield, MO',coordinates:[-93.3,37.2],provider:'photon'},
  ],cached:false,providers:[]})}));
  const {updates}=renderCard();
  fireEvent.change(screen.getByLabelText('Address'),{target:{value:'Main St, Springfield'}});
  fireEvent.click(screen.getByRole('button',{name:'Find Address'}));
  const option=await screen.findByRole('button',{name:'Main St, Springfield, MO'});
  expect(updates).toHaveLength(0); // not auto-applied while ambiguous
  fireEvent.click(option);
  expect(updates).toHaveLength(1);
  expect(updates[0]).toMatchObject({lat:37.2,lng:-93.3});
 });

 it('reports "Address not found" when every provider returns nothing, without applying anything',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,status:200,json:async()=>({query:'x',provider:'photon',attribution:'',results:[],cached:false,providers:[]})}));
  const {updates}=renderCard();
  fireEvent.change(screen.getByLabelText('Address'),{target:{value:'Nowhere'}});
  fireEvent.click(screen.getByRole('button',{name:'Find Address'}));
  expect(await screen.findByText('Address not found')).toBeTruthy();
  expect(await screen.findByText('Status: Not Found')).toBeTruthy();
  expect(updates).toHaveLength(0);
 });

 it('surfaces an unreachable-proxy error rather than a generic failure',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('network down')));
  renderCard();
  fireEvent.change(screen.getByLabelText('Address'),{target:{value:'Somewhere'}});
  fireEvent.click(screen.getByRole('button',{name:'Find Address'}));
  expect(await screen.findByText(/could not be reached/)).toBeTruthy();
 });
});

describe('MarkerCard: geographic bounds warning',()=>{
 it('warns when the geocoded marker sits outside the current crop',()=>{
  renderCard({lat:10,lng:10}); // far outside the Caldron Falls crop bbox
  expect(screen.getByText('Address is outside the current map area.')).toBeTruthy();
 });

 it('shows no warning for a marker inside the crop',()=>{
  renderCard({lat:45.3685,lng:-88.207});
  expect(screen.queryByText('Address is outside the current map area.')).toBeNull();
 });
});

describe('MarkerCard: field edits',()=>{
 it('changes marker type, size and rotation',()=>{
  const {updates}=renderCard();
  fireEvent.change(screen.getByLabelText('Marker'),{target:{value:'star'}});
  fireEvent.change(screen.getByLabelText(/^Size mm/),{target:{value:'12'}});
  fireEvent.change(screen.getByLabelText(/^Rotation/),{target:{value:'45'}});
  expect(updates).toEqual([{markerType:'star'},{sizeMm:12},{rotationDeg:45}]);
 });

 it('reveals the label size field only once Show Label is checked',()=>{
  const {updates}=renderCard();
  expect(screen.queryByLabelText(/^Label size mm/)).toBeNull();
  fireEvent.click(screen.getByRole('checkbox',{name:'Show Label'}));
  expect(updates).toEqual([{showLabel:true}]);
  expect(screen.getByLabelText(/^Label size mm/)).toBeTruthy();
 });

 it('reveals the clearance field only once keep-out is enabled',()=>{
  const {updates}=renderCard();
  expect(screen.queryByLabelText(/^Clearance mm/)).toBeNull();
  fireEvent.click(screen.getByRole('checkbox',{name:'Clear Roads Around Marker'}));
  expect(updates).toEqual([{keepOutEnabled:true}]);
  expect(screen.getByLabelText(/^Clearance mm/)).toBeTruthy();
 });

 it('toggles operation and visibility', () => {
  const {updates}=renderCard();
  fireEvent.change(screen.getByLabelText('Operation'),{target:{value:'cut'}});
  fireEvent.click(screen.getByRole('checkbox',{name:'Visible'}));
  expect(updates).toEqual([{operation:'cut'},{visible:false}]);
 });

 it('wires Reset to Exact Address and Delete Marker to their callbacks',()=>{
  const {resets,getDeleted}=renderCard();
  fireEvent.click(screen.getByRole('button',{name:'Reset to Exact Address'}));
  fireEvent.click(screen.getByRole('button',{name:'Delete Marker'}));
  expect(resets).toEqual([1]);
  expect(getDeleted()).toBe(1);
 });
});
