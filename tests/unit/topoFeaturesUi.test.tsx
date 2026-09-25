import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {createDefaultTopoProject} from '../../src/topo/defaults';
import {createInlineFeatureRunner,type FeatureRunner} from '../../src/topo/features/worker/featureRunner';
import type {FeatureJob} from '../../src/topo/features/worker/featureJob';
import {TOPO_STORAGE_KEY} from '../../src/topo/persistence';
import type {TerrainJob} from '../../src/topo/terrain/pipeline';
import {TERRARIUM_TILE_SIZE,latOfMercatorY,lngOfMercatorX} from '../../src/topo/terrain/tiles';
import {createInlineTerrainRunner,type TerrainRunner} from '../../src/topo/terrain/worker/terrainRunner';
import {TopoPage} from '../../src/topo/ui/TopoPage';
import App from '../../src/App';
import {installFakeMapLibre,type InstalledFakeMapLibre} from '../helpers/fakeMapLibre';
import {terrariumTile} from '../helpers/terrarium';
import {loadTopoFixture} from '../helpers/topoFixtures';

// The fast overlay-only redraw path, through the page. The map answers with the real downtown San
// Francisco capture; terrain tiles are synthetic. Every terrain worker run and every tile download is
// counted, then every overlay control is moved: the preview must change at once — synchronously,
// inside the event — and terrain must not run again.

const HEAVY=120_000;
const fixture=loadTopoFixture('sf-city');

let fake:InstalledFakeMapLibre,terrainJobs:TerrainJob[],featureJobs:FeatureJob[],fetchMock:ReturnType<typeof vi.fn>;
beforeEach(()=>{
 localStorage.clear();
 const project=createDefaultTopoProject();
 localStorage.setItem(TOPO_STORAGE_KEY,JSON.stringify({...project,viewport:{...project.viewport,center:fixture.request.center,zoom:fixture.request.zoom}}));
 fake=installFakeMapLibre({features:[...fixture.rendered.features,...fixture.rendered.labels],style:fixture.style,canvasSizePx:fixture.canvas[0]});
 terrainJobs=[];featureJobs=[];
 fetchMock=vi.fn(async(url:string)=>{
  const [z,x,y]=/^\/api\/terrain\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(url)!.slice(1).map(Number);
  const scale=TERRARIUM_TILE_SIZE*2**z;
  const bytes=terrariumTile((px,py)=>{const lng=lngOfMercatorX((x*TERRARIUM_TILE_SIZE+px+.5)/scale),lat=latOfMercatorY((y*TERRARIUM_TILE_SIZE+py+.5)/scale);return Math.round((40+60*Math.sin(lng*400)*Math.cos(lat*300))*256)/256});
  return {ok:true,status:200,arrayBuffer:async()=>bytes.slice().buffer};
 });
 vi.stubGlobal('fetch',fetchMock);
});
afterEach(()=>{cleanup();fake.uninstall();vi.unstubAllGlobals()});

const countingTerrainRunner=():TerrainRunner=>{const inner=createInlineTerrainRunner();return {...inner,run(job,options){terrainJobs.push(job);return inner.run(job,options)}}};
const countingFeatureRunner=():FeatureRunner=>{const inner=createInlineFeatureRunner();return {...inner,run(job){featureJobs.push(job);return inner.run(job)}}};

