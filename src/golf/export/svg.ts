import {CUT_STROKE_MM} from '../../ornament/export/lightburn';
import {escapeXml} from '../../ornament/export/metadata';
import {formatMm as n,geometryPathMm} from '../../ornament/export/svg';
import type {LineMm} from '../../geometry/terrain/contourLines';
import type {GolfBoard,GolfGroup,GolfOperation,GolfSheet} from '../geometry/board';

// One SVG per physical sheet (docs/GOLF_MODULE_PLAN.md §7). The topo and ornament serializers'
// rules, unchanged: real millimetres with a 1:1 viewBox, every number rounded once to three decimals,
// no transforms, no live fonts. Every sheet is the whole board, in place, so the three files register
// on their edges.
//
// Group ids (`cut/…`, `score/…`, `engrave/…`) are the contract; colours are the topo builder's
// convention on top of it (red cut, blue score, black engrave), which laser software sorts into layers.
// Each surface or ground piece is its own path carrying its tag, so a piece can be found by id.

const STYLE:Record<GolfOperation,{fill:string;stroke:string}>={
 cut:{fill:'none',stroke:'#FF0000'},
 score:{fill:'none',stroke:'#0000FF'},
 engrave:{fill:'#000000',stroke:'none'},
};

export const linePathData=(line:LineMm)=>line.map(([x,y],i)=>`${i?'L':'M'}${n(x)} ${n(y)}`).join(' ');

function groupBody(group:GolfGroup,sheet:GolfSheet):string{
 const parts:string[]=[];
 if(group.id==='cut/pieces')for(const piece of sheet.pieces)parts.push(`<path id="${piece.tag}" data-piece="${piece.tag}" d="${geometryPathMm([piece.geometry])}"/>`);
 else for(const polygon of group.geometry)parts.push(`<path d="${geometryPathMm([polygon])}"/>`);
 for(const line of group.lines)if(line.length>=2)parts.push(`<path d="${linePathData(line)}"/>`);
 for(const glyph of group.glyphs)if(glyph.d)parts.push(`<path d="${glyph.d}" data-text="${escapeXml(glyph.name)}"/>`);
 return parts.join('');
}

export interface SheetSvgMeta{courseName:string;osm:string;fileName:string;stockMm:number;attribution:string;appVersion:string}

export function sheetSvg(board:GolfBoard,sheet:GolfSheet,meta:SheetSvgMeta):string{
 const groups=sheet.groups.map(group=>{
  const style=STYLE[group.operation];
  const body=groupBody(group,sheet);
  return `<g ${[
   `id="${group.id}"`,
   `data-operation="${group.operation}"`,
   `fill="${style.fill}"`,
   `stroke="${style.stroke}"`,
   group.operation==='engrave'?'':`stroke-width="${n(CUT_STROKE_MM)}"`,
   // Holes (water in the ground, sand in a fairway) need even-odd; glyph counters need nonzero.
   `fill-rule="${group.glyphs.length&&!group.geometry.length?'nonzero':'evenodd'}"`,
   body?'':'data-empty="true"',
  ].filter(Boolean).join(' ')}>${body}</g>`;
 }).join('');
 return [
  '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
  '<svg xmlns="http://www.w3.org/2000/svg" version="1.1"',
  ` width="${n(board.widthMm)}mm" height="${n(board.heightMm)}mm"`,
  ` viewBox="0 0 ${n(board.widthMm)} ${n(board.heightMm)}"`,
  ` data-units="mm" data-sheet="L${sheet.index}" data-role="${sheet.role}" data-stock-mm="${n(meta.stockMm)}" stroke-linejoin="round" stroke-linecap="round">`,
  `<title>${escapeXml(meta.courseName)} · L${sheet.index} ${escapeXml(sheet.name)} · ${n(board.widthMm)}×${n(board.heightMm)} mm</title>`,
  `<metadata><lms:golf-sheet xmlns:lms="https://oldglorydecor.com/ns/layered-map-studio/golf/1" sheet="L${sheet.index}" role="${sheet.role}" pieces="${sheet.pieces.length}" osm="${escapeXml(meta.osm)}" app-version="${escapeXml(meta.appVersion)}">${escapeXml(meta.attribution)}. See manifest.json in the same ZIP.</lms:golf-sheet></metadata>`,
  groups,
  '</svg>',
 ].join('');
}
