import {createHash} from 'node:crypto';
import {beforeAll,describe,expect,it} from 'vitest';
import type {MultiPolygonMm,RingMm} from '../../src/geometry/shoreline/polygonEngine';
import {pointInRing} from '../../src/geometry/terrain/contourGeometry';
import {getLoadedFont} from '../../src/text/fontRegistry';
import type {TopoCapture} from '../../src/topo/capture/topoCapture';
import {createDefaultTopoProject} from '../../src/topo/defaults';
import {findBridgeSpans} from '../../src/topo/features/bridges';
import {boardProjection} from '../../src/topo/features/projection';
import {roadBridgeCandidates,topoRoadWidthMm} from '../../src/topo/features/roads';
import {TOPO_GROUP_ORDER,type TopoBoard,type TopoGroupId} from '../../src/topo/export/board';
import {exportTopo,topoFileNames,type TopoExportResult} from '../../src/topo/export/exportTopo';
import {TOPO_METADATA_NAMESPACE,type TopoExportMetadata} from '../../src/topo/export/metadata';
import {TOPO_PREFLIGHT_CHECKS,runTopoPreflight} from '../../src/topo/export/preflight';
import {ringSelfIntersects} from '../../src/ornament/export/preflight';
import {simpleForCutting} from '../../src/topo/features/water';
import {areaMm2} from '../../src/geometry/terrain/nestedBands';
import {freezeTerrainView,generateTerrain,type TerrainResult} from '../../src/topo/terrain/pipeline';
import type {TopoProject,TopoRoute} from '../../src/topo/types';
import {tilesForView} from '../helpers/terrarium';
import {loadFixtureTiles,loadTopoFixture,replayCapture} from '../helpers/topoFixtures';

// Phase 4: the laser-ready SVG. The golden is the real Golden Gate board (tests/fixtures/topo): real
// capture, real Terrarium tiles, bridges and all, exported through the same exportTopo the page
// calls, then read back as XML and checked the way an operator's software would read it.

const HEAVY=180_000;
const AT=new Date('2026-09-25T12:00:00Z');
const W=228.6,H=228.6;

let capture:TopoCapture,terrain:TerrainResult,project:TopoProject,golden:TopoExportResult;
beforeAll(async()=>{
 capture=(await replayCapture(loadTopoFixture('sf-coast'))).capture;
 const base=createDefaultTopoProject();
 project={...base,output:{widthMm:W,heightMm:H},terrain:{...base.terrain,layerCount:4},frame:{enabled:true,thicknessMm:6},title:{...base.title,text:'Golden Gate',dyMm:-120}};
 terrain=generateTerrain({view:capture.view,tiles:loadFixtureTiles('sf-coast'),water:[],capturedWater:capture.features.water,settings:{...project.terrain,smoothingRadius:3}});
 golden=exportTopo({project,terrain,capture,font:getLoadedFont,generatedAt:AT,appVersion:'test'});
},HEAVY);

const parse=(svg:string)=>{
 const doc=new DOMParser().parseFromString(svg,'image/svg+xml');
 expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
 return doc;
};
const groupsOf=(doc:Document)=>[...doc.documentElement.children].filter(e=>e.tagName==='g');
// Rings back out of emitted path data: M x y L x y … Z, as geometryPathMm writes them.
const ringsOf=(d:string):RingMm[]=>d.split('Z').map(part=>(part.match(/-?\d+(\.\d+)?/g)??[]).map(Number)).filter(v=>v.length>=6).map(v=>{const ring:RingMm=[];for(let i=0;i+1<v.length;i+=2)ring.push([v[i],v[i+1]]);return ring});
const insideEvenOdd=(x:number,y:number,rings:RingMm[])=>rings.filter(r=>pointInRing(x,y,r)).length%2===1;
const groupRings=(doc:Document,id:string)=>[...doc.getElementById(id)!.getElementsByTagName('path')].flatMap(p=>ringsOf(p.getAttribute('d')!));

