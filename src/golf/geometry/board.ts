import type * as opentype from 'opentype.js';
import type {MultiPolygonMm,PolygonMm} from '../../geometry/shoreline/polygonEngine';
import {clipLinesToArea,type LineMm} from '../../geometry/terrain/contourLines';
import {dilateGeometry,erodeGeometry} from '../../ornament/export/morphology';
import {offsetPaths} from '../../ornament/geometry/offsetPaths';
import {polylineLengthMm} from '../../ornament/geometry/clipLine';
import type {GolfSnapshot,LonLat} from '../../server/golf/types';
import {textPathData} from '../../text/textVector';
import type {FontId} from '../../types/project';
import {boardPar,numberedHoles,type NumberedHole} from '../holes';
import {GOLF_MARKS,type GolfProject} from '../types';
import {fitCourse,type BoardFit} from './fit';
import {area,boundsOf,centroidOf,circle,difference,intersect,outlines,pointIn,projectLine,projectPolygons,rect,tidy,union} from './ops';
import {GolfFontError,layoutTitle,type TitleLayoutResult,type TitleValues} from './titleBlock';

// The golf board as it will be cut (docs/GOLF_MODULE_PLAN.md §5): three sheets, bottom to top, each
// the whole board in place, in board millimetres.
//
//   L0 floor           the solid backing, cut as the board rectangle. Water shows through the ground
//                      sheet's openings onto it, so the water is engraved here.
//   L1 ground          the course: its OSM boundary inside the margin, with the water cut out.
//   L2 surface pieces  fairways and greens, cut as separate pieces glued onto the ground. A green that
//                      touches its fairway is one piece with it; its inset and collar mark the edge.
//
// Marks on the visible surface (§5.1) — bunkers, tees, cart paths, streams, routing, the greens'
// inset and collar, hole numbers — are not sheets. Each is cut up by the exposed regions
//
//     exposed(2) = surface,  exposed(1) = ground − surface,  exposed(0) = floor − ground
//
// and every part goes on the sheet it can be seen on. The three exposed regions tile the board and do
// not overlap, so a mark is never burned onto material that a higher sheet then covers, and never
// burned across a step between sheets. Preflight checks both from the emitted geometry.

export type GolfOperation='cut'|'score'|'engrave';
export type GolfGroupId=
 |'cut/outline'|'cut/pieces'
 |'engrave/water'|'engrave/bunkers'|'engrave/tees'|'engrave/greens'|'engrave/cartpaths'|'engrave/streams'|'engrave/routing'|'engrave/hole-numbers'|'engrave/title'
 |'score/bunkers'|'score/tees'|'score/collars'|'score/cartpaths'|'score/streams'|'score/routing'|'score/hole-badges';

// The stable group order of every sheet's SVG: the fabrication contract.
export const GOLF_GROUP_ORDER:readonly GolfGroupId[]=[
 'cut/outline','cut/pieces',
 'engrave/water','engrave/bunkers','engrave/tees','engrave/greens','engrave/cartpaths','engrave/streams','engrave/routing','engrave/hole-numbers','engrave/title',
 'score/bunkers','score/tees','score/collars','score/cartpaths','score/streams','score/routing','score/hole-badges',
];
export const groupOperation=(id:GolfGroupId):GolfOperation=>id.split('/')[0] as GolfOperation;

export interface GolfGlyph{d:string;name:string;boxMm:{minX:number;minY:number;maxX:number;maxY:number}}
export interface GolfGroup{id:GolfGroupId;operation:GolfOperation;geometry:MultiPolygonMm;lines:LineMm[];glyphs:GolfGlyph[]}
export interface GolfPiece{tag:string;geometry:PolygonMm;areaMm2:number;centroidMm:[number,number]}
export type GolfSheetRole='floor'|'ground'|'surface-pieces';
export interface GolfSheet{index:number;role:GolfSheetRole;name:string;material:MultiPolygonMm;exposed:MultiPolygonMm;pieces:GolfPiece[];groups:GolfGroup[]}
export interface PlacedBadge{holeId:string;label:string;centerMm:[number,number];radiusMm:number;sheet:number}
export interface GolfWarning{code:string;message:string}

export interface GolfBoard{
 widthMm:number;
 heightMm:number;
 fit:Pick<BoardFit,'rotationDeg'|'mmPerMetre'|'scaleDenominator'|'coverageM'>;
 holes:NumberedHole[];
 badges:PlacedBadge[];
 par?:number;
 title?:TitleLayoutResult;
 sheets:GolfSheet[];
 // The board-space geometry the sheets were built from, for the preview and for tests: the course
 // inside the margin, its water, and its greens.
 features:{course:MultiPolygonMm;water:MultiPolygonMm;greens:MultiPolygonMm};
 warnings:GolfWarning[];
}

