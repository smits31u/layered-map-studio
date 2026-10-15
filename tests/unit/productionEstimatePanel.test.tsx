import {useState} from 'react';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {buildScene} from '../../src/export/buildScene';
import {lakeSceneToJob} from '../../src/production/adapters/lakeScene';
import {createDefaultEstimateConfig,type EstimateConfig} from '../../src/production/estimate/config';
import {EstimatePanel} from '../../src/production/estimate/ui/EstimatePanel';
import type {ProductionJob} from '../../src/production/job';
import {caldronFallsFeatures,caldronFallsProject} from '../fixtures/caldronFalls';

// The sidebar estimate on a real lake scene: it shows totals and per-layer rows, and settings edits
// recompute it from the same job, without the scene being rebuilt.

afterEach(()=>{cleanup();vi.restoreAllMocks()});

const scene=buildScene({...caldronFallsProject,title:{...caldronFallsProject.title,text:'Caldron Falls'}},caldronFallsFeatures);

function Harness({job,onConfig}:{job?:ProductionJob;onConfig?:(c:EstimateConfig)=>void}){
 const[config,setConfig]=useState(createDefaultEstimateConfig);
 return <EstimatePanel job={job} title="Caldron Falls" product="Lake depth map" config={config} setConfig={c=>{setConfig(c);onConfig?.(c)}} appVersion="test"/>;
}