describe('golden: the Golden Gate board',()=>{
 it('passes preflight and exports, with warnings it names and no errors',()=>{
  expect(golden.ok).toBe(true);
  expect(golden.preflight.blocked).toBe(false);
  expect(golden.preflight.checksRun).toEqual([...TOPO_PREFLIGHT_CHECKS]);
  expect(golden.preflight.findings.every(f=>f.severity==='warning')).toBe(true);
  expect(golden.preflight.findings.map(f=>f.code)).toContain('bridge-under-neck-minimum');
  expect(golden.fileNames).toEqual({svg:'topo-37_8228n-122_4756w-228.6x228.6mm.svg',project:'topo-37_8228n-122_4756w-228.6x228.6mm.json'});
 });

 it('is valid XML in real millimetres, with the plan\'s groups in the plan\'s order',()=>{
  const doc=parse(golden.svg!);
  const root=doc.documentElement;
  expect(root.getAttribute('width')).toBe('228.6mm');
  expect(root.getAttribute('height')).toBe('228.6mm');
  expect(root.getAttribute('viewBox')).toBe('0 0 228.6 228.6');
  expect(groupsOf(doc).map(g=>g.id)).toEqual([...TOPO_GROUP_ORDER]);
  for(const g of groupsOf(doc)){
   expect(g.getAttribute('data-operation')).toBe(g.id.split('/')[0]);
   expect(g.hasAttribute('transform')).toBe(false);
  }
  // Holes need even-odd; glyph counters need nonzero.
  for(const id of ['cut/frame','cut/terrain-1','cut/terrain-2','cut/water','cut/roads'])expect(doc.getElementById(id)!.getAttribute('fill-rule')).toBe('evenodd');
  expect(doc.getElementById('engrave/title')!.getAttribute('fill-rule')).toBe('nonzero');
  // What this board has, and what it does not.
  for(const id of ['cut/frame','cut/terrain-1','cut/terrain-2','cut/terrain-3','cut/terrain-4','cut/water','cut/roads','score/contours','engrave/title'])expect(doc.getElementById(id)!.getElementsByTagName('path').length).toBeGreaterThan(0);
  expect(doc.getElementById('engrave/compass')!.getAttribute('data-empty')).toBe('true');
  expect(doc.getElementById('engrave/compass')!.getAttribute('data-empty-reason')).toMatch(/compass is not built/);
  expect(doc.getElementById('score/route')!.getAttribute('data-empty-reason')).toMatch(/No route/);
 });

 it('closes every cut path, rounds every number to three decimals, and has no NaN or Infinity',()=>{
  const svg=golden.svg!,doc=parse(svg);
  expect(svg).not.toMatch(/NaN|Infinity/);
  for(const g of groupsOf(doc))for(const path of g.getElementsByTagName('path')){
   const d=path.getAttribute('d')!;
   expect(d).not.toMatch(/\d\.\d{4,}/);
   if(g.getAttribute('data-operation')==='cut'||g.getAttribute('data-kind')==='glyphs')
    for(const sub of d.split(/(?=M)/).filter(s=>s.trim()))expect(sub.trim()).toMatch(/Z$/);
   else expect(d).not.toMatch(/Z/); // score lines are open paths
  }
 });

 it('cuts the bridges as part of layer 1: connected material across the strait, not floating tabs',()=>{
  const doc=parse(golden.svg!);
  const land=groupRings(doc,'cut/terrain-1'),water=groupRings(doc,'cut/water');
  const spans=findBridgeSpans(roadBridgeCandidates(capture.features.roads,capture.view,'high',0,capture.tunnelRoadKeys).map(c=>({...c,widthMm:topoRoadWidthMm(c.tag!,capture.view,1)})),terrain.water,W,H).spans.filter(s=>s.tag==='motorway');
  expect(spans).toHaveLength(2);
  for(const span of spans)for(let k=1;k<20;k++){
   const t=k/20,i=Math.min(span.line.length-2,Math.floor(t*(span.line.length-1))),a=span.line[i],b=span.line[i+1],u=t*(span.line.length-1)-i;
   const [x,y]=[a[0]+(b[0]-a[0])*u,a[1]+(b[1]-a[1])*u];
   // Over the strait, the deck is layer-1 material and not a water opening.
   expect(insideEvenOdd(x,y,land)).toBe(true);
   expect(insideEvenOdd(x,y,water)).toBe(false);
  }
  // Layer 1 is one piece joining Marin to San Francisco — the bridges hold it together.
  const at=boardProjection(capture.view);
  const [hx,hy]=at(-122.499,37.8265),[px,py]=at(-122.466,37.799);
  const pieces=[...doc.getElementById('cut/terrain-1')!.getElementsByTagName('path')].map(p=>ringsOf(p.getAttribute('d')!));
  const pieceOf=(x:number,y:number)=>pieces.findIndex(rings=>insideEvenOdd(x,y,rings));
  expect(pieceOf(hx,hy)).toBeGreaterThanOrEqual(0);
  expect(pieceOf(hx,hy)).toBe(pieceOf(px,py));
  expect(golden.metadata.bridges.spans).toBe(5);
 });

 it('carries its provenance: version, time, viewport, both data sources with attribution, and the project',()=>{
  const doc=parse(golden.svg!);
  const meta=doc.getElementsByTagNameNS(TOPO_METADATA_NAMESPACE,'topo')[0];
  expect(meta).toBeTruthy();
  const text=(name:string)=>doc.getElementsByTagNameNS(TOPO_METADATA_NAMESPACE,name)[0]?.textContent;
  expect(text('app-version')).toBe('test');
  expect(text('generated-at')).toBe(AT.toISOString());
  const providers=[...doc.getElementsByTagNameNS(TOPO_METADATA_NAMESPACE,'provider')];
  expect(providers.map(p=>p.getAttribute('role'))).toEqual(['basemap','elevation']);
  expect(providers[0].textContent).toMatch(/OpenStreetMap contributors/);
  expect(providers[1].textContent).toMatch(/Terrain Tiles/);
  expect(providers[1].getAttribute('source')).toBe('https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png');
  expect(doc.getElementsByTagNameNS(TOPO_METADATA_NAMESPACE,'viewport')[0].getAttribute('zoom')).toBe('12');
  expect(doc.getElementsByTagNameNS(TOPO_METADATA_NAMESPACE,'layer')).toHaveLength(4);
  const settings=JSON.parse(text('project')!) as TopoProject;
  expect(settings.output).toEqual({widthMm:W,heightMm:H});
  expect(JSON.parse(golden.projectJson)).toEqual(project);
 });

 it('is deterministic: the same design exports byte for byte the same',()=>{
  const again=exportTopo({project,terrain,capture,font:getLoadedFont,generatedAt:AT,appVersion:'test'});
  expect(again.svg).toBe(golden.svg);
  expect(createHash('sha256').update(golden.svg!).digest('hex')).toBe(GOLDEN_SVG_SHA256);
 },HEAVY);
});