export interface GolfBoardInput{project:GolfProject;snapshot:GolfSnapshot;font:(id:FontId)=>opentype.Font|undefined}

const SHEETS:{role:GolfSheetRole;name:string}[]=[{role:'floor',name:'Floor'},{role:'ground',name:'Ground'},{role:'surface-pieces',name:'Surface pieces'}];
const CORNERS=['bottom-left','bottom-right','top-left','top-right'] as const;
// Parts of a mark shorter or smaller than this are float residue from the booleans, not marks.
const MIN_LINE_MM=.05,MIN_AREA_MM2=.01;

// "Mid Vallee Golf Course, De Pere, Wisconsin, United States" → "De Pere, Wisconsin". Works for
// Photon's short labels and Nominatim's long ones: house numbers, counties, postcodes and the
// country go, and the last two parts left are the town and the state.
export function locationFromLabel(label:string,name?:string):string{
 const parts=label.split(',').map(s=>s.trim()).filter(Boolean);
 const rest=(name&&parts[0]===name?parts.slice(1):parts.slice(1)).filter(p=>!/^\d[\d -]*$/.test(p)&&!/ County$/i.test(p)&&!/^(United States|USA|US)$/i.test(p));
 return rest.slice(-2).join(', ');
}

export function titleValues(snapshot:GolfSnapshot,project:GolfProject,par?:number):TitleValues{
 const name=snapshot.course.name??project.course?.label.split(',')[0]?.trim()??'';
 const location=snapshot.course.city?[snapshot.course.city,snapshot.course.state].filter(Boolean).join(', '):locationFromLabel(project.course?.label??'',name);
 return {name,location,par:par!==undefined?String(par):''};
}

function sortedPieces(geometry:MultiPolygonMm,prefix:string):GolfPiece[]{
 const pieces=geometry.map(polygon=>({geometry:polygon,areaMm2:area([polygon]),centroidMm:centroidOf(polygon)}));
 pieces.sort((a,b)=>Math.round(a.centroidMm[1])-Math.round(b.centroidMm[1])||a.centroidMm[0]-b.centroidMm[0]);
 const width=Math.max(2,String(pieces.length).length);
 return pieces.map((p,i)=>({tag:`${prefix}${String(i+1).padStart(width,'0')}`,...p}));
}

type MarkSpec={group:GolfGroupId;area?:MultiPolygonMm;lines?:LineMm[]};
const longEnough=(lines:LineMm[])=>lines.filter(l=>l.length>=2&&polylineLengthMm(l)>=MIN_LINE_MM);

