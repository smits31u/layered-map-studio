import type {MultiPolygonMm} from '../../geometry/shoreline/polygonEngine';
import {getLoadedFont} from '../../text/fontRegistry';
import {textPathData} from '../../text/textVector';
import {ARC_TOLERANCE_MM,circle} from '../geometry/circle';
import type {FeatureGeometryResult} from '../geometry/featureGeometry';
import type {OrnamentGeometry,OrnamentIssue} from '../geometry/ornamentShape';
import {normalizeTopology,unionAll} from '../geometry/polygonRepair';
import type {OrnamentTextLayout} from '../text/ornamentText';
import type {BuildMode,OrnamentProject} from '../types';
import {translatePathData,type BoundsMm} from './pathTransform';

// Turning the ornament into physical pieces on a sheet, and sorting every piece of geometry into the
// semantic groups the export contract names.
//
// ## The groups are the contract
//
// `ORNAMENT_GROUP_ORDER` is reproduced verbatim from the plan's list and is the authoritative part of
// the output. Colour is a convenience preset layered on top (see `lightburn.ts`); a consumer that
// reads the group ids gets the right answer whatever preset was chosen, and a consumer that reads
// only colour is relying on the convenience.
//
// Two of the nine are mode-specific, exactly as the list says: `piece/base/water-light-engrave` is
// classic only, because in water-cutout mode the water is removed rather than shaded, and
// `piece/land/cut` is three-piece only, because in classic mode there is no separate land piece.
// Every group that *does* apply to the current mode is emitted even when it is empty, so a missing
// group means "not applicable to this build mode" and never "applicable but happened to be empty" —
// an importer or an operator can tell those apart without knowing the mode.
//
// `piece/land/roads-engrave` carries roads in both modes, which reads oddly in classic mode where
// the roads engrave onto the base piece rather than onto a land piece. The group list is the
// contract and it has one group for roads, so roads go in it in both modes; `data-piece` on the
// group says which physical piece it belongs to. Phase 3 already named the field `roadsEngrave` and
// the preview already rendered it under this id in both modes, so this keeps one name end to end.
//
// ## Absolute coordinates, no transforms
//
// Pieces are laid out left to right and every path is written in final sheet millimetres. Nothing
// relies on a `transform` attribute — see `pathTransform.ts` for why that matters on a cutter.

export const ORNAMENT_GROUP_ORDER=[
 'piece/base/cut',
 'piece/base/water-light-engrave',
 'piece/land/cut',
 'piece/land/roads-engrave',
 'piece/frame/cut',
 'piece/frame/text-engrave',
 'registration/optional',
 'labels/non-production',
] as const;

export type OrnamentGroupId=typeof ORNAMENT_GROUP_ORDER[number];

// 'marker' was a fourth piece until the generator stopped producing a marker at all; markers are
// now added by hand in the laser software, per order.
export type PieceId='base'|'land'|'frame';

// `engrave-light` is a distinct operation rather than an engrave with a different colour, because it
// is a distinct machine setting: the water shading on a classic ornament is a shallow raster pass at
// a fraction of the power the roads get. Merging it into `engrave` would lose that at the one point
// where the file has to carry it.
export type ExportOperation='cut'|'engrave'|'engrave-light'|'annotation';

export interface PlacedPiece{
 id:PieceId;
 label:string;
 // Cut geometry in the piece's own space: ornament centred at (0,0), +y downward.
 cutLocal:MultiPolygonMm;
 localBounds:BoundsMm;
 offsetMm:[number,number];
}

export interface ExportGroup{
 id:OrnamentGroupId;
 piece:PieceId;
 operation:ExportOperation;
 // Polygon geometry, already in sheet millimetres.
 geometry:MultiPolygonMm;
 // Path data, already in sheet millimetres. Glyph outlines arrive as strings and stay strings; they
 // are never re-traced into polygons, so a curve stays a curve in the output.
 paths:string[];
 // False for anything that must not reach the machine as material: registration aids and labels.
 production:boolean;
 applicable:boolean;
}

