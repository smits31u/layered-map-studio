import ClipperLib from 'clipper-lib';
import type * as opentype from 'opentype.js';
import type {MultiPolygonMm} from '../../geometry/shoreline/polygonEngine';
import {MIN_LETTER_SIZE_MM} from '../../geometry/scene/compass';
import {areaMm2,clip,toPaths,type ClipperPath} from '../../geometry/terrain/nestedBands';
import {textPathData} from '../../text/textVector';
import type {CapturedLabel} from '../capture/topoCapture';
import type {FrozenTerrainView} from '../terrain/pipeline';
import {boardProjection} from './projection';
import type {TopoFeatureWarning} from './warnings';

// Place and POI labels on the board (plan §5 Labels: "dedupe and collision-filter in output
// coordinates. Convert glyphs to paths with opentype.js for portable SVGs").
//
// Every label is glyph outlines from textPathData (src/text/textVector.ts), the conversion every
// other text in this app uses, with its position baked into the path data: the SVG contract has no
// transforms left in geometry groups, and there is never a live <text> element.
//
// Placement, in board millimetres, in priority order: places before POIs; places by class (city
// first, down to hamlets), then by OpenMapTiles rank; POIs by rank. A label is centred on its point
// and kept only if its padded box
//   - lies inside the board, inset by the frame when there is one;
//   - misses every label already placed and every keep-out (the title);
//   - lies on land — water is cut out, and a word engraved across a hole loses letters;
//   - and its name has not been placed already (the same bus stop on four corners).
// What was left off is counted by reason.

const PLACE_CLASS_ORDER=['city','town','village','suburb','quarter','neighbourhood','hamlet','island','islet','locality','isolated_dwelling'];
// Too large to belong on a board: a state or country label names the whole map, not a place on it.
const EXCLUDED_PLACE_CLASSES=new Set(['continent','country','state','province']);

export interface BoxMm{minX:number;minY:number;maxX:number;maxY:number}

export interface PlacedLabel{
 name:string;
 kind:CapturedLabel['kind'];
 labelClass:string;
 // The captured point, in board millimetres; the label is centred on it.
 xMm:number;yMm:number;
 sizeMm:number;
 // Glyph outlines in board coordinates, closed subpaths.
 d:string;
 box:BoxMm;
}

export interface LabelDrops{outside:number;collision:number;water:number;duplicate:number;excluded:number}

export interface TopoLabelLayer{placed:PlacedLabel[];dropped:LabelDrops;warnings:TopoFeatureWarning[]}

export interface LabelPlacementOptions{
 sizeMm:number;
 // The board edge inset, e.g. the frame's thickness.
 insetMm:number;
 water:MultiPolygonMm;
 keepOut:readonly BoxMm[];
}

const overlaps=(a:BoxMm,b:BoxMm)=>a.minX<b.maxX&&b.minX<a.maxX&&a.minY<b.maxY&&b.minY<a.maxY;
const boxPolygon=(b:BoxMm):MultiPolygonMm=>[[[[b.minX,b.minY],[b.maxX,b.minY],[b.maxX,b.maxY],[b.minX,b.maxY],[b.minX,b.minY]]]];
const boxArea=(b:BoxMm)=>(b.maxX-b.minX)*(b.maxY-b.minY);

export function labelPriority(a:CapturedLabel,b:CapturedLabel):number{
 if(a.kind!==b.kind)return a.kind==='place'?-1:1;
 if(a.kind==='place'){
  const ca=PLACE_CLASS_ORDER.indexOf(a.labelClass),cb=PLACE_CLASS_ORDER.indexOf(b.labelClass);
  const oa=ca<0?PLACE_CLASS_ORDER.length:ca,ob=cb<0?PLACE_CLASS_ORDER.length:cb;
  if(oa!==ob)return oa-ob;
 }
 if(a.rank!==b.rank)return a.rank-b.rank;
 return a.name<b.name?-1:a.name>b.name?1:0;
}

// Share of a label's box allowed over water before it is dropped: glyph boxes are generous, and the
// shoreline is simplified, so a sliver of overlap at a corner is not a letter over the sea.
const WATER_OVERLAP_SHARE=.02;

export function placeLabels(labels:readonly CapturedLabel[],view:FrozenTerrainView,font:opentype.Font,options:LabelPlacementOptions):TopoLabelLayer{
 const {widthMm:W,heightMm:H}=view;
 const project=boardProjection(view);
 const size=options.sizeMm,pad=size*.2,inset=Math.max(0,options.insetMm);
 const bounds:BoxMm={minX:inset,minY:inset,maxX:W-inset,maxY:H-inset};
 const waterPaths:ClipperPath[]|undefined=options.water.length?toPaths(options.water):undefined;
 const dropped:LabelDrops={outside:0,collision:0,water:0,duplicate:0,excluded:0};
 const placed:PlacedLabel[]=[],taken:BoxMm[]=[...options.keepOut],names=new Set<string>();

 for(const label of [...labels].sort(labelPriority)){
  if(label.kind==='place'&&EXCLUDED_PLACE_CLASSES.has(label.labelClass)){dropped.excluded++;continue}
  const key=label.name.trim().toLowerCase();
  if(names.has(key)){dropped.duplicate++;continue}
  const [x,y]=project(label.point[0],label.point[1]);
  if(!Number.isFinite(x)||!Number.isFinite(y)){dropped.outside++;continue}
  // Laid out once at the origin to measure, then again with the position baked in.
  const local=textPathData(font,label.name,size,'center');
  const dy=-(local.bounds.minY+local.bounds.maxY)/2;
  const box:BoxMm={minX:x+local.bounds.minX-pad,minY:y+dy+local.bounds.minY-pad,maxX:x+local.bounds.maxX+pad,maxY:y+dy+local.bounds.maxY+pad};
  if(box.minX<bounds.minX||box.minY<bounds.minY||box.maxX>bounds.maxX||box.maxY>bounds.maxY){dropped.outside++;continue}
  if(taken.some(other=>overlaps(box,other))){dropped.collision++;continue}
  if(waterPaths&&areaMm2(clip(ClipperLib.ClipType.ctIntersection,boxPolygon(box),waterPaths,ClipperLib.PolyFillType.pftEvenOdd,'label','Topo labels'))>boxArea(box)*WATER_OVERLAP_SHARE){dropped.water++;continue}
  const {d}=textPathData(font,label.name,size,'center',x,y+dy);
  if(!d)continue;
  names.add(key);
  taken.push(box);
  placed.push({name:label.name,kind:label.kind,labelClass:label.labelClass,xMm:x,yMm:y,sizeMm:size,d,box});
 }

 const warnings:TopoFeatureWarning[]=[];
 if(size<MIN_LETTER_SIZE_MM)warnings.push({code:'label-size-below-minimum',message:`Labels are ${size} mm tall, under the ${MIN_LETTER_SIZE_MM} mm below which engraved letters fill in. They are kept; check them on a test piece.`});
 const left=dropped.collision+dropped.water;
 if(left)warnings.push({code:'labels-left-off',message:`${left} label${left>1?'s':''} did not fit (${dropped.collision} overlapped another label or the title, ${dropped.water} would sit over water) and ${left>1?'were':'was'} left off.`});
 return {placed,dropped,warnings};
}
