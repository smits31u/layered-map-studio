import {useState} from 'react';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {Controls} from '../../src/components/controls/Controls';
import {defaultProject} from '../../src/state/defaultProject';
import type {MapProject} from '../../src/types/project';

// Phase 0 backlog item 6: Controls.tsx is the lake tool's entire sidebar — one large component with
// no tests of its own real user-facing logic (only indirectly touched, via App, in
// generateFailureUi.test.tsx and proceduralTerrainUi.test.tsx). This exercises the actual state
// transitions a user drives from the sidebar: search success/failure, unit conversion and dimension
// validation, layer/road/label toggles, marker add/delete (which renders MarkerCard), the crop-JSON
// developer tool's error path, and the generate/export/error-banner wiring.

const noop=()=>{};
const counts={water:0,roads:0,namedRoads:0,places:0};

// A thin stateful harness — Controls is a controlled component (project/setProject), so a real
// interaction (typing, toggling a checkbox) only sticks if something re-renders it with the new
// project, exactly like App does.
function Harness({initial=defaultProject,...rest}:{initial?:MapProject;onSelect?:(r:any)=>void;onGenerate?:()=>void;onExport?:()=>void;status?:string;generateError?:string}){
 const [project,setProject]=useState(initial);
 return <Controls project={project} setProject={setProject} onSelect={rest.onSelect??noop} onGenerate={rest.onGenerate??noop} onExport={rest.onExport??noop} status={rest.status??'Ready'} generateError={rest.generateError} counts={counts}/>;
}

afterEach(()=>{cleanup();vi.unstubAllGlobals()});

describe('Controls: location search',()=>{
 it('shows results and lets the user pick one, calling onSelect',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,status:200,json:async()=>({query:'x',provider:'photon',attribution:'',results:[{id:'r1',label:'Caldron Falls, WI',coordinates:[-88.207,45.3685],provider:'photon'}],cached:false,providers:[]})}));
  const selected:unknown[]=[];
  render(<Harness onSelect={r=>selected.push(r)}/>);
  fireEvent.click(screen.getByRole('button',{name:'Search'}));
  const result=await screen.findByRole('button',{name:'Caldron Falls, WI'});
  fireEvent.click(result);
  expect(selected).toHaveLength(1);
  expect((selected[0] as {displayName:string}).displayName).toBe('Caldron Falls, WI');
 });

 it('shows "No search results found" when the proxy returns nothing',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,status:200,json:async()=>({query:'x',provider:'photon',attribution:'',results:[],cached:false,providers:[]})}));
  render(<Harness/>);
  fireEvent.click(screen.getByRole('button',{name:'Search'}));
  expect(await screen.findByText('No search results found')).toBeTruthy();
 });

 it('surfaces a proxy failure message instead of silently finding nothing',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,status:502,json:async()=>({error:'Upstream geocoder unreachable',code:'proxy-failed'})}));
  render(<Harness/>);
  fireEvent.click(screen.getByRole('button',{name:'Search'}));
  expect(await screen.findByText('Upstream geocoder unreachable')).toBeTruthy();
 });
});

