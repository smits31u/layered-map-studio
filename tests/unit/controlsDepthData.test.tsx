import {useState} from 'react';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {Controls} from '../../src/components/controls/Controls';
import type {GeoMultiPolygon} from '../../src/bathymetry/model';
import {importDepthRegionGeoJson} from '../../src/bathymetry/model';
import {MICHIGAN_DNR_ATTRIBUTION} from '../../src/bathymetry/providers';
import {defaultProject} from '../../src/state/defaultProject';
import type {MapProject} from '../../src/types/project';
import {caldronFallsFeatures} from '../fixtures/caldronFalls';
import recorded from '../fixtures/michiganDnr/dickinsonCounty.json';

// The sidebar's Depth data section as a user drives it: Check Bathymetry on a Michigan lake loads
// Michigan DNR contours and switches to True Bathymetry with the attribution shown; a Wisconsin
// "match" with WBIC 0, an out-of-state lake, and a water body that could not be captured each end in
// an honest message rather than a fake match; and depth-region GeoJSON import succeeds or explains
// why not.

const counts={water:0,roads:0,namedRoads:0,places:0};
function Harness({initial=defaultProject,selectedWater}:{initial?:MapProject;selectedWater?:()=>Promise<GeoMultiPolygon>}){
 const [project,setProject]=useState(initial);
 return <Controls project={project} setProject={setProject} onSelect={()=>{}} onGenerate={()=>{}} onExport={()=>{}} status="Ready" counts={counts} selectedWater={selectedWater}/>;
}
const notice=()=>document.querySelector('small.notice')!.textContent??'';
const modeSelect=()=>screen.getAllByRole('combobox').find(node=>[...(node as HTMLSelectElement).options].some(o=>o.value==='true-bathymetry')) as HTMLSelectElement;
const shoreline=(key:string):GeoMultiPolygon=>[[(recorded.contours as unknown as {attributes:{NewKey:string;MinDepth:number};geometry:{paths:[number,number][][]}}[]).find(f=>f.attributes.NewKey===key&&f.attributes.MinDepth===0)!.geometry.paths[0]]];
const caldron:GeoMultiPolygon=[[caldronFallsFeatures.water[0].rings[0].map(p=>[p.lng,p.lat] as [number,number])]];
// The Michigan DNR FeatureServer, answered from the recorded Dickinson County responses.
const michiganService=vi.fn(async(url:string)=>{const layer=new URL(url).pathname.match(/FeatureServer\/(\d)\/query$/)?.[1];if(!layer)throw new Error(`unexpected request ${url}`);return {ok:true,json:async()=>({features:layer==='0'?recorded.deepPoints:recorded.contours})}});

afterEach(()=>{cleanup();vi.unstubAllGlobals();localStorage.clear();michiganService.mockClear()});