export interface OrnamentSheet{widthMm:number;heightMm:number;marginMm:number;gapMm:number;labelBandMm:number}

export interface OrnamentPieceSet{
 buildMode:BuildMode;
 pieces:PlacedPiece[];
 groups:ExportGroup[];
 sheet:OrnamentSheet;
 // Measured from the emitted base-piece geometry, not from the setting. The exit criterion is about
 // what comes out of the file, so this is what the dimension preflight check compares.
 finishedDiameterMm:number;
 warnings:OrnamentIssue[];
}

export const PIECE_GAP_MM=6;
export const SHEET_MARGIN_MM=2;
export const LABEL_BAND_MM=6;
export const LABEL_SIZE_MM=3;
export const REGISTRATION_DOT_DIAMETER_MM=.8;
// 45/135/225/315 rather than the compass points: the vertical pair would sit on the loop's axis and
// under the middle of the text block, which are the two places on the ornament most likely to be
// occupied by something else.
export const REGISTRATION_ANGLES_DEG=[45,135,225,315];

const PIECE_LABELS:Record<PieceId,string>={base:'Base',land:'Land',frame:'Frame'};

const EMPTY_BOUNDS:BoundsMm={minX:0,minY:0,maxX:0,maxY:0};

export function geometryBounds(geometry:MultiPolygonMm):BoundsMm|undefined{
 let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
 for(const polygon of geometry)for(const ring of polygon)for(const [x,y] of ring){
  if(!Number.isFinite(x)||!Number.isFinite(y))continue;
  if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;
 }
 return Number.isFinite(minX)?{minX,minY,maxX,maxY}:undefined;
}

const mergeBounds=(...boxes:(BoundsMm|undefined)[]):BoundsMm=>{
 const present=boxes.filter((box):box is BoundsMm=>Boolean(box));
 if(!present.length)return {...EMPTY_BOUNDS};
 return {
  minX:Math.min(...present.map(box=>box.minX)),
  minY:Math.min(...present.map(box=>box.minY)),
  maxX:Math.max(...present.map(box=>box.maxX)),
  maxY:Math.max(...present.map(box=>box.maxY)),
 };
};

export const translateGeometry=(geometry:MultiPolygonMm,dx:number,dy:number):MultiPolygonMm=>
 geometry.map(polygon=>polygon.map(ring=>ring.map(([x,y])=>[x+dx,y+dy] as [number,number])));

const issue=(code:string,severity:OrnamentIssue['severity'],message:string):OrnamentIssue=>({code,severity,message});

export interface PieceSetInput{
 project:OrnamentProject;
 geometry:OrnamentGeometry;
 textLayout:OrnamentTextLayout;
 featureGeometry?:FeatureGeometryResult;
 arcToleranceMm?:number;
}

// The dot pattern both stacked pieces carry, at the same radius, so they register against each
// other rather than each against an idea of the centre. The radius is the structural ring's midline,
// which in water-cutout mode is the one annulus guaranteed to be solid material on the land piece,
// and in classic mode is simply a radius safely inside the base disk.
export function registrationDots(geometry:OrnamentGeometry,ringWidthMm:number,arcToleranceMm=ARC_TOLERANCE_MM):MultiPolygonMm{
 const radius=geometry.innerRadiusMm-Math.max(0,ringWidthMm)/2;
 if(!(radius>0))return [];
 const dot=REGISTRATION_DOT_DIAMETER_MM/2;
 const dots=REGISTRATION_ANGLES_DEG.map(degrees=>{
  const radians=degrees*Math.PI/180;
  return circle(radius*Math.cos(radians),radius*Math.sin(radians),dot,arcToleranceMm);
 });
 return normalizeTopology(unionAll(dots,'Registration marks'),'Registration marks');
}

