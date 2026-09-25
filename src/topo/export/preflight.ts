import type {MultiPolygonMm} from '../../geometry/shoreline/polygonEngine';
import {thinFeatures} from '../../ornament/export/morphology';
import {ABSOLUTE_MIN_PIECE_AREA_MM2,geometryHasNonFinite,pathHasNonFinite,pathSubpathsAreClosed,ringIsClosed,ringSelfIntersects} from '../../ornament/export/preflight';
import {geometryAreaMm2} from '../../ornament/geometry/polygonRepair';
import {MIN_ENGRAVABLE_WIDTH_MM} from '../../ornament/geometry/roadWidths';
import {MIN_BRIDGE_TAB_WIDTH_MM} from '../features/bridges';
import type {TerrainResult} from '../terrain/pipeline';
import type {TopoProject} from '../types';
import type {TopoBoard,TopoExportGroup,TopoGroupId} from './board';
import {ELEVATION_PROVIDER_ID,type TopoExportMetadata} from './metadata';

// Preflight for the topo board: the plan's Phase 4 list, every item of it, run on the groups exactly
// as they are about to be serialised (the ornament's rule, src/ornament/export/preflight.ts, whose
// checkers this reuses: closed rings and subpaths, the self-intersection sweep, the non-finite scans,
// the morphological thin-feature test).
//
//   error    the file would be wrong or unmanufacturable. Blocks: there is no SVG at all.
//   warning  the geometry is what was asked for and somebody should look at it. Exports.
//
// The checks, in the plan's order:
//   dimensions          the board the terrain was generated for is the board that is set; the SVG
//                       is that size; the land and water tile the board to within 0.1 mm; nothing
//                       lies outside it (a title dragged off the edge, say).
//   open-cut-paths      every ring in a cut group is closed; every glyph subpath ends in Z.
//   self-intersections  no cut ring crosses itself.
//   tiny-islands        no piece of material under 0.25 mm² (it drops through the bed); tiny
//                       openings are only a warning — nothing falls out of them.
//   minimum-width       bridge tabs, measured on the emitted geometry, are no narrower than the laser
//                       can cut (the 0.25 mm engraving floor): a thinner one is severed by the cut
//                       either side of it and the bridge falls apart — an error. Tabs under the
//                       ornament's 3 mm neck minimum, and terrain slivers under the laser minimum,
//                       are warnings: fragile, but cuttable, and Road thickness is the remedy.
//   non-finite          no NaN or Infinity anywhere, in geometry or path data. Run first, because
//                       the boolean engine throws on it before any other check can report.
//   attribution         the metadata names its app version, timestamp and both data sources with
//                       their attributions: OpenStreetMap/OpenFreeMap and Terrain Tiles.
// And one more, 'design', for what building the features reported (gaps filled, labels left off,
// roads over water): warnings, carried through so one report covers the whole export.

export type TopoPreflightCheckId='dimensions'|'open-cut-paths'|'self-intersections'|'tiny-islands'|'minimum-width'|'non-finite'|'attribution'|'design';
export const TOPO_PREFLIGHT_CHECKS:readonly TopoPreflightCheckId[]=['dimensions','open-cut-paths','self-intersections','tiny-islands','minimum-width','non-finite','attribution','design'];

export interface TopoPreflightFinding{check:TopoPreflightCheckId;severity:'error'|'warning';code:string;message:string;atMm?:[number,number]}
export interface TopoPreflightReport{blocked:boolean;findings:TopoPreflightFinding[];checksRun:TopoPreflightCheckId[]}

export const BOARD_TOLERANCE_MM=.1;
// A tab exactly at the laser minimum must pass: the offsets the thin-feature test is built from are
// on a 0.001 mm grid, so the test runs this far under the minimum.
export const TAB_WIDTH_MEASUREMENT_SLACK_MM=.01;

const round=(value:number)=>Number(value.toFixed(3));
const finding=(check:TopoPreflightCheckId,severity:'error'|'warning',code:string,message:string,atMm?:[number,number]):TopoPreflightFinding=>atMm?{check,severity,code,message,atMm}:{check,severity,code,message};
const firstPoint=(g:MultiPolygonMm):[number,number]|undefined=>g[0]?.[0]?.[0]?[round(g[0][0][0][0]),round(g[0][0][0][1])]:undefined;
const NUMBER=/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;

function* groupPoints(group:TopoExportGroup):Generator<[number,number]>{
 for(const polygon of group.geometry)for(const ring of polygon)for(const p of ring)yield p;
 for(const score of group.lines)for(const line of score.lines)for(const p of line)yield p;
 // Glyph path data: M/L/Q/C commands, coordinates in x y pairs.
 for(const glyph of group.glyphs){const v=(glyph.d.match(NUMBER)??[]).map(Number);for(let i=0;i+1<v.length;i+=2)yield [v[i],v[i+1]]}
}