describe('EstimatePanel',()=>{
 it('asks for a generated scene before there is one',()=>{
  render(<Harness/>);
  expect(screen.getByText(/Generate the scene to see materials/)).toBeTruthy();
 });

 it('shows a row per piece (border included), sheets by material and an unverified time',()=>{
  render(<Harness job={lakeSceneToJob(scene)}/>);
  const rows=within(screen.getByRole('table',{name:'Estimate per layer'})).getAllByRole('row').slice(1);
  // Default scene: Land, three depth panels, Base, plus the 11x14 recipe's hand-made TruFlat border.
  expect(rows.map(r=>r.querySelector('td')!.firstChild!.textContent)).toEqual(['Border (by hand)','Land / Top','Artistic Depth 1','Artistic Depth 2','Artistic Depth 3','Base / Backer']);
  expect(rows[0].textContent).toContain('by hand');
  // Every input the time depends on is Ben's; it is not calibrated against a real job yet.
  expect(screen.getByTestId('estimate-confidence').textContent).toBe('Uncalibrated - record a real job to check it. Recipe: 11x14. Machine: xTool P2S 55W CO2 (Home).');
  expect(screen.getByTestId('estimate-time').textContent).toMatch(/^~/);
  expect(screen.getByTestId('estimate-total').textContent).toMatch(/^\$\d+\.\d\d$/);
 });

 it('a settings edit recomputes the total from the same job',()=>{
  const job=lakeSceneToJob(scene);
  render(<Harness job={job}/>);
  const before=screen.getByTestId('estimate-total').textContent;
  fireEvent.click(screen.getByRole('button',{name:'Estimate settings…'}));
  fireEvent.click(screen.getByRole('tab',{name:'Rates & fit'}));
  fireEvent.change(screen.getByLabelText(/^Design\$/),{target:{value:'40'}});
  fireEvent.change(screen.getByLabelText(/^Default design time/),{target:{value:'1'}});
  expect(screen.getByTestId('estimate-total').textContent).not.toBe(before);
  const toNumber=(s:string|null)=>Number(s!.replace('$',''));
  expect(toNumber(screen.getByTestId('estimate-total').textContent)).toBeCloseTo(toNumber(before)+40,2);
 });

 it('line interval shows as 300 lines/cm and converts when the unit changes',()=>{
  render(<Harness job={lakeSceneToJob(scene)}/>);
  fireEvent.click(screen.getByRole('button',{name:'Estimate settings…'}));
  const input=()=>screen.getByTestId('xtool-p2s-55w-truflat-lineIntervalMm') as HTMLInputElement;
  expect(input().value).toBe('300');
  expect(input().closest('label')!.textContent).toContain('lines/cm');
  fireEvent.change(screen.getByLabelText('Line interval unit'),{target:{value:'mm'}});
  expect(input().value).toBe('0.0333');
  fireEvent.change(screen.getByLabelText('Line interval unit'),{target:{value:'lpi'}});
  expect(input().value).toBe('762');
 });

 it('only unentered fields carry the PLACEHOLDER label; scoring roads needs the score speed until it is entered',()=>{
  render(<Harness job={lakeSceneToJob(scene)}/>);
  fireEvent.click(screen.getByRole('button',{name:'Estimate settings…'}));
  const label=(id:string)=>screen.getByTestId(id).closest('label')!;
  expect(label('xtool-p2s-55w-truflat-lineIntervalMm').textContent).not.toContain('PLACEHOLDER');
  expect(label('xtool-p2s-55w-truflat-scoreSpeedMmS').textContent).toContain('PLACEHOLDER - calibrate');
  fireEvent.click(screen.getByRole('tab',{name:'Rates & fit'}));
  fireEvent.change(screen.getByLabelText(/^Roads/),{target:{value:'score'}});
  expect(screen.getByTestId('estimate-confidence').textContent).toMatch(/^PLACEHOLDER inputs .* Not entered yet: score speed \(TruFlat/);
  fireEvent.click(screen.getByRole('tab',{name:'Machines'}));
  fireEvent.change(screen.getByTestId('xtool-p2s-55w-truflat-scoreSpeedMmS'),{target:{value:'150'}});
  expect(label('xtool-p2s-55w-truflat-scoreSpeedMmS').textContent).not.toContain('PLACEHOLDER');
  expect(screen.getByTestId('estimate-confidence').textContent).toMatch(/^Uncalibrated/);
 });

 it('the Sterlings machines are listed and each recipe names its machine',()=>{
  render(<Harness job={lakeSceneToJob(scene)}/>);
  fireEvent.click(screen.getByRole('button',{name:'Estimate settings…'}));
  expect(within(screen.getByRole('group',{name:'Machine'})).getAllByRole('button').map(b=>b.textContent)).toEqual(['xTool P2S 55W CO2 (Home)','OMTech (Sterlings)','Thunder (Sterlings)','+ Machine']);
  fireEvent.click(screen.getByRole('tab',{name:'Layer recipes'}));
  expect((screen.getByLabelText('Machine for 18x24') as HTMLSelectElement).value).toBe('omtech-sterlings');
  expect((screen.getByLabelText('Machine for 24x36') as HTMLSelectElement).value).toBe('thunder-sterlings');
 });

 it('timed design work is billed instead of the default design hours',()=>{
  localStorage.setItem('layered-map-studio.design-timer.v1',JSON.stringify({running:false,accumulatedMs:30*60000,lastActivity:null}));
  try{
   render(<Harness job={lakeSceneToJob(scene)}/>);
   expect(screen.getByTestId('design-timer').textContent).toBe('0:30:00');
   expect(screen.getByTestId('estimate-design').textContent).toBe('$12.50');
   fireEvent.click(screen.getByRole('button',{name:'Reset'}));
   expect(screen.getByTestId('estimate-design').textContent).toBe('$0.00');
   expect(screen.getByRole('button',{name:'Start'})).toBeTruthy();
  }finally{localStorage.removeItem('layered-map-studio.design-timer.v1')}
 });

 it('records an actual job time and offers the multiplier it implies',()=>{
  const configs:EstimateConfig[]=[];
  render(<Harness job={lakeSceneToJob(scene)} onConfig={c=>configs.push(c)}/>);
  fireEvent.change(screen.getByLabelText('Actual job minutes'),{target:{value:'95'}});
  fireEvent.click(screen.getByRole('button',{name:'Record actual time'}));
  expect(configs.at(-1)!.calibration).toHaveLength(1);
  expect(configs.at(-1)!.calibration[0].actualMin).toBe(95);
  const table=screen.getByRole('table',{name:'Estimate versus actual'});
  expect(within(table).getByText('95.0')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:/^Use multiplier x/}));
  expect(configs.at(-1)!.machines.find(m=>m.id==='xtool-p2s-55w')!.travelMultiplier).not.toBe(1.3);
  expect(configs.at(-1)!.calibration[0].machineId).toBe('xtool-p2s-55w');
 });

 it('exports the estimate JSON as a download',()=>{
  const created:Blob[]=[];
  const urls=URL as unknown as {createObjectURL?:(b:Blob)=>string;revokeObjectURL?:(u:string)=>void};
  const original={create:urls.createObjectURL,revoke:urls.revokeObjectURL};
  urls.createObjectURL=b=>{created.push(b);return 'blob:test'};
  urls.revokeObjectURL=()=>{};
  try{
   const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
   render(<Harness job={lakeSceneToJob(scene)}/>);
   fireEvent.click(screen.getByRole('button',{name:'Estimate JSON'}));
   expect(click).toHaveBeenCalledTimes(1);
   expect(created[0].type).toBe('application/json');
  }finally{urls.createObjectURL=original.create;urls.revokeObjectURL=original.revoke}
 });
});