// Labels are outlined like everything else rather than emitted as live `<text>`. They are explicitly
// non-production, so a live element would be defensible — but it would also be the one place in the
// file whose appearance depends on a font being installed on the destination machine, and the whole
// point of the group is that a human can read it on whatever opens the file.
function labelPath(value:string,centreXMm:number,baselineYMm:number):string{
 const font=getLoadedFont('inter');
 if(!font||!value)return '';
 return textPathData(font,value,LABEL_SIZE_MM,'center',centreXMm,baselineYMm).d;
}

export function buildOrnamentPieces(input:PieceSetInput):OrnamentPieceSet{
 const {project,geometry,textLayout,featureGeometry}=input;
 const tolerance=input.arcToleranceMm??ARC_TOLERANCE_MM;
 const cutout=project.buildMode==='water-cutout-3-piece';
 const warnings:OrnamentIssue[]=[];

 const mapPiece:PieceId=cutout?'land':'base';

 // ---- local geometry, ornament-centred ------------------------------------------------------
 const baseCut=geometry.outerRadiusMm>0?circle(0,0,geometry.outerRadiusMm,tolerance):[];
 const landCut=cutout?(featureGeometry?.landCut??[]):[];
 const frameCut=geometry.frame;
 const roads=featureGeometry?.roadsEngrave??[];
 const waterLight=cutout?[]:(featureGeometry?.waterEngrave??[]);
 const registration=registrationDots(geometry,project.land.structuralRingWidthMm,tolerance);

 if(cutout&&!landCut.length)
  warnings.push(issue('land-piece-empty','warning','Water-cutout mode is selected but no land geometry was built, so the land piece would be empty. Capture the map geometry first.'));

 // ---- pieces and their local extents ---------------------------------------------------------
 const definitions:{id:PieceId;cutLocal:MultiPolygonMm;extra:(BoundsMm|undefined)[]}[]=[
  {
   id:'base',
   cutLocal:baseCut,
   extra:[
    geometryBounds(waterLight),
    cutout?undefined:geometryBounds(roads),
    geometryBounds(registration),
   ],
  },
  ...(cutout?[{
   id:'land' as PieceId,
   cutLocal:landCut,
   extra:[geometryBounds(roads),geometryBounds(registration)],
  }]:[]),
  {id:'frame',cutLocal:frameCut,extra:[geometryBounds(textBandBounds(textLayout))]},
 ];

 const measured=definitions.map(definition=>({
  ...definition,
  localBounds:mergeBounds(geometryBounds(definition.cutLocal),...definition.extra),
 }));

 // Every piece keeps its own origin on one horizontal line, so two pieces that are meant to stack
 // are drawn in register on the sheet. Vertical alignment by bounding box would put the frame's loop
 // level with the base's rim and quietly destroy that.
 const globalMinY=Math.min(...measured.map(piece=>piece.localBounds.minY));
 const globalMaxY=Math.max(...measured.map(piece=>piece.localBounds.maxY));

 let cursor=SHEET_MARGIN_MM;
 const pieces:PlacedPiece[]=measured.map(piece=>{
  const width=piece.localBounds.maxX-piece.localBounds.minX;
  const placed:PlacedPiece={
   id:piece.id,
   label:PIECE_LABELS[piece.id],
   cutLocal:piece.cutLocal,
   localBounds:piece.localBounds,
   offsetMm:[cursor-piece.localBounds.minX,SHEET_MARGIN_MM-globalMinY],
  };
  cursor+=width+PIECE_GAP_MM;
  return placed;
 });

 const contentWidth=Math.max(0,cursor-PIECE_GAP_MM-SHEET_MARGIN_MM);
 const contentHeight=globalMaxY-globalMinY;
 const sheet:OrnamentSheet={
  widthMm:contentWidth+SHEET_MARGIN_MM*2,
  heightMm:contentHeight+SHEET_MARGIN_MM*2+LABEL_BAND_MM,
  marginMm:SHEET_MARGIN_MM,
  gapMm:PIECE_GAP_MM,
  labelBandMm:LABEL_BAND_MM,
 };

 const offsetOf=(id:PieceId):[number,number]=>pieces.find(piece=>piece.id===id)?.offsetMm??[0,0];
 const place=(geom:MultiPolygonMm,id:PieceId):MultiPolygonMm=>{
  const [dx,dy]=offsetOf(id);
  return translateGeometry(geom,dx,dy);
 };

 // ---- semantic groups -------------------------------------------------------------------------
 const labels:string[]=[];
 const labelBaselineY=SHEET_MARGIN_MM-globalMinY+globalMaxY+LABEL_BAND_MM-1.5;
 for(const piece of pieces){
  const centreX=piece.offsetMm[0]+(piece.localBounds.minX+piece.localBounds.maxX)/2;
  const text=labelPath(`${piece.label} · ${project.ornament.diameterMm.toFixed(1)}mm`,centreX,labelBaselineY);
  if(text)labels.push(text);
 }
 if(!labels.length&&pieces.length)
  warnings.push(issue('labels-unavailable','warning','The label font is still loading, so the non-production labels were left out of the export.'));

 const groups:ExportGroup[]=[
  group('piece/base/cut','base','cut',place(baseCut,'base'),[],true,true),
  group('piece/base/water-light-engrave','base','engrave-light',place(waterLight,'base'),[],true,!cutout),
  group('piece/land/cut','land','cut',place(landCut,'land'),[],true,cutout),
  group('piece/land/roads-engrave',mapPiece,'engrave',place(roads,mapPiece),[],true,true),
  group('piece/frame/cut','frame','cut',place(frameCut,'frame'),[],true,true),
  group('piece/frame/text-engrave','frame','engrave',[],framedText(textLayout,offsetOf('frame')),true,true),
  // Registration marks go on the pieces that stack face to face and never on the frame, whose front
  // face is the one the customer looks at.
  group('registration/optional','base','engrave',cutout?[...place(registration,'base'),...place(registration,'land')]:place(registration,'base'),[],false,true),
  group('labels/non-production','base','annotation',[],labels,false,true),
 ];

// Deliberately no `assertFinite` here. A non-finite coordinate is preflight check 8, and preflight
 // runs it before anything else precisely so the user gets a named finding rather than an exception
 // from three layers inside the boolean engine. Throwing at this point would make that check
 // unreachable for exactly the geometry it exists to catch.

 const baseBounds=geometryBounds(place(baseCut,'base'));
 const finishedDiameterMm=baseBounds?Math.max(baseBounds.maxX-baseBounds.minX,baseBounds.maxY-baseBounds.minY):0;

 return {buildMode:project.buildMode,pieces,groups,sheet,finishedDiameterMm,warnings};
}

