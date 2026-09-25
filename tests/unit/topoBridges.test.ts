import {beforeAll,describe,expect,it} from 'vitest';
import type {MultiPolygonMm} from '../../src/geometry/shoreline/polygonEngine';
import {pointInRing} from '../../src/geometry/terrain/contourGeometry';
import {areaMm2} from '../../src/geometry/terrain/nestedBands';
import type {CapturedRoad} from '../../src/ornament/capture/featureTypes';
import type {PolylineMm} from '../../src/ornament/geometry/clipLine';
import {unionAll} from '../../src/ornament/geometry/polygonRepair';
import {getLoadedFont} from '../../src/text/fontRegistry';
import {roadKey,type TopoCapture} from '../../src/topo/capture/topoCapture';
import {createDefaultTopoProject} from '../../src/topo/defaults';
import {MIN_BRIDGE_TAB_WIDTH_MM,bridgeTabs,findBridgeSpans,type BridgeCandidate} from '../../src/topo/features/bridges';
import {buildOverlay} from '../../src/topo/features/overlay';
import {boardProjection} from '../../src/topo/features/projection';
import {buildTopoRoads,roadBridgeCandidates,topoRoadWidthMm} from '../../src/topo/features/roads';
import {buildRouteGeometry,projectRouteLines} from '../../src/topo/features/route';
import {generateTerrain} from '../../src/topo/terrain/pipeline';
import type {TopoRoute} from '../../src/topo/types';
import {loadFixtureTiles,loadTopoFixture,replayCapture} from '../helpers/topoFixtures';

// Bridges across water cut-outs, on the real Golden Gate fixture (tests/fixtures/topo/README.md).
//
// Water is cut out of every terrain layer. Without a tab the Golden Gate Bridge — the defining
// feature of this board — vanished between its shores. A genuine crossing (land on both sides) now
// keeps a tab of material as wide as the road; a road that only runs out over the water (a pier, a
// boat launch) does not, and neither does a tunnel.

const HEAVY=120_000;
const W=228.6,H=228.6;
let capture:TopoCapture,land:MultiPolygonMm,water:MultiPolygonMm,at:(lng:number,lat:number)=>[number,number];

const inside=([x,y]:[number,number],g:MultiPolygonMm)=>g.some(p=>pointInRing(x,y,p[0])&&!p.slice(1).some(h=>pointInRing(x,y,h)));
const componentOf=(point:[number,number],g:MultiPolygonMm)=>g.findIndex(p=>pointInRing(point[0],point[1],p[0])&&!p.slice(1).some(h=>pointInRing(point[0],point[1],h)));
// Points every `stepMm` along a polyline.
const samples=(line:PolylineMm,stepMm:number)=>{
 const out:[number,number][]=[];
 for(let i=0;i+1<line.length;i++){
  const [ax,ay]=line[i],[bx,by]=line[i+1],n=Math.max(1,Math.ceil(Math.hypot(bx-ax,by-ay)/stepMm));
  for(let k=0;k<n;k++)out.push([ax+(bx-ax)*k/n,ay+(by-ay)*k/n]);
 }
 out.push(line[line.length-1]);
 return out;
};
// Places, by their real coordinates.
const GG_MIDSPAN=[-122.4783,37.8199] as const;  // the Golden Gate Bridge, mid-channel
const HAWK_HILL=[-122.4990,37.8265] as const;   // Marin Headlands, north shore
const PRESIDIO=[-122.4660,37.7990] as const;    // San Francisco, south shore
const BAY=[-122.4560,37.8290] as const;         // open water east of the bridge

beforeAll(async()=>{
 capture=(await replayCapture(loadTopoFixture('sf-coast'))).capture;
 const terrain=generateTerrain({view:capture.view,tiles:loadFixtureTiles('sf-coast'),water:[],capturedWater:capture.features.water,settings:{layerCount:1,coveragePercent:[100,50,25,12],contoursEnabled:false,contourCount:8,smoothingRadius:3,gridLongSide:300}});
 land=terrain.layers[0].geometry;water=terrain.water;
 const project=boardProjection(capture.view);
 at=(lng,lat)=>project(lng,lat);
},HEAVY);

const candidates=(detail:'low'|'medium'|'high'='high')=>roadBridgeCandidates(capture.features.roads,capture.view,detail,0,capture.tunnelRoadKeys).map(c=>({...c,widthMm:topoRoadWidthMm(c.tag!,capture.view,1)}));

