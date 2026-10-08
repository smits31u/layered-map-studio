import type {MultiPolygonMm,RingMm} from '../../geometry/shoreline/polygonEngine';
import type {FeatureGeometryResult} from '../geometry/featureGeometry';
import type {OrnamentGeometry} from '../geometry/ornamentShape';
import {geometryAreaMm2} from '../geometry/polygonRepair';
import type {OrnamentTextLayout} from '../text/ornamentText';
import type {OrnamentProject} from '../types';
import {measureLoopNeck,neckSummary,type NeckMeasurement} from './neck';
import {thinFeatures} from './morphology';
import {loopPieceFor,type ExportGroup,type OrnamentGroupId,type OrnamentPieceSet} from './pieces';

// Preflight: everything that has to be true before a file is allowed to reach a machine.
//
// The rule this file exists to enforce is that a design which fails preflight does not export. Not
// "exports with a warning banner", not "exports and logs to the console" — the caller gets a report
// with `blocked: true` and no SVG at all. A warning that can be clicked past is a warning that gets
// clicked past, and the cost of being wrong here is a physical object in somebody's hands.
//
// The split between error and warning is therefore about who the decision belongs to, not about how
// serious the finding is:
//
//   error   — the file is wrong, or unmanufacturable, in a way no reasonable operator would choose.
//             Blocks.
//   warning — the geometry is exactly what was asked for and somebody should look at it. Loose
//             islands are the archetype: Phase 3 argues at length that they are the user's decision,
//             and blocking on them would push people toward whichever policy silences them fastest.
//
// The eight checks are the plan's list, in its order: dimensions, open cut paths, self-intersections,
// disconnected pieces, tiny islands, minimum neck/feature width, text overflow, NaN/Infinity.

export type PreflightSeverity='error'|'warning';

export interface PreflightFinding{
 check:PreflightCheckId;
 severity:PreflightSeverity;
 code:string;
 message:string;
 // Where to look, in sheet millimetres, when the finding has a location.
 atMm?:[number,number];
}

export type PreflightCheckId=
 |'dimensions'
 |'open-cut-paths'
 |'self-intersections'
 |'disconnected-pieces'
 |'tiny-islands'
 |'minimum-width'
 |'text-overflow'
 |'non-finite';

export const PREFLIGHT_CHECKS:PreflightCheckId[]=[
 'dimensions',
 'open-cut-paths',
 'self-intersections',
 'disconnected-pieces',
 'tiny-islands',
 'minimum-width',
 'text-overflow',
 'non-finite',
];

export interface PreflightReport{
 blocked:boolean;
 findings:PreflightFinding[];
 // Every check that ran, so a clean report is evidence the suite executed rather than evidence
 // nothing was looked at.
 checksRun:PreflightCheckId[];
 neck:NeckMeasurement;
 finishedDiameterMm:number;
 measuredMinFeatureWidthMm:number;
}

// The exit criterion: a 101.6mm ornament must come out of the file 101.6mm across. The budget is for
// arc flattening and three-decimal serialisation, both of which are an order of magnitude smaller.
export const DIAMETER_TOLERANCE_MM=.1;

// Below this a closed region is not a part, it is a speck the extraction grid will lose. Separate
// from the user's own `minIslandAreaMm2`, which is a design preference; this is the floor under it.
export const ABSOLUTE_MIN_PIECE_AREA_MM2=.25;

// Self-intersection is checked exhaustively, but a ring with more vertices than this is checked by a
// sweep instead of by brute force. Both are exact; the cap only decides which is used.
const SWEEP_THRESHOLD=64;

const finding=(check:PreflightCheckId,severity:PreflightSeverity,code:string,message:string,atMm?:[number,number]):PreflightFinding=>
 atMm?{check,severity,code,message,atMm}:{check,severity,code,message};

const round=(value:number)=>Number(value.toFixed(3));

// ---- 2. open cut paths ------------------------------------------------------------------------

const CLOSE_EPSILON_MM=1e-6;

