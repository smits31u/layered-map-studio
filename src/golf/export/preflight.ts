import type {MultiPolygonMm} from '../../geometry/shoreline/polygonEngine';
import {clipLinesToArea} from '../../geometry/terrain/contourLines';
import {thinFeatures} from '../../ornament/export/morphology';
import {ABSOLUTE_MIN_PIECE_AREA_MM2,geometryHasNonFinite,pathHasNonFinite,pathSubpathsAreClosed,ringIsClosed,ringSelfIntersects} from '../../ornament/export/preflight';
import {polylineLengthMm} from '../../ornament/geometry/clipLine';
import type {GolfSnapshot} from '../../server/golf/types';
import {coverageCleared,coverageReport} from '../coverage';
import type {GolfBoard} from '../geometry/board';
import {area,difference,intersect,pointIn,rect} from '../geometry/ops';
import {SMALL_PIECE_AREA_MM2,SURFACE_PIECE_CAP,SURFACE_PIECE_WARN,type GolfProject} from '../types';

// Golf preflight (docs/GOLF_MODULE_PLAN.md §7): the topo builder's discipline, run on the sheets
// exactly as they are about to be serialised. An error blocks: there is no ZIP at all. A warning is
// geometry somebody should look at; it exports.
//
// The shared checks reuse the ornament's checkers (closed rings and subpaths, the self-intersection
// sweep, the non-finite scans, the morphological thin-feature test). The golf checks are the plan's:
// every surface piece is tagged, no mark falls outside its exposed region, piece counts under the
// caps; plus the coverage gate, so an unconfirmed blocking gap cannot reach the laser through export.

export type GolfPreflightCheckId='dimensions'|'open-cut-paths'|'self-intersections'|'non-finite'|'tiny-pieces'|'minimum-width'|'pieces-tagged'|'marks-exposed'|'piece-caps'|'coverage'|'attribution'|'design';
export const GOLF_PREFLIGHT_CHECKS:readonly GolfPreflightCheckId[]=['dimensions','open-cut-paths','self-intersections','non-finite','tiny-pieces','minimum-width','pieces-tagged','marks-exposed','piece-caps','coverage','attribution','design'];
export interface GolfPreflightFinding{check:GolfPreflightCheckId;severity:'error'|'warning';code:string;message:string;sheet?:number}
export interface GolfPreflightReport{blocked:boolean;findings:GolfPreflightFinding[];checksRun:GolfPreflightCheckId[]}

export const BOARD_TOLERANCE_MM=.1;
// A surface piece narrower than this somewhere is fragile to glue; it is a warning, not an error.
export const MIN_PIECE_WIDTH_MM=1;
// How much of a mark may sit outside its exposed region before it is an error: boolean rounding on
// a 0.001 mm grid leaves slivers far below this.
const EXPOSED_SLACK_MM2=.05,EXPOSED_LINE_SLACK=.01;