describe('the Golden Gate Bridge',()=>{
 it('is found as a genuine crossing: both motorway carriageways, land to land across the strait',()=>{
  const {spans,deadEnds}=findBridgeSpans(candidates(),water,W,H);
  const motorway=spans.filter(s=>s.tag==='motorway');
  expect(motorway).toHaveLength(2);
  const mid=at(...GG_MIDSPAN);
  for(const span of motorway){
   // About 1.7 km of water at this scale: 61 mm on the board.
   expect(span.lengthMm).toBeGreaterThan(55);
   expect(span.lengthMm).toBeLessThan(70);
   // The tab is the road's own physical width from the mm table, not a constant.
   expect(span.widthMm).toBeCloseTo(topoRoadWidthMm('motorway',capture.view,1),9);
   expect(span.widthMm).toBeCloseTo(1.35,9);
   // It passes mid-channel.
   expect(Math.min(...samples(span.line,.5).map(([x,y])=>Math.hypot(x-mid[0],y-mid[1])))).toBeLessThan(3);
   // Each end is at a shore; everything between is over water.
   for(const point of samples(span.line,1).slice(2,-2))expect(inside(point,water)).toBe(true);
  }
  // The bridge's footpaths cross too, at the path width; nothing here dead-ends in the water.
  expect(spans.filter(s=>s.tag==='path').every(s=>s.widthMm===topoRoadWidthMm('path',capture.view,1))).toBe(true);
  expect(deadEnds).toBe(0);
 });

 it('keeps a connected roadway across the strait instead of a gap',()=>{
  const withBridges=buildTopoRoads(capture.features.roads,capture.view,{detail:'high',thicknessScale:1},land,{water,tunnelRoadKeys:capture.tunnelRoadKeys});
  const without=buildTopoRoads(capture.features.roads,capture.view,{detail:'high',thicknessScale:1},land);
  const mid=at(...GG_MIDSPAN);
  const motorway=findBridgeSpans(candidates(),water,W,H).spans.filter(s=>s.tag==='motorway');
  // Every half millimetre along both carriageways, shore to shore, is engraved road now; before, the
  // middle of the bridge was not.
  for(const span of motorway)for(const point of samples(span.line,.5))expect(inside(point,withBridges.geometry)).toBe(true);
  expect(motorway.some(span=>samples(span.line,.5).some(point=>!inside(point,without.geometry)))).toBe(true);
  // The mid-channel point of each carriageway: road now, nothing before.
  for(const span of motorway){const along=samples(span.line,.5),middle=along[Math.floor(along.length/2)];expect(inside(middle,withBridges.geometry)).toBe(true);expect(inside(middle,without.geometry)).toBe(false)}
  expect(withBridges.bridges.spans).toBeGreaterThanOrEqual(2);
  expect(withBridges.bridgeTabs.length).toBeGreaterThan(0);
  // Material, not just engraving: layer 1 plus the tabs joins the Marin Headlands to San Francisco.
  // Without the tabs they are separate pieces of the land layer.
  const north=at(...HAWK_HILL),south=at(...PRESIDIO);
  expect(componentOf(north,land)).not.toBe(componentOf(south,land));
  const deck=unionAll([land,withBridges.bridgeTabs],'test');
  expect(componentOf(north,deck)).toBeGreaterThanOrEqual(0);
  expect(componentOf(north,deck)).toBe(componentOf(south,deck));
  expect(inside(mid,deck)||motorway.some(s=>samples(s.line,.5).some(p=>Math.hypot(p[0]-mid[0],p[1]-mid[1])<1&&inside(p,deck)))).toBe(true);
  // The tabs sit over the strait, not over land that was already there.
  expect(areaMm2(withBridges.bridgeTabs)).toBeGreaterThan(50);
  // And no longer reported as roads left over water.
  expect(withBridges.warnings.map(w=>w.code)).not.toContain('roads-over-water');
 },HEAVY);

 it('builds each tab at its road\'s width, and says the thinnest are under the ornament\'s minimum neck',()=>{
  const motorway=findBridgeSpans(candidates(),water,W,H).spans.find(s=>s.tag==='motorway')!;
  const tab=bridgeTabs([motorway]);
  const w=motorway.widthMm;
  expect(areaMm2(tab)).toBeCloseTo(motorway.lengthMm*w+Math.PI*(w/2)**2,0);
  // Twice the road thickness, twice the tab.
  const wide=findBridgeSpans(roadBridgeCandidates(capture.features.roads,capture.view,'high',0,capture.tunnelRoadKeys).map(c=>({...c,widthMm:topoRoadWidthMm(c.tag!,capture.view,2)})),water,W,H).spans.find(s=>s.tag==='motorway')!;
  expect(wide.widthMm).toBeCloseTo(2*w,9);
  const roads=buildTopoRoads(capture.features.roads,capture.view,{detail:'high',thicknessScale:1},land,{water,tunnelRoadKeys:capture.tunnelRoadKeys});
  expect(MIN_BRIDGE_TAB_WIDTH_MM).toBe(3);
  const narrow=roads.warnings.find(x=>x.code==='bridge-tab-narrow-road');
  expect(narrow?.message).toMatch(/0\.39 mm/);
  expect(narrow?.message).toMatch(/3 mm minimum neck width/);
 },HEAVY);

 it('is drawn in the preview over the water, and follows the thickness control without a rebuild',()=>{
  const project=createDefaultTopoProject();
  const settings={roads:project.roads,labels:project.labels,frame:project.frame,title:project.title,route:null};
  const first=buildOverlay({capture,view:capture.view,water,settings,font:getLoadedFont});
  const motorway=first.overlay.roads.bridges.find(b=>b.roadClass==='motorway')!;
  expect(motorway.lines).toBe(2);
  expect(motorway.widthMm).toBeCloseTo(1.35,9);
  const thicker=buildOverlay({capture,view:capture.view,water,settings:{...settings,roads:{...project.roads,thicknessScale:2}},font:getLoadedFont},first.cache);
  expect(thicker.rebuilt).toEqual([]);
  expect(thicker.overlay.roads.bridges.find(b=>b.roadClass==='motorway')!.widthMm).toBeCloseTo(2.7,9);
 });
});