export const ringIsClosed=(ring:RingMm):boolean=>
 ring.length>=4
 &&Math.abs(ring[0][0]-ring[ring.length-1][0])<=CLOSE_EPSILON_MM
 &&Math.abs(ring[0][1]-ring[ring.length-1][1])<=CLOSE_EPSILON_MM;

// Path data counts as closed when every subpath ends in a close command. opentype.js is the reason
// this is checked rather than assumed: its 2.x output leaves contours geometrically closed but emits
// no `Z`, and `textVector.ts` appends them precisely because a Z-less subpath reads as an open
// polyline to a CAM importer and loses kerf compensation. This is the assertion that the appending
// actually happened, made against the string that is going into the file.
export function pathSubpathsAreClosed(d:string):boolean{
 const subpaths=d.split(/(?=[Mm])/).map(part=>part.trim()).filter(Boolean);
 if(!subpaths.length)return false;
 return subpaths.every(subpath=>/[Zz]\s*$/.test(subpath));
}

// ---- 3. self-intersections --------------------------------------------------------------------

const orientation=(ax:number,ay:number,bx:number,by:number,cx:number,cy:number):number=>{
 const value=(by-ay)*(cx-bx)-(bx-ax)*(cy-by);
 return Math.abs(value)<1e-12?0:Math.sign(value);
};

const onSegment=(ax:number,ay:number,bx:number,by:number,px:number,py:number):boolean=>
 Math.min(ax,bx)-1e-12<=px&&px<=Math.max(ax,bx)+1e-12&&Math.min(ay,by)-1e-12<=py&&py<=Math.max(ay,by)+1e-12;

export function segmentsCross(a:[number,number],b:[number,number],c:[number,number],d:[number,number]):boolean{
 const o1=orientation(a[0],a[1],b[0],b[1],c[0],c[1]);
 const o2=orientation(a[0],a[1],b[0],b[1],d[0],d[1]);
 const o3=orientation(c[0],c[1],d[0],d[1],a[0],a[1]);
 const o4=orientation(c[0],c[1],d[0],d[1],b[0],b[1]);
 if(o1!==o2&&o3!==o4)return true;
 if(o1===0&&onSegment(a[0],a[1],b[0],b[1],c[0],c[1]))return true;
 if(o2===0&&onSegment(a[0],a[1],b[0],b[1],d[0],d[1]))return true;
 if(o3===0&&onSegment(c[0],c[1],d[0],d[1],a[0],a[1]))return true;
 if(o4===0&&onSegment(c[0],c[1],d[0],d[1],b[0],b[1]))return true;
 return false;
}

// Adjacent segments share an endpoint by construction and the closing segment shares one with the
// first, so those pairs are skipped; anything else touching is a genuine self-intersection.
export function ringSelfIntersects(ring:RingMm):[number,number]|undefined{
 const points=ring.length>1&&ring[0][0]===ring[ring.length-1][0]&&ring[0][1]===ring[ring.length-1][1]?ring.slice(0,-1):ring;
 const count=points.length;
 if(count<4)return undefined;
 // A bucketed sweep on x keeps a dense shoreline ring from costing n² segment tests. Segments are
 // sorted by their left edge and compared only against those still open at that x, which is exact:
 // two segments whose x-ranges do not overlap cannot cross.
 const segments=points.map((point,index)=>{
  const next=points[(index+1)%count];
  return {index,a:point,b:next,minX:Math.min(point[0],next[0]),maxX:Math.max(point[0],next[0])};
 });
 if(count>SWEEP_THRESHOLD)segments.sort((left,right)=>left.minX-right.minX);
 for(let i=0;i<segments.length;i++){
  for(let j=i+1;j<segments.length;j++){
   if(count>SWEEP_THRESHOLD&&segments[j].minX>segments[i].maxX)break;
   const a=segments[i],b=segments[j];
   const adjacent=(a.index+1)%count===b.index||(b.index+1)%count===a.index||a.index===b.index;
   if(adjacent)continue;
   if(segmentsCross(a.a,a.b,b.a,b.b))return [round((a.a[0]+b.a[0])/2),round((a.a[1]+b.a[1])/2)];
  }
 }
 return undefined;
}

