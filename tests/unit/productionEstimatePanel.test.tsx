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
  // Default scene: Land, three depth panels, Base, plus the 11x14 recipe's TruFlat border.
  expect(rows.map(r=>r.querySelector('td')!.firstChild!.textContent)).toEqual(['Border','Land / Top','Artistic Depth 1','Artistic Depth 2','Artistic Depth 3','Base / Backer']);
  expect(screen.getByTestId('estimate-confidence').textContent).toMatch(/PLACEHOLDER speeds - not a real time\. Recipe: 11x14/);
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
  fireEvent.change(screen.getByLabelText(/^Design time/),{target:{value:'1'}});
  expect(screen.getByTestId('estimate-total').textContent).not.toBe(before);
  const toNumber=(s:string|null)=>Number(s!.replace('$',''));
  expect(toNumber(screen.getByTestId('estimate-total').textContent)).toBeCloseTo(toNumber(before)+40,2);
 });

 it('editing a speed clears that material\'s PLACEHOLDER label',()=>{
  render(<Harness job={lakeSceneToJob(scene)}/>);
  fireEvent.click(screen.getByRole('button',{name:'Estimate settings…'}));
  expect(screen.getByTestId('placeholder-mdf-1-8').textContent).toBe('PLACEHOLDER - calibrate');
  const mdf=screen.getByTestId('placeholder-mdf-1-8').closest('fieldset')!;
  fireEvent.change(within(mdf).getByLabelText(/^Cut speed/),{target:{value:'18'}});
  expect(screen.queryByTestId('placeholder-mdf-1-8')).toBeNull();
  expect(screen.getByTestId('placeholder-truflat')).toBeTruthy();
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
  expect(configs.at(-1)!.machine.travelMultiplier).not.toBe(1.3);
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