describe('what is not a bridge',()=>{
 const road=(roadClass:string,...points:(readonly [number,number])[]):CapturedRoad=>({roadClass,line:points.map(([x,y])=>[x,y])});

 it('a road that dead-ends in the water (a pier, a boat launch) gets no tab',()=>{
  // From the Presidio out into the bay, ending over water.
  const pier=road('service',PRESIDIO,BAY);
  const {spans,deadEnds}=findBridgeSpans(roadBridgeCandidates([pier],capture.view,'high').map(c=>({...c,widthMm:.48})),water,W,H);
  expect(spans).toEqual([]);
  expect(deadEnds).toBe(1);
  const built=buildTopoRoads([pier],capture.view,{detail:'high',thicknessScale:1},land,{water});
  expect(built.bridgeTabs).toEqual([]);
  expect(built.bridges).toMatchObject({spans:0,deadEndsOverWater:1});
  expect(built.warnings.map(w=>w.code)).toContain('roads-over-water');
  expect(inside(at(...BAY),built.geometry)).toBe(false);
 });

 it('the same road carried on to the far shore does get one — the rule is land at both ends',()=>{
  const crossing=road('service',PRESIDIO,HAWK_HILL);
  const {spans,deadEnds}=findBridgeSpans(roadBridgeCandidates([crossing],capture.view,'high').map(c=>({...c,widthMm:.48})),water,W,H);
  expect(spans).toHaveLength(1);
  expect(deadEnds).toBe(0);
 });

 it('a road split at a tile seam mid-crossing is still one crossing, not two dead ends',()=>{
  // Two decodings overlapping in the tiles' buffer: neither piece reaches the far shore on its own.
  const [a,b]=[at(...PRESIDIO),at(...HAWK_HILL)];
  const lerp=(t:number):[number,number]=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
  const pieces:BridgeCandidate[]=[{line:[a,lerp(.55)],widthMm:.48},{line:[lerp(.45),b],widthMm:.48}];
  const {spans,deadEnds}=findBridgeSpans(pieces,water,W,H);
  expect(deadEnds).toBe(0);
  expect(spans).toHaveLength(2);
  // Each piece alone is a dead end.
  expect(findBridgeSpans([pieces[0]],water,W,H)).toMatchObject({spans:[],deadEnds:1});
 });

 it('a tunnel under the water is never bridged',()=>{
  const tunnel=road('primary',PRESIDIO,HAWK_HILL);
  const {spans,tunnelsOverWater}=findBridgeSpans(roadBridgeCandidates([tunnel],capture.view,'high',0,[roadKey(tunnel)]).map(c=>({...c,widthMm:.7})),water,W,H);
  expect(spans).toEqual([]);
  expect(tunnelsOverWater).toBe(1);
 });

 it('a road that leaves the board over water reaches no land here, and gets no tab',()=>{
  // From the Presidio north-east across the bay and off the board's top edge.
  const {west,east,north}=capture.view.bounds;
  const off=road('primary',PRESIDIO,[west+(east-west)*.9,north+.01]);
  expect(findBridgeSpans(roadBridgeCandidates([off],capture.view,'high').map(c=>({...c,widthMm:.7})),water,W,H).spans).toEqual([]);
 });
});

describe('the GPX route',()=>{
 const routeOf=(...points:(readonly [number,number])[]):TopoRoute=>({segments:[points.map(([x,y])=>[x,y] as [number,number])],widthMm:.6,source:'track',pointCount:points.length});
 it('walked across the bridge keeps a tab; one that ends in the water does not',()=>{
  const across=projectRouteLines(routeOf(PRESIDIO,GG_MIDSPAN,HAWK_HILL),capture.view);
  const crossing=buildRouteGeometry(across.lines,.6,land,water,{widthMm:W,heightMm:H});
  expect(crossing.bridgeSpans).toBe(1);
  expect(inside(at(...GG_MIDSPAN),crossing.geometry)).toBe(true);
  expect(crossing.warnings.map(w=>w.code)).toEqual(['bridge-tab-narrow-route']);
  const intoBay=projectRouteLines(routeOf(PRESIDIO,BAY),capture.view);
  const dead=buildRouteGeometry(intoBay.lines,.6,land,water,{widthMm:W,heightMm:H});
  expect(dead.bridgeSpans).toBe(0);
  expect(dead.warnings.map(w=>w.code)).toContain('route-over-water');
 });
});