describe('more boards export',()=>{
 it('the Phase 2 mountain golden (synthetic tiles, no map capture): four layers, and says there was no capture',()=>{
  const view=freezeTerrainView([-89.7,44.9],13,480,120,90);
  const mountain=(u:number,v:number)=>250+900*Math.exp(-((u-.4)**2+(v-.45)**2)/.03)+500*Math.exp(-((u-.75)**2+(v-.7)**2)/.02)+60*u;
  const base=createDefaultTopoProject();
  const p={...base,output:{widthMm:120,heightMm:90},terrain:{...base.terrain,layerCount:4 as const}};
  const t=generateTerrain({view,tiles:tilesForView(view,mountain),water:[],settings:{...p.terrain,smoothingRadius:2,gridLongSide:160}});
  const r=exportTopo({project:p,terrain:t,font:getLoadedFont,generatedAt:AT});
  expect(r.ok).toBe(true);
  expect(r.preflight.findings.map(f=>f.code)).toContain('no-capture');
  const doc=parse(r.svg!);
  expect(doc.documentElement.getAttribute('width')).toBe('120mm');
  for(const k of [1,2,3,4])expect(doc.getElementById(`cut/terrain-${k}`)!.getElementsByTagName('path').length).toBeGreaterThan(0);
  expect(doc.getElementById('cut/water')!.getAttribute('data-empty')).toBe('true');
 },HEAVY);

 it('the real downtown San Francisco capture on synthetic terrain: roads, labels and all',async()=>{
  const city=(await replayCapture(loadTopoFixture('sf-city'))).capture;
  const base=createDefaultTopoProject();
  const p={...base,output:{widthMm:W,heightMm:H},labels:{...base.labels,poiEnabled:true}};
  const t=generateTerrain({view:city.view,tiles:tilesForView(city.view,(u,v)=>20+80*u+40*Math.sin(5*v)),water:[],capturedWater:city.features.water,settings:{...p.terrain,smoothingRadius:2,gridLongSide:200}});
  const r=exportTopo({project:p,terrain:t,capture:city,font:getLoadedFont,generatedAt:AT});
  expect(r.preflight.findings.filter(f=>f.severity==='error')).toEqual([]);
  const doc=parse(r.svg!);
  expect(doc.getElementById('cut/roads')!.getElementsByTagName('path').length).toBeGreaterThan(0);
  const labels=[...doc.getElementById('engrave/labels')!.getElementsByTagName('path')].map(p=>p.getAttribute('data-text'));
  expect(labels).toEqual(expect.arrayContaining(['San Francisco','Chinatown']));
 },HEAVY);
});

