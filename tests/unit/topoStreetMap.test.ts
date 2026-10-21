import {beforeAll,describe,expect,it} from 'vitest';
import type {RingMm} from '../../src/geometry/shoreline/polygonEngine';
import {pointInRing} from '../../src/geometry/terrain/contourGeometry';
import {areaMm2} from '../../src/geometry/terrain/nestedBands';
import {pieceMetrics} from '../../src/production/job';
import {topoBoardToJob} from '../../src/production/adapters/topoBoard';
import {getLoadedFont} from '../../src/text/fontRegistry';
import type {TopoCapture} from '../../src/topo/capture/topoCapture';
import {createDefaultTopoProject} from '../../src/topo/defaults';
import {findBridgeSpans} from '../../src/topo/features/bridges';
import {boardProjection} from '../../src/topo/features/projection';
import {roadBridgeCandidates,topoRoadWidthMm} from '../../src/topo/features/roads';
import {STREET_GROUP_ORDER} from '../../src/topo/export/board';
import {exportTopo,type TopoExportResult} from '../../src/topo/export/exportTopo';
import {TOPO_METADATA_NAMESPACE} from '../../src/topo/export/metadata';
import {runTopoPreflight} from '../../src/topo/export/preflight';
import {loadTopoProject,saveTopoProject} from '../../src/topo/persistence';
import {terrainRunKey} from '../../src/topo/regeneration';
import {topoReducer} from '../../src/topo/store';
import {generateTerrain,type TerrainResult} from '../../src/topo/terrain/pipeline';
import type {TopoProject} from '../../src/topo/types';
import {clampTopoProject} from '../../src/topo/validation';
import {loadTopoFixture,replayCapture} from '../helpers/topoFixtures';

// The Street Map mode: the topo builder's flat board. The same real Golden Gate capture the topo
// export golden uses (tests/fixtures/topo/sf-coast), built with no elevation at all — no tiles are
// handed to the pipeline — and exported in each of its road and water settings.

const HEAVY=180_000;
const AT=new Date('2026-10-21T12:00:00Z');
const W=228.6,H=228.6;

let capture:TopoCapture,terrain:TerrainResult,base:TopoProject;
const built:Partial<Record<string,TopoExportResult>>={};
const streetProject=(street:TopoProject['street']):TopoProject=>({...base,style:'street',street,output:{widthMm:W,heightMm:H},title:{...base.title,text:'Golden Gate',dyMm:-120}});
const exported=(street:TopoProject['street'])=>{
 const key=JSON.stringify(street);
 return built[key]??=exportTopo({project:streetProject(street),terrain,capture,font:getLoadedFont,generatedAt:AT,appVersion:'test'});
};

beforeAll(async()=>{
 capture=(await replayCapture(loadTopoFixture('sf-coast'))).capture;
 base=createDefaultTopoProject();
 // tiles:{} — a street map is never given elevation, and must not need it.
 terrain=generateTerrain({view:capture.view,tiles:{},water:[],capturedWater:capture.features.water,settings:{...base.terrain,smoothingRadius:3,flat:true}});
},HEAVY);

const parse=(svg:string)=>{
 const doc=new DOMParser().parseFromString(svg,'image/svg+xml');
 expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
 return doc;
};
const ringsOf=(d:string):RingMm[]=>d.split('Z').map(part=>(part.match(/-?\d+(\.\d+)?/g)??[]).map(Number)).filter(v=>v.length>=6).map(v=>{const ring:RingMm=[];for(let i=0;i+1<v.length;i+=2)ring.push([v[i],v[i+1]]);return ring});
const insideEvenOdd=(x:number,y:number,rings:RingMm[])=>rings.filter(r=>pointInRing(x,y,r)).length%2===1;
const paths=(doc:Document,id:string)=>[...doc.getElementById(id)!.getElementsByTagName('path')];
const groupRings=(doc:Document,id:string)=>paths(doc,id).flatMap(p=>ringsOf(p.getAttribute('d')!));
// Points along the Golden Gate's motorway crossings, in board millimetres.
const bridgePoints=()=>{
 const spans=findBridgeSpans(roadBridgeCandidates(capture.features.roads,capture.view,'high',0,capture.tunnelRoadKeys).map(c=>({...c,widthMm:topoRoadWidthMm(c.tag!,capture.view,1)})),terrain.water,W,H).spans.filter(s=>s.tag==='motorway');
 expect(spans.length).toBeGreaterThan(0);
 return spans.flatMap(span=>[.3,.5,.7].map(t=>{
  const i=Math.min(span.line.length-2,Math.floor(t*(span.line.length-1))),a=span.line[i],b=span.line[i+1],u=t*(span.line.length-1)-i;
  return [a[0]+(b[0]-a[0])*u,a[1]+(b[1]-a[1])*u] as [number,number];
 }));
};