export function buildGolfBoard({project,snapshot,font}:GolfBoardInput):GolfBoard{
 const {widthMm:W,heightMm:H,marginMm}=project.board;
 const warnings:GolfWarning[]=[];
 const holes=numberedHoles(snapshot,project.nines);
 const par=boardPar(holes);
 const values=titleValues(snapshot,project,par);

 // A header title reserves its strip before the course is fitted, so the two never meet.
 const header=project.title.layout==='header'?layoutTitle({title:project.title,values,font,widthMm:W,heightMm:H,marginMm}):undefined;
 const reserveTopMm=header?header.box.height+Math.max(3,project.title.sizeMm*.4):0;
 const outline:LonLat[]=snapshot.boundary.flatMap(polygon=>polygon[0]);
 const [w,s,e,n]=snapshot.bbox;
 const fit=fitCourse({outline,center:[(w+e)/2,(s+n)/2],board:project.board,reserveTopMm});
 const project_=fit.project;

 const floor=rect(0,0,W,H);
 const content=rect(fit.content.x,fit.content.y,fit.content.width,fit.content.height);
 let course=intersect(union([projectPolygons(snapshot.boundary,project_)]),content);

 // A corner title goes where the course leaves the most room, and the course gives way to it.
 let title=header;
 if(project.title.layout==='corner'){
  let best:{layout:TitleLayoutResult;overlap:number}|undefined;
  for(const corner of CORNERS){
   const layout=layoutTitle({title:project.title,values,font,widthMm:W,heightMm:H,marginMm,corner});
   if(!layout)break;
   const overlap=area(intersect(course,rect(layout.box.x,layout.box.y,layout.box.width,layout.box.height)));
   if(!best||overlap<best.overlap-1e-6)best={layout,overlap};
  }
  title=best?.layout;
  if(title&&best!.overlap>MIN_AREA_MM2){
   const pad=2,box=title.box;
   const keepOut=rect(box.x-pad,box.y-pad,box.width+2*pad,box.height+2*pad);
   const trimmed=area(intersect(course,keepOut));
   course=difference(course,keepOut);
   warnings.push({code:'title-trimmed-course',message:`The corner title overlaps the course, so ${trimmed.toFixed(0)} mm² of the course was trimmed away under it. Use the header layout to keep the whole course.`});
  }
 }
 if(title)warnings.push(...title.warnings);
 course=tidy(course,'Course outline').geometry;
 if(!course.length)throw new Error('The course outline is empty on this board.');

 const areasOf=(role:string)=>union(snapshot.areas.filter(a=>a.role===role).map(a=>projectPolygons(a.geometry,project_)));
 const water=intersect(areasOf('water'),course);
 const ground=tidy(difference(course,water),'Ground',.5,.1).geometry;
 const greens=intersect(areasOf('green'),ground);
 const surface=tidy(intersect(union([areasOf('fairway'),greens]),ground),'Surface pieces',.5,.1).geometry;
 const exposed=[difference(floor,ground),difference(ground,surface),surface];
 const materials=[floor,ground,surface];

 // Marks, from the bottom of the plan's §5.1 list up. Area marks to be scored become outlines first,
 // so that only the feature's own edge is scored, never the edge of a sheet it happens to cross.
 const marks:MarkSpec[]=[];
 const clipLines=(lines:LineMm[],to:MultiPolygonMm)=>lines.length&&to.length?clipLinesToArea(lines,to):[];
 const areaMark=(op:GolfProject['marks']['bunkers'],name:'bunkers'|'tees',geometry:MultiPolygonMm)=>{
  if(op==='none'||!geometry.length)return;
  const inside=intersect(geometry,course);
  if(op==='engrave')marks.push({group:`engrave/${name}`,area:inside});
  else marks.push({group:`score/${name}`,lines:clipLines(outlines(geometry),course)});
 };
 const lineMark=(op:GolfProject['marks']['bunkers'],name:'cartpaths'|'streams'|'routing',lines:LineMm[])=>{
  if(op==='none'||!lines.length)return;
  const inside=clipLines(lines,course);
  if(op==='score')marks.push({group:`score/${name}`,lines:inside});
  else marks.push({group:`engrave/${name}`,area:intersect(offsetPaths(inside,GOLF_MARKS.engravedLineWidthMm/2,{endStyle:'open-round'}),course)});
 };
 if(project.marks.floorWater==='engrave'&&water.length)marks.push({group:'engrave/water',area:water});
 areaMark(project.marks.bunkers,'bunkers',areasOf('bunker'));
 areaMark(project.marks.tees,'tees',areasOf('tee'));
 lineMark(project.marks.cartpaths,'cartpaths',snapshot.lines.filter(l=>l.role==='cartpath').map(l=>projectLine(l.coordinates,project_)));
 lineMark(project.marks.streams,'streams',snapshot.lines.filter(l=>l.role==='stream').map(l=>projectLine(l.coordinates,project_)));
 if(project.marks.greenInset&&greens.length)marks.push({group:'engrave/greens',area:erodeGeometry(greens,GOLF_MARKS.greenInsetMm)});
 if(project.marks.greenCollar&&greens.length)marks.push({group:'score/collars',lines:clipLines(outlines(dilateGeometry(greens,GOLF_MARKS.greenCollarMm)),course)});
 // Routing runs tee to green and stops short of every green it crosses.
 const greenGap=greens.length?dilateGeometry(greens,GOLF_MARKS.routingGreenGapMm):[];
 lineMark(project.marks.routing,'routing',clipLines(holes.map(h=>projectLine(h.hole.line,project_)),difference(content,greenGap)));

 const sheets:GolfSheet[]=SHEETS.map((sheet,index)=>({index,...sheet,material:materials[index],exposed:exposed[index],pieces:[],groups:[]}));
 const groupOf=(sheet:GolfSheet,id:GolfGroupId)=>{
  let g=sheet.groups.find(x=>x.id===id);
  if(!g){g={id,operation:groupOperation(id),geometry:[],lines:[],glyphs:[]};sheet.groups.push(g)}
  return g;
 };
 for(const mark of marks){
  for(let k=2;k>=0;k--){
   const sheet=sheets[k];
   if(mark.area){
    const part=tidy(intersect(mark.area,exposed[k]),mark.group,MIN_AREA_MM2,MIN_AREA_MM2).geometry;
    if(part.length)groupOf(sheet,mark.group).geometry.push(...part);
   }else if(mark.lines){
    const part=longEnough(clipLines(mark.lines,exposed[k]));
    if(part.length)groupOf(sheet,mark.group).lines.push(...part);
   }
  }
 }

 // Hole numbers (§5.1): a small scored ring with the number engraved in it, near the tee, wholly on
 // one exposed region, clear of greens and of every other badge.
 const badges:PlacedBadge[]=[];
 if(project.marks.holeNumbers&&holes.length){
  const inter=font('inter');
  if(!inter)throw new GolfFontError('inter');
  const r=GOLF_MARKS.badgeDiameterMm/2;
  const greensClear=greens.length?dilateGeometry(greens,.5):[];
  const inContent=([x,y]:[number,number])=>x-r>=fit.content.x&&x+r<=fit.content.x+fit.content.width&&y-r>=fit.content.y&&y+r<=fit.content.y+fit.content.height;
  for(const {hole,label} of holes){
   const tee=project_(hole.tee),next=project_(hole.line[1]);
   const back=Math.atan2(tee[1]-next[1],tee[0]-next[0]);
   let placed:PlacedBadge|undefined;
   search:for(const distance of [r+1,r+3,r+6,r+10]){
    for(const turn of [0,30,-30,60,-60,90,-90,120,-120,150,-150,180]){
     const a=back+turn*Math.PI/180;
     const c:[number,number]=[tee[0]+distance*Math.cos(a),tee[1]+distance*Math.sin(a)];
     if(!inContent(c))continue;
     if(badges.some(b=>Math.hypot(b.centerMm[0]-c[0],b.centerMm[1]-c[1])<2*r+1))continue;
     const samples:[number,number][]=[c,...Array.from({length:16},(_,i)=>[c[0]+(r+.4)*Math.cos(i*Math.PI/8),c[1]+(r+.4)*Math.sin(i*Math.PI/8)] as [number,number])];
     if(samples.some(p=>pointIn(p,greensClear)))continue;
     const k=[2,1,0].find(k=>samples.every(p=>pointIn(p,exposed[k])));
     if(k===undefined)continue;
     const disc=[circle(c[0],c[1],r+.2)];
     if(area(intersect(disc,exposed[k]))<area(disc)*.995)continue;
     placed={holeId:hole.id,label,centerMm:c,radiusMm:r,sheet:k};
     break search;
    }
   }
   if(!placed){warnings.push({code:'badge-unplaced',message:`Hole ${label} has no room for its number near the tee (no clear spot off the greens and off every step between sheets). It is left off the board.`});continue}
   badges.push(placed);
   const sheet=sheets[placed.sheet];
   groupOf(sheet,'score/hole-badges').lines.push(outlines([circle(placed.centerMm[0],placed.centerMm[1],r)])[0]);
   let size=GOLF_MARKS.badgeNumberSizeMm;
   let local=textPathData(inter,label,size,'center');
   const maxWidth=2*r-1.4;
   if(local.bounds.maxX-local.bounds.minX>maxWidth){size*=maxWidth/(local.bounds.maxX-local.bounds.minX);local=textPathData(inter,label,size,'center')}
   const baseline=placed.centerMm[1]-(local.bounds.minY+local.bounds.maxY)/2;
   const glyph=textPathData(inter,label,size,'center',placed.centerMm[0],baseline);
   groupOf(sheet,'engrave/hole-numbers').glyphs.push({d:glyph.d,name:`hole-${label}`,boxMm:{minX:placed.centerMm[0]+local.bounds.minX,minY:baseline+local.bounds.minY,maxX:placed.centerMm[0]+local.bounds.maxX,maxY:baseline+local.bounds.maxY}});
  }
 }

 if(title){
  const box={minX:title.box.x,minY:title.box.y,maxX:title.box.x+title.box.width,maxY:title.box.y+title.box.height};
  for(const glyph of title.glyphs)groupOf(sheets[0],'engrave/title').glyphs.push({...glyph,boxMm:box});
 }

 // The cut groups, always present on their sheets.
 groupOf(sheets[0],'cut/outline').geometry.push(...floor);
 sheets[1].pieces=sortedPieces(ground,'G');
 sheets[2].pieces=sortedPieces(surface,'S');
 for(const sheet of sheets.slice(1))groupOf(sheet,'cut/pieces').geometry.push(...sheet.pieces.map(p=>p.geometry));
 for(const sheet of sheets)sheet.groups.sort((a,b)=>GOLF_GROUP_ORDER.indexOf(a.id)-GOLF_GROUP_ORDER.indexOf(b.id));

 if(sheets[1].pieces.length>1)warnings.push({code:'ground-pieces',message:`The ground is ${sheets[1].pieces.length} separate pieces (water or the board edge splits the course). Each is glued onto the floor where it sits; the manifest lists them.`});
 if(!surface.length)warnings.push({code:'no-surface',message:'No fairways or greens fall inside the course on this board, so there are no surface pieces.'});
 const b=boundsOf(course);
 if(b.minX<0||b.minY<0||b.maxX>W||b.maxY>H)warnings.push({code:'course-outside-board',message:'Part of the course lies outside the board.'});

 return {
  widthMm:W,heightMm:H,
  fit:{rotationDeg:fit.rotationDeg,mmPerMetre:fit.mmPerMetre,scaleDenominator:fit.scaleDenominator,coverageM:fit.coverageM},
  holes,badges,...(par!==undefined?{par}:{}),...(title?{title}:{}),
  sheets,features:{course,water,greens},warnings,
 };
}