// ---- Preflight: every check, individually triggered, blocking ----

const clone=(board:TopoBoard):TopoBoard=>({...board,groups:board.groups.map(g=>({...g,geometry:g.geometry.map(p=>p.map(r=>r.map(([x,y])=>[x,y] as [number,number]))),lines:g.lines.map(s=>({...s,lines:s.lines.map(l=>l.map(([x,y])=>[x,y] as [number,number]))})),glyphs:g.glyphs.map(x=>({...x}))}))});
const tamper=(id:TopoGroupId,change:(g:TopoBoard['groups'][number])=>void,board=clone(golden.board))=>{change(board.groups.find(g=>g.id===id)!);return board};
const preflight=(board:TopoBoard,overrides:{project?:TopoProject;metadata?:TopoExportMetadata}={})=>runTopoPreflight({project:overrides.project??project,terrain,board,metadata:overrides.metadata??golden.metadata,captured:true});
const square=(x:number,y:number,s:number):MultiPolygonMm[number]=>[[[x,y],[x+s,y],[x+s,y+s],[x,y+s],[x,y]]];
const codes=(report:ReturnType<typeof preflight>)=>report.findings.filter(f=>f.severity==='error').map(f=>f.code);

describe('preflight: each check blocks on its own failure',()=>{
 it('the untouched board passes (the baseline for every case below)',()=>{
  expect(preflight(clone(golden.board)).blocked).toBe(false);
 });

 it('dimensions: a board resized since generation',()=>{
  const report=preflight(clone(golden.board),{project:{...project,output:{widthMm:W+5,heightMm:H}}});
  expect(report.blocked).toBe(true);
  expect(codes(report)).toContain('board-size-changed');
 });
 it('dimensions: land and water that do not tile the board',()=>{
  const board=tamper('cut/water',g=>{g.geometry=g.geometry.slice(1)});
  expect(codes(preflight(board))).toContain('board-not-covered');
 });
 it('dimensions: anything outside the board (a title dragged off the edge)',()=>{
  const off=exportTopo({project:{...project,title:{...project.title,dxMm:200}},terrain,capture,font:getLoadedFont,generatedAt:AT});
  expect(off.ok).toBe(false);
  expect(off.svg).toBeUndefined();
  expect(codes(off.preflight)).toContain('outside-board');
  expect(off.preflight.findings.find(f=>f.code==='outside-board')!.message).toMatch(/engrave\/title.*Move the title back onto the board/);
 },HEAVY);
 it('dimensions: no land at all',()=>{
  const board=tamper('cut/terrain-1',g=>{g.geometry=[]});
  expect(codes(preflight(board))).toContain('no-land');
 });

 it('open cut paths: a ring that does not close, and a glyph subpath without Z',()=>{
  const open=tamper('cut/terrain-2',g=>{g.geometry[0][0]=g.geometry[0][0].slice(0,-1)});
  expect(codes(preflight(open))).toContain('cut-ring-open');
  const glyph=tamper('engrave/title',g=>{g.glyphs[0]={...g.glyphs[0],d:g.glyphs[0].d.replace(/Z/g,'')}});
  expect(codes(preflight(glyph))).toContain('glyph-path-open');
 });

 it('self-intersections: a cut ring that crosses itself',()=>{
  const board=tamper('cut/terrain-3',g=>{g.geometry.push([[[100,100],[110,110],[110,100],[100,110],[100,100]]])});
  const report=preflight(board);
  expect(codes(report)).toContain('cut-ring-self-intersects');
  expect(report.findings.find(f=>f.code==='cut-ring-self-intersects')!.atMm).toBeDefined();
 });

 it('tiny islands: a piece of material under 0.25 mm² blocks; a tiny opening only warns',()=>{
  const piece=tamper('cut/terrain-4',g=>{g.geometry.push(square(10,10,.3))});
  expect(codes(preflight(piece))).toContain('piece-too-small');
  const opening=tamper('cut/roads',g=>{g.geometry.push(square(10,10,.3))});
  const report=preflight(opening);
  expect(report.findings.find(f=>f.code==='opening-tiny')?.severity).toBe('warning');
  expect(codes(report)).not.toContain('opening-tiny');
 });

 it('minimum width: a bridge narrower than the laser can cut blocks — measured on the cut geometry',()=>{
  // A 0.2 mm GPX route walked across the Golden Gate: its tab is under the 0.25 mm laser minimum.
  const at=boardProjection(capture.view);
  const route:TopoRoute={segments:[[[-122.466,37.799],[-122.4783,37.8199],[-122.499,37.8265]]],widthMm:.2,source:'track',pointCount:3};
  const thin=exportTopo({project:{...project,roads:{...project.roads,enabled:false},route},terrain,capture,font:getLoadedFont,generatedAt:AT});
  expect(thin.ok).toBe(false);
  expect(thin.svg).toBeUndefined();
  const finding=thin.preflight.findings.find(f=>f.code==='bridge-below-laser-minimum')!;
  expect(finding.severity).toBe('error');
  expect(finding.message).toMatch(/narrowest measures 0\.[12]\d mm/);
  expect(finding.message).toMatch(/Route width/);
  // The same route at 0.6 mm cuts, with the neck warning.
  const ok=exportTopo({project:{...project,roads:{...project.roads,enabled:false},route:{...route,widthMm:.6}},terrain,capture,font:getLoadedFont,generatedAt:AT});
  expect(ok.ok).toBe(true);
  expect(ok.preflight.findings.find(f=>f.code==='bridge-under-neck-minimum')?.severity).toBe('warning');
  expect(at(-122.4783,37.8199).every(Number.isFinite)).toBe(true);
 },HEAVY);
 it('minimum width: raising Road thickness to 3× clears the major spans past the neck minimum',()=>{
  const thick=exportTopo({project:{...project,roads:{...project.roads,thicknessScale:3}},terrain,capture,font:getLoadedFont,generatedAt:AT});
  expect(thick.ok).toBe(true);
  // At 1× all five spans measure under the 3 mm neck. At 3× the motorway decks are 4.05 mm and clear
  // it; only footpaths can remain — and one of those runs alongside the widened motorway deck, so the
  // material under it measures wider than its own tab. Measuring the cut geometry sees that.
  expect(golden.preflight.findings.find(f=>f.code==='bridge-under-neck-minimum')!.message).toMatch(/^5 bridges measure/);
  const message=thick.preflight.findings.find(f=>f.code==='bridge-under-neck-minimum')!.message;
  expect(message).toMatch(/^(1 bridge measures|[23] bridges measure) under/);
  // The footpaths left are the bridge's own sidewalks: their 1.17 mm tabs merge into the 4.05 mm
  // deck beside them, so the cut material under them is wider than their tab, yet still under 3 mm.
  const narrowest=Number(/narrowest ([0-9.]+) mm/.exec(message)![1]);
  expect(narrowest).toBeGreaterThan(1.17);
  expect(narrowest).toBeLessThan(3);
 },HEAVY);

 it('non-finite: NaN in geometry, and in glyph path data',()=>{
  const nan=tamper('cut/terrain-4',g=>{g.geometry[0][0][1]=[Number.NaN,5]});
  expect(codes(preflight(nan))).toContain('non-finite');
  const inf=tamper('engrave/title',g=>{g.glyphs[0]={...g.glyphs[0],d:`M0 0L${Number.POSITIVE_INFINITY} 3Z`}});
  expect(codes(preflight(inf))).toContain('non-finite');
 });

 it('attribution: missing sources, attribution, version or timestamp',()=>{
  const m=golden.metadata;
  for(const broken of [
   {...m,providers:m.providers.filter(p=>p.role!=='elevation')},
   {...m,providers:m.providers.map(p=>p.role==='basemap'?{...p,attribution:''}:p)},
   {...m,appVersion:''},
   {...m,generatedAt:'not a date'},
  ]){
   const report=preflight(clone(golden.board),{metadata:broken});
   expect(report.blocked).toBe(true);
   expect(codes(report)).toEqual(['metadata-missing']);
  }
 });

 it('a blocked export writes nothing: no SVG on the result at all',()=>{
  const blocked=exportTopo({project:{...project,output:{widthMm:300,heightMm:H}},terrain,capture,font:getLoadedFont,generatedAt:AT});
  expect(blocked.ok).toBe(false);
  expect(blocked.svg).toBeUndefined();
  expect(blocked.projectJson).toBeTruthy();
 },HEAVY);

 it('water pinched into a needle by the shared pipeline is made simple before it is cut',()=>{
  // The real ring export preflight caught on downtown San Francisco (a small pond, board at the
  // page's 480 px frame): it passes through (197.227, 163.592) twice, with a needle out and back.
  const pinched:RingMm=[[194.548,166.449],[195.858,165.14],[195.798,165.021],[197.227,163.592],[195.739,165.08],[194.727,164.068],[194.846,163.89],[195.262,164.306],[196.453,163.056],[196.096,162.699],[196.275,162.52],[197.287,163.532],[197.227,163.592],[197.287,163.711],[200.561,160.377],[199.906,161.627],[198.418,163.592],[196.394,165.378],[194.548,166.449]];
  expect(ringSelfIntersects(pinched)).toBeDefined();
  const simple=simpleForCutting([[pinched]]);
  expect(simple.length).toBeGreaterThan(0);
  for(const polygon of simple)for(const ring of polygon)expect(ringSelfIntersects(ring)).toBeUndefined();
  // The pond survives; only the needle is gone.
  expect(areaMm2(simple)).toBeGreaterThan(3);
 });

 it('deterministic file names from the place and board size',()=>{
  expect(topoFileNames({...project,viewport:{...project.viewport,selectedPlaceLabel:'Golden Gate Bridge, San Francisco'}},terrain).svg).toBe('topo-golden-gate-bridge-san-francisco-228.6x228.6mm.svg');
 });
});

// Pinned from the first run of the golden above; a change here is a change in the exported file.
const GOLDEN_SVG_SHA256='da137a7dbf34c6a3e7c42a9d026e98b09d43acb0638f132c218b937814203604';