describe('Controls: physical size',()=>{
 it('converts the readout between inches and millimeters when the unit changes',()=>{
  render(<Harness/>);
  expect(screen.getByText('355.600 × 279.400 mm')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Units'),{target:{value:'mm'}});
  const widthInput=screen.getByLabelText(/^Width/) as HTMLInputElement;
  expect(+widthInput.value).toBeCloseTo(355.6,3);
 });

 it('accepts a valid width change (in inches) and rejects one that falls outside the manufacturable range',()=>{
  render(<Harness/>);
  const widthInput=screen.getByLabelText(/^Width \(in\)/) as HTMLInputElement;
  fireEvent.change(widthInput,{target:{value:'20'}}); // 20in * 25.4 = 508mm, valid
  expect(screen.getByText(/508\.000/)).toBeTruthy();
  fireEvent.change(widthInput,{target:{value:'0.5'}}); // 0.5in ≈ 12.7mm, below the 50mm floor
  expect(screen.queryByText(/12\.7/)).toBeNull(); // rejected: readout still shows the last valid size
  expect(screen.getByText(/508\.000/)).toBeTruthy();
 });
});

// "Mode" labels a <select> in both the Depth data and Roads sections, so every query below is
// scoped with `within` a specific <details> found by its own <summary> text.
const sectionByHeading=(container:HTMLElement,heading:string):HTMLElement=>{
 const summary=[...container.querySelectorAll('summary')].find(s=>s.textContent?.startsWith(heading));
 if(!summary)throw new Error(`No <details> with a summary starting "${heading}"`);
 return summary.closest('details') as HTMLElement;
};

describe('Controls: depth layers and roads',()=>{
 it('switching to Procedural Terrain reveals its own control panel',()=>{
  const {container}=render(<Harness/>);
  expect(screen.queryByLabelText('Bottom profile')).toBeNull();
  const depthSection=sectionByHeading(container,'Depth data');
  fireEvent.change(within(depthSection).getByLabelText('Mode'),{target:{value:'procedural-terrain'}});
  expect(screen.getByLabelText('Bottom profile')).toBeTruthy();
 });

 it('toggles the Land depth panel off and updates the panel count in the section summary',()=>{
  render(<Harness/>);
  expect(screen.getByText(/panels/).textContent).toMatch(/^5 panels/);
  const group=screen.getByRole('group',{name:'Panels to cut'});
  const firstToggle=group.querySelectorAll('input[type="checkbox"]')[0] as HTMLInputElement;
  expect(firstToggle.checked).toBe(true);
  fireEvent.click(firstToggle);
  expect(screen.getByText(/panels/).textContent).toMatch(/^4 panels/);
 });

 it('changes the road mode, updating the section summary',()=>{
  const {container}=render(<Harness/>);
  const roadsSection=sectionByHeading(container,'Roads');
  const summaryMeta=()=>roadsSection.querySelector('summary .summary-meta')!.textContent;
  expect(summaryMeta()).toBe('All roads');
  fireEvent.change(within(roadsSection).getByLabelText('Mode'),{target:{value:'off'}});
  expect(summaryMeta()).toBe('Off');
 });
});

describe('Controls: markers',()=>{
 it('adds a marker, rendering its MarkerCard, and deletes it again from the card',()=>{
  render(<Harness/>);
  expect(screen.getByText('No markers yet — Add Marker, then search for an address.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'+ Add Marker'}));
  expect(screen.getByText('1. New marker')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Delete Marker'}));
  expect(screen.getByText('No markers yet — Add Marker, then search for an address.')).toBeTruthy();
 });
});

describe('Controls: title and subtitle',()=>{
 it('typing a title updates the section summary live',()=>{
  render(<Harness/>);
  expect(screen.getByText('No title')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Title text'),{target:{value:'Caldron Falls'}});
  expect(screen.getByText('Caldron Falls')).toBeTruthy();
 });
});

describe('Controls: developer crop JSON tool',()=>{
 it('reports a clear failure for invalid JSON instead of throwing',()=>{
  render(<Harness/>);
  fireEvent.click(screen.getByText('Developer: crop reproducibility'));
  fireEvent.change(screen.getByPlaceholderText('Paste a saved Crop JSON here to restore it exactly'),{target:{value:'not json'}});
  fireEvent.click(screen.getByRole('button',{name:'Apply Crop JSON'}));
  expect(screen.getByText(/^Apply failed:/)).toBeTruthy();
 });

 it('disables Copy/Apply until there is a crop to copy or JSON to apply',()=>{
  render(<Harness/>);
  fireEvent.click(screen.getByText('Developer: crop reproducibility'));
  expect((screen.getByRole('button',{name:'Copy Crop JSON'}) as HTMLButtonElement).disabled).toBe(true); // no crop selected yet
  expect((screen.getByRole('button',{name:'Apply Crop JSON'}) as HTMLButtonElement).disabled).toBe(true); // no JSON typed yet
 });
});

describe('Controls: generate/export panel',()=>{
 it('wires the Generate and Export buttons to their callbacks, and shows a generate error as an alert',()=>{
  let generated=0,exported=0;
  render(<Harness onGenerate={()=>generated++} onExport={()=>exported++} generateError="No water features found in the selected crop"/>);
  fireEvent.click(screen.getByRole('button',{name:'Generate scene'}));
  fireEvent.click(screen.getByRole('button',{name:'Export SVG'}));
  expect(generated).toBe(1);
  expect(exported).toBe(1);
  expect(screen.getByRole('alert').textContent).toBe('No water features found in the selected crop');
 });

 it('shows the live feature diagnostics passed in via counts',()=>{
  render(<Controls project={defaultProject} setProject={noop} onSelect={noop} onGenerate={noop} onExport={noop} status="Updated" counts={{water:3,roads:12,namedRoads:4,places:2}}/>);
  expect(screen.getByText('Water polygons: 3')).toBeTruthy();
  expect(screen.getByText('Road features: 12')).toBeTruthy();
  expect(screen.getByText('Named roads: 4')).toBeTruthy();
  expect(screen.getByText('Places: 2')).toBeTruthy();
 });
});
