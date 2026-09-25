import ClipperLib from 'clipper-lib';
import type * as opentype from 'opentype.js';
import type {MultiPolygonMm} from '../../geometry/shoreline/polygonEngine';
import {areaMm2,clip,toPaths} from '../../geometry/terrain/nestedBands';
import {sanitizeTextValue} from '../../ornament/text/ornamentText';
import {textPathData} from '../../text/textVector';
import type {TopoProject} from '../types';
import type {BoxMm} from './labels';
import type {TopoFeatureWarning} from './warnings';

// The title (plan §5: "use bundled, redistributable fonts; convert glyphs to paths").
//
// Glyph outlines from textPathData in the chosen bundled font, positioned in board millimetres with
// the position baked into the path. The default place is bottom centre, inside the frame when there
// is one, with a margin of half the text height; the title's dx/dy move it from there. Text is
// sanitised the way the ornament's is (line breaks become spaces, control characters go).

export interface TopoTitle{text:string;d:string;box:BoxMm;baselineYMm:number;centerXMm:number}

export function buildTitle(title:TopoProject['title'],widthMm:number,heightMm:number,insetMm:number,font:opentype.Font,water:MultiPolygonMm):{title?:TopoTitle;warnings:TopoFeatureWarning[]}{
 const text=sanitizeTextValue(title.text).trim();
 if(!text)return {warnings:[]};
 const size=title.sizeMm,margin=Math.max(1,size*.5);
 const local=textPathData(font,text,size,'center');
 const centerXMm=widthMm/2+title.dxMm;
 // Bottom of the glyphs `margin` above the inner edge, then the user's offset.
 const baselineYMm=heightMm-insetMm-margin-local.bounds.maxY+title.dyMm;
 const {d}=textPathData(font,text,size,'center',centerXMm,baselineYMm);
 const box:BoxMm={minX:centerXMm+local.bounds.minX,minY:baselineYMm+local.bounds.minY,maxX:centerXMm+local.bounds.maxX,maxY:baselineYMm+local.bounds.maxY};
 const warnings:TopoFeatureWarning[]=[];
 // Moving the title onto the frame band is a normal choice; leaving the board is not.
 if(box.minX<0||box.minY<0||box.maxX>widthMm||box.maxY>heightMm)
  warnings.push({code:'title-outside-board',message:`The title runs off the board (it is ${(box.maxX-box.minX).toFixed(1)} mm wide). Shorten it, make it smaller, or move it.`});
 // Over water only counts inside the frame opening: on the frame band it is engraved on the frame.
 const inner:BoxMm={minX:Math.max(box.minX,insetMm),minY:Math.max(box.minY,insetMm),maxX:Math.min(box.maxX,widthMm-insetMm),maxY:Math.min(box.maxY,heightMm-insetMm)};
 if(water.length&&inner.maxX>inner.minX&&inner.maxY>inner.minY){
  const wet=areaMm2(clip(ClipperLib.ClipType.ctIntersection,[[[[inner.minX,inner.minY],[inner.maxX,inner.minY],[inner.maxX,inner.maxY],[inner.minX,inner.maxY],[inner.minX,inner.minY]]]],toPaths(water),ClipperLib.PolyFillType.pftEvenOdd,'title','Topo title'));
  if(wet>.01)warnings.push({code:'title-over-water',message:'Part of the title sits over water, which is cut out, so those letters would have nothing under them. Move it onto land or onto the frame.'});
 }
 return {title:{text,d,box,baselineYMm,centerXMm},warnings};
}