describe('the board overlay in edit mode',()=>{
 it('redraws roads, labels, frame and title without ever regenerating terrain',async()=>{
  render(<TopoPage terrainDeps={{createRunner:countingTerrainRunner}} featureRunner={countingFeatureRunner}/>);
  // The place search speaks of a map here, not the ornament it was borrowed from.
  expect(screen.getByText('Search for the place this map is of.')).toBeTruthy();
  expect(screen.queryByText(/this ornament is of/)).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Generate terrain'}));
  await waitFor(()=>expect(screen.getByTestId('board-roads')).toBeTruthy(),{timeout:HEAVY});
  expect(terrainJobs).toHaveLength(1);
  // The captured water went into the terrain job, where it is subtracted from every layer.
  expect(terrainJobs[0].capturedWater).toHaveLength(fixture.expected.water);
  expect(screen.getByLabelText('Terrain details').textContent).toMatch(/7,059 roads \(2,498 duplicates removed\)/);
  const downloads=fetchMock.mock.calls.length;
  await waitFor(()=>expect(featureJobs.some(j=>j.kind==='roads')).toBe(true),{timeout:HEAVY});

  // Each change below is asserted immediately after the event, with no waiting: the overlay path is
  // synchronous, so the preview has already changed when the handler returns.
  const roads=screen.getByRole('checkbox',{name:'Roads'});
  fireEvent.click(roads);
  expect(screen.queryByTestId('board-roads')).toBeNull();
  fireEvent.click(roads);
  expect(screen.getByTestId('board-roads')).toBeTruthy();

  const widthOf=(roadClass:string)=>Number(screen.getAllByTestId('board-road-class').find(e=>e.getAttribute('data-road-class')===roadClass)!.getAttribute('stroke-width'));
  const minorBefore=widthOf('minor');
  const thickness=screen.getByRole('slider',{name:'Road thickness'}) as HTMLInputElement;
  // The control's bounds are the clamp's: 0.5× to 3×, starting at 1× (the width table).
  expect([thickness.min,thickness.max,thickness.value]).toEqual(['0.5','3','1']);
  fireEvent.change(thickness,{target:{value:'2'}});
  expect(widthOf('minor')).toBeCloseTo(minorBefore*2,6);
  fireEvent.change(thickness,{target:{value:'3'}});
  expect(widthOf('minor')).toBeCloseTo(minorBefore*3,6);
  fireEvent.change(thickness,{target:{value:'2'}});

  expect(screen.getAllByTestId('board-label').length).toBeGreaterThan(0);
  // Points of interest are their own toggle, off by default: only place names are on the board.
  const poi=screen.getByRole('checkbox',{name:'Points of interest'}) as HTMLInputElement;
  expect(poi.checked).toBe(false);
  const names=()=>screen.getAllByTestId('board-label').map(e=>e.getAttribute('data-name'));
  expect(names()).toContain('Chinatown');
  expect(names().some(name=>/Street &/.test(name!))).toBe(false);
  fireEvent.click(poi);
  expect(names().some(name=>/Street &/.test(name!))).toBe(true);
  fireEvent.click(poi);
  expect(names().some(name=>/Street &/.test(name!))).toBe(false);
  fireEvent.click(screen.getByRole('checkbox',{name:'Place names'}));
  expect(screen.queryByTestId('board-labels')).toBeNull();
  fireEvent.click(screen.getByRole('checkbox',{name:'Place names'}));
  fireEvent.change(screen.getByRole('slider',{name:'Label size'}),{target:{value:'4'}});
  expect(screen.getByTestId('board-labels')).toBeTruthy();

  expect(screen.queryByTestId('board-frame')).toBeNull();
  fireEvent.click(screen.getByRole('checkbox',{name:'Frame'}));
  expect(screen.getByTestId('board-frame')).toBeTruthy();
  fireEvent.change(screen.getByRole('slider',{name:'Frame thickness'}),{target:{value:'10'}});

  expect(screen.queryByTestId('board-title')).toBeNull();
  fireEvent.change(screen.getByRole('textbox',{name:'Title'}),{target:{value:'Downtown'}});
  const title=screen.getByTestId('board-title').getAttribute('d')!;
  expect(title).toMatch(/^M[\d.]+ [\d.]+/);
  fireEvent.change(screen.getByRole('slider',{name:'Title size'}),{target:{value:'14'}});
  expect(screen.getByTestId('board-title').getAttribute('d')).not.toBe(title);

  fireEvent.click(screen.getByRole('button',{name:'Medium'}));
  expect(screen.getAllByTestId('board-road-class').map(e=>e.getAttribute('data-road-class')).sort()).toEqual(['minor','secondary','tertiary']);

  // None of that reran terrain or downloaded a tile.
  expect(terrainJobs).toHaveLength(1);
  expect(fetchMock.mock.calls.length).toBe(downloads);
  // The buffered road geometry is rebuilt in the feature worker for the new detail and thickness.
  await waitFor(()=>expect(featureJobs.filter(j=>j.kind==='roads').some(j=>j.kind==='roads'&&j.settings.detail==='medium'&&j.settings.thicknessScale===2)).toBe(true),{timeout:HEAVY});

  // A terrain setting is what reruns terrain.
  fireEvent.click(screen.getByRole('button',{name:'2 layers'}));
  await waitFor(()=>expect(screen.getByTestId('terrain-layer-2')).toBeTruthy(),{timeout:HEAVY});
  expect(terrainJobs).toHaveLength(2);
  expect(terrainJobs[1].capturedWater).toBe(terrainJobs[0].capturedWater);
  expect(fetchMock.mock.calls.length).toBe(downloads);
 },HEAVY);

 it('says loudly when there was no map to capture from, since the sea floor is then layered as land',async()=>{
  fake.uninstall();
  vi.stubGlobal('fetch',fetchMock);
  render(<TopoPage terrainDeps={{createRunner:countingTerrainRunner}} featureRunner={countingFeatureRunner}/>);
  fireEvent.click(screen.getByRole('button',{name:'Generate terrain'}));
  expect(await screen.findByText(/no water, roads or labels were captured\. Sea and lake beds will be layered as land/,{},{timeout:HEAVY})).toBeTruthy();
  await waitFor(()=>expect(terrainJobs).toHaveLength(1),{timeout:HEAVY});
  expect(terrainJobs[0].capturedWater).toBeUndefined();
  fake=installFakeMapLibre();
 },HEAVY);

 it('is reachable from the app, like the ornament: a nav button in, and back out',()=>{
  // The lake tool's own map needs more of MapLibre than the shared fake has; the app is rendered as
  // generateFailureUi.test.tsx renders it, with no map runtime.
  fake.uninstall();
  render(<App/>);
  fireEvent.click(screen.getByRole('button',{name:'Topo Map Builder →'}));
  expect(screen.getByRole('heading',{name:'Topographic Map Builder'})).toBeTruthy();
  expect(screen.getByRole('button',{name:'Generate terrain'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'← Back'}));
  expect(screen.queryByRole('heading',{name:'Topographic Map Builder'})).toBeNull();
  expect(screen.getByRole('button',{name:'Map Mode'})).toBeTruthy();
  fake=installFakeMapLibre();
 });
});