// Never throws: a check that cannot run is a finding, as in the ornament's preflight.
function guard<T>(run:()=>T,fallback:T,report:(message:string)=>void):T{try{return run()}catch(error){report((error as Error).message);return fallback}}

export interface TopoPreflightInput{project:TopoProject;terrain:TerrainResult;board:TopoBoard;metadata:TopoExportMetadata;captured:boolean}

// Twice the distance from the span's centreline to the nearest edge of the material, minimised over
// samples every 0.25 mm along the span (ends excluded: there the bridge joins the shore and the edge
// turns away). For a strip of width w centred on the line, that is w.
export function measureSpanWidthMm(line:readonly [number,number][],material:MultiPolygonMm,stepMm=.25):number{
 const segments:[number,number,number,number][]=[];
 for(const polygon of material)for(const ring of polygon)for(let i=0;i+1<ring.length;i++)segments.push([ring[i][0],ring[i][1],ring[i+1][0],ring[i+1][1]]);
 let length=0;for(let i=1;i<line.length;i++)length+=Math.hypot(line[i][0]-line[i-1][0],line[i][1]-line[i-1][1]);
 const margin=Math.min(length*.1,2);
 let best=Infinity,walked=0;
 for(let i=1;i<line.length;i++){
  const [ax,ay]=line[i-1],[bx,by]=line[i],seg=Math.hypot(bx-ax,by-ay);
  for(let d=0;d<seg;d+=stepMm){
   const at=walked+d;
   if(at<margin||at>length-margin)continue;
   const t=d/seg,px=ax+(bx-ax)*t,py=ay+(by-ay)*t;
   let nearest=Infinity;
   for(const [x1,y1,x2,y2] of segments){
    const dx=x2-x1,dy=y2-y1,len=dx*dx+dy*dy,u=len?Math.max(0,Math.min(1,((px-x1)*dx+(py-y1)*dy)/len)):0;
    const dist=Math.hypot(px-(x1+u*dx),py-(y1+u*dy));
    if(dist<nearest)nearest=dist;
   }
   if(nearest<best)best=nearest;
  }
  walked+=seg;
 }
 return Number.isFinite(best)?2*best:0;
}

