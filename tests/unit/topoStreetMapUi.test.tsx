import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {createDefaultTopoProject} from '../../src/topo/defaults';
import {TOPO_STORAGE_KEY} from '../../src/topo/persistence';
import type {TerrainJob} from '../../src/topo/terrain/pipeline';
import {createInlineTerrainRunner,type TerrainRunner} from '../../src/topo/terrain/worker/terrainRunner';
import {TopoPage} from '../../src/topo/ui/TopoPage';
import {installFakeMapLibre,type InstalledFakeMapLibre} from '../helpers/fakeMapLibre';
import {loadTopoFixture} from '../helpers/topoFixtures';

// The Street Map mode through the page: choosing it swaps the terrain controls for the street ones
// and the button for "Build street map", and building one captures the map and runs the worker
// without a single elevation download. The map answers with the real downtown San Francisco capture;
// any fetch at all fails the test.

const HEAVY=120_000;
const fixture=loadTopoFixture('sf-city');

let fake:InstalledFakeMapLibre,terrainJobs:TerrainJob[],fetchMock:ReturnType<typeof vi.fn>;
beforeEach(()=>{
 localStorage.clear();
 const project=createDefaultTopoProject();
 localStorage.setItem(TOPO_STORAGE_KEY,JSON.stringify({...project,viewport:{...project.viewport,center:fixture.request.center,zoom:fixture.request.zoom}}));
 fake=installFakeMapLibre({features:[...fixture.rendered.features,...fixture.rendered.labels],style:fixture.style,canvasSizePx:fixture.canvas[0]});
 terrainJobs=[];
 fetchMock=vi.fn(async(url:string)=>{throw new Error(`unexpected fetch ${url}`)});
 vi.stubGlobal('fetch',fetchMock);
});
afterEach(()=>{cleanup();fake.uninstall();vi.unstubAllGlobals()});

const countingTerrainRunner=():TerrainRunner=>{const inner=createInlineTerrainRunner();return {...inner,run(job,options){terrainJobs.push(job);return inner.run(job,options)}}};

describe('the street map in the topo page',()=>{
 it('builds a flat board from the captured map with no elevation downloads, and exports street groups',async()=>{
  render(<TopoPage terrainDeps={{createRunner:countingTerrainRunner}}/>);
  fireEvent.click(screen.getByRole('button',{name:'Street map'}));
  // The terrain controls give way to the street ones.
  expect(screen.queryByRole('group',{name:'Terrain layers'})).toBeNull();
  expect(screen.queryByRole('checkbox',{name:'Contours'})).toBeNull();
  expect(screen.getByRole('group',{name:'Street roads'})).toBeTruthy();
  expect(screen.getByRole('group',{name:'Street water'})).toBeTruthy();
  expect(screen.queryByRole('button',{name:'Generate terrain'})).toBeNull();

  fireEvent.click(screen.getByRole('button',{name:'Build street map'}));
  await waitFor(()=>expect(screen.getByTestId('board-roads')).toBeTruthy(),{timeout:HEAVY});
  expect(terrainJobs).toHaveLength(1);
  expect(terrainJobs[0].settings.flat).toBe(true);
  expect(terrainJobs[0].tiles).toEqual({});
  expect(terrainJobs[0].capturedWater?.length).toBe(fixture.expected.water);
  expect(fetchMock).not.toHaveBeenCalled();
  const details=screen.getByLabelText('Terrain details').textContent!;
  expect(details).toMatch(/Map features only, no elevation/);
  expect(details).not.toMatch(/Layer 1/);

  // A street option changes only the export: no second run.
  fireEvent.click(within(screen.getByRole('group',{name:'Street roads'})).getByRole('button',{name:'Cut out'}));
  expect(terrainJobs).toHaveLength(1);

  // Back to topographic in edit mode reruns the pipeline, and that run does download elevation.
  fireEvent.click(screen.getByRole('button',{name:'Topographic'}));
  await waitFor(()=>expect(fetchMock).toHaveBeenCalled(),{timeout:HEAVY});
  expect(String(fetchMock.mock.calls[0][0])).toMatch(/^\/api\/terrain\//);
 },HEAVY);
});