function group(
 id:OrnamentGroupId,
 piece:PieceId,
 operation:ExportOperation,
 geometry:MultiPolygonMm,
 paths:string[],
 production:boolean,
 applicable:boolean,
):ExportGroup{
 return {id,piece,operation,geometry,paths,production,applicable};
}

// The text layout already carries path data with the baseline baked in at ornament coordinates, so
// placing it on the sheet is one translation. Regenerating it from the font instead would risk the
// exported text differing from the text the overflow check was run against.
const framedText=(layout:OrnamentTextLayout,offset:[number,number]):string[]=>
 layout.lines.filter(line=>line.d).map(line=>translatePathData(line.d,offset[0],offset[1]));

// Bounding box of the laid-out text, in ornament coordinates, as a degenerate MultiPolygon so it can
// go through the same bounds helper as everything else.
function textBandBounds(layout:OrnamentTextLayout):MultiPolygonMm{
 const boxes=layout.lines.filter(line=>line.d).map(line=>line.bounds);
 if(!boxes.length)return [];
 const minX=Math.min(...boxes.map(box=>box.minX)),maxX=Math.max(...boxes.map(box=>box.maxX));
 const minY=Math.min(...boxes.map(box=>box.minY)),maxY=Math.max(...boxes.map(box=>box.maxY));
 return [[[[minX,minY],[maxX,minY],[maxX,maxY],[minX,maxY],[minX,minY]]]];
}