describe('the flat board',()=>{
 it('is the board minus the water as one layer, with no elevation, contours or tiles',()=>{
  expect(terrain.layers).toHaveLength(1);
  expect(terrain.contours).toEqual([]);
  expect(terrain.grid.tileCount).toBe(0);
  expect(terrain.elevation.landSamples).toBe(0);
  expect(terrain.warnings).toEqual([]);
  expect(terrain.water.length).toBeGreaterThan(0);
  // Land and water tile the board.
  expect(areaMm2(terrain.layers[0].geometry)+areaMm2(terrain.water)).toBeCloseTo(W*H,0);
 });
});

describe('street map export, roads and water engraved (the defaults)',()=>{
 it('passes preflight and is named as a street map',()=>{
  const result=exported({roads:'engrave',water:'engrave'});
  expect(result.ok).toBe(true);
  expect(result.preflight.findings.filter(f=>f.severity==='error')).toEqual([]);
  expect(result.fileNames.svg).toMatch(/^street-.*-228\.6x228\.6mm\.svg$/);
 });

 it('has the street groups in order: a rectangular base, filled road and water engraving, no cut/water',()=>{
  const doc=parse(exported({roads:'engrave',water:'engrave'}).svg!);
  const groups=[...doc.documentElement.children].filter(e=>e.tagName==='g');
  expect(groups.map(g=>g.id)).toEqual([...STREET_GROUP_ORDER]);
  expect(doc.getElementById('cut/water')).toBeNull();
  for(const g of groups){
   expect(g.getAttribute('data-operation')).toBe(g.id.split('/')[0]);
   expect(g.hasAttribute('transform')).toBe(false);
  }
  // The base is the board itself: one closed rectangle, the full area, since water is not cut.
  const baseRings=groupRings(doc,'cut/base');
  expect(baseRings).toHaveLength(1);
  expect(areaMm2([[baseRings[0]]])).toBeCloseTo(W*H,1);
  expect(doc.getElementById('cut/base')!.getAttribute('stroke')).toBe('#FF0000');
  // Roads: black fill, no stroke. Water: grey fill, no stroke — not blue, which is the score colour.
  const roads=doc.getElementById('engrave/roads')!,water=doc.getElementById('engrave-light/water')!;
  expect([roads.getAttribute('fill'),roads.getAttribute('stroke'),roads.getAttribute('fill-rule')]).toEqual(['#000000','none','evenodd']);
  expect([water.getAttribute('fill'),water.getAttribute('stroke'),water.getAttribute('fill-rule')]).toEqual(['#777777','none','evenodd']);
  expect(paths(doc,'engrave/roads').length).toBeGreaterThan(0);
  expect(paths(doc,'engrave-light/water').length).toBeGreaterThan(0);
  expect(doc.getElementById('cut/roads')!.getAttribute('data-empty-reason')).toMatch(/engraved/);
  expect(paths(doc,'engrave/title').length).toBe(1);
 });

 it('engraves the bridges across the water, and never burns the same area twice',()=>{
  const doc=parse(exported({roads:'engrave',water:'engrave'}).svg!);
  const roads=groupRings(doc,'engrave/roads'),water=groupRings(doc,'engrave-light/water');
  for(const [x,y] of bridgePoints()){
   expect(insideEvenOdd(x,y,roads)).toBe(true);
   expect(insideEvenOdd(x,y,water)).toBe(false);
  }
 });

 it('names only the map as its source: no elevation provider, no terrain block, nothing non-finite',()=>{
  const result=exported({roads:'engrave',water:'engrave'}),doc=parse(result.svg!);
  expect(result.svg).not.toMatch(/NaN|Infinity/);
  expect(doc.getElementsByTagName('title')[0].textContent).toMatch(/^Street map · /);
  const providers=[...doc.getElementsByTagNameNS(TOPO_METADATA_NAMESPACE,'provider')];
  expect(providers.map(p=>p.getAttribute('role'))).toEqual(['basemap']);
  expect(doc.getElementsByTagNameNS(TOPO_METADATA_NAMESPACE,'terrain')).toHaveLength(0);
  expect(doc.getElementsByTagNameNS(TOPO_METADATA_NAMESPACE,'board')[0].getAttribute('style')).toBe('street');
 });

 it('costs the roads and water as engraving on one base layer, not as cut length',()=>{
  const job=topoBoardToJob(exported({roads:'engrave',water:'engrave'}).board);
  expect(job.pieces.map(p=>p.id)).toEqual(['terrain-1']);
  const metrics=pieceMetrics(job.pieces[0]);
  // The only cut is the board's own outline.
  expect(metrics.cutLengthMm).toBeCloseTo(2*(W+H),0);
  expect(metrics.engraveAreaMm2).toBeGreaterThan(100);
 });
});

