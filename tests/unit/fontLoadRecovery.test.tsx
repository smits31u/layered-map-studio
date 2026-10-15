import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import App from '../../src/App';
import {FontLoadNotice} from '../../src/components/ui/FontLoadNotice';
import {FONT_LOAD_TIMEOUT_MS,failedFonts,fontStatus,forgetFontForTesting,getFontLoadError,getLoadedFont,loadFont,registerFontForTesting,retryFont,setFontLoadErrorForTesting} from '../../src/text/fontRegistry';
import type {FontId} from '../../src/types/project';
import {createDefaultTopoProject} from '../../src/topo/defaults';
import {exportTopo} from '../../src/topo/export/exportTopo';
import {generateTerrain,type TerrainResult} from '../../src/topo/terrain/pipeline';
import type {TopoCapture} from '../../src/topo/capture/topoCapture';
import {loadFixtureTiles,loadTopoFixture,replayCapture} from '../helpers/topoFixtures';
import {installFakeMapLibre} from '../helpers/fakeMapLibre';
import type {CaptureMapFeature} from '../../src/ornament/capture/mapCapture';
import {defaultProject} from '../../src/state/defaultProject';

// A font that fails — an HTTP error, a corrupt file, or a fetch that never settles — must surface
// as an error that names the font, offer a Retry, and stop every export that needs the font. Before
// this, a stalled fetch read as "still loading" forever, and the lake tool could export the last
// good scene after a live edit had failed for want of a font.

const fontBytes=(file:string)=>{const b=readFileSync(resolve(__dirname,'..','..','public','fonts',file));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};
// Evicts a pre-registered font (tests/setup.ts loads them all) and restores it afterwards.
const withoutFont=async(id:FontId,body:()=>Promise<void>|void)=>{const saved=forgetFontForTesting(id);try{await body()}finally{setFontLoadErrorForTesting(id,undefined);if(saved)registerFontForTesting(id,saved)}};
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();cleanup()});

describe('font registry: timeout, failure, retry',()=>{
 it('gives up on a fetch that never settles after the timeout, names the font, and aborts the request',async()=>{
  await withoutFont('great-vibes',async()=>{
   vi.useFakeTimers();
   let signal:AbortSignal|undefined;
   vi.stubGlobal('fetch',vi.fn((_url:string,init?:RequestInit)=>{signal=init?.signal??undefined;return new Promise(()=>{})}));
   const attempt=loadFont('great-vibes');
   expect(fontStatus('great-vibes')).toBe('loading');
   const outcome=attempt.then(()=>new Error("loaded"),(error:Error)=>error);
   await vi.advanceTimersByTimeAsync(FONT_LOAD_TIMEOUT_MS);
   const error=await outcome;
   expect(error.message).toBe(`Font "Great Vibes" failed to load: did not finish loading within ${FONT_LOAD_TIMEOUT_MS/1000} seconds`);
   expect(signal?.aborted).toBe(true);
   expect(fontStatus('great-vibes')).toBe('failed');
   expect(failedFonts().map(f=>f.id)).toEqual(['great-vibes']);
  });
 });

 it('records an HTTP failure with the font name and the status',async()=>{
  await withoutFont('great-vibes',async()=>{
   vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,status:404}));
   await expect(loadFont('great-vibes')).rejects.toThrow('Font "Great Vibes" failed to load: HTTP 404');
   expect(getFontLoadError('great-vibes')?.message).toContain('HTTP 404');
  });
 });

 it('a successful retry clears the failure and makes the font ready',async()=>{
  await withoutFont('great-vibes',async()=>{
   vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce({ok:false,status:503}).mockResolvedValueOnce({ok:true,arrayBuffer:async()=>fontBytes('GreatVibes-Regular.ttf')}));
   await expect(loadFont('great-vibes')).rejects.toThrow('HTTP 503');
   expect(await retryFont('great-vibes')).toBe(true);
   expect(fontStatus('great-vibes')).toBe('ready');
   expect(getFontLoadError('great-vibes')).toBeUndefined();
   expect(getLoadedFont('great-vibes')).toBeTruthy();
  });
 });
});

