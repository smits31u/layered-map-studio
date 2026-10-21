import {CUT_STROKE_MM} from '../../ornament/export/lightburn';
import {escapeXml} from '../../ornament/export/metadata';
import {formatMm as n,geometryPathMm} from '../../ornament/export/svg';
import type {MultiPolygonMm} from '../../geometry/shoreline/polygonEngine';
import type {TopoBoard,TopoExportGroup,TopoOperation,TopoScoreLine} from './board';
import {topoMetadataXml,type TopoExportMetadata} from './metadata';

// The topo board's manufacturing SVG (plan §6). The ornament serializer's rules, unchanged:
//   - real millimetres: width/height carry `mm` and the viewBox is 1:1 with them;
//   - every number rounded once, to three decimals, by the same function the ornament uses;
//   - nothing depends on a transform, a live font or a stylesheet: glyphs are outlines with their
//     positions baked in, and no geometry group has a transform.
// Group ids are the fabrication contract; colours are a convenience on top of it, the ornament's
// LightBurn convention (red cut, black engrave) plus blue for score lines. As CLAUDE.md records,
// that convention is unverified against xTool Studio — the ids are what to rely on.
//
// A street map's light engrave (its water) is grey, the ornament's monochrome engrave-light colour:
// blue is taken by score lines here, and laser software sorts layers by colour, so a light engrave
// sharing it would land on the score layer.

const STYLE:Record<TopoOperation,{fill:string;stroke:string}>={
 cut:{fill:'none',stroke:'#FF0000'},
 score:{fill:'none',stroke:'#0000FF'},
 engrave:{fill:'#000000',stroke:'none'},
 'engrave-light':{fill:'#777777',stroke:'none'},
};
const engraves=(operation:TopoOperation)=>operation==='engrave'||operation==='engrave-light';

const linePath=(line:[number,number][])=>line.map(([x,y],i)=>`${i?'L':'M'}${n(x)} ${n(y)}`).join(' ');

// The path data the file holds for one polygon of a group and for one score entry. Exported so the
// production estimate and 3D preview read the exact strings written here (adapters/topoBoard.ts).
export const polygonPathData=(polygon:MultiPolygonMm[number])=>geometryPathMm([polygon]);
export const scorePathData=(score:TopoScoreLine)=>score.lines.filter(line=>line.length>=2).map(linePath).join(' ');

function groupBody(group:TopoExportGroup):string{
 const parts:string[]=[];
 // One path per polygon, so each piece can be selected on its own in the laser software; holes stay
 // with their outer ring under the group's even-odd rule.
 for(const polygon of group.geometry)parts.push(`<path d="${polygonPathData(polygon)}"/>`);
 for(const score of group.lines){
  const d=scorePathData(score);
  if(d)parts.push(`<path d="${d}"${score.label?` data-label="${escapeXml(score.label)}"`:''}/>`);
 }
 for(const glyph of group.glyphs)if(glyph.d)parts.push(`<path d="${glyph.d}" data-text="${escapeXml(glyph.name)}"/>`);
 return parts.join('');
}

export function topoSvg(board:TopoBoard,metadata:TopoExportMetadata):string{
 const groups=board.groups.map(group=>{
  const style=STYLE[group.operation];
  const strokeWidth=engraves(group.operation)?undefined:group.strokeWidthMm??CUT_STROKE_MM;
  const body=groupBody(group);
  const attributes=[
   `id="${group.id}"`,
   `data-operation="${group.operation}"`,
   `data-kind="${group.kind}"`,
   `fill="${style.fill}"`,
   `stroke="${style.stroke}"`,
   strokeWidth!==undefined?`stroke-width="${n(strokeWidth)}"`:'',
   // Holes (water in the land, blocks between roads, the frame's opening, bridge gaps) need even-odd;
   // glyph counters are nonzero, as the ornament's text is, or the inside of an "o" fills in.
   `fill-rule="${group.kind==='glyphs'?'nonzero':'evenodd'}"`,
   body?'':'data-empty="true"',
   !body&&group.emptyReason?`data-empty-reason="${escapeXml(group.emptyReason)}"`:'',
  ].filter(Boolean).join(' ');
  return `<g ${attributes}>${body}</g>`;
 }).join('');
 const place=metadata.viewport.place??`${metadata.viewport.center[1]}, ${metadata.viewport.center[0]}`;
 return [
  '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
  '<svg xmlns="http://www.w3.org/2000/svg" version="1.1"',
  ` width="${n(board.widthMm)}mm" height="${n(board.heightMm)}mm"`,
  ` viewBox="0 0 ${n(board.widthMm)} ${n(board.heightMm)}"`,
  ' data-units="mm" stroke-linejoin="round" stroke-linecap="round">',
  `<title>${board.style==='street'?'Street map':'Topographic map'} · ${escapeXml(place)} · ${n(board.widthMm)}×${n(board.heightMm)} mm</title>`,
  topoMetadataXml(metadata),
  groups,
  '</svg>',
 ].join('');
}