describe('street map export, other settings',()=>{
 it('water cut out: holes in the base, bridges kept as tabs that join the base across the strait',()=>{
  const result=exported({roads:'engrave',water:'cutout'});
  expect(result.ok).toBe(true);
  const doc=parse(result.svg!);
  expect(doc.getElementById('engrave-light/water')!.getAttribute('data-empty-reason')).toMatch(/holes in cut\/base/);
  expect(result.board.bridgeTabs.length).toBeGreaterThan(0);
  expect(result.metadata.bridges.spans).toBeGreaterThan(0);
  // One piece from Marin to San Francisco, as on the topo board.
  const at=boardProjection(capture.view);
  const [hx,hy]=at(-122.499,37.8265),[px,py]=at(-122.466,37.799);
  const pieces=paths(doc,'cut/base').map(p=>ringsOf(p.getAttribute('d')!));
  const pieceOf=(x:number,y:number)=>pieces.findIndex(rings=>insideEvenOdd(x,y,rings));
  expect(pieceOf(hx,hy)).toBeGreaterThanOrEqual(0);
  expect(pieceOf(hx,hy)).toBe(pieceOf(px,py));
  // The base and its water openings still tile the board.
  expect(result.preflight.findings.map(f=>f.code)).not.toContain('board-not-covered');
 });

 it('roads cut out: openings in cut/roads, nothing in engrave/roads',()=>{
  const result=exported({roads:'cut',water:'engrave'});
  expect(result.ok).toBe(true);
  const doc=parse(result.svg!);
  expect(paths(doc,'cut/roads').length).toBeGreaterThan(0);
  expect(doc.getElementById('engrave/roads')!.getAttribute('data-empty')).toBe('true');
  expect(doc.getElementById('engrave/roads')!.getAttribute('data-empty-reason')).toMatch(/cut out/);
 });

 it('water left off: neither water group has anything, and the base stays a rectangle',()=>{
  const result=exported({roads:'engrave',water:'none'});
  expect(result.ok).toBe(true);
  const doc=parse(result.svg!);
  expect(doc.getElementById('engrave-light/water')!.getAttribute('data-empty-reason')).toMatch(/left off/);
  expect(groupRings(doc,'cut/base')).toHaveLength(1);
 });

 it('refuses a street map whose metadata claims an elevation source',()=>{
  const result=exported({roads:'engrave',water:'engrave'});
  const project=streetProject({roads:'engrave',water:'engrave'});
  const claimed={...result.metadata,providers:[...result.metadata.providers,{id:'aws-terrain-tiles',role:'elevation' as const,title:'x',attribution:'Terrain Tiles',source:'x',retrievedAt:'x',quality:'x'}]};
  const report=runTopoPreflight({project,terrain,board:result.board,metadata:claimed,captured:true});
  expect(report.blocked).toBe(true);
  expect(report.findings.map(f=>f.code)).toContain('elevation-not-used');
 });
});

describe('the street settings in the project',()=>{
 it('the style regenerates; the street options do not',()=>{
  const project=createDefaultTopoProject(),key=terrainRunKey(project,3);
  const street=topoReducer(project,{type:'setStyle',value:'street'});
  expect(terrainRunKey(street,3)).not.toBe(key);
  expect(JSON.parse(terrainRunKey(street,3)).flat).toBe(true);
  for(const patch of [{roads:'cut'},{water:'cutout'},{water:'none'}] as Partial<TopoProject['street']>[])
   expect(terrainRunKey(topoReducer(street,{type:'setStreet',patch}),3)).toBe(terrainRunKey(street,3));
  // A topographic project's key is what it was before the mode existed.
  expect(JSON.parse(key)).not.toHaveProperty('flat');
 });

 it('clamps bad values and loads a record saved before the mode existed as topographic',()=>{
  const bad=clampTopoProject({...createDefaultTopoProject(),style:'nope' as never,street:{roads:'laser' as never,water:7 as never}});
  expect(bad.style).toBe('topo');
  expect(bad.street).toEqual({roads:'engrave',water:'engrave'});
  const store=new Map<string,string>();
  const storage={getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>void store.set(k,v),removeItem:(k:string)=>void store.delete(k)};
  const {style:_style,street:_street,...old}=createDefaultTopoProject();
  storage.setItem('layered-map-studio.topo.v1',JSON.stringify(old));
  expect(loadTopoProject(storage)?.style).toBe('topo');
  saveTopoProject({...createDefaultTopoProject(),style:'street',street:{roads:'cut',water:'none'}},storage);
  expect(loadTopoProject(storage)).toMatchObject({style:'street',street:{roads:'cut',water:'none'}});
 });
});