export function runGolfPreflight({board,snapshot,project}:{board:GolfBoard;snapshot:GolfSnapshot;project:GolfProject}):GolfPreflightReport{
 const findings:GolfPreflightFinding[]=[];
 const add=(f:GolfPreflightFinding)=>findings.push(f);
 const {widthMm:W,heightMm:H}=board;
 const within=rect(-BOARD_TOLERANCE_MM,-BOARD_TOLERANCE_MM,W+2*BOARD_TOLERANCE_MM,H+2*BOARD_TOLERANCE_MM);

 if(!(W>0&&H>0&&Number.isFinite(W)&&Number.isFinite(H)))add({check:'dimensions',severity:'error',code:'bad-board-size',message:`The board size ${W} × ${H} mm is not a real size.`});
 if(W!==project.board.widthMm||H!==project.board.heightMm)add({check:'dimensions',severity:'error',code:'board-size-changed',message:'The board was built for a different size than is set now. Build it again.'});

 for(const sheet of board.sheets){
  const L=`L${sheet.index} ${sheet.name}`;
  for(const group of sheet.groups){
   if(group.geometry.length&&area(difference(group.geometry,within))>EXPOSED_SLACK_MM2)add({check:'dimensions',severity:'error',code:'outside-board',sheet:sheet.index,message:`${L}: ${group.id} reaches outside the board.`});
   if(geometryHasNonFinite(group.geometry)||group.lines.some(l=>l.some(([x,y])=>!Number.isFinite(x)||!Number.isFinite(y)))||group.glyphs.some(g=>pathHasNonFinite(g.d)))
    add({check:'non-finite',severity:'error',code:'non-finite',sheet:sheet.index,message:`${L}: ${group.id} has a coordinate that is not a number.`});
   if(group.operation==='cut'){
    for(const polygon of group.geometry)for(const ring of polygon){
     if(!ringIsClosed(ring)){add({check:'open-cut-paths',severity:'error',code:'open-ring',sheet:sheet.index,message:`${L}: a cut path in ${group.id} is not closed.`});continue}
     const at=ringSelfIntersects(ring);
     if(at)add({check:'self-intersections',severity:'error',code:'self-intersection',sheet:sheet.index,message:`${L}: a cut path in ${group.id} crosses itself near ${at[0]}, ${at[1]} mm.`});
    }
   }
   for(const glyph of group.glyphs)if(group.operation!=='engrave'&&!pathSubpathsAreClosed(glyph.d))add({check:'open-cut-paths',severity:'error',code:'open-glyph',sheet:sheet.index,message:`${L}: a glyph in ${group.id} is not closed.`});

   // Marks stay inside the region of this sheet that can be seen from above.
   if(group.id.startsWith('cut/'))continue;
   if(group.geometry.length){
    const outside=area(difference(group.geometry,sheet.exposed));
    if(outside>EXPOSED_SLACK_MM2+area(group.geometry)*.001)add({check:'marks-exposed',severity:'error',code:'mark-not-exposed',sheet:sheet.index,message:`${L}: ${outside.toFixed(2)} mm² of ${group.id} lies under a higher sheet or across a step.`});
   }
   if(group.lines.length){
    const total=group.lines.reduce((s,l)=>s+polylineLengthMm(l),0);
    const inside=clipLinesToArea(group.lines,sheet.exposed).reduce((s,l)=>s+polylineLengthMm(l),0);
    if(total-inside>Math.max(.1,total*EXPOSED_LINE_SLACK))add({check:'marks-exposed',severity:'error',code:'line-not-exposed',sheet:sheet.index,message:`${L}: ${(total-inside).toFixed(1)} mm of ${group.id} lies under a higher sheet or across a step.`});
   }
   for(const glyph of group.glyphs){
    const b=glyph.boxMm,corners:[number,number][]=[[b.minX,b.minY],[b.maxX,b.minY],[b.maxX,b.maxY],[b.minX,b.maxY]];
    if(!corners.every(p=>pointIn(p,sheet.exposed)))add({check:'marks-exposed',severity:'error',code:'glyph-not-exposed',sheet:sheet.index,message:`${L}: the text "${glyph.name}" in ${group.id} crosses a step between sheets.`});
   }
  }

  // Pieces: every cut piece tagged, uniquely, and large enough to survive the bed and the glue-up.
  const cutPieces=sheet.groups.find(g=>g.id==='cut/pieces');
  if(sheet.index>0){
   const tags=sheet.pieces.map(p=>p.tag);
   if(!cutPieces||cutPieces.geometry.length!==sheet.pieces.length||tags.some(t=>!t)||new Set(tags).size!==tags.length)
    add({check:'pieces-tagged',severity:'error',code:'untagged-piece',sheet:sheet.index,message:`${L}: every piece must carry one unique tag (${tags.length} tags for ${cutPieces?.geometry.length??0} pieces).`});
   for(const piece of sheet.pieces){
    if(piece.areaMm2<ABSOLUTE_MIN_PIECE_AREA_MM2)add({check:'tiny-pieces',severity:'error',code:'piece-too-small',sheet:sheet.index,message:`${L}: piece ${piece.tag} is ${piece.areaMm2.toFixed(2)} mm², small enough to fall through the bed.`});
    else if(piece.areaMm2<SMALL_PIECE_AREA_MM2)add({check:'tiny-pieces',severity:'warning',code:'piece-small',sheet:sheet.index,message:`${L}: piece ${piece.tag} is only ${piece.areaMm2.toFixed(1)} mm²; it will be fiddly to glue.`});
   }
  }
 }

 const surface=board.sheets.find(s=>s.role==='surface-pieces');
 if(surface){
  const thin=thinFeatures(surface.material as MultiPolygonMm,MIN_PIECE_WIDTH_MM);
  if(thin.regions)add({check:'minimum-width',severity:'warning',code:'thin-surface',sheet:surface.index,message:`${thin.regions} part${thin.regions===1?'':'s'} of the surface pieces (${thin.areaMm2.toFixed(1)} mm² in all) ${thin.regions===1?'is':'are'} narrower than ${MIN_PIECE_WIDTH_MM} mm and may break when lifted.`});
  const count=surface.pieces.length;
  if(count>SURFACE_PIECE_CAP)add({check:'piece-caps',severity:'error',code:'too-many-pieces',sheet:surface.index,message:`${count} surface pieces is over the ${SURFACE_PIECE_CAP}-piece cap. Choose a smaller part of the course or a larger board.`});
  else if(count>SURFACE_PIECE_WARN)add({check:'piece-caps',severity:'warning',code:'many-pieces',sheet:surface.index,message:`${count} surface pieces to glue. That is a long glue-up.`});
  // The surface pieces sit on the ground; none may reach past it.
  const ground=board.sheets.find(s=>s.role==='ground');
  if(ground&&area(difference(surface.material,ground.material))>EXPOSED_SLACK_MM2)add({check:'marks-exposed',severity:'error',code:'piece-overhangs',sheet:surface.index,message:'A surface piece reaches past the ground it is glued to.'});
 }
 // What a sheet shows must not be covered by any sheet above it.
 for(const lower of board.sheets)for(const upper of board.sheets.filter(s=>s.index>lower.index)){
  const covered=area(intersect(lower.exposed,upper.material));
  if(covered>EXPOSED_SLACK_MM2)add({check:'marks-exposed',severity:'error',code:'exposed-covered',sheet:lower.index,message:`${covered.toFixed(2)} mm² of what L${lower.index} ${lower.name} shows is covered by L${upper.index} ${upper.name}.`});
 }

 const coverage=coverageReport(snapshot);
 if(!coverageCleared(coverage,project.coverageConfirmedFor))add({check:'coverage',severity:'error',code:'coverage-unconfirmed',message:`OpenStreetMap's map of this course has gaps (${coverage.findings.filter(f=>f.level==='blocking').map(f=>f.code).join(', ')}). Confirm them in Coverage before exporting.`});
 if(!snapshot.attribution)add({check:'attribution',severity:'error',code:'no-attribution',message:'The course data has no attribution; it cannot be exported.'});
 for(const w of board.warnings)add({check:'design',severity:'warning',code:w.code,message:w.message});

 return {blocked:findings.some(f=>f.severity==='error'),findings,checksRun:[...GOLF_PREFLIGHT_CHECKS]};
}

export function golfPreflightSummary(report:GolfPreflightReport):string{
 const errors=report.findings.filter(f=>f.severity==='error').length,warnings=report.findings.length-errors;
 if(report.blocked)return `Preflight blocked the export: ${errors} error${errors===1?'':'s'}${warnings?` and ${warnings} warning${warnings===1?'':'s'}`:''}.`;
 return warnings?`Preflight passed with ${warnings} warning${warnings===1?'':'s'}.`:'Preflight passed.';
}