// ---- 8. NaN / Infinity ------------------------------------------------------------------------

const NUMBER_TOKEN=/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;

export const pathHasNonFinite=(d:string):boolean=>
 /NaN|Infinity/i.test(d)||(d.match(NUMBER_TOKEN)??[]).some(token=>!Number.isFinite(Number(token)));

export const geometryHasNonFinite=(geometry:MultiPolygonMm):boolean=>
 geometry.some(polygon=>polygon.some(ring=>ring.some(([x,y])=>!Number.isFinite(x)||!Number.isFinite(y))));

// ------------------------------------------------------------------------------------------------

export interface PreflightInput{
 project:OrnamentProject;
 geometry:OrnamentGeometry;
 textLayout:OrnamentTextLayout;
 pieces:OrnamentPieceSet;
 featureGeometry?:FeatureGeometryResult;
}

const isCutGroup=(group:ExportGroup):boolean=>group.operation==='cut'&&group.applicable;

// Preflight must not throw. A check that cannot run is a finding, not an exception: an exception out
// of the export would surface as "something went wrong" with no indication of which of the eight
// checks failed or whether the file is safe, and a caller could plausibly decide to carry on.
function guard<T>(run:()=>T,fallback:T,report:(message:string)=>void):T{
 try{return run()}catch(error){report((error as Error).message);return fallback}
}

// Which of the eight checks an upstream finding is filed under. The eight are the plan's list of
// what must be checked, and these are all findings about one of those eight things reached by a
// different route — so they are grouped rather than given a ninth category.
function checkForCode(code:string):PreflightCheckId{
 if(code.startsWith('land-island')||code.includes('islands'))return 'tiny-islands';
 if(code.startsWith('text'))return 'text-overflow';
 if(code.includes('non-finite'))return 'non-finite';
 return 'disconnected-pieces';
}

const unmeasurableNeck=(requiredMm:number,junctionMm:number,annulusMm:number):NeckMeasurement=>({
 measuredMm:0,
 requiredMm,
 attachedAtAll:false,
 meetsMinimum:false,
 saturated:false,
 searchedToMm:0,
 resolutionMm:0,
 loopProbeAreaMm2:0,
 bodyProbeAreaMm2:0,
 analyticJunctionMm:junctionMm,
 analyticNeckMm:Math.min(junctionMm,annulusMm),
});