describe('Depth data: Check Bathymetry',()=>{
 it('Michigan lake: loads Michigan DNR contours, switches to True Bathymetry and credits the source',async()=>{
  vi.stubGlobal('fetch',michiganService);
  render(<Harness selectedWater={async()=>shoreline('22-15')}/>);
  const button=screen.getByRole('button',{name:'Check Bathymetry'});
  fireEvent.click(button);
  expect(screen.getByRole('button',{name:'Checking providers…'})).toHaveProperty('disabled',true);
  await waitFor(()=>expect(notice()).toContain('Michigan DNR contours loaded for Hamilton Lake (22-15, Dickinson Co.)'));
  expect(notice()).toContain('5, 10, 15, 25, 30 ft');
  expect(modeSelect().value).toBe('true-bathymetry');
  expect(screen.getByText(/^Range: 5\.0–30\.0 ft/).textContent).toContain(`Data: ${MICHIGAN_DNR_ATTRIBUTION} · NOT FOR NAVIGATION`);
  expect(michiganService.mock.calls.every(([u])=>String(u).startsWith('https://services3.arcgis.com/'))).toBe(true);
  // Manual thresholds offer exactly the surveyed levels.
  fireEvent.change(screen.getAllByRole('combobox').find(n=>[...(n as HTMLSelectElement).options].some(o=>o.value==='manual'))!,{target:{value:'manual'}});
  const levels=[...(screen.getAllByRole('combobox').find(n=>(n.closest('label')?.textContent??'').startsWith('Depth layer 1')) as HTMLSelectElement).options].map(o=>o.textContent);
  expect(levels).toEqual(['5.0 ft','10.0 ft','15.0 ft','25.0 ft','30.0 ft']);
 });

 it('Wisconsin lake with only a WBIC 0 record: says no match, never "Waterbody found"',async()=>{
  const wiService=vi.fn(async(_url:string)=>({ok:true,json:async()=>({features:[{attributes:{WATERBODY_NAME:'Caldron Falls Flowage',WATERBODY_WBIC:0}}]})}));
  vi.stubGlobal('fetch',wiService);
  render(<Harness selectedWater={async()=>caldron}/>);
  fireEvent.click(screen.getByRole('button',{name:'Check Bathymetry'}));
  await waitFor(()=>expect(notice()).toContain('Wisconsin DNR hydrography found no matching lake'));
  expect(notice()).not.toMatch(/Waterbody found|WBIC/);
  expect(wiService.mock.calls[0][0]).toMatch(/^https:\/\/dnrmaps\.wi\.gov\//);
  expect(modeSelect().value).toBe('decorative-offsets');
 });

 it('a lake outside Wisconsin and Michigan: no measured source, and no agency is asked',async()=>{
  const network=vi.fn();
  vi.stubGlobal('fetch',network);
  render(<Harness selectedWater={async()=>[[[[-88.1,42.2],[-88.09,42.2],[-88.09,42.21],[-88.1,42.21],[-88.1,42.2]]]]}/>);
  fireEvent.click(screen.getByRole('button',{name:'Check Bathymetry'}));
  await waitFor(()=>expect(notice()).toContain('No measured depth source for this state'));
  expect(network).not.toHaveBeenCalled();
 });

 it('when the water body cannot be captured, says so and drops the previous lake\'s dataset',async()=>{
  const dataset=importDepthRegionGeoJson({type:'FeatureCollection',features:[{type:'Feature',properties:{depth:5,depth_unit:'ft'},geometry:{type:'Polygon',coordinates:[[[-88.2,45.3],[-88.1,45.3],[-88.1,45.4],[-88.2,45.3]]]}}]},'old.geojson');
  const initial:MapProject={...defaultProject,bathymetry:{...defaultProject.bathymetry,mode:'true-bathymetry',provider:'user',dataset,datasetId:dataset.source.datasetId,status:'available',statusMessage:'Loaded old.'}};
  render(<Harness initial={initial} selectedWater={async()=>{throw new Error('No water features captured in the selected crop.')}}/>);
  expect(screen.getByText(/^Range:/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Check Bathymetry'}));
  await waitFor(()=>expect(notice()).toBe('Could not identify the selected water body: No water features captured in the selected crop.'));
  expect(document.querySelector('small.notice')!.getAttribute('data-severity')).toBe('error');
  expect(screen.queryByText(/^Range:/)).toBeNull();
  expect(screen.getByRole('button',{name:'Check Bathymetry'})).toHaveProperty('disabled',false);
 });
});

describe('Depth data: GeoJSON import',()=>{
 const upload=async(name:string,body:string)=>{
  const input=document.querySelector('input[type=file]') as HTMLInputElement;
  const file=new File([body],name,{type:'application/geo+json'});
  await act(async()=>{fireEvent.change(input,{target:{files:[file]}})});
 };
 it('loads depth regions, switches to True Bathymetry and reports the levels',async()=>{
  render(<Harness/>);
  const square=(d:number,depth:number)=>({type:'Feature',properties:{depth,depth_unit:'ft'},geometry:{type:'Polygon',coordinates:[[[-88.21-d,45.37-d],[-88.21+d,45.37-d],[-88.21+d,45.37+d],[-88.21-d,45.37+d],[-88.21-d,45.37-d]]]}});
  await upload('caldron.geojson',JSON.stringify({type:'FeatureCollection',features:[square(.02,5),square(.01,15)]}));
  await waitFor(()=>expect(notice()).toBe('Loaded 2 verified depth-region levels from caldron.geojson.'));
  expect(modeSelect().value).toBe('true-bathymetry');
 });
 it('explains a file without depth units instead of importing it',async()=>{
  render(<Harness/>);
  await upload('bad.geojson',JSON.stringify({type:'FeatureCollection',features:[{type:'Feature',properties:{depth:5},geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,0]]]}}]}));
  await waitFor(()=>expect(notice()).toBe('Unsupported or missing depth unit: (missing)'));
  expect(document.querySelector('small.notice')!.getAttribute('data-severity')).toBe('error');
  expect(modeSelect().value).toBe('decorative-offsets');
 });
});
