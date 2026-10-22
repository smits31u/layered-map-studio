import {FONT_REGISTRY} from '../text/fontRegistry';
import type {FontId} from '../types/project';
import {createDefaultGolfProject} from './defaults';
import {GOLF_LIMITS,TITLE_FIELDS,type GolfProject,type MarkOperation,type NumericLimit,type TitleField} from './types';

// Clamping and repair, the topo builder's rule (src/topo/validation.ts): anything that reaches the
// store — a control, a stored record, an imported file — comes out as a project every control can
// show. Unknown values fall back to the default rather than throwing.

const clamp=(value:unknown,limit:NumericLimit,fallback:number)=>{
 const n=typeof value==='number'&&Number.isFinite(value)?value:fallback;
 return Math.min(limit.max,Math.max(limit.min,n));
};
const oneOf=<T extends string>(value:unknown,allowed:readonly T[],fallback:T):T=>typeof value==='string'&&(allowed as readonly string[]).includes(value)?value as T:fallback;
const bool=(value:unknown,fallback:boolean)=>typeof value==='boolean'?value:fallback;
const MARK_OPS:readonly MarkOperation[]=['engrave','score','none'];
const FONT_IDS=FONT_REGISTRY.map(f=>f.id) as FontId[];
export const MAX_TITLE_TEXT=120;
const cleanText=(value:unknown)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f-\u009f]+/g,' ').slice(0,MAX_TITLE_TEXT):'';

export function clampGolfProject(raw:GolfProject):GolfProject{
 const d=createDefaultGolfProject();
 const p=raw??d;
 const course=p.course&&(p.course.osmType==='way'||p.course.osmType==='relation')&&Number.isSafeInteger(p.course.osmId)&&p.course.osmId>0
  ?{osmType:p.course.osmType,osmId:p.course.osmId,label:cleanText(p.course.label)}:null;
 const show={} as Record<TitleField,boolean>,text={} as Record<TitleField,string>;
 for(const field of TITLE_FIELDS){show[field]=bool(p.title?.show?.[field],d.title.show[field]);text[field]=cleanText(p.title?.text?.[field])}
 const m=p.marks??d.marks;
 return {
  schemaVersion:1,
  course,
  displayUnit:oneOf(p.displayUnit,['mm','in'] as const,d.displayUnit),
  board:{
   widthMm:clamp(p.board?.widthMm,GOLF_LIMITS.boardMm,d.board.widthMm),
   heightMm:clamp(p.board?.heightMm,GOLF_LIMITS.boardMm,d.board.heightMm),
   marginMm:clamp(p.board?.marginMm,GOLF_LIMITS.marginMm,d.board.marginMm),
   northUp:bool(p.board?.northUp,d.board.northUp),
  },
  coverageConfirmedFor:course&&typeof p.coverageConfirmedFor==='string'?p.coverageConfirmedFor:null,
  nines:Array.isArray(p.nines)?[...new Set(p.nines.filter((n):n is string=>typeof n==='string'&&n.length>0&&n.length<=60))]:null,
  marks:{
   bunkers:oneOf(m.bunkers,MARK_OPS,d.marks.bunkers),
   tees:oneOf(m.tees,MARK_OPS,d.marks.tees),
   cartpaths:oneOf(m.cartpaths,MARK_OPS,d.marks.cartpaths),
   streams:oneOf(m.streams,MARK_OPS,d.marks.streams),
   routing:oneOf(m.routing,MARK_OPS,d.marks.routing),
   floorWater:oneOf(m.floorWater,['engrave','none'] as const,d.marks.floorWater),
   greenInset:bool(m.greenInset,d.marks.greenInset),
   greenCollar:bool(m.greenCollar,d.marks.greenCollar),
   holeNumbers:bool(m.holeNumbers,d.marks.holeNumbers),
  },
  title:{
   layout:oneOf(p.title?.layout,['header','corner','none'] as const,d.title.layout),
   fontId:oneOf(p.title?.fontId,FONT_IDS,d.title.fontId),
   sizeMm:clamp(p.title?.sizeMm,GOLF_LIMITS.titleSizeMm,d.title.sizeMm),
   show,text,
  },
 };
}