export function runPreflight(input:PreflightInput):PreflightReport{
 const {project,geometry,textLayout,pieces,featureGeometry}=input;
 const findings:PreflightFinding[]=[];
 const groups=pieces.groups.filter(group=>group.applicable);
 const minWidthMm=project.ornament.hangingLoop.minNeckWidthMm;

 // 8 — NaN / Infinity, run first despite being last in the list.
 //
 // The order of the list is the order the checks are *named*, not the order they can be executed. A
 // non-finite coordinate cannot be left until the end, because every check that calls the boolean
 // engine throws on it first: clipper-lib raises "Tried to create degenerate segment at [NaN, 10]"
 // from somewhere three layers down, and an opaque exception out of the export is strictly worse
 // than the finding this produces. So the scan runs up front and the geometry it condemns is kept
 // away from the checks that would fall over on it.
 //
 // Engrave paths are scanned as well as cut paths: a non-finite coordinate in an engrave path is the
 // same bug and is just as capable of sending the head to a coordinate the machine resolves as zero.
 const poisoned=new Set<OrnamentGroupId>();
 for(const group of groups){
  let bad=false;
  if(geometryHasNonFinite(group.geometry)){
   bad=true;
   findings.push(finding('non-finite','error','geometry-non-finite',
    `${group.id} contains a coordinate that is not a finite number. This is a bug in the geometry pipeline, not something a different map view will fix.`));
  }
  for(const d of group.paths)if(pathHasNonFinite(d)){
   bad=true;
   findings.push(finding('non-finite','error','path-non-finite',
    `${group.id} contains path data with a coordinate that is not a finite number.`));
   break;
  }
  if(bad)poisoned.add(group.id);
 }
 if(!Number.isFinite(pieces.finishedDiameterMm))
  findings.push(finding('non-finite','error','diameter-non-finite','The finished diameter could not be measured from the exported geometry.'));

 // 1 — dimensions.
 const {sheet,finishedDiameterMm}=pieces;
 if(!(sheet.widthMm>0)||!(sheet.heightMm>0)||!Number.isFinite(sheet.widthMm)||!Number.isFinite(sheet.heightMm))
  findings.push(finding('dimensions','error','sheet-invalid',`The sheet came out ${round(sheet.widthMm)}×${round(sheet.heightMm)}mm, which is not a usable size. This is a layout bug, not a setting.`));
 const diameterErrorMm=Math.abs(finishedDiameterMm-project.ornament.diameterMm);
 if(diameterErrorMm>DIAMETER_TOLERANCE_MM)
  findings.push(finding('dimensions','error','diameter-out-of-tolerance',
   `The exported ornament measures ${round(finishedDiameterMm)}mm across but was specified as ${project.ornament.diameterMm}mm — ${round(diameterErrorMm)}mm out, against a ${DIAMETER_TOLERANCE_MM}mm budget.`));

 // 2 — open cut paths.
 for(const group of groups.filter(isCutGroup)){
  for(const polygon of group.geometry)for(const ring of polygon)if(!ringIsClosed(ring))
   findings.push(finding('open-cut-paths','error','cut-ring-open',
    `A cut path in ${group.id} is not closed. An open cut path is cut as a line, not a boundary, and the piece falls apart on the bed.`,
    ring.length?[round(ring[0][0]),round(ring[0][1])]:undefined));
  for(const d of group.paths)if(!pathSubpathsAreClosed(d))
   findings.push(finding('open-cut-paths','error','cut-path-open',
    `A cut path in ${group.id} has a subpath with no close command. CAM importers read that as an open polyline and drop kerf compensation on it.`));
 }

 // 3 — self-intersections.
 for(const group of groups.filter(isCutGroup)){
  for(const polygon of group.geometry)for(const ring of polygon){
   const at=ringSelfIntersects(ring);
   if(at){
    findings.push(finding('self-intersections','error','cut-ring-self-intersects',
     `A cut path in ${group.id} crosses itself. The region it bounds is ambiguous, and different importers will resolve it differently.`,at));
    break;
   }
  }
 }

 // 4 — disconnected pieces.
 const frame=groups.find(group=>group.id==='piece/frame/cut');
 if(frame&&frame.geometry.length>1)
  findings.push(finding('disconnected-pieces','error','frame-disconnected',
   `The frame cuts as ${frame.geometry.length} separate pieces rather than one. Check the rim width and the map/text boundary — something has cut the ring through.`));
 const base=groups.find(group=>group.id==='piece/base/cut');
 if(base&&base.geometry.length>1)
  findings.push(finding('disconnected-pieces','error','base-disconnected',
   `The base cuts as ${base.geometry.length} separate pieces rather than one.`));
 // Loose land is a warning under every policy, never an error.
 //
 // This was an error under bridge and omit until the policies were made to resolve what they can:
 // the reasoning was that a policy leaving something loose had failed. It had not. What reaches this
 // point now is an island the policy deliberately kept — too far from shore for a tab, and too large
 // to be one of the specks the user already called noise. A real lake with a real island in the
 // middle is the normal case for this product, and blocking its export would leave the maker to
 // discover that the only way to get a file out is whichever setting makes the message disappear.
 // That is the outcome Phase 3 argues against at length in landIslands.ts, and it stands here.
 //
 // Silence is still not on the table: the piece count, the policy and the remedies are all named.
 const land=groups.find(group=>group.id==='piece/land/cut');
 if(land&&land.geometry.length>1){
  const loose=land.geometry.length-1;
  findings.push(finding('disconnected-pieces','warning','land-disconnected',
   project.land.islandPolicy==='keep-separate'
    ? `The land cuts as ${land.geometry.length} pieces: ${loose} loose piece(s) will need gluing back into position. This is what "keep as separate pieces" means — switch to bridging if a single connected piece is wanted.`
    : `The land cuts as ${land.geometry.length} pieces. The "${project.land.islandPolicy}" policy joined or removed what it could; ${loose} piece(s) are too far from the shore to tab and too large to drop, so they will cut loose and need gluing back. Widen the bridge reach, raise the omit threshold above their size, or reframe the map so they fall outside it.`));
 }

 // 5 — tiny islands.
 for(const group of groups.filter(isCutGroup)){
  for(const polygon of group.geometry){
   const area=geometryAreaMm2([polygon]);
   if(area<ABSOLUTE_MIN_PIECE_AREA_MM2){
    findings.push(finding('tiny-islands','error','cut-fragment-too-small',
     `${group.id} contains a closed cut region of only ${round(area)}mm², below the ${ABSOLUTE_MIN_PIECE_AREA_MM2}mm² floor. It cannot be cut and retrieved; it will drop through the bed.`,
     polygon[0]?.length?[round(polygon[0][0][0]),round(polygon[0][0][1])]:undefined));
   }else if(area<project.land.minIslandAreaMm2){
    findings.push(finding('tiny-islands','warning','cut-fragment-small',
     `${group.id} contains a ${round(area)}mm² piece, under the ${project.land.minIslandAreaMm2}mm² size you set as meaningful.`));
   }
  }
 }

 // 6 — minimum neck and feature width. The neck is measured on the emitted geometry of whichever
 // piece carries the loop — the frame in classic mode, the backing in water-cutout mode — which is
 // the whole argument of neck.ts; the general feature-width sweep runs over every cut piece.
 // Measured on the group geometry exactly as it will be serialised — sheet coordinates and all —
 // with the probes moved to meet it rather than the other way round.
 //
 // The piece name is substituted into the messages rather than the messages being duplicated per
 // mode; in classic mode it is "frame", so classic findings read exactly as they always have.
 const loopPiece=pieces.loopPiece??loopPieceFor(pieces.buildMode);
 const loopGroupId:OrnamentGroupId=loopPiece==='base'?'piece/base/cut':'piece/frame/cut';
 const loopPieceName=loopPiece==='base'?'backing':'frame';
 const loopGroup=loopPiece==='base'?base:frame;
 const loopPlacement=pieces.pieces.find(piece=>piece.id===loopPiece)?.offsetMm;
 const neck=poisoned.has(loopGroupId)
  ?unmeasurableNeck(project.ornament.hangingLoop.minNeckWidthMm,geometry.loop.junctionWidthMm,geometry.loop.annulusWidthMm)
  :guard(
    ()=>measureLoopNeck(loopGroup?.geometry??[],geometry,project.ornament,{offsetMm:loopPlacement}),
    unmeasurableNeck(project.ornament.hangingLoop.minNeckWidthMm,geometry.loop.junctionWidthMm,geometry.loop.annulusWidthMm),
    message=>findings.push(finding('minimum-width','error','neck-unmeasurable',
     `The hanging loop's neck could not be measured on the exported geometry (${message}). An unmeasured neck is not an acceptable neck — this blocks the export.`)),
   );
 if(poisoned.has(loopGroupId))
  findings.push(finding('minimum-width','error','neck-unmeasurable',
   `The hanging loop's neck could not be measured because the ${loopPieceName} geometry contains non-finite coordinates. An unmeasured neck is not an acceptable neck — this blocks the export.`));
 else if(!neck.attachedAtAll)
  findings.push(finding('minimum-width','error','loop-detached-in-export',
   `The exported ${loopPieceName} geometry does not join the hanging loop to the ornament body at all. The loop would cut as a loose ring.`));
 else if(!neck.meetsMinimum)
  findings.push(finding('minimum-width','error','loop-neck-too-narrow-in-export',
   `The exported ${loopPieceName} joins the hanging loop to the body over only ${neck.measuredMm.toFixed(2)}mm, below the ${neck.requiredMm}mm minimum neck width. Measured on the cut geometry itself. At this width the loop snaps off the finished ornament — increase the loop overlap, widen the loop, or lower the minimum if that is genuinely wanted.`));
 // A wide gap between what the parameters predict and what the polygon measures means one of the two
 // is describing geometry that is not there. Worth saying even when both pass, because the next edit
 // in that direction is the one that fails.
 if(neck.attachedAtAll&&!neck.saturated&&neck.analyticNeckMm>0&&neck.measuredMm<neck.analyticNeckMm*.5)
  findings.push(finding('minimum-width','warning','neck-measurement-disagrees',
   `The loop's dimensions predict about ${neck.analyticNeckMm.toFixed(2)}mm of connecting material, but the exported geometry measures ${neck.measuredMm.toFixed(2)}mm. The ${loopPieceName} polygon is not the shape its parameters describe — treat the measured figure as the real one and check the ${loopPieceName} before cutting.`));

 let measuredMinFeatureWidthMm=minWidthMm;
 for(const group of groups.filter(isCutGroup)){
  if(!group.geometry.length||poisoned.has(group.id))continue;
  const thin=guard(
   ()=>thinFeatures(group.geometry,minWidthMm),
   {geometry:[],areaMm2:0,regions:0,minWidthMm},
   message=>findings.push(finding('minimum-width','error','width-check-failed',
    `${group.id} could not be checked for sub-minimum-width features (${message}). The geometry is malformed in a way the boolean engine cannot process.`)),
  );
  if(thin.regions>0){
   measuredMinFeatureWidthMm=0;
   // The frame is structural in both modes (it is one ring holding the text band), and in water-cutout
   // mode the backing is too, because the ornament now hangs from it.
   const structural=group.id==='piece/frame/cut'||group.id===loopGroupId;
   const severity:PreflightSeverity=structural?'error':'warning';
   const structuralNote=group.id==='piece/frame/cut'?' On the frame that is structural.':' On the backing, which carries the hanging loop, that is structural.';
   findings.push(finding('minimum-width',severity,'feature-below-minimum-width',
    `${group.id} has ${thin.regions} region(s) totalling ${round(thin.areaMm2)}mm² narrower than the ${minWidthMm}mm minimum feature width.${severity==='error'?structuralNote:' These are usually thin peninsulas or spits; they are fragile but cuttable.'}`,
    thin.geometry[0]?.[0]?.length?[round(thin.geometry[0][0][0][0]),round(thin.geometry[0][0][0][1])]:undefined));
  }
 }

 // 7 — text overflow. These are warnings inside the editor, where the user is still moving things
 // around. At export they block: text wider than the chord it sits on runs off the text band and
 // engraves across the map window or past the rim.
 for(const issue of textLayout.issues){
  if(issue.code==='text-overflows-band'||issue.code==='text-line-too-wide')
   findings.push(finding('text-overflow','error',issue.code,`${issue.message} Use "Fit text to band", or shorten the line.`));
  else if(issue.severity==='error')
   findings.push(finding('text-overflow','error',issue.code,issue.message));
 }

 // Findings carried in from earlier stages, so one report covers the whole pipeline. Severity is
 // preserved rather than downgraded: an error raised during layout blocks the export exactly as an
 // error raised here does.
 for(const issue of [...pieces.warnings,...(featureGeometry?.warnings??[])])
  findings.push(finding(checkForCode(issue.code),issue.severity,issue.code,issue.message));

 return {
  blocked:findings.some(item=>item.severity==='error'),
  findings,
  checksRun:[...PREFLIGHT_CHECKS],
  neck,
  finishedDiameterMm,
  measuredMinFeatureWidthMm,
 };
}

export const preflightSummary=(report:PreflightReport):string=>{
 const errors=report.findings.filter(item=>item.severity==='error').length;
 const warnings=report.findings.length-errors;
 if(errors)return `${errors} problem${errors===1?'':'s'} must be fixed before this can be exported${warnings?` (and ${warnings} warning${warnings===1?'':'s'})`:''}.`;
 return warnings
  ?`Preflight passed with ${warnings} warning${warnings===1?'':'s'} · ${neckSummary(report.neck)}.`
  :`Preflight passed all ${report.checksRun.length} checks · ${neckSummary(report.neck)}.`;
};
