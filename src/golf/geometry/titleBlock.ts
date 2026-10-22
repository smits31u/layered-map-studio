import type * as opentype from 'opentype.js';
import {sanitizeTextValue} from '../../ornament/text/ornamentText';
import {measureTextWidthMm,textPathData,type TextAnchorH} from '../../text/textVector';
import type {FontId} from '../../types/project';
import type {GolfProject,TitleField} from '../types';

// The title block (docs/GOLF_MODULE_PLAN.md §6), as glyph outlines in board millimetres.
//
// Up to five lines, top to bottom: the line above the name, the course name, its location, one line
// of stats (par, length, rating/slope, year, architect), and the personal line. Each line's size is a
// fixed share of the name's size, and a line too wide for the board is shrunk to fit, with a warning.
// The name uses the chosen font; the small lines Inter; the personal line Great Vibes. All three are
// the app's bundled OFL fonts, so nothing in the file depends on an installed font.
//
//   header  centred across the top inside the margin. The fit (fit.ts) keeps the course out of it,
//           so the text engraves on the floor and never straddles a piece's edge.
//   corner  a left-aligned block in whichever bottom or top corner the course leaves emptiest; the
//           board builder trims the course back from it if they still overlap.

export interface TitleValues{name:string;location:string;par:string}
export interface TitleLine{field:TitleField|'stats';text:string;fontId:FontId;sizeMm:number;shrunk:boolean}
export interface TitleGlyphs{d:string;name:string}
export interface TitleLayoutResult{lines:TitleLine[];glyphs:TitleGlyphs[];box:{x:number;y:number;width:number;height:number};warnings:{code:string;message:string}[]}

const SHARE:Record<TitleLine['field'],number>={above:.42,name:1,location:.42,stats:.36,personal:.6,par:.36,length:.36,rating:.36,slope:.36,year:.36,architect:.36};
const GAP_SHARE=.3;

export function titleLines(title:GolfProject['title'],values:TitleValues):Omit<TitleLine,'shrunk'>[]{
 const text=(field:TitleField)=>sanitizeTextValue(title.text[field]).trim();
 const value=(field:TitleField)=>title.show[field]?(field==='name'||field==='location'||field==='par'?text(field)||values[field]:text(field)):'';
 const lines:Omit<TitleLine,'shrunk'>[]=[];
 const push=(field:TitleLine['field'],t:string,fontId:FontId)=>{if(t)lines.push({field,text:t,fontId,sizeMm:title.sizeMm*SHARE[field]})};
 push('above',value('above'),'inter');
 push('name',value('name'),title.fontId);
 push('location',value('location'),'inter');
 const rating=value('rating'),slope=value('slope');
 const stats=[
  value('par')&&`Par ${value('par')}`,
  value('length'),
  rating&&slope?`Rating ${rating} / Slope ${slope}`:rating?`Rating ${rating}`:slope?`Slope ${slope}`:'',
  value('year')&&`Est. ${value('year')}`,
  value('architect'),
 ].filter(Boolean);
 push('stats',stats.join('   ·   '),'inter');
 push('personal',value('personal'),'great-vibes');
 return lines;
}

export const fontsForTitle=(title:GolfProject['title'],values:TitleValues):FontId[]=>[...new Set(titleLines(title,values).map(l=>l.fontId))];

export class GolfFontError extends Error{constructor(readonly fontId:FontId){super(`The ${fontId} font is still loading or failed to load; the title cannot be drawn without it.`);this.name='GolfFontError'}}

// Lays the lines out at the origin to measure them, then again where they go. `maxWidthMm` is the
// board width inside the margin.
export function layoutTitle({title,values,font,widthMm,heightMm,marginMm,corner}:{title:GolfProject['title'];values:TitleValues;font:(id:FontId)=>opentype.Font|undefined;widthMm:number;heightMm:number;marginMm:number;corner?:'top-left'|'top-right'|'bottom-left'|'bottom-right'}):TitleLayoutResult|undefined{
 const lines=titleLines(title,values);
 if(!lines.length||title.layout==='none')return undefined;
 const warnings:TitleLayoutResult['warnings']=[];
 const maxWidth=title.layout==='header'?widthMm-2*marginMm:(widthMm-2*marginMm)*.5;
 const measured=lines.map(line=>{
  const f=font(line.fontId);
  if(!f)throw new GolfFontError(line.fontId);
  let size=line.sizeMm;
  const width=measureTextWidthMm(f,line.text,size);
  const shrunk=width>maxWidth;
  if(shrunk){size=size*maxWidth/width;warnings.push({code:'title-shrunk',message:`The title line "${line.text}" was too wide for the board and was shrunk to ${size.toFixed(1)} mm.`})}
  const local=textPathData(f,line.text,size,'left');
  return {line:{...line,sizeMm:size,shrunk},font:f,bounds:local.bounds,width:local.widthMm};
 });
 let cursor=0;
 const baselines:number[]=[];
 measured.forEach((m,i)=>{
  const baseline=cursor-m.bounds.minY;
  baselines.push(baseline);
  cursor=baseline+m.bounds.maxY+(i<measured.length-1?m.line.sizeMm*GAP_SHARE+measured[i+1].line.sizeMm*GAP_SHARE:0);
 });
 const blockHeight=cursor,blockWidth=Math.max(...measured.map(m=>m.bounds.maxX-Math.min(0,m.bounds.minX)));
 const anchor:TextAnchorH=title.layout==='header'?'center':'left';
 let x0:number,y0:number;
 if(title.layout==='header'){x0=widthMm/2;y0=marginMm}
 else{
  const c=corner??'bottom-left';
  x0=c.endsWith('left')?marginMm:widthMm-marginMm-blockWidth;
  y0=c.startsWith('top')?marginMm:heightMm-marginMm-blockHeight;
 }
 const glyphs=measured.map((m,i)=>({d:textPathData(m.font,m.line.text,m.line.sizeMm,anchor,x0,y0+baselines[i]).d,name:m.line.field}));
 const box=title.layout==='header'?{x:marginMm,y:y0,width:widthMm-2*marginMm,height:blockHeight}:{x:x0,y:y0,width:blockWidth,height:blockHeight};
 return {lines:measured.map(m=>m.line),glyphs,box,warnings};
}