export function runTopoPreflight(input:TopoPreflightInput):TopoPreflightReport{
 const {project,terrain,board,metadata}=input;
 const findings:TopoPreflightFinding[]=[];
 const W=board.widthMm,H=board.heightMm;
 const byId=new Map(board.groups.map(g=>[g.id,g]));
 const cutGroups=board.groups.filter(g=>g.operation==='cut');

 // non-finite, first.
 const poisoned=new Set<TopoGroupId>();
 for(const group of board.groups){
  const bad=geometryHasNonFinite(group.geometry)
   ||group.lines.some(s=>s.lines.some(line=>line.some(([x,y])=>!Number.isFinite(x)||!Number.isFinite(y))))
   ||group.glyphs.some(glyph=>pathHasNonFinite(glyph.d));
  if(bad){poisoned.add(group.id);findings.push(finding('non-finite','error','non-finite',`${group.id} contains a coordinate that is not a finite number (NaN or Infinity). This is a bug in the geometry pipeline, not something a different setting will fix.`))}
 }
 if(geometryHasNonFinite(board.bridgeTabs))findings.push(finding('non-finite','error','non-finite','The bridge tabs contain a coordinate that is not a finite number.'));

 // dimensions.
 const set=project.output;
 if(Math.abs(set.widthMm-W)>BOARD_TOLERANCE_MM||Math.abs(set.heightMm-H)>BOARD_TOLERANCE_MM)
  findings.push(finding('dimensions','error','board-size-changed',`The board is set to ${round(set.widthMm)} × ${round(set.heightMm)} mm, but the terrain was generated for ${round(W)} × ${round(H)} mm. Go back to the map and generate again at the new size.`));
 if(!(W>0&&H>0)||Math.abs(Number(W.toFixed(3))-W)>BOARD_TOLERANCE_MM||Math.abs(Number(H.toFixed(3))-H)>BOARD_TOLERANCE_MM)
  findings.push(finding('dimensions','error','document-size',`The document would not be ${round(W)} × ${round(H)} mm.`));
 const terrainOne=byId.get('cut/terrain-1')!,water=byId.get('cut/water')!;
 if(!poisoned.has('cut/terrain-1')&&!poisoned.has('cut/water')){
  const covered=geometryAreaMm2(terrainOne.geometry)+geometryAreaMm2(water.geometry);
  // Land and water tile the board: their areas sum to the board's, to within 0.1 mm along its edge.
  if(Math.abs(covered-W*H)>BOARD_TOLERANCE_MM*2*(W+H))
   findings.push(finding('dimensions','error','board-not-covered',`Layer 1 and the water cover ${round(covered)} mm², but the board is ${round(W*H)} mm² — more than 0.1 mm around its edge adrift. The cut would not be the board's size.`));
 }
 if(!terrainOne.geometry.length)findings.push(finding('dimensions','error','no-land','There is no land on this board, so there is nothing to cut. Move the map onto land and generate again.'));
 for(const group of board.groups){
  if(poisoned.has(group.id))continue;
  for(const [x,y] of groupPoints(group))if(x<-BOARD_TOLERANCE_MM||y<-BOARD_TOLERANCE_MM||x>W+BOARD_TOLERANCE_MM||y>H+BOARD_TOLERANCE_MM){
   findings.push(finding('dimensions','error','outside-board',`${group.id} reaches outside the ${round(W)} × ${round(H)} mm board (at ${round(x)}, ${round(y)} mm).${group.id==='engrave/title'?' Move the title back onto the board, or make it smaller.':''}`,[round(x),round(y)]));
   break;
  }
 }

 // open cut paths.
 for(const group of cutGroups){
  if(poisoned.has(group.id))continue;
  const open=group.geometry.flat().find(ring=>!ringIsClosed(ring));
  if(open)findings.push(finding('open-cut-paths','error','cut-ring-open',`A cut path in ${group.id} is not closed. An open cut path is cut as a line, not a boundary, and the piece falls apart on the bed.`,open.length?[round(open[0][0]),round(open[0][1])]:undefined));
 }
 for(const group of board.groups.filter(g=>g.kind==='glyphs'))
  if(group.glyphs.some(glyph=>glyph.d&&!pathSubpathsAreClosed(glyph.d)))findings.push(finding('open-cut-paths','error','glyph-path-open',`A glyph outline in ${group.id} has a subpath with no close command. Laser software reads that as an open polyline.`));

 // self-intersections.
 for(const group of cutGroups){
  if(poisoned.has(group.id))continue;
  let at:[number,number]|undefined;
  for(const ring of group.geometry.flat()){at=ringSelfIntersects(ring);if(at)break}
  if(at)findings.push(finding('self-intersections','error','cut-ring-self-intersects',`A cut path in ${group.id} crosses itself. The region it bounds is ambiguous, and different laser software will resolve it differently.`,at));
 }

 // tiny islands.
 for(const group of cutGroups){
  if(poisoned.has(group.id))continue;
  const tiny=group.geometry.filter(polygon=>geometryAreaMm2([polygon])<ABSOLUTE_MIN_PIECE_AREA_MM2);
  if(!tiny.length)continue;
  if(group.kind==='pieces')findings.push(finding('tiny-islands','error','piece-too-small',`${group.id} has ${tiny.length} piece${tiny.length>1?'s':''} under ${ABSOLUTE_MIN_PIECE_AREA_MM2} mm². A piece that small cannot be cut and retrieved; it drops through the bed.`,firstPoint(tiny)));
  else findings.push(finding('tiny-islands','warning','opening-tiny',`${group.id} has ${tiny.length} opening${tiny.length>1?'s':''} under ${ABSOLUTE_MIN_PIECE_AREA_MM2} mm². The kerf will dominate them; nothing falls out.`,firstPoint(tiny)));
 }

 // minimum width: each bridge, measured along its span on the emitted layer-1 geometry — the
 // ornament's neck discipline (measure the material that will be cut, not the parameters it was
 // built from). Every 0.25 mm along the part of the span over water, the distance to the nearest
 // edge of cut/terrain-1 is half the material's width there; the narrowest is the bridge's width.
 const spans=[...(board.roads?.bridgeSpans??[]).map(span=>({span,what:'road' as const})),...(board.route?.bridgeSpanLines??[]).map(span=>({span,what:'route' as const}))];
 if(spans.length&&!poisoned.has('cut/terrain-1')){
  const measured=guard(()=>spans.map(({span,what})=>({what,span,widthMm:measureSpanWidthMm(span.line,terrainOne.geometry)})),[],message=>findings.push(finding('minimum-width','error','tab-width-unmeasurable',`The bridges could not be measured on the exported geometry (${message}). An unmeasured bridge is not an acceptable bridge.`)));
  const severed=measured.filter(m=>m.widthMm<MIN_ENGRAVABLE_WIDTH_MM-TAB_WIDTH_MEASUREMENT_SLACK_MM);
  if(severed.length){
   const worst=severed.reduce((a,b)=>a.widthMm<=b.widthMm?a:b);
   const mid=worst.span.line[Math.floor(worst.span.line.length/2)];
   findings.push(finding('minimum-width','error','bridge-below-laser-minimum',`${severed.length} bridge${severed.length>1?'s are':' is'} narrower over the water than the ${MIN_ENGRAVABLE_WIDTH_MM} mm the laser can cut (the narrowest measures ${worst.widthMm.toFixed(2)} mm on the cut geometry). The cuts either side would sever it and the bridge would fall out. Widen ${severed.some(m=>m.what==='route')?'the route (Route width)':'the roads (Road thickness)'}.`,mid?[round(mid[0]),round(mid[1])]:undefined));
  }
  const fragile=measured.filter(m=>m.widthMm>=MIN_ENGRAVABLE_WIDTH_MM-TAB_WIDTH_MEASUREMENT_SLACK_MM&&m.widthMm<MIN_BRIDGE_TAB_WIDTH_MM);
  if(fragile.length){
   const worst=fragile.reduce((a,b)=>a.widthMm<=b.widthMm?a:b),longest=Math.max(...fragile.map(m=>m.span.lengthMm));
   findings.push(finding('minimum-width','warning','bridge-under-neck-minimum',`${fragile.length} bridge${fragile.length>1?'s measure':' measures'} under the ornament's ${MIN_BRIDGE_TAB_WIDTH_MM} mm minimum neck on the cut geometry (narrowest ${worst.widthMm.toFixed(2)} mm, longest span ${longest.toFixed(1)} mm). They cut, but may snap; raise ${fragile.some(m=>m.what==='route')?'Road thickness or Route width':'Road thickness'} to widen them, or test-cut the material.`));
  }
 }
 for(const k of [1,2,3,4]){
  const group=byId.get(`cut/terrain-${k}` as TopoGroupId)!;
  if(!group.geometry.length||poisoned.has(group.id))continue;
  const thin=guard(()=>thinFeatures(group.geometry,MIN_ENGRAVABLE_WIDTH_MM),{geometry:[],areaMm2:0,regions:0,minWidthMm:MIN_ENGRAVABLE_WIDTH_MM},()=>undefined);
  if(thin.regions)findings.push(finding('minimum-width','warning','terrain-sliver',`${group.id} has ${thin.regions} sliver${thin.regions>1?'s':''} narrower than ${MIN_ENGRAVABLE_WIDTH_MM} mm (${round(thin.areaMm2)} mm² in all), usually a thin spit of land or band. The laser cannot resolve them; they will burn away.`,firstPoint(thin.geometry)));
 }

 // attribution and metadata.
 const missing:string[]=[];
 if(!metadata.appVersion)missing.push('the app version');
 if(!metadata.generatedAt||Number.isNaN(Date.parse(metadata.generatedAt)))missing.push('a generation timestamp');
 const basemap=metadata.providers.find(p=>p.role==='basemap'),elevation=metadata.providers.find(p=>p.role==='elevation'&&p.id===ELEVATION_PROVIDER_ID);
 if(!basemap?.attribution.includes('OpenStreetMap'))missing.push('the OpenStreetMap attribution');
 if(!elevation?.attribution.includes('Terrain Tiles')||!elevation.source)missing.push('the Terrain Tiles attribution and source');
 if(!metadata.viewport||!Number.isFinite(metadata.viewport.zoom))missing.push('the viewport');
 if(missing.length)findings.push(finding('attribution','error','metadata-missing',`The file would be missing ${missing.join(', ')}. Attribution travels with the file under the data licences, and the metadata is how a board is made again.`));

 // design: what building the features reported.
 if(!input.captured)findings.push(finding('design','warning','no-capture','No water, roads or labels were captured for this board, so any sea or lake bed is layered as land. Go back to the map and generate again with the map loaded.'));
 for(const w of terrain.warnings)findings.push(finding('design','warning',w.code,w.message));
 for(const w of board.warnings)if(!w.code.startsWith('bridge-tab-narrow'))findings.push(finding('design','warning',w.code,w.message));
 if(project.compass.position!=='off')findings.push(finding('design','warning','compass-not-built','A compass is set in this project, but the builder does not draw one yet; engrave/compass is empty.'));

 return {blocked:findings.some(f=>f.severity==='error'),findings,checksRun:[...TOPO_PREFLIGHT_CHECKS]};
}

export function topoPreflightSummary(report:TopoPreflightReport):string{
 const errors=report.findings.filter(f=>f.severity==='error').length,warnings=report.findings.length-errors;
 if(errors)return `${errors} problem${errors===1?'':'s'} must be fixed before this board can be exported${warnings?` (and ${warnings} warning${warnings===1?'':'s'})`:''}.`;
 return warnings?`Preflight passed all ${report.checksRun.length} checks with ${warnings} warning${warnings===1?'':'s'}.`:`Preflight passed all ${report.checksRun.length} checks.`;
}