describe('FontLoadNotice',()=>{
 it('names the failed font and the reason, and its Retry loads the font and clears the notice',async()=>{
  await withoutFont('cinzel',async()=>{
   vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce({ok:false,status:404}).mockResolvedValueOnce({ok:true,arrayBuffer:async()=>fontBytes('Cinzel-Regular.ttf')}));
   render(<FontLoadNotice/>);
   expect(screen.queryByRole('alert')).toBeNull();
   await act(()=>loadFont('cinzel').catch(()=>{}));
   expect(screen.getByRole('alert').textContent).toContain('Font "Cinzel" failed to load: HTTP 404');
   fireEvent.click(screen.getByRole('button',{name:'Retry Cinzel'}));
   await waitFor(()=>expect(screen.queryByRole('alert')).toBeNull());
   expect(fontStatus('cinzel')).toBe('ready');
  });
 });
});

describe('export refuses when a font the design needs never loaded',()=>{
 const {longitude:lng,latitude:lat}=defaultProject.map;
 const lake={source:'openmaptiles',sourceLayer:'water',geometry:{type:'Polygon',coordinates:[[[lng-.02,lat-.02],[lng+.02,lat-.02],[lng+.02,lat+.02],[lng-.02,lat+.02],[lng-.02,lat-.02]]]},properties:{class:'lake'}};

 it('lake tool: a title typed while its font is missing blocks Export instead of exporting the last good scene',async()=>{
  const fake=installFakeMapLibre({features:[lake] as unknown as CaptureMapFeature[]});
  const rect=vi.spyOn(Element.prototype,'getBoundingClientRect').mockImplementation(function(this:Element){const r=this.classList.contains('crop-frame')?{left:60,top:90,right:340,bottom:310}:{left:0,top:0,right:400,bottom:400};return {...r,x:r.left,y:r.top,width:r.right-r.left,height:r.bottom-r.top,toJSON(){}} as DOMRect});
  const created=vi.fn(()=>'blob:test');
  Object.assign(URL,{createObjectURL:created,revokeObjectURL:()=>{}});
  try{
   await withoutFont('cinzel',async()=>{
    render(<App/>);
    const settle=async()=>{for(let i=0;i<8;i++)await act(()=>new Promise(r=>setTimeout(r,20)))};
    await settle();
    // The design builds and exports while it has no title.
    fireEvent.click(screen.getByText('Generate scene'));
    await settle();
    expect(screen.getByText('Done')).toBeTruthy();
    setFontLoadErrorForTesting('cinzel',new Error('Font "Cinzel" failed to load: HTTP 404'));
    await settle();
    for(const section of document.querySelectorAll('details'))section.setAttribute('open','');
    fireEvent.change(screen.getByLabelText('Title text'),{target:{value:'HAMILTON LAKE'}});
    await settle();
    fireEvent.click(screen.getByText('Export SVG'));
    expect(created).not.toHaveBeenCalled();
    expect(screen.getByText('Export failed')).toBeTruthy();
    expect(screen.getAllByRole('alert').some(n=>/SVG export failed: .*Cinzel.*failed to load: HTTP 404/.test(n.textContent??''))).toBe(true);
    expect(screen.getByRole('button',{name:'Retry Cinzel'})).toBeTruthy();
   });
  }finally{rect.mockRestore();fake.uninstall()}
 });

 describe('topo',()=>{
  let capture:TopoCapture,terrain:TerrainResult;
  beforeAll(async()=>{
   capture=(await replayCapture(loadTopoFixture('sf-coast'))).capture;
   const base=createDefaultTopoProject();
   terrain=generateTerrain({view:capture.view,tiles:loadFixtureTiles('sf-coast'),water:[],capturedWater:capture.features.water,settings:{...base.terrain,layerCount:2,smoothingRadius:3}});
  },180_000);
  it('a title whose font never loaded blocks the board export instead of warning',()=>{
   const base=createDefaultTopoProject(),project={...base,output:{widthMm:228.6,heightMm:228.6},terrain:{...base.terrain,layerCount:2 as const},title:{...base.title,text:'Golden Gate',fontId:'cinzel' as FontId}};
   setFontLoadErrorForTesting('cinzel',new Error('Font "Cinzel" failed to load: HTTP 404'));
   try{
    const result=exportTopo({project,terrain,capture,font:id=>id==='cinzel'?undefined:getLoadedFont(id),generatedAt:new Date('2026-10-10T00:00:00Z'),appVersion:'test'});
    expect(result.preflight.blocked).toBe(true);
    const finding=result.preflight.findings.find(f=>f.code==='font-load-failed');
    expect(finding?.severity).toBe('error');
    expect(finding?.message).toContain('HTTP 404');
   }finally{setFontLoadErrorForTesting('cinzel',undefined)}
  },60_000);
 });
});
